// F-RULES-1 D3 blocker regression -- src/domain/jobDisplay.js and the
// FieldMode render sites that crashed production Technician Workspace with
// React error #31 when a legacy job carried an object-shaped customer
// ({ name }). Run: node test/jobDisplay.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jobCustomerName } from "../src/domain/jobDisplay.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// ---- the exact production crash shape (D3 fixture) ------------------------
ok("object-shaped customer (the D3 crash shape) normalizes to its name", () => {
  assert.equal(jobCustomerName({ name: "D3 SMOKE (not a real customer)" }), "D3 SMOKE (not a real customer)");
});

ok("legacy string customer passes through unchanged", () => {
  assert.equal(jobCustomerName("ACME Corp"), "ACME Corp");
  assert.equal(jobCustomerName(""), "");
});

ok("never returns a non-string (React #31 is structurally impossible)", () => {
  for (const v of [null, undefined, 42, true, ["x"], {}, { name: 7 }, { title: "no name key" }]) {
    const out = jobCustomerName(v);
    assert.equal(typeof out, "string", `input ${JSON.stringify(v)} must normalize to a string`);
  }
});

ok("hero matching works for both shapes via the normalizer", () => {
  // the hero comparison consumes jobCustomerName(...) output -- same string
  // for both shapes, so sorting/badging behaves identically.
  assert.equal(jobCustomerName({ name: "Hero Co" }), jobCustomerName("Hero Co"));
});

// ---- structural: FieldMode renders customers ONLY through the normalizer --
ok("FieldMode has no raw customer render left", () => {
  const src = readFileSync(new URL("../src/modules/mobile/FieldMode.jsx", import.meta.url), "utf8");
  assert.match(src, /jobCustomerName\(activeJob\.customer\)/);
  assert.match(src, /jobCustomerName\(job\.customer\)/);
  assert.doesNotMatch(src, /\{activeJob\.customer\}/, "raw active-job customer render must be gone");
  assert.doesNotMatch(src, /\{job\.customer\}/, "raw up-next customer render must be gone");
  assert.doesNotMatch(src, /isHeroActiveJob\((activeJob|a|b|job)\.customer\)/, "hero checks must consume the normalized name");
});

console.log(`\njobDisplay: ${passed} passed, 0 failed`);
