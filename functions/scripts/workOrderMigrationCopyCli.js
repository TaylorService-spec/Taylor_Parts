#!/usr/bin/env node
// WORK ORDER MIGRATION -- the governed COPY ONCE / VERIFY operator.
//
// ════════════════════ THIS FILE IS A FENCE, NOT A MIGRATION ════════════════════
//
// Every migration decision lives in src/eosOps/migration/workOrderMigrationDryRun.ts (classification,
// fixture evidence, Owner manifest, type normalization) and workOrderMigrationCopy.ts (plan, schema
// guards, collision recheck, one transaction, verify). This file adds an operator fence and calls them.
// It computes no plan, writes no SQL and decides nothing about any record -- a CLI that re-derived even
// one of those would be a second migration nobody reviewed, and the two would disagree exactly once.
//
//   node scripts/workOrderMigrationCopyCli.js --environment platform-sandbox \
//     --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod --performedBy <operator> \
//     --snapshot-sha <sha256> --manifest docs/assessments/<owner-manifest>.json [--apply]
//
// DRY RUN BY DEFAULT. `--apply` is the only path that writes, and it re-runs the same preflight the dry
// run prints before it opens a transaction.
//
// THE FENCE, before `pg`, firebase-admin or lib/ loads: a registry --environment that is not production
// by role or by project id, an explicit --databaseUrlEnv, EOS_ENVIRONMENT exactly `nonprod`, the frozen
// Certification world refused, --tenantKey / --performedBy / --snapshot-sha required. The source Firebase
// project is taken from the registry entry and must be the sandbox; production is refused by name.
//
// NO --force AND NO OVERRIDE. The snapshot fence has no escape hatch: a COPY against a source that moved
// is a COPY of decisions that were made about different records.
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { join } = require("node:path");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const REPO_ROOT = join(__dirname, "..", "..");
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const PRODUCTION_PROJECT_ID = "taylor-parts";
const SOURCE_COLLECTION = "fieldops_wos";
const SHA256 = /^[0-9a-f]{64}$/;

function assertCopyInvocation(args, env) {
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen.`);
  }
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.performedBy || args.performedBy === "true" || !/^[A-Za-z0-9._@-]{1,100}$/.test(args.performedBy)) {
    throw new Error("--performedBy <operator> is required ([A-Za-z0-9._@-], at most 100).");
  }
  const snapshotSha = args["snapshot-sha"] ?? args.snapshotSha;
  if (!snapshotSha || snapshotSha === "true" || !SHA256.test(snapshotSha)) {
    throw new Error("--snapshot-sha <sha256> is required: COPY runs against ONE measured source, stated by the operator.");
  }
  if (!args.manifest || args.manifest === "true") {
    throw new Error("--manifest <file> is required: the Owner company resolutions are evidence, not defaults.");
  }
  // There is no way to proceed past a drifted source. Naming the flags refuses them loudly.
  for (const forbidden of ["force", "no-drift-check", "acceptLatest", "accept-latest"]) {
    if (args[forbidden] !== undefined) {
      throw new Error(`--${forbidden} is not accepted: a drifted source invalidates every decision this COPY carries.`);
    }
  }
  return {
    environmentId, connectionString, tenantKey: args.tenantKey, performedBy: args.performedBy,
    snapshotSha, manifestPath: args.manifest, apply: args.apply === "true",
  };
}

/** The source Firebase project for a registry environment. Production is refused by name. */
function assertSourceProject(environmentId, repoRoot = REPO_ROOT) {
  const registry = JSON.parse(readFileSync(join(repoRoot, "config", "environments.json"), "utf8"));
  const entry = (registry.environments ?? []).find((e) => e && e.id === environmentId);
  const projectId = entry && entry.firebase && entry.firebase.projectId;
  if (!projectId) throw new Error(`--environment '${environmentId}' declares no Firebase project; the source is never inferred.`);
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(`--environment '${environmentId}' names the customer production project '${PRODUCTION_PROJECT_ID}'. Refused.`);
  }
  return projectId;
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

async function main() {
  const options = assertCopyInvocation(parseArgs(process.argv.slice(2)), process.env);
  const sourceProject = assertSourceProject(options.environmentId);

  const pg = require("pg");
  const admin = require("firebase-admin");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const dry = require("../lib/eosOps/migration/workOrderMigrationDryRun.js");
  const copy = require("../lib/eosOps/migration/workOrderMigrationCopy.js");

  admin.initializeApp({ projectId: sourceProject });
  const firestore = admin.firestore();
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));

  try {
    // ── the source, read once ──
    const records = (await firestore.collection(SOURCE_COLLECTION).get()).docs.map((d) => ({ id: d.id, data: d.data() }));
    const snapshot = dry.buildSourceSnapshot(sourceProject, SOURCE_COLLECTION, records, sha256);

    // ── DRIFT FENCE, before anything else is computed ──
    copy.assertNoSourceDrift(snapshot.bodySha256, options.snapshotSha);

    // ── exactly the supporting facts the classification needs ──
    const technicians = new Map((await firestore.collection("fieldops_technicians").get()).docs
      .map((d) => [d.id, { employeeId: d.get("employeeId") ?? null }]));
    const employees = new Set((await firestore.collection("employees").get()).docs.map((d) => d.id));
    const referenced = (field) => [...new Set(records.map((r) => r.data[field]).filter((v) => typeof v === "string" && v))];
    const salesOrders = new Map();
    for (const id of referenced("salesOrderId")) {
      const doc = await firestore.collection("sales_orders").doc(id).get();
      if (doc.exists) salesOrders.set(id, { operatingCompanyId: doc.get("operatingCompanyId") ?? null });
    }
    const setOf = async (collection, ids) => {
      const out = new Set();
      for (const id of ids) { const doc = await firestore.collection(collection).doc(id).get(); if (doc.exists) out.add(id); }
      return out;
    };
    const accounts = await setOf("accounts", referenced("customerId"));
    const locations = await setOf("locations", referenced("locationId"));
    const equipment = await setOf("equipment", referenced("equipmentId"));

    // ── the tenant and the target's readiness ──
    const tenantRows = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenantRows.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; this tool never creates one`);
    const tenantId = tenantRows.rows[0].id;
    copy.assertTargetSchemaReady(await copy.readTargetSchemaState(pool, tenantId));

    const targetRows = await pool.query("SELECT id FROM eos_ops.work_orders WHERE tenant_id = $1", [tenantId]);
    const targetWorkOrderIds = new Set(targetRows.rows.map((r) => String(r.id)));
    const baseEvidence = { technicians, employees, salesOrders, accounts, locations, equipment, targetWorkOrderIds };

    // ── the manifest is validated against the CLASSIFIED population, so two passes ──
    const firstPass = dry.runDryRun({ snapshot, records, evidence: { ...baseEvidence, resolutionManifest: null } });
    const manifest = dry.validateResolutionManifest(
      JSON.parse(readFileSync(join(REPO_ROOT, options.manifestPath), "utf8")),
      {
        snapshotBodySha256: snapshot.bodySha256,
        businessIds: new Set(firstPass.records.filter((r) => r.recordClass === "BUSINESS").map((r) => r.workOrderId)),
        fixtureIds: new Set(firstPass.records.filter((r) => r.recordClass !== "BUSINESS").map((r) => r.workOrderId)),
        employeeIds: employees,
      });
    const report = dry.runDryRun({ snapshot, records, evidence: { ...baseEvidence, resolutionManifest: manifest } });

    // ── every company resolved THROUGH the governed binding, never by string equality ──
    const keyByCompanyId = new Map();
    for (const companyId of new Set([...manifest.byWorkOrderId.values()].map((d) => d.operatingCompanyId))) {
      const bound = await copy.resolveOperatingCompanyKey(pool, tenantId, companyId);
      keyByCompanyId.set(companyId, bound.operatingCompanyKey);
    }
    const plan = copy.buildCopyPlan({ report, records, manifest, operatingCompanyKeyByCompanyId: keyByCompanyId });
    const collisions = await copy.recheckTargetCollisions(pool, tenantId, plan);
    const tally = (value) => [...collisions.values()].filter((v) => v === value).length;

    const preflight = {
      sourceProject, snapshotBodySha256: snapshot.bodySha256,
      business: report.summary.provenBusiness,
      excluded: report.summary.excluded,
      copyable: report.summary.copyable,
      blocked: report.summary.blocked,
      blockersByKind: report.summary.blockersByKind,
      targetAbsent: tally("TARGET_ABSENT"),
      alreadyPresentEquivalent: tally("ALREADY_PRESENT_EQUIVALENT"),
      targetConflict: tally("TARGET_CONFLICT"),
      operatingCompanyIds: [...new Set(plan.map((p) => p.operatingCompanyId))].sort(),
      operatingCompanyKeys: [...new Set(plan.map((p) => p.operatingCompanyKey))].sort(),
      planSize: plan.length,
    };

    if (!options.apply) {
      console.log(JSON.stringify({ mode: "DRY_RUN", environment: options.environmentId, tenantKey: options.tenantKey, preflight }, null, 2));
      return;
    }

    // copyOnce re-checks collisions inside its own transaction and refuses on conflict; this is the
    // operator-facing half of the same gate, so a refusal is legible before a transaction is opened.
    if (preflight.blocked !== 0 || preflight.targetConflict !== 0) {
      throw new Error(`WORK_ORDER_COPY_PREFLIGHT_DRIFT: blocked=${preflight.blocked}, targetConflict=${preflight.targetConflict}`);
    }
    const runId = `wo-copy-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
    const outcome = await copy.copyOnce(pool, {
      tenantId, runId, plan, decisionId: manifest.decisionId, apply: true,
    });
    const verification = await copy.verifyCopy(pool, tenantId, plan);
    const after = await pool.query("SELECT count(*)::int AS n FROM eos_ops.work_orders WHERE tenant_id = $1", [tenantId]);
    const partsPlanAfter = await pool.query("SELECT count(*)::int AS n FROM eos_ops.work_order_parts_plan WHERE tenant_id = $1", [tenantId]);

    console.log(JSON.stringify({
      mode: "APPLY", environment: options.environmentId, tenantKey: options.tenantKey,
      performedBy: options.performedBy, decisionId: manifest.decisionId, runId,
      preflight,
      copy: {
        attempted: plan.length, inserted: outcome.inserted,
        alreadyPresentEquivalent: outcome.alreadyPresentEquivalent, conflicts: outcome.conflicts,
        partsPlanRowsInserted: outcome.partsPlanRowsInserted, committed: outcome.applied,
      },
      verify: {
        checked: verification.checked, ok: verification.ok,
        missing: verification.missing, mismatches: verification.mismatches,
      },
      target: { workOrders: after.rows[0].n, workOrderPartsPlan: partsPlanAfter.rows[0].n },
    }, null, 2));
    if (!verification.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

module.exports = { assertCopyInvocation, assertSourceProject, SOURCE_COLLECTION };

if (require.main === module) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
