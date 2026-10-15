"use strict";
// Receiving Location Authority -- I-LA5: the production dependency COMPOSITION for the unexported
// receiveInventoryStock command. It PINS the concrete governed-ACTIVE WAREHOUSE resolver
// (makeResolveWarehouseLocationActive) into the command's deps, so no production caller can substitute an
// arbitrary or permissive resolver -- the compositional input type deliberately OMITS resolveLocationActive
// and the test-only hooks. Lower-level dependency injection stays available on the command itself for
// focused tests. INERT: not exported from index.ts; no callable.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReceiveInventoryStockDeps = buildReceiveInventoryStockDeps;
exports.runReceiveInventoryStockSanitized = runReceiveInventoryStockSanitized;
exports.receiveInventoryStockProduction = receiveInventoryStockProduction;
const receiveInventoryStockCommand_js_1 = require("./receiveInventoryStockCommand.js");
const receivingLocationResolver_js_1 = require("./receivingLocationResolver.js");
const receivingTypes_js_1 = require("./receivingTypes.js");
const reorderSourceFreeze_js_1 = require("../reorderRequest/reorderSourceFreeze.js");
// Build the full command deps with the concrete resolver pinned.
function buildReceiveInventoryStockDeps(input) {
    return {
        db: input.db,
        actor: input.actor,
        authorize: input.authorize,
        resolvePart: input.resolvePart,
        resolveLocationActive: (0, receivingLocationResolver_js_1.makeResolveWarehouseLocationActive)(input.db),
        stageAudit: input.stageAudit,
        now: input.now,
    };
}
// Sanitized production error boundary: a governed ReceiveCommandError (PERMISSION_DENIED,
// DESTINATION_INVALID, RECEIVING_INTEGRITY, ...) passes through unchanged; ANY other surviving error --
// e.g. a raw Firestore/transaction failure from a concurrent conflict -- is mapped to the bounded,
// sanitized ReceivingIntegrityError so no raw Firestore code/message/path/retry detail can escape.
async function runReceiveInventoryStockSanitized(request, deps) {
    try {
        return await (0, receiveInventoryStockCommand_js_1.receiveInventoryStock)(request, deps);
    }
    catch (err) {
        // Governed command errors AND governed receiving-domain errors (idempotency conflict, malformed
        // stored record, invalid receiving) pass through so the callable can map each to its exact public
        // code; only a truly unknown/raw Firestore/transaction failure collapses to RECEIVING_INTEGRITY.
        if (err instanceof receiveInventoryStockCommand_js_1.ReceiveCommandError || err instanceof receivingTypes_js_1.ReceivingError)
            throw err;
        // THE REORDER SOURCE FREEZE is a governed state refusal (the legacy REORDER_PURCHASE_ORDER branch is frozen for the
        // PostgreSQL cutover), not a raw transaction failure: it passes through so the callable answers failed-precondition.
        if (err instanceof reorderSourceFreeze_js_1.ReorderSourceFrozenError)
            throw err;
        throw new receiveInventoryStockCommand_js_1.ReceivingIntegrityError("receiving failed due to a transient transaction/integrity error");
    }
}
// Production entry: run the command with the pinned governed-warehouse resolver, behind the sanitized
// error boundary. No production caller supplies a resolver, hooks, or sees a raw Firestore error.
function receiveInventoryStockProduction(request, input) {
    return runReceiveInventoryStockSanitized(request, buildReceiveInventoryStockDeps(input));
}
//# sourceMappingURL=receiveInventoryStockComposition.js.map