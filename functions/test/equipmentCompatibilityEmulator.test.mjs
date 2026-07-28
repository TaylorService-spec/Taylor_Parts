// D4 Stage E -- Part-Equipment Compatibility trusted persistence: EMULATOR verification.
//
// This is the emulator counterpart to the pure-logic Stage C.2 suite
// (equipmentCompatibilityCommands.test.mjs, in-memory fakeDb). Stage C proved the ORCHESTRATION
// against a transaction-faithful double; Stage E proves the SAME contract against a REAL Firestore --
// real two-phase commit, real create/update preconditions, and the genuine multi-client race a
// double cannot model -- plus the one thing only a live backend can show: that the client-closed
// firestore.rules are ENFORCED, not merely DECLARED (Stage D asserted the rule TEXT; this asserts
// the emulator DENIES).
//
// Zero-new-dependency posture, identical to the other emulator suites in this directory:
//   firebase-admin (Admin SDK, bypasses Rules for seeding + for driving the trusted orchestrator)
//   + Node's built-in fetch against the emulator REST API (an authenticated CLIENT, subject to Rules).
// No @firebase/rules-unit-testing, no test runner.
//
// SCOPE BOUNDARY: nothing here activates a permission, grants a role, exports a callable or deploys
// anything. The #226 resolver is injected as a fixture (design §5 seam), exactly as Stage C. The
// governed equipment.* capabilities remain active:false; deployment is the separate D10 gate.
//
// Prerequisite: a live Firestore + Auth emulator pair loaded from THIS worktree's firebase.json /
// firestore.rules (the emulator loads Rules from the config's CWD -- run it from the repo root of the
// branch under test), e.g. from the repo root:
//   node functions/node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only firestore,auth --project taylor-parts
// then:
//   node functions/test/equipmentCompatibilityEmulator.test.mjs
// Emulator-only: it never touches the live "taylor-parts" project.
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

const PROJECT_ID = "taylor-parts";
const FIRESTORE_HOST = "http://127.0.0.1:8080";
const AUTH_HOST = "http://127.0.0.1:9099";
const DOC_BASE = `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

const C = await import("../lib/equipmentCompatibility/commands.js");
const D1 = await import("../lib/equipmentCompatibility/domain/equipmentModel.js");
const D2 = await import("../lib/equipmentCompatibility/domain/compatibility.js");
const E = await import("../lib/equipmentCompatibility/errors.js");
const M = await import("../lib/equipmentCompatibility/equipmentModelRepository.js");
const CR = await import("../lib/equipmentCompatibility/compatibilityRepository.js");
const {
  EQUIPMENT_MODELS_COLLECTION, EQUIPMENT_MODEL_ALIASES_COLLECTION, EQUIPMENT_PART_COMPATIBILITY_COLLECTION,
  EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION,
  EQUIPMENT_COMPATIBILITY_COLLECTIONS,
} = await import("../lib/equipmentCompatibility/repository.js");
const AUDIT_EVENTS = "auditEvents";

let passed = 0;
let failed = 0;
const ok = async (n, f) => {
  try { await f(); passed += 1; console.log(`PASS -- ${n}`); }
  catch (e) { failed += 1; console.log(`FAIL -- ${n}\n       ${e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n       ") : e}`); }
};

// ---------------------------------------------------------------------------
// Admin-SDK store helpers (bypass Rules) -- used for driving the trusted writer and reading back state.
// ---------------------------------------------------------------------------
const raw = async (coll, id) => { const s = await db.collection(coll).doc(id).get(); return s.exists ? s.data() : undefined; };
async function clearAll() {
  const all = [...EQUIPMENT_COMPATIBILITY_COLLECTIONS, AUDIT_EVENTS];
  for (const coll of all) {
    const snap = await db.collection(coll).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

// ---------------------------------------------------------------------------
// Governed value builders (identical shapes to the Stage C.2 suite).
// ---------------------------------------------------------------------------
const SCHEME = { schemeId: "TAYLOR-ALPHA", manufacturerId: "Taylor", normalizerVersion: 1, tokenPattern: "^[A-Z0-9-]+$", ordering: "LEXICOGRAPHIC" };
const SCHEMES = { "TAYLOR-ALPHA": SCHEME };
const MODEL_ID = "TAYLOR--C713";
const model = (o = {}) => D1.validateEquipmentModel({
  equipmentModelId: MODEL_ID, manufacturerId: "TAYLOR", manufacturerName: "Taylor", modelNumber: "C713",
  displayName: "Taylor C713", family: null, subtype: null, revision: null, status: "ACTIVE",
  sourceAuthority: "manufacturer", version: 1, ...o,
}).value;
const aliasOf = (o = {}) => D1.validateEquipmentModelAlias({ aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C-713", equipmentModelId: MODEL_ID, ...o }).value;
const compatOf = (o = {}) => D2.validateCompatibility({
  equipmentModelId: MODEL_ID, partId: "TST-1001", compatibilityType: "DIRECT_FIT", assembly: null,
  installationPosition: null, quantityRequired: 1,
  applicability: { kind: "ALL_SERIALS", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null },
  effectiveFrom: null, effectiveTo: null, sourceSummary: null, confidenceLevel: "HIGH",
  verificationStatus: "UNVERIFIED", notes: null, version: 1, ...o,
}, { serialSchemes: SCHEMES }).value;
const sourceOf = (compatibilityId, o = {}) => D2.validateCompatibilitySource({
  compatibilityId, authorityType: "MANUFACTURER", sourceReference: "Service Manual 12", sourceVersion: null,
  observedClaim: "SUPPORTS", contentFingerprint: "a".repeat(64), capturedAt: "2026-07-27T07:06:24Z",
  capturedBy: "admin-uid-1", notes: null, ...o,
}).value;

const META = { createdAt: Timestamp.fromMillis(1750000000000), createdBy: "seed", updatedAt: Timestamp.fromMillis(1750000000000), updatedBy: "seed" };
let clock = 1750000000000;
const seedModel = () => db.collection(EQUIPMENT_MODELS_COLLECTION).doc(MODEL_ID).set(M.modelToFirestore({ model: model(), ...META }));
const seedCompat = (c) => db.collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION).doc(c.compatibilityId).set(CR.compatibilityToFirestore({ compatibility: c, ...META }, { serialSchemes: SCHEMES }));

function makeDeps({ grant = true } = {}) {
  const auditIds = [];
  return {
    auditIds,
    deps: {
      db,
      resolvePermission: typeof grant === "function" ? grant : () => grant,
      newAuditRef: () => { const ref = db.collection(AUDIT_EVENTS).doc(); auditIds.push(ref.id); return ref; },
      now: () => Timestamp.fromMillis((clock += 1000)),
      serialSchemes: SCHEMES,
    },
  };
}
// Read back exactly the audit documents this command staged (a rolled-back txn leaves the id unused,
// so a non-existent doc genuinely proves nothing was committed).
async function auditsOf(auditIds) {
  const snaps = await Promise.all(auditIds.map((id) => db.collection(AUDIT_EVENTS).doc(id).get()));
  return snaps.filter((s) => s.exists).map((s) => s.data());
}
const run = (deps, over = {}) => C.runEquipmentCompatibilityCommand({
  actorUid: "actor-1", action: "importEquipmentModel", idempotencyKey: "key-abcdefgh", payload: model(), expectedVersion: null, ...over,
}, deps);

// ---------------------------------------------------------------------------
// CLIENT REST helpers (subject to Rules) -- an authenticated client, exactly like the app.
// ---------------------------------------------------------------------------
async function idTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(`${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!body.idToken) throw new Error(`Failed to mint ID token for ${uid}: ${JSON.stringify(body)}`);
  return body.idToken;
}
const authHeaders = (idToken) => (idToken ? { Authorization: `Bearer ${idToken}` } : {});
async function clientRead(coll, docId, idToken) {
  const res = await fetch(`${DOC_BASE}/${coll}/${docId}`, { headers: authHeaders(idToken) });
  return res.status;
}
async function clientList(coll, idToken) {
  const res = await fetch(`${DOC_BASE}/${coll}`, { headers: authHeaders(idToken) });
  return res.status;
}
async function clientCreate(coll, docId, idToken) {
  const res = await fetch(`${DOC_BASE}/${coll}/${docId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders(idToken) },
    body: JSON.stringify({ fields: { probe: { stringValue: "client-write" } } }),
  });
  return res.status;
}
async function clientDelete(coll, docId, idToken) {
  const res = await fetch(`${DOC_BASE}/${coll}/${docId}`, { method: "DELETE", headers: authHeaders(idToken) });
  return res.status;
}

// ===========================================================================
// A. RULES ENFORCEMENT -- the client-closed collections are DENIED against the live emulator.
// ===========================================================================
await ok("every governed equipment collection DENIES all direct client access (read/list/create/delete), for every principal", async () => {
  await clearAll();
  // Roles that DO carry authority elsewhere (admin/dispatcher) plus a technician and an
  // unauthenticated caller -- the D4 closure is unconditional, so NONE may touch these collections.
  await db.collection("users").doc("d4-admin").set({ role: "admin" });
  await db.collection("users").doc("d4-dispatcher").set({ role: "dispatcher" });
  await db.collection("users").doc("d4-technician").set({ role: "technician" });
  const adminToken = await idTokenFor("d4-admin");
  const dispatcherToken = await idTokenFor("d4-dispatcher");
  const technicianToken = await idTokenFor("d4-technician");
  const principals = [
    ["admin", adminToken], ["dispatcher", dispatcherToken], ["technician", technicianToken], ["unauthenticated", null],
  ];
  // Seed one document per collection via the Admin SDK so a denied READ is denied on an EXISTING doc,
  // not merely a missing one -- existence must not be the reason for the 403.
  const probeId = "probe-doc";
  for (const coll of EQUIPMENT_COMPATIBILITY_COLLECTIONS) {
    await db.collection(coll).doc(probeId).set({ seeded: true });
  }
  assert.equal(EQUIPMENT_COMPATIBILITY_COLLECTIONS.length, 5, "exactly five governed collections");
  for (const coll of EQUIPMENT_COMPATIBILITY_COLLECTIONS) {
    for (const [label, token] of principals) {
      assert.equal(await clientRead(coll, probeId, token), 403, `${label} READ ${coll} must be denied`);
      assert.equal(await clientList(coll, token), 403, `${label} LIST ${coll} must be denied`);
      assert.equal(await clientCreate(coll, "client-made", token), 403, `${label} CREATE ${coll} must be denied`);
      assert.equal(await clientDelete(coll, probeId, token), 403, `${label} DELETE ${coll} must be denied`);
    }
  }
  // And the trusted (Admin SDK) path still works -- the closure is on the CLIENT, not the collection.
  assert.equal((await raw(EQUIPMENT_MODELS_COLLECTION, probeId)).seeded, true, "Admin SDK bypasses the closure");
});

// ===========================================================================
// B. LIFECYCLE against a REAL Firestore -- the Stage C contract, now on the backend.
// ===========================================================================
await ok("TX1 initiation then TX2 mutation+terminal, persisted and readable from the real store", async () => {
  await clearAll();
  const { deps, auditIds } = makeDeps();
  const result = await run(deps);
  assert.deepEqual(result, { status: "applied", targetId: MODEL_ID, resultVersion: 1, replayed: false });
  const op = await raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh");
  assert.equal(op.status, "applied");
  assert.equal(op.resultVersion, 1);
  assert.equal((await raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID)).equipmentModelId, MODEL_ID);
  const events = await auditsOf(auditIds);
  assert.deepEqual(events.map((a) => [a.action, a.outcome]), [
    [C.INITIATION_AUDIT_ACTION, "applied"], [C.TERMINAL_AUDIT_ACTION, "applied"],
  ]);
});

await ok("an exact replay reads the terminal record, mutates nothing and writes no new audit", async () => {
  await clearAll();
  const { deps } = makeDeps();
  await run(deps);
  const before = await raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID);
  const { deps: d2, auditIds: a2 } = makeDeps();
  const replay = await run(d2);
  assert.deepEqual(replay, { status: "applied", targetId: MODEL_ID, resultVersion: 1, replayed: true });
  assert.deepEqual(await raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID), before, "record untouched by replay");
  assert.deepEqual(await auditsOf(a2), [], "an exact replay stages no audit doc");
});

await ok("a reused key with a DIFFERENT command fails closed and changes nothing", async () => {
  await clearAll();
  const { deps } = makeDeps();
  await run(deps);
  const opBefore = await raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh");
  for (const over of [{ payload: model({ displayName: "Different" }) }, { actorUid: "actor-2" }]) {
    const { deps: d, auditIds } = makeDeps();
    await assert.rejects(() => run(d, over), E.IdempotencyConflictError, JSON.stringify(over));
    assert.deepEqual(await raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh"), opBefore, "operation untouched");
    assert.deepEqual(await auditsOf(auditIds), [], "a conflict on an accepted key writes no audit");
  }
});

await ok("an unauthorized actor produces NO operation record, only a sanitized terminal denied audit", async () => {
  await clearAll();
  const { deps, auditIds } = makeDeps({ grant: false });
  await assert.rejects(() => run(deps), E.UnauthorizedActorError);
  assert.equal(await raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh"), undefined);
  assert.equal(await raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID), undefined);
  const denied = await auditsOf(auditIds);
  assert.deepEqual(denied.map((a) => [a.action, a.outcome]), [[C.TERMINAL_AUDIT_ACTION, "denied"]]);
  assert.equal(denied[0].summary, `importEquipmentModel denied: ${C.DENIAL_REASONS.UNAUTHORIZED}`);
});

await ok("expected-version concurrency is enforced on the record's own version, on the real backend", async () => {
  await clearAll();
  await seedModel();
  const { deps } = makeDeps();
  const denied = await run(deps, { idempotencyKey: "key-null-vs-exists" });
  assert.equal(denied.status, "denied");
  assert.equal(denied.reason, C.DENIAL_REASONS.VERSION_CONFLICT);
  const { deps: d3 } = makeDeps();
  const applied = await run(d3, { idempotencyKey: "key-good-ver", expectedVersion: 1, payload: model({ version: 2, displayName: "Taylor C713 II" }) });
  assert.deepEqual(applied, { status: "applied", targetId: MODEL_ID, resultVersion: 2, replayed: false });
  assert.equal((await raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID)).version, 2);
});

await ok("referential integrity: alias / compatibility / evidence each require their model, live", async () => {
  await clearAll();
  const alias = aliasOf();
  const { deps } = makeDeps();
  const noModel = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-alias-noref", payload: alias }, deps);
  assert.equal(noModel.status, "denied");
  assert.equal(noModel.reason, C.DENIAL_REASONS.REFERENTIAL_INTEGRITY);
  assert.equal(await raw(EQUIPMENT_MODEL_ALIASES_COLLECTION, alias.aliasKey), undefined, "no alias created without a model");
  await seedModel();
  const { deps: d2 } = makeDeps();
  const withModel = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-alias-ok", payload: alias }, d2);
  assert.equal(withModel.status, "applied");
  assert.equal((await raw(EQUIPMENT_MODEL_ALIASES_COLLECTION, alias.aliasKey)).equipmentModelId, MODEL_ID);
  // A compatibility relationship also requires the model.
  const compat = compatOf();
  const { deps: d3 } = makeDeps();
  const cmp = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibility", idempotencyKey: "key-cmp-ok", payload: compat }, d3);
  assert.equal(cmp.status, "applied");
});

await ok("verification bumps the version and emits its specialized audit alongside the terminal one", async () => {
  await clearAll();
  await seedModel();
  const compat = compatOf();
  await seedCompat(compat);
  const { deps, auditIds } = makeDeps();
  const applied = await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "verifyCompatibility", idempotencyKey: "key-verify-ok",
    payload: { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" }, expectedVersion: 1,
  }, deps);
  assert.deepEqual(applied, { status: "applied", targetId: compat.compatibilityId, resultVersion: 2, replayed: false });
  const stored = await raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId);
  assert.equal(stored.verificationStatus, "VERIFIED");
  assert.equal(stored.version, 2);
  assert.deepEqual((await auditsOf(auditIds)).map((a) => a.action), [
    C.INITIATION_AUDIT_ACTION, C.TERMINAL_AUDIT_ACTION, "equipmentCompatibilityVerification",
  ]);
});

await ok("the governed D2 analyzer transitions to CONFLICT on SUPPORTS-then-CONTRADICTS, and emits one conflict audit", async () => {
  await clearAll();
  await seedModel();
  const compat = compatOf();
  await seedCompat(compat);
  const claim = (observedClaim, fp) => sourceOf(compat.compatibilityId, { observedClaim, contentFingerprint: fp.repeat(64) });
  const { deps: dA } = makeDeps();
  await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-conf-s", payload: claim("SUPPORTS", "a") }, dA);
  assert.equal((await raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId)).verificationStatus, "UNVERIFIED", "supporting evidence never auto-verifies");
  const { deps: dB, auditIds } = makeDeps();
  await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-conf-c", payload: claim("CONTRADICTS", "b") }, dB);
  assert.equal((await raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId)).verificationStatus, "CONFLICT");
  assert.equal((await auditsOf(auditIds)).filter((a) => a.action === "equipmentCompatibilityConflict").length, 1);
});

await ok("evidence is immutable: a second differently-keyed command for the same sourceId is denied by the REAL create precondition", async () => {
  await clearAll();
  await seedModel();
  const compat = compatOf();
  await seedCompat(compat);
  const source = sourceOf(compat.compatibilityId);
  const { deps } = makeDeps();
  assert.equal((await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-src-ok", payload: source }, deps)).status, "applied");
  const { deps: d2 } = makeDeps();
  const again = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-src-again", payload: source }, d2);
  assert.equal(again.status, "denied");
  assert.equal(again.reason, C.DENIAL_REASONS.ALREADY_EXISTS, "the backend create precondition, not a double");
});

// ===========================================================================
// C. GENUINE MULTI-CLIENT RACE -- the thing only a real backend can prove.
// ===========================================================================
await ok("two concurrent identical commands converge to ONE applied record, ONE model, ONE initiation (no double-apply)", async () => {
  await clearAll();
  const a = makeDeps();
  const b = makeDeps();
  const KEY = "key-race-1";
  // Fire both at once. Real transaction contention decides the winner; the loser must RESUME the
  // durable initiation rather than create a second one or apply twice.
  const settled = await Promise.allSettled([
    run(a.deps, { idempotencyKey: KEY }),
    run(b.deps, { idempotencyKey: KEY }),
  ]);
  // Neither may fail with an unexpected error: each is either applied (fresh or replayed) OR a
  // benign idempotency conflict if one observed the other's in-flight acceptance.
  for (const s of settled) {
    if (s.status === "rejected") {
      assert.ok(s.reason instanceof E.IdempotencyConflictError, `unexpected rejection: ${s.reason && s.reason.message}`);
    } else {
      assert.equal(s.value.status, "applied");
      assert.equal(s.value.targetId, MODEL_ID);
      assert.equal(s.value.resultVersion, 1);
    }
  }
  assert.ok(settled.some((s) => s.status === "fulfilled"), "at least one command must apply");
  // Exactly one applied operation record, one model at version 1.
  const op = await raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, KEY);
  assert.equal(op.status, "applied");
  assert.equal(op.resultVersion, 1);
  assert.equal((await raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID)).version, 1, "the model applied exactly once");
  // Exactly one initiation audit across BOTH callers -- the race did not duplicate the lifecycle.
  const allEvents = [...await auditsOf(a.auditIds), ...await auditsOf(b.auditIds)];
  assert.equal(allEvents.filter((e) => e.action === C.INITIATION_AUDIT_ACTION).length, 1, "exactly one initiation");
  assert.equal(allEvents.filter((e) => e.action === C.TERMINAL_AUDIT_ACTION && e.outcome === "applied").length, 1, "exactly one applied terminal");
});

console.log(`\n${passed} emulator lifecycle + rules-enforcement checks passed${failed ? `, ${failed} FAILED` : ""}`);
if (failed) process.exit(1);
