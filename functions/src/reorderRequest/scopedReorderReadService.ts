// Reorder Requests — the scoped read seam.
//
// ============================ WHY THIS IS NOT A GOVERNED LIST SOURCE ============================
//
// Every entry in governedReadRegistry.ts is a GLOBAL capability check: hold the capability, get the
// rows. Reorder requests were never like that. `firestore.rules` admitted THREE populations by
// three different predicates:
//
//   GLOBAL   isAdminOrDispatcher()
//   MANAGED  isActiveOperationalRole("PARTS_MANAGER") && status == "READY_FOR_PARTS_MANAGER"
//         || isActiveOperationalRole("PARTS_MANAGER") && status in ["ASSIGNED_TO_PARTS_ASSOCIATE",
//                                                                   "PURCHASING_IN_PROGRESS"]
//         || isActiveOperationalRole("PARTS_MANAGER") && (reviewedBy == uid || assignedBy == uid)
//   OWN      isActiveOperationalRole("PARTS_ASSOCIATE") && assignedToUserId == uid
//
// Registering `reorder_requests` as an ordinary source would have to pick one. Picking global hands
// every Parts Manager the whole queue; picking managed strips an operations manager down to a parts
// manager's subset. Neither is the behaviour being migrated, so this is a dedicated service --
// the smallest one that can replace the retired read family and nothing more.
//
// ============================ AUTHORIZATION ORDER, AND WHY IT IS THIS ORDER ============================
//
// GLOBAL, then MANAGED, then OWN. That is load-bearing rather than stylistic. Admin derives the
// whole catalogue and therefore holds all three; a person can genuinely hold Operations Manager and
// Parts Manager at once. Resolving the narrow one first would scope them to a subset of what they
// are entitled to and return it with no error -- a silent narrowing, which is the failure mode this
// order exists to prevent. THE BROADER VALID AUTHORITY WINS.
//
// ============================ WHAT THE CALLER MAY SAY ============================
//
// A registered MODE token and values for that mode's declared parameters. Never a collection, a
// field, an operator, an orderBy or a raw cursor.
//
// `reviewedBy`, `assignedBy` and `assignedToUserId` ARE accepted, and the distinction is the
// whole point: in the retired rule they were SCOPE, and here they are DISPLAY. The server applies
// the scope predicate on top of them, per branch, as a conjunction -- so naming somebody else
// yields a SMALLER set, never a different one, and never a row the caller's scope excludes.
//
// The one place that could still be mistaken for authority is an OWN-scoped caller naming an
// assignee other than themselves. That is REFUSED rather than silently intersected to nothing,
// because an empty list reads as "you have no requests" -- a claim about the business rather than
// about permission.
import { getFirestore, FieldPath, type Firestore, Timestamp } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";

const REORDER_REQUESTS = "reorder_requests";
const DOCUMENT_ID_FIELD = "__id__";

export const REORDER_READ_GLOBAL = "reorder.request.read.queue";
export const REORDER_READ_MANAGED = "reorder.request.read.managed";
export const REORDER_READ_OWN = "reorder.request.read.own";

/**
 * The three statuses the retired PARTS_MANAGER branches admitted, as one set.
 *
 * The rule expressed them as two clauses -- the queue status, then the two in-flight ones -- and
 * they are unioned here because the resulting POPULATION is what parity is measured against, not
 * the number of clauses it took to write.
 */
export const MANAGED_STATUSES: readonly string[] = Object.freeze([
  "READY_FOR_PARTS_MANAGER",
  "ASSIGNED_TO_PARTS_ASSOCIATE",
  "PURCHASING_IN_PROGRESS",
]);

/** The actor fields the retired rule matched against request.auth.uid. NEVER caller-supplied. */
export const MANAGED_ACTOR_FIELDS: readonly string[] = Object.freeze(["reviewedBy", "assignedBy"]);

export class InvalidInputError extends Error {}
export class UnauthorizedActorError extends Error {}

export interface ScopedReorderDeps {
  readonly db?: Firestore;
  /** Injected for tests. Production resolves through the trusted effective-access feed. */
  readonly resolveAccess?: (uid: string, ids: readonly string[]) => Promise<Record<string, boolean>>;
}

export type ReorderScope =
  | { readonly kind: "GLOBAL" }
  | { readonly kind: "MANAGED"; readonly actorUid: string }
  | { readonly kind: "OWN"; readonly actorUid: string };

/**
 * Resolve WHAT THIS PRINCIPAL MAY SEE, before any business data is touched.
 *
 * Returns the scope or throws. Never returns a "maybe" a caller could ignore, and never reads a
 * reorder request in order to decide.
 */
export async function resolveReorderScope(
  actorUid: string,
  deps: ScopedReorderDeps = {},
): Promise<ReorderScope> {
  if (typeof actorUid !== "string" || !actorUid) throw new InvalidInputError("actorUid is required");

  const resolve =
    deps.resolveAccess ??
    (async (uid: string, ids: readonly string[]) => {
      const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [...ids] });
      return decisions as Record<string, boolean>;
    });

  let decisions: Record<string, boolean>;
  try {
    decisions = await resolve(actorUid, [REORDER_READ_GLOBAL, REORDER_READ_MANAGED, REORDER_READ_OWN]);
  } catch (err) {
    // FAIL-CLOSED. A resolver that throws is a denial, never an allow -- a capability check whose
    // error path lets the read through is worse than no check, because it looks like one.
    console.error("[reorder] capability resolution failed", err);
    throw new UnauthorizedActorError("authorization could not be resolved");
  }

  // BROADEST FIRST. See the header.
  if (decisions[REORDER_READ_GLOBAL] === true) return { kind: "GLOBAL" };
  if (decisions[REORDER_READ_MANAGED] === true) return { kind: "MANAGED", actorUid };
  if (decisions[REORDER_READ_OWN] === true) return { kind: "OWN", actorUid };
  throw new UnauthorizedActorError("actor may not read reorder requests");
}

interface Clause {
  readonly field: string;
  readonly op: FirebaseFirestore.WhereFilterOp;
  readonly value: unknown;
}

interface Mode {
  readonly params: Readonly<Record<string, { field: string; op: FirebaseFirestore.WhereFilterOp }>>;
  readonly orderBy: readonly [string, "asc" | "desc"];
  readonly maxPageSize: number;
}

// ============================ DISPLAY FILTERS ARE NOT SCOPE ============================
//
// Every parameter below NARROWS what the caller asked for WITHIN their scope, and none can widen
// it: the scope predicate is applied by the server on top of these, per branch, as a conjunction.
// A MANAGED caller filtering by `assignedBy: someone-else` gets their own three-branch population
// intersected with that filter -- which is a smaller set, never a different one.
//
// The three ACTOR fields are here for exactly that reason and no other. They were the retired
// rule's SCOPE for a Parts Manager, and they are DISPLAY here -- so an OWN-scoped caller is
// refused when they name an assignee other than themselves (resolveOwnAssigneeParam below),
// which is the one case where a display filter could otherwise be mistaken for authority.
export const REORDER_MODES: Readonly<Record<string, Mode>> = Object.freeze({
  index: Object.freeze({
    params: Object.freeze({
      status: Object.freeze({ field: "status", op: "==" as const }),
      statuses: Object.freeze({ field: "status", op: "in" as const }),
      ids: Object.freeze({ field: DOCUMENT_ID_FIELD, op: "in" as const }),
      partId: Object.freeze({ field: "partId", op: "==" as const }),
      assignedToUserId: Object.freeze({ field: "assignedToUserId", op: "==" as const }),
      reviewedBy: Object.freeze({ field: "reviewedBy", op: "==" as const }),
      assignedBy: Object.freeze({ field: "assignedBy", op: "==" as const }),
    }),
    orderBy: Object.freeze([DOCUMENT_ID_FIELD, "asc"] as const),
    maxPageSize: 200,
  }),
  // The history surface. Ordered createdAt DESC because that is what a person reading a history
  // expects, and the ordering is preserved across the scoped union by merging the branches on the
  // same key rather than by re-sorting a page.
  history: Object.freeze({
    params: Object.freeze({
      statuses: Object.freeze({ field: "status", op: "in" as const }),
    }),
    orderBy: Object.freeze(["createdAt", "desc"] as const),
    maxPageSize: 200,
  }),
});

function resolveMode(modeId: unknown): { id: string; mode: Mode } {
  if (typeof modeId !== "string" || !Object.prototype.hasOwnProperty.call(REORDER_MODES, modeId)) {
    throw new InvalidInputError(`"${String(modeId)}" is not a reorder query mode`);
  }
  return { id: modeId, mode: REORDER_MODES[modeId] };
}

/**
 * An OWN-scoped caller may name only THEMSELVES as the assignee.
 *
 * Their scope is already `assignedToUserId == self`, so naming somebody else would intersect to
 * nothing -- and an empty list is a claim about the business, not about permission. Refusing says
 * the true thing. A GLOBAL or MANAGED caller may name anyone: for them it is an ordinary display
 * filter, still intersected with whatever their own scope admits.
 */
function resolveOwnAssigneeParam(
  scope: ReorderScope,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (scope.kind !== "OWN") return params;
  const requested = params.assignedToUserId;
  if (requested !== undefined && requested !== null && requested !== scope.actorUid) {
    throw new UnauthorizedActorError("this actor may only read their own assigned requests");
  }
  // Not forced in here: the scope predicate adds the identical clause from the derived identity,
  // and adding it twice would be a second equality filter on one field saying the same thing.
  const { assignedToUserId: _ownScopeAddsThis, ...rest } = params;
  return rest;
}

function resolveClauses(modeId: string, mode: Mode, supplied: Record<string, unknown>): Clause[] {
  for (const name of Object.keys(supplied)) {
    if (!mode.params[name]) {
      const allowed = Object.keys(mode.params).join(", ") || "none";
      throw new InvalidInputError(`"${name}" is not a parameter of mode "${modeId}" (allowed: ${allowed})`);
    }
  }
  const out: Clause[] = [];
  for (const [name, spec] of Object.entries(mode.params)) {
    const value = supplied[name];
    if (value === undefined || value === null) continue;
    if (spec.op === "in") {
      if (!Array.isArray(value) || value.length === 0 || value.length > 30) {
        throw new InvalidInputError(`"${name}" needs an array of 1..30 values`);
      }
      out.push({ field: spec.field, op: "in", value });
      continue;
    }
    out.push({ field: spec.field, op: spec.op, value });
  }
  return out;
}

/**
 * The QUERIES one scope requires. A scope needing a union returns more than one.
 *
 * MANAGED is the interesting case: the retired rule was a disjunction over three different fields
 * (status, reviewedBy, assignedBy), and Firestore has no OR across fields. It is therefore three
 * queries whose results are unioned and de-duplicated by document id -- not an `in` over a single
 * field, and not a client-side filter over a wider read, which would have meant handing the caller
 * rows their scope does not admit and trusting the browser to drop them.
 */
function scopedQueries(db: Firestore, clauses: readonly Clause[], scope: ReorderScope): FirebaseFirestore.Query[] {
  const base = () => {
    let q = db.collection(REORDER_REQUESTS) as FirebaseFirestore.Query;
    for (const c of clauses) {
      // The sentinel is the registry's name for the document id; Firestore addresses it as a
      // FieldPath rather than a field name. The caller never learns the difference.
      q = q.where(c.field === DOCUMENT_ID_FIELD ? FieldPath.documentId() : c.field, c.op, c.value);
    }
    return q;
  };
  if (scope.kind === "GLOBAL") return [base()];
  if (scope.kind === "OWN") return [base().where("assignedToUserId", "==", scope.actorUid)];
  return [
    base().where("status", "in", [...MANAGED_STATUSES]),
    ...MANAGED_ACTOR_FIELDS.map((field) => base().where(field, "==", scope.actorUid)),
  ];
}

export interface ReadScopedReorderInput {
  readonly actorUid: string;
  readonly mode: string;
  readonly params?: Record<string, unknown>;
  readonly pageSize?: number;
  /** An opaque token from a previous page of the SAME mode. Never constructed by a caller. */
  readonly cursor?: string | null;
}

export interface ScopedReorderPage {
  readonly items: readonly Record<string, unknown>[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly scope: "GLOBAL" | "MANAGED" | "OWN";
}

// ============================ PAGING A UNION ============================
//
// A union normally cannot be paged: a token meaning one position in one branch means nothing in the
// merged result. THIS union can, because every branch is ordered on the SAME key -- the mode's
// order field, then the authoritative document id -- so the merged stream carries that same total
// ordering and one position describes all of it.
//
// Every branch reads pageSize + 1. A branch contributing k <= pageSize rows at or before the page
// boundary therefore also read one row beyond it, so nothing it left behind can sort before the
// boundary. Resuming every branch from the single position the token names is complete.
//
// WHY IT MATTERS RATHER THAN BEING A NICETY: without it a scoped reader's history and every
// complete-population read over this collection would bound at one page, and a total computed over
// a truncated input is not partial -- it is wrong, presented as complete.
//
// THE TOKEN CARRIES A POSITION, NEVER AN AUTHORITY. The scope is re-resolved from the actor on
// every call, before the token is even decoded, so tampering can only move a caller inside a
// population they were already granted. It is bound to its mode so a history token cannot be
// replayed as a queue position in a different ordering.
interface ReorderCursor {
  /** The mode that issued it. A token from another mode names another ordering. */
  readonly m: string;
  /** The order value: milliseconds for a Timestamp field, the raw value otherwise, null when ordered by id. */
  readonly v: number | string | null;
  /** True when `v` is a Timestamp expressed in millis and must be rebuilt as one. */
  readonly t: boolean;
  /** The document id -- the tiebreak that makes the position total. */
  readonly d: string;
}

function encodeReorderCursor(payload: ReorderCursor): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Opaque in, position out. A malformed or foreign token is REFUSED, never treated as page one. */
function decodeReorderCursor(raw: unknown, modeId: string): ReorderCursor | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new InvalidInputError("cursor must be a string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new InvalidInputError("cursor is not a valid page token");
  }
  const c = parsed as Partial<ReorderCursor>;
  if (!c || typeof c !== "object" || typeof c.d !== "string" || typeof c.m !== "string") {
    throw new InvalidInputError("cursor is not a valid page token");
  }
  if (c.m !== modeId) {
    throw new InvalidInputError("cursor was issued for a different reorder query mode");
  }
  return { m: c.m, v: (c.v ?? null) as number | string | null, t: c.t === true, d: c.d };
}

/** The order value of a returned row, in the form the cursor stores. */
function cursorValue(row: Record<string, unknown>, orderField: string): { v: number | string | null; t: boolean } {
  const raw = row[orderField];
  if (raw && typeof raw === "object" && typeof (raw as { toMillis?: () => number }).toMillis === "function") {
    return { v: (raw as { toMillis: () => number }).toMillis(), t: true };
  }
  if (raw && typeof raw === "object" && typeof (raw as { _seconds?: number })._seconds === "number") {
    return { v: (raw as { _seconds: number })._seconds * 1000, t: true };
  }
  if (typeof raw === "number" || typeof raw === "string") return { v: raw, t: false };
  // A row missing the ordered field cannot be a page boundary: orderBy excludes such documents, so
  // it was never returned by a branch in the first place.
  return { v: null, t: false };
}

export async function readScopedReorderRequests(
  input: ReadScopedReorderInput,
  deps: ScopedReorderDeps = {},
): Promise<ScopedReorderPage> {
  const db = deps.db ?? getFirestore();
  const { id, mode } = resolveMode(input.mode);

  // AUTHORIZATION BEFORE DATA. An unauthorized actor throws here, having touched reorder_requests
  // zero times.
  const scope = await resolveReorderScope(input.actorUid, deps);

  const params = resolveOwnAssigneeParam(scope, (input.params ?? {}) as Record<string, unknown>);
  const clauses = resolveClauses(id, mode, params);
  let pageSize = 50;
  if (input.pageSize !== undefined) {
    if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > mode.maxPageSize) {
      throw new InvalidInputError(`pageSize must be an integer between 1 and ${mode.maxPageSize}`);
    }
    pageSize = input.pageSize;
  }

  const queries = scopedQueries(db, clauses, scope);
  const [orderField, orderDir] = mode.orderBy;
  const orderedById = orderField === DOCUMENT_ID_FIELD;
  const cursor = decodeReorderCursor(input.cursor, id);

  // EVERY BRANCH IS ORDERED ON THE SAME KEY, which is what makes the union below a merge rather
  // than a re-sort of an arbitrary page. Each branch reads one MORE than the page so `hasMore` is
  // observed rather than inferred.
  const startAfterArgs = cursor
    ? orderedById
      ? [cursor.d]
      : [cursor.t ? Timestamp.fromMillis(Number(cursor.v)) : cursor.v, cursor.d]
    : null;

  const snaps = await Promise.all(
    queries.map((q) => {
      const ordered = orderedById
        ? q.orderBy(FieldPath.documentId(), orderDir)
        : q.orderBy(orderField, orderDir).orderBy(FieldPath.documentId(), orderDir);
      const positioned = startAfterArgs ? ordered.startAfter(...startAfterArgs) : ordered;
      return positioned.limit(pageSize + 1).get();
    }),
  );

  // UNION, DE-DUPLICATED BY AUTHORITATIVE DOCUMENT ID. A request that is both in a managed status
  // AND personally assigned by this actor matches two branches and is ONE record. De-duplicating
  // on the document id rather than on any stored field is what makes that true even for a record
  // carrying a conflicting stored id.
  const byId = new Map<string, Record<string, unknown>>();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      if (!byId.has(doc.id)) byId.set(doc.id, { ...doc.data(), id: doc.id });
    }
  }

  // Re-ordered on the SAME key the branches used, so the merged page reads the way each branch
  // did. A missing order value sorts last rather than throwing -- the collection spans two record
  // generations and one of them may not carry the field at all.
  const rank = (row: Record<string, unknown>): [number, string] => {
    if (orderedById) return [0, String(row.id)];
    const raw = row[orderField];
    const n =
      typeof raw === "number"
        ? raw
        : raw && typeof raw === "object" && typeof (raw as { toMillis?: () => number }).toMillis === "function"
          ? (raw as { toMillis: () => number }).toMillis()
          : raw && typeof raw === "object" && typeof (raw as { _seconds?: number })._seconds === "number"
            ? (raw as { _seconds: number })._seconds * 1000
            : Number.NaN;
    return [Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY, String(row.id)];
  };
  const dir = orderDir === "desc" ? -1 : 1;
  const ordered = [...byId.values()].sort((a, b) => {
    const [an, ai] = rank(a);
    const [bn, bi] = rank(b);
    if (an !== bn) return an < bn ? -dir : dir;
    return ai < bi ? -dir : ai > bi ? dir : 0;
  });

  const hasMore = ordered.length > pageSize;
  const items = ordered.slice(0, pageSize);
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeReorderCursor(
          orderedById
            ? { m: id, v: null, t: false, d: String(last.id) }
            : { m: id, ...cursorValue(last, orderField), d: String(last.id) },
        )
      : null;
  return { items, hasMore, nextCursor, scope: scope.kind };
}
