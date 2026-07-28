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
  return {
    collection: (c) => ({ doc: (d) => docRef(c, d) }),
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
          return snapOf(ref.__c, ref.__d);
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
await ok("contradicting evidence forces CONFLICT with its own event, and never auto-verifies", async () => {
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf({ verificationStatus: "VERIFIED" });
  seedCompat(db, compat);
  // SUPPORTING evidence changes no status -- verification is its own governed command.
  const { deps } = makeDeps(db);
  let mark = auditMark(db);
  const supporting = sourceOf(compat.compatibilityId);
  await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-src-supports", payload: supporting }, deps);
  assert.equal(db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId).verificationStatus, "VERIFIED", "unchanged");
  assert.equal(auditsSince(db, mark).some((a) => a.action === "equipmentCompatibilityConflict"), false);
  // CONTRADICTING evidence forces CONFLICT and emits the conflict event, atomically.
  const { deps: d2 } = makeDeps(db);
  mark = auditMark(db);
  const contradicting = sourceOf(compat.compatibilityId, { observedClaim: "CONTRADICTS", contentFingerprint: "c".repeat(64) });
  const applied = await C.runEquipmentCompatibilityCommand({ actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-src-contradicts", payload: contradicting }, d2);
  assert.equal(applied.status, "applied");
  const stored = db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId);
  assert.equal(stored.verificationStatus, "CONFLICT", "never auto-verified, surfaced as CONFLICT");
  assert.equal(stored.version, compat.version + 1);
  const events = auditsSince(db, mark);
  assert.deepEqual(events.map((a) => a.action), [
    C.INITIATION_AUDIT_ACTION, C.TERMINAL_AUDIT_ACTION, "equipmentCompatibilityConflict",
  ]);
  assert.equal(events.at(-1).targetId, compat.compatibilityId);
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, contradicting.sourceId).observedClaim, "CONTRADICTS");
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
