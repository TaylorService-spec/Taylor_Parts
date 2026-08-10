import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReviewProvenance, validateReviewProvenance, deriveSourceFreshness,
  isAuthoritativeSource, suggestedStaleDisposition, reviewProvenanceLabel, SOURCE_FRESHNESS,
} from "./reviewProvenance.mjs";

test("freshness is derived, never guessed — no observation → UNKNOWN, never CURRENT", () => {
  assert.equal(deriveSourceFreshness({}), "UNKNOWN");
  assert.equal(deriveSourceFreshness({ actualCommit: "abc" }), "UNKNOWN"); // no target to judge against
});

test("CURRENT only when the actual commit matches the target and the tree is clean", () => {
  assert.equal(deriveSourceFreshness({ actualCommit: "abc", targetCommit: "abc", workingTreeState: "CLEAN" }), "CURRENT");
  assert.equal(deriveSourceFreshness({ actualCommit: "old", targetCommit: "new" }), "BEHIND_REMOTE");
  assert.equal(deriveSourceFreshness({ actualCommit: "abc", targetCommit: "abc", workingTreeState: "DIRTY" }), "DIRTY");
  assert.equal(deriveSourceFreshness({ actualCommit: "abc", targetCommit: "new", diverged: true }), "DIVERGED");
});

test("createReviewProvenance derives sourceFreshnessState from the observations", () => {
  const behind = createReviewProvenance({ repository: "keystone", actualCommit: "old", originMainCommit: "new", workingTreeState: "CLEAN" });
  assert.equal(behind.sourceFreshnessState, "BEHIND_REMOTE"); // exactly the LIVE TEST run-1 condition
  const current = createReviewProvenance({ repository: "keystone", actualCommit: "x", requestedCommit: "x", workingTreeState: "CLEAN" });
  assert.equal(current.sourceFreshnessState, "CURRENT");
  assert.deepEqual(validateReviewProvenance(current), []);
});

test("only CURRENT source is authoritative where currency matters", () => {
  assert.equal(isAuthoritativeSource("CURRENT"), true);
  for (const s of ["BEHIND_REMOTE", "DIRTY", "DIVERGED", "UNKNOWN"]) {
    assert.equal(isAuthoritativeSource(s), false, `${s} must not be auto-authoritative`);
  }
});

test("suggested disposition steers stale reviews to re-run / contaminated (never silently accepted)", () => {
  assert.equal(suggestedStaleDisposition("CURRENT"), null);
  assert.equal(suggestedStaleDisposition("DIRTY"), "CONTAMINATED");
  assert.equal(suggestedStaleDisposition("BEHIND_REMOTE"), "NEEDS_RERUN"); // the LIVE TEST re-route
  assert.equal(suggestedStaleDisposition("DIVERGED"), "NEEDS_RERUN");
  assert.equal(suggestedStaleDisposition("UNKNOWN"), "NEEDS_RERUN");
});

test("Owner-facing labels distinguish currency without Git internals", () => {
  assert.equal(reviewProvenanceLabel("CURRENT"), "REVIEW CURRENT");
  assert.equal(reviewProvenanceLabel("BEHIND_REMOTE"), "REVIEW STALE");
  assert.equal(reviewProvenanceLabel("DIRTY"), "REVIEW CONTAMINATED");
  assert.equal(reviewProvenanceLabel("UNKNOWN"), "REVIEW UNKNOWN");
  assert.ok(SOURCE_FRESHNESS.includes("DIVERGED"));
});
