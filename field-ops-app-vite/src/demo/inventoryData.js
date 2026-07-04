// Seed fixtures for the Inventory demo layer (Sprint 3.6). Local,
// in-memory only -- there is no Firestore "parts"/"inventory" collection
// backing any of this. Used by demo/InventoryContext.jsx to initialize
// state when DEMO_MODE is on (see demo/demoConfig.js).
//
// Part names double as their ids (no separate id/name mapping) so
// demo/heroConfig.js's HERO_JOB_PARTS_REQUIRED can reference them
// directly by name, and so this catalog lines up with the hero job's
// (Beacon Manufacturing, an HVAC no-power call) actual parts story.

export const LOW_STOCK_THRESHOLD = 5;

export const SEED_PARTS = [
  { id: "Compressor", name: "Compressor", unit: "ea" },
  { id: "Capacitor", name: "Capacitor", unit: "ea" },
  { id: "Filter Drier", name: "Filter Drier", unit: "ea" },
];

export const SEED_WAREHOUSE_STOCK = {
  Compressor: 6,
  Capacitor: 20,
  "Filter Drier": 15,
};

export const SEED_TRUCK_STOCK = {
  Compressor: 2,
  Capacitor: 8,
  "Filter Drier": 5,
};
