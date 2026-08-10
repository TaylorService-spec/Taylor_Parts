# Reciprocal GitHub ↔ GPT ↔ Claude loop — closure

Closes the Owner-relay gap: Claude produces an AI_REVIEW → EOS detects eligibility → the event path
invokes GPT once → the structured result persists and is consumed → the selector recalculates → the
responsible Claude assignment becomes eligible → the existing Wake Supervisor would start Claude with
the GPT verdict/corrections/evidence. **Owner copy/paste between Claude and GPT = 0.** No live call is
made by this change — the whole chain is proven with an injected/fake provider.

## Gap map (what was missing on origin/main)

Every contract already existed; nothing **chained** them. The missing links, now built:

| # | Missing link | Added |
|---|---|---|
| 1 | orchestrator chaining trigger→provider→persist→consume→select→wake | `reciprocalReviewLoop.runReciprocalReviewCycle` |
| 2 | filter a SET of durable AI_REVIEWs to the eligible ones | `selectEligibleReviews` |
| 3 | per-exchange at-most-once lifecycle (NOT_TRIGGERED→…→CONSUMED) | `EXCHANGE_LIFECYCLE` + lease/store replay guard |
| 4 | automatic persistence of the result into aiExchange | injected `persistExchange` of `consumeReviewResult().exchange` |
| 5 | selector-item (`.state`) → wake-item (`.status/.authorized`) adapter | `mapToWakeItem` |
| 6 | compact GPT result into the woken Claude's C-7 package | `reviewReturnContext` |
| 7 | event path beyond manual dispatch | `repository_dispatch: [eos-ai-review-eligible]` (inert) |
| 8 | Owner-relay metric distinct from genuine gates | `relayMetric` |
| 9 | unified loop projection | `projectReciprocalLoopBoard` |

**No second** queue, ledger, selector, wake mechanism, or context system — the loop composes
`reviewTrigger` · `openaiReviewProvider` (injected) · `aiExchange` · `selectNextWork` · `wakeSupervisor`.

## Eligibility (deterministic, token-free)

A GPT call occurs ONLY when a review is **OPEN + INDEPENDENT_AI + authorized-for-review + context
SUFFICIENT + provenance CURRENT + not duplicate + not in-flight + within resource/budget**. A GitHub /
control-plane event wakes the cheap evaluator; the evaluator (not a poll of GPT) decides eligibility. No
GPT call on every push/PR/commit/workflow/selector run.

## Idempotency / at-most-once

Each exchange advances `NOT_TRIGGERED → TRIGGERED → IN_FLIGHT → COMPLETED → CONSUMED`. A lease (the
injected equivalent of the #760 wake lease) plus a store replay guard means the same eligible review —
observed via duplicated events, workflow retry, concurrent runners, process retry, or result replay —
yields **at most one** provider invocation.

## Result → consumption → wake

Persist (automatic, aiExchange) → consume (fail-closed) → selector → wake. Verdict behavior (existing
contract): `CONCUR`/`AUTO_RESOLVED` → consume, Claude eligible; `CONCUR_WITH_CORRECTION` → consume,
correction rides into the Claude package; `EVIDENCE_REQUIRED` → consume, evidence work routed, **not** a
pass; `NONCONCUR_ESCALATE`/`NEEDS_OWNER` → Owner surface, **no** auto-wake around the gate; protected
action → Owner (a verdict is never authorization). **Silence ≠ approval.**

System-owned metadata (exchangeId/requestId/provider/selectedModel/triggerKind/contextPackageRef/
provenance/sourceFreshness/timestamps) stays EOS-owned; GPT supplies only semantic fields. The C-7
return context is compact — verdict/conclusion/corrections/evidence/provenance/reviewId — never the API
transcript, model internals, or unrelated exchanges.

## Target lifecycle

`AI_REVIEW OPEN → GPT TRIGGERED → GPT COMPLETED → REVIEW CONSUMED → CLAUDE READY/AUTHORIZED →
AUTOMATIC_TRIGGER → ACKNOWLEDGED → ACTIVE`. This change proves through `CLAUDE WOULD_TRIGGER`; the actual
ACKNOWLEDGED/ACTIVE happen only at a live wake (a separate, still-gated activation).

## Control Center

`projectReciprocalLoopBoard` → AI review lifecycle counts · responsible Claude (WAITING/READY) · GPT
calls · GPT cost · last verdict · last provenance · **Owner relay count (0)** · genuine Owner gates.
Machinery stays progressively disclosed.

## Owner-relay metric (the success criterion)

`claudeToGptRelay: 0 · gptToClaudeRelay: 0 · ownerContinue: 0`. A genuine `NEEDS_OWNER` is tracked
separately as `genuineOwnerGates` — governed authorization, **not** relay friction.

---

# Single live end-to-end pilot — Owner activation runbook

**One supervised cycle, one genuine Taylor AI_REVIEW, no overnight, no protected deploys.** Prerequisites
already in place: `OPENAI_API_KEY` secret + `OPENAI_REVIEW_MODEL = gpt-5.6-terra`, budget ceilings
($0.25/review, $10 pilot, no auto-recharge), OpenAI dashboard cap.

1. **Pick one genuine Taylor change** to review (a small real diff/PR).
2. **Dry-run first (no spend):** Actions → **Reciprocal GPT Review** → Run workflow → `mode=dry-run`,
   `request_id` = e.g. `TAYLOR-REVIEW-001`, `diff_path` = the repo-relative diff. Confirm
   `contextSufficiency: SUFFICIENT`, `model: gpt-5.6-terra`, a realistic `inputTokensEstimate`,
   `estCostUsd` under $0.25, `wouldInvoke: true`. No call.
3. **Single live call:** re-run with `mode=live` (everything else identical). Expect **exactly one**
   provider call, a structured verdict, `usage.actualCostUsd` well under $0.25, and system-owned
   metadata populated (no nulls, no model-fabricated fields).
4. **Observe the chain (repo-safe, no second live call):** the structured result feeds
   `runReciprocalReviewCycle` — persisted to aiExchange, consumed per its verdict, selector recalculated,
   and the responsible Claude assignment reported as `WOULD_TRIGGER` (or an Owner surface for
   NEEDS_OWNER/protected). The actual Claude wake remains a separate, explicitly-authorized step.
5. **Event path (optional, later):** to move past manual dispatch, emit
   `repository_dispatch(type: eos-ai-review-eligible)` when a review becomes eligible — it runs the
   evaluator in the inert dry branch until you choose to wire live auto-invocation.

**Rollback / stop:** delete the `OPENAI_API_KEY` secret (every live run then refuses); the workflow never
fires on push/PR/clock. Ceilings refuse in-code; the dashboard cap is the backstop.

## After a successful one cycle

Do **not** enable unlimited autonomy. Return with `PASS / PASS_WITH_FINDINGS / FAIL`, exact lifecycle
evidence, GPT cost, Claude usage evidence (where exposed), Owner-interruption count, and defects — then
decide on a bounded 3-round Taylor cost pilot.
