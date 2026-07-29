# AUTH-PROD-1 — Admin Password Reset: Real-Firebase Verification Package

> **STATUS: PENDING — NOT AUTHORIZED FOR PRODUCTION.**
> This is a **documentation-only** preparation package. It plans a future, separately
> authorized verification; it performs **no** deployment, no production Firebase/Auth read
> or write, no reset/verification email, no permission activation, no role grant, no session
> revocation, and no identity/data mutation. Nothing in this file may be executed until the
> Owner issues **D-PROD-1-AUTH** (a separate production authorization). Merging this document
> authorizes **no** production action.

- **Gate:** AUTH-PROD-1 (real-Firebase behavior verification, bounded, non-destructive)
- **Workstream:** Admin password-reset roadmap items #4 (Admin reset UI) + #5 (production admin reset)
- **Governing decisions:** [`DECISIONS.md`](../DECISIONS.md) #54 (deferrals), #55 (continuous-execution boundary + hard stops), #56 (D-DELIVERY-NATIVE / D-ROUTINE-REVOKE / D-RESET-PERMISSION)
- **Implementation under test (repository/emulator-only, merged, NOT deployed):** AUTH-PR-3.5, commit `c55b15b`, present on `main` at `0758d2d`
- **Predecessor gates (all merged, repo/emulator-only):** AUTH-UI-1 #469, AUTH-UI-2 #470, AUTH-UI-3 #471, AUTH-PR-3.5 #472
- **Successor gates (not this package):** AUTH-PROD-2 (deployment prep docs), AUTH-PROD-3 (production deploy + verify), AUTH-PROD-4 (completion record)

---

## 1. Purpose and boundary

AUTH-PROD-1 is the **bounded, separately authorized** verification that the merged AUTH-PR-3.5
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

**Native-send / no-link reconciliation (important).** AUTH-PR-3.5 implements D-DELIVERY-NATIVE (#56):
delivery is a **Firebase-native server send** whose only truthful signal is **`accepted`**
(`AdminPasswordResetOutcome.status = "accepted"`, `commands.ts:188-191`). AUTH-PR-3.5 **removed reset-link
generation entirely** for this path (`commands.ts:12-14`, `callables.ts:133-135`). Therefore the older
AUTH-PROD-1 outline item "earlier-link consumability after a later generation"
([implementation-plan §AUTH-PROD-1](../implementation-plans/admin-password-reset-ui.md)) is **moot for the
implemented routine native-send path** — there is no link to consume. The residual real-Firebase
verification is **native-send `accepted` semantics + duplicate-send idempotency**, not link consumability.
This reconciliation is recorded here (not a contradiction — the plan and #56 anticipated link generation
being removed). The plan's "safe fallback: move link generation inside the send boundary" applies only if a
future gate ever reintroduces a link; it is **not** part of the current native path.

**Observation (out of this package's edit scope):** the admin-reset implementation-plan's "Lane isolation"
risk line still reads "AUTH-PR-4 is operationally active." That is now stale — AUTH-PR-4 partially executed
and its rollback continuation was cancelled (no further action authorized). Flagged for a future
plan-accuracy pass; **not** edited here to preserve this package's scope.

---

## 3. Preconditions (all required before any AUTH-PROD-1 execution)

1. **D-PROD-1-AUTH** — a separate, explicit Owner production authorization to run AUTH-PROD-1. **Not granted.**
2. A **named production executor** with least-privilege, time-boxed access, approved out-of-band. **Unresolved.**
3. An **approved test identity only** (a disposable, non-production-privileged Auth user + linked test
   employee record) provisioned for the test window. **Not provisioned; not supplied here.**
4. A confirmed **exact commit** to verify (this package pins the implementation to `c55b15b` on `main`
   `0758d2d`; AUTH-PROD-1 re-confirms head at execution time).
5. Confirmation that `admin.credentialReset.initiate` remains **inactive** and **ungranted**
   (D-RESET-PERMISSION-ACTIVATION deferred) throughout — AUTH-PROD-1 does not require activation.
6. **D-NATIVE-SEND-CONFIG** — the concrete Firebase-native send configuration. **Unresolved and untouched.**
   AUTH-PROD-1 verifies both postures (see §4.A/§4.B): fail-closed *without* it, and `accepted`-only
   semantics *with* an Owner-supplied test-window native sender if and only if D-PROD-1-AUTH provides one.

---

## 4. Verification requirements

Each row is a required assertion. "Emulator baseline" = already covered by merged tests; AUTH-PROD-1
confirms parity against real Firebase. Sanitized evidence (§7) is required for every row.

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

### C. Guard evaluation (`evaluateTargetEligibility`, `commands.ts:156-171`)
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

### D. Enumeration protection
- All `neutral-ineligible` outcomes return an identical neutral `accepted` to the caller; the
  distinguishing category exists **only** in the server-side audit (`commands.ts:382-387`). Verify a
  caller cannot distinguish disabled / break-glass / missing-link / no-email / no-account targets.
- Verify `listResetEligibleUsers` returns only `{uid, displayName, role, hasEmployeeLink}` and enforces
  the admin authority + limit clamp (`commands.ts:458-479`); no email/link/token fields leak.

### E. Idempotency, leasing, crash-safety
- Same `idempotencyKey` + same (actor,target,mode) → single send; replay returns neutral `accepted`
  with no second send (`claimOrResume`/`claimStage`/`recordStageOwned`, `commands.ts:263-336`).
- Same key bound to a **different** request → `already-exists` (`OperationKeyConflictError`).
- In-progress within `STALE_PENDING_MS` → `aborted`; failed within `RETRY_COOLDOWN_MS` → `unavailable`.
- A stale worker (attempt mismatch) is refused (`LeaseLostError`) and does not overwrite the winner.
- A configured native sender MUST dedupe on `idempotencyKey` (`commands.ts:87-101`); verify a retry
  after stale-worker takeover does **not** enqueue a second email.

### F. Authorization
- Only a server-side `users/{actorUid}.role === "admin"` may initiate/list (`assertActorIsAdmin`,
  `commands.ts:222-227`); client-supplied actor identity is impossible (actor from context only).
- Non-admin personas (dispatcher, parts/warehouse manager, technician, sales manager, unauthenticated,
  inactive) are denied with a sanitized `permission-denied` and a denied audit — per D-RESET-PERMISSION (#56).

### G. Inactive-permission behavior
- Confirm `admin.credentialReset.initiate` remains `active:false` and **ungranted**; verify the command's
  authority path does **not** depend on the catalog entry being active (it uses the governed admin
  authority directly). AUTH-PROD-1 neither activates nor grants it.

### H. Audit completeness (immutable Audit Event)
- Every terminal path emits durable audit (initiation + send-outcome), each awaited before the next side
  effect (`commands.ts:229-231`, `audit(...)` calls). Verify audit outcomes/actions/categories match the
  table in §4.C against real writes; verify **no** secret is present in any audit summary.

### I. Two-Function deployment-bundle boundary (documentation assertion)
- The eventual deploy scope is **exactly** `initiateAdminPasswordReset` + `listResetEligibleUsers` — never
  bundled with AUTH-PR-4, Inventory/Equipment, or anything else. AUTH-PROD-1 deploys **nothing**; this row
  is asserted as a boundary the successor gates (PROD-2/PROD-3) must honor.

---

## 5. Procedure outline (executed only under D-PROD-1-AUTH)

1. Re-confirm head, changed-file scope, and that the permission is still inactive/ungranted.
2. Provision the approved test identity + linked test employee in a controlled test window.
3. Run posture **A** (fail-closed) first; capture sanitized evidence; confirm zero side effects.
4. Only if the Owner supplies a test-window native sender: run posture **B** for the eligible path and the
   idempotency/dedupe checks; otherwise record B as "not exercised — sender not supplied".
5. Run the guard matrix (§4.C) and enumeration checks (§4.D) with neutral-response equivalence.
6. Verify audits (§4.H); export sanitized evidence to `docs/audits/admin-password-reset-prod-1/`.
7. De-provision the test identity; confirm no residual grant, role, claim, or session change.
8. Record outcome; if any assertion fails, **halt** per §6 and report — do not proceed to PROD-2/3.

---

## 6. Rollback and halt conditions

- **Non-destructive by construction:** AUTH-PROD-1 makes no role/claim/`accessVersion`/Employee-link
  mutation and no session revocation (D-ROUTINE-REVOKE = NO). "Rollback" is limited to **de-provisioning
  the test identity** and removing any test-window sender configuration; there is no production state to
  revert.
- **Halt immediately and report (do not continue)** if: the real Employee↔Auth back-link schema differs
  from the guard's expectations; any neutral-ineligible path is caller-distinguishable; any secret appears
  in caller output or audit; a send occurs under the fail-closed posture; a duplicate email is enqueued for
  a repeated idempotency key; the permission is found active or granted; or any change would risk leaving
  zero recoverable admins.
- **DECISIONS #55 hard stops remain in force throughout:** no deployment (Functions/Rules/Hosting/index);
  no Firebase Auth/project mutation; no production user/data/reset/revocation/email/recovery-email/session
  action; no role/claim/`accessVersion`/Employee-link mutation; no source cutover; no removal of a
  recovery/compatibility fallback. External providers remain indefinitely deferred (#54).

---

## 7. Sanitized evidence contract

- Destination: `docs/audits/admin-password-reset-prod-1/` (created at execution time).
- **Permitted:** pass/fail per assertion, sanitized audit **categories/outcomes**, neutral response codes,
  counts, timing, and the reconciled schema field names (non-secret).
- **Prohibited (never committed):** emails, UIDs, tokens, reset links, action codes, provider bodies, raw
  Auth/Firestore records, or any credential. No broad release; evidence is repository-merged only after
  sanitization review.

---

## 8. Required production inputs, configuration, executor, and authorizations (identified, NOT supplied)

| # | Item | Owner decision / source | State |
| --- | --- | --- | --- |
| 1 | Authorization to run AUTH-PROD-1 | **D-PROD-1-AUTH** | **Not granted** |
| 2 | Named production executor + least-privilege time-boxed access | Owner | Unresolved |
| 3 | Approved test identity (Auth user + linked test employee) | Owner-provisioned, out-of-band | Not supplied |
| 4 | Firebase project / real-Auth access for the test window | Owner-scoped, least-privilege | Not supplied |
| 5 | Concrete Firebase-native send configuration (posture B) | **D-NATIVE-SEND-CONFIG** | Unresolved / untouched |
| 6 | Confirmation permission stays inactive/ungranted | **D-RESET-PERMISSION-ACTIVATION** (deferred) | Deferred |
| 7 | Sanitized-evidence review + merge approval | Owner / Codex | Pending execution |

None of items 1–7 are accessed, requested, or supplied by this package.

---

## 9. What this package explicitly does NOT authorize

Deployment or activation of anything; any production Firebase/Auth read or write; any reset/verification
email; permission activation or role grant; session revocation; any Auth project-setting, Firestore, role,
claim, `accessVersion`, or Employee-link mutation; any AUTH-PR-4 action; any Inventory/Equipment or
Procurement work; any combined release; and committing any credential, email, UID, token, or protected
production evidence.

---

## 10. Sign-off (to be completed at the future gate)

- [ ] **D-PROD-1-AUTH** granted by Owner (separate authorization) — _pending_
- [ ] Executor named and access provisioned — _pending_
- [ ] Approved test identity provisioned — _pending_
- [ ] Verification executed; all §4 assertions pass — _pending_
- [ ] Sanitized evidence merged to `docs/audits/admin-password-reset-prod-1/` — _pending_
- [ ] Independent Codex review of results — _pending_
- [ ] AUTH-PROD-2 (deployment-prep docs) authorized as the next gate — _pending_

_This package is the documentation deliverable for AUTH-PROD-1 preparation only. It remains **PENDING /
NOT AUTHORIZED FOR PRODUCTION** until the Owner acts._
