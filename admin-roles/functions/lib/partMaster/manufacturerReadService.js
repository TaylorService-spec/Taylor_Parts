"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getManufacturerCatalog = exports.INVENTORY_CATALOG_READ_CAPABILITY = void 0;
exports.projectManufacturer = projectManufacturer;
// Manufacturer -- TRUSTED MINIMAL READ PROJECTION (repo-only, fail-closed). Wave 6 Owner Decision
// (2026-08-15): "inventory.catalog.read" -- a governed catalog/reference read the Parts experience
// needs, starting with Manufacturer identity. Follows the `opportunity.read`/`salesOrder.read`
// pattern exactly (functions/src/opportunity/opportunityReadService.ts, functions/src/salesOrder/
// salesOrderReadService.ts) -- the client does NOT receive direct `manufacturers` read access
// (firestore.rules stays `allow read, write: if false`, unchanged). A trusted backend resolves the
// caller's governed scope, reads the canonical Manufacturer list via the Admin SDK, and returns ONLY
// the minimal projection the Parts UX needs.
//
// Principles enforced here (identical to the Opportunity/Sales Order read services):
//   • fail closed; caller identity comes from request.auth.uid, never a client-supplied id;
//   • authorization is the governed capability `inventory.catalog.read`, resolved through the
//     trusted effective-access feed (registered active:false ⇒ ungranted ⇒ deny for everyone until
//     a separate Owner grant AND per-environment activation);
//   • the projection returns ONLY facts already authoritative on the Manufacturer document itself --
//     no vendor/contract/financial fields (none exist on the doc today; this is a stated boundary
//     for later, not a field currently being withheld);
//   • distinguishes the states the UI must tell apart: denied · unavailable · ready.
//
// NOTE on operational-role readers (PARTS_MANAGER/WAREHOUSE_MANAGER): the governed capability model
// declares an `operationalRoleActive` condition kind (resolveEffectivePermission.ts), and this
// capability plus its two siblings (`inventory.transaction.read`, `inventory.action.read`) declare
// this exact condition in compatibilityRoles.ts. UPDATE (Wave 7 extension PART 4,
// functions/src/access/operationalRoleContext.ts): resolveEffectiveAccess's canonical feed
// (effectiveAccessFeed.ts) now resolves a real, server-read `operationalRoleActive` closure from the
// caller's linked `employees/{employeeId}` document (mirrors firestore.rules'
// isActiveOperationalRole() exactly), so a technician with an ACTIVE PARTS_MANAGER or
// WAREHOUSE_MANAGER operational role now genuinely qualifies for this capability through that feed --
// this is no longer a declared-but-unreachable grant. It still requires the SAME independent gates
// this whole capability has always required regardless of operational role: `active:false` in
// permissionCatalog.ts (per-environment activation) and, in production, a real Owner grant -- neither
// of those changed here.
//
// EXPORT != DEPLOY, REGISTER != GRANT. Exported for build/test only; nothing runs in production
// until a separate deploy + capability grant + per-environment activation.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const partMasterRepository_1 = require("./partMasterRepository");
const types_1 = require("./types");
exports.INVENTORY_CATALOG_READ_CAPABILITY = "inventory.catalog.read";
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v : null);
// Pure projection of one canonical Manufacturer doc -> the minimal shape. Returns null if the doc
// cannot yield a usable projection (missing id/name, or a status outside the governed enum -- an
// unrecognized status is never trusted/guessed at, it is honestly reported as null rather than
// fabricated). `version` defaults to 0 when absent/non-integer -- mirrors the client mirror's own
// default (domain/manufacturersView.js's toManufacturerListView), not a fabricated value: a
// freshly-created record with no writes yet genuinely has no version stamped.
function projectManufacturer(id, data) {
    if (!id || !data || typeof data !== "object")
        return null;
    const name = str(data.name);
    if (!name)
        return null;
    const status = types_1.MANUFACTURER_STATUSES.includes(data.status)
        ? data.status
        : null;
    const version = Number.isInteger(data.version) ? data.version : 0;
    return { manufacturerId: id, name, status, version };
}
// The trusted read callable -- the FULL Manufacturer catalog (small, reference-data-shaped
// collection; no per-id read needed the way Sales Order's is -- a picker/display surface wants the
// whole list). Maps failures to HttpsError so the client can distinguish denied (permission-denied)
// from unavailable (internal).
exports.getManufacturerCatalog = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.INVENTORY_CATALOG_READ_CAPABILITY],
        });
        allowed = decisions[exports.INVENTORY_CATALOG_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[getManufacturerCatalog] capability resolution failed for ${exports.INVENTORY_CATALOG_READ_CAPABILITY}`, err);
        allowed = false; // fail closed
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to read the Manufacturer catalog.");
    try {
        const db = (0, firestore_1.getFirestore)();
        const snap = await db.collection(partMasterRepository_1.MANUFACTURERS_COLLECTION).get();
        const manufacturers = [];
        let excludedCount = 0;
        for (const doc of snap.docs) {
            const projection = projectManufacturer(doc.id, doc.data());
            if (projection)
                manufacturers.push(projection);
            else
                excludedCount++;
        }
        const result = { status: "ready", manufacturers, excludedCount };
        return result;
    }
    catch {
        throw new https_1.HttpsError("internal", "The Manufacturer catalog read is temporarily unavailable.");
    }
});
//# sourceMappingURL=manufacturerReadService.js.map