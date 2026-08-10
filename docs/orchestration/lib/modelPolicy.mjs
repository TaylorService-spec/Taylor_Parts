// Executable model-selection policy — the runtime binding of the ALREADY-RATIFIED two-model policy
// (docs/quality/model-tier-config.md + agent-orchestration-adapter.md). NOT a new authority: it
// deterministically resolves the governed policy to a concrete runtime model, and preserves the
// logical `modelTier` (economy|standard|advanced) as portability/intent metadata — modelTier is NOT
// the runtime model.
//
// RATIFIED POLICY: primary Product/Design + UX-primary sessions → OPUS; every DELEGATED agent → SONNET.
// Standard Agent Manager dispatch always dispatches DELEGATED workers → SONNET. Difficulty NEVER
// auto-escalates Sonnet→Opus; a delegated worker returns a durable NEEDS_HIGHER_REASONING signal to
// the parent/selector instead (mirrors the doc's "SONNET agent returns ESCALATION REQUIRED to the
// parent OPUS session"), which respects budget/resource and never turns a delegate into a primary.

export const RUNTIME_MODELS = Object.freeze(["opus", "sonnet"]);
export const MODEL_ESCALATIONS = Object.freeze(["NEEDS_HIGHER_REASONING"]);

// The primary (non-delegated) sessions the ratified policy runs on OPUS.
const PRIMARY_OPUS_WORKSTREAMS = Object.freeze(new Set(["Product/Design", "UX"]));

/**
 * Resolve the concrete runtime model for a piece of work under the ratified two-model policy.
 * @param {object} o
 * @param {string} [o.modelTier]   logical tier (portability metadata; preserved, not the model)
 * @param {string} [o.workstream]  requesting workstream (e.g. "Product/Design", "UX")
 * @param {boolean} [o.delegated]  true = a delegated/dispatched agent (Agent Manager default). A
 *                                 delegated agent is ALWAYS SONNET regardless of tier or workstream.
 * @returns {{ selectedModel, modelTier, reason, delegated }}
 */
export function resolveDispatchModel({ modelTier = "standard", workstream = null, delegated = true } = {}) {
  if (delegated) {
    return { selectedModel: "sonnet", modelTier, delegated: true, reason: "delegated agent → SONNET (ratified two-model policy)" };
  }
  if (workstream && PRIMARY_OPUS_WORKSTREAMS.has(workstream)) {
    return { selectedModel: "opus", modelTier, delegated: false, reason: `primary ${workstream} session → OPUS (ratified two-model policy)` };
  }
  return { selectedModel: "sonnet", modelTier, delegated: false, reason: "no primary-OPUS workstream → SONNET (default)" };
}

/**
 * Request a durable model escalation. Difficulty alone never auto-escalates; this returns a signal
 * that routes back to the selector/governance, respects resource+budget, and never expands authority
 * or turns a delegated worker into a primary-authority session.
 */
export function requestModelEscalation(reason) {
  return Object.freeze({
    signal: "NEEDS_HIGHER_REASONING",
    reason: reason || null,
    routeTo: "selector/governance",
    autoApplied: false, // NEVER auto-escalated; the parent/selector decides under budget+resource
    note: "delegated worker requests higher reasoning; does not itself become a primary session or gain authority",
  });
}

// Attach the resolved selection to a durable assignment record (persist selectedModel + modelTier +
// reason so we can later answer "which model handled this?" without reconstructing from logs).
export function withSelectedModel(assignment, selection) {
  return { ...assignment, selectedModel: selection.selectedModel, modelTier: selection.modelTier, modelSelectionReason: selection.reason };
}
