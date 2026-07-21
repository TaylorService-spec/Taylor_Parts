// Cloud Functions entry point. Deliberately thin: no logic here, so
// every exported module stays independently testable.
import { initializeApp } from "firebase-admin/app";

initializeApp();

// --- Issue #15 surface: Work Order Engine v1.2 ---
export { createWorkOrder } from "./createWorkOrder";
export { transitionWorkOrder } from "./transitionWorkOrder";
export { updateWorkOrderExecutionData } from "./updateWorkOrderExecutionData";

// --- Issue #226 surface: Enterprise Access & Administration Platform ---
// Exactly these six -- see docs/deployment/enterprise-access-deployment-
// manifest.md Section B. Not deployed, and no client calls them, until a
// separate, later Owner production authorization (Implementation Plan
// Row 19+) is issued.
export {
  grantRole,
  revokeRole,
  assignApprovedRole,
  setUserStatus,
  approveAccessRequest,
  rejectAccessRequest,
} from "./access/accessCommandCallables";

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
export { runReportDefinitionCallable } from "./reporting/runReportDefinitionCallable";

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
export {
  createSavedDefinitionCallable,
  getSavedDefinitionCallable,
  listSavedDefinitionsCallable,
  renameSavedDefinitionCallable,
  duplicateSavedDefinitionCallable,
  deleteSavedDefinitionCallable,
} from "./reporting/savedDefinitionCallables";

// --- Issue #226 surface: trusted effective-access feed ---
// Same "export is not deployment" posture as the surfaces above: not
// deployed to the live project, and no client calls it (Customer's own
// W1 UI integration is a separate, later, explicitly out-of-scope step
// for this PR) until a separate, later Owner production authorization.
// Read-only, mutates nothing, writes no Audit Event -- see
// effectiveAccessFeed.ts's own header for why this surface doesn't
// audit (unlike the mutating commands above or the row-reading report
// execution service).
export { resolveEffectiveAccessCallable } from "./access/effectiveAccessFeedCallable";
