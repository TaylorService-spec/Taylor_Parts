"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAnalysisOperation = exports.ANALYSIS_OPERATIONS = exports.EOS_ANALYSIS_OPERATIONS = exports.ANALYSIS_ROUTE = void 0;
const analysis_1 = require("./analysis");
exports.ANALYSIS_ROUTE = "/operations/analysis";
const actorOf = (caller) => ({ tenantId: caller.actor.tenantId, principalId: caller.actor.principalId,
    capabilities: caller.actor.capabilities, scopedHeld: caller.operational?.scopedHeld });
exports.EOS_ANALYSIS_OPERATIONS = Object.freeze({
    readAnalysisCatalog: async (_deps, caller) => (0, analysis_1.readAnalysisCatalog)(actorOf(caller)),
    readAnalysisWorkspace: async (deps, caller, input) => (0, analysis_1.readAnalysisWorkspace)(deps.pool, actorOf(caller), input, deps.now),
    readMeasureAnalysis: async (deps, caller, input) => (0, analysis_1.readMeasureAnalysis)(deps.pool, actorOf(caller), input, deps.now),
});
exports.ANALYSIS_OPERATIONS = Object.freeze(Object.keys(exports.EOS_ANALYSIS_OPERATIONS));
const isAnalysisOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(exports.EOS_ANALYSIS_OPERATIONS, name);
exports.isAnalysisOperation = isAnalysisOperation;
//# sourceMappingURL=analysisOperations.js.map