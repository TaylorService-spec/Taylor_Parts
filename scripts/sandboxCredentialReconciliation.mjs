/**
 * SANDBOX CREDENTIAL RECONCILIATION — read-only, dry-run only, counts out.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A BOOTSTRAP.
 *
 * This lane was briefed to build a "credential bootstrap": generate passwords for the twelve
 * canonical personas that had no entry in the canonical credential file, and create auth accounts
 * for the three that had no declared address. Both halves of that brief rested on one premise:
 *
 *     "no canonical credential" MEANS "no credential exists".
 *
 * THE PREMISE WAS FALSE, and measuring it is the whole point of this file. The canonical loader
 * resolved to a 70-byte file holding ONE entry, and that was read as credential absence. It was a
 * LOADER REACHABILITY result, not a credential-existence result: the operator's real credential
 * source holds SIXTY entries and the loader cannot see it.
 *
 * ============================ THE REACHABILITY DEFECT ============================
 *
 * `candidatePaths()` in scripts/sandboxCredentials.mjs builds two of its five candidates from
 * `os.homedir()`:
 *
 *     path.join(home, "Favorites", "Downloads", CANONICAL_FILENAME)
 *     path.join(home, "Downloads",  CANONICAL_FILENAME)
 *
 * `Favorites\Downloads` is a WINDOWS shell folder. Those two candidates were authored for a
 * Windows profile, but this host runs the loader under WSL, where `os.homedir()` is the LINUX home
 * (`/home/<user>`). So the loader looks for `/home/<user>/Favorites/Downloads/...`, which does not
 * exist and never did, while the real file sits in the Windows profile
 * (`/mnt/c/Users/<user>/Favorites/Downloads/...`) holding every credential anybody was looking for.
 *
 * This is the exact failure shape scripts/sandboxCredentials.mjs was written to prevent, one level
 * up: it does not surface as "your file is somewhere else", it surfaces as an empty catalog, which
 * reads as "these personas have no passwords" — and the remedy that suggests itself is to MINT new
 * ones. Doing that would have reset live accounts and invalidated the operator's working file,
 * which is precisely the harm `--rotate`'s warnings exist to prevent, reached by a different road.
 *
 * ============================ WHAT THIS MODULE MAY DO ============================
 *
 * NOTHING THAT WRITES. There is no write path here, no `node:crypto` import, no password
 * generation, no account creation, no Auth client, and no network call. A reconciliation that could
 * mutate is not a reconciliation.
 *
 * There is also deliberately NO SECOND PASSWORD IMPLEMENTATION. The repository already has exactly
 * one (`activateMissingSandboxPasswords` in functions/scripts/activateSandboxPersonas.js), it
 * already refuses production, already generates a password ONLY where none exists, already merges
 * rather than replaces, and the Sample Company orchestrator already calls it through an explicit
 * allowlist and is DRY RUN BY DEFAULT. Adding another would be a second thing to keep honest about
 * rotation and merge semantics, and the first time the two drifted the symptom would be "invalid
 * password" with no clue which one was wrong.
 *
 * KEY NAMES, NEVER VALUES. Every function here accepts and returns credential-file KEY NAMES
 * (addresses) and counts. No function accepts, returns, logs, compares, measures the length of, or
 * otherwise derives anything from a password. `discoverCredentialSources()` reports how many
 * entries a file holds and what they are KEYED by, and nothing else.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_PERSONA_KEYS,
  PERSONA_ALIASES,
  RETIRED_PERSONAS,
  SANDBOX_PERSONAS,
  UNRECONCILED_PERSONAS,
  candidatePaths,
  parseCredentials,
} from "./sandboxCredentials.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(HERE, "..", "config", "environments.json");

/** The only Firebase project this workstream may ever name. */
export const SANDBOX_PROJECT_ID = "eos-platform-sandbox";

/**
 * The customer production project, denied BY NAME and independently of the registry.
 *
 * Two fences, because they fail differently: a registry `role` check is the general rule and
 * catches any production environment, but it is only as good as the registry file, which is
 * editable. The literal name is the backstop that survives a registry edit. `taylor-parts` must be
 * unreachable even if `config/environments.json` is wrong, absent or malicious.
 */
export const FORBIDDEN_PROJECT_IDS = Object.freeze(["taylor-parts"]);

/** The five reconciliation states. Every canonical persona lands in exactly one. */
export const CLASSIFICATIONS = Object.freeze([
  "EXISTING_CREDENTIAL_EXACT_MATCH",
  "EXISTING_CREDENTIAL_ALIAS_MATCH",
  "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
  "NEEDS_DISTINCT_SECOND_TEST_IDENTITY",
  "AUTH_ACCOUNT_MISSING",
]);

export class ReconciliationRefusal extends Error {
  constructor(code, detail) {
    // Carries a code and a reason. Never a credential, and never a file's contents.
    super(`${code}: ${detail}`);
    this.name = "ReconciliationRefusal";
    this.code = code;
  }
}

/**
 * Refuse any target that is not the sandbox, by BOTH fences.
 *
 * Order matters: the literal deny list is checked FIRST, so `taylor-parts` is refused before the
 * registry is even read. A registry that has been edited to relabel production as `sandbox`
 * therefore still cannot let it through.
 */
export function assertSandboxTarget(projectId) {
  if (!projectId || typeof projectId !== "string") {
    throw new ReconciliationRefusal("PROJECT_ID_REQUIRED", "no default target; name the project explicitly");
  }
  if (FORBIDDEN_PROJECT_IDS.includes(projectId)) {
    throw new ReconciliationRefusal("PRODUCTION_PROJECT_FORBIDDEN", `'${projectId}' is the customer production project`);
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch (err) {
    throw new ReconciliationRefusal("REGISTRY_UNREADABLE", `cannot read the environment registry (${err.code ?? "error"})`);
  }
  const env = (registry.environments ?? []).find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) {
    throw new ReconciliationRefusal("UNKNOWN_PROJECT", `'${projectId}' is not a provisioned environment; unknown projects fail closed`);
  }
  if (env.role === "production") {
    throw new ReconciliationRefusal("PRODUCTION_ROLE_FORBIDDEN", `environment '${env.id}' has role 'production'`);
  }
  // Reconciliation is pinned to ONE sandbox. `eos-platform-certification` is also role=sandbox and
  // is deliberately still refused: the certification identities are a separate namespace
  // (`@eos-sandbox.invalid`) with their own lifecycle, and reconciling them against the persona
  // catalog would compare two things that are not the same population.
  if (projectId !== SANDBOX_PROJECT_ID) {
    throw new ReconciliationRefusal("WRONG_SANDBOX_PROJECT", `this reconciliation is pinned to '${SANDBOX_PROJECT_ID}', not '${projectId}'`);
  }
  return env;
}

/**
 * Every place the loader looks, plus whether a file is actually there.
 *
 * Returns KEY NAMES and counts only. `reachableByLoader` is the honest answer to "would
 * loadSandboxPersona find this?", which is the question the 70-byte stub answered misleadingly.
 */
export function discoverCredentialSources({ extraPaths = [] } = {}) {
  const canonical = candidatePaths();
  const seen = new Set();
  const sources = [];

  for (const [group, list] of [["CANONICAL_CANDIDATE", canonical], ["OFF_LOADER_PATH", extraPaths]]) {
    for (const p of list) {
      if (seen.has(p)) continue;
      seen.add(p);
      const source = { path: p, group, present: false, entryCount: 0, keyNames: [], reachableByLoader: group === "CANONICAL_CANDIDATE" };
      let raw;
      try {
        if (!fs.statSync(p).isFile()) {
          sources.push(source);
          continue;
        }
        raw = fs.readFileSync(p, "utf8");
      } catch {
        sources.push(source);
        continue;
      }
      source.present = true;
      try {
        // The canonical parser, so this module cannot disagree with the loader about what an entry
        // is. Only Object.keys() is taken from the result; the values are never touched.
        const table = parseCredentials(raw);
        source.keyNames = Object.keys(table).sort();
        source.entryCount = source.keyNames.length;
      } catch (err) {
        source.parseFailure = err.failureType ?? "UNPARSEABLE";
      }
      sources.push(source);
    }
  }
  return sources;
}

/**
 * THE MEASURED 16-ROW RECONCILIATION.
 *
 * Measured 2026-09-25 against, in order of authority:
 *   1. functions/scripts/fixtures/personaBusinessConnectionCensus.v1.json — the live-nonprod census
 *      (read-only SELECTs over eos_policy.principals / user_role_assignments /
 *      employee_principal_links). Supplies every VERIFIED external subject, principal id and
 *      employee id below.
 *   2. functions/scripts/fixtures/sampleCompany.v2.json — the declared login addresses and each
 *      principal's disposition.
 *   3. docs/architecture/eos-real-nonprod-activation.md — independently corroborates the
 *      administrator's uid twice (a console read and a minted-token read).
 *
 * `credentialCandidate` is the credential-file KEY NAME that could serve the row, or null. A row is
 * only EXACT/ALIAS matched when the key names an account whose uid IS this persona's uid — a key
 * that merely SOUNDS like the persona is the collision this whole catalog was rewritten to kill.
 */
export const RECONCILIATION = Object.freeze([
  {
    slot: "P01",
    persona: "owner",
    label: "Owner / Executive (authority side)",
    credentialCandidate: "eos-owner@sandbox.invalid",
    authAccountExists: true,
    authUid: "ajXZSa0gTcWAyDHVSsVifwZfNRf1",
    principalId: "dca03ad1-9278-49e6-b4f9-d09d3f587dc4",
    employeeId: null,
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_CREDENTIAL_EXACT_MATCH",
    action: "NONE. Holds `owner` (47 capabilities) and NO employee link. The credential is the sole entry in the canonical 70-byte file and it authenticates. NEVER ROTATE.",
    note: "The Employee side of P01 is a DIFFERENT Principal — see P02. `avery.fixture@sandbox.invalid` is that Employee's WORK EMAIL, has no auth account, and must not be given one.",
  },
  {
    slot: "P02",
    persona: "admin",
    label: "Administrator (also P01's Employee side)",
    credentialCandidate: "admin@sandbox.invalid",
    authAccountExists: true,
    authUid: "ZVu3lHTP1NQhj0Am04zTAGou0dx1",
    principalId: "639c1970-dbdb-4bc0-af7c-118559151e2f",
    employeeId: "synthetic-np-emp-owner-executive",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_CREDENTIAL_EXACT_MATCH",
    action: "NONE. A credential for this exact address EXISTS in the operator's 60-entry file. The brief listed `admin` as a bootstrap candidate; that was the false-absence premise. NEVER ROTATE.",
    note: "The ONE legacy `sbx-*`-era address that was never a collision. Holds `admin` (66 capabilities). Reused verbatim by the manifest as REUSE_UNCHANGED, and excluded from the Sample Company allowlist because its loginPrincipal.credentialEmail is null.",
  },
  {
    slot: "P03",
    persona: "generalManager",
    label: "General Manager",
    credentialCandidate: null,
    authAccountExists: true,
    authUid: "xiyAcX4UQEQRRqbMRrIXv3LwWVi2",
    principalId: "98fbb1ee-4998-4082-adea-bf94fa82f4c8",
    employeeId: "synthetic-np-emp-general-manager",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
    action: "Owner ruling required. The account exists; no credential file holds `bailey.fixture@sandbox.invalid`. The governed remedy is the existing allowlisted activate-credentials path, NOT a new script.",
    note: "No legacy loader key ever named General Manager — an absence, not a collision. Nothing in the 60-entry file can serve it.",
  },
  {
    slot: "P04",
    persona: "serviceManager",
    label: "Service Manager",
    credentialCandidate: null,
    authAccountExists: true,
    authUid: "oQPfzG2AUgWOo8Tm0LJvurj8dXi2",
    principalId: "45b60e4f-f20f-4915-b9bb-17f851072aa4",
    employeeId: "synthetic-np-emp-service-manager",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
    action: "Owner ruling required, via the existing governed path.",
    note: "`fieldmgr@sandbox.invalid` HAS a credential in the 60-entry file but has NO EOS Principal. It is a different, dead identity — not an alias spelling of devon.fixture@. Using it would authenticate as nobody.",
  },
  {
    slot: "P05",
    persona: "dispatcher",
    label: "Dispatcher",
    credentialCandidate: "dispatcher@sandbox.invalid",
    authAccountExists: true,
    authUid: "PEiRkebIGRPcEau7yBBV0D77Dho1",
    principalId: "18e54b1f-05e1-402d-8982-66efc8393f05",
    employeeId: "synthetic-np-emp-dispatcher",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_CREDENTIAL_EXACT_MATCH",
    action: "NONE. The credential exists and the account holds the live Dispatcher Principal. NEVER ROTATE.",
    note: "CORRECTED 2026-09-25 by Admin SDK enumeration. My earlier row had this backwards, and so did the catalog: uid PEiRkebIGRPcEau7... belongs to `dispatcher@sandbox.invalid`, NOT to `emerson.fixture@sandbox.invalid` (uid NReyNyXVMdVkv75vpmxWuvGUeOm1, no Principal). The catalog named emerson.fixture@ while attributing this uid to it, so P05 resolved to an account with no Principal while the real one went unnamed. emerson.fixture@ is now recorded NOT_CANONICAL_FOR_P05 and is NOT deleted.",
  },
  {
    slot: "P06",
    persona: "technicianAssigned",
    label: "Service Technician — ASSIGNED",
    credentialCandidate: null,
    authAccountExists: true,
    authUid: "i4EYSBGPXPM8lweuhI5a5y2TRgH3",
    principalId: "97652f09-07bf-48e8-90b9-f321a01fe10d",
    employeeId: "synthetic-np-emp-service-technician-a",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
    action: "Owner ruling required, via the existing governed path. NOTHING NEEDS CREATING.",
    note: "P06/P07 ANSWERED: two DISTINCT auth identities with distinct uids, Principals and Employees already exist. The single legacy `tech@sandbox.invalid` credential could not have represented both, but that is moot — neither persona needs it, and neither needs a new account.",
  },
  {
    slot: "P07",
    persona: "technicianUnassigned",
    label: "Service Technician — UNASSIGNED",
    credentialCandidate: null,
    authAccountExists: true,
    authUid: "l2AKXJ44hzUEWpYfEpiQeg208CF2",
    principalId: "728f5b0d-45bf-4708-8624-0864ab19bcab",
    employeeId: "synthetic-np-emp-service-technician-b",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
    action: "Owner ruling required, via the existing governed path. NOTHING NEEDS CREATING.",
    note: "Identical to P06 in Security Role, Job Role and Work Eligibility; the only measured difference is the absence of a record assignment, and exactly one open work_order_assignment now exists and belongs to P06. The pair is genuinely exercisable.",
  },
  {
    slot: "P08",
    persona: "partsAssociate",
    label: "Parts Associate",
    credentialCandidate: null,
    authAccountExists: true,
    authUid: "Ap6MRSs1gKW5lQtN4lTZOaecHgu1",
    principalId: "29ec481c-51a6-468f-831e-5f84308bad0d",
    employeeId: "synthetic-np-emp-parts-associate",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
    action: "Owner ruling required, via the existing governed path.",
    note: "`partsassoc@sandbox.invalid` has a credential and no Principal.",
  },
  {
    slot: "P09",
    persona: "partsManager",
    label: "Parts Manager / Purchasing",
    credentialCandidate: null,
    authAccountExists: true,
    authUid: "p9zXxj5SJiOAwbSoFcKriaQ8NGt1",
    principalId: "68ab4dec-5922-4d0c-954c-5161befe3bd8",
    employeeId: "synthetic-np-emp-parts-manager",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
    action: "Owner ruling required, via the existing governed path.",
    note: "`partsmgr@sandbox.invalid` has a credential and no Principal. Purchasing needs no duplicate login: this Principal holds partsManager + purchasingManager.",
  },
  {
    slot: "P10",
    persona: "warehouseAssociate",
    label: "Warehouse Associate",
    credentialCandidate: null,
    authAccountExists: true,
    authUid: "cgVnRUMA2Sc7WxHl1lgTmbQAhwG2",
    principalId: "65a269d9-86f8-4c7a-b974-436dd6779bbf",
    employeeId: "synthetic-np-emp-warehouse-associate",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
    action: "Owner ruling required, via the existing governed path. NOTHING NEEDS CREATING.",
    note: "P10 ANSWERED: the identity EXISTS. The legacy world had no `whassoc@` at all, so the absence of a credential key is expected and is not evidence the account is missing.",
  },
  {
    slot: "P11",
    persona: "warehouseManager",
    label: "Warehouse Manager",
    credentialCandidate: null,
    authAccountExists: true,
    authUid: "0KBdhU9Z8Yc4aTQqXHODEP1jeHf1",
    principalId: "00e45827-043a-484f-b150-0d8502e8e39f",
    employeeId: "synthetic-np-emp-warehouse-manager",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
    action: "Owner ruling required, via the existing governed path.",
    note: "`whmgr@sandbox.invalid` has a credential and no Principal.",
  },
  {
    slot: "P12",
    persona: "retailSales",
    label: "Retail Sales (primary; retailSalesB is the control)",
    credentialCandidate: null,
    authAccountExists: true,
    authUid: "4OVJwVRisyOlgBQDkjA75rs7djm2",
    principalId: "c117537e-21ac-43e7-a210-b6cfa5323ed6",
    employeeId: "synthetic-np-emp-retail-sales-a",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
    action: "Owner ruling required, via the existing governed path. NOTHING NEEDS CREATING.",
    note: "P12/P13 ANSWERED: THREE distinct salesperson identities already exist — retail-sales-a (this row), retail-sales-b (uid jUzI7OPsdIbJ0WGa2YlYvGUXYKW2, Principal 09aa317f-4cb7-4b90-b675-0ec9db216648) and national-accounts-sales (P13). They map one-to-one. Neither `salesmgr@` nor `mikael@` can serve any of them: both have credentials and no Principal, and all six live sales logins hold `salesperson`, never `salesManager`.",
  },
  {
    slot: "P13",
    persona: "nationalAccountsSales",
    label: "National Accounts Sales",
    credentialCandidate: null,
    authAccountExists: true,
    authUid: "zpfYS0PKUJOwVbskY1WjUreWqg72",
    principalId: "da330746-66c5-4d99-ba94-57f3d241a814",
    employeeId: "synthetic-np-emp-national-accounts-sales",
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_ACCOUNT_BUT_NO_MATCHED_CREDENTIAL",
    action: "Owner ruling required, via the existing governed path.",
    note: "Distinct from P12 in the manifest's Job Role only; there is no PostgreSQL Job Role authority holding the distinction yet.",
  },
  {
    slot: "P14",
    persona: "financeAccounting",
    label: "Finance / Accounting",
    credentialCandidate: "acctmgr@sandbox.invalid",
    authAccountExists: true,
    authUid: "anKfqN34GSS1RKCgF00nWTse6062",
    principalId: null,
    employeeId: null,
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_CREDENTIAL_EXACT_MATCH",
    action: "NONE. Owner ruled the EXISTING account is reused. NEVER ROTATE, and do not create a second finance account beside it.",
    note: "CORRECTED 2026-09-25: I classified this AUTH_ACCOUNT_MISSING, which the Admin SDK disproves — acctmgr@ exists (uid anKfqN34GSS1RKCgF00nWTse6062) and holds a credential. My reasoning rejected it for having no EOS Principal; that fact is unchanged and still means the Employee/Principal chain is a separate governed step, but it was the wrong ground on which to call the ACCOUNT missing. `sage.fixture@sandbox.invalid` — which the manifest declares — does NOT exist in the project and is now recorded SUPERSEDED_FOR_P14.",
  },
  {
    slot: "P15",
    persona: "reporting",
    label: "Reporting / read-only",
    credentialCandidate: "reporting@sandbox.invalid",
    authAccountExists: false,
    authUid: null,
    principalId: null,
    employeeId: null,
    mappingConfidence: "CERTAIN",
    classification: "AUTH_ACCOUNT_MISSING",
    action: "CREATE EXACTLY ONE account for reporting@sandbox.invalid — later, through the governed path, not in this commit. It is the only account this programme creates.",
    note: "CONFIRMED the only genuinely missing account: the Admin SDK found 28 @sandbox.invalid accounts and no reporting address among them. The Owner ruled `reporting@sandbox.invalid` canonical; it is declared in PENDING_ACCOUNT_PERSONAS so the key is reported as declared while loadSandboxPersona still fails closed with PERSONA_ACCOUNT_PENDING. `tatum.fixture@sandbox.invalid` is report-analyst's WORK EMAIL and was never a login. The authority gap is UNCHANGED and is not fixed by creating the account: all three reporting Roles still resolve to ZERO role_capabilities rows in nonprod, so the persona measures nothing until those grants exist.",
  },
  {
    slot: "P16",
    persona: "restricted",
    label: "Restricted / no-authority negative control",
    credentialCandidate: "restricted@sandbox.invalid",
    authAccountExists: true,
    authUid: "lT75guU9mEY46QFQcegWRZRhYBi2",
    principalId: null,
    employeeId: null,
    mappingConfidence: "CERTAIN",
    classification: "EXISTING_CREDENTIAL_EXACT_MATCH",
    action: "NONE. Owner ruled the EXISTING account is reused. NEVER ROTATE, and do not create a second restricted account beside it.",
    note: "CORRECTED 2026-09-25: I classified this AUTH_ACCOUNT_MISSING, which the Admin SDK disproves — restricted@ exists (uid lT75guU9mEY46QFQcegWRZRhYBi2) with a credential. My objection stands as a SEPARATE finding and is not resolved by this row: with no EOS Principal it is refused for having no Principal rather than for holding no authority, so it is not yet the negative control it is meant to be. `wren.fixture@sandbox.invalid` does NOT exist in the project and is now recorded SUPERSEDED_FOR_P16.",
  },
]);

/**
 * THE CREDENTIAL POLICY FOR THE LATER APPLY. Declared here, executed nowhere in this repository.
 *
 * This is the Owner's ruling written as data so it can be ASSERTED. The three sets are disjoint and
 * must together cover all sixteen slots: a persona that appears in none of them, or in two, is a
 * policy that has not actually been decided, and the tests refuse it.
 *
 * `preserveNeverRotate` is the load-bearing one. Every member has a WORKING credential today, and
 * rotating any of them invalidates the Owner's saved copy and every running mission -- the failure
 * that has already happened twice here and surfaces as "invalid password", which sends you
 * debugging the wrong thing. A guard asserts these can never enter the rotation set.
 */
export const CREDENTIAL_POLICY = Object.freeze({
  /** Credential EXISTS and works. Reuse as-is. Never rotate, never recreate. */
  preserveNeverRotate: Object.freeze(["owner", "admin", "dispatcher", "financeAccounting", "restricted"]),
  /** Account exists with a uid matching its live Principal; it has no credential, so a password may be minted. */
  bootstrapAuthorized: Object.freeze([
    "generalManager",
    "serviceManager",
    "technicianAssigned",
    "technicianUnassigned",
    "partsAssociate",
    "partsManager",
    "warehouseAssociate",
    "warehouseManager",
    "retailSales",
    "nationalAccountsSales",
  ]),
  /** The ONE account this programme creates. */
  createOne: Object.freeze(["reporting"]),
  expectedEndState: Object.freeze({
    ready: 16,
    preserved: 5,
    bootstrapped: 10,
    created: 1,
    duplicatePersonaAccountsCreated: 0,
  }),
});

/**
 * The personas a rotation may touch. Derived, never hand-listed, so the preserve set cannot drift
 * into it by someone editing one list and not the other.
 */
export function rotationSet() {
  const preserved = new Set(CREDENTIAL_POLICY.preserveNeverRotate);
  return CREDENTIAL_POLICY.bootstrapAuthorized.filter((p) => !preserved.has(p));
}

/**
 * Classify the catalog against a set of credential-file KEY NAMES.
 *
 * @param {{credentialKeyNames?: Iterable<string>}} input KEY NAMES ONLY — addresses, never values.
 *        Passing anything that is not a string is refused rather than coerced, so a caller cannot
 *        hand this function a `{email: password}` table by accident.
 * @returns rows plus counts. Never a credential, never a length, never a hash.
 */
export function reconcile({ credentialKeyNames = [] } = {}) {
  const keys = new Set();
  for (const k of credentialKeyNames) {
    if (typeof k !== "string") {
      throw new ReconciliationRefusal("KEY_NAMES_ONLY", "credentialKeyNames must be strings; this function never receives credential values");
    }
    keys.add(k.trim().toLowerCase());
  }

  const rows = RECONCILIATION.map((row) => ({
    ...row,
    // An EXACT match is only honoured when the key is ACTUALLY PRESENT in the sources given. The
    // pinned table records which key COULD serve the row; presence is measured, not assumed.
    credentialPresent: row.credentialCandidate ? keys.has(row.credentialCandidate.toLowerCase()) : false,
  }));

  const counts = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0]));
  for (const row of rows) counts[row.classification] += 1;

  return {
    projectId: SANDBOX_PROJECT_ID,
    mode: "DRY_RUN",
    mutations: 0,
    slots: rows.length,
    counts,
    rows,
  };
}

/**
 * The vocabularies this reconciliation had to span, so a reader can see that all four were checked
 * rather than take it on trust.
 */
export function vocabularies() {
  return {
    canonicalKeys: [...CANONICAL_PERSONA_KEYS],
    legacyAliases: { ...PERSONA_ALIASES },
    retiredKeys: Object.keys(RETIRED_PERSONAS),
    unreconciledKeys: Object.keys(UNRECONCILED_PERSONAS),
    mappedAddresses: Object.values(SANDBOX_PERSONAS).sort(),
    slots: RECONCILIATION.map((r) => r.slot),
  };
}

/**
 * COUNTS ONLY, as the deliverable requires. Addresses and uids are identifiers and are safe to
 * print, but this summary deliberately prints neither: a count cannot leak.
 */
export function formatCounts(result) {
  const lines = [
    `project        : ${result.projectId}`,
    `mode           : ${result.mode}   (mutations: ${result.mutations})`,
    `canonical slots: ${result.slots}`,
    "",
  ];
  for (const c of CLASSIFICATIONS) lines.push(`${String(result.counts[c]).padStart(3)}  ${c}`);
  return lines.join("\n");
}

/**
 * ============================ THE DRY-RUN CLI ============================
 *
 * Read-only by construction: it discovers sources, classifies, and prints COUNTS. There is no
 * `--apply`, because there is nothing here to apply. `--project` is required and is fenced twice.
 *
 * `--source <path>` adds an OFF-LOADER path to the discovery sweep. It exists because the whole
 * finding of this lane is that the operator's real file sits somewhere `candidatePaths()` cannot
 * reach, and a reconciliation that could only look where the broken loader looks would reproduce
 * the very false negative it is meant to expose. Sources are reported by key name and count only.
 */
function parseArgv(argv) {
  const out = { sources: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project") out.project = argv[++i];
    else if (a === "--source") out.sources.push(argv[++i]);
    else if (a === "--verbose") out.verbose = true;
  }
  return out;
}

function cli(argv) {
  const args = parseArgv(argv);
  let env;
  try {
    env = assertSandboxTarget(args.project);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const sources = discoverCredentialSources({ extraPaths: args.sources });
  const keyNames = new Set();
  for (const s of sources) for (const k of s.keyNames) keyNames.add(k);

  const result = reconcile({ credentialKeyNames: keyNames });

  console.log(`environment    : ${env.id}`);
  console.log(formatCounts(result));
  console.log("");
  console.log("credential sources (key COUNTS only; no value is read, printed or derived):");
  for (const s of sources) {
    const state = s.present ? (s.parseFailure ? `PRESENT/${s.parseFailure}` : `PRESENT entries=${s.entryCount}`) : "ABSENT";
    console.log(`  [${s.reachableByLoader ? "loader-reachable" : "OFF-LOADER-PATH "}] ${state.padEnd(22)} ${s.path}`);
  }
  const reachable = sources.filter((s) => s.present && s.reachableByLoader).reduce((n, s) => n + s.entryCount, 0);
  const offPath = sources.filter((s) => s.present && !s.reachableByLoader).reduce((n, s) => n + s.entryCount, 0);
  console.log("");
  console.log(`entries reachable by the canonical loader : ${reachable}`);
  console.log(`entries present but OFF the loader's paths: ${offPath}`);
  if (offPath > reachable) {
    console.log("");
    console.log("LOADER REACHABILITY DEFECT: more credentials exist off the loader's candidate paths than on them.");
    console.log("Reading that as credential ABSENCE is what produced the false 'these personas need new passwords'.");
  }
  if (args.verbose) {
    console.log("");
    console.log("per-slot classification (identifiers only):");
    for (const r of result.rows) {
      console.log(`  ${r.slot}  ${String(r.persona).padEnd(22)} ${r.classification}`);
    }
  }
  console.log("");
  console.log("DRY RUN. No account, credential, file or password was created, read for its value, modified or rotated.");
}

// Only when this file IS the entry point, so importing it for tests runs nothing.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  cli(process.argv.slice(2));
}
