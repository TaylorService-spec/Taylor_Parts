import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRulesPath,
  isDocsOnly,
  touchesPerformance,
  touchesRules,
  touchesSecurity,
  assessWarrant,
  buildReviewForList,
  renderChangedFiles,
  buildReviewRequest,
} from "./build-request.mjs";

test("isRulesPath matches either firestore.rules copy", () => {
  assert.equal(isRulesPath("firestore.rules"), true);
  assert.equal(isRulesPath("functions/firestore.rules"), true);
  assert.equal(isRulesPath("src/firestore.rules.txt"), false);
  assert.equal(isRulesPath("src/rules/other.rules"), false);
});

test("isDocsOnly true only when every path is docs/markdown", () => {
  assert.equal(isDocsOnly(["docs/a.md", "docs/specifications/b.md"]), true);
  assert.equal(isDocsOnly(["docs/a.md", "src/App.jsx"]), false);
  assert.equal(isDocsOnly([]), false);
});

test("touchesPerformance detects render/query/realtime paths", () => {
  assert.equal(touchesPerformance(["src/App.jsx"]), true);
  assert.equal(touchesPerformance(["src/data/inventoryQueries.js"]), true);
  assert.equal(touchesPerformance(["src/hooks/useSnapshot.js"]), true);
  assert.equal(touchesPerformance(["functions/index.js"]), false);
  assert.equal(touchesPerformance(["docs/perf-notes.md"]), false);
});

test("assessWarrant: rules change is always warranted and highest value", () => {
  const r = assessWarrant(["firestore.rules", "docs/x.md"]);
  assert.equal(r.warranted, true);
  assert.match(r.reason, /firestore\.rules/);
});

test("assessWarrant: docs-only is not warranted", () => {
  const r = assessWarrant(["docs/spec.md", "README.md"]);
  assert.equal(r.warranted, false);
  assert.match(r.reason, /docs-only/);
});

test("assessWarrant: empty set not warranted", () => {
  assert.equal(assessWarrant([]).warranted, false);
});

test("assessWarrant: routine UI change is NOT warranted", () => {
  const r = assessWarrant(["field-ops-app-vite/src/modules/inventory/PartDetail.jsx"]);
  assert.equal(r.warranted, false);
  assert.match(r.reason, /routine|low-risk/i);
});

test("assessWarrant: small non-security fix is NOT warranted", () => {
  assert.equal(assessWarrant(["field-ops-app-vite/src/domain/timelineBuilder.js"]).warranted, false);
});

test("assessWarrant: security-sensitive change IS warranted (path or override)", () => {
  assert.equal(assessWarrant(["field-ops-app-vite/src/auth/AuthContext.jsx"]).warranted, true);
  assert.equal(assessWarrant(["functions/src/index.ts"]).warranted, true);
  assert.equal(assessWarrant(["src/App.jsx"], { securitySensitive: true }).warranted, true);
  assert.equal(touchesSecurity(["src/auth/login.js"]), true);
  assert.equal(touchesSecurity(["src/modules/inventory/PartDetail.jsx"]), false);
});

test("assessWarrant: large refactor (>= threshold files) IS warranted", () => {
  const many = Array.from({ length: 16 }, (_, i) => `src/m${i}.js`);
  const r = assessWarrant(many);
  assert.equal(r.warranted, true);
  assert.match(r.reason, /large/i);
  assert.equal(assessWarrant(["a.js", "b.js"], { largeRefactorThreshold: 2 }).warranted, true);
});

test("assessWarrant: complex transaction flag IS warranted", () => {
  const r = assessWarrant(["src/domain/workOrders.js"], { complexTransaction: true });
  assert.equal(r.warranted, true);
  assert.match(r.reason, /complex transaction/i);
});

test("assessWarrant: forceWarrant overrides a routine change", () => {
  assert.equal(assessWarrant(["src/App.jsx"], { forceWarrant: true }).warranted, true);
});

test("buildReviewForList prunes Rules and Performance to the diff", () => {
  const codeNoPerf = buildReviewForList(["functions/index.js"]);
  assert.deepEqual(codeNoPerf, [
    "Correctness",
    "Security",
    "Maintainability",
    "Testing",
  ]);

  const withRules = buildReviewForList(["firestore.rules", "functions/index.js"]);
  assert.ok(withRules.includes("Firestore Rules"));
  assert.ok(!withRules.includes("Performance"));

  const withPerf = buildReviewForList(["src/App.jsx"]);
  assert.ok(withPerf.includes("Performance"));
  assert.ok(!withPerf.includes("Firestore Rules"));

  // explicit overrides win over heuristic
  const forced = buildReviewForList(["functions/index.js"], {
    rules: true,
    performance: true,
  });
  assert.ok(forced.includes("Firestore Rules"));
  assert.ok(forced.includes("Performance"));
});

test("renderChangedFiles lists small sets and collapses large ones", () => {
  const small = renderChangedFiles(["a.js", "b.js"]);
  assert.match(small, /Changed files \(2\):/);
  assert.match(small, /- a\.js/);

  const big = renderChangedFiles(
    Array.from({ length: 50 }, (_, i) => `f${i}.js`),
    40,
  );
  assert.match(big, /50 files — see PR diff/);
});

test("buildReviewRequest renders the exact block for a PR", () => {
  const { block, footer, warranted } = buildReviewRequest({
    pr: { number: 189, title: "Inventory reorder request flow" },
    branch: "feat/inv-reorder",
    base: "main",
    changedFiles: ["src/App.jsx", "src/data/inventoryQueries.js"],
    specPath: "docs/specifications/inv-reorder.md",
    planPath: "docs/implementation-plans/inv-reorder.md",
    outOfScope: "purchase-order approval",
  });

  // A 2-file UI + query change is routine/low-risk -> NOT warranted (workflow.md);
  // the request block still renders regardless of the warrant assessment.
  assert.equal(warranted, false);
  const expected = [
    "Repository: TaylorService-spec/Taylor_Parts",
    "PR: #189 — Inventory reorder request flow",
    "Branch: feat/inv-reorder  (base: main)",
    "Specification: docs/specifications/inv-reorder.md",
    "Implementation Plan: docs/implementation-plans/inv-reorder.md",
    "",
    "Review for:",
    "- Correctness",
    "- Security",
    "- Performance",
    "- Maintainability",
    "- Testing",
    "",
    "Changed files (2):",
    "- src/App.jsx",
    "- src/data/inventoryQueries.js",
  ].join("\n");
  assert.equal(block, expected);
  assert.match(footer, /do not redesign/);
  assert.match(footer, /Out of scope for this PR: purchase-order approval/);
});

test("buildReviewRequest: no PR yet and missing artifacts fall back cleanly", () => {
  const { block } = buildReviewRequest({
    branch: "docs/issue-100",
    base: "main",
    changedFiles: ["firestore.rules"],
  });
  assert.match(block, /PR: \(none yet — branch docs\/issue-100\)/);
  assert.match(block, /Specification: \(not committed\)/);
  assert.match(block, /Implementation Plan: \(not committed\)/);
  assert.match(block, /- Firestore Rules/);
});

test("buildReviewRequest defaults repo and base", () => {
  const { block } = buildReviewRequest({
    branch: "b",
    changedFiles: ["functions/index.js"],
  });
  assert.match(block, /Repository: TaylorService-spec\/Taylor_Parts/);
  assert.match(block, /\(base: main\)/);
});

test("changed files accept gh --json {path} object shape", () => {
  const { block } = buildReviewRequest({
    branch: "b",
    changedFiles: [{ path: "src/A.jsx" }, { path: "src/B.jsx" }],
  });
  assert.match(block, /- src\/A\.jsx/);
  assert.match(block, /Changed files \(2\):/);
});
