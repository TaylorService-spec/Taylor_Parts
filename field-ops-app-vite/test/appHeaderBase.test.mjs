// I-1H — AppHeader host-path invariant.
//
// Gate 2: the "Refresh" full-reload link this suite was originally written for
// has been REMOVED. Persona review (all four personas concurring) found it
// shipped a browser function as application chrome, sitting beside "Home"
// looking identical while doing something entirely different — and "Home" was
// itself a second navigation axis, which Option B's single-axis rail exists to
// eliminate.
//
// The invariant that mattered survives and is asserted more strongly here: the
// header must never hard-code a host path. Removing the link removes that class
// of bug outright rather than merely deriving it correctly. Build-time per-mode
// base resolution remains proven separately by verifyBuildBase.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }

const header = fs.readFileSync(new URL("../src/shared/ui/AppHeader.jsx", import.meta.url), "utf8");

console.log("appHeaderBase.test.mjs");

check("no hard-coded /Taylor_Parts/field-ops navigation URL remains in AppHeader", () => {
  assert.ok(
    !header.includes("/Taylor_Parts/field-ops"),
    "AppHeader still contains a hard-coded /Taylor_Parts/field-ops path",
  );
});

check("no hard-coded host-path or absolute-URL href", () => {
  assert.ok(!/href="\/Taylor_Parts/.test(header), "AppHeader still hard-codes a host-path href");
  assert.ok(!/href="https?:\/\//.test(header), "AppHeader must not hard-code an absolute URL");
});

check("the second navigation axis is gone — the rail is the only one", () => {
  // A <Link to="/dashboard"> here duplicated the rail's own Dashboard
  // destination; the full-reload link duplicated the browser's reload button.
  assert.ok(!header.includes('to="/dashboard"'), "AppHeader must not re-introduce a Home nav link");
  assert.ok(
    !header.includes("import.meta.env.BASE_URL"),
    "AppHeader must not re-introduce the full-reload Refresh link",
  );
});

console.log(`\nappHeaderBase: ${passed} passed, 0 failed`);
