// GOVERNED SUPPLIER ADMINISTRATION in PostgreSQL (Controller NONPROD FINANCE ACTIVATION + SUPPLIER ADMINISTRATION, 2026-10-02;
// DECISIONS #196). The ONE writer of eos_ops.suppliers -- not a seed tool, not a second supplier master.
//
// THE MODEL. The CRM Account is the organization's identity; the Supplier is the operational PURCHASING RELATIONSHIP with it:
//   CRM ORGANIZATION (governed as a VENDOR) -> SUPPLIER RELATIONSHIP -> purchasing use (governed PO supplier identity, #193)
//   -> FINANCIAL COUNTERPARTY (EXTERNAL_ORGANIZATION, through the organization).
// A new supplier is ALWAYS linked to an existing ACTIVE CRM organization governed as a VENDOR, at most one supplier per
// organization. Its display name is the organization's name, authored by the server -- organization identity is never typed
// a second time. It carries only supplier-specific operational fields (vendor number, purchasing contact, phone, email,
// remit / order address, payment-terms reference, notes). Nothing is ever deleted: a supplier is DEACTIVATED (and may be
// reactivated); an INACTIVE supplier cannot be selected for a new PO, and every historical PO stays readable.
//
// AUTHORITY -- REUSED, NOT INVENTED. DECISIONS #78 and the Supplier Master design govern suppliers as catalog reference data:
// create / update need inventory.catalog.manage, activate / deactivate need inventory.catalog.activate -- the same keys the
// retiring Firebase Supplier Master enforced (supplierMasterCommands.ts). Both are already registered and granted through
// Administration; changing who holds them needs no source edit. No Firebase.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { ReorderLifecycleError, type ReorderActor } from "./reorderLifecycleCommands.js";
import { withActorAuthority } from "./administrationReach.js";

export const SUPPLIER_MANAGE_CAPABILITY = "inventory.catalog.manage";
export const SUPPLIER_STATUS_CAPABILITY = "inventory.catalog.activate";
/** supplierMasterTypes.ts SUPPLIER_ID_PATTERN, restated (the Firebase module imports firebase-admin). */
export const SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const SUPPLIER_OPERATIONAL_FIELDS = Object.freeze({
  vendorNumber: "vendor_number", contactName: "contact_name", phone: "phone", email: "email", address: "address",
  paymentTermsRef: "payment_terms_ref", notes: "notes",
} as const);
type OperationalField = keyof typeof SUPPLIER_OPERATIONAL_FIELDS;

const refuse = (code: string, category: "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "PRECONDITION_FAILED" | "CONFLICT", message: string): never => {
  throw new ReorderLifecycleError(code, category, message);
};

/**
 * The ONE definition of a supplier's normalized key -- the same transformation as supplierMasterValidation.normalizeSupplierName
 * (restated, not imported, because that module imports firebase-admin; supplierAdministrationParity.test pins them equal).
 */
export function normalizeSupplierName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function requireCapability(actor: ReorderActor, key: string): void {
  if (!actor || !(actor.capabilities instanceof Set) || !actor.capabilities.has(key)) refuse("CAPABILITY_MISSING", "FORBIDDEN", `supplier administration requires ${key}`);
}
function acceptOnly(input: Record<string, unknown> | undefined, allowed: readonly string[]): Record<string, unknown> {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const extra = Object.keys(i).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  return i;
}
function operationalFields(i: Record<string, unknown>): Map<OperationalField, string | null> {
  const out = new Map<OperationalField, string | null>();
  for (const k of Object.keys(SUPPLIER_OPERATIONAL_FIELDS) as OperationalField[]) {
    if (i[k] === undefined) continue;
    const v = i[k];
    if (v === null) { out.set(k, null); continue; }
    if (typeof v !== "string" || v.trim() === "" || v.length > (k === "notes" || k === "address" ? 1000 : 200)) {
      refuse("FIELD_INVALID", "INVALID_INPUT", `${k} is a non-blank string (or null to clear it)`);
    }
    out.set(k, (v as string).trim());
  }
  return out;
}
async function inTransaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}
async function audit(c: PoolClient, actor: ReorderActor, action: string, supplierId: string, before: unknown, after: unknown, reason: string) {
  await c.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1,$2,$3,$4,'supplier',$5,$6::jsonb,$7::jsonb,now(),$8)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, supplierId, before === null ? null : JSON.stringify(before), JSON.stringify(await withActorAuthority(c, actor.tenantId, actor.principalId, after)), reason]);
}
const view = (r: Record<string, unknown>) => Object.freeze({
  supplierId: String(r.supplier_id), name: String(r.name), status: String(r.status), crmAccountId: (r.crm_account_id as string | null) ?? null,
  vendorNumber: (r.vendor_number as string | null) ?? null, contactName: (r.contact_name as string | null) ?? null, phone: (r.phone as string | null) ?? null,
  email: (r.email as string | null) ?? null, address: (r.address as string | null) ?? null, paymentTermsRef: (r.payment_terms_ref as string | null) ?? null,
  notes: (r.notes as string | null) ?? null, version: Number(r.version),
});

/** CREATE the supplier relationship of an existing CRM organization governed as a VENDOR. Same request again = replayed. */
export async function createSupplier(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_MANAGE_CAPABILITY);
  const i = acceptOnly(input, ["supplierId", "crmAccountId", ...Object.keys(SUPPLIER_OPERATIONAL_FIELDS)]);
  if (typeof i.supplierId !== "string" || !SUPPLIER_ID_PATTERN.test(i.supplierId)) refuse("SUPPLIER_ID_INVALID", "INVALID_INPUT", "supplierId is 1-64 letters, digits, '-' or '_'");
  if (typeof i.crmAccountId !== "string" || i.crmAccountId.trim() === "") refuse("ORGANIZATION_REQUIRED", "INVALID_INPUT", "a supplier is the purchasing relationship of a CRM organization");
  const fields = operationalFields(i);
  const fingerprint = createHash("sha256").update(JSON.stringify([i.crmAccountId, ...[...fields.entries()].sort()])).digest("hex");
  return inTransaction(deps.pool, async (c) => {
    const { rows: existing } = await c.query(`SELECT * FROM eos_ops.suppliers WHERE tenant_id = $1 AND supplier_id = $2`, [actor.tenantId, i.supplierId]);
    if (existing[0]) {
      const same = existing[0].crm_account_id === i.crmAccountId
        && [...fields.entries()].every(([k, v]) => (existing[0][SUPPLIER_OPERATIONAL_FIELDS[k]] ?? null) === v);
      if (!same) refuse("SUPPLIER_ID_TAKEN", "CONFLICT", "that supplierId already identifies a different supplier");
      return { outcome: "replayed" as const, supplier: view(existing[0]) };
    }
    const { rows: acct } = await c.query(
      `SELECT a.name, a.status, EXISTS (SELECT 1 FROM eos_crm.account_relationship_types t WHERE t.tenant_id = a.tenant_id AND t.account_id = a.id
              AND t.relationship_type = 'VENDOR') AS vendor
         FROM eos_crm.accounts a WHERE a.tenant_id = $1 AND a.id = $2 FOR SHARE`, [actor.tenantId, i.crmAccountId]);
    if (!acct[0]) refuse("ORGANIZATION_NOT_FOUND", "NOT_FOUND", "no CRM organization with that id");
    if (acct[0].status !== "ACTIVE") refuse("ORGANIZATION_NOT_ACTIVE", "PRECONDITION_FAILED", "the CRM organization is not ACTIVE");
    if (!acct[0].vendor) refuse("ORGANIZATION_NOT_VENDOR", "PRECONDITION_FAILED", "the CRM organization is not governed as a VENDOR");
    const name = String(acct[0].name);
    const cols = [...fields.keys()].map((k) => SUPPLIER_OPERATIONAL_FIELDS[k]);
    try {
      const { rows } = await c.query(
        `INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, crm_account_id, created_by, updated_by${cols.map((x) => `, ${x}`).join("")})
         VALUES ($1,$2,$3,$4,'ACTIVE',1,$5,$6,$6${cols.map((_, n) => `,$${7 + n}`).join("")}) RETURNING *`,
        [actor.tenantId, i.supplierId, name, normalizeSupplierName(name), i.crmAccountId, actor.principalId, ...fields.values()]);
      await audit(c, actor, "supplier.create", i.supplierId as string, null, { ...view(rows[0]), fingerprint }, "supplier relationship created for a CRM vendor organization");
      return { outcome: "created" as const, supplier: view(rows[0]) };
    } catch (err) {
      if ((err as { code?: string; constraint?: string }).code === "23505" && (err as { constraint?: string }).constraint === "suppliers_one_profile_per_organization") {
        refuse("ORGANIZATION_ALREADY_HAS_SUPPLIER", "CONFLICT", "that CRM organization already has a supplier relationship");
      }
      throw err;
    }
  });
}

/** UPDATE the supplier-specific operational fields (never the organization link, never the organization's identity). */
export async function updateSupplier(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_MANAGE_CAPABILITY);
  const i = acceptOnly(input, ["supplierId", "expectedVersion", ...Object.keys(SUPPLIER_OPERATIONAL_FIELDS)]);
  if (typeof i.supplierId !== "string" || !SUPPLIER_ID_PATTERN.test(i.supplierId)) refuse("SUPPLIER_ID_INVALID", "INVALID_INPUT", "supplierId is required");
  if (!Number.isSafeInteger(i.expectedVersion)) refuse("EXPECTED_VERSION_REQUIRED", "INVALID_INPUT", "expectedVersion is required");
  const fields = operationalFields(i);
  if (fields.size === 0) refuse("NOTHING_TO_UPDATE", "INVALID_INPUT", "state at least one operational field");
  return inTransaction(deps.pool, async (c) => {
    const { rows } = await c.query(`SELECT * FROM eos_ops.suppliers WHERE tenant_id = $1 AND supplier_id = $2 FOR UPDATE`, [actor.tenantId, i.supplierId]);
    if (!rows[0]) refuse("SUPPLIER_NOT_FOUND", "NOT_FOUND", "no supplier with that id");
    if (Number(rows[0].version) !== i.expectedVersion) refuse("STALE_VERSION", "CONFLICT", "the supplier changed since it was read");
    const sets = [...fields.keys()].map((k, n) => `${SUPPLIER_OPERATIONAL_FIELDS[k]} = $${4 + n}`);
    const { rows: after } = await c.query(
      `UPDATE eos_ops.suppliers SET ${sets.join(", ")}, version = version + 1, updated_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND supplier_id = $2 RETURNING *`, [actor.tenantId, i.supplierId, actor.principalId, ...fields.values()]);
    await audit(c, actor, "supplier.update", i.supplierId as string, view(rows[0]), view(after[0]), "supplier operational fields updated");
    return { outcome: "updated" as const, supplier: view(after[0]) };
  });
}

/** ACTIVATE / DEACTIVATE (never delete). Deactivation takes the supplier off every new-PO selection; history stays. */
export async function setSupplierStatus(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_STATUS_CAPABILITY);
  const i = acceptOnly(input, ["supplierId", "status", "expectedVersion", "reason"]);
  if (typeof i.supplierId !== "string" || !SUPPLIER_ID_PATTERN.test(i.supplierId)) refuse("SUPPLIER_ID_INVALID", "INVALID_INPUT", "supplierId is required");
  if (i.status !== "ACTIVE" && i.status !== "INACTIVE") refuse("STATUS_INVALID", "INVALID_INPUT", "status is ACTIVE or INACTIVE");
  if (!Number.isSafeInteger(i.expectedVersion)) refuse("EXPECTED_VERSION_REQUIRED", "INVALID_INPUT", "expectedVersion is required");
  if (typeof i.reason !== "string" || i.reason.trim() === "" || i.reason.length > 500) refuse("REASON_REQUIRED", "INVALID_INPUT", "a status change states why");
  return inTransaction(deps.pool, async (c) => {
    const { rows } = await c.query(`SELECT * FROM eos_ops.suppliers WHERE tenant_id = $1 AND supplier_id = $2 FOR UPDATE`, [actor.tenantId, i.supplierId]);
    if (!rows[0]) refuse("SUPPLIER_NOT_FOUND", "NOT_FOUND", "no supplier with that id");
    if (rows[0].status === i.status) return { outcome: "unchanged" as const, supplier: view(rows[0]) };
    if (Number(rows[0].version) !== i.expectedVersion) refuse("STALE_VERSION", "CONFLICT", "the supplier changed since it was read");
    const { rows: after } = await c.query(
      `UPDATE eos_ops.suppliers SET status = $3::eos_ops.ops_supplier_status, version = version + 1, updated_by = $4, updated_at = now()
        WHERE tenant_id = $1 AND supplier_id = $2 RETURNING *`, [actor.tenantId, i.supplierId, i.status, actor.principalId]);
    await audit(c, actor, i.status === "ACTIVE" ? "supplier.activate" : "supplier.deactivate", i.supplierId as string, view(rows[0]), view(after[0]), (i.reason as string).trim());
    return { outcome: i.status === "ACTIVE" ? "activated" as const : "deactivated" as const, supplier: view(after[0]) };
  });
}

/** The CRM organizations a NEW supplier may be created for: ACTIVE, governed as a VENDOR, with no supplier yet. By name. */
export async function listSupplierOrganizationOptions(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_MANAGE_CAPABILITY);
  acceptOnly(input, []);
  const { rows } = await deps.pool.query(
    `SELECT a.id, a.name FROM eos_crm.accounts a
      WHERE a.tenant_id = $1 AND a.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM eos_crm.account_relationship_types t WHERE t.tenant_id = a.tenant_id AND t.account_id = a.id AND t.relationship_type = 'VENDOR')
        AND NOT EXISTS (SELECT 1 FROM eos_ops.suppliers s WHERE s.tenant_id = a.tenant_id AND s.crm_account_id = a.id)
      ORDER BY a.name, a.id LIMIT 500`, [actor.tenantId]);
  return { items: rows.map((r) => ({ crmAccountId: String(r.id), name: String(r.name) })) };
}
