// RECEIPT CORRECTION (Controller FINANCE ACTIVATION 1 COMPLETION, 2026-10-01; DECISIONS #193).
//
// "WE RECORDED THE RECEIPT WRONG." Not a vendor return (that is a separate, future business workflow), and not an
// accounting-only correction: it originates in Operations and its Finance consequence follows from it.
//
// What the existing Reorder receiving data can justify, and therefore all this supports:
//
//   VOID       the receipt did not happen as recorded. The receipt takes the EXISTING `CANCELLED` status (already excluded
//              from every received-quantity derivation), the stock leaves through compensating ADJUSTED movements, every
//              live acquisition fact is reversed, open missing-cost exceptions are resolved, and the Reorder returns to
//              ORDERED so the delivery can be received correctly.
//   CORRECTED  VOID + a replacement receipt taken through the ONE governed receipt pipeline, in the same transaction; the
//              replacement's acquisition fact carries `corrects_fact_id` to the fact it replaces.
//
// What it deliberately does NOT do, because the data cannot express it on this chain:
//   * wrong quantity -- a Reorder receipt is FULL-QUANTITY by rule (legacy_partial_receipt_unsupported), so a replacement
//     receives exactly what the Purchase Order states; a physical short / over delivery is not a receipt correction.
//   * wrong Part / wrong PO line -- the Part and line come from the single-line, immutable Purchase Order.
//   * wrong company -- the company is inherited from the Purchase Order; a correction never moves ownership (no company is
//     accepted, and the replacement must land in the Reorder's own destination warehouse).
//   * wrong price -- the price is the immutable Purchase Order's; there is no governed price amendment (recorded dependency).
//   * SERIAL receipts -- custody is a current pointer per unit with no "never arrived" state; refused (recorded dependency).
//
// INVARIANTS: the original receipt, its lines, its movements, its acquisition-cost evidence and its Finance facts are never
// deleted or edited. Stock is never driven negative: the correction refuses when the received quantity is no longer at the
// receipt location (consumed, transferred, installed, relocated) -- the downstream event is corrected first.

import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import {
  ReceiveStockError,
  LEGACY_SOURCE_KIND,
  receiveReorderStockWithin,
  type ReceiveFailureCategory,
  type ReceivingPrincipalActor,
} from "./receiveReorderStockCommand.js";
import { FinanceFoundationError, resolveReceiptCostExceptionsOn, reverseReceiptFinancialConsequenceOn } from "../eosFinance/financeFoundation.js";
import { retireIntercompanyCorrelationForReceiptOn } from "../eosFinance/intercompany.js";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { InventoryScopeError, resolveScopeLocation } from "./inventoryScopeAuthority.js";
import { lockStockLocation } from "./stockLocationLock.js";
import { signedQuantity } from "../inventoryLedger/locationOnHand.js";

const SCHEMA = "eos_ops";

/** The narrowest authority for a receipt correction. Registered by migration 1764430000000; granted to nobody there. */
export const RECEIPT_CORRECT_CAPABILITY = "inventory.receipt.correct";
/** `inventory_movements.source_kind` of a compensating movement; `source_id` is the correction id. */
export const RECEIPT_CORRECTION_MOVEMENT_SOURCE_KIND = "RECEIVING_CORRECTION";
export const RECEIPT_CORRECTION_KINDS = Object.freeze(["VOID", "CORRECTED"] as const);
export type ReceiptCorrectionKind = (typeof RECEIPT_CORRECTION_KINDS)[number];

const refuse: (code: string, category: ReceiveFailureCategory, message: string) => never = (code, category, message) => {
  throw new ReceiveStockError(code, category, message);
};
const ID_SHAPE = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ReceiptCorrectionResult {
  readonly outcome: "applied" | "replayed";
  readonly correctionId: string;
  readonly receivingId: string;
  readonly correctionKind: ReceiptCorrectionKind;
  readonly replacementReceivingId: string | null;
  readonly compensatingMovementIds: readonly string[];
  readonly reversedFactIds: readonly string[];
  readonly resolvedExceptionIds: readonly string[];
}

/** Correct ONE erroneously recorded Reorder receipt. One transaction: all of it or none of it. */
export async function correctReorderReceipt(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReceivingPrincipalActor,
  input: Record<string, unknown>,
): Promise<ReceiptCorrectionResult> {
  if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
  }
  if (!actor.capabilities.has(RECEIPT_CORRECT_CAPABILITY)) {
    refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `correcting a receipt requires ${RECEIPT_CORRECT_CAPABILITY}`);
  }
  if (!isPlainObject(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input).filter((k) => !["receivingId", "correction", "reason", "idempotencyKey", "replacement"].includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  if (!ID_SHAPE(input.receivingId)) refuse("RECEIVING_ID_REQUIRED", "INVALID_INPUT", "receivingId is required");
  if (!(RECEIPT_CORRECTION_KINDS as readonly unknown[]).includes(input.correction)) {
    refuse("CORRECTION_KIND_INVALID", "INVALID_INPUT", `correction is one of ${RECEIPT_CORRECTION_KINDS.join(", ")}`);
  }
  if (typeof input.reason !== "string" || input.reason.trim() === "" || input.reason.length > 500) {
    refuse("REASON_REQUIRED", "INVALID_INPUT", "a receipt correction states why (at most 500 characters)");
  }
  if (!ID_SHAPE(input.idempotencyKey)) refuse("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", "idempotencyKey is required");
  const kind = input.correction as ReceiptCorrectionKind;
  const replacement = input.replacement;
  if (kind === "VOID" && replacement !== undefined) refuse("REPLACEMENT_NOT_ACCEPTED", "INVALID_INPUT", "a VOID has no replacement receipt");
  if (kind === "CORRECTED" && !isPlainObject(replacement)) {
    refuse("REPLACEMENT_REQUIRED", "INVALID_INPUT", "a CORRECTED receipt states its replacement (receivingLocation, lines)");
  }
  if (kind === "CORRECTED") {
    const bad = Object.keys(replacement as Record<string, unknown>).filter((k) => !["receivingLocation", "lines"].includes(k));
    if (bad.length > 0) refuse("REPLACEMENT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `a replacement does not accept: ${bad.sort().join(", ")}`);
  }
  const receivingId = input.receivingId as string;
  const reason = (input.reason as string).trim();
  const idempotencyKey = input.idempotencyKey as string;
  const fingerprint = createHash("sha256").update(JSON.stringify([receivingId, kind, reason, replacement ?? null])).digest("hex");

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await correctWithin(client, deps, actor, { receivingId, kind, reason, idempotencyKey, fingerprint,
      replacement: (replacement as Record<string, unknown> | undefined) ?? null });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const resultOf = (row: Record<string, unknown>, outcome: "applied" | "replayed"): ReceiptCorrectionResult => Object.freeze({
  outcome, correctionId: String(row.id), receivingId: String(row.receiving_order_id), correctionKind: row.correction_kind as ReceiptCorrectionKind,
  replacementReceivingId: (row.replacement_receiving_order_id as string | null) ?? null,
  compensatingMovementIds: Object.freeze([...(row.compensating_movement_ids as string[])]),
  reversedFactIds: Object.freeze([...(row.reversed_fact_ids as string[])]),
  resolvedExceptionIds: Object.freeze([...(row.resolved_exception_ids as string[])]),
});

async function correctWithin(
  client: PoolClient,
  deps: { readonly now?: () => Date },
  actor: ReceivingPrincipalActor,
  c: { receivingId: string; kind: ReceiptCorrectionKind; reason: string; idempotencyKey: string; fingerprint: string;
    replacement: Record<string, unknown> | null },
): Promise<ReceiptCorrectionResult> {
  // ---- 1. REPLAY: the same key + the same request returns the recorded correction and writes nothing ----
  const prior = await client.query(`SELECT * FROM ${SCHEMA}.receiving_corrections WHERE tenant_id = $1 AND idempotency_key = $2`,
    [actor.tenantId, c.idempotencyKey]);
  if (prior.rows[0]) {
    if (prior.rows[0].request_fingerprint !== c.fingerprint) {
      refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotency key already recorded a DIFFERENT receipt correction");
    }
    return resultOf(prior.rows[0], "replayed");
  }

  // ---- 2. THE RECEIPT, and the SERIALIZATION ANCHOR the receipt itself takes (its Reorder), locked first ----
  const { rows: peek } = await client.query(
    `SELECT source_kind::text AS source_kind, source_reorder_request_id FROM ${SCHEMA}.receiving_orders WHERE tenant_id = $1 AND id = $2`,
    [actor.tenantId, c.receivingId]);
  if (!peek[0]) refuse("RECEIPT_NOT_FOUND", "NOT_FOUND", "no receipt with that id in this tenant");
  if (peek[0].source_kind !== LEGACY_SOURCE_KIND) {
    refuse("RECEIPT_SOURCE_NOT_OWNED", "PRECONDITION_FAILED", `this authority corrects ${LEGACY_SOURCE_KIND} receipts only`);
  }
  const reorderId = String(peek[0].source_reorder_request_id);
  const { rows: rr } = await client.query(
    `SELECT status::text AS status FROM ${SCHEMA}.reorder_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, reorderId]);
  const { rows: rcv } = await client.query(
    `SELECT id, operating_company_key, source_purchase_order_id, receiving_location_type::text AS location_type, receiving_location_id,
            status::text AS status
       FROM ${SCHEMA}.receiving_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, c.receivingId]);
  const receipt = rcv[0];
  if (receipt.status === "CANCELLED") {
    const { rows: done } = await client.query(`SELECT 1 FROM ${SCHEMA}.receiving_corrections WHERE tenant_id = $1 AND receiving_order_id = $2`,
      [actor.tenantId, c.receivingId]);
    refuse(done[0] ? "RECEIPT_ALREADY_CORRECTED" : "RECEIPT_CANCELLED", "PRECONDITION_FAILED", "this receipt is already cancelled; nothing to correct");
  }
  if (rr[0]?.status !== "RECEIVED") {
    refuse("REORDER_STATE_INVALID", "PRECONDITION_FAILED", `the receipt's Reorder is ${rr[0]?.status ?? "missing"}, not RECEIVED`);
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

  // ---- 7. THE FINANCE CONSEQUENCE: every live acquisition fact reversed (never edited) ----
  const financeActor = { tenantId: actor.tenantId, principalId: actor.principalId };
  let reversed: Awaited<ReturnType<typeof reverseReceiptFinancialConsequenceOn>>["reversed"];
  try {
    reversed = (await reverseReceiptFinancialConsequenceOn(client, financeActor, { receivingId: c.receivingId, correctionId, reason: c.reason })).reversed;
    // The corrected receipt's intercompany correlation (#202) is retired with it (an established pair voided on both sides).
    await retireIntercompanyCorrelationForReceiptOn(client, financeActor, { receivingId: c.receivingId, correctionId, reason: c.reason });
  } catch (err) {
    if (err instanceof FinanceFoundationError) refuse(err.code, "PRECONDITION_FAILED", `the receipt's Finance consequence could not be reversed: ${err.message}`);
    throw err;
  }

  // ---- 8. THE REORDER RETURNS TO ORDERED: the delivery is still owed a correct receipt ----
  const reopened = await client.query(
    `UPDATE ${SCHEMA}.reorder_requests SET status = 'ORDERED', received_at = NULL, received_by_principal_id = NULL, updated_by = $3, updated_at = $4
      WHERE tenant_id = $1 AND id = $2 AND status = 'RECEIVED'`, [actor.tenantId, reorderId, actor.principalId, at]);
  if (reopened.rowCount !== 1) refuse("REORDER_STATE_INVALID", "PRECONDITION_FAILED", "the receipt's Reorder was no longer RECEIVED");
  await audit(client, actor, "reorder.request.reopenForReceiptCorrection", "reorder_request", reorderId,
    { status: "RECEIVED" }, { status: "ORDERED", receivingCorrectionId: correctionId, correctedReceivingId: c.receivingId }, at, c.reason);

  // ---- 9. CORRECTED: the replacement receipt, through the ONE receipt pipeline, linked to the facts it replaces ----
  let replacementReceivingId: string | null = null;
  if (c.kind === "CORRECTED") {
    const rep = c.replacement as Record<string, unknown>;
    const replaced = await receiveReorderStockWithin(client, deps, actor, {
      source: { type: LEGACY_SOURCE_KIND, reorderRequestId: reorderId, purchaseOrderId: String(receipt.source_purchase_order_id) },
      receivingLocation: rep.receivingLocation ?? { type: where.type, locationId: where.locationId },
      lines: rep.lines ?? lines.map((l) => ({ lineId: l.line_id, partId: l.part_id, receivedQuantity: Number(l.received_quantity) })),
      idempotencyKey: `${c.idempotencyKey}:replacement`,
    }, { financeCorrection: { correctsFactIdByLine: new Map(reversed.map((r) => [r.lineId, r.factId])), reason: c.reason } });
    if (replaced.outcome !== "applied") refuse("REPLACEMENT_KEY_IN_USE", "CONFLICT", "the replacement receipt's identity is already in use");
    replacementReceivingId = replaced.receivingId;
  }

  // ---- 10. MISSING-COST EXCEPTIONS RESOLVED (append-only rows; the exceptions are never edited), then the CORRECTION RECORD ----
  const resolved = await resolveReceiptCostExceptionsOn(client, financeActor, { receivingId: c.receivingId, correctionId,
    resolution: c.kind === "VOID" ? "RECEIPT_VOIDED" : "RECEIPT_CORRECTED", reason: c.reason });
  const { rows: inserted } = await client.query(
    `INSERT INTO ${SCHEMA}.receiving_corrections (id, tenant_id, receiving_order_id, correction_kind, replacement_receiving_order_id,
        operating_company_key, reason, idempotency_key, request_fingerprint, compensating_movement_ids, reversed_fact_ids,
        resolved_exception_ids, corrected_by, corrected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [correctionId, actor.tenantId, c.receivingId, c.kind, replacementReceivingId, receipt.operating_company_key, c.reason, c.idempotencyKey,
      c.fingerprint, movementIds, reversed.map((r) => r.reversalFactId), resolved, actor.principalId, at]);

  // ---- 11. AUDIT: who, when, why, the original, the correction, and every affected record ----
  await audit(client, actor, "inventory.receipt.correct", "receiving_order", c.receivingId, { status: receipt.status }, {
    status: "CANCELLED", receivingCorrectionId: correctionId, correctionKind: c.kind, replacementReceivingId,
    operatingCompanyKey: receipt.operating_company_key, location: where, compensatingMovementIds: movementIds,
    reversedFacts: reversed, resolvedExceptionIds: resolved, reorderRequestId: reorderId,
  }, at, c.reason);

  return resultOf(inserted[0], "applied");
}

async function audit(client: PoolClient, actor: ReceivingPrincipalActor, action: string, targetKind: string, targetId: string,
  before: unknown, after: unknown, at: Date, reason: string): Promise<void> {
  await client.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, targetKind, targetId, JSON.stringify(before), JSON.stringify(after), at, reason]);
}
