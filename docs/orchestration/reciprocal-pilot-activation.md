# Single live end-to-end reciprocal pilot — the ONE Owner activation

Proves ONE complete GitHub/EOS ↔ GPT ↔ Claude cycle end to end, fully automatic after a single Owner
action. Hard kill switch: **1 GPT live call · 1 Claude automatic wake · 1 reciprocal cycle**
(`PILOT_CEILING`). Reuses #772 (loop) + #760 (Wake Supervisor `executeWake`) — no second architecture,
no second wake mechanism. Everything is tested with injected GPT + Claude runners; the entry
([`context/reciprocal-pilot.mjs`](context/reciprocal-pilot.mjs)) is **DRY by default** and calls nothing
until `--activate`.

## What runs automatically after the single activation

```
eligible durable AI_REVIEW (authorizedForReview — EVENT ≠ authorization, READY ≠ authorization)
  → one live GPT review (gpt-5.6-terra, Responses API, json_schema)
  → automatic aiExchange persistence
  → automatic consumption (fail-closed; verdict ≠ authorization)
  → selector recalculation (selectNextWork)
  → ONE Claude wake via the existing Wake Supervisor (assessReadiness → lease → C-7 package incl. the
     compact GPT return context → guardrailed claude -p → bounded worker result)
  → STOP
```

The Claude wake reuses all existing guardrails (permission mode, allowed-tools, max-turns, max-budget,
wall-clock timeout, SONNET model policy, the atomic lease). A NEEDS_OWNER / protected / stale /
insufficient / failed-GPT / failed-consumption / budget-exhausted case fails closed with **no** Claude
wake.

## Prerequisites (already in place)

- `OPENAI_API_KEY` secret and `OPENAI_REVIEW_MODEL = gpt-5.6-terra`; budget ceilings ($0.25/review, $10
  pilot, no auto-recharge) + OpenAI dashboard cap.
- The local `claude` CLI available on the activation machine (the wake runs `claude -p` locally, bounded
  by the wall-clock guardrail).
- One genuine small Taylor change to review (repo-relative diff path).

## Dry-run first (no spend, no wake)

```bash
OPENAI_REVIEW_MODEL=gpt-5.6-terra node docs/orchestration/context/reciprocal-pilot.mjs --review TAYLOR-REVIEW-001 --diff <repo/rel/path.diff>
```

Confirm: `contextSufficiency: SUFFICIENT`, `model: gpt-5.6-terra`, `eligible: 1`,
`wouldCallGptOnce: true`, `wouldWakeClaudeOnce: true`, `ceiling 1/1/1`. Nothing is called.

## THE ONE ACTIVATION (the Owner's single action)

```bash
OPENAI_API_KEY=… OPENAI_REVIEW_MODEL=gpt-5.6-terra node docs/orchestration/context/reciprocal-pilot.mjs --activate --review TAYLOR-REVIEW-001 --diff <repo/rel/path.diff>
```

(Provide the key via your shell/secret manager — never paste it into chat.) After this single command,
the Owner must **not**: click the GPT workflow, relay text, type "continue", launch Claude, or consume
the result manually. PASS requires all of those to happen automatically inside the one cycle.

## Evidence captured (printed as JSON; never the key)

- `gptCalls` (=1), `claudeWakes` (=1), `duplicateCallCount` (=0)
- `evidence.gpt`: actual input/output tokens + `actualCostUsd`
- `evidence.claude`: worker `cost` (where exposed), selected model, result
- `transitions`: `CYCLE_START → GPT_TRIGGERED → GPT_COMPLETED → REVIEW_CONSUMED → CLAUDE_AUTHORIZED →
  CLAUDE_TRIGGERED → CLAUDE_ACTIVE → CLAUDE_COMPLETED → STOP`
- `ownerRelayCount` (=0), `ownerManualActionCountAfterActivation` (=0)
- elapsed time (from your shell), lifecycle transitions

## Kill switch / rollback

- The pilot performs **at most** 1 GPT call, 1 wake, 1 cycle. A second invocation (or a re-observed
  event) hits `CYCLE_CEILING` and calls nothing. No recursion.
- Stop anytime: Ctrl-C the command (the wall-clock guardrail also bounds a stuck child); delete the
  `OPENAI_API_KEY` to disable any live GPT call. No overnight, no protected deploy, no unlimited
  recurrence.

## After one successful cycle

Return `PASS / PASS_WITH_FINDINGS / FAIL` with: GPT tokens/cost, Claude usage (where exposed), elapsed
time, the lifecycle transitions, Owner relay count, Owner manual-action count after activation, and
duplicate-call count — then decide whether to run a bounded 3-round Taylor cost pilot. Do **not** enable
unlimited autonomy on the strength of one cycle.
