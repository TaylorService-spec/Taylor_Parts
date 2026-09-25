/**
 * sandboxPersonaBootstrap -- the permanent reconciler for the canonical sandbox role registry.
 *
 * ============================ WHAT IT IS FOR ============================
 *
 * OWNER RULING 2026-09-25: ONE CANONICAL SANDBOX LOGIN PER CANONICAL JOB ROLE. This command is how
 * that stays true. It walks the sixteen canonical roles and reconciles the whole chain per role:
 *
 *     Credential -> Auth account -> EOS Principal -> Employee -> exactly one Job Role
 *
 * and reports a state per role. It replaces a pile of one-off persona scripts, each of which knew a
 * slightly different set of addresses.
 *
 * ============================ IT IS AN ORCHESTRATOR, NOT AN IMPLEMENTATION ============================
 *
 * `--apply` executes the SAME governed commands that are already implemented, tested and deployed:
 * `createJobRole`, `createEmployee`, `linkEmployeePrincipal`, `relinkEmployeePrincipal`,
 * `assignEmployeeJobRole`. They are INJECTED, never reimplemented.
 *
 * There is therefore NO raw SQL here, no repository call, no direct table write, no Principal write,
 * no Employee write, no link write, no Job Role write and no Security Role write of its own. A test
 * asserts that from source. The reason is not tidiness: a second write path is a second thing that
 * must enforce the same authority, and the first time the two disagree the symptom is a sandbox whose
 * access no longer matches the rules anybody wrote down.
 *
 * IT NEVER GRANTS A SECURITY ROLE. Step 9 VERIFIES the expected Security Role and reports a mismatch.
 * A command that could also grant authority is a command that can quietly widen access to make its
 * own report green, which makes the report worthless.
 *
 * ============================ STATES: WHAT IS MISSING, NOT WHY ============================
 *
 * The previous version collapsed every unsatisfied step into `GOVERNED_COMMANDS_NOT_DEPLOYED`. That
 * became a lie the moment the commands deployed -- and it was already misleading, because it guessed
 * a CAUSE ("not deployed") from an EFFECT ("step 8 is unsatisfied"), when the real cause was that
 * `eos_workforce.job_roles` held 0 rows. Worse, in the deployed case a role with no Principal at all
 * reported READY, because an unsatisfied step raised no blocker unless the commands were absent.
 *
 * So each step now names exactly what is missing. `financeAccounting` before reconciliation reads
 * PRINCIPAL_MISSING + EMPLOYEE_MISSING + JOB_ROLE_ASSIGNMENT_MISSING, and the deployment code appears
 * ONLY when the commands are genuinely absent.
 *
 * ============================ IDEMPOTENCE IS A HARD REQUIREMENT ============================
 *
 * Every operation is guarded by an observation, and the guard is what makes the operation exist at
 * all: `plan()` emits an operation ONLY for something it measured to be absent or wrong. So a plan
 * over a complete state contains zero operations, and `apply()` executes exactly the operations in
 * the plan. A second apply therefore performs zero database writes, zero Auth writes, zero credential
 * writes and produces zero audit delta -- not because anything de-duplicates afterwards, but because
 * there is nothing to execute. `assertIdempotent()` and its tests pin that.
 *
 * ============================ THE FENCE ============================
 *
 * Strictly `eos-platform-sandbox`. Production is refused BY NAME before the (editable) environment
 * registry is read, then again by registry role; the frozen Certification world and any unknown
 * project are refused too. `--apply` additionally re-asserts the fence immediately before executing,
 * so a caller cannot plan against the sandbox and apply somewhere else.
 *
 * NO FIREBASE BUSINESS AUTHORITY. No Firestore, no role documents, no permission documents, no
 * business custom claims. Firebase is transitional identity and session ONLY; EOS PostgreSQL is the
 * Employee, Role and capability authority.
 *
 * NO SECRETS. Every report carries addresses, uids, Job Roles, states and counts. A uid is an
 * identifier. A password is never read, generated, returned, logged or measured -- password
 * activation is delegated to the one implementation that owns it,
 * `activateMissingSandboxPasswords` in activateSandboxPersonas.js.
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

/**
 * THE ROLE STATES. `READY` is the only satisfied one; every other names ONE missing or wrong thing,
 * so a report says what to fix rather than what somebody guessed the cause was.
 */
const ROLE_STATES = Object.freeze({
  READY: "READY",
  GOVERNED_COMMANDS_UNAVAILABLE: "GOVERNED_COMMANDS_UNAVAILABLE",
  AUTH_ACCOUNT_MISSING: "AUTH_ACCOUNT_MISSING",
  CREDENTIAL_MISSING: "CREDENTIAL_MISSING",
  PRINCIPAL_MISSING: "PRINCIPAL_MISSING",
  EMPLOYEE_MISSING: "EMPLOYEE_MISSING",
  EMPLOYEE_PRINCIPAL_LINK_MISMATCH: "EMPLOYEE_PRINCIPAL_LINK_MISMATCH",
  JOB_ROLE_CATALOG_MISSING: "JOB_ROLE_CATALOG_MISSING",
  JOB_ROLE_ASSIGNMENT_MISSING: "JOB_ROLE_ASSIGNMENT_MISSING",
  SECURITY_ROLE_MISMATCH: "SECURITY_ROLE_MISMATCH",
  // Identity-integrity states. These are not "missing" -- they are DISAGREEMENTS, and the one thing
  // never to do with a disagreement about identity is pick a side automatically.
  AUTH_UID_MISMATCH: "AUTH_UID_MISMATCH",
  AUTH_ACCOUNT_DISABLED: "AUTH_ACCOUNT_DISABLED",
  NONCANONICAL_IDENTITY: "NONCANONICAL_IDENTITY",
  JOB_ROLE_CONFLICT: "JOB_ROLE_CONFLICT",
});

/** Kept for callers that read the old shape. READY/BLOCKED remains the coarse verdict. */
const STATES = Object.freeze({ READY: "READY", BLOCKED: "BLOCKED" });

/** The governed commands this orchestrator may call. Nothing else is permitted to write. */
const GOVERNED_COMMANDS = Object.freeze([
  "createJobRole",
  "createEmployee",
  "linkEmployeePrincipal",
  "relinkEmployeePrincipal",
  "assignEmployeeJobRole",
]);

class BootstrapRefusal extends Error {
  constructor(code, detail) {
    // Carries a code and a reason. Never a credential and never a file's contents.
    super(`${code}: ${detail}`);
    this.name = "BootstrapRefusal";
    this.code = code;
  }
}

// ============================ THE FENCE ============================

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

/**
 * The extra gate `--apply` must clear. Separate from `assertSandboxProject` on purpose: a dry run is
 * safe anywhere the fence allows, while a mutation additionally requires the caller to have said
 * `--apply` out loud AND the governed commands to actually be present. "I meant to dry-run" is the
 * most likely way this command ever does something unintended.
 */
function assertApplyAllowed(projectId, { commands, registryPath } = {}) {
  const env = assertSandboxProject(projectId, { registryPath });
  if (env.role !== "sandbox") {
    throw new BootstrapRefusal("APPLY_REQUIRES_SANDBOX_ROLE", `environment '${env.id}' has role '${env.role}'`);
  }
  const missing = GOVERNED_COMMANDS.filter((name) => typeof commands?.[name] !== "function");
  if (missing.length > 0) {
    throw new BootstrapRefusal(
      "GOVERNED_COMMANDS_UNAVAILABLE",
      `--apply orchestrates governed commands and implements none; missing: ${missing.join(", ")}`,
    );
  }
  return env;
}

// ============================ THE REGISTRY ============================

function canonicalRoles(registry = REGISTRY) {
  const roles = registry.roles ?? [];
  const byEmail = new Map();
  const byJobRole = new Map();
  for (const r of roles) {
    if (!r.key || !r.jobRole || !r.authEmail) {
      throw new BootstrapRefusal("REGISTRY_ENTRY_INCOMPLETE", "a role entry lacks key, jobRole or authEmail");
    }
    if (!r.authEmail.endsWith(SANDBOX_EMAIL_SUFFIX)) {
      throw new BootstrapRefusal("REGISTRY_EMAIL_REFUSED", `${r.key}: '${r.authEmail}' is not a ${SANDBOX_EMAIL_SUFFIX} address`);
    }
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

function noncanonicalIdentities(registry = REGISTRY) {
  return new Map((registry.noncanonical ?? []).map((n) => [n.email, n]));
}

/**
 * The canonical Job Role ids Phase 2 seeds, sourced from the vocabulary rather than listed here.
 * That is what structurally excludes a retired id and `field-trainer`: they are not canonical, so
 * there is no filter to forget.
 */
function canonicalJobRoleIds() {
  // Required lazily: lib/ is build output and may be absent in a source-only checkout, and the
  // operator fence suite runs with functions/lib deleted. A hoisted require would make this module
  // unloadable there, which is how a guard becomes green by never running.
  const vocabulary = require("../lib/eosWorkforce/jobRoleVocabulary.js");
  return [...vocabulary.CANONICAL_JOB_ROLE_IDS];
}

// ============================ OBSERVATION ============================

const asMap = (v) => (v instanceof Map ? v : new Map(Object.entries(v ?? {})));

/**
 * Collect LIVE evidence. Read-only: an authoritative Auth lookup per canonical address, the KEY NAMES
 * of the explicit credential source, and whatever PostgreSQL facts the caller supplies.
 *
 * WHY LIVE AND NOT RECORDED. The registry records what was measured once, which is the right thing to
 * pin a contract against and the wrong thing to reconcile from: a plan built on recorded facts reports
 * the state of a document rather than the state of the world, and the first time they differ it
 * proposes work that is already done or skips work that is not.
 *
 * `credentialKeyNames` is KEY NAMES ONLY. No value is read, compared, hashed or measured.
 */
async function collectObservations({ authDirectory, credentialSourcePath, jobRoleCatalog, principalsByUid, governedCommands } = {}) {
  const roles = canonicalRoles();
  const authAccountsByEmail = {};
  if (authDirectory) {
    if (typeof authDirectory.preflight === "function") await authDirectory.preflight();
    for (const r of roles) {
      const found = await authDirectory.findByEmail(r.authEmail);
      if (found) {
        authAccountsByEmail[r.authEmail] = {
          uid: found.uid,
          hasPassword: found.hasPassword ?? null,
          disabled: found.disabled ?? false,
        };
      }
    }
  }

  const credentialKeyNames = [];
  let credentialSource = null;
  if (credentialSourcePath) {
    credentialSource = { path: credentialSourcePath, present: false, entryCount: 0 };
    try {
      const raw = fs.readFileSync(credentialSourcePath, "utf8");
      credentialSource.present = true;
      // The canonical parser, so this cannot disagree with the loader about what an entry is. Only
      // Object.keys is taken; the values are never touched.
      const parsed = JSON.parse(raw.trim().startsWith("{") ? raw : `{${raw.trim().replace(/,\s*$/, "")}}`);
      for (const [email, value] of Object.entries(parsed)) {
        if (typeof email === "string" && typeof value === "string" && value) credentialKeyNames.push(email.trim().toLowerCase());
      }
      credentialSource.entryCount = credentialKeyNames.length;
    } catch (err) {
      credentialSource.failure = err.code ?? "UNPARSEABLE";
    }
  }

  return {
    observationSource: "LIVE",
    authAccountsByEmail,
    credentialKeyNames,
    credentialSource,
    jobRoleCatalog: jobRoleCatalog ?? null,
    principalsByUid: principalsByUid ?? {},
    governedCommands: governedCommands ?? {},
  };
}

// ============================ THE PLAN ============================

/**
 * THE PLAN. Pure over the observations it is handed: no lookup, no creation, no write. That is what
 * makes it safe to run anywhere, exhaustively testable, and the basis of idempotence -- an operation
 * exists in the plan only because something was MEASURED to be absent or wrong.
 */
function plan(observations = {}) {
  const roles = canonicalRoles();
  const noncanonical = noncanonicalIdentities();

  const accounts = asMap(observations.authAccountsByEmail);
  const principals = asMap(observations.principalsByUid);
  const credentials = new Set([...(observations.credentialKeyNames ?? [])].map((k) => String(k).toLowerCase()));
  const commands = observations.governedCommands ?? {};
  const missingCommands = GOVERNED_COMMANDS.filter((n) => typeof commands[n] !== "function");
  const governedAvailable = missingCommands.length === 0;

  // The Job Role catalog. `null` means NOT OBSERVED, which is different from observed-and-empty and
  // must not be reported as the same thing.
  const catalogObserved = observations.jobRoleCatalog != null;
  const catalog = new Set(observations.jobRoleCatalog ?? []);

  const operations = [];
  const op = (phase, command, input, because) => {
    operations.push({ phase, command, input, because });
    return operations[operations.length - 1];
  };

  // ---- PHASE 2 (global): the Job Role catalog. Emitted before any assignment depends on it.
  let catalogIds = [];
  try {
    catalogIds = canonicalJobRoleIds();
  } catch {
    // The vocabulary lives in build output. Absent, the catalog cannot be planned, and saying so is
    // better than planning an empty one.
    catalogIds = [];
  }
  const catalogMissingIds = catalogObserved ? catalogIds.filter((id) => !catalog.has(id)) : catalogIds;
  if (governedAvailable) {
    for (const id of catalogMissingIds) {
      op(2, "createJobRole", { jobRoleId: id }, `eos_workforce.job_roles is missing the canonical id '${id}'`);
    }
  }

  const rows = roles.map((r) => {
    const steps = [];
    const states = [];
    const note = (code, detail) => states.push({ code, detail });

    // 1 -- resolve the registry entry.
    steps.push({ step: 1, name: "RESOLVE_REGISTRY_ENTRY", result: "OK", detail: `${r.key} -> ${r.jobRole} (phase ${r.phase ?? 3})` });

    // 2 -- authoritative Auth lookup, by the registry's declared address and nothing else.
    const account = accounts.get(r.authEmail) ?? null;
    steps.push({
      step: 2,
      name: "AUTH_LOOKUP",
      result: account ? "FOUND" : "NOT_FOUND",
      detail: account ? `uid ${account.uid}` : `no account for ${r.authEmail}`,
    });

    if (account && r.uid && account.uid !== r.uid) {
      note(ROLE_STATES.AUTH_UID_MISMATCH, `${r.authEmail} resolves to uid ${account.uid}, the registry declares ${r.uid}. One is wrong and neither may be guessed.`);
    }
    if (account && account.disabled === true) {
      note(ROLE_STATES.AUTH_ACCOUNT_DISABLED, `${r.authEmail} exists but is disabled`);
    }

    // 3 / 4 -- reuse, or create only what is genuinely missing.
    if (account) {
      steps.push({ step: 3, name: "REUSE_EXISTING_ACCOUNT", result: "REUSED", detail: "never recreated, never reset" });
      steps.push({ step: 4, name: "CREATE_MISSING_ACCOUNT", result: "SKIPPED", detail: "an account exists; creating another would duplicate this Job Role's identity" });
    } else {
      steps.push({ step: 3, name: "REUSE_EXISTING_ACCOUNT", result: "NOT_APPLICABLE", detail: "no account to reuse" });
      if (noncanonical.has(r.authEmail)) {
        note(ROLE_STATES.NONCANONICAL_IDENTITY, `${r.authEmail} is a noncanonical fixture identity and must never be created`);
        steps.push({ step: 4, name: "CREATE_MISSING_ACCOUNT", result: "REFUSED", detail: "noncanonical identity" });
      } else {
        note(ROLE_STATES.AUTH_ACCOUNT_MISSING, `no Auth account for ${r.authEmail}`);
        steps.push({ step: 4, name: "CREATE_MISSING_ACCOUNT", result: "WOULD_CREATE", detail: `exactly one PASSWORDLESS account for ${r.authEmail}` });
        op(1, "createPasswordlessAuthAccount", { email: r.authEmail, role: r.key }, `no Auth account exists for ${r.authEmail}`);
      }
    }

    // 5 -- the local credential. Delegated; never generated here.
    const hasCredential = credentials.has(r.authEmail.toLowerCase());
    if (!hasCredential) {
      note(ROLE_STATES.CREDENTIAL_MISSING, `the explicit credential source holds no entry for ${r.authEmail}`);
    }
    steps.push({
      step: 5,
      name: "ENSURE_LOCAL_CREDENTIAL",
      result: hasCredential ? "PRESENT" : "MISSING",
      detail: hasCredential
        ? "a credential already exists: PRESERVE, never rotate"
        : "delegate to activateMissingSandboxPasswords; this command generates no secret and rotates nothing",
    });

    // 6 / 7 / 8 -- the governed chain. Each step names what is MISSING; the deployment code appears
    // only when the commands are genuinely absent.
    const principal = account ? (principals.get(account.uid) ?? null) : null;

    if (!governedAvailable) {
      note(ROLE_STATES.GOVERNED_COMMANDS_UNAVAILABLE, `missing: ${missingCommands.join(", ")}`);
    }

    // 6 -- Principal.
    const hasPrincipal = Boolean(principal?.principalId);
    if (!hasPrincipal) note(ROLE_STATES.PRINCIPAL_MISSING, account ? `no EOS Principal for uid ${account.uid}` : "no Auth account, so no Principal could be resolved");
    steps.push({
      step: 6,
      name: "ENSURE_EOS_PRINCIPAL",
      result: hasPrincipal ? "PRESENT" : "MISSING",
      detail: hasPrincipal ? `principal ${principal.principalId}` : "no Principal",
    });

    // 7 -- Employee, and the link between the two.
    const hasEmployee = Boolean(principal?.employeeId);
    if (!hasEmployee) note(ROLE_STATES.EMPLOYEE_MISSING, hasPrincipal ? `Principal ${principal.principalId} has no Employee link` : "no Principal, so no Employee link");
    if (hasEmployee && r.expectedEmployeeId && principal.employeeId !== r.expectedEmployeeId) {
      note(ROLE_STATES.EMPLOYEE_PRINCIPAL_LINK_MISMATCH, `linked to Employee '${principal.employeeId}', registry expects '${r.expectedEmployeeId}'`);
    }
    steps.push({
      step: 7,
      name: "ENSURE_EMPLOYEE",
      result: hasEmployee ? "PRESENT" : "MISSING",
      detail: principal?.employeeId ?? "no Employee link",
    });

    // 8 -- exactly ONE canonical Job Role. The catalog and the assignment are DIFFERENT failures and
    // are reported separately: seeding a catalog and assigning from it are different fixes.
    const catalogHasRole = catalogObserved ? catalog.has(r.jobRole) : false;
    if (!catalogHasRole) {
      note(ROLE_STATES.JOB_ROLE_CATALOG_MISSING, catalogObserved
        ? `eos_workforce.job_roles has no row for '${r.jobRole}'`
        : "the Job Role catalog was not observed, so its contents are unknown");
    }
    const assigned = principal?.jobRole ?? null;
    if (assigned && assigned !== r.jobRole) {
      note(ROLE_STATES.JOB_ROLE_CONFLICT, `holds Job Role '${assigned}', the registry declares '${r.jobRole}'`);
    } else if (!assigned) {
      note(ROLE_STATES.JOB_ROLE_ASSIGNMENT_MISSING, `no Job Role assignment for '${r.jobRole}'`);
    }
    steps.push({
      step: 8,
      name: "ENSURE_ONE_CANONICAL_JOB_ROLE",
      result: assigned === r.jobRole ? "PRESENT" : assigned ? "CONFLICT" : "MISSING",
      detail: `expected ${r.jobRole}, observed ${assigned ?? "none"}; catalog ${catalogObserved ? (catalogHasRole ? "has it" : "lacks it") : "not observed"}`,
    });

    // 9 -- Security Role, verified SEPARATELY and read-only. Never granted here.
    const held = principal?.securityRoles ? [...principal.securityRoles] : null;
    const expected = r.expectedSecurityRoles ?? null;
    const forbidden = r.forbiddenSecurityRoles ?? [];
    let securityResult = "NOT_DECLARED";
    if (expected !== null) {
      if (held === null) {
        securityResult = "NOT_OBSERVED";
      } else {
        const missingRoles = expected.filter((x) => !held.includes(x));
        const extraRoles = held.filter((x) => !expected.includes(x));
        const forbiddenHeld = held.filter((x) => forbidden.includes(x));
        if (missingRoles.length || extraRoles.length || forbiddenHeld.length) {
          securityResult = "MISMATCH";
          note(
            ROLE_STATES.SECURITY_ROLE_MISMATCH,
            `expected [${expected.join(",")}], holds [${held.join(",")}]` +
              (forbiddenHeld.length ? `; FORBIDDEN held: ${forbiddenHeld.join(",")}` : ""),
          );
        } else {
          securityResult = "MATCHES";
        }
      }
    }
    steps.push({
      step: 9,
      name: "VERIFY_SECURITY_ROLE_SEPARATELY",
      result: securityResult,
      detail: expected === null
        ? `no expectation declared; holds [${held ? held.join(",") : "not observed"}] -- reported, never granted by this command`
        : `expected [${expected.join(",")}], holds [${held ? held.join(",") : "not observed"}] -- reported, never granted by this command`,
    });

    // Governed operations for this role, each guarded by the observation that made it necessary.
    const phase = r.phase ?? 3;
    if (governedAvailable) {
      const employeeId = r.expectedEmployeeId ?? null;
      if (!hasEmployee && employeeId) {
        op(phase, "createEmployee", { employeeId, role: r.key }, `Employee '${employeeId}' does not exist`);
        if (hasPrincipal) {
          op(phase, "linkEmployeePrincipal", { employeeId, linkedPrincipalId: principal.principalId, role: r.key }, `Employee '${employeeId}' has no active Principal link`);
        }
      }
      if (hasEmployee && !assigned) {
        op(phase, "assignEmployeeJobRole", { employeeId: principal.employeeId, jobRoleId: r.jobRole, role: r.key }, `Employee '${principal.employeeId}' holds no '${r.jobRole}' assignment`);
      }
    }

    const blockers = states;
    const state = blockers.length === 0 ? ROLE_STATES.READY : blockers[0].code;
    steps.push({ step: 10, name: "VERDICT", result: state, detail: blockers.map((b) => b.code).join(",") || "all steps satisfied" });

    return {
      key: r.key,
      jobRole: r.jobRole,
      phase,
      email: r.authEmail,
      registryUid: r.uid ?? null,
      observedUid: account?.uid ?? null,
      accountExists: Boolean(account),
      authHasPassword: account?.hasPassword ?? null,
      credentialPresent: hasCredential,
      wouldCreateAccount: !account && !noncanonical.has(r.authEmail),
      state,
      verdict: blockers.length === 0 ? STATES.READY : STATES.BLOCKED,
      states: blockers.map((b) => b.code),
      blockers,
      steps,
    };
  });

  // ---- PHASE 3: the Owner / Admin split, planned only when it has not already happened.
  const split = REGISTRY.ownerAdminSplit ?? null;
  if (split && governedAvailable) {
    const linkedEmployees = new Set([...principals.values()].map((p) => p?.employeeId).filter(Boolean));
    const adminLinked = [...principals.entries()].find(([, p]) => p?.principalId === split.adminPrincipalId)?.[1] ?? null;
    if (!linkedEmployees.has(split.administratorEmployeeId)) {
      op(3, "createEmployee", { employeeId: split.administratorEmployeeId, reason: "OWNER_ADMIN_SPLIT" }, "the Administrator has no Employee of its own");
      op(3, "linkEmployeePrincipal", { employeeId: split.administratorEmployeeId, linkedPrincipalId: split.adminPrincipalId, reason: "OWNER_ADMIN_SPLIT" }, "the new Administrator Employee has no Principal link");
    }
    // The MOVE, with expected-current protection: refused if the link is not where we measured it,
    // so a stale observation becomes a refusal instead of a silent repoint onto the wrong Principal.
    if (adminLinked?.employeeId === split.ownerExecutiveEmployeeId) {
      op(
        3,
        "relinkEmployeePrincipal",
        {
          employeeId: split.ownerExecutiveEmployeeId,
          expectedCurrentPrincipalId: split.adminPrincipalId,
          newPrincipalId: split.ownerPrincipalId,
          reason: "OWNER_ADMIN_SPLIT",
        },
        "the Owner/Executive Employee is linked to the Admin Principal and must move to the Owner Principal",
      );
    }
  }

  operations.sort((a, b) => a.phase - b.phase);

  const counts = {
    roles: rows.length,
    ready: rows.filter((r) => r.state === ROLE_STATES.READY).length,
    blocked: rows.filter((r) => r.state !== ROLE_STATES.READY).length,
    accountsPresent: rows.filter((r) => r.accountExists).length,
    accountsToCreate: rows.filter((r) => r.wouldCreateAccount).length,
    credentialsPresentPreserve: rows.filter((r) => r.credentialPresent).length,
    credentialsMissing: rows.filter((r) => !r.credentialPresent).length,
    jobRoleCatalogMissing: catalogMissingIds.length,
    duplicateCanonicalIdentities: 0,
    operations: operations.length,
  };
  const byState = {};
  for (const row of rows) for (const s of row.states) byState[s] = (byState[s] ?? 0) + 1;

  return {
    mode: "DRY_RUN",
    mutations: 0,
    observationSource: observations.observationSource ?? "SUPPLIED",
    governedAvailable,
    missingCommands,
    counts,
    stateCounts: byState,
    operations,
    rows,
  };
}

// ============================ APPLY ============================

/**
 * Execute the plan's operations, in phase order, through the INJECTED governed commands.
 *
 * It contains no write of its own: every mutation is a call to a command that already owns that
 * write, already resolves its own authority and already emits its own audit event. Auth account
 * creation goes through the sandbox Auth directory's `createPasswordless`, which is the one place
 * this repository creates a sandbox account and which sets no password.
 *
 * IDEMPOTENT BY CONSTRUCTION. It executes exactly what `plan()` emitted, and `plan()` emits an
 * operation only for something it measured absent or wrong. Over a complete state the plan is empty
 * and this function performs nothing -- so a second apply is zero writes, not a de-duplicated replay.
 */
async function apply({ projectId, observations, commands, authDirectory, actor, pool, registryPath, confirm } = {}) {
  if (confirm !== true) {
    throw new BootstrapRefusal("APPLY_NOT_CONFIRMED", "apply requires confirm:true, so a dry run can never become a mutation by accident");
  }
  assertApplyAllowed(projectId, { commands, registryPath });

  const planned = plan({ ...observations, governedCommands: commands });
  const executed = [];
  const refusals = [];

  for (const operation of planned.operations) {
    try {
      if (operation.command === "createPasswordlessAuthAccount") {
        if (!authDirectory) throw new BootstrapRefusal("AUTH_DIRECTORY_REQUIRED", "creating an account needs the sandbox Auth directory");
        const created = await authDirectory.createPasswordless({ email: operation.input.email, displayName: `SANDBOX ROLE ${operation.input.role}` });
        executed.push({ ...operation, outcome: "CREATED", uid: created?.uid ?? null });
        continue;
      }
      // Every other operation is a governed command. Same signature the existing CLI uses, so there
      // is one calling convention and no second authority path.
      const result = await commands[operation.command]({ pool }, actor, operation.input);
      executed.push({ ...operation, outcome: result?.outcome ?? "APPLIED" });
    } catch (err) {
      refusals.push({ ...operation, refusal: err.code ?? err.name ?? "ERROR", message: String(err.message).slice(0, 300) });
    }
  }

  return {
    mode: "APPLY",
    projectId,
    plannedOperations: planned.operations.length,
    mutations: executed.length,
    executed,
    refusals,
    pass: refusals.length === 0,
  };
}

/**
 * The idempotence contract, checkable.
 *
 * A plan over the state that an apply leaves behind must contain ZERO operations. If it does not, the
 * second apply would write again -- which the Owner ruled a FAIL -- and this says so by name rather
 * than leaving it to be discovered by an audit diff.
 */
function assertIdempotent(planAfterApply) {
  const problems = [];
  if (planAfterApply.operations.length !== 0) {
    problems.push(`a second apply would execute ${planAfterApply.operations.length} operation(s): ${planAfterApply.operations.map((o) => o.command).join(", ")}`);
  }
  if (planAfterApply.mutations !== 0) problems.push(`the plan reports ${planAfterApply.mutations} mutations`);
  if (planAfterApply.counts.ready !== planAfterApply.counts.roles) {
    problems.push(`${planAfterApply.counts.blocked} role(s) are not READY after apply`);
  }
  return { idempotent: problems.length === 0, problems };
}

// ============================ REPORTING ============================

function formatPlan(result) {
  const c = result.counts;
  const lines = [
    `mode                      : ${result.mode}   (mutations: ${result.mutations})`,
    `observation source        : ${result.observationSource}`,
    `governed commands         : ${result.governedAvailable ? "AVAILABLE" : `UNAVAILABLE (${result.missingCommands.join(", ")})`}`,
    `canonical roles           : ${c.roles}`,
    `READY                     : ${c.ready}`,
    `not READY                 : ${c.blocked}`,
    `accounts present (reuse)  : ${c.accountsPresent}`,
    `accounts to create        : ${c.accountsToCreate}`,
    `credentials present       : ${c.credentialsPresentPreserve}`,
    `credentials missing       : ${c.credentialsMissing}`,
    `job role catalog missing  : ${c.jobRoleCatalogMissing}`,
    `planned operations        : ${c.operations}`,
    `duplicate identities      : ${c.duplicateCanonicalIdentities}`,
    "",
    "state counts:",
  ];
  for (const [state, n] of Object.entries(result.stateCounts).sort()) lines.push(`  ${String(n).padStart(3)}  ${state}`);
  lines.push("");
  for (const row of result.rows) {
    lines.push(`  phase ${row.phase}  ${row.key.padEnd(22)} ${row.jobRole.padEnd(32)} ${row.states.join(",") || "READY"}`);
  }
  if (result.operations.length > 0) {
    lines.push("", "planned operations, in phase order:");
    for (const o of result.operations) lines.push(`  phase ${o.phase}  ${o.command.padEnd(34)} ${o.because}`);
  }
  return lines.join("\n");
}

module.exports = {
  plan,
  apply,
  assertIdempotent,
  collectObservations,
  formatPlan,
  assertSandboxProject,
  assertApplyAllowed,
  canonicalRoles,
  canonicalJobRoleIds,
  noncanonicalIdentities,
  BootstrapRefusal,
  ROLE_STATES,
  STATES,
  GOVERNED_COMMANDS,
  SANDBOX_PROJECT_ID,
  FORBIDDEN_PROJECT_IDS,
  FROZEN_PROJECT_IDS,
  SANDBOX_EMAIL_SUFFIX,
  CANONICAL_ROLE_IDENTITY_REGISTRY: REGISTRY,
};

// ============================ CLI ============================
//
// DRY RUN IS THE DEFAULT and is the only mode this entry point offers. `--apply` is wired in code and
// exercised by tests, but executing it needs a resolved administration actor and a policy database
// pool, which belong to the operator runbook rather than to a convenience flag: an apply that is one
// keystroke from a dry run is an apply that happens by accident.
if (require.main === module) {
  const argv = process.argv.slice(2);
  const projectId = argv.includes("--project") ? argv[argv.indexOf("--project") + 1] : undefined;
  const credentialSourcePath = argv.includes("--credential-source") ? argv[argv.indexOf("--credential-source") + 1] : process.env.SANDBOX_CREDENTIALS_FILE;
  const live = argv.includes("--live");

  (async () => {
    let env;
    try {
      env = assertSandboxProject(projectId);
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    if (argv.includes("--apply")) {
      console.error("APPLY_NOT_AVAILABLE_FROM_CLI: --apply is orchestrated from the operator runbook, which supplies the governed commands, the administration actor and the policy pool. This entry point is read-only.");
      process.exitCode = 1;
      return;
    }
    console.log(`environment: ${env.id}`);

    let observations;
    if (live) {
      const { createFirebaseSandboxAuthDirectory } = require("./sampleCompany/sandboxAuthDirectory.js");
      observations = await collectObservations({
        authDirectory: createFirebaseSandboxAuthDirectory(projectId),
        credentialSourcePath,
      });
    } else {
      // Registry-recorded facts, stated as such. A plan with NO observations reports every account as
      // missing and therefore "16 to create", which is the most dangerous possible misreading of a
      // dry run: it looks like an instruction.
      observations = {
        observationSource: "REGISTRY_RECORDED_FACTS (not a live lookup; pass --live)",
        authAccountsByEmail: Object.fromEntries(canonicalRoles().filter((r) => r.accountExists === true).map((r) => [r.authEmail, { uid: r.uid }])),
      };
    }
    const result = plan(observations);
    console.log(formatPlan(result));
    if (observations.credentialSource) {
      const s = observations.credentialSource;
      console.log("");
      console.log(`credential source: ${s.present ? `PRESENT entries=${s.entryCount}` : `ABSENT/${s.failure ?? "not found"}`}  ${s.path}`);
    }
    console.log("");
    console.log("DRY RUN. No account, credential, password, Principal, Employee, Job Role or Security Role was created or modified.");
  })().catch((err) => {
    console.error("bootstrap failed:", err.message);
    process.exitCode = 1;
  });
}
