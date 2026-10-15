"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COORDINATED_VISIT_DATA_TIERS = exports.ANCHOR_VERDICTS = void 0;
exports.isDefectiveIdentifier = isDefectiveIdentifier;
exports.classifyCoordinatedVisitAnchors = classifyCoordinatedVisitAnchors;
exports.measureCoordinatedVisitAnchors = measureCoordinatedVisitAnchors;
// ════════════════════ the vocabulary ════════════════════
/**
 * Why one Work Order's Sales Order anchor does not resolve to a PostgreSQL Commercial record.
 *
 * Each verdict names a DIFFERENT remedy, which is the only reason to distinguish them:
 *
 *   RESOLVED                   nothing to remedy; the anchor is whole.
 *   LEGACY_ONLY_REFERENCE      the Sales Order is a real record that still lives only in the legacy
 *                              Commercial source. Remedy: migrate Commercial. NOT a Work Order defect.
 *   MISSING_COMMERCIAL_RECORD  the identifier names no Sales Order in EITHER store. The reference is
 *                              dangling at its origin. Remedy: an Owner ruling about the reference.
 *   IDENTITY_FORMAT_MISMATCH   the SAME Sales Order is present in PostgreSQL under a different
 *                              identifier, and a governed mapping proves they are the same record.
 *                              Remedy: convert the identifier. REQUIRES the mapping -- a shape argument
 *                              ("one looks like a push id, the other like a uuid") is not evidence that
 *                              two records are the same record, and this module will not accept one.
 *   MIGRATION_EXCLUDED         a named, authored ruling excluded this Sales Order from the migration
 *                              population. Remedy: none; the absence is intended.
 *   MIGRATION_NOT_RUN          the migration that would have carried this record EXISTS, is bound to a
 *                              snapshot that CONTAINS the record, and has not been executed against this
 *                              target. Narrower than LEGACY_ONLY_REFERENCE on purpose: it asserts that a
 *                              reviewed, bound plan already covers the record.
 *   DATA_DEFECT                the stored identifier is not a usable identifier at all (blank, padded,
 *                              or carrying a path separator). Remedy: repair, under separate authority.
 *   OTHER_EXPLICIT             a cause outside this vocabulary, which the caller must spell out.
 *   UNCLASSIFIABLE             the admissible evidence does not force any verdict. Reported as such.
 */
exports.ANCHOR_VERDICTS = Object.freeze([
    "RESOLVED",
    "LEGACY_ONLY_REFERENCE",
    "MISSING_COMMERCIAL_RECORD",
    "IDENTITY_FORMAT_MISMATCH",
    "MIGRATION_EXCLUDED",
    "MIGRATION_NOT_RUN",
    "DATA_DEFECT",
    "OTHER_EXPLICIT",
    "UNCLASSIFIABLE",
]);
const stated = (v) => typeof v === "string" && v.trim().length > 0 ? v : null;
/**
 * A stored identifier that cannot be used as one, whatever it names.
 *
 * Deliberately NARROW: only shapes that are wrong on their face. It does NOT judge a well-formed
 * identifier that happens to resolve nowhere -- that is an absent record, not a malformed reference, and
 * conflating the two would blame the Work Order for the Commercial migration's backlog.
 */
function isDefectiveIdentifier(raw) {
    return raw.trim() !== raw || raw.includes("/") || raw.length > 200;
}
/**
 * Classify every anchored Work Order. PURE -- no database, no clock, no I/O.
 *
 * ORDER OF TESTS, AND WHY IT IS THIS ORDER. Each test is asked only when every earlier one has been
 * answered no, so the order is a statement about which cause DOMINATES when more than one fact is true:
 *
 *   1. resolves in PostgreSQL          -- nothing is wrong; asked first so a working anchor is never
 *                                         explained.
 *   2. the identifier is malformed     -- a reference that cannot be looked up cannot be said to be
 *                                         missing from anywhere; the defect is prior to the lookup.
 *   3. a governed identity mapping     -- the record IS in PostgreSQL; that outranks any statement
 *                                         about the legacy store, which is then merely where it also is.
 *   4. an exclusion ruling             -- the absence is intended, so it is not a backlog item.
 *   5. a bound, unapplied migration    -- a reviewed plan already covers it: the narrower true statement.
 *   6. legacy evidence                 -- the record exists, in the other store, uncovered by any plan.
 *   7. legacy inventory says absent    -- MISSING_COMMERCIAL_RECORD, but only when the inventory was
 *                                         actually supplied. With no inventory, "absent" is unmeasured.
 *   8. an explicit spelled-out cause   -- the caller names something outside this vocabulary.
 *   9. UNCLASSIFIABLE.
 */
function classifyCoordinatedVisitAnchors(evidence) {
    const legacy = new Map((evidence.legacySalesOrders ?? [])
        .filter((e) => stated(e.salesOrderId) !== null && stated(e.citation) !== null)
        .map((e) => [e.salesOrderId, e]));
    const mapped = new Map((evidence.identityMappings ?? [])
        .filter((m) => stated(m.citation) !== null)
        .map((m) => [m.legacySalesOrderId, m]));
    const excluded = new Map((evidence.exclusionRulings ?? []).map((r) => [r.salesOrderId, r]));
    const unappliedPlan = new Map((evidence.boundMigrations ?? [])
        .filter((m) => m.applied === false && stated(m.citation) !== null)
        .map((m) => [m.salesOrderId, m]));
    const other = evidence.explicitOther ?? new Map();
    // The inventory is only usable as a NEGATIVE ("this record does not exist anywhere") when one was
    // supplied at all. An unsupplied inventory proves nothing about what is or is not in the legacy store.
    const inventorySupplied = (evidence.legacySalesOrders ?? []).length > 0;
    const classifications = [];
    let uncoordinated = 0;
    const anchors = new Set();
    const anchorsResolved = new Set();
    for (const wo of evidence.workOrders) {
        const anchor = stated(wo.salesOrderId);
        if (anchor === null) {
            uncoordinated += 1;
            continue;
        }
        anchors.add(anchor);
        const base = {
            workOrderId: wo.id,
            workOrderNumber: wo.workOrderNumber,
            status: wo.status,
            salesOrderId: anchor,
            lineRefRows: wo.lineRefRows,
        };
        const push = (verdict, ev, reference = null) => classifications.push(Object.freeze({
            ...base, verdict, evidence: Object.freeze(ev), resolvedReference: reference,
        }));
        if (evidence.postgresSalesOrders.has(anchor)) {
            const reference = evidence.postgresSalesOrders.get(anchor) ?? null;
            anchorsResolved.add(anchor);
            push("RESOLVED", [
                `eos_commercial.sales_orders holds id '${anchor}' in this tenant`,
                reference === null
                    ? "the row carries no sales_order_number, so the projection omits the reference"
                    : `sales_order_number '${reference}'`,
            ], reference);
            continue;
        }
        if (isDefectiveIdentifier(anchor)) {
            push("DATA_DEFECT", [
                `the stored sales_order_id ${JSON.stringify(anchor)} is not a usable identifier `
                    + "(untrimmed, path-separated, or over 200 characters)",
            ]);
            continue;
        }
        const mapping = mapped.get(anchor);
        if (mapping) {
            push("IDENTITY_FORMAT_MISMATCH", [
                `a governed mapping binds legacy '${anchor}' to PostgreSQL '${mapping.postgresSalesOrderId}'`,
                `mapping evidence: ${mapping.citation}`,
                evidence.postgresSalesOrders.has(mapping.postgresSalesOrderId)
                    ? `eos_commercial.sales_orders holds '${mapping.postgresSalesOrderId}'`
                    : `eos_commercial.sales_orders does NOT hold '${mapping.postgresSalesOrderId}' either`,
            ]);
            continue;
        }
        const ruling = excluded.get(anchor);
        if (ruling) {
            push("MIGRATION_EXCLUDED", [ruling.ruling]);
            continue;
        }
        const plan = unappliedPlan.get(anchor);
        if (plan) {
            push("MIGRATION_NOT_RUN", [
                `${plan.migration} is bound to a snapshot naming '${anchor}' and has not been applied to this target`,
                plan.citation,
            ]);
            continue;
        }
        const legacyRow = legacy.get(anchor);
        if (legacyRow) {
            push("LEGACY_ONLY_REFERENCE", [
                `'${anchor}' is a record of the legacy Commercial source`,
                legacyRow.salesOrderNumber === null
                    ? "the legacy evidence records no reference for it"
                    : `it carries the reference '${legacyRow.salesOrderNumber}'`,
                `evidence: ${legacyRow.citation}`,
                `eos_commercial.sales_orders holds no row with id '${anchor}' in this tenant`,
            ]);
            continue;
        }
        if (inventorySupplied) {
            push("MISSING_COMMERCIAL_RECORD", [
                `'${anchor}' is absent from eos_commercial.sales_orders in this tenant`,
                `it is also absent from the supplied legacy inventory of ${legacy.size} record(s)`,
                "no governed identity mapping, exclusion ruling or bound migration names it",
            ]);
            continue;
        }
        const spelled = other.get(anchor);
        if (spelled) {
            push("OTHER_EXPLICIT", [spelled]);
            continue;
        }
        push("UNCLASSIFIABLE", [
            `'${anchor}' is absent from eos_commercial.sales_orders in this tenant`,
            "no legacy inventory was supplied, so its existence elsewhere is UNMEASURED",
            "no mapping, ruling, bound migration or spelled-out cause names it",
        ]);
    }
    const countsByVerdict = Object.fromEntries(exports.ANCHOR_VERDICTS.map((v) => [v, classifications.filter((c) => c.verdict === v).length]));
    return Object.freeze({
        workOrdersMeasured: evidence.workOrders.length,
        uncoordinated,
        anchored: classifications.length,
        distinctAnchors: anchors.size,
        distinctAnchorsResolved: anchorsResolved.size,
        classifications: Object.freeze(classifications),
        countsByVerdict: Object.freeze(countsByVerdict),
        everyAnchorResolves: anchors.size > 0
            && anchorsResolved.size === anchors.size
            && countsByVerdict.UNCLASSIFIABLE === 0,
    });
}
// ════════════════════ the measurement ════════════════════
/**
 * Read the PostgreSQL half of the evidence. SELECT ONLY.
 *
 * Deliberately measures the WHOLE tenant rather than the projection's page: a page bound by `limit`
 * would report a readiness verdict about 300 rows, and the question is whether the estate is ready.
 */
async function measureCoordinatedVisitAnchors(db, tenantId) {
    const { rows } = await db.query(`SELECT w.id, w.work_order_number, w.status::text AS status, w.customer_id, w.location_id,
            w.sales_order_id, w.provenance::text AS provenance,
            (SELECT count(*) FROM eos_ops.work_order_sales_order_lines l
              WHERE l.tenant_id = w.tenant_id AND l.work_order_id = w.id
                AND l.sales_order_id = w.sales_order_id) AS line_ref_rows
       FROM eos_ops.work_orders w
      WHERE w.tenant_id = $1
      ORDER BY w.id COLLATE "C" ASC`, [tenantId]);
    const workOrders = rows.map((r) => Object.freeze({
        id: String(r.id),
        workOrderNumber: stated(r.work_order_number),
        status: stated(r.status),
        customerId: stated(r.customer_id),
        locationId: stated(r.location_id),
        salesOrderId: stated(r.sales_order_id),
        provenance: stated(r.provenance),
        lineRefRows: Number(r.line_ref_rows ?? 0),
    }));
    const { rows: orders } = await db.query(`SELECT id, sales_order_number FROM eos_commercial.sales_orders WHERE tenant_id = $1`, [tenantId]);
    const postgresSalesOrders = new Map(orders.map((r) => [String(r.id), stated(r.sales_order_number)]));
    return Object.freeze({ workOrders: Object.freeze(workOrders), postgresSalesOrders });
}
// ════════════════════ what the surface would show ════════════════════
/**
 * The MINIMUM PostgreSQL dependency for "Read Coordinated Visits" to be CORRECT, stated as three tiers.
 *
 * The tiers are separated because the projection reads three independent things, and conflating them is
 * how a cutover acquires a dependency it does not have. In particular: the grouping is done on
 * `sales_order_id` as an OPAQUE STRING (coordinatedVisit.ts groups by exact string equality), so the
 * visit grouping itself needs NO Commercial row at all. Only the REFERENCE and the LINE DETAIL do.
 */
exports.COORDINATED_VISIT_DATA_TIERS = Object.freeze([
    Object.freeze({
        tier: "GROUPING",
        needs: "eos_ops.work_orders rows carrying the same sales_order_id string",
        dependsOnCommercial: false,
        withoutIt: "no visits at all -- the screen is empty",
        withIt: "Work Orders group into visits; each visit's heading prints the raw anchor identifier",
    }),
    Object.freeze({
        tier: "ANCHOR_REFERENCE",
        needs: "eos_commercial.sales_orders rows whose id EQUALS the Work Order's sales_order_id, carrying "
            + "sales_order_number",
        dependsOnCommercial: true,
        // IDENTITY ONLY. Not lines, not state, not allocation: resolveSalesOrderReferencesFromPostgres
        // selects `id, sales_order_number` and nothing else.
        withoutIt: "the anchor is ABSENT from salesOrderReferences, so the surface renders its truthful "
            + "fallback instead of SO-YYYY-######",
        withIt: "each visit is titled by its Sales Order reference",
    }),
    Object.freeze({
        tier: "LINE_DETAIL",
        needs: "eos_ops.work_order_sales_order_lines rows, joined to eos_commercial.sales_order_lines for "
            + "kind/ref/ordered_qty",
        dependsOnCommercial: true,
        // allocatedQty stays null whatever happens here: it is a D2 execution fact PostgreSQL Commercial
        // does not carry, which is the same gap serviceFromSalesOrderBoundary.ts refuses on.
        withoutIt: "salesOrderLineRefs is empty on every Work Order; the visit shows no ordered-parts detail",
        withIt: "each Work Order lists its referenced lines, with allocatedQty null in every case",
    }),
]);
//# sourceMappingURL=coordinatedVisitAnchorCensus.js.map