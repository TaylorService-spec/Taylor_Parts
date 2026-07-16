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
