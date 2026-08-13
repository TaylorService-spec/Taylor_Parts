// Runtime wiring test — proves the intake EXECUTION runtime routes a decomposed PARENT intake through the live
// governed multi-child mission: decompose → run each child via the SAME guarded worker path → consolidate +
// reconcile → ONE REVIEW_READY parent result. Injected fakes only (no model, no key, $0). This is the live
// counterpart to governedRuntime.test.mjs (pure driver) — it exercises executeIntakeItem's real I/O branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { intakeDigest } from "../lib/workIntake.mjs";
import { executeIntakeItem } from "./intake-runtime.mjs";
import { statusLocation, reviewReadyLocation } from "../lib/intakeStatus.mjs";

const NOW = "2026-08-13T08:00:00Z";

function parentSubmission(childSpecs) {
  const payload = {
    requestId: "EOS-RT-PARENT",
    title: "governed 2-agent acceptance",
    intent: "verify governed execution + findings closed loop as one integrated system",
    scope: ["docs/orchestration", "functions"],
    contextScope: ["orchestration"],
    source: { producer: "Owner", provenance: "test" },
    status: "EXECUTION_AUTHORIZED",
    authority: { authorizationState: "AUTHORIZED", basis: "owner authorized once", authorizedExecutionProfile: "READ_ONLY_ANALYSIS", protectedBoundary: null },
    decomposition: { childSpecs },
    artifactLocation: "docs/orchestration/work-intake/EOS-RT-PARENT.work.json",
    createdAt: "2026-08-13T07:00:00Z", updatedAt: "2026-08-13T07:00:00Z", relatedRefs: { issues: [], pullRequests: [] },
  };
  return { ...payload, sha256: intakeDigest(payload) };
}

const SPECS = [
  { requestId: "EOS-RT-PARENT-A", title: "execution acceptance", intent: "verify execution", scope: ["docs/orchestration"], sector: "execution" },
  { requestId: "EOS-RT-PARENT-B", title: "findings acceptance", intent: "verify closed loop", scope: ["docs/orchestration"], sector: "findings" },
];

// A worker that emits a DISTINCT valid eos-findings block per child call (so surfaced findings are countable).
const findingWorker = () => { let n = 0; return { run: () => { n += 1; const body = `PASS — verified sector ${n}.\n\`\`\`eos-findings\n[{"file":"docs/orchestration/lib/x.mjs","symbol":"fn","discriminator":"note-${n}","severity":"LOW","category":"c","evidence":"e"}]\n\`\`\``; return { stdout: JSON.stringify({ result: body, total_cost_usd: 0 }), exitCode: 0, timedOut: false }; } }; };
const fakeLease = () => { let held = false; return { acquire: () => (!held ? (held = true, { acquired: true }) : { acquired: false }), release: () => { held = false; } }; };
const ctxPkgFn = () => ({ sufficiency: "SUFFICIENT", governingAuthority: "auth", required: [{ id: "auth", retrievalPath: "x.md" }], onDemand: [], provenance: { mapVersion: "1.0.0", sourceCommit: "abc" } });
const FREE_SLOT = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", providerCapacityUsage: { concurrency: { used: 0, limit: 1 } }, budgetRemainingUsd: 5, sourceFreshness: "CURRENT" };

function drive(parent, childSpecs, worker = findingWorker()) {
  const bytes = Buffer.from(JSON.stringify(parent), "utf8");
  const written = new Map();
  const out = executeIntakeItem({
    requestId: parent.requestId, location: parent.artifactLocation, sha256: parent.sha256,
    deps: {
      readFile: () => bytes, readStatus: () => null, readRegister: () => [],
      write: (loc, text) => (written.set(loc, text), loc),
      processRunner: worker, lease: fakeLease(), contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT, now: NOW, capabilityBroker: null,
    },
  });
  return { out, written };
}

test("LIVE PARENT: decompose → run 2 constrained children → consolidate + reconcile → COMPLETE + ONE parent REVIEW_READY", () => {
  const { out, written } = drive(parentSubmission(SPECS), SPECS);
  assert.equal(out.disposition, "COMPLETE");
  assert.equal(out.children, 2, "exactly the 2 governed children ran");

  // The parent's status is COMPLETE and its REVIEW_READY signal is written (the ONE ChatGPT signal).
  assert.ok(written.has(statusLocation("EOS-RT-PARENT")), "parent status written");
  assert.ok(written.has(reviewReadyLocation("EOS-RT-PARENT")), "parent REVIEW_READY written");
  assert.equal(JSON.parse(written.get(statusLocation("EOS-RT-PARENT"))).state, "COMPLETE");

  // Children's own work.json + status were landed durably; children did NOT emit their own REVIEW_READY.
  assert.ok(written.has("docs/orchestration/work-intake/EOS-RT-PARENT-A.work.json"), "child A work item landed");
  assert.ok(written.has("docs/orchestration/work-intake/EOS-RT-PARENT-B.work.json"), "child B work item landed");
  assert.ok(written.has(statusLocation("EOS-RT-PARENT-A")) && written.has(statusLocation("EOS-RT-PARENT-B")), "child statuses landed");
  assert.ok(!written.has(reviewReadyLocation("EOS-RT-PARENT-A")) && !written.has(reviewReadyLocation("EOS-RT-PARENT-B")), "children do NOT emit their own REVIEW_READY");

  // Children inherited the constrained parent profile — never widened.
  const childA = JSON.parse(written.get("docs/orchestration/work-intake/EOS-RT-PARENT-A.work.json"));
  assert.equal(childA.authority.authorizedExecutionProfile, "READ_ONLY_ANALYSIS");
  assert.equal(childA.status, "EXECUTION_AUTHORIZED");

  // The consolidated result content is the reconciled object; both children's findings surfaced.
  const parentStatus = JSON.parse(written.get(statusLocation("EOS-RT-PARENT")));
  const contentPath = [...written.keys()].find((k) => k.startsWith("docs/orchestration/work-intake/results/EOS-RT-PARENT/") && k.endsWith(".content.md"));
  assert.ok(contentPath, "parent content-addressed result written");
  const reconciled = JSON.parse(written.get(contentPath));
  assert.equal(reconciled.reconciled.surfaced.length, 2, "two genuinely-new findings surfaced against an empty register");
  assert.ok(parentStatus.result, "parent status carries a resultRef");
});

test("LIVE PARENT fail-closed: a child that would widen authority REJECTs the whole mission — no partial result", () => {
  const { out, written } = drive(
    parentSubmission([{ requestId: "EOS-RT-PARENT-X", scope: ["functions/src/secret"], profile: "PATCH_PRODUCER", sector: "execution" }]),
    null,
  );
  assert.equal(out.disposition, "FAILED");
  assert.ok(!written.has(reviewReadyLocation("EOS-RT-PARENT")), "no REVIEW_READY on a rejected mission");
  assert.equal(JSON.parse(written.get(statusLocation("EOS-RT-PARENT"))).state, "FAILED");
});

test("LIVE PARENT fail-closed: a child emitting NO eos-findings block BLOCKS the parent (no 1/2 partial COMPLETE)", () => {
  // A worker that returns no findings block at all → extraction failure on that child → parent blocked.
  const noBlockWorker = { run: () => ({ stdout: JSON.stringify({ result: "did stuff, forgot the block", total_cost_usd: 0 }), exitCode: 0, timedOut: false }) };
  const { out, written } = drive(parentSubmission(SPECS), SPECS, noBlockWorker);
  assert.equal(out.disposition, "BLOCKED_EXECUTION");
  assert.ok(!written.has(reviewReadyLocation("EOS-RT-PARENT")), "no REVIEW_READY when consolidation is blocked");
});
