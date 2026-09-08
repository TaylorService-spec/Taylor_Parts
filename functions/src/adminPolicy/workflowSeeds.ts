// The first three workflow definitions — Parts/Purchasing, Work Order, Sales.
//
// ════════════════════ THESE DESCRIBE EXISTING BEHAVIOUR ════════════════════
//
// Every state, edge and role binding below was MEASURED from the code that runs today. Nothing here
// invents a transition, and nothing here activates one: a definition existing does not change how a
// record moves. The first job of these definitions is to be provably faithful to what the system
// already does, which is why the proofs compare them against the live tables rather than against
// this file's own intentions.
//
// Sources, exactly:
//   Parts/Purchasing  field-ops-app-vite/src/domain/constants.js REORDER_REQUEST_STATUS
//                     functions/src/reorderRequest/reorderCommands.ts
//   Work Order        field-ops-app-vite/src/domain/workOrderWorkflow.js
//                     mirroring functions/src/transitionEngine.ts (WORK_ORDER_TRANSITIONS,
//                     ACTION_TO_STATUS, ACTION_PERMISSIONS, ACTION_ALLOWED_FROM)
//   Sales             functions/src/opportunity/opportunityLifecycle.ts
//                     functions/src/salesAgreement/salesAgreementLifecycle.ts
//                     functions/src/salesOrder/salesOrderLifecycle.ts
//
// ════════════════════ SALES IS THREE WORKFLOWS, NOT ONE ════════════════════
//
// Measured, not assumed. Opportunity, Sales Agreement and Sales Order are three separate state
// machines over three separate records, chained by events rather than by transitions. Modelling
// them as one machine would have invented edges no code performs -- there is no transition from
// `WON` to `DRAFT`; a WON opportunity CREATES an agreement, which is a different thing.
//
// ════════════════════ ROLE BINDINGS ════════════════════
//
// The Work Order bindings are the legacy compatibility role strings the measured table uses
// (`admin`, `dispatcher`, `technician`), transcribed as Role KEYS. That is a faithful transcription
// of today, not an endorsement: retiring those strings is what the workflow Role binding exists to
// make possible, and it happens by editing DATA once these definitions are the authority.
//
// The Parts and Sales bindings are the operational/business Roles their capabilities already name.

export interface SeedStep {
  readonly key: string;
  readonly label: string;
  readonly initial?: boolean;
  readonly terminal?: boolean;
}

export interface SeedAction {
  readonly key: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly requiresOwnAssignment?: boolean;
  /** Role KEYS permitted to perform it. Resolved to role ids when the seed is applied. */
  readonly roleKeys: readonly string[];
}

export interface SeedWorkflow {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly objectKey: string | null;
  readonly steps: readonly SeedStep[];
  readonly actions: readonly SeedAction[];
}

// ════════════════════ 1. PARTS / PURCHASING ════════════════════
//
// Ten states. CANCELLED is reachable from any pre-ORDERED active status; VOIDED only from ORDERED,
// and voiding never touches the original purchase-order document -- an append-only void record is
// written instead. Both facts are measured from domain/constants.js's own comments and the cancel
// guard, not inferred from the names.
export const PARTS_PURCHASING_WORKFLOW: SeedWorkflow = Object.freeze({
  key: "partsPurchasing",
  name: "Parts / Purchasing",
  description:
    "The reorder request lifecycle, from a raised request through review, assignment, purchasing and receipt.",
  objectKey: "purchaseOrder",
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
    // The measured rule required the ASSIGNED associate specifically, not any associate.
    { key: "startPurchasing", label: "Start purchasing", from: "ASSIGNED_TO_PARTS_ASSOCIATE", to: "PURCHASING_IN_PROGRESS", requiresOwnAssignment: true, roleKeys: ["admin", "partsAssociate"] },
    { key: "recordPurchaseOrder", label: "Record purchase order", from: "PURCHASING_IN_PROGRESS", to: "ORDERED", roleKeys: ["admin", "partsAssociate", "partsManager"] },
    { key: "markReceived", label: "Mark received", from: "ORDERED", to: "RECEIVED", roleKeys: ["admin", "partsAssociate", "partsManager"] },
    { key: "voidPurchaseOrder", label: "Void purchase order", from: "ORDERED", to: "VOIDED", roleKeys: ["admin", "partsManager"] },
    { key: "cancelFromReady", label: "Cancel", from: "READY_FOR_PARTS_MANAGER", to: "CANCELLED", roleKeys: ["admin", "partsManager"] },
    { key: "cancelFromAssigned", label: "Cancel", from: "ASSIGNED_TO_PARTS_ASSOCIATE", to: "CANCELLED", roleKeys: ["admin", "partsManager"] },
    { key: "cancelFromPurchasing", label: "Cancel", from: "PURCHASING_IN_PROGRESS", to: "CANCELLED", roleKeys: ["admin", "partsManager"] },
  ]),
});

// ════════════════════ 2. TECHNICIAN / WORK ORDER ════════════════════
//
// Eleven states, eleven actions, transcribed edge for edge from WORK_ORDER_TRANSITIONS +
// ACTION_TO_STATUS. `Unschedule` (SCHEDULED -> READY_TO_DISPATCH) is the single reverse edge in the
// whole table.
//
// MarkReady and Unschedule both target READY_TO_DISPATCH, which is why the measured code needs
// ACTION_ALLOWED_FROM: the edge alone stopped identifying the action once the reverse edge existed.
// Here that is structural rather than a side table -- an action names its own `from`, so MarkReady
// simply is not available from SCHEDULED.
//
// The five technician actions carry `requiresOwnAssignment`, exactly as ACTION_PERMISSIONS does.
export const WORK_ORDER_WORKFLOW: SeedWorkflow = Object.freeze({
  key: "workOrder",
  name: "Technician / Work Order",
  description: "The work order lifecycle from creation through dispatch, technician execution and close.",
  objectKey: "workOrder",
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
    // Cancel is available from every non-terminal status in the measured table. One action per
    // origin, because an action names one `from` -- the same shape the Parts cancels take.
    { key: "CancelFromCreated", label: "Cancel", from: "CREATED", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
    { key: "CancelFromReady", label: "Cancel", from: "READY_TO_DISPATCH", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
    { key: "CancelFromScheduled", label: "Cancel", from: "SCHEDULED", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
    { key: "CancelFromDispatched", label: "Cancel", from: "DISPATCHED", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
    { key: "CancelFromAccepted", label: "Cancel", from: "ACCEPTED", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
    { key: "CancelFromEnRoute", label: "Cancel", from: "EN_ROUTE", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
    { key: "CancelFromArrived", label: "Cancel", from: "ARRIVED", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
    { key: "CancelFromWorkInProgress", label: "Cancel", from: "WORK_IN_PROGRESS", to: "CANCELLED", roleKeys: ["admin", "dispatcher"] },
  ]),
});

// ════════════════════ 3. SALES — THREE MACHINES ════════════════════

/**
 * Opportunity. Forward exactly one stage at a time; LOST from any open stage; WON only from
 * DECISION; a closed opportunity accepts nothing further. Measured from opportunityLifecycle.ts,
 * whose own comment states these constraints as deliberate and Owner-gated.
 */
export const OPPORTUNITY_WORKFLOW: SeedWorkflow = Object.freeze({
  key: "salesOpportunity",
  name: "Sales — Opportunity",
  description: "Pre-commitment sales lifecycle. Creates no inventory movement, work order or invoice.",
  objectKey: "opportunity",
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
    // LOST from ANY open stage -- one action per origin, as measured.
    { key: "loseFromIdentified", label: "Mark lost", from: "IDENTIFIED", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
    { key: "loseFromQualifying", label: "Mark lost", from: "QUALIFYING", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
    { key: "loseFromSolution", label: "Mark lost", from: "SOLUTION", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
    { key: "loseFromQuoting", label: "Mark lost", from: "QUOTING", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
    { key: "loseFromCustomerReview", label: "Mark lost", from: "CUSTOMER_REVIEW", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
    { key: "loseFromDecision", label: "Mark lost", from: "DECISION", to: "LOST", roleKeys: ["admin", "salesperson", "salesManager"] },
  ]),
});

/** Sales Agreement. DRAFT -> ACCEPTED | DECLINED, measured from salesAgreementLifecycle.ts. */
export const SALES_AGREEMENT_WORKFLOW: SeedWorkflow = Object.freeze({
  key: "salesAgreement",
  name: "Sales — Agreement",
  description: "The quote / agreement a customer accepts or declines.",
  objectKey: "salesAgreement",
  steps: Object.freeze([
    { key: "DRAFT", label: "Draft", initial: true },
    { key: "ACCEPTED", label: "Accepted", terminal: true },
    { key: "DECLINED", label: "Declined", terminal: true },
  ]),
  actions: Object.freeze([
    { key: "accept", label: "Record customer acceptance", from: "DRAFT", to: "ACCEPTED", roleKeys: ["admin", "salesperson", "salesManager"] },
    { key: "decline", label: "Record customer decline", from: "DRAFT", to: "DECLINED", roleKeys: ["admin", "salesperson", "salesManager"] },
  ]),
});

/** Sales Order. Measured from salesOrderLifecycle.ts's SALES_ORDER_STATES. */
export const SALES_ORDER_WORKFLOW: SeedWorkflow = Object.freeze({
  key: "salesOrder",
  name: "Sales — Order",
  description: "The committed order, from confirmation through fulfilment to close.",
  objectKey: "salesOrder",
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
});

/** The seeds, in the order the reconciliation document lists them. */
export const SEED_WORKFLOWS: readonly SeedWorkflow[] = Object.freeze([
  PARTS_PURCHASING_WORKFLOW,
  WORK_ORDER_WORKFLOW,
  OPPORTUNITY_WORKFLOW,
  SALES_AGREEMENT_WORKFLOW,
  SALES_ORDER_WORKFLOW,
]);

/** Every Role key any seed binds. The seed applier needs these Roles to exist first. */
export const SEED_ROLE_KEYS: readonly string[] = Object.freeze([
  ...new Set(SEED_WORKFLOWS.flatMap((w) => w.actions.flatMap((a) => a.roleKeys))),
]);
