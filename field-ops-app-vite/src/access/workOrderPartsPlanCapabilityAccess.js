// WO Parts Planning WRITE capability -- PURE glue (no firebase; node-testable) for the trusted
// effective-access feed's client integration, reusing the SAME generic, capability-id-agnostic
// primitives access/reportCapabilityAccess.js already built for Issue #325 / ADR-007 and that
// access/opportunityCapabilityAccess.js already reuses for `opportunity.write`. Only the REQUEST
// list is Parts-Planning-specific.
//
// WHY THIS EXISTS. `workOrder.parts.plan` is registered active:false in permissionCatalog.ts, so
// today the SERVER denies every save regardless of caller. Before this module, the client had no way
// to know that up front: WorkOrderPartsPlanEditor.jsx rendered "Edit parts plan" for every admin/
// dispatcher (the only role pair that reaches the route), let them run a full add/remove/quantity
// session against the live Part Master catalog, and only revealed the guaranteed denial after they
// pressed Save (KNOWN DEFECT). This module is the real signal WorkOrderPartsPlanEditor now gates on,
// mirroring the exact fix already applied for Opportunity write (access/useOpportunityCapabilities.js
// / App.jsx's OpportunityWorkspaceConnected).
export {
  VERSION_STATUS,
  FEED_STATUS,
  SIGNED_OUT_VERSION,
  IDLE_FEED,
  isValidObservedVersion,
  interpretAccessResult,
  buildHasCapability,
  isAccessResolving,
} from "./reportCapabilityAccess.js";

export const WORK_ORDER_PARTS_PLAN_CAPABILITY = "workOrder.parts.plan";

// The capability the trusted feed is asked to decide, in ONE request (mirroring
// OPPORTUNITY_CAPABILITY_REQUEST's shape).
export const WORK_ORDER_PARTS_PLAN_CAPABILITY_REQUEST = Object.freeze([WORK_ORDER_PARTS_PLAN_CAPABILITY]);
