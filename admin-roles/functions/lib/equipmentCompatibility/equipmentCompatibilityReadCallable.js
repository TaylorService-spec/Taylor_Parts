"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.READ_CAPABILITY = exports.equipmentCompatibilityReadCallable = void 0;
exports.buildDeps = buildDeps;
exports.handleReadRequest = handleReadRequest;
// D5 (Read service) — thin onCall adapter for readService.ts, mirroring the on-main pattern of
// access/effectiveAccessFeedCallable.ts: authenticate, derive the caller's identity from the SERVER auth
// context ONLY, wire the real #226 permission resolver, map the service's typed errors to safe
// HttpsErrors, and nothing else — every real decision lives in readService.ts.
//
// INERT IN D5 (by direction): this callable is DELIBERATELY NOT exported from functions/src/index.ts, so
// it is not deployed and no client can invoke it until a separate, later Owner production authorization.
// It resolves `equipment.compatibility.view`, which is registered active:false in the permission catalog
// — so even if it were reachable, the resolver returns DENY for every principal. Activation + role grants
// are the separate #226 gate. Emulator/authorized-path tests drive readService.ts directly with an
// injected permission fixture; they do not go through this adapter's real resolver.
//
// The single most important property: `actorUid` is ALWAYS `request.auth.uid`. `request.data` is never
// read for uid, role, or authority — the accepted shape cannot express a client-claimed identity.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const readService_1 = require("./readService");
Object.defineProperty(exports, "READ_CAPABILITY", { enumerable: true, get: function () { return readService_1.READ_CAPABILITY; } });
const errors_1 = require("./errors");
// EXACT per-mode request shapes. Any key not listed for the selected mode is refused (this rejects both
// wrong-mode fields — e.g. an equipmentModelId on forwardByPart, a cursor/limit on modelSummary — AND any
// client-supplied identity/authority field such as uid/actorUid/principalUid/role, which simply are not
// accepted keys for any mode). `mode` is always required; identity comes ONLY from request.auth.uid.
const MODE_KEYS = {
    forwardByPart: { required: ["mode", "partId"], optional: ["cursor", "limit"] },
    reverseByModel: { required: ["mode", "equipmentModelId"], optional: ["cursor", "limit"] },
    modelSummary: { required: ["mode", "equipmentModelId"], optional: [] },
};
function assertModeShape(mode, data) {
    const spec = MODE_KEYS[mode];
    const allowed = new Set([...spec.required, ...spec.optional]);
    const extra = Object.keys(data).filter((k) => !allowed.has(k));
    if (extra.length > 0) {
        throw new https_1.HttpsError("invalid-argument", `Unrecognized field(s) for mode "${mode}": ${extra.join(", ")}.`);
    }
    for (const key of spec.required) {
        if (key === "mode")
            continue;
        if (typeof data[key] !== "string" || data[key].length === 0) {
            throw new https_1.HttpsError("invalid-argument", `"${key}" is required and must be a non-empty string for mode "${mode}".`);
        }
    }
    if (data.cursor !== undefined && typeof data.cursor !== "string") {
        throw new https_1.HttpsError("invalid-argument", '"cursor" must be a string when present.');
    }
    if (data.limit !== undefined && (typeof data.limit !== "number" || !Number.isInteger(data.limit))) {
        throw new https_1.HttpsError("invalid-argument", '"limit" must be an integer when present.');
    }
}
const REAL_SERVICE = { readCompatibilityForPart: readService_1.readCompatibilityForPart, readCompatibilityForModel: readService_1.readCompatibilityForModel, readModelSummary: readService_1.readModelSummary };
// Real #226 seam: resolve the (active:false) read capability against the caller's effective access. A
// throwing resolver is treated by readService as a denial. Nothing here activates or grants anything.
function buildDeps() {
    return {
        db: (0, firestore_1.getFirestore)(),
        resolvePermission: async ({ actorUid, capabilityId }) => {
            const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: actorUid, permissionIds: [capabilityId] });
            return decisions[capabilityId] === true;
        },
        // Serial-scheme registry wiring is deferred (a governed registry not yet materialized); an empty
        // registry makes any SERIAL_RANGE relationship fail closed as malformed, never silently accepted.
        serialSchemes: {},
    };
}
// The testable core: authenticate, enforce the exact per-mode shape, dispatch to the read service, and
// map typed errors to safe HttpsErrors. `request` is the onCall CallableRequest (only `.auth` and
// `.data` are read); `deps` and `service` are injected by the onCall wrapper (production) or a test.
async function handleReadRequest(request, deps, service = REAL_SERVICE) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    const mode = data.mode;
    if (mode !== "forwardByPart" && mode !== "reverseByModel" && mode !== "modelSummary") {
        throw new https_1.HttpsError("invalid-argument", 'mode must be "forwardByPart", "reverseByModel", or "modelSummary".');
    }
    // Enforce the EXACT per-mode shape BEFORE any read — wrong-mode and any client identity/authority field
    // (uid/actorUid/principalUid/role/...) are simply not accepted keys and are refused here.
    assertModeShape(mode, data);
    const actorUid = request.auth.uid; // identity ONLY from the server auth context, NEVER from request.data
    const cursor = data.cursor === undefined ? undefined : data.cursor;
    const limit = data.limit === undefined ? undefined : data.limit;
    try {
        switch (mode) {
            case "forwardByPart":
                return await service.readCompatibilityForPart(deps, { actorUid, partId: data.partId, cursor, limit });
            case "reverseByModel":
                return await service.readCompatibilityForModel(deps, { actorUid, equipmentModelId: data.equipmentModelId, cursor, limit });
            case "modelSummary":
                return await service.readModelSummary(deps, { actorUid, equipmentModelId: data.equipmentModelId });
        }
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        if (err instanceof errors_1.InvalidInputError)
            throw new https_1.HttpsError("invalid-argument", err.message);
        // Never forward an internal message — reaching here is an unexpected fault; surface a generic reason.
        throw new https_1.HttpsError("unavailable", "Compatibility could not be read right now. Try again shortly.");
    }
}
exports.equipmentCompatibilityReadCallable = (0, https_1.onCall)({ region: "us-central1" }, (request) => handleReadRequest(request, buildDeps()));
//# sourceMappingURL=equipmentCompatibilityReadCallable.js.map