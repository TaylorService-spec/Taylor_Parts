// The CANONICAL JOB ROLE vocabulary (Owner ruling 2026-09-25). THE single authoritative list of business
// positions in this system. Sixteen keys, named below, and nothing else is a Job Role.
//
// Pure: no Firebase, no database, no I/O -- the same posture as workEligibilityVocabulary.ts and
// operationalScopeVocabulary.ts, its two sibling authorities. Declaring an entry here grants nothing to
// anyone; it says only that a position by this name exists and may be assigned to an Employee.
//
// ════════════════════ WHY THIS FILE EXISTS ════════════════════
//
// Job Role had TWO catalogs, and the Owner ruled that NEITHER is canonical:
//
//   1  LAUNCH_JOB_ROLES in migration/jobRoleCatalogSeed.ts -- ten entries (EMP-RT-08, ruling 2026-09-16),
//      driven by scripts/jobRoleCatalogSeedCli.js. It named the OWNER position `owner`, fused Parts and
//      Warehouse into one `parts-warehouse` entry, and called Finance `accounting`.
//   2  The tenant catalog declared by scripts/fixtures/sampleCompany.v2.json `jobRoles[]` -- fourteen
//      entries, turned into `createJobRole` steps by scripts/sampleCompany/personaAuthorityDimensions.js.
//      It named `administrator`, `dispatcher` and `finance-manager`.
//
// Ten keys against fourteen, overlapping in seven, agreeing on no single question: what is the Owner
// position called, is Parts one position or four, is Finance a position or a department. Two catalogs
// writing the SAME table (eos_workforce.job_roles) through the SAME governed writer is not redundancy --
// whichever ran last decided what the business's positions were called.
//
// Both now PROJECT from this module. Neither holds a list of its own; see the two projections named under
// EVERY CONSUMER below. After this change it is not possible for the two to produce different Job Role
// universes, because there is only one universe and neither of them owns it.
//
// ════════════════════ WHAT A JOB ROLE IS, AND IS NOT ════════════════════
//
// A Job Role answers ONE question: WHAT IS THIS PERSON'S BUSINESS POSITION? It answers nothing else.
//
//   SECURITY CAPABILITY   may this Principal perform this KIND of action?   eos_policy, checked FIRST
//   WORK ELIGIBILITY      is this Employee QUALIFIED for this work?         workEligibilityVocabulary.ts
//   OPERATIONAL SCOPE     WHERE may this Employee do it?                   operationalScopeVocabulary.ts
//   JOB ROLE              WHAT POSITION does this Employee hold?            this module
//
// A Job Role grants no permission, confers no capability, implies no Work Eligibility, implies no
// Operational Scope, confers no record ownership and is NEVER inferred from a Security Role -- nor is a
// Security Role ever inferred from it.
//
// ════════════════════ A JOB ROLE IS NEVER NAMED FROM SECURITY AUTHORITY ════════════════════
//
// This is the rule that produced most of the ruling's renames, and it is the rule the guard test enforces.
// A position is what the business calls the job; a Security Role is what the platform lets a login do.
// Naming a position after a Security Role makes the two look like one fact, and the next person to read
// `jobRole = technician` will assume a capability they were never granted.
//
// Four terms are refused BY NAME (SECURITY_ROLE_NAMES_REFUSED_AS_JOB_ROLES below):
//
//   administrator      Security authority over the platform. The POSITION is office-administration.
//   reportViewer       a read grant, not a job. The POSITION is reporting-analyst.
//   technician         the compatibility Security Role. The POSITION is service-technician.
//   purchasingManager  purchasing AUTHORITY. It is held BY parts-manager and is not a position of its own.
//
// The ruling's own wording carries this: `office-administration` not `administrator`, `service-technician`
// not `technician`, `owner-executive` not `owner` -- `owner` is a live Security Role key in
// GOVERNED_BUSINESS_ROLES, which is exactly why the Owner position could not keep it.
//
// SEVEN CANONICAL KEYS DO SHARE A STEM with a Security Role key, and that is RULED, not accidental: see
// SECURITY_ROLE_STEMS_SHARED_BY_RULING. The rule is that a Job Role key is never the SAME STRING as a
// Security Role key and is never one of the four refused terms. It is not that a position may not be
// called "Warehouse Manager" because a Role is called `warehouseManager`; Taylor has a warehouse manager.
//
// ════════════════════ WHAT THIS MODULE DOES NOT TOUCH ════════════════════
//
//   NO CAPABILITY CATALOG CHANGE. Job Role carries no PostgreSQL authority: nothing here registers a
//   capability, a grant or a role_capabilities row. Nonprod stays at 79 capabilities / 413
//   role_capabilities. The one capability that governs this vocabulary, `admin.employeeJobRole.write`,
//   already exists and is unchanged.
//
//   NO MIGRATION, NO ROWS. There is no migration in this lane and no catalog row is inserted anywhere.
//   eos_workforce.job_roles holds 0 rows in nonprod (measured 2026-09-24) and eos_workforce
//   .employee_job_role_assignments holds 0, so there is no existing entry for a rename to collide with --
//   which is the only reason a re-naming ruling is expressible as a source change at all.
//
//   THE LIST BELOW IS WHAT WILL BE CREATED LATER, not what exists. Both seed writers are ADD-ONLY: they
//   never rename, deactivate, delete or re-activate an entry, and an existing entry that differs from
//   the ruling is REPORTED for a person to decide. So if a catalog is ever seeded from a pre-ruling
//   revision of either former list, the superseded ids in SUPERSEDED_JOB_ROLE_IDS will be present in the
//   table and NO code will remove them; retiring them would be a separate, reviewed, Owner-authorized act.
//
// ════════════════════ EVERY CONSUMER ════════════════════
//
//   src/eosWorkforce/migration/jobRoleCatalogSeed.ts        LAUNCH_JOB_ROLES  = projection of CANONICAL_JOB_ROLES
//   scripts/sampleCompany/personaAuthorityDimensions.js     createJobRole plan = projection, via lib/
//   scripts/seedSampleCompany.js                            JOB_ROLE_VOCABULARY / MANIFEST_JOB_ROLES = projection
//
// Adding, renaming or removing a key is an Owner ruling, applied HERE and nowhere else, and it moves every
// projection at once. test/canonicalJobRoleVocabulary.test.mjs is what makes that true rather than hoped.

/** The id shape the governed writer (commands/employeeJobRoleCommands.ts) accepts for a catalog entry. */
export const JOB_ROLE_ID_SHAPE = /^[a-z][a-z0-9-]{1,62}$/;

export interface CanonicalJobRole {
  /** The governed catalog id -- eos_workforce.job_roles.id. Lowercase, hyphenated, JOB_ROLE_ID_SHAPE. */
  readonly jobRoleId: string;
  /** eos_workforce.job_roles.display_name. The ruling's own words for the position. Presentation only. */
  readonly displayName: string;
  /**
   * The SCREAMING_SNAKE key the fixture manifests use to REFERENCE a position from an Employee row
   * (sampleCompany.v2.json `employees[].jobRole`). It is the same position under a different spelling, not
   * a second vocabulary: it is derived from jobRoleId and exists only because the manifests were written
   * in that casing before the governed writer existed.
   */
  readonly manifestKey: string;
}

/**
 * THE SIXTEEN. Declared in the ruling's own order so this file reads as the ruling does; the sorted form
 * is CANONICAL_JOB_ROLE_IDS, which is what anything needing a deterministic sequence should use.
 *
 * Each entry is a POSITION someone at Taylor is hired into. The two that are here for reasons worth
 * stating:
 *
 *   office-manager AND office-administration are two positions, not one spelling of one. The office
 *   manager RUNS the office; office administration is the administrative function performed within it.
 *   The second is also what `administrator` becomes, so the pair is what keeps the platform-authority
 *   word out of the vocabulary without losing the position it was standing in for.
 *
 *   general-employee is the position that implies NO business authority -- the P16 negative control's
 *   position. It exists so that "no position" and "a position carrying nothing" stay distinguishable: an
 *   Employee with no Job Role assignment is an unfinished record, an Employee holding general-employee is
 *   a finished record that says this person's position confers nothing.
 */
export const CANONICAL_JOB_ROLES: readonly CanonicalJobRole[] = Object.freeze([
  Object.freeze({ jobRoleId: "owner-executive", displayName: "Owner / Executive", manifestKey: "OWNER_EXECUTIVE" }),
  Object.freeze({ jobRoleId: "general-manager", displayName: "General Manager", manifestKey: "GENERAL_MANAGER" }),
  Object.freeze({ jobRoleId: "office-manager", displayName: "Office Manager", manifestKey: "OFFICE_MANAGER" }),
  Object.freeze({ jobRoleId: "office-administration", displayName: "Office / Administration", manifestKey: "OFFICE_ADMINISTRATION" }),
  Object.freeze({ jobRoleId: "service-manager", displayName: "Service Manager", manifestKey: "SERVICE_MANAGER" }),
  Object.freeze({ jobRoleId: "service-coordinator-dispatcher", displayName: "Service Coordinator / Dispatcher", manifestKey: "SERVICE_COORDINATOR_DISPATCHER" }),
  Object.freeze({ jobRoleId: "service-technician", displayName: "Service Technician", manifestKey: "SERVICE_TECHNICIAN" }),
  Object.freeze({ jobRoleId: "parts-associate", displayName: "Parts Associate", manifestKey: "PARTS_ASSOCIATE" }),
  Object.freeze({ jobRoleId: "parts-manager", displayName: "Parts Manager", manifestKey: "PARTS_MANAGER" }),
  Object.freeze({ jobRoleId: "warehouse-associate", displayName: "Warehouse Associate", manifestKey: "WAREHOUSE_ASSOCIATE" }),
  Object.freeze({ jobRoleId: "warehouse-manager", displayName: "Warehouse Manager", manifestKey: "WAREHOUSE_MANAGER" }),
  Object.freeze({ jobRoleId: "retail-sales", displayName: "Retail Sales", manifestKey: "RETAIL_SALES" }),
  Object.freeze({ jobRoleId: "national-accounts-sales", displayName: "National Accounts Sales", manifestKey: "NATIONAL_ACCOUNTS_SALES" }),
  Object.freeze({ jobRoleId: "finance-accounting", displayName: "Finance / Accounting", manifestKey: "FINANCE_ACCOUNTING" }),
  Object.freeze({ jobRoleId: "reporting-analyst", displayName: "Reporting Analyst", manifestKey: "REPORTING_ANALYST" }),
  Object.freeze({ jobRoleId: "general-employee", displayName: "General Employee", manifestKey: "GENERAL_EMPLOYEE" }),
]);

/** The sixteen ids, SORTED. The deterministic sequence; use this wherever an order must be reproducible. */
export const CANONICAL_JOB_ROLE_IDS: readonly string[] = Object.freeze(
  CANONICAL_JOB_ROLES.map((r) => r.jobRoleId).sort(),
);

/** The sixteen manifest reference keys, SORTED. Same positions, fixture spelling. */
export const CANONICAL_JOB_ROLE_MANIFEST_KEYS: readonly string[] = Object.freeze(
  CANONICAL_JOB_ROLES.map((r) => r.manifestKey).sort(),
);

/** manifestKey -> entry. For resolving a fixture Employee's declared position to its governed catalog id. */
export const CANONICAL_JOB_ROLE_BY_MANIFEST_KEY: Readonly<Record<string, CanonicalJobRole>> = Object.freeze(
  Object.fromEntries(CANONICAL_JOB_ROLES.map((r) => [r.manifestKey, r])),
);

/** jobRoleId -> entry. */
export const CANONICAL_JOB_ROLE_BY_ID: Readonly<Record<string, CanonicalJobRole>> = Object.freeze(
  Object.fromEntries(CANONICAL_JOB_ROLES.map((r) => [r.jobRoleId, r])),
);

export function isCanonicalJobRoleId(value: unknown): boolean {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CANONICAL_JOB_ROLE_BY_ID, value);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RETIRED IDS -- what the two former catalogs called things, and what the ruling calls them now
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Recorded, not deleted, for three uses: reading an audit event or a reason string written before the
// ruling; classifying a row found in eos_workforce.job_roles that a pre-ruling seed created; and
// refusing a superseded id if one is ever passed to a projection.
//
// `replacedBy` holds ONE OR MORE canonical ids because one of the retirements is a SPLIT, not a rename.
// `parts-warehouse` was a single entry covering four distinct positions -- a parts associate and a
// warehouse manager are not the same job, and the fused entry could not say which one an Employee held.
// Writing a 1:1 replacement there would have been a false claim about what the old entry meant.

export interface SupersededJobRole {
  /** Which former catalog the id came from. Both, where both used it. */
  readonly formerCatalogs: readonly string[];
  readonly replacedBy: readonly string[];
  readonly why: string;
}

export const SUPERSEDED_JOB_ROLE_IDS: Readonly<Record<string, SupersededJobRole>> = Object.freeze({
  owner: Object.freeze({
    formerCatalogs: Object.freeze(["jobRoleCatalogSeed.LAUNCH_JOB_ROLES"]),
    replacedBy: Object.freeze(["owner-executive"]),
    why: "`owner` is a live Security Role key in GOVERNED_BUSINESS_ROLES; a position may not be the same string as a Security Role.",
  }),
  "parts-warehouse": Object.freeze({
    formerCatalogs: Object.freeze(["jobRoleCatalogSeed.LAUNCH_JOB_ROLES"]),
    replacedBy: Object.freeze(["parts-associate", "parts-manager", "warehouse-associate", "warehouse-manager"]),
    why: "One entry for four positions. Parts and warehouse work are different jobs and each has its own associate and manager level; the fused entry could not say which position an Employee held.",
  }),
  accounting: Object.freeze({
    formerCatalogs: Object.freeze(["jobRoleCatalogSeed.LAUNCH_JOB_ROLES"]),
    replacedBy: Object.freeze(["finance-accounting"]),
    why: "`accounting` names a department. The position is finance-accounting.",
  }),
  administrator: Object.freeze({
    formerCatalogs: Object.freeze(["sampleCompany.v2.jobRoles"]),
    replacedBy: Object.freeze(["office-administration"]),
    why: "`administrator` is Security authority over the platform, not a business position. The position performed is office administration.",
  }),
  dispatcher: Object.freeze({
    formerCatalogs: Object.freeze(["sampleCompany.v2.jobRoles"]),
    replacedBy: Object.freeze(["service-coordinator-dispatcher"]),
    why: "`dispatcher` is a compatibility Security Role key (COMPATIBILITY_ROLES). The position is service coordinator / dispatcher, which is also what the 2026-09-16 launch catalog called it.",
  }),
  "finance-manager": Object.freeze({
    formerCatalogs: Object.freeze(["sampleCompany.v2.jobRoles"]),
    replacedBy: Object.freeze(["finance-accounting"]),
    why: "`financeManager` is a Security Role key, and the position covers the whole finance / accounting function rather than only its manager.",
  }),
});

/** manifestKey spellings the fixtures used for positions that no longer exist -> the canonical manifestKey. */
export const SUPERSEDED_JOB_ROLE_MANIFEST_KEYS: Readonly<Record<string, string>> = Object.freeze({
  ADMINISTRATOR: "OFFICE_ADMINISTRATION",
  DISPATCHER: "SERVICE_COORDINATOR_DISPATCHER",
  FINANCE_MANAGER: "FINANCE_ACCOUNTING",
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SECURITY BOUNDARY
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The four terms the ruling refuses BY NAME as Job Role keys, whatever casing or hyphenation is used.
 * Each is Security or platform authority; none independently denotes a position someone is hired into.
 * Recorded as the Security Role key spelling, because that is where each one is really defined.
 */
export const SECURITY_ROLE_NAMES_REFUSED_AS_JOB_ROLES: readonly string[] = Object.freeze([
  "administrator",
  "purchasingManager",
  "reportViewer",
  "technician",
]);

/**
 * P09's PURCHASING AUTHORITY IS NOT A POSITION. The parts manager holds `purchasingManager` on top of
 * `partsManager`, and the temptation is to mint a `purchasing-manager` Job Role to match. The ruling
 * refuses it: purchasing is an authority the parts manager is GRANTED, and a Job Role that mirrored it
 * would make the grant look like a consequence of the position. There is one position, parts-manager, and
 * what it may purchase is decided in eos_policy.
 */
export const P09_PURCHASING_AUTHORITY_IS_NOT_A_JOB_ROLE = "parts-manager" as const;

/**
 * The seven canonical ids whose kebab spelling is the same STEM as a Security Role key's camel spelling.
 * Ruled, enumerated, and pinned by the guard test -- so a NEW key that collides with a Security Role stem
 * cannot be added silently; it has to be added to this list, which is a decision someone has to make.
 *
 * Why these are allowed at all: the business genuinely has a general manager, an office manager, a parts
 * manager, a parts associate, a warehouse manager, a warehouse associate and employees with no particular
 * authority. Each term independently denotes a position, which is the ruling's own test. The four refused
 * terms do not: nobody is hired as an "administrator of the access platform" or a "report viewer".
 *
 * `general-employee`/`generalEmployee` is the closest call on this list and is kept for a stated reason:
 * GENERAL_EMPLOYEE_ROLE is the zero-permission Security Role, and "general employee" is also the ordinary
 * English name for the position that carries no business authority. The two agree by coincidence of
 * plainness, not by derivation, and P16's Job Role implies no business authority whether or not any
 * Principal holds that Role -- which matters, because no Principal currently does (defect D-13).
 */
export const SECURITY_ROLE_STEMS_SHARED_BY_RULING: readonly string[] = Object.freeze([
  "general-employee",
  "general-manager",
  "office-manager",
  "parts-associate",
  "parts-manager",
  "warehouse-associate",
  "warehouse-manager",
]);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PERSONA MAPPING (P01-P16)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * EXACTLY ONE Job Role per persona, for all sixteen personas of the census
 * (docs/testing/persona-object-workflow-access-matrix.md; scripts/fixtures/personaBusinessNeeds.v1.json).
 *
 * This is a RULING ABOUT PERSONAS, not a derivation from the fixture. Two places it deliberately differs
 * from what the fixture measures today, and both are the ruling's call rather than a defect to fix here:
 *
 *   P02 is office-administration although the census measured P02's Employee as
 *   `synthetic-np-emp-owner-executive` -- P01 and P02 are ONE Employee in the fixture, which is the
 *   recorded fixture defect the P01/P02 split exists to end. The persona's position is the
 *   administrative one regardless of which Employee currently stands in for it.
 *
 *   P14, P15 and P16 have a position here although P14 and P15 have no Employee and no Principal holder
 *   at all. A position is a business fact about the job; it does not wait for someone to be hired into it.
 *
 * P06 and P07 share service-technician ON PURPOSE. They differ by whether a Work Order is ASSIGNED to
 * them -- a RECORD ASSIGNMENT fact, the fourth authority. Same position, different record relationship.
 *
 * P12 and P13 stay DISTINCT although both hold the identical `salesperson` Security Role. The catalog is
 * the only place that distinction is real: before it, Jules's "National Accounts Manager" was free-text
 * job_title and nothing more. If these two ever collapse into one key, the Security Role becomes the only
 * thing separating retail from national accounts, and it does not separate them at all.
 *
 * P16 implies NO BUSINESS AUTHORITY. general-employee is the position; it is not a reduced version of
 * some other position and it grants nothing -- which is exactly what makes P16 usable as the negative
 * control.
 */
export const CANONICAL_PERSONA_JOB_ROLES: Readonly<Record<string, string>> = Object.freeze({
  P01: "owner-executive",
  P02: "office-administration",
  P03: "general-manager",
  P04: "service-manager",
  P05: "service-coordinator-dispatcher",
  P06: "service-technician",
  P07: "service-technician",
  P08: "parts-associate",
  P09: "parts-manager",
  P10: "warehouse-associate",
  P11: "warehouse-manager",
  P12: "retail-sales",
  P13: "national-accounts-sales",
  P14: "finance-accounting",
  P15: "reporting-analyst",
  P16: "general-employee",
});

/** The persona ids the mapping must cover, in census order. Totality is pinned by the guard test. */
export const CENSUS_PERSONA_IDS: readonly string[] = Object.freeze(
  Array.from({ length: 16 }, (_unused, i) => `P${String(i + 1).padStart(2, "0")}`),
);
