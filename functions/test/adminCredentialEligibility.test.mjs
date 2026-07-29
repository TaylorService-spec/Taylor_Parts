// AUTH-PR-3.5 -- PURE unit tests for evaluateTargetEligibility (no emulator, no
// firebase). Proves every guard persona and the visible-vs-neutral disposition
// (DECISIONS #56 guard gap): self + final-active-admin are VISIBLE "protected"
// refusals; disabled / break-glass / missing-or-nonreciprocal link / no-email /
// no-auth-account are NEUTRAL-ineligible (no enumeration); a fully linked,
// enabled, non-break-glass, non-final-admin target with an email is eligible.
//
// Prerequisite: npm run build (compiles to functions/lib). Then:
//   node functions/test/adminCredentialEligibility.test.mjs
import assert from "node:assert/strict";
import {
  evaluateTargetEligibility,
  evaluateActorAuthorization,
  resolveEmployeeLinkFacts,
} from "../lib/access/adminCredentialCommands.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// A fully-eligible baseline; each case overrides one fact.
const ELIGIBLE = Object.freeze({
  authExists: true,
  disabled: false,
  email: "t@example.com",
  hasEmployeeLink: true,
  employeeLinkReciprocal: true,
  isBreakGlass: false,
  isFinalActiveAdmin: false,
});
const facts = (over = {}) => ({ ...ELIGIBLE, ...over });

ok("fully eligible target -> eligible", () => {
  const v = evaluateTargetEligibility(facts(), "admin", "target");
  assert.deepStrictEqual(v, { category: "eligible", disposition: "eligible" });
});

ok("self-target -> protected (visible), wins over everything", () => {
  const v = evaluateTargetEligibility(facts({ authExists: false, disabled: true }), "same", "same");
  assert.deepStrictEqual(v, { category: "self-target", disposition: "protected" });
});

ok("no Auth account -> neutral-ineligible", () => {
  const v = evaluateTargetEligibility(facts({ authExists: false }), "admin", "t");
  assert.deepStrictEqual(v, { category: "no-auth-account", disposition: "neutral-ineligible" });
});

ok("missing employee link -> neutral-ineligible", () => {
  const v = evaluateTargetEligibility(facts({ hasEmployeeLink: false }), "admin", "t");
  assert.strictEqual(v.category, "missing-or-nonreciprocal-employee-link");
  assert.strictEqual(v.disposition, "neutral-ineligible");
});

ok("non-reciprocal employee link -> neutral-ineligible", () => {
  const v = evaluateTargetEligibility(facts({ employeeLinkReciprocal: false }), "admin", "t");
  assert.strictEqual(v.category, "missing-or-nonreciprocal-employee-link");
});

ok("final active recoverable admin -> protected (visible)", () => {
  const v = evaluateTargetEligibility(facts({ isFinalActiveAdmin: true }), "admin", "t");
  assert.deepStrictEqual(v, { category: "protected-final-admin", disposition: "protected" });
});

ok("disabled target -> neutral-ineligible (never silently enabled)", () => {
  const v = evaluateTargetEligibility(facts({ disabled: true }), "admin", "t");
  assert.deepStrictEqual(v, { category: "disabled-target", disposition: "neutral-ineligible" });
});

ok("break-glass target -> neutral-ineligible", () => {
  const v = evaluateTargetEligibility(facts({ isBreakGlass: true }), "admin", "t");
  assert.deepStrictEqual(v, { category: "break-glass-target", disposition: "neutral-ineligible" });
});

ok("no recoverable email -> neutral-ineligible", () => {
  const v = evaluateTargetEligibility(facts({ email: null }), "admin", "t");
  assert.deepStrictEqual(v, { category: "no-recoverable-email", disposition: "neutral-ineligible" });
});

ok("final-admin protection outranks disabled/break-glass/no-email", () => {
  // an active final admin who is also disabled etc. is still surfaced as the
  // visible protected-final-admin refusal (checked before the neutral buckets).
  const v = evaluateTargetEligibility(
    facts({ isFinalActiveAdmin: true, disabled: true, isBreakGlass: true, email: null }),
    "admin",
    "t",
  );
  assert.strictEqual(v.category, "protected-final-admin");
});

ok("broken linkage outranks final-admin/disabled (cannot trust identity)", () => {
  const v = evaluateTargetEligibility(
    facts({ hasEmployeeLink: false, isFinalActiveAdmin: true }),
    "admin",
    "t",
  );
  assert.strictEqual(v.category, "missing-or-nonreciprocal-employee-link");
});

// -- PRE-2: pure evaluateActorAuthorization (fail-closed actor gate) ----------
// A governed admin with an active, non-disabled, reciprocally-linked account is
// authorized; every other case denies. account/employment "active" == Auth
// enabled (no separate employment-status field in the current schema).
const AUTHZ_ACTOR = Object.freeze({
  authExists: true,
  disabled: false,
  isAdmin: true,
  hasEmployeeLink: true,
  employeeLinkReciprocal: true,
  employmentStatus: "ACTIVE",
});
const actor = (over = {}) => ({ ...AUTHZ_ACTOR, ...over });

ok("actor: active linked admin (employmentStatus ACTIVE + enabled) -> authorized", () => {
  assert.deepStrictEqual(evaluateActorAuthorization(actor()), {
    authorized: true,
    category: "authorized",
  });
});
ok("actor: no Auth account (unauthenticated/no-account) -> denied", () => {
  assert.deepStrictEqual(evaluateActorAuthorization(actor({ authExists: false })), {
    authorized: false,
    category: "no-auth-account",
  });
});
ok("actor: disabled/inactive account -> denied", () => {
  assert.deepStrictEqual(evaluateActorAuthorization(actor({ disabled: true })), {
    authorized: false,
    category: "disabled-actor",
  });
});
ok("actor: non-admin role -> denied", () => {
  assert.deepStrictEqual(evaluateActorAuthorization(actor({ isAdmin: false })), {
    authorized: false,
    category: "not-admin",
  });
});
ok("actor: missing employee link -> denied", () => {
  assert.strictEqual(
    evaluateActorAuthorization(actor({ hasEmployeeLink: false })).category,
    "missing-or-nonreciprocal-employee-link",
  );
});
ok("actor: non-reciprocal (malformed) link -> denied", () => {
  assert.strictEqual(
    evaluateActorAuthorization(actor({ employeeLinkReciprocal: false })).category,
    "missing-or-nonreciprocal-employee-link",
  );
});
ok("actor: no-account outranks disabled/non-admin (fail-closed order)", () => {
  assert.strictEqual(
    evaluateActorAuthorization(actor({ authExists: false, disabled: true, isAdmin: false })).category,
    "no-auth-account",
  );
});

// -- PRE-2 P1a: employmentStatus is the authoritative lifecycle gate ----------
for (const bad of ["INACTIVE", "TERMINATED", "ON_LEAVE", "RETIRED", "CONTRACTOR", "active", "", null, undefined]) {
  ok(`actor: employmentStatus=${JSON.stringify(bad)} -> denied (inactive-employment)`, () => {
    assert.strictEqual(
      evaluateActorAuthorization(actor({ employmentStatus: bad })).category,
      "inactive-employment",
    );
  });
}
ok("actor: enabled + ACTIVE employment -> authorized (both gates pass)", () => {
  assert.strictEqual(evaluateActorAuthorization(actor({ disabled: false, employmentStatus: "ACTIVE" })).authorized, true);
});
ok("actor: Auth enabled but employment INACTIVE -> denied", () => {
  assert.strictEqual(
    evaluateActorAuthorization(actor({ disabled: false, employmentStatus: "INACTIVE" })).category,
    "inactive-employment",
  );
});
ok("actor: employment ACTIVE but Auth disabled -> denied (disabled-actor)", () => {
  assert.strictEqual(
    evaluateActorAuthorization(actor({ disabled: true, employmentStatus: "ACTIVE" })).category,
    "disabled-actor",
  );
});
ok("actor: link check precedes employment (non-reciprocal + ACTIVE -> link denial)", () => {
  assert.strictEqual(
    evaluateActorAuthorization(actor({ employeeLinkReciprocal: false, employmentStatus: "ACTIVE" })).category,
    "missing-or-nonreciprocal-employee-link",
  );
});

// -- PRE-2 P1b: reciprocal link uses the GOVERNED userId field ONLY -----------
const linkInput = (over = {}) => ({
  userEmployeeId: "emp-1",
  employeeExists: true,
  employeeUserId: "uid-1",
  employeeEmploymentStatus: "ACTIVE",
  uid: "uid-1",
  ...over,
});

ok("link: exact userId match -> reciprocal, employmentStatus trusted", () => {
  assert.deepStrictEqual(resolveEmployeeLinkFacts(linkInput()), {
    hasEmployeeLink: true,
    employeeLinkReciprocal: true,
    employmentStatus: "ACTIVE",
  });
});
ok("link: missing userId denies even if an alias would have matched", () => {
  // authUid/uid aliases are NOT consulted; only userId counts.
  const v = resolveEmployeeLinkFacts(linkInput({ employeeUserId: undefined, authUid: "uid-1", uid: "uid-1" }));
  assert.strictEqual(v.employeeLinkReciprocal, false);
  assert.strictEqual(v.employmentStatus, null, "employmentStatus not trusted without reciprocal link");
});
ok("link: mismatched userId denies even if an alias matches", () => {
  const v = resolveEmployeeLinkFacts(linkInput({ employeeUserId: "someone-else", uid: "uid-1", authUid: "uid-1" }));
  assert.strictEqual(v.employeeLinkReciprocal, false);
});
ok("link: conflicting userId (points to another user) never authorizes", () => {
  const v = resolveEmployeeLinkFacts(linkInput({ employeeUserId: "uid-2", uid: "uid-1" }));
  assert.strictEqual(v.employeeLinkReciprocal, false);
  assert.strictEqual(v.employmentStatus, null);
});
ok("link: no employeeId on user doc -> no link", () => {
  const v = resolveEmployeeLinkFacts(linkInput({ userEmployeeId: null }));
  assert.deepStrictEqual(v, { hasEmployeeLink: false, employeeLinkReciprocal: false, employmentStatus: null });
});
ok("link: employee doc missing -> not reciprocal", () => {
  const v = resolveEmployeeLinkFacts(linkInput({ employeeExists: false, employeeUserId: undefined }));
  assert.strictEqual(v.employeeLinkReciprocal, false);
});
ok("link: reciprocal but malformed (non-string) employmentStatus -> null (deny)", () => {
  const v = resolveEmployeeLinkFacts(linkInput({ employeeEmploymentStatus: { weird: true } }));
  assert.strictEqual(v.employeeLinkReciprocal, true);
  assert.strictEqual(v.employmentStatus, null);
});

console.log(`\n${passed} passed`);
