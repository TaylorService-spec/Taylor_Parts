// CERT-FIN-02 -- the PURE view model behind Administration -> Company Setup -> Financial Policy.
//
// No React, no fetch, no clock. The screen renders what this returns and decides nothing on its own,
// which is what makes the honest states testable without mounting a component.
//
// ============================ WHY THE CLIENT MIRRORS THE VOCABULARY ============================
//
// The supported methods, the recognition points and their blocked reasons are duplicated here rather
// than imported from functions/, because no shared/monorepo tooling exists in this repo -- the same
// "duplicate and prove parity" convention every access/ mirror pair uses. A parity test diffs this
// file against the server's own module, so the screen can never offer a method the engine does not
// implement or hide a block the backend would enforce.
//
// ============================ THE LOCK IS NOT A UI STATE ============================
//
// `editable` below is a rendering hint. It is NOT the protection: the trusted command re-reads the
// stored status inside its transaction and refuses a locked profile regardless of what any client
// believed. This file exists so the screen tells the truth, not so it enforces it.

/** Costing methods for interchangeable inventory. Mirror of INVENTORY_COST_METHODS. */
export const INVENTORY_COST_METHODS = Object.freeze([
  Object.freeze({ id: "WEIGHTED_AVERAGE", label: "Weighted average", description: "Every receipt updates one average unit cost for the part. Stock leaving carries that average." }),
  Object.freeze({ id: "FIFO", label: "FIFO", description: "Receipts form cost layers. The oldest layer is relieved first, at its own price." }),
]);

/** Costing methods for individually identifiable inventory. Mirror of SERIALIZED_COST_METHODS. */
export const SERIALIZED_COST_METHODS = Object.freeze([
  Object.freeze({ id: "SPECIFIC_IDENTIFICATION", label: "Specific identification", description: "Each unit carries the cost of the receipt that actually supplied it." }),
  Object.freeze({ id: "WEIGHTED_AVERAGE", label: "Weighted average", description: "Serialized units are pooled with the rest of the part's stock." }),
  Object.freeze({ id: "FIFO", label: "FIFO", description: "Serialized units are relieved oldest-first from the part's cost layers." }),
]);

/** Mirror of COGS_RECOGNITION_POINTS, including the blocked one and its reason. */
export const COGS_RECOGNITION_POINTS = Object.freeze([
  Object.freeze({
    id: "SALES_ORDER_FULFILLMENT",
    label: "Sales order fulfillment",
    description: "Cost is relieved when a sales order line is fulfilled to the customer.",
    available: true,
    blockedReason: null,
  }),
  Object.freeze({
    id: "INVOICE_ISSUE",
    label: "Invoice issue",
    description: "Cost is relieved when the invoice carrying the line is issued.",
    available: true,
    blockedReason: null,
  }),
  Object.freeze({
    id: "EQUIPMENT_INSTALL",
    label: "Equipment installation / acceptance",
    description: "For identifiable equipment: cost is relieved when the unit is installed and accepted at the customer site.",
    available: true,
    blockedReason: null,
  }),
  Object.freeze({
    id: "WORK_ORDER_CONSUMPTION",
    label: "Work order part consumption",
    description: "Cost is relieved when a technician consumes a part against a work order.",
    // Mirrors the backend, which DERIVES this from PHYSICAL_CONSUMPTION_ACTIVE in
    // functions/src/workOrderConsumption/consumptionActivation.ts. The consumption movement
    // authority is built and tested; it is inert behind one named boolean, and while that boolean is
    // false consumption does not remove physical stock. The parity test diffs this against the
    // backend's computed value, so flipping the gate cannot leave the screen lying.
    available: false,
    blockedReason:
      "Physical consumption is built but not active (CONSUMPTION_SOURCE_SELECTION_AUTHORITY_REQUIRED): a technician cannot yet name the inventory location stock was consumed from, so consumption does not remove physical stock. Recognizing cost here would relieve inventory the system still counts on the shelf.",
  }),
]);

/**
 * The rules a deployment CANNOT change. Rendered as statements, never as controls.
 *
 * A dropdown whose only other option is forbidden is not a choice; it is an invitation to ask for
 * the forbidden one. Mirror of PLATFORM_INVARIANTS.
 */
export const PLATFORM_INVARIANTS = Object.freeze([
  Object.freeze({ id: "UNKNOWN_NEVER_ZERO", statement: "An unknown cost stays unknown. EOS never substitutes $0." }),
  Object.freeze({ id: "HISTORY_IMMUTABLE", statement: "Recorded cost facts are never rewritten in place. A correction is a new, linked, auditable fact." }),
  Object.freeze({ id: "TRANSFER_CREATES_NO_COST", statement: "Moving stock between company locations changes custody, not cost. No internal movement manufactures an acquisition cost." }),
  Object.freeze({ id: "COMPANY_PARTITION", statement: "Cost never crosses an operating company boundary." }),
  Object.freeze({ id: "INTEGER_MINOR_UNITS", statement: "Money is exact integer minor units with an explicit currency. Never floating point." }),
  Object.freeze({ id: "FAIL_CLOSED_MARGIN", statement: "When required cost evidence is missing, EOS reports UNKNOWN rather than a number it cannot support." }),
  Object.freeze({ id: "NO_SILENT_RECALCULATION", statement: "Changing accounting policy never silently recalculates recognized history. That requires a governed migration." }),
]);

export const STATUS_COPY = Object.freeze({
  NOT_CONFIGURED: { label: "Not configured", tone: "attention", hint: "Required before financial authority can be activated for this company." },
  DRAFT: { label: "Draft", tone: "info", hint: "Being prepared with the accounting team. Not yet approved." },
  APPROVED: { label: "Approved", tone: "positive", hint: "Signed off by the accounting team. Locks when financial authority is activated." },
  LOCKED: { label: "Locked", tone: "neutral", hint: "Financial authority is active. Accounting policy is fixed." },
});

export const LOCKED_MESSAGE =
  "This financial policy is locked because financial authority is active. Changing accounting policy requires a governed financial-policy migration.";

export const VIEW_STATE = Object.freeze({
  UNGATED: "UNGATED",
  LOADING: "LOADING",
  FAILED: "FAILED",
  READY: "READY",
});

const label = (list, id) => list.find((x) => x.id === id)?.label ?? null;

/**
 * Build the screen's state.
 *
 * `profile === null` with a granted read is NOT_CONFIGURED -- a real, expected deployment state that
 * must not look like a failed read. A refused read is UNGATED and says so; the two are deliberately
 * distinguishable, because "you cannot see this" and "nothing is set up" call for different actions.
 */
export function buildFinancialPolicyView({
  canRead = false,
  canConfigure = false,
  loading = false,
  error = null,
  operatingCompanyId = null,
  operatingCompanyName = null,
  profile = null,
} = {}) {
  if (!canRead) {
    return {
      state: VIEW_STATE.UNGATED,
      capability: "financialPolicy.profile.read",
      editable: false,
      invariants: PLATFORM_INVARIANTS,
    };
  }
  if (loading) return { state: VIEW_STATE.LOADING, editable: false, invariants: PLATFORM_INVARIANTS };
  if (error) return { state: VIEW_STATE.FAILED, error, editable: false, invariants: PLATFORM_INVARIANTS };

  const status = profile === null ? "NOT_CONFIGURED" : profile.status;
  const locked = status === "LOCKED";

  return {
    state: VIEW_STATE.READY,
    operatingCompanyId,
    operatingCompanyName,
    status,
    statusCopy: STATUS_COPY[status] ?? STATUS_COPY.NOT_CONFIGURED,
    locked,
    // Editable requires BOTH the configure capability AND an unlocked profile. Neither alone.
    editable: canConfigure && !locked,
    lockedMessage: locked ? LOCKED_MESSAGE : null,
    // Why the controls are inert, when they are. Stated rather than left to be guessed at.
    readOnlyReason: locked
      ? LOCKED_MESSAGE
      : canConfigure
        ? null
        : "You can view this policy but not change it. Configuring a company's accounting policy is a deployment activity.",
    policy:
      profile === null
        ? null
        : {
            inventoryCostMethod: profile.inventoryCostMethod,
            inventoryCostMethodLabel: label(INVENTORY_COST_METHODS, profile.inventoryCostMethod),
            serializedInventoryCostMethod: profile.serializedInventoryCostMethod,
            serializedInventoryCostMethodLabel: label(SERIALIZED_COST_METHODS, profile.serializedInventoryCostMethod),
            cogsRecognitionPointId: profile.cogsRecognitionPointId,
            cogsRecognitionLabel: label(COGS_RECOGNITION_POINTS, profile.cogsRecognitionPointId),
            freightTreatment: profile.freightTreatment,
            landedCostTreatment: profile.landedCostTreatment,
          },
    approval: profile?.approval ?? null,
    inventoryCostMethods: INVENTORY_COST_METHODS,
    serializedCostMethods: SERIALIZED_COST_METHODS,
    // Blocked points are RETURNED, not filtered out: the screen shows them as unavailable with the
    // reason, because silently omitting one reads as "EOS does not do that" rather than "not yet".
    cogsRecognitionPoints: COGS_RECOGNITION_POINTS,
    invariants: PLATFORM_INVARIANTS,
  };
}

/** The compact read-only summary Financials shows. Never an editing surface. */
export function buildFinancialPolicySummary(view) {
  if (view?.state !== VIEW_STATE.READY) {
    return { available: false, state: view?.state ?? VIEW_STATE.UNGATED };
  }
  return {
    available: true,
    status: view.status,
    statusLabel: view.statusCopy.label,
    locked: view.locked,
    rows: Object.freeze([
      Object.freeze({ label: "Inventory costing", value: view.policy?.inventoryCostMethodLabel ?? "Not configured" }),
      Object.freeze({ label: "Serialized equipment", value: view.policy?.serializedInventoryCostMethodLabel ?? "Not configured" }),
      Object.freeze({ label: "COGS recognition", value: view.policy?.cogsRecognitionLabel ?? "Not configured" }),
      Object.freeze({ label: "Status", value: view.statusCopy.label }),
    ]),
  };
}
