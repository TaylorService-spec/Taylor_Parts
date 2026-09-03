// =================================================================================================
// WHICH FUNCTIONS A GENERAL platform-sandbox REFRESH IS ALLOWED TO DEPLOY
//
// THE RELEASE INVARIANT
//
//   A general platform-sandbox refresh deploys every Function that is APPLICABLE to
//   platform-sandbox, and MUST NOT be forced to deploy a Function whose governed deployment
//   prerequisites are intentionally absent in that environment.
//
// The refresh of 2026-09-03 failed on that second clause. Its final batch was
// `firebase deploy --only functions`, i.e. the whole codebase unfiltered, which pulled in
// `interpretWorkOrderReadinessContext` and demanded its five KEYSTONE_* secrets. Those secrets do
// not exist in platform-sandbox ON PURPOSE -- `privateAiSyntheticOperationalInterpretation` is
// false there -- so the deploy could only be satisfied by provisioning credentials for a capability
// nobody had authorized. Four named batches had already shipped; Hosting was never reached; Rules
// were never deployed. The estate was left half-new.
//
// The fix is a filter, not a weakening. The excluded function still binds all five secrets and
// still requires every one of them WHEN IT IS ITSELF DEPLOYED. Nothing here grants, activates, or
// stubs anything -- it only stops one environment's refresh from being held hostage by a capability
// that environment has deliberately not turned on.
//
// WHY A LIST OF EXCLUSIONS AND NOT A RULE ABOUT SECRETS
//
// "Has a secret" must NOT come to mean "skip in sandbox". A future function could bind a secret
// that platform-sandbox genuinely does have, and silently dropping it from every refresh would be a
// far worse defect than the one this file fixes -- it fails OPEN, and the symptom is a stale
// function nobody redeployed. So exclusion is an explicit, exact-id decision recorded below, and
// `assertManifestGoverned` REFUSES the release if a secret-bound function appears that is not on
// the list. A new secret-bound function stops the refresh and asks a human; it is never skipped.
//
// WHY THE COMPILED MANIFEST AND NOT functions/src/index.ts
//
// Because parsing the source is how this gets quietly wrong. scripts/buildCapabilityGraph.mjs has a
// `parseExports` that matches single-line `export { ... } from "..."` statements; run against
// index.ts it finds 55 of the 143 real exports, because most of that file uses multi-line export
// blocks. An enumerator that under-counts does not fail loudly -- it just deploys 55 functions and
// leaves 88 stale. `functions/lib/index.js` is the artifact `firebase deploy` itself loads to
// discover the codebase, and `__endpoint` is the SDK's own answer, so it cannot drift from what
// would actually ship.
//
// Requires `functions/lib` to be built (the runbook's step [1/5] does exactly that).
// =================================================================================================

import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

/**
 * Functions a general platform-sandbox refresh does NOT deploy.
 *
 * EXACT FUNCTION IDS, NEVER PREFIXES OR PATTERNS. A prefix quietly widens: `interpret*` would take
 * in the next function someone names that way, and the exclusion nobody chose is the one that
 * causes the outage. Every entry needs a reason naming the governed prerequisite that is absent.
 */
export const SANDBOX_REFRESH_EXCLUDED_FUNCTIONS = Object.freeze({
  interpretWorkOrderReadinessContext:
    "Binds the five KEYSTONE_* Secret Manager secrets. platform-sandbox has " +
    "privateAiSyntheticOperationalInterpretation = false, so those secrets are intentionally " +
    "absent and the private-AI capability is intentionally off. Deploying this function in " +
    "platform-sandbox would require provisioning Keystone credentials for a capability that " +
    "environment has not activated. Its non-secret sibling getWorkOrderReadinessContext is " +
    "unaffected and still deploys.",
});

/**
 * Load the compiled deploy manifest.
 *
 * Returns one entry per exported Cloud Function, in the SDK's own terms.
 */
export async function loadFunctionManifest(libIndexPath) {
  if (!existsSync(libIndexPath)) {
    throw new Error(
      `Functions manifest not built: ${libIndexPath}\n` +
        "Run `npm run build` in functions/ first (the refresh runbook does this at step [1/5]).",
    );
  }
  const module = await import(pathToFileURL(libIndexPath).href);
  const entries = [];
  for (const [name, value] of Object.entries(module)) {
    const endpoint = value?.__endpoint;
    if (!endpoint) continue;
    entries.push({
      name,
      secrets: (endpoint.secretEnvironmentVariables ?? []).map((entry) => entry.key).sort(),
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Refuse the release rather than deploy a set nobody decided on.
 *
 * Three ways this file can be wrong, all of them fail CLOSED:
 *  - the manifest is empty            -> the build did not produce what we think it did
 *  - an excluded id is not exported   -> the exclusion is stale, and is silently doing nothing
 *  - a secret-bound id is not excluded-> a new secret binding appeared; a human decides, not this
 */
export function assertManifestGoverned(manifest, excluded = SANDBOX_REFRESH_EXCLUDED_FUNCTIONS) {
  if (manifest.length === 0) {
    throw new Error("Functions manifest is empty -- refusing to derive a deploy set from nothing.");
  }
  const exported = new Set(manifest.map((entry) => entry.name));

  const stale = Object.keys(excluded).filter((name) => !exported.has(name));
  if (stale.length > 0) {
    throw new Error(
      `Excluded function(s) are no longer exported: ${stale.join(", ")}\n` +
        "Remove the stale entry from SANDBOX_REFRESH_EXCLUDED_FUNCTIONS, or restore the export.",
    );
  }

  const ungoverned = manifest.filter((entry) => entry.secrets.length > 0 && !(entry.name in excluded));
  if (ungoverned.length > 0) {
    throw new Error(
      "A secret-bound Function is not covered by a governed sandbox-refresh decision:\n" +
        ungoverned.map((e) => `  ${e.name}  [${e.secrets.join(", ")}]`).join("\n") +
        "\n\nDecide explicitly:\n" +
        "  - platform-sandbox HAS these secrets  -> deploy it; nothing to change here.\n" +
        "  - platform-sandbox intentionally lacks them -> add the exact id, with its reason, to\n" +
        "    SANDBOX_REFRESH_EXCLUDED_FUNCTIONS in scripts/sandboxDeployableFunctions.mjs.\n" +
        "Do NOT create the secrets merely to satisfy a deployment command.",
    );
  }
}

/** The applicable set: everything the manifest exports, minus the governed exclusions. */
export function deployableFunctionNames(manifest, excluded = SANDBOX_REFRESH_EXCLUDED_FUNCTIONS) {
  assertManifestGoverned(manifest, excluded);
  return manifest.map((entry) => entry.name).filter((name) => !(name in excluded));
}

/**
 * Chunk into `--only` filters.
 *
 * Not cosmetic. 142 filters in one argument is roughly 5.7KB of command line, close enough to the
 * Windows 8KB limit to be a bad thing to discover during a release; and this repository already
 * deploys in small named batches because a large batch that fails partway leaves the estate
 * half-new (see the runbook). Batching keeps a failure specific and its retry cheap.
 */
export function deployFilterBatches(names, size = 40) {
  if (!Number.isInteger(size) || size < 1) throw new Error(`batch size must be a positive integer: ${size}`);
  const batches = [];
  for (let i = 0; i < names.length; i += size) {
    batches.push(names.slice(i, i + size).map((name) => `functions:${name}`).join(","));
  }
  return batches;
}

// -- CLI: one `--only` filter per line, for the runbook to iterate ---------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const libIndex = process.argv[2];
  if (!libIndex) {
    console.error("usage: node scripts/sandboxDeployableFunctions.mjs <functions/lib/index.js>");
    process.exit(2);
  }
  try {
    const manifest = await loadFunctionManifest(libIndex);
    const names = deployableFunctionNames(manifest);
    const skipped = Object.keys(SANDBOX_REFRESH_EXCLUDED_FUNCTIONS);
    console.error(`derived ${names.length} deployable of ${manifest.length} exported`);
    for (const name of skipped) {
      console.error(`  excluded: ${name} -- ${SANDBOX_REFRESH_EXCLUDED_FUNCTIONS[name]}`);
    }
    for (const batch of deployFilterBatches(names)) console.log(batch);
  } catch (error) {
    console.error(`ABORT: ${error.message}`);
    process.exit(3);
  }
}
