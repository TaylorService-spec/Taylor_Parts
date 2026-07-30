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

---

## 4. Secret Manager secret + access / rotation / rollback / evidence (no secret value here)

- **Secret:** the Firebase Web API key (or a dedicated restricted key) used by `accounts:sendOobCode`,
  stored in **Google Secret Manager** — never in the repository, environment files committed to VCS, or
  client-readable config. **This document contains no secret value and never will.**
- **Least-privilege access:** only the two admin-reset Functions' runtime service account may read the
  secret version (`secretmanager.versions.access` on that one secret), granted at the enablement gate,
  time-scoped/reviewed. No human or unrelated service reads it via this path.
- **Rotation:** rotate by adding a new secret version and updating the Functions' bound version; the
  adapter reads the bound version at cold start. Rotation never requires committing a value. A rotation
  that yields an absent/invalid credential MUST leave the sender fail-closed (§5), not degraded-open.
- **Rollback:** unbinding the secret (or setting `outbound` back to `null`, §6) returns the sender to the
  fail-closed posture. Rollback requires no secret handling.
- **Evidence (sanitized):** record secret **existence/version id/binding** and access-grant attestations —
  **never** the secret value, key material, or any OOB code/link/email. Evidence → the AUTH-PROD evidence
  location at the execution gate.

---

## 5. `outbound:null → configured` transition + fail-closed invariants

- The enablement gate constructs `createNativeResetSender({ outbound: <adapter> })` **only when** the
  secret is present and the adapter validated it at construction. If the credential/config is **absent or
  invalid**, the wiring MUST remain `createNativeResetSender({ outbound: null })` (fail-closed:
  `isConfigured()===false` → the command throws `DeliveryUnavailableError`, zero side effects). There is
  **no degraded/partial mode**: either a fully valid configured sender, or fail-closed.
- **Invariant:** `isConfigured()` may return `true` **only** when a validated outbound + secret are wired.
  A missing/invalid secret can never produce `isConfigured()===true`.
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
  `isConfigured()` true only with a wired outbound; absent/invalid config → fail-closed; accepted/
  not-accepted/uncertain outcomes; no secret/link/code ever logged. **No real `sendOobCode` call in the
  emulator.** Real-endpoint behavior is verified only under D-PROD-1C.

---

## 9. Halt conditions

Halt and report (do not proceed) if: the target project cannot be confirmed or mismatches the secret; the
secret is absent, unreadable, or invalid at wiring time (stay fail-closed); `isConfigured()` would return
true without a validated outbound + secret; the deploy target is anything beyond the two callables; a
real send is attempted outside D-PROD-1C; any secret value, OOB code, link, or email would be logged or
committed; or `admin.credentialReset.initiate` is found active or granted.

---

## 10. Sanitized evidence

- Permitted: secret existence/version id/binding, access-grant attestations, deploy target list, project
  id, `isConfigured()` state, and pass/fail per check.
- Prohibited (never committed/logged): secret values/key material, OOB codes, reset links, action codes,
  email addresses, provider/endpoint bodies, raw Firebase responses.

---

## 11. Sequencing relative to D-PROD-1A / D-PROD-1B / D-PROD-1C

- **D-PROD-1A (read-only preflight):** may confirm project/config/fact-sources and that the sender is
  fail-closed (`isConfigured()===false`) — **no** secret creation, **no** wiring, **no** send.
- **This config gate (D-NATIVE-SEND-CONFIG execution, separate):** provision the secret + build/validate the
  outbound adapter (repository impl + emulator tests are a repo-only prerequisite; secret/wiring is the
  execution step) — still **no** send.
- **D-PROD-1B (bounded fixtures):** provision the disposable test personas.
- **D-PROD-1C (send verification):** the **first** point a real `sendOobCode` runs, to the approved test
  recipient only, under the configured sender — bounded send count, duplicate-send + earlier-link checks.
- **AUTH-PROD-2/3:** deploy the exact two-Function bundle. Each of the above is a **separate** Owner
  authorization; this package opens none of them.

---

## 12. Owner decisions (each with a recommended safe default)

| # | Decision | Options | Recommended default |
| --- | --- | --- | --- |
| D-NSC-ENDPOINT | Native send mechanism | (a) Function → Auth REST `accounts:sendOobCode` (PASSWORD_RESET); (b) any external/provider path | **(a)** — native, no provider (#54), matches PRE-1/D-DELIVERY-NATIVE |
| D-NSC-KEY | Credential | (a) dedicated **restricted** Web API key in Secret Manager; (b) reuse the general Web API key | **(a)** — least privilege, revocable/rotatable without wider impact |
| D-NSC-KEY-STORE | Secret location | (a) Google Secret Manager, least-privilege to the two Functions' SA only; (b) env/config | **(a)** — never in repo/client-readable config |
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
- [ ] Sender-adapter implementation + emulator coverage (repository-only, outbound faked) — _pending_
- [ ] **D-PROD-1A** read-only preflight (confirms fail-closed) — _pending, separate authorization_
- [ ] D-NATIVE-SEND-CONFIG execution: Secret Manager secret + validated adapter wiring — _pending, separate authorization_
- [ ] **D-PROD-1B** bounded fixtures — _pending, separate authorization_
- [ ] **D-PROD-1C** real-send verification (first real `sendOobCode`) — _pending, separate authorization_
- [ ] AUTH-PROD-2/3 deploy the two-Function bundle — _pending, separate authorization_

_This package is the documentation deliverable for the native-send configuration + deployment boundary
only. It remains **PENDING / NOT AUTHORIZED** until the Owner ratifies §12 and separately authorizes each
execution step._
