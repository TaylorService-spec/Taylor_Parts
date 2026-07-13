// Account Commercial Profile -- PR 2 (docs/specifications/
// account-commercial-profile-and-financial-forecast-horizons.md,
// docs/implementation-plans/...). Firestore Rules emulator test for the
// `accounts` collection's two GOVERNED enum fields (paymentTerms/taxStatus):
// their enum-value validation AND the admin-only-edit authorization the
// Rules enforce (never UI hiding). Same zero-new-dependency posture as
// functions/test/employeesRules.test.js / reorderRequestsRules.test.js:
// firebase-admin (Admin SDK, bypasses Rules for seeding) + Node's built-in
// fetch against the emulator REST APIs, no @firebase/rules-unit-testing,
// no test runner.
//
// What this proves (the Implementation Plan's PR-2 Rules obligation):
//   - a NON-admin write of paymentTerms/taxStatus is DENIED;
//   - an admin write with a VALID enum is ALLOWED;
//   - an INVALID enum is DENIED (for everyone, including admin);
//   - existing admin/dispatcher permission on the REST of the accounts
//     document is NOT narrowed (a dispatcher may still edit other fields as
//     long as the two governed fields are unchanged).
//
// Prerequisite: run against a live Firestore + Auth emulator pair, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/accountsGovernedFieldsRules.test.js
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

// PATCH a never-before-used document ID with NO updateMask -> exercises the
// `create` rule (same convention as reorderRequestsRules.test.js's
// createReorderRequest()).
async function createAccount(docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/accounts/${docId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

// PATCH an EXISTING document with an explicit updateMask (only these field
// paths) -> exercises the `update` rule against a client-SDK-shaped partial
// write, the same "merged existing doc + these fields" semantics
// accountsStore.update() produces (domain/accounts.js).
async function updateAccount(docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = Object.keys(fields)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join("&");
  const res = await fetch(`${DOC_BASE}/accounts/${docId}?${mask}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });

// Minimal valid account payload for a create -- the accounts rules impose no
// key-shape schema (unlike reorder_requests), so name + timestamps suffice;
// individual tests add/override the governed fields.
function accountFields(overrides = {}) {
  return {
    name: str("Rules Test Account"),
    status: str("Active"),
    createdAt: int(Date.now()),
    updatedAt: int(Date.now()),
    ...overrides,
  };
}

// Seeds an accounts document directly via the Admin SDK (bypasses Rules) so
// update-rule tests start from an arbitrary, valid pre-existing governed
// state without depending on a create succeeding first.
async function seedAccount(docId, data) {
  await db.doc(`accounts/${docId}`).set({
    name: "Seeded Account",
    status: "Active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...data,
  });
}

async function seed() {
  await db.doc("users/user-admin-acct").set({ role: "admin" });
  await db.doc("users/user-dispatcher-acct").set({ role: "dispatcher" });
  await db.doc("users/user-technician-acct").set({ role: "technician" });
}

async function main() {
  await seed();

  const [adminToken, dispatcherToken, technicianToken] = await Promise.all([
    idTokenFor("user-admin-acct"),
    idTokenFor("user-dispatcher-acct"),
    idTokenFor("user-technician-acct"),
  ]);

  // ============ CREATE ============

  report(
    "admin CREATE with valid governed values (paymentTerms NET_30, taxStatus EXEMPT) accepted",
    (await createAccount("acct-create-admin-valid", adminToken,
      accountFields({ paymentTerms: str("NET_30"), taxStatus: str("EXEMPT") }))) === 200
  );
  report(
    "admin CREATE with an INVALID paymentTerms enum denied (validity enforced even for admin)",
    (await createAccount("acct-create-admin-bad-terms", adminToken,
      accountFields({ paymentTerms: str("NET_45") }))) === 403
  );
  report(
    "admin CREATE with an INVALID taxStatus enum denied",
    (await createAccount("acct-create-admin-bad-tax", adminToken,
      accountFields({ taxStatus: str("NONE") }))) === 403
  );
  report(
    "dispatcher CREATE at the governed baseline (no paymentTerms, no taxStatus) accepted",
    (await createAccount("acct-create-disp-baseline", dispatcherToken, accountFields())) === 200
  );
  report(
    "dispatcher CREATE with taxStatus explicitly UNKNOWN (the safe default) accepted -- baseline allows it",
    (await createAccount("acct-create-disp-unknown", dispatcherToken,
      accountFields({ taxStatus: str("UNKNOWN") }))) === 200
  );
  report(
    "dispatcher CREATE that SETS paymentTerms denied (governed field is admin-only)",
    (await createAccount("acct-create-disp-terms", dispatcherToken,
      accountFields({ paymentTerms: str("NET_30") }))) === 403
  );
  report(
    "dispatcher CREATE that SETS taxStatus to TAXABLE denied (governed field is admin-only)",
    (await createAccount("acct-create-disp-taxable", dispatcherToken,
      accountFields({ taxStatus: str("TAXABLE") }))) === 403
  );
  report(
    "technician CREATE denied (accounts remain admin/dispatcher-only overall)",
    (await createAccount("acct-create-technician", technicianToken, accountFields())) === 403
  );

  // ============ UPDATE ============
  // Baseline seeded doc already carries governed values (NET_30 / TAXABLE),
  // so a change is a genuine governed edit.

  await seedAccount("acct-update-admin-terms", { paymentTerms: "NET_30", taxStatus: "TAXABLE" });
  report(
    "admin UPDATE changing paymentTerms (NET_30 -> NET_60, valid) accepted",
    (await updateAccount("acct-update-admin-terms", adminToken, { paymentTerms: str("NET_60") })) === 200
  );

  await seedAccount("acct-update-admin-tax", { paymentTerms: "NET_30", taxStatus: "TAXABLE" });
  report(
    "admin UPDATE changing taxStatus (TAXABLE -> RESELLER, valid) accepted",
    (await updateAccount("acct-update-admin-tax", adminToken, { taxStatus: str("RESELLER") })) === 200
  );

  await seedAccount("acct-update-admin-bad", { paymentTerms: "NET_30", taxStatus: "TAXABLE" });
  report(
    "admin UPDATE to an INVALID paymentTerms enum denied",
    (await updateAccount("acct-update-admin-bad", adminToken, { paymentTerms: str("NET_45") })) === 403
  );
  report(
    "admin UPDATE to an INVALID taxStatus enum denied",
    (await updateAccount("acct-update-admin-bad", adminToken, { taxStatus: str("SORTA_EXEMPT") })) === 403
  );

  await seedAccount("acct-update-disp-terms", { paymentTerms: "NET_30", taxStatus: "TAXABLE" });
  report(
    "dispatcher UPDATE changing paymentTerms denied (admin-only, enforced at Rules layer)",
    (await updateAccount("acct-update-disp-terms", dispatcherToken, { paymentTerms: str("NET_60") })) === 403
  );

  await seedAccount("acct-update-disp-tax", { paymentTerms: "NET_30", taxStatus: "TAXABLE" });
  report(
    "dispatcher UPDATE changing taxStatus denied (admin-only, enforced at Rules layer)",
    (await updateAccount("acct-update-disp-tax", dispatcherToken, { taxStatus: str("EXEMPT") })) === 403
  );

  // The "no narrowing" proof: a dispatcher may still edit the rest of the
  // document as long as the two governed fields are unchanged.
  await seedAccount("acct-update-disp-other", { paymentTerms: "NET_30", taxStatus: "TAXABLE" });
  report(
    "dispatcher UPDATE of a NON-governed field (name), governed fields unchanged, accepted -- existing permission not narrowed",
    (await updateAccount("acct-update-disp-other", dispatcherToken, { name: str("Renamed By Dispatcher") })) === 200
  );

  // A legacy account with NO governed fields set: a dispatcher renaming it
  // must still succeed (both governed fields absent == unchanged).
  await seedAccount("acct-update-legacy", {});
  report(
    "dispatcher UPDATE of a legacy account with no governed fields (rename) accepted",
    (await updateAccount("acct-update-legacy", dispatcherToken, { name: str("Renamed Legacy") })) === 200
  );

  // Admin may set a governed field on a legacy account that never had one.
  await seedAccount("acct-update-legacy-admin", {});
  report(
    "admin UPDATE adding a valid paymentTerms to a legacy account accepted",
    (await updateAccount("acct-update-legacy-admin", adminToken, { paymentTerms: str("COD") })) === 200
  );
  await seedAccount("acct-update-legacy-disp", {});
  report(
    "dispatcher UPDATE adding paymentTerms to a legacy account denied (still a governed edit)",
    (await updateAccount("acct-update-legacy-disp", dispatcherToken, { paymentTerms: str("COD") })) === 403
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
