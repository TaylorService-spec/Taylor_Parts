// THE RELEASE-BOUNDARY INPUTS MUST SELECT THE LANE THAT VALIDATES THEM.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// DECISIONS #133 recorded fifteen files under `scripts/` that form the release boundary and were
// named in NO workflow path filter. Their suites existed and were green; nothing ran them when the
// scripts changed. #138 (Owner ruling) rejected that transitive coverage and authorized
// `.github/workflows/release-tooling-validation.yml` to select them explicitly.
//
// A path list is prose until something checks it. Without this test the lane could be created,
// pass, and then silently drift — an input renamed, a line dropped in a merge, a sixteenth file
// added to the boundary and watched by nobody — while every check stayed green. That is the exact
// shape of the defect #137 is named after:
//
//     REGISTERED != SELECTED != GOVERNED
//
// So this suite is the lane's #137 evidence: it asserts that every governed input SELECTS the lane,
// on BOTH events, and that the lane runs the contracts it claims to run.
//
// ════════════════════ SCOPE, DELIBERATELY NARROW ════════════════════
//
// This is not the CI-v2 contract registry or the fail-closed router — those are separate authorized
// work. It reads two files as text and compares two lists. It is a tripwire on one lane, and it is
// written to fail loudly rather than to be clever.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const WORKFLOW = join(REPO, ".github", "workflows", "release-tooling-validation.yml");
const LEDGER = join(REPO, "docs", "DECISIONS.md");

const workflow = readFileSync(WORKFLOW, "utf8");

// The fifteen inputs, transcribed from #133's uncovered block. Held here as an explicit list rather
// than re-parsed from the ledger at run time: the ledger is prose and append-only history, and a
// test that derives its expectations from the thing it is checking proves nothing. The next test
// below ties this list back to #133 so the two cannot drift apart unnoticed.
const GOVERNED_INPUTS = [
  "scripts/_certificationRoutes.mjs",
  "scripts/_prodRelease.run.sh",
  "scripts/_releaseIdentityGate.mjs",
  "scripts/_releaseProvenanceGuard.mjs",
  "scripts/_sandboxDeployGuard.mjs",
  "scripts/_sandboxQuickGate.sh",
  "scripts/_sandboxRefresh.run.sh",
  "scripts/_sandboxRegressionGate.sh",
  "scripts/releaseProvenance.mjs",
  "scripts/releaseRoot.mjs",
  "scripts/sandboxCredentials.mjs",
  "scripts/sandboxFunctionsVerification.mjs",
  "scripts/verifyDeployArtifact.mjs",
  "scripts/verifyDeployedCallablesFirebase.mjs",
  "scripts/verifySandboxFunctions.mjs",
];

/** Trigger paths declared for one event, read as text so the suite stays dependency-free. */
function triggerPaths(event) {
  const afterEvent = workflow.split(new RegExp(`^\\s{2}${event}:\\s*$`, "m"))[1] ?? "";
  const thisEventOnly = afterEvent.split(/^\s{2}\w[\w_]*:\s*$/m)[0] ?? "";
  return [...thisEventOnly.matchAll(/^\s+- "([^"]+)"/gm)].map((m) => m[1]);
}

test("every governed release-boundary input selects the lane, on both events", () => {
  for (const event of ["pull_request", "push"]) {
    const paths = triggerPaths(event);
    assert.ok(paths.length > 0, `${event} must declare trigger paths`);
    const missing = GOVERNED_INPUTS.filter((i) => !paths.includes(i));
    assert.deepEqual(
      missing, [],
      `These #133 release-boundary inputs are NOT in the ${event} trigger paths, so changing one ` +
      `would not run the contracts that assert on it — the defect #138 exists to close:\n  ` +
      `${missing.join("\n  ")}`,
    );
  }
});

test("the lane RUNS every contract it watches, and watches every contract it runs", () => {
  // Both directions matter. A suite watched but never run is decoration; a suite run but never
  // watched cannot be selected by its own edit.
  const run = [...workflow.matchAll(/^\s+test\/([\w.-]+\.test\.mjs)$/gm)].map((m) => m[1]);
  assert.ok(run.length >= 7, `expected the lane to run the release/tooling suites, saw ${run.length}`);

  const watched = triggerPaths("pull_request");
  for (const suite of run) {
    assert.ok(
      watched.includes(`field-ops-app-vite/test/${suite}`),
      `${suite} is RUN by the lane but not WATCHED by it — an edit to the contract itself would ` +
      `not select the lane that runs it`,
    );
  }
});

test("the lane holds no deployment or protected-release authority (#128 unchanged)", () => {
  // #138 authorized CI coverage ONLY. This asserts the lane never grows into a release actor —
  // the failure that would matter most and would be easiest to introduce by a well-meaning edit.
  const forbidden = [
    /firebase\s+deploy/,
    /gh\s+(api|release|workflow\s+run|pr\s+merge)/,
    /repository_dispatch/,
    /actions\/github-script/,
    /_prodRelease\.run\.sh\s*$/m,
    /_sandboxRefresh\.run\.sh\s*$/m,
  ];
  for (const pattern of forbidden) {
    assert.ok(
      !pattern.test(workflow),
      `the release-tooling lane must stay VALIDATION ONLY, but it matches ${pattern} — #138 ` +
      `authorized CI coverage and explicitly no deployment or protected-action authority`,
    );
  }

  // Least privilege is declared, and it is a read.
  assert.match(workflow, /^permissions:\s*$/m, "the lane must declare its permissions explicitly");
  assert.match(workflow, /^\s+contents:\s*read\s*$/m, "the lane must declare contents: read");
  // Scoped to the permissions BLOCK itself, not the whole file — prose about not writing anything
  // legitimately contains the word "write", and a check that trips on its own documentation is a
  // check people delete rather than fix.
  const permsBlock = (workflow.match(/^permissions:\r?\n((?:[ \t]+.*\r?\n)+)/m) ?? [])[1] ?? "";
  assert.ok(permsBlock, "the permissions block must be readable");
  assert.ok(
    !/:\s*(write|write-all)\b/.test(permsBlock),
    `the lane must grant no write scope, but its permissions block is:\n${permsBlock}`,
  );
});

test("a main run can never be cancelled by this lane's concurrency policy", () => {
  assert.match(workflow, /group:\s*\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.event_name\s*\}\}/,
    "event_name must be in the concurrency group so push and pull_request never share one");
  assert.match(workflow, /cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/,
    "cancel-in-progress must be conditional, so a main run is never cancellable");
});

test("the governed input list still matches what #133 actually recorded", () => {
  // Ties the constant above back to the ledger. If someone adds a file to the release boundary in
  // #133 (or a later decision amends the set) and does not widen this lane, this fails rather than
  // letting the lane quietly under-cover the boundary.
  //
  // NOTE, recorded because it is a real discrepancy found while implementing #138: #133's prose
  // says "Sixteen files" — but that sentence counts the files that ARE covered by some workflow
  // filter. Its uncovered code block, which is the governed set, lists FIFTEEN. Fifteen is the
  // number asserted here because it is what the block enumerates.
  const ledger = readFileSync(LEDGER, "utf8");
  const section = ledger.split("## #133 —")[1] ?? "";
  assert.ok(section, "#133 must still exist in the ledger");
  // `\r?\n` deliberately: the ledger is stored with CRLF, and a bare `\n` here silently overran the
  // fence and swallowed the NEXT code block too, which would have made this assertion nonsense.
  const block = (section.match(/```\r?\n([\s\S]*?)```/) ?? [])[1] ?? "";
  const recorded = [...block.matchAll(/([\w.-]+\.(?:mjs|sh))/g)].map((m) => `scripts/${m[1]}`).sort();

  assert.deepEqual(
    [...new Set(recorded)], [...GOVERNED_INPUTS].sort(),
    "the release-boundary set recorded in DECISIONS #133 no longer matches the set this lane " +
    "selects; widen the lane (and its trigger paths) rather than editing this expectation",
  );
});
