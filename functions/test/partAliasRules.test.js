// INV-1 Phase 1 PR 1.3 -- Rules regression for the closed part_aliases
// collection: ALL client access denied for every principal. Same harness
// as partMasterRules.test.js. Registered with expected count 8.
"use strict";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const admin = require("firebase-admin");
const PROJECT_ID = "taylor-parts";
const AUTH_HOST = "http://127.0.0.1:9099";
const DOC_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();
let passed = 0, failed = 0;
function report(name, ok, detail) {
  if (ok) { passed += 1; console.log(`PASS -- ${name}`); }
  else { failed += 1; console.log(`FAIL -- ${name}${detail ? ` -- ${detail}` : ""}`); }
}
async function idTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(`${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  return (await res.json()).idToken;
}
const str = (v) => ({ stringValue: v });
async function rest(method, path, idToken, body) {
  const res = await fetch(`${DOC_BASE}/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.status;
}
const denied = (s) => s === 403;
async function main() {
  await db.collection("users").doc("pa-admin").set({ role: "admin" });
  await db.collection("users").doc("pa-tech").set({ role: "technician" });
  await db.collection("users").doc("pa-disp").set({ role: "dispatcher" });
  await db.collection("part_aliases").doc("INTERNAL_PN__PA-SEED-1").set({ aliasId: "INTERNAL_PN__PA-SEED-1", partId: "PA-1", status: "ACTIVE" });
  const adminTok = await idTokenFor("pa-admin");
  const techTok = await idTokenFor("pa-tech");
  const dispTok = await idTokenFor("pa-disp");
  report("unauthenticated read denied", denied(await rest("GET", "part_aliases/INTERNAL_PN__PA-SEED-1", null)));
  report("unauthenticated create denied", denied(await rest("POST", "part_aliases?documentId=x-1", null, { fields: { partId: str("P") } })));
  report("technician read denied", denied(await rest("GET", "part_aliases/INTERNAL_PN__PA-SEED-1", techTok)));
  report("technician write denied", denied(await rest("POST", "part_aliases?documentId=x-2", techTok, { fields: { partId: str("P") } })));
  report("dispatcher read denied", denied(await rest("GET", "part_aliases/INTERNAL_PN__PA-SEED-1", dispTok)));
  report("dispatcher write denied", denied(await rest("PATCH", "part_aliases/INTERNAL_PN__PA-SEED-1", dispTok, { fields: { partId: str("Q") } })));
  report("admin client read denied", denied(await rest("GET", "part_aliases/INTERNAL_PN__PA-SEED-1", adminTok)));
  report("admin client update+delete denied", denied(await rest("PATCH", "part_aliases/INTERNAL_PN__PA-SEED-1", adminTok, { fields: { partId: str("Q") } })) && denied(await rest("DELETE", "part_aliases/INTERNAL_PN__PA-SEED-1", adminTok)));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((err) => { console.error(err); process.exit(1); });
