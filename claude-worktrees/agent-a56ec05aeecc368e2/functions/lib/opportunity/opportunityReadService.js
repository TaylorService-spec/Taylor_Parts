"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listOpportunityContext = exports.OPPORTUNITY_READ_CAPABILITY = void 0;
exports.projectOpportunity = projectOpportunity;
exports.summarizeReadResult = summarizeReadResult;
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
//     access feed (registered active:false ⇒ ungranted ⇒ deny for everyone until a separate Owner grant);
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
// The trusted read callable. Returns the projected result; maps failures to HttpsError so the client can
// distinguish denied (permission-denied) from unavailable (internal). Empty and degraded ride the payload.
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
    catch {
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Opportunities.");
    try {
        const db = (0, firestore_1.getFirestore)();
        const snap = await db.collection(collections_1.OPPORTUNITIES_COLLECTION).get();
        const result = summarizeReadResult(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
        return { status: result.status, opportunities: result.opportunities, skipped: result.skipped };
    }
    catch {
        // A read failure is UNAVAILABLE, distinct from denied/empty — surfaced as internal so the client seam
        // can render an honest "not connected / unavailable" state rather than "you have zero opportunities".
        throw new https_1.HttpsError("internal", "The opportunity read is temporarily unavailable.");
    }
});
//# sourceMappingURL=opportunityReadService.js.map