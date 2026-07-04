// Hero-story configuration for the shareable demo (Sprint 3.6 follow-up).
// Pure UI presentation, no data mutation. These names identify the demo
// seed content created via the app's own legitimate forms during Sprint
// 3.6 verification, so Dispatch/Field Mode/Inventory can spotlight one
// coherent walkthrough instead of an undifferentiated list.
//
// If this content doesn't exist in a given Firestore project (a fresh
// deploy, a different demo dataset), every isHero*() check below simply
// returns false and the UI falls back to its normal, unhighlighted
// rendering -- nothing breaks, nothing is required to exist.
export const HERO_IDS = {
  technician: "Alex Rivera",
  activeJob: "Beacon Manufacturing",
  completedJob: "Acme Cold Storage",
  truck: "Truck 12",
};

// The hero job's required parts. This is demo-layer-only, NOT a
// Firestore field -- Sprint 3.6's hard rule is no schema changes, so
// this never gets added to the real job document. It's a local lookup
// keyed by the hero job's customer name, matched against
// demo/inventoryData.js's SEED_PARTS names (parts use their name as
// their id, so these strings double as truck/warehouse stock keys too).
export const HERO_JOB_PARTS_REQUIRED = ["Compressor", "Capacitor", "Filter Drier"];

export function isHeroTechnician(name) {
  return name === HERO_IDS.technician;
}

export function isHeroActiveJob(customer) {
  return customer === HERO_IDS.activeJob;
}

export function isHeroCompletedJob(customer) {
  return customer === HERO_IDS.completedJob;
}
