// Receiving Location Authority -- I-LA4/I-LR: Firestore-emulator tests for the trusted receiving-location
// option service. Requires the Firestore emulator (127.0.0.1:8080). The injected authorize seam reads the
// actor's role THROUGH the transaction (admin/dispatcher only, first slice); the candidate read reads the
// whole warehouses collection through the txn. Proves the persona matrix, commit-time revocation, and
// end-to-end §3A filtering. Never touches production. Prerequisite: npm run build; emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { listEligibleReceivingLocationOptions } = await import("../lib/warehouseGovernance/receivingLocationOptionsService.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const TS = Timestamp.fromMillis(1_700_000_000_000);
const COL = () => db.collection("warehouses");
// A SEPARATE connection for mid-transaction role revocation.
const revoker = admin.initializeApp({ projectId: "taylor-parts" }, "revoker-la4").firestore();

function governed(id, over = {}) {
  return { id, name: "N", location: "L", status: "ACTIVE", version: 1, updatedAt: TS, updatedBy: "u", provenance: "NATIVE", createdAt: TS, createdBy: "u", ...over };
}
async function clearWarehouses() {
  const snap = await COL().get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
function emuDeps(actorId, over = {}) {
  return {
    actor: { kind: "USER", id: actorId },
    // real-shaped authorization: admin/dispatcher via users/{uid}.role, read through the txn (no client read broadened)
    authorize: async (txn, id) => { const s = await txn.get(db.collection("users").doc(id)); return s.exists && (s.data().role === "admin" || s.data().role === "dispatcher"); },
    readCandidateWarehouses: async (txn) => { const s = await txn.get(COL()); return s.docs.map((d) => ({ warehouseId: d.id, data: d.data() })); },
    runRead: (fn) => db.runTransaction(fn),
    ...over,
  };
}

await check("persona matrix: admin/dispatcher authorized; PARTS_ASSOCIATE/technician/no-role/unauth/inactive denied", async () => {
  await clearWarehouses();
  const wh = nextId("wh");
  await COL().doc(wh).set(governed(wh, { name: "Main" }));
  // seed personas
  const admin1 = nextId("admin"); await db.collection("users").doc(admin1).set({ role: "admin" });
  const disp = nextId("disp"); await db.collection("users").doc(disp).set({ role: "dispatcher" });
  const tech = nextId("tech"); await db.collection("users").doc(tech).set({ role: "technician" });
  const pa = nextId("pa"); await db.collection("users").doc(pa).set({ role: "technician", employeeId: "emp-pa" });
  await db.collection("employees").doc("emp-pa").set({ employmentStatus: "ACTIVE", operationalRoles: ["PARTS_ASSOCIATE"], userId: pa });
  const inact = nextId("inact"); await db.collection("users").doc(inact).set({ role: "technician", employeeId: "emp-inact" });
  await db.collection("employees").doc("emp-inact").set({ employmentStatus: "INACTIVE", operationalRoles: ["WAREHOUSE_MANAGER"], userId: inact });
  const norole = nextId("norole"); // no users doc
  const unauth = nextId("unauth"); // no users doc (models an unauthenticated principal id)

  for (const allowed of [admin1, disp]) {
    const out = await listEligibleReceivingLocationOptions({}, emuDeps(allowed));
    assert.deepEqual(out, [{ value: wh, label: "Main", type: "WAREHOUSE" }], `expected options for ${allowed}`);
  }
  for (const denied of [tech, pa, norole, unauth, inact]) {
    await assert.rejects(listEligibleReceivingLocationOptions({}, emuDeps(denied)), (e) => e.code === "PERMISSION_DENIED", `expected denial for ${denied}`);
  }
});

await check("end-to-end §3A filter: only governed ACTIVE warehouses become options, sorted", async () => {
  await clearWarehouses();
  const a = nextId("wh"); const b = nextId("wh"); const inactive = nextId("wh"); const legacy = nextId("wh"); const mal = nextId("wh");
  await COL().doc(a).set(governed(a, { name: "Zeta" }));
  await COL().doc(b).set(governed(b, { name: "Alpha" }));
  await COL().doc(inactive).set(governed(inactive, { status: "INACTIVE", name: "Inactive" }));
  await COL().doc(legacy).set({ id: legacy, name: "Legacy", location: "L", active: true });
  await COL().doc(mal).set({ id: mal, name: "Mal", location: "L", status: "ACTIVE" }); // partial (no version/provenance)
  const admin1 = nextId("admin"); await db.collection("users").doc(admin1).set({ role: "admin" });
  const out = await listEligibleReceivingLocationOptions({}, emuDeps(admin1));
  assert.deepEqual(out, [
    { value: b, label: "Alpha", type: "WAREHOUSE" },
    { value: a, label: "Zeta", type: "WAREHOUSE" },
  ]);
});

await check("commit-time revocation: role removed after the auth read cannot return options", async () => {
  await clearWarehouses();
  const wh = nextId("wh"); await COL().doc(wh).set(governed(wh, { name: "Main" }));
  const adminId = nextId("admin"); await db.collection("users").doc(adminId).set({ role: "admin" });
  let revoked = false;
  const deps = emuDeps(adminId, {
    __afterAuthReadHook: async () => { if (!revoked) { revoked = true; await revoker.collection("users").doc(adminId).delete(); } },
  });
  // Fails closed (no options). A clean retry re-checks auth and denies (PERMISSION_DENIED); a contended
  // read may instead surface the sanitized SOURCE_UNAVAILABLE -- either way, zero options are returned.
  await assert.rejects(listEligibleReceivingLocationOptions({}, deps), (e) => e.code === "PERMISSION_DENIED" || e.code === "SOURCE_UNAVAILABLE");
});

await check("empty candidate set for an authorized actor -> empty options (not an error)", async () => {
  await clearWarehouses();
  const adminId = nextId("admin"); await db.collection("users").doc(adminId).set({ role: "admin" });
  const out = await listEligibleReceivingLocationOptions({}, emuDeps(adminId));
  assert.deepEqual(out, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
