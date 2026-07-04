// Seed fixtures for the Inventory demo layer (Sprint 3.6). Local,
// in-memory only -- there is no Firestore "parts"/"inventory" collection
// backing any of this. Used by demo/InventoryContext.jsx to initialize
// state when DEMO_MODE is on (see demo/demoConfig.js).

export const LOW_STOCK_THRESHOLD = 5;

export const SEED_PARTS = [
  { id: "part-1", name: "Copper Pipe Fitting", unit: "ea" },
  { id: "part-2", name: "HVAC Filter (16x20)", unit: "ea" },
  { id: "part-3", name: "Refrigerant R-410A", unit: "lb" },
  { id: "part-4", name: "Circuit Board Relay", unit: "ea" },
  { id: "part-5", name: "PVC Coupling 1in", unit: "ea" },
];

export const SEED_WAREHOUSE_STOCK = {
  "part-1": 42,
  "part-2": 18,
  "part-3": 3,
  "part-4": 7,
  "part-5": 25,
};

export const SEED_TRUCK_STOCK = {
  "part-1": 6,
  "part-2": 4,
  "part-3": 1,
  "part-4": 2,
  "part-5": 8,
};
