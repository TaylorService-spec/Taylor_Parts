// INV-1 Phase 1 PR 1.2 -- Rules regression for the Part Master closed
// collections (parts, manufacturers): ALL client access denied for every
// principal (unauthenticated, technician, dispatcher, admin), reads
// included -- trusted Admin SDK only. Same REST harness convention as
// reportDefinitionsRules.test.js. Runs under rulesRegressionRunner.mjs
// (registered with expected count 16).
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
let passed = 0;
let failed = 0;
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
  // Seed role users (Admin SDK) + one doc per collection to probe update/read/delete.
  await db.collection("users").doc("pm-admin").set({ role: "admin" });
  await db.collection("users").doc("pm-dispatcher").set({ role: "dispatcher" });
  await db.collection("users").doc("pm-tech").set({ role: "technician" });
  await db.collection("parts").doc("PM-SEED-1").set({ partId: "PM-SEED-1", name: "Seed", status: "ACTIVE" });
  await db.collection("manufacturers").doc("MFR-SEED-1").set({ manufacturerId: "MFR-SEED-1", name: "Seed", status: "ACTIVE" });
  const adminTok = await idTokenFor("pm-admin");
  const dispTok = await idTokenFor("pm-dispatcher");
  const techTok = await idTokenFor("pm-tech");

  // PR 1.9 Tier 2 read posture: parts readable by admin/dispatcher ONLY;
  // manufacturers stay fully closed; ALL client writes stay denied.
  for (const [label, coll, seedId] of [["parts", "parts", "PM-SEED-1"], ["manufacturers", "manufacturers", "MFR-SEED-1"]]) {
    report(`${label}: unauthenticated create denied`, denied(await rest("POST", `${coll}?documentId=x-${label}-1`, null, { fields: { name: str("x") } })));
    report(`${label}: technician create denied`, denied(await rest("POST", `${coll}?documentId=x-${label}-2`, techTok, { fields: { name: str("x") } })));
    report(`${label}: dispatcher create denied`, denied(await rest("POST", `${coll}?documentId=x-${label}-3`, dispTok, { fields: { name: str("x") } })));
    report(`${label}: admin client create denied`, denied(await rest("POST", `${coll}?documentId=x-${label}-4`, adminTok, { fields: { name: str("x") } })));
    report(`${label}: admin client update denied`, denied(await rest("PATCH", `${coll}/${seedId}`, adminTok, { fields: { name: str("y") } })));
    report(`${label}: admin client delete denied`, denied(await rest("DELETE", `${coll}/${seedId}`, adminTok)));
    report(`${label}: unauthenticated read denied`, denied(await rest("GET", `${coll}/${seedId}`, null)));
    report(`${label}: technician client read denied`, denied(await rest("GET", `${coll}/${seedId}`, techTok)));
  }
  // parts: authorized reads ALLOWED (PR 1.9); manufacturers: still denied.
  report("parts: admin client read allowed", (await rest("GET", "parts/PM-SEED-1", adminTok)) === 200);
  report("parts: dispatcher client read allowed", (await rest("GET", "parts/PM-SEED-1", dispTok)) === 200);
  report("manufacturers: admin client read denied", denied(await rest("GET", "manufacturers/MFR-SEED-1", adminTok)));
  report("manufacturers: dispatcher client read denied", denied(await rest("GET", "manufacturers/MFR-SEED-1", dispTok)));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((err) => { console.error(err); process.exit(1); });
