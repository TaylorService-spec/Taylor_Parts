import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIssueTaskClass, authorizedProfileFromLabels } from "./issueTaskClassifier.mjs";

test("implementation/fix/build/code-change intent => PATCH_PRODUCER request with PATCH + receipts + verifier teeth", () => {
  for (const body of [
    "## Required work\nImplement the reorder callable.",
    "## Required work\nRefactor the dispatch module and add a function.",
    "## Required work\nFix the bug in the allocation logic.",
    "## Required work\nWire up the new endpoint and add a migration.",
  ]) {
    const c = classifyIssueTaskClass({ title: "t", body });
    assert.equal(c.taskClass, "PATCH_PRODUCER", body);
    assert.equal(c.expectedArtifactClass, "PATCH");
    assert.deepEqual(c.requiredExecutionReceipts, ["tests"]);
    assert.equal(c.verifierRequired, true);
    assert.equal(c.ambiguous, false);
  }
});

test("verification/test-only intent => READ_ONLY_VERIFY (no PATCH requirement)", () => {
  const c = classifyIssueTaskClass({ title: "t", body: "## Required work\nRun the tests and verify the fix reproduces." });
  assert.equal(c.taskClass, "READ_ONLY_VERIFY");
  assert.equal(c.expectedArtifactClass, "NONE");
  assert.equal(c.verifierRequired, false);
});

test("analysis/design/ambiguous => fail-closed READ_ONLY_ANALYSIS", () => {
  assert.equal(classifyIssueTaskClass({ title: "Audit", body: "## Required work\nReview and assess the inventory surfaces." }).taskClass, "READ_ONLY_ANALYSIS");
  const amb = classifyIssueTaskClass({ title: "Look into things", body: "## Required work\nFigure out what to do about the thing." });
  assert.equal(amb.taskClass, "READ_ONLY_ANALYSIS");
  assert.equal(amb.ambiguous, true);
  // "fix the typo in the README" is NOT implementation (no code-ish noun)
  assert.equal(classifyIssueTaskClass({ title: "docs", body: "## Required work\nFix the typo in the README." }).taskClass, "READ_ONLY_ANALYSIS");
});

test("explicit `taskClass:` declaration and `eos-task:*` label win over heuristics", () => {
  assert.equal(classifyIssueTaskClass({ title: "t", body: "## Execution\ntaskClass: PATCH_PRODUCER\n## Required work\nanalyze stuff" }).taskClass, "PATCH_PRODUCER");
  assert.equal(classifyIssueTaskClass({ title: "t", body: "analyze", labels: ["eos-task:implementation"] }).taskClass, "PATCH_PRODUCER");
  assert.equal(classifyIssueTaskClass({ title: "t", body: "implement the thing", labels: ["eos-task:analysis"] }).taskClass, "READ_ONLY_ANALYSIS");
});

test("GOVERNED_INTEGRATION is NEVER inferred — not by keyword nor by producer declaration", () => {
  // 'integrate/merge/deploy' carry no implementation/verify keyword → fail-closed READ_ONLY_ANALYSIS, never GI
  assert.equal(classifyIssueTaskClass({ title: "t", body: "integrate and merge and deploy the change" }).taskClass, "READ_ONLY_ANALYSIS");
  const declaredGI = classifyIssueTaskClass({ title: "t", body: "## Execution\ntaskClass: GOVERNED_INTEGRATION" });
  assert.equal(declaredGI.taskClass, "READ_ONLY_ANALYSIS", "producer cannot request GI via text");
  assert.equal(declaredGI.ambiguous, true);
});

test("authorizedProfileFromLabels: governed grant comes ONLY from an eos-authorize-* label; default least privilege", () => {
  assert.equal(authorizedProfileFromLabels([]), "READ_ONLY_ANALYSIS");
  assert.equal(authorizedProfileFromLabels(["eos-intake"]), "READ_ONLY_ANALYSIS", "the intake label is not an authorization grant");
  assert.equal(authorizedProfileFromLabels(["eos-authorize-verify"]), "READ_ONLY_VERIFY");
  assert.equal(authorizedProfileFromLabels(["eos-authorize-patch"]), "PATCH_PRODUCER");
  assert.equal(authorizedProfileFromLabels(["eos-authorize-integration"]), "GOVERNED_INTEGRATION");
  // highest present wins; label objects accepted
  assert.equal(authorizedProfileFromLabels([{ name: "eos-authorize-verify" }, { name: "eos-authorize-patch" }]), "PATCH_PRODUCER");
});
