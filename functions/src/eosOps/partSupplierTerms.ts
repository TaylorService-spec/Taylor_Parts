// GOVERNED PART-SUPPLIER TERMS MAINTENANCE in PostgreSQL (remediation SUP-1). The governed command layer over
// eos_ops.supplier_catalog_items -- the procurement terms ONE Supplier offers for ONE Part (supplier SKU, unit cost,
// currency, lead time, minimum order quantity, order multiple, purchase unit + conversion to the stocking unit, contract
// window, availability) and which supplier is the Part's PREFERRED one.
//
// WHY IT EXISTS. Firebase retirement F2 removed the four callables that maintained these terms (createPartSupplierItem,
// updatePartSupplierItem, changePartSupplierItemStatus, setPreferredSupplier -- functions/src/partMaster/
// partSupplierItems.ts and partSupplierItemCallables.ts before 322db5b5). Their PostgreSQL replacement was a REPOSITORY
// only (supplierCatalogRepository.ts: "NO AUTHORIZATION" by design), with no command, no audit and no route, so nobody
// could maintain the terms at all. This module is the missing layer: capability check, one transaction, the audit row in
// that SAME transaction, idempotent replay. The repository stays the only thing that writes the table.
//
// AUTHORITY -- NARROW RECORD CAPABILITIES (Owner direction 2026-10-12, DECISIONS #230). Supplier terms are their own
// governed record on the Object `supplierCatalogItem`, with four record keys (migration 1764530000000, granted to NO Role):
//   inventory.supplierTerms.read          READ             list one Part's terms -- the RECORD DOORWAY
//   inventory.supplierTerms.create        CREATE           add terms (also needs inventory.catalog.cost.create: cost and
//                                                          currency are NOT NULL)
//   inventory.supplierTerms.edit          EDIT             change relationship / ordering terms; set the preferred supplier
//   inventory.supplierTerms.changeStatus  BUSINESS_ACTION  activate / deactivate (as Part activation is a BUSINESS_ACTION)
// Nothing here depends on inventory.catalog.manage or inventory.catalog.activate any more: the Owner directed that broad
// catalog maintenance must not be granted merely so a Purchasing Manager can maintain supplier terms. Who holds which key
// is an Administration decision; the PROPOSED (not executed) grants are in docs/architecture/governed-field-groups.md.
// Protected Administrator standing implies inventory.supplierTerms.read (a READ, DECISIONS #223) and nothing else here:
// create / edit / changeStatus are business actions on a business Object, and the three COMMERCIAL keys are
// PROTECTED_ADMINISTRATOR_EXCLUSIONS. No operating-company scope: the table carries none (migration 1758499200000). No
// Firebase.
//
// AUDIT. Every successful write is ONE eos_policy.audit_events row (target_kind 'part_supplier_item', before/after) in
// the write's own transaction. A refusal writes nothing and is NOT audited here -- denial auditing is a separate,
// Owner-approved workstream. A replayed or unchanged answer changed nothing and is not audited either.
//
// GOVERNED FIELD GROUPS (EOS Core, docs/architecture/governed-field-groups.md; DECISIONS #210 / #230; r1 Owner ruling
// 2026-08-07). The item's fields are three groups evaluated by the GENERIC eosOps/governedFieldGroups.ts against the
// caller's resolved capability Set (the additive union of every Role they hold):
//   RELATIONSHIP  identity, supplier, SKU, status, preference   read supplierTerms.read, create .create, edit .edit
//   OPERATIONAL   lead time, availability, ordering constraints  read supplierTerms.read, create .create, edit .edit
//   COMMERCIAL    cost, currency, contractStart, contractEnd     SENSITIVE:
//                   read   inventory.supplierTerms.read AND inventory.catalog.read AND inventory.catalog.cost.read (r1)
//                   create inventory.catalog.cost.create
//                   edit   inventory.catalog.cost.edit
// What that means on every surface:
//   * every response (list, every write echo, replay, unchanged) is projectForCaller: an unreadable group's fields are
//     ABSENT and `withheld` names the group and the keys it needs -- never a value. A caller who may write but not READ
//     the record (e.g. changeStatus alone) gets the minimal { itemId, status, version } echo (security review N1);
//   * a write naming a field of a group the caller may not create / edit is refused FIELD_GROUP_FORBIDDEN before any read;
//   * no answer is decided by the equality of a group the caller cannot read: create replay becomes ITEM_ALREADY_EXISTS,
//     an update's stated unreadable values are applied unconditionally (a version bump, never NO_CHANGES / replay), and
//     a blind contract-window change must state BOTH ends so no refusal depends on a stored date;
//   * audit rows hold COMMERCIAL values as { withheld: true } and name the changed COMMERCIAL fields only (the ACCEPTED
//     version-change metadata disclosure, Owner direction 2026-10-12: THAT a restricted field changed, never its value);
//   * the four COMMERCIAL fields are reportable: false in the Object definition, so no report or export carries them;
//   * supplierOptions (who terms can be created for) only for a caller who may create them (supplierTerms.create AND
//     cost.create).
// No Role, persona or title is read anywhere. TENANT isolation is the boundary.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { ReorderLifecycleError, type ReorderActor } from "./reorderLifecycleCommands.js";
import { withActorAuthority } from "./administrationReach.js";
import { isCanonicalPartId } from "./migration/partIdContract.js";
import {
  AVAILABILITY_STATES,
  SupplierCatalogRepositoryError,
  createSupplierCatalogItem,
  listSupplierCatalogItemsForPart,
  readSupplierCatalogItem,
  setPreferredSupplierWithin,
  setSupplierCatalogItemStatus,
  updateSupplierCatalogItem,
  type AvailabilityState,
  type PurchaseConversion,
  type SupplierCatalogItemRecord,
  type SupplierCatalogItemTermsPatch,
} from "./supplierCatalogRepository.js";
import { areUnitsCompatible, isUnitCode } from "../partMaster/units.js";
import {
  GovernedFieldGroupError,
  assertWritable,
  auditSafe,
  canReadAllGroups,
  defineFieldGroups,
  fieldAccessFor,
  groupOf,
  projectForCaller,
  recordAccessFor,
  sensitiveFieldsChanged,
} from "./governedFieldGroups.js";
import type { UnitCode } from "../partMaster/types.js";

/** The four RECORD keys of supplierCatalogItem (migration 1764530000000; registered, granted to NO Role). */
export const SUPPLIER_TERMS_READ_CAPABILITY = "inventory.supplierTerms.read";
export const SUPPLIER_TERMS_CREATE_CAPABILITY = "inventory.supplierTerms.create";
export const SUPPLIER_TERMS_EDIT_CAPABILITY = "inventory.supplierTerms.edit";
export const SUPPLIER_TERMS_STATUS_CAPABILITY = "inventory.supplierTerms.changeStatus";
/** r1 (Owner 2026-08-07): basic governed catalog visibility -- part of the COMMERCIAL read. */
export const CATALOG_READ_CAPABILITY = "inventory.catalog.read";
/** The COMMERCIAL field group's three keys (migration 1764530000000; registered, granted to NO Role). */
export const COMMERCIAL_READ_CAPABILITY = "inventory.catalog.cost.read";
export const COMMERCIAL_CREATE_CAPABILITY = "inventory.catalog.cost.create";
export const COMMERCIAL_EDIT_CAPABILITY = "inventory.catalog.cost.edit";

/** The supplierCatalogItem Object: its record doorway and its governed field groups. */
export const PART_SUPPLIER_TERMS_FIELD_GROUPS = defineFieldGroups({
  objectKey: "supplierCatalogItem",
  record: { read: SUPPLIER_TERMS_READ_CAPABILITY, create: SUPPLIER_TERMS_CREATE_CAPABILITY, edit: SUPPLIER_TERMS_EDIT_CAPABILITY,
    changeStatus: SUPPLIER_TERMS_STATUS_CAPABILITY },
  groups: [
    { key: "RELATIONSHIP", label: "Supplier relationship", sensitive: false,
      read: SUPPLIER_TERMS_READ_CAPABILITY, create: SUPPLIER_TERMS_CREATE_CAPABILITY, edit: SUPPLIER_TERMS_EDIT_CAPABILITY,
      fields: ["itemId", "partId", "supplierId", "supplierName", "supplierStatus", "supplierSku", "status", "preferred", "version"] },
    { key: "OPERATIONAL", label: "Ordering terms", sensitive: false,
      read: SUPPLIER_TERMS_READ_CAPABILITY, create: SUPPLIER_TERMS_CREATE_CAPABILITY, edit: SUPPLIER_TERMS_EDIT_CAPABILITY,
      fields: ["leadTimeDays", "availability", "minOrderQty", "orderMultiple", "purchaseUnit", "conversionToStockingUnit", "lastVerifiedAt"] },
    { key: "COMMERCIAL", label: "Cost & contract terms", sensitive: true,
      read: [SUPPLIER_TERMS_READ_CAPABILITY, CATALOG_READ_CAPABILITY, COMMERCIAL_READ_CAPABILITY],
      create: COMMERCIAL_CREATE_CAPABILITY, edit: COMMERCIAL_EDIT_CAPABILITY,
      fields: ["cost", "currency", "contractStart", "contractEnd"] },
  ],
});

/** supplierMasterTypes.ts SUPPLIER_ID_PATTERN (restated in supplierAdministration.ts and the repository the same way). */
const SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** `<partId>__<supplierId>`, the table's GENERATED item_id. Both halves share the governed id alphabet. */
const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}__[A-Za-z0-9_-]{1,64}$/;

// ════════════════════ the procurement terms: the Firebase rules, ported ════════════════════
//
// Ported from partSupplierItems.ts validateSupplierItemTerms (git show 322db5b5^:functions/src/partMaster/
// partSupplierItems.ts, ~L104-180) and createPartSupplierItem's unit-family check (~L319-326). Same field names, same
// limits, same patterns. Three additions, each a statement the PostgreSQL columns already make, refused HERE so the
// employee gets the field name instead of a constraint name: a decimal fits NUMERIC(19,4) (at most 15 integer digits); a
// contract date is a real calendar date; and the contract window is checked against the MERGED record on update (the
// table's CHECK holds the merged row, not the change set). On update an optional term may be cleared with null (the
// Firebase merge could not clear one); required terms never.
export const PART_SUPPLIER_TERM_KEYS = Object.freeze([
  "supplierSku", "cost", "currency", "leadTimeDays", "minOrderQty", "orderMultiple", "purchaseUnit", "conversionToStockingUnit",
  "contractStart", "contractEnd", "availability", "lastVerifiedAt",
] as const);
type TermKey = (typeof PART_SUPPLIER_TERM_KEYS)[number];

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_PATTERN = /^\d+(\.\d{1,4})?$/; // procurement decimals as strings -- never floats
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** The instant exactly as the repository renders last_verified_at back: UTC, whole seconds. */
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MAX_INTEGER_DIGITS = 15; // NUMERIC(19, 4)
const MAX_INT4 = 2_147_483_647;

/** The validated terms of one request. A key is present only when the request stated it; null means "clear it". */
export interface PartSupplierTerms {
  supplierSku?: string;
  cost?: string;
  currency?: string;
  leadTimeDays?: number;
  minOrderQty?: string | null;
  orderMultiple?: string | null;
  conversion?: PurchaseConversion | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  availability?: AvailabilityState;
  lastVerifiedAt?: string | null;
}

const refuse = (code: string, category: "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "PRECONDITION_FAILED" | "CONFLICT", message: string): never => {
  throw new ReorderLifecycleError(code, category, message);
};

/** A decimal in its one comparable spelling: no leading zeros, no trailing fractional zeros ("012.5000" -> "12.5"). */
export function canonicalDecimal(value: string): string {
  const [whole, frac = ""] = value.split(".");
  const w = whole.replace(/^0+(?=\d)/, "");
  const f = frac.replace(/0+$/, "");
  return f === "" ? w : `${w}.${f}`;
}
const decimalOrNull = (v: string | null | undefined): string | null => (v === null || v === undefined ? null : canonicalDecimal(v));

function isCalendarDate(value: string): boolean {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Validate the term fields of one request. `create` requires the four core terms and refuses null; an update accepts
 * any subset and null clears an optional term. Unknown fields are refused by the caller's acceptOnly, not here.
 */
export function validatePartSupplierTerms(raw: Record<string, unknown>, mode: "create" | "update"): PartSupplierTerms {
  const out: PartSupplierTerms = {};
  const has = (k: TermKey) => Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined;
  const clearing = (k: TermKey) => has(k) && raw[k] === null;
  const required = (k: TermKey, code: string) => {
    if (mode === "create" && !has(k)) refuse(code, "INVALID_INPUT", `${k} is required`);
    if (clearing(k)) refuse(code, "INVALID_INPUT", `${k} is required and cannot be cleared`);
  };
  const optionalNull = (k: TermKey, code: string): boolean => {
    if (!clearing(k)) return false;
    if (mode === "create") refuse(code, "INVALID_INPUT", `${k} is omitted, not null, on create`);
    return true;
  };
  const decimal = (k: TermKey, code: string, positive: boolean): string => {
    const v = raw[k];
    if (typeof v !== "string" || !DECIMAL_PATTERN.test(v) || (positive && Number(v) <= 0)) {
      refuse(code, "INVALID_INPUT", positive ? `${k} must be a positive decimal string (max 4 dp)` : `${k} must be a decimal string (max 4 dp)`);
    }
    if ((v as string).split(".")[0].replace(/^0+(?=\d)/, "").length > MAX_INTEGER_DIGITS) {
      refuse(code, "INVALID_INPUT", `${k} has more than ${MAX_INTEGER_DIGITS} integer digits`);
    }
    return v as string;
  };

  required("supplierSku", "SUPPLIER_SKU_INVALID");
  if (has("supplierSku")) {
    const v = raw.supplierSku;
    if (typeof v !== "string" || v.trim().length === 0 || v.length > 120) refuse("SUPPLIER_SKU_INVALID", "INVALID_INPUT", "supplierSku must be a non-empty string (max 120)");
    out.supplierSku = (v as string).trim();
  }
  required("cost", "COST_INVALID");
  if (has("cost")) out.cost = decimal("cost", "COST_INVALID", false);
  required("currency", "CURRENCY_INVALID");
  if (has("currency")) {
    if (typeof raw.currency !== "string" || !CURRENCY_PATTERN.test(raw.currency)) refuse("CURRENCY_INVALID", "INVALID_INPUT", "currency must be 3 uppercase letters");
    out.currency = raw.currency as string;
  }
  required("leadTimeDays", "LEAD_TIME_INVALID");
  if (has("leadTimeDays")) {
    const v = raw.leadTimeDays;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 3650) refuse("LEAD_TIME_INVALID", "INVALID_INPUT", "leadTimeDays must be an integer 0..3650");
    out.leadTimeDays = v as number;
  }
  for (const [k, code] of [["minOrderQty", "MIN_ORDER_QTY_INVALID"], ["orderMultiple", "ORDER_MULTIPLE_INVALID"]] as const) {
    if (optionalNull(k, code)) out[k] = null;
    else if (has(k)) out[k] = decimal(k, code, true);
  }
  // purchaseUnit and its conversion travel together, exactly as Firebase required ("purchaseUnit requires
  // conversionToStockingUnit") and as the table's all-or-none CHECK states. Both null clears the pair.
  if (has("purchaseUnit") || has("conversionToStockingUnit")) {
    if (clearing("purchaseUnit") && (clearing("conversionToStockingUnit") || !has("conversionToStockingUnit"))) {
      optionalNull("purchaseUnit", "PURCHASE_UNIT_INVALID");
      out.conversion = null;
    } else {
      if (!isUnitCode(raw.purchaseUnit)) refuse("PURCHASE_UNIT_INVALID", "INVALID_INPUT", "purchaseUnit must be a known unit code");
      const f = raw.conversionToStockingUnit as { numerator?: unknown; denominator?: unknown } | null | undefined;
      if (f === undefined || f === null || typeof f !== "object" || Array.isArray(f)) {
        refuse("CONVERSION_REQUIRED", "INVALID_INPUT", "purchaseUnit requires conversionToStockingUnit");
      }
      const keys = Object.keys(f as object).sort();
      if (keys.join(",") !== "denominator,numerator") refuse("CONVERSION_INVALID", "INVALID_INPUT", "conversionToStockingUnit is { numerator, denominator }");
      for (const part of [f!.numerator, f!.denominator]) {
        if (!Number.isInteger(part) || (part as number) <= 0 || (part as number) > MAX_INT4) {
          refuse("CONVERSION_INVALID", "INVALID_INPUT", "conversion factor must be a positive integer ratio");
        }
      }
      out.conversion = { purchaseUnit: raw.purchaseUnit as string, numerator: f!.numerator as number, denominator: f!.denominator as number };
    }
  }
  for (const k of ["contractStart", "contractEnd"] as const) {
    if (optionalNull(k, "CONTRACT_DATE_INVALID")) { out[k] = null; continue; }
    if (!has(k)) continue;
    const v = raw[k];
    if (typeof v !== "string" || !ISO_DATE_PATTERN.test(v) || !isCalendarDate(v)) refuse("CONTRACT_DATE_INVALID", "INVALID_INPUT", `${k} must be YYYY-MM-DD`);
    out[k] = v as string;
  }
  if (typeof out.contractStart === "string" && typeof out.contractEnd === "string" && out.contractStart > out.contractEnd) {
    refuse("CONTRACT_WINDOW_INVALID", "INVALID_INPUT", "contractEnd must not precede contractStart");
  }
  if (clearing("availability")) refuse("AVAILABILITY_INVALID", "INVALID_INPUT", "availability cannot be cleared");
  if (has("availability")) {
    if (!(AVAILABILITY_STATES as readonly unknown[]).includes(raw.availability)) {
      refuse("AVAILABILITY_INVALID", "INVALID_INPUT", `availability must be ${AVAILABILITY_STATES.join("/")}`);
    }
    out.availability = raw.availability as AvailabilityState;
  }
  if (optionalNull("lastVerifiedAt", "LAST_VERIFIED_INVALID")) out.lastVerifiedAt = null;
  else if (has("lastVerifiedAt")) {
    const v = raw.lastVerifiedAt;
    if (typeof v !== "string" || !ISO_INSTANT_PATTERN.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 19) + "Z" !== v) {
      refuse("LAST_VERIFIED_INVALID", "INVALID_INPUT", "lastVerifiedAt must be a UTC instant YYYY-MM-DDTHH:MM:SSZ");
    }
    out.lastVerifiedAt = v as string;
  }
  return out;
}

// ════════════════════ shared plumbing (supplierAdministration.ts's shapes) ════════════════════

function requireCapability(actor: ReorderActor, key: string): void {
  if (!actor || !(actor.capabilities instanceof Set) || !actor.capabilities.has(key)) refuse("CAPABILITY_MISSING", "FORBIDDEN", `part-supplier terms require ${key}`);
}
/** Can this caller READ the COMMERCIAL group? (The same decision projectForCaller makes.) */
function canReadCommercial(actor: ReorderActor): boolean {
  return fieldAccessFor(PART_SUPPLIER_TERMS_FIELD_GROUPS, actor.capabilities).COMMERCIAL.read;
}
/** Can this caller READ the group that governs this request term key? (`conversion` is the purchase-unit pair.) */
function canReadTerm(actor: ReorderActor, k: string): boolean {
  const g = groupOf(PART_SUPPLIER_TERMS_FIELD_GROUPS, k === "conversion" ? "purchaseUnit" : k);
  return g !== null && fieldAccessFor(PART_SUPPLIER_TERMS_FIELD_GROUPS, actor.capabilities)[g.key].read;
}
/** The governed field-group refusal, in this transport's shape: the reason code + names and keys only, never a value. */
function requireWritable(actor: ReorderActor, mode: "create" | "edit", fieldKeys: readonly string[]): void {
  try {
    assertWritable(PART_SUPPLIER_TERMS_FIELD_GROUPS, actor.capabilities, mode, fieldKeys);
  } catch (err) {
    if (!(err instanceof GovernedFieldGroupError)) throw err;
    throw new ReorderLifecycleError(err.code, err.category, err.message, { refusal: err.code, ...err.details });
  }
}
/**
 * One item as THIS caller may see it. A caller who may not READ the record at all (a writer without the doorway, e.g.
 * changeStatus alone) learns only that the write happened: the minimal { itemId, status, version } echo (review N1).
 */
function project(actor: ReorderActor, item: ItemView) {
  if (!actor.capabilities.has(SUPPLIER_TERMS_READ_CAPABILITY)) return { itemId: item.itemId, status: item.status, version: item.version };
  return projectForCaller(PART_SUPPLIER_TERMS_FIELD_GROUPS, actor.capabilities, item);
}
/** One item as an audit row may hold it: COMMERCIAL values replaced by { withheld: true }. */
function auditView(item: ItemView | null) {
  return auditSafe(PART_SUPPLIER_TERMS_FIELD_GROUPS, item);
}

function acceptOnly(input: Record<string, unknown> | undefined, allowed: readonly string[]): Record<string, unknown> {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const extra = Object.keys(i).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  return i;
}
function requirePartId(value: unknown): string {
  if (!isCanonicalPartId(value)) refuse("PART_ID_INVALID", "INVALID_INPUT", "partId must be a canonical part id");
  return value as string;
}
function requireItemId(value: unknown): string {
  if (typeof value !== "string" || !ITEM_ID_PATTERN.test(value)) refuse("ITEM_ID_INVALID", "INVALID_INPUT", "itemId is required");
  return value as string;
}
function requireExpectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) refuse("EXPECTED_VERSION_REQUIRED", "INVALID_INPUT", "expectedVersion is required");
  return value as number;
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
async function withReadSnapshot<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
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
async function audit(c: PoolClient, actor: ReorderActor, action: string, itemId: string, before: unknown, after: unknown, reason: string) {
  await c.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1,$2,$3,$4,'part_supplier_item',$5,$6::jsonb,$7::jsonb,now(),$8)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, itemId, before === null ? null : JSON.stringify(before),
      JSON.stringify(await withActorAuthority(c, actor.tenantId, actor.principalId, after)), reason]);
}

/** The repository's refusals, in this transport's categories. Anything else is a fault and surfaces as INTERNAL. */
async function repository<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof SupplierCatalogRepositoryError)) throw err;
    switch (err.code) {
      case "VERSION_CONFLICT": return refuse("STALE_VERSION", "CONFLICT", "the supplier terms changed since they were read");
      case "ITEM_NOT_FOUND": return refuse("ITEM_NOT_FOUND", "NOT_FOUND", "no supplier terms with that id for this part");
      case "ITEM_NOT_ACTIVE": return refuse("ITEM_NOT_ACTIVE", "PRECONDITION_FAILED", "only ACTIVE supplier terms can be preferred");
      case "SUPPLIER_NOT_FOUND": return refuse("SUPPLIER_NOT_FOUND", "NOT_FOUND", "no supplier with that id");
      case "ALREADY_EXISTS": return refuse("ITEM_ALREADY_EXISTS", "CONFLICT", "this supplier already has terms for this part");
      case "PREFERRED_ALREADY_SET": return refuse("PREFERRED_CONFLICT", "CONFLICT", "another supplier became preferred at the same time; reload and retry");
      default: return refuse(err.code, "INVALID_INPUT", err.message);
    }
  }
}

interface SupplierFacts { readonly name: string; readonly status: string }
async function supplierFacts(c: PoolClient, tenantId: string, supplierId: string, lock = false): Promise<SupplierFacts | null> {
  const { rows } = await c.query(
    `SELECT name, status::text AS status FROM eos_ops.suppliers WHERE tenant_id = $1 AND supplier_id = $2${lock ? " FOR SHARE" : ""}`,
    [tenantId, supplierId]);
  return rows[0] ? { name: String(rows[0].name), status: String(rows[0].status) } : null;
}
async function partStockingUnit(c: PoolClient, tenantId: string, partId: string, lock = false): Promise<UnitCode | null> {
  const { rows } = await c.query(
    `SELECT stocking_unit::text AS stocking_unit FROM eos_ops.parts WHERE tenant_id = $1 AND id = $2${lock ? " FOR SHARE" : ""}`, [tenantId, partId]);
  return rows[0] ? (String(rows[0].stocking_unit) as UnitCode) : null;
}
/** Lock ONE item by its id and read it through the repository; null when this tenant has no such item. */
async function lockItem(c: PoolClient, tenantId: string, itemId: string): Promise<SupplierCatalogItemRecord | null> {
  const { rows } = await c.query(
    `SELECT part_id, supplier_id FROM eos_ops.supplier_catalog_items WHERE tenant_id = $1 AND item_id = $2 FOR UPDATE`, [tenantId, itemId]);
  if (!rows[0]) return null;
  return readSupplierCatalogItem(c, tenantId, String(rows[0].part_id), String(rows[0].supplier_id));
}
function requireCompatibleUnit(conversion: PurchaseConversion | null | undefined, stockingUnit: UnitCode): void {
  // partSupplierItems.ts PR 1.5: the purchase unit must share the part's stocking-unit family. Firebase checked it on
  // create only; the same rule now holds on update too, so an edit cannot reach a pairing a create would refuse.
  if (conversion && !areUnitsCompatible(conversion.purchaseUnit as UnitCode, stockingUnit)) {
    refuse("PURCHASE_UNIT_INCOMPATIBLE", "INVALID_INPUT", `purchaseUnit ${conversion.purchaseUnit} is not in the family of the part's stocking unit ${stockingUnit}`);
  }
}

/** What an employee sees of one item. Decimals in their canonical spelling; the supplier by name. */
function view(r: SupplierCatalogItemRecord, supplier: SupplierFacts | null) {
  return Object.freeze({
    itemId: r.itemId, partId: r.partId, supplierId: r.supplierId,
    supplierName: supplier?.name ?? r.supplierId, supplierStatus: supplier?.status ?? null,
    supplierSku: r.supplierSku, cost: canonicalDecimal(String(r.cost)), currency: r.currency, leadTimeDays: Number(r.leadTimeDays),
    minOrderQty: decimalOrNull(r.minOrderQty), orderMultiple: decimalOrNull(r.orderMultiple),
    purchaseUnit: r.conversion?.purchaseUnit ?? null,
    conversionToStockingUnit: r.conversion ? { numerator: Number(r.conversion.numerator), denominator: Number(r.conversion.denominator) } : null,
    contractStart: r.contractStart, contractEnd: r.contractEnd, availability: r.availability, lastVerifiedAt: r.lastVerifiedAt,
    preferred: r.preferred, status: r.status, version: Number(r.version),
  });
}
type ItemView = ReturnType<typeof view>;

/** The comparable value of each term, from a stored item. */
function storedTerm(r: ItemView, k: keyof PartSupplierTerms): unknown {
  switch (k) {
    case "conversion": return r.purchaseUnit === null ? null : `${r.purchaseUnit}:${r.conversionToStockingUnit!.numerator}/${r.conversionToStockingUnit!.denominator}`;
    default: return r[k];
  }
}
/** The comparable value of each term, from a validated request. */
function requestedTerm(t: PartSupplierTerms, k: keyof PartSupplierTerms): unknown {
  const v = t[k];
  if (v === null || v === undefined) return null;
  switch (k) {
    case "cost": case "minOrderQty": case "orderMultiple": return canonicalDecimal(v as string);
    case "conversion": { const c = v as PurchaseConversion; return `${c.purchaseUnit}:${c.numerator}/${c.denominator}`; }
    default: return v;
  }
}
const TERMS: readonly (keyof PartSupplierTerms)[] = ["supplierSku", "cost", "currency", "leadTimeDays", "minOrderQty", "orderMultiple",
  "conversion", "contractStart", "contractEnd", "availability", "lastVerifiedAt"];

// ════════════════════ the five operations ════════════════════

/**
 * READ: every supplier's terms for one Part, INACTIVE included (an employee must see why re-adding a supplier conflicts),
 * preferred first, each with its supplier's name -- plus the ACTIVE suppliers that have no terms for this Part yet, the
 * only ones "Add supplier terms" can name. inventory.supplierTerms.read (the record doorway). Every item is projected for
 * the caller (COMMERCIAL withheld without inventory.catalog.read + .cost.read), `fieldAccess` states the caller's
 * per-group decision, `recordAccess` the record actions (create / edit / changeStatus) the screen may offer, and
 * supplierOptions is null unless the caller may create terms (supplierTerms.create AND cost.create).
 */
export async function listPartSupplierItems(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_TERMS_READ_CAPABILITY);
  const i = acceptOnly(input, ["partId"]);
  const partId = requirePartId(i.partId);
  return withReadSnapshot(deps.pool, async (c) => {
    const stockingUnit = await partStockingUnit(c, actor.tenantId, partId);
    if (stockingUnit === null) refuse("PART_NOT_FOUND", "NOT_FOUND", "no part with that id");
    const records = await listSupplierCatalogItemsForPart(c, actor.tenantId, partId);
    const { rows: suppliers } = await c.query(
      `SELECT supplier_id, name, status::text AS status FROM eos_ops.suppliers WHERE tenant_id = $1 AND supplier_id = ANY($2::text[])`,
      [actor.tenantId, records.map((r) => r.supplierId)]);
    const byId = new Map(suppliers.map((s) => [String(s.supplier_id), { name: String(s.name), status: String(s.status) }]));
    const items = records.map((r) => view(r, byId.get(r.supplierId) ?? null))
      .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.supplierName.localeCompare(b.supplierName) || a.supplierId.localeCompare(b.supplierId))
      .map((item) => project(actor, item));
    const fieldAccess = fieldAccessFor(PART_SUPPLIER_TERMS_FIELD_GROUPS, actor.capabilities);
    const recordAccess = recordAccessFor(PART_SUPPLIER_TERMS_FIELD_GROUPS, actor.capabilities);
    // The ACTIVE supplier directory is what "Add supplier terms" picks from -- offered only to a caller who may create
    // terms at all (the record key, and the COMMERCIAL create key because cost / currency are mandatory).
    if (!recordAccess.create || !fieldAccess.COMMERCIAL.create) {
      return { partId, stockingUnit, fieldAccess, recordAccess, items, supplierOptions: null,
        supplierOptionsWithheld: { reason: "adding supplier terms needs the add permission and sets cost & contract terms",
          requires: [SUPPLIER_TERMS_CREATE_CAPABILITY, COMMERCIAL_CREATE_CAPABILITY] } };
    }
    const { rows: options } = await c.query(
      `SELECT s.supplier_id, s.name FROM eos_ops.suppliers s
        WHERE s.tenant_id = $1 AND s.status = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM eos_ops.supplier_catalog_items i WHERE i.tenant_id = s.tenant_id AND i.supplier_id = s.supplier_id AND i.part_id = $2)
        ORDER BY s.name, s.supplier_id LIMIT 500`, [actor.tenantId, partId]);
    return { partId, stockingUnit, fieldAccess, recordAccess, items, supplierOptions: options.map((o) => ({ supplierId: String(o.supplier_id), name: String(o.name) })) };
  });
}

/**
 * CREATE one supplier's terms for one Part. The Part must exist; the supplier must exist and be ACTIVE; one item per
 * (part, supplier). Never preferred on create (preference is granted only by setPreferredPartSupplierItem). The same
 * request again is REPLAYED (content-addressed: the stored terms equal the requested ones); different terms for an
 * existing pair are a CONFLICT, never an overwrite. inventory.supplierTerms.create; cost and currency are mandatory, so
 * creating terms needs inventory.catalog.cost.create too (refused before anything is read). A caller who cannot READ
 * every group is never answered by the content-addressed replay -- that would confirm stored values they cannot see --
 * so an existing pair is ITEM_ALREADY_EXISTS.
 */
export async function createPartSupplierItem(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_TERMS_CREATE_CAPABILITY);
  const i = acceptOnly(input, ["partId", "supplierId", ...PART_SUPPLIER_TERM_KEYS]);
  requireWritable(actor, "create", [...new Set([...Object.keys(i), "cost", "currency"])]);
  const partId = requirePartId(i.partId);
  if (typeof i.supplierId !== "string" || !SUPPLIER_ID_PATTERN.test(i.supplierId)) refuse("SUPPLIER_ID_INVALID", "INVALID_INPUT", "supplierId is 1-64 letters, digits, '-' or '_'");
  const supplierId = i.supplierId as string;
  const terms = validatePartSupplierTerms(i, "create");
  const full: PartSupplierTerms = { minOrderQty: null, orderMultiple: null, conversion: null, contractStart: null, contractEnd: null,
    availability: "UNKNOWN", lastVerifiedAt: null, ...terms };
  return inTransaction(deps.pool, async (c) => {
    const stockingUnit = await partStockingUnit(c, actor.tenantId, partId, true);
    if (stockingUnit === null) refuse("PART_NOT_FOUND", "NOT_FOUND", "no part with that id");
    const existing = await readSupplierCatalogItem(c, actor.tenantId, partId, supplierId);
    if (existing) {
      if (!canReadAllGroups(PART_SUPPLIER_TERMS_FIELD_GROUPS, actor.capabilities)) refuse("ITEM_ALREADY_EXISTS", "CONFLICT", "this supplier already has terms for this part; edit them instead");
      const stored = view(existing, await supplierFacts(c, actor.tenantId, supplierId));
      if (!TERMS.every((k) => storedTerm(stored, k) === requestedTerm(full, k))) {
        refuse("ITEM_ALREADY_EXISTS", "CONFLICT", "this supplier already has different terms for this part; edit them instead");
      }
      return { outcome: "replayed" as const, item: project(actor, stored) };
    }
    const supplier = await supplierFacts(c, actor.tenantId, supplierId, true);
    if (!supplier) refuse("SUPPLIER_NOT_FOUND", "NOT_FOUND", "no supplier with that id");
    if (supplier!.status !== "ACTIVE") refuse("SUPPLIER_NOT_ACTIVE", "PRECONDITION_FAILED", "the supplier is not ACTIVE");
    requireCompatibleUnit(full.conversion, stockingUnit!);
    const record = await repository(() => createSupplierCatalogItem(c, actor.tenantId, actor.principalId, {
      partId, supplierId, supplierSku: full.supplierSku!, cost: full.cost!, currency: full.currency!, leadTimeDays: full.leadTimeDays!,
      minOrderQty: full.minOrderQty, orderMultiple: full.orderMultiple, conversion: full.conversion, contractStart: full.contractStart,
      contractEnd: full.contractEnd, lastVerifiedAt: full.lastVerifiedAt, availability: full.availability,
    }));
    const item = view(record, supplier);
    await audit(c, actor, "partSupplierItem.create", item.itemId, null, auditView(item),
      `part-supplier terms created; cost & contract terms set: ${sensitiveFieldsChanged(PART_SUPPLIER_TERMS_FIELD_GROUPS, null, item).join(", ")}`);
    return { outcome: "created" as const, item: project(actor, item) };
  });
}

/**
 * UPDATE the procurement terms of one item at the version the caller read. Only term fields: never the part, the
 * supplier, the status or the preference. A resend of an update that already applied (stored version = expected + 1 and
 * nothing left to change) is REPLAYED, as the PostgreSQL Part Master writer answers it; a stale version is a CONFLICT;
 * a request that changes nothing is NO_CHANGES. inventory.supplierTerms.edit; changing cost / currency / contract dates
 * needs inventory.catalog.cost.edit too (refused before anything is read). "Changed" is decided over the fields the caller
 * can READ only: a stated value of a group they cannot read is applied UNCONDITIONALLY (always part of the patch -- a
 * version bump, never NO_CHANGES or a replay that would confirm the stored value), and a blind contract-window change
 * must state BOTH ends, so the window check never depends on a stored date they cannot see.
 */
export async function updatePartSupplierItem(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_TERMS_EDIT_CAPABILITY);
  const i = acceptOnly(input, ["itemId", "expectedVersion", "changes"]);
  const itemId = requireItemId(i.itemId);
  const expectedVersion = requireExpectedVersion(i.expectedVersion);
  if (!i.changes || typeof i.changes !== "object" || Array.isArray(i.changes)) refuse("CHANGES_REQUIRED", "INVALID_INPUT", "changes is an object of term fields");
  const changesIn = acceptOnly(i.changes as Record<string, unknown>, PART_SUPPLIER_TERM_KEYS);
  if (Object.keys(changesIn).length === 0) refuse("NO_CHANGES", "PRECONDITION_FAILED", "state at least one term to change");
  requireWritable(actor, "edit", Object.keys(changesIn));
  const changes = validatePartSupplierTerms(changesIn, "update");
  const blind = !canReadCommercial(actor);
  if (blind && (Object.hasOwn(changesIn, "contractStart") || Object.hasOwn(changesIn, "contractEnd"))
    && !(Object.hasOwn(changesIn, "contractStart") && Object.hasOwn(changesIn, "contractEnd"))) {
    refuse("CONTRACT_WINDOW_INCOMPLETE", "INVALID_INPUT", "state both contractStart and contractEnd to change the contract window");
  }
  return inTransaction(deps.pool, async (c) => {
    const record = await lockItem(c, actor.tenantId, itemId);
    if (!record) refuse("ITEM_NOT_FOUND", "NOT_FOUND", "no supplier terms with that id");
    const supplier = await supplierFacts(c, actor.tenantId, record!.supplierId);
    const before = view(record!, supplier);
    const effective = (Object.keys(changes) as (keyof PartSupplierTerms)[])
      .filter((k) => !canReadTerm(actor, k) || storedTerm(before, k) !== requestedTerm(changes, k));
    if (before.version === expectedVersion + 1 && effective.length === 0) return { outcome: "replayed" as const, item: project(actor, before) };
    if (before.version !== expectedVersion) refuse("STALE_VERSION", "CONFLICT", "the supplier terms changed since they were read");
    if (effective.length === 0) refuse("NO_CHANGES", "PRECONDITION_FAILED", "the requested terms are already the stored ones");
    const start = changes.contractStart !== undefined ? changes.contractStart : before.contractStart;
    const end = changes.contractEnd !== undefined ? changes.contractEnd : before.contractEnd;
    if (start && end && start > end) refuse("CONTRACT_WINDOW_INVALID", "INVALID_INPUT", "contractEnd must not precede contractStart");
    if (effective.includes("conversion") && changes.conversion) {
      requireCompatibleUnit(changes.conversion, (await partStockingUnit(c, actor.tenantId, record!.partId, true))!);
    }
    const patch: Record<string, unknown> = {};
    for (const k of effective) patch[k] = changes[k];
    const updated = await repository(() => updateSupplierCatalogItem(c, actor.tenantId, actor.principalId, record!.partId, record!.supplierId,
      expectedVersion, patch as SupplierCatalogItemTermsPatch));
    const item = view(updated, supplier);
    // A field the caller cannot read is applied as STATED, not compared (no equality oracle), so the reason says what was
    // stated by a blind writer -- it does not assert that the stored value changed (review N3).
    const stated = effective.filter((k) => !canReadTerm(actor, k));
    const compared = effective.filter((k) => canReadTerm(actor, k));
    const reason = [compared.length ? `updated: ${[...compared].sort().join(", ")}` : null,
      stated.length ? `stated without read access: ${[...stated].sort().join(", ")}` : null].filter(Boolean).join("; ");
    await audit(c, actor, "partSupplierItem.update", itemId, auditView(before), auditView(item), `part-supplier terms ${reason}`);
    return { outcome: "updated" as const, item: project(actor, item) };
  });
}

/**
 * ACTIVATE / DEACTIVATE one item (never delete). inventory.supplierTerms.changeStatus. Deactivating the preferred item clears the
 * preference in the same statement (the repository's rule; preferred implies ACTIVE). The same status again is
 * UNCHANGED, as setSupplierStatus answers it. Reactivation needs the supplier itself to be ACTIVE.
 */
export async function setPartSupplierItemStatus(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_TERMS_STATUS_CAPABILITY);
  const i = acceptOnly(input, ["itemId", "expectedVersion", "status", "reason"]);
  const itemId = requireItemId(i.itemId);
  if (i.status !== "ACTIVE" && i.status !== "INACTIVE") refuse("STATUS_INVALID", "INVALID_INPUT", "status is ACTIVE or INACTIVE");
  const expectedVersion = requireExpectedVersion(i.expectedVersion);
  if (i.reason !== undefined && (typeof i.reason !== "string" || i.reason.trim() === "" || i.reason.length > 500)) {
    refuse("REASON_INVALID", "INVALID_INPUT", "reason, when stated, is a non-blank string (max 500)");
  }
  const status = i.status as "ACTIVE" | "INACTIVE";
  return inTransaction(deps.pool, async (c) => {
    const record = await lockItem(c, actor.tenantId, itemId);
    if (!record) refuse("ITEM_NOT_FOUND", "NOT_FOUND", "no supplier terms with that id");
    const supplier = await supplierFacts(c, actor.tenantId, record!.supplierId, status === "ACTIVE");
    const before = view(record!, supplier);
    if (before.status === status) return { outcome: "unchanged" as const, item: project(actor, before) };
    if (before.version !== expectedVersion) refuse("STALE_VERSION", "CONFLICT", "the supplier terms changed since they were read");
    if (status === "ACTIVE" && supplier?.status !== "ACTIVE") refuse("SUPPLIER_NOT_ACTIVE", "PRECONDITION_FAILED", "the supplier is not ACTIVE");
    const updated = await repository(() => setSupplierCatalogItemStatus(c, actor.tenantId, actor.principalId, record!.partId, record!.supplierId,
      expectedVersion, status));
    const item = view(updated, supplier);
    const action = status === "ACTIVE" ? "partSupplierItem.activate" : "partSupplierItem.deactivate";
    await audit(c, actor, action, itemId, auditView(before), auditView(item),
      typeof i.reason === "string" ? i.reason.trim() : status === "ACTIVE" ? "part-supplier terms reactivated" : "part-supplier terms deactivated");
    return { outcome: status === "ACTIVE" ? "activated" as const : "deactivated" as const, item: project(actor, item) };
  });
}

/**
 * Make one ACTIVE item THE preferred supplier for its Part, clearing the incumbent in the same transaction (the
 * repository's two statements + the one-preferred-per-part unique index). inventory.supplierTerms.edit (preference is a
 * RELATIONSHIP field). Already preferred = UNCHANGED (Firebase answered it "replayed" with nothing written). One audit
 * row states the whole change, the released incumbent included.
 */
export async function setPreferredPartSupplierItem(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_TERMS_EDIT_CAPABILITY);
  const i = acceptOnly(input, ["partId", "itemId", "expectedVersion"]);
  const partId = requirePartId(i.partId);
  const itemId = requireItemId(i.itemId);
  const expectedVersion = requireExpectedVersion(i.expectedVersion);
  return inTransaction(deps.pool, async (c) => {
    // Every item of the Part, locked: two preference changes for one Part serialize here instead of racing to the index.
    const { rows: locked } = await c.query(
      `SELECT item_id, supplier_id FROM eos_ops.supplier_catalog_items WHERE tenant_id = $1 AND part_id = $2 ORDER BY supplier_id FOR UPDATE`,
      [actor.tenantId, partId]);
    const target = locked.find((r) => r.item_id === itemId);
    if (!target) refuse("ITEM_NOT_FOUND", "NOT_FOUND", "no supplier terms with that id for this part");
    const records = await listSupplierCatalogItemsForPart(c, actor.tenantId, partId);
    const current = records.find((r) => r.itemId === itemId)!;
    const supplier = await supplierFacts(c, actor.tenantId, current.supplierId, true);
    const before = view(current, supplier);
    const preconditions = () => {
      if (before.version !== expectedVersion) refuse("STALE_VERSION", "CONFLICT", "the supplier terms changed since they were read");
      if (before.status !== "ACTIVE") refuse("ITEM_NOT_ACTIVE", "PRECONDITION_FAILED", "only ACTIVE supplier terms can be preferred");
      if (supplier?.status !== "ACTIVE") refuse("SUPPLIER_NOT_ACTIVE", "PRECONDITION_FAILED", "the supplier is not ACTIVE");
    };
    // A caller who cannot read terms gets EVERY precondition before the "unchanged" short-circuit: otherwise a refusal on
    // one item and "unchanged" on another (wrong version, or an INACTIVE supplier) would tell them which item is preferred
    // without writing anything (review N2 follow-ups). A reader's order is unchanged.
    const canRead = actor.capabilities.has(SUPPLIER_TERMS_READ_CAPABILITY);
    if (!canRead) preconditions();
    if (before.preferred) return { outcome: "unchanged" as const, item: project(actor, before), clearedItemId: null };
    preconditions();
    const incumbentRecord = records.find((r) => r.preferred) ?? null;
    const incumbentSupplier = incumbentRecord ? await supplierFacts(c, actor.tenantId, incumbentRecord.supplierId) : null;
    const incumbentBefore = incumbentRecord ? view(incumbentRecord, incumbentSupplier) : null;
    const updated = await repository(() => setPreferredSupplierWithin(c, actor.tenantId, actor.principalId, partId, current.supplierId, expectedVersion));
    const item = view(updated, supplier);
    const incumbentAfterRecord = incumbentRecord ? await readSupplierCatalogItem(c, actor.tenantId, partId, incumbentRecord.supplierId) : null;
    const incumbentAfter = incumbentAfterRecord ? view(incumbentAfterRecord, incumbentSupplier) : null;
    await audit(c, actor, "partSupplierItem.setPreferred", itemId, { item: auditView(before), clearedItem: auditView(incumbentBefore) },
      { item: auditView(item), clearedItem: auditView(incumbentAfter) },
      incumbentBefore ? `preferred supplier changed from ${incumbentBefore.supplierId} to ${item.supplierId}` : `preferred supplier set to ${item.supplierId}`);
    // Which item WAS preferred is a RELATIONSHIP fact: a caller who cannot read terms does not learn it (review N2).
    return { outcome: "preferred" as const, item: project(actor, item), clearedItemId: canRead ? incumbentBefore?.itemId ?? null : null };
  });
}
