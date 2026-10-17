// THE GOVERNED LIST QUERY -- the narrow, I/O-free validator and SQL compiler every EOS Core list that adopts the site-wide
// filtering and sorting standard calls from its OWN kernel (Owner decisions 2026-10-15, ND-1 / ND-2 / ND-5 / ND-7;
// design: docs/architecture/object-filter-sort-standard.md §3-§4).
//
// WHAT IT IS. A kernel declares a BINDING: for each governed field id (the metadata id the client uses), the SQL expression
// it may filter, sort or search by, the field type, and the operator ceiling. Per request the kernel narrows that binding to
// the caller -- field-group read access, tenant narrowing, the caller's own picklist values (e.g. their authorized
// companies) -- and hands the EFFECTIVE set here with the client's raw query. This module then:
//   * refuses anything the effective set does not contain (fail closed; client field names and operators are never trusted);
//   * compiles the survivors into parameterized SQL: every value is a bind parameter, every SQL fragment comes from the
//     server binding, never from the request;
//   * orders deterministically: the requested clauses, NULLs LAST in BOTH directions (ND-7), then the binding's id;
//   * pages by KEYSET, never offset. The cursor is bound to the object and to a fingerprint of the normalized query and the
//     caller's scope, so it can only reposition inside the ordering it came from.
//
// WHAT IT IS NOT. It reads nothing, resolves no authority and returns no counts (ND-2). It is not a generic query language:
// conditions are ANDed, at most one hop through a relationship the binding names, and nothing else.
//
// DISCLOSURE. An unknown field and a field the caller may not read get the SAME refusal and the same message -- telling them
// apart would disclose that a restricted field exists. No refusal echoes a value.
import { createHash } from "node:crypto";

export const LIST_QUERY_VERSION = 1;
export const LIST_QUERY_LIMITS = Object.freeze({ filters: 10, sort: 2, inValues: 50, text: 100, pageDefault: 50, pageMax: 200, cursor: 4096 });

export type ListFieldType = "ENUM" | "STRING" | "TEXT" | "NUMBER" | "TIMESTAMP" | "REFERENCE";
export const LIST_OPERATORS = Object.freeze([
  "EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL",
  "TEXT_PREFIX", "TEXT_CONTAINS", "IS_NULL", "IS_NOT_NULL",
] as const);
export type ListOperator = (typeof LIST_OPERATORS)[number];

/** The ceiling per type (design §3.3). A binding may offer fewer, never more. */
export const TYPE_OPERATORS: Readonly<Record<ListFieldType, readonly ListOperator[]>> = Object.freeze({
  ENUM: ["EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "IS_NULL", "IS_NOT_NULL"],
  STRING: ["EQUALS", "TEXT_PREFIX", "TEXT_CONTAINS", "IS_NULL", "IS_NOT_NULL"],
  TEXT: ["TEXT_CONTAINS"],
  NUMBER: ["EQUALS", "GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL", "IS_NULL", "IS_NOT_NULL"],
  TIMESTAMP: ["GREATER_OR_EQUAL", "LESS_THAN", "IS_NULL", "IS_NOT_NULL"],
  REFERENCE: ["EQUALS", "IN", "IS_NULL", "IS_NOT_NULL"],
});
const NULL_OPERATORS: readonly ListOperator[] = ["IS_NULL", "IS_NOT_NULL"];
const LIST_VALUE_OPERATORS: readonly ListOperator[] = ["IN", "NOT_IN"];

export interface ListFieldBinding {
  readonly type: ListFieldType;
  /** Can the filtered expression be NULL? Only then are IS_NULL / IS_NOT_NULL meaningful. */
  readonly nullable: boolean;
  readonly filter?: {
    /** The SQL value expression compared against a bind parameter. Exactly one of expr / exists. */
    readonly expr?: string;
    /** A relationship predicate, `{v}` standing for the bound value. EQUALS only. */
    readonly exists?: string;
    /** The parameter cast, e.g. "text", "timestamptz", "smallint". */
    readonly cast: string;
    readonly operators: readonly ListOperator[];
  };
  /** Sort expression and the cast its cursor value is compared with. `nullable` adds the NULLS-LAST indicator key. */
  readonly sort?: { readonly expr: string; readonly cast: string; readonly nullable: boolean };
  /** A text expression ORed into the list's search (ILIKE). */
  readonly search?: string;
  /** ENUM members. "CALLER" = supplied per request (e.g. the caller's authorized companies), never the tenant's whole set. */
  readonly values?: readonly (string | number)[] | "CALLER";
}

export interface ListBinding {
  readonly objectKey: string;
  readonly id: { readonly expr: string; readonly cast: string };
  readonly fields: Readonly<Record<string, ListFieldBinding>>;
  readonly defaultSort: readonly ListSort[];
}

export interface ListSort { readonly field: string; readonly dir: "ASC" | "DESC" }
export interface ListFilter { readonly field: string; readonly op: ListOperator; readonly value?: unknown }

const SAFE_ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CAST = /^[a-z_][a-z0-9_.]*$/;

/** Validate a binding once, at module load. A binding that promises what its type cannot serve is a programming error. */
export function defineListBinding(b: ListBinding): ListBinding {
  const fail = (m: string): never => { throw new Error(`listQuery binding ${b.objectKey}: ${m}`); };
  if (!CAST.test(b.id.cast)) fail("id cast is not a plain type name");
  for (const [id, f] of Object.entries(b.fields)) {
    if (!SAFE_ID.test(id)) fail(`field id ${id} is not a plain identifier`);
    if (!(f.type in TYPE_OPERATORS)) fail(`${id}: unknown type ${f.type}`);
    if (f.filter) {
      if ((f.filter.expr === undefined) === (f.filter.exists === undefined)) fail(`${id}: filter needs exactly one of expr / exists`);
      if (!CAST.test(f.filter.cast)) fail(`${id}: filter cast is not a plain type name`);
      if (f.filter.operators.length === 0) fail(`${id}: a filter with no operators`);
      for (const op of f.filter.operators) {
        if (!TYPE_OPERATORS[f.type].includes(op)) fail(`${id}: ${op} is above the ${f.type} ceiling`);
        if (NULL_OPERATORS.includes(op) && !f.nullable) fail(`${id}: ${op} on a field that is never NULL`);
      }
      if (f.filter.exists !== undefined && (f.filter.operators.join() !== "EQUALS" || !f.filter.exists.includes("{v}"))) {
        fail(`${id}: a relationship filter is EQUALS only and must bind {v}`);
      }
    }
    if (f.type === "ENUM" && f.filter && f.filter.operators.some((op) => !NULL_OPERATORS.includes(op)) && f.values === undefined) {
      fail(`${id}: an ENUM filter needs governed values`);
    }
    if (f.type !== "ENUM" && f.values !== undefined) fail(`${id}: values are only meaningful on an ENUM`);
    if (f.sort && (!CAST.test(f.sort.cast) || f.type === "TEXT")) fail(`${id}: unsortable sort binding`);
    if (f.search !== undefined && !["STRING", "TEXT", "REFERENCE"].includes(f.type)) fail(`${id}: search on a ${f.type}`);
  }
  for (const s of b.defaultSort) if (!b.fields[s.field]?.sort) fail(`default sort ${s.field} is not sortable`);
  return Object.freeze({ ...b, fields: Object.freeze({ ...b.fields }), defaultSort: Object.freeze([...b.defaultSort]) });
}

export interface EffectiveField {
  readonly binding: ListFieldBinding;
  readonly operators: readonly ListOperator[];
  readonly sortable: boolean;
  readonly searchable: boolean;
  /** Canonical ENUM members this caller may use, or null for a non-ENUM. */
  readonly values: readonly (string | number)[] | null;
}
export interface EffectiveListFields {
  readonly binding: ListBinding;
  readonly fields: ReadonlyMap<string, EffectiveField>;
}

/** Tenant narrowing (design §7): each flag can only switch an ability OFF. */
export interface ListFieldNarrowing { readonly filter?: false; readonly sort?: false; readonly search?: false }

/**
 * The binding narrowed to ONE caller: a field the caller may not read is absent altogether; tenant narrowing switches
 * abilities off; a CALLER-valued ENUM takes the caller's own values (no values = no filter on it).
 */
export function effectiveListFields(binding: ListBinding, opts: {
  readonly readable: (fieldId: string) => boolean;
  readonly narrowing?: Readonly<Record<string, ListFieldNarrowing>>;
  readonly callerValues?: Readonly<Record<string, readonly string[]>>;
}): EffectiveListFields {
  const fields = new Map<string, EffectiveField>();
  for (const [id, b] of Object.entries(binding.fields)) {
    if (!opts.readable(id)) continue;
    const n = opts.narrowing?.[id] ?? {};
    const values = b.values === undefined ? null : b.values === "CALLER" ? [...(opts.callerValues?.[id] ?? [])] : [...b.values];
    const valueless = values !== null && values.length === 0;
    const operators = n.filter === false || !b.filter ? [] : b.filter.operators.filter((op) => !(valueless && !NULL_OPERATORS.includes(op)));
    const sortable = n.sort !== false && b.sort !== undefined;
    const searchable = n.search !== false && b.search !== undefined;
    if (operators.length === 0 && !sortable && !searchable) continue;
    fields.set(id, Object.freeze({ binding: b, operators: Object.freeze(operators), sortable, searchable, values: values && Object.freeze(values) }));
  }
  return Object.freeze({ binding, fields });
}

export type ListQueryErrorCode =
  | "LIST_QUERY_INVALID" | "LIST_QUERY_FIELD_NOT_AVAILABLE" | "LIST_QUERY_OPERATOR_NOT_AVAILABLE"
  | "LIST_QUERY_VALUE_INVALID" | "LIST_QUERY_SORT_NOT_AVAILABLE" | "LIST_QUERY_SEARCH_INVALID" | "LIMIT_INVALID" | "CURSOR_INVALID";

/** A refusal. Its message never carries a request value, a field label, a group or a reason. */
export class ListQueryError extends Error {
  constructor(readonly code: ListQueryErrorCode, message: string) {
    super(message);
    this.name = "ListQueryError";
  }
}
const refuse = (code: ListQueryErrorCode, message: string): never => { throw new ListQueryError(code, message); };

export interface NormalizedListQuery {
  readonly filters: readonly ListFilter[];
  readonly sort: readonly ListSort[];
  readonly search: string | null;
  readonly limit: number;
  readonly cursor: readonly (string | null)[] | null;
  /** Binds the cursor to this exact query and scope. */
  readonly fingerprint: string;
}

const QUERY_KEYS = ["v", "filters", "sort", "search", "limit", "cursor"];
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const ID_SHAPE = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const TEXT_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "" && v.length <= LIST_QUERY_LIMITS.text && !v.includes("\u0000");
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

function scalarValue(f: EffectiveField, raw: unknown, at: string): string | number {
  const bad = (): never => refuse("LIST_QUERY_VALUE_INVALID", `${at} has a value this field does not accept`);
  switch (f.binding.type) {
    case "ENUM": {
      const member = (f.values ?? []).find((v) => typeof raw === typeof v && v === raw);
      return member === undefined ? bad() : member;
    }
    case "REFERENCE": return ID_SHAPE(raw) ? raw : bad();
    case "STRING": case "TEXT": return TEXT_SHAPE(raw) ? raw.trim() : bad();
    case "NUMBER": return typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) <= 1e12 ? raw : bad();
    case "TIMESTAMP": return typeof raw === "string" && ISO_INSTANT.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : bad();
  }
}

const fingerprintOf = (objectKey: string, q: Omit<NormalizedListQuery, "cursor" | "fingerprint" | "limit">, scope: readonly string[]): string =>
  createHash("sha256").update(JSON.stringify([objectKey, q.filters, q.sort, q.search, [...scope].sort()])).digest("base64url").slice(0, 32);

/**
 * Validate a raw client query against the caller's EFFECTIVE fields. `scope` is the caller's row scope (e.g. their company
 * keys): a cursor minted under a different scope is refused.
 */
export function validateListQuery(raw: unknown, eff: EffectiveListFields, scope: readonly string[] = []): NormalizedListQuery {
  if (!isObject(raw)) refuse("LIST_QUERY_INVALID", "query must be an object");
  const q = raw as Record<string, unknown>;
  const extra = Object.keys(q).filter((k) => !QUERY_KEYS.includes(k));
  if (extra.length > 0) refuse("LIST_QUERY_INVALID", "query carries keys this list does not accept");
  if (q.v !== LIST_QUERY_VERSION) refuse("LIST_QUERY_INVALID", `query.v must be ${LIST_QUERY_VERSION}`);

  const filters: ListFilter[] = [];
  const rawFilters = q.filters ?? [];
  if (!Array.isArray(rawFilters) || rawFilters.length > LIST_QUERY_LIMITS.filters) {
    refuse("LIST_QUERY_INVALID", `filters is a list of at most ${LIST_QUERY_LIMITS.filters} conditions`);
  }
  const seen = new Set<string>();
  (rawFilters as unknown[]).forEach((rf, n) => {
    const at = `filter ${n + 1}`;
    if (!isObject(rf) || Object.keys(rf).some((k) => !["field", "op", "value"].includes(k))) refuse("LIST_QUERY_INVALID", `${at} must be { field, op, value }`);
    const r = rf as Record<string, unknown>;
    const f = typeof r.field === "string" ? eff.fields.get(r.field) : undefined;
    if (!f || f.operators.length === 0) refuse("LIST_QUERY_FIELD_NOT_AVAILABLE", `${at} names a field that is not available for filtering on this list`);
    const field = r.field as string;
    const op = r.op as ListOperator;
    if (typeof r.op !== "string" || !f!.operators.includes(op)) refuse("LIST_QUERY_OPERATOR_NOT_AVAILABLE", `${at} uses an operator this field does not offer`);
    if (seen.has(`${field}:${op}`)) refuse("LIST_QUERY_INVALID", `${at} repeats a condition`);
    seen.add(`${field}:${op}`);
    if (NULL_OPERATORS.includes(op)) {
      if (r.value !== undefined && r.value !== null) refuse("LIST_QUERY_VALUE_INVALID", `${at} takes no value`);
      filters.push(Object.freeze({ field, op }));
    } else if (LIST_VALUE_OPERATORS.includes(op)) {
      if (!Array.isArray(r.value) || r.value.length === 0 || r.value.length > LIST_QUERY_LIMITS.inValues) {
        refuse("LIST_QUERY_VALUE_INVALID", `${at} takes a list of 1..${LIST_QUERY_LIMITS.inValues} values`);
      }
      const values = [...new Set((r.value as unknown[]).map((v) => scalarValue(f!, v, at)))];
      filters.push(Object.freeze({ field, op, value: Object.freeze(values) }));
    } else {
      filters.push(Object.freeze({ field, op, value: scalarValue(f!, r.value, at) }));
    }
  });

  const rawSort = q.sort ?? [];
  if (!Array.isArray(rawSort) || rawSort.length > LIST_QUERY_LIMITS.sort) refuse("LIST_QUERY_INVALID", `sort is a list of at most ${LIST_QUERY_LIMITS.sort} clauses`);
  const sort: ListSort[] = [];
  (rawSort as unknown[]).forEach((rs, n) => {
    const at = `sort ${n + 1}`;
    if (!isObject(rs) || Object.keys(rs).some((k) => !["field", "dir"].includes(k))) refuse("LIST_QUERY_INVALID", `${at} must be { field, dir }`);
    const r = rs as Record<string, unknown>;
    const f = typeof r.field === "string" ? eff.fields.get(r.field) : undefined;
    if (!f || !f.sortable) refuse("LIST_QUERY_SORT_NOT_AVAILABLE", `${at} names a field that is not available for sorting on this list`);
    if (r.dir !== "ASC" && r.dir !== "DESC") refuse("LIST_QUERY_INVALID", `${at}.dir is ASC or DESC`);
    if (sort.some((s) => s.field === r.field)) refuse("LIST_QUERY_INVALID", `${at} repeats a field`);
    sort.push(Object.freeze({ field: r.field as string, dir: r.dir as "ASC" | "DESC" }));
  });
  const effectiveSort = sort.length > 0 ? sort : eff.binding.defaultSort.filter((s) => eff.fields.get(s.field)?.sortable);

  let search: string | null = null;
  if (q.search !== undefined && q.search !== null) {
    if (!TEXT_SHAPE(q.search)) refuse("LIST_QUERY_SEARCH_INVALID", `search is a non-empty string of at most ${LIST_QUERY_LIMITS.text} characters`);
    if (![...eff.fields.values()].some((f) => f.searchable)) refuse("LIST_QUERY_SEARCH_INVALID", "this list offers no search");
    search = (q.search as string).trim();
  }

  const limit = q.limit === undefined ? LIST_QUERY_LIMITS.pageDefault : q.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > LIST_QUERY_LIMITS.pageMax) {
    refuse("LIMIT_INVALID", `limit is an integer 1..${LIST_QUERY_LIMITS.pageMax}`);
  }

  const base = { filters: Object.freeze(filters), sort: Object.freeze(effectiveSort), search };
  const fingerprint = fingerprintOf(eff.binding.objectKey, base, scope);
  const cursor = q.cursor === undefined || q.cursor === null ? null
    : decodeListCursor(q.cursor, eff.binding.objectKey, fingerprint, keysFor(eff, effectiveSort).length);
  return Object.freeze({ ...base, limit: limit as number, cursor, fingerprint });
}

interface OrderKey { readonly expr: string; readonly cast: string; readonly dir: "ASC" | "DESC" }

/** The total order: each clause (a nullable one led by its IS NULL indicator -- NULLs last both ways), then the id. */
function keysFor(eff: EffectiveListFields, sort: readonly ListSort[]): OrderKey[] {
  const keys: OrderKey[] = [];
  for (const s of sort) {
    const b = eff.binding.fields[s.field].sort!;
    if (b.nullable) keys.push({ expr: `(${b.expr} IS NULL)`, cast: "boolean", dir: "ASC" });
    keys.push({ expr: b.expr, cast: b.cast, dir: s.dir });
  }
  keys.push({ expr: eff.binding.id.expr, cast: eff.binding.id.cast, dir: sort.length > 0 ? sort[sort.length - 1].dir : "ASC" });
  return keys;
}

export function encodeListCursor(objectKey: string, fingerprint: string, keyValues: readonly (string | null)[]): string {
  return Buffer.from(JSON.stringify({ v: LIST_QUERY_VERSION, o: objectKey, f: fingerprint, k: keyValues })).toString("base64url");
}

/** A cursor repositions inside ONE authorized ordering. Anything else is refused -- never silently restarted. */
export function decodeListCursor(raw: unknown, objectKey: string, fingerprint: string, keyCount: number): readonly (string | null)[] {
  const bad = (): never => refuse("CURSOR_INVALID", "the cursor does not belong to this list query; start again from the first page");
  if (typeof raw !== "string" || raw.length === 0 || raw.length > LIST_QUERY_LIMITS.cursor || !/^[A-Za-z0-9_-]+$/.test(raw)) bad();
  let c: unknown;
  try { c = JSON.parse(Buffer.from(raw as string, "base64url").toString("utf8")); } catch { bad(); }
  if (!isObject(c) || Object.keys(c).sort().join() !== "f,k,o,v") bad();
  const cur = c as Record<string, unknown>;
  if (cur.v !== LIST_QUERY_VERSION || cur.o !== objectKey || cur.f !== fingerprint) bad();
  if (!Array.isArray(cur.k) || cur.k.length !== keyCount || cur.k.some((v) => v !== null && (typeof v !== "string" || v.length > 500))) bad();
  return Object.freeze([...(cur.k as (string | null)[])]);
}

const likeEscape = (s: string): string => s.replace(/[\\%_]/g, "\\$&");

export interface CompiledListQuery {
  /** ANDed predicates, each safe to append after `WHERE ... AND`. Empty array = no narrowing. */
  readonly predicates: readonly string[];
  /** `ORDER BY` body. */
  readonly orderBy: string;
  /** Extra SELECT list items (`, expr::text AS lq_k0 ...`) carrying the cursor key of each row. */
  readonly selectKeys: string;
  readonly keyCount: number;
  readonly limit: number;
}

/**
 * Compile a VALIDATED query. `params` is the kernel's parameter array; values are appended to it and referenced by
 * position, so the kernel's own parameters ($1 tenant, scope, ...) stay first.
 */
export function compileListQuery(eff: EffectiveListFields, q: NormalizedListQuery, params: unknown[]): CompiledListQuery {
  const bind = (v: unknown, cast: string): string => { params.push(v); return `$${params.length}::${cast}`; };
  const predicates: string[] = [];
  for (const f of q.filters) {
    const b = eff.binding.fields[f.field].filter!;
    const e = b.expr!;
    switch (f.op) {
      case "EQUALS":
        predicates.push(b.exists !== undefined ? b.exists.split("{v}").join(bind(f.value, b.cast)) : `${e} = ${bind(f.value, b.cast)}`);
        break;
      case "NOT_EQUALS": predicates.push(`${e} IS DISTINCT FROM ${bind(f.value, b.cast)}`); break;
      case "IN": predicates.push(`${e} = ANY(${bind(f.value, `${b.cast}[]`)})`); break;
      case "NOT_IN": predicates.push(`(${e} IS NULL OR NOT (${e} = ANY(${bind(f.value, `${b.cast}[]`)})))`); break;
      case "GREATER_THAN": predicates.push(`${e} > ${bind(f.value, b.cast)}`); break;
      case "GREATER_OR_EQUAL": predicates.push(`${e} >= ${bind(f.value, b.cast)}`); break;
      case "LESS_THAN": predicates.push(`${e} < ${bind(f.value, b.cast)}`); break;
      case "LESS_OR_EQUAL": predicates.push(`${e} <= ${bind(f.value, b.cast)}`); break;
      case "TEXT_PREFIX": predicates.push(`${e} ILIKE ${bind(`${likeEscape(String(f.value))}%`, "text")}`); break;
      case "TEXT_CONTAINS": predicates.push(`${e} ILIKE ${bind(`%${likeEscape(String(f.value))}%`, "text")}`); break;
      case "IS_NULL": predicates.push(`${e} IS NULL`); break;
      case "IS_NOT_NULL": predicates.push(`${e} IS NOT NULL`); break;
    }
  }
  if (q.search !== null) {
    const exprs = [...eff.fields.values()].filter((f) => f.searchable).map((f) => f.binding.search!);
    const p = bind(`%${likeEscape(q.search)}%`, "text");
    predicates.push(`(${exprs.map((x) => `${x} ILIKE ${p}`).join(" OR ")})`);
  }

  const keys = keysFor(eff, q.sort);
  if (q.cursor !== null) {
    // Strictly AFTER the cursor row in the total order: OR over i of (keys < i equal AND key i beyond). A NULL cursor value
    // on a nullable expression has nothing after it within its indicator group, so that disjunct is omitted.
    const disjuncts: string[] = [];
    for (let i = 0; i < keys.length; i += 1) {
      if (q.cursor[i] === null) continue;
      const eq = keys.slice(0, i).map((k, j) => (q.cursor![j] === null ? `${k.expr} IS NULL` : `${k.expr} = ${bind(q.cursor![j], k.cast)}`));
      eq.push(`${keys[i].expr} ${keys[i].dir === "ASC" ? ">" : "<"} ${bind(q.cursor[i], keys[i].cast)}`);
      disjuncts.push(`(${eq.join(" AND ")})`);
    }
    predicates.push(disjuncts.length > 0 ? `(${disjuncts.join(" OR ")})` : "FALSE");
  }
  return Object.freeze({
    predicates: Object.freeze(predicates),
    orderBy: keys.map((k) => `${k.expr} ${k.dir}`).join(", "),
    selectKeys: keys.map((k, i) => `, (${k.expr})::text AS lq_k${i}`).join(""),
    keyCount: keys.length,
    limit: q.limit,
  });
}

/** Cut a `limit + 1` read into the page, `hasMore` and the next cursor (from the last KEPT row's lq_k* columns). */
export function pageOfListQuery<R extends Record<string, unknown>>(eff: EffectiveListFields, q: NormalizedListQuery, c: CompiledListQuery, rows: readonly R[]):
  { readonly rows: readonly R[]; readonly hasMore: boolean; readonly nextCursor: string | null } {
  const kept = rows.slice(0, c.limit);
  const hasMore = rows.length > c.limit;
  const last = kept[kept.length - 1];
  const nextCursor = hasMore && last
    ? encodeListCursor(eff.binding.objectKey, q.fingerprint, Array.from({ length: c.keyCount }, (_, i) => (last[`lq_k${i}`] ?? null) as string | null))
    : null;
  return Object.freeze({ rows: Object.freeze(kept), hasMore, nextCursor });
}

/** What the server APPLIED -- echoed so a client can show exactly the narrowing it got. */
export const appliedListQuery = (q: NormalizedListQuery) => Object.freeze({ filters: q.filters, sort: q.sort, search: q.search });

/** The caller's effective eligibility, for the client's field selector (design §3.5). No counts, no values beyond picklists. */
export function describeListQuery(eff: EffectiveListFields) {
  const fields = [...eff.fields.entries()].map(([field, f]) => Object.freeze({
    field, type: f.binding.type, operators: f.operators, sortable: f.sortable, searchable: f.searchable,
    ...(f.values !== null ? { values: f.values } : {}),
  }));
  return Object.freeze({
    version: LIST_QUERY_VERSION, objectKey: eff.binding.objectKey, fields: Object.freeze(fields),
    search: Object.freeze(fields.filter((f) => f.searchable).map((f) => f.field)),
    defaultSort: eff.binding.defaultSort, limits: LIST_QUERY_LIMITS,
  });
}
