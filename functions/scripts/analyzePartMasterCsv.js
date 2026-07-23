// INV-1 Phase 1, PR 1.8 -- Part Master CSV DRY-RUN analysis CLI (ADR-008 /
// Decision #40). DRY-RUN IS THE ONLY MODE: no write-enabled path exists in
// this tool at all -- zero Firestore/Auth/Storage writes, no Functions
// invocation, no history rewrite, no quantity recalculation. Reads (parts +
// part_aliases lookups) follow the operator-script project-guard
// convention; running against production remains separately Owner-gated.
//
// Usage:
//   node scripts/analyzePartMasterCsv.js \
//     --project-id <id> --confirm-project <id> \
//     --input <file.csv> --output-dir <path> [--json]
// Exit codes: 0 = analysis complete, no conflicts/invalids; 3 = complete
// with conflicts or invalid rows; 1 = invalid invocation/unusable file;
// 2 = technical failure.
"use strict";
const fs = require("node:fs");
const {
  SCRIPT_VERSION, InvalidInvocationError, parseCliArgs,
  assertProjectConfirmation, canonicalJson, sha256Hex, writeEvidenceArtifacts,
} = require("./inventoryEffectOperatorShared");
const { analyzeCsv, UnusableCsvError } = require("../lib/partMaster/csvMigrationAnalysis");
const { buildFirestorePartRepository } = require("../lib/partMaster/partMasterRepository");
const { buildFirestorePartAliasRepository } = require("../lib/partMaster/partAliasRepository");

const HELP = `analyzePartMasterCsv -- DRY-RUN ONLY Part Master CSV migration analysis.
Required: --project-id <id> --confirm-project <id> --input <file.csv> --output-dir <path>
Optional: --json --help
NO WRITE MODE EXISTS. Production reads require separate Owner authorization.`;

function toCsvLines(rows, cols) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

async function main() {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
    if (args.help === true) { console.log(HELP); return 0; }
    assertProjectConfirmation(args);
    for (const k of ["input", "output-dir"]) {
      if (typeof args[k] !== "string" || args[k].length === 0) throw new InvalidInvocationError(`--${k} is required`);
    }
  } catch (err) {
    if (err instanceof InvalidInvocationError) { console.error(`INVALID INVOCATION: ${err.message}`); return 1; }
    throw err;
  }
  let text;
  try { text = fs.readFileSync(args.input, "utf8"); }
  catch (err) { console.error(`INVALID INVOCATION: cannot read --input: ${err.message}`); return 1; }

  console.log("analyzePartMasterCsv (INV-1 Phase 1 PR 1.8, DRY-RUN ONLY -- zero writes)");
  const { initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  initializeApp({ projectId: args["project-id"] });
  const db = getFirestore();
  const partRepo = buildFirestorePartRepository(db);
  const aliasRepo = buildFirestorePartAliasRepository(db);
  const lookups = {
    getPart: (id) => partRepo.getById(null, id).catch(() => null),
    getAlias: (id) => aliasRepo.getByAliasId(null, id).catch(() => null),
  };

  let analysis;
  try { analysis = await analyzeCsv(text, lookups); }
  catch (err) {
    if (err instanceof UnusableCsvError) { console.error(`UNUSABLE INPUT: ${err.message}`); return 1; }
    throw err;
  }

  const runMetadata = {
    tool: "analyzePartMasterCsv",
    scriptVersion: SCRIPT_VERSION + "+pr1.8",
    mode: "DRY_RUN_ONLY",
    zeroWriteAttestation: "this tool has no write-enabled mode; no Firestore/Auth/Storage write API is imported or invoked",
    projectId: args["project-id"],
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST ?? null,
    generatedAt: new Date().toISOString(),
    inputSha256: sha256Hex(text),
    rowCounts: analysis.counts,
    reasonCounts: analysis.reasonCounts,
    duplicateCount: analysis.duplicateCount,
    conflictCount: analysis.conflictCount,
    ignoredInformationalColumns: analysis.ignoredInformationalColumns,
  };
  const conflictRows = analysis.rows.filter((r) => r.classification === "CONFLICT");
  const invalidRows = analysis.rows.filter((r) => r.classification === "INVALID");
  const csvCols = ["rowNumber", "normalizedLegacyId", "proposedPartId", "classification", "reasonCode", "reason"];
  const artifact = writeEvidenceArtifacts(args["output-dir"], {
    "run-metadata.json": runMetadata,
    "summary.json": { counts: analysis.counts, reasonCounts: analysis.reasonCounts, duplicateCount: analysis.duplicateCount, conflictCount: analysis.conflictCount },
    "row-results.json": analysis.rows,
    "conflicts.csv": toCsvLines(conflictRows, csvCols),
    "invalid-rows.csv": toCsvLines(invalidRows, csvCols),
  });
  console.log(`rows: CREATE=${analysis.counts.CREATE} UPDATE=${analysis.counts.UPDATE} NO_CHANGE=${analysis.counts.NO_CHANGE} CONFLICT=${analysis.counts.CONFLICT} INVALID=${analysis.counts.INVALID}`);
  console.log(`artifacts: ${artifact.written.join(", ")} (sensitive scan ${artifact.sensitiveClean ? "CLEAN" : "FINDINGS"})`);
  if (args.json === true) console.log(canonicalJson(runMetadata));
  return analysis.counts.CONFLICT + analysis.counts.INVALID > 0 ? 3 : 0;
}

if (require.main === module) {
  main().then((c) => { process.exitCode = c; }).catch((err) => { console.error(`ANALYSIS FAILURE (technical): ${err.message}`); process.exitCode = 2; });
}
module.exports = { main, toCsvLines, HELP };
