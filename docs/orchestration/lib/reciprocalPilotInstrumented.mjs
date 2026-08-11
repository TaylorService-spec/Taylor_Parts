// Instrumented reciprocal pilot — a thin COMPOSITION layer over runReciprocalPilotCycle (#773). It adds
// the benchmark's timing + API-efficiency accounting and the wake-only-recovery plan WITHOUT redesigning
// the cycle, the selector, the Wake Supervisor, provider routing, or review semantics. It measures the two
// side-effecting waits (the GPT call and the Claude spawn) by wrapping the INJECTED runners with a clock,
// records the paid call's token account into an efficiency ledger, and reports how a failed wake would be
// recovered wake-only (reusing the persisted result, no second provider call).
//
// Pure except for the injected clock/runners; the core cycle is untouched, so all of its existing evidence
// (gpt / gptOutcome / claudeOutcome / transitions) is preserved verbatim under `evidence`.

import { runReciprocalPilotCycle } from "./reciprocalPilotCycle.mjs";
import { makeEfficiencyLedger, makePhase, summarizeTiming } from "./reviewInstrumentation.mjs";
import { planWakeRecovery } from "./reviewRecovery.mjs";

/**
 * Run one instrumented pilot cycle. All cycle arguments pass through unchanged. Extra inputs:
 *  - clock: monotonic ms source (Date.now in prod, a fixed counter in tests). Default 0 (no timing).
 *  - ledger: an efficiency ledger to accumulate into (a fresh one is created if absent).
 *  - feedBreakdown: the buildFactFeed() per-category token breakdown used to build the request (accounting
 *    only — provider routing is unchanged), recorded alongside the measured input/output tokens.
 *  - persistedResultRefOf: optional (result) => resultRef, so a failed wake can be planned for wake-only recovery.
 * @returns the full cycle result plus `instrumentation: { timing, efficiency, recovery }`.
 */
export async function runInstrumentedPilotCycle({
  clock = () => 0,
  ledger = null,
  feedBreakdown = {},
  persistedResultRefOf = null,
  ...cycleArgs
} = {}) {
  const ef = ledger || makeEfficiencyLedger();
  const startedAt = clock();

  // Wrap the injected GPT runner (async fn) and Claude process runner (object with .run) to time the two
  // waits without changing what they do or return.
  let gptSpan = null;
  const gpt = cycleArgs.gptRunner;
  const wrappedGpt = typeof gpt === "function"
    ? async (a) => { const s = clock(); try { return await gpt(a); } finally { gptSpan = [s, clock()]; } }
    : gpt;

  let wakeSpan = null;
  const proc = cycleArgs.claudeProcessRunner;
  const wrappedProc = proc && typeof proc.run === "function"
    ? { ...proc, run: (a) => { const s = clock(); try { return proc.run(a); } finally { wakeSpan = [s, clock()]; } } }
    : proc;

  const result = await runReciprocalPilotCycle({ ...cycleArgs, gptRunner: wrappedGpt, claudeProcessRunner: wrappedProc });
  const completedAt = clock();

  // Timing: the measured GPT + wake spans are WAIT phases (non-owner latency).
  const phases = [];
  if (gptSpan) phases.push(makePhase({ name: "gpt-review", kind: "WAIT", startedAt: gptSpan[0], completedAt: gptSpan[1] }));
  if (wakeSpan) phases.push(makePhase({ name: "claude-wake", kind: "WAIT", startedAt: wakeSpan[0], completedAt: wakeSpan[1] }));
  const timing = summarizeTiming({ startedAt, completedAt, phases });

  // Efficiency: record the paid call's token account (measured tokens from evidence.gpt + the feed breakdown).
  const gptUsage = result.evidence && result.evidence.gpt;
  if (result.gptCalls > 0) {
    ef.recordCall({
      breakdown: feedBreakdown,
      inputTokens: gptUsage ? gptUsage.inputTokens : null,
      outputTokens: gptUsage ? gptUsage.outputTokens : null,
    });
  }

  // Wake-only recovery plan: if the wake failed but a result was persisted, recovery reuses it (no second
  // provider call). The counters fold into the same ledger so the account is single-sourced.
  const counters = {};
  const recovery = planWakeRecovery({
    wakeOutcome: result.wake ? result.wake.outcome : null,
    persistedResultRef: persistedResultRefOf ? persistedResultRefOf(result) : null,
    counters,
  });
  ef.merge(counters);

  return { ...result, instrumentation: { timing, efficiency: ef.snapshot(), recovery } };
}
