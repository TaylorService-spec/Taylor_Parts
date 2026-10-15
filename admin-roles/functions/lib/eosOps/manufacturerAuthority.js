"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManufacturerReadError = exports.MANUFACTURER_SEARCH_MAX_LIMIT = exports.MANUFACTURER_SEARCH_DEFAULT_LIMIT = exports.MANUFACTURER_SEARCH_TERM_MAX = exports.MANUFACTURER_STATUSES = exports.MANUFACTURER_READ = void 0;
exports.listManufacturers = listManufacturers;
exports.getManufacturer = getManufacturer;
exports.searchManufacturers = searchManufacturers;
exports.MANUFACTURER_READ = "inventory.manufacturer.read";
exports.MANUFACTURER_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);
/** Bounds on the search input and its page. Stated here so no caller can choose an unbounded read. */
exports.MANUFACTURER_SEARCH_TERM_MAX = 200;
exports.MANUFACTURER_SEARCH_DEFAULT_LIMIT = 50;
exports.MANUFACTURER_SEARCH_MAX_LIMIT = 200;
class ManufacturerReadError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.category = category;
        this.name = "ManufacturerReadError";
    }
}
exports.ManufacturerReadError = ManufacturerReadError;
const refuse = (code, category, message) => {
    throw new ManufacturerReadError(code, category, message);
};
function assertMayRead(reader) {
    if (!(reader.capabilities instanceof Set) || !reader.capabilities.has(exports.MANUFACTURER_READ)) {
        refuse("CAPABILITY_MISSING", "FORBIDDEN", `this read requires ${exports.MANUFACTURER_READ}`);
    }
}
const toRecord = (r) => Object.freeze({
    id: String(r.id),
    name: String(r.name),
    status: String(r.status),
    provenance: String(r.provenance),
});
/**
 * Every manufacturer in the tenant, ACTIVE and INACTIVE alike, ordered by normalized name.
 *
 * INACTIVE ones are INCLUDED deliberately: equipment already names them, and a form resolving an
 * existing reference must still be able to show what it points at. Filtering is the caller's
 * decision -- a picker offering new choices wants ACTIVE only, a record display wants both.
 */
async function listManufacturers(db, reader) {
    assertMayRead(reader);
    const { rows } = await db.query(`SELECT id, name, status, provenance FROM eos_ops.manufacturers
      WHERE tenant_id = $1 ORDER BY normalized_name, id`, [reader.tenantId]);
    return Object.freeze(rows.map(toRecord));
}
/** One manufacturer, or null. Null is not an error: a dangling reference is a real possibility. */
async function getManufacturer(db, reader, manufacturerId) {
    assertMayRead(reader);
    const id = typeof manufacturerId === "string" ? manufacturerId.trim() : "";
    if (!id)
        refuse("MANUFACTURER_ID_REQUIRED", "INVALID_INPUT", "a manufacturerId is required");
    const { rows } = await db.query(`SELECT id, name, status, provenance FROM eos_ops.manufacturers
      WHERE tenant_id = $1 AND id = $2`, [reader.tenantId, id]);
    return rows.length === 1 ? toRecord(rows[0]) : null;
}
/**
 * The manufacturers whose name CONTAINS `term`, case- and whitespace-insensitively.
 *
 * MATCHING IS THE NORMALIZED NAME -- the column the table already indexes and orders by
 * (manufacturers_by_name), whose derivation is stated once in manufacturerMigration.ts#normalizeName:
 * trim, collapse internal whitespace, uppercase. So "taylor  company" and "Taylor Company" find the same
 * row, and the rule a caller experiences is the rule the column actually holds.
 *
 * CONTAINS, not prefix: the word a user remembers is frequently not the first one ("Soft Serve" for
 * "Taylor Soft Serve"). The term is a BOUND PARAMETER and its LIKE metacharacters are escaped, so a
 * caller cannot smuggle in a pattern that widens the match.
 *
 * INACTIVE rows are included, for the same reason LIST includes them. An empty term is INVALID_INPUT
 * rather than "everything": a caller that wants everything has LIST, and silently promoting a blank box
 * to a whole-table read is how a search endpoint becomes an accidental export.
 */
async function searchManufacturers(db, reader, term, options) {
    assertMayRead(reader);
    const raw = typeof term === "string" ? term.trim().replace(/\s+/g, " ") : "";
    if (!raw)
        refuse("SEARCH_TERM_REQUIRED", "INVALID_INPUT", "a non-empty search term is required");
    if (raw.length > exports.MANUFACTURER_SEARCH_TERM_MAX) {
        refuse("SEARCH_TERM_TOO_LONG", "INVALID_INPUT", `a search term is at most ${exports.MANUFACTURER_SEARCH_TERM_MAX} characters`);
    }
    const limit = options?.limit ?? exports.MANUFACTURER_SEARCH_DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > exports.MANUFACTURER_SEARCH_MAX_LIMIT) {
        refuse("SEARCH_LIMIT_INVALID", "INVALID_INPUT", `limit must be an integer between 1 and ${exports.MANUFACTURER_SEARCH_MAX_LIMIT}`);
    }
    // The caller's text is DATA. Backslash, % and _ are escaped so the term can only ever match itself.
    const pattern = `%${raw.toUpperCase().replace(/([\\%_])/g, "\\$1")}%`;
    const { rows } = await db.query(`SELECT id, name, status, provenance FROM eos_ops.manufacturers
      WHERE tenant_id = $1 AND normalized_name LIKE $2 ESCAPE '\\'
      ORDER BY normalized_name, id LIMIT $3`, [reader.tenantId, pattern, limit]);
    return Object.freeze(rows.map(toRecord));
}
//# sourceMappingURL=manufacturerAuthority.js.map