# EOS Contextual Assistant — architecture

**Status:** foundation implemented, repository-only. **No production AI. No conversational writes. No API key required to merge.**

The assistant is an **EOS-native feature**. EOS owns the UX, the authorization, the governed tools,
the context, the audit trail, the evaluation and the cost controls. OpenAI is the initial model
provider and is **replaceable infrastructure**.

---

## 1 — The pipeline, and why the order is the security property

```
EOS UI
  → Assistant Gateway (trusted server identity)
  → context validation          reject cross-tenant / authority-shaped input
  → effective authority         EMPLOYEE-level union ∩ ACTIVE in this environment
  → tool authorization          ALLOW / DENY decided with NO retrieval
  → authorized retrieval        allowed tools only
  → context minimization        permitted results only
  → AI Provider Adapter         ← the first moment anything leaves EOS
  → OpenAI
  → answer → EOS UI
```

**Authorization completes before retrieval begins.** There is no interleaving in which a denied
tool's data exists and is then filtered out — it is never fetched, so it is not in the process.

`planToolExecution()` returns a plan and no executor; `assembleProviderPrompt()` accepts only
executed results. A caller physically cannot put denied data in a prompt, because no function
signature accepts it.

### The design this refuses

> Retrieve broadly, put it all in context, and instruct the model to only mention what the user may see.

That is not access control. It is a request, to a system under no obligation to honour it, about
data that has already crossed the trust boundary — defeated by an injected string, a summarisation,
a cache, or a provider-side log, none of which leave a trace in EOS.

**Mutation-proven:** changing the gateway to retrieve all candidates and filter afterwards fails
three security tests.

### Release blockers

| Path | Status |
|---|---|
| Browser → OpenAI directly | **does not exist** — no client-side provider call, no key reachable from Vite |
| Model → unrestricted Firestore | **does not exist** — tools wrap trusted reads; no tool queries Firestore directly |
| Retrieve unauthorized data → ask the model not to reveal it | **structurally impossible** — see above |
| Model → operational mutation | **does not exist** — no write seam in the registry, asserted by test |

---

## 2 — Provider abstraction

`AiProvider` — `respond`, optional `stream`, `health`, normalized errors, provider/model metadata,
usage metadata. Each adapter is the only file that knows its vendor exists.

**Three providers now implement it:** `OpenAiProvider`, `AnthropicProvider` and `SelfHostedProvider`
(the Private AI Gateway). Adding the latter two required **no change to this gateway and no change
to any domain file**, which is the evidence the seam is in the right place. Which provider a given
request may use is a governed policy decision, documented separately in
[`eos-ai-provider-policy.md`](eos-ai-provider-policy.md) — including why a private-only request can
never fall back to an external vendor when the private model is down.

**EOS asks for a workload class, never a model.** `ROUTINE` / `REASONING`; the provider owns model
selection. No model id from any deployment appears in EOS domain code.

**Contained inside the adapter:** SDK usage, request shape, model ids, retry policy, error
translation, token accounting. **EOS domain code must never import a provider SDK** — a
`catch (e) { if (e instanceof OpenAI.APIError) }` in domain code is the boundary already broken,
which is why errors are normalised at the seam.

**No SDK dependency yet, deliberately.** `fetch` is injected, so the architecture, the contract and
every security test are complete and runnable before a key exists and before a package is added.

Normalized error codes are chosen by *what EOS does differently*: `UNAVAILABLE`, `TIMEOUT`,
`RATE_LIMITED`, `AUTH`, `INVALID_REQUEST`, `CONTENT_FILTERED`, `UNKNOWN`. The default is `UNKNOWN`
rather than a convenient bucket — classifying an unrecognised failure as transient would make a real
misconfiguration retry forever.

**`CONTENT_FILTERED` is never reported to a user as an EOS authorization decision.** A provider
refusing is not EOS denying.

---

## 3 — Secret boundary

The API key lives **only** in trusted backend secret configuration. Never in the browser, the Vite
client environment, Firestore, the repository, seed data, or logs.

- No code path returns it in a response.
- `health()` reports *configured / not configured* — never echoes any part of a credential.
- Transport failures throw **our** message, not the raw error, because a raw network error can carry
  the request headers and the headers carry the key.
- An unconfigured provider throws `AUTH` **loudly**. Returning empty text would look like a model
  with nothing to say and hide the outage.

Operator setup: `docs/runbooks/openai-secret-setup.md`. It contains no key.

The same rules apply verbatim to the Private AI Gateway key and to the Anthropic key. The gateway
adds one boundary of its own: **EOS never speaks to a model runtime directly** — the gateway is the
only local-model boundary, enforced by CI grep and by test. See
[`eos-ai-provider-policy.md`](eos-ai-provider-policy.md) §2.

---

## 4 — Context model

The client sends **location and intent**. The server derives **authority**.

Accepted: `companyId` (verified), `actorUid` (verified), `route`, `surface`, `record` (type + id),
`subView`, `question`, `conversationId`, bounded `history`.

**Refused, loudly:** `capabilities`, `roles`, `permissions`, `effectiveAuthority`, `isAdmin`. These
are rejected rather than silently dropped — dropping lets a caller keep trying variations until one
is honoured. A `companyId` naming another tenant is a cross-tenant read attempt and is refused.

**History is capped at 6 turns.** An unbounded transcript is three problems at once: unbounded cost,
a widening surface for injected instructions to persist, and protected data outliving the
authorization that permitted it.

### Conversation isolation

The boundary is **(company, actor, conversation, record)**. Changing the record drops history — the
cheap mistake is keeping it because the conversation id did not change. Dropping is the fail-safe
direction: losing "and what about the other one?" is an inconvenience; carrying Customer A's
balances into a question about Customer B is a disclosure.

---

## 5 — Governed tool registry

A tool is a **thin wrapper over an existing trusted EOS read**. It must not query Firestore
directly, must not assemble its own projection, and must not exist unless a truthful governed read
path already does.

**When no trusted read exists, a GAP is recorded.** A missing tool makes the assistant less capable;
an invented one makes the authority model fictional. `recordGap()` exists for exactly this.

**A tool declaring no required capability cannot be registered** — it throws. Every EOS business
object is governed, so an empty requirement is far more likely an omission than a design, and the
cost of being wrong is unauthorized data reaching a model.

**There is no mutation seam** — not a disabled one, not a flagged one. A registry with a `write`
field is one boolean away from conversational mutation.

---

## 6 — Employee-level authority

Authority is the **union** of business Roles, functional Roles and the legacy compatibility Role,
intersected with what is **active in this environment**.

This is not a preference. On 2026-08-21 the governance program found both General Manager employees
holding every `admin.*` capability: the governed Role correctly held none, and the compatibility
Role on the *person* handed them all back. **A role-level check would authorize the assistant on a
model of authority the server does not use.**

A capability that is **granted but inactive** is refused exactly like one that is not held — the
user cannot do the thing either way, and the distinction belongs in the audit record, not the answer.

---

## 7 — V1 behaviour

**May:** answer, summarize, explain screens and statuses, identify the next likely step, identify
blockers, identify related permitted records, answer "where do I go?", explain why something is
unavailable, provide navigation targets, compare permitted data.

**Must not:** transfer, receive, count, reconcile, adjust inventory, mutate a PO / Sales Order /
Opportunity / Work Order, invoice, take payment, record an adjustment, assign a Role, activate a
capability, delete, or issue any write command.

Asserted by test: every registered tool requires a `.read` capability, and no tool carries a
`write`/`mutate` seam.

---

## 8 — UI architecture

**One shared "Ask EOS" experience**, not a chatbot per page.

| | |
|---|---|
| Desktop | right-side panel / drawer |
| Mobile | persistent Ask EOS button → bottom-sheet interaction |
| Touch target | minimum 44×44, preferably 48×48 |
| Safe areas | respect iPhone safe areas |
| Header | must not crowd hamburger / notification / logout controls |
| Visual language | the existing EOS design system — no new one |

Starter questions are **contextual and authority-filtered**: two people on the same screen see
different starters, and that is correct. A technician who cannot read balances is not invited to ask
about them and then refused.

**No starter is phrased as an action** — V1 cannot perform one, and a starter that promises a
mutation is a lie the product tells before the model gets a chance to. Asserted by test.

A starter whose tool has not shipped is **hidden**, not offered — an offer that always fails teaches
users to distrust the feature faster than an absence does.

---

## 9 — Answer contract

Every operational claim carries a basis:

| Basis | Meaning |
|---|---|
| `KNOWN_FROM_EOS` | a governed tool returned it |
| `DERIVED_FROM_EOS` | deterministic inference over permitted results — arithmetic, not new facts |
| `GENERAL_GUIDANCE` | not specific to this company's data |
| `UNKNOWN` | insufficient **permitted** data |

`validateAnswerContract()` enforces the checkable property: a claim asserting EOS fact must name the
tool it came from, and a tool that never executed cannot support anything. That turns "the model made
it up" from an invisible failure into a structural one.

**Never fabricated:** balances, assignments, customer history, equipment ownership, order state,
payment/AR state, authority state, part locations. Preferred output:
*"I don't have enough permitted EOS data to determine that."*

**When nothing was permitted, the provider is not called at all** — spending money to produce a guess
is the outcome the contract forbids.

---

## 10 — Provenance

Retained internally: tools called, business records accessed, authorization decision, context id,
provider/model, correlation id, outcome.

Answers prefer **human identifiers** — WO number, customer name, part number, SO/PO number — over
raw Firestore ids, and the system instruction says so.

---

## 11 — Audit and retention

**Full prompts and responses are NOT captured by default.**

A transcript store would accumulate, in one collection, every customer detail, balance and work-order
note anyone ever asked about — assembled from many authorization decisions, retained under none of
them, readable by whoever can read that collection. It would become the highest-value and
least-governed dataset in the platform, created as a side effect of logging.

Recorded instead: actor, tenant, timestamp, surface, route, record ref, tools requested / allowed /
denied, records accessed, provider, model, usage, latency, outcome, error class, correlation id.

`FORBIDDEN_TELEMETRY_FIELDS` is asserted by test rather than trusted to review — it is the list that
quietly grows when someone adds "just the question" to help with debugging.

**Enabling transcripts is a separate, explicit privacy/retention decision.**

---

## 12 — Cost and usage

Provider-neutral: provider, model, input/output tokens, request count, latency, errors, tenant, user,
surface, optional `estimatedCostUsd`.

**No prices in domain code.** Cost is carried through if an adapter supplied it. Embedding a
per-1k-token rate would make a vendor price change a domain code change and would silently produce
wrong reports the moment a contract rate differed from a published one.

Prepared for: subscription-tier limits, tenant quotas, model routing, safe caching, cheaper-model
routing, usage analytics.

---

## 13 — Resilience

**AI is optional assistance, never a transactional dependency.**

Provider unavailable → the page works, the governed workflow works, the assistant reports
unavailable, authorization is unchanged, and there is **no hidden retry loop**. A request that
quietly retries for a minute is indistinguishable to a user from a broken page and hides the outage
from telemetry. Exactly one attempt, asserted by test.

---

## 14 — Security tests

`functions/test/assistantSecurityBoundary.test.mjs` — 18 assertions, all using a **spy provider**
that captures the exact prompt, so a leak is an observable fact rather than a judgement about wording.

| Test | Proves |
|---|---|
| Authorized | allowed tool runs; permitted data reaches the provider |
| Unauthorized | **the denied tool never executes**; its data never reaches the provider |
| Denied tool ids | not named to the provider — the id itself describes what the actor cannot reach |
| Granted-but-inactive | refused exactly like unheld |
| Cross-persona | same question, different retrieval; technician calls no provider at all |
| Prompt injection | "Ignore permissions…" changes no authority and no retrieval |
| Client authority fields | refused, not ignored |
| Cross-tenant | refused |
| Record switch | A → B drops A's context |
| Provider unavailable | graceful; exactly one attempt; authority unchanged |
| Employee-level | compatibility Role included in effective authority |
| Read-only | no write seam; every tool requires a `.read` |
| Answer contract | claims citing unexecuted tools are violations |
| Telemetry | no prompt/answer/payload; nothing billed when no provider was called |

**Mutation-proven.** Retrieving all candidates then filtering → 3 tests RED. Naming denied tools to
the provider → 1 test RED. Restored → 18 GREEN.

---

## 15 — Evaluation

Runs against the **Certification World**, not a purpose-built AI dataset — a bespoke dataset would be
tuned, however unintentionally, to the answers the assistant already gives and would grade the model
against itself.

Case contract: **persona → page → golden fixture → question → required tools → permitted facts →
prohibited facts → expected characteristics → result.**

Categories: authorization correctness, factual correctness, hallucination, completeness, clarity,
navigation usefulness, next-action usefulness, refusal correctness, persona appropriateness,
**prohibited-data leakage**.

**`PROHIBITED_DATA_LEAKAGE` is pass/fail and is never averaged.** An answer that is accurate, clear,
complete and contains one impermissible fact is a release blocker. Averaging would let a good model
buy its way past a security failure.

Second, subtler blocker: **an answer produced without its required evidence**. The text may be
correct and still be a guess, and right-by-accident is indistinguishable from right-by-evidence in
prose — so it is caught structurally.

---

## 16 — Phase plan

| Phase | Scope | Status |
|---|---|---|
| **A** | Provider + security architecture | **built** |
| **B** | Governed tool registry | **framework built**, concrete tools pending |
| C | Customer / Work Order / Parts vertical proof | next |
| D | Shared Ask EOS UI | architecture defined, components pending |
| E | Certification World question evaluation | schema built, corpus pending world seeding |
| F | Broader EOS read coverage | future |
| G | Explicitly confirmed governed actions | **separate from V1** |
| H | Provider routing / optional self-hosted model | **built**, disabled by default — see [`eos-ai-provider-policy.md`](eos-ai-provider-policy.md) |

**Write actions remain outside V1 entirely.**

---

## 17 — Open Owner decisions

1. **Transcript retention** — default is no full prompts/responses. Enabling is a separate privacy decision.
2. **Model selection and spend ceiling** — which model, and the per-tenant quota.
3. **Tool coverage order** — Phase C names Customer / Work Order / Parts; confirm the order.
4. **Starter question wording** — drafted from the Owner's own examples; confirm as product copy.
