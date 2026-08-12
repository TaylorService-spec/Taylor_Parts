// Ventana / Equipment-Sale — PURE two-condition INVENTORY-CONTROL projection.
//
// The single Owner-confirmed fact this module encodes (business-processes/
// ventana-ice-machine-commercial-inventory-lifecycle.md): Taylor inventory control over a
// serialized machine BEGINS at receipt into Taylor's control and ENDS only when BOTH
//   (1) installation is complete  AND  (2) the associated sale closes.
// Neither condition alone ends it; allocation, delivery, and invoicing end none of it.
//
// SCOPE (deliberate, fail-closed): PURE and DETERMINISTIC — no firebase import, no
// persistence, no ledger, no quantity/movement authority. It composes DERIVED boolean
// SIGNALS (each side derives them from its own authority: Serialized Asset install state,
// Sales Order close state, a receipt fact) into an inventory-control determination. It
// never reads raw documents and never trusts a client-supplied conclusion. Mirrored,
// byte-for-decision, by functions/src/fulfillment/inventoryControlLifecycle.ts; parity is
// enforced by the shared canonical table inventoryControlLifecycle.cases.mjs, which drives
// BOTH test/inventoryControlLifecycle.test.mjs (client) and
// functions/test/inventoryControlLifecycle.test.mjs (trusted-read mirror).
//
// AUTHORITY SEPARATION (the core invariant): inventory control is ONE axis among nine
// independent facts about a machine (ownership/title, custody, availability, seller,
// fulfillment, service, warranty, billing). This module answers ONLY the inventory-control
// axis and REFUSES to infer ownership/title from it (see resolveOwnershipTitle).

// The bounded inventory-control states. Fail-closed: an unknown/contradictory signal set
// resolves to UNKNOWN, never a fabricated CONTROLLED/EXITED.
export const INVENTORY_CONTROL_STATES = Object.freeze([
  "UNKNOWN", // a required signal is missing/contradictory — never assume it is false
  "NOT_STARTED", // no receipt into Taylor control (e.g. Ventana drop-ship never in Taylor custody)
  "CONTROLLED", // control began; at least one of the two exit conditions is unmet
  "EXITED", // control began AND installation complete AND sale closed — the ONLY completion
]);

// The two — and only two — conditions whose joint satisfaction ends inventory control.
export const EXIT_CONDITIONS = Object.freeze({
  INSTALLATION_INCOMPLETE: "INSTALLATION_INCOMPLETE",
  SALE_OPEN: "SALE_OPEN",
});

// A tri-state signal: true / false / unknown. null, undefined, or any non-boolean is
// unknown (fail closed) — an absent signal is NEVER silently treated as false.
function tri(value) {
  return value === true ? true : value === false ? false : null;
}

// Human-legible label for a control determination, including the two legible partial
// states the business requires (installed-but-sale-open; sale-closed-but-not-installed).
export function describeInventoryControl(result) {
  if (!result || typeof result !== "object") return "Unknown";
  switch (result.state) {
    case "EXITED":
      return "Inventory control ended (installed and sale closed)";
    case "NOT_STARTED":
      return "Not under Taylor inventory control";
    case "CONTROLLED": {
      const open = result.unmetConditions || [];
      const saleOpen = open.includes(EXIT_CONDITIONS.SALE_OPEN);
      const notInstalled = open.includes(EXIT_CONDITIONS.INSTALLATION_INCOMPLETE);
      if (saleOpen && notInstalled) return "Under Taylor inventory control (not installed, sale open)";
      if (saleOpen) return "Under Taylor inventory control (installed, sale open)";
      if (notInstalled) return "Under Taylor inventory control (sale closed, not installed)";
      return "Under Taylor inventory control";
    }
    default:
      return "Unknown";
  }
}

// The projection. `controlBegan` / `installationComplete` / `saleClosed` are DERIVED
// boolean signals (true/false/unknown). `context` carries display-only, non-authoritative
// flags (allocated/delivered/invoiced) that this projection PROVES cannot end control:
// they are echoed for UX but never consulted for the exit decision.
//
// Returns a frozen determination:
//   { state, unmetConditions[], began, installationComplete, saleClosed, context }
export function computeInventoryControl(input) {
  // Fail closed on a malformed call (null/non-object arg or null context) — never throw. This
  // must match the trusted-read mirror's optional-chaining behavior byte-for-decision.
  const src = input && typeof input === "object" ? input : {};
  const ctx = src.context && typeof src.context === "object" ? src.context : {};
  const began = tri(src.controlBegan);
  const installed = tri(src.installationComplete);
  const closed = tri(src.saleClosed);

  // Display-only context — normalized, never authoritative over the exit decision.
  const echoedContext = Object.freeze({
    allocated: tri(ctx.allocated),
    delivered: tri(ctx.delivered),
    invoiced: tri(ctx.invoiced),
  });

  const base = { began, installationComplete: installed, saleClosed: closed, context: echoedContext };

  // Fail closed: if we cannot even establish whether control began, we know nothing.
  if (began === null) {
    return Object.freeze({ state: "UNKNOWN", unmetConditions: [], ...base });
  }
  // No receipt into Taylor control ⇒ this machine has no Taylor inventory-control phase.
  if (began === false) {
    return Object.freeze({ state: "NOT_STARTED", unmetConditions: [], ...base });
  }
  // Control began. Both exit conditions must be KNOWN to assert an exit; an unknown
  // condition can never complete an exit (fail closed to UNKNOWN).
  if (installed === null || closed === null) {
    return Object.freeze({ state: "UNKNOWN", unmetConditions: [], ...base });
  }
  // The two-condition rule — the whole point. EXIT requires BOTH; anything else is
  // still CONTROLLED, with the specific unmet condition(s) surfaced.
  const unmet = [];
  if (installed !== true) unmet.push(EXIT_CONDITIONS.INSTALLATION_INCOMPLETE);
  if (closed !== true) unmet.push(EXIT_CONDITIONS.SALE_OPEN);
  if (unmet.length === 0) {
    return Object.freeze({ state: "EXITED", unmetConditions: [], ...base });
  }
  return Object.freeze({ state: "CONTROLLED", unmetConditions: Object.freeze(unmet), ...base });
}

// OWNERSHIP GUARD (INV-4 / baseline §6): title is a SEPARATE axis. Ownership is NEVER
// inferred from inventory-control state, and control is never inferred from ownership.
// This selector returns title ONLY from an explicitly injected title fact; absent that,
// it fails closed to UNKNOWN. It deliberately ignores the inventory-control determination.
export const OWNERSHIP = Object.freeze({ VENTANA: "VENTANA", TAYLOR: "TAYLOR", CUSTOMER: "CUSTOMER", UNKNOWN: "UNKNOWN" });

export function resolveOwnershipTitle({ explicitTitleHolder } = {}) {
  if (
    explicitTitleHolder === OWNERSHIP.VENTANA ||
    explicitTitleHolder === OWNERSHIP.TAYLOR ||
    explicitTitleHolder === OWNERSHIP.CUSTOMER
  ) {
    return explicitTitleHolder;
  }
  return OWNERSHIP.UNKNOWN; // no explicit title fact ⇒ unknown; never derived from control state
}

// Ventana-chain TITLE resolution (Owner rulings D-1 / D-2). Title is its OWN axis, independent of
// inventory control, custody, and installation. Ventana holds title until Taylor purchases (D-1:
// Taylor takes title on purchase/receipt under the normal purchase process — unlike the cross-
// franchise custody case); Taylor holds it until SUCCESSFUL DELIVERY/ACCEPTANCE to the customer
// (D-2: customer title at delivery/acceptance — NOT at installation-complete and NOT at sale-close).
// Pure; never reads inventory-control state. Fail-closed to UNKNOWN when the facts are absent.
export function resolveVentanaChainTitle({ purchasedFromVentana, deliveredAndAccepted } = {}) {
  if (deliveredAndAccepted === true) return OWNERSHIP.CUSTOMER;
  if (purchasedFromVentana === true) return OWNERSHIP.TAYLOR;
  if (purchasedFromVentana === false) return OWNERSHIP.VENTANA;
  return OWNERSHIP.UNKNOWN;
}

// Disposition on cancellation or damage (Owner ruling D-7). A committed machine whose sale cancels
// or whose condition is compromised is NEVER auto-returned to available inventory — it requires an
// explicit disposition decision (return to stock, return to Ventana, reallocate, scrap/claim) with a
// reason + audit trail. This returns the fail-closed default: HOLD / disposition-required.
export const DISPOSITION = Object.freeze({ DISPOSITION_REQUIRED: "DISPOSITION_REQUIRED", NONE: "NONE" });

export function resolveCancelOrDamageDisposition({ saleCancelled, damaged } = {}) {
  if (saleCancelled === true || damaged === true) {
    return Object.freeze({ disposition: DISPOSITION.DISPOSITION_REQUIRED, autoReturnToAvailable: false, reasonRequired: true });
  }
  return Object.freeze({ disposition: DISPOSITION.NONE, autoReturnToAvailable: false, reasonRequired: false });
}

// AVAILABILITY GUARD (INV-2): a machine under inventory control that is committed to a
// sale is present-and-UNAVAILABLE. Availability is never derived from physical presence.
// A unit is presentable as freely-available inventory ONLY when it is explicitly available
// for assignment AND not committed to a sales order. Fail-closed to false.
export function isPresentableAsAvailable({ availableForAssignment, committedToSalesOrder } = {}) {
  return availableForAssignment === true && committedToSalesOrder !== true;
}

// Order-level rollup for a coordinated multi-machine order (C713 × 5). `unitResults` are
// per-unit computeInventoryControl determinations for the units allocated to ONE order.
//
// NOT_STARTED units (e.g. Ventana drop-ship that never entered Taylor custody) were NEVER
// under Taylor inventory control, so they are OUTSIDE the exit denominator — never counted as
// controlled, and never able to strand the order. Order control EXITS when every unit that
// DID enter Taylor control has EXITED; if no unit ever entered control, the order is
// NOT_STARTED; a single still-controlled unit keeps the order CONTROLLED; any unknown unit
// fails the whole order closed to UNKNOWN.
export function rollupOrderInventoryControl(unitResults) {
  const units = Array.isArray(unitResults) ? unitResults.filter((u) => u && typeof u === "object") : [];
  const total = units.length;
  const counts = { UNKNOWN: 0, NOT_STARTED: 0, CONTROLLED: 0, EXITED: 0 };
  for (const u of units) counts[u.state] = (counts[u.state] || 0) + 1;

  const underControl = total - counts.NOT_STARTED; // units that entered Taylor control (den.)

  let state;
  if (total === 0) state = "UNKNOWN";
  else if (counts.UNKNOWN > 0) state = "UNKNOWN"; // any unknown unit ⇒ order unknown (fail closed)
  else if (underControl === 0) state = "NOT_STARTED"; // no unit ever entered Taylor control
  else if (counts.EXITED === underControl) state = "EXITED"; // every controlled unit exited
  else state = "CONTROLLED"; // ⇔ counts.CONTROLLED > 0

  return Object.freeze({
    state,
    total,
    underControl,
    exitedUnits: counts.EXITED,
    controlledUnits: counts.CONTROLLED, // genuinely under control — EXCLUDES NOT_STARTED
    notStartedUnits: counts.NOT_STARTED,
    counts: Object.freeze(counts),
  });
}
