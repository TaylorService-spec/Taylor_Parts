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

**Corrected gate sequence** (removes the future-commit circularity — the authorization
cannot bind to an enablement head that does not yet exist):

1. **Merge this corrected design package** (docs-only; enables nothing).
2. **Build and review the separate enablement PR** (§5) **without production execution**.
3. After review, **identify the exact reviewed implementation head** plus a **deterministic
   SHA-256 of the governed workflow and the relevant authorization/progression code**.
4. **Owner authorization** (§3) is appended as a **new append-only DECISIONS entry** that
   records the **exact reviewed enablement head and the governed-file hashes**. Once
   appended, that entry is **never edited** (append-only history).
5. Merge the enablement PR **preferably with a method that preserves the reviewed head in
   ancestry**. If the resulting merge commit must also be recorded, add a **separate,
   new append-only execution-readiness / merge-attestation entry** that references the
   original authorization — **the original decision is not modified** (§5.4a). The
   attestation records the resulting merge commit, confirms the reviewed head is in
   ancestry where applicable, repeats or references the governed-file hashes, and states
   that execution remains separately operator-triggered. **If a squash merge prevents
   ancestry preservation, the attestation must prove the merged governed-file hashes
   exactly match the reviewed hashes.**
6. **Execution verifies both** approved ancestry/commit identity **and** the exact governed-
   file hashes, **independently derived** before SDK init (§5.4). **Any mismatch requires
   re-review and a new authorization — history is never amended to make it match.**

Even after all of the above, **no execution happens automatically** — an operator must run
the workflow, one identity at a time, under the recorded authorization and a valid
progression state (§5.1).

---

## 2. Exact production sequence (one identity at a time)

Intended strict serial order — exactly one identity per authorized invocation, each fully
verified and fail-closed before the next begins (readiness §4):

> **Accuracy note — the merged workflow does NOT yet enforce this cross-invocation order.**
> The merged workflow (`63b47b7`) validates only that, *within a single invocation*,
> `employeeId` matches the supplied `--position`, and that the primary-owner step carries the
> `--breakGlassVerified` + `--confirmLowerRiskComplete` flags. Those flags are **operator
> assertions**, not proof that personas 1–4 actually completed; separate invocations could
> still run personas 2–4 before their predecessors, or repeat/reorder them. **Enforcing the
> complete serial sequence across invocations is a REQUIREMENT OF THE FUTURE ENABLEMENT
> IMPLEMENTATION (§5.1), not a property the current build already has.**

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
> [`docs/DECISIONS.md`](../DECISIONS.md) by this PR. It is appended **only** when the Owner
> records genuine authorization. The authorization line is left **blank and unsigned**.
> **Number:** use **the next available append-only DECISIONS number at authorization time**
> — as of this writing the latest recorded entry is #51, so #52 is expected to be next, but
> if #52 is taken by then, use the actual next number. **No existing entry is renumbered or
> edited.** The `NN` below is filled at authorization.

```markdown
## NN. AUTH-PR-4 production recovery-email migration — Production Identity-Mutation Authorization

**Date:** <YYYY-MM-DD — filled by the Owner at authorization, not before>
**Authorization status:** PENDING — NOT GRANTED until the Owner signs the line below.

**Decision (proposed):** Authorize the governed AUTH-PR-4 operator workflow
(`functions/scripts/authPr4RecoveryEmailMigration.js`) to perform a **recovery/auth-email
change** on the following production `taylor-parts` Firebase Auth accounts, **one at a
time, in this order**: (1) `emp-rudy-driver`, (2) `emp-rudy-parts-associate`,
(3) `emp-rudy-warehouse-manager`, (4) `emp-rudy-parts-manager`, and — **only after (1)–(4)
are DURABLY complete (per the integrity-checked progression record, §5.1) and the break-glass
admin confirmation (§5.2) is valid** — (5) `emp-rudy-owner`. `emp-rudy-sales-manager` and the
break-glass admin are **excluded**.

Each account's new email is the Gmail `+alias` from the mapping the Owner supplies
out-of-band and never commits. Each new alias is written with **`emailVerified: false`**.
This authorization does **NOT** permit: sending any reset or verification email; any
explicit `revokeRefreshTokens` or other operator-initiated session revocation; changing
any password / UID / role / claim / `accessVersion` / Employee-link; deploying any
Function; configuring any email provider; or changing any Firebase Auth project setting.
Any Firebase-triggered session invalidation that results automatically from the email
change is an acknowledged possible platform effect (observed and recorded, never an
operator action).

**Bound reviewed implementation (§5.4):** this authorization is bound to the **exact reviewed
enablement head** `<reviewed head SHA, filled at authorization AFTER the enablement PR is
built, reviewed, and its head is known>` **and** the recorded **SHA-256 content hashes of the
governed files** `<hash list, filled at authorization>`. **This entry is append-only and is
never edited after it is recorded.** If a squash/merge produces a different `main` commit,
that fact is captured in a **separate, new append-only execution-readiness / merge-attestation
entry** (§5.4a) — **not** by editing this entry. Execution must independently re-derive and
match the governed-file hashes and either find the reviewed head in ancestry or match the
merge commit recorded in that later attestation. Any post-review change to a governed file, or
any hash mismatch, invalidates this authorization and requires re-review + a new
authorization — history is never amended to match.
**Executor:** `<named operator, filled at authorization>`.
**Break-glass requirement (§5.2):** a valid authorization-bound break-glass confirmation must
be produced **after** positions 1–4 complete and **immediately before** position 5; the actual
confirmation is recorded **separately** (a protected, integrity-checked execution artifact,
plus a sanitized append-only evidence/attestation reference where repository evidence is
required) and is **not present at initial authorization**.

**Granted:** `______________________  — <Owner>  (LEFT BLANK; unsigned until the Owner records it)`
```

---

## 4. Mandatory controls (must remain true through enablement and execution)

Each control is labelled by **who enforces it**: **[merged]** = already enforced by the
merged workflow (`63b47b7`) within a single invocation; **[§5]** = a **requirement of the
future enablement implementation**, not yet present. The enablement PR may **only** narrow
the production refusal and add the §5 controls; it may never relax any control below.

- **One identity at a time** — exactly one persona per invocation. **[merged]**
- **Fail closed within an invocation** — a disabled / missing / UID-mismatched / colliding
  account **halts that invocation** (throws); it is never skipped or enabled. **[merged]**
- **New alias always starts `emailVerified: false`** — a prior `true` is never carried to
  the new alias. **[merged]**
- **Exact UID unchanged** — UID preserved and **verified unchanged through the Auth
  read-back** after the write. **[merged]**
- **Employee/User linkage not mutated** — the workflow accesses **Firebase Auth only** and
  performs **no Firestore read or write**, so `employees/{id}.userId` ⇄
  `users/{uid}.employeeId` is left untouched. It **does not itself verify** the reciprocal
  linkage (no Firestore read-back). **If production verification must PROVE the linkage
  remains intact, that is a separate governed read-only pre/post linkage check using
  existing repository-authorized verification tooling (§5.3)** — never a new write path, and
  never exposing UIDs in committed evidence. **[merged for non-mutation; §5.3 for proof]**
- **Exact prior address + prior `emailVerified` retained privately for rollback** — held
  only in the protected, signed rollback artifact and the out-of-band operator inputs;
  never committed. **[merged]**
- **No reset or verification email** — the workflow never calls `sendPasswordResetEmail`
  / `generatePasswordResetLink`. **[merged]**
- **No explicit `revokeRefreshTokens` or other operator session-revocation action.** **[merged]**
- **No password / role / claim / `accessVersion` / Firestore / provider change.** **[merged]**
- **Personas 1–4 DURABLY complete before the primary owner (5)** — enforced by the
  integrity-checked progression record; **not** by the `--position` /
  `--confirmLowerRiskComplete` operator flags, which cannot prove predecessor completion. **[§5.1]**
- **Break-glass bound to a separately recorded, integrity-protected confirmation** (not a
  bare boolean flag) before the owner step. **[§5.2]**
- **Never commit** private addresses, UIDs, credentials, tokens, mappings, rollback state,
  or break-glass identity/credentials (readiness §9/§12). **[merged / §5]**
- **Read-back failure never destroys recovery state** — an uncertain/attempted mutation
  retains the signed artifact and warns the operator (PR #453 correction). **[merged]**

---

## 5. Narrow production-enablement change (DESIGN ONLY — not implemented here)

The enablement PR is a **separate, later, Owner-authorized** repository change. Its **only**
functional effect is to allow `assertExecutionAuthorization()` to permit a production write
**when, and only when, a recorded Owner authorization is presented** — replacing today's
*unconditional* refusal with a *conditional, authorization-bound* one. It changes nothing
else.

**Design constraints for the enablement PR.** The enablement PR must add all of §5.1–§5.4
and satisfy §5.5–§5.6. Absent the recorded authorization and a valid progression state,
production `--execute` / `--rollback` continue to throw exactly as today.

**Required, checked before any SDK write, or it fails closed:**
- **Exact project** — `--projectId taylor-parts` with matching `--confirmProduction taylor-parts`.
- **Repository & code identity (§5.4)** — the workflow independently derives and verifies
  repository identity and governed-file hashes; a user-supplied commit value is never
  sufficient by itself.
- **Explicit execution mode** — a distinct, deliberate production-execution flag whose
  absence keeps the refusal.
- **Valid progression state (§5.1)** authorizing exactly this persona as the next step.
- **Valid break-glass confirmation (§5.2)** for the owner step.
- **Protected mapping and state-key inputs** — `--mappingFile` / `--stateKeyFile` supplied
  out-of-band (never committed).
- **Sanitized evidence output** — `--evidenceOut` produces only sanitized, salted-hash-
  referenced evidence (readiness §9); no address/UID/token.

### 5.1 Protected, integrity-checked progression record (enforces cross-invocation order)

The enablement implementation MUST maintain a protected, integrity-checked **progression
record** — the authority for cross-invocation ordering that the current build lacks. It:

- is **cryptographically bound** to the project, the authorization identifier, the approved
  **workflow identity** (§5.4 hashes/commit), and the fixed migration sequence;
- **begins with only position 1 (`emp-rudy-driver`) eligible**;
- **advances by exactly one step only after** the current persona's write **and** read-back
  verification both complete successfully;
- records **sanitized** completion evidence (booleans / salted-hash refs / timestamps) with
  **no addresses or UIDs**;
- **permits only the next exact persona** — and **refuses** skipped, repeated, reordered,
  conflicting, or stale execution;
- on an **uncertain outcome** (attempted/unconfirmed mutation) **records it and does NOT
  advance** (consistent with the PR #453 artifact-retention invariant);
- defines how a **successful rollback** affects progression: a rolled-back persona is
  returned to *not-complete* (or the run is suspended), and **later personas are blocked**
  until the sequence is re-established;
- **requires personas 1–4 to be durably complete before position 5**;
- **cannot be bypassed** by supplying `--position` or `--confirmLowerRiskComplete` — those
  operator flags are inputs to, never substitutes for, the progression record.

### 5.2 Break-glass confirmation — recorded, integrity-protected, produced immediately before position 5

`--breakGlassVerified` is an **operator assertion only** and MUST NOT be described or used as
independent proof. Confirmation is **two-staged in time** so it cannot be a stale check made
at initial authorization:

- **At initial Owner authorization (§3):** only the **requirement and the approved
  confirmation contract** are recorded — **not** a completed break-glass check.
- **At execution, after personas 1–4 pass and immediately before position 5:** the operator
  produces the **actual** break-glass confirmation as a **separate protected, integrity-checked
  execution artifact** (and, where repository evidence is required, a **sanitized append-only
  evidence/attestation reference**). It MUST be **bound to** the authorization identifier, the
  progression record, **position 5**, the named confirmer/executor, a **timestamp**, and a
  **validity window**, and contain a sanitized result showing recoverability + login
  verification.
- **Position 5 fails closed** if the confirmation is **missing, expired, mismatched (bound to
  another authorization/progression record), or was created before the required 1–4
  completion state**, or is **reused after a rollback or progression-state change**.
- **No break-glass credentials, email, UID, or identifying details may be committed.**

### 5.3 Employee/User linkage proof is a separate governed read-only check

The workflow itself touches **Firebase Auth only** and does not read Firestore, so it does
not prove the reciprocal Employee/User linkage. If production verification must prove the
linkage remains intact, the enablement design requires a **separate, governed, read-only
pre/post linkage check using existing repository-authorized verification tooling**. That
check **must not create a new write path** and **must not expose UIDs in committed
evidence** (sanitized booleans/refs only).

### 5.4 Authorization is bound to reviewed code identity, independently verified (no future-commit circularity)

The authorization cannot bind to "the exact enablement PR head" while that PR does not yet
exist, and a squash/merge yields a different `main` commit. Therefore:

- The workflow **independently derives** repository identity (the reviewed commit in
  ancestry, or the recorded post-merge commit) **and** re-computes a **deterministic SHA-256
  of the governed workflow and the relevant authorization/progression code**, and verifies
  both **before SDK initialization**.
- A **user-supplied `--authorizedCommit` value is never sufficient by itself**; it may be an
  input, but the workflow's own derived identity + hashes are authoritative.
- **Any post-review change to a governed file invalidates the authorization** and requires
  re-review (the hash no longer matches).

### 5.4a Append-only merge attestation (never edit the original authorization)

The original Owner authorization entry (§3) is **append-only and never edited** after it is
recorded. When the enablement PR is merged and the reviewed head must be reconciled with the
resulting `main` commit, a **separate, new append-only execution-readiness / merge-attestation
DECISIONS entry** is added that references the original authorization by number. That
attestation:

- records the **resulting merge commit**;
- **confirms the reviewed head is in ancestry** where applicable;
- **repeats or references the recorded governed-file SHA-256 hashes**;
- states that **execution remains separately operator-triggered** (merge ≠ run);
- **if a squash merge prevents ancestry preservation, proves the merged governed-file hashes
  exactly match the reviewed hashes** (hash equality stands in for ancestry).

**Any mismatch requires re-review and a new authorization; history is never amended to make it
match.** The original authorization is not modified by this attestation.

### 5.5 Production rollback remains governed and authorization-bound

`--rollback` against production is permitted only under the same recorded authorization +
signed artifact + §5.4 identity/hash verification + valid progression state + protected
inputs; it restores the exact prior address + prior `emailVerified`, updates progression per
§5.1, and remains fail-closed. It is never a general escape hatch.

### 5.6 Merge ≠ run

**No production execution occurs merely because the enablement code merges.** Merging only
makes the *conditional* path reachable; execution still requires an operator to run the
workflow, one identity at a time, presenting every recorded input and a valid progression
state.

**Explicitly out of scope for the enablement PR:** sending email; session revocation;
password/role/claim/`accessVersion`/Firestore/provider changes; AUTH-PR-3 deployment;
loosening any §4 control; auto-running any persona.

---

## 6. Emulator and negative-test requirements for the enablement PR (NOT implemented here)

The enablement PR must add tests (against the Auth emulator / non-production only) proving,
**before** it may merge:

**Positive (emulator / non-production):**
- With every recorded input present and a valid progression state, a production-shaped
  `--execute` path is reachable **only against a non-production/emulator project** in tests
  (the real `taylor-parts` project id is never targeted by CI); forward sets
  `emailVerified=false`, preserves UID, retains the signed artifact; governed rollback
  restores exact prior address + `emailVerified` and updates progression.
- Progression advances position 1 → 2 → 3 → 4 → 5 only, each step gated on a successful
  write + read-back for the prior persona; personas 1–4 durably complete before 5.

**Negative (must all fail closed):**
- **Skipped predecessor** — attempting a persona whose predecessor is not durably complete → refuse.
- **Repeated predecessor** — re-running an already-complete persona → refuse (no repeat).
- **Out-of-order invocation** — any persona other than the exact next one → refuse.
- **Uncertain outcome does not advance** — an attempted/unconfirmed mutation records the
  uncertain outcome, retains the signed artifact, and leaves progression un-advanced.
- **Rollback changes/suspends progression** — after a successful rollback the persona is
  not-complete (or the run is suspended) and later personas are blocked until re-established.
- **Forged / tampered progression state** — integrity check fails → refuse.
- **Stale authorization or workflow hash** — authorization identifier or governed-file
  SHA-256 does not match the current code → refuse.
- **User-supplied commit text disagreeing with repository-derived identity** — the
  `--authorizedCommit` input contradicts the workflow's independently derived commit/hashes
  → refuse (derived identity is authoritative).
- **Break-glass confirmation timing / binding (all refuse position 5):** confirmation
  **created before positions 1–4 completed**; confirmation **outside its validity window**
  (expired); confirmation **bound to another authorization or progression record**; **reuse of
  a confirmation after a rollback or progression-state change**; confirmation missing.
- **Append-only history / merge attestation:** execution refuses if the reviewed head is not
  in ancestry **and** no merge-attestation entry recording a hash-matching merge commit
  exists; a squash-merged commit whose governed-file hashes do **not** equal the reviewed
  hashes → refuse; verify the original authorization entry is **unmodified** (attestation is a
  separate append-only entry, never an edit of the original).
- **Auth UID read-back vs separately governed Employee-link read verification** — the
  workflow verifies UID unchanged via Auth read-back; a test asserts that Employee/User
  linkage proof, where required, comes from the separate §5.3 read-only check and never from
  a new write path or committed UID.
- **Missing explicit production-execution flag / wrong project / missing `--confirmProduction`
  / missing `--mappingFile` or `--stateKeyFile` / tampered-or-unbound rollback artifact** → refuse.
- Assert that **no** test path targets the real `taylor-parts` project.

These are **requirements**, not implementations. This preparation PR adds **no** enablement
code and **no** enablement tests.

---

## 7. Unresolved Owner decisions (must be resolved before enablement executes)

| ID | Decision | Status |
|---|---|---|
| **OD-1** | Grant the §3 production identity-mutation authorization (record it as the next available append-only DECISIONS entry — expected #52 — and sign the line) | **PENDING — not granted** |
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
