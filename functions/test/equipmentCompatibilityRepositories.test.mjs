// D4 Stage B.2 -- repository adapter tests. NO EMULATOR REQUIRED: the adapters are exercised through an
// in-memory Firestore double that implements only the narrow surface they use (collection/doc/get/
// create/set, snapshot id/exists/data). This keeps the checks in the existing pure-logic CI workflow;
// the full emulator lifecycle proofs are Stage E, per the design package.
//
// What these prove: identity/validation is genuinely DELEGATED to D1/D2, document identity IS domain
// identity for all five collections, malformed stored data fails closed as MalformedStoredRecordError
// (never silently repaired, never reported as absent), evidence is create-only, and the operation
// state machine's illegal transitions are unreachable through the repository surface.
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";

const {
  EQUIPMENT_COMPATIBILITY_COLLECTIONS, EQUIPMENT_MODELS_COLLECTION, EQUIPMENT_MODEL_ALIASES_COLLECTION,
  EQUIPMENT_PART_COMPATIBILITY_COLLECTION, EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION,
  EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, MalformedStoredRecordError,
} = await import("../lib/equipmentCompatibility/repository.js");
const M = await import("../lib/equipmentCompatibility/equipmentModelRepository.js");
const C = await import("../lib/equipmentCompatibility/compatibilityRepository.js");
const O = await import("../lib/equipmentCompatibility/operationRepository.js");
const D2 = await import("../lib/equipmentCompatibility/domain/compatibility.js");
const { IllegalOperationTransitionError } = await import("../lib/equipmentCompatibility/errors.js");

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`PASS -- ${n}`); };
const okAsync = async (n, f) => { await f(); passed++; console.log(`PASS -- ${n}`); };

// ---- in-memory Firestore double ----
function fakeDb() {
  const store = new Map(); // "collection/docId" -> data
  const writes = [];       // ordered log of {op, path, data}
  const key = (c, d) => `${c}/${d}`;
  const db = {
    collection: (c) => ({
      doc: (d) => {
        if (typeof d !== "string" || d.length === 0) throw new Error(`invalid doc id ${String(d)}`);
        if (d.includes("/")) throw new Error(`doc id crosses a path segment: ${d}`);
        return { __c: c, __d: d, async get() { return snap(c, d); } };
      },
    }),
    __store: store, __writes: writes,
    __seed: (c, d, data) => store.set(key(c, d), data),
    __get: (c, d) => store.get(key(c, d)),
  };
  const snap = (c, d) => ({ id: d, exists: store.has(key(c, d)), data: () => store.get(key(c, d)) });
  const txn = {
    async get(ref) { return snap(ref.__c, ref.__d); },
    create(ref, data) {
      const k = key(ref.__c, ref.__d);
      if (store.has(k)) throw new Error(`ALREADY_EXISTS: ${k}`);
      store.set(k, data); writes.push({ op: "create", path: k, data });
    },
    set(ref, data) {
      const k = key(ref.__c, ref.__d);
      store.set(k, data); writes.push({ op: "set", path: k, data });
    },
  };
  return { db, txn };
}

// ---- fixtures ----
const NOW = new Date(1750000000000);
const meta = { createdAt: NOW, createdBy: "actor-1", updatedAt: NOW, updatedBy: "actor-1" };
const MODEL_ID = "TAYLOR--C713";
const model = { equipmentModelId: MODEL_ID, manufacturerId: "TAYLOR", manufacturerName: "Taylor", modelNumber: "C713", displayName: "Taylor C713", family: null, subtype: null, revision: null, status: "ACTIVE", sourceAuthority: "manufacturer", version: 1 };
const aliasInput = { aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C-713", equipmentModelId: MODEL_ID };
const ALIAS_KEY = "SOURCE_MODEL|TAYLOR|C-713";
const compatInput = { equipmentModelId: MODEL_ID, partId: "TST-1001", compatibilityType: "DIRECT_FIT", assembly: null, installationPosition: null, quantityRequired: 1, applicability: { kind: "ALL_SERIALS", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null }, effectiveFrom: null, effectiveTo: null, sourceSummary: null, confidenceLevel: "HIGH", verificationStatus: "VERIFIED", notes: null, version: 1 };
const compat = D2.validateCompatibility(compatInput).value;
const sourceInput = { compatibilityId: compat.compatibilityId, authorityType: "MANUFACTURER", sourceReference: "Service Manual 12", sourceVersion: null, observedClaim: "SUPPORTS", contentFingerprint: "a".repeat(64), capturedAt: "2026-07-27T07:06:24Z", capturedBy: "admin-uid-1", notes: null };
const source = D2.validateCompatibilitySource(sourceInput).value;
const T0 = Timestamp.fromMillis(1000), T1 = Timestamp.fromMillis(2000);
const opInitiated = { idempotencyKey: "key-abcdefgh", actorUid: "actor-1", action: "importCompatibility", targetType: "equipment_part_compatibility", targetId: compat.compatibilityId, commandFingerprint: "b".repeat(64), expectedVersion: null, resultVersion: null, status: "initiated", initiatedAt: T0, terminalAt: null };
const opApplied = { ...opInitiated, status: "applied", resultVersion: 1, terminalAt: T1 };
const opDenied = { ...opInitiated, status: "denied", resultVersion: null, terminalAt: T1 };

// ---- collection surface ----
ok("exactly the five governed collections are reachable", () => {
  assert.deepEqual([...EQUIPMENT_COMPATIBILITY_COLLECTIONS], [
    "equipment_models", "equipment_model_aliases", "equipment_part_compatibility",
    "equipment_compatibility_sources", "equipment_compatibility_operations",
  ]);
  assert.equal(Object.isFrozen(EQUIPMENT_COMPATIBILITY_COLLECTIONS), true);
});

// ---- equipment_models ----
await okAsync("model round-trips, and document identity IS the canonical model id", async () => {
  const { db, txn } = fakeDb();
  const repo = M.buildFirestoreEquipmentModelRepository(db);
  repo.stageCreate(txn, { model, ...meta });
  assert.deepEqual(db.__writes.map((w) => [w.op, w.path]), [["create", `${EQUIPMENT_MODELS_COLLECTION}/${MODEL_ID}`]]);
  const read = await repo.getById(txn, MODEL_ID);
  assert.equal(read.model.equipmentModelId, MODEL_ID);
  assert.equal(read.model.version, 1);
  assert.equal(read.createdBy, "actor-1");
  assert.deepEqual(read.createdAt, NOW);
  assert.equal(await repo.getById(txn, "TAYLOR--MISSING"), null, "absent reads as null");
});
ok("model persistence delegates to D1 and refuses invalid or noncanonical records", () => {
  const { db, txn } = fakeDb();
  const repo = M.buildFirestoreEquipmentModelRepository(db);
  assert.throws(() => repo.stageCreate(txn, { model: { ...model, status: "BOGUS" }, ...meta }), MalformedStoredRecordError);
  assert.throws(() => repo.stageCreate(txn, { model: { ...model, version: 0 }, ...meta }), MalformedStoredRecordError);
  assert.throws(() => repo.stageCreate(txn, { model: { ...model, equipmentModelId: "taylor--c713" }, ...meta }), MalformedStoredRecordError);
  assert.equal(db.__writes.length, 0, "nothing is staged when validation fails");
});
await okAsync("malformed stored model fails closed rather than reading as absent or repaired", async () => {
  const { db, txn } = fakeDb();
  const repo = M.buildFirestoreEquipmentModelRepository(db);
  const good = M.modelToFirestore({ model, ...meta });
  db.__seed(EQUIPMENT_MODELS_COLLECTION, MODEL_ID, { ...good, status: "BOGUS" });
  await assert.rejects(() => repo.getById(txn, MODEL_ID), MalformedStoredRecordError);
  db.__seed(EQUIPMENT_MODELS_COLLECTION, MODEL_ID, { ...good, equipmentModelId: "TAYLOR--OTHER" });
  await assert.rejects(() => repo.getById(txn, MODEL_ID), MalformedStoredRecordError, "id/field disagreement");
  const { createdBy, ...noActor } = good;
  db.__seed(EQUIPMENT_MODELS_COLLECTION, MODEL_ID, noActor);
  await assert.rejects(() => repo.getById(txn, MODEL_ID), MalformedStoredRecordError, "missing audit metadata");
  db.__seed(EQUIPMENT_MODELS_COLLECTION, MODEL_ID, { ...good, updatedAt: Timestamp.fromMillis(0) });
  await assert.rejects(() => repo.getById(txn, MODEL_ID), MalformedStoredRecordError, "updated before created");
});

// ---- equipment_model_aliases ----
await okAsync("alias doc id is the ENCODED key while identity stays the pure key", async () => {
  const { db, txn } = fakeDb();
  const repo = M.buildFirestoreEquipmentModelAliasRepository(db);
  const derived = M.deriveAliasDocId(aliasInput);
  assert.equal(derived.aliasKey, ALIAS_KEY);
  assert.equal(derived.docId, ALIAS_KEY, "no reserved characters in this key, so encoding is identity");
  const alias = { aliasType: "SOURCE_MODEL", manufacturerId: "TAYLOR", aliasValue: "C-713", aliasKey: ALIAS_KEY, equipmentModelId: MODEL_ID };
  repo.stageCreate(txn, { alias, ...meta });
  const read = await repo.getByAliasKey(txn, ALIAS_KEY);
  assert.equal(read.alias.aliasKey, ALIAS_KEY);
  assert.equal(read.alias.equipmentModelId, MODEL_ID);
});
await okAsync("a slash-bearing alias key is stored under a percent-encoded, single-segment doc id", async () => {
  const { db, txn } = fakeDb();
  const repo = M.buildFirestoreEquipmentModelAliasRepository(db);
  const derived = M.deriveAliasDocId({ ...aliasInput, rawValue: "C/713" });
  assert.equal(derived.aliasKey, "SOURCE_MODEL|TAYLOR|C/713");
  assert.equal(derived.docId, "SOURCE_MODEL|TAYLOR|C%2F713");
  const alias = { aliasType: "SOURCE_MODEL", manufacturerId: "TAYLOR", aliasValue: "C/713", aliasKey: derived.aliasKey, equipmentModelId: MODEL_ID };
  // The fake db throws if a doc id crosses a path segment, so this would fail loudly on a raw "/".
  repo.stageCreate(txn, { alias, ...meta });
  assert.equal(db.__writes[0].path, `${EQUIPMENT_MODEL_ALIASES_COLLECTION}/SOURCE_MODEL|TAYLOR|C%2F713`);
  const read = await repo.getByAliasKey(txn, derived.aliasKey);
  assert.equal(read.alias.aliasValue, "C/713", "identity keeps the slash");
});
ok("alias persistence refuses noncanonical keys and D1-invalid records", () => {
  const { db, txn } = fakeDb();
  const repo = M.buildFirestoreEquipmentModelAliasRepository(db);
  assert.throws(() => M.aliasDocIdFor("SOURCE_MODEL|TAYLOR CO|C-713"), MalformedStoredRecordError);
  assert.throws(() => M.aliasDocIdFor("nope"), MalformedStoredRecordError);
  assert.equal(M.deriveAliasDocId({ ...aliasInput, aliasType: "NOPE" }), null);
  assert.equal(M.deriveAliasDocId({ ...aliasInput, rawValue: "A".repeat(200) }), null, "beyond the governed value bound");
  assert.throws(() => repo.stageCreate(txn, { alias: { aliasType: "SOURCE_MODEL", manufacturerId: "TAYLOR", aliasValue: "C-713", aliasKey: ALIAS_KEY, equipmentModelId: "not-canonical" }, ...meta }), MalformedStoredRecordError);
});
await okAsync("a stored aliasKey that disagrees with its own segments fails closed", async () => {
  const { db, txn } = fakeDb();
  const repo = M.buildFirestoreEquipmentModelAliasRepository(db);
  const good = M.aliasToFirestore({ alias: { aliasType: "SOURCE_MODEL", manufacturerId: "TAYLOR", aliasValue: "C-713", aliasKey: ALIAS_KEY, equipmentModelId: MODEL_ID }, ...meta });
  // aliasKey still encodes to this doc id, but its segments no longer describe the stored alias value.
  db.__seed(EQUIPMENT_MODEL_ALIASES_COLLECTION, ALIAS_KEY, { ...good, aliasValue: "C-999" });
  await assert.rejects(() => repo.getByAliasKey(txn, ALIAS_KEY), MalformedStoredRecordError);
});

// ---- equipment_part_compatibility ----
await okAsync("compatibility round-trips under its deterministic id", async () => {
  const { db, txn } = fakeDb();
  const repo = C.buildFirestoreCompatibilityRepository(db);
  repo.stageCreate(txn, { compatibility: compat, ...meta });
  assert.equal(db.__writes[0].path, `${EQUIPMENT_PART_COMPATIBILITY_COLLECTION}/${compat.compatibilityId}`);
  const read = await repo.getById(txn, compat.compatibilityId);
  assert.equal(read.compatibility.compatibilityId, compat.compatibilityId);
  assert.equal(read.compatibility.uniquenessKey, compat.uniquenessKey);
  assert.equal(read.compatibility.version, 1);
});
await okAsync("a tampered stored compatibilityId is rejected because D2 re-derives it", async () => {
  const { db, txn } = fakeDb();
  const repo = C.buildFirestoreCompatibilityRepository(db);
  const good = C.compatibilityToFirestore({ compatibility: compat, ...meta });
  // Same doc id, but the content now describes a different part -- the derived id no longer matches.
  db.__seed(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId, { ...good, partId: "TST-9999" });
  await assert.rejects(() => repo.getById(txn, compat.compatibilityId), MalformedStoredRecordError);
  db.__seed(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId, { ...good, uniquenessKey: "x" });
  await assert.rejects(() => repo.getById(txn, compat.compatibilityId), MalformedStoredRecordError);
});
await okAsync("an unresolved serial scheme makes a SERIAL_RANGE record malformed, not silently accepted", async () => {
  const scheme = { schemeId: "TAYLOR-ALPHA", manufacturerId: "Taylor", normalizerVersion: 1, tokenPattern: "^[A-Z0-9-]+$", ordering: "LEXICOGRAPHIC" };
  const schemes = { "TAYLOR-ALPHA": scheme };
  const ranged = D2.validateCompatibility({ ...compatInput, applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: "A200", modelRevision: null } }, { serialSchemes: schemes }).value;
  const { db, txn } = fakeDb();
  const withSchemes = C.buildFirestoreCompatibilityRepository(db, { serialSchemes: schemes });
  withSchemes.stageCreate(txn, { compatibility: ranged, ...meta });
  assert.equal((await withSchemes.getById(txn, ranged.compatibilityId)).compatibility.applicability.kind, "SERIAL_RANGE");
  // The SAME stored document read through a repository with no scheme registry fails closed.
  const withoutSchemes = C.buildFirestoreCompatibilityRepository(db);
  await assert.rejects(() => withoutSchemes.getById(txn, ranged.compatibilityId), MalformedStoredRecordError);
});

// ---- equipment_compatibility_sources (immutable) ----
await okAsync("evidence is create-only: no update method exists and a re-create fails", async () => {
  const { db, txn } = fakeDb();
  const repo = C.buildFirestoreCompatibilitySourceRepository(db);
  assert.equal(typeof repo.stageCreate, "function");
  assert.equal(repo.stageUpdate, undefined, "an update surface must not exist for immutable evidence");
  assert.deepEqual(Object.keys(repo).sort(), ["getById", "stageCreate"]);
  repo.stageCreate(txn, { source, ...meta });
  assert.equal(db.__writes[0].op, "create");
  const read = await repo.getById(txn, source.sourceId);
  assert.equal(read.source.sourceId, source.sourceId);
  assert.equal(read.source.observedClaim, "SUPPORTS");
  // A second write to the same sourceId is refused by create() rather than overwriting evidence.
  assert.throws(() => repo.stageCreate(txn, { source, ...meta }), /ALREADY_EXISTS/);
});
await okAsync("a stored source whose claim was edited in place no longer matches its sourceId", async () => {
  const { db, txn } = fakeDb();
  const repo = C.buildFirestoreCompatibilitySourceRepository(db);
  const good = C.sourceToFirestore({ source, ...meta });
  // sourceId deliberately excludes the claim, so an edited claim keeps the id and stays readable --
  // it is a COLLISION for review (D2), not a malformed record. Provenance fields are different.
  db.__seed(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, source.sourceId, { ...good, observedClaim: "CONTRADICTS" });
  assert.equal((await repo.getById(txn, source.sourceId)).source.observedClaim, "CONTRADICTS");
  // An edited IDENTITY field does change the derived id, and is rejected.
  db.__seed(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, source.sourceId, { ...good, sourceReference: "Different Manual" });
  await assert.rejects(() => repo.getById(txn, source.sourceId), MalformedStoredRecordError);
});

// ---- equipment_compatibility_operations ----
await okAsync("operation lifecycle: create-guarded initiation then a guarded terminal transition", async () => {
  const { db, txn } = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  assert.equal(await repo.getByIdempotencyKey(txn, opInitiated.idempotencyKey), null);
  repo.stageInitiate(txn, opInitiated);
  assert.deepEqual(db.__writes.map((w) => w.op), ["create"], "initiation uses create(), so absence is enforced");
  assert.equal(db.__writes[0].path, `${EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION}/${opInitiated.idempotencyKey}`);
  const read = await repo.getByIdempotencyKey(txn, opInitiated.idempotencyKey);
  assert.equal(read.status, "initiated");
  repo.stageTerminal(txn, read, opApplied);
  assert.equal((await repo.getByIdempotencyKey(txn, opInitiated.idempotencyKey)).status, "applied");
});
ok("the repository surface cannot express an illegal operation transition", () => {
  const { db, txn } = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  assert.deepEqual(Object.keys(repo).sort(), ["getByIdempotencyKey", "stageInitiate", "stageTerminal"]);
  assert.equal(repo.delete, undefined, "no delete surface");
  assert.equal(repo.stageUpdate, undefined, "no arbitrary update surface");
  // absent -> terminal
  assert.throws(() => repo.stageInitiate(txn, opApplied), IllegalOperationTransitionError);
  // terminal rewrite and applied <-> denied
  assert.throws(() => repo.stageTerminal(txn, opApplied, opDenied), IllegalOperationTransitionError);
  assert.throws(() => repo.stageTerminal(txn, opDenied, opApplied), IllegalOperationTransitionError);
  assert.throws(() => repo.stageTerminal(txn, opApplied, { ...opApplied, resultVersion: 2 }), IllegalOperationTransitionError);
  // binding change across the transition
  assert.throws(() => repo.stageTerminal(txn, opInitiated, { ...opApplied, actorUid: "actor-2" }), IllegalOperationTransitionError);
  assert.throws(() => repo.stageTerminal(txn, opInitiated, { ...opApplied, commandFingerprint: "c".repeat(64) }), IllegalOperationTransitionError);
  assert.equal(db.__writes.length, 0, "no illegal attempt reached storage");
});
ok("a second initiation with the same idempotencyKey loses the create", () => {
  const { db, txn } = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  repo.stageInitiate(txn, opInitiated);
  assert.throws(() => repo.stageInitiate(txn, opInitiated), /ALREADY_EXISTS/);
});
await okAsync("a malformed stored operation NEVER reads as absent", async () => {
  const { db, txn } = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  const good = O.operationToFirestore(opInitiated);
  for (const bad of [
    { ...good, status: "bogus" },
    { ...good, commandFingerprint: "short" },
    { ...good, action: "importEquipmentModel" },                 // action/target incoherence
    { ...good, idempotencyKey: "key-different" },                // id/field disagreement
    { ...good, initiatedAt: "not-a-timestamp" },
    { ...good, status: "applied", resultVersion: 1, terminalAt: Timestamp.fromMillis(500) }, // terminal before initiated
  ]) {
    db.__seed(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, opInitiated.idempotencyKey, bad);
    await assert.rejects(() => repo.getByIdempotencyKey(txn, opInitiated.idempotencyKey), MalformedStoredRecordError, JSON.stringify(Object.keys(bad).length));
  }
});
ok("operations refuse to persist an invalid record at all", () => {
  assert.throws(() => O.operationToFirestore({ ...opInitiated, targetId: "not-a-cmp" }), MalformedStoredRecordError);
  assert.throws(() => O.operationToFirestore({ ...opInitiated, actorUid: "" }), MalformedStoredRecordError);
});

console.log(`\n${passed} repository checks passed`);
