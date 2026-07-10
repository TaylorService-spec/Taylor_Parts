// Phase 3 -- Platform Assignment Foundation (docs/specifications/
// employee-foundation.md). Permanent Firestore Rules emulator test for
// the employees/{employeeId} match block -- the first Firestore Rules
// test of any kind in this repo (no existing test framework/suite to
// extend, confirmed during PR 1). Deliberately zero new npm
// dependencies: uses only firebase-admin (already a functions/
// dependency, for emulator-side seeding/custom-token creation) and
// Node's built-in fetch (for exchanging tokens and hitting the
// Firestore/Auth emulator REST APIs directly) -- no
// @firebase/rules-unit-testing, no client `firebase` package, no test
// runner (jest/mocha/vitest).
//
// Prerequisite: run against a live Firestore + Auth emulator pair,
// e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/employeesRules.test.js
//
// This script is read/write only against the emulator (FIRESTORE_EMULATOR_HOST/
// FIREBASE_AUTH_EMULATOR_HOST below) -- it never touches the live
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

async function getEmployee(employeeId, idToken) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const res = await fetch(`${DOC_BASE}/employees/${employeeId}`, { headers });
  return res.status;
}

async function writeEmployee(employeeId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/employees/${employeeId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function runCompositeQuery(idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE.replace("/documents", "")}/documents:runQuery`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "employees" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "employmentStatus" }, op: "EQUAL", value: { stringValue: "ACTIVE" } } },
              { fieldFilter: { field: { fieldPath: "operationalRoles" }, op: "ARRAY_CONTAINS", value: { stringValue: "PARTS_ASSOCIATE" } } },
              { unaryFilter: { field: { fieldPath: "userId" }, op: "IS_NOT_NULL" } },
            ],
          },
        },
      },
    }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function seed() {
  await db.doc("employees/emp-directory-1").set({
    employeeId: "emp-directory-1",
    displayName: "Directory Test Employee",
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"],
    userId: "user-directory-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await db.doc("employees/emp-self-1").set({
    employeeId: "emp-self-1",
    displayName: "Self Read Test Employee",
    employmentStatus: "ACTIVE",
    operationalRoles: ["TECHNICIAN"],
    userId: "user-technician-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  await db.doc("users/user-admin-1").set({ role: "admin" });
  await db.doc("users/user-dispatcher-1").set({ role: "dispatcher" });
  await db.doc("users/user-technician-1").set({ role: "technician", employeeId: "emp-self-1" });
  await db.doc("users/user-no-link-1").set({ role: "technician" });
  await db.doc("users/user-mismatched-1").set({ role: "technician", employeeId: "emp-nonexistent" });
}

async function main() {
  await seed();

  const [adminToken, dispatcherToken, technicianToken, noLinkToken, mismatchedToken] = await Promise.all([
    idTokenFor("user-admin-1"),
    idTokenFor("user-dispatcher-1"),
    idTokenFor("user-technician-1"),
    idTokenFor("user-no-link-1"),
    idTokenFor("user-mismatched-1"),
  ]);

  // 1. Admin directory read succeeds.
  report("admin directory read succeeds", (await getEmployee("emp-directory-1", adminToken)) === 200);

  // 2. Dispatcher directory read succeeds.
  report("dispatcher directory read succeeds", (await getEmployee("emp-directory-1", dispatcherToken)) === 200);

  // 3. Technician self-read succeeds.
  report("technician self-read succeeds", (await getEmployee("emp-self-1", technicianToken)) === 200);

  // 4. Technician read of another Employee denied.
  report(
    "technician read of another Employee denied",
    (await getEmployee("emp-directory-1", technicianToken)) === 403
  );

  // 5. User with no employeeId denied every Employee read.
  report(
    "user with no employeeId denied Employee read",
    (await getEmployee("emp-directory-1", noLinkToken)) === 403 && (await getEmployee("emp-self-1", noLinkToken)) === 403
  );

  // 6. Mismatched User/Employee linkage denied.
  report(
    "mismatched User/Employee linkage denied",
    (await getEmployee("emp-directory-1", mismatchedToken)) === 403 &&
      (await getEmployee("emp-self-1", mismatchedToken)) === 403
  );

  // Unauthenticated read denied outright.
  report("unauthenticated read denied", (await getEmployee("emp-directory-1", null)) === 403);

  // No client, in any role including admin, may create/update/delete.
  report(
    "admin create/update denied",
    (await writeEmployee("emp-write-attempt", adminToken, {
      employmentStatus: { stringValue: "ACTIVE" },
    })) === 403
  );
  report(
    "dispatcher create/update denied",
    (await writeEmployee("emp-write-attempt-2", dispatcherToken, {
      employmentStatus: { stringValue: "ACTIVE" },
    })) === 403
  );

  // Composite-query index check (Section "Employee query service" --
  // employmentStatus == / operationalRoles array-contains / userId !=
  // null combined). A missing-index error surfaces as an explicit
  // FAILED_PRECONDITION with a create-index link in production; the
  // emulator does not enforce composite-index requirements the same
  // way, so a clean result here is necessary but not sufficient --
  // final confirmation still needs a real run against the live
  // Firestore console/production query planner before this is treated
  // as fully verified, per the specification's own caveat.
  const composite = await runCompositeQuery(adminToken);
  report(
    "composite query (employmentStatus + operationalRoles + userId!=null) runs without emulator-side error",
    composite.status === 200 && !composite.body?.error,
    JSON.stringify(composite.body).slice(0, 300)
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
