"use strict";
// Enterprise Inventory -- Cycle Count operating authority: the production dependency COMPOSITION.
// Pins the concrete governed WAREHOUSE/MOBILE resolver (REUSED from Transfer Phase 4's
// makeResolveTransferLocationActive -- same governed WAREHOUSE/MOBILE authority, not a second one) so no
// production caller can substitute an arbitrary or permissive resolver. Mirrors
// transferCommandComposition.ts exactly.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCycleCountProduction = createCycleCountProduction;
exports.submitCycleCountProduction = submitCycleCountProduction;
exports.reconcileCycleCountProduction = reconcileCycleCountProduction;
exports.cancelCycleCountProduction = cancelCycleCountProduction;
const cycleCountCommand_js_1 = require("./cycleCountCommand.js");
const transferLocationResolver_js_1 = require("../inventoryTransfer/transferLocationResolver.js");
const cycleCountTypes_js_1 = require("./cycleCountTypes.js");
function buildDeps(input) {
    return {
        db: input.db,
        actor: input.actor,
        authorize: input.authorize,
        resolvePart: input.resolvePart,
        // makeResolveTransferLocationActive resolves WAREHOUSE/MOBILE refs; its parameter type is
        // structurally identical to CycleCountLocationRef ({ type: "WAREHOUSE" | "MOBILE", locationId }).
        resolveLocationActive: (0, transferLocationResolver_js_1.makeResolveTransferLocationActive)(input.db),
        stageAudit: input.stageAudit,
        now: input.now,
    };
}
// Sanitized production error boundary: a governed CycleCountCommandError passes through unchanged; any
// other surviving error collapses to the bounded, sanitized CycleCountIntegrityError.
async function runSanitized(fn) {
    try {
        return await fn();
    }
    catch (err) {
        if (err instanceof cycleCountTypes_js_1.CycleCountCommandError)
            throw err;
        throw new cycleCountTypes_js_1.CycleCountIntegrityError("the cycle count could not be completed due to a transient transaction/integrity error");
    }
}
function createCycleCountProduction(request, input) {
    return runSanitized(() => (0, cycleCountCommand_js_1.createCycleCount)(request, buildDeps(input)));
}
function submitCycleCountProduction(request, input) {
    return runSanitized(() => (0, cycleCountCommand_js_1.submitCycleCount)(request, buildDeps(input)));
}
function reconcileCycleCountProduction(request, input) {
    return runSanitized(() => (0, cycleCountCommand_js_1.reconcileCycleCount)(request, buildDeps(input)));
}
function cancelCycleCountProduction(request, input) {
    return runSanitized(() => (0, cycleCountCommand_js_1.cancelCycleCount)(request, buildDeps(input)));
}
//# sourceMappingURL=cycleCountCommandComposition.js.map