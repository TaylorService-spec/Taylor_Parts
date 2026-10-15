"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSalesOrderContext = exports.listSalesOrdersForAccount = exports.SALES_ORDER_READ_CAPABILITY = void 0;
exports.projectSalesOrder = projectSalesOrder;
exports.readSalesOrdersForAccount = readSalesOrdersForAccount;
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
function projectSalesOrder(id, data) {
    if (!id || !data || typeof data !== "object")
        return null;
    const state = salesOrderLifecycle_1.SALES_ORDER_STATES.includes(data.state) ? data.state : null;
    if (!state)
        return null;
    const rawLines = Array.isArray(data.lines) ? data.lines : [];
    const lines = rawLines.map((l, i) => projectLine(l, i)).filter((l) => l !== null);
    const rawServiceWoIds = Array.isArray(data.serviceWorkOrderIds) ? data.serviceWorkOrderIds : [];
    const serviceWorkOrderIds = rawServiceWoIds.filter((v) => typeof v === "string" && v.trim().length > 0);
    return {
        id,
        accountId: str(data.accountId),
        ownerEmployeeId: str(data.ownerEmployeeId),
        salesChannel: str(data.salesChannel),
        currency: str(data.currency),
        locationId: str(data.locationId),
        sourceOpportunityId: str(data.sourceOpportunityId),
        customerPO: str(data.customerPO),
        notes: str(data.notes),
        state,
        lines,
        serviceWorkOrderIds,
        createdAtMillis: num(data.createdAtMillis),
        updatedAtMillis: num(data.updatedAtMillis),
    };
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
    catch {
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Sales Orders.");
    try {
        const db = (0, firestore_1.getFirestore)();
        return await readSalesOrdersForAccount(db, accountId, limit);
    }
    catch {
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
    catch {
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
        const result = { status: "ready", salesOrder: projection };
        return result;
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        // A read failure is UNAVAILABLE, distinct from denied/not-found -- surfaced as internal so the
        // client seam can render an honest "not connected / unavailable" state.
        throw new https_1.HttpsError("internal", "The Sales Order read is temporarily unavailable.");
    }
});
//# sourceMappingURL=salesOrderReadService.js.map