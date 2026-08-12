import test from "node:test";
import assert from "node:assert/strict";
import { allowedWritebackPath, unexpectedWritebackPaths } from "./issue-intake-writeback.mjs";
const id = "EOS-ISSUE-814";

test("only current-request EOS artifacts are allowed", () => {
  assert.equal(allowedWritebackPath(id, `docs/orchestration/work-intake/${id}.work.json`), true);
  assert.equal(allowedWritebackPath(id, `docs/orchestration/work-intake/status/${id}.status.json`), true);
  assert.equal(allowedWritebackPath(id, `docs/orchestration/work-intake/results/${id}/abc.result.json`), true);
  assert.equal(allowedWritebackPath(id, `docs/orchestration/work-intake/review-ready/${id}.json`), true);
});

test("source edits and artifacts for another request fail closed", () => {
  assert.deepEqual(unexpectedWritebackPaths(id, ["docs/orchestration/lib/intakeExecute.mjs", "docs/orchestration/work-intake/status/EOS-ISSUE-813.status.json", `docs/orchestration/work-intake/status/${id}.status.json`]), ["docs/orchestration/lib/intakeExecute.mjs", "docs/orchestration/work-intake/status/EOS-ISSUE-813.status.json"]);
});

test("Windows separators are normalized", () => {
  assert.equal(allowedWritebackPath(id, `docs\\orchestration\\work-intake\\status\\${id}.status.json`), true);
});
