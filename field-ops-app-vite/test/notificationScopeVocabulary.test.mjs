import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

// Reproduces the reported contradiction as a source-level contract, because the
// defect is vocabulary, not state: the bell renders a REORDER REQUEST's urgency
// using the same fo-badge-{level} vocabulary the Inventory queue uses for STOCK
// CONDITION severity. Personas matched "MEDIUM" in the bell against
// "Critical & High (0)" in Inventory and reported the two surfaces as
// contradicting each other. They are different authorities and must NOT be made
// to agree -- the row has to say which scale it is on.
const panel = fs.readFileSync(new URL("../src/shared/ui/NotificationPanel.jsx", import.meta.url), "utf8");

test("the panel states which authority its rows belong to", () => {
  assert.match(panel, /Reorder requests in progress/, "panel must name the concept it lists");
  assert.match(panel, /Stock levels live in Inventory/, "panel must point stock questions elsewhere");
});

test("an urgency badge names its scale rather than showing a bare severity word", () => {
  assert.match(panel, /Request urgency: \$\{request\.urgency\}/, "urgency must be labelled as request urgency");
  assert.doesNotMatch(
    panel,
    />\{request\.urgency\}</,
    "a bare urgency value reads as a stock-condition severity",
  );
});

test("the fix does not reconcile the two counts — they are different facts", () => {
  // Guard against a future 'fix' that makes the bell agree with the Inventory
  // queue. These are separate authorities (reorder_requests vs the
  // recommendation/analytics read); forcing agreement would be a false claim.
  assert.doesNotMatch(panel, /inventoryAnalytics|REORDER_RECOMMENDATION|criticalAndHigh/i);
});

test("the NEEDS_PLANNING row keeps its distinct, non-severity wording", () => {
  assert.match(panel, /Needs planning/, "a null urgency must not borrow a severity word");
});
