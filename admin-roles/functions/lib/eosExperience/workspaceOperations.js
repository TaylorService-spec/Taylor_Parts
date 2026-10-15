"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWorkspaceOperation = exports.WORKSPACE_OPERATIONS = exports.EOS_WORKSPACE_OPERATIONS = exports.WORKSPACE_ROUTE = void 0;
const myWork_1 = require("./myWork");
const previewAsUser_1 = require("./previewAsUser");
const principalDisplayNames_1 = require("./principalDisplayNames");
exports.WORKSPACE_ROUTE = "/operations/workspace";
exports.EOS_WORKSPACE_OPERATIONS = Object.freeze({ readMyWork: myWork_1.readMyWork, searchEos: myWork_1.searchEos, previewMyWorkAs: previewAsUser_1.previewMyWorkAs, resolvePrincipalDisplayNames: principalDisplayNames_1.resolvePrincipalDisplayNames, resolveEmployeeDisplayNames: principalDisplayNames_1.resolveEmployeeDisplayNames, searchAccountOwnerCandidates: principalDisplayNames_1.searchAccountOwnerCandidates });
exports.WORKSPACE_OPERATIONS = Object.freeze(Object.keys(exports.EOS_WORKSPACE_OPERATIONS));
const isWorkspaceOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(exports.EOS_WORKSPACE_OPERATIONS, name);
exports.isWorkspaceOperation = isWorkspaceOperation;
//# sourceMappingURL=workspaceOperations.js.map