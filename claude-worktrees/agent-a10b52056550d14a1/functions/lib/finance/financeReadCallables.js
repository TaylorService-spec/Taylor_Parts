"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAccountInvoiceAr = exports.FINANCE_READ_CAPABILITY = void 0;
// Finance — trusted AR READ callable. A governed backend read over the Admin-SDK-only invoices collection:
// authorized principals get a MINIMAL AR projection for an account; the client never reads invoices directly
// (firestore.rules denies it). Mirrors the Opportunity trusted-read pattern:
//   • authorization = capability `finance.read`, fail-closed via the trusted effective-access feed; registered
//     active:false ⇒ hard DENY until a separate Owner grant;
//   • the read uses the Admin SDK and returns ONLY the projected AR fields (no PII, accountId only), deriving
//     the AR position from facts;
//   • distinct honest states: denied · empty · unavailable. This is a READ — it writes nothing and audits
//     nothing (no mutation), and it does not widen any client Rule.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const financeReadProjection_1 = require("./financeReadProjection");
exports.FINANCE_READ_CAPABILITY = "finance.read";
async function requireFinanceRead(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.FINANCE_READ_CAPABILITY] });
        allowed = decisions[exports.FINANCE_READ_CAPABILITY] === true;
    }
    catch {
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Finance AR.");
}
// List the AR reads for an account's invoices (minimal projection). Returns { status, invoices, summary }:
//   status "ready" (data, possibly empty) | "unavailable" (read failed) — denied is thrown as permission-denied.
exports.listAccountInvoiceAr = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireFinanceRead(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.accountId !== "string" || data.accountId.trim().length === 0)
        throw new https_1.HttpsError("invalid-argument", "accountId is required.");
    const limit = Number.isSafeInteger(data.limit) && data.limit > 0 && data.limit <= 200 ? data.limit : 100;
    const db = (0, firestore_1.getFirestore)();
    const now = Date.now();
    try {
        const snap = await db.collection(collections_1.INVOICES_COLLECTION).where("accountId", "==", data.accountId).limit(limit).get();
        const invoices = snap.docs.map((d) => (0, financeReadProjection_1.projectInvoiceAr)(d.id, d.data() ?? {}, now));
        return { status: "ready", invoices, summary: (0, financeReadProjection_1.summarizeAccountAr)(invoices) };
    }
    catch {
        // An honest "unavailable" — the read failed / is not connected — NOT "this account has zero invoices".
        return { status: "unavailable", invoices: [], summary: (0, financeReadProjection_1.summarizeAccountAr)([]) };
    }
});
//# sourceMappingURL=financeReadCallables.js.map