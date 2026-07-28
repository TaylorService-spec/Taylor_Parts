// D4 Stage C.1 -- governed command fingerprint contract tests. Pure logic, no emulator.
// The two properties that matter for idempotent replay:
//   EQUIVALENCE  -- the same governed command always fingerprints identically, however it was built;
//   DISCRIMINATION -- changing ANY single governed field changes the fingerprint.
// Plus the fail-closed rules that stop an unnamed field from silently leaving the command identity.
import assert from "node:assert/strict";

const {
  buildCommandFingerprint, canonicalCommandPayload, COMMAND_FINGERPRINT_FIELDS,
  COMMAND_FINGERPRINT_VERSION, FingerprintContractError,
} = await import("../lib/equipmentCompatibility/commandFingerprint.js");
const D2 = await import("../lib/equipmentCompatibility/domain/compatibility.js");
const D1 = await import("../lib/equipmentCompatibility/domain/equipmentModel.js");
const { OPERATION_ACTIONS, ACTION_TARGET_TYPES } = await import("../lib/equipmentCompatibility/operations.js");

let passed = 0;
const ok = (n, f) => { f(); passed++; console.log(`PASS -- ${n}`); };
const HEX64 = /^[0-9a-f]{64}$/;

// ---- fixtures built through the D1/D2 validators, so payloads are the governed shapes ----
const MODEL_ID = "TAYLOR--C713";
const model = D1.validateEquipmentModel({
  equipmentModelId: MODEL_ID, manufacturerId: "TAYLOR", manufacturerName: "Taylor", modelNumber: "C713",
  displayName: "Taylor C713", family: null, subtype: null, revision: null, status: "ACTIVE",
  sourceAuthority: "manufacturer", version: 1,
}).value;
const alias = D1.validateEquipmentModelAlias({ aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C-713", equipmentModelId: MODEL_ID }).value;
const compat = D2.validateCompatibility({
  equipmentModelId: MODEL_ID, partId: "TST-1001", compatibilityType: "DIRECT_FIT", assembly: null,
  installationPosition: null, quantityRequired: 1,
  applicability: { kind: "ALL_SERIALS", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null },
  effectiveFrom: null, effectiveTo: null, sourceSummary: null, confidenceLevel: "HIGH",
  verificationStatus: "VERIFIED", notes: null, version: 1,
}).value;
const source = D2.validateCompatibilitySource({
  compatibilityId: compat.compatibilityId, authorityType: "MANUFACTURER", sourceReference: "Service Manual 12",
  sourceVersion: null, observedClaim: "SUPPORTS", contentFingerprint: "a".repeat(64),
  capturedAt: "2026-07-27T07:06:24Z", capturedBy: "admin-uid-1", notes: null,
}).value;
const verify = { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" };

const CMD = {
  importEquipmentModel: { targetId: MODEL_ID, payload: model },
  importEquipmentModelAlias: { targetId: alias.aliasKey, payload: alias },
  importCompatibility: { targetId: compat.compatibilityId, payload: compat },
  correctCompatibility: { targetId: compat.compatibilityId, payload: compat },
  importCompatibilitySource: { targetId: source.sourceId, payload: source },
  verifyCompatibility: { targetId: compat.compatibilityId, payload: verify },
};
const fp = (action, over = {}) => buildCommandFingerprint({
  action, targetType: ACTION_TARGET_TYPES[action], targetId: CMD[action].targetId,
  payload: CMD[action].payload, ...over,
});

// ---- contract shape ----
ok("every action declares an explicit ordered field list", () => {
  assert.deepEqual(Object.keys(COMMAND_FINGERPRINT_FIELDS).sort(), [...OPERATION_ACTIONS].sort());
  assert.equal(Object.isFrozen(COMMAND_FINGERPRINT_FIELDS), true);
  for (const action of OPERATION_ACTIONS) {
    const fields = COMMAND_FINGERPRINT_FIELDS[action];
    assert.equal(Object.isFrozen(fields), true, action);
    assert.ok(fields.length > 0, action);
    assert.deepEqual([...new Set(fields)], [...fields], `${action} has duplicate fields`);
  }
  assert.equal(COMMAND_FINGERPRINT_VERSION, 1);
});
ok("the declared fields cover exactly the governed payload of each action", () => {
  // If a D1/D2 value gains a field, this fails -- which is the point: it must be a deliberate edit.
  const flatten = (o, prefix = "") => Object.keys(o).flatMap((k) =>
    (o[k] !== null && typeof o[k] === "object" && !Array.isArray(o[k])) ? flatten(o[k], `${k}.`) : [`${prefix}${k}`]);
  for (const [action, { payload }] of Object.entries(CMD)) {
    assert.deepEqual(flatten(payload).sort(), [...COMMAND_FINGERPRINT_FIELDS[action]].sort(), action);
  }
});
ok("every action produces a bounded hex fingerprint", () => {
  for (const action of OPERATION_ACTIONS) assert.match(fp(action), HEX64, action);
});

// ---- EQUIVALENCE ----
ok("the same command fingerprints identically regardless of property insertion order", () => {
  for (const action of OPERATION_ACTIONS) {
    const original = CMD[action].payload;
    // Rebuild with keys in reverse order (and nested objects rebuilt too) -- JSON.stringify would differ.
    const reversed = {};
    for (const k of Object.keys(original).reverse()) {
      const v = original[k];
      if (v !== null && typeof v === "object") {
        const nested = {};
        for (const nk of Object.keys(v).reverse()) nested[nk] = v[nk];
        reversed[k] = nested;
      } else reversed[k] = v;
    }
    assert.notEqual(JSON.stringify(reversed), JSON.stringify(original), `${action}: fixture must actually reorder`);
    assert.equal(fp(action, { payload: reversed }), fp(action), `${action} must be order-independent`);
  }
});
ok("repeated calls are stable, and equal-by-value payloads agree", () => {
  for (const action of OPERATION_ACTIONS) {
    assert.equal(fp(action), fp(action), action);
    assert.equal(fp(action, { payload: structuredClone(CMD[action].payload) }), fp(action), action);
  }
});

// ---- DISCRIMINATION ----
ok("changing ANY single governed field changes the fingerprint", () => {
  const nudge = (v) => {
    if (v === null) return "CHANGED";
    if (typeof v === "string") return `${v}X`;
    if (typeof v === "number") return v + 1;
    if (typeof v === "boolean") return !v;
    return "CHANGED";
  };
  let checked = 0;
  for (const action of OPERATION_ACTIONS) {
    const baseline = fp(action);
    for (const path of COMMAND_FINGERPRINT_FIELDS[action]) {
      const payload = structuredClone(CMD[action].payload);
      const dot = path.indexOf(".");
      if (dot < 0) payload[path] = nudge(payload[path]);
      else payload[path.slice(0, dot)][path.slice(dot + 1)] = nudge(payload[path.slice(0, dot)][path.slice(dot + 1)]);
      assert.notEqual(fp(action, { payload }), baseline, `${action}.${path} must change the fingerprint`);
      checked++;
    }
  }
  assert.ok(checked >= 50, `expected a broad one-field-difference sweep, ran ${checked}`);
});
ok("action, targetType and targetId each bind into the fingerprint", () => {
  const base = fp("importCompatibility");
  assert.notEqual(fp("correctCompatibility"), base, "same payload, different action");
  assert.notEqual(fp("importCompatibility", { targetId: "cmp_" + "0".repeat(64) }), base);
  assert.notEqual(fp("importCompatibility", { targetType: "equipment_models" }), base);
});
ok("values cannot migrate between fields without changing the identity", () => {
  // Two string fields swapped: a naive concatenation would hash identically.
  const payload = structuredClone(model);
  [payload.manufacturerName, payload.displayName] = [payload.displayName, payload.manufacturerName];
  assert.notEqual(fp("importEquipmentModel", { payload }), fp("importEquipmentModel"));
});
ok("the encoding is injective: separator-forging string values do not collide", () => {
  const a = structuredClone(model), b = structuredClone(model);
  // Craft values that would forge a field boundary under a naive delimiter-joined encoding.
  a.manufacturerName = "X"; a.displayName = "s:1:Y";
  b.manufacturerName = "Xs:1:Y"; b.displayName = "";
  assert.notEqual(fp("importEquipmentModel", { payload: a }), fp("importEquipmentModel", { payload: b }));
  const c = structuredClone(model), d = structuredClone(model);
  c.manufacturerName = "AB"; c.displayName = "C";
  d.manufacturerName = "A"; d.displayName = "BC";
  assert.notEqual(fp("importEquipmentModel", { payload: c }), fp("importEquipmentModel", { payload: d }));
});
ok("null and empty string are distinct, as are 1 and \"1\"", () => {
  const withNull = structuredClone(model); withNull.family = null;
  const withEmpty = structuredClone(model); withEmpty.family = "";
  const withZero = structuredClone(model); withZero.family = "0";
  const three = new Set([fp("importEquipmentModel", { payload: withNull }), fp("importEquipmentModel", { payload: withEmpty }), fp("importEquipmentModel", { payload: withZero })]);
  assert.equal(three.size, 3);
  // Values are TYPE-TAGGED, so a number and the string that prints the same cannot collide.
  const numeric = structuredClone(model), stringy = structuredClone(model);
  numeric.version = 1; stringy.version = "1";
  assert.notEqual(fp("importEquipmentModel", { payload: stringy }), fp("importEquipmentModel", { payload: numeric }));
  const boolish = structuredClone(model); boolish.family = true;
  const trueish = structuredClone(model); trueish.family = "true";
  assert.notEqual(fp("importEquipmentModel", { payload: boolish }), fp("importEquipmentModel", { payload: trueish }));
  const nulled = structuredClone(model); nulled.family = null;
  const nullish = structuredClone(model); nullish.family = "n:";
  assert.notEqual(fp("importEquipmentModel", { payload: nulled }), fp("importEquipmentModel", { payload: nullish }));
});
ok("the version prefix participates, and unicode is carried faithfully", () => {
  assert.ok(canonicalCommandPayload("importEquipmentModel", model).startsWith(`v:${COMMAND_FINGERPRINT_VERSION}:`));
  const a = structuredClone(model), b = structuredClone(model);
  a.displayName = "café"; b.displayName = "café"; // NFC vs decomposed
  assert.notEqual(fp("importEquipmentModel", { payload: a }), fp("importEquipmentModel", { payload: b }));
  const emoji = structuredClone(model); emoji.displayName = "grill\u{1F600}";
  assert.match(fp("importEquipmentModel", { payload: emoji }), HEX64);
});

// ---- FAIL CLOSED ----
ok("an undeclared field is REJECTED, never silently excluded from the identity", () => {
  const extra = structuredClone(model); extra.futureField = "x";
  assert.throws(() => fp("importEquipmentModel", { payload: extra }), FingerprintContractError);
  const nestedExtra = structuredClone(compat); nestedExtra.applicability.futureField = "x";
  assert.throws(() => fp("importCompatibility", { payload: nestedExtra }), FingerprintContractError);
});
ok("a missing governed field is rejected rather than treated as null", () => {
  for (const action of OPERATION_ACTIONS) {
    const payload = structuredClone(CMD[action].payload);
    const path = COMMAND_FINGERPRINT_FIELDS[action][0];
    delete payload[path.includes(".") ? path.slice(0, path.indexOf(".")) : path];
    assert.throws(() => fp(action, { payload }), FingerprintContractError, action);
  }
});
ok("unsupported value types and non-object payloads are rejected", () => {
  for (const bad of [undefined, null, 42, "x", [], new Date(0)]) {
    assert.throws(() => fp("importEquipmentModel", { payload: bad }), FingerprintContractError, String(bad));
  }
  for (const bad of [undefined, [1], {}, () => 1, 1.5, Number.MAX_SAFE_INTEGER + 2, NaN, Infinity]) {
    const payload = structuredClone(model); payload.family = bad;
    assert.throws(() => fp("importEquipmentModel", { payload }), FingerprintContractError, String(bad));
  }
  const nonObjectNested = structuredClone(compat); nonObjectNested.applicability = "x";
  assert.throws(() => fp("importCompatibility", { payload: nonObjectNested }), FingerprintContractError);
});
ok("unknown actions and empty targets are rejected", () => {
  assert.throws(() => buildCommandFingerprint({ action: "nope", targetType: "equipment_models", targetId: MODEL_ID, payload: model }), FingerprintContractError);
  assert.throws(() => buildCommandFingerprint({ action: "constructor", targetType: "equipment_models", targetId: MODEL_ID, payload: model }), FingerprintContractError);
  for (const targetId of ["", null, 42]) {
    assert.throws(() => fp("importEquipmentModel", { targetId }), FingerprintContractError, String(targetId));
  }
  for (const targetType of ["", null]) {
    assert.throws(() => fp("importEquipmentModel", { targetType }), FingerprintContractError, String(targetType));
  }
});
ok("inherited payload fields do not satisfy the contract", () => {
  const payload = structuredClone(model);
  delete payload.family;
  Object.prototype.family = "inherited"; // eslint-disable-line no-extend-native
  try {
    assert.throws(() => fp("importEquipmentModel", { payload }), FingerprintContractError);
  } finally {
    delete Object.prototype.family;
  }
});

console.log(`\n${passed} fingerprint checks passed`);
