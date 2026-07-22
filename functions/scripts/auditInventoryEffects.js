// INV-1 Phase 0, PR 0.2 -- READ-ONLY inventory-effect audit (Gate 0.4a tool).
//
// PURPOSE: scan Work Orders, project each into the PR 0.1 pure detector's
// plain-data inputs, and classify every expected inventory effect as
// PROCESSED / RECORDED_FAILURE / SILENT_MISS / NOT_EXPECTED, emitting a
// governed evidence artifact (docs/governance/audit-artifact-standard.md).
//
// READ-ONLY PROOF: the only Firestore calls this script makes are
// initializeApp(), getFirestore(), paginated collection reads on
// fieldops_wos, and per-document gets on inventory_sync_status -- see
// FIRESTORE_METHODS_USED below. It imports and uses NO write API. All
// artifact output goes to the operator-specified --output-dir on the
// LOCAL FILESYSTEM only.
//
// DETECTION AUTHORITY: classification lives exclusively in the compiled
// PR 0.1 module (../lib/inventoryEffectDetection.js) -- this script only
// projects documents into that module's input shapes. It never
// re-implements detection logic. Prerequisite: `npm run build` first.
//
// PROJECT SAFETY: no default project, ever. --project-id <id> AND a
// matching --confirm-project <id> are both required, checked BEFORE
// initializeApp(). Set FIRESTORE_EMULATOR_HOST for emulator/local runs.
// Merging this tool does NOT authorize running it against production --
// that is Gate 0.4(a), a separate explicit Owner authorization.
//
// Usage:
//   node scripts/auditInventoryEffects.js \
//     --project-id <id> --confirm-project <id> --output-dir <path> \
//     [--work-order-id <WO-id>]... [--page-size 300] [--max-work-orders N] [--json]
//
// Exit codes: 0 = audit complete, no retry candidates; 3 = audit complete,
// >=1 retry candidate found; 1 = invalid invocation; 2 = technical failure.

"use strict";

const {
  SCRIPT_VERSION,
  InvalidInvocationError,
  parseCliArgs,
  assertProjectConfirmation,
  canonicalJson,
  sha256Hex,
  writeEvidenceArtifacts,
} = require("./inventoryEffectOperatorShared");

const {
  detectWorkOrderInventoryEffects,
  TRIGGER_STATES,
} = require("../lib/inventoryEffectDetection");

const WORK_ORDERS_COLLECTION = "fieldops_wos";
const SYNC_STATUS_COLLECTION = "inventory_sync_status";
const DEFAULT_PAGE_SIZE = 300;

// The exact, complete Firestore method surface this script touches -- all
// read-only. Exported so tests assert it and reviewers verify it.
const FIRESTORE_METHODS_USED = Object.freeze([
  "initializeApp",
  "getFirestore",
  "collection().orderBy(FieldPath.documentId()).limit().get()",
  "collection().orderBy(FieldPath.documentId()).startAfter().limit().get()",
  "collection().doc().get()",
  "QuerySnapshot.docs",
  "DocumentSnapshot.id / .exists / .data()",
]);

const HELP_TEXT = `
auditInventoryEffects -- READ-ONLY Work Order inventory-effect audit (INV-1 Phase 0)

PURPOSE
  Classifies every expected inventory effect (DISPATCHED->reserve,
  COMPLETED->consume+finalize, CANCELLED->release) for scanned Work Orders as
  PROCESSED / RECORDED_FAILURE / SILENT_MISS / NOT_EXPECTED using the merged
  PR 0.1 pure detector. Emits a governed evidence artifact.

MUTATION BEHAVIOR
  NONE. This script performs zero Firestore writes. Artifacts are written only
  to the local --output-dir.

REQUIRED FLAGS
  --project-id <id>        Target project. No default exists.
  --confirm-project <id>   Must exactly match --project-id.
  --output-dir <path>      Local directory for the evidence artifact.

OPTIONAL FLAGS
  --work-order-id <id>     Audit only this Work Order (repeatable).
  --page-size <n>          Page size for the deterministic scan (default ${DEFAULT_PAGE_SIZE}).
  --max-work-orders <n>    Hard cap on scanned Work Orders (scan stops and the
                           artifact records TRUNCATED=true).
  --json                   Print the summary JSON to the terminal.
  --help                   This text.

EXAMPLES
  # Emulator / local validation (no production credentials):
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/auditInventoryEffects.js \\
    --project-id demo-inv1 --confirm-project demo-inv1 --output-dir /tmp/inv1-audit

PRODUCTION SAFETY
  Running this audit against production is Gate 0.4(a) and requires a separate
  explicit Owner authorization. Merging or possessing this tool authorizes
  nothing. The script refuses to run without the exact project confirmation.
`;

// ---------------------------------------------------------------------------
// Projection: Firestore documents -> PR 0.1 detector plain-data inputs.
// Presence-only timestamps; values are never interpreted.
// ---------------------------------------------------------------------------
function projectWorkOrder(docId, data) {
  const d = data || {};
  return {
    workOrderId: docId,
    status: d.status,
    executionTimestamps: {
      dispatchedAt: d.dispatchedAt,
      acceptedAt: d.acceptedAt,
      enRouteAt: d.enRouteAt,
      arrivedAt: d.arrivedAt,
      workStartedAt: d.workStartedAt,
      completedAt: d.completedAt,
      closedAt: d.closedAt,
    },
    inventorySnapshotItemCount: Array.isArray(d.inventorySnapshot)
      ? d.inventorySnapshot.length
      : null,
  };
}

function projectSyncStatus(snapshot) {
  if (!snapshot || snapshot.exists !== true) return { exists: false };
  const d = snapshot.data() || {};
  return {
    exists: true,
    processedStates: d.processedStates ?? null,
    failures: d.failures ?? null,
    finalized: d.finalized,
  };
}

// ---------------------------------------------------------------------------
// Core audit -- dependency-injected reader so tests need no emulator and can
// prove no write method is ever touched. `reader` contract:
//   listWorkOrdersPage(pageSize, afterDocId|null) -> [{ id, data }]
//   getSyncStatus(workOrderId) -> { exists, data() } | { exists: false }
//   getWorkOrder(workOrderId) -> { id, exists, data } | { exists: false }
// ---------------------------------------------------------------------------
async function runAudit({ reader, options, nowIso }) {
  const results = [];
  const scanned = [];
  let truncated = false;

  if (options.workOrderIds.length > 0) {
    for (const id of options.workOrderIds) {
      const doc = await reader.getWorkOrder(id);
      if (!doc || doc.exists !== true) {
        results.push({
          valid: false,
          reasonCode: "WORK_ORDER_NOT_FOUND",
          message: `No ${WORK_ORDERS_COLLECTION} document with id ${id}`,
          workOrderId: id,
        });
        continue;
      }
      scanned.push({ id: doc.id, data: doc.data });
    }
  } else {
    let after = null;
    for (;;) {
      const page = await reader.listWorkOrdersPage(options.pageSize, after);
      if (page.length === 0) break;
      for (const doc of page) {
        if (options.maxWorkOrders !== null && scanned.length >= options.maxWorkOrders) {
          truncated = true;
          break;
        }
        scanned.push(doc);
      }
      if (truncated || page.length < options.pageSize) break;
      after = page[page.length - 1].id;
    }
  }

  for (const doc of scanned) {
    const sync = projectSyncStatus(await reader.getSyncStatus(doc.id));
    results.push(detectWorkOrderInventoryEffects(projectWorkOrder(doc.id, doc.data), sync));
  }

  // Deterministic aggregation.
  const counts = { PROCESSED: 0, RECORDED_FAILURE: 0, SILENT_MISS: 0, NOT_EXPECTED: 0 };
  const countsByState = {};
  for (const state of TRIGGER_STATES) {
    countsByState[state] = { PROCESSED: 0, RECORDED_FAILURE: 0, SILENT_MISS: 0, NOT_EXPECTED: 0 };
  }
  const retryCandidates = [];
  const flagged = [];
  const invalidRecords = [];
  for (const r of results) {
    if (r.valid !== true) {
      invalidRecords.push(r);
      continue;
    }
    for (const item of r.items) {
      counts[item.classification] += 1;
      countsByState[item.state][item.classification] += 1;
      if (item.retryCandidate) {
        retryCandidates.push({
          workOrderId: item.workOrderId,
          state: item.state,
          classification: item.classification,
          reasonCode: item.reasonCode,
          operatorReviewRequired: item.operatorReviewRequired,
          warnings: item.warnings,
        });
      }
      if (item.warnings.length > 0) {
        flagged.push({ workOrderId: item.workOrderId, state: item.state, warnings: item.warnings });
      }
    }
    if (r.warnings.length > 0) {
      flagged.push({ workOrderId: r.workOrderId, state: null, warnings: r.warnings });
    }
  }

  return {
    runMetadata: {
      tool: "auditInventoryEffects",
      scriptVersion: SCRIPT_VERSION,
      mode: "READ_ONLY_AUDIT",
      projectId: options.projectId,
      emulatorHost: options.emulatorHost,
      generatedAt: nowIso,
      filters: {
        workOrderIds: options.workOrderIds,
        pageSize: options.pageSize,
        maxWorkOrders: options.maxWorkOrders,
      },
      scannedWorkOrders: scanned.length,
      truncated,
      firestoreMethodsUsed: FIRESTORE_METHODS_USED,
    },
    summary: {
      countsByClassification: counts,
      countsByState,
      retryCandidateCount: retryCandidates.length,
      flaggedCount: flagged.length,
      invalidRecordCount: invalidRecords.length,
      scannedWorkOrders: scanned.length,
      truncated,
    },
    results,
    retryCandidates,
    flagged,
    invalidRecords,
  };
}

function parseAuditOptions(argv) {
  const args = parseCliArgs(argv, { repeatable: ["work-order-id"] });
  if (args.help === true) return { help: true };
  const { projectId, emulatorHost } = assertProjectConfirmation(args);
  if (typeof args["output-dir"] !== "string" || args["output-dir"].length === 0) {
    throw new InvalidInvocationError("--output-dir <path> is required.");
  }
  const pageSize = args["page-size"] !== undefined ? Number(args["page-size"]) : DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new InvalidInvocationError("--page-size must be an integer 1..1000.");
  }
  const maxWorkOrders =
    args["max-work-orders"] !== undefined ? Number(args["max-work-orders"]) : null;
  if (maxWorkOrders !== null && (!Number.isInteger(maxWorkOrders) || maxWorkOrders < 1)) {
    throw new InvalidInvocationError("--max-work-orders must be a positive integer.");
  }
  return {
    help: false,
    projectId,
    emulatorHost,
    outputDir: args["output-dir"],
    workOrderIds: args["work-order-id"] ?? [],
    pageSize,
    maxWorkOrders,
    json: args.json === true,
  };
}

// Firestore-backed reader (only constructed in main(), never in tests).
function buildFirestoreReader(db, FieldPath) {
  return {
    async listWorkOrdersPage(pageSize, afterDocId) {
      let q = db
        .collection(WORK_ORDERS_COLLECTION)
        .orderBy(FieldPath.documentId())
        .limit(pageSize);
      if (afterDocId !== null) q = q.startAfter(afterDocId);
      const snap = await q.get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    },
    async getSyncStatus(workOrderId) {
      return db.collection(SYNC_STATUS_COLLECTION).doc(workOrderId).get();
    },
    async getWorkOrder(workOrderId) {
      const snap = await db.collection(WORK_ORDERS_COLLECTION).doc(workOrderId).get();
      return { id: snap.id, exists: snap.exists, data: snap.exists ? snap.data() : undefined };
    },
  };
}

async function main() {
  let options;
  try {
    options = parseAuditOptions(process.argv.slice(2));
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

  console.log("auditInventoryEffects (INV-1 Phase 0, READ-ONLY)");
  console.log(`  project:  ${options.projectId}${options.emulatorHost ? ` (EMULATOR ${options.emulatorHost})` : ""}`);
  console.log(`  mode:     READ_ONLY_AUDIT -- zero Firestore writes`);
  console.log(`  output:   ${options.outputDir}`);

  // Firebase is initialized ONLY after project confirmation succeeded.
  const { initializeApp } = require("firebase-admin/app");
  const { getFirestore, FieldPath } = require("firebase-admin/firestore");
  initializeApp({ projectId: options.projectId });
  const reader = buildFirestoreReader(getFirestore(), FieldPath);

  const audit = await runAudit({
    reader,
    options,
    nowIso: new Date().toISOString(),
  });

  const detectionJsonl =
    audit.results.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const artifact = writeEvidenceArtifacts(options.outputDir, {
    "run-metadata.json": audit.runMetadata,
    "summary.json": audit.summary,
    "detection-results.jsonl": detectionJsonl,
    "retry-candidates.json": audit.retryCandidates,
    "warnings.json": { flagged: audit.flagged, invalidRecords: audit.invalidRecords },
  });

  console.log(`\nScanned ${audit.summary.scannedWorkOrders} Work Order(s)${audit.summary.truncated ? " (TRUNCATED by --max-work-orders)" : ""}`);
  console.log(`  PROCESSED:        ${audit.summary.countsByClassification.PROCESSED}`);
  console.log(`  RECORDED_FAILURE: ${audit.summary.countsByClassification.RECORDED_FAILURE}`);
  console.log(`  SILENT_MISS:      ${audit.summary.countsByClassification.SILENT_MISS}`);
  console.log(`  NOT_EXPECTED:     ${audit.summary.countsByClassification.NOT_EXPECTED}`);
  console.log(`  retry candidates: ${audit.summary.retryCandidateCount}`);
  console.log(`  flagged items:    ${audit.summary.flaggedCount}`);
  console.log(`  invalid records:  ${audit.summary.invalidRecordCount}`);
  console.log(`Artifacts written: ${artifact.written.join(", ")}`);
  console.log(`Sensitive scan: ${artifact.sensitiveClean ? "CLEAN" : "FINDINGS -- review before commit"}`);
  if (options.json) console.log("\n" + canonicalJson(audit.summary));

  return audit.summary.retryCandidateCount > 0 ? 3 : 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`AUDIT EXECUTION FAILURE (technical): ${err.message}`);
      process.exitCode = 2;
    });
}

module.exports = {
  parseAuditOptions,
  projectWorkOrder,
  projectSyncStatus,
  runAudit,
  buildFirestoreReader,
  FIRESTORE_METHODS_USED,
  WORK_ORDERS_COLLECTION,
  SYNC_STATUS_COLLECTION,
  DEFAULT_PAGE_SIZE,
  HELP_TEXT,
  sha256Hex,
};
