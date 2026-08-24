# EOS AI provider policy — architecture

**Status:** implemented, repository-only. **Self-hosted AI is DISABLED by default. Nothing is deployed. Merging this activates nothing.**

This document covers the provider *routing* boundary. The authorization boundary — which EOS data
may be retrieved at all, and why authorization completes before retrieval begins — is
[`eos-contextual-assistant.md`](eos-contextual-assistant.md) and is unchanged by this work.

---

## 1 — The path

```
EOS UI (browser)
  → trusted EOS server                    ← the only thing the browser talks to
  → AI provider policy                    ← decides WHO may see this, before anything is sent
  → canonical AI provider contract        ← AiProvider: respond / health / normalised errors
  → selfHosted | openai | anthropic
       ↓
  Private AI Gateway (http://127.0.0.1:8080)
       ↓
  model routing, rate limiting, metering, audit
       ↓
  Qwen (fast / deep)
```

The browser appears exactly once, at the top, and never again. There is no arrow from a client to a
provider, and no configuration a client bundle can read.

---

## 2 — Invariants

1. **EOS never calls a model runtime directly.** The Private AI Gateway is the only local-model
   boundary. Reaching past it to a model port would drop authentication, the tenant boundary, rate
   limiting, backpressure, metering and audit in one step — while still looking, from EOS, exactly
   like the gateway adapter. *Enforced by CI grep and by test.*
2. **Provider credentials are server-only.** Read from trusted backend configuration at call time.
   Never in React, `import.meta.env`, Hosting, a bundle, `localStorage`, Firestore, seed data, the
   repository, or a log line. *Enforced by a test that walks the client tree.*
3. **Customer-data routing is intentional, never failure-driven.** The selection function is
   synchronous and pure and has **no parameter through which a failure could arrive**. A caller
   cannot re-run it "now that the private one is down" and get a different answer, because *down* is
   not an input.
4. **`PRIVATE_ONLY` cannot silently fall back.** A private outage produces a governed
   service-unavailable outcome. *Mutation-proven: adding a fallback fails two tests.*
5. **Provider-specific model names do not belong in EOS domain logic.** EOS names a *workload class*;
   the provider owns model selection.
6. **AI gains no business authority from being able to reason about data.** No write seam, no tool
   that mutates, no action.
7. **Existing governed reads and commands remain the authority boundary.** The provider layer is
   below them and cannot widen them.
8. **Self-hosted inference is a provider, not a permission system.** Running a model privately
   changes *where* inference happens, not *what a user may see*.

---

## 3 — The design this refuses

> try the private model; if it fails, send it to OpenAI

That is a data-governance decision made by an outage. It routes precisely the traffic an operator
was most careful about — the private-only traffic — to an external vendor at the moment nobody is
watching, and it leaves no trace, because from the caller's side it simply worked.

**Availability is not consent.**

So the ban is structural rather than advisory. `selectAiProvider(config, { dataClass })` takes
configuration and a data class and nothing else. There is deliberately **no** exported function that
accepts a list of providers and tries them in order; a test asserts by name that no such entry point
has appeared.

---

## 4 — The policies

| Policy | Private available | Private unavailable |
|---|---|---|
| `PRIVATE_ONLY` | private provider | **UNAVAILABLE** — external use prohibited, every data class |
| `PRIVATE_PREFERRED` | private provider | external **only if this data class was already permitted in configuration** |
| `FRONTIER_ALLOWED` | private preferred unless an external one is configured | external, intentionally |

`PRIVATE_PREFERRED` with an unconfigured permission list behaves **exactly like `PRIVATE_ONLY`** —
the safe direction for a setting someone will forget.

### Data classes

| Class | Meaning |
|---|---|
| `EOS_BUSINESS_DATA` | anything assembled from governed EOS reads. The default. |
| `NON_BUSINESS_DIAGNOSTIC` | fixed, operator-authored strings containing no EOS record. |

The distinction is not "sensitive / not sensitive" — that judgement is unmakeable per request. It is
what the data *is*, so a policy can be written about categories an operator can reason about.

---

## 5 — Workload class, not model name

EOS names the kind of thinking it needs. The gateway owns which weights answer.

| EOS workload class | Gateway mode | Currently routes to |
|---|---|---|
| `ROUTINE` | `fast` | `qwen14-32768` |
| `REASONING` | `deep` | `qwen32-8k` |

The right-hand column is a fact about this deployment today and appears **nowhere in EOS code**.
Changing it is a gateway change, not an EOS deploy. An unspecified workload class defaults to
`ROUTINE` — an unstated request must not silently buy the expensive model.

---

## 6 — Files

| File | Role |
|---|---|
| `functions/src/assistant/aiProvider.ts` | the canonical contract (extended additively: workload class, provider request id, queue wait) |
| `functions/src/assistant/aiProviderPolicy.ts` | policy selection. Pure, synchronous, failure-blind |
| `functions/src/assistant/aiProviderConfig.ts` | server-only configuration, tenant resolution, provider factory, redacted summary |
| `functions/src/assistant/selfHostedProvider.ts` | Private AI Gateway adapter |
| `functions/src/assistant/openAiProvider.ts` | unchanged |
| `functions/src/assistant/anthropicProvider.ts` | new, same shape |
| `functions/src/assistant/aiProviderDiagnostic.ts` | the first workload — reads nothing, writes nothing |
| `functions/scripts/aiProviderSelfCheck.mjs` | operator command that proves the path |
| `functions/test/aiProviderPolicyAndSelfHosted.test.mjs` | 31 tests. A failure here is a release blocker |

Three adapters that differ only in vendor-shaped parts is the evidence the seam is in the right
place: adding two providers required **no change** to the gateway or to any domain file.

---

## 7 — Error taxonomy at the gateway

| Gateway | Normalised | Retryable | Note |
|---|---|---|---|
| 401 / 403 | `AUTH` | no | both, because EOS does the same thing about either; the status survives as `providerCode` |
| 400 / 422 | `INVALID_REQUEST` | no | our bug |
| 429 | `RATE_LIMITED` | yes | backing off is the caller's decision, not a hidden retry |
| 503 | `UNAVAILABLE` | yes | load shedding. A busy private gateway is a queue to wait for — **never** a reason to route elsewhere |
| timeout | `TIMEOUT` | yes | a self-hosted queue can hold a request far longer than a hosted API |
| malformed body | `UNKNOWN` | no | a malformed success is a **failure**, not an empty answer |

Exactly one attempt per request, asserted by test.

---

## 8 — Tenant boundary

The gateway tenant is resolved **server-side from trusted configuration** and never from anything a
caller sent. A browser-supplied tenant id would let a user choose which gateway tenant their
question is metered and isolated under — handing the boundary to the party it exists to constrain.

There is **no default tenant**. `local-dev` baked into reusable code would make every unconfigured
environment share one gateway tenant, and a boundary that defaults to a shared value is not a
boundary. Unset ⇒ the provider is unavailable, loudly.

`companyId` is accepted by `resolveGatewayTenantId` so a future multi-tenant mapping has an obvious
home; it is currently unused. The first sandbox integration speaks as one explicitly configured
tenant.

---

## 9 — Observability

Recorded, through the **existing** provider-neutral telemetry: request id, tenant, provider, model,
workload class, input/output tokens, queue wait, duration, status/error class.

Not recorded: prompts, responses, tool results. The diagnostic records `receivedText: true` — a
boolean, never the text. *"It is only the diagnostic"* is exactly how a transcript store starts.

An absent queue wait is recorded as **absent, not zero**: zero reads as "no wait" and would hide a
saturated queue in exactly the deployment that has one.

---

## 10 — Configuration (server-side only)

```
AI_SELF_HOSTED_ENABLED=false            # exact-match opt-in; "TRUE"/"1"/"yes" do NOT enable it
AI_SELF_HOSTED_BASE_URL=http://127.0.0.1:8080
AI_SELF_HOSTED_API_KEY=<secret>
AI_SELF_HOSTED_TENANT_ID=<explicit tenant>

AI_ROUTING_POLICY=PRIVATE_ONLY          # unset or unrecognised ⇒ PRIVATE_ONLY
AI_EXTERNAL_PERMITTED_DATA_CLASSES=     # empty by default; an unrecognised entry is DROPPED
AI_PREFERRED_EXTERNAL_PROVIDER=

AI_OPENAI_ENABLED=false
AI_ANTHROPIC_ENABLED=false
```

Every default is off or restrictive. A provider that is implemented but uncredentialed is **not
available** — treating it as available would turn a configuration mistake into a runtime `AUTH`
error at the worst moment, after the policy has committed and there is no second choice by design.

**No key is in this repository and none may be added.**

---

## 11 — First workload, and what it deliberately is not

`runAiProviderDiagnostic` — a fixed operator-authored connectivity string. No EOS read, no EOS
write, no tool execution, no authority resolution, no retry, no second provider.

It is **server-only**: invoked from `scripts/aiProviderSelfCheck.mjs`, with no callable and no
route. Proving the plumbing does not require an HTTP surface, and adding one would be a deployment
and authorization decision this package does not make.

Proving the path with a real assistant answer would have meant shipping a user-visible feature whose
real purpose was plumbing, and putting governed customer data across a brand-new boundary on its
first day.

```bash
cd functions && npm run build && node scripts/aiProviderSelfCheck.mjs --health
```

---

## 12 — Activation

Merging this code activates nothing. Activation is a separate, deliberate act:

1. Set `AI_SELF_HOSTED_*` in the sandbox environment's trusted configuration (key never in the repo).
2. Set `AI_ROUTING_POLICY` explicitly.
3. Run the self-check and confirm a normalised result.
4. Only then consider a callable — which is its own authorization and deployment decision.

Per EOS deployment governance this is **merged-but-not-deployed** and is tracked for the next pooled
sandbox deployment. No individual sandbox deployment is authorized by this package.

---

## 13 — Open Owner decisions

1. **Which policy each environment runs.** Default is `PRIVATE_ONLY`; the Owner sets the real value.
2. **Whether `EOS_BUSINESS_DATA` may ever go external**, and under which policy.
3. **The gateway tenant id per environment**, and whether one tenant per operating company is wanted
   later (§8 leaves the seam).
4. **Whether the assistant gets a callable at all** — still Phase D of the assistant plan, unchanged.
