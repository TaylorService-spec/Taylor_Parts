# AUTH-PR-4 — Test-User Recovery-Email Migration: Readiness & Owner Authorization Package

> **STATUS: DRAFT READINESS PACKAGE — repository-only. NOT AUTHORIZED TO EXECUTE.**
> This document prepares, and STOPS at, the gate. It authorizes **no** production
> identity mutation, **no** Auth-email change, **no** reset-email send, **no** session
> revocation, **no** email-provider configuration, and **no** AUTH-PR-3 Functions
> deployment. Every operation in §5–§9 is presented for Owner review and is **not to be
> executed by an AI session under this package alone** — execution requires a separate,
> explicit **Production Identity-Mutation Authorization** (verbatim template in §11),
> recorded in [`docs/DECISIONS.md`](../DECISIONS.md), exactly as the persona-provisioning
> gate was handled in [DECISIONS #11](../DECISIONS.md) and the deployment gates in
> [DECISIONS #26/#28/#30/#49](../DECISIONS.md). Merge of this document is additionally
> **subject to Codex review** and does not proceed on this document alone.

| | |
|---|---|
| Gate | **AUTH-PR-4** — test-user recovery-email migration (readiness only) |
| Workstream | Customer / Authentication Modernization (Customer-owned) |
| Governing architecture | [`docs/assessments/auth-modernization-architecture.md`](../assessments/auth-modernization-architecture.md) §11 (PR boundary), §12 (hard stops), §2/§5/§6/§8 |
| Firebase project | `taylor-parts` |
| Base | `origin/main` @ `04fd75c` (confirmed HEAD at package preparation) |
| Predecessors | AUTH-PR-1 (#438, merged), AUTH-PR-2 (#442, merged), AUTH-PR-3 (#444, merged @ `e53c7b0` — **not deployed, not enabled**) |
| Prepared | 2026-07-27 |
| Prepared by | Customer / Authentication workstream, this session |
| Authorization sought by this document | **None.** This is readiness. The execution authorization is drafted in §11 for the Owner to grant later, separately. |

---

## 0. Recovered governing gate (source of truth)

AUTH-PR-4 is defined verbatim by the approved architecture package
([`auth-modernization-architecture.md`](../assessments/auth-modernization-architecture.md) §11):

> **AUTH-PR-4:** test-user recovery-email migration (sanitized persona inventory, Gmail
> +alias readiness, operator procedure, rollback) — execution only after a separate
> production identity-mutation approval; one user at a time; primary admin last;
> break-glass untouched until lower-risk personas pass; real emails/UIDs/tokens never
> committed.

Reinforced by §12 (production hard stops), which independently lists as requiring explicit
authorization: *"changing production Auth emails; sending test-user production reset
emails; revoking production sessions; … any action that could remove Owner or break-glass
access."* AUTH-PR-4 touches the first three directly, so all three hard stops apply.

**Why this migration exists (motivation, from the repository).** Firebase's own
`sendPasswordResetEmail()` and the Admin SDK `generatePasswordResetLink()` always target
the account's **own** registered address — there is no redirect
([`functions/scripts/generatePasswordResetLink.js`](../../functions/scripts/generatePasswordResetLink.js)
header). The five linked test personas ([DECISIONS #11](../DECISIONS.md)) were created
against Auth accounts the Owner made privately, whose recovery inboxes an AI session
cannot reach. To make the AUTH-PR-2 self-service recovery path (§5) and the AUTH-PR-3
admin-reset delivery path (§6) **end-to-end testable**, each persona's recovery/auth email
must resolve to an inbox the Owner controls — which is what the **Gmail `+alias`** scheme
(§3) provides, without provisioning six separate real inboxes.

**Relationship to the deferred login resolver.** Username/password **login** (D-RESOLVER)
is DEFERRED and is **not** part of AUTH-PR-4. This migration concerns the **recovery/auth
email** only — the stable Firebase Auth UID and the email/password credential are
preserved (§2 architecture: "UID is never recreated"; username is an alias, "recovery/auth
email stays distinct from username").

---

## 1. Read-only state at package preparation (no mutation performed)

| Fact | State | How known (no production write) |
|---|---|---|
| Test personas in production | Six provisioned; five linked to Auth accounts, one Employee-only | [DECISIONS #11](../DECISIONS.md) (append-only record) |
| Persona UIDs / emails | **Not in the repository, by Owner instruction** | [DECISIONS #11](../DECISIONS.md): "Not recorded here: UIDs, emails … ask the Owner directly" |
| AUTH-PR-3 Functions | **Zero deployed / not enabled** | Merged as `e53c7b0`; PLATFORM.md "Standby", CUSTOMER.md "not deployed or enabled"; consistent with the no-Functions-live posture in [DECISIONS #35](../DECISIONS.md) |
| Email-enumeration protection (Firebase Auth) | **Not changed** (approved *in principle* only — D-ENUM-PROTECTION) | Architecture §3/§5/§13; a separate production-config gate |
| Email-delivery provider (D-EMAIL-DELIVERY) | **Not selected, not configured** | Architecture §6.2/§13 — OPEN, implementation-time Owner decision |
| Break-glass dev admin | Exists per D-TWO-ADMIN; details **outside Git** | Architecture §8; not an item this package can read or verify itself |

This environment has **no production Admin SDK / Auth credentials** (a repeatedly documented
limitation — [DECISIONS #9/#10/#11/#20/#35](../DECISIONS.md)). Therefore, as in #11, the AI
session **prepares and specifies** the operation; the **Owner executes** and reports
results back for the append-only record.

---

## 2. Sanitized governed test-persona inventory

Identities are referenced **only** by their governed `employeeId` (the same sanitized key
[DECISIONS #11](../DECISIONS.md) uses). **No UID, no email, no credential, no token appears
here or in any committed artifact.** The `securityRole` / `operationalRoles` columns are
already public governance facts recorded in #11 — they are not secrets.

| # | employeeId | securityRole | operationalRoles | Auth-linked? | In migration scope? | Risk tier |
|---|---|---|---|---|---|---|
| 1 | `emp-rudy-driver` | technician | — (none) | Yes | **Yes** | **Lowest** — no Inventory nav access (Issue #100), smallest blast radius |
| 2 | `emp-rudy-parts-associate` | dispatcher | `PARTS_ASSOCIATE` | Yes | **Yes** | Low |
| 3 | `emp-rudy-warehouse-manager` | dispatcher | `WAREHOUSE_MANAGER` | Yes | **Yes** | Low–Med |
| 4 | `emp-rudy-parts-manager` | dispatcher | `PARTS_MANAGER` | Yes | **Yes** | Medium |
| 5 | `emp-rudy-owner` | admin | — (none) | Yes | **Yes — LAST** | **Highest — primary admin** |
| 6 | `emp-rudy-sales-manager` | — (Employee-only) | — | **No** | **No — excluded** | n/a — no Auth account, no email to migrate |
| — | break-glass dev admin | admin (independent) | — | (outside Git) | **No — untouched** | Safety net; must stay recoverable throughout |

**Exclusions, justified:**
- **`emp-rudy-sales-manager`** has `userId == null` and no Auth/User linkage ([DECISIONS #11](../DECISIONS.md)) — there is no Auth email to migrate. Touching it is out of scope by construction.
- **Break-glass dev admin** is deliberately **not migrated in this batch** (§8 D-TWO-ADMIN). It is the independent recoverable admin that keeps the final-active-admin guarantee true while the primary Owner admin (#5) is migrated. Migrating it, if ever desired, is a separate later step after #1–#5 succeed.

---

## 3. Gmail `+alias` readiness and limitations

**Scheme.** Each in-scope persona's recovery/auth email becomes a distinct sub-address of a
single Owner-controlled Gmail inbox, e.g. `<owner-inbox>+driver-admin@gmail.com`,
`<owner-inbox>+parts-associate@gmail.com`, …, `<owner-inbox>+owner@gmail.com`. Gmail
delivers every `+tag` variant to the one base inbox, so the Owner receives and can act on
reset emails for **all** personas from one place. The alias suffixes align with the stable
explicit persona naming already approved under **D-DEFAULT-USERNAME** (e.g. `driver-admin`).

**The concrete base inbox and the exact per-persona alias mapping are supplied by the Owner
at execution time and are NEVER committed** (they are real addresses → §12 hard stop / §10
sanitization). This document commits only the *pattern*.

**Readiness (why it works):**
- Firebase Auth treats `base+tag@gmail.com` as a **distinct** account email — no collision with the base address or with sibling tags. Good for per-persona isolation.
- Delivery is real: `sendPasswordResetEmail()` / `generatePasswordResetLink()` output reaches the Owner's inbox, making §5/§6 testable without six inboxes.

**Limitations (must be understood before approval):**
- **Not a security boundary.** Every alias shares one inbox; whoever can read the base inbox can complete a reset for **any** persona. Acceptable for *test personas* only — **never** a model for real customer/operator identities.
- **`+` handling.** Some providers/forms reject or strip `+`; some normalize Gmail dots. Firebase accepts `+`, but any downstream reader of `user.email` should be spot-checked (architecture §3 Option B note on synthetic emails — not triggered here, but the same "audit `user.email` readers" caution applies if any code branches on the address).
- **Enumeration interaction.** Whether a reset email actually *arrives* is a delivery signal, not an app-exposed enumeration signal; the app's neutral copy (§5) is unchanged. The `+alias` scheme does not weaken (or strengthen) enumeration protection — see §12.
- **Verification state.** If a persona's new alias email is set with `emailVerified: false`, some flows differ from a verified address. Whether to set `emailVerified: true` at migration is an **Owner decision** (§13, OD-4) — it must not be assumed.
- **Provider independence.** This scheme relies on Gmail native delivery and Firebase's built-in reset email. It does **not** select or configure the D-EMAIL-DELIVERY transactional provider (§7).

---

## 4. Migration order (one user at a time; lower-risk first; primary admin last)

Strict serial order — **exactly one identity per authorized step**, each fully verified and
each with its own stop-check before the next begins:

```
Step 1  emp-rudy-driver            (technician, no ops role)      ← lowest risk, first
Step 2  emp-rudy-parts-associate   (dispatcher, PARTS_ASSOCIATE)
Step 3  emp-rudy-warehouse-manager (dispatcher, WAREHOUSE_MANAGER)
Step 4  emp-rudy-parts-manager     (dispatcher, PARTS_MANAGER)
── GATE: all four lower-risk personas PASS (§6) before proceeding ──
── PRECONDITION: break-glass dev admin login re-verified (§8, D-TWO-ADMIN) ──
Step 5  emp-rudy-owner             (PRIMARY ADMIN)                ← last, only after the gate
```

- **Break-glass** is **untouched** and its recoverability re-confirmed **before** Step 5,
  so the primary-admin migration never risks the final-active-admin guarantee.
- `emp-rudy-sales-manager` never appears — nothing to migrate (§2).
- A failure at any step **halts the sequence** (§6 stop conditions); later steps are not
  pre-authorized by earlier successes.

---

## 5. Reset-email and session-impact boundaries (what a migration does and does NOT do)

A recovery/auth-email migration is a **single Admin-SDK identity attribute change** on one
UID. Its boundaries, stated so the Owner authorizes exactly this and no more:

- **Does change:** the account's recovery/auth **email address** (and, only if OD-4
  approves, its `emailVerified` flag).
- **Does NOT change:** the **UID**, the **password credential**, `securityRole`,
  `operationalRoles`, `accessVersion`, custom claims, the Employee↔User link
  (`employees/{id}.userId` ⇄ `users/{uid}.employeeId`), or any Firestore business data.
- **Does NOT send any email.** Migration ≠ recovery. This package's execution **must not**
  call `sendPasswordResetEmail()` or deliver a reset link. Verifying that *reset delivery
  now works* to the new alias is a **separate, later, explicitly-authorized** test — never
  bundled into the email-change step (§13, OD-5).
- **Does NOT revoke sessions.** Changing an auth email does not, by itself, require
  `revokeRefreshTokens`. This package **must not** revoke production sessions (hard stop).
  Any existing session for the persona continues under the same UID; if the Owner *wants* a
  clean session as part of testing, that is a distinct authorized action, not a side effect
  here.
- **AuthContext impact: none by design.** `AuthContext` keys off UID and reads
  `users/{uid}` / `employees/{employeeId}` — none of which change. The client auth-state
  authority is untouched (architecture §0: "AuthContext remains the single client-side
  auth-state authority").

---

## 6. Preflight, per-identity verification, and stop conditions

**Per-step preflight (read-only, before any write):**
1. Confirm the target `employeeId` is exactly one of Steps 1–5 in the authorized order, and that the previous step (if any) is recorded PASS.
2. Read-only confirm the target account exists, is **enabled** (not disabled — §7), and its current UID matches the intended persona (Owner cross-checks against the private #11 mapping).
3. Confirm the intended new `+alias` is **unused** by any other Auth account (collision check — §7).
4. For **Step 5 only**: re-verify break-glass admin login and confirm ≥2 recoverable admins will remain after the change (final-active-admin guard, §8).

**Per-step verification (read-only, after the single write):**
- Read back the account: new email is set; **UID unchanged**; password credential intact (login still succeeds with the same password); `emailVerified` is exactly the intended value.
- Read back Firestore: `employees/{id}.userId` and `users/{uid}.employeeId` still cross-reference correctly; `securityRole` / `operationalRoles` / `accessVersion` unchanged.
- Confirm **no email was sent** and **no session was revoked** by this step.
- Record a sanitized PASS/FAIL (§10) before the next step.

**Stop conditions (halt the whole sequence, do not improvise):**
- Preflight finds the account disabled, missing, UID-mismatched, or the new alias already in use.
- Post-write read-back shows any unintended change (UID, credential, link, role, claim, version).
- Step 5 preflight cannot confirm a second recoverable admin.
- Any ambiguity about which real address maps to which persona (Owner resolves out-of-band; never guess).
- Any signal that an email was sent or a session revoked unexpectedly.

---

## 7. Email-collision and disabled-user handling

- **Email collision** (Firebase `auth/email-already-exists`): the target `+alias` is already
  bound to another account. **Never** overwrite, never merge, never reassign a UID (mirrors
  the username-collision rule, architecture §2: "never silently overwrite … never bind two
  UIDs to the same active" key). Halt; the Owner selects an alternate tag
  (`+parts-associate2`, …) and re-preflights. Record the final choice (sanitized) in
  evidence.
- **Disabled user:** if preflight shows the account disabled, **do not** enable it as a side
  effect and **do not** migrate it. Enable/disable is `setUserStatus` governance
  (architecture §6.2: "Do not overload it"); a disabled persona is out of scope until the
  Owner separately decides its lifecycle. Halt that step; continue only with the remaining
  authorized, enabled personas in order.

---

## 8. Rollback / recovery per identity

Because each step is a single attribute change on one UID, rollback is per-identity and
immediate:

- **Rollback trigger:** any failed post-write verification (§6) for that identity.
- **Rollback action:** restore that account's **previous** recovery/auth email (and previous
  `emailVerified`) via the same Admin-SDK path — one UID, one attribute, reversed. The Owner
  holds the prior address (from the private #11 mapping); it is **not** committed to Git.
- **Isolation:** one-user-at-a-time means a rollback affects only the failed identity; Steps
  already PASSed are untouched, and later Steps are simply not started.
- **Primary-admin safety (Step 5):** if the Owner-admin migration fails, **break-glass**
  (untouched, pre-verified) is the recovery path; the final-active-admin guard (architecture
  §8) means the sequence must already have guaranteed a second recoverable admin before Step
  5 ran. Break-glass recovery itself is the controlled, out-of-Git Owner procedure in
  architecture §8.
- **No destructive fallback:** rollback never deletes/recreates an account (UID must be
  preserved), never edits Firestore business data, and never sends email.

---

## 9. Evidence capture and sanitization

Follows the [DECISIONS #11](../DECISIONS.md) precedent exactly:

- **Recorded (safe):** per-step PASS/FAIL, the `employeeId`, the *pattern* used
  (`<owner-inbox>+<persona-tag>`), UID-unchanged confirmation (as a boolean, **not** the
  UID), "no email sent", "no session revoked", and the append-only [DECISIONS](../DECISIONS.md)
  entry that will record completion.
- **NEVER recorded / committed:** real base inbox, real `+alias` addresses, UIDs, passwords,
  reset links, OOB codes, ID/refresh tokens, or any account-identifying value (§12 hard
  stop). If a debugging need arises, the Owner supplies the mapping out-of-band, exactly as
  #11 prescribes.
- Evidence lives under `docs/audits/auth-pr-4/` when the executed run is recorded — created
  **only** at/after authorized execution, never pre-populated with real data.

---

## 10. Separation from AUTH-PR-3 deployment and provider configuration

This package is **strictly disjoint** from AUTH-PR-3 activation:

- AUTH-PR-3 (#444, `e53c7b0`) is **merged but not deployed and not enabled**. AUTH-PR-4
  readiness **does not deploy it**, does not select or configure the **D-EMAIL-DELIVERY**
  transactional provider, and does not depend on either. The self-service recovery path (§5,
  AUTH-PR-2) uses Firebase's native `sendPasswordResetEmail` and needs **no** provider
  (architecture §6.2).
- The persona email migration is an **identity-data** operation (Admin SDK `updateUser`
  semantics), not a Functions deploy, Rules change, index deploy, or Firebase-config change.
- The two gates may proceed independently: AUTH-PR-4 makes reset delivery *testable to a
  reachable inbox*; AUTH-PR-3 deployment (whenever separately authorized) makes the
  *admin-initiated* reset Function live. Neither is a precondition of the other at the
  repository level.

---

## 11. Exact production identity-mutation authorization wording (for the Owner to grant later)

This wording is **drafted, not granted.** Nothing executes until the Owner records it (or an
equivalent) in [`docs/DECISIONS.md`](../DECISIONS.md), matching the #11 / #26 / #49
precedent. Bracketed values are supplied by the Owner and stay **out of Git**.

> **Production Identity-Mutation Authorization — AUTH-PR-4 (test-persona recovery-email migration)**
>
> I authorize a **recovery/auth-email change** on the following production `taylor-parts`
> Firebase Auth accounts, **one at a time, in this order**: (1) `emp-rudy-driver`,
> (2) `emp-rudy-parts-associate`, (3) `emp-rudy-warehouse-manager`,
> (4) `emp-rudy-parts-manager`, and — **only after (1)–(4) verify PASS and break-glass login
> is re-confirmed** — (5) `emp-rudy-owner`. Each account's new email is the Gmail `+alias`
> from the mapping I supply out-of-band. `emp-rudy-sales-manager` and the break-glass admin
> are **excluded**.
>
> Scope of each change is limited to the recovery/auth **email** [and `emailVerified` =
> `<true|false>` per OD-4]. This authorization does **NOT** permit: sending any reset email,
> revoking any session, changing any password/UID/role/claim/`accessVersion`/Employee-link,
> deploying any Function, configuring any email provider, or changing any Firebase Auth
> project setting. Execution is by **me (the Owner)** [or: the named operator] via
> Console/Admin SDK; results are reported back for the append-only [DECISIONS](../DECISIONS.md)
> record. A failed verification triggers the §8 rollback for that identity and halts the
> sequence.
>
> Granted: `<date>` — `<Owner>`.

---

## 12. Production hard stops (restating architecture §12 for this gate)

Explicit, separate authorization is required — and is **NOT** given by this document — before:
changing any production Auth email; sending any test-user production reset email; revoking
any production session; enabling email-enumeration protection; selecting/configuring an
email-delivery provider; deploying/modifying any Function; or any action that could remove
Owner or break-glass access. **No real email, UID, token, password, reset link, or OOB code
may be committed to the repository under any circumstance.**

---

## 13. Owner decisions genuinely required (unresolved)

| ID | Decision | Why it is the Owner's, and blocks execution |
|---|---|---|
| **OD-1** | **Grant the §11 authorization** (go/no-go for the email migration) | The core production identity-mutation gate; nothing runs without it. |
| **OD-2** | **Supply the base inbox + per-persona `+alias` mapping** (out-of-band) | Real addresses are secrets (§12); only the Owner holds them; the pattern alone is insufficient to execute. |
| **OD-3** | **Confirm break-glass admin exists, is recoverable, and login-verified** before Step 5 | Precondition for the final-active-admin guarantee (architecture §8, D-TWO-ADMIN); this session cannot read or verify it. |
| **OD-4** | **`emailVerified` at migration — set `true`, or leave `false`?** | Affects reset-flow behavior (§3); setting verified without a real verification is a trust decision only the Owner can make. |
| **OD-5** | **Whether/when to run the post-migration reset-delivery test** (a *separate* authorized action, not part of the email change) | Sending a reset email is its own §12 hard stop; must not be bundled into the migration. |
| **OD-6** | **Executor + method** — Owner-run via Console/Admin SDK (as #11), or a new governed operator script (which would be its own repository gate) | Determines whether any additional tooling PR is needed; no such script is proposed here. |
| **OD-7 (record)** | **D-EMAIL-DELIVERY stays OPEN**; AUTH-PR-4 neither resolves nor needs it | Confirms scope separation (§10); noted so review does not read AUTH-PR-4 as forcing a provider choice. |

---

## 14. Confirmation

**No production action has occurred in preparing this package.** No Auth email changed; no
reset email sent; no session revoked; no email provider configured; no Function deployed; no
identity, role, claim, `accessVersion`, or Firestore data mutated; no real email, UID,
token, password, or credential read, exposed, or committed. This is a repository-only
readiness document that STOPS at the gate and is returned for Codex review.
