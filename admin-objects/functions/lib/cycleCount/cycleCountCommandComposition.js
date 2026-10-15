"use strict";
// FROZEN -- CERTIFICATION HISTORY ONLY (Decision #179). This is the v1 single-part Cycle Count family.
// No deployed function reaches it: index.ts exports only the A1 sheet/line callables
// (cycleCountSheetCallables.ts). It remains solely because the frozen Certification tooling
// (functions/scripts/certificationWorld/*) and its tests drive it. Do not extend it and do not wire it
// to a callable, and do not read a v1 record from the sheet/line authority.
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
const cycleCountLocationEligibility_js_1 = require("./cycleCountLocationEligibility.js");
const cycleCountTypes_js_1 = require("./cycleCountTypes.js");
function buildDeps(input) {
    return {
        db: input.db,
        actor: input.actor,
        authorize: input.authorize,
        resolvePart: input.resolvePart,
        // The governed eligibility policy: the shared WAREHOUSE/MOBILE/BIN resolver, plus -- for a BIN --
        // the parent Warehouse's Bin conversion gate (BIN-P7). Pinned here so no caller can substitute a
        // permissive resolver.
        resolveLocationActive: (0, cycleCountLocationEligibility_js_1.makeResolveCycleCountLocationEligible)(input.db),
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