// LEGACY REORDER PURCHASE ORDER + VOID: THE CLASSIFIER.
//
// MIGRATION_ONLY. Pure: no Firebase, no Firestore, no Postgres connection, no clock, no randomness.
// It decides WHAT may be copied; the executor beside it carries out a plan and decides nothing.
//
// ════════════════════ IT ADDS NO SECOND MAPPER ════════════════════
//
// `mapLegacyPurchaseOrder` and `mapLegacyPurchaseOrderVoid` already own the field-level contract --
// the identity ruling stated three ways, the price/stamp implication, the date shapes, the required
// text. This module calls them and adds ONLY what a mapper cannot know because it holds no database:
//
//   1. does the target already hold this id, and with the same business facts?
//   2. does the legacy `operatingCompanyId` resolve to an ACTIVE governed key binding?
//   3. does the legacy actor uid resolve to a Principal with an ACTIVE membership?
//   4. is the Reorder Request this purchase order belongs to PRESENT in the target?
//
// ════════════════════ WHY (4) IS A CLASSIFICATION AND NOT A DATABASE ERROR ════════════════════
//
// `purchase_orders.id` is a foreign key to `reorder_requests(id)`, so a purchase order whose Reorder
// has not been copied cannot physically be inserted. Letting the foreign key raise would tell an
// operator "insert or update violates foreign key constraint" at row 3 of an all-or-nothing copy,
// with no statement of which of the two possible causes applies: the Reorder was refused by its own
// copy, or the Reorder does not exist in the source at all. Those need different answers from a
// person, so they are separate refusals here.
//
// ════════════════════ THE ACTOR IS REFUSED, NEVER GUESSED AND NEVER NULLED ════════════════════
//
// `purchase_orders.created_by` and `purchase_order_voids.voided_by` are NOT NULL and carry Principal
// foreign keys (migration 039). They are deliberately NOT among the columns ruled nullable for
// migrated historical unknowns -- that ruling covers `reorder_requests.requested_by` (037) and the
// five lifecycle actor columns (035), and nothing else.
//
// So a legacy purchase order whose recording actor cannot be resolved to a Principal is REFUSED. The
// alternatives were all worse: a uid in the column would store a Firebase identity as a business
// identity, the executor's own Principal would attribute a stranger's purchase to whoever ran the
// import, and a generic migration Principal would make every unattributable record look attributed.

import {
  mapLegacyPurchaseOrder,
  mapLegacyPurchaseOrderVoid,
  type MappingOptions,
  type PurchaseOrderRow,
  type PurchaseOrderVoidRow,
} from "./purchasingMigrationMapping.js";

/** One legacy document, as the reader hands it over. */
export interface LegacyPurchasingDocument {
  readonly id: string;
  readonly data: unknown;
}

export const PO_DISPOSITIONS = ["MIGRATABLE", "ALREADY_PRESENT", "REFUSED"] as const;
export type PoDisposition = (typeof PO_DISPOSITIONS)[number];

/**
 * Refusals this layer adds. The mapper's own codes pass through unchanged, so a reject bucket can
 * tell a field-level defect from an environment-level one without consulting two vocabularies.
 */
export const PO_MIGRATION_REFUSAL_CODES = [
  /** The legacy operatingCompanyId is not bound to an ACTIVE governed operating company. */
  "COMPANY_KEY_BINDING_MISSING",
  /** The recording actor does not resolve to a Principal with an ACTIVE membership in this tenant. */
  "ACTOR_NOT_RESOLVABLE",
  /** The Reorder Request this purchase order belongs to is not in the target. */
  "REORDER_REQUEST_NOT_MIGRATED",
  /** The source has a purchase order but no Reorder Request at all. Source evidence is missing. */
  "SOURCE_REORDER_REQUEST_ABSENT",
  /** The target already holds this id carrying DIFFERENT business facts. A hard blocker. */
  "TARGET_CONFLICT",
  /** A void record whose purchase order is neither present nor being copied. */
  "VOID_WITHOUT_PURCHASE_ORDER",
  /** The Reorder is VOIDED but the source holds no void record for it. */
  "VOID_EVIDENCE_ABSENT",
] as const;
export type PoMigrationRefusalCode = (typeof PO_MIGRATION_REFUSAL_CODES)[number];

/** What the target already holds, as one consistent snapshot. */
export interface PurchasingResolutionView {
  readonly tenantId: string;
  /** Firebase uid -> Principal, or null when it does not resolve to an ACTIVE membership. */
  readonly byUid: ReadonlyMap<string, { readonly principalId: string; readonly tenantId: string | null } | null>;
  /** Governed company id -> ACTIVE operating company key. Absent means no ACTIVE binding. */
  readonly companyKeyByCompanyId: ReadonlyMap<string, string>;
  /** Reorder Request ids the TARGET holds, with their status. */
  readonly targetReorderStatusById: ReadonlyMap<string, string>;
  /** Purchase orders the target already holds, by id, with the facts a conflict is judged on. */
  readonly targetPurchaseOrders: ReadonlyMap<string, TargetPurchaseOrderFacts>;
  readonly targetVoidIds: ReadonlySet<string>;
}

/** The business facts an ALREADY_PRESENT row must match to be a re-run rather than a collision. */
export interface TargetPurchaseOrderFacts {
  readonly operatingCompanyKey: string;
  readonly partId: string;
  readonly supplierName: string;
  readonly externalPoNumber: string;
  readonly orderedQuantity: number;
  readonly orderedDate: string;
  readonly expectedArrivalDate: string | null;
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
  readonly priceAuthorityVersion: number | null;
}

export interface PoPlanRow {
  readonly purchaseOrderId: string;
  readonly disposition: PoDisposition;
  /** The row a COPY would insert, with every identity already RESOLVED. Null unless MIGRATABLE. */
  readonly row: ResolvedPurchaseOrderRow | null;
  readonly refusalCode: string | null;
  readonly detail: string | null;
}

export interface VoidPlanRow {
  readonly purchaseOrderId: string;
  readonly disposition: PoDisposition;
  readonly row: ResolvedVoidRow | null;
  readonly refusalCode: string | null;
  readonly detail: string | null;
}

/** A mapped row whose company and actor have been resolved through the governed authorities. */
export interface ResolvedPurchaseOrderRow extends Omit<PurchaseOrderRow, "operatingCompanyKey" | "createdBy"> {
  /** The eos_ops partition key, resolved from the legacy company id. NEVER the id itself. */
  readonly operatingCompanyKey: string;
  /** The resolved Principal. Never a uid. */
  readonly createdByPrincipalId: string;
}

export interface ResolvedVoidRow extends Omit<PurchaseOrderVoidRow, "operatingCompanyKey" | "voidedBy"> {
  readonly operatingCompanyKey: string;
  readonly voidedByPrincipalId: string;
}

export interface PurchasingMigrationPlan {
  readonly tenantId: string;
  readonly sourcePurchaseOrders: number;
  readonly sourceVoids: number;
  readonly purchaseOrders: readonly PoPlanRow[];
  readonly voids: readonly VoidPlanRow[];
  readonly counts: Readonly<Record<PoDisposition, number>>;
  readonly voidCounts: Readonly<Record<PoDisposition, number>>;
  readonly refusalCounts: Readonly<Record<string, number>>;
  readonly copyablePurchaseOrders: readonly PoPlanRow[];
  readonly copyableVoids: readonly VoidPlanRow[];
  /**
   * ACTIVATION COMPLETENESS: Reorders in the TARGET whose lifecycle needs a purchase order and
   * would not have one after this copy. A non-empty list means activation makes them unreceivable
   * or unexplainable, which is the whole reason this migration exists.
   */
  readonly incompleteAfterCopy: readonly IncompleteLifecycle[];
  /** Always false. Planning is not copying. */
  readonly applied: false;
}

export interface IncompleteLifecycle {
  readonly reorderRequestId: string;
  readonly status: string;
  readonly missing: string;
}

/** Statuses whose business lifecycle cannot continue or be explained without a purchase order. */
export const STATUSES_REQUIRING_PURCHASE_ORDER = ["ORDERED", "VOIDED", "RECEIVED"] as const;

const exactId = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && !v.includes("/");

const refusePo = (id: string, code: string, detail: string): PoPlanRow =>
  Object.freeze({ purchaseOrderId: id, disposition: "REFUSED" as const, row: null, refusalCode: code, detail });
const refuseVoid = (id: string, code: string, detail: string): VoidPlanRow =>
  Object.freeze({ purchaseOrderId: id, disposition: "REFUSED" as const, row: null, refusalCode: code, detail });

/** Every business fact, compared. A difference anywhere is a collision, not a re-run. */
function sameFacts(a: TargetPurchaseOrderFacts, b: ResolvedPurchaseOrderRow): string | null {
  const diffs: string[] = [];
  const cmp = (field: string, left: unknown, right: unknown) => {
    if (left !== right) diffs.push(`${field}: target=${String(left)} source=${String(right)}`);
  };
  cmp("operatingCompanyKey", a.operatingCompanyKey, b.operatingCompanyKey);
  cmp("partId", a.partId, b.partId);
  cmp("supplierName", a.supplierName, b.supplierName);
  cmp("externalPoNumber", a.externalPoNumber, b.externalPoNumber);
  cmp("orderedQuantity", a.orderedQuantity, b.orderedQuantity);
  cmp("orderedDate", a.orderedDate, b.orderedDate);
  cmp("expectedArrivalDate", a.expectedArrivalDate, b.expectedArrivalDate);
  cmp("unitPriceMinor", a.unitPriceMinor, b.unitPriceMinor);
  cmp("currency", a.currency, b.currency);
  cmp("priceAuthorityVersion", a.priceAuthorityVersion, b.priceAuthorityVersion);
  return diffs.length === 0 ? null : diffs.join("; ");
}

function resolveActor(
  uid: unknown, view: PurchasingResolutionView,
): { readonly principalId: string } | { readonly reason: string } {
  if (!exactId(uid)) return { reason: "the source records no usable actor" };
  const resolved = view.byUid.get(uid);
  if (resolved === undefined || resolved === null) return { reason: "the actor does not resolve to a known Principal" };
  if (resolved.tenantId !== view.tenantId) return { reason: "the actor is not an ACTIVE member of this tenant" };
  return { principalId: resolved.principalId };
}

/**
 * Classify every legacy purchase order and void against one target snapshot.
 *
 * DETERMINISTIC. Same documents plus same snapshot yields the same dispositions, every time: nothing
 * here reads a clock, generates an id, or consults anything but its arguments.
 */
export function planReorderPurchaseOrderMigration(input: {
  readonly purchaseOrders: readonly LegacyPurchasingDocument[];
  readonly voids: readonly LegacyPurchasingDocument[];
  /** Reorder Request ids the SOURCE holds, and the `purchaseOrderId` each one points at. */
  readonly sourceRequestBackLinks: ReadonlyMap<string, unknown>;
  readonly view: PurchasingResolutionView;
  readonly options?: MappingOptions;
}): PurchasingMigrationPlan {
  const { view } = input;
  const poRows: PoPlanRow[] = [];
  const voidRows: VoidPlanRow[] = [];

  for (const doc of input.purchaseOrders) {
    const id = doc.id;
    // THE SOURCE REQUEST MUST EXIST. A purchase order with no Reorder Request is not a migration
    // problem to work around: it is missing source evidence, and inventing the Reorder it belongs
    // to -- or copying the order without one -- would put a purchase into the authority with nothing
    // that explains why it was raised.
    if (!input.sourceRequestBackLinks.has(id)) {
      poRows.push(refusePo(id, "SOURCE_REORDER_REQUEST_ABSENT",
        "the source holds this purchase order but no Reorder Request with the same id"));
      continue;
    }
    const mapped = mapLegacyPurchaseOrder(id, doc.data, {
      ...input.options,
      requestBackLink: input.sourceRequestBackLinks.get(id),
    });
    if (mapped.ok !== true) {
      poRows.push(refusePo(id, mapped.code, mapped.detail));
      continue;
    }
    // The mapper returns the legacy COMPANY ID under the name operatingCompanyKey, because the
    // mapper holds no database and cannot resolve the binding. Resolving it is this layer's job, and
    // the id is never used as the key when the binding is absent.
    const companyKey = view.companyKeyByCompanyId.get(mapped.row.operatingCompanyKey);
    if (companyKey === undefined) {
      poRows.push(refusePo(id, "COMPANY_KEY_BINDING_MISSING",
        `operating company "${mapped.row.operatingCompanyKey}" has no ACTIVE key binding in this tenant, and the company id is NOT usable as the key`));
      continue;
    }
    const actor = resolveActor(mapped.row.createdBy, view);
    if (!("principalId" in actor)) {
      poRows.push(refusePo(id, "ACTOR_NOT_RESOLVABLE",
        `purchase_orders.created_by is NOT NULL and carries a Principal foreign key, so this cannot be nulled or guessed: ${actor.reason}`));
      continue;
    }
    const resolved: ResolvedPurchaseOrderRow = Object.freeze({
      id: mapped.row.id,
      operatingCompanyKey: companyKey,
      partId: mapped.row.partId,
      supplierName: mapped.row.supplierName,
      externalPoNumber: mapped.row.externalPoNumber,
      orderedQuantity: mapped.row.orderedQuantity,
      orderedDate: mapped.row.orderedDate,
      expectedArrivalDate: mapped.row.expectedArrivalDate,
      unitPriceMinor: mapped.row.unitPriceMinor,
      currency: mapped.row.currency,
      priceAuthorityVersion: mapped.row.priceAuthorityVersion,
      createdByPrincipalId: actor.principalId,
    });

    const existing = view.targetPurchaseOrders.get(id);
    if (existing !== undefined) {
      const differences = sameFacts(existing, resolved);
      if (differences === null) {
        poRows.push(Object.freeze({
          purchaseOrderId: id, disposition: "ALREADY_PRESENT" as const, row: null, refusalCode: null, detail: null,
        }));
      } else {
        // A HARD BLOCKER, and never skipped quietly. The target holds this id already and says
        // something different about it: one of the two records is wrong, and deciding which is a
        // person's job, not an importer's.
        poRows.push(refusePo(id, "TARGET_CONFLICT",
          `the target already holds ${id} with different business facts -- ${differences}`));
      }
      continue;
    }

    // The foreign key's precondition, stated as a classification so the reason survives.
    if (!view.targetReorderStatusById.has(id)) {
      poRows.push(refusePo(id, "REORDER_REQUEST_NOT_MIGRATED",
        "the Reorder Request this purchase order belongs to is not in the target; copy the Reorder objects first"));
      continue;
    }

    poRows.push(Object.freeze({
      purchaseOrderId: id, disposition: "MIGRATABLE" as const, row: resolved, refusalCode: null, detail: null,
    }));
  }

  const copyablePoIds = new Set(
    poRows.filter((r) => r.disposition === "MIGRATABLE").map((r) => r.purchaseOrderId));

  for (const doc of input.voids) {
    const id = doc.id;
    const mapped = mapLegacyPurchaseOrderVoid(id, doc.data, input.options);
    if (mapped.ok !== true) {
      voidRows.push(refuseVoid(id, mapped.code, mapped.detail));
      continue;
    }
    const companyKey = view.companyKeyByCompanyId.get(mapped.row.operatingCompanyKey);
    if (companyKey === undefined) {
      voidRows.push(refuseVoid(id, "COMPANY_KEY_BINDING_MISSING",
        `operating company "${mapped.row.operatingCompanyKey}" has no ACTIVE key binding in this tenant`));
      continue;
    }
    const actor = resolveActor(mapped.row.voidedBy, view);
    if (!("principalId" in actor)) {
      voidRows.push(refuseVoid(id, "ACTOR_NOT_RESOLVABLE",
        `purchase_order_voids.voided_by is NOT NULL and carries a Principal foreign key: ${actor.reason}`));
      continue;
    }
    if (view.targetVoidIds.has(id)) {
      // A void is APPEND-ONLY: one purchase order, one void, never amended. So a void already in the
      // target is a completed copy, and the only correct action is to leave it exactly as it is.
      voidRows.push(Object.freeze({
        purchaseOrderId: id, disposition: "ALREADY_PRESENT" as const, row: null, refusalCode: null, detail: null,
      }));
      continue;
    }
    if (!view.targetPurchaseOrders.has(id) && !copyablePoIds.has(id)) {
      voidRows.push(refuseVoid(id, "VOID_WITHOUT_PURCHASE_ORDER",
        "a void records that a purchase order was cancelled; without that order it records nothing"));
      continue;
    }
    voidRows.push(Object.freeze({
      purchaseOrderId: id,
      disposition: "MIGRATABLE" as const,
      row: Object.freeze({
        purchaseOrderId: mapped.row.purchaseOrderId,
        operatingCompanyKey: companyKey,
        partId: mapped.row.partId,
        reason: mapped.row.reason,
        voidedByPrincipalId: actor.principalId,
      }),
      refusalCode: null,
      detail: null,
    }));
  }

  // ---- ACTIVATION COMPLETENESS ----
  //
  // Asked of the TARGET, because the target is what will be authoritative after cutover. A Reorder
  // whose status needs a purchase order, and which would still not have one once this copy commits,
  // becomes unreceivable (ORDERED) or unexplainable (VOIDED / RECEIVED) the moment Firestore stops
  // answering. The status is never used to INFER the missing order -- it is used to notice it.
  const requiring = new Set<string>(STATUSES_REQUIRING_PURCHASE_ORDER);
  const afterCopyPoIds = new Set([...view.targetPurchaseOrders.keys(), ...copyablePoIds]);
  const afterCopyVoidIds = new Set([
    ...view.targetVoidIds,
    ...voidRows.filter((v) => v.disposition === "MIGRATABLE").map((v) => v.purchaseOrderId),
  ]);
  const incomplete: IncompleteLifecycle[] = [];
  for (const [reorderRequestId, status] of view.targetReorderStatusById) {
    if (!requiring.has(status)) continue;
    if (!afterCopyPoIds.has(reorderRequestId)) {
      incomplete.push(Object.freeze({
        reorderRequestId, status,
        missing: status === "ORDERED"
          ? "no governed Purchase Order: this Reorder cannot be received after cutover"
          : "no governed Purchase Order: this Reorder's history cannot be explained after cutover",
      }));
      continue;
    }
    if (status === "VOIDED" && !afterCopyVoidIds.has(reorderRequestId)) {
      incomplete.push(Object.freeze({
        reorderRequestId, status,
        missing: "no void record: a VOIDED Reorder keeps its purchase order AND the evidence of why it was cancelled",
      }));
    }
  }

  const counts = { MIGRATABLE: 0, ALREADY_PRESENT: 0, REFUSED: 0 } as Record<PoDisposition, number>;
  const voidCounts = { MIGRATABLE: 0, ALREADY_PRESENT: 0, REFUSED: 0 } as Record<PoDisposition, number>;
  const refusalCounts: Record<string, number> = {};
  for (const r of poRows) {
    counts[r.disposition] += 1;
    if (r.refusalCode) refusalCounts[r.refusalCode] = (refusalCounts[r.refusalCode] ?? 0) + 1;
  }
  for (const r of voidRows) {
    voidCounts[r.disposition] += 1;
    if (r.refusalCode) refusalCounts[r.refusalCode] = (refusalCounts[r.refusalCode] ?? 0) + 1;
  }

  return Object.freeze({
    tenantId: view.tenantId,
    sourcePurchaseOrders: input.purchaseOrders.length,
    sourceVoids: input.voids.length,
    purchaseOrders: Object.freeze(poRows),
    voids: Object.freeze(voidRows),
    counts: Object.freeze(counts),
    voidCounts: Object.freeze(voidCounts),
    refusalCounts: Object.freeze(refusalCounts),
    copyablePurchaseOrders: Object.freeze(poRows.filter((r) => r.disposition === "MIGRATABLE")),
    copyableVoids: Object.freeze(voidRows.filter((r) => r.disposition === "MIGRATABLE")),
    incompleteAfterCopy: Object.freeze(incomplete),
    applied: false,
  });
}
