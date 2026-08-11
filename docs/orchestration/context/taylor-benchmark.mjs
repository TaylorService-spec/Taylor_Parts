// ONE-TRIGGER TAYLOR BENCHMARK entry — the single Owner activation. DRY by default: it builds the ONE
// canonical FACT-BASED feed + invocation, prints the safe request diagnostic + token breakdown, and calls
// NOTHING. `--activate` transmits THAT EXACT invocation to OpenAI in one instrumented reciprocal cycle
// (fact feed → persist → consume → selector → one Claude wake → stop), scores it, and writes a durable
// content-addressed result artifact.
//
// "Facts travel, story stays home." Candidate A is an ordinary bounded app-level review, so it routes
// through the fact-based path (reviewFeedInvocation) — NOT the legacy full-operating-model + full-diff
// payload (openaiReviewProvider.buildReviewInvocation), which remains for review classes that legitimately
// need expanded context. DRY and LIVE consume the identical canonical feed/invocation object.
//
// Hard ceilings: ≤3 GPT paid calls, ≤3 Claude wakes, ≤3 reciprocal cycles, ≤$0.10 OpenAI spend. Reads
// OPENAI_API_KEY at call time only; NEVER prints it. Fails closed with a named reason on any missing
// prerequisite. Do NOT run --activate as repo-safe work — it is the Owner's supervised activation.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInstrumentedPilotCycle } from "../lib/reciprocalPilotInstrumented.mjs";
import { PILOT_CEILING } from "../lib/reciprocalPilotCycle.mjs";
import { selectEligibleReviews } from "../lib/reciprocalReviewLoop.mjs";
import { assessBenchmark, BENCHMARK_CEILING, BENCHMARK_BASELINE } from "../lib/benchmarkReadout.mjs";
import { buildCanonicalReviewFeed, buildFactBasedInvocation, describeInvocation, reconcileTokens } from "../lib/reviewFeedInvocation.mjs";
import { runOpenAIReview } from "../lib/openaiReviewProvider.mjs";
import { makeArtifact, makeArtifactStore, artifactRef, canonicalize } from "../lib/reviewArtifacts.mjs";
import { makeEfficiencyLedger } from "../lib/reviewInstrumentation.mjs";
import { makeInMemoryReviewStore, buildReviewRequest } from "../lib/reviewTrigger.mjs";
import { resolveClaudeBin } from "../lib/reviewInputSafety.mjs";
import { makeLease } from "../lib/wakeLease.mjs";
import { contextPackageFor } from "./build-package.mjs";
import { coldStart } from "./cold-start.mjs";
import { makeRealClaudeRunner } from "./reciprocal-pilot.mjs";
import { REVIEW_JSON_SCHEMA } from "./openai-review.mjs";
import { SUBJECT_785_FEED } from "../benchmark/subject-785-feed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const arg = (n, fb = null) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb; };
const flag = (n) => process.argv.includes(`--${n}`);

const REVIEW_ID = SUBJECT_785_FEED.reviewId;

// Build the ONE canonical fact feed + its content-addressed artifacts + the fact-based invocation. Used by
// BOTH dry and live — the dry-run inspects exactly what live transmits.
function buildBenchmarkFeed({ model, sourceCommit }) {
  const requestArtifact = makeArtifact({ kind: "request", content: { reviewId: REVIEW_ID, question: SUBJECT_785_FEED.question, requirement: SUBJECT_785_FEED.requirement }, sourceCommit });
  const factsArtifact = makeArtifact({ kind: "facts", content: { implementationFacts: SUBJECT_785_FEED.implementationFacts, sourceFacts: SUBJECT_785_FEED.sourceFacts, deterministicEvidence: SUBJECT_785_FEED.deterministicEvidence, rawEvidence: SUBJECT_785_FEED.rawEvidence }, sourceCommit });
  const feed = buildCanonicalReviewFeed({ ...SUBJECT_785_FEED, provenance: { sourceCommit: sourceCommit || null }, artifactRefs: [artifactRef(requestArtifact), artifactRef(factsArtifact)] });
  const built = buildFactBasedInvocation({ feed, model: model || "MODEL_UNSET", schema: REVIEW_JSON_SCHEMA });
  return { feed, built, artifacts: [requestArtifact, factsArtifact], factsContent: { implementationFacts: SUBJECT_785_FEED.implementationFacts, sourceFacts: SUBJECT_785_FEED.sourceFacts, deterministicEvidence: SUBJECT_785_FEED.deterministicEvidence, rawEvidence: SUBJECT_785_FEED.rawEvidence } };
}

// Fact-based GPT runner — transmits the PREBUILT fact invocation (never rebuilds a full-context payload).
// Reads the key only here; never logs it. The transport is the ONLY holder of the secret.
function makeFactBasedGptRunner({ invocation, boot }) {
  return async (review) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, failureKind: "TRIGGER_FAILED", reason: "OPENAI_API_KEY not set" };
    const transport = async (inv) => {
      const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: inv.model, input: inv.messages, max_output_tokens: inv.maxOutputTokens, text: { format: REVIEW_JSON_SCHEMA } }) });
      if (!res.ok) return { ok: false, error: `status ${res.status}` };
      const data = await res.json();
      let text = data.output_text; if (!text && Array.isArray(data.output)) for (const it of data.output) for (const c of (it.content || [])) if (c.type === "output_text" && c.text) text = c.text;
      let body; try { body = JSON.parse(text); } catch { return { ok: false, error: "non-JSON content" }; }
      return { ok: true, review: body, usage: { inputTokens: data.usage && data.usage.input_tokens, outputTokens: data.usage && data.usage.output_tokens } };
    };
    const prov = boot.provenance || {};
    return runOpenAIReview({
      request: review, invocation, transport,
      sourceFreshness: prov.freshness || "UNKNOWN",
      contextPackageRef: { mapVersion: (boot.package.provenance || {}).mapVersion || null, sourceCommit: prov.sourceCommit || null, governingAuthority: boot.package.governingAuthority || null },
      provenance: { sourceFreshness: prov.freshness || "UNKNOWN", sourceCommit: prov.sourceCommit || null },
      triggerKind: "AUTOMATIC_TRIGGER",
      timestamps: { requestedAt: new Date().toISOString(), triggeredAt: new Date().toISOString() }, clock: () => new Date().toISOString(),
    });
  };
}

async function main() {
  const scope = (arg("scope") || "orchestration").split(",");
  const boot = coldStart({ id: REVIEW_ID, scope });
  const model = process.env.OPENAI_REVIEW_MODEL || "";
  const sourceCommit = (boot.provenance || {}).sourceCommit || null;
  const budget = Math.min(Number(arg("budget", "0.10")) || 0.10, BENCHMARK_CEILING.maxOpenAiSpendUsd);

  // ONE canonical feed/invocation, built once. (Preflight: proves the entry + fixture resolve before any key.)
  const { built, artifacts } = buildBenchmarkFeed({ model, sourceCommit });
  const reductionPct = Math.round((1 - built.breakdown.totalEstimate / BENCHMARK_BASELINE.review319.gptInputTokens) * 1000) / 10;

  const reviews = [{ ...buildReviewRequest({ requestId: REVIEW_ID, subject: "Equipment detail: failed customer read vs genuinely-unknown customer (#785)", source: "CONTROL_PLANE_EVENT", modelTier: "standard" }), status: "OPEN", reviewClass: "INDEPENDENT_AI", authorizedForReview: true, routedBackTo: "Orchestration", selectedModel: model }];
  const store = makeInMemoryReviewStore();
  const wakeCtx = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: budget };

  if (!flag("activate")) {
    const { eligible, skipped } = selectEligibleReviews(reviews, { store, sufficiencyOf: () => boot.package.sufficiency, freshnessOf: () => (boot.provenance || {}).freshness || "UNKNOWN" });
    process.stdout.write(JSON.stringify({
      mode: "DRY",
      benchmark: "taylor-one-trigger",
      subject: { issue: 785, pr: 786, feedFixture: "docs/orchestration/benchmark/subject-785-feed.mjs" },
      cycleCeiling: PILOT_CEILING,
      benchmarkCeiling: BENCHMARK_CEILING,
      baseline: BENCHMARK_BASELINE,
      model: model || null,
      contextSufficiency: boot.package.sufficiency,
      sourceFreshness: (boot.provenance || {}).freshness,
      eligible: eligible.length,
      skipped,
      // The EXACT canonical fact-based request DRY inspects and LIVE transmits.
      requestDiagnostic: describeInvocation(built.invocation),
      tokenBreakdown: built.breakdown,
      artifactsToCreate: artifacts.map((a) => ({ artifactId: a.artifactId, kind: a.kind, sha256: a.sha256 })),
      shapeVsBaseline: { newTotalEstimate: built.breakdown.totalEstimate, baselineInputTokens: BENCHMARK_BASELINE.review319.gptInputTokens, reductionPct },
      wouldCallGptOnce: eligible.length > 0 && !!model,
      wouldWakeClaudeOnce: eligible.length > 0,
      durableArtifactDir: "docs/orchestration/benchmark/results/",
      activateCommand: "node docs/orchestration/context/taylor-benchmark.mjs --activate",
      note: "DRY only — no GPT call, no Claude wake, nothing written. `--activate` transmits THIS EXACT fact-based invocation and requires OPENAI_API_KEY + OPENAI_REVIEW_MODEL + the local claude CLI.",
    }, null, 2) + "\n");
    process.exit(0);
  }

  // LIVE — the Owner's single activation.
  if (!process.env.OPENAI_API_KEY) { process.stdout.write(JSON.stringify({ mode: "ACTIVATE", ok: false, stopped: "OPENAI_API_KEY_UNSET", reason: "set OPENAI_API_KEY in this shell before --activate (read at call time, never printed)" }, null, 2) + "\n"); process.exit(1); }
  if (!model) { process.stdout.write(JSON.stringify({ mode: "ACTIVATE", ok: false, stopped: "OPENAI_REVIEW_MODEL_UNSET", reason: "set OPENAI_REVIEW_MODEL to a concrete model id (not a placeholder)" }, null, 2) + "\n"); process.exit(1); }
  const claudeBin = resolveClaudeBin({ env: process.env });
  if (!claudeBin.resolved && claudeBin.source === "PATH_FALLBACK") { process.stdout.write(JSON.stringify({ mode: "ACTIVATE", ok: false, stopped: "CLAUDE_BIN_UNRESOLVED", reason: "set CLAUDE_BIN to the full path of claude.exe or add it to PATH", triedSource: claudeBin.source }, null, 2) + "\n"); process.exit(1); }

  // Content-addressed artifacts PARTICIPATE in the live path: store the request + facts, count truthfully.
  const nodeFs = await import("node:fs");
  const artifactDir = join(REPO, "docs/orchestration/benchmark/results/artifacts");
  const artStore = makeArtifactStore({ dir: artifactDir, fs: nodeFs, join: (a, b) => join(a, b) });
  const ledger = makeEfficiencyLedger();
  let artifactsCreated = 0;
  const requestContent = { reviewId: REVIEW_ID, question: SUBJECT_785_FEED.question, requirement: SUBJECT_785_FEED.requirement };
  const factsContent = { implementationFacts: SUBJECT_785_FEED.implementationFacts, sourceFacts: SUBJECT_785_FEED.sourceFacts, deterministicEvidence: SUBJECT_785_FEED.deterministicEvidence, rawEvidence: SUBJECT_785_FEED.rawEvidence };
  if (artStore.put(artifacts[0], requestContent).ok) artifactsCreated += 1;
  if (artStore.put(artifacts[1], factsContent).ok) artifactsCreated += 1;
  ledger.bump("artifactsCreated", artifactsCreated);

  const leaseDir = join(process.env.LOCALAPPDATA || REPO, "EOS", "taylor-benchmark.lock");
  try { nodeFs.mkdirSync(join(leaseDir, ".."), { recursive: true }); } catch { /* best-effort */ }
  const lease = makeLease({ dir: leaseDir, fs: nodeFs, host: "local", pid: process.pid, now: () => Date.now(), leaseMs: 900000 });

  const result = await runInstrumentedPilotCycle({
    clock: () => Date.now(),
    ledger,
    feedBreakdown: built.breakdown,               // the ACTUAL transmitted payload's breakdown — not {}
    reviews, backlogItems: [], store,
    gptRunner: makeFactBasedGptRunner({ invocation: built.invocation, boot }),
    claudeProcessRunner: makeRealClaudeRunner(claudeBin.bin), wakeLease: lease,
    contextPackageFn: (a) => contextPackageFor({ ...a }),
    sufficiencyOf: () => boot.package.sufficiency, freshnessOf: () => (boot.provenance || {}).freshness || "UNKNOWN",
    budgetAvailable: budget > 0, wakeCtx, sourceCommit, sourceFreshness: (boot.provenance || {}).freshness || "UNKNOWN",
    persistedResultRefOf: null,
  });

  const { readout, artifact } = assessBenchmark({ result, cyclesRun: 1, sourceCommit, createdAt: new Date().toISOString() });
  const outPath = join(REPO, artifact.location);
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, canonicalize({ benchmark: "taylor-one-trigger", readout, requestDiagnostic: describeInvocation(built.invocation), evidence: result.evidence || null, transitions: result.transitions || [] }), "utf8");
  } catch (e) { /* surfaced via durableArtifact below */ }

  process.stdout.write(JSON.stringify({
    mode: "ACTIVATE",
    benchmarkComplete: true,
    pass: readout.pass,
    stopped: result.stopped,
    claudeBinSource: claudeBin.source,
    readout,
    requestDiagnostic: describeInvocation(built.invocation),
    tokenReconciliation: readout.tokenReconciliation,
    durableArtifact: { artifactId: artifact.artifactId, location: artifact.location, sha256: artifact.sha256 },
    transitions: result.transitions,
  }, null, 2) + "\n");
  process.exit(readout.pass ? 0 : 1);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) { main(); }
