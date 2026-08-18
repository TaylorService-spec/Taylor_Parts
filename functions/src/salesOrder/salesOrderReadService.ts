// Sales Order — TRUSTED MINIMAL READ PROJECTION (repo-only, fail-closed). Owner-ratified 2026-08-15:
// "A user cannot meaningfully perform... governed Sales Order operations without a governed way to
// inspect the Sales Order state they operate on. This is an authority gap, not merely a missing
// screen." Follows the `opportunity.read` pattern exactly (functions/src/opportunity/
// opportunityReadService.ts) — the client does NOT receive direct `sales_orders` read access
// (firestore.rules stays `allow read, write: if false`, unchanged). A trusted backend resolves the
// caller's governed scope, reads the canonical Sales Order via the Admin SDK, and returns ONLY the
// minimal projection the Sales Order UX needs.
//
// Principles enforced here (identical to the Opportunity read service):
//   • fail closed; caller identity comes from request.auth.uid, never a client-supplied id;
//   • authorization is the governed capability `salesOrder.read`, resolved through the trusted
//     effective-access feed (registered active:false ⇒ ungranted ⇒ deny for everyone until a
//     separate Owner grant AND per-environment activation);
//   • the projection returns ONLY facts already authoritative on the Sales Order document itself —
//     no pricing policy, no quote state, no operatingCompanyId, no Ventana/D-5 semantics, no derived
//     data without an authoritative source;
//   • distinguishes the states the UI must tell apart: denied · not-found · unavailable · ready.
//
// EXPORT != DEPLOY, REGISTER != GRANT. Exported for build/test only; nothing runs in production
// until a separate deploy + capability grant + per-environment activation.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { SALES_ORDERS_COLLECTION } from "../constants/collections";
import { SALES_ORDER_STATES, SALES_ORDER_LINE_KINDS, type SalesOrderState, type SalesOrderLineKind } from "./salesOrderLifecycle";

export const SALES_ORDER_READ_CAPABILITY = "salesOrder.read";

export interface SalesOrderLineProjection {
  lineId: string;
  kind: SalesOrderLineKind;
  ref: string;
  orderedQty: number;
  allocatedQty: number;
  fulfilledQty: number;
  billedQty: number;
}

// The minimal projected shape the Sales Order UX consumes. No raw UID beyond createdByUid/updatedByUid
// (already business-meaningful audit fields on the canonical doc, not copied PII), no Customer name (only
// accountId — names resolve separately from the canonical Account authority, matching the Opportunity
// projection's own rule).
export interface SalesOrderProjection {
  id: string;
  // The governed business reference (format SO-YYYY-######), allocated server-side at creation
  // (salesOrderNumbering.ts). Null on Sales Orders created before numbering existed -- honestly
  // null, never backfilled with a guess and never the document id (`id` above is for routing only,
  // not for display as identity; DECISIONS #106).
  salesOrderNumber: string | null;
  accountId: string | null;
  ownerEmployeeId: string | null;
  salesChannel: string | null;
  currency: string | null;
  locationId: string | null;
  sourceOpportunityId: string | null;
  // The originating Opportunity's immutable reference, denormalized at creation by
  // createSalesOrderFromOpportunity. Null for Sales Orders created before Opportunity
  // identity existed — honestly null rather than backfilled with a guess.
  sourceOpportunityNumber: string | null;
  customerPO: string | null;
  notes: string | null;
  state: SalesOrderState | null;
  lines: SalesOrderLineProjection[];
  serviceWorkOrderIds: string[];
  createdAtMillis: number | null;
  updatedAtMillis: number | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const nonNegNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

function projectLine(raw: unknown, index: number): SalesOrderLineProjection | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  const kind = (SALES_ORDER_LINE_KINDS as readonly string[]).includes(l.kind as string) ? (l.kind as SalesOrderLineKind) : null;
  const ref = str(l.ref);
  const orderedQty = num(l.orderedQty);
  // A line missing its identity/kind/orderedQty cannot be honestly projected -- skipped, not
  // fabricated. lineId falls back to a positional id only if the stored one is missing, mirroring
  // salesOrderCommands.ts's own `line-${index+1}` convention.
  if (!kind || !ref || orderedQty === null) return null;
  return {
    lineId: str(l.lineId) ?? `line-${index + 1}`,
    kind,
    ref,
    orderedQty,
    allocatedQty: nonNegNum(l.allocatedQty),
    fulfilledQty: nonNegNum(l.fulfilledQty),
    billedQty: nonNegNum(l.billedQty),
  };
}

// Pure projection of one canonical Sales Order doc -> the minimal shape. Returns null if the doc
// cannot yield a usable projection (missing id, or a state outside the governed enum -- an
// unrecognized state is never trusted/guessed at).
export function projectSalesOrder(id: string, data: Record<string, unknown> | undefined): SalesOrderProjection | null {
  if (!id || !data || typeof data !== "object") return null;
  const state = (SALES_ORDER_STATES as readonly string[]).includes(data.state as string) ? (data.state as SalesOrderState) : null;
  if (!state) return null;
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const lines = rawLines.map((l, i) => projectLine(l, i)).filter((l): l is SalesOrderLineProjection => l !== null);
  const rawServiceWoIds = Array.isArray(data.serviceWorkOrderIds) ? data.serviceWorkOrderIds : [];
  const serviceWorkOrderIds = rawServiceWoIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return {
    id,
    salesOrderNumber: str(data.salesOrderNumber),
    accountId: str(data.accountId),
    ownerEmployeeId: str(data.ownerEmployeeId),
    salesChannel: str(data.salesChannel),
    currency: str(data.currency),
    locationId: str(data.locationId),
    sourceOpportunityId: str(data.sourceOpportunityId),
    sourceOpportunityNumber: str(data.sourceOpportunityNumber),
    customerPO: str(data.customerPO),
    notes: str(data.notes),
    state,
    lines,
    serviceWorkOrderIds,
    createdAtMillis: num(data.createdAtMillis),
    updatedAtMillis: num(data.updatedAtMillis),
  };
}

export type SalesOrderReadStatus = "ready" | "not-found";

export interface SalesOrderReadResult {
  status: SalesOrderReadStatus;
  salesOrder: SalesOrderProjection | null;
}

// ---------------------------------------------------------------------------------------------------------
// ACCOUNT-SCOPED read (Wave 7 completion, PART 3). Answers "which Sales Orders belong to THIS Account?".
// getSalesOrderContext above fetches exactly one order by id -- the wrong shape for an Account workspace
// section. Reuses the SAME governed capability (`salesOrder.read`); the authorization question doesn't
// change, only the query shape does. accountId is a real server-side Firestore `where` clause (never a
// client-side filter over a broader read). Bounded exactly like readAccountInvoiceAr / the account-scoped
// Opportunity read above: fetch limit+1, and an extra row honestly sets `truncated: true` rather than
// silently dropping rows. PR #991's pricing exclusion (no unitPrice, no pricing policy, no quote state, no
// operatingCompanyId, no Ventana/D-5 semantics) is preserved exactly -- this reuses projectSalesOrder(),
// the SAME projection function getSalesOrderContext uses, so there is no second place pricing could leak in.
const DEFAULT_ACCOUNT_SALES_ORDER_LIMIT = 50;
const MAX_ACCOUNT_SALES_ORDER_LIMIT = 200;

export interface AccountSalesOrderListResult {
  status: "ready";
  salesOrders: SalesOrderProjection[];
  skipped: number; // docs on this account that could not be honestly projected (e.g. malformed/legacy state)
  truncated: boolean; // true when the account's real Sales Order count exceeds `limit`
}

// Core bounded read, factored out of the onCall adapter for direct testability (mirrors
// readOpportunitiesForAccount / readAccountInvoiceAr).
export async function readSalesOrdersForAccount(
  db: FirebaseFirestore.Firestore,
  accountId: string,
  limit: number
): Promise<AccountSalesOrderListResult> {
  // No `.orderBy()`: an equality filter + limit needs no composite index (see the parallel comment in
  // opportunityReadService.ts's readOpportunitiesForAccount).
  const snap = await db.collection(SALES_ORDERS_COLLECTION).where("accountId", "==", accountId).limit(limit + 1).get();
  const truncated = snap.size > limit;
  const docs = snap.docs.slice(0, limit);
  const salesOrders: SalesOrderProjection[] = [];
  let skipped = 0;
  for (const d of docs) {
    const projection = projectSalesOrder(d.id, d.data() as Record<string, unknown>);
    if (projection) salesOrders.push(projection);
    else skipped += 1;
  }
  return { status: "ready", salesOrders, skipped, truncated };
}

// The trusted account-scoped read callable. Same fail-closed shape as getSalesOrderContext: unauthenticated
// -> unauthenticated, missing/blank accountId -> invalid-argument (checked before authorization), ungranted
// -> permission-denied, read failure -> internal ("unavailable"). A malformed/unknown accountId is not an
// error -- an honest "ready" result with zero Sales Orders, matching the Opportunity account-scoped read.
export const listSalesOrdersForAccount = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  const data = (request.data ?? {}) as { accountId?: unknown; limit?: unknown };
  if (typeof data.accountId !== "string" || data.accountId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "accountId is required.");
  }
  const accountId = data.accountId.trim();
  const limit =
    Number.isSafeInteger(data.limit) && (data.limit as number) > 0 && (data.limit as number) <= MAX_ACCOUNT_SALES_ORDER_LIMIT
      ? (data.limit as number)
      : DEFAULT_ACCOUNT_SALES_ORDER_LIMIT;

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [SALES_ORDER_READ_CAPABILITY],
    });
    allowed = decisions[SALES_ORDER_READ_CAPABILITY] === true;
  } catch {
    allowed = false; // fail closed
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read Sales Orders.");

  try {
    const db = getFirestore();
    return await readSalesOrdersForAccount(db, accountId, limit);
  } catch {
    throw new HttpsError("internal", "The Sales Order read is temporarily unavailable.");
  }
});

// The trusted read callable -- ONE Sales Order by id (the natural entry point: an Opportunity's own
// `salesOrderId` back-link, or a Work Order's `salesOrderId`, both already-authoritative refs).
// Returns the projected result; maps failures to HttpsError so the client can distinguish denied
// (permission-denied) from unavailable (internal) from not-found (a real, honest "ready" result with
// salesOrder: null -- distinct from a read failure, exactly like Opportunity's empty-list "ready").
export const getSalesOrderContext = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  const data = (request.data ?? {}) as { salesOrderId?: unknown };
  if (typeof data.salesOrderId !== "string" || data.salesOrderId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "salesOrderId is required.");
  }
  const salesOrderId = data.salesOrderId.trim();

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [SALES_ORDER_READ_CAPABILITY],
    });
    allowed = decisions[SALES_ORDER_READ_CAPABILITY] === true;
  } catch {
    allowed = false; // fail closed
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read Sales Orders.");

  try {
    const db = getFirestore();
    const snap = await db.collection(SALES_ORDERS_COLLECTION).doc(salesOrderId).get();
    if (!snap.exists) {
      // A real, honest "ready" result with no Sales Order -- distinct from a read failure. The
      // requested id genuinely does not exist (or was mistyped); that is not the same fact as
      // "the read is unavailable."
      const result: SalesOrderReadResult = { status: "not-found", salesOrder: null };
      return result;
    }
    const projection = projectSalesOrder(snap.id, snap.data() as Record<string, unknown>);
    if (!projection) {
      // The doc exists but could not be honestly projected (e.g. a malformed/legacy state value).
      // Surfaced the same way a genuine read failure is -- never fabricated as "not-found" (which
      // would incorrectly imply the id itself is wrong) nor as a guessed "ready" shape.
      throw new HttpsError("internal", "The Sales Order read is temporarily unavailable.");
    }
    const result: SalesOrderReadResult = { status: "ready", salesOrder: projection };
    return result;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    // A read failure is UNAVAILABLE, distinct from denied/not-found -- surfaced as internal so the
    // client seam can render an honest "not connected / unavailable" state.
    throw new HttpsError("internal", "The Sales Order read is temporarily unavailable.");
  }
});

// ---------------------------------------------------------------------------------------------------------
// UNSCOPED, CURSOR-PAGINATED read (X-SALES-ORDER-NO-UNSCOPED-READ). Answers "list the Sales Orders this
// caller is authorized to see, across every Account" for the `salesOrder.index` INDEX surface -- the exact
// gap salesOrder.js's own header names: `listSalesOrdersForAccount` is account-scoped and
// `getSalesOrderContext` fetches exactly one record, so neither can serve an unscoped list. Reuses the SAME
// governed capability (`salesOrder.read`) -- the authorization question is identical to the other two
// reads; only the query shape (no accountId equality filter) and the pagination contract (a real cursor,
// not a client-only limit snapshot) differ.
//
// ORDERING. `.orderBy("salesOrderNumber", "desc").orderBy(FieldPath.documentId(), "desc")` -- the SAME
// default sort salesOrderIndexList already declares (defaultSort: salesOrderNumber DESC), with the
// document id appended as an EXPLICIT tiebreaker so `.startAfter()` has two concrete values to resume
// from and the ordering is deterministic even if two orders somehow shared a salesOrderNumber (they do
// not today -- allocateSalesOrderNumber is monotonic/unique -- but a stable tiebreaker costs nothing and
// removes any doubt, matching equipmentCompatibility/readService.ts's own tiebreaker rule).
//
// A KNOWN GAP, STATED RATHER THAN PAPERED OVER: Firestore's `.orderBy()` excludes any document that does
// not carry the ordered field. Sales Orders created before the salesOrderNumber rollout (salesOrder.js's
// own header names this) have no `salesOrderNumber` and are therefore invisible to this read -- not
// filtered out AFTER projection, but never returned by the query at all, and not counted in `skipped`
// either (that counter is for docs the QUERY returned but projection rejected). This is the same gap
// salesOrder.js already documents for the identity field; this read inherits it rather than introducing
// it, and fixing it (e.g. a secondary un-ordered pass for legacy docs) is out of this task's scope.
//
// FILTER CONTRACT. Exactly what salesOrderIndexList declares -- EQUALS/IN on `state`, nothing else -- so
// this read never accepts a filter the metadata surface cannot honestly offer. A `state` filter combined
// with the `salesOrderNumber` order requires a Firestore composite index. The EXACT shape is not a guess:
// `requiredIndexes(salesOrderIndexList, salesOrderEntity)` (field-ops-app-vite/src/metadata/
// listViewDefinition.js) computes it directly from this same declaration --
//   sales_orders: state ASCENDING, salesOrderNumber DESCENDING, __name__ ASCENDING
// -- which this repository does NOT declare today (`firestore.indexes.json` is unchanged by this PR,
// outside this lane's write scope; index deployment is its own separate, protected step -- see the
// handoff's REGISTRATION_PENDING list). Calling with a `state` filter before that index exists fails at
// the Firestore query layer in production; that failure is caught below and surfaced the same way any
// other read failure is (`internal` / "unavailable"), never silently downgraded to an empty result. NOTE:
// the Firestore EMULATOR does not enforce composite-index requirements the way production does, so a
// state-filtered call passing in emulator-backed tests is not proof it will pass in production without
// the index -- flagged explicitly rather than papered over.
// The UNFILTERED path needs no composite index -- `requiredIndexes()` itself skips demanding one when
// there is no filter and exactly one sort field, on the premise that Firestore's automatic single-field
// index on `salesOrderNumber` covers it. That premise is the metadata layer's own established
// convention (shared by every other single-sort-field INDEX list in this codebase), not something this
// read invents.
//
// CURSOR. An UNTRUSTED, UNSIGNED position hint -- the SAME posture functions/src/equipmentCompatibility/
// readCursor.ts documents (posture B): NOT an authorization boundary. Every page independently re-runs the
// SAME capability check and re-executes the SAME bound query (limit + optional state filter, unchanged
// ordering); a caller who edits the cursor can only reposition WITHIN their own already-authorized
// ordering, never broaden the query or skip the capability gate. A structurally invalid cursor is a
// malformed request (`invalid-argument`), never silently treated as "start from the beginning" -- that
// would let a bad cursor quietly re-show page one under a "next page" label.
export const SALES_ORDER_INDEX_CURSOR_VERSION = 1;

export interface SalesOrderIndexCursorPayload {
  readonly salesOrderNumber: string;
  readonly id: string;
}

const SALES_ORDER_INDEX_CURSOR_FIELDS = ["v", "n", "id"] as const;

// Opaque to callers, not secret, not signed -- a base64url of the strict record. Mirrors
// equipmentCompatibility/readCursor.ts's encodeCursor.
export function encodeSalesOrderIndexCursor(payload: SalesOrderIndexCursorPayload): string {
  const record = { v: SALES_ORDER_INDEX_CURSOR_VERSION, n: payload.salesOrderNumber, id: payload.id };
  return Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
}

// Decode + shape-validate. Any decode failure, unknown/extra field, or bad version fails closed with
// HttpsError("invalid-argument") -- never silently treated as "no cursor".
export function decodeSalesOrderIndexCursor(raw: string): SalesOrderIndexCursorPayload {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    throw new HttpsError("invalid-argument", "cursor must be a bounded non-empty string.");
  }
  let text: string;
  try {
    text = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw new HttpsError("invalid-argument", "cursor is not valid base64url.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpsError("invalid-argument", "cursor is not a valid encoded record.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpsError("invalid-argument", "cursor payload must be an object.");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== SALES_ORDER_INDEX_CURSOR_FIELDS.length ||
    !SALES_ORDER_INDEX_CURSOR_FIELDS.every((k) => Object.prototype.hasOwnProperty.call(record, k))
  ) {
    throw new HttpsError("invalid-argument", "cursor payload has an unexpected shape.");
  }
  if (record.v !== SALES_ORDER_INDEX_CURSOR_VERSION) {
    throw new HttpsError("invalid-argument", "cursor schema version is not recognized.");
  }
  if (typeof record.n !== "string" || record.n.trim().length === 0) {
    throw new HttpsError("invalid-argument", "cursor salesOrderNumber is invalid.");
  }
  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    throw new HttpsError("invalid-argument", "cursor id is invalid.");
  }
  return { salesOrderNumber: record.n, id: record.id };
}

// Bounded like the account-scoped reads (not the whole-authorized-scope 1000 cap listOpportunityContext
// uses) -- this read is meant to be PAGED through via the cursor, matching salesOrder.index's own
// declared pageSize (50), rather than fetched once as a single large snapshot.
export const DEFAULT_SALES_ORDER_INDEX_LIMIT = 50;
export const MAX_SALES_ORDER_INDEX_LIMIT = 200;

export interface SalesOrderIndexPageResult {
  status: "ready";
  salesOrders: SalesOrderProjection[];
  skipped: number; // docs the query returned but could not be honestly projected (never silently dropped)
  truncated: boolean; // true when more rows exist beyond this page (the existing sources' truncation shape)
  nextCursor: string | null; // present only when truncated -- the position to resume from
}

// Core bounded, cursor-paginated read, factored out of the onCall adapter for direct testability
// (mirrors readSalesOrdersForAccount / readOpportunitiesForAccount's own factoring).
export async function listSalesOrderIndexPage(
  db: FirebaseFirestore.Firestore,
  options: { limit: number; state?: SalesOrderState | SalesOrderState[]; afterCursor?: SalesOrderIndexCursorPayload | null }
): Promise<SalesOrderIndexPageResult> {
  const { limit, state, afterCursor } = options;
  let query: FirebaseFirestore.Query = db.collection(SALES_ORDERS_COLLECTION);
  if (Array.isArray(state)) {
    query = query.where("state", "in", state);
  } else if (typeof state === "string") {
    query = query.where("state", "==", state);
  }
  // Stable total ordering: salesOrderNumber DESC (the declared default sort), document id ASC as an
  // explicit tiebreaker. ASC, not DESC, deliberately: field-ops-app-vite/src/metadata/
  // listViewDefinition.js's `makeListViewDefinition` always appends the tiebreaker in ASCENDING order
  // (`tiebreaker: input.tiebreaker ?? "__name__"`, `firestoreOrder("ASC")` in `requiredIndexes()`),
  // regardless of the primary sort's own direction -- confirmed by running `requiredIndexes
  // (salesOrderIndexList, salesOrderEntity)`, which demands exactly `sales_orders(state ASC,
  // salesOrderNumber DESC, __name__ ASC)` for the filtered case. Matching that direction here means
  // the ONE composite index this read will ever need is the one the metadata layer already computes
  // and CI can compare against -- a DESC tiebreaker would silently demand a second, undeclared index.
  query = query.orderBy("salesOrderNumber", "desc").orderBy(FieldPath.documentId(), "asc");
  if (afterCursor) {
    query = query.startAfter(afterCursor.salesOrderNumber, afterCursor.id);
  }
  const snap = await query.limit(limit + 1).get();
  const truncated = snap.size > limit;
  const docs = snap.docs.slice(0, limit);
  const salesOrders: SalesOrderProjection[] = [];
  let skipped = 0;
  for (const d of docs) {
    const projection = projectSalesOrder(d.id, d.data() as Record<string, unknown>);
    if (projection) salesOrders.push(projection);
    else skipped += 1;
  }
  const lastDoc = docs[docs.length - 1];
  let nextCursor: string | null = null;
  if (truncated && lastDoc) {
    const lastData = lastDoc.data() as Record<string, unknown>;
    const lastSalesOrderNumber = typeof lastData.salesOrderNumber === "string" ? lastData.salesOrderNumber : null;
    // The query's own `.orderBy("salesOrderNumber", ...)` guarantees every returned doc carries a
    // string salesOrderNumber (Firestore excludes docs missing the ordered field) -- this null check is
    // defense-in-depth, not an expected path, and fails closed by omitting the cursor rather than
    // encoding a broken one.
    if (lastSalesOrderNumber) {
      nextCursor = encodeSalesOrderIndexCursor({ salesOrderNumber: lastSalesOrderNumber, id: lastDoc.id });
    }
  }
  return { status: "ready", salesOrders, skipped, truncated, nextCursor };
}

// The trusted UNSCOPED read callable for the salesOrder.index INDEX surface. Same fail-closed shape as
// the other two reads: unauthenticated -> unauthenticated, malformed limit/state/cursor -> invalid-argument
// (checked BEFORE authorization), ungranted -> permission-denied, read failure (including a `state` filter
// hitting the undeclared composite index) -> internal ("unavailable"). An empty authorized scope is not an
// error -- an honest "ready" result with zero Sales Orders and `truncated: false`.
export const listSalesOrderIndex = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  const data = (request.data ?? {}) as { limit?: unknown; state?: unknown; cursor?: unknown };

  const limit =
    Number.isSafeInteger(data.limit) && (data.limit as number) > 0 && (data.limit as number) <= MAX_SALES_ORDER_INDEX_LIMIT
      ? (data.limit as number)
      : DEFAULT_SALES_ORDER_INDEX_LIMIT;

  const validStates = SALES_ORDER_STATES as readonly string[];
  let state: SalesOrderState | SalesOrderState[] | undefined;
  if (data.state !== undefined) {
    if (typeof data.state === "string") {
      if (!validStates.includes(data.state)) {
        throw new HttpsError("invalid-argument", "state is not a recognized Sales Order state.");
      }
      state = data.state as SalesOrderState;
    } else if (Array.isArray(data.state)) {
      if (data.state.length === 0 || !data.state.every((s) => typeof s === "string" && validStates.includes(s))) {
        throw new HttpsError("invalid-argument", "state must be a non-empty array of recognized Sales Order states.");
      }
      state = data.state as SalesOrderState[];
    } else {
      throw new HttpsError("invalid-argument", "state must be a Sales Order state or an array of them.");
    }
  }

  let afterCursor: SalesOrderIndexCursorPayload | null = null;
  if (data.cursor !== undefined) {
    if (typeof data.cursor !== "string") {
      throw new HttpsError("invalid-argument", "cursor must be a string.");
    }
    afterCursor = decodeSalesOrderIndexCursor(data.cursor);
  }

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [SALES_ORDER_READ_CAPABILITY],
    });
    allowed = decisions[SALES_ORDER_READ_CAPABILITY] === true;
  } catch {
    allowed = false; // fail closed
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read Sales Orders.");

  try {
    const db = getFirestore();
    return await listSalesOrderIndexPage(db, { limit, state, afterCursor });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "The Sales Order read is temporarily unavailable.");
  }
});
