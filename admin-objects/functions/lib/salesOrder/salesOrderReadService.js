"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listSalesOrderIndex = exports.MAX_SALES_ORDER_INDEX_LIMIT = exports.DEFAULT_SALES_ORDER_INDEX_LIMIT = exports.SALES_ORDER_INDEX_CURSOR_VERSION = exports.getSalesOrderContext = exports.listSalesOrdersForAccount = exports.MAX_RESOLVED_SERVICE_WORK_ORDERS = exports.SALES_ORDER_READ_CAPABILITY = void 0;
exports.projectSalesOrder = projectSalesOrder;
exports.resolveServiceWorkOrders = resolveServiceWorkOrders;
exports.readSalesOrdersForAccount = readSalesOrdersForAccount;
exports.encodeSalesOrderIndexCursor = encodeSalesOrderIndexCursor;
exports.decodeSalesOrderIndexCursor = decodeSalesOrderIndexCursor;
exports.listSalesOrderIndexPage = listSalesOrderIndexPage;
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
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const salesOrderLifecycle_1 = require("./salesOrderLifecycle");
exports.SALES_ORDER_READ_CAPABILITY = "salesOrder.read";
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// Firestore Timestamp -> epoch millis, or null. Identical in shape to
// crmActivity/crmActivityReadService.ts's helper of the same name, deliberately, so the two
// governed read services convert a timestamp the same way rather than each inventing one.
//
// A CALLABLE CANNOT RETURN A Timestamp. It has to serialize, so the wire shape is a number
// and the conversion belongs here, at the projection boundary -- not in the client, which
// would then need to know Firestore's object shape.
//
// Duck-typed on purpose: `num()` above cannot be reused because a Timestamp is an OBJECT,
// not a number, so num(data.createdAt) returns null for every document that has one.
function toMillis(v) {
    if (v && typeof v === "object" && typeof v.toMillis === "function") {
        return v.toMillis();
    }
    return null;
}
const nonNegNum = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
function projectLine(raw, index) {
    if (!raw || typeof raw !== "object")
        return null;
    const l = raw;
    const kind = salesOrderLifecycle_1.SALES_ORDER_LINE_KINDS.includes(l.kind) ? l.kind : null;
    const ref = str(l.ref);
    const orderedQty = num(l.orderedQty);
    // A line missing its identity/kind/orderedQty cannot be honestly projected -- skipped, not
    // fabricated. lineId falls back to a positional id only if the stored one is missing, mirroring
    // salesOrderCommands.ts's own `line-${index+1}` convention.
    if (!kind || !ref || orderedQty === null)
        return null;
    // The stored price is already integer minor units -- the same value invoicing snapshots as
    // `unitPriceMinor`. A non-integer or negative stored price is NOT coerced: it is treated as
    // absent, so a malformed record makes the order partly priced rather than silently producing
    // a total from a number the money model does not accept.
    const rawPrice = num(l.unitPrice);
    const unitPriceMinor = rawPrice !== null && Number.isInteger(rawPrice) && rawPrice >= 0 ? rawPrice : null;
    return {
        lineId: str(l.lineId) ?? `line-${index + 1}`,
        kind,
        ref,
        orderedQty,
        allocatedQty: nonNegNum(l.allocatedQty),
        fulfilledQty: nonNegNum(l.fulfilledQty),
        billedQty: nonNegNum(l.billedQty),
        unitPriceMinor,
        extendedMinor: unitPriceMinor === null ? null : orderedQty * unitPriceMinor,
    };
}
// Pure projection of one canonical Sales Order doc -> the minimal shape. Returns null if the doc
// cannot yield a usable projection (missing id, or a state outside the governed enum -- an
// unrecognized state is never trusted/guessed at).
function projectSalesOrder(id, data) {
    if (!id || !data || typeof data !== "object")
        return null;
    const state = salesOrderLifecycle_1.SALES_ORDER_STATES.includes(data.state) ? data.state : null;
    if (!state)
        return null;
    const rawLines = Array.isArray(data.lines) ? data.lines : [];
    const lines = rawLines.map((l, i) => projectLine(l, i)).filter((l) => l !== null);
    // ============================ WHAT THIS SALE IS WORTH ============================
    //
    // A Sales Order is the entry point of a sale, so it carries the sale's money. That is not a
    // new claim: invoiceCommands.ts already treats `line.unitPrice` as the committed price
    // snapshot in integer minor units, refuses to bill a line that has none (UNPRICED), and
    // refuses any invoice price that disagrees with it (PRICE_MISMATCH). Billing is DERIVED from
    // this number. The order is the source.
    //
    // It was never projected, so every reader of this service saw an order with four quantities
    // and no amount, and the list above it had no Dollars column to show.
    //
    // NULL IS NOT ZERO, and this is the whole reason the total is computed here rather than in a
    // client that would have to guess: `unitPrice` is OPTIONAL per line, so an order can be
    // partly priced. Summing what happens to be priced produces a real number that is not the
    // sale's total -- worse than no number, because somebody would act on it. The total is
    // populated ONLY when every line carries a price.
    const pricedLines = lines.filter((l) => l.unitPriceMinor !== null);
    const unpricedLineCount = lines.length - pricedLines.length;
    const pricingState = lines.length === 0 ? "NO_LINES"
        : unpricedLineCount === 0 ? "PRICED"
            : pricedLines.length === 0 ? "UNPRICED"
                : "PARTIALLY_PRICED";
    const totalMinor = pricingState === "PRICED"
        ? lines.reduce((sum, l) => sum + (l.extendedMinor ?? 0), 0)
        : null;
    const rawServiceWoIds = Array.isArray(data.serviceWorkOrderIds) ? data.serviceWorkOrderIds : [];
    const serviceWorkOrderIds = rawServiceWoIds.filter((v) => typeof v === "string" && v.trim().length > 0);
    return {
        id,
        // Empty here by design: this projection is PURE and shared with the list paths. The
        // single-record read enriches it (resolveServiceWorkOrders below).
        serviceWorkOrders: [],
        salesOrderNumber: str(data.salesOrderNumber),
        accountId: str(data.accountId),
        ownerEmployeeId: str(data.ownerEmployeeId),
        salesChannel: str(data.salesChannel),
        currency: str(data.currency),
        locationId: str(data.locationId),
        sourceOpportunityId: str(data.sourceOpportunityId),
        sourceAgreementId: str(data.sourceAgreementId),
        sourceOpportunityNumber: str(data.sourceOpportunityNumber),
        customerPO: str(data.customerPO),
        notes: str(data.notes),
        state,
        lines,
        serviceWorkOrderIds,
        // READS `createdAt`/`updatedAt`, WHICH IS WHAT THE WRITE PATH STORES.
        //
        // These previously read `data.createdAtMillis`/`data.updatedAtMillis` -- field names no
        // writer has ever produced. createSalesOrderFromOpportunity.ts writes
        // `createdAt: FieldValue.serverTimestamp()` and `updatedAt`, so `num()` was handed
        // undefined on every document and returned null every time.
        //
        // Nothing broke visibly, which is exactly why it survived: the projection dutifully
        // reported "this order has no creation date" for all 14 sandbox orders, and no consumer
        // existed to notice. The defect would only have surfaced as a column of em dashes the
        // first time a timestamp was displayed -- data that looks absent rather than wrong.
        totalMinor,
        pricingState,
        unpricedLineCount,
        createdAtMillis: toMillis(data.createdAt),
        updatedAtMillis: toMillis(data.updatedAt),
    };
}
/**
 * How many Work Orders one Sales Order's lineage will resolve.
 *
 * BOUNDED ON PURPOSE. A Sales Order accumulates service Work Orders over its life and nothing caps
 * the stored array, so an unbounded getAll() would let one pathological record decide this read's
 * cost. Beyond the cap the remaining entries still appear, with a null number — the same truthful
 * fallback an unnumbered Work Order gets, rather than a silently shortened list.
 */
exports.MAX_RESOLVED_SERVICE_WORK_ORDERS = 20;
/**
 * Turn a Sales Order's stored Work Order IDS into the governed references a person can read.
 *
 * ONE round trip (getAll), capped. Every entry is returned whether or not it resolved — an id that
 * could not be fetched, or a Work Order with no `woNumber`, comes back with `workOrderNumber:
 * null` so the surface renders a truthful fallback instead of the raw id. Dropping it would be
 * worse: a lineage list that silently omits what it could not resolve tells the reader the Work
 * Order does not exist.
 *
 * FAILS SOFT. This is a display enrichment on top of an already-successful read; if it throws, the
 * Sales Order still returns with null numbers rather than the whole page becoming unavailable.
 */
async function resolveServiceWorkOrders(db, workOrderIds) {
    const ids = workOrderIds.filter((v) => typeof v === "string" && v.trim().length > 0);
    if (ids.length === 0)
        return [];
    const resolvable = ids.slice(0, exports.MAX_RESOLVED_SERVICE_WORK_ORDERS);
    const beyondCap = ids.slice(exports.MAX_RESOLVED_SERVICE_WORK_ORDERS).map((workOrderId) => ({ workOrderId, workOrderNumber: null }));
    try {
        const snaps = await db.getAll(...resolvable.map((id) => db.collection(collections_1.WORK_ORDERS_COLLECTION).doc(id)));
        return [
            ...snaps.map((snap, i) => ({
                workOrderId: resolvable[i],
                workOrderNumber: snap.exists ? str(snap.data()?.woNumber) : null,
            })),
            ...beyondCap,
        ];
    }
    catch (err) {
        console.error("resolveServiceWorkOrders: lineage read failed", err);
        return ids.map((workOrderId) => ({ workOrderId, workOrderNumber: null }));
    }
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
// Core bounded read, factored out of the onCall adapter for direct testability (mirrors
// readOpportunitiesForAccount / readAccountInvoiceAr).
async function readSalesOrdersForAccount(db, accountId, limit) {
    // No `.orderBy()`: an equality filter + limit needs no composite index (see the parallel comment in
    // opportunityReadService.ts's readOpportunitiesForAccount).
    const snap = await db.collection(collections_1.SALES_ORDERS_COLLECTION).where("accountId", "==", accountId).limit(limit + 1).get();
    const truncated = snap.size > limit;
    const docs = snap.docs.slice(0, limit);
    const salesOrders = [];
    let skipped = 0;
    for (const d of docs) {
        const projection = projectSalesOrder(d.id, d.data());
        if (projection)
            salesOrders.push(projection);
        else
            skipped += 1;
    }
    return { status: "ready", salesOrders, skipped, truncated };
}
// The trusted account-scoped read callable. Same fail-closed shape as getSalesOrderContext: unauthenticated
// -> unauthenticated, missing/blank accountId -> invalid-argument (checked before authorization), ungranted
// -> permission-denied, read failure -> internal ("unavailable"). A malformed/unknown accountId is not an
// error -- an honest "ready" result with zero Sales Orders, matching the Opportunity account-scoped read.
exports.listSalesOrdersForAccount = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const data = (request.data ?? {});
    if (typeof data.accountId !== "string" || data.accountId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "accountId is required.");
    }
    const accountId = data.accountId.trim();
    const limit = Number.isSafeInteger(data.limit) && data.limit > 0 && data.limit <= MAX_ACCOUNT_SALES_ORDER_LIMIT
        ? data.limit
        : DEFAULT_ACCOUNT_SALES_ORDER_LIMIT;
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.SALES_ORDER_READ_CAPABILITY],
        });
        allowed = decisions[exports.SALES_ORDER_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[listSalesOrdersForAccount] capability resolution failed for ${exports.SALES_ORDER_READ_CAPABILITY}`, err);
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Sales Orders.");
    try {
        const db = (0, firestore_1.getFirestore)();
        return await readSalesOrdersForAccount(db, accountId, limit);
    }
    catch (err) {
        // Logged server-side ONLY (Cloud Logging), never in the client-facing message -- the client still
        // gets the same generic "unavailable" it always did. Without this, a read failure here is
        // undiagnosable in production: the only trace is a bare 500 with no error text at all (the defect
        // X-SALES-ORDER-INDEX-500 fixed for listSalesOrderIndex below).
        console.error("listSalesOrdersForAccount: read failed", err);
        throw new https_1.HttpsError("internal", "The Sales Order read is temporarily unavailable.");
    }
});
// The trusted read callable -- ONE Sales Order by id (the natural entry point: an Opportunity's own
// `salesOrderId` back-link, or a Work Order's `salesOrderId`, both already-authoritative refs).
// Returns the projected result; maps failures to HttpsError so the client can distinguish denied
// (permission-denied) from unavailable (internal) from not-found (a real, honest "ready" result with
// salesOrder: null -- distinct from a read failure, exactly like Opportunity's empty-list "ready").
exports.getSalesOrderContext = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const data = (request.data ?? {});
    if (typeof data.salesOrderId !== "string" || data.salesOrderId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "salesOrderId is required.");
    }
    const salesOrderId = data.salesOrderId.trim();
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.SALES_ORDER_READ_CAPABILITY],
        });
        allowed = decisions[exports.SALES_ORDER_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[getSalesOrderContext] capability resolution failed for ${exports.SALES_ORDER_READ_CAPABILITY}`, err);
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Sales Orders.");
    try {
        const db = (0, firestore_1.getFirestore)();
        const snap = await db.collection(collections_1.SALES_ORDERS_COLLECTION).doc(salesOrderId).get();
        if (!snap.exists) {
            // A real, honest "ready" result with no Sales Order -- distinct from a read failure. The
            // requested id genuinely does not exist (or was mistyped); that is not the same fact as
            // "the read is unavailable."
            const result = { status: "not-found", salesOrder: null };
            return result;
        }
        const projection = projectSalesOrder(snap.id, snap.data());
        if (!projection) {
            // The doc exists but could not be honestly projected (e.g. a malformed/legacy state value).
            // Surfaced the same way a genuine read failure is -- never fabricated as "not-found" (which
            // would incorrectly imply the id itself is wrong) nor as a guessed "ready" shape.
            throw new https_1.HttpsError("internal", "The Sales Order read is temporarily unavailable.");
        }
        // The lineage the DETAIL page renders, resolved here and only here — the list paths share
        // projectSalesOrder and must not pay for a field no list shows.
        const result = {
            status: "ready",
            salesOrder: { ...projection, serviceWorkOrders: await resolveServiceWorkOrders(db, projection.serviceWorkOrderIds) },
        };
        return result;
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        // A read failure is UNAVAILABLE, distinct from denied/not-found -- surfaced as internal so the
        // client seam can render an honest "not connected / unavailable" state. Logged server-side ONLY
        // (Cloud Logging) before masking -- the client-facing message is unchanged.
        console.error("getSalesOrderContext: read failed", err);
        throw new https_1.HttpsError("internal", "The Sales Order read is temporarily unavailable.");
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
// this read never accepts a filter the metadata surface cannot honestly offer. `firestore.indexes.json`
// already declares `sales_orders(state ASC, salesOrderNumber DESC)` for the filtered case, and matches
// the `.orderBy()` direction below exactly (see the ORDERING note) -- no index deploy is required by
// this fix. NOTE: the Firestore EMULATOR does not enforce composite-index requirements the way
// production does (it never rejects a query for a missing/mismatched index), so an emulator-backed test
// passing is not, by itself, proof a given query shape will succeed in production -- flagged explicitly
// rather than papered over; this is exactly the gap X-SALES-ORDER-INDEX-500 fell into (see ORDERING).
// The UNFILTERED path needs no composite index either, for the same reason -- Firestore's automatic
// single-field index on `salesOrderNumber` covers a single-sort-field query whose tiebreaker direction
// matches Firestore's own implicit default.
//
// CURSOR. An UNTRUSTED, UNSIGNED position hint -- the SAME posture functions/src/equipmentCompatibility/
// readCursor.ts documents (posture B): NOT an authorization boundary. Every page independently re-runs the
// SAME capability check and re-executes the SAME bound query (limit + optional state filter, unchanged
// ordering); a caller who edits the cursor can only reposition WITHIN their own already-authorized
// ordering, never broaden the query or skip the capability gate. A structurally invalid cursor is a
// malformed request (`invalid-argument`), never silently treated as "start from the beginning" -- that
// would let a bad cursor quietly re-show page one under a "next page" label.
exports.SALES_ORDER_INDEX_CURSOR_VERSION = 1;
const SALES_ORDER_INDEX_CURSOR_FIELDS = ["v", "n", "id"];
// Opaque to callers, not secret, not signed -- a base64url of the strict record. Mirrors
// equipmentCompatibility/readCursor.ts's encodeCursor.
function encodeSalesOrderIndexCursor(payload) {
    const record = { v: exports.SALES_ORDER_INDEX_CURSOR_VERSION, n: payload.salesOrderNumber, id: payload.id };
    return Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
}
// Decode + shape-validate. Any decode failure, unknown/extra field, or bad version fails closed with
// HttpsError("invalid-argument") -- never silently treated as "no cursor".
function decodeSalesOrderIndexCursor(raw) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
        throw new https_1.HttpsError("invalid-argument", "cursor must be a bounded non-empty string.");
    }
    let text;
    try {
        text = Buffer.from(raw, "base64url").toString("utf8");
    }
    catch {
        throw new https_1.HttpsError("invalid-argument", "cursor is not valid base64url.");
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new https_1.HttpsError("invalid-argument", "cursor is not a valid encoded record.");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new https_1.HttpsError("invalid-argument", "cursor payload must be an object.");
    }
    const record = parsed;
    const keys = Object.keys(record);
    if (keys.length !== SALES_ORDER_INDEX_CURSOR_FIELDS.length ||
        !SALES_ORDER_INDEX_CURSOR_FIELDS.every((k) => Object.prototype.hasOwnProperty.call(record, k))) {
        throw new https_1.HttpsError("invalid-argument", "cursor payload has an unexpected shape.");
    }
    if (record.v !== exports.SALES_ORDER_INDEX_CURSOR_VERSION) {
        throw new https_1.HttpsError("invalid-argument", "cursor schema version is not recognized.");
    }
    if (typeof record.n !== "string" || record.n.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "cursor salesOrderNumber is invalid.");
    }
    if (typeof record.id !== "string" || record.id.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "cursor id is invalid.");
    }
    return { salesOrderNumber: record.n, id: record.id };
}
// Bounded like the account-scoped reads (not the whole-authorized-scope 1000 cap listOpportunityContext
// uses) -- this read is meant to be PAGED through via the cursor, matching salesOrder.index's own
// declared pageSize (50), rather than fetched once as a single large snapshot.
exports.DEFAULT_SALES_ORDER_INDEX_LIMIT = 50;
exports.MAX_SALES_ORDER_INDEX_LIMIT = 200;
// Core bounded, cursor-paginated read, factored out of the onCall adapter for direct testability
// (mirrors readSalesOrdersForAccount / readOpportunitiesForAccount's own factoring).
async function listSalesOrderIndexPage(db, options) {
    const { limit, state, afterCursor } = options;
    let query = db.collection(collections_1.SALES_ORDERS_COLLECTION);
    if (Array.isArray(state)) {
        query = query.where("state", "in", state);
    }
    else if (typeof state === "string") {
        query = query.where("state", "==", state);
    }
    // Stable total ordering: salesOrderNumber DESC (the declared default sort), document id DESC as an
    // explicit tiebreaker.
    //
    // DESC, not ASC -- this was the X-SALES-ORDER-INDEX-500 defect. Firestore appends `__name__` to
    // every query as an IMPLICIT final tiebreaker, in the SAME direction as the last explicit orderBy()
    // clause -- here, DESC (matching salesOrderNumber). Explicitly requesting `__name__` in a DIFFERENT
    // direction (the previous "asc" here) is not free: it makes `__name__`'s direction a genuine part of
    // the query's index requirement, and `firestore.indexes.json`'s declared `sales_orders` composite
    // (`state ASC, salesOrderNumber DESC` -- two fields, no `__name__` at all) only ever matches the
    // IMPLICIT DESC tiebreaker. So the filtered query (matching the 2 declared fields exactly) still
    // failed, because its 3rd, unstated field didn't agree with what was asked for; the unfiltered query
    // failed for the same reason one level down -- the automatic single-field index on `salesOrderNumber`
    // covers only the implicit-direction tiebreaker, not an explicitly different one. Both shapes hit
    // Firestore's FAILED_PRECONDITION "this query requires an index", which the callable's catch block
    // (previously) discarded and reported as a bare `internal` 500 -- see the logging added below.
    //
    // This was invisible to `requiredIndexes()` (field-ops-app-vite/src/metadata/listViewDefinition.js)
    // and to CI's index-coverage check (scripts/listIndexCoverage.mjs / scripts/indexDriftGuard.mjs)
    // because `indexKey()` in indexDriftGuard.mjs strips `__name__` out of BOTH sides of the comparison
    // before matching -- by design, so a declared index (which never lists the normal implicit
    // tiebreaker) isn't flagged as "missing" it. That normalization is correct for the common case but
    // has a blind spot: it cannot tell an implicit-direction tiebreaker (free) from an explicit,
    // different-direction one (requires the field to actually be declared) -- so CI reported this
    // filtered demand as already covered, and the query still failed in production. That CI gap is
    // itself a finding, out of this lane's write scope (scripts/), reported in the handoff rather than
    // fixed here.
    //
    // Matching Firestore's own implicit default (DESC) here means BOTH shapes are servable by indexes
    // that already exist today -- the declared 2-field `sales_orders(state ASC, salesOrderNumber DESC)`
    // composite for the filtered case, and the automatic single-field index on `salesOrderNumber` for the
    // unfiltered case -- with no index deploy required. A DESC tiebreaker is exactly as deterministic and
    // costs nothing functionally (two Sales Orders sharing a salesOrderNumber does not happen today --
    // allocateSalesOrderNumber is monotonic/unique -- so which direction breaks a tie is otherwise
    // arbitrary); it just has to agree with what Firestore does for free.
    query = query.orderBy("salesOrderNumber", "desc").orderBy(firestore_1.FieldPath.documentId(), "desc");
    if (afterCursor) {
        query = query.startAfter(afterCursor.salesOrderNumber, afterCursor.id);
    }
    const snap = await query.limit(limit + 1).get();
    const truncated = snap.size > limit;
    const docs = snap.docs.slice(0, limit);
    const salesOrders = [];
    let skipped = 0;
    for (const d of docs) {
        const projection = projectSalesOrder(d.id, d.data());
        if (projection)
            salesOrders.push(projection);
        else
            skipped += 1;
    }
    const lastDoc = docs[docs.length - 1];
    let nextCursor = null;
    if (truncated && lastDoc) {
        const lastData = lastDoc.data();
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
exports.listSalesOrderIndex = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const data = (request.data ?? {});
    // LIMIT. An ABSENT limit takes the default. A PRESENT but invalid one is REJECTED rather than
    // silently replaced -- the previous behaviour folded "too large" into "not supplied" and quietly
    // returned a 50-row page to a caller who asked for 9999, with nothing in the response saying so.
    // That is the same silent-substitution shape this program removes elsewhere, and it is
    // inconsistent with the sibling `state`/`cursor` validations directly below, which both reject.
    let limit = exports.DEFAULT_SALES_ORDER_INDEX_LIMIT;
    if (data.limit !== undefined) {
        if (!Number.isSafeInteger(data.limit) ||
            data.limit <= 0 ||
            data.limit > exports.MAX_SALES_ORDER_INDEX_LIMIT) {
            throw new https_1.HttpsError("invalid-argument", `limit must be a positive integer no greater than ${exports.MAX_SALES_ORDER_INDEX_LIMIT}.`);
        }
        limit = data.limit;
    }
    const validStates = salesOrderLifecycle_1.SALES_ORDER_STATES;
    let state;
    if (data.state !== undefined) {
        if (typeof data.state === "string") {
            if (!validStates.includes(data.state)) {
                throw new https_1.HttpsError("invalid-argument", "state is not a recognized Sales Order state.");
            }
            state = data.state;
        }
        else if (Array.isArray(data.state)) {
            if (data.state.length === 0 || !data.state.every((s) => typeof s === "string" && validStates.includes(s))) {
                throw new https_1.HttpsError("invalid-argument", "state must be a non-empty array of recognized Sales Order states.");
            }
            state = data.state;
        }
        else {
            throw new https_1.HttpsError("invalid-argument", "state must be a Sales Order state or an array of them.");
        }
    }
    let afterCursor = null;
    if (data.cursor !== undefined) {
        if (typeof data.cursor !== "string") {
            throw new https_1.HttpsError("invalid-argument", "cursor must be a string.");
        }
        afterCursor = decodeSalesOrderIndexCursor(data.cursor);
    }
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.SALES_ORDER_READ_CAPABILITY],
        });
        allowed = decisions[exports.SALES_ORDER_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[listSalesOrderIndex] capability resolution failed for ${exports.SALES_ORDER_READ_CAPABILITY}`, err);
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Sales Orders.");
    try {
        const db = (0, firestore_1.getFirestore)();
        return await listSalesOrderIndexPage(db, { limit, state, afterCursor });
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        // X-SALES-ORDER-INDEX-500: this catch previously discarded `err` entirely -- no `logger`, no
        // `console.error` -- so the live 500 this callable returned in the sandbox had NO trace in Cloud
        // Logging beyond the bare request/response entry and the auth-verification debug line. Logged
        // server-side ONLY (Cloud Logging) before masking; the client-facing message is byte-for-byte
        // unchanged and still leaks no internal error string, stack, document id, or business data.
        console.error("listSalesOrderIndex: read failed", err);
        throw new https_1.HttpsError("internal", "The Sales Order read is temporarily unavailable.");
    }
});
//# sourceMappingURL=salesOrderReadService.js.map