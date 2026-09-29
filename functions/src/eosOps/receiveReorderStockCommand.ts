// THE GOVERNED POSTGRESQL RECEIVING AUTHORITY -- Reorder Receiving Owner Rulings R1/R2/R3.
//
// Receiving stock against a REORDER PURCHASE ORDER, in ONE PostgreSQL transaction that commits the
// whole business closure or none of it:
//
//   Receiving Order + lines
//   -> RECEIVED inventory movement(s)
//   -> serialized custody, when the part is SERIAL
//   -> acquisition-cost evidence, when the purchase order carries a governed price
//   -> Reorder ORDERED -> RECEIVED
//   -> audit
//
// ════════════════════ SCOPE: ONE SOURCE AUTHORITY, NO FALLBACK ════════════════════
//
// REORDER_PURCHASE_ORDER ONLY (Ruling R1). The canonical multi-line PURCHASE_ORDER is a separate
// business authority with its own Firebase-exit slice, and this command REFUSES it rather than
// half-answering it. It never tries one authority and falls back to the other: the request states
// its source type, and a type this command does not own is a refusal, not a redirect.
//
// ════════════════════ WHO MAY RECEIVE, AND WHAT THAT CLOSES ════════════════════
//
// `inventory.stock.receive` and nothing else (Ruling R2). The Reorder's ORDERED -> RECEIVED
// transition is a CONSEQUENCE of a governed receipt, not a second human authorization: the person
// who receives the goods is the person whose receipt closes the order. It deliberately does NOT
// additionally require `reorder.request.markReceived`, and it is deliberately NOT restricted to the
// Employee the purchasing work is assigned to.
//
//   ACTOR    = the EOS Principal performing Receiving.
//   ASSIGNEE = the Employee the Reorder is assigned to for purchasing work.
//
// They are different concepts about different people and are never conflated here.
//
// ════════════════════ ONE VALIDATION PATH, NOT A SECOND ONE ════════════════════
//
// The rules about what a receipt may contain -- over-receipt measured against REMAINING, the legacy
// full-quantity constraint, serial cardinality and uniqueness, LOT still refused, the caller's
// expectedQuantity claim checked rather than trusted -- are NOT restated here. They live in
// `inventoryReceiving/receivingBatchValidation.ts`, a pure module with no Firebase dependency, and
// this command calls it. Restating them would create a second definition of "is this receipt
// allowed", and the two would eventually disagree about a receipt that moves real stock.
//
// The same applies to receipt identity (`receivingIdentity.ts`), purchase-order normalization and
// receipt-state derivation (`purchasing/purchaseOrderNormalization.ts`), the movement sign
// (`inventoryLedger/locationOnHand.ts`) and the cost semantics (`finance/acquisitionCost.ts`).
//
// ════════════════════ THE SERIALIZATION ANCHOR ════════════════════
//
// Firestore serialized concurrent receipts on the purchase order document. PostgreSQL serializes
// them on `SELECT ... FOR UPDATE` over the Reorder Request row: two receipts for one Reorder queue,
// and the second sees the first's committed status. The row is locked BEFORE the replay probe and
// held to COMMIT.
//
// ════════════════════ REPLAY IS DECIDED BEFORE THE STATUS GATE ════════════════════
//
// Deliberate, and it mirrors the Firestore command's step order exactly. A committed receipt has
// already moved its Reorder to RECEIVED, so asserting ORDERED first would make every genuine retry
// fail instead of replaying. The receipt is therefore looked up first; only a receipt that does NOT
// already exist is held to the ORDERED gate.
//
// A replay writes NOTHING: no receipt, no movement, no custody, no cost fact, no transition, no
// audit event and no reference number.

import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  normalizeLegacyPurchaseOrder,
  deriveReceiptState,
  PurchaseOrderNormalizationError,
  LEGACY_LINE_ID,
  type CanonicalPurchaseOrder,
  type DerivedPurchaseOrder,
  type CommittedReceipt,
} from "../purchasing/purchaseOrderNormalization.js";
import { validateReceivingBatch, type ResolvedPartAuthority } from "../inventoryReceiving/receivingBatchValidation.js";
import type { ResolvedReceivingSource } from "../inventoryReceiving/receivingSourceResolver.js";
import {
  fingerprintReceivingOrder,
  receivingOrderDocId,
  receiptLineMovementIdempotencyKey,
  receiptSerialMovementIdempotencyKey,
} from "../inventoryReceiving/receivingIdentity.js";
import { signedQuantity } from "../inventoryLedger/locationOnHand.js";
import { allocateReceivingOrderNumber } from "./receivingNumbering.js";
import { planAcquisitionCost, insertAcquisitionCostFact } from "./acquisitionCostAuthority.js";
import { closeOutReorderAsReceived } from "./reorderLifecycleCommands.js";
import { resolveOpsLocation, LocationAuthorityError } from "./warehouseBinRepository.js";
import { readMobileLocation } from "./truckFleetRepository.js";
import { insertReceivingOrder, type OpsTrackingMode } from "./purchasingRepository.js";
import type { OpsLocationType } from "./operatingCompanyCustody.js";

// Named SCHEMA, matching every other eos_ops repository -- and matching the form the Reorder
// runtime census recognizes as a SCHEMA-QUALIFIED PostgreSQL name. An unrecognized qualifier
// would make every table reference here look like an unqualified Firestore collection, and this
// command would be counted as a legacy consumer blocking the very activation it enables.
const SCHEMA = "eos_ops";

/** The ONE capability a receipt requires. */
export const RECEIVE_STOCK_CAPABILITY = "inventory.stock.receive";
/** The only source authority this command owns. */
export const LEGACY_SOURCE_KIND = "REORDER_PURCHASE_ORDER";
/** `inventory_movements.source_kind` for a receipt-driven movement. Existing vocabulary, not new. */
export const RECEIPT_MOVEMENT_SOURCE_KIND = "RECEIVING_ORDER";
/** A receipt that has been put away. The only status this command writes. */
export const RECEIPT_STATUS = "PUTAWAY_COMPLETE";
/** The only Reorder status a receipt may be taken against. */
export const RECEIVABLE_REORDER_STATUS = "ORDERED";
const RECEIVED = "RECEIVED";

export type ReceiveFailureCategory =
  | "INVALID_INPUT" | "FORBIDDEN" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT";

export class ReceiveStockError extends Error {
  constructor(
    readonly code: string,
    readonly category: ReceiveFailureCategory,
    message: string,
  ) {
    super(message);
    this.name = "ReceiveStockError";
  }
}
// Explicitly TYPED as returning `never`, not merely annotated on the arrow. TypeScript only treats
// a call as ending control flow when the CONST carries the never-returning signature, and this
// command relies on that: every refusal below is written as a bare statement, and without it the
// compiler would keep widening validated values to include the rejected shape.
const refuse: (code: string, category: ReceiveFailureCategory, message: string) => never =
  (code, category, message) => {
    throw new ReceiveStockError(code, category, message);
  };

/** The trusted actor context, resolved by the transport. NEVER read from the request payload. */
export interface ReceivingPrincipalActor {
  readonly tenantId: string;
  /** The EOS Principal id. The ACTOR -- never the assignee, never a Firebase uid. */
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

export interface ReceiveLineResult {
  readonly lineId: string;
  readonly partId: string;
  readonly orderedQuantity: number;
  readonly previouslyReceived: number;
  readonly receivedNow: number;
  readonly remainingQuantity: number;
  readonly state: string;
}

export interface ReceiveReorderStockResult {
  readonly outcome: "applied" | "replayed";
  readonly receivingId: string;
  readonly receivingOrderNumber: string | null;
  readonly sourceKind: typeof LEGACY_SOURCE_KIND;
  readonly purchaseOrderId: string;
  readonly reorderRequestId: string;
  /** The receipt's governed business event time, ISO-8601. A replay returns the ORIGINAL. */
  readonly receivedAt: string;
  readonly movementIds: readonly string[];
  readonly serializedCustodyIds: readonly string[];
  readonly acquisitionCostIds: readonly string[];
  readonly lines: readonly ReceiveLineResult[];
  readonly derivedState: string;
  readonly reorderStatus: string;
}

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

const ALLOWED_TOP_KEYS = ["source", "receivingLocation", "lines", "idempotencyKey", "expectedVersion"];

function requireActor(actor: ReceivingPrincipalActor): void {
  if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
  }
  if (!actor.capabilities.has(RECEIVE_STOCK_CAPABILITY)) {
    refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `receiving stock requires ${RECEIVE_STOCK_CAPABILITY}`);
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * SHAPE CHECK ONLY, before a connection is taken.
 *
 * It asserts that a source authority was NAMED and that the name is one this command owns. Nothing
 * else about the source is decided here: existence, coherence and receivability all need reads.
 */
function requireOwnedSource(input: unknown): { readonly reorderRequestId: string; readonly purchaseOrderId: string } {
  if (!isPlainObject(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input as Record<string, unknown>).filter((k) => !ALLOWED_TOP_KEYS.includes(k));
  if (extra.length > 0) {
    refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  }
  const source = (input as Record<string, unknown>).source;
  if (!isPlainObject(source)) refuse("SOURCE_REQUIRED", "INVALID_INPUT", "source is required");
  const src = source as Record<string, unknown>;
  if (src.type !== LEGACY_SOURCE_KIND) {
    // NO FALLBACK. A canonical PURCHASE_ORDER receipt is refused here and is NOT redirected: that
    // authority has its own cutover, and guessing between two purchasing authorities would let a
    // receipt land against stock the caller never addressed.
    refuse(
      "SOURCE_TYPE_NOT_OWNED", "INVALID_INPUT",
      `this authority receives ${LEGACY_SOURCE_KIND} only; the canonical PURCHASE_ORDER authority is a separate business slice`,
    );
  }
  if (!ID_SHAPE(src.reorderRequestId)) {
    refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "source.reorderRequestId is required");
  }
  if (!ID_SHAPE(src.purchaseOrderId)) {
    refuse("PURCHASE_ORDER_ID_REQUIRED", "INVALID_INPUT", "source.purchaseOrderId is required");
  }
  // THE LEGACY CHAIN'S IDENTITY EQUATION, checked before anything is read so the caller learns which
  // rule it broke rather than meeting a constraint name.
  if (src.reorderRequestId !== src.purchaseOrderId) {
    refuse(
      "SOURCE_IDENTITY_MISMATCH", "INVALID_INPUT",
      "a Reorder Purchase Order IS its Reorder Request: source.reorderRequestId and source.purchaseOrderId must be equal",
    );
  }
  return { reorderRequestId: src.reorderRequestId as string, purchaseOrderId: src.purchaseOrderId as string };
}

interface LockedReorder {
  readonly id: string;
  readonly status: string;
  readonly operatingCompanyKey: string;
}

async function lockReorder(client: PoolClient, tenantId: string, id: string): Promise<LockedReorder> {
  const { rows } = await client.query(
    `SELECT id, status::text AS status, operating_company_key
       FROM ${SCHEMA}.reorder_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, id],
  );
  if (rows.length === 0) refuse("REORDER_NOT_FOUND", "NOT_FOUND", `no Reorder Request ${id} in this tenant`);
  return { id: rows[0].id, status: rows[0].status, operatingCompanyKey: rows[0].operating_company_key };
}

interface LegacyPurchaseOrderRow {
  readonly partId: string;
  readonly orderedQuantity: number;
  readonly supplierName: string;
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
  readonly priceAuthorityVersion: number | null;
  readonly operatingCompanyKey: string;
}

async function readPurchaseOrder(client: PoolClient, tenantId: string, id: string): Promise<LegacyPurchaseOrderRow> {
  const { rows } = await client.query(
    `SELECT part_id, ordered_quantity, supplier_name, unit_price_minor, currency,
            price_authority_version, operating_company_key
       FROM ${SCHEMA}.purchase_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  if (rows.length === 0) {
    refuse("PURCHASE_ORDER_NOT_FOUND", "NOT_FOUND", `no Reorder Purchase Order ${id} in this tenant`);
  }
  const r = rows[0];
  return {
    partId: r.part_id as string,
    orderedQuantity: r.ordered_quantity as number,
    supplierName: r.supplier_name as string,
    // BIGINT arrives as a string from node-postgres; money is converted once, here, and every later
    // reader sees a number the price authority has already validated as an exact integer.
    unitPriceMinor: r.unit_price_minor === null ? null : Number(r.unit_price_minor),
    currency: r.currency as string | null,
    priceAuthorityVersion: r.price_authority_version as number | null,
    operatingCompanyKey: r.operating_company_key as string,
  };
}

/**
 * Every COMMITTED receipt against this source, EXCEPT the one this request is.
 *
 * The exclusion is what makes a replay validate. Quantity rules measure against what REMAINS, so a
 * retry of a committed receipt would otherwise be refused as an over-receipt by the very receipt it
 * is retrying -- the idempotency mechanism defeated by its own success. Excluding this receipt
 * derives exactly the state the ORIGINAL request was validated against, so the retry reaches the
 * same decision the original did and is then answered from the stored receipt.
 *
 * It changes NOTHING for a new receipt: a receipt that does not exist excludes nothing, and every
 * other receipt against this purchase order is still counted in full.
 *
 * CANCELLED receipts are excluded for the separate, older reason: a cancelled receipt is a receipt
 * that did not happen, and summing it would report stock as arrived that nothing put away.
 */
async function readCommittedReceipts(
  client: PoolClient, tenantId: string, purchaseOrderId: string, exceptReceivingId: string,
): Promise<CommittedReceipt[]> {
  const { rows } = await client.query(
    `SELECT o.id AS receiving_id, l.line_id, l.received_quantity, l.serial_numbers
       FROM ${SCHEMA}.receiving_orders o
       JOIN ${SCHEMA}.receiving_order_lines l
         ON l.receiving_order_id = o.id AND l.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1 AND o.source_kind = $2 AND o.source_purchase_order_id = $3
        AND o.status <> 'CANCELLED' AND o.id <> $4
      ORDER BY o.id, l.line_id`,
    [tenantId, LEGACY_SOURCE_KIND, purchaseOrderId, exceptReceivingId],
  );
  const byReceipt = new Map<string, { receivingId: string; lines: Array<{ lineId: string; receivedQuantity: number; serialNumbers?: string[] }> }>();
  for (const r of rows) {
    const id = r.receiving_id as string;
    const entry = byReceipt.get(id) ?? { receivingId: id, lines: [] };
    entry.lines.push({
      lineId: r.line_id as string,
      receivedQuantity: r.received_quantity as number,
      ...(Array.isArray(r.serial_numbers) && r.serial_numbers.length > 0 ? { serialNumbers: r.serial_numbers as string[] } : {}),
    });
    byReceipt.set(id, entry);
  }
  return [...byReceipt.values()];
}

/** The Part authority, as receiving needs it: identity, activity and tracking mode. */
async function resolvePart(client: PoolClient, tenantId: string, partId: string): Promise<ResolvedPartAuthority> {
  const { rows } = await client.query(
    `SELECT id, status::text AS status, control_type::text AS control_type
       FROM ${SCHEMA}.parts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, partId],
  );
  if (rows.length === 0) refuse("PART_NOT_FOUND", "NOT_FOUND", "the purchase order names a Part this tenant does not hold");
  const r = rows[0];
  return {
    partId: r.id as string,
    // The catalog's CONTROL TYPE, mapped to receiving's TRACKING MODE. LOT and SERIALIZED_LOT map to
    // neither supported mode on purpose: they pass through as themselves and the shared validator
    // refuses them with `tracking_mode_unsupported`, exactly as the Firestore authority does. Mapping
    // them onto NONE would receive a lot-controlled part as if lots did not exist.
    trackingMode: r.control_type === "SERIALIZED" ? "SERIAL" : r.control_type === "STANDARD" ? "NONE" : (r.control_type as string),
    active: r.status === "ACTIVE",
  };
}

/**
 * The destination must be a GOVERNED, ACTIVE location of this tenant.
 *
 * THROUGH THE EXISTING LOCATION AUTHORITIES, never a table name assembled here. `resolveOpsLocation`
 * owns WAREHOUSE and BIN (including a BIN's roll-up to its parent warehouse), and the Truck/Mobile
 * registry owns MOBILE. Both were widened to accept this transaction's client, so the destination is
 * validated inside the transaction that writes the receipt and cannot be deactivated between the
 * check and the commit.
 *
 * Re-deriving the lookup here would have put bare `warehouses`/`bins` strings in an eos_ops module --
 * which the no-Firestore guard reads as an unqualified collection name, correctly: a schema-less
 * table name assembled from a caller-supplied discriminator is exactly the shape that guard exists
 * to refuse.
 */
async function requireActiveLocation(
  client: PoolClient, tenantId: string, location: { type: string; locationId: string },
): Promise<void> {
  if (location.type === "MOBILE") {
    const mobile = await readMobileLocation(client, tenantId, location.locationId);
    if (mobile === null || mobile.active !== true) {
      refuse("DESTINATION_INVALID", "PRECONDITION_FAILED",
        "the destination is not an ACTIVE governed mobile location of this tenant");
    }
    return;
  }
  if (location.type !== "WAREHOUSE" && location.type !== "BIN") {
    refuse("DESTINATION_INVALID", "INVALID_INPUT", "receivingLocation.type must be WAREHOUSE, BIN or MOBILE");
  }
  let resolved;
  try {
    resolved = await resolveOpsLocation(client, tenantId, { type: location.type, locationId: location.locationId });
  } catch (err) {
    if (err instanceof LocationAuthorityError) {
      refuse("DESTINATION_INVALID", "PRECONDITION_FAILED", `the destination is not a governed location: ${err.code}`);
    }
    throw err;
  }
  if (resolved.status !== "ACTIVE") {
    refuse("DESTINATION_INVALID", "PRECONDITION_FAILED", "the destination is not an ACTIVE governed location of this tenant");
  }
}

async function audit(
  client: PoolClient, tenantId: string, actorPrincipalId: string, targetId: string,
  after: unknown, at: Date, reason: string,
): Promise<void> {
  await client.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, 'inventory.stock.receive', $3, 'receiving_order', $4, NULL, $5::jsonb, $6, $7)`,
    [`audit_${randomUUID()}`, tenantId, actorPrincipalId, targetId, JSON.stringify(after), at, reason],
  );
}

/** Per-line progress, derived. Computed identically for the apply and replay paths. */
function perLineResults(
  derived: DerivedPurchaseOrder,
  receivedNowByPoLineId: ReadonlyMap<string, number>,
  alreadyCounted: boolean,
): ReceiveLineResult[] {
  return derived.lines.map((l) => {
    const receivedNow = receivedNowByPoLineId.get(l.lineId) ?? 0;
    // `alreadyCounted` subtracts this receipt back out where the derivation included it. This
    // command's derivation excludes it on BOTH paths, so both pass false and the replayed answer is
    // equal to the original by construction rather than by compensating arithmetic. The parameter is
    // kept because the derivation is an input to this function, not a fact it can assume.
    const previouslyReceived = alreadyCounted ? l.receivedQuantity - receivedNow : l.receivedQuantity;
    const remainingAfter = Math.max(0, l.orderedQuantity - previouslyReceived - receivedNow);
    return {
      lineId: l.lineId,
      partId: l.partId,
      orderedQuantity: l.orderedQuantity,
      previouslyReceived,
      receivedNow,
      remainingQuantity: remainingAfter,
      state: remainingAfter === 0 ? RECEIVED : previouslyReceived + receivedNow === 0 ? "NOT_RECEIVED" : "PARTIALLY_RECEIVED",
    };
  });
}

/**
 * Receive stock against a Reorder Purchase Order. ONE transaction, all of it or none of it.
 */
export async function receiveReorderStock(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReceivingPrincipalActor,
  input: Record<string, unknown>,
): Promise<ReceiveReorderStockResult> {
  requireActor(actor);
  const source = requireOwnedSource(input);

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");

    // ---- 1. THE SERIALIZATION ANCHOR. Locked first, held to COMMIT, asserted later. ----
    const reorder = await lockReorder(client, actor.tenantId, source.reorderRequestId);

    // ---- 2. THE SOURCE AUTHORITY ----
    const poRow = await readPurchaseOrder(client, actor.tenantId, source.purchaseOrderId);

    let canonical: CanonicalPurchaseOrder;
    try {
      canonical = normalizeLegacyPurchaseOrder(source.purchaseOrderId, {
        partId: poRow.partId,
        orderedQuantity: poRow.orderedQuantity,
        supplierName: poRow.supplierName,
        unitPriceMinor: poRow.unitPriceMinor ?? undefined,
        currency: poRow.currency ?? undefined,
        priceAuthorityVersion: poRow.priceAuthorityVersion ?? undefined,
        // DELIBERATELY NULL. A PostgreSQL purchase order carries an operational company KEY, and the
        // key is not the company id (Ruling R3). Passing the key here would be exactly the string
        // equality assumption the ruling forbids; the id is resolved from the governed binding, in
        // this transaction, where the cost fact needs it.
        operatingCompanyId: null,
        status: RECEIVABLE_REORDER_STATUS,
      });
    } catch (err) {
      if (err instanceof PurchaseOrderNormalizationError) {
        refuse(err.code, "PRECONDITION_FAILED", `the purchase order cannot be received: ${err.message}`);
      }
      throw err;
    }

    // ---- 3. RECEIPT IDENTITY, in the LEGACY namespace, derived BEFORE anything is measured ----
    //
    // Derived from the caller's idempotency key ALONE, which is the legacy contract proven in
    // `receivingIdentity.ts`. It is deliberately NOT promoted to the canonical target-scoped
    // derivation: deployed callers hold receipts at these ids, and a receipt whose id changed would
    // be re-applied by its own retry.
    //
    // Derived HERE, before the quantities are derived, because the identity is what tells the
    // derivation which committed receipt to leave out. Only the key's SHAPE is checked here; the
    // shared validator owns the rest of its contract.
    const rawKey = (input as Record<string, unknown>).idempotencyKey;
    if (typeof rawKey !== "string" || rawKey.trim() === "") {
      refuse("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", "idempotencyKey is required");
    }
    const receivingId = receivingOrderDocId(rawKey);

    const committed = await readCommittedReceipts(client, actor.tenantId, source.purchaseOrderId, receivingId);
    const derived = deriveReceiptState(canonical, committed);

    // The shared validator's source contract. `poRef` belongs to the Firestore transport and is
    // never read by the validator, so it is not fabricated here.
    const resolved = {
      sourceType: LEGACY_SOURCE_KIND,
      purchaseOrderId: source.purchaseOrderId,
      reorderRequestId: source.reorderRequestId,
      canonical,
      derived,
      storedStatus: reorder.status,
      version: 0,
      isCanonical: false,
    } as unknown as ResolvedReceivingSource;

    // ---- 4. THE PART AUTHORITY, once per distinct part on the order's own lines ----
    const partsByPartId = new Map<string, ResolvedPartAuthority>();
    for (const partId of new Set(derived.lines.map((l) => l.partId))) {
      partsByPartId.set(partId, await resolvePart(client, actor.tenantId, partId));
    }

    // ---- 5. THE DESTINATION ----
    const loc = (input as Record<string, unknown>).receivingLocation;
    if (!isPlainObject(loc) || typeof loc.type !== "string" || !ID_SHAPE(loc.locationId)) {
      refuse("DESTINATION_INVALID", "INVALID_INPUT", "receivingLocation must name a type and a locationId");
    }
    const locationRef = { type: (loc as Record<string, unknown>).type as string, locationId: (loc as Record<string, unknown>).locationId as string };
    await requireActiveLocation(client, actor.tenantId, locationRef);

    // ---- 6. VALIDATE THE WHOLE BATCH, before any write ----
    const validated = validateReceivingBatch(input, { resolved, partsByPartId });
    if (!validated.valid) {
      const category: ReceiveFailureCategory =
        validated.reason === "over_receipt" || validated.reason === "line_already_satisfied"
          || validated.reason === "legacy_partial_receipt_unsupported" || validated.reason === "part_inactive"
          || validated.reason === "tracking_mode_unsupported" || validated.reason === "expected_quantity_mismatch"
          ? "PRECONDITION_FAILED"
          : "INVALID_INPUT";
      refuse(`RECEIPT_${validated.reason.toUpperCase()}`, category, `receiving input invalid: ${validated.reason}`);
    }
    const value = validated.value;

    // ---- 7. THE REQUEST FINGERPRINT ----
    //
    // Over the VALIDATED value, which is what decides replay from conflict: the same key carrying
    // the same request replays, the same key carrying a different one is refused.
    const fingerprint = fingerprintReceivingOrder(value);

    const existing = await client.query(
      `SELECT id, receiving_order_number, received_at, request_fingerprint
         FROM ${SCHEMA}.receiving_orders WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, receivingId],
    );

    // ---- 8. REPLAY, decided BEFORE the status gate and writing nothing ----
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.request_fingerprint === null) {
        // A receipt recorded before the fingerprint column existed cannot prove payload equality.
        // Fail closed: returning it would claim this request produced that receipt.
        refuse(
          "RECEIPT_FINGERPRINT_UNKNOWN", "CONFLICT",
          "this idempotency key resolves to a receipt recorded without a request fingerprint, so a replay cannot be proved",
        );
      }
      if (row.request_fingerprint !== fingerprint) {
        refuse(
          "IDEMPOTENCY_CONFLICT", "CONFLICT",
          "this idempotency key was already used for a DIFFERENT receipt",
        );
      }
      // FALSE on both paths, deliberately: the derivation above already excluded THIS receipt, so
      // the replayed answer is computed from exactly the same inputs the original was.
      const receivedNowByPoLineId = new Map<string, number>([[derived.lines[0].lineId, value.lines[0].receivedQuantity]]);
      const lines = perLineResults(derived, receivedNowByPoLineId, false);
      await client.query("COMMIT");
      return {
        outcome: "replayed",
        receivingId,
        receivingOrderNumber: row.receiving_order_number as string | null,
        sourceKind: LEGACY_SOURCE_KIND,
        purchaseOrderId: source.purchaseOrderId,
        reorderRequestId: source.reorderRequestId,
        receivedAt: (row.received_at as Date).toISOString(),
        movementIds: [],
        serializedCustodyIds: [],
        acquisitionCostIds: [],
        lines,
        derivedState: lines.every((l) => l.remainingQuantity === 0)
          ? RECEIVED
          : lines.every((l) => l.previouslyReceived + l.receivedNow === 0) ? "NOT_RECEIVED" : "PARTIALLY_RECEIVED",
        reorderStatus: reorder.status,
      };
    }

    // ---- 9. THE STATUS GATE. Only a NEW receipt is held to it. ----
    if (reorder.status !== RECEIVABLE_REORDER_STATUS) {
      refuse(
        "STATUS_NOT_RECEIVABLE", "PRECONDITION_FAILED",
        `a Reorder Request in ${reorder.status} has not been ordered, so nothing can be received against it`,
      );
    }

    // ---- 10. THE RECEIPT'S BUSINESS TIME, established ONCE ----
    const receivedAt = deps.now?.() ?? new Date();

    // ---- 11. THE REFERENCE NUMBER, allocated ONLY on the genuine apply path ----
    //
    // Inside this transaction, so a rolled-back receipt consumes no number it did not keep. The
    // replay path returned above without reaching here, which is what makes "allocate nothing on
    // replay" true by control flow rather than by a check.
    const receivingOrderNumber = await allocateReceivingOrderNumber(
      client, actor.tenantId, receivedAt.getUTCFullYear(),
    );

    // ---- 12. THE RECEIPT ----
    //
    // Through the ONE receipt writer. `insertReceivingOrder` is client-scoped precisely so it can be
    // called from inside this transaction: the receipt is only one of the effects committed here,
    // and a writer that owned its own transaction could commit it while the inventory movement
    // rolled back.
    await insertReceivingOrder(client, actor.tenantId, actor.principalId, poRow.operatingCompanyKey, {
      id: receivingId,
      sourceKind: LEGACY_SOURCE_KIND,
      purchaseOrderId: source.purchaseOrderId,
      reorderRequestId: source.reorderRequestId,
      receivingLocation: { type: locationRef.type as OpsLocationType, id: locationRef.locationId },
      status: RECEIPT_STATUS,
      receivingOrderNumber,
      idempotencyKey: value.idempotencyKey,
      requestFingerprint: fingerprint,
      receivedAt,
      lines: value.lines.map((l) => ({
        lineId: l.lineId,
        partId: l.partId,
        trackingMode: l.trackingMode as OpsTrackingMode,
        expectedQuantity: l.expectedQuantity,
        receivedQuantity: l.receivedQuantity,
        ...(l.serialNumbers === undefined ? {} : { serialNumbers: l.serialNumbers }),
      })),
    });

    const movementIds: string[] = [];
    const serializedCustodyIds: string[] = [];
    const acquisitionCostIds: string[] = [];

    for (const line of value.lines) {
      // ---- 13. THE RECEIVED INVENTORY EFFECT ----
      //
      // eos_ops.inventory_movements remains THE quantity-mutating authority; this stages the shape it
      // already defines and introduces no second ledger and no new movement type.
      //
      // SERIAL: one movement PER UNIT, each carrying its serial and a delta of exactly 1 -- not a
      // choice made here, but what `movement_serial_matches_tracking` requires.
      // NONE: one movement carrying the line's quantity, signed through the ONE sign authority.
      const isSerial = line.trackingMode === "SERIAL";
      const units = isSerial
        ? (line.serialNumbers ?? []).map((serialNo) => ({
            serialNo,
            delta: signedQuantity({ type: RECEIVED, quantity: 1 }),
            idempotencyKey: receiptSerialMovementIdempotencyKey(receivingId, line.lineId, serialNo),
          }))
        : [{
            serialNo: null,
            delta: signedQuantity({ type: RECEIVED, quantity: line.receivedQuantity }),
            idempotencyKey: receiptLineMovementIdempotencyKey(receivingId, line.lineId),
          }];

      for (const unit of units) {
        if (unit.delta <= 0) {
          // Unreachable through validation, which already refused a non-positive quantity. Kept
          // because a zero or negative RECEIVED row would silently destroy stock, and the sign
          // authority -- not this command -- is what decides the sign.
          refuse("MOVEMENT_QUANTITY_INVALID", "PRECONDITION_FAILED", "a RECEIVED movement must increase on-hand");
        }
        const movementId = `mov_${randomUUID()}`;
        await client.query(
          `INSERT INTO ${SCHEMA}.inventory_movements
             (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
              movement_type, quantity_delta, serial_number, source_kind, source_id, idempotency_key,
              occurred_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'RECEIVED', $8, $9, $10, $11, $12, $13, $14)`,
          [
            movementId, actor.tenantId, poRow.operatingCompanyKey, line.partId, line.trackingMode,
            locationRef.type, locationRef.locationId, unit.delta, unit.serialNo,
            RECEIPT_MOVEMENT_SOURCE_KIND, receivingId, unit.idempotencyKey,
            // The receipt's business time, never a write clock.
            receivedAt, actor.principalId,
          ],
        );
        movementIds.push(movementId);

        // ---- 14. SERIALIZED CUSTODY, in the SAME transaction as the movement ----
        //
        // `serialized_custody_unique` IS the double-receive check: one serial identifies one physical
        // unit of one part, tenant-wide. A plain INSERT rather than an upsert, so receiving the same
        // physical unit twice fails the whole receipt instead of quietly relocating a unit that is
        // already somewhere.
        if (unit.serialNo !== null) {
          const custodyId = `ser_${randomUUID()}`;
          try {
            await client.query(
              `INSERT INTO ${SCHEMA}.serialized_custody
                 (id, tenant_id, operating_company_key, part_id, serial_number, status,
                  location_type, location_id, updated_by)
               VALUES ($1, $2, $3, $4, $5, 'AVAILABLE', $6, $7, $8)`,
              [
                custodyId, actor.tenantId, poRow.operatingCompanyKey, line.partId, unit.serialNo,
                locationRef.type, locationRef.locationId, actor.principalId,
              ],
            );
          } catch (err) {
            if ((err as { code?: string }).code === "23505") {
              refuse(
                "SERIAL_IDENTITY_CONFLICT", "CONFLICT",
                "a serial number on this receipt is already held in custody: the same physical unit cannot be received twice",
              );
            }
            throw err;
          }
          serializedCustodyIds.push(custodyId);
        }
      }

      // ---- 15. ACQUISITION-COST EVIDENCE, when the purchase order carries a governed price ----
      const poLine = derived.lines.find((l) => l.lineId === LEGACY_LINE_ID) ?? derived.lines[0];
      const planned = await planAcquisitionCost(client, actor.tenantId, {
        unitPriceMinor: poLine.unitPriceMinor,
        currency: poLine.currency,
        priceAuthorityVersion: poRow.priceAuthorityVersion,
        operatingCompanyKey: poRow.operatingCompanyKey,
        purchaseOrderId: source.purchaseOrderId,
        purchaseOrderLineId: poLine.lineId,
        purchaseOrderSourceType: LEGACY_SOURCE_KIND,
        // The legacy chain is immutable and has no revisions, so null is the true statement.
        purchaseOrderVersion: null,
        supplierId: canonical.supplierId,
        supplierName: canonical.supplierName,
        partId: line.partId,
        receivedQuantity: line.receivedQuantity,
        receivingId,
        receivingLineId: line.lineId,
        receivedAt,
        receivingLocationType: locationRef.type,
        receivingLocationId: locationRef.locationId,
      });
      if (planned !== null) {
        acquisitionCostIds.push(await insertAcquisitionCostFact(client, actor.tenantId, actor.principalId, planned));
      }
    }

    // ---- 16. THE REORDER CLOSEOUT -- a consequence of the receipt, in its transaction ----
    const closed = await closeOutReorderAsReceived(client, {
      tenantId: actor.tenantId,
      actorPrincipalId: actor.principalId,
      reorderRequestId: source.reorderRequestId,
      receivedAt,
      reason: `closed out by the governed receipt ${receivingId}`,
    });

    const receivedNowByPoLineId = new Map<string, number>([[derived.lines[0].lineId, value.lines[0].receivedQuantity]]);
    const lines = perLineResults(derived, receivedNowByPoLineId, false);

    // ---- 17. AUDIT ----
    await audit(
      client, actor.tenantId, actor.principalId, receivingId,
      {
        receivingId,
        sourceKind: LEGACY_SOURCE_KIND,
        purchaseOrderId: source.purchaseOrderId,
        reorderRequestId: source.reorderRequestId,
        lineCount: value.lines.length,
        totalQuantity: value.lines.reduce((sum, l) => sum + l.receivedQuantity, 0),
        locationType: locationRef.type,
        locationId: locationRef.locationId,
        movementCount: movementIds.length,
        serialCount: serializedCustodyIds.length,
        acquisitionCostCount: acquisitionCostIds.length,
        reorderStatus: closed.status,
      },
      receivedAt,
      "stock received against a Reorder Purchase Order",
    );

    await client.query("COMMIT");
    return {
      outcome: "applied",
      receivingId,
      receivingOrderNumber,
      sourceKind: LEGACY_SOURCE_KIND,
      purchaseOrderId: source.purchaseOrderId,
      reorderRequestId: source.reorderRequestId,
      receivedAt: receivedAt.toISOString(),
      movementIds,
      serializedCustodyIds,
      acquisitionCostIds,
      lines,
      derivedState: lines.every((l) => l.remainingQuantity === 0)
        ? RECEIVED
        : lines.every((l) => l.previouslyReceived + l.receivedNow === 0) ? "NOT_RECEIVED" : "PARTIALLY_RECEIVED",
      reorderStatus: closed.status,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
