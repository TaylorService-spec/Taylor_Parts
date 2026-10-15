"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPreferredSupplierCallable = exports.changePartSupplierItemStatusCallable = exports.updatePartSupplierItemCallable = exports.createPartSupplierItemCallable = void 0;
exports.mapError = mapError;
// Part↔Supplier procurement terms (part_supplier_items) -- thin onCall adapters for the existing trusted
// write service (partSupplierItems.ts). Same pattern as manufacturerCallables/partMasterCallables/
// supplierMasterCallables: derive actorUid ONLY from request.auth.uid (NEVER request.data), pass
// request.data into the service, map thrown service errors to HttpsError via a sanitized generic-per-type
// taxonomy. ALL real logic -- capability enforcement, validation, idempotency, versioning, audit,
// single-transaction, and the atomic ≤1-ACTIVE-preferred invariant -- lives INSIDE the command service;
// these adapters add NO write authority and no parallel validator/status vocabulary.
//
// Exported from functions/src/index.ts and deployed to eos-platform-sandbox under the per-environment
// activation program; NOT deployed to the production project. NO capability
// granted, NO App Check. Authorization enforced INSIDE the command against real governed roles --
// inventory.catalog.manage for create/update/setPreferred, inventory.catalog.activate for status change
// (the SAME catalog authority Part/Supplier/Manufacturer use; the future inventoryCatalogAdministrator
// role). Catalog capabilities are carried by no standing role, so all four fail closed until a deferred
// protected grant. The part_supplier_items READ stays governed by projections gated on R-1's
// inventory.catalog.read / inventory.catalog.cost.read (see the design + R-1 requirement docs) -- these
// are WRITE callables only.
const https_1 = require("firebase-functions/v2/https");
const partSupplierItems_js_1 = require("./partSupplierItems.js");
const partMasterCommands_js_1 = require("./partMasterCommands.js");
const partMasterRepository_js_1 = require("./partMasterRepository.js");
// Recognized procurement-term fields -- imported from the command (single source of truth; no drift).
// Forwarded as-is; the command owns validation. Cost is among these -- WRITE authority is
// inventory.catalog.manage; cost READ exposure is a SEPARATE concern (inventory.catalog.cost.read
// projection, partSupplierItemProjections.ts), not decided by this adapter.
const TERM_KEYS = [...partSupplierItems_js_1.TERM_KEYS];
// Sanitized error -> HttpsError: each error TYPE surfaces a GENERIC message so no internal state
// (existence, current version) leaks past the trust boundary; the stable `code` is what a client acts on.
// Unexpected errors collapse to "internal".
function mapError(err) {
    if (err instanceof partMasterCommands_js_1.InvalidInputError)
        return new https_1.HttpsError("invalid-argument", "The request is missing or has invalid fields.");
    if (err instanceof partMasterCommands_js_1.UnauthorizedActorError)
        return new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.");
    if (err instanceof partMasterCommands_js_1.NotFoundError)
        return new https_1.HttpsError("not-found", "The referenced part or part-supplier item could not be found.");
    if (err instanceof partMasterCommands_js_1.AlreadyExistsError)
        return new https_1.HttpsError("already-exists", "A part-supplier item already exists for that part and supplier.");
    if (err instanceof partMasterCommands_js_1.VersionConflictError)
        return new https_1.HttpsError("aborted", "The record changed since you loaded it. Reload and retry.");
    if (err instanceof partMasterCommands_js_1.IdempotencyConflictError)
        return new https_1.HttpsError("aborted", "That idempotency key was already used for a different request.");
    if (err instanceof partMasterCommands_js_1.InvalidStatusTransitionError)
        return new https_1.HttpsError("failed-precondition", "That change isn't allowed for this item's current state.");
    if (err instanceof partMasterRepository_js_1.MalformedStoredRecordError)
        return new https_1.HttpsError("internal", "The request could not be completed.");
    return new https_1.HttpsError("internal", "The request could not be completed.");
}
function requireAuth(request) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
function asObject(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    return data;
}
// Copy the recognized term fields that are actually PRESENT (validated-if-present semantics preserved).
function pickTerms(d) {
    const out = {};
    for (const k of TERM_KEYS)
        if (Object.prototype.hasOwnProperty.call(d, k))
            out[k] = d[k];
    return out;
}
const REGION = { region: "us-central1" };
exports.createPartSupplierItemCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, partSupplierItems_js_1.createPartSupplierItem)({ actorUid, idempotencyKey: d.idempotencyKey, partId: d.partId, supplierId: d.supplierId, ...pickTerms(d) });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.updatePartSupplierItemCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        // `changes` is already scoped to term fields by the request shape (unlike create's flat top-level
        // terms, which pickTerms allowlists), so it is forwarded directly; the command validates it.
        return await (0, partSupplierItems_js_1.updatePartSupplierItem)({ actorUid, idempotencyKey: d.idempotencyKey, itemId: d.itemId, expectedVersion: d.expectedVersion, changes: (d.changes ?? {}) });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.changePartSupplierItemStatusCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, partSupplierItems_js_1.changePartSupplierItemStatus)({ actorUid, idempotencyKey: d.idempotencyKey, itemId: d.itemId, expectedVersion: d.expectedVersion, newStatus: d.newStatus });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.setPreferredSupplierCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, partSupplierItems_js_1.setPreferredSupplier)({ actorUid, idempotencyKey: d.idempotencyKey, partId: d.partId, supplierId: d.supplierId, expectedVersion: d.expectedVersion });
    }
    catch (err) {
        throw mapError(err);
    }
});
//# sourceMappingURL=partSupplierItemCallables.js.map