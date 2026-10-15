"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEffectiveAccessCallable = exports.deleteSavedDefinitionCallable = exports.duplicateSavedDefinitionCallable = exports.renameSavedDefinitionCallable = exports.listSavedDefinitionsCallable = exports.getSavedDefinitionCallable = exports.createSavedDefinitionCallable = exports.runReportDefinitionCallable = exports.rejectAccessRequest = exports.approveAccessRequest = exports.setUserStatus = exports.assignApprovedRole = exports.revokeRole = exports.grantRole = exports.updateWorkOrderExecutionData = exports.transitionWorkOrder = exports.createWorkOrder = void 0;
// Cloud Functions entry point. Deliberately thin: no logic here, so
// every exported module stays independently testable.
const app_1 = require("firebase-admin/app");
(0, app_1.initializeApp)();
// --- Issue #15 surface: Work Order Engine v1.2 ---
var createWorkOrder_1 = require("./createWorkOrder");
Object.defineProperty(exports, "createWorkOrder", { enumerable: true, get: function () { return createWorkOrder_1.createWorkOrder; } });
var transitionWorkOrder_1 = require("./transitionWorkOrder");
Object.defineProperty(exports, "transitionWorkOrder", { enumerable: true, get: function () { return transitionWorkOrder_1.transitionWorkOrder; } });
var updateWorkOrderExecutionData_1 = require("./updateWorkOrderExecutionData");
Object.defineProperty(exports, "updateWorkOrderExecutionData", { enumerable: true, get: function () { return updateWorkOrderExecutionData_1.updateWorkOrderExecutionData; } });
// --- Issue #226 surface: Enterprise Access & Administration Platform ---
// Exactly these six -- see docs/deployment/enterprise-access-deployment-
// manifest.md Section B. Not deployed, and no client calls them, until a
// separate, later Owner production authorization (Implementation Plan
// Row 19+) is issued.
var accessCommandCallables_1 = require("./access/accessCommandCallables");
Object.defineProperty(exports, "grantRole", { enumerable: true, get: function () { return accessCommandCallables_1.grantRole; } });
Object.defineProperty(exports, "revokeRole", { enumerable: true, get: function () { return accessCommandCallables_1.revokeRole; } });
Object.defineProperty(exports, "assignApprovedRole", { enumerable: true, get: function () { return accessCommandCallables_1.assignApprovedRole; } });
Object.defineProperty(exports, "setUserStatus", { enumerable: true, get: function () { return accessCommandCallables_1.setUserStatus; } });
Object.defineProperty(exports, "approveAccessRequest", { enumerable: true, get: function () { return accessCommandCallables_1.approveAccessRequest; } });
Object.defineProperty(exports, "rejectAccessRequest", { enumerable: true, get: function () { return accessCommandCallables_1.rejectAccessRequest; } });
// --- Issue #325 / ADR-007 D-FN surface: trusted report execution ---
// Same "export is not deployment" posture as the six commands above:
// not deployed to the live project, and no client calls it (the client
// run seam, field-ops-app-vite/src/domain/reporting/
// reportExecutionSeam.js, is unchanged and still unconditionally
// unavailable) until a separate, later Owner production authorization.
// Additionally requires NO Role grant exists for any report.*
// capability (permissionCatalog.ts/compatibilityRoles.ts/
// governedBusinessRoles.ts, untouched) -- every real call denies today
// by construction of the access layer this depends on, independent of
// deployment/export status.
var runReportDefinitionCallable_1 = require("./reporting/runReportDefinitionCallable");
Object.defineProperty(exports, "runReportDefinitionCallable", { enumerable: true, get: function () { return runReportDefinitionCallable_1.runReportDefinitionCallable; } });
// --- Issue #325 / ADR-007 D-RULES CORRECTED surface: trusted saved-
// definition CRUD ---
// Same "export is not deployment" posture as the surfaces above: not
// deployed to the live project, and no client calls these (Customer
// persistence integration is explicitly out of scope for this task)
// until a separate, later Owner production authorization. firestore.
// rules denies ALL direct client read/write on reportDefinitions
// unconditionally -- these six callables are now the ONLY path to that
// collection. A saved definition confers no report-data access;
// executing a saved definition's query still reauthorizes independently
// through the D-FN surface above.
var savedDefinitionCallables_1 = require("./reporting/savedDefinitionCallables");
Object.defineProperty(exports, "createSavedDefinitionCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.createSavedDefinitionCallable; } });
Object.defineProperty(exports, "getSavedDefinitionCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.getSavedDefinitionCallable; } });
Object.defineProperty(exports, "listSavedDefinitionsCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.listSavedDefinitionsCallable; } });
Object.defineProperty(exports, "renameSavedDefinitionCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.renameSavedDefinitionCallable; } });
Object.defineProperty(exports, "duplicateSavedDefinitionCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.duplicateSavedDefinitionCallable; } });
Object.defineProperty(exports, "deleteSavedDefinitionCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.deleteSavedDefinitionCallable; } });
// --- Issue #226 surface: trusted effective-access feed ---
// Same "export is not deployment" posture as the surfaces above: not
// deployed to the live project, and no client calls it (Customer's own
// W1 UI integration is a separate, later, explicitly out-of-scope step
// for this PR) until a separate, later Owner production authorization.
// Read-only, mutates nothing, writes no Audit Event -- see
// effectiveAccessFeed.ts's own header for why this surface doesn't
// audit (unlike the mutating commands above or the row-reading report
// execution service).
var effectiveAccessFeedCallable_1 = require("./access/effectiveAccessFeedCallable");
Object.defineProperty(exports, "resolveEffectiveAccessCallable", { enumerable: true, get: function () { return effectiveAccessFeedCallable_1.resolveEffectiveAccessCallable; } });
//# sourceMappingURL=index.js.map