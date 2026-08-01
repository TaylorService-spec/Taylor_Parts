// EI Truck Registry write service -- Rules regression for the location_truck_claims guard
// collection: ALL client access DENIED for every principal (unauthenticated, technician,
// dispatcher, admin), reads included -- internal trusted-transaction bookkeeping only, same
// fully-closed posture as counters / inventory_sync_status. Same REST harness convention as
// partMasterRules.test.js / truckRegistryRules.test.js. Runs under rulesRegressionRunner.mjs
// (registered with expected count 10).
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
  await db.collection("users").doc("tc-admin").set({ role: "admin" });
  await db.collection("users").doc("tc-dispatcher").set({ role: "dispatcher" });
  await db.collection("users").doc("tc-tech").set({ role: "technician" });
  // Admin SDK seed bypasses Rules by design (the trusted write path); clients must not touch it.
  await db.collection("location_truck_claims").doc("MLOC-CLAIM-1").set({ locationId: "MLOC-CLAIM-1", truckId: "TRK-1", version: 1 });
  const adminTok = await idTokenFor("tc-admin");
  const dispTok = await idTokenFor("tc-dispatcher");
  const techTok = await idTokenFor("tc-tech");
  const coll = "location_truck_claims", seedId = "MLOC-CLAIM-1";

  // Reads DENIED for every principal (admin included).
  report("claims: unauthenticated read denied", denied(await rest("GET", `${coll}/${seedId}`, null)));
  report("claims: technician read denied", denied(await rest("GET", `${coll}/${seedId}`, techTok)));
  report("claims: dispatcher read denied", denied(await rest("GET", `${coll}/${seedId}`, dispTok)));
  report("claims: admin read denied", denied(await rest("GET", `${coll}/${seedId}`, adminTok)));
  // Writes DENIED for every principal.
  report("claims: unauthenticated create denied", denied(await rest("POST", `${coll}?documentId=x-1`, null, { fields: { truckId: str("x") } })));
  report("claims: technician create denied", denied(await rest("POST", `${coll}?documentId=x-2`, techTok, { fields: { truckId: str("x") } })));
  report("claims: dispatcher create denied", denied(await rest("POST", `${coll}?documentId=x-3`, dispTok, { fields: { truckId: str("x") } })));
  report("claims: admin client create denied", denied(await rest("POST", `${coll}?documentId=x-4`, adminTok, { fields: { truckId: str("x") } })));
  report("claims: admin client update denied", denied(await rest("PATCH", `${coll}/${seedId}`, adminTok, { fields: { truckId: str("y") } })));
  report("claims: admin client delete denied", denied(await rest("DELETE", `${coll}/${seedId}`, adminTok)));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((err) => { console.error(err); process.exit(1); });
