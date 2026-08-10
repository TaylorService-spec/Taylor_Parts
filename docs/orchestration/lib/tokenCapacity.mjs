// Token / AI capacity as a governed resource (§25) — honest metrics/proxies ONLY.
//
// Available AI capacity is a governed resource alongside network / browser / remote-agent
// slots. But the runtime does NOT expose main-loop token usage — only per-subagent tokens
// are visible (agentResult.metrics.tokens, and even then "where available"). So the weekly
// allowance headline is genuinely UNKNOWN unless the Owner supplies account metrics. This
// module NEVER fabricates: absent a real number, it reports UNKNOWN. The primary optimization
// is useful-verified-work-per-token, not maximum activity — autonomy should degrade
// gracefully as a configured limit approaches; never burn capacity to avoid a checkpoint.
//
// Pure projection. No I/O, no clock.

export const CAPACITY_STATES = Object.freeze(["HEALTHY", "LOW", "DRAINED", "UNKNOWN"]);

/**
 * Project token capacity from whatever is actually known.
 *
 * @param {object} [input]
 * @param {number|null} [input.weeklyAllowance]  Owner-supplied weekly token allowance, or null (UNKNOWN)
 * @param {number|null} [input.knownSpend]       spend this period IF an account metric is supplied, else null
 * @param {Array<object>} [input.subagentResults] agent results carrying metrics.tokens (the ONLY
 *                                                 tokens the runtime actually exposes)
 * @param {number} [input.lowFraction]           remaining-fraction threshold for LOW (default 0.2)
 * @returns {{ state, weeklyAllowance, knownSpend, remaining, subagentTokens, reusedDeduped, reason }}
 */
export function projectTokenCapacity(input = {}) {
  const { weeklyAllowance = null, knownSpend = null, subagentResults = [], lowFraction = 0.2 } = input;

  // Subagent tokens are the only runtime-exposed figure. Sum what's present; never invent.
  let subagentTokens = 0;
  let anySubagentMetric = false;
  for (const r of subagentResults) {
    const t = r && r.metrics && r.metrics.tokens;
    if (typeof t === "number") { subagentTokens += t; anySubagentMetric = true; }
  }

  // Without an Owner-supplied allowance AND spend, headline capacity is UNKNOWN — full stop.
  if (weeklyAllowance == null || knownSpend == null) {
    return {
      state: "UNKNOWN",
      weeklyAllowance: weeklyAllowance ?? null,
      knownSpend: knownSpend ?? null,
      remaining: null,
      subagentTokens: anySubagentMetric ? subagentTokens : null,
      reusedDeduped: null,
      reason: "main-loop token usage is not runtime-exposed; no Owner-supplied allowance+spend to project from",
    };
  }

  const remaining = Math.max(0, weeklyAllowance - knownSpend);
  const fraction = weeklyAllowance > 0 ? remaining / weeklyAllowance : 0;
  const state = remaining <= 0 ? "DRAINED" : fraction <= lowFraction ? "LOW" : "HEALTHY";
  return {
    state, weeklyAllowance, knownSpend, remaining,
    subagentTokens: anySubagentMetric ? subagentTokens : null,
    reusedDeduped: null,
    reason: state === "HEALTHY" ? null : `remaining ${remaining} of ${weeklyAllowance} (${Math.round(fraction * 100)}%)`,
  };
}
