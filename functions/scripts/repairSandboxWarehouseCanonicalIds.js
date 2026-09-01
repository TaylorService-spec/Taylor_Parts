/**
 * BOUNDED SANDBOX WAREHOUSE CANONICAL-ID REPAIR (Owner ruling R-27, DECISIONS #151).
 *
 * Two sandbox warehouse roots were seeded without their canonical stored `id`, so the §3A validator
 * refuses them (`id_invalid`) and they are not governed warehouses at all. This adds that one field.
 *
 * ============================ WHY NOT THE MIGRATION CLI ============================
 *
 * It would have repaired these, and it was refused, because it RECONSTRUCTS the document:
 * provenance NATIVE -> MIGRATED, governanceInitialized* populated, updatedBy seed-script ->
 * operator. Those describe a migration event that did not happen. These records were natively
 * created by a seed script that forgot one field.
 *
 * ============================ SAFETY, IN THE ORDER IT IS ENFORCED ============================
 *
 *   DRY RUN BY DEFAULT.        Writes only with --apply.
 *   TARGET PROVEN BY PROJECT ID. Shared with assignWarehouseRootCompany -- ONE target authority for
 *                              this family. Production refused by name; certification refused
 *                              despite sharing the `sandbox` registry role; unknown refused.
 *   DELIBERATE CONFIRMATION.   --apply additionally requires
 *                              --confirm-warehouse-canonical-id-repair. Purpose-named, never a
 *                              generic --force, so the flag cannot be reused for something else.
 *   TWO RECORDS, ONE FIELD.    Both are constants in the pure module, not parameters. The difference
 *                              between a bounded repair and a generic patch utility is whether the
 *                              caller gets to choose.
 *   EXACT EXPECTED DEFECT.     Stored id absent, validator failing ONLY id_invalid, provenance
 *                              NATIVE, no governance-init metadata, no operating company, and the
 *                              one-field patch proven sufficient by the REAL validator. Anything
 *                              else is refused with its reason.
 *   PREFLIGHT THE BATCH.       One refusal blocks both. Two records is small enough that partial
 *                              repair looks harmless, which is exactly why it is forbidden.
 *   PATCH, NEVER RECONSTRUCT.  txn.update with ONE key.
 *   NO BUSINESS EVENT.         No OWNERSHIP_HANDOFF. Nothing changes hands; a record starts stating
 *                              the id it always had.
 *   IDEMPOTENT.                An already-correct id is a success with no write. A second run writes 0.
 *
 * Usage:
 *   node scripts/repairSandboxWarehouseCanonicalIds.js --projectId eos-platform-sandbox
 *   node scripts/repairSandboxWarehouseCanonicalIds.js --projectId eos-platform-sandbox \
 *        --apply --confirm-warehouse-canonical-id-repair
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  REPAIRABLE_WAREHOUSE_IDS,
  REPAIRED_FIELD,
  REPAIR_OUTCOME,
  canonicalIdPatch,
  planCanonicalIdRepair,
} = require("../lib/ownership/warehouseCanonicalIdRepair.js");
// ONE target authority for this operator family -- see assignWarehouseRootCompany.js.
const { TARGET_DECISION, resolveAssignmentTarget } = require("../lib/ownership/warehouseRootCompanyAssignment.js");

const ENVIRONMENTS_REGISTRY = path.resolve(__dirname, "../../config/environments.json");
const WAREHOUSES = "warehouses";
const CONFIRM_FLAG = "confirm-warehouse-canonical-id-repair";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    }
  }
  return out;
}

/** The registry gate: catches a future production project no name list knows about. */
function assertNotProductionByRegistry(projectId) {
  const registry = JSON.parse(fs.readFileSync(ENVIRONMENTS_REGISTRY, "utf8"));
  const env = (registry.environments || []).find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) throw new Error(`REFUSING: '${projectId}' is not in the environment registry. Unknown projects fail closed.`);
  if (!env.role) throw new Error(`REFUSING: environment '${env.id}' has no registry role. A missing role fails closed.`);
  if (env.role === "production") throw new Error(`REFUSING: environment '${env.id}' has registry role 'production'.`);
  return env;
}

function assertEligibleTarget(projectId, certificationAuthorized) {
  const target = resolveAssignmentTarget(projectId, { certificationAuthorized });
  switch (target.decision) {
    case TARGET_DECISION.ELIGIBLE:
      assertNotProductionByRegistry(target.projectId);
      return target.projectId;
    case TARGET_DECISION.REFUSED_PRODUCTION:
      throw new Error("REFUSING: taylor-parts is the customer production project.");
    case TARGET_DECISION.REFUSED_CERTIFICATION_NOT_AUTHORIZED:
      throw new Error(
        "REFUSING: eos-platform-certification shares the `sandbox` registry role but is a different world. " +
          "It requires its own explicit authorization (--certification-authorized), which this run does not carry.",
      );
    default:
      throw new Error(`REFUSING: '${projectId}' is not an authorized repair target.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId || args.projectId === "true") throw new Error("--projectId is required. There is no default.");

  const apply = args.apply === "true";
  if (apply && args[CONFIRM_FLAG] !== "true") throw new Error(`REFUSING: --apply also requires --${CONFIRM_FLAG}.`);

  const projectId = assertEligibleTarget(args.projectId, args["certification-authorized"] === "true");

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  console.log(`Warehouse canonical-id repair — ${projectId}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (no writes)"}`);
  console.log(`Scope: ${REPAIRABLE_WAREHOUSE_IDS.join(", ")} — field: ${REPAIRED_FIELD}\n`);

  const snaps = await Promise.all(REPAIRABLE_WAREHOUSE_IDS.map((id) => db.collection(WAREHOUSES).doc(id).get()));
  const candidates = snaps.map((snap, i) => ({
    warehouseId: REPAIRABLE_WAREHOUSE_IDS[i],
    data: snap.exists ? snap.data() : undefined,
  }));

  const plan = planCanonicalIdRepair(candidates);
  const w = Math.max(...REPAIRABLE_WAREHOUSE_IDS.map((id) => id.length));
  for (const d of plan.decisions) {
    console.log(
      `  ${d.warehouseId.padEnd(w)}  current=${String(d.currentId ?? "(absent)").padEnd(20)} requested=${d.requestedId.padEnd(20)}` +
        `  validator before=${String(d.validatorBefore ?? "valid").padEnd(12)} after=${String(d.validatorAfter ?? "valid").padEnd(12)}` +
        `  changes=[${d.plannedChangedKeys.join(",")}]  ${d.outcome}` +
        (d.detail === null ? "" : `  [${d.detail}]`),
    );
  }
  console.log(`\n  repair: ${plan.toRepair.length}   already correct: ${plan.alreadyCorrect.length}   refusals: ${plan.refusals.length}`);

  if (!plan.ok) {
    console.log(`\nBLOCKED — ${plan.blockedReason}`);
    console.log("Zero writes. The whole batch is validated before anything is mutated.");
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log(`\nDRY RUN complete. ${plan.toRepair.length} record(s) would be repaired, 0 were.`);
    console.log(`To apply: --apply --${CONFIRM_FLAG}`);
    return;
  }

  if (plan.toRepair.length === 0) {
    console.log("\nNothing to write — both records already carry their canonical id.");
    return;
  }

  let written = 0;
  await db.runTransaction(async (txn) => {
    const refs = plan.toRepair.map((d) => db.collection(WAREHOUSES).doc(d.warehouseId));
    const fresh = await Promise.all(refs.map((ref) => txn.get(ref)));

    fresh.forEach((snap, i) => {
      const d = plan.toRepair[i];
      if (!snap.exists) throw new Error(`ABORTING: ${d.warehouseId} disappeared between plan and commit.`);
      // Re-read guard: the plan said the id was absent. If it is set now, someone else wrote it and
      // this run must not overwrite their value.
      const stored = snap.data()?.[REPAIRED_FIELD];
      if (stored !== undefined) {
        throw new Error(`ABORTING: ${d.warehouseId} gained an id (${String(stored)}) between plan and commit.`);
      }
    });

    fresh.forEach((_snap, i) => {
      txn.update(refs[i], canonicalIdPatch(plan.toRepair[i]));
      written += 1;
    });
  });

  console.log(`\nAPPLIED. ${written} record(s) repaired — one field each, no audit event (nothing changed hands).`);
  console.log("Re-run to confirm idempotency: it must write 0.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}

module.exports = { parseArgs, assertEligibleTarget };
