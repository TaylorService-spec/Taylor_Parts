// ████████████████████████████ TEMPORARY ████████████████████████████
//
// LEGACY REORDER ASSIGNMENT MIGRATION -- classifying existing `assignedToUserId` assignments for the governed
// Employee assignment authority.
//
// Pure: no database, no Firebase, no I/O, no clock. Both sides arrive as gathered facts, so the classification is a
// function of its inputs and two runs over the same evidence produce identical dispositions.
//
// ════════════════════ TWO QUESTIONS, NOT ONE ════════════════════
//
// A legacy row carries two identities, and they are not the same fact:
//
//   assignedToUserId  WHO IS ASSIGNED THE WORK        -> must resolve EXACTLY to an Employee, or activation is
//                                                        BLOCKED for that Reorder. There is no acceptable guess.
//   assignedBy        WHO PERFORMED THAT ASSIGNMENT   -> provenance. Preserved when it resolves exactly; recorded
//                                                        as UNKNOWN when it does not, which is NON-BLOCKING.
//
// An unresolved historical assignor does NOT make the current business assignment unknown. Conflating them would
// block a migration on a fact nobody needs, or -- far worse -- invite someone to fabricate an actor to unblock it.
//
// ════════════════════ THE RESOLUTION CHAIN, AND WHAT IS FORBIDDEN ════════════════════
//
//   Firebase uid  ->  (identity_provider='firebase', external_subject)  ->  Principal
//                 ->  ACTIVE employee_principal_links row               ->  Employee id
//
// EXACT ONLY. Nothing is matched by name, email similarity, Job Role, title, operationalRoles or Security Role, and
// this module cannot: it receives a resolution map keyed by uid and never sees a name, an address or a role.
//
// THE UID IS NEVER COPIED FORWARD. It is migration evidence and stays in the report. The governed authority stores
// `assigned_employee_id`, and a uid has no column to land in.
//
// ════════════════════ WHAT THIS MODULE IS NOT ════════════════════
//
// It writes nothing, activates nothing and authorizes nothing. Producing a plan is not executing one, and the
// existence of this tooling is not a reason to activate the governed assignment authority.
export const ASSIGNEE_DISPOSITIONS = Object.freeze([
  /** The uid resolved through Principal and an ACTIVE link to exactly one Employee. Migratable. */
  "EXACT_EMPLOYEE_ASSIGNMENT",
  /** A current governed assignment already names that Employee. Nothing to copy; never overwritten. */
  "ALREADY_GOVERNED",
  /** No Principal carries that external subject. BLOCKING. */
  "UID_PRINCIPAL_NOT_FOUND",
  /** The Principal exists but has no ACTIVE Employee link. BLOCKING. */
  "PRINCIPAL_EMPLOYEE_LINK_NOT_FOUND",
  /** More than one active link resolves: ambiguous, and ambiguity is never resolved by choosing. BLOCKING. */
  "MULTIPLE_EMPLOYEE_LINKS",
  /** The link names an Employee the governed authority does not have. BLOCKING. */
  "EMPLOYEE_NOT_FOUND",
  /** The resolved Principal or Employee belongs to another tenant. BLOCKING. */
  "CROSS_TENANT",
  /** The source row itself is unusable -- a blank or malformed assignee. BLOCKING. */
  "REMEDIATION_REQUIRED",
] as const);
export type AssigneeDisposition = (typeof ASSIGNEE_DISPOSITIONS)[number];

/** Dispositions that permit a row to be copied. Everything else blocks activation FOR THAT REORDER. */
export const MIGRATABLE_DISPOSITIONS: readonly AssigneeDisposition[] = Object.freeze(["EXACT_EMPLOYEE_ASSIGNMENT"]);
const NON_BLOCKING = new Set<AssigneeDisposition>(["EXACT_EMPLOYEE_ASSIGNMENT", "ALREADY_GOVERNED"]);

/** The historical assignor is provenance, so it has only two outcomes and neither blocks. */
export const ASSIGNOR_DISPOSITIONS = Object.freeze(["EXACT_PRINCIPAL", "UNRESOLVED_PROVENANCE"] as const);
export type AssignorDisposition = (typeof ASSIGNOR_DISPOSITIONS)[number];

/** One legacy Reorder assignment, exactly as exported. Both identities are Firebase uids. */
export interface LegacyReorderAssignment {
  readonly reorderRequestId: string;
  readonly assignedToUserId: unknown;
  readonly assignedBy: unknown;
}

/** What a uid resolves to, read from PostgreSQL. `null` means no Principal carries that subject. */
export interface UidResolution {
  readonly principalId: string;
  /**
   * The tenant of the Principal's membership in the tenant being migrated, or NULL when it has none.
   *
   * NULL is not "unknown": the view resolves membership FOR THIS TENANT, so a null means the Principal exists and
   * is not a member here -- which is CROSS_TENANT, a different problem from a member who has no Employee link.
   */
  readonly tenantId: string | null;
  /** Employee ids reached through ACTIVE links. Zero, one, or -- ambiguously -- more. */
  readonly activeEmployeeIds: readonly string[];
}

export interface MigrationResolutionView {
  readonly tenantId: string;
  /** uid -> resolution, or null when no Principal carries that external subject. */
  readonly byUid: ReadonlyMap<string, UidResolution | null>;
  /** Employee ids the governed authority holds for this tenant. */
  readonly employees: ReadonlySet<string>;
  /** `${reorderRequestId}` -> currently assigned Employee id, for rows already governed. */
  readonly currentAssignments: ReadonlyMap<string, string>;
}

export interface AssignmentMigrationRow {
  readonly reorderRequestId: string;
  readonly disposition: AssigneeDisposition;
  /** The Employee this row would be assigned to. Null unless migratable or already governed. */
  readonly assignedEmployeeId: string | null;
  readonly assignorDisposition: AssignorDisposition;
  /** The historical assignor, preserved ONLY when it resolved exactly. Null otherwise -- never invented. */
  readonly assignedByPrincipalId: string | null;
  /** True when this row blocks activation for its Reorder. */
  readonly blocking: boolean;
}

export interface AssignmentMigrationPlan {
  readonly tenantId: string;
  readonly sourceRows: number;
  readonly rows: readonly AssignmentMigrationRow[];
  readonly counts: Readonly<Record<AssigneeDisposition, number>>;
  readonly assignorCounts: Readonly<Record<AssignorDisposition, number>>;
  /** Reorder ids whose CURRENT assignee did not resolve. Activation is blocked for these. */
  readonly blockedReorderIds: readonly string[];
  /** The rows a COPY would insert. Empty when anything blocks -- copy is all-or-nothing per run. */
  readonly copyable: readonly AssignmentMigrationRow[];
  /** Always false. Planning is not copying. */
  readonly applied: false;
}

const exactId = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && !v.includes("/");

function resolveAssignee(
  row: LegacyReorderAssignment, view: MigrationResolutionView,
): { disposition: AssigneeDisposition; employeeId: string | null } {
  if (!exactId(row.assignedToUserId)) return { disposition: "REMEDIATION_REQUIRED", employeeId: null };
  const governed = view.currentAssignments.get(row.reorderRequestId);
  const resolution = view.byUid.get(row.assignedToUserId);
  if (resolution === undefined || resolution === null) {
    // Already governed takes precedence over an unresolvable source: the answer is already correct, and the legacy
    // uid is then only evidence about how it used to be recorded.
    if (governed) return { disposition: "ALREADY_GOVERNED", employeeId: governed };
    return { disposition: "UID_PRINCIPAL_NOT_FOUND", employeeId: null };
  }
  // NOT A MEMBER HERE, or a member of somewhere else: either way the Principal belongs to another tenant, and
  // that is a distinct finding from a local member who simply has no Employee link.
  if (resolution.tenantId === null || resolution.tenantId !== view.tenantId) {
    return { disposition: "CROSS_TENANT", employeeId: null };
  }
  const links = resolution.activeEmployeeIds;
  if (links.length === 0) {
    if (governed) return { disposition: "ALREADY_GOVERNED", employeeId: governed };
    return { disposition: "PRINCIPAL_EMPLOYEE_LINK_NOT_FOUND", employeeId: null };
  }
  // AMBIGUITY IS NEVER RESOLVED BY CHOOSING. Two active links mean the source cannot say who is assigned.
  if (links.length > 1) return { disposition: "MULTIPLE_EMPLOYEE_LINKS", employeeId: null };
  const employeeId = links[0];
  if (!view.employees.has(employeeId)) return { disposition: "EMPLOYEE_NOT_FOUND", employeeId: null };
  if (governed) {
    // A governed assignment naming someone ELSE is not "already governed" -- it is a real disagreement, and
    // silently replacing it is exactly what the copy must never do.
    return governed === employeeId
      ? { disposition: "ALREADY_GOVERNED", employeeId }
      : { disposition: "REMEDIATION_REQUIRED", employeeId: null };
  }
  return { disposition: "EXACT_EMPLOYEE_ASSIGNMENT", employeeId };
}

/**
 * Resolve the historical assignor. Provenance only, and NEVER blocking.
 *
 * Exact resolution preserves the Principal. Anything else records UNRESOLVED_PROVENANCE with a null actor, which
 * the governed schema represents truthfully as `provenance = MIGRATED` with no `assigned_by_principal_id`. The
 * migration executor is a different question entirely and is recorded as an audit event by the copy, never here.
 */
function resolveAssignor(
  row: LegacyReorderAssignment, view: MigrationResolutionView,
): { disposition: AssignorDisposition; principalId: string | null } {
  if (!exactId(row.assignedBy)) return { disposition: "UNRESOLVED_PROVENANCE", principalId: null };
  const resolution = view.byUid.get(row.assignedBy);
  if (!resolution) return { disposition: "UNRESOLVED_PROVENANCE", principalId: null };
  if (resolution.tenantId === null || resolution.tenantId !== view.tenantId) {
    return { disposition: "UNRESOLVED_PROVENANCE", principalId: null };
  }
  return { disposition: "EXACT_PRINCIPAL", principalId: resolution.principalId };
}

const zeroed = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/** Classify every legacy assignment. Deterministic: rows are returned sorted by Reorder id. */
export function planReorderAssignmentMigration(
  source: readonly LegacyReorderAssignment[], view: MigrationResolutionView,
): AssignmentMigrationPlan {
  const rows = source.map((row): AssignmentMigrationRow => {
    const assignee = resolveAssignee(row, view);
    const assignor = resolveAssignor(row, view);
    return Object.freeze({
      reorderRequestId: row.reorderRequestId,
      disposition: assignee.disposition,
      assignedEmployeeId: assignee.employeeId,
      assignorDisposition: assignor.disposition,
      assignedByPrincipalId: assignor.principalId,
      blocking: !NON_BLOCKING.has(assignee.disposition),
    });
  }).sort((a, b) => a.reorderRequestId.localeCompare(b.reorderRequestId));

  const counts = zeroed(ASSIGNEE_DISPOSITIONS);
  const assignorCounts = zeroed(ASSIGNOR_DISPOSITIONS);
  for (const r of rows) { counts[r.disposition] += 1; assignorCounts[r.assignorDisposition] += 1; }

  return Object.freeze({
    tenantId: view.tenantId,
    sourceRows: source.length,
    rows: Object.freeze(rows),
    counts: Object.freeze(counts),
    assignorCounts: Object.freeze(assignorCounts),
    blockedReorderIds: Object.freeze(rows.filter((r) => r.blocking).map((r) => r.reorderRequestId)),
    copyable: Object.freeze(rows.filter((r) => MIGRATABLE_DISPOSITIONS.includes(r.disposition))),
    applied: false,
  });
}
