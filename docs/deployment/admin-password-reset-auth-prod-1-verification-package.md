# AUTH-PROD-1 — Admin Password Reset: Real-Firebase Verification Package

> **STATUS: PENDING — NOT AUTHORIZED FOR PRODUCTION.**
> This is a **documentation-only** preparation package. It plans a future, separately
> authorized verification; it performs **no** deployment, no production Firebase/Auth read
> or write, no reset/verification email, no permission activation, no role grant, no session
> revocation, and no identity/data mutation. Nothing in this file may be executed until the
> Owner issues the applicable **D-PROD-1A/B/C-AUTH** authorization described in §6. Merging this document
> authorizes **no** production action.

- **Gate:** AUTH-PROD-1 preparation (three separately authorized real-Firebase sub-gates; none authorized here)
- **Workstream:** Admin password-reset roadmap items #4 (Admin reset UI) + #5 (production admin reset)
- **Governing decisions:** [`DECISIONS.md`](../DECISIONS.md) #54 (deferrals), #55 (continuous-execution boundary + hard stops), #56 (D-DELIVERY-NATIVE / D-ROUTINE-REVOKE / D-RESET-PERMISSION)
- **Implementation under test (repository/emulator-only, merged, NOT deployed):** AUTH-PR-3.5, commit `c55b15b`, present on `main` at `0758d2d`
- **Predecessor gates (all merged, repo/emulator-only):** AUTH-UI-1 #469, AUTH-UI-2 #470, AUTH-UI-3 #471, AUTH-PR-3.5 #472
- **Successor gates (not this package):** AUTH-PROD-2 (deployment prep docs), AUTH-PROD-3 (production deploy + verify), AUTH-PROD-4 (completion record)

---

## 1. Purpose and boundary

AUTH-PROD-1 is the **bounded, staged, separately authorized** verification that the merged AUTH-PR-3.5
admin-initiated routine password-reset backend behaves against **real Firebase Auth** exactly as
it does against the emulator, before any deployment, activation, or grant is ever considered.

**This package is preparation only.** It defines *what* AUTH-PROD-1 must verify, *how* it would be
executed under a later authorization, *what evidence* it must produce, and *every* production input,
configuration, executor requirement, and authorization that a future execution will need — **without
accessing or supplying any of them now.**

**In scope of this document:** verification requirements, procedure outline, evidence contract,
rollback/halt conditions, required-inputs inventory, and the hard-stop checklist.

**Explicitly NOT in scope (and not authorized by this document):**
- Any Functions deployment or callable/config activation.
- Any production Firebase/Auth read or write; any project-setting mutation.
- Any reset email or verification email (including to a test identity).
- Any permission activation or role grant; `admin.credentialReset.initiate` stays **inactive**.
- Any session/refresh-token revocation.
- Any Firestore, role, claim, `accessVersion`, or Employee-link mutation.
- Any AUTH-PR-4 action; any Inventory/Equipment or Procurement work; any combined release.
- Committing any credential, email address, UID, token, link, or protected production evidence.

---

## 2. Reconciliation to the merged implementation

Verified against the merged AUTH-PR-3.5 sources (do not restate secrets; file + anchor only):

| Concern | Merged behavior (source) |
| --- | --- |
| Callable adapters | `functions/src/access/adminCredentialCallables.ts` — `initiateAdminPasswordReset`, `listResetEligibleUsers`; actor derived from authenticated context only (`requireAuthUid`), typed errors mapped to sanitized `HttpsError`s (`mapError`). |
| Command core | `functions/src/access/adminCredentialCommands.ts` — `initiateAdminPasswordReset`, `listResetEligibleUsers`, pure `evaluateTargetEligibility`. |
| Permission registration | `functions/src/access/permissionCatalog.ts:616` — `admin.credentialReset.initiate`, `active: false`. |
| Export vs deploy | `functions/src/index.ts:88-89` exports both callables. **Export is not deployment** (adapter header contract); neither is deployed or enabled. |

**Native-send / internal-link reconciliation (important).** AUTH-PR-3.5 implements
D-DELIVERY-NATIVE (#56):
delivery is a **Firebase-native server send** whose only truthful signal is **`accepted`**
(`AdminPasswordResetOutcome.status = "accepted"`, `commands.ts:188-191`). AUTH-PR-3.5 **removed reset-link
generation from the application path (`commands.ts:12-14`, `callables.ts:133-135`), but a Firebase-native
password-reset send still mints and emails an internal Firebase OOB action link. The application never
receives or exposes that link; nevertheless, the older AUTH-PROD-1 requirement to prove that an earlier
emailed link remains consumable after a later send is still applicable provider behavior. It is restored
as a required assertion in §4.C. If Firebase invalidates the earlier link, AUTH-PROD-1 halts and returns
that observed behavior for an Owner decision; this package does not choose a weaker policy.

**Repository prerequisite F2 — native sender is missing.** The merged implementation defines the
`NativeResetSender` seam and the fail-closed `NOT_CONFIGURED_NATIVE_SEND`, but contains no concrete native
sender or durable sender-side deduplication implementation. Therefore the accepted/send posture is
unreachable through configuration alone. A separate repository-only sender + idempotency-deduplication
gate must be implemented, emulator-tested, independently reviewed, and merged before any mutation/send
sub-gate can be requested. This package does not implement it.

**Repository prerequisite F3 — actor authorization is role-only.** The merged
`assertActorIsAdmin` checks the stored role only. It does not enforce active employment/account state and
does not enforce the inactive `admin.credentialReset.initiate` capability. This package therefore makes
no claim that inactive admins are denied. A separate repository correction with emulator tests for
inactive/disabled actor denial is required before any production sub-gate can be requested.

**Observation (out of this package's edit scope):** the admin-reset implementation-plan's "Lane isolation"
risk line still reads "AUTH-PR-4 is operationally active." That is now stale — AUTH-PR-4 partially executed
and its rollback continuation was cancelled (no further action authorized). Flagged for a future
plan-accuracy pass; **not** edited here to preserve this package's scope.

---

## 3. Preconditions (all required before any AUTH-PROD-1 execution)

1. **D-PROD-1A/B/C-AUTH** — separate, explicit Owner authorizations for the read-only preflight,
   mutation preparation, and send verification in §6. None is granted by this package.
2. A **named production executor** with least-privilege, time-boxed access, approved out-of-band. **Unresolved.**
3. An **approved test identity only** (a disposable, non-production-privileged Auth user + linked test
   employee record) provisioned for the test window. **Not provisioned; not supplied here.**
4. A confirmed **exact commit** to verify (this package pins the implementation to `c55b15b` on `main`
   `0758d2d`; AUTH-PROD-1 re-confirms head at execution time).
5. Confirmation that `admin.credentialReset.initiate` remains **inactive** and **ungranted**
   (D-RESET-PERMISSION-ACTIVATION deferred) throughout — AUTH-PROD-1 does not require activation.
6. **PRE-1 — concrete sender prerequisite:** the repository-only native sender + durable
   idempotency-key deduplication gate described in F2 must be merged. **Missing / blocking.**
7. **PRE-2 — actor-authorization prerequisite:** the repository-only inactive/disabled-admin
   authorization correction described in F3 must be merged with emulator coverage. **Missing / blocking.**
8. **PRE-3 — audit-coverage decision:** the Owner must approve either repository audit expansion or an
   explicit bounded exception for every unaudited path enumerated in §4.I. **Unresolved / blocking.**
9. **D-NATIVE-SEND-CONFIG** — the concrete Firebase-native send configuration. **Unresolved and untouched.**

---

## 4. Verification requirements

Each row is a required assertion. "Emulator baseline" = already covered by merged tests; AUTH-PROD-1
confirms parity against real Firebase. Sanitized evidence (§8) is required for every row.

### A. Fail-closed posture (no native sender configured)
- With `NOT_CONFIGURED_NATIVE_SEND` (`commands.ts:106-113`), an eligible-target initiation performs
  **zero Auth side effects**: no send, no reset-link generation, no revocation. Caller receives the
  `unavailable` mapping; a `deliverAdminPasswordReset` **denied** audit is written
  (`commands.ts:363-366`). This is the default production posture and MUST hold on real Firebase.

### B. `REQUEST_ACCEPTED`-only semantics (only if a test-window native sender is Owner-supplied)
- A successful send yields `{ status: "accepted" }` and a **truthful** audit "Reset email requested
  (accepted by Firebase native send)" — **never** "delivered", "opened", or "consumed"
  (`commands.ts:428-433`).
- The caller output contains **no** email, link, code, token, provider body, or eligibility reason.
- A not-accepted send is retryable (`status: failed`, no stage persisted), caller still receives the
  neutral accepted response (`commands.ts:435-438`).

### C. Firebase-native earlier-link consumability
- A first successful native reset send to the bounded disposable test mailbox produces an internal
  Firebase OOB link that remains private and is never committed to evidence.
- After a later governed native send for the same test identity, the earlier emailed link must remain
  consumable. Verify this only through the approved mailbox-control/test-browser procedure; never expose
  the link, action code, email, or UID in committed evidence.
- If the earlier link is invalidated, **halt** before any successor gate and report the sanitized provider
  behavior for an Owner policy decision. Do not silently accept last-link-only behavior.

### D. Guard evaluation (`evaluateTargetEligibility`, `commands.ts:156-171`)
Verify each disposition on real Firebase facts resolved by `resolveTargetFacts` (`callables.ts:77-126`):

| Target condition | Category | Disposition | Caller sees | Side effect |
| --- | --- | --- | --- | --- |
| actor == target | `self-target` | protected | visible refusal (`failed-precondition`) | none |
| no Auth account | `no-auth-account` | neutral-ineligible | neutral `accepted` | none |
| missing/non-reciprocal Employee↔Auth link | `missing-or-nonreciprocal-employee-link` | neutral-ineligible | neutral `accepted` | none |
| final active recoverable admin | `protected-final-admin` | protected | visible refusal | none |
| disabled Auth user | `disabled-target` | neutral-ineligible | neutral `accepted` | none (never silently enabled) |
| break-glass identity | `break-glass-target` | neutral-ineligible | neutral `accepted` | none |
| no recoverable email | `no-recoverable-email` | neutral-ineligible | neutral `accepted` | none |
| otherwise | `eligible` | eligible | neutral `accepted` | send (posture A/B) |

- Confirm the **fail-safe defaults** hold against real data: an unresolvable final-active-admin query
  protects (`callables.ts:120-122`); a lookup error denies with a stage error, never a silent pass
  (`commands.ts:369-375`).
- Confirm **reciprocal** linkage semantics (`employees/{employeeId}` links back via
  `userId`/`authUid`/`uid`, `callables.ts:94-101`) match the real `employees`/`users` schema. If the real
  back-link field differs, **halt and reconcile** (do not weaken the guard).

### E. Enumeration protection
- All `neutral-ineligible` outcomes return an identical neutral `accepted` to the caller; the
  distinguishing category exists **only** in the server-side audit (`commands.ts:382-387`). Verify a
  caller cannot distinguish disabled / break-glass / missing-link / no-email / no-account targets.
- Verify `listResetEligibleUsers` returns only `{uid, displayName, role, hasEmployeeLink}` and enforces
  the admin authority + limit clamp (`commands.ts:458-479`); no email/link/token fields leak.

### F. Idempotency, leasing, crash-safety
- Same `idempotencyKey` + same (actor,target,mode) → single send; replay returns neutral `accepted`
  with no second send (`claimOrResume`/`claimStage`/`recordStageOwned`, `commands.ts:263-336`).
- Same key bound to a **different** request → `already-exists` (`OperationKeyConflictError`).
- In-progress within `STALE_PENDING_MS` → `aborted`; failed within `RETRY_COOLDOWN_MS` → `unavailable`.
- A stale worker (attempt mismatch) is refused (`LeaseLostError`) and does not overwrite the winner.
- A configured native sender MUST dedupe on `idempotencyKey` (`commands.ts:87-101`); verify a retry
  after stale-worker takeover does **not** enqueue a second email.

### G. Authorization
- The merged implementation currently authorizes only by
  `users/{actorUid}.role === "admin"` (`assertActorIsAdmin`, `commands.ts:222-227`); client-supplied actor
  identity is impossible because the actor comes from authenticated context.
- Non-admin and unauthenticated actors are denied. **Inactive or disabled admins are not proven denied by
  the merged code** and must remain a blocking PRE-2 case until the separate repository correction lands.
- The inactive `admin.credentialReset.initiate` capability is not currently consulted by this command.
  This is recorded behavior, not authorization to activate or grant it.

### H. Inactive-permission behavior
- Confirm `admin.credentialReset.initiate` remains `active:false` and **ungranted**; verify the command's
  authority path does **not** depend on the catalog entry being active (it uses the governed admin
  authority directly). AUTH-PROD-1 neither activates nor grants it.

### I. Audit coverage (accurate merged behavior; PRE-3 blocker)
- Audited paths include accepted initiation/send outcomes, neutral eligibility dispositions, protected
  target denials reached after authorization, sender failure, and the explicitly implemented delivery
  denial/outcome calls.
- The merged implementation does **not** establish an audit event for every terminal path. In particular,
  input validation rejection, operation-key conflict, in-progress and retry-cooldown refusal, malformed
  operation state, exact replay, lease-loss refusal, and all `listResetEligibleUsers` access paths are
  unaudited.
- Before production authorization, PRE-3 requires an explicit Owner decision: either close these gaps in a
  separately reviewed repository change, or approve a narrowly documented exception. This package does
  not label unaudited paths as complete.
- For paths that are audited, verify outcomes/actions/categories against §4.D and verify **no** secret is
  present in any audit summary.

### J. Two-Function deployment-bundle boundary (documentation assertion)
- The eventual deploy scope is **exactly** `initiateAdminPasswordReset` + `listResetEligibleUsers` — never
  bundled with AUTH-PR-4, Inventory/Equipment, or anything else. AUTH-PROD-1 deploys **nothing**; this row
  is asserted as a boundary the successor gates (PROD-2/PROD-3) must honor.

---

## 5. Bounded test-persona and fact matrix

AUTH-PROD-1 may use only purpose-created, disposable test identities and synthetic linked records. No
mutation or email may target the real Owner, break-glass identity, final recoverable administrator, or
ordinary personnel.

| Test fixture | Purpose | Mutation/send permitted? |
| --- | --- | --- |
| disposable eligible admin actor | Exercise corrected actor authorization | Authentication/read only unless §6.B is separately authorized |
| inactive/disabled disposable admin actor | Prove PRE-2 denial | No |
| disposable eligible target + controlled mailbox | Native-send/idempotency/link assertions | Only under separately authorized §6.C |
| disposable no-account/missing-link/disabled/no-email facts | Neutral-equivalence guards | Provisioning only under §6.B; no send |
| synthetic final-admin and break-glass facts | Protected/neutral classification | No real identity; no mutation/send |

One identity cannot stand in for incompatible facts. Every fixture has a bounded creation/deletion plan,
an expected disposition, and sanitized evidence. Any need to touch a real protected or ordinary identity
halts the gate.

---

## 6. Separately authorized execution gates

### 6.A D-PROD-1A-AUTH — read-only production preflight

May re-confirm deployed/non-deployed state, repository commit, inactive permission, real schema field
names, actor-authorization behavior that requires no mutation, and existing configuration. It may not
create a user or document, alter configuration, invoke a reset send, or write audit/operation records.

### 6.B D-PROD-1B-AUTH — mutation preparation

Only after PRE-1, PRE-2, and PRE-3 are resolved, a separate Owner authorization may permit the exact
bounded test fixtures. It must explicitly name Auth test-user creation/deletion, Employee/User test-record
creation/deletion, any required audit/operation-record writes, the named executor, rollback order, and
sanitized evidence. It does not authorize a reset email.

### 6.C D-PROD-1C-AUTH — native-send verification

Only after 6.A and 6.B pass, a third Owner authorization may permit the exact native-sender/project
configuration change and reset-email sends to the controlled disposable mailbox. It must bound send
count, idempotency replay, earlier-link consumability, rollback of configuration/fixtures, evidence, and
the named executor. No other recipient is permitted.

Each sub-gate stops on completion. Passing one does not authorize the next.

---

## 7. Production mutations, rollback, evidence, and halt conditions

- AUTH-PROD-1 is **not non-destructive by construction** once 6.B/6.C begins. A later authorization must
  expressly name every permitted mutation: Auth test-user create/delete; Employee/User test-record
  create/delete; audit and operation-record writes; native-sender/project configuration; and each
  reset-email send.
- Each mutation requires its exact rollback/cleanup, bounded executor, pre/post evidence, and stop point.
  No role, claim, `accessVersion`, existing Employee link, session, or ordinary/protected identity may be
  changed.
- **Halt immediately and report (do not continue)** if: the real Employee↔Auth back-link schema differs
  from the guard's expectations; any neutral-ineligible path is caller-distinguishable; any secret appears
  in caller output or audit; a send occurs under the fail-closed posture; a duplicate email is enqueued for
  a repeated idempotency key; an earlier Firebase OOB link becomes unusable after a later send; the
  permission is found active or granted; PRE-1/PRE-2/PRE-3 is unresolved; or any change would risk leaving
  zero recoverable admins.
- **DECISIONS #55 hard stops remain in force throughout:** no deployment (Functions/Rules/Hosting/index);
  no production mutation or send unless the exact later 6.B/6.C authorization explicitly opens that one
  bounded action; no revocation/recovery-email/session action; no role/claim/`accessVersion`/existing
  Employee-link mutation; no source cutover; no removal of a recovery/compatibility fallback. External
  providers remain indefinitely deferred (#54).

---

## 8. Sanitized evidence contract

- Destination: `docs/audits/admin-password-reset-prod-1/` (created at execution time).
- **Permitted:** pass/fail per assertion, sanitized audit **categories/outcomes**, neutral response codes,
  counts, timing, and the reconciled schema field names (non-secret).
- **Prohibited (never committed):** emails, UIDs, tokens, reset links, action codes, provider bodies, raw
  Auth/Firestore records, or any credential. No broad release; evidence is repository-merged only after
  sanitization review.

---

## 9. Required production inputs, configuration, executor, and authorizations (identified, NOT supplied)

| # | Item | Owner decision / source | State |
| --- | --- | --- | --- |
| 1 | Read-only preflight authorization | **D-PROD-1A-AUTH** | **Not granted** |
| 1b | Mutation-preparation authorization | **D-PROD-1B-AUTH** | **Not granted** |
| 1c | Native-send verification authorization | **D-PROD-1C-AUTH** | **Not granted** |
| 2 | Named production executor + least-privilege time-boxed access | Owner | Unresolved |
| 3 | Approved test identity (Auth user + linked test employee) | Owner-provisioned, out-of-band | Not supplied |
| 4 | Firebase project / real-Auth access for the test window | Owner-scoped, least-privilege | Not supplied |
| 5 | Concrete repository native sender + dedupe | **PRE-1** | Missing / blocking |
| 5b | Corrected inactive/disabled-admin authorization | **PRE-2** | Missing / blocking |
| 5c | Audit-gap decision/correction | **PRE-3** | Unresolved / blocking |
| 5d | Concrete Firebase-native send configuration (posture B) | **D-NATIVE-SEND-CONFIG** | Unresolved / untouched |
| 6 | Confirmation permission stays inactive/ungranted | **D-RESET-PERMISSION-ACTIVATION** (deferred) | Deferred |
| 7 | Sanitized-evidence review + merge approval | Owner / Codex | Pending execution |

None of these items are accessed, requested, or supplied by this package.

---

## 10. What this package explicitly does NOT authorize

Deployment or activation of anything; any production Firebase/Auth read or write; any reset/verification
email; permission activation or role grant; session revocation; any Auth project-setting, Firestore, role,
claim, `accessVersion`, or Employee-link mutation; any AUTH-PR-4 action; any Inventory/Equipment or
Procurement work; any combined release; and committing any credential, email, UID, token, or protected
production evidence.

---

## 11. Sign-off (to be completed at future gates)

- [ ] PRE-1 native sender + dedupe merged and independently reviewed — _pending_
- [ ] PRE-2 actor-authorization correction merged and independently reviewed — _pending_
- [ ] PRE-3 audit-gap decision resolved — _pending_
- [ ] **D-PROD-1A-AUTH** granted and read-only preflight passed — _pending_
- [ ] **D-PROD-1B-AUTH** granted and bounded fixtures prepared/cleaned — _pending_
- [ ] **D-PROD-1C-AUTH** granted and native-send verification passed — _pending_
- [ ] Executor named and access provisioned — _pending_
- [ ] Approved test identity provisioned — _pending_
- [ ] Verification executed; all §4 assertions pass — _pending_
- [ ] Sanitized evidence merged to `docs/audits/admin-password-reset-prod-1/` — _pending_
- [ ] Independent Codex review of results — _pending_
- [ ] AUTH-PROD-2 (deployment-prep docs) authorized as the next gate — _pending_

_This package is the documentation deliverable for AUTH-PROD-1 preparation only. It remains **PENDING /
NOT AUTHORIZED FOR PRODUCTION** until the Owner acts._
