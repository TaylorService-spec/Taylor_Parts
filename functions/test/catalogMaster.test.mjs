// CATALOG CUTOVER -- the offline proofs. No database, no Firebase runtime, no network.
//
//   * the PostgreSQL catalog writers name only capability ids the permission catalog registers, and restate the two
//     Part Master rules that live in a Firebase module exactly;
//   * nothing under src/catalogMaster, and not the copy tool, loads Firebase or names a Firestore write;
//   * the catalog WRITER AUTHORITY STATE (Owner ruling: controlled freeze window): committed OPEN/INACTIVE, exactly
//     four legal moves, never two authoritative writer sets, no revert once PostgreSQL is ACTIVE, freeze != removal;
//   * FIREBASE_EXIT_MIGRATION_ONLY: the snapshot exporter's marker, source allowlist, exclusive checksummed output,
//     and the structural proof that no runtime code can reach it;
//   * the snapshot census: counts, invalid ids, duplicate canonical identity, missing references, status
//     distribution, non-master fields, ALWAYS-excluded Certification fixtures, legacy uid provenance, digest;
//   * deferred migration 027 is not applied and extends 026 rather than restating it.
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
const writerState = require("../lib/catalogMaster/catalogWriterState.js");
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
  assert.deepEqual(topLevelRequires, ['require("node:fs")', 'require("node:path")', 'require("node:crypto")', 'require("./measureEmployeeReferenceIntegrity.js")', 'require("./measureWorkforceActivation.js")']);
  assert.doesNotMatch(code, /exportCatalogSnapshot/, "the copy tool consumes a snapshot file; it never loads the exporter");
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

// ════════════════════ FIREBASE_EXIT_MIGRATION_ONLY: the snapshot exporter ════════════════════

const EXPORTER = "scripts/exportCatalogSnapshot.js";

test("the exporter is explicitly marked as the migration-only exception and allowlists exactly two source collections", () => {
  const ex = require("../scripts/exportCatalogSnapshot.js");
  assert.equal(ex.FIREBASE_EXIT_MIGRATION_ONLY, "FIREBASE_EXIT_MIGRATION_ONLY");
  assert.match(readFileSync(EXPORTER, "utf8").split("\n")[0], /^\/\/ FIREBASE_EXIT_MIGRATION_ONLY$/);
  assert.deepEqual(Object.values(ex.SOURCE_COLLECTIONS), ["parts", "equipment_models"]);
  assert.equal(ex.assertAllowlisted("parts"), "parts");
  for (const other of ["users", "part_aliases", "equipment_model_aliases", "auditEvents", ""]) assert.throws(() => ex.assertAllowlisted(other), /not an allowlisted/);
  const code = stripComments(readFileSync(EXPORTER, "utf8"));
  assert.deepEqual([...code.matchAll(/\bdb\.collection\((.*?)\)\.get\(/g)].map((m) => m[1]), ["assertAllowlisted(name)"], "every collection read goes through the allowlist");
});

test("the exporter writes the snapshot and its sha256 exclusively and refuses to overwrite either", () => {
  const ex = require("../scripts/exportCatalogSnapshot.js");
  const dir = mkdtempSync(join(tmpdir(), "catalog-export-"));
  const out = join(dir, "snap.json");
  const sha = ex.writeSnapshotFiles(out, "{\"a\":1}\n");
  assert.match(sha, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(`${out}.sha256`, "utf8"), `${sha}  snap.json\n`);
  assert.throws(() => ex.writeSnapshotFiles(out, "{\"a\":2}\n"), /EEXIST/);
  assert.equal(readFileSync(out, "utf8"), "{\"a\":1}\n", "the first snapshot is untouched");
  assert.throws(() => ex.assertExportInvocation({ projectId: "eos-platform-sandbox", out }), /never overwritten/);
  const { verifySnapshotChecksum } = require("../scripts/catalogCutover.js");
  assert.equal(verifySnapshotChecksum(out).sha256, sha);
  writeFileSync(join(dir, "tampered.json"), "{}\n");
  writeFileSync(join(dir, "tampered.json.sha256"), `${sha}  tampered.json\n`);
  assert.throws(() => verifySnapshotChecksum(join(dir, "tampered.json")), /changed after export/);
  assert.throws(() => verifySnapshotChecksum(join(dir, "nope.json")), /missing/);
});

test("STRUCTURAL: no runtime code can import the exporter -- not src, not the client, not integrations, not package entry points, not a workflow step or schedule", () => {
  const root = resolve("..");
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    if (f === "node_modules" || f === ".git" || f === "lib" || f === "dist") return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(f) ? [p] : [];
  });
  const offenders = ["functions/src", "field-ops-app-vite/src", "integrations"]
    .flatMap((d) => walk(join(root, d)))
    .filter((f) => /exportCatalogSnapshot|FIREBASE_EXIT_MIGRATION_ONLY/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], "a runtime module references the migration-only exporter");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.doesNotMatch(JSON.stringify({ main: pkg.main, exports: pkg.exports ?? null, bin: pkg.bin ?? null, scripts: pkg.scripts }), /exportCatalogSnapshot/);
  for (const wf of readdirSync(join(root, ".github", "workflows"))) {
    const lines = readFileSync(join(root, ".github", "workflows", wf), "utf8").split("\n").filter((l) => /exportCatalogSnapshot/.test(l));
    for (const line of lines) assert.match(line.trim(), /^- "functions\/scripts\/exportCatalogSnapshot\.js"$/, `${wf} may name the exporter only as a path filter: ${line}`);
    if (lines.length > 0) assert.doesNotMatch(readFileSync(join(root, ".github", "workflows", wf), "utf8"), /^\s*schedule:/m, `${wf} names the exporter and has a schedule`);
  }
});

// ════════════════════ the catalog writer authority state (controlled freeze window) ════════════════════

const st = (firestore, postgres) => ({ firestore, postgres });

test("the committed catalog writer state is OPEN/INACTIVE: legacy writers authoritative, PostgreSQL writers not active", () => {
  assert.deepEqual({ ...writerState.CATALOG_WRITER_AUTHORITY }, st("OPEN", "INACTIVE"));
  assert.doesNotThrow(() => writerState.assertCatalogWriterAuthorityCoherent(writerState.CATALOG_WRITER_AUTHORITY));
  for (const id of Object.keys(writerState.FIRESTORE_CATALOG_WRITERS)) assert.doesNotThrow(() => writerState.assertFirestoreCatalogWriterOpen(id));
});

test("never two authoritative writer sets: OPEN/ACTIVE and RETIRED/INACTIVE are incoherent", () => {
  assert.throws(() => writerState.assertCatalogWriterAuthorityCoherent(st("OPEN", "ACTIVE")), (e) => e.code === "TWO_AUTHORITATIVE_WRITER_SETS");
  assert.throws(() => writerState.assertCatalogWriterAuthorityCoherent(st("RETIRED", "INACTIVE")), (e) => e.code === "NO_AUTHORITATIVE_WRITER_SET");
  assert.throws(() => writerState.assertCatalogWriterAuthorityCoherent(st("PAUSED", "INACTIVE")), (e) => e.code === "CATALOG_WRITER_STATE_INVALID");
});

test("the allowed moves are exactly freeze, rollback-before-PostgreSQL-writes, activate, retire", () => {
  assert.equal(writerState.assertCatalogWriterTransition(st("OPEN", "INACTIVE"), st("FROZEN", "INACTIVE")), "FREEZE");
  assert.equal(writerState.assertCatalogWriterTransition(st("FROZEN", "INACTIVE"), st("OPEN", "INACTIVE")), "ROLLBACK_BEFORE_POSTGRES_WRITES");
  assert.equal(writerState.assertCatalogWriterTransition(st("FROZEN", "INACTIVE"), st("FROZEN", "ACTIVE")), "ACTIVATE_POSTGRES");
  assert.equal(writerState.assertCatalogWriterTransition(st("FROZEN", "ACTIVE"), st("RETIRED", "ACTIVE")), "RETIRE_FIRESTORE");
  assert.equal(writerState.CATALOG_WRITER_TRANSITIONS.length, 4);
  // No silent revert once PostgreSQL accepts authoritative writes; no skipping the freeze; no un-retiring.
  assert.throws(() => writerState.assertCatalogWriterTransition(st("FROZEN", "ACTIVE"), st("FROZEN", "INACTIVE")), (e) => e.code === "CATALOG_WRITER_TRANSITION_NOT_ALLOWED");
  assert.throws(() => writerState.assertCatalogWriterTransition(st("RETIRED", "ACTIVE"), st("FROZEN", "ACTIVE")), (e) => e.code === "CATALOG_WRITER_TRANSITION_NOT_ALLOWED");
  assert.throws(() => writerState.assertCatalogWriterTransition(st("OPEN", "INACTIVE"), st("FROZEN", "ACTIVE")), (e) => e.code === "CATALOG_WRITER_TRANSITION_NOT_ALLOWED");
  assert.throws(() => writerState.assertCatalogWriterTransition(st("OPEN", "INACTIVE"), st("OPEN", "ACTIVE")), (e) => e.code === "TWO_AUTHORITATIVE_WRITER_SETS");
});

test("FROZEN and RETIRED both refuse every legacy writer, with distinct governed codes (freeze is not removal)", () => {
  for (const id of Object.keys(writerState.FIRESTORE_CATALOG_WRITERS)) {
    assert.throws(() => writerState.assertFirestoreCatalogWriterOpen(id, st("FROZEN", "INACTIVE")), (e) => e instanceof writerState.FirestoreCatalogWriterClosedError && e.code === "FIRESTORE_CATALOG_WRITER_FROZEN" && e.writer === id);
    assert.throws(() => writerState.assertFirestoreCatalogWriterOpen(id, st("FROZEN", "ACTIVE")), (e) => e.code === "FIRESTORE_CATALOG_WRITER_FROZEN");
    assert.throws(() => writerState.assertFirestoreCatalogWriterOpen(id, st("RETIRED", "ACTIVE")), (e) => e.code === "FIRESTORE_CATALOG_WRITER_RETIRED");
  }
  assert.throws(() => writerState.assertFirestoreCatalogWriterOpen("part.create", st("OPEN", "ACTIVE")), (e) => e.code === "TWO_AUTHORITATIVE_WRITER_SETS");
  assert.throws(() => writerState.assertFirestoreCatalogWriterOpen("part.delete"), /unknown Firestore catalog writer/);
  // The freeze covers the catalog import write: Data Import reaches Part creation only through createPart.
  assert.ok(writerState.FIRESTORE_CATALOG_WRITERS["part.create"].reachedFrom.some((r) => /executeDataImport/.test(r)));
  assert.match(readFileSync("src/dataImport/firestoreDataImportAdapters.ts", "utf8"), /await createPart\(/);
});

test("every legacy writer calls the guard with its own id, before anything else it does", () => {
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

test("while PostgreSQL is INACTIVE, nothing outside catalogMaster imports the PostgreSQL catalog writers", () => {
  assert.equal(writerState.CATALOG_WRITER_AUTHORITY.postgres, "INACTIVE");
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : /\.(ts|js|mjs)$/.test(f) ? [join(dir, f)] : []));
  const importers = walk("src").filter((f) => !f.startsWith(CATALOG_DIR) && /postgresPartMasterWriter|postgresEquipmentModelWriter|catalogMasterKernel/.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers, [], "activating PostgreSQL catalog writers is step 7 and must change CATALOG_WRITER_AUTHORITY in the same change");
});

test("the Part callables map FROZEN and RETIRED to failed-precondition, not internal", () => {
  const { mapError } = require("../lib/partMaster/partMasterCallables.js");
  assert.equal(mapError(new writerState.FirestoreCatalogWriterClosedError("part.create", "FROZEN")).code, "failed-precondition");
  assert.equal(mapError(new writerState.FirestoreCatalogWriterClosedError("part.update", "RETIRED")).code, "failed-precondition");
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

test("identified Certification fixtures are ALWAYS excluded, listed with id and reason, and never block or seed the copy", () => {
  const s = cleanSnapshot();
  s.parts.push(partDoc("CW-P-0000", { certificationWorld: { version: "1.9.0", datasetId: "cw" }, certFamily: "CTRL" }));
  s.parts.push(partDoc("CW-P-0001", { dataProvenance: "SYNTHETIC_CERTIFICATION_FACT", version: 0 })); // invalid, but excluded first
  s.equipmentModels.push(modelDoc("CERT--MODEL-1", { certificationWorld: { version: "1.9.0", datasetId: "cw" } }));
  const { census, catalog } = censusCatalogSnapshot(parseCatalogSnapshot(s));
  assert.equal(census.copyReady, true, JSON.stringify(census.blockers));
  assert.deepEqual(census.certificationExcluded, {
    counts: { parts: 2, equipmentModels: 1 },
    records: [
      { kind: "equipment_model", id: "CERT--MODEL-1", reason: "CERTIFICATION_FIXTURE_EXCLUDED:certificationWorld-marker" },
      { kind: "part", id: "CW-P-0000", reason: "CERTIFICATION_FIXTURE_EXCLUDED:certificationWorld-marker" },
      { kind: "part", id: "CW-P-0001", reason: "CERTIFICATION_FIXTURE_EXCLUDED:dataProvenance" },
    ],
  });
  assert.equal(catalog.parts.some((p) => p.id.startsWith("CW-")), false);
  assert.equal(catalog.equipmentModels.some((m) => m.id === "CERT--MODEL-1"), false);
  assert.equal(census.canonicalDigest, censusCatalogSnapshot(parseCatalogSnapshot(cleanSnapshot())).census.canonicalDigest, "fixtures contribute nothing to what is copied");
  assert.equal(census.nonMasterFields.parts.certFamily, undefined, "an excluded fixture is not inventoried as catalog data");
});

test("a Certification fixture cannot become seed truth: an operational Part naming a fixture model is a missing reference", () => {
  const s = snapshotOf({ equipmentModels: [modelDoc("CERT--MODEL-1", { certificationWorld: { version: "1" } })], parts: [wholeUnitPartDoc("UNIT-OPS", "CERT--MODEL-1")] });
  const { census } = censusCatalogSnapshot(parseCatalogSnapshot(s));
  assert.deepEqual(census.blockers, ["MISSING_REFERENCES"]);
});

test("there is no way to include Certification fixtures: the census takes no decision and the CLI refuses the old option", () => {
  assert.equal(censusCatalogSnapshot.length, 1, "censusCatalogSnapshot(snapshot) has no inclusion parameter");
  const s = cleanSnapshot();
  s.parts.push(partDoc("CW-P-0000", { certificationWorld: { version: "1" } }));
  for (const extra of ["include", true, "exclude"]) {
    assert.equal(censusCatalogSnapshot(parseCatalogSnapshot(s), extra).catalog.parts.some((p) => p.id === "CW-P-0000"), false);
  }
  const { assertCutoverInvocation } = require("../scripts/catalogCutover.js");
  assert.throws(() => assertCutoverInvocation({ mode: "census", environment: "platform-sandbox", databaseUrlEnv: "X", tenantKey: "t", snapshot: "s", certificationMarked: "include" }, { X: "postgres://x", EOS_ENVIRONMENT: "nonprod" }), /not an option/);
});

test("legacy Firestore actor uids are kept only as migration provenance, never on a canonical record", () => {
  const { catalog, legacyActorProvenance } = censusCatalogSnapshot(parseCatalogSnapshot(cleanSnapshot()));
  const canonicalText = JSON.stringify(catalog);
  for (const uid of ["legacy-uid-a", "legacy-uid-b", "legacy-uid-c"]) assert.doesNotMatch(canonicalText, new RegExp(uid));
  assert.deepEqual(legacyActorProvenance.find((p) => p.id === "UNIT-CW-100"), { kind: "part", id: "UNIT-CW-100", legacyCreatedBy: "legacy-uid-a", legacyUpdatedBy: "legacy-uid-c" });
  assert.equal(legacyActorProvenance.length, 7);
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

test("migration 027 is deferred -- not in the applied set -- and extends 026's eos_ops.parts rather than restating it", () => {
  assert.equal(migrationFiles().some((f) => f.startsWith("1759881600000")), false, "027 must stay in migrations/deferred until #1911 (026) is applied");
  const sql = readFileSync(join("migrations", "deferred", DEFERRED_027), "utf8");
  const up = sql.split(/^-- Down Migration/m)[0].split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(up, /CREATE\s+TABLE/i, "027 creates no table: the Part identity table is 026's");
  assert.match(up, /ALTER TABLE parts/);
  assert.match(up, /FOREIGN KEY \(tenant_id, equipment_model_id\)\s+REFERENCES equipment_models \(tenant_id, id\)/);
  for (const key of Object.values(CATALOG_CAPABILITIES)) assert.match(up, new RegExp(`'${key.replace(/\./g, "\\.")}'`));
  assert.doesNotMatch(up, /role_capabilities/, "vocabulary only, never a grant");
});
