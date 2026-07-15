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

async function runUnconstrainedQuery(idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE.replace("/documents", "")}/documents:runQuery`, {
    method: "POST",
    headers,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "employees" }] } }),
  });
  return res.status;
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

  // Issue #100 (PR 1b dependency) -- PARTS_MANAGER assignment-candidate read.
  // Requester: an ACTIVE, reciprocally-linked PARTS_MANAGER (technician security
  // role). emp-directory-1 above is the positive candidate (ACTIVE +
  // PARTS_ASSOCIATE + userId). Three NON-candidates each violate exactly one leg
  // of the contract, and a separate PARTS_ASSOCIATE requester proves the branch
  // is PARTS_MANAGER-only.
  await db.doc("employees/emp-pm-1").set({
    employeeId: "emp-pm-1", displayName: "Parts Manager", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], userId: "user-pm-1", createdAt: Date.now(), updatedAt: Date.now(),
  });
  await db.doc("users/user-pm-1").set({ role: "technician", employeeId: "emp-pm-1" });

  await db.doc("employees/emp-assoc-1").set({
    employeeId: "emp-assoc-1", displayName: "Parts Associate", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"], userId: "user-assoc-1", createdAt: Date.now(), updatedAt: Date.now(),
  });
  await db.doc("users/user-assoc-1").set({ role: "technician", employeeId: "emp-assoc-1" });

  // Non-candidate: INACTIVE (fails employmentStatus).
  await db.doc("employees/emp-noncand-inactive").set({
    employeeId: "emp-noncand-inactive", displayName: "Inactive Associate", employmentStatus: "INACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"], userId: "user-noncand-inactive", createdAt: Date.now(), updatedAt: Date.now(),
  });
  // Non-candidate: ACTIVE but not PARTS_ASSOCIATE-eligible (fails operationalRoles).
  await db.doc("employees/emp-noncand-nonassoc").set({
    employeeId: "emp-noncand-nonassoc", displayName: "Warehouse Manager", employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"], userId: "user-noncand-nonassoc", createdAt: Date.now(), updatedAt: Date.now(),
  });
  // Non-candidate: ACTIVE + PARTS_ASSOCIATE but no linked user (fails userId!=null).
  await db.doc("employees/emp-noncand-nolink").set({
    employeeId: "emp-noncand-nolink", displayName: "Unlinked Associate", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"], createdAt: Date.now(), updatedAt: Date.now(),
  });
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

  // ===== Issue #100 (PR 1b dependency): PARTS_MANAGER assignment-candidate read =====
  const [pmToken, associateToken] = await Promise.all([idTokenFor("user-pm-1"), idTokenFor("user-assoc-1")]);

  // ALLOW: a PARTS_MANAGER reads a candidate Employee (ACTIVE + PARTS_ASSOCIATE + linked user).
  report("PARTS_MANAGER reads an assignment candidate (ACTIVE + PARTS_ASSOCIATE + linked)",
    (await getEmployee("emp-directory-1", pmToken)) === 200);

  // DENY: each non-candidate violates exactly one leg of the contract.
  report("PARTS_MANAGER denied a non-candidate: INACTIVE",
    (await getEmployee("emp-noncand-inactive", pmToken)) === 403);
  report("PARTS_MANAGER denied a non-candidate: not PARTS_ASSOCIATE-eligible",
    (await getEmployee("emp-noncand-nonassoc", pmToken)) === 403);
  report("PARTS_MANAGER denied a non-candidate: no linked user",
    (await getEmployee("emp-noncand-nolink", pmToken)) === 403);

  // DENY: a PARTS_MANAGER cannot read a non-candidate that is NOT a Parts Associate
  // (e.g. another PARTS_MANAGER, or the self-read technician fixture) -- proving this
  // is not general directory access.
  report("PARTS_MANAGER denied reading a non-PARTS_ASSOCIATE Employee (no general directory)",
    (await getEmployee("emp-self-1", pmToken)) === 403);

  // ALLOW: the exact candidate list query the picker issues is within the grant.
  const pmComposite = await runCompositeQuery(pmToken);
  report("PARTS_MANAGER candidate list query (the picker query) is allowed",
    pmComposite.status === 200 && !pmComposite.body?.error, JSON.stringify(pmComposite.body).slice(0, 200));

  // DENY: an unconstrained employees list (general directory) is refused for a PARTS_MANAGER.
  report("PARTS_MANAGER denied an unconstrained employees list (general directory)",
    (await runUnconstrainedQuery(pmToken)) === 403);

  // DENY: the branch is PARTS_MANAGER-only -- a PARTS_ASSOCIATE cannot read another candidate.
  report("PARTS_ASSOCIATE cannot read another candidate (branch is PARTS_MANAGER-only)",
    (await getEmployee("emp-directory-1", associateToken)) === 403);
  report("PARTS_ASSOCIATE candidate list query denied (branch is PARTS_MANAGER-only)",
    (await runCompositeQuery(associateToken)).status === 403);

  // Regression: a PARTS_MANAGER still reads their OWN Employee via the self-read clause.
  report("PARTS_MANAGER self-read still succeeds", (await getEmployee("emp-pm-1", pmToken)) === 200);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
