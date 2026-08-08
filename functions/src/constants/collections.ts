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
