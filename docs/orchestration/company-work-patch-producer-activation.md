# Company-Work PATCH_PRODUCER — Activation & Lifecycle (EOS-ISSUE-842)

**Everything in the repo is repo-safe and inert.** No live OpenAI/Cortex call is made by anything
merged here. This is the minimum governed path that lets real `project-keystone` Control Center
company work run through Cortex/Codex/OpenAI instead of staying entirely on Claude.

## Exact lifecycle

```
EOS company AgentRequest (mutating:true, allowedSurfaces under control-center/)
  -> governed binding + envelope (project-keystone, PATCH_PRODUCER execution profile GRANTED, budget/capacity)
  -> Cortex/Codex/OpenAI PATCH_PRODUCER execution (runCortexPatchProducer, cortexProviderAdapter.mjs)
  -> governed AgentResult carrying a deterministic, hash-bound proposed patch (never applied)
  -> independent Verifier PASS, bound to the exact request/result/patch identity (verifierAgent.mjs)
  -> durable EOS result/patch artifact (persistPatchProducerResult -> docs/orchestration/work-intake/results/)
  -> separate governed integration review (unchanged; still no auto-merge/deploy)
```

Proven end-to-end by a deterministic conformance test:
[`lib/companyWorkPatchProducerLifecycle.test.mjs`](lib/companyWorkPatchProducerLifecycle.test.mjs).

## What is built

- **`PATCH_PRODUCER` Cortex mode** ([`lib/cortexProviderAdapter.mjs`](lib/cortexProviderAdapter.mjs),
  originally produced for #835, reconciled and merged here) — a second mode alongside the unchanged
  `READ_ONLY_PILOT`. Eligible ONLY when `binding.project === "project-keystone"` and
  `binding.repo === "TaylorService-spec/project-keystone"`, and only when every
  `request.allowedSurfaces` entry lives under `control-center/`. No Taylor product mutation authority
  exists anywhere in this path.
- **Governed execution-profile binding** — `runCortexPatchProducer` now also requires a GRANTED
  `PATCH_PRODUCER` execution profile (`executionProfiles.mjs`'s `resolveExecutionProfile`) bound into
  the envelope. A request can only ever REQUEST a profile; only a governed authorization GRANTS one —
  no self-escalation, same invariant the Wake Supervisor's own capability profiles already enforce.
  The granted profile is recorded on the execution receipt (`receipt.executionProfile`).
- **Deterministic patch-entry validation** — every proposed file change is checked for: repo-relative
  path (no absolute path/traversal/symlink escape), the exact `control-center/` boundary, membership
  in the request's declared `allowedSurfaces`, a `utf8`-only body (no binary payload), a credential-
  pattern scan, and a strict sha256 hash-binding (tamper/mismatch fails closed) — both at provider-run
  time and again, defensively, immediately before persistence.
- **No apply/merge/deploy/route/authorize surface** — the adapter module exposes none of those
  functions (asserted by test); the durable store only ever receives the two governed EOS result/patch
  artifact paths, never the proposed source path itself.
- **Live-provider activation seam**
  ([`lib/cortexPatchProducerActivation.mjs`](lib/cortexPatchProducerActivation.mjs)) — reuses the
  EXISTING `createOpenAICredentialTransport` (`lib/openaiCredentialTransport.mjs`) and secret broker
  (`lib/secretProvider.mjs`) under a second, distinct authorization scope,
  `OPENAI_PATCH_PRODUCER` — the SAME `OPENAI_API_KEY` DPAPI secret, SAME spend-ledger mechanics, SAME
  broker capability-grant validation. No second credential mechanism was introduced. The credential
  path audit ([`lib/credentialPathAudit.mjs`](lib/credentialPathAudit.mjs)) classifies this seam
  `AUTHORIZED BROKER PATH` and asserts the capability passed to `broker.withCredential` is always one
  of a fixed, source-verified allowlist (`KNOWN_TRANSPORT_CAPABILITIES`), never a free-form string.
- **Fail-closed model resolution** — mirrors `openaiReviewProvider.resolveConcreteModel` exactly: an
  empty/placeholder configured model refuses BEFORE the broker/secret is ever touched
  (`MODEL_NOT_CONFIGURED`).

## Activation status (this issue)

**Not live, by design.** No `OPENAI_PATCH_PRODUCER_MODEL` (or equivalent) repo variable exists yet, so
`createCortexPatchProducerProviderRun` always resolves `MODEL_NOT_CONFIGURED` and refuses before
touching the broker or the `OPENAI_API_KEY` secret. This issue does not require a production
Keystone task and does not activate one. The seam exists so that when the Owner is ready for the
first real `project-keystone` Control Center assignment, activation is a **configuration + explicit
authorization act**, not a code change:

1. Set a concrete `OPENAI_PATCH_PRODUCER_MODEL` (same pattern as `OPENAI_REVIEW_MODEL`).
2. Issue a governed `OPENAI_PATCH_PRODUCER` authorization grant (`reviewAuthorization.mjs`,
   `capability: "OPENAI_PATCH_PRODUCER"`) bound to the exact `project-keystone` work item.
3. Grant the `PATCH_PRODUCER` execution profile for that specific request (never a standing default —
   `executionProfiles.mjs`'s `DEFAULT_PROFILE` remains `READ_ONLY_ANALYSIS`).
4. Run one watched dispatch; the durable result/patch artifact lands under
   `docs/orchestration/work-intake/results/<requestId>/`.
5. Integration (applying the proposed patch into `project-keystone`) remains a fully separate,
   already-governed step — this path never auto-applies, auto-merges, or auto-deploys anything.

## Approved path boundary (unchanged from #835, reconciled here)

`binding.project === "project-keystone"` AND `binding.repo === "TaylorService-spec/project-keystone"`
AND every `request.allowedSurfaces` path prefixed with `control-center/` AND a GRANTED `PATCH_PRODUCER`
execution profile bound to that exact request. Nothing outside that boundary is eligible; Taylor_Parts
product surfaces are never reachable from this path.
