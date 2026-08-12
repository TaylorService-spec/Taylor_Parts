import test from "node:test";
import assert from "node:assert/strict";
import { assessBaseCompatibility, focusedChecks, integrationRecordLocation } from "./intake-patch-integrate.mjs";

test("integration replay has one deterministic record path", () => {
  assert.equal(integrationRecordLocation("EOS-ISSUE-819", "a".repeat(64)), `docs/orchestration/work-intake/results/EOS-ISSUE-819/integration/${"a".repeat(64)}.json`);
});
test("focused node tests are derived only from changed test modules", () => {
  assert.deepEqual(focusedChecks(["docs/a.mjs", "docs/a.test.mjs"]), [
    ["node", "--check", "docs/a.mjs"], ["node", "--check", "docs/a.test.mjs"], ["node", "--test", "docs/a.test.mjs"],
  ]);
});
test("unrelated main advancement is safe but target drift is stale", () => {
  assert.deepEqual(assessBaseCompatibility({ isAncestor: true, changedSinceBase: ["results/x.json"], patchPaths: ["src/a.mjs"] }), { ok: true, reason: null });
  assert.deepEqual(assessBaseCompatibility({ isAncestor: true, changedSinceBase: ["src/a.mjs"], patchPaths: ["src/a.mjs"] }), { ok: false, reason: "patch targets changed since base: src/a.mjs" });
  assert.equal(assessBaseCompatibility({ isAncestor: false, changedSinceBase: [], patchPaths: [] }).ok, false);
});
