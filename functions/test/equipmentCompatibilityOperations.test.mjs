// Pure unit test for the D4 operation STATE MACHINE (no emulator): the transition guard, strict
// runtime operation-record validation, actor+expected-version-bound idempotency, and full
// predecessor/successor transition validation. Firestore Timestamps are constructed directly (no
// initializeApp / emulator needed for the Timestamp value class).
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { OPERATION_STATES, OPERATION_ACTIONS, OPERATION_TARGET_TYPES, ACTION_TARGET_TYPES, isAllowedActionTarget, isAllowedOperationTransition, assertOperationTransition, assertOperationRecordTransition, validateOperationRecord, isSameOperationCommand, isValidOperationTargetId, timestampMillis } from "../lib/equipmentCompatibility/operations.js";
import { IllegalOperationTransitionError } from "../lib/equipmentCompatibility/errors.js";
import { isCanonicalModelAliasKey, normalizeModelAliasKey } from "../lib/equipmentCompatibility/domain/equipmentModel.js";
let passed = 0; const ok = (n, f) => { f(); passed++; console.log(`PASS -- ${n}`); };

const T0 = Timestamp.fromMillis(1000), T1 = Timestamp.fromMillis(2000), TNEG = Timestamp.fromMillis(500);
const CMP = "cmp_" + "a".repeat(64), SRC = "src_" + "a".repeat(64), MODEL = "TAYLOR--C713", ALIAS = "SOURCE_MODEL|TAYLOR|C-713", FP = "b".repeat(64);
// A canonical target id for each authority, so an action can be paired with any target type on demand.
const TARGET_ID = { equipment_models: MODEL, equipment_model_aliases: ALIAS, equipment_part_compatibility: CMP, equipment_compatibility_sources: SRC };
const initiated = { idempotencyKey: "key-abcdefgh", actorUid: "actor-1", action: "importCompatibility", targetType: "equipment_part_compatibility", targetId: CMP, commandFingerprint: FP, expectedVersion: null, resultVersion: null, status: "initiated", initiatedAt: T0, terminalAt: null };
const applied = { ...initiated, status: "applied", resultVersion: 1, terminalAt: T1 };
const denied = { ...initiated, status: "denied", resultVersion: null, terminalAt: T1 };
const bind = (r) => ({ actorUid: r.actorUid, action: r.action, targetType: r.targetType, targetId: r.targetId, expectedVersion: r.expectedVersion, commandFingerprint: r.commandFingerprint });

// ---- transition state names ----
ok("legal state transitions absent→initiated→applied|denied; terminal one-way", () => {
  assert.equal(isAllowedOperationTransition(null, "initiated"), true);
  assert.equal(isAllowedOperationTransition("initiated", "applied"), true);
  assert.equal(isAllowedOperationTransition("initiated", "denied"), true);
  assert.equal(isAllowedOperationTransition(null, "applied"), false);
  assert.equal(isAllowedOperationTransition("initiated", "initiated"), false);
  for (const from of ["applied", "denied"]) for (const to of OPERATION_STATES) assert.equal(isAllowedOperationTransition(from, to), false);
  assert.throws(() => assertOperationTransition("applied", "denied"), IllegalOperationTransitionError);
});

// ---- actor + expected-version bound idempotency ----
ok("isSameOperationCommand: same actor+command matches; actor/version/any-field diff → mismatch", () => {
  assert.equal(isSameOperationCommand(bind(initiated), bind({ ...initiated })), true);
  assert.equal(isSameOperationCommand(bind(initiated), bind({ ...initiated, actorUid: "actor-2" })), false); // different actor
  assert.equal(isSameOperationCommand(bind({ ...initiated, expectedVersion: 1 }), bind({ ...initiated, expectedVersion: 2 })), false); // different expectedVersion
  assert.equal(isSameOperationCommand(bind(initiated), bind({ ...initiated, action: "verifyCompatibility" })), false);
  assert.equal(isSameOperationCommand(bind(initiated), bind({ ...initiated, targetType: "equipment_models" })), false);
  assert.equal(isSameOperationCommand(bind(initiated), bind({ ...initiated, targetId: "cmp_" + "c".repeat(64) })), false);
  assert.equal(isSameOperationCommand(bind(initiated), bind({ ...initiated, commandFingerprint: "d".repeat(64) })), false);
});

// ---- strict runtime record validation ----
ok("validateOperationRecord accepts well-formed initiated/applied/denied", () => {
  for (const r of [initiated, applied, denied]) assert.equal(validateOperationRecord(r).valid, true, JSON.stringify(r.status));
});
ok("validateOperationRecord rejects each malformation fail-closed", () => {
  const R = (o) => validateOperationRecord({ ...initiated, ...o }).reason;
  assert.equal(validateOperationRecord(null).reason, "not_object");
  assert.equal(validateOperationRecord([]).reason, "not_object");
  assert.equal(validateOperationRecord({ ...initiated, extra: 1 }).reason, "unknown_field");
  const { terminalAt, ...noTerminal } = initiated; assert.match(validateOperationRecord(noTerminal).reason, /^missing_field:terminalAt$/);
  assert.equal(R({ idempotencyKey: "short" }), "idempotency_key_invalid");
  assert.equal(R({ actorUid: "" }), "actor_uid_invalid");
  assert.equal(R({ action: "nope" }), "action_invalid");
  assert.equal(R({ targetType: "nope" }), "target_type_invalid");
  assert.equal(R({ targetId: "not-a-cmp" }), "target_id_invalid");
  assert.equal(R({ commandFingerprint: "short" }), "command_fingerprint_invalid");
  assert.equal(R({ expectedVersion: -1 }), "expected_version_invalid");
  assert.equal(R({ expectedVersion: 1.5 }), "expected_version_invalid");
  assert.equal(R({ status: "bogus" }), "status_invalid");
  assert.equal(R({ initiatedAt: "not-ts" }), "initiated_at_invalid");
  assert.equal(R({ status: "initiated", resultVersion: 1 }), "result_version_must_be_null");
  assert.equal(R({ status: "initiated", terminalAt: T1 }), "terminal_at_must_be_null");
  assert.equal(validateOperationRecord({ ...denied, resultVersion: 5 }).reason, "result_version_must_be_null");
  assert.equal(validateOperationRecord({ ...denied, terminalAt: "x" }).reason, "terminal_at_invalid");
  assert.equal(validateOperationRecord({ ...applied, resultVersion: null }).reason, "result_version_invalid");
  assert.equal(validateOperationRecord({ ...applied, terminalAt: "x" }).reason, "terminal_at_invalid");
  assert.equal(validateOperationRecord({ ...applied, terminalAt: TNEG }).reason, "terminal_before_initiated");
});

// ---- action ↔ target-type coherence ----
ok("every authorized action/target pair is accepted, and ONLY those pairs", () => {
  // Explicit expected mapping, restated independently of the module under test.
  const EXPECTED = {
    importEquipmentModel: "equipment_models",
    importEquipmentModelAlias: "equipment_model_aliases",
    importCompatibility: "equipment_part_compatibility",
    importCompatibilitySource: "equipment_compatibility_sources",
    verifyCompatibility: "equipment_part_compatibility",
    correctCompatibility: "equipment_part_compatibility",
  };
  assert.deepEqual({ ...ACTION_TARGET_TYPES }, EXPECTED);
  assert.deepEqual([...OPERATION_ACTIONS].sort(), Object.keys(EXPECTED).sort()); // no action lacks a mapping
  // Full cross-product: exactly the 6 authorized pairs pass; all other combinations are rejected.
  let allowed = 0;
  for (const action of OPERATION_ACTIONS) {
    for (const targetType of OPERATION_TARGET_TYPES) {
      const expected = EXPECTED[action] === targetType;
      assert.equal(isAllowedActionTarget(action, targetType), expected, `${action} -> ${targetType}`);
      if (expected) allowed++;
    }
  }
  assert.equal(allowed, 6);
  // Inherited/prototype keys never resolve to an authorized pair.
  for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty"]) assert.equal(isAllowedActionTarget(k, "equipment_models"), false, k);
  assert.equal(isAllowedActionTarget(null, "equipment_models"), false);
  assert.equal(isAllowedActionTarget("importCompatibility", null), false);
});
ok("record with valid action + valid target type but UNAUTHORIZED pair is rejected", () => {
  // Representative cross-pairs: each uses a structurally valid action, a structurally valid target type,
  // and a canonical target id for that type — only the COMBINATION is unauthorized.
  const crossPairs = [
    ["importEquipmentModel", "equipment_part_compatibility"],
    ["importEquipmentModelAlias", "equipment_models"],
    ["importCompatibility", "equipment_models"],
    ["importCompatibility", "equipment_compatibility_sources"],
    ["importCompatibilitySource", "equipment_part_compatibility"],
    ["verifyCompatibility", "equipment_model_aliases"],
    ["correctCompatibility", "equipment_compatibility_sources"],
  ];
  for (const [action, targetType] of crossPairs) {
    const r = validateOperationRecord({ ...initiated, action, targetType, targetId: TARGET_ID[targetType] });
    assert.equal(r.valid, false, `${action}/${targetType}`);
    assert.equal(r.reason, "action_target_mismatch", `${action}/${targetType}`);
  }
  // ...and every authorized pair with its canonical target id validates.
  for (const [action, targetType] of Object.entries(ACTION_TARGET_TYPES)) {
    assert.equal(validateOperationRecord({ ...initiated, action, targetType, targetId: TARGET_ID[targetType] }).valid, true, `${action}/${targetType}`);
  }
});
ok("target-id shapes per authority come from the D1/D2 contracts", () => {
  assert.equal(isValidOperationTargetId("equipment_models", MODEL), true);
  assert.equal(isValidOperationTargetId("equipment_models", "taylor--c713"), false);
  assert.equal(isValidOperationTargetId("equipment_model_aliases", ALIAS), true);
  assert.equal(isValidOperationTargetId("equipment_part_compatibility", CMP), true);
  assert.equal(isValidOperationTargetId("equipment_compatibility_sources", SRC), true);
  assert.equal(isValidOperationTargetId("equipment_compatibility_sources", CMP), false);
  assert.equal(isValidOperationTargetId("equipment_part_compatibility", SRC), false);
  assert.equal(isValidOperationTargetId("operations", CMP), false); // the ledger is never a target
});
ok("alias-key target ids are held to the D1 canonical-alias-key contract", () => {
  const bad = [
    "SOURCE_MODEL|TAYLOR",                     // missing a segment
    "SOURCE_MODEL",                            // no separator at all
    "|TAYLOR|C-713",                           // empty alias type
    "SOURCE_MODEL||C-713",                     // empty manufacturer
    "SOURCE_MODEL|TAYLOR|",                    // empty alias value
    "NOPE|TAYLOR|C-713",                       // alias type not in MODEL_ALIAS_TYPES
    "source_model|TAYLOR|C-713",               // not uppercased
    "SOURCE_MODEL|taylor|C-713",               // noncanonical manufacturer casing
    "SOURCE_MODEL|TAYLOR CO|C-713",            // manufacturer not normalized (space, not "-")
    "SOURCE_MODEL|-TAYLOR-|C-713",             // manufacturer with leading/trailing separator
    "SOURCE_MODEL|TAYLOR|c-713",               // alias value not uppercased
    "SOURCE_MODEL|TAYLOR| C-713",              // untrimmed alias value
    "SOURCE_MODEL|TAYLOR|C-713 ",              // trailing whitespace
    "SOURCE_MODEL|TAYLOR|C  713",              // uncollapsed internal whitespace
    "SOURCE_MODEL|TAYLOR|C-713\u0000",         // NUL control character
    "SOURCE_MODEL|TAYLOR|C-713\u001F",         // C0 control character (unit separator)
    "SOURCE_MODEL|TAYLOR|C-713\u007F",         // DEL
    "SOURCE_MODEL|TAYLOR|C-713\u0085",         // C1 next-line
    "SOURCE_MODEL|TAYLOR|C-713\u200B",         // zero-width space
    "SOURCE_MODEL|TAYLOR|C-713\u202E",         // bidi override
    "SOURCE_MODEL|TAYLOR|C-713\u2028",         // line separator
    "SOURCE_MODEL|TAYLOR|C-713\uFEFF",         // byte-order mark
    "SOURCE_MODEL|TAYLOR|\uFF43-713",          // non-NFKC fullwidth (NFKC-normalizes to "C-713")
    "SOURCE_MODEL|TAYLOR|CAFE\u0301",          // non-NFC decomposed accent (combining acute)
    "SOURCE_MODEL|TAYLOR|" + "A".repeat(600),  // beyond the bounded key length
    "", 42, null, undefined, {}, [],           // non-string / empty
  ];
  for (const v of bad) assert.equal(isValidOperationTargetId("equipment_model_aliases", v), false, `alias ${JSON.stringify(v)}`);
  // Canonical keys for every alias type, including an alias value that legitimately contains "|".
  for (const good of ["SOURCE_MODEL|TAYLOR|C-713", "MANUFACTURER_MODEL|TAYLOR|C713", "HISTORICAL_MODEL|TAYLOR-CO|C-713 REV A", "SOURCE_MODEL|TAYLOR|C-713|ALT"]) {
    assert.equal(isValidOperationTargetId("equipment_model_aliases", good), true, `alias ${good}`);
  }
  // Wrong-manufacturer / key-disagreement: the key must be the one D1 DERIVES from its own segments.
  // A key carrying a manufacturer that is not itself canonical disagrees with its derivation and fails,
  // and two manufacturers never share a key -- so an alias cannot be pointed at the wrong manufacturer.
  assert.equal(normalizeModelAliasKey({ aliasType: "SOURCE_MODEL", manufacturerId: "Taylor Co", rawValue: "C-713" }), "SOURCE_MODEL|TAYLOR-CO|C-713");
  assert.equal(isCanonicalModelAliasKey("SOURCE_MODEL|TAYLOR CO|C-713"), false); // disagrees with its own derivation
  assert.equal(isCanonicalModelAliasKey("SOURCE_MODEL|TAYLOR-CO|C-713"), true);
  assert.notEqual(normalizeModelAliasKey({ aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C-713" }), normalizeModelAliasKey({ aliasType: "SOURCE_MODEL", manufacturerId: "Hoshizaki", rawValue: "C-713" }));
  // ...and the operation record enforces the same contract end-to-end.
  assert.equal(validateOperationRecord({ ...initiated, action: "importEquipmentModelAlias", targetType: "equipment_model_aliases", targetId: "SOURCE_MODEL|TAYLOR CO|C-713" }).reason, "target_id_invalid");
  assert.equal(validateOperationRecord({ ...initiated, action: "importEquipmentModelAlias", targetType: "equipment_model_aliases", targetId: ALIAS }).valid, true);
});

// ---- total, fail-closed timestamp validation ----
ok("timestampMillis accepts ONLY an authentic Firestore Timestamp, never a duck-typed impostor", () => {
  // Real Admin SDK Timestamps, including epoch zero and sub-millisecond precision.
  assert.equal(timestampMillis(T0), 1000);
  assert.equal(timestampMillis(Timestamp.fromMillis(0)), 0);
  assert.equal(timestampMillis(new Timestamp(1, 999999999)), 1999);
  // Duck-typed impostor whose toMillis() returns a FINITE number is NOT a Timestamp.
  assert.equal(timestampMillis({ toMillis: () => 1000 }), null);
  // Stateful impostor: finite on the first call, NaN on the next. Rejected outright, and because the
  // millis are DERIVED from seconds/nanoseconds rather than read from a method, no value can drift.
  let n = 0;
  assert.equal(timestampMillis({ toMillis: () => (n++ ? NaN : 1000) }), null);
  // Prototype/subclass impostors: a subclass could override behaviour, so only the exact class passes.
  class SubTimestamp extends Timestamp {}
  assert.equal(timestampMillis(new SubTimestamp(1, 0)), null);
  assert.equal(timestampMillis(Object.create(Timestamp.prototype)), null); // right proto, no real fields
  const spoofed = { seconds: 1, nanoseconds: 0 };
  Object.setPrototypeOf(spoofed, Timestamp.prototype);
  assert.equal(timestampMillis(spoofed), 1000); // exact proto + authentic fields is by definition a Timestamp
  // Throwing call and throwing getters never escape.
  assert.equal(timestampMillis({ toMillis() { throw new Error("boom"); } }), null);
  const throwingGetter = {};
  Object.setPrototypeOf(throwingGetter, Timestamp.prototype);
  Object.defineProperty(throwingGetter, "seconds", { get() { throw new Error("boom"); } });
  assert.doesNotThrow(() => timestampMillis(throwingGetter));
  assert.equal(timestampMillis(throwingGetter), null);
  // Out-of-range / non-integer internal fields.
  for (const f of [{ seconds: 1.5, nanoseconds: 0 }, { seconds: 1, nanoseconds: -1 }, { seconds: 1, nanoseconds: 1e9 }, { seconds: NaN, nanoseconds: 0 }, { seconds: Infinity, nanoseconds: 0 }, { seconds: 1, nanoseconds: NaN }]) {
    Object.setPrototypeOf(f, Timestamp.prototype);
    assert.equal(timestampMillis(f), null, JSON.stringify(f));
  }
  for (const v of [{}, null, undefined, 1000, "1000", [], { seconds: 1, nanoseconds: 0 }]) assert.equal(timestampMillis(v), null);
});
ok("validateOperationRecord NEVER throws on crafted timestamp-like data — it returns invalid", () => {
  const thrower = { toMillis() { throw new Error("boom"); } };
  const throwingGetter = { get toMillis() { throw new Error("boom"); } };
  class SubTs extends Timestamp {}
  const crafted = [{ toMillis: () => 1000 }, new SubTs(1, 0), thrower, throwingGetter, { toMillis: () => NaN }, { toMillis: () => Infinity }, { toMillis: 1000 }, { seconds: 1, nanoseconds: 0 }, "1970-01-01T00:00:00Z", 1000, {}];
  for (const ts of crafted) {
    let r;
    assert.doesNotThrow(() => { r = validateOperationRecord({ ...initiated, initiatedAt: ts }); }, `initiatedAt ${String(ts)}`);
    assert.equal(r.valid, false);
    assert.equal(r.reason, "initiated_at_invalid", `initiatedAt ${String(ts)}`);
    let r2;
    assert.doesNotThrow(() => { r2 = validateOperationRecord({ ...applied, terminalAt: ts }); }, `terminalAt ${String(ts)}`);
    assert.equal(r2.valid, false);
    assert.equal(r2.reason, "terminal_at_invalid", `terminalAt ${String(ts)}`);
  }
  // A throwing property getter anywhere in the record is caught rather than escaping.
  const hostile = { ...initiated };
  Object.defineProperty(hostile, "actorUid", { enumerable: true, get() { throw new Error("boom"); } });
  let hr;
  assert.doesNotThrow(() => { hr = validateOperationRecord(hostile); });
  assert.equal(hr.valid, false);
  assert.equal(hr.reason, "validation_error");
  // Real Firestore Timestamps are accepted, including the epoch.
  assert.equal(validateOperationRecord({ ...initiated, initiatedAt: Timestamp.fromMillis(0) }).valid, true);
  assert.equal(validateOperationRecord({ ...applied, initiatedAt: T0, terminalAt: T0 }).valid, true); // equal is allowed
  // terminalAt strictly earlier than initiatedAt is rejected.
  assert.equal(validateOperationRecord({ ...applied, initiatedAt: T1, terminalAt: T0 }).reason, "terminal_before_initiated");
  assert.equal(validateOperationRecord({ ...denied, initiatedAt: T0, terminalAt: TNEG }).reason, "terminal_before_initiated");
});

// ---- full predecessor/successor transition validation ----
ok("absent→initiated valid; absent→terminal or with terminal fields rejected", () => {
  assert.doesNotThrow(() => assertOperationRecordTransition(null, initiated));
  assert.throws(() => assertOperationRecordTransition(null, applied), IllegalOperationTransitionError);
  assert.throws(() => assertOperationRecordTransition(null, { ...initiated, terminalAt: T1 }), IllegalOperationTransitionError); // terminal field on absent→initiated
});
ok("initiated→applied sets resultVersion+terminalAt; missing either rejected", () => {
  assert.doesNotThrow(() => assertOperationRecordTransition(initiated, applied));
  assert.throws(() => assertOperationRecordTransition(initiated, { ...applied, resultVersion: null }), IllegalOperationTransitionError);
  assert.throws(() => assertOperationRecordTransition(initiated, { ...applied, terminalAt: null }), IllegalOperationTransitionError);
});
ok("initiated→denied keeps resultVersion=null + sets terminalAt; resultVersion set rejected", () => {
  assert.doesNotThrow(() => assertOperationRecordTransition(initiated, denied));
  assert.throws(() => assertOperationRecordTransition(initiated, { ...denied, resultVersion: 3 }), IllegalOperationTransitionError);
});
ok("terminal records cannot be rewritten (terminal predecessor rejected)", () => {
  assert.throws(() => assertOperationRecordTransition(applied, denied), IllegalOperationTransitionError);
  assert.throws(() => assertOperationRecordTransition(applied, { ...applied, resultVersion: 2 }), IllegalOperationTransitionError);
  assert.throws(() => assertOperationRecordTransition(denied, applied), IllegalOperationTransitionError);
});
ok("immutable binding change across transition rejected", () => {
  // Each mutated successor is INDEPENDENTLY well-formed (coherent action/target/targetId, valid
  // timestamps) so the rejection proves the binding guard fired -- not incidental record invalidity.
  const mutations = {
    actorUid: { actorUid: "actor-2" },
    commandFingerprint: { commandFingerprint: "e".repeat(64) },
    expectedVersion: { expectedVersion: 7 },
    targetId: { targetId: "cmp_" + "e".repeat(64) },
    action: { action: "verifyCompatibility" },                                            // same authority, different verb
    targetType: { action: "importEquipmentModel", targetType: "equipment_models", targetId: MODEL }, // whole coherent triple
  };
  for (const [f, patch] of Object.entries(mutations)) {
    const mutated = { ...applied, ...patch };
    assert.equal(validateOperationRecord(mutated).valid, true, `successor for ${f} must itself be valid`);
    assert.throws(() => assertOperationRecordTransition(initiated, mutated), IllegalOperationTransitionError, `binding ${f}`);
  }
  assert.throws(() => assertOperationRecordTransition(initiated, { ...applied, initiatedAt: T1 }), IllegalOperationTransitionError); // initiatedAt changed
});
ok("malformed predecessor and malformed successor both fail closed", () => {
  assert.throws(() => assertOperationRecordTransition({ ...initiated, status: "bogus" }, applied), IllegalOperationTransitionError); // malformed prev
  assert.throws(() => assertOperationRecordTransition(initiated, { ...applied, commandFingerprint: "short" }), IllegalOperationTransitionError); // malformed next
});

// ---- prototype pollution ----
ok("an INHERITED governed field cannot satisfy the schema (prototype pollution fails closed)", () => {
  const { actorUid, ...noActor } = initiated;
  assert.equal(validateOperationRecord(noActor).reason, "missing_field:actorUid");
  Object.prototype.actorUid = "attacker-uid"; // eslint-disable-line no-extend-native
  try {
    // `k in data` would see the inherited value here; own-property checking must not.
    assert.equal("actorUid" in noActor, true, "precondition: the field IS reachable via the prototype");
    assert.equal(Object.prototype.hasOwnProperty.call(noActor, "actorUid"), false);
    const r = validateOperationRecord(noActor);
    assert.equal(r.valid, false, "inherited actorUid must NOT satisfy the schema");
    assert.equal(r.reason, "missing_field:actorUid");
  } finally {
    delete Object.prototype.actorUid;
  }
  // Every governed field, one at a time, via the prototype.
  for (const f of ["idempotencyKey", "action", "targetType", "targetId", "commandFingerprint", "expectedVersion", "resultVersion", "status", "initiatedAt", "terminalAt"]) {
    const { [f]: _dropped, ...without } = initiated;
    Object.prototype[f] = initiated[f]; // eslint-disable-line no-extend-native
    try {
      assert.equal(validateOperationRecord(without).reason, `missing_field:${f}`, `inherited ${f}`);
    } finally {
      delete Object.prototype[f];
    }
  }
  // A record carrying all fields as OWN properties still validates (no false rejection).
  assert.equal(validateOperationRecord({ ...initiated }).valid, true);
});


console.log(`\n${passed} operation-state-machine checks passed`);
