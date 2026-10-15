"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUSES_REQUIRING_PURCHASE_ORDER = exports.PO_MIGRATION_REFUSAL_CODES = exports.PO_DISPOSITIONS = void 0;
exports.planReorderPurchaseOrderMigration = planReorderPurchaseOrderMigration;
const purchasingMigrationMapping_js_1 = require("./purchasingMigrationMapping.js");
exports.PO_DISPOSITIONS = ["MIGRATABLE", "ALREADY_PRESENT", "REFUSED"];
/**
 * Refusals this layer adds. The mapper's own codes pass through unchanged, so a reject bucket can
 * tell a field-level defect from an environment-level one without consulting two vocabularies.
 */
exports.PO_MIGRATION_REFUSAL_CODES = [
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
];
/** Statuses whose business lifecycle cannot continue or be explained without a purchase order. */
exports.STATUSES_REQUIRING_PURCHASE_ORDER = ["ORDERED", "VOIDED", "RECEIVED"];
const exactId = (v) => typeof v === "string" && v !== "" && v.trim() === v && !v.includes("/");
const refusePo = (id, code, detail) => Object.freeze({ purchaseOrderId: id, disposition: "REFUSED", row: null, refusalCode: code, detail });
const refuseVoid = (id, code, detail) => Object.freeze({ purchaseOrderId: id, disposition: "REFUSED", row: null, refusalCode: code, detail });
/** Every business fact, compared. A difference anywhere is a collision, not a re-run. */
function sameFacts(a, b) {
    const diffs = [];
    const cmp = (field, left, right) => {
        if (left !== right)
            diffs.push(`${field}: target=${String(left)} source=${String(right)}`);
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
function resolveActor(uid, view) {
    if (!exactId(uid))
        return { reason: "the source records no usable actor" };
    const resolved = view.byUid.get(uid);
    if (resolved === undefined || resolved === null)
        return { reason: "the actor does not resolve to a known Principal" };
    if (resolved.tenantId !== view.tenantId)
        return { reason: "the actor is not an ACTIVE member of this tenant" };
    return { principalId: resolved.principalId };
}
/**
 * Classify every legacy purchase order and void against one target snapshot.
 *
 * DETERMINISTIC. Same documents plus same snapshot yields the same dispositions, every time: nothing
 * here reads a clock, generates an id, or consults anything but its arguments.
 */
function planReorderPurchaseOrderMigration(input) {
    const { view } = input;
    const poRows = [];
    const voidRows = [];
    for (const doc of input.purchaseOrders) {
        const id = doc.id;
        // THE SOURCE REQUEST MUST EXIST. A purchase order with no Reorder Request is not a migration
        // problem to work around: it is missing source evidence, and inventing the Reorder it belongs
        // to -- or copying the order without one -- would put a purchase into the authority with nothing
        // that explains why it was raised.
        if (!input.sourceRequestBackLinks.has(id)) {
            poRows.push(refusePo(id, "SOURCE_REORDER_REQUEST_ABSENT", "the source holds this purchase order but no Reorder Request with the same id"));
            continue;
        }
        const mapped = (0, purchasingMigrationMapping_js_1.mapLegacyPurchaseOrder)(id, doc.data, {
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
            poRows.push(refusePo(id, "COMPANY_KEY_BINDING_MISSING", `operating company "${mapped.row.operatingCompanyKey}" has no ACTIVE key binding in this tenant, and the company id is NOT usable as the key`));
            continue;
        }
        const actor = resolveActor(mapped.row.createdBy, view);
        if (!("principalId" in actor)) {
            poRows.push(refusePo(id, "ACTOR_NOT_RESOLVABLE", `purchase_orders.created_by is NOT NULL and carries a Principal foreign key, so this cannot be nulled or guessed: ${actor.reason}`));
            continue;
        }
        const resolved = Object.freeze({
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
                    purchaseOrderId: id, disposition: "ALREADY_PRESENT", row: null, refusalCode: null, detail: null,
                }));
            }
            else {
                // A HARD BLOCKER, and never skipped quietly. The target holds this id already and says
                // something different about it: one of the two records is wrong, and deciding which is a
                // person's job, not an importer's.
                poRows.push(refusePo(id, "TARGET_CONFLICT", `the target already holds ${id} with different business facts -- ${differences}`));
            }
            continue;
        }
        // The foreign key's precondition, stated as a classification so the reason survives.
        if (!view.targetReorderStatusById.has(id)) {
            poRows.push(refusePo(id, "REORDER_REQUEST_NOT_MIGRATED", "the Reorder Request this purchase order belongs to is not in the target; copy the Reorder objects first"));
            continue;
        }
        poRows.push(Object.freeze({
            purchaseOrderId: id, disposition: "MIGRATABLE", row: resolved, refusalCode: null, detail: null,
        }));
    }
    const copyablePoIds = new Set(poRows.filter((r) => r.disposition === "MIGRATABLE").map((r) => r.purchaseOrderId));
    for (const doc of input.voids) {
        const id = doc.id;
        const mapped = (0, purchasingMigrationMapping_js_1.mapLegacyPurchaseOrderVoid)(id, doc.data, input.options);
        if (mapped.ok !== true) {
            voidRows.push(refuseVoid(id, mapped.code, mapped.detail));
            continue;
        }
        const companyKey = view.companyKeyByCompanyId.get(mapped.row.operatingCompanyKey);
        if (companyKey === undefined) {
            voidRows.push(refuseVoid(id, "COMPANY_KEY_BINDING_MISSING", `operating company "${mapped.row.operatingCompanyKey}" has no ACTIVE key binding in this tenant`));
            continue;
        }
        const actor = resolveActor(mapped.row.voidedBy, view);
        if (!("principalId" in actor)) {
            voidRows.push(refuseVoid(id, "ACTOR_NOT_RESOLVABLE", `purchase_order_voids.voided_by is NOT NULL and carries a Principal foreign key: ${actor.reason}`));
            continue;
        }
        if (view.targetVoidIds.has(id)) {
            // A void is APPEND-ONLY: one purchase order, one void, never amended. So a void already in the
            // target is a completed copy, and the only correct action is to leave it exactly as it is.
            voidRows.push(Object.freeze({
                purchaseOrderId: id, disposition: "ALREADY_PRESENT", row: null, refusalCode: null, detail: null,
            }));
            continue;
        }
        if (!view.targetPurchaseOrders.has(id) && !copyablePoIds.has(id)) {
            voidRows.push(refuseVoid(id, "VOID_WITHOUT_PURCHASE_ORDER", "a void records that a purchase order was cancelled; without that order it records nothing"));
            continue;
        }
        voidRows.push(Object.freeze({
            purchaseOrderId: id,
            disposition: "MIGRATABLE",
            row: Object.freeze({
                purchaseOrderId: mapped.row.purchaseOrderId,
                operatingCompanyKey: companyKey,
                partId: mapped.row.partId,
                reason: mapped.row.reason,
                voidedAt: mapped.row.voidedAt,
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
    const requiring = new Set(exports.STATUSES_REQUIRING_PURCHASE_ORDER);
    const afterCopyPoIds = new Set([...view.targetPurchaseOrders.keys(), ...copyablePoIds]);
    const afterCopyVoidIds = new Set([
        ...view.targetVoidIds,
        ...voidRows.filter((v) => v.disposition === "MIGRATABLE").map((v) => v.purchaseOrderId),
    ]);
    const incomplete = [];
    for (const [reorderRequestId, status] of view.targetReorderStatusById) {
        if (!requiring.has(status))
            continue;
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
    const counts = { MIGRATABLE: 0, ALREADY_PRESENT: 0, REFUSED: 0 };
    const voidCounts = { MIGRATABLE: 0, ALREADY_PRESENT: 0, REFUSED: 0 };
    const refusalCounts = {};
    for (const r of poRows) {
        counts[r.disposition] += 1;
        if (r.refusalCode)
            refusalCounts[r.refusalCode] = (refusalCounts[r.refusalCode] ?? 0) + 1;
    }
    for (const r of voidRows) {
        voidCounts[r.disposition] += 1;
        if (r.refusalCode)
            refusalCounts[r.refusalCode] = (refusalCounts[r.refusalCode] ?? 0) + 1;
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
//# sourceMappingURL=reorderPurchaseOrderMigration.js.map