---
artifact_type: assessment
gate: Architecture Decision Package
status: Draft
date: 2026-07-26
owner: Claude Code
baseline: 48524ac98766b5c8d99153d3b10cfd5a39931a71
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
- **Credential administration is `ROLES.ADMIN` only.** Dispatcher and operational roles
  never gain credential authority. `isAdminOrDispatcher()` is too broad and must not gate
  credential operations.
- Spend governance is **proportionate** (DECISIONS #47/A4).

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

**Principle:** Firebase Auth still authenticates by email/password. Username is resolved to
an internal auth email server-side, then normal `signInWithEmailAndPassword` runs. UID is
never recreated.

Resolution path: `username → trusted resolver → auth email → signInWithEmailAndPassword`.

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

## 3. Resolver architecture — decision required

Two options for `username → auth email`:

- **Option A (recommended): trusted callable resolver** (`resolveUsername`) — client sends
  username, Function returns only what login needs, neutral on non-existence, rate-limited,
  App Check-eligible. No public enumeration surface. Reuses the established Functions
  platform (not greenfield).
- **Option B: custom-token auth** — resolver mints a custom token; client
  `signInWithCustomToken`. More moving parts, larger blast radius, harder to reason about.
  **Not recommended** unless a concrete requirement forces it; documented so the choice is
  explicit.

**Owner decision D-RESOLVER:** confirm Option A.

**Enumeration protection:** the resolver must return neutral responses (never reveal whether
a username exists), never return raw internal email to the visible UI, never log
username/email in plaintext where avoidable, and rely on server-side throttling as the
authoritative control (client delay is UX only). No public Firestore query over `usernames`.

## 4. Transitional login (phased — Owner decision D-PHASES)

- **Phase 1 (additive):** field labeled **"Username or email"** + password. If input is a
  valid email form → existing email login path (unchanged). Else → trusted username
  resolution. Existing email/password login and Owner/dev access preserved.
- **Phase 2:** username becomes the normal visible path; email login remains a controlled
  fallback; forgot-password accepts username and (transitionally) email.
- **Phase 3:** email login hidden from normal UX but **retained** as the underlying Firebase
  credential + recovery destination + break-glass path.

**Do not remove email login in the first implementation.** Removal (Phase 3) is a separate,
later, Owner-gated step requiring production evidence that username login + recovery + admin
reset + break-glass all work.

## 5. Self-service recovery (AUTH-PR-2 scope)

- "Forgot password?" on `Login.jsx`; accepts username (and transitionally email); resolves
  to auth email via the trusted resolver; calls `sendPasswordResetEmail` (client SDK — no
  Function required unless resolution/policy needs one; **not Blaze-dependent**).
- **Approved neutral copy:** "Check your email — if the account is eligible for password
  recovery, we'll send instructions to the registered email address." Never reveals whether
  username/email exists.
- UX: placement near password/Sign-In; mobile + keyboard accessible; ~30–60s resend delay
  (UX only); no raw Firebase errors; no email/username in URLs, analytics, or logs; no reset
  links/tokens logged.
- **Email-enumeration protection** (Firebase Auth setting) and **reset-email template /
  authorized-domain / continue-URL**: documented here; **not mutated without a separate
  Owner gate** (production Firebase configuration = hard stop).
- AuthContext unchanged (reset is fire-and-forget email).

## 6. Administrative password reset (AUTH-PR-3 scope) — extends Issue #226

**Preferred model (Owner decision D-ADMIN-RESET, recommended):** secure reset-link + session
revocation, **no admin-visible temporary password**:

1. Admin (`ROLES.ADMIN` only) selects an eligible user in the app.
2. An **admin-only trusted callable** (new capability in the #226 access-Function family)
   authorizes the actor server-side (client button visibility is not authorization).
3. Function validates target eligibility and the **final-active-admin safeguard** (§8).
4. Function **revokes the target's refresh tokens** and initiates a secure Firebase
   password-reset link/email; records reset-required state if needed.
5. Function writes an append-only audit event via the **existing** `auditEventWriter`
   (`recordStandaloneAuditEvent`/`stageAuditEvent`) — no new audit system.
6. User sets their own new password via the link; completion reconciled by a trusted path.
7. Admin sees **status only** — never the password or token.

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
- **AUTH-PR-2:** username mapping + trusted resolver + username-or-email login UI +
  forgot-password flow + tests + emulator evidence; email fallback retained; **no production
  cutover**; App Check only if enforcement OFF and pre-approved in this architecture.
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

## 13. Owner decisions to confirm (before AUTH-PR-2/3 build)

- **D-PHASES:** confirm the 1→2→3 login transition (email retained for recovery/break-glass).
- **D-DEFAULT-USERNAME:** normalized email prefix for new users; existing test personas get
  stable recognizable usernames (e.g. `driver-admin`), not blindly the Gmail-alias prefix.
- **D-UNIQUENESS:** global now, tenant-ready.
- **D-RESOLVER:** trusted callable resolver (Option A), not custom-token.
- **D-ADMIN-RESET:** reset-link + session revocation, no admin-visible temp password.
- **D-TEMP-PW:** if a temp password is still required, a separate security decision is needed
  first.
- **D-APPCHECK:** provider choice; enforcement starts OFF.
- **D-EMAIL-CHANGE:** email/username change stays out of scope for AUTH-PR-2/3.
- **D-CRED-ADMIN:** credential administration is `ROLES.ADMIN` only (dispatcher denied).
- **D-TWO-ADMIN:** ≥2 recoverable admins maintained throughout; break-glass untouched until
  lower-risk personas verified.
