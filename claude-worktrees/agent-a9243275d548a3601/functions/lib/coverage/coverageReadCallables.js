"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCoverageForContext = exports.COVERAGE_READ_CAPABILITY = void 0;
// Commercial Coverage — trusted READ callable. A governed backend resolve over the Admin-SDK-only coverage
// collections — the client never reads sales_territories / commercial_coverage_assignments directly
// (firestore.rules denies it). Mirrors the Opportunity/Finance trusted-read pattern:
//   • authorization = capability `coverage.read`, fail-closed via the trusted effective-access feed; registered
//     active:false ⇒ hard DENY until a separate Owner grant;
//   • the read uses the Admin SDK and returns the resolved coverageAssignments[] for a context — ALL effective
//     + matching (split coverage), NEVER one salesperson / no winner / no credit / no commission;
//   • distinct honest states: denied · ready (possibly empty) · unavailable. Writes nothing; audits nothing;
//     widens no client Rule.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const coverageResolution_1 = require("./coverageResolution");
exports.COVERAGE_READ_CAPABILITY = "coverage.read";
async function requireCoverageRead(uid) {
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [exports.COVERAGE_READ_CAPABILITY] });
        allowed = decisions[exports.COVERAGE_READ_CAPABILITY] === true;
    }
    catch {
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read commercial coverage.");
}
// Project one assignment into the minimal read shape (identity refs + scope + responsibility + dates; no
// derived credit/commission/winner).
function projectAssignment(id, a) {
    return {
        assignmentId: id,
        assignee: a.assignee ?? null,
        scope: a.scope ?? null,
        responsibility: a.responsibility ?? null,
        priority: a.priority ?? null,
        effectiveFrom: a.effectiveFrom ?? null,
        effectiveTo: a.effectiveTo ?? null,
    };
}
// Resolve the commercial coverage for a context (company-scoped). Returns { status, coverageAssignments }:
// ALL effective + matching assignments (split coverage). status "ready" (possibly empty) | "unavailable".
exports.resolveCoverageForContext = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireCoverageRead(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.companyId !== "string" || data.companyId.trim().length === 0)
        throw new https_1.HttpsError("invalid-argument", "companyId is required.");
    const ctx = data.context ?? {};
    const db = (0, firestore_1.getFirestore)();
    const now = Date.now();
    try {
        // Scope the read to the company; resolve over the (bounded) active assignment set + the territories.
        const [assignSnap, terrSnap] = await Promise.all([
            db.collection(collections_1.COMMERCIAL_COVERAGE_ASSIGNMENTS_COLLECTION).where("companyId", "==", data.companyId).limit(1001).get(),
            db.collection(collections_1.SALES_TERRITORIES_COLLECTION).limit(1001).get(),
        ]);
        // A bounded resolver must never label a truncated result as complete. Return the existing unavailable
        // state until pagination/another authoritative retrieval strategy is introduced.
        if (assignSnap.size > 1000 || terrSnap.size > 1000) {
            return { status: "unavailable", coverageAssignments: [] };
        }
        const assignments = assignSnap.docs.map((d) => ({ assignmentId: d.id, ...d.data() }));
        const territoriesById = {};
        for (const d of terrSnap.docs)
            territoriesById[d.id] = d.data();
        const resolved = (0, coverageResolution_1.resolveCommercialCoverage)(ctx, assignments, { now, territoriesById });
        return { status: "ready", coverageAssignments: resolved.map((a) => projectAssignment(a.assignmentId, a)) };
    }
    catch {
        return { status: "unavailable", coverageAssignments: [] };
    }
});
//# sourceMappingURL=coverageReadCallables.js.map