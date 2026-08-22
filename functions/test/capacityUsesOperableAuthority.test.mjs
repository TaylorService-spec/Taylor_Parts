// CAPACITY MUST BE MEASURED IN OPERABLE AUTHORITY, NEVER IN GRANTS.
//
// ============================ THE ONE MISTAKE THIS PREVENTS ============================
//
// The capacity report exists to answer "can this workforce do the work". The tempting shortcut is to
// count who HOLDS the required capabilities, which is a single set intersection and is wrong,
// because 44 of the 116 catalog capabilities are registered `active:false` and resolve
// DENY / inactivePermission for every principal including owner.
//
// Counting a granted-but-inactive capability as capacity produces a staffing report that says a
// workstream is covered when nobody in the company can perform it. Nine of the fifteen workstreams
// are in exactly that state today, so the shortcut would not be a small error -- it would invert the
// report's headline finding.
//
// These checks pin the arithmetic itself rather than any particular number, so the guard keeps
// working as the roster and the catalog change.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";
import {
  ENVIRONMENT_ACTIVATION_REGISTRY,
  resolveCapabilityOverrides,
} from "../lib/access/environmentCapabilityOverrides.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const report = JSON.parse(readFileSync(path.join(REPO, "docs/governance/capacity-report.json"), "utf8"));
// ACTIVE IS RESOLVED FOR THE ENVIRONMENT THE REPORT DECLARES, not from the global catalog flag.
//
// This guard originally read PERMISSION_CATALOG.active directly, which is the fail-closed GLOBAL
// default. That is the same defect it exists to catch, committed by the guard itself: it would have
// happily confirmed a report describing the production posture under a sandbox heading, and it did
// -- nine workstreams were reported GRANTED_BUT_INACTIVE in an environment where all of them were
// live, and this test agreed.
//
// Reading the environment OUT OF THE REPORT also makes the guard check the report's own basis: if a
// report ever omits which environment it measured, `environment.projectId` is undefined, overrides
// resolve EMPTY, and the strict catalog posture applies -- fail-closed, not fail-quiet.
const OVERRIDES = resolveCapabilityOverrides(
  ENVIRONMENT_ACTIVATION_REGISTRY,
  report.environment?.projectId,
);
const ACTIVE = new Set([
  ...PERMISSION_CATALOG.filter((p) => p.active !== false).map((p) => p.id),
  ...OVERRIDES,
]);

test("the report declares which environment it measured", () => {
  // A capacity report without an environment is not interpretable: the same roster is ADEQUATE in
  // sandbox and GRANTED_BUT_INACTIVE in production, and the number alone does not say which.
  assert.ok(report.environment?.projectId, "capacity report must record the environment it measured");
  assert.equal(
    typeof report.catalog.activeInThisEnvironment, "number",
    "capacity report must record the environment-resolved active count, not just the global one",
  );
});

test("the report is not empty, so these checks are not vacuous", () => {
  assert.ok(report.employeesEvaluated >= 30, "expected a staffed workforce");
  assert.ok(report.capacity.length >= 10, "expected the workstreams to be evaluated");
});

test("no workstream counts an INACTIVE capability as operable capacity", () => {
  // The load-bearing arithmetic. If any required capability is inactive, operableEligible must be
  // zero -- there is no partial credit, because the workflow cannot run at all.
  for (const c of report.capacity) {
    const inactive = c.requires.filter((id) => !ACTIVE.has(id));
    if (inactive.length === 0) continue;
    assert.equal(
      c.operableEligible, 0,
      `${c.workstream} reports ${c.operableEligible} operable workers while requiring inactive `
      + `capabilities (${inactive.join(", ")}). A granted-but-inactive capability resolves DENY for `
      + `every principal including owner, so it is ZERO capacity -- counting it would report a `
      + `workstream as covered when nobody can perform it.`,
    );
    assert.equal(c.result, "GRANTED_BUT_INACTIVE",
      `${c.workstream} requires inactive capabilities and must be classified GRANTED_BUT_INACTIVE`);
  }
});

test("operable never exceeds granted, and governed-only never exceeds operable", () => {
  // Each number is a strict subset of the one before it. A violation means the pipeline
  // EMPLOYEE -> GRANTED -> ACTIVE -> OPERABLE -> GOVERNED-ONLY was computed from different sets.
  for (const c of report.capacity) {
    assert.ok(c.operableEligible <= c.grantedEligible,
      `${c.workstream}: operable ${c.operableEligible} exceeds granted ${c.grantedEligible}`);
    assert.ok(c.operableGovernedOnly <= c.operableEligible,
      `${c.workstream}: governed-only ${c.operableGovernedOnly} exceeds operable ${c.operableEligible}`);
    assert.ok(c.available <= c.operableEligible,
      `${c.workstream}: available ${c.available} exceeds operable ${c.operableEligible}`);
  }
});

test("a workstream is only ADEQUATE when at least two workers can actually do it", () => {
  // ADEQUATE is the word a reader trusts. It must never be reachable through grants alone.
  for (const c of report.capacity) {
    if (c.result !== "ADEQUATE") continue;
    assert.ok(c.operableEligible >= 2,
      `${c.workstream} is ADEQUATE with ${c.operableEligible} operable workers`);
    assert.deepEqual(c.requires.filter((id) => !ACTIVE.has(id)), [],
      `${c.workstream} is ADEQUATE while requiring an inactive capability`);
  }
});

test("authority attribution is reported, so legacy-borrowed capacity cannot hide", () => {
  // 80% of this workforce's operable authority comes from the legacy compatibility roles that R-1
  // exists to retire. A report that omitted the attribution would show workstreams as covered by a
  // model that is being removed.
  const a = report.authoritySource;
  assert.ok(a, "authoritySource must be reported");
  assert.equal(
    a.fromCompatibilityRoleOnly + a.fromGovernedRoleOnly + a.fromBoth, a.operableHoldingsTotal,
    "authority attribution must account for every operable holding",
  );
  assert.ok(a.operableHoldingsTotal > 0, "attribution must not be computed over an empty set");
});
