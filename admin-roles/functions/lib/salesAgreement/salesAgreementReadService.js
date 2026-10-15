"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSalesAgreementForOpportunity = exports.getSalesAgreementContext = exports.SALES_AGREEMENT_READ_CAPABILITY = void 0;
exports.projectSalesAgreement = projectSalesAgreement;
exports.readSalesAgreementById = readSalesAgreementById;
exports.readSalesAgreementForOpportunity = readSalesAgreementForOpportunity;
// Sales Agreement — TRUSTED MINIMAL READ PROJECTION (repo-only, fail-closed).
//
// GOVERNANCE: Owner Slice 4 §F. Follows the `salesOrder.read` / `opportunity.read` pattern exactly:
// the client gets NO direct `sales_agreements` access (firestore.rules denies read and write for
// every client), a trusted backend resolves the caller's governed capability, reads the canonical
// document through the Admin SDK, and returns only the projection the Agreement UX needs.
//
// TWO ENTRY POINTS, BECAUSE THERE ARE TWO WAYS A PERSON ARRIVES:
//
//   getSalesAgreementContext        by agreement id — from a link they already hold
//   getSalesAgreementForOpportunity by OPPORTUNITY id — the real entry point, because a
//                                   salesperson standing on an Opportunity does not know whether
//                                   an agreement exists yet. Answering "none yet" is the whole
//                                   point: the Opportunity screen has to decide between offering
//                                   CREATE and offering VIEW, and a not-found is the answer that
//                                   distinguishes them.
//
// LINEAGE IS PROJECTED IN BOTH DIRECTIONS. `sourceOpportunityId` (which negotiation this came from)
// and `salesOrderId` (which order it became, once converted) both travel, because the Agreement is
// the middle of the chain and a screen that can only see one side cannot show where it sits.
//
// IDENTITY: `salesAgreementNumber` is the displayed identity, allocated server-side at creation.
// Null on nothing today — numbering ships in the same slice as the create path — but projected as
// honestly nullable anyway, because DECISIONS #106 forbids the document id standing in for it and a
// non-nullable type would invite exactly that substitution the first time one is missing.
//
// EXPORT != DEPLOY, REGISTER != GRANT. Exported for build/test only; nothing runs until a separate
// deploy + capability grant + per-environment activation.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const salesAgreementLifecycle_1 = require("./salesAgreementLifecycle");
exports.SALES_AGREEMENT_READ_CAPABILITY = "salesAgreement.read";
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
// Integer minor units or null. A stored float is NOT rounded into a plausible number here — money
// that arrived wrong should read as absent, not as a value nobody wrote.
const money = (v) => (typeof v === "number" && Number.isInteger(v) ? v : null);
const millis = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function projectLine(raw, index) {
    const l = (raw ?? {});
    const kind = salesAgreementLifecycle_1.SALES_AGREEMENT_LINE_KINDS.includes(l.kind)
        ? l.kind
        : null;
    const quantity = typeof l.quantity === "number" && Number.isInteger(l.quantity) ? l.quantity : null;
    const unitPriceMinor = money(l.unitPrice);
    return {
        lineId: str(l.lineId) ?? `line-${index + 1}`,
        kind,
        ref: str(l.ref),
        quantity,
        unitPriceMinor,
        // Recomputed rather than read: a stored extension that disagreed with quantity x price would be
        // a second answer, and the two factors are right there.
        extendedMinor: quantity === null || unitPriceMinor === null ? null : quantity * unitPriceMinor,
        condition: str(l.condition),
        warranty: str(l.warranty),
        estimatedArrivalMillis: millis(l.estimatedArrivalMillis),
    };
}
function projectSalesAgreement(id, data) {
    const totals = (data.totals ?? {});
    const rawLines = Array.isArray(data.lines) ? data.lines : [];
    return {
        id,
        salesAgreementNumber: str(data.salesAgreementNumber),
        state: salesAgreementLifecycle_1.SALES_AGREEMENT_STATES.includes(data.state)
            ? data.state
            : null,
        accountId: str(data.accountId),
        ownerEmployeeId: str(data.ownerEmployeeId),
        locationId: str(data.locationId),
        currency: str(data.currency),
        customerPO: str(data.customerPO),
        isLease: data.isLease === true,
        fulfillmentIntent: str(data.fulfillmentIntent),
        shippingInstructions: str(data.shippingInstructions),
        shipVia: str(data.shipVia),
        specialInstructions: str(data.specialInstructions),
        lines: rawLines.map(projectLine),
        subtotalMinor: money(totals.subtotalMinor),
        shippingMinor: money(totals.shippingMinor),
        installChargeMinor: money(totals.installChargeMinor),
        taxMinor: money(totals.taxMinor),
        totalMinor: money(totals.totalMinor),
        downPaymentMinor: money(totals.downPaymentMinor),
        tradeInMinor: money(totals.tradeInMinor),
        balanceMinor: money(totals.balanceMinor),
        sourceOpportunityId: str(data.sourceOpportunityId),
        salesOrderId: str(data.salesOrderId),
        acceptedAtMillis: millis(data.acceptedAtMillis),
        acceptedByUid: str(data.acceptedByUid),
        createdAtMillis: millis(data.createdAtMillis),
        updatedAtMillis: millis(data.updatedAtMillis),
    };
}
/** Fail-closed capability check. A throwing resolver is a DENIAL, never an allow. */
async function requireAgreementRead(uid, label) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: uid,
            permissionIds: [exports.SALES_AGREEMENT_READ_CAPABILITY],
        });
        allowed = decisions[exports.SALES_AGREEMENT_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[${label}] capability resolution failed for ${exports.SALES_AGREEMENT_READ_CAPABILITY}`, err);
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read Sales Agreements.");
}
async function readSalesAgreementById(db, id) {
    const snap = await db.collection(collections_1.SALES_AGREEMENTS_COLLECTION).doc(id).get();
    if (!snap.exists)
        return { status: "not-found", salesAgreement: null };
    return { status: "ready", salesAgreement: projectSalesAgreement(snap.id, snap.data()) };
}
/**
 * The Agreement for one Opportunity, or an honest "none yet".
 *
 * ONE equality predicate on ONE field: Firestore's automatic single-field index serves it. No
 * composite is declared and none is needed — the same query the conversion already runs.
 */
async function readSalesAgreementForOpportunity(db, opportunityId) {
    const snap = await db
        .collection(collections_1.SALES_AGREEMENTS_COLLECTION)
        .where("sourceOpportunityId", "==", opportunityId)
        .limit(1)
        .get();
    if (snap.empty)
        return { status: "not-found", salesAgreement: null };
    const doc = snap.docs[0];
    return { status: "ready", salesAgreement: projectSalesAgreement(doc.id, doc.data()) };
}
exports.getSalesAgreementContext = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const data = (request.data ?? {});
    if (typeof data.salesAgreementId !== "string" || data.salesAgreementId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "salesAgreementId is required.");
    }
    await requireAgreementRead(request.auth.uid, "getSalesAgreementContext");
    try {
        return await readSalesAgreementById((0, firestore_1.getFirestore)(), data.salesAgreementId.trim());
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        // A read failure is UNAVAILABLE, distinct from denied and from not-found. Logged server-side
        // only; the client message stays generic.
        console.error("getSalesAgreementContext: read failed", err);
        throw new https_1.HttpsError("internal", "The Sales Agreement read is temporarily unavailable.");
    }
});
exports.getSalesAgreementForOpportunity = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const data = (request.data ?? {});
    if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "opportunityId is required.");
    }
    await requireAgreementRead(request.auth.uid, "getSalesAgreementForOpportunity");
    try {
        return await readSalesAgreementForOpportunity((0, firestore_1.getFirestore)(), data.opportunityId.trim());
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        console.error("getSalesAgreementForOpportunity: read failed", err);
        throw new https_1.HttpsError("internal", "The Sales Agreement read is temporarily unavailable.");
    }
});
//# sourceMappingURL=salesAgreementReadService.js.map