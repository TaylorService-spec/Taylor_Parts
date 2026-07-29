# Admin Password Reset — Current-State Assessment (AUTH-UI-1, Gate A)

- **Baseline `origin/main`:** `bc0fda57c9b35a967cef75b3df747a6fac91ec15` (2026-07-28; merge of PR #467).
- **Gate:** AUTH-UI-1 — repository-only reconciliation and design. **No runtime code in this gate.**
- **Workstream:** Customer / Authentication Modernization — remaining active items **#4 Admin reset UI** and **#5 Production admin password reset**.
- **Deferred by Owner (fixed inputs, this document does not reopen them):** username login, username-input password recovery, external email-provider selection/integration — see [`DECISIONS.md`](../DECISIONS.md) #54.
- **Continuous-execution authority for this workstream:** [`DECISIONS.md`](../DECISIONS.md) #55.

This assessment is deliberately grounded in the merged repository and Git history, not in chat
summaries. Every claim below is traceable to a file on `bc0fda5`.

---

## 1. AUTH-PR-3 backend — exact merged state

**Source (merged, PR #444 `e53c7b0`, unchanged on `bc0fda5`):**
- [`functions/src/access/adminCredentialCommands.ts`](../../functions/src/access/adminCredentialCommands.ts) — trusted command module.
- [`functions/src/access/adminCredentialCallables.ts`](../../functions/src/access/adminCredentialCallables.ts) — `onCall` adapters.
- Exported from [`functions/src/index.ts`](../../functions/src/index.ts) (`initiateAdminPasswordReset`, `listResetEligibleUsers`).
- AuditActions in [`functions/src/types/access.ts`](../../functions/src/types/access.ts): `initiateAdminPasswordReset`, `deliverAdminPasswordReset`, `revokeUserSessions`.
- Emulator/unit tests: `functions/test/adminCredentialCommands.test.mjs`, `functions/test/adminCredentialResetLinkValidity.test.mjs`.
- OOB-validity evidence: `docs/audits/auth-pr-3-oob-validity/evidence.md`.

**Callable/export status.** Both callables are **exported but not deployed** — `index.ts` states
the "export is not deployment" posture explicitly, and the 11 Functions deployed to `taylor-parts`
([`DECISIONS.md`](../DECISIONS.md) #35/#36, verified `docs/audits/functions-live-state/`) are the
report/effective-access + Work Order set; **neither admin-reset callable is among them.**

**Permission / authorization ID.** Authorization is the **single governed admin authority**:
server-side `users/{actorUid}.role === "admin"` read via the Admin SDK (`assertActorIsAdmin`),
encapsulated for a later Issue #226 resolver swap (arch §6.1). **There is no registered dotted
permission ID for credential reset yet** — the catalog contains sibling admin permissions
(`admin.userStatus.write`, `admin.roleAssignment.write`, `admin.accessRequest.decide`) but nothing
for credential/password reset. Dispatcher and operational roles do not qualify;
`isAdminOrDispatcher()` is never used to gate a credential operation. `actorUid` is derived from the
authenticated callable context only, never from client data.

**Eligibility logic (as merged).**
- `actorUid === targetUid` → **denied** (`ProtectedAccountError`, "use self-service"). Self-reset via the admin tool is refused.
- Delivery not configured → **denied** (`DeliveryUnavailableError`), **zero Auth side effects** in either mode.
- `getRecoverableEmail(targetUid)` returns null (no recoverable email) → **completed, not delivered** (target ineligible; neutral).
- Otherwise proceeds to the deliver/revoke stage machine.
- **Not yet enforced in the merged command:** disabled-user, missing-Employee-link, break-glass, and final-active-admin guards. `listResetEligibleUsers` surfaces `role`, `displayName`, `hasEmployeeLink` but the initiate path does **not** consult employee-link/disabled/break-glass status. **These guards are specified in AUTH-PR-1 §6/§8 but are not in the merged command** — a real gap the UI cannot compensate for and that AUTH-PROD must close (see Risks).

**Two workflows (as merged).**
- `routine`: **deliver first; revoke only after confirmed delivery** (no lockout if delivery unconfirmed).
- `suspectedCompromise`: **revoke first**, then deliver; a post-revoke delivery failure persists `recovery_required` (retryable, never silently completed).

**Audit events (each awaited before the next side effect).** `initiateAdminPasswordReset`
(applied/denied), `deliverAdminPasswordReset` (applied/denied), `revokeUserSessions`
(applied/denied). Written via the immutable `recordStandaloneAuditEvent`. **Never** stores the
link, token, target email, provider body, or a target-eligibility reason — those never leave the
audit-free neutral path.

**Reset-link generation behavior.** `adminSdkDeps()` wires
`generateResetLink = getAuth().generatePasswordResetLink(email)`. Per Firebase, this **creates a
link but sends nothing**. The link/token is a credential and is never returned or audited.

**Delivery abstraction (the crux).** The command depends on a `ResetDelivery` seam
(`isConfigured()` + `deliverResetLink({targetUid,email,link,idempotencyKey})`). The merged wiring is
`NOT_CONFIGURED_DELIVERY` — `isConfigured()` returns **false**, so the command **fails closed** with
zero Auth side effects. The seam's contract requires a real provider to (a) **deduplicate on
`idempotencyKey`** (delivery is internally at-least-once after a stale-worker takeover) and attest
that via `isConfigured() === true`, and (b) accept a **pre-generated link** to deliver.

**Idempotency / crash safety.** A caller `idempotencyKey` (8–200 chars `[A-Za-z0-9._:-]`) claims a
durable op record in `admin_credential_reset_ops` bound to `(actorUid,targetUid,mode)` with strict
schema validation; a resumable, attempt-bound (lease) stage machine records only successful stages;
stale workers are refused (`superseded`). In-progress (<5min) → `OperationInProgressError`; recent
failure (<30s) → `RetryCooldownError`; key reused for a different request → `OperationKeyConflictError`.

**Current default / fail-closed behavior.** As merged and (hypothetically) deployed with
`NOT_CONFIGURED_DELIVERY`, `initiateAdminPasswordReset` **denies at the delivery-capability check**
and performs **no** link generation, email, or session revocation. This is the safe default.

**Emulator tests vs. real-Firebase limitations.** `adminCredentialResetLinkValidity.test.mjs`
against the Auth emulator shows an earlier OOB code is **not removed from the outstanding list** by a
later `generatePasswordResetLink` for the same user (list persistence). The evidence doc is explicit
that **this is emulator behavior, not proof** that an earlier already-delivered link remains
**consumable** after a later generation on real Firebase Auth. That end-to-end consumability is an
open **production-enablement** verification (AUTH-PROD-1).

**Deployment status.** **Not deployed. Not enabled. No email provider configured.** Confirmed by
`index.ts`, `NOT_CONFIGURED_DELIVERY`, all three session-state files, and [`DECISIONS.md`](../DECISIONS.md)
#52 which explicitly does **not** authorize deploying AUTH-PR-3.

---

## 2. Self-service recovery — exact state

**Source (AUTH-PR-2, merged):** [`field-ops-app-vite/src/domain/passwordRecovery.js`](../../field-ops-app-vite/src/domain/passwordRecovery.js),
[`field-ops-app-vite/src/auth/Login.jsx`](../../field-ops-app-vite/src/auth/Login.jsx),
`field-ops-app-vite/test/passwordRecovery.test.mjs`.

- **Available in the Login UI:** a "Forgot password?" flow, **email input only** (no username, no
  username→email resolver — deliberately deferred, D-RESOLVER).
- **Mechanism:** the **Firebase client SDK** `sendPasswordResetEmail` via AuthContext `resetPassword`
  — Firebase-native delivery that **sends on its own**; there is **no Cloud Function** in this path.
- **Deployed?** This is client/Hosting code; wherever the current Hosting build is live, the flow is
  present. It is not gated on the (undeployed) Functions backend.
- **Enumeration controls:** always yields the identical `RECOVERY_NEUTRAL_MESSAGE`; success and any
  provider rejection are indistinguishable; no email is echoed. Client-side `looksLikeEmail` format
  check only (never an existence check).
- **Cooldown / in-flight controls:** a single recovery controller owns a synchronous in-flight lock
  + a 45s resend cooldown (`RESEND_COOLDOWN_SECONDS`); Firebase server-side throttling remains the
  authoritative control.

**Consequence for AUTH-PR-3.** Self-service already proves **Firebase-native reset email works from
the client SDK** in this project. But that mechanism is the *client* `sendPasswordResetEmail`, not an
admin-initiated server path — see §7.

---

## 3. Admin portal — exact state

**Source (Issue #226 Admin Portal foundation, merged):**
[`field-ops-app-vite/src/modules/administration/`](../../field-ops-app-vite/src/modules/administration/)
— `AdministrationOverview.jsx`, `AdminUsers.jsx`, `AdminRolesPermissions.jsx`,
`AdministrationUnavailable.jsx`; nav in
[`field-ops-app-vite/src/navigation/navConfig.js`](../../field-ops-app-vite/src/navigation/navConfig.js)
(`administration` domain: Employees, Users, Roles & Permissions, Permission Preview, Audit Logs);
routing in [`field-ops-app-vite/src/App.jsx`](../../field-ops-app-vite/src/App.jsx);
test `field-ops-app-vite/test/administrationPortalNav.test.mjs`.

- **User list / detail surfaces.** `AdminUsers` ("Users" tab) is a **gated-inert placeholder**
  (Issue #226 Row 12): it renders explanatory copy and **disabled** "Enable user" / "Disable user"
  buttons that map to the merged-but-undeployed `setUserStatus` trusted command. There is **no live
  user list, no user detail, no per-user action** wired to any callable today.
- **User status controls.** Present only as disabled preview buttons (above); not functional.
- **Role/permission preview.** `AdminRolesPermissions` exists; Permission Preview / Audit Logs render
  `AdministrationUnavailable` (deliberately unavailable until the #226 backend is deployed/verified).
  A separate presentation-only nav permission preview exists (`navPermissionPreview`,
  `resolveEffectivePermission`, `COMPATIBILITY_ROLES`) — not authorization.
- **Audit history surface.** Not present as a live surface (Audit Logs → unavailable placeholder).
- **Action / confirmation-modal patterns.** No confirmation-modal pattern exists in the
  administration module yet; the buttons are static disabled controls. A confirmation pattern must be
  introduced by AUTH-UI-3 (or reused from elsewhere in the app if a suitable governed one exists).
- **Permission resolution.** The portal renders under nav visibility (`PLACEHOLDER_DEFAULT_ROLES =
  ["admin","dispatcher"]` for placeholders); Rules remain the boundary. **Nav/button visibility is
  not authorization** — authorization is server-side only.
- **Protected-user / self-action rules in the UI.** None today (surfaces are inert).
- **Existing admin credential UI.** **None.** There is no password-reset surface anywhere in the app.

**Consequence.** AUTH-UI-3's reset action lands **inside `AdminUsers`** (the existing Users surface),
extending the Issue #226 portal — not a new user-management app. It needs its first real per-user
action, a confirmation modal, an authorized callable client, and neutral result states — all
currently absent.

---

## 4. Production / deployment infrastructure — exact state

- **Blaze active; 11 Functions live** ([`DECISIONS.md`](../DECISIONS.md) #35/#36/#47; audit
  `docs/audits/functions-live-state/`). **Admin-reset callables are not among the 11.**
- **AUTH-PR-3 callables:** not deployed, inert, `NOT_CONFIGURED_DELIVERY`.
- **Permissions:** no credential-reset permission is registered or active; no role grant exists for
  one.
- **Rules impact:** none required — the command is Admin-SDK (bypasses Rules); the reset op record
  (`admin_credential_reset_ops`) is server-only and must **not** be client-readable (Rules default
  deny already covers this; confirm no client read is added).
- **Firebase Auth configuration:** unchanged; no template/sender/enumeration-protection change is
  authorized.
- **Firebase-native password-reset email as an approved path?** Client `sendPasswordResetEmail` is
  already used by self-service (§2). Whether a **server-initiated** Firebase-native send is
  acceptable for admin reset is an **open Owner decision** (§7) — it is *not* currently wired and the
  merged delivery seam does not accept it as-is.
- **Can production be verified without an external provider?** Read-only checks (function inventory,
  callable auth rejection) — yes. A true end-to-end admin-reset delivery + earlier-link-consumability
  test — **only** if a no-provider delivery path is approved and implemented (§7); otherwise blocked.

---

## 5. Dependencies and conflicts

- **AUTH-PR-4 (recovery-email migration) — operationally active, separate lane.** It is iterating in
  the repo (PR #467 reverse-order rollback-continuation + workflow-identity transition, **repo +
  emulator only, DRAFT**; production authorization GRANTED but **not executed** — Gate A/Gate B
  unauthorized). **This workstream must not touch AUTH-PR-4 governed files, state keys, mappings,
  tokens, or operator state, and must not combine with it.** AUTH-PR-4 governed files:
  `functions/scripts/authPr4*.js`, `functions/authpr4/production-authorization.json`,
  `docs/deployment/auth-pr-4-*`, `docs/operations/auth-pr-4-operator-workflow.md`.
- **Issue #226 permission migration.** The credential-reset authority must reconcile with the #226
  resolver: today `users/{uid}.role == "admin"` server-side; at #226 activation it becomes a governed
  Permission the compatibility role maps to 1:1. A new **inactive** permission ID should be defined
  now (§ spec) so the resolver swap is 1:1 and callers are unaffected.
- **Admin portal work.** AUTH-UI-3 extends `AdminUsers`; coordinate so it does not collide with any
  other #226 Row work touching the administration module.
- **Functions deployment gates.** AUTH-PROD-2/3 share the deployment machinery but must deploy
  **only** the admin-reset scope — never bundled with AUTH-PR-4 or Inventory/Equipment.
- **Audit architecture.** Reuse `auditEventWriter` (no new audit system).
- **Session-revocation behavior.** Not automatic on reset. Routine = no forced revocation unless
  delivery-confirmed (as merged); suspected-compromise = explicit immediate revoke. See §6.
- **Protected / break-glass identities.** Break-glass must be excluded from admin reset; final-active-
  admin protection must hold. **Neither guard is in the merged command** (gap; see Risks).

---

## 6. Session revocation classification (as merged, reconciled to handoff §11)

- **Routine (`routine`):** delivery-confirmed revocation only. If delivery is not confirmed, **no
  revocation** (no lockout). Handoff §11's "routine → likely no forced revocation" is **stricter**
  than the merged behavior (which does revoke after confirmed delivery). **Open question for Owner:**
  should routine admin reset revoke sessions at all? If not, AUTH-PROD must make routine
  revocation-free (a behavior decision, not a UI decision).
- **Suspected compromise (`suspectedCompromise`):** explicit immediate `revokeRefreshTokens` before
  delivery; accepted lockout; recovery mandatory. Matches handoff §11.
- Revocation is idempotent (a repeat is a safe no-op).

---

## 7. Delivery posture without an external provider (central blocker)

**The conflict.** AUTH-PR-1 §6.2 (D-EMAIL-DELIVERY) designed AUTH-PR-3 delivery around a **direct
transactional email provider** called from the Function. The Owner has now **indefinitely deferred**
external email-provider integration ([`DECISIONS.md`](../DECISIONS.md) #54). The merged backend is
therefore **fail-closed with no delivery path**.

**Firebase mechanics (the reason this is not trivial).**
- Admin SDK `generatePasswordResetLink(email)` **generates a link but sends nothing** — it needs an
  external send path to deliver.
- Firebase's **automatic** reset email is sent by the **client SDK** `sendPasswordResetEmail`
  (used by self-service today) or by the Auth REST endpoint `accounts:sendOobCode`
  (`requestType=PASSWORD_RESET`) with the project Web API key. These use Firebase's built-in
  templates/sender — **no external provider** — but they **generate-and-send in one call** and return
  only **"accepted by Firebase," never "delivered."**
- The **merged `ResetDelivery` seam does not fit** a Firebase-native send: it expects a
  **pre-generated `link`** to deliver and a **provider-side idempotency-dedup attestation**. A
  Firebase-native `sendOobCode`/client-send path provides neither. **Wiring Firebase-native delivery
  is therefore a backend change, not just UI.**

**Explicit answers to handoff §7.**
- *Does AUTH-PR-3 generate a link / call a provider / call Firebase-native delivery?* It **generates**
  a link (Admin SDK) and hands it to a provider seam that is currently unconfigured; it does **not**
  call Firebase-native delivery.
- *Can Firebase-native delivery satisfy audit + idempotency?* Audit — yes (unchanged). Idempotency —
  **only partially**: Firebase-native send offers no dedup attestation, so exactly-once user-visible
  delivery cannot be guaranteed the way the merged contract requires; the durable op record dedupes
  **retries**, but not an internal at-least-once double-send. Acceptable only if the Owner accepts
  best-effort native send semantics.
- *Does admin-initiated delivery require a callable/trusted Function?* Yes — to keep authorization,
  eligibility, and audit server-side. A Function can call the Auth REST `sendOobCode` server-side
  (native, no provider).
- *Can native templates/sender meet the need without provider work?* Functionally yes for "send a
  reset email"; it uses the project's default template/sender (same as self-service).
- *What delivery outcome can be truthfully observed?* Only **"accepted/enqueued by Firebase"** —
  **never "delivered."** The UI must not claim delivery.
- *What failure info is safe to audit?* Coarse category only (accepted / not-accepted / service-
  unavailable) — never provider bodies, links, tokens, or the target email.
- *Does a later reset-link generation invalidate an earlier link?* **Unverified against real
  Firebase.** Emulator shows list persistence only. Open (AUTH-PROD-1).
- *Has earlier-link consumability been verified on real Firebase?* **No.** Emulator list persistence
  is not proof.
- *Safe fallback if consumability verification fails?* Move link generation **inside** the idempotent
  send boundary (one key → one effective link + send), or accept that only the latest link is
  consumable and design the flow around a single send per request.

**Verdict for Gate A.** Two viable no-external-provider directions exist, both requiring a **backend
revision** (a new gate, call it **AUTH-PR-3.5**) before any production admin reset:
1. **Firebase-native server send** (Function → Auth REST `sendOobCode`): native, no provider, but
   "accepted"-only semantics and no dedup attestation. Requires relaxing the confirmed-delivery
   revocation gate for routine reset (reconciles with handoff §11 favoring no routine revocation).
2. **Keep the provider seam but never wire a provider:** admin reset stays fail-closed / unavailable
   in production; only the UI's "service unavailable / configuration unavailable" states ship. This
   honors the deferral literally and delivers the **UI** without delivering **production reset**.

**If neither is Owner-approved, production admin password reset (#5) is BLOCKED by the deferred
delivery decision** — and this document reports it as blocked rather than quietly introducing a
provider. The **Admin reset UI (#4) is not blocked** — it can ship truthfully with an
unavailable/uncertain outcome surface.

---

## 8. Effect of indefinitely deferring roadmap items 1–3

- **Username login (1) & username-input recovery (2):** already deferred in AUTH-PR-1 (D-RESOLVER,
  D-PHASES). No new code assumes them; email/password login and email-input self-service recovery
  remain the supported mechanisms. No change required beyond recording #54.
- **External email provider (3):** removes the delivery path AUTH-PR-1 §6.2 assumed. This is the sole
  substantive effect — it converts "production admin reset" from "wire the provider + deploy" into
  "decide a no-provider delivery posture (§7) **or** ship the UI without production delivery." The
  `D-EMAIL-DELIVERY` provider design in AUTH-PR-1 §6.2 is now **superseded by #54** and must not be
  implemented.

---

## 9. Recommended architecture (summary; detail in the spec + plan)

1. **AUTH-UI-2/3 (ship the UI, honestly):** build the Admin reset action inside `AdminUsers` with a
   pure view-model + action-state machine and neutral, truthful result states — including
   **"service/configuration unavailable"** and **"uncertain"** — wired to the existing (undeployed)
   callable via an authorized client. This ships regardless of the delivery decision.
2. **Register an inactive permission** `admin.credentialReset.initiate` (dotted convention, mirror
   parity, **no role grant**) to make the #226 resolver swap 1:1.
3. **AUTH-PR-3.5 (only if a no-provider delivery is Owner-approved):** revise the backend to a
   Firebase-native server send (`sendOobCode`) inside an idempotent boundary; add the missing
   **disabled / break-glass / missing-Employee-link / final-active-admin** guards; make routine
   reset revocation-free per the Owner's §6 decision.
4. **AUTH-PROD-1..4 (separately authorized):** real-Firebase link-consumability + native-send
   verification with a test identity, then deployment prep, deployment, and a completion record.

---

## 10. Owner decisions — RESOLVED ([`DECISIONS.md`](../DECISIONS.md) #56)

All four are now **decided** by the Owner + ChatGPT approval of AUTH-UI-1 (DECISIONS #56):

- **D-DELIVERY-NATIVE — APPROVED.** Firebase-native server-side send (no external provider);
  Firebase response treated **only as `REQUEST_ACCEPTED`** (never delivered/opened/consumed); no
  link/action-code/email/response-body/internal-error exposure. Production stays blocked until
  AUTH-PR-3.5 is tested and separately authorized; real-Firebase link consumability remains
  AUTH-PROD-1. If the native path can't meet the security/audit contract, **stop and report — do not
  add a provider.**
- **D-ROUTINE-REVOKE — NO.** Routine admin reset **must not** revoke sessions/refresh tokens.
  Revocation is a **separate** suspected-compromise workflow (explicit operator choice, own governed
  permission/action, separate confirmation/audit/authorization). The merged command's routine
  post-delivery revocation is therefore **removed** in AUTH-PR-3.5.
- **D-RESET-PERMISSION — APPROVED.** `admin.credentialReset.initiate`, registered **inactive**, no
  grant, server-side resolution only. Intended future eligible: Owner, governed admin. Denied:
  dispatcher, parts manager, warehouse manager, technician, sales manager, unauthenticated, inactive
  user, self-target, break-glass, protected final recoverable admin, disabled target, missing
  Employee linkage, missing Auth linkage. Activation/grant needs a later production/security gate.
- **Guard gap — CONFIRMED.** disabled / break-glass / missing-or-non-reciprocal Employee↔Auth
  linkage / final-active-recoverable-admin guards must be added and tested in AUTH-PR-3.5 before any
  enablement. The UI is not a security boundary.

---

## 11. Blockers and risks

- **BLOCKER (production #5) — delivery posture now DECIDED (D-DELIVERY-NATIVE, #56):** the path is a
  Firebase-native server send with `REQUEST_ACCEPTED`-only semantics. Production remains blocked
  until AUTH-PR-3.5 implements it (with the guards) and AUTH-PROD-1/2/3 are separately authorized —
  but the delivery *decision* is no longer open.
- **Risk — guard gap:** the merged command lacks disabled/break-glass/missing-link/final-active-admin
  guards; production enablement without them could lock out or wrongly target protected identities.
  The **UI cannot compensate**; this must be closed in AUTH-PR-3.5, not AUTH-UI-3.
- **Risk — link consumability unverified on real Firebase** (AUTH-PROD-1).
- **Risk — "accepted ≠ delivered":** any UI/audit that says "delivered" for a native send would be
  untruthful. The action-state machine must distinguish accepted / delivered(only-if-known) /
  uncertain.
- **Risk — lane collision:** AUTH-PR-4 is active; keep this workstream repository-only and isolated.

---

## 12. Exact recommended next gate

**AUTH-UI-2** (pure UI/domain state: view-model, eligibility/display mapping, action-state machine,
sanitized result mapping, duplicate-submit protection, unit tests — **no callable wiring, no
deployment**) — **now authorized** to proceed under the continuous-execution authority
([`DECISIONS.md`](../DECISIONS.md) #55), Gate A having been Owner/ChatGPT-approved (#56). Then
**AUTH-UI-3** (AdminUsers integration), then **AUTH-PR-3.5** (backend correction, repository/emulator
only). The production gates (AUTH-PROD-1..4) remain hard-stopped and require separate production
authorizations; the delivery decision itself is resolved (D-DELIVERY-NATIVE, §10).
