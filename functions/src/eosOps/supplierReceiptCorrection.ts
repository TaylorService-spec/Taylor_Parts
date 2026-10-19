// RECEIPT CORRECTION FOR A SUPPLIER PURCHASE ORDER RECEIPT (Firebase exit B3-x; DECISIONS #B3-x).
//
// "WE RECORDED THE RECEIPT WRONG", for the canonical multi-line supplier purchase order. The Reorder correction (receiptCorrectionCommand.ts,
// DECISIONS #193) is the semantics this applies, so the same words mean the same thing on both authorities -- but the two never fall back to
// each other: a Reorder receipt is corrected by correctReorderReceipt, a supplier-PO receipt only here.
//
//   VOID   the receipt did not happen as recorded. It takes the EXISTING `CANCELLED` status (already excluded from every received-quantity
//          derivation, so the order's remaining quantity is derived again with it gone), the stock leaves through compensating ADJUSTED
//          movements (one per line, signed through the ONE sign authority), every live acquisition fact is reversed, open missing-cost
//          exceptions are resolved, the order's version moves, and an order the receipt had completed (RECEIVED) is receivable again.
//
// WHY ONLY VOID. A Reorder receipt is full-quantity by rule, so "correct it" meant "receive it again somewhere else" and the Reorder
// command does both atomically. A supplier receipt is partial and multi-line: the right correction of a wrong quantity is to void it and
// receive the order again for the right lines, which the supplier receiving command already does -- through its OWN validation (over-receipt
// is measured against the remaining quantity, serials, destination scope). A second path that re-implemented a replacement here would be a
// second definition of "is this receipt allowed". So there is no CORRECTED here, and a replacement is a new receipt.
//
// THE ORDER'S STORED STATUS. Receiving sets RECEIVED only when every line is satisfied; the previous status (APPROVED or SENT) is not kept.
// An order that received goods was necessarily sent, so a voided completing receipt returns it to SENT -- a receivable status -- and
// nothing else about the order's lifecycle is touched. An order that was not RECEIVED keeps its status.
//
// WHAT IT DOES NOT DO (unchanged from the Reorder correction): SERIAL receipts (custody has no never-arrived state: refused), a wrong Part
// or line (they come from the order), a wrong company (never moves ownership), a wrong price (there is none: cost is UNKNOWN on a supplier
// line). The original receipt, its lines, its movements and its Finance facts are never edited or deleted. Stock is never driven negative:
// the correction refuses when the received quantity is no longer where the receipt put it.
//
// AUTHORITY: inventory.receipt.correct (the Reorder correction's key; registered, granted to nobody) + the caller's operating companies
// (the receipt's company: another company's receipt reads EXACTLY as a nonexistent one) + the WAREHOUSE scope over the receipt location.
// Administration reach (G2) is NOT extended to this act: it was ruled for the Reorder receipt's VOID only.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { ReceiveStockError, type ReceiveFailureCategory, type ReceivingPrincipalActor } from "./receiveReorderStockCommand.js";
import { RECEIPT_CORRECT_CAPABILITY, RECEIPT_CORRECTION_MOVEMENT_SOURCE_KIND } from "./receiptCorrectionCommand.js";
import { SUPPLIER_PO_SOURCE_KIND } from "./supplierPurchaseOrderReceiving.js";
import { resolveCompanyAuthority } from "./companyAuthority.js";
import { FinanceFoundationError, resolveReceiptCostExceptionsOn, reverseReceiptFinancialConsequenceOn } from "../eosFinance/financeFoundation.js";
import { retireIntercompanyCorrelationForReceiptOn } from "../eosFinance/intercompany.js";
import { retireReceiptPayableOn } from "../eosFinance/vendorPayable.js";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { InventoryScopeError, resolveScopeLocation } from "./inventoryScopeAuthority.js";
import { lockStockLocation } from "./stockLocationLock.js";
import { signedQuantity } from "../inventoryLedger/locationOnHand.js";
import { withActorAuthority } from "./administrationReach.js";

const SCHEMA = "eos_ops";

const refuse: (code: string, category: ReceiveFailureCategory, message: string) => never = (code, category, message) => {
  throw new ReceiveStockError(code, category, message);
};
const ID_SHAPE = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface SupplierReceiptCorrectionResult {
  readonly outcome: "applied" | "replayed";
  readonly correctionId: string;
  readonly receivingId: string;
  readonly purchaseOrderId: string;
  readonly correctionKind: "VOID";
  readonly compensatingMovementIds: readonly string[];
  readonly reversedFactIds: readonly string[];
  readonly resolvedExceptionIds: readonly string[];
}

/** Void ONE erroneously recorded supplier-PO receipt. One transaction: all of it or none of it. */
export async function correctSupplierPurchaseOrderReceipt(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReceivingPrincipalActor,
  input: Record<string, unknown>,
): Promise<SupplierReceiptCorrectionResult> {
  if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
  }
  if (!actor.capabilities.has(RECEIPT_CORRECT_CAPABILITY)) {
    refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `correcting a receipt requires ${RECEIPT_CORRECT_CAPABILITY}`);
  }
  if (!isPlainObject(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input).filter((k) => !["receivingId", "reason", "idempotencyKey"].includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  if (!ID_SHAPE(input.receivingId)) refuse("RECEIVING_ID_REQUIRED", "INVALID_INPUT", "receivingId is required");
  if (typeof input.reason !== "string" || input.reason.trim() === "" || input.reason.length > 500) {
    refuse("REASON_REQUIRED", "INVALID_INPUT", "a receipt correction states why (at most 500 characters)");
  }
  if (!ID_SHAPE(input.idempotencyKey)) refuse("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", "idempotencyKey is required");
  const receivingId = input.receivingId as string;
  const reason = (input.reason as string).trim();
  const idempotencyKey = input.idempotencyKey as string;
  // The SAME fingerprint formula as the Reorder correction (kind VOID, no replacement), so one key means one request on either authority.
  const fingerprint = createHash("sha256").update(JSON.stringify([receivingId, "VOID", reason, null])).digest("hex");

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    // CAPABILITY FIRST, THEN COMPANY: none at all is refused before any row is read.
    const authority = await resolveCompanyAuthority(client, actor.tenantId, actor.principalId);
    if (authority.companyKeys.length === 0) {
      refuse("COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN", "correcting a receipt requires operating-company authority; this principal has none");
    }
    const result = await voidWithin(client, deps, actor, { receivingId, reason, idempotencyKey, fingerprint, companyKeys: [...authority.companyKeys] });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const resultOf = (row: Record<string, unknown>, purchaseOrderId: string, outcome: "applied" | "replayed"): SupplierReceiptCorrectionResult => Object.freeze({
  outcome, correctionId: String(row.id), receivingId: String(row.receiving_order_id), purchaseOrderId, correctionKind: "VOID" as const,
  compensatingMovementIds: Object.freeze([...(row.compensating_movement_ids as string[])]),
  reversedFactIds: Object.freeze([...(row.reversed_fact_ids as string[])]),
  resolvedExceptionIds: Object.freeze([...(row.resolved_exception_ids as string[])]),
});

async function voidWithin(
  client: PoolClient,
  deps: { readonly now?: () => Date },
  actor: ReceivingPrincipalActor,
  c: { receivingId: string; reason: string; idempotencyKey: string; fingerprint: string; companyKeys: readonly string[] },
): Promise<SupplierReceiptCorrectionResult> {
  // ---- 1. REPLAY: the same key + the same request returns the recorded correction and writes nothing. A key recorded for a company the
  // caller does not reach is not visible here: the flow falls through to the receipt lookup, which reads that receipt as nonexistent. ----
  const prior = await client.query(
    `SELECT k.*, r.source_purchase_order_id FROM ${SCHEMA}.receiving_corrections k
       JOIN ${SCHEMA}.receiving_orders r ON r.tenant_id = k.tenant_id AND r.id = k.receiving_order_id
      WHERE k.tenant_id = $1 AND k.idempotency_key = $2 AND k.operating_company_key = ANY($3::text[]) AND r.source_kind::text = $4`,
    [actor.tenantId, c.idempotencyKey, [...c.companyKeys], SUPPLIER_PO_SOURCE_KIND]);
  if (prior.rows[0]) {
    if (prior.rows[0].request_fingerprint !== c.fingerprint) {
      refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotency key already recorded a DIFFERENT receipt correction");
    }
    return resultOf(prior.rows[0], String(prior.rows[0].source_purchase_order_id), "replayed");
  }

  // ---- 2. THE RECEIPT (company filter IN the WHERE: another company's receipt is nonexistent) and the SERIALIZATION ANCHOR the receipt itself
  // takes (its purchase order), locked first, then the receipt ----
  const peek = await client.query(
    `SELECT source_kind::text AS source_kind, source_purchase_order_id FROM ${SCHEMA}.receiving_orders
      WHERE tenant_id = $1 AND id = $2 AND operating_company_key = ANY($3::text[])`, [actor.tenantId, c.receivingId, [...c.companyKeys]]);
  if (!peek.rows[0]) refuse("RECEIPT_NOT_FOUND", "NOT_FOUND", "no receipt with that id in this tenant");
  if (peek.rows[0].source_kind !== SUPPLIER_PO_SOURCE_KIND) {
    refuse("RECEIPT_SOURCE_NOT_OWNED", "PRECONDITION_FAILED", `this authority corrects ${SUPPLIER_PO_SOURCE_KIND} receipts only; a Reorder receipt is corrected by correctReorderReceipt`);
  }
  const purchaseOrderId = String(peek.rows[0].source_purchase_order_id);
  const po = await client.query(
    `SELECT status, version FROM ${SCHEMA}.supplier_purchase_orders
      WHERE tenant_id = $1 AND id = $2 AND operating_company_key = ANY($3::text[]) FOR UPDATE`, [actor.tenantId, purchaseOrderId, [...c.companyKeys]]);
  if (!po.rows[0]) refuse("PURCHASE_ORDER_NOT_FOUND", "NOT_FOUND", "purchase order not found");
  const { rows: rcv } = await client.query(
    `SELECT id, operating_company_key, receiving_location_type::text AS location_type, receiving_location_id, status::text AS status
       FROM ${SCHEMA}.receiving_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, c.receivingId]);
  const receipt = rcv[0];
  if (receipt.status === "CANCELLED") {
    const { rows: done } = await client.query(`SELECT 1 FROM ${SCHEMA}.receiving_corrections WHERE tenant_id = $1 AND receiving_order_id = $2`, [actor.tenantId, c.receivingId]);
    refuse(done[0] ? "RECEIPT_ALREADY_CORRECTED" : "RECEIPT_CANCELLED", "PRECONDITION_FAILED", "this receipt is already cancelled; nothing to correct");
  }

  // ---- 3. AUTHORITY: inventory.receipt.correct + WAREHOUSE scope over the receipt location (a destination act) ----
  const where = { type: String(receipt.location_type), locationId: String(receipt.receiving_location_id) };
  let scopeWarehouseId: string;
  try {
    scopeWarehouseId = (await resolveScopeLocation(client, actor.tenantId, where)).scopeWarehouseId;
  } catch (err) {
    if (err instanceof InventoryScopeError) refuse(err.code, "PRECONDITION_FAILED", `the receipt location has no governing warehouse: ${err.message}`);
    throw err;
  }
  const scoped = await authorizeObjectAction(postgresContextualReader(client), {
    actor, capabilityKey: RECEIPT_CORRECT_CAPABILITY,
    // NO administration reach here. G2 (Owner 2026-10-09) ruled it for the REORDER receipt's VOID; extending it to a supplier-PO receipt is a
    // separate Owner decision (the reach opt-in sites are pinned, protectedAdministratorReachPostgres), so this act needs the caller's own scope.
    predicates: [{ kind: "OPERATIONAL_SCOPE" as const, scopeType: "WAREHOUSE", scopeId: scopeWarehouseId }],
  });
  if (!scoped.allowed) {
    refuse(scoped.reason, "FORBIDDEN", scoped.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "this receipt location is outside your warehouse scope"
      : scoped.reason === "EMPLOYEE_LINK_REQUIRED" ? "only an Employee can correct a receipt" : "not authorized to correct this receipt");
  }

  // ---- 4. THE LINES, and the INVENTORY INVARIANT: the received stock must still be where the receipt put it ----
  const { rows: lines } = await client.query(
    `SELECT line_id, part_id, tracking_mode::text AS tracking_mode, received_quantity FROM ${SCHEMA}.receiving_order_lines
      WHERE tenant_id = $1 AND receiving_order_id = $2 ORDER BY line_id`, [actor.tenantId, c.receivingId]);
  if (lines.some((l) => l.tracking_mode !== "NONE")) {
    refuse("RECEIPT_CORRECTION_SERIAL_UNSUPPORTED", "PRECONDITION_FAILED",
      "a serialized receipt cannot be corrected here yet: serialized custody has no governed never-arrived state");
  }
  for (const l of lines) {
    await lockStockLocation(client, actor.tenantId, l.part_id, where.type, where.locationId);
    const { rows } = await client.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(quantity_delta), 0)::bigint AS total FROM ${SCHEMA}.inventory_movements
        WHERE tenant_id = $1 AND part_id = $2 AND tracking_mode = 'NONE' AND location_type = $3 AND location_id = $4`,
      [actor.tenantId, l.part_id, where.type, where.locationId]);
    const onHand = Number(rows[0]?.total ?? 0);
    if (onHand < Number(l.received_quantity)) {
      refuse("RECEIPT_STOCK_ALREADY_MOVED", "PRECONDITION_FAILED",
        `only ${onHand} of the ${l.received_quantity} received remain at the receipt location: the stock was consumed, transferred or moved -- correct that downstream event first`);
    }
  }

  // ---- 5. THE COMPENSATING INVENTORY EFFECT: ADJUSTED, signed through the ONE sign authority, same company ----
  const at = deps.now?.() ?? new Date();
  const correctionId = `rcvc_${randomUUID()}`;
  const movementIds: string[] = [];
  for (const l of lines) {
    const movementId = `mov_${randomUUID()}`;
    await client.query(
      `INSERT INTO ${SCHEMA}.inventory_movements
         (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
          movement_type, quantity_delta, serial_number, source_kind, source_id, idempotency_key, occurred_at, created_by)
       VALUES ($1, $2, $3, $4, 'NONE', $5, $6, 'ADJUSTED', $7, NULL, $8, $9, $10, $11, $12)`,
      [movementId, actor.tenantId, receipt.operating_company_key, l.part_id, where.type, where.locationId,
        signedQuantity({ type: "ADJUSTED", quantity: -Number(l.received_quantity) }),
        RECEIPT_CORRECTION_MOVEMENT_SOURCE_KIND, correctionId, `rcvcorr:${correctionId}:${l.line_id}`, at, actor.principalId]);
    movementIds.push(movementId);
  }

  // ---- 6. THE RECEIPT IS CANCELLED -- never deleted; its lines, movements and evidence stay as recorded ----
  await client.query(
    `UPDATE ${SCHEMA}.receiving_orders SET status = 'CANCELLED', updated_by = $3, updated_at = $4
      WHERE tenant_id = $1 AND id = $2 AND status <> 'CANCELLED'`, [actor.tenantId, c.receivingId, actor.principalId, at]);

  // ---- 7. THE FINANCE CONSEQUENCE: every live acquisition fact reversed (never edited), any payable / correlation retired ----
  const financeActor = { tenantId: actor.tenantId, principalId: actor.principalId };
  let reversed: Awaited<ReturnType<typeof reverseReceiptFinancialConsequenceOn>>["reversed"];
  try {
    await retireReceiptPayableOn(client, financeActor, { receivingId: c.receivingId, correctionId, reason: c.reason });
    reversed = (await reverseReceiptFinancialConsequenceOn(client, financeActor, { receivingId: c.receivingId, correctionId, reason: c.reason })).reversed;
    await retireIntercompanyCorrelationForReceiptOn(client, financeActor, { receivingId: c.receivingId, correctionId, reason: c.reason });
  } catch (err) {
    if (err instanceof FinanceFoundationError) refuse(err.code, "PRECONDITION_FAILED", `the receipt's Finance consequence could not be reversed: ${err.message}`);
    throw err;
  }

  // ---- 8. THE ORDER: version moves (concurrency control only); a completing receipt that is gone returns the order to a receivable status ----
  const before = { status: String(po.rows[0].status), version: Number(po.rows[0].version) };
  const afterStatus = before.status === "RECEIVED" ? "SENT" : before.status;
  await client.query(
    `UPDATE ${SCHEMA}.supplier_purchase_orders SET version = version + 1, status = $3, updated_by = $4, updated_at = $5
      WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, purchaseOrderId, afterStatus, actor.principalId, at]);

  // ---- 9. MISSING-COST EXCEPTIONS RESOLVED (append-only rows), then the CORRECTION RECORD ----
  const resolved = await resolveReceiptCostExceptionsOn(client, financeActor, { receivingId: c.receivingId, correctionId, resolution: "RECEIPT_VOIDED", reason: c.reason });
  const { rows: inserted } = await client.query(
    `INSERT INTO ${SCHEMA}.receiving_corrections (id, tenant_id, receiving_order_id, correction_kind, replacement_receiving_order_id,
        operating_company_key, reason, idempotency_key, request_fingerprint, compensating_movement_ids, reversed_fact_ids,
        resolved_exception_ids, corrected_by, corrected_at)
     VALUES ($1,$2,$3,'VOID',NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [correctionId, actor.tenantId, c.receivingId, receipt.operating_company_key, c.reason, c.idempotencyKey,
      c.fingerprint, movementIds, reversed.map((r) => r.reversalFactId), resolved, actor.principalId, at]);

  // ---- 10. AUDIT: who, when, why, the original, the correction, and every affected record ----
  await client.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, 'inventory.receipt.correct', $3, 'receiving_order', $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [`audit_${randomUUID()}`, actor.tenantId, actor.principalId, c.receivingId, JSON.stringify({ status: receipt.status }),
      JSON.stringify(await withActorAuthority(client, actor.tenantId, actor.principalId, {
        status: "CANCELLED", receivingCorrectionId: correctionId, correctionKind: "VOID", operatingCompanyKey: receipt.operating_company_key, location: where,
        compensatingMovementIds: movementIds, reversedFacts: reversed, resolvedExceptionIds: resolved, purchaseOrderId,
        purchaseOrder: { statusBefore: before.status, statusAfter: afterStatus, versionBefore: before.version, versionAfter: before.version + 1 },
      })), at, c.reason]);

  return resultOf(inserted[0], purchaseOrderId, "applied");
}
