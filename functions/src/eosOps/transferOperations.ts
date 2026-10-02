// EOS TRANSFER -- the EXISTING Transfer lifecycle (inventoryTransfer/transferOrderCommand.ts) on the EOS operations
// transport, over the PostgreSQL inventory authority. ACTIVE since the Inventory / Warehouse activation (2026-10-01; inventoryTransfer/transferWriterState.ts), gated per tenant by the certified inventory baseline.
//
// ════════════════════ THE SAME LIFECYCLE ════════════════════
//
//   createTransfer   (none)      -> REQUESTED    part + ACTIVE endpoints + origin sufficiency; TO-YYYY-###### number
//   dispatchTransfer REQUESTED   -> IN_TRANSIT   TRANSFER_OUT at the origin; a serial unit becomes IN_TRANSIT
//                                                 (a STATE change: its location does not move yet)
//   receiveTransfer  IN_TRANSIT  -> COMPLETED    TRANSFER_IN at the destination; a serial unit's location moves HERE
//   cancelTransfer   REQUESTED   -> CANCELLED    domain-safe only: nothing has moved
//
// Carried over unchanged: the request validation (validateCreateTransferInput, imported -- it is pure), LOT refused,
// same-location refused, a move that never leaves its Warehouse refused as a RELOCATION (SAME_CUSTODY_PARENT, a
// truck having no custody Warehouse), exact-origin sufficiency (NONE: the ledger at the origin; SERIAL: each unit in
// custody at the origin and AVAILABLE, re-verified at dispatch), idempotency (create by its key: same request ->
// replayed, different -> IDEMPOTENCY_CONFLICT; a transition repeated after it committed -> replayed against the
// rows it wrote, never written twice), one audit per applied act, none for a replay.
//
// ════════════════════ WHAT EOS ADDS: DQ-024 PER-ACT SCOPE ════════════════════
//
// Each act needs, besides its capability, WORK_ELIGIBILITY WAREHOUSE_OPERATIONS and the WAREHOUSE operational scope
// of the END IT WORKS ON (inventoryScopeAuthority.requiredTransferScope): create / cancel / dispatch -> ORIGIN,
// receive -> DESTINATION. A truck end is scoped ONLY through its explicit governed binding; no binding -> refused.
//
// ════════════════════ COMPANY PER LEG ════════════════════
//
// The directional company pair is each endpoint's own authored key (a BIN: its Warehouse's). The OUT row carries the
// source company, the IN row the destination's (purchasingRepository.transferLegOperatingCompanyKey).
//
// PURE PostgreSQL: no Firebase import, no Firestore fallback, no dual write.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { warehousePredicates } from "./cycleCountOperations.js";
import { authorizeMobileAct, MobileStockRefusal } from "./mobileStockAuthority.js";
import { lockStockLocation } from "./stockLocationLock.js";
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority.js";
import { InventoryScopeError, requiredTransferScope, type TransferAct } from "./inventoryScopeAuthority.js";
import { createTransferOrder, readTransferOrder, transferLegOperatingCompanyKey, type TransferOrderRecord } from "./purchasingRepository.js";
import { validateCreateTransferInput } from "../inventoryTransfer/transferOrderValidation.js";
import type { TransferLocationRef } from "../inventoryTransfer/transferOrderTypes.js";
import { signedQuantity } from "../inventoryLedger/locationOnHand.js";
import type { PostgresTransferWriterState } from "../inventoryTransfer/transferWriterState.js";
import { INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE, isInventoryBaselineCertified } from "./inventoryBaselineGate.js";

type Queryable = Pick<PoolClient, "query">;

export const EOS_TRANSFER_CAPABILITY = Object.freeze({
  create: "inventory.transfer.create",
  dispatch: "inventory.transfer.dispatch",
  receive: "inventory.transfer.receive",
  cancel: "inventory.transfer.cancel",
});
export const TRANSFER_MOVEMENT_SOURCE_KIND = "TRANSFER_ORDER";

export type TransferOperationCategory =
  | "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "NOT_ACTIVATED";

export class TransferOperationError extends Error {
  constructor(readonly code: string, readonly category: TransferOperationCategory, message: string) {
    super(message);
    this.name = "TransferOperationError";
  }
}
const refuse = (code: string, category: TransferOperationCategory, message: string): never => {
  throw new TransferOperationError(code, category, message);
};

export interface TransferOperationActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}
export interface TransferOperationDeps {
  readonly pool: Pool;
  /** The activation state. The transport passes TRANSFER_WRITER_AUTHORITY.postgres; nothing defaults it to ACTIVE. */
  readonly postgresState: PostgresTransferWriterState;
  /** The allocation year; the transport passes nothing and the current UTC year is used. */
  readonly now?: () => Date;
}

/** Per-row ledger idempotency keys -- the Firestore command's derivation, over the transfer's id. */
export function transferLedgerKey(transferOrderId: string, side: "out" | "in"): string {
  return "trfmv_" + createHash("sha256").update(JSON.stringify([transferOrderId, side])).digest("hex").slice(0, 40);
}
export function transferSerialLedgerKey(transferOrderId: string, side: "out" | "in", serialNo: string): string {
  return "trfmvsn_" + createHash("sha256").update(JSON.stringify([transferOrderId, side, serialNo])).digest("hex").slice(0, 40);
}
export function formatEosTransferOrderNumber(year: number, sequence: number): string {
  return `TO-${year}-${String(sequence).padStart(6, "0")}`;
}

// ════════════════════ plumbing ════════════════════

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function requireActive(deps: TransferOperationDeps, tenantId: string): Promise<void> {
  if (deps.postgresState !== "ACTIVE") {
    refuse("NOT_ACTIVATED", "NOT_ACTIVATED", "EOS Transfer is not activated in this environment; transfers still run on the current system");
  }
  // The cutover fails closed until the tenant's legacy baseline is CERTIFIED (inventoryBaselineGate.ts).
  if (!(await isInventoryBaselineCertified(deps.pool, tenantId))) refuse("NOT_ACTIVATED", "NOT_ACTIVATED", INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE);
}

function requireCapability(actor: TransferOperationActor, act: keyof typeof EOS_TRANSFER_CAPABILITY): void {
  const key = EOS_TRANSFER_CAPABILITY[act];
  if (!actor.capabilities.has(key)) refuse("CAPABILITY_MISSING", "FORBIDDEN", `you do not hold ${key}`);
}

/**
 * DQ-024: the scope of the END this act works on, then eligibility + that warehouse's operational scope.
 *
 * OD-T3 (2026-10-01): RECEIVING INTO A TRUCK has a second, Technician path -- SERVICE_TECHNICIAN eligibility plus a current
 * MOBILE scope over THAT destination truck, revalidated here (mobileStockAuthority.ts). It is offered for `receive` with a
 * MOBILE destination ONLY: a Technician never creates, dispatches or cancels a transfer, never receives into a warehouse and
 * never receives into another Employee's truck. The warehouse path is tried first and is unchanged.
 */
async function authorizeAct(db: Queryable, actor: TransferOperationActor, act: TransferAct & keyof typeof EOS_TRANSFER_CAPABILITY,
  transfer: { readonly origin: TransferLocationRef; readonly destination: TransferLocationRef }): Promise<void> {
  const truckReceipt = act === "receive" && transfer.destination.type === "MOBILE";
  let scope;
  try {
    scope = await requiredTransferScope(db, actor.tenantId, act, transfer);
  } catch (err) {
    // An unbound truck has no warehouse path; the Technician path does not depend on the binding.
    if (!(truckReceipt && err instanceof InventoryScopeError && err.code === "MOBILE_SCOPE_BINDING_MISSING")) {
      if (err instanceof InventoryScopeError) {
        return refuse(err.code, err.code === "LOCATION_NOT_FOUND" ? "NOT_FOUND" : "PRECONDITION_FAILED", err.message);
      }
      throw err;
    }
  }
  let decision = scope
    ? await authorizeObjectAction(postgresContextualReader(db), {
      actor, capabilityKey: EOS_TRANSFER_CAPABILITY[act], predicates: warehousePredicates(scope.scopeWarehouseId),
    })
    : undefined;
  if (truckReceipt && !decision?.allowed && decision?.reason !== "CAPABILITY_MISSING") {
    try {
      const mobile = await authorizeMobileAct(db, actor, EOS_TRANSFER_CAPABILITY.receive, transfer.destination.locationId, { lock: true });
      if (mobile.allowed) return;
      // Report the refusal of the path the caller is ELIGIBLE for: a Technician (no Warehouse Operations eligibility) hears
      // "that truck is outside your scope", not a warehouse-eligibility answer it could never act on.
      if (!decision || (decision.reason === "WORK_ELIGIBILITY_MISSING" && mobile.decision.reason === "OUTSIDE_OPERATIONAL_SCOPE")) {
        return refuse(mobile.decision.reason, "FORBIDDEN", mobile.decision.reason === "OUTSIDE_OPERATIONAL_SCOPE"
          ? "this truck is outside your current MOBILE scope" : mobile.decision.reason === "WORK_ELIGIBILITY_MISSING"
            ? "receiving into a truck requires the Service Technician work eligibility or warehouse scope over its bound warehouse" : "not authorized");
      }
    } catch (err) {
      if (err instanceof MobileStockRefusal) return refuse(err.code, err.category, err.message);
      throw err;
    }
  }
  if (!decision) {
    return refuse("MOBILE_SCOPE_BINDING_MISSING", "PRECONDITION_FAILED",
      "this truck location has no governed warehouse scope binding, so no one's warehouse scope reaches it");
  }
  if (!decision.allowed) {
    refuse(decision.reason, "FORBIDDEN",
      decision.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "the warehouse this act works at is outside your operational scope"
        : decision.reason === "WORK_ELIGIBILITY_MISSING" ? "transfers require the Warehouse Operations work eligibility"
          : decision.reason === "EMPLOYEE_LINK_REQUIRED" ? "only an Employee can move inventory" : "not authorized");
  }
}

interface EndpointFacts {
  readonly exists: boolean;
  readonly active: boolean;
  /** The Warehouse custody parent; null for a truck (Model A). */
  readonly custodyWarehouseId: string | null;
  readonly operatingCompanyKey: string | null;
}

/** An endpoint's governed facts. Unlike the scope resolver, a truck here needs no binding: only the act's end does. */
async function endpointFacts(db: Queryable, tenantId: string, ref: TransferLocationRef): Promise<EndpointFacts> {
  if (ref.type === "WAREHOUSE") {
    const { rows } = await db.query<{ status: string; operating_company_key: string }>(
      `SELECT status::text AS status, operating_company_key FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2`, [tenantId, ref.locationId]);
    if (!rows[0]) return { exists: false, active: false, custodyWarehouseId: null, operatingCompanyKey: null };
    return { exists: true, active: rows[0].status === "ACTIVE", custodyWarehouseId: ref.locationId, operatingCompanyKey: rows[0].operating_company_key };
  }
  if (ref.type === "BIN") {
    const { rows } = await db.query<{ bin_status: string; warehouse_id: string; warehouse_status: string; operating_company_key: string }>(
      `SELECT b.status::text AS bin_status, b.warehouse_id, w.status::text AS warehouse_status, w.operating_company_key
         FROM eos_ops.bins b JOIN eos_ops.warehouses w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
        WHERE b.tenant_id = $1 AND b.id = $2`, [tenantId, ref.locationId]);
    if (!rows[0]) return { exists: false, active: false, custodyWarehouseId: null, operatingCompanyKey: null };
    return { exists: true, active: rows[0].bin_status === "ACTIVE" && rows[0].warehouse_status === "ACTIVE",
      custodyWarehouseId: rows[0].warehouse_id, operatingCompanyKey: rows[0].operating_company_key };
  }
  const { rows } = await db.query<{ active: boolean; operating_company_key: string }>(
    `SELECT active, operating_company_key FROM eos_ops.mobile_locations WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2`,
    [tenantId, ref.locationId]);
  if (!rows[0]) return { exists: false, active: false, custodyWarehouseId: null, operatingCompanyKey: null };
  return { exists: true, active: rows[0].active === true, custodyWarehouseId: null, operatingCompanyKey: rows[0].operating_company_key };
}

const toRef = (r: { type: string; id: string }): TransferLocationRef => ({ type: r.type as TransferLocationRef["type"], locationId: r.id });

async function audit(db: Queryable, actor: TransferOperationActor, action: string, t: TransferOrderRecord): Promise<void> {
  await db.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
     VALUES ($1, $2, $3, $4, 'transferOrder', $5, NULL, $6, NULL)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, t.id,
      JSON.stringify({ partId: t.partId, quantity: t.quantity, origin: toRef(t.origin), destination: toRef(t.destination),
        serialCount: t.serialNumbers.length, transferOrderNumber: t.transferOrderNumber })]);
}

async function lockTransfer(db: Queryable, actor: TransferOperationActor, input: Record<string, unknown>): Promise<TransferOrderRecord> {
  const allowed = ["transferOrderId"];
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !allowed.includes(k))) {
    refuse("INVALID_INPUT", "INVALID_INPUT", "only transferOrderId is accepted");
  }
  const id = input.transferOrderId;
  if (typeof id !== "string" || id.trim() === "") refuse("TRANSFER_NOT_FOUND", "NOT_FOUND", "transferOrderId missing");
  await db.query(`SELECT 1 FROM eos_ops.transfer_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, id]);
  const t = await readTransferOrder(db as unknown as Pool, actor.tenantId, id as string);
  if (!t) return refuse("TRANSFER_NOT_FOUND", "NOT_FOUND", "that transfer order could not be found");
  return t;
}

async function setStatus(db: Queryable, actor: TransferOperationActor, t: TransferOrderRecord, from: string, to: string): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE eos_ops.transfer_orders SET status = $4, updated_by = $5, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = $3`,
    [actor.tenantId, t.id, from, to, actor.principalId]);
  if (rowCount !== 1) refuse("STATUS_INVALID", "CONFLICT", "the transfer changed state before this act could commit");
}

interface PlannedLeg { readonly key: string; readonly serial: string | null; readonly delta: number }

function planLeg(t: TransferOrderRecord, leg: "out" | "in"): PlannedLeg[] {
  const type = leg === "out" ? "TRANSFER_OUT" : "TRANSFER_IN";
  if (t.trackingMode === "SERIAL") {
    return t.serialNumbers.map((s) => ({ key: transferSerialLedgerKey(t.id, leg, s), serial: s, delta: signedQuantity({ type, quantity: 1 }) }));
  }
  return [{ key: transferLedgerKey(t.id, leg), serial: null, delta: signedQuantity({ type, quantity: t.quantity }) }];
}

/** A transition repeated after it committed: its rows must all be there, exactly as planned. Never written twice. */
async function replayLeg(db: Queryable, t: TransferOrderRecord, leg: "out" | "in"): Promise<string[]> {
  const planned = planLeg(t, leg);
  const where = leg === "out" ? t.origin : t.destination;
  const { rows } = await db.query<{ id: string; idempotency_key: string; location_type: string; location_id: string; quantity_delta: number; serial_number: string | null; movement_type: string; source_id: string }>(
    `SELECT id, idempotency_key, location_type::text AS location_type, location_id, quantity_delta, serial_number, movement_type::text AS movement_type, source_id
       FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND idempotency_key = ANY($2)`, [t.tenantId, planned.map((p) => p.key)]);
  const byKey = new Map(rows.map((r) => [r.idempotency_key, r]));
  return planned.map((p) => {
    const r = byKey.get(p.key);
    if (!r || r.location_type !== where.type || r.location_id !== where.id || Number(r.quantity_delta) !== p.delta
      || (r.serial_number ?? null) !== p.serial || r.source_id !== t.id
      || r.movement_type !== (leg === "out" ? "TRANSFER_OUT" : "TRANSFER_IN")) {
      refuse("TRANSFER_INTEGRITY", "CONFLICT", `the transfer is past this step but its ${leg === "out" ? "TRANSFER_OUT" : "TRANSFER_IN"} evidence does not replay coherently`);
    }
    return (r as { id: string }).id;
  });
}

async function writeLeg(db: Queryable, actor: TransferOperationActor, t: TransferOrderRecord, leg: "out" | "in"): Promise<string[]> {
  const where = leg === "out" ? t.origin : t.destination;
  const companyKey = transferLegOperatingCompanyKey(t.companies, leg === "out" ? "OUT" : "IN");
  const ids: string[] = [];
  for (const p of planLeg(t, leg)) {
    if (p.delta === 0) refuse("TRANSFER_INTEGRITY", "CONFLICT", "a transfer leg with no postable quantity");
    const id = `mov_${randomUUID()}`;
    try {
      await db.query(
        `INSERT INTO eos_ops.inventory_movements
           (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
            movement_type, quantity_delta, serial_number, source_kind, source_id, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [id, t.tenantId, companyKey, t.partId, t.trackingMode, where.type, where.id, leg === "out" ? "TRANSFER_OUT" : "TRANSFER_IN",
          p.delta, p.serial, TRANSFER_MOVEMENT_SOURCE_KIND, t.id, p.key, actor.principalId]);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") refuse("TRANSFER_INTEGRITY", "CONFLICT", "this transfer's ledger rows already exist in another state");
      throw err;
    }
    ids.push(id);
  }
  return ids;
}

/** SERIAL: each unit in custody AT the origin, in the given status, never installed. */
async function requireSerialsAt(db: Queryable, tenantId: string, partId: string, serials: readonly string[], where: TransferLocationRef, status: string, lock: boolean): Promise<void> {
  const { rows } = await db.query<{ serial_number: string; status: string; location_type: string; location_id: string; equipment_id: string | null }>(
    `SELECT serial_number, status::text AS status, location_type::text AS location_type, location_id, equipment_id
       FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND part_id = $2 AND serial_number = ANY($3)${lock ? " FOR UPDATE" : ""}`,
    [tenantId, partId, serials]);
  const by = new Map(rows.map((r) => [r.serial_number, r]));
  for (const s of serials) {
    const u = by.get(s);
    if (!u) refuse("INSUFFICIENT_STOCK", "PRECONDITION_FAILED", `serial ${s} is not a known unit of this part`);
    const unit = u as NonNullable<typeof u>;
    if (unit.location_type !== where.type || unit.location_id !== where.locationId) refuse("INSUFFICIENT_STOCK", "PRECONDITION_FAILED", `serial ${s} is not at the origin location`);
    if (unit.status !== status || unit.equipment_id !== null) refuse("INSUFFICIENT_STOCK", "PRECONDITION_FAILED", `serial ${s} is not ${status} for transfer`);
  }
}

// ════════════════════ create ════════════════════

export async function createEosTransfer(deps: TransferOperationDeps, actor: TransferOperationActor, input: Record<string, unknown>) {
  await requireActive(deps, actor.tenantId);
  return inTransaction(deps.pool, async (db) => {
    requireCapability(actor, "create");
    if (!input || typeof input !== "object" || typeof input.partId !== "string" || input.partId.trim() === "") refuse("PART_INVALID", "INVALID_INPUT", "partId missing");
    const [part] = await createPostgresPartPolicyAuthority().readPartPolicies(db, actor.tenantId, [input.partId as string]);
    if (!part.found) refuse("PART_INVALID", "INVALID_INPUT", "part not found");
    const validated = validateCreateTransferInput(input, { part: { partId: part.partId, trackingMode: part.trackingMode } });
    if (!validated.valid) {
      const reason = validated.reason ?? "unknown";
      if (reason === "origin_invalid") refuse("ORIGIN_INVALID", "INVALID_INPUT", "origin is malformed or not a WAREHOUSE/BIN/MOBILE reference");
      if (reason === "destination_invalid") refuse("DESTINATION_INVALID", "INVALID_INPUT", "destination is malformed or not a WAREHOUSE/BIN/MOBILE reference");
      if (reason === "same_location") refuse("SAME_LOCATION", "INVALID_INPUT", "origin and destination are the same location");
      if (reason.startsWith("serial_")) refuse("SERIAL_INVALID", "INVALID_INPUT", `transfer input invalid: ${reason}`);
      if (reason === "tracking_mode_unsupported") refuse("PART_INVALID", "INVALID_INPUT", "tracking mode not supported (LOT deferred)");
      refuse("PART_INVALID", "INVALID_INPUT", `transfer input invalid: ${reason}`);
    }
    const value = (validated as { value: NonNullable<typeof validated.value> }).value;
    const serials = value.serialNumbers ?? [];

    // DQ-024: create needs the ORIGIN's scope.
    await authorizeAct(db, actor, "create", value);

    // Idempotency: the key is the transfer's identity. Same request -> replayed; different -> conflict.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`eos-transfer-create:${actor.tenantId}:${value.idempotencyKey}`]);
    const { rows: prior } = await db.query<{ id: string }>(
      `SELECT id FROM eos_ops.transfer_orders WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, value.idempotencyKey]);
    if (prior[0]) {
      const stored = await readTransferOrder(db as unknown as Pool, actor.tenantId, prior[0].id);
      const s = stored as TransferOrderRecord;
      const same = s.partId === value.partId && s.trackingMode === value.trackingMode && s.quantity === value.quantity
        && s.origin.type === value.origin.type && s.origin.id === value.origin.locationId
        && s.destination.type === value.destination.type && s.destination.id === value.destination.locationId
        && JSON.stringify([...s.serialNumbers]) === JSON.stringify(serials);
      if (!same) refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotency key was already used for a different transfer");
      return { outcome: "replayed" as const, transferOrderId: s.id, transferOrderNumber: s.transferOrderNumber };
    }
    if (part.status !== "ACTIVE") refuse("PART_INVALID", "INVALID_INPUT", "part is not active");

    const origin = await endpointFacts(db, actor.tenantId, value.origin);
    const destination = await endpointFacts(db, actor.tenantId, value.destination);
    if (!origin.exists || !origin.active) refuse("ORIGIN_INVALID", "INVALID_INPUT", "origin is not an active governed location");
    if (!destination.exists || !destination.active) refuse("DESTINATION_INVALID", "INVALID_INPUT", "destination is not an active governed location");
    // A movement that never leaves its Warehouse is a RELOCATION, refused here by name.
    if (origin.custodyWarehouseId !== null && origin.custodyWarehouseId === destination.custodyWarehouseId) {
      refuse("SAME_CUSTODY_PARENT", "PRECONDITION_FAILED", "origin and destination share a custody Warehouse: use a relocation");
    }

    if (value.trackingMode === "SERIAL") {
      await requireSerialsAt(db, actor.tenantId, part.partId, serials, value.origin, "AVAILABLE", true);
    } else {
      await requireOriginStock(db, actor.tenantId, part.partId, value.origin, value.quantity);
    }

    const year = (deps.now ? deps.now() : new Date()).getUTCFullYear();
    const { rows: n } = await db.query<{ last_value: string }>(
      `INSERT INTO eos_ops.transfer_number_counters (tenant_id, year, last_value) VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = eos_ops.transfer_number_counters.last_value + 1, updated_at = now()
       RETURNING last_value`, [actor.tenantId, year]);
    const transferOrderNumber = formatEosTransferOrderNumber(year, Number(n[0].last_value));

    const created = await createTransferOrder(db as unknown as Pool, actor.tenantId, actor.principalId,
      { source: origin.operatingCompanyKey as string, destination: destination.operatingCompanyKey as string },
      { partId: part.partId, trackingMode: value.trackingMode, quantity: value.quantity,
        origin: { type: value.origin.type, id: value.origin.locationId }, destination: { type: value.destination.type, id: value.destination.locationId },
        serialNumbers: serials, status: "REQUESTED", transferOrderNumber, idempotencyKey: value.idempotencyKey });
    await audit(db, actor, "transfer.create", created);
    return { outcome: "applied" as const, transferOrderId: created.id, transferOrderNumber };
  });
}

/**
 * NONE-tracked sufficiency AT the origin location, under the per-(part, location) lock the relocation also takes, so a
 * concurrent relocation / transfer cannot interleave between the sum and the write. Used at create AND at dispatch.
 */
async function requireOriginStock(db: Queryable, tenantId: string, partId: string, origin: { type: string; locationId: string }, quantity: number): Promise<void> {
  await lockStockLocation(db, tenantId, partId, origin.type, origin.locationId);
  const { rows } = await db.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(quantity_delta), 0)::bigint AS total FROM eos_ops.inventory_movements
      WHERE tenant_id = $1 AND part_id = $2 AND tracking_mode = 'NONE' AND location_type = $3 AND location_id = $4`,
    [tenantId, partId, origin.type, origin.locationId]);
  const onHand = Number(rows[0]?.total ?? 0);
  if (!Number.isSafeInteger(onHand) || onHand < 0) refuse("TRANSFER_INTEGRITY", "PRECONDITION_FAILED", "on-hand at the origin cannot be derived: the ledger balance is impossible");
  if (onHand < quantity) refuse("INSUFFICIENT_STOCK", "PRECONDITION_FAILED", `origin on-hand (${onHand}) is less than the requested quantity (${quantity})`);
}

// ════════════════════ dispatch / receive / cancel ════════════════════

export async function dispatchEosTransfer(deps: TransferOperationDeps, actor: TransferOperationActor, input: Record<string, unknown>) {
  await requireActive(deps, actor.tenantId);
  return inTransaction(deps.pool, async (db) => {
    requireCapability(actor, "dispatch");
    const t = await lockTransfer(db, actor, input);
    await authorizeAct(db, actor, "dispatch", { origin: toRef(t.origin), destination: toRef(t.destination) });
    if (t.status === "IN_TRANSIT") return { outcome: "replayed" as const, transferOrderId: t.id, ledgerEventIds: await replayLeg(db, t, "out") };
    if (t.status !== "REQUESTED") refuse("STATUS_INVALID", "PRECONDITION_FAILED", `transfer order is ${t.status}, cannot dispatch`);
    if (t.trackingMode === "SERIAL") {
      // Re-verified at dispatch: a unit could have moved between create and dispatch.
      await requireSerialsAt(db, actor.tenantId, t.partId, t.serialNumbers, toRef(t.origin), "AVAILABLE", true);
    } else {
      // Re-verified at dispatch too (Controller INVENTORY reconciliation, 2026-10-01: no negative stock unless governed).
      // The create-time check only proves stock existed THEN; a relocation or another transfer may have taken it since, and
      // dispatch is the act that writes TRANSFER_OUT. Same per-location lock as the relocation, so they serialize.
      await requireOriginStock(db, actor.tenantId, t.partId, toRef(t.origin), t.quantity);
    }
    const ledgerEventIds = await writeLeg(db, actor, t, "out");
    if (t.trackingMode === "SERIAL") {
      // A STATE change: the unit stops being available at the origin; its location moves only at receive.
      await db.query(`UPDATE eos_ops.serialized_custody SET status = 'IN_TRANSIT', updated_by = $4, updated_at = now()
                        WHERE tenant_id = $1 AND part_id = $2 AND serial_number = ANY($3)`, [actor.tenantId, t.partId, t.serialNumbers, actor.principalId]);
    }
    await setStatus(db, actor, t, "REQUESTED", "IN_TRANSIT");
    await audit(db, actor, "transfer.dispatch", t);
    return { outcome: "applied" as const, transferOrderId: t.id, ledgerEventIds };
  });
}

export async function receiveEosTransfer(deps: TransferOperationDeps, actor: TransferOperationActor, input: Record<string, unknown>) {
  await requireActive(deps, actor.tenantId);
  return inTransaction(deps.pool, async (db) => {
    requireCapability(actor, "receive");
    const t = await lockTransfer(db, actor, input);
    await authorizeAct(db, actor, "receive", { origin: toRef(t.origin), destination: toRef(t.destination) });
    if (t.status === "COMPLETED") return { outcome: "replayed" as const, transferOrderId: t.id, ledgerEventIds: await replayLeg(db, t, "in") };
    if (t.status !== "IN_TRANSIT") refuse("STATUS_INVALID", "PRECONDITION_FAILED", `transfer order is ${t.status}, cannot receive`);
    // The dispatch evidence must be there before anything is received against it (DQ-019: never inferred).
    await replayLeg(db, t, "out");
    if (t.trackingMode === "SERIAL") await requireSerialsAt(db, actor.tenantId, t.partId, t.serialNumbers, toRef(t.origin), "IN_TRANSIT", true);
    const ledgerEventIds = await writeLeg(db, actor, t, "in");
    if (t.trackingMode === "SERIAL") {
      // THE transfer-completion authority: the only place a unit's location moves as part of a transfer.
      await db.query(`UPDATE eos_ops.serialized_custody SET status = 'AVAILABLE', location_type = $4, location_id = $5, updated_by = $6, updated_at = now()
                        WHERE tenant_id = $1 AND part_id = $2 AND serial_number = ANY($3)`,
        [actor.tenantId, t.partId, t.serialNumbers, t.destination.type, t.destination.id, actor.principalId]);
    }
    await setStatus(db, actor, t, "IN_TRANSIT", "COMPLETED");
    await audit(db, actor, "transfer.receive", t);
    return { outcome: "applied" as const, transferOrderId: t.id, ledgerEventIds };
  });
}

export async function cancelEosTransfer(deps: TransferOperationDeps, actor: TransferOperationActor, input: Record<string, unknown>) {
  await requireActive(deps, actor.tenantId);
  return inTransaction(deps.pool, async (db) => {
    requireCapability(actor, "cancel");
    const t = await lockTransfer(db, actor, input);
    await authorizeAct(db, actor, "cancel", { origin: toRef(t.origin), destination: toRef(t.destination) });
    if (t.status === "CANCELLED") return { outcome: "replayed" as const, transferOrderId: t.id };
    if (t.status !== "REQUESTED") refuse("STATUS_INVALID", "PRECONDITION_FAILED", `transfer order is ${t.status}, cancellation is only domain-safe before dispatch`);
    await setStatus(db, actor, t, "REQUESTED", "CANCELLED");
    await audit(db, actor, "transfer.cancel", t);
    return { outcome: "applied" as const, transferOrderId: t.id };
  });
}

export const EOS_TRANSFER_OPERATIONS = Object.freeze({
  createTransfer: createEosTransfer,
  dispatchTransfer: dispatchEosTransfer,
  receiveTransfer: receiveEosTransfer,
  cancelTransfer: cancelEosTransfer,
} as const);
export type EosTransferOperation = keyof typeof EOS_TRANSFER_OPERATIONS;
