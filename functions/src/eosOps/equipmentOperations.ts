// THE EQUIPMENT REGISTER ROUTE'S CLOSED OPERATION TABLE (/operations/equipment) -- Controller EQUIPMENT ACTIVATION
// AUTHORIZED, 2026-10-01 (OD-3 / OD-4 / OD-5).
//
// The register on PostgreSQL, composed over the EXISTING repository (equipmentCustody.ts): the same table, the same row
// projection, the same customer-site namespace. Nothing here installs -- installation is the Work Order's
// (workOrderEquipmentInstall.ts) -- and nothing here moves custody.
//
// ════════════════════ AUTHORITY, SERVER-SIDE, PER RECORD ════════════════════
//
//   equipment.record.read    held GLOBALLY       the operational register (Service Manager, Dispatcher, Office Manager,
//                                                Parts, Owner): every record of the tenant.
//                            held in salesChannel scope   a seller: ONLY Equipment whose Account has commercial work
//                                                (an Opportunity or a Sales Order) in an admitted channel -- decided in
//                                                SQL against the STORED channel, never a channel the caller states.
//   (no equipment.record.read) + the Work Order's OWN read decision (workOrder.record.read, conditioned on the open
//                                                assignment for a Technician): the Equipment of THAT Work Order
//                                                (readWorkOrderEquipment), and nothing else.
//   equipment.record.manage  create / update register records. Customer, site and company are fixed at create.
//   inventory.serializedAsset.read  the company-held whole units available to install (discovery only, OD-5).
//
// A list is filtered IN THE QUERY; a single record outside the caller's reach is refused EXACTLY like a missing one.
// Client-side filtering is presentation, never authority.
//
// No human Equipment number (OD-4): the internal id stays internal; name / serial / asset tag are the human reference.
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { admittedScopeValues } from "../adminPolicy/assignmentScopeRuntime";
import { authorizeWorkOrderRecordRead } from "./workOrderRecordRead";
import { EQUIPMENT_COLUMNS, equipmentColumns, equipmentRow, readInstalledUnit, type EquipmentRecord, OPS_EQUIPMENT_STATUSES } from "./equipmentCustody";
import { EQUIPMENT_WRITER_AUTHORITY, type PostgresEquipmentWriterState } from "./equipmentWriterState";
import { resolveOperatingCompanyKeyForCompany } from "./operatingCompanyBinding";
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority";
import type { WorkOrderCaller, WorkOrderOperationDeps } from "./workOrderOperationTypes";

export const EQUIPMENT_RECORD_READ = "equipment.record.read";
export const EQUIPMENT_RECORD_MANAGE = "equipment.record.manage";
export const SERIALIZED_ASSET_READ = "inventory.serializedAsset.read";
export const WORK_ORDER_RECORD_READ = "workOrder.record.read";
export const EQUIPMENT_LIST_DEFAULT_LIMIT = 50;
export const EQUIPMENT_LIST_MAX_LIMIT = 200;

export type EquipmentOperationCategory =
  | "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "NOT_ACTIVATED";

export class EquipmentOperationError extends Error {
  constructor(readonly code: string, readonly category: EquipmentOperationCategory, message: string) {
    super(message);
    this.name = "EquipmentOperationError";
  }
}
const refuse = (code: string, category: EquipmentOperationCategory, message: string): never => {
  throw new EquipmentOperationError(code, category, message);
};

type Deps = WorkOrderOperationDeps & { readonly equipmentPostgresState?: PostgresEquipmentWriterState };
type Op = (deps: Deps, caller: WorkOrderCaller, input: Record<string, unknown>) => Promise<unknown>;

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const TEXT = (v: unknown, max = 500): v is string => typeof v === "string" && v.trim() !== "" && v.length <= max;
const DATE = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function only(input: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this operation does not accept: ${extra.sort().join(", ")}`);
}

function requireActive(deps: Deps): void {
  if ((deps.equipmentPostgresState ?? EQUIPMENT_WRITER_AUTHORITY.postgres) !== "ACTIVE") {
    refuse("NOT_ACTIVATED", "NOT_ACTIVATED", "the PostgreSQL Equipment register is not activated yet");
  }
}

// ════════════════════ READ REACH ════════════════════

/** GLOBAL, or the sales channels a salesChannel-scoped holding admits. Refuses a caller with neither. */
interface ReadReach { readonly global: boolean; readonly channels: readonly string[] }

function readReach(caller: WorkOrderCaller): ReadReach {
  if (caller.actor.capabilities.has(EQUIPMENT_RECORD_READ)) return { global: true, channels: [] };
  const channels = admittedScopeValues(caller.operational.scopedHeld as never, EQUIPMENT_RECORD_READ, "salesChannel");
  if (channels.length > 0) return { global: false, channels };
  return refuse("CAPABILITY_MISSING", "FORBIDDEN", `reading the Equipment register requires ${EQUIPMENT_RECORD_READ}`);
}

/** The reach as a SQL condition over alias `e`; `$1` is the tenant, the channels are bound at `param`. */
function reachSql(reach: ReadReach, param: number): string {
  // A global reach still names its parameter, so the statement's parameter types are always determinable.
  if (reach.global) return `cardinality($${param}::text[]) >= 0`;
  return `(EXISTS (SELECT 1 FROM eos_commercial.opportunities o WHERE o.tenant_id = e.tenant_id AND o.account_id = e.account_id
                    AND o.sales_channel::text = ANY($${param}::text[]))
        OR EXISTS (SELECT 1 FROM eos_commercial.sales_orders so WHERE so.tenant_id = e.tenant_id AND so.account_id = e.account_id
                    AND so.sales_channel::text = ANY($${param}::text[])))`;
}

const LIST_COLUMNS = equipmentColumns("e");

export interface RegisterRecord extends EquipmentRecord {
  readonly accountName: string | null;
  readonly customerLocationName: string | null;
}

function registerRow(row: Record<string, unknown>): RegisterRecord {
  return Object.freeze({ ...equipmentRow(row as Record<string, any>),
    accountName: row.account_name == null ? null : String(row.account_name),
    customerLocationName: row.location_name == null ? null : String(row.location_name) });
}

const FROM_REGISTER = `FROM eos_ops.equipment e
  LEFT JOIN eos_crm.accounts a ON a.tenant_id = e.tenant_id AND a.id = e.account_id
  LEFT JOIN eos_crm.account_locations l ON l.tenant_id = e.tenant_id AND l.id = e.customer_location_id`;

// ════════════════════ reads ════════════════════

/** list / search / by customer / by site / by serial, one query, the reach in its WHERE. Keyset-paged by (name, id). */
async function listEquipment(deps: Deps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  only(input, ["accountId", "customerLocationId", "search", "serialNumber", "status", "limit", "cursor"]);
  requireActive(deps);
  const reach = readReach(caller);
  for (const k of ["accountId", "customerLocationId"] as const) {
    if (input[k] !== undefined && !ID_SHAPE(input[k])) refuse("FILTER_INVALID", "INVALID_INPUT", `${k}, when stated, is an id`);
  }
  if (input.search !== undefined && !TEXT(input.search, 100)) refuse("FILTER_INVALID", "INVALID_INPUT", "search, when stated, is 1-100 characters");
  if (input.serialNumber !== undefined && !TEXT(input.serialNumber, 200)) refuse("FILTER_INVALID", "INVALID_INPUT", "serialNumber, when stated, is text");
  if (input.status !== undefined && !(OPS_EQUIPMENT_STATUSES as readonly string[]).includes(input.status as string)) {
    refuse("FILTER_INVALID", "INVALID_INPUT", `status is one of ${OPS_EQUIPMENT_STATUSES.join(", ")}`);
  }
  const limit = input.limit === undefined ? EQUIPMENT_LIST_DEFAULT_LIMIT : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > EQUIPMENT_LIST_MAX_LIMIT) {
    refuse("LIMIT_INVALID", "INVALID_INPUT", `limit is 1-${EQUIPMENT_LIST_MAX_LIMIT}`);
  }
  let after: { name: string; id: string } | null = null;
  if (input.cursor !== undefined) {
    try {
      const c = JSON.parse(Buffer.from(String(input.cursor), "base64url").toString("utf8"));
      if (typeof c?.name !== "string" || typeof c?.id !== "string") throw new Error("shape");
      after = { name: c.name, id: c.id };
    } catch {
      refuse("CURSOR_INVALID", "INVALID_INPUT", "cursor is not one this list issued");
    }
  }
  const search = input.search === undefined ? null : `%${String(input.search).trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const { rows } = await deps.pool.query(
    `SELECT ${LIST_COLUMNS}, a.name AS account_name, l.name AS location_name ${FROM_REGISTER}
      WHERE e.tenant_id = $1 AND ${reachSql(reach, 2)}
        AND ($3::text IS NULL OR e.account_id = $3) AND ($4::text IS NULL OR e.customer_location_id = $4)
        AND ($5::text IS NULL OR e.serial_number = $5) AND ($6::text IS NULL OR e.status::text = $6)
        AND ($7::text IS NULL OR e.name ILIKE $7 OR e.serial_number ILIKE $7 OR e.asset_tag ILIKE $7)
        AND ($8::text IS NULL OR (e.name, e.id) > ($8, $9))
      ORDER BY e.name, e.id LIMIT $10`,
    [caller.actor.tenantId, reach.channels, input.accountId ?? null, input.customerLocationId ?? null,
      input.serialNumber ?? null, input.status ?? null, search, after?.name ?? null, after?.id ?? null, limit + 1]);
  const page = rows.slice(0, limit).map(registerRow);
  const last = page[page.length - 1];
  return Object.freeze({
    equipment: Object.freeze(page),
    nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ name: last.name, id: last.id })).toString("base64url") : null,
    reach: reach.global ? "GLOBAL" : "SALES_CHANNEL",
  });
}

interface EventView {
  readonly id: string; readonly eventType: string; readonly occurredAt: string; readonly actorPrincipalId: string;
  readonly source: string; readonly reason: string | null; readonly workOrderId: string | null; readonly partId: string | null;
  readonly serialNumber: string | null; readonly ledgerMovementId: string | null; readonly changes: unknown;
}

async function readEvents(db: Pick<PoolClient, "query">, tenantId: string, equipmentId: string): Promise<readonly EventView[]> {
  const { rows } = await db.query(
    `SELECT id, event_type, occurred_at, actor_principal_id, source, reason, work_order_id, part_id, serial_number,
            ledger_movement_id, changes
       FROM eos_ops.equipment_events WHERE tenant_id = $1 AND equipment_id = $2 ORDER BY occurred_at, id`,
    [tenantId, equipmentId]);
  return Object.freeze(rows.map((r) => Object.freeze({
    id: String(r.id), eventType: String(r.event_type), occurredAt: new Date(r.occurred_at).toISOString(),
    actorPrincipalId: String(r.actor_principal_id), source: String(r.source), reason: r.reason ?? null,
    workOrderId: r.work_order_id ?? null, partId: r.part_id ?? null, serialNumber: r.serial_number ?? null,
    ledgerMovementId: r.ledger_movement_id ?? null, changes: r.changes ?? {},
  })));
}

async function readOne(db: Pick<PoolClient, "query">, tenantId: string, equipmentId: string, reach: ReadReach) {
  const { rows } = await db.query(
    `SELECT ${LIST_COLUMNS}, a.name AS account_name, l.name AS location_name ${FROM_REGISTER}
      WHERE e.tenant_id = $1 AND e.id = $3 AND ${reachSql(reach, 2)}`,
    [tenantId, reach.channels, equipmentId]);
  if (rows.length === 0) return null;
  const equipment = registerRow(rows[0]);
  const unit = await readInstalledUnit(db as unknown as Pool, tenantId, equipmentId);
  return Object.freeze({ equipment, installedUnit: unit, events: await readEvents(db, tenantId, equipmentId) });
}

/** One record, its installed unit and its history. Outside the reach reads exactly like absent. */
async function readEquipmentRecord(deps: Deps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  only(input, ["equipmentId"]);
  requireActive(deps);
  const reach = readReach(caller);
  if (!ID_SHAPE(input.equipmentId)) refuse("EQUIPMENT_ID_REQUIRED", "INVALID_INPUT", "equipmentId is required");
  const found = await readOne(deps.pool, caller.actor.tenantId, input.equipmentId as string, reach);
  if (!found) refuse("EQUIPMENT_NOT_FOUND", "NOT_FOUND", "no such Equipment");
  return found;
}

/**
 * The Equipment of ONE Work Order: a register reader sees it as a register record; anyone else must hold
 * workOrder.record.read AND be the assigned Employee of THAT Work Order (the Technician, OD-3). Never a browse.
 */
async function readWorkOrderEquipment(deps: Deps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  only(input, ["workOrderId"]);
  requireActive(deps);
  if (!ID_SHAPE(input.workOrderId)) refuse("WORK_ORDER_ID_REQUIRED", "INVALID_INPUT", "workOrderId is required");
  const tenantId = caller.actor.tenantId;
  if (!caller.actor.capabilities.has(EQUIPMENT_RECORD_READ)) {
    // THE WORK ORDER'S OWN READ DECISION (workOrderRecordRead.ts): a conditioned technician grant is decided against the
    // OPEN assignment of THIS Work Order -- the same answer readWorkOrder gives, never a flat-set shortcut.
    const decision = await authorizeWorkOrderRecordRead(deps.reader, caller.operational, input.workOrderId as string);
    if (!decision.allowed) {
      const code = String(decision.outcome);
      refuse(code, "FORBIDDEN", code === "CAPABILITY_MISSING"
        ? `reading a Work Order's Equipment requires ${EQUIPMENT_RECORD_READ}, or ${WORK_ORDER_RECORD_READ} on a Work Order you may read`
        : "only the Equipment of a Work Order assigned to you");
    }
  }
  const { rows } = await deps.pool.query(`SELECT equipment_id FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, input.workOrderId]);
  if (rows.length === 0) refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "no such Work Order");
  const equipmentId = rows[0].equipment_id as string | null;
  if (equipmentId === null) return Object.freeze({ workOrderId: input.workOrderId, equipment: null, installedUnit: null, events: [] });
  const found = await readOne(deps.pool, tenantId, equipmentId, { global: true, channels: [] });
  return Object.freeze({ workOrderId: input.workOrderId, ...(found ?? { equipment: null, installedUnit: null, events: [] }) });
}

/**
 * The company-held whole units available to install -- DISCOVERY ONLY (OD-5: installing is the INSTALL Work Order's).
 * WAREHOUSE / BIN custody, AVAILABLE or RESERVED, whole units per the catalog, with warehouse / bin labels.
 */
async function listAvailableEquipmentUnits(deps: Deps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  only(input, ["partId", "serialNumber", "limit"]);
  requireActive(deps);
  if (!caller.actor.capabilities.has(SERIALIZED_ASSET_READ)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `listing available units requires ${SERIALIZED_ASSET_READ}`);
  }
  if (input.partId !== undefined && !ID_SHAPE(input.partId)) refuse("FILTER_INVALID", "INVALID_INPUT", "partId, when stated, is an id");
  if (input.serialNumber !== undefined && !TEXT(input.serialNumber, 200)) refuse("FILTER_INVALID", "INVALID_INPUT", "serialNumber, when stated, is text");
  const limit = input.limit === undefined ? EQUIPMENT_LIST_DEFAULT_LIMIT : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > EQUIPMENT_LIST_MAX_LIMIT) refuse("LIMIT_INVALID", "INVALID_INPUT", `limit is 1-${EQUIPMENT_LIST_MAX_LIMIT}`);
  const tenantId = caller.actor.tenantId;
  const { rows } = await deps.pool.query(
    `SELECT c.part_id, c.serial_number, c.status::text AS status, c.location_type::text AS location_type, c.location_id,
            c.operating_company_key,
            COALESCE(w.name, bw.name) AS warehouse_name, COALESCE(w.id, b.warehouse_id) AS warehouse_id, b.code AS bin_code,
            p.name AS part_name
       FROM eos_ops.serialized_custody c
       JOIN eos_ops.parts p ON p.tenant_id = c.tenant_id AND p.id = c.part_id AND p.whole_unit = TRUE
       LEFT JOIN eos_ops.warehouses w ON c.location_type = 'WAREHOUSE' AND w.tenant_id = c.tenant_id AND w.id = c.location_id
       LEFT JOIN eos_ops.bins b ON c.location_type = 'BIN' AND b.tenant_id = c.tenant_id AND b.id = c.location_id
       LEFT JOIN eos_ops.warehouses bw ON bw.tenant_id = b.tenant_id AND bw.id = b.warehouse_id
      WHERE c.tenant_id = $1 AND c.status::text IN ('AVAILABLE', 'RESERVED') AND c.location_type::text IN ('WAREHOUSE', 'BIN')
        AND ($2::text IS NULL OR c.part_id = $2) AND ($3::text IS NULL OR c.serial_number = $3)
      ORDER BY c.part_id, c.serial_number LIMIT $4`,
    [tenantId, input.partId ?? null, input.serialNumber ?? null, limit + 1]);
  return Object.freeze({
    units: Object.freeze(rows.slice(0, limit).map((r) => Object.freeze({
      partId: String(r.part_id), partName: r.part_name ?? null, serialNumber: String(r.serial_number), status: String(r.status),
      locationType: String(r.location_type), locationId: String(r.location_id), operatingCompanyKey: String(r.operating_company_key),
      warehouseId: r.warehouse_id ?? null, warehouseName: r.warehouse_name ?? null, binCode: r.bin_code ?? null,
    }))),
    truncated: rows.length > limit,
  });
}

// ════════════════════ writes ════════════════════

function requireManage(caller: WorkOrderCaller): void {
  if (!caller.actor.capabilities.has(EQUIPMENT_RECORD_MANAGE)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `managing the Equipment register requires ${EQUIPMENT_RECORD_MANAGE}`);
  }
}

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

/** The customer is ACTIVE and the site is THAT customer's -- the relationship fails closed. */
async function requireCustomerSite(db: Pick<PoolClient, "query">, tenantId: string, accountId: string, locationId: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT a.status::text AS status, l.id AS location_id
       FROM eos_crm.accounts a
       LEFT JOIN eos_crm.account_locations l ON l.tenant_id = a.tenant_id AND l.account_id = a.id AND l.id = $3
      WHERE a.tenant_id = $1 AND a.id = $2 FOR SHARE OF a`,
    [tenantId, accountId, locationId]);
  if (rows.length === 0) refuse("CUSTOMER_NOT_FOUND", "NOT_FOUND", "no such customer");
  if (rows[0].status !== "ACTIVE") refuse("CUSTOMER_NOT_ACTIVE", "PRECONDITION_FAILED", `the customer is ${String(rows[0].status)}`);
  if (rows[0].location_id == null) refuse("CUSTOMER_SITE_MISMATCH", "PRECONDITION_FAILED", "the site is not a site of this customer");
}

async function requireModel(db: Pick<PoolClient, "query">, tenantId: string, modelId: string): Promise<void> {
  const { rows } = await db.query(`SELECT status::text AS status FROM eos_ops.equipment_models WHERE tenant_id = $1 AND id = $2`, [tenantId, modelId]);
  if (rows.length === 0) refuse("MODEL_NOT_FOUND", "NOT_FOUND", "no such Equipment Model in this tenant's catalog");
  if (rows[0].status !== "ACTIVE") refuse("MODEL_NOT_ACTIVE", "PRECONDITION_FAILED", `the Equipment Model is ${String(rows[0].status)}`);
}

/** A serial names one machine of a model: a second ACTIVE record of the same model + serial is refused. */
async function requireSerialUnique(db: Pick<PoolClient, "query">, tenantId: string, modelId: string | null, serial: string | null, exceptId: string | null): Promise<void> {
  if (serial === null || modelId === null) return;
  const { rows } = await db.query(
    `SELECT id FROM eos_ops.equipment WHERE tenant_id = $1 AND equipment_model_id = $2 AND serial_number = $3
        AND status::text <> 'RETIRED' AND ($4::text IS NULL OR id <> $4) LIMIT 1`,
    [tenantId, modelId, serial, exceptId]);
  if (rows.length > 0) refuse("DUPLICATE_SERIAL", "CONFLICT", "another Equipment record of this model already carries that serial");
}

const CREATE_FIELDS = ["operatingCompanyId", "accountId", "customerLocationId", "name", "equipmentModelId", "serialNumber",
  "assetTag", "installedOn", "warrantyExpiresOn", "notes", "idempotencyKey"] as const;
const EDITABLE_FIELDS = ["name", "equipmentModelId", "serialNumber", "assetTag", "installedOn", "warrantyExpiresOn", "notes", "status"] as const;
type Editable = (typeof EDITABLE_FIELDS)[number];
const COLUMN: Readonly<Record<Editable, string>> = Object.freeze({
  name: "name", equipmentModelId: "equipment_model_id", serialNumber: "serial_number", assetTag: "asset_tag",
  installedOn: "installed_on", warrantyExpiresOn: "warranty_expires_on", notes: "notes", status: "status",
});

function validateEditable(field: Editable, value: unknown): string | null {
  if (field === "name") {
    if (!TEXT(value, 200)) refuse("NAME_INVALID", "INVALID_INPUT", "name is 1-200 characters");
    return (value as string).trim();
  }
  if (value === null) {
    if (field === "status") refuse("STATUS_INVALID", "INVALID_INPUT", "status cannot be cleared");
    return null;
  }
  if (field === "status") {
    if (!(OPS_EQUIPMENT_STATUSES as readonly string[]).includes(value as string)) refuse("STATUS_INVALID", "INVALID_INPUT", `status is one of ${OPS_EQUIPMENT_STATUSES.join(", ")}`);
    return value as string;
  }
  if (field === "installedOn" || field === "warrantyExpiresOn") {
    if (!DATE(value)) refuse("DATE_INVALID", "INVALID_INPUT", `${field} is a YYYY-MM-DD date`);
    return value as string;
  }
  if (field === "equipmentModelId") {
    if (!ID_SHAPE(value)) refuse("MODEL_INVALID", "INVALID_INPUT", "equipmentModelId is an id");
    return value as string;
  }
  if (!TEXT(value, field === "notes" ? 4000 : 200)) refuse("FIELD_INVALID", "INVALID_INPUT", `${field}, when stated, is non-empty text`);
  return (value as string).trim();
}

export function equipmentCreateId(idempotencyKey: string): string {
  return "eq_" + createHash("sha256").update(JSON.stringify(["equipmentCreate", idempotencyKey])).digest("hex").slice(0, 40);
}

/** Create one register record (a customer's machine that did not come out of company stock). */
async function createEquipment(deps: Deps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  only(input, CREATE_FIELDS);
  requireActive(deps);
  requireManage(caller);
  if (!ID_SHAPE(input.operatingCompanyId)) refuse("OPERATING_COMPANY_REQUIRED", "INVALID_INPUT", "the operating company is stated, never inferred");
  if (!ID_SHAPE(input.accountId)) refuse("CUSTOMER_REQUIRED", "INVALID_INPUT", "Equipment belongs to a customer");
  if (!ID_SHAPE(input.customerLocationId)) refuse("SITE_REQUIRED", "INVALID_INPUT", "Equipment is at a customer site");
  if (!TEXT(input.idempotencyKey, 150) || (input.idempotencyKey as string).trim() !== input.idempotencyKey) {
    refuse("IDEMPOTENCY_KEY_INVALID", "INVALID_INPUT", "idempotencyKey is a trimmed string of at most 150 characters");
  }
  const values: Partial<Record<Editable, string | null>> = {};
  for (const f of EDITABLE_FIELDS) {
    if (f === "status") continue;
    if (f === "name" || input[f] !== undefined) values[f] = validateEditable(f, input[f]);
  }
  const key = input.idempotencyKey as string;
  const id = equipmentCreateId(key);
  const fingerprint = createHash("sha256").update(JSON.stringify([caller.actor.principalId,
    ...CREATE_FIELDS.filter((k) => k !== "idempotencyKey").map((k) => input[k] ?? null)])).digest("hex");
  const tenantId = caller.actor.tenantId;

  return inTransaction(deps.pool, async (client) => {
    const { rows: prior } = await client.query(
      `SELECT request_fingerprint FROM eos_ops.equipment_events WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, `equipmentCreate:${key}`]);
    if (prior.length > 0) {
      if (prior[0].request_fingerprint !== fingerprint) refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotencyKey already created a different Equipment record");
      const again = await readOne(client, tenantId, id, { global: true, channels: [] });
      return Object.freeze({ outcome: "replayed" as const, ...again });
    }
    let companyKey: string;
    try {
      companyKey = await resolveOperatingCompanyKeyForCompany(client, tenantId, input.operatingCompanyId as string);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (code.startsWith("OPERATING_COMPANY_")) refuse(code, "PRECONDITION_FAILED", "the operating company has no ACTIVE key binding for this tenant");
      throw err;
    }
    await requireCustomerSite(client, tenantId, input.accountId as string, input.customerLocationId as string);
    if (values.equipmentModelId) await requireModel(client, tenantId, values.equipmentModelId);
    await requireSerialUnique(client, tenantId, values.equipmentModelId ?? null, values.serialNumber ?? null, null);
    try {
      await client.query(
        `INSERT INTO eos_ops.equipment
           (id, tenant_id, operating_company_key, account_id, customer_location_id, equipment_model_id, name, status,
            serial_number, asset_tag, installed_on, warranty_expires_on, notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $9, $10, $11, $12, $13, $13)`,
        [id, tenantId, companyKey, input.accountId, input.customerLocationId, values.equipmentModelId ?? null, values.name,
          values.serialNumber ?? null, values.assetTag ?? null, values.installedOn ?? null, values.warrantyExpiresOn ?? null,
          values.notes ?? null, caller.actor.principalId]);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotencyKey already names an Equipment record");
      throw err;
    }
    await client.query(
      `INSERT INTO eos_ops.equipment_events
         (id, tenant_id, equipment_id, event_type, operating_company_key, account_id, customer_location_id, source, reason,
          changes, idempotency_key, request_fingerprint, actor_principal_id)
       VALUES ($1, $2, $3, 'CREATED', $4, $5, $6, 'EOS_COMMAND', $7, $8, $9, $10, $11)`,
      [`eqe_${randomUUID()}`, tenantId, id, companyKey, input.accountId, input.customerLocationId, "registered through Equipment administration",
        JSON.stringify(values), `equipmentCreate:${key}`, fingerprint, caller.actor.principalId]);
    const created = await readOne(client, tenantId, id, { global: true, channels: [] });
    return Object.freeze({ outcome: "created" as const, ...created });
  });
}

/** Update one register record at a stated version. Customer, site and company never change here. */
async function updateEquipment(deps: Deps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  only(input, ["equipmentId", "expectedVersion", "changes", "reason"]);
  requireActive(deps);
  requireManage(caller);
  if (!ID_SHAPE(input.equipmentId)) refuse("EQUIPMENT_ID_REQUIRED", "INVALID_INPUT", "equipmentId is required");
  if (!Number.isInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) {
    refuse("EXPECTED_VERSION_REQUIRED", "INVALID_INPUT", "state the version being edited");
  }
  if (input.reason !== undefined && !TEXT(input.reason, 500)) refuse("REASON_INVALID", "INVALID_INPUT", "reason, when stated, is text");
  const changes = input.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length === 0) {
    refuse("CHANGES_REQUIRED", "INVALID_INPUT", "changes is a non-empty object");
  }
  const fixed = Object.keys(changes as object).filter((k) => !(EDITABLE_FIELDS as readonly string[]).includes(k));
  if (fixed.length > 0) {
    refuse("FIELD_NOT_EDITABLE", "INVALID_INPUT", `these cannot be changed here: ${fixed.sort().join(", ")} (customer, site and company are fixed at create)`);
  }
  const next: Partial<Record<Editable, string | null>> = {};
  for (const [k, v] of Object.entries(changes as Record<string, unknown>)) next[k as Editable] = validateEditable(k as Editable, v);
  const tenantId = caller.actor.tenantId;

  return inTransaction(deps.pool, async (client) => {
    const { rows } = await client.query(`SELECT ${EQUIPMENT_COLUMNS} FROM eos_ops.equipment WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, input.equipmentId]);
    if (rows.length === 0) refuse("EQUIPMENT_NOT_FOUND", "NOT_FOUND", "no such Equipment");
    const current = equipmentRow(rows[0]);
    if (current.version !== input.expectedVersion) refuse("VERSION_CONFLICT", "CONFLICT", `the record is at version ${current.version}; reload and retry`);
    const before: Record<string, unknown> = {
      name: current.name, equipmentModelId: current.equipmentModelId, serialNumber: current.serialNumber, assetTag: current.assetTag,
      installedOn: current.installedOn, warrantyExpiresOn: current.warrantyExpiresOn, notes: current.notes, status: current.status,
    };
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(next)) if (before[k] !== v) diff[k] = { from: before[k], to: v };
    if (Object.keys(diff).length === 0) refuse("NO_CHANGE", "INVALID_INPUT", "nothing would change");
    const unit = await readInstalledUnit(client as unknown as Pool, tenantId, current.id);
    if (unit && diff.serialNumber) refuse("SERIAL_FIXED_BY_INSTALLED_UNIT", "PRECONDITION_FAILED", "the serial is the installed unit's; it cannot be edited");
    if (unit && diff.status) {
      refuse("STATUS_FIXED_BY_INSTALLED_UNIT", "PRECONDITION_FAILED", "a record with an installed unit stays ACTIVE until removal is governed");
    }
    if (unit && diff.equipmentModelId) {
      const [policy] = await createPostgresPartPolicyAuthority().readPartPolicies(client, tenantId, [unit.partId]);
      if (policy.equipmentModelId !== null && policy.equipmentModelId !== next.equipmentModelId) {
        refuse("MODEL_FIXED_BY_INSTALLED_UNIT", "PRECONDITION_FAILED", "the installed unit's catalog Part names a different model");
      }
    }
    if (diff.equipmentModelId && next.equipmentModelId) await requireModel(client, tenantId, next.equipmentModelId);
    const modelAfter = (Object.prototype.hasOwnProperty.call(next, "equipmentModelId") ? next.equipmentModelId : current.equipmentModelId) ?? null;
    const serialAfter = (Object.prototype.hasOwnProperty.call(next, "serialNumber") ? next.serialNumber : current.serialNumber) ?? null;
    if (diff.equipmentModelId || diff.serialNumber || (diff.status && next.status !== "RETIRED")) {
      await requireSerialUnique(client, tenantId, modelAfter, serialAfter, current.id);
    }
    const sets = Object.keys(diff).map((k, i) => `${COLUMN[k as Editable]} = $${i + 4}${k === "status" ? "::eos_ops.ops_equipment_status" : ""}`);
    await client.query(
      `UPDATE eos_ops.equipment SET ${sets.join(", ")}, version = version + 1, updated_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, current.id, caller.actor.principalId, ...Object.keys(diff).map((k) => next[k as Editable])]);
    await client.query(
      `INSERT INTO eos_ops.equipment_events
         (id, tenant_id, equipment_id, event_type, operating_company_key, account_id, customer_location_id, source, reason,
          changes, actor_principal_id)
       VALUES ($1, $2, $3, 'UPDATED', $4, $5, $6, 'EOS_COMMAND', $7, $8, $9)`,
      [`eqe_${randomUUID()}`, tenantId, current.id, current.operatingCompanyKey, current.accountId, current.customerLocation.id,
        input.reason ?? null, JSON.stringify(diff), caller.actor.principalId]);
    const updated = await readOne(client, tenantId, current.id, { global: true, channels: [] });
    return Object.freeze({ outcome: "updated" as const, ...updated });
  });
}

export const EOS_EQUIPMENT_OPERATIONS = Object.freeze({
  listEquipment,
  readEquipment: readEquipmentRecord,
  readWorkOrderEquipment,
  listAvailableEquipmentUnits,
  createEquipment,
  updateEquipment,
} satisfies Record<string, Op>);

export type EosEquipmentOperation = keyof typeof EOS_EQUIPMENT_OPERATIONS;
export const EQUIPMENT_READ_OPERATIONS: readonly string[] = Object.freeze(["listEquipment", "readEquipment", "readWorkOrderEquipment", "listAvailableEquipmentUnits"]);
export const isEquipmentOperation = (name: unknown): name is EosEquipmentOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_EQUIPMENT_OPERATIONS, name);
