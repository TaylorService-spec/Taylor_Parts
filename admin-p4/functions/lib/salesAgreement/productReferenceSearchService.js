"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchProductReferences = exports.EQUIPMENT_MODEL_LIST_CAP = exports.MAX_SEARCH_LIMIT = exports.DEFAULT_SEARCH_LIMIT = exports.MIN_SEARCH_LENGTH = exports.INVENTORY_CATALOG_READ_CAPABILITY = void 0;
exports.projectProductReference = projectProductReference;
exports.searchParts = searchParts;
exports.listEquipmentModels = listEquipmentModels;
// THE PRODUCT PICKER'S READ — bounded search over the two catalogs a commercial line may name.
//
// ════════════════════ WHY THIS EXISTS AT ALL ════════════════════
//
// A Sales Agreement line's `ref` is now validated against the authoritative catalog
// (salesAgreementLineReferences.ts), so a person typing a product reference by hand is being asked
// to reproduce a canonical id from memory and is told they were wrong only after they submit. The
// control is correct and unusable without a way to SEE what exists.
//
// The obvious way to serve a picker is to let the client read the catalogs. It cannot:
//
//   `equipment_models` denies client reads outright -- verified live, denied even for admin.
//   `parts` is readable, and is the wrong shape for a dropdown: it is the whole parts catalog, and
//    client-owning it is the dataset ownership boundary DECISIONS #102 §9 draws.
//
// And the role that needs this most is the SALESPERSON, who cannot read `accounts` either. Widening
// Rules to populate a selector would hand whole documents to a role that needs four fields.
//
// So this is a bounded server-side projection: minimum fields, capped results, existing capability.
//
// ════════════════════ NO NEW CAPABILITY ════════════════════
//
// `inventory.catalog.read` already exists, is already active in the sandbox, and already means
// exactly this ("may this principal read the product catalog"). Resolved live before choosing it:
// salesperson TRUE, salesManager TRUE, dispatcher TRUE, admin TRUE, technician FALSE. A technician
// therefore gains no catalog authority through this feature, which is the property that matters --
// minting a `salesAgreement.catalog.search` would have created a second answer to a question the
// repository already answers, and the two would drift.
//
// ════════════════════ SEARCH SHAPE, AND WHY NOT A REAL SEARCH INDEX ════════════════════
//
// Firestore has no substring/full-text operator. The honest options are a prefix range query
// (>= q, < q + U+F8FF) on an indexed field, or an external search service. This uses PREFIX, on the
// document id, because:
//
//   - a Part's doc id IS its partId and sku (join-clean, partId == SKU), which is the string a
//     salesperson reads off a quote or a shelf label;
//   - an Equipment Model's doc id IS its canonical `manufacturer--model` id;
//   - an id-range query needs NO composite index -- it is served by the automatic single-field
//     index on __name__, so this adds no index to declare or deploy.
//
// Prefix matching is a REAL limitation and is stated rather than disguised: searching "fan" will
// not find "CW-P-0000 Evaporator Fan Motor". The name is returned so the user can confirm what
// they picked, and name search is reported as a known gap rather than faked by loading the catalog
// and filtering it client-side, which is the boundary this whole module exists to respect.
//
// ════════════════════ WHAT IS RETURNED ════════════════════
//
// The minimum needed to CHOOSE and to CONFIRM: the canonical ref (identity), a display name, and
// the governed status. Nothing about cost, supplier, stock, or margin -- a picker does not need
// them and a salesperson's picker is not the place to disclose them.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const salesAgreementLineReferences_1 = require("./salesAgreementLineReferences");
exports.INVENTORY_CATALOG_READ_CAPABILITY = "inventory.catalog.read";
exports.MIN_SEARCH_LENGTH = 2;
exports.DEFAULT_SEARCH_LIMIT = 20;
exports.MAX_SEARCH_LIMIT = 50;
/** Equipment models are reference data: one per model the company sells, so the picker lists them. */
exports.EQUIPMENT_MODEL_LIST_CAP = 200;
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
/**
 * Pure projection. The doc ID is the identity for both catalogs, so it is taken from the snapshot
 * id rather than from a field -- a document whose `partId` field disagreed with its own id would
 * otherwise let the picker store a ref that resolves to nothing.
 */
function projectProductReference(id, data, kind) {
    if (!id || !data || typeof data !== "object")
        return null;
    const displayName = kind === "PART"
        ? str(data.name)
        : // Equipment models carry a composed displayName; modelNumber is the fallback a human still
            // recognises. Never the raw id dressed up as a name.
            str(data.displayName) ?? str(data.modelNumber);
    return { ref: id, kind, displayName, status: str(data.status) };
}
/**
 * PART TYPEAHEAD. Prefix range over the document id, bounded, minimum query length enforced.
 *
 * The minimum length is not a nicety: a one-character prefix over a real parts catalog returns an
 * arbitrary slice of thousands of rows, which is the whole-catalog read wearing a filter.
 */
async function searchParts(db, queryText, limit) {
    const raw = queryText.trim();
    if (raw.length < exports.MIN_SEARCH_LENGTH)
        return [];
    // CASE. A Firestore id range is byte-ordered and case-SENSITIVE, and the observed part ids are
    // upper case ("CW-P-0000"). Upper-casing the query unconditionally would make the search work for
    // this catalog and silently return nothing for any catalog that is not upper case -- a
    // convention quietly promoted to a requirement, and the failure would look like "no such part"
    // rather than "the search assumed something".
    //
    // So both forms are queried when they differ. Two bounded reads, merged and re-capped, rather
    // than one assumption.
    const variants = [...new Set([raw, raw.toUpperCase()])];
    // U+F8FF is the standard Firestore prefix sentinel: the last code point that can appear in a
    // string key, so [q, q + U+F8FF] is exactly "ids beginning with q".
    const snaps = await Promise.all(variants.map((q) => db.collection(salesAgreementLineReferences_1.PARTS_COLLECTION).orderBy("__name__").startAt(q).endAt(`${q}\uf8ff`).limit(limit).get()));
    const seen = new Set();
    const out = [];
    for (const snap of snaps) {
        for (const d of snap.docs) {
            if (seen.has(d.id))
                continue;
            seen.add(d.id);
            const p = projectProductReference(d.id, d.data(), "PART");
            if (p)
                out.push(p);
            if (out.length >= limit)
                return out;
        }
    }
    return out;
}
/**
 * EQUIPMENT MODEL PICKER. The population is reference-data small -- one per model the company sells
 * -- so the whole (capped) list is returned and the surface can present a real select. The cap is a
 * guard against an unexpected population, not an expected size.
 */
async function listEquipmentModels(db, cap) {
    // No orderBy on a data field: a Firestore orderBy is also a FILTER, and ordering on `displayName`
    // would silently drop every model that lacks one. Ordered by id, sorted for display where it is
    // displayed.
    const snap = await db.collection(salesAgreementLineReferences_1.EQUIPMENT_MODELS_COLLECTION).orderBy("__name__").limit(cap).get();
    return snap.docs
        .map((d) => projectProductReference(d.id, d.data(), "EQUIPMENT_MODEL"))
        .filter((p) => p !== null);
}
/**
 * The trusted read callable serving both surfaces.
 *
 * ONE callable rather than two because the authorization question is identical ("may this principal
 * read the product catalog") and splitting it would be two places for that answer to drift.
 * `truncated` is reported honestly so a surface can say "refine your search" instead of implying
 * the result set is everything.
 */
exports.searchProductReferences = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const data = (request.data ?? {});
    const kind = data.kind === "PART" || data.kind === "EQUIPMENT_MODEL" ? data.kind : null;
    if (!kind)
        throw new https_1.HttpsError("invalid-argument", "kind must be PART or EQUIPMENT_MODEL.");
    // Authorization AFTER shape validation, matching getSalesOrderContext's ordering in this repo.
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.INVENTORY_CATALOG_READ_CAPABILITY],
        });
        allowed = decisions[exports.INVENTORY_CATALOG_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[searchProductReferences] capability resolution failed`, err);
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read the product catalog.");
    const requested = Number.isSafeInteger(data.limit) ? data.limit : exports.DEFAULT_SEARCH_LIMIT;
    const limit = Math.min(Math.max(requested, 1), exports.MAX_SEARCH_LIMIT);
    try {
        const db = (0, firestore_1.getFirestore)();
        if (kind === "EQUIPMENT_MODEL") {
            const results = await listEquipmentModels(db, exports.EQUIPMENT_MODEL_LIST_CAP);
            return { status: "ready", kind, results, truncated: results.length >= exports.EQUIPMENT_MODEL_LIST_CAP };
        }
        const queryText = typeof data.query === "string" ? data.query : "";
        if (queryText.trim().length < exports.MIN_SEARCH_LENGTH) {
            // Not an error: "keep typing" is a real answer, and raising invalid-argument for it would make
            // every keystroke before the threshold look like a failure in the console.
            return { status: "below-threshold", kind, results: [], truncated: false, minLength: exports.MIN_SEARCH_LENGTH };
        }
        const results = await searchParts(db, queryText, limit);
        return { status: "ready", kind, results, truncated: results.length >= limit };
    }
    catch (err) {
        console.error("[searchProductReferences] catalog read failed", err);
        throw new https_1.HttpsError("internal", "The product catalog is unavailable.");
    }
});
//# sourceMappingURL=productReferenceSearchService.js.map