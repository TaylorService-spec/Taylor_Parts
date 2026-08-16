// Available Equipment (Serialized Asset) -- transport over the trusted `getAvailableEquipment`
// callable (functions/src/serializedAsset/serializedAssetReadService.ts). Structure mirrors
// services/manufacturerReadCallableClient.js exactly: firebase is imported LAZILY (no import-time
// initializeApp side effect), and this is the only place that invokes the callable.
//
// READ, no client-side readiness flag -- `inventory.serializedAsset.read` authorization and its
// per-environment activation are both enforced server-side (the callable throws permission-denied
// when unauthorized or unactivated -- it is registered `active:false` and granted to NO Role as of
// this build; see access/permissionCatalog.ts). Attempting the call and mapping whatever comes back
// is the same governed-read pattern every other trusted-callable read client in this codebase uses:
// this client does NOT special-case "not yet activated" -- that failure surfaces as an ordinary
// permission-denied, exactly like any other unauthorized caller, and the UI's DENIED state already
// covers it honestly (see access/serializedAssetSource.js's header).
function mapErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code === "permission-denied" ? "denied" : "unavailable";
}

async function invoke() {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, "getAvailableEquipment")({});
  return res?.data;
}

// Fetch the governed Available Equipment projection. Returns { result } on success (the callable's
// own {status, availableEquipment, excludedCount} envelope, passed through verbatim for
// domain/availableEquipmentGovernedProjection.js to interpret) or { errorStatus } on failure
// ("denied" | "unavailable") -- never throws.
export async function fetchAvailableEquipment() {
  try {
    const result = await invoke();
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}
