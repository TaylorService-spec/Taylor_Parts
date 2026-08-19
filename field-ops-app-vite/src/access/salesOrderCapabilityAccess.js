// Sales Order WRITE/FULFILL/SERVICE capability -- PURE glue (no firebase; node-testable) for the
// trusted effective-access feed's client integration, reusing the SAME generic primitives
// access/reportCapabilityAccess.js already built for Issue #325 / ADR-007 (capability-id-agnostic:
// version/feed state machine, observed-version validation, callable-result interpretation, and the
// fail-closed hasCapability builder). Only the REQUEST list is Sales-Order-specific. Mirrors
// access/opportunityCapabilityAccess.js exactly.
//
// This is the REAL signal behind SalesOrderActions' write-gating (KNOWN DEFECT: SalesOrderActions
// previously rendered Advance/Cancel/Allocate/Create Service purely from the client-side state
// mirror in domain/salesOrderActions.js, with no capability check at all -- so a principal holding
// salesOrder.read but NOT salesOrder.write/.fulfill/.service (salesManager, accountingManager,
// financeManager per functions/src/access/governedBusinessRoles.ts) saw fully live, enabled action
// buttons and only learned they were unauthorized after confirming and hitting the server's denial).
// See access/useSalesOrderCapabilities.js for the hook that observes this live, and App.jsx for
// where it is wired to the real SalesOrderDetail mount.
export {
  VERSION_STATUS,
  FEED_STATUS,
  SIGNED_OUT_VERSION,
  IDLE_FEED,
  isValidObservedVersion,
  interpretAccessResult,
  buildHasCapability,
} from "./reportCapabilityAccess.js";

export const SALES_ORDER_WRITE_CAPABILITY = "salesOrder.write";
export const SALES_ORDER_FULFILL_CAPABILITY = "salesOrder.fulfill";
export const SALES_ORDER_SERVICE_CAPABILITY = "salesOrder.service";

// The capabilities the trusted feed is asked to decide, in ONE request (all resolved against the
// same accessVersion). Kept as a list (mirroring OPPORTUNITY_CAPABILITY_REQUEST's shape) so a later
// increment can widen it without changing the hook's request-building code.
export const SALES_ORDER_CAPABILITY_REQUEST = Object.freeze([
  SALES_ORDER_WRITE_CAPABILITY,
  SALES_ORDER_FULFILL_CAPABILITY,
  SALES_ORDER_SERVICE_CAPABILITY,
]);

// Shown next to a protected (disabled) Sales Order action button -- honest, not a raw backend error.
export const SALES_ORDER_WRITE_DISABLED_REASON =
  "You are not authorized to perform this action on this Sales Order.";
