"use strict";
// THE GOVERNED CATALOG READS -- bounded, and shaped by the question each screen actually asks.
//
// ════════════════════ DO NOT RECREATE THE CLIENT FIRESTORE PROBLEM ════════════════════
//
// The Firestore client reads the WHOLE `parts` collection from six surfaces
// (`partMasterQueries.PART_CATALOGUE_WHOLE_COLLECTION_READ`). Turning that into "the whole
// PostgreSQL table over HTTP" would move the defect rather than fix it: the same unbounded read,
// one network hop further away, and now with a server paying for it too.
//
// So each read here answers ONE question:
//
//   readPart(partId)            PartDetail: one Part, by id.
//   readPartsByIds(partIds)     the canonical-name resolver: the ids a page is already showing.
//   searchParts(...)            administration lists and pickers: a BOUNDED, searchable page.
//
// `searchParts` has a hard ceiling that is not negotiable by the caller: `limit` is clamped, never
// trusted. A caller asking for a million rows gets the ceiling, because the protection has to live
// where it cannot be argued with rather than in the callers' good manners.
//
// A KEYSET cursor, not an offset. Offset paging silently repeats or skips rows when the underlying
// set changes between pages, and a catalogue picker that quietly drops a Part is worse than one that
// refuses to page at all.
Object.defineProperty(exports, "__esModule", { value: true });
exports.EQUIPMENT_MODEL_LIST_MAX_LIMIT = exports.PART_SEARCH_SORT_FIELDS = exports.PART_CONTROL_TYPE_VALUES = exports.PART_STOCKING_CLASS_VALUES = exports.PART_STATUS_VALUES = exports.PART_BY_IDS_MAX = exports.PART_SEARCH_DEFAULT_LIMIT = exports.PART_SEARCH_MAX_LIMIT = void 0;
exports.readPart = readPart;
exports.readPartsByIds = readPartsByIds;
exports.searchParts = searchParts;
exports.countParts = countParts;
exports.listEquipmentModels = listEquipmentModels;
const catalogRows_js_1 = require("./catalogRows.js");
const catalogMasterKernel_js_1 = require("./catalogMasterKernel.js");
const types_1 = require("../partMaster/types");
const SCHEMA = "eos_ops";
/** The most rows any single Catalog read will ever return. Clamped, never trusted from input. */
exports.PART_SEARCH_MAX_LIMIT = 100;
exports.PART_SEARCH_DEFAULT_LIMIT = 50;
/** `readPartsByIds` answers about ids a caller already holds, so its ceiling is the page size. */
exports.PART_BY_IDS_MAX = 200;
async function readPart(client, tenantId, partId) {
    if (typeof partId !== "string" || partId.trim() === "")
        return null;
    const { rows } = await client.query(`${catalogRows_js_1.PART_SELECT} WHERE tenant_id = $1 AND id = $2`, [tenantId, partId]);
    return rows.length === 0 ? null : (0, catalogRows_js_1.partFromRow)(rows[0]);
}
/**
 * The ids a page is already showing, resolved to their canonical names.
 *
 * Deliberately NOT "give me everything so I can look them up myself": the resolver knows exactly
 * which ids it needs, and asking for those is the difference between a bounded read and the whole
 * catalogue. Unknown ids are simply absent from the result -- a caller asking about a Part that does
 * not exist gets silence about it, not an error about the rest.
 */
async function readPartsByIds(client, tenantId, partIds) {
    const ids = [...new Set((partIds ?? []).filter((id) => typeof id === "string" && id.trim() !== ""))];
    if (ids.length === 0)
        return [];
    if (ids.length > exports.PART_BY_IDS_MAX) {
        throw new Error(`readPartsByIds accepts at most ${exports.PART_BY_IDS_MAX} ids; a larger question is a search`);
    }
    const { rows } = await client.query(`${catalogRows_js_1.PART_SELECT} WHERE tenant_id = $1 AND id = ANY($2::text[]) ORDER BY id`, [tenantId, ids]);
    return rows.map(catalogRows_js_1.partFromRow);
}
// ════════════════════ THE GOVERNED QUERY VOCABULARY ════════════════════
//
// Every value a caller may filter or sort by is checked against the SAME enums the Part authority
// writes with, and anything else is REFUSED. Passing an unknown value through would not fail: it
// would match nothing and the screen would say "no parts", which is a false statement about the
// catalogue rather than an error anybody could see.
exports.PART_STATUS_VALUES = Object.freeze([...types_1.PART_STATUSES]);
exports.PART_STOCKING_CLASS_VALUES = Object.freeze([...types_1.STOCKING_CLASSES]);
exports.PART_CONTROL_TYPE_VALUES = Object.freeze([...types_1.CONTROL_TYPES]);
/**
 * The sortable fields, and the SQL each orders by.
 *
 * Every expression is NOT NULL in the schema, which is what lets a (value, id) row comparison be the
 * whole keyset rule -- a nullable sort column would need its own NULLS ordering in both the ORDER BY
 * and the cursor predicate, and getting one of the two wrong silently drops rows.
 *
 * Enum columns order by their TEXT: that is the order the Firestore-served screen presented, and one
 * rule for ORDER BY and the cursor predicate is what keeps them from disagreeing.
 */
const SORT_SQL = Object.freeze({
    id: { expr: "id", param: "text" },
    internalPartNumber: { expr: "internal_part_number", param: "text" },
    name: { expr: "name", param: "text" },
    status: { expr: "status::text", param: "text" },
    stockingClass: { expr: "stocking_class::text", param: "text" },
    createdAt: { expr: "created_at", param: "timestamptz" },
    updatedAt: { expr: "updated_at", param: "timestamptz" },
});
exports.PART_SEARCH_SORT_FIELDS = Object.freeze(Object.keys(SORT_SQL));
/** The ceiling on an IN list. No governed enum is longer; a longer list is not a real question. */
const IN_MAX = 16;
const PART_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
/** A KEYSET cursor. `.` is outside the Part id alphabet, so no id-only cursor can ever carry it. */
const KEYSET_PREFIX = "k1.";
const invalid = (code, message) => (0, catalogMasterKernel_js_1.refuse)(code, "INVALID_INPUT", message);
const absentString = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
function oneOf(name, v, allowed) {
    if (absentString(v))
        return null;
    if (typeof v !== "string")
        return invalid("SEARCH_FILTER_MALFORMED", `${name} must be a string`);
    const value = v.trim();
    if (!allowed.includes(value))
        return invalid("SEARCH_FILTER_UNKNOWN_VALUE", `${name} "${value}" is not one of ${allowed.join(", ")}`);
    return value;
}
function manyOf(name, v, allowed) {
    if (v === undefined || v === null)
        return null;
    if (!Array.isArray(v))
        return invalid("SEARCH_FILTER_MALFORMED", `${name} must be an array`);
    // An EMPTY IN matches nothing. Refused rather than executed: a screen that sent one has lost its
    // criteria somewhere, and "no parts" would hide that.
    if (v.length === 0)
        return invalid("SEARCH_FILTER_MALFORMED", `${name} must not be empty`);
    if (v.length > IN_MAX)
        return invalid("SEARCH_FILTER_MALFORMED", `${name} accepts at most ${IN_MAX} values`);
    const out = new Set();
    for (const item of v) {
        if (typeof item !== "string")
            return invalid("SEARCH_FILTER_MALFORMED", `${name} values must be strings`);
        if (!allowed.includes(item))
            return invalid("SEARCH_FILTER_UNKNOWN_VALUE", `${name} value "${item}" is not one of ${allowed.join(", ")}`);
        out.add(item);
    }
    return [...out];
}
/** EQUALS and IN on one field, resolved to one list -- and both at once refused, never guessed between. */
function enumFilter(single, plural, input, allowed) {
    const one = oneOf(single, input[single], allowed);
    const many = manyOf(plural, input[plural], allowed);
    if (one !== null && many !== null) {
        return invalid("SEARCH_FILTER_AMBIGUOUS", `${single} and ${plural} cannot both be given`);
    }
    return one !== null ? [one] : many;
}
/**
 * The ONE statement of what a search filter means, shared by the page and its count so a total can
 * never describe a different set from the rows under it.
 */
function buildFilterWhere(tenantId, input) {
    const raw = input;
    const values = [tenantId];
    const clauses = ["tenant_id = $1"];
    const bind = (v) => { values.push(v); return `$${values.length}`; };
    if (raw.query !== undefined && raw.query !== null && typeof raw.query !== "string") {
        invalid("SEARCH_FILTER_MALFORMED", "query must be a string");
    }
    const q = typeof raw.query === "string" && raw.query.trim() !== "" ? raw.query.trim() : null;
    if (q !== null) {
        const p = bind(q);
        clauses.push(`(id ILIKE '%' || ${p} || '%' OR internal_part_number ILIKE '%' || ${p} || '%' OR name ILIKE '%' || ${p} || '%')`);
    }
    const statuses = enumFilter("status", "statuses", raw, exports.PART_STATUS_VALUES);
    if (statuses)
        clauses.push(`status::text = ANY(${bind(statuses)}::text[])`);
    const classes = enumFilter("stockingClass", "stockingClasses", raw, exports.PART_STOCKING_CLASS_VALUES);
    if (classes)
        clauses.push(`stocking_class::text = ANY(${bind(classes)}::text[])`);
    const controlType = oneOf("controlType", raw.controlType, exports.PART_CONTROL_TYPE_VALUES);
    if (controlType !== null)
        clauses.push(`control_type::text = ${bind(controlType)}`);
    if (raw.wholeUnit !== undefined && raw.wholeUnit !== null) {
        if (typeof raw.wholeUnit !== "boolean")
            invalid("SEARCH_FILTER_MALFORMED", "wholeUnit must be a boolean");
        clauses.push(`whole_unit = ${bind(raw.wholeUnit)}`);
    }
    return { sql: clauses.join("\n        AND "), values };
}
function resolveSort(v) {
    if (v === undefined || v === null)
        return null;
    if (typeof v !== "object" || Array.isArray(v))
        return invalid("SEARCH_SORT_MALFORMED", "sort must be { field, direction }");
    const { field, direction } = v;
    if (typeof field !== "string" || !Object.prototype.hasOwnProperty.call(SORT_SQL, field)) {
        return invalid("SEARCH_SORT_UNKNOWN_FIELD", `sort field must be one of ${exports.PART_SEARCH_SORT_FIELDS.join(", ")}`);
    }
    if (direction !== "ASC" && direction !== "DESC")
        return invalid("SEARCH_SORT_MALFORMED", "sort direction must be ASC or DESC");
    return Object.freeze({ field: field, direction });
}
function encodeKeyset(c) {
    return KEYSET_PREFIX + Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}
/**
 * A keyset cursor, CHECKED against the sort it is being replayed under.
 *
 * A cursor taken under "part number, descending" and replayed under "status, ascending" is a
 * position in a different ordering. Applied, it would silently skip or repeat rows; refused, the
 * screen restarts from the first page. Refusal is the only answer that cannot be wrong.
 */
function decodeKeyset(raw, sort) {
    if (!raw.startsWith(KEYSET_PREFIX)) {
        return invalid("SEARCH_CURSOR_SORT_MISMATCH", "this cursor was not produced under the requested sort");
    }
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(raw.slice(KEYSET_PREFIX.length), "base64url").toString("utf8"));
    }
    catch {
        return invalid("SEARCH_CURSOR_MALFORMED", "the cursor could not be read");
    }
    const c = parsed;
    if (!c || typeof c !== "object" || typeof c.v !== "string" || typeof c.id !== "string" || !PART_ID_SHAPE.test(c.id)) {
        return invalid("SEARCH_CURSOR_MALFORMED", "the cursor could not be read");
    }
    if (c.f !== sort.field || c.d !== sort.direction) {
        return invalid("SEARCH_CURSOR_SORT_MISMATCH", "this cursor was produced under a different sort");
    }
    return c;
}
/** The sort value a Part carries, in the exact text the cursor predicate will compare against. */
function sortValueOf(part, field) {
    // Timestamps come back from PART_SELECT with six fractional digits in UTC, so the value
    // round-trips through ::timestamptz without losing the microseconds PostgreSQL ordered by.
    return String(part[field]);
}
/**
 * A BOUNDED, searchable page of the catalogue.
 *
 * This is what every list, picker and administration screen gets. There is no "all parts" operation,
 * because there is no screen whose question is genuinely "all parts" -- the six surfaces that read
 * the whole Firestore collection today each want one of the three reads in this module.
 *
 * TWO CURSOR MODES, deliberately distinct:
 *
 *   sort absent    ORDER BY id; the cursor is the last id and the next page is `id > cursor`. Every
 *                  picker and hook that existed before the Part Master screen moved here relies on
 *                  exactly this, so it is unchanged.
 *   sort given     ORDER BY (sortValue, id), both in the stated direction; the cursor is an opaque
 *                  KEYSET token carrying the sort it was produced under, and a token replayed under
 *                  any other sort -- or in the other mode -- is refused as INVALID_INPUT.
 */
async function searchParts(client, tenantId, input = {}) {
    const requested = Number.isSafeInteger(input.limit) ? input.limit : exports.PART_SEARCH_DEFAULT_LIMIT;
    const limit = Math.min(Math.max(requested, 1), exports.PART_SEARCH_MAX_LIMIT);
    const rawCursor = input.cursor;
    if (rawCursor !== undefined && rawCursor !== null && typeof rawCursor !== "string") {
        invalid("SEARCH_CURSOR_MALFORMED", "cursor must be a string");
    }
    const cursor = typeof rawCursor === "string" && rawCursor.trim() !== "" ? rawCursor.trim() : null;
    const sort = resolveSort(input.sort);
    const where = buildFilterWhere(tenantId, input);
    const values = [...where.values];
    const bind = (v) => { values.push(v); return `$${values.length}`; };
    let keyset = "";
    let orderBy;
    if (sort === null) {
        if (cursor !== null) {
            // A keyset token in id mode is a position in some OTHER ordering. `.` cannot occur in a Part
            // id, so an id cursor can never be mistaken for one.
            if (cursor.startsWith(KEYSET_PREFIX))
                invalid("SEARCH_CURSOR_SORT_MISMATCH", "this cursor was produced under a sort; resend that sort or start again");
            keyset = `\n        AND id > ${bind(cursor)}`;
        }
        orderBy = "ORDER BY id";
    }
    else {
        const { expr, param } = SORT_SQL[sort.field];
        const cmp = sort.direction === "ASC" ? ">" : "<";
        if (cursor !== null) {
            const c = decodeKeyset(cursor, sort);
            keyset = sort.field === "id"
                ? `\n        AND id ${cmp} ${bind(c.id)}`
                : `\n        AND (${expr}, id) ${cmp} (${bind(c.v)}::${param}, ${bind(c.id)}::text)`;
        }
        // The tiebreaker runs in the SAME direction as the sort, which is what makes the row comparison
        // above the exact complement of what has already been shown.
        orderBy = sort.field === "id" ? `ORDER BY id ${sort.direction}` : `ORDER BY ${expr} ${sort.direction}, id ${sort.direction}`;
    }
    const { rows } = await client.query(`${catalogRows_js_1.PART_SELECT}
      WHERE ${where.sql}${keyset}
      ${orderBy}
      LIMIT ${bind(limit + 1)}`, values);
    // One row beyond the page is read to decide whether there IS a next page, and is then dropped. A
    // caller is never told "there might be more" on a guess.
    const page = rows.slice(0, limit).map(catalogRows_js_1.partFromRow);
    const last = page.length > 0 ? page[page.length - 1] : null;
    const nextCursor = rows.length > limit && last
        ? (sort === null ? last.id : encodeKeyset({ f: sort.field, d: sort.direction, v: sortValueOf(last, sort.field), id: last.id }))
        : null;
    return Object.freeze({ parts: page, nextCursor, limit });
}
/**
 * Count the catalogue, for a screen that shows a total without listing it.
 *
 * Takes the SAME filters `searchParts` does, through the same WHERE builder, so the number above a
 * filtered list is a statement about that list. No filters: every Part of the tenant, as before.
 */
async function countParts(client, tenantId, filters = {}) {
    const where = buildFilterWhere(tenantId, filters ?? {});
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.parts WHERE ${where.sql}`, where.values);
    return Number(rows[0].n);
}
// ════════════════════ EQUIPMENT MODELS (DQ-030) ════════════════════
//
// The Sales Agreement Equipment Model picker. Equipment Models are REFERENCE data -- one per model the company
// sells -- so the picker LISTS them rather than searching; the retired Firebase `searchProductReferences`
// listed the Firestore collection whole up to a cap of 200, and this is that read against the PostgreSQL
// authority (eos_ops.equipment_models, populated by the Catalog COPY). It is still BOUNDED: the limit is clamped,
// an id keyset cursor pages beyond it, and `nextCursor` says honestly whether more exist.
exports.EQUIPMENT_MODEL_LIST_MAX_LIMIT = 200;
async function listEquipmentModels(client, tenantId, input = {}) {
    const requested = Number.isSafeInteger(input.limit) ? input.limit : exports.EQUIPMENT_MODEL_LIST_MAX_LIMIT;
    const limit = Math.min(Math.max(requested, 1), exports.EQUIPMENT_MODEL_LIST_MAX_LIMIT);
    const rawCursor = input.cursor;
    if (rawCursor !== undefined && rawCursor !== null && typeof rawCursor !== "string") {
        invalid("LIST_CURSOR_MALFORMED", "cursor must be a string");
    }
    const cursor = typeof rawCursor === "string" && rawCursor.trim() !== "" ? rawCursor.trim() : null;
    const values = [tenantId];
    let keyset = "";
    if (cursor !== null) {
        values.push(cursor);
        keyset = ` AND id > $${values.length}`;
    }
    values.push(limit + 1);
    const { rows } = await client.query(`${catalogRows_js_1.EQUIPMENT_MODEL_SELECT} WHERE tenant_id = $1${keyset} ORDER BY id LIMIT $${values.length}`, values);
    const page = rows.slice(0, limit).map(catalogRows_js_1.equipmentModelFromRow);
    const nextCursor = rows.length > limit && page.length > 0 ? page[page.length - 1].id : null;
    return Object.freeze({ models: page, nextCursor, limit });
}
//# sourceMappingURL=postgresCatalogReads.js.map