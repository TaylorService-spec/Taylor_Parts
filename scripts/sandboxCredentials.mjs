/**
 * THE canonical sandbox persona credential loader. One file, one loader, read only.
 *
 * Every persona/browser/Playwright mission consumes credentials through this
 * module. Do not write your own file parsing -- three separate agent-authored
 * parsers in one day produced: two wasted runs against a stale file, a raw
 * credential dump, and a password printed as reversible character codes.
 *
 * THE CONTRACT (Owner direction, "Sandbox credentials -- single source of truth"):
 *   - READ ONLY. This module never writes, regenerates, normalizes, reorders,
 *     rotates, encodes or copies the credential file. There is no write path here
 *     and there must never be one.
 *   - ONE filename: sandbox-credentials.local.json. Never falls back to
 *     sandbox.txt or any other list -- a stale fallback is worse than a failure,
 *     because it fails as "invalid password" and sends you debugging the wrong thing.
 *   - NEVER echo. Callers pass the returned password straight into fill() and
 *     never read it back. Nothing here logs, and errors never carry the value.
 *   - On failure: CREDENTIAL_ACCESS_FAILED, with the personaId, the paths tried
 *     and the failure type -- never the file contents.
 *   - Auth personas are NOT business fixture data. Resetting a scenario must
 *     never touch a persona account. See functions/scripts/activateSandboxPersonas.js.
 *   - A PERSONA KEY NAMES AN IDENTITY THAT EXISTS. A key that resolves to an
 *     account no live Principal is behind is a DEFECT, not a stale alias: it
 *     fails late, as the wrong identity, instead of here. Keys with no live
 *     identity are declared UNRECONCILED and fail closed with the reason and the
 *     operator action -- they are never pointed at a substitute account, and no
 *     account is ever created, reset or rotated to make a key resolve.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_FILENAME = "sandbox-credentials.local.json";

/**
 * ============================ THE CANONICAL PERSONA CATALOG ============================
 *
 * Reconciled 2026-09-24 against the LIVE nonprod authority (read-only SELECTs over
 * eos_policy.principals / user_role_assignments / employee_principal_links) and against
 * functions/scripts/fixtures/sampleCompany.v2.json.
 *
 * WHAT WAS WRONG. This map used to declare thirteen `sbx-*`-era addresses (owner@ /
 * dispatcher@ / tech@ / whmgr@ / partsmgr@ / partsassoc@ / fieldmgr@ / mikael@ / opsmgr@ /
 * salesmgr@ / acctmgr@ / restricted@). TWELVE of the thirteen resolved to NO live EOS
 * Principal while colliding BY NAME with a persona that does exist. That is the worst
 * possible failure shape: loadSandboxPersona("dispatcher") returned a well-formed credential
 * request for the WRONG IDENTITY, so the mission failed later -- as "invalid password", or as
 * a surprising authorization answer -- instead of failing here.
 *
 * THE RULE NOW. A persona key names an identity that EXISTS. Keys are mapped onto the Sample
 * Company v2 authentication accounts that are ALREADY LIVE. No account was created, reset,
 * rotated or fetched to satisfy this map, and no duplicate account was invented because an
 * older alias happened to be spelled differently. Where no live identity exists, the key is
 * declared UNRECONCILED and FAILS CLOSED with the reason -- never pointed at a
 * plausible-looking substitute.
 *
 * WHAT A PERSONA KEY IS NOT. It is not a Security Role, not a Job Role, not a capability and
 * not a record assignment. It names ONE authentication identity. What that identity may do is
 * read from PostgreSQL at request time and is none of this file's business.
 */

/**
 * The sixteen canonical persona keys, in catalog order. Some are unreconciled: this is the
 * catalog, not the serviceable subset. `personaDirectory()` reports the difference.
 */
export const CANONICAL_PERSONA_KEYS = Object.freeze([
  "owner",
  "admin",
  "generalManager",
  "serviceManager",
  "dispatcher",
  "technicianAssigned",
  "technicianUnassigned",
  "partsAssociate",
  "partsManager",
  "warehouseAssociate",
  "warehouseManager",
  "retailSales",
  "nationalAccountsSales",
  "financeAccounting",
  "reporting",
  "restricted",
]);

/**
 * Canonical key -> the live authentication account.
 *
 * Every address below was confirmed against a live `firebase` Principal in nonprod. The
 * external subject is recorded beside it because the uid is what the verifier actually
 * resolves, and because a uid is an identifier rather than a credential: it proves the
 * mapping without revealing anything that can be signed in with.
 */
const CANONICAL_PERSONAS = Object.freeze({
  // The Owner AUTHORITY, bound by functions/scripts/bindOwnerPersonaIdentity.js. Holds the
  // `owner` Security Role and NO employee link. It is deliberately NOT the administrator: it
  // is refused editObjectDefinition / editRoleDefinition / editWorkflowDefinition, which is
  // the whole measured difference between `owner` and `admin`.
  // Principal subject ajXZSa0gTcWAyDHVSsVifwZfNRf1.
  // NOTE the address: `eos-owner@`, not the retired `owner@`, which no Principal ever held.
  owner: "eos-owner@sandbox.invalid",

  // The ONE pre-existing sandbox Administrator, reused verbatim by sampleCompany.v2.json
  // (`existingAdministrator: true`, `credentialEmail: null`, REUSE_UNCHANGED). Principal
  // subject ZVu3lHTP1NQhj0Am04zTAGou0dx1; holds `admin`; it is the active login Principal for
  // Employee synthetic-np-emp-owner-executive.
  //
  // The manifest withholds the address deliberately, so the fixture can never be read as
  // licence to recreate the account -- but the address IS recorded, with this exact uid beside
  // it, in docs/architecture/eos-real-nonprod-activation.md. So this key was CORRECT all
  // along: it is the one legacy address that was never a collision, and it is left untouched.
  //
  // avery.fixture@sandbox.invalid is that Employee's WORK EMAIL, not a login, and no
  // authentication account exists for it. It must NOT be created: a second `admin`-Role
  // Principal in nonprod is an authority change and needs its own ruling.
  admin: "admin@sandbox.invalid",

  // Principal xiyAcX4UQEQRRqbM..., Role generalManager, Employee
  // synthetic-np-emp-general-manager.
  generalManager: "bailey.fixture@sandbox.invalid",

  // Principal oQPfzG2AUgWOo8Tm..., Role fieldManager, Employee synthetic-np-emp-service-manager.
  // The ROLE key is still spelled `fieldManager`; the PERSONA is the Service Manager. The key
  // names the person, the Role names the authority, and they are allowed to differ.
  serviceManager: "devon.fixture@sandbox.invalid",

  // Principal PEiRkebIGRPcEau7..., Role dispatcher, Employee synthetic-np-emp-dispatcher.
  dispatcher: "emerson.fixture@sandbox.invalid",

  // The assigned/unassigned PAIR. Identical in Security Role, Job Role and Work Eligibility
  // (both hold a CURRENT SERVICE_TECHNICIAN qualification); the only intended difference is a
  // record assignment. THAT ASSIGNMENT IS NOT SEEDED YET --
  // personaE2EScenarios.v1.json assignedUnassignedFixture is NOT_SEEDED, blocked on grant
  // reconciliation. So today the two accounts differ by INTENT only, and a test asserting the
  // difference will fail honestly rather than have the difference fabricated here.
  // Principals i4EYSBGPXPM8lweu... (a) and l2AKXJ44hzUEWpYf... (b).
  technicianAssigned: "finley.fixture@sandbox.invalid",
  technicianUnassigned: "gray.fixture@sandbox.invalid",

  // Principal Ap6MRSs1gKW5lQtN..., Roles partsAssociate + inventoryReceivingClerk.
  partsAssociate: "logan.fixture@sandbox.invalid",
  // Principal p9zXxj5SJiOAwbSo..., Roles partsManager + purchasingManager.
  partsManager: "kai.fixture@sandbox.invalid",
  // Principal cgVnRUMA2Sc7WxHl..., Roles warehouseAssociate + inventoryCycleCountCounter.
  warehouseAssociate: "noor.fixture@sandbox.invalid",
  // Principal 0KBdhU9Z8Yc4aTQq..., Roles warehouseManager + inventoryCycleCountReconciler +
  // inventoryBinAdministrator.
  warehouseManager: "morgan.fixture@sandbox.invalid",

  // Principal 4OVJwVRisyOlgBQD..., Role salesperson, Employee synthetic-np-emp-retail-sales-a.
  retailSales: "harper.fixture@sandbox.invalid",
  // Principal zpfYS0PKUJOwVbsk..., Role salesperson, Employee
  // synthetic-np-emp-national-accounts-sales. The SAME Role as retailSales; the difference is
  // the book of business, not the authority.
  nationalAccountsSales: "jules.fixture@sandbox.invalid",
});

/**
 * Live logins that are not one of the sixteen, mapped so that no real account is unreachable
 * through the loader. Each is a Principal measured in nonprod.
 */
const SUPPLEMENTAL_PERSONAS = Object.freeze({
  // Principal Trvw2vp0yhd2SnXO..., Role officeManager, Employee synthetic-np-emp-office-manager.
  officeManager: "casey.fixture@sandbox.invalid",
  // Principal 26pkGMjIBJUzDAJY..., Role technician, Employee
  // synthetic-np-emp-contract-technician, employment_status CONTRACTOR -- the
  // eligibility-versus-employment-status case.
  contractTechnician: "oakley.fixture@sandbox.invalid",
  // Principal jUzI7OPsdIbJ0WGa..., Role salesperson, Employee synthetic-np-emp-retail-sales-b.
  retailSalesB: "indigo.fixture@sandbox.invalid",
});

/**
 * Canonical keys with NO live identity. Asking for one is a clean, explanatory failure.
 *
 * NOTHING HERE IS A MISSING PASSWORD. Each is a missing AUTHORITY, and inventing an account
 * for it would manufacture a business permission so that a test could pass. Measured
 * 2026-09-24: accountingManager, financeManager, reportAuthor, reportFinanceViewer,
 * reportViewer and salesManager each hold ZERO active user_role_assignments in nonprod, and no
 * Role keyed `restricted` exists at all.
 */
export const UNRECONCILED_PERSONAS = Object.freeze({
  financeAccounting: Object.freeze({
    reason:
      "NO_LIVE_PRINCIPAL: the Finance Roles (financeManager, accountingManager) hold zero active assignments in nonprod, and the Sample Company declares no finance Employee, Principal or login.",
    operatorAction:
      "Declare a finance Employee and Principal in sampleCompany.v2.json and assign a finance Role through the governed path (Lane BI is adding the Employee chains). Only then does an authentication account for it mean anything.",
  }),
  reporting: Object.freeze({
    reason:
      "NO_LIVE_PRINCIPAL_AND_NO_AUTHORITY: reportAuthor, reportViewer and reportFinanceViewer hold zero active assignments, and those Roles hold zero capabilities -- so even a holder would be indistinguishable from a persona with no Roles at all.",
    operatorAction:
      "Grant the Reporting Roles their capabilities first (a governed grant reconciliation), then declare a holder. A login before that measures nothing.",
  }),
  restricted: Object.freeze({
    reason:
      "NO_SUCH_ROLE: nonprod contains no Role keyed `restricted` and no Principal holds one. The legacy restricted@sandbox.invalid account was a Firebase-era control with no EOS Principal behind it.",
    operatorAction:
      "Decide what `restricted` is meant to prove. A Principal holding NO Roles is the honest negative control and needs no new Role -- but it still needs a declared Employee/Principal pair, which is an Owner call, not a loader change.",
  }),
});

/**
 * Keys retired outright: each named a Role or a control that no live Principal holds, and no
 * canonical key replaces it. Retained ONLY so that asking still produces an explanation rather
 * than a bare UNKNOWN_PERSONA.
 */
export const RETIRED_PERSONAS = Object.freeze({
  operationsManager: Object.freeze({
    reason:
      "NO_LIVE_HOLDER: the operationsManager Role holds zero active assignments in nonprod, and opsmgr@sandbox.invalid has no EOS Principal.",
    operatorAction:
      "If an operations persona is wanted, declare it in sampleCompany.v2.json. Do NOT quietly repoint this key at officeManager -- a different Role is a different authority.",
  }),
  salesManager: Object.freeze({
    reason:
      "NO_LIVE_HOLDER: the salesManager Role holds zero active assignments, and salesmgr@sandbox.invalid has no EOS Principal. All six live sales logins hold `salesperson`, not `salesManager`.",
    operatorAction:
      "Use `retailSales`, `retailSalesB` or `nationalAccountsSales` for an individual contributor. A sales MANAGER persona needs a declared Employee and a governed Role assignment.",
  }),
  accountingManager: Object.freeze({
    reason:
      "NO_LIVE_HOLDER: the accountingManager Role holds zero active assignments, and acctmgr@sandbox.invalid has no EOS Principal.",
    operatorAction: "The same chain as `financeAccounting`, with which it is the same gap.",
  }),
});

/**
 * Backward-compatible aliases. Each legacy spelling now resolves to the CANONICAL key for the
 * identity it was always meant to name, so old call sites keep working AND start reaching a
 * real account. An alias may only ever point at a canonical key, never carry an address of its
 * own -- that is what let a collision hide here in the first place.
 */
export const PERSONA_ALIASES = Object.freeze({
  // Was tech@sandbox.invalid (no Principal). The ASSIGNED technician is the default because it
  // is the positive case every existing caller was written against.
  technician: "technicianAssigned",
  // Was fieldmgr@sandbox.invalid (no Principal). The Service Manager holds the `fieldManager`
  // Role; the old key was named after the Role rather than the person.
  fieldManager: "serviceManager",
  // Was mikael@sandbox.invalid (no Principal). Three live logins hold `salesperson`, so the
  // bare key was ambiguous as well as dead. It resolves to the PRIMARY retail contributor;
  // a caller that means the national accounts book must say so.
  salesperson: "retailSales",
  // Spelling conveniences, so nobody has to remember which of a/b is which.
  serviceTechnicianA: "technicianAssigned",
  serviceTechnicianB: "technicianUnassigned",
  // The Sample Company calls the administrator's Employee "owner-executive". The AUTHORITY it
  // holds is `admin`, so the alias points there and not at `owner`.
  ownerExecutive: "admin",
});

/**
 * Stable persona keys -> login address. Canonical first, then the supplemental live logins.
 * EVERY entry names an account that exists. Unreconciled and retired keys are deliberately
 * absent from this map and are answered by name in loadSandboxPersona.
 */
export const SANDBOX_PERSONAS = Object.freeze({ ...CANONICAL_PERSONAS, ...SUPPLEMENTAL_PERSONAS });

/** Resolves an alias to its canonical key. A non-alias is returned unchanged. */
export function resolvePersonaKey(personaId) {
  return PERSONA_ALIASES[personaId] ?? personaId;
}

/**
 * The catalog, without reading the credential file and without touching the network. Safe to
 * print: it carries addresses and states, and no credential of any kind.
 */
export function personaDirectory() {
  return CANONICAL_PERSONA_KEYS.map((personaId) =>
    SANDBOX_PERSONAS[personaId]
      ? { personaId, canonical: true, state: "MAPPED", email: SANDBOX_PERSONAS[personaId] }
      : { personaId, canonical: true, state: "UNRECONCILED", email: null, ...UNRECONCILED_PERSONAS[personaId] },
  );
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
 * Candidate locations for the ONE canonical filename. This is not a list of
 * alternate credential files -- it is the same file, wherever the operator keeps
 * it. SANDBOX_CREDENTIALS_FILE wins if set.
 */
export function candidatePaths() {
  const explicit = process.env.SANDBOX_CREDENTIALS_FILE;
  // An explicit path is AUTHORITATIVE, never merely first. Falling through to
  // some other copy when the named file is missing is precisely the failure that
  // sent two persona runs at a stale file and cost an hour: it does not surface
  // as "file not found", it surfaces as "invalid password".
  if (explicit) return [explicit];

  const home = os.homedir();
  return [
    path.resolve(HERE, "..", CANONICAL_FILENAME),
    path.resolve(HERE, "..", `.${CANONICAL_FILENAME}`),
    // The operator's own location. MEASURED 2026-09-24: the only credential file on the
    // primary host lives here, and every canonical path above missed it -- so a correctly
    // spelled persona still failed FILE_NOT_FOUND while the file sat on disk. Same one
    // filename; a location, not an alternate file.
    path.join(home, ".eos-sandbox", CANONICAL_FILENAME),
    path.join(home, "Favorites", "Downloads", CANONICAL_FILENAME),
    path.join(home, "Downloads", CANONICAL_FILENAME),
  ];
}

/**
 * Parses the credential file. Tolerates both a proper JSON object and the
 * brace-less "email": "password", entry list the file has actually been seen to
 * contain -- because the contract says READ the operator's file, not rewrite it
 * into a shape the parser prefers.
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

  // Proper JSON object, then the same content wrapped in braces (brace-less
  // entry list), with any trailing comma before the close removed.
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
 * Load one persona's credentials.
 * @param {string} personaId a key of SANDBOX_PERSONAS
 * @returns {{personaId: string, email: string, password: string}}
 * @throws {CredentialAccessError} never carrying the credential value
 */
export function loadSandboxPersona(personaId) {
  const key = resolvePersonaKey(personaId);
  const email = SANDBOX_PERSONAS[key];

  // Answer the unmappable keys BY NAME, before the credential file is even looked for. A
  // persona with no identity behind it is not a missing password, and treating it as one sends
  // the reader to the file -- which is exactly the wrong place, and the reason this catalog was
  // wrong for so long.
  if (!email && UNRECONCILED_PERSONAS[key]) {
    const { reason, operatorAction } = UNRECONCILED_PERSONAS[key];
    throw new CredentialAccessError("PERSONA_UNRECONCILED", personaId, [], `${reason} OPERATOR ACTION: ${operatorAction}`);
  }
  if (!email && RETIRED_PERSONAS[key]) {
    const { reason, operatorAction } = RETIRED_PERSONAS[key];
    throw new CredentialAccessError("PERSONA_RETIRED", personaId, [], `${reason} OPERATOR ACTION: ${operatorAction}`);
  }
  if (!email) {
    throw new CredentialAccessError("UNKNOWN_PERSONA", personaId, [], `known: ${Object.keys(SANDBOX_PERSONAS).join(", ")}`);
  }

  const tried = candidatePaths();
  const found = tried.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
  if (!found) throw new CredentialAccessError("FILE_NOT_FOUND", personaId, tried);

  let raw;
  try {
    raw = fs.readFileSync(found, "utf8");
  } catch (err) {
    throw new CredentialAccessError("FILE_UNREADABLE", personaId, tried, err.code);
  }

  let table;
  try {
    table = parseCredentials(raw);
  } catch (err) {
    throw new CredentialAccessError(err.failureType ?? "UNPARSEABLE", personaId, tried);
  }

  const password = table[email.toLowerCase()];
  if (!password) throw new CredentialAccessError("PERSONA_NOT_IN_FILE", personaId, tried);

  // The CANONICAL key is returned, never the alias that was typed, so a caller cannot build a
  // second vocabulary out of the aliases without noticing.
  return { personaId: key, email, password };
}

/** Safe to log: proves a load worked without revealing anything reversible. */
export function describeLoad(personaId) {
  const resolved = loadSandboxPersona(personaId);
  return { personaId: resolved.personaId, email: resolved.email, passwordLength: resolved.password.length, loaded: true };
}

// ============================ CERTIFICATION WORLD IDENTITIES ============================
//
// The 47 Certification World employees are a DIFFERENT namespace from the named personas above, and
// deliberately so.
//
// The personas are a hand-curated map: a human asks for "the warehouse manager" and gets an email.
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
 * Reuses the same file and the same failure mode as the personas -- a missing entry is
 * CREDENTIAL_ACCESS_FAILED, never a silently manufactured password. An account whose login was never
 * activated has no entry, and that is a legitimate state: most certification employees exist to be
 * granted authority and measured, not to sign in.
 */
export function loadCertificationEmployee(employeeId) {
  const email = certificationEmailFor(employeeId);
  const tried = candidatePaths();
  let table = null;
  for (const p of tried) {
    try {
      table = parseCredentials(fs.readFileSync(p, "utf8"));
      break;
    } catch {
      // try the next candidate path, exactly as loadSandboxPersona does
    }
  }
  if (!table) throw new CredentialAccessError("NO_CREDENTIAL_FILE", employeeId, tried);
  const password = table[email.toLowerCase()];
  if (!password) throw new CredentialAccessError("CERTIFICATION_LOGIN_NOT_ACTIVATED", employeeId, tried);
  return { employeeId, email, password };
}
