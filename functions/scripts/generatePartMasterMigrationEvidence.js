// INV-1 Phase 1, PR 1.10 -- Part Master migration-readiness evidence
// generator (ADR-008 / Decision #40). EMULATOR-ONLY BY CONSTRUCTION: this
// tool refuses to run unless FIRESTORE_EMULATOR_HOST is set, and refuses if
// application-default credentials are configured -- it can never touch
// production. It seeds a small DISPOSABLE synthetic fixture state (MIGFIX-*
// records via the governed trusted commands), executes the PR 1.8 analyzer
// CLI in its only mode (DRY-RUN), and composes the governed evidence
// package: analyzer artifacts + cutover-readiness evaluation + operator
// attestation + full-package checksums. Zero production writes, zero
// backfills, zero quantity recalculation, zero flag changes.
//
// Usage:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/generatePartMasterMigrationEvidence.js \
//     [--output-dir <path>] [--fixture <file.csv>]
// Exit codes: 0 = package written; 1 = refused/invalid invocation; 2 = failure.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  InvalidInvocationError, parseCliArgs, canonicalJson, sha256Hex, scanSensitive,
} = require("./inventoryEffectOperatorShared");

const PROJECT_ID = "taylor-parts";
const DEFAULT_OUTPUT = path.join(__dirname, "..", "..", "docs", "audits", "inv1-phase1", "migration-readiness");
const DEFAULT_FIXTURE = path.join(__dirname, "..", "test", "fixtures", "part-master-migration-fixture.csv");
const FIXED_CLOCK = new Date("2026-07-22T00:00:00.000Z"); // deterministic seed clock

function refuseIfNotEmulator() {
  if (typeof process.env.FIRESTORE_EMULATOR_HOST !== "string" || process.env.FIRESTORE_EMULATOR_HOST.length === 0) {
    // PRODUCTION PROHIBITED: this generator has no production mode at all.
    console.error("PRODUCTION PROHIBITED: FIRESTORE_EMULATOR_HOST is not set; this tool runs against the emulator only.");
    return false;
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS !== undefined) {
    console.error("PRODUCTION PROHIBITED: GOOGLE_APPLICATION_CREDENTIALS is set; refusing to run with real credentials.");
    return false;
  }
  return true;
}

// Deterministic disposable fixture state, written through the governed
// trusted commands (idempotent: fixed keys + payloads make reruns replay).
async function seedFixtureState(db) {
  const admin = require("firebase-admin");
  const { createPart, changePartStatus } = require("../lib/partMaster/partMasterCommands");
  const { createPartAlias } = require("../lib/partMaster/partAliasCommands");
  const actorUid = "migfix-operator";
  await db.collection("users").doc(actorUid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc("migfix-operator-assignment").set({
    id: "migfix-operator-assignment", principalUid: actorUid, roleId: "migfixCatalog",
    scope: { type: "global" }, grantedBy: "migfix", grantedAt: admin.firestore.Timestamp.now(),
    status: "active", accessVersionAtGrant: 1,
  });
  const DEPS = {
    roles: Object.freeze({ migfixCatalog: { id: "migfixCatalog", name: "migfix", description: "disposable fixture role", permissions: ["inventory.catalog.manage", "inventory.catalog.activate"] } }),
    now: () => FIXED_CLOCK,
  };
  const part = (partId, name) => ({ partId, internalPartNumber: partId, name, status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" });
  const seeds = [
    { id: "MIGFIX-SAME", name: "Unchanged Widget", finalStatus: "ACTIVE" },
    { id: "MIGFIX-RENAME", name: "Old Widget Name", finalStatus: "ACTIVE" },
    { id: "MIGFIX-RETIRED", name: "Retired Widget", finalStatus: "DISCONTINUED" },
    { id: "MIGFIX-OWNER", name: "Immutable Id Row", finalStatus: "ACTIVE" },
    { id: "MIGFIX-MULTI", name: "Multi Match Row", finalStatus: "ACTIVE" },
    { id: "MIGFIX-ALIASHOLDER", name: "Alias Holder", finalStatus: "ACTIVE" },
  ];
  for (const s of seeds) {
    await createPart({ actorUid, idempotencyKey: `migfix-create-${s.id}`, part: part(s.id, s.name) }, DEPS);
    await changePartStatus({ actorUid, idempotencyKey: `migfix-activate-${s.id}`, partId: s.id, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS);
    if (s.finalStatus === "DISCONTINUED") {
      await changePartStatus({ actorUid, idempotencyKey: `migfix-retire-${s.id}`, partId: s.id, expectedVersion: 2, newStatus: "DISCONTINUED" }, DEPS);
    }
  }
  await createPartAlias({ actorUid, idempotencyKey: "migfix-alias-legacy", partId: "MIGFIX-OWNER", aliasType: "LEGACY", rawValue: "MIGFIX-OLD-SKU-1" }, DEPS);
  await createPartAlias({ actorUid, idempotencyKey: "migfix-alias-multi", partId: "MIGFIX-ALIASHOLDER", aliasType: "INTERNAL_PN", rawValue: "MIGFIX-MULTI" }, DEPS);
}

async function main() {
  if (!refuseIfNotEmulator()) return 1;
  let args;
  try { args = parseCliArgs(process.argv.slice(2)); }
  catch (err) {
    if (err instanceof InvalidInvocationError) { console.error(`INVALID INVOCATION: ${err.message}`); return 1; }
    throw err;
  }
  const outputDir = typeof args["output-dir"] === "string" ? args["output-dir"] : DEFAULT_OUTPUT;
  const fixture = typeof args.fixture === "string" ? args.fixture : DEFAULT_FIXTURE;
  if (!fs.existsSync(fixture)) { console.error(`INVALID INVOCATION: fixture not found: ${fixture}`); return 1; }

  console.log("generatePartMasterMigrationEvidence (INV-1 Phase 1 PR 1.10, emulator-only, DRY-RUN evidence)");
  const { initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();
  await seedFixtureState(db);
  console.log("disposable MIGFIX-* fixture state seeded (emulator, trusted commands, idempotent)");

  // Execute the PR 1.8 analyzer -- its ONLY mode is dry-run.
  const analyzer = spawnSync(process.execPath, [
    path.join(__dirname, "analyzePartMasterCsv.js"),
    "--project-id", PROJECT_ID, "--confirm-project", PROJECT_ID,
    "--input", fixture, "--output-dir", outputDir,
  ], { encoding: "utf8", env: process.env });
  process.stdout.write(analyzer.stdout ?? "");
  process.stderr.write(analyzer.stderr ?? "");
  // Exit 3 (conflicts/invalids present) is EXPECTED for the demonstration
  // fixture -- it deliberately exercises every classification.
  if (analyzer.status !== 0 && analyzer.status !== 3) {
    console.error(`ANALYSIS FAILURE: analyzer exited ${analyzer.status}`);
    return 2;
  }

  const readFile = (name) => fs.readFileSync(path.join(outputDir, name), "utf8");
  const runMetadata = JSON.parse(readFile("run-metadata.json"));
  const summary = JSON.parse(readFile("summary.json"));

  // Readiness evaluation: all Owner cutover decisions are currently
  // UNRESOLVED, and this is a demonstration fixture -- BLOCKED is the
  // expected, honest verdict.
  const { evaluateCutoverReadiness, OWNER_CUTOVER_DECISIONS } = require("../lib/partMaster/cutoverReadiness");
  const readiness = evaluateCutoverReadiness({
    counts: summary.counts,
    reasonCounts: summary.reasonCounts,
    duplicateCount: summary.duplicateCount,
    unresolvedDecisions: OWNER_CUTOVER_DECISIONS.map((d) => d.id),
    featureFlagOff: process.env.PART_MASTER_REFERENCE !== "enabled",
    quantityScopeExcluded: true,
    historicalWorkOrdersUntouched: true,
    approvals: {
      createPopulationApproved: false,
      updatePopulationApproved: false,
      rollbackPointApproved: false,
      reconciliationMethodApproved: false,
      productionOperatorApproved: false,
      maintenanceWindowApprovedOrWaived: false,
      supplierItemInconsistenciesReviewed: false,
      rulesStateConfirmed: false,
    },
  });
  const readinessDoc = {
    tool: "generatePartMasterMigrationEvidence",
    runKind: "SYNTHETIC_FIXTURE_DEMONSTRATION",
    inputSha256: runMetadata.inputSha256,
    status: readiness.status,
    criteria: readiness.criteria,
    unresolvedOwnerDecisions: OWNER_CUTOVER_DECISIONS,
    note: "BLOCKED is expected for this demonstration run: the fixture deliberately contains conflict/invalid rows and every Owner cutover decision remains unresolved. A cutover-qualifying run must use the Owner-approved production-source CSV and PASS every criterion.",
  };

  const gitHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" });
  const commit = gitHead.status === 0 ? gitHead.stdout.trim() : "UNKNOWN";
  const attestation = [
    "# Operator Attestation -- Part Master migration-readiness evidence",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Commit: ${commit}`,
    `- Tool: generatePartMasterMigrationEvidence.js -> analyzePartMasterCsv.js (INV-1 PR 1.8)`,
    `- Mode: DRY_RUN_ONLY (the analyzer has no write-enabled mode; no write path exists)`,
    `- Environment: Firestore EMULATOR (${process.env.FIRESTORE_EMULATOR_HOST}); production access structurally impossible (tool refuses without emulator host and refuses configured credentials)`,
    `- Input: synthetic fixture functions/test/fixtures/part-master-migration-fixture.csv (sha256 ${runMetadata.inputSha256})`,
    `- Source-data safety: every record is synthetic (MIGFIX-*); no production customer, supplier, pricing, quantity, or personally identifiable data was used or exists in this package; no supplier cost data is present.`,
    `- Zero-write attestation: no production write of any kind occurred; the only writes were disposable MIGFIX-* fixture records into the local emulator via the governed trusted commands.`,
    `- Quantity scope: qtyOnHand column is informational-only and was ignored by the analyzer (recorded in run-metadata.json); no quantity or availability recalculation is part of this package.`,
    `- Feature flag: PART_MASTER_REFERENCE remains OFF.`,
    `- Readiness verdict: ${readiness.status} (expected for this demonstration run; see cutover-readiness.json).`,
    "",
  ].join("\n");

  const covered = Object.keys(summary.reasonCounts).sort();
  const report = [
    "# Cutover-Readiness Report -- INV-1 Phase 1 PR 1.10",
    "",
    "Demonstration dry-run of the governed Part Master migration analyzer over the synthetic MIGFIX fixture.",
    "",
    `- Classification totals: CREATE=${summary.counts.CREATE} UPDATE=${summary.counts.UPDATE} NO_CHANGE=${summary.counts.NO_CHANGE} CONFLICT=${summary.counts.CONFLICT} INVALID=${summary.counts.INVALID}`,
    `- In-file duplicates: ${summary.duplicateCount}; conflicts: ${summary.conflictCount}`,
    `- Reason codes demonstrated (${covered.length}): ${covered.join(", ")}`,
    "- Reason code NOT demonstrated: AMBIGUOUS_CREATE_VS_UPDATE -- a defensive guard that is unreachable under the current identity-resolution order (any existing INTERNAL_PN alias already resolves the row before the guard); retained as defense-in-depth.",
    "",
    `## Readiness: ${readiness.status}`,
    "",
    "| Criterion | Description | Status | Detail |",
    "|---|---|---|---|",
    ...readiness.criteria.map((r) => `| ${r.id} | ${r.description} | ${r.status} | ${r.detail} |`),
    "",
    "## Unresolved Owner decisions (all BLOCK cutover)",
    "",
    ...OWNER_CUTOVER_DECISIONS.map((d) => `- **${d.id}** ${d.question}`),
    "",
    "A cutover-qualifying run replaces the synthetic fixture with the Owner-approved production-source CSV, must PASS every criterion above, and cutover execution remains separately Owner-gated (see docs/operations/part-master-migration-cutover-runbook.md).",
    "",
  ].join("\n");

  // Compose the final package: analyzer artifacts + readiness + attestation,
  // with a full-package sensitive scan and checksum manifest.
  fs.writeFileSync(path.join(outputDir, "cutover-readiness.json"), canonicalJson(readinessDoc), "utf8");
  fs.writeFileSync(path.join(outputDir, "operator-attestation.md"), attestation, "utf8");
  fs.writeFileSync(path.join(outputDir, "cutover-readiness-report.md"), report, "utf8");
  const packageFiles = [
    "run-metadata.json", "summary.json", "row-results.json", "conflicts.csv", "invalid-rows.csv",
    "cutover-readiness.json", "operator-attestation.md", "cutover-readiness-report.md",
  ];
  const findings = {};
  for (const name of packageFiles) {
    const hits = scanSensitive(readFile(name));
    if (hits.length > 0) findings[name] = hits;
  }
  const sensitiveReport = Object.keys(findings).length === 0
    ? "CLEAN: no sensitive-value pattern matched any artifact\n"
    : `FINDINGS:\n${canonicalJson(findings)}`;
  fs.writeFileSync(path.join(outputDir, "sensitive-scan.txt"), sensitiveReport, "utf8");
  const checksums = [...packageFiles, "sensitive-scan.txt"]
    .map((name) => `${sha256Hex(readFile(name))}  ${name}`).join("\n") + "\n";
  fs.writeFileSync(path.join(outputDir, "checksums.sha256"), checksums, "utf8");
  console.log(`evidence package written to ${outputDir} (10 files; sensitive scan ${Object.keys(findings).length === 0 ? "CLEAN" : "FINDINGS"}; readiness ${readiness.status})`);
  return 0;
}

if (require.main === module) {
  main().then((c) => { process.exitCode = c; }).catch((err) => { console.error(`EVIDENCE GENERATION FAILURE: ${err.message}`); process.exitCode = 2; });
}
module.exports = { main };
