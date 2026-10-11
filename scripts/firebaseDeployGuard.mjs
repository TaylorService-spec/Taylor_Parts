#!/usr/bin/env node
/**
 * Firebase deploy guard (F0) -- FAIL-CLOSED project identity for EVERY `firebase deploy`.
 *
 * WHY THIS EXISTS. The Firebase CLI resolves its target project from, in order: `--project`, the
 * per-directory `firebase use` selection the CLI keeps in the operator's home directory, and the
 * `.firebaserc` default. Until F0 the `.firebaserc` default was `taylor-parts` -- the historical
 * PRODUCTION project -- so a bare `firebase deploy`, a bare `firebase deploy --only firestore:rules`
 * or `npm run deploy` in functions/ silently targeted production. Changing the default alone is not
 * enough: a stale `firebase use taylor-parts` on an operator machine overrides `.firebaserc`
 * without any trace in this repository.
 *
 * HOW IT IS WIRED. firebase.json declares this script as the FIRST `predeploy` command of every
 * deployable target (functions, hosting, firestore, storage). firebase-tools runs every target's
 * predeploy hooks BEFORE any target is prepared or released, with the resolved project in
 * GCLOUD_PROJECT, and aborts the whole deploy when a hook exits non-zero. A refusal here therefore
 * means nothing was uploaded, whichever way the project was selected. Hooks also run under
 * `--dry-run` and inside `hosting:channel:deploy`.
 *
 * THE RULE.
 *   - No project, a demo-* project, or a project the environment registry does not declare: REFUSED.
 *   - A declared NON-production project with a Firebase project id (platform-sandbox,
 *     platform-certification): allowed. The governed sandbox refresh is unchanged.
 *   - A PRODUCTION project (config/environments.json role "production", and always `taylor-parts`
 *     even if the registry were misread): REFUSED unless EOS_FIREBASE_PRODUCTION_DEPLOY equals
 *     `<projectId>@<full HEAD sha>:<target>` -- the checkout being deployed AND the ONE target it authorizes.
 *     Each target's hook checks its own name, so a confirmation for `functions` cannot carry a deploy that
 *     forgot `--only` into firestore (Rules + indexes, Tier 2), storage or hosting, and a confirmation left in
 *     a shell authorizes only that same target at that same commit. The governed runbooks
 *     (scripts/_prodRelease.run.sh, scripts/deployHosting.mjs --allow-production, the
 *     verify-rules-deploy checklist) set it explicitly for one command. Binding it to the commit
 *     means a confirmation left in a shell cannot authorize a later, different checkout.
 *
 * Firebase is retirement-only (DECISIONS: FIREBASE->EOS only). This guard adds no Firebase
 * dependency: it is a local process that reads two repository files and `git rev-parse HEAD`.
 *
 * Usage (from firebase.json; the CLI sets GCLOUD_PROJECT):
 *   node scripts/firebaseDeployGuard.mjs <target>
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The production project that existed before the registry; refused even if the registry is wrong. */
export const PRODUCTION_FLOOR = Object.freeze(["taylor-parts"]);
export const CONFIRMATION_ENV = "EOS_FIREBASE_PRODUCTION_DEPLOY";
export const DEPLOY_TARGETS = Object.freeze(["functions", "hosting", "firestore", "storage"]);

/** Classifies every Firebase project id the environment registry declares. */
export function projectClasses(registry) {
  const production = new Set(PRODUCTION_FLOOR);
  const nonProduction = new Set();
  for (const env of registry?.environments ?? []) {
    const projectId = env?.firebase?.projectId;
    if (typeof projectId !== "string" || projectId.length === 0) continue;
    if (env.role === "production") production.add(projectId);
    else nonProduction.add(projectId);
  }
  for (const id of production) nonProduction.delete(id);
  return { production, nonProduction };
}

/** The exact confirmation a governed production deploy of `headSha` must carry. */
export function productionConfirmation(projectId, headSha, target) {
  return `${projectId}@${headSha}:${target}`;
}

/**
 * Pure decision. Returns { allowed, code, message }. Never throws for bad input -- it refuses.
 */
export function decideFirebaseDeploy({ projectId, target, confirmation, headSha, registry }) {
  const refuse = (code, message) => ({ allowed: false, code, message });
  if (!DEPLOY_TARGETS.includes(target)) {
    return refuse("UNKNOWN_TARGET", `deploy target '${target}' is not guarded; add it to DEPLOY_TARGETS and firebase.json together`);
  }
  if (typeof projectId !== "string" || projectId.trim() === "") {
    return refuse("NO_PROJECT", "no Firebase project resolved; name it explicitly with --project <id>");
  }
  if (projectId.startsWith("demo-")) {
    return refuse("DEMO_PROJECT", `'${projectId}' is an emulator-only demo project (the repository default); a deploy must name a real project with --project <id>`);
  }
  const { production, nonProduction } = projectClasses(registry);
  if (production.has(projectId)) {
    if (typeof headSha !== "string" || !/^[0-9a-f]{40}$/.test(headSha)) {
      return refuse("PRODUCTION_NO_COMMIT", `'${projectId}' is PRODUCTION and the deployed commit could not be identified; refusing`);
    }
    const expected = productionConfirmation(projectId, headSha, target);
    if (confirmation !== expected) {
      return refuse(confirmation ? "PRODUCTION_CONFIRMATION_MISMATCH" : "PRODUCTION_UNCONFIRMED",
        `'${projectId}' is PRODUCTION. A ${target} deploy there is a governed, Owner-authorized act; run it through ` +
        `scripts/_prodRelease.run.sh, scripts/deployHosting.mjs --allow-production or the verify-rules-deploy checklist, ` +
        `which set ${CONFIRMATION_ENV}=${projectId}@<HEAD sha>:${target} for that one command and that one target` +
        (confirmation ? ` (got '${confirmation}', expected '${expected}')` : ""));
    }
    return { allowed: true, code: "PRODUCTION_CONFIRMED", message: `governed production ${target} deploy of ${headSha} to '${projectId}'` };
  }
  if (nonProduction.has(projectId)) {
    return { allowed: true, code: "NON_PRODUCTION", message: `${target} deploy to non-production '${projectId}'` };
  }
  return refuse("UNDECLARED_PROJECT", `'${projectId}' is not declared in config/environments.json; refusing to deploy to an unknown project`);
}

function readHeadSha(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const target = argv[0];
  let registry;
  try {
    registry = JSON.parse(readFileSync(join(REPO, "config", "environments.json"), "utf8"));
  } catch (err) {
    console.error(`FIREBASE DEPLOY REFUSED [REGISTRY_UNREADABLE]: config/environments.json: ${err.message}`);
    return 1;
  }
  const decision = decideFirebaseDeploy({
    projectId: env.GCLOUD_PROJECT,
    target,
    confirmation: env[CONFIRMATION_ENV],
    headSha: readHeadSha(REPO),
    registry,
  });
  if (!decision.allowed) {
    console.error(`FIREBASE DEPLOY REFUSED [${decision.code}]: ${decision.message}`);
    console.error("Nothing was prepared, uploaded or released.");
    return 1;
  }
  console.log(`firebase deploy guard: ${decision.code} -- ${decision.message}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
