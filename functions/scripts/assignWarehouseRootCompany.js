/**
 * EOS Ownership Model v1 — BOUNDED WAREHOUSE ROOT COMPANY ASSIGNMENT (Workstream 2A.1B).
 *
 * Owner rulings R-19 … R-23, DECISIONS #150. Applies the five R-1 authored warehouse root company
 * facts to `eos-platform-sandbox`, once.
 *
 * ============================ A SEPARATE PATH, ON PURPOSE (R-23) ============================
 *
 * This is NOT the ownership backfill with wider caps. That applier's safety contract WAS its exact
 * document count and population, so raising its caps would retroactively change an authority that
 * was reviewed as bounded and turn it into a generic mutation vehicle. So this reuses its
 * PRIMITIVES — the company authority, the §3A validator, the authored root config, the audit writer,
 * the same two-flag posture — and owns its own scope, expectations, refusals and result count.
 *
 * ============================ SAFETY, IN THE ORDER IT IS ENFORCED ============================
 *
 *   DRY RUN BY DEFAULT.        Writes only with --apply.
 *   TARGET PROVEN BY PROJECT ID. NOT by registry role: eos-platform-sandbox and
 *                              eos-platform-certification both carry role `sandbox`, so a role check
 *                              cannot tell them apart. Production is refused by name, first.
 *   DELIBERATE CONFIRMATION.   --apply additionally requires
 *                              --confirm-warehouse-root-company-assignment. Two flags, so no single
 *                              mistyped word starts a write.
 *   AUTHORED FACTS ONLY.       The five assignments come from config/ownership/
 *                              operating-company-roots.sandbox.json and are cross-checked against a
 *                              pinned expectation. Drift in EITHER direction stops the run before a
 *                              single live read. Nothing is ever derived from a name, a location, a
 *                              line of business, a region or any display text.
 *   VALIDATE THE WHOLE BATCH,  A single refusal anywhere blocks the ENTIRE batch. There is no
 *   THEN MUTATE.               row-by-row mutation that could stop half way and leave a state no
 *                              ruling describes.
 *   PATCH ONLY.                One field, `operatingCompanyId`, via update. The document is never
 *                              reconstructed — a fixed-field replace is exactly how the migration
 *                              erase path came to exist.
 *   ONE TRANSACTION.           The five patches and their five audit events commit together, or not
 *                              at all.
 *   IDEMPOTENT.                An already-applied assignment is a success with NO write and NO audit
 *                              event, because the handoff authority is right that a handoff moving
 *                              nothing is not an event. A second run writes 0.
 *   NO REASSIGNMENT.           A warehouse already carrying a DIFFERENT company is refused. No
 *                              governed reassignment semantics exist and this does not invent them.
 *
 * DEPLOYMENT PRECONDITION, AND IT IS DATA SAFETY, NOT CEREMONY. The 2A.1A compatibility amendment
 * must already be DEPLOYED to the target project's Functions. Receiving is live in sandbox, and a
 * live receiveInventoryStock running the PRE-amendment validator rejects a company-bearing warehouse
 * as DESTINATION_INVALID. This script cannot verify a deployment, so it refuses to run --apply
 * without --functions-deployed-verified, which is the operator asserting they checked. That flag is
 * a statement of fact by a human, not a proof, and is treated as such.
 *
 * Usage:
 *   node scripts/assignWarehouseRootCompany.js --projectId eos-platform-sandbox
 *   node scripts/assignWarehouseRootCompany.js --projectId eos-platform-sandbox \
 *        --apply --confirm-warehouse-root-company-assignment --functions-deployed-verified
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  ASSIGNED_FIELD,
  ASSIGNMENT_OUTCOME,
  EXPECTED_ASSIGNMENT_COUNT,
  SOURCE_DECISION,
  TARGET_DECISION,
  assignmentHandoffInput,
  assignmentPatch,
  planWarehouseRootCompanyAssignment,
  resolveAssignmentTarget,
  resolveAuthoredWarehouseAssignments,
} = require("../lib/ownership/warehouseRootCompanyAssignment.js");
const { stageOwnershipHandoff } = require("../lib/ownership/ownershipHandoffCommand.js");

const ROOT_CONFIG = path.resolve(__dirname, "../../config/ownership/operating-company-roots.sandbox.json");
const ENVIRONMENTS_REGISTRY = path.resolve(__dirname, "../../config/environments.json");
const WAREHOUSES = "warehouses";
const CONFIRM_FLAG = "confirm-warehouse-root-company-assignment";
const DEPLOY_FLAG = "functions-deployed-verified";

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

/**
 * TWO INDEPENDENT GATES, because they catch different mistakes.
 *
 * The ALLOW-LIST (R-22) proves the target by project id, which is the only thing that can tell
 * eos-platform-sandbox from eos-platform-certification — they share the registry role `sandbox`.
 *
 * The REGISTRY check is this program's existing convention, and it catches what a name list cannot:
 * a NEW production project added to config/environments.json later that nobody remembered to add to
 * any script's refusal list. Unknown projects fail closed here too.
 *
 * Neither is sufficient alone, so both must pass.
 */
function assertNotProductionByRegistry(projectId) {
  const registry = JSON.parse(fs.readFileSync(ENVIRONMENTS_REGISTRY, "utf8"));
  const env = (registry.environments || []).find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) throw new Error(`REFUSING: '${projectId}' is not in the environment registry. Unknown projects fail closed.`);
  if (!env.role) throw new Error(`REFUSING: environment '${env.id}' has no registry role. A missing role fails closed.`);
  if (env.role === "production") throw new Error(`REFUSING: environment '${env.id}' has registry role 'production'.`);
  return env;
}

/** Every branch is a refusal. The only way through is an explicitly eligible project id. */
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
      throw new Error(`REFUSING: '${projectId}' is not an authorized assignment target.`);
  }
}

function assertAuthoredFacts() {
  const config = JSON.parse(fs.readFileSync(ROOT_CONFIG, "utf8"));
  const authored = resolveAuthoredWarehouseAssignments(config);
  if (authored.decision !== SOURCE_DECISION.MATCHED) {
    throw new Error(
      `REFUSING: the authored root config does not yield exactly the expected assignments ` +
        `(${authored.decision}${authored.detail === null ? "" : `: ${authored.detail}`}).`,
    );
  }
  return authored.assignments;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId || args.projectId === "true") throw new Error("--projectId is required. There is no default.");

  const apply = args.apply === "true";
  if (apply && args[CONFIRM_FLAG] !== "true") {
    throw new Error(`REFUSING: --apply also requires --${CONFIRM_FLAG}.`);
  }
  if (apply && args[DEPLOY_FLAG] !== "true") {
    throw new Error(
      `REFUSING: --apply also requires --${DEPLOY_FLAG}. The 2A.1A compatibility amendment must be ` +
        "DEPLOYED to this project's Functions first -- a live receiveInventoryStock on the pre-amendment " +
        "validator rejects a company-bearing warehouse as DESTINATION_INVALID.",
    );
  }

  const projectId = assertEligibleTarget(args.projectId, args["certification-authorized"] === "true");
  const authored = assertAuthoredFacts();

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  console.log(`Warehouse root company assignment — ${projectId}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (no writes)"}`);
  console.log(`Authored facts: ${EXPECTED_ASSIGNMENT_COUNT}, cross-checked against the pinned expectation\n`);

  const ids = Object.keys(authored);
  const snaps = await Promise.all(ids.map((id) => db.collection(WAREHOUSES).doc(id).get()));
  const candidates = snaps.map((snap, i) => ({ warehouseId: ids[i], data: snap.exists ? snap.data() : undefined }));

  const plan = planWarehouseRootCompanyAssignment(authored, candidates);

  const w = Math.max(...ids.map((id) => id.length));
  for (const d of plan.decisions) {
    const current = d.currentCompanyId === null ? "(none)" : d.currentCompanyId;
    console.log(
      `  ${d.warehouseId.padEnd(w)}  ${d.requestedCompanyId.padEnd(8)}  current=${current.padEnd(8)}  ${d.outcome}` +
        (d.detail === null ? "" : `  [${d.detail}]`),
    );
  }
  console.log(
    `\n  assign: ${plan.toAssign.length}   already assigned: ${plan.alreadyAssigned.length}   refusals: ${plan.refusals.length}`,
  );

  if (!plan.ok) {
    console.log(`\nBLOCKED — ${plan.blockedReason}`);
    console.log("Zero writes. The whole batch is validated before anything is mutated, so a refusal");
    console.log("anywhere stops all of it rather than leaving a partial assignment behind.");
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log(`\nDRY RUN complete. ${plan.toAssign.length} assignment(s) would be written, 0 were.`);
    console.log(`To apply: --apply --${CONFIRM_FLAG} --${DEPLOY_FLAG}`);
    return;
  }

  if (plan.toAssign.length === 0) {
    console.log("\nNothing to write — every authored assignment is already applied. No audit event emitted,");
    console.log("because a handoff that moves nothing is not an event.");
    return;
  }

  // ONE transaction: the patches and their audit events commit together or not at all. Each document
  // is re-read inside it, so a warehouse that changed between the plan and the commit fails closed
  // rather than being overwritten on stale evidence.
  const actorUid = args.actorUid && args.actorUid !== "true" ? args.actorUid : "operator";
  let written = 0;
  await db.runTransaction(async (txn) => {
    const refs = plan.toAssign.map((d) => db.collection(WAREHOUSES).doc(d.warehouseId));
    const fresh = await Promise.all(refs.map((ref) => txn.get(ref)));

    fresh.forEach((snap, i) => {
      const d = plan.toAssign[i];
      if (!snap.exists) throw new Error(`ABORTING: ${d.warehouseId} disappeared between plan and commit.`);
      const stored = snap.data()?.[ASSIGNED_FIELD];
      // The second overwrite guard, in-transaction. The plan already said this was unset; if it is
      // set now, someone else assigned it and this run must not overwrite their decision.
      if (stored !== undefined && stored !== null) {
        throw new Error(`ABORTING: ${d.warehouseId} gained a company (${stored}) between plan and commit.`);
      }
    });

    fresh.forEach((snap, i) => {
      const d = plan.toAssign[i];
      txn.update(refs[i], assignmentPatch(d));
      // The writer seam is anything with .set(ref, data) -- a Transaction is one, which is how the
      // audit event commits with the patch rather than beside it.
      stageOwnershipHandoff(txn, assignmentHandoffInput(d), { actorUid });
      written += 1;
    });
  });

  console.log(`\nAPPLIED. ${written} assignment(s) written, each with one OWNERSHIP_HANDOFF event`);
  console.log("(previousOwner = null). Re-run to confirm idempotency: it must write 0.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}

module.exports = { parseArgs, assertEligibleTarget, assertAuthoredFacts };
