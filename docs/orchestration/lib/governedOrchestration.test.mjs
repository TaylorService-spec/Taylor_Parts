import { test } from "node:test";
import assert from "node:assert/strict";
import { planParentExecution } from "./governedOrchestration.mjs";

// A parent approved once: READ_ONLY_ANALYSIS over a bounded scope (the #864-shaped acceptance mission).
const PARENT = Object.freeze({
  workId: "EOS-ACCEPT-864", profile: "READ_ONLY_ANALYSIS",
  scope: ["docs/orchestration", "functions", "field-ops-app-vite"], contextScope: ["orchestration"],
  budgetUsd: 0, capabilities: [], protectedBoundary: null,
});
const SPECS = [
  { requestId: "EOS-ACCEPT-864-A", title: "governed execution acceptance", intent: "verify execution stack", scope: ["docs/orchestration"], sector: "execution" },
  { requestId: "EOS-ACCEPT-864-B", title: "findings closed-loop acceptance", intent: "verify closed loop", scope: ["docs/orchestration"], sector: "findings" },
];
// a worker result with a valid eos-findings block
const okResult = (disc) => `PASS\n\`\`\`eos-findings\n[{"file":"docs/orchestration/lib/x.mjs","symbol":"fn","discriminator":"${disc}","severity":"LOW","category":"note","evidence":"seen"}]\n\`\`\``;

test("step 1 — DECOMPOSE: no children yet → constrained child work items are emitted", () => {
  const out = planParentExecution({ parent: PARENT, childSpecs: SPECS, childStates: [] });
  assert.equal(out.action, "DECOMPOSE");
  assert.equal(out.children.length, 2);
  assert.ok(out.children.every((c) => c.status === "EXECUTION_AUTHORIZED" && c.authority.parentRef === "EOS-ACCEPT-864"));
  assert.ok(out.children.every((c) => c.authority.profile === "READ_ONLY_ANALYSIS"), "children inherit the constrained profile");
});

test("REJECT: a child that would widen authority fails the decomposition (fail closed)", () => {
  const out = planParentExecution({
    parent: PARENT,
    childSpecs: [{ requestId: "EOS-ACCEPT-864-X", scope: ["functions/src/secret"], profile: "PATCH_PRODUCER" }], // escalates
    childStates: [],
  });
  assert.equal(out.action, "REJECT");
  assert.ok(out.rejected?.length || out.reason);
});

test("step 2 — AWAIT: children emitted but not all COMPLETE → parent cannot complete on a partial set", () => {
  const out = planParentExecution({
    parent: PARENT, childSpecs: SPECS,
    childStates: [{ requestId: "EOS-ACCEPT-864-A", status: "COMPLETE" }, { requestId: "EOS-ACCEPT-864-B", status: "RUNNING" }],
  });
  assert.equal(out.action, "AWAIT");
  assert.deepEqual(out.pending, ["EOS-ACCEPT-864-B"]);
});

test("step 3 — COMPLETE: exactly the expected set complete → consolidate + reconcile, REVIEW_READY", () => {
  const out = planParentExecution({
    parent: PARENT, childSpecs: SPECS,
    childStates: [{ requestId: "EOS-ACCEPT-864-A", status: "COMPLETE" }, { requestId: "EOS-ACCEPT-864-B", status: "COMPLETE" }],
    childResults: [
      { requestId: "EOS-ACCEPT-864-A", disposition: "COMPLETE", sector: "execution", content: okResult("exec-note") },
      { requestId: "EOS-ACCEPT-864-B", disposition: "COMPLETE", sector: "findings", content: okResult("findings-note") },
    ],
    register: [],
  });
  assert.equal(out.action, "COMPLETE");
  assert.equal(out.reviewReady, true);
  assert.equal(out.reconciled.ok, true);
  assert.equal(out.reconciled.reconciled.surfaced.length, 2, "two genuinely-new findings surface (empty register)");
});

test("BLOCKED: a child whose worker emitted NO valid eos-findings block blocks parent COMPLETE (no partial)", () => {
  const out = planParentExecution({
    parent: PARENT, childSpecs: SPECS,
    childStates: [{ requestId: "EOS-ACCEPT-864-A", status: "COMPLETE" }, { requestId: "EOS-ACCEPT-864-B", status: "COMPLETE" }],
    childResults: [
      { requestId: "EOS-ACCEPT-864-A", disposition: "COMPLETE", sector: "execution", content: okResult("exec-note") },
      { requestId: "EOS-ACCEPT-864-B", disposition: "COMPLETE", sector: "findings", content: "no eos-findings block at all" }, // extraction failure
    ],
    register: [],
  });
  assert.equal(out.action, "BLOCKED", "extraction failure blocks the parent gate, never a partial 1/2 pass");
  assert.deepEqual(out.detail.incomplete, ["EOS-ACCEPT-864-B"]);
});

test("register memory applies: an already-known finding is suppressed, only the new one surfaces", () => {
  const out = planParentExecution({
    parent: PARENT, childSpecs: SPECS,
    childStates: SPECS.map((s) => ({ requestId: s.requestId, status: "COMPLETE" })),
    childResults: [
      { requestId: "EOS-ACCEPT-864-A", disposition: "COMPLETE", sector: "execution", content: okResult("known-issue") },
      { requestId: "EOS-ACCEPT-864-B", disposition: "COMPLETE", sector: "findings", content: okResult("brand-new") },
    ],
    register: [{ file: "docs/orchestration/lib/x.mjs", symbol: "fn", discriminator: "known-issue", status: "CONFIRMED_OPEN" }],
  });
  assert.equal(out.action, "COMPLETE");
  assert.deepEqual(out.reconciled.reconciled.surfaced.map((f) => f.discriminator), ["brand-new"]);
  assert.equal(out.reconciled.reconciled.alreadyOpen.length, 1);
});

import { orchestrateParent, parentGrantFromArtifact, childSpecsFromArtifact } from "./governedOrchestration.mjs";

test("parentGrantFromArtifact + childSpecsFromArtifact read the structured parent work item", () => {
  const artifact = {
    requestId: "EOS-ACCEPT-864",
    authority: { authorizedExecutionProfile: "READ_ONLY_ANALYSIS", protectedBoundary: null },
    scope: ["docs/orchestration"], contextScope: ["orchestration"],
    decomposition: { childSpecs: [{ requestId: "EOS-ACCEPT-864-A", scope: ["docs/orchestration"] }] },
  };
  const grant = parentGrantFromArtifact(artifact);
  assert.equal(grant.workId, "EOS-ACCEPT-864");
  assert.equal(grant.profile, "READ_ONLY_ANALYSIS");
  assert.equal(childSpecsFromArtifact(artifact).length, 1);
});

test("orchestrateParent lifecycle: DECOMPOSE → AWAIT → COMPLETE, via injected I/O", () => {
  const emitted = [];
  const writeParentResult = (x) => { writeParentResult.called = x; return "docs/orchestration/work-intake/results/EOS-ACCEPT-864/..."; };
  const okResult = (disc) => `PASS\n\`\`\`eos-findings\n[{"file":"docs/orchestration/x.mjs","symbol":"fn","discriminator":"${disc}","severity":"LOW","category":"n","evidence":"e"}]\n\`\`\``;

  // Step 1: nothing emitted → DECOMPOSE (emitChild called per child)
  let out = orchestrateParent({ parent: PARENT, childSpecs: SPECS, deps: { readChildStates: () => [], emitChild: (c) => (emitted.push(c.requestId), c.artifactLocation) } });
  assert.equal(out.action, "DECOMPOSE");
  assert.equal(out.parentStatus, "AWAITING_CHILDREN");
  assert.deepEqual(emitted, ["EOS-ACCEPT-864-A", "EOS-ACCEPT-864-B"]);

  // Step 2: children exist, one still running → AWAIT
  out = orchestrateParent({ parent: PARENT, childSpecs: SPECS, deps: { readChildStates: () => [{ requestId: "EOS-ACCEPT-864-A", status: "COMPLETE" }, { requestId: "EOS-ACCEPT-864-B", status: "RUNNING" }] } });
  assert.equal(out.action, "AWAIT");
  assert.deepEqual(out.pending, ["EOS-ACCEPT-864-B"]);

  // Step 3: both COMPLETE → COMPLETE, parent result written, REVIEW_READY
  out = orchestrateParent({
    parent: PARENT, childSpecs: SPECS,
    deps: {
      readChildStates: () => SPECS.map((s) => ({ requestId: s.requestId, status: "COMPLETE" })),
      readChildResults: () => [
        { requestId: "EOS-ACCEPT-864-A", disposition: "COMPLETE", sector: "execution", content: okResult("a-note") },
        { requestId: "EOS-ACCEPT-864-B", disposition: "COMPLETE", sector: "findings", content: okResult("b-note") },
      ],
      readRegister: () => [],
      writeParentResult,
    },
  });
  assert.equal(out.action, "COMPLETE");
  assert.equal(out.parentStatus, "COMPLETE");
  assert.equal(out.reviewReady, true);
  assert.ok(writeParentResult.called, "the consolidated parent result was written");
});

test("orchestrateParent BLOCKED: a child with no valid eos-findings never lets the parent complete (no partial)", () => {
  let wrote = false;
  const out = orchestrateParent({
    parent: PARENT, childSpecs: SPECS,
    deps: {
      readChildStates: () => SPECS.map((s) => ({ requestId: s.requestId, status: "COMPLETE" })),
      readChildResults: () => [
        { requestId: "EOS-ACCEPT-864-A", disposition: "COMPLETE", sector: "execution", content: "```eos-findings\n[]\n```" },
        { requestId: "EOS-ACCEPT-864-B", disposition: "COMPLETE", sector: "findings", content: "no block" },
      ],
      readRegister: () => [],
      writeParentResult: () => (wrote = true),
    },
  });
  assert.equal(out.action, "BLOCKED");
  assert.equal(out.parentStatus, "BLOCKED_INCOMPLETE");
  assert.equal(wrote, false, "parent result is NOT written on a blocked gate");
});

test("SET EQUALITY: expected [A,B] but results include an UNEXPECTED X → BLOCKED, never COMPLETE, X cannot influence", () => {
  const okResult = (disc, sev) => `PASS\n\`\`\`eos-findings\n[{"file":"docs/orchestration/x.mjs","symbol":"fn","discriminator":"${disc}","severity":"${sev}","category":"n","evidence":"e"}]\n\`\`\``;
  const plan = planParentExecution({
    parent: PARENT, childSpecs: SPECS,
    childStates: [{ requestId: "EOS-ACCEPT-864-A", status: "COMPLETE" }, { requestId: "EOS-ACCEPT-864-B", status: "COMPLETE" }, { requestId: "EOS-ACCEPT-864-X", status: "COMPLETE" }],
    childResults: [
      { requestId: "EOS-ACCEPT-864-A", disposition: "COMPLETE", sector: "execution", content: okResult("a-note", "LOW") },
      { requestId: "EOS-ACCEPT-864-B", disposition: "COMPLETE", sector: "findings", content: okResult("b-note", "LOW") },
      { requestId: "EOS-ACCEPT-864-X", disposition: "COMPLETE", sector: "rogue", content: okResult("rogue-critical", "CRITICAL") },
    ],
    register: [],
  });
  assert.equal(plan.action, "BLOCKED", "an unexpected child blocks the parent gate");
  assert.deepEqual(plan.detail.unexpected, ["EOS-ACCEPT-864-X"]);
  assert.equal(plan.reconciled, undefined, "no consolidated/reconciled report — the rogue finding cannot influence it");

  // orchestrateParent: parent NOT written, status blocked
  let wrote = false;
  const out = orchestrateParent({
    parent: PARENT, childSpecs: SPECS,
    deps: {
      readChildStates: () => [{ requestId: "EOS-ACCEPT-864-A", status: "COMPLETE" }, { requestId: "EOS-ACCEPT-864-B", status: "COMPLETE" }, { requestId: "EOS-ACCEPT-864-X", status: "COMPLETE" }],
      readChildResults: () => [
        { requestId: "EOS-ACCEPT-864-A", disposition: "COMPLETE", sector: "execution", content: okResult("a", "LOW") },
        { requestId: "EOS-ACCEPT-864-B", disposition: "COMPLETE", sector: "findings", content: okResult("b", "LOW") },
        { requestId: "EOS-ACCEPT-864-X", disposition: "COMPLETE", sector: "rogue", content: okResult("x", "CRITICAL") },
      ],
      readRegister: () => [], writeParentResult: () => (wrote = true),
    },
  });
  assert.equal(out.action, "BLOCKED");
  assert.equal(wrote, false, "no parent result written while an unexpected child is present");
});
