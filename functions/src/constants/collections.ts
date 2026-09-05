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

// Warehouse locations and physical movement. Admin-SDK-only, same posture as the ledger
// collections above -- no UI writes either directly.
//
// `warehouses` is the governed §3A eligibility record and the inventory custody parent.
// `transfer_orders` is the CURRENT Enterprise Inventory Transfer authority
// (functions/src/inventoryTransfer/*). It is NOT legacy, and must not be confused with the
// Epic-4 transfer service BIN-P2 retired, which happened to share the collection name.
//
// STOCK_LOCATIONS_COLLECTION was removed here by BIN-P2 (Decision #160 / ADR-014). It named a
// per-warehouse, per-part, per-bin quantity row that nothing in this repository ever wrote, and
// that diverged from the ledger in BOTH directions wherever it had been seeded. Physical on-hand
// comes from `inventory_transactions` (NONE) and `serialized_assets` (SERIAL). There is no second
// balance table, and adding one back would recreate exactly the divergence that retired this one.
export const WAREHOUSES_COLLECTION = "warehouses";
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

// Performance Goal Authority -- versioned, effective-dated, approved TARGETS. Admin-SDK-only, the
// same fail-closed posture as CRM_ACTIVITIES_COLLECTION above and for the same reason: firestore.rules
// has NO match block for this collection, and a collection no rule matches is DENIED to every client.
// The only write paths are the trusted commands in performance/performanceGoalCommands.ts.
//
// A document here holds a TARGET and never an ACTUAL. Nothing in this collection is computed from
// business records, nothing caches a measurement, and a goal is never updated in place -- a changed
// target is a NEW VERSION beside the old one, so a September target stays September's target after
// October's changes.
export const PERFORMANCE_GOALS_COLLECTION = "performance_goals";

// Email Connections + Inbound Work (base EOS email intake). Four Admin-SDK-only collections, the same
// fail-closed posture as CRM_ACTIVITIES_COLLECTION above and for the same reason: firestore.rules has NO
// match block for any of them, and a collection no rule matches is DENIED to every client, read and write.
// The only paths in or out are the trusted commands/reads in functions/src/inboundWork/*.
//
// `email_connections` is the EXTERNAL provider authorization (Microsoft 365 / Google Workspace) and holds
// NO mailbox password and no OAuth token value -- only the provider's status and the name of the secret a
// deployment binds (see emailProvider.ts).
// `email_mailboxes` is the OPERATIONAL mailbox configuration (Service / Warranty / Parts), separate from the
// connection because one connection commonly exposes several operational mailboxes.
// `email_routing_rules` is the small, ordered rule set that classifies an inbound message.
// `inbound_work_requests` is the operational intake record a Service reviewer accepts, declines or attaches.
export const EMAIL_CONNECTIONS_COLLECTION = "email_connections";
export const EMAIL_MAILBOXES_COLLECTION = "email_mailboxes";
export const EMAIL_ROUTING_RULES_COLLECTION = "email_routing_rules";
export const INBOUND_WORK_REQUESTS_COLLECTION = "inbound_work_requests";

// Real provider delivery (Email Connections phase 2). Two more Admin-SDK-only collections, the same
// fail-closed posture as the four above: no firestore.rules match block, so every client read and write is
// denied and the trusted transport is the only writer.
//
// `email_oauth_states` holds one short-lived, single-use authorization state per connect attempt -- the
// only thing tying a provider's redirect back to a request EOS actually made. Documents are keyed by the
// HASH of the state value, never the value, and carry the PKCE verifier that never leaves the server.
// `email_delivery_failures` is the retry and exception ledger for provider transport: what failed, how it
// was classified, how many attempts it has had, and when it may next be tried. It exists so that a failed
// delivery is a visible, retryable record rather than a log line nobody reads.
export const EMAIL_OAUTH_STATES_COLLECTION = "email_oauth_states";
export const EMAIL_DELIVERY_FAILURES_COLLECTION = "email_delivery_failures";
