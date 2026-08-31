// Work Order Engine v1.2 -- Firestore collection names.
//
// Mirrored at field-ops-app-vite/src/domain/constants.js's
// WORK_ORDERS_COLLECTION / COUNTERS_COLLECTION (same string values).

export const WORK_ORDERS_COLLECTION = "fieldops_wos";
export const COUNTERS_COLLECTION = "counters";

// Epic 2D Inventory Trigger System (see docs/architecture/ADR-003).
// Both are Admin-SDK-only -- firestore.rules denies all direct client
// read/write for both, same posture as `counters` -- no UI reads
// either this epoch (see ADR-003's scope note).
export const INVENTORY_TRANSACTIONS_COLLECTION = "inventory_transactions";
export const INVENTORY_SYNC_STATUS_COLLECTION = "inventory_sync_status";

// Epic 4 Warehouse + Fulfillment System. Admin-SDK-only, same posture
// as the ledger collections above -- physical-reality layer, not a
// second source of truth, so no UI writes directly.
export const WAREHOUSES_COLLECTION = "warehouses";
export const STOCK_LOCATIONS_COLLECTION = "stock_locations";
export const TRANSFER_ORDERS_COLLECTION = "transfer_orders";

// Enterprise Inventory -- Cycle Count operating authority (functions/src/cycleCount/*). Admin-SDK-only,
// same posture as transfer_orders/receiving_orders above -- the trusted cycleCount command family is the
// only writer; no UI writes this collection directly.
export const CYCLE_COUNTS_COLLECTION = "cycle_counts";

// Epic 5 Procurement + Supplier Management System. Same Admin-SDK-only
// posture as the ledger/warehouse collections above -- fully internal,
// no external vendor integration, no client writes.
export const SUPPLIERS_COLLECTION = "suppliers";
export const SUPPLIER_CATALOG_COLLECTION = "supplier_catalog";
export const PURCHASE_ORDERS_COLLECTION = "purchase_orders";

// Sales Opportunity (Cycle 3) — governed pre-commitment commercial object. Admin-SDK-only, same posture as
// the ledger/warehouse collections above: firestore.rules denies ALL direct client read/write, and the only
// write path is the trusted opportunity command (opportunity/opportunityCallables.ts). No UI writes directly;
// the Cycle-2 workspace still reads a SYNTHETIC source until a governed read model is wired.
export const OPPORTUNITIES_COLLECTION = "opportunities";

// Sales Order (Cycle 4) — the committed commercial order that follows a WON Opportunity. Admin-SDK-only, same
// posture as the ledger/opportunities collections: firestore.rules denies ALL direct client read/write; the
// only write path is the trusted salesOrder command (salesOrder/salesOrderCallables.ts). No UI writes.
export const SALES_ORDERS_COLLECTION = "sales_orders";

// Commercial commitment -- the accepted terms and committed line prices a Sales Order is created
// FROM. Admin-SDK-only: both firestore.rules mirrors now carry an explicit deny-all match block
// for it (`allow read, write: if false`), so the only write path is the trusted salesAgreement
// commands. (An earlier revision of this comment predated that block and described the
// undeclared-collection default instead -- corrected with FIN-001's FIN-GAP-018 doc-drift sweep;
// the effective posture never changed, only which mechanism enforced it.)
export const SALES_AGREEMENTS_COLLECTION = "sales_agreements";
// Finance — governed invoices (Admin-SDK-only; deny-all client Rules). Sensitive/audited.
export const INVOICES_COLLECTION = "invoices";
// Finance — cash receipts (money received) + payment applications (how it is applied to invoices). Separate
// authorities so one payment may later apply across many invoices / leave unapplied balances. Admin-SDK-only.
export const PAYMENTS_COLLECTION = "payments";
export const PAYMENT_APPLICATIONS_COLLECTION = "payment_applications";
// Finance — explicit linked invoice adjustments (credit memo / debit charge / write-off). Admin-SDK-only.
export const INVOICE_ADJUSTMENTS_COLLECTION = "invoice_adjustments";
// Commercial Coverage & Territory (#15) -- durable coverage objects + effective-dated assignments. Admin-SDK-only.
export const SALES_TERRITORIES_COLLECTION = "sales_territories";
export const COMMERCIAL_COVERAGE_ASSIGNMENTS_COLLECTION = "commercial_coverage_assignments";
// Finance — refunds (money returned after payment). Distinct from credit/write-off; Admin-SDK-only.
export const REFUNDS_COLLECTION = "refunds";

// Serialized Asset registry (docs/specifications/serialized-asset-equipment-installation.md §D, ADR-010 +
// DECISIONS #59, Spec phase M.1). Persistent inventory identity for SERIAL-tracked Parts -- SEPARATE from
// ADR-006 Equipment (the installed/customer-serviceable record). Admin-SDK-only, same fail-closed posture
// as the ledger/warehouse collections above: firestore.rules has NO match block for this collection (default
// deny), and this phase writes NOTHING here -- read-only via the trusted getAvailableEquipment service
// (functions/src/serializedAsset/serializedAssetReadService.ts). The §H installation handoff command (a
// future, separately authorized phase gated on Transfer Orders) is the only anticipated write path.
export const SERIALIZED_ASSETS_COLLECTION = "serialized_assets";

// CRM Activity / Notes (Wave 7 extension PART 1.4) -- the SMALLEST domain-correct CRM interaction
// authority: an account-scoped, immutable-identity activity/note record (Sales Note / Call / Meeting /
// Relationship / General). Admin-SDK-only, same fail-closed posture as every other collection above --
// firestore.rules has NO match block for this collection (default deny), and the only write path is the
// trusted createCrmActivity command (functions/src/crmActivity/crmActivityCallables.ts). This record owns
// the CRM interaction ONLY -- it references Account/Contact/Opportunity/Sales Order by id and never
// restates their fields. It carries NO assignee/due date/completion/status workflow -- a dated follow-up /
// next-action is a SEPARATE, NOT-YET-authorized roadmap capability (Exception Ownership / Operational
// Accountability, PART 1.5); this is a deliberate SEAM, not an oversight.
export const CRM_ACTIVITIES_COLLECTION = "crm_activities";
