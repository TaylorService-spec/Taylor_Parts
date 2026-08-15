// Opportunity WRITE capability — PURE glue (no firebase; node-testable) for the trusted effective-access
// feed's client integration, reusing the SAME generic primitives access/reportCapabilityAccess.js already
// built for Issue #325 / ADR-007 (they are capability-id-agnostic: version/feed state machine, observed-
// version validation, callable-result interpretation, and the fail-closed hasCapability builder carry no
// Report-specific logic despite that module's name). Only the REQUEST list is Opportunity-specific.
//
// This is the REAL signal behind the write-readiness seam's `capabilityGranted` (access/
// opportunityWriteReadiness.js), replacing the previous no-args call that always evaluated to `undefined`
// (KNOWN DEFECT, SalesWorkspace.jsx:394 pre-fix) — see access/useOpportunityCapabilities.js for the hook
// that observes this live and App.jsx for where it is wired to the real mount.
export {
  VERSION_STATUS,
  FEED_STATUS,
  SIGNED_OUT_VERSION,
  IDLE_FEED,
  isValidObservedVersion,
  interpretAccessResult,
  buildHasCapability,
} from "./reportCapabilityAccess.js";

export const OPPORTUNITY_WRITE_CAPABILITY = "opportunity.write";

// The capability the trusted feed is asked to decide, in ONE request. Kept as a list (mirroring
// REPORT_CAPABILITY_REQUEST's shape) so a later increment can widen it (e.g. opportunity.createSalesOrder)
// without changing the hook's request-building code.
export const OPPORTUNITY_CAPABILITY_REQUEST = Object.freeze([OPPORTUNITY_WRITE_CAPABILITY]);
