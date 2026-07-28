// D4 Stage B.2 -- repository adapter tests.
//
// SCOPE AND EVIDENCE BOUNDARY (read this before trusting a claim below).
// These run WITHOUT the emulator, against a transaction-faithful in-memory Firestore double that models
// the Admin SDK rules the adapters depend on:
//   - a transaction QUEUES writes; nothing is visible until commit;
//   - reads never see the transaction's own staged writes;
//   - all reads must precede all writes (a read after a staged write throws, as the SDK does);
//   - create() / update() preconditions are evaluated AT COMMIT against committed state, so
//     already-exists and not-found surface as commit failures, not synchronous ones.
// That is enough to prove the adapters' own logic: identity derivation, D1/D2 delegation, fail-closed
// reads, create-vs-update semantics, and the two-phase terminal transition binding to STORED state.
// It is NOT a substitute for the real thing: contention/retry behaviour, actual Firestore error codes,
// and the genuine multi-client race remain STAGE E emulator work, per the design package. Claims here
// are deliberately limited to what this double genuinely establishes.
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
const { IllegalOperationTransitionError, OperationNotInitiatedError } = await import("../lib/equipmentCompatibility/errors.js");

let passed = 0;
const ok = async (n, f) => { await f(); passed++; console.log(`PASS -- ${n}`); };

// ---------------------------------------------------------------------------
// Transaction-faithful in-memory Firestore double
// ---------------------------------------------------------------------------
class AlreadyExistsError extends Error {}
class NotFoundError extends Error {}
class ReadAfterWriteError extends Error {}

function fakeDb() {
  const committed = new Map(); // "collection/docId" -> data
  const key = (c, d) => `${c}/${d}`;
  const snapOf = (c, d) => ({ id: d, exists: committed.has(key(c, d)), data: () => committed.get(key(c, d)) });
  const docRef = (c, d) => {
    if (typeof d !== "string" || d.length === 0) throw new Error(`invalid doc id ${String(d)}`);
    // A Firestore document ID is ONE path segment; "/" would silently create a subcollection path.
    if (d.includes("/")) throw new Error(`doc id crosses a path segment: ${d}`);
    return { __c: c, __d: d, async get() { return snapOf(c, d); } };
  };
  const db = {
    collection: (c) => ({ doc: (d) => docRef(c, d) }),
    __committed: committed,
    __seed: (c, d, data) => committed.set(key(c, d), data),
    __raw: (c, d) => committed.get(key(c, d)),
    // Mirrors Firestore.runTransaction: queue writes, apply atomically at commit.
    async runTransaction(fn) {
      const queued = [];
      const txn = {
        async get(ref) {
          if (queued.length > 0) throw new ReadAfterWriteError("Firestore transactions require all reads before any write");
          return snapOf(ref.__c, ref.__d);
        },
        create(ref, data) { queued.push({ op: "create", c: ref.__c, d: ref.__d, data }); },
        set(ref, data) { queued.push({ op: "set", c: ref.__c, d: ref.__d, data }); },
        update(ref, data) { queued.push({ op: "update", c: ref.__c, d: ref.__d, data }); },
        __queued: queued,
      };
      const result = await fn(txn);
      // Commit: evaluate every precondition against committed state, then apply atomically.
      for (const w of queued) {
        const k = key(w.c, w.d);
        if (w.op === "create" && committed.has(k)) throw new AlreadyExistsError(`ALREADY_EXISTS: ${k}`);
        if (w.op === "update" && !committed.has(k)) throw new NotFoundError(`NOT_FOUND: ${k}`);
      }
      for (const w of queued) committed.set(key(w.c, w.d), w.data);
      return { result, writes: queued.map((w) => ({ op: w.op, path: key(w.c, w.d) })) };
    },
  };
  return db;
}

// ---- fixtures ----
const TS = (ms) => Timestamp.fromMillis(ms);
const CREATED = TS(1750000000000);
const meta = { createdAt: CREATED, createdBy: "actor-1", updatedAt: CREATED, updatedBy: "actor-1" };
const MODEL_ID = "TAYLOR--C713";
const model = { equipmentModelId: MODEL_ID, manufacturerId: "TAYLOR", manufacturerName: "Taylor", modelNumber: "C713", displayName: "Taylor C713", family: null, subtype: null, revision: null, status: "ACTIVE", sourceAuthority: "manufacturer", version: 1 };
const aliasInput = { aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C-713", equipmentModelId: MODEL_ID };
const ALIAS_KEY = "SOURCE_MODEL|TAYLOR|C-713";
const alias = { aliasType: "SOURCE_MODEL", manufacturerId: "TAYLOR", aliasValue: "C-713", aliasKey: ALIAS_KEY, equipmentModelId: MODEL_ID };
const compatInput = { equipmentModelId: MODEL_ID, partId: "TST-1001", compatibilityType: "DIRECT_FIT", assembly: null, installationPosition: null, quantityRequired: 1, applicability: { kind: "ALL_SERIALS", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null }, effectiveFrom: null, effectiveTo: null, sourceSummary: null, confidenceLevel: "HIGH", verificationStatus: "VERIFIED", notes: null, version: 1 };
const compat = D2.validateCompatibility(compatInput).value;
const source = D2.validateCompatibilitySource({ compatibilityId: compat.compatibilityId, authorityType: "MANUFACTURER", sourceReference: "Service Manual 12", sourceVersion: null, observedClaim: "SUPPORTS", contentFingerprint: "a".repeat(64), capturedAt: "2026-07-27T07:06:24Z", capturedBy: "admin-uid-1", notes: null }).value;
const T0 = TS(1000), T1 = TS(2000);
const opInitiated = { idempotencyKey: "key-abcdefgh", actorUid: "actor-1", action: "importCompatibility", targetType: "equipment_part_compatibility", targetId: compat.compatibilityId, commandFingerprint: "b".repeat(64), expectedVersion: null, resultVersion: null, status: "initiated", initiatedAt: T0, terminalAt: null };
const opApplied = { ...opInitiated, status: "applied", resultVersion: 1, terminalAt: T1 };
const opDenied = { ...opInitiated, status: "denied", resultVersion: null, terminalAt: T1 };

// ---------------------------------------------------------------------------
// the double itself must model the SDK rules the claims below rely on
// ---------------------------------------------------------------------------
await ok("the double enforces reads-before-writes and commit-time preconditions", async () => {
  const db = fakeDb();
  const ref = db.collection("c").doc("d");
  await assert.rejects(() => db.runTransaction(async (txn) => {
    txn.create(ref, { x: 1 });
    await txn.get(ref); // read after a staged write
  }), ReadAfterWriteError);
  // A staged write is invisible to a read in ANOTHER transaction until commit, and invisible to its own.
  await db.runTransaction(async (txn) => {
    assert.equal((await txn.get(ref)).exists, false);
    txn.create(ref, { x: 1 });
  });
  await db.runTransaction(async (txn) => { assert.equal((await txn.get(ref)).exists, true); });
  await assert.rejects(() => db.runTransaction(async (txn) => { txn.create(ref, { x: 2 }); }), AlreadyExistsError);
  await assert.rejects(() => db.runTransaction(async (txn) => { txn.update(db.collection("c").doc("absent"), { x: 1 }); }), NotFoundError);
});

// ---- collection surface ----
await ok("exactly the five governed collections are reachable", async () => {
  assert.deepEqual([...EQUIPMENT_COMPATIBILITY_COLLECTIONS], [
    "equipment_models", "equipment_model_aliases", "equipment_part_compatibility",
    "equipment_compatibility_sources", "equipment_compatibility_operations",
  ]);
  assert.equal(Object.isFrozen(EQUIPMENT_COMPATIBILITY_COLLECTIONS), true);
});

// ---- equipment_models ----
await ok("model round-trips across two transactions; identity IS the canonical model id", async () => {
  const db = fakeDb();
  const repo = M.buildFirestoreEquipmentModelRepository(db);
  const { writes } = await db.runTransaction(async (txn) => { repo.stageCreate(txn, { model, ...meta }); });
  assert.deepEqual(writes, [{ op: "create", path: `${EQUIPMENT_MODELS_COLLECTION}/${MODEL_ID}` }]);
  await db.runTransaction(async (txn) => {
    const read = await repo.getById(txn, MODEL_ID);
    assert.equal(read.model.equipmentModelId, MODEL_ID);
    assert.equal(read.model.version, 1);
    assert.equal(read.createdBy, "actor-1");
    assert.equal(read.createdAt.isEqual(CREATED), true, "audit timestamps survive with full precision");
    assert.equal(await repo.getById(txn, "TAYLOR--MISSING"), null);
  });
});
await ok("stageUpdate REQUIRES an existing record and cannot become a create", async () => {
  const db = fakeDb();
  const repo = M.buildFirestoreEquipmentModelRepository(db);
  await assert.rejects(
    () => db.runTransaction(async (txn) => { repo.stageUpdate(txn, { model, ...meta }); }),
    NotFoundError,
    "update against an absent document must fail, not create it"
  );
  assert.equal(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID), undefined, "nothing was created");
  await db.runTransaction(async (txn) => { repo.stageCreate(txn, { model, ...meta }); });
  const updated = { model: { ...model, version: 2 }, ...meta, updatedAt: TS(1750000001000), updatedBy: "actor-2" };
  const { writes } = await db.runTransaction(async (txn) => { repo.stageUpdate(txn, updated); });
  assert.deepEqual(writes.map((w) => w.op), ["update"]);
  await db.runTransaction(async (txn) => { assert.equal((await repo.getById(txn, MODEL_ID)).model.version, 2); });
});
await ok("alias and compatibility updates require existence too", async () => {
  const db = fakeDb();
  const aliasRepo = M.buildFirestoreEquipmentModelAliasRepository(db);
  const compatRepo = C.buildFirestoreCompatibilityRepository(db);
  await assert.rejects(() => db.runTransaction(async (txn) => { aliasRepo.stageUpdate(txn, { alias, ...meta }); }), NotFoundError);
  await assert.rejects(() => db.runTransaction(async (txn) => { compatRepo.stageUpdate(txn, { compatibility: compat, ...meta }); }), NotFoundError);
});
await ok("model persistence delegates to D1 and refuses invalid or noncanonical records", async () => {
  const db = fakeDb();
  const repo = M.buildFirestoreEquipmentModelRepository(db);
  await db.runTransaction(async (txn) => {
    assert.throws(() => repo.stageCreate(txn, { model: { ...model, status: "BOGUS" }, ...meta }), MalformedStoredRecordError);
    assert.throws(() => repo.stageCreate(txn, { model: { ...model, version: 0 }, ...meta }), MalformedStoredRecordError);
    assert.throws(() => repo.stageCreate(txn, { model: { ...model, equipmentModelId: "taylor--c713" }, ...meta }), MalformedStoredRecordError);
    assert.equal(txn.__queued.length, 0, "nothing is staged when validation fails");
  });
});
await ok("malformed stored model fails closed rather than reading as absent or repaired", async () => {
  const db = fakeDb();
  const repo = M.buildFirestoreEquipmentModelRepository(db);
  const good = M.modelToFirestore({ model, ...meta });
  const expectRejected = async (mutation, why) => {
    db.__seed(EQUIPMENT_MODELS_COLLECTION, MODEL_ID, mutation);
    await assert.rejects(() => db.runTransaction((txn) => repo.getById(txn, MODEL_ID)), MalformedStoredRecordError, why);
  };
  await expectRejected({ ...good, status: "BOGUS" }, "domain-invalid");
  await expectRejected({ ...good, equipmentModelId: "TAYLOR--OTHER" }, "id/field disagreement");
  const { createdBy, ...noActor } = good;
  await expectRejected(noActor, "missing audit metadata");
  await expectRejected({ ...good, updatedAt: TS(0) }, "updated before created");
});
await ok("audit ordering uses EXACT tuples: a sub-millisecond backwards updatedAt is rejected", async () => {
  const db = fakeDb();
  const repo = M.buildFirestoreEquipmentModelRepository(db);
  const good = M.modelToFirestore({ model, ...meta });
  const HI = new Timestamp(1, 999999999), LO = new Timestamp(1, 999000000);
  assert.equal(Math.floor(HI.toMillis()), Math.floor(LO.toMillis()), "precondition: identical in milliseconds");
  // earlier by one nanosecond -> rejected (millisecond comparison would have accepted this)
  db.__seed(EQUIPMENT_MODELS_COLLECTION, MODEL_ID, { ...good, createdAt: HI, updatedAt: LO });
  await assert.rejects(() => db.runTransaction((txn) => repo.getById(txn, MODEL_ID)), MalformedStoredRecordError);
  assert.throws(() => M.modelToFirestore({ model, ...meta, createdAt: HI, updatedAt: LO }), MalformedStoredRecordError);
  // equal, and later by one nanosecond -> accepted
  for (const updatedAt of [HI, new Timestamp(2, 0)]) {
    db.__seed(EQUIPMENT_MODELS_COLLECTION, MODEL_ID, { ...good, createdAt: HI, updatedAt });
    await db.runTransaction(async (txn) => { assert.ok(await repo.getById(txn, MODEL_ID)); });
  }
  // an invalid Timestamp representation in audit metadata fails closed
  for (const bad of [{ toMillis: () => 1000 }, "2026-07-27T00:00:00Z", 1750000000000, null]) {
    db.__seed(EQUIPMENT_MODELS_COLLECTION, MODEL_ID, { ...good, updatedAt: bad });
    await assert.rejects(() => db.runTransaction((txn) => repo.getById(txn, MODEL_ID)), MalformedStoredRecordError, String(bad));
  }
});

// ---- equipment_model_aliases ----
await ok("alias doc id is the ENCODED key while identity stays the pure key", async () => {
  const db = fakeDb();
  const repo = M.buildFirestoreEquipmentModelAliasRepository(db);
  const derived = M.deriveAliasDocId(aliasInput);
  assert.equal(derived.aliasKey, ALIAS_KEY);
  assert.equal(derived.docId, ALIAS_KEY, "no reserved characters in this key, so encoding is identity");
  await db.runTransaction(async (txn) => { repo.stageCreate(txn, { alias, ...meta }); });
  await db.runTransaction(async (txn) => {
    const read = await repo.getByAliasKey(txn, ALIAS_KEY);
    assert.equal(read.alias.aliasKey, ALIAS_KEY);
    assert.equal(read.alias.equipmentModelId, MODEL_ID);
  });
});
await ok("a slash-bearing alias key is stored under a percent-encoded, single-segment doc id", async () => {
  const db = fakeDb();
  const repo = M.buildFirestoreEquipmentModelAliasRepository(db);
  const derived = M.deriveAliasDocId({ ...aliasInput, rawValue: "C/713" });
  assert.equal(derived.aliasKey, "SOURCE_MODEL|TAYLOR|C/713");
  assert.equal(derived.docId, "SOURCE_MODEL|TAYLOR|C%2F713");
  const slashed = { ...alias, aliasValue: "C/713", aliasKey: derived.aliasKey };
  // The double throws on a doc id containing "/", so a raw slash would fail loudly here.
  const { writes } = await db.runTransaction(async (txn) => { repo.stageCreate(txn, { alias: slashed, ...meta }); });
  assert.equal(writes[0].path, `${EQUIPMENT_MODEL_ALIASES_COLLECTION}/SOURCE_MODEL|TAYLOR|C%2F713`);
  await db.runTransaction(async (txn) => {
    assert.equal((await repo.getByAliasKey(txn, derived.aliasKey)).alias.aliasValue, "C/713", "identity keeps the slash");
  });
});
await ok("alias persistence refuses noncanonical keys and D1-invalid records", async () => {
  const db = fakeDb();
  const repo = M.buildFirestoreEquipmentModelAliasRepository(db);
  assert.throws(() => M.aliasDocIdFor("SOURCE_MODEL|TAYLOR CO|C-713"), MalformedStoredRecordError);
  assert.throws(() => M.aliasDocIdFor("nope"), MalformedStoredRecordError);
  assert.equal(M.deriveAliasDocId({ ...aliasInput, aliasType: "NOPE" }), null);
  assert.equal(M.deriveAliasDocId({ ...aliasInput, rawValue: "A".repeat(200) }), null, "beyond the governed value bound");
  await db.runTransaction(async (txn) => {
    assert.throws(() => repo.stageCreate(txn, { alias: { ...alias, equipmentModelId: "not-canonical" }, ...meta }), MalformedStoredRecordError);
  });
});
await ok("a stored aliasKey that disagrees with its own segments fails closed", async () => {
  const db = fakeDb();
  const repo = M.buildFirestoreEquipmentModelAliasRepository(db);
  const good = M.aliasToFirestore({ alias, ...meta });
  // aliasKey still encodes to this doc id, but its segments no longer describe the stored alias value.
  db.__seed(EQUIPMENT_MODEL_ALIASES_COLLECTION, ALIAS_KEY, { ...good, aliasValue: "C-999" });
  await assert.rejects(() => db.runTransaction((txn) => repo.getByAliasKey(txn, ALIAS_KEY)), MalformedStoredRecordError);
});

// ---- equipment_part_compatibility ----
await ok("compatibility round-trips under its deterministic id", async () => {
  const db = fakeDb();
  const repo = C.buildFirestoreCompatibilityRepository(db);
  const { writes } = await db.runTransaction(async (txn) => { repo.stageCreate(txn, { compatibility: compat, ...meta }); });
  assert.equal(writes[0].path, `${EQUIPMENT_PART_COMPATIBILITY_COLLECTION}/${compat.compatibilityId}`);
  await db.runTransaction(async (txn) => {
    const read = await repo.getById(txn, compat.compatibilityId);
    assert.equal(read.compatibility.compatibilityId, compat.compatibilityId);
    assert.equal(read.compatibility.uniquenessKey, compat.uniquenessKey);
  });
});
await ok("a tampered stored compatibilityId is rejected because D2 re-derives it", async () => {
  const db = fakeDb();
  const repo = C.buildFirestoreCompatibilityRepository(db);
  const good = C.compatibilityToFirestore({ compatibility: compat, ...meta });
  for (const bad of [{ ...good, partId: "TST-9999" }, { ...good, uniquenessKey: "x" }]) {
    db.__seed(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId, bad);
    await assert.rejects(() => db.runTransaction((txn) => repo.getById(txn, compat.compatibilityId)), MalformedStoredRecordError);
  }
});
await ok("an unresolved serial scheme makes a SERIAL_RANGE record malformed, not silently accepted", async () => {
  const scheme = { schemeId: "TAYLOR-ALPHA", manufacturerId: "Taylor", normalizerVersion: 1, tokenPattern: "^[A-Z0-9-]+$", ordering: "LEXICOGRAPHIC" };
  const schemes = { "TAYLOR-ALPHA": scheme };
  const ranged = D2.validateCompatibility({ ...compatInput, applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: "A200", modelRevision: null } }, { serialSchemes: schemes }).value;
  const db = fakeDb();
  const withSchemes = C.buildFirestoreCompatibilityRepository(db, { serialSchemes: schemes });
  await db.runTransaction(async (txn) => { withSchemes.stageCreate(txn, { compatibility: ranged, ...meta }); });
  await db.runTransaction(async (txn) => {
    assert.equal((await withSchemes.getById(txn, ranged.compatibilityId)).compatibility.applicability.kind, "SERIAL_RANGE");
  });
  // The SAME stored document read through a repository with no scheme registry fails closed.
  const withoutSchemes = C.buildFirestoreCompatibilityRepository(db);
  await assert.rejects(() => db.runTransaction((txn) => withoutSchemes.getById(txn, ranged.compatibilityId)), MalformedStoredRecordError);
});

// ---- equipment_compatibility_sources (immutable) ----
await ok("evidence is create-only: no update method exists and a re-create fails at commit", async () => {
  const db = fakeDb();
  const repo = C.buildFirestoreCompatibilitySourceRepository(db);
  assert.deepEqual(Object.keys(repo).sort(), ["getById", "stageCreate"]);
  assert.equal(repo.stageUpdate, undefined, "an update surface must not exist for immutable evidence");
  const { writes } = await db.runTransaction(async (txn) => { repo.stageCreate(txn, { source, ...meta }); });
  assert.equal(writes[0].op, "create");
  await db.runTransaction(async (txn) => {
    const read = await repo.getById(txn, source.sourceId);
    assert.equal(read.source.observedClaim, "SUPPORTS");
  });
  // A second write to the same sourceId is refused AT COMMIT rather than overwriting evidence.
  await assert.rejects(() => db.runTransaction(async (txn) => { repo.stageCreate(txn, { source, ...meta }); }), AlreadyExistsError);
  await db.runTransaction(async (txn) => {
    assert.equal((await repo.getById(txn, source.sourceId)).source.observedClaim, "SUPPORTS", "evidence unchanged");
  });
});
await ok("an edited claim is a D2 collision; an edited identity field is malformed", async () => {
  const db = fakeDb();
  const repo = C.buildFirestoreCompatibilitySourceRepository(db);
  const good = C.sourceToFirestore({ source, ...meta });
  // sourceId deliberately EXCLUDES the claim, so an edited claim keeps the id and stays readable --
  // that is a collision for review (D2), not a malformed record.
  db.__seed(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, source.sourceId, { ...good, observedClaim: "CONTRADICTS" });
  await db.runTransaction(async (txn) => {
    assert.equal((await repo.getById(txn, source.sourceId)).source.observedClaim, "CONTRADICTS");
  });
  // An edited IDENTITY field does change the derived id, and is rejected.
  db.__seed(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, source.sourceId, { ...good, sourceReference: "Different Manual" });
  await assert.rejects(() => db.runTransaction((txn) => repo.getById(txn, source.sourceId)), MalformedStoredRecordError);
});

// ---- equipment_compatibility_operations ----
await ok("two-transaction lifecycle: TX1 commits initiation, TX2 reads it and transitions", async () => {
  const db = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  await db.runTransaction(async (txn) => { assert.equal(await repo.getByIdempotencyKey(txn, opInitiated.idempotencyKey), null); });
  // TX1 -- durable initiation, committed before any mutation.
  const tx1 = await db.runTransaction(async (txn) => { repo.stageInitiate(txn, opInitiated); });
  assert.deepEqual(tx1.writes.map((w) => w.op), ["create"], "initiation uses create(), so absence is enforced");
  // TX2 -- read the COMMITTED predecessor, then transition. Reads precede writes, as the SDK requires.
  const tx2 = await db.runTransaction(async (txn) => {
    const auth = await repo.prepareTerminal(txn, opApplied);
    assert.equal(auth.stored.status, "initiated");
    repo.stageTerminal(txn, auth);
  });
  assert.deepEqual(tx2.writes.map((w) => w.op), ["set"]);
  await db.runTransaction(async (txn) => {
    assert.equal((await repo.getByIdempotencyKey(txn, opInitiated.idempotencyKey)).status, "applied");
  });
});
await ok("a forged or stale predecessor CANNOT overwrite a stored terminal record", async () => {
  for (const [terminal, attempted, label] of [[opApplied, opDenied, "applied->denied"], [opDenied, opApplied, "denied->applied"], [opApplied, { ...opApplied, resultVersion: 2 }, "applied rewrite"]]) {
    const db = fakeDb();
    const repo = O.buildFirestoreOperationRepository(db);
    db.__seed(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, opInitiated.idempotencyKey, O.operationToFirestore(terminal));
    // The caller cannot supply a predecessor at all: prepareTerminal reads the STORED record, which is
    // already terminal, so the transition is refused regardless of what the caller believes.
    await assert.rejects(
      () => db.runTransaction(async (txn) => { repo.stageTerminal(txn, await repo.prepareTerminal(txn, attempted)); }),
      IllegalOperationTransitionError,
      label
    );
    assert.deepEqual(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, opInitiated.idempotencyKey), O.operationToFirestore(terminal), `${label}: stored record untouched`);
  }
});
await ok("stageTerminal refuses anything that is not an authorization from prepareTerminal", async () => {
  const db = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  db.__seed(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, opInitiated.idempotencyKey, O.operationToFirestore(opApplied));
  await db.runTransaction(async (txn) => {
    // A hand-built object claiming an `initiated` predecessor is not an authorization.
    for (const forged of [{ stored: opInitiated, next: opDenied }, null, undefined, {}, "auth", { stored: opInitiated, next: opDenied, [Symbol("d4.operation.terminalAuthorization")]: true }]) {
      assert.throws(() => repo.stageTerminal(txn, forged), IllegalOperationTransitionError);
    }
    assert.equal(txn.__queued.length, 0, "no forged attempt staged a write");
  });
  assert.deepEqual(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, opInitiated.idempotencyKey), O.operationToFirestore(opApplied));
});
await ok("prepareTerminal rejects absent, malformed and invalid-successor cases", async () => {
  const db = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  // absent
  await assert.rejects(() => db.runTransaction((txn) => repo.prepareTerminal(txn, opApplied)), OperationNotInitiatedError);
  // malformed stored predecessor
  db.__seed(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, opInitiated.idempotencyKey, { ...O.operationToFirestore(opInitiated), status: "bogus" });
  await assert.rejects(() => db.runTransaction((txn) => repo.prepareTerminal(txn, opApplied)), MalformedStoredRecordError);
  // invalid successor, checked before the read
  db.__seed(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, opInitiated.idempotencyKey, O.operationToFirestore(opInitiated));
  await assert.rejects(() => db.runTransaction((txn) => repo.prepareTerminal(txn, { ...opApplied, commandFingerprint: "short" })), MalformedStoredRecordError);
  // binding change against the STORED predecessor
  for (const mutated of [{ ...opApplied, actorUid: "actor-2" }, { ...opApplied, commandFingerprint: "c".repeat(64) }, { ...opApplied, expectedVersion: 7 }]) {
    await assert.rejects(() => db.runTransaction((txn) => repo.prepareTerminal(txn, mutated)), IllegalOperationTransitionError);
  }
});
await ok("a concurrent terminal committed between TX2's read and write is not silently clobbered", async () => {
  // The double commits atomically, so this models the ordering rather than SDK contention: a second
  // TX2 that prepares against a STORED terminal record is refused. Genuine multi-client contention and
  // retry behaviour remain Stage E emulator work.
  const db = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  await db.runTransaction(async (txn) => { repo.stageInitiate(txn, opInitiated); });
  await db.runTransaction(async (txn) => { repo.stageTerminal(txn, await repo.prepareTerminal(txn, opApplied)); });
  await assert.rejects(
    () => db.runTransaction(async (txn) => { repo.stageTerminal(txn, await repo.prepareTerminal(txn, opDenied)); }),
    IllegalOperationTransitionError,
    "the later transition sees the committed terminal record"
  );
});
await ok("the repository surface cannot express deletion or an arbitrary update", async () => {
  const db = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  assert.deepEqual(Object.keys(repo).sort(), ["getByIdempotencyKey", "prepareTerminal", "stageInitiate", "stageTerminal"]);
  assert.equal(repo.delete, undefined);
  assert.equal(repo.stageUpdate, undefined);
  await db.runTransaction(async (txn) => {
    assert.throws(() => repo.stageInitiate(txn, opApplied), IllegalOperationTransitionError, "absent -> terminal");
    assert.equal(txn.__queued.length, 0);
  });
});
await ok("a second initiation with the same idempotencyKey loses the create at commit", async () => {
  const db = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  await db.runTransaction(async (txn) => { repo.stageInitiate(txn, opInitiated); });
  await assert.rejects(() => db.runTransaction(async (txn) => { repo.stageInitiate(txn, opInitiated); }), AlreadyExistsError);
});
await ok("a malformed stored operation NEVER reads as absent", async () => {
  const db = fakeDb();
  const repo = O.buildFirestoreOperationRepository(db);
  const good = O.operationToFirestore(opInitiated);
  for (const bad of [
    { ...good, status: "bogus" },
    { ...good, commandFingerprint: "short" },
    { ...good, action: "importEquipmentModel" },                 // action/target incoherence
    { ...good, idempotencyKey: "key-different" },                // id/field disagreement
    { ...good, initiatedAt: "not-a-timestamp" },
    { ...good, status: "applied", resultVersion: 1, terminalAt: TS(500) }, // terminal before initiated
  ]) {
    db.__seed(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, opInitiated.idempotencyKey, bad);
    await assert.rejects(() => db.runTransaction((txn) => repo.getByIdempotencyKey(txn, opInitiated.idempotencyKey)), MalformedStoredRecordError);
  }
});
await ok("operations refuse to persist an invalid record at all", async () => {
  assert.throws(() => O.operationToFirestore({ ...opInitiated, targetId: "not-a-cmp" }), MalformedStoredRecordError);
  assert.throws(() => O.operationToFirestore({ ...opInitiated, actorUid: "" }), MalformedStoredRecordError);
});

console.log(`\n${passed} repository checks passed`);
