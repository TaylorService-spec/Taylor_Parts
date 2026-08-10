# OpenAI INDEPENDENT_AI Review — Activation Runbook (Owner)

**Everything in the repo is repo-safe and inert.** No key is stored or printed; nothing calls OpenAI.
This runbook is the ONLY way the first live call happens, and it is the Owner's action. Implementation:
[`lib/openaiReviewProvider.mjs`](lib/openaiReviewProvider.mjs) (adapter),
[`context/openai-review.mjs`](context/openai-review.mjs) (dry-run/live entry),
[`.github/workflows/reciprocal-gpt-review.yml`](../../.github/workflows/reciprocal-gpt-review.yml)
(manual-dispatch trigger).

## What is built (repo-safe, tested with a mock transport)

- **Adapter** — serves **INDEPENDENT_AI only**; reuses the C-7 minimum-context package and the #764
  structured result + failure taxonomy (no second queue/ledger/context). Fail-closed: insufficient
  context → `CONTEXT_INSUFFICIENT`; provider error → `PROVIDER_FAILED`; bad output → `MALFORMED_RESULT`;
  budget over ceiling → refuse with **no invocation**. A verdict never authorizes a protected action —
  that gate stays in `consumeReviewResult` (protected → `NEEDS_OWNER`).
- **No key in code.** The adapter never receives/logs a key; only the transport injects `Authorization`.
- **Deterministic/Claude tiers first.** The router (#765) sends work to GPT only when the class is
  `INDEPENDENT_AI` and no cheaper capable worker suffices; deterministic-sufficient reviews never reach
  the adapter.
- **Ceilings enforced in-code** (`PILOT_BUDGET`): **$0.25 / review**, **$10 pilot total**, **no auto-recharge**.

## Pilot ceilings

| Ceiling | Value | Enforced by |
|---|---|---|
| Per-review | **$0.25** | `guardBudget` — refuses before any call |
| Pilot total | **$10.00** | `guardBudget` — refuses when cumulative + next > $10 |
| Auto-recharge | **OFF** | `PILOT_BUDGET.autoRecharge = false` + OpenAI billing setting (Owner) |

Pricing is an **injected estimate** (`DEFAULT_PRICING_ESTIMATE`, **gpt-5.6-terra ≈ $2/$12 per 1M**) —
**verify at openai.com/api/pricing** before relying on the cost math.

**Model is required and fail-closed.** The model comes ONLY from the repo variable `OPENAI_REVIEW_MODEL`
(expected `gpt-5.6-terra`). If it is unset or a placeholder, a live invocation **refuses before any
provider call** (`MODEL_NOT_CONFIGURED`) — it never silently picks another model. The live request uses
the current **Responses API** (`POST /v1/responses`) with **strict `json_schema` structured output** (not
the legacy `json_object` mode), aligned to the #764 result fields.

**Cost estimate reflects the complete payload.** `inputTokensEstimate` counts the full transmitted
messages, including the **inlined governing-authority content** (a stateless reviewer can't open files),
not bare pointers. A configured dry-run shows ≈ 5,100 tokens / ≈ $0.028 for the governing authority alone
(the earlier 221 was a pointers-only placeholder run); a real diff adds on top, and the $0.25 ceiling
refuses anything larger before calling.

## Activation steps (Owner — crosses the boundary)

1. **Confirm OpenAI billing caps** in the OpenAI dashboard: a hard monthly usage limit (≈ $10 for the
   pilot) and **auto-recharge disabled**. The in-code ceiling is a second belt; the dashboard cap is the
   backstop.
2. **Set the repo secret + model variable** (Owner does this — never share the key value with the agent):
   `Settings → Secrets and variables → Actions` → secret `OPENAI_API_KEY`, and **variable**
   `OPENAI_REVIEW_MODEL = gpt-5.6-terra` (required — the live run refuses without it).
3. **Dry-run first (no spend):** run the workflow **Reciprocal GPT Review** via *Run workflow* with
   `mode = dry-run`. Confirm `contextSufficiency: SUFFICIENT`, `model: gpt-5.6-terra`, a realistic
   `inputTokensEstimate`, `estCostUsd` under $0.25, and `wouldInvoke: true`. No call is made.
4. **First live review (one, watched):** run the workflow with `mode = live` and a small `diff_path`.
   The job refuses if the secret is missing. Expect a single structured result (verdict + conclusion +
   corrections) and a `usage.actualCostUsd` well under $0.25. This is the first real spend.
5. **Verify consumption:** the structured result flows through the existing `consumeReviewResult` gate —
   a protected target still routes to `NEEDS_OWNER`; a CONCUR on non-protected work makes the responsible
   Claude worker eligible. Owner relay count for this path = 0.

## Rollback / stop

- **Stop instantly:** delete the `OPENAI_API_KEY` repo secret — every live run then refuses at step 4.
  The workflow is `workflow_dispatch` only, so nothing runs on its own.
- **Budget breach:** the per-review/pilot ceilings refuse in-code before calling; the OpenAI dashboard
  cap is the backstop. Lower either at any time.
- **Full disable:** remove/rename the workflow file; the adapter then has no entry and stays inert.

## Boundary

Do **not** cross step 4 (first live call) without explicit Owner authorization for that run. Registering
the secret, dry-running, and merging this code do **not** constitute that authorization — the live
dispatch is the discrete act.
