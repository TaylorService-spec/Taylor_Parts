/**
 * THE canonical sandbox credential loader. One registry, one source, read only.
 *
 * ============================ ONE LOGIN PER CANONICAL JOB ROLE ============================
 *
 * OWNER RULING 2026-09-25. The sandbox is permanently simplified: a credential is keyed to a JOB
 * ROLE, never to an incidental fixture person. There is exactly ONE chain per role --
 *
 *     Credential -> Auth account -> EOS Principal -> Employee -> Job Role
 *
 * -- and exactly sixteen of them. Security Roles remain SEPARATE from Job Roles: this file names an
 * identity and the Job Role it serves, and says nothing about what that identity may do. What it may
 * do is read from PostgreSQL at request time.
 *
 * WHY THE PREVIOUS SHAPE HAD TO GO. The catalog used to be keyed to whichever fixture person
 * happened to hold a role -- `technicianAssigned` and `technicianUnassigned`, `retailSales` and
 * `retailSalesB`, a `dispatcher` key pointing at one account while its comment quoted another
 * account's uid. Keying on people meant every new acceptance scenario invented a new login, and two
 * logins for one role is two things to keep in step. It produced, in one file: a key resolving to an
 * account no Principal stood behind, a second technician nobody could tell apart from the first, and
 * a "restricted" control that measured the absence of a Principal rather than the absence of
 * authority.
 *
 * ASSIGNED-VS-UNASSIGNED IS BUSINESS DATA, NOT IDENTITY. There is ONE `serviceTechnician`. Scenario A
 * assigns a Work Order to that technician and proves own-record access; Scenario B does not and
 * proves the denial. The ASSIGNMENT changes; the identity does not. That is why the second
 * technician account is retained as history and is NOT required by this loader.
 *
 * ============================ ONE EXPLICIT CREDENTIAL SOURCE ============================
 *
 * `SANDBOX_CREDENTIALS_FILE` is THE source. Unset is a configuration error
 * (`CREDENTIAL_SOURCE_NOT_CONFIGURED`), never an invitation to go looking.
 *
 * The old loader guessed: five candidate paths, first match wins. Two of them were built from
 * `os.homedir()` + `Favorites/Downloads` and `Downloads` -- WINDOWS shell folders -- while the
 * loader runs under WSL, where `os.homedir()` is the LINUX home. So it searched
 * `/home/<user>/Favorites/Downloads/` (which never existed), found a 70-byte stub earlier in the
 * list, and stopped. MEASURED: 1 entry reachable, 81 entries sitting off-path in the operator's real
 * file. That did not surface as "your file is elsewhere". It surfaced as an empty catalog, which
 * reads as "these personas have no passwords" -- and the remedy that suggests itself is to MINT new
 * ones, which would have reset live accounts and invalidated every saved copy.
 *
 * Guessing cannot be primary resolution any more. `candidatePaths()` survives for DIAGNOSTICS only
 * (`describeCredentialSources()`), is never consulted by `loadSandboxPersona`, and is marked so.
 *
 * ============================ THE STANDING CONTRACT ============================
 *
 *   - READ ONLY. This module never writes, regenerates, normalizes, reorders, rotates, encodes or
 *     copies the credential file. There is no write path here and there must never be one.
 *   - ONE filename: sandbox-credentials.local.json. Never falls back to sandbox.txt or any other
 *     list -- a stale fallback is worse than a failure, because it fails as "invalid password" and
 *     sends you debugging the wrong thing.
 *   - NEVER echo. Callers pass the returned password straight into fill() and never read it back.
 *     Nothing here logs, and errors never carry the value.
 *   - On failure: CREDENTIAL_ACCESS_FAILED, with the role key, the source and the failure type --
 *     never the file contents.
 *   - Auth personas are NOT business fixture data. Resetting a scenario must never touch a persona
 *     account. See functions/scripts/activateSandboxPersonas.js.
 *   - A ROLE KEY NAMES AN IDENTITY THAT EXISTS. A key resolving to an account no live Principal is
 *     behind is a DEFECT, not a stale alias. The one role whose account does not exist yet is
 *     declared PENDING_ACCOUNT and fails closed with the reason and the operator action -- it is
 *     never pointed at a substitute, and no account is created to make a key resolve.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_FILENAME = "sandbox-credentials.local.json";

/** The env var that names the credential file. The ONLY primary resolution path. */
export const CREDENTIAL_SOURCE_ENV = "SANDBOX_CREDENTIALS_FILE";

/**
 * ============================ THE CANONICAL ROLE REGISTRY ============================
 *
 * Sixteen keys, one per canonical Job Role, in catalog order. Every `uid` below was confirmed by an
 * authoritative Firebase Admin SDK lookup against `eos-platform-sandbox` on 2026-09-25: fifteen
 * accounts exist and exactly one (`reporting@`) does not.
 *
 * A uid is recorded because it is an IDENTIFIER, not a credential: it proves which account a key
 * names without revealing anything that can be signed in with. It is also the only way to catch the
 * defect that keeps recurring here -- a key whose address and whose uid belong to different
 * accounts.
 */
const REGISTRY_PATH = path.resolve(HERE, "..", "config", "sandboxRoleIdentityRegistry.json");

/**
 * THE REGISTRY, loaded from config/sandboxRoleIdentityRegistry.json.
 *
 * The data lives in JSON and not in this file for one reason: seedSampleCompany.js is CommonJS and
 * cannot import this ESM module, so the only alternative was a second copy of sixteen addresses in
 * the seed. Two copies drift, and the symptom of drift here is an account created for an identity
 * that already has one. JSON is the one shape both module systems read, so there is exactly one
 * authority and no code carries an address literal.
 */
const REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));

/** Sixteen keys, one per canonical Job Role, in catalog order. */
export const CANONICAL_ROLE_KEYS = Object.freeze(REGISTRY.roles.map((r) => r.key));

/**
 * role key -> { jobRole, email, uid, accountExists, reason?, operatorAction?, sampleCompanyEmployee }.
 *
 * `jobRole` is the canonical Job Role this login serves. It is NOT a Security Role and must never be
 * read as one: the Service Manager persona holds the `fieldManager` Security Role, and the two
 * vocabularies are allowed to differ.
 */
export const CANONICAL_ROLE_REGISTRY = Object.freeze(
  Object.fromEntries(
    REGISTRY.roles.map((r) => [
      r.key,
      Object.freeze({
        jobRole: r.jobRole,
        email: r.authEmail,
        uid: r.uid ?? null,
        accountExists: r.accountExists === true,
        sampleCompanyEmployee: r.sampleCompanyEmployee ?? null,
        reason: r.reason,
        operatorAction: r.operatorAction,
      }),
    ]),
  ),
);

/**
 * ============================ NONCANONICAL FIXTURE IDENTITIES ============================
 *
 * Accounts that EXIST (or were declared) and are deliberately NOT part of the canonical registry.
 *
 * RETAINED, NOT DELETED. The Owner ruled stale accounts stay until a separate cleanup wave
 * authorizes deletion. They must not appear in the canonical catalog, must not be required for
 * browser acceptance, must not receive duplicate EOS Principals, and must not drive role or security
 * decisions.
 *
 * Several of them remain an Employee's `workEmail`, and that is correct and left alone: a work email
 * is business contact data, not an authentication identity. That distinction is the whole basis of
 * the consolidation, and conflating the two is what produced a catalog pointing at accounts nothing
 * stood behind.
 */
export const NONCANONICAL_FIXTURE_IDENTITIES = Object.freeze(
  Object.fromEntries(
    REGISTRY.noncanonical.map((n) => [
      n.email,
      Object.freeze({
        classification: "NONCANONICAL_FIXTURE_IDENTITY",
        supersededBy: n.supersededBy ?? null,
        role: n.role ?? null,
        uid: n.uid ?? null,
        sampleCompanyEmployee: n.sampleCompanyEmployee ?? null,
        reason: n.reason,
      }),
    ]),
  ),
);

/** The credential-email invariant and its narrowly authorized exception, as declared data. */
export const CREDENTIAL_EMAIL_INVARIANT = Object.freeze(REGISTRY.credentialEmailInvariant);

/**
 * Keys retired by the consolidation. Retained ONLY so that asking still produces an explanation
 * rather than a bare UNKNOWN_ROLE, because these are the spellings existing callers actually use.
 */
export const RETIRED_PERSONAS = Object.freeze({
  technicianUnassigned: Object.freeze({
    reason:
      "RETIRED_BY_CONSOLIDATION: one Job Role, one login. There is a single `serviceTechnician`, and assigned-vs-unassigned is produced by BUSINESS DATA -- Scenario A assigns a Work Order to that technician and proves own-record access, Scenario B does not and proves the denial. Two logins encoded a record assignment in identity, where it does not belong.",
    operatorAction:
      "Use `serviceTechnician` and control the Work Order assignment in the scenario. gray.fixture@sandbox.invalid is retained as NONCANONICAL_FIXTURE_IDENTITY and is not deleted.",
  }),
  retailSalesB: Object.freeze({
    reason:
      "RETIRED_BY_CONSOLIDATION: a second retail-sales login for one Job Role. A different book of business is business data, not a separate identity.",
    operatorAction: "Use `retailSales`. indigo.fixture@sandbox.invalid is retained and not deleted.",
  }),
  contractTechnician: Object.freeze({
    reason:
      "RETIRED_BY_CONSOLIDATION: a second service-technician login whose purpose was employment_status CONTRACTOR -- an Employee attribute, not a reason for another credential.",
    operatorAction: "Use `serviceTechnician` and set employment status on the Employee record. oakley.fixture@sandbox.invalid is retained and not deleted.",
  }),
  operationsManager: Object.freeze({
    reason:
      "NO_LIVE_HOLDER: the operationsManager Role holds zero active assignments in nonprod, and opsmgr@sandbox.invalid has no EOS Principal. No canonical Job Role corresponds to it.",
    operatorAction:
      "If an operations persona is wanted, declare the Job Role first. Do NOT quietly repoint this key at officeManager -- a different Role is a different authority.",
  }),
  salesManager: Object.freeze({
    reason:
      "NO_LIVE_HOLDER: the salesManager Role holds zero active assignments, and salesmgr@sandbox.invalid has no EOS Principal. Every live sales login holds `salesperson`, not `salesManager`.",
    operatorAction:
      "Use `retailSales` or `nationalAccountsSales`. A sales MANAGER persona needs a declared Job Role and a governed Role assignment.",
  }),
  accountingManager: Object.freeze({
    reason:
      "NO_LIVE_HOLDER as a KEY: the accountingManager Security Role holds zero active assignments. Note the ADDRESS acctmgr@sandbox.invalid IS reused -- as the canonical `financeAccounting` login. An address and a role key are different things.",
    operatorAction: "Use `financeAccounting`.",
  }),
});

/**
 * DELIBERATELY EMPTY, and kept rather than deleted.
 *
 * Every former member was resolved by the ruling: financeAccounting and generalEmployee name
 * EXISTING accounts, and reportingAnalyst has a settled address with its account pending. An empty
 * map is a stronger statement than a missing one -- it says the state was emptied, not forgotten,
 * and it remains the right home for a role whose identity nobody has settled.
 *
 * NOTE what this does NOT claim. Every canonical key now has a settled ADDRESS. It does not say
 * every role has its authority: the finance and reporting Roles still hold few or no live grants.
 */
export const UNRECONCILED_PERSONAS = Object.freeze({});

/**
 * Backward-compatible aliases. Each legacy spelling resolves to the canonical ROLE key for the
 * identity it was always meant to name. An alias may only ever point at a canonical key and never
 * carry an address of its own -- an address is how a collision hides.
 */
export const PERSONA_ALIASES = Object.freeze({
  // Pre-consolidation canonical spellings.
  owner: "ownerExecutive",
  admin: "administrator",
  reporting: "reportingAnalyst",
  restricted: "generalEmployee",
  // The technician collapse. Both former keys, and both spelling conveniences, now name the ONE
  // technician. `technicianUnassigned` and `serviceTechnicianB` are deliberately NOT aliased --
  // they are answered by RETIRED_PERSONAS, because silently handing back the assigned technician
  // would make a test that means "the unassigned one" pass for the wrong reason.
  technician: "serviceTechnician",
  technicianAssigned: "serviceTechnician",
  serviceTechnicianA: "serviceTechnician",
  // Named after the Security Role rather than the person; the Service Manager holds `fieldManager`.
  fieldManager: "serviceManager",
  // Every live sales login holds `salesperson`, so the bare key was ambiguous. Resolves to the
  // primary retail contributor; a caller that means the national accounts book must say so.
  salesperson: "retailSales",
});

/**
 * role key -> login address, for the fifteen roles whose account EXISTS.
 *
 * `reportingAnalyst` is deliberately absent: its address is declared in the registry but its account
 * is not created, and this map is the set of keys that can actually be loaded. It is answered by
 * name in `loadSandboxPersona`.
 */
export const SANDBOX_PERSONAS = Object.freeze(
  Object.fromEntries(
    CANONICAL_ROLE_KEYS.filter((k) => CANONICAL_ROLE_REGISTRY[k].accountExists).map((k) => [k, CANONICAL_ROLE_REGISTRY[k].email]),
  ),
);

/** Canonical role keys whose address is settled but whose account does not exist yet. */
export const PENDING_ACCOUNT_PERSONAS = Object.freeze(
  Object.fromEntries(
    CANONICAL_ROLE_KEYS.filter((k) => !CANONICAL_ROLE_REGISTRY[k].accountExists).map((k) => {
      const { email, reason, operatorAction } = CANONICAL_ROLE_REGISTRY[k];
      return [k, Object.freeze({ email, reason, operatorAction })];
    }),
  ),
);

/** Retained for callers that still import the old name. Same sixteen keys. */
export const CANONICAL_PERSONA_KEYS = CANONICAL_ROLE_KEYS;

/** Resolves an alias to its canonical role key. A non-alias is returned unchanged. */
export function resolvePersonaKey(personaId) {
  return PERSONA_ALIASES[personaId] ?? personaId;
}

/** The Job Role a canonical key serves, or null. Never a Security Role. */
export function jobRoleFor(personaId) {
  return CANONICAL_ROLE_REGISTRY[resolvePersonaKey(personaId)]?.jobRole ?? null;
}

/**
 * The catalog, without reading the credential file and without touching the network. Safe to print:
 * it carries role keys, Job Roles, addresses, uids and states, and no credential of any kind.
 */
export function personaDirectory() {
  return CANONICAL_ROLE_KEYS.map((personaId) => {
    const entry = CANONICAL_ROLE_REGISTRY[personaId];
    return entry.accountExists
      ? { personaId, canonical: true, state: "MAPPED", email: entry.email, jobRole: entry.jobRole, uid: entry.uid }
      : {
          personaId,
          canonical: true,
          state: "PENDING_ACCOUNT",
          email: entry.email,
          jobRole: entry.jobRole,
          uid: null,
          reason: entry.reason,
          operatorAction: entry.operatorAction,
        };
  });
}

export class CredentialAccessError extends Error {
  constructor(failureType, personaId, pathsTried, detail) {
    // Deliberately carries no credential value -- this message reaches logs.
    super(`CREDENTIAL_ACCESS_FAILED personaId=${personaId ?? "(none)"} type=${failureType}${detail ? ` detail=${detail}` : ""}`);
    this.name = "CredentialAccessError";
    this.code = "CREDENTIAL_ACCESS_FAILED";
    this.failureType = failureType;
    this.personaId = personaId ?? null;
    this.pathsTried = pathsTried;
  }
}

/**
 * THE credential source. One explicit path, from the environment, or a clean refusal.
 *
 * There is no fallback and no search. `CREDENTIAL_SOURCE_NOT_CONFIGURED` names the variable to set,
 * which is a thirty-second fix; guessing produced an hour of debugging the wrong thing twice.
 */
export function credentialSourcePath(personaId = null) {
  const explicit = process.env[CREDENTIAL_SOURCE_ENV];
  if (!explicit || !String(explicit).trim()) {
    throw new CredentialAccessError(
      "CREDENTIAL_SOURCE_NOT_CONFIGURED",
      personaId,
      [],
      `set ${CREDENTIAL_SOURCE_ENV} to the absolute path of your ${CANONICAL_FILENAME}. This loader does not search the filesystem: a guessed path found a 70-byte stub while 81 entries sat off-path, and that reads as "no credentials" rather than "wrong file".`,
    );
  }
  return String(explicit).trim();
}

/**
 * DIAGNOSTICS ONLY -- never resolution.
 *
 * The historical guess list, retained so `describeCredentialSources()` can SHOW an operator where
 * copies of the file are lying around and which one the old loader would have picked. Nothing in the
 * load path calls this, and a test asserts that.
 */
export function candidatePaths() {
  const home = os.homedir();
  return [
    path.resolve(HERE, "..", CANONICAL_FILENAME),
    path.resolve(HERE, "..", `.${CANONICAL_FILENAME}`),
    path.join(home, ".eos-sandbox", CANONICAL_FILENAME),
    // Authored for a WINDOWS profile; under WSL os.homedir() is the LINUX home, so these two never
    // matched the operator's real file. Kept only to make that visible in a diagnostic report.
    path.join(home, "Favorites", "Downloads", CANONICAL_FILENAME),
    path.join(home, "Downloads", CANONICAL_FILENAME),
  ];
}

/**
 * Where credential files actually are, by KEY NAME and COUNT only. For operator diagnosis of the
 * reachability defect; never used to resolve a credential.
 */
export function describeCredentialSources() {
  const configured = process.env[CREDENTIAL_SOURCE_ENV]?.trim() || null;
  const describe = (p, role) => {
    const out = { path: p, role, present: false, entryCount: 0, keyNames: [] };
    try {
      if (!fs.statSync(p).isFile()) return out;
      out.present = true;
      const table = parseCredentials(fs.readFileSync(p, "utf8"));
      out.keyNames = Object.keys(table).sort();
      out.entryCount = out.keyNames.length;
    } catch (err) {
      if (out.present) out.parseFailure = err.failureType ?? "UNPARSEABLE";
    }
    return out;
  };
  return {
    configured,
    configuredSource: configured ? describe(configured, "CONFIGURED") : null,
    // Explicitly labelled: these are NOT consulted when loading.
    historicalGuessPaths: candidatePaths().map((p) => describe(p, "DIAGNOSTIC_ONLY")),
  };
}

/**
 * Parses the credential file. Tolerates both a proper JSON object and the brace-less
 * "email": "password", entry list the file has actually been seen to contain -- because the contract
 * says READ the operator's file, not rewrite it into a shape the parser prefers.
 */
export function parseCredentials(raw) {
  const text = String(raw).trim();
  if (!text) throw new CredentialAccessError("EMPTY_FILE", null, []);

  const attempt = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const parsed = attempt(text) ?? attempt(`{${text.replace(/,\s*$/, "")}}`);
  if (!parsed) throw new CredentialAccessError("UNPARSEABLE", null, []);

  const out = {};
  for (const [email, password] of Object.entries(parsed)) {
    if (typeof email !== "string" || typeof password !== "string") continue;
    if (!password) continue;
    out[email.trim().toLowerCase()] = password;
  }
  if (Object.keys(out).length === 0) throw new CredentialAccessError("NO_ENTRIES", null, []);
  return out;
}

/**
 * Load one canonical role's credentials.
 * @param {string} personaId a canonical role key, or a legacy alias of one
 * @returns {{personaId: string, email: string, password: string, jobRole: string}}
 * @throws {CredentialAccessError} never carrying the credential value
 */
export function loadSandboxPersona(personaId) {
  const key = resolvePersonaKey(personaId);
  const entry = CANONICAL_ROLE_REGISTRY[key];

  // Answer the unloadable keys BY NAME, before the credential source is even read. A role with no
  // account behind it is not a missing password, and treating it as one sends the reader to the
  // file -- exactly the wrong place, and the reason this catalog was wrong for so long.
  if (entry && !entry.accountExists) {
    throw new CredentialAccessError(
      "PERSONA_ACCOUNT_PENDING",
      personaId,
      [],
      `${entry.reason} CANONICAL ADDRESS: ${entry.email} OPERATOR ACTION: ${entry.operatorAction}`,
    );
  }
  if (!entry && RETIRED_PERSONAS[key]) {
    const { reason, operatorAction } = RETIRED_PERSONAS[key];
    throw new CredentialAccessError("PERSONA_RETIRED", personaId, [], `${reason} OPERATOR ACTION: ${operatorAction}`);
  }
  if (!entry) {
    throw new CredentialAccessError("UNKNOWN_PERSONA", personaId, [], `known: ${CANONICAL_ROLE_KEYS.join(", ")}`);
  }

  const source = credentialSourcePath(personaId);
  const tried = [source];

  let stat;
  try {
    stat = fs.statSync(source);
  } catch {
    throw new CredentialAccessError("FILE_NOT_FOUND", personaId, tried);
  }
  if (!stat.isFile()) throw new CredentialAccessError("FILE_NOT_FOUND", personaId, tried);

  let raw;
  try {
    raw = fs.readFileSync(source, "utf8");
  } catch (err) {
    throw new CredentialAccessError("FILE_UNREADABLE", personaId, tried, err.code);
  }

  let table;
  try {
    table = parseCredentials(raw);
  } catch (err) {
    throw new CredentialAccessError(err.failureType ?? "UNPARSEABLE", personaId, tried);
  }

  const password = table[entry.email.toLowerCase()];
  if (!password) throw new CredentialAccessError("PERSONA_NOT_IN_FILE", personaId, tried);

  // The CANONICAL key is returned, never the alias that was typed, so a caller cannot build a
  // second vocabulary out of the aliases without noticing.
  return { personaId: key, email: entry.email, password, jobRole: entry.jobRole };
}

/** Safe to log: proves a load worked without revealing anything reversible. */
export function describeLoad(personaId) {
  const resolved = loadSandboxPersona(personaId);
  return {
    personaId: resolved.personaId,
    email: resolved.email,
    jobRole: resolved.jobRole,
    passwordLength: resolved.password.length,
    loaded: true,
  };
}

// ============================ CERTIFICATION WORLD IDENTITIES ============================
//
// The 47 Certification World employees are a DIFFERENT namespace from the sixteen canonical roles,
// and deliberately so.
//
// The registry is a hand-curated map: a human asks for "the warehouse manager" and gets an email.
// Adding 47 more entries there would drown that map in fixture data and give every certification
// employee a name-shaped key -- exactly the coupling the identity design exists to avoid.
//
// Certification identities are resolved by their STABLE EMPLOYEE ID instead. The login is derived,
// never looked up, so renaming an employee cannot move their identity.
//
// The namespace also protects them: `cw-emp-000@eos-sandbox.invalid` does not end with
// `@sandbox.invalid`, so activateSandboxPersonas.js --rotate cannot match a certification account
// and cannot invalidate one as a side effect of rotating the Owner's personas.
export const CERTIFICATION_EMAIL_DOMAIN = "@eos-sandbox.invalid";

/** The synthetic login for a certification employee. Derivation, not lookup. */
export function certificationEmailFor(employeeId) {
  if (typeof employeeId !== "string" || !/^cw-emp-\d{3}$/.test(employeeId)) {
    throw new CredentialAccessError("INVALID_CERTIFICATION_EMPLOYEE_ID", employeeId, []);
  }
  return `${employeeId}${CERTIFICATION_EMAIL_DOMAIN}`;
}

/**
 * Credentials for a certification employee.
 *
 * Reuses the same source and the same failure modes as the roles -- a missing entry is
 * CREDENTIAL_ACCESS_FAILED, never a silently manufactured password. An account whose login was never
 * activated has no entry, and that is a legitimate state: most certification employees exist to be
 * granted authority and measured, not to sign in.
 */
export function loadCertificationEmployee(employeeId) {
  const email = certificationEmailFor(employeeId);
  const source = credentialSourcePath(employeeId);
  const tried = [source];
  let table;
  try {
    table = parseCredentials(fs.readFileSync(source, "utf8"));
  } catch (err) {
    throw new CredentialAccessError(err.failureType ?? "NO_CREDENTIAL_FILE", employeeId, tried);
  }
  const password = table[email.toLowerCase()];
  if (!password) throw new CredentialAccessError("CERTIFICATION_LOGIN_NOT_ACTIVATED", employeeId, tried);
  return { employeeId, email, password };
}
