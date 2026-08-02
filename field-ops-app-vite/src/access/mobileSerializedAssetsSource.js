// EI-P2a -- the injectable read seam for the MOBILE-location serializedAssets section. It authors NO
// persistence, NO custody/movement authority, and NO reads. The governed ledger-derived
// serialized-asset current-state projection does NOT exist yet (its persisted collection, trusted
// ledger-coupled writer, Rules, and index are separately authorized later Tier-2 gates), so the
// DEFAULT source is INERT: it reports an honest "unavailable" state and no items -- never fabricated
// inventory. When the projection ships, a real source (built via
// domain/serializedAssetInventoryLocation.projectMobileSerializedAssets) is injected here with no
// change to the consuming mobileLocationInventoryProjection, which enforces the accessVersion +
// locationId binding on whatever source is supplied.
//
// Mirrors the truckInventorySource seam. This section source is consumed directly by
// mobileLocationInventoryProjection's per-section reader (buildArraySection), which owns the
// fail-closed normalization, so no separate read function is duplicated here.

// The inert default: `status: "unavailable"` is what the composer renders as the honest
// not-yet-connected serializedAssets section; the absence of `items` guarantees no fabricated
// inventory (the composer yields null content for any non-READY section).
export const inertMobileSerializedAssetsSource = Object.freeze({
  status: "unavailable",
});
