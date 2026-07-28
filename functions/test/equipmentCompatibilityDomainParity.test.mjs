// Fixture-based behavioral parity across the governed D1/D2 contract corpus. The functions/ server
// port (compiled ../lib/equipmentCompatibility/domain/*.js) and the client source
// (field-ops-app-vite/src/domain/*.js) are DIFFERENT files (TypeScript vs JavaScript); this test does
// NOT claim they are byte-identical, and a finite fixture set does not prove equivalence for every
// possible input. It asserts identical observable results across a broad corpus spanning every exported
// constant/enum, validator success and each structured failure reason, allowed-field rejection,
// canonical/stored-ID agreement, malformed/non-object inputs, Unicode + malformed-surrogate hashing,
// 3+ owner alias conflicts + deterministic ordering, serial scheme/range edges, compatibility/source
// collision classifications, mixed-relationship evidence isolation, and source precedence + conflict
// visibility. Enforced in CI (functions test:equipmentCompatibilityParity) so future drift fails automatically.
import assert from "node:assert/strict";
import * as SM from "../lib/equipmentCompatibility/domain/equipmentModel.js";
import * as SC from "../lib/equipmentCompatibility/domain/compatibility.js";
import * as CM from "../../field-ops-app-vite/src/domain/equipmentModel.js";
import * as CC from "../../field-ops-app-vite/src/domain/equipmentCompatibility.js";
let passed = 0; const ok = (n, f) => { f(); passed++; console.log(`PASS -- ${n}`); };
const J = (v) => JSON.stringify(v);
const parity = (name, sfn, cfn, cases) => ok(name, () => { for (const args of cases) assert.equal(J(sfn(...args)), J(cfn(...args)), `${name} diverged @ ${J(args)}`); });

const scheme = { schemeId: "TAYLOR-ALPHA", manufacturerId: "Taylor", normalizerVersion: 1, tokenPattern: "^[A-Z0-9-]+$", ordering: "LEXICOGRAPHIC" };
const schemes = { "TAYLOR-ALPHA": scheme };

// ---- every exported constant / enum ----
ok("D1/D2 constants + enums parity", () => {
  for (const k of ["MODEL_STATUSES", "MODEL_ALIAS_TYPES"]) assert.deepEqual(SM[k], CM[k], `const ${k}`);
  for (const k of ["COMPATIBILITY_TYPES", "REJECTED_COMPATIBILITY_TYPES", "APPLICABILITY_KINDS", "VERIFICATION_STATES", "CONFIDENCE_LEVELS", "OBSERVED_CLAIMS", "AUTHORITY_RANK", "AUTHORITY_TYPES", "AUTHORITATIVE_AUTHORITIES"]) assert.deepEqual(SC[k], CC[k], `const ${k}`);
});

// ---- D1 normalization / identity ----
const strings = [" Model  Ａ ", "Taylor Company", " C713-33 ", "TAYLOR--C713", "taylor--c713", "TAYLOR--C713-REV-A", "A", "", "café ünïcödé", "grill😀ok", "a\uD83Db", "a\uDE00b", "x\uD83D\uD83Dy\uDE00\uDC00z", 42, null, undefined, "  \t multi  space ", "ＴＥＳＴ"];
parity("normalizeIdentityText", SM.normalizeIdentityText, CM.normalizeIdentityText, strings.map((s) => [s]));
parity("normalizeIdentityKey", SM.normalizeIdentityKey, CM.normalizeIdentityKey, strings.map((s) => [s]));
parity("normalizeManufacturerId", SM.normalizeManufacturerId, CM.normalizeManufacturerId, strings.map((s) => [s]));
parity("normalizeModelNumber", SM.normalizeModelNumber, CM.normalizeModelNumber, strings.map((s) => [s]));
parity("buildEquipmentModelId", SM.buildEquipmentModelId, CM.buildEquipmentModelId, [["Taylor", "C713"], ["Taylor Company", " C713-33 "], ["", "C1"], ["A", ""], ["taylor", "c713"], ["--", "--"], ["A B", "C D"]]);
parity("isCanonicalEquipmentModelId", SM.isCanonicalEquipmentModelId, CM.isCanonicalEquipmentModelId, ["TAYLOR--C713", "taylor--c713", "TAYLOR--C713-REV-A", "A", "TAYLOR--", "--C713", "TAYLOR---C713", "TAYLOR--C713--X", "TAYLOR--C713É", "TAYLOR__C713", " TAYLOR--C713", "TAYLOR--C713 ", 42, null, "", {}, []].map((v) => [v]));
parity("normalizeEquipmentModel", SM.normalizeEquipmentModel, CM.normalizeEquipmentModel, [[{ manufacturerId: "Taylor", modelNumber: " c713 ", family: "" }], [null], [42], [[]]]);
parity("normalizeModelAliasKey", SM.normalizeModelAliasKey, CM.normalizeModelAliasKey, [[{ aliasType: "source_model", manufacturerId: "Taylor", rawValue: " c-713 " }], [{ aliasType: "NOPE", manufacturerId: "Taylor", rawValue: "x" }], [null], [42]]);

// validateEquipmentModel — success + every structured failure reason + allowed-field rejection
const M = (o) => ({ equipmentModelId: "TAYLOR--C713", manufacturerId: "Taylor", manufacturerName: "Taylor", modelNumber: "C713", displayName: "Taylor C713", family: null, subtype: null, revision: null, status: "ACTIVE", sourceAuthority: "manufacturer", version: 1, ...o });
const models = [M({ status: "active" }), M({ equipmentModelId: "OTHER" }), M({ equipmentModelId: "TAYLOR--C713 " }), M({ manufacturerName: "" }), M({ displayName: "" }), M({ sourceAuthority: "" }), M({ status: "BOGUS" }), M({ version: 0 }), M({ version: 1.5 }), M({ version: "1" }), { manufacturerId: "Taylor", modelNumber: "C713", secret: "x" }, M({ equipmentModelId: undefined }), null, 42, "x", [], {}];
parity("validateEquipmentModel", SM.validateEquipmentModel, CM.validateEquipmentModel, models.map((m) => [m]));

// validateEquipmentModelAlias — success + every reason + stored aliasKey agreement
const A = (o) => ({ aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C-713", equipmentModelId: "TAYLOR--C713", ...o });
const aliases = [A({ rawValue: " c-713 " }), A({ note: "x" }), A({ aliasType: "NOPE" }), A({ manufacturerId: "  " }), A({ rawValue: "   " }), A({ equipmentModelId: "A" }), A({ aliasKey: "SOURCE_MODEL|TAYLOR|C-713" }), A({ aliasKey: "WRONG" }), null, [], 7, {}];
// isCanonicalModelAliasKey -- the authoritative stored-aliasKey predicate. Corpus spans canonical keys
// for every alias type, an alias value legitimately containing "|", segment-count and empty-segment
// failures, casing/whitespace/normalization disagreements, noncanonical + wrong manufacturers, control
// characters (C0/C1/DEL/zero-width/bidi/line-separator/BOM), non-NFKC and non-NFC forms, the length
// bound, and non-string inputs.
const aliasKeys = [
  "SOURCE_MODEL|TAYLOR|C-713", "MANUFACTURER_MODEL|TAYLOR|C713", "HISTORICAL_MODEL|TAYLOR-CO|C-713 REV A", "SOURCE_MODEL|TAYLOR|C-713|ALT",
  "SOURCE_MODEL|TAYLOR", "SOURCE_MODEL", "|TAYLOR|C-713", "SOURCE_MODEL||C-713", "SOURCE_MODEL|TAYLOR|",
  "NOPE|TAYLOR|C-713", "source_model|TAYLOR|C-713", "SOURCE_MODEL|taylor|C-713", "SOURCE_MODEL|TAYLOR CO|C-713",
  "SOURCE_MODEL|-TAYLOR-|C-713", "SOURCE_MODEL|TAYLOR|c-713", "SOURCE_MODEL|TAYLOR| C-713", "SOURCE_MODEL|TAYLOR|C-713 ",
  "SOURCE_MODEL|TAYLOR|C  713", "SOURCE_MODEL|HOSHIZAKI|C-713",
  "SOURCE_MODEL|TAYLOR|C-713\u0000", "SOURCE_MODEL|TAYLOR|C-713\u001F", "SOURCE_MODEL|TAYLOR|C-713\u007F", "SOURCE_MODEL|TAYLOR|C-713\u0085",
  "SOURCE_MODEL|TAYLOR|C-713\u200B", "SOURCE_MODEL|TAYLOR|C-713\u202E", "SOURCE_MODEL|TAYLOR|C-713\u2028", "SOURCE_MODEL|TAYLOR|C-713\uFEFF",
  "SOURCE_MODEL|TAYLOR|\uFF43-713", "SOURCE_MODEL|TAYLOR|CAFE\u0301", "SOURCE_MODEL|TAYLOR|" + "A".repeat(600),
  "", 42, null, undefined, {}, [],
];
parity("isCanonicalModelAliasKey", SM.isCanonicalModelAliasKey, CM.isCanonicalModelAliasKey, aliasKeys.map((v) => [v]));
// Agreement between the derivation and the predicate: whatever normalizeModelAliasKey PRODUCES is
// canonical, in both ports.
ok("normalizeModelAliasKey output is canonical in both ports", () => {
  for (const r of [{ aliasType: "source_model", manufacturerId: " taylor co ", rawValue: " c-713 " }, { aliasType: "HISTORICAL_MODEL", manufacturerId: "Taylor", rawValue: "C  713" }, { aliasType: "MANUFACTURER_MODEL", manufacturerId: "Taylor", rawValue: "C-713|ALT" }]) {
    const sk = SM.normalizeModelAliasKey(r), ck = CM.normalizeModelAliasKey(r);
    assert.equal(sk, ck);
    assert.equal(SM.isCanonicalModelAliasKey(sk), true, sk);
    assert.equal(CM.isCanonicalModelAliasKey(ck), true, ck);
  }
});

parity("validateEquipmentModelAlias", SM.validateEquipmentModelAlias, CM.validateEquipmentModelAlias, aliases.map((a) => [a]));

// detectModelAliasConflicts — clean, 2-owner, 3+ owner (deterministic ordering), malformed, non-array
const al = (raw, id) => ({ aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: raw, equipmentModelId: id });
parity("detectModelAliasConflicts", SM.detectModelAliasConflicts, CM.detectModelAliasConflicts, [
  [[al("C713", "TAYLOR--C713"), al("C713", "TAYLOR--C713")]],
  [[al("C713", "TAYLOR--C713"), al("C713", "TAYLOR--C825")]],
  [[al("C713", "TAYLOR--C3"), al("C713", "TAYLOR--C1"), al("C713", "TAYLOR--C2"), al("C713", "TAYLOR--C10")]],
  [[al("C2", "TAYLOR--C1"), al("C2", "TAYLOR--C2"), al("C10", "TAYLOR--C1"), al("C10", "TAYLOR--C2")]],
  [[null, undefined, "x", 42, al("C713", "TAYLOR--C1")]],
  ["nope"], [42],
]);

// serial scheme / token / range edges
parity("validateSerialScheme", SM.validateSerialScheme, CM.validateSerialScheme, [[scheme], [{ ...scheme, tokenPattern: "[" }], [{ ...scheme, ordering: "NUMERIC" }], [{ ...scheme, normalizerVersion: 0 }], [{ ...scheme, schemeId: "" }], [{ ...scheme, extra: 1 }], [null], [42]]);
parity("normalizeSerialToken", SM.normalizeSerialToken, CM.normalizeSerialToken, [[" ab-019 ", scheme], ["A9", scheme], ["A10", scheme], ["bad token", scheme], [42, scheme], ["A1", null]]);
parity("validateSerialRange", SM.validateSerialRange, CM.validateSerialRange, [[{ start: "A100", end: null, scheme }], [{ start: null, end: "A200", scheme }], [{ start: "Z900", end: "A100", scheme }], [{ start: null, end: null, scheme }], [{ start: "A9", end: "A10", scheme }], [{ start: "bad token", end: "A1", scheme }], [{}]]);

// ---- D2 hashing (Unicode + malformed surrogates) ----
parity("sha256Hex", SC.sha256Hex, CC.sha256Hex, ["", "abc", "The quick brown fox", "café—ünïcödé😀", "a\uD83Db", "a\uDE00b", "x\uD83D\uD83Dy\uDE00\uDC00z", "�", "𝔘𝔫𝔦", JSON.stringify([1, "TAYLOR--C713", "TST-1001"])].map((s) => [s]));
parity("isValidPartId", SC.isValidPartId, CC.isValidPartId, ["TST-1001", "bad id!", "", "a".repeat(64), "a".repeat(65), " TST", 42, null].map((v) => [v]));
parity("isIsoDate", SC.isIsoDate, CC.isIsoDate, ["2026-07-27", "2026-13-01", "2026-02-30", "2024-02-29", "2026-00-10", "x", 42, null].map((v) => [v]));
parity("isIsoDateTime", SC.isIsoDateTime, CC.isIsoDateTime, ["2026-07-27T07:06:24Z", "2026-07-27T07:06:24.867Z", "2026-07-27T25:00:00Z", "2026-07-27T07:60:00Z", "2026-07-27", "x", 42].map((v) => [v]));

// validateApplicability — every kind + every reason
const apps = [
  { kind: "ALL_SERIALS", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null },
  { kind: "UNRESOLVED", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null },
  { kind: "ALL_SERIALS", serialRangeStart: "A1", serialScheme: null, serialRangeEnd: null, modelRevision: null },
  { kind: "MODEL_REVISION", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: "rev-a" },
  { kind: "MODEL_REVISION", serialScheme: null, serialRangeStart: "A1", serialRangeEnd: null, modelRevision: "REV-A" },
  { kind: "MODEL_REVISION", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: "  " },
  { kind: "SERIAL_RANGE", serialScheme: "taylor-alpha", serialRangeStart: " a100 ", serialRangeEnd: "A200", modelRevision: null },
  { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A100", serialRangeEnd: null, modelRevision: null },
  { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: null, serialRangeEnd: null, modelRevision: null },
  { kind: "SERIAL_RANGE", serialScheme: "MISSING", serialRangeStart: "A1", serialRangeEnd: null, modelRevision: null },
  { kind: "SERIAL_RANGE", serialScheme: "", serialRangeStart: "A1", serialRangeEnd: null, modelRevision: null },
  { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A9", serialRangeEnd: "A10", modelRevision: null },
  { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A1", serialRangeEnd: null, modelRevision: "REV-A" },
  { kind: "NOPE", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null }, { extra: 1, kind: "ALL_SERIALS" }, null, {},
];
parity("validateApplicability", SC.validateApplicability, CC.validateApplicability, apps.map((a) => [a, schemes]));

// validateCompatibility — success + every reason + stored-ID agreement
const B = (o) => ({ equipmentModelId: "TAYLOR--C713", partId: "TST-1001", compatibilityType: "DIRECT_FIT", assembly: null, installationPosition: null, quantityRequired: 1, applicability: { kind: "ALL_SERIALS", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null }, effectiveFrom: null, effectiveTo: null, sourceSummary: null, confidenceLevel: "HIGH", verificationStatus: "VERIFIED", notes: null, version: 1, ...o });
const CID = CC.validateCompatibility(B(), { serialSchemes: schemes }).value.compatibilityId;
const UK = CC.validateCompatibility(B(), { serialSchemes: schemes }).value.uniquenessKey;
const compats = [B(), B({ foo: 1 }), B({ equipmentModelId: "taylor--c713" }), B({ partId: "bad id!" }), B({ compatibilityType: "BADTYPE" }), B({ applicability: { kind: "SERIAL_RANGE", serialScheme: "MISSING", serialRangeStart: "A1", serialRangeEnd: null, modelRevision: null } }), B({ confidenceLevel: "X" }), B({ verificationStatus: "X" }), B({ applicability: { kind: "UNRESOLVED", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null }, verificationStatus: "VERIFIED" }), B({ quantityRequired: 0 }), B({ effectiveFrom: "2026-13-01" }), B({ effectiveTo: "2026-13-01" }), B({ effectiveFrom: "2026-05-10", effectiveTo: "2026-05-01" }), B({ version: 0 }), B({ uniquenessKey: UK }), B({ uniquenessKey: "x" }), B({ compatibilityId: CID }), B({ compatibilityId: "cmp_bad" }), null, 42];
parity("validateCompatibility", SC.validateCompatibility, CC.validateCompatibility, compats.map((c) => [c, { serialSchemes: schemes }]));

// detectCompatibilityCollisions — duplicate vs collision classification, malformed, non-array
parity("detectCompatibilityCollisions", SC.detectCompatibilityCollisions, CC.detectCompatibilityCollisions, [
  [[B(), B()], { serialSchemes: schemes }],
  [[B(), B({ confidenceLevel: "LOW" })], { serialSchemes: schemes }],
  [[B(), B({ partId: "TST-2002" }), B({ compatibilityType: "BADTYPE" })], { serialSchemes: schemes }],
  ["x", {}],
]);

// validateCompatibilitySource — success + every reason + stored sourceId agreement
const FP = "a".repeat(64);
const S = (o) => ({ compatibilityId: CID, authorityType: "MANUFACTURER", sourceReference: "Service Manual 12", sourceVersion: null, observedClaim: "SUPPORTS", contentFingerprint: FP, capturedAt: "2026-07-27T07:06:24Z", capturedBy: "admin-uid-1", notes: null, ...o });
const SID = CC.validateCompatibilitySource(S()).value.sourceId;
const sources = [S(), S({ extra: 1 }), S({ compatibilityId: "cmp_x" }), S({ authorityType: "WIKI" }), S({ sourceReference: "  " }), S({ observedClaim: "MAYBE" }), S({ contentFingerprint: "short" }), S({ capturedAt: "x" }), S({ capturedBy: "  " }), S({ sourceId: SID }), S({ sourceId: "src_bad" }), null, [], 9];
parity("validateCompatibilitySource", SC.validateCompatibilitySource, CC.validateCompatibilitySource, sources.map((s) => [s]));

// detectCompatibilitySourceCollisions — replay-duplicate vs changed-claim-collision, malformed
parity("detectCompatibilitySourceCollisions", SC.detectCompatibilitySourceCollisions, CC.detectCompatibilitySourceCollisions, [
  [[S(), S()]], [[S(), S({ observedClaim: "CONTRADICTS" })]], [[S(), S({ capturedBy: "other" })]], [[S(), { bad: 1 }]], ["x"],
]);

// evidence: precedence + conflict visibility + mixed-relationship isolation
const CID2 = "cmp_" + "0".repeat(64);
parity("analyzeCompatibilityEvidence", SC.analyzeCompatibilityEvidence, CC.analyzeCompatibilityEvidence, [
  [[S(), S({ authorityType: "RESELLER", observedClaim: "CONTRADICTS", contentFingerprint: "c".repeat(64) })]],
  [[S({ authorityType: "RESELLER" })]],
  [[S({ observedClaim: "INCONCLUSIVE" })]],
  [[]],
  [[S({ authorityType: "MANUFACTURER" }), S({ compatibilityId: CID2, authorityType: "RESELLER", observedClaim: "CONTRADICTS" })]],
  [[S({ authorityType: "MANUFACTURER" }), S({ compatibilityId: CID2, authorityType: "RESELLER", observedClaim: "CONTRADICTS" })], { expectedCompatibilityId: CID }],
  [[S(), null]],
  ["x"],
]);
parity("analyzeCompatibilityEvidenceByRelationship", SC.analyzeCompatibilityEvidenceByRelationship, CC.analyzeCompatibilityEvidenceByRelationship, [
  [[S({ authorityType: "MANUFACTURER" }), S({ compatibilityId: CID2, authorityType: "MANUFACTURER", observedClaim: "CONTRADICTS" })]],
  [[S(), { bad: 1 }]],
  ["x"],
]);

// isCanonicalCompatibilityId / isCanonicalCompatibilitySourceId -- the authoritative opaque-ID shape
// predicates consumed by D4 operation target-id validation.
const opaqueIds = [CID, SID, "cmp_" + "a".repeat(64), "src_" + "a".repeat(64), "cmp_" + "A".repeat(64), "cmp_" + "a".repeat(63), "cmp_" + "a".repeat(65), "cmp_", "src_bad", "cmp_" + "g".repeat(64), " cmp_" + "a".repeat(64), "", 42, null, undefined, {}, []];
parity("isCanonicalCompatibilityId", SC.isCanonicalCompatibilityId, CC.isCanonicalCompatibilityId, opaqueIds.map((v) => [v]));
parity("isCanonicalCompatibilitySourceId", SC.isCanonicalCompatibilitySourceId, CC.isCanonicalCompatibilitySourceId, opaqueIds.map((v) => [v]));
ok("buildCompatibilityId output is canonical in both ports", () => {
  for (const k of ["[1,\"TAYLOR--C713\"]", "", "unicode-é-key"]) {
    assert.equal(SC.buildCompatibilityId(k), CC.buildCompatibilityId(k));
    assert.equal(SC.isCanonicalCompatibilityId(SC.buildCompatibilityId(k)), true);
    assert.equal(CC.isCanonicalCompatibilityId(CC.buildCompatibilityId(k)), true);
  }
  assert.equal(SC.isCanonicalCompatibilitySourceId(SID), true);
  assert.equal(CC.isCanonicalCompatibilitySourceId(SID), true);
});
console.log(`\n${passed} parity checks passed`);
