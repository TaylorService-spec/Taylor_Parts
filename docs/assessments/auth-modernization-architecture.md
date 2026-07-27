---
artifact_type: assessment
gate: Architecture Decision Package
status: Draft
date: 2026-07-26
owner: Claude Code
baseline: 3020213e4118c933d3d2e7a818af680fb8144e0b
related_decisions: [47, 48]
depends_on:
  - docs/assessments/blaze-governance-amendment.md
  - docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md
related_issues: [226]
implements: []
supersedes: []
superseded_by: []
related_pr: null
target_release: Authentication Modernization
---

# AUTH-PR-1 — Authentication Modernization: Architecture Decision Package

**Status: DRAFT — STOP for Owner + ChatGPT review. This is one coherent architecture
decision spanning several concerns. No implementation, no production mutation, no
deployment. Nothing here authorizes any Cloud Function deploy, Rules change, Firebase
configuration change, identity mutation, or App Check enforcement.**

## 0. Foundations (authoritative, per DECISIONS #47/#48)

- **Blaze is active**; the production Cloud Functions platform is established (11 Functions
  live, Gen 2 / Node 20, `us-central1`, deploy-and-verify pattern proven — DECISIONS #36).
- **Issue #15** (Epic 1 Work Order backend) is **complete and closed**. Do not reopen.
- **Issue #226** (Enterprise Access & Administration Platform) is the **OPEN** home for
  trusted access-mutation Functions, claims, `accessVersion`, enforcement cutover, Admin
  portal, and the trusted audit writer. Admin credential reset (§6) is an **extension of
  #226**, not a new platform.
- **AuthContext remains the single client-side auth-state authority** (`src/auth/
  AuthContext.jsx`); no second session/localStorage layer is introduced.
- **Firebase Auth UID is the stable identity key**; username is an application login
  **alias**, never a replacement for the UID; recovery/auth email stays distinct from
  username.
- **Credential administration is the single governed `ROLES.ADMIN` authority only**, resolved
  **server-side through the Issue #226 authorization resolver** — see §6.1 for the precise
  meaning of "admin" today vs. target. Dispatcher and operational roles never gain credential
  authority; `isAdminOrDispatcher()` must not gate credential operations.
- Spend governance is **proportionate** (DECISIONS #47/A4).
- **Baseline (reconciled 2026-07-27):** rebased on `origin/main` @
  `3020213e4118c933d3d2e7a818af680fb8144e0b`. The newer merged Inventory / Stage-B
  deployment-verification work (PRs #439/#440) is **preserved and unaffected** — it is
  deployment tooling and evidence, not authentication, and alters no conclusion here.

## 1. Current state (verified)

- `src/auth/Login.jsx`: email + password + Sign In only; `autoComplete="username"` on the
  email field; no recovery path.
- `src/auth/AuthContext.jsx`: `signInWithEmailAndPassword`; on auth state it reads
  `users/{uid}` (role, `employeeId`) and, when linked, `employees/{employeeId}`
  (`displayName`, `operationalRoles`) via `resolveEffectiveAccessCallable`/one-shot reads.
  Single source of auth truth.
- Existing enterprise-access Function family (undeployed): `grantRole`, `revokeRole`,
  `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`, `rejectAccessRequest`.
- Existing trusted audit writer: `functions/src/access/auditEventWriter.ts` —
  `recordStandaloneAuditEvent` / `stageAuditEvent` (platform's only audit-write path).
- `firestore.rules`: `users/{uid}` read is **self-only** today.

## 2. Username architecture and data model

**Principle:** Firebase Auth still authenticates by email/password. UID is never recreated.
Username is an application login alias, and the eventual login-time resolution is
`username → trusted resolver → auth email → sign-in`. **Note (Owner direction):** that
login-time resolution is **DEFERRED** (D-RESOLVER, §3/§4) and is **not built in AUTH-PR-2/3**.
This section defines the username **data model** only — display, normalization, uniqueness, and
a **recovery-ready** mapping — which may proceed without the deferred login resolver.

**Proposed collection `usernames/{normalizedUsername}`** (trusted-writer-only; clients never
write it):

| field | purpose |
|---|---|
| `normalizedUsername` (doc id) | lowercased, trimmed, validated key |
| `displayUsername` | as chosen/displayed |
| `uid` | Firebase Auth UID reference (the stable key) |
| `tenantId` | tenant/company scope placeholder (inert until Issue #140) |
| `active` | active/inactive state |
| `createdAt` / `createdBy` / `updatedAt` / `updatedBy` | provenance |
| `version` | optimistic-concurrency / audit correlation |
| `previousUsernames[]` (optional) | alias/history for safe non-reuse |
| `auditCorrelationId` | links to audit events |

**Not stored:** password, token, reset link, plaintext credential, unnecessary profile data.

**Uniqueness:** global for now, **tenant-ready** (fields present, behavior inert until Issue
#140). Do not implement tenant behavior here.

**Normalization (before activation):** trim; lowercase; allowed charset =
`[a-z0-9._-]`; min/max length (proposed 3–30); reject reserved words; reject unsupported
punctuation; enforce case-insensitive uniqueness; collision detection.

**Default username for NEW users:** normalized email prefix (e.g. `jane.smith@x.com` →
`jane.smith`) — a **suggestion**, not an identity guarantee; requires validation +
collision handling before activation.

**Collisions** (email prefixes are not unique): detect before activation; never silently
overwrite an existing mapping; never bind two UIDs to the same active normalized username;
require/propose an alternate (`jane.smith2`, `jane.smith.az`, …); record the final choice
in audit.

**Username change:** governed app operation (trusted-writer validated, uniqueness enforced,
UID preserved, roles/links preserved, append-only audit, alias history). **Email/username
change is out of scope for AUTH-PR-2/3** and is a separate identity operation.

## 3. Username/password authentication exchange (corrected — review blocker 1)

**Superseded design:** an earlier draft proposed a resolver that returns the account's
internal Firebase Auth email to the (unauthenticated) client so the client could call
`signInWithEmailAndPassword`. **Rejected.** Returning the email — or returning it only when
the account exists — makes both the internal email and **account existence** observable in
the network response, directly contradicting the non-enumeration requirement. **The client
must never receive the internal auth email, and the response must be identical whether or not
the username exists.**

Firebase Auth has no native username login and the client SDK's password sign-in needs the
actual email, so the exchange must move server-side. Two viable designs:

### Option A — server-side credential verification (two token exchanges, explicitly modeled)

1. Client sends `{ usernameOrEmail, password }` to a trusted callable
   (`authenticateWithUsername`) over TLS; App Check-eligible.
2. Function resolves username → `uid` → internal auth email **server-side only** (or uses the
   supplied email directly for the email-input path).
3. Function verifies the password **server-side** via the Identity Toolkit REST endpoint
   `accounts:signInWithPassword` (resolved email + supplied password). The Admin SDK has no
   password-verify API; this is the sanctioned server-side verification. Email and password
   never leave the backend.
4. **That verification call itself already returns an ID token + refresh token** (the *first*
   exchange). Because the Firebase JS client SDK cannot adopt an externally-obtained
   idToken/refreshToken into its managed auth state, the Function **mints a custom token**
   (`createCustomToken(localId)`) and returns **only** that; the client calls
   `signInWithCustomToken` to establish its session (the *second* exchange). This redundancy is
   intrinsic and is modeled below, not hidden.
5. On any failure (unknown username, wrong password, disabled, ineligible), Function returns a
   **single identical neutral error** with no field distinguishing the cause.

#### Two-exchange behavior (required modeling — review round 2)

- **Disposal & non-logging of the first tokens:** the `signInWithPassword` response
  (`idToken`, `refreshToken`) is held only in Function memory, used solely to confirm success
  and read the returned `localId` (UID); it is **never returned, logged, persisted, or
  transmitted**, and is discarded when the handler returns.
- **Session & revocation semantics:** the client's session is established **only** by the
  second exchange. The discarded first refresh token is never transmitted or stored, so it
  grants no usable session and lapses at natural expiry. Admin `revokeRefreshTokens(uid)`
  invalidates **all** refresh tokens issued before its timestamp — covering both — so
  revocation semantics are unaffected by the two exchanges.
- **Disabled-user handling:** `signInWithPassword` fails closed for disabled accounts
  (`USER_DISABLED`); additionally the Function checks `getUser(uid).disabled` server-side
  before minting a custom token. Disabled → neutral error, no token minted.
- **Exact UID preservation:** the custom token is minted with the `localId` returned by the
  verification call; `signInWithCustomToken` yields a session for that **exact** UID. No user
  is created, no UID changes, providers and the email/password credential are untouched.
- **Replay behavior (no "single-use" claim):** replay is bounded by TLS + App Check (once
  enforced) + per-username/IP rate limiting with backoff; the custom token is short-lived
  (~1 h to exchange) and scoped to the UID. The custom token is **not** asserted to be
  single-use (Firebase does not enforce that); capture requires breaking TLS.
- **Quotas, throttling & App Check:** each login consumes Identity Toolkit sign-in quota
  (per-project) plus the callable's own limiter; document quota headroom and thresholds; the
  callable is a prime App-Check target (metrics-only first, enforced later, §7).
- **Emulator / non-production proof before implementation approval:** D-RESOLVER is **not**
  approved until an Auth-emulator + non-production test demonstrates correct login, neutral
  failure for unknown user, disabled-user rejection, UID identity across both exchanges, and
  that no first-exchange token leaks into logs or responses.

- **Password verification:** server-side (Identity Toolkit REST); email never client-visible.
- **Logging:** never log password, email, or username in plaintext; log only a sanitized
  outcome (`success`/`failed`) + correlation id.
- **Timing / enumeration (narrowed claim):** this design does **not** claim perfectly
  normalized or indistinguishable timing. It requires: (a) **identical external responses**
  (same shape, same neutral error) for known/unknown usernames and wrong-password; (b) a
  **minimum response duration with bounded random jitter** to blunt gross timing differences;
  (c) **rate limiting**; and (d) **non-production distribution testing** comparing response-time
  distributions for known vs unknown usernames before implementation approval. Residual
  micro-timing signal is accepted and mitigated by rate limiting, not claimed to be zero.
- **Migration compatibility:** existing users unchanged (email/password credential + UID
  persist); only the sign-in entry point changes. The email-input fallback (Phase 1) may route
  through the same callable, or use the client SDK **with Firebase email-enumeration protection
  enabled** (below).

*Trade-off recorded:* the password transits our Function (TLS-only, memory-only, immediately
forwarded to Identity Toolkit, never persisted or logged), and the design inherently performs
two token exchanges (first discarded, second kept). Both are inherent to server-side password
verification with a client-managed session — accepted, documented costs, subject to the
emulator proof above.

### Option B — deterministic alias email

Make each account's Firebase Auth email a deterministic, non-secret function of the username
(e.g. `username@<internal-login-domain>`), keeping the real address separately as the
**recovery email**. The client derives the login email from the typed username locally and
calls `signInWithEmailAndPassword` directly — no login-time Function, nothing new disclosed
(the alias just restates the username). Enumeration resistance then depends entirely on
Firebase's **email-enumeration protection** collapsing `user-not-found`/`wrong-password` into
one `invalid-credential` error.

- **Cost:** requires migrating **every existing account's** Auth email to the alias and moving
  the real address to a recovery field — an Auth-email identity mutation for all users (Lane F /
  AUTH-PR-4 territory) — and it makes the Auth `email` claim synthetic (downstream `user.email`
  readers must be audited). It also forces custom reset-email delivery for everyone (§6.2),
  since Firebase's built-in reset email would target the alias domain.

### Recommendation & decision — DEFERRED (Owner direction)

Server-side password verification (Option A) inherently costs two token exchanges; the
genuinely clean single exchange (Option B, deterministic alias) becomes available only once the
Lane F auth-email migration runs. **Owner direction: adopt the documented fallback.**

- **D-RESOLVER is DEFERRED** (not approved). Username/password **login** is deferred until a
  separately approved authentication-provider design exists (most plausibly Option B alongside
  the Lane F migration, giving a real single exchange).
- **Phase-1 email/password login is retained** as the live authentication path.
- **The two-exchange resolver is NOT built or tested in AUTH-PR-2/3.** Options A and B above are
  retained as recorded design context for the eventual, separately-approved login design.
- Username **display, normalization, uniqueness, and recovery-ready data modeling** may proceed
  **only where they do not depend on username login** (the §2 mapping is data-model only; no
  login resolver is built).

**Baseline note (for the eventual login design and the email-input recovery path):** Firebase
**email-enumeration protection** is **approved in principle** as a separate production-config
gate **after compatibility testing**; **no configuration change is authorized now**. No public
Firestore query over `usernames` exists in any design.

## 4. Transitional login (phased — D-PHASES approved; username login DEFERRED)

- **Phase 1 (current, retained):** existing **email/password** login is the live authentication
  path (`Login.jsx` authentication unchanged). Per Owner direction (D-RESOLVER DEFERRED), the
  "Username or email" field and any username→login resolution are **deferred** — **not built in
  AUTH-PR-2/3**. Owner/dev access preserved.
- **Phase 2 (deferred, gated on D-RESOLVER):** username becomes a visible login path via the
  separately-approved authentication-provider design; email login remains a controlled fallback.
- **Phase 3 (deferred):** email login hidden from normal UX but **retained** as the underlying
  Firebase credential + recovery destination + break-glass path.

**Email login is never removed in this workstream's early phases.** Removal (Phase 3) is a
separate, later, Owner-gated step requiring production evidence that username login + recovery +
admin reset + break-glass all work.

## 5. Self-service recovery

- "Forgot password?" on `Login.jsx`. **In AUTH-PR-2 scope now — email-input only:** client SDK
  `sendPasswordResetEmail(email)` — Firebase sends; neutral when email-enumeration protection is
  on (D-ENUM-PROTECTION, approved in principle). **No Function, no resolver, not Blaze-dependent.**
- **Username-input recovery is DEFERRED** with username login (D-RESOLVER): it requires the same
  server-side username→email resolution, so it is **not built in AUTH-PR-2/3**. The `usernames`
  mapping (§2) is modeled **recovery-ready** so this path can be added later without a schema
  change.
- **Approved neutral copy:** "Check your email — if the account is eligible for password
  recovery, we'll send instructions to the registered email address." Never reveals whether the
  email exists.
- UX: placement near password/Sign-In; mobile + keyboard accessible; ~30–60s resend delay
  (UX only); no raw Firebase errors; no email/username in URLs, analytics, or logs; no reset
  links/tokens logged.
- **Email-enumeration protection** (Firebase Auth setting) and **reset-email template /
  authorized-domain / continue-URL**: documented here; **not mutated without a separate
  Owner gate** (production Firebase configuration = hard stop).
- AuthContext unchanged (reset is fire-and-forget email).

## 6. Administrative password reset (AUTH-PR-3 scope) — extends Issue #226

### 6.1 Authoritative admin authorization (review blocker 3)

"`ROLES.ADMIN`" here means the **single governed admin authority owned by Issue #226** — not a
new or parallel model:

- **Today** (ADR-005 §1): authorization is document-based — `users/{uid}.role` (the seeded
  compatibility roles `admin`/`dispatcher`/`technician`) plus linked
  `employees/{employeeId}.operationalRoles`/`employmentStatus`; there are **no** live token
  custom-claims or `accessVersion` yet. The admin authority is the compatibility role
  `users/{uid}.role == "admin"`.
- **Target** (ADR-005 §2.1, Hybrid Compatibility Model): `admin` persists as a seeded
  compatibility Role while a Permission/Scope model is introduced underneath, with compact
  claims (`platformAdmin`/`companyAdmin`/`accessVersion`). The admin authority becomes a
  governed Permission that the compatibility role maps to **1:1** — same authority, **no second
  model**.
- **Authoritative resolver (pinned):** every credential operation authorizes the actor
  **server-side through the #226 effective-access resolution** (Admin SDK reading the governed
  role/permission state) — never by trusting a client-supplied role/claim, never by duplicating
  an ad-hoc check. Until the #226 permission engine is live, that resolver's concrete check is
  `users/{uid}.role == "admin"` read server-side via the Admin SDK; when #226 activates
  claims/permissions, **only that resolver changes** and callers are unaffected.
- **Credential administration is its own governed capability** within #226 (explicit "may reset
  a credential", not implied by general admin visibility). **Dispatcher and operational roles
  are denied**; `isAdminOrDispatcher()` must never gate a credential operation; client button
  visibility is never authorization.

### 6.2 Preferred model, reset-email delivery, ordering, idempotency, failures (review blocker 2)

**Preferred model (Owner decision D-ADMIN-RESET):** secure reset-link + session revocation,
**no admin-visible temporary password**. `admin.auth().generatePasswordResetLink(email)`
**creates** a link but does **not** send an email, and the link/token is a credential that must
**never** be returned to, logged for, or displayed to the administrator.

**Two distinct workflows (review round 2)** — "queued" is not proof of delivery, and revoking
after a mere enqueue can lock a user out if the asynchronous send later fails. So routine reset
and suspected-compromise are separated, with explicit revocation ordering for each:

**Workflow R — routine reset (delivery-confirmed revocation, no lockout):**

1. Admin selects an eligible user; the **admin-only trusted callable** (new capability in the
   #226 access-Function family) authorizes the actor server-side per §6.1.
2. Function runs the **final-active-admin** and protected-account guards (§8), then writes an
   **initiation** audit event (before any side effect — see durable audit below).
3. Function **generates** the reset link server-side and sends it to the user's **recovery
   email** via the trusted transactional provider (below), obtaining a **delivery result**.
4. **Revocation is gated on confirmed delivery:** only after the provider **confirms
   acceptance/delivery** does the Function `revokeRefreshTokens(uid)`. If delivery is not
   confirmed, **no revocation occurs** (no lockout); a neutral failure is returned and an
   idempotent retry is offered.
5. Function writes a **delivery-outcome** audit event and a **revocation-outcome** audit event.
6. User sets their own new password via the emailed link. **Admin sees status only** — never
   the password, link, or token.

**Workflow C — suspected compromise (explicitly accepted immediate lockout, with recovery):**

- A separate, explicitly-labeled admin action **revokes sessions immediately**
  (`revokeRefreshTokens`) *before/independent of* reset delivery — the accepted lockout is the
  intent. **Recovery controls are mandatory:** final-active-admin protection still applies; the
  admin can re-issue a reset; break-glass remains available. Each step is separately audited.

This satisfies the required choice: routine = **delivery-confirmed revocation**; compromise =
**explicitly-accepted immediate-lockout with recovery** — as **separate workflows**, never
conflated.

- **Durable audit across partial failures (review round 3):** audit is **not** a single final
  event. The existing `auditEventWriter` (`recordStandaloneAuditEvent`/`stageAuditEvent`, no new
  system) records **separate append-only events** for: (1) **request initiation** (written
  before side effects), (2) **delivery outcome**, and (3) **revocation outcome**. An early
  failure is therefore always recorded even if later steps never run. Common fields:
  `eventType`, actor uid, target uid, `requestedAt`/`completedAt`, `outcome`,
  `deliveryOutcome`, `sessionRevocationOutcome`, sanitized failure category, correlation id,
  environment, function/version. **Never** stores password, temp password, reset link/token,
  ID/refresh token, raw headers, or full email body.
- **Trusted delivery mechanism (Owner decision D-EMAIL-DELIVERY):** a **direct transactional
  email provider** called from the Function is **preferred** — the Firebase "Trigger Email from
  Firestore" extension is **dispreferred** because it would persist the reset **link/token in a
  Firestore document**. Subject to Owner approval of cost, secret management, domain
  authentication (SPF/DKIM), retry, redaction, and **delivery-evidence** (used for the
  confirmed-delivery revocation gate above). Production-config, deployment-gated (hard stop).
  Self-service recovery (§5 email path) does not need this — `sendPasswordResetEmail` sends on
  its own.
- **Neutral admin-visible status:** only coarse status (`initiated` / `sending` / `delivered` /
  `failed`) — never the link, token, or full target email (masked). No provider error strings;
  no signal about email validity beyond a generic failure.
- **Idempotency:** each request carries an idempotency key (correlation id); a short-lived
  reset-request record dedupes retries (no second email, no double-revoke — same status
  returned). A per-target cooldown rate-limits repeated resets.
- **Failure handling:** link-generation failure → generic error, **no revocation**, initiation
  + failure audited. Delivery not confirmed → generic error, **no revocation**, delivery-outcome
  audited `failed`, idempotent retry allowed. No failure path reveals whether the account/email
  exists.

**Temporary-password variant:** only if the Owner explicitly reaffirms after this security
comparison (Owner decision D-TEMP-PW). If required, it needs its own security decision
(entropy, generation, display-once, no plaintext storage/logs, prohibited delivery channels,
expiry, forced-change enforcement beyond UI, refresh-token revocation, final-admin
restriction, incident response, and proof the user cannot bypass forced-change via direct
Firebase access). **AuthContext routing alone does not securely enforce must-change-password.**

**Must-change-password state:** Firebase has no native flag. Option 1 (preferred) = reset-link
+ session revocation, no flag needed as a security control. Option 2 (more complex) = a
`resetRequired` state enforced across Rules + callables + Storage + routing with a trusted
clearing mechanism. Recommend Option 1.

**Admin user directory:** do **not** broaden `users` reads for all admins. Use an admin-only
callable returning a paginated, **sanitized** result (display name, username, masked/
authorized email, enabled/disabled, linkage status, reset-required/sent status). Never
returns password info, tokens, claims dump, full user doc, or refresh/ID tokens.

**`setUserStatus`:** already exists (enable/disable). **Do not overload it** for password
reset — reuse shared authorization/audit/validation/deploy patterns but keep reset semantics
explicit.

## 7. App Check (assessment only — AUTH-PR-1 records it; enforcement is a hard stop)

App Check is **application/service protection**, not a login-form CAPTCHA. Assessment must
decide provider (reCAPTCHA Enterprise preferred for a new web integration; classic v3 only
if justified — Owner decision D-APPCHECK), register every web app, handle local-dev debug
provider (never commit debug tokens), CI, and preview. **Rollout starts with enforcement
OFF**, metrics-only, then per-product enforcement each as its own Owner-gated step after
verifying Owner + break-glass + localhost + emulator + preview access. **Do not bundle App
Check enforcement with the forgot-password client PR.**

## 8. Development-access preservation & break-glass (applies to every lane)

- **Two-admin rule:** at least two independent recoverable `ROLES.ADMIN` identities at all
  times — primary Owner admin + separate break-glass dev admin — not sharing email/password/
  recovery alias/recovery dependency. Break-glass excluded from routine destructive tests;
  login verified before every auth-related production deployment; details stored securely
  **outside Git**.
- **Final-active-admin protection:** the backend rejects any operation that would leave zero
  recoverable admins (reset/suspend/role-removal/disable/email-migration/session-revoke/
  delete/broken-link of the last admin). Message: "This action would remove the final active
  administrator and is not permitted."
- **Protected accounts:** admin reset must reject or specially-govern self-reset via the admin
  tool, primary Owner admin, break-glass admin, final active admin, accounts under migration,
  and accounts without a verified recovery route.
- **Break-glass recovery:** controlled Owner-operated Admin-SDK/Console procedure documented
  **outside sensitive repo content**, recovery-only, audited, UID-preserving, no ad-hoc data
  edits, with rollback.

## 9. Threat model (summary — full matrix in the spec)

Username enumeration; email enumeration; brute-force; reset-email flooding; credential
stuffing; username-collision takeover; stale/wrong-UID mapping; admin privilege abuse;
dispatcher/operational privilege leakage into credential ops; temp-password/reset-link
interception; session persistence after reset; final-admin lockout; break-glass compromise;
App Check misconfig / debug-token leakage; production test-user collision; Gmail-alias
misrouting; audit tampering; admin-reset replay / duplicate Function invocation; insecure
logging; accidental production identity mutation. Each maps to a control above (neutral
responses, trusted-writer-only mappings, ROLES.ADMIN-only + server authz, refresh-token
revocation, final-admin guard, append-only audit, App Check OFF-first, no secrets in Git).

## 10. Rules & Functions impact (documented; no change here)

- **Rules (future, each its own Tier-2 gate):** `usernames` mapping is trusted-writer-only
  (no client writes); admin directory via callable, not broadened `users` reads;
  reset-required state (if Option 2) write/clear path. No Rules change in AUTH-PR-1.
- **Functions (future, extend #226 lane):** `resolveUsername`, `createUsername`,
  `updateUsername`, `listResetEligibleUsers`, `initiateAdminPasswordReset`,
  `reconcilePasswordResetCompletion`, audit via existing writer. Each needs its own contract,
  authz + App Check policy, idempotency/replay protection, cost assessment, emulator tests,
  and a separate deployment gate. None deployed by AUTH-PR-1.

## 11. Implementation plan & PR boundaries

- **AUTH-PR-1 (this):** architecture decision package (docs only). STOP for review.
- **AUTH-PR-2 (scope adjusted — D-RESOLVER DEFERRED):** `usernames` mapping + username
  **display** + normalization/uniqueness/collision handling + **email-input** forgot-password
  flow + tests + emulator evidence. **Explicitly OUT:** username/password **login**, the
  two-exchange login resolver, the "Username or email" login field, and username-**input**
  recovery — all deferred with D-RESOLVER. Existing email login unchanged; no production cutover.
- **AUTH-PR-3:** `ROLES.ADMIN`-only reset Function + sanitized directory callable +
  delivery-confirmed session revocation (routine) / immediate-lockout+recovery (compromise) +
  final-admin/protected-account safeguards + reset-link model + existing audit-writer
  integration (durable initiation/delivery/revocation events) + tests + clean-checkout evidence;
  **does not depend on the deferred login resolver**; **no production deploy** until separately
  authorized; **no email provider selected/configured** (D-EMAIL-DELIVERY is an
  implementation-time Owner decision).
- **AUTH-PR-3:** `ROLES.ADMIN`-only reset Function + sanitized directory callable + session
  revocation + final-admin/protected-account safeguards + reset-link model + existing
  audit-writer integration + tests + clean-checkout evidence; **no production deploy** until
  separately authorized.
- **AUTH-PR-4:** test-user recovery-email migration (sanitized persona inventory, Gmail
  +alias readiness, operator procedure, rollback) — execution only after a separate
  production identity-mutation approval; one user at a time; primary admin last; break-glass
  untouched until lower-risk personas pass; real emails/UIDs/tokens never committed.

## 12. Production hard stops (unchanged from the handoff)

Explicit authorization required before: deploying/modifying any Function; Firebase Auth
config change; enabling email-enumeration protection in production; registering/enforcing App
Check; creating production username mappings; changing production Auth emails; sending
test-user production reset emails; revoking production sessions; modifying
roles/claims/operationalRoles/employee-links/accessVersion; provisioning a production
fixture; removing the email-login fallback; making username login the exclusive production
path; any action that could remove Owner or break-glass access.

## 13. Owner decision table

Status reflects the Owner recommendations returned with review blockers 1–4.

| ID | Decision | Recommendation / status |
|---|---|---|
| D-PHASES | Login transition 1→2→3 (email retained for recovery/break-glass) | **APPROVED** |
| D-DEFAULT-USERNAME | Email-prefix suggestion + collision handling; stable explicit names for test personas (e.g. `driver-admin`) | **APPROVED** |
| D-UNIQUENESS | Global uniqueness now; tenant-ready but inert | **APPROVED** |
| D-RESOLVER | Username/password **login** exchange (§3) | **DEFERRED** (Owner direction) — not approved, not built/tested in AUTH-PR-2/3; Phase-1 email login retained; revisit with a separately-approved auth-provider design (likely Option B + Lane F) |
| D-ADMIN-RESET | Reset-link + **delivery-confirmed** revocation (routine) vs immediate-lockout+recovery (compromise); no admin-visible temp password (§6.2) | **APPROVED pending** the two-workflow delivery/revocation + durable audit now specified (§6.2) |
| D-EMAIL-DELIVERY | Trusted admin reset-email sender — **direct transactional provider preferred** (avoid storing reset links in Firestore) (§6.2) | **OPEN — implementation-time Owner decision.** Provider involves cost/secrets/domain config; **do not select or configure now.** Approve at AUTH-PR-3 implementation with delivery-evidence for the confirmed-delivery revocation gate |
| D-TEMP-PW | Admin-visible temporary password | **REJECTED for current scope**; separate security decision if later requested |
| D-APPCHECK | Provider = reCAPTCHA Enterprise assessed first; enforcement OFF | **APPROVED** (assess-first, OFF) |
| D-EMAIL-CHANGE | Email/username change | **OUT of scope** for AUTH-PR-2/3 |
| D-CRED-ADMIN | Credential administration = single governed admin authority only (dispatcher denied) | **APPROVED** — semantics pinned (§6.1) |
| D-TWO-ADMIN | ≥2 independent recoverable admins + final-admin protection | **APPROVED** |
| D-ENUM-PROTECTION | Enable Firebase email-enumeration protection (baseline for §3/§5) | **APPROVED IN PRINCIPLE** — separate production-config gate after compatibility testing; no change authorized now |
