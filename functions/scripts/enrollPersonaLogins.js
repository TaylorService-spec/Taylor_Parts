// ENROLLING THE 16 SYNTHETIC PERSONAS WITH AN EOS PASSWORD AND A SECOND FACTOR -- Firebase exit B2, Owner decision 2.
// docs/operations/eos-human-login-cutover-runbook.md, step 5.
//
// ============================ WHAT IT DOES AND DOES NOT DO ============================
//
//   ADDS       for each named persona: ONE login account bound to the persona's OWN existing EOS binding
//              (`nonprod-persona.<key>`), an scrypt password hash, an ACTIVE authenticator (TOTP) factor, ten recovery
//              codes (digests only), one audit event and one security event -- all in one transaction, through
//              EosLoginService.enrollPersonaLogin.
//   PRESERVES  the Principal id, its (firebase, uid) alias, Roles, scopes, membership, Employee link and the persona
//              binding itself (so the persona ISSUER keeps working as the machine path). Nothing about authority moves.
//   NEVER      resets or replaces: a persona that already has a live login account is SKIPPED, whatever the flags.
//              Never touches a real person: the Principal is found ONLY from the registry's persona uid and must hold the
//              persona's own binding. Never creates a Principal, Employee, Role or grant. Never prints a credential.
//
// ============================ WHERE THE CREDENTIALS GO ============================
//
// The password, authenticator secret and recovery codes are generated here (CSPRNG) and written ONLY to the file named by
// --credentialsOut: an ABSOLUTE path OUTSIDE this repository, created exclusively (never overwritten) with mode 0600, and
// written BEFORE each enrollment commits so a crash cannot leave an enrolled account whose credential nobody holds. The
// operator moves that file into the secure store and deletes it. stdout and stderr carry identifiers and outcomes only.
// There is no flag through which a credential can be passed in, and none to print one.
//
// ============================ THE FENCES (same as bindPrincipalEosIdentity.js) ============================
//
//   NAMED TARGET  --environment must match config/environments.json; production refused by role and project.
//   NONPROD       EOS_ENVIRONMENT must read exactly 'nonprod' in this process; the service refuses otherwise too.
//   KEYS          EOS_AUTH_FACTOR_KEYS and EOS_AUTH_FACTOR_KEY_ID must be present (they seal the authenticator secret); the
//                 signing key is NOT needed -- no token is minted.
//   DRY RUN       the default. --apply writes.
//
// Usage:
//   node scripts/enrollPersonaLogins.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey <key> --personas all --reason "<at least 40 chars naming the purpose>" --operator "<name or handle>" \
//     [--credentialsOut /absolute/path/outside/repo.json --apply]
//
// ============================ EMPLOYEE MODE (--employees) -- Firebase exit B2-x ============================
//
// Owner direction 2026-10-18: every nonprod employee who is not Inactive can sign in to EOS. `--employees <id,...|all-missing>`
// (instead of --personas, and with --adminPrincipalId) does for the scaled SAMPLE workforce (`np-taylor-*`) and the SYNTHETIC
// workforce (`synthetic-np-emp-*`) what the persona mode does for the 16 personas, through EosLoginService.enrollEmployeeLogin.
// The same fences apply (named nonprod target, dry run default, no credential flag, credentials file outside the repository,
// created exclusively with mode 0600 and written before each commit, never reset or replaced), and in addition:
//
//   WHO          only ids prefixed `np-taylor-` or `synthetic-np-emp-`; `all-missing` is every such Employee in the tenant that is
//                eligible and has no login. A real person's Employee id never has either prefix.
//   LOGIN NAME   the Employee's own `work_email`; refused when missing, malformed, or not a reserved `*.invalid` address.
//   STATUS       ACTIVE, CONTRACTOR and ON_LEAVE only. INACTIVE, TERMINATED and RETIRED, and any Employee with a separation date,
//                are REFUSED when named and SKIPPED_EXCLUDED under all-missing. ON_LEAVE enrolls but cannot sign in until the
//                Employee is ACTIVE (the DQ-007 gate is not widened); the dry run marks it.
//   IDENTITY     a Principal that already holds an active EOS identity (a persona binding, or a human one) is never displaced:
//                REFUSED when named, SKIPPED_EXCLUDED under all-missing. A live login account is always SKIPPED_EXISTS.
//                A RETIRED login (for the Principal or the login name) is never silently re-created (LOGIN_RETIRED), and an Owner
//                or Administrator Principal is never enrolled (PRINCIPAL_IS_OWNER_OR_ADMINISTRATOR): both REFUSED when named,
//                SKIPPED_EXCLUDED under all-missing -- the dry run shows exactly what the apply would do.
//   NO PRINCIPAL a `synthetic-np-emp-*` Employee with no Principal gets one through the EXISTING governed path, never new SQL:
//                `ensureTenantPrincipal` (provider `eos-synthetic-nonprod`, subject `synthetic-np-principal-<slug>`, ACTIVE
//                membership, no Security Role, no display name -- names come only from populatePrincipalDisplayNames.js) and
//                `establishLink` (OPERATOR_ASSERTED, asserted by --adminPrincipalId with the composed reason), exactly as the
//                synthetic workforce seed does. The administering Principal's Roles are READ from PostgreSQL and must be able to
//                assign Roles: it is resolved as a request would be (qualifying assignments only) and must hold
//                `admin.roleAssignment.write`, the gate ensureTenantPrincipal applies. An `np-taylor-*` Employee with no Principal is
//                REFUSED (the sample seed owns those). The sign-in rides a human EOS identity (`user.<hex>`) created in the
//                enrollment transaction. The Principal, the link and the enrollment are SEPARATE commits, each idempotent, so a
//                failure part-way leaves a state the next run resumes from (it never strands a login or a credential).
//
//   node scripts/enrollPersonaLogins.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey <key> \
//     --employees all-missing --adminPrincipalId <administrator principal id> --reason "<at least 40 chars>" \
//     --operator "<name or handle>" [--credentialsOut /absolute/path/outside/repo.json --apply]
//
// Exit 0 when clean; 2 when refused or a persona/employee failed (the run stops at the first failure when applying).
"use strict";

const { readFileSync, openSync, writeSync, closeSync, fsyncSync, ftruncateSync, realpathSync } = require("node:fs");
const { isAbsolute, join, relative, resolve, dirname, basename } = require("node:path");
const { generateKeyPairSync, randomBytes } = require("node:crypto");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIN_REASON_LENGTH = 40;
const MAX_COMPOSED_REASON_LENGTH = 470;
const OPERATOR_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._@-]{2,39}$/;
const KNOWN_FLAGS = Object.freeze(["environment", "databaseUrlEnv", "tenantKey", "personas", "employees", "adminPrincipalId", "reason", "operator", "credentialsOut", "apply"]);
// Employee mode. Pinned equal to the service's own ENROLLABLE_* exports by test/eosVerifierSwitch.test.mjs; the service re-checks both.
const EMPLOYEE_ID_PREFIXES = Object.freeze(["np-taylor-", "synthetic-np-emp-"]);
const ENROLLABLE_STATUSES = Object.freeze(["ACTIVE", "CONTRACTOR", "ON_LEAVE"]);
const EMPLOYEE_ID_SHAPE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SYNTHETIC_IDENTITY_PROVIDER = "eos-synthetic-nonprod";
const SYNTHETIC_PRINCIPAL_PREFIX = "synthetic-np-principal-";
const SYNTHETIC_EMPLOYEE_PREFIX = "synthetic-np-emp-";
const LONGEST_EMPLOYEE_ID = 63;
const CREDENTIAL_BEARING_FLAGS = Object.freeze([
  "password", "token", "secret", "credential", "credentials", "totp", "totpSecret", "recoveryCode", "recoveryCodes",
  "key", "factorKey", "factorKeys", "apiKey", "databaseUrl", "connectionString", "signingKey",
]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

class PersonaEnrollError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PersonaEnrollError";
    this.code = code;
  }
}
const refuse = (code, message) => { throw new PersonaEnrollError(code, message); };

/** The registry's 16 persona keys with their primary (Firebase) uid and sign-in address. Identifiers, not credentials. */
function loadPersonaRegistry() {
  const raw = JSON.parse(readFileSync(join(__dirname, "..", "..", "config", "sandboxRoleIdentityRegistry.json"), "utf8"));
  return new Map((raw.roles || []).map((r) => [r.key, { uid: r.uid, authEmail: r.authEmail }]));
}

/** Refuse before anything that could contact anything is loaded. */
function assertInvocation(args, env) {
  for (const flag of Object.keys(args)) {
    if (KNOWN_FLAGS.includes(flag)) continue;
    if (CREDENTIAL_BEARING_FLAGS.includes(flag)) {
      refuse("CREDENTIAL_ARGUMENT_REFUSED", `--${flag} would put a credential on a command line. This tool generates its own and accepts none.`);
    }
    refuse("UNKNOWN_FLAG_REFUSED", `--${flag} is not a flag this tool understands. Known flags: ${KNOWN_FLAGS.map((f) => `--${f}`).join(" ")}`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) refuse("ENVIRONMENT_FROZEN", `--environment '${environmentId}' is the frozen Certification world.`);
  for (const flag of ["tenantKey", "reason", "operator"]) {
    if (typeof args[flag] !== "string" || args[flag].trim() === "" || args[flag] === "true") refuse("ARGUMENT_REQUIRED", `--${flag} is required and has no default`);
  }
  if ((args.personas === undefined) === (args.employees === undefined)) {
    refuse("MODE_REQUIRED", "name EXACTLY one target set: --personas <keys|all> or --employees <ids|all-missing>");
  }
  const employeeMode = args.employees !== undefined;
  const modeFlag = employeeMode ? "employees" : "personas";
  if (typeof args[modeFlag] !== "string" || args[modeFlag].trim() === "" || args[modeFlag] === "true") refuse("ARGUMENT_REQUIRED", `--${modeFlag} is required and has no default`);
  if (employeeMode) {
    if (typeof args.adminPrincipalId !== "string" || args.adminPrincipalId.trim() === "" || args.adminPrincipalId === "true") {
      refuse("ARGUMENT_REQUIRED", "--adminPrincipalId is required with --employees: the administering Principal whose Roles (read from PostgreSQL) admit a Principal and assert a link");
    }
  } else if (args.adminPrincipalId !== undefined) {
    refuse("ARGUMENT_REFUSED", "--adminPrincipalId belongs to --employees; persona mode creates no Principal and asserts no link");
  }
  // WHO RAN IT is part of the audited reason. The label is a person's name or handle, appended to every enrollment's reason.
  const operator = args.operator.trim();
  if (!OPERATOR_LABEL.test(operator)) refuse("OPERATOR_REFUSED", "--operator must be 3-40 characters of letters, digits, space . _ @ - (a name or handle)");
  const reason = args.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) refuse("REASON_NOT_SPECIFIC", `--reason needs at least ${MIN_REASON_LENGTH} characters`);
  const registry = employeeMode ? null : loadPersonaRegistry();
  // The recorded reason is `<reason> [<personaKey|employeeId>] by <operator>`; its worst case must fit the audit limit with room to spare.
  const longestKey = employeeMode ? LONGEST_EMPLOYEE_ID : Math.max(...[...registry.keys()].map((k) => k.length));
  if (reason.length + ` [${"x".repeat(longestKey)}] by ${operator}`.length > MAX_COMPOSED_REASON_LENGTH) {
    refuse("REASON_TOO_LONG", `--reason plus the ${employeeMode ? "Employee id" : "persona key"} and operator suffix may hold at most ${MAX_COMPOSED_REASON_LENGTH} characters`);
  }
  let requested = [];
  let employees = null;
  if (employeeMode) {
    employees = args.employees.trim() === "all-missing" ? "all-missing" : args.employees.split(",").map((s) => s.trim()).filter(Boolean);
    if (employees !== "all-missing") {
      if (employees.length === 0) refuse("ARGUMENT_REQUIRED", "--employees names no Employee");
      for (const id of employees) {
        if (!EMPLOYEE_ID_SHAPE.test(id) || !EMPLOYEE_ID_PREFIXES.some((p) => id.startsWith(p))) {
          refuse("EMPLOYEE_ID_REFUSED", `--employees names '${id}'; only ids prefixed ${EMPLOYEE_ID_PREFIXES.map((p) => `'${p}'`).join(" or ")} (the nonprod sample and synthetic workforces) are accepted`);
        }
      }
      if (new Set(employees).size !== employees.length) refuse("DUPLICATE_EMPLOYEE", "--employees names an Employee twice");
    }
  } else {
    requested = args.personas.trim() === "all" ? [...registry.keys()] : args.personas.split(",").map((s) => s.trim()).filter(Boolean);
    if (requested.length === 0) refuse("ARGUMENT_REQUIRED", "--personas names no persona");
    for (const key of requested) {
      if (!registry.has(key)) refuse("UNKNOWN_PERSONA", `--personas names '${key}', which is not one of the ${registry.size} governed persona keys`);
    }
    if (new Set(requested).size !== requested.length) refuse("DUPLICATE_PERSONA", "--personas names a persona twice");
  }
  const apply = args.apply === "true";
  let credentialsOut = null;
  if (apply) {
    if (typeof args.credentialsOut !== "string" || args.credentialsOut === "true") refuse("ARGUMENT_REQUIRED", "--credentialsOut is required with --apply: where the generated credentials are written");
    if (!isAbsolute(args.credentialsOut)) refuse("CREDENTIALS_PATH_REFUSED", "--credentialsOut must be an absolute path");
    // SYMLINK-SAFE: the check is made on the REAL parent directory. A symlinked directory outside the repository that points
    // back inside it (or the reverse) cannot smuggle the file into the working tree.
    let realParent;
    try {
      realParent = realpathSync(dirname(resolve(args.credentialsOut)));
    } catch {
      refuse("CREDENTIALS_PATH_REFUSED", "the parent directory of --credentialsOut must already exist");
    }
    credentialsOut = join(realParent, basename(args.credentialsOut));
    const rel = relative(realpathSync(REPO_ROOT), credentialsOut);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      refuse("CREDENTIALS_PATH_REFUSED", "--credentialsOut is inside this repository; credentials never go in the working tree (a commit would carry them)");
    }
    if (!env.EOS_AUTH_FACTOR_KEYS || !env.EOS_AUTH_FACTOR_KEY_ID) {
      refuse("FACTOR_KEY_MISSING", "EOS_AUTH_FACTOR_KEYS and EOS_AUTH_FACTOR_KEY_ID must be set in this process: they seal the authenticator secret");
    }
  } else if (args.credentialsOut !== undefined) {
    refuse("CREDENTIALS_PATH_REFUSED", "--credentialsOut is accepted only with --apply (a dry run generates no credential)");
  }
  return {
    environmentId, connectionString, tenantKey: args.tenantKey.trim(), personas: requested, employees,
    adminPrincipalId: employeeMode ? args.adminPrincipalId.trim() : null, reason, operator, apply, credentialsOut,
  };
}

/** A password that passes the policy by construction: 24 random bytes, base64url, 32 characters. */
const newPassword = () => randomBytes(24).toString("base64url");

/** The credentials file: opened exclusively, 0600, rewritten whole and fsynced after every change. */
function openCredentialsFile(path) {
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (err) {
    if (err && err.code === "EEXIST") refuse("CREDENTIALS_PATH_REFUSED", "--credentialsOut already exists; this tool never overwrites a credentials file");
    throw err;
  }
  const entries = [];
  const flush = () => {
    ftruncateSync(fd, 0);
    writeSync(fd, `${JSON.stringify({ schema: "eos.persona-login-credentials/1", entries }, null, 2)}\n`, 0);
    fsyncSync(fd);
  };
  return {
    add(entry) { entries.push(entry); flush(); },
    update(personaKey, patch) { Object.assign(entries.find((e) => e.personaKey === personaKey), patch); flush(); },
    close() { closeSync(fd); },
  };
}

/** Persona mode, read only: one plan item per persona key, exactly as before employee mode existed. */
async function planPersonas(pool, repo, options, deps) {
  const { nonprodPersonaSubject } = deps;
  const registry = deps.personaRegistry ?? loadPersonaRegistry();

  // Resolve every persona FIRST (read only), so a dry run and an apply see the same plan and nothing is half-resolved.
  const plan = [];
  for (const personaKey of options.personas) {
    const entry = registry.get(personaKey);
    const item = { personaKey, loginIdentifier: null, principalId: null, outcome: "PLANNED", reason: null };
    plan.push(item);
    if (!entry || typeof entry.uid !== "string" || entry.uid.length === 0 || typeof entry.authEmail !== "string") {
      Object.assign(item, { outcome: "REFUSED", reason: "PERSONA_REGISTRY_INCOMPLETE" });
      continue;
    }
    item.loginIdentifier = entry.authEmail.trim().toLowerCase();
    // FROM GOVERNED REGISTRY INFORMATION ALONE: the registry uid is the persona's PRIMARY (firebase) subject.
    const primary = await repo.getPrincipalBySubject("firebase", entry.uid);
    if (!primary) { Object.assign(item, { outcome: "REFUSED", reason: "PERSONA_PRINCIPAL_NOT_FOUND" }); continue; }
    item.principalId = primary.id;
    const binding = await repo.getActiveIdentityBinding(primary.id, "eos");
    if (!binding || binding.externalSubject !== nonprodPersonaSubject(personaKey)) {
      Object.assign(item, { outcome: "REFUSED", reason: "PERSONA_BINDING_NOT_HELD" });
      continue;
    }
    const { rows } = await pool.query(
      "SELECT status FROM eos_policy.login_accounts WHERE principal_id = $1 AND status <> 'retired'", [primary.id]);
    if (rows.length > 0) Object.assign(item, { outcome: "SKIPPED_EXISTS", reason: `login account is ${rows[0].status}; never reset or replaced` });
  }
  return plan;
}

/**
 * The administering Principal for employee mode, resolved EXACTLY as a request would be: principal resolution (membership,
 * tenant status, the Employee gate, and only QUALIFYING global assignments -- active, not future-dated, not stale), then the
 * capability gate `ensureTenantPrincipal` itself applies (`admin.roleAssignment.write`). The role keys returned are the ones
 * handed to `ensureTenantPrincipal`, so the dry run refuses everything the apply would. A role NAME alone (a General Manager)
 * is not authority.
 */
async function resolveEmployeeAdministrator(repo, tenantId, adminPrincipalId, deps) {
  let ctx;
  try {
    ctx = await deps.runWithRequestScope(() => deps.resolvePrincipalContextById(repo, adminPrincipalId, tenantId));
  } catch (err) {
    if (err instanceof deps.PrincipalContextError) refuse("ADMINISTRATOR_INVALID", `--adminPrincipalId does not resolve to an active, eligible member of this tenant (${err.refusal ?? "refused"})`);
    throw err;
  }
  const capabilities = await deps.capabilityKeysFor(repo, tenantId, ctx.heldRoleKeys, null);
  if (!deps.hasSecurityAdministrationCapability(capabilities, "assignRole")) {
    refuse("ADMINISTRATOR_UNAUTHORIZED", "the administering Principal holds no qualifying Role that grants assigning Roles (admin.roleAssignment.write)");
  }
  return { id: ctx.uid, heldRoleKeys: [...ctx.heldRoleKeys] };
}

/**
 * Employee mode, read only. One plan item per Employee, keyed `personaKey` = the Employee id so the credentials file and the
 * apply loop are the persona mode's own. See the EMPLOYEE MODE header for every rule applied here.
 */
async function planEmployees(pool, repo, tenant, options, deps) {
  const { links, normalizeLoginIdentifier } = deps;
  const all = options.employees === "all-missing";
  const { rows: employeeRows } = all
    ? await pool.query(
      `SELECT id, employment_status::text AS status, operating_company_id, work_email, separation_date
         FROM eos_workforce.employees WHERE tenant_id = $1 AND id LIKE ANY ($2::text[]) ORDER BY id`,
      [tenant.id, EMPLOYEE_ID_PREFIXES.map((p) => `${p}%`)])
    : await pool.query(
      `SELECT id, employment_status::text AS status, operating_company_id, work_email, separation_date
         FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY ($2::text[]) ORDER BY id`,
      [tenant.id, options.employees]);
  const byId = new Map(employeeRows.map((e) => [e.id, e]));
  const ids = all ? employeeRows.map((e) => e.id) : options.employees;

  const plan = [];
  for (const employeeId of ids) {
    const e = byId.get(employeeId);
    const item = {
      personaKey: employeeId, employeeId, employmentStatus: e ? e.status : null, loginIdentifier: null, principalId: null,
      createPrincipal: false, principalSubject: null, linkNeeded: false, operatingCompanyId: e ? e.operating_company_id : null,
      outcome: "PLANNED", reason: null,
    };
    plan.push(item);
    // A named Employee that breaks a rule is REFUSED; under all-missing the same Employee is simply not a target.
    const exclude = (code) => Object.assign(item, { outcome: all ? "SKIPPED_EXCLUDED" : "REFUSED", reason: code });
    const refuseItem = (code) => Object.assign(item, { outcome: "REFUSED", reason: code });
    if (!e) { refuseItem("EMPLOYEE_NOT_FOUND"); continue; }
    if (!ENROLLABLE_STATUSES.includes(e.status) || e.separation_date != null) { exclude("EMPLOYEE_STATUS_EXCLUDED"); continue; }
    if (e.status === "ON_LEAVE") item.signInNote = "enrolled, but sign-in is refused until the Employee is ACTIVE or CONTRACTOR (DQ-007)";

    // ---- the Principal: the Employee's own active link, else (synthetic ids only) the derived synthetic Principal, else create.
    const link = await links.readActiveLinkForEmployee(pool, tenant.id, employeeId);
    let principal = null;
    if (link) {
      principal = await repo.getPrincipal(link.principalId);
      if (!principal) { refuseItem("PRINCIPAL_NOT_FOUND"); continue; }
    } else if (employeeId.startsWith(SYNTHETIC_EMPLOYEE_PREFIX)) {
      item.principalSubject = `${SYNTHETIC_PRINCIPAL_PREFIX}${employeeId.slice(SYNTHETIC_EMPLOYEE_PREFIX.length)}`;
      principal = await repo.getPrincipalBySubject(SYNTHETIC_IDENTITY_PROVIDER, item.principalSubject);
      if (principal && await links.readActiveLinkForPrincipal(pool, tenant.id, principal.id)) { refuseItem("SYNTHETIC_PRINCIPAL_LINKED_ELSEWHERE"); continue; }
      item.createPrincipal = principal === null;
      item.linkNeeded = true;
    } else {
      refuseItem("SAMPLE_EMPLOYEE_HAS_NO_PRINCIPAL");
      continue;
    }
    if (principal) {
      item.principalId = principal.id;
      const membership = await repo.getMembership(tenant.id, principal.id);
      if (principal.status !== "active" || !membership || membership.status !== "active") { refuseItem("PRINCIPAL_NOT_ACTIVE"); continue; }
      const accounts = (await pool.query("SELECT status FROM eos_policy.login_accounts WHERE principal_id = $1", [principal.id])).rows;
      const live = accounts.find((a) => a.status !== "retired");
      if (live) {
        Object.assign(item, { outcome: "SKIPPED_EXISTS", reason: `login account is ${live.status}; never reset or replaced`, createPrincipal: false, linkNeeded: false });
        continue;
      }
      // A login somebody retired on purpose is not silently re-created.
      if (accounts.length > 0) { exclude("LOGIN_RETIRED"); continue; }
      if (await repo.getActiveIdentityBinding(principal.id, "eos")) { exclude("PRINCIPAL_HOLDS_EOS_IDENTITY"); continue; }
      // The Owner and Administrator Principals are real people's; the service refuses them, so the plan shows it up front.
      const protectedRole = await pool.query(
        `SELECT 1 FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id = a.role_id
          WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'active' AND r.protected AND r.key = ANY ($3::text[]) LIMIT 1`,
        [tenant.id, principal.id, deps.protectedRoleKeys]);
      if (protectedRole.rows.length > 0) { exclude("PRINCIPAL_IS_OWNER_OR_ADMINISTRATOR"); continue; }
    }

    // ---- the login name: the Employee's own reserved address.
    const email = typeof e.work_email === "string" ? e.work_email.trim().toLowerCase() : "";
    if (email === "") { refuseItem("EMPLOYEE_EMAIL_MISSING"); continue; }
    if (normalizeLoginIdentifier(email) === null) { refuseItem("EMPLOYEE_EMAIL_MALFORMED"); continue; }
    if (!email.endsWith(".invalid")) { refuseItem("EMPLOYEE_EMAIL_NOT_RESERVED_INVALID"); continue; }
    item.loginIdentifier = email;
    const taken = (await pool.query("SELECT status FROM eos_policy.login_accounts WHERE login_identifier = $1", [email])).rows;
    if (taken.some((a) => a.status !== "retired")) refuseItem("LOGIN_IDENTIFIER_IN_USE");
    else if (taken.length > 0) exclude("LOGIN_RETIRED");
  }
  // Two Employees may not share a login name: the second apply would fail halfway through the run.
  const seen = new Map();
  for (const item of plan) {
    if (item.outcome !== "PLANNED") continue;
    (seen.get(item.loginIdentifier) ?? seen.set(item.loginIdentifier, []).get(item.loginIdentifier)).push(item);
  }
  for (const group of seen.values()) if (group.length > 1) for (const item of group) Object.assign(item, { outcome: "REFUSED", reason: "LOGIN_IDENTIFIER_DUPLICATED" });
  return plan;
}

async function enrollPersonaLoginsRun(pool, options, deps) {
  const { PostgresPolicyRepository, EosLoginService, credentialCrypto } = deps;
  const repo = new PostgresPolicyRepository(pool);
  const tenant = await repo.getTenantByKey(options.tenantKey);
  if (!tenant) refuse("TENANT_NOT_FOUND", `no tenant with key '${options.tenantKey}'`);
  const employeeMode = options.employees !== null && options.employees !== undefined;
  const admin = employeeMode ? await resolveEmployeeAdministrator(repo, tenant.id, options.adminPrincipalId, deps) : null;
  const plan = employeeMode ? await planEmployees(pool, repo, tenant, options, deps) : await planPersonas(pool, repo, options, deps);

  const report = { tool: "enrollPersonaLogins", mode: employeeMode ? "employees" : "personas", environment: options.environmentId, tenantKey: options.tenantKey, apply: options.apply, personas: plan };
  const refused = plan.filter((p) => p.outcome === "REFUSED");
  if (!options.apply || refused.length > 0) {
    report.outcome = refused.length > 0 ? "REFUSED" : "PLANNED";
    return report;
  }

  const keyring = credentialCrypto.parseFactorKeyring(process.env.EOS_AUTH_FACTOR_KEYS, process.env.EOS_AUTH_FACTOR_KEY_ID.trim());
  // A throwaway signer: the service requires one to be constructed, but this tool mints no token. It is never exported.
  const signer = { kid: "nonprod-enrollment-tool", privateKey: generateKeyPairSync("ed25519").privateKey };
  const service = new EosLoginService({
    pool, repo, signer, issuer: "enrollment-tool", audience: "enrollment-tool", environment: "nonprod", factorKeyring: keyring,
  });
  const file = openCredentialsFile(options.credentialsOut);
  try {
    for (const item of plan) {
      if (item.outcome !== "PLANNED") continue;
      const password = newPassword();
      const totpSecret = credentialCrypto.newTotpSecret();
      const recoveryCodes = credentialCrypto.newRecoveryCodes();
      // WRITE-AHEAD: the credential is on disk before the account can exist.
      file.add({
        personaKey: item.personaKey, state: "pending", loginIdentifier: item.loginIdentifier, password,
        totpSecretBase32: credentialCrypto.base32Encode(totpSecret), recoveryCodes,
      });
      const composedReason = `${options.reason} [${item.personaKey}] by ${options.operator}`;
      try {
        if (employeeMode) {
          // Resumable, each step governed and idempotent: a Principal that exists is found by its subject, a link that exists is
          // not re-asserted, and a failure after either leaves a state the next plan resolves (it never strands a login).
          let principalId = item.principalId;
          if (item.createPrincipal) {
            const created = await deps.ensureTenantPrincipal(repo, {
              tenantId: tenant.id, externalSubject: item.principalSubject, identityProvider: SYNTHETIC_IDENTITY_PROVIDER, displayName: null,
              actorUid: admin.id, actorRoleKeys: admin.heldRoleKeys, reason: composedReason,
            });
            principalId = created.id;
          }
          if (item.linkNeeded) {
            await deps.links.establishLink(pool, {
              tenantId: tenant.id, principalId, employeeId: item.employeeId, operatingCompanyId: item.operatingCompanyId,
              linkSource: "OPERATOR_ASSERTED", assertedBy: admin.id, assertionReason: composedReason,
            });
          }
          await service.enrollEmployeeLogin({
            tenantId: tenant.id, employeeId: item.employeeId, principalId, loginIdentifier: item.loginIdentifier,
            password, totpSecret, recoveryCodes, reason: composedReason, assertedBy: admin.id,
          });
        } else {
          await service.enrollPersonaLogin({
            tenantId: tenant.id, personaKey: item.personaKey, principalId: item.principalId, loginIdentifier: item.loginIdentifier,
            password, totpSecret, recoveryCodes, reason: composedReason,
          });
        }
      } catch (err) {
        file.update(item.personaKey, { state: "not-enrolled" });
        item.outcome = "FAILED";
        item.reason = err && err.code ? String(err.code) : "ERROR";
        report.outcome = "FAILED";
        return report;
      }
      file.update(item.personaKey, { state: "enrolled" });
      item.outcome = "ENROLLED";
    }
  } finally {
    file.close();
  }
  report.outcome = "ENROLLED";
  return report;
}

async function main() {
  const options = assertInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const administrationAuthority = require("../lib/adminPolicy/administrationAuthority.js");
  const principalContext = require("../lib/adminPolicy/principalContext.js");
  const deps = {
    PostgresPolicyRepository: require("../lib/adminPolicy/postgresPolicyRepository.js").PostgresPolicyRepository,
    EosLoginService: require("../lib/eosAuth/eosLoginService.js").EosLoginService,
    credentialCrypto: require("../lib/eosAuth/credentialCrypto.js"),
    nonprodPersonaSubject: require("../lib/eosAuth/nonprodPersonas.js").nonprodPersonaSubject,
    // Employee mode: the governed Principal and link writers the synthetic workforce seed uses, and the login-name normalizer.
    ensureTenantPrincipal: require("../lib/adminPolicy/tenantBootstrap.js").ensureTenantPrincipal,
    hasSecurityAdministrationCapability: administrationAuthority.hasSecurityAdministrationCapability,
    protectedRoleKeys: [administrationAuthority.PROTECTED_OWNER_ROLE_KEY, administrationAuthority.ADMIN_ROLE_KEY],
    capabilityKeysFor: require("../lib/adminPolicy/administrationCapabilityGate.js").capabilityKeysFor,
    resolvePrincipalContextById: principalContext.resolvePrincipalContextById,
    PrincipalContextError: principalContext.PrincipalContextError,
    runWithRequestScope: require("../lib/eosAuth/requestTenantBinding.js").runWithRequestScope,
    links: require("../lib/employeeIdentity/employeePrincipalLinkRepository.js"),
    normalizeLoginIdentifier: require("../lib/eosAuth/eosLoginService.js").normalizeLoginIdentifier,
  };
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const report = await enrollPersonaLoginsRun(pool, options, deps);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.outcome === "PLANNED" || report.outcome === "ENROLLED" ? 0 : 2;
  } finally {
    await pool.end();
  }
}

module.exports = {
  assertInvocation, enrollPersonaLoginsRun, loadPersonaRegistry, newPassword, openCredentialsFile, KNOWN_FLAGS, CREDENTIAL_BEARING_FLAGS,
  EMPLOYEE_ID_PREFIXES, ENROLLABLE_STATUSES,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", message: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exitCode = 2;
  });
}
