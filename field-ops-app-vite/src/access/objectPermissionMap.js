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
    C: ["account.record.create"], R: ["account.record.read"], E: ["account.record.update", "account.governedField.write"], D: [] },
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
  { object: "Dispatch Schedule", domain: "Service",
    C: [], R: ["fulfillment.coordinatedVisit.read"], E: [], D: [] },
  { object: "Technician Time / Non-work", domain: "Service", C: [], R: [], E: [], D: [] },
  { object: "Parts Catalog", domain: "Inventory",
    C: [], R: ["inventory.catalog.read"], E: ["inventory.catalog.manage", "inventory.catalog.activate"], D: [] },
  { object: "Inventory Stock", domain: "Inventory",
    C: [], R: ["inventory.transaction.read", "inventory.analytics.read"], E: ["inventory.stock.receive"], D: [] },
  { object: "Inventory Adjustments", domain: "Inventory",
    C: ["inventory.action.create", "inventory.cycleCount.create"], R: ["inventory.action.read"],
    E: ["inventory.cycleCount.submit", "inventory.cycleCount.reconcile", "inventory.cycleCount.cancel"], D: [] },
  { object: "Purchase Orders", domain: "Procurement",
    C: ["reorder.purchaseOrder.create"], R: ["reorder.purchaseOrder.read", "reorder.request.read.queue", "reorder.request.read.own"],
    E: ["reorder.purchaseOrder.void", "reorder.request.startPurchasing", "reorder.request.recordPurchaseOrder",
        "reorder.request.postPurchasingUpdate", "reorder.request.approve", "reorder.request.reject"], D: [] },
  { object: "Receiving", domain: "Inventory",
    C: [], R: [], E: ["inventory.stock.receive", "reorder.request.markReceived"], D: [] },
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
  { object: "Notifications", domain: "Platform",
    C: [], R: ["reorder.request.read.queue"], E: [], D: [] },
  { object: "Users", domain: "Administration",
    C: [], R: [], E: ["admin.userStatus.write", "admin.credentialReset.initiate"], D: [] },
  { object: "Roles / Permissions", domain: "Administration",
    C: [], R: [], E: ["admin.roleAssignment.write", "admin.accessRequest.decide"], D: [] },
  { object: "Audit Log", domain: "Administration",
    C: [], R: ["audit.event.read"], E: [], D: [] },
]);

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
