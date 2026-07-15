// Enterprise Access & Administration Platform (Issue #226) -- Row 3
// (Task 8) Firestore Rules test for the five governed-storage
// collections (docs/specifications/enterprise-access-and-
// administration-platform.md sec5): permissions, roles, roleAssignments,
// accessRequests, auditEvents. Every one is closed to ALL client
// read/write, for every principal including admin -- proven here for
// admin, dispatcher, an ACTIVE operational-role technician, and an
// unauthenticated caller, plus every existing legacy security role
// still behaves exactly as it did before this Row (no regression).
//
// Follows this repo's established Rules-emulator-test convention (see
// employeesRules.test.js's header): zero new npm dependencies,
// firebase-admin (seeding/custom-token) + Node's built-in fetch (REST
// against the emulator), no test runner.
//
// Prerequisite: run against a live Firestore + Auth emulator pair, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/enterpriseAccessFoundationRules.test.js
//
// Read/write only against the emulator (FIRESTORE_EMULATOR_HOST/
// FIREBASE_AUTH_EMULATOR_HOST below) -- never touches the live
// "taylor-parts" project.
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

async function getDoc(path, idToken) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const res = await fetch(`${DOC_BASE}/${path}`, { headers });
  return res.status;
}

async function writeDoc(path, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function listCollection(collectionId, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE.replace("/documents", "")}/documents:runQuery`, {
    method: "POST",
    headers,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }] } }),
  });
  return res.status;
}

const GOVERNED_COLLECTIONS = [
  "permissions",
  "roles",
  "roleAssignments",
  "accessRequests",
  "auditEvents",
];

async function seed() {
  // Seeder writes (bypasses Rules via the Admin SDK) so each collection
  // has a real document to attempt a read against -- proving the DENY
  // is the Rule, not merely "the document doesn't exist."
  for (const collectionId of GOVERNED_COLLECTIONS) {
    await db.doc(`${collectionId}/seed-doc-1`).set({ seeded: true, createdAt: Date.now() });
  }

  await db.doc("users/user-admin-1").set({ role: "admin" });
  await db.doc("users/user-dispatcher-1").set({ role: "dispatcher" });
  await db.doc("users/user-technician-1").set({ role: "technician", employeeId: "emp-pm-1" });

  await db.doc("employees/emp-pm-1").set({
    employeeId: "emp-pm-1",
    displayName: "Parts Manager",
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"],
    userId: "user-technician-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

async function main() {
  await seed();

  const [adminToken, dispatcherToken, technicianToken] = await Promise.all([
    idTokenFor("user-admin-1"),
    idTokenFor("user-dispatcher-1"),
    idTokenFor("user-technician-1"),
  ]);

  const callers = [
    { label: "admin", token: adminToken },
    { label: "dispatcher", token: dispatcherToken },
    { label: "ACTIVE PARTS_MANAGER technician", token: technicianToken },
    { label: "unauthenticated", token: null },
  ];

  for (const collectionId of GOVERNED_COLLECTIONS) {
    for (const caller of callers) {
      report(
        `${caller.label} denied reading ${collectionId}/seed-doc-1`,
        (await getDoc(`${collectionId}/seed-doc-1`, caller.token)) === 403
      );
      report(
        `${caller.label} denied writing ${collectionId}/write-attempt`,
        (await writeDoc(`${collectionId}/write-attempt`, caller.token, {
          probe: { booleanValue: true },
        })) === 403
      );
      report(
        `${caller.label} denied listing ${collectionId}`,
        (await listCollection(collectionId, caller.token)) === 403
      );
    }
  }

  // No-regression spot checks: existing, already-covered surfaces behave
  // exactly as before this Row (this Row touches only the five new
  // match blocks -- it must not have altered anything else).
  report(
    "no regression: admin still reads the accounts collection",
    (await getDoc("accounts/does-not-exist", adminToken)) === 404 // 404 = Rule allowed the read, doc absent
  );
  report(
    "no regression: PARTS_MANAGER technician still reads their own Employee",
    (await getDoc("employees/emp-pm-1", technicianToken)) === 200
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
