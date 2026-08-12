// Fulfillment — PURE two-condition INVENTORY-CONTROL projection (trusted-read mirror of the
// client authority field-ops-app-vite/src/domain/inventoryControlLifecycle.js). Encodes the
// single Owner-confirmed rule (business-processes/ventana-ice-machine-commercial-inventory-
// lifecycle.md): Taylor inventory control BEGINS at receipt into Taylor control and ENDS only
// when BOTH (1) installation is complete AND (2) the associated sale closes. Allocation,
// delivery, and invoicing end none of it.
//
// PURE: no Firestore/firebase-functions import. A trusted read (Admin-SDK) derives the three
// boolean signals from their own authorities and supplies them here; this module never trusts
// a client-supplied conclusion. The decision table is identical to the client mirror; parity is
// asserted by test/inventoryControlLifecycle.test.mjs against the same canonical case table.
//
// AUTHORITY SEPARATION: inventory control is ONE axis; ownership/title is separate and is NEVER
// inferred from it (resolveOwnershipTitle), and availability is never inferred from presence
// (isPresentableAsAvailable).

export const INVENTORY_CONTROL_STATES = ["UNKNOWN", "NOT_STARTED", "CONTROLLED", "EXITED"] as const;
export type InventoryControlState = (typeof INVENTORY_CONTROL_STATES)[number];

export const EXIT_CONDITIONS = {
  INSTALLATION_INCOMPLETE: "INSTALLATION_INCOMPLETE",
  SALE_OPEN: "SALE_OPEN",
} as const;
export type ExitCondition = (typeof EXIT_CONDITIONS)[keyof typeof EXIT_CONDITIONS];

export type TriSignal = boolean | null | undefined;

export interface InventoryControlInput {
  controlBegan: TriSignal;
  installationComplete: TriSignal;
  saleClosed: TriSignal;
  context?: { allocated?: TriSignal; delivered?: TriSignal; invoiced?: TriSignal };
}

export interface InventoryControlResult {
  state: InventoryControlState;
  unmetConditions: ExitCondition[];
  began: boolean | null;
  installationComplete: boolean | null;
  saleClosed: boolean | null;
  context: { allocated: boolean | null; delivered: boolean | null; invoiced: boolean | null };
}

// true / false / unknown. Any non-boolean (null, undefined, number, ...) is unknown — an absent
// signal is NEVER silently treated as false.
const tri = (v: TriSignal): boolean | null => (v === true ? true : v === false ? false : null);

// The projection. `context` (allocated/delivered/invoiced) is display-only and PROVABLY cannot
// end control — it is echoed, never consulted for the exit decision.
export function computeInventoryControl(input: InventoryControlInput): InventoryControlResult {
  const began = tri(input?.controlBegan);
  const installed = tri(input?.installationComplete);
  const closed = tri(input?.saleClosed);
  const context = Object.freeze({
    allocated: tri(input?.context?.allocated),
    delivered: tri(input?.context?.delivered),
    invoiced: tri(input?.context?.invoiced),
  });
  const base = { began, installationComplete: installed, saleClosed: closed, context };
  // Freeze results (and unmetConditions) so immutability matches the client mirror byte-for-decision.
  const done = (state: InventoryControlState, unmet: ExitCondition[]): InventoryControlResult =>
    Object.freeze({ state, unmetConditions: Object.freeze(unmet) as ExitCondition[], ...base });

  if (began === null) return done("UNKNOWN", []);
  if (began === false) return done("NOT_STARTED", []);
  if (installed === null || closed === null) return done("UNKNOWN", []);

  const unmet: ExitCondition[] = [];
  if (installed !== true) unmet.push(EXIT_CONDITIONS.INSTALLATION_INCOMPLETE);
  if (closed !== true) unmet.push(EXIT_CONDITIONS.SALE_OPEN);
  if (unmet.length === 0) return done("EXITED", []);
  return done("CONTROLLED", unmet);
}

// OWNERSHIP GUARD (INV-4): title is a separate axis, NEVER derived from inventory-control state.
export const OWNERSHIP = { VENTANA: "VENTANA", TAYLOR: "TAYLOR", CUSTOMER: "CUSTOMER", UNKNOWN: "UNKNOWN" } as const;
export type Ownership = (typeof OWNERSHIP)[keyof typeof OWNERSHIP];

export function resolveOwnershipTitle(input: { explicitTitleHolder?: unknown } = {}): Ownership {
  const h = input.explicitTitleHolder;
  if (h === OWNERSHIP.VENTANA || h === OWNERSHIP.TAYLOR || h === OWNERSHIP.CUSTOMER) return h;
  return OWNERSHIP.UNKNOWN;
}

// Ventana-chain TITLE (Owner rulings D-1 / D-2): Ventana until purchase, Taylor after purchase (D-1),
// customer after successful delivery/acceptance (D-2 — never installation-complete or sale-close).
// Its own axis; never reads inventory-control state. Fail-closed to UNKNOWN.
export function resolveVentanaChainTitle(input: { purchasedFromVentana?: unknown; deliveredAndAccepted?: unknown } = {}): Ownership {
  if (input.deliveredAndAccepted === true) return OWNERSHIP.CUSTOMER;
  if (input.purchasedFromVentana === true) return OWNERSHIP.TAYLOR;
  if (input.purchasedFromVentana === false) return OWNERSHIP.VENTANA;
  return OWNERSHIP.UNKNOWN;
}

// Disposition on cancellation/damage (Owner ruling D-7): NEVER auto-return to available inventory;
// require an explicit disposition + reason/audit. Fail-closed default = HOLD / disposition-required.
export const DISPOSITION = { DISPOSITION_REQUIRED: "DISPOSITION_REQUIRED", NONE: "NONE" } as const;
export type Disposition = (typeof DISPOSITION)[keyof typeof DISPOSITION];

export function resolveCancelOrDamageDisposition(input: { saleCancelled?: unknown; damaged?: unknown } = {}): Readonly<{ disposition: Disposition; autoReturnToAvailable: boolean; reasonRequired: boolean }> {
  if (input.saleCancelled === true || input.damaged === true) {
    return Object.freeze({ disposition: DISPOSITION.DISPOSITION_REQUIRED, autoReturnToAvailable: false, reasonRequired: true });
  }
  return Object.freeze({ disposition: DISPOSITION.NONE, autoReturnToAvailable: false, reasonRequired: false });
}

// AVAILABILITY GUARD (INV-2): present-and-committed is UNAVAILABLE. Fail-closed to false.
export function isPresentableAsAvailable(input: { availableForAssignment?: unknown; committedToSalesOrder?: unknown } = {}): boolean {
  return input.availableForAssignment === true && input.committedToSalesOrder !== true;
}

// Order-level rollup (C713 × 5). NOT_STARTED units (drop-ship that never entered Taylor custody)
// are OUTSIDE the exit denominator — never counted as controlled, never able to strand the order.
// The order EXITS when every unit that entered Taylor control has EXITED; if none ever entered
// control it is NOT_STARTED; one still-controlled unit keeps it CONTROLLED; any unknown unit fails
// the order closed to UNKNOWN.
export function rollupOrderInventoryControl(unitResults: InventoryControlResult[]): Readonly<{
  state: InventoryControlState;
  total: number;
  underControl: number;
  exitedUnits: number;
  controlledUnits: number;
  notStartedUnits: number;
  counts: Record<InventoryControlState, number>;
}> {
  const units = Array.isArray(unitResults) ? unitResults.filter((u) => u && typeof u === "object") : [];
  const total = units.length;
  const counts: Record<InventoryControlState, number> = { UNKNOWN: 0, NOT_STARTED: 0, CONTROLLED: 0, EXITED: 0 };
  for (const u of units) counts[u.state] = (counts[u.state] || 0) + 1;

  const underControl = total - counts.NOT_STARTED;

  let state: InventoryControlState;
  if (total === 0) state = "UNKNOWN";
  else if (counts.UNKNOWN > 0) state = "UNKNOWN";
  else if (underControl === 0) state = "NOT_STARTED";
  else if (counts.EXITED === underControl) state = "EXITED";
  else state = "CONTROLLED";

  return Object.freeze({
    state,
    total,
    underControl,
    exitedUnits: counts.EXITED,
    controlledUnits: counts.CONTROLLED,
    notStartedUnits: counts.NOT_STARTED,
    counts: Object.freeze(counts),
  });
}
