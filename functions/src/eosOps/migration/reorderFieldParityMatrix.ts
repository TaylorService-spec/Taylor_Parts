// THE LEGACY REORDER FIELD PARITY MATRIX -- the Phase 1 gate for the Reorder Domain Cutover.
//
// Pure data plus derivations: no database, no Firebase, no I/O, no clock, no scanning. Its companion
// suite DERIVES the legacy field set from firestore.rules and asserts the two correspond in BOTH
// directions, so this file cannot silently go stale and cannot silently omit a field.
//
// ════════════════════ WHY A MATRIX BEFORE A COPY ════════════════════
//
// purchasingMigrationMapping.ts already maps the legacy Reorder document to migration 008's row, and
// it maps ELEVEN of the legacy document's THIRTY-EIGHT fields. The other twenty-seven are not
// refused, not recorded and not reported -- they are simply not read. That is the failure mode this
// matrix exists to make impossible: a copy that looks complete because nothing objected.
//
// So there is NO implicit disposition and NO default "ignore". Every field in the closed legacy key
// set carries exactly one classification and a target authority that states WHERE ITS MEANING WENT.
// An unclassified field fails the proof. A field may be absent from the PostgreSQL Reorder row only
// when its disposition explains where the fact now lives.
//
// ════════════════════ WHERE THE FIELD SET COMES FROM ════════════════════
//
// firestore.rules' hasCanonicalReorderRequestKeys() is the CLOSED key set: `data.keys().hasOnly([...])`
// is enforced on every create and every retained update, so a Reorder document cannot carry a field
// outside it. That makes the Rules list the authority for "what a legacy Reorder is", and the test
// extracts it mechanically rather than trusting the list below.
//
// Three of the thirty-eight are in hasOnly() but NOT in hasAll(), which is the record-generation
// seam: `workOrderId` is an optional provenance back-link, and `warehouseId` / `operatingCompanyId`
// are the two governed ownership facts a later trusted command began authoring. A generation-1 row
// carries neither, and the PostgreSQL columns are NOT NULL -- so those rows are REFUSED, never
// backfilled. There is deliberately no default and no fallback in the live create command, and the
// migration does not get to invent one.
//
// ════════════════════ AUTHORED FACTS ARE NOT AUDIT EVENTS ════════════════════
//
// An audit event records that a mutation happened. A review note, a cancellation reason and a void
// reason are the BUSINESS FACTS those mutations produced. They are not interchangeable, and an
// `audit_events` row is not a place to retire an authored field to. Where no governed subordinate
// authority already represents the same fact, the fact stays on the governed Reorder model and the
// schema is corrected to hold it -- which is what `schemaParityCorrection` marks.
export const REORDER_FIELD_DISPOSITIONS = Object.freeze([
  /** The Reorder's own governed business fact. Lives on eos_ops.reorder_requests. */
  "GOVERNED_REORDER_FACT",
  /** Owned by the Reorder Employee Assignment authority (migration 1760140800000). Never a Reorder column. */
  "GOVERNED_ASSIGNMENT_FACT",
  /** The SAME fact, already represented by another governed object. A duplicate representation, retired. */
  "GOVERNED_OTHER_OBJECT_FACT",
  /** The target lifecycle model answers it deterministically, so storing it would be a second, stale copy. */
  "DERIVED",
  /** Provenance about who acted, kept as provenance -- never as authorization. */
  "AUDIT_PROVENANCE",
  /** A Firebase uid. Must be resolved to a governed identity; the uid itself is never copied forward. */
  "LEGACY_IDENTITY",
  /** Evidence about the migration itself. Stays in the report, never in the authority. */
  "MIGRATION_EVIDENCE",
  /** Owner-approved retirement: the fact stops existing, deliberately and on the record. */
  "APPROVED_RETIREMENT",
  /** Unusable as it stands. BLOCKS the copy for its Reorder until a human resolves it. */
  "REMEDIATION_REQUIRED",
] as const);
export type ReorderFieldDisposition = (typeof REORDER_FIELD_DISPOSITIONS)[number];

/** How a legacy value becomes a governed one. A uid is never stored, so conversion is not optional. */
export const IDENTITY_CONVERSIONS = Object.freeze([
  "NONE",
  /** uid -> (identity_provider='firebase', external_subject) -> eos_policy.principals.id */
  "UID_TO_PRINCIPAL",
  /** uid -> Principal -> ACTIVE employee_principal_links -> eos_workforce.employees.id */
  "UID_TO_EMPLOYEE",
] as const);
export type IdentityConversion = (typeof IDENTITY_CONVERSIONS)[number];

export interface ReorderFieldParity {
  readonly legacyField: string;
  readonly disposition: ReorderFieldDisposition;
  /** WHERE THE MEANING WENT. Never blank -- a blank target is how silent loss looks. */
  readonly targetAuthority: string;
  /** Does the value land in the governed PostgreSQL Reorder row? */
  readonly copied: boolean;
  readonly identityConversion: IdentityConversion;
  /** True when the target column does not exist yet and this branch must add it. */
  readonly schemaParityCorrection: boolean;
  /** The condition under which this field blocks the copy, or null when it never does. */
  readonly blocker: string | null;
}

const f = (entry: ReorderFieldParity): ReorderFieldParity => Object.freeze(entry);

export const REORDER_FIELD_PARITY_MATRIX: readonly ReorderFieldParity[] = Object.freeze([
  // ── the Reorder's own identity and quantities ──
  f({
    legacyField: "partId", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.part_id", copied: true, identityConversion: "NONE",
    schemaParityCorrection: false,
    blocker: "partId is not a canonical Part.partId (requireCanonicalPartId refuses it)",
  }),
  f({
    legacyField: "requestedQty", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.requested_quantity", copied: true, identityConversion: "NONE",
    schemaParityCorrection: false, blocker: "requestedQty is not a whole number >= 0",
  }),
  f({
    legacyField: "recommendedQty", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.recommended_quantity", copied: true, identityConversion: "NONE",
    schemaParityCorrection: false, blocker: "recommendedQty is present and not a whole number",
  }),
  f({
    legacyField: "status", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.status (ops_reorder_request_status)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: false,
    blocker: "status is not one of the ten governed reorder statuses",
  }),
  f({
    legacyField: "createdAt", disposition: "GOVERNED_REORDER_FACT",
    // The column DEFAULTs to now(); the copy must pass the legacy instant explicitly. A migrated
    // record whose created_at is the migration's own clock has been quietly rewritten.
    targetAuthority: "eos_ops.reorder_requests.created_at (legacy instant passed EXPLICITLY, never DEFAULT now())",
    copied: true, identityConversion: "NONE", schemaParityCorrection: false,
    blocker: "createdAt is absent or is not a usable instant",
  }),
  f({
    legacyField: "workOrderId", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.work_order_id", copied: true, identityConversion: "NONE",
    schemaParityCorrection: false, blocker: null,
  }),

  // ── the two governed ownership facts: present only on generation-2 records ──
  f({
    legacyField: "warehouseId", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.warehouse_id", copied: true, identityConversion: "NONE",
    schemaParityCorrection: false,
    blocker: "absent (generation-1 record), or names no warehouse in this tenant. NEVER inferred from "
      + "the part, the page, the requester, or the tenant's only warehouse.",
  }),
  f({
    legacyField: "operatingCompanyId", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.operating_company_key", copied: true, identityConversion: "NONE",
    schemaParityCorrection: false,
    blocker: "absent (generation-1 record), not ACTIVE in eos_policy.tenant_operating_companies for this "
      + "tenant, or disagrees with the governed warehouse's operating company (RULING 3)",
  }),

  // ── the recommendation classification: authored at creation, no column today ──
  f({
    legacyField: "recommendationStatus", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.recommendation_status (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "recommendationStatus is absent or outside the governed vocabulary",
  }),
  f({
    legacyField: "urgency", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.urgency (NEW, NULLABLE -- the create command already "
      + "stores null when none was stated)",
    copied: true, identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "quantitySource", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.quantity_source (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "quantitySource is absent or outside the governed vocabulary",
  }),

  // ── REVIEW: authored business facts, and an actor ──
  f({
    legacyField: "reviewDecision", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.review_decision (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "reviewNotes", disposition: "GOVERNED_REORDER_FACT",
    // AUTHORED PROSE. No audit event reproduces what a reviewer chose to write.
    targetAuthority: "eos_ops.reorder_requests.review_notes (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "reviewedAt", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.reviewed_at (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "reviewedBy", disposition: "LEGACY_IDENTITY",
    targetAuthority: "eos_ops.reorder_requests.reviewed_by_principal_id (NEW) -- resolved Principal, never the uid",
    copied: true, identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: true,
    blocker: null,
  }),

  // ── PURCHASING PROGRESS: authored facts, and two actors ──
  f({
    legacyField: "purchasingStartedAt", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.purchasing_started_at (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "purchasingStartedBy", disposition: "LEGACY_IDENTITY",
    targetAuthority: "eos_ops.reorder_requests.purchasing_started_by_principal_id (NEW)", copied: true,
    identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "purchasingNotes", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.purchasing_notes (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "vendorContacted", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.vendor_contacted (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "expectedAvailabilityDate", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.expected_availability_date (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true,
    blocker: "present but not an ISO calendar day -- never parsed by a locale-dependent Date constructor",
  }),
  f({
    legacyField: "lastPurchasingUpdateAt", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.last_purchasing_update_at (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "lastPurchasingUpdateBy", disposition: "LEGACY_IDENTITY",
    targetAuthority: "eos_ops.reorder_requests.last_purchasing_update_by_principal_id (NEW)", copied: true,
    identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: true, blocker: null,
  }),

  // ── CANCELLATION: the Reorder's own terminal transition ──
  f({
    legacyField: "cancellationReason", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.cancellation_reason (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "cancelledAt", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.cancelled_at (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "cancelledBy", disposition: "LEGACY_IDENTITY",
    targetAuthority: "eos_ops.reorder_requests.cancelled_by_principal_id (NEW)", copied: true,
    identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: true, blocker: null,
  }),

  // ── RECEIPT: the Reorder's own terminal transition, NOT the receiving order's ──
  //
  // receiving_orders is a DIFFERENT object with its own lifecycle (EXPECTED -> CHECKED_IN ->
  // PUTAWAY_COMPLETE) and supports partial and multi-line receipts, so its created_at is not the
  // Reorder's "received" instant and there is no 1:1 guarantee. Retiring these into it would be
  // choosing a near-enough fact, which is the thing this matrix exists to prevent.
  f({
    legacyField: "receivedAt", disposition: "GOVERNED_REORDER_FACT",
    targetAuthority: "eos_ops.reorder_requests.received_at (NEW)", copied: true,
    identityConversion: "NONE", schemaParityCorrection: true, blocker: null,
  }),
  f({
    legacyField: "receivedBy", disposition: "LEGACY_IDENTITY",
    targetAuthority: "eos_ops.reorder_requests.received_by_principal_id (NEW)", copied: true,
    identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: true, blocker: null,
  }),

  // ── THE REQUESTER: provenance, measured not assumed ──
  //
  // MEASUREMENT (Ruling 2): `requested_by` is WRITTEN by createReorderRequest and NEVER READ BACK --
  // no SELECT in purchasingRepository.ts names it and ReorderRequestRecord does not carry it. The
  // only decision-shaped uses of the legacy field are firestore.rules' create-time authorship pin
  // (`data.requestedBy == request.auth.uid`) and its immutability pin, neither of which grants
  // anything from a STORED value. It is therefore historical provenance, not load-bearing authority,
  // and an unresolved legacy requester does not block the copy.
  f({
    legacyField: "requestedBy", disposition: "LEGACY_IDENTITY",
    targetAuthority: "eos_ops.reorder_requests.requested_by -- the resolved Principal id, or NULL for a "
      + "MIGRATED row whose uid resolves to no Principal. NEVER the raw uid, never the migration "
      + "executor, never a generic migration Principal.",
    copied: true, identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: true,
    blocker: null,
  }),

  // ── THE ASSIGNMENT TRIPLE: already owned, and not Reorder columns ──
  f({
    legacyField: "assignedToUserId", disposition: "GOVERNED_ASSIGNMENT_FACT",
    targetAuthority: "eos_ops.reorder_request_assignments.assigned_employee_id (migration 1760140800000)",
    copied: false, identityConversion: "UID_TO_EMPLOYEE", schemaParityCorrection: false,
    blocker: "the uid does not resolve EXACTLY to one Employee through an ACTIVE employee_principal_link "
      + "(see reorderAssignmentMigration.ts dispositions)",
  }),
  f({
    legacyField: "assignedBy", disposition: "GOVERNED_ASSIGNMENT_FACT",
    targetAuthority: "eos_ops.reorder_request_assignments.assigned_by_principal_id (NULL when unresolved)",
    copied: false, identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "assignedAt", disposition: "GOVERNED_ASSIGNMENT_FACT",
    targetAuthority: "eos_ops.reorder_request_assignments.effective_from",
    copied: false, identityConversion: "NONE", schemaParityCorrection: false, blocker: null,
  }),

  // ── ALREADY REPRESENTED BY ANOTHER GOVERNED OBJECT: duplicate representation, retired ──
  f({
    legacyField: "purchaseOrderId", disposition: "GOVERNED_OTHER_OBJECT_FACT",
    // Structurally 1:1: purchase_orders.id is PRIMARY KEY REFERENCES reorder_requests(id), so the
    // relationship IS the identity and a back-link column could only ever disagree with it.
    targetAuthority: "eos_ops.purchase_orders.id (PK REFERENCES reorder_requests(id) -- ruling R-16)",
    copied: false, identityConversion: "NONE", schemaParityCorrection: false,
    blocker: "the legacy back-link disagrees with the purchase order's own id",
  }),
  f({
    legacyField: "orderedBy", disposition: "GOVERNED_OTHER_OBJECT_FACT",
    // recordPurchaseOrder writes the PO and sets the request to ORDERED in ONE transaction, so the
    // PO's creator IS the person who ordered it.
    targetAuthority: "eos_ops.purchase_orders.created_by", copied: false,
    identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "orderedAt", disposition: "GOVERNED_OTHER_OBJECT_FACT",
    targetAuthority: "eos_ops.purchase_orders.created_at", copied: false,
    identityConversion: "NONE", schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "voidReason", disposition: "GOVERNED_OTHER_OBJECT_FACT",
    // voidPurchaseOrder writes purchase_order_voids AND sets the request to VOIDED in one
    // transaction. The void record is append-only and already holds all three facts by name.
    targetAuthority: "eos_ops.purchase_order_voids.reason", copied: false,
    identityConversion: "NONE", schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "voidedBy", disposition: "GOVERNED_OTHER_OBJECT_FACT",
    targetAuthority: "eos_ops.purchase_order_voids.voided_by", copied: false,
    identityConversion: "UID_TO_PRINCIPAL", schemaParityCorrection: false, blocker: null,
  }),
  f({
    legacyField: "voidedAt", disposition: "GOVERNED_OTHER_OBJECT_FACT",
    targetAuthority: "eos_ops.purchase_order_voids.voided_at", copied: false,
    identityConversion: "NONE", schemaParityCorrection: false, blocker: null,
  }),

  // ── DERIVED, AND THE DERIVATION IS PROVEN PER ROW ──
  //
  // `currentOwner` has exactly three write sites and ONE reader: a display cell in PartDetail.jsx.
  // It decides nothing. It is a workflow pointer the lifecycle already answers -- but the legacy
  // transitions that do not set it leave the previous value in place, so "deterministic" is a claim
  // about the target model, not an observation about the source. The copy therefore DERIVES it and
  // COMPARES it to the stored value, refusing the row on disagreement rather than assuming.
  f({
    legacyField: "currentOwner", disposition: "DERIVED",
    targetAuthority: "derived from eos_ops.reorder_requests.status by reorderCurrentOwner(); verified "
      + "against the stored legacy value per row at copy time",
    copied: false, identityConversion: "NONE", schemaParityCorrection: false,
    blocker: "the stored currentOwner disagrees with the derivation for its status",
  }),
]);

// ---------------------------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------------------------

/** Fields whose meaning lands in the governed PostgreSQL Reorder row. */
export function copiedFields(
  matrix: readonly ReorderFieldParity[] = REORDER_FIELD_PARITY_MATRIX,
): readonly string[] {
  return Object.freeze(matrix.filter((m) => m.copied).map((m) => m.legacyField).sort());
}

/** Every uid-bearing field, with the conversion it requires. A uid is never copied forward. */
export function identityConversionFields(
  matrix: readonly ReorderFieldParity[] = REORDER_FIELD_PARITY_MATRIX,
): readonly ReorderFieldParity[] {
  return Object.freeze(matrix.filter((m) => m.identityConversion !== "NONE"));
}

/**
 * The columns this branch must add before a copy can be truthful.
 *
 * Derived FROM the matrix rather than listed beside it, so the forward migration and the matrix
 * cannot drift: the migration proof asserts every name here exists.
 */
export function schemaParityCorrections(
  matrix: readonly ReorderFieldParity[] = REORDER_FIELD_PARITY_MATRIX,
): readonly string[] {
  return Object.freeze(matrix.filter((m) => m.schemaParityCorrection).map((m) => m.legacyField).sort());
}

/** Every condition that can block a copy, by field. Evidence for the DRY RUN report. */
export function blockerConditions(
  matrix: readonly ReorderFieldParity[] = REORDER_FIELD_PARITY_MATRIX,
): ReadonlyMap<string, string> {
  return Object.freeze(new Map(
    matrix.filter((m) => m.blocker !== null).map((m) => [m.legacyField, m.blocker as string]),
  ));
}
