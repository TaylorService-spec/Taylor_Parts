// EQUIPMENT INSTALL capability -- PURE glue for the trusted effective-access feed, reusing the same
// generic primitives access/reportCapabilityAccess.js already built (capability-id-agnostic:
// version/feed state machine, observed-version validation, callable-result interpretation, and the
// fail-closed hasCapability builder). Only the REQUEST list is install-specific. Mirrors
// access/salesOrderCapabilityAccess.js exactly.
//
// WHY THIS SURFACE NEEDS IT AT ALL. Install is irreversible: Equipment accountId and locationId are
// immutable after create, and nothing clears the asset's link. Rendering an enabled Install button
// for a principal who does not hold equipment.install would let somebody choose a customer, choose a
// location, confirm, and only then learn they were never allowed -- which is the exact defect
// SalesOrderActions had before its own capability gate.
//
// ACQUISITION IS DELIBERATELY ABSENT. inventory.serializedAsset.acquire is a different station held
// by different people, and the pool this surface installs from already exists. Requesting it here
// would put both authorities behind one screen and invite them behind one button.
export {
  VERSION_STATUS,
  FEED_STATUS,
  SIGNED_OUT_VERSION,
  IDLE_FEED,
  isValidObservedVersion,
  interpretAccessResult,
  buildHasCapability,
} from "./reportCapabilityAccess.js";

export const EQUIPMENT_INSTALL_CAPABILITY = "equipment.install";

/** One capability, one request. A list so a later increment can widen it without reshaping the hook. */
export const EQUIPMENT_INSTALL_CAPABILITY_REQUEST = Object.freeze([EQUIPMENT_INSTALL_CAPABILITY]);
