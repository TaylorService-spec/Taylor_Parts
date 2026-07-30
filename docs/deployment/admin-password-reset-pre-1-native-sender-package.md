# PRE-1 — Firebase-Native Reset Sender + Durable Idempotency Dedupe (Authorization Package)

> **STATUS: PENDING — NOT AUTHORIZED.**
> This is a **documentation-only** design + authorization package. It performs **no**
> implementation, no deployment, no permission activation/grant, no production Firebase access, no
> email send, and no data/identity mutation. It reconciles the merged code and proposes the concrete
> native-sender + deduplication design, the tests, the future production gates, and the genuine Owner
> decisions — **without building any of it.** Merging this document authorizes **nothing** operational.

- **Gate:** PRE-1 (repository/emulator-only prerequisite for AUTH-PROD-1; the concrete `NativeResetSender`)
- **Workstream:** Admin password-reset roadmap items #4 (Admin reset UI) + #5 (production admin reset)
- **Governing decisions:** [`DECISIONS.md`](../DECISIONS.md) #54 (external providers indefinitely deferred), #55 (continuous-execution boundary + hard stops), #56 (D-DELIVERY-NATIVE / D-ROUTINE-REVOKE / D-RESET-PERMISSION)
- **Merged code reconciled:** `main` `485b3ac`; sender seam in `functions/src/access/adminCredentialCommands.ts` (AUTH-PR-3.5 + PRE-2 + target parity merged)
- **Sibling prerequisites (NOT combined here):** PRE-3 (audit-coverage decision); then AUTH-PROD-1 (D-PROD-1A/B/C)
- **Precedent:** `docs/assessments/admin-password-reset-current-state.md` (identifies the Function → Auth REST `sendOobCode` native path and the "no dedup attestation" gap)

---

## 1. Purpose and boundary

The merged command (AUTH-PR-3.5) defines a fail-closed `NativeResetSender` seam but **no concrete
sender**: `NOT_CONFIGURED_NATIVE_SEND` reports `isConfigured() === false`, so the command performs zero
Auth side effects. PRE-1 designs the concrete sender and its **durable idempotency-key deduplication** so
that a routine admin-initiated reset can, under a **later** production gate, trigger Firebase's own
password-reset email **at most once per governed operation key**, even across crashes and stale-worker
retries.

**In scope of this document:** the native mechanism, the dedupe data model + state machine, atomic
claim / accepted / failed / retry / stale-lease / replay / crash / uncertain behavior, the fail-closed
no-duplicate policy, sanitized evidence + audit boundaries, the emulator/unit test matrix, the future
production configuration + deployment gates (named, not opened), OOB-link reconciliation, and the genuine
Owner decisions with recommended safe defaults.

**Explicitly NOT in scope (and not authorized):** implementing the sender or dedupe layer; activating or
granting `admin.credentialReset.initiate`; deploying Functions/Rules/indexes/Hosting; accessing production
Firebase or sending any email; creating production fixtures; mutating Auth/Firestore/roles/claims/links/
`accessVersion`; and combining PRE-1 with PRE-3, AUTH-PROD-1, AUTH-PR-4, Inventory, or Equipment.

---

## 2. Reconciliation to the merged implementation

Verified against `main` `485b3ac` (file + anchor; no secrets):

| Concern | Merged behavior (source) |
| --- | --- |
| Sender seam | `NativeResetSender` (`commands.ts:94-100`): `isConfigured()` + `sendReset({targetUid,email,idempotencyKey}) → {accepted:boolean}`. Contract already states a configured sender **MUST** be idempotent on `idempotencyKey` (`commands.ts:87-93`). |
| Fail-closed default | `NOT_CONFIGURED_NATIVE_SEND` (`commands.ts:105-112`): `isConfigured()===false`; `sendReset()` returns `{accepted:false}`; the command throws `DeliveryUnavailableError` before any side effect (`commands.ts:481`). |
| Governed op record | `admin_credential_reset_ops/{idempotencyKey}` bound to `(actorUid,targetUid,mode)`, strict schema, `status ∈ {in_progress,completed,failed}`, `attempt`, `stages.send?="sent"` (`commands.ts` op machinery). |
| Claim/lease | `claimOrResume` (`commands.ts:382`) resumes a stale `in_progress` (> `STALE_PENDING_MS` = 5 min) or past-cooldown `failed` (> `RETRY_COOLDOWN_MS` = 30 s), incrementing `attempt`; `claimStage`/`recordStageOwned`/`setStatusOwned` are attempt-bound (a stale worker is refused → `LeaseLostError`). |
| Send flow | Only a **successful** send persists `stages.send="sent"` (`commands.ts:546-547`); a not-accepted send leaves no stage and marks `failed` (retryable); replay of a `completed` op returns neutral with no send (`commands.ts:509,523-533`). |

**The crash/duplicate gap PRE-1 must close (the reason dedupe exists).** `sendReset` is called at
`commands.ts:537`; the `stages.send="sent"` marker is persisted only at `commands.ts:547`. If Firebase
**accepts** the send (email queued, an OOB code minted) but the process **crashes before** `recordStage`,
the op stays `in_progress` with no `stages.send`. After `STALE_PENDING_MS`, a retry with the **same key**
resumes and calls `sendReset` **again**. The command layer cannot make an external send and a local write
atomic, so **the sender itself must guarantee at-most-once per `idempotencyKey`.** The current-state
assessment records this precisely: "Firebase-native send offers no dedup attestation, so exactly-once
user-visible … best-effort" — PRE-1 supplies the missing attestation.

---

## 3. Concrete Firebase-native sender mechanism (item 1)

**Recommended mechanism (D-PRE1-MECHANISM default):** a server-side call from the trusted command context
to the Firebase **Identity Toolkit REST endpoint `accounts:sendOobCode`** with
`requestType=PASSWORD_RESET` and the target email. This causes **Firebase itself** to send its native,
templated password-reset email (the same delivery self-service uses via the client
`sendPasswordResetEmail`). **No external transactional provider** (#54); no `ResetDelivery`/link-relay
seam.

- `sendReset({targetUid,email,idempotencyKey})` resolves `{accepted:true}` **only** when the endpoint
  returns success (HTTP 200 = "Firebase accepted the send request"). Any non-success is `{accepted:false}`
  (retryable) or throws (stage error). **`accepted` never means delivered/opened/consumed** (#56).
- The endpoint response body, OOB code, action link, and email are consumed **inside the sender boundary
  only** and are **never** returned to the command, logged, or persisted (see §7). `isConfigured()` is the
  sender's attestation that it can send natively **and** deduplicates on `idempotencyKey` (§4).
- **Rejected alternatives:** Admin SDK `generatePasswordResetLink` (generates a link but **sends nothing**
  — would require our own delivery = external provider, #54); a Firestore "Trigger Email" extension
  (provider-shaped, #54); the client `sendPasswordResetEmail` (not a server-governed, audited path).

---

## 4. Durable deduplication keyed to the governed idempotency key (item 2)

A **sender-owned durable dedupe record**, keyed by the governed `idempotencyKey` (the same key that binds
the op record), attests whether a native send for that key has been **claimed** and its **terminal
outcome**. Proposed collection: `admin_credential_reset_send_dedupe/{idempotencyKey}` (D-PRE1-DEDUPE-STORE).

Record (strict schema; fail closed on any malformed field):

| Field | Meaning |
| --- | --- |
| `idempotencyKey` | bound key (matches doc id) |
| `boundDigest` | hash of `(actorUid,targetUid,mode)` — a key reused for a different request is refused |
| `state` | `claimed` (in-flight) → `accepted` \| `failed` |
| `attempt` | monotonic attempt that owns the claim (lease fencing) |
| `claimedAtMs` / `updatedAtMs` | timestamps for stale detection |

The dedupe record is **distinct from** the command's op record: the op record tracks the governed
operation; the dedupe record is the sender's at-most-once attestation for the actual Firebase call.

---

## 5. Atomic claim / accepted / failed / retry / stale-lease / replay (item 3)

`sendReset` state machine (all transitions via Firestore transactions):

1. **Claim.** Transaction reads the dedupe doc for `idempotencyKey`:
   - **absent** → create `state=claimed` (attempt N) → proceed to step 2.
   - **`accepted`** → **replay**: return `{accepted:true}` **without** calling Firebase (dedupe hit).
   - **`failed`** (terminal, this key) → return `{accepted:false}` (the command's own cooldown/attempt
     logic governs whether a *new* attempt/key retries; the sender does not silently re-send).
   - **`claimed`** (in-flight) → **uncertain** — see §6 (fail closed; do **not** send again).
   - **`boundDigest` mismatch** → refuse (key reused for a different request).
2. **Native send.** Call `accounts:sendOobCode` (§3).
3. **Record terminal outcome.** On success → transaction sets `state=accepted` (attempt-bound); on a
   definite non-success → `state=failed`. Return the corresponding `{accepted}`.
- **Stale-lease fencing.** Terminal writes are attempt-bound; a superseded worker's write is refused
  (mirrors the command's `LeaseLostError` discipline), so a slow/stale worker cannot flip a newer
  attempt's outcome.
- **Replay** (same key, `accepted`) is idempotent and side-effect-free — satisfying the seam's
  "repeat call with the same key MUST NOT enqueue a second email" contract (`commands.ts:88-90`).

---

## 6. Crash handling + fail-closed no-duplicate policy (items 4 & 5)

The unavoidable hazard: Firebase **accepts** the send (step 2) but the process crashes **before** the
terminal write (step 3), leaving `state=claimed`.

**Policy (D-PRE1-UNCERTAIN default = fail-closed-no-duplicate):** a `claimed` (in-flight) dedupe record
that is re-encountered is treated as **UNCERTAIN → possibly already sent**. The sender **must not** call
Firebase again for that key. It reports the outcome so the command does **not** cause a duplicate email:

- Option A (recommended): treat uncertain as **accepted** (`{accepted:true}`) — an email may already be in
  flight; never risk a second. The op completes; the admin is told the request was accepted.
- Consequence: a send that crashed *before* Firebase accepted would also be treated as possibly-sent and
  **not** retried under that key. A genuine re-send requires a **new idempotencyKey** (a fresh admin
  action). This deliberately prefers "maybe one email, never two" over "guaranteed one, maybe two."

**Why not auto-reclaim the claim?** Reclaiming an in-flight claim to retry would reintroduce the duplicate
risk. **D-PRE1-STALE-RECLAIM default = never auto-reclaim**; only a new key retries. (An operator/runbook
path to inspect and, with explicit authorization, resolve a stuck `claimed` record is an AUTH-PROD-gate
concern, not PRE-1.)

**Interaction with the command's existing lease.** The command already resumes a stale `in_progress` op
after `STALE_PENDING_MS` and calls `sendReset` again — the sender's dedupe is exactly what makes that
resume safe: the second call hits a `claimed`/`accepted` record and does not double-send.

---

## 7. Sanitized evidence and audit boundaries (item 6)

- The sender **never** persists, logs, audits, or returns: email addresses, reset links, OOB action codes,
  credentials/API keys, provider/endpoint response bodies, or raw Firebase responses. These live only in
  transient local scope inside `sendReset` and are discarded.
- The dedupe record stores only non-secret control fields (§4) — never the email/link/code.
- Audit behavior is **unchanged** by PRE-1 (audit coverage is owned by PRE-3): the command still writes
  its truthful `deliverAdminPasswordReset` "accepted"/denied events; PRE-1 adds **no** new audit surface
  and must not weaken the existing sanitized summaries.
- Emulator test evidence is sanitized (pass/fail, counts, states) → any evidence dir is created at test
  time; no secret is committed.

---

## 8. Emulator / unit testing (item 7)

All repository/emulator-only; the concrete sender is dependency-injected so the Firebase call is faked
except where the Auth emulator is used. Required coverage:

- **Happy path:** claim → accepted → dedupe `accepted`; command persists `stages.send="sent"`.
- **Replay:** same key after `accepted` → `{accepted:true}`, **zero** additional Firebase calls.
- **Concurrency:** two workers race the same key → exactly one claims + sends; the other replays or is
  fenced (no double send).
- **Stale worker:** an older attempt's terminal write is refused after a newer attempt takes over.
- **Uncertain (crash between accept and persist):** inject a fault after the faked Firebase "accept" and
  before the terminal write; a retry sees `claimed` and **does not** re-send (fail closed, §6).
- **Sender failure:** definite non-success → `failed`, retryable via a new attempt/key; a thrown
  transport error → stage error, no stage persisted.
- **Bound-digest mismatch:** same key, different `(actor,target,mode)` → refused.
- **Adapter-vs-injected:** follow the PRE-2/target-parity precedent — an Auth+Firestore emulator test of
  the **deployed** sender wiring (its `isConfigured()` attestation + dedupe reads/writes), not only
  injected fakes, so a wiring regression is caught. (The actual `sendOobCode` network call remains a
  production-gate/AUTH-PROD verification; the emulator test exercises the dedupe state machine and the
  faked accept/uncertain/failure branches.)

---

## 9. Future production configuration and deployment gates (item 8 — named, NOT opened)

None of the following is opened by PRE-1; each requires its own separate Owner authorization:

- **G-PRE1-IMPL** (repository/emulator-only): implement the sender + dedupe + tests per this package;
  independent Codex review; merge. Still no deployment/activation.
- **Config prerequisites (later, separate):** provision the `sendOobCode` credential/API key via
  **Secret Manager** (never in the repo, never in client-readable config), least-privilege, and the
  Firebase Auth email template/sender identity. This is D-PRE1-APIKEY and belongs to the AUTH-PROD
  enablement gate, not PRE-1.
- **Deployment (later, separate — AUTH-PROD-2/3):** deploy **only** `initiateAdminPasswordReset` +
  `listResetEligibleUsers`; wire `isConfigured()===true` only after the secret + template are in place;
  never bundle with AUTH-PR-4/Inventory/Equipment; satisfy DECISIONS #55 hard stops.
- `admin.credentialReset.initiate` remains **inactive/ungranted** throughout; PRE-1 does not touch it.

---

## 10. Reconciliation with Firebase OOB-link behavior + AUTH-PROD-1 (item 9)

- Each `sendOobCode` call mints a **new** OOB reset code and emails it. The existing Auth-emulator
  observation (`adminCredentialResetLinkValidity.test.mjs`; `docs/audits/auth-pr-3-oob-validity/`) shows a
  later generation does not **remove** an earlier code from the outstanding list, but **end-to-end
  earlier-link consumability after a later send is unproven** and remains an **AUTH-PROD-1** verification
  (§4.C of the AUTH-PROD-1 package).
- PRE-1's dedupe guarantees **at most one** `sendOobCode` call **per idempotencyKey**, so it does **not**
  add OOB-code churn for retries/replays of the same governed operation. Across **different** keys (a
  genuine re-initiation, or the fail-closed "new key to retry" path in §6), a new code is minted — the
  cross-generation consumability question is Firebase's behavior and stays an AUTH-PROD-1 assertion, not
  something PRE-1 resolves. PRE-1 must not weaken or presume that behavior.

---

## 11. Owner decisions (item 10 — each with a recommended safe default)

| # | Decision | Options | Recommended default |
| --- | --- | --- | --- |
| D-PRE1-MECHANISM | Native send mechanism | (a) Function → Auth REST `accounts:sendOobCode`; (b) Trigger-Email extension; (c) client `sendPasswordResetEmail` | **(a)** — native, no provider (#54), server-governed/auditable |
| D-PRE1-UNCERTAIN | In-flight/crash outcome | (a) fail-closed-no-duplicate (uncertain ⇒ possibly-sent, no resend, new key to retry); (b) at-least-once (may duplicate) | **(a)** — never send two reset emails |
| D-PRE1-STALE-RECLAIM | Reclaim a stuck `claimed` record | (a) never auto-reclaim; (b) auto-reclaim after a TTL | **(a)** — auto-reclaim reintroduces duplicate risk |
| D-PRE1-DEDUPE-STORE | Dedupe record location | (a) dedicated `admin_credential_reset_send_dedupe/{key}`; (b) extend the op record | **(a)** — sender-owned, single responsibility, key-scoped |
| D-PRE1-DEDUPE-RETENTION | Dedupe record lifetime | (a) retain at least the OOB-code validity window; (b) short TTL | **(a)** — a too-short TTL erodes the at-most-once guarantee |
| D-PRE1-APIKEY | `sendOobCode` credential handling | (a) Secret Manager, least-privilege, config-time only; (b) env/config file | **(a)** — never in repo or client-readable config |
| D-PRE1-ACCEPTED-SEMANTICS | Meaning of `accepted` | (a) "Firebase accepted the request" only (HTTP 200); (b) "delivered" | **(a)** — truthful, per #56; never claim delivery |

---

## 12. What this package explicitly does NOT authorize

Implementing the sender or dedupe layer; activating or granting any permission; deploying
Functions/Rules/indexes/Hosting; accessing production Firebase or sending any email; creating production
fixtures; mutating Auth/Firestore/roles/claims/links/`accessVersion`; provisioning secrets/API keys; and
combining PRE-1 with PRE-3, AUTH-PROD-1 execution, AUTH-PR-4, Inventory, or Equipment.

---

## 13. Sign-off (to be completed at future gates)

- [ ] Owner decisions §11 ratified (or amended) — _pending_
- [ ] **G-PRE1-IMPL** authorized: implement sender + dedupe + §8 tests (repository/emulator only) — _pending_
- [ ] Independent Codex review of the implementation — _pending_
- [ ] Config prerequisites (Secret Manager credential + Auth template) — _pending, AUTH-PROD gate_
- [ ] PRE-3 (audit-coverage) resolved — _separate gate_
- [ ] AUTH-PROD-1 (D-PROD-1A/B/C) — _separate gate; still blocked until PRE-1 + PRE-3 land_

_This package is the documentation deliverable for PRE-1 preparation only. It remains **PENDING / NOT
AUTHORIZED** until the Owner ratifies §11 and separately authorizes implementation._
