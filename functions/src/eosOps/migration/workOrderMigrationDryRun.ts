// THE WORK ORDER MIGRATION DRY RUN -- pure classification core.
//
// ════════════════════ WHAT THIS IS ════════════════════
//
// workOrderFieldParityMatrix.ts says WHERE each legacy fact belongs in the target model. That is a
// different question from WHAT THE MIGRATION DOES WITH IT, and conflating the two is how a parity
// document gets mistaken for migration tooling. This module answers the second question, per RECORD and
// per FIELD, and it answers it from the matrix rather than restating the matrix -- so a field cannot be
// dispositioned here in a way that contradicts where the model says it lives.
//
// PURE. No Firebase, no PostgreSQL, no I/O, no clock, no randomness. It takes plain source documents and
// returns a report. That is what makes the classification testable against adversarial fixtures rather
// than only against whatever sandbox happens to contain today.
//
// IT WRITES NOTHING, and there is no code path here that could: no client, no pool, no `set`, no `INSERT`.
//
// ════════════════════ THE RULE THAT SHAPES EVERYTHING ELSE ════════════════════
//
// NO SILENT DEFAULT. Every record ends in exactly one of COPYABLE / EXCLUDED_WITH_EVIDENCE / BLOCKED, and
// every governed field ends in exactly one disposition. Where evidence is absent the answer is a BLOCKER
// naming what is missing -- never a guess that happens to satisfy a NOT NULL column. A migration that
// invents the facts its target requires produces a database that is full and wrong.
import { WORK_ORDER_FIELD_PARITY_MATRIX, type WorkOrderFieldParity } from "./workOrderFieldParityMatrix.js";

// ════════════════════ vocabulary ════════════════════

/** What the migration DOES with one field. */
export const FIELD_ACTIONS = Object.freeze([
  "COPY", "DERIVE", "HISTORICAL_ONLY", "INTENTIONALLY_RETIRED", "BLOCKER",
] as const);
export type FieldAction = (typeof FIELD_ACTIONS)[number];

/** Exactly one per source record. */
export const RECORD_RESULTS = Object.freeze([
  "COPYABLE", "EXCLUDED_WITH_EVIDENCE", "BLOCKED",
] as const);
export type RecordResult = (typeof RECORD_RESULTS)[number];

export const BLOCKER_KINDS = Object.freeze([
  "OPERATING_COMPANY_UNRESOLVED",
  "WORK_ORDER_TYPE_REQUIRES_RESOLUTION",
  "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED",
  "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION",
  "TARGET_CONFLICT",
  "REFERENCE_NOT_FOUND",
  "OTHER",
] as const);
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

export const RECORD_CLASSES = Object.freeze([
  "BUSINESS", "SANDBOX_FIXTURE", "CERTIFICATION_FIXTURE", "OTHER_NONBUSINESS_EVIDENCE",
] as const);
export type RecordClass = (typeof RECORD_CLASSES)[number];

/**
 * THE TARGET'S OWN NUMBER CONSTRAINT, restated from migration 1761004800000
 * (`work_order_number_format`). Native rows stay constrained to this; a historical record that does not
 * match is NEVER renumbered -- it is reported as requiring a migration-compatibility decision.
 */
export const NATIVE_WORK_ORDER_NUMBER = /^WO-[0-9]{4}-[0-9]{6,}$/;

/** The target's governed type vocabulary (`ops_work_order_type`). */
export const TARGET_WORK_ORDER_TYPES: readonly string[] =
  Object.freeze(["SERVICE_CALL", "PM", "INSTALL", "WARRANTY", "INSPECTION"]);

/** The target's governed severity vocabulary (`ops_work_order_severity`). */
export const TARGET_SEVERITIES: readonly string[] =
  Object.freeze(["EQUIPMENT_DOWN", "PARTIAL_OPERATION", "COSMETIC", "PREVENTIVE"]);

/** Terminal statuses -- the SAME three the transition engine calls terminal. */
export const TERMINAL_STATUSES: readonly string[] = Object.freeze(["COMPLETED", "CLOSED", "CANCELLED"]);

// ════════════════════ fixture families, declared from repository evidence ════════════════════

/**
 * A NONBUSINESS FAMILY IS PROVEN, NEVER ASSUMED.
 *
 * "SBX" and "C" are not evidence -- they are a naming coincidence, and a user could type either into a
 * real Work Order. Each family below names the repository file that AUTHORS it and the markers that file
 * deterministically writes, and a record is excluded only when EVERY marker agrees:
 *
 *   * the document id shape the seeder uses
 *   * the exact `scenarioId` it stamps
 *   * the woNumber shape it composes
 *   * the type it authors
 *
 * ONE DIVERGED OCCUPANT REFUSES THE WHOLE FAMILY. If any record matches the number shape but not the
 * other markers, someone edited a fixture or wrote a real Work Order that looks like one, and excluding
 * the family would silently drop a genuine business record. The family is then reported as
 * FIXTURE_EXCLUSION_REFUSED and every member falls back to BUSINESS -- the fail-closed direction, because
 * a business record wrongly migrated can be corrected and a business record wrongly DROPPED cannot.
 */
export interface FixtureFamily {
  readonly key: string;
  readonly recordClass: RecordClass;
  readonly authoredBy: string;
  readonly scenarioId: string;
  readonly idPattern: RegExp;
  readonly numberPattern: RegExp;
  readonly authoredType: string;
  readonly reason: string;
}

export const FIXTURE_FAMILIES: readonly FixtureFamily[] = Object.freeze([
  Object.freeze({
    key: "SBX-SCN-001",
    recordClass: "SANDBOX_FIXTURE" as RecordClass,
    authoredBy: "functions/scripts/seedSandboxTransactional.js",
    scenarioId: "SBX-SCN-001",
    idPattern: /^wo-sbx-[0-9]{3}$/,
    numberPattern: /^WO-[0-9]{4}-SBX[0-9]{3}$/,
    authoredType: "SERVICE",
    reason:
      "Authored by the sandbox TRANSACTIONAL operating pack. The seeder composes the number as "
      + "`WO-${YEAR}-SBX${n padded to 3}`, writes document ids `wo-sbx-NNN`, and stamps scenarioId "
      + "SBX-SCN-001 on every record. Synthetic operating evidence for a scenario, not customer work.",
  }),
  Object.freeze({
    key: "SBX-SCN-002",
    recordClass: "SANDBOX_FIXTURE" as RecordClass,
    authoredBy: "functions/scripts/seedSandboxCoordinatedInstall.js",
    scenarioId: "SBX-SCN-002",
    idPattern: /^wo-c713-[0-9]+$/,
    numberPattern: /^WO-[0-9]{4}-C713[0-9]{2}$/,
    authoredType: "INSTALL",
    reason:
      "Authored by the sandbox COORDINATED INSTALL pack: five identical units, one customer, one site, "
      + "one install day. The seeder composes `WO-${YEAR}-C713${n padded to 2}`, writes ids `wo-c713-N`, "
      + "and stamps scenarioId SBX-SCN-002. The 'C' is a MODEL NUMBER (Arctic C713), not a classification.",
  }),
]);

// ════════════════════ source shapes ════════════════════

/** One source Work Order, as read. Unknown fields are carried for fingerprinting, never interpreted. */
export interface SourceWorkOrder {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/** The exact supporting facts needed to CLASSIFY -- nothing broader. */
export interface SupportingEvidence {
  /** technician id -> { exists, employeeId }. Absent key means no technician document at all. */
  readonly technicians: ReadonlyMap<string, { readonly employeeId: string | null }>;
  /** governed Employee ids that actually exist. */
  readonly employees: ReadonlySet<string>;
  /** sales order id -> { exists, operatingCompanyId }. */
  readonly salesOrders: ReadonlyMap<string, { readonly operatingCompanyId: string | null }>;
  readonly accounts: ReadonlySet<string>;
  readonly locations: ReadonlySet<string>;
  readonly equipment: ReadonlySet<string>;
  /**
   * Owner-authored resolutions, VALIDATED. The tool never creates one: it may only consume a manifest a
   * human wrote and this snapshot accepted. Absent is the normal state and produces blockers, which is
   * the point. Deliberately the ONLY manifest channel -- a second, unvalidated one would be a way for a
   * decision to arrive without passing the refusals.
   */
  readonly resolutionManifest?: ValidatedManifest | null;
  /** Target ids already present, when the target was readable. `null` = target unreadable. */
  readonly targetWorkOrderIds?: ReadonlySet<string> | null;
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

// ════════════════════ fixture classification ════════════════════

export interface FamilyVerdict {
  readonly key: string;
  readonly recordClass: RecordClass;
  readonly authoredBy: string;
  readonly reason: string;
  readonly excluded: boolean;
  readonly memberIds: readonly string[];
  readonly divergedIds: readonly string[];
  /** Set when a candidate matched the NUMBER but not every other marker. */
  readonly refusalReason: string | null;
}

/**
 * Decide each declared family, from evidence only.
 *
 * A record is a CANDIDATE if it matches the family's number pattern. It is a MEMBER only if the id,
 * scenarioId and authored type all agree too. Any candidate that is not a member is a DIVERGENCE, and one
 * divergence refuses the family.
 */
export function classifyFixtureFamilies(
  records: readonly SourceWorkOrder[],
  families: readonly FixtureFamily[] = FIXTURE_FAMILIES,
): readonly FamilyVerdict[] {
  return Object.freeze(families.map((family) => {
    const candidates = records.filter((r) => family.numberPattern.test(String(r.data.woNumber ?? "")));
    const members: string[] = [];
    const diverged: string[] = [];
    for (const record of candidates) {
      const agrees =
        family.idPattern.test(record.id) &&
        text(record.data.scenarioId) === family.scenarioId &&
        text(record.data.type) === family.authoredType;
      (agrees ? members : diverged).push(record.id);
    }
    const excluded = diverged.length === 0 && members.length > 0;
    return Object.freeze({
      key: family.key,
      recordClass: family.recordClass,
      authoredBy: family.authoredBy,
      reason: family.reason,
      excluded,
      memberIds: Object.freeze(members.sort()),
      divergedIds: Object.freeze(diverged.sort()),
      refusalReason: diverged.length > 0
        ? `FIXTURE_EXCLUSION_REFUSED: ${diverged.length} record(s) carry this family's number shape but not its `
          + "authored id / scenarioId / type. A diverged or user-authored occupant means the family cannot be "
          + "excluded wholesale, so every member is treated as BUSINESS."
        : members.length === 0 ? "no record matches this family's number shape" : null,
    });
  }));
}

// ════════════════════ operating company ════════════════════

export type OperatingCompanyStatus = "EXACT_SOURCE_EVIDENCE" | "EXPLICIT_RESOLUTION_REQUIRED";

export interface OperatingCompanyResolution {
  readonly workOrderId: string;
  readonly resolutionStatus: OperatingCompanyStatus;
  readonly evidenceKind: string;
  readonly resolvedOperatingCompanyKey: string | null;
}

/**
 * Resolve the operating company from GOVERNED EVIDENCE ONLY.
 *
 * ownershipMatrix.ts already ruled this family: `fieldops_wos` has `ownerFields: []` -- no company storage
 * at all -- with `unresolvedPolicy: "remains OWNERLESS -- NO_GOVERNED_COMPANY_SOURCE"`, and it names
 * exactly ONE governed upstream: "a governed upstream source that already carries one (e.g. a Sales
 * Order)". So there are exactly two ways to an answer, in order:
 *
 *   1. the record's own stored company, if the model ever grows one
 *   2. the Sales Order it descends from, IF that Sales Order carries a governed company
 *
 * and one way to no answer, which is the common one. NOTHING ELSE IS TRIED. Not the warehouse, not the
 * account, not the location, not the technician, not a tenant default -- the matrix names those as
 * precisely what must not decide it, and "Taylor is the only company anyone has mentioned" is the
 * inference that makes a multi-company platform silently wrong.
 *
 * The manifest is consulted LAST and only reports what a human already decided; this function never
 * writes one.
 */
export function resolveOperatingCompany(
  record: SourceWorkOrder,
  evidence: SupportingEvidence,
): OperatingCompanyResolution {
  const stored = text(record.data.operatingCompanyId) ?? text(record.data.operatingCompanyKey);
  if (stored) {
    return Object.freeze({
      workOrderId: record.id, resolutionStatus: "EXACT_SOURCE_EVIDENCE" as const,
      evidenceKind: "WORK_ORDER_STORED_COMPANY", resolvedOperatingCompanyKey: stored,
    });
  }
  const salesOrderId = text(record.data.salesOrderId);
  if (salesOrderId) {
    const upstream = evidence.salesOrders.get(salesOrderId);
    const company = upstream ? text(upstream.operatingCompanyId) : null;
    if (company) {
      return Object.freeze({
        workOrderId: record.id, resolutionStatus: "EXACT_SOURCE_EVIDENCE" as const,
        evidenceKind: "GOVERNED_UPSTREAM_SALES_ORDER", resolvedOperatingCompanyKey: company,
      });
    }
  }
  const manifest = evidence.resolutionManifest?.byWorkOrderId.get(record.id)?.operatingCompanyId ?? null;
  if (manifest) {
    return Object.freeze({
      workOrderId: record.id, resolutionStatus: "EXACT_SOURCE_EVIDENCE" as const,
      evidenceKind: "OWNER_AUTHORED_RESOLUTION_MANIFEST", resolvedOperatingCompanyKey: manifest,
    });
  }
  return Object.freeze({
    workOrderId: record.id, resolutionStatus: "EXPLICIT_RESOLUTION_REQUIRED" as const,
    evidenceKind: salesOrderId
      ? "NO_GOVERNED_COMPANY_SOURCE: the Sales Order lineage exists but carries no company"
      : "NO_GOVERNED_COMPANY_SOURCE: no stored company and no governed upstream",
    resolvedOperatingCompanyKey: null,
  });
}

// ════════════════════ type ════════════════════

/**
 * WHERE A FACT CAME FROM. Three kinds, never shown as equivalent.
 *
 * The distinction matters most exactly where it is easiest to lose: after normalization, a Work Order
 * whose type was NEVER RECORDED and one that genuinely said SERVICE_CALL look identical in the target.
 * One is a source fact and the other is a decision somebody made during a migration, and a report that
 * prints them the same way has quietly turned an assumption into history.
 */
export const FACT_CLASSES = Object.freeze([
  "SOURCE_FACT", "OWNER_MIGRATION_RESOLUTION", "DERIVED_FACT",
] as const);
export type FactClass = (typeof FACT_CLASSES)[number];

export const TYPE_RESOLUTIONS = Object.freeze([
  "SOURCE_EXACT", "OWNER_LEGACY_SERVICE_NORMALIZATION", "OWNER_LEGACY_DEFAULT", "UNRESOLVED",
] as const);
export type TypeResolutionKind = (typeof TYPE_RESOLUTIONS)[number];

export interface TypeResolution {
  /** The RAW source value, retained exactly -- including null. Evidence, never overwritten. */
  readonly sourceValue: string | null;
  readonly action: "COPY" | "BLOCKER";
  readonly targetValue: string | null;
  readonly resolution: TypeResolutionKind;
  readonly factClass: FactClass;
  /** MIGRATED for anything the Owner normalized; a source-exact value is not a migration artefact. */
  readonly provenance: "SOURCE" | "MIGRATED";
  readonly deterministic: boolean;
  readonly reason: string;
}

/**
 * Classify the Work Order type, under the OWNER MIGRATION NORMALIZATION.
 *
 * SERVICE -> SERVICE_CALL and a missing type -> SERVICE_CALL are OWNER DECISIONS about historical data,
 * not discoveries about it. Before the ruling this function blocked both, and it was right to: no rule in
 * the repository distinguishes SERVICE from SERVICE_CALL, so nothing could derive the intent. What
 * changed is not the evidence -- it is that someone with the authority to decide has decided.
 *
 * SO THE RAW VALUE IS KEPT AND THE RESOLUTION IS NAMED. A missing type resolves to SERVICE_CALL and
 * records `sourceValue: null` with `OWNER_LEGACY_DEFAULT`; the migration must never be able to claim the
 * source historically said SERVICE_CALL when it said nothing at all.
 *
 * THE NATIVE VOCABULARY IS UNTOUCHED. This is a migration normalization, not a vocabulary change: no
 * LEGACY_SERVICE or LEGACY_UNCLASSIFIED member is added, and a natively created Work Order still must
 * state one of the five governed types.
 *
 * AN UNRECOGNIZED VALUE STILL BLOCKS. The ruling covers SERVICE, absent, and exact target values. A
 * fourth spelling nobody has seen is not covered by it, and defaulting that to SERVICE_CALL would be the
 * tool deciding -- which is the thing it must never do.
 */
export function resolveWorkOrderType(record: SourceWorkOrder): TypeResolution {
  const value = text(record.data.type) ?? text(record.data.workOrderType);
  if (value && TARGET_WORK_ORDER_TYPES.includes(value)) {
    return Object.freeze({
      sourceValue: value, action: "COPY" as const, targetValue: value,
      resolution: "SOURCE_EXACT" as const, factClass: "SOURCE_FACT" as const, provenance: "SOURCE" as const,
      deterministic: true, reason: "exact match against the governed target vocabulary; copied unchanged",
    });
  }
  if (value === "SERVICE") {
    return Object.freeze({
      sourceValue: "SERVICE", action: "COPY" as const, targetValue: "SERVICE_CALL",
      resolution: "OWNER_LEGACY_SERVICE_NORMALIZATION" as const,
      factClass: "OWNER_MIGRATION_RESOLUTION" as const, provenance: "MIGRATED" as const,
      deterministic: true,
      reason:
        "OWNER MIGRATION NORMALIZATION: legacy SERVICE is recorded as SERVICE_CALL. The raw source value "
        + "is retained as evidence; this is a decision about history, not a fact discovered in it.",
    });
  }
  if (value === null) {
    return Object.freeze({
      sourceValue: null, action: "COPY" as const, targetValue: "SERVICE_CALL",
      resolution: "OWNER_LEGACY_DEFAULT" as const,
      factClass: "OWNER_MIGRATION_RESOLUTION" as const, provenance: "MIGRATED" as const,
      deterministic: true,
      reason:
        "OWNER LEGACY DEFAULT: the source recorded NO type, and eos_ops.work_orders.work_order_type is NOT "
        + "NULL. sourceValue stays null so the evidence never claims the source said SERVICE_CALL.",
    });
  }
  return Object.freeze({
    sourceValue: value, action: "BLOCKER" as const, targetValue: null,
    resolution: "UNRESOLVED" as const, factClass: "SOURCE_FACT" as const, provenance: "SOURCE" as const,
    deterministic: false,
    reason:
      `WORK_ORDER_TYPE_REQUIRES_RESOLUTION: '${value}' is neither a governed target value nor a value the `
      + "Owner normalization covers. Defaulting an unrecognized spelling would be this tool deciding.",
  });
}

// ════════════════════ number ════════════════════

export type NumberAction =
  "COPY_NATIVE_COMPATIBLE" | "EXCLUDE_WITH_EVIDENCE" | "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED";

export interface NumberResolution {
  readonly sourceNumber: string | null;
  readonly shape: string;
  readonly action: NumberAction;
  readonly reason: string;
}

/** Digits masked, so a shape can be counted without exposing a specific business reference. */
export const numberShape = (value: string | null): string =>
  value === null ? "(absent)" : value.replace(/[0-9]/g, "#");

/**
 * Classify one Work Order number.
 *
 * THERE IS NO RENUMBER ACTION, deliberately. A Work Order number is what a person says on the phone and
 * what an invoice references; changing it during a migration silently breaks every conversation and every
 * paper record that already used it.
 */
export function resolveWorkOrderNumber(
  record: SourceWorkOrder,
  recordClass: RecordClass,
): NumberResolution {
  const value = text(record.data.woNumber);
  const shape = numberShape(value);
  if (recordClass !== "BUSINESS") {
    return Object.freeze({
      sourceNumber: value, shape, action: "EXCLUDE_WITH_EVIDENCE" as const,
      reason: "the record is proven nonbusiness, so no target row is needed and its number never lands",
    });
  }
  if (value && NATIVE_WORK_ORDER_NUMBER.test(value)) {
    return Object.freeze({
      sourceNumber: value, shape, action: "COPY_NATIVE_COMPATIBLE" as const,
      reason: "matches the native format; copies unchanged",
    });
  }
  return Object.freeze({
    sourceNumber: value, shape, action: "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED" as const,
    reason:
      "a genuine business Work Order whose historical number does not match the native CHECK. The number "
      + "is PRESERVED EXACTLY; the target must accept migrated history without widening the NATIVE "
      + "constraint -- a decision for the Owner, not for this tool.",
  });
}

// ════════════════════ assignment ════════════════════

export type AssignmentOutcome =
  "ASSIGNMENT_COPYABLE" | "TERMINAL_ASSIGNMENT_HISTORICAL_ONLY" | "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION";

export type TechnicianResolution =
  "EXACT_EMPLOYEE" | "TECHNICIAN_DOC_MISSING" | "TECHNICIAN_HAS_NO_EMPLOYEE_ID" | "EMPLOYEE_NOT_FOUND" | "NOT_ASSIGNED";

export interface AssignmentReference {
  /** `assignedTechId` and `scheduledTechId` are DIFFERENT facts and never merged. */
  readonly field: "assignedTechId" | "scheduledTechId";
  readonly technicianId: string | null;
  readonly resolution: TechnicianResolution;
  readonly employeeId: string | null;
}

export interface AssignmentReport {
  readonly workOrderId: string;
  readonly terminal: boolean;
  readonly references: readonly AssignmentReference[];
  readonly outcome: AssignmentOutcome;
  readonly reason: string;
}

function resolveTechnician(
  field: AssignmentReference["field"],
  technicianId: string | null,
  evidence: SupportingEvidence,
): AssignmentReference {
  if (!technicianId) {
    return Object.freeze({ field, technicianId: null, resolution: "NOT_ASSIGNED" as const, employeeId: null });
  }
  const technician = evidence.technicians.get(technicianId);
  if (!technician) {
    return Object.freeze({ field, technicianId, resolution: "TECHNICIAN_DOC_MISSING" as const, employeeId: null });
  }
  if (!technician.employeeId) {
    return Object.freeze({ field, technicianId, resolution: "TECHNICIAN_HAS_NO_EMPLOYEE_ID" as const, employeeId: null });
  }
  if (!evidence.employees.has(technician.employeeId)) {
    return Object.freeze({ field, technicianId, resolution: "EMPLOYEE_NOT_FOUND" as const, employeeId: null });
  }
  return Object.freeze({ field, technicianId, resolution: "EXACT_EMPLOYEE" as const, employeeId: technician.employeeId });
}

/**
 * Resolve both assignment references, independently, and classify the record.
 *
 * EXACT RESOLUTION ONLY: technician id -> technician record -> employeeId -> governed Employee. No name,
 * email, title or role matching -- those find A person, not THE person, and an assignment names who is
 * accountable for the work.
 *
 * A TERMINAL Work Order may migrate without a current assignment: its history is what matters and nobody
 * is going to do the work. An ACTIVE one may not -- an in-flight job whose technician cannot be resolved
 * would arrive in the target unassigned and silently stall.
 */
export function classifyAssignment(
  record: SourceWorkOrder,
  evidence: SupportingEvidence,
): AssignmentReport {
  const decided = evidence.resolutionManifest?.byWorkOrderId.get(record.id)?.assignmentEmployeeId ?? null;
  const terminal = TERMINAL_STATUSES.includes(String(record.data.status ?? ""));
  const references = Object.freeze([
    resolveTechnician("assignedTechId", text(record.data.assignedTechId), evidence),
    resolveTechnician("scheduledTechId", text(record.data.scheduledTechId), evidence),
  ]);
  const stated = references.filter((r) => r.technicianId !== null);
  const unresolved = stated.filter((r) => r.resolution !== "EXACT_EMPLOYEE");

  if (stated.length === 0) {
    return Object.freeze({
      workOrderId: record.id, terminal, references, outcome: "ASSIGNMENT_COPYABLE" as const,
      reason: "no technician is named, so there is no assignment to carry",
    });
  }
  if (unresolved.length === 0) {
    return Object.freeze({
      workOrderId: record.id, terminal, references, outcome: "ASSIGNMENT_COPYABLE" as const,
      reason: "every stated technician resolves to an exact governed Employee",
    });
  }
  if (decided) {
    // An EXPLICIT Owner decision, and it clears ONLY this blocker. It does not resolve the legacy
    // technician reference -- that stays unresolved in the evidence, because what happened historically
    // and who is accountable now are different facts.
    return Object.freeze({
      workOrderId: record.id, terminal, references, outcome: "ASSIGNMENT_COPYABLE" as const,
      reason:
        `OWNER_MIGRATION_RESOLUTION: the assignee is explicitly decided as Employee ${decided}. The `
        + "unresolved legacy technician reference is retained as evidence and is NOT overwritten.",
    });
  }
  if (terminal) {
    return Object.freeze({
      workOrderId: record.id, terminal, references, outcome: "TERMINAL_ASSIGNMENT_HISTORICAL_ONLY" as const,
      reason:
        "terminal Work Order with an unresolved technician reference. Migration-eligible with NO current "
        + "assignment row: the unresolved source reference is retained in evidence, no Employee is "
        + "invented, and the history stays explainable.",
    });
  }
  return Object.freeze({
    workOrderId: record.id, terminal, references, outcome: "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION" as const,
    reason:
      "ACTIVE Work Order whose technician does not resolve to a governed Employee. It must be explicitly "
      + "resolved or reassigned before cutover -- an in-flight job cannot arrive unassigned.",
  });
}

// ════════════════════ per-record classification ════════════════════

export type TargetCollision = "TARGET_ABSENT" | "ALREADY_PRESENT_EQUIVALENT" | "TARGET_CONFLICT" | "TARGET_COLLISION_STATUS_UNKNOWN";

export interface FieldDisposition {
  readonly field: string;
  readonly action: FieldAction;
  /** SOURCE_FACT / OWNER_MIGRATION_RESOLUTION / DERIVED_FACT -- never shown as equivalent. */
  readonly factClass: FactClass;
  readonly reason: string;
}

export interface RecordClassification {
  readonly workOrderId: string;
  readonly recordClass: RecordClass;
  readonly result: RecordResult;
  readonly blockers: readonly { readonly kind: BlockerKind; readonly detail: string }[];
  readonly fields: readonly FieldDisposition[];
  readonly operatingCompany: OperatingCompanyResolution;
  readonly type: TypeResolution;
  readonly number: NumberResolution;
  readonly assignment: AssignmentReport;
  readonly targetCollision: TargetCollision;
  readonly exclusionEvidence: string | null;
}

/** The model disposition -> migration action mapping. Stated once, so the two axes cannot drift apart. */
const ACTION_FOR_MODEL_DISPOSITION: Readonly<Record<string, FieldAction>> = Object.freeze({
  GOVERNED_WORK_ORDER_FACT: "COPY",
  GOVERNED_ASSIGNMENT_FACT: "COPY",
  GOVERNED_OTHER_OBJECT_FACT: "COPY",
  DERIVED: "DERIVE",
  LEGACY_IDENTITY: "DERIVE",
  SUPERSEDED_BY_HISTORY: "HISTORICAL_ONLY",
  MIGRATION_EVIDENCE: "HISTORICAL_ONLY",
  APPROVED_RETIREMENT: "INTENTIONALLY_RETIRED",
  REMEDIATION_REQUIRED: "BLOCKER",
});

function referenceBlockers(
  record: SourceWorkOrder,
  evidence: SupportingEvidence,
): { readonly kind: BlockerKind; readonly detail: string }[] {
  const out: { kind: BlockerKind; detail: string }[] = [];
  const check = (field: string, value: string | null, present: boolean) => {
    if (value !== null && !present) {
      out.push({ kind: "REFERENCE_NOT_FOUND", detail: `${field} '${value}' resolves to no record in this source` });
    }
  };
  const customerId = text(record.data.customerId);
  const locationId = text(record.data.locationId);
  const equipmentId = text(record.data.equipmentId);
  const salesOrderId = text(record.data.salesOrderId);
  check("customerId", customerId, customerId === null || evidence.accounts.has(customerId));
  check("locationId", locationId, locationId === null || evidence.locations.has(locationId));
  check("equipmentId", equipmentId, equipmentId === null || evidence.equipment.has(equipmentId));
  check("salesOrderId", salesOrderId, salesOrderId === null || evidence.salesOrders.has(salesOrderId));
  return out;
}

/** Classify ONE source record. Every field gets an action; every failure names its blocker. */
export function classifyRecord(
  record: SourceWorkOrder,
  recordClass: RecordClass,
  exclusionEvidence: string | null,
  evidence: SupportingEvidence,
  matrix: readonly WorkOrderFieldParity[] = WORK_ORDER_FIELD_PARITY_MATRIX,
): RecordClassification {
  const operatingCompany = resolveOperatingCompany(record, evidence);
  const type = resolveWorkOrderType(record);
  const number = resolveWorkOrderNumber(record, recordClass);
  const assignment = classifyAssignment(record, evidence);

  const targetIds = evidence.targetWorkOrderIds;
  const targetCollision: TargetCollision = targetIds === null || targetIds === undefined
    ? "TARGET_COLLISION_STATUS_UNKNOWN"
    : targetIds.has(record.id) ? "TARGET_CONFLICT" : "TARGET_ABSENT";

  const blockers: { kind: BlockerKind; detail: string }[] = [];
  if (recordClass === "BUSINESS") {
    if (operatingCompany.resolutionStatus === "EXPLICIT_RESOLUTION_REQUIRED") {
      blockers.push({ kind: "OPERATING_COMPANY_UNRESOLVED", detail: operatingCompany.evidenceKind });
    }
    if (type.action === "BLOCKER") blockers.push({ kind: "WORK_ORDER_TYPE_REQUIRES_RESOLUTION", detail: type.reason });
    if (number.action === "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED") {
      blockers.push({ kind: "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED", detail: `shape ${number.shape}` });
    }
    if (assignment.outcome === "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION") {
      blockers.push({ kind: "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION", detail: assignment.reason });
    }
    if (targetCollision === "TARGET_CONFLICT") {
      blockers.push({ kind: "TARGET_CONFLICT", detail: "a row with this id already exists in the target" });
    }
    blockers.push(...referenceBlockers(record, evidence));
  }

  // EVERY governed field gets exactly one action. The matrix decides where the fact lives; the record's
  // own evidence can only ever turn an action INTO a blocker, never out of one.
  const fields: FieldDisposition[] = matrix.map((entry) => {
    const base = ACTION_FOR_MODEL_DISPOSITION[entry.disposition] ?? "BLOCKER";
    if (entry.legacyField === "type") {
      return {
        field: entry.legacyField,
        action: type.action === "BLOCKER" ? ("BLOCKER" as FieldAction) : ("COPY" as FieldAction),
        factClass: type.factClass, reason: type.reason,
      };
    }
    if (entry.legacyField === "woNumber" && number.action === "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED") {
      return { field: entry.legacyField, action: "BLOCKER" as FieldAction, factClass: "SOURCE_FACT" as FactClass, reason: number.reason };
    }
    if (entry.legacyField === "severity") {
      // RULING: severity is HISTORICAL_ONLY and NEVER becomes priority. Priority is an independent
      // governed fact whose source values already fit the target range, and folding a severity into it
      // would author a priority nobody set.
      const value = text(record.data.severity);
      const known = value !== null && TARGET_SEVERITIES.includes(value);
      return {
        field: entry.legacyField, action: "HISTORICAL_ONLY" as FieldAction, factClass: "SOURCE_FACT" as FactClass,
        reason: known
          ? "carried as history; it does not and must not influence priority"
          : `'${String(value)}' is outside the governed severity vocabulary -- retained as migration history only, `
            + "never translated into priority",
      };
    }
    if (entry.legacyField === "assignedTechId" || entry.legacyField === "scheduledTechId") {
      const ref = assignment.references.find((r) => r.field === entry.legacyField);
      if (ref && ref.technicianId !== null && ref.resolution !== "EXACT_EMPLOYEE") {
        const decidedEmployee = evidence.resolutionManifest?.byWorkOrderId.get(record.id)?.assignmentEmployeeId ?? null;
        if (decidedEmployee) {
          return { field: entry.legacyField, action: "HISTORICAL_ONLY" as FieldAction,
                   factClass: "OWNER_MIGRATION_RESOLUTION" as FactClass,
                   reason: `${ref.resolution}; the legacy reference is retained as evidence and the assignee is an explicit Owner decision` };
        }
        return assignment.terminal
          ? { field: entry.legacyField, action: "HISTORICAL_ONLY" as FieldAction, factClass: "SOURCE_FACT" as FactClass,
              reason: `${ref.resolution}; terminal record keeps the unresolved reference as evidence and authors no assignment row` }
          : { field: entry.legacyField, action: "BLOCKER" as FieldAction, factClass: "SOURCE_FACT" as FactClass,
              reason: `${ref.resolution}; an ACTIVE Work Order cannot migrate with an unresolvable assignee` };
      }
    }
    const factClass: FactClass = base === "DERIVE" ? "DERIVED_FACT" : "SOURCE_FACT";
    return { field: entry.legacyField, action: base, factClass, reason: entry.targetAuthority };
  });

  const result: RecordResult =
    recordClass !== "BUSINESS" ? "EXCLUDED_WITH_EVIDENCE"
    : blockers.length > 0 ? "BLOCKED"
    : "COPYABLE";

  return Object.freeze({
    workOrderId: record.id, recordClass, result,
    blockers: Object.freeze(blockers.map((b) => Object.freeze(b))),
    fields: Object.freeze(fields.map((f) => Object.freeze(f))),
    operatingCompany, type, number, assignment, targetCollision,
    exclusionEvidence,
  });
}

// ════════════════════ deterministic snapshot ════════════════════

/**
 * CANONICAL FORM: sorted keys, stable primitives, Timestamps as {seconds,nanos}.
 *
 * Determinism is the whole point. A snapshot whose checksum changes because two keys were enumerated in a
 * different order cannot prove that the source did not change between a DRY RUN and a COPY -- which is
 * the one thing a snapshot exists to prove. Mirrors the canonical form the M-1 cycle-count export used.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // A Firestore Timestamp, without importing Firebase to recognise one.
    if (typeof (obj as { toMillis?: unknown }).toMillis === "function"
        && typeof (obj as { seconds?: unknown }).seconds === "number") {
      return { seconds: (obj as { seconds: number }).seconds, nanos: (obj as { nanoseconds?: number }).nanoseconds ?? 0 };
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = canonicalize(obj[key]);
    return out;
  }
  return value;
}

/** Stable JSON for hashing. Never used as a data format -- only as bytes to digest. */
export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export interface SnapshotDocument {
  readonly id: string;
  readonly canonical: string;
  readonly sha256: string;
}

export interface SourceSnapshot {
  readonly sourceProject: string;
  readonly collection: string;
  readonly documentCount: number;
  readonly documents: readonly SnapshotDocument[];
  readonly bodySha256: string;
}

/**
 * Build the snapshot. `digest` is injected so this module stays free of node:crypto and therefore pure --
 * and so a test can prove the ORDERING is what makes the checksum stable, independently of the hash.
 */
export function buildSourceSnapshot(
  sourceProject: string,
  collection: string,
  records: readonly SourceWorkOrder[],
  digest: (text: string) => string,
): SourceSnapshot {
  const documents = [...records]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((record) => {
      const canonical = canonicalJson(record.data);
      return Object.freeze({ id: record.id, canonical, sha256: digest(canonical) });
    });
  const body = documents.map((d) => `${d.id}:${d.sha256}`).join("\n");
  return Object.freeze({
    sourceProject, collection,
    documentCount: documents.length,
    documents: Object.freeze(documents),
    bodySha256: digest(body),
  });
}

// ════════════════════ the report ════════════════════

export interface DryRunSummary {
  readonly sourceTotal: number;
  readonly provenBusiness: number;
  readonly provenFixtureOrNonbusiness: number;
  readonly copyable: number;
  readonly excluded: number;
  readonly blocked: number;
  /** Counts per kind. These OVERLAP -- one record may carry several. */
  readonly blockersByKind: Readonly<Record<BlockerKind, number>>;
  /** Distinct records carrying at least one blocker. The only figure that is a record count. */
  readonly blockedRecordCount: number;
  /** Every observed combination, so the overlapping counts above can never be added up by mistake. */
  readonly blockerIntersections: readonly { readonly kinds: readonly BlockerKind[]; readonly records: number }[];
}

export interface DryRunReport {
  readonly snapshot: SourceSnapshot;
  readonly families: readonly FamilyVerdict[];
  readonly records: readonly RecordClassification[];
  readonly summary: DryRunSummary;
  readonly targetCollisionStatusKnown: boolean;
}

/** Run the whole classification over a snapshot's records. */
export function runDryRun(input: {
  readonly snapshot: SourceSnapshot;
  readonly records: readonly SourceWorkOrder[];
  readonly evidence: SupportingEvidence;
  readonly families?: readonly FixtureFamily[];
}): DryRunReport {
  const families = classifyFixtureFamilies(input.records, input.families ?? FIXTURE_FAMILIES);
  const excludedById = new Map<string, FamilyVerdict>();
  for (const family of families) {
    if (!family.excluded) continue;
    for (const id of family.memberIds) excludedById.set(id, family);
  }

  const records = input.records.map((record) => {
    const family = excludedById.get(record.id);
    return classifyRecord(
      record,
      family ? family.recordClass : "BUSINESS",
      family ? `${family.key} -- ${family.reason} (authored by ${family.authoredBy})` : null,
      input.evidence,
    );
  });

  const blockersByKind = Object.fromEntries(BLOCKER_KINDS.map((k) => [k, 0])) as Record<BlockerKind, number>;
  const combos = new Map<string, number>();
  for (const record of records) {
    const kinds = [...new Set(record.blockers.map((b) => b.kind))].sort();
    for (const kind of kinds) blockersByKind[kind] += 1;
    if (kinds.length > 0) combos.set(kinds.join(" + "), (combos.get(kinds.join(" + ")) ?? 0) + 1);
  }

  const summary: DryRunSummary = Object.freeze({
    sourceTotal: input.records.length,
    provenBusiness: records.filter((r) => r.recordClass === "BUSINESS").length,
    provenFixtureOrNonbusiness: records.filter((r) => r.recordClass !== "BUSINESS").length,
    copyable: records.filter((r) => r.result === "COPYABLE").length,
    excluded: records.filter((r) => r.result === "EXCLUDED_WITH_EVIDENCE").length,
    blocked: records.filter((r) => r.result === "BLOCKED").length,
    blockersByKind: Object.freeze(blockersByKind),
    blockedRecordCount: records.filter((r) => r.blockers.length > 0).length,
    blockerIntersections: Object.freeze([...combos]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([key, count]) => Object.freeze({
        kinds: Object.freeze(key.split(" + ") as BlockerKind[]), records: count,
      }))),
  });

  return Object.freeze({
    snapshot: input.snapshot,
    families,
    records: Object.freeze(records),
    summary,
    targetCollisionStatusKnown: input.evidence.targetWorkOrderIds !== null
      && input.evidence.targetWorkOrderIds !== undefined,
  });
}

// ════════════════════ THE OWNER RESOLUTION MANIFEST ════════════════════
//
// THE TOOL MAY CONSUME A DECISION. THE TOOL MAY NEVER AUTHOR ONE.
//
// Every refusal below exists because the opposite behaviour would let a decision arrive without anybody
// making it:
//
//   checksum      a manifest written against a different source snapshot is a decision about DIFFERENT
//                 records. Statuses move, assignments change; "wo-123 -> taylor" decided last week may be
//                 about a Work Order that has since been cancelled and reassigned.
//   population    naming a record that is not in the business population resolves nothing and hides a
//                 typo as a no-op.
//   fixture       naming a synthetic record means the author misread the census; silently ignoring it
//                 would leave them believing they had decided something.
//   duplicate     two entries for one Work Order is an unresolved disagreement, not a last-writer-wins.
//   company       validated through the governed authority -- not a string. UNKNOWN and INACTIVE are
//                 kept apart because they are different mistakes.
//   unknown field this is what forbids a future `defaultOperatingCompany: "taylor"` from being honoured
//                 by a tool that simply ignores what it does not recognise. A key nobody implemented is
//                 a decision nobody applied.
//
// A BULK DECISION IS STILL EXPLICIT. "All 14 of these go to taylor" is supported by LISTING the fourteen
// ids against this snapshot. There is no default, no wildcard and no rule -- which keeps it a migration
// fact about one population rather than an inference that outlives it.
// Aliased: this module already exports a resolveOperatingCompany for the WORK ORDER question ("which
// company does this record belong to"). The imported one answers a different question ("is this id a
// governed company"), and letting the two share a name is how a validity check gets mistaken for a
// resolution.
import { resolveOperatingCompany as resolveGovernedCompanyId } from "../../ownership/operatingCompanyAuthority.js";

export interface ManifestRecord {
  readonly workOrderId: string;
  readonly operatingCompanyId: string;
  /** Only for a Work Order whose ACTIVE assignment could not be resolved. A governed Employee id. */
  readonly assignmentEmployeeId?: string;
  readonly decisionReason: string;
}

export interface ResolutionManifest {
  readonly snapshotBodySha256: string;
  readonly decisionId: string;
  readonly decidedAt: string;
  readonly records: readonly ManifestRecord[];
}

const MANIFEST_KEYS = Object.freeze(["snapshotBodySha256", "decisionId", "decidedAt", "records"]);
const RECORD_KEYS = Object.freeze(["workOrderId", "operatingCompanyId", "assignmentEmployeeId", "decisionReason"]);

export class ManifestRefusedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ManifestRefusedError";
  }
}
const refuseManifest = (code: string, message: string): never => { throw new ManifestRefusedError(code, message); };

export interface ValidatedManifest {
  readonly decisionId: string;
  readonly decidedAt: string;
  readonly byWorkOrderId: ReadonlyMap<string, ManifestRecord>;
}

/**
 * Validate a manifest against THIS snapshot and THIS classified population.
 *
 * `businessIds` and `fixtureIds` come from a DRY RUN that already ran without a manifest, so the manifest
 * is always checked against a population someone could read first.
 */
export function validateResolutionManifest(
  manifest: unknown,
  context: {
    readonly snapshotBodySha256: string;
    readonly businessIds: ReadonlySet<string>;
    readonly fixtureIds: ReadonlySet<string>;
    readonly employeeIds?: ReadonlySet<string>;
  },
): ValidatedManifest {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    refuseManifest("MANIFEST_MALFORMED", "the manifest must be an object");
  }
  const m = manifest as Record<string, unknown>;
  const extra = Object.keys(m).filter((k) => !MANIFEST_KEYS.includes(k));
  if (extra.length > 0) {
    refuseManifest("MANIFEST_UNKNOWN_FIELD",
      `the manifest carries field(s) this tool does not implement: ${extra.sort().join(", ")}. A key nobody `
      + "implemented is a decision nobody applied -- including any form of implicit default.");
  }
  for (const key of ["snapshotBodySha256", "decisionId", "decidedAt"]) {
    if (typeof m[key] !== "string" || (m[key] as string).trim() === "") {
      refuseManifest("MANIFEST_MALFORMED", `${key} is required`);
    }
  }
  if (m.snapshotBodySha256 !== context.snapshotBodySha256) {
    refuseManifest("MANIFEST_SNAPSHOT_MISMATCH",
      "this manifest was written against a different source snapshot. Its decisions are about records as "
      + "they were then, which may no longer be these records.");
  }
  if (!Array.isArray(m.records)) refuseManifest("MANIFEST_MALFORMED", "records must be a list");

  const byWorkOrderId = new Map<string, ManifestRecord>();
  (m.records as unknown[]).forEach((raw, i) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      refuseManifest("MANIFEST_MALFORMED", `records[${i}] must be an object`);
    }
    const r = raw as Record<string, unknown>;
    const unknown = Object.keys(r).filter((k) => !RECORD_KEYS.includes(k));
    if (unknown.length > 0) {
      refuseManifest("MANIFEST_UNKNOWN_FIELD", `records[${i}] carries unknown field(s): ${unknown.sort().join(", ")}`);
    }
    const workOrderId = text(r.workOrderId);
    if (!workOrderId) refuseManifest("MANIFEST_MALFORMED", `records[${i}].workOrderId is required`);
    if (byWorkOrderId.has(workOrderId as string)) {
      refuseManifest("MANIFEST_DUPLICATE_RECORD",
        `${workOrderId} is resolved twice. Two entries for one Work Order is an unresolved disagreement, `
        + "not a last-one-wins.");
    }
    if (context.fixtureIds.has(workOrderId as string)) {
      refuseManifest("MANIFEST_FIXTURE_NAMED",
        `${workOrderId} is a proven nonbusiness fixture and needs no target row. Naming it means the census `
        + "was misread, and ignoring the entry would leave that belief in place.");
    }
    if (!context.businessIds.has(workOrderId as string)) {
      refuseManifest("MANIFEST_RECORD_NOT_IN_POPULATION",
        `${workOrderId} is not in the business population of this snapshot`);
    }
    const company = resolveGovernedCompanyId(r.operatingCompanyId);
    if (company.state === "INVALID") {
      refuseManifest("MANIFEST_COMPANY_INVALID", `records[${i}].operatingCompanyId is not a governed company id`);
    }
    if (company.state === "UNKNOWN") {
      refuseManifest("MANIFEST_COMPANY_UNKNOWN",
        `'${String(r.operatingCompanyId)}' is not a known operating company. A company id is validated `
        + "through the governed authority, never accepted as a string.");
    }
    if (company.state === "INACTIVE") {
      refuseManifest("MANIFEST_COMPANY_INACTIVE",
        `'${String(r.operatingCompanyId)}' names an INACTIVE operating company`);
    }
    if (!text(r.decisionReason)) {
      refuseManifest("MANIFEST_MALFORMED", `records[${i}].decisionReason is required -- a decision states why`);
    }
    const employeeId: string | undefined =
      r.assignmentEmployeeId === undefined ? undefined : (text(r.assignmentEmployeeId) ?? undefined);
    if (r.assignmentEmployeeId !== undefined) {
      if (!employeeId) refuseManifest("MANIFEST_MALFORMED", `records[${i}].assignmentEmployeeId must be a stated id`);
      // A Firebase uid is NOT an Employee identity, and the shapes are distinguishable: governed Employee
      // ids are not 28-character Firebase auth uids.
      if (/^[A-Za-z0-9]{28}$/.test(employeeId as string)) {
        refuseManifest("MANIFEST_EMPLOYEE_IS_UID",
          `records[${i}].assignmentEmployeeId looks like a Firebase uid. A uid is how a person logs in, `
          + "not who they are as an Employee.");
      }
      if (context.employeeIds && !context.employeeIds.has(employeeId as string)) {
        refuseManifest("MANIFEST_EMPLOYEE_NOT_FOUND",
          `records[${i}].assignmentEmployeeId '${employeeId}' resolves to no governed Employee`);
      }
    }
    byWorkOrderId.set(workOrderId as string, Object.freeze({
      workOrderId: workOrderId as string,
      operatingCompanyId: r.operatingCompanyId as string,
      ...(employeeId === undefined ? {} : { assignmentEmployeeId: employeeId }),
      decisionReason: r.decisionReason as string,
    }));
  });

  return Object.freeze({
    decisionId: m.decisionId as string,
    decidedAt: m.decidedAt as string,
    byWorkOrderId,
  });
}

// ════════════════════ THE OWNER DECISION WORKSHEET ════════════════════

export interface WorksheetRow {
  readonly workOrderId: string;
  readonly woNumber: string | null;
  readonly status: string | null;
  readonly sourceType: string | null;
  readonly targetType: string | null;
  readonly typeResolution: TypeResolutionKind;
  readonly customerId: string | null;
  readonly locationId: string | null;
  readonly equipmentId: string | null;
  readonly salesOrderId: string | null;
  readonly assignedTechIdResolution: TechnicianResolution;
  readonly scheduledTechIdResolution: TechnicianResolution;
  /** ALWAYS empty. The tool does not suggest a company, because a suggestion is a decision with a hedge. */
  readonly operatingCompanyDecision: "";
}

export interface AssignmentWorksheetRow {
  readonly workOrderId: string;
  readonly woNumber: string | null;
  readonly status: string | null;
  readonly legacyAssignedTechId: string | null;
  readonly legacyScheduledTechId: string | null;
  readonly exactResolutionResult: string;
  /** ALWAYS empty. */
  readonly assignmentEmployeeDecision: "";
}

/**
 * The 14-row worksheet, sorted by woNumber.
 *
 * THE COMPANY COLUMN IS BLANK AND STAYS BLANK. The contextual columns are here to let a person recognise
 * the Work Order -- which customer, which site, which job -- and NOT so the tool can hint. Printing a
 * "likely" company beside them would be the inference the ruling forbids, wearing a suggestion's clothes:
 * a reviewer confirming a pre-filled column is not deciding, they are agreeing.
 */
export function buildOwnerWorksheet(
  report: DryRunReport,
  records: readonly SourceWorkOrder[],
): readonly WorksheetRow[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return Object.freeze(report.records
    .filter((r) => r.recordClass === "BUSINESS")
    .map((r) => {
      const data = byId.get(r.workOrderId)?.data ?? {};
      const ref = (field: AssignmentReference["field"]) =>
        r.assignment.references.find((x) => x.field === field)?.resolution ?? "NOT_ASSIGNED";
      return Object.freeze({
        workOrderId: r.workOrderId,
        woNumber: text(data.woNumber),
        status: text(data.status),
        sourceType: r.type.sourceValue,
        targetType: r.type.targetValue,
        typeResolution: r.type.resolution,
        customerId: text(data.customerId),
        locationId: text(data.locationId),
        equipmentId: text(data.equipmentId),
        salesOrderId: text(data.salesOrderId),
        assignedTechIdResolution: ref("assignedTechId"),
        scheduledTechIdResolution: ref("scheduledTechId"),
        operatingCompanyDecision: "" as const,
      });
    })
    .sort((a, b) => String(a.woNumber).localeCompare(String(b.woNumber))));
}

/** Only the business Work Orders whose ACTIVE assignment must be resolved before they can copy. */
export function buildAssignmentWorksheet(
  report: DryRunReport,
  records: readonly SourceWorkOrder[],
): readonly AssignmentWorksheetRow[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return Object.freeze(report.records
    .filter((r) => r.recordClass === "BUSINESS" && r.assignment.outcome === "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION")
    .map((r) => {
      const data = byId.get(r.workOrderId)?.data ?? {};
      const ref = (field: AssignmentReference["field"]) =>
        r.assignment.references.find((x) => x.field === field);
      return Object.freeze({
        workOrderId: r.workOrderId,
        woNumber: text(data.woNumber),
        status: text(data.status),
        legacyAssignedTechId: ref("assignedTechId")?.technicianId ?? null,
        legacyScheduledTechId: ref("scheduledTechId")?.technicianId ?? null,
        exactResolutionResult: r.assignment.references
          .filter((x) => x.technicianId !== null)
          .map((x) => `${x.field}=${x.resolution}`).join(", "),
        assignmentEmployeeDecision: "" as const,
      });
    })
    .sort((a, b) => String(a.woNumber).localeCompare(String(b.woNumber))));
}
