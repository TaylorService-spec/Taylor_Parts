"use strict";
// DESCRIPTIVE BIN REGISTRY — thin onCall adapters. Same pattern as partAliasCallables.ts: derive
// actorUid ONLY from request.auth.uid, forward request.data into the service, and map thrown service
// errors to HttpsError. ALL real logic — capability enforcement, validation, duplicate prevention,
// single-transaction — lives inside the command service. These adapters add NO authority.
//
// ============================ TWO CAPABILITIES, TWO AUDIENCES ============================
//
// `inventory.location.bin.manage` writes racking. `inventory.location.bin.read` checks that a
// scanned bin is real.
//
// They are separate because the audiences are: an operator putting stock away needs to know a bin
// exists, and giving them that check must not also let them create and retire racking. That is the
// same split Phase G drew between alias lookup and alias administration, for the same reason — and
// the mistake it avoids is the one the catalog exists to prevent, broadening a write capability to
// serve a read.
//
// Both are registered active:false and granted to no Role, so both deny for every principal until
// activation and grant are separately authorized. EXPORT != DEPLOY.
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordPutAwayCallable = exports.listBinsCallable = exports.previewBinCreatesCallable = exports.resolveBinTokenCallable = exports.resolveBinCallable = exports.reactivateBinCallable = exports.deactivateBinCallable = exports.renameBinCallable = exports.createBinCallable = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const putAwayCommand_js_1 = require("./putAwayCommand.js");
const binCommands_js_1 = require("./binCommands.js");
const effectiveAccessFeed_js_1 = require("../access/effectiveAccessFeed.js");
const binPreviewService_js_1 = require("./binPreviewService.js");
const REGION = { region: "us-central1" };
function requireAuth(request) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
/** A THROWING resolver is a denial, never an allow. */
async function allows(uid, capability) {
    try {
        const { decisions } = await (0, effectiveAccessFeed_js_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [capability] });
        return decisions[capability] === true;
    }
    catch (err) {
        console.error(`[bins] capability resolution failed for ${capability}`, err);
        return false;
    }
}
async function requireBinRead(uid) {
    if (!(await allows(uid, binCommands_js_1.BIN_READ_CAPABILITY))) {
        throw new https_1.HttpsError("permission-denied", "You are not authorized to look up bins.", "DENIED");
    }
}
/** The write commands resolve their own capability inside their transaction; this is the wiring. */
const authorizeThroughTxn = (_txn, actorId, capability) => allows(actorId, capability);
function mapError(err) {
    if (err instanceof binCommands_js_1.BinUnauthorizedError) {
        return new https_1.HttpsError("permission-denied", "You are not authorized to manage bins.", "DENIED");
    }
    if (err instanceof binCommands_js_1.BinInvalidError) {
        return new https_1.HttpsError("invalid-argument", "That bin could not be accepted.", err.message || "INVALID");
    }
    if (err instanceof binCommands_js_1.BinNotFoundError) {
        return new https_1.HttpsError("not-found", "That bin was not found.", "NOT_FOUND");
    }
    // Each of these is a DIFFERENT physical fix, so none collapses into another. Telling an operator
    // "that bin could not be accepted" when the real answer is "that code belongs to another rack"
    // sends them to change the wrong thing. None of them echoes a stored value.
    if (err instanceof binCommands_js_1.BinIdempotencyConflictError) {
        return new https_1.HttpsError("already-exists", "That request id was already used for a different bin.", "IDEMPOTENCY_CONFLICT");
    }
    if (err instanceof binCommands_js_1.BinCodeReservedError) {
        return new https_1.HttpsError("already-exists", "That bin code is already reserved in this warehouse.", "CODE_RESERVED");
    }
    if (err instanceof binCommands_js_1.BinClaimIntegrityError) {
        // Deliberately NOT invalid-argument: the caller's request was fine, the stored reservation is
        // not. Nothing was repaired, and an operator retrying will not fix it either.
        return new https_1.HttpsError("failed-precondition", "That bin's code reservation could not be verified.", "CLAIM_INTEGRITY");
    }
    if (err instanceof binCommands_js_1.BinMalformedStoredRecordError) {
        console.error("[bins] malformed stored record", err);
        return new https_1.HttpsError("failed-precondition", "That bin record could not be read.", "MALFORMED_STORED_RECORD");
    }
    console.error("[bins] command failed", err);
    return new https_1.HttpsError("internal", "The request could not be completed.", "INTERNAL");
}
const productionDeps = (actorUid) => ({
    db: (0, firestore_1.getFirestore)(),
    actor: { kind: "USER", id: actorUid },
    authorize: authorizeThroughTxn,
    now: () => new Date(),
});
exports.createBinCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    try {
        return await (0, binCommands_js_1.createBin)(request.data, productionDeps(actorUid));
    }
    catch (err) {
        throw mapError(err);
    }
});
/**
 * Correct a mislabelled or renumbered rack.
 *
 * Gated on `inventory.location.bin.manage` — the SAME capability as create and retire, because this
 * is maintaining the physical bin registry, which is exactly what that capability describes and what
 * `inventoryBinAdministrator` already carries. Registering a new capability merely because a
 * function name is new would add a rollout step without adding a boundary.
 */
exports.renameBinCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    try {
        return await (0, binCommands_js_1.renameBin)(request.data, productionDeps(actorUid));
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.deactivateBinCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    try {
        return await (0, binCommands_js_1.setBinStatus)(request.data, "INACTIVE", productionDeps(actorUid));
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.reactivateBinCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    try {
        return await (0, binCommands_js_1.setBinStatus)(request.data, "ACTIVE", productionDeps(actorUid));
    }
    catch (err) {
        throw mapError(err);
    }
});
/**
 * Resolve one scanned bin. READ-ONLY, and gated on the READ capability.
 *
 * Returns the resolver's own vocabulary unchanged — FOUND / INACTIVE / WRONG_WAREHOUSE / NOT_FOUND /
 * MALFORMED — because each calls for a different physical fix and collapsing any pair would send an
 * operator to the wrong shelf, or to the wrong building.
 */
exports.resolveBinCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    await requireBinRead(actorUid);
    const data = (request.data ?? {});
    const warehouseId = typeof data.warehouseId === "string" ? data.warehouseId : "";
    if (warehouseId === "")
        throw new https_1.HttpsError("invalid-argument", "A warehouseId is required.");
    try {
        return await (0, binCommands_js_1.resolveBinCode)((0, firestore_1.getFirestore)(), data.code, warehouseId);
    }
    catch (err) {
        throw mapError(err);
    }
});
/**
 * Resolve a scanned MACHINE TOKEN — the stable binId — against the operator's warehouse.
 *
 * This is the governed lookup the shared scan boundary deliberately does not perform.
 * `resolveScannedIdentity` is pure: it matches only candidates its caller already read. This
 * callable PRODUCES the canonical `{ type: "BIN", locationId }` candidate; the pure matcher never
 * fetches it. That is why there is no client-direct `bins` read and no cross-warehouse preload.
 *
 * `WRONG_WAREHOUSE` is answerable here, and only here, because the token identifies one bin globally.
 */
exports.resolveBinTokenCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    await requireBinRead(actorUid);
    const data = (request.data ?? {});
    const warehouseId = typeof data.warehouseId === "string" ? data.warehouseId : "";
    if (warehouseId === "")
        throw new https_1.HttpsError("invalid-argument", "A warehouseId is required.");
    try {
        return await (0, binCommands_js_1.resolveBinToken)((0, firestore_1.getFirestore)(), data.token ?? data.binId, warehouseId);
    }
    catch (err) {
        throw mapError(err);
    }
});
/**
 * Classify what createBin WOULD do with a batch of proposed bins. READ-ONLY.
 *
 * Gated on `inventory.location.bin.read` -- the SAME capability as resolving a scanned bin and
 * listing a warehouse's racking. Asking the registry what it says about a PROPOSED location is
 * the same audience as asking what it says about a scanned one, and it confers nothing about
 * creating anything.
 *
 * It writes nothing. BIN-P3 Administration needs it because the client cannot honestly classify
 * ALREADY_EXISTS or CODE_RESERVED on its own: listBins reads `bins` only and returns no
 * idempotencyKey, and `bin_code_claims` is deny-all to every client and stays that way.
 */
exports.previewBinCreatesCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    await requireBinRead(actorUid);
    try {
        return await (0, binPreviewService_js_1.previewBinCreates)((0, firestore_1.getFirestore)(), request.data);
    }
    catch (err) {
        if (err instanceof binPreviewService_js_1.BinPreviewInvalidError) {
            throw new https_1.HttpsError("invalid-argument", "That preview request could not be accepted.", err.message || "INVALID");
        }
        throw mapError(err);
    }
});
exports.listBinsCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    await requireBinRead(actorUid);
    const data = (request.data ?? {});
    const warehouseId = typeof data.warehouseId === "string" ? data.warehouseId : "";
    if (warehouseId === "")
        throw new https_1.HttpsError("invalid-argument", "A warehouseId is required.");
    try {
        return await (0, binCommands_js_1.listBinsForWarehouse)((0, firestore_1.getFirestore)(), warehouseId);
    }
    catch (err) {
        throw mapError(err);
    }
});
/**
 * PUT-AWAY. Record where stock was stowed.
 *
 * Gated on `inventory.placement.record` -- its own capability, because stowing is a third audience
 * again: not labelling racking, not merely checking a bin is real, and emphatically not receiving.
 *
 * The command writes a placement record and NOTHING else -- no ledger event, no quantity change, no
 * balance -- which is the DECISIONS #116 invariant that keeps stowed stock in warehouse on-hand.
 */
exports.recordPutAwayCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    try {
        return await (0, putAwayCommand_js_1.recordPutAway)(request.data, productionDeps(actorUid));
    }
    catch (err) {
        if (err instanceof putAwayCommand_js_1.PlacementUnauthorizedError) {
            throw new https_1.HttpsError("permission-denied", "You are not authorized to put stock away.", "DENIED");
        }
        if (err instanceof putAwayCommand_js_1.PlacementBinError) {
            // The bin's own vocabulary is preserved: INACTIVE, WRONG_WAREHOUSE and NOT_FOUND are three
            // different physical problems, and collapsing them would send an operator to the wrong shelf
            // or to the wrong building.
            throw new https_1.HttpsError("failed-precondition", "That bin cannot be used.", err.resolution);
        }
        if (err instanceof putAwayCommand_js_1.PlacementInvalidError) {
            throw new https_1.HttpsError("invalid-argument", "That put-away could not be accepted.", err.message || "INVALID");
        }
        throw mapError(err);
    }
});
//# sourceMappingURL=binCallables.js.map