// INV-1 Post-Phase-1 -- governed READ-ONLY production dry-run invocation
// for the Part Master migration analysis (Decision #42; production-source
// dry-run authorization APPROVED; execution itself remains a separate
// Owner gate that pins commit + snapshot date + CSV hash).
//
// DRY-RUN ONLY, ZERO WRITES: this tool reuses the PR 1.8 analysis core
// (classification-only) and the Phase 1 readiness authority. It imports no
// trusted mutation command, no Firestore write API, no Auth/Storage/
// deployment surface, and seeds nothing. Production access is limited to
// the reads the analysis already requires (parts + part_aliases document
// gets). Tool-level zero-write enforcement is mandatory and independent of
// operator credentials -- application-default credentials never imply
// write authorization in this tool, and no infrastructure-level read-only
// IAM is assumed or claimed.
//
// Usage (all flags required; see the cutover runbook for the operator
// sequence -- documented, not executed, until the execution gate):
//   node scripts/runPartMasterProductionDryRun.js \
//     --project-id taylor-parts --confirm-project taylor-parts \
//     --input <absolute path OUTSIDE the repository> \
//     --output-dir <new evidence dir> \
//     --input-sha256 <owner-approved hash> \
//     --commit <pinned repository commit (must equal HEAD)> \
//     --snapshot-date <YYYY-MM-DD source snapshot identifier> \
//     --operator "<name/role>" \
//     --resolved-decisions D-M1:B,D-M2:B,D-M3:A,D-M4:B,D-M5:B,D-M6:B,D-M7:C \
//     --acknowledge-dry-run --acknowledge-production-read
// Exit codes: 0 = evidence written (no conflicts/invalids); 3 = evidence
// written with conflicts/invalids; 1 = REFUSED/invalid invocation;
// 2 = technical failure.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  InvalidInvocationError, parseCliArgs, canonicalJson, sha256Hex, scanSensitive,
} = require("./inventoryEffectOperatorShared");

const APPROVED_PROJECT_ID = "taylor-parts"; // fixed by the authorization record
// Decision #42 resolved set -- the ONLY accepted readiness input.
const EXPECTED_DECISIONS = Object.freeze({
  "D-M1": "B", "D-M2": "B", "D-M3": "A", "D-M4": "B", "D-M5": "B", "D-M6": "B", "D-M7": "C",
});
const EVIDENCE_FILES = Object.freeze([
  "run-metadata.json", "summary.json", "row-results.json", "conflicts.csv", "invalid-rows.csv",
  "cutover-readiness.json", "cutover-readiness-report.md", "operator-attestation.md",
  "sensitive-scan.txt", "checksums.sha256",
]);
const REVIEWER_ROLES = Object.freeze({
  technicalReviewer: "ChatGPT (architecture review)",
  evidenceVerificationReviewer: "Claude Code Inventory session",
  finalApprover: "Owner",
});

function parseDecisions(raw) {
  if (typeof raw !== "string") return null;
  const out = {};
  for (const pair of raw.split(",")) {
    const [id, val] = pair.split(":").map((s) => (s ?? "").trim());
    if (!id || !val) return null;
    out[id] = val;
  }
  return out;
}

/** Pure invocation validation. Returns the FULL list of refusal reasons
 * (empty array = proceed). Every fact is passed in -- no I/O here. */
function validateInvocation(facts) {
  const refusals = [];
  const {
    projectId, confirmProject, inputPathResolved, repoRoot, outputDirResolved,
    outputDirNonEmpty, declaredSha256, actualSha256, commitDeclared, commitActual,
    snapshotDate, operator, decisions, ackDryRun, ackProductionRead,
    emulatorHost, featureFlagValue,
  } = facts;
  if (projectId !== APPROVED_PROJECT_ID) refusals.push(`REFUSED: --project-id must be exactly "${APPROVED_PROJECT_ID}" (authorization record); got "${projectId}"`);
  if (confirmProject !== APPROVED_PROJECT_ID) refusals.push(`REFUSED: --confirm-project must be exactly "${APPROVED_PROJECT_ID}"; got "${confirmProject}"`);
  if (projectId !== confirmProject) refusals.push("REFUSED: --project-id and --confirm-project do not match exactly");
  if (typeof inputPathResolved !== "string" || inputPathResolved.length === 0) {
    refusals.push("REFUSED: --input is required");
  } else if (typeof repoRoot === "string" && (inputPathResolved === repoRoot || inputPathResolved.startsWith(repoRoot + path.sep))) {
    refusals.push("REFUSED: the source CSV must live OUTSIDE the repository (custody convention); it is never committed");
  }
  if (typeof outputDirResolved !== "string" || outputDirResolved.length === 0) {
    refusals.push("REFUSED: --output-dir is required");
  } else {
    if (typeof inputPathResolved === "string" && inputPathResolved.startsWith(outputDirResolved + path.sep)) {
      refusals.push("REFUSED: the source CSV would be inside the evidence output directory; evidence must never contain the source file");
    }
    if (outputDirNonEmpty === true) refusals.push("REFUSED: --output-dir already exists and is not empty; evidence is never overwritten -- choose a fresh run directory");
  }
  if (typeof declaredSha256 !== "string" || !/^[0-9a-f]{64}$/.test(declaredSha256)) {
    refusals.push("REFUSED: --input-sha256 (the Owner-approved hash) is required as 64 lowercase hex chars");
  } else if (typeof actualSha256 === "string" && declaredSha256 !== actualSha256) {
    refusals.push(`REFUSED: input hash mismatch -- approved ${declaredSha256} but the file hashes to ${actualSha256}; any modification voids the authorization`);
  }
  if (typeof commitDeclared !== "string" || commitDeclared.length < 7) {
    refusals.push("REFUSED: --commit (the pinned repository commit) is required");
  } else if (typeof commitActual === "string" && !commitActual.startsWith(commitDeclared) && !commitDeclared.startsWith(commitActual)) {
    refusals.push(`REFUSED: pinned commit ${commitDeclared} does not match the checked-out HEAD ${commitActual}`);
  }
  if (typeof snapshotDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    refusals.push("REFUSED: --snapshot-date is required as YYYY-MM-DD (source snapshot identifier)");
  }
  if (typeof operator !== "string" || operator.trim().length === 0) {
    refusals.push("REFUSED: --operator is required (approved operator per the authorization record)");
  }
  if (decisions === null || typeof decisions !== "object") {
    refusals.push("REFUSED: --resolved-decisions is required as D-M1:B,...,D-M7:C (Decision #42)");
  } else {
    const ids = Object.keys(EXPECTED_DECISIONS);
    const supplied = Object.keys(decisions);
    if (supplied.length !== ids.length || ids.some((id) => decisions[id] !== EXPECTED_DECISIONS[id])) {
      refusals.push(`REFUSED: --resolved-decisions must be exactly the Decision #42 set (${ids.map((i) => `${i}:${EXPECTED_DECISIONS[i]}`).join(",")}); an incomplete or different set is not authorized`);
    }
  }
  if (ackDryRun !== true) refusals.push("REFUSED: --acknowledge-dry-run is required (this tool has no write mode)");
  if (ackProductionRead !== true) refusals.push("REFUSED: --acknowledge-production-read is required (explicit read-only production acknowledgement)");
  if (typeof emulatorHost === "string" && emulatorHost.length > 0) {
    refusals.push("REFUSED: FIRESTORE_EMULATOR_HOST is set -- emulator and production modes are ambiguously configured; unset it (the emulator demonstration path is generatePartMasterMigrationEvidence.js)");
  }
  if (featureFlagValue === "enabled") refusals.push("REFUSED: PART_MASTER_REFERENCE is enabled; the flag must remain OFF (Decision #42 D-M6)");
  return refusals;
}

function buildRunMetadata(facts, analysis) {
  return {
    tool: "runPartMasterProductionDryRun",
    runKind: "PRODUCTION_SOURCE_DRY_RUN",
    mode: "DRY_RUN_ONLY",
    zeroWriteAttestation:
      "this tool has no write-enabled mode; no Firestore/Auth/Storage/Functions write API is imported or invoked; no trusted mutation command is imported; no fixture is seeded; operator credentials never imply write authorization in this tool",
    sourceCsvExcludedFromEvidence: true,
    projectId: APPROVED_PROJECT_ID,
    emulatorHost: null,
    approvedInputSha256: facts.declaredSha256,
    repositoryCommit: facts.commitActual ?? facts.commitDeclared,
    sourceSnapshotDate: facts.snapshotDate,
    operator: facts.operator,
    reviewerRoles: REVIEWER_ROLES,
    resolvedDecisions: { authority: "DECISIONS.md #42", set: EXPECTED_DECISIONS },
    generatedAt: new Date().toISOString(),
    rowCounts: analysis.counts,
    reasonCounts: analysis.reasonCounts,
    duplicateCount: analysis.duplicateCount,
    conflictCount: analysis.conflictCount,
    ignoredInformationalColumns: analysis.ignoredInformationalColumns,
  };
}

// Composes the standard 10-artifact package. Pure w.r.t. inputs + outputDir.
function composeEvidencePackage(outputDir, facts, analysis) {
  const { toCsvLines } = require("./analyzePartMasterCsv");
  const { evaluateCutoverReadiness } = require("../lib/partMaster/cutoverReadiness");
  fs.mkdirSync(outputDir, { recursive: true });
  const runMetadata = buildRunMetadata(facts, analysis);
  const readiness = evaluateCutoverReadiness({
    counts: analysis.counts,
    reasonCounts: analysis.reasonCounts,
    duplicateCount: analysis.duplicateCount,
    unresolvedDecisions: [], // Decision #42: all seven resolved (validated above)
    featureFlagOff: facts.featureFlagValue !== "enabled",
    quantityScopeExcluded: true,
    historicalWorkOrdersUntouched: true,
    // Population/operational approvals belong to the LATER execution gates
    // (per-gate readiness rule, Decision #42) -- honestly pending here:
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
    tool: "runPartMasterProductionDryRun",
    runKind: "PRODUCTION_SOURCE_DRY_RUN",
    inputSha256: facts.declaredSha256,
    status: readiness.status,
    criteria: readiness.criteria,
    resolvedDecisions: { authority: "DECISIONS.md #42", set: EXPECTED_DECISIONS },
    note: "C20 evaluates against the Decision #42 resolved set. Population/operational approval criteria (C9-C17) are evaluated at their own later execution gates per the per-gate readiness rule; they are recorded pending here, never implied by this dry run.",
  };
  const conflictRows = analysis.rows.filter((r) => r.classification === "CONFLICT");
  const invalidRows = analysis.rows.filter((r) => r.classification === "INVALID");
  const csvCols = ["rowNumber", "normalizedLegacyId", "proposedPartId", "classification", "reasonCode", "reason"];
  const attestation = [
    "# Operator Attestation -- Part Master PRODUCTION-SOURCE dry run",
    "",
    `- Generated: ${runMetadata.generatedAt}`,
    `- Operator: ${facts.operator} (reviewers: ${REVIEWER_ROLES.technicalReviewer}; ${REVIEWER_ROLES.evidenceVerificationReviewer}; final approver: ${REVIEWER_ROLES.finalApprover})`,
    `- Repository commit: ${runMetadata.repositoryCommit}`,
    `- Firebase project: ${APPROVED_PROJECT_ID} (production, READ-ONLY use)`,
    `- Source snapshot date: ${facts.snapshotDate}`,
    `- Approved input SHA-256: ${facts.declaredSha256} (independently re-verified at invocation; mismatch refuses)`,
    "- Mode: DRY_RUN_ONLY -- zero writes of any kind; no mutation command imported; no fixture seeded; the source CSV is NOT included in this evidence (hash only).",
    "- Quantity columns informational-only and ignored; no quantity, alias, supplier-item, Work Order, or ledger data was modified.",
    `- Readiness verdict: ${readiness.status} (see cutover-readiness.json; execution-gate approvals remain pending by design).`,
    "",
  ].join("\n");
  const report = [
    "# Cutover-Readiness Report -- PRODUCTION-SOURCE dry run",
    "",
    `- Classification totals: CREATE=${analysis.counts.CREATE} UPDATE=${analysis.counts.UPDATE} NO_CHANGE=${analysis.counts.NO_CHANGE} CONFLICT=${analysis.counts.CONFLICT} INVALID=${analysis.counts.INVALID}`,
    `- In-file duplicates: ${analysis.duplicateCount}; conflicts: ${analysis.conflictCount}`,
    `- Unresolved data issues: ${analysis.counts.CONFLICT + analysis.counts.INVALID} row(s) require Owner review (see conflicts.csv / invalid-rows.csv)`,
    "",
    `## Readiness: ${readiness.status}`,
    "",
    "| Criterion | Description | Status | Detail |",
    "|---|---|---|---|",
    ...readiness.criteria.map((r) => `| ${r.id} | ${r.description} | ${r.status} | ${r.detail} |`),
    "",
    "Decision #42 resolved set applied (C20). Execution-gate approvals (CREATE/UPDATE populations, rollback point, reconciliation, operator, window, Rules-state) are approved only at their own later Owner gates.",
    "",
  ].join("\n");

  const files = {
    "run-metadata.json": canonicalJson(runMetadata),
    "summary.json": canonicalJson({ counts: analysis.counts, reasonCounts: analysis.reasonCounts, duplicateCount: analysis.duplicateCount, conflictCount: analysis.conflictCount }),
    "row-results.json": canonicalJson(analysis.rows),
    "conflicts.csv": toCsvLines(conflictRows, csvCols),
    "invalid-rows.csv": toCsvLines(invalidRows, csvCols),
    "cutover-readiness.json": canonicalJson(readinessDoc),
    "cutover-readiness-report.md": report,
    "operator-attestation.md": attestation,
  };
  const findings = {};
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(outputDir, name), text, "utf8");
    const hits = scanSensitive(text);
    if (hits.length > 0) findings[name] = hits;
  }
  const sensitiveReport = Object.keys(findings).length === 0
    ? "CLEAN: no sensitive-value pattern matched any artifact\n"
    : `FINDINGS:\n${canonicalJson(findings)}`;
  fs.writeFileSync(path.join(outputDir, "sensitive-scan.txt"), sensitiveReport, "utf8");
  const read = (n) => fs.readFileSync(path.join(outputDir, n), "utf8");
  const checksums = EVIDENCE_FILES.filter((n) => n !== "checksums.sha256")
    .map((n) => `${sha256Hex(read(n))}  ${n}`).join("\n") + "\n";
  fs.writeFileSync(path.join(outputDir, "checksums.sha256"), checksums, "utf8");
  return { readinessStatus: readiness.status, sensitiveClean: Object.keys(findings).length === 0 };
}

async function main() {
  let args;
  try { args = parseCliArgs(process.argv.slice(2)); }
  catch (err) {
    if (err instanceof InvalidInvocationError) { console.error(`REFUSED: ${err.message}`); return 1; }
    throw err;
  }
  const repoRoot = path.resolve(__dirname, "..", "..");
  const inputPathResolved = typeof args.input === "string" ? path.resolve(args.input) : undefined;
  const outputDirResolved = typeof args["output-dir"] === "string" ? path.resolve(args["output-dir"]) : undefined;
  let actualSha256;
  let inputText;
  if (inputPathResolved !== undefined && fs.existsSync(inputPathResolved)) {
    inputText = fs.readFileSync(inputPathResolved, "utf8");
    actualSha256 = sha256Hex(inputText);
  }
  let commitActual;
  try { commitActual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim(); }
  catch { commitActual = undefined; }
  const facts = {
    projectId: args["project-id"],
    confirmProject: args["confirm-project"],
    inputPathResolved,
    repoRoot,
    outputDirResolved,
    outputDirNonEmpty: outputDirResolved !== undefined && fs.existsSync(outputDirResolved) && fs.readdirSync(outputDirResolved).length > 0,
    declaredSha256: args["input-sha256"],
    actualSha256,
    commitDeclared: args.commit,
    commitActual,
    snapshotDate: args["snapshot-date"],
    operator: args.operator,
    decisions: parseDecisions(args["resolved-decisions"]),
    ackDryRun: args["acknowledge-dry-run"] === true,
    ackProductionRead: args["acknowledge-production-read"] === true,
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    featureFlagValue: process.env.PART_MASTER_REFERENCE,
  };
  const refusals = validateInvocation(facts);
  if (inputPathResolved !== undefined && inputText === undefined) {
    refusals.push(`REFUSED: cannot read --input ${inputPathResolved}`);
  }
  if (refusals.length > 0) {
    for (const r of refusals) console.error(r);
    console.error(`invocation refused (${refusals.length} reason(s)); no connection was made, nothing was written`);
    return 1;
  }

  // All guards passed -- connect (read-only use) and analyze.
  console.log("runPartMasterProductionDryRun (Decision #42; DRY-RUN ONLY, zero writes; production READ)");
  const { initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  initializeApp({ projectId: APPROVED_PROJECT_ID });
  const db = getFirestore();
  const { analyzeCsv, UnusableCsvError } = require("../lib/partMaster/csvMigrationAnalysis");
  const { buildFirestorePartRepository } = require("../lib/partMaster/partMasterRepository");
  const { buildFirestorePartAliasRepository } = require("../lib/partMaster/partAliasRepository");
  const partRepo = buildFirestorePartRepository(db);
  const aliasRepo = buildFirestorePartAliasRepository(db);
  let analysis;
  try {
    analysis = await analyzeCsv(inputText, {
      getPart: (id) => partRepo.getById(null, id).catch(() => null),
      getAlias: (id) => aliasRepo.getByAliasId(null, id).catch(() => null),
    });
  } catch (err) {
    if (err instanceof UnusableCsvError) { console.error(`UNUSABLE INPUT: ${err.message}`); return 1; }
    throw err;
  }
  const result = composeEvidencePackage(outputDirResolved, facts, analysis);
  console.log(`rows: CREATE=${analysis.counts.CREATE} UPDATE=${analysis.counts.UPDATE} NO_CHANGE=${analysis.counts.NO_CHANGE} CONFLICT=${analysis.counts.CONFLICT} INVALID=${analysis.counts.INVALID}`);
  console.log(`evidence: ${EVIDENCE_FILES.length} artifacts in ${outputDirResolved} (sensitive scan ${result.sensitiveClean ? "CLEAN" : "FINDINGS"}; readiness ${result.readinessStatus})`);
  return analysis.counts.CONFLICT + analysis.counts.INVALID > 0 ? 3 : 0;
}

if (require.main === module) {
  main().then((c) => { process.exitCode = c; }).catch((err) => { console.error(`DRY-RUN FAILURE (technical): ${err.message}`); process.exitCode = 2; });
}
module.exports = { validateInvocation, buildRunMetadata, composeEvidencePackage, parseDecisions, EXPECTED_DECISIONS, EVIDENCE_FILES, APPROVED_PROJECT_ID, main };
