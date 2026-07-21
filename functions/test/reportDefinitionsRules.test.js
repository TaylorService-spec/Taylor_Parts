// Issue #325 / ADR-007 D-RULES, CORRECTED (docs/specifications/governed-
// object-based-report-creator.md sec8/sec9). Firestore Rules emulator
// test for the reportDefinitions collection's CORRECTED posture: ALL
// direct client read/write is denied, unconditionally, for every
// principal including admin -- the trusted saved-definition service
// (functions/src/reporting/savedDefinitionCommands.ts,
// savedDefinitionCommands.test.mjs) is now the ONLY path to this
// collection. This file replaces the original D-RULES PR's much larger
// suite (which tested a client-direct-write ownership model this task
// explicitly supersedes) with the much smaller "deny everyone,
// unconditionally" contract this collection now has -- matching the
// same zero-new-dependency emulator-REST convention as this repo's
// other Rules tests.
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

const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });

function sampleFields(ownerUid) {
  return {
    id: str("rules-rd2-seeded-1"),
    name: str("Seeded Report"),
    ownerUid: str(ownerUid),
    definition: { mapValue: { fields: { objectId: str("customer") } } },
    createdAt: int(Date.now()),
    updatedAt: int(Date.now()),
  };
}

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

async function updateDocAt(collection, docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = Object.keys(fields)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join("&");
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}?${mask}`, {
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

const OWNER_A = "rules-rd2-owner-a";
const ADMIN_UID = "rules-rd2-admin";

async function seed() {
  // Seeded via the Admin SDK (bypasses Rules by design, matching this
  // codebase's established seeding convention) so the read/update/
  // delete DENY probes below have a real, owned document to target.
  await db.doc("reportDefinitions/rules-rd2-seeded-1").set({
    id: "rules-rd2-seeded-1",
    name: "Seeded Report",
    ownerUid: OWNER_A,
    definition: { objectId: "customer" },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

async function main() {
  await seed();

  const tokens = {};
  for (const uid of [OWNER_A, ADMIN_UID]) {
    tokens[uid] = await idTokenFor(uid);
  }

  // === Read (get) -- denied for everyone, including the document's own owner ===

  report("the document's own owner cannot read it directly (client-direct read removed)",
    (await getDocAt("reportDefinitions", "rules-rd2-seeded-1", tokens[OWNER_A])) === 403);

  report("admin cannot read another principal's saved definition directly",
    (await getDocAt("reportDefinitions", "rules-rd2-seeded-1", tokens[ADMIN_UID])) === 403);

  report("a signed-out caller cannot read a saved definition directly",
    (await getDocAt("reportDefinitions", "rules-rd2-seeded-1", null)) === 403);

  // === Read (list/query) -- denied for everyone, even a query for one's own uid ===

  report("an owner-scoped LIST query is denied outright, even a query for the caller's own uid (no client-direct list path remains)",
    await (async () => {
      const { status, body } = await runOwnerQuery(tokens[OWNER_A], OWNER_A);
      if (status !== 200) return true; // denied outright is the expected/safe outcome
      // Some emulator versions 200 an empty/error-shaped result rather than a
      // transport-level denial for a query whose only candidate document is
      // denied per-document -- either shape is safe as long as ZERO real
      // documents are returned.
      const docs = body.filter((entry) => entry.document);
      return docs.length === 0;
    })());

  // === Create -- denied for everyone ===

  report("the claimed owner cannot create a saved definition directly",
    (await createDocAt("reportDefinitions", "rules-rd2-create-1", tokens[OWNER_A], sampleFields(OWNER_A))) === 403);

  report("admin cannot create a saved definition directly (no override -- Rules are unconditionally closed)",
    (await createDocAt("reportDefinitions", "rules-rd2-create-2", tokens[ADMIN_UID], sampleFields(ADMIN_UID))) === 403);

  report("a signed-out caller cannot create a saved definition directly",
    (await createDocAt("reportDefinitions", "rules-rd2-create-3", null, sampleFields(OWNER_A))) === 403);

  // === Update (rename) -- denied for everyone ===

  report("the document's own owner cannot rename it directly",
    (await updateDocAt("reportDefinitions", "rules-rd2-seeded-1", tokens[OWNER_A], { name: str("Renamed"), updatedAt: int(Date.now()) })) === 403);

  report("admin cannot rename another principal's saved definition directly",
    (await updateDocAt("reportDefinitions", "rules-rd2-seeded-1", tokens[ADMIN_UID], { name: str("Admin Renamed"), updatedAt: int(Date.now()) })) === 403);

  // === Delete -- denied for everyone ===

  report("the document's own owner cannot delete it directly",
    (await deleteDocAt("reportDefinitions", "rules-rd2-seeded-1", tokens[OWNER_A])) === 403);

  report("admin cannot delete another principal's saved definition directly",
    (await deleteDocAt("reportDefinitions", "rules-rd2-seeded-1", tokens[ADMIN_UID])) === 403);

  report("a signed-out caller cannot delete a saved definition directly",
    (await deleteDocAt("reportDefinitions", "rules-rd2-seeded-1", null)) === 403);

  // === Confirm the seeded document really does still exist (Admin SDK bypasses Rules) ===

  report("the seeded document is still present via the Admin SDK (proves the denials above are real Rules denials, not a missing-document 404)",
    (await db.doc("reportDefinitions/rules-rd2-seeded-1").get()).exists === true);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
