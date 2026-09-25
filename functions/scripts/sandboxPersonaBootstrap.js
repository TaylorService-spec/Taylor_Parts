/**
 * sandboxPersonaBootstrap -- the permanent reconciler for the canonical sandbox role registry.
 *
 * ============================ WHAT IT IS FOR ============================
 *
 * OWNER RULING 2026-09-25: ONE CANONICAL SANDBOX LOGIN PER CANONICAL JOB ROLE. This command is how
 * that stays true. It walks the sixteen canonical roles and, per role, reconciles the whole chain:
 *
 *     Credential -> Auth account -> EOS Principal -> Employee -> exactly one Job Role
 *
 * and reports READY or BLOCKED. It is the replacement for a pile of one-off persona scripts, each of
 * which knew a slightly different set of addresses.
 *
 * ============================ THE TEN STEPS, PER ROLE ============================
 *
 *   1  resolve the registry entry                 config/sandboxRoleIdentityRegistry.json
 *   2  authoritative Firebase Auth lookup         by the registry's declared address
 *   3  reuse an existing account                   ALWAYS preferred; never recreated
 *   4  create only a genuinely missing account     passwordless, and only when step 2 found nothing
 *   5  ensure the local credential exists          delegated; never generated here
 *   6  ensure the EOS Principal                    governed command
 *   7  ensure the Employee                         governed command
 *   8  ensure exactly ONE canonical Job Role       governed command
 *   9  verify the expected Security Role           SEPARATELY, and read-only
 *  10  emit READY / BLOCKED
 *
 * Step 9 is deliberately its own step and deliberately read-only. Security Roles are NOT Job Roles:
 * this command owns identity and Job Role, and it must never be the thing that grants authority. It
 * reports a Security Role mismatch as a finding for someone to rule on.
 *
 * ============================ WHAT IT MUST NEVER DO ============================
 *
 *   - NO SECOND PASSWORD IMPLEMENTATION. Step 5 delegates to `activateMissingSandboxPasswords` in
 *     activateSandboxPersonas.js -- the one password-generating path in this repository. There is no
 *     `node:crypto` here and no `password` anywhere in this file.
 *   - NO FIREBASE BUSINESS AUTHORITY. No role documents, no permission documents, no business custom
 *     claims, no Firestore of any kind. Firebase is transitional identity and session ONLY; EOS
 *     PostgreSQL is the Employee, Role and capability authority.
 *   - NO DUPLICATE IDENTITY. An existing account is reused. A noncanonical fixture identity is never
 *     created, reset or activated, and never receives a duplicate Principal.
 *   - NO SECRETS IN OUTPUT. Every report carries addresses, uids, Job Roles and states. A uid is an
 *     identifier; a password is never read, returned, logged or measured.
 *   - STRICTLY `eos-platform-sandbox`. Production by name and by registry role, and the frozen
 *     Certification world, all fail closed BEFORE anything is read.
 *
 * ============================ SEQUENCING ============================
 *
 * Steps 6-8 need the governed `createEmployee` / Principal / `assignEmployeeJobRole` commands. Those
 * are on this branch and NOT YET DEPLOYED, so they are injected rather than imported, and with no
 * injection the steps report BLOCKED_PENDING_DEPLOY instead of guessing. That is why this command
 * ships with dry-run and unit coverage now and is RUN after merge and deploy.
 *
 * DRY RUN IS THE DEFAULT. `apply` must be passed explicitly, and `plan()` never mutates anything at
 * all -- it is pure over the inputs it is handed.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REGISTRY = require("../../config/sandboxRoleIdentityRegistry.json");

const SANDBOX_EMAIL_SUFFIX = "@sandbox.invalid";
const SANDBOX_PROJECT_ID = "eos-platform-sandbox";
/** Denied BY NAME, before the (editable) environment registry is consulted. */
const FORBIDDEN_PROJECT_IDS = Object.freeze(["taylor-parts"]);
/** Frozen by its own ruling: a separate identity namespace with a separate lifecycle. */
const FROZEN_PROJECT_IDS = Object.freeze(["eos-platform-certification"]);

const STATES = Object.freeze({
  READY: "READY",
  BLOCKED: "BLOCKED",
});

class BootstrapRefusal extends Error {
  constructor(code, detail) {
    // Carries a code and a reason. Never a credential and never a file's contents.
    super(`${code}: ${detail}`);
    this.name = "BootstrapRefusal";
    this.code = code;
  }
}

/**
 * Refuse any target that is not the one sandbox, by two independent fences.
 *
 * The literal deny list runs FIRST, so `taylor-parts` is refused before `config/environments.json`
 * is even read: a registry that has been edited to relabel production as `sandbox` still cannot let
 * it through. The role check then catches any other production environment.
 */
function assertSandboxProject(projectId, { registryPath } = {}) {
  if (!projectId || typeof projectId !== "string") {
    throw new BootstrapRefusal("PROJECT_ID_REQUIRED", "no default target; name the project explicitly");
  }
  if (FORBIDDEN_PROJECT_IDS.includes(projectId)) {
    throw new BootstrapRefusal("PRODUCTION_PROJECT_FORBIDDEN", `'${projectId}' is the customer production project`);
  }
  if (FROZEN_PROJECT_IDS.includes(projectId)) {
    throw new BootstrapRefusal("CERTIFICATION_PROJECT_FORBIDDEN", `'${projectId}' is the frozen Certification world`);
  }

  const envPath = registryPath ?? path.resolve(__dirname, "../../config/environments.json");
  let environments;
  try {
    environments = JSON.parse(fs.readFileSync(envPath, "utf8")).environments ?? [];
  } catch (err) {
    throw new BootstrapRefusal("ENVIRONMENT_REGISTRY_UNREADABLE", `cannot read the environment registry (${err.code ?? "error"})`);
  }
  const env = environments.find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) {
    throw new BootstrapRefusal("UNKNOWN_PROJECT", `'${projectId}' is not a provisioned environment; unknown projects fail closed`);
  }
  if (env.role === "production") {
    throw new BootstrapRefusal("PRODUCTION_ROLE_FORBIDDEN", `environment '${env.id}' has role 'production'`);
  }
  if (projectId !== SANDBOX_PROJECT_ID) {
    throw new BootstrapRefusal("WRONG_SANDBOX_PROJECT", `this command is pinned to '${SANDBOX_PROJECT_ID}', not '${projectId}'`);
  }
  if (REGISTRY.firebaseProjectId !== SANDBOX_PROJECT_ID) {
    throw new BootstrapRefusal("REGISTRY_PROJECT_MISMATCH", `the role registry names '${REGISTRY.firebaseProjectId}'`);
  }
  return env;
}

/** The canonical registry, validated. A malformed registry is refused rather than half-applied. */
function canonicalRoles(registry = REGISTRY) {
  const roles = registry.roles ?? [];
  const byEmail = new Map();
  const byJobRole = new Map();
  for (const r of roles) {
    if (!r.key || !r.jobRole || !r.authEmail) {
      throw new BootstrapRefusal("REGISTRY_ENTRY_INCOMPLETE", `a role entry lacks key, jobRole or authEmail`);
    }
    if (!r.authEmail.endsWith(SANDBOX_EMAIL_SUFFIX)) {
      throw new BootstrapRefusal("REGISTRY_EMAIL_REFUSED", `${r.key}: '${r.authEmail}' is not a ${SANDBOX_EMAIL_SUFFIX} address`);
    }
    // ONE login per role and ONE role per login, enforced here rather than trusted.
    if (byEmail.has(r.authEmail)) {
      throw new BootstrapRefusal("DUPLICATE_CANONICAL_IDENTITY", `${r.authEmail} is claimed by both '${byEmail.get(r.authEmail)}' and '${r.key}'`);
    }
    if (byJobRole.has(r.jobRole)) {
      throw new BootstrapRefusal("DUPLICATE_CANONICAL_JOB_ROLE", `Job Role '${r.jobRole}' is claimed by both '${byJobRole.get(r.jobRole)}' and '${r.key}'`);
    }
    byEmail.set(r.authEmail, r.key);
    byJobRole.set(r.jobRole, r.key);
  }
  return roles;
}

/** Addresses that must never be created, reset or activated as a canonical acceptance user. */
function noncanonicalIdentities(registry = REGISTRY) {
  return new Map((registry.noncanonical ?? []).map((n) => [n.email, n]));
}

/**
 * THE PLAN. Pure: it reads the registry and whatever observations it is handed, and returns what it
 * WOULD do. It performs no lookup, no creation and no write, which is what makes it safe to run
 * anywhere and easy to test exhaustively.
 *
 * @param observations.authAccountsByEmail  Map/object email -> { uid, disabled?, hasPassword? }
 * @param observations.credentialKeyNames   iterable of credential-file KEY NAMES (never values)
 * @param observations.principalsByUid      Map/object uid -> { principalId, employeeId?, jobRole?, securityRoles? }
 * @param observations.governedCommands     { createEmployee?, ensurePrincipal?, assignJobRole? } -- presence only
 */
function plan(observations = {}) {
  const roles = canonicalRoles();
  const noncanonical = noncanonicalIdentities();
  const asMap = (v) => (v instanceof Map ? v : new Map(Object.entries(v ?? {})));

  const accounts = asMap(observations.authAccountsByEmail);
  const principals = asMap(observations.principalsByUid);
  const credentials = new Set([...(observations.credentialKeyNames ?? [])].map((k) => String(k).toLowerCase()));
  const commands = observations.governedCommands ?? {};
  const governedAvailable = Boolean(commands.createEmployee && commands.ensurePrincipal && commands.assignJobRole);

  const rows = roles.map((r) => {
    const steps = [];
    const blockers = [];

    // 1 -- resolve the registry entry.
    steps.push({ step: 1, name: "RESOLVE_REGISTRY_ENTRY", result: "OK", detail: `${r.key} -> ${r.jobRole}` });

    // 2 -- authoritative Auth lookup, by the registry's declared address and nothing else.
    const account = accounts.get(r.authEmail) ?? null;
    steps.push({
      step: 2,
      name: "AUTH_LOOKUP",
      result: account ? "FOUND" : "NOT_FOUND",
      detail: account ? `uid ${account.uid}` : `no account for ${r.authEmail}`,
    });

    // A uid that disagrees with the registry means the address and the account have come apart --
    // the exact defect that put the dispatcher key in front of an identity nothing stood behind.
    if (account && r.uid && account.uid !== r.uid) {
      blockers.push({
        code: "UID_MISMATCH",
        detail: `${r.authEmail} resolves to uid ${account.uid}, but the registry declares ${r.uid}. One of them is wrong and neither may be guessed.`,
      });
    }
    if (account && account.disabled === true) {
      blockers.push({ code: "ACCOUNT_DISABLED", detail: `${r.authEmail} exists but is disabled` });
    }

    // 3 / 4 -- reuse, or create only what is genuinely missing.
    if (account) {
      steps.push({ step: 3, name: "REUSE_EXISTING_ACCOUNT", result: "REUSED", detail: "never recreated, never reset" });
      steps.push({ step: 4, name: "CREATE_MISSING_ACCOUNT", result: "SKIPPED", detail: "an account exists; creating another would duplicate the role's identity" });
    } else {
      steps.push({ step: 3, name: "REUSE_EXISTING_ACCOUNT", result: "NOT_APPLICABLE", detail: "no account to reuse" });
      // Refuse to create anything the registry marks noncanonical, whatever else is true.
      if (noncanonical.has(r.authEmail)) {
        blockers.push({ code: "NONCANONICAL_IDENTITY", detail: `${r.authEmail} is a noncanonical fixture identity and must never be created` });
        steps.push({ step: 4, name: "CREATE_MISSING_ACCOUNT", result: "REFUSED", detail: "noncanonical identity" });
      } else {
        steps.push({
          step: 4,
          name: "CREATE_MISSING_ACCOUNT",
          result: "WOULD_CREATE",
          detail: `exactly one PASSWORDLESS account for ${r.authEmail}`,
        });
      }
    }

    // 5 -- the local credential. Delegated; never generated here.
    const hasCredential = credentials.has(r.authEmail.toLowerCase());
    steps.push({
      step: 5,
      name: "ENSURE_LOCAL_CREDENTIAL",
      result: hasCredential ? "PRESENT" : account ? "WOULD_DELEGATE" : "PENDING_ACCOUNT",
      detail: hasCredential
        ? "a credential already exists: PRESERVE, never rotate"
        : "delegate to activateMissingSandboxPasswords; this command generates no secret",
    });

    // 6 / 7 / 8 -- the governed chain. Not deployed yet, so reported rather than guessed.
    const principal = account ? (principals.get(account.uid) ?? null) : null;
    const governedStep = (step, name, have, detail) => {
      if (!governedAvailable) {
        steps.push({ step, name, result: "BLOCKED_PENDING_DEPLOY", detail: "the governed command is on this branch but not yet deployed" });
        return false;
      }
      steps.push({ step, name, result: have ? "PRESENT" : "WOULD_ENSURE", detail });
      return true;
    };
    const p6 = governedStep(6, "ENSURE_EOS_PRINCIPAL", Boolean(principal), principal ? `principal ${principal.principalId}` : "no Principal for this uid");
    const p7 = governedStep(7, "ENSURE_EMPLOYEE", Boolean(principal?.employeeId), principal?.employeeId ?? "no Employee link");
    const p8 = governedStep(8, "ENSURE_ONE_CANONICAL_JOB_ROLE", principal?.jobRole === r.jobRole, `expected ${r.jobRole}, observed ${principal?.jobRole ?? "none"}`);
    if (!p6 || !p7 || !p8) {
      blockers.push({ code: "GOVERNED_COMMANDS_NOT_DEPLOYED", detail: "steps 6-8 need createEmployee / Principal / assignEmployeeJobRole, which are not yet deployed" });
    } else if (principal && principal.jobRole && principal.jobRole !== r.jobRole) {
      blockers.push({ code: "JOB_ROLE_CONFLICT", detail: `uid holds Job Role '${principal.jobRole}', registry declares '${r.jobRole}'` });
    }

    // 9 -- Security Role, verified SEPARATELY and read-only. Never granted here.
    steps.push({
      step: 9,
      name: "VERIFY_SECURITY_ROLE_SEPARATELY",
      result: principal?.securityRoles ? "OBSERVED" : "NOT_OBSERVED",
      detail: principal?.securityRoles
        ? `holds ${[...principal.securityRoles].join("+")} -- reported, never granted by this command`
        : "no Security Role observation supplied; this command never grants one",
    });

    // 10 -- the verdict.
    const state = blockers.length === 0 ? STATES.READY : STATES.BLOCKED;
    steps.push({ step: 10, name: "VERDICT", result: state, detail: blockers.map((b) => b.code).join(",") || "all steps satisfied" });

    return {
      key: r.key,
      jobRole: r.jobRole,
      email: r.authEmail,
      registryUid: r.uid ?? null,
      observedUid: account?.uid ?? null,
      accountExists: Boolean(account),
      credentialPresent: hasCredential,
      wouldCreateAccount: !account && !noncanonical.has(r.authEmail),
      state,
      blockers,
      steps,
    };
  });

  const counts = {
    roles: rows.length,
    ready: rows.filter((r) => r.state === STATES.READY).length,
    blocked: rows.filter((r) => r.state === STATES.BLOCKED).length,
    accountsPresent: rows.filter((r) => r.accountExists).length,
    accountsToCreate: rows.filter((r) => r.wouldCreateAccount).length,
    credentialsPresentPreserve: rows.filter((r) => r.credentialPresent).length,
    credentialsToBootstrap: rows.filter((r) => r.accountExists && !r.credentialPresent).length,
    duplicateCanonicalIdentities: 0,
  };
  return { mode: "DRY_RUN", mutations: 0, counts, rows };
}

/**
 * COUNTS AND STATES ONLY. Addresses and uids are identifiers and safe to print, but a summary that
 * carries neither cannot leak whatever a future edit puts next to them.
 */
function formatPlan(result) {
  const c = result.counts;
  const lines = [
    `mode                      : ${result.mode}   (mutations: ${result.mutations})`,
    `canonical roles           : ${c.roles}`,
    `READY                     : ${c.ready}`,
    `BLOCKED                   : ${c.blocked}`,
    `accounts present (reuse)  : ${c.accountsPresent}`,
    `accounts to create        : ${c.accountsToCreate}`,
    `credentials to preserve   : ${c.credentialsPresentPreserve}`,
    `credentials to bootstrap  : ${c.credentialsToBootstrap}`,
    `duplicate identities      : ${c.duplicateCanonicalIdentities}`,
    "",
  ];
  for (const row of result.rows) {
    lines.push(`${row.state === STATES.READY ? "READY  " : "BLOCKED"}  ${row.key.padEnd(22)} ${row.jobRole.padEnd(32)} ${row.blockers.map((b) => b.code).join(",")}`);
  }
  return lines.join("\n");
}

module.exports = {
  plan,
  formatPlan,
  assertSandboxProject,
  canonicalRoles,
  noncanonicalIdentities,
  BootstrapRefusal,
  STATES,
  SANDBOX_PROJECT_ID,
  FORBIDDEN_PROJECT_IDS,
  FROZEN_PROJECT_IDS,
  SANDBOX_EMAIL_SUFFIX,
  CANONICAL_ROLE_IDENTITY_REGISTRY: REGISTRY,
};

// ============================ CLI ============================
//
// Read-only in this wave: there is no --apply, because steps 6-8 are not deployed and creating an
// account without them would leave an identity with no Principal, no Employee and no Job Role --
// which is the half-built state this command exists to prevent.
if (require.main === module) {
  const argv = process.argv.slice(2);
  const projectId = argv[argv.indexOf("--project") + 1];
  try {
    const env = assertSandboxProject(argv.includes("--project") ? projectId : undefined);
    console.log(`environment: ${env.id}`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  // NO LIVE LOOKUP IN THIS WAVE. An authoritative Auth lookup needs an operator credential and this
  // lane does not touch live nonprod, so the CLI seeds its observations from the registry's OWN
  // recorded facts -- which came from the Owner's authoritative Admin SDK enumeration on 2026-09-25.
  //
  // This is stated rather than glossed. A plan run with NO observations at all reports every account
  // as missing and therefore "16 to create", which is the most dangerous possible misreading of a
  // dry run: it looks like an instruction. Seeding from the registry makes the output mean what a
  // reader will assume it means, and `observationSource` says where it came from.
  const seeded = Object.fromEntries(
    canonicalRoles()
      .filter((r) => r.accountExists === true)
      .map((r) => [r.authEmail, { uid: r.uid }]),
  );
  const result = plan({ authAccountsByEmail: seeded });
  console.log("observationSource: REGISTRY_RECORDED_FACTS (Admin SDK enumeration 2026-09-25) -- NOT a live lookup in this wave");
  console.log(formatPlan(result));
  console.log("");
  console.log("DRY RUN. No account, credential, password, Principal, Employee or Job Role was created or modified.");
}
