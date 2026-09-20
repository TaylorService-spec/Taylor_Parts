// THE LEGACY WORK ORDER FIELD PARITY MATRIX -- the census gate for the Work Order / Service cutover.
//
// Pure data plus derivations: no database, no Firebase, no I/O, no clock, no scanning. Its companion
// suite DERIVES the field set from the `WorkOrder` interface and asserts the two correspond in BOTH
// directions, so this cannot go stale and cannot silently omit a field.
//
// ════════════════════ WHY THE INTERFACE IS THE CONTRACT HERE ════════════════════
//
// For the Reorder object, firestore.rules' `hasOnly([...])` was the closed key set. Work Orders have
// no such list, and for a reason worth stating: `allow create, update, delete: if false`
// (firestore.rules:509). NO CLIENT MAY WRITE A WORK ORDER AT ALL. Every write is Admin SDK, so the
// shape is defined by `functions/src/types/workOrder.ts` and enforced by the commands, not by Rules.
//
// That also means the Firebase FUNCTIONS are the Work Order authority, not merely a transport in
// front of it -- so retiring Firestore here is not enough on its own, and the retirement gate has to
// count callable authority separately from collection access.
//
// ════════════════════ THE FOUR SEPARATIONS, HELD THROUGHOUT ════════════════════
//
//   Owner != Accountable != Assignee
//   Credential != Principal != Employee
//   Security Role != assignment identity
//   assignment never changes record ownership
//
// The legacy record breaks the second one everywhere: `assignedTechId` and `scheduledTechId` are
// `fieldops_technicians` document ids, and `rescheduledByUid` / `reassignedByUid` are FIREBASE UIDS.
// A technician id is not an Employee, and a uid is not a Principal. Every one of those four fields
// therefore carries an identity conversion, and none of them is copied forward as-is.
export const WORK_ORDER_FIELD_DISPOSITIONS = Object.freeze([
  /** The Work Order's own governed business fact. Lives on eos_ops.work_orders. */
  "GOVERNED_WORK_ORDER_FACT",
  /** Owned by the governed Work Order assignment authority, as an interval row -- never a column. */
  "GOVERNED_ASSIGNMENT_FACT",
  /** The SAME fact, already represented by another governed object. A duplicate representation. */
  "GOVERNED_OTHER_OBJECT_FACT",
  /** The target model answers it deterministically, so storing it would be a second, stale copy. */
  "DERIVED",
  /** A Firebase uid or a fieldops_technicians id. Resolved to a governed identity, never copied. */
  "LEGACY_IDENTITY",
  /** A per-write snapshot the interval history replaces. Retired WITH its history preserved. */
  "SUPERSEDED_BY_HISTORY",
  /** Evidence about the migration itself. Stays in the report, never in the authority. */
  "MIGRATION_EVIDENCE",
  /** Owner-approved retirement: the fact stops existing, deliberately and on the record. */
  "APPROVED_RETIREMENT",
  /** Unusable as it stands. BLOCKS the copy for its Work Order until a human resolves it. */
  "REMEDIATION_REQUIRED",
] as const);
export type WorkOrderFieldDisposition = (typeof WORK_ORDER_FIELD_DISPOSITIONS)[number];

/** How a legacy value becomes a governed one. A uid or technician id is never stored. */
export const IDENTITY_CONVERSIONS = Object.freeze([
  "NONE",
  /** uid -> (identity_provider='firebase', external_subject) -> eos_policy.principals.id */
  "UID_TO_PRINCIPAL",
  /**
   * fieldops_technicians/{id} -> Employee.
   *
   * THE HARD ONE. There is no governed mapping today: a technician document is reached from a
   * credential (`users/{uid}.technicianId`), so resolving it to an Employee means going
   * technician -> the uid(s) that name it -> Principal -> ACTIVE employee_principal_link -> Employee.
   * Ambiguity at any hop is a REFUSAL, never a choice.
   */
  "TECHNICIAN_TO_EMPLOYEE",
] as const);
export type IdentityConversion = (typeof IDENTITY_CONVERSIONS)[number];

export interface WorkOrderFieldParity {
  readonly legacyField: string;
  readonly disposition: WorkOrderFieldDisposition;
  /** WHERE THE MEANING WENT. Never blank -- a blank target is how silent loss looks. */
  readonly targetAuthority: string;
  /** Does the value land in the governed PostgreSQL Work Order row? */
  readonly copied: boolean;
  readonly identityConversion: IdentityConversion;
  /** True when the target column does not exist yet and this slice must add it. */
  readonly schemaParityCorrection: boolean;
  /** The condition under which this field blocks the copy, or null when it never does. */
  readonly blocker: string | null;
}

const f = (entry: WorkOrderFieldParity): WorkOrderFieldParity => Object.freeze(entry);

export const WORK_ORDER_FIELD_PARITY_MATRIX: readonly WorkOrderFieldParity[] = Object.freeze([
  // ── identity and classification ──
  f({
    legacyField: "id", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.id (the Firestore document id, carried)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: "a blank or path-shaped id",
  }),
  f({
    legacyField: "woNumber", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.work_order_number (WO-YYYY-######)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "present but malformed -- never normalized into validity, never replaced by the id",
  }),
  f({
    legacyField: "status", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.status (ops_work_order_status, the 11 governed statuses)",
    copied: true, identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "a status outside the governed vocabulary -- fail closed, an unknown state has no meaning",
  }),
  f({
    legacyField: "type", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.work_order_type", copied: true, identityConversion: "NONE",
    schemaParityCorrection: true, blocker: "outside the governed type vocabulary",
  }),
  f({
    legacyField: "priority", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.priority (1..4)", copied: true, identityConversion: "NONE",
    schemaParityCorrection: true, blocker: "not one of the four governed priorities",
  }),
  f({
    legacyField: "severity", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.severity (NULLABLE -- optional on the legacy record)",
    copied: true, identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "present but outside the governed severity vocabulary",
  }),

  // ── the objects this Work Order points at ──
  f({
    legacyField: "customerId", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.customer_id -> eos_crm.accounts", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "names no Account in this tenant. NEVER inferred from the location or the equipment.",
  }),
  f({
    legacyField: "locationId", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.location_id (opaque, as migration 005 treats location ids)",
    copied: true, identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "absent -- a Work Order happens somewhere",
  }),
  f({
    legacyField: "equipmentId", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.equipment_id -> eos_ops.equipment (NULLABLE)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "present but names no Equipment in this tenant",
  }),
  f({
    legacyField: "salesOrderId", disposition: "GOVERNED_OTHER_OBJECT_FACT",
    targetAuthority: "eos_ops.work_orders.sales_order_id -> eos_commercial.sales_orders (NULLABLE)",
    copied: true, identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "present but names no Sales Order in this tenant",
  }),
  f({
    legacyField: "salesOrderLineRefs", disposition: "GOVERNED_OTHER_OBJECT_FACT",
    // An array of line references is a RELATIONSHIP, and a relationship with its own cardinality is
    // a child table, not a JSON column that no foreign key can check.
    targetAuthority: "eos_ops.work_order_sales_order_lines (child rows, one per referenced line)",
    copied: false, identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "a line ref naming a Sales Order line that does not exist",
  }),

  // ── THE ASSIGNMENT AXIS: intervals, not columns ──
  //
  // scheduledTechId and assignedTechId are the SAME person-axis at two lifecycle phases (#1915
  // section 3.2). The phase is the Work Order STATUS, so the target model has ONE current assignee
  // and keeps the rest as history rows. Neither becomes a column on work_orders.
  f({
    legacyField: "scheduledTechId", disposition: "GOVERNED_ASSIGNMENT_FACT",
    targetAuthority: "eos_ops.work_order_assignments.assignee_employee_id (current row, while the "
      + "Work Order is in a scheduled phase)",
    copied: false, identityConversion: "TECHNICIAN_TO_EMPLOYEE", schemaParityCorrection: true,
    blocker: "the technician id does not resolve EXACTLY to one Employee",
  }),
  f({
    legacyField: "assignedTechId", disposition: "GOVERNED_ASSIGNMENT_FACT",
    targetAuthority: "eos_ops.work_order_assignments.assignee_employee_id (current row, once dispatched)",
    copied: false, identityConversion: "TECHNICIAN_TO_EMPLOYEE", schemaParityCorrection: true,
    blocker: "the technician id does not resolve EXACTLY to one Employee",
  }),

  // ── the per-write reassignment snapshots the interval history replaces ──
  //
  // Each of these holds ONLY THE LATEST reassignment and is overwritten by the next one, so the
  // legacy record has already lost every earlier one. The interval rows keep them all. Retiring the
  // snapshots is therefore a GAIN in history, not a loss -- but the surviving latest values are
  // still copied INTO the history as the closing columns of the row they describe.
  f({
    legacyField: "reassignedFromTechId", disposition: "SUPERSEDED_BY_HISTORY",
    targetAuthority: "the CLOSED assignment row whose assignee was that technician "
      + "(end_source='DISPATCH_REASSIGN')",
    copied: false, identityConversion: "TECHNICIAN_TO_EMPLOYEE", schemaParityCorrection: false,
    blocker: null,
  }),
  f({
    legacyField: "reassignedAt", disposition: "SUPERSEDED_BY_HISTORY",
    targetAuthority: "that row's effective_to, and the next row's effective_from", copied: false,
    identityConversion: "NONE", schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "reassignedReason", disposition: "SUPERSEDED_BY_HISTORY",
    targetAuthority: "that row's end_reason", copied: false, identityConversion: "NONE",
    schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "reassignedByUid", disposition: "LEGACY_IDENTITY",
    targetAuthority: "that row's ended_by_principal_id -- the resolved Principal, never the uid",
    copied: false, identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: false,
    blocker: null,
  }),
  f({
    legacyField: "rescheduledFromTechId", disposition: "SUPERSEDED_BY_HISTORY",
    targetAuthority: "the CLOSED assignment row (end_source='REASSIGN_SCHEDULED')", copied: false,
    identityConversion: "TECHNICIAN_TO_EMPLOYEE", schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "rescheduledAt", disposition: "SUPERSEDED_BY_HISTORY",
    targetAuthority: "that row's effective_to / the next row's effective_from", copied: false,
    identityConversion: "NONE", schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "rescheduledReason", disposition: "SUPERSEDED_BY_HISTORY",
    targetAuthority: "that row's end_reason", copied: false, identityConversion: "NONE",
    schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "rescheduledByUid", disposition: "LEGACY_IDENTITY",
    targetAuthority: "that row's ended_by_principal_id", copied: false,
    identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "rescheduledFromStart", disposition: "SUPERSEDED_BY_HISTORY",
    // The SCHEDULE is a Work Order fact, not an assignment fact (#1915 design rule 5), so its
    // history belongs to a schedule history and not to the assignment interval.
    targetAuthority: "eos_ops.work_order_schedule_history.previous_start", copied: false,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "rescheduledFromEnd", disposition: "SUPERSEDED_BY_HISTORY",
    targetAuthority: "eos_ops.work_order_schedule_history.previous_end", copied: false,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),

  // ── the schedule itself ──
  f({
    legacyField: "scheduledStart", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.scheduled_start (NULLABLE until scheduled)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "a start without an end, or an end before its start",
  }),
  f({
    legacyField: "scheduledEnd", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.scheduled_end (NULLABLE until scheduled)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "estimatedDurationMinutes", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.estimated_duration_minutes", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "present and not a positive whole number of minutes",
  }),

  // ── lifecycle timestamps: each is the moment a governed transition happened ──
  ...(["dispatchedAt", "acceptedAt", "enRouteAt", "arrivedAt", "workStartedAt", "completedAt", "closedAt"]
    .map((legacyField) => f({
      legacyField, disposition: "GOVERNED_WORK_ORDER_FACT" as const,
      targetAuthority: `eos_ops.work_orders.${legacyField.replace(/([A-Z])/g, "_$1").toLowerCase()}`,
      copied: true, identityConversion: "NONE" as const, schemaParityCorrection: true,
      blocker: "present but not a usable instant -- never coerced",
    }))),

  // ── authored execution facts ──
  f({
    legacyField: "complaint", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.complaint", copied: true, identityConversion: "NONE",
    schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "diagnosis", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.diagnosis", copied: true, identityConversion: "NONE",
    schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "resolution", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.resolution", copied: true, identityConversion: "NONE",
    schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "laborHours", disposition: "GOVERNED_OTHER_OBJECT_FACT",
    // Labor already has its own governed command and its own records; a denormalized total on the
    // Work Order would be a second answer to "how many hours", and the two would drift.
    targetAuthority: "the Work Order labor authority (workOrderLaborCommand), summed -- never a "
      + "denormalized column",
    copied: false, identityConversion: "NONE", schemaParityCorrection: false,
    blocker: "a stored total that disagrees with the sum of its labor records",
  }),

  // ── arrays and logs ──
  f({
    legacyField: "inventorySnapshot", disposition: "GOVERNED_OTHER_OBJECT_FACT",
    targetAuthority: "eos_ops.work_order_inventory_effects (already a governed table)", copied: false,
    identityConversion: "NONE", schemaParityCorrection: false,
    blocker: "a snapshot line naming a Part that does not exist",
  }),
  f({
    legacyField: "executionLog", disposition: "SUPERSEDED_BY_HISTORY",
    targetAuthority: "eos_ops.work_order_transitions (one row per governed transition, append-only)",
    copied: false, identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: true,
    blocker: "a log entry naming a status outside the governed vocabulary",
  }),

  // ── record bookkeeping ──
  f({
    legacyField: "createdAt", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.created_at (the legacy instant, passed EXPLICITLY)",
    copied: true, identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "absent or not a usable instant",
  }),
  f({
    legacyField: "updatedAt", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.updated_at", copied: true, identityConversion: "NONE",
    schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "lastUpdated", disposition: "DERIVED",
    // TWO fields for one fact. `updated_at` is the one the governed row keeps; a second column that
    // means the same thing is how two readers come to disagree about when a record last changed.
    targetAuthority: "eos_ops.work_orders.updated_at -- the same fact under one name", copied: false,
    identityConversion: "NONE", schemaParityCorrection: false,
    blocker: "lastUpdated and updatedAt disagree, which means the record has two update histories",
  }),
  f({
    legacyField: "partsPlanUpdatedAt", disposition: "GOVERNED_WORK_ORDER_FACT",
    targetAuthority: "eos_ops.work_orders.parts_plan_updated_at (NULLABLE)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
]);

// ---------------------------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------------------------

/** Fields whose meaning lands in the governed PostgreSQL Work Order row. */
export function copiedFields(
  matrix: readonly WorkOrderFieldParity[] = WORK_ORDER_FIELD_PARITY_MATRIX,
): readonly string[] {
  return Object.freeze(matrix.filter((m) => m.copied).map((m) => m.legacyField).sort());
}

/** Every identity-bearing field, with the conversion it requires. Nothing legacy is copied forward. */
export function identityConversionFields(
  matrix: readonly WorkOrderFieldParity[] = WORK_ORDER_FIELD_PARITY_MATRIX,
): readonly WorkOrderFieldParity[] {
  return Object.freeze(matrix.filter((m) => m.identityConversion !== "NONE"));
}

/** The columns and tables this slice must add. Derived FROM the matrix so they cannot drift. */
export function schemaParityCorrections(
  matrix: readonly WorkOrderFieldParity[] = WORK_ORDER_FIELD_PARITY_MATRIX,
): readonly string[] {
  return Object.freeze(matrix.filter((m) => m.schemaParityCorrection).map((m) => m.legacyField).sort());
}

/** Every condition that can block a copy, by field. Evidence for the DRY RUN report. */
export function blockerConditions(
  matrix: readonly WorkOrderFieldParity[] = WORK_ORDER_FIELD_PARITY_MATRIX,
): ReadonlyMap<string, string> {
  return Object.freeze(new Map(
    matrix.filter((m) => m.blocker !== null).map((m) => [m.legacyField, m.blocker as string]),
  ));
}
