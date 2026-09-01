// IMPECCABLE DESIGN-HOOK IGNORE SCOPE — pinned.
//
// .impeccable/config.json (repo root) carries the shared detector filters for the
// impeccable design-quality hook. Exactly ONE exception is authorized (Owner,
// 2026-09-01): installed North Star Design-authority artifacts — the `.dc.html`
// sources under docs/north-star/ — are immutable ratified design records, not newly
// authored product UI, so the style detector does not evaluate them.
//
// This test exists so that scope cannot silently broaden: the hook must keep
// evaluating runtime React/CSS/HTML, the Financials implementation, reconciliation
// docs, and everything else. Live behavioral proof (plugin's shouldIgnoreDetectionFile:
// .dc.html ignored, product files evaluated) was run at adoption; the plugin itself is
// machine-local, so CI pins the config contract instead.
//
// Run: node --test test/impeccableIgnoreScope.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CONFIG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".impeccable",
  "config.json",
);

test("the design-hook ignore covers exactly the installed .dc.html design artifacts, nothing broader", () => {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const detector = config.detector ?? {};
  assert.deepEqual(
    detector.ignoreFiles ?? [],
    ["docs/north-star/**/*.dc.html"],
    "ignoreFiles must stay scoped to installed Design-authority sources — no runtime, docs, or whole-directory globs",
  );
  // No whole rules are switched off, and no value ignores exist without their own review.
  assert.deepEqual(detector.ignoreRules ?? [], [], "no design rule is disabled repo-wide");
  assert.deepEqual(detector.ignoreValues ?? [], [], "no shared value ignores are configured");
});
