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
const FIRESTORE_HOST = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
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
// B. THE CATALOG FREEZE against a REAL Firestore.
//
// CATALOG CUTOVER (step 2): CATALOG_WRITER_AUTHORITY is FROZEN/INACTIVE, and EVERY action of this orchestrator is a
// legacy Firestore catalog writer (equipmentModel.import, equipmentModelAlias.import, equipmentPartCompatibility.import /
// .verify / .correct, equipmentCompatibilitySource.import). The Stage E lifecycle proofs (TX1/TX2, replay, idempotency
// conflict, expected-version, referential integrity, verification, conflict surfacing, evidence immutability, the
// multi-client race) all required a command that APPLIES, so each is now the governed FROZEN refusal on the real backend
// (ruling A): the typed FirestoreCatalogWriterClosedError, NO operation record, NO catalog mutation, and nothing staged
// beyond the single pre-acceptance terminal "denied" audit. The pure lower-boundary proofs (operation state machine,
// fingerprint/isSameOperationCommand, the D2 analyzer, prepareCommand detachment) live in the offline
// equipmentCompatibilityCommands.test.mjs; the analyzer is also re-asserted below where this suite exercised it.
// ===========================================================================
const WRITER_OF = {
  importEquipmentModel: "equipmentModel.import", importEquipmentModelAlias: "equipmentModelAlias.import",
  importCompatibility: "equipmentPartCompatibility.import", verifyCompatibility: "equipmentPartCompatibility.verify",
  correctCompatibility: "equipmentPartCompatibility.correct", importCompatibilitySource: "equipmentCompatibilitySource.import",
};
const CATALOG_COLLECTIONS = [EQUIPMENT_MODELS_COLLECTION, EQUIPMENT_MODEL_ALIASES_COLLECTION, EQUIPMENT_PART_COMPATIBILITY_COLLECTION, EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION];
async function snapshotCatalog() {
  const out = {};
  for (const coll of CATALOG_COLLECTIONS) {
    const snap = await db.collection(coll).get();
    out[coll] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
  }
  return out;
}
// The denial REASON is the governed state refusal "catalog_writer_closed" -- never "internal_error" (the class-C finding of
// the freeze fix cycle, repaired in denialReasonFor()).
async function assertFrozen(input, { grant = true } = {}) {
  const action = input.action ?? "importEquipmentModel";
  const before = await snapshotCatalog();
  let resolverCalls = 0;
  const { deps, auditIds } = makeDeps({ grant: () => { resolverCalls += 1; return grant; } });
  await assert.rejects(() => run(deps, input), (e) => e && e.name === "FirestoreCatalogWriterClosedError" && e.code === "FIRESTORE_CATALOG_WRITER_FROZEN" && e.writer === WRITER_OF[action], `${action} must be refused FROZEN`);
  assert.equal(resolverCalls, 0, `${action}: refused before capability resolution`);
  assert.equal(await raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, input.idempotencyKey ?? "key-abcdefgh"), undefined, `${action}: NO operation record`);
  assert.deepEqual(await snapshotCatalog(), before, `${action}: NO catalog mutation of any governed collection`);
  const events = await auditsOf(auditIds);
  assert.deepEqual(events.map((a) => [a.action, a.outcome]), [[C.TERMINAL_AUDIT_ACTION, "denied"]], `${action}: no initiation, no applied, no specialized audit`);
  assert.match(events[0].summary, / denied: catalog_writer_closed$/, `${action}: audited as a state refusal, never internal_error`);
}

// Ruling A: TX1/TX2 need an accepted import -- the frozen legacy writer refuses it before TX1.
await ok("importEquipmentModel is refused FROZEN on the real backend: no initiation, no operation record, no model", async () => {
  await clearAll();
  await assertFrozen({});
});

// Ruling A: an exact replay needs a terminal record, which a frozen writer never creates; every retry is refused FROZEN.
await ok("an exact retry is refused FROZEN every time and never creates a record to replay", async () => {
  await clearAll();
  await assertFrozen({});
  await assertFrozen({});
});

// Ruling A: a reused key needs an accepted operation to conflict with; each variant is refused FROZEN and changes nothing.
await ok("a reused key with a DIFFERENT command is refused FROZEN (nothing was accepted to conflict with)", async () => {
  await clearAll();
  await assertFrozen({});
  for (const over of [{ payload: model({ displayName: "Different" }) }, { actorUid: "actor-2" }]) await assertFrozen(over);
});

// Ruling A: the freeze gate sits BEFORE capability resolution, so even an unauthorized actor gets the FROZEN refusal.
await ok("an unauthorized actor is refused FROZEN before authorization: NO operation record, NO model", async () => {
  await clearAll();
  await assertFrozen({}, { grant: false });
});

// Ruling A: expected-version is decided in TX2 against the stored model; the update is refused FROZEN, model untouched.
await ok("an expected-version update is refused FROZEN on the real backend; the stored model is untouched", async () => {
  await clearAll();
  await seedModel();
  await assertFrozen({ idempotencyKey: "key-null-vs-exists" });
  await assertFrozen({ idempotencyKey: "key-good-ver", expectedVersion: 1, payload: model({ version: 2, displayName: "Taylor C713 II" }) });
  assert.equal((await raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID)).version, 1);
});

// Ruling A: referential integrity is decided in TX2; alias / compatibility / evidence imports are all refused FROZEN,
// with and without their referents present.
await ok("alias / compatibility / evidence imports are each refused FROZEN, with or without their referents", async () => {
  await clearAll();
  const alias = aliasOf();
  const compat = compatOf();
  const source = sourceOf(compat.compatibilityId);
  await assertFrozen({ action: "importEquipmentModelAlias", idempotencyKey: "key-alias-noref", payload: alias });
  await assertFrozen({ action: "importCompatibility", idempotencyKey: "key-cmp-noref", payload: compat });
  await seedModel();
  await assertFrozen({ action: "importCompatibilitySource", idempotencyKey: "key-src-noref", payload: source });
  await assertFrozen({ action: "importEquipmentModelAlias", idempotencyKey: "key-alias-ok", payload: alias });
  await assertFrozen({ action: "importCompatibility", idempotencyKey: "key-cmp-ok", payload: compat });
  await seedCompat(compat);
  await assertFrozen({ action: "importCompatibilitySource", idempotencyKey: "key-src-ok", payload: source });
});

// Ruling A: verification writes the compatibility relationship (a frozen catalog writer); refused, relationship untouched.
await ok("verification is refused FROZEN: the relationship keeps its version and status, no specialized audit", async () => {
  await clearAll();
  await seedModel();
  const compat = compatOf();
  await seedCompat(compat);
  await assertFrozen({ action: "verifyCompatibility", idempotencyKey: "key-verify-ok", payload: { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" }, expectedVersion: 1 });
  const stored = await raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId);
  assert.equal(stored.verificationStatus, "UNVERIFIED");
  assert.equal(stored.version, 1);
});

// Ruling A (the evidence imports that would flip the relationship are refused FROZEN; it stays UNVERIFIED) + Ruling B (the
// governed D2 analyzer still decides SUPPORTS + CONTRADICTS is a CONFLICT -- the pure module the command delegates to).
await ok("evidence imports are refused FROZEN (no CONFLICT transition); the governed D2 analyzer still calls SUPPORTS+CONTRADICTS a conflict", async () => {
  await clearAll();
  await seedModel();
  const compat = compatOf();
  await seedCompat(compat);
  const claim = (observedClaim, fp) => sourceOf(compat.compatibilityId, { observedClaim, contentFingerprint: fp.repeat(64) });
  await assertFrozen({ action: "importCompatibilitySource", idempotencyKey: "key-conf-s", payload: claim("SUPPORTS", "a") });
  await assertFrozen({ action: "importCompatibilitySource", idempotencyKey: "key-conf-c", payload: claim("CONTRADICTS", "b") });
  assert.equal((await raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId)).verificationStatus, "UNVERIFIED");
  const analysis = D2.analyzeCompatibilityEvidence([claim("SUPPORTS", "a"), claim("CONTRADICTS", "b")], { expectedCompatibilityId: compat.compatibilityId });
  assert.equal(analysis.hasConflict, true);
  assert.equal(analysis.recommendedStatus, "CONFLICT");
  assert.equal(D2.analyzeCompatibilityEvidence([claim("SUPPORTS", "a")], { expectedCompatibilityId: compat.compatibilityId }).hasConflict, false, "supporting evidence alone never conflicts");
});

// Ruling A: evidence immutability is the create precondition of an accepted import; both imports are refused FROZEN.
await ok("evidence imports for the same sourceId are each refused FROZEN; no evidence document exists", async () => {
  await clearAll();
  await seedModel();
  const compat = compatOf();
  await seedCompat(compat);
  const source = sourceOf(compat.compatibilityId);
  await assertFrozen({ action: "importCompatibilitySource", idempotencyKey: "key-src-ok", payload: source });
  await assertFrozen({ action: "importCompatibilitySource", idempotencyKey: "key-src-again", payload: source });
  assert.equal(await raw(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, source.sourceId), undefined);
});

// ===========================================================================
// C. GENUINE MULTI-CLIENT RACE -- against the frozen writer.
// ===========================================================================
// Ruling A: two concurrent identical commands are BOTH refused FROZEN -- no operation, no model, no initiation.
await ok("two concurrent identical commands are BOTH refused FROZEN: no operation record, no model, no initiation", async () => {
  await clearAll();
  const a = makeDeps();
  const b = makeDeps();
  const KEY = "key-race-1";
  const settled = await Promise.allSettled([run(a.deps, { idempotencyKey: KEY }), run(b.deps, { idempotencyKey: KEY })]);
  for (const st of settled) {
    assert.equal(st.status, "rejected");
    assert.equal(st.reason && st.reason.code, "FIRESTORE_CATALOG_WRITER_FROZEN");
  }
  assert.equal(await raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, KEY), undefined);
  assert.equal(await raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID), undefined);
  const allEvents = [...await auditsOf(a.auditIds), ...await auditsOf(b.auditIds)];
  assert.equal(allEvents.filter((e) => e.action === C.INITIATION_AUDIT_ACTION).length, 0, "no initiation");
  assert.equal(allEvents.filter((e) => e.outcome === "applied").length, 0, "nothing applied");
});

console.log(`\n${passed} emulator freeze + rules-enforcement checks passed${failed ? `, ${failed} FAILED` : ""}`);
if (failed) process.exit(1);
