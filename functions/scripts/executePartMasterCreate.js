// INV-1 Post-Phase-1 -- governed CREATE-only Part Master importer
// (ADR-008 / Decision #42; CREATE Write-Tool Implementation gate). Creates
// the Owner-approved CREATE population by replaying the approved analysis
// package through the TRUSTED createPart command only. It never performs a
// raw Firestore write, never touches aliases/supplier-items/quantities/
// Rules, and never mutates an existing non-equivalent Part.
//
// Two modes:
//   (default) --dry-run   : validate + build the plan; ZERO writes.
//   --execute             : create Parts via createPart. Against PRODUCTION
//                           this additionally requires --acknowledge-
//                           production-write and refuses an emulator-
//                           ambiguous environment.
//
// Binding: the source CSV's SHA-256 must equal --input-sha256 (the Owner-
// approved hash); the approved analysis package (run-metadata.json +
// row-results.json) must carry the same approvedInputSha256, must classify
// EVERY row CREATE, and its CREATE count must equal --expected-count. Each
// Part the importer builds from the CSV must match the package's
// proposedPartId for that row exactly, or the run refuses. Idempotency is
// deterministic, so an interrupted run is safe to restart with no duplicate
// creation.
//
// Usage:
//   node scripts/executePartMasterCreate.js \
//     --project-id taylor-parts --confirm-project taylor-parts \
//     --input <approved CSV outside repo> --input-sha256 <approved hash> \
//     --package-dir <approved evidence dir> --expected-count 190 \
//     --commit <pinned = HEAD> --operator "<name>" --output-dir <fresh> \
//     [--execute --acknowledge-production-write]
// Exit: 0 ok; 3 completed-with-failures; 1 refused/invalid; 2 technical.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  InvalidInvocationError, parseCliArgs, canonicalJson, sha256Hex, scanSensitive,
} = require("./inventoryEffectOperatorShared");

const APPROVED_PROJECT_ID = "taylor-parts";
const REQUIRED_COLUMNS = ["internalPartNumber", "name", "controlType", "stockingClass", "stockingUnit"];

// Deterministic idempotency key: stable across restarts for the same
// (approved input, partId) so a rerun replays rather than duplicates.
function idempotencyKeyFor(approvedSha256, partId) {
  return `pmcreate-${approvedSha256.slice(0, 16)}-${partId}`;
}

// Build the create plan from the approved package + source CSV. Pure: no
// I/O, no writes. Returns { refusals:[], plan:[{rowNumber, partId, part}] }.
function buildCreatePlan({ csvText, packageMetadata, packageRows, approvedSha256, expectedCount, csvSha256 }) {
  const refusals = [];
  const { parseCsv } = require("../lib/partMaster/csvMigrationAnalysis");
  const { validatePart } = require("../lib/partMaster/validation");

  if (csvSha256 !== approvedSha256) {
    refusals.push(`REFUSED: source CSV SHA-256 ${csvSha256} != approved --input-sha256 ${approvedSha256}; any modification voids the authorization`);
  }
  const pkgHash = packageMetadata && packageMetadata.approvedInputSha256;
  if (pkgHash !== approvedSha256) {
    refusals.push(`REFUSED: approved package approvedInputSha256 ${pkgHash} != --input-sha256 ${approvedSha256}; package does not match the approved input`);
  }
  if (!Array.isArray(packageRows)) {
    refusals.push("REFUSED: approved package row-results.json is not an array");
    return { refusals, plan: [] };
  }
  const nonCreate = packageRows.filter((r) => r.classification !== "CREATE");
  if (nonCreate.length > 0) {
    refusals.push(`REFUSED: approved package contains ${nonCreate.length} non-CREATE row(s); this tool creates only when the population is CREATE-only`);
  }
  const createRows = packageRows.filter((r) => r.classification === "CREATE");
  if (createRows.length !== expectedCount) {
    refusals.push(`REFUSED: approved package CREATE count ${createRows.length} != --expected-count ${expectedCount}`);
  }

  // Build a PartInput per CREATE row from the CSV, exactly as the analyzer
  // does for grandfathered creates (partId = explicit partId, else raw IPN;
  // status DRAFT), then cross-check the derived partId against the package.
  const parsed = parseCsv(csvText);
  const header = (parsed[0] || []).map((h) => h.trim());
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) refusals.push(`REFUSED: source CSV missing required column "${col}"`);
  }
  const idx = (c) => header.indexOf(c);
  const cellOf = (cells, c) => {
    const i = idx(c);
    const v = i >= 0 ? (cells[i] || "").trim() : "";
    return v === "" ? undefined : v;
  };
  const proposedById = new Map(createRows.map((r) => [r.rowNumber, r.proposedPartId]));
  const plan = [];
  const seen = new Set();
  for (const row of createRows) {
    const cells = parsed[row.rowNumber]; // parsed[0] is the header row
    if (!Array.isArray(cells)) {
      refusals.push(`REFUSED: CSV has no data row ${row.rowNumber} for a package CREATE row`);
      continue;
    }
    const rawIpn = cellOf(cells, "internalPartNumber");
    const explicitPartId = cellOf(cells, "partId");
    const partId = explicitPartId ?? rawIpn;
    const part = {
      partId,
      internalPartNumber: rawIpn,
      name: cellOf(cells, "name"),
      description: cellOf(cells, "description"),
      category: cellOf(cells, "category"),
      status: "DRAFT",
      stockingUnit: cellOf(cells, "stockingUnit"),
      controlType: cellOf(cells, "controlType"),
      stockingClass: cellOf(cells, "stockingClass"),
    };
    const validated = validatePart(part);
    if (!validated.valid) {
      refusals.push(`REFUSED: row ${row.rowNumber} (${String(partId)}) fails domain validation: ${validated.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
      continue;
    }
    if (partId !== proposedById.get(row.rowNumber)) {
      refusals.push(`REFUSED: row ${row.rowNumber} derived partId "${partId}" != package proposedPartId "${proposedById.get(row.rowNumber)}"`);
      continue;
    }
    if (seen.has(partId)) {
      refusals.push(`REFUSED: duplicate partId "${partId}" built from the CSV`);
      continue;
    }
    seen.add(partId);
    plan.push({ rowNumber: row.rowNumber, partId, part: validated.value });
  }
  if (refusals.length === 0 && plan.length !== expectedCount) {
    refusals.push(`REFUSED: built ${plan.length} CREATE parts but --expected-count is ${expectedCount}`);
  }
  return { refusals, plan };
}

// Execute the plan through the trusted createPart command. Stops on the
// first FAILED row (partial failure blocks reconciliation); completed rows
// stand (idempotent). Injectable createFn/deps for tests.
async function executeCreatePlan(plan, { actorUid, approvedSha256, createFn, deps, onRow }) {
  const { createPart } = require("../lib/partMaster/partMasterCommands");
  const { AlreadyExistsError, IdempotencyConflictError } = require("../lib/partMaster/partMasterCommands");
  const doCreate = createFn || ((input) => createPart(input, deps));
  const results = [];
  let stopped = false;
  for (const item of plan) {
    if (stopped) { results.push({ partId: item.partId, status: "NOT_ATTEMPTED" }); continue; }
    const idempotencyKey = idempotencyKeyFor(approvedSha256, item.partId);
    try {
      const outcome = await doCreate({ actorUid, idempotencyKey, part: item.part });
      const status = outcome.outcome === "replayed" ? "ALREADY_APPLIED" : "SUCCESS";
      const rec = { partId: item.partId, status, version: outcome.version };
      results.push(rec);
      if (onRow) onRow(rec);
    } catch (err) {
      const kind = err instanceof AlreadyExistsError ? "CONFLICT_EXISTING"
        : err instanceof IdempotencyConflictError ? "IDEMPOTENCY_CONFLICT" : "ERROR";
      const rec = { partId: item.partId, status: "FAILED", failureKind: kind, message: err instanceof Error ? err.message : String(err) };
      results.push(rec);
      if (onRow) onRow(rec);
      stopped = true; // stop-on-first-failure: blocks reconciliation
    }
  }
  const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  return { results, counts, complete: !stopped };
}

function readPackage(packageDir) {
  const meta = JSON.parse(fs.readFileSync(path.join(packageDir, "run-metadata.json"), "utf8"));
  const rows = JSON.parse(fs.readFileSync(path.join(packageDir, "row-results.json"), "utf8"));
  return { meta, rows };
}

function validateInvocation(a) {
  const refusals = [];
  if (a.projectId !== APPROVED_PROJECT_ID) refusals.push(`REFUSED: --project-id must be exactly "${APPROVED_PROJECT_ID}"`);
  if (a.confirmProject !== APPROVED_PROJECT_ID) refusals.push(`REFUSED: --confirm-project must be exactly "${APPROVED_PROJECT_ID}"`);
  if (typeof a.declaredSha256 !== "string" || !/^[0-9a-f]{64}$/.test(a.declaredSha256)) refusals.push("REFUSED: --input-sha256 required as 64 lowercase hex");
  if (!Number.isInteger(a.expectedCount) || a.expectedCount <= 0) refusals.push("REFUSED: --expected-count required as a positive integer");
  if (typeof a.commitDeclared !== "string" || a.commitDeclared.length < 7) refusals.push("REFUSED: --commit required");
  else if (typeof a.commitActual === "string" && !a.commitActual.startsWith(a.commitDeclared) && !a.commitDeclared.startsWith(a.commitActual)) refusals.push(`REFUSED: --commit ${a.commitDeclared} != HEAD ${a.commitActual}`);
  if (typeof a.operator !== "string" || a.operator.trim() === "") refusals.push("REFUSED: --operator required");
  if (typeof a.inputPathResolved !== "string") refusals.push("REFUSED: --input required");
  else if (typeof a.repoRoot === "string" && (a.inputPathResolved === a.repoRoot || a.inputPathResolved.startsWith(a.repoRoot + path.sep))) refusals.push("REFUSED: the source CSV must live OUTSIDE the repository");
  if (typeof a.outputDirResolved !== "string") refusals.push("REFUSED: --output-dir required");
  else if (a.outputDirNonEmpty) refusals.push("REFUSED: --output-dir exists and is not empty; evidence is never overwritten");
  if (typeof a.packageDir !== "string") refusals.push("REFUSED: --package-dir required");
  if (a.featureFlagValue === "enabled") refusals.push("REFUSED: PART_MASTER_REFERENCE must remain OFF");
  if (a.execute) {
    const emulator = typeof a.emulatorHost === "string" && a.emulatorHost.length > 0;
    if (!emulator) {
      if (a.ackProductionWrite !== true) refusals.push("REFUSED: --execute against production requires --acknowledge-production-write");
    }
  }
  return refusals;
}

async function main() {
  let args;
  try { args = parseCliArgs(process.argv.slice(2)); }
  catch (err) { if (err instanceof InvalidInvocationError) { console.error(`REFUSED: ${err.message}`); return 1; } throw err; }

  const repoRoot = path.resolve(__dirname, "..", "..");
  const inputPathResolved = typeof args.input === "string" ? path.resolve(args.input) : undefined;
  const outputDirResolved = typeof args["output-dir"] === "string" ? path.resolve(args["output-dir"]) : undefined;
  let commitActual;
  try { commitActual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim(); } catch { commitActual = undefined; }
  const facts = {
    projectId: args["project-id"], confirmProject: args["confirm-project"],
    declaredSha256: args["input-sha256"], expectedCount: Number(args["expected-count"]),
    commitDeclared: args.commit, commitActual, operator: args.operator,
    inputPathResolved, repoRoot, outputDirResolved,
    outputDirNonEmpty: outputDirResolved !== undefined && fs.existsSync(outputDirResolved) && fs.readdirSync(outputDirResolved).length > 0,
    packageDir: args["package-dir"],
    execute: args.execute === true, ackProductionWrite: args["acknowledge-production-write"] === true,
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST, featureFlagValue: process.env.PART_MASTER_REFERENCE,
  };
  const refusals = validateInvocation(facts);
  let csvText, csvSha256, pkg;
  if (inputPathResolved && fs.existsSync(inputPathResolved)) { csvText = fs.readFileSync(inputPathResolved, "utf8"); csvSha256 = sha256Hex(csvText); }
  else refusals.push(`REFUSED: cannot read --input ${inputPathResolved}`);
  if (typeof facts.packageDir === "string" && fs.existsSync(path.join(facts.packageDir, "run-metadata.json"))) pkg = readPackage(facts.packageDir);
  else refusals.push("REFUSED: --package-dir must contain run-metadata.json and row-results.json");

  if (refusals.length > 0 && (csvText === undefined || pkg === undefined)) {
    for (const r of refusals) console.error(r);
    console.error(`invocation refused (${refusals.length}); nothing written`);
    return 1;
  }
  const { refusals: planRefusals, plan } = buildCreatePlan({
    csvText, packageMetadata: pkg.meta, packageRows: pkg.rows,
    approvedSha256: facts.declaredSha256, expectedCount: facts.expectedCount, csvSha256,
  });
  const allRefusals = [...refusals, ...planRefusals];
  if (allRefusals.length > 0) {
    for (const r of allRefusals) console.error(r);
    console.error(`invocation refused (${allRefusals.length}); nothing written`);
    return 1;
  }

  const mode = facts.execute ? "EXECUTE" : "DRY_RUN";
  console.log(`executePartMasterCreate (${mode}; CREATE-only; ${plan.length} parts; project ${APPROVED_PROJECT_ID})`);
  let rows, counts, complete;
  if (!facts.execute) {
    rows = plan.map((p) => ({ partId: p.partId, status: "PLANNED" }));
    counts = { PLANNED: rows.length };
    complete = true;
  } else {
    const { initializeApp } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    initializeApp({ projectId: APPROVED_PROJECT_ID });
    void getFirestore();
    const res = await executeCreatePlan(plan, {
      actorUid: facts.operator, approvedSha256: facts.declaredSha256,
      onRow: (r) => console.log(`  ${r.status}  ${r.partId}${r.failureKind ? " (" + r.failureKind + ")" : ""}`),
    });
    rows = res.results; counts = res.counts; complete = res.complete;
  }

  fs.mkdirSync(facts.outputDirResolved, { recursive: true });
  const runMetadata = {
    tool: "executePartMasterCreate", runKind: "CREATE_IMPORT", mode,
    allowedClassification: "CREATE",
    zeroWriteInDryRun: !facts.execute,
    writesOnlyVia: "createPart (trusted command); no raw Firestore write; no alias/supplier-item/quantity/Rules write",
    projectId: APPROVED_PROJECT_ID, emulatorHost: facts.emulatorHost ?? null,
    approvedInputSha256: facts.declaredSha256, expectedCount: facts.expectedCount,
    repositoryCommit: commitActual ?? facts.commitDeclared, operator: facts.operator,
    productionWriteAcknowledged: facts.execute ? facts.ackProductionWrite === true : false,
    partMasterReferenceOff: facts.featureFlagValue !== "enabled",
    complete, counts, generatedAt: new Date().toISOString(),
  };
  const files = {
    "run-metadata.json": canonicalJson(runMetadata),
    "per-row-results.json": canonicalJson(rows),
    "summary.json": canonicalJson({ mode, counts, complete, expectedCount: facts.expectedCount, planned: plan.length }),
    "operator-attestation.md": [
      `# Operator Attestation -- Part Master CREATE import (${mode})`,
      "",
      `- Operator: ${facts.operator}`,
      `- Commit: ${runMetadata.repositoryCommit}`,
      `- Project: ${APPROVED_PROJECT_ID}${facts.execute ? "" : " (dry-run: zero writes)"}`,
      `- Approved input SHA-256: ${facts.declaredSha256}`,
      `- Population: ${plan.length} CREATE parts (expected ${facts.expectedCount})`,
      `- Writes only via the trusted createPart command; no raw writes; no alias/supplier-item/quantity/Rules changes.`,
      `- PART_MASTER_REFERENCE: ${runMetadata.partMasterReferenceOff ? "OFF" : "ON"}`,
      `- Result: ${JSON.stringify(counts)}; complete=${complete}.`,
      "",
    ].join("\n"),
  };
  const findings = {};
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(facts.outputDirResolved, name), text, "utf8");
    const hits = scanSensitive(text); if (hits.length) findings[name] = hits;
  }
  const scan = Object.keys(findings).length === 0 ? "CLEAN: no sensitive-value pattern matched any artifact\n" : `FINDINGS:\n${canonicalJson(findings)}`;
  fs.writeFileSync(path.join(facts.outputDirResolved, "sensitive-scan.txt"), scan, "utf8");
  const read = (n) => fs.readFileSync(path.join(facts.outputDirResolved, n), "utf8");
  const checksums = [...Object.keys(files), "sensitive-scan.txt"].map((n) => `${sha256Hex(read(n))}  ${n}`).join("\n") + "\n";
  fs.writeFileSync(path.join(facts.outputDirResolved, "checksums.sha256"), checksums, "utf8");
  console.log(`evidence: ${Object.keys(files).length + 2} artifacts in ${facts.outputDirResolved}; counts ${JSON.stringify(counts)}; complete=${complete}`);
  if (facts.execute && !complete) return 3;
  return 0;
}

if (require.main === module) {
  main().then((c) => { process.exitCode = c; }).catch((err) => { console.error(`CREATE IMPORT FAILURE (technical): ${err.message}`); process.exitCode = 2; });
}
module.exports = { buildCreatePlan, executeCreatePlan, validateInvocation, idempotencyKeyFor, APPROVED_PROJECT_ID, main };
