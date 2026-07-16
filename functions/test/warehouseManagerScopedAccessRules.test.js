// Issue #226 -- WAREHOUSE_MANAGER scoped warehouse access (docs/assessments/
// warehouse-manager-scoped-access.md, docs/specifications/
// warehouse-manager-scoped-access.md, docs/implementation-plans/
// warehouse-manager-scoped-access.md, Implementation Plan Row B). Firestore
// Rules emulator test for the three additive `isAssignedToWarehouse(...)`
// read arms on warehouses/stock_locations/transfer_orders. Same
// zero-new-dependency posture as functions/test/issue100WarehouseManagerRules.test.js
// and its siblings (firebase-admin + Node's built-in fetch against the
// emulator REST APIs, no @firebase/rules-unit-testing, no test runner).
//
// Explicitly does NOT probe (out of this PR's scope): inventory_actions/
// inventory_transactions (issue100WarehouseManagerRules.test.js's own
// scope, unchanged here), or any Epic 5 Procurement collection
// (purchase_orders/suppliers/supplier_catalog -- a separate, still-open
// gap, not touched by this Row).
//
// Prerequisite: run against a live Firestore + Auth emulator pair, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/warehouseManagerScopedAccessRules.test.js
//
// This script is read/write only against the emulator
// (FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST below) -- it never
// touches the live "taylor-parts" project.
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
const FIRESTORE_HOST = "http://127.0.0.1:8080";
const AUTH_HOST = "http://127.0.0.1:9099";
const DOC_BASE = `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`PASS -- ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL -- ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function idTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const body = await res.json();
  if (!body.idToken) throw new Error(`Failed to mint ID token for ${uid}: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function getDocAt(collection, docId, idToken) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, { headers });
  return res.status;
}

// Always PATCHes a never-before-used document ID, exercising `create`.
async function createDocAt(collection, docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

const now = Date.now();

async function seed() {
  // -- warehouses --
  await db.doc("warehouses/wh-main").set({ id: "wh-main", name: "Main", location: "Site A" });
  await db.doc("warehouses/wh-satellite").set({ id: "wh-satellite", name: "Satellite", location: "Site B" });
  await db.doc("warehouses/wh-other-1").set({ id: "wh-other-1", name: "Other 1", location: "Site C" });
  await db.doc("warehouses/wh-other-2").set({ id: "wh-other-2", name: "Other 2", location: "Site D" });

  // -- stock_locations --
  await db.doc("stock_locations/sl-main-1").set({
    id: "sl-main-1", warehouseId: "wh-main", partId: "part-1", quantity: 5, binCode: "A1", updatedAt: now,
  });
  await db.doc("stock_locations/sl-satellite-1").set({
    id: "sl-satellite-1", warehouseId: "wh-satellite", partId: "part-1", quantity: 3, binCode: "B1", updatedAt: now,
  });

  // -- transfer_orders --
  await db.doc("transfer_orders/to-main-to-satellite").set({
    id: "to-main-to-satellite", partId: "part-1", quantity: 2,
    fromWarehouseId: "wh-main", toWarehouseId: "wh-satellite", status: "PENDING", createdAt: now, updatedAt: now,
  });
  await db.doc("transfer_orders/to-other-other").set({
    id: "to-other-other", partId: "part-1", quantity: 1,
    fromWarehouseId: "wh-other-1", toWarehouseId: "wh-other-2", status: "PENDING", createdAt: now, updatedAt: now,
  });

  // -- Employees: reciprocally linked, ACTIVE, WAREHOUSE_MANAGER-eligible,
  // varying assignedWarehouseIds shapes --
  await db.doc("employees/emp-wm-scoped-1").set({
    employeeId: "emp-wm-scoped-1", displayName: "Scoped Manager One", employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: ["wh-main"],
    userId: "user-wm-scoped-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-wm-scoped-1").set({ role: "technician", employeeId: "emp-wm-scoped-1" });

  await db.doc("employees/emp-wm-scoped-2").set({
    employeeId: "emp-wm-scoped-2", displayName: "Scoped Manager Two", employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: ["wh-satellite"],
    userId: "user-wm-scoped-2", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-wm-scoped-2").set({ role: "technician", employeeId: "emp-wm-scoped-2" });

  // Eligible role, explicitly empty assignment -- denies every warehouse.
  await db.doc("employees/emp-wm-empty").set({
    employeeId: "emp-wm-empty", displayName: "Empty Assignment Manager", employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: [],
    userId: "user-wm-empty", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-wm-empty").set({ role: "technician", employeeId: "emp-wm-empty" });

  // Eligible role, assignedWarehouseIds field entirely absent (pre-Row-A
  // Employee record) -- must deny, never default to "all warehouses".
  await db.doc("employees/emp-wm-absent").set({
    employeeId: "emp-wm-absent", displayName: "No Assignment Field Manager", employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"],
    userId: "user-wm-absent", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-wm-absent").set({ role: "technician", employeeId: "emp-wm-absent" });

  // Eligible role, malformed assignedWarehouseIds (a string, not a list) --
  // `is list` check must fail closed, not throw/500.
  await db.doc("employees/emp-wm-malformed").set({
    employeeId: "emp-wm-malformed", displayName: "Malformed Assignment Manager", employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: "wh-main",
    userId: "user-wm-malformed", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-wm-malformed").set({ role: "technician", employeeId: "emp-wm-malformed" });

  // Inactive employment, otherwise WAREHOUSE_MANAGER-eligible and assigned.
  await db.doc("employees/emp-wm-inactive").set({
    employeeId: "emp-wm-inactive", displayName: "Inactive Manager", employmentStatus: "TERMINATED",
    operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: ["wh-main"],
    userId: "user-wm-inactive", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-wm-inactive").set({ role: "technician", employeeId: "emp-wm-inactive" });

  // Wrong operational role -- assignedWarehouseIds present (dead data) but
  // operationalRoles never contains WAREHOUSE_MANAGER. Role check must
  // deny regardless of the assignment list.
  await db.doc("employees/emp-pm-assigned").set({
    employeeId: "emp-pm-assigned", displayName: "Parts Manager With Dead Warehouse Data", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], assignedWarehouseIds: ["wh-main"],
    userId: "user-pm-assigned", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-pm-assigned").set({ role: "technician", employeeId: "emp-pm-assigned" });

  // Broken linkage: users/{uid}.employeeId points at an employees document
  // that is never created.
  await db.doc("users/user-broken-wh").set({ role: "technician", employeeId: "emp-broken-wh-does-not-exist" });

  await db.doc("users/user-admin-wh").set({ role: "admin" });
  await db.doc("users/user-dispatcher-wh").set({ role: "dispatcher" });
}

async function main() {
  await seed();

  const tokens = {};
  for (const uid of [
    "user-admin-wh", "user-dispatcher-wh",
    "user-wm-scoped-1", "user-wm-scoped-2", "user-wm-empty", "user-wm-absent",
    "user-wm-malformed", "user-wm-inactive", "user-pm-assigned", "user-broken-wh",
  ]) {
    tokens[uid] = await idTokenFor(uid);
  }

  // === Admin/dispatcher regression -- unconditional, unaffected by this Row ===

  report("admin still reads warehouses (regression, unaffected)",
    (await getDocAt("warehouses", "wh-satellite", tokens["user-admin-wh"])) === 200);
  report("dispatcher still reads warehouses (regression, unaffected)",
    (await getDocAt("warehouses", "wh-satellite", tokens["user-dispatcher-wh"])) === 200);
  report("admin still reads stock_locations (regression, unaffected)",
    (await getDocAt("stock_locations", "sl-satellite-1", tokens["user-admin-wh"])) === 200);
  report("admin still reads transfer_orders (regression, unaffected)",
    (await getDocAt("transfer_orders", "to-other-other", tokens["user-admin-wh"])) === 200);

  // === Scoped WAREHOUSE_MANAGER -- assigned warehouse is readable ===

  report("Scoped manager reads warehouses/wh-main (their assigned warehouse)",
    (await getDocAt("warehouses", "wh-main", tokens["user-wm-scoped-1"])) === 200);
  report("Scoped manager reads stock_locations for their assigned warehouse",
    (await getDocAt("stock_locations", "sl-main-1", tokens["user-wm-scoped-1"])) === 200);
  report("Scoped manager reads a transfer_order where their warehouse is the FROM endpoint",
    (await getDocAt("transfer_orders", "to-main-to-satellite", tokens["user-wm-scoped-1"])) === 200);
  report("A different scoped manager reads the SAME transfer_order via the TO endpoint",
    (await getDocAt("transfer_orders", "to-main-to-satellite", tokens["user-wm-scoped-2"])) === 200);

  // === Scoped WAREHOUSE_MANAGER -- unassigned warehouse stays denied ===

  report("Scoped manager denied warehouses/wh-satellite (not their assigned warehouse)",
    (await getDocAt("warehouses", "wh-satellite", tokens["user-wm-scoped-1"])) === 403);
  report("Scoped manager denied stock_locations for an unassigned warehouse",
    (await getDocAt("stock_locations", "sl-satellite-1", tokens["user-wm-scoped-1"])) === 403);
  report("Scoped manager denied a transfer_order touching neither of their assigned warehouses",
    (await getDocAt("transfer_orders", "to-other-other", tokens["user-wm-scoped-1"])) === 403);

  // === Fail-closed cases (Spec sec5) ===

  report("Empty assignedWarehouseIds denies every warehouse despite an eligible role",
    (await getDocAt("warehouses", "wh-main", tokens["user-wm-empty"])) === 403);
  report("Absent assignedWarehouseIds field denies every warehouse (never defaults to \"all\")",
    (await getDocAt("warehouses", "wh-main", tokens["user-wm-absent"])) === 403);
  report("Malformed (non-list) assignedWarehouseIds fails closed, not a 500",
    (await getDocAt("warehouses", "wh-main", tokens["user-wm-malformed"])) === 403);
  report("Inactive employment denies scoped access despite an otherwise-matching assignment",
    (await getDocAt("warehouses", "wh-main", tokens["user-wm-inactive"])) === 403);
  report("Non-WAREHOUSE_MANAGER role denies scoped access despite dead assignedWarehouseIds data",
    (await getDocAt("warehouses", "wh-main", tokens["user-pm-assigned"])) === 403);
  report("Broken-linkage technician denied scoped access",
    (await getDocAt("warehouses", "wh-main", tokens["user-broken-wh"])) === 403);

  // === Write posture unchanged -- still admin-SDK-only, no client write path ===

  report("Scoped manager still denied creating a warehouse (write posture unchanged)",
    (await createDocAt("warehouses", "wh-wm-create-attempt", tokens["user-wm-scoped-1"], {
      id: { stringValue: "wh-wm-create-attempt" }, name: { stringValue: "x" }, location: { stringValue: "x" },
    })) === 403);
  report("Admin still denied creating a warehouse (unconditional Admin-SDK-only posture, unaffected)",
    (await createDocAt("warehouses", "wh-admin-create-attempt", tokens["user-admin-wh"], {
      id: { stringValue: "wh-admin-create-attempt" }, name: { stringValue: "x" }, location: { stringValue: "x" },
    })) === 403);
  report("Scoped manager still denied creating a stock_location",
    (await createDocAt("stock_locations", "sl-wm-create-attempt", tokens["user-wm-scoped-1"], {
      id: { stringValue: "sl-wm-create-attempt" }, warehouseId: { stringValue: "wh-main" },
      partId: { stringValue: "part-1" }, quantity: { integerValue: "1" }, binCode: { stringValue: "x" },
    })) === 403);
  report("Scoped manager still denied creating a transfer_order",
    (await createDocAt("transfer_orders", "to-wm-create-attempt", tokens["user-wm-scoped-1"], {
      id: { stringValue: "to-wm-create-attempt" }, partId: { stringValue: "part-1" }, quantity: { integerValue: "1" },
      fromWarehouseId: { stringValue: "wh-main" }, toWarehouseId: { stringValue: "wh-satellite" },
      status: { stringValue: "PENDING" }, createdAt: { integerValue: String(now) }, updatedAt: { integerValue: String(now) },
    })) === 403);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
