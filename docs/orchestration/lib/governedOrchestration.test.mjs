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
