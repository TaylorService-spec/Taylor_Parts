"use strict";

// ENVIRONMENT TARGET SELECTION -- the one shared, fail-closed answer to
// "which environment is this operator command about to touch?".
//
// ════════════════════ WHY THIS FILE EXISTS ════════════════════
//
// The binding rule is: NO EXPLICIT ENVIRONMENT = REFUSE. An operator command that
// can reach real business data must be told its target, per run, by the human who
// invoked it. None of the following may EVER pick the target:
//
//   - the active gcloud project (`gcloud config set project`)
//   - the active firebase project (.firebaserc "default", `firebase use`)
//   - Application Default Credentials (an `authorized_user` ADC's
//     `quota_project_id` is a real, machine-local default that firebase-admin and
//     @google-cloud/* will happily adopt -- see the trap note below)
//   - the working directory
//   - a hardcoded/implicit default inside the script
//
// ════════════════════ THIS IS NOT A NEW CONVENTION ════════════════════
//
// `assertProjectTarget(args)` below is the EXACT contract (same checks, same error
// text) that provisionEmployeeAccess.js, operatorAccessCommand.js,
// productionFoundationVerification.js, auditLegacyJobTechnicianData.js and
// authPr4RecoveryEmailMigration.js each carried as their own copy. This module is
// that convention promoted to one place, not a replacement for it. Scripts that
// already import it from provisionEmployeeAccess.js keep working unchanged --
// that module re-exports from here.
//
// `assertNonProductionTarget(projectId)` is likewise seedSandboxBaseline.js's
// registry-backed nonprod guard, promoted verbatim in behaviour: --projectId
// required, `taylor-parts` refused by name, unknown projects refused, and any
// environment whose REGISTRY ROLE is "production" refused. Role, never name, is
// the authority (ADR-011) -- the same key scripts/resolveEnvironment.mjs uses.
//
// ════════════════════ THE ADC / quota_project_id TRAP ════════════════════
//
// google-auth-library resolves a project id in this order
// (node_modules/google-auth-library/build/src/auth/googleauth.js, getProjectIdAsync):
//   1. GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT
//   2. the credential FILE's own project (an ADC written by
//      `gcloud auth application-default login` carries `quota_project_id`)
//   3. the GCE metadata server
//   4. an external-account client
// firebase-admin's own getExplicitProjectId() (node_modules/firebase-admin/lib/
// utils/index.js) is narrower -- app.options.projectId, then a ServiceAccount
// credential's project, then those same two env vars -- but every
// @google-cloud/* client underneath it falls back to the full chain.
//
// So a bare `initializeApp()`, or an `initializeApp({ projectId })` whose
// `projectId` came from a default rather than the operator, can bind to whatever
// project the machine's ADC happens to name. `assertResolvedProjectId()` below
// closes the remaining half of that gap: validating the STRING an operator typed
// does nothing unless the SDK actually bound to that same project.

const fs = require("node:fs");
const path = require("node:path");

/** The customer's production Firebase project. Kept as a constant, never inferred. */
const PRODUCTION_PROJECT_ID = "taylor-parts";

/** Thrown for every refusal in this module, so callers can distinguish "you
 *  invoked me wrongly" from "the operation itself failed". */
class EnvironmentTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = "EnvironmentTargetError";
  }
}

/**
 * REQUIRE an explicit --projectId, and require an explicit, matching
 * --confirmProduction when that project is production.
 *
 * Byte-for-byte the contract the five in-script copies carried. Do not relax it.
 *
 * @param {{projectId?: string, confirmProduction?: string}} args parsed CLI args
 * @param {{ErrorClass?: new (m: string) => Error}} [options]
 * @returns {string} the confirmed project id
 */
function assertProjectTarget(args, options) {
  const ErrorClass = (options && options.ErrorClass) || EnvironmentTargetError;
  // "true" is what the repo's flag parsers store for a valueless `--projectId`,
  // so it must be treated as absent rather than as a project literally named "true".
  if (!args || !args.projectId || args.projectId === "true") {
    throw new ErrorClass(
      "--projectId is required (no default target -- e.g. --projectId taylor-parts, or a non-production id for testing)."
    );
  }
  if (args.projectId === PRODUCTION_PROJECT_ID && args.confirmProduction !== PRODUCTION_PROJECT_ID) {
    throw new ErrorClass(
      `--projectId "${PRODUCTION_PROJECT_ID}" targets the production project -- this requires an explicit, ` +
        `matching --confirmProduction ${PRODUCTION_PROJECT_ID} flag as a deliberate, per-run confirmation. ` +
        `Use a different --projectId for emulator/non-production testing to skip this requirement.`
    );
  }
  return args.projectId;
}

/** Absolute path to the environment registry (ADR-011's single source of truth). */
function environmentRegistryPath() {
  return path.resolve(__dirname, "../../config/environments.json");
}

/** Read and parse config/environments.json. */
function loadEnvironmentRegistry(readFile) {
  const read = readFile || ((p) => fs.readFileSync(p, "utf8"));
  return JSON.parse(read(environmentRegistryPath()));
}

/** The registry entry whose Firebase project id is `projectId`, or undefined. */
function environmentForProjectId(registry, projectId) {
  const environments = (registry && registry.environments) || [];
  return environments.find((e) => e.firebase && e.firebase.projectId === projectId);
}

/**
 * Refuse any production target, and refuse anything the registry does not know.
 *
 * The registry is the authority (ADR-011), so this cannot drift from the
 * environment model -- and an UNKNOWN project fails closed rather than being
 * assumed safe. Promoted from seedSandboxBaseline.js; same checks, same order.
 *
 * @param {string|undefined} projectId
 * @param {{registry?: object}} [options]
 * @returns {object} the resolved registry environment
 */
function assertNonProductionTarget(projectId, options) {
  if (!projectId || projectId === "true") {
    throw new EnvironmentTargetError("--projectId is required. There is no default target.");
  }
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new EnvironmentTargetError(`REFUSING: ${PRODUCTION_PROJECT_ID} is the customer production project.`);
  }
  const registry = (options && options.registry) || loadEnvironmentRegistry();
  const env = environmentForProjectId(registry, projectId);
  if (!env) {
    throw new EnvironmentTargetError(
      `REFUSING: '${projectId}' is not a known provisioned environment in config/environments.json. ` +
        "Unknown projects fail closed."
    );
  }
  if (env.role === "production") {
    throw new EnvironmentTargetError(`REFUSING: environment '${env.id}' has role 'production'.`);
  }
  return env;
}

/**
 * Assert the SDK actually bound to the project the operator confirmed.
 *
 * Validating the typed string is only half a fence: `initializeApp()` (or a
 * client constructed without an explicit project) resolves its own target from
 * ambient credentials, which can silently diverge from --projectId. Mirrors
 * warehouseBackupRestoreCli.js's X-TARGETING-GUARD and _sandboxDeployGuard.mjs's
 * "assert the resolved identity, don't trust the input string" shape.
 *
 * @param {string|null|undefined} resolvedProjectId what the SDK says it bound to
 * @param {string} confirmedProjectId what the operator explicitly asked for
 */
function assertResolvedProjectId(resolvedProjectId, confirmedProjectId) {
  if (resolvedProjectId !== confirmedProjectId) {
    throw new EnvironmentTargetError(
      `firebase-admin resolved projectId '${resolvedProjectId === undefined ? "(undefined)" : resolvedProjectId}' ` +
        `does not match the confirmed target '${confirmedProjectId}': refusing to proceed ` +
        "(ambient credentials must not silently pick a different target)."
    );
  }
  return confirmedProjectId;
}

/**
 * REQUIRE that the per-environment capability activation project is stated
 * explicitly in the environment.
 *
 * functions/src/access/environmentCapabilityOverrides.ts's
 * resolveRuntimeCapabilityOverrides() reads
 * `GCLOUD_PROJECT ?? GOOGLE_CLOUD_PROJECT ?? null`. Deployed Cloud Functions
 * always have GCLOUD_PROJECT set by the runtime, so that is correct THERE. An
 * operator tool run from a laptop usually has NEITHER set, and then the override
 * set is silently EMPTY -- every capability registered `active: false` resolves
 * DENY, which is NOT what that environment's live authorization does.
 *
 * A parity/verification tool that swallows that difference reports a real,
 * legitimate grant as an anomaly. See
 * docs/architecture/environment-selection-fail-closed.md for the exact operations
 * affected and why "just remove the extra grants" is the wrong remedy.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [expectedProjectId] if given, the env var must also MATCH it
 * @returns {string} the activation project id
 */
function assertCapabilityActivationProject(env, expectedProjectId) {
  const source = env || {};
  const declared = source.GCLOUD_PROJECT || source.GOOGLE_CLOUD_PROJECT || null;
  if (!declared) {
    throw new EnvironmentTargetError(
      "REFUSING: neither GCLOUD_PROJECT nor GOOGLE_CLOUD_PROJECT is set. Per-environment capability " +
        "activation (functions/src/access/environmentCapabilityOverrides.ts) is keyed on that variable, " +
        "so with it unset EVERY `active: false` capability resolves DENY and this run would report " +
        "legitimate grants as anomalies. Set it explicitly to the environment being examined " +
        "(e.g. GCLOUD_PROJECT=eos-platform-sandbox) -- there is no safe default."
    );
  }
  if (expectedProjectId && declared !== expectedProjectId) {
    throw new EnvironmentTargetError(
      `REFUSING: capability activation is keyed on GCLOUD_PROJECT/GOOGLE_CLOUD_PROJECT='${declared}', ` +
        `but the confirmed data target is '${expectedProjectId}'. Comparing one environment's activation ` +
        "rules against another environment's data produces meaningless verdicts."
    );
  }
  return declared;
}

module.exports = {
  PRODUCTION_PROJECT_ID,
  EnvironmentTargetError,
  assertProjectTarget,
  assertNonProductionTarget,
  assertResolvedProjectId,
  assertCapabilityActivationProject,
  environmentRegistryPath,
  loadEnvironmentRegistry,
  environmentForProjectId,
};
