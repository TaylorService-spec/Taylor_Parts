// INV-1 Phase 1 PR 1.10 -- migration evidence + cutover readiness tests.
// Pure readiness checks need nothing; committed-package checks need only the
// repo; the determinism rerun needs the Firestore emulator (like the PR 1.8
// suite). ZERO writes anywhere except disposable MIGFIX-* emulator fixtures.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { scanSensitive } = require("../scripts/inventoryEffectOperatorShared.js");
const { evaluateCutoverReadiness, OWNER_CUTOVER_DECISIONS } = await import("../lib/partMaster/cutoverReadiness.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const EVIDENCE_DIR = new URL("../../docs/audits/inv1-phase1/migration-readiness/", import.meta.url);
const fixturePath = new URL("./fixtures/part-master-migration-fixture.csv", import.meta.url);
const readEvidence = (name) => fs.readFileSync(new URL(name, EVIDENCE_DIR), "utf8");
const PACKAGE_FILES = [
  "run-metadata.json", "summary.json", "row-results.json", "conflicts.csv", "invalid-rows.csv",
  "cutover-readiness.json", "operator-attestation.md", "cutover-readiness-report.md",
  "sensitive-scan.txt", "checksums.sha256",
];
const APPROVED_REASON_CODES = new Set([
  "NEW_PART", "FIELDS_DIFFER", "IDENTICAL", "DUPLICATE_PART_ID_IN_FILE", "DUPLICATE_IPN_IN_FILE",
  "ALIAS_OWNED_BY_OTHER_PART", "TARGET_PART_INACTIVE", "IMMUTABLE_ID_MUTATION",
  "AMBIGUOUS_CREATE_VS_UPDATE", "MULTIPLE_MATCHES", "MALFORMED_IDENTIFIER", "UNKNOWN_UNIT",
  "DOMAIN_VALIDATION_FAILED", "MISSING_REQUIRED_FIELD",
]);
const CLEAN_INPUT = {
  counts: { CREATE: 3, UPDATE: 2, NO_CHANGE: 1, CONFLICT: 0, INVALID: 0 },
  reasonCounts: { NEW_PART: 3, FIELDS_DIFFER: 2, IDENTICAL: 1 },
  duplicateCount: 0,
  unresolvedDecisions: [],
  featureFlagOff: true,
  quantityScopeExcluded: true,
  historicalWorkOrdersUntouched: true,
  approvals: {
    createPopulationApproved: true, updatePopulationApproved: true, rollbackPointApproved: true,
    reconciliationMethodApproved: true, productionOperatorApproved: true,
    maintenanceWindowApprovedOrWaived: true, supplierItemInconsistenciesReviewed: true, rulesStateConfirmed: true,
  },
};

console.log("migrationEvidence.test.mjs");

await check("readiness: clean, fully-approved, decision-free input -> PASS on all 20 criteria", () => {
  const r = evaluateCutoverReadiness(CLEAN_INPUT);
  assert.equal(r.status, "PASS");
  assert.equal(r.criteria.length, 20);
  assert.ok(r.criteria.every((c) => c.status === "PASS"));
});
await check("readiness: every data violation blocks its criterion", () => {
  const cases = [
    [{ counts: { ...CLEAN_INPUT.counts, INVALID: 2 } }, "C1"],
    [{ reasonCounts: { ...CLEAN_INPUT.reasonCounts, DUPLICATE_PART_ID_IN_FILE: 1 } }, "C2"],
    [{ reasonCounts: { ...CLEAN_INPUT.reasonCounts, DUPLICATE_IPN_IN_FILE: 1 } }, "C3"],
    [{ reasonCounts: { ...CLEAN_INPUT.reasonCounts, MULTIPLE_MATCHES: 1 } }, "C4"],
    [{ reasonCounts: { ...CLEAN_INPUT.reasonCounts, ALIAS_OWNED_BY_OTHER_PART: 1 } }, "C5"],
    [{ reasonCounts: { ...CLEAN_INPUT.reasonCounts, UNKNOWN_UNIT: 1 } }, "C6"],
    [{ reasonCounts: { ...CLEAN_INPUT.reasonCounts, TARGET_PART_INACTIVE: 1 } }, "C7"],
    [{ reasonCounts: { ...CLEAN_INPUT.reasonCounts, IMMUTABLE_ID_MUTATION: 1 } }, "C8"],
  ];
  for (const [override, id] of cases) {
    const r = evaluateCutoverReadiness({ ...CLEAN_INPUT, ...override });
    assert.equal(r.status, "BLOCKED", id);
    assert.equal(r.criteria.find((c) => c.id === id)?.status, "BLOCKED", id);
  }
});
await check("readiness: unresolved Owner decisions alone cause BLOCKED (C20)", () => {
  const r = evaluateCutoverReadiness({ ...CLEAN_INPUT, unresolvedDecisions: ["D-M1"] });
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.criteria.find((c) => c.id === "C20")?.status, "BLOCKED");
});
await check("readiness: feature flag not verified OFF causes BLOCKED (C16)", () => {
  const r = evaluateCutoverReadiness({ ...CLEAN_INPUT, featureFlagOff: false });
  assert.equal(r.criteria.find((c) => c.id === "C16")?.status, "BLOCKED");
  assert.equal(r.status, "BLOCKED");
});
await check("readiness: any missing approval causes BLOCKED", () => {
  for (const key of Object.keys(CLEAN_INPUT.approvals)) {
    const r = evaluateCutoverReadiness({ ...CLEAN_INPUT, approvals: { ...CLEAN_INPUT.approvals, [key]: false } });
    assert.equal(r.status, "BLOCKED", key);
  }
});
await check("readiness: quantity/WO scope exclusions are hard criteria (C18/C19)", () => {
  assert.equal(evaluateCutoverReadiness({ ...CLEAN_INPUT, quantityScopeExcluded: false }).status, "BLOCKED");
  assert.equal(evaluateCutoverReadiness({ ...CLEAN_INPUT, historicalWorkOrdersUntouched: false }).status, "BLOCKED");
});
await check("Owner cutover decision register: D-M1..D-M7", () => {
  assert.deepEqual(OWNER_CUTOVER_DECISIONS.map((d) => d.id), ["D-M1", "D-M2", "D-M3", "D-M4", "D-M5", "D-M6", "D-M7"]);
});

await check("committed evidence package is complete (10 artifacts)", () => {
  for (const name of PACKAGE_FILES) {
    assert.ok(fs.existsSync(new URL(name, EVIDENCE_DIR)), `missing ${name}`);
  }
});
await check("checksums.sha256 covers all 9 sibling artifacts and every hash is valid", () => {
  const lines = readEvidence("checksums.sha256").trim().split("\n");
  const named = new Map(lines.map((l) => [l.slice(66), l.slice(0, 64)]));
  for (const name of PACKAGE_FILES.filter((n) => n !== "checksums.sha256")) {
    assert.ok(named.has(name), `checksum missing for ${name}`);
    assert.equal(named.get(name), sha256(readEvidence(name)), `checksum mismatch for ${name}`);
  }
});
await check("sensitive scan is CLEAN and re-scanning every artifact stays clean", () => {
  assert.ok(readEvidence("sensitive-scan.txt").startsWith("CLEAN"));
  for (const name of PACKAGE_FILES.filter((n) => n !== "sensitive-scan.txt" && n !== "checksums.sha256")) {
    assert.deepEqual(scanSensitive(readEvidence(name)), [], `sensitive finding in ${name}`);
  }
});
await check("run-metadata: DRY_RUN_ONLY, zero-write attestation, fixture hash, qty columns ignored", () => {
  const meta = JSON.parse(readEvidence("run-metadata.json"));
  assert.equal(meta.mode, "DRY_RUN_ONLY");
  assert.match(meta.zeroWriteAttestation, /no write-enabled mode/);
  assert.equal(meta.inputSha256, sha256(fs.readFileSync(fixturePath, "utf8")));
  assert.deepEqual(meta.ignoredInformationalColumns, ["qtyOnHand"]);
  assert.ok(meta.emulatorHost !== null, "evidence must have been generated against the emulator");
});
await check("classification totals and approved reason-code coverage", () => {
  const summary = JSON.parse(readEvidence("summary.json"));
  assert.deepEqual(summary.counts, { CREATE: 4, UPDATE: 1, NO_CHANGE: 1, CONFLICT: 6, INVALID: 5 });
  assert.equal(summary.duplicateCount, 2);
  assert.equal(summary.conflictCount, 6);
  const codes = Object.keys(summary.reasonCounts);
  for (const code of codes) assert.ok(APPROVED_REASON_CODES.has(code), `unapproved reason code ${code}`);
  // Every demonstrable code appears; the defensive AMBIGUOUS guard does not.
  assert.equal(codes.length, 13);
  assert.ok(!codes.includes("AMBIGUOUS_CREATE_VS_UPDATE"));
  const rows = JSON.parse(readEvidence("row-results.json"));
  assert.equal(rows.length, 17);
});
await check("readiness artifact: BLOCKED with all 7 Owner decisions unresolved; flag criterion PASS", () => {
  const readiness = JSON.parse(readEvidence("cutover-readiness.json"));
  assert.equal(readiness.status, "BLOCKED");
  assert.equal(readiness.runKind, "SYNTHETIC_FIXTURE_DEMONSTRATION");
  assert.equal(readiness.criteria.length, 20);
  const c20 = readiness.criteria.find((c) => c.id === "C20");
  assert.equal(c20.status, "BLOCKED");
  assert.deepEqual(readiness.unresolvedOwnerDecisions.map((d) => d.id), OWNER_CUTOVER_DECISIONS.map((d) => d.id));
  assert.equal(readiness.criteria.find((c) => c.id === "C16").status, "PASS"); // PART_MASTER_REFERENCE OFF at generation
  assert.ok(readEvidence("cutover-readiness-report.md").includes("## Readiness: BLOCKED"));
  assert.ok(readEvidence("operator-attestation.md").includes("Zero-write attestation"));
});
await check("fixture is fully synthetic: every well-formed identifier is MIGFIX-scoped", () => {
  const [, ...rows] = fs.readFileSync(fixturePath, "utf8").trim().split("\n");
  assert.equal(rows.length, 17);
  for (const row of rows) {
    const ipn = row.split(",")[0];
    assert.ok(/^migfix/i.test(ipn) || ipn === "bad id!!" || ipn === "", `non-synthetic identifier: ${ipn}`);
  }
});
await check("production prohibition: generator refuses without emulator host / with credentials", () => {
  const script = new URL("../scripts/generatePartMasterMigrationEvidence.js", import.meta.url);
  const env = { ...process.env };
  delete env.FIRESTORE_EMULATOR_HOST;
  delete env.FIREBASE_AUTH_EMULATOR_HOST;
  const noEmu = spawnSync(process.execPath, [fileURLToPath(script)], { encoding: "utf8", env });
  assert.equal(noEmu.status, 1);
  assert.match(noEmu.stderr, /PRODUCTION PROHIBITED/);
  const withCreds = spawnSync(process.execPath, [fileURLToPath(script)], {
    encoding: "utf8",
    env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: "/tmp/fake.json" },
  });
  assert.equal(withCreds.status, 1);
  assert.match(withCreds.stderr, /PRODUCTION PROHIBITED/);
});
await check("zero write surface: readiness module is pure; analyzer/CLI remain write-free", () => {
  const readinessSrc = fs.readFileSync(new URL("../src/partMaster/cutoverReadiness.ts", import.meta.url), "utf8");
  for (const bad of ['from "firebase', 'require("firebase', ".set(", ".doc(", "runTransaction", "WriteBatch", "httpsCallable"]) {
    assert.ok(!readinessSrc.includes(bad), `cutoverReadiness contains ${bad}`);
  }
  const gen = fs.readFileSync(new URL("../scripts/generatePartMasterMigrationEvidence.js", import.meta.url), "utf8");
  assert.ok(gen.includes("PRODUCTION PROHIBITED"));
  for (const bad of ["runTransaction", "WriteBatch", "BulkWriter", "recursiveDelete"]) {
    assert.ok(!gen.includes(bad), `generator contains ${bad}`);
  }
  // Feature flag: nothing in the PR 1.10 surface enables PART_MASTER_REFERENCE.
  assert.ok(!gen.includes('PART_MASTER_REFERENCE = "enabled"'));
  assert.ok(!gen.includes("PART_MASTER_REFERENCE='enabled'"));
  assert.equal(process.env.PART_MASTER_REFERENCE, undefined);
});
await check("deterministic rerun: fresh generation matches committed artifacts except timestamps", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "migfix-evidence-"));
  const script = new URL("../scripts/generatePartMasterMigrationEvidence.js", import.meta.url);
  const run = spawnSync(process.execPath, [fileURLToPath(script), "--output-dir", tmp], {
    encoding: "utf8", env: process.env,
  });
  assert.equal(run.status, 0, run.stderr);
  for (const name of ["summary.json", "row-results.json", "conflicts.csv", "invalid-rows.csv", "cutover-readiness.json"]) {
    assert.equal(fs.readFileSync(path.join(tmp, name), "utf8"), readEvidence(name), `${name} not deterministic`);
  }
  const fresh = JSON.parse(fs.readFileSync(path.join(tmp, "run-metadata.json"), "utf8"));
  const committed = JSON.parse(readEvidence("run-metadata.json"));
  for (const meta of [fresh, committed]) { delete meta.generatedAt; delete meta.emulatorHost; }
  assert.deepEqual(fresh, committed, "run-metadata differs beyond timestamp/host fields");
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\nmigrationEvidence: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
