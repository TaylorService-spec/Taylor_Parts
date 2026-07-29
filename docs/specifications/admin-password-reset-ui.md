# Admin Password Reset UI — Specification (AUTH-UI, Customer/Auth lane)

- **Baseline `origin/main`:** `bc0fda57c9b35a967cef75b3df747a6fac91ec15`.
- **Companion docs:** current-state [`assessments/admin-password-reset-current-state.md`](../assessments/admin-password-reset-current-state.md);
  plan [`implementation-plans/admin-password-reset-ui.md`](../implementation-plans/admin-password-reset-ui.md).
- **Governing architecture:** AUTH-PR-1 [`assessments/auth-modernization-architecture.md`](../assessments/auth-modernization-architecture.md) §6/§8; ADR-005.
- **Owner fixed inputs:** deferral [`DECISIONS.md`](../DECISIONS.md) #54; continuous-execution authority #55; **AUTH-UI-1 decisions APPROVED #56** (D-DELIVERY-NATIVE, D-ROUTINE-REVOKE=NO, D-RESET-PERMISSION inactive, guard gap confirmed).
- **Status:** APPROVED (#56) — design accepted; realized by AUTH-UI-2/3 (repository/emulator only). Nothing here authorizes deployment, permission activation, or a role grant.

The UI lives **inside the existing Issue #226 Admin portal** (`AdminUsers`) and must not become a
competing user-management app.

---

## 1. Scope

- **In scope:** the Admin-portal surface that lets an authorized admin **initiate a password reset**
  for an eligible *other* user, review eligibility/security impact, confirm, invoke the trusted
  backend, and see a **truthful, sanitized** outcome plus a path to the audit trail.
- **Out of scope (deferred, #54):** username login, username-input recovery, external email provider.
- **Out of scope (separate gates):** the backend delivery revision (AUTH-PR-3.5), any deployment,
  and any production execution (AUTH-PROD-1..4). This spec covers **UI + pure domain state**; where
  it depends on a backend decision, it renders the honest "unavailable/uncertain" branch.

---

## 2. User workflow

```
Admin portal ▸ Users
  → select an eligible user (from the sanitized listResetEligibleUsers result)
  → open the governed credential action ("Send password reset")
  → review: governed identity (safe fields) + eligibility + security impact + mode
  → choose mode: Routine  |  Suspected compromise (explicit, separately labeled)
  → (optional) capture a bounded reason code if the backend contract supports it
  → confirm (confirmation step; duplicate-submit locked)
  → invoke initiateAdminPasswordReset (authorized callable; server-derived actor)
  → display sanitized outcome (accepted / unavailable / denied / ineligible / uncertain …)
  → show audit history (or a direct link to the relevant audit events)
```

The admin **never** sees the reset link, token, action code, target's full email, provider body, or
any generated credential.

---

## 3. Identity & display (safe governed fields only)

The selected user is shown using **only** the sanitized fields the backend already returns from
`listResetEligibleUsers`: `uid` (opaque), `displayName`, `role`, `hasEmployeeLink`. Email, if shown
at all, is **masked** and only when the backend authorizes it. No full user document, no claims dump,
no tokens.

---

## 4. Permission & authorization model

- **Server-side only.** Authorization is resolved by the backend (`assertActorIsAdmin` today →
  Issue #226 effective-access resolver later). The UI **never** authorizes on a raw client role
  string; nav/button visibility is **not** authorization.
- **New permission (APPROVED #56, register INACTIVE):** `admin.credentialReset.initiate` — dotted-domain
  convention matching `admin.userStatus.write` / `admin.roleAssignment.write`. Mirror parity where the
  catalog requires it. **No role grant, no activation** until a separate production/security gate
  (D-RESET-PERMISSION).
- **Eligible actors (once granted):** Owner, admin. **Denied:** dispatcher, parts manager, warehouse
  manager, technician, sales manager. **Self-reset denied** (use self-service).
- Until the permission engine is live, the resolver's concrete check remains
  `users/{actorUid}.role == "admin"` server-side; the swap to the permission is 1:1 and leaves the UI
  unchanged.

---

## 5. Eligibility matrix (target)

| Target condition | Backend result (as merged / as required) | UI outcome shown |
|---|---|---|
| Authorized admin acting on another eligible user | proceeds | Accepted (per delivery posture §7) |
| **Self** (`actor === target`) | denied (`ProtectedAccountError`) | "You can't reset your own password here — use self-service recovery." |
| Delivery not configured | denied (`DeliveryUnavailableError`), zero side effects | **"Service/configuration unavailable"** |
| Target has **no recoverable email** | completed, not delivered (ineligible) | "Target not eligible for reset." (neutral) |
| **Disabled** user | *required guard — not in merged command* (AUTH-PR-3.5) | "Target not eligible." (must not silently enable) |
| **Break-glass** identity | *required exclusion — not in merged command* (AUTH-PR-3.5) | "Target not eligible." |
| **Missing Employee link** | *required guard — not in merged command* (AUTH-PR-3.5) | "Target not eligible." |
| Would leave **zero active admins** | *final-active-admin guard — not in merged command* (AUTH-PR-3.5) | denied, "Protected: cannot reset the last active admin." |
| Unauthorized actor | denied (`UnauthorizedActorError`) | Generic "not authorized" (no target signal) |

The UI presents **neutral** outcomes and **never** reveals whether an arbitrary email/account exists.
The italic guards are backend gaps documented in the assessment §11 — the UI renders the intended
neutral outcome but cannot enforce them; enforcement is AUTH-PR-3.5.

---

## 6. UI hard constraints (from handoff §6)

Do **not**: display generated reset links or Firebase action codes; expose provider secrets or
internal error bodies; permit direct Firebase Auth mutation from the client; create temporary
passwords; update the user's email; change UID / employee linkage / roles / claims / operationalRoles
/ `accessVersion`; silently enable disabled users; initiate for ineligible/unlinked/missing/protected/
break-glass identities; or claim delivery the backend hasn't confirmed.

Do: require an authenticated, authorized administrator; resolve authorization server-side; require a
confirmation step; prevent duplicate concurrent submissions and accidental repeated sends; preserve
accessibility (focus management, keyboard, ARIA), loading, retry, and error states; show audit history
or a direct path to it.

---

## 7. Action-state machine & result states (truthful)

The UI's pure state machine (AUTH-UI-2) maps backend outcomes to **exactly** these user-visible
states — never conflating them:

- `idle` → `confirming` → `submitting` → one terminal state:
  - **request-accepted** — backend accepted the request (op claimed). Neutral.
  - **delivery-initiated** — a send was attempted (native "accepted by Firebase").
  - **delivery-confirmed** — shown **only if truly known** (a provider/mechanism that attests
    delivery). With Firebase-native send this state is **not reachable** and must not be shown.
  - **denied** — actor not authorized / self-reset / protected. Generic.
  - **target-ineligible** — no recoverable email / disabled / unlinked / break-glass. Neutral.
  - **service-unavailable** — delivery capability not configured / transient backend `unavailable`.
  - **configuration-unavailable** — distinct from transient: the delivery path is not set up
    (current production reality under #54).
  - **uncertain** — backend returned an ambiguous/`recovery_required`/timeout outcome; instruct the
    admin to check audit history and retry with the **same** idempotency key.

**"link generated" is never rendered as "email delivered."** Copy is reviewed against this rule.

Duplicate-submit protection: a synchronous in-flight lock (mirroring the self-service recovery
controller) plus a short post-submit cooldown; the idempotency key is generated once per confirmed
intent and reused on retry so a repeat is an idempotent replay, not a second reset.

---

## 8. Mode selection

- **Routine** (default): send a native reset request; **no session/refresh-token revocation**
  (D-ROUTINE-REVOKE = **NO**, #56). Copy: "sends a password-reset email request; the user keeps their
  session." The reachable success state is **request-accepted**, never "delivered".
- **Suspected compromise**: a **separate governed action** (its own permission/action, confirmation,
  audit, and — for production — its own authorization), not a mere toggle on routine reset. Copy
  states sessions are **revoked** (accepted lockout) and a reset request is sent; recovery remains
  available; requires an extra confirmation acknowledging the lockout. *Its production revocation
  path is out of scope for AUTH-UI-2/3 and AUTH-PR-3.5's routine path.*

Session revocation is **never** bundled into routine reset (D-ROUTINE-REVOKE = NO, #56).

---

## 9. Audit linkage

The action reuses the immutable `auditEventWriter` events the backend already emits
(`initiateAdminPasswordReset`, `deliverAdminPasswordReset`, `revokeUserSessions`). The UI shows the
relevant audit history for the target (via the Admin portal's Audit surface once its backend is
deployed/verified) or a direct link/reference to those events. The UI **never** displays sanitized-out
fields (link, token, email, provider body).

---

## 10. Delivery posture in the UI (reconciled to #54)

Because external providers are deferred (#54), the shipped UI must render the **truthful** production
reality:
- If the backend delivery capability is **not configured** (current state), the primary outcome is
  **configuration-unavailable** — the admin is told the reset service is not available and to use an
  approved alternative (e.g., directing the user to self-service recovery).
- **D-DELIVERY-NATIVE is APPROVED (#56):** AUTH-PR-3.5 wires a Firebase-native server send, so the
  reachable success state is **request-accepted** (`REQUEST_ACCEPTED`), **never** delivery-confirmed.
  Until AUTH-PR-3.5 is deployed (a separate production gate), the live UI still renders
  configuration-/service-unavailable.

The UI ships and is truthful in **both** worlds; it does not assume delivery exists.

---

## 11. Test plan (specification-level; realized in AUTH-UI-2/3)

**Authorization (backend integration / emulator):** authorized admin; unauthorized role;
unauthenticated; inactive permission; protected user; break-glass user; disabled user; missing Auth
link; missing Employee link; self-target; Owner target.

**UI (unit / component):** action visibility vs. authorization (visibility ≠ authorization);
confirmation required; cancel; in-flight lock; repeated click; cooldown/idempotent replay; loading;
denied; unavailable; configuration-unavailable; uncertain; accessible focus + keyboard; **no
reset-link/token/action-code exposure**; **no account-enumeration leakage**; mode selection incl.
suspected-compromise extra confirmation.

**Backend integration (emulator/mock, AUTH-UI-3):** server-derived actor; strict request schema;
unknown-field rejection; target eligibility; idempotency (same key → replay, no second effect); audit
applied/denied; safe generic errors; **no direct client mutation**; **no UID/email/role/claim/
accessVersion change**; **no temp password**; **no user-enable side effect**.

**Delivery (AUTH-PR-3.5 / AUTH-PROD, not this UI gate):** Firebase-native behavior; earlier-link
consumability after later generation (real Firebase); duplicate-send behavior; failure handling;
truthful "accepted"-only status; template/config failure; production-safe test identity only.

**Regression:** login; self-service recovery; AuthContext; Admin Users/Overview/Roles nav
(`administrationPortalNav.test.mjs`); permission preview; Customer pages; Inventory/Equipment
isolation; Functions build; Rules; emulator suites; CI path coverage.

---

## 12. Non-authorizations (explicit)

This spec does **not** authorize: deploying AUTH-PR-3; wiring any email provider; activating a
permission; granting a role; any Firebase Auth/project change; any production reset/revocation/email;
touching AUTH-PR-4 governed state; or a combined Customer+Inventory release. Those remain hard stops
per [`DECISIONS.md`](../DECISIONS.md) #52/#54/#55 and the handoff hard boundaries.
