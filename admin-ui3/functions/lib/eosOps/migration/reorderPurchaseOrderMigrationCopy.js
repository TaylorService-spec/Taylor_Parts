"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIREBASE_IDENTITY_PROVIDER = exports.PURCHASE_ORDER_COPY_ACTION = void 0;
exports.dryRunPurchaseOrderMigration = dryRunPurchaseOrderMigration;
exports.copyPurchaseOrdersOnce = copyPurchaseOrdersOnce;
exports.verifyPurchaseOrderMigration = verifyPurchaseOrderMigration;
// LEGACY REORDER PURCHASE ORDER + VOID: DRY RUN / COPY ONCE / VERIFY.
//
// MIGRATION_ONLY. The classifier beside this file decides WHAT may be copied; this file decides
// nothing and only carries out a plan it builds from one governed snapshot.
//
// It writes eos_ops.purchase_orders and eos_ops.purchase_order_voids. It activates nothing: no route
// serves them and Firestore remains the Reorder authority until the cutover retires it.
//
// ════════════════════ WHY THIS EXISTS AT ALL ════════════════════
//
// The Reorder object migration copies `reorder_requests`. The PostgreSQL receiving authority reads
// `eos_ops.purchase_orders`. Nothing joined those two facts, so an ORDERED Reorder could migrate
// perfectly and then be UNRECEIVABLE the moment Firestore stopped answering -- the order would be
// there, the thing you receive against would not, and the failure would appear as a NOT_FOUND at the
// warehouse rather than as a migration defect. This is the missing link in that chain.
//
// ════════════════════ ORDER IS NOT A PREFERENCE ════════════════════
//
//   reorder_requests  ->  purchase_orders  ->  purchase_order_voids
//
// Each is a foreign key to the one before it. A void without its order records nothing, and an order
// without its Reorder explains nothing. One transaction writes orders then voids, so the two can
// never be separated by a failure.
const node_crypto_1 = require("node:crypto");
const reorderPurchaseOrderMigration_js_1 = require("./reorderPurchaseOrderMigration.js");
exports.PURCHASE_ORDER_COPY_ACTION = "reorder.purchaseOrder.migration.copy";
exports.FIREBASE_IDENTITY_PROVIDER = "firebase";
const sourceUids = (source) => {
    const out = [];
    for (const doc of source.purchaseOrders) {
        const d = doc.data;
        if (d && typeof d === "object" && typeof d.createdBy === "string" && d.createdBy.trim() !== "")
            out.push(d.createdBy);
    }
    for (const doc of source.voids) {
        const d = doc.data;
        if (d && typeof d === "object" && typeof d.voidedBy === "string" && d.voidedBy.trim() !== "")
            out.push(d.voidedBy);
    }
    return out;
};
/**
 * Gather everything the classifier needs, from ONE snapshot.
 *
 * Five reads that must agree with each other. Under READ COMMITTED each could see a different
 * committed state, and the plan would then describe a database that never existed at any instant.
 */
async function readPurchasingView(client, tenantId, uids) {
    const distinct = [...new Set(uids)];
    const byUid = new Map();
    if (distinct.length > 0) {
        // EXACT external subject, on the firebase provider. No name, no email, no fuzzy match.
        const { rows } = await client.query(`SELECT p.external_subject AS uid, p.id AS principal_id, m.tenant_id
         FROM eos_policy.principals p
         LEFT JOIN eos_policy.tenant_memberships m
           ON m.principal_id = p.id AND m.tenant_id = $1 AND m.status = 'active'
        WHERE p.identity_provider = $2 AND p.external_subject = ANY($3::text[]) AND p.status = 'active'`, [tenantId, exports.FIREBASE_IDENTITY_PROVIDER, distinct]);
        for (const r of rows)
            byUid.set(r.uid, { principalId: r.principal_id, tenantId: r.tenant_id ?? null });
        for (const uid of distinct)
            if (!byUid.has(uid))
                byUid.set(uid, null);
    }
    // THE BINDING, and only where every link is ACTIVE. An INACTIVE company or an INACTIVE binding
    // yields NO row, so the classifier refuses rather than resolving through something retired.
    const bindings = await client.query(`SELECT b.operating_company_id, b.operating_company_key
       FROM eos_policy.tenant_operating_company_keys b
       JOIN eos_policy.tenant_operating_companies c
         ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
      WHERE b.tenant_id = $1 AND b.status = 'ACTIVE' AND c.status = 'ACTIVE'`, [tenantId]);
    const reorders = await client.query(`SELECT id, status::text AS status FROM eos_ops.reorder_requests WHERE tenant_id = $1`, [tenantId]);
    const orders = await client.query(`SELECT id, operating_company_key, part_id, supplier_name, external_po_number, ordered_quantity,
            ordered_date::text AS ordered_date, expected_arrival_date::text AS expected_arrival_date,
            unit_price_minor, currency, price_authority_version
       FROM eos_ops.purchase_orders WHERE tenant_id = $1`, [tenantId]);
    const voids = await client.query(`SELECT purchase_order_id FROM eos_ops.purchase_order_voids WHERE tenant_id = $1`, [tenantId]);
    const targetPurchaseOrders = new Map(orders.rows.map((r) => [r.id, Object.freeze({
            operatingCompanyKey: r.operating_company_key,
            partId: r.part_id,
            supplierName: r.supplier_name,
            externalPoNumber: r.external_po_number,
            orderedQuantity: r.ordered_quantity,
            orderedDate: r.ordered_date,
            expectedArrivalDate: r.expected_arrival_date ?? null,
            // BIGINT arrives as a string from node-postgres. Converted once, here, so a comparison with a
            // mapped integer is a comparison of numbers rather than a type mismatch reported as a conflict.
            unitPriceMinor: r.unit_price_minor === null ? null : Number(r.unit_price_minor),
            currency: r.currency ?? null,
            priceAuthorityVersion: r.price_authority_version ?? null,
        })]));
    return Object.freeze({
        tenantId,
        byUid,
        companyKeyByCompanyId: new Map(bindings.rows.map((r) => [r.operating_company_id, r.operating_company_key])),
        targetReorderStatusById: new Map(reorders.rows.map((r) => [r.id, r.status])),
        targetPurchaseOrders,
        targetVoidIds: new Set(voids.rows.map((r) => r.purchase_order_id)),
    });
}
/** Classify without writing. READ ONLY, so it cannot become a copy by accident. */
async function dryRunPurchaseOrderMigration(pool, input) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const view = await readPurchasingView(client, input.tenantId, sourceUids(input.source));
        const plan = (0, reorderPurchaseOrderMigration_js_1.planReorderPurchaseOrderMigration)({
            purchaseOrders: input.source.purchaseOrders,
            voids: input.source.voids,
            sourceRequestBackLinks: input.source.requestBackLinks,
            view,
            options: input.options,
        });
        await client.query("COMMIT");
        return plan;
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
}
/**
 * COPY ONCE. All or nothing.
 *
 * A partial copy is the one outcome worth preventing above all others: some purchase orders answered
 * by PostgreSQL and the rest by Firestore, with no way to tell from either side which is which.
 */
async function copyPurchaseOrdersOnce(pool, input) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        // THE AUTHORITATIVE PLAN, BUILT HERE -- never carried in from a dry run taken against a database
        // that may since have gained the very rows this copy is about to insert.
        const view = await readPurchasingView(client, input.tenantId, sourceUids(input.source));
        const plan = (0, reorderPurchaseOrderMigration_js_1.planReorderPurchaseOrderMigration)({
            purchaseOrders: input.source.purchaseOrders,
            voids: input.source.voids,
            sourceRequestBackLinks: input.source.requestBackLinks,
            view,
            options: input.options,
        });
        const stop = async (refusal) => {
            await client.query("ROLLBACK");
            return Object.freeze({ plan, insertedPurchaseOrders: 0, insertedVoids: 0, applied: false, refusal });
        };
        // THE EXECUTOR IS VALIDATED, NOT TRUSTED. It answers "who ran this import" in the audit record
        // and nothing else: it is never a buyer and never the person who voided anything.
        const executorId = input.performedByPrincipalId;
        const shaped = typeof executorId === "string" && executorId !== "" && executorId.trim() === executorId;
        const executor = shaped
            ? await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
          WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [input.tenantId, executorId])
            : { rows: [] };
        if (executor.rows.length === 0) {
            return stop("the migration executor is not an active Principal with an active membership in this tenant");
        }
        const refusedPo = plan.purchaseOrders.filter((r) => r.disposition === "REFUSED");
        const refusedVoid = plan.voids.filter((r) => r.disposition === "REFUSED");
        if (refusedPo.length + refusedVoid.length > 0) {
            return stop(`${refusedPo.length} purchase order(s) and ${refusedVoid.length} void record(s) were refused; resolve them `
                + "before copying -- a partial copy would leave some purchases answered by PostgreSQL and the rest by Firestore");
        }
        if (plan.copyablePurchaseOrders.length + plan.copyableVoids.length === 0) {
            return stop("nothing to copy");
        }
        const at = input.now?.() ?? new Date();
        let insertedPurchaseOrders = 0;
        for (const planned of plan.copyablePurchaseOrders) {
            const row = planned.row;
            if (row === null)
                continue;
            // The plan proved the id was absent when the snapshot was taken; the primary key keeps that
            // true through commit. INSERT, never upsert -- a copy never overwrites a governed record.
            await client.query(`INSERT INTO eos_ops.purchase_orders
           (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number,
            ordered_quantity, ordered_date, expected_arrival_date,
            unit_price_minor, currency, price_authority_version, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11, $12, $13)`, [
                row.id, input.tenantId, row.operatingCompanyKey, row.partId, row.supplierName,
                row.externalPoNumber, row.orderedQuantity, row.orderedDate, row.expectedArrivalDate,
                row.unitPriceMinor, row.currency, row.priceAuthorityVersion,
                // THE RECORDING ACTOR: the resolved Principal. Never the uid, and never the executor
                // standing in for a buyer nobody could identify -- an unresolvable actor was REFUSED.
                row.createdByPrincipalId,
            ]);
            insertedPurchaseOrders += 1;
        }
        let insertedVoids = 0;
        for (const planned of plan.copyableVoids) {
            const row = planned.row;
            if (row === null)
                continue;
            await client.query(`INSERT INTO eos_ops.purchase_order_voids
           (purchase_order_id, tenant_id, operating_company_key, part_id, reason, voided_by, voided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, 
            // voided_at is the LEGACY void instant, not the copy time (reorderFieldParityMatrix: voidedAt).
            [row.purchaseOrderId, input.tenantId, row.operatingCompanyKey, row.partId, row.reason,
                row.voidedByPrincipalId, row.voidedAt]);
            insertedVoids += 1;
        }
        await client.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
       VALUES ($1, $2, $3, $4, 'reorder_purchase_order_migration', $2, NULL, $5::jsonb, $6, $7)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, input.tenantId, exports.PURCHASE_ORDER_COPY_ACTION, input.performedByPrincipalId,
            JSON.stringify({
                insertedPurchaseOrders, insertedVoids,
                sourcePurchaseOrders: plan.sourcePurchaseOrders, sourceVoids: plan.sourceVoids,
                incompleteAfterCopy: plan.incompleteAfterCopy.length,
            }),
            at, "legacy Reorder purchase order and void copy once"]);
        await client.query("COMMIT");
        return Object.freeze({ plan, insertedPurchaseOrders, insertedVoids, applied: true, refusal: null });
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
}
/**
 * VERIFY: structural proofs, and the completeness question activation actually turns on.
 *
 * Nothing here compares a stored value to a legacy uid string -- an id is not a uid because its
 * characters coincide with one. What is proved is that every identity column RESOLVES through the
 * authority that owns it, that no column exists which could hold a uid, and that no Reorder is left
 * in a state its evidence cannot support.
 */
async function verifyPurchaseOrderMigration(pool, tenantId, 
/**
 * ONLY the ids reorderKnownFixtures.classifyReorderTarget has proved to be the pinned, unchanged Sample Company
 * fixtures (ruling 2026-09-30, Option B). Nothing else may be passed here; absent, every row is checked.
 */
knownFixtures = { reorderRequestIds: [], purchaseOrderIds: [], voidIds: [] }) {
    const skip = { purchase_orders: [...knownFixtures.purchaseOrderIds], purchase_order_voids: [...knownFixtures.voidIds] };
    const skipColumn = { purchase_orders: "id", purchase_order_voids: "purchase_order_id" };
    const client = await pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const findings = [];
        const purchaseOrders = Number((await client.query(`SELECT count(*)::int AS n FROM eos_ops.purchase_orders WHERE tenant_id = $1`, [tenantId])).rows[0].n);
        const voids = Number((await client.query(`SELECT count(*)::int AS n FROM eos_ops.purchase_order_voids WHERE tenant_id = $1`, [tenantId])).rows[0].n);
        const uidShaped = (await client.query(`SELECT table_name || '.' || column_name AS col FROM information_schema.columns
        WHERE table_schema = 'eos_ops' AND table_name IN ('purchase_orders', 'purchase_order_voids')
          AND (column_name LIKE '%uid%' OR column_name LIKE '%external_subject%'
               OR column_name LIKE '%user_id%')`)).rows.map((r) => r.col);
        if (uidShaped.length > 0) {
            findings.push({ code: "UID_SHAPED_COLUMN", count: uidShaped.length,
                detail: `columns capable of holding an external subject: ${uidShaped.join(", ")}` });
        }
        // Every actor resolves to an ACTIVE membership. The foreign keys prove membership exists; this
        // proves it is still active, which a NOT VALID constraint does not.
        for (const [table, column] of [["purchase_orders", "created_by"], ["purchase_order_voids", "voided_by"]]) {
            const { rows } = await client.query(`SELECT count(*)::int AS n FROM eos_ops.${table} t
          WHERE t.tenant_id = $1 AND NOT (t.${skipColumn[table]} = ANY($2::text[]))
            AND NOT EXISTS (SELECT 1 FROM eos_policy.tenant_memberships m
                             WHERE m.tenant_id = t.tenant_id AND m.principal_id = t.${column} AND m.status = 'active')`, [tenantId, skip[table]]);
            if (rows[0].n > 0) {
                findings.push({ code: "ACTOR_NOT_ACTIVE_MEMBER", count: Number(rows[0].n),
                    detail: `${table}.${column} names a Principal with no active membership in this tenant` });
            }
        }
        // The company on every purchasing row resolves through an ACTIVE binding. A key that no longer
        // names a governed company would make the row's ownership unanswerable.
        for (const table of ["purchase_orders", "purchase_order_voids"]) {
            const { rows } = await client.query(`SELECT count(*)::int AS n FROM eos_ops.${table} t
          WHERE t.tenant_id = $1 AND NOT (t.${skipColumn[table]} = ANY($2::text[]))
            AND NOT EXISTS (SELECT 1 FROM eos_policy.tenant_operating_company_keys b
                             JOIN eos_policy.tenant_operating_companies c
                               ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
                            WHERE b.tenant_id = t.tenant_id AND b.operating_company_key = t.operating_company_key
                              AND b.status = 'ACTIVE' AND c.status = 'ACTIVE')`, [tenantId, skip[table]]);
            if (rows[0].n > 0) {
                findings.push({ code: "COMPANY_KEY_NOT_GOVERNED", count: Number(rows[0].n),
                    detail: `${table}.operating_company_key is not bound to an ACTIVE operating company` });
            }
        }
        // A void whose purchase order disagrees with it about the part or the company is two records
        // describing two different things under one id.
        const incoherentVoid = (await client.query(`SELECT count(*)::int AS n FROM eos_ops.purchase_order_voids v
         JOIN eos_ops.purchase_orders p ON p.id = v.purchase_order_id AND p.tenant_id = v.tenant_id
        WHERE v.tenant_id = $1 AND NOT (v.purchase_order_id = ANY($2::text[]))
          AND (v.part_id <> p.part_id OR v.operating_company_key <> p.operating_company_key)`, [tenantId, skip.purchase_order_voids])).rows[0].n;
        if (incoherentVoid > 0) {
            findings.push({ code: "VOID_DISAGREES_WITH_ORDER", count: Number(incoherentVoid),
                detail: "a void record and its purchase order name different parts or different companies" });
        }
        // ---- ACTIVATION COMPLETENESS, asked of the committed target ----
        const requiring = [...reorderPurchaseOrderMigration_js_1.STATUSES_REQUIRING_PURCHASE_ORDER];
        const incomplete = (await client.query(`SELECT r.id, r.status::text AS status,
              (p.id IS NULL) AS missing_order,
              (r.status = 'VOIDED' AND v.purchase_order_id IS NULL) AS missing_void
         FROM eos_ops.reorder_requests r
         LEFT JOIN eos_ops.purchase_orders p ON p.id = r.id AND p.tenant_id = r.tenant_id
         LEFT JOIN eos_ops.purchase_order_voids v ON v.purchase_order_id = r.id AND v.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 AND r.status::text = ANY($2::text[]) AND NOT (r.id = ANY($3::text[]))
          AND (p.id IS NULL OR (r.status = 'VOIDED' AND v.purchase_order_id IS NULL))
        ORDER BY r.id`, [tenantId, requiring, [...knownFixtures.reorderRequestIds]])).rows.map((r) => Object.freeze({
            reorderRequestId: r.id,
            status: r.status,
            missing: r.missing_order
                ? (r.status === "ORDERED"
                    ? "no governed Purchase Order: this Reorder cannot be received after cutover"
                    : "no governed Purchase Order: this Reorder's history cannot be explained after cutover")
                : "no void record: a VOIDED Reorder keeps its purchase order AND the evidence of why it was cancelled",
        }));
        if (incomplete.length > 0) {
            findings.push({ code: "LIFECYCLE_INCOMPLETE", count: incomplete.length,
                detail: "a Reorder whose status requires a Purchase Order does not have one after the copy" });
        }
        await client.query("COMMIT");
        return Object.freeze({
            purchaseOrders, voids,
            findings: Object.freeze(findings),
            uidShapedColumns: Object.freeze(uidShaped),
            incompleteLifecycles: Object.freeze(incomplete),
            passed: findings.length === 0,
        });
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=reorderPurchaseOrderMigrationCopy.js.map