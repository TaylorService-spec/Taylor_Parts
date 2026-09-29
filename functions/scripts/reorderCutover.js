// THE GOVERNED REORDER CUTOVER -- CENSUS, COPY ONCE (BY STAGE), VERIFY -- for the legacy Firestore Reorder objects,
// their assignments, and their purchase orders + voids, into eos_ops on PostgreSQL.
//
// ============================ WHAT THIS IS ============================
//
// The operator tool that carries the three EXISTING migration modules to the one place that holds the nonprod
// DATABASE_URL (the Render Shell on eos-api-nonprod). It decides NOTHING itself: every classification, every refusal
// and every write belongs to
//   src/eosOps/migration/reorderObjectMigrationCopy.ts         dryRun / copyReorderObjectsOnce / verify
//   src/eosOps/migration/reorderAssignmentMigrationCopy.ts     dryRun / copyReorderAssignmentsOnce / verify
//   src/eosOps/migration/reorderPurchaseOrderMigrationCopy.ts  dryRun / copyPurchaseOrdersOnce / verify
// and this file only reads the snapshot, applies the fence, enforces the stage ORDER, and prints evidence.
//
//   --mode census   READ ONLY. The snapshot's counts, Reorder status distribution and encoded-Timestamp findings; each
//                   stage's dry-run classification; the target tenant's current reorder_requests / current assignment /
//                   purchase_orders / purchase_order_voids counts. Writes nothing.
//   --mode copy --stage objects|assignments|purchasing
//                   ONE stage's existing copy-once, in its own transaction (the module's). Stages run in foreign-key
//                   order -- objects, then assignments, then purchasing (orders then voids, one transaction) -- and a
//                   stage whose prerequisite stage is not complete is REFUSED before anything is written. Identical
//                   rerun: no change (outcome NO_CHANGES).
//   --mode verify   READ ONLY. All three stages' existing verify functions, plus the snapshot-vs-target reconciliation
//                   (every snapshot record is present in the target).
//
// ============================ THE SOURCE IS A FILE ============================
//
// --snapshot names an EOS_REORDER_SNAPSHOT file (src/eosOps/migration/reorderSnapshot.ts documents the format) with
// its immutable `<snapshot>.sha256` beside it; every mode refuses a snapshot whose checksum file is missing or
// disagrees. THIS TOOL LOADS NO FIREBASE MODULE AND CANNOT WRITE FIRESTORE: it never deletes, marks or touches the
// legacy source, and it never deletes a PostgreSQL row. The snapshot must name the Firebase project the --environment
// declares, and never the production or Certification project.
//
// ============================ EVIDENCE DISCIPLINE ============================
//
// Output is ids, counts, dispositions and refusal CODES. No document field value, no refusal `detail` (a detail can
// quote a supplier name or a PO number), no legacy uid, no connection string.
//
// ============================ THE FENCE ============================
//
// Refuses, BEFORE `pg` or lib/ is loaded (functions/test/operatorScriptEnvironmentFence.test.mjs proves the order):
//   * no --environment declared in config/environments.json; production by role or by project id; no
//     --databaseUrlEnv (shared: measureEmployeeReferenceIntegrity.js assertMeasurementTarget)
//   * EOS_ENVIRONMENT not exactly `nonprod` (shared: measureWorkforceActivation.js assertNonprodRuntime)
//   * --environment platform-certification (the Certification world is frozen)
//   * missing --mode / --tenantKey / --snapshot; copy without --principalId or without a valid --stage; --stage outside
//     copy
// The tenant is resolved by --tenantKey from eos_policy.tenants and never created or inferred. The executor
// (--principalId) is validated by each copy module as an active Principal with an active membership in the tenant.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/reorderCutover.js --mode census --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey <tenant key> --snapshot <snapshot.json> \
//     --exclusionManifest ../docs/architecture/reorder-migration-exclusion-manifest.json
//   ... --mode copy --stage objects     --principalId <EOS principal id>
//   ... --mode copy --stage assignments --principalId <EOS principal id>
//   ... --mode copy --stage purchasing  --principalId <EOS principal id>
//   ... --mode verify
//
// Exit: 0 census copy-ready / copy applied or NO_CHANGES / verify reconciled; 1 census not copy-ready or verify not
// reconciled; 2 refused or failed. Output: one deterministic JSON document on stdout; refusals on stderr.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const { verifySnapshotChecksum, assertSnapshotSource } = require("./catalogCutover.js");

const MODES = Object.freeze(["census", "copy", "verify"]);
const STAGES = Object.freeze(["objects", "assignments", "purchasing"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const NOTHING_TO_COPY = "nothing to copy";

/** Every refusal that can be decided from argv and the process environment alone. No client, no lib/. */
function assertReorderCutoverInvocation(args, env) {
  if (!MODES.includes(args.mode)) {
    throw new Error(`--mode must be one of ${MODES.join(" | ")} (got ${args.mode === undefined ? "nothing" : `'${args.mode}'`}).`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen. The Reorder cutover neither reads it as a source nor writes its tenant.`);
  }
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.snapshot || args.snapshot === "true") throw new Error("--snapshot <file> is required: the copy consumes an exported snapshot, never a live Firestore read.");
  if (!args.exclusionManifest || args.exclusionManifest === "true") {
    throw new Error("--exclusionManifest <file> is required: the DQ-032 manifest of the eight synthetic fixtures the COPY excludes (docs/architecture/reorder-migration-exclusion-manifest.json).");
  }
  if (args.mode === "copy") {
    if (!STAGES.includes(args.stage)) {
      throw new Error(`--stage must be one of ${STAGES.join(" | ")} for copy (got ${args.stage === undefined ? "nothing" : `'${args.stage}'`}); stages run in that order, one per invocation.`);
    }
    if (!args.principalId || args.principalId === "true") {
      throw new Error("--principalId <EOS principal id> is required for copy: the import is executed as an EOS Principal, never a Firebase uid.");
    }
  } else if (args.stage !== undefined) {
    throw new Error("--stage applies only to --mode copy; census and verify always cover all three stages.");
  }
  return {
    mode: args.mode,
    stage: args.mode === "copy" ? args.stage : null,
    environmentId,
    connectionString,
    tenantKey: args.tenantKey,
    snapshotPath: args.snapshot,
    exclusionManifestPath: args.exclusionManifest,
    principalId: args.principalId,
  };
}

// ---------------------------------------------------------------------------------------------
// Evidence summaries: ids, dispositions, codes and counts. Never a row, never a detail string.
// ---------------------------------------------------------------------------------------------

function summarizeObjects(plan) {
  return {
    sourceRows: plan.sourceRows,
    counts: plan.counts,
    refusalCounts: plan.refusalCounts,
    unresolvedActors: plan.unresolvedActors,
    rows: plan.rows.map((r) => ({ id: r.reorderRequestId, disposition: r.disposition, refusalCode: r.refusalCode })),
  };
}

function summarizeAssignments(plan) {
  return {
    sourceRows: plan.sourceRows,
    counts: plan.counts,
    assignorCounts: plan.assignorCounts,
    blockedReorderIds: plan.blockedReorderIds,
    rows: plan.rows.map((r) => ({ id: r.reorderRequestId, disposition: r.disposition, assignorDisposition: r.assignorDisposition })),
  };
}

function summarizePurchasing(plan) {
  return {
    sourcePurchaseOrders: plan.sourcePurchaseOrders,
    sourceVoids: plan.sourceVoids,
    counts: plan.counts,
    voidCounts: plan.voidCounts,
    refusalCounts: plan.refusalCounts,
    purchaseOrders: plan.purchaseOrders.map((r) => ({ id: r.purchaseOrderId, disposition: r.disposition, refusalCode: r.refusalCode })),
    voids: plan.voids.map((r) => ({ id: r.purchaseOrderId, disposition: r.disposition, refusalCode: r.refusalCode })),
    incompleteAfterCopy: plan.incompleteAfterCopy.map((r) => ({ id: r.reorderRequestId, status: r.status })),
  };
}

/** Objects are complete when every snapshot Reorder is already in the target and none is refused. */
const objectsComplete = (plan) => plan.counts.MIGRATABLE === 0 && plan.counts.REFUSED === 0;
/** Assignments are complete when nothing is left to copy and nothing blocks. */
const assignmentsComplete = (plan) => plan.copyable.length === 0 && plan.blockedReorderIds.length === 0;
/** Purchasing is complete when every order and void is already in the target. */
const purchasingComplete = (plan) =>
  plan.counts.MIGRATABLE === 0 && plan.counts.REFUSED === 0 && plan.voidCounts.MIGRATABLE === 0 && plan.voidCounts.REFUSED === 0;

/**
 * Before the objects are copied, every purchase order legitimately classifies REORDER_REQUEST_NOT_MIGRATED (and its
 * void VOID_WITHOUT_PURCHASE_ORDER). Those are PENDING the objects stage, not blockers -- but only for a Reorder the
 * objects stage will actually copy. Anything else is a real census blocker.
 */
function purchasingBlockers(poPlan, objectPlan) {
  const willCopy = new Set(objectPlan.copyable.map((r) => r.reorderRequestId));
  // Plain arrays, not a Set: the structural test bans every Firestore write verb (`.add(`, `.set(`) in this file.
  const pendingPo = [];
  const blockers = [];
  for (const r of poPlan.purchaseOrders) {
    if (r.disposition !== "REFUSED") continue;
    if (r.refusalCode === "REORDER_REQUEST_NOT_MIGRATED" && willCopy.has(r.purchaseOrderId)) pendingPo.push(r.purchaseOrderId);
    else blockers.push({ id: r.purchaseOrderId, refusalCode: r.refusalCode });
  }
  let pendingVoids = 0;
  for (const r of poPlan.voids) {
    if (r.disposition !== "REFUSED") continue;
    if (r.refusalCode === "VOID_WITHOUT_PURCHASE_ORDER" && pendingPo.includes(r.purchaseOrderId)) pendingVoids += 1;
    else blockers.push({ id: r.purchaseOrderId, refusalCode: r.refusalCode, void: true });
  }
  return { blockers, pendingObjects: { purchaseOrders: pendingPo.length, voids: pendingVoids } };
}

async function targetCounts(pool, tenantId) {
  const one = async (sql) => Number((await pool.query(sql, [tenantId])).rows[0].n);
  return {
    reorderRequests: await one("SELECT count(*)::int AS n FROM eos_ops.reorder_requests WHERE tenant_id = $1"),
    reorderRequestsMigrated: await one("SELECT count(*)::int AS n FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND provenance = 'MIGRATED'"),
    currentAssignments: await one("SELECT count(*)::int AS n FROM eos_ops.reorder_request_assignments WHERE tenant_id = $1 AND effective_to IS NULL"),
    currentAssignmentsMigrated: await one("SELECT count(*)::int AS n FROM eos_ops.reorder_request_assignments WHERE tenant_id = $1 AND effective_to IS NULL AND provenance = 'MIGRATED'"),
    purchaseOrders: await one("SELECT count(*)::int AS n FROM eos_ops.purchase_orders WHERE tenant_id = $1"),
    purchaseOrderVoids: await one("SELECT count(*)::int AS n FROM eos_ops.purchase_order_voids WHERE tenant_id = $1"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client or lib/ module exists.
  const options = assertReorderCutoverInvocation(args, process.env);

  const { bytes, sha256 } = verifySnapshotChecksum(options.snapshotPath);
  let raw;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    // The parser's own message quotes the file's bytes; the operator gets the fact, not the content.
    throw new Error("the snapshot is not valid JSON; refused.");
  }
  // AFTER the fence, never at module scope.
  const snap = require("../lib/eosOps/migration/reorderSnapshot.js");
  const sourceSnapshot = snap.parseReorderSnapshot(raw);
  assertSnapshotSource(sourceSnapshot, options.environmentId);
  // DQ-032: the eight synthetic fixtures are EXCLUDED, never deleted from Firestore. The manifest must match its
  // .sha256 sidecar AND be byte-identical to the repository's declared manifest; every stage then sees only the
  // filtered snapshot, and the proof (source = retained + excluded, per collection) travels with the evidence.
  const manifestFile = verifySnapshotChecksum(options.exclusionManifestPath);
  const exclusion = require("../lib/eosOps/migration/reorderMigrationExclusion.js");
  const manifest = exclusion.assertDeclaredExclusionManifest(manifestFile.bytes.toString("utf8"));
  const { hash } = require("node:crypto");
  const excluded = exclusion.applyReorderExclusion(sourceSnapshot, manifest, (input) => hash("sha256", input));
  const snapshot = excluded.snapshot;
  const snapshotCensus = snap.censusReorderSnapshot(snapshot);
  const objectSource = snap.toReorderObjectSource(snapshot);
  const assignmentSource = snap.toReorderAssignmentSource(snapshot);
  const purchasingSource = snap.toPurchasingSource(snapshot);
  const evidence = {
    snapshotSha256: sha256, source: snapshot.source, snapshotCensus,
    exclusion: { manifestSha256: manifestFile.sha256, ...excluded.proof },
  };

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const objects = require("../lib/eosOps/migration/reorderObjectMigrationCopy.js");
  const assignments = require("../lib/eosOps/migration/reorderAssignmentMigrationCopy.js");
  const purchasing = require("../lib/eosOps/migration/reorderPurchaseOrderMigrationCopy.js");
  const pool = new pg.Pool({ ...resolvePolicyDatabaseConfig({ connectionString: options.connectionString }), max: 2 });
  // An idle-client error must not take the process down with a message that can carry a host.
  pool.on("error", () => undefined);
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; the cutover never creates one`);
    const tenantId = tenant.rows[0].id;
    const header = { mode: options.mode, environment: options.environmentId, tenantKey: options.tenantKey, tenantId };

    const dryObjects = () => objects.dryRunReorderObjectMigration(pool, { tenantId, source: objectSource });
    const dryAssignments = () => assignments.dryRunReorderAssignmentMigration(pool, { tenantId, source: assignmentSource });
    const dryPurchasing = () => purchasing.dryRunPurchaseOrderMigration(pool, { tenantId, source: purchasingSource });

    if (options.mode === "census") {
      const [objectPlan, assignmentPlan, purchasingPlan] = [await dryObjects(), await dryAssignments(), await dryPurchasing()];
      const po = purchasingBlockers(purchasingPlan, objectPlan);
      // WAREHOUSE IDENTITY (Controller pre-COPY gate, 2026-09-28): the legacy warehouse ids against this tenant's
      // eos_ops.warehouses, per warehouse, exact or not. Never translated; a mismatch blocks the copy.
      const warehouseIdentity = await censusReorderWarehouses(pool, tenantId, snapshot);
      const blockers = [];
      if (!warehouseIdentity.allExact) blockers.push("WAREHOUSE_IDENTITY");
      if (objectPlan.counts.REFUSED > 0) blockers.push("OBJECTS_REFUSED");
      if (assignmentPlan.blockedReorderIds.length > 0) blockers.push("ASSIGNMENTS_BLOCKED");
      if (po.blockers.length > 0) blockers.push("PURCHASING_REFUSED");
      const copyReady = blockers.length === 0;
      console.log(JSON.stringify({
        ...header, readOnly: true, copyReady, blockers,
        stages: {
          objects: summarizeObjects(objectPlan),
          assignments: summarizeAssignments(assignmentPlan),
          purchasing: { ...summarizePurchasing(purchasingPlan), pendingObjects: po.pendingObjects, blockers: po.blockers },
        },
        warehouseIdentity,
        target: await targetCounts(pool, tenantId),
        evidence,
      }, null, 2));
      process.exitCode = copyReady ? 0 : 1;
      return;
    }

    if (options.mode === "copy") {
      // ---- THE STAGE ORDER, proved against the target before anything is written ----
      const unmet = [];
      if (options.stage === "assignments" || options.stage === "purchasing") {
        if (!objectsComplete(await dryObjects())) unmet.push("objects");
      }
      if (options.stage === "purchasing") {
        if (!assignmentsComplete(await dryAssignments())) unmet.push("assignments");
      }
      if (unmet.length > 0) {
        console.log(JSON.stringify({
          ...header, stage: options.stage, outcome: "REFUSED", reason: "STAGE_PREREQUISITE_NOT_MET", unmetPrerequisites: unmet,
          target: await targetCounts(pool, tenantId), evidence,
        }, null, 2));
        process.exitCode = 2;
        return;
      }

      let result;
      let plan;
      let inserted;
      if (options.stage === "objects") {
        result = await objects.copyReorderObjectsOnce(pool, { tenantId, source: objectSource, performedByPrincipalId: options.principalId });
        plan = summarizeObjects(result.plan);
        inserted = { reorderRequests: result.inserted };
      } else if (options.stage === "assignments") {
        result = await assignments.copyReorderAssignmentsOnce(pool, { tenantId, source: assignmentSource, performedByPrincipalId: options.principalId });
        plan = summarizeAssignments(result.plan);
        inserted = { assignments: result.inserted };
      } else {
        result = await purchasing.copyPurchaseOrdersOnce(pool, { tenantId, source: purchasingSource, performedByPrincipalId: options.principalId });
        plan = summarizePurchasing(result.plan);
        inserted = { purchaseOrders: result.insertedPurchaseOrders, voids: result.insertedVoids };
      }
      const outcome = result.applied ? "COPIED" : result.refusal === NOTHING_TO_COPY ? "NO_CHANGES" : "REFUSED";
      console.log(JSON.stringify({
        ...header, stage: options.stage, executorPrincipalId: options.principalId, outcome, applied: result.applied,
        refusal: outcome === "REFUSED" ? result.refusal : null, inserted, plan,
        target: await targetCounts(pool, tenantId), evidence,
      }, null, 2));
      process.exitCode = outcome === "REFUSED" ? 2 : 0;
      return;
    }

    // ---- verify: the three existing verifies, and the snapshot-vs-target reconciliation ----
    const objectVerify = await objects.verifyReorderObjectMigration(pool, tenantId);
    const assignmentVerify = await assignments.verifyReorderAssignmentMigration(pool, { tenantId, source: assignmentSource });
    const purchasingVerify = await purchasing.verifyPurchaseOrderMigration(pool, tenantId);
    const [objectPlan, assignmentPlan, purchasingPlan] = [await dryObjects(), await dryAssignments(), await dryPurchasing()];
    const reconciliation = {
      objectsAllPresent: objectsComplete(objectPlan),
      assignmentsAllPresent: assignmentsComplete(assignmentPlan),
      purchasingAllPresent: purchasingComplete(purchasingPlan),
    };
    const reconciled = objectVerify.passed && assignmentVerify.passed && purchasingVerify.passed
      && reconciliation.objectsAllPresent && reconciliation.assignmentsAllPresent && reconciliation.purchasingAllPresent;
    console.log(JSON.stringify({
      ...header, readOnly: true, reconciled, reconciliation,
      stages: {
        objects: { verify: objectVerify, notYetPresent: objectPlan.counts.MIGRATABLE, refused: objectPlan.counts.REFUSED },
        assignments: { verify: assignmentVerify, notYetPresent: assignmentPlan.copyable.length, blocked: assignmentPlan.blockedReorderIds.length },
        purchasing: {
          verify: { ...purchasingVerify, incompleteLifecycles: purchasingVerify.incompleteLifecycles.map((r) => ({ id: r.reorderRequestId, status: r.status })) },
          notYetPresent: { purchaseOrders: purchasingPlan.counts.MIGRATABLE, voids: purchasingPlan.voidCounts.MIGRATABLE },
          refused: { purchaseOrders: purchasingPlan.counts.REFUSED, voids: purchasingPlan.voidCounts.REFUSED },
        },
      },
      target: await targetCounts(pool, tenantId),
      evidence,
    }, null, 2));
    process.exitCode = reconciled ? 0 : 1;
  } finally {
    await pool.end();
  }
}

// Declared after main() so the fence stays the only thing required at module scope (lib/ and pg load after it).
/** The warehouse-identity census: legacy ids (retained Reorders only) against eos_ops.warehouses for the tenant. */
async function censusReorderWarehouses(pool, tenantId, snapshot) {
  const { censusWarehouseIdentity } = require("../lib/eosOps/migration/reorderWarehouseIdentity.js");
  const warehouses = await pool.query(
    "SELECT id, operating_company_key, status FROM eos_ops.warehouses WHERE tenant_id = $1", [tenantId]);
  // The same ACTIVE-company x ACTIVE-binding view the object classifier resolves through.
  const bindings = await pool.query(
    `SELECT b.operating_company_id, b.operating_company_key
       FROM eos_policy.tenant_operating_company_keys b
       JOIN eos_policy.tenant_operating_companies c
         ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
      WHERE b.tenant_id = $1 AND b.status = 'ACTIVE' AND c.status = 'ACTIVE'`, [tenantId]);
  const keyByCompany = new Map(bindings.rows.map((r) => [r.operating_company_id, r.operating_company_key]));
  const refs = snapshot.collections.reorder_requests.map((d) => ({
    reorderId: d.id,
    warehouseId: d.data.warehouseId,
    boundCompanyKey: keyByCompany.get(d.data.operatingCompanyId) ?? null,
  }));
  return censusWarehouseIdentity(refs, warehouses.rows.map((r) => ({
    id: r.id, operatingCompanyKey: r.operating_company_key, status: r.status,
  })));
}

module.exports = { assertReorderCutoverInvocation, MODES, STAGES, FROZEN_ENVIRONMENTS };

if (require.main === module) {
  main().catch((err) => {
    // Governed refusals speak for themselves; a driver or connection error is reduced to its code, because its
    // message can carry a host or user.
    const governed = !err || !err.code || ["ReorderSnapshotError", "ReorderExclusionError"].includes(err.name);
    const message = governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed";
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", code: err && err.code ? err.code : null, message }, null, 2));
    process.exitCode = 2;
  });
}
