// INV-1 Phase 0, PR 0.2 -- CONTROLLED inventory-effect retry (Gate 0.4b tool).
//
// NO RETRY IS AUTHORIZED WITHOUT EXACT OWNER-APPROVED WORK ORDER / STATE
// PAIRS. This script exists so that, under a future Gate 0.4(b) Owner
// Production Data Authorization naming an exact batch, those pairs -- and
// ONLY those pairs -- can be re-driven through the EXISTING idempotent
// effect path. Merging or possessing this tool authorizes nothing.
//
// EXECUTION AUTHORITY: the only mutation this script can cause is a call to
// the existing compiled triggerInventoryEffects(workOrderId, state)
// (../lib/inventoryService.js) -- the exact function transitionWorkOrder
// already calls post-commit. Reserve/release/consume/finalize logic,
// processed-state idempotency guards, and failure recording are entirely
// the existing path's; nothing is reimplemented or bypassed here. (Note:
// the existing path itself records a failures[state] entry in
// inventory_sync_status when a retry fails -- that is pre-existing
// behavior, not new writing added by this tool.)
//
// NO WILDCARDS: there is no retry-all, no retry-all-failed, no
// retry-all-silent-misses, and no implicit expansion from audit output.
// Input is ONLY an explicit operator-supplied JSON file (--input) of
// { workOrderId, state } pairs.
//
// PREFLIGHT (per pair, before any execution): re-read the Work Order and
// sync evidence, run the PR 0.1 pure detector, and require the pair to
// still classify RECORDED_FAILURE or SILENT_MISS with clean evidence.
// PROCESSED pairs are refused (already done); NOT_EXPECTED pairs are
// refused (nothing should run); pairs whose detection carries warnings
// (malformed/ambiguous evidence) are refused as FLAGGED_EVIDENCE --
// investigate first, then re-authorize.
//
// POLICY: expected business failures (the effect path re-recording a
// failure, e.g. insufficient availability) are recorded and execution
// CONTINUES to the next pair. Unexpected systemic errors (exceptions from
// the SDK/path itself) STOP the batch immediately.
//
// Usage:
//   node scripts/retryInventoryEffects.js \
//     --project-id <id> --confirm-project <id> \
//     --confirm-owner-authorized-retry \
//     --input <batch.json> --output-dir <path> [--json]
//
// Exit codes: 0 = all attempted pairs resolved PROCESSED; 3 = completed
// with refusals/business failures/unresolved items; 1 = invalid
// invocation; 2 = technical failure / systemic stop.

"use strict";

const fs = require("node:fs");

const {
  SCRIPT_VERSION,
  InvalidInvocationError,
  parseCliArgs,
  assertProjectConfirmation,
  canonicalJson,
  sha256Hex,
  writeEvidenceArtifacts,
  normalizeRetryBatch,
} = require("./inventoryEffectOperatorShared");

const {
  detectWorkOrderInventoryEffects,
  TRIGGER_STATES,
} = require("../lib/inventoryEffectDetection");

const { projectWorkOrder, projectSyncStatus } = require("./auditInventoryEffects");

const WORK_ORDERS_COLLECTION = "fieldops_wos";
const SYNC_STATUS_COLLECTION = "inventory_sync_status";

const HELP_TEXT = `
retryInventoryEffects -- CONTROLLED inventory-effect retry (INV-1 Phase 0)

*** NO RETRY IS AUTHORIZED WITHOUT EXACT OWNER-APPROVED WORK ORDER / STATE PAIRS. ***

PURPOSE
  Re-drives the EXISTING idempotent inventory-effect path
  (triggerInventoryEffects) for an explicit, Owner-authorized list of
  { workOrderId, state } pairs -- and nothing else. This is the Gate 0.4(b)
  tool; production use requires a separate explicit Owner Production Data
  Authorization naming the exact batch.

MUTATION BEHAVIOR
  Mutates ONLY through the existing effect path (ledger entries +
  inventory_sync_status bookkeeping), once per approved pair. No wildcard
  mode exists. Preflight refuses PROCESSED, NOT_EXPECTED, and
  flagged/ambiguous pairs.

REQUIRED FLAGS
  --project-id <id>                Target project. No default exists.
  --confirm-project <id>           Must exactly match --project-id.
  --confirm-owner-authorized-retry Operator's explicit acknowledgement that an
                                   Owner Production Data Authorization exists
                                   for this EXACT batch. Refused without it.
  --input <path>                   JSON array: [{ "workOrderId": "...",
                                   "state": "DISPATCHED|COMPLETED|CANCELLED" }]
  --output-dir <path>              Local directory for the evidence artifact.

OPTIONAL FLAGS
  --json    Print the outcome JSON to the terminal.
  --help    This text.

EXAMPLES
  # Emulator / local validation (no production credentials):
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/retryInventoryEffects.js \\
    --project-id demo-inv1 --confirm-project demo-inv1 \\
    --confirm-owner-authorized-retry --input batch.json --output-dir /tmp/inv1-retry

PRODUCTION SAFETY
  Production execution is Gate 0.4(b). The batch file must contain exactly the
  Owner-approved pairs -- the script refuses everything else, refuses items
  already PROCESSED, refuses NOT_EXPECTED items, refuses flagged evidence, and
  stops on any unexpected systemic error.
`;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
function parseRetryOptions(argv) {
  const args = parseCliArgs(argv);
  if (args.help === true) return { help: true };
  const { projectId, emulatorHost } = assertProjectConfirmation(args);
  if (args["confirm-owner-authorized-retry"] !== true) {
    throw new InvalidInvocationError(
      "--confirm-owner-authorized-retry is required: you must hold an Owner " +
        "Production Data Authorization for this EXACT batch. Refusing to run."
    );
  }
  if (typeof args.input !== "string" || args.input.length === 0) {
    throw new InvalidInvocationError("--input <path> (JSON pair list) is required.");
  }
  if (typeof args["output-dir"] !== "string" || args["output-dir"].length === 0) {
    throw new InvalidInvocationError("--output-dir <path> is required.");
  }
  return {
    help: false,
    projectId,
    emulatorHost,
    inputPath: args.input,
    outputDir: args["output-dir"],
    json: args.json === true,
  };
}

function loadBatchFile(inputPath) {
  let raw;
  try {
    raw = fs.readFileSync(inputPath, "utf8");
  } catch (err) {
    throw new InvalidInvocationError(`Cannot read --input file: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new InvalidInvocationError(`--input is not valid JSON: ${err.message}`);
  }
  const normalized = normalizeRetryBatch(parsed, [...TRIGGER_STATES]);
  if (normalized.invalid.length > 0) {
    throw new InvalidInvocationError(
      `--input contains invalid entries (nothing was executed): ${canonicalJson(normalized.invalid)}`
    );
  }
  return { ...normalized, batchHash: sha256Hex(raw) };
}

// ---------------------------------------------------------------------------
// Core batch runner -- dependency-injected so tests need no emulator.
// `deps` contract:
//   loadWorkOrder(id)  -> { id, exists, data }
//   loadSyncStatus(id) -> { exists, data() } | { exists:false }
//   triggerEffects(id, state) -> Promise<void>  (the existing idempotent path)
// ---------------------------------------------------------------------------
async function runRetryBatch({ pairs, deps, nowIso }) {
  const outcomes = [];
  let systemicStop = null;

  async function detectPair(pair) {
    const woDoc = await deps.loadWorkOrder(pair.workOrderId);
    if (!woDoc || woDoc.exists !== true) return { missing: true };
    const sync = projectSyncStatus(await deps.loadSyncStatus(pair.workOrderId));
    const detection = detectWorkOrderInventoryEffects(
      projectWorkOrder(woDoc.id, woDoc.data),
      sync
    );
    if (detection.valid !== true) return { invalid: detection };
    return { item: detection.items.find((i) => i.state === pair.state) };
  }

  for (const pair of pairs) {
    if (systemicStop) {
      outcomes.push({ ...pair, result: "NOT_ATTEMPTED_AFTER_SYSTEMIC_STOP" });
      continue;
    }
    const outcome = { ...pair, preflight: null, result: null, postCheck: null, error: null };
    try {
      // -------- Preflight --------
      const pre = await detectPair(pair);
      if (pre.missing) {
        outcome.result = "REFUSED_WORK_ORDER_NOT_FOUND";
        outcomes.push(outcome);
        continue;
      }
      if (pre.invalid) {
        outcome.result = "REFUSED_INVALID_EVIDENCE";
        outcome.error = pre.invalid.message;
        outcomes.push(outcome);
        continue;
      }
      const item = pre.item;
      outcome.preflight = {
        classification: item.classification,
        reasonCode: item.reasonCode,
        warnings: item.warnings,
      };
      if (item.classification === "PROCESSED") {
        outcome.result = "REFUSED_ALREADY_PROCESSED";
        outcomes.push(outcome);
        continue;
      }
      if (item.classification === "NOT_EXPECTED") {
        outcome.result = "REFUSED_NOT_EXPECTED";
        outcomes.push(outcome);
        continue;
      }
      if (item.warnings.length > 0) {
        // Malformed/ambiguous evidence requires operator investigation, not
        // a blind retry -- refuse (fail-safe).
        outcome.result = "REFUSED_FLAGGED_EVIDENCE";
        outcomes.push(outcome);
        continue;
      }
      // Only RECORDED_FAILURE or SILENT_MISS reach this point.

      // -------- Execution: the existing idempotent path, exactly once --------
      await deps.triggerEffects(pair.workOrderId, pair.state);

      // -------- Post-check --------
      const post = await detectPair(pair);
      const postItem = post.item ?? null;
      outcome.postCheck = postItem
        ? {
            classification: postItem.classification,
            reasonCode: postItem.reasonCode,
            warnings: postItem.warnings,
          }
        : { classification: "UNKNOWN", reasonCode: "POST_CHECK_UNAVAILABLE", warnings: [] };
      if (postItem && postItem.classification === "PROCESSED") {
        outcome.result = "RESOLVED_PROCESSED";
      } else if (postItem && postItem.classification === "RECORDED_FAILURE") {
        // The effect path ran and re-recorded a failure -- an expected
        // BUSINESS failure (e.g. insufficient availability), not a systemic
        // error. Recorded distinctly; the batch continues.
        outcome.result = "BUSINESS_FAILURE_RECORDED";
        outcome.error = (await readRecordedFailureMessage(deps, pair)) ?? null;
      } else {
        outcome.result = "UNRESOLVED_REVIEW_REQUIRED";
      }
      outcomes.push(outcome);
    } catch (err) {
      // Unexpected systemic error (SDK/infrastructure/path exception):
      // record, STOP the batch, never suppress.
      outcome.result = "SYSTEMIC_ERROR_STOP";
      outcome.error = err && err.message ? err.message : String(err);
      outcomes.push(outcome);
      systemicStop = outcome.error;
    }
  }

  const counts = {};
  for (const o of outcomes) counts[o.result] = (counts[o.result] ?? 0) + 1;
  return {
    generatedAt: nowIso,
    outcomes,
    counts,
    systemicStop,
    allResolved: outcomes.length > 0 && outcomes.every((o) => o.result === "RESOLVED_PROCESSED"),
  };
}

async function readRecordedFailureMessage(deps, pair) {
  const snap = await deps.loadSyncStatus(pair.workOrderId);
  if (!snap || snap.exists !== true) return null;
  const failures = (snap.data() || {}).failures;
  const entry = failures && typeof failures === "object" ? failures[pair.state] : null;
  return entry && typeof entry === "object" && typeof entry.error === "string"
    ? entry.error
    : null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  let options;
  try {
    options = parseRetryOptions(process.argv.slice(2));
  } catch (err) {
    if (err instanceof InvalidInvocationError) {
      console.error(`INVALID INVOCATION: ${err.message}`);
      console.error("Run with --help for usage.");
      return 1;
    }
    throw err;
  }
  if (options.help) {
    console.log(HELP_TEXT);
    return 0;
  }

  let batch;
  try {
    batch = loadBatchFile(options.inputPath);
  } catch (err) {
    if (err instanceof InvalidInvocationError) {
      console.error(`INVALID INVOCATION: ${err.message}`);
      return 1;
    }
    throw err;
  }

  console.log("retryInventoryEffects (INV-1 Phase 0, CONTROLLED RETRY)");
  console.log("*** Executing ONLY the exact Owner-approved pair list. No wildcard mode exists. ***");
  console.log(`  project:      ${options.projectId}${options.emulatorHost ? ` (EMULATOR ${options.emulatorHost})` : ""}`);
  console.log(`  batch file:   ${options.inputPath} (sha256 ${batch.batchHash})`);
  console.log(`  pairs:        ${batch.pairs.length}${batch.duplicates.length > 0 ? ` (+${batch.duplicates.length} duplicate(s) de-duplicated, reported in artifact)` : ""}`);
  console.log(`  output:       ${options.outputDir}`);

  // Firebase is initialized ONLY after all confirmations succeeded.
  const { initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { triggerInventoryEffects } = require("../lib/inventoryService");
  initializeApp({ projectId: options.projectId });
  const db = getFirestore();

  const deps = {
    async loadWorkOrder(id) {
      const snap = await db.collection(WORK_ORDERS_COLLECTION).doc(id).get();
      return { id: snap.id, exists: snap.exists, data: snap.exists ? snap.data() : undefined };
    },
    async loadSyncStatus(id) {
      return db.collection(SYNC_STATUS_COLLECTION).doc(id).get();
    },
    triggerEffects: (id, state) => triggerInventoryEffects(id, state),
  };

  const run = await runRetryBatch({
    pairs: batch.pairs,
    deps,
    nowIso: new Date().toISOString(),
  });

  const artifact = writeEvidenceArtifacts(options.outputDir, {
    "run-metadata.json": {
      tool: "retryInventoryEffects",
      scriptVersion: SCRIPT_VERSION,
      mode: "CONTROLLED_RETRY",
      projectId: options.projectId,
      emulatorHost: options.emulatorHost,
      generatedAt: run.generatedAt,
      inputBatchSha256: batch.batchHash,
      ownerAuthorizationAcknowledged: true,
      pairCount: batch.pairs.length,
      duplicatesDeduplicated: batch.duplicates,
    },
    "retry-outcomes.json": run.outcomes,
    "summary.json": {
      counts: run.counts,
      systemicStop: run.systemicStop,
      allResolved: run.allResolved,
    },
  });

  console.log("\nOutcome counts:");
  for (const [k, v] of Object.entries(run.counts).sort()) console.log(`  ${k}: ${v}`);
  if (run.systemicStop) console.log(`SYSTEMIC STOP: ${run.systemicStop}`);
  console.log(`Artifacts written: ${artifact.written.join(", ")}`);
  console.log(`Sensitive scan: ${artifact.sensitiveClean ? "CLEAN" : "FINDINGS -- review before commit"}`);
  if (options.json) console.log("\n" + canonicalJson({ counts: run.counts, systemicStop: run.systemicStop }));

  if (run.systemicStop) return 2;
  return run.allResolved ? 0 : 3;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`RETRY EXECUTION FAILURE (technical): ${err.message}`);
      process.exitCode = 2;
    });
}

module.exports = {
  parseRetryOptions,
  loadBatchFile,
  runRetryBatch,
  HELP_TEXT,
};
