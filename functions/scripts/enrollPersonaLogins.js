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
//     --tenantKey <key> --personas all --reason "<at least 40 chars naming the purpose>" \
//     [--credentialsOut /absolute/path/outside/repo.json --apply]
//
// Exit 0 when clean; 2 when refused or a persona failed (the run stops at the first failure when applying).
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
const KNOWN_FLAGS = Object.freeze(["environment", "databaseUrlEnv", "tenantKey", "personas", "reason", "operator", "credentialsOut", "apply"]);
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
  for (const flag of ["tenantKey", "personas", "reason", "operator"]) {
    if (typeof args[flag] !== "string" || args[flag].trim() === "" || args[flag] === "true") refuse("ARGUMENT_REQUIRED", `--${flag} is required and has no default`);
  }
  // WHO RAN IT is part of the audited reason. The label is a person's name or handle, appended to every enrollment's reason.
  const operator = args.operator.trim();
  if (!OPERATOR_LABEL.test(operator)) refuse("OPERATOR_REFUSED", "--operator must be 3-40 characters of letters, digits, space . _ @ - (a name or handle)");
  const reason = args.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) refuse("REASON_NOT_SPECIFIC", `--reason needs at least ${MIN_REASON_LENGTH} characters`);
  const registry = loadPersonaRegistry();
  // The recorded reason is `<reason> [<personaKey>] by <operator>`; its worst case must fit the audit limit with room to spare.
  const longestKey = Math.max(...[...registry.keys()].map((k) => k.length));
  if (reason.length + ` [${"x".repeat(longestKey)}] by ${operator}`.length > MAX_COMPOSED_REASON_LENGTH) {
    refuse("REASON_TOO_LONG", `--reason plus the persona key and operator suffix may hold at most ${MAX_COMPOSED_REASON_LENGTH} characters`);
  }
  const requested = args.personas.trim() === "all" ? [...registry.keys()] : args.personas.split(",").map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0) refuse("ARGUMENT_REQUIRED", "--personas names no persona");
  for (const key of requested) {
    if (!registry.has(key)) refuse("UNKNOWN_PERSONA", `--personas names '${key}', which is not one of the ${registry.size} governed persona keys`);
  }
  if (new Set(requested).size !== requested.length) refuse("DUPLICATE_PERSONA", "--personas names a persona twice");
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
  return { environmentId, connectionString, tenantKey: args.tenantKey.trim(), personas: requested, reason, operator, apply, credentialsOut };
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

async function enrollPersonaLoginsRun(pool, options, deps) {
  const { PostgresPolicyRepository, EosLoginService, credentialCrypto, nonprodPersonaSubject } = deps;
  const repo = new PostgresPolicyRepository(pool);
  const tenant = await repo.getTenantByKey(options.tenantKey);
  if (!tenant) refuse("TENANT_NOT_FOUND", `no tenant with key '${options.tenantKey}'`);
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

  const report = { tool: "enrollPersonaLogins", environment: options.environmentId, tenantKey: options.tenantKey, apply: options.apply, personas: plan };
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
      try {
        await service.enrollPersonaLogin({
          tenantId: tenant.id, personaKey: item.personaKey, principalId: item.principalId, loginIdentifier: item.loginIdentifier,
          password, totpSecret, recoveryCodes, reason: `${options.reason} [${item.personaKey}] by ${options.operator}`,
        });
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
  const deps = {
    PostgresPolicyRepository: require("../lib/adminPolicy/postgresPolicyRepository.js").PostgresPolicyRepository,
    EosLoginService: require("../lib/eosAuth/eosLoginService.js").EosLoginService,
    credentialCrypto: require("../lib/eosAuth/credentialCrypto.js"),
    nonprodPersonaSubject: require("../lib/eosAuth/nonprodPersonas.js").nonprodPersonaSubject,
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

module.exports = { assertInvocation, enrollPersonaLoginsRun, loadPersonaRegistry, newPassword, openCredentialsFile, KNOWN_FLAGS, CREDENTIAL_BEARING_FLAGS };

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ outcome: "REFUSED_OR_FAILED", message: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exitCode = 2;
  });
}
