// LEGACY REORDER OBJECT -> GOVERNED eos_ops.reorder_requests: the COMPLETE classifier.
//
// Pure: no database, no Firebase, no I/O, no clock, no randomness. Both sides arrive as gathered
// facts, so two runs over the same evidence produce identical dispositions.
//
// ════════════════════ WHY THIS EXISTS BESIDE purchasingMigrationMapping ════════════════════
//
// mapLegacyReorderRequest is CORRECT and is reused here unchanged -- it owns part-id
// canonicalization, the status vocabulary, the quantity rules and the RR-number format, and those
// refusals are not re-litigated. What it does not do is cover the whole document: it reads eleven of
// the thirty-eight fields in firestore.rules' closed key set and ignores the rest without objecting.
//
// This module supplies exactly the difference, driven by reorderFieldParityMatrix.ts: every field
// the matrix marks `copied` is read here or by the mapper, and every field it marks with a blocker
// has that blocker enforced here. A field cannot be forgotten, because the matrix's own suite fails
// when a legacy field carries no disposition.
//
// ════════════════════ IDENTITY ════════════════════
//
// SIX legacy actor fields hold Firebase uids. None of them is copied forward as a uid. Each resolves
// EXACTLY -- (identity_provider='firebase', external_subject) -> Principal -> membership in THIS
// tenant -- or becomes NULL, which the governed schema represents truthfully on a MIGRATED row.
//
// No name matching, no email guessing, no Job Role inference, no Security Role inference. This
// module cannot do any of it: it receives a map keyed by uid and never sees a name or an address.
//
// An unresolved historical actor is NOT a blocker. It is a fact about a record nobody can recover,
// and the alternatives -- inventing a Principal, substituting the migration executor, or recording a
// generic "migration Principal" as though that person acted -- are all worse than saying "unknown".
import {
  mapLegacyReorderRequest, type MappingOptions, type PurchasingRefusalCode,
} from "./purchasingMigrationMapping.js";

/** Refusals this module adds. The mapper's own codes are reused, never duplicated. */
export const REORDER_OBJECT_REFUSAL_CODES = [
  /** The warehouse names no warehouse in this tenant. Never inferred from the part or the requester. */
  "WAREHOUSE_NOT_IN_TENANT",
  /** RULING 3: the warehouse's governed operating company disagrees with the Reorder's. */
  "WAREHOUSE_COMPANY_DISAGREEMENT",
  /** A review decision outside the two firestore.rules admits. */
  "UNKNOWN_REVIEW_DECISION",
  /** A decision without its moment, or a moment without its decision. Half a review is not a review. */
  "REVIEW_HALF_RECORDED",
  /** A terminal status whose own instant is missing, leaving the status unexplained. */
  "MISSING_TERMINAL_MOMENT",
  /** vendorContacted is present and is not a boolean. */
  "INVALID_VENDOR_CONTACTED",
  /** currentOwner disagrees with what the lifecycle derives for its status. */
  "CURRENT_OWNER_DISAGREEMENT",
  /** The legacy purchaseOrderId back-link does not name this record. */
  "PO_BACKLINK_MISMATCH",
  /** An instant that is neither epoch milliseconds nor an ISO timestamp. Never coerced. */
  "INVALID_INSTANT",
] as const;
export type ReorderObjectRefusalCode = (typeof REORDER_OBJECT_REFUSAL_CODES)[number];

export type ReorderRefusalCode = PurchasingRefusalCode | ReorderObjectRefusalCode;

export const REORDER_OBJECT_DISPOSITIONS = Object.freeze([
  /** Fully resolved. A COPY would insert it. */
  "MIGRATABLE",
  /** The governed authority already holds this id. Never overwritten. */
  "ALREADY_PRESENT",
  /** Refused, with a code and enough non-secret evidence for a reject bucket. */
  "REFUSED",
] as const);
export type ReorderObjectDisposition = (typeof REORDER_OBJECT_DISPOSITIONS)[number];

/** The historical actor resolution. Provenance only, and never blocking. */
export const ACTOR_DISPOSITIONS = Object.freeze(["EXACT_PRINCIPAL", "UNRESOLVED_PROVENANCE"] as const);
export type ActorDisposition = (typeof ACTOR_DISPOSITIONS)[number];

/** THE SIX legacy actor fields, in the order the matrix classifies them. */
export const LEGACY_ACTOR_FIELDS = Object.freeze([
  "requestedBy", "reviewedBy", "purchasingStartedBy", "lastPurchasingUpdateBy", "cancelledBy", "receivedBy",
] as const);
export type LegacyActorField = (typeof LEGACY_ACTOR_FIELDS)[number];

export interface UidPrincipal {
  readonly principalId: string;
  /** The tenant of the Principal's membership in the tenant being migrated, or null when it has none. */
  readonly tenantId: string | null;
}

export interface ReorderResolutionView {
  readonly tenantId: string;
  /** uid -> Principal, or null when no Principal carries that external subject. */
  readonly byUid: ReadonlyMap<string, UidPrincipal | null>;
  /** warehouse id -> its governed operating_company_key, for warehouses in THIS tenant only. */
  readonly warehouseCompany: ReadonlyMap<string, string>;
  /** Reorder ids the governed authority already holds for this tenant. */
  readonly existingReorderIds: ReadonlySet<string>;
}

export interface ReorderObjectRow {
  readonly id: string;
  readonly operatingCompanyKey: string;
  readonly partId: string;
  readonly warehouseId: string;
  readonly status: string;
  readonly requestedQuantity: number;
  readonly recommendedQuantity: number | null;
  readonly workOrderId: string | null;
  readonly reorderRequestNumber: string | null;
  readonly createdAt: string;
  readonly recommendationStatus: string;
  readonly urgency: string | null;
  readonly quantitySource: string;
  readonly reviewDecision: string | null;
  readonly reviewNotes: string | null;
  readonly reviewedAt: string | null;
  readonly purchasingStartedAt: string | null;
  readonly purchasingNotes: string | null;
  readonly vendorContacted: boolean | null;
  readonly expectedAvailabilityDate: string | null;
  readonly lastPurchasingUpdateAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
  readonly receivedAt: string | null;
  /** Resolved Principal ids, keyed by legacy actor field. Absent means unresolved, never a uid. */
  readonly actors: Readonly<Record<LegacyActorField, string | null>>;
}

export interface ReorderObjectPlanRow {
  readonly reorderRequestId: string;
  readonly disposition: ReorderObjectDisposition;
  readonly row: ReorderObjectRow | null;
  readonly refusalCode: ReorderRefusalCode | null;
  readonly detail: string | null;
  /** Per-actor provenance. Present on every classified row, blocking on none. */
  readonly actorDispositions: Readonly<Record<LegacyActorField, ActorDisposition>>;
}

export interface ReorderObjectPlan {
  readonly tenantId: string;
  readonly sourceRows: number;
  readonly rows: readonly ReorderObjectPlanRow[];
  readonly counts: Readonly<Record<ReorderObjectDisposition, number>>;
  readonly refusalCounts: Readonly<Record<string, number>>;
  readonly unresolvedActors: number;
  /** The rows a COPY would insert. */
  readonly copyable: readonly ReorderObjectPlanRow[];
  /** Always false. Planning is not copying. */
  readonly applied: false;
}

// ---------------------------------------------------------------------------------------------
// The derived lifecycle pointer
// ---------------------------------------------------------------------------------------------

/**
 * `currentOwner`, derived from status.
 *
 * The legacy field is written at three transitions and read by ONE display cell; it decides nothing.
 * The transitions that do not set it leave the previous value in place, so this derivation is a
 * statement about the TARGET lifecycle, not an observation about the source -- which is exactly why
 * the copy compares it to the stored value per row instead of assuming they agree.
 *
 * Terminal states return null: once a Reorder is cancelled or voided, nobody owns it next.
 */
export function deriveReorderCurrentOwner(status: string): string | null {
  switch (status) {
    case "PENDING_REVIEW": case "REJECTED": return "INVENTORY";
    case "APPROVED": case "READY_FOR_PARTS_MANAGER": return "PARTS_MANAGER";
    case "ASSIGNED_TO_PARTS_ASSOCIATE": case "PURCHASING_IN_PROGRESS":
    case "ORDERED": case "RECEIVED": return "PARTS_ASSOCIATE";
    case "CANCELLED": case "VOIDED": return null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Value readers. Each REFUSES rather than coerces.
// ---------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exactId = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && !v.includes("/");
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const ISO_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * An instant, as ISO-8601.
 *
 * Firestore stores `createdAt` as epoch MILLISECONDS (firestore.rules asserts `is number`), and the
 * later stamps are written the same way. Anything else -- a free string, a locale date, a Firestore
 * Timestamp shape this module cannot see -- is REFUSED, never handed to `new Date(...)` to be
 * guessed at.
 */
function instant(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) {
    return { ok: true, value: new Date(v).toISOString() };
  }
  if (typeof v === "string" && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return { ok: true, value: new Date(v).toISOString() };
  }
  return { ok: false };
}

const refuse = (
  id: string, code: ReorderRefusalCode, detail: string,
  actorDispositions: Record<LegacyActorField, ActorDisposition>,
): ReorderObjectPlanRow => Object.freeze({
  reorderRequestId: id, disposition: "REFUSED" as const, row: null,
  refusalCode: code, detail, actorDispositions: Object.freeze(actorDispositions),
});

function resolveActors(
  data: Record<string, unknown>, view: ReorderResolutionView,
): { actors: Record<LegacyActorField, string | null>; dispositions: Record<LegacyActorField, ActorDisposition> } {
  const actors = {} as Record<LegacyActorField, string | null>;
  const dispositions = {} as Record<LegacyActorField, ActorDisposition>;
  for (const field of LEGACY_ACTOR_FIELDS) {
    const uid = data[field];
    if (!exactId(uid)) { actors[field] = null; dispositions[field] = "UNRESOLVED_PROVENANCE"; continue; }
    const resolved = view.byUid.get(uid);
    // A Principal who is not a member HERE is not this tenant's actor, and recording them would
    // assert a membership nobody granted.
    if (!resolved || resolved.tenantId === null || resolved.tenantId !== view.tenantId) {
      actors[field] = null; dispositions[field] = "UNRESOLVED_PROVENANCE"; continue;
    }
    actors[field] = resolved.principalId; dispositions[field] = "EXACT_PRINCIPAL";
  }
  return { actors, dispositions };
}

function classifyOne(
  documentId: unknown, data: unknown, view: ReorderResolutionView, options: MappingOptions,
): ReorderObjectPlanRow {
  const id = typeof documentId === "string" ? documentId : "";
  const none = Object.fromEntries(
    LEGACY_ACTOR_FIELDS.map((k) => [k, "UNRESOLVED_PROVENANCE"]),
  ) as Record<LegacyActorField, ActorDisposition>;

  // The proven mapper first: part id, status, quantities, RR number, company presence, warehouse
  // presence. Its refusals are this module's refusals.
  const mapped = mapLegacyReorderRequest(documentId, data, options);
  if (mapped.ok !== true) return refuse(id, mapped.code, mapped.detail, none);
  if (!isObject(data)) return refuse(id, "INVALID_SOURCE_ROW", "source document is not an object", none);

  const core = mapped.row;
  if (view.existingReorderIds.has(core.id)) {
    const { dispositions } = resolveActors(data, view);
    return Object.freeze({
      reorderRequestId: core.id, disposition: "ALREADY_PRESENT" as const, row: null,
      refusalCode: null, detail: null, actorDispositions: Object.freeze(dispositions),
    });
  }

  // ── RULING 3, the half that is unambiguous: the warehouse and the company must agree ──
  const warehouseCompany = view.warehouseCompany.get(core.warehouseId);
  if (warehouseCompany === undefined) {
    return refuse(core.id, "WAREHOUSE_NOT_IN_TENANT",
      `warehouseId "${core.warehouseId}" names no warehouse in this tenant`, none);
  }
  if (warehouseCompany !== core.operatingCompanyKey) {
    return refuse(core.id, "WAREHOUSE_COMPANY_DISAGREEMENT",
      "the Reorder's operating company disagrees with its warehouse's governed operating company", none);
  }

  // ── the derived pointer, PROVEN rather than assumed ──
  const storedOwner = text(data.currentOwner);
  const derivedOwner = deriveReorderCurrentOwner(core.status);
  if (storedOwner !== null && derivedOwner !== null && storedOwner !== derivedOwner) {
    return refuse(core.id, "CURRENT_OWNER_DISAGREEMENT",
      `currentOwner ${storedOwner} disagrees with ${derivedOwner} derived from status ${core.status}`, none);
  }

  // ── the back-link is the identity, so a disagreement is a corrupt record ──
  const backlink = text(data.purchaseOrderId);
  if (backlink !== null && backlink !== core.id) {
    return refuse(core.id, "PO_BACKLINK_MISMATCH",
      "the legacy purchaseOrderId back-link does not name this record", none);
  }

  const created = instant(data.createdAt);
  if (!created.ok || created.value === null) {
    return refuse(core.id, "INVALID_INSTANT", "createdAt is absent or is not a usable instant", none);
  }

  const recommendationStatus = text(data.recommendationStatus);
  if (recommendationStatus === null) {
    return refuse(core.id, "MISSING_REQUIRED_TEXT", "recommendationStatus is required", none);
  }
  const quantitySource = text(data.quantitySource);
  if (quantitySource === null) {
    return refuse(core.id, "MISSING_REQUIRED_TEXT", "quantitySource is required", none);
  }

  const reviewDecision = text(data.reviewDecision);
  if (reviewDecision !== null && reviewDecision !== "APPROVED" && reviewDecision !== "REJECTED") {
    return refuse(core.id, "UNKNOWN_REVIEW_DECISION", `reviewDecision ${reviewDecision} is not governed`, none);
  }
  const reviewedAt = instant(data.reviewedAt);
  if (!reviewedAt.ok) return refuse(core.id, "INVALID_INSTANT", "reviewedAt is not a usable instant", none);
  if ((reviewDecision === null) !== (reviewedAt.value === null)) {
    return refuse(core.id, "REVIEW_HALF_RECORDED", "a review decision and its moment must travel together", none);
  }

  const purchasingStartedAt = instant(data.purchasingStartedAt);
  if (!purchasingStartedAt.ok) return refuse(core.id, "INVALID_INSTANT", "purchasingStartedAt is not a usable instant", none);
  const lastPurchasingUpdateAt = instant(data.lastPurchasingUpdateAt);
  if (!lastPurchasingUpdateAt.ok) return refuse(core.id, "INVALID_INSTANT", "lastPurchasingUpdateAt is not a usable instant", none);
  const cancelledAt = instant(data.cancelledAt);
  if (!cancelledAt.ok) return refuse(core.id, "INVALID_INSTANT", "cancelledAt is not a usable instant", none);
  const receivedAt = instant(data.receivedAt);
  if (!receivedAt.ok) return refuse(core.id, "INVALID_INSTANT", "receivedAt is not a usable instant", none);

  if (data.vendorContacted !== null && data.vendorContacted !== undefined
    && typeof data.vendorContacted !== "boolean") {
    return refuse(core.id, "INVALID_VENDOR_CONTACTED", "vendorContacted is present and is not a boolean", none);
  }
  const expected = data.expectedAvailabilityDate;
  if (expected !== null && expected !== undefined && !(typeof expected === "string" && ISO_DAY.test(expected))) {
    return refuse(core.id, "INVALID_DATE", "expectedAvailabilityDate is not an ISO calendar day", none);
  }

  // A terminal status states its own instant. Without it the status is unexplained, and a status
  // nobody can account for is not a record worth migrating.
  if (core.status === "CANCELLED" && cancelledAt.value === null) {
    return refuse(core.id, "MISSING_TERMINAL_MOMENT", "status is CANCELLED with no cancelledAt", none);
  }
  if (core.status === "RECEIVED" && receivedAt.value === null) {
    return refuse(core.id, "MISSING_TERMINAL_MOMENT", "status is RECEIVED with no receivedAt", none);
  }

  const { actors, dispositions } = resolveActors(data, view);
  return Object.freeze({
    reorderRequestId: core.id,
    disposition: "MIGRATABLE" as const,
    refusalCode: null,
    detail: null,
    actorDispositions: Object.freeze(dispositions),
    row: Object.freeze({
      id: core.id,
      operatingCompanyKey: core.operatingCompanyKey,
      partId: core.partId,
      warehouseId: core.warehouseId,
      status: core.status,
      requestedQuantity: core.requestedQuantity,
      recommendedQuantity: core.recommendedQuantity,
      workOrderId: core.workOrderId,
      reorderRequestNumber: core.reorderRequestNumber,
      createdAt: created.value,
      recommendationStatus,
      urgency: text(data.urgency),
      quantitySource,
      reviewDecision,
      reviewNotes: text(data.reviewNotes),
      reviewedAt: reviewedAt.value,
      purchasingStartedAt: purchasingStartedAt.value,
      purchasingNotes: text(data.purchasingNotes),
      vendorContacted: typeof data.vendorContacted === "boolean" ? data.vendorContacted : null,
      expectedAvailabilityDate: typeof expected === "string" ? expected : null,
      lastPurchasingUpdateAt: lastPurchasingUpdateAt.value,
      cancelledAt: cancelledAt.value,
      cancellationReason: text(data.cancellationReason),
      receivedAt: receivedAt.value,
      actors: Object.freeze(actors),
    }),
  });
}

export interface LegacyReorderDocument {
  readonly id: unknown;
  readonly data: unknown;
}

/** Classify every legacy Reorder. Deterministic: rows are returned sorted by id. */
export function planReorderObjectMigration(
  source: readonly LegacyReorderDocument[],
  view: ReorderResolutionView,
  options: MappingOptions = {},
): ReorderObjectPlan {
  const rows = source
    .map((doc) => classifyOne(doc.id, doc.data, view, options))
    .sort((a, b) => a.reorderRequestId.localeCompare(b.reorderRequestId));

  const counts = { MIGRATABLE: 0, ALREADY_PRESENT: 0, REFUSED: 0 } as Record<ReorderObjectDisposition, number>;
  const refusalCounts: Record<string, number> = {};
  let unresolvedActors = 0;
  for (const r of rows) {
    counts[r.disposition] += 1;
    if (r.refusalCode !== null) refusalCounts[r.refusalCode] = (refusalCounts[r.refusalCode] ?? 0) + 1;
    for (const field of LEGACY_ACTOR_FIELDS) {
      if (r.actorDispositions[field] === "UNRESOLVED_PROVENANCE") unresolvedActors += 1;
    }
  }

  return Object.freeze({
    tenantId: view.tenantId,
    sourceRows: source.length,
    rows: Object.freeze(rows),
    counts: Object.freeze(counts),
    refusalCounts: Object.freeze(refusalCounts),
    unresolvedActors,
    copyable: Object.freeze(rows.filter((r) => r.disposition === "MIGRATABLE")),
    applied: false,
  });
}
