import { test } from "node:test";
import assert from "node:assert/strict";
import { applicableDecisionRefs, detectSessionDrift, measureReanchorCost, assembleReanchor } from "./reanchor.mjs";

// A minimal bootstrap shape (what coldStart()/assembleBootstrap returns), used to test the pure
// re-anchor composition with NO I/O — the same way a compacted session recovers from durable facts.
function fakeBoot({ selectorState = "CHECKPOINT", terminalCheckpoint = true, readyItemIds = [], activeAssignmentIds = [], ownerGateIds = ["Gate A"], freshness = "CURRENT", governingAuthority = "orch-operating-model" } = {}) {
  return {
    provenance: { sourceCommit: "durable-sha", freshness },
    currentState: { readyItemIds, activeAssignmentIds, ownerGateIds, protectedActionIds: [], selectorState, terminalCheckpoint, selectorHint: `selector=${selectorState}` },
    package: { domain: "orchestration", governingAuthority, sufficiency: "SUFFICIENT" },
    authorityFirst: { gate: "SATISFIED" },
    coldStartContextCost: { sufficiency: "SUFFICIENT" },
  };
}

const ENTRIES = [
  { id: "dec-current", kind: "decision", lifecycle: "current", authority: "DECISIONS #61", retrievalPath: "docs/DECISIONS.md", scope: ["orchestration"] },
  { id: "dec-super", kind: "decision", lifecycle: "current", supersededBy: "dec-current", authority: "old", retrievalPath: "x.md", scope: ["orchestration"] },
  { id: "dec-historical", kind: "decision", lifecycle: "historical", authority: "old2", retrievalPath: "y.md", scope: ["orchestration"] },
  { id: "dec-other", kind: "decision", lifecycle: "current", authority: "z", retrievalPath: "z.md", scope: ["finance"] },
  { id: "prin-1", kind: "principle", lifecycle: "current", authority: "p", retrievalPath: "p.md", scope: ["orchestration"] },
];

test("applicableDecisionRefs: only CURRENT, non-superseded, in-scope decisions", () => {
  const refs = applicableDecisionRefs(ENTRIES, ["orchestration"]);
  assert.deepEqual(refs.map((r) => r.id), ["dec-current"]); // super/historical/out-of-scope/principle all excluded
});

test("detectSessionDrift: no remembered → no drift, no comparisons", () => {
  const d = detectSessionDrift({ remembered: null, durable: { selectorState: "CHECKPOINT" } });
  assert.equal(d.hasDrift, false);
  assert.equal(d.comparisons, 0);
});

test("detectSessionDrift: every conflict resolves to durable authority and is surfaced", () => {
  const d = detectSessionDrift({
    remembered: { sourceCommit: "old", selectorState: "RUN", hasReadyWork: true, activeAssignmentIds: ["X"], openPrNumbers: [999], activeDecisionIds: ["D-old"] },
    durable: { sourceCommit: "new", selectorState: "CHECKPOINT", readyItemIds: [], activeAssignmentIds: [], mergedPrNumbers: [999], supersededDecisionIds: ["D-old"] },
  });
  const kinds = d.drifts.map((x) => x.kind).sort();
  assert.deepEqual(kinds, ["ASSIGNMENT_DRIFT", "DECISION_SUPERSEDED", "PR_STATE_DRIFT", "READY_DRIFT", "SELECTOR_DRIFT", "SOURCE_ADVANCED"].sort());
  assert.ok(d.drifts.every((x) => x.resolution === "DURABLE_AUTHORITY_WINS"));
  assert.equal(d.hasDrift, true);
});

test("detectSessionDrift: PR/decision drift only fires when durable facts are provided (else not guessed)", () => {
  const d = detectSessionDrift({ remembered: { openPrNumbers: [1], activeDecisionIds: ["D"] }, durable: {} });
  assert.equal(d.hasDrift, false); // no durable mergedPrNumbers/supersededDecisionIds → not comparable → not guessed
});

test("measureReanchorCost: orientation EXCLUDES the governing authority (cheaper than cold start)", () => {
  const c = measureReanchorCost({ l0Bytes: 4876, pointerBytes: 2566, governingAuthorityBytes: 19834, sufficiency: "SUFFICIENT" });
  assert.equal(c.orientationBytes, 4876 + 2566);               // authority NOT included
  assert.equal(c.governingAuthorityOnNeedBytes, 19834);        // reported as on-need upper bound
  assert.ok(c.orientationTokensEstimate < 2000);               // ~1.9k vs cold-start ~6.8k
  assert.equal(c.signal, "REANCHOR_CONTEXT_COST");
  assert.equal(c.healthy, true);
});

test("measureReanchorCost: unhealthy on stale/unnecessary retrieval or insufficient context", () => {
  assert.equal(measureReanchorCost({ staleRetrievals: 1 }).healthy, false);
  assert.equal(measureReanchorCost({ sufficiency: "EVIDENCE_REQUIRED" }).healthy, false);
});

test("assembleReanchor: answers all seven questions with durable pointers/refs", () => {
  const r = assembleReanchor({ boot: fakeBoot(), entries: ENTRIES, scope: ["orchestration"], continue: false, sizes: { l0Bytes: 4876, pointerBytes: 2566, governingAuthorityBytes: 19834 } });
  const a = r.answers;
  assert.equal(r.contract, "EOS-REANCHOR/1.0.0");
  assert.equal(a.whereAmI.freshness, "CURRENT");
  assert.equal(a.whatChangedIsCurrent.selectorState, "CHECKPOINT");
  assert.equal(a.whatGovernsThisWork.governingAuthority, "orch-operating-model");
  assert.deepEqual(a.whatGovernsThisWork.applicableDecisionRefs.map((x) => x.id), ["dec-current"]);
  assert.ok(a.whatNeedsTheOwner.ownerGateIds.length >= 1);
  assert.equal(a.whatAmIAuthorizedToDo.reanchorGrantsAuthority, false); // re-anchor ≠ authorization
});

test("assembleReanchor: RE_ANCHOR_ONLY never continues", () => {
  const r = assembleReanchor({ boot: fakeBoot({ selectorState: "RUN", terminalCheckpoint: false, readyItemIds: ["Alpha"] }), entries: ENTRIES, scope: ["orchestration"], continue: false, sizes: {} });
  assert.equal(r.continuation.mode, "RE_ANCHOR_ONLY");
  assert.equal(r.continuation.willContinue, false); // even though selector = RUN, ONLY mode stops
});

test("assembleReanchor: AND_CONTINUE continues ONLY when the DURABLE selector is actionable", () => {
  const run = assembleReanchor({ boot: fakeBoot({ selectorState: "RUN", terminalCheckpoint: false, readyItemIds: ["Alpha"] }), entries: ENTRIES, scope: ["orchestration"], continue: true, sizes: {} });
  assert.equal(run.continuation.mode, "RE_ANCHOR_AND_CONTINUE");
  assert.equal(run.continuation.willContinue, true);
  assert.match(run.continuation.continueBasis, /durable selector = RUN/);

  const checkpoint = assembleReanchor({ boot: fakeBoot({ selectorState: "CHECKPOINT" }), entries: ENTRIES, scope: ["orchestration"], continue: true, sizes: {} });
  assert.equal(checkpoint.continuation.willContinue, false); // durable CHECKPOINT halts continuation
  assert.match(checkpoint.continuation.haltReason, /no authorized actionable work/);
});
