"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOpportunityContext = exports.listOpportunityContext = exports.listOpportunitiesForAccount = exports.OPPORTUNITY_READ_CAPABILITY = void 0;
exports.projectOpportunity = projectOpportunity;
exports.summarizeReadResult = summarizeReadResult;
exports.resolveAccountNames = resolveAccountNames;
exports.readOpportunitiesForAccount = readOpportunitiesForAccount;
exports.resolveSalesOrderNumber = resolveSalesOrderNumber;
exports.readOpportunityContext = readOpportunityContext;
// Sales Opportunity — TRUSTED MINIMAL READ PROJECTION (repo-only, fail-closed). Owner-ratified direction:
// the client does NOT receive broad direct-collection read authority merely for UI convenience. Instead a
// trusted backend resolves the caller's governed scope, reads canonical Opportunity records via the Admin
// SDK, and returns ONLY the minimal projection the Sales workspace needs. This deliberately AVOIDS a client
// firestore.rules widening for Opportunity reads (the `opportunities` collection stays Admin-SDK-only).
//
// Principles enforced here:
//   • fail closed; caller identity comes from the authenticated principal (request.auth.uid), never a
//     client-supplied employee id used as authorization;
//   • authorization is the governed capability `opportunity.read`, resolved through the trusted effective-
//     access feed. Registered `active: false` -- the PRODUCTION posture: measured 2026-09-12,
//     `opportunity.read` is held by ten governed business Roles (salesperson, salesManager,
//     marketingManager, dispatcher and the finance/GM oversight Roles) and is ACTIVATED in
//     platform-sandbox, so a sandbox holder is ALLOWED. Wherever it is not activated it denies
//     every principal regardless of grant;
//   • the projection returns ONLY fields the Sales operating experience needs — it preserves canonical
//     Account/Contact/Location authority (returns `accountId`, does NOT copy Customer name/PII into the
//     Opportunity for rendering), never exposes a raw Firebase UID as business identity, and invents no
//     forecast/pricing authority;
//   • distinguishes the states the UI must tell apart: denied · empty · unavailable · degraded.
//
// EXPORT != DEPLOY, REGISTER != GRANT. Exported for build/test only; nothing runs in production until a
// separate deploy + capability grant.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const opportunityLifecycle_1 = require("./opportunityLifecycle");
exports.OPPORTUNITY_READ_CAPABILITY = "opportunity.read";
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// A Firestore Timestamp, or a plain number, reduced to epoch millis. Duck-typed rather than
// instanceof-checked so this stays usable against the plain objects unit tests hand it.
const millis = (v) => {
    if (typeof v === "number" && Number.isFinite(v))
        return v;
    const t = v;
    if (t && typeof t.toMillis === "function") {
        const ms = t.toMillis();
        return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
    }
    return null;
};
// Pure projection of one canonical opportunity doc → the minimal shape. Returns null if the doc cannot yield
// a usable projection (missing id) so the caller can count it as a `degraded` skip rather than emit garbage.
function projectOpportunity(id, data) {
    if (!id || !data || typeof data !== "object")
        return null;
    const stage = opportunityLifecycle_1.OPPORTUNITY_STAGES.includes(data.stage) ? data.stage : null;
    const outcome = opportunityLifecycle_1.OPPORTUNITY_OUTCOMES.includes(data.outcome) ? data.outcome : null;
    const rawLines = Array.isArray(data.lines) ? data.lines : [];
    const lines = rawLines
        .map((l) => {
        const kind = str(l?.kind);
        const ref = str(l?.ref);
        if (!kind || !ref)
            return null;
        const qty = num(l?.qty);
        return qty != null ? { kind, ref, qty } : { kind, ref };
    })
        .filter((l) => l !== null);
    return {
        id,
        name: str(data.name),
        opportunityNumber: str(data.opportunityNumber),
        accountId: str(data.accountId),
        salesChannel: str(data.salesChannel),
        ownerEmployeeId: str(data.ownerEmployeeId),
        stage,
        outcome,
        need: str(data.need),
        expectedValue: num(data.expectedValue),
        expectedCloseAt: num(data.expectedCloseAt),
        nextAction: str(data.nextAction),
        lines,
        salesOrderId: str(data.salesOrderId),
        salesAgreementId: str(data.salesAgreementId),
        createdAtMillis: num(data.createdAtMillis),
        updatedAtMillis: num(data.updatedAtMillis),
        // `closedAtMillis` first only because a future write path may store it directly; `closedAt`
        // (the serverTimestamp the transition actually writes today) is what resolves in practice.
        closedAtMillis: millis(data.closedAtMillis) ?? millis(data.closedAt),
    };
}
// Pure: turn a set of {id,data} docs into the read result, marking `degraded` when any doc had to be skipped.
// `empty` is simply status:"ready" with an empty list — the client distinguishes empty from unavailable/denied.
function summarizeReadResult(docs) {
    const opportunities = [];
    let skipped = 0;
    for (const d of docs) {
        const p = projectOpportunity(d.id, d.data);
        if (p)
            opportunities.push(p);
        else
            skipped += 1;
    }
    return { status: skipped > 0 ? "degraded" : "ready", opportunities, skipped };
}
// ═══════════════════════════════ CUSTOMER NAMES, RESOLVED WHERE THE AUTHORITY IS ═══════════════════════════
//
// THE DEFECT. The Sales pipeline rendered an em dash in the Customer column of every Opportunity a
// real user has ever opened. Not a rendering bug: this projection returns `accountId` and nothing
// else (deliberately -- it does not copy Customer PII onto the Opportunity), the client source
// hard-codes `accountNameById: {}` for every governed read, and DECISIONS #106 correctly refuses to
// print a document id in a column labelled "Customer". So the column was honest, and useless.
//
// WHY NOT RESOLVE IT ON THE CLIENT. `useAccountNames` already does batched name resolution, and
// wiring it here would have worked -- for admins and dispatchers. firestore.rules grants `accounts`
// read to `isAdminOrDispatcher()` only, so the SALESPERSON -- the role whose workspace this is --
// would be told they are not authorized to see the name of the customer on their own opportunity.
// Fixing THAT by widening the Rules would hand the whole Account document, commercial profile and
// payment terms included, to a role that needs one string.
//
// So names resolve HERE, under the server's authority, exactly as F1 solved the identical problem
// for technicians (getWorkOrderFieldContext): a narrow projection that emits the display name and
// nothing else, for records the caller is ALREADY authorized to read.
//
// BOUNDED BY DISTINCT ANCHOR, not by row count. Fifty Opportunities across four accounts cost four
// reads, not fifty. The cap guards an unexpected fan-out; it is not an expected size.
//
// FAIL-SOFT. A failed name read must never fail the Opportunity read: losing the labels must not
// lose the pipeline. An unresolved id is simply absent from the map and the client renders the same
// honest em dash it renders today -- no worse than the current behaviour, and never a raw id.
const ACCOUNTS_COLLECTION = "accounts";
const MAX_RESOLVED_ACCOUNT_NAMES = 40;
/** The ONLY field this resolution may emit. Same rule and same shape as getWorkOrderFieldContext. */
function accountDisplayName(data) {
    const raw = data?.name;
    if (typeof raw !== "string")
        return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}
async function resolveAccountNames(db, opportunities) {
    const ids = [...new Set(opportunities.map((o) => o.accountId).filter((id) => !!id))];
    if (ids.length === 0)
        return {};
    const bounded = ids.slice(0, MAX_RESOLVED_ACCOUNT_NAMES);
    try {
        const snaps = await db.getAll(...bounded.map((id) => db.collection(ACCOUNTS_COLLECTION).doc(id)));
        const out = {};
        for (const snap of snaps) {
            // A missing account and an unnamed account are both simply UNRESOLVED here. That distinction
            // matters on a record page; in a list column both render the same honest absence.
            const name = snap.exists ? accountDisplayName(snap.data()) : null;
            if (name)
                out[snap.id] = name;
        }
        return out;
    }
    catch (err) {
        console.error("[resolveAccountNames] name resolution failed; returning the pipeline unlabelled", err);
        return {};
    }
}
// ---------------------------------------------------------------------------------------------------------
// ACCOUNT-SCOPED read (Wave 7 completion, PART 2). Answers "which Opportunities belong to THIS Account?" --
// listOpportunityContext above returns the caller's whole authorized scope with no accountId filter, which
// is the wrong shape for an Account workspace section. Reuses the SAME governed capability
// (`opportunity.read`) rather than minting a new one: the authorization question ("can this principal read
// Opportunities at all?") is identical: only the SERVER-SIDE query shape changes (accountId is a real
// Firestore `where` clause -- never a client-side filter over a broader read). Bounded: fetches `limit + 1`
// (mirrors financeReadCallables.ts's readAccountInvoiceAr) so a hit on the extra row honestly discloses
// `truncated: true` rather than silently dropping rows -- the UI shows "showing first N" instead of
// pretending the page is the whole account.
const DEFAULT_ACCOUNT_OPPORTUNITY_LIMIT = 50;
const MAX_ACCOUNT_OPPORTUNITY_LIMIT = 200;
// Core bounded read, factored out of the onCall adapter so it is directly testable without a live
// `opportunity.read` grant (mirrors readAccountInvoiceAr's own factoring).
async function readOpportunitiesForAccount(db, accountId, limit) {
    // No `.orderBy()` here on purpose: an equality filter + limit is served by Firestore's automatic
    // single-field index with zero composite-index requirement. Adding an orderBy on a different field would
    // require a new composite index (accountId ASC, <field> ASC) that does not exist today.
    const snap = await db.collection(collections_1.OPPORTUNITIES_COLLECTION).where("accountId", "==", accountId).limit(limit + 1).get();
    const truncated = snap.size > limit;
    const docs = snap.docs.slice(0, limit).map((d) => ({ id: d.id, data: d.data() }));
    const result = summarizeReadResult(docs);
    return { status: "ready", opportunities: result.opportunities, skipped: result.skipped, truncated };
}
// The trusted account-scoped read callable. Same fail-closed shape as listOpportunityContext: unauthenticated
// -> unauthenticated, missing/blank accountId -> invalid-argument (checked BEFORE authorization, matching
// getSalesOrderContext's own ordering), ungranted -> permission-denied, read failure -> internal ("unavailable").
// A genuinely malformed/unknown accountId is not an error -- it is an honest "ready" result with zero
// Opportunities (the account simply has none), exactly like listOpportunityContext's own empty case.
exports.listOpportunitiesForAccount = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const data = (request.data ?? {});
    if (typeof data.accountId !== "string" || data.accountId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "accountId is required.");
    }
    const accountId = data.accountId.trim();
    const limit = Number.isSafeInteger(data.limit) && data.limit > 0 && data.limit <= MAX_ACCOUNT_OPPORTUNITY_LIMIT
        ? data.limit
        : DEFAULT_ACCOUNT_OPPORTUNITY_LIMIT;
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.OPPORTUNITY_READ_CAPABILITY],
        });
        allowed = decisions[exports.OPPORTUNITY_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[listOpportunitiesForAccount] capability resolution failed for ${exports.OPPORTUNITY_READ_CAPABILITY}`, err);
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Opportunities.");
    try {
        const db = (0, firestore_1.getFirestore)();
        return await readOpportunitiesForAccount(db, accountId, limit);
    }
    catch {
        throw new https_1.HttpsError("internal", "The opportunity read is temporarily unavailable.");
    }
});
// The trusted read callable. Returns the projected result; maps failures to HttpsError so the client can
// distinguish denied (permission-denied) from unavailable (internal). Empty and degraded ride the payload.
/**
 * Cap for the whole-authorized-scope Opportunity read.
 *
 * Not the 50/200 of the account-scoped reads: those bound ONE account's Opportunities, while this
 * bounds every Opportunity a principal may see. Sized against resolveCoverageForContext's own
 * unscoped two-collection precedent rather than guessed.
 */
const OPPORTUNITY_CONTEXT_LIMIT = 1000;
exports.listOpportunityContext = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.OPPORTUNITY_READ_CAPABILITY],
        });
        allowed = decisions[exports.OPPORTUNITY_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[listOpportunityContext] capability resolution failed for ${exports.OPPORTUNITY_READ_CAPABILITY}`, err);
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Opportunities.");
    try {
        const db = (0, firestore_1.getFirestore)();
        // BOUNDED READ. This is the caller's WHOLE authorized scope, so there is no accountId to
        // narrow it -- which is exactly why it needs a cap rather than deserving an exemption from
        // one. An unbounded .get() over `opportunities` is a client-side dataset-ownership
        // assumption on the server side of the wire, and it grows without limit.
        //
        // Sized like listCoordinatedOperations rather than like the account-scoped reads: 50/200
        // are calibrated for one account's Opportunities, not for every Opportunity a principal can
        // see. There is deliberately NO client-supplied limit, because nothing about this call is
        // per-caller parameterized yet.
        //
        // Truncation is reported as a separate `truncated` flag rather than by downgrading status,
        // because OpportunityReadStatus is "ready" | "degraded" and `degraded` already means
        // something specific and different (some documents failed projection). Overloading it would
        // silently redefine that word for a consumer already interpreting it. This mirrors
        // readOpportunitiesForAccount in this same file.
        const snap = await db.collection(collections_1.OPPORTUNITIES_COLLECTION).limit(OPPORTUNITY_CONTEXT_LIMIT + 1).get();
        const truncated = snap.size > OPPORTUNITY_CONTEXT_LIMIT;
        const docs = snap.docs.slice(0, OPPORTUNITY_CONTEXT_LIMIT);
        const result = summarizeReadResult(docs.map((d) => ({ id: d.id, data: d.data() })));
        const accountNameById = await resolveAccountNames(db, result.opportunities);
        return { status: result.status, opportunities: result.opportunities, skipped: result.skipped, truncated, accountNameById };
    }
    catch {
        // A read failure is UNAVAILABLE, distinct from denied/empty — surfaced as internal so the client seam
        // can render an honest "not connected / unavailable" state rather than "you have zero opportunities".
        throw new https_1.HttpsError("internal", "The opportunity read is temporarily unavailable.");
    }
});
const SALES_ORDERS_COLLECTION_FOR_LINEAGE = "salesOrders";
/**
 * The one display field a linked Sales Order may contribute to an Opportunity page.
 *
 * FAIL-SOFT, deliberately: a failed lineage read must never fail the Opportunity read. Losing the
 * label must not lose the record -- the page then renders the honest "reference unavailable", which
 * is what it would render for an order that predates numbering anyway.
 */
async function resolveSalesOrderNumber(db, salesOrderId) {
    if (!salesOrderId)
        return null;
    try {
        const snap = await db.collection(SALES_ORDERS_COLLECTION_FOR_LINEAGE).doc(salesOrderId).get();
        if (!snap.exists)
            return null;
        return str((snap.data() ?? {}).salesOrderNumber);
    }
    catch (err) {
        console.error("[resolveSalesOrderNumber] lineage label read failed; returning the record unlabelled", err);
        return null;
    }
}
/**
 * Core per-id read, factored out of the onCall adapter so it is directly testable without a live
 * `opportunity.read` grant -- the same factoring readOpportunitiesForAccount already uses.
 */
async function readOpportunityContext(db, opportunityId) {
    const snap = await db.collection(collections_1.OPPORTUNITIES_COLLECTION).doc(opportunityId).get();
    if (!snap.exists) {
        return { status: "not-found", opportunity: null, accountName: null, salesOrderNumber: null };
    }
    const opportunity = projectOpportunity(snap.id, snap.data());
    if (!opportunity) {
        // A document that exists but cannot be honestly projected is NOT "not-found": the record is
        // there and the reader would be told it never existed. It is a read that cannot be served,
        // which is what `internal` means -- so this throws and the adapter maps it to "unavailable".
        throw new Error(`opportunity ${opportunityId} could not be projected`);
    }
    // The two lineage/label resolutions are independent and both fail-soft, so they run together
    // rather than serially; neither can reject.
    const [names, salesOrderNumber] = await Promise.all([
        resolveAccountNames(db, [opportunity]),
        resolveSalesOrderNumber(db, opportunity.salesOrderId),
    ]);
    return {
        status: "ready",
        opportunity,
        accountName: opportunity.accountId ? (names[opportunity.accountId] ?? null) : null,
        salesOrderNumber,
    };
}
exports.getOpportunityContext = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const data = (request.data ?? {});
    if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "opportunityId is required.");
    }
    const opportunityId = data.opportunityId.trim();
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.OPPORTUNITY_READ_CAPABILITY],
        });
        allowed = decisions[exports.OPPORTUNITY_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[getOpportunityContext] capability resolution failed for ${exports.OPPORTUNITY_READ_CAPABILITY}`, err);
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Opportunities.");
    try {
        const db = (0, firestore_1.getFirestore)();
        return await readOpportunityContext(db, opportunityId);
    }
    catch (err) {
        // Logged server-side only; the client still receives the generic "unavailable". Without this
        // a read failure here is undiagnosable in production -- the same defect listSalesOrdersForAccount
        // records against itself.
        console.error("getOpportunityContext: read failed", err);
        throw new https_1.HttpsError("internal", "The opportunity read is temporarily unavailable.");
    }
});
//# sourceMappingURL=opportunityReadService.js.map