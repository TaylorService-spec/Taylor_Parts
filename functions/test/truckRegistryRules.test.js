// EI-P1d-2-2b -- Rules regression for the Truck Registry collections (trucks,
// mobile_locations): READ allowed for admin/dispatcher ONLY; every client
// create/update/delete DENIED for every principal (admin included) -- registry
// writes are trusted-Admin-SDK/Function-only, and the 1:1 Truck<->MOBILE-Location
// invariant cannot be enforced in Rules, so there is no client-write path. Same
// REST harness convention as partMasterRules.test.js. Runs under
// rulesRegressionRunner.mjs (registered with expected count 20).
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
  // Seed role users (Admin SDK) + one doc per collection to probe read/update/delete.
  await db.collection("users").doc("tr-admin").set({ role: "admin" });
  await db.collection("users").doc("tr-dispatcher").set({ role: "dispatcher" });
  await db.collection("users").doc("tr-tech").set({ role: "technician" });
  await db.collection("mobile_locations").doc("ML-SEED-1").set({ locationId: "ML-SEED-1", type: "MOBILE", displayLabel: "Truck 204", active: true });
  await db.collection("trucks").doc("TR-SEED-1").set({ truckId: "TR-SEED-1", locationId: "ML-SEED-1", homeWarehouseId: "WH-MAIN", status: "ACTIVE" });
  const adminTok = await idTokenFor("tr-admin");
  const dispTok = await idTokenFor("tr-dispatcher");
  const techTok = await idTokenFor("tr-tech");

  for (const [label, coll, seedId] of [["mobile_locations", "mobile_locations", "ML-SEED-1"], ["trucks", "trucks", "TR-SEED-1"]]) {
    // Reads: admin/dispatcher ALLOWED; unauthenticated + technician DENIED.
    report(`${label}: admin client read allowed`, (await rest("GET", `${coll}/${seedId}`, adminTok)) === 200);
    report(`${label}: dispatcher client read allowed`, (await rest("GET", `${coll}/${seedId}`, dispTok)) === 200);
    report(`${label}: unauthenticated read denied`, denied(await rest("GET", `${coll}/${seedId}`, null)));
    report(`${label}: technician client read denied`, denied(await rest("GET", `${coll}/${seedId}`, techTok)));
    // Writes: DENIED for every principal, admin included.
    report(`${label}: unauthenticated create denied`, denied(await rest("POST", `${coll}?documentId=x-${label}-1`, null, { fields: { name: str("x") } })));
    report(`${label}: technician create denied`, denied(await rest("POST", `${coll}?documentId=x-${label}-2`, techTok, { fields: { name: str("x") } })));
    report(`${label}: dispatcher create denied`, denied(await rest("POST", `${coll}?documentId=x-${label}-3`, dispTok, { fields: { name: str("x") } })));
    report(`${label}: admin client create denied`, denied(await rest("POST", `${coll}?documentId=x-${label}-4`, adminTok, { fields: { name: str("x") } })));
    report(`${label}: admin client update denied`, denied(await rest("PATCH", `${coll}/${seedId}`, adminTok, { fields: { name: str("y") } })));
    report(`${label}: admin client delete denied`, denied(await rest("DELETE", `${coll}/${seedId}`, adminTok)));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((err) => { console.error(err); process.exit(1); });
