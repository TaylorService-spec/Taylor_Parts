import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleReanchor } from "./reanchor.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// C-7 RE-ANCHOR ACCEPTANCE — reproducible compaction scenario.
//
// The test is NOT whether the session remembers everything. It is whether it can LOSE conversational
// detail and still recover the correct OPERATIONAL truth — and refuse to resume stale remembered work.
//
//   BEFORE compaction, the session remembered:
//     • assignment "STD-DISPATCH-042" ACTIVE
//     • there was READY work / selector was RUN
//     • PR #900 was OPEN
//     • decision "D-legacy-model-routing" was the active policy
//
//   MEANWHILE the durable repository advanced:
//     • the assignment completed and was CONSUMED (no longer in the active set)
//     • the selector reached a terminal CHECKPOINT (only Owner gates remain)
//     • PR #900 MERGED into origin/main
//     • D-legacy-model-routing was SUPERSEDED by current authority
//
//   AFTER compaction the operator says only "Re-anchor EOS and continue."
//   The session MUST report durable current state and MUST NOT continue the remembered assignment.
// ─────────────────────────────────────────────────────────────────────────────

// Durable truth AFTER the repository advanced (what coldStart() would produce live). Pure fixture —
// no git, no network, no pre-compaction transcript needed to run the test.
const DURABLE_BOOT = {
  provenance: { sourceCommit: "durable-HEAD", freshness: "CURRENT" },
  currentState: {
    readyItemIds: [],                 // selector reached terminal CHECKPOINT
    activeAssignmentIds: [],          // STD-DISPATCH-042 advanced to CONSUMED — not active
    ownerGateIds: ["Finance revenue recognition engine", "Receiving activation"],
    protectedActionIds: ["Receiving activation"],
    selectorState: "CHECKPOINT",
    terminalCheckpoint: true,
    selectorHint: "No authorized READY work — legitimate terminal CHECKPOINT; do not manufacture autonomous work.",
  },
  package: { domain: "orchestration", governingAuthority: "orch-operating-model", sufficiency: "SUFFICIENT" },
  authorityFirst: { gate: "SATISFIED" },
  coldStartContextCost: { sufficiency: "SUFFICIENT" },
};

// What the COMPRESSED session still "remembers" — deliberately stale.
const REMEMBERED = {
  sourceCommit: "pre-compaction-sha",
  selectorState: "RUN",
  hasReadyWork: true,
  activeAssignmentIds: ["STD-DISPATCH-042"],   // remembered ACTIVE — durable says otherwise
  openPrNumbers: [900],                         // remembered OPEN — durable says merged
  activeDecisionIds: ["D-legacy-model-routing"],// remembered active — durable says superseded
};

const ENTRIES = [
  { id: "D-legacy-model-routing", kind: "decision", lifecycle: "current", supersededBy: "D-current-model-routing", authority: "legacy", retrievalPath: "legacy.md", scope: ["orchestration"] },
  { id: "D-current-model-routing", kind: "decision", lifecycle: "current", authority: "modelPolicy.mjs", retrievalPath: "docs/orchestration/lib/modelPolicy.mjs", scope: ["orchestration"] },
];
const DURABLE_EXTRAS = { mergedPrNumbers: [900], supersededDecisionIds: ["D-legacy-model-routing"] };

// The operator said "Re-anchor EOS and continue." → continue:true.
const R = assembleReanchor({
  boot: DURABLE_BOOT, entries: ENTRIES, scope: ["orchestration"],
  remembered: REMEMBERED, durableExtras: DURABLE_EXTRAS, continue: true,
  sizes: { l0Bytes: 4876, pointerBytes: 2566, governingAuthorityBytes: 19834 },
});

test("ACCEPTANCE: durable authority wins every remembered drift", () => {
  const kinds = R.sessionContextDrift.drifts.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ["ASSIGNMENT_DRIFT", "DECISION_SUPERSEDED", "PR_STATE_DRIFT", "READY_DRIFT", "SELECTOR_DRIFT", "SOURCE_ADVANCED"].sort());
  assert.ok(R.sessionContextDrift.drifts.every((d) => d.resolution === "DURABLE_AUTHORITY_WINS"));
});

test("ACCEPTANCE: does NOT continue the stale remembered assignment (unauthorized continuation = 0)", () => {
  assert.equal(R.continuation.willContinue, false);                 // durable CHECKPOINT halts, despite continue:true
  assert.match(R.continuation.haltReason, /CHECKPOINT/);
  // the answer reflects durable truth, not the remembered active assignment
  assert.deepEqual(R.answers.whatAmIDoing.activeAssignmentIds, []);
  // remembered assignment id appears ONLY as drift, never as something to resume
  const mentionsAsResume = R.answers.whatShouldHappenNext.continuation.continueBasis;
  assert.equal(mentionsAsResume, null);
});

test("ACCEPTANCE: reports durable current state (selector CHECKPOINT, Owner gates surfaced)", () => {
  assert.equal(R.answers.whatChangedIsCurrent.selectorState, "CHECKPOINT");
  assert.equal(R.answers.whatChangedIsCurrent.terminalCheckpoint, true);
  assert.ok(R.answers.whatNeedsTheOwner.ownerGateIds.length >= 1);
});

test("ACCEPTANCE: provenance CURRENT + context SUFFICIENT + re-anchor ≠ authorization", () => {
  assert.equal(R.provenance.freshness, "CURRENT");
  assert.equal(R.reanchorContextCost.sufficiency, "SUFFICIENT");
  assert.equal(R.reanchorContextCost.healthy, true);
  assert.equal(R.answers.whatAmIAuthorizedToDo.reanchorGrantsAuthority, false);
});

test("ACCEPTANCE: recovery needs zero Owner restatement and bounded retrieval (no archaeology)", () => {
  // The whole recovery is a function of durable facts + a tiny remembered claims object — the entire
  // pre-compaction transcript is NOT an input. Cost is bounded and cheaper than a cold start.
  assert.ok(R.sessionContextDrift.comparisons >= 5);               // it actually compared the stale claims
  assert.ok(R.reanchorContextCost.orientationTokensEstimate < 2500); // bounded orientation, no broad reread
  assert.equal(R.reanchorContextCost.l1Retrievals, 0);              // no L1 front-loaded on re-anchor
});
