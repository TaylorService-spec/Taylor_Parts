// X-BACKFILL-ENVIRONMENT-GUARD -- the ONE implementation of the governed operator-CLI target guard.
//
// Previously this logic was copy-pasted verbatim into three CLIs
// (salesOrderNumberBackfillCli.js, phantomSalesOrderLinkRepairCli.js,
// warehouseAssignmentProvisioningCli.js). That triplication is what let a single registry change
// break all three silently, so the guard now lives here and each CLI re-exports it.
//
// WHAT THE GUARD IS FOR (see the commit that introduced it, 5d3c51ab 2026-08-18): a governed CLI's
// target used to be enforced only by the operator's command line -- it would happily accept
// `--project taylor-parts` (production, per .firebaserc) as long as --confirm-project matched.
// The guard's safety property is therefore:
//
//     production, aliases, near-misses, unknown projects and ANY implicit default are refused;
//     nothing is ever inferred from .firebaserc, process.env or ambient credentials.
//
// WHAT THE GUARD IS *NOT* FOR: it was never a promise that the estate contains exactly one sandbox.
// The original implementation resolved the sandbox project by filtering the registry to
// `role === "sandbox"` with a real firebase.projectId and then requiring that set to have exactly
// ONE member. On 2026-08-18 that happened to be true. On 2026-08-30 commit 55041a07 registered
// `platform-certification` (role "sandbox", a real projectId), the set became two, and all three
// CLIs began throwing on EVERY `--environment sandbox` invocation -- including the correct,
// documented one. The uniqueness requirement was an ASSUMPTION that expired, not the safety property.
//
// THE FIX, and the line it holds: the guard no longer RESOLVES a project from the role -- it
// VALIDATES the project the operator named. `--project` is required, has no default, and must be
// byte-identical to one of the sandbox project ids the registry declares. When more than one
// qualifies the CLI does not choose: the operator has already chosen, twice, via --project and
// --confirm-project. A fourth sandbox environment therefore cannot break this again, and cannot
// silently become the target either.
//
// This mirrors the established house pattern in
// functions/scripts/certificationWorld/executionTarget.mjs, which likewise holds an explicit set of
// named live-writable project ids ("Refusing rather than choosing") rather than deriving a unique one.
//
// ============================== OWNER QUESTION (P2-M, 2026-09-12) ==============================
// UNRESOLVED, and deliberately NOT decided in code: should these three tools be allowed to target
// `eos-platform-certification` at all?
//
// What this file implements is the non-guessing reading: `--environment sandbox` does not bind to any
// one project, and the operator's explicitly-named --project decides. That is strictly safer than the
// alternative (silently binding "sandbox" to platform-sandbox), and it matches
// certificationWorld/executionTarget.mjs, which likewise holds a named set rather than deriving a
// unique one. But it does mean certification became reachable by these tools, which it was not before
// 2026-08-30 -- not because anyone authorized it, but because certification did not exist yet.
//
// Every runbook for all three tools names `eos-platform-sandbox` explicitly
// (docs/operations/sales-order-number-backfill-runbook.md,
//  docs/operations/phantom-sales-order-link-repair-runbook.md,
//  docs/operations/warehouse-assignment-provisioning-runbook.md), so no documented operation changes
// behaviour either way. Note also that platform-certification's own registry entry says its dataset is
// seeded ONLY from the certification-world fixture authority and is exercised by bounded
// Certification operator tools -- which these three are not.
//
// The Owner's options, none of which this lane may pick unilaterally:
//   (a) leave it as is -- any declared sandbox, named explicitly and confirmed twice;
//   (b) narrow these three tools to eos-platform-sandbox by an explicit per-tool allowlist;
//   (c) require a per-project acknowledgement flag, as executionTarget.mjs does with
//       --apply-live-sandbox / --apply-live-certification.
// ===============================================================================================
//
// NO I/O BEYOND ONE LOCAL JSON READ. config/environments.json is read with node:fs. Nothing here
// requires firebase-admin, opens a connection, or touches Firestore -- which is what lets every
// caller run this inside parseArgs(), before buildProductionDeps() is ever called.
"use strict";

const path = require("node:path");
const fs = require("node:fs");

const SANDBOX_ROLE = "sandbox";

function registryPath() {
  return path.resolve(__dirname, "..", "..", "config", "environments.json");
}

function loadEnvironmentRegistry() {
  const p = registryPath();
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    throw new Error(`--environment sandbox requires config/environments.json to be readable at ${p}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`config/environments.json is not valid JSON: ${err.message}`);
  }
}

// Every project id the registry declares under role "sandbox" WITH a real firebase.projectId, in
// declaration order, deduped. `local-emulator` is excluded here and always has been -- not because
// its role is wrong (it IS a sandbox, correctly labelled) but because its `firebase` identity is
// deliberately null, so it has no project id to target. Excluding it is the filter working, not a bug.
//
// Throws ONLY when the set is empty: a registry with no targetable sandbox means there is nothing
// `--environment sandbox` could legitimately name, and guessing is exactly what this guard forbids.
// It does NOT throw when there is more than one -- deciding among them is the operator's job, and
// assertSandboxTarget below makes them do it explicitly.
function resolveSandboxProjectIds(registry) {
  const ids = [...new Set(
    ((registry && registry.environments) || [])
      .filter((e) => e && e.role === SANDBOX_ROLE && e.firebase && typeof e.firebase.projectId === "string" && e.firebase.projectId.length > 0)
      .map((e) => e.firebase.projectId)
  )];
  if (ids.length === 0) {
    throw new Error(
      "--environment sandbox requires config/environments.json to declare at least one environment with " +
      'role "sandbox" and a real firebase.projectId; found none. Refusing rather than inferring a target.'
    );
  }
  return ids;
}

// `args` needs only { environment, projectId }. Callers enforce --confirm-project identity separately.
function assertSandboxTarget(args) {
  if (!args.environment) throw new Error('--environment is required (the only accepted value today is "sandbox"; no default, nothing inferred)');
  if (args.environment !== SANDBOX_ROLE) {
    throw new Error(`--environment must be exactly "sandbox"; refusing '${args.environment}' (production and any other/unknown value are rejected)`);
  }
  const allowedProjectIds = resolveSandboxProjectIds(loadEnvironmentRegistry());
  if (!allowedProjectIds.includes(args.projectId)) {
    throw new Error(
      `--environment sandbox only accepts --project from the sandbox project ids declared in ` +
      `config/environments.json (${JSON.stringify(allowedProjectIds)}); refusing '${args.projectId}' ` +
      `(taylor-parts, aliases, near-misses, and any project not byte-identical to a declared sandbox id ` +
      `are refused; nothing is inferred from .firebaserc or the environment, and when more than one ` +
      `sandbox is declared this tool refuses to choose -- name the one you mean)`
    );
  }
  return args.projectId;
}

module.exports = {
  SANDBOX_ROLE,
  loadEnvironmentRegistry,
  resolveSandboxProjectIds,
  assertSandboxTarget,
};
