// AtRiskPanel is fed governed WorkOrder docs directly (ControlTower.jsx passes `workOrders` as the
// `jobs` prop). A WorkOrder doc never carries `workOrderId` -- that field is a legacy Job's FK
// pointing AT a work order, not something a work order has about itself. fragmentationFactor()
// used to key its no-sibling-data branch on `!job.workOrderId` and explain it as "no work order
// assigned", which is nonsensical on a card that IS the work order. Assert the explanation no
// longer makes that false claim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRiskBreakdown } from "../src/domain/jobRiskScoring.js";

test("fragmentation factor does not claim a WorkOrder-shaped item has no work order", () => {
  const workOrder = {
    id: "WO-100",
    status: "ASSIGNED",
    customer: "Acme Foods",
    createdAt: new Date().toISOString(),
    // No workOrderId -- this IS the work order, not a Job pointing at one.
  };

  const { factors } = getRiskBreakdown(workOrder, {}, Date.now());
  const fragmentation = factors.find((f) => f.type === "fragmentation");

  assert.ok(fragmentation, "expected a fragmentation factor in the breakdown");
  assert.equal(fragmentation.score, 0);
  assert.doesNotMatch(
    fragmentation.explanation,
    /no work order assigned/i,
    "fragmentation explanation must not tell a dispatcher a WorkOrder card has no work order"
  );
});
