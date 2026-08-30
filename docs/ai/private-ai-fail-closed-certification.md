# Private-AI fail-closed certification contract

Standing executable invariants proving that the private-AI governance promises hold against the
seeded Certification World (`eos-platform-certification`). The organizing claim, and the reason the
tests are ordered the way they are:

> **DATA PRESENT != AI AUTHORITY.** A refusal only means something once meaningful seeded
> operational data provably exists — an empty project refusing interpretation proves nothing.

## The two halves

| Half | Where | Needs | When it runs |
| --- | --- | --- | --- |
| Deterministic | `functions/test/certificationPrivateAiFailClosed.test.mjs` (plus the pre-existing `aiOperationalProvider.test.mjs`, `aiWorkOrderReadinessContext.test.mjs`) | Nothing — no network, no credentials | PR CI via `.github/workflows/private-ai-fail-closed-tests.yml`; locally `npm run test:privateAiFailClosed` |
| Live certification | `functions/scripts/certificationWorld/verifyPrivateAiFailClosed.mjs` | ADC read access; optionally a certification principal (`CERT_AI_PROBE_EMAIL`/`CERT_AI_PROBE_PASSWORD`) | Explicitly, during certification and security reviews: `npm run certify:privateAiFailClosed`. Deliberately **not** PR CI — routine CI must not depend on live Firebase. |

## Contract 1 — data exists but AI still fails closed

The CI test pins the world the live verifier expects — **1092 records, fingerprint `005ebb1b`,
47 employee→principal links** — computed fresh from `expectedRecords()`, so a world change must
consciously update the test in the same PR. The base world contains **no `work_orders` collection
and no `inventorySnapshot`** (field-service load is `fieldops_jobs`, which the readiness assembler
does not read); a test asserts that fact, so if a future world version adds a real assembler
source, the proof is forced to upgrade to it. Until then the data-present proof builds a work order
from seeded entities (real seeded part ids/names/skus, a seeded account) and shows it assembles
into a real interpretation context.

With that data present, `interpretWorkOrderReadiness` under the **real registry decision for
`eos-platform-certification`** must return exactly

```json
{ "speak": false, "origin": "EOS", "reason": "INTERPRETATION_NOT_PERMITTED_HERE" }
```

with **zero** provider resolutions, **zero** model invocations, and **zero** governed reads — the
refusal precedes the data. The live command proves the same ordering against the deployed callable:
the gate runs before the work-order lookup, so a probe id that exists nowhere still gets the exact
refusal rather than `not-found`.

`privateAiSyntheticOperationalInterpretation` **must remain `false`** for
`eos-platform-certification`; the CI test asserts it in the shipped snapshot, in
`config/environments.json`, and through `runtimeSyntheticInterpretationPermitted()`. Flipping it is
an Owner decision that must update that test deliberately.

## Contract 2 — the AI has no direct Firestore data authority

**Architecture classification: A — no AI Firestore principal exists.** Evidence:

- The Keystone runtime (`G:\private_ai_service_v0_2`, mirrored in project-keystone `gateway/`)
  contains no `firebase`, `firestore`, `GOOGLE_APPLICATION_CREDENTIALS`, or `google-cloud`
  reference anywhere in `app/`, `config/`, or its dependency set
  (`fastapi`, `uvicorn`, `httpx`, `pydantic`, `pydantic-settings`, `python-dotenv`, `PyJWT` — no
  Firebase/GCP SDK at all). There is no identity to deny because no client exists.
- On the EOS side, the CI test walks `functions/src/ai/` and asserts that every module except the
  allowlisted EOS assembler (`workOrderReadinessContext.ts`, a trusted EOS Function reading under
  EOS authorization) is free of Firestore markers, and that the provider path reads **only**
  `KEYSTONE_*` transport configuration — gateway key, tenant, Cloudflare Access service token —
  never a Firebase credential.
- Since no Keystone identity exists in GCP, there is no IAM binding to audit; the live command's
  world-verification reads run as the *operator's* ADC, not as any AI identity.

## Contract 3 — the governed context is the only data entrance

The envelope vocabulary is now **closed at the transport**: `assertOperationalEnvelope` refuses any
envelope, evidence item, or recommendation carrying a field outside the declared contract
(`AI_OPERATIONAL_ENVELOPE_INVALID`). This is the one behavior change this contract introduced — a
fail-closed tightening; previously an unknown field would have been forwarded verbatim. There is
therefore no key that could carry a Firestore document path, a collection name, a credential, or a
query instruction, because there is no key at all beyond the contract. Complementing that,
pre-existing tests prove the POST body is exactly the envelope and nothing else, and the new
seeded-world test proves a real envelope contains no collection name the assembler read from, no
document id it joined on, and no credential name. The model may interpret supplied facts; it has no
channel through which to fetch more.

## Contract 4 — fail-closed configuration

Held by the pre-existing suites, each reason distinct and asserted independently:
environment-not-synthetic (`INTERPRETATION_NOT_PERMITTED_HERE`, decided **before** provider
construction), provider absent (`PROVIDER_NOT_CONFIGURED`), provider unreachable/misbehaving
(`PROVIDER_UNAVAILABLE`), and every malformed, ungrounded, action-naming, or extra-field model
answer refused by the verifier with its own `MODEL_OUTPUT_*` reason. Transport failures are
sanitized — no status, endpoint, or credential survives into a refusal.

## What this work did NOT do

No private-AI activation, no secret changes, no Function deploys, no Firestore Rules changes, no AI
permission grants, no Certification World data changes, no production or sandbox data access, no
Cloudflare/DNS changes. The live command writes nothing and prints no credential values.
