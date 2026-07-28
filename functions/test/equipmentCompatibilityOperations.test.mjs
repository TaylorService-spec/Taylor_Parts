// Pure unit test for the D4 operation STATE MACHINE (no emulator): the transition guard, strict
// runtime operation-record validation, actor+expected-version-bound idempotency, and full
// predecessor/successor transition validation. Firestore Timestamps are constructed directly (no
// initializeApp / emulator needed for the Timestamp value class).
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { OPERATION_STATES, isAllowedOperationTransition, assertOperationTransition, assertOperationRecordTransition, validateOperationRecord, isSameOperationCommand, isValidOperationTargetId } from "../lib/equipmentCompatibility/operations.js";
import { IllegalOperationTransitionError } from "../lib/equipmentCompatibility/errors.js";
let passed = 0; const ok = (n, f) => { f(); passed++; console.log(`PASS -- ${n}`); };

const T0 = Timestamp.fromMillis(1000), T1 = Timestamp.fromMillis(2000), TNEG = Timestamp.fromMillis(500);
const CMP = "cmp_" + "a".repeat(64), FP = "b".repeat(64);
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
ok("target-id shapes per authority", () => {
  assert.equal(isValidOperationTargetId("equipment_models", "TAYLOR--C713"), true);
  assert.equal(isValidOperationTargetId("equipment_models", "taylor--c713"), false);
  assert.equal(isValidOperationTargetId("equipment_model_aliases", "SOURCE_MODEL|TAYLOR|C-713"), true);
  assert.equal(isValidOperationTargetId("equipment_part_compatibility", CMP), true);
  assert.equal(isValidOperationTargetId("equipment_compatibility_sources", "src_" + "a".repeat(64)), true);
  assert.equal(isValidOperationTargetId("equipment_compatibility_sources", CMP), false);
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
  for (const f of ["actorUid", "action", "targetType", "targetId", "commandFingerprint", "expectedVersion"]) {
    const mutated = { ...applied, [f]: f === "expectedVersion" ? 7 : (f === "targetType" ? "equipment_models" : (f === "action" ? "verifyCompatibility" : (f === "targetId" ? "cmp_" + "e".repeat(64) : "changed"))) };
    // Ensure the mutated successor is otherwise well-formed for target combos
    if (f === "targetType") mutated.targetId = "TAYLOR--C713";
    assert.throws(() => assertOperationRecordTransition(initiated, mutated), IllegalOperationTransitionError, `binding ${f}`);
  }
  assert.throws(() => assertOperationRecordTransition(initiated, { ...applied, initiatedAt: T1 }), IllegalOperationTransitionError); // initiatedAt changed
});
ok("malformed predecessor and malformed successor both fail closed", () => {
  assert.throws(() => assertOperationRecordTransition({ ...initiated, status: "bogus" }, applied), IllegalOperationTransitionError); // malformed prev
  assert.throws(() => assertOperationRecordTransition(initiated, { ...applied, commandFingerprint: "short" }), IllegalOperationTransitionError); // malformed next
});

console.log(`\n${passed} operation-state-machine checks passed`);
