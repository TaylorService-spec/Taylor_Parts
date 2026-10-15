"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareShadowDecision = compareShadowDecision;
exports.runShadowParitySuite = runShadowParitySuite;
const resolveEffectivePermission_1 = require("./resolveEffectivePermission");
// Spec §18: "computing a decision that is logged and compared but not
// enforced." This function is the entire enforcement surface of shadow
// mode: it returns a comparison record. Nothing calls .decision to
// gate a real action.
function compareShadowDecision(input) {
    const resolved = (0, resolveEffectivePermission_1.resolveEffectivePermission)(input.resolverInput);
    return {
        fixtureLabel: input.fixtureLabel,
        permissionId: input.permissionId,
        legacyDecision: input.legacyDecision,
        resolvedDecision: resolved.decision,
        match: resolved.decision === input.legacyDecision,
    };
}
function runShadowParitySuite(comparisons) {
    const results = comparisons.map(compareShadowDecision);
    const mismatches = results.filter((r) => !r.match);
    return {
        total: results.length,
        matched: results.length - mismatches.length,
        mismatches,
        fullParity: mismatches.length === 0,
    };
}
//# sourceMappingURL=shadowParityHarness.js.map