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

// ---- structural: FieldMode carries no legacy free-text customer ------------
//
// F0 -- FieldMode moved to the governed Work Order model, which carries a
// customerId REFERENCE, not the legacy free-text `customer` field these
// assertions were written for. jobCustomerName() itself is unchanged and stays
// fully covered by the behavioural tests above; it is simply no longer reached
// from this screen, because the shape it normalises no longer appears here.
//
// The guard that mattered is kept and strengthened: no raw customer render, and
// now no legacy customer field usage at all.
//
// KNOWN GAP, recorded rather than hidden: the technician currently sees the
// Work Order number and complaint but NOT the customer name, because resolving
// customerId -> account name is a read this screen does not yet make (and whose
// technician-side Rules access is unverified). Carried as an F1 item -- see
// docs/assessments/f0-field-job-authority-evidence.md.
ok("FieldMode carries no legacy free-text customer usage", () => {
  const src = readFileSync(new URL("../src/modules/mobile/FieldMode.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\{activeJob\.customer\}/, "raw active-job customer render must be gone");
  assert.doesNotMatch(src, /\{job\.customer\}/, "raw up-next customer render must be gone");
  // Narrowed for F1: the ban is on the LEGACY free-text `customer` field of a
  // job/work-order record, not on the word "customer". FieldMode now reads
  // `fieldContext.customer` -- the trusted projection's governed display block,
  // which is a different thing entirely and is exactly what replaced the legacy
  // field.
  assert.doesNotMatch(src, /\b(job|activeJob|wo|workOrder)\.customer\b/,
    "the legacy free-text customer field must not be read");
  assert.doesNotMatch(src, /jobCustomerName/,
    "the legacy free-text normalizer must not be reached from this screen");
  assert.doesNotMatch(src, /isHeroActiveJob/, "demo hero ordering must not drive a governed queue");
});

console.log(`\njobDisplay: ${passed} passed, 0 failed`);
