// The stale-bundle reload guard (diagnostics/staleBundleReload.js): one automatic reload per stale-chunk failure, never a
// loop, never for any other error, never without storage to guard it.
// Run: node --test test/staleBundleReload.test.mjs   (also `npm test`)
import test from "node:test";
import assert from "node:assert/strict";
import { isStaleBundleError, reloadOnceForStaleBundle, RELOAD_GUARD_MS, STALE_BUNDLE_RELOAD_KEY } from "../src/diagnostics/staleBundleReload.js";

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test("recognises the stale-chunk failure in every engine's wording, and nothing else", () => {
  for (const msg of ["Failed to fetch dynamically imported module: https://x/assets/a.js", "error loading dynamically imported module",
    "Importing a module script failed."]) {
    assert.equal(isStaleBundleError(new TypeError(msg)), true, msg);
  }
  for (const other of [new Error("Cannot read properties of undefined"), null, undefined, {}, new Error("Failed to fetch")]) {
    assert.equal(isStaleBundleError(other), false);
  }
});

test("reloads ONCE, then the guard holds for RELOAD_GUARD_MS, then a later deploy may reload again", () => {
  const storage = memory();
  let t = 1_000_000;
  let reloads = 0;
  const deps = { storage, reload: () => { reloads += 1; }, now: () => t };
  const stale = new TypeError("Failed to fetch dynamically imported module: /assets/b.js");
  assert.equal(reloadOnceForStaleBundle(stale, deps), true);
  assert.equal(storage.getItem(STALE_BUNDLE_RELOAD_KEY), String(1_000_000));
  t += 10_000;
  assert.equal(reloadOnceForStaleBundle(stale, deps), false, "no loop");
  t += RELOAD_GUARD_MS;
  assert.equal(reloadOnceForStaleBundle(stale, deps), true, "a later deploy in the same session");
  assert.equal(reloads, 2);
});

test("never reloads for another error, without storage, or when storage refuses", () => {
  let reloads = 0;
  const reload = () => { reloads += 1; };
  assert.equal(reloadOnceForStaleBundle(new Error("boom"), { storage: memory(), reload }), false);
  assert.equal(reloadOnceForStaleBundle(new TypeError("Failed to fetch dynamically imported module"), { storage: null, reload }), false);
  const refusing = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(reloadOnceForStaleBundle(new TypeError("Failed to fetch dynamically imported module"), { storage: refusing, reload }), false);
  assert.equal(reloads, 0);
});
