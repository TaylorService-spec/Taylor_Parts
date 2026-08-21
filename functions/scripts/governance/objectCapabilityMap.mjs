// OBJECT -> CAPABILITY MAP. The single place business-intent CRUD becomes governed authority.
//
// ============================ WHY THIS FILE IS THE RISKY ONE ============================
//
// Every entry here silently grants real authority. A careless mapping is not a documentation error,
// it is an access-control change that no reviewer will see because it looks like a spreadsheet.
//
// Two mappings were WRONG in a first pass and are called out so they are not reintroduced:
//
//   "Equipment / Installed Base" -> equipment.model.manage
//       The installed base is the CUSTOMER'S assets. equipment.model.manage administers the MODEL
//       CATALOG -- a different object entirely. That mapping would have handed catalog administration
//       to technicians, parts associates and shop staff because their CRUD cell said "edit equipment".
//
//   "Inventory Adjustments" -> cycle-count capabilities
//       Counting and reconciling are two responsibilities that governance deliberately separates
//       (DECISIONS #111). Deriving them from one "adjustments" edit cell would collapse the
//       segregation of duties into a spreadsheet checkbox.
//
// AN EMPTY LIST IS AN HONEST ANSWER. Where no capability exists, the object is RULE_GOVERNED or
// UNMODELLED and maps to nothing. Inventing a capability to make a row look symmetrical would make
// the workbook tidier and the security model fictional.
export const GOVERNANCE_TYPE = Object.freeze({
  CAPABILITY_GOVERNED: "CAPABILITY_GOVERNED",
  RULE_GOVERNED: "RULE_GOVERNED",
  UNMODELLED: "UNMODELLED",
  FUTURE: "FUTURE",
});

// Objects whose authority lives in firestore.rules rather than a capability abstraction.
export const RULE_GOVERNED_OBJECTS = Object.freeze([
  "Contacts", "Customer Locations", "Equipment / Installed Base", "Notifications",
  "Technician Time / Non-work",
]);

// Objects the business expresses intent for that the platform does not model at all yet.
export const UNMODELLED_OBJECTS = Object.freeze(["Marketing Initiatives", "Commissions"]);

export const OBJECT_CAPABILITY_MAP = Object.freeze({
  "Accounts": { R: ["account.record.read"], C: ["account.record.create"], E: ["account.record.update"], D: [] },
  // CORRECTED: Contacts maps to NOTHING. crm.activity.* is ACTIVITY LOGGING -- calls, notes, touches
  // recorded against a customer. The contact RECORD is a different object, and it is Rules-governed.
  //
  // The earlier mapping treated them as the same thing, which would have granted crm.activity.read
  // and .create to nearly every role, because the matrix gives almost everyone Contacts R. That
  // silently overrides an explicit Owner ruling of 2026-08-19 confining crm.activity.* to
  // crmActivityContributor -- a governance decision reversed by a spreadsheet column.
  //
  // This is the THIRD mapping of this shape to be caught here: Installed Base -> model catalog,
  // Inventory Adjustments -> cycle counts, and now Contacts -> activity logging. The pattern is
  // always the same -- a business object mapped onto a capability that operates on something
  // RELATED BUT DIFFERENT. When no capability governs the object itself, the honest mapping is empty.
  "Contacts": { R: [], C: [], E: [], D: [] },
  "Customer Locations": { R: [], C: [], E: [], D: [] },
  "Opportunities": { R: ["opportunity.read"], C: ["opportunity.write", "opportunity.createSalesOrder"], E: ["opportunity.write"], D: [] },
  "Marketing Initiatives": { R: [], C: [], E: [], D: [] },
  "Sales Orders": { R: ["salesOrder.read"], C: ["salesOrder.write"], E: ["salesOrder.write"], D: [] },
  "Commissions": { R: [], C: [], E: [], D: [] },
  "Work Orders": { R: [], C: ["workOrder.create"], E: ["workOrder.transition"], D: ["workOrder.cancel"] },
  "Dispatch Schedule": { R: [], C: [], E: ["workOrder.transition"], D: [] },
  "Technician Time / Non-work": { R: [], C: [], E: [], D: [] },
  "Parts Catalog": { R: ["inventory.catalog.read"], C: ["inventory.catalog.manage"], E: ["inventory.catalog.manage"], D: [] },
  "Inventory Stock": { R: ["inventory.balance.read", "inventory.transaction.read"], C: [], E: [], D: [] },
  "Inventory Adjustments": { R: ["inventory.action.read"], C: [], E: [], D: [] },
  "Purchase Orders": { R: ["reorder.purchaseOrder.read"], C: ["reorder.purchaseOrder.create"], E: ["reorder.request.postPurchasingUpdate"], D: [] },
  "Receiving": { R: [], C: ["inventory.stock.receive"], E: ["inventory.stock.receive"], D: [] },
  "Transfer Orders": { R: ["warehouse.transferOrder.read"], C: [], E: [], D: [] },
  "Serialized Assets": { R: ["inventory.serializedAsset.read"], C: [], E: [], D: [] },
  "Equipment / Installed Base": { R: [], C: [], E: [], D: [] },
  "Invoices / AR": { R: ["finance.read"], C: ["finance.invoice.issue"], E: ["finance.adjustment.record"], D: [] },
  "Payments": { R: ["finance.read"], C: ["finance.payment.apply"], E: ["finance.refund.record"], D: [] },
  "Notifications": { R: [], C: [], E: [], D: [] },
  // SECURITY ADMINISTRATION IS NOT DERIVED FROM THE MATRIX. Owner decision 2026-08-21: General
  // Manager is the highest BUSINESS role and is not security administration. The workbook grants GM
  // CRED on Users and Roles/Permissions; that entry must not be interpreted literally, because doing
  // so creates a non-privileged role able to grant itself anything. Owner/Admin retain it.
  "Users": { R: [], C: [], E: [], D: [] },
  "Roles / Permissions": { R: [], C: [], E: [], D: [] },
  "Audit Log": { R: ["audit.event.read"], C: [], E: [], D: [] },
});

/** Governance type for an object, so every contract row can state how it is actually controlled. */
export function governanceTypeFor(object) {
  if (UNMODELLED_OBJECTS.includes(object)) return GOVERNANCE_TYPE.UNMODELLED;
  const m = OBJECT_CAPABILITY_MAP[object];
  const hasCap = m && [...m.R, ...m.C, ...m.E, ...(m.D || [])].length > 0;
  if (hasCap) return GOVERNANCE_TYPE.CAPABILITY_GOVERNED;
  if (RULE_GOVERNED_OBJECTS.includes(object)) return GOVERNANCE_TYPE.RULE_GOVERNED;
  return GOVERNANCE_TYPE.UNMODELLED;
}
