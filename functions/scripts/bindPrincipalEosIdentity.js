// BINDING AN EOS IDENTITY TO AN EXISTING PRINCIPAL -- the operator entry point for the governed
// `bindPrincipalEosIdentity` command (src/adminPolicy/policyCommands.ts).
// docs/architecture/eos-identity-session-foundation.md, sections 3(c) and 6 (the provisioning packet).
//
// ============================ WHAT IT DOES AND DOES NOT DO ============================
//
//   ADDS       ONE eos_policy.principal_identities row (provider 'eos') naming an EXISTING Principal, one
//              audit event and one access-version bump -- all inside the governed command.
//   PRESERVES  the Principal id, its PRIMARY (Firebase) binding, its membership, Employee link, Security Role
//              assignments, Work Eligibility, Operational Scope and direct grants -- MEASURED before and after
//              (the same dimensions rebindPrincipalIdentity.js measures), because "identity only" is the whole
//              promise.
//   NEVER      creates a Principal, Employee, Role, assignment, capability or grant; never changes a status;
//              never touches Firestore or any identity provider; never creates, reads or prints a credential,
//              key or token.
//
// ============================ TWO MODES ============================
//
//   --persona <key>        one of the 16 governed nonprod persona keys. The Principal is found through the
//                          registry uid (config/sandboxRoleIdentityRegistry.json) as its PRIMARY Firebase
//                          subject -- used here only as a lookup key -- and the EOS subject is the pure
//                          derivation `nonprod-persona.<key>` the persona issuer mints for.
//   --principalId <id> --externalSubject <subject>
//                          any Principal. A `nonprod-persona.` subject is refused in this mode: persona
//                          subjects are reachable only through --persona.
//
// ============================ THE FENCES (same as rebindPrincipalIdentity.js) ============================
//
//   NAMED TARGET  --environment must match config/environments.json; production refused by role and project.
//   NONPROD       EOS_ENVIRONMENT must read exactly 'nonprod'.   CERTIFICATION refused (frozen).
//   AUTHORITY     the administering Principal's Roles are READ from PostgreSQL; no role/capability flag exists.
//   SELF          the administering Principal may not be the target.
//   DRY RUN       the default. --apply writes.
//
// Usage:
//   node scripts/bindPrincipalEosIdentity.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey <key> --adminPrincipalId <ADMIN> (--persona <key> | --principalId <P> --externalSubject <S>) \
//     --reason "<at least 40 chars naming the persona key or principal id>" [--apply]
//
// Exit 0 when clean (PLANNED, BOUND or NO_CHANGE); 2 when refused or when a preserved dimension moved.
"use strict";

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const { readAuthorityDimensions, PRESERVED_KEYS } = require("./rebindPrincipalIdentity.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const KNOWN_FLAGS = Object.freeze([
  "environment", "databaseUrlEnv", "tenantKey", "adminPrincipalId", "persona", "principalId",
  "externalSubject", "reason", "apply",
]);
const AUTHORITY_BEARING_FLAGS = Object.freeze([
  "heldRoleKeys", "heldRoles", "roleKeys", "roles", "role", "capabilities", "capability",
  "entitlements", "grant", "grants", "permissions",
]);
const CREDENTIAL_BEARING_FLAGS = Object.freeze([
  "password", "token", "idToken", "secret", "credential", "credentials", "privateKey", "signingKey",
  "key", "apiKey", "databaseUrl", "connectionString",
]);
const EOS_SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const PERSONA_PREFIX = "nonprod-persona.";
const MIN_REASON_LENGTH = 40;
const MAX_REASON_LENGTH = 500;

class EosIdentityBindError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EosIdentityBindError";
    this.code = code;
  }
}
const refuse = (code, message) => { throw new EosIdentityBindError(code, message); };

/** The registry's 16 persona keys and their uids. Keys and uids are identifiers, not credentials. */
function loadPersonaRegistry() {
  const raw = JSON.parse(readFileSync(join(__dirname, "..", "..", "config", "sandboxRoleIdentityRegistry.json"), "utf8"));
  return new Map((raw.roles || []).map((r) => [r.key, { uid: r.uid, expectedEmployeeId: r.expectedEmployeeId }]));
}

/** Refuse before anything that could contact anything is loaded. */
function assertInvocation(args, env) {
  for (const flag of Object.keys(args)) {
    if (KNOWN_FLAGS.includes(flag)) continue;
    if (AUTHORITY_BEARING_FLAGS.includes(flag)) {
      refuse("AUTHORITY_ARGUMENT_REFUSED", `--${flag} would SUPPLY authority; the administering Principal's Roles are read from PostgreSQL.`);
    }
    if (CREDENTIAL_BEARING_FLAGS.includes(flag)) {
      refuse("CREDENTIAL_ARGUMENT_REFUSED", `--${flag} would put a credential on a command line. This tool handles no credential, key or token.`);
    }
    refuse("UNKNOWN_FLAG_REFUSED", `--${flag} is not a flag this tool understands. Known flags: ${KNOWN_FLAGS.map((f) => `--${f}`).join(" ")}`);
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    refuse("ENVIRONMENT_FROZEN", `--environment '${environmentId}' is the frozen Certification world.`);
  }
  for (const flag of ["tenantKey", "adminPrincipalId", "reason"]) {
    if (typeof args[flag] !== "string" || args[flag].trim() === "" || args[flag] === "true") {
      refuse("ARGUMENT_REQUIRED", `--${flag} is required and has no default`);
    }
  }
  const personaMode = args.persona !== undefined;
  const directMode = !personaMode && (args.principalId !== undefined || args.externalSubject !== undefined);
  if (!personaMode && !directMode) {
    refuse("MODE_REQUIRED", "name EXACTLY one target: --persona <key>, or --principalId <id> with --externalSubject <subject>");
  }
  if (personaMode && (args.externalSubject !== undefined || args.principalId !== undefined)) {
    refuse("MODE_REQUIRED",
      "--persona derives BOTH the Principal (from the registry uid) and the subject; --principalId and --externalSubject are not accepted with it");
  }
  let persona = null;
  let principalId = null;
  let externalSubject = null;
  if (personaMode) {
    persona = String(args.persona).trim();
    const registry = loadPersonaRegistry();
    if (!registry.has(persona)) {
      refuse("UNKNOWN_PERSONA", `--persona '${persona}' is not one of the ${registry.size} governed persona keys`);
    }
    externalSubject = `${PERSONA_PREFIX}${persona}`;
  } else {
    for (const flag of ["principalId", "externalSubject"]) {
      if (typeof args[flag] !== "string" || args[flag].trim() === "" || args[flag] === "true") {
        refuse("ARGUMENT_REQUIRED", `--${flag} is required in direct mode`);
      }
    }
    principalId = args.principalId.trim();
    externalSubject = args.externalSubject.trim();
    if (externalSubject.startsWith(PERSONA_PREFIX)) {
      refuse("PERSONA_SUBJECT_REFUSED", "a nonprod-persona subject is bound only through --persona");
    }
  }
  if (!EOS_SUBJECT.test(externalSubject)) refuse("SUBJECT_MALFORMED", "the EOS subject is malformed");
  const reason = args.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) refuse("REASON_NOT_SPECIFIC", `--reason needs at least ${MIN_REASON_LENGTH} characters`);
  if (reason.length > MAX_REASON_LENGTH) refuse("REASON_TOO_LONG", `--reason may hold at most ${MAX_REASON_LENGTH} characters`);
  const namesTarget = persona ? reason.includes(persona) : reason.includes(principalId);
  if (!namesTarget) refuse("REASON_NOT_SPECIFIC", "--reason must NAME the persona key or the target principal id");
  return {
    environmentId, connectionString, tenantKey: args.tenantKey.trim(), adminPrincipalId: args.adminPrincipalId.trim(),
    persona, principalId, externalSubject, reason, apply: args.apply === "true",
  };
}

async function bindPrincipalEosIdentityRun(pool, options, deps) {
  const { PostgresPolicyRepository, bindPrincipalEosIdentity, hasAdministrationAuthority } = deps;
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
  if (!hasAdministrationAuthority(heldRoleKeys, "assignRole")) {
    refuse("ADMINISTRATOR_UNAUTHORIZED", "the administering Principal holds no active Role that may assign Roles");
  }

  let principalId = options.principalId;
  if (options.persona) {
    // FROM GOVERNED REGISTRY INFORMATION ALONE: the registry uid is the persona's PRIMARY (firebase) subject.
    const entry = (deps.personaRegistry ?? loadPersonaRegistry()).get(options.persona);
    if (!entry || typeof entry.uid !== "string" || entry.uid.length === 0) {
      refuse("PERSONA_UID_NOT_RECORDED", `the registry records no uid for persona '${options.persona}'; correct the registry -- this tool never guesses`);
    }
    const primary = await repo.getPrincipalBySubject("firebase", entry.uid);
    if (!primary) {
      refuse("PERSONA_PRINCIPAL_NOT_FOUND", `no Principal holds the registry uid of persona '${options.persona}'; this tool never creates one`);
    }
    principalId = primary.id;
  }
  if (principalId === admin.id) refuse("ADMIN_PRINCIPAL_SELF_BIND_REFUSED", "the administering Principal may not bind an identity to itself");

  const before = await readAuthorityDimensions(pool, tenantId, principalId);
  if (before.principalId === null) refuse("TARGET_PRINCIPAL_NOT_FOUND", `no Principal '${principalId}'`);
  const existing = await repo.getActiveIdentityBinding(principalId, "eos");
  const alreadyBound = Boolean(existing && existing.externalSubject === options.externalSubject);
  const countAudits = async () => Number((await pool.query(
    "SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE action = 'bindPrincipalEosIdentity' AND target_id = $1",
    [principalId])).rows[0].n);
  const auditsBefore = await countAudits();

  let outcome;
  if (!options.apply) {
    outcome = alreadyBound ? "NO_CHANGE" : "PLANNED";
  } else {
    await bindPrincipalEosIdentity(repo, { tenantId, uid: admin.id, heldRoleKeys }, {
      principalId, externalSubject: options.externalSubject, reason: options.reason,
    });
    outcome = alreadyBound ? "NO_CHANGE" : "BOUND";
  }
  const after = await readAuthorityDimensions(pool, tenantId, principalId);
  const auditsAfter = await countAudits();
  const binding = await repo.getActiveIdentityBinding(principalId, "eos");
  const preserved = {};
  for (const key of PRESERVED_KEYS) preserved[key] = JSON.stringify(before[key]) === JSON.stringify(after[key]);
  preserved.primaryIdentity = before.identityProvider === after.identityProvider && before.externalSubject === after.externalSubject;
  return {
    tool: "bindPrincipalEosIdentity",
    environment: options.environmentId,
    tenantKey: options.tenantKey,
    apply: options.apply,
    outcome,
    persona: options.persona,
    principalId,
    adminPrincipalId: admin.id,
    adminHeldRoleKeys: [...heldRoleKeys].sort(),
    externalSubject: options.externalSubject,
    activeEosBinding: binding ? { id: binding.id, externalSubject: binding.externalSubject, status: binding.status } : null,
    auditEvents: { before: auditsBefore, after: auditsAfter, appended: auditsAfter - auditsBefore },
    preserved,
  };
}

function violations(report) {
  const out = [];
  for (const [k, ok] of Object.entries(report.preserved)) if (!ok) out.push(`preserved dimension moved: ${k}`);
  const { appended } = report.auditEvents;
  if (!report.apply && appended !== 0) out.push("a dry run appended an audit event");
  if (report.outcome === "NO_CHANGE" && appended !== 0) out.push("a NO_CHANGE run appended an audit event");
  if (report.outcome === "BOUND" && appended !== 1) out.push(`a bind appended ${appended} audit events; exactly one is the contract`);
  return out;
}

async function main() {
  const options = assertInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const deps = {
    PostgresPolicyRepository: require("../lib/adminPolicy/postgresPolicyRepository.js").PostgresPolicyRepository,
    bindPrincipalEosIdentity: require("../lib/adminPolicy/policyCommands.js").bindPrincipalEosIdentity,
    hasAdministrationAuthority: require("../lib/adminPolicy/administrationAuthority.js").hasAdministrationAuthority,
  };
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const report = await bindPrincipalEosIdentityRun(pool, options, deps);
    console.log(JSON.stringify(report, null, 2));
    const broke = violations(report);
    if (broke.length > 0) console.error(JSON.stringify({ outcome: "TERMS_VIOLATED", violations: broke }, null, 2));
    process.exitCode = broke.length > 0 ? 2 : 0;
  } finally {
    await pool.end();
  }
}

module.exports = {
  assertInvocation, bindPrincipalEosIdentityRun, violations, loadPersonaRegistry,
  KNOWN_FLAGS, AUTHORITY_BEARING_FLAGS, CREDENTIAL_BEARING_FLAGS, PERSONA_PREFIX,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", message: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exitCode = 2;
  });
}
