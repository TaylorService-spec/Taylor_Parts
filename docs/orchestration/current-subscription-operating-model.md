# EOS Current-Subscription Operating Model — Signal Supervisor + Review Router

**Repo-safe: research + architecture + smallest useful implementation + tests.** No OpenAI provisioned,
no spend, no webhook/Firebase deploy, no secret, no overnight execution, no Wake pilot. Implementation:
[`lib/signalSupervisor.mjs`](lib/signalSupervisor.mjs) + [`lib/reviewRouter.mjs`](lib/reviewRouter.mjs);
tests alongside. This builds on the accepted #764 review contract — that architecture is **not** reopened.

**Frame.** AI providers are **workers** EOS invokes when reasoning is required. They are not the clock,
the queue, the authority, or the control plane. EOS classifies every signal deterministically and
token-free, verifies deterministically first, and calls an AI worker only when genuinely needed.

## 1. Search-first — capability & cost matrix

Cost columns are honest: *availability ≠ free*. Where a monetary figure isn't verifiable it is **UNKNOWN**,
never fabricated. Items marked **verify** are stated from general knowledge and should be confirmed against
the live plan before being relied on for spend decisions.

| Capability | Disposition | Cost class | What it gives EOS | Notes |
|---|---|---|---|---|
| **Claude Code / Claude subscription** | **ADOPT** | INCLUDED_SUBSCRIPTION (usage-limited) | The immediate repo-safe development + routine-review worker (this session) | Seat/usage limits apply — treat as USAGE_LIMITED near caps. *verify seat limits* |
| **GitHub Actions / GitHub events** | **EXTEND** | INCLUDED_SUBSCRIPTION (minutes-metered) | Deterministic verification heartbeat (tests/schema/provenance) + the event source | Already used for CI. Free-tier minutes are finite → USAGE_LIMITED at scale. *verify minutes* |
| **EOS Wake/Signal Supervisor (local)** | **EXTEND** | FREE_DETERMINISTIC | Token-free frequent inspection + classification; the real heartbeat | Built here (signalSupervisor). No AI cost. |
| **Deterministic local processes** (node:test, lint, drift guards) | **ADOPT** | FREE_DETERMINISTIC | The "verify first, don't call AI" tier | Already the bulk of gates. |
| **ChatGPT / ChatGPT Work / Scheduled Tasks** | **PILOT** | INCLUDED_SUBSCRIPTION | Independent scheduled/periodic reasoning (HOURLY+ latency) | **Schedule/pull-oriented, NOT a fast inbound GitHub-event wake** (confirmed earlier). Good for DAILY/WEEKLY independent review, not IMMEDIATE. *verify Tasks availability on the plan* |
| **MCP-supported options** (connected servers) | **INTEGRATE** | INCLUDED / UNKNOWN | Read/act surfaces during a worker run | Availability varies by session; headless/cron may lack interactively-authed servers. |
| **OpenAI API (async/background + webhook)** | **REJECT (now) / future PILOT** | PAY_PER_USE_API + INFRA_COST | Immediate independent GPT review on event | **NOT_CONFIGURED**; requires key + spend + endpoint. Optional future acceleration only. |
| **Immediate GPT review (any included path)** | **REJECT** | — | — | `NOT_CONFIGURED` — no included mechanism proven for *immediate* GPT review. |

## 2. Review-routing policy

Deterministic verification FIRST → least-expensive capable AI worker → stronger/independent reviewer only
when needed → Owner only for genuine judgment/authorization. Review classes (provider-neutral):

- **DETERMINISTIC** — schema/tests/provenance/policy-presence/contract-parity/prohibited-behavior/source
  freshness → no AI.
- **ROUTINE_AI** — bounded code/doc review, spec comparison, classification, summarization.
- **INDEPENDENT_AI** — architecture challenge, cross-domain reasoning, conflicting evidence, check-and-balance.
- **OWNER** — strategic tradeoff, material business decision, protected authorization.

The router (`routeReview`) never hard-codes a provider; concrete workers arrive as an injected registry.
It prefers **capable + available + authorized + lowest marginal cost** while respecting **independence**
and **latency**. Cheap-but-non-independent is never a substitute for a required independent review, and a
worker never certifies its own implementation (`excludeWorkerIds`).

## 3. Signal taxonomy & classification

Sources: `GITHUB_EVENT · CONTROL_PLANE_EVENT · TIMER · MANUAL` (+ recorded future seams `BUSINESS_SIGNAL ·
SOCIAL_SIGNAL · OPERATIONAL_SIGNAL`). Classifications: `IGNORE · RECORD · QUEUE · REVIEW_REQUIRED ·
OWNER_ATTENTION · URGENT`. Token-free short-circuits (no AI) for duplicates, already-resolved events,
unchanged state, known-expected activity, and mechanical validation. Only `REVIEW_REQUIRED` (and an
`URGENT` that declares `needsReview`) reaches an AI worker.

## 4. Latency taxonomy (separate from provider selection)

`IMMEDIATE · MINUTES · HOURLY · DAILY · WEEKLY`. This is what lets EOS decide whether a scheduled worker
(ChatGPT Work, HOURLY+) is acceptable or a faster worker is required — **without** making one-hour
scheduling an EOS-wide limitation. An HOURLY worker against an IMMEDIATE need returns `UNSUITABLE_LATENCY`
with `doNotSilentlyWait` — EOS surfaces it rather than quietly stalling.

## 5. Provider capability & cost model

Each worker carries `capacityClass` (FREE_DETERMINISTIC → INCLUDED_SUBSCRIPTION → USAGE_LIMITED →
ADDITIONAL_CREDIT → PAY_PER_USE_API → INFRA_COST → **UNKNOWN**), `subscriptionBound`, `apiMetered`,
`tokenBudget`, `latency`, `availability` (AVAILABLE / **NOT_CONFIGURED** / UNAVAILABLE), `authorized`,
`independent`. `NOT_CONFIGURED` is the honest seam: a paid path that exists in principle but is never
fabricated as available; if it is the only capable option, routing returns `NEEDS_ACTIVATION` (an Owner
decision), not a silent paid call.

## 6. Control Center projection

Two compact lanes (machinery stays progressively disclosed, not on the landing page):
`projectSignalBoard` (signals total · by class · **aiNeeded vs tokenFree**) and `projectRoutingBoard`
(deterministic · routed-to-worker · owner · owner-attention · unsuitable-latency · needs-activation ·
**paidApiUsed** · by capacity · ownerRelayCount). Reads like:

```
AI REVIEW   3 deterministic · 2 Claude(included) · 1 waiting for GPT Work(hourly) · 0 paid API · 0 Owner relay
```

## 7. Future business/social seam (recorded, NOT built)

The same **Signal → Router → Worker** path later serves market/problem discovery, social/Reddit signals,
customer-pain identification, lead/opportunity scoring, competitive/supplier signals, and content
opportunities. Hard boundary, encoded now (`DISCOVERY_BOUNDARIES` + `requiresOwnerAuthorization`):
**signal discovery ≠ permission to contact · lead score ≠ authorization to market · content draft ≠
authorization to publish · opportunity ≠ authority to spend.** Discovery signals classify to `RECORD`
only; any `CONTACT/MARKET/PUBLISH/SPEND` action requires explicit Owner authorization. No external
collectors are built in this phase.

## 8. How much can operate under current subscriptions?

**Answer to the direct question**, tiered:

- **WORKS TODAY (included, no new dependency):** the full deterministic tier (GitHub Actions + local
  node:test + drift/provenance/contract-parity guards); EOS Signal Supervisor classification + latency +
  routing; the Claude-worker development + routine-review path this session already uses; deterministic-
  first routing that avoids AI for duplicates/mechanical/unchanged state. This is the majority of gates.
- **WORKS WITH BOUNDED MANUAL TRIGGER:** independent GPT architecture review via the Owner relay
  (`MANUAL` source → INDEPENDENT_AI), and any AI review the Owner kicks off. Owner relay count is a
  measured metric, targeted at 0 for the automated paths.
- **WORKS WITH SCHEDULED LATENCY:** independent periodic reasoning via ChatGPT Work / Scheduled Tasks at
  **HOURLY+**, suitable for DAILY/WEEKLY independent review — *pilot, verify plan support.* Not suitable
  for IMMEDIATE needs (router enforces this).
- **NEEDS FUTURE INFRA:** an event-driven trigger service/endpoint + a durable runtime control-plane store
  (the #764 activation seams) — protected, Owner-gated.
- **NEEDS PAY-PER-USE API:** *immediate, event-driven, independent GPT review* — OpenAI async API + webhook.
  Optional future acceleration, only when required latency cannot be met by an included worker AND
  independent GPT review materially adds value. Currently `NOT_CONFIGURED`.

**Net:** EOS can run autonomous repo-safe development and the entire deterministic + routine-AI (Claude)
+ Owner-relay review chain **today, on current subscriptions**, with independent GPT review available at
**scheduled (hourly+) latency** or via **bounded manual relay**. The only capability that genuinely needs
pay-per-use API is *immediate event-driven independent GPT review* — and the contract already models it as
an explicit, fail-closed, Owner-activated seam rather than a silent dependency.

## 9. Remaining gaps

- ChatGPT Work / Scheduled Tasks availability + exact latency floor on the Owner's plan — **verify**.
- GitHub Actions minutes headroom at higher cadence — **verify** (USAGE_LIMITED risk).
- A concrete injected **worker registry** with real capacity/latency/availability values (this phase ships
  the model + fakes; the live registry is a small follow-on once the above are verified).
- The event-driven trigger service + runtime store remain protected activation seams (#764), not built.
