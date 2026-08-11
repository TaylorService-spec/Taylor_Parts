// SINGLE-CYCLE reciprocal pilot entry — the ONE Owner activation. DRY by default: it evaluates
// eligibility and prints the plan, calling NOTHING. `--activate` performs exactly ONE bounded cycle:
// one live GPT review → persist → consume → selector → ONE Claude wake (claude -p) → stop. Ceilings
// 1/1/1 (PILOT_CEILING). Requires --activate AND OPENAI_API_KEY AND a configured OPENAI_REVIEW_MODEL AND
// the local `claude` CLI. Reads the key at call time only; never prints it. Do NOT run --activate as part
// of repo-safe work — it is the Owner's supervised runtime activation.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runReciprocalPilotCycle, PILOT_CEILING } from "../lib/reciprocalPilotCycle.mjs";
import { selectEligibleReviews } from "../lib/reciprocalReviewLoop.mjs";
import { runOpenAIReview } from "../lib/openaiReviewProvider.mjs";
import { makeInMemoryReviewStore, buildReviewRequest } from "../lib/reviewTrigger.mjs";
import { resolveClaudeBin } from "../lib/reviewInputSafety.mjs";
import { makeLease } from "../lib/wakeLease.mjs";
import { contextPackageFor } from "./build-package.mjs";
import { coldStart } from "./cold-start.mjs";
import { readGoverningAuthorityText } from "./openai-review.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const arg = (n, fb = null) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb; };
const flag = (n) => process.argv.includes(`--${n}`);

// Real OpenAI Responses transport (INDEPENDENT_AI reviewer). Reads key only here; never logged.
// Exported so the one-trigger Taylor benchmark (taylor-benchmark.mjs) reuses the SAME real runner
// rather than a second copy — one source of truth for the paid-transport shape.
export function realGptRunner({ boot, diff }) {
  return async (review) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, failureKind: "TRIGGER_FAILED", reason: "OPENAI_API_KEY not set" };
    const contextText = readGoverningAuthorityText(boot);
    const transport = async (invocation) => {
      const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: invocation.model, input: invocation.messages, max_output_tokens: invocation.maxOutputTokens, text: { format: { type: "json_schema", name: "eos_review_result", strict: true, schema: { type: "object", additionalProperties: false, properties: { verdict: { type: "string", enum: ["CONCUR", "CONCUR_WITH_CORRECTION", "NONCONCUR_ESCALATE", "EVIDENCE_REQUIRED", "NEEDS_OWNER"] }, conclusion: { type: "string" }, corrections: { type: "array", items: { type: "string" } }, evidenceRefs: { type: "array", items: { type: "string" } }, ownerDecisionRequired: { type: "boolean" } }, required: ["verdict", "conclusion", "corrections", "evidenceRefs", "ownerDecisionRequired"] } } } }) });
      if (!res.ok) return { ok: false, error: `status ${res.status}` };
      const data = await res.json();
      let text = data.output_text; if (!text && Array.isArray(data.output)) for (const it of data.output) for (const c of (it.content || [])) if (c.type === "output_text" && c.text) text = c.text;
      let body; try { body = JSON.parse(text); } catch { return { ok: false, error: "non-JSON content" }; }
      return { ok: true, review: body, usage: { inputTokens: data.usage && data.usage.input_tokens, outputTokens: data.usage && data.usage.output_tokens } };
    };
    const prov = boot.provenance || {};
    return runOpenAIReview({ request: review, contextPackage: boot.package, diff, contextText, transport, sourceFreshness: prov.freshness || "UNKNOWN", contextPackageRef: { mapVersion: (boot.package.provenance || {}).mapVersion || null, sourceCommit: prov.sourceCommit || null, governingAuthority: boot.package.governingAuthority || null }, provenance: { sourceFreshness: prov.freshness || "UNKNOWN", sourceCommit: prov.sourceCommit || null }, triggerKind: "AUTOMATIC_TRIGGER", timestamps: { requestedAt: new Date().toISOString(), triggeredAt: new Date().toISOString() }, clock: () => new Date().toISOString() });
  };
}
// Real Claude process runner for executeWake: spawn the RESOLVED `claude` executable bounded by the
// wall-clock guardrail. `resolvedBin` overrides the core's logical bin ("claude") — on Windows a bare
// "claude" ENOENTs (spawnSync does not use PATH/PATHEXT and claude is often not on PATH). Guardrails
// (argv/timeout/allowlist) are untouched — only the executable path is resolved.
export function makeRealClaudeRunner(resolvedBin) {
  return {
    run({ bin, argv, wallClockSec }) {
      const exe = resolvedBin || bin;
      const r = spawnSync(exe, argv, { timeout: (wallClockSec || 900) * 1000, encoding: "utf8", windowsHide: true, input: "" });
      if (r.error && r.error.code === "ETIMEDOUT") return { timedOut: true, stderr: r.stderr || "" };
      if (r.error) return { spawnError: `${r.error.code || "spawn error"}: ${r.error.message} (bin=${exe})` };
      if (r.signal) return { timedOut: true, stderr: r.stderr || "" };
      // Always return stderr so a NONZERO_EXIT is diagnosable (executeWake sanitizes it for evidence).
      return { stdout: r.stdout || "", stderr: r.stderr || "", exitCode: r.status == null ? 1 : r.status, timedOut: false };
    },
  };
}

async function main() {
  const scope = (arg("scope") || "orchestration").split(",");
  const reviewId = arg("review", "TAYLOR-REVIEW-001");
  const diffPath = arg("diff");
  const diff = diffPath ? readFileSync(join(REPO, diffPath), "utf8") : "(no diff supplied)";
  const boot = coldStart({ id: reviewId, scope });
  const model = process.env.OPENAI_REVIEW_MODEL || "";
  // One durable, authorized AI_REVIEW. authorizedForReview must come from durable EOS state — here it is
  // the operator asserting this specific review is authorized (EVENT ≠ authorization).
  const reviews = [{ ...buildReviewRequest({ requestId: reviewId, subject: arg("subject", `review ${reviewId}`), source: "CONTROL_PLANE_EVENT", modelTier: "standard" }), status: "OPEN", reviewClass: "INDEPENDENT_AI", authorizedForReview: true, routedBackTo: arg("routedBackTo", "Orchestration"), selectedModel: model }];
  const store = makeInMemoryReviewStore();
  const wakeCtx = { governor: { remoteAiUsed: 0, remoteAiMax: 1 }, network: "NORMAL", budgetRemainingUsd: Number(arg("budget", "10")) || 10 };

  if (!flag("activate")) {
    const { eligible, skipped } = selectEligibleReviews(reviews, { store, sufficiencyOf: () => boot.package.sufficiency, freshnessOf: () => (boot.provenance || {}).freshness || "UNKNOWN" });
    process.stdout.write(JSON.stringify({ mode: "DRY", ceiling: PILOT_CEILING, reviewId, model: model || null, contextSufficiency: boot.package.sufficiency, sourceFreshness: (boot.provenance || {}).freshness, eligible: eligible.length, skipped, wouldCallGptOnce: eligible.length > 0 && !!model, wouldWakeClaudeOnce: eligible.length > 0, note: "DRY only — no GPT call, no Claude wake. `--activate` performs ONE bounded cycle (the Owner's single activation)." }, null, 2) + "\n");
    process.exit(0);
  }

  // LIVE — the Owner's single activation. Real GPT + real Claude wake, one bounded cycle, then STOP.
  const nodeFs = await import("node:fs");
  // Resolve the Claude executable (bare "claude" ENOENTs on Windows / off PATH — the observed defect).
  const claudeBin = resolveClaudeBin({ env: process.env });
  if (!claudeBin.resolved && claudeBin.source === "PATH_FALLBACK") {
    process.stdout.write(JSON.stringify({ mode: "ACTIVATE", ok: false, stopped: "CLAUDE_BIN_UNRESOLVED", reason: "could not resolve the claude executable — set CLAUDE_BIN to its full path (e.g. C\\:\\Users\\<you>\\.local\\bin\\claude.exe) or add it to PATH", triedSource: claudeBin.source }, null, 2) + "\n");
    process.exit(1);
  }
  // Ensure the lease parent dir exists (a missing dir would ENOENT the lease and mask the real reason).
  const leaseDir = join(process.env.LOCALAPPDATA || REPO, "EOS", "reciprocal-pilot.lock");
  try { nodeFs.mkdirSync(join(leaseDir, ".."), { recursive: true }); } catch { /* best-effort */ }
  const lease = makeLease({ dir: leaseDir, fs: nodeFs, host: "local", pid: process.pid, now: () => Date.now(), leaseMs: 900000 });
  const r = await runReciprocalPilotCycle({
    reviews, backlogItems: [], store,
    gptRunner: realGptRunner({ boot, diff }), claudeProcessRunner: makeRealClaudeRunner(claudeBin.bin), wakeLease: lease,
    contextPackageFn: (a) => contextPackageFor({ ...a }),
    sufficiencyOf: () => boot.package.sufficiency, freshnessOf: () => (boot.provenance || {}).freshness || "UNKNOWN",
    budgetAvailable: wakeCtx.budgetRemainingUsd > 0, wakeCtx, sourceCommit: (boot.provenance || {}).sourceCommit, sourceFreshness: (boot.provenance || {}).freshness || "UNKNOWN",
    clock: () => new Date().toISOString(),
  });
  // Print evidence only — never the key. claudeBinSource + evidence.claudeOutcome surface the ACTUAL
  // wake result/failure reason (fixes the hidden-reason gap).
  process.stdout.write(JSON.stringify({ mode: "ACTIVATE", stopped: r.stopped, gptCalls: r.gptCalls, claudeWakes: r.claudeWakes, claudeBinSource: claudeBin.source, transitions: r.transitions, evidence: r.evidence, ownerSurfaces: r.ownerSurfaces || [] }, null, 2) + "\n");
  process.exit(r.ok ? 0 : 1);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) { main(); }
