// PRODUCTION PUBLISH TRIGGER FENCE. A workflow that publishes to GitHub Pages may declare NO
// automatic trigger -- only `workflow_dispatch`.
//
// ============================ THE FAILURE THIS EXISTS TO STOP ============================
//
// .github/workflows/deploy-field-ops.yml published the PRODUCTION-identified frontend on every
// push to `main` matching `index.html`, `field-ops-app-vite/**` or the workflow file itself. It
// runs a bare `npm run build`, so config/environments.json's `defaultEnvironmentId` --
// `taylor-parts-production` -- applied, and the artifact self-identified as environmentRole
// `production`. Measured on main's first-parent history: 838 of 1990 merges matched those paths.
// A production-identified build of in-flight work was republished roughly every other merge,
// outside the promotion lifecycle, with no Owner acceptance anywhere in the path.
//
// The Owner ruled Option A (docs/deployment/github-pages-promotion-governance-decision.md):
// production Pages publishing is `workflow_dispatch`-only. MERGE TO main IS NOT A PUBLISH.
//
// A one-line trigger is a one-line revert. Prose in the workflow header cannot stop that, and the
// repository has already learned -- #1929 -- that a governance property nothing executes is a
// property nobody finds out has gone. So the ruling is a test.
//
// ======================= WHY IT SCANS, RATHER THAN NAMING THE FILE =======================
//
// The fenced set is DERIVED, not configured: any workflow whose source uses the GitHub Pages
// publishing actions (`actions/deploy-pages`, `actions/upload-pages-artifact`) is a publishing
// workflow. So the defect cannot come back under a new filename, which is the same property that
// makes scripts/workflowSelfPushFence.mjs worth having. Renaming deploy-field-ops.yml, or adding
// a second Pages publisher, is caught by construction.
//
// ============================ WHAT COUNTS AS AUTOMATIC ============================
//
// Everything except `workflow_dispatch`. The rule is an allowlist rather than a blocklist of
// `push`/`pull_request`/`schedule`, because a blocklist is only ever as complete as the list of
// event names someone remembered: `workflow_run`, `repository_dispatch`, `release`, `create` and
// `status` would all publish automatically too, and a future GitHub event name would publish
// automatically and silently. A publish that a human did not personally start is the thing being
// fenced, whatever the event is called.
//
// `workflow_call` is NOT allowlisted on purpose: a reusable-workflow call is triggered by its
// CALLER, so allowing it would let any caller's `push:` publish production at one remove.
//
// ============================ THE EXPECTED SET IS A RATCHET ============================
//
// EXPECTED_PRODUCTION_PUBLISHERS records the publishing workflows known when this fence was
// written. If one stops publishing or disappears, this fence FAILS until the line is removed --
// so the guard cannot be defeated by quietly deleting the thing it guards and leaving a fence
// that scans an empty set and reports success. Retiring the Pages surface (the decision
// document's Option C) is allowed; doing it without saying so is not.
//
// Run: node scripts/productionPublishTriggerFence.mjs
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");

/** The only trigger a production-publishing workflow may declare. */
export const MANUAL_TRIGGERS = new Set(["workflow_dispatch"]);

/** Publishing workflows known to exist. SHRINK ONLY, and only deliberately. See the header. */
export const EXPECTED_PRODUCTION_PUBLISHERS = new Set(["deploy-field-ops.yml"]);

/** The GitHub Pages publishing actions. Using either one makes a workflow a publisher. */
const PAGES_PUBLISH_ACTIONS = /actions\/(deploy-pages|upload-pages-artifact)@/;

/**
 * Does this workflow publish to GitHub Pages?
 *
 * Whole-line YAML comments are stripped first, so this file's own prose -- and the header of
 * deploy-field-ops.yml, which names the actions while explaining them -- cannot make a workflow
 * look like a publisher it is not.
 */
export function publishesToPages(source) {
  return String(source)
    .split(/\r?\n/)
    .some((line) => !/^\s*#/.test(line) && PAGES_PUBLISH_ACTIONS.test(line));
}

const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, "").trim();

/**
 * The trigger names a workflow declares, in source order.
 *
 * A deliberate line walk rather than a YAML parse: neither package here declares a YAML library
 * (see field-ops-app-vite/test/workflowSyntax.test.mjs on exactly this point), and the three
 * legal spellings of `on:` are simple enough to read directly:
 *
 *     on: push                          -> ["push"]
 *     on: [push, workflow_dispatch]     -> ["push", "workflow_dispatch"]
 *     on:\n  push:\n    branches: [main] -> ["push"]
 *
 * Only DIRECT children of `on:` are triggers; `branches:`, `paths:` and `inputs:` sit deeper and
 * are ignored. `on` is matched at column 0 only, so a `push:` inside some other block is not
 * mistaken for a trigger. Returns [] when the workflow declares no `on:` at all.
 */
export function declaredTriggers(source) {
  const lines = String(source).split(/\r?\n/);
  const triggers = [];
  let childIndent = null;
  let inOn = false;

  for (const raw of lines) {
    if (raw.trim() === "" || /^\s*#/.test(raw)) continue;
    const indent = raw.search(/\S/);
    const body = raw.slice(indent);

    if (!inOn) {
      if (indent !== 0) continue;
      // GitHub accepts `on`, and YAML 1.1 readers may render it quoted or as `true`.
      const m = /^(?:on|"on"|'on'|true):(.*)$/.exec(body);
      if (!m) continue;
      const rest = m[1].replace(/\s#.*$/, "").trim();
      if (rest.startsWith("[")) {
        for (const item of rest.replace(/^\[/, "").replace(/\]$/, "").split(",")) {
          if (unquote(item)) triggers.push(unquote(item));
        }
        return triggers;
      }
      if (rest) return [unquote(rest)];
      inOn = true;
      continue;
    }

    if (indent === 0) break;              // dedent to column 0 ends the `on:` block
    if (childIndent === null) childIndent = indent;
    if (indent !== childIndent) continue; // branches/paths/inputs -- configuration, not a trigger

    const item = /^-\s*(.+)$/.exec(body); // the `on:` + `  - push` list spelling
    if (item) {
      const name = unquote(item[1].replace(/:$/, ""));
      if (name) triggers.push(name);
      continue;
    }
    const key = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(body);
    if (key) triggers.push(key[1]);
  }

  return triggers;
}

export function listWorkflowFiles(dir = WORKFLOWS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();
}

/**
 * The whole fence, as data. Returns { publishers, violations, stale } -- violations and stale
 * both empty means the tree is clean.
 */
export function auditWorkflows({
  dir = WORKFLOWS_DIR,
  expected = EXPECTED_PRODUCTION_PUBLISHERS,
  files = null,
  readFile = (f) => readFileSync(join(dir, f), "utf8"),
} = {}) {
  const names = files ?? listWorkflowFiles(dir);
  const publishers = [];
  const violations = [];

  for (const name of names) {
    const source = readFile(name);
    if (!publishesToPages(source)) continue;
    publishers.push(name);

    const triggers = declaredTriggers(source);
    if (triggers.length === 0) {
      violations.push({ name, automatic: [], reason: "declares no triggers at all" });
      continue;
    }
    const automatic = triggers.filter((t) => !MANUAL_TRIGGERS.has(t));
    if (automatic.length) {
      violations.push({ name, automatic, reason: "publishes production automatically" });
    }
  }

  const found = new Set(publishers);
  const present = new Set(names);
  const stale = [...expected]
    .filter((name) => !found.has(name))
    .map((name) => ({
      name,
      reason: present.has(name)
        ? "no longer publishes to GitHub Pages"
        : "workflow no longer exists",
    }));

  return { publishers, violations, stale };
}

function main() {
  const { publishers, violations, stale } = auditWorkflows();
  const problems = [];

  for (const v of violations) {
    problems.push(
      `.github/workflows/${v.name} publishes to GitHub Pages and ${v.reason}` +
        (v.automatic.length ? ` via: ${v.automatic.join(", ")}` : "") +
        `. This surface self-identifies as environmentRole production, so a merge must never ` +
        `publish it. Use \`workflow_dispatch\` only -- see ` +
        `docs/deployment/github-pages-promotion-governance-decision.md (Option A).`,
    );
  }
  for (const s of stale) {
    problems.push(
      `EXPECTED_PRODUCTION_PUBLISHERS lists ${s.name}, but it ${s.reason}. Remove the line from ` +
        `scripts/productionPublishTriggerFence.mjs, deliberately -- otherwise this fence would ` +
        `scan nothing and still report success.`,
    );
  }

  if (problems.length) {
    console.error("Production publish trigger fence FAILED:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Production publish trigger fence OK: ${listWorkflowFiles().length} workflows scanned, ` +
      `${publishers.length} publish to GitHub Pages (${publishers.join(", ")}), ` +
      `0 with an automatic trigger.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
