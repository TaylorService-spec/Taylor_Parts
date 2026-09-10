// getCycleCountAssignedMobileLocation -- "which truck is mine?" for a Cycle Count technician.
// Reuses the SAME governed truck-assignment resolver Transfer discovery uses
// (readAssignedMobileLocation); this suite proves it grants no new authority and fails closed.
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test/cycleCountAssignedMobileLocation.test.mjs (after npm run build)
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const CALL = await import("../lib/cycleCount/cycleCountSheetCallables.js");
const { __resetRuntimeCapabilityOverridesCacheForTest } = await import("../lib/access/environmentCapabilityOverrides.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const T0 = Timestamp.fromDate(new Date(1_700_000_000_000));
const codeOf = async (p) => { try { await p; return null; } catch (e) { return e.details?.code ?? e.code; } };
const req = (u, data = {}) => ({ data, auth: u ? { uid: u, token: {} } : undefined });

async function seedCounter({ trucks = 1, status = "ACTIVE", technicianId: fixedTechId } = {}) {
  const uid = nextId("uid");
  const technicianId = fixedTechId ?? nextId("tech");
  await db.collection("users").doc(uid).set({ accessVersion: 1, technicianId });
  await db.collection("roleAssignments").doc(`${uid}-counter`).set({
    principalUid: uid, roleId: "inventoryCycleCountCounter", scope: { type: "global" },
    grantedBy: "t", grantedAt: T0, status: "active", accessVersionAtGrant: 1,
  });
  const locations = [];
  for (let i = 0; i < trucks; i += 1) {
    const locationId = nextId("truck-loc");
    await db.collection("trucks").doc(nextId("truck")).set({ assignedDriverEmployeeId: technicianId, locationId, status, displayLabel: `Van ${locationId}` });
    locations.push(locationId);
  }
  return { uid, technicianId, truckLoc: locations[0] ?? null };
}

const prev = process.env.GCLOUD_PROJECT;
process.env.GCLOUD_PROJECT = "eos-platform-sandbox"; __resetRuntimeCapabilityOverridesCacheForTest();
try {
  await check("1 unauthenticated caller is refused", async () => {
    assert.equal(await codeOf(CALL.runGetCycleCountAssignedMobileLocation(req(null), db)), "unauthenticated");
  });

  await check("2 counter authority + exactly one ACTIVE assigned truck resolves that MOBILE location", async () => {
    const t = await seedCounter();
    const out = await CALL.runGetCycleCountAssignedMobileLocation(req(t.uid), db);
    assert.deepEqual(out.location, { type: "MOBILE", locationId: t.truckLoc });
    assert.equal(out.label, `Van ${t.truckLoc}`);
  });

  await check("3 no Cycle Count counter capability means truck assignment alone does not expose anything", async () => {
    const uid = nextId("uid"); const technicianId = nextId("tech");
    await db.collection("users").doc(uid).set({ accessVersion: 1, technicianId }); // no roleAssignment at all
    await db.collection("trucks").doc(nextId("truck")).set({ assignedDriverEmployeeId: technicianId, locationId: nextId("loc"), status: "ACTIVE" });
    const e = await CALL.runGetCycleCountAssignedMobileLocation(req(uid), db).catch((x) => x);
    assert.equal(e.code, "permission-denied"); assert.equal(e.details.code, "PERMISSION_DENIED");
  });

  await check("4 counter authority requires BOTH create and submit -- one alone is refused", async () => {
    const uid = nextId("uid"); const technicianId = nextId("tech");
    await db.collection("users").doc(uid).set({ accessVersion: 1, technicianId });
    await db.collection("roleAssignments").doc(`${uid}-partial`).set({
      principalUid: uid, roleId: "inventoryCycleCountReconciler", scope: { type: "global" },
      grantedBy: "t", grantedAt: T0, status: "active", accessVersionAtGrant: 1,
    });
    await db.collection("trucks").doc(nextId("truck")).set({ assignedDriverEmployeeId: technicianId, locationId: nextId("loc"), status: "ACTIVE" });
    assert.equal(await codeOf(CALL.runGetCycleCountAssignedMobileLocation(req(uid), db)), "PERMISSION_DENIED", "reconcile alone is not counter authority");
  });

  await check("5 counter authority + zero assigned trucks is a truthful no-assignment state", async () => {
    const t = await seedCounter({ trucks: 0 });
    const e = await CALL.runGetCycleCountAssignedMobileLocation(req(t.uid), db).catch((x) => x);
    assert.equal(e.code, "failed-precondition"); assert.equal(e.details.code, "NO_TRUCK_ASSIGNMENT");
  });

  await check("6 an out-of-service truck is not usable -- same truthful no-assignment state", async () => {
    const t = await seedCounter({ status: "OUT_OF_SERVICE" });
    assert.equal(await codeOf(CALL.runGetCycleCountAssignedMobileLocation(req(t.uid), db)), "NO_TRUCK_ASSIGNMENT");
  });

  await check("7 two assigned trucks fail closed -- never pick one", async () => {
    const t = await seedCounter({ trucks: 2 });
    const e = await CALL.runGetCycleCountAssignedMobileLocation(req(t.uid), db).catch((x) => x);
    assert.equal(e.code, "failed-precondition"); assert.equal(e.details.code, "TRUCK_ASSIGNMENT_AMBIGUOUS");
  });

  await check("8 no technician mapping is distinguishable from no truck assignment", async () => {
    const uid = nextId("uid");
    await db.collection("users").doc(uid).set({ accessVersion: 1 }); // no technicianId
    await db.collection("roleAssignments").doc(`${uid}-counter`).set({
      principalUid: uid, roleId: "inventoryCycleCountCounter", scope: { type: "global" },
      grantedBy: "t", grantedAt: T0, status: "active", accessVersionAtGrant: 1,
    });
    assert.equal(await codeOf(CALL.runGetCycleCountAssignedMobileLocation(req(uid), db)), "TECHNICIAN_IDENTITY_UNAVAILABLE");
  });

  await check("9 another technician's truck is structurally unreachable -- there is no input that names it", async () => {
    const me = await seedCounter();
    const other = await seedCounter();
    const meResult = await CALL.runGetCycleCountAssignedMobileLocation(req(me.uid), db);
    assert.notEqual(meResult.location.locationId, other.truckLoc);
    // The request carries no fields at all: extra input is simply ignored, never a location override.
    const withStrayInput = await CALL.runGetCycleCountAssignedMobileLocation(req(me.uid, { locationId: other.truckLoc, truckId: "x" }), db);
    assert.equal(withStrayInput.location.locationId, me.truckLoc, "caller-supplied fields cannot redirect to another truck");
  });
} finally {
  if (prev === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = prev;
  __resetRuntimeCapabilityOverridesCacheForTest();
}

// ---- static fences: no new Rules, no client trucks-collection browse -------------------------
await check("no Rules change: cycle_counts stays fully denied, trucks/users rules untouched by this feature", async () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const blocks = [...rules.matchAll(/match \/cycle_counts\/\{[^}]+\}\s*\{([^}]*)\}/g)];
  assert.equal(blocks.length, 1, "exactly one cycle_counts rule");
  assert.match(blocks[0][1], /allow read, write: if false;/, "cycle_counts stays fully denied");
});
await check("the new read rides the existing Cycle Count capability pair, not a new capability id", async () => {
  const src = readFileSync(new URL("../src/cycleCount/cycleCountSheetCallables.ts", import.meta.url), "utf8");
  assert.match(src, /getCycleCountAssignedMobileLocationCallable[\s\S]*?runGetCycleCountAssignedMobileLocation/);
  assert.match(src, /permissionIds:\s*\[CYCLE_COUNT_CAPABILITY\.create,\s*CYCLE_COUNT_CAPABILITY\.submit\]/);
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(index, /getCycleCountAssignedMobileLocationCallable as getCycleCountAssignedMobileLocation/);
});
await check("no client-side trucks collection browse was introduced by this file", async () => {
  const src = readFileSync(new URL("../src/cycleCount/cycleCountSheetCallables.ts", import.meta.url), "utf8");
  // The read returns exactly one resolved location; it never returns a list of trucks.
  assert.doesNotMatch(src, /trucks\.map|\.docs\.map.*truck/i);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
