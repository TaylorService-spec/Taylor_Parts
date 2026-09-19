// Steps D/E: the legacy WORK ELIGIBILITY and OPERATIONAL SCOPE evidence census, and the DRY-RUN migration plan.
//
// Pure: no Firebase, no database, no I/O, no clock. It takes the one-time Firestore Employee export
// (EOS_EMPLOYEE_PROFILE_SNAPSHOT) and a RESOLUTION VIEW read from PostgreSQL, and returns a classification of every
// piece of legacy evidence plus the governed commands that WOULD be issued.
//
// ════════════════════ IT MIGRATES NOTHING ════════════════════
//
// There is no apply path in this module or in its report/CLI, by ruling. The output is EVIDENCE: counts, dispositions,
// a remediation set and a plan. A person reads the plan and decides; the governed step C commands do the writing, each
// re-checking its own capability. Nothing here is an authority and nothing here mutates.
//
// ════════════════════ WHAT IS AND IS NOT DETERMINISTIC ════════════════════
//
// The Owner ruled exactly TWO legacy operationalRole values deterministic candidates:
//
//   TECHNICIAN          -> SERVICE_TECHNICIAN
//   WAREHOUSE_ASSOCIATE -> WAREHOUSE_OPERATIONS
//
// (LEGACY_QUALIFICATION_CANDIDATES, workEligibilityVocabulary.ts). Every other legacy value needs a proven exact
// current consumer mapping or Administration remediation, and leaving one unmigrated needs no further ruling. So this
// module never guesses one, and a value's disposition is decided by EVIDENCE ALONE, never by judgement about what a
// role "probably" means:
//
//   DETERMINISTIC_CANDIDATE   a ruled candidate, the Employee resolves, the qualification is not already held
//   ALREADY_GOVERNED          a ruled candidate whose target qualification is ALREADY current in PostgreSQL
//   AMBIGUOUS_REMEDIATION     a known legacy value, HELD by at least one Employee, with no ruled mapping
//   DEAD_LEGACY               a known legacy value that NO Employee in the snapshot holds -- vocabulary only
//   UNKNOWN                   a value outside the known legacy vocabulary entirely (data drift)
//
// Promoting an AMBIGUOUS_REMEDIATION value to a mapping is an OWNER RULING, not a code change here.
//
// QUALIFICATION IS NEVER INFERRED FROM JOB ROLE, title, manager, Security Role, operating company or uid. The only
// input is the legacy operationalRoles array itself.
//
// ════════════════════ WAREHOUSE SCOPE: EVIDENCE, NOT AUTHORITY ════════════════════
//
// `assignedWarehouseIds` is the ONLY admissible scope evidence, and it is evidence: the normalized effective-dated
// rows become the authority. A legacy id becomes a candidate ONLY when the Employee resolves exactly, the warehouse
// resolves exactly, both are in the SAME tenant, the warehouse is governed and ACTIVE, and there is no ambiguity.
// Everything else is a named finding, never a guess:
//
//   UNKNOWN_EMPLOYEE      the snapshot Employee does not exist in this tenant's governed Employees
//   UNKNOWN_WAREHOUSE     no governed warehouse carries that id in ANY tenant
//   CROSS_TENANT          a governed warehouse carries that id, but in a DIFFERENT tenant
//   INACTIVE_WAREHOUSE    the warehouse resolves in this tenant but is not ACTIVE
//   AMBIGUOUS             the entry is not an exact governed id (blank, untrimmed, path-shaped, not a string)
//   DUPLICATE             the same warehouse id appears more than once in one Employee's legacy array
//   ALREADY_GOVERNED      a current governed scope for that Employee and warehouse already exists
//   REMEDIATION_REQUIRED  the legacy field itself is structurally unusable (present, but not an array)
//
// CROSS_TENANT is reported separately from UNKNOWN_WAREHOUSE deliberately: they are different remediation problems,
// and collapsing them would hide a tenancy defect inside a typo count. The distinction is the only reason the view
// resolves warehouses across tenants -- nothing else here reads another tenant's rows, and no candidate may name one.
//
// SCOPE IS NEVER DERIVED FROM A ROLE STRING. WAREHOUSE_ASSOCIATE and WAREHOUSE_MANAGER prove nothing about WHICH
// warehouse; Job Role, title, manager, Security Role and operating company prove nothing either. An Employee with the
// WAREHOUSE_OPERATIONS qualification and no `assignedWarehouseIds` yields NO scope candidate, and that is correct:
// qualification and scope are separate authorities, and a missing scope is a finding, not a gap to fill.
import { LEGACY_QUALIFICATION_CANDIDATES, type WorkEligibilityCode } from "../workEligibilityVocabulary";
import { LEGACY_SCOPE_EVIDENCE_FIELD, type OperationalScopeType } from "../operationalScopeVocabulary";
import type { EmployeeProfileSnapshot } from "./employeeProfileSnapshot";

/** The legacy `operationalRoles` vocabulary, carried verbatim from access/employeeProfileCommands.ts. */
export const LEGACY_OPERATIONAL_ROLE_VALUES = Object.freeze([
  "PARTS_MANAGER", "PARTS_ASSOCIATE", "TECHNICIAN", "WAREHOUSE_MANAGER", "WAREHOUSE_ASSOCIATE",
  "SERVICE_MANAGER", "SALES_MANAGER", "SALES_ASSOCIATE",
] as const);

export const QUALIFICATION_DISPOSITIONS = Object.freeze([
  "DETERMINISTIC_CANDIDATE", "ALREADY_GOVERNED", "AMBIGUOUS_REMEDIATION", "DEAD_LEGACY", "UNKNOWN",
] as const);
export type QualificationDisposition = (typeof QUALIFICATION_DISPOSITIONS)[number];

export const SCOPE_DISPOSITIONS = Object.freeze([
  "DETERMINISTIC_CANDIDATE", "ALREADY_GOVERNED", "UNKNOWN_EMPLOYEE", "UNKNOWN_WAREHOUSE", "CROSS_TENANT",
  "INACTIVE_WAREHOUSE", "AMBIGUOUS", "DUPLICATE", "REMEDIATION_REQUIRED",
] as const);
export type ScopeDisposition = (typeof SCOPE_DISPOSITIONS)[number];

const SCOPE_TYPE: OperationalScopeType = "WAREHOUSE";
const EXACT_ID = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

/** What PostgreSQL currently says. Read-only, built by legacyWorkforceEvidenceReport.ts; never written by this module. */
export interface WorkforceResolutionView {
  readonly tenantId: string;
  /** Governed Employee ids IN THIS TENANT. */
  readonly employees: ReadonlySet<string>;
  /** Governed warehouses across ALL tenants, so CROSS_TENANT is distinguishable from UNKNOWN_WAREHOUSE. */
  readonly warehouses: ReadonlyMap<string, { readonly tenantId: string; readonly status: string }>;
  /** `${employeeId}|${qualificationCode}` for every CURRENT qualification in this tenant. */
  readonly currentQualifications: ReadonlySet<string>;
  /** `${employeeId}|WAREHOUSE|${scopeId}` for every CURRENT scope in this tenant. */
  readonly currentScopes: ReadonlySet<string>;
}

export interface QualificationFinding {
  readonly employeeId: string;
  readonly legacyValue: string;
  readonly disposition: QualificationDisposition;
  /** The qualification a DETERMINISTIC_CANDIDATE or ALREADY_GOVERNED finding maps to; null otherwise. */
  readonly qualificationCode: WorkEligibilityCode | null;
}

export interface ScopeFinding {
  readonly employeeId: string;
  readonly legacyValue: string;
  readonly disposition: ScopeDisposition;
  readonly scopeType: OperationalScopeType;
}

/** A governed command that WOULD be issued. It is a proposal: nothing here issues it. */
export interface PlannedQualification {
  readonly operation: "assignEmployeeWorkEligibility";
  readonly input: { readonly employeeId: string; readonly qualificationCode: WorkEligibilityCode; readonly reason: string };
}
export interface PlannedScope {
  readonly operation: "assignEmployeeOperationalScope";
  readonly input: {
    readonly employeeId: string; readonly scopeType: OperationalScopeType; readonly scopeId: string; readonly reason: string;
  };
}

export interface LegacyWorkforceEvidenceCensus {
  readonly tenantId: string;
  readonly exportedAt: string;
  readonly employeesInSnapshot: number;
  /** Snapshot Employees carrying at least one legacy operationalRoles value. */
  readonly employeesWithLegacyRoles: number;
  /** Snapshot Employees carrying at least one assignedWarehouseIds entry. */
  readonly employeesWithLegacyWarehouses: number;
  readonly qualificationFindings: readonly QualificationFinding[];
  readonly scopeFindings: readonly ScopeFinding[];
  readonly qualificationCounts: Readonly<Record<QualificationDisposition, number>>;
  readonly scopeCounts: Readonly<Record<ScopeDisposition, number>>;
  /** Every finding a person must act on: neither a candidate nor already governed. */
  readonly remediation: readonly (QualificationFinding | ScopeFinding)[];
  readonly plan: {
    readonly qualifications: readonly PlannedQualification[];
    readonly scopes: readonly PlannedScope[];
  };
  /** Always false. There is no apply path; the field exists so a report cannot be misread as an applied migration. */
  readonly applied: false;
}

const REASON_QUALIFICATION = "legacy operationalRoles migration (Owner-ruled deterministic candidate)";
const REASON_SCOPE = `legacy ${LEGACY_SCOPE_EVIDENCE_FIELD} migration (exact governed active warehouse)`;

const zeroed = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/**
 * Classify every piece of legacy evidence in the snapshot against what PostgreSQL currently holds, and propose the
 * governed commands for the deterministic candidates only.
 *
 * Deterministic and order-independent: findings are sorted, so two runs over the same snapshot and view produce
 * byte-identical output and a diff between runs is a real change in the evidence.
 */
export function censusLegacyWorkforceEvidence(
  snapshot: EmployeeProfileSnapshot, view: WorkforceResolutionView,
): LegacyWorkforceEvidenceCensus {
  const qualificationFindings: QualificationFinding[] = [];
  const scopeFindings: ScopeFinding[] = [];
  const known = new Set<string>(LEGACY_OPERATIONAL_ROLE_VALUES);
  const heldLegacyValues = new Set<string>();
  let employeesWithLegacyRoles = 0;
  let employeesWithLegacyWarehouses = 0;

  for (const doc of snapshot.employees) {
    const roles = doc.data.operationalRoles;
    if (Array.isArray(roles) && roles.length > 0) {
      employeesWithLegacyRoles += 1;
      for (const raw of roles) {
        const legacyValue = typeof raw === "string" ? raw : JSON.stringify(raw);
        if (typeof raw === "string" && known.has(raw)) heldLegacyValues.add(raw);
        const mapped = typeof raw === "string" ? LEGACY_QUALIFICATION_CANDIDATES[raw] : undefined;
        if (mapped === undefined) {
          // A known value with no ruled mapping needs a person; anything outside the vocabulary is drift.
          const disposition: QualificationDisposition = typeof raw === "string" && known.has(raw) ? "AMBIGUOUS_REMEDIATION" : "UNKNOWN";
          qualificationFindings.push({ employeeId: doc.id, legacyValue, disposition, qualificationCode: null });
          continue;
        }
        // A ruled candidate still needs the Employee to resolve: a qualification cannot be proposed for an Employee
        // this tenant's governed authority does not have.
        if (!view.employees.has(doc.id)) {
          qualificationFindings.push({ employeeId: doc.id, legacyValue, disposition: "AMBIGUOUS_REMEDIATION", qualificationCode: mapped });
          continue;
        }
        const alreadyGoverned = view.currentQualifications.has(`${doc.id}|${mapped}`);
        qualificationFindings.push({
          employeeId: doc.id, legacyValue, qualificationCode: mapped,
          disposition: alreadyGoverned ? "ALREADY_GOVERNED" : "DETERMINISTIC_CANDIDATE",
        });
      }
    }

    const warehouses = doc.data[LEGACY_SCOPE_EVIDENCE_FIELD];
    if (warehouses === undefined || warehouses === null) continue;
    if (!Array.isArray(warehouses)) {
      scopeFindings.push({ employeeId: doc.id, legacyValue: "", disposition: "REMEDIATION_REQUIRED", scopeType: SCOPE_TYPE });
      continue;
    }
    if (warehouses.length > 0) employeesWithLegacyWarehouses += 1;
    const seen = new Set<string>();
    for (const raw of warehouses) {
      const legacyValue = typeof raw === "string" ? raw : JSON.stringify(raw);
      const finding = (disposition: ScopeDisposition): ScopeFinding => ({ employeeId: doc.id, legacyValue, disposition, scopeType: SCOPE_TYPE });
      if (!EXACT_ID(raw)) { scopeFindings.push(finding("AMBIGUOUS")); continue; }
      if (seen.has(raw)) { scopeFindings.push(finding("DUPLICATE")); continue; }
      seen.add(raw);
      if (!view.employees.has(doc.id)) { scopeFindings.push(finding("UNKNOWN_EMPLOYEE")); continue; }
      const warehouse = view.warehouses.get(raw);
      if (warehouse === undefined) { scopeFindings.push(finding("UNKNOWN_WAREHOUSE")); continue; }
      if (warehouse.tenantId !== view.tenantId) { scopeFindings.push(finding("CROSS_TENANT")); continue; }
      if (warehouse.status !== "ACTIVE") { scopeFindings.push(finding("INACTIVE_WAREHOUSE")); continue; }
      if (view.currentScopes.has(`${doc.id}|${SCOPE_TYPE}|${raw}`)) { scopeFindings.push(finding("ALREADY_GOVERNED")); continue; }
      scopeFindings.push(finding("DETERMINISTIC_CANDIDATE"));
    }
  }

  // A known legacy value NO Employee holds is vocabulary with nothing behind it. Reported once, not per Employee.
  for (const value of LEGACY_OPERATIONAL_ROLE_VALUES) {
    if (!heldLegacyValues.has(value)) {
      qualificationFindings.push({ employeeId: "", legacyValue: value, disposition: "DEAD_LEGACY", qualificationCode: null });
    }
  }

  const order = (a: { employeeId: string; legacyValue: string }, b: { employeeId: string; legacyValue: string }) =>
    a.employeeId.localeCompare(b.employeeId) || a.legacyValue.localeCompare(b.legacyValue);
  qualificationFindings.sort(order);
  scopeFindings.sort(order);

  const qualificationCounts = zeroed(QUALIFICATION_DISPOSITIONS);
  for (const f of qualificationFindings) qualificationCounts[f.disposition] += 1;
  const scopeCounts = zeroed(SCOPE_DISPOSITIONS);
  for (const f of scopeFindings) scopeCounts[f.disposition] += 1;

  // The plan proposes each candidate ONCE: the same legacy value may appear twice for one Employee, and a repeated
  // proposal would be a second command whose only effect is NO_CHANGE.
  const plannedQualifications = new Set<string>();
  const qualifications: PlannedQualification[] = [];
  for (const f of qualificationFindings) {
    if (f.disposition !== "DETERMINISTIC_CANDIDATE" || f.qualificationCode === null) continue;
    const key = `${f.employeeId}|${f.qualificationCode}`;
    if (plannedQualifications.has(key)) continue;
    plannedQualifications.add(key);
    qualifications.push({ operation: "assignEmployeeWorkEligibility", input: { employeeId: f.employeeId, qualificationCode: f.qualificationCode, reason: REASON_QUALIFICATION } });
  }
  const scopes: PlannedScope[] = scopeFindings
    .filter((f) => f.disposition === "DETERMINISTIC_CANDIDATE")
    .map((f) => ({ operation: "assignEmployeeOperationalScope", input: { employeeId: f.employeeId, scopeType: f.scopeType, scopeId: f.legacyValue, reason: REASON_SCOPE } }));

  const actionable = new Set<string>(["DETERMINISTIC_CANDIDATE", "ALREADY_GOVERNED", "DEAD_LEGACY"]);
  return {
    tenantId: view.tenantId,
    exportedAt: snapshot.source.exportedAt,
    employeesInSnapshot: snapshot.employees.length,
    employeesWithLegacyRoles,
    employeesWithLegacyWarehouses,
    qualificationFindings,
    scopeFindings,
    qualificationCounts,
    scopeCounts,
    remediation: [...qualificationFindings, ...scopeFindings].filter((f) => !actionable.has(f.disposition)),
    plan: { qualifications, scopes },
    applied: false,
  };
}
