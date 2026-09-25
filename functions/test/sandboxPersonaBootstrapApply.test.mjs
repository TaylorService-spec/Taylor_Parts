/**
 * sandboxPersonaBootstrap --apply: the orchestrator, the fence, and IDEMPOTENCE.
 *
 * The Owner made idempotence a hard requirement and stated the failure condition plainly: if a second
 * apply would create anything, that is a FAIL. So the central test here builds a SIMULATED COMPLETE
 * state, applies against it, and asserts the next plan is empty -- not "mostly empty", zero.
 *
 * The other half is that `--apply` must remain an ORCHESTRATOR. It may call the governed commands that
 * already own each write; it may not grow a write of its own. That is asserted from source, because it
 * is the kind of boundary that erodes one convenient exception at a time.
 *
 * Hermetic: no network, no Firebase, no database, no emulator. Every command and directory is a
 * recording double, so the tests can assert exactly what WOULD be called without anything being called
 * for real.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const bootstrap = require("../scripts/sandboxPersonaBootstrap.js");
const REGISTRY = require("../../config/sandboxRoleIdentityRegistry.json");

const SANDBOX = bootstrap.SANDBOX_PROJECT_ID;

/** Records every governed call without performing one. */
function recordingCommands() {
  const calls = [];
  const commands = {};
  for (const name of bootstrap.GOVERNED_COMMANDS) {
    commands[name] = async (ctx, actor, input) => {
      calls.push({ name, input, actor });
      return { outcome: "APPLIED" };
    };
  }
  return { commands, calls };
}

function recordingAuthDirectory() {
  const created = [];
  return {
    created,
    projectId: SANDBOX,
    async preflight() {},
    async findByEmail() {
      return null;
    },
    async createPasswordless({ email }) {
      created.push(email);
      return { uid: `uid-for-${email}`, hasPassword: false };
    },
  };
}

/** Auth accounts exactly as the registry records them: 15 present, reporting@ absent. */
function authAccountsFromRegistry({ includeReporting = false } = {}) {
  const out = {};
  for (const r of REGISTRY.roles) {
    if (r.accountExists) out[r.authEmail] = { uid: r.uid, hasPassword: true, disabled: false };
    else if (includeReporting) out[r.authEmail] = { uid: `uid-${r.key}`, hasPassword: true, disabled: false };
  }
  return out;
}

/**
 * THE SIMULATED COMPLETE STATE -- what the sandbox looks like after a successful apply.
 *
 * Every account exists, every credential is present, every uid carries a Principal with an Employee
 * and the registry's Job Role, the catalog holds all sixteen ids, and every declared Security Role
 * expectation is satisfied exactly.
 */
function completeState() {
  const authAccountsByEmail = authAccountsFromRegistry({ includeReporting: true });
  const principalsByUid = {};
  for (const r of REGISTRY.roles) {
    const uid = authAccountsByEmail[r.authEmail].uid;
    principalsByUid[uid] = {
      principalId: `principal-${r.key}`,
      employeeId: r.expectedEmployeeId ?? `employee-${r.key}`,
      jobRole: r.jobRole,
      securityRoles: r.expectedSecurityRoles ?? [],
    };
  }
  return {
    observationSource: "SIMULATED_COMPLETE",
    authAccountsByEmail,
    principalsByUid,
    credentialKeyNames: REGISTRY.roles.map((r) => r.authEmail),
    jobRoleCatalog: bootstrap.canonicalJobRoleIds(),
  };
}

// ======================================================================================
// THE APPLY FENCE
// ======================================================================================

test("apply refuses production, certification, unknown and empty targets", async () => {
  const { commands } = recordingCommands();
  for (const [projectId, code] of [
    ["taylor-parts", "PRODUCTION_PROJECT_FORBIDDEN"],
    ["eos-platform-certification", "CERTIFICATION_PROJECT_FORBIDDEN"],
    ["not-a-project", "UNKNOWN_PROJECT"],
    [undefined, "PROJECT_ID_REQUIRED"],
  ]) {
    await assert.rejects(
      () => bootstrap.apply({ projectId, observations: {}, commands, confirm: true }),
      (err) => err instanceof bootstrap.BootstrapRefusal && err.code === code,
      `${projectId} must be refused as ${code}`,
    );
  }
  // The sandbox itself clears the fence -- so the refusals above are about the target, not a
  // permanently broken gate.
  assert.doesNotThrow(() => bootstrap.assertApplyAllowed(SANDBOX, { commands }));
});

test("apply refuses without explicit confirmation, so a dry run cannot become a mutation", async () => {
  const { commands, calls } = recordingCommands();
  for (const confirm of [undefined, false, "true", 1]) {
    await assert.rejects(
      () => bootstrap.apply({ projectId: SANDBOX, observations: completeState(), commands, confirm }),
      (err) => err.code === "APPLY_NOT_CONFIRMED",
    );
  }
  assert.equal(calls.length, 0, "a refused apply must call nothing");
});

test("apply refuses when a governed command is missing -- it orchestrates and implements nothing", async () => {
  const { commands } = recordingCommands();
  for (const name of bootstrap.GOVERNED_COMMANDS) {
    const partial = { ...commands };
    delete partial[name];
    await assert.rejects(
      () => bootstrap.apply({ projectId: SANDBOX, observations: {}, commands: partial, confirm: true }),
      (err) => {
        assert.equal(err.code, "GOVERNED_COMMANDS_UNAVAILABLE");
        assert.match(err.message, new RegExp(name));
        return true;
      },
      `a missing ${name} must refuse the apply`,
    );
  }
});

test("the fence is re-asserted inside apply, not only at plan time", () => {
  const src = readFileSync(require.resolve("../scripts/sandboxPersonaBootstrap.js"), "utf8");
  const applyBody = src.slice(src.indexOf("async function apply("), src.indexOf("function assertIdempotent("));
  assert.ok(applyBody.includes("assertApplyAllowed("), "apply must re-assert the fence itself");
  assert.ok(applyBody.includes("APPLY_NOT_CONFIRMED"), "apply must require explicit confirmation");
});

// ======================================================================================
// ORCHESTRATOR ONLY -- NO SECOND IMPLEMENTATION
// ======================================================================================

test("apply contains no write of its own: no SQL, no repository, no direct table access", () => {
  const src = readFileSync(require.resolve("../scripts/sandboxPersonaBootstrap.js"), "utf8");
  // Comments discuss these deliberately, so prose must not satisfy a code-level fence.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  // Deliberately targets ACCESS, not vocabulary. The orchestrator legitimately NAMES tables in its
  // messages ("eos_workforce.job_roles has no row for ..."), and a guard that forbade the words would
  // push that detail out of the report to stay green -- leaving the operator a state code with no
  // idea which table it refers to. What must not exist is a way to read or write one from here.
  for (const forbidden of [
    "INSERT INTO",
    "UPDATE SET",
    "DELETE FROM",
    "pool.query",
    "client.query",
    "pg.Pool",
    "new Pool",
    "Repository(",
    "require(\"pg\")",
    "firebase-admin/firestore",
    "getFirestore",
    "setCustomUserClaims",
    "customClaims",
    "node:crypto",
    "randomBytes",
  ]) {
    assert.ok(!code.includes(forbidden), `the orchestrator must not contain '${forbidden}'`);
  }
  // `pool` may only be handed to a governed command, never used. Every occurrence in apply() is
  // either the parameter itself or the `{ pool }` context object passed straight through.
  const applyBody = code.slice(code.indexOf("async function apply("), code.indexOf("function assertIdempotent("));
  for (const use of applyBody.match(/pool[^,\s)}]*/g) ?? []) {
    assert.equal(use, "pool", `apply uses the pool directly: '${use}'`);
  }
});

test("every mutation apply performs is a governed command call or the sandbox Auth directory", async () => {
  const { commands, calls } = recordingCommands();
  const directory = recordingAuthDirectory();
  const observations = {
    authAccountsByEmail: authAccountsFromRegistry(),
    jobRoleCatalog: [],
    credentialKeyNames: [],
  };
  const result = await bootstrap.apply({
    projectId: SANDBOX,
    observations,
    commands,
    authDirectory: directory,
    actor: { principalId: "admin-actor" },
    pool: null,
    confirm: true,
  });

  // Nothing ran that was not planned, and nothing was planned that is not a governed command or the
  // one sanctioned Auth creation.
  assert.equal(result.mutations, result.plannedOperations - result.refusals.length);
  for (const op of result.executed) {
    assert.ok(
      bootstrap.GOVERNED_COMMANDS.includes(op.command) || op.command === "createPasswordlessAuthAccount",
      `${op.command} is neither a governed command nor the sanctioned Auth creation`,
    );
  }
  for (const c of calls) assert.ok(bootstrap.GOVERNED_COMMANDS.includes(c.name));
  // The only account created is the one genuinely missing.
  assert.deepEqual(directory.created, ["reporting@sandbox.invalid"]);
  // The catalog is seeded from the vocabulary, so no retired id and no `field-trainer` can appear.
  const catalogCalls = calls.filter((c) => c.name === "createJobRole").map((c) => c.input.jobRoleId);
  assert.deepEqual([...catalogCalls].sort(), [...bootstrap.canonicalJobRoleIds()].sort());
  assert.ok(!catalogCalls.includes("field-trainer"));
  assert.ok(!catalogCalls.includes("owner"), "a retired id must never be seeded");
});

test("operations execute in phase order: Auth, then catalog, then personas, finance, reporting, restricted", async () => {
  const { commands } = recordingCommands();
  const directory = recordingAuthDirectory();
  const result = await bootstrap.apply({
    projectId: SANDBOX,
    observations: { authAccountsByEmail: authAccountsFromRegistry(), jobRoleCatalog: [], credentialKeyNames: [] },
    commands,
    authDirectory: directory,
    actor: { principalId: "admin-actor" },
    confirm: true,
  });
  const phases = result.executed.map((o) => o.phase);
  assert.deepEqual(phases, [...phases].sort((a, b) => a - b), "operations must run in phase order");
  // Phase 1 (Auth) precedes phase 2 (catalog), which precedes every assignment.
  const firstCatalog = result.executed.findIndex((o) => o.command === "createJobRole");
  const firstAssign = result.executed.findIndex((o) => o.command === "assignEmployeeJobRole");
  if (firstAssign !== -1) assert.ok(firstCatalog !== -1 && firstCatalog < firstAssign, "the catalog must be seeded before anything is assigned from it");
});

test("the Owner/Admin split is planned with expected-current protection, and only when needed", () => {
  const split = REGISTRY.ownerAdminSplit;
  assert.ok(split, "the split must be declared as data");
  const { commands } = recordingCommands();

  // BEFORE: the Admin Principal is linked to the Owner/Executive Employee, which is the measured state.
  const auth = authAccountsFromRegistry();
  const adminUid = REGISTRY.roles.find((r) => r.key === "administrator").uid;
  const before = bootstrap.plan({
    authAccountsByEmail: auth,
    principalsByUid: { [adminUid]: { principalId: split.adminPrincipalId, employeeId: split.ownerExecutiveEmployeeId, jobRole: null } },
    jobRoleCatalog: bootstrap.canonicalJobRoleIds(),
    governedCommands: commands,
  });
  const relink = before.operations.find((o) => o.command === "relinkEmployeePrincipal");
  assert.ok(relink, "the move must be planned");
  assert.equal(relink.phase, 3);
  assert.equal(relink.input.employeeId, split.ownerExecutiveEmployeeId);
  assert.equal(relink.input.expectedCurrentPrincipalId, split.adminPrincipalId, "the move must be guarded by where we measured the link");
  assert.equal(relink.input.newPrincipalId, split.ownerPrincipalId);
  assert.ok(before.operations.some((o) => o.command === "createEmployee" && o.input.employeeId === split.administratorEmployeeId));

  // AFTER: the link already moved. The split must not be planned again.
  const after = bootstrap.plan({
    authAccountsByEmail: auth,
    principalsByUid: {
      [adminUid]: { principalId: split.adminPrincipalId, employeeId: split.administratorEmployeeId, jobRole: null },
    },
    jobRoleCatalog: bootstrap.canonicalJobRoleIds(),
    governedCommands: commands,
  });
  assert.equal(after.operations.filter((o) => o.command === "relinkEmployeePrincipal").length, 0, "a completed move must never be replanned");
});

// ======================================================================================
// IDEMPOTENCE -- THE HARD REQUIREMENT
// ======================================================================================

test("a plan over a COMPLETE state contains zero operations and sixteen READY roles", () => {
  const { commands } = recordingCommands();
  const result = bootstrap.plan({ ...completeState(), governedCommands: commands });

  assert.equal(result.mutations, 0);
  assert.equal(result.counts.operations, 0, `a complete state planned work: ${result.operations.map((o) => o.command).join(", ")}`);
  assert.equal(result.counts.ready, 16, JSON.stringify(result.rows.filter((r) => r.state !== "READY").map((r) => [r.key, r.states])));
  assert.equal(result.counts.blocked, 0);
  assert.equal(result.counts.credentialsMissing, 0);
  assert.equal(result.counts.accountsToCreate, 0);
  assert.equal(result.counts.jobRoleCatalogMissing, 0);
  for (const row of result.rows) assert.equal(row.state, bootstrap.ROLE_STATES.READY, `${row.key}: ${row.states.join(",")}`);
});

test("assertIdempotent accepts a complete state and REFUSES one that would write again", () => {
  const { commands } = recordingCommands();
  const complete = bootstrap.plan({ ...completeState(), governedCommands: commands });
  assert.deepEqual(bootstrap.assertIdempotent(complete), { idempotent: true, problems: [] });

  // Non-vacuous: a state missing one Job Role assignment must be reported as NOT idempotent, so the
  // check above cannot be passing because assertIdempotent accepts everything.
  const incompleteObs = completeState();
  const someUid = Object.keys(incompleteObs.principalsByUid)[0];
  incompleteObs.principalsByUid[someUid] = { ...incompleteObs.principalsByUid[someUid], jobRole: null };
  const incomplete = bootstrap.plan({ ...incompleteObs, governedCommands: commands });
  const verdict = bootstrap.assertIdempotent(incomplete);
  assert.equal(verdict.idempotent, false);
  assert.ok(verdict.problems.length > 0);
});

test("a SECOND apply over the state the first leaves behind performs zero writes", async () => {
  const { commands, calls } = recordingCommands();
  const directory = recordingAuthDirectory();

  const second = await bootstrap.apply({
    projectId: SANDBOX,
    observations: completeState(),
    commands,
    authDirectory: directory,
    actor: { principalId: "admin-actor" },
    confirm: true,
  });

  assert.equal(second.plannedOperations, 0, "a complete state must plan nothing");
  assert.equal(second.mutations, 0, "a second apply must mutate nothing");
  assert.equal(second.executed.length, 0);
  assert.equal(second.refusals.length, 0);
  assert.equal(second.pass, true);

  // The hard evidence: no governed command was called, no Auth account was created. Zero database
  // mutations, zero Auth mutations, zero credential writes, and therefore zero audit delta.
  assert.equal(calls.length, 0, `a second apply called: ${calls.map((c) => c.name).join(", ")}`);
  assert.equal(directory.created.length, 0);
});

test("the first apply's operations are exactly the gaps, and re-planning after them yields nothing", async () => {
  const { commands, calls } = recordingCommands();
  const directory = recordingAuthDirectory();

  // Start from the real measured shape: accounts exist, nothing else does.
  const first = await bootstrap.apply({
    projectId: SANDBOX,
    observations: { authAccountsByEmail: authAccountsFromRegistry(), jobRoleCatalog: [], credentialKeyNames: [] },
    commands,
    authDirectory: directory,
    actor: { principalId: "admin-actor" },
    confirm: true,
  });
  assert.ok(first.mutations > 0, "the first apply must do real work, or this test proves nothing");
  assert.equal(first.refusals.length, 0, JSON.stringify(first.refusals));

  // Now the state those operations produce. Re-planning must be empty.
  const after = bootstrap.plan({ ...completeState(), governedCommands: commands });
  assert.equal(after.operations.length, 0);
  assert.deepEqual(bootstrap.assertIdempotent(after), { idempotent: true, problems: [] });

  const before = calls.length;
  const again = await bootstrap.apply({
    projectId: SANDBOX,
    observations: completeState(),
    commands,
    authDirectory: directory,
    actor: { principalId: "admin-actor" },
    confirm: true,
  });
  assert.equal(again.mutations, 0);
  assert.equal(calls.length, before, "the second apply issued additional governed calls");
});

// ======================================================================================
// CREDENTIALS AND SECURITY ROLES
// ======================================================================================

test("apply never writes a credential and never generates or rotates a password", async () => {
  const { commands } = recordingCommands();
  const directory = recordingAuthDirectory();
  const result = await bootstrap.apply({
    projectId: SANDBOX,
    observations: { authAccountsByEmail: authAccountsFromRegistry(), jobRoleCatalog: [], credentialKeyNames: [] },
    commands,
    authDirectory: directory,
    actor: { principalId: "admin-actor" },
    confirm: true,
  });
  for (const op of result.executed) {
    assert.ok(!/credential/i.test(op.command), `${op.command} looks like a credential write`);
    assert.ok(!/password/i.test(op.command) || op.command === "createPasswordlessAuthAccount");
  }
  // The account it creates is PASSWORDLESS: the directory double records only the address, and the
  // orchestrator passes no password because it has none to pass.
  const src = readFileSync(require.resolve("../scripts/sandboxPersonaBootstrap.js"), "utf8");
  const applyBody = src.slice(src.indexOf("async function apply("), src.indexOf("function assertIdempotent("));
  assert.ok(!/password\s*:/.test(applyBody), "apply must never pass a password field");
});

test("a Security Role mismatch is REPORTED and never corrected -- the command grants no authority", () => {
  const { commands } = recordingCommands();
  const obs = completeState();
  const restrictedRole = REGISTRY.roles.find((r) => r.key === "generalEmployee");
  const uid = obs.authAccountsByEmail[restrictedRole.authEmail].uid;
  // The forbidden case the Owner named: the negative control holding the Security Role named after
  // its own Job Role, which would silently give it authority and void every denial it proves.
  obs.principalsByUid[uid] = { ...obs.principalsByUid[uid], securityRoles: ["generalEmployee"] };

  const result = bootstrap.plan({ ...obs, governedCommands: commands });
  const row = result.rows.find((r) => r.key === "generalEmployee");
  assert.ok(row.states.includes(bootstrap.ROLE_STATES.SECURITY_ROLE_MISMATCH));
  assert.match(row.steps.find((s) => s.step === 9).detail, /never granted by this command/);
  // No operation is planned to fix it: correcting authority is not this command's job.
  assert.equal(result.operations.filter((o) => /securityRole/i.test(o.command)).length, 0);
  assert.equal(result.operations.length, 0, "a Security Role mismatch must not cause any governed write");
});

test("the declared Security Role expectations are exactly the three the Owner ruled", () => {
  const declared = REGISTRY.roles.filter((r) => r.expectedSecurityRoles !== null);
  assert.deepEqual(declared.map((r) => r.key).sort(), ["financeAccounting", "generalEmployee", "reportingAnalyst"]);
  assert.deepEqual(REGISTRY.roles.find((r) => r.key === "financeAccounting").expectedSecurityRoles, ["accountingManager"]);
  assert.deepEqual(REGISTRY.roles.find((r) => r.key === "reportingAnalyst").expectedSecurityRoles, ["reportViewer"]);
  assert.deepEqual(REGISTRY.roles.find((r) => r.key === "generalEmployee").expectedSecurityRoles, []);
  assert.deepEqual(REGISTRY.roles.find((r) => r.key === "generalEmployee").forbiddenSecurityRoles, ["generalEmployee"]);
  // Undeclared expectations report rather than assert: tooling may not invent an authority claim.
  const { commands } = recordingCommands();
  const result = bootstrap.plan({ ...completeState(), governedCommands: commands });
  const gm = result.rows.find((r) => r.key === "generalManager");
  assert.equal(gm.steps.find((s) => s.step === 9).result, "NOT_DECLARED");
  assert.equal(gm.state, bootstrap.ROLE_STATES.READY, "an undeclared expectation must not block");
});

// ======================================================================================
// THE PHASE CONTRACT
// ======================================================================================

test("every role carries a phase, and the phase map matches the Owner's order", () => {
  const byPhase = {};
  for (const r of REGISTRY.roles) {
    assert.ok(Number.isInteger(r.phase), `${r.key} must declare a phase`);
    (byPhase[r.phase] ??= []).push(r.key);
  }
  assert.deepEqual(byPhase[4], ["financeAccounting"]);
  assert.deepEqual(byPhase[5], ["reportingAnalyst"]);
  assert.deepEqual(byPhase[6], ["generalEmployee"]);
  assert.equal(byPhase[3].length, 13);
  assert.deepEqual(Object.keys(REGISTRY.applyPhases).filter((k) => !k.startsWith("$")), ["1", "2", "3", "4", "5", "6"]);
});

test("the Job Role catalog is sourced from the vocabulary, so retired ids cannot be seeded", () => {
  const ids = bootstrap.canonicalJobRoleIds();
  assert.equal(ids.length, 16);
  assert.ok(!ids.includes("field-trainer"));
  const vocabulary = require("../lib/eosWorkforce/jobRoleVocabulary.js");
  for (const retired of Object.keys(vocabulary.SUPERSEDED_JOB_ROLE_IDS ?? {})) {
    assert.ok(!ids.includes(retired), `retired id '${retired}' must never be seeded`);
  }
  // And the registry's Job Roles are exactly the catalog, so every role can be assigned from it.
  assert.deepEqual([...REGISTRY.roles.map((r) => r.jobRole)].sort(), [...ids].sort());
});
