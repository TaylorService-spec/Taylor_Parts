// D4 Stage C.2 -- command orchestrator tests.
//
// SCOPE AND EVIDENCE BOUNDARY: no emulator. The same transaction-faithful in-memory double as the B.2
// suite (queued writes, commit-time preconditions, reads-before-writes, no read-your-own-staged-write)
// plus injected permission and audit seams. That is enough to prove the ORCHESTRATION: two-transaction
// ordering, durable initiation before mutation, idempotent replay, fingerprint conflict, expected-version,
// referential integrity, and audit pairing. Real contention/retry, real Rules and the genuine
// multi-client race remain STAGE E emulator work. Nothing here activates a permission or grants a role --
// the resolver is a fixture, exactly as the design's §5 seam requires.
import "./support/firebaseOfflineGuard.cjs"; // FIRST: Firebase test-safety guard (offline mode) -- see test/support/firebaseTestGuard.cjs
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
// The governed evidence cap -- imported from the READ-service module's re-export, so a test asserting
// the write path is CONSISTENT with the read path pulls the same public surface a real caller would.
const RS = await import("../lib/equipmentCompatibility/readService.js");

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
  const limitCalls = [];
  // The ONE bounded query D4 uses: single-field equality, optionally capped with `.limit(n)` (mirroring
  // Firestore's Query.limit -- the cap is enforced by the query, not by slicing the result afterward).
  // Modelled faithfully -- it reads COMMITTED state only, exactly like a transactional get.
  const query = (c, field, value, limit) => ({
    __query: true, __c: c, __field: field, __value: value, __limit: limit,
    limit(n) { limitCalls.push({ c, field, value, n }); return query(c, field, value, n); },
    async get() { return runQuery(c, field, value, limit); },
  });
  const runQuery = (c, field, value, limit) => {
    const matched = [...committed.entries()]
      .filter(([k, v]) => k.startsWith(`${c}/`) && v && v[field] === value)
      .map(([k, v]) => ({ id: k.slice(c.length + 1), data: () => v }));
    const docs = typeof limit === "number" ? matched.slice(0, limit) : matched;
    return { docs, size: docs.length }; // real Firestore QuerySnapshot exposes .size the same way
  };
  return {
    collection: (c) => ({ doc: (d) => docRef(c, d), where: (f, op, v) => { if (op !== "==") throw new Error(`unsupported op ${op}`); return query(c, f, v); } }),
    __committed: committed,
    __seed: (c, d, data) => committed.set(key(c, d), data),
    __raw: (c, d) => committed.get(key(c, d)),
    __transactions: () => transactions,
    __limitCalls: () => limitCalls.slice(),
    async runTransaction(fn) {
      transactions += 1;
      const queued = [];
      const txn = {
        async get(ref) {
          if (queued.length > 0) throw new ReadAfterWriteError("all reads must precede all writes");
          return ref.__query ? runQuery(ref.__c, ref.__field, ref.__value, ref.__limit) : snapOf(ref.__c, ref.__d);
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

// ---- CATALOG FREEZE (activation window step 2) ----
//
// CATALOG_WRITER_AUTHORITY is FROZEN/INACTIVE, so EVERY action of this orchestrator is a frozen legacy
// catalog writer: acceptForExecution refuses it before capability resolution and before any operation
// record, read, write or lifecycle audit. The command-level lifecycle tests below are therefore REFUSAL
// proofs (ruling A); where a PURE module below the guard owns the domain rule, that rule is proven
// directly against it (ruling B). The guard is never injected, replaced or reopened here.
const { FirestoreCatalogWriterClosedError } = await import("../lib/catalogMaster/catalogWriterState.js");
const { isSameOperationCommand, isAllowedOperationTransition, assertOperationTransition, IllegalOperationTransitionError } =
  await import("../lib/equipmentCompatibility/operations.js");
const FP = await import("../lib/equipmentCompatibility/commandFingerprint.js");
const { ACTION_TARGET_TYPES } = await import("../lib/equipmentCompatibility/operations.js");
const FROZEN_WRITER = Object.freeze({
  importEquipmentModel: "equipmentModel.import",
  importEquipmentModelAlias: "equipmentModelAlias.import",
  importCompatibility: "equipmentPartCompatibility.import",
  verifyCompatibility: "equipmentPartCompatibility.verify",
  correctCompatibility: "equipmentPartCompatibility.correct",
  importCompatibilitySource: "equipmentCompatibilitySource.import",
});
// Every committed non-audit document, by key, with its stored object IDENTITY: an unchanged identity
// proves nothing was written to it (the fake replaces the object on every commit).
const nonAuditState = (db) => [...db.__committed.entries()].filter(([k]) => !k.startsWith(`${AUDIT_EVENTS}/`));
// THE REFUSAL PROOF. The typed freeze refusal naming the right writer; NO operation record; NO write to
// any governed (non-audit) document; and exactly ONE terminal `denied` audit -- no initiation, no
// applied terminal, no specialized event. The denial REASON is the governed state refusal `catalog_writer_closed`,
// never `internal_error` (the class-C finding of the freeze fix cycle, repaired in denialReasonFor()).
async function assertFrozen(db, deps, input) {
  const before = nonAuditState(db);
  const mark = auditMark(db);
  await assert.rejects(
    () => C.runEquipmentCompatibilityCommand(input, deps),
    (e) => e instanceof FirestoreCatalogWriterClosedError && e.code === "FIRESTORE_CATALOG_WRITER_FROZEN" && e.writer === FROZEN_WRITER[input.action],
    `${input.action}/${input.idempotencyKey}: must be refused by the catalog freeze`,
  );
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, input.idempotencyKey), undefined, `${input.idempotencyKey}: no operation record`);
  const after = nonAuditState(db);
  assert.equal(after.length, before.length, "no governed document was created");
  for (const [k, v] of before) assert.equal(db.__committed.get(k), v, `${k} was not written`);
  const events = auditsSince(db, mark);
  assert.deepEqual(events.map((a) => [a.action, a.outcome]), [[C.TERMINAL_AUDIT_ACTION, "denied"]], "only the terminal denied audit");
  assert.match(events[0].summary, / denied: catalog_writer_closed$/, "a freeze is audited as a state refusal, never as an internal error");
}
const cmd = (over = {}) => ({ actorUid: "actor-1", action: "importEquipmentModel", idempotencyKey: "key-abcdefgh", payload: model(), expectedVersion: null, ...over });
const fingerprintOf = (action, targetId, payload) => FP.buildCommandFingerprint({ action, targetType: ACTION_TARGET_TYPES[action], targetId, payload, serialSchemes: SCHEMES });

// ---- two-transaction lifecycle ----
await ok("TX1 records initiation durably BEFORE any mutation; TX2 mutates and terminates", async () => {
  // Ruling A: importEquipmentModel is a frozen catalog writer -- refused before TX1, nothing initiated or mutated.
  const db = fakeDb();
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, cmd());
  assert.equal(db.__transactions(), 1, "only the denial-audit transaction ran: no TX1, no TX2");
  // Ruling B: the operation state machine (initiation precedes any terminal state) is pure.
  assert.equal(isAllowedOperationTransition(null, "initiated"), true);
  assert.equal(isAllowedOperationTransition(null, "applied"), false, "nothing can be applied without a durable initiation");
  assert.equal(isAllowedOperationTransition(null, "denied"), false);
});
await ok("a crash between TX1 and TX2 leaves a resumable initiation and no mutation", async () => {
  // Ruling A: the frozen command never reaches TX1, so a TX2 crash cannot even be staged; nothing is written.
  const db = fakeDb();
  const { deps } = makeDeps(db);
  const original = db.runTransaction.bind(db);
  let calls = 0;
  db.runTransaction = async (fn) => { calls += 1; if (calls === 2) throw new Error("crash after TX1"); return original(fn); };
  await assertFrozen(db, deps, cmd());
  db.runTransaction = original;
  assert.equal(calls, 1, "no second transaction was ever attempted");
  // Ruling B: an initiated operation is resumable to exactly one terminal state (pure state machine).
  assert.equal(isAllowedOperationTransition("initiated", "applied"), true);
  assert.equal(isAllowedOperationTransition("initiated", "denied"), true);
  assert.equal(isAllowedOperationTransition("initiated", "initiated"), false, "a resume never creates a second initiation");
});
await ok("a replay after TX2 reads the terminal record and mutates nothing", async () => {
  // Ruling A: both the original and the replay are refused by the freeze; neither writes anything.
  const db = fakeDb();
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, cmd());
  const { deps: deps2 } = makeDeps(db);
  await assertFrozen(db, deps2, cmd());
  // Ruling B: a terminal operation never moves again (pure state machine).
  for (const [from, to] of [["applied", "applied"], ["applied", "denied"], ["denied", "applied"], ["denied", "denied"]]) {
    assert.equal(isAllowedOperationTransition(from, to), false, `${from} -> ${to}`);
    assert.throws(() => assertOperationTransition(from, to), IllegalOperationTransitionError);
  }
});

// ---- idempotency ----
await ok("a reused key with a DIFFERENT command fails closed and changes nothing", async () => {
  // Ruling A: the original and every reused-key variant are refused by the freeze with no operation record.
  const db = fakeDb();
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, cmd());
  const variants = [
    { payload: model({ displayName: "Different" }) },      // different payload -> different fingerprint
    { actorUid: "actor-2" },                                // different actor
    { expectedVersion: 1 },                                 // different expected version
  ];
  for (const over of variants) {
    const { deps: d } = makeDeps(db);
    await assertFrozen(db, d, cmd(over));
  }
  // Ruling B: the reused-key comparison is the pure isSameOperationCommand over the fingerprinted binding.
  const bind = (o = {}) => ({
    actorUid: "actor-1", action: "importEquipmentModel", targetType: "equipment_models", targetId: MODEL_ID, expectedVersion: null,
    commandFingerprint: fingerprintOf("importEquipmentModel", MODEL_ID, model()), ...o,
  });
  assert.equal(isSameOperationCommand(bind(), bind()), true, "an exact reuse is the same command");
  assert.equal(isSameOperationCommand(bind(), bind({ commandFingerprint: fingerprintOf("importEquipmentModel", MODEL_ID, model({ displayName: "Different" })) })), false, "different payload");
  assert.equal(isSameOperationCommand(bind(), bind({ actorUid: "actor-2" })), false, "different actor");
  assert.equal(isSameOperationCommand(bind(), bind({ expectedVersion: 1 })), false, "different expected version");
});

// ---- pre-acceptance denial ----
await ok("an unauthorized actor produces NO operation record, only a terminal denied audit", async () => {
  // Ruling A: the freeze gate precedes capability resolution -- refused FROZEN, and the resolver is never consulted.
  const db = fakeDb();
  let resolved = 0;
  const { deps } = makeDeps(db, { grant: () => { resolved += 1; return false; } });
  await assertFrozen(db, deps, cmd());
  assert.equal(resolved, 0, "the freeze refuses before any capability is resolved");
});
await ok("a resolver that THROWS denies rather than approves", async () => {
  // Ruling A: frozen before the resolver is reached, so a throwing resolver cannot run at all.
  const db = fakeDb();
  let resolved = 0;
  const { deps } = makeDeps(db, { grant: () => { resolved += 1; throw new Error("resolver exploded"); } });
  await assertFrozen(db, deps, cmd());
  assert.equal(resolved, 0);
});
await ok("malformed input is refused before acceptance, with no operation record", async () => {
  const db = fakeDb();
  // Refused BEFORE the freeze gate (the action must be known before it can be gated): unchanged.
  for (const [over, kind] of [[{ actorUid: "" }, E.InvalidInputError], [{ action: "nope" }, E.InvalidInputError]]) {
    const { deps } = makeDeps(db);
    const mark = auditMark(db);
    await assert.rejects(() => run(deps, over), kind, JSON.stringify(over));
    assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-abcdefgh"), undefined);
    const events = auditsSince(db, mark);
    assert.deepEqual(events.map((a) => a.outcome), ["denied"]);
    assert.match(events[0].summary, /denied: (invalid_input|catalog_writer_closed)$/, "no raw exception text, and never internal_error");
  }
  // Ruling A: a known action is refused FROZEN before its key, version or payload are even examined.
  for (const over of [
    { idempotencyKey: "short" }, { expectedVersion: -1 },
    { payload: { ...model(), status: "BOGUS" } }, { payload: { ...model(), futureField: "x" } },
  ]) {
    const { deps } = makeDeps(db);
    await assertFrozen(db, deps, cmd(over));
  }
  // Ruling B: the payload refusals belong to the pure fingerprint contract, which still refuses them.
  for (const payload of [{ ...model(), status: "BOGUS" }, { ...model(), futureField: "x" }]) {
    assert.throws(() => fingerprintOf("importEquipmentModel", MODEL_ID, payload), Error, JSON.stringify(payload));
  }
});
await ok("the actor is server-derived: no payload field can change who is recorded", async () => {
  // Ruling A: both commands are refused FROZEN; no operation record (and so no recorded actor) exists.
  const db = fakeDb();
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, cmd({ payload: { ...model(), actorUid: "attacker" } }));
  const { deps: d2 } = makeDeps(db);
  await assertFrozen(db, d2, cmd({ actorUid: "actor-9", idempotencyKey: "key-server-uid" }));
  // Ruling B: an actorUid inside the payload is an unknown governed field to the pure fingerprint contract.
  assert.throws(() => fingerprintOf("importEquipmentModel", MODEL_ID, { ...model(), actorUid: "attacker" }), Error);
});

// ---- expected version ----
await ok("expected-version concurrency is enforced on the record's OWN version", async () => {
  // Ruling A: every version variant is refused FROZEN; the seeded model is untouched.
  const db = fakeDb();
  seedModel(db);
  for (const over of [
    { idempotencyKey: "key-null-vs-exists" },
    { idempotencyKey: "key-stale-ver", expectedVersion: 5, payload: model({ version: 6 }) },
    { idempotencyKey: "key-good-ver", expectedVersion: 1, payload: model({ version: 2, displayName: "Taylor C713 II" }) },
  ]) {
    const { deps } = makeDeps(db);
    await assertFrozen(db, deps, cmd(over));
  }
  assert.equal(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID).version, 1);
});

// ---- referential integrity ----
await ok("an alias cannot create or imply a model", async () => {
  // Ruling A: alias import is a frozen writer, with or without its model present; no alias, no model.
  const db = fakeDb();
  const alias = aliasOf();
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, { actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-alias-noref", payload: alias });
  seedModel(db);
  const { deps: d2 } = makeDeps(db);
  await assertFrozen(db, d2, { actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-alias-ok", payload: alias });
  assert.equal(db.__raw(EQUIPMENT_MODEL_ALIASES_COLLECTION, alias.aliasKey), undefined, "no alias was created");
});
await ok("an alias already owned by another model fails closed for review", async () => {
  // Ruling A: both alias imports are refused FROZEN; no alias ownership is written.
  const db = fakeDb();
  seedModel(db);
  db.__seed(EQUIPMENT_MODELS_COLLECTION, "TAYLOR--C825", M.modelToFirestore({ model: model({ modelNumber: "C825", equipmentModelId: "TAYLOR--C825" }), ...META }));
  const alias = aliasOf();
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, { actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-alias-own", payload: alias });
  const { deps: d2 } = makeDeps(db);
  await assertFrozen(db, d2, { actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-alias-conflict", payload: aliasOf({ equipmentModelId: "TAYLOR--C825" }) });
  // Ruling B: one alias key owned by two models is a conflict to the pure D1 detector.
  const rawAlias = (equipmentModelId) => ({ aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C-713", equipmentModelId });
  const conflicts = D1.detectModelAliasConflicts([rawAlias(MODEL_ID), rawAlias("TAYLOR--C825")]);
  assert.deepEqual(conflicts.invalid, []);
  assert.deepEqual(conflicts.conflicts, [{ aliasKey: alias.aliasKey, equipmentModelIds: ["TAYLOR--C713", "TAYLOR--C825"] }]);
});
await ok("evidence cannot create the relationship it cites, and is immutable once written", async () => {
  // Ruling A: evidence import is refused FROZEN with and without its relationship, and on a re-key.
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf();
  const source = sourceOf(compat.compatibilityId);
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, { actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: "key-src-orphan", payload: source });
  seedCompat(db, compat);
  for (const key of ["key-src-ok", "key-src-again"]) {
    const { deps: d } = makeDeps(db);
    await assertFrozen(db, d, { actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: key, payload: source });
  }
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, source.sourceId), undefined);
});
await ok("a compatibility relationship requires its equipment model", async () => {
  // Ruling A: compatibility import is a frozen writer; no relationship is written.
  const db = fakeDb();
  const compat = compatOf();
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, { actorUid: "actor-1", action: "importCompatibility", idempotencyKey: "key-cmp-noref", payload: compat });
  assert.equal(db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId), undefined);
});

// ---- verify / correct ----
await ok("verification bumps the record version and never auto-creates", async () => {
  // Ruling A: verification is a frozen writer, against a missing and an existing relationship alike.
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf();
  const verify = (key) => ({ actorUid: "actor-1", action: "verifyCompatibility", idempotencyKey: key, payload: { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" }, expectedVersion: 1 });
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, verify("key-verify-missing"));
  seedCompat(db, compat);
  const { deps: d2 } = makeDeps(db);
  await assertFrozen(db, d2, verify("key-verify-ok"));
  const stored = db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId);
  assert.equal(stored.verificationStatus, "UNVERIFIED");
  assert.equal(stored.version, 1);
});
await ok("a correction requires an existing relationship", async () => {
  // Ruling A: correction is a frozen writer, against a missing and an existing relationship alike.
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf();
  const correct = (key) => ({ actorUid: "actor-1", action: "correctCompatibility", idempotencyKey: key, payload: compatOf({ version: 2, notes: "corrected" }), expectedVersion: 1 });
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, correct("key-correct-missing"));
  seedCompat(db, compat);
  const { deps: d2 } = makeDeps(db);
  await assertFrozen(db, d2, correct("key-correct-ok"));
  assert.equal(db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId).notes, null);
});

// ---- audit pairing + atomicity ----
await ok("audit persistence is create-only and ATOMIC with its transaction", async () => {
  // Ruling A: the frozen command stages exactly one terminal denied audit, and nothing else.
  const db = fakeDb();
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  await assertFrozen(db, deps, cmd({ idempotencyKey: "key-audit-pair" }));
  const events = auditsSince(db, mark);
  assert.equal(events.length, 1);
  assert.equal(events[0].targetType, "equipment_models");
  for (const a of events) {
    assert.ok(a.summary.length <= 500, "summary is bounded");
    assert.equal(typeof a.actorUid, "string");
    assert.ok(a.at instanceof Timestamp, "audit carries a governed timestamp");
  }
  // Ruling B: CREATE-ONLY is unchanged -- re-staging the EXISTING (denial) audit id fails at commit rather than overwriting.
  const existingAuditId = [...db.__committed.keys()].find((k) => k.startsWith(`${AUDIT_EVENTS}/`)).split("/")[1];
  await assert.rejects(() => db.runTransaction(async (txn) => {
    txn.create(db.collection(AUDIT_EVENTS).doc(existingAuditId), { rewritten: true });
  }), AlreadyExistsError);
  assert.notEqual(db.__raw(AUDIT_EVENTS, existingAuditId).rewritten, true, "the existing event is untouched");
});
await ok("a rolled-back TX1 leaves NO audit event and no operation", async () => {
  // Ruling A: the only transaction a frozen command runs is its denial-audit one; rolling THAT back
  // surfaces the rollback and commits nothing at all -- no audit, no operation, no mutation.
  const db = fakeDb();
  const { deps } = makeDeps(db);
  const mark = auditMark(db);
  const original = db.runTransaction.bind(db);
  let calls = 0;
  db.runTransaction = async (fn) => original(async (txn) => { calls += 1; await fn(txn); throw new Error("TX1 rolled back"); });
  await assert.rejects(() => run(deps, { idempotencyKey: "key-tx1-rollback" }), /TX1 rolled back/);
  db.runTransaction = original;
  assert.equal(calls, 1, "only the denial-audit transaction was attempted");
  assert.deepEqual(auditsSince(db, mark), [], "the denial audit rolled back with its transaction");
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_OPERATIONS_COLLECTION, "key-tx1-rollback"), undefined);
  assert.equal(db.__raw(EQUIPMENT_MODELS_COLLECTION, MODEL_ID), undefined);
});
await ok("a rolled-back TX2 leaves the initiation intact and NO terminal audit or mutation", async () => {
  // Ruling A: frozen before TX1, so there is no TX2 to roll back and no initiation to leave behind.
  const db = fakeDb();
  const { deps } = makeDeps(db);
  const original = db.runTransaction.bind(db);
  let calls = 0;
  db.runTransaction = async (fn) => original(async (txn) => {
    const r = await fn(txn);
    if ((calls += 1) === 2) throw new Error("TX2 rolled back");
    return r;
  });
  await assertFrozen(db, deps, cmd({ idempotencyKey: "key-tx2-rollback" }));
  db.runTransaction = original;
  assert.equal(calls, 1);
});
await ok("verification and correction each emit their SPECIALIZED event alongside the terminal one", async () => {
  // Ruling A: both are refused FROZEN -- no specialized event, only the terminal denied audit each.
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf();
  seedCompat(db, compat);
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, {
    actorUid: "actor-1", action: "verifyCompatibility", idempotencyKey: "key-verify-audit",
    payload: { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" }, expectedVersion: 1,
  });
  const { deps: d2 } = makeDeps(db);
  await assertFrozen(db, d2, {
    actorUid: "actor-1", action: "correctCompatibility", idempotencyKey: "key-correct-audit",
    payload: compatOf({ version: 3, notes: "corrected" }), expectedVersion: 2,
  });
});
// ---- conflict surfacing is decided by the GOVERNED D2 analyzer, not by the incoming record ----
// Ruling A for every import below (frozen, relationship untouched); Ruling B: the conflict rule itself is
// the PURE analyzeCompatibilityEvidence the command delegates to, so it is proven against it directly.
const importSourceFrozen = async (db, source, key) => {
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, { actorUid: "actor-1", action: "importCompatibilitySource", idempotencyKey: key, payload: source });
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
const analyze = (compat, records) => D2.analyzeCompatibilityEvidence(records, { expectedCompatibilityId: compat.compatibilityId });

await ok("CONTRADICTS as the first and only evidence is NOT a conflict", async () => {
  const { db, compat } = freshWithCompat();
  await importSourceFrozen(db, claim(compat, "CONTRADICTS", "a"), "key-only-contradicts");
  assert.equal(statusOf(db, compat), "UNVERIFIED");
  const a = analyze(compat, [claim(compat, "CONTRADICTS", "a")]);
  assert.equal(a.hasConflict, false, "no support-vs-contradiction, so no CONFLICT");
  assert.equal(a.recommendedStatus, "CONTRADICTED");
  assert.deepEqual(a.invalid, []);
});
await ok("SUPPORTS then CONTRADICTS is a conflict", async () => {
  const { db, compat } = freshWithCompat();
  await importSourceFrozen(db, claim(compat, "SUPPORTS", "a"), "key-s-then-c-1");
  await importSourceFrozen(db, claim(compat, "CONTRADICTS", "b"), "key-s-then-c-2");
  assert.equal(statusOf(db, compat), "UNVERIFIED");
  assert.equal(analyze(compat, [claim(compat, "SUPPORTS", "a")]).hasConflict, false, "supporting evidence alone is no conflict");
  const both = analyze(compat, [claim(compat, "SUPPORTS", "a"), claim(compat, "CONTRADICTS", "b")]);
  assert.equal(both.hasConflict, true);
  assert.equal(both.recommendedStatus, "CONFLICT");
});
await ok("CONTRADICTS then SUPPORTS reaches the SAME conflict result (order-independent)", async () => {
  const { db, compat } = freshWithCompat();
  await importSourceFrozen(db, claim(compat, "CONTRADICTS", "a"), "key-c-then-s-1");
  await importSourceFrozen(db, claim(compat, "SUPPORTS", "b"), "key-c-then-s-2");
  assert.equal(statusOf(db, compat), "UNVERIFIED");
  assert.equal(analyze(compat, [claim(compat, "CONTRADICTS", "a")]).hasConflict, false, "still only one side of the evidence");
  const cs = analyze(compat, [claim(compat, "CONTRADICTS", "a"), claim(compat, "SUPPORTS", "b")]);
  const sc = analyze(compat, [claim(compat, "SUPPORTS", "b"), claim(compat, "CONTRADICTS", "a")]);
  assert.equal(cs.hasConflict, true, "the SUPPORTS arrival is what completes the conflict");
  assert.deepEqual(cs, sc, "order-independent");
});
await ok("INCONCLUSIVE evidence never creates a conflict, in any combination", async () => {
  const { db, compat } = freshWithCompat();
  await importSourceFrozen(db, claim(compat, "INCONCLUSIVE", "a"), "key-inc-1");
  await importSourceFrozen(db, claim(compat, "INCONCLUSIVE", "b"), "key-inc-2");
  await importSourceFrozen(db, claim(compat, "SUPPORTS", "c"), "key-inc-3");
  assert.equal(statusOf(db, compat), "UNVERIFIED");
  assert.equal(analyze(compat, [claim(compat, "INCONCLUSIVE", "a")]).hasConflict, false);
  assert.equal(analyze(compat, [claim(compat, "INCONCLUSIVE", "a"), claim(compat, "INCONCLUSIVE", "b")]).hasConflict, false);
  assert.equal(analyze(compat, [claim(compat, "INCONCLUSIVE", "a"), claim(compat, "INCONCLUSIVE", "b"), claim(compat, "SUPPORTS", "c")]).hasConflict, false, "support + inconclusive is not a conflict");
});
await ok("multiple supporting and contradicting sources still resolve to one conflict transition", async () => {
  const { db, compat } = freshWithCompat();
  for (const [c, fp, key] of [["SUPPORTS", "a", "key-multi-1"], ["SUPPORTS", "b", "key-multi-2"], ["CONTRADICTS", "c", "key-multi-3"], ["CONTRADICTS", "d", "key-multi-4"]]) {
    await importSourceFrozen(db, claim(compat, c, fp), key);
  }
  assert.equal(statusOf(db, compat), "UNVERIFIED");
  assert.equal(db.__raw(EQUIPMENT_PART_COMPATIBILITY_COLLECTION, compat.compatibilityId).version, 1);
  const many = analyze(compat, [claim(compat, "SUPPORTS", "a"), claim(compat, "SUPPORTS", "b"), claim(compat, "CONTRADICTS", "c"), claim(compat, "CONTRADICTS", "d")]);
  assert.equal(many.hasConflict, true);
  assert.equal(many.supporting.length, 2);
  assert.equal(many.contradicting.length, 2);
});
await ok("malformed stored evidence fails closed: no source, no mutation, no audit committed", async () => {
  const { db, compat } = freshWithCompat();
  const incoming = claim(compat, "CONTRADICTS", "b");
  await importSourceFrozen(db, incoming, "key-mal-2");
  assert.equal(db.__raw(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, incoming.sourceId), undefined, "no new evidence");
  // The command fails closed whenever the analyzer reports ANY invalid record; that verdict is pure.
  const a = analyze(compat, [{ ...claim(compat, "SUPPORTS", "a"), observedClaim: "MAYBE" }, incoming]);
  assert.equal(a.invalid.length, 1, "malformed stored evidence is reported, never silently analyzed");
});
// ---- ITEM K: importCompatibilitySource's conflict-analysis read must be BOUNDED, not unbounded ----
await ok("importCompatibilitySource's conflict-analysis read is bounded to .limit(cap+1), never an unbounded .where() scan", async () => {
  // Ruling A: frozen before TX2, so the conflict-analysis query is never issued at all.
  const { db, compat } = freshWithCompat();
  await importSourceFrozen(db, claim(compat, "SUPPORTS", "a"), "key-bound-seed");
  await importSourceFrozen(db, claim(compat, "SUPPORTS", "b"), "key-bound-probe");
  assert.deepEqual(db.__limitCalls().filter((c) => c.c === EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION), [], "no evidence read happened");
});
await ok("importCompatibilitySource FAILS CLOSED with a governed denial once a relationship's STORED evidence already exceeds the cap, rather than reading it unboundedly", async () => {
  // Ruling A: even over the cap, the import is refused FROZEN first; the stored evidence set is untouched.
  const { db, compat } = freshWithCompat();
  for (let i = 0; i < RS.MAX_EVIDENCE_PER_RELATIONSHIP + 1; i++) {
    const s = sourceOf(compat.compatibilityId, { contentFingerprint: `${i}`.padStart(64, "0") });
    db.__seed(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, s.sourceId, CR.sourceToFirestore({ source: s, ...META }));
  }
  const oneMore = sourceOf(compat.compatibilityId, { contentFingerprint: `${RS.MAX_EVIDENCE_PER_RELATIONSHIP + 1}`.padStart(64, "0") });
  await importSourceFrozen(db, oneMore, "key-cap-overflow");
  assert.equal(
    [...db.__committed.keys()].filter((k) => k.startsWith(`${EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION}/`)).length,
    RS.MAX_EVIDENCE_PER_RELATIONSHIP + 1,
    "the evidence set did not grow"
  );
});
await ok("a rolled-back TX2 with the evidence query commits neither evidence nor conflict", async () => {
  // Ruling A: frozen before TX1; with the TX2 rollback injected, nothing is committed and the retry is frozen too.
  const { db, compat } = freshWithCompat();
  const incoming = claim(compat, "CONTRADICTS", "b");
  const original = db.runTransaction.bind(db);
  let calls = 0;
  db.runTransaction = async (fn) => original(async (txn) => {
    const r = await fn(txn);
    if ((calls += 1) === 2) throw new Error("TX2 rolled back");
    return r;
  });
  await importSourceFrozen(db, incoming, "key-roll-2");
  db.runTransaction = original;
  await importSourceFrozen(db, incoming, "key-roll-2");
  assert.equal(statusOf(db, compat), "UNVERIFIED");
});
await ok("the evidence query is bounded to its own relationship", async () => {
  const { db, compat } = freshWithCompat();
  const other = compatOf({ partId: "TST-2002" });
  seedCompat(db, other);
  await importSourceFrozen(db, claim(other, "SUPPORTS", "a"), "key-other-1");
  await importSourceFrozen(db, claim(compat, "CONTRADICTS", "b"), "key-bounded-1");
  assert.equal(statusOf(db, compat), "UNVERIFIED");
  assert.equal(statusOf(db, other), "UNVERIFIED");
  // Supporting evidence on a DIFFERENT relationship is excluded (as a mismatch) and cannot complete a conflict here.
  const a = analyze(compat, [claim(other, "SUPPORTS", "a"), claim(compat, "CONTRADICTS", "b")]);
  assert.equal(a.hasConflict, false);
  assert.deepEqual(a.invalid, [{ index: 0, reason: "compatibility_id_mismatch" }]);
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
// must not be able to change what is written, at ANY window.
//
// Ruling A: every command below is refused FROZEN before any window opens (resolvePermission is never
// entered, no transaction runs), so nothing is written for a mutation to reach. Ruling B: the invariant
// itself lives in the PURE FP.prepareCommand, which detaches the payload and registry ONCE; mutating the
// caller's objects afterwards must not change the prepared value or its fingerprint.
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function assertMutationCannotLand({ action, payload, expectedVersion = null, docId, seed, mutate, key }) {
  const db = fakeDb();
  if (seed) seed(db);
  const original = structuredClone(payload);
  const registry = structuredClone(SCHEMES);
  // A: the command is refused; a permission resolver that would open the pending window is never called.
  const { deps } = makeDeps(db);
  deps.serialSchemes = registry;
  let entered = false;
  deps.resolvePermission = () => { entered = true; return deferred().promise; };
  await assertFrozen(db, deps, { actorUid: "actor-1", action, idempotencyKey: key, payload, expectedVersion });
  assert.equal(entered, false, `${key}: the permission window never opened`);
  // B: prepare, then mutate the caller's retained payload and registry.
  const prepared = FP.prepareCommand({ action, targetType: ACTION_TARGET_TYPES[action], targetId: docId, payload, serialSchemes: registry });
  const valueBefore = structuredClone(prepared.value);
  mutate(payload, registry);
  assert.deepEqual(structuredClone(prepared.value), valueBefore, `${key}: the prepared value is detached from the caller's payload`);
  assert.equal(prepared.fingerprint, fingerprintOf(action, docId, original), `${key}: the fingerprint is the ORIGINAL command's`);
  return { prepared };
}

await ok("a payload mutated AFTER acceptance cannot reach storage, at every window", async () => {
  const cases = [
    ["model top-level primitive", (p) => { p.displayName = "MUTATED"; }],
    ["model version", (p) => { p.version = 99; }],
    ["model target identity", (p) => { p.equipmentModelId = "TAYLOR--C825"; p.modelNumber = "C825"; }],
  ];
  let n = 0;
  for (const [label, mutate] of cases) {
    const { prepared } = await assertMutationCannotLand({
      action: "importEquipmentModel", payload: model(), docId: MODEL_ID, mutate, key: `key-toctou-${(n += 1)}`,
    });
    assert.equal(prepared.value.displayName, "Taylor C713", `${label}: displayName untouched`);
    assert.equal(prepared.value.version, 1, `${label}: version untouched`);
    assert.equal(prepared.value.equipmentModelId, MODEL_ID, `${label}: identity untouched`);
  }
});

await ok("nested applicability, evidence and verification payload mutations cannot reach storage", async () => {
  // Nested applicability on a compatibility import.
  const payload = compatOf({ applicability: { kind: "MODEL_REVISION", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: "REV-A" } });
  const { prepared: app } = await assertMutationCannotLand({
    action: "importCompatibility", payload, docId: payload.compatibilityId, seed: seedModel, key: "key-toctou-app",
    mutate: (p) => { p.applicability.modelRevision = "REV-Z"; p.applicability.kind = "ALL_SERIALS"; p.partId = "TST-9999"; },
  });
  assert.equal(app.value.applicability.modelRevision, "REV-A", "nested applicability untouched");
  assert.equal(app.value.applicability.kind, "MODEL_REVISION");
  assert.equal(app.value.partId, "TST-1001");
  // observedClaim / contentFingerprint on evidence.
  const compat = compatOf();
  const src = sourceOf(compat.compatibilityId);
  const { prepared: ev } = await assertMutationCannotLand({
    action: "importCompatibilitySource", payload: src, docId: src.sourceId,
    seed: (db) => { seedModel(db); seedCompat(db, compat); }, key: "key-toctou-src",
    mutate: (p) => { p.observedClaim = "CONTRADICTS"; p.contentFingerprint = "f".repeat(64); },
  });
  assert.equal(ev.value.observedClaim, "SUPPORTS", "observedClaim untouched");
  assert.equal(ev.value.contentFingerprint, "a".repeat(64));
  // alias ownership field.
  const alias = aliasOf();
  const { prepared: al } = await assertMutationCannotLand({
    action: "importEquipmentModelAlias", payload: alias, docId: alias.aliasKey, seed: seedModel, key: "key-toctou-alias",
    mutate: (p) => { p.equipmentModelId = "TAYLOR--C825"; },
  });
  assert.equal(al.value.equipmentModelId, MODEL_ID, "alias ownership untouched");
});
await ok("a verificationStatus mutated after acceptance cannot reach storage", async () => {
  const compat = compatOf();
  const payload = { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" };
  const { prepared } = await assertMutationCannotLand({
    action: "verifyCompatibility", payload, expectedVersion: 1, docId: compat.compatibilityId,
    seed: (db) => { seedModel(db); seedCompat(db, compat); }, key: "key-toctou-verify",
    mutate: (p) => { p.verificationStatus = "REJECTED"; },
  });
  assert.equal(prepared.value.verificationStatus, "VERIFIED", "the prepared status is what would be written");
});
await ok("a serialSchemes registry mutated after acceptance cannot change persistence", async () => {
  const payload = compatOf({ applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: "A200", modelRevision: null } });
  const { prepared } = await assertMutationCannotLand({
    action: "importCompatibility", payload, docId: payload.compatibilityId, seed: seedModel, key: "key-toctou-scheme",
    // Remove the scheme entirely AND corrupt the retained scheme object: neither may affect the prepared command.
    mutate: (_p, registry) => {
      registry["TAYLOR-ALPHA"].tokenPattern = "^NOPE$";
      registry["TAYLOR-ALPHA"].ordering = "NUMERIC";
      delete registry["TAYLOR-ALPHA"];
    },
  });
  assert.equal(prepared.value.applicability.serialScheme, "TAYLOR-ALPHA");
  assert.equal(prepared.value.applicability.serialRangeStart, "A100");
  assert.equal(prepared.serialSchemes["TAYLOR-ALPHA"].tokenPattern, SCHEME.tokenPattern, "the detached registry kept the command valid");
});
await ok("an INVALID post-acceptance mutation cannot become a denial or alter replay", async () => {
  const { prepared } = await assertMutationCannotLand({
    action: "importEquipmentModel", payload: model(), docId: MODEL_ID, key: "key-toctou-invalid",
    mutate: (p) => { p.status = "BOGUS"; p.version = -5; },
  });
  assert.equal(prepared.value.status, "ACTIVE");
  assert.equal(prepared.value.version, 1);
  // Ruling B: the ORIGINAL command reproduces the same fingerprint; a DIFFERENT one does not (would conflict).
  assert.equal(fingerprintOf("importEquipmentModel", MODEL_ID, model()), prepared.fingerprint);
  assert.notEqual(fingerprintOf("importEquipmentModel", MODEL_ID, model({ displayName: "Different" })), prepared.fingerprint);
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

await ok("the detached serial-scheme dependency is DEEP-frozen", async () => {
  const ranged = compatOf({ applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: "A200", modelRevision: null } });
  const prepared = FP.prepareCommand({
    action: "importCompatibility", targetType: "equipment_part_compatibility",
    targetId: ranged.compatibilityId, payload: ranged, serialSchemes: structuredClone(SCHEMES),
  });
  assert.equal(Object.isFrozen(prepared.serialSchemes), true, "the registry map is frozen");
  const scheme = prepared.serialSchemes["TAYLOR-ALPHA"];
  assert.ok(scheme, "the selected scheme is carried on the prepared command");
  assert.equal(Object.isFrozen(scheme), true, "the SELECTED SCHEME OBJECT is frozen too");
  for (const field of ["schemeId", "manufacturerId", "normalizerVersion", "tokenPattern", "ordering"]) {
    assert.throws(() => { scheme[field] = "MUTATED"; }, TypeError, `scheme.${field} must be immutable`);
    assert.throws(() => { delete scheme[field]; }, TypeError, `scheme.${field} must not be deletable`);
  }
  assert.throws(() => { prepared.serialSchemes["OTHER"] = {}; }, TypeError, "no entry can be added");
});
await ok("a command mutated while permission is pending still replays as the ORIGINAL command", async () => {
  // Ruling A: frozen before resolvePermission, so no pending window exists and nothing is written.
  const db = fakeDb();
  const payload = model();
  const { deps } = makeDeps(db);
  let entered = false;
  deps.resolvePermission = () => { entered = true; return deferred().promise; };
  await assertFrozen(db, deps, cmd({ idempotencyKey: "key-pending-replay", payload }));
  assert.equal(entered, false);
  // Ruling B: the prepared (fingerprinted) command is the original; the mutated one is a different command.
  const prepared = FP.prepareCommand({ action: "importEquipmentModel", targetType: "equipment_models", targetId: MODEL_ID, payload, serialSchemes: SCHEMES });
  payload.displayName = "MUTATED";
  payload.version = 42;
  assert.equal(prepared.value.displayName, "Taylor C713");
  assert.equal(prepared.fingerprint, fingerprintOf("importEquipmentModel", MODEL_ID, model()));
  assert.notEqual(prepared.fingerprint, fingerprintOf("importEquipmentModel", MODEL_ID, model({ displayName: "MUTATED", version: 42 })));
});
await ok("expectedVersion is REFUSED for non-versioned alias and source actions", async () => {
  // Ruling A: the freeze gate precedes the expectedVersion check; every variant is refused FROZEN.
  const db = fakeDb();
  seedModel(db);
  const compat = compatOf();
  seedCompat(db, compat);
  for (const [action, payload] of [["importEquipmentModelAlias", aliasOf()], ["importCompatibilitySource", sourceOf(compat.compatibilityId)]]) {
    const { deps } = makeDeps(db);
    await assertFrozen(db, deps, { actorUid: "actor-1", action, idempotencyKey: `key-ev-${action}`, payload, expectedVersion: 1 });
  }
  const { deps: d2 } = makeDeps(db);
  await assertFrozen(db, d2, { actorUid: "actor-1", action: "importEquipmentModelAlias", idempotencyKey: "key-ev-null", payload: aliasOf(), expectedVersion: null });
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
  // Ruling A: refused FROZEN (twice) against a seeded model; no operation record, terminal or otherwise.
  const db = fakeDb();
  seedModel(db);
  const { deps } = makeDeps(db);
  await assertFrozen(db, deps, cmd({ idempotencyKey: "key-denied-atomic" }));
  const { deps: d2 } = makeDeps(db);
  await assertFrozen(db, d2, cmd({ idempotencyKey: "key-denied-atomic" }));
  // Ruling B: a denied operation is terminal and can never become applied (pure state machine).
  assert.throws(() => assertOperationTransition("denied", "applied"), IllegalOperationTransitionError);
});

console.log(`\n${passed} command orchestrator checks passed`);
