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

test("Operational History states that it is reconstructed, not a recorded audit trail", () => {
  // UX-EX-002: "History" implies a durable authoritative record. The data is derived
  // from job.createdAt with approximated milestone times, and that was conceded only in
  // a source comment — invisible to a reader about to quote a time to a customer.
  const src = fs.readFileSync(new URL("../src/modules/controlTower/WorkOrderDetail.jsx", import.meta.url), "utf8");
  assert.match(src, /Reconstructed from Work Order milestones/, "the basis must be stated on the surface");
  assert.match(src, /approximate, not a recorded audit trail/, "it must not imply an audit trail");
});
