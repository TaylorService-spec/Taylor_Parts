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

  // Principal 18e54b1f..., subject PEiRkebIGRPcEau7yBBV0D77Dho1, Role dispatcher, Employee
  // synthetic-np-emp-dispatcher.
  //
  // CORRECTED 2026-09-25 by Owner ruling, against a real Firebase Admin SDK enumeration of the
  // 28 `@sandbox.invalid` accounts in eos-platform-sandbox. This key used to read
  // `emerson.fixture@sandbox.invalid`, and the comment beside it claimed subject
  // PEiRkebIGRPcEau7... -- but that subject belongs to `dispatcher@sandbox.invalid`.
  // `emerson.fixture@` is a DIFFERENT account (uid NReyNyXVMdVkv75vpmxWuvGUeOm1) with NO EOS
  // Principal behind it at all.
  //
  // So this entry was the very defect the catalog rewrite existed to kill, reintroduced one layer
  // down: the key resolved, to a real account, that no Principal stood behind -- while the account
  // that DOES hold the live Dispatcher Principal went unnamed. It fails late, as the wrong
  // identity, exactly as the header warns. `emerson.fixture@` is recorded in SUPERSEDED_IDENTITIES
  // as NOT_CANONICAL_FOR_P05 so it can never be selected again.
  dispatcher: "dispatcher@sandbox.invalid",

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

  // ---- DECLARED CANONICAL 2026-09-25 by Owner ruling. ----
  //
  // These two were UNRECONCILED until a real Firebase Admin SDK enumeration settled what exists.
  // Both accounts ALREADY EXIST and are REUSED; neither was created, reset or rotated to make a
  // key resolve, and no duplicate was minted beside them.
  //
  // The earlier UNRECONCILED reasoning was not wrong about AUTHORITY -- the finance Roles still
  // hold few or no live assignments, and no Role keyed `restricted` exists -- but it conflated
  // "no authority" with "no account", and it was the account question that blocked the credential
  // work. The authority gap is real, is tracked elsewhere, and is not this file's business: what
  // an identity may do is read from PostgreSQL at request time.
  //
  // uid anKfqN34GSS1RKCgF00nWTse6062. NO EOS Principal yet -- the Employee/Principal chain is a
  // separate governed step. Supersedes `sage.fixture@sandbox.invalid`, which does NOT exist in
  // the project and must not be created.
  financeAccounting: "acctmgr@sandbox.invalid",

  // uid lT75guU9mEY46QFQcegWRZRhYBi2. NO EOS Principal yet. Supersedes
  // `wren.fixture@sandbox.invalid`, which does NOT exist in the project and must not be created.
  // The negative control this persona is meant to be still needs its Principal declared; until
  // then it authenticates and is refused for having no Principal, which proves a DIFFERENT thing.
  restricted: "restricted@sandbox.invalid",
});

/**
 * Canonical keys whose ADDRESS is settled but whose ACCOUNT does not exist yet.
 *
 * This state exists so that `personaDirectory()` can report all sixteen keys as DECLARED -- the
 * Owner ruled the catalog complete -- without this module asserting that an account exists when it
 * does not. That assertion is the whole failure mode the header warns about: a key that resolves
 * to an address nothing is behind fails late, as "invalid password", instead of failing here.
 *
 * So the address is declared and the load still FAILS CLOSED, with the reason and the operator
 * action. No account is created here, and none may be created to make the key resolve -- creation
 * is a separate, explicitly authorized step through the governed path.
 */
export const PENDING_ACCOUNT_PERSONAS = Object.freeze({
  reporting: Object.freeze({
    email: "reporting@sandbox.invalid",
    reason:
      "ACCOUNT_NOT_CREATED_YET: a Firebase Admin SDK enumeration of eos-platform-sandbox on 2026-09-25 found 28 @sandbox.invalid accounts and no reporting address among them. This is the ONLY canonical persona with no account; every other key names one that exists.",
    operatorAction:
      "Create exactly ONE account for reporting@sandbox.invalid through the governed activation path, then activate its credential with the existing activateMissingSandboxPasswords. Do not create a second reporting-shaped account, and do not point this key at a substitute. NOTE the authority gap is unchanged and is tracked separately: reportViewer, reportFinanceViewer and reportAuthor each resolve to ZERO role_capabilities in nonprod, so a holder measures nothing until those grants exist.",
  }),
});

/**
 * ADDRESSES THAT MUST NEVER BE SELECTED AS A PERSONA'S CANONICAL IDENTITY.
 *
 * A first-class contract fact rather than a comment, because a comment cannot be asserted and this
 * is precisely the class of mistake that keeps recurring here: a plausible-looking address, spelled
 * consistently with its neighbours, adopted for a persona it was never the identity of.
 *
 * `supersededBy` names the address that IS canonical. A null uid means the account does not exist
 * in the project at all -- so adopting it would not merely be wrong, it would be unloadable, and
 * the tempting "fix" would be to create it, which is how duplicate personas get minted.
 */
export const SUPERSEDED_IDENTITIES = Object.freeze({
  "sage.fixture@sandbox.invalid": Object.freeze({
    disposition: "SUPERSEDED_FOR_P14",
    persona: "financeAccounting",
    supersededBy: "acctmgr@sandbox.invalid",
    uid: null,
    reason:
      "Declared by sampleCompany.v2.json as the Finance / Accounting login, but no such account exists in eos-platform-sandbox. The Owner ruled the EXISTING acctmgr@sandbox.invalid is reused instead. Creating sage.fixture@ would mint a duplicate persona account for an identity that already has one.",
  }),
  "wren.fixture@sandbox.invalid": Object.freeze({
    disposition: "SUPERSEDED_FOR_P16",
    persona: "restricted",
    supersededBy: "restricted@sandbox.invalid",
    uid: null,
    reason:
      "Declared by sampleCompany.v2.json as the Restricted negative-control login, but no such account exists in eos-platform-sandbox. The Owner ruled the EXISTING restricted@sandbox.invalid is reused instead.",
  }),
  "emerson.fixture@sandbox.invalid": Object.freeze({
    disposition: "NOT_CANONICAL_FOR_P05",
    persona: "dispatcher",
    supersededBy: "dispatcher@sandbox.invalid",
    uid: "NReyNyXVMdVkv75vpmxWuvGUeOm1",
    reason:
      "This account EXISTS but has NO EOS Principal. The catalog pointed the `dispatcher` key at it while attributing to it the subject PEiRkebIGRPcEau7yBBV0D77Dho1 -- which actually belongs to dispatcher@sandbox.invalid, the account the live Dispatcher Principal is behind. A resolving key standing in front of no Principal is the exact defect this catalog was rewritten to eliminate. NOT deleted: stale accounts stay until a separate cleanup wave authorizes deletion, and they must not be bound to duplicate Principals.",
  }),
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
/**
 * DELIBERATELY EMPTY since 2026-09-25, and kept rather than deleted.
 *
 * All three former members -- financeAccounting, reporting and restricted -- were resolved by the
 * Owner ruling: the first and third name EXISTING accounts and moved into the canonical map, and
 * the second has a settled canonical address and moved to PENDING_ACCOUNT_PERSONAS.
 *
 * The export survives because callers destructure it and because an empty map is a stronger
 * statement than a missing one: it says the unreconciled state was emptied, not forgotten. A key
 * may legitimately land here again -- it is the right home for a persona whose identity nobody has
 * settled -- but nothing is here today.
 *
 * NOTE what this emptiness does NOT claim. It says every canonical key now has a settled ADDRESS.
 * It does not say every persona has its authority: the finance Roles and all three reporting Roles
 * still hold few or no live grants. That gap is real and is tracked outside this file, because what
 * an identity may do is read from PostgreSQL at request time and is none of this module's business.
 */
export const UNRECONCILED_PERSONAS = Object.freeze({});

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
  return CANONICAL_PERSONA_KEYS.map((personaId) => {
    if (SANDBOX_PERSONAS[personaId]) {
      return { personaId, canonical: true, state: "MAPPED", email: SANDBOX_PERSONAS[personaId] };
    }
    // PENDING_ACCOUNT carries its address -- the key is declared -- while still being a state the
    // loader refuses. Declared is not the same as loadable, and conflating them is what sent
    // readers to the credential file for an identity that does not exist.
    if (PENDING_ACCOUNT_PERSONAS[personaId]) {
      return { personaId, canonical: true, state: "PENDING_ACCOUNT", ...PENDING_ACCOUNT_PERSONAS[personaId] };
    }
    return { personaId, canonical: true, state: "UNRECONCILED", email: null, ...UNRECONCILED_PERSONAS[personaId] };
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
  // A persona whose ADDRESS is settled but whose ACCOUNT does not exist yet. Answered by name,
  // before the credential file is looked for, for the same reason as the unreconciled keys: this
  // is not a missing password, and sending the reader to the file is sending them to the wrong
  // place. The address IS reported, so the operator can see exactly what must be created.
  if (!email && PENDING_ACCOUNT_PERSONAS[key]) {
    const { email: pending, reason, operatorAction } = PENDING_ACCOUNT_PERSONAS[key];
    throw new CredentialAccessError(
      "PERSONA_ACCOUNT_PENDING",
      personaId,
      [],
      `${reason} CANONICAL ADDRESS: ${pending} OPERATOR ACTION: ${operatorAction}`,
    );
  }
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
