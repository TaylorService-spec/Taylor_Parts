// Live governed-runtime driver tests — prove the single-pass parent mission runner decomposes into the EXACT
// constrained child set, runs each child through the injected runner, and consolidates+reconciles into ONE
// REVIEW_READY parent result — fail-closed at every seam. This is the #864-shaped acceptance, exercised with a
// fake child runner (the real one wires runIntakeExecution + durable landing in intake-runtime.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runGovernedParentMission, toExecutableChildArtifact } from "./governedRuntime.mjs";
import { intakeDigest, resolveWorkIntake } from "./workIntake.mjs";
import { planParentExecution } from "./governedOrchestration.mjs";

// A resolved parent intake shaped like #864: READ_ONLY_ANALYSIS grant, concrete read scope, 2 declared children.
function parent(childSpecs, over = {}) {
  const payload = {
    requestId: "EOS-ACCEPT-864",
    title: "governed 2-agent acceptance",
    intent: "verify governed execution + findings closed loop as one integrated system",
    scope: ["docs/orchestration", "functions", "field-ops-app-vite"],
    contextScope: ["orchestration"],
    source: { producer: "Owner", provenance: "test" },
    status: "EXECUTION_AUTHORIZED",
    authority: { authorizationState: "AUTHORIZED", basis: "owner authorized once", authorizedExecutionProfile: "READ_ONLY_ANALYSIS", protectedBoundary: null },
    decomposition: { childSpecs },
    artifactLocation: "docs/orchestration/work-intake/EOS-ACCEPT-864.work.json",
    createdAt: "2026-08-13T05:00:00Z", updatedAt: "2026-08-13T05:00:00Z", relatedRefs: { issues: [], pullRequests: [] },
    ...over,
  };
  const a = { ...payload, sha256: intakeDigest(payload) };
  return resolveWorkIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes: Buffer.from(JSON.stringify(a), "utf8") });
}

const SPECS = [
  { requestId: "EOS-ACCEPT-864-A", title: "governed execution acceptance", intent: "verify execution stack", scope: ["docs/orchestration"], sector: "execution" },
  { requestId: "EOS-ACCEPT-864-B", title: "findings closed-loop acceptance", intent: "verify closed loop", scope: ["docs/orchestration"], sector: "findings" },
];

// A worker result carrying a valid eos-findings block (what a real child emits).
const okResult = (disc) => `PASS\n\`\`\`eos-findings\n[{"file":"docs/orchestration/lib/x.mjs","symbol":"fn","discriminator":"${disc}","severity":"LOW","category":"note","evidence":"seen"}]\n\`\`\``;
// A batch runner that COMPLETEs + durably lands every child (the happy path), recording call order.
const cleanBatch = (order = []) => async (childItems, childSpecs) => childItems.map((ci) => {
  order.push(ci.requestId);
  const spec = childSpecs.find((s) => s.requestId === ci.requestId);
  return { requestId: ci.requestId, disposition: "COMPLETE", durable: true, sector: spec.sector, content: okResult(`${spec.sector}-note`) };
});

test("COMPLETE: 2/2 constrained children run + land durably → consolidate + reconcile → REVIEW_READY parent result", async () => {
  const seen = [];
  const out = await runGovernedParentMission({
    parentArtifact: parent(SPECS),
    register: [],
    runChildren: async (childItems, childSpecs) => childItems.map((ci) => { seen.push({ id: ci.requestId, profile: ci.authority.profile }); const spec = childSpecs.find((s) => s.requestId === ci.requestId); return { requestId: ci.requestId, disposition: "COMPLETE", durable: true, sector: spec.sector, content: okResult(`${spec.sector}-note`) }; },
    ),
  });
  assert.equal(out.action, "COMPLETE");
  assert.equal(out.parentStatus, "COMPLETE");
  assert.equal(out.childRuns.length, 2);
  assert.equal(out.reconciled.reconciled.surfaced.length, 2, "two genuinely-new findings surface against an empty register");
  assert.ok(seen.every((r) => r.profile === "READ_ONLY_ANALYSIS"), "children inherit the constrained READ_ONLY_ANALYSIS grant");
});

test("REJECT (fail-closed): a child that would widen authority aborts the WHOLE mission — the batch never runs", async () => {
  let ran = 0;
  const out = await runGovernedParentMission({
    parentArtifact: parent([{ requestId: "EOS-ACCEPT-864-X", scope: ["functions/src/secret"], profile: "PATCH_PRODUCER", sector: "execution" }]),
    runChildren: async () => { ran += 1; return []; },
  });
  assert.equal(out.action, "REJECT");
  assert.equal(ran, 0, "no child batch executes when decomposition rejects");
});

test("BLOCKED (fail-closed): a child that emits NO valid eos-findings block blocks parent COMPLETE (no partial 1/2)", async () => {
  const out = await runGovernedParentMission({
    parentArtifact: parent(SPECS),
    runChildren: async (childItems, childSpecs) => childItems.map((ci) => { const spec = childSpecs.find((s) => s.requestId === ci.requestId); return { requestId: ci.requestId, disposition: "COMPLETE", durable: true, sector: spec.sector, content: spec.sector === "findings" ? "no eos-findings block here" : okResult("exec-note") }; }),
  });
  assert.equal(out.action, "BLOCKED");
  assert.equal(out.reconciled, null, "no consolidated result on a blocked mission");
});

test("DURABILITY fail-closed: a child that COMPLETED but did NOT land durably cannot complete the parent", async () => {
  const out = await runGovernedParentMission({
    parentArtifact: parent(SPECS),
    runChildren: async (childItems, childSpecs) => childItems.map((ci) => { const spec = childSpecs.find((s) => s.requestId === ci.requestId); return { requestId: ci.requestId, disposition: "COMPLETE", durable: spec.sector !== "findings", sector: spec.sector, content: okResult(`${spec.sector}-note`) }; }),
  });
  assert.notEqual(out.action, "COMPLETE", "a completed-but-not-durable child must not complete the parent");
  assert.equal(out.childRuns.find((r) => r.sector === "findings").durable, false);
});

test("REGISTER fail-closed: a non-array register (unreadable/malformed durable memory) blocks the mission", async () => {
  const out = await runGovernedParentMission({ parentArtifact: parent(SPECS), register: null, runChildren: async () => { throw new Error("must not run"); } });
  assert.equal(out.action, "BLOCKED");
  assert.match(out.final.reason, /register unavailable\/malformed/);
});

test("register memory: an already-known finding is suppressed; only the genuinely-new one surfaces", async () => {
  const out = await runGovernedParentMission({
    parentArtifact: parent(SPECS),
    register: [{ file: "docs/orchestration/lib/x.mjs", symbol: "fn", discriminator: "execution-note", status: "CONFIRMED_OPEN" }],
    runChildren: cleanBatch(),
  });
  assert.equal(out.action, "COMPLETE");
  assert.deepEqual(out.reconciled.reconciled.surfaced.map((f) => f.discriminator), ["findings-note"]);
  assert.equal(out.reconciled.reconciled.alreadyOpen.length, 1);
});

// ── toExecutableChildArtifact: the decomposed child → runnable intake bridge ──────────────────────────────
test("toExecutableChildArtifact promotes the inherited profile and attaches the execution contract (resolvable, hash-verified)", () => {
  const decompose = planParentExecution({ parent: { workId: "EOS-ACCEPT-864", profile: "READ_ONLY_ANALYSIS", scope: ["docs/orchestration"], contextScope: ["orchestration"], budgetUsd: 0, capabilities: [], protectedBoundary: null }, childSpecs: SPECS, childStates: [] });
  assert.equal(decompose.action, "DECOMPOSE");
  const childItem = decompose.children[0];
  const artifact = toExecutableChildArtifact(childItem, { taskClass: "READ_ONLY_VERIFY" });
  assert.equal(artifact.requestId, "EOS-ACCEPT-864-A");
  assert.equal(artifact.authority.authorizedExecutionProfile, "READ_ONLY_ANALYSIS", "inherited grant promoted verbatim — never widened");
  assert.equal(artifact.execution.taskClass, "READ_ONLY_VERIFY", "the child's requested task class is attached");
  assert.equal(artifact.status, "EXECUTION_AUTHORIZED");
  // sha256 is self-consistent (resolveWorkIntake would have thrown otherwise)
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
});

test("toExecutableChildArtifact never raises the grant above the inherited profile", () => {
  const decompose = planParentExecution({ parent: { workId: "P", profile: "READ_ONLY_ANALYSIS", scope: ["docs/orchestration"], contextScope: ["orchestration"], budgetUsd: 0, capabilities: [], protectedBoundary: null }, childSpecs: [SPECS[0]], childStates: [] });
  const artifact = toExecutableChildArtifact(decompose.children[0], { taskClass: "PATCH_PRODUCER" });
  // Even if the child's execution block requests PATCH_PRODUCER, the GRANT stays the inherited READ_ONLY_ANALYSIS.
  assert.equal(artifact.authority.authorizedExecutionProfile, "READ_ONLY_ANALYSIS");
});
