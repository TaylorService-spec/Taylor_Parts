import test from "node:test";
import assert from "node:assert/strict";
import {
  readinessProcurementStatus,
  strongestReadinessProcurementStatus,
} from "../lib/ai/workOrderReadinessSources.js";

test("only states EOS defines as actual purchasing activity map to active procurement", () => {
  assert.equal(readinessProcurementStatus("PURCHASING_IN_PROGRESS"), "PENDING");
  assert.equal(readinessProcurementStatus("ORDERED"), "ORDERED");
  assert.equal(readinessProcurementStatus("RECEIVED"), "RECEIVED");
});

test("an awaiting-review or assigned request is not silently relabelled as purchasing", () => {
  for (const status of [
    "PENDING_REVIEW",
    "APPROVED",
    "READY_FOR_PARTS_MANAGER",
    "ASSIGNED_TO_PARTS_ASSOCIATE",
    "REJECTED",
    "CANCELLED",
    "VOIDED",
    null,
    undefined,
    "UNKNOWN_FUTURE_STATE",
  ]) {
    assert.equal(readinessProcurementStatus(status), "NONE", String(status));
  }
});

test("multiple linked requests prefer current active procurement evidence", () => {
  assert.equal(
    strongestReadinessProcurementStatus(["RECEIVED", "PURCHASING_IN_PROGRESS"]),
    "PENDING",
  );
  assert.equal(
    strongestReadinessProcurementStatus(["PURCHASING_IN_PROGRESS", "ORDERED"]),
    "ORDERED",
  );
  assert.equal(strongestReadinessProcurementStatus(["RECEIVED"]), "RECEIVED");
  assert.equal(strongestReadinessProcurementStatus(["PENDING_REVIEW", "REJECTED"]), "NONE");
});
