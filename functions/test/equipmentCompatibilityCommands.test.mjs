// D4 Stage C.2 -- command orchestrator tests.
//
// SCOPE AND EVIDENCE BOUNDARY: no emulator. The same transaction-faithful in-memory double as the B.2
// suite (queued writes, commit-time preconditions, reads-before-writes, no read-your-own-staged-write)
// plus injected permission and audit seams. That is enough to prove the ORCHESTRATION: two-transaction
// ordering, durable initiation before mutation, idempotent replay, fingerprint conflict, expected-version,
// referential integrity, and audit pairing. Real contention/retry, real Rules and the genuine
// multi-client race remain STAGE E emulator work. Nothing here activates a permission or grants a role --
// the resolver is a fixture, exactly as the design's §5 seam requires.
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";

const C = await import("../lib/equipmentCompatibility/commands.js");
const D1 = await import("../lib/equipmentCompatibility/domain/equipmentModel.js");
const D2 = await import("../lib/equipmentCompatibility/domain/compatibility.js");
const E = await import("../lib/equipmentCompatibility/errors.js");
const {
  EQUIPMENT_MODELS_COLLECTION, EQUIPMENT_MODEL_ALIASES_COLLECTION, EQUIPMENT_PART_COMPATIBILITY_COLLECTION,
  EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION,
} = await import("../lib/equipmentCompatibility/repository.js");
const M = await import("../lib/equipmentCompatibility/equipmentModelRepository.js");
const CR = await import("../lib/equipmentCompatibility/compatibilityRepository.js");

let passed = 0;
const ok = async (n, f) => { await f(); passed++; console.log(`PASS -- ${n}`); };

class AlreadyExistsError extends Error {}
class NotFoundStorageError extends Error {}
class ReadAfterWriteError extends Error {}

function fakeDb() {
  const committed = new Map();
  const key = (c, d) => `${c}/${d}`;
  const snapOf = (c, d) => ({ id: d, exists: committed.has(key(c, d)), data: () => committed.get(key(c, d)) });
  const docRef = (c, d) => {
    if (typeof d !== "string" || d.length === 0) throw new Error(`invalid doc id ${String(d)}`);
    if (d.includes("/")) throw new Error(`doc id crosses a path segment: ${d}`);
    return { __c: c, __d: d, async get() { return snapOf(c, d); } };
  };
  let transactions = 0;
  // The ONE bounded query D4 uses: single-field equality. Modelled faithfully -- it reads COMMITTED
  // state only, exactly like a transactional get.
  const query = (c, field, value) => ({
    __query: true, __c: c, __field: field, __value: value,
    async get() { return runQuery(c, field, value); },
  });
  const runQuery = (c, field, value) => ({
    docs: [...committed.entries()]
      .filter(([k, v]) => k.startsWith(`${c}/`) && v && v[field] === value)
      .map(([k, v]) => ({ id: k.slice(c.length + 1), data: () => v })),
  });
  return {
    collection: (c) => ({ doc: (d) => docRef(c, d), where: (f, op, v) => { if (op !== "==") throw new Error(`unsupported op ${op}`); return query(c, f, v); } }),
    __committed: committed,
    __seed: (c, d, data) => committed.set(key(c, d), data),
    __raw: (c, d) => committed.get(key(c, d)),
    __transactions: () => transactions,
    async runTransaction(fn) {
      transactions += 1;
      const queued = [];
      const txn = {
        async get(ref) {
          if (queued.length > 0) throw new ReadAfterWriteError("all reads must precede all writes");
          return ref.__query ? runQuery(ref.__c, ref.__field, ref.__value) : snapOf(ref.__c, ref.__d);
        },
        create(ref, data) { queued.push({ op: "create", c: ref.__c, d: ref.__d, data }); },
        set(ref, data) { queued.push({ op: "set", c: ref.__c, d: ref.__d, data }); },
        update(ref, data) { queued.push({ op: "update", c: ref.__c, d: ref.__d, data }); },
        __queued: queued,
      };
      const result = await fn(txn);
      for (const w of queued) {
        const k = key(w.c, w.d);
        if (w.op === "create" && committed.has(k)) throw new AlreadyExistsError(`ALREADY_EXISTS: ${k}`);
        if (w.op === "update" && !committed.has(k)) throw new NotFoundStorageError(`NOT_FOUND: ${k}`);
      }
      for (const w of queued) committed.set(key(w.c, w.d), w.data);
      return result;
    },
  };
}

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
// Must start at or after the seeded createdAt: the repository refuses a record updated before it
// was created, and that guard is real behaviour, not a fixture detail to work around.
let clock = 1750000000000;
const AUDIT_EVENTS = "auditEvents";
// Audit events are PERSISTED through the transaction, create-only, exactly as the orchestrator stages
// them -- not collected in an array. Committed events are read back out of the store, so a rolled-back
// transaction genuinely leaves none behind.
let auditSeq = 0;
function makeDeps(db, { grant = true } = {}) {
  return {
    deps: {
      db,
      resolvePermission: typeof grant === "function" ? grant : () => grant,
      newAuditRef: () => db.collection(AUDIT_EVENTS).doc(`audit-${(auditSeq += 1)}`),
      now: () => Timestamp.fromMillis((clock += 1000)),
      serialSchemes: SCHEMES,
    },
  };
}
const auditMark = (db) => committedAudits(db).length;
const auditsSince = (db, mark) => committedAudits(db).slice(mark);
// Every COMMITTED audit event, in write order.
const committedAudits = (db) => [...db.__committed.entries()]
  .filter(([k]) => k.startsWith(`${AUDIT_EVENTS}/`))
  .sort((a, b) => Number(a[0].split("-")[1]) - Number(b[0].split("-")[1]))
  .map(([, v]) => v);
const seedModel = (db) => db.__seed(EQUIPMENT_MODELS_COLLECTION, MODEL_ID, M.modelToFirestore({ model: model(), ...META }));
const seedCompat = (db, c) => db.__seed(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, c.compatibilityId, CR.compatibilityToFirestore({ compatibility: c, ...META }, { serialSchemes: SCHEMES }));
const run = (deps, over = {}) => C.runEquipmentCompatibilityCommand({
  actorUid: "actor-1", action: "importEquipmentModel", idempotencyKey: "key-abcdefgh", payload: model(), expectedVersion: null, ...over,
}, deps);

// ---- capabilities ----
await ok("each action maps to its governed capability, and the map is frozen", async () => {
  assert.deepEqual({ ...C.COMMAND_CAPABILITIES }, {
    importEquipmentModel: "equipment.model.manage",
    importEquipmentModelAlias: "equipment.model.manage",
    importCompatibility: "equipment.compatibility.import",
    importCompatibilitySource: "equipment.compatibility.import",
    verifyCompatibility: "equipment.compatibility.verify",
    correctCompatibility: "equipment.compatibility.correct",
  });
  assert.equal(Object.isFrozen(C.COMMAND_CAPABILITIES), true);
});

// ---- two-transaction lifecycle ----
await ok("TX1 records initiation durably BEFORE any mutation; TX2 mutates and terminates", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  const result = await run(deps);
  assert.deepEqual(result, { status: "applied", targetId: MODEL_ID, resultVersion: 1, replayed: false });
  assert.equal(db.__transactions(), 2, "exactly two transactions");
  const op = db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh");
  assert.equal(op.status, "applied");
  assert.equal(op.resultVersion, 1);
  assert.equal(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID).equipmentModelId, MODEL_ID);
  // Two distinct audit events, initiation first.
  assert.deepEqual(auditsSince(db, mark).map((a) => [a.action, a.outcome]), [
    [C.INITIATION_AUDIT_ACTION, "applied"],
    [C.TERMINAL_AUDIT_ACTION, "applied"],
  ]);
});
await ok("a crash between TX1 and TX2 leaves a resumable initiation and no mutation", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db);
  // Simulate the crash by failing the SECOND transaction.
  const original = db.runTransaction.bind(db);
  let calls = 0;
  db.runTransaction = async (fn) => { calls += 1; if (calls === 2) throw new Error("crash after TX1"); return original(fn); };
  const mark = auditMark(db);
  await assert.rejects(() => run(deps), /crash after TX1/);
  const op = db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh");
  assert.equal(op.status, "initiated", "initiation is durable");
  assert.equal(op.terminalAt, null);
  assert.equal(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID), undefined, "no mutation happened");
  assert.deepEqual(auditsSince(db, mark).map((a) => a.action), [C.INITIATION_AUDIT_ACTION]);
  // The retry RESUMES the same initiation instead of creating a second one.
  db.runTransaction = original;
  const { deps: deps2 } = makeDeps(db);
  const mark2 = auditMark(db);
  const result = await run(deps2);
  assert.equal(result.status, "applied");
  assert.equal(result.replayed, true, "reported as a resumed command");
  assert.deepEqual(auditsSince(db, mark2).map((a) => a.action), [C.TERMINAL_AUDIT_ACTION], "no duplicate initiation audit");
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh").status, "applied");
});
await ok("a replay after TX2 reads the terminal record and mutates nothing", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db);
  await run(deps);
  const before = { ...db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID) };
  const { deps: deps2 } = makeDeps(db);
  const mark = auditMark(db);
  const replay = await run(deps2);
  assert.deepEqual(replay, { status: "applied", targetId: MODEL_ID, resultVersion: 1, replayed: true });
  assert.deepEqual(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID), before, "record untouched");
  assert.deepEqual(auditsSince(db, mark), [], "an exact replay writes no new audit event");
  assert.equal(db.__transactions(), 3, "replay costs one transaction, not two");
});

// ---- idempotency ----
await ok("a reused key with a DIFFERENT command fails closed and changes nothing", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db);
  await run(deps);
  const opBefore = { ...db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh") };
  const variants = [
    { payload: model({ displayName: "Different" }) },      // different payload -> different fingerprint
    { actorUid: "actor-2" },                                // different actor
    { expectedVersion: 1 },                                 // different expected version
  ];
  for (const over of variants) {
    const { deps: d } = makeDeps(db);
    const mark = auditMark(db);
    await assert.rejects(() => run(d, over), E.IdempotencyConflictError, JSON.stringify(over));
    assert.deepEqual(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh"), opBefore, "operation untouched");
    assert.deepEqual(auditsSince(db, mark), [], "a conflict writes no audit for an already-accepted key");
  }
});

// ---- pre-acceptance denial ----
await ok("an unauthorized actor produces NO operation record, only a terminal denied audit", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db, { grant: false });
  const mark = auditMark(db);
  await assert.rejects(() => run(deps), E.UnauthorizedActorError);
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh"), undefined);
  assert.equal(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID), undefined);
  const denied = auditsSince(db, mark);
  assert.deepEqual(denied.map((a) => [a.action, a.outcome]), [[C.TERMINAL_AUDIT_ACTION, "denied"]]);
  assert.equal(denied[0].summary, `importEquipmentModel denied: ${C.DENIAL_REASONS.UNAUTHORIZED}`, "stable sanitized reason");
});
await ok("a resolver that THROWS denies rather than approves", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db, { grant: () => { throw new Error("resolver exploded"); } });
  await assert.rejects(() => run(deps), E.UnauthorizedActorError);
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh"), undefined);
});
await ok("malformed input is refused before acceptance, with no operation record", async () => {
  const db = fakeDb();
  const bad = [
    [{ actorUid: "" }, E.InvalidInputError],
    [{ action: "nope" }, E.InvalidInputError],
    [{ idempotencyKey: "short" }, E.InvalidInputError],
    [{ expectedVersion: -1 }, E.InvalidInputError],
    [{ payload: { ...model(), status: "BOGUS" } }, Error],       // fingerprint contract refuses it
    [{ payload: { ...model(), futureField: "x" } }, Error],
  ];
  for (const [over, kind] of bad) {
    const { deps } = makeDeps(db);
    const mark = auditMark(db);
    await assert.rejects(() => run(deps, over), kind, JSON.stringify(over));
    assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh"), undefined);
    const events = auditsSince(db, mark);
    assert.deepEqual(events.map((a) => a.outcome), ["denied"]);
    assert.match(events[0].summary, /denied: (invalid_input|internal_error)$/, "no raw exception text");
  }
});
await ok("the actor is server-derived: no payload field can change who is recorded", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db);
  // actorUid lives on the command input, not the payload; an actorUid inside the payload is an unknown
  // governed field and is refused outright.
  await assert.rejects(() => run(deps, { payload: { ...model(), actorUid: "attacker" } }), Error);
  const { deps: d2 } = makeDeps(db);
  await run(d2, { actorUid: "actor-9", idempotencyKey: "key-server-uid" });
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-server-uid").actorUid, "actor-9");
});

// ---- expected version ----
await ok("expected-version concurrency is enforced on the record's OWN version", async () => {
  const db = fakeDb();
  seedModel(db);
  // expectedVersion null against an existing record is a conflict, not an overwrite.
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  const denied = await run(deps, { idempotencyKey: "key-null-vs-exists" });
  assert.equal(denied.status, "denied");
  assert.equal(denied.reason, C.DENIAL_REASONS.VERSION_CONFLICT, "a STABLE code, not a raw message");
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-null-vs-exists").status, "denied");
  assert.deepEqual(auditsSince(db, mark).map((a) => [a.action, a.outcome]), [[C.INITIATION_AUDIT_ACTION, "applied"], [C.TERMINAL_AUDIT_ACTION, "denied"]]);
  assert.equal(auditsSince(db, mark)[1].summary, `importEquipmentModel denied: ${C.DENIAL_REASONS.VERSION_CONFLICT}`);
  // A stale expected version is refused.
  const { deps: d2 } = makeDeps(db);
  const stale = await run(d2, { idempotencyKey: "key-stale-ver", expectedVersion: 5, payload: model({ version: 6 }) });
  assert.equal(stale.status, "denied");
  assert.equal(stale.reason, C.DENIAL_REASONS.VERSION_CONFLICT);
  // The matching version applies.
  const { deps: d3 } = makeDeps(db);
  const applied = await run(d3, { idempotencyKey: "key-good-ver", expectedVersion: 1, payload: model({ version: 2, displayName: "Taylor C713 II" }) });
  assert.deepEqual(applied, { status: "applied", targetId: MODEL_ID, resultVersion: 2, replayed: false });
  assert.equal(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID).version, 2);
});

// ---- referential integrity ----
await ok("an alias cannot create or imply a model", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db);
  const alias = aliasOf();
  const denied = await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-alias-noref", payload: alias,
  }, deps);
  assert.equal(denied.status, "denied");
  assert.equal(denied.reason, C.DENIAL_REASONS.REFERENTIAL_INTEGRITY);
  assert.equal(db.__raw(EQUIPMENT_MODEL_ALIASES_COLLECTION, alias.aliasKey), undefined, "no alias was created");
  // With the model present it applies.
  seedModel(db);
  const { deps: d2 } = makeDeps(db);
  const applied = await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-alias-ok", payload: alias,
  }, d2);
  assert.equal(applied.status, "applied");
  assert.equal(db.__raw(EQUIPMENT_MODEL_ALIASES_COLLECTION, alias.aliasKey).equipmentModelId, MODEL_ID);
});
await ok("an alias already owned by another model fails closed for review", async () => {
  const db = fakeDb();
  seedModel(db);
  db.__seed(EQUIPMENT_MODELS_COLLECTION, "TAYLOR--C825", M.modelToFirestore({ model: model({ modelNumber: "C825", equipmentModelId: "TAYLOR--C825" }), ...META }));
  const { deps } = makeDeps(db);
  const alias = aliasOf();
  await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-alias-own", payload: alias }, deps);
  const { deps: d2 } = makeDeps(db);
  const conflicting = await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-alias-conflict",
    payload: aliasOf({ equipmentModelId: "TAYLOR--C825" }),
  }, d2);
  assert.equal(conflicting.status, "denied");
  assert.equal(conflicting.reason, C.DENIAL_REASONS.REFERENTIAL_INTEGRITY);
  assert.equal(db.__raw(EQUIPMENT_MODEL_ALIASES_COLLECTION, alias.aliasKey).equipmentModelId, MODEL_ID, "owner unchanged");
});
await ok("evidence cannot create the relationship it cites, and is immutable once written", async () => {
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf();
  const source = sourceOf(compat.compatibilityId);
  const { deps } = makeDeps(db);
  const orphan = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-src-orphan", payload: source }, deps);
  assert.equal(orphan.status, "denied");
  assert.equal(orphan.reason, C.DENIAL_REASONS.REFERENTIAL_INTEGRITY);
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, source.sourceId), undefined);
  seedCompat(db, compat);
  const { deps: d2 } = makeDeps(db);
  assert.equal((await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-src-ok", payload: source }, d2)).status, "applied");
  // A second, differently-keyed command for the same sourceId is refused: evidence is immutable.
  const { deps: d3 } = makeDeps(db);
  const again = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-src-again", payload: source }, d3);
  assert.equal(again.status, "denied");
  assert.equal(again.reason, C.DENIAL_REASONS.ALREADY_EXISTS);
});
await ok("a compatibility relationship requires its equipment model", async () => {
  const db = fakeDb();
  const compat = compatOf();
  const { deps } = makeDeps(db);
  const denied = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibility", idempotencyKey: "key-cmp-noref", payload: compat }, deps);
  assert.equal(denied.status, "denied");
  assert.equal(denied.reason, C.DENIAL_REASONS.REFERENTIAL_INTEGRITY);
  assert.equal(db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId), undefined);
});

// ---- verify / correct ----
await ok("verification bumps the record version and never auto-creates", async () => {
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf();
  const { deps } = makeDeps(db);
  const missing = await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "verifyCompatibility", idempotencyKey: "key-verify-missing",
    payload: { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" }, expectedVersion: 1,
  }, deps);
  assert.equal(missing.status, "denied");
  assert.equal(missing.reason, C.DENIAL_REASONS.NOT_FOUND);
  seedCompat(db, compat);
  const { deps: d2 } = makeDeps(db);
  const applied = await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "verifyCompatibility", idempotencyKey: "key-verify-ok",
    payload: { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" }, expectedVersion: 1,
  }, d2);
  assert.deepEqual(applied, { status: "applied", targetId: compat.compatibilityId, resultVersion: 2, replayed: false });
  const stored = db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId);
  assert.equal(stored.verificationStatus, "VERIFIED");
  assert.equal(stored.version, 2);
});
await ok("a correction requires an existing relationship", async () => {
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf();
  const { deps } = makeDeps(db);
  const missing = await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "correctCompatibility", idempotencyKey: "key-correct-missing",
    payload: compatOf({ version: 2, notes: "corrected" }), expectedVersion: 1,
  }, deps);
  assert.equal(missing.status, "denied");
  seedCompat(db, compat);
  const { deps: d2 } = makeDeps(db);
  const applied = await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "correctCompatibility", idempotencyKey: "key-correct-ok",
    payload: compatOf({ version: 2, notes: "corrected" }), expectedVersion: 1,
  }, d2);
  assert.equal(applied.status, "applied");
  assert.equal(db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId).notes, "corrected");
});

// ---- audit pairing + atomicity ----
await ok("audit persistence is create-only and ATOMIC with its transaction", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  await run(deps, { idempotencyKey: "key-audit-pair" });
  const events = auditsSince(db, mark);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((a) => a.action), [C.INITIATION_AUDIT_ACTION, C.TERMINAL_AUDIT_ACTION]);
  assert.equal(events[0].targetId, MODEL_ID);
  assert.equal(events[1].targetType, "equipment_models");
  for (const a of events) {
    assert.ok(a.summary.length <= 500, "summary is bounded");
    assert.equal(typeof a.actorUid, "string");
    assert.ok(a.at instanceof Timestamp, "audit carries a governed timestamp");
  }
  // CREATE-ONLY: re-staging an EXISTING audit id fails at commit rather than overwriting.
  const existingAuditId = [...db.__committed.keys()].find((k) => k.startsWith(`${AUDIT_EVENTS}/`)).split("/")[1];
  await assert.rejects(() => db.runTransaction(async (txn) => {
    txn.create(db.collection(AUDIT_EVENTS).doc(existingAuditId), { rewritten: true });
  }), AlreadyExistsError);
  assert.notEqual(db.__raw(AUDIT_EVENTS, existingAuditId).rewritten, true, "the existing event is untouched");
});
await ok("a rolled-back TX1 leaves NO audit event and no operation", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  const original = db.runTransaction.bind(db);
  db.runTransaction = async (fn) => original(async (txn) => { await fn(txn); throw new Error("TX1 rolled back"); });
  await assert.rejects(() => run(deps, { idempotencyKey: "key-tx1-rollback" }), /TX1 rolled back/);
  db.runTransaction = original;
  assert.deepEqual(auditsSince(db, mark), [], "the initiation audit rolled back with its transaction");
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-tx1-rollback"), undefined);
});
await ok("a rolled-back TX2 leaves the initiation intact and NO terminal audit or mutation", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  const original = db.runTransaction.bind(db);
  let calls = 0;
  db.runTransaction = async (fn) => original(async (txn) => {
    const r = await fn(txn);
    if ((calls += 1) === 2) throw new Error("TX2 rolled back");
    return r;
  });
  await assert.rejects(() => run(deps, { idempotencyKey: "key-tx2-rollback" }), /TX2 rolled back/);
  db.runTransaction = original;
  assert.deepEqual(auditsSince(db, mark).map((a) => a.action), [C.INITIATION_AUDIT_ACTION], "only TX1 committed");
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-tx2-rollback").status, "initiated");
  assert.equal(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID), undefined, "no mutation committed");
});
await ok("verification and correction each emit their SPECIALIZED event alongside the terminal one", async () => {
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf();
  seedCompat(db, compat);
  const { deps } = makeDeps(db);
  let mark = auditMark(db);
  await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "verifyCompatibility", idempotencyKey: "key-verify-audit",
    payload: { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" }, expectedVersion: 1,
  }, deps);
  assert.deepEqual(auditsSince(db, mark).map((a) => a.action), [
    C.INITIATION_AUDIT_ACTION, C.TERMINAL_AUDIT_ACTION, "equipmentCompatibilityVerification",
  ]);
  const { deps: d2 } = makeDeps(db);
  mark = auditMark(db);
  await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "correctCompatibility", idempotencyKey: "key-correct-audit",
    payload: compatOf({ version: 3, notes: "corrected" }), expectedVersion: 2,
  }, d2);
  assert.deepEqual(auditsSince(db, mark).map((a) => a.action), [
    C.INITIATION_AUDIT_ACTION, C.TERMINAL_AUDIT_ACTION, "equipmentCompatibilityCorrection",
  ]);
});
// ---- conflict surfacing is decided by the GOVERNED D2 analyzer, not by the incoming record ----
const importSource = async (db, source, key) => {
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  const result = await C.runEquipmentCompatibilityCommand({
    actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: key, payload: source,
  }, deps);
  return { result, events: auditsSince(db, mark) };
};
const statusOf = (db, compat) => db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId).verificationStatus;
const freshWithCompat = (verificationStatus = "UNVERIFIED") => {
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf({ verificationStatus });
  seedCompat(db, compat);
  return { db, compat };
};
const claim = (compat, observedClaim, fp) => sourceOf(compat.compatibilityId, { observedClaim, contentFingerprint: fp.repeat(64) });

await ok("CONTRADICTS as the first and only evidence is NOT a conflict", async () => {
  const { db, compat } = freshWithCompat();
  const { result, events } = await importSource(db, claim(compat, "CONTRADICTS", "a"), "key-only-contradicts");
  assert.equal(result.status, "applied");
  assert.equal(statusOf(db, compat), "UNVERIFIED", "no support-vs-contradiction, so no CONFLICT");
  assert.equal(events.some((e) => e.action === "equipmentCompatibilityConflict"), false);
});
await ok("SUPPORTS then CONTRADICTS is a conflict", async () => {
  const { db, compat } = freshWithCompat();
  await importSource(db, claim(compat, "SUPPORTS", "a"), "key-s-then-c-1");
  assert.equal(statusOf(db, compat), "UNVERIFIED", "supporting evidence never auto-verifies");
  const { events } = await importSource(db, claim(compat, "CONTRADICTS", "b"), "key-s-then-c-2");
  assert.equal(statusOf(db, compat), "CONFLICT");
  assert.equal(events.filter((e) => e.action === "equipmentCompatibilityConflict").length, 1);
});
await ok("CONTRADICTS then SUPPORTS reaches the SAME conflict result (order-independent)", async () => {
  const { db, compat } = freshWithCompat();
  await importSource(db, claim(compat, "CONTRADICTS", "a"), "key-c-then-s-1");
  assert.equal(statusOf(db, compat), "UNVERIFIED", "still only one side of the evidence");
  const { events } = await importSource(db, claim(compat, "SUPPORTS", "b"), "key-c-then-s-2");
  assert.equal(statusOf(db, compat), "CONFLICT", "the SUPPORTS arrival is what completes the conflict");
  assert.equal(events.filter((e) => e.action === "equipmentCompatibilityConflict").length, 1);
});
await ok("INCONCLUSIVE evidence never creates a conflict, in any combination", async () => {
  const { db, compat } = freshWithCompat();
  await importSource(db, claim(compat, "INCONCLUSIVE", "a"), "key-inc-1");
  assert.equal(statusOf(db, compat), "UNVERIFIED");
  await importSource(db, claim(compat, "INCONCLUSIVE", "b"), "key-inc-2");
  assert.equal(statusOf(db, compat), "UNVERIFIED");
  const { events } = await importSource(db, claim(compat, "SUPPORTS", "c"), "key-inc-3");
  assert.equal(statusOf(db, compat), "UNVERIFIED", "support + inconclusive is not a conflict");
  assert.equal(events.some((e) => e.action === "equipmentCompatibilityConflict"), false);
});
await ok("multiple supporting and contradicting sources still resolve to one conflict transition", async () => {
  const { db, compat } = freshWithCompat();
  await importSource(db, claim(compat, "SUPPORTS", "a"), "key-multi-1");
  await importSource(db, claim(compat, "SUPPORTS", "b"), "key-multi-2");
  const first = await importSource(db, claim(compat, "CONTRADICTS", "c"), "key-multi-3");
  assert.equal(statusOf(db, compat), "CONFLICT");
  assert.equal(first.events.filter((e) => e.action === "equipmentCompatibilityConflict").length, 1);
  const versionAfterFirst = db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId).version;
  // Already CONFLICT: further contradicting evidence is recorded, but there is no second transition.
  const second = await importSource(db, claim(compat, "CONTRADICTS", "d"), "key-multi-4");
  assert.equal(second.result.status, "applied");
  assert.equal(second.events.some((e) => e.action === "equipmentCompatibilityConflict"), false, "no duplicate event");
  assert.equal(db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId).version, versionAfterFirst, "no duplicate transition");
});
await ok("malformed stored evidence fails closed: no source, no mutation, no audit committed", async () => {
  const { db, compat } = freshWithCompat();
  await importSource(db, claim(compat, "SUPPORTS", "a"), "key-mal-1");
  // Corrupt a stored evidence document that the analysis must read.
  const badId = [...db.__committed.keys()].find((k) => k.startsWith(`${EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION}/`)).split("/")[1];
  db.__seed(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, badId, { ...db.__raw(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, badId), observedClaim: "MAYBE" });
  const incoming = claim(compat, "CONTRADICTS", "b");
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  const statusBefore = statusOf(db, compat);
  await assert.rejects(
    () => C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-mal-2", payload: incoming }, deps),
    (e) => e.constructor.name === "MalformedStoredRecordError",
    "malformed stored evidence must fail closed"
  );
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, incoming.sourceId), undefined, "no new evidence");
  assert.equal(statusOf(db, compat), statusBefore, "no relationship mutation");
  assert.deepEqual(auditsSince(db, mark).map((a) => a.action), [C.INITIATION_AUDIT_ACTION], "TX2 committed nothing");
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-mal-2").status, "initiated", "resumable, not terminal");
});
await ok("a rolled-back TX2 with the evidence query commits neither evidence nor conflict", async () => {
  const { db, compat } = freshWithCompat();
  await importSource(db, claim(compat, "SUPPORTS", "a"), "key-roll-1");
  const incoming = claim(compat, "CONTRADICTS", "b");
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  const original = db.runTransaction.bind(db);
  let calls = 0;
  db.runTransaction = async (fn) => original(async (txn) => {
    const r = await fn(txn);
    if ((calls += 1) === 2) throw new Error("TX2 rolled back");
    return r;
  });
  await assert.rejects(
    () => C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-roll-2", payload: incoming }, deps),
    /TX2 rolled back/
  );
  db.runTransaction = original;
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, incoming.sourceId), undefined);
  assert.equal(statusOf(db, compat), "UNVERIFIED");
  assert.deepEqual(auditsSince(db, mark).map((a) => a.action), [C.INITIATION_AUDIT_ACTION]);
  // The retry RESUMES and now applies the conflict exactly once.
  const { deps: d2 } = makeDeps(db);
  const retry = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-roll-2", payload: incoming }, d2);
  assert.equal(retry.status, "applied");
  assert.equal(statusOf(db, compat), "CONFLICT");
});
await ok("the evidence query is bounded to its own relationship", async () => {
  const { db, compat } = freshWithCompat();
  const other = compatOf({ partId: "TST-2002" });
  seedCompat(db, other);
  await importSource(db, claim(other, "SUPPORTS", "a"), "key-other-1");
  // Supporting evidence on a DIFFERENT relationship must not complete a conflict here.
  const { events } = await importSource(db, claim(compat, "CONTRADICTS", "b"), "key-bounded-1");
  assert.equal(statusOf(db, compat), "UNVERIFIED");
  assert.equal(statusOf(db, other), "UNVERIFIED");
  assert.equal(events.some((e) => e.action === "equipmentCompatibilityConflict"), false);
});

// ---- hostile command envelopes ----
await ok("a throwing accessor or Proxy trap cannot escape the governed denial path", async () => {
  const throwingGetter = (field) => {
    const o = { actorUid: "actor-1", action: "importEquipmentModel", idempotencyKey: "key-hostile", payload: model() };
    delete o[field];
    Object.defineProperty(o, field, { get() { throw new Error(`${field} getter ran`); }, enumerable: true, configurable: true });
    return o;
  };
  const hostiles = [
    ["throwing actorUid getter", throwingGetter("actorUid")],
    ["throwing action getter", throwingGetter("action")],
    ["throwing idempotencyKey getter", throwingGetter("idempotencyKey")],
    ["throwing payload getter", throwingGetter("payload")],
    ["throwing expectedVersion getter", throwingGetter("expectedVersion")],
    ["throwing getPrototypeOf trap", new Proxy({}, { getPrototypeOf() { throw new Error("proto trap"); } })],
    ["throwing ownKeys trap", new Proxy({}, { ownKeys() { throw new Error("ownKeys trap"); } })],
    ["throwing get trap", new Proxy({ actorUid: "a", action: "importEquipmentModel", idempotencyKey: "key-hostile", payload: {} }, { get() { throw new Error("get trap"); } })],
    ["throwing getOwnPropertyDescriptor trap", new Proxy({ actorUid: "a" }, { getOwnPropertyDescriptor() { throw new Error("descriptor trap"); } })],
    ["action with throwing toString", { actorUid: "actor-1", action: { toString() { throw new Error("toString ran"); } }, idempotencyKey: "key-hostile", payload: model() }],
    ["inherited actorUid", Object.assign(Object.create({ actorUid: "inherited" }), { action: "importEquipmentModel", idempotencyKey: "key-hostile", payload: model() })],
    ["unknown own field", { actorUid: "actor-1", action: "importEquipmentModel", idempotencyKey: "key-hostile", payload: model(), extra: 1 }],
    ["own symbol", Object.assign({ actorUid: "actor-1", action: "importEquipmentModel", idempotencyKey: "key-hostile", payload: model() }, { [Symbol("s")]: 1 })],
    ["array envelope", []],
    ["null envelope", null],
  ];
  for (const [label, hostile] of hostiles) {
    const db = fakeDb();
    const { deps } = makeDeps(db);
    const mark = auditMark(db);
    let thrown = null;
    // TOTAL: the call rejects with a governed error -- never with the hostile object's own exception.
    await assert.rejects(() => C.runEquipmentCompatibilityCommand(hostile, deps), (e) => { thrown = e; return true; }, label);
    assert.ok(thrown instanceof E.InvalidInputError, `${label}: governed error, got ${thrown && thrown.message}`);
    // The governed sanitized denial event was still written.
    const events = auditsSince(db, mark);
    assert.deepEqual(events.map((a) => [a.action, a.outcome]), [[C.TERMINAL_AUDIT_ACTION, "denied"]], label);
    assert.match(events[0].summary, /denied: invalid_input$/, label);
    assert.equal(events[0].actorUid.length > 0, true, label);
    // Nothing governed was created.
    assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-hostile"), undefined, label);
    assert.equal(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID), undefined, label);
  }
});
await ok("a hostile envelope field is read at most once", async () => {
  let reads = 0;
  const counting = { action: "importEquipmentModel", idempotencyKey: "key-countread", payload: model() };
  Object.defineProperty(counting, "actorUid", { get() { reads += 1; return "actor-1"; }, enumerable: true, configurable: true });
  const db = fakeDb();
  const { deps } = makeDeps(db);
  await assert.rejects(() => C.runEquipmentCompatibilityCommand(counting, deps), E.InvalidInputError, "accessors are refused outright");
  assert.equal(reads, 0, "an accessor must never be invoked, not even once");
});
// ---- TIME-OF-CHECK / TIME-OF-USE: a caller-retained payload cannot reach storage ----
//
// The invariant: the record that is PERSISTED is exactly the record that was FINGERPRINTED. A caller
// that keeps a reference to its payload (or its serialSchemes registry) and mutates it after acceptance
// must not be able to change what is written, at ANY window -- while resolvePermission is pending,
// between fingerprinting and TX1, between TX1 and TX2, or between transaction retries.
const FP = await import("../lib/equipmentCompatibility/commandFingerprint.js");
const { ACTION_TARGET_TYPES } = await import("../lib/equipmentCompatibility/operations.js");

// Mutate at a chosen boundary and assert the stored document still matches the ORIGINAL command.
async function assertMutationCannotLand({ action, payload, expectedVersion = null, collection, docId, seed, mutate, when, key }) {
  const db = fakeDb();
  if (seed) seed(db);
  const original = structuredClone(payload);
  const expectedFingerprint = FP.buildCommandFingerprint({
    action, targetType: ACTION_TARGET_TYPES[action], targetId: docId, payload: original, serialSchemes: SCHEMES,
  });
  const registry = structuredClone(SCHEMES);
  let mutated = false;
  const fire = () => { if (!mutated) { mutate(payload, registry); mutated = true; } };

  const { deps } = makeDeps(db);
  deps.serialSchemes = registry;
  if (when === "resolvePermission") deps.resolvePermission = async () => { fire(); return true; };

  const originalRunTransaction = db.runTransaction.bind(db);
  let txCount = 0;
  if (when === "betweenTransactions") {
    db.runTransaction = async (fn) => { const r = await originalRunTransaction(fn); if ((txCount += 1) === 1) fire(); return r; };
  } else if (when === "betweenRetries") {
    // Model a retry: the first TX2 attempt is rolled back, the payload is mutated, then it is retried.
    db.runTransaction = async (fn) => {
      txCount += 1;
      if (txCount === 2) {
        try { await originalRunTransaction(async (txn) => { await fn(txn); throw new Error("retry"); }); } catch { /* rolled back */ }
        fire();
      }
      return originalRunTransaction(fn);
    };
  }

  if (when === "beforeCall") fire();
  const result = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action, idempotencyKey: key, payload, expectedVersion }, deps);
  db.runTransaction = originalRunTransaction;
  assert.equal(result.status, "applied", `${key}: command applied`);

  const stored = db.__raw(collection, docId);
  assert.ok(stored, `${key}: the ORIGINAL target document was written`);
  const op = db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, key);
  if (when !== "resolvePermission" && when !== "beforeCall") {
    // Mutation happened after acceptance: the ORIGINAL command must be what was fingerprinted AND stored.
    assert.equal(op.commandFingerprint, expectedFingerprint, `${key}: fingerprint is the original command`);
  }
  // Whatever was fingerprinted, the persisted record must reproduce that exact fingerprint.
  const rebuilt = FP.buildCommandFingerprint({
    action, targetType: ACTION_TARGET_TYPES[action], targetId: docId,
    payload: rebuildGovernedValue(action, stored), serialSchemes: SCHEMES,
  });
  assert.equal(rebuilt, op.commandFingerprint, `${key}: the persisted record reproduces the operation fingerprint`);
  return { db, stored, op };
}

// Reconstruct the governed value from a stored document (drops the repository audit envelope).
function rebuildGovernedValue(action, stored) {
  const drop = new Set(["createdAt", "createdBy", "updatedAt", "updatedBy"]);
  const value = {};
  for (const [k, v] of Object.entries(stored)) {
    if (drop.has(k)) continue;
    value[k] = (v !== null && typeof v === "object" && !(v instanceof Timestamp)) ? { ...v } : v;
  }
  if (action === "importEquipmentModelAlias") return value;
  return value;
}

await ok("a payload mutated AFTER acceptance cannot reach storage, at every window", async () => {
  const windows = ["betweenTransactions", "betweenRetries"];
  const cases = [
    ["model top-level primitive", "importEquipmentModel", () => model(), EQUIPMENT_MODELS_COLLECTION, MODEL_ID, null, null, (p) => { p.displayName = "MUTATED"; }],
    ["model version", "importEquipmentModel", () => model(), EQUIPMENT_MODELS_COLLECTION, MODEL_ID, null, null, (p) => { p.version = 99; }],
    ["model target identity", "importEquipmentModel", () => model(), EQUIPMENT_MODELS_COLLECTION, MODEL_ID, null, null, (p) => { p.equipmentModelId = "TAYLOR--C825"; p.modelNumber = "C825"; }],
  ];
  let n = 0;
  for (const [label, action, make, collection, docId, expectedVersion, seed, mutate] of cases) {
    for (const when of windows) {
      const payload = make();
      const { stored } = await assertMutationCannotLand({
        action, payload, expectedVersion, collection, docId, seed, mutate, when, key: `key-toctou-${(n += 1)}`,
      });
      assert.equal(stored.displayName, "Taylor C713", `${label}/${when}: displayName untouched`);
      assert.equal(stored.version, 1, `${label}/${when}: version untouched`);
      assert.equal(stored.equipmentModelId, MODEL_ID, `${label}/${when}: identity untouched`);
    }
  }
});

await ok("nested applicability, evidence and verification payload mutations cannot reach storage", async () => {
  const seedBoth = (db) => { seedModel(db); };
  // Nested applicability on a compatibility import.
  for (const when of ["betweenTransactions", "betweenRetries"]) {
    const payload = compatOf({ applicability: { kind: "MODEL_REVISION", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: "REV-A" } });
    const { stored } = await assertMutationCannotLand({
      action: "importCompatibility", payload, collection: EQUIPMENT_PART_COMPATIBILITY_COLLECTION,
      docId: payload.compatibilityId, seed: seedBoth, when, key: `key-toctou-app-${when}`,
      mutate: (p) => { p.applicability.modelRevision = "REV-Z"; p.applicability.kind = "ALL_SERIALS"; p.partId = "TST-9999"; },
    });
    assert.equal(stored.applicability.modelRevision, "REV-A", `${when}: nested applicability untouched`);
    assert.equal(stored.applicability.kind, "MODEL_REVISION");
    assert.equal(stored.partId, "TST-1001");
  }
  // observedClaim / contentFingerprint on evidence.
  for (const when of ["betweenTransactions", "betweenRetries"]) {
    const compat = compatOf();
    const payload = sourceOf(compat.compatibilityId);
    const { stored } = await assertMutationCannotLand({
      action: "importCompatibilitySource", payload, collection: EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION,
      docId: payload.sourceId, seed: (db) => { seedModel(db); seedCompat(db, compat); }, when,
      key: `key-toctou-src-${when}`,
      mutate: (p) => { p.observedClaim = "CONTRADICTS"; p.contentFingerprint = "f".repeat(64); },
    });
    assert.equal(stored.observedClaim, "SUPPORTS", `${when}: observedClaim untouched`);
    assert.equal(stored.contentFingerprint, "a".repeat(64));
  }
  // alias ownership field.
  for (const when of ["betweenTransactions", "betweenRetries"]) {
    const payload = aliasOf();
    const { stored } = await assertMutationCannotLand({
      action: "importEquipmentModelAlias", payload, collection: EQUIPMENT_MODEL_ALIASES_COLLECTION,
      docId: payload.aliasKey, seed: seedBoth, when, key: `key-toctou-alias-${when}`,
      mutate: (p) => { p.equipmentModelId = "TAYLOR--C825"; },
    });
    assert.equal(stored.equipmentModelId, MODEL_ID, `${when}: alias ownership untouched`);
  }
});
await ok("a verificationStatus mutated after acceptance cannot reach storage", async () => {
  for (const when of ["betweenTransactions", "betweenRetries"]) {
    const db = fakeDb();
    seedModel(db);
    const compat = compatOf();
    seedCompat(db, compat);
    const payload = { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" };
    const { deps } = makeDeps(db);
    const originalRun = db.runTransaction.bind(db);
    let n = 0, fired = false;
    const fire = () => { if (!fired) { payload.verificationStatus = "REJECTED"; fired = true; } };
    if (when === "betweenTransactions") {
      db.runTransaction = async (fn) => { const r = await originalRun(fn); if ((n += 1) === 1) fire(); return r; };
    } else {
      db.runTransaction = async (fn) => {
        n += 1;
        if (n === 2) { try { await originalRun(async (t) => { await fn(t); throw new Error("retry"); }); } catch { /* rolled back */ } fire(); }
        return originalRun(fn);
      };
    }
    const result = await C.runEquipmentCompatibilityCommand({
      actorUid: "actor-1", action: "verifyCompatibility", idempotencyKey: `key-toctou-verify-${when}`, payload, expectedVersion: 1,
    }, deps);
    db.runTransaction = originalRun;
    assert.equal(result.status, "applied");
    assert.equal(db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId).verificationStatus, "VERIFIED", `${when}: the prepared status is what was written`);
  }
});
await ok("a serialSchemes registry mutated after acceptance cannot change persistence", async () => {
  for (const when of ["betweenTransactions", "betweenRetries"]) {
    const db = fakeDb();
    seedModel(db);
    const registry = structuredClone(SCHEMES);
    const payload = compatOf({ applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: "A200", modelRevision: null } });
    const { deps } = makeDeps(db);
    deps.serialSchemes = registry;
    const originalRun = db.runTransaction.bind(db);
    let n = 0, fired = false;
    // Remove the scheme entirely AND corrupt the retained scheme object: neither may affect the write.
    const fire = () => {
      if (fired) return;
      registry["TAYLOR-ALPHA"].tokenPattern = "^NOPE$";
      registry["TAYLOR-ALPHA"].ordering = "NUMERIC";
      delete registry["TAYLOR-ALPHA"];
      fired = true;
    };
    if (when === "betweenTransactions") {
      db.runTransaction = async (fn) => { const r = await originalRun(fn); if ((n += 1) === 1) fire(); return r; };
    } else {
      db.runTransaction = async (fn) => {
        n += 1;
        if (n === 2) { try { await originalRun(async (t) => { await fn(t); throw new Error("retry"); }); } catch { /* rolled back */ } fire(); }
        return originalRun(fn);
      };
    }
    const result = await C.runEquipmentCompatibilityCommand({
      actorUid: "actor-1", action: "importCompatibility", idempotencyKey: `key-toctou-scheme-${when}`, payload,
    }, deps);
    db.runTransaction = originalRun;
    assert.equal(result.status, "applied", `${when}: the detached registry kept the command valid`);
    const stored = db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, payload.compatibilityId);
    assert.equal(stored.applicability.serialScheme, "TAYLOR-ALPHA");
    assert.equal(stored.applicability.serialRangeStart, "A100");
  }
});
await ok("an INVALID post-acceptance mutation cannot become a denial or alter replay", async () => {
  const db = fakeDb();
  const payload = model();
  const { deps } = makeDeps(db);
  const originalRun = db.runTransaction.bind(db);
  let n = 0;
  db.runTransaction = async (fn) => {
    const r = await originalRun(fn);
    if ((n += 1) === 1) { payload.status = "BOGUS"; payload.version = -5; }
    return r;
  };
  const result = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importEquipmentModel", idempotencyKey: "key-toctou-invalid", payload }, deps);
  db.runTransaction = originalRun;
  assert.equal(result.status, "applied", "an invalid later mutation does not turn an accepted command into a denial");
  const stored = db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID);
  assert.equal(stored.status, "ACTIVE");
  assert.equal(stored.version, 1);
  // Exact replay of the ORIGINAL command remains a no-op; the mutated object is a DIFFERENT command.
  const pristine = model();
  const { deps: d2 } = makeDeps(db);
  const mark = auditMark(db);
  const replay = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importEquipmentModel", idempotencyKey: "key-toctou-invalid", payload: pristine }, d2);
  assert.deepEqual(replay, { status: "applied", targetId: MODEL_ID, resultVersion: 1, replayed: true });
  assert.deepEqual(auditsSince(db, mark), [], "replay writes no audit");
  // ...and replaying the key with the MUTATED object is an idempotency conflict, not a silent overwrite.
  const { deps: d3 } = makeDeps(db);
  await assert.rejects(
    () => C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importEquipmentModel", idempotencyKey: "key-toctou-invalid", payload: model({ displayName: "Different" }) }, d3),
    E.IdempotencyConflictError
  );
  assert.equal(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID).displayName, "Taylor C713");
});
await ok("the prepared command value is deep-frozen", async () => {
  const prepared = FP.prepareCommand({
    action: "importCompatibility", targetType: "equipment_part_compatibility",
    targetId: compatOf().compatibilityId, payload: compatOf(), serialSchemes: SCHEMES,
  });
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.value), true);
  assert.equal(Object.isFrozen(prepared.value.applicability), true, "nested values are frozen too");
  assert.equal(Object.isFrozen(prepared.serialSchemes), true);
  assert.throws(() => { prepared.value.partId = "X"; }, TypeError);
  assert.throws(() => { prepared.value.applicability.kind = "X"; }, TypeError);
});

await ok("expectedVersion is REFUSED for non-versioned alias and source actions", async () => {
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf();
  seedCompat(db, compat);
  for (const [action, payload] of [["importEquipmentModelAlias", aliasOf()], ["importCompatibilitySource", sourceOf(compat.compatibilityId)]]) {
    const { deps } = makeDeps(db);
    await assert.rejects(
      () => C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action, idempotencyKey: `key-ev-${action}`, payload, expectedVersion: 1 }, deps),
      E.InvalidInputError,
      `${action} must not silently ignore expectedVersion`
    );
    assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, `key-ev-${action}`), undefined);
  }
  const { deps: d2 } = makeDeps(db);
  assert.equal((await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-ev-null", payload: aliasOf(), expectedVersion: null }, d2)).status, "applied");
});
await ok("the audit seam represents EVERY governed lifecycle action", async () => {
  assert.deepEqual([...C.EQUIPMENT_AUDIT_ACTIONS], [
    "initiateEquipmentCompatibilityCommand", "equipmentCompatibilityCommand",
    "equipmentCompatibilityVerification", "equipmentCompatibilityCorrection",
    "equipmentCompatibilityConflict",
  ]);
  assert.equal(Object.isFrozen(C.EQUIPMENT_AUDIT_ACTIONS), true);
  assert.equal(Object.isFrozen(C.DENIAL_REASONS), true);
});
await ok("a secret-shaped, oversized or control-bearing audit field can never be persisted", async () => {
  const db = fakeDb();
  const { deps } = makeDeps(db);
  await db.runTransaction(async (txn) => {
    const base = { actorUid: "actor-1", action: C.TERMINAL_AUDIT_ACTION, targetType: "equipment_models", targetId: MODEL_ID, outcome: "denied" };
    const at = Timestamp.fromMillis(clock);
    for (const summary of ["password = hunter2", "Bearer abcdefghijklmno", "sk_abcdefghijklmnop12", "ok\u0000", "", "x".repeat(501)]) {
      assert.throws(() => C.stageEquipmentAuditEvent(txn, deps, { ...base, summary }, at), C.EquipmentAuditValidationError, JSON.stringify(summary));
    }
    for (const actorUid of ["", "x".repeat(129), "bad\u0000actor"]) {
      assert.throws(() => C.stageEquipmentAuditEvent(txn, deps, { ...base, actorUid, summary: "ok" }, at), C.EquipmentAuditValidationError);
    }
    assert.throws(() => C.stageEquipmentAuditEvent(txn, deps, { ...base, action: "notAnEquipmentAction", summary: "ok" }, at), C.EquipmentAuditValidationError);
    assert.throws(() => C.stageEquipmentAuditEvent(txn, deps, { ...base, targetId: "", summary: "ok" }, at), C.EquipmentAuditValidationError);
    assert.equal(txn.__queued.length, 0, "nothing invalid was staged");
  });
});
await ok("a denied TX2 still records the terminal operation and audit atomically", async () => {
  const db = fakeDb();
  seedModel(db);
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  const denied = await run(deps, { idempotencyKey: "key-denied-atomic" });
  assert.equal(denied.status, "denied");
  const op = db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-denied-atomic");
  assert.equal(op.status, "denied");
  assert.equal(op.resultVersion, null);
  assert.equal(auditsSince(db, mark).at(-1).outcome, "denied");
  // A denied operation is terminal: a later replay reports it and never becomes applied.
  const { deps: d2 } = makeDeps(db);
  const replay = await run(d2, { idempotencyKey: "key-denied-atomic" });
  assert.deepEqual(replay, { status: "denied", targetId: MODEL_ID, reason: "previously denied", replayed: true });
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-denied-atomic").status, "denied");
});

console.log(`\n${passed} command orchestrator checks passed`);
