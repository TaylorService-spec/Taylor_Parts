// NON-PO ACQUISITION capability — PURE glue for the trusted effective-access feed, reusing the same
// generic primitives access/reportCapabilityAccess.js already built (capability-id-agnostic:
// version/feed state machine, observed-version validation, callable-result interpretation, and the
// fail-closed hasCapability builder). Only the REQUEST list is acquisition-specific. Mirrors
// access/equipmentInstallCapabilityAccess.js exactly.
//
// WHY THIS SURFACE NEEDS IT AT ALL. Acquisition asserts the company owns a machine with NO supplier
// document to check it against. Rendering an enabled control for a principal who does not hold
// `inventory.serializedAsset.acquire` would let somebody choose a part, type a serial, confirm, and
// only then learn they were never allowed — and on this command that wasted work ends at a
// permission-denied on a screen whose whole purpose was a deliberate, accountable act.
//
// INSTALL IS DELIBERATELY ABSENT, and the omission is the same one `equipmentInstallCapabilityAccess`
// makes from the other side. `equipment.install` is a different station held by different people:
// the Role that may bring a unit onto the books confers no authority to place it at a customer, so
// no single person can take a machine from non-existence into a customer's hands. Requesting both
// here would put the two authorities behind one screen and invite them behind one button.
//
// THIS DECIDES WHAT TO RENDER, NOT WHAT IS ALLOWED. The command re-checks the capability INSIDE its
// transaction, reading roleAssignments through that transaction so a concurrent revocation conflicts
// the commit. Rendering is not authority.
export {
  VERSION_STATUS,
  FEED_STATUS,
  SIGNED_OUT_VERSION,
  IDLE_FEED,
  isValidObservedVersion,
  interpretAccessResult,
  buildHasCapability,
} from "./reportCapabilityAccess.js";

export const SERIALIZED_ASSET_ACQUIRE_CAPABILITY = "inventory.serializedAsset.acquire";

/** One capability, one request. A list so a later increment can widen it without reshaping the hook. */
export const SERIALIZED_ASSET_ACQUIRE_CAPABILITY_REQUEST = Object.freeze([SERIALIZED_ASSET_ACQUIRE_CAPABILITY]);
