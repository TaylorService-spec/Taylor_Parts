# Admin Password Reset — Implementation Plan (gated PR sequence)

- **Baseline `origin/main`:** `bc0fda57c9b35a967cef75b3df747a6fac91ec15`.
- **Companion docs:** [`assessments/admin-password-reset-current-state.md`](../assessments/admin-password-reset-current-state.md),
  [`specifications/admin-password-reset-ui.md`](../specifications/admin-password-reset-ui.md).
- **Owner fixed inputs:** [`DECISIONS.md`](../DECISIONS.md) #54 (deferral), #55 (continuous-execution authority).
- **Status:** PROPOSED — pending Owner + ChatGPT/Codex review. No runtime code is authorized by this plan.

Each gate is a **small, separately reviewed PR**, draft first, rebased on current `origin/main`, with
every changed file listed, runtime files separated from docs/evidence, tests + exact results,
rollback, and explicit non-authorizations. **Merge ≠ deployment.**

---

## Gate map

| Gate | Type | Depends on | Owner decision required first |
|---|---|---|---|
| **AUTH-UI-1** (this PR) | docs-only | — | — (reviewed here) |
| **AUTH-UI-2** | runtime (pure domain/UI state) | UI-1 approved | none new (UI-1 approval) |
| **AUTH-UI-3** | runtime (Admin portal integration) | UI-2 | none new (UI-1 approval) |
| **AUTH-PR-3.5** | runtime (backend delivery revision + guards) | UI-1 | **D-DELIVERY-NATIVE, D-ROUTINE-REVOKE, D-RESET-PERMISSION, guard-gap** |
| **AUTH-PROD-1** | prod verification (read-only/bounded) | 3.5 | separate production authorization |
| **AUTH-PROD-2** | deployment preparation (docs) | PROD-1 | — (proposal) |
| **AUTH-PROD-3** | production deployment + verification | PROD-2 | separate production authorization |
| **AUTH-PROD-4** | production completion record (docs) | PROD-3 | — |

AUTH-UI-2/3 are **independent of the delivery decision** — they ship the truthful UI (incl.
configuration-unavailable). AUTH-PR-3.5 and all AUTH-PROD gates are **hard-stopped** on the Owner
decisions in the assessment §10.

---

## AUTH-UI-2 — pure UI/domain state (runtime, repository-only, no deployment)

**Files (planned):**
- `field-ops-app-vite/src/domain/adminPasswordReset.js` — pure view-model: eligibility→display
  mapping, mode model, **action-state machine** (§7 of the spec), sanitized backend-outcome→UI-state
  mapping, idempotency-key generation, duplicate-submit lock/cooldown (mirroring
  `passwordRecovery.js`'s controller pattern).
- `field-ops-app-vite/test/adminPasswordReset.test.mjs` — unit tests for every mapping and terminal
  state, incl. accepted vs. delivered-confirmed (unreachable for native) vs. uncertain, self-target,
  ineligible, denied, service-/configuration-unavailable, replay/no-second-effect.

**No** callable wiring, **no** React integration, **no** deployment. Pure logic in `domain/` per the
codebase pattern.

**Checks:** unit suite green; lint; typecheck; build. Clean-checkout validation.

**Rollback:** revert the PR (additive, isolated module; nothing imports it yet).

---

## AUTH-UI-3 — Admin portal integration (runtime, repository-only, no deployment)

**Files (planned):**
- `field-ops-app-vite/src/modules/administration/AdminUsers.jsx` — replace the inert placeholder's
  reset-relevant area with the real action: user selection from `listResetEligibleUsers` (sanitized),
  the "Send password reset" governed action, a **confirmation modal**, mode selection (routine /
  suspected-compromise with extra ack), and the truthful result surface driven by the UI-2 state
  machine. Nav/visibility unchanged; visibility ≠ authorization.
- An authorized **callable client** wrapper (e.g. `field-ops-app-vite/src/access/adminPasswordResetClient.js`)
  calling `initiateAdminPasswordReset` / `listResetEligibleUsers` via the Functions SDK — with the
  understanding the callables are **not deployed**, so integration tests run against the emulator/mock
  and the live UI shows configuration-/service-unavailable until AUTH-PROD.
- Tests: component tests for visibility/confirmation/cancel/in-flight/repeat/cooldown/loading/denied/
  unavailable/uncertain/accessibility/no-link-exposure/no-enumeration; emulator/mock integration for
  server-derived actor, strict schema, idempotency, audit applied/denied, no client mutation.

**No production deployment.** The action is functional against the emulator; against production it
renders unavailable because the callable is not deployed.

**Rollback:** revert to the inert `AdminUsers` placeholder (single-file revert + client wrapper +
tests).

---

## AUTH-PR-3.5 — backend delivery revision + missing guards (runtime, repository-only)

**Only if the Owner approves D-DELIVERY-NATIVE** (Firebase-native server send, no external provider).
**Blocked otherwise** — in which case admin reset ships UI-only and production reset stays blocked.

**Files (planned):**
- `functions/src/access/adminCredentialCommands.ts` / `adminCredentialCallables.ts` — a Firebase-native
  `ResetDelivery` implementation that calls the Auth REST `accounts:sendOobCode`
  (`requestType=PASSWORD_RESET`) server-side, inside an idempotent boundary (one idempotency key → one
  effective send); truthful **"accepted"-only** result (never "delivered"). If real-Firebase
  consumability (AUTH-PROD-1) fails, move link generation inside the send boundary.
- Add the **missing guards**: disabled-user, break-glass exclusion, missing-Employee-link,
  **final-active-admin** protection — enforced in the command (the UI cannot).
- Implement **D-ROUTINE-REVOKE**: make routine reset revocation-free if the Owner so decides.
- Register the **inactive** permission `admin.credentialReset.initiate` (no grant); wire the resolver
  seam so the #226 swap is 1:1.
- Tests: emulator coverage for every guard, native-send "accepted" semantics, idempotent replay, and
  fail-closed when the native path is unavailable.

**Non-authorizations:** no deployment; no provider; no permission activation; no role grant.

---

## AUTH-PROD-1 — real-Firebase behavior verification (separately authorized, bounded)

- Separately Owner-authorized, bounded, non-destructive (or tightly controlled) test against real
  Firebase Auth using an **approved test identity only**.
- Verify: `generatePasswordResetLink`/native-send behavior; **earlier-link consumability after a later
  generation**; native-send "accepted" semantics; duplicate-send behavior.
- Sanitized evidence only → `docs/audits/admin-password-reset-prod-1/` (no emails, UIDs, tokens,
  links, or raw records). No broad release.
- **Safe fallback if consumability fails:** move link generation inside the idempotent send boundary
  (recorded, not silently assumed).

---

## AUTH-PROD-2 — deployment preparation (docs; no execution)

- `docs/deployment/admin-password-reset-production-enablement.md` and
  `docs/operations/admin-password-reset-production-runbook.md`:
  exact commit; exact Functions exports to deploy (`initiateAdminPasswordReset`,
  `listResetEligibleUsers` — **only** these, never bundled with AUTH-PR-4 or Inventory/Equipment);
  permission-**activation** proposal; role-**grant** proposal; Firebase config; rollback; pre/post
  inventory; access-preservation checks (Owner/break-glass never lose access; never zero recoverable
  admins). **No execution without separate Owner authorization.**

---

## AUTH-PROD-3 — production deployment + verification (separately authorized)

- Separately authorized exact commit; deploy only the approved admin-reset scope. Verify: callable
  authorization; eligible and denied personas; audit events; **no role/claim/accessVersion mutation**;
  reset delivery to an approved test identity; rollback. Capture sanitized evidence
  (`docs/audits/admin-password-reset-prod-3/`).

---

## AUTH-PROD-4 — production completion record (docs)

- Repository evidence; append-only [`DECISIONS.md`](../DECISIONS.md) entry; session-state
  reconciliation. **No deployment on merge.**

---

## Continuous-execution boundary (this workstream)

Under [`DECISIONS.md`](../DECISIONS.md) #55, once AUTH-UI-1's architecture/scope/security/data-
authority/production-boundaries are Owner + ChatGPT approved, Claude may proceed continuously through
the **reversible repository** gates — AUTH-UI-2, AUTH-UI-3, and (if D-DELIVERY-NATIVE is approved)
AUTH-PR-3.5 — including in-scope corrections, rebases, marking ready, merging approved repository-only
PRs, deleting merged branches, and starting the next approved reversible phase. **Hard stops** remain:
any deployment (Functions/Rules/Hosting/index), any Firebase Auth/project mutation, any production
user/data/reset/revocation/email/recovery-email/session action, any role/claim/accessVersion/
employee-link mutation, source cutover, removing a recovery/compatibility fallback, or anything that
could leave zero recoverable admins. AUTH-PROD-1/3 additionally require their own explicit production
authorizations.

---

## Risks & blockers (see assessment §11)

- **BLOCKER:** production admin reset (#5) is blocked until D-DELIVERY-NATIVE is decided.
- **Guard gap:** merged command lacks disabled/break-glass/missing-link/final-active-admin guards →
  AUTH-PR-3.5, before any enablement.
- **Link consumability** unverified on real Firebase → AUTH-PROD-1.
- **Truthfulness:** never render "delivered" for an "accepted"-only native send.
- **Lane isolation:** AUTH-PR-4 is operationally active; keep this workstream repository-only and
  never combine releases.
