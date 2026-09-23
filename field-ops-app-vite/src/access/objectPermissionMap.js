// BUSINESS OBJECT -> CAPABILITY IDS, per CRED verb.
//
// The Owner's CRUD matrix governs access as OBJECT x {Create, Read, Edit, Delete}. The
// permission catalog governs it as 110 fine-grained ids across ~40 technical verbs. Both
// are right for their audience, and neither can be derived from the other automatically --
// only a person can say that `salesOrder.fulfill` is an EDIT of a Sales Order. This module
// is that mapping, stated once.
//
// CRED == CRUD (Owner ruling 2026-08-20). "Edit" and "Update" are the same verb; the
// business says Edit, the catalog's action is `update`. Nothing here needs to reconcile
// them beyond saying so.
//
// WHY A SHARED MODULE. scripts/reconcileCrudMatrix.mjs was doing this mapping privately, so
// the Admin screen and the reconciliation report could have disagreed about what "Read on
// Accounts" means -- two answers to one question, which is this codebase's most-repeated
// defect. One table, both consumers.
//
// AN EMPTY ARRAY IS A REAL ANSWER. It means the catalog governs nothing for that verb, which
// is NOT the same as "the role wasn't granted it". A UI must show those differently or it
// tells someone to go ask for access that cannot be granted to anyone.

/** The four business verbs, in matrix order. */
export const VERBS = Object.freeze(["C", "R", "E", "D"]);

export const VERB_LABEL = Object.freeze({
  C: "Create",
  R: "Read",
  E: "Edit",
  D: "Delete",
});

// Objects in the CRUD matrix's own order, so the screen and the workbook read the same way.
export const OBJECT_PERMISSIONS = Object.freeze([
  { object: "Accounts", domain: "CRM",
    C: ["customer.record.create"], R: ["customer.record.read"], E: ["customer.record.update", "customer.governedField.write"], D: [] },
  { object: "Contacts", domain: "CRM", rulesOnly: "contacts", C: [], R: [], E: [], D: [] },
  { object: "Customer Locations", domain: "CRM", rulesOnly: "locations", C: [], R: [], E: [], D: [] },
  { object: "Opportunities", domain: "Sales",
    C: [], R: ["opportunity.read"], E: ["opportunity.write"], D: [] },
  { object: "Marketing Initiatives", domain: "Marketing", C: [], R: [], E: [], D: [] },
  { object: "Sales Orders", domain: "Sales",
    C: ["opportunity.createSalesOrder"], R: ["salesOrder.read"],
    E: ["salesOrder.write", "salesOrder.fulfill", "salesOrder.service"], D: [] },
  { object: "Commissions", domain: "Sales / Finance", C: [], R: [], E: [], D: [] },
  { object: "Work Orders", domain: "Service",
    C: ["workOrder.create"], R: [], E: ["workOrder.transition", "workOrder.cancel", "workOrder.parts.plan"], D: [] },
  // "Dispatch Schedule" REMOVED (Owner ruling 2026-09-23). It was a MATRIX_ONLY row describing a
  // data authority that does not exist: no table, no collection, no document, no field. There is no
  // Dispatch/Visit/WorkOrderGroup record in this platform -- THE SALES ORDER IS THE COORDINATOR --
  // so a CRED row for it advertised Read on a record nobody can read. Its one capability,
  // `fulfillment.coordinatedVisit.read`, survives and is governed under the Sales Order as the
  // BUSINESS_ACTION `readCoordinatedVisits` (migration 1761955200000). It is deliberately NOT added
  // to the Sales Orders R cell below: a named business act must not collapse into the Object's
  // generic Read verb, and this matrix has no verb for one.
  { object: "Technician Time / Non-work", domain: "Service", C: [], R: [], E: [], D: [] },
  { object: "Parts Catalog", domain: "Inventory",
    C: [], R: ["inventory.catalog.read"], E: ["inventory.catalog.manage", "inventory.catalog.activate"], D: [] },
  { object: "Inventory Stock", domain: "Inventory",
    C: [], R: ["inventory.transaction.read", "inventory.analytics.read"], E: ["inventory.stock.receive"], D: [] },
  // `inventory.action.create` REMOVED: it advertised a Create nothing can perform. Its only writer,
  // domain/inventoryActions.js `recordInventoryAction()`, throws unconditionally (Owner ruling
  // 2026-08-30) and the `.add()`-capable store handle was deleted with it. The catalog still carries
  // the id as active, so a grid that listed it told an administrator to request authority for an
  // operation with no code behind it. functions/scripts/governance/objectCapabilityMap.mjs already
  // recorded `C: []` here, so the two tables disagreed in the repository as shipped.
  { object: "Inventory Adjustments", domain: "Inventory",
    C: ["inventory.cycleCount.create"], R: ["inventory.action.read"],
    E: ["inventory.cycleCount.submit", "inventory.cycleCount.reconcile", "inventory.cycleCount.cancel"], D: [] },
  // REORDER REQUEST AND PURCHASE ORDER ARE SEPARATE OBJECTS (Owner ruling, 2026-09-08).
  //
  // This row used to hold BOTH records' authority: `reorder.request.read.queue`, `.read.own` and
  // six `reorder.request.*` transitions sat under Purchase Orders because that is where the legacy
  // matrix grouped them. One row over two canonical Objects meant an administrator granting
  // "Purchase Orders / Read" was silently also granting the reorder queue.
  //
  // Data authority now follows the record, and every business ACTION left for the workflow model --
  // which is why this row's Edit column is empty. Voiding a purchase order is a transition
  // (ORDERED -> VOIDED), not a field edit, and duplicating it as a CRED checkbox would give one
  // capability two homes.
  { object: "Purchase Orders", domain: "Procurement",
    C: ["reorder.purchaseOrder.create"], R: ["reorder.purchaseOrder.read"], E: [], D: [] },
  // The reorder request's own DATA authority. Its transitions -- approve, reject, assign, start
  // purchasing, post progress, record PO, mark received, cancel -- are Parts / Purchasing workflow
  // actions and appear in WORKFLOW_ACTION_CAPABILITIES below, never here.
  { object: "Reorder Requests", domain: "Procurement",
    C: ["reorder.request.create.manual", "reorder.request.create.system"],
    R: ["reorder.request.read.queue", "reorder.request.read.own"], E: [], D: [] },
  // `reorder.request.markReceived` MOVED OUT: it is the ORDERED -> RECEIVED transition, an action in
  // the Parts / Purchasing workflow. `inventory.stock.receive` stays -- it is the Receiving
  // command's own authority and is not part of the reorder family this ruling covers.
  { object: "Receiving", domain: "Inventory",
    C: [], R: [], E: ["inventory.stock.receive"], D: [] },
  { object: "Transfer Orders", domain: "Inventory",
    C: ["inventory.transfer.create"], R: ["warehouse.transferOrder.read"],
    E: ["inventory.transfer.dispatch", "inventory.transfer.receive", "inventory.transfer.cancel"], D: [] },
  { object: "Serialized Assets", domain: "Inventory",
    C: [], R: ["inventory.serializedAsset.read"], E: [], D: [] },
  { object: "Equipment / Installed Base", domain: "Service", rulesOnly: "equipment", C: [], R: [], E: [], D: [] },
  { object: "Invoices / AR", domain: "Finance",
    C: ["finance.invoice.issue"], R: ["finance.read"], E: ["finance.adjustment.record"], D: [] },
  { object: "Payments", domain: "Finance",
    C: ["finance.payment.apply"], R: ["finance.read"], E: ["finance.refund.record"], D: [] },
  // "Notifications" REMOVED (Owner ruling 2026-09-23). Also MATRIX_ONLY, also describing nothing:
  // no table, no collection, no document, no Rules block, and a nav entry that still says "not
  // built yet". It gets NO successor capability, by ruling. The bell surfaces Reorder Request
  // queues, and that visibility is already governed where it belongs -- `reorder.request.read.queue`
  // on the Reorder Request itself, untouched in its SUPERSEDED posture. Who may see a notification
  // is a property of the underlying record, never a Security Role.
  // "Employees", not "Users". This row governs the WORKFORCE record (entity key `employee`); the
  // security actor is the Principal, which is its own Object. Calling the workforce record "Users"
  // is the Principal/Employee conflation the platform removes everywhere else.
  { object: "Employees", domain: "Administration",
    C: [], R: [], E: ["admin.userStatus.write", "admin.credentialReset.initiate"], D: [] },
  { object: "Roles / Permissions", domain: "Administration",
    C: [], R: [], E: ["admin.roleAssignment.write", "admin.accessRequest.decide"], D: [] },
  { object: "Audit Log", domain: "Administration",
    C: [], R: ["audit.event.read"], E: [], D: [] },
]);

/**
 * CAPABILITIES THAT ARE WORKFLOW ACTIONS, NOT DATA PERMISSIONS.
 *
 * ════════════════════ WHY THIS LIST EXISTS ════════════════════
 *
 * Owner ruling (2026-09-08): a `reorder.request.*` capability representing a business action or
 * state transition is NOT an Object.Edit permission, and workflow actions must not be duplicated as
 * CRED checkboxes. The two authorities answer different questions:
 *
 *   Object / Field CRED   what DATA may I access or change?
 *   Workflow action       what business ACTION may I perform?
 *
 * Neither implies the other. Being allowed to Approve a reorder request does not confer Edit on its
 * fields, and holding Reorder Request / Edit does not permit Approve.
 *
 * So every id below is BANNED from the CRUD matrix above, and workflowActionsAlsoInCred() proves
 * it. Without the ban the same capability would appear in two places and an administrator would
 * have two contradictory ways to grant it.
 *
 * MEASURED, not assumed: each id is bound to a named action in the Parts / Purchasing workflow
 * definition (functions/src/adminPolicy/workflowSeeds.ts), and a test pins the two lists together.
 */
export const WORKFLOW_ACTION_CAPABILITIES = Object.freeze([
  "reorder.request.approve",
  "reorder.request.reject",
  "reorder.request.assign",
  "reorder.request.startPurchasing",
  "reorder.request.postPurchasingUpdate",
  "reorder.request.recordPurchaseOrder",
  "reorder.request.markReceived",
  "reorder.request.cancel",
  // A purchase order's own lifecycle action. Its measured behaviour is the ORDERED -> VOIDED
  // transition, which never touches the original purchase-order document -- an append-only void
  // record is written instead. That is a transition, not an edit.
  "reorder.purchaseOrder.void",
]);

/** Every capability id the CRUD matrix claims, across every object and verb. */
export function credCapabilityIds() {
  const ids = new Set();
  for (const entry of OBJECT_PERMISSIONS) {
    for (const verb of VERBS) for (const id of entry[verb] ?? []) ids.add(id);
  }
  return ids;
}

/** The ids that are in BOTH lists. Must always be empty; the tests assert it. */
export function workflowActionsAlsoInCred() {
  const cred = credCapabilityIds();
  return WORKFLOW_ACTION_CAPABILITIES.filter((id) => cred.has(id));
}

/**
 * What a role holds for one object/verb.
 *
 * Returns one of:
 *   "granted"        the role holds at least one capability for this verb
 *   "notGranted"     capabilities exist for this verb; the role holds none
 *   "noCapability"   nothing in the catalog governs this verb on this object
 *
 * The third state is why this returns a string rather than a boolean. A checkbox shows
 * true or false, and rendering "nobody can ever have this" as an unticked box invites
 * someone to go request access that cannot be granted to any role in the system.
 */
export function cellState(role, entry, verb) {
  const ids = entry[verb] ?? [];
  if (ids.length === 0) return "noCapability";
  const held = new Set(role?.permissions ?? []);
  return ids.some((id) => held.has(id)) ? "granted" : "notGranted";
}

/** The capability ids behind a cell, for the detail drawer. */
export function cellCapabilities(role, entry, verb) {
  const held = new Set(role?.permissions ?? []);
  return (entry[verb] ?? []).map((id) => ({ id, held: held.has(id) }));
}
