// Issue #214 PR-3 -- unit tests for the presentation-only workflow action helpers:
// destructive-action ordering (Cancel separated, never added/removed, others' order
// preserved) and the ConfirmDialog required-reason gate. Neither decides
// authorization or allowed actions.
//
// Run: node test/workflowActionOrder.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { orderWorkflowActions, canConfirm } from "../src/domain/workflowActionOrder.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// --- destructive-action ordering ---------------------------------------
ok("Cancel is split out as the destructive action, others kept in order", () => {
  const r = orderWorkflowActions(["MarkReady", "Cancel", "Schedule"]);
  assert.deepEqual(r.primary, ["MarkReady", "Schedule"]); // Cancel removed from primary, order preserved
  assert.equal(r.cancelAllowed, true);
});
ok("no Cancel -> cancelAllowed false, primary unchanged", () => {
  const r = orderWorkflowActions(["Dispatch", "Close"]);
  assert.deepEqual(r.primary, ["Dispatch", "Close"]);
  assert.equal(r.cancelAllowed, false);
});
ok("ordering never invents an action not present", () => {
  const r = orderWorkflowActions([]);
  assert.deepEqual(r.primary, []);
  assert.equal(r.cancelAllowed, false);
  // Cancel is only surfaced when the resolver actually returned it.
  assert.equal(orderWorkflowActions(["Schedule"]).cancelAllowed, false);
});
ok("Cancel-only -> no primary, destructive present", () => {
  const r = orderWorkflowActions(["Cancel"]);
  assert.deepEqual(r.primary, []);
  assert.equal(r.cancelAllowed, true);
});

// --- required-reason gate ----------------------------------------------
ok("no reason required -> always confirmable", () => {
  assert.equal(canConfirm({ requireReason: false, reason: "" }), true);
  assert.equal(canConfirm({}), true);
});
ok("reason required -> blank/whitespace blocks, non-blank allows", () => {
  assert.equal(canConfirm({ requireReason: true, reason: "" }), false);
  assert.equal(canConfirm({ requireReason: true, reason: "   " }), false);
  assert.equal(canConfirm({ requireReason: true, reason: "\n\t" }), false);
  assert.equal(canConfirm({ requireReason: true, reason: "out of stock" }), true);
  assert.equal(canConfirm({ requireReason: true, reason: "  ok  " }), true);
});

console.log(`\n${passed} passed, 0 failed`);
