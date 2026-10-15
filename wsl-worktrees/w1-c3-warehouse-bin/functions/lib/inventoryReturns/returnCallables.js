"use strict";
// RETURNS INTAKE — the thin onCall adapter. All real logic (capability enforcement, validation,
// idempotency, single-transaction) lives inside the command service; this adds NO authority.
//
// `inventory_returns` has no firestore.rules match block, so it is deny-all to every client
// including admin — the established part_aliases / bins posture. No Rules change was needed.
//
// EXPORT != DEPLOY, and `inventory.returns.intake` is registered active:false and granted to no
// Role, so this denies for every principal until activation and grant are separately authorized.
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordReturnIntakeCallable = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const returnIntakeCommand_js_1 = require("./returnIntakeCommand.js");
const effectiveAccessFeed_js_1 = require("../access/effectiveAccessFeed.js");
const REGION = { region: "us-central1" };
/** A THROWING resolver is a denial, never an allow. */
async function allows(uid, capability) {
    try {
        const { decisions } = await (0, effectiveAccessFeed_js_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [capability] });
        return decisions[capability] === true;
    }
    catch (err) {
        console.error(`[returns] capability resolution failed for ${capability}`, err);
        return false;
    }
}
const authorizeThroughTxn = (_txn, actorId, capability) => allows(actorId, capability);
exports.recordReturnIntakeCallable = (0, https_1.onCall)(REGION, async (request) => {
    if (!request.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const actorUid = request.auth.uid;
    try {
        return await (0, returnIntakeCommand_js_1.recordReturnIntake)(request.data, {
            db: (0, firestore_1.getFirestore)(),
            actor: { kind: "USER", id: actorUid },
            authorize: authorizeThroughTxn,
            now: () => new Date(),
        });
    }
    catch (err) {
        if (err instanceof returnIntakeCommand_js_1.ReturnUnauthorizedError) {
            throw new https_1.HttpsError("permission-denied", "You are not authorized to take returns in.", "DENIED");
        }
        if (err instanceof returnIntakeCommand_js_1.ReturnInvalidError) {
            throw new https_1.HttpsError("invalid-argument", "That return could not be accepted.", err.message || "INVALID");
        }
        console.error("[returns] intake failed", err);
        throw new https_1.HttpsError("internal", "The request could not be completed.", "INTERNAL");
    }
});
//# sourceMappingURL=returnCallables.js.map