// I-1H — AppHeader home-link base correction. Deterministic source proof
// that the header's full-reload home link is derived from Vite's build-time
// base (import.meta.env.BASE_URL), not a hard-coded host path — so it
// resolves under /Taylor_Parts/field-ops/ on GitHub Pages and / on Firebase
// Hosting. (Per-mode resolution is additionally proven at build time by
// verifyBuildBase.mjs: the Firebase bundle carries zero /Taylor_Parts/
// field-ops occurrences; the GitHub bundle carries them.)
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }

const header = fs.readFileSync(new URL("../src/shared/ui/AppHeader.jsx", import.meta.url), "utf8");

console.log("appHeaderBase.test.mjs");

check("home link href is derived from import.meta.env.BASE_URL (the build-base authority)", () => {
  assert.ok(header.includes("href={import.meta.env.BASE_URL}"), "AppHeader home link must use href={import.meta.env.BASE_URL}");
});
check("no hard-coded /Taylor_Parts/field-ops navigation URL remains in AppHeader", () => {
  assert.ok(!header.includes("/Taylor_Parts/field-ops"), "AppHeader still contains a hard-coded /Taylor_Parts/field-ops path");
});
check("no hard-coded href to the GitHub Pages host path", () => {
  assert.ok(!/href="\/Taylor_Parts\/field-ops\/?"/.test(header), "AppHeader still hard-codes a host-path href");
});

console.log(`\nappHeaderBase: ${passed} passed, 0 failed`);
