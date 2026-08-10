# Reciprocal GPT Wake — provider-neutral trigger DESIGN SEAM (design only)

**Status: DESIGN ONLY.** No paid credential provisioning, no bridge/Function deployment, no model
invocation. This is the ChatGPT/OpenAI-side analogue of the Claude Wake Supervisor — the seam that
lets an EOS AI_REVIEW reach a GPT *reviewer role via a supported API* (not a browser conversation) and
return a durable, consumable response. It **reuses** the existing contracts; it invents no new bridge.

## The flow (all stages already have a durable contract)

```
AI_REVIEW request            collaborationContract.mjs (requestType AI_REVIEW) + aiExchange.mjs (record)
   → C-7 context package     contextMap.buildContextPackage() — the SAME package mechanism (not bespoke)
   → supported model call     OpenAI reviewer role via API (below) — provider-neutral trigger interface
   → structured response      a schema-validated reviewer verdict (CONCUR/…/EVIDENCE_REQUIRED/NEEDS_OWNER)
   → AI exchange ledger        aiExchange.mjs — compact record (positions + refs + verdict + disposition)
   → selector                  resultConsumption + selectNextWork — the response becomes actionable work
   → wake responsible worker   wakeState/wakeSupervisor — trigger the worker that owns the follow-up
```

Every box except "supported model call" already exists on `origin/main`. This seam specifies only the
provider-neutral **trigger interface** + the OpenAI-side reviewer contract, as FUTURE_SEAMs.

## Provider-neutral trigger interface (both AIs implement the same shape)

A `ReviewTrigger` is the minimal contract any provider's reviewer role fulfills:

| Concept | Meaning | EOS source of truth |
|---|---|---|
| `requestId` / `exchangeId` | the durable AI_REVIEW | `collaborationContract` / `aiExchange` |
| `contextPackage` | the bounded, reproducible bootstrap | `contextMap.buildContextPackage()` |
| `reviewerRole` | which governed role is being invoked (e.g. `EOS-GPT-REVIEWER`) | config (per provider) |
| `invoke()` | provider-specific, async, non-interactive | Claude: `claude -p` (built); OpenAI: Responses API (design) |
| `structuredResponse` | schema-validated verdict + corrections + evidence refs | `aiExchange` verdicts + `--json-schema`-style contract |
| `deliver()` | write the response to the exchange ledger | `aiExchange.mjs` |
| `wake()` | make the response actionable + trigger the owner | `resultConsumption` → `selectNextWork` → `wakeState` |

The Claude side already binds this: `wakeSupervisor.buildClaudeInvocation()` is Claude's `invoke()`; the
context package is the bootstrap. The OpenAI side binds the same shape to a different `invoke()`.

## OpenAI-side EOS reviewer role (design — API, not a browser)

- **Invoke via the OpenAI Responses API asynchronously**, not by "waking a ChatGPT conversation." The
  reviewer is a governed *role* the EOS bridge calls with: the AI_REVIEW question + the C-7 context
  package (as input) + a **structured-output JSON schema** for the verdict (so the response is
  machine-consumable, never prose to be hand-parsed).
- **Async + webhook completion:** submit the review as a background/async response and receive
  completion via a webhook (or poll a response id) — matching how a supervisor consumes a long job
  without holding a session open. The webhook handler = `deliver()` → writes the compact record to
  `aiExchange.mjs`.
- **Structured verdict schema** (mirrors `EXCHANGE_VERDICTS`): `{ verdict:
  CONCUR|CONCUR_WITH_CORRECTION|NONCONCUR_ESCALATE|EVIDENCE_REQUIRED|NEEDS_OWNER|AUTO_RESOLVED,
  corrections:[…], evidenceRefs:[…], conclusion }`.
- **Do NOT** design around a browser ChatGPT session, a scraped UI, or the Owner copy/pasting. The
  reviewer is an API role; the Owner-as-conduit path (`ownerRelayed:true`) remains the *interim*
  reality until this seam is activated.
- **Reciprocity:** the same interface lets a GPT-originated request (`CHATGPT_TO_CLAUDE`) wake the
  Claude side — the `wake()` step routes it through `resultConsumption`/`selectNextWork` exactly like
  any other actionable durable state.

## What activation would require (Owner-gated, NOT in scope)

- A **paid OpenAI API credential** + its custody (a paid-service commitment).
- A **deployed bridge/webhook endpoint** (a Function/Cloud Run) + a **least-privilege service
  identity** scoped to the narrow review workflow only (never arbitrary access).
- The reviewer role's system contract (what the EOS-GPT-REVIEWER is authorized to opine on — governance/
  architecture/build-vs-buy — never to *authorize* a protected action; `AI recommendation ≠ authority`).

Until then: **contracts + seam only.** `ACCESS ≠ TRIGGER`; a durable message nobody is woken to consume
is not seamless collaboration — so the wake step is bound to the same durable selector both sides share.

## Invariants (carried from the Claude side)

- Bootstrap via the **shared C-7 context package** — never a wake-specific/provider-specific bootstrap.
- The reviewer **advises**; it never authorizes a protected action. Silence ≠ approval — an un-answered
  AI_REVIEW escalates via the collaboration contract's escalation, not a timeout-as-consent.
- No autonomous authority expansion; ceilings and protected boundaries unchanged.
