// Effective-access parity: the deterministic proof required BEFORE any Security Role assignment migrates.
//
// The module's job is to REFUSE. So most of this suite is about what it refuses and what it will not let anybody
// approve away -- above all that a widening has no approval path at all.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const parity = require("../lib/adminPolicy/migration/effectiveAccessParity.js");
const census = require("../lib/adminPolicy/migration/roleAssignmentCensus.js");

const VOID = "reorder.purchaseOrder.void";

const grant = (over = {}) => ({
  roleKey: "admin", scopeType: "global", scopeValue: null,
  capabilities: ["employee.record.read"], conditionedCapabilities: [], ...over,
});
const facts = (over = {}) => ({ principalId: "p-1", membershipActive: true, grants: [grant()], unresolved: [], ...over });

const verdictOf = (legacy, postgres, approved = []) => parity.compareEffectiveAccess(legacy, postgres, approved).verdict;

test("identical authorities are EXACT_PARITY, and an empty population proves nothing", () => {
  assert.equal(verdictOf(facts(), facts()), "EXACT_PARITY");
  // An empty report must NOT read as parity proven: nothing was compared.
  const empty = parity.buildParityReport([]);
  assert.equal(empty.migrationPermitted, false, "an empty population must not permit migration");
  assert.deepEqual(empty.blockedBy, []);
});

test("WIDENING is a hard stop: a grant, a capability, or a membership PostgreSQL has and legacy does not", () => {
  // A whole grant only PostgreSQL has.
  assert.equal(verdictOf(facts({ grants: [] }), facts()), "WIDENING_BLOCKER");
  // A capability only PostgreSQL has, inside a grant both agree on.
  assert.equal(verdictOf(
    facts({ grants: [grant({ capabilities: ["employee.record.read"] })] }),
    facts({ grants: [grant({ capabilities: ["employee.record.read", "admin.employeeProfile.write"] })] }),
  ), "WIDENING_BLOCKER");
  // A Principal inactive in legacy and active in PostgreSQL.
  assert.equal(verdictOf(facts({ membershipActive: false }), facts({ membershipActive: true })), "WIDENING_BLOCKER");
});

test("WIDENING has NO approval path -- an allowlist cannot convert one into an acceptable outcome", () => {
  const legacy = facts({ grants: [grant({ capabilities: [] })] });
  const postgres = facts({ grants: [grant({ capabilities: [VOID] })] });
  // Declaring the very same (roleKey, capability) as an approved narrowing must not help: it is a WIDENING.
  const approved = [{ roleKey: "admin", capability: VOID, ruling: "R-32" }];
  assert.equal(verdictOf(legacy, postgres, approved), "WIDENING_BLOCKER");
  assert.equal(parity.compareEffectiveAccess(legacy, postgres, approved).migrationPermitted, false);
  // And the module offers no parameter that could allow one.
  const src = readFileSync(join(FUNCTIONS_DIR, "src/adminPolicy/migration/effectiveAccessParity.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /approvedWidening|allowWidening|ignoreWidening|force/i);
});

test("a widening OUTRANKS a narrowing found in the same comparison", () => {
  const legacy = facts({ grants: [grant({ capabilities: ["a", "b"] })] });
  const postgres = facts({ grants: [grant({ capabilities: ["a", "c"] })] });
  // Loses b, gains c. A comparison that both gains and loses access is still, first, one that gains access.
  const result = parity.compareEffectiveAccess(legacy, postgres, [{ roleKey: "admin", capability: "b", ruling: "R-32" }]);
  assert.equal(result.verdict, "WIDENING_BLOCKER");
});

test("narrowing is APPROVED only when every difference is declared EXACTLY, against a named ruling", () => {
  const legacy = facts({ grants: [grant({ capabilities: ["a", "b"] })] });
  const postgres = facts({ grants: [grant({ capabilities: ["a"] })] });

  assert.equal(verdictOf(legacy, postgres), "UNAPPROVED_NARROWING", "an undeclared loss must block");
  assert.equal(verdictOf(legacy, postgres, [{ roleKey: "admin", capability: "b", ruling: "R-32" }]), "APPROVED_RETIREMENT_NARROWING");
  // NO FUZZY MAPPING: a declaration for a different Role, or a different capability, does not apply.
  assert.equal(verdictOf(legacy, postgres, [{ roleKey: "dispatcher", capability: "b", ruling: "R-32" }]), "UNAPPROVED_NARROWING");
  assert.equal(verdictOf(legacy, postgres, [{ roleKey: "admin", capability: "b-other", ruling: "R-32" }]), "UNAPPROVED_NARROWING");

  // A PARTIAL explanation explains nothing: one unapproved loss makes the whole comparison unapproved.
  const twoLost = facts({ grants: [grant({ capabilities: ["a", "b", "c"] })] });
  assert.equal(verdictOf(twoLost, postgres, [{ roleKey: "admin", capability: "b", ruling: "R-32" }]), "UNAPPROVED_NARROWING");
  assert.equal(verdictOf(twoLost, postgres, [
    { roleKey: "admin", capability: "b", ruling: "R-32" }, { roleKey: "admin", capability: "c", ruling: "R-32" },
  ]), "APPROVED_RETIREMENT_NARROWING");
});

test("ASSIGNMENT SCOPE: a scoped grant appearing at a different scope in PostgreSQL is a widening", () => {
  const scoped = grant({ roleKey: "dispatcher", scopeType: "location", scopeValue: "loc-phoenix" });
  const global = grant({ roleKey: "dispatcher", scopeType: "global", scopeValue: null });
  // The exact failure the census refuses: a location-scoped legacy grant migrating as global.
  const result = parity.compareEffectiveAccess(facts({ grants: [scoped] }), facts({ grants: [global] }));
  assert.equal(result.verdict, "WIDENING_BLOCKER");
  assert.ok(result.differences.some((d) => d.kind === "SCOPE_DIFFERS"), "the scope difference must be named");
  // The same scope on both sides is parity.
  assert.equal(verdictOf(facts({ grants: [scoped] }), facts({ grants: [scoped] })), "EXACT_PARITY");
  // A DIFFERENT scope value is not a match.
  const tucson = grant({ roleKey: "dispatcher", scopeType: "location", scopeValue: "loc-tucson" });
  assert.equal(verdictOf(facts({ grants: [scoped] }), facts({ grants: [tucson] })), "WIDENING_BLOCKER");
});

test("CONDITIONED-NESS must survive: a conditioned capability granted unconditioned is a widening", () => {
  // reorder.purchaseOrder.void is the live case: legacy grants it only to the recorded assignee.
  const legacy = facts({ grants: [grant({ capabilities: [VOID], conditionedCapabilities: [VOID] })] });
  const unconditioned = facts({ grants: [grant({ capabilities: [VOID], conditionedCapabilities: [] })] });
  const result = parity.compareEffectiveAccess(legacy, unconditioned);
  assert.equal(result.verdict, "WIDENING_BLOCKER");
  assert.ok(result.differences.some((d) => d.kind === "CONDITION_DIFFERS"));
  // Both conditioned is parity; newly conditioned in PostgreSQL is a narrowing, not a widening.
  assert.equal(verdictOf(legacy, legacy), "EXACT_PARITY");
  assert.equal(verdictOf(unconditioned, legacy), "UNAPPROVED_NARROWING");
});

test("UNRESOLVED_EVIDENCE blocks, and outranks everything -- including an otherwise exact match", () => {
  assert.equal(verdictOf(facts({ unresolved: ["subject resolves to no Principal"] }), facts()), "UNRESOLVED_EVIDENCE");
  assert.equal(verdictOf(facts(), facts({ unresolved: ["role outside the governed catalog"] })), "UNRESOLVED_EVIDENCE");
  // Even a widening is reported as unresolved: an indeterminate side cannot be trusted to say anything.
  assert.equal(verdictOf(facts({ unresolved: ["malformed row"], grants: [] }), facts()), "UNRESOLVED_EVIDENCE");
  // Two sides describing different Principals is not a comparison at all.
  assert.equal(verdictOf(facts({ principalId: "p-1" }), facts({ principalId: "p-2" })), "UNRESOLVED_EVIDENCE");
  for (const v of ["UNRESOLVED_EVIDENCE", "UNAPPROVED_NARROWING", "WIDENING_BLOCKER"]) {
    assert.ok(!parity.MIGRATION_PERMITTING_VERDICTS.includes(v), `${v} must not permit migration`);
  }
});

test("TENANT BOUNDARY and inactive membership: no grants on either side is parity, not a difference", () => {
  // A Principal outside the tenant is inactive on both sides and grants nothing anywhere.
  assert.equal(verdictOf(
    facts({ membershipActive: false, grants: [] }), facts({ membershipActive: false, grants: [] }),
  ), "EXACT_PARITY");
  // Losing membership is a narrowing, and it still needs approving.
  assert.equal(verdictOf(facts(), facts({ membershipActive: false, grants: [] })), "UNAPPROVED_NARROWING");
});

test("the report blocks the WHOLE population on one blocker, and names who blocked it", () => {
  const ok = { legacy: facts({ principalId: "p-a" }), postgres: facts({ principalId: "p-a" }) };
  const bad = { legacy: facts({ principalId: "p-b", grants: [] }), postgres: facts({ principalId: "p-b" }) };
  const report = parity.buildParityReport([bad, ok]);
  assert.equal(report.migrationPermitted, false, "one blocker must block everybody");
  assert.deepEqual(report.blockedBy, ["p-b"]);
  assert.equal(report.counts.EXACT_PARITY, 1);
  assert.equal(report.counts.WIDENING_BLOCKER, 1);
  // Deterministic ordering, whatever order the pairs arrive in.
  assert.deepEqual(parity.buildParityReport([ok, bad]).comparisons.map((c) => c.principalId), ["p-a", "p-b"]);
  // All-clear permits, and only then.
  assert.equal(parity.buildParityReport([ok]).migrationPermitted, true);
});

test("the census refusal is NOT relaxed by this module, and relaxation is only ever a RECOMMENDATION", () => {
  // The refusal still exists in the census, untouched by this PR.
  assert.equal(census.MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY, "MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY");
  const censusSrc = readFileSync(join(FUNCTIONS_DIR, "src/adminPolicy/migration/roleAssignmentCensus.ts"), "utf8");
  assert.match(censusSrc, /if \(a\.scopeType !== "global"\) refusalReasons\.push\("SCOPED"\)/);
  assert.doesNotMatch(censusSrc, /effectiveAccessParity/, "the census must not consume the parity proof yet");

  // A blocked report recommends relaxing nothing.
  const blocked = parity.buildParityReport([{ legacy: facts({ grants: [] }), postgres: facts() }]);
  assert.deepEqual(parity.refusalRelaxationCandidates(blocked), []);
  // A clean report recommends the two representable reasons -- a recommendation, not an action.
  const clean = parity.buildParityReport([{ legacy: facts(), postgres: facts() }]);
  assert.deepEqual([...parity.refusalRelaxationCandidates(clean)], ["SCOPED", "CONDITIONED_ROLE"]);
  assert.deepEqual(parity.refusalRelaxationCandidates(parity.buildParityReport([])), [], "an empty population recommends nothing");
});

test("the comparator is pure and deterministic: no database, no Firebase, no clock, no inference", () => {
  const src = readFileSync(join(FUNCTIONS_DIR, "src/adminPolicy/migration/effectiveAccessParity.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /\bpg\b|pool|client\.query|SELECT |INSERT |UPDATE |DELETE /i);
  assert.doesNotMatch(src, /require\(\s*["'][^"']*fire(base|store)[^"']*["']\s*\)|from\s+["'][^"']*fire(base|store)[^"']*["']/i);
  assert.doesNotMatch(src, /Date\.now|new Date|Math\.random/);
  // Nothing is inferred from a Job Role, a title or a legacy operationalRole value.
  assert.doesNotMatch(src, /jobRole|job_roles|operationalRole|title/i);
  // Same inputs, same verdict.
  const a = parity.buildParityReport([{ legacy: facts(), postgres: facts() }]);
  const b = parity.buildParityReport([{ legacy: facts(), postgres: facts() }]);
  assert.deepEqual(a, b);
});
