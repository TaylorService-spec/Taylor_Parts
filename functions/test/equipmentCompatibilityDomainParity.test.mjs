// Behavioral parity: the functions/ server port of the D1/D2 pure domain contracts
// (compiled ../lib/equipmentCompatibility/domain/*.js) must produce byte-identical results to the
// merged client source (field-ops-app-vite/src/domain/*.js) across a broad battery. Any divergence
// in the transliteration fails here. Pure Node, no emulator.
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
const strings = [" Model  Ａ ", "Taylor Company", " C713-33 ", "TAYLOR--C713", "taylor--c713", "TAYLOR--C713-REV-A", "A", "", "café ünïcödé", "grill😀ok", "a\uD83Db", "a\uDE00b", "x\uD83D\uD83Dy\uDE00\uDC00z", 42, null, undefined, "  \t multi  space "];

// ---- D1 parity ----
parity("normalizeIdentityText", SM.normalizeIdentityText, CM.normalizeIdentityText, strings.map((s) => [s]));
parity("normalizeIdentityKey", SM.normalizeIdentityKey, CM.normalizeIdentityKey, strings.map((s) => [s]));
parity("normalizeManufacturerId", SM.normalizeManufacturerId, CM.normalizeManufacturerId, strings.map((s) => [s]));
parity("buildEquipmentModelId", SM.buildEquipmentModelId, CM.buildEquipmentModelId, [["Taylor", "C713"], ["Taylor Company", " C713-33 "], ["", "C1"], ["A", ""], ["taylor", "c713"]]);
parity("isCanonicalEquipmentModelId", SM.isCanonicalEquipmentModelId, CM.isCanonicalEquipmentModelId, ["TAYLOR--C713", "taylor--c713", "TAYLOR--C713-REV-A", "A", "TAYLOR--", "--C713", "TAYLOR---C713", "TAYLOR--C713--X", "TAYLOR--C713É", 42, null, "", {}].map((v) => [v]));
const models = [
  { equipmentModelId: "TAYLOR--C713", manufacturerId: "Taylor", manufacturerName: "Taylor", modelNumber: "C713", displayName: "Taylor C713", family: null, subtype: null, revision: null, status: "active", sourceAuthority: "manufacturer", version: 1 },
  { equipmentModelId: "OTHER", manufacturerId: "Taylor", manufacturerName: "Taylor", modelNumber: "C713", displayName: "x", status: "ACTIVE", sourceAuthority: "m", version: 1 },
  { manufacturerId: "Taylor", modelNumber: "C713", secret: "x" },
  { equipmentModelId: "TAYLOR--C713 ", manufacturerId: "Taylor", manufacturerName: "Taylor", modelNumber: "C713", displayName: "x", status: "ACTIVE", sourceAuthority: "m", version: 1 },
  { equipmentModelId: "TAYLOR--C713", manufacturerId: "Taylor", manufacturerName: "Taylor", modelNumber: "C713", displayName: "x", status: "BOGUS", sourceAuthority: "m", version: 1 },
  { equipmentModelId: "TAYLOR--C713", manufacturerId: "Taylor", manufacturerName: "Taylor", modelNumber: "C713", displayName: "x", status: "ACTIVE", sourceAuthority: "m", version: 0 },
  null, 42, "x", [],
];
parity("validateEquipmentModel", SM.validateEquipmentModel, CM.validateEquipmentModel, models.map((m) => [m]));
const aliases = [
  { aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: " c-713 ", equipmentModelId: "TAYLOR--C713" },
  { aliasType: "NOPE", manufacturerId: "Taylor", rawValue: "C713", equipmentModelId: "TAYLOR--C713" },
  { aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C713", equipmentModelId: "A" },
  { aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C713", equipmentModelId: "TAYLOR--C713", aliasKey: "WRONG" },
  { aliasType: "SOURCE_MODEL", manufacturerId: "  ", rawValue: "C713", equipmentModelId: "TAYLOR--C713" },
  null, [], 7,
];
parity("validateEquipmentModelAlias", SM.validateEquipmentModelAlias, CM.validateEquipmentModelAlias, aliases.map((a) => [a]));
parity("detectModelAliasConflicts", SM.detectModelAliasConflicts, CM.detectModelAliasConflicts, [
  [[{ aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C713", equipmentModelId: "TAYLOR--C713" }, { aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C713", equipmentModelId: "TAYLOR--C825" }]],
  [[null, { aliasType: "SOURCE_MODEL", manufacturerId: "Taylor", rawValue: "C713", equipmentModelId: "TAYLOR--C713" }]],
  ["nope"],
]);
parity("validateSerialScheme", SM.validateSerialScheme, CM.validateSerialScheme, [[scheme], [{ ...scheme, tokenPattern: "[" }], [{ ...scheme, ordering: "NUMERIC" }], [null], [{ ...scheme, extra: 1 }]]);
parity("normalizeSerialToken", SM.normalizeSerialToken, CM.normalizeSerialToken, [[" ab-019 ", scheme], ["A9", scheme], ["bad token", scheme], [42, scheme]]);
parity("validateSerialRange", SM.validateSerialRange, CM.validateSerialRange, [[{ start: "A100", end: null, scheme }], [{ start: "Z900", end: "A100", scheme }], [{ start: null, end: null, scheme }], [{ start: "A9", end: "A10", scheme }], [{}]]);

// ---- D2 parity ----
parity("sha256Hex", SC.sha256Hex, CC.sha256Hex, ["", "abc", "café—ünïcödé😀", "a\uD83Db", "a\uDE00b", "x\uD83D\uD83Dy\uDE00\uDC00z", JSON.stringify([1, "TAYLOR--C713", "TST-1001"])].map((s) => [s]));
parity("isValidPartId", SC.isValidPartId, CC.isValidPartId, ["TST-1001", "bad id!", "", "a".repeat(65), 42, null].map((v) => [v]));
parity("isIsoDate", SC.isIsoDate, CC.isIsoDate, ["2026-07-27", "2026-13-01", "2026-02-30", "2024-02-29", "x", 42].map((v) => [v]));
parity("isIsoDateTime", SC.isIsoDateTime, CC.isIsoDateTime, ["2026-07-27T07:06:24Z", "2026-07-27T07:06:24.867Z", "2026-07-27", "2026-07-27T25:00:00Z", "x"].map((v) => [v]));
const apps = [
  { kind: "ALL_SERIALS", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null },
  { kind: "ALL_SERIALS", serialRangeStart: "A1", serialScheme: null, serialRangeEnd: null, modelRevision: null },
  { kind: "MODEL_REVISION", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: "rev-a" },
  { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: " a100 ", serialRangeEnd: "A200", modelRevision: null },
  { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: null, serialRangeEnd: null, modelRevision: null },
  { kind: "SERIAL_RANGE", serialScheme: "MISSING", serialRangeStart: "A1", serialRangeEnd: null, modelRevision: null },
  { kind: "SERIAL_RANGE", serialScheme: "TAYLOR-ALPHA", serialRangeStart: "A9", serialRangeEnd: "A10", modelRevision: null },
  { kind: "NOPE", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null }, null, {},
];
parity("validateApplicability", SC.validateApplicability, CC.validateApplicability, apps.map((a) => [a, schemes]));
const ALL_SERIALS = { kind: "ALL_SERIALS", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null };
const base = (o = {}) => ({ equipmentModelId: "TAYLOR--C713", partId: "TST-1001", compatibilityType: "DIRECT_FIT", assembly: null, installationPosition: null, quantityRequired: 1, applicability: { ...ALL_SERIALS }, effectiveFrom: null, effectiveTo: null, sourceSummary: null, confidenceLevel: "HIGH", verificationStatus: "VERIFIED", notes: null, version: 1, ...o });
const compats = [base(), base({ compatibilityType: "BADTYPE" }), base({ partId: "bad id!" }), base({ equipmentModelId: "taylor--c713" }), base({ version: 0 }), base({ quantityRequired: 0 }), base({ effectiveFrom: "2026-05-10", effectiveTo: "2026-05-01" }), base({ applicability: { kind: "UNRESOLVED", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null }, verificationStatus: "VERIFIED" }), base({ foo: 1 }), null];
parity("validateCompatibility", SC.validateCompatibility, CC.validateCompatibility, compats.map((c) => [c, { serialSchemes: schemes }]));
parity("buildCompatibilityUniquenessKey+Id", (c) => SC.buildCompatibilityId(SC.buildCompatibilityUniquenessKey(SC.validateCompatibility(c, { serialSchemes: schemes }).value)), (c) => CC.buildCompatibilityId(CC.buildCompatibilityUniquenessKey(CC.validateCompatibility(c, { serialSchemes: schemes }).value)), [[base()], [base({ compatibilityType: "CONSUMABLE" })], [base({ assembly: "Main Motor" })]]);
parity("detectCompatibilityCollisions", SC.detectCompatibilityCollisions, CC.detectCompatibilityCollisions, [[[base(), base()], { serialSchemes: schemes }], [[base(), base({ confidenceLevel: "LOW" })], { serialSchemes: schemes }], ["x", {}]]);
const CID = CC.validateCompatibility(base(), { serialSchemes: schemes }).value.compatibilityId;
const FP = "a".repeat(64);
const src = (o = {}) => ({ compatibilityId: CID, authorityType: "MANUFACTURER", sourceReference: "Service Manual 12", sourceVersion: null, observedClaim: "SUPPORTS", contentFingerprint: FP, capturedAt: "2026-07-27T07:06:24Z", capturedBy: "admin-uid-1", notes: null, ...o });
const sources = [src(), src({ authorityType: "WIKI" }), src({ observedClaim: "MAYBE" }), src({ contentFingerprint: "short" }), src({ compatibilityId: "cmp_x" }), src({ capturedAt: "x" }), src({ extra: 1 }), null];
parity("validateCompatibilitySource", SC.validateCompatibilitySource, CC.validateCompatibilitySource, sources.map((s) => [s]));
parity("detectCompatibilitySourceCollisions", SC.detectCompatibilitySourceCollisions, CC.detectCompatibilitySourceCollisions, [[[src(), src()]], [[src(), src({ observedClaim: "CONTRADICTS" })]], ["x"]]);
parity("analyzeCompatibilityEvidence", SC.analyzeCompatibilityEvidence, CC.analyzeCompatibilityEvidence, [
  [[src(), src({ authorityType: "RESELLER", observedClaim: "CONTRADICTS", contentFingerprint: "c".repeat(64) })]],
  [[src({ authorityType: "MANUFACTURER" }), src({ compatibilityId: "cmp_" + "0".repeat(64), authorityType: "RESELLER", observedClaim: "CONTRADICTS" })]],
  [[src()], { expectedCompatibilityId: CID }],
]);
parity("analyzeCompatibilityEvidenceByRelationship", SC.analyzeCompatibilityEvidenceByRelationship, CC.analyzeCompatibilityEvidenceByRelationship, [
  [[src({ authorityType: "MANUFACTURER" }), src({ compatibilityId: "cmp_" + "0".repeat(64), authorityType: "MANUFACTURER", observedClaim: "CONTRADICTS" })]],
  ["x"],
]);

console.log(`\n${passed} parity checks passed`);
