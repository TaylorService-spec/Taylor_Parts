// One-off seed script for the Operations dashboard (Epics 2D/3/4/5).
// Populates a small, realistic dataset across all seven collections so
// the dashboard has something to show besides empty states. Uses the
// Admin SDK directly -- bypasses firestore.rules by design, same as
// any other admin-provisioned reference data in this codebase (see
// supplierService.ts's header comment on suppliers/supplier_catalog
// being "provisioned by an admin (console or Admin SDK), never by the
// client").
//
// INERT on import: only `require.main === module` (below) drives execution, and firebase-admin is required
// only inside buildProductionDeps() -- so importing this file (e.g. from a test) performs NO Firestore
// read/write and touches no project, sandbox or production.
//
// SAFETY -- X-TARGETING-GUARD (fail-closed, matches functions/scripts/seedSandboxBaseline.js):
// this used to `initializeApp({ projectId: "taylor-parts" })` -- production -- unconditionally at
// module load, with no flag, no confirmation, and no way to opt out; every `.set()` below writes at a
// fixed doc id, so a re-run would silently overwrite live production documents. `--projectId` is now
// REQUIRED, checked BEFORE firebase-admin is ever required or Firestore touched: `taylor-parts` is
// refused explicitly, and any other id must resolve in config/environments.json to a NON-production
// role (an unknown project id fails closed, same as an explicit production one). After init, the SDK's
// OWN resolved projectId is asserted to match the confirmed --projectId, so ambient credentials
// (GOOGLE_APPLICATION_CREDENTIALS / gcloud ADC / GCLOUD_PROJECT) cannot silently pick a different target.
//
// Run once, locally, against sandbox:
//   cd functions
//   node scripts/seedOperationsDemoData.js --projectId eos-platform-sandbox
// (uses Application Default Credentials -- `gcloud auth application-default login` first, or set
// GOOGLE_APPLICATION_CREDENTIALS to a sandbox service-account key.)
//
// Idempotent-ish: uses fixed doc ids so re-running overwrites the same
// seed docs rather than duplicating them.
"use strict";

const path = require("node:path");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    }
  }
  return out;
}

// Refuse any production target. The registry is the authority (ADR-011), so this cannot drift from the
// environment model -- and an unknown project fails closed rather than being treated as safe. Copied
// verbatim in shape from functions/scripts/seedSandboxBaseline.js's assertNonProductionTarget().
function assertNonProductionTarget(projectId, fsDeps) {
  if (!projectId || projectId === "true") {
    throw new Error("--projectId is required. There is no default target.");
  }
  if (projectId === "taylor-parts") {
    throw new Error("REFUSING: taylor-parts is the customer production project.");
  }
  const registryPath = path.resolve(__dirname, "../../config/environments.json");
  const registry = JSON.parse(fsDeps.readFileSync(registryPath, "utf8"));
  const env = registry.environments.find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) {
    throw new Error(
      `REFUSING: '${projectId}' is not a known provisioned environment in config/environments.json. ` +
        "Unknown projects fail closed.",
    );
  }
  if (env.role === "production") {
    throw new Error(`REFUSING: environment '${env.id}' has role 'production'.`);
  }
  return env;
}

// A handful of real SKUs from field-ops-app-vite/src/data/partsCatalog.ts
// (and its functions/src mirror) so getCatalogItem() resolves names
// correctly in the dashboard instead of falling back to a bare SKU.
const PART_A = "TST-1003"; // Freezer Cylinder - Compact, warehouseQty 20
const PART_B = "TST-1015"; // Condenser Fan Motor - HD, warehouseQty 4
const PART_C = "TST-1031"; // Freezer Cylinder - Pro Series, warehouseQty 0

async function seed(deps) {
  const { db, Timestamp } = deps;
  const batch = db.batch();
  const now = Timestamp.now();

  // Warehouses
  const whMain = db.collection("warehouses").doc("wh-main");
  const whSatellite = db.collection("warehouses").doc("wh-satellite");
  batch.set(whMain, { id: whMain.id, name: "Main Warehouse", location: "Dallas, TX" });
  batch.set(whSatellite, { id: whSatellite.id, name: "Satellite Depot", location: "Fort Worth, TX" });

  // Stock locations (bin-level)
  const stockLocs = [
    { id: "sl-1", warehouseId: whMain.id, partId: PART_A, binCode: "A1", quantity: 12 },
    { id: "sl-2", warehouseId: whSatellite.id, partId: PART_A, binCode: "B3", quantity: 3 },
    { id: "sl-3", warehouseId: whMain.id, partId: PART_B, binCode: "A2", quantity: 2 },
    { id: "sl-4", warehouseId: whMain.id, partId: PART_C, binCode: "A3", quantity: 0 },
  ];
  for (const loc of stockLocs) {
    batch.set(db.collection("stock_locations").doc(loc.id), { ...loc, updatedAt: now });
  }

  // Inventory ledger transactions (CONSUMED entries drive both the
  // Inventory Health forecast and the Warehouse reconciliation
  // comparison -- deliberately picked so PART_B shows up CRITICAL and
  // PART_A shows a reconciliation variance).
  const transactions = [
    { id: "tx-1", workOrderId: "seed-wo-1", partId: PART_A, type: "CONSUMED", quantity: 6 },
    { id: "tx-2", workOrderId: "seed-wo-2", partId: PART_B, type: "CONSUMED", quantity: 3 },
    { id: "tx-3", workOrderId: "seed-wo-3", partId: PART_B, type: "RESERVED", quantity: 1 },
  ];
  for (const tx of transactions) {
    batch.set(db.collection("inventory_transactions").doc(tx.id), {
      ...tx,
      timestamp: Timestamp.fromMillis(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
  }

  // Transfer order (in-flight, between the two seeded warehouses)
  batch.set(db.collection("transfer_orders").doc("to-1"), {
    id: "to-1",
    partId: PART_A,
    quantity: 5,
    fromWarehouseId: whMain.id,
    toWarehouseId: whSatellite.id,
    status: "IN_TRANSIT",
    createdAt: now,
    updatedAt: now,
  });

  // Suppliers + catalog
  const supA = db.collection("suppliers").doc("sup-a");
  const supB = db.collection("suppliers").doc("sup-b");
  batch.set(supA, { id: supA.id, name: "Acme Parts Co.", contactEmail: "orders@acmeparts.example", leadTimeDays: 5 });
  batch.set(supB, { id: supB.id, name: "Reliable Supply Inc.", contactEmail: "sales@reliablesupply.example", leadTimeDays: 10 });

  const catalogItems = [
    { id: "cat-1", supplierId: supA.id, partId: PART_A, unitPrice: 245.0, available: true },
    { id: "cat-2", supplierId: supB.id, partId: PART_A, unitPrice: 260.0, available: true },
    { id: "cat-3", supplierId: supA.id, partId: PART_B, unitPrice: 42.5, available: true },
    { id: "cat-4", supplierId: supB.id, partId: PART_C, unitPrice: 210.0, available: false },
  ];
  for (const item of catalogItems) {
    batch.set(db.collection("supplier_catalog").doc(item.id), item);
  }

  // One existing purchase order, already SENT
  batch.set(db.collection("purchase_orders").doc("po-1"), {
    id: "po-1",
    supplierId: supA.id,
    status: "SENT",
    items: [{ partId: PART_A, quantity: 10, unitPrice: 245.0 }],
    totalCost: 2450.0,
    createdAt: now,
    updatedAt: now,
  });

  await batch.commit();
  console.log("Seed complete.");
}

// Lazily build the real production deps -- firebase-admin is required ONLY here, never at import time.
function buildProductionDeps(projectId) {
  // eslint-disable-next-line global-require
  const { initializeApp, applicationDefault, getApps, getApp } = require("firebase-admin/app");
  // eslint-disable-next-line global-require
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
  const resolvedProjectId = getApp().options.projectId;
  if (resolvedProjectId !== projectId) {
    throw new Error(
      `firebase-admin resolved projectId '${resolvedProjectId}' does not match the confirmed --projectId ` +
        `'${projectId}': refusing to proceed (ambient credentials must not silently pick a different target)`,
    );
  }
  return { db: getFirestore(), Timestamp };
}

// Full entrypoint composition, extracted so tests can invoke the SAME argv -> parseArgs ->
// assertNonProductionTarget -> buildProductionDeps -> seed() chain a real run uses, and prove the
// environment guard rejects BEFORE buildProductionDeps() (and therefore before firebase-admin is ever
// required and before any Firestore connection, read, or write) runs.
async function main(argv, fsDeps) {
  const args = parseArgs(argv);
  const env = assertNonProductionTarget(args.projectId, fsDeps);
  console.log(`Seeding Operations demo data into '${env.id}' (${args.projectId}, role=${env.role})`);
  const deps = buildProductionDeps(args.projectId);
  return seed(deps);
}

module.exports = { parseArgs, assertNonProductionTarget, buildProductionDeps, seed, main };

if (require.main === module) {
  // eslint-disable-next-line global-require
  const fs = require("node:fs");
  main(process.argv.slice(2), fs).catch((err) => {
    console.error("Seed failed:", err && err.message ? err.message : err);
    process.exitCode = 1;
  });
}
