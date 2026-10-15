"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSFER_LEGS = exports.PurchasingRepositoryError = exports.PO_VOIDABLE_STATUS = exports.PO_RECORDABLE_STATUS = exports.MIGRATED_REORDER_PROVENANCE = exports.NATIVE_REORDER_PROVENANCE = exports.TRANSFER_ORDER_STATUSES = exports.RECEIVING_SOURCE_KINDS = exports.RECEIVING_ORDER_STATUSES = exports.REORDER_REQUEST_STATUSES = void 0;
exports.createReorderRequest = createReorderRequest;
exports.readReorderRequest = readReorderRequest;
exports.recordPurchaseOrder = recordPurchaseOrder;
exports.readPurchaseOrder = readPurchaseOrder;
exports.voidPurchaseOrder = voidPurchaseOrder;
exports.readPurchaseOrderVoid = readPurchaseOrderVoid;
exports.insertReceivingOrder = insertReceivingOrder;
exports.createReceivingOrder = createReceivingOrder;
exports.readReceivedQuantities = readReceivedQuantities;
exports.transferLegOperatingCompanyKey = transferLegOperatingCompanyKey;
exports.createTransferOrder = createTransferOrder;
exports.readTransferOrder = readTransferOrder;
exports.countTransferOrdersByCompanyDirection = countTransferOrdersByCompanyDirection;
const node_crypto_1 = require("node:crypto");
const operatingCompanyAuthority_js_1 = require("../ownership/operatingCompanyAuthority.js");
const operatingCompanyCustody_js_1 = require("./operatingCompanyCustody.js");
const SCHEMA = "eos_ops";
const newId = (prefix) => `${prefix}_${(0, node_crypto_1.randomUUID)()}`;
/** `eos_ops.ops_reorder_request_status` — field-ops-app-vite/src/domain/constants.js, verbatim. */
exports.REORDER_REQUEST_STATUSES = [
    "PENDING_REVIEW", "APPROVED", "REJECTED",
    "READY_FOR_PARTS_MANAGER", "ASSIGNED_TO_PARTS_ASSOCIATE", "PURCHASING_IN_PROGRESS",
    "ORDERED", "RECEIVED", "CANCELLED", "VOIDED",
];
/** `eos_ops.ops_receiving_order_status`. */
exports.RECEIVING_ORDER_STATUSES = ["EXPECTED", "CHECKED_IN", "PUTAWAY_COMPLETE", "CANCELLED"];
/** `eos_ops.ops_receiving_source_kind` — the closed discriminator, never inferred from an id. */
exports.RECEIVING_SOURCE_KINDS = ["REORDER_PURCHASE_ORDER", "PURCHASE_ORDER"];
/** `eos_ops.ops_transfer_order_status`. */
exports.TRANSFER_ORDER_STATUSES = ["REQUESTED", "IN_TRANSIT", "COMPLETED", "CANCELLED"];
/**
 * The state a reorder request must be in for its purchase order to be recorded.
 *
 * Unchanged from reorderCommands.ts's `PO_RECORDABLE_STATUS`, which itself is unchanged from the
 * retired Rules branch. Restating the value is unavoidable here (that module is a Firebase-adjacent
 * command core and this one may not import it), so the constant is named identically and a test
 * pins the two equal rather than leaving the duplication unguarded.
 */
/**
 * A Reorder raised through this command, as opposed to one copied from the legacy Firestore object.
 *
 * The distinction is not decoration: a MIGRATED row may legitimately have no known requester, and
 * the constraint that keeps the native guarantee intact is keyed on this value.
 */
exports.NATIVE_REORDER_PROVENANCE = "NATIVE";
exports.MIGRATED_REORDER_PROVENANCE = "MIGRATED";
exports.PO_RECORDABLE_STATUS = "PURCHASING_IN_PROGRESS";
/** The ONLY state a purchase order may be voided from. VOIDED is reachable from ORDERED and nowhere else. */
exports.PO_VOIDABLE_STATUS = "ORDERED";
/** eos_ops error idiom (see CycleCountRepositoryError): a stable `code` plus a human message. */
class PurchasingRepositoryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "PurchasingRepositoryError";
    }
}
exports.PurchasingRepositoryError = PurchasingRepositoryError;
/**
 * Low-level INSERT of a Reorder Request row.
 *
 * ════════════════════ THIS IS NOT THE LIVE REORDER SEMANTICS ════════════════════
 *
 * `createGovernedReorderRequest` (reorderLifecycleCommands.ts) is. It is the command that checks the
 * capability, reads the operating company FROM the governed warehouse rather than accepting one, and
 * refuses an inactive or foreign warehouse. NONE of that is here, and none of it should be inferred
 * from here.
 *
 * This function exists for the sample-company seed, which builds a world from repository primitives
 * rather than by calling commands it has no capability context for. It is QUARANTINED to that role:
 * it defines no business rule, and a second caller wanting "create a Reorder" wants the command.
 *
 * `requestedByPrincipalId` IS AN EOS PRINCIPAL. It was previously named `actorId` and the seed passed
 * an operator token into it, which is how a uid-shaped string came to sit in a governed identity
 * column. The name states the requirement and the foreign key enforces it.
 */
async function createReorderRequest(pool, tenantId, requestedByPrincipalId, operatingCompanyKey, row) {
    // Refused HERE as well as by the NOT NULL column, so a caller that omitted it gets the reason
    // rather than a constraint name — and so no code path can quietly supply a placeholder.
    const companyKey = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(operatingCompanyKey);
    const id = newId("rr");
    await pool.query(
    // `provenance` is STATED, never defaulted -- migration 035 drops the column default precisely so
    // that a row raised through this command cannot be mistaken for one lifted out of Firestore.
    `INSERT INTO ${SCHEMA}.reorder_requests
       (id, tenant_id, operating_company_key, part_id, warehouse_id, status,
        requested_quantity, recommended_quantity, work_order_id, reorder_request_number,
        requested_by, updated_by, provenance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, '${exports.NATIVE_REORDER_PROVENANCE}')`, [
        id, tenantId, companyKey, row.partId, row.warehouseId, row.status,
        row.requestedQuantity, row.recommendedQuantity ?? null, row.workOrderId ?? null,
        row.reorderRequestNumber ?? null, requestedByPrincipalId,
    ]);
    return {
        id,
        tenantId,
        operatingCompanyKey: companyKey,
        partId: row.partId,
        warehouseId: row.warehouseId,
        status: row.status,
        requestedQuantity: row.requestedQuantity,
        recommendedQuantity: row.recommendedQuantity ?? null,
        workOrderId: row.workOrderId ?? null,
        reorderRequestNumber: row.reorderRequestNumber ?? null,
    };
}
async function readReorderRequest(pool, tenantId, requestId) {
    const { rows } = await pool.query(`SELECT id, tenant_id, operating_company_key, part_id, warehouse_id, status,
            requested_quantity, recommended_quantity, work_order_id, reorder_request_number
       FROM ${SCHEMA}.reorder_requests WHERE tenant_id = $1 AND id = $2`, [tenantId, requestId]);
    if (rows.length === 0)
        return null;
    return mapReorderRequestRow(rows[0]);
}
function mapReorderRequestRow(r) {
    return {
        id: r.id,
        tenantId: r.tenant_id,
        operatingCompanyKey: r.operating_company_key,
        partId: r.part_id,
        warehouseId: r.warehouse_id,
        status: r.status,
        requestedQuantity: r.requested_quantity,
        recommendedQuantity: r.recommended_quantity ?? null,
        workOrderId: r.work_order_id ?? null,
        reorderRequestNumber: r.reorder_request_number ?? null,
    };
}
/**
 * Resolve the PO's supplier identity INSIDE the recording transaction (DECISIONS #193). EXTERNAL -> an ACTIVE governed
 * supplier; INTERNAL -> another ACTIVE operating company of this tenant, never the purchasing company itself. The display
 * name is authored from the governed record, so supplier text can never override identity. No identity = a legacy
 * text-only PO: its text is kept for display and is never converted into counterparty truth.
 */
async function resolveSupplierIdentity(client, tenantId, companyKey, input) {
    const identity = input.supplierIdentity ?? null;
    if (identity === null)
        return { supplier: null, supplierName: input.supplierName };
    const { rows: binding } = await client.query(`SELECT k.operating_company_id FROM eos_policy.tenant_operating_company_keys k
       JOIN eos_policy.tenant_operating_companies c ON c.tenant_id = k.tenant_id AND c.operating_company_id = k.operating_company_id
      WHERE k.tenant_id = $1 AND k.operating_company_key = $2 AND k.status = 'ACTIVE' AND c.status = 'ACTIVE'`, [tenantId, companyKey]);
    if (binding.length !== 1) {
        throw new PurchasingRepositoryError("PURCHASING_COMPANY_UNRESOLVED", `the request's company key "${companyKey}" is not bound to one ACTIVE operating company`);
    }
    const purchasingOperatingCompanyId = String(binding[0].operating_company_id);
    if (identity.kind === "EXTERNAL_ORGANIZATION") {
        const { rows } = await client.query(`SELECT name, status::text AS status FROM ${SCHEMA}.suppliers WHERE tenant_id = $1 AND supplier_id = $2`, [tenantId, identity.supplierId]);
        if (rows.length === 0)
            throw new PurchasingRepositoryError("SUPPLIER_NOT_FOUND", "no governed supplier with that id");
        if (rows[0].status !== "ACTIVE")
            throw new PurchasingRepositoryError("SUPPLIER_INACTIVE", "the supplier is not ACTIVE");
        return { supplierName: String(rows[0].name),
            supplier: { kind: identity.kind, supplierId: identity.supplierId, supplierOperatingCompanyId: null, purchasingOperatingCompanyId } };
    }
    const { rows } = await client.query(`SELECT status FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2`, [tenantId, identity.operatingCompanyId]);
    if (rows.length === 0 || rows[0].status !== "ACTIVE") {
        throw new PurchasingRepositoryError("SUPPLIER_COMPANY_UNRESOLVED", "the supplying operating company is not an ACTIVE operating company of this tenant");
    }
    if (identity.operatingCompanyId === purchasingOperatingCompanyId) {
        throw new PurchasingRepositoryError("SELF_PURCHASE_REFUSED", "an operating company cannot purchase from itself");
    }
    return { supplierName: (0, operatingCompanyAuthority_js_1.operatingCompanyDisplayName)(identity.operatingCompanyId) ?? identity.operatingCompanyId,
        supplier: { kind: identity.kind, supplierId: null, supplierOperatingCompanyId: identity.operatingCompanyId, purchasingOperatingCompanyId } };
}
/**
 * Record the purchase order for a reorder request, and move the request to ORDERED — BOTH HALVES,
 * ONE TRANSACTION, OR NEITHER (ruling R-16).
 *
 * There is no `purchaseOrderId` parameter and no `operatingCompanyKey` parameter, and both omissions
 * are the point:
 *
 *   · the purchase order's id IS `reorderRequestId`, so a caller has nothing to get wrong;
 *   · the company is read from the request row inside this transaction, so it is INHERITED and
 *     cannot be supplied, overridden, or re-derived from a warehouse that may since have moved.
 *
 * Fail-closed refusals, all before any write: REQUEST_NOT_FOUND, REQUEST_STATE_INVALID,
 * PO_ALREADY_EXISTS. The last one is also the schema's (the primary key), and is checked here so the
 * caller gets the domain reason rather than a unique-violation.
 */
/**
 * `actorPrincipalId` IS AN EOS PRINCIPAL. It lands in `purchase_orders.created_by` and in the
 * request's `updated_by`, and migration 039 constrains both to a member of this tenant.
 */
async function recordPurchaseOrder(pool, tenantId, actorPrincipalId, reorderRequestId, input) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // FOR UPDATE: the state check and the write must see the same row. Without it, two concurrent
        // recordings could both observe PURCHASING_IN_PROGRESS and one would then fail on the primary
        // key with an opaque error instead of the domain refusal.
        const { rows } = await client.query(`SELECT operating_company_key, part_id, status, warehouse_id
         FROM ${SCHEMA}.reorder_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, reorderRequestId]);
        if (rows.length === 0) {
            throw new PurchasingRepositoryError("REQUEST_NOT_FOUND", `no reorder request ${reorderRequestId}`);
        }
        const request = rows[0];
        if (request.status !== exports.PO_RECORDABLE_STATUS) {
            throw new PurchasingRepositoryError("REQUEST_STATE_INVALID", `reorder request is ${request.status}, not ${exports.PO_RECORDABLE_STATUS}`);
        }
        const existing = await client.query(`SELECT 1 FROM ${SCHEMA}.purchase_orders WHERE id = $1`, [reorderRequestId]);
        if (existing.rowCount !== 0) {
            throw new PurchasingRepositoryError("PO_ALREADY_EXISTS", "this reorder request already has a purchase order");
        }
        // INHERITED, not supplied. Still passed through the authority gate, because a request row that
        // somehow carried a blank key must not become a purchase order that claims one.
        const companyKey = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(request.operating_company_key);
        const priced = input.unitPriceMinor ?? null;
        const currency = input.currency ?? null;
        const { supplier, supplierName } = await resolveSupplierIdentity(client, tenantId, companyKey, input);
        await client.query(`INSERT INTO ${SCHEMA}.purchase_orders
         (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number,
          ordered_quantity, ordered_date, expected_arrival_date,
          unit_price_minor, currency, price_authority_version, created_by,
          supplier_kind, supplier_id, supplier_operating_company_id, purchasing_operating_company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11, $12, $13, $14, $15, $16, $17)`, [
            reorderRequestId, tenantId, companyKey, request.part_id,
            supplierName, input.externalPoNumber, input.orderedQuantity,
            input.orderedDate, input.expectedArrivalDate ?? null,
            priced, currency, input.priceAuthorityVersion ?? null, actorPrincipalId,
            supplier?.kind ?? null, supplier?.supplierId ?? null, supplier?.supplierOperatingCompanyId ?? null,
            supplier?.purchasingOperatingCompanyId ?? null,
        ]);
        await client.query(`UPDATE ${SCHEMA}.reorder_requests
          SET status = 'ORDERED', updated_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`, [tenantId, reorderRequestId, actorPrincipalId]);
        // THE AUDIT, in the same transaction as the purchase order and the ORDERED transition: a recorded purchase order
        // cannot exist without the evidence of who recorded it, for which request, under which company (XLF, 2026-09-30).
        // A refusal above rolls back before this point, so a refused or replayed recording writes no audit event.
        const assignee = await client.query(`SELECT assigned_employee_id FROM ${SCHEMA}.reorder_request_assignments
        WHERE tenant_id = $1 AND reorder_request_id = $2 AND effective_to IS NULL`, [tenantId, reorderRequestId]);
        await client.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
       VALUES ($1, $2, 'reorder.request.recordPurchaseOrder', $3, 'purchase_order', $4, $5::jsonb, $6::jsonb, now(), $7)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, tenantId, actorPrincipalId, reorderRequestId,
            JSON.stringify({ status: exports.PO_RECORDABLE_STATUS }),
            JSON.stringify({
                status: "ORDERED", reorderRequestId, purchaseOrderId: reorderRequestId, operatingCompanyKey: companyKey,
                warehouseId: request.warehouse_id ?? null, partId: request.part_id,
                actorEmployeeId: assignee.rows[0]?.assigned_employee_id ?? null,
                externalPoNumber: input.externalPoNumber, orderedQuantity: input.orderedQuantity, orderedDate: input.orderedDate,
                supplierKind: supplier?.kind ?? "LEGACY_TEXT", supplierId: supplier?.supplierId ?? null,
                supplierOperatingCompanyId: supplier?.supplierOperatingCompanyId ?? null,
                purchasingOperatingCompanyId: supplier?.purchasingOperatingCompanyId ?? null,
            }),
            "purchase order recorded"]);
        await client.query("COMMIT");
        return {
            purchaseOrderId: reorderRequestId,
            tenantId,
            operatingCompanyKey: companyKey,
            partId: request.part_id,
            supplierName,
            externalPoNumber: input.externalPoNumber,
            orderedQuantity: input.orderedQuantity,
            orderedDate: input.orderedDate,
            expectedArrivalDate: input.expectedArrivalDate ?? null,
            unitPriceMinor: priced,
            currency,
            priceAuthorityVersion: input.priceAuthorityVersion ?? null,
            supplier,
        };
    }
    catch (err) {
        await rollbackQuietly(client);
        throw err;
    }
    finally {
        client.release();
    }
}
async function readPurchaseOrder(pool, tenantId, purchaseOrderId) {
    const { rows } = await pool.query(`SELECT id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number,
            ordered_quantity, to_char(ordered_date, 'YYYY-MM-DD') AS ordered_date,
            to_char(expected_arrival_date, 'YYYY-MM-DD') AS expected_arrival_date,
            unit_price_minor, currency, price_authority_version,
            supplier_kind, supplier_id, supplier_operating_company_id, purchasing_operating_company_id
       FROM ${SCHEMA}.purchase_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, purchaseOrderId]);
    if (rows.length === 0)
        return null;
    const r = rows[0];
    return {
        purchaseOrderId: r.id,
        tenantId: r.tenant_id,
        operatingCompanyKey: r.operating_company_key,
        partId: r.part_id,
        supplierName: r.supplier_name,
        externalPoNumber: r.external_po_number,
        orderedQuantity: r.ordered_quantity,
        orderedDate: r.ordered_date,
        expectedArrivalDate: r.expected_arrival_date ?? null,
        // BIGINT arrives as a string from `pg`. Parsed once, here, so no caller has to remember —
        // and money that silently stayed a string would compare and sum wrongly everywhere downstream.
        unitPriceMinor: r.unit_price_minor === null ? null : Number(r.unit_price_minor),
        currency: r.currency ?? null,
        priceAuthorityVersion: r.price_authority_version ?? null,
        supplier: r.supplier_kind === null || r.supplier_kind === undefined ? null : {
            kind: r.supplier_kind,
            supplierId: r.supplier_id ?? null,
            supplierOperatingCompanyId: r.supplier_operating_company_id ?? null,
            purchasingOperatingCompanyId: r.purchasing_operating_company_id,
        },
    };
}
/**
 * Void a purchase order — by WRITING A VOID RECORD, never by touching the purchase order.
 *
 * This function issues no statement against `purchase_orders` at all. What it does is insert the
 * append-only void record and move the REQUEST to VOIDED, in one transaction, which is the same
 * atomic pairing firestore.rules enforced with `existsAfter()`/`getAfter()` across the two documents.
 *
 * The void record's company and part are copied from the PURCHASE ORDER row read inside this
 * transaction — not supplied, and not re-derived — so a void can never attribute itself to a company
 * or a part the purchase order it voids did not carry.
 */
/**
 * `actorPrincipalId` IS AN EOS PRINCIPAL. It lands in `purchase_order_voids.voided_by` and in the
 * request's `updated_by`, and migration 039 constrains both to a member of this tenant.
 */
async function voidPurchaseOrder(pool, tenantId, actorPrincipalId, purchaseOrderId, reason) {
    if (typeof reason !== "string" || reason.trim() === "") {
        throw new PurchasingRepositoryError("VOID_REASON_REQUIRED", "a void records why, or it records nothing");
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const req = await client.query(`SELECT status FROM ${SCHEMA}.reorder_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, purchaseOrderId]);
        if (req.rows.length === 0) {
            throw new PurchasingRepositoryError("REQUEST_NOT_FOUND", `no reorder request ${purchaseOrderId}`);
        }
        if (req.rows[0].status !== exports.PO_VOIDABLE_STATUS) {
            throw new PurchasingRepositoryError("REQUEST_STATE_INVALID", `a purchase order is voidable only from ${exports.PO_VOIDABLE_STATUS}`);
        }
        const po = await client.query(`SELECT operating_company_key, part_id FROM ${SCHEMA}.purchase_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, purchaseOrderId]);
        if (po.rows.length === 0) {
            throw new PurchasingRepositoryError("PO_NOT_FOUND", `no purchase order ${purchaseOrderId}`);
        }
        const already = await client.query(`SELECT 1 FROM ${SCHEMA}.purchase_order_voids WHERE purchase_order_id = $1`, [purchaseOrderId]);
        if (already.rowCount !== 0) {
            throw new PurchasingRepositoryError("PO_ALREADY_VOIDED", "this purchase order already has a void record");
        }
        const source = po.rows[0];
        const companyKey = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(source.operating_company_key);
        await client.query(`INSERT INTO ${SCHEMA}.purchase_order_voids
         (purchase_order_id, tenant_id, operating_company_key, part_id, reason, voided_by)
       VALUES ($1, $2, $3, $4, $5, $6)`, [purchaseOrderId, tenantId, companyKey, source.part_id, reason, actorPrincipalId]);
        await client.query(`UPDATE ${SCHEMA}.reorder_requests
          SET status = 'VOIDED', updated_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`, [tenantId, purchaseOrderId, actorPrincipalId]);
        // THE AUDIT, in the same transaction as the void: a management exception is answerable for who, why and when.
        await client.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
       VALUES ($1, $2, 'reorder.purchaseOrder.void', $3, 'purchase_order', $4, $5::jsonb, $6::jsonb, now(), $7)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, tenantId, actorPrincipalId, purchaseOrderId,
            JSON.stringify({ status: exports.PO_VOIDABLE_STATUS }), JSON.stringify({ status: "VOIDED", operatingCompanyKey: companyKey }), reason]);
        await client.query("COMMIT");
        return {
            purchaseOrderId,
            tenantId,
            operatingCompanyKey: companyKey,
            partId: source.part_id,
            reason,
            voidedBy: actorPrincipalId,
        };
    }
    catch (err) {
        await rollbackQuietly(client);
        throw err;
    }
    finally {
        client.release();
    }
}
async function readPurchaseOrderVoid(pool, tenantId, purchaseOrderId) {
    const { rows } = await pool.query(`SELECT purchase_order_id, tenant_id, operating_company_key, part_id, reason, voided_by
       FROM ${SCHEMA}.purchase_order_voids WHERE tenant_id = $1 AND purchase_order_id = $2`, [tenantId, purchaseOrderId]);
    if (rows.length === 0)
        return null;
    const r = rows[0];
    return {
        purchaseOrderId: r.purchase_order_id,
        tenantId: r.tenant_id,
        operatingCompanyKey: r.operating_company_key,
        partId: r.part_id,
        reason: r.reason,
        voidedBy: r.voided_by,
    };
}
/**
 * Write a receiving order and its lines INSIDE the caller's transaction.
 *
 * The caller owns BEGIN and COMMIT. That is the whole point: a receipt is only one of the effects a
 * receiving transaction commits -- the inventory movement, the serialized custody, the
 * acquisition-cost evidence and the Reorder closeout are the others -- and a writer that opened its
 * own transaction could commit the receipt while those rolled back.
 *
 * An order without its lines is a receipt that received nothing, and lines without their order are
 * quantities attributed to no receipt. Neither is a legal intermediate state.
 */
async function insertReceivingOrder(client, tenantId, actorId, operatingCompanyKey, row) {
    const companyKey = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(operatingCompanyKey);
    if (!Array.isArray(row.lines) || row.lines.length === 0) {
        throw new PurchasingRepositoryError("RECEIPT_NO_LINES", "a receiving order records at least one line");
    }
    if (!(row.receivedAt instanceof Date) || Number.isNaN(row.receivedAt.getTime())) {
        throw new PurchasingRepositoryError("RECEIVED_AT_REQUIRED", "a receipt states when the goods arrived; it is never inferred from when the row was written");
    }
    if (row.receivingLocation?.type === "MOBILE") {
        // OD-T5: purchased stock is received at a WAREHOUSE or BIN, never a truck (receiving_destination_not_mobile).
        throw new PurchasingRepositoryError("RECEIPT_TO_MOBILE_REFUSED", "a receipt's destination is a WAREHOUSE or BIN, never a MOBILE location");
    }
    const legacy = row.sourceKind === "REORDER_PURCHASE_ORDER";
    const reorderRequestId = row.reorderRequestId ?? null;
    if (legacy && reorderRequestId !== row.purchaseOrderId) {
        // The legacy chain's identity equation (receivingTypes.ts: "legacy: == reorderRequestId").
        // Refused here so the caller learns WHICH rule it broke.
        throw new PurchasingRepositoryError("SOURCE_IDENTITY_MISMATCH", "a legacy receipt's reorderRequestId IS its purchaseOrderId");
    }
    if (!legacy && reorderRequestId !== null) {
        throw new PurchasingRepositoryError("SOURCE_IDENTITY_MISMATCH", "a canonical purchase order has no reorder request; absence is the true statement");
    }
    await client.query(`INSERT INTO ${SCHEMA}.receiving_orders
       (id, tenant_id, operating_company_key, source_kind, source_purchase_order_id,
        source_reorder_request_id, receiving_location_type, receiving_location_id,
        status, receiving_order_number, idempotency_key, request_fingerprint, received_at,
        created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`, [
        row.id, tenantId, companyKey, row.sourceKind, row.purchaseOrderId, reorderRequestId,
        row.receivingLocation.type, row.receivingLocation.id, row.status,
        row.receivingOrderNumber ?? null, row.idempotencyKey, row.requestFingerprint ?? null,
        row.receivedAt, actorId,
    ]);
    for (const line of row.lines) {
        await client.query(`INSERT INTO ${SCHEMA}.receiving_order_lines
         (id, tenant_id, receiving_order_id, line_id, part_id, tracking_mode,
          expected_quantity, received_quantity, serial_numbers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
            newId("rcvl"), tenantId, row.id, line.lineId, line.partId, line.trackingMode,
            line.expectedQuantity, line.receivedQuantity, [...(line.serialNumbers ?? [])],
        ]);
    }
    return {
        id: row.id,
        tenantId,
        operatingCompanyKey: companyKey,
        sourceKind: row.sourceKind,
        purchaseOrderId: row.purchaseOrderId,
        reorderRequestId,
        receivingLocation: row.receivingLocation,
        status: row.status,
        receivingOrderNumber: row.receivingOrderNumber ?? null,
        receivedAt: row.receivedAt,
        lines: row.lines,
    };
}
/**
 * Create a receiving order and its lines — ONE transaction.
 *
 * The pool-scoped wrapper around `insertReceivingOrder`, for a caller that has no other effects to
 * commit alongside the receipt. It generates the receipt id and supplies no request fingerprint, so
 * a receipt written this way cannot later be REPLAYED -- the governed receiving command derives both
 * and does not come through here.
 */
async function createReceivingOrder(pool, tenantId, actorId, operatingCompanyKey, row) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const record = await insertReceivingOrder(client, tenantId, actorId, operatingCompanyKey, {
            ...row, id: newId("rcv"),
        });
        await client.query("COMMIT");
        return record;
    }
    catch (err) {
        await rollbackQuietly(client);
        throw err;
    }
    finally {
        client.release();
    }
}
/**
 * How much of a purchase order has arrived — the SUM OF COMMITTED RECEIPTS, per line.
 *
 * DERIVED, never stored. This is purchaseOrderNormalization.ts's ruling as the only query the schema
 * permits: `purchase_orders` has no counter to read instead, so "concurrent receipts cannot lose an
 * update, an immutable document stays immutable, and every quantity traces to a receipt".
 *
 * CANCELLED receipts are excluded. A cancelled receipt is a receipt that did not happen, and summing
 * it would report stock as arrived that nothing put away.
 */
async function readReceivedQuantities(pool, tenantId, sourceKind, purchaseOrderId) {
    const { rows } = await pool.query(`SELECT l.line_id, SUM(l.received_quantity)::int AS received
       FROM ${SCHEMA}.receiving_order_lines l
       JOIN ${SCHEMA}.receiving_orders o
         ON o.id = l.receiving_order_id AND o.tenant_id = l.tenant_id
      WHERE l.tenant_id = $1 AND o.source_kind = $2 AND o.source_purchase_order_id = $3
        AND o.status <> 'CANCELLED'
      GROUP BY l.line_id
      ORDER BY l.line_id`, [tenantId, sourceKind, purchaseOrderId]);
    return rows.map((r) => ({ lineId: r.line_id, receivedQuantity: r.received }));
}
/** The two legs of a transfer, and the only two. */
exports.TRANSFER_LEGS = ["OUT", "IN"];
/**
 * THE PAIR → SCALAR PROJECTION. The one place a transfer's directional company pair becomes the
 * single `operating_company_key` an `eos_ops.inventory_movements` row carries.
 *
 * A movement row is one-sided by construction: TRANSFER_OUT is staged at the ORIGIN when the goods
 * leave, TRANSFER_IN at the DESTINATION when they arrive. So the OUT leg belongs to the source
 * company and the IN leg to the destination company — and for a same-company transfer both resolve
 * to the same key, which is correct rather than a special case.
 *
 * This is why migration 007's scalar column is not a gap and is not widened here: widening it would
 * put the destination's authority on a row describing the origin, before the destination had
 * received anything, in a second place the destination's own row already states it.
 */
function transferLegOperatingCompanyKey(companies, leg) {
    // Both are gated, not just the one selected: a pair with a blank half is not a pair, and letting
    // the OUT leg succeed on a half-pair would import a transfer whose IN leg can never be written.
    const source = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(companies?.source);
    const destination = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(companies?.destination);
    return leg === "OUT" ? source : destination;
}
async function createTransferOrder(pool, tenantId, actorId, companies, row) {
    // BOTH, never one. `requireOperatingCompanyKey` refuses a missing key rather than defaulting it,
    // so a half-pair fails here with the reason and never reaches the NOT NULL columns.
    const source = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(companies?.source);
    const destination = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(companies?.destination);
    const id = newId("trf");
    const serials = [...(row.serialNumbers ?? [])];
    // `is_cross_company` is deliberately absent from this INSERT: it is GENERATED ALWAYS and the
    // database refuses to be told what it is. The value below is read back, not computed here.
    const { rows } = await pool.query(`INSERT INTO ${SCHEMA}.transfer_orders
       (id, tenant_id, source_operating_company_key, destination_operating_company_key,
        part_id, tracking_mode, quantity,
        origin_location_type, origin_location_id,
        destination_location_type, destination_location_id,
        serial_numbers, status, transfer_order_number, idempotency_key, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
     RETURNING is_cross_company`, [
        id, tenantId, source, destination,
        row.partId, row.trackingMode, row.quantity,
        row.origin.type, row.origin.id,
        row.destination.type, row.destination.id,
        serials, row.status, row.transferOrderNumber ?? null, row.idempotencyKey, actorId,
    ]);
    return {
        id,
        tenantId,
        companies: { source, destination },
        isCrossCompany: rows[0].is_cross_company,
        partId: row.partId,
        trackingMode: row.trackingMode,
        quantity: row.quantity,
        origin: row.origin,
        destination: row.destination,
        serialNumbers: serials,
        status: row.status,
        transferOrderNumber: row.transferOrderNumber ?? null,
    };
}
async function readTransferOrder(pool, tenantId, transferOrderId) {
    const { rows } = await pool.query(`SELECT id, tenant_id, source_operating_company_key, destination_operating_company_key,
            is_cross_company, part_id, tracking_mode, quantity,
            origin_location_type, origin_location_id,
            destination_location_type, destination_location_id,
            serial_numbers, status, transfer_order_number
       FROM ${SCHEMA}.transfer_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, transferOrderId]);
    if (rows.length === 0)
        return null;
    const r = rows[0];
    return {
        id: r.id,
        tenantId: r.tenant_id,
        companies: {
            source: r.source_operating_company_key,
            destination: r.destination_operating_company_key,
        },
        isCrossCompany: r.is_cross_company,
        partId: r.part_id,
        trackingMode: r.tracking_mode,
        quantity: r.quantity,
        origin: { type: r.origin_location_type, id: r.origin_location_id },
        destination: {
            type: r.destination_location_type,
            id: r.destination_location_id,
        },
        serialNumbers: r.serial_numbers ?? [],
        status: r.status,
        transferOrderNumber: r.transfer_order_number ?? null,
    };
}
/**
 * Count the cross-company transfers — the RECONCILIATION read.
 *
 * Reads the generated column rather than recomputing the comparison, so what is reported is exactly
 * what the database stored, and an import's cross-company share can be checked against the source
 * census without a second opinion about what "cross-company" means.
 */
async function countTransferOrdersByCompanyDirection(pool, tenantId) {
    const { rows } = await pool.query(`SELECT count(*)::int AS total,
            count(*) FILTER (WHERE is_cross_company)::int AS cross_company
       FROM ${SCHEMA}.transfer_orders WHERE tenant_id = $1`, [tenantId]);
    const r = rows[0];
    return { total: r.total, crossCompany: r.cross_company, sameCompany: r.total - r.cross_company };
}
// ════════════════════════════════ internals ════════════════════════════════
/**
 * Roll back without replacing the caller's error.
 *
 * A ROLLBACK that itself throws (a dead connection, most often) would otherwise surface INSTEAD of
 * the domain refusal that caused it, and the caller would be told the connection failed rather than
 * that its reorder request was in the wrong state.
 */
async function rollbackQuietly(client) {
    try {
        await client.query("ROLLBACK");
    }
    catch {
        /* the original error is the one worth reporting */
    }
}
//# sourceMappingURL=purchasingRepository.js.map