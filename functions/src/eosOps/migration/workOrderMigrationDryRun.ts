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
   * Owner-authored resolutions, if any. The tool NEVER creates one: it may only consume a manifest a
   * human wrote. An empty manifest is the normal state and produces blockers, which is the point.
   */
  readonly operatingCompanyManifest?: ReadonlyMap<string, string>;
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
  const manifest = evidence.operatingCompanyManifest?.get(record.id) ?? null;
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

export interface TypeResolution {
  readonly sourceValue: string | null;
  readonly action: "COPY" | "BLOCKER";
  readonly targetValue: string | null;
  readonly deterministic: boolean;
  readonly reason: string;
}

/**
 * Classify the Work Order type.
 *
 * SERVICE IS NOT SILENTLY MAPPED TO SERVICE_CALL, by ruling and on the evidence: BOTH values exist in the
 * same live population, so a rule that treats them as synonyms asserts that a distinction someone made is
 * meaningless. No deterministic business rule in the repository distinguishes them -- no command, no
 * lifecycle branch, no UI behaviour and no downstream effect reads `type` to decide anything -- so there
 * is nothing to derive an intent from, and a missing type has even less.
 */
export function resolveWorkOrderType(record: SourceWorkOrder): TypeResolution {
  const value = text(record.data.type) ?? text(record.data.workOrderType);
  if (value && TARGET_WORK_ORDER_TYPES.includes(value)) {
    return Object.freeze({
      sourceValue: value, action: "COPY" as const, targetValue: value, deterministic: true,
      reason: "exact match against the governed target vocabulary",
    });
  }
  if (!value) {
    return Object.freeze({
      sourceValue: null, action: "BLOCKER" as const, targetValue: null, deterministic: false,
      reason:
        "WORK_ORDER_TYPE_REQUIRES_RESOLUTION: no type is stored, and eos_ops.work_orders.work_order_type is "
        + "NOT NULL. Nothing in the source determines what it should have been -- a record with no type "
        + "cannot be given one by the migration.",
    });
  }
  return Object.freeze({
    sourceValue: value, action: "BLOCKER" as const, targetValue: null, deterministic: false,
    reason:
      `WORK_ORDER_TYPE_REQUIRES_RESOLUTION: '${value}' is outside the governed target vocabulary `
      + `(${TARGET_WORK_ORDER_TYPES.join(", ")}). It is NOT mapped, because the same population also `
      + "contains exact target values -- so the two were distinguishable to whoever wrote them, and "
      + "collapsing them would destroy that distinction on no evidence.",
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
    if (entry.legacyField === "type" && type.action === "BLOCKER") {
      return { field: entry.legacyField, action: "BLOCKER" as FieldAction, reason: type.reason };
    }
    if (entry.legacyField === "woNumber" && number.action === "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED") {
      return { field: entry.legacyField, action: "BLOCKER" as FieldAction, reason: number.reason };
    }
    if (entry.legacyField === "severity") {
      // RULING: severity is HISTORICAL_ONLY and NEVER becomes priority. Priority is an independent
      // governed fact whose source values already fit the target range, and folding a severity into it
      // would author a priority nobody set.
      const value = text(record.data.severity);
      const known = value !== null && TARGET_SEVERITIES.includes(value);
      return {
        field: entry.legacyField, action: "HISTORICAL_ONLY" as FieldAction,
        reason: known
          ? "carried as history; it does not and must not influence priority"
          : `'${String(value)}' is outside the governed severity vocabulary -- retained as migration history only, `
            + "never translated into priority",
      };
    }
    if (entry.legacyField === "assignedTechId" || entry.legacyField === "scheduledTechId") {
      const ref = assignment.references.find((r) => r.field === entry.legacyField);
      if (ref && ref.technicianId !== null && ref.resolution !== "EXACT_EMPLOYEE") {
        return assignment.terminal
          ? { field: entry.legacyField, action: "HISTORICAL_ONLY" as FieldAction,
              reason: `${ref.resolution}; terminal record keeps the unresolved reference as evidence and authors no assignment row` }
          : { field: entry.legacyField, action: "BLOCKER" as FieldAction,
              reason: `${ref.resolution}; an ACTIVE Work Order cannot migrate with an unresolvable assignee` };
      }
    }
    return { field: entry.legacyField, action: base, reason: entry.targetAuthority };
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
