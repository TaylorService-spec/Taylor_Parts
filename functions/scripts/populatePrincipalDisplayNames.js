// POPULATING PRINCIPAL DISPLAY NAMES FROM VERIFIED IDENTITY DATA -- ACTOR-NAME-1 (Owner-approved 2026-10-17).
// docs/operations/eos-human-login-cutover-runbook.md, step 6.
//
// Who acted is shown by name wherever EOS shows an actor (resolvePrincipalDisplayNames), and that name is
// eos_policy.principals.display_name -- empty for most Principals, so authors rendered as "Unknown user".
//
// ============================ THE TWO SOURCES, AND NO THIRD ============================
//
//   --source firebaseProfile   the display name the identity provider holds on the Principal's own (firebase, uid)
//                              account: the provider's verified profile. Read with the Admin SDK, ONLY for the Firebase
//                              project config/environments.json registers for platform-sandbox. Needs the operator's
//                              short-lived token in EOS_FIREBASE_OPERATOR_ACCESS_TOKEN (the Render Shell holds no Google
//                              credential); this tool never stores or prints it.
//   --source enteredNames      names an administrator stated, for the 16 synthetic personas (which have no real profile):
//                              --namesFile is a JSON object { "<personaKey>": "<name>" }, keys closed on the registry.
//
//   NEVER inferred from an email address (a name containing '@' is refused by the command itself).
//   NEVER copied from the linked Employee (Owner ruling B: EOS does not expose the Employee link through a Principal name).
//   NEVER overwrites: a Principal that already has a name is reported ALREADY_NAMED and left alone.
//
// Every name goes in through the governed setPrincipalDisplayName command (assignment-shaped authority, one audit event with
// the source). It changes a label and nothing else: the actor id, subject, status, Roles and access version do not move, so
// audit attribution is unchanged -- earlier events simply render a name instead of "Unknown user".
//
// ============================ THE REPORT ============================
//
// Counts, and the UNRESOLVED list for correction: every Principal that stays unnamed, with the reason and its provider
// identity (principal id, provider, subject) -- never an email address and never an Employee name. stdout carries the names
// it planned or applied, because the operator is the one verifying them.
//
// ============================ THE FENCES ============================
//
//   NAMED TARGET  --environment must match config/environments.json; production refused by role and project.
//   NONPROD       EOS_ENVIRONMENT must read exactly 'nonprod' in this process.
//   AUTHORITY     the administering Principal's Roles are READ from PostgreSQL; no role/capability flag exists.
//   DRY RUN       the default. --apply writes.
//
// Usage:
//   node scripts/populatePrincipalDisplayNames.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey <key> --adminPrincipalId <ADMIN> --source firebaseProfile --reason "<at least 40 chars>" [--apply]
//   node scripts/populatePrincipalDisplayNames.js ... --source enteredNames --namesFile /path/names.json ...
"use strict";

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");

const KNOWN_FLAGS = Object.freeze(["environment", "databaseUrlEnv", "tenantKey", "adminPrincipalId", "source", "namesFile", "reason", "apply"]);
const AUTHORITY_BEARING_FLAGS = Object.freeze(["heldRoleKeys", "heldRoles", "roleKeys", "roles", "role", "capabilities", "capability", "grant", "grants", "permissions"]);
const CREDENTIAL_BEARING_FLAGS = Object.freeze(["password", "token", "idToken", "secret", "credential", "credentials", "privateKey", "serviceAccount", "key", "apiKey", "databaseUrl", "connectionString"]);
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const MIN_REASON_LENGTH = 40;
const MAX_REASON_LENGTH = 500;
const SOURCES = Object.freeze({ firebaseProfile: "IDENTITY_PROVIDER_PROFILE", enteredNames: "ADMINISTRATION_ENTERED" });

class DisplayNameError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "DisplayNameError";
    this.code = code;
  }
}
const refuse = (code, message) => { throw new DisplayNameError(code, message); };

function loadPersonaRegistry() {
  const raw = JSON.parse(readFileSync(join(__dirname, "..", "..", "config", "sandboxRoleIdentityRegistry.json"), "utf8"));
  return new Map((raw.roles || []).map((r) => [r.key, { uid: r.uid }]));
}

function assertInvocation(args, env) {
  for (const flag of Object.keys(args)) {
    if (KNOWN_FLAGS.includes(flag)) continue;
    if (AUTHORITY_BEARING_FLAGS.includes(flag)) refuse("AUTHORITY_ARGUMENT_REFUSED", `--${flag} would SUPPLY authority; the administering Principal's Roles are read from PostgreSQL.`);
    if (CREDENTIAL_BEARING_FLAGS.includes(flag)) refuse("CREDENTIAL_ARGUMENT_REFUSED", `--${flag} would put a credential on a command line. This tool handles none.`);
    refuse("UNKNOWN_FLAG_REFUSED", `--${flag} is not a flag this tool understands. Known flags: ${KNOWN_FLAGS.map((f) => `--${f}`).join(" ")}`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) refuse("ENVIRONMENT_FROZEN", `--environment '${environmentId}' is the frozen Certification world.`);
  for (const flag of ["tenantKey", "adminPrincipalId", "source", "reason"]) {
    if (typeof args[flag] !== "string" || args[flag].trim() === "" || args[flag] === "true") refuse("ARGUMENT_REQUIRED", `--${flag} is required and has no default`);
  }
  if (!Object.prototype.hasOwnProperty.call(SOURCES, args.source)) refuse("SOURCE_REFUSED", `--source must be one of: ${Object.keys(SOURCES).join(", ")}`);
  if (args.source === "enteredNames" && (typeof args.namesFile !== "string" || args.namesFile === "true")) refuse("ARGUMENT_REQUIRED", "--namesFile is required with --source enteredNames");
  if (args.source === "firebaseProfile" && args.namesFile !== undefined) refuse("ARGUMENT_REFUSED", "--namesFile belongs to --source enteredNames only");
  const reason = args.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) refuse("REASON_NOT_SPECIFIC", `--reason needs at least ${MIN_REASON_LENGTH} characters`);
  if (reason.length > MAX_REASON_LENGTH) refuse("REASON_TOO_LONG", `--reason may hold at most ${MAX_REASON_LENGTH} characters`);
  return {
    environmentId, connectionString, tenantKey: args.tenantKey.trim(), adminPrincipalId: args.adminPrincipalId.trim(),
    source: args.source, namesFile: args.namesFile ?? null, reason, apply: args.apply === "true",
  };
}

/**
 * THE PLAN, PURE. Given the tenant's Principals and a name-per-Principal answer, decide each Principal's outcome.
 * `candidateFor(principal)` returns { name } or { unresolvedReason }. `refusal(name)` is the command's own name rule.
 * No I/O here, so the dry run and the apply cannot disagree and the unit test needs no database.
 */
function planNames(principals, candidateFor, refusal) {
  const out = { planned: [], alreadyNamed: [], unresolved: [] };
  for (const p of principals) {
    if (typeof p.displayName === "string" && p.displayName.trim() !== "") { out.alreadyNamed.push({ principalId: p.id }); continue; }
    const c = candidateFor(p);
    if (!c || typeof c.name !== "string") {
      out.unresolved.push({ principalId: p.id, identityProvider: p.identityProvider, externalSubject: p.externalSubject, reason: c?.unresolvedReason ?? "NO_VERIFIED_NAME" });
      continue;
    }
    const name = c.name.trim();
    const why = refusal(name);
    if (why) { out.unresolved.push({ principalId: p.id, identityProvider: p.identityProvider, externalSubject: p.externalSubject, reason: "NAME_REJECTED", detail: why }); continue; }
    out.planned.push({ principalId: p.id, displayName: name });
  }
  return out;
}

/**
 * READ ONLY, and the SDK is loaded HERE and nowhere else, after every fence, only for --source firebaseProfile.
 *
 * It goes through the Sample Company's sandbox Auth adapter, which already holds the fence this needs: the project must be
 * EXACTLY the one config/environments.json registers for platform-sandbox (production, Certification and unknown projects
 * are refused), and the credential is the operator's short-lived token in EOS_FIREBASE_OPERATOR_ACCESS_TOKEN (or ADC where
 * it genuinely exists) -- never an argument, never persisted. Only `auth.getUsers` is called: no write method is touched.
 */
async function readFirebaseProfileNames(projectId, uids) {
  const { createFirebaseSandboxAuthDirectory } = require("./sampleCompany/sandboxAuthDirectory.js");
  const directory = createFirebaseSandboxAuthDirectory(projectId);
  await directory.preflight();
  const names = new Map();
  for (let i = 0; i < uids.length; i += 100) {
    const batch = uids.slice(i, i + 100);
    const res = await directory.auth.getUsers(batch.map((uid) => ({ uid })));
    for (const u of res.users) if (typeof u.displayName === "string" && u.displayName.trim() !== "") names.set(u.uid, u.displayName);
  }
  return names;
}

async function populateRun(pool, options, deps) {
  const { PostgresPolicyRepository, setPrincipalDisplayName, principalDisplayNameRefusal, hasAdministrationAuthority } = deps;
  const repo = new PostgresPolicyRepository(pool);
  const tenant = await repo.getTenantByKey(options.tenantKey);
  if (!tenant) refuse("TENANT_NOT_FOUND", `no tenant with key '${options.tenantKey}'`);
  const tenantId = tenant.id;

  const admin = await repo.getPrincipal(options.adminPrincipalId);
  const adminMembership = admin ? await repo.getMembership(tenantId, admin.id) : null;
  if (!admin || admin.status !== "active" || !adminMembership || adminMembership.status !== "active") {
    refuse("ADMINISTRATOR_INVALID", "--adminPrincipalId must name an active Principal with an active membership in this tenant");
  }
  const roles = await repo.listRoles(tenantId);
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const heldRoleKeys = (await repo.listAssignmentsForPrincipal(tenantId, admin.id))
    .filter((a) => a.status === "active").map((a) => roleKeyById.get(a.roleId)).filter(Boolean);
  if (!hasAdministrationAuthority(heldRoleKeys, "assignRole")) refuse("ADMINISTRATOR_UNAUTHORIZED", "the administering Principal holds no active Role that may assign Roles");

  const ids = await repo.listTenantPrincipalIds(tenantId);
  const principals = [];
  for (const id of ids) {
    const p = await repo.getPrincipal(id);
    const m = await repo.getMembership(tenantId, id);
    if (p && m && m.status === "active") principals.push(p);
  }

  let candidateFor;
  if (options.source === "enteredNames") {
    const entered = deps.enteredNames ?? JSON.parse(readFileSync(options.namesFile, "utf8"));
    const registry = deps.personaRegistry ?? loadPersonaRegistry();
    if (!entered || typeof entered !== "object" || Array.isArray(entered)) refuse("NAMES_FILE_INVALID", "--namesFile must be a JSON object { personaKey: name }");
    const byUid = new Map();
    for (const [key, value] of Object.entries(entered)) {
      if (!registry.has(key)) refuse("UNKNOWN_PERSONA", `--namesFile names '${key}', which is not one of the governed persona keys`);
      byUid.set(registry.get(key).uid, value);
    }
    candidateFor = (p) => (p.identityProvider === "firebase" && byUid.has(p.externalSubject)
      ? { name: byUid.get(p.externalSubject) } : { unresolvedReason: "NO_ENTERED_NAME" });
  } else {
    const env = (deps.loadEnvironments ?? (() => JSON.parse(readFileSync(join(__dirname, "..", "..", "config", "environments.json"), "utf8"))))();
    const projectId = env.environments.find((e) => e.id === options.environmentId)?.firebase?.projectId;
    if (typeof projectId !== "string") refuse("PROVIDER_PROJECT_UNKNOWN", `config/environments.json declares no identity-provider project for '${options.environmentId}'`);
    const uids = principals.filter((p) => p.identityProvider === "firebase" && !p.displayName).map((p) => p.externalSubject);
    const names = await (deps.readProfileNames ?? readFirebaseProfileNames)(projectId, uids);
    candidateFor = (p) => (p.identityProvider !== "firebase" ? { unresolvedReason: "NOT_A_PROVIDER_ACCOUNT" }
      : names.has(p.externalSubject) ? { name: names.get(p.externalSubject) } : { unresolvedReason: "PROVIDER_ACCOUNT_HAS_NO_PROFILE_NAME" });
  }

  const plan = planNames(principals, candidateFor, principalDisplayNameRefusal);
  const sourceTag = SOURCES[options.source];
  const applied = [];
  if (options.apply) {
    for (const item of plan.planned) {
      await setPrincipalDisplayName(repo, { tenantId, uid: admin.id, heldRoleKeys }, {
        principalId: item.principalId, displayName: item.displayName, source: sourceTag, reason: options.reason,
      });
      applied.push(item.principalId);
    }
  }
  return {
    tool: "populatePrincipalDisplayNames", environment: options.environmentId, tenantKey: options.tenantKey, apply: options.apply,
    source: sourceTag, adminPrincipalId: admin.id,
    counts: { principals: principals.length, alreadyNamed: plan.alreadyNamed.length, planned: plan.planned.length, applied: applied.length, unresolved: plan.unresolved.length },
    planned: plan.planned, unresolved: plan.unresolved,
  };
}

async function main() {
  const options = assertInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { setPrincipalDisplayName, principalDisplayNameRefusal } = require("../lib/adminPolicy/policyCommands.js");
  const deps = {
    PostgresPolicyRepository: require("../lib/adminPolicy/postgresPolicyRepository.js").PostgresPolicyRepository,
    setPrincipalDisplayName,
    principalDisplayNameRefusal,
    hasAdministrationAuthority: require("../lib/adminPolicy/administrationAuthority.js").hasAdministrationAuthority,
  };
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    console.log(JSON.stringify(await populateRun(pool, options, deps), null, 2));
  } finally {
    await pool.end();
  }
}

module.exports = { assertInvocation, planNames, populateRun, SOURCES, KNOWN_FLAGS };

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", message: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exitCode = 2;
  });
}
