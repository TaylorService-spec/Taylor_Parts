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
that a routine admin-initiated reset makes, under a **later** production gate, **at most one Firebase send
call per governed operation key**, even across crashes and stale-worker retries. (This bounds the per-key
call; it is **not** a global "never two emails" guarantee — see §10 and D-PRE1-XKEY-RECON for the residual
cross-key risk after an uncertain outcome.)

**In scope of this document:** the native mechanism, the sender interface change, the dedupe data model +
state machine, atomic claim / accepted / failed / retry / stale-lease / replay / crash / uncertain
behavior, the fail-closed no-duplicate policy, the **operation `reconciliation_required` state**
(intentional command schema/state-machine change, §6A), the coherent sanitized-audit boundary (§7), the
emulator/unit test matrix, the future production configuration + deployment gates (named, not opened),
OOB-link reconciliation, and the genuine Owner decisions with recommended safe defaults.

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

- `sendReset(...)` resolves a **three-state outcome**, not a boolean: `"accepted"` **only** when the
  endpoint returns success (HTTP 200 = "Firebase accepted the send request"); `"not_accepted"` for a
  definite non-success (retryable); and `"uncertain"` when the send may have reached Firebase but the
  outcome could not be durably determined (§6). A transport exception may still throw (stage error).
  **`accepted` never means delivered/opened/consumed** (#56), and **`uncertain` is never reported as
  `accepted`.**
- The endpoint response body, OOB code, action link, and email are consumed **inside the sender boundary
  only** and are **never** returned to the command, logged, or persisted (see §7). `isConfigured()` is the
  sender's attestation that it can send natively **and** deduplicates on `idempotencyKey` (§4).

**Intentional sender-interface change (D-PRE1-INTERFACE).** The merged seam is
`sendReset({targetUid,email,idempotencyKey}) → {accepted:boolean}`. Implementation (G-PRE1-IMPL) will
change it in two ways, both required by this package:
1. **Return type** becomes `{ outcome: "accepted" | "not_accepted" | "uncertain" }` (the command maps each
   per §5/§6). `NOT_CONFIGURED_NATIVE_SEND` returns `{ outcome: "not_accepted" }`.
2. **A command-computed binding** is passed in: `sendReset({targetUid,email,idempotencyKey,binding})`,
   where `binding` is a deterministic digest the **command** computes from its governed inputs
   `(actorUid,targetUid,mode)` (§4). The sender **persists and compares** `binding`; it **must not** infer
   `actorUid`/`mode` from other sources, and **must not** persist the email address to compensate.
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
| `binding` | the **command-computed** deterministic digest of `(actorUid,targetUid,mode)`, passed into `sendReset` (§3). The sender persists it verbatim and compares it; it never recomputes or infers the authority fields and never persists the email. A key reused with a **different** `binding` fails closed. |
| `state` | `claimed` (in-flight) → `accepted` \| `failed` \| `uncertain` |
| `attempt` | monotonic attempt that owns the claim (lease fencing) |
| `claimedAtMs` / `updatedAtMs` | timestamps for stale detection |

The dedupe record is **distinct from** the command's op record: the op record tracks the governed
operation; the dedupe record is the sender's at-most-once attestation for the actual Firebase call.

---

## 5. Atomic claim / accepted / failed / retry / stale-lease / replay (item 3)

`sendReset` state machine (all transitions via Firestore transactions):

1. **Claim.** Transaction reads the dedupe doc for `idempotencyKey`:
   - **absent** → create `state=claimed` (attempt N, with `binding`) → proceed to step 2.
   - **`accepted`** → **replay**: return `outcome:"accepted"` **without** calling Firebase (dedupe hit).
   - **`failed`** (terminal, this key) → return `outcome:"not_accepted"` (the command's own cooldown/attempt
     logic governs whether a *new* attempt/key retries; the sender does not silently re-send).
   - **`uncertain`** (terminal, this key) → return `outcome:"uncertain"` **without** calling Firebase; the
     operation stays blocked for governed reconciliation (§6). Same-key replay is side-effect-free.
   - **`claimed`** (in-flight, re-encountered — i.e. a crash left it claimed) → resolve to
     **`uncertain`** (fail closed; do **not** send again) and record `state=uncertain` (attempt-bound).
   - **`binding` mismatch** → refuse (key reused for a different request → fail closed).
2. **Native send.** Call `accounts:sendOobCode` (§3).
3. **Record terminal outcome.** On success → transaction sets `state=accepted` (attempt-bound); on a
   definite non-success → `state=failed`. Return the corresponding `outcome`.
- **Stale-lease fencing.** Terminal writes are attempt-bound; a superseded worker's write is refused
  (mirrors the command's `LeaseLostError` discipline), so a slow/stale worker cannot flip a newer
  attempt's outcome.
- **Replay** (same key, `accepted`) is idempotent and side-effect-free — satisfying the seam's
  "repeat call with the same key MUST NOT enqueue a second email" contract (`commands.ts:88-90`).

---

## 6. Crash handling + fail-closed no-duplicate policy (items 4 & 5)

The unavoidable hazard: Firebase **accepts** the send (step 2) but the process crashes **before** the
terminal write (step 3), leaving `state=claimed`.

**Policy (D-PRE1-UNCERTAIN default = fail-closed, no false `accepted`, no automatic resend):** a
`claimed` (in-flight) dedupe record that is re-encountered resolves to the terminal **`uncertain`**
outcome — **possibly already sent, outcome unknown**. The sender **must not** call Firebase again for that
key, and **must not** report `accepted`. The command handles `uncertain` as follows:

- The sender returns `outcome:"uncertain"`.
- The command **does NOT** persist `stages.send="sent"` and **does NOT** write an audit claiming Firebase
  accepted the request. It writes a **truthful** audit that the send outcome is **uncertain / possibly
  sent** (sanitized; no email/link/code), and leaves the operation in a **blocked, needs-reconciliation**
  terminal (not `completed`) so it is **not** silently replayable-as-sent.
- To the caller, the response stays the neutral `{status:"accepted"}` envelope (enumeration resistance —
  this envelope means "request accepted for processing," never "Firebase delivered"); the uncertainty is
  recorded server-side only.
- **Never silently retry the same key.** A same-key replay returns `uncertain` again, side-effect-free.

**Cross-key retry after uncertainty requires separate reconciliation authority (D-PRE1-XKEY-RECON).**
Issuing a **new** idempotencyKey after an uncertain attempt **can** cause a second email **if the first
attempt actually reached Firebase**. Therefore a cross-key retry after an uncertain outcome is **not**
routine: it requires a **separately authorized governed operator reconciliation** that explicitly
acknowledges the possible-duplicate-email risk before a new key is allowed to send. PRE-1 does not open
that path; it names it.

**Why not auto-reclaim the claim?** Reclaiming an in-flight/`uncertain` record to retry would reintroduce
the duplicate risk. **D-PRE1-STALE-RECLAIM default = never auto-reclaim**; resolution is only via the
separately authorized reconciliation above.

**Interaction with the command's existing lease.** The command already resumes a stale `in_progress` op
after `STALE_PENDING_MS` and calls `sendReset` again — the sender's dedupe is what makes that resume safe:
the second call hits a `claimed`/`accepted`/`uncertain` record and does not double-call Firebase.

---

## 6A. Operation reconciliation state (intentional command schema + state-machine change)

The uncertain outcome (§6) requires a new **terminal operation status** on the governed op record
(`admin_credential_reset_ops/{idempotencyKey}`). The merged schema allows only `in_progress | completed |
failed`; PRE-1 implementation adds **one** status. This is an **intentional command operation-schema and
state-machine change** (D-PRE1-OPSTATE), not merely prose behavior — it changes `OP_STATUSES`, the strict
`isValidOpRecord` validator, and `claimOrResume`.

**New status (recommended): `reconciliation_required`.** Contract:

- **Fields (all sanitized, bounded):** the existing op fields plus a `reconciliation` sub-object with a
  bounded enum `reason` (e.g. `uncertain_send`) and `atMs`. **No** free-form/unbounded text; **no**
  `stages.send="sent"` is written (the send is *not* known-sent).
- **Invariants:** `reconciliation_required` is terminal-until-reconciled; `stages.send` is absent;
  `attempt` and `boundDigest`/`(actorUid,targetUid,mode)` binding are preserved. A record that is
  malformed or violates these invariants **fails closed** (`MalformedOperationError`), never a silent pass.
- **Transitions:** `in_progress → reconciliation_required` (written atomically with the sanitized
  uncertainty audit, §7); **no** transition `reconciliation_required → completed`; **no** terminal
  rewrite; **no** automatic retry or resume out of this state. `claimOrResume` must treat
  `reconciliation_required` as **blocked** (it is not a stale-`in_progress` or past-cooldown-`failed`
  case) and must not increment `attempt` or re-enter the send path.
- **Same-key replay:** returns the neutral caller envelope and remains **side-effect-free** — no Firebase
  call, no state change, no new audit.
- **Resolution authority:** only the separately authorized governed reconciliation command
  (D-PRE1-XKEY-RECON) may resolve a `reconciliation_required` op; PRE-1 defines the state but does **not**
  implement that resolver.
- **Concurrency/fencing:** all transitions are attempt-bound within Firestore transactions (same
  discipline as `claimStage`/`setStatusOwned`); a stale worker cannot move the op out of
  `reconciliation_required`.
- **Emulator tests (see §8):** the `in_progress → reconciliation_required` transition; blocked same-key
  replay; concurrency (only one writer sets the state); stale-worker fencing; crash recovery
  (post-uncertain resume stays blocked, no resend); and prohibited rewrites (`→ completed`, terminal
  overwrite, and auto-retry are all refused).

---

## 7. Sanitized evidence and audit boundaries (item 6)

- The sender **never** persists, logs, audits, or returns: email addresses, reset links, OOB action codes,
  credentials/API keys, provider/endpoint response bodies, or raw Firebase responses. These live only in
  transient local scope inside `sendReset` and are discarded.
- The dedupe record stores only non-secret control fields (§4) — never the email/link/code.
- **Audit boundary (D-PRE1-AUDIT — coherent, resolves the prior §6/§7 contradiction).** PRE-1 adds
  **exactly one** minimal, sanitized audit outcome required by its new `reconciliation_required`
  transition — so an uncertain send is **never** recorded as acceptance. Specifically:
  - The command writes a single sanitized `deliverAdminPasswordReset` **uncertain/possibly-sent** audit
    (a new bounded outcome), written **atomically with** the `in_progress → reconciliation_required`
    transition (§6A) — the transition MUST NOT commit without its audit, and the audit MUST NOT claim
    acceptance.
  - **Allowed sanitized fields only:** `actorUid`, `targetType`/`targetId`, `action`, the bounded
    `outcome` (`uncertain`), the bounded `reason` enum (e.g. `uncertain_send`), `scope`, and timestamp.
    **Prohibited:** email addresses, UIDs beyond the actor/target identifiers already in the audit schema,
    reset links, OOB codes, credentials/API keys, provider/endpoint bodies, raw Firebase responses, and
    any free-form/unbounded text.
  - This is the **only** new audit surface PRE-1 introduces. All **other** audit-coverage gaps (validation,
    claim-conflict, replay, list access, etc.) remain **PRE-3's** scope and are untouched here. PRE-1 does
    not weaken any existing sanitized summary.
  - (Alternative, if the Owner defers even this audit to PRE-3: PRE-1 **implementation is then blocked
    until PRE-3 lands**, because PRE-1 cannot leave an uncertain send either unaudited or falsely audited.
    Recommended default is the minimal PRE-1-owned audit above.)
- Emulator test evidence is sanitized (pass/fail, counts, states) → any evidence dir is created at test
  time; no secret is committed.

---

## 8. Emulator / unit testing (item 7)

All repository/emulator-only; the concrete sender is dependency-injected so the Firebase call is faked
except where the Auth emulator is used. Required coverage:

- **Happy path:** claim → accepted → dedupe `accepted`; command persists `stages.send="sent"`.
- **Replay:** same key after `accepted` → `outcome:"accepted"`, **zero** additional Firebase calls.
- **Concurrency:** two workers race the same key → exactly one claims + sends; the other replays or is
  fenced (no double send).
- **Stale worker:** an older attempt's terminal write is refused after a newer attempt takes over.
- **Uncertain (crash between accept and persist):** inject a fault after the faked Firebase "accept" and
  before the terminal write; a retry sees `claimed`/`uncertain`, resolves to `uncertain`, **does not**
  re-send, **does not** report `accepted`, **does not** persist `stages.send="sent"`, and leaves the op
  blocked for reconciliation (§6).
- **Sender failure:** definite non-success → `failed`, retryable via a new attempt/key; a thrown
  transport error → stage error, no stage persisted.
- **Binding mismatch:** same key, different command `binding` (from a different `(actor,target,mode)`) →
  refused (fail closed); the sender does not persist the email to compensate.
- **Operation reconciliation state (§6A):** the `in_progress → reconciliation_required` transition sets the
  new status with a bounded `reason`, **no** `stages.send="sent"`; a `reconciliation_required` op is
  **blocked** on same-key replay (side-effect-free, no resend); concurrency admits one writer;
  stale-worker fencing holds; post-uncertain crash-recovery resume stays blocked; and prohibited rewrites
  (`→ completed`, terminal overwrite, auto-retry) are refused. A malformed `reconciliation_required`
  record fails closed (`MalformedOperationError`).
- **Uncertainty audit atomicity (§7):** the uncertain transition **cannot** produce an `accepted` audit,
  and the `reconciliation_required` transition **cannot** commit without its corresponding sanitized
  `uncertain` audit; the audit contains only the allowed sanitized fields (no email/UID-beyond-schema/
  link/code/credential/provider-body/raw-response/free-form text).
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
- **Scope of the guarantee (do not overclaim).** PRE-1's dedupe guarantees **at most one Firebase
  `sendOobCode` *call* per `idempotencyKey`** — it does **not** guarantee that the design can never send
  two emails. After an **uncertain** attempt, a **new** key (allowed only via the separately authorized
  D-PRE1-XKEY-RECON reconciliation, §6) **can** cause a second email **if the first attempt actually
  reached Firebase**. That residual duplicate risk is explicitly accepted and gated behind reconciliation
  authority; it is not silently taken.
- Same-key retries/replays add **no** OOB-code churn (at most one call per key). Across **different** keys,
  a new code is minted; the cross-generation earlier-link consumability question is Firebase's behavior and
  stays an **AUTH-PROD-1** assertion, not something PRE-1 resolves or presumes.

---

## 11. Owner decisions (item 10 — each with a recommended safe default)

| # | Decision | Options | Recommended default |
| --- | --- | --- | --- |
| D-PRE1-MECHANISM | Native send mechanism | (a) Function → Auth REST `accounts:sendOobCode`; (b) Trigger-Email extension; (c) client `sendPasswordResetEmail` | **(a)** — native, no provider (#54), server-governed/auditable |
| D-PRE1-INTERFACE | Sender interface change | (a) three-state `outcome` return + command-supplied `binding` param; (b) keep boolean + `(targetUid,email,idempotencyKey)` | **(a)** — required to represent `uncertain` and to compare an authoritative binding without inferring authority fields |
| D-PRE1-OPSTATE | Operation reconciliation state | (a) add one terminal status `reconciliation_required` (schema + `isValidOpRecord` + `claimOrResume` change; blocked, no `completed`, no rewrite/auto-retry, resolver-only); (b) reuse `failed` | **(a)** — `failed` is retryable and would risk a duplicate; the uncertain state must be distinctly blocked |
| D-PRE1-AUDIT | Uncertain-audit ownership | (a) PRE-1 adds exactly one minimal sanitized `uncertain` audit, committed atomically with the transition; PRE-3 keeps all other coverage; (b) defer to PRE-3 (PRE-1 impl then blocked until PRE-3 lands) | **(a)** — an uncertain send must be neither unaudited nor falsely audited as accepted |
| D-PRE1-UNCERTAIN | In-flight/crash outcome | (a) fail-closed: `uncertain` (never `accepted`), no `stages.send`, no "accepted" audit, op blocked for reconciliation, no auto-resend; (b) report accepted; (c) at-least-once auto-retry (may duplicate) | **(a)** — never a false `accepted`; never a silent duplicate |
| D-PRE1-XKEY-RECON | Cross-key retry after `uncertain` | (a) require a separately authorized governed operator reconciliation that explicitly accepts the possible-duplicate-email risk; (b) allow a new key routinely | **(a)** — a new key can double-send if the first attempt reached Firebase; gate it behind reconciliation authority |
| D-PRE1-STALE-RECLAIM | Reclaim a stuck `claimed`/`uncertain` record | (a) never auto-reclaim (resolve only via D-PRE1-XKEY-RECON); (b) auto-reclaim after a TTL | **(a)** — auto-reclaim reintroduces duplicate risk |
| D-PRE1-DEDUPE-STORE | Dedupe record location | (a) dedicated `admin_credential_reset_send_dedupe/{key}`; (b) extend the op record | **(a)** — sender-owned, single responsibility, key-scoped |
| D-PRE1-DEDUPE-RETENTION | Dedupe record lifetime | (a) retain for **at least the full governed operation/idempotency retention horizon** (never delete while the op may be retried/replayed); if ever deleted, a **coordinated governed-retirement** retires the op record **and** the dedupe record together; (b) short/independent TTL | **(a)** — expiration must never silently make an old key eligible to send again |
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
