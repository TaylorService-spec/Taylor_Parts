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

  const [orderField, orderDir] = spec.orderBy;
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

  // One MORE than the page. `hasMore` is then observed rather than inferred -- comparing a returned
  // count to the limit cannot distinguish a full final page from a truncated one.
  const snap = await query.limit(pageSize + 1).get();
  const docs = snap.docs.slice(0, pageSize);
  const hasMore = snap.docs.length > pageSize;
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
