# Taylor one-trigger reciprocal-review benchmark

Durable record of the FULL AUTONOMOUS TAYLOR BENCHMARK build, and the single Owner
activation that runs it. Everything below is repo-safe and already merged; the only step
that spends money or makes a live call is the one `--activate` command in
[Running the benchmark](#running-the-benchmark), which is the Owner's supervised action.

> **Architecture principle.** *Facts travel, story stays home.* Claude does discovery under
> subscription and classifies facts; the paid GPT API spends its tokens on independent
> judgment over the minimal material set. AI messages carry **references**; durable EOS
> artifacts carry the **substance**. Do not search when you can address; do not resend when
> you can reference; do not re-review when the reviewed hash has not changed.

## Phase A — review-feed improvements (merged, repo-safe, no live OpenAI)

Pure, zero-dependency ESM under `docs/orchestration/lib/`, each wired into
`orchestration-collaboration-tests.yml`. None of these redesign the selector, Wake
Supervisor, authority model, aiExchange lifecycle, provider routing, or review semantics.

| # | Item | Module | PR |
|---|------|--------|----|
| 1,3,4,5 | Durable content-addressed artifacts + SHA-256 verify + manifest/index | `reviewArtifacts.mjs`, `reviewManifest.mjs` | #779 |
| 6 | Fact-based GPT feed (classify DETERMINISTIC/SOURCE/CLAUDE_ANALYSIS; minimize to material) | `reviewFacts.mjs` | #780 |
| 7,8 | Narrow-question + compact `{verdict, findingRefs}` result contract | `reviewQuestion.mjs` | #780 |
| 10 | Delta / correction review — re-ask only changed material, never re-review an unchanged subject | `reviewDelta.mjs` | #781 |
| 2,9 | Content-hash dedup + wake-only recovery (two guards on the paid call) | `reviewRecovery.mjs` | #782 |
| 11,12 | API-efficiency + timing instrumentation | `reviewInstrumentation.mjs` | #783 |
| — | Instrumented pilot (timing + efficiency + recovery over the existing cycle) | `reciprocalPilotInstrumented.mjs` | #784 |
| — | Benchmark readout + ceiling assessment + durable result artifact | `benchmarkReadout.mjs` | #787 |
| — | Canonical fact-based invocation (the LIVE feed) + per-section/schema token attribution + safe diagnostic + reconciliation | `reviewFeedInvocation.mjs` | this PR |

Data hygiene: content-addressed artifacts fail closed on any hash mismatch; the fact feed
never carries whole files, transcripts, the operating model, unchanged authority, or process
narrative; results are compact; a failed wake never re-spends a provider call.

## Phase B — Candidate A (the benchmark subject)

**Issue #785 / PR #786** — *Equipment detail: distinguish a failed customer read from a
genuinely-unknown customer.* `useAccount` now returns `{account, loading, error, retry}`
with a fail-closed error callback (the single-document sibling of #291's Location fix);
`EquipmentDetail.jsx` renders **"Customer unavailable" + Retry** on a failed read and
**"Unknown customer" only when confirmed-absent**. Pure outcome logic is covered by
`test/accountSubscription.test.mjs`; a dedicated CI workflow
(`equipment-detail-context-tests.yml`) covers these previously-uncovered read hooks. No
Rules / security / authority / architecture / deploy changes.

PR #786 stays **open** — it is the subject the benchmark's reciprocal review evaluates. The
review consumes the **canonical fact feed** `subject-785-feed.mjs` (narrow question + concise
requirement + implementation/source facts + deterministic evidence + two minimal code excerpts
+ provenance), **not** the whole diff. `subject-785.diff` is retained as the evidence the
excerpts derive from; it is no longer transmitted wholesale.

### Live fact feed (corrected — see `live-feed-defect-trace.md`)

The first live run transmitted the **legacy full-context payload** (full operating model
~4.9k tok + entire diff ~2.7k tok = ~7.5k input) while the token-category instrumentation
reported zeros. That is fixed: an ordinary bounded review now routes through the canonical
fact-based invocation (`reviewFeedInvocation.mjs`), DRY and LIVE transmit the **same** object,
the token breakdown is measured over the **actual** transmitted payload and reconciles with the
provider's measured input, and content-addressed request/facts artifacts participate. Candidate-A
shape: **~7,801 → ~1,091 est. input tokens (~85.7% reduction)**. The legacy inlined-context
builder remains for review classes that legitimately need expanded context.

## Ceilings (hard)

`benchmarkReadout.mjs` → `BENCHMARK_CEILING`: **≤3 GPT paid calls, ≤3 Claude wakes, ≤3
reciprocal cycles, ≤$0.10 OpenAI spend.** The one-trigger run uses a single 1/1/1 cycle; the
≤3 caps are recovery/delta headroom and are enforced in the readout. Claude wake cost is
subscription-covered ($0 incremental cash); only OpenAI GPT is cash.

## Baseline (preserved, do not rewrite)

`BENCHMARK_BASELINE` — the instrumented #319 pilot (2026-08-10):

- #319 review GPT input **7,620** / output **1,351** / cost **$0.031452**.
- Full #319 pilot: **2** GPT paid calls / **$0.058488** total / **1** successful Claude wake
  / **0** Owner AI-to-AI relays.

The benchmark readout reports this run's paid-token account as a delta against these numbers,
so any regression is visible rather than hidden.

## PASS criteria

`assessBenchmark` returns `pass = true` when **all four ceilings are respected** and there
were **zero Owner AI-to-AI relays**. It also reports the efficiency goals — one paid call
when there is no correction, input no larger than the #319 baseline — as explicit signals.

## Running the benchmark

The benchmark is **DRY by default** — it prints the plan, ceilings, baseline, and the
activation command, and calls nothing:

```bash
node docs/orchestration/context/taylor-benchmark.mjs
```

The Owner performs the run with a single command, from an **up-to-date `main` checkout**
(`HEAD == origin/main`, so context freshness is `CURRENT` and the review is eligible — this
is the fail-closed staleness gate, working as designed), with the environment set:

```bash
node docs/orchestration/context/taylor-benchmark.mjs --activate
```

Requirements for `--activate` (each checked, and the run fails closed with a named reason if
missing): `OPENAI_API_KEY` (read at call time, **never printed or logged**),
`OPENAI_REVIEW_MODEL` (a concrete model id), and the local `claude` CLI (resolve with
`CLAUDE_BIN` if it is not on `PATH`). One live GPT review → persist → consume → selector →
one Claude wake → stop. The DRY run also prints the `requestDiagnostic` — the exact fact
sections + token sizes LIVE will transmit — so you can inspect the payload before spending.

### ACTIVATION_PATH_DEFECT (recorded)

The first activation command assumed `D:\Taylor_Parts` could `git checkout main`, but `main`
was owned by another git worktree, so the checkout failed, the benchmark file was missing, and
the Owner needed manual recovery. A future self-preflighting runner should: discover a valid
current checkout (one where `main` is checked out, or the current worktree if already on an
up-to-date `main`) → safe `fetch` → `ff-only` update when eligible → verify the benchmark entry
file exists → run the internal DRY preflight → then prompt for the key → activate. Until then,
run `--activate` from a checkout that already has `main` current (the benchmark entry itself
now performs a feed/fixture preflight before any key is read, so a missing entry fails cleanly).

## Durable result

`--activate` writes a content-addressed `result` artifact to
`docs/orchestration/benchmark/results/<stopped>-<sourceCommit>.json` (identity =
`result:<sha256>` over its canonical serialization) and prints the readout: `pass`,
per-ceiling status, the baseline delta, the timing summary, and the efficiency account
(`providerCalls`, per-category token breakdown, `duplicateProviderCallsAvoided`,
`wakeOnlyRecoveries`). The printed evidence carries no key, header, or transcript.
