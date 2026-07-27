# AUTH-PR-4 — Production-Enablement Design Package & Proposed DECISIONS Entry

> **STATUS: PENDING — NOT AUTHORIZED. Repository-only preparation.**
> This document **proposes** the production identity-mutation authorization and
> **designs** the narrow code change that would enable it. It **authorizes nothing**,
> records **no** Owner authorization, and is **not signed or approved**. The proposed
> DECISIONS entry below is **NOT appended to [`docs/DECISIONS.md`](../DECISIONS.md)
> by this PR** — it is appended only when the Owner records authorization in a later,
> separate step. Merging this document changes **nothing** in production and does
> **not** enable production writes. Subject to Codex review; not merged on this
> document alone.

| | |
|---|---|
| Gate | **AUTH-PR-4 production enablement** — preparation only |
| Workstream | Customer / Authentication Modernization (Customer-owned) |
| Governing readiness | [`docs/deployment/auth-pr-4-readiness-authorization-package.md`](./auth-pr-4-readiness-authorization-package.md) (merged, PR #451, `8f28d22`) |
| Governed workflow (merged, production-disabled) | [`functions/scripts/authPr4RecoveryEmailMigration.js`](../../functions/scripts/authPr4RecoveryEmailMigration.js) (PR #453, `63b47b7`) |
| Operator runbook | [`docs/operations/auth-pr-4-operator-workflow.md`](../operations/auth-pr-4-operator-workflow.md) |
| Base | `origin/main` @ `63b47b7` |
| Prepared | 2026-07-27 |
| Prepared by | Customer / Authentication workstream, this session |
| Authorization status | **PENDING — NOT GRANTED. This package requests nothing be executed.** |

---

## 1. Verified current state (read-only)

- The governed operator workflow is merged on `main` (`63b47b7`) and is **mechanically
  production-disabled**: `assertExecutionAuthorization()` **throws before any Firebase
  SDK initialization** when `--execute` or `--rollback` targets the production project
  `taylor-parts` (verified: both refused). No runnable production path exists.
- **AUTH-PR-4 production identity mutation is NOT authorized.** No production execution,
  Auth mutation, email delivery, session revocation, provider configuration, or
  AUTH-PR-3 deployment is authorized.
- Predecessors: AUTH-PR-1 (#438), AUTH-PR-2 (#442), AUTH-PR-3 (#444, `e53c7b0`, **not
  deployed / not enabled**).

Enabling production execution requires **two** separate, later Owner actions, neither
taken here: **(A)** recording the §3 authorization in [`DECISIONS.md`](../DECISIONS.md),
and **(B)** authorizing the separate narrow code PR designed in §5. Even after both, **no
execution happens automatically** — an operator must run the workflow, one identity at a
time, under that recorded authorization.

---

## 2. Exact production sequence (one identity at a time)

Strict serial order — exactly one identity per authorized invocation, each fully verified
and fail-closed before the next begins (readiness §4; enforced by the merged workflow's
ordered-persona guard):

```
1  emp-rudy-driver             (technician, no ops role)        ← lowest risk, first
2  emp-rudy-parts-associate    (dispatcher, PARTS_ASSOCIATE)
3  emp-rudy-warehouse-manager  (dispatcher, WAREHOUSE_MANAGER)
4  emp-rudy-parts-manager      (dispatcher, PARTS_MANAGER)
── GATE: personas 1–4 PASS, AND break-glass confirmed recoverable + login-verified ──
5  emp-rudy-owner              (PRIMARY OWNER / admin)           ← last, only after the gate
```

- **`emp-rudy-sales-manager` — EXCLUDED** (no Auth account; nothing to migrate).
- **Break-glass dev admin — EXCLUDED and PRESERVED** (untouched safety net; must be
  confirmed recoverable and login-verified **before** the owner step; never migrated in
  this batch).

---

## 3. Proposed DECISIONS entry (PROPOSED — PENDING — NOT recorded by this PR)

> **This is proposed text only.** It is **not** appended to
> [`docs/DECISIONS.md`](../DECISIONS.md) by this PR. It is appended **only** when the
> Owner records genuine authorization. The authorization line is left **blank and
> unsigned**. The next sequential number is **#52** (latest recorded entry is #51).

```markdown
## 52. AUTH-PR-4 production recovery-email migration — Production Identity-Mutation Authorization

**Date:** <YYYY-MM-DD — filled by the Owner at authorization, not before>
**Authorization status:** PENDING — NOT GRANTED until the Owner signs the line below.

**Decision (proposed):** Authorize the governed AUTH-PR-4 operator workflow
(`functions/scripts/authPr4RecoveryEmailMigration.js`) to perform a **recovery/auth-email
change** on the following production `taylor-parts` Firebase Auth accounts, **one at a
time, in this order**: (1) `emp-rudy-driver`, (2) `emp-rudy-parts-associate`,
(3) `emp-rudy-warehouse-manager`, (4) `emp-rudy-parts-manager`, and — **only after (1)–(4)
verify PASS and the break-glass admin is confirmed recoverable and login-verified** —
(5) `emp-rudy-owner`. `emp-rudy-sales-manager` and the break-glass admin are **excluded**.

Each account's new email is the Gmail `+alias` from the mapping the Owner supplies
out-of-band and never commits. Each new alias is written with **`emailVerified: false`**.
This authorization does **NOT** permit: sending any reset or verification email; any
explicit `revokeRefreshTokens` or other operator-initiated session revocation; changing
any password / UID / role / claim / `accessVersion` / Employee-link; deploying any
Function; configuring any email provider; or changing any Firebase Auth project setting.
Any Firebase-triggered session invalidation that results automatically from the email
change is an acknowledged possible platform effect (observed and recorded, never an
operator action).

**Authorized commit:** `<exact commit of the enablement PR head, filled at authorization>`.
**Executor:** `<named operator, filled at authorization>`.
**Break-glass confirmation:** `<recorded recoverable + login-verified before step 5>`.

**Granted:** `______________________  — <Owner>  (LEFT BLANK; unsigned until the Owner records it)`
```

---

## 4. Mandatory controls (must remain true through enablement and execution)

Every control below is **already enforced by the merged workflow** and must remain
enforced by the enablement change (§5); the enablement PR may **only** narrow the
production refusal, never relax any of these:

- **One identity at a time** — exactly one persona per invocation.
- **Fail closed between identities** — a disabled / missing / UID-mismatched / colliding
  account **halts the entire sequence**; later personas are not attempted.
- **New alias always starts `emailVerified: false`** — a prior `true` is never carried to
  the new alias.
- **Exact UID and Employee linkage unchanged** — UID preserved; `employees/{id}.userId`
  ⇄ `users/{uid}.employeeId` untouched; verified by post-write read-back.
- **Exact prior address + prior `emailVerified` retained privately for rollback** — held
  only in the protected, signed rollback artifact and the out-of-band operator inputs;
  never committed.
- **No reset or verification email** — the workflow never calls `sendPasswordResetEmail`
  / `generatePasswordResetLink`.
- **No explicit `revokeRefreshTokens` or other operator session-revocation action.**
- **No password / role / claim / `accessVersion` / Firestore / provider change.**
- **Lower-risk personas (1–4) must PASS before the primary owner (5).**
- **Break-glass confirmed recoverable and login-verified before the owner step.**
- **Never commit** private addresses, UIDs, credentials, tokens, mappings, or rollback
  state (readiness §9/§12).
- **Read-back failure never destroys recovery state** — an uncertain/attempted mutation
  retains the signed artifact and warns the operator (PR #453 correction).

---

## 5. Narrow production-enablement change (DESIGN ONLY — not implemented here)

The enablement PR is a **separate, later, Owner-authorized** repository change. Its **only**
functional effect is to allow `assertExecutionAuthorization()` to permit a production write
**when, and only when, a recorded Owner authorization is presented** — replacing today's
*unconditional* refusal with a *conditional, authorization-bound* one. It changes nothing
else.

**Design constraints for the enablement PR:**

1. **Replaces the unconditional production refusal only after a recorded Owner
   authorization.** Absent the recorded authorization inputs, production `--execute` /
   `--rollback` continue to throw exactly as today.
2. **Requires all of the following, checked before any SDK write, or it fails closed:**
   - **Exact project** — `--projectId taylor-parts` with the matching `--confirmProduction taylor-parts`.
   - **Exact authorized commit** — the running workflow's commit must equal the
     `Authorized commit` recorded in the DECISIONS entry (an explicit
     `--authorizedCommit <sha>` that must match the repository HEAD the operator runs).
   - **Exact ordered allowlist** — the existing persona-order guard (unchanged);
     `--position` must match, primary owner still gated on `--breakGlassVerified` +
     `--confirmLowerRiskComplete`.
   - **Explicit execution mode** — a distinct, deliberate production-execution flag
     (e.g. `--confirmProductionIdentityMutation <token-recorded-in-DECISIONS>`); its
     absence keeps the refusal.
   - **Protected mapping and state-key inputs** — `--mappingFile` and `--stateKeyFile`
     supplied out-of-band (never committed).
   - **Sanitized evidence output** — `--evidenceOut` produces only the sanitized,
     salted-hash-referenced evidence (readiness §9); no address/UID/token.
3. **Production rollback remains governed and authorization-bound** — `--rollback` against
   production is permitted only under the same recorded authorization + signed artifact +
   exact-commit + protected inputs; it restores the exact prior address + prior
   `emailVerified` and remains fail-closed. It is never a general escape hatch.
4. **No production execution occurs merely because the enablement code merges.** Merging
   the enablement PR only makes the *conditional* path reachable; execution still requires
   an operator to run the workflow, one identity at a time, presenting every recorded
   input above. Merge ≠ run.

**Explicitly out of scope for the enablement PR:** sending email; session revocation;
password/role/claim/`accessVersion`/Firestore/provider changes; AUTH-PR-3 deployment;
loosening any §4 control; auto-running any persona.

---

## 6. Emulator and negative-test requirements for the enablement PR (NOT implemented here)

The enablement PR must add tests (against the Auth emulator / non-production only) proving,
**before** it may merge:

**Positive (emulator / non-production):**
- With every recorded input present, a production-shaped `--execute` path is reachable
  **only against a non-production/emulator project** in tests (production project id is
  never targeted by CI); forward sets `emailVerified=false`, preserves UID, retains the
  signed artifact; governed rollback restores exact prior address + `emailVerified`.

**Negative (must all fail closed):**
- Missing or non-matching `--authorizedCommit` → refuse (no write).
- Missing the explicit production-execution confirmation flag → refuse (today's behavior).
- Wrong project / missing `--confirmProduction` → refuse.
- Out-of-order persona / primary owner without `--breakGlassVerified` +
  `--confirmLowerRiskComplete` → refuse.
- Missing `--mappingFile` / `--stateKeyFile` → refuse.
- Tampered or unbound signed rollback artifact → refuse (integrity check).
- Read-back failure after a successful `updateUser` → uncertain outcome, artifact
  **retained**, no artifact deletion (PR #453 invariant preserved).
- Assert that **no** test path targets the real `taylor-parts` project.

These are **requirements**, not implementations. This preparation PR adds **no** enablement
code and **no** enablement tests.

---

## 7. Unresolved Owner decisions (must be resolved before enablement executes)

| ID | Decision | Status |
|---|---|---|
| **OD-1** | Grant the §3 production identity-mutation authorization (record #52, sign the line) | **PENDING — not granted** |
| **OD-2** | Supply the base inbox + per-persona `+alias` mapping (out-of-band; never committed) | **PENDING — not requested yet** |
| **OD-3** | Confirm break-glass admin exists, is recoverable, and login-verified before step 5 | **PENDING** |
| **OD-4** | `emailVerified` at migration — fixed at `false` (settled); `true` only after a separate mailbox-control verification | **Default settled; verification-to-`true` deferred** |
| **OD-5** | Whether/when to run the post-migration reset-delivery test (separate authorized action) | **PENDING / deferred** |
| **OD-6** | Named production executor + authorize the separate narrow enablement PR (§5) | **PENDING** |
| **OD-7** | D-EMAIL-DELIVERY provider + enumeration-protection production gate (independent) | **OPEN — not required for AUTH-PR-4 email migration** |

Owner involvement is limited to: the genuine production authorization (OD-1), private
operational inputs (OD-2), the named executor (OD-6), and break-glass confirmation (OD-3).

---

## 8. Confirmation

**No production action has occurred in preparing this package.** No production writes were
enabled; no Firebase Auth email or identity changed; no reset/verification email sent; no
session revoked; no email provider configured; no AUTH-PR-3 deploy; no Firestore / role /
claim / `accessVersion` mutation. No private alias mapping was accessed or requested. No
real email, UID, token, password, credential, or rollback state was read, exposed, or
committed. The production-write block on `main` remains intact. This is a repository-only
preparation document with authorization status **PENDING — NOT AUTHORIZED**, returned for
Codex review.
