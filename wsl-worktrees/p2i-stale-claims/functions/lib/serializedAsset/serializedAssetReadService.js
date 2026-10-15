"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailableEquipment = exports.INVENTORY_SERIALIZED_ASSET_READ_CAPABILITY = void 0;
exports.projectSerializedAsset = projectSerializedAsset;
// Serialized Asset -- TRUSTED MINIMAL READ PROJECTION (repo-only, fail-closed). Spec phase M.1
// (docs/specifications/serialized-asset-equipment-installation.md §I / §M.1: "Serialized Asset identity +
// Available Equipment read", ADR-010 + DECISIONS #59). Follows the `salesOrder.read` /
// `inventory.catalog.read` pattern exactly (functions/src/salesOrder/salesOrderReadService.ts,
// functions/src/partMaster/manufacturerReadService.ts) -- the client does NOT receive direct
// `serialized_assets` read access (no firestore.rules match block exists for this collection -- default
// deny; NOT changed by this PR). A trusted backend resolves the caller's governed scope, reads the
// canonical Serialized Asset documents via the Admin SDK, and returns ONLY the minimal "Available
// Equipment" projection §I's UI composition needs: in-stock serial units with `currentEquipmentId` null.
//
// Principles enforced here (identical to the Sales Order / Manufacturer read services):
//   • fail closed; caller identity comes from request.auth.uid, never a client-supplied id;
//   • authorization is the governed capability `inventory.serializedAsset.read`, resolved through the
//     trusted effective-access feed. Registered `active: false`, which is the PRODUCTION posture, not a
//     universal one: measured 2026-09-12 it is held by thirteen governed business Roles (least-privilege
//     inventoryLookupReader, ../access/governedBusinessRoles.ts) and ACTIVATED in platform-sandbox
//     (config/environments.json). The introduction phase granted it to nobody; that is no longer true.
//     Wherever it is not activated, `active: false` denies every principal regardless of grant;
//   • the projection returns ONLY facts already authoritative on the Serialized Asset document itself --
//     no fabricated availability, no location LABEL (a display fact this service does not resolve), no
//     Equipment/Part descriptive join;
//   • distinguishes the states the UI must tell apart: denied · unavailable · ready.
//
// SCOPE (Spec phase M.1 ONLY): this is identity + Available-Equipment READ. It does NOT implement §H (the
// installation handoff command -- gated on Enterprise Inventory Phase 4 / Transfer Orders, which does not
// exist in this repo), performs NO write, creates NO delivery/transfer/install path, and creates NO second
// inventory ledger, movement/custody authority, truck authority, or second Equipment record.
//
// EXPORT != DEPLOY, REGISTER != GRANT. Exported for build/test only; nothing runs in production until a
// separate deploy + capability grant + per-environment activation.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const collections_1 = require("../constants/collections");
const types_1 = require("./types");
exports.INVENTORY_SERIALIZED_ASSET_READ_CAPABILITY = "inventory.serializedAsset.read";
// Pure projection of one canonical `serialized_assets/{id}` doc -> the minimal shape. Returns null if the
// doc cannot yield a usable, invariant-honoring projection (unknown field, unrecognized state/ownership, or
// a contradictory INSTALLED<->link pairing) -- a malformed/foreign document is never fabricated into a
// trusted read. `id` (the stored doc id) is intentionally NOT required to equal `serialNo`; both are
// carried but only `serialNo` is business identity.
function projectSerializedAsset(id, data) {
    if (typeof id !== "string" || id.trim() === "" || !data || typeof data !== "object")
        return null;
    // Pluck only the governed VALUE fields before validating -- a real stored document also carries
    // provenance (schemaVersion/createdAtMillis/createdByUid/updatedAtMillis/updatedByUid, see
    // DeserializedSerializedAsset), which must be IGNORED here, never smuggled into the projection and
    // never cause an otherwise-valid document to be rejected. validateSerializedAssetValue's strict
    // allowlist governs only this plucked VALUE subset, exactly like receivingTypes.ts's
    // ReceivingOrderValue is validated separately from its DeserializedReceivingOrder provenance wrapper.
    const candidate = {
        serialNo: data.serialNo,
        partId: data.partId,
        currentLocationId: data.currentLocationId,
        // Plucked so the stored type is actually VALIDATED (an unrecognized one fails the document closed
        // rather than riding along unchecked). It is deliberately NOT added to the projection below: the
        // Available Equipment projection's field list is described in the shared permission catalog, and
        // widening the trusted read's shape is a separate, catalog-owning change. See
        // docs/handoff/w1-c20-registrations.md.
        currentLocationType: data.currentLocationType,
        inventoryState: data.inventoryState,
        currentEquipmentId: data.currentEquipmentId,
        ownership: data.ownership,
    };
    const check = (0, types_1.validateSerializedAssetValue)(candidate);
    if (!check.valid)
        return null;
    return {
        serialNo: check.value.serialNo,
        partId: check.value.partId,
        currentLocationId: check.value.currentLocationId,
        inventoryState: check.value.inventoryState,
        currentEquipmentId: check.value.currentEquipmentId,
        ownership: check.value.ownership,
    };
}
// The trusted read callable -- the Available Equipment projection (§I: "Available Equipment UI reads
// SERIALIZED ASSETS (in-stock serial units + ledger location/availability; `currentEquipmentId` null)").
// Queries by the governed lifecycle state (AVAILABLE) rather than reading the whole collection, but still
// re-validates and re-asserts the invariant per document before including it -- never trusts the query
// filter alone. Maps failures to HttpsError so the client can distinguish denied (permission-denied) from
// unavailable (internal).
/** Cap for the Available Equipment registry read. See the bounded-read note at the query. */
const AVAILABLE_EQUIPMENT_LIMIT = 1000;
exports.getAvailableEquipment = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.INVENTORY_SERIALIZED_ASSET_READ_CAPABILITY],
        });
        allowed = decisions[exports.INVENTORY_SERIALIZED_ASSET_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[getAvailableEquipment] capability resolution failed for ${exports.INVENTORY_SERIALIZED_ASSET_READ_CAPABILITY}`, err);
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read the Available Equipment registry.");
    try {
        const db = (0, firestore_1.getFirestore)();
        // BOUNDED READ. The two equality filters narrow the set but do not cap it -- an available
        // serialized-asset pool has no natural ceiling, so "filtered" was being mistaken for
        // "bounded". Fetching limit+1 lets the extra row disclose truncation instead of the page
        // silently pretending to be the whole registry.
        //
        // `truncated` is kept SEPARATE from `excludedCount` deliberately: they answer different
        // questions. excludedCount means "these documents were read and failed the availability
        // invariant"; truncated means "there are more documents we did not read at all". Collapsing
        // them would make a paging boundary look like a data-quality problem.
        const snap = await db
            .collection(collections_1.SERIALIZED_ASSETS_COLLECTION)
            .where("inventoryState", "==", "AVAILABLE")
            .where("currentEquipmentId", "==", null)
            .limit(AVAILABLE_EQUIPMENT_LIMIT + 1)
            .get();
        const truncated = snap.size > AVAILABLE_EQUIPMENT_LIMIT;
        const availableEquipment = [];
        let excludedCount = 0;
        for (const doc of snap.docs.slice(0, AVAILABLE_EQUIPMENT_LIMIT)) {
            const projection = projectSerializedAsset(doc.id, doc.data());
            if (projection && (0, types_1.isAvailableForEquipmentRead)(projection))
                availableEquipment.push(projection);
            else
                excludedCount++;
        }
        const result = { status: "ready", availableEquipment, excludedCount, truncated };
        return result;
    }
    catch {
        throw new https_1.HttpsError("internal", "The Available Equipment read is temporarily unavailable.");
    }
});
//# sourceMappingURL=serializedAssetReadService.js.map