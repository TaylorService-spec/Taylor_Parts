"use strict";
// Enterprise Inventory Phase 4 -- the production dependency COMPOSITION for the transfer command
// family. Pins the concrete governed WAREHOUSE/MOBILE resolver (makeResolveTransferLocationActive) so
// no production caller can substitute an arbitrary or permissive resolver -- mirrors
// receiveInventoryStockComposition.ts exactly.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransferOrderProduction = createTransferOrderProduction;
exports.dispatchTransferOrderProduction = dispatchTransferOrderProduction;
exports.receiveTransferOrderProduction = receiveTransferOrderProduction;
exports.cancelTransferOrderProduction = cancelTransferOrderProduction;
const transferOrderCommand_js_1 = require("./transferOrderCommand.js");
const transferLocationResolver_js_1 = require("./transferLocationResolver.js");
const transferOrderTypes_js_1 = require("./transferOrderTypes.js");
function buildDeps(input) {
    return {
        db: input.db,
        actor: input.actor,
        authorize: input.authorize,
        resolvePart: input.resolvePart,
        resolveLocationActive: (0, transferLocationResolver_js_1.makeResolveTransferLocationActive)(input.db),
        stageAudit: input.stageAudit,
        now: input.now,
    };
}
// Sanitized production error boundary: a governed TransferCommandError passes through unchanged; any
// other surviving error collapses to the bounded, sanitized TransferIntegrityError.
async function runSanitized(fn) {
    try {
        return await fn();
    }
    catch (err) {
        if (err instanceof transferOrderTypes_js_1.TransferCommandError)
            throw err;
        throw new transferOrderTypes_js_1.TransferIntegrityError("the transfer could not be completed due to a transient transaction/integrity error");
    }
}
function createTransferOrderProduction(request, input) {
    return runSanitized(() => (0, transferOrderCommand_js_1.createTransferOrder)(request, buildDeps(input)));
}
function dispatchTransferOrderProduction(request, input) {
    return runSanitized(() => (0, transferOrderCommand_js_1.dispatchTransferOrder)(request, buildDeps(input)));
}
function receiveTransferOrderProduction(request, input) {
    return runSanitized(() => (0, transferOrderCommand_js_1.receiveTransferOrder)(request, buildDeps(input)));
}
function cancelTransferOrderProduction(request, input) {
    return runSanitized(() => (0, transferOrderCommand_js_1.cancelTransferOrder)(request, buildDeps(input)));
}
//# sourceMappingURL=transferCommandComposition.js.map