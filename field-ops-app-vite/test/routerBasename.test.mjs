// I-1R — deterministic unit tests for the router-basename derivation. Proves
// the mapping from Vite's build-time base (import.meta.env.BASE_URL) to
// BrowserRouter's basename for both host modes and edge cases. Pure Node.
import assert from "node:assert/strict";
import { routerBasenameFrom } from "../src/routerBasename.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }

console.log("routerBasename.test.mjs");

check("GitHub Pages base -> /Taylor_Parts/field-ops (trailing slash stripped)", () => {
  assert.equal(routerBasenameFrom("/Taylor_Parts/field-ops/"), "/Taylor_Parts/field-ops");
});
check("Firebase root base -> /", () => {
  assert.equal(routerBasenameFrom("/"), "/");
});
check("base without a trailing slash is returned unchanged", () => {
  assert.equal(routerBasenameFrom("/Taylor_Parts/field-ops"), "/Taylor_Parts/field-ops");
});
check("collapses multiple trailing slashes", () => {
  assert.equal(routerBasenameFrom("/foo/"), "/foo");
});
check("empty / undefined / non-string fall back to root (never throws)", () => {
  assert.equal(routerBasenameFrom(""), "/");
  assert.equal(routerBasenameFrom(undefined), "/");
  assert.equal(routerBasenameFrom(null), "/");
});
check("root is never reduced to an empty string (BrowserRouter needs '/')", () => {
  assert.equal(routerBasenameFrom("/"), "/");
  assert.notEqual(routerBasenameFrom("/"), "");
});

console.log(`\nrouterBasename: ${passed} passed, 0 failed`);
