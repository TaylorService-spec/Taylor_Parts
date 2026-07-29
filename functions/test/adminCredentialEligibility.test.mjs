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
});
const actor = (over = {}) => ({ ...AUTHZ_ACTOR, ...over });

ok("actor: active linked admin -> authorized", () => {
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

console.log(`\n${passed} passed`);
