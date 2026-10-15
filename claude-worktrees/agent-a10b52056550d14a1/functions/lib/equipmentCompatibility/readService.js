"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_EVIDENCE_READS_PER_REQUEST = exports.MAX_EVIDENCE_PER_RELATIONSHIP = exports.MAX_PAGE = exports.DEFAULT_PAGE = exports.READ_CAPABILITY = void 0;
exports.readCompatibilityForPart = readCompatibilityForPart;
exports.readCompatibilityForModel = readCompatibilityForModel;
exports.readModelSummary = readModelSummary;
const firestore_1 = require("firebase-admin/firestore");
const repository_1 = require("./repository");
const compatibilityRepository_1 = require("./compatibilityRepository");
const equipmentModelRepository_1 = require("./equipmentModelRepository");
const compatibility_1 = require("./domain/compatibility");
const equipmentModel_1 = require("./domain/equipmentModel");
const errors_1 = require("./errors");
const readCursor_1 = require("./readCursor");
exports.READ_CAPABILITY = "equipment.compatibility.view";
exports.DEFAULT_PAGE = 25;
exports.MAX_PAGE = 50;
exports.MAX_EVIDENCE_PER_RELATIONSHIP = 20;
exports.MAX_EVIDENCE_READS_PER_REQUEST = 100;
const MAX_SERIAL_SUMMARY = 160;
const ZERO_COUNTS = { returned: 0, operational: 0, excludedRejected: 0, malformedOmitted: 0, evidenceIncomplete: 0 };
const denied = () => ({ pageDisposition: "DENIED", items: [], nextCursor: null, windowCounts: ZERO_COUNTS });
const unavailable = () => ({ pageDisposition: "UNAVAILABLE", items: [], nextCursor: null, windowCounts: ZERO_COUNTS });
const emptyPage = () => ({ pageDisposition: "EMPTY", items: [], nextCursor: null, windowCounts: ZERO_COUNTS });
async function isGranted(deps, actorUid) {
    try {
        return (await deps.resolvePermission({ actorUid, capabilityId: exports.READ_CAPABILITY })) === true;
    }
    catch {
        return false; // a throwing resolver denies, never approves
    }
}
const clampLimit = (limit) => {
    if (limit === undefined || limit === null)
        return exports.DEFAULT_PAGE;
    if (typeof limit !== "number" || !Number.isInteger(limit))
        throw new errors_1.InvalidInputError("limit must be an integer");
    return Math.max(1, Math.min(exports.MAX_PAGE, limit));
};
// DERIVED, bounded, and serial-safe: never emits a raw serial value or list.
function serialApplicabilitySummary(applicability) {
    let s;
    switch (applicability.kind) {
        case "ALL_SERIALS":
            s = "Applies to all serial numbers";
            break;
        case "SERIAL_RANGE":
            s = "Applies to a specific serial range";
            break;
        case "MODEL_REVISION":
            s = `Applies to model revision ${applicability.modelRevision ?? ""}`.trim();
            break;
        default:
            s = "Serial applicability unresolved";
            break; // UNRESOLVED
    }
    return s.length > MAX_SERIAL_SUMMARY ? s.slice(0, MAX_SERIAL_SUMMARY) : s;
}
// Point read of the model for display. Malformed/missing => model null (item non-operational). A genuine
// backend error is rethrown so the whole response becomes UNAVAILABLE (distinct from a data problem).
async function readModelForDisplay(deps, equipmentModelId) {
    const snap = await deps.db.collection(repository_1.EQUIPMENT_MODELS_COLLECTION).doc(equipmentModelId).get();
    if (!snap.exists)
        return null;
    try {
        const stored = (0, equipmentModelRepository_1.modelFromFirestore)(snap.id, (0, repository_1.requireData)(snap.id, snap.data()));
        const m = stored.model;
        return { manufacturerName: m.manufacturerName, modelNumber: m.modelNumber, displayName: m.displayName, family: m.family, subtype: m.subtype };
    }
    catch (e) {
        if (e instanceof repository_1.MalformedStoredRecordError)
            return null;
        throw e;
    }
}
// Bounded evidence read for ONE relationship, subject to a per-request read-work budget. D5 issues its
// OWN bounded query rather than D4's unlimited listByCompatibilityId.
async function readEvidenceSummary(deps, compatibilityId, budget) {
    const incomplete = (windowSize, supports, contradicts, strongest) => ({ status: "INCOMPLETE", windowComplete: false, strongestSupportingAuthority: strongest, boundedSupportsCount: supports, boundedContradictsCount: contradicts, windowSize });
    if (budget.remaining <= 0)
        return incomplete(0, 0, 0, null); // request read-work budget exhausted
    // HARD budget: never request more than the request budget still allows. `cap` is at most the
    // per-relationship window+1 probe, and at most the remaining budget — so `snap.size <= cap <=
    // budget.remaining` and the running total of actual evidence reads can never exceed
    // MAX_EVIDENCE_READS_PER_REQUEST, nor can `budget.remaining` go negative.
    const cap = Math.min(exports.MAX_EVIDENCE_PER_RELATIONSHIP + 1, budget.remaining);
    const snap = await deps.db
        .collection(repository_1.EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION)
        .where("compatibilityId", "==", compatibilityId)
        .orderBy(firestore_1.FieldPath.documentId())
        .limit(cap)
        .get();
    budget.remaining -= snap.size;
    // Two DISTINCT reasons completeness cannot be established, both => INCOMPLETE:
    //  - relationship OVERFLOW: a full window was allowed (cap === window+1) yet the +1 probe still returned;
    //  - BUDGET-limited truncation: the budget capped us at/under the window and we filled that cap, so more
    //    evidence MAY exist that we are not permitted to read.
    // A short result strictly below `cap` proves we read the whole set => completeness established (OK).
    const overflow = snap.size > exports.MAX_EVIDENCE_PER_RELATIONSHIP;
    const budgetTruncated = cap <= exports.MAX_EVIDENCE_PER_RELATIONSHIP && snap.size === cap;
    const docs = snap.docs.slice(0, exports.MAX_EVIDENCE_PER_RELATIONSHIP);
    let supports = 0, contradicts = 0, malformed = false;
    let strongest = null, strongestRank = -1;
    for (const d of docs) {
        let claim, authorityType;
        try {
            const stored = (0, compatibilityRepository_1.sourceFromFirestore)(d.id, (0, repository_1.requireData)(d.id, d.data()));
            if (stored.source.compatibilityId !== compatibilityId) {
                malformed = true;
                continue;
            } // defence in depth
            claim = stored.source.observedClaim;
            authorityType = stored.source.authorityType;
        }
        catch (e) {
            if (e instanceof repository_1.MalformedStoredRecordError) {
                malformed = true;
                continue;
            }
            throw e; // genuine backend error => outer catch => UNAVAILABLE
        }
        if (claim === "SUPPORTS") {
            supports += 1;
            const rank = compatibility_1.AUTHORITY_RANK[authorityType] ?? -1;
            if (rank > strongestRank) {
                strongestRank = rank;
                strongest = authorityType;
            }
        }
        else if (claim === "CONTRADICTS") {
            contradicts += 1;
        }
    }
    if (malformed)
        return { status: "UNAVAILABLE", windowComplete: false, strongestSupportingAuthority: strongest, boundedSupportsCount: supports, boundedContradictsCount: contradicts, windowSize: docs.length };
    if (overflow || budgetTruncated)
        return incomplete(docs.length, supports, contradicts, strongest);
    return { status: "OK", windowComplete: true, strongestSupportingAuthority: strongest, boundedSupportsCount: supports, boundedContradictsCount: contradicts, windowSize: docs.length };
}
async function runRelationshipRead(deps, args) {
    // Malformed-request validation FIRST — purely SYNTACTIC on caller-supplied input (key format, limit,
    // cursor shape). It reads no data, so it leaks nothing to an unauthorized caller, and it lets a
    // malformed request surface as invalid-argument rather than being masked by DENIED. A WELL-FORMED
    // request from an unauthorized caller still returns DENIED below (no data revealed).
    if (args.keyField === "partId") {
        if (!(0, compatibility_1.isValidPartId)(args.key))
            throw new errors_1.InvalidInputError("partId is malformed");
    }
    else if (!(0, equipmentModel_1.isCanonicalEquipmentModelId)(args.key)) {
        throw new errors_1.InvalidInputError("equipmentModelId is malformed");
    }
    const pageLimit = clampLimit(args.limit);
    const afterId = args.cursor !== undefined ? (0, readCursor_1.decodeCursor)(args.cursor, { dir: args.dir, key: args.key }).afterId : undefined;
    if (!(await isGranted(deps, args.actorUid)))
        return denied();
    try {
        let query = deps.db
            .collection(repository_1.EQUIPMENT_PART_COMPATIBILITY_COLLECTION)
            .where(args.keyField, "==", args.key)
            .orderBy(firestore_1.FieldPath.documentId());
        if (afterId !== undefined)
            query = query.startAfter(afterId);
        const snap = await query.limit(pageLimit + 1).get();
        if (snap.empty)
            return emptyPage();
        const hasMore = snap.size > pageLimit;
        const pageDocs = snap.docs.slice(0, pageLimit);
        const nextCursor = hasMore ? (0, readCursor_1.encodeCursor)({ dir: args.dir, key: args.key, afterId: pageDocs[pageDocs.length - 1].id }) : null;
        const budget = { remaining: exports.MAX_EVIDENCE_READS_PER_REQUEST };
        const items = [];
        let excludedRejected = 0, malformedOmitted = 0, evidenceIncomplete = 0, degraded = false;
        for (const doc of pageDocs) {
            let c;
            try {
                c = (0, compatibilityRepository_1.compatibilityFromFirestore)(doc.id, (0, repository_1.requireData)(doc.id, doc.data()), { serialSchemes: deps.serialSchemes }).compatibility;
            }
            catch (e) {
                if (e instanceof repository_1.MalformedStoredRecordError) {
                    malformedOmitted += 1;
                    degraded = true;
                    continue;
                }
                throw e;
            }
            // Defence in depth: a doc returned by the bound query MUST actually carry the queried key.
            if (c[args.keyField] !== args.key) {
                malformedOmitted += 1;
                degraded = true;
                continue;
            }
            // REJECTED is excluded from results but COUNTED — never represented as "no records".
            if (c.verificationStatus === "REJECTED") {
                excludedRejected += 1;
                continue;
            }
            // Model and evidence are independent. Start the model lookup before the budgeted evidence read so the
            // two network round trips overlap; evidence remains sequential because it consumes the shared budget.
            const modelPromise = readModelForDisplay(deps, c.equipmentModelId);
            const evidence = await readEvidenceSummary(deps, c.compatibilityId, budget);
            const model = await modelPromise;
            if (model === null)
                degraded = true;
            if (evidence.status !== "OK") {
                evidenceIncomplete += 1;
                degraded = true;
            }
            const applicabilityResolved = c.applicability.kind !== "UNRESOLVED";
            const operational = c.verificationStatus === "VERIFIED" && applicabilityResolved && model !== null && evidence.status === "OK";
            items.push({
                compatibilityId: c.compatibilityId,
                equipmentModelId: c.equipmentModelId,
                partId: c.partId,
                model,
                compatibilityType: c.compatibilityType,
                assembly: c.assembly,
                installationPosition: c.installationPosition,
                quantityRequired: c.quantityRequired,
                serialApplicabilitySummary: serialApplicabilitySummary(c.applicability),
                verificationStatus: c.verificationStatus,
                applicabilityResolved,
                confidenceLevel: c.confidenceLevel,
                operational,
                evidence,
            });
        }
        const pageDisposition = degraded ? "DEGRADED" : "AVAILABLE";
        return {
            pageDisposition,
            items,
            nextCursor,
            windowCounts: {
                returned: items.length,
                operational: items.filter((i) => i.operational).length,
                excludedRejected,
                malformedOmitted,
                evidenceIncomplete,
            },
        };
    }
    catch (e) {
        if (e instanceof errors_1.InvalidInputError)
            throw e; // (defensive) — malformed request, not a backend failure
        return unavailable(); // genuine backend/read error, rendered distinctly from EMPTY
    }
}
// FORWARD: the compatibility relationships that cite a canonical Part.
function readCompatibilityForPart(deps, input) {
    return runRelationshipRead(deps, { actorUid: input.actorUid, dir: "forward", keyField: "partId", key: input.partId, cursor: input.cursor, limit: input.limit });
}
// REVERSE: the compatibility relationships that cite an Equipment Model.
function readCompatibilityForModel(deps, input) {
    return runRelationshipRead(deps, { actorUid: input.actorUid, dir: "reverse", keyField: "equipmentModelId", key: input.equipmentModelId, cursor: input.cursor, limit: input.limit });
}
// Point read of a single Equipment Model's display summary.
async function readModelSummary(deps, input) {
    if (!(0, equipmentModel_1.isCanonicalEquipmentModelId)(input.equipmentModelId))
        throw new errors_1.InvalidInputError("equipmentModelId is malformed"); // syntactic, pre-auth
    if (!(await isGranted(deps, input.actorUid)))
        return { disposition: "DENIED", model: null };
    try {
        const snap = await deps.db.collection(repository_1.EQUIPMENT_MODELS_COLLECTION).doc(input.equipmentModelId).get();
        if (!snap.exists)
            return { disposition: "EMPTY", model: null };
        let model;
        try {
            const stored = (0, equipmentModelRepository_1.modelFromFirestore)(snap.id, (0, repository_1.requireData)(snap.id, snap.data()));
            const m = stored.model;
            model = { manufacturerName: m.manufacturerName, modelNumber: m.modelNumber, displayName: m.displayName, family: m.family, subtype: m.subtype };
        }
        catch (e) {
            if (e instanceof repository_1.MalformedStoredRecordError)
                return { disposition: "DEGRADED", model: null };
            throw e;
        }
        return { disposition: "AVAILABLE", model };
    }
    catch (e) {
        if (e instanceof errors_1.InvalidInputError)
            throw e;
        return { disposition: "UNAVAILABLE", model: null };
    }
}
//# sourceMappingURL=readService.js.map