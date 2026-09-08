// Administration → Workflows — the PURE view model.
//
// ════════════════════ WHERE THE DEFINITIONS COME FROM ════════════════════
//
// These are the SAME five workflow families the policy seed writes
// (functions/src/adminPolicy/workflowSeeds.ts), measured from the code that runs today: the reorder
// status machine, the work-order transition table, and the three Sales lifecycles.
//
// They are MIRRORED here rather than imported, for the reason every other cross-package contract in
// this repository is mirrored -- functions/ and field-ops-app-vite/ are separate packages with no
// shared build. `adminWorkflowView.test.mjs` pins the two together by comparing this file's shapes
// against the seed's own, so a divergence fails rather than showing an administrator a workflow the
// platform would not seed.
//
// ════════════════════ WHAT THIS COMPUTES ════════════════════
//
// Presentation only: which actions leave a state, how many Roles are bound, whether a version is a
// draft. It decides no authorization and evaluates no transition -- the workflow ENGINE
// (functions/src/adminPolicy/workflowEngine.ts) does that, server-side, from stored state.

/** A state a record can occupy. `initial` is where instances start; `terminal` accepts no action. */
/** An action moves a record from exactly one state to one other, and names who may do it. */

export const SEED_WORKFLOW_FAMILIES = Object.freeze([
  Object.freeze({
    key: "partsPurchasing",
    name: "Parts / Purchasing",
    description:
      "The reorder request lifecycle, from a raised request through review, assignment, purchasing and receipt.",
    objectKey: "purchaseOrder",
    version: 1,
    status: "DRAFT",
    steps: Object.freeze([
      { key: "PENDING_REVIEW", label: "Pending review", initial: true },
      { key: "READY_FOR_PARTS_MANAGER", label: "Ready for Parts Manager" },
      { key: "ASSIGNED_TO_PARTS_ASSOCIATE", label: "Assigned to Parts Associate" },
      { key: "PURCHASING_IN_PROGRESS", label: "Purchasing in progress" },
      { key: "ORDERED", label: "Ordered" },
      { key: "RECEIVED", label: "Received", terminal: true },
      { key: "REJECTED", label: "Rejected", terminal: true },
      { key: "CANCELLED", label: "Cancelled", terminal: true },
      { key: "VOIDED", label: "Voided", terminal: true },
    ]),
    actions: Object.freeze([
      { key: "approve", label: "Approve", from: "PENDING_REVIEW", to: "READY_FOR_PARTS_MANAGER", roleKeys: ["admin", "dispatcher", "partsManager"] },
      { key: "reject", label: "Reject", from: "PENDING_REVIEW", to: "REJECTED", roleKeys: ["admin", "dispatcher", "partsManager"] },
      { key: "assign", label: "Assign", from: "READY_FOR_PARTS_MANAGER", to: "ASSIGNED_TO_PARTS_ASSOCIATE", roleKeys: ["admin", "partsManager"] },
      { key: "startPurchasing", label: "Start purchasing", from: "ASSIGNED_TO_PARTS_ASSOCIATE", to: "PURCHASING_IN_PROGRESS", requiresOwnAssignment: true, roleKeys: ["admin", "partsAssociate"] },
      { key: "recordPurchaseOrder", label: "Record purchase order", from: "PURCHASING_IN_PROGRESS", to: "ORDERED", roleKeys: ["admin", "partsAssociate", "partsManager"] },
      { key: "markReceived", label: "Mark received", from: "ORDERED", to: "RECEIVED", roleKeys: ["admin", "partsAssociate", "partsManager"] },
      { key: "voidPurchaseOrder", label: "Void purchase order", from: "ORDERED", to: "VOIDED", roleKeys: ["admin", "partsManager"] },
      { key: "cancelFromReady", label: "Cancel", from: "READY_FOR_PARTS_MANAGER", to: "CANCELLED", roleKeys: ["admin", "partsManager"] },
      { key: "cancelFromAssigned", label: "Cancel", from: "ASSIGNED_TO_PARTS_ASSOCIATE", to: "CANCELLED", roleKeys: ["admin", "partsManager"] },
      { key: "cancelFromPurchasing", label: "Cancel", from: "PURCHASING_IN_PROGRESS", to: "CANCELLED", roleKeys: ["admin", "partsManager"] },
    ]),
  }),

  Object.freeze({
    key: "workOrder",
    name: "Technician / Work Order",
    description: "The work order lifecycle from creation through dispatch, technician execution and close.",
    objectKey: "workOrder",
    version: 1,
    status: "DRAFT",
    steps: Object.freeze([
      { key: "CREATED", label: "Created", initial: true },
      { key: "READY_TO_DISPATCH", label: "Ready to dispatch" },
      { key: "SCHEDULED", label: "Scheduled" },
      { key: "DISPATCHED", label: "Dispatched" },
      { key: "ACCEPTED", label: "Accepted" },
      { key: "EN_ROUTE", label: "En route" },
      { key: "ARRIVED", label: "Arrived" },
      { key: "WORK_IN_PROGRESS", label: "Work in progress" },
      { key: "COMPLETED", label: "Completed" },
      { key: "CLOSED", label: "Closed", terminal: true },
      { key: "CANCELLED", label: "Cancelled", terminal: true },
    ]),
    actions: Object.freeze([
      { key: "MarkReady", label: "Mark ready", from: "CREATED", to: "READY_TO_DISPATCH", roleKeys: ["admin", "dispatcher"] },
      { key: "Schedule", label: "Schedule", from: "READY_TO_DISPATCH", to: "SCHEDULED", roleKeys: ["admin", "dispatcher"] },
      { key: "Unschedule", label: "Unschedule", from: "SCHEDULED", to: "READY_TO_DISPATCH", roleKeys: ["admin", "dispatcher"] },
      { key: "Dispatch", label: "Dispatch", from: "SCHEDULED", to: "DISPATCHED", roleKeys: ["admin", "dispatcher"] },
      { key: "Accept", label: "Accept", from: "DISPATCHED", to: "ACCEPTED", requiresOwnAssignment: true, roleKeys: ["technician"] },
      { key: "Travel", label: "Travel", from: "ACCEPTED", to: "EN_ROUTE", requiresOwnAssignment: true, roleKeys: ["technician"] },
      { key: "Arrive", label: "Arrive", from: "EN_ROUTE", to: "ARRIVED", requiresOwnAssignment: true, roleKeys: ["technician"] },
      { key: "WorkStart", label: "Start work", from: "ARRIVED", to: "WORK_IN_PROGRESS", requiresOwnAssignment: true, roleKeys: ["technician"] },
      { key: "Complete", label: "Complete", from: "WORK_IN_PROGRESS", to: "COMPLETED", requiresOwnAssignment: true, roleKeys: ["technician"] },
      { key: "Close", label: "Close", from: "COMPLETED", to: "CLOSED", roleKeys: ["admin", "dispatcher"] },
      { key: "CancelFromCreated", label: "Cancel", from: "CREATED", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
      { key: "CancelFromReady", label: "Cancel", from: "READY_TO_DISPATCH", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
      { key: "CancelFromScheduled", label: "Cancel", from: "SCHEDULED", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
      { key: "CancelFromDispatched", label: "Cancel", from: "DISPATCHED", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
      { key: "CancelFromAccepted", label: "Cancel", from: "ACCEPTED", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
      { key: "CancelFromEnRoute", label: "Cancel", from: "EN_ROUTE", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
      { key: "CancelFromArrived", label: "Cancel", from: "ARRIVED", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
      { key: "CancelFromWorkInProgress", label: "Cancel", from: "WORK_IN_PROGRESS", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
    ]),
  }),

  // ── SALES: THREE MACHINES, chained by events rather than transitions ──
  Object.freeze({
    key: "salesOpportunity",
    name: "Sales — Opportunity",
    description: "Pre-commitment sales lifecycle. Creates no inventory movement, work order or invoice.",
    objectKey: "opportunity",
    version: 1,
    status: "DRAFT",
    steps: Object.freeze([
      { key: "IDENTIFIED", label: "Identified", initial: true },
      { key: "QUALIFYING", label: "Qualifying" },
      { key: "SOLUTION", label: "Solution" },
      { key: "QUOTING", label: "Quoting" },
      { key: "CUSTOMER_REVIEW", label: "Customer review" },
      { key: "DECISION", label: "Decision" },
      { key: "WON", label: "Won", terminal: true },
      { key: "LOST", label: "Lost", terminal: true },
    ]),
    actions: Object.freeze([
      { key: "advanceToQualifying", label: "Advance to Qualifying", from: "IDENTIFIED", to: "QUALIFYING", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "advanceToSolution", label: "Advance to Solution", from: "QUALIFYING", to: "SOLUTION", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "advanceToQuoting", label: "Advance to Quoting", from: "SOLUTION", to: "QUOTING", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "advanceToCustomerReview", label: "Advance to Customer Review", from: "QUOTING", to: "CUSTOMER_REVIEW", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "advanceToDecision", label: "Advance to Decision", from: "CUSTOMER_REVIEW", to: "DECISION", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "win", label: "Mark won", from: "DECISION", to: "WON", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "loseFromIdentified", label: "Mark lost", from: "IDENTIFIED", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "loseFromQualifying", label: "Mark lost", from: "QUALIFYING", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "loseFromSolution", label: "Mark lost", from: "SOLUTION", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "loseFromQuoting", label: "Mark lost", from: "QUOTING", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "loseFromCustomerReview", label: "Mark lost", from: "CUSTOMER_REVIEW", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "loseFromDecision", label: "Mark lost", from: "DECISION", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
    ]),
  }),

  Object.freeze({
    key: "salesAgreement",
    name: "Sales — Agreement",
    description: "The quote / agreement a customer accepts or declines.",
    objectKey: "salesAgreement",
    version: 1,
    status: "DRAFT",
    steps: Object.freeze([
      { key: "DRAFT", label: "Draft", initial: true },
      { key: "ACCEPTED", label: "Accepted", terminal: true },
      { key: "DECLINED", label: "Declined", terminal: true },
    ]),
    actions: Object.freeze([
      { key: "accept", label: "Record customer acceptance", from: "DRAFT", to: "ACCEPTED", roleKeys: ["admin", "salesperson", "salesManager"] },
      { key: "decline", label: "Record customer decline", from: "DRAFT", to: "DECLINED", roleKeys: ["admin", "salesperson", "salesManager"] },
    ]),
  }),

  Object.freeze({
    key: "salesOrder",
    name: "Sales — Order",
    description: "The committed order, from confirmation through fulfilment to close.",
    objectKey: "salesOrder",
    version: 1,
    status: "DRAFT",
    steps: Object.freeze([
      { key: "CONFIRMED", label: "Confirmed", initial: true },
      { key: "IN_FULFILLMENT", label: "In fulfilment" },
      { key: "FULFILLED", label: "Fulfilled" },
      { key: "CLOSED", label: "Closed", terminal: true },
      { key: "CANCELLED", label: "Cancelled", terminal: true },
    ]),
    actions: Object.freeze([
      { key: "beginFulfillment", label: "Begin fulfilment", from: "CONFIRMED", to: "IN_FULFILLMENT", roleKeys: ["admin", "operationsManager", "salesManager"] },
      { key: "markFulfilled", label: "Mark fulfilled", from: "IN_FULFILLMENT", to: "FULFILLED", roleKeys: ["admin", "operationsManager"] },
      { key: "close", label: "Close", from: "FULFILLED", to: "CLOSED", roleKeys: ["admin", "operationsManager", "salesManager"] },
      { key: "cancelFromConfirmed", label: "Cancel", from: "CONFIRMED", to: "CANCELLED", roleKeys: ["admin", "salesManager"] },
      { key: "cancelFromFulfillment", label: "Cancel", from: "IN_FULFILLMENT", to: "CANCELLED", roleKeys: ["admin", "salesManager"] },
    ]),
  }),
]);

/**
 * One family's version, with each state told which actions leave it.
 *
 * The outgoing list is DERIVED from the actions rather than declared on the step, so a state and
 * its transitions cannot disagree -- the two would be one fact written twice.
 */
export function buildWorkflowVersionView(family) {
  if (!family) return null;
  const steps = (family.steps ?? []).map((step) => ({
    key: step.key,
    label: step.label,
    initial: step.initial === true,
    terminal: step.terminal === true,
    outgoing: (family.actions ?? [])
      .filter((a) => a.from === step.key)
      .map((a) => a.label),
  }));

  return Object.freeze({
    version: family.version,
    status: family.status,
    steps: Object.freeze(steps),
    actions: Object.freeze(
      (family.actions ?? []).map((a) =>
        Object.freeze({
          key: a.key,
          label: a.label,
          from: a.from,
          to: a.to,
          requiresOwnAssignment: a.requiresOwnAssignment === true,
          roleKeys: Object.freeze([...(a.roleKeys ?? [])]),
        }),
      ),
    ),
    bindingCount: (family.actions ?? []).reduce((n, a) => n + (a.roleKeys?.length ?? 0), 0),
  });
}

/** Counts for the family selector. */
export function summarizeWorkflowFamily(family) {
  return Object.freeze({
    key: family?.key ?? null,
    stepCount: family?.steps?.length ?? 0,
    actionCount: family?.actions?.length ?? 0,
    terminalCount: (family?.steps ?? []).filter((s) => s.terminal).length,
    // A published family would route records. None does yet, and the screen says so rather than
    // letting a reader assume from the absence of a badge.
    published: family?.status === "PUBLISHED",
  });
}

/** Every Role key any family binds — the set an administrator would need to exist. */
export const workflowBoundRoleKeys = () =>
  Object.freeze([
    ...new Set(SEED_WORKFLOW_FAMILIES.flatMap((f) => f.actions.flatMap((a) => a.roleKeys))),
  ].sort());
