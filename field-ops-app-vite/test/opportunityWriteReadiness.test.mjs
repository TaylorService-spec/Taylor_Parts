import test from "node:test";
import assert from "node:assert/strict";
import { opportunityWriteReadiness, OPPORTUNITY_WRITE_DISABLED_REASON } from "../src/access/opportunityWriteReadiness.js";

test("fail-closed by default: writes disabled with an honest reason", () => {
  const r = opportunityWriteReadiness();
  assert.equal(r.enabled, false);
  assert.equal(r.reason, OPPORTUNITY_WRITE_DISABLED_REASON);
});

test("requires BOTH capability grant AND command deploy to enable", () => {
  assert.equal(opportunityWriteReadiness({ capabilityGranted: true }).enabled, false);
  assert.equal(opportunityWriteReadiness({ commandDeployed: true }).enabled, false);
  const enabled = opportunityWriteReadiness({ capabilityGranted: true, commandDeployed: true });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.reason, null);
});
