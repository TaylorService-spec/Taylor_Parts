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

import type { PoolClient } from "pg";
import { PART_SELECT, partFromRow, type CanonicalPart } from "./catalogRows.js";
import { refuse } from "./catalogMasterKernel.js";
import { PART_STATUSES, STOCKING_CLASSES, CONTROL_TYPES } from "../partMaster/types";

const SCHEMA = "eos_ops";

/** The most rows any single Catalog read will ever return. Clamped, never trusted from input. */
export const PART_SEARCH_MAX_LIMIT = 100;
export const PART_SEARCH_DEFAULT_LIMIT = 50;
/** `readPartsByIds` answers about ids a caller already holds, so its ceiling is the page size. */
export const PART_BY_IDS_MAX = 200;

export interface PartSearchPage {
  readonly parts: readonly CanonicalPart[];
  /** The cursor for the NEXT page, or null at the end. Opaque to the caller. */
  readonly nextCursor: string | null;
  readonly limit: number;
}

export async function readPart(
  client: Pick<PoolClient, "query">, tenantId: string, partId: string,
): Promise<CanonicalPart | null> {
  if (typeof partId !== "string" || partId.trim() === "") return null;
  const { rows } = await client.query(`${PART_SELECT} WHERE tenant_id = $1 AND id = $2`, [tenantId, partId]);
  return rows.length === 0 ? null : partFromRow(rows[0]);
}

/**
 * The ids a page is already showing, resolved to their canonical names.
 *
 * Deliberately NOT "give me everything so I can look them up myself": the resolver knows exactly
 * which ids it needs, and asking for those is the difference between a bounded read and the whole
 * catalogue. Unknown ids are simply absent from the result -- a caller asking about a Part that does
 * not exist gets silence about it, not an error about the rest.
 */
export async function readPartsByIds(
  client: Pick<PoolClient, "query">, tenantId: string, partIds: readonly string[],
): Promise<readonly CanonicalPart[]> {
  const ids = [...new Set((partIds ?? []).filter((id) => typeof id === "string" && id.trim() !== ""))];
  if (ids.length === 0) return [];
  if (ids.length > PART_BY_IDS_MAX) {
    throw new Error(`readPartsByIds accepts at most ${PART_BY_IDS_MAX} ids; a larger question is a search`);
  }
  const { rows } = await client.query(
    `${PART_SELECT} WHERE tenant_id = $1 AND id = ANY($2::text[]) ORDER BY id`, [tenantId, ids]);
  return rows.map(partFromRow);
}

/** A caller's statement of order. Absent means the historical `ORDER BY id` with an `id > cursor` cursor. */
export interface PartSearchSort {
  readonly field: PartSearchSortField;
  readonly direction: "ASC" | "DESC";
}

export interface PartSearchFilters {
  /** Matched against the part id, internal part number and name. Case-insensitive, substring. */
  readonly query?: string;
  /** ONE governed status (EQUALS). Mutually exclusive with `statuses`. */
  readonly status?: string | null;
  /** Several governed statuses (IN). Non-empty; each value must be a governed status. */
  readonly statuses?: readonly string[] | null;
  /** ONE governed stocking class (EQUALS). Mutually exclusive with `stockingClasses`. */
  readonly stockingClass?: string | null;
  /** Several governed stocking classes (IN). */
  readonly stockingClasses?: readonly string[] | null;
  /**
   * GOVERNED FILTERS, applied in PostgreSQL.
   *
   * The whole-unit and serial-tracked pickers each need one of these. They are part of the query
   * CONTRACT rather than something a caller filters for itself, because the alternative is fetching
   * the catalogue to the browser and narrowing it there -- which is the behaviour this module exists
   * to make unreachable. Extending the contract is the cheaper answer, and the only honest one.
   */
  readonly controlType?: string | null;
  readonly wholeUnit?: boolean | null;
}

export interface PartSearchInput extends PartSearchFilters {
  readonly limit?: number;
  /** The `nextCursor` from a previous page, produced under the SAME sort. */
  readonly cursor?: string | null;
  /** Absent: ORDER BY id, exactly as before the Part Master screen moved here. */
  readonly sort?: PartSearchSort | null;
}

// ════════════════════ THE GOVERNED QUERY VOCABULARY ════════════════════
//
// Every value a caller may filter or sort by is checked against the SAME enums the Part authority
// writes with, and anything else is REFUSED. Passing an unknown value through would not fail: it
// would match nothing and the screen would say "no parts", which is a false statement about the
// catalogue rather than an error anybody could see.

export const PART_STATUS_VALUES = Object.freeze([...PART_STATUSES]);
export const PART_STOCKING_CLASS_VALUES = Object.freeze([...STOCKING_CLASSES]);
export const PART_CONTROL_TYPE_VALUES = Object.freeze([...CONTROL_TYPES]);

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
} as const);
export type PartSearchSortField = keyof typeof SORT_SQL;
export const PART_SEARCH_SORT_FIELDS: readonly PartSearchSortField[] = Object.freeze(Object.keys(SORT_SQL) as PartSearchSortField[]);

/** The ceiling on an IN list. No governed enum is longer; a longer list is not a real question. */
const IN_MAX = 16;
const PART_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
/** A KEYSET cursor. `.` is outside the Part id alphabet, so no id-only cursor can ever carry it. */
const KEYSET_PREFIX = "k1.";

const invalid = (code: string, message: string): never => refuse(code, "INVALID_INPUT", message);

const absentString = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

function oneOf(name: string, v: unknown, allowed: readonly string[]): string | null {
  if (absentString(v)) return null;
  if (typeof v !== "string") return invalid("SEARCH_FILTER_MALFORMED", `${name} must be a string`);
  const value = v.trim();
  if (!allowed.includes(value)) return invalid("SEARCH_FILTER_UNKNOWN_VALUE", `${name} "${value}" is not one of ${allowed.join(", ")}`);
  return value;
}

function manyOf(name: string, v: unknown, allowed: readonly string[]): string[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) return invalid("SEARCH_FILTER_MALFORMED", `${name} must be an array`);
  // An EMPTY IN matches nothing. Refused rather than executed: a screen that sent one has lost its
  // criteria somewhere, and "no parts" would hide that.
  if (v.length === 0) return invalid("SEARCH_FILTER_MALFORMED", `${name} must not be empty`);
  if (v.length > IN_MAX) return invalid("SEARCH_FILTER_MALFORMED", `${name} accepts at most ${IN_MAX} values`);
  const out = new Set<string>();
  for (const item of v) {
    if (typeof item !== "string") return invalid("SEARCH_FILTER_MALFORMED", `${name} values must be strings`);
    if (!allowed.includes(item)) return invalid("SEARCH_FILTER_UNKNOWN_VALUE", `${name} value "${item}" is not one of ${allowed.join(", ")}`);
    out.add(item);
  }
  return [...out];
}

/** EQUALS and IN on one field, resolved to one list -- and both at once refused, never guessed between. */
function enumFilter(single: string, plural: string, input: Record<string, unknown>, allowed: readonly string[]): string[] | null {
  const one = oneOf(single, input[single], allowed);
  const many = manyOf(plural, input[plural], allowed);
  if (one !== null && many !== null) {
    return invalid("SEARCH_FILTER_AMBIGUOUS", `${single} and ${plural} cannot both be given`);
  }
  return one !== null ? [one] : many;
}

interface WhereClause { readonly sql: string; readonly values: unknown[] }

/**
 * The ONE statement of what a search filter means, shared by the page and its count so a total can
 * never describe a different set from the rows under it.
 */
function buildFilterWhere(tenantId: string, input: PartSearchFilters): WhereClause {
  const raw = input as unknown as Record<string, unknown>;
  const values: unknown[] = [tenantId];
  const clauses: string[] = ["tenant_id = $1"];
  const bind = (v: unknown) => { values.push(v); return `$${values.length}`; };

  if (raw.query !== undefined && raw.query !== null && typeof raw.query !== "string") {
    invalid("SEARCH_FILTER_MALFORMED", "query must be a string");
  }
  const q = typeof raw.query === "string" && raw.query.trim() !== "" ? raw.query.trim() : null;
  if (q !== null) {
    const p = bind(q);
    clauses.push(`(id ILIKE '%' || ${p} || '%' OR internal_part_number ILIKE '%' || ${p} || '%' OR name ILIKE '%' || ${p} || '%')`);
  }
  const statuses = enumFilter("status", "statuses", raw, PART_STATUS_VALUES);
  if (statuses) clauses.push(`status::text = ANY(${bind(statuses)}::text[])`);
  const classes = enumFilter("stockingClass", "stockingClasses", raw, PART_STOCKING_CLASS_VALUES);
  if (classes) clauses.push(`stocking_class::text = ANY(${bind(classes)}::text[])`);
  const controlType = oneOf("controlType", raw.controlType, PART_CONTROL_TYPE_VALUES);
  if (controlType !== null) clauses.push(`control_type::text = ${bind(controlType)}`);
  if (raw.wholeUnit !== undefined && raw.wholeUnit !== null) {
    if (typeof raw.wholeUnit !== "boolean") invalid("SEARCH_FILTER_MALFORMED", "wholeUnit must be a boolean");
    clauses.push(`whole_unit = ${bind(raw.wholeUnit)}`);
  }
  return { sql: clauses.join("\n        AND "), values };
}

function resolveSort(v: unknown): PartSearchSort | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return invalid("SEARCH_SORT_MALFORMED", "sort must be { field, direction }");
  const { field, direction } = v as Record<string, unknown>;
  if (typeof field !== "string" || !Object.prototype.hasOwnProperty.call(SORT_SQL, field)) {
    return invalid("SEARCH_SORT_UNKNOWN_FIELD", `sort field must be one of ${PART_SEARCH_SORT_FIELDS.join(", ")}`);
  }
  if (direction !== "ASC" && direction !== "DESC") return invalid("SEARCH_SORT_MALFORMED", "sort direction must be ASC or DESC");
  return Object.freeze({ field: field as PartSearchSortField, direction });
}

interface KeysetCursor { readonly f: PartSearchSortField; readonly d: "ASC" | "DESC"; readonly v: string; readonly id: string }

function encodeKeyset(c: KeysetCursor): string {
  return KEYSET_PREFIX + Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/**
 * A keyset cursor, CHECKED against the sort it is being replayed under.
 *
 * A cursor taken under "part number, descending" and replayed under "status, ascending" is a
 * position in a different ordering. Applied, it would silently skip or repeat rows; refused, the
 * screen restarts from the first page. Refusal is the only answer that cannot be wrong.
 */
function decodeKeyset(raw: string, sort: PartSearchSort): KeysetCursor {
  if (!raw.startsWith(KEYSET_PREFIX)) {
    return invalid("SEARCH_CURSOR_SORT_MISMATCH", "this cursor was not produced under the requested sort");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.slice(KEYSET_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    return invalid("SEARCH_CURSOR_MALFORMED", "the cursor could not be read");
  }
  const c = parsed as Partial<KeysetCursor> | null;
  if (!c || typeof c !== "object" || typeof c.v !== "string" || typeof c.id !== "string" || !PART_ID_SHAPE.test(c.id)) {
    return invalid("SEARCH_CURSOR_MALFORMED", "the cursor could not be read");
  }
  if (c.f !== sort.field || c.d !== sort.direction) {
    return invalid("SEARCH_CURSOR_SORT_MISMATCH", "this cursor was produced under a different sort");
  }
  return c as KeysetCursor;
}

/** The sort value a Part carries, in the exact text the cursor predicate will compare against. */
function sortValueOf(part: CanonicalPart, field: PartSearchSortField): string {
  // Timestamps come back from PART_SELECT with six fractional digits in UTC, so the value
  // round-trips through ::timestamptz without losing the microseconds PostgreSQL ordered by.
  return String((part as unknown as Record<string, unknown>)[field]);
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
export async function searchParts(
  client: Pick<PoolClient, "query">, tenantId: string, input: PartSearchInput = {},
): Promise<PartSearchPage> {
  const requested = Number.isSafeInteger(input.limit) ? (input.limit as number) : PART_SEARCH_DEFAULT_LIMIT;
  const limit = Math.min(Math.max(requested, 1), PART_SEARCH_MAX_LIMIT);
  const rawCursor = (input as unknown as Record<string, unknown>).cursor;
  if (rawCursor !== undefined && rawCursor !== null && typeof rawCursor !== "string") {
    invalid("SEARCH_CURSOR_MALFORMED", "cursor must be a string");
  }
  const cursor = typeof rawCursor === "string" && rawCursor.trim() !== "" ? rawCursor.trim() : null;
  const sort = resolveSort((input as unknown as Record<string, unknown>).sort);
  const where = buildFilterWhere(tenantId, input);
  const values = [...where.values];
  const bind = (v: unknown) => { values.push(v); return `$${values.length}`; };

  let keyset = "";
  let orderBy: string;
  if (sort === null) {
    if (cursor !== null) {
      // A keyset token in id mode is a position in some OTHER ordering. `.` cannot occur in a Part
      // id, so an id cursor can never be mistaken for one.
      if (cursor.startsWith(KEYSET_PREFIX)) invalid("SEARCH_CURSOR_SORT_MISMATCH", "this cursor was produced under a sort; resend that sort or start again");
      keyset = `\n        AND id > ${bind(cursor)}`;
    }
    orderBy = "ORDER BY id";
  } else {
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

  const { rows } = await client.query(
    `${PART_SELECT}
      WHERE ${where.sql}${keyset}
      ${orderBy}
      LIMIT ${bind(limit + 1)}`,
    values,
  );
  // One row beyond the page is read to decide whether there IS a next page, and is then dropped. A
  // caller is never told "there might be more" on a guess.
  const page = rows.slice(0, limit).map(partFromRow);
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
export async function countParts(
  client: Pick<PoolClient, "query">, tenantId: string, filters: PartSearchFilters = {},
): Promise<number> {
  const where = buildFilterWhere(tenantId, filters ?? {});
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.parts WHERE ${where.sql}`, where.values);
  return Number(rows[0].n);
}
