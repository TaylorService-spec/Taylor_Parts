// readGovernedList -- the one paginated, capability-resolved read for registered sources.
//
// ════════════════════ PAGINATION IS REAL, NOT A CAP ════════════════════
//
// A flat capped read is a silent correctness bug, not a simplification: a list of 500 accounts
// returned as "the first 200" looks complete on screen, and nothing anywhere says otherwise. So
// this pages properly, with `hasMore` derived by asking for one row more than the page and
// reporting whether it arrived -- never by comparing a count to the limit, which cannot tell a
// full last page from a truncated one.
//
// ════════════════════ THE CURSOR IS OPAQUE, AND VALIDATED ════════════════════
//
// The client receives a base64 token and cannot act on its contents. Server-side it is decoded,
// shape-checked, and REQUIRED to name the same sourceId it was issued for -- a cursor from the
// account directory replayed against contacts is refused rather than quietly used as a start
// position in a different collection's ordering.
//
// What the cursor deliberately does NOT do is carry authority. Tampering with it can only change
// WHERE the caller starts inside a result set they were already authorized for -- the capability is
// resolved on every call, before the query, from the caller's own assignments. A forged cursor
// therefore buys a different page of data the caller may already read, and nothing else. That is
// why it is validated rather than signed: signing would need a key to manage and would protect a
// property that is not load-bearing. Stated because "opaque" and "unforgeable" are different
// claims, and only the first one is being made.
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Role } from "../types/access";
import { resolveEffectivePermission, type TargetContext } from "./resolveEffectivePermission";
import { COMPATIBILITY_ROLES } from "./compatibilityRoles";
import { InvalidInputError, UnauthorizedActorError } from "./trustedWriterCommands";
import { GOVERNED_READS, DOCUMENT_ID_FIELD, type GovernedReadSource } from "./governedReadRegistry";
import { loadAssignedWarehouseScope } from "./assignedWarehouseScope";
import { FieldPath } from "firebase-admin/firestore";

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const DEFAULT_PAGE_SIZE = 50;

const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };

export interface ReadGovernedListInput {
  actorUid: string;
  sourceId: string;
  /** Values for the source's DECLARED filter names. Names, never fields or operators. */
  filters?: Record<string, unknown>;
  /** A sort TOKEN the source declares. Never a field name -- see resolveSort. */
  sortKey?: string;
  pageSize?: number;
  cursor?: string;
}

export interface GovernedListPage {
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface GovernedListDeps {
  db?: Firestore;
  roles?: Readonly<Record<string, Role>>;
  /** Injected by tests. Production derives the actor's assignment server-side; see resolveScopeBranches. */
  loadScope?: (uid: string) => Promise<readonly string[]>;
}

// ════════════════════ THE RECORD SCOPE ════════════════════
//
// A source may declare a `scope` (governedReadRegistry.ts's GovernedScopeSpec). When it does, the
// capability has already settled WHETHER this caller may read the source, and this settles WHICH
// records -- reproducing the assignment branch of the retired firestore.rules read predicate.
//
// THREE PROPERTIES THIS DELIBERATELY HAS:
//
//   The assignment is DERIVED, never supplied. It comes from the actor's uid. No request field
//   carries a warehouse id, so there is nothing for a caller to forge.
//
//   NO ASSIGNMENT MEANS GLOBAL, not empty. The retired rule was a disjunction: an operations
//   manager passed on isAdminOrDispatcher() and never reached isAssignedToWarehouse at all. A
//   person holding BOTH Operations Manager and Warehouse Manager therefore keeps the network --
//   resolving the narrow branch first would silently shrink them and return it without an error.
//
//   MORE THAN ONE FIELD IS A DISJUNCTION. Firestore has no OR across fields, so each field becomes
//   its own query and the results are unioned, de-duplicated by AUTHORITATIVE document id. A
//   transfer order between two assigned warehouses matches both branches and is returned once.

/** Firestore bounds an `in` filter. A wider assignment is chunked, never silently truncated. */
const IN_FILTER_LIMIT = 30;

interface ScopeClause {
  readonly field: string;
  readonly ids: readonly string[];
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * The scope clauses this read must run, or NULL for "one unscoped query" -- which covers both a
 * source that declares no scope and a caller who holds no assignment.
 */
async function resolveScopeBranches(
  spec: GovernedReadSource,
  actorUid: string,
  db: Firestore,
  deps: GovernedListDeps,
): Promise<readonly ScopeClause[] | null> {
  if (!spec.scope) return null;
  const load = deps.loadScope ?? ((uid: string) => loadAssignedWarehouseScope(uid, { db }));
  const assigned = await load(actorUid);
  if (assigned.length === 0) return null;
  return spec.scope.fields.flatMap((field) =>
    chunk(assigned, IN_FILTER_LIMIT).map((ids) => ({ field, ids })),
  );
}

/**
 * The value a document is ORDERED BY, reduced to something comparable in this process.
 *
 * The merge below has to reproduce Firestore's own ordering across branches, and `createdAt` is a
 * Timestamp -- an object, for which `<` is meaningless. Timestamps become millis; everything else
 * is compared as it stands. A missing value cannot appear here: orderBy EXCLUDES documents lacking
 * the ordered field, so every document in a branch carries one.
 */
function sortValue(doc: FirebaseFirestore.QueryDocumentSnapshot, orderField: string): unknown {
  if (orderField === DOCUMENT_ID_FIELD) return doc.id;
  const raw = (doc.data() as Record<string, unknown>)[orderField];
  const ts = raw as { toMillis?: () => number } | null;
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : raw;
}

/**
 * Union the branches into ONE ordered result, de-duplicated by authoritative document id.
 *
 * Ordered by (the sort field, then the document id) in the query's own direction -- the SAME total
 * ordering each branch was fetched in, which is what makes the page boundary and the cursor below
 * mean the same thing they mean for an unscoped read.
 */
function mergeBranches(
  snaps: readonly FirebaseFirestore.QuerySnapshot[],
  orderField: string,
  orderDir: "asc" | "desc",
): FirebaseFirestore.QueryDocumentSnapshot[] {
  const byId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const snap of snaps) {
    for (const doc of snap.docs) if (!byId.has(doc.id)) byId.set(doc.id, doc);
  }
  const sign = orderDir === "desc" ? -1 : 1;
  const rank = (a: unknown, b: unknown) => (a === b ? 0 : (a as never) < (b as never) ? -1 : 1);
  return [...byId.values()].sort((a, b) => {
    const primary = rank(sortValue(a, orderField), sortValue(b, orderField));
    return sign * (primary !== 0 ? primary : rank(a.id, b.id));
  });
}

function readAccessVersion(data: Record<string, unknown> | undefined): number {
  const raw = data?.accessVersion;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/**
 * Resolve the actor's authority through the SAME resolver the enforcement path uses, over their own
 * active assignments. `users/{uid}.role` is never consulted: that string is not an EOS authority.
 */
async function actorHolds(
  db: Firestore,
  roles: Readonly<Record<string, Role>>,
  actorUid: string,
  capability: string,
): Promise<boolean> {
  const [userSnap, assignmentsSnap] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(actorUid).get(),
    db
      .collection(ROLE_ASSIGNMENTS_COLLECTION)
      .where("principalUid", "==", actorUid)
      .where("status", "==", "active")
      .get(),
  ]);
  return (
    resolveEffectivePermission({
      permissionId: capability,
      assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
      roles,
      currentAccessVersion: readAccessVersion(userSnap.data() as Record<string, unknown> | undefined),
      target: GLOBAL_TARGET,
    }).decision === "ALLOW"
  );
}

interface CursorPayload {
  s: string; // sourceId this cursor was issued for
  v: unknown; // the orderBy field's value on the last row of the previous page
  d: string; // that row's document id -- the tiebreak, so equal values cannot loop
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(raw: string, sourceId: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new InvalidInputError("cursor is not a valid page token");
  }
  const p = parsed as CursorPayload;
  if (!p || typeof p !== "object" || typeof p.s !== "string" || typeof p.d !== "string") {
    throw new InvalidInputError("cursor is not a valid page token");
  }
  if (p.s !== sourceId) {
    // A cursor issued for one source replayed against another is refused rather than used as a
    // start position in a different collection's ordering.
    throw new InvalidInputError("cursor does not belong to this source");
  }
  return p;
}

/**
 * Turn the caller's named filter values into concrete clauses the registry declared.
 *
 * A name the source does not declare is refused BY NAME rather than ignored: a dropped filter
 * returns the whole collection where the caller asked for one account's contacts, which is both a
 * wrong answer and a disclosure.
 */
function resolveFilters(
  spec: GovernedReadSource,
  supplied: Record<string, unknown>,
): Array<{ field: string; op: FirebaseFirestore.WhereFilterOp; value: unknown }> {
  const out: Array<{ field: string; op: FirebaseFirestore.WhereFilterOp; value: unknown }> = [];
  for (const name of Object.keys(supplied)) {
    if (!spec.filters[name]) {
      const allowed = Object.keys(spec.filters).join(", ") || "none";
      throw new InvalidInputError(`"${name}" is not a filter on this source (allowed: ${allowed})`);
    }
  }
  for (const [name, f] of Object.entries(spec.filters)) {
    const value = supplied[name];
    if (value === undefined || value === null) {
      if (f.required) throw new InvalidInputError(`"${name}" is required on this source`);
      continue;
    }
    if (f.op === "in" && (!Array.isArray(value) || value.length === 0 || value.length > 30)) {
      throw new InvalidInputError(`"${name}" needs an array of 1..30 values`);
    }
    if (f.op === "prefix") {
      if (typeof value !== "string" || value.length === 0) {
        throw new InvalidInputError(`"${name}" needs a non-empty string`);
      }
      // The server builds the range; the caller never holds two open-ended comparison operators.
      //
      // \uf8ff is the standard high sentinel for a Firestore prefix scan -- a private-use code
      // point that sorts after every ordinary character -- so [term, term + \uf8ff] is exactly
      // "starts with term".
      //
      // Written as an ESCAPE, never as the literal character. The literal is invisible in most
      // editors and does not survive every tool that touches a file; it was lost once while
      // writing this, which silently reduced the range to `>= term AND <= term`, i.e. exact
      // equality. A typeahead that quietly matches only exact names reads as "no results yet"
      // rather than as a bug, which is the worst way for this to fail.
      out.push({ field: f.field, op: ">=" as const, value });
      out.push({ field: f.field, op: "<=" as const, value: `${value}\uf8ff` });
      continue;
    }
    out.push({ field: f.field, op: f.op, value });
  }
  return out;
}

/**
 * Resolve the caller's requested sort TOKEN to a field and direction the registry chose.
 *
 * THE CLIENT NAMES A SORT; IT NEVER NAMES A FIELD. `sortKey` is looked up in the source's own
 * allowlist and the resolved value comes from the registry -- the caller's string is compared, never
 * used. Passing a client-supplied field to orderBy() would let the browser order by anything it can
 * name: an unindexed query nobody proved, and an oracle besides, since Firestore's orderBy EXCLUDES
 * documents missing the ordered field and would let a caller probe which records carry which.
 *
 * A source with no allowlist has ONE ordering, and a caller asking for a sort on it is refused
 * rather than silently given the default -- a silently ignored sort shows the user a list that is
 * not in the order they asked for, with nothing saying so.
 */
function resolveSort(
  spec: GovernedReadSource,
  sortKey: string | undefined,
): readonly [string, "asc" | "desc"] {
  if (sortKey === undefined || sortKey === null || sortKey === "") {
    if (spec.allowedSorts && spec.defaultSort) {
      const fallback = spec.allowedSorts[spec.defaultSort];
      if (fallback) return [fallback.field, fallback.direction] as const;
    }
    return spec.orderBy;
  }
  if (!spec.allowedSorts) {
    throw new InvalidInputError("this source does not offer a choice of sort");
  }
  if (!Object.prototype.hasOwnProperty.call(spec.allowedSorts, sortKey)) {
    throw new InvalidInputError(
      `"${String(sortKey)}" is not an offered sort (allowed: ${Object.keys(spec.allowedSorts).join(", ")})`,
    );
  }
  const chosen = spec.allowedSorts[sortKey];
  return [chosen.field, chosen.direction] as const;
}

/** Apply the registry's projection. `null` means the whole document, deliberately. */
function project(spec: GovernedReadSource, id: string, data: Record<string, unknown>) {
  // THE DOCUMENT ID WINS, ALWAYS -- hence `id` LAST rather than first.
  //
  // `{ id, ...data }` reads naturally and is wrong: a document carrying its own stored `id` field
  // silently overwrites the authoritative Firestore document id, and every consumer keys, links and
  // navigates by that value. The registry collections are exactly where this bites -- the truck
  // registry's own read helper separates docId from data specifically because "the registry
  // contract fails closed on a stored-id conflict", and a projection that resolves that conflict
  // the other way would defeat it silently.
  //
  // A stored `id` that disagrees with the document id is corrupt data either way; this decides
  // which of the two a reader is handed, and the answer is the one Firestore guarantees.
  if (!spec.projection) return { ...data, id };
  const out: Record<string, unknown> = {};
  for (const field of spec.projection) {
    if (field in data) out[field] = data[field];
  }
  out.id = id;
  return out;
}

/**
 * One page of one registered source.
 *
 * Order of operations is deliberate: validate input, resolve authority, THEN query. An
 * unauthorized caller must not be able to measure a collection through timing, or through an error
 * that only a real query could have produced.
 */
export async function readGovernedList(
  input: ReadGovernedListInput,
  deps: GovernedListDeps = {},
): Promise<GovernedListPage> {
  const db = deps.db ?? getFirestore();
  const roles = deps.roles ?? COMPATIBILITY_ROLES;

  if (typeof input.actorUid !== "string" || !input.actorUid) {
    throw new InvalidInputError("actorUid is required");
  }
  const spec = Object.prototype.hasOwnProperty.call(GOVERNED_READS, input.sourceId)
    ? GOVERNED_READS[input.sourceId as keyof typeof GOVERNED_READS]
    : undefined;
  if (!spec) {
    // Names the refusal without confirming what does exist behind it.
    throw new InvalidInputError(`"${String(input.sourceId)}" is not a governed read source`);
  }

  const filters = resolveFilters(spec, (input.filters ?? {}) as Record<string, unknown>);

  let pageSize = DEFAULT_PAGE_SIZE;
  if (input.pageSize !== undefined) {
    if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > spec.maxPageSize) {
      throw new InvalidInputError(`pageSize must be an integer between 1 and ${spec.maxPageSize}`);
    }
    pageSize = input.pageSize;
  }
  const cursor = input.cursor ? decodeCursor(input.cursor, input.sourceId) : null;

  if (!(await actorHolds(db, roles, input.actorUid, spec.capability))) {
    throw new UnauthorizedActorError(`actor is not authorized for "${spec.capability}"`);
  }

  const [orderField, orderDir] = resolveSort(spec, input.sortKey);
  const branches = await resolveScopeBranches(spec, input.actorUid, db, deps);

  const buildQuery = (scopeClause: ScopeClause | null) => {
    let query = db.collection(spec.source) as FirebaseFirestore.Query;
    for (const f of filters) {
      // DOCUMENT_ID_FIELD is the registry's name for "the document id". Firestore addresses that as
      // FieldPath.documentId(), not as a field name, so the translation happens here -- the caller
      // never learns the id is addressed differently from any other field.
      query = query.where(
        f.field === DOCUMENT_ID_FIELD ? FieldPath.documentId() : f.field,
        f.op,
        f.value,
      );
    }
    // The scope clause is added AFTER the caller's named filters and cannot be displaced by one:
    // a filter narrows within the scope, never out of it.
    if (scopeClause) {
      query = query.where(
        scopeClause.field === DOCUMENT_ID_FIELD ? FieldPath.documentId() : scopeClause.field,
        "in",
        scopeClause.ids,
      );
    }
    // Ordered by the registry's field, then by document id. The id tiebreak is what makes the cursor
    // total: without it, rows sharing an orderBy value can be skipped or repeated across a boundary.
    query =
      orderField === DOCUMENT_ID_FIELD
        // Already ordered by id: a second __name__ ordering would be a duplicate orderBy and is also
        // unnecessary -- the id is unique, so it is its own tiebreak.
        ? query.orderBy(FieldPath.documentId(), orderDir)
        : query.orderBy(orderField, orderDir).orderBy(FieldPath.documentId(), orderDir);
    if (cursor) {
      query = orderField === DOCUMENT_ID_FIELD ? query.startAfter(cursor.d) : query.startAfter(cursor.v, cursor.d);
    }
    // One MORE than the page. `hasMore` is then observed rather than inferred -- comparing a
    // returned count to the limit cannot distinguish a full final page from a truncated one.
    //
    // Asking every branch for pageSize + 1 is also what makes the CURSOR sound across a union: a
    // branch that contributed k <= pageSize rows at or below the page boundary necessarily also
    // fetched one above it, so nothing it left unread can sort below the boundary. The next page
    // therefore resumes correctly for every branch from the single position the cursor names.
    return query.limit(pageSize + 1);
  };

  const snaps = await Promise.all(
    (branches ?? [null]).map((clause) => buildQuery(clause).get()),
  );
  const merged = branches === null ? snaps[0].docs : mergeBranches(snaps, orderField, orderDir);
  const docs = merged.slice(0, pageSize);
  const hasMore = merged.length > pageSize;
  const last = docs[docs.length - 1];

  return {
    items: docs.map((doc) => project(spec, doc.id, doc.data() as Record<string, unknown>)),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            s: input.sourceId,
            v: orderField === DOCUMENT_ID_FIELD ? last.id : ((last.data() as Record<string, unknown>)[orderField] ?? null),
            d: last.id,
          })
        : null,
  };
}

// ============================ THE GOVERNED COUNT ============================
//
// The list header's "N results" number, for a source the browser can no longer query itself.
//
// WHY THIS EXISTS AT ALL, stated plainly: migrating 15 entities to the governed read path silently
// took this number away. useListViewChrome gated its count on `readVia === "CLIENT_DIRECT"` -- a
// correct guard when it was written, because a client-direct aggregate against a deny-all
// collection fails every time -- so flipping those entities to CALLABLE made the count render as
// "no count" on Customers, Equipment and Parts. Nothing failed and nothing said so. Restoring it
// through the same registry is the fix; accepting the loss would have been a product decision, and
// not one a transport migration gets to make.
//
// SAME AUTHORITY AS THE READ, deliberately. Same source id, same capability, same named filters,
// same refusals. A count is a read of how many, and a count that answered where the read would have
// refused would disclose the size of a set the caller may not see.
//
// NO SORT, NO CURSOR, NO PAGE SIZE. None of them change a count, and accepting them would invite a
// caller to believe the number is scoped to a page. It is not: it is the whole filtered set, up to
// the ceiling below.
//
// BOUNDED, and honest about the bound. `atLeast` is true when the count hit the ceiling, so a
// caller can render "500+" rather than a wrong exact number. An unbounded count is still a full
// scan on the server's side of the wire, and the number's purpose is orientation, not accounting.
export const COUNT_CEILING = 500;

export interface CountGovernedListInput {
  readonly actorUid: string;
  readonly sourceId: string;
  readonly filters?: Record<string, unknown>;
}

export interface GovernedListCount {
  readonly count: number;
  readonly atLeast: boolean;
}

export async function countGovernedList(
  input: CountGovernedListInput,
  deps: GovernedListDeps = {},
): Promise<GovernedListCount> {
  const db = deps.db ?? getFirestore();
  const roles = deps.roles ?? COMPATIBILITY_ROLES;

  if (typeof input.actorUid !== "string" || !input.actorUid) {
    throw new InvalidInputError("actorUid is required");
  }
  const spec = Object.prototype.hasOwnProperty.call(GOVERNED_READS, input.sourceId)
    ? GOVERNED_READS[input.sourceId as keyof typeof GOVERNED_READS]
    : undefined;
  if (!spec) {
    throw new InvalidInputError(`"${String(input.sourceId)}" is not a governed read source`);
  }

  // Resolved BEFORE the capability check, matching readGovernedList's order: a malformed request is
  // malformed regardless of who sent it, and answering "invalid filter" to an unauthorized caller
  // discloses only the shape of the registry entry, which the caller named in the first place.
  const filters = resolveFilters(spec, (input.filters ?? {}) as Record<string, unknown>);

  if (!(await actorHolds(db, roles, input.actorUid, spec.capability))) {
    throw new UnauthorizedActorError(`actor is not authorized for "${spec.capability}"`);
  }

  const base = () => {
    let query = db.collection(spec.source) as FirebaseFirestore.Query;
    for (const f of filters) {
      query = query.where(f.field === DOCUMENT_ID_FIELD ? FieldPath.documentId() : f.field, f.op, f.value);
    }
    return query;
  };

  // SAME SCOPE AS THE READ. A count that counted records the read would not return is not a smaller
  // disclosure than returning them -- it is the size of a set the caller may not see.
  const branches = await resolveScopeBranches(spec, input.actorUid, db, deps);
  if (branches === null) {
    const snap = await base().limit(COUNT_CEILING).count().get();
    const count = snap.data().count;
    return { count, atLeast: count >= COUNT_CEILING };
  }

  // A scoped count CANNOT be a sum of branch counts: a transfer order matching both endpoints would
  // be counted twice, and the header would claim more records than the list can show. So the ids are
  // read (keys only, via an empty select) and unioned, which is the same de-duplication the read
  // performs -- bounded by the same ceiling, so it stays a bounded read rather than a full scan.
  const idSnaps = await Promise.all(
    branches.map((clause) =>
      base()
        .where(
          clause.field === DOCUMENT_ID_FIELD ? FieldPath.documentId() : clause.field,
          "in",
          clause.ids,
        )
        .limit(COUNT_CEILING)
        .select()
        .get(),
    ),
  );
  const ids = new Set<string>();
  for (const snap of idSnaps) for (const doc of snap.docs) ids.add(doc.id);
  const count = Math.min(ids.size, COUNT_CEILING);
  return { count, atLeast: count >= COUNT_CEILING };
}
