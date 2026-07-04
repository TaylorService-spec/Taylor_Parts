// Sprint 3.6: demo-mode toggle. Scoped ONLY to the Inventory feature
// (Warehouse/Truck stock) -- that feature has no Firestore collection
// backing it at all, so there's no real data source for it to diverge
// from. Jobs/Technicians/Dispatch/Field Mode continue reading live
// Firestore via useFirestoreCollection exactly as before, completely
// unaffected by this flag: introducing a parallel seeded job list would
// break the single-source-of-truth rule this app enforces everywhere
// else (see docs/PROJECT_ARCHITECTURE.md).
//
// When true, the Inventory screen seeds Warehouse/Truck stock from
// demo/inventoryData.js's fixtures for a populated, shareable demo. When
// false, it starts empty (there is no Firestore inventory data to fall
// back to yet -- see docs/FUTURE_ARCHITECTURE_BACKLOG.md for a future
// sprint to back this with real persistence).
export const DEMO_MODE = true;
