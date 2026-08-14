// Administration Overview -- "Version / deployment info" section (pure helpers).
//
// The running bundle's build id (`__APP_COMMIT__`, injected by vite.config.js
// `define`) answers "what did THIS loaded client build from?". The deployed
// manifest (`/version.json`, emitted by vite.config.js's emit-version-manifest
// plugin -- see test/verifyVersionManifest.mjs) answers "what did the SERVER
// last publish?". A stale-cached client (old bundle, new deploy behind it) is
// exactly the case where those two disagree -- this is the display-side half
// of the D1/D2 expected-vs-deployed contract; it renders the comparison, it
// does not invent new version identity.
//
// Fail-closed: a missing/unparseable manifest or an "unknown" commit on
// either side must never be presented as a false match -- see
// classifyVersionStatus below.

/** The manifest schema this UI understands (see vite.config.js emitVersionManifest). */
export const EXPECTED_MANIFEST_SCHEMA = 2;

/**
 * Fetches and validates `/version.json`. Never throws -- fetch failure,
 * non-OK status, invalid JSON, or a missing required field all resolve to
 * `{ ok: false }` so the caller can render "deployment manifest unavailable"
 * rather than propagate an error.
 */
export async function loadDeploymentManifest(fetchImpl, url = "/version.json") {
  let response;
  try {
    response = await fetchImpl(url, { cache: "no-store" });
  } catch {
    return { ok: false };
  }
  if (!response || !response.ok) return { ok: false };

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false };
  }
  if (!data || typeof data !== "object") return { ok: false };
  if (typeof data.commit !== "string" || data.commit.length === 0) return { ok: false };

  return {
    ok: true,
    manifest: {
      commit: data.commit,
      buildTime: typeof data.buildTime === "string" ? data.buildTime : null,
      environmentId: typeof data.environmentId === "string" ? data.environmentId : null,
      environmentRole: typeof data.environmentRole === "string" ? data.environmentRole : null,
      schema: typeof data.schema === "number" ? data.schema : null,
    },
  };
}

/**
 * Compares the running bundle's commit against the deployed manifest's
 * commit. Fails closed to "unknown" (never a false "match" or false
 * "behind") whenever either side is missing or literally the string
 * "unknown" -- that value means the build could not resolve a real
 * identifier (see vite.config.js resolveAppCommit), not that it matches.
 */
export function classifyVersionStatus(runningCommit, manifestCommit) {
  const usable = (v) => typeof v === "string" && v.length > 0 && v !== "unknown";
  if (!usable(runningCommit) || !usable(manifestCommit)) return "unknown";
  return runningCommit === manifestCommit ? "match" : "behind";
}
