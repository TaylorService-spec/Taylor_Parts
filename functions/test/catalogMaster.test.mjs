// CATALOG CUTOVER -- the offline proofs. No database, no Firebase runtime, no network.
//
//   * the PostgreSQL catalog writers name only capability ids the permission catalog registers, and restate the two
//     Part Master rules that live in a Firebase module exactly;
//   * nothing under src/catalogMaster, and not the copy tool, loads Firebase or names a Firestore write;
//   * the Firestore catalog writer RETIREMENT SWITCH is OPEN, is called by every writer it lists, and refuses when
//     RETIRED;
//   * the snapshot census: counts, invalid ids, duplicate canonical identity, missing references, status
//     distribution, non-master fields, certification-marked decision, digest determinism;
//   * deferred migration 027 is not applied and extends 025 rather than restating it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cleanSnapshot, modelDoc, partDoc, snapshotOf, ts, wholeUnitPartDoc } from "./support/catalogSnapshotFixture.mjs";
import { migrationFiles } from "./support/migrationSchema.mjs";

const require = createRequire(import.meta.url);
const { CATALOG_CAPABILITIES } = require("../lib/catalogMaster/catalogMasterKernel.js");
const { PART_STATUS_TRANSITIONS, PART_UPDATABLE_FIELDS } = require("../lib/catalogMaster/postgresPartMasterWriter.js");
const retirement = require("../lib/catalogMaster/firestoreCatalogWriterRetirement.js");
const { parseCatalogSnapshot, censusCatalogSnapshot, timestampToIsoMicros, CatalogSnapshotError } = require("../lib/catalogMaster/catalogSnapshot.js");
const { isValidPermissionId } = require("../lib/access/permissionCatalog.js");

const CATALOG_DIR = "src/catalogMaster";
const sources = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? sources(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ════════════════════ capabilities and rule parity ════════════════════

test("catalog writers require exactly the capability ids the permission catalog registers and the Firestore commands check", () => {
  for (const id of Object.values(CATALOG_CAPABILITIES)) assert.equal(isValidPermissionId(id), true, `${id} must be registered in permissionCatalog.ts`);
  const pm = require("../lib/partMaster/partMasterCommands.js");
  const eq = require("../lib/equipmentCompatibility/commands.js");
  assert.equal(CATALOG_CAPABILITIES.PART_MANAGE, pm.CAP_CATALOG_MANAGE);
  assert.equal(CATALOG_CAPABILITIES.PART_ACTIVATE, pm.CAP_CATALOG_ACTIVATE);
  assert.equal(CATALOG_CAPABILITIES.EQUIPMENT_MODEL_MANAGE, eq.COMMAND_CAPABILITIES.importEquipmentModel);
});

test("the Part status transitions and updatable fields are the Firestore command's, exactly", () => {
  const pm = require("../lib/partMaster/partMasterCommands.js");
  assert.deepEqual(JSON.parse(JSON.stringify(PART_STATUS_TRANSITIONS)), JSON.parse(JSON.stringify(pm.PART_STATUS_TRANSITIONS)));
  const src = readFileSync("src/partMaster/partMasterCommands.ts", "utf8");
  const literal = /const UPDATABLE_FIELDS = new Set\(\[([^\]]*)\]\)/.exec(src)[1];
  const firestoreFields = [...literal.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...PART_UPDATABLE_FIELDS].sort(), firestoreFields);
});

// ════════════════════ no Firebase on the PostgreSQL side ════════════════════

const FORBIDDEN = [
  /from\s+["']firebase/, /require\(\s*["']firebase/, /import\(\s*["']firebase/, /\bgetFirestore\s*\(/, /\bFieldValue\b/, /@google-cloud\/firestore/,
];

test("no catalogMaster module imports Firebase or Firestore", () => {
  const offences = [];
  for (const file of sources(CATALOG_DIR)) {
    const text = readFileSync(file, "utf8");
    for (const p of FORBIDDEN) if (p.test(text)) offences.push(`${file}: ${p}`);
  }
  assert.deepEqual(offences, []);
});

test("loading every compiled catalogMaster module never resolves a Firebase package (runtime probe)", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-master-probe-"));
  const preload = join(dir, "banFirebase.cjs");
  writeFileSync(preload, 'const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase|@google-cloud\\/firestore/i.test(r)){process.stderr.write("FIREBASE_LOADED:"+r);process.exit(97);}return l.call(this,r,...a);};');
  const modules = readdirSync("lib/catalogMaster").filter((f) => f.endsWith(".js")).map((f) => resolve("lib/catalogMaster", f));
  assert.ok(modules.length >= 6);
  const probe = spawnSync(process.execPath, ["--require", preload, "-e", modules.map((m) => `require(${JSON.stringify(m)});`).join("")], { encoding: "utf8" });
  assert.equal(probe.status, 0, `a catalogMaster module transitively loaded Firebase: ${probe.stderr}`);
});

test("the copy tool loads no Firebase module and has no Firestore write path", () => {
  const code = stripComments(readFileSync("scripts/catalogCutover.js", "utf8"));
  for (const p of FORBIDDEN) assert.doesNotMatch(code, p);
  assert.doesNotMatch(code, /\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter)\s*\(/);
  // It requires only the fence helpers at module scope; lib/ and pg after the fence.
  const topLevelRequires = code.split("async function main")[0].match(/require\(\s*["'][^"']+["']\s*\)/g);
  assert.deepEqual(topLevelRequires, ['require("node:fs")', 'require("node:path")', 'require("./measureEmployeeReferenceIntegrity.js")', 'require("./measureWorkforceActivation.js")']);
});

test("the snapshot export performs only collection reads -- no Firestore write verb anywhere in its code", () => {
  const code = stripComments(readFileSync("scripts/exportCatalogSnapshot.js", "utf8"));
  assert.doesNotMatch(code, /\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter|recursiveDelete)\s*\(/);
  assert.deepEqual([...code.matchAll(/\bdb\.(\w+)\(/g)].map((m) => m[1]), ["collection"]);
  assert.match(code, /flag: "wx"/, "a snapshot file is never overwritten");
});

test("the snapshot export encodes Timestamps and refuses every other non-JSON Firestore value", () => {
  const { encodeValue } = require("../scripts/exportCatalogSnapshot.js");
  class FakeTimestamp { constructor(s, n) { this.seconds = s; this.nanoseconds = n; } }
  assert.deepEqual(encodeValue({ b: [1, "x", null], a: new FakeTimestamp(5, 7) }, FakeTimestamp, "d"), { a: { $timestamp: { seconds: 5, nanoseconds: 7 } }, b: [1, "x", null] });
  assert.throws(() => encodeValue({ ref: new (class DocumentReference {})() }, FakeTimestamp, "d"), /UNSUPPORTED_VALUE at d\.ref/);
  assert.throws(() => encodeValue({ $timestamp: 1 }, FakeTimestamp, "d"), /ambiguous/);
  assert.throws(() => encodeValue(Number.NaN, FakeTimestamp, "d"), /non-finite/);
});

// ════════════════════ the retirement switch ════════════════════

test("the Firestore catalog writer retirement switch is OPEN in this change", () => {
  assert.equal(retirement.FIRESTORE_CATALOG_WRITER_STATE, "OPEN");
  for (const id of Object.keys(retirement.FIRESTORE_CATALOG_WRITERS)) assert.doesNotThrow(() => retirement.assertFirestoreCatalogWriterOpen(id));
});

test("RETIRED refuses every listed writer with a governed error, and an unknown writer id is a programming error", () => {
  for (const id of Object.keys(retirement.FIRESTORE_CATALOG_WRITERS)) {
    assert.throws(() => retirement.assertFirestoreCatalogWriterOpen(id, "RETIRED"), (e) => e instanceof retirement.FirestoreCatalogWriterRetiredError && e.code === "FIRESTORE_CATALOG_WRITER_RETIRED" && e.writer === id);
  }
  assert.throws(() => retirement.assertFirestoreCatalogWriterOpen("part.delete"), /unknown Firestore catalog writer/);
});

test("every writer the switch lists calls the guard with its own id, before anything else it does", () => {
  const pm = readFileSync("src/partMaster/partMasterCommands.ts", "utf8");
  for (const [id, fn] of [["part.create", "createPart"], ["part.update", "updatePart"], ["part.changeStatus", "changePartStatus"]]) {
    const body = new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\n([^\\n]*)`).exec(pm);
    assert.ok(body, `${fn} not found`);
    assert.equal(body[1].trim(), `assertFirestoreCatalogWriterOpen("${id}");`, `${fn} must call the guard as its first statement`);
  }
  const eq = readFileSync("src/equipmentCompatibility/commands.ts", "utf8");
  const accept = eq.slice(eq.indexOf("async function acceptForExecution"), eq.indexOf("return { prepared, expectedVersion, actorUid };"));
  assert.match(accept, /if \(action === "importEquipmentModel"\) assertFirestoreCatalogWriterOpen\("equipmentModel\.import"\);/);
  assert.ok(accept.indexOf("assertFirestoreCatalogWriterOpen") < accept.indexOf("resolvePermission"), "the guard precedes capability resolution");
});

test("the Part callables map a retired writer to failed-precondition, not internal", () => {
  const { mapError } = require("../lib/partMaster/partMasterCallables.js");
  const mapped = mapError(new retirement.FirestoreCatalogWriterRetiredError("part.create"));
  assert.equal(mapped.code, "failed-precondition");
});

// ════════════════════ snapshot census ════════════════════

test("a clean snapshot is copy-ready, with exact counts, statuses and the non-master fields it leaves behind", () => {
  const { census, catalog } = censusCatalogSnapshot(parseCatalogSnapshot(cleanSnapshot()));
  assert.equal(census.copyReady, true, JSON.stringify(census.blockers));
  assert.deepEqual(census.counts, { parts: 4, equipmentModels: 3 });
  assert.deepEqual(census.selected, { parts: 4, equipmentModels: 3 });
  assert.deepEqual(census.statusDistribution, { parts: { ACTIVE: 3, DRAFT: 1 }, equipmentModels: { ACTIVE: 1, DRAFT: 1, RETIRED: 1 } });
  assert.deepEqual(census.nonMasterFields.parts, { partTrackingMode: 4, sku: 4, unitOfMeasure: 4 });
  assert.deepEqual(census.nonMasterFields.equipmentModels, {});
  assert.deepEqual(catalog.parts.map((p) => p.id), ["TST-1001", "TST-1002", "TST-1003", "UNIT-CW-100"]);
  const unit = catalog.parts.find((p) => p.id === "UNIT-CW-100");
  assert.deepEqual(unit, {
    id: "UNIT-CW-100", internalPartNumber: "UNIT-CW-100", name: "Part UNIT-CW-100".replace("Part", "Unit"), description: "a whole unit", category: "COMPRESSOR",
    status: "ACTIVE", stockingUnit: "EACH", controlType: "SERIALIZED", stockingClass: "STOCKED", expiryTracked: false, consumable: false,
    returnableCore: false, primaryManufacturerId: "ACME", primaryManufacturerPartNumber: "acme-pn-1", oemStatus: "OEM", wholeUnit: true,
    equipmentModelId: "ACME--CW-100", version: 2, createdAt: "2025-09-05T19:20:00.111111Z", updatedAt: "2025-09-06T23:06:40.222222Z",
  });
  assert.equal(catalog.parts.find((p) => p.id === "TST-1002").description, "", "an empty description is carried, not nulled");
  assert.equal(census.canonicalDigest, censusCatalogSnapshot(parseCatalogSnapshot(cleanSnapshot())).census.canonicalDigest, "digest is deterministic");
});

test("census refuses to be copy-ready on duplicate canonical identity, and never selects either duplicate", () => {
  const s = cleanSnapshot();
  s.parts.push(partDoc("TST-1001", { name: "a second TST-1001" }));
  s.equipmentModels.push(modelDoc("KOLD--KX-9"));
  const { census, catalog } = censusCatalogSnapshot(parseCatalogSnapshot(s));
  assert.equal(census.copyReady, false);
  assert.ok(census.blockers.includes("DUPLICATE_CANONICAL_IDENTITY"));
  assert.deepEqual(census.duplicateIdentities, [
    { kind: "equipment_model", id: "KOLD--KX-9", reason: "DUPLICATE_CANONICAL_IDENTITY:2" },
    { kind: "part", id: "TST-1001", reason: "DUPLICATE_CANONICAL_IDENTITY:2" },
  ]);
  assert.equal(catalog.parts.some((p) => p.id === "TST-1001"), false);
});

test("census reports invalid identities and records the Firestore adapters would refuse, and blocks the copy", () => {
  const s = snapshotOf({
    equipmentModels: [
      modelDoc("ACME--CW-100"),
      { id: "acme--cw-100", data: modelDoc("ACME--CW-100").data },                          // doc id != data id
      modelDoc("ACME--CW-300", { updatedAt: ts(1, 0) }),                                    // updated before created
    ],
    parts: [
      partDoc("TST-2001", { partId: "TST-OTHER" }),                                          // identity mismatch
      { id: "bad id!", data: partDoc("bad id!").data },                                      // not parsePartId-shaped
      partDoc("TST-2002", { version: 0 }),                                                   // meta
      partDoc("TST-2003", { stockingClass: "SERVICE", controlType: "SERIALIZED" }),         // domain combination
      partDoc("TST-2004", { createdAt: "2026-01-01" }),                                      // not a Timestamp
    ],
  });
  const { census } = censusCatalogSnapshot(parseCatalogSnapshot(s));
  assert.equal(census.copyReady, false);
  assert.deepEqual(census.invalid.map((f) => `${f.kind}|${f.id}|${f.reason.split(":")[0]}`), [
    "equipment_model|ACME--CW-300|META_UPDATED_BEFORE_CREATED",
    "equipment_model|acme--cw-100|IDENTITY_MISMATCH",
    "part|TST-2001|IDENTITY_MISMATCH",
    "part|TST-2002|META_VERSION_INVALID",
    "part|TST-2003|DOMAIN_INVALID",
    "part|TST-2004|META_TIMESTAMP_INVALID",
    "part|bad id!|DOMAIN_INVALID",
  ]);
});

test("census detects a whole-unit Part whose equipment model is not in the snapshot", () => {
  const s = snapshotOf({ equipmentModels: [modelDoc("ACME--CW-100")], parts: [wholeUnitPartDoc("UNIT-X", "ACME--MISSING-1")] });
  const { census } = censusCatalogSnapshot(parseCatalogSnapshot(s));
  assert.deepEqual(census.missingReferences, [{ kind: "part", id: "UNIT-X", reason: "EQUIPMENT_MODEL_NOT_IN_SNAPSHOT:ACME--MISSING-1" }]);
  assert.ok(census.blockers.includes("MISSING_REFERENCES"));
});

test("certification-marked records require an explicit decision; exclude leaves them out, include copies them", () => {
  const s = cleanSnapshot();
  s.parts.push(partDoc("CW-P-0000", { certificationWorld: "1.9.0", certFamily: "CTRL" }));
  const undecided = censusCatalogSnapshot(parseCatalogSnapshot(s));
  assert.deepEqual(undecided.census.certificationMarked, { parts: 1, equipmentModels: 0 });
  assert.deepEqual(undecided.census.blockers, ["CERTIFICATION_MARKED_RECORDS_REQUIRE_DECISION"]);
  const excluded = censusCatalogSnapshot(parseCatalogSnapshot(s), "exclude");
  assert.equal(excluded.census.copyReady, true);
  assert.equal(excluded.catalog.parts.some((p) => p.id === "CW-P-0000"), false);
  const included = censusCatalogSnapshot(parseCatalogSnapshot(s), "include");
  assert.equal(included.catalog.parts.some((p) => p.id === "CW-P-0000"), true);
  assert.notEqual(excluded.census.canonicalDigest, included.census.canonicalDigest);
});

test("census findings that do not block: sku disagreement, duplicate internal part numbers, cross-kind ids, truncated timestamps", () => {
  const s = cleanSnapshot();
  s.parts.push(partDoc("TST-3001", { sku: "SOMETHING-ELSE", internalPartNumber: "TST-1001" }));
  s.parts.push(partDoc("ACME--CW-100".replace("--", "-"), {}));
  s.equipmentModels.push(modelDoc("TST--1001"));
  s.parts.push(partDoc("TST--1001", { internalPartNumber: "TST-9999", createdAt: ts(1757100000, 111111999) }));
  const { census } = censusCatalogSnapshot(parseCatalogSnapshot(s));
  assert.equal(census.copyReady, true, JSON.stringify(census.blockers));
  assert.deepEqual(census.skuDisagreesWithPartId, ["TST-3001"]);
  assert.deepEqual(census.duplicateInternalPartNumbers, [{ internalPartNumber: "TST-1001", partIds: ["TST-1001", "TST-3001"] }]);
  assert.deepEqual(census.crossKindIdentities, ["TST--1001"]);
  assert.equal(census.truncatedTimestamps, 1);
});

test("timestamps are carried at microsecond precision, exactly", () => {
  assert.deepEqual(timestampToIsoMicros({ seconds: 0, nanoseconds: 1_000 }), { iso: "1970-01-01T00:00:00.000001Z", truncated: false });
  assert.deepEqual(timestampToIsoMicros({ seconds: 1757000000, nanoseconds: 999_999_999 }), { iso: "2025-09-04T15:33:20.999999Z", truncated: true });
});

test("a structurally wrong file is refused before any census", () => {
  assert.throws(() => parseCatalogSnapshot({ format: "EOS_CATALOG_SNAPSHOT", version: 2 }), (e) => e instanceof CatalogSnapshotError && e.code === "SNAPSHOT_FORMAT_INVALID");
  assert.throws(() => parseCatalogSnapshot({ ...cleanSnapshot(), parts: [{ id: 1, data: {} }] }), /parts\[0\]/);
});

// ════════════════════ deferred migration 027 ════════════════════

const DEFERRED_027 = "1759881600000_catalog-master-descriptive-authority.sql";

test("migration 027 is deferred -- not in the applied set -- and extends 025's eos_ops.parts rather than restating it", () => {
  assert.equal(migrationFiles().some((f) => f.startsWith("1759881600000")), false, "027 must stay in migrations/deferred until #1911 (025) is applied");
  const sql = readFileSync(join("migrations", "deferred", DEFERRED_027), "utf8");
  const up = sql.split(/^-- Down Migration/m)[0].split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(up, /CREATE\s+TABLE/i, "027 creates no table: the Part identity table is 025's");
  assert.match(up, /ALTER TABLE parts/);
  assert.match(up, /FOREIGN KEY \(tenant_id, equipment_model_id\)\s+REFERENCES equipment_models \(tenant_id, id\)/);
  for (const key of Object.values(CATALOG_CAPABILITIES)) assert.match(up, new RegExp(`'${key.replace(/\./g, "\\.")}'`));
  assert.doesNotMatch(up, /role_capabilities/, "vocabulary only, never a grant");
});
