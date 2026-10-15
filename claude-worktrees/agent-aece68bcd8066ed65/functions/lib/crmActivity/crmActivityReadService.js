"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCrmActivities = exports.CRM_ACTIVITY_MAX_LIMIT = exports.CRM_ACTIVITY_DEFAULT_LIMIT = exports.CRM_ACTIVITY_READ_CAPABILITY = void 0;
exports.projectCrmActivity = projectCrmActivity;
exports.readAccountCrmActivities = readAccountCrmActivities;
// CRM Activity / Notes — TRUSTED account-scoped READ (Taylor EOS Wave 7 extension, PART 1.4). Follows the
// exact shape of functions/src/salesOrder/salesOrderReadService.ts / functions/src/finance/
// financeReadCallables.ts's listAccountInvoiceAr: auth -> capability -> Admin SDK read -> pure project*()
// -> ready/not-found/unavailable envelope, with denied/unavailable distinguished. The client does NOT
// receive direct `crm_activities` read access (firestore.rules has no match block -- default deny,
// unchanged); this trusted backend reads via the Admin SDK and returns ONLY the minimal projection the
// CRM timeline UX needs.
//
// BOUNDED-READ HONESTY (mirrors listAccountInvoiceAr's own fix): fetches limit+1 and, if the extra row is
// present, the page is a TRUNCATION of the account's real activity set -- returns "unavailable", never a
// silently partial "ready" list.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const crmActivityTypes_1 = require("./crmActivityTypes");
exports.CRM_ACTIVITY_READ_CAPABILITY = "crm.activity.read";
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function toMillis(v) {
    if (v && typeof v === "object" && typeof v.toMillis === "function") {
        return v.toMillis();
    }
    return null;
}
// Pure projection of one canonical CRM Activity doc -> the minimal shape. Returns null if the doc cannot
// yield a usable projection (missing id, missing accountId, unrecognized type, missing body/occurredAt --
// an unrecognized/incomplete record is never trusted or guessed at, mirroring projectSalesOrder's own
// "return null rather than fabricate" rule).
function projectCrmActivity(id, data) {
    if (!id || !data || typeof data !== "object")
        return null;
    const accountId = str(data.accountId);
    if (!accountId)
        return null;
    if (!(0, crmActivityTypes_1.isCrmActivityType)(data.type))
        return null;
    const body = typeof data.body === "string" ? data.body : null;
    if (body === null)
        return null;
    const occurredAtMillis = num(data.occurredAtMillis);
    if (occurredAtMillis === null)
        return null;
    return {
        id,
        accountId,
        contactId: str(data.contactId),
        opportunityId: str(data.opportunityId),
        salesOrderId: str(data.salesOrderId),
        type: data.type,
        body,
        occurredAtMillis,
        // createdAt is a Firestore Timestamp (FieldValue.serverTimestamp() at write time) -- converted here,
        // not carried as a raw millis field, so the server clock stays the single source of truth (see
        // crmActivityCommands.ts's BuiltCrmActivity doc comment for the occurredAt-vs-createdAt contract).
        createdAtMillis: toMillis(data.createdAt),
        createdByUid: str(data.createdByUid),
    };
}
exports.CRM_ACTIVITY_DEFAULT_LIMIT = 100;
exports.CRM_ACTIVITY_MAX_LIMIT = 200;
// The core bounded read, factored out of the onCall adapter so it is exercisable directly (with an
// injected Firestore) in tests without needing a live `crm.activity.read` grant -- mirrors
// readAccountInvoiceAr (financeReadCallables.ts) exactly.
async function readAccountCrmActivities(db, accountId, limit) {
    try {
        const snap = await db.collection(collections_1.CRM_ACTIVITIES_COLLECTION).where("accountId", "==", accountId).limit(limit + 1).get();
        if (snap.size > limit) {
            // An honest "unavailable" -- a truncated page is never labeled "ready" (that status implies a
            // complete list).
            return { status: "unavailable", activities: [] };
        }
        const activities = snap.docs
            .map((d) => projectCrmActivity(d.id, d.data()))
            .filter((a) => a !== null)
            // Most-recent-interaction-first, by the BUSINESS fact (occurredAt), not the recording order.
            .sort((a, b) => b.occurredAtMillis - a.occurredAtMillis);
        return { status: "ready", activities };
    }
    catch {
        // A read failure is UNAVAILABLE, distinct from denied/empty -- never fabricated as "this account has
        // zero activities."
        return { status: "unavailable", activities: [] };
    }
}
async function requireCrmActivityRead(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.CRM_ACTIVITY_READ_CAPABILITY] });
        allowed = decisions[exports.CRM_ACTIVITY_READ_CAPABILITY] === true;
    }
    catch {
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read CRM Activities.");
}
// List the CRM Activity timeline for one account (minimal projection, most-recent-first). Returns
// { status, activities }: "ready" (a complete page, possibly empty) | "unavailable" (read failed, or the
// account's activities exceed `limit`) -- denied is thrown as permission-denied, matching every other
// trusted read in this codebase.
exports.getCrmActivities = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireCrmActivityRead(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.accountId !== "string" || data.accountId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "accountId is required.");
    }
    const limit = Number.isSafeInteger(data.limit) && data.limit > 0 && data.limit <= exports.CRM_ACTIVITY_MAX_LIMIT
        ? data.limit
        : exports.CRM_ACTIVITY_DEFAULT_LIMIT;
    return readAccountCrmActivities((0, firestore_1.getFirestore)(), data.accountId.trim(), limit);
});
//# sourceMappingURL=crmActivityReadService.js.map