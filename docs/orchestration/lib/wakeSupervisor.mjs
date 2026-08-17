// EOS Wake Supervisor — token-free readiness core (bounded prototype, repo-safe).
//
// SEARCH-FIRST research (WAKE-RESEARCH-001) chose `claude -p` headless (--output-format json) as
// the supported non-interactive interface, fenced by --permission-mode dontAsk + an --allowedTools
// repo-safe allowlist + --max-turns + --max-budget-usd + an external wall-clock timeout. This module
// is the PURE decision core: it reads cheap durable state and decides — with NO model call — whether
// a wake is warranted, and constructs the fully-guardrailed invocation. It does NOT spawn anything;
// the runner (wake-supervisor.mjs, DRY-RUN by default) executes only under explicit supervision.
//
// HARD INVARIANTS (Owner): READY is NEVER authorization · never cross a protected boundary · respect
// the 2/1/1 governor · respect network/budget · distinguish AUTHORITY from TRIGGER · record
// MANUAL_RUNTIME_TRIGGER vs AUTOMATIC_TRIGGER · explicit backoff. Supervised, bounded, no overnight.

import { resolveDispatchModel } from "./modelPolicy.mjs";
import { evaluateBudgetStop, evaluateProviderCapacityStop, invocationEconomicCap } from "./costCapacity.mjs";
import { resolveProfile } from "./executionProfiles.mjs";

export const TRIGGER_MECHANISMS = Object.freeze(["MANUAL", "AUTOMATIC", "NO_WAKE_MECHANISM", "FAILED"]);
export const WAKE_DECISIONS = Object.freeze(["TRIGGER", "HOLD", "CHECKPOINT"]);
export const TRIGGER_KINDS = Object.freeze(["MANUAL_RUNTIME_TRIGGER", "AUTOMATIC_TRIGGER"]);

// Guardrails baked into EVERY constructed invocation, DERIVED from a scoped execution capability profile
// (executionProfiles.mjs) — the permission mode, the explicit tool/command allowlist, and the bounded turn
// ceiling all come from the profile, never hard-coded here. dontAsk (auto-deny, never bypassPermissions);
// NO unrestricted Bash; NO merge/deploy/credential authority. The model comes from the SHARED resolver
// (delegated → SONNET), never independently hard-coded, so the wake path cannot diverge from dispatch.
//
// Build a guardrail set from a named profile + the runtime knobs the profile does not own (model / economic
// cap / wall-clock / output format). Records the configured turn ceiling + profile name for telemetry.
export function guardrailsForProfile(profileName, { model, maxBudgetUsd = null, wallClockSec = 900, outputFormat = "json" } = {}) {
  const profile = resolveProfile(profileName); // fail-closed on unknown
  return Object.freeze({
    profile: profile.name,
    permissionMode: profile.permissionMode,        // always "dontAsk" (profile-enforced)
    allowedTools: profile.allowedTools,
    disallowedTools: profile.disallowedTools,
    model: model ?? resolveDispatchModel({ delegated: true }).selectedModel,
    maxTurns: profile.maxTurns,                    // the bounded, task-class turn ceiling
    turnCeiling: profile.maxTurns,                 // explicit telemetry field
    maxBudgetUsd,                                  // Claude modeled dollars are not billed spend
    wallClockSec,                                  // the supervisor imposes this (no CLI flag) and SIGTERMs on breach
    outputFormat,                                  // machine-parse result + total_cost_usd
  });
}

// The DEFAULT/FALLBACK profile is READ_ONLY_ANALYSIS (least privilege): read + git-read only, no Edit/Write,
// 40-turn ceiling. A wake runs with MORE authority (READ_ONLY_VERIFY / PATCH_PRODUCER / GOVERNED_INTEGRATION,
// with their 60/80/100 ceilings) ONLY when a governed authorization on the intake explicitly grants it — a
// request/worker can never self-escalate (see resolveExecutionProfile). Ordinary/analysis wakes never inherit
// write/patch authority.
export const DEFAULT_GUARDRAILS = guardrailsForProfile("READ_ONLY_ANALYSIS");

/**
 * Token-free readiness assessment. NO model call. Decides purely from cheap durable state.
 *
 * @param {object} item     the selector's current work item: { id, status, authorized, protectedBoundary, scope, contextPackage }
 * @param {object} ctx
 * @param {object} ctx.governor  { remoteAiUsed, remoteAiMax } (the 2/1/1 REMOTE_AI dimension)
 * @param {string} ctx.network   "NORMAL" | "NETWORK_PRESSURE" | "NETWORK_UNAVAILABLE" | "UNKNOWN"
 * @param {number|null} ctx.budgetRemainingUsd  null = unknown (fail-safe: treated as usable only if >0 or null-allowed)
 * @param {string} [ctx.triggerKind]  MANUAL_RUNTIME_TRIGGER | AUTOMATIC_TRIGGER (who is asking)
 * @param {object} [ctx.lastRun]  { itemId, sha } dedup marker — same item+sha won't re-fire
 * @param {boolean} [ctx.overnight]  true if inside a no-run window (pilot: no overnight)
 * @returns {{ decision, reason, item, guardrails, triggerMechanism, triggerKind }}
 */
export function assessReadiness(item, ctx = {}) {
  const { governor = {}, network = "UNKNOWN", budgetRemainingUsd = null, triggerKind = "AUTOMATIC_TRIGGER",
    lastRun = null, overnight = false } = ctx;
  const hold = (reason, mechanism = "NO_WAKE_MECHANISM", extra = {}) => ({ decision: "HOLD", reason, item, guardrails: null, triggerMechanism: mechanism, triggerKind, ...extra });

  if (overnight) return hold("no-run window (supervised pilot: no overnight)");
  if (!item) return { decision: "CHECKPOINT", reason: "no work item — nothing to trigger", item: null, guardrails: null, triggerMechanism: "NO_WAKE_MECHANISM", triggerKind };
  if (item.status !== "READY") return { decision: "CHECKPOINT", reason: `item ${item.id} is ${item.status}, not READY`, item, guardrails: null, triggerMechanism: "NO_WAKE_MECHANISM", triggerKind };

  // THE AUTHORITY≠TRIGGER RULE: READY alone is never a reason to run.
  if (item.authorized !== true) return hold(`${item.id} is READY but NOT authorized — READY is not authorization`);
  if (item.protectedBoundary) return hold(`${item.id} crosses a protected boundary (${item.protectedBoundary}) — never auto-trigger`);

  // Resource/network/budget guards.
  const slotFree = Number.isFinite(governor.remoteAiUsed) && Number.isFinite(governor.remoteAiMax)
    ? governor.remoteAiUsed < governor.remoteAiMax : false;
  if (!slotFree) return hold(`no free REMOTE_AI slot (${governor.remoteAiUsed}/${governor.remoteAiMax}) — respect the 2/1/1 governor`);
  if (network !== "NORMAL") return hold(`network ${network} — hold until NORMAL`);
  const capacityStopReason = evaluateProviderCapacityStop(ctx.providerCapacityUsage || {});
  if (capacityStopReason) return hold(`provider capacity exhausted: ${capacityStopReason}`, "NO_WAKE_MECHANISM", { budgetStopReason: capacityStopReason });
  const budgetStopReason = evaluateBudgetStop(ctx.costCapacity || {});
  if (budgetStopReason) return hold(`budget exhausted: ${budgetStopReason}`, "NO_WAKE_MECHANISM", { budgetStopReason });
  // Backward compatibility: an explicitly supplied legacy zero remains fail-closed. Runtime defaults no
  // longer inject this synthetic field for subscription-backed Claude work.
  if (budgetRemainingUsd != null && budgetRemainingUsd <= 0) return hold("budget exhausted: LEGACY_EXPLICIT_LIMIT");

  // Dedup: the same item at the same repo SHA must not re-fire.
  if (lastRun && lastRun.itemId === item.id && lastRun.sha === item.sha) {
    return hold(`already ran ${item.id} @ ${item.sha} — dedup (no re-trigger on unchanged state)`);
  }

  const mechanism = triggerKind === "MANUAL_RUNTIME_TRIGGER" ? "MANUAL" : "AUTOMATIC";
  return { decision: "TRIGGER", reason: `${item.id} is READY + authorized + repo-safe + slot free`, item, guardrails: DEFAULT_GUARDRAILS, triggerMechanism: mechanism, triggerKind };
}

// Exponential backoff (ms), capped — used after a non-zero exit / budget-hit / max-turns, and to
// avoid re-firing on unchanged state.
export function nextBackoffMs(attempts, { baseMs = 60_000, capMs = 900_000 } = {}) {
  const n = Math.max(0, attempts | 0);
  return Math.min(capMs, baseMs * 2 ** n);
}

/**
 * The worker-facing OUTPUT CONTRACT for a governed execution.
 *
 * WHY THIS EXISTS: `classifyCompletion` (completionSemantics.mjs) can only reach COMPLETE when the
 * worker's structured `evidence.receipts` covers the contract's `requiredExecutionReceipts`. Until this
 * function existed, nothing ever TOLD the worker that — the prompt was the C-7 context package alone.
 * A run therefore only satisfied the gate when the issue body happened to spell out "return receipts",
 * so well-formed work blocked at BLOCKED_EXECUTION ("required execution receipts missing: tests") purely
 * because the receipt was never requested. This closes that gate↔worker disconnect deterministically
 * instead of depending on how an issue was worded.
 *
 * This asks ONLY for honest structured reporting. It grants nothing, widens no authority, and never
 * instructs the worker to claim a receipt it did not earn — `classifyCompletion` still independently
 * validates every receipt after the fact, and a fabricated one is a reporting defect, not an escalation.
 *
 * Pure: no fs/network/clock. Returns "" when the contract requires nothing.
 */
export function buildExecutionOutputContract({ requiredExecutionReceipts = [], expectedArtifactClass = "NONE", verifierRequired = false } = {}) {
  const receipts = Array.isArray(requiredExecutionReceipts) ? requiredExecutionReceipts.filter((r) => typeof r === "string" && r) : [];
  const wantsArtifact = typeof expectedArtifactClass === "string" && expectedArtifactClass && expectedArtifactClass !== "NONE";
  if (receipts.length === 0 && !wantsArtifact && !verifierRequired) return "";

  const lines = [
    "",
    "## REQUIRED OUTPUT CONTRACT (governed — read before you finish)",
    "",
    "Your final message MUST end with a single fenced ```json block containing an `evidence` object.",
    "Completion is decided from THIS structured block, never from your prose. If the block is absent or",
    "incomplete, your work is recorded as BLOCKED_EXECUTION even when the work itself was done correctly.",
    "",
    "```json",
    "{",
    '  "evidence": {',
    `    "receipts": [${receipts.map((r) => JSON.stringify(r)).join(", ")}],`,
    '    "artifacts": [],',
    '    "executionCapable": true,',
    '    "toolPermissionBlocked": false,',
    '    "verifier": null',
    "  }",
    "}",
    "```",
    "",
  ];

  if (receipts.length > 0) {
    lines.push(`REQUIRED RECEIPTS — list a name in \`receipts\` ONLY after you actually performed it: ${receipts.join(", ")}.`);
    if (receipts.includes("tests")) {
      lines.push('  · "tests" means you RAN a test command and observed its result. Quote the command and its');
      lines.push("    pass/fail counts in your prose. Never claim it because tests merely exist.");
    }
    lines.push("");
  }
  if (wantsArtifact) {
    lines.push(`REQUIRED DURABLE ARTIFACT — this task must produce a ${expectedArtifactClass}. When you have`);
    lines.push(`  genuinely produced it, add ${JSON.stringify(expectedArtifactClass)} to \`artifacts\`. If you could not, leave`);
    lines.push("  `artifacts` empty and say plainly why — the run resolves to AWAITING_ARTIFACTIZATION, which is a");
    lines.push("  truthful outcome. A fabricated artifact claim is worse than an unfinished task.");
    lines.push("");
  }
  if (verifierRequired) {
    lines.push('VERIFIER — set `verifier` to "PASS" only on a real passing verification; otherwise "FAIL" or null.');
    lines.push("");
  }
  lines.push("HONESTY GATE — if a required tool or permission was unavailable, set `executionCapable` to false");
  lines.push("  and `toolPermissionBlocked` to true, and do NOT list receipts you could not earn. Reporting a");
  lines.push("  blocked run truthfully is the correct outcome; retrying a deterministically prohibited action is not.");
  lines.push("");
  return lines.join("\n");
}

/**
 * Construct the fully-guardrailed `claude -p` argv the supervisor WOULD run. The prompt is a C-7
 * context package (consume the SAME package mechanism — never a bespoke bootstrap), plus the governed
 * output contract that tells the worker which structured receipts completion will be judged on.
 * Returns argv for dry-run logging or supervised live exec; this function spawns nothing.
 */
export function buildClaudeInvocation({ contextPackage, guardrails = DEFAULT_GUARDRAILS, profile = null, executionContract = null } = {}) {
  if (!contextPackage) throw new Error("buildClaudeInvocation: a C-7 contextPackage is required (bootstrap via the shared package mechanism)");
  // A named profile, when supplied, is the source of truth for the authority envelope + turn ceiling.
  if (profile) guardrails = guardrailsForProfile(profile, { model: guardrails.model, maxBudgetUsd: guardrails.maxBudgetUsd, wallClockSec: guardrails.wallClockSec, outputFormat: guardrails.outputFormat });
  const base = typeof contextPackage === "string" ? contextPackage : JSON.stringify(contextPackage);
  // The contract is APPENDED, never substituted — the C-7 package remains the authority on the work itself.
  const prompt = executionContract ? `${base}\n${buildExecutionOutputContract(executionContract)}` : base;
  const argv = [
    "-p", prompt,
    "--output-format", guardrails.outputFormat,
    "--permission-mode", guardrails.permissionMode,
    "--model", guardrails.model,
    "--max-turns", String(guardrails.maxTurns),
  ];
  const economicCap = invocationEconomicCap({ explicitEconomicCostCapUsd: guardrails.maxBudgetUsd });
  if (economicCap != null) argv.push("--max-budget-usd", String(economicCap));
  for (const t of guardrails.allowedTools) { argv.push("--allowedTools", t); }
  for (const t of guardrails.disallowedTools || []) { argv.push("--disallowedTools", t); }
  return {
    bin: "claude", argv,
    wallClockSec: guardrails.wallClockSec, // supervisor enforces externally; SIGTERM on breach
    profile: guardrails.profile ?? null,   // configured capability profile (telemetry)
    turnCeiling: guardrails.maxTurns,      // configured bounded turn ceiling (telemetry)
    note: "DRY-RUN unless supervised+authorized; spawns nothing here. bypassPermissions is NEVER used.",
  };
}
