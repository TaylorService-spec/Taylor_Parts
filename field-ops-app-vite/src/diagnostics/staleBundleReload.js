// STALE BUNDLE AFTER A DEPLOY -- one automatic reload, never a loop.
//
// Every merge to main redeploys the app. A tab opened before the deploy still holds the OLD index, whose lazy route
// chunks (App.jsx `lazy(() => import(...))`) no longer exist on the server, so the next lazy route crashes with
// "Failed to fetch dynamically imported module" (seen live on /service/dispatcher-board, crash ZDJ11-58EILS). The fix is
// a fresh page load, which picks up the new index -- so the root ErrorBoundary does that ONCE, automatically.
//
// THE GUARD. The reload time is written to sessionStorage BEFORE reloading. A second stale-chunk failure within
// RELOAD_GUARD_MS of it means the reload did not help (a chunk that is genuinely missing, a network that cannot fetch
// it), and the boundary falls back to its normal crash screen instead of reloading again. With no usable storage there
// is no guard, so there is no automatic reload either.
//
// Dependency-free so it is node-testable (test/staleBundleReload.test.mjs).

export const STALE_BUNDLE_RELOAD_KEY = "eos.staleBundleReloadAt";
export const RELOAD_GUARD_MS = 5 * 60_000;

// Chromium, Firefox and Safari word the same failure differently.
const STALE_CHUNK = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export function isStaleBundleError(error) {
  const text = typeof error === "string" ? error : `${error?.message ?? ""}`;
  return STALE_CHUNK.test(text);
}

const sessionStore = () => {
  try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; }
};

/**
 * Reload once for a stale-bundle failure. Returns true when it reloaded (the caller should render nothing further).
 * @param {unknown} error
 * @param {{ storage?: Storage | null, reload?: () => void, now?: () => number }} [deps] injectable for tests
 */
export function reloadOnceForStaleBundle(error, { storage = sessionStore(), reload = () => window.location.reload(), now = Date.now } = {}) {
  if (!isStaleBundleError(error) || !storage) return false;
  try {
    const last = Number(storage.getItem(STALE_BUNDLE_RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now() - last < RELOAD_GUARD_MS) return false;
    storage.setItem(STALE_BUNDLE_RELOAD_KEY, String(now()));
  } catch {
    return false; // storage refused: without the guard, never auto-reload
  }
  reload();
  return true;
}
