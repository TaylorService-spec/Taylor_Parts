# D-NATIVE-SEND-CONFIG — Firebase-Native Reset Sender: Configuration & Deployment-Boundary Package

> **STATUS: PENDING — NOT AUTHORIZED.**
> This is a **documentation-only** configuration + deployment-boundary package. It **defines** the concrete
> Firebase-native sender wiring and its production boundary; it **executes nothing**. It creates/modifies
> **no** secret, configures **no** Firebase, deploys **no** Functions/Rules/Hosting, accesses **no**
> production, creates **no** fixtures, sends **no** email, and does **not** begin AUTH-PROD-1. No secret
> value appears here. Merging this document authorizes **nothing** operational.

- **Gate:** D-NATIVE-SEND-CONFIG (config + deploy boundary; execution is a later, separately authorized gate)
- **Governing decisions:** [`DECISIONS.md`](../DECISIONS.md) #54 (no external provider), #55 (hard stops), #56 (D-DELIVERY-NATIVE), PRE-1 package + G-PRE1-IMPL, PRE-3 package + G-PRE3-IMPL
- **Merged code reconciled:** `main` `a29d540` — `functions/src/access/nativeResetSender.ts`,
  `adminCredentialCallables.ts`, `index.ts`
- **Sibling gates (NOT combined / NOT opened here):** D-PROD-1A/B/C (AUTH-PROD-1 execution); AUTH-PROD-2/3
  (deployment); D-PRE1-XKEY-RECON; D-RESET-PERMISSION-ACTIVATION
- **Preserves:** the PRE-1 dedupe/uncertain contract and PRE-3 audit coverage — unchanged.

---

## 1. Purpose and boundary

G-PRE1-IMPL built the concrete `createNativeResetSender({ outbound })` with a durable dedupe, wired in
production as `DEPLOYED_NATIVE_SENDER = createNativeResetSender({ outbound: null })` — **fail-closed**
(`isConfigured() === false`, no send). This package defines **what a later authorized gate would do** to
supply a real `outbound` (the Firebase-native `accounts:sendOobCode` adapter) and its Secret Manager
credential, the exact deployment bundle and boundary, the fail-closed transition, rollback, halt
conditions, evidence, and Owner decisions — **without doing any of it**.

**In scope (documentation):** the sender/config boundary; secret handling; deploy bundle + prohibitions;
the `outbound:null → configured` transition and its fail-closed invariants; environment confirmation +
emulator coverage; rollback; halt conditions; sanitized evidence; Owner decisions; sequencing vs
D-PROD-1A/B/C; permission-inactive confirmation.

**Not in scope / not authorized:** creating/reading/rotating any secret; configuring Firebase; deploying
Functions/Rules/indexes/Hosting; production access; fixtures; email; permission activation/grant;
implementing the `outbound` adapter; AUTH-PROD-1 execution.

---

## 2. Reconciliation to the merged implementation

| Concern | Merged state (source) |
| --- | --- |
| Sender factory | `createNativeResetSender({ outbound: OutboundNativeSend \| null })` (`nativeResetSender.ts:63`); `isConfigured()` returns `outbound !== null` (`:69`). |
| Outbound seam | `OutboundNativeSend = (args:{targetUid,email,idempotencyKey}) => Promise<{accepted:boolean}>` (`nativeResetSender.ts:29`) — **not implemented**; injected only. |
| Deployed wiring | `DEPLOYED_NATIVE_SENDER = createNativeResetSender({ outbound: null })` (`adminCredentialCallables.ts:216`), used by `adminSdkDeps().nativeSend` (`:222`) — fail-closed. |
| Deploy surface | `index.ts:88-89` exports `initiateAdminPasswordReset` + `listResetEligibleUsers` (export ≠ deploy). |
| Command behavior | With `isConfigured()===false` the command throws `DeliveryUnavailableError` before any side effect; dedupe/uncertain (PRE-1) + audit coverage (PRE-3) unchanged. |

**The single wiring change a later gate makes:** replace `outbound: null` with a concrete
`OutboundNativeSend` (built at the enablement gate) **only when** its Secret Manager credential is present
and valid. Nothing else in the command changes.

**Reconciliation supporting the credential scoping (§4):** the native sender is wired **only** into
`adminSdkDeps().nativeSend` (used by `initiateAdminPasswordReset`). `listResetEligibleUsers` is invoked with
`actorAuthorizationDeps()` — it has **no** `nativeSend` and calls no sender at all. So the sender secret is
needed **only** by `initiateAdminPasswordReset`; scoping it there (not to the list) matches the code.

---

## 3. Concrete `accounts:sendOobCode` adapter + configuration boundary

- **Adapter (to be built at the enablement gate, not here):** an `OutboundNativeSend` that calls the
  Firebase **Identity Toolkit REST** endpoint `accounts:sendOobCode` with `requestType=PASSWORD_RESET`
  and the target email, using the project's Web API key. Returns `{ accepted: true }` **iff** the endpoint
  returns HTTP 200 ("Firebase accepted the send request"); any non-200 → `{ accepted: false }`; a
  transport error throws (the sender/command already handle throw/uncertain per PRE-1). **No external
  provider** (#54); **no reset-link generation**; the response body / OOB code / link stay inside the
  adapter and are never returned, logged, or persisted.
- **Configuration boundary:** the adapter reads its credential and endpoint config **only** from the
  runtime secret/config surface (§4) at construction time. It never accepts a credential from client
  input, request data, or the command layer. `isConfigured()` stays the single attestation gate.
- **Non-sending validation contract (what `isConfigured()===true` attests).** Without calling
  `sendOobCode`, the adapter validates: the secret is **present** and **readable**; the key is **well-formed**
  (expected shape/length, non-empty); the key/project **ownership matches** the confirmed target project
  (§8); the key's **API restrictions** permit the Identity Toolkit endpoint and its **HTTP-referrer/IP
  restrictions** are compatible with a server call; and the Identity Toolkit API is **enabled** for the
  project. `isConfigured()===true` therefore attests the required configuration is **structurally and
  project-valid** — it does **NOT** attest that Firebase will accept an email request. **Actual send
  acceptance remains UNVERIFIED until D-PROD-1C** (the first real `sendOobCode`, post-deployment, §11). If
  any non-sending validation fails, the wiring stays fail-closed (§5).

---

## 4. Secret Manager secret + access / rotation / rollback / evidence (no secret value here)

- **Secret:** the Firebase Web API key (or a dedicated restricted key) used by `accounts:sendOobCode`,
  stored in **Google Secret Manager** — never in the repository, environment files committed to VCS, or
  client-readable config. **This document contains no secret value and never will.**
- **Secret scoped to the SENDING function ONLY (D-NSC-IDENTITY / D-NSC-SECRET-SCOPE).** Only
  `initiateAdminPasswordReset` calls the native sender; `listResetEligibleUsers` performs candidate
  discovery and **never** sends. Therefore:
  - The Web API key secret MUST be bound (per-function `secrets:` binding) to **`initiateAdminPasswordReset`
    only** — **not** to `listResetEligibleUsers`.
  - `initiateAdminPasswordReset` runs under a **dedicated, user-managed runtime service account** (NOT the
    shared default Functions SA); `secretmanager.versions.access` on this one secret is granted to **that SA
    only**, so no other workload — including `listResetEligibleUsers` — can read it.
  - `listResetEligibleUsers` is deployed **without** the sender secret and **without** any identity that can
    read it. If the list callable needs a dedicated runtime identity for other resources, it uses a
    **separate** least-privilege SA with **no** sender-secret grant.
  - If a dedicated identity cannot be used, an equivalent function-scoped mechanism proving that
    `listResetEligibleUsers` (and every unrelated workload) cannot access the secret must be documented and
    reviewed before wiring. Granted at the enablement gate, time-scoped/reviewed; no human reads it via this path.
- **Rotation:** rotate by adding a new secret version and updating the bound version on
  `initiateAdminPasswordReset`; the adapter reads the bound version at cold start. Rotation never touches
  `listResetEligibleUsers`, never requires committing a value, and a rotation that yields an absent/invalid
  credential MUST leave the sender fail-closed (§5), not degraded-open.
- **Rollback:** unbinding the secret from `initiateAdminPasswordReset` (or setting `outbound` back to
  `null`, §6) returns the sender to the fail-closed posture. Rollback requires no secret handling and does
  not affect `listResetEligibleUsers`.
- **Evidence (sanitized):** record secret **existence/version id/binding (initiate-only)**, the dedicated
  SA identity, and an attestation that **`listResetEligibleUsers` cannot read the secret** — **never** the
  secret value, key material, or any OOB code/link/email. Evidence → the AUTH-PROD evidence location at the
  execution gate.

---

## 5. `outbound:null → configured` transition + fail-closed invariants

- The enablement gate constructs `createNativeResetSender({ outbound: <adapter> })` **only when** the
  adapter passes the **non-sending validation contract** (§3: secret present/readable, key well-formed,
  project ownership match, compatible API/referrer restrictions, API enabled). If the credential/config is
  **absent or invalid**, the wiring MUST remain `createNativeResetSender({ outbound: null })` (fail-closed:
  `isConfigured()===false` → the command throws `DeliveryUnavailableError`, zero side effects). There is
  **no degraded/partial mode**: either a structurally + project-valid configured sender, or fail-closed.
- **Invariant:** `isConfigured()` may return `true` **only** when a structurally + project-valid outbound +
  secret are wired (per §3). It attests configuration validity, **not** send acceptance (unverified until
  D-PROD-1C). A missing/invalid secret can never produce `isConfigured()===true`.
- The transition changes **only** the `nativeSend` wiring in `adminSdkDeps()`; the command, dedupe,
  uncertain/reconciliation, and audit paths are unchanged.

---

## 6. Rollback to the fail-closed sender

- Rollback is: rewire `nativeSend` to `createNativeResetSender({ outbound: null })` (and/or unbind the
  secret). This restores the exact current fail-closed production posture — no send, no email, no OOB code.
- Rollback is non-destructive: no role/claim/`accessVersion`/Employee-link/session mutation; the PRE-1
  dedupe records and audit history remain immutable.

---

## 7. Exact Functions deployment bundle + prohibitions (deployment is a later gate)

- **Bundle = exactly two callables:** `initiateAdminPasswordReset` + `listResetEligibleUsers`. Nothing else.
  Only `initiateAdminPasswordReset` is deployed with the sender secret binding + the dedicated
  secret-access runtime identity; `listResetEligibleUsers` is deployed **without** the secret and **without**
  a secret-reading identity (§4).
- **Prohibited in the same deploy:** any other Function; Hosting; Firestore Rules; indexes; any AUTH-PR-4 /
  Inventory / Equipment artifact. No `firebase deploy` without `--only functions:initiateAdminPasswordReset,functions:listResetEligibleUsers`
  (exact target list) at the enablement/AUTH-PROD-2/3 gate.
- Export ≠ deploy: the two callables are exported today but not deployed; deployment happens only under a
  separate AUTH-PROD-2/3 authorization.

---

## 8. Environment/project confirmation + non-production emulator coverage

- **Environment confirmation (execution gate):** confirm the exact target Firebase project and that the
  secret/key belongs to that project before any wiring; a project mismatch is a halt condition (§9).
- **Non-production emulator coverage (repository-only, at the sender-adapter impl gate):** the adapter is
  emulator/unit-tested with the outbound faked (as G-PRE1-IMPL already does for the dedupe state machine):
  the non-sending validation gate (§3) drives `isConfigured()`; absent/invalid config → fail-closed;
  accepted/not-accepted/uncertain outcomes; no secret/link/code ever logged. **No real `sendOobCode` call
  in the emulator.**
- **Adapter-only evidence is NOT deployed-behavior evidence.** The emulator/faked-outbound tests prove the
  dedupe state machine and the config-validation gate — they do **not** prove the deployed callable, the
  dedicated runtime identity, the secret binding, or real-endpoint acceptance. Those are proven only by the
  post-deployment end-to-end D-PROD-1C (§11).
- **Least-privilege attestation (required at the deploy gate):** a deployment test/attestation MUST prove
  `listResetEligibleUsers` cannot read the sender secret — e.g. the deployed `listResetEligibleUsers` has no
  `secrets:` binding for it and its runtime SA lacks `secretmanager.versions.access` on it, while
  `initiateAdminPasswordReset` has both. A list function able to read the secret is a halt condition (§9).

---

## 9. Halt conditions

Halt and report (do not proceed) if: the target project cannot be confirmed or mismatches the secret; the
secret is absent, unreadable, or fails non-sending validation at wiring time (stay fail-closed);
`isConfigured()` would return true without a structurally + project-valid config (§3); the secret is
bound to `listResetEligibleUsers`, or readable by `listResetEligibleUsers`'s runtime identity, or by
anything beyond the dedicated `initiateAdminPasswordReset`-only secret-access identity; the deploy target is
anything beyond the two callables; a real send is attempted before deployment or outside D-PROD-1C; any secret
value, OOB code, link, or email would be logged or committed; or `admin.credentialReset.initiate` is found
active or granted.

---

## 10. Sanitized evidence

- Permitted: secret existence/version id/binding, access-grant attestations, deploy target list, project
  id, `isConfigured()` state, and pass/fail per check.
- Prohibited (never committed/logged): secret values/key material, OOB codes, reset links, action codes,
  email addresses, provider/endpoint bodies, raw Firebase responses.

---

## 11. Sequencing (D-NSC-SEQUENCE — deployment precedes the first real send)

The first real `sendOobCode` MUST verify the **deployed** callable (with its dedicated runtime identity,
secret binding, and production wiring) — a pre-deployment send could not. The coherent order (option a):

1. **D-PROD-1A (read-only preflight):** confirm project/config/fact-sources and that the sender is
   fail-closed (`isConfigured()===false`) — **no** secret creation, **no** wiring, **no** send.
2. **Sender-adapter implementation (repository-only):** build the `outbound` adapter + non-sending
   validation + emulator tests (outbound faked). Repo-only; no secret, no send.
3. **D-NATIVE-SEND-CONFIG execution (separate):** provision the Secret Manager secret + the dedicated
   secret-access identity bound to **`initiateAdminPasswordReset` only** (`listResetEligibleUsers` gets
   neither the secret nor a secret-reading identity); the adapter passes non-sending validation (§3) so
   `isConfigured()` is structurally/project-valid. Still **no** send.
4. **D-PROD-1B (bounded fixtures):** provision the disposable test personas.
5. **Narrowly-authorized deployment (AUTH-PROD-2/3):** deploy the exact two-Function bundle with the bound
   secret + dedicated runtime identity. No broader enablement.
6. **D-PROD-1C (end-to-end send verification against the DEPLOYED callable):** the **first** real
   `sendOobCode`, to the approved test recipient only — verifies the deployed callable, runtime identity,
   secret binding, and production wiring; bounded send count, duplicate-send + earlier-link checks. Adapter-
   only/emulator evidence does **not** substitute for this deployed verification (§8).
7. **Broader enablement** (permission activation/grant, real operator use) only after D-PROD-1C passes —
   each its own separate authorization (D-RESET-PERMISSION-ACTIVATION, etc.).

Each step is a **separate** Owner authorization; this package opens none of them.

---

## 12. Owner decisions (each with a recommended safe default)

| # | Decision | Options | Recommended default |
| --- | --- | --- | --- |
| D-NSC-ENDPOINT | Native send mechanism | (a) Function → Auth REST `accounts:sendOobCode` (PASSWORD_RESET); (b) any external/provider path | **(a)** — native, no provider (#54), matches PRE-1/D-DELIVERY-NATIVE |
| D-NSC-KEY | Credential | (a) dedicated **restricted** Web API key in Secret Manager; (b) reuse the general Web API key | **(a)** — least privilege, revocable/rotatable without wider impact |
| D-NSC-KEY-STORE | Secret location | (a) Google Secret Manager, per-function secret binding, least-privilege; (b) env/config | **(a)** — never in repo/client-readable config |
| D-NSC-SECRET-SCOPE | Which functions receive the sender secret | (a) `initiateAdminPasswordReset` ONLY (it alone sends); `listResetEligibleUsers` gets neither the secret nor a secret-reading identity; (b) both admin-reset functions | **(a)** — the list function never sends; binding it the secret needlessly widens the credential boundary |
| D-NSC-IDENTITY | Runtime identity for secret access | (a) dedicated user-managed SA assigned only to `initiateAdminPasswordReset` (or an equivalent proven function-scoped mechanism); list uses a separate SA with no sender-secret grant; (b) shared default / shared-across-both SA | **(a)** — a default or shared SA leaks the secret to unrelated / non-sending functions |
| D-NSC-VALIDATION | Meaning of `isConfigured()===true` | (a) non-sending validation only (secret present/well-formed, project ownership, API restrictions, enabled state); send acceptance unverified until D-PROD-1C; (b) claim send-verified at construction | **(a)** — construction cannot prove Firebase will accept a send |
| D-NSC-SEQUENCE | Deploy vs first real send | (a) deploy the two-function bundle, THEN D-PROD-1C end-to-end verifies the deployed callable, THEN broader enablement; (b) real send before deployment | **(a)** — a pre-deployment send cannot verify the deployed callable/identity/binding |
| D-NSC-ROTATION | Rotation model | (a) add version + rebind at deploy; invalid/absent ⇒ fail-closed; (b) hot-swap without fail-closed guard | **(a)** — rotation can never degrade-open |
| D-NSC-CONFIG-FAIL | Absent/invalid config behavior | (a) stay `outbound:null` fail-closed (no degraded mode); (b) partial/degraded send | **(a)** — either fully valid or fail-closed |
| D-NSC-BUNDLE | Deploy scope | (a) exactly `initiateAdminPasswordReset` + `listResetEligibleUsers`, nothing else; (b) broader | **(a)** — no unrelated Functions/Hosting/Rules |
| D-NSC-ENV | Environment confirmation | (a) confirm exact project + secret-project match before wiring; mismatch halts; (b) assume | **(a)** — project mismatch is a halt condition |

---

## 13. What this package explicitly does NOT authorize

Creating/reading/rotating any secret; configuring Firebase; implementing or wiring the `outbound` adapter;
deploying Functions/Rules/indexes/Hosting; production access; fixtures; email; permission activation/grant;
cross-key reconciliation; or AUTH-PROD-1 execution. `admin.credentialReset.initiate` **remains inactive and
ungranted**; the deployed sender **remains `outbound:null` / fail-closed** until a separate authorization.

---

## 14. Sign-off (to be completed at future gates)

- [ ] Owner decisions §12 ratified (or amended) — _pending_
- [ ] **D-PROD-1A** read-only preflight (confirms fail-closed) — _pending, separate authorization_
- [ ] Sender-adapter implementation + non-sending validation + emulator coverage (repository-only, outbound faked) — _pending_
- [ ] D-NATIVE-SEND-CONFIG execution: Secret Manager secret bound to `initiateAdminPasswordReset` ONLY + its dedicated secret-access identity (list gets neither) + non-sending-validated wiring — _pending, separate authorization_
- [ ] **D-PROD-1B** bounded fixtures — _pending, separate authorization_
- [ ] Narrowly-authorized deployment (AUTH-PROD-2/3): the exact two-Function bundle; secret binding + dedicated identity on `initiateAdminPasswordReset` only; attestation that `listResetEligibleUsers` cannot read the secret — _pending, separate authorization_
- [ ] **D-PROD-1C** end-to-end real-send verification against the DEPLOYED callable (first real `sendOobCode`) — _pending, separate authorization_
- [ ] Broader enablement (permission activation/grant) — _pending, separate authorization_

_This package is the documentation deliverable for the native-send configuration + deployment boundary
only. It remains **PENDING / NOT AUTHORIZED** until the Owner ratifies §12 and separately authorizes each
execution step._
