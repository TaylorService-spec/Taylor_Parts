// Issue #15 production-readiness closeout, part 2 -- Firestore Rules
// emulator test for the Work Order Engine v1.2 collections that were
// confirmed to have ZERO Rules Regression coverage
// (docs/deployment/issue-15-work-order-engine-deployment-manifest.md,
// section 2): fieldops_wos, counters, inventory_sync_status
// (firestore.rules:332-341, 363-366).
//
// Same zero-new-dependency posture as functions/test/employeesRules.test.js,
// functions/test/issue100WarehouseManagerRules.test.js, etc. (firebase-admin
// + Node's built-in fetch against the emulator REST APIs, no
// @firebase/rules-unit-testing, no test runner).
//
// Scope: unconditional-deny-all writes on all three collections (no
// admin/dispatcher exception -- these are Cloud-Function-only writes by
// design, see createWorkOrder.ts/transitionWorkOrder.ts/
// updateWorkOrderExecutionData.ts's own header comments), and
// fieldops_wos's role/ownership-scoped read (admin/dispatcher always,
// technician only for their own assignedTechId).
//
// Prerequisite: run against a live Firestore + Auth emulator pair, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/workOrderEngineRules.test.js
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

async function updateDocAt(collection, docId, idToken, fields, updateMaskFields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = updateMaskFields.map((f) => `updateMask.fieldPaths=${f}`).join("&");
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}?${mask}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function deleteDocAt(collection, docId, idToken) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, { method: "DELETE", headers });
  return res.status;
}

const now = Date.now();

async function seed() {
  await db.doc("users/user-admin-1").set({ role: "admin" });
  await db.doc("users/user-dispatcher-1").set({ role: "dispatcher" });
  await db.doc("users/user-tech-own-1").set({ role: "technician", technicianId: "tech-own-1" });
  await db.doc("users/user-tech-other-1").set({ role: "technician", technicianId: "tech-other-1" });
  await db.doc("users/user-no-role-1").set({});

  // Admin SDK writes -- bypasses Rules, exactly how the real Cloud
  // Functions (which also use the Admin SDK) would have created these.
  await db.doc("fieldops_wos/wo-1").set({
    woNumber: "WO-2026-000001",
    status: "DISPATCHED",
    assignedTechId: "tech-own-1",
    customerId: "cust-1",
    locationId: "loc-1",
    priority: 2,
    createdAt: now,
    updatedAt: now,
  });

  await db.doc("counters/work_orders_2026").set({ year: 2026, sequence: 1, updatedAt: now });

  await db.doc("inventory_sync_status/wo-1").set({ workOrderId: "wo-1", status: "PENDING", createdAt: now });
}

async function main() {
  await seed();

  const tokens = {};
  for (const uid of [
    "user-admin-1", "user-dispatcher-1", "user-tech-own-1", "user-tech-other-1", "user-no-role-1",
  ]) {
    tokens[uid] = await idTokenFor(uid);
  }

  // === fieldops_wos reads -- role/ownership-scoped ===

  report("admin reads fieldops_wos (any assignment)",
    (await getDocAt("fieldops_wos", "wo-1", tokens["user-admin-1"])) === 200);

  report("dispatcher reads fieldops_wos (any assignment)",
    (await getDocAt("fieldops_wos", "wo-1", tokens["user-dispatcher-1"])) === 200);

  report("technician assigned to this Work Order reads it",
    (await getDocAt("fieldops_wos", "wo-1", tokens["user-tech-own-1"])) === 200);

  report("technician NOT assigned to this Work Order is denied (ownership gate enforced)",
    (await getDocAt("fieldops_wos", "wo-1", tokens["user-tech-other-1"])) === 403);

  report("user with no role doc is denied fieldops_wos read",
    (await getDocAt("fieldops_wos", "wo-1", tokens["user-no-role-1"])) === 403);

  report("unauthenticated read of fieldops_wos is denied",
    (await getDocAt("fieldops_wos", "wo-1", undefined)) === 403);

  // === fieldops_wos writes -- unconditional deny-all, no admin exception ===

  report("admin denied CREATING fieldops_wos directly (Cloud-Function-only write path)",
    (await createDocAt("fieldops_wos", "wo-admin-create-attempt", tokens["user-admin-1"], {
      status: { stringValue: "CREATED" },
    })) === 403);

  report("admin denied UPDATING fieldops_wos directly, even an existing doc",
    (await updateDocAt("fieldops_wos", "wo-1", tokens["user-admin-1"], {
      status: { stringValue: "CANCELLED" },
    }, ["status"])) === 403);

  report("dispatcher denied CREATING fieldops_wos directly",
    (await createDocAt("fieldops_wos", "wo-dispatcher-create-attempt", tokens["user-dispatcher-1"], {
      status: { stringValue: "CREATED" },
    })) === 403);

  report("assigned technician denied UPDATING their own fieldops_wos directly (writes are Function-only)",
    (await updateDocAt("fieldops_wos", "wo-1", tokens["user-tech-own-1"], {
      status: { stringValue: "COMPLETED" },
    }, ["status"])) === 403);

  report("admin denied DELETING fieldops_wos",
    (await deleteDocAt("fieldops_wos", "wo-1", tokens["user-admin-1"])) === 403);

  // === counters -- fully closed, no read, no write, for anyone ===

  report("admin denied reading counters",
    (await getDocAt("counters", "work_orders_2026", tokens["user-admin-1"])) === 403);

  report("dispatcher denied reading counters",
    (await getDocAt("counters", "work_orders_2026", tokens["user-dispatcher-1"])) === 403);

  report("technician denied reading counters",
    (await getDocAt("counters", "work_orders_2026", tokens["user-tech-own-1"])) === 403);

  report("admin denied writing counters directly",
    (await updateDocAt("counters", "work_orders_2026", tokens["user-admin-1"], {
      sequence: { integerValue: "999" },
    }, ["sequence"])) === 403);

  report("admin denied creating a new counters doc directly",
    (await createDocAt("counters", "work_orders_2099", tokens["user-admin-1"], {
      year: { integerValue: "2099" },
    })) === 403);

  // === inventory_sync_status -- fully closed, no read, no write, for anyone ===

  report("admin denied reading inventory_sync_status",
    (await getDocAt("inventory_sync_status", "wo-1", tokens["user-admin-1"])) === 403);

  report("dispatcher denied reading inventory_sync_status",
    (await getDocAt("inventory_sync_status", "wo-1", tokens["user-dispatcher-1"])) === 403);

  report("assigned technician denied reading inventory_sync_status for their own Work Order",
    (await getDocAt("inventory_sync_status", "wo-1", tokens["user-tech-own-1"])) === 403);

  report("admin denied writing inventory_sync_status directly",
    (await updateDocAt("inventory_sync_status", "wo-1", tokens["user-admin-1"], {
      status: { stringValue: "COMPLETE" },
    }, ["status"])) === 403);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
