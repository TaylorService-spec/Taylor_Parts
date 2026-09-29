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
// The server's per-request bound (functions/src/inventoryLocation/locationDisplayReadService.ts
// MAX_LOCATION_IDS). A request over it is refused as invalid-argument, which this client reported as
// "unavailable" -- so any list naming more than 50 distinct locations silently lost EVERY label.
export const MAX_LOCATION_IDS_PER_REQUEST = 50;

/** Split ids into server-sized requests. Pure; order is preserved. */
export function chunkLocationIds(locationIds, size = MAX_LOCATION_IDS_PER_REQUEST) {
  const ids = Array.isArray(locationIds) ? locationIds : [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/**
 * Resolve display labels for any number of ids, one bounded request per chunk.
 *
 * ALL OR NOTHING: if any chunk fails the whole read reports that failure (DENIED wins, because a
 * refusal is the more specific fact) -- a partial label set presented as complete would show some
 * rows resolved and others as raw ids with no way to tell "not governed" from "not fetched".
 */
export async function fetchLocationDisplay(locationIds, invokeFn = invoke) {
  const chunks = chunkLocationIds(locationIds);
  if (chunks.length <= 1) {
    try {
      const result = await invokeFn(chunks[0] ?? []);
      return { result };
    } catch (err) {
      return { errorStatus: mapErrorToStatus(err) };
    }
  }
  const settled = await Promise.allSettled(chunks.map((chunk) => invokeFn(chunk)));
  const failures = settled.filter((s) => s.status === "rejected").map((s) => mapErrorToStatus(s.reason));
  if (failures.length > 0) return { errorStatus: failures.includes("denied") ? "denied" : "unavailable" };
  const results = settled.map((s) => s.value);
  // Every chunk must be a well-formed ready answer; anything else is the whole read unavailable.
  if (!results.every((r) => r && typeof r === "object" && r.status === "ready" && Array.isArray(r.locations))) {
    return { errorStatus: "unavailable" };
  }
  return { result: { status: "ready", locations: results.flatMap((r) => r.locations) } };
}
