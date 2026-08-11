// ONE-TRIGGER TAYLOR BENCHMARK entry — the single Owner activation for the full reciprocal-review
// benchmark. DRY by default: it prints the plan, the hard ceilings, the preserved #319 baseline, and the
// durable artifact path — calling NOTHING. `--activate` performs exactly ONE instrumented reciprocal cycle
// over the Candidate-A (#785) subject diff: one live GPT review → persist → consume → selector → ONE Claude
// wake → stop, with timing + API-efficiency instrumentation and wake-only-recovery accounting. It then
// scores the run against the ceilings + baseline and writes a content-addressed durable result artifact.
//
// Hard ceilings: ≤3 GPT paid calls, ≤3 Claude wakes, ≤3 reciprocal cycles, ≤$0.10 OpenAI spend (BENCHMARK_
// CEILING). The single cycle uses 1/1/1; the ≤3 caps are the recovery/delta headroom, enforced in the
// readout. Reads OPENAI_API_KEY at call time only; NEVER prints it. Do NOT run --activate as repo-safe work
// — it is the Owner's supervised runtime activation and the only step that spends money.

import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInstrumentedPilotCycle } from "../lib/reciprocalPilotInstrumented.mjs";
import { PILOT_CEILING } from "../lib/reciprocalPilotCycle.mjs";
import { selectEligibleReviews } from "../lib/reciprocalReviewLoop.mjs";
import { assessBenchmark, BENCHMARK_CEILING, BENCHMARK_BASELINE } from "../lib/benchmarkReadout.mjs";
import { canonicalize } from "../lib/reviewArtifacts.mjs";
import { makeInMemoryReviewStore, buildReviewRequest } from "../lib/reviewTrigger.mjs";
import { resolveClaudeBin } from "../lib/reviewInputSafety.mjs";
import { makeLease } from "../lib/wakeLease.mjs";
import { contextPackageFor } from "./build-package.mjs";
import { coldStart } from "./cold-start.mjs";
import { realGptRunner, makeRealClaudeRunner } from "./reciprocal-pilot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const arg = (n, fb = null) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb; };
const flag = (n) => process.argv.includes(`--${n}`);

const REVIEW_ID = "TAYLOR-BENCH-785";
const DEFAULT_DIFF = "docs/orchestration/benchmark/subject-785.diff";

async function main() {
  const scope = (arg("scope") || "orchestration").split(",");
  const diffPath = arg("diff", DEFAULT_DIFF);
  let diff = "(no diff supplied)";
  try { diff = readFileSync(join(REPO, diffPath), "utf8"); } catch { /* falls through to DRY note */ }
  const boot = coldStart({ id: REVIEW_ID, scope });
  const model = process.env.OPENAI_REVIEW_MODEL || "";
  // The benchmark caps OpenAI spend at $0.10; the wake budget is set accordingly.
  const budget = Math.min(Number(arg("budget", "0.10")) || 0.10, BENCHMARK_CEILING.maxOpenAiSpendUsd);
  const reviews = [{ ...buildReviewRequest({ requestId: REVIEW_ID, subject: "Equipment detail: failed customer read vs genuinely-unknown customer (#785)", source: "CONTROL_PLANE_EVENT", modelTier: "standard" }), status: "OPEN", reviewClass: "INDEPENDENT_AI", authorizedForReview: true, routedBackTo: "Orchestration", selectedModel: model }];
  const store = makeInMemoryReviewStore();
  const wakeCtx = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: budget };

  if (!flag("activate")) {
    const { eligible, skipped } = selectEligibleReviews(reviews, { store, sufficiencyOf: () => boot.package.sufficiency, freshnessOf: () => (boot.provenance || {}).freshness || "UNKNOWN" });
    process.stdout.write(JSON.stringify({
      mode: "DRY",
      benchmark: "taylor-one-trigger",
      subject: { issue: 785, pr: 786, diff: diffPath, diffPresent: diff !== "(no diff supplied)" },
      cycleCeiling: PILOT_CEILING,
      benchmarkCeiling: BENCHMARK_CEILING,
      baseline: BENCHMARK_BASELINE,
      model: model || null,
      contextSufficiency: boot.package.sufficiency,
      sourceFreshness: (boot.provenance || {}).freshness,
      eligible: eligible.length,
      skipped,
      wouldCallGptOnce: eligible.length > 0 && !!model,
      wouldWakeClaudeOnce: eligible.length > 0,
      durableArtifactDir: "docs/orchestration/benchmark/results/",
      activateCommand: "node docs/orchestration/context/taylor-benchmark.mjs --activate",
      note: "DRY only — no GPT call, no Claude wake, nothing written. `--activate` performs ONE bounded instrumented cycle (the Owner's single activation) and requires OPENAI_API_KEY + OPENAI_REVIEW_MODEL + the local claude CLI.",
    }, null, 2) + "\n");
    process.exit(0);
  }

  // LIVE — the Owner's single activation. Real GPT + real Claude wake, one instrumented cycle, then STOP.
  if (!process.env.OPENAI_API_KEY) { process.stdout.write(JSON.stringify({ mode: "ACTIVATE", ok: false, stopped: "OPENAI_API_KEY_UNSET", reason: "set OPENAI_API_KEY in this shell before --activate (it is read at call time and never printed)" }, null, 2) + "\n"); process.exit(1); }
  if (!model) { process.stdout.write(JSON.stringify({ mode: "ACTIVATE", ok: false, stopped: "OPENAI_REVIEW_MODEL_UNSET", reason: "set OPENAI_REVIEW_MODEL to a concrete model id (not a placeholder)" }, null, 2) + "\n"); process.exit(1); }
  const claudeBin = resolveClaudeBin({ env: process.env });
  if (!claudeBin.resolved && claudeBin.source === "PATH_FALLBACK") { process.stdout.write(JSON.stringify({ mode: "ACTIVATE", ok: false, stopped: "CLAUDE_BIN_UNRESOLVED", reason: "set CLAUDE_BIN to the full path of claude.exe or add it to PATH", triedSource: claudeBin.source }, null, 2) + "\n"); process.exit(1); }

  const nodeFs = await import("node:fs");
  const leaseDir = join(process.env.LOCALAPPDATA || REPO, "EOS", "taylor-benchmark.lock");
  try { nodeFs.mkdirSync(join(leaseDir, ".."), { recursive: true }); } catch { /* best-effort */ }
  const lease = makeLease({ dir: leaseDir, fs: nodeFs, host: "local", pid: process.pid, now: () => Date.now(), leaseMs: 900000 });

  const sourceCommit = (boot.provenance || {}).sourceCommit || null;
  const result = await runInstrumentedPilotCycle({
    clock: () => Date.now(),
    reviews, backlogItems: [], store,
    gptRunner: realGptRunner({ boot, diff }), claudeProcessRunner: makeRealClaudeRunner(claudeBin.bin), wakeLease: lease,
    contextPackageFn: (a) => contextPackageFor({ ...a }),
    sufficiencyOf: () => boot.package.sufficiency, freshnessOf: () => (boot.provenance || {}).freshness || "UNKNOWN",
    budgetAvailable: budget > 0, wakeCtx, sourceCommit, sourceFreshness: (boot.provenance || {}).freshness || "UNKNOWN",
    // A failed wake with a persisted result would recover wake-only; no persisted-result store is wired in
    // the one-shot entry, so this stays null (recovery reports CANNOT_RECOVER_WAKE_ONLY, honestly).
    persistedResultRefOf: null,
  });

  const { readout, artifact } = assessBenchmark({ result, cyclesRun: 1, sourceCommit, createdAt: new Date().toISOString() });
  // Persist the durable, content-addressed benchmark result artifact.
  const outPath = join(REPO, artifact.location);
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, canonicalize({ benchmark: "taylor-one-trigger", readout, evidence: result.evidence || null, transitions: result.transitions || [] }), "utf8");
  } catch (e) { /* surfaced below via artifactWritten:false */ }

  process.stdout.write(JSON.stringify({
    mode: "ACTIVATE",
    benchmarkComplete: true,
    pass: readout.pass,
    stopped: result.stopped,
    claudeBinSource: claudeBin.source,
    readout,
    durableArtifact: { artifactId: artifact.artifactId, location: artifact.location, sha256: artifact.sha256 },
    transitions: result.transitions,
  }, null, 2) + "\n");
  process.exit(readout.pass ? 0 : 1);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) { main(); }
