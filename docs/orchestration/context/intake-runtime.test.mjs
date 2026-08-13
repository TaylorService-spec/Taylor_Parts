// Runtime wiring test — proves the intake EXECUTION runtime runs a decomposed PARENT as the live governed
// multi-child mission ROUTED THROUGH THE CONCURRENT WRITE RUNNER: decompose → run the child set (read-only /
// shared-scope children run alone; the runner is the same tested concurrency primitive) → EACH child landed
// durably on completion (injected landChild) → consolidate + reconcile → ONE REVIEW_READY parent result.
// Injected fakes only (no model, no key, no git, $0). Live counterpart to governedRuntime.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { intakeDigest, resolveWorkIntake } from "../lib/workIntake.mjs";
import { executeParentMission, loadRegister } from "./intake-runtime.mjs";
import { statusLocation, reviewReadyLocation } from "../lib/intakeStatus.mjs";

const NOW = "2026-08-13T08:00:00Z";

function parent(childSpecs) {
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
  const a = { ...payload, sha256: intakeDigest(payload) };
  return resolveWorkIntake({ requestId: a.requestId, location: a.artifactLocation, sha256: a.sha256, bytes: Buffer.from(JSON.stringify(a), "utf8") });
}

const SPECS = [
  { requestId: "EOS-RT-PARENT-A", title: "execution acceptance", intent: "verify execution", scope: ["docs/orchestration"], sector: "execution" },
  { requestId: "EOS-RT-PARENT-B", title: "findings acceptance", intent: "verify closed loop", scope: ["docs/orchestration"], sector: "findings" },
];

// A worker emitting a DISTINCT valid eos-findings block per child call (so surfaced findings are countable).
const findingWorker = () => { let n = 0; return { run: () => { n += 1; const body = `PASS — sector ${n}.\n\`\`\`eos-findings\n[{"file":"docs/orchestration/lib/x.mjs","symbol":"fn","discriminator":"note-${n}","severity":"LOW","category":"c","evidence":"e"}]\n\`\`\``; return { stdout: JSON.stringify({ result: body, total_cost_usd: 0 }), exitCode: 0, timedOut: false }; } }; };
const ctxPkgFn = () => ({ sufficiency: "SUFFICIENT", governingAuthority: "auth", required: [{ id: "auth", retrievalPath: "x.md" }], onDemand: [], provenance: { mapVersion: "1.0.0", sourceCommit: "abc" } });
const FREE_SLOT = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", providerCapacityUsage: { concurrency: { used: 0, limit: 1 } }, budgetRemainingUsd: 5, sourceFreshness: "CURRENT" };
const noopClaim = () => ({ acquire: () => ({ acquired: true }), release: () => {} });

function drive(p, { worker = findingWorker(), register = { ok: true, register: [] }, land, maxConcurrency = 4 } = {}) {
  const written = new Map();
  const landed = [];
  const landChild = land || ((rid) => (landed.push(rid), { landed: true }));
  return executeParentMission({
    artifact: p, requestId: p.requestId, now: NOW,
    write: (loc, text) => (written.set(loc, text), loc),
    deps: {
      readRegister: () => register, landChild, makeClaim: noopClaim, maxConcurrency,
      processRunner: worker, contextPackageFn: ctxPkgFn, wakeCtx: FREE_SLOT, capabilityBroker: null,
    },
  }).then((out) => ({ out, written, landed }));
}

test("LIVE PARENT via concurrent runner: 2 children run + land durably → COMPLETE + ONE parent REVIEW_READY", async () => {
  const { out, written, landed } = await drive(parent(SPECS));
  assert.equal(out.disposition, "COMPLETE");
  assert.equal(out.children, 2, "exactly the 2 governed children ran");

  // Each child was landed durably (injected landChild called per child) BEFORE the parent completed.
  assert.deepEqual(landed.sort(), ["EOS-RT-PARENT-A", "EOS-RT-PARENT-B"], "every child landed durably on completion");

  // The parent's status is COMPLETE and its REVIEW_READY signal is written (the ONE ChatGPT signal).
  assert.ok(written.has(statusLocation("EOS-RT-PARENT")), "parent status written");
  assert.ok(written.has(reviewReadyLocation("EOS-RT-PARENT")), "parent REVIEW_READY written");
  assert.equal(JSON.parse(written.get(statusLocation("EOS-RT-PARENT"))).state, "COMPLETE");

  // Children did NOT emit their own REVIEW_READY (only the consolidated parent does).
  assert.ok(!written.has(reviewReadyLocation("EOS-RT-PARENT-A")) && !written.has(reviewReadyLocation("EOS-RT-PARENT-B")), "children do NOT emit their own REVIEW_READY");

  // The consolidated result content is the reconciled object; both children's findings surfaced.
  const contentPath = [...written.keys()].find((k) => k.startsWith("docs/orchestration/work-intake/results/EOS-RT-PARENT/") && k.endsWith(".content.md"));
  assert.ok(contentPath, "parent content-addressed result written");
  const reconciled = JSON.parse(written.get(contentPath));
  assert.equal(reconciled.reconciled.surfaced.length, 2, "two genuinely-new findings surfaced against an empty register");
});

test("DURABILITY ordering: each completed child LANDS before the next child's worker starts (sequential waves)", async () => {
  // Shared-scope read-only children run in separate concurrent-runner waves. A single interleaving log proves
  // the exact property ChatGPT flagged: Child A is durable on main BEFORE Child B's worker runs — never
  // work,work,land,land (which would strand A if B crashed), but work,land,work,land.
  const log = [];
  let n = 0;
  const worker = { run: () => { n += 1; log.push(`work${n}`); const body = `PASS\n\`\`\`eos-findings\n[{"file":"docs/orchestration/lib/x.mjs","symbol":"fn","discriminator":"d-${n}","severity":"LOW","category":"c","evidence":"e"}]\n\`\`\``; return { stdout: JSON.stringify({ result: body, total_cost_usd: 0 }), exitCode: 0, timedOut: false }; } };
  const land = (rid) => { log.push(`land:${rid}`); return { landed: true }; };
  const { out } = await drive(parent(SPECS), { worker, land, maxConcurrency: 4 });
  assert.equal(out.disposition, "COMPLETE");
  // The land event for the first child must precede the work event of the second child.
  const firstLand = log.findIndex((e) => e.startsWith("land:"));
  const secondWork = log.indexOf("work2");
  assert.ok(firstLand !== -1 && secondWork !== -1 && firstLand < secondWork, `expected a land before work2; got ${log.join(",")}`);
});

test("DURABILITY fail-closed: a child that COMPLETED but failed to LAND does not complete the parent", async () => {
  // landChild reports the second child failed to land → that child is NOT durable → parent cannot COMPLETE.
  let n = 0;
  const land = (rid) => { n += 1; return { landed: n === 1 }; }; // first lands, second fails
  const { out, written } = await drive(parent(SPECS), { land, maxConcurrency: 1 });
  assert.notEqual(out.disposition, "COMPLETE", "a child that did not land durably blocks the parent");
  assert.ok(!written.has(reviewReadyLocation("EOS-RT-PARENT")), "no REVIEW_READY when a child is not durable");
});

test("REGISTER fail-closed: a missing/malformed durable register BLOCKS the mission before any child runs", async () => {
  let ranWorker = false;
  const worker = { run: () => { ranWorker = true; return { stdout: "{}", exitCode: 0, timedOut: false }; } };
  const { out } = await drive(parent(SPECS), { worker, register: { ok: false, reason: "register unreadable" } });
  assert.equal(out.disposition, "BLOCKED_EXECUTION");
  assert.equal(ranWorker, false, "no paid worker runs when durable memory is unavailable");
});

test("LIVE PARENT fail-closed: a child that would widen authority REJECTs the whole mission — no partial result", async () => {
  const { out, written, landed } = await drive(parent([{ requestId: "EOS-RT-PARENT-X", scope: ["functions/src/secret"], profile: "PATCH_PRODUCER", sector: "execution" }]));
  assert.equal(out.disposition, "FAILED");
  assert.equal(landed.length, 0, "no child lands when decomposition rejects");
  assert.ok(!written.has(reviewReadyLocation("EOS-RT-PARENT")), "no REVIEW_READY on a rejected mission");
});

test("LIVE PARENT fail-closed: a child emitting NO eos-findings block BLOCKS the parent (no 1/2 partial COMPLETE)", async () => {
  const noBlockWorker = { run: () => ({ stdout: JSON.stringify({ result: "did stuff, forgot the block", total_cost_usd: 0 }), exitCode: 0, timedOut: false }) };
  const { out, written } = await drive(parent(SPECS), { worker: noBlockWorker });
  assert.equal(out.disposition, "BLOCKED_EXECUTION");
  assert.ok(!written.has(reviewReadyLocation("EOS-RT-PARENT")), "no REVIEW_READY when consolidation is blocked");
});

test("loadRegister is fail-closed: valid { entries: [] } / array trusted; missing / malformed / wrong-shape blocked", () => {
  assert.deepEqual(loadRegister({ readFile: () => '{"schema":"eos.findings.register/1","entries":[]}' }), { ok: true, register: [] });
  assert.deepEqual(loadRegister({ readFile: () => '[{"file":"a","discriminator":"d"}]' }).ok, true);
  assert.equal(loadRegister({ readFile: () => { const e = new Error("nope"); e.code = "ENOENT"; throw e; } }).ok, false, "missing register fails closed");
  assert.equal(loadRegister({ readFile: () => "not json{" }).ok, false, "malformed JSON fails closed");
  assert.equal(loadRegister({ readFile: () => '{"foo":1}' }).ok, false, "wrong shape fails closed");
});
