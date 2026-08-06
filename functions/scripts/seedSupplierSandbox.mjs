// Supplier Master -- SANDBOX seed for the Owner Experience Review of Purchasing > Suppliers.
// Seeds a small, representative set of governed suppliers into the LOCAL EMULATOR so the workspace
// renders every state (ACTIVE / INACTIVE / a duplicate pair / a legacy "Ungoverned" doc). Pairs with
// the existing run-field-ops-app-vite harness (which seeds the admin/dispatcher sign-in accounts and
// demo data). Synthetic data only.
//
// FAIL-CLOSED: refuses to run unless FIRESTORE_EMULATOR_HOST is set -- it must NEVER touch production.
//
// Run (with the Firestore emulator up):
//   firebase emulators:exec --only firestore --project taylor-parts "node functions/scripts/seedSupplierSandbox.mjs"
// or against an already-running emulator:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node functions/scripts/seedSupplierSandbox.mjs

import admin from "firebase-admin";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("REFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set. This seed is emulator-only and must never touch production.");
  process.exit(1);
}

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const now = admin.firestore.Timestamp.now();

// Governed suppliers mirror the S2 createSupplier output shape (status ACTIVE/INACTIVE, version,
// normalizedKey, server-authored audit fields). "Northside" + "north side" are a deliberate
// AMBIGUOUS/duplicate pair; "legacy-vendor" is intentionally status-less to exercise the honest
// "Ungoverned" surface in the workspace.
const SUPPLIERS = [
  { id: "sup-acme", name: "Acme Industrial Supply", normalizedKey: "acme industrial supply", status: "ACTIVE", vendorNumber: "V-1001", email: "orders@acme.test", version: 1 },
  { id: "sup-globex", name: "Globex Parts Co", normalizedKey: "globex parts co", status: "ACTIVE", vendorNumber: "V-1002", phone: "555-0142", version: 1 },
  { id: "sup-initech", name: "Initech Fasteners", normalizedKey: "initech fasteners", status: "ACTIVE", contactName: "Pat Chen", version: 1 },
  { id: "sup-oldyard", name: "Old Yard Hydraulics", normalizedKey: "old yard hydraulics", status: "INACTIVE", vendorNumber: "V-0087", version: 2 },
  { id: "sup-northside-1", name: "Northside Bearings", normalizedKey: "northside bearings", status: "ACTIVE", vendorNumber: "V-1003", version: 1 },
  { id: "sup-northside-2", name: "North Side Bearings", normalizedKey: "northside bearings", status: "ACTIVE", vendorNumber: "V-1099", version: 1 },
  // Legacy Epic-5-shaped doc: NO governed status -> surfaces as "Ungoverned" in the workspace.
  { id: "sup-legacy", name: "Legacy Vendor (pre-governance)", contactEmail: "legacy@vendor.test", leadTimeDays: 10 },
];

const batch = db.batch();
for (const s of SUPPLIERS) {
  const doc = { ...s };
  if (doc.status) {
    doc.createdAt = now;
    doc.createdBy = "sandbox-seed";
    doc.updatedAt = now;
    doc.updatedBy = "sandbox-seed";
  }
  batch.set(db.collection("suppliers").doc(s.id), doc);
}
await batch.commit();

const active = SUPPLIERS.filter((s) => s.status === "ACTIVE").length;
const inactive = SUPPLIERS.filter((s) => s.status === "INACTIVE").length;
const ungoverned = SUPPLIERS.filter((s) => !s.status).length;
console.log(`Seeded ${SUPPLIERS.length} suppliers into the emulator: ${active} active, ${inactive} inactive, ${ungoverned} ungoverned (incl. one AMBIGUOUS active duplicate pair).`);
console.log("Open the app with ?emulator=1, sign in as the seeded admin/dispatcher, and go to Purchasing > Suppliers.");
