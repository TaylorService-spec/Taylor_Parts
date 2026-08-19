// X-PHANTOM-SALES-ORDER-LINK-REPAIR -- GOVERNED phantom Sales Order link repair OPERATOR CLI. Repository-only.
// INERT on import: it does NOT run merely because it is required (only main() under `require.main === module`
// does anything), and it lazy-requires firebase-admin inside a production-deps closure -- so importing this
// file performs NO Firestore read/write and touches no production. All orchestration is injected-deps so it
// is unit-testable offline. Mirrors functions/scripts/salesOrderNumberBackfillCli.js's conventions exactly
// (dry-run-default, plan content-hash pinning, all-or-nothing transaction, atomic evidence publish); adds a
// THIRD mode, --rollback, since this repair -- unlike the number backfill -- is meant to be reversible.
//
// THE REPAIR (see functions/src/repair/phantomSalesOrderLinkRepair.ts's header for the full judgement-call
// writeup): five Work Orders (wo-c713-1..5) carry `salesOrderId: "so-harbor-c713"`, a Sales Order that does
// not exist. This tool TOMBSTONES that link -- `salesOrderId` is never read as a write target and never
// modified (so fulfillment/coordinatedVisit.ts's exact-string grouping of these five Work Orders into one
// coordinated visit is completely undisturbed) -- by adding four new fields that make the previously-silent
// invalidity explicit and audited: `salesOrderLinkStatus: "ORPHANED"`, a reason, a repair-package pointer,
// and a server timestamp, staged in the SAME transaction as a durable Audit Event
// (action: "repairPhantomSalesOrderLink").
//
// THREE MODES:
//   dry-run (default): reads the live Work Orders whose salesOrderId equals --phantom-sales-order-id, plans
//     the repair, publishes plan.json (content-hash-pinned) + plan-report.md. Zero writes.
//   --execute: requires --acknowledge-production-write, --plan, and --plan-sha256 (the Owner-reviewed plan
//     hash). Re-reads live state in ONE Firestore transaction, fails closed on ANY drift (including the
//     phantom Sales Order having since come into existence), stages the repair + one Audit Event per Work
//     Order, and publishes execution-result.json (which carries each repaired document's POST-repair
//     updateTime -- the exact optimistic-concurrency precondition token --rollback binds to).
//   --rollback: requires --acknowledge-production-write and --execution-result (the execution-result.json a
//     prior --execute produced). For each repaired Work Order, clears EXACTLY the four fields this repair
//     wrote (functions/src/repair/phantomSalesOrderLinkRepair.ts's REPAIR_FIELD_NAMES) via a single
//     Firestore WriteBatch with a PER-DOCUMENT `{ lastUpdateTime }` precondition set to the value captured
//     right after the repair committed -- a document touched by anything else since the repair causes the
//     WHOLE batch to be refused (Firestore WriteBatch commit is atomic: one failed precondition fails all),
//     never partially or silently clobbered. Publishes rollback-result.json.
//
// PRODUCTION EXECUTION (--execute or --rollback) IS A PROTECTED ACTION -- see
// docs/operations/phantom-sales-order-link-repair-runbook.md. This tool being present and working does NOT
// authorize running it against any real project; that authorization is separate and is the Owner's alone.
//
// X-BACKFILL-ENVIRONMENT-GUARD (fail-closed target guard -- copied verbatim from
// salesOrderNumberBackfillCli.js, which is the established pattern this lane was told to follow): the only
// accepted --environment is exactly "sandbox"; the only accepted --project under it is the single sandbox
// project id resolved from config/environments.json. This check runs INSIDE parseArgs, which is called
// before buildProductionDeps() (the only place firebase-admin is required and Firestore is touched) in both
// the CLI entrypoint (main(), below) and every caller -- so a rejected configuration throws before
// firebase-admin is ever required and before any Firestore connection, read, or write is attempted.
"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
function normalizeHash(h) {
  return typeof h === "string" ? h.trim().toLowerCase() : "";
}
function isHex64(h) {
  return /^[0-9a-f]{64}$/.test(h);
}

const DEFAULT_PHANTOM_SALES_ORDER_ID = "so-harbor-c713";
const DEFAULT_REASON =
  "salesOrderId references a Sales Order that does not exist in the live sales_orders collection. " +
  "transitionWorkOrder's Sales Order fulfillment write-back gated on document existence and silently " +
  "proceeded without writing back or recording a skip; this Work Order completed/cancelled with no trace " +
  "of that skip until the H19 audit fix. salesOrderId is left UNCHANGED by this repair -- it is the shared " +
  "grouping key fulfillment/coordinatedVisit.ts uses to present these Work Orders as one coordinated visit.";

const lib = () => ({
  repair: require("../lib/repair/phantomSalesOrderLinkRepair.js"),
  evidence: require("../lib/repair/phantomSalesOrderLinkRepairEvidence.js"),
  auditEventWriter: require("../lib/access/auditEventWriter.js"),
});

// ---- environment guard: read-only local file, resolved BEFORE any Firebase/Firestore code runs ----------
function loadEnvironmentRegistry() {
  const registryPath = path.resolve(__dirname, "..", "..", "config", "environments.json");
  let raw;
  try {
    raw = fs.readFileSync(registryPath, "utf8");
  } catch (err) {
    throw new Error(`--environment sandbox requires config/environments.json to be readable at ${registryPath}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`config/environments.json is not valid JSON: ${err.message}`);
  }
}

function resolveSandboxProjectId(registry) {
  const ids = [...new Set(
    (registry.environments || [])
      .filter((e) => e && e.role === "sandbox" && e.firebase && typeof e.firebase.projectId === "string" && e.firebase.projectId.length > 0)
      .map((e) => e.firebase.projectId)
  )];
  if (ids.length !== 1) {
    throw new Error(`--environment sandbox requires config/environments.json to declare exactly one sandbox project id with a real firebase.projectId; found ${ids.length} (${JSON.stringify(ids)})`);
  }
  return ids[0];
}

function assertSandboxTarget(args) {
  if (!args.environment) throw new Error('--environment is required (the only accepted value today is "sandbox"; no default, nothing inferred)');
  if (args.environment !== "sandbox") {
    throw new Error(`--environment must be exactly "sandbox"; refusing '${args.environment}' (production and any other/unknown value are rejected)`);
  }
  const allowedProjectId = resolveSandboxProjectId(loadEnvironmentRegistry());
  if (args.projectId !== allowedProjectId) {
    throw new Error(`--environment sandbox only accepts --project '${allowedProjectId}'; refusing '${args.projectId}' (taylor-parts, aliases, near-misses, and any project not byte-identical to the registry-resolved sandbox id are refused; nothing is inferred from .firebaserc or the environment)`);
  }
}

function parseArgs(argv) {
  const args = {
    execute: false,
    rollback: false,
    acknowledgeProductionWrite: false,
    phantomSalesOrderId: DEFAULT_PHANTOM_SALES_ORDER_ID,
    reason: DEFAULT_REASON,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute") args.execute = true;
    else if (a === "--rollback") args.rollback = true;
    else if (a === "--acknowledge-production-write") args.acknowledgeProductionWrite = true;
    else if (a === "--environment") args.environment = argv[++i];
    else if (a === "--project") args.projectId = argv[++i];
    else if (a === "--confirm-project") args.confirmProjectId = argv[++i];
    else if (a === "--commit") args.governedCommit = argv[++i];
    else if (a === "--evidence-dir") args.evidenceDir = argv[++i];
    else if (a === "--plan") args.planPath = argv[++i];
    else if (a === "--plan-sha256") args.planSha256 = argv[++i];
    else if (a === "--execution-result") args.executionResultPath = argv[++i];
    else if (a === "--phantom-sales-order-id") args.phantomSalesOrderId = argv[++i];
    else if (a === "--reason") args.reason = argv[++i];
    else if (a === "--operator") args.operator = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (args.execute && args.rollback) throw new Error("--execute and --rollback are mutually exclusive");
  if (!args.projectId) throw new Error("--project is required");
  if (!args.confirmProjectId) throw new Error("--confirm-project is required (must exactly match --project)");
  if (args.confirmProjectId !== args.projectId) throw new Error("--confirm-project does not match --project; refusing to run");
  assertSandboxTarget(args);
  if (!args.governedCommit) throw new Error("--commit is required");
  if (!args.evidenceDir) throw new Error("--evidence-dir is required");
  if (!args.operator) throw new Error("--operator is required");
  if (args.execute) {
    if (!args.acknowledgeProductionWrite) throw new Error("--execute requires --acknowledge-production-write");
    if (!args.planPath) throw new Error("--execute requires --plan (the dry-run plan.json to bind to)");
    if (!args.planSha256) throw new Error("--execute requires --plan-sha256 (the Owner-reviewed plan hash)");
  }
  if (args.rollback) {
    if (!args.acknowledgeProductionWrite) throw new Error("--rollback requires --acknowledge-production-write");
    if (!args.executionResultPath) throw new Error("--rollback requires --execution-result (the execution-result.json a prior --execute produced)");
  }
  return args;
}

// Atomic evidence publish: write to a sibling temp dir, secret-scan every file, and only on a clean scan
// rename it into place. On ANY failure the temp dir is removed and NO final directory is left behind.
function publishEvidenceAtomically(fsDeps, finalDir, files) {
  const { evidence } = lib();
  const tmpDir = `${finalDir}.tmp-${fsDeps.stamp}`;
  fsDeps.rmrf(tmpDir);
  fsDeps.mkdirp(tmpDir);
  try {
    const checksums = [];
    for (const f of files) {
      const found = evidence.scanForSecrets(f.content);
      if (found.length > 0) throw new Error(`refusing to publish: evidence file ${f.name} contains secret-like content`);
      fsDeps.writeFile(path.join(tmpDir, f.name), f.content);
      checksums.push(`${sha256Hex(f.content)}  ${f.name}`);
    }
    fsDeps.writeFile(path.join(tmpDir, "checksums.sha256"), checksums.join("\n") + "\n");
    if (fsDeps.exists(finalDir)) throw new Error(`refusing to overwrite existing evidence dir ${finalDir}`);
    fsDeps.rename(tmpDir, finalDir);
    return finalDir;
  } catch (err) {
    fsDeps.rmrf(tmpDir);
    throw err;
  }
}

function planReportMarkdown(planEvidence, planFileSha256) {
  const { counts } = planEvidence;
  const lines = [
    "# Phantom Sales Order Link Repair -- dry-run plan",
    "",
    `- Generated: ${planEvidence.generatedAt}`,
    `- Project: ${planEvidence.projectId}`,
    `- Repository commit: ${planEvidence.governedCommit}`,
    `- Phantom Sales Order id under repair: ${planEvidence.phantomSalesOrderId}`,
    `- Repair package id: ${planEvidence.repairPackageId}`,
    `- Reason (written to every repaired record): ${planEvidence.reason}`,
    "",
    // See salesOrderNumberBackfillCli.js's planReportMarkdown for why these are two DIFFERENT hashes and
    // confusing them fails closed at execute (safely) rather than silently binding the wrong content.
    `- Bind this to --plan-sha256 at execute (sha256 of plan.json bytes): ${planFileSha256}`,
    `- Operative plan hash (stable across reruns when data is unchanged; NOT the --plan-sha256 value): ${planEvidence.planHash}`,
    "",
    `| considered | needs repair | already repaired | not this phantom id |`,
    `|---|---|---|---|`,
    `| ${counts.totalConsidered} | ${counts.needsRepair} | ${counts.alreadyRepaired} | ${counts.notTarget} |`,
    "",
    counts.needsRepair === 0
      ? "**Nothing to repair.** Every record either already carries `salesOrderLinkStatus` from a prior repair, or does not carry this phantom `salesOrderId` at all."
      : "Review `assignments` in plan.json -- each entry names the exact `workOrderId`, its `statusBefore`, its full `inventorySnapshotBefore`, and the exact proposed field changes -- before authorizing execute.",
    "",
  ];
  return lines.join("\n");
}

function executionReportMarkdown(execEvidence) {
  const { counts } = execEvidence;
  return [
    "# Phantom Sales Order Link Repair -- execution result",
    "",
    `- Generated: ${execEvidence.generatedAt}`,
    `- Project: ${execEvidence.projectId}`,
    `- Repository commit: ${execEvidence.governedCommit}`,
    `- Bound plan hash: ${execEvidence.boundPlanHash}`,
    `- Repaired: ${counts.repaired}`,
    `- Skipped (already repaired): ${counts.skippedAlreadyRepaired}`,
    "",
    "Each repaired Work Order's `postRepairUpdateTimeMillis` below is the exact optimistic-concurrency",
    "precondition token `--rollback` binds to -- rollback is refused (not applied) for any document changed",
    "since this execution.",
    "",
  ].join("\n");
}

function rollbackReportMarkdown(rollbackEvidence) {
  return [
    "# Phantom Sales Order Link Repair -- rollback result",
    "",
    `- Generated: ${rollbackEvidence.generatedAt}`,
    `- Project: ${rollbackEvidence.projectId}`,
    `- Repository commit: ${rollbackEvidence.governedCommit}`,
    `- Bound execution-result.json sha256: ${rollbackEvidence.boundExecutionEvidenceSha256}`,
    `- Rolled back: ${rollbackEvidence.rolledBack.length}`,
    `- Skipped: ${rollbackEvidence.skipped.length}`,
    ...(rollbackEvidence.skipped.length > 0
      ? ["", "Skipped records (precondition refused -- document changed since the repair; NOT applied):", ...rollbackEvidence.skipped.map((s) => `- ${s.workOrderId}: ${s.reason}`)]
      : []),
    "",
  ].join("\n");
}

async function runDryRun(deps, args) {
  const { repair, evidence } = lib();
  const records = await deps.readCandidateWorkOrders(args.phantomSalesOrderId);
  const plan = repair.planRepair(records, {
    phantomSalesOrderId: args.phantomSalesOrderId,
    reason: args.reason,
    repairPackageId: args.governedCommit,
  });
  const planEvidence = evidence.buildPlanEvidence(plan, { projectId: args.projectId, governedCommit: args.governedCommit, now: deps.now });
  const planJson = evidence.serializeEvidence(planEvidence);
  const planFileSha256 = sha256Hex(planJson);
  const dir = publishEvidenceAtomically(deps.fs, args.evidenceDir, [
    { name: "plan.json", content: planJson },
    { name: "plan-report.md", content: planReportMarkdown(planEvidence, planFileSha256) },
  ]);
  return { mode: "dry-run", plan, planEvidence, planFileSha256, evidenceDir: dir };
}

async function runExecute(deps, args) {
  const { evidence } = lib();
  const rawPlan = await deps.readPlanRaw(args.planPath);
  const expected = normalizeHash(args.planSha256);
  if (!isHex64(expected)) throw new Error("expected plan sha256 must be a normalized 64-hex value");
  const actualHash = sha256Hex(rawPlan);
  if (actualHash !== expected) throw new Error("plan hash mismatch: refusing to execute (no writes)");
  const planEvidence = JSON.parse(rawPlan);
  if (planEvidence.projectId !== args.projectId) throw new Error("plan.json project does not match --project: refusing to execute");
  if (planEvidence.governedCommit !== args.governedCommit) throw new Error("plan.json commit does not match --commit: refusing to execute");

  const plan = {
    phantomSalesOrderId: planEvidence.phantomSalesOrderId,
    repairPackageId: planEvidence.repairPackageId,
    reason: planEvidence.reason,
    assignments: planEvidence.assignments,
    alreadyRepaired: planEvidence.alreadyRepaired,
    counts: planEvidence.counts,
  };

  const { result, postRepairUpdateTimes } = await deps.runExecuteTxn({ plan });
  const execEvidence = evidence.buildExecutionEvidence(result, postRepairUpdateTimes, {
    projectId: args.projectId,
    governedCommit: args.governedCommit,
    boundPlanHash: actualHash,
    now: deps.now,
  });
  const dir = publishEvidenceAtomically(deps.fs, args.evidenceDir, [
    { name: "execution-result.json", content: evidence.serializeEvidence(execEvidence) },
    { name: "execution-report.md", content: executionReportMarkdown(execEvidence) },
  ]);
  return { mode: "execute", result, execEvidence, evidenceDir: dir };
}

async function runRollback(deps, args) {
  const { evidence } = lib();
  const rawExecutionResult = await deps.readExecutionResultRaw(args.executionResultPath);
  const execEvidence = JSON.parse(rawExecutionResult);
  if (execEvidence.kind !== "phantom-sales-order-link-repair-execution") {
    throw new Error("--execution-result does not look like a phantom-sales-order-link-repair execution-result.json");
  }
  if (execEvidence.projectId !== args.projectId) throw new Error("execution-result.json project does not match --project: refusing to roll back");
  const boundSha256 = sha256Hex(rawExecutionResult);

  const { rolledBack, skipped } = await deps.runRollbackBatch({ repaired: execEvidence.repaired });
  const rollbackEvidence = evidence.buildRollbackEvidence(
    { rolledBack, skipped },
    { projectId: args.projectId, governedCommit: args.governedCommit, boundExecutionEvidenceSha256: boundSha256, now: deps.now }
  );
  const dir = publishEvidenceAtomically(deps.fs, args.evidenceDir, [
    { name: "rollback-result.json", content: evidence.serializeEvidence(rollbackEvidence) },
    { name: "rollback-report.md", content: rollbackReportMarkdown(rollbackEvidence) },
  ]);
  return { mode: "rollback", rollbackEvidence, evidenceDir: dir };
}

async function run(deps, argv) {
  const args = parseArgs(argv);
  if (args.execute) return runExecute(deps, args);
  if (args.rollback) return runRollback(deps, args);
  return runDryRun(deps, args);
}

// Lazily build the real production deps -- firebase-admin is required ONLY here, never at import time.
function buildProductionDeps(projectId) {
  // eslint-disable-next-line global-require
  const admin = require("firebase-admin");
  const fs = require("node:fs");
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const WORK_ORDERS = "fieldops_wos";
  const SALES_ORDERS = "sales_orders";

  return {
    now: () => new Date(),
    async readCandidateWorkOrders(phantomSalesOrderId) {
      // Bounded, honest read: exactly the Work Orders whose live salesOrderId equals the phantom id under
      // repair -- never a full collection scan. Matches the scope contract in phantomSalesOrderLinkRepair.ts.
      const snap = await db.collection(WORK_ORDERS).where("salesOrderId", "==", phantomSalesOrderId).get();
      return snap.docs.map((d) => ({
        workOrderId: d.id,
        salesOrderId: d.get("salesOrderId"),
        status: d.get("status"),
        inventorySnapshot: d.get("inventorySnapshot"),
        salesOrderLinkStatus: d.get("salesOrderLinkStatus"),
      }));
    },
    async readPlanRaw(p) {
      return fs.readFileSync(p, "utf8");
    },
    async readExecutionResultRaw(p) {
      return fs.readFileSync(p, "utf8");
    },
    async runExecuteTxn({ plan }) {
      const { repair, auditEventWriter } = lib();
      const result = await db.runTransaction(async (txn) => {
        const ids = plan.assignments.map((a) => a.workOrderId);
        const woRefs = ids.map((id) => db.collection(WORK_ORDERS).doc(id));
        const woSnaps = ids.length > 0 ? await Promise.all(woRefs.map((r) => txn.get(r))) : [];
        const soSnap = await txn.get(db.collection(SALES_ORDERS).doc(plan.phantomSalesOrderId));

        const staged = [];
        const store = {
          async readWorkOrders() {
            return woSnaps.map((s) => ({
              workOrderId: s.id,
              salesOrderId: s.exists ? s.get("salesOrderId") : undefined,
              status: s.exists ? s.get("status") : undefined,
              inventorySnapshot: s.exists ? s.get("inventorySnapshot") : undefined,
              salesOrderLinkStatus: s.exists ? s.get("salesOrderLinkStatus") : undefined,
            }));
          },
          async readSalesOrderExists() {
            return soSnap.exists;
          },
          stageRepair(workOrderId, fields) {
            staged.push({ workOrderId, fields });
          },
        };

        const execResult = await repair.executeRepair({ plan, store, actorId: "tool:phantom-sales-order-link-repair" });
        for (const s of staged) {
          const ref = db.collection(WORK_ORDERS).doc(s.workOrderId);
          txn.update(ref, {
            salesOrderLinkStatus: s.fields.salesOrderLinkStatus,
            salesOrderLinkOrphanedReason: s.fields.salesOrderLinkOrphanedReason,
            salesOrderLinkRepairPackageId: s.fields.salesOrderLinkRepairPackageId,
            salesOrderLinkRepairedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          auditEventWriter.stageAuditEvent(txn, {
            actorUid: "tool:phantom-sales-order-link-repair",
            action: "repairPhantomSalesOrderLink",
            targetType: "workOrder",
            targetId: s.workOrderId,
            outcome: "applied",
            summary: `Work Order ${s.workOrderId} salesOrderId '${plan.phantomSalesOrderId}' does not resolve to a live Sales Order; tombstoned via salesOrderLinkStatus=ORPHANED. salesOrderId left unchanged (coordinated-visit grouping key). Repair package ${plan.repairPackageId}.`,
          });
        }
        return execResult;
      });

      // Post-commit reads (outside the transaction, deliberately) to capture each repaired document's
      // updateTime AFTER the write landed -- that value, not any pre-commit estimate, is the exact
      // precondition token --rollback must bind to.
      const postRepairUpdateTimes = new Map();
      for (const r of result.repaired) {
        // eslint-disable-next-line no-await-in-loop
        const snap = await db.collection(WORK_ORDERS).doc(r.workOrderId).get();
        postRepairUpdateTimes.set(r.workOrderId, snap.updateTime.toMillis());
      }
      return { result, postRepairUpdateTimes };
    },
    async runRollbackBatch({ repaired }) {
      const { repair: repairLib, auditEventWriter } = lib();
      const batch = db.batch();
      const rolledBack = [];
      const skipped = [];
      const clearPayload = Object.fromEntries(repairLib.REPAIR_FIELD_NAMES.map((f) => [f, admin.firestore.FieldValue.delete()]));
      for (const entry of repaired) {
        const ref = db.collection(WORK_ORDERS).doc(entry.workOrderId);
        try {
          const precondition = { lastUpdateTime: admin.firestore.Timestamp.fromMillis(entry.postRepairUpdateTimeMillis) };
          batch.update(ref, clearPayload, precondition);
          auditEventWriter.stageAuditEvent(batch, {
            actorUid: "tool:phantom-sales-order-link-repair",
            action: "rollbackPhantomSalesOrderLinkRepair",
            targetType: "workOrder",
            targetId: entry.workOrderId,
            outcome: "applied",
            summary: `Rolled back the phantom Sales Order link repair on Work Order ${entry.workOrderId}: cleared ${repairLib.REPAIR_FIELD_NAMES.join(", ")}.`,
          });
          rolledBack.push(entry.workOrderId);
        } catch (err) {
          skipped.push({ workOrderId: entry.workOrderId, reason: err instanceof Error ? err.message : String(err) });
        }
      }
      if (rolledBack.length === 0) {
        return { rolledBack: [], skipped };
      }
      // Firestore WriteBatch.commit() is atomic across every write it carries: if ANY per-document
      // `lastUpdateTime` precondition fails, the ENTIRE batch is refused -- nothing partially applies. This
      // is the "refused rather than clobbered" guarantee the task requires, and it is strictly stronger than
      // per-document try/catch (which is why preconditions are validated here, up front, rather than only
      // relied upon at commit time -- a mismatch is caught before the network round-trip when detectable
      // client-side is not always possible, so commit() itself is still the authority).
      try {
        await batch.commit();
        return { rolledBack, skipped };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          rolledBack: [],
          skipped: repaired.map((entry) => ({
            workOrderId: entry.workOrderId,
            reason: `batch refused (one or more documents changed since the repair): ${message}`,
          })),
        };
      }
    },
    fs: {
      stamp: String(process.pid),
      mkdirp: (d) => fs.mkdirSync(d, { recursive: true }),
      rmrf: (d) => fs.rmSync(d, { recursive: true, force: true }),
      writeFile: (p, c) => fs.writeFileSync(p, c, "utf8"),
      exists: (p) => fs.existsSync(p),
      rename: (a, b) => fs.renameSync(a, b),
    },
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  const deps = buildProductionDeps(args.projectId);
  return run(deps, argv);
}

module.exports = {
  parseArgs,
  publishEvidenceAtomically,
  runDryRun,
  runExecute,
  runRollback,
  run,
  buildProductionDeps,
  resolveSandboxProjectId,
  loadEnvironmentRegistry,
  DEFAULT_PHANTOM_SALES_ORDER_ID,
  DEFAULT_REASON,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2))
    .then((r) => {
      console.log(JSON.stringify({ ok: true, mode: r.mode, evidenceDir: r.evidenceDir }, null, 2));
      process.exitCode = 0;
    })
    .catch((err) => {
      console.error(`PHANTOM SALES ORDER LINK REPAIR CLI FAILURE: ${err.message}`);
      process.exitCode = 2;
    });
}
