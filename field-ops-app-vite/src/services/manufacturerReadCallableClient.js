// Manufacturer catalog — transport over the trusted `getManufacturerCatalog` callable
// (functions/src/partMaster/manufacturerReadService.ts). Structure mirrors
// services/salesOrderReadCallableClient.js: firebase is imported LAZILY (no import-time
// initializeApp side effect), and this is the only place that invokes the callable.
//
// READ, no client-side readiness flag -- `inventory.catalog.read` authorization and its
// per-environment activation are both enforced server-side (the callable throws
// permission-denied when unauthorized); attempting the call and mapping whatever comes
// back is the same governed-read pattern every other read client in this codebase uses.
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
  const res = await httpsCallable(functions, "getManufacturerCatalog")({});
  return res?.data;
}

// Fetch the full Manufacturer catalog. Returns { result } on success (the callable's own
// {status, manufacturers, excludedCount} envelope, passed through verbatim for
// domain/manufacturerCatalogView.js to interpret) or { errorStatus } on failure
// ("denied" | "unavailable") -- never throws.
export async function fetchManufacturerCatalog() {
  try {
    const result = await invoke();
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}
