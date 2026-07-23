// INV-1 Post-Phase-1 -- production dry-run invocation adaptation tests.
// NO emulator required and NO production connection is ever made: guard
// tests are pure, CLI tests exercise only refusal paths (guards precede any
// Firebase initialization), and evidence-composition tests use an injected
// fake analysis result.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const {
  validateInvocation, composeEvidencePackage, parseDecisions,
  EXPECTED_DECISIONS, EVIDENCE_FILES, APPROVED_PROJECT_ID,
} = require("../scripts/runPartMasterProductionDryRun.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SCRIPT = fileURLToPath(new URL("../scripts/runPartMasterProductionDryRun.js", import.meta.url));
const OUTSIDE = path.join(os.tmpdir(), "migsrc-outside-repo");
const DECISIONS_OK = "D-M1:B,D-M2:B,D-M3:A,D-M4:B,D-M5:B,D-M6:B,D-M7:C";
const HASH = "a".repeat(64);
const VALID = Object.freeze({
  projectId: "taylor-parts", confirmProject: "taylor-parts",
  inputPathResolved: path.join(OUTSIDE, "approved.csv"), repoRoot: REPO_ROOT,
  outputDirResolved: path.join(OUTSIDE, "evidence-run-1"), outputDirNonEmpty: false,
  declaredSha256: HASH, actualSha256: HASH,
  commitDeclared: "ff00a09", commitActual: "ff00a090ff033c83b49d48d8b599b55c6a5e0eed",
  snapshotDate: "2026-07-23", operator: "Owner",
  decisions: parseDecisions(DECISIONS_OK), ackDryRun: true, ackProductionRead: true,
  emulatorHost: undefined, featureFlagValue: undefined,
});
const refusalsFor = (override) => validateInvocation({ ...VALID, ...override });

console.log("productionDryRun.test.mjs");

await check("valid invocation facts produce zero refusals", () => {
  assert.deepEqual(refusalsFor({}), []);
});
await check("project confirmation: alternate/mismatched projects refuse", () => {
  assert.ok(refusalsFor({ projectId: "other-project", confirmProject: "other-project" }).length >= 2);
  assert.ok(refusalsFor({ confirmProject: "taylor-parts-staging" }).some((r) => r.includes("--confirm-project")));
  assert.equal(APPROVED_PROJECT_ID, "taylor-parts");
});
await check("input hash: mismatch refuses and cites authorization voiding; match passes", () => {
  const r = refusalsFor({ actualSha256: "b".repeat(64) });
  assert.equal(r.length, 1);
  assert.match(r[0], /voids the authorization/);
  assert.ok(refusalsFor({ declaredSha256: "not-a-hash" }).length === 1);
});
await check("source CSV inside the repository refuses", () => {
  const r = refusalsFor({ inputPathResolved: path.join(REPO_ROOT, "functions", "sneaky.csv") });
  assert.equal(r.length, 1);
  assert.match(r[0], /OUTSIDE the repository/);
});
await check("source CSV inside the evidence output directory refuses", () => {
  const r = refusalsFor({ inputPathResolved: path.join(VALID.outputDirResolved, "approved.csv") });
  assert.equal(r.length, 1);
  assert.match(r[0], /never contain the source file/);
});
await check("existing non-empty evidence directory refuses (no overwrite)", () => {
  const r = refusalsFor({ outputDirNonEmpty: true });
  assert.equal(r.length, 1);
  assert.match(r[0], /never overwritten/);
});
await check("Decision #42 set: missing, incomplete, or altered decisions refuse", () => {
  assert.ok(refusalsFor({ decisions: null }).length === 1);
  assert.ok(refusalsFor({ decisions: parseDecisions("D-M1:B,D-M2:B,D-M3:A,D-M4:B,D-M5:B,D-M6:B") })[0].includes("Decision #42"));
  assert.ok(refusalsFor({ decisions: parseDecisions(DECISIONS_OK.replace("D-M3:A", "D-M3:B")) }).length === 1);
  assert.deepEqual(EXPECTED_DECISIONS, { "D-M1": "B", "D-M2": "B", "D-M3": "A", "D-M4": "B", "D-M5": "B", "D-M6": "B", "D-M7": "C" });
});
await check("acknowledgements, operator, snapshot date, commit pin all required", () => {
  assert.ok(refusalsFor({ ackDryRun: false })[0].includes("--acknowledge-dry-run"));
  assert.ok(refusalsFor({ ackProductionRead: false })[0].includes("--acknowledge-production-read"));
  assert.ok(refusalsFor({ operator: "" }).length === 1);
  assert.ok(refusalsFor({ snapshotDate: "23/07/2026" }).length === 1);
  assert.ok(refusalsFor({ commitDeclared: "1234567", commitActual: "deadbeef00" })[0].includes("does not match"));
});
await check("emulator/production ambiguity refuses; feature flag must be OFF", () => {
  assert.ok(refusalsFor({ emulatorHost: "127.0.0.1:8080" })[0].includes("ambiguously"));
  assert.ok(refusalsFor({ featureFlagValue: "enabled" })[0].includes("PART_MASTER_REFERENCE"));
});
await check("refusals accumulate (all reasons reported, not first-only)", () => {
  const r = refusalsFor({ projectId: "x", confirmProject: "x", ackDryRun: false, decisions: null });
  assert.ok(r.length >= 4);
});

const FAKE_ANALYSIS = Object.freeze({
  rows: [
    { rowNumber: 1, normalizedLegacyId: "P-1", proposedPartId: "P-1", classification: "CREATE", reasonCode: "NEW_PART", reason: "new", currentSummary: null, proposedSummary: "p", aliasImplications: [], unitCompatible: true, informationalQuantities: {} },
    { rowNumber: 2, normalizedLegacyId: "P-2", proposedPartId: "P-2", classification: "CONFLICT", reasonCode: "TARGET_PART_INACTIVE", reason: "inactive", currentSummary: null, proposedSummary: null, aliasImplications: [], unitCompatible: false, informationalQuantities: {} },
  ],
  counts: { CREATE: 1, UPDATE: 0, NO_CHANGE: 0, CONFLICT: 1, INVALID: 0 },
  reasonCounts: { NEW_PART: 1, TARGET_PART_INACTIVE: 1 },
  duplicateCount: 0,
  conflictCount: 1,
  ignoredInformationalColumns: ["qtyOnHand"],
});

await check("evidence composition: complete 10-artifact package with valid checksums, CLEAN scan", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "proddry-evidence-"));
  const result = composeEvidencePackage(tmp, VALID, FAKE_ANALYSIS);
  for (const name of EVIDENCE_FILES) assert.ok(fs.existsSync(path.join(tmp, name)), `missing ${name}`);
  const lines = fs.readFileSync(path.join(tmp, "checksums.sha256"), "utf8").trim().split("\n");
  assert.equal(lines.length, EVIDENCE_FILES.length - 1);
  for (const line of lines) {
    const [hash, name] = [line.slice(0, 64), line.slice(66)];
    assert.equal(hash, sha256(fs.readFileSync(path.join(tmp, name), "utf8")), name);
  }
  assert.ok(fs.readFileSync(path.join(tmp, "sensitive-scan.txt"), "utf8").startsWith("CLEAN"));
  assert.equal(result.sensitiveClean, true);
  // Source CSV is not copied into evidence:
  assert.ok(!fs.existsSync(path.join(tmp, "approved.csv")));
  fs.rmSync(tmp, { recursive: true, force: true });
});
await check("run metadata records the full authorization contract", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "proddry-meta-"));
  composeEvidencePackage(tmp, VALID, FAKE_ANALYSIS);
  const meta = JSON.parse(fs.readFileSync(path.join(tmp, "run-metadata.json"), "utf8"));
  assert.equal(meta.runKind, "PRODUCTION_SOURCE_DRY_RUN");
  assert.equal(meta.mode, "DRY_RUN_ONLY");
  assert.match(meta.zeroWriteAttestation, /no write-enabled mode/);
  assert.equal(meta.sourceCsvExcludedFromEvidence, true);
  assert.equal(meta.projectId, "taylor-parts");
  assert.equal(meta.approvedInputSha256, HASH);
  assert.equal(meta.repositoryCommit, VALID.commitActual);
  assert.equal(meta.sourceSnapshotDate, "2026-07-23");
  assert.equal(meta.operator, "Owner");
  assert.ok(meta.reviewerRoles.technicalReviewer.length > 0 && meta.reviewerRoles.finalApprover.length > 0);
  assert.deepEqual(meta.resolvedDecisions.set, EXPECTED_DECISIONS);
  fs.rmSync(tmp, { recursive: true, force: true });
});
await check("readiness artifact: C20 PASS via Decision #42; execution-gate approvals honestly pending", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "proddry-ready-"));
  composeEvidencePackage(tmp, VALID, FAKE_ANALYSIS);
  const r = JSON.parse(fs.readFileSync(path.join(tmp, "cutover-readiness.json"), "utf8"));
  assert.equal(r.criteria.find((c) => c.id === "C20").status, "PASS");
  assert.equal(r.criteria.find((c) => c.id === "C16").status, "PASS");
  assert.equal(r.criteria.find((c) => c.id === "C10").status, "BLOCKED"); // CREATE approval belongs to its own gate
  assert.equal(r.criteria.find((c) => c.id === "C7").status, "BLOCKED"); // fake analysis has an inactive-target conflict
  assert.equal(r.status, "BLOCKED");
  assert.match(r.note, /per-gate readiness rule/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
await check("deterministic evidence: data artifacts byte-identical across reruns", () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "proddry-det-a-"));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "proddry-det-b-"));
  composeEvidencePackage(a, VALID, FAKE_ANALYSIS);
  composeEvidencePackage(b, VALID, FAKE_ANALYSIS);
  for (const name of ["summary.json", "row-results.json", "conflicts.csv", "invalid-rows.csv", "cutover-readiness.json"]) {
    assert.equal(fs.readFileSync(path.join(a, name), "utf8"), fs.readFileSync(path.join(b, name), "utf8"), name);
  }
  for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true });
});

await check("zero write surface: no mutation command, seeding, or write API in the tool", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  for (const bad of ["partMasterCommands", "partAliasCommands", "partSupplierItems", "seedFixtureState", "createPart", "createPartAlias", "changePartStatus", "runTransaction", "WriteBatch", "BulkWriter", "recursiveDelete", ".set(", ".update(", ".delete(", ".add(", "httpsCallable", "firebase-admin/auth", "firebase-admin/storage"]) {
    assert.ok(!src.includes(bad), `tool contains ${bad}`);
  }
  assert.ok(src.includes("zero-write") || src.includes("ZERO WRITES"));
});
await check("CLI refuses bare invocation without connecting (exit 1, refusal text)", () => {
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...process.env } });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /REFUSED/);
  assert.match(run.stderr, /no connection was made/);
});
await check("CLI refuses production args while emulator env is set (ambiguity, exit 1)", () => {
  fs.mkdirSync(OUTSIDE, { recursive: true });
  const input = path.join(OUTSIDE, "cli-approved.csv");
  fs.writeFileSync(input, "internalPartNumber,name,controlType,stockingClass,stockingUnit\n", "utf8");
  const hash = sha256(fs.readFileSync(input, "utf8"));
  const out = path.join(OUTSIDE, `cli-evidence-${Date.now()}`);
  const run = spawnSync(process.execPath, [SCRIPT,
    "--project-id", "taylor-parts", "--confirm-project", "taylor-parts",
    "--input", input, "--output-dir", out, "--input-sha256", hash,
    "--commit", "0000000", "--snapshot-date", "2026-07-23", "--operator", "Owner",
    "--resolved-decisions", DECISIONS_OK, "--acknowledge-dry-run", "--acknowledge-production-read",
  ], { encoding: "utf8", env: { ...process.env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" } });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /ambiguously configured/);
  assert.ok(!fs.existsSync(out)); // nothing written on refusal
});
await check("original demonstration path and Phase 1 evidence remain unchanged", () => {
  const gen = fs.readFileSync(new URL("../scripts/generatePartMasterMigrationEvidence.js", import.meta.url), "utf8");
  assert.ok(gen.includes("OWNER_CUTOVER_DECISIONS.map((d) => d.id)")); // still all-unresolved by design
  assert.ok(!gen.includes("runPartMasterProductionDryRun"));
  const dir = new URL("../../docs/audits/inv1-phase1/migration-readiness/", import.meta.url);
  const lines = fs.readFileSync(new URL("checksums.sha256", dir), "utf8").trim().split("\n");
  for (const line of lines) {
    assert.equal(line.slice(0, 64), sha256(fs.readFileSync(new URL(line.slice(66), dir), "utf8")), line.slice(66));
  }
  const committed = JSON.parse(fs.readFileSync(new URL("cutover-readiness.json", dir), "utf8"));
  assert.equal(committed.status, "BLOCKED");
  assert.equal(committed.unresolvedOwnerDecisions.length, 7);
});

console.log(`\nproductionDryRun: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
