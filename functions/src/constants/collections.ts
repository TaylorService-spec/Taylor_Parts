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
