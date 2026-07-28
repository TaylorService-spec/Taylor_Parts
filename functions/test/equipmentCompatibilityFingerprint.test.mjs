// D4 Stage C.1 -- governed command fingerprint contract tests. Pure logic, no emulator.
// The properties that matter for idempotent replay:
//   EQUIVALENCE     -- the same governed command always fingerprints identically, however it was
//                      built or spelled, via the explicit normalization rule;
//   DISCRIMINATION  -- changing ANY single governed field changes the fingerprint;
//   COHERENCE       -- only NORMALIZED GOVERNED commands get a fingerprint at all, and action,
//                      targetType and payload identity must agree;
//   WELL-FORMEDNESS -- ill-formed Unicode is rejected before hashing, so distinct strings can never
//                      collapse to the same bytes.
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

const SCHEME = { schemeId: "TAYLOR-ALPHA", manufacturerId: "Taylor", normalizerVersion: 1, tokenPattern: "^[A-Z0-9-]+$", ordering: "LEXICOGRAPHIC" };
const SCHEMES = { "TAYLOR-ALPHA": SCHEME };

// ---- fixtures built through the D1/D2 validators, so payloads are the governed shapes ----
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
  verificationStatus: "VERIFIED", notes: null, version: 1, ...o,
}, { serialSchemes: SCHEMES }).value;
const compat = compatOf();
const sourceOf = (o = {}) => D2.validateCompatibilitySource({
  compatibilityId: compat.compatibilityId, authorityType: "MANUFACTURER", sourceReference: "Service Manual 12",
  sourceVersion: null, observedClaim: "SUPPORTS", contentFingerprint: "a".repeat(64),
  capturedAt: "2026-07-27T07:06:24Z", capturedBy: "admin-uid-1", notes: null, ...o,
}).value;
const verifyOf = (o = {}) => ({ compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED", ...o });

// Derive the identity a payload must be filed under, so variants can be fingerprinted without
// hand-maintaining a target id per case.
// Derive the identity a payload must be filed under, so variants can be fingerprinted without
// hand-maintaining a target id per case. Invalid payloads yield a sentinel so the CONTRACT reports the
// failure -- the test helper must never throw before the code under test runs.
const identityOf = (action, payload) => {
  const INVALID = "__invalid_payload__";
  try {
    switch (action) {
      case "importEquipmentModel": {
        const v = D1.validateEquipmentModel(payload);
        return v.valid ? v.value.equipmentModelId : INVALID;
      }
      case "importEquipmentModelAlias": return payload?.aliasKey ?? INVALID;
      case "importCompatibility":
      case "correctCompatibility": {
        const v = D2.validateCompatibility(payload, { serialSchemes: SCHEMES });
        return v.valid ? v.value.compatibilityId : INVALID;
      }
      case "importCompatibilitySource": {
        const v = D2.validateCompatibilitySource(payload);
        return v.valid ? v.value.sourceId : INVALID;
      }
      case "verifyCompatibility": return payload?.compatibilityId ?? INVALID;
      default: return INVALID;
    }
  } catch { return INVALID; }
};
const fp = (action, payload, over = {}) => buildCommandFingerprint({
  action, targetType: ACTION_TARGET_TYPES[action], targetId: identityOf(action, payload),
  payload, serialSchemes: SCHEMES, ...over,
});
const BASE = {
  importEquipmentModel: model(),
  importEquipmentModelAlias: aliasOf(),
  importCompatibility: compat,
  correctCompatibility: compat,
  importCompatibilitySource: sourceOf(),
  verifyCompatibility: verifyOf(),
};

// ---- contract shape ----
ok("every action declares an explicit ordered field list", () => {
  assert.deepEqual(Object.keys(COMMAND_FINGERPRINT_FIELDS).sort(), [...OPERATION_ACTIONS].sort());
  assert.equal(Object.isFrozen(COMMAND_FINGERPRINT_FIELDS), true);
  for (const action of OPERATION_ACTIONS) {
    const fields = COMMAND_FINGERPRINT_FIELDS[action];
    assert.equal(Object.isFrozen(fields), true, action);
    assert.deepEqual([...new Set(fields)], [...fields], `${action} has duplicate fields`);
  }
  assert.equal(COMMAND_FINGERPRINT_VERSION, 1);
});
ok("the declared fields cover exactly the governed payload of each action", () => {
  const flatten = (o, prefix = "") => Object.keys(o).flatMap((k) =>
    (o[k] !== null && typeof o[k] === "object" && !Array.isArray(o[k])) ? flatten(o[k], `${k}.`) : [`${prefix}${k}`]);
  for (const [action, payload] of Object.entries(BASE)) {
    assert.deepEqual(flatten(payload).sort(), [...COMMAND_FINGERPRINT_FIELDS[action]].sort(), action);
  }
});
ok("every action produces a bounded hex fingerprint", () => {
  for (const action of OPERATION_ACTIONS) assert.match(fp(action, BASE[action]), HEX64, action);
});

// ---- EQUIVALENCE ----
ok("the same command fingerprints identically regardless of property insertion order", () => {
  for (const action of OPERATION_ACTIONS) {
    const original = BASE[action];
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
    assert.equal(fp(action, reversed), fp(action, original), `${action} must be order-independent`);
  }
});
ok("NORMALIZATION RULE: inputs that normalize to the same governed value share one identity", () => {
  // Documented and deliberate: the serialized input is the VALIDATED value.
  assert.equal(fp("importEquipmentModel", model({ status: "active" })), fp("importEquipmentModel", model({ status: "ACTIVE" })));
  assert.equal(
    buildCommandFingerprint({ action: "importEquipmentModel", targetType: "equipment_models", targetId: MODEL_ID, payload: { ...model(), sourceAuthority: "  manufacturer  " } }),
    fp("importEquipmentModel", model()),
    "whitespace-normalized text is the same command"
  );
  assert.equal(fp("importEquipmentModelAlias", aliasOf({ rawValue: " c-713 " })), fp("importEquipmentModelAlias", aliasOf()));
  assert.equal(fp("verifyCompatibility", verifyOf({ verificationStatus: "verified" })), fp("verifyCompatibility", verifyOf()));
  // D1 normalizeIdentityText applies NFKC, so decomposed and composed text are the SAME governed
  // value and therefore ONE command. That is the governed normalization decision, not an accident.
  const composed = "caf\u00e9", decomposed = "cafe\u0301";
  assert.notEqual(composed, decomposed, "precondition: distinct JS strings");
  assert.equal(fp("importEquipmentModel", model({ displayName: composed })), fp("importEquipmentModel", model({ displayName: decomposed })));
  // Compatibility-equivalent forms collapse too (NFKC), e.g. fullwidth.
  assert.equal(fp("importEquipmentModel", model({ displayName: "\uFF23AF" })), fp("importEquipmentModel", model({ displayName: "CAF" })));
});
ok("repeated calls are stable and structural clones agree", () => {
  for (const action of OPERATION_ACTIONS) {
    assert.equal(fp(action, BASE[action]), fp(action, BASE[action]), action);
    assert.equal(fp(action, structuredClone(BASE[action])), fp(action, BASE[action]), action);
  }
});

// ---- DISCRIMINATION: valid governed variants, one field apart ----
const VARIANTS = {
  importEquipmentModel: [
    ["baseline", model()],
    ["manufacturerName", model({ manufacturerName: "Taylor Company" })],
    ["displayName", model({ displayName: "Taylor C713 Soft Serve" })],
    ["family", model({ family: "SOFT SERVE" })],
    ["subtype", model({ subtype: "COUNTERTOP" })],
    ["revision", model({ revision: "REV-A" })],
    ["status", model({ status: "INACTIVE" })],
    ["sourceAuthority", model({ sourceAuthority: "distributor" })],
    ["version", model({ version: 2 })],
    ["modelNumber+id", model({ modelNumber: "C714", equipmentModelId: "TAYLOR--C714" })],
    ["manufacturerId+id", model({ manufacturerId: "HOSHIZAKI", equipmentModelId: "HOSHIZAKI--C713" })],
  ],
  importEquipmentModelAlias: [
    ["baseline", aliasOf()],
    ["aliasType", aliasOf({ aliasType: "HISTORICAL_MODEL" })],
    ["manufacturerId", aliasOf({ manufacturerId: "Hoshizaki" })],
    ["aliasValue", aliasOf({ rawValue: "C-714" })],
    ["equipmentModelId", aliasOf({ equipmentModelId: "TAYLOR--C825" })],
  ],
  importCompatibility: [
    ["baseline", compatOf()],
    ["equipmentModelId", compatOf({ equipmentModelId: "HOSHIZAKI--C713" })],
    ["partId", compatOf({ partId: "TST-2002" })],
    ["compatibilityType", compatOf({ compatibilityType: "APPROVED_ALTERNATE" })],
    ["assembly", compatOf({ assembly: "HOPPER" })],
    ["installationPosition", compatOf({ installationPosition: "LEFT" })],
    ["quantityRequired", compatOf({ quantityRequired: 2 })],
    ["applicability.kind+modelRevision", compatOf({ applicability: { kind: "MODEL_REVISION", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: "REV-A" } })],
    ["applicability.serialScheme+range", compatOf({ applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: "A200", modelRevision: null } })],
    ["applicability.serialRangeStart", compatOf({ applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A150", serialRangeEnd: "A200", modelRevision: null } })],
    ["applicability.serialRangeEnd", compatOf({ applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: "A300", modelRevision: null } })],
    ["effectiveFrom", compatOf({ effectiveFrom: "2026-01-01" })],
    ["effectiveTo", compatOf({ effectiveTo: "2026-12-31" })],
    ["sourceSummary", compatOf({ sourceSummary: "Manual 12" })],
    ["confidenceLevel", compatOf({ confidenceLevel: "MEDIUM" })],
    ["verificationStatus", compatOf({ verificationStatus: "IN_REVIEW" })],
    ["notes", compatOf({ notes: "checked" })],
    ["version", compatOf({ version: 2 })],
  ],
  importCompatibilitySource: [
    ["baseline", sourceOf()],
    ["compatibilityId", sourceOf({ compatibilityId: compatOf({ partId: "TST-2002" }).compatibilityId })],
    ["authorityType", sourceOf({ authorityType: "RESELLER" })],
    ["sourceReference", sourceOf({ sourceReference: "Bulletin 44" })],
    ["sourceVersion", sourceOf({ sourceVersion: "v2" })],
    ["observedClaim", sourceOf({ observedClaim: "CONTRADICTS" })],
    ["contentFingerprint", sourceOf({ contentFingerprint: "b".repeat(64) })],
    ["capturedAt", sourceOf({ capturedAt: "2026-07-28T07:06:24Z" })],
    ["capturedBy", sourceOf({ capturedBy: "admin-uid-2" })],
    ["notes", sourceOf({ notes: "note" })],
  ],
  verifyCompatibility: [
    ["baseline", verifyOf()],
    ["verificationStatus", verifyOf({ verificationStatus: "IN_REVIEW" })],
    ["compatibilityId", verifyOf({ compatibilityId: compatOf({ partId: "TST-2002" }).compatibilityId })],
  ],
};
ok("changing ANY single governed field changes the fingerprint (valid commands only)", () => {
  let checked = 0;
  for (const [action, variants] of Object.entries(VARIANTS)) {
    const seen = new Map();
    for (const [label, payload] of variants) {
      const f = fp(action, payload);
      assert.match(f, HEX64, `${action}/${label}`);
      assert.equal(seen.has(f), false, `${action}: ${label} collides with ${seen.get(f)}`);
      seen.set(f, label);
      checked++;
    }
  }
  // Every declared field of every action is covered by the variant sets above.
  const covered = { importEquipmentModel: 11, importEquipmentModelAlias: 5, importCompatibility: 20, importCompatibilitySource: 10, verifyCompatibility: 2 };
  for (const [action, count] of Object.entries(covered)) {
    assert.equal(COMMAND_FINGERPRINT_FIELDS[action].length, count, `${action} field count changed -- extend the variant set`);
  }
  assert.ok(checked >= 45, `expected a broad one-field sweep, ran ${checked}`);
});
ok("correctCompatibility and importCompatibility differ on identical payloads", () => {
  assert.notEqual(fp("correctCompatibility", compat), fp("importCompatibility", compat), "the action binds into the identity");
});
ok("values cannot migrate between fields without changing the identity", () => {
  const swapped = model({ manufacturerName: "Taylor C713", displayName: "Taylor" });
  assert.notEqual(fp("importEquipmentModel", swapped), fp("importEquipmentModel", model()));
});
ok("the encoding is injective: prefix-shifting string values do not collide", () => {
  const a = model({ manufacturerName: "AB", displayName: "C" });
  const b = model({ manufacturerName: "A", displayName: "BC" });
  assert.notEqual(fp("importEquipmentModel", a), fp("importEquipmentModel", b));
  const c = model({ manufacturerName: "X", displayName: "s:1:Y" });
  const d = model({ manufacturerName: "Xs:1:Y", displayName: "Z" });
  assert.notEqual(fp("importEquipmentModel", c), fp("importEquipmentModel", d));
});
ok("null and empty-ish values stay distinct", () => {
  // D1 maps an all-whitespace optional field to null, so compare null against real content.
  const three = new Set([
    fp("importEquipmentModel", model({ family: null })),
    fp("importEquipmentModel", model({ family: "0" })),
    fp("importEquipmentModel", model({ family: "N:" })),
  ]);
  assert.equal(three.size, 3);
});

// ---- WELL-FORMEDNESS ----
ok("ill-formed Unicode is REJECTED before hashing, so lone surrogates cannot collide", () => {
  // Precondition: these distinct strings share UTF-8 bytes, which is exactly the collision risk.
  assert.equal(Buffer.from("\uD800").equals(Buffer.from("\uD801")), true);
  const lone = ["\uD800", "\uD801", "\uDBFF", "\uDC00", "\uDC01", "\uDFFF", "a\uD800b", "x\uDC00", "\uD83D", "\uD83Dx", "y\uDE00"];
  for (const bad of lone) {
    assert.throws(() => fp("importEquipmentModel", model({ displayName: `Taylor ${bad}` })), FingerprintContractError, JSON.stringify(bad));
  }
  // Valid pairs, emoji and multibyte text are accepted and remain distinct.
  const wellFormed = ["\u{1F600}", "grill\u{1F600}", "\u{1F600}\u{1F601}", "caf\u00e9", "\u00fcn\u00efc\u00f6d\u00e9", "\u65e5\u672c\u8a9e", "A\u00e9B"];
  const seen = new Map();
  for (const good of wellFormed) {
    const f = fp("importEquipmentModel", model({ displayName: `Taylor ${good}` }));
    assert.match(f, HEX64, JSON.stringify(good));
    assert.equal(seen.has(f), false, `${JSON.stringify(good)} collides with ${seen.get(f)}`);
    seen.set(f, good);
  }
});
ok("the string prefix is the UTF-8 BYTE length the hasher consumes", () => {
  // "é" is 1 UTF-16 code unit but 2 UTF-8 bytes; the prefix must reflect the latter.
  assert.ok(canonicalCommandPayload("verifyCompatibility", { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED" }).includes("s:8:VERIFIED"));
  const withAccent = model({ displayName: "é" });
  assert.ok(canonicalCommandPayload("importEquipmentModel", withAccent).includes("s:2:é"));
  const withEmoji = model({ displayName: "\u{1F600}" });
  assert.ok(canonicalCommandPayload("importEquipmentModel", withEmoji).includes("s:4:\u{1F600}"));
});

// ---- COHERENCE: only normalized governed commands are fingerprinted ----
ok("a payload the D1/D2 contracts refuse gets NO fingerprint", () => {
  const invalid = [
    ["importEquipmentModel", { ...model(), status: "BOGUS" }],
    ["importEquipmentModel", { ...model(), version: -1 }],
    ["importEquipmentModel", { ...model(), version: 0 }],
    ["importEquipmentModel", { ...model(), manufacturerName: "" }],
    ["importEquipmentModelAlias", { ...aliasOf(), aliasType: "NOPE" }],
    ["importEquipmentModelAlias", { ...aliasOf(), equipmentModelId: "not-canonical" }],
    ["importCompatibility", { ...compat, compatibilityType: "BADTYPE" }],
    ["importCompatibility", { ...compat, confidenceLevel: "X" }],
    ["importCompatibility", { ...compat, version: 0 }],
    ["importCompatibility", { ...compat, partId: "bad id!" }],
    ["correctCompatibility", { ...compat, verificationStatus: "X" }],
    ["importCompatibilitySource", { ...sourceOf(), authorityType: "WIKI" }],
    ["importCompatibilitySource", { ...sourceOf(), contentFingerprint: "short" }],
    ["importCompatibilitySource", { ...sourceOf(), capturedAt: "not-a-time" }],
    ["verifyCompatibility", { compatibilityId: compat.compatibilityId, verificationStatus: "NOPE" }],
    ["verifyCompatibility", { compatibilityId: "cmp_bad", verificationStatus: "VERIFIED" }],
    ["verifyCompatibility", { compatibilityId: compat.compatibilityId }],
    ["verifyCompatibility", { compatibilityId: compat.compatibilityId, verificationStatus: "VERIFIED", extra: 1 }],
  ];
  for (const [action, payload] of invalid) {
    assert.throws(
      () => buildCommandFingerprint({ action, targetType: ACTION_TARGET_TYPES[action], targetId: "x", payload, serialSchemes: SCHEMES }),
      FingerprintContractError,
      `${action} ${JSON.stringify(payload).slice(0, 60)}`
    );
  }
});
ok("an unresolved serial scheme is refused rather than fingerprinted", () => {
  const ranged = compatOf({ applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: "A200", modelRevision: null } });
  assert.match(fp("importCompatibility", ranged), HEX64, "resolves with the registry");
  assert.throws(() => buildCommandFingerprint({
    action: "importCompatibility", targetType: "equipment_part_compatibility",
    targetId: ranged.compatibilityId, payload: ranged, // no serialSchemes
  }), FingerprintContractError);
});
ok("the action fixes the targetType; a wrong one is refused for every action", () => {
  for (const action of OPERATION_ACTIONS) {
    const wrong = ACTION_TARGET_TYPES[action] === "equipment_models" ? "equipment_part_compatibility" : "equipment_models";
    assert.throws(() => fp(action, BASE[action], { targetType: wrong }), FingerprintContractError, action);
    assert.throws(() => fp(action, BASE[action], { targetType: "equipment_compatibility_operations" }), FingerprintContractError, action);
    assert.throws(() => fp(action, BASE[action], { targetType: undefined }), FingerprintContractError, action);
  }
});
ok("targetId must equal the payload identity, for every action family", () => {
  const otherCompat = compatOf({ partId: "TST-2002" });
  const mismatches = [
    ["importEquipmentModel", model(), "TAYLOR--C825"],
    ["importEquipmentModelAlias", aliasOf(), "SOURCE_MODEL|TAYLOR|C-999"],
    ["importCompatibility", compat, otherCompat.compatibilityId],
    ["correctCompatibility", compat, otherCompat.compatibilityId],
    ["importCompatibilitySource", sourceOf(), "src_" + "0".repeat(64)],
    ["verifyCompatibility", verifyOf(), otherCompat.compatibilityId],
  ];
  for (const [action, payload, targetId] of mismatches) {
    assert.throws(() => fp(action, payload, { targetId }), FingerprintContractError, action);
  }
});
ok("malformed and empty target ids are refused", () => {
  for (const action of OPERATION_ACTIONS) {
    for (const targetId of ["", null, undefined, 42, "   ", "not-canonical"]) {
      assert.throws(() => fp(action, BASE[action], { targetId }), FingerprintContractError, `${action} ${String(targetId)}`);
    }
  }
});

// ---- FAIL CLOSED ----
ok("an undeclared OWN field is rejected for EVERY action, including adapter-mapped ones", () => {
  // The alias path reconstructs a validator input (aliasValue -> rawValue). If the schema gate ran
  // after that reconstruction, an unknown field would be dropped before D1 could object to it.
  for (const action of OPERATION_ACTIONS) {
    assert.throws(() => fp(action, { ...BASE[action], futureField: "IGNORED" }), FingerprintContractError, action);
  }
  assert.throws(() => canonicalCommandPayload("importEquipmentModel", { ...model(), futureField: "x" }), FingerprintContractError);
  // The alias adapter's accepted shape is the GOVERNED one: aliasValue, never the validator's rawValue.
  assert.throws(() => fp("importEquipmentModelAlias", { ...aliasOf(), rawValue: "C-713" }), FingerprintContractError);
});
ok("an undeclared NESTED field is rejected for both compatibility actions", () => {
  for (const action of ["importCompatibility", "correctCompatibility"]) {
    const payload = structuredClone(BASE[action]);
    payload.applicability.futureField = "x";
    assert.throws(() => fp(action, payload), FingerprintContractError, action);
    const deeper = structuredClone(BASE[action]);
    deeper.applicability.nested = { a: 1 };
    assert.throws(() => fp(action, deeper), FingerprintContractError, `${action} deep`);
  }
});
ok("a PROTOTYPE-ONLY top-level field is rejected for every full-record family", () => {
  // Optional governed fields are the dangerous ones: D1/D2 read them with plain property access, so an
  // inherited value would be treated as real while their own-key unknown-field checks never see it.
  const cases = [
    ["importEquipmentModel", model(), "family"],
    ["importEquipmentModel", model(), "subtype"],
    ["importEquipmentModel", model(), "revision"],
    ["importCompatibility", compat, "assembly"],
    ["importCompatibility", compat, "notes"],
    ["correctCompatibility", compat, "sourceSummary"],
    ["importCompatibilitySource", sourceOf(), "sourceVersion"],
    ["importCompatibilitySource", sourceOf(), "notes"],
  ];
  for (const [action, base, field] of cases) {
    const payload = structuredClone(base);
    delete payload[field];
    Object.prototype[field] = "INJECTED"; // eslint-disable-line no-extend-native
    try {
      assert.throws(() => fp(action, payload), FingerprintContractError, `${action}.${field}`);
    } finally {
      delete Object.prototype[field];
    }
  }
});
ok("a PROTOTYPE-ONLY applicability child is rejected, and cannot forge a real command identity", () => {
  const revision = compatOf({ applicability: { kind: "MODEL_REVISION", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: "REV-A" } });
  const ranged = compatOf({ applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: "A200", modelRevision: null } });
  const cases = [
    [revision, "modelRevision", "REV-A"],
    [ranged, "serialScheme", "TAYLOR-ALPHA"],
    [ranged, "serialRangeStart", "A100"],
    [ranged, "serialRangeEnd", "A200"],
  ];
  for (const [base, child, injected] of cases) {
    for (const action of ["importCompatibility", "correctCompatibility"]) {
      const payload = structuredClone(base);
      delete payload.applicability[child];
      Object.prototype[child] = injected; // eslint-disable-line no-extend-native
      try {
        assert.throws(
          () => buildCommandFingerprint({ action, targetType: ACTION_TARGET_TYPES[action], targetId: base.compatibilityId, payload, serialSchemes: SCHEMES }),
          FingerprintContractError,
          `${action} applicability.${child}`
        );
      } finally {
        delete Object.prototype[child];
      }
    }
  }
});
ok("non-enumerable unknown own keys and own symbols are rejected at BOTH levels", () => {
  // Object.keys() sees only enumerable string keys, so an exhaustive-sounding "unknown field" check
  // built on it is not exhaustive at all.
  for (const action of OPERATION_ACTIONS) {
    const hidden = structuredClone(BASE[action]);
    Object.defineProperty(hidden, "hiddenFuture", { value: "x", enumerable: false, configurable: true });
    assert.throws(() => fp(action, hidden), FingerprintContractError, `${action} non-enumerable`);
    const symbolled = structuredClone(BASE[action]);
    symbolled[Symbol("future")] = "y";
    assert.throws(() => fp(action, symbolled), FingerprintContractError, `${action} own symbol`);
  }
  for (const action of ["importCompatibility", "correctCompatibility"]) {
    const hidden = structuredClone(BASE[action]);
    Object.defineProperty(hidden.applicability, "hiddenFuture", { value: "x", enumerable: false, configurable: true });
    assert.throws(() => fp(action, hidden), FingerprintContractError, `${action} nested non-enumerable`);
    const symbolled = structuredClone(BASE[action]);
    symbolled.applicability[Symbol("future")] = "y";
    assert.throws(() => fp(action, symbolled), FingerprintContractError, `${action} nested own symbol`);
  }
});
ok("accessor descriptors are rejected, never invoked, at BOTH levels", () => {
  // A getter could hand the validator one value and the serializer another, so the authorized command
  // would not be the fingerprinted one. Descriptors are inspected, so a throwing getter never runs.
  const mkThrowing = (target, key) => {
    Object.defineProperty(target, key, { get() { throw new Error("getter ran"); }, enumerable: true, configurable: true });
    return target;
  };
  let flip = 0;
  const stateful = structuredClone(model());
  delete stateful.family;
  Object.defineProperty(stateful, "family", { get() { return (flip++ % 2) ? "A" : "B"; }, enumerable: true, configurable: true });
  // Called directly, so nothing but the code under test can touch the payload.
  assert.throws(() => buildCommandFingerprint({ action: "importEquipmentModel", targetType: "equipment_models", targetId: MODEL_ID, payload: stateful }), FingerprintContractError, "stateful getter");
  assert.equal(flip, 0, "the getter must never be invoked");
  const throwingRoot = structuredClone(model());
  delete throwingRoot.family;
  assert.throws(() => buildCommandFingerprint({ action: "importEquipmentModel", targetType: "equipment_models", targetId: MODEL_ID, payload: mkThrowing(throwingRoot, "family") }), FingerprintContractError, "throwing root getter");
  const throwingNested = structuredClone(compat);
  delete throwingNested.applicability.modelRevision;
  mkThrowing(throwingNested.applicability, "modelRevision");
  assert.throws(() => buildCommandFingerprint({ action: "importCompatibility", targetType: "equipment_part_compatibility", targetId: compat.compatibilityId, payload: throwingNested, serialSchemes: SCHEMES }), FingerprintContractError, "throwing nested getter");
});

// ---- the serial-scheme registry is an untrusted governed DEPENDENCY ----
const RANGED = compatOf({ applicability: { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: "A200", modelRevision: null } });
const withRegistry = (serialSchemes) => buildCommandFingerprint({
  action: "importCompatibility", targetType: "equipment_part_compatibility",
  targetId: RANGED.compatibilityId, payload: RANGED, serialSchemes,
});
ok("an INHERITED registry entry cannot authorize a SERIAL_RANGE command", () => {
  const empty = {};
  Object.prototype["TAYLOR-ALPHA"] = SCHEME; // eslint-disable-line no-extend-native
  try {
    assert.equal(Object.getOwnPropertyNames(empty).length, 0, "precondition: the registry owns nothing");
    assert.throws(() => withRegistry(empty), FingerprintContractError, "Object.prototype injection");
  } finally {
    delete Object.prototype["TAYLOR-ALPHA"];
  }
  // A custom prototype carrying the scheme is equally refused.
  const custom = Object.create({ "TAYLOR-ALPHA": SCHEME });
  assert.throws(() => withRegistry(custom), FingerprintContractError, "custom-prototype registry");
});
ok("registry entries are strictly schema-checked before D2 reads them", () => {
  assert.throws(() => withRegistry({ "TAYLOR-ALPHA": { ...SCHEME, futureField: "x" } }), FingerprintContractError, "unknown scheme field");
  const { ordering, ...missing } = SCHEME;
  assert.throws(() => withRegistry({ "TAYLOR-ALPHA": missing }), FingerprintContractError, "missing scheme field");
  const inheritedField = Object.create({ ordering: "LEXICOGRAPHIC" });
  Object.assign(inheritedField, { schemeId: "TAYLOR-ALPHA", manufacturerId: "Taylor", normalizerVersion: 1, tokenPattern: "^[A-Z0-9-]+$" });
  assert.throws(() => withRegistry({ "TAYLOR-ALPHA": inheritedField }), FingerprintContractError, "inherited scheme field");
  const symbolled = { ...SCHEME }; symbolled[Symbol("x")] = 1;
  assert.throws(() => withRegistry({ "TAYLOR-ALPHA": symbolled }), FingerprintContractError, "symbol in scheme");
  const hiddenField = { ...SCHEME };
  Object.defineProperty(hiddenField, "hidden", { value: 1, enumerable: false, configurable: true });
  assert.throws(() => withRegistry({ "TAYLOR-ALPHA": hiddenField }), FingerprintContractError, "non-enumerable scheme field");
  const accessorScheme = { ...SCHEME };
  Object.defineProperty(accessorScheme, "ordering", { get() { return "LEXICOGRAPHIC"; }, enumerable: true, configurable: true });
  assert.throws(() => withRegistry({ "TAYLOR-ALPHA": accessorScheme }), FingerprintContractError, "accessor scheme field");
  const registrySymbol = { "TAYLOR-ALPHA": SCHEME }; registrySymbol[Symbol("x")] = 1;
  assert.throws(() => withRegistry(registrySymbol), FingerprintContractError, "symbol in registry");
  const accessorEntry = {};
  Object.defineProperty(accessorEntry, "TAYLOR-ALPHA", { get() { return SCHEME; }, enumerable: true, configurable: true });
  assert.throws(() => withRegistry(accessorEntry), FingerprintContractError, "accessor registry entry");
  for (const bad of [42, "x", [], new Date(0)]) {
    assert.throws(() => withRegistry(bad), FingerprintContractError, `malformed registry ${String(bad)}`);
    assert.throws(() => withRegistry({ "TAYLOR-ALPHA": bad }), FingerprintContractError, `malformed scheme ${String(bad)}`);
  }
});
ok("an OWN valid scheme is accepted, and a null-prototype registry agrees", () => {
  const ordinary = withRegistry({ "TAYLOR-ALPHA": SCHEME });
  assert.match(ordinary, HEX64);
  const nullRegistry = Object.create(null);
  nullRegistry["TAYLOR-ALPHA"] = SCHEME;
  assert.equal(withRegistry(nullRegistry), ordinary, "null-prototype registry produces the same identity");
  const nullScheme = Object.assign(Object.create(null), SCHEME);
  assert.equal(withRegistry({ "TAYLOR-ALPHA": nullScheme }), ordinary, "null-prototype scheme too");
  // Extra unrelated entries are simply unreachable -- only the requested scheme is handed to D2.
  assert.equal(withRegistry({ "TAYLOR-ALPHA": SCHEME, "OTHER": { ...SCHEME, schemeId: "OTHER" } }), ordinary);
  // A registry missing the requested scheme is unresolved, not injectable.
  assert.throws(() => withRegistry({ "OTHER": { ...SCHEME, schemeId: "OTHER" } }), FingerprintContractError);
  assert.throws(() => withRegistry(undefined), FingerprintContractError);
});
ok("null-prototype payloads and nested maps with valid own fields are accepted", () => {
  const detach = (o) => {
    const out = Object.create(null);
    for (const [k, v] of Object.entries(o)) out[k] = (v !== null && typeof v === "object") ? detach(v) : v;
    return out;
  };
  for (const action of OPERATION_ACTIONS) {
    assert.equal(fp(action, detach(BASE[action])), fp(action, BASE[action]), `${action} null-prototype payload`);
  }
  // A null-prototype nested map cannot inherit anything, so it is accepted on its own merits.
  const mixed = structuredClone(compat);
  mixed.applicability = detach(compat.applicability);
  assert.equal(fp("importCompatibility", mixed), fp("importCompatibility", compat));
});
ok("a missing REQUIRED governed field is rejected rather than treated as null", () => {
  // One non-derivable required field per action family.
  const required = {
    importEquipmentModel: "manufacturerName",
    importEquipmentModelAlias: "aliasType",
    importCompatibility: "partId",
    correctCompatibility: "partId",
    importCompatibilitySource: "authorityType",
    verifyCompatibility: "verificationStatus",
  };
  for (const action of OPERATION_ACTIONS) {
    const payload = structuredClone(BASE[action]);
    delete payload[required[action]];
    assert.throws(() => fp(action, payload), FingerprintContractError, `${action}.${required[action]}`);
  }
  // A field the governed contract DERIVES is reconstructed, not silently defaulted: omitting
  // equipmentModelId yields the same command, because D1 rebuilds it from manufacturerId+modelNumber.
  const { equipmentModelId, ...withoutId } = model();
  assert.equal(
    buildCommandFingerprint({ action: "importEquipmentModel", targetType: "equipment_models", targetId: MODEL_ID, payload: withoutId }),
    fp("importEquipmentModel", model()),
  );
  // ...but a derived field that DISAGREES with its own content is refused.
  assert.throws(() => buildCommandFingerprint({ action: "importEquipmentModel", targetType: "equipment_models", targetId: "TAYLOR--C825", payload: { ...model(), equipmentModelId: "TAYLOR--C825" } }), FingerprintContractError);
});
ok("unsupported value types and non-object payloads are rejected", () => {
  for (const bad of [undefined, null, 42, "x", [], new Date(0)]) {
    assert.throws(() => buildCommandFingerprint({ action: "importEquipmentModel", targetType: "equipment_models", targetId: MODEL_ID, payload: bad }), FingerprintContractError, String(bad));
  }
  for (const bad of [1.5, Number.MAX_SAFE_INTEGER + 2, NaN, Infinity, () => 1, [1]]) {
    assert.throws(() => canonicalCommandPayload("importEquipmentModel", { ...model(), version: bad }), FingerprintContractError, String(bad));
  }
});
ok("unknown and prototype-inherited actions are rejected", () => {
  for (const action of ["nope", "constructor", "__proto__", "toString", null, undefined, 42]) {
    assert.throws(() => buildCommandFingerprint({ action, targetType: "equipment_models", targetId: MODEL_ID, payload: model() }), FingerprintContractError, String(action));
    assert.throws(() => canonicalCommandPayload(action, model()), FingerprintContractError, String(action));
  }
});
ok("inherited payload fields do not satisfy the contract", () => {
  const payload = { ...model() };
  delete payload.family;
  Object.prototype.family = "inherited"; // eslint-disable-line no-extend-native
  try {
    assert.throws(() => fp("importEquipmentModel", payload), FingerprintContractError);
  } finally {
    delete Object.prototype.family;
  }
});

console.log(`\n${passed} fingerprint checks passed`);
