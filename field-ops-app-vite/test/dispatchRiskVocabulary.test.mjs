import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/modules/dispatch/Dispatch.jsx", import.meta.url), "utf8");

test("a derived risk score is not presented as a customer emergency", () => {
  assert.doesNotMatch(src, /label: "Emergency"/, "risk severity must not be labelled Emergency");
  assert.match(src, /label: "At risk"/, "it must say what the score actually supports");
});

test("the chip still distinguishes at-risk work from ordinary scheduled work", () => {
  assert.match(src, /label: "Scheduled"/, "non-risky work keeps a neutral label");
});

test("the label change did not silently drop the risk signal", () => {
  assert.match(src, /computeJobRisk\(job\)/, "the risk read must remain");
  assert.match(src, /SEVERITY\.HIGH \|\| risk\.severity === SEVERITY\.CRITICAL/, "the threshold must be unchanged");
});
