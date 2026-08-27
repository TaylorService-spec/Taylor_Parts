// Dispatch & Scheduler (ND-22) -- Rules regression for the two technician-availability collections:
// FULLY BACKEND-PRIVATE. Every client READ, CREATE, UPDATE and DELETE is DENIED for every principal,
// admin included. The trusted setTechnicianWorkingAvailability / createTechnicianBlockedTime /
// deleteTechnicianBlockedTime commands write them Admin-SDK-only, and the ONLY read path is the
// trusted readTechnicianAvailability projection.
//
// WHY THIS SUITE HAS TO EXIST SEPARATELY FROM THE EMULATOR COMMAND TESTS. Those drive the callables,
// which run on the Admin SDK -- and the Admin SDK bypasses firestore.rules by design. A "a client
// cannot read technician_blocked_time" assertion made there would pass whatever the ruleset said. Only
// a CLIENT-SDK/REST probe carrying a real ID token proves the boundary, which is what this file does.
//
// READ BEING DENIED IS THE DELIBERATE, COSTLY PART. The Dispatch board genuinely needs these records
// to shade technician lanes and compute capacity, and denying read means it must go through the
// trusted projection instead of querying directly. That is the price of not putting every
// technician's PTO calendar in front of every authenticated principal, scoped by nothing -- and this
// suite is what stops the price quietly being refunded later.
//
// Same REST harness convention as receivingOrdersRules.test.js / truckRegistryRules.test.js. Runs
// under rulesRegressionRunner.mjs.
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
async function rest(method, path, idToken, body) {
  const res = await fetch(`${DOC_BASE}/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.status;
}
const denied = (s) => s === 403;
const allowed = (s) => s === 200;
const PROBE_BODY = { fields: { probe: { booleanValue: true } } };

const AVAIL = "technician_working_availability";
const BLOCKED = "technician_blocked_time";

async function main() {
  const now = Date.now();

  // --- seed personas (Admin SDK bypasses Rules) ---
  await db.doc("users/tav-admin").set({ role: "admin" });
  await db.doc("users/tav-disp").set({ role: "dispatcher" });
  await db.doc("users/tav-tech").set({ role: "technician", technicianId: "tav-tech-1" });
  for (const [rid, role] of [["pm", "PARTS_MANAGER"], ["wm", "WAREHOUSE_MANAGER"], ["pa", "PARTS_ASSOCIATE"]]) {
    await db.doc(`employees/tav-emp-${rid}`).set({ employeeId: `tav-emp-${rid}`, displayName: role, employmentStatus: "ACTIVE", operationalRoles: [role], userId: `tav-${rid}`, createdAt: now, updatedAt: now });
    await db.doc(`users/tav-${rid}`).set({ role: "technician", employeeId: `tav-emp-${rid}` });
  }

  // The governed technician record these collections describe, plus one document in each of them --
  // all written through the Admin SDK, which is the only writer that exists.
  await db.doc("fieldops_technicians/tav-tech-1").set({ id: "tav-tech-1", name: "Availability Fixture", status: "available" });
  await db.doc(`${AVAIL}/tav-tech-1`).set({
    technicianId: "tav-tech-1", timeZone: "America/Phoenix",
    weeklyHours: { 1: [{ start: "07:00", end: "16:00" }] },
    updatedByUid: "tav-seed", seed: true,
  });
  await db.doc(`${BLOCKED}/TAV-BLOCK-1`).set({
    blockId: "TAV-BLOCK-1", technicianId: "tav-tech-1", kind: "PTO",
    startMillis: now, endMillis: now + 3600_000, createdByUid: "tav-seed", seed: true,
  });

  const tokens = {
    admin: await idTokenFor("tav-admin"),
    dispatcher: await idTokenFor("tav-disp"),
    PARTS_MANAGER: await idTokenFor("tav-pm"),
    WAREHOUSE_MANAGER: await idTokenFor("tav-wm"),
    PARTS_ASSOCIATE: await idTokenFor("tav-pa"),
    technician: await idTokenFor("tav-tech"),
    noRole: await idTokenFor("tav-norole"), // authenticated, but NO users doc / role
    unauth: null,
  };

  // --- Both collections: DENY read + create + update + delete for EVERY persona (8 x 4 x 2 = 64) ---
  for (const [collection, seedId] of [[AVAIL, "tav-tech-1"], [BLOCKED, "TAV-BLOCK-1"]]) {
    for (const [persona, tok] of Object.entries(tokens)) {
      report(`${collection} READ denied for ${persona}`, denied(await rest("GET", `${collection}/${seedId}`, tok)));
      report(`${collection} CREATE denied for ${persona}`, denied(await rest("PATCH", `${collection}/TAV-NEW-${persona}`, tok, PROBE_BODY)));
      report(`${collection} UPDATE denied for ${persona}`, denied(await rest("PATCH", `${collection}/${seedId}`, tok, PROBE_BODY)));
      report(`${collection} DELETE denied for ${persona}`, denied(await rest("DELETE", `${collection}/${seedId}`, tok)));
    }
  }

  // --- a technician cannot read their OWN availability either (2) ---
  // Worth stating separately because it is the one denial someone will later argue with: a technician
  // reading their own working hours sounds harmless, and fieldops_technicians already permits exactly
  // that self-read. The answer is that these documents are not shaped for it -- a blocked-time query
  // is not doc-keyed by the reader, so "only your own" cannot be expressed here without a per-document
  // owner check that the board's range queries could not satisfy anyway. If a technician-facing view
  // is ever wanted, it goes through a trusted projection, not a Rules exception.
  report(`${AVAIL} READ denied for the technician it describes`, denied(await rest("GET", `${AVAIL}/tav-tech-1`, tokens.technician)));
  report(`${BLOCKED} READ denied for the technician it describes`, denied(await rest("GET", `${BLOCKED}/TAV-BLOCK-1`, tokens.technician)));

  // --- collection-level LIST is denied too, not just the doc reads above (2) ---
  // A `read` denial covers get AND list, but asserting it explicitly is what stops a later
  // "just let dispatchers list it" edit from passing this suite unnoticed.
  report(`${AVAIL} LIST denied for admin`, denied(await rest("GET", AVAIL, tokens.admin)));
  report(`${BLOCKED} LIST denied for dispatcher`, denied(await rest("GET", BLOCKED, tokens.dispatcher)));

  // --- malformed/missing auth cannot bypass (2) ---
  // A malformed bearer token is rejected at the auth layer before Rules evaluate (the emulator answers
  // 400 for an unparseable JWT; production answers 401). Either way it is a 4xx and never a 2xx.
  for (const collection of [AVAIL, BLOCKED]) {
    const status = await rest("GET", `${collection}/tav-tech-1`, "garbage.not.a.jwt");
    report(`${collection} READ rejected for a malformed bearer token (4xx, never 2xx)`, status >= 400 && status < 500, `status=${status}`);
  }

  // --- Admin SDK / trusted writes are NOT a client Rules grant (4) ---
  for (const [collection, seedId] of [[AVAIL, "tav-tech-1"], [BLOCKED, "TAV-BLOCK-1"]]) {
    const snap = await db.doc(`${collection}/${seedId}`).get();
    report(`${collection} exists via Admin SDK (trusted path) while every client op is denied`, snap.exists && snap.data().seed === true);
    const leaked = await db.collection(collection).where("probe", "==", true).limit(1).get();
    report(`no client CREATE probe leaked a ${collection} document`, leaked.empty);
  }

  // --- neighboring collections are UNCHANGED by this edit (3) ---
  // fieldops_technicians is the collection these two describe, and its posture must not have moved:
  // admin/dispatcher still read it, and a technician still reads their OWN record.
  report("neighbor fieldops_technicians READ still ALLOWED for admin", allowed(await rest("GET", "fieldops_technicians/tav-tech-1", tokens.admin)));
  report("neighbor fieldops_technicians READ still ALLOWED for the technician it describes", allowed(await rest("GET", "fieldops_technicians/tav-tech-1", tokens.technician)));
  report("neighbor fieldops_technicians CREATE still DENIED for technician", denied(await rest("PATCH", "fieldops_technicians/tav-new-1", tokens.technician, PROBE_BODY)));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error("Test run failed:", err); process.exit(1); });
