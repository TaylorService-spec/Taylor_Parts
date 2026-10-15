"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplierCatalogRepositoryError = exports.SUPPLIER_OPTIONAL_FIELDS = exports.AVAILABILITY_STATES = exports.SUPPLIER_ITEM_STATUSES = exports.SUPPLIER_STATUSES = void 0;
exports.requireSupplierId = requireSupplierId;
exports.createSupplier = createSupplier;
exports.readSupplier = readSupplier;
exports.updateSupplier = updateSupplier;
exports.setSupplierStatus = setSupplierStatus;
exports.findActiveSuppliersByNormalizedKey = findActiveSuppliersByNormalizedKey;
exports.createSupplierCatalogItem = createSupplierCatalogItem;
exports.readSupplierCatalogItem = readSupplierCatalogItem;
exports.listSupplierCatalogItemsForPart = listSupplierCatalogItemsForPart;
exports.setSupplierCatalogItemStatus = setSupplierCatalogItemStatus;
exports.setPreferredSupplier = setPreferredSupplier;
const partIdContract_js_1 = require("./migration/partIdContract.js");
const SCHEMA = "eos_ops";
/** supplierMasterTypes.ts SUPPLIER_ID_PATTERN — the governed id space this table shares. */
const SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
exports.SUPPLIER_STATUSES = ["ACTIVE", "INACTIVE"];
exports.SUPPLIER_ITEM_STATUSES = ["ACTIVE", "INACTIVE"];
exports.AVAILABILITY_STATES = ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"];
/** The seven optional business strings, in the order migration 008 declares them. */
exports.SUPPLIER_OPTIONAL_FIELDS = [
    "vendorNumber",
    "contactName",
    "phone",
    "email",
    "address",
    "paymentTermsRef",
    "notes",
];
const OPTIONAL_COLUMN = Object.freeze({
    vendorNumber: "vendor_number",
    contactName: "contact_name",
    phone: "phone",
    email: "email",
    address: "address",
    paymentTermsRef: "payment_terms_ref",
    notes: "notes",
});
/** eos_ops error idiom (CycleCountRepositoryError): a stable `code` plus a human message. */
class SupplierCatalogRepositoryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.SupplierCatalogRepositoryError = SupplierCatalogRepositoryError;
// ---------------------------------------------------------------------------
// Boundary gates
// ---------------------------------------------------------------------------
/** The governed supplier id, unchanged or refused. Format only — existence is the FK's answer. */
function requireSupplierId(value, context = "supplier_id") {
    if (typeof value !== "string" || !SUPPLIER_ID_PATTERN.test(value)) {
        throw new SupplierCatalogRepositoryError("SUPPLIER_ID_INVALID", `${context} must match [A-Za-z0-9_-]{1,64}`);
    }
    return value;
}
function requireNonBlank(value, code, context) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new SupplierCatalogRepositoryError(code, `${context} must be a non-blank string`);
    }
    return value;
}
/**
 * An optional business string: absent/null means ABSENT. A blank string is refused rather than
 * stored, mirroring supplierMasterCommands.ts's assertOptionalFields — the database CHECK says the
 * same thing, but a caller deserves the field name back, not a constraint name.
 */
function optionalString(value, field) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new SupplierCatalogRepositoryError("OPTIONAL_FIELD_BLANK", `optional field "${field}" must be a non-blank string when present`);
    }
    return value;
}
function requireConversion(conversion) {
    if (conversion === undefined || conversion === null)
        return null;
    requireNonBlank(conversion.purchaseUnit, "CONVERSION_INVALID", "purchaseUnit");
    for (const key of ["numerator", "denominator"]) {
        const v = conversion[key];
        if (!Number.isInteger(v) || v <= 0) {
            throw new SupplierCatalogRepositoryError("CONVERSION_INVALID", `conversion ${key} must be a positive integer`);
        }
    }
    return conversion;
}
/**
 * Translate the two database-stated relationship failures into this module's codes. A foreign key
 * violation on supplier_catalog_items means the supplier does not exist; a unique violation on the
 * partial preferred index means some other item is already the preferred one for that part.
 */
function translate(err) {
    const e = err;
    if (e?.code === "23503") {
        throw new SupplierCatalogRepositoryError("SUPPLIER_NOT_FOUND", "no supplier exists at that id in this tenant");
    }
    if (e?.code === "23505" && e.constraint === "supplier_catalog_items_one_preferred_per_part") {
        throw new SupplierCatalogRepositoryError("PREFERRED_ALREADY_SET", "another supplier item is already preferred for this part");
    }
    if (e?.code === "23505") {
        throw new SupplierCatalogRepositoryError("ALREADY_EXISTS", "a record already exists at that identity");
    }
    if (e?.code === "23514") {
        throw new SupplierCatalogRepositoryError("CONSTRAINT_VIOLATED", `a stored-shape rule was violated: ${e.constraint ?? "unknown"}`);
    }
    throw err;
}
// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------
const SUPPLIER_COLUMNS = "tenant_id, supplier_id, name, normalized_key, status, version, " +
    "vendor_number, contact_name, phone, email, address, payment_terms_ref, notes";
function supplierFromRow(row) {
    return {
        tenantId: row.tenant_id,
        supplierId: row.supplier_id,
        name: row.name,
        normalizedKey: row.normalized_key,
        status: row.status,
        version: row.version,
        vendorNumber: row.vendor_number ?? null,
        contactName: row.contact_name ?? null,
        phone: row.phone ?? null,
        email: row.email ?? null,
        address: row.address ?? null,
        paymentTermsRef: row.payment_terms_ref ?? null,
        notes: row.notes ?? null,
    };
}
const ITEM_COLUMNS = "tenant_id, item_id, part_id, supplier_id, supplier_sku, cost, currency, lead_time_days, " +
    "min_order_qty, order_multiple, purchase_unit, conversion_numerator, conversion_denominator, " +
    "to_char(contract_start, 'YYYY-MM-DD') AS contract_start, " +
    "to_char(contract_end, 'YYYY-MM-DD') AS contract_end, " +
    "to_char(last_verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS last_verified_at, " +
    "availability, preferred, status, version";
function itemFromRow(row) {
    const unit = row.purchase_unit;
    return {
        tenantId: row.tenant_id,
        itemId: row.item_id,
        partId: row.part_id,
        supplierId: row.supplier_id,
        supplierSku: row.supplier_sku,
        cost: row.cost,
        currency: row.currency,
        leadTimeDays: row.lead_time_days,
        minOrderQty: row.min_order_qty ?? null,
        orderMultiple: row.order_multiple ?? null,
        conversion: unit === null ? null : {
            purchaseUnit: unit,
            numerator: row.conversion_numerator,
            denominator: row.conversion_denominator,
        },
        contractStart: row.contract_start ?? null,
        contractEnd: row.contract_end ?? null,
        lastVerifiedAt: row.last_verified_at ?? null,
        availability: row.availability,
        preferred: row.preferred,
        status: row.status,
        version: row.version,
    };
}
// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------
async function createSupplier(pool, tenantId, actorId, input) {
    const supplierId = requireSupplierId(input.supplierId, "supplierId");
    const name = requireNonBlank(input.name, "NAME_INVALID", "name");
    // Verbatim. See the header: there is no second definition of "normalized" in this module.
    const normalizedKey = requireNonBlank(input.normalizedKey, "NORMALIZED_KEY_INVALID", "normalizedKey");
    const optionals = exports.SUPPLIER_OPTIONAL_FIELDS.map((f) => optionalString(input[f], f));
    try {
        const { rows } = await pool.query(`INSERT INTO ${SCHEMA}.suppliers
         (tenant_id, supplier_id, name, normalized_key, status, version,
          vendor_number, contact_name, phone, email, address, payment_terms_ref, notes,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       RETURNING ${SUPPLIER_COLUMNS}`, [tenantId, supplierId, name, normalizedKey, input.status ?? "ACTIVE", ...optionals, actorId]);
        return supplierFromRow(rows[0]);
    }
    catch (err) {
        return translate(err);
    }
}
async function readSupplier(pool, tenantId, supplierId) {
    const { rows } = await pool.query(`SELECT ${SUPPLIER_COLUMNS} FROM ${SCHEMA}.suppliers WHERE tenant_id = $1 AND supplier_id = $2`, [tenantId, requireSupplierId(supplierId, "supplierId")]);
    return rows.length === 0 ? null : supplierFromRow(rows[0]);
}
/**
 * Change the governed fields of a supplier, at the version the caller read. `patch` carries only
 * the fields being changed; a field set to null is CLEARED, which is how an optional business
 * string is removed. `normalizedKey` travels with `name` because the caller computed both from the
 * same governed normalizer — this module will not derive one from the other.
 */
async function updateSupplier(pool, tenantId, actorId, supplierId, expectedVersion, patch) {
    requireSupplierId(supplierId, "supplierId");
    if ((patch.name === undefined) !== (patch.normalizedKey === undefined)) {
        throw new SupplierCatalogRepositoryError("NORMALIZED_KEY_INVALID", "name and normalizedKey must change together -- this module never derives one from the other");
    }
    const sets = [];
    const values = [tenantId, supplierId, expectedVersion, actorId];
    const push = (column, value) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
    };
    if (patch.name !== undefined) {
        push("name", requireNonBlank(patch.name, "NAME_INVALID", "name"));
        push("normalized_key", requireNonBlank(patch.normalizedKey, "NORMALIZED_KEY_INVALID", "normalizedKey"));
    }
    for (const field of exports.SUPPLIER_OPTIONAL_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) {
            push(OPTIONAL_COLUMN[field], optionalString(patch[field], field));
        }
    }
    if (sets.length === 0) {
        throw new SupplierCatalogRepositoryError("NO_CHANGE", "an update must change at least one field");
    }
    return applyVersionedUpdate(pool, tenantId, supplierId, expectedVersion, sets, values);
}
async function setSupplierStatus(pool, tenantId, actorId, supplierId, expectedVersion, status) {
    requireSupplierId(supplierId, "supplierId");
    if (!exports.SUPPLIER_STATUSES.includes(status)) {
        throw new SupplierCatalogRepositoryError("STATUS_INVALID", `status must be ${exports.SUPPLIER_STATUSES.join("/")}`);
    }
    return applyVersionedUpdate(pool, tenantId, supplierId, expectedVersion, ["status = $5"], [tenantId, supplierId, expectedVersion, actorId, status]);
}
/**
 * The one versioned-UPDATE shape both supplier writers use. A zero-row result is ambiguous by
 * construction (absent, or present at a different version), so it is disambiguated by a follow-up
 * read rather than guessed at.
 */
async function applyVersionedUpdate(pool, tenantId, supplierId, expectedVersion, sets, values) {
    let rows;
    try {
        ({ rows } = await pool.query(`UPDATE ${SCHEMA}.suppliers
          SET ${sets.join(", ")}, version = version + 1, updated_at = now(), updated_by = $4
        WHERE tenant_id = $1 AND supplier_id = $2 AND version = $3
        RETURNING ${SUPPLIER_COLUMNS}`, [...values]));
    }
    catch (err) {
        return translate(err);
    }
    if (rows.length === 1)
        return supplierFromRow(rows[0]);
    const current = await readSupplier(pool, tenantId, supplierId);
    if (current === null)
        throw new SupplierCatalogRepositoryError("SUPPLIER_NOT_FOUND", "no supplier exists at that id in this tenant");
    throw new SupplierCatalogRepositoryError("VERSION_CONFLICT", `expected version ${expectedVersion}, stored ${current.version}`);
}
/**
 * Dedup DETECTION. Returns the OTHER ACTIVE suppliers sharing a normalized key — a suspected
 * duplicate for a human to judge. It merges nothing and refuses nothing; the index backing it is
 * deliberately not UNIQUE for exactly that reason (migration 008's header).
 */
async function findActiveSuppliersByNormalizedKey(pool, tenantId, normalizedKey, excludeSupplierId = null) {
    const { rows } = await pool.query(`SELECT ${SUPPLIER_COLUMNS} FROM ${SCHEMA}.suppliers
      WHERE tenant_id = $1 AND normalized_key = $2 AND status = 'ACTIVE'
        AND ($3::text IS NULL OR supplier_id <> $3)
      ORDER BY supplier_id`, [tenantId, requireNonBlank(normalizedKey, "NORMALIZED_KEY_INVALID", "normalizedKey"), excludeSupplierId]);
    return rows.map(supplierFromRow);
}
// ---------------------------------------------------------------------------
// Supplier catalog items — the Part↔Supplier relationship
// ---------------------------------------------------------------------------
async function createSupplierCatalogItem(pool, tenantId, actorId, input) {
    // The ONE canonicalization. It returns the same string or throws; it never substitutes an alias,
    // a supplier SKU or a manufacturer part number for a part id.
    const partId = (0, partIdContract_js_1.requireCanonicalPartId)(input.partId, "supplier_catalog_items.part_id");
    const supplierId = requireSupplierId(input.supplierId, "supplierId");
    const supplierSku = requireNonBlank(input.supplierSku, "SUPPLIER_SKU_INVALID", "supplierSku");
    const conversion = requireConversion(input.conversion);
    try {
        const { rows } = await pool.query(`INSERT INTO ${SCHEMA}.supplier_catalog_items
         (tenant_id, part_id, supplier_id, supplier_sku, cost, currency, lead_time_days,
          min_order_qty, order_multiple, purchase_unit, conversion_numerator, conversion_denominator,
          contract_start, contract_end, last_verified_at, availability, preferred, status, version,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, FALSE, $17, 1, $18, $18)
       RETURNING ${ITEM_COLUMNS}`, [
            tenantId, partId, supplierId, supplierSku, input.cost, input.currency, input.leadTimeDays,
            input.minOrderQty ?? null, input.orderMultiple ?? null,
            conversion?.purchaseUnit ?? null, conversion?.numerator ?? null, conversion?.denominator ?? null,
            input.contractStart ?? null, input.contractEnd ?? null, input.lastVerifiedAt ?? null,
            input.availability ?? "UNKNOWN", input.status ?? "ACTIVE", actorId,
        ]);
        return itemFromRow(rows[0]);
    }
    catch (err) {
        return translate(err);
    }
}
async function readSupplierCatalogItem(pool, tenantId, partId, supplierId) {
    const { rows } = await pool.query(`SELECT ${ITEM_COLUMNS} FROM ${SCHEMA}.supplier_catalog_items
      WHERE tenant_id = $1 AND part_id = $2 AND supplier_id = $3`, [
        tenantId,
        (0, partIdContract_js_1.requireCanonicalPartId)(partId, "supplier_catalog_items.part_id"),
        requireSupplierId(supplierId, "supplierId"),
    ]);
    return rows.length === 0 ? null : itemFromRow(rows[0]);
}
/** Every supplier item for one part, preferred first — the procurement read this table exists for. */
async function listSupplierCatalogItemsForPart(pool, tenantId, partId) {
    const { rows } = await pool.query(`SELECT ${ITEM_COLUMNS} FROM ${SCHEMA}.supplier_catalog_items
      WHERE tenant_id = $1 AND part_id = $2
      ORDER BY preferred DESC, supplier_id`, [tenantId, (0, partIdContract_js_1.requireCanonicalPartId)(partId, "supplier_catalog_items.part_id")]);
    return rows.map(itemFromRow);
}
async function setSupplierCatalogItemStatus(pool, tenantId, actorId, partId, supplierId, expectedVersion, status) {
    const canonicalPartId = (0, partIdContract_js_1.requireCanonicalPartId)(partId, "supplier_catalog_items.part_id");
    requireSupplierId(supplierId, "supplierId");
    if (!exports.SUPPLIER_ITEM_STATUSES.includes(status)) {
        throw new SupplierCatalogRepositoryError("STATUS_INVALID", `status must be ${exports.SUPPLIER_ITEM_STATUSES.join("/")}`);
    }
    // Deactivating the preferred item clears `preferred` in the SAME statement. The CHECK
    // (preferred implies ACTIVE) makes that mandatory rather than tidy: leaving the flag would be a
    // constraint violation, and clearing it in a second statement would leave a window where the
    // part has no preferred supplier for a reason nobody asked for.
    let rows;
    try {
        ({ rows } = await pool.query(`UPDATE ${SCHEMA}.supplier_catalog_items
          SET status = $5,
              preferred = (preferred AND $6),
              version = version + 1, updated_at = now(), updated_by = $7
        WHERE tenant_id = $1 AND part_id = $2 AND supplier_id = $3 AND version = $4
        RETURNING ${ITEM_COLUMNS}`, 
        // `staysActive` is passed as its own boolean rather than re-deducing $5: one placeholder
        // cannot be both the enum the column takes and the text a comparison would need.
        [tenantId, canonicalPartId, supplierId, expectedVersion, status, status === "ACTIVE", actorId]));
    }
    catch (err) {
        return translate(err);
    }
    if (rows.length === 1)
        return itemFromRow(rows[0]);
    return itemConflict(pool, tenantId, canonicalPartId, supplierId, expectedVersion);
}
/**
 * Make one ACTIVE supplier item THE preferred one for its part, clearing whichever item held it.
 *
 * Both statements run in ONE transaction, and the partial unique index means the pair is not
 * merely convention: if a concurrent transaction set a different preferred item, this one fails on
 * the index rather than producing a part with two. That is the invariant that used to live only
 * inside partSupplierItems.ts's Firestore transaction.
 */
async function setPreferredSupplier(pool, tenantId, actorId, partId, supplierId, expectedVersion) {
    const canonicalPartId = (0, partIdContract_js_1.requireCanonicalPartId)(partId, "supplier_catalog_items.part_id");
    requireSupplierId(supplierId, "supplierId");
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // Clear the incumbent first: the unique index is immediate, so setting before clearing would
        // conflict with a row this same transaction is about to release.
        await client.query(`UPDATE ${SCHEMA}.supplier_catalog_items
          SET preferred = FALSE, version = version + 1, updated_at = now(), updated_by = $4
        WHERE tenant_id = $1 AND part_id = $2 AND preferred AND supplier_id <> $3`, [tenantId, canonicalPartId, supplierId, actorId]);
        const { rows } = await client.query(`UPDATE ${SCHEMA}.supplier_catalog_items
          SET preferred = TRUE, version = version + 1, updated_at = now(), updated_by = $5
        WHERE tenant_id = $1 AND part_id = $2 AND supplier_id = $3 AND version = $4
          AND status = 'ACTIVE'
        RETURNING ${ITEM_COLUMNS}`, [tenantId, canonicalPartId, supplierId, expectedVersion, actorId]);
        if (rows.length !== 1) {
            await client.query("ROLLBACK");
            return itemConflict(pool, tenantId, canonicalPartId, supplierId, expectedVersion);
        }
        await client.query("COMMIT");
        return itemFromRow(rows[0]);
    }
    catch (err) {
        try {
            await client.query("ROLLBACK");
        }
        catch { /* the original failure is the one that matters */ }
        return translate(err);
    }
    finally {
        client.release();
    }
}
/** Disambiguate a zero-row versioned write: absent, wrong version, or not ACTIVE. Never guessed. */
async function itemConflict(pool, tenantId, partId, supplierId, expectedVersion) {
    const current = await readSupplierCatalogItem(pool, tenantId, partId, supplierId);
    if (current === null) {
        throw new SupplierCatalogRepositoryError("ITEM_NOT_FOUND", "no supplier catalog item exists for that part and supplier");
    }
    if (current.version !== expectedVersion) {
        throw new SupplierCatalogRepositoryError("VERSION_CONFLICT", `expected version ${expectedVersion}, stored ${current.version}`);
    }
    throw new SupplierCatalogRepositoryError("ITEM_NOT_ACTIVE", "only an ACTIVE supplier item can be preferred");
}
//# sourceMappingURL=supplierCatalogRepository.js.map