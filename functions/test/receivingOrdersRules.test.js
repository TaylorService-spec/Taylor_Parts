// EI Phase-2 Receiving (Phase D) -- Rules regression for receiving_orders: FULLY BACKEND-PRIVATE
// (Option A). Every client READ, CREATE, UPDATE, and DELETE is DENIED for EVERY principal (admin
// included) -- the trusted receiveInventoryStock command writes it Admin-SDK-only, with no client path.
// Proves: denial across admin/dispatcher/PARTS_MANAGER/WAREHOUSE_MANAGER/PARTS_ASSOCIATE/technician/
// authenticated-no-role/unauthenticated; a neighboring collection's existing permissions are unchanged;
// malformed/missing auth cannot bypass; and Admin-SDK/trusted writes are NOT a client Rules grant. Same
// REST harness convention as truckRegistryRules.test.js. Runs under rulesRegressionRunner.mjs.
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

async function main() {
  const now = Date.now();
  // --- seed personas (Admin SDK bypasses Rules) ---
  await db.doc("users/rcv-admin").set({ role: "admin" });
  await db.doc("users/rcv-disp").set({ role: "dispatcher" });
  await db.doc("users/rcv-tech").set({ role: "technician" });
  // operational roles: employees/{empId}.userId==uid + users/{uid}.employeeId==empId
  for (const [rid, role] of [["pm", "PARTS_MANAGER"], ["wm", "WAREHOUSE_MANAGER"], ["pa", "PARTS_ASSOCIATE"]]) {
    await db.doc(`employees/rcv-emp-${rid}`).set({ employeeId: `rcv-emp-${rid}`, displayName: role, employmentStatus: "ACTIVE", operationalRoles: [role], userId: `rcv-${rid}`, createdAt: now, updatedAt: now });
    await db.doc(`users/rcv-${rid}`).set({ role: "technician", employeeId: `rcv-emp-${rid}` });
  }
  // seed the private receiving_orders doc + a neighbor ledger doc (both via Admin SDK)
  await db.doc("receiving_orders/RCV-SEED-1").set({ receivingId: "RCV-SEED-1", status: "PUTAWAY_COMPLETE", version: 1, seed: true });
  await db.doc("inventory_transactions/IT-SEED-1").set({ workOrderId: "WO-1", partId: "P1", type: "RESERVED", quantity: 1 });

  const tokens = {
    admin: await idTokenFor("rcv-admin"),
    dispatcher: await idTokenFor("rcv-disp"),
    PARTS_MANAGER: await idTokenFor("rcv-pm"),
    WAREHOUSE_MANAGER: await idTokenFor("rcv-wm"),
    PARTS_ASSOCIATE: await idTokenFor("rcv-pa"),
    technician: await idTokenFor("rcv-tech"),
    noRole: await idTokenFor("rcv-norole"), // authenticated, but NO users doc / role
    unauth: null,
  };

  // --- receiving_orders: DENY read + create + update + delete for EVERY persona ---
  for (const [persona, tok] of Object.entries(tokens)) {
    report(`receiving_orders READ denied for ${persona}`, denied(await rest("GET", "receiving_orders/RCV-SEED-1", tok)));
    report(`receiving_orders CREATE denied for ${persona}`, denied(await rest("PATCH", `receiving_orders/RCV-NEW-${persona}`, tok, PROBE_BODY)));
    report(`receiving_orders UPDATE denied for ${persona}`, denied(await rest("PATCH", "receiving_orders/RCV-SEED-1", tok, PROBE_BODY)));
    report(`receiving_orders DELETE denied for ${persona}`, denied(await rest("DELETE", "receiving_orders/RCV-SEED-1", tok)));
  }

  // --- malformed/missing auth cannot bypass ---
  // A malformed bearer token is rejected at the auth layer before Rules even evaluate (the emulator
  // answers 400 Bad Request for an unparseable JWT; production answers 401). A well-formed-but-
  // unprivileged token is instead rejected by Rules (403). Every one of those is a 4xx rejection --
  // "cannot bypass" means the read is NOT served, i.e. a client error and never a 2xx.
  const malformedStatus = await rest("GET", "receiving_orders/RCV-SEED-1", "garbage.not.a.jwt");
  report("receiving_orders READ rejected for a malformed bearer token (4xx, never 2xx)", malformedStatus >= 400 && malformedStatus < 500, `status=${malformedStatus}`);

  // --- Admin SDK / trusted writes are NOT a client Rules grant ---
  // The Admin SDK seed above succeeded (trusted path) and the doc exists, yet every client op is denied.
  const seedSnap = await db.doc("receiving_orders/RCV-SEED-1").get();
  report("receiving_orders exists via Admin SDK (trusted path) while all client ops are denied", seedSnap.exists && seedSnap.data().seed === true);
  // and the client CREATE probes above never created anything (deny-closed):
  const leaked = await db.collection("receiving_orders").where("probe", "==", true).limit(1).get();
  report("no client CREATE probe leaked a receiving_orders document", leaked.empty);

  // --- neighboring collection (inventory_transactions) permissions UNCHANGED by this edit ---
  report("neighbor inventory_transactions READ still ALLOWED for admin", allowed(await rest("GET", "inventory_transactions/IT-SEED-1", tokens.admin)));
  report("neighbor inventory_transactions READ still DENIED for technician", denied(await rest("GET", "inventory_transactions/IT-SEED-1", tokens.technician)));
  report("neighbor inventory_transactions CREATE still DENIED for admin", denied(await rest("PATCH", "inventory_transactions/IT-NEW-1", tokens.admin, PROBE_BODY)));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error("Test run failed:", err); process.exit(1); });
