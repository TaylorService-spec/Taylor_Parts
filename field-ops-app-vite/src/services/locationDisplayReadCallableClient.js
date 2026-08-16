// PART 11A -- transport over the trusted `getLocationDisplay` callable
// (functions/src/inventoryLocation/locationDisplayReadService.ts). Structure mirrors
// services/serializedAssetReadCallableClient.js exactly: firebase is imported LAZILY (no
// import-time initializeApp side effect), and this is the only place that invokes the callable.
//
// READ, no client-side readiness flag -- `inventory.location.display.read` authorization and its
// per-environment activation are both enforced server-side (the callable throws permission-denied
// when unauthorized or unactivated -- it is registered `active:false` and granted to NO Role as of
// this build; see access/permissionCatalog.ts).
function mapErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code === "permission-denied" ? "denied" : "unavailable";
}

async function invoke(locationIds) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, "getLocationDisplay")({ locationIds });
  return res?.data;
}

// Fetch the governed location-display projection for a bounded, non-empty set of location ids.
// Returns { result } on success (the callable's own {status, locations} envelope, passed through
// verbatim for domain/locationDisplayProjection.js to interpret) or { errorStatus } on failure
// ("denied" | "unavailable") -- never throws. Callers must not invoke this with an empty array (the
// callable rejects it as invalid-argument); the consuming hook only calls this when there is at
// least one id to resolve.
export async function fetchLocationDisplay(locationIds) {
  try {
    const result = await invoke(locationIds);
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}
