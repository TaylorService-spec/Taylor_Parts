// THE EOS CYCLE COUNT COMMANDS -- the sheet/line lifecycle over eos_ops, with WAREHOUSE SCOPE ENFORCED BY
// THE SERVER (Controller rulings DQ-017 / DQ-018, 2026-09-28).
//
// ════════════════════ WHAT THIS IS ════════════════════
//
// The command layer the existing PostgreSQL repository (cycleCountRepository.ts) was built to sit under.
// It adds NO new engine: the blind contract, the one-count-per-line rule, the guarded transitions and the
// ledger-row-with-disposition transaction are the repository's. This layer composes them inside ONE
// transaction per command, with the three things only a command can know:
//
//   * WHO: the verified Principal's capabilities (resolved by the transport from PostgreSQL), and its
//     governed Employee's WORK ELIGIBILITY and OPERATIONAL SCOPE -- read from eos_workforce by the ONE
//     contextual evaluator (contextualAuthorization.ts). Nothing about authority comes from the request.
//   * WHERE: the WAREHOUSE the counted location rolls up to (a WAREHOUSE by its own id, a BIN through its
//     immutable parent), read from eos_ops.warehouses / eos_ops.bins -- never from the request.
//   * WHAT: the Part and its tracking mode from the PostgreSQL Part authority, and the blind expected
//     snapshot from the PostgreSQL movement ledger.
//
// ════════════════════ THE SCOPE RULE (DQ-017) ════════════════════
//
// Every operation on a sheet requires, besides its capability:
//   WORK_ELIGIBILITY  WAREHOUSE_OPERATIONS
//   OPERATIONAL_SCOPE WAREHOUSE = <the sheet's warehouse>
// -- exactly the predicates the governed persona model already attaches to cycle counting
// (experienceAuthority.ts: CX-11 / CX-12), now evaluated per RECORD with the concrete warehouse id, not
// only per surface. A counter scoped to warehouse A cannot open, count, reconcile, read or even see a
// sheet in warehouse B: the list query carries the scope in its WHERE clause.
//
// ════════════════════ WHAT IS REFUSED, NOT GUESSED ════════════════════
//
//   * MOBILE (truck) counts are scoped ONLY through the truck location's explicit governed warehouse
//     binding (DQ-024; eosOps/inventoryScopeAuthority.ts). No binding -> MOBILE_SCOPE_BINDING_MISSING --
//     never the technician's, driver's or user's warehouse, never the truck's descriptive home warehouse.
//   * A Part the PostgreSQL catalog does not hold (eos_ops.parts is EMPTY in nonprod until the Catalog
//     COPY): PART_NOT_FOUND -- the honest answer, never a fallback to Firestore.
//   * A negative ledger sum, or a serial whose net is not 0/1: LEDGER_INTEGRITY -- an impossible expected
//     value is never clamped into a plausible one.
//
// ════════════════════ NOT ACTIVATED ════════════════════
//
// While CYCLE_COUNT_WRITER_AUTHORITY.postgres is INACTIVE every operation refuses NOT_ACTIVATED before it
// touches anything (the transport passes the constant; tests pass ACTIVE explicitly).
import { lockStockLocation } from "./stockLocationLock.js";
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import {
  authorizeObjectAction,
  postgresContextualReader,
  postgresPrincipalDimensionReader,
  type ContextPredicate,
} from "./contextualAuthorization.js";
import {
  CycleCountRepositoryError,
  cancelLine,
  cancelSheet,
  closeSheet,
  createSheet,
  findLineForPart,
  listLinesForSheet,
  listSheetsInWarehouses,
  openLine,
  readSheet,
  reconcileLineInTransaction,
  submitCount,
  type CycleCountLineFullRecord,
  type CycleCountSheetFull,
  type CycleCountSheetStatus,
  type Queryable,
} from "./cycleCountRepository.js";
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority.js";
import { InventoryScopeError, resolveScopeLocation } from "./inventoryScopeAuthority.js";
import type { PostgresCycleCountWriterState } from "../cycleCount/cycleCountWriterState.js";
import { INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE, isInventoryBaselineCertified } from "./inventoryBaselineGate.js";
import { withActorAuthority } from "./administrationReach.js";

// ════════════════════ vocabulary ════════════════════

export const EOS_CYCLE_COUNT_CAPABILITY = Object.freeze({
  create: "inventory.cycleCount.create",
  submit: "inventory.cycleCount.submit",
  reconcile: "inventory.cycleCount.reconcile",
  cancel: "inventory.cycleCount.cancel",
  close: "inventory.cycleCount.close",
});
const ANY_CYCLE_COUNT_CAPABILITY: readonly string[] = Object.freeze(Object.values(EOS_CYCLE_COUNT_CAPABILITY));

export const WAREHOUSE_WORK_ELIGIBILITY = "WAREHOUSE_OPERATIONS";

/** The two contextual predicates every sheet-level act requires, bound to the sheet's concrete warehouse. */
export function warehousePredicates(warehouseId: string): readonly ContextPredicate[] {
  return Object.freeze([
    Object.freeze({ kind: "WORK_ELIGIBILITY" as const, qualificationCode: WAREHOUSE_WORK_ELIGIBILITY }),
    Object.freeze({ kind: "OPERATIONAL_SCOPE" as const, scopeType: "WAREHOUSE", scopeId: warehouseId }),
  ]);
}

export type CycleCountOperationCategory =
  | "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "NOT_ACTIVATED" | "FAILED";

export class CycleCountOperationError extends Error {
  constructor(readonly code: string, readonly category: CycleCountOperationCategory, message: string) {
    super(message);
    this.name = "CycleCountOperationError";
  }
}
const refuse = (code: string, category: CycleCountOperationCategory, message: string): never => {
  throw new CycleCountOperationError(code, category, message);
};

export interface CycleCountActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

export interface CycleCountOperationDeps {
  readonly pool: Pool;
  /** The activation state. The transport passes CYCLE_COUNT_WRITER_AUTHORITY.postgres; nothing defaults it to ACTIVE. */
  readonly postgresState: PostgresCycleCountWriterState;
}

type Input = Record<string, unknown>;

// ════════════════════ small validators ════════════════════

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
function onlyKeys(input: Input, allowed: readonly string[]): void {
  if (!isPlain(input)) refuse("INVALID_INPUT", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("UNKNOWN_FIELD", "INVALID_INPUT", `unknown field(s): ${extra.sort().join(", ")}`);
}
function requireId(v: unknown, name: string): string {
  if (typeof v !== "string" || !SAFE_ID.test(v)) refuse("INVALID_INPUT", "INVALID_INPUT", `${name} is required and must be a plain id`);
  return v as string;
}
function optionalReason(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") refuse("INVALID_INPUT", "INVALID_INPUT", "reason must be text");
  const t = (v as string).trim();
  if (t.length > 500) refuse("INVALID_INPUT", "INVALID_INPUT", "reason is too long");
  return t === "" ? null : t;
}

/** Deterministic, path-safe sheet id from the caller's idempotency key, scoped to the tenant. */
export function cycleCountSheetIdFor(tenantId: string, idempotencyKey: string): string {
  return "ccs_" + createHash("sha256").update(JSON.stringify(["eos-cycle-count-sheet", tenantId, idempotencyKey])).digest("hex").slice(0, 40);
}

// ════════════════════ transaction + audit ════════════════════

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

async function audit(
  db: Queryable, actor: CycleCountActor, action: string, targetKind: string, targetId: string,
  before: unknown, after: unknown, reason: string | null = null,
): Promise<void> {
  await db.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, targetKind, targetId,
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(await withActorAuthority(db, actor.tenantId, actor.principalId, after)), reason],
  );
}

// ════════════════════ authority ════════════════════

async function requireActive(deps: CycleCountOperationDeps, tenantId: string): Promise<void> {
  if (deps.postgresState !== "ACTIVE") {
    refuse("NOT_ACTIVATED", "NOT_ACTIVATED", "EOS Cycle Count is not activated in this environment; counts are still taken on the current system");
  }
  // The cutover fails closed until the tenant's legacy baseline is CERTIFIED (inventoryBaselineGate.ts).
  if (!(await isInventoryBaselineCertified(deps.pool, tenantId))) refuse("NOT_ACTIVATED", "NOT_ACTIVATED", INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE);
}

async function authorizeAtWarehouse(db: Queryable, actor: CycleCountActor, capabilityKey: string, warehouseId: string): Promise<void> {
  const decision = await authorizeObjectAction(postgresContextualReader(db), {
    actor, capabilityKey, predicates: warehousePredicates(warehouseId),
  });
  if (!decision.allowed) {
    refuse(decision.reason, "FORBIDDEN",
      decision.reason === "CAPABILITY_MISSING" ? `you do not hold ${capabilityKey}`
        : decision.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "this count is in a warehouse outside your operational scope"
          : decision.reason === "WORK_ELIGIBILITY_MISSING" ? "cycle counting requires the Warehouse Operations work eligibility"
            : decision.reason === "EMPLOYEE_LINK_REQUIRED" ? "only an Employee can count inventory" : "not authorized");
  }
}

/** A read may be reached through ANY cycle-count capability -- still bound to the sheet's warehouse. */
async function authorizeReadAtWarehouse(db: Queryable, actor: CycleCountActor, warehouseId: string): Promise<void> {
  const held = ANY_CYCLE_COUNT_CAPABILITY.find((c) => actor.capabilities.has(c));
  if (!held) refuse("CAPABILITY_MISSING", "FORBIDDEN", "you hold no Cycle Count capability");
  await authorizeAtWarehouse(db, actor, held as string, warehouseId);
}

interface CountLocation {
  readonly type: "WAREHOUSE" | "BIN" | "MOBILE";
  readonly id: string;
  /** The warehouse whose scope governs this location (a MOBILE location: its explicit binding only). */
  readonly warehouseId: string;
  readonly operatingCompanyKey: string;
  readonly active: boolean;
}

/** WHERE the location rolls up to, read from eos_ops through the one scope resolver -- never from the request. */
async function resolveCountLocation(db: Queryable, tenantId: string, type: unknown, id: string): Promise<CountLocation> {
  try {
    const r = await resolveScopeLocation(db, tenantId, { type, locationId: id });
    return { type: r.type, id: r.locationId, warehouseId: r.scopeWarehouseId, operatingCompanyKey: r.operatingCompanyKey, active: r.active };
  } catch (err) {
    if (err instanceof InventoryScopeError) {
      return refuse(err.code === "LOCATION_TYPE_INVALID" ? "INVALID_INPUT" : err.code,
        err.code === "LOCATION_NOT_FOUND" ? "NOT_FOUND" : err.code === "LOCATION_TYPE_INVALID" ? "INVALID_INPUT" : "PRECONDITION_FAILED",
        err.code === "LOCATION_TYPE_INVALID" ? "location.type must be WAREHOUSE, BIN or MOBILE" : err.message);
    }
    throw err;
  }
}

async function sheetOrRefuse(db: Queryable, actor: CycleCountActor, sheetId: string, forUpdate: boolean): Promise<{ sheet: CycleCountSheetFull; where: CountLocation }> {
  const sheet = await readSheet(db, actor.tenantId, sheetId, forUpdate);
  if (!sheet) refuse("SHEET_NOT_FOUND", "NOT_FOUND", "that count sheet could not be found");
  const where = await resolveCountLocation(db, actor.tenantId, (sheet as CycleCountSheetFull).location.type, (sheet as CycleCountSheetFull).location.id);
  return { sheet: sheet as CycleCountSheetFull, where };
}

function requireSheetOpen(sheet: CycleCountSheetFull, what: string): void {
  if (sheet.status !== "OPEN") refuse("SHEET_STATUS_INVALID", "PRECONDITION_FAILED", `the sheet is ${sheet.status}; cannot ${what}`);
}

// ════════════════════ the blind expected snapshot, from the PostgreSQL ledger ════════════════════

async function expectedAt(db: Queryable, tenantId: string, partId: string, trackingMode: "NONE" | "SERIAL", where: CountLocation)
  : Promise<{ expectedQuantity: number; expectedSerialNumbers: string[] }> {
  if (trackingMode === "NONE") {
    const { rows } = await db.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(quantity_delta), 0)::bigint AS total FROM eos_ops.inventory_movements
        WHERE tenant_id = $1 AND part_id = $2 AND location_type = $3 AND location_id = $4 AND tracking_mode = 'NONE'`,
      [tenantId, partId, where.type, where.id]);
    const total = Number(rows[0]?.total ?? 0);
    // An impossible (negative) balance is a LEDGER defect, never an expected quantity (same rule as the
    // Firestore engine's cycleCountExpectedQuantity.ts): refused, not clamped.
    if (!Number.isSafeInteger(total) || total < 0) refuse("LEDGER_INTEGRITY", "PRECONDITION_FAILED", "the ledger balance at this location is impossible; it must be investigated before counting");
    return { expectedQuantity: total, expectedSerialNumbers: [] };
  }
  const { rows } = await db.query<{ serial_number: string; net: string }>(
    `SELECT serial_number, SUM(quantity_delta)::bigint AS net FROM eos_ops.inventory_movements
      WHERE tenant_id = $1 AND part_id = $2 AND location_type = $3 AND location_id = $4 AND tracking_mode = 'SERIAL'
      GROUP BY serial_number HAVING SUM(quantity_delta) <> 0 ORDER BY serial_number`,
    [tenantId, partId, where.type, where.id]);
  if (rows.some((r) => Number(r.net) !== 1)) {
    refuse("LEDGER_INTEGRITY", "PRECONDITION_FAILED", "a serial's ledger at this location nets to something other than one unit");
  }
  const serials = rows.map((r) => r.serial_number);
  return { expectedQuantity: serials.length, expectedSerialNumbers: serials };
}

// ════════════════════ projections (the blind rule, applied once) ════════════════════

const REVEALED = new Set(["COUNTED", "RECONCILED", "REJECTED"]);
/** A line as a counter may see it: expected values ONLY once this line's own count has been submitted. */
function projectLine(line: CycleCountLineFullRecord) {
  const base = { lineId: line.id, sheetId: line.sheetId, partId: line.partId, trackingMode: line.trackingMode, status: line.status };
  if (!REVEALED.has(line.status)) return Object.freeze(base);
  return Object.freeze({
    ...base,
    expectedQuantity: line.expectedQuantity,
    ...(line.trackingMode === "SERIAL" ? { expectedSerialNumbers: [...line.expectedSerialNumbers], countedSerialNumbers: [...line.countedSerialNumbers] } : {}),
    countedQuantity: line.countedQuantity,
    variance: line.variance,
    ...(line.reviewDecision ? { reviewDecision: line.reviewDecision } : {}),
    ...(line.ledgerMovementId ? { ledgerMovementId: line.ledgerMovementId } : {}),
  });
}
function projectSheet(sheet: CycleCountSheetFull, where: CountLocation) {
  return Object.freeze({
    sheetId: sheet.id, status: sheet.status, location: { type: sheet.location.type, locationId: sheet.location.id },
    warehouseId: where.warehouseId, operatingCompanyKey: sheet.operatingCompanyKey,
  });
}

function mapRepositoryError(err: unknown): never {
  if (err instanceof CycleCountRepositoryError) {
    const category: CycleCountOperationCategory =
      err.code === "LINE_NOT_FOUND" || err.code === "SHEET_NOT_FOUND" ? "NOT_FOUND"
        : err.code === "SEPARATION_OF_DUTIES" ? "FORBIDDEN"
          : err.code === "COUNT_ALREADY_SUBMITTED" ? "CONFLICT"
            : "PRECONDITION_FAILED";
    throw new CycleCountOperationError(err.code, category, err.message);
  }
  throw err;
}

// ════════════════════ commands ════════════════════

export async function createEosCycleCountSheet(deps: CycleCountOperationDeps, actor: CycleCountActor, input: Input) {
  await requireActive(deps, actor.tenantId);
  onlyKeys(input, ["location", "idempotencyKey"]);
  const location = input.location;
  if (!isPlain(location)) return refuse("INVALID_INPUT", "INVALID_INPUT", "location is required");
  onlyKeys(location, ["type", "locationId"]);
  const locationId = requireId(location.locationId, "location.locationId");
  const idempotencyKey = requireId(input.idempotencyKey, "idempotencyKey");
  const sheetId = cycleCountSheetIdFor(actor.tenantId, idempotencyKey);

  return inTransaction(deps.pool, async (db) => {
    const where = await resolveCountLocation(db, actor.tenantId, location.type, locationId);
    await authorizeAtWarehouse(db, actor, EOS_CYCLE_COUNT_CAPABILITY.create, where.warehouseId);
    // REPLAY FIRST: the same key is the same sheet; the same key for a different location is a conflict.
    const existing = await readSheet(db, actor.tenantId, sheetId, true);
    if (existing) {
      if (existing.location.type !== where.type || existing.location.id !== where.id) {
        refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "that request id already created a sheet for a different location");
      }
      return { outcome: "replayed" as const, sheet: projectSheet(existing, where) };
    }
    if (!where.active) refuse("LOCATION_INACTIVE", "PRECONDITION_FAILED", "an inactive location cannot be counted");
    const created = await createSheet(db, actor.tenantId, actor.principalId, where.operatingCompanyKey, { type: where.type, id: where.id }, sheetId);
    await audit(db, actor, "cycleCount.sheet.create", "cycleCountSheet", sheetId, null,
      { location: created.location, warehouseId: where.warehouseId, operatingCompanyKey: created.operatingCompanyKey });
    return {
      outcome: "applied" as const,
      sheet: projectSheet({ ...created, createdBy: actor.principalId }, where),
    };
  });
}

export async function openEosCycleCountLine(deps: CycleCountOperationDeps, actor: CycleCountActor, input: Input) {
  await requireActive(deps, actor.tenantId);
  onlyKeys(input, ["sheetId", "partId"]);
  const sheetId = requireId(input.sheetId, "sheetId");
  const partId = requireId(input.partId, "partId");
  return inTransaction(deps.pool, async (db) => {
    const { sheet, where } = await sheetOrRefuse(db, actor, sheetId, true);
    await authorizeAtWarehouse(db, actor, EOS_CYCLE_COUNT_CAPABILITY.create, where.warehouseId);
    const [policy] = await createPostgresPartPolicyAuthority().readPartPolicies(db, actor.tenantId, [partId]);
    if (!policy.found) refuse("PART_NOT_FOUND", "NOT_FOUND", "that part is not in the catalog");
    // REPLAY FIRST: one line per part per sheet; a repeat open is the same line, no second snapshot.
    const existing = await findLineForPart(db, actor.tenantId, sheetId, partId);
    if (existing) {
      if (existing.trackingMode !== policy.trackingMode) refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "the part's tracking mode changed after its line opened");
      return { outcome: "replayed" as const, line: projectLine(existing) };
    }
    requireSheetOpen(sheet, "open a line");
    if (policy.status !== "ACTIVE") refuse("PART_INACTIVE", "PRECONDITION_FAILED", "an inactive part cannot be counted");
    if (policy.trackingMode !== "NONE" && policy.trackingMode !== "SERIAL") refuse("TRACKING_MODE_UNSUPPORTED", "PRECONDITION_FAILED", "lot-tracked parts are not counted yet");
    if (!where.active) refuse("LOCATION_INACTIVE", "PRECONDITION_FAILED", "the sheet's location is no longer active");
    const mode = policy.trackingMode as "NONE" | "SERIAL";
    const expected = await expectedAt(db, actor.tenantId, partId, mode, where);
    const opened = await openLine(db, actor.tenantId, actor.principalId, sheetId, partId, mode, expected.expectedQuantity, expected.expectedSerialNumbers);
    await audit(db, actor, "cycleCount.line.open", "cycleCountLine", opened.id, null, { sheetId, partId, trackingMode: mode });
    return { outcome: "applied" as const, line: projectLine({ ...opened, expectedQuantity: null, expectedSerialNumbers: [], countedQuantity: null, countedSerialNumbers: [], variance: null, submittedBy: null, reviewDecision: null, ledgerMovementId: null }) };
  }).catch(mapRepositoryError);
}

export async function submitEosCycleCountLine(deps: CycleCountOperationDeps, actor: CycleCountActor, input: Input) {
  await requireActive(deps, actor.tenantId);
  onlyKeys(input, ["sheetId", "partId", "countedQuantity", "countedSerialNumbers"]);
  const sheetId = requireId(input.sheetId, "sheetId");
  const partId = requireId(input.partId, "partId");
  return inTransaction(deps.pool, async (db) => {
    const { where } = await sheetOrRefuse(db, actor, sheetId, true);
    await authorizeAtWarehouse(db, actor, EOS_CYCLE_COUNT_CAPABILITY.submit, where.warehouseId);
    const line = await findLineForPart(db, actor.tenantId, sheetId, partId);
    if (!line) return refuse("LINE_NOT_FOUND", "NOT_FOUND", "that part has no line on this sheet -- open it first");
    let countedQuantity: number | null = null;
    let countedSerialNumbers: string[] = [];
    if (line.trackingMode === "NONE") {
      if (input.countedSerialNumbers !== undefined) refuse("INVALID_INPUT", "INVALID_INPUT", "a quantity-tracked part is counted by quantity");
      if (typeof input.countedQuantity !== "number" || !Number.isSafeInteger(input.countedQuantity) || input.countedQuantity < 0) {
        refuse("INVALID_INPUT", "INVALID_INPUT", "countedQuantity must be a whole number, zero or more");
      }
      countedQuantity = input.countedQuantity as number;
    } else {
      if (input.countedQuantity !== undefined) refuse("INVALID_INPUT", "INVALID_INPUT", "a serialized part is counted by serial number");
      const s = input.countedSerialNumbers;
      if (!Array.isArray(s) || !s.every((x) => typeof x === "string" && x.trim() !== "")) refuse("INVALID_INPUT", "INVALID_INPUT", "countedSerialNumbers must be a list of serial numbers");
      countedSerialNumbers = (s as string[]).map((x) => x.trim());
      if (new Set(countedSerialNumbers).size !== countedSerialNumbers.length) refuse("INVALID_INPUT", "INVALID_INPUT", "a serial number was counted twice");
      countedQuantity = countedSerialNumbers.length;
    }
    const before = line.status;
    const updated = await submitCount(db, actor.tenantId, actor.principalId, line.id, countedQuantity, countedSerialNumbers);
    const replayed = before === "COUNTED";
    if (!replayed) {
      await audit(db, actor, "cycleCount.line.submit", "cycleCountLine", line.id, { status: before },
        { status: "COUNTED", countedQuantity, variance: updated.variance });
    }
    return { outcome: replayed ? ("replayed" as const) : ("applied" as const), line: projectLine(updated) };
  }).catch(mapRepositoryError);
}

export async function reconcileEosCycleCountLine(deps: CycleCountOperationDeps, actor: CycleCountActor, input: Input) {
  await requireActive(deps, actor.tenantId);
  onlyKeys(input, ["sheetId", "partId", "decision", "reason"]);
  const sheetId = requireId(input.sheetId, "sheetId");
  const partId = requireId(input.partId, "partId");
  const decision = input.decision;
  if (decision !== "APPROVE" && decision !== "REJECT") return refuse("INVALID_INPUT", "INVALID_INPUT", "decision must be APPROVE or REJECT");
  const reason = optionalReason(input.reason);
  return inTransaction(deps.pool, async (db) => {
    const { sheet, where } = await sheetOrRefuse(db, actor, sheetId, true);
    await authorizeAtWarehouse(db, actor, EOS_CYCLE_COUNT_CAPABILITY.reconcile, where.warehouseId);
    const line = await findLineForPart(db, actor.tenantId, sheetId, partId);
    if (!line) return refuse("LINE_NOT_FOUND", "NOT_FOUND", "that part has no line on this sheet");
    // REPLAY FIRST (before the sheet gate): the decision and its reason are the act.
    if (line.status === "RECONCILED" || line.status === "REJECTED") {
      const { rows } = await db.query<{ reconciliation_reason: string | null }>(
        `SELECT reconciliation_reason FROM eos_ops.cycle_count_lines WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, line.id]);
      if (line.reviewDecision !== decision || (rows[0]?.reconciliation_reason ?? null) !== reason) {
        refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", `the line was already ${line.status} with a different decision or reason`);
      }
      return { outcome: "replayed" as const, line: projectLine(line) };
    }
    requireSheetOpen(sheet, "reconcile a line");
    if (line.status !== "COUNTED") refuse("STATUS_INVALID", "PRECONDITION_FAILED", `the line is ${line.status}; submit a count first`);
    const discrepant = line.trackingMode === "SERIAL"
      ? [...line.expectedSerialNumbers].sort().join("\u0000") !== [...line.countedSerialNumbers].sort().join("\u0000")
      : (line.variance ?? 0) !== 0;
    // A discrepancy needs a reason for EITHER decision (the Firestore engine's rule).
    if (discrepant && !reason) refuse("REASON_REQUIRED", "INVALID_INPUT", "a reason is required when the count differs from what was expected");
    // PACKAGE H (Truck Inventory activation, 2026-10-01): the variance was measured against the blind snapshot taken from the
    // ledger when the line opened. Under the shared stock location lock (the one relocation, transfer dispatch and truck
    // consumption take), the balance NOW must still be that snapshot; if stock moved in between, posting the old variance
    // would misstate the location (or drive it negative), so the count is refused as stale -- cancel the line and count
    // again. Never clamped, never re-derived. Same transaction as the adjustment the repository then posts.
    if (decision === "APPROVE" && line.trackingMode === "NONE" && (line.variance ?? 0) !== 0) {
      await lockStockLocation(db, actor.tenantId, line.partId, sheet.location.type, sheet.location.id);
      const { rows: bal } = await db.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(quantity_delta), 0)::bigint AS total FROM eos_ops.inventory_movements
          WHERE tenant_id = $1 AND part_id = $2 AND tracking_mode = 'NONE' AND location_type = $3 AND location_id = $4`,
        [actor.tenantId, line.partId, sheet.location.type, sheet.location.id]);
      if (Number(bal[0]?.total ?? 0) !== line.expectedQuantity) {
        refuse("COUNT_STALE", "CONFLICT", "stock moved at this location after the count opened; cancel this line and count it again");
      }
    }
    const decided = await reconcileLineInTransaction(db, actor.tenantId, actor.principalId, line.id, decision, reason);
    await audit(db, actor, decision === "APPROVE" ? "cycleCount.line.reconcile" : "cycleCount.line.reject", "cycleCountLine", line.id,
      { status: "COUNTED", variance: line.variance }, { status: decided.status, ledgerMovementId: decided.ledgerMovementId }, reason);
    return { outcome: "applied" as const, line: projectLine(decided) };
  }).catch(mapRepositoryError);
}

export async function cancelEosCycleCountLine(deps: CycleCountOperationDeps, actor: CycleCountActor, input: Input) {
  await requireActive(deps, actor.tenantId);
  onlyKeys(input, ["sheetId", "partId"]);
  const sheetId = requireId(input.sheetId, "sheetId");
  const partId = requireId(input.partId, "partId");
  return inTransaction(deps.pool, async (db) => {
    const { sheet, where } = await sheetOrRefuse(db, actor, sheetId, true);
    await authorizeAtWarehouse(db, actor, EOS_CYCLE_COUNT_CAPABILITY.cancel, where.warehouseId);
    const line = await findLineForPart(db, actor.tenantId, sheetId, partId);
    if (!line) return refuse("LINE_NOT_FOUND", "NOT_FOUND", "that part has no line on this sheet");
    if (line.status === "CANCELLED") return { outcome: "replayed" as const, line: projectLine(line) };
    requireSheetOpen(sheet, "cancel a line");
    await cancelLine(db, actor.tenantId, actor.principalId, line.id);
    await audit(db, actor, "cycleCount.line.cancel", "cycleCountLine", line.id, { status: line.status }, { status: "CANCELLED" });
    return { outcome: "applied" as const, line: projectLine({ ...line, status: "CANCELLED" }) };
  }).catch(mapRepositoryError);
}

export async function closeEosCycleCountSheet(deps: CycleCountOperationDeps, actor: CycleCountActor, input: Input) {
  await requireActive(deps, actor.tenantId);
  onlyKeys(input, ["sheetId"]);
  const sheetId = requireId(input.sheetId, "sheetId");
  return inTransaction(deps.pool, async (db) => {
    const { sheet, where } = await sheetOrRefuse(db, actor, sheetId, true);
    await authorizeAtWarehouse(db, actor, EOS_CYCLE_COUNT_CAPABILITY.close, where.warehouseId);
    if (sheet.status === "CLOSED") return { outcome: "replayed" as const, sheet: projectSheet(sheet, where) };
    requireSheetOpen(sheet, "close it");
    await closeSheet(db, actor.tenantId, actor.principalId, sheetId);
    await audit(db, actor, "cycleCount.sheet.close", "cycleCountSheet", sheetId, { status: "OPEN" }, { status: "CLOSED" });
    return { outcome: "applied" as const, sheet: projectSheet({ ...sheet, status: "CLOSED" }, where) };
  }).catch(mapRepositoryError);
}

export async function cancelEosCycleCountSheet(deps: CycleCountOperationDeps, actor: CycleCountActor, input: Input) {
  await requireActive(deps, actor.tenantId);
  onlyKeys(input, ["sheetId"]);
  const sheetId = requireId(input.sheetId, "sheetId");
  return inTransaction(deps.pool, async (db) => {
    const { sheet, where } = await sheetOrRefuse(db, actor, sheetId, true);
    await authorizeAtWarehouse(db, actor, EOS_CYCLE_COUNT_CAPABILITY.cancel, where.warehouseId);
    if (sheet.status === "CANCELLED") return { outcome: "replayed" as const, sheet: projectSheet(sheet, where) };
    requireSheetOpen(sheet, "cancel it");
    await cancelSheet(db, actor.tenantId, actor.principalId, sheetId);
    await audit(db, actor, "cycleCount.sheet.cancel", "cycleCountSheet", sheetId, { status: "OPEN" }, { status: "CANCELLED" });
    return { outcome: "applied" as const, sheet: projectSheet({ ...sheet, status: "CANCELLED" }, where) };
  }).catch(mapRepositoryError);
}

// ════════════════════ reads ════════════════════

export async function getEosCycleCountSheet(deps: CycleCountOperationDeps, actor: CycleCountActor, input: Input) {
  await requireActive(deps, actor.tenantId);
  onlyKeys(input, ["sheetId"]);
  const sheetId = requireId(input.sheetId, "sheetId");
  const client = await deps.pool.connect();
  try {
    const { sheet, where } = await sheetOrRefuse(client, actor, sheetId, false);
    await authorizeReadAtWarehouse(client, actor, where.warehouseId);
    const lines = await listLinesForSheet(client, actor.tenantId, sheetId);
    return { sheet: projectSheet(sheet, where), lines: lines.map(projectLine) };
  } finally {
    client.release();
  }
}

const LIST_LIMIT = 200;
const SHEET_STATUSES: readonly CycleCountSheetStatus[] = ["OPEN", "CLOSED", "CANCELLED"];

/**
 * The sheets in the caller's OWN warehouse scopes. The scope is read from eos_workforce and becomes part
 * of the query; nothing outside it is fetched. No Employee link, or no Warehouse Operations eligibility,
 * is a refusal -- not an empty list, which would read as "there are no counts".
 */
export async function listEosCycleCountSheets(deps: CycleCountOperationDeps, actor: CycleCountActor, input: Input) {
  await requireActive(deps, actor.tenantId);
  onlyKeys(input ?? {}, ["status"]);
  const status = (input ?? {}).status ?? null;
  if (status !== null && !SHEET_STATUSES.includes(status as CycleCountSheetStatus)) refuse("INVALID_INPUT", "INVALID_INPUT", "status must be OPEN, CLOSED or CANCELLED");
  if (!ANY_CYCLE_COUNT_CAPABILITY.some((c) => actor.capabilities.has(c))) refuse("CAPABILITY_MISSING", "FORBIDDEN", "you hold no Cycle Count capability");
  const client = await deps.pool.connect();
  try {
    const dims = postgresPrincipalDimensionReader(client);
    const employeeId = await dims.linkedEmployeeId(actor.tenantId, actor.principalId);
    if (!employeeId) return refuse("EMPLOYEE_LINK_REQUIRED", "FORBIDDEN", "only an Employee can count inventory");
    const eligibility = await dims.listWorkEligibility(actor.tenantId, employeeId);
    if (!eligibility.includes(WAREHOUSE_WORK_ELIGIBILITY)) refuse("WORK_ELIGIBILITY_MISSING", "FORBIDDEN", "cycle counting requires the Warehouse Operations work eligibility");
    const warehouseIds = (await dims.listOperationalScopes(actor.tenantId, employeeId))
      .filter((s) => s.scopeType === "WAREHOUSE").map((s) => s.scopeId);
    const sheets = await listSheetsInWarehouses(client, actor.tenantId, warehouseIds, status as CycleCountSheetStatus | null, LIST_LIMIT + 1);
    const page = sheets.slice(0, LIST_LIMIT);
    const out = [];
    for (const s of page) out.push(projectSheet(s, await resolveCountLocation(client, actor.tenantId, s.location.type, s.location.id)));
    return { sheets: out, truncated: sheets.length > LIST_LIMIT, scopedWarehouseIds: [...warehouseIds].sort() };
  } finally {
    client.release();
  }
}

/** The closed operation table the transport serves. */
export const EOS_CYCLE_COUNT_OPERATIONS = Object.freeze({
  createCycleCountSheet: createEosCycleCountSheet,
  openCycleCountLine: openEosCycleCountLine,
  submitCycleCountLine: submitEosCycleCountLine,
  reconcileCycleCountLine: reconcileEosCycleCountLine,
  cancelCycleCountLine: cancelEosCycleCountLine,
  closeCycleCountSheet: closeEosCycleCountSheet,
  cancelCycleCountSheet: cancelEosCycleCountSheet,
  getCycleCountSheet: getEosCycleCountSheet,
  listCycleCountSheets: listEosCycleCountSheets,
} as const);
export type EosCycleCountOperation = keyof typeof EOS_CYCLE_COUNT_OPERATIONS;
