// Issue #325 / ADR-007 D-RULES (docs/specifications/governed-object-
// based-report-creator.md sec8/sec9; docs/implementation-plans/
// governed-object-based-report-creator.md sec4). Firestore Rules
// emulator test for the reportDefinitions collection: the inert saved-
// report-definition store, private by owner, "a definition confers no
// data access." Same zero-new-dependency posture as this repo's other
// Rules emulator tests (firebase-admin + Node's built-in fetch against
// the emulator REST APIs, no @firebase/rules-unit-testing, no test
// runner).
//
// Explicitly does NOT probe (out of D-RULES's own scope): whether the
// embedded `definition` field is itself well-formed/authorized to RUN
// (that is reportExecutionService.ts's / D-FN's job, already tested in
// reportExecutionService.test.mjs) -- this file proves only the
// DOCUMENT-level create/read/rename/duplicate/delete access contract.
//
// Prerequisite: run against a live Firestore + Auth emulator pair, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/reportDefinitionsRules.test.js
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

// Recursively converts a plain JS value into the Firestore REST "Value"
// wire format -- lets every test build fixtures as plain JS objects
// instead of hand-nesting {stringValue:...}/{mapValue:...} everywhere.
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return { integerValue: String(v) };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFirestoreValue(val);
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported fixture value: ${JSON.stringify(v)}`);
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFirestoreValue(v);
  return fields;
}

// Creates (PATCH to a never-before-used doc id, exercising `create`).
async function createDocAt(collection, docId, idToken, plainFields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: toFirestoreFields(plainFields) }),
  });
  return res.status;
}

// PATCH an EXISTING document with an explicit updateMask -> exercises
// `update` with the same "merged existing doc + these fields" semantics
// the client SDK's .update() produces, so diff().affectedKeys() sees
// exactly the changed keys, not the whole document.
async function updateDocAt(collection, docId, idToken, plainFields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = Object.keys(plainFields)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join("&");
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}?${mask}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: toFirestoreFields(plainFields) }),
  });
  return res.status;
}

// Builds plain fixture fields, converts them, then overrides specific
// keys with already-Firestore-shaped raw values -- for cases that need
// a wrong TYPE (e.g. definition as a string instead of a map), which
// toFirestoreValue's plain-JS-value inference can't express directly.
async function createDocWithRawOverride(collection, docId, idToken, plainFields, rawOverrides) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const fields = { ...toFirestoreFields(plainFields), ...rawOverrides };
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function getDocAt(collection, docId, idToken) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, { headers });
  return res.status;
}

async function deleteDocAt(collection, docId, idToken) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, { method: "DELETE", headers });
  return res.status;
}

async function runOwnerQuery(idToken, ownerUid) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE.replace("/documents", "")}/documents:runQuery`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "reportDefinitions" }],
        where: { fieldFilter: { field: { fieldPath: "ownerUid" }, op: "EQUAL", value: { stringValue: ownerUid } } },
      },
    }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

const OWNER_A = "rules-rd-owner-a";
const OWNER_B = "rules-rd-owner-b";
const ADMIN_UID = "rules-rd-admin";

const SAMPLE_DEFINITION = { objectId: "customer", fields: ["customer.name"], filters: [], groupBy: [], sort: [], aggregates: [], presentation: {} };

function reportDefinitionFixture({ id, ownerUid = OWNER_A, name = "My Report", now = Date.now() } = {}) {
  return {
    id,
    name,
    ownerUid,
    definition: SAMPLE_DEFINITION,
    createdAt: now,
    updatedAt: now,
  };
}

async function seed() {
  await db.doc("users/rules-rd-owner-a-user").set({ role: "technician" });
  await db.doc("users/rules-rd-owner-b-user").set({ role: "technician" });
  await db.doc("users/rules-rd-admin-user").set({ role: "admin" });

  // A pre-existing document (owned by OWNER_A) for read/update/delete/query probes.
  await db.doc("reportDefinitions/rules-rd-seeded-1").set(
    reportDefinitionFixture({ id: "rules-rd-seeded-1", ownerUid: OWNER_A, name: "Seeded Report" })
  );
}

async function main() {
  await seed();

  const tokens = {};
  for (const uid of [OWNER_A, OWNER_B, ADMIN_UID]) {
    tokens[uid] = await idTokenFor(uid);
  }
  // Link each auth uid to its users/{uid} doc via a distinct uid per role
  // (kept simple: the collection's own Rules never consult users/{uid} at
  // all -- only request.auth.uid -- so no reciprocal-link fixture is
  // needed here, unlike employees/operational-role Rules elsewhere).

  // === Create ===

  report("owner can create their own report definition",
    (await createDocAt("reportDefinitions", "rules-rd-create-1", tokens[OWNER_A],
      reportDefinitionFixture({ id: "rules-rd-create-1", ownerUid: OWNER_A }))) === 200);

  report("signed-out caller cannot create a report definition",
    (await createDocAt("reportDefinitions", "rules-rd-create-signedout", null,
      reportDefinitionFixture({ id: "rules-rd-create-signedout", ownerUid: OWNER_A }))) === 403);

  report("caller cannot create a report definition claiming a DIFFERENT owner (identity spoofing)",
    (await createDocAt("reportDefinitions", "rules-rd-create-spoof", tokens[OWNER_A],
      reportDefinitionFixture({ id: "rules-rd-create-spoof", ownerUid: OWNER_B }))) === 403);

  report("admin has NO special create authority over another principal's report (private-by-owner, no override)",
    (await createDocAt("reportDefinitions", "rules-rd-create-adminspoof", tokens[ADMIN_UID],
      reportDefinitionFixture({ id: "rules-rd-create-adminspoof", ownerUid: OWNER_B }))) === 403);

  report("create denied when the document id does not match the embedded id field",
    (await createDocAt("reportDefinitions", "rules-rd-create-idmismatch", tokens[OWNER_A],
      reportDefinitionFixture({ id: "some-other-id", ownerUid: OWNER_A }))) === 403);

  report("create denied when a required key is missing (hasAll)",
    (await createDocAt("reportDefinitions", "rules-rd-create-missingkey", tokens[OWNER_A], {
      id: "rules-rd-create-missingkey", name: "x", ownerUid: OWNER_A, definition: SAMPLE_DEFINITION,
      // updatedAt intentionally omitted
      createdAt: Date.now(),
    })) === 403);

  report("create denied when an extra/unknown key is present (hasOnly)",
    (await createDocAt("reportDefinitions", "rules-rd-create-extrakey", tokens[OWNER_A], {
      ...reportDefinitionFixture({ id: "rules-rd-create-extrakey", ownerUid: OWNER_A }),
      sharedWith: ["someone"],
    })) === 403);

  report("create denied when definition is not a map",
    (await createDocWithRawOverride("reportDefinitions", "rules-rd-create-notmap", tokens[OWNER_A],
      reportDefinitionFixture({ id: "rules-rd-create-notmap", ownerUid: OWNER_A }),
      { definition: { stringValue: "not-a-map" } })) === 403);

  report("create denied when name is empty",
    (await createDocAt("reportDefinitions", "rules-rd-create-emptyname", tokens[OWNER_A],
      reportDefinitionFixture({ id: "rules-rd-create-emptyname", ownerUid: OWNER_A, name: "" }))) === 403);

  report("create denied when name exceeds 120 characters",
    (await createDocAt("reportDefinitions", "rules-rd-create-longname", tokens[OWNER_A],
      reportDefinitionFixture({ id: "rules-rd-create-longname", ownerUid: OWNER_A, name: "x".repeat(121) }))) === 403);

  report("create denied when updatedAt differs from createdAt (creation baseline)",
    (await createDocAt("reportDefinitions", "rules-rd-create-tsmismatch", tokens[OWNER_A], {
      id: "rules-rd-create-tsmismatch", name: "x", ownerUid: OWNER_A, definition: SAMPLE_DEFINITION,
      createdAt: 1000, updatedAt: 2000,
    })) === 403);

  // === Read ===

  report("owner can read their own report definition",
    (await getDocAt("reportDefinitions", "rules-rd-seeded-1", tokens[OWNER_A])) === 200);

  report("a different signed-in user cannot read another owner's report definition",
    (await getDocAt("reportDefinitions", "rules-rd-seeded-1", tokens[OWNER_B])) === 403);

  report("admin has NO special read authority over another principal's report (private-by-owner, no override)",
    (await getDocAt("reportDefinitions", "rules-rd-seeded-1", tokens[ADMIN_UID])) === 403);

  report("signed-out caller cannot read a report definition",
    (await getDocAt("reportDefinitions", "rules-rd-seeded-1", null)) === 403);

  // === Owner-scoped list query ===

  report("an owner-scoped query returns only that owner's report definitions",
    await (async () => {
      const { status, body } = await runOwnerQuery(tokens[OWNER_A], OWNER_A);
      if (status !== 200) return false;
      const docs = body.filter((entry) => entry.document);
      return docs.length >= 1 && docs.every((entry) => entry.document.fields.ownerUid.stringValue === OWNER_A);
    })());

  report("a query for another owner's uid, run by a non-matching caller, returns zero documents (never another principal's data)",
    await (async () => {
      const { status, body } = await runOwnerQuery(tokens[OWNER_B], OWNER_A);
      if (status !== 200) return true; // some emulator versions 200 with an empty array; handled below too
      const docs = body.filter((entry) => entry.document);
      return docs.length === 0;
    })());

  // === Update (rename only) ===

  await db.doc("reportDefinitions/rules-rd-rename-1").set(reportDefinitionFixture({ id: "rules-rd-rename-1", ownerUid: OWNER_A, name: "Before Rename" }));

  report("owner can rename their own report definition (name + updatedAt only)",
    (await updateDocAt("reportDefinitions", "rules-rd-rename-1", tokens[OWNER_A], { name: "After Rename", updatedAt: Date.now() })) === 200);

  await db.doc("reportDefinitions/rules-rd-rename-2").set(reportDefinitionFixture({ id: "rules-rd-rename-2", ownerUid: OWNER_A }));

  report("a non-owner cannot rename another owner's report definition",
    (await updateDocAt("reportDefinitions", "rules-rd-rename-2", tokens[OWNER_B], { name: "Hijacked", updatedAt: Date.now() })) === 403);

  await db.doc("reportDefinitions/rules-rd-rename-3").set(reportDefinitionFixture({ id: "rules-rd-rename-3", ownerUid: OWNER_A }));

  report("owner cannot change the embedded definition via update (only name/updatedAt are editable)",
    (await updateDocAt("reportDefinitions", "rules-rd-rename-3", tokens[OWNER_A], {
      definition: { objectId: "equipment", fields: [], filters: [], groupBy: [], sort: [], aggregates: [], presentation: {} },
      updatedAt: Date.now(),
    })) === 403);

  await db.doc("reportDefinitions/rules-rd-rename-4").set(reportDefinitionFixture({ id: "rules-rd-rename-4", ownerUid: OWNER_A }));

  report("owner cannot change ownerUid via update (cannot transfer ownership)",
    (await updateDocAt("reportDefinitions", "rules-rd-rename-4", tokens[OWNER_A], { ownerUid: OWNER_B, updatedAt: Date.now() })) === 403);

  await db.doc("reportDefinitions/rules-rd-rename-5").set(reportDefinitionFixture({ id: "rules-rd-rename-5", ownerUid: OWNER_A }));

  report("owner cannot rename to an empty name",
    (await updateDocAt("reportDefinitions", "rules-rd-rename-5", tokens[OWNER_A], { name: "", updatedAt: Date.now() })) === 403);

  await db.doc("reportDefinitions/rules-rd-rename-6").set(reportDefinitionFixture({ id: "rules-rd-rename-6", ownerUid: OWNER_A }));

  report("owner cannot rename by adding an unrelated extra key alongside name",
    (await updateDocAt("reportDefinitions", "rules-rd-rename-6", tokens[OWNER_A], { name: "x", updatedAt: Date.now(), extra: "nope" })) === 403);

  // === Delete ===

  await db.doc("reportDefinitions/rules-rd-delete-1").set(reportDefinitionFixture({ id: "rules-rd-delete-1", ownerUid: OWNER_A }));

  report("owner can delete their own report definition",
    (await deleteDocAt("reportDefinitions", "rules-rd-delete-1", tokens[OWNER_A])) === 200);

  await db.doc("reportDefinitions/rules-rd-delete-2").set(reportDefinitionFixture({ id: "rules-rd-delete-2", ownerUid: OWNER_A }));

  report("a non-owner cannot delete another owner's report definition",
    (await deleteDocAt("reportDefinitions", "rules-rd-delete-2", tokens[OWNER_B])) === 403);

  await db.doc("reportDefinitions/rules-rd-delete-3").set(reportDefinitionFixture({ id: "rules-rd-delete-3", ownerUid: OWNER_A }));

  report("admin has NO special delete authority over another principal's report (private-by-owner, no override)",
    (await deleteDocAt("reportDefinitions", "rules-rd-delete-3", tokens[ADMIN_UID])) === 403);

  // === Duplicate (a create of a NEW document, no separate Rules branch) ===

  report("'duplicate' -- a fresh create copying an existing definition's content under a new id -- succeeds for the owner",
    (await createDocAt("reportDefinitions", "rules-rd-duplicate-1", tokens[OWNER_A],
      reportDefinitionFixture({ id: "rules-rd-duplicate-1", ownerUid: OWNER_A, name: "Copy of Seeded Report" }))) === 200);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
