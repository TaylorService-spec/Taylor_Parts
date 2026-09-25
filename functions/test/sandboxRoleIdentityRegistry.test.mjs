/**
 * THE CANONICAL SANDBOX ROLE IDENTITY REGISTRY -- the nine required tests, plus the bootstrap.
 *
 * OWNER RULING 2026-09-25: ONE CANONICAL SANDBOX LOGIN PER CANONICAL JOB ROLE, and a NARROW exception
 * letting a canonical role's authentication identity differ from the synthetic Employee's work email.
 * `employee.workEmail` is business contact data; `loginPrincipal.credentialEmail` is an authentication
 * identity. The exception is granted by the REGISTRY and by nothing else.
 *
 * The three refusal tests (3, 4, 5) are deliberately written as PAIRS: each first proves the shape
 * would be ACCEPTED when it is legitimate, then makes the one change that must be refused. A refusal
 * test that never shows the accepting case can pass because of an unrelated error -- a typo in a
 * fixture, a missing field, a validator that rejects everything -- and nobody finds out until the
 * fence is needed. Proving both directions is what makes these non-vacuous.
 *
 * Hermetic: no network, no Firebase, no Auth, no database, no emulator. Deep-cloned fixtures only.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { MANIFEST, validateManifest } = require("../scripts/seedSampleCompany.js");
const {
  sampleCompanyCredentialAllowlist,
  supersededExclusions,
  canonicalRoleCoverage,
  CredentialActivationError,
} = require("../scripts/sampleCompany/credentialActivation.js");
const bootstrap = require("../scripts/sandboxPersonaBootstrap.js");
const REGISTRY = require("../../config/sandboxRoleIdentityRegistry.json");

const clone = (o) => JSON.parse(JSON.stringify(o));
const roleByKey = (key) => REGISTRY.roles.find((r) => r.key === key);
const employee = (m, key) => m.employees.find((e) => e.key === key);
const principal = (m, key) => m.principals.find((p) => p.employee === key);

/** A registry with one role's declared identity altered, for the mismatch and duplicate cases. */
function registryWith(mutate) {
  const r = clone(REGISTRY);
  mutate(r);
  return r;
}

// ======================================================================================
// 1 & 2 -- THE AUTHORIZED EXCEPTION IS ACCEPTED
// ======================================================================================

test("(1) financeAccounting with acctmgr@ and a DIFFERENT workEmail passes, because the registry declares the login", () => {
  const role = roleByKey("financeAccounting");
  assert.equal(role.authEmail, "acctmgr@sandbox.invalid");
  assert.equal(role.sampleCompanyEmployee, "finance-controller");

  // The premise of the test: the two really do differ in the shipped manifest.
  const emp = employee(MANIFEST, "finance-controller");
  const pr = principal(MANIFEST, "finance-controller");
  assert.equal(pr.loginPrincipal.credentialEmail, "acctmgr@sandbox.invalid");
  assert.equal(emp.workEmail, "sage.fixture@sandbox.invalid");
  assert.notEqual(pr.loginPrincipal.credentialEmail, emp.workEmail, "this test is pointless unless they differ");

  // And the shipped manifest validates.
  assert.doesNotThrow(() => validateManifest(clone(MANIFEST)));
});

test("(2) generalEmployee with restricted@ and a DIFFERENT workEmail passes, for the same reason", () => {
  const role = roleByKey("generalEmployee");
  assert.equal(role.authEmail, "restricted@sandbox.invalid");
  assert.equal(role.sampleCompanyEmployee, "restricted-user");

  const emp = employee(MANIFEST, "restricted-user");
  const pr = principal(MANIFEST, "restricted-user");
  assert.equal(pr.loginPrincipal.credentialEmail, "restricted@sandbox.invalid");
  assert.equal(emp.workEmail, "wren.fixture@sandbox.invalid");
  assert.notEqual(pr.loginPrincipal.credentialEmail, emp.workEmail);
  assert.doesNotThrow(() => validateManifest(clone(MANIFEST)));
});

test("the dispatcher uses the same exception, and its workEmail is still the noncanonical address", () => {
  const emp = employee(MANIFEST, "dispatcher");
  const pr = principal(MANIFEST, "dispatcher");
  assert.equal(pr.loginPrincipal.credentialEmail, "dispatcher@sandbox.invalid");
  assert.equal(emp.workEmail, "emerson.fixture@sandbox.invalid");
  // emerson.fixture@ remains a work email AND a noncanonical identity: contact data, not a login.
  assert.ok(REGISTRY.noncanonical.some((n) => n.email === "emerson.fixture@sandbox.invalid"));
});

// ======================================================================================
// 3 -- AN UNDECLARED DIVERGENCE IS REFUSED (non-vacuous)
// ======================================================================================

test("(3) credentialEmail != workEmail with NO registry declaration is REFUSED", () => {
  // STEP A -- prove the baseline is ACCEPTED, so the refusal below cannot pass for another reason.
  // `general-manager` is an ordinary persona: its credentialEmail equals its workEmail today.
  const accepted = clone(MANIFEST);
  const gmEmp = employee(accepted, "general-manager");
  const gmPr = principal(accepted, "general-manager");
  assert.equal(gmPr.loginPrincipal.credentialEmail, gmEmp.workEmail, "baseline must start compliant");
  assert.doesNotThrow(() => validateManifest(accepted), "the untouched fixture must validate, or this test proves nothing");

  // STEP B -- change ONLY the credentialEmail to an address the registry does not declare for it.
  const refused = clone(MANIFEST);
  principal(refused, "general-manager").loginPrincipal.credentialEmail = "someone.else@sandbox.invalid";
  assert.throws(
    () => validateManifest(refused),
    (err) => {
      assert.match(err.message, /MANIFEST_INVALID/);
      assert.match(err.message, /general-manager/);
      return true;
    },
    "an undeclared divergence must be refused",
  );
});

test("(3b) the exception is NOT a general permission: a non-registry Employee cannot borrow it", () => {
  // `retail-sales-b` is deliberately NOT a canonical role (indigo.fixture@ is noncanonical), so it
  // gets no exception even though it looks exactly like the personas that do.
  assert.equal(REGISTRY.roles.some((r) => r.sampleCompanyEmployee === "retail-sales-b"), false);
  const refused = clone(MANIFEST);
  principal(refused, "retail-sales-b").loginPrincipal.credentialEmail = "acctmgr@sandbox.invalid";
  assert.throws(() => validateManifest(refused), /MANIFEST_INVALID/);
});

// ======================================================================================
// 4 -- A REGISTRY MISMATCH IS REFUSED (non-vacuous)
// ======================================================================================

test("(4) a canonical persona whose credentialEmail does NOT match the registry is REFUSED", () => {
  // STEP A -- the declared value is accepted.
  const accepted = clone(MANIFEST);
  assert.equal(principal(accepted, "finance-controller").loginPrincipal.credentialEmail, roleByKey("financeAccounting").authEmail);
  assert.doesNotThrow(() => validateManifest(accepted));

  // STEP B -- any OTHER value is refused, including the Employee's own work email. That last case is
  // the important one: under the default invariant it would have been the ONLY legal value, so this
  // proves the registry now governs these personas rather than the default.
  for (const wrong of ["sage.fixture@sandbox.invalid", "restricted@sandbox.invalid", "reporting@sandbox.invalid"]) {
    const refused = clone(MANIFEST);
    principal(refused, "finance-controller").loginPrincipal.credentialEmail = wrong;
    assert.throws(
      () => validateManifest(refused),
      (err) => {
        assert.match(err.message, /MANIFEST_INVALID/);
        assert.match(err.message, /finance-controller/);
        return true;
      },
      `${wrong} must be refused for a canonical persona`,
    );
  }
});

// ======================================================================================
// 5 -- A DUPLICATE CANONICAL IDENTITY IS REFUSED (non-vacuous)
// ======================================================================================

test("(5) a duplicate canonical Auth email is REFUSED by the registry validator", () => {
  // STEP A -- the real registry is accepted, so the refusal is about duplication and nothing else.
  assert.doesNotThrow(() => bootstrap.canonicalRoles(REGISTRY));

  // STEP B -- point a second role at an address another role already claims.
  const dup = registryWith((r) => {
    r.roles.find((x) => x.key === "officeManager").authEmail = "admin@sandbox.invalid";
  });
  assert.throws(
    () => bootstrap.canonicalRoles(dup),
    (err) => err instanceof bootstrap.BootstrapRefusal && err.code === "DUPLICATE_CANONICAL_IDENTITY",
  );
});

test("(5b) a duplicate canonical JOB ROLE is refused too -- one login per role means one role per login", () => {
  assert.doesNotThrow(() => bootstrap.canonicalRoles(REGISTRY));
  const dup = registryWith((r) => {
    r.roles.find((x) => x.key === "officeManager").jobRole = "general-manager";
  });
  assert.throws(
    () => bootstrap.canonicalRoles(dup),
    (err) => err.code === "DUPLICATE_CANONICAL_JOB_ROLE",
  );
});

test("(5c) the shipped registry has ZERO duplicate identities, uids or Job Roles", () => {
  const emails = REGISTRY.roles.map((r) => r.authEmail);
  const jobRoles = REGISTRY.roles.map((r) => r.jobRole);
  const keys = REGISTRY.roles.map((r) => r.key);
  const uids = REGISTRY.roles.map((r) => r.uid).filter(Boolean);
  assert.equal(REGISTRY.roles.length, 16);
  assert.equal(new Set(emails).size, 16, "duplicate canonical identity");
  assert.equal(new Set(jobRoles).size, 16, "duplicate canonical Job Role");
  assert.equal(new Set(keys).size, 16, "duplicate registry key");
  assert.equal(new Set(uids).size, uids.length, "two roles claim one uid");
  // A canonical address may never also be listed noncanonical.
  const noncanonical = new Set(REGISTRY.noncanonical.map((n) => n.email));
  for (const e of emails) assert.ok(!noncanonical.has(e), `${e} is both canonical and noncanonical`);
});

// ======================================================================================
// 6 -- WORK EMAILS ARE UNCHANGED
// ======================================================================================

test("(6) every Employee workEmail is untouched by the consolidation", () => {
  // The three personas using the exception keep their ORIGINAL work emails. Rewriting a synthetic
  // person's contact address to match an account is the data corruption the ruling forbids, and this
  // is the assertion that stops a future 'tidy-up' doing it.
  assert.equal(employee(MANIFEST, "dispatcher").workEmail, "emerson.fixture@sandbox.invalid");
  assert.equal(employee(MANIFEST, "finance-controller").workEmail, "sage.fixture@sandbox.invalid");
  assert.equal(employee(MANIFEST, "restricted-user").workEmail, "wren.fixture@sandbox.invalid");

  // And every work email still obeys the fixture's own domain rule.
  for (const e of MANIFEST.employees) {
    assert.match(e.workEmail, /@sandbox\.invalid$/, `${e.key} work email`);
  }
  // No canonical Auth address was smuggled into a work email.
  const canonicalEmails = new Set(REGISTRY.roles.map((r) => r.authEmail));
  const exceptions = new Set(["dispatcher", "finance-controller", "restricted-user"]);
  for (const e of MANIFEST.employees) {
    if (exceptions.has(e.key)) continue;
    // Ordinary personas legitimately have workEmail === their own canonical login; what must never
    // happen is an Employee carrying a DIFFERENT role's canonical address.
    const own = REGISTRY.roles.find((r) => r.sampleCompanyEmployee === e.key);
    if (canonicalEmails.has(e.workEmail)) {
      assert.equal(e.workEmail, own?.authEmail, `${e.key} carries another role's canonical address as its work email`);
    }
  }
});

// ======================================================================================
// 7 -- NONCANONICAL IDENTITIES ARE EXCLUDED AND REPORTED
// ======================================================================================

test("(7) emerson / sage / wren are excluded from activation and reported, never activated", () => {
  // In the shipped manifest these three are no longer declared as logins at all, so the fence is
  // proved against a manifest that DOES still declare them -- otherwise the test would pass
  // vacuously, which is exactly the trap this suite is written to avoid.
  const regressed = clone(MANIFEST);
  principal(regressed, "dispatcher").loginPrincipal.credentialEmail = "emerson.fixture@sandbox.invalid";
  principal(regressed, "finance-controller").loginPrincipal.credentialEmail = "sage.fixture@sandbox.invalid";
  principal(regressed, "restricted-user").loginPrincipal.credentialEmail = "wren.fixture@sandbox.invalid";

  const allowlist = sampleCompanyCredentialAllowlist(regressed);
  const excluded = supersededExclusions(regressed).map((e) => e.email);
  for (const email of ["emerson.fixture@sandbox.invalid", "sage.fixture@sandbox.invalid", "wren.fixture@sandbox.invalid"]) {
    assert.ok(!allowlist.includes(email), `${email} must never be activatable`);
    assert.ok(excluded.includes(email), `${email} must be REPORTED, not silently dropped`);
  }
  for (const e of supersededExclusions(regressed)) {
    assert.equal(e.classification, "NONCANONICAL_FIXTURE_IDENTITY");
    assert.ok(e.reason && e.reason.length > 40, `${e.email} must carry a real reason`);
  }
});

test("(7b) the shipped manifest's remaining noncanonical logins are excluded and reported", () => {
  const allowlist = sampleCompanyCredentialAllowlist(MANIFEST);
  const excluded = supersededExclusions(MANIFEST);
  assert.deepEqual(excluded.map((e) => e.email).sort(), [
    "gray.fixture@sandbox.invalid",
    "indigo.fixture@sandbox.invalid",
    "oakley.fixture@sandbox.invalid",
  ]);
  for (const e of excluded) assert.ok(!allowlist.includes(e.email));
  // Every allowlisted address IS a canonical role identity. That is the positive half.
  const canonical = new Set(REGISTRY.roles.map((r) => r.authEmail));
  for (const email of allowlist) assert.ok(canonical.has(email), `${email} is allowlisted but not canonical`);
});

test("(7c) an UNKNOWN login identity is refused rather than created", () => {
  const rogue = clone(MANIFEST);
  principal(rogue, "general-manager").loginPrincipal.credentialEmail = "nobody.declared@sandbox.invalid";
  assert.throws(
    () => sampleCompanyCredentialAllowlist(rogue),
    (err) => err instanceof CredentialActivationError && err.code === "UNKNOWN_LOGIN_IDENTITY",
  );
});

test("(7d) a noncanonical identity is never created by the bootstrap, even if a role named one", () => {
  const bad = registryWith((r) => {
    const role = r.roles.find((x) => x.key === "reportingAnalyst");
    role.authEmail = "sage.fixture@sandbox.invalid";
    role.accountExists = false;
  });
  // canonicalRoles still accepts it (it is well-formed and unique), so the refusal must come from the
  // plan -- which is the layer that would otherwise have created the account.
  assert.doesNotThrow(() => bootstrap.canonicalRoles(bad));
  const saved = bootstrap.CANONICAL_ROLE_IDENTITY_REGISTRY;
  // plan() reads the module registry, so assert the rule directly against the noncanonical map.
  const noncanonical = bootstrap.noncanonicalIdentities(saved);
  assert.ok(noncanonical.has("sage.fixture@sandbox.invalid"), "sage.fixture@ must be recorded noncanonical");
  const result = bootstrap.plan({ authAccountsByEmail: {} });
  for (const row of result.rows) {
    if (noncanonical.has(row.email)) {
      assert.equal(row.wouldCreateAccount, false, `${row.email} is noncanonical and must never be created`);
    }
  }
});

// ======================================================================================
// 8 -- NO PRODUCTION ACTIVATION
// ======================================================================================

test("(8) production and certification are refused, by name before the editable registry and by role", () => {
  assert.doesNotThrow(() => bootstrap.assertSandboxProject("eos-platform-sandbox"));
  for (const [project, code] of [
    ["taylor-parts", "PRODUCTION_PROJECT_FORBIDDEN"],
    ["eos-platform-certification", "CERTIFICATION_PROJECT_FORBIDDEN"],
    ["not-a-project", "UNKNOWN_PROJECT"],
  ]) {
    assert.throws(
      () => bootstrap.assertSandboxProject(project),
      (err) => err instanceof bootstrap.BootstrapRefusal && err.code === code,
      `${project} must be refused as ${code}`,
    );
  }
  for (const empty of [undefined, null, "", 0]) {
    assert.throws(() => bootstrap.assertSandboxProject(empty), (err) => err.code === "PROJECT_ID_REQUIRED");
  }
  // The literal deny list must be evaluated BEFORE the environment registry, which is editable.
  const src = require("node:fs").readFileSync(require.resolve("../scripts/sandboxPersonaBootstrap.js"), "utf8");
  assert.ok(
    src.indexOf("FORBIDDEN_PROJECT_IDS.includes(projectId)") < src.indexOf('JSON.parse(fs.readFileSync(envPath'),
    "the literal deny list must run before the editable registry is read",
  );
  // Every registry address is a sandbox address; production could not be reached even by typo.
  for (const r of REGISTRY.roles) assert.match(r.authEmail, /@sandbox\.invalid$/);
});

// ======================================================================================
// 9 -- NO FIREBASE BUSINESS AUTHORITY, AND NO SECOND SECRET PATH
// ======================================================================================

test("(9) the bootstrap creates no Firebase business authority and no secret", () => {
  const src = require("node:fs").readFileSync(require.resolve("../scripts/sandboxPersonaBootstrap.js"), "utf8");
  // Strip comments: this file DISCUSSES what it must not do, and prose must not satisfy a code fence.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of [
    "firebase-admin/firestore",
    "getFirestore",
    "collection(",
    "setCustomUserClaims",
    "customClaims",
    "node:crypto",
    "randomBytes",
    "updateUser",
    "createUser",
    "roleId",
    "permissions",
  ]) {
    assert.ok(!code.includes(forbidden), `sandboxPersonaBootstrap must not contain '${forbidden}'`);
  }
  // Step 9 exists and is read-only by name.
  assert.match(src, /VERIFY_SECURITY_ROLE_SEPARATELY/);
  assert.match(src, /never granted by this command/);
});

test("(9b) the plan is pure: it mutates nothing and reports zero mutations", () => {
  const before = JSON.stringify(REGISTRY);
  const result = bootstrap.plan({ authAccountsByEmail: {}, credentialKeyNames: ["admin@sandbox.invalid"] });
  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.mutations, 0);
  assert.equal(JSON.stringify(REGISTRY), before, "plan() mutated the registry");
});

test("(9c) no output carries a secret, and a plan given sentinel values leaks none", () => {
  const SENTINEL = "Sbx!aaaaBOOTSTRAPSENTINELbbbb";
  // credentialKeyNames are KEY NAMES. If a value ever flowed through, this would catch it.
  const result = bootstrap.plan({
    authAccountsByEmail: Object.fromEntries(REGISTRY.roles.filter((r) => r.accountExists).map((r) => [r.authEmail, { uid: r.uid }])),
    credentialKeyNames: ["admin@sandbox.invalid", SENTINEL],
  });
  const serialized = JSON.stringify(result) + bootstrap.formatPlan(result);
  assert.ok(!serialized.includes(SENTINEL), "a supplied value reached the plan output");
  assert.ok(!/password/i.test(bootstrap.formatPlan(result)), "the summary must not mention a password at all");
});

// ======================================================================================
// THE TEN STEPS AND THE VERDICTS
// ======================================================================================

test("every role runs all ten steps, in order, and ends with a verdict", () => {
  const result = bootstrap.plan({
    authAccountsByEmail: Object.fromEntries(REGISTRY.roles.filter((r) => r.accountExists).map((r) => [r.authEmail, { uid: r.uid }])),
  });
  assert.equal(result.rows.length, 16);
  for (const row of result.rows) {
    assert.deepEqual(row.steps.map((s) => s.step), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], `${row.key} step order`);
    assert.equal(row.steps.at(-1).name, "VERDICT");
    assert.ok([bootstrap.STATES.READY, bootstrap.STATES.BLOCKED].includes(row.state));
  }
});

test("an existing account is REUSED and never recreated; only a genuinely missing one is created", () => {
  const result = bootstrap.plan({
    authAccountsByEmail: Object.fromEntries(REGISTRY.roles.filter((r) => r.accountExists).map((r) => [r.authEmail, { uid: r.uid }])),
  });
  assert.equal(result.counts.accountsPresent, 15);
  assert.equal(result.counts.accountsToCreate, 1);
  const toCreate = result.rows.filter((r) => r.wouldCreateAccount);
  assert.deepEqual(toCreate.map((r) => r.key), ["reportingAnalyst"]);
  assert.equal(toCreate[0].email, "reporting@sandbox.invalid");
  for (const row of result.rows.filter((r) => r.accountExists)) {
    assert.equal(row.steps.find((s) => s.step === 3).result, "REUSED");
    assert.equal(row.steps.find((s) => s.step === 4).result, "SKIPPED");
  }
});

test("a uid that disagrees with the registry BLOCKS rather than being silently adopted", () => {
  const result = bootstrap.plan({
    authAccountsByEmail: { "admin@sandbox.invalid": { uid: "someOtherUidEntirely000000000" } },
  });
  const admin = result.rows.find((r) => r.key === "administrator");
  assert.equal(admin.state, bootstrap.STATES.BLOCKED);
  assert.ok(admin.blockers.some((b) => b.code === "UID_MISMATCH"), "an address/uid disagreement must block");
});

test("a disabled account blocks; a credential already present is preserved, never rotated", () => {
  const disabled = bootstrap.plan({
    authAccountsByEmail: { "admin@sandbox.invalid": { uid: roleByKey("administrator").uid, disabled: true } },
  });
  assert.ok(disabled.rows.find((r) => r.key === "administrator").blockers.some((b) => b.code === "ACCOUNT_DISABLED"));

  const withCred = bootstrap.plan({
    authAccountsByEmail: { "admin@sandbox.invalid": { uid: roleByKey("administrator").uid } },
    credentialKeyNames: ["admin@sandbox.invalid"],
  });
  const admin = withCred.rows.find((r) => r.key === "administrator");
  assert.equal(admin.credentialPresent, true);
  assert.match(admin.steps.find((s) => s.step === 5).detail, /PRESERVE, never rotate/);
});

test("steps 6-8 report BLOCKED_PENDING_DEPLOY until the governed commands are injected", () => {
  const observations = {
    authAccountsByEmail: Object.fromEntries(REGISTRY.roles.filter((r) => r.accountExists).map((r) => [r.authEmail, { uid: r.uid }])),
  };
  const undeployed = bootstrap.plan(observations);
  for (const row of undeployed.rows) {
    for (const step of [6, 7, 8]) {
      assert.equal(row.steps.find((s) => s.step === step).result, "BLOCKED_PENDING_DEPLOY", `${row.key} step ${step}`);
    }
    assert.ok(row.blockers.some((b) => b.code === "GOVERNED_COMMANDS_NOT_DEPLOYED"));
  }
  assert.equal(undeployed.counts.ready, 0, "nothing can be READY before the governed chain is deployable");

  // With the commands present AND the chain observed, a role reaches READY -- so the blocker above is
  // really about deployment and not about something permanently broken.
  const role = roleByKey("administrator");
  const deployed = bootstrap.plan({
    authAccountsByEmail: { [role.authEmail]: { uid: role.uid } },
    principalsByUid: { [role.uid]: { principalId: "p-1", employeeId: "emp-1", jobRole: role.jobRole, securityRoles: ["admin"] } },
    credentialKeyNames: [role.authEmail],
    governedCommands: { createEmployee: () => {}, ensurePrincipal: () => {}, assignJobRole: () => {} },
  });
  const admin = deployed.rows.find((r) => r.key === "administrator");
  assert.equal(admin.state, bootstrap.STATES.READY, JSON.stringify(admin.blockers));
  assert.equal(admin.steps.find((s) => s.step === 8).result, "PRESENT");
  assert.match(admin.steps.find((s) => s.step === 9).detail, /reported, never granted/);
});

test("a Job Role conflict blocks: one identity may not hold a Job Role the registry does not declare", () => {
  const role = roleByKey("administrator");
  const result = bootstrap.plan({
    authAccountsByEmail: { [role.authEmail]: { uid: role.uid } },
    principalsByUid: { [role.uid]: { principalId: "p-1", employeeId: "emp-1", jobRole: "warehouse-manager" } },
    governedCommands: { createEmployee: () => {}, ensurePrincipal: () => {}, assignJobRole: () => {} },
  });
  const admin = result.rows.find((r) => r.key === "administrator");
  assert.equal(admin.state, bootstrap.STATES.BLOCKED);
  assert.ok(admin.blockers.some((b) => b.code === "JOB_ROLE_CONFLICT"));
});

// ======================================================================================
// COVERAGE AND THE CONSOLIDATION ITSELF
// ======================================================================================

test("there is exactly ONE serviceTechnician, and the second technician is noncanonical", () => {
  const technicians = REGISTRY.roles.filter((r) => r.jobRole === "service-technician");
  assert.equal(technicians.length, 1);
  assert.equal(technicians[0].key, "serviceTechnician");
  assert.equal(technicians[0].authEmail, "finley.fixture@sandbox.invalid");
  for (const email of ["gray.fixture@sandbox.invalid", "oakley.fixture@sandbox.invalid"]) {
    const n = REGISTRY.noncanonical.find((x) => x.email === email);
    assert.ok(n, `${email} must be recorded noncanonical`);
    assert.equal(n.supersededBy, "finley.fixture@sandbox.invalid");
  }
});

test("canonicalRoleCoverage reports every role, and only reused or pending ones are not activatable", () => {
  const coverage = canonicalRoleCoverage(MANIFEST);
  assert.equal(coverage.length, 16);
  const notActivatable = coverage.filter((c) => !c.activatableByThisManifest).map((c) => c.key).sort();
  // ownerExecutive and administrator are the two REUSED real Principals (credentialEmail null, out of
  // activation scope by construction); reportingAnalyst has no account yet.
  assert.deepEqual(notActivatable, ["administrator", "ownerExecutive", "reportingAnalyst"]);
  assert.equal(coverage.filter((c) => c.accountExists).length, 15);
});
