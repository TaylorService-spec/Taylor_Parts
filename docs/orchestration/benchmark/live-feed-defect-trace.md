# Live GPT feed defect — trace, root cause, and fix

The first live Candidate-A benchmark passed its ceilings but exposed a wiring defect: the paid request
was the **legacy full-context payload**, not the fact-based feed, and the token-category instrumentation
reported zeros against a real 7,498-token request. This document proves the source before the fix (trace
first), then records the correction.

## Observed (live Candidate A)

- `openAiSpendUsd` 0.027464 · input **7,498** / output 1,039 · pass true · 1 GPT call · 1 wake · 0 relays.
- Input reduction vs the #319 baseline (7,620): **~1.6%** — the intended fact-feed optimization did **not** happen.
- Instrumentation reported every token category = 0 and `estimatedTotal = 0`, while the provider measured
  `measuredInputTokens = 7498`. `artifactsCreated/Reused/hashesReused` were all 0 during the paid exchange.

## Trace (end to end, proven by reading the code, not inferred)

```
taylor-benchmark.mjs --activate
 → runInstrumentedPilotCycle(... gptRunner: realGptRunner({boot, diff}) ..., feedBreakdown: {})   ← (old)
   → runReciprocalPilotCycle → runReciprocalReviewCycle → providerRunner(review)
     → realGptRunner  (docs/orchestration/context/reciprocal-pilot.mjs)
        contextText = readGoverningAuthorityText(boot)          ← reads the FULL governing-authority doc
        runOpenAIReview({ contextText, diff, ... })  (no prebuilt invocation)
          → buildReviewInvocation(...)  (docs/orchestration/lib/openaiReviewProvider.mjs)
              user = "Governing authority content (inlined minimum context):\n" + contextText   ← ~4.9k tok
                   + "Diff under review:\n" + diff                                                ← ~2.7k tok
          → transport → POST /v1/responses  (input = those messages + json_schema)
```

### The 7,498 input tokens, section by section (estimator reproduces 7,801; provider measured 7,498 — within tokenizer variance)

| Section | tokens | bytes |
|---|---:|---:|
| user: **authority CONTENT — full `orch-operating-model` inlined** | **4,917** | 19,889 |
| user: **DIFF under review (entire subject-785.diff)** | **2,663** | 10,655 |
| system | 66 | 261 |
| user: other context refs (names) | 76 | 301 |
| user: return-fields instruction | 44 | 176 |
| user: review subject | 23 | 91 |
| user: authority-id line | 11 | 41 |
| **TOTAL (sum of sections)** | **7,800** | 31,414 |

So the 7,498 tokens are the **full orchestration operating model (~4.9k) + the entire 10.6 KB diff (~2.7k)** —
precisely the "story, not facts" payload the objective forbids by default.

## Root cause (two independent defects)

1. **The fact-based feed was never on the live path.** `reviewFacts` / the content-addressed artifacts
   existed in the repo but the live provider path used `realGptRunner → buildReviewInvocation`, which inlines
   the whole governing authority + whole diff. The fact-feed was built by nobody at runtime.
2. **Instrumentation measured the wrong object.** `runInstrumentedPilotCycle` records whatever `feedBreakdown`
   it is handed; the benchmark passed `{}` (the fact-feed was never built), so every category was 0 while the
   provider independently measured 7,498. The two numbers described different things.

`artifactsCreated/Reused/hashesReused = 0` follow from #1: the content-addressed store was never invoked in
the live path.

## Fix (this change — repo-safe, no live call)

- **One canonical fact feed** (`reviewFeedInvocation.mjs`): `buildCanonicalReviewFeed` → `buildFactBasedInvocation`
  assembles a narrow QUESTION + concise REQUIREMENT + IMPLEMENTATION/SOURCE FACTS + DETERMINISTIC EVIDENCE +
  minimal RAW excerpts + PROVENANCE. DRY and LIVE consume the **same object**; the live transport transmits
  it verbatim (proven: `runOpenAIReview` receives the prebuilt invocation, not a rebuilt full-context one).
- **Token attribution measures the transmitted payload.** The breakdown is computed over the exact strings
  that become the messages, plus the structured-output schema as its own category; the estimate reconciles
  with the provider's measured input tokens (`reconcileTokens`, documented tolerance). `estimatedTotal = 0`
  against a real request is now impossible (a benchmark goal catches it).
- **Content-addressed artifacts participate.** The live path creates + stores request and facts artifacts and
  reports truthful `artifactsCreated` (2); reuse counts stay honestly 0 on a first run.
- **Legacy expanded path preserved.** `buildReviewInvocation` (full inlined context) remains for review
  classes that legitimately need it; ordinary bounded reviews route through the fact feed.
- **Dedup + wake-only recovery unchanged.**

### Candidate-A shape: OLD vs NEW

| | total est. input tokens | note |
|---|---:|---|
| OLD (legacy full-context) | **7,801** | full operating model 4,917 + full diff 2,663 + framing |
| NEW (fact-based feed) | **~1,091** | question 76 · facts 310 · authority 102 · deterministic 83 · raw excerpts 190 · provenance 67 · protocol 128 · schema 135 |
| **reduction** | **~85.7%** | repeated authority + whole-diff removed; only material facts + two minimal code excerpts remain |

What remains is independently sufficient for the verdict: the narrow question, the expected behavior, what
changed, the #291 precedent rule + the sole-write-authority invariant, the deterministic test/CI outcomes,
and the two material code hunks (the `onSnapshot` error callback and the Customer-cell branch).

## Verification without a live call

Proven with the captured live result, deterministic fixtures, a fake provider, and exact request-shape
instrumentation (`reviewFeedInvocation.test.mjs`, `reviewFeedWiring.test.mjs`, updated
`reviewInstrumentation` + `benchmarkReadout` tests). **No new OpenAI call was made.** A new paid call is
only justified later on a new genuine Taylor item.

## ACTIVATION_PATH_DEFECT (recorded; see README "Running the benchmark")

The supplied activation command assumed `D:\Taylor_Parts` could `git checkout main`, but `main` was owned by
another worktree, so the checkout failed, the benchmark file was missing, and the Owner needed manual
recovery steps. Recorded for a future runner: discover a valid current checkout → safe fetch → ff-only update
when eligible → verify the benchmark entry exists → internal DRY preflight → then prompt for the key →
activate. Not expanded into a full runner rewrite here (out of scope of the paid-feed defect).
