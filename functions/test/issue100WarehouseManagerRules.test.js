// Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md, PR 2a).
// Firestore Rules emulator test for PR 2a's scope only: the single
// additive WAREHOUSE_MANAGER read branch on inventory_actions. Same
// zero-new-dependency posture as functions/test/employeesRules.test.js,
// functions/test/reorderRequestsRules.test.js, and
// functions/test/issue100PartsManagerRules.test.js (firebase-admin +
// Node's built-in fetch against the emulator REST APIs, no
// @firebase/rules-unit-testing, no test runner).
//
// Explicitly does NOT probe (out of this PR's scope): any
// reorder_requests branch (PR 1a's own scope, unchanged here), the
// Assign-write branch (PR 3a's scope), or any
// reorder_purchase_orders/_voids grant (PR 3a's scope). Confirms only
// that PR 1a's shared inventory_transactions grant survives this PR's
// diff untouched, and that this PR does not accidentally widen
// inventory_actions to PARTS_MANAGER/PARTS_ASSOCIATE.
//
// Prerequisite: run against a live Firestore + Auth emulator pair, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/issue100WarehouseManagerRules.test.js
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
  // -- Employees: reciprocally linked, ACTIVE, one eligible role each --
  await db.doc("employees/emp-wm-1").set({
    employeeId: "emp-wm-1", displayName: "Warehouse Manager One", employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"], userId: "user-wm-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-wm-1").set({ role: "technician", employeeId: "emp-wm-1" });

  await db.doc("employees/emp-pm-1").set({
    employeeId: "emp-pm-1", displayName: "Parts Manager One", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], userId: "user-pm-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-pm-1").set({ role: "technician", employeeId: "emp-pm-1" });

  await db.doc("employees/emp-pa-1").set({
    employeeId: "emp-pa-1", displayName: "Parts Associate One", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"], userId: "user-pa-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-pa-1").set({ role: "technician", employeeId: "emp-pa-1" });

  // Ineligible: real reciprocal link, ACTIVE, zero eligible operationalRoles.
  await db.doc("employees/emp-ineligible-1").set({
    employeeId: "emp-ineligible-1", displayName: "Ineligible Technician", employmentStatus: "ACTIVE",
    operationalRoles: [], userId: "user-ineligible-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-ineligible-1").set({ role: "technician", employeeId: "emp-ineligible-1" });

  // Inactive employment, otherwise WAREHOUSE_MANAGER-eligible.
  await db.doc("employees/emp-inactive-1").set({
    employeeId: "emp-inactive-1", displayName: "Inactive Technician", employmentStatus: "TERMINATED",
    operationalRoles: ["WAREHOUSE_MANAGER"], userId: "user-inactive-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-inactive-1").set({ role: "technician", employeeId: "emp-inactive-1" });

  // Broken linkage: users/{uid}.employeeId points at an employees
  // document that is never created.
  await db.doc("users/user-broken-1").set({ role: "technician", employeeId: "emp-broken-does-not-exist" });

  await db.doc("users/user-admin-1").set({ role: "admin" });
  await db.doc("users/user-dispatcher-1").set({ role: "dispatcher" });

  // -- inventory_actions / inventory_transactions fixtures (Admin SDK,
  // bypasses Rules) --
  await db.doc("inventory_actions/action-1").set({
    partId: "part-1", type: "RECEIVE_STOCK", quantity: 5, actorUid: "user-admin-1", createdAt: now,
  });
  await db.doc("inventory_transactions/txn-1").set({
    partId: "part-1", type: "CONSUMPTION", quantity: -1, createdAt: now,
  });
}

async function main() {
  await seed();

  const tokens = {};
  for (const uid of [
    "user-admin-1", "user-dispatcher-1",
    "user-wm-1", "user-pm-1", "user-pa-1",
    "user-ineligible-1", "user-inactive-1", "user-broken-1",
  ]) {
    tokens[uid] = await idTokenFor(uid);
  }

  // === Allowed reads ===

  report("WAREHOUSE_MANAGER reads inventory_actions",
    (await getDocAt("inventory_actions", "action-1", tokens["user-wm-1"])) === 200);

  report("admin still reads inventory_actions (regression, unchanged)",
    (await getDocAt("inventory_actions", "action-1", tokens["user-admin-1"])) === 200);

  report("dispatcher still reads inventory_actions (regression, unchanged)",
    (await getDocAt("inventory_actions", "action-1", tokens["user-dispatcher-1"])) === 200);

  // === PR 1a's shared inventory_transactions grant survives this PR's diff ===

  report("PARTS_MANAGER still reads inventory_transactions (PR 1a's grant, unaffected by this PR)",
    (await getDocAt("inventory_transactions", "txn-1", tokens["user-pm-1"])) === 200);

  report("WAREHOUSE_MANAGER still reads inventory_transactions (PR 1a's grant, unaffected by this PR)",
    (await getDocAt("inventory_transactions", "txn-1", tokens["user-wm-1"])) === 200);

  // === Excluded capabilities -- this PR does NOT widen inventory_actions
  // to PARTS_MANAGER/PARTS_ASSOCIATE, nor grant any write ===

  report("PARTS_MANAGER still denied inventory_actions (no branch added for this role)",
    (await getDocAt("inventory_actions", "action-1", tokens["user-pm-1"])) === 403);

  report("PARTS_ASSOCIATE still denied inventory_actions (no branch added for this role)",
    (await getDocAt("inventory_actions", "action-1", tokens["user-pa-1"])) === 403);

  report("Ineligible technician denied inventory_actions",
    (await getDocAt("inventory_actions", "action-1", tokens["user-ineligible-1"])) === 403);

  report("WAREHOUSE_MANAGER denied creating inventory_actions (create remains admin/dispatcher-only)",
    (await createDocAt("inventory_actions", "action-wm-create-attempt", tokens["user-wm-1"], {
      partId: { stringValue: "part-1" },
      type: { stringValue: "RECEIVE_STOCK" },
      quantity: { integerValue: "1" },
      actorUid: { stringValue: "user-wm-1" },
      createdAt: { integerValue: String(now) },
    })) === 403);

  // === Broken / inactive linkage -- fail closed ===

  report("Broken-linkage technician denied inventory_actions",
    (await getDocAt("inventory_actions", "action-1", tokens["user-broken-1"])) === 403);

  report("Inactive-employment WAREHOUSE_MANAGER denied inventory_actions despite an otherwise-eligible role",
    (await getDocAt("inventory_actions", "action-1", tokens["user-inactive-1"])) === 403);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
