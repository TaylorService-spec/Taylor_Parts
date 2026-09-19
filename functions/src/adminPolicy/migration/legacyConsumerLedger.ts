// The LEGACY operationalRoles RETIREMENT LEDGER -- the fan-in evidence that gates steps I-M.
//
// It lives beside the other migration/retirement evidence (the assignment census, the ConditionKind inventory, the
// effective-access parity proof) rather than under eosWorkforce, because it is not a Workforce runtime concern: it
// spans the Workforce layer, the access catalog and the client, and it must never be imported by any of them.
//
// Pure: no database, no Firebase, no I/O, no scanning. It records one entry per CODE-LEVEL consumer of the three
// legacy fields, and its companion suite derives the real set from the repository and asserts the two correspond in
// BOTH directions. A consumer that appears in the code and not here fails the build; an entry whose file no longer
// contains the term fails it too. The ledger therefore cannot quietly go stale, which is the only property that
// makes it worth having.
//
// ════════════════════ IT EXISTS TO ANSWER ONE QUESTION ════════════════════
//
//   is legacy authority safe to REMOVE yet?
//
// Not to track work. J (retire operationalRoleActive), K (remove Firestore operationalRoles reads) and L (remove the
// Rules dependencies) are each blocked while any consumer they would break is still NOT_STARTED or BLOCKED. That
// computation is `retirementReadiness()` below, and it is the gate -- not a status anybody types.
//
// ════════════════════ WHY 1838 BECAME 28 ════════════════════
//
// The 2026-09-17 census counted 1838 textual references across 267 files. Most are PROSE: the decomposition modules
// say "never inferred from operationalRoles" precisely because they must not read it. Stripping comments leaves the
// consumers that actually execute, which is the only population a retirement gate can reason about. The census is
// not re-run; this is a narrower, mechanically-checked view of the same evidence.
//
// ════════════════════ THE CLASSIFICATIONS ════════════════════
//
// The first five are the Owner's: what the consumer is really asking.
//
//   SECURITY_AUTHORIZATION   "may this Principal invoke this?"     -> capability. The only one that is security.
//   WORK_ELIGIBILITY         "is this Employee qualified?"         -> eos_workforce.employee_work_eligibility
//   OPERATIONAL_SCOPE        "where may this Employee work?"       -> eos_workforce.employee_operational_scopes
//   DISPLAY_PERSONA          presentation only, grants nothing     -> Job Role, plus capabilities for visibility
//   DEAD_LEGACY              reachable by nothing; delete it
//
// MIGRATION_EVIDENCE is a SIXTH, and it is not an Owner classification -- it is the distinction the retirement gate
// needs. Those modules do not consume legacy AUTHORITY; they read the legacy field as EVIDENCE, which is exactly
// what steps D/E were built to do. They must SURVIVE J and K and are removed only when the legacy field itself is
// finally dropped. Classifying them as consumers would block retirement on the very tooling that enables it.
export const CONSUMER_CLASSIFICATIONS = Object.freeze([
  "SECURITY_AUTHORIZATION", "WORK_ELIGIBILITY", "OPERATIONAL_SCOPE", "DISPLAY_PERSONA", "DEAD_LEGACY",
  "MIGRATION_EVIDENCE",
] as const);
export type ConsumerClassification = (typeof CONSUMER_CLASSIFICATIONS)[number];

export const CONSUMER_STATUSES = Object.freeze(["NOT_STARTED", "CONVERTED", "DEAD", "BLOCKED"] as const);
export type ConsumerStatus = (typeof CONSUMER_STATUSES)[number];

/**
 * What makes a file a consumer.
 *
 * TWO kinds of dependency, because tracking only the first under-reports the surface. A consumer can depend on the
 * legacy VALUES without ever naming the FIELD -- it receives `PARTS_ASSOCIATE` through a parameter and filters on
 * it. The entire live assignable-Employee path does exactly that, so a field-name-only ledger would have missed the
 * very family step G converts.
 *
 *   FIELD names   the stored legacy data itself. These block K (removing the Firestore reads).
 *   VALUE names   the legacy vocabulary and its constants. These outlive the reads and retire with the vocabulary.
 *
 * Matched on WORD BOUNDARIES, never as substrings: `OPERATIONAL_ROLE_VALUES` is its own identifier and must not be
 * counted as a use of `OPERATIONAL_ROLE`, or the ledger would attribute a dependency the file does not have.
 */
export const LEGACY_FIELD_TERMS = Object.freeze(["operationalRoles", "operationalRoleActive", "assignedWarehouseIds"] as const);
export const LEGACY_VALUE_TERMS = Object.freeze(["OPERATIONAL_ROLES", "OPERATIONAL_ROLE", "operationalRoleLabel"] as const);
export const LEGACY_TERMS = Object.freeze([...LEGACY_FIELD_TERMS, ...LEGACY_VALUE_TERMS] as const);
export type LegacyTerm = (typeof LEGACY_TERMS)[number];
const FIELD_TERMS = new Set<string>(LEGACY_FIELD_TERMS);

export interface LedgerEntry {
  /** Repository-relative path. */
  readonly path: string;
  /** What this file does with the legacy field, in one line. */
  readonly consumer: string;
  readonly terms: readonly LegacyTerm[];
  readonly classification: ConsumerClassification;
  /** The governed authority that replaces it, or null when nothing replaces it (DEAD / MIGRATION_EVIDENCE). */
  readonly replacementAuthority: string | null;
  /** The PR that converted it, or null while unconverted. */
  readonly replacementPr: string | null;
  readonly status: ConsumerStatus;
  /** Required when BLOCKED, forbidden otherwise. A blocked entry must say what blocks it. */
  readonly blockedReason: string | null;
}

const entry = (e: LedgerEntry): LedgerEntry => Object.freeze(e);

const CAPABILITY = "eos_policy capability (security capability remains the FIRST boundary)";
const ELIGIBILITY = "eos_workforce.employee_work_eligibility (step A/C)";
const SCOPE = "eos_workforce.employee_operational_scopes (step B/C)";
const JOB_ROLE = "eos_workforce.job_roles (EMP-RT-08) for persona; capabilities for action visibility";

/**
 * Every code-level consumer, comments excluded.
 *
 * Ordered by path so a diff is readable. Status is the CURRENT truth: almost everything is NOT_STARTED, because
 * steps A-E built authorities and tooling and converted no consumer. Claiming otherwise is the failure mode this
 * ledger exists to prevent.
 */
export const LEGACY_CONSUMER_LEDGER: readonly LedgerEntry[] = Object.freeze([
  // ── the Condition plumbing: step J retires this whole family together ──
  entry({
    path: "functions/src/types/access.ts", consumer: "declares the operationalRoleActive ConditionKind",
    terms: ["operationalRoleActive"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: `${ELIGIBILITY} + ${SCOPE}`, replacementPr: null, status: "BLOCKED",
    blockedReason: "the Kind is still carried by technician's seven Reorder grants; removing it first would fail them closed",
  }),
  entry({
    path: "field-ops-app-vite/src/types/access.ts", consumer: "the client mirror of the ConditionKind union",
    terms: ["operationalRoleActive"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: `${ELIGIBILITY} + ${SCOPE}`, replacementPr: null, status: "BLOCKED",
    blockedReason: "mirrors functions/src/types/access.ts and retires with it",
  }),
  entry({
    path: "functions/src/access/resolveEffectivePermission.ts", consumer: "evaluates the operationalRoleActive branch",
    terms: ["operationalRoleActive"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: `${ELIGIBILITY} + ${SCOPE}`, replacementPr: null, status: "BLOCKED",
    blockedReason: "the evaluator must keep answering while any Role still carries the Kind",
  }),
  entry({
    path: "field-ops-app-vite/src/access/resolveEffectivePermission.ts", consumer: "the client mirror of the evaluator",
    terms: ["operationalRoleActive"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: `${ELIGIBILITY} + ${SCOPE}`, replacementPr: null, status: "BLOCKED",
    blockedReason: "mirrors the server evaluator and retires with it",
  }),
  entry({
    path: "functions/src/access/compatibilityRoles.ts",
    consumer: "attaches operationalRoleActive(PARTS_ASSOCIATE) to technician's seven Reorder grants",
    terms: ["operationalRoleActive"], classification: "WORK_ELIGIBILITY",
    replacementAuthority: `${CAPABILITY} + ${ELIGIBILITY} (WAREHOUSE_OPERATIONS)`, replacementPr: null, status: "NOT_STARTED",
    blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/access/compatibilityRoles.ts", consumer: "the client mirror of those grants",
    terms: ["operationalRoleActive"], classification: "WORK_ELIGIBILITY",
    replacementAuthority: `${CAPABILITY} + ${ELIGIBILITY} (WAREHOUSE_OPERATIONS)`, replacementPr: null, status: "NOT_STARTED",
    blockedReason: null,
  }),
  entry({
    path: "functions/src/access/operationalRoleContext.ts",
    consumer: "builds the operationalRoleActive resolver from an Employee's operationalRoles",
    terms: ["operationalRoles"], classification: "WORK_ELIGIBILITY",
    replacementAuthority: ELIGIBILITY, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "functions/src/access/effectiveAccessFeed.ts", consumer: "supplies the resolver to the effective-access feed",
    terms: ["operationalRoleActive"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: `${CAPABILITY} + ${ELIGIBILITY}`, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "functions/src/finance/financeReadCallables.ts",
    consumer: "supplies the resolver to resolveEffectivePermission for Finance reads",
    terms: ["operationalRoleActive"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: CAPABILITY, replacementPr: null, status: "NOT_STARTED",
    blockedReason: null,
  }),
  entry({
    path: "functions/src/reorderRequest/reorderWarehouseAuthority.ts",
    // R-32, CONFIRMED MECHANICALLY: this file names assignedWarehouseIds only in prose, to record that it is NOT
    // read. The derivation strips comments, so the absence is evidence rather than a claim -- the warehouse question
    // is already answered by a location-scoped assignment, and only the PARTS_ASSOCIATE eligibility arm is legacy.
    consumer: "supplies the operationalRoleActive resolver; the WAREHOUSE question is already location-scoped assignment (R-32)",
    terms: ["operationalRoleActive"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: `${CAPABILITY} with location-scoped assignment + ${ELIGIBILITY} for the PARTS_ASSOCIATE arm`,
    replacementPr: null, status: "NOT_STARTED",
    blockedReason: null,
  }),
  entry({
    path: "functions/src/access/parityFixtures.ts", consumer: "parity fixtures exercising the Condition",
    terms: ["operationalRoleActive"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: `${ELIGIBILITY} + ${SCOPE}`, replacementPr: null, status: "BLOCKED",
    blockedReason: "fixtures must keep proving current behaviour until the Condition itself retires",
  }),
  entry({
    path: "field-ops-app-vite/src/access/parityFixtures.ts", consumer: "the client mirror of those fixtures",
    terms: ["operationalRoleActive"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: `${ELIGIBILITY} + ${SCOPE}`, replacementPr: null, status: "BLOCKED",
    blockedReason: "mirrors the server fixtures and retires with them",
  }),

  // ── the client session carrying the legacy claim: step K ──
  entry({
    path: "field-ops-app-vite/src/auth/employeeSessionResult.js", consumer: "carries operationalRoles into the session result",
    terms: ["operationalRoles"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: `${CAPABILITY} via readMyWorkforceCapabilities; ${ELIGIBILITY} for qualification`,
    replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/auth/AuthContext.jsx", consumer: "holds operationalRoles in React auth state",
    terms: ["operationalRoles"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: `${CAPABILITY} via readMyWorkforceCapabilities; ${ELIGIBILITY} for qualification`,
    replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/App.jsx", consumer: "builds operationalContext from the session for navigation gating",
    terms: ["operationalRoles"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: CAPABILITY, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/navigation/navConfig.js",
    consumer: "gates navigation entries on operationalRoles membership, against the OPERATIONAL_ROLE constants",
    terms: ["operationalRoles", "OPERATIONAL_ROLE"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: CAPABILITY, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/shared/inventory/RequestReorderControl.jsx",
    consumer: "shows the reorder control when operationalRoles holds PARTS_MANAGER or WAREHOUSE_MANAGER",
    terms: ["operationalRoles", "OPERATIONAL_ROLE"], classification: "SECURITY_AUTHORIZATION",
    replacementAuthority: CAPABILITY, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),

  // ── the assignable-Employee query: step G ──
  entry({
    path: "field-ops-app-vite/src/domain/employees.js",
    consumer: "buildAssignableEmployeesQuery filters Firestore employees by array-contains operationalRoles",
    terms: ["operationalRoles"], classification: "WORK_ELIGIBILITY",
    replacementAuthority: `${ELIGIBILITY} + eligible employment status, read from PostgreSQL`,
    replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/shared/assignment/EmployeeAssignmentPicker.jsx",
    consumer: "renders each candidate's operationalRoles and passes the required one through",
    terms: ["operationalRoles"], classification: "DISPLAY_PERSONA",
    replacementAuthority: JOB_ROLE, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),

  // ── presentation only: step H ──
  entry({
    path: "field-ops-app-vite/src/domain/dashboardComposition.js", consumer: "hasOperationalRole() composes dashboard cards",
    terms: ["operationalRoles"], classification: "DISPLAY_PERSONA",
    replacementAuthority: JOB_ROLE, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/modules/dashboard/MyDashboard.jsx", consumer: "passes operationalRoles into dashboard composition",
    terms: ["operationalRoles"], classification: "DISPLAY_PERSONA",
    replacementAuthority: JOB_ROLE, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/modules/technicianDashboard/TechnicianDashboard.jsx",
    consumer: "reads operationalRoles for the technician persona view",
    terms: ["operationalRoles"], classification: "DISPLAY_PERSONA",
    replacementAuthority: JOB_ROLE, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/domain/employeeProfile.js",
    consumer: "legacy Employee profile field list, OPERATIONAL_ROLES vocabulary and operationalRoleLabel rendering",
    terms: ["operationalRoles", "OPERATIONAL_ROLES", "operationalRoleLabel"], classification: "DISPLAY_PERSONA",
    replacementAuthority: JOB_ROLE, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/metadata/definitions/employee.js",
    consumer: "Employee metadata definition naming the legacy field and its OPERATIONAL_ROLES vocabulary",
    terms: ["operationalRoles", "OPERATIONAL_ROLES"], classification: "DISPLAY_PERSONA",
    replacementAuthority: JOB_ROLE, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "functions/src/access/employeeProfileCommands.ts",
    consumer: "declares OPERATIONAL_ROLE_VALUES and the OPERATIONAL_ROLES field-kind used to validate legacy writes",
    terms: ["operationalRoles", "OPERATIONAL_ROLES"], classification: "DISPLAY_PERSONA",
    replacementAuthority: JOB_ROLE, replacementPr: null, status: "BLOCKED",
    blockedReason: "the vocabulary is still the census's and the ledger's own reference list; it retires last",
  }),

  // ── the legacy VALUE vocabulary and the assignable-Employee path that consumes it ──
  //
  // These name the legacy VALUES without naming the field. The whole live assignable-Employee surface is here, and
  // every live caller asks for PARTS_ASSOCIATE -- there is NO live SERVICE_TECHNICIAN eligibility consumer, which
  // is why the Parts/warehouse family is the first real conversion target and the Service family is persona only.
  entry({
    path: "field-ops-app-vite/src/domain/constants.js", consumer: "declares the OPERATIONAL_ROLE value constants",
    terms: ["OPERATIONAL_ROLE"], classification: "DISPLAY_PERSONA",
    replacementAuthority: JOB_ROLE, replacementPr: null, status: "BLOCKED",
    blockedReason: "the value constants are what every unconverted consumer below still imports; they retire last",
  }),
  entry({
    path: "field-ops-app-vite/src/domain/employeeVocabulary.js",
    consumer: "declares OPERATIONAL_ROLES and their display labels for the legacy Employee record",
    terms: ["OPERATIONAL_ROLES", "operationalRoleLabel"], classification: "DISPLAY_PERSONA",
    replacementAuthority: JOB_ROLE, replacementPr: null, status: "BLOCKED",
    blockedReason: "the write-time vocabulary and its labels retire with the legacy field, after K",
  }),
  entry({
    path: "field-ops-app-vite/src/hooks/useAssignableEmployees.js",
    consumer: "the assignable-Employee hook, filtered by requiredOperationalRole",
    terms: ["OPERATIONAL_ROLE"], classification: "WORK_ELIGIBILITY",
    replacementAuthority: `${ELIGIBILITY} + eligible employment status, read from PostgreSQL`,
    replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/shared/reorder/ManagerQueuePanel.jsx",
    consumer: "asks the picker for PARTS_ASSOCIATE candidates to assign a reorder request",
    terms: ["OPERATIONAL_ROLE"], classification: "WORK_ELIGIBILITY",
    replacementAuthority: `${ELIGIBILITY} (WAREHOUSE_OPERATIONS) + eligible employment status`,
    replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/modules/inventoryRole/PartsManagerHome.jsx",
    consumer: "asks the assignable-Employee hook for PARTS_ASSOCIATE candidates",
    terms: ["OPERATIONAL_ROLE"], classification: "WORK_ELIGIBILITY",
    replacementAuthority: `${ELIGIBILITY} (WAREHOUSE_OPERATIONS) + eligible employment status`,
    replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "field-ops-app-vite/src/modules/inventory/PartDetail.jsx",
    consumer: "passes PARTS_ASSOCIATE to the assignment picker on the Part record",
    terms: ["OPERATIONAL_ROLE"], classification: "WORK_ELIGIBILITY",
    replacementAuthority: `${ELIGIBILITY} (WAREHOUSE_OPERATIONS) + eligible employment status`,
    replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),

  // ── migration EVIDENCE: survives J and K by design ──
  entry({
    path: "functions/src/eosWorkforce/migration/partsAssignabilityExclusion.ts",
    consumer: "measures what the legacy securityRole == technician picker filter excludes, for the Owner ruling",
    terms: ["operationalRoles"], classification: "MIGRATION_EVIDENCE",
    replacementAuthority: null, replacementPr: null, status: "BLOCKED",
    blockedReason: "LEGACY_SEMANTIC_CONFLICT: the filter is neither ported nor dropped until the Owner rules on it",
  }),
  entry({
    path: "functions/src/adminPolicy/migration/conditionKindInventory.ts",
    // Both names appear in its RULING STRINGS -- the dispositions cite the decomposition by name. Strings are code
    // to the derivation, correctly: a rationale is shipped text, not a comment, so the ledger must account for it.
    consumer: "classifies the live ConditionKinds, naming them as vocabulary rather than reading either field",
    terms: ["operationalRoles", "operationalRoleActive"], classification: "MIGRATION_EVIDENCE",
    replacementAuthority: null, replacementPr: "#1950", status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "functions/src/eosWorkforce/migration/employeeProfileSnapshot.ts",
    consumer: "counts operationalRoles in the export census and never copies it",
    terms: ["operationalRoles"], classification: "MIGRATION_EVIDENCE",
    replacementAuthority: null, replacementPr: null, status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "functions/src/eosWorkforce/migration/legacyWorkforceEvidence.ts",
    consumer: "classifies legacy operationalRoles values for the step D/E dry-run plan",
    terms: ["operationalRoles"], classification: "MIGRATION_EVIDENCE",
    replacementAuthority: null, replacementPr: "#1949", status: "NOT_STARTED", blockedReason: null,
  }),
  entry({
    path: "functions/src/eosWorkforce/operationalScopeVocabulary.ts",
    consumer: "names assignedWarehouseIds as the sole admissible scope evidence",
    terms: ["assignedWarehouseIds"], classification: "MIGRATION_EVIDENCE",
    replacementAuthority: null, replacementPr: "#1947", status: "NOT_STARTED", blockedReason: null,
  }),
]);

export interface RetirementGate {
  readonly step: "I" | "J" | "K";
  readonly ready: boolean;
  /** The entries that must reach CONVERTED or DEAD first. Empty exactly when `ready`. */
  readonly blockedBy: readonly string[];
}

const settled = (e: LedgerEntry) => e.status === "CONVERTED" || e.status === "DEAD";

/**
 * Which retirement steps the evidence currently permits.
 *
 * I  delete dead consumers      -- always available, but only for entries actually proven DEAD.
 * J  retire operationalRoleActive -- every consumer of that Kind must be settled first.
 * K  remove Firestore operationalRoles reads -- every consumer of that FIELD must be settled, EXCEPT the migration
 *    evidence, which reads the legacy export rather than the live path and is removed with the field itself.
 *
 * L (Firestore Rules) and M (the Firebase Exit baseline) are not computed here: Rules are not a code consumer this
 * ledger can scan, and M is a whole-repository proof. They remain gated behind K.
 */
export function retirementReadiness(ledger: readonly LedgerEntry[] = LEGACY_CONSUMER_LEDGER): readonly RetirementGate[] {
  const blocking = (predicate: (e: LedgerEntry) => boolean) =>
    ledger.filter((e) => predicate(e) && e.classification !== "MIGRATION_EVIDENCE" && !settled(e)).map((e) => e.path).sort();
  const j = blocking((e) => e.terms.includes("operationalRoleActive"));
  // K removes the Firestore READS, so only a FIELD-name consumer blocks it. A file that merely knows the legacy
  // vocabulary reads nothing and retires with the vocabulary, after K.
  const k = blocking((e) => e.terms.includes("operationalRoles") && FIELD_TERMS.has("operationalRoles"));
  return Object.freeze([
    Object.freeze({ step: "I" as const, ready: true, blockedBy: Object.freeze([]) }),
    Object.freeze({ step: "J" as const, ready: j.length === 0, blockedBy: Object.freeze(j) }),
    Object.freeze({ step: "K" as const, ready: k.length === 0, blockedBy: Object.freeze(k) }),
  ]);
}
