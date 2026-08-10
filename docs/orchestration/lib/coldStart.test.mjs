import { test } from "node:test";
import assert from "node:assert/strict";
import {
  governedSubjects, authorityFirstGate, governedSubjectsOutsideScope,
  measureColdStartCost, assembleBootstrap,
} from "./coldStart.mjs";

const ENTRIES = [
  { id: "op", kind: "principle", authority: "Operating Model", scope: ["orchestration"], level: "L1", lifecycle: "current", retrievalPath: "op.md" },
  { id: "model", kind: "model", authority: "modelPolicy.mjs", scope: ["model-routing", "dispatch"], level: "L1", lifecycle: "current", retrievalPath: "modelPolicy.mjs" },
  { id: "old", kind: "decision", authority: "Old Policy", scope: ["model-routing"], level: "L2", lifecycle: "superseded", supersededBy: "model", retrievalPath: "old.md" },
  { id: "ev", kind: "evidence", authority: null, scope: ["orchestration"], level: "L2", lifecycle: "current", retrievalPath: "ev.md" },
];

test("governedSubjects lists only CURRENT authority-bearing subjects (no evidence, no superseded)", () => {
  const g = governedSubjects(ENTRIES);
  const subjects = g.map((x) => x.subject);
  assert.ok(subjects.includes("model-routing") && subjects.includes("orchestration") && subjects.includes("dispatch"));
  // superseded "old" and raw "ev" (evidence, no authority) contribute nothing
  const mr = g.find((x) => x.subject === "model-routing");
  assert.equal(mr.authorities.length, 1);
  assert.equal(mr.authorities[0].authority, "modelPolicy.mjs");
});

test("authorityFirstGate SATISFIED when the governing authority is in the package required set", () => {
  const pkg = { required: [{ id: "model", retrievalPath: "modelPolicy.mjs" }] };
  const g = authorityFirstGate({ entries: ENTRIES, pkg, scope: ["model-routing"] });
  assert.equal(g.gate, "SATISFIED");
  assert.equal(g.missing.length, 0);
  assert.equal(g.present[0].authority, "modelPolicy.mjs");
});

test("authorityFirstGate EVIDENCE_REQUIRED when a governed subject in scope has no authority in-package", () => {
  const pkg = { required: [] }; // authority NOT retrieved — the model-routing defect class
  const g = authorityFirstGate({ entries: ENTRIES, pkg, scope: ["model-routing"] });
  assert.equal(g.gate, "EVIDENCE_REQUIRED");
  assert.equal(g.missing[0].subject, "model-routing");
  assert.ok(g.missing[0].expectedAuthorities.includes("modelPolicy.mjs"));
});

test("governedSubjectsOutsideScope surfaces model-routing when the assignment omitted it", () => {
  const outside = governedSubjectsOutsideScope(ENTRIES, ["orchestration"]);
  assert.ok(outside.some((o) => o.subject === "model-routing"));
  // and does NOT surface it once it is in scope
  const inScope = governedSubjectsOutsideScope(ENTRIES, ["orchestration", "model-routing"]);
  assert.ok(!inScope.some((o) => o.subject === "model-routing"));
});

test("measureColdStartCost reports orientation exactly and labels the token count an estimate", () => {
  const c = measureColdStartCost({
    l0Bytes: 4000, pointerBytes: 2000, governingAuthorityBytes: 8000, requiredAllBytes: 40000,
    sufficiency: "SUFFICIENT", unnecessaryRetrievals: 0, staleRetrievals: 0,
  });
  assert.equal(c.orientationBytes, 14000);             // exact sum
  assert.equal(c.orientationTokensEstimate, 3500);     // 14000/4, ESTIMATE
  assert.equal(c.requiredAllTokensEstimate, 10000);
  assert.equal(c.runtimeTokens, null);                 // never fabricated
  assert.equal(c.healthy, true);
});

test("measureColdStartCost is unhealthy when it had to retrieve something excluded or stale", () => {
  assert.equal(measureColdStartCost({ unnecessaryRetrievals: 1, sufficiency: "SUFFICIENT" }).healthy, false);
  assert.equal(measureColdStartCost({ staleRetrievals: 1, sufficiency: "SUFFICIENT" }).healthy, false);
  assert.equal(measureColdStartCost({ sufficiency: "EVIDENCE_REQUIRED" }).healthy, false);
});

test("assembleBootstrap composes package + gate + outside-scope + cost", () => {
  const pkg = { required: [{ id: "model", retrievalPath: "modelPolicy.mjs", authority: "modelPolicy.mjs" }], onDemand: [], excluded: [], sufficiency: "SUFFICIENT", governingAuthority: "model", provenance: { mapVersion: "1.0.0", sourceCommit: "abc" } };
  const boot = assembleBootstrap({
    entries: ENTRIES, pkg, scope: ["model-routing"],
    currentState: { provenance: { freshness: "CURRENT" }, derived: { readyItemIds: [], ownerGateIds: ["G1"] } },
    sizes: { l0Bytes: 4000, pointerBytes: 2000, l1Bytes: 8000, governingAuthorityBytes: 8000 },
  });
  assert.equal(boot.contract, "EOS-COLD-START/1.0.0");
  assert.equal(boot.authorityFirst.gate, "SATISFIED");
  assert.equal(boot.coldStartContextCost.staleRetrievals, 0);
  assert.deepEqual(boot.currentState.ownerGateIds, ["G1"]);
});

test("assembleBootstrap projection carries the DERIVED selector interpretation (terminal-CHECKPOINT visibility)", () => {
  const pkg = { required: [], onDemand: [], excluded: [], sufficiency: "SUFFICIENT", governingAuthority: null, provenance: { mapVersion: "1.0.0", sourceCommit: "abc" } };
  const boot = assembleBootstrap({
    entries: ENTRIES, pkg, scope: ["orchestration"],
    currentState: {
      provenance: { freshness: "CURRENT" },
      derived: { readyItemIds: [], ownerGateIds: ["G1"], protectedActionIds: [], activeAssignmentIds: [] },
      selectorState: "CHECKPOINT",
      terminalCheckpoint: true,
      selectorHint: "No authorized READY work — the selector reached a legitimate terminal CHECKPOINT; ... do not manufacture autonomous work.",
    },
    sizes: { l0Bytes: 4000, pointerBytes: 2000, l1Bytes: 0, governingAuthorityBytes: 0 },
  });
  assert.equal(boot.currentState.selectorState, "CHECKPOINT");
  assert.equal(boot.currentState.terminalCheckpoint, true);
  assert.match(boot.currentState.selectorHint, /do not manufacture autonomous work/i);
});
