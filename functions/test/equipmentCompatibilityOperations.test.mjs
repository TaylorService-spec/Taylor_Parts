// Pure unit test for the D4 operation STATE MACHINE transition guard (no emulator). Proves the
// only legal transitions are absent→initiated→applied|denied and that terminal rewrites, deletion-
// by-transition, and denied↔applied are refused — the core of the operation-record safety model.
import assert from "node:assert/strict";
import { OPERATION_STATES, isAllowedOperationTransition, assertOperationTransition, isSameOperationCommand } from "../lib/equipmentCompatibility/operations.js";
import { IllegalOperationTransitionError } from "../lib/equipmentCompatibility/errors.js";
let passed = 0; const ok = (n, f) => { f(); passed++; console.log(`PASS -- ${n}`); };

ok("legal transitions: absent→initiated, initiated→applied, initiated→denied", () => {
  assert.equal(isAllowedOperationTransition(null, "initiated"), true);
  assert.equal(isAllowedOperationTransition("initiated", "applied"), true);
  assert.equal(isAllowedOperationTransition("initiated", "denied"), true);
});
ok("illegal: no absent→terminal (must initiate first)", () => {
  assert.equal(isAllowedOperationTransition(null, "applied"), false);
  assert.equal(isAllowedOperationTransition(null, "denied"), false);
  assert.equal(isAllowedOperationTransition(null, "initiated"), true);
});
ok("illegal: terminal states are one-way (no rewrite, no re-initiate)", () => {
  for (const from of ["applied", "denied"]) for (const to of OPERATION_STATES) assert.equal(isAllowedOperationTransition(from, to), false, `${from}->${to}`);
});
ok("illegal: denied↔applied both directions refused", () => {
  assert.equal(isAllowedOperationTransition("denied", "applied"), false);
  assert.equal(isAllowedOperationTransition("applied", "denied"), false);
});
ok("illegal: initiated→initiated (no duplicate initiation transition)", () => {
  assert.equal(isAllowedOperationTransition("initiated", "initiated"), false);
});
ok("assertOperationTransition throws IllegalOperationTransitionError on illegal", () => {
  assert.doesNotThrow(() => assertOperationTransition(null, "initiated"));
  assert.doesNotThrow(() => assertOperationTransition("initiated", "applied"));
  assert.throws(() => assertOperationTransition("applied", "denied"), IllegalOperationTransitionError);
  assert.throws(() => assertOperationTransition(null, "applied"), IllegalOperationTransitionError);
});
ok("isSameOperationCommand: identical binding true; any field diff false", () => {
  const base = { action: "importCompatibility", targetType: "equipment_part_compatibility", targetId: "cmp_x", commandFingerprint: "fp1" };
  assert.equal(isSameOperationCommand(base, { ...base }), true);
  assert.equal(isSameOperationCommand(base, { ...base, commandFingerprint: "fp2" }), false);
  assert.equal(isSameOperationCommand(base, { ...base, action: "verifyCompatibility" }), false);
  assert.equal(isSameOperationCommand(base, { ...base, targetId: "cmp_y" }), false);
  assert.equal(isSameOperationCommand(base, { ...base, targetType: "equipment_models" }), false);
});

console.log(`\n${passed} operation-state-machine checks passed`);
