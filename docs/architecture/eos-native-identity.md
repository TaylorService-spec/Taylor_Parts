# EOS Native Identity — the human front door

Status: **LOCAL / DRAFT PR, NOT MERGED, NOT DEPLOYED, ALL FLAGS OFF.**

**Owner rulings 2026-10-11:**
- **D-1:** nonproduction only.
- **D-2:** EOS owns identity and session. Preserve future OIDC/SSO, prefer established libraries and protocols, and an independent security review is mandatory.
- **D-5:** administrator-issued, single-use, expiring setup and recovery codes are the *temporary nonproduction* recovery mechanism. Self-service email recovery is **not** built and is not claimed.
- **D-8:** the capability mapping is accepted for independent review, with no new grants and no change to holders.

The Owner's required corrections are implemented in §3(b), §3(c), §3(e) and §4:
- the refresh token moves to an HttpOnly cookie;
- SameSite, Origin and CSRF protections;
- server-side revocation;
- a rotation, replay and concurrency review;
- key separation, key ids, rotation and missing-key refusal.
- Branch: `feature/eos-native-identity`, based on `origin/main` `acc65f2e`, in worktree `~/projects/eos-native-identity`.
- Nothing here has been applied to Render, to any nonprod or production database, or to any Firebase project.
- No secret has been generated or set.
- Everything is **inert on deploy**: without `EOS_HUMAN_LOGIN=enabled`, every route below is a 404 and every human-subject token is refused.

This builds on the EOS Identity and Session Foundation (`eos-identity-session-foundation.md`, PR #2002), which provides the EdDSA access token, the verifier, the `principal_identities` binding and the nonprod persona issuer. That foundation deferred one thing: how a **human** proves who they are. This document is that piece. The 16-persona model and its issuer are untouched.

## 1. What it is

```
person
  -> /auth/login (password)  -> /auth/login/mfa (TOTP or recovery code, when enrolled)
  -> EOS login session (PostgreSQL)  ->  short-lived EOS access token (EdDSA; sub = user.<hex>, sid = session)
  -> composite verifier: signature/iss/aud/env  +  HUMAN SESSION GATE (session live, account active, MFA owed?)
  -> resolvePrincipalContext  (UNCHANGED: binding -> Principal -> membership -> DQ-007 Employee gate -> Roles)
  -> existing PostgreSQL authorization (UNCHANGED)
```

Three properties hold throughout:

- **Authentication only.** A login proves "this person controls subject `user.<hex>`". It never states a Role, capability, scope or tenant, and the token's claim set is unchanged except for `sid`.
- **One resolution function.** Login, refresh and every request go through the same `resolvePrincipalContext`. A disabled Principal, a lost membership or a terminated Employee is refused **at login**, for the same reason the API would refuse the request (proof L18).
- **Authority unchanged.** No capability is registered and no grant is written. Administration reuses existing governed keys (§3(d)). Proof L24 asserts byte-identical Role assignments, Role grants, direct grants, Principals, Employees and links before and after the full lifecycle.

## 2. Archaeology (at `acc65f2e`)

| Concern | Found |
|---|---|
| Human sign-in | Firebase Auth only: `signInWithEmailAndPassword`, `sendPasswordResetEmail`, `signOut`, `onAuthStateChanged` in `AuthContext.jsx`. No MFA anywhere. |
| EOS token | EdDSA JWS, ≤900 s, no authority claims (`eosAccessToken.ts`). Issued only by the nonprod persona issuer. |
| Identity binding | `eos_policy.principal_identities`: provider `eos`, one active per Principal, append-only. 16 persona bindings live in nonprod. |
| Session revocation | **None.** `principal_access_versions` stales Role assignments but is not compared with any token. No session table, no `jti` denylist. |
| Rate limiting | **None** in the EOS API. |
| Email delivery | **None** in EOS. DECISIONS #54 defers any external provider indefinitely; #56 approved a Firebase-native server send, which the Firebase retirement ruling now precludes (D-5). |
| Admin credential actions | Firebase callables: `initiateAdminPasswordReset` (fail-closed, no sender), `setUserStatus` (Firebase `disabled` flag). No EOS equivalent. |
| Governing decisions | **#56:** D-ROUTINE-REVOKE = NO (reset never revokes; revocation is separate); `admin.credentialReset.initiate` is the reset permission; deny self, disabled, missing Employee link, last recoverable administrator. |
| Dependencies | No argon2, bcrypt, otplib, WebAuthn or JOSE library. `node:crypto` only. |

## 3. Design

### (a) Schema — migration `1764530000000_eos-native-login.sql`

The schema is ten `eos_policy` tables: the eight below plus the two D-13 governance tables (§8). They are empty on deploy, with no seed, no backfill and no Firebase import.

| Table | Holds | Never holds |
|---|---|---|
| `login_accounts` | login identifier → `principal_identities` binding; status `pending_enrollment`/`active`/`disabled`/`retired`; scrypt hash; credential version; lockout; `mfa_required` | a password; any authority |
| `login_tickets` | one-time enrollment / reset codes (≤7 days; one open per purpose) | the code (SHA-256 only) |
| `login_sessions` | the refresh session: idle + absolute expiry, `mfa_verified`, revocation reason | — |
| `login_refresh_tokens` | the rotating refresh chain (one current per session) | the token (SHA-256 only) |
| `login_mfa_factors` | TOTP factor, sealed secret, last accepted step | the secret in the clear (AES-256-GCM) |
| `login_recovery_codes` | ten single-use codes per generation | the code (HMAC-SHA-256 under the factor key) |
| `login_mfa_challenges` | the 5-minute password→factor step, ≤5 attempts | the challenge (SHA-256 only) |
| `authentication_events` | every attempt, including those naming no account; client IP as a keyed digest | a raw IP, identifier, password or token |

The database itself enforces these rules:
- Accounts, sessions and the event log are never deleted.
- An account's Principal and binding never change.
- A retired account is final.
- The credential version only rises.
- A session's absolute lifetime can only shrink, and a revoked session stays revoked.
- `authentication_events` refuses UPDATE, DELETE and TRUNCATE.
- The down migration refuses while any account or event exists.

Governed changes (provisioning, enrollment, reset, MFA changes, disable, revocation, retirement) also write `audit_events` in the account's tenant, through the existing policy transaction port.

### (b) Tokens and the session gate

- The human access token is the existing EOS token with **one new optional claim, `sid`** (the login session). It is not authority. Persona tokens never carry it, and a persona token that does is refused.
- **Lifetime:** 300 s. The ceiling stays 900 s.
- **Subjects:** human subjects are `user.<32 hex>`, random and never reused. Persona subjects remain `nonprod-persona.<key>`. Neither issuer can mint the other's subjects.
- **The human session gate.** `createCompositeTokenVerifier` gains an optional gate. For a human subject it requires `sid`, then checks that the session is live and belongs to that subject, and that:
  - the account is active and the binding is active;
  - the credential version is unchanged;
  - the session does not owe a second factor.

  It runs on **every** request, so revocation, disable, password change, MFA reset and retirement take effect **immediately**, not at `exp` (proofs L9, L15, L17, L19). When the front door is not composed, human tokens are refused outright.
- **Refresh tokens:** opaque, rotating and single-use. The exchange is **one transaction** that holds the token and session row locks from lookup through eligibility check to rotation, so concurrent exchanges serialise and exactly one rotates (S3).
- **Replay.** A spent token re-presented **within 10 s** of its exchange is treated as a sibling tab sharing the cookie jar. It gets `409 REFRESH_SUPERSEDED`: no token, no revocation, and the cookie is not cleared, so the client retries with the successor already in the jar. **Outside the window it is theft and the whole session is revoked** (`REFRESH_TOKEN_REUSE`, L9).
- **Lifetimes:** sessions idle out after 12 h and end absolutely at 7 days (D-4).

### (b2) The refresh cookie, Origin and CSRF (Owner corrections 1–3)

**The refresh token travels only in a cookie:**

```
Set-Cookie: __Host-eos_refresh=eosrt_…; Path=/; Secure; HttpOnly; SameSite=<EOS_AUTH_COOKIE_SAMESITE>; Max-Age=<idle window>[; Partitioned]
```

- **`__Host-` prefix.** The browser refuses the cookie unless it is Secure with Path=/ and no Domain, so a sibling subdomain cannot plant or shadow it.
- **HttpOnly.** No script can read it.
- **SameSite** comes from `EOS_AUTH_COOKIE_SAMESITE`, which is **required** when login is enabled and has no default:
  - `Strict` or `Lax` when the app and API are on one site;
  - `None` cross-site, in which case `Partitioned` (CHIPS) is added.
- **Never in a body.** The token never appears in a response body (asserted on every proof response) and is never accepted from a request body (S1, U12).

**Origin and CSRF on every human `/auth/*` request**, including login (closing login CSRF):
- `Origin` must exactly match one of `EOS_ALLOWED_ORIGINS`. Absent, `null` or anything else gets 403 `ORIGIN_REFUSED`.
- `X-EOS-CSRF: 1` must be present. No HTML form can send it, and no cross-origin script can send it without a CORS preflight that this handler answers only for an allowed origin. Absent gets 403 `CSRF_REFUSED`.
- `Content-Type: application/json`, else 415.
- These checks run before any work: no rate-limit spend, no event row, no password hashing (S2).
- CORS returns `Access-Control-Allow-Credentials: true` and the exact origin only for allowed origins, with `Vary: Origin` on every response.

**Logout and revocation are server-side.**
- Logout revokes the session row, so the refresh token is dead wherever a copy may be, and clears the cookie (`Max-Age=0`; S1).
- A refused refresh also clears the cookie.
- The human session gate makes every revocation immediate for access tokens too.

### (c) Routes (`eosLoginHttp.ts`, under the existing `/auth/` domain)

**Unauthenticated** (the body is the credential): `login`, `login/mfa`, `refresh`, `logout`, `enrollment/complete`, `password/reset/complete`.

**Authenticated** with the holder's own human session: `account`, `password/change`, `mfa/totp/begin|confirm|remove`, `mfa/recovery-codes/regenerate`, `sessions/revoke`, `sessions/revoke-others`.

**Uniform refusal.**
- An unknown identifier, wrong password, lock, disable, pending enrollment and ineligible Principal all return the same 401 `LOGIN_REFUSED`, after the same scrypt work. The reason goes to `authentication_events`.
- **Lockout is atomic** (review finding 2). Each password or second-factor attempt is *reserved* (counted) in one `UPDATE` before any hashing, and only while the account is unlocked. The reservation that reaches 5 sets a 15-minute lock, and every later attempt is refused without evaluation, so a concurrent burst cannot slip a correct guess past the lock (S9).
- A success clears the count. When a lock expires the count restarts, with **no escalation** (finding 4).
- The same reservation guards the holder's current password on password change, factor removal and code regeneration (finding 7; S10).
- *Residual risk (D-4):* anyone who knows an identifier can keep that account locked with 5 guesses per 15 minutes. Administrators can unlock, but the next 5 guesses re-lock it.
- A per-client-address limiter answers 429 before any password work: 10/min on credential routes, 120/min on routine ones. With `trustForwardedFor`, the client address is the rightmost `X-Forwarded-For` hop.
- CORS serves `EOS_ALLOWED_ORIGINS` only, **with** `Access-Control-Allow-Credentials` (the refresh cookie) and never a wildcard (§3(b2)). Every response is `no-store`.
- The rate limiter keys IPv4 by address and **IPv6 by /64**. The client address is taken `EOS_AUTH_TRUSTED_PROXY_HOPS` entries from the right of `X-Forwarded-For`; this setting is **required** with no default, and 0 means the socket address. The limiter evicts the oldest entries and never resets everyone (findings 5 and 6).
- The scrypt work queue is bounded: past 16 waiting requests the answer is `503 TRY_LATER` at once, and freed slots are handed directly to the next waiter (finding 5).

**Password policy (NIST 800-63B).**
- 12–128 characters, NFKC-normalised, no composition rules.
- Refused: common passwords, near-repetition, and passwords containing the identifier.
- A password change ends **every** session, including the current one, and returns a fresh session.

**MFA.**
- TOTP per RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step).
- **A code works once:** the accepted step must exceed the last one (L12).
- Enrolling issues 10 recovery codes and ends every other, password-only session.
- An account with `mfa_required` and no factor gets a session that reaches `/auth/*` only, until it enrolls (L13). Its holder cannot remove a required factor.
- Removing a factor needs the password **and** a current TOTP code or an unused recovery code. Regenerating recovery codes needs the password **and** a current TOTP code; a recovery code cannot mint more.
- An MFA challenge records the credential version and is void after any password reset or change (finding 8; S10).
- *Trust on first use:* an `mfa_required` account binds whichever authenticator is enrolled first by whoever holds the setup code and password. The code goes to the person directly (D-5).

### (d) Administration > Users (`/admin/policy`, the control plane)

These are ten operations in a fourth closed table, separate from the existing read and mutation lists, so their pins don't move. **Each is gated on the server by an existing capability already granted to admin and owner in PostgreSQL**:

| Operations | Capability |
|---|---|
| `readLoginAccount` | `admin.principalAccess.read` (the Users surface read) |
| `provisionLoginAccount`, `reissueLoginEnrollment`, `retireLoginAccount` | `admin.roleAssignment.write` (binds an identity, as `bindPrincipalEosIdentity` does) |
| `issueLoginReset`, `unlockLoginAccount`, `resetLoginMfa` | `admin.credentialReset.initiate` (DECISIONS #56) |
| `setLoginAccountStatus`, `revokeLoginSessions`, `setLoginMfaRequirement` | `admin.userStatus.write` |

Guards on every change:
- A stated reason.
- **Never on oneself.**
- **The login of anyone holding the protected Owner *or* Administrator Role (in any tenant) is administered only by an Owner** (review finding 3). Whoever is handed a setup or reset code becomes that person, so an Administrator, or any Role later granted `admin.credentialReset.initiate`, cannot take over another administering account (L19b, S6).
- **A login is single-tenant** (review finding 1).
  - Provisioning refuses a Principal with a membership in any other tenant (`MULTI_TENANT_PRINCIPAL`).
  - Login, refresh and the per-request session gate refuse once such a membership appears.
  - Administration from any tenant other than the account's own sees `NOT_FOUND`, and no foreign subject is disclosed (S5).
- The target must be a tenant member.
- Provisioning and resets need **exactly one linked Employee**: a service Principal gets no password.
- A Principal that already holds an EOS identity (every persona) is refused. Provisioning never revokes another identity to make room.
- **The last enabled EOS login held by an Owner or Administrator** cannot be disabled or retired. A per-tenant advisory lock serialises the check, so two concurrent disables cannot both pass (finding 9; L19b).
- Logout also revokes the session named by the bearer's `sid` when the cookie isn't sent (finding 11; S11).
- A spent refresh token re-presented from a **different client** inside the grace window counts as theft and revokes the session (finding 12; S12).
- **Issuing a reset revokes nothing** (#56 D-ROUTINE-REVOKE). Ending sessions is the separate, separately confirmed `revokeLoginSessions`. When the holder uses the code, their sessions end, as any password change does.

Setup and reset codes are returned **once** to the administrator, to hand over in person or by phone. They are not stored readably, not logged and not in the audit event (L22).

### (e) Client (`field-ops-app-vite`)

- **`auth/eosLoginClient.js`** has no Firebase import and **no browser storage at all**. A test asserts no `sessionStorage`, `localStorage` or `document.cookie` reference and no storage access.
  - The **access token lives in memory only**. A reload restores it with one cookie-backed `/auth/refresh`.
  - Every call sends `credentials: "include"` and `X-EOS-CSRF: 1`.
  - Refresh is single-flight within a tab and serialised across tabs with the Web Locks API (`eos-login-refresh`), with one retry on `REFRESH_SUPERSEDED`.
  - A refused refresh ends the in-memory session and notifies `AuthContext`, which signs the person out.
- **`auth/EosLogin.jsx`** shows sign-in, then the second factor, then the setup/reset code form. `App.jsx` renders it instead of `Login.jsx` **only** when the build sets `VITE_EOS_HUMAN_LOGIN=enabled` and is not a production build.
- **`AuthContext.jsx`** restores a session silently from the refresh token, once per page load. It re-resolves identity after login and revokes on logout. The Firebase path is unchanged.
- **`modules/account/AccountSecurity.jsx`** (`/account/security`) covers password, authenticator enrollment with an `otpauth://` link plus a manual key, recovery codes, and sessions.
- **`modules/administration/EmployeeLoginAccount.jsx`** adds the "EOS Sign-in" section in User detail > Roles & Access. It covers create, setup/reset code, unlock, sign out everywhere (confirmed), reset two-step, require two-step, enable/disable, and remove (confirmed), plus recent activity.

### (f) Multi-tenant identity — Owner ruling D-12 (2026-10-12)

> *"One Principal may belong to multiple tenants, but each authenticated session belongs to exactly one tenant."*

**Membership authority.** The existing `eos_policy.tenant_memberships` is the only membership record. No new or duplicate membership record is introduced, and no capability or grant.

**Session tenant.**
- `login_sessions.tenant_id` (NOT NULL, immutable by trigger) is the one tenant a session acts in.
- `login_mfa_challenges.tenant_id` carries the choice across the second-factor step.
- The tenant is **not a token claim**: `tenantId` stays an authority-bearing claim the verifier refuses. It is bound server-side through `sid`.

**Selection, server-validated.**
- Login accepts an optional `tenantId`. Without one, the account's home tenant is used.
- The tenant is chosen only **after** the password proves the person, so the set of a person's tenants is never disclosed to a guesser.
- It is validated by the **same `resolvePrincipalContext`** every request uses, in that tenant: active membership, active tenant, and **that tenant's** DQ-007 Employee gate. Selection can therefore never override Employee eligibility. Operating-company scope and Work Eligibility are resolved per tenant downstream, exactly as for any request (proof M3).

**Binding on every request** (`eosAuth/requestTenantBinding.ts`).
- The EOS API runs each request in its own AsyncLocalStorage scope.
- The human session gate binds the request to the session's tenant. `resolvePrincipalContext`, which every transport resolves its caller through (Administration, Operations, Commercial, CRM, Workforce, Catalog), enforces the binding:
  - no `x-eos-tenant` → the session tenant;
  - the same tenant → allowed;
  - **any other tenant**, even a real membership → refused (`TENANT_NOT_A_MEMBERSHIP` / `TENANT_NOT_SESSION_TENANT`) and recorded as a `tenantRefused` security event (M2).
- **Fail closed:** a human token verified outside a request scope cannot be bound and is refused (U7).
- Persona and Firebase identities are never bound and resolve exactly as before.

**Revocation is immediate.** The session gate re-checks the session tenant's membership on every request. Disabling it refuses the next request, refresh and login into that tenant, while sessions in the person's other tenants are unaffected (M6).

**Switching** (`POST /auth/session/switch-tenant {tenantId}`).
- Requires an `api`-mode session, so a session that owes a second factor cannot switch (M8). Verification status carries over.
- Validated like a login into the target tenant.
- In **one transaction under the session row lock**: the current session is revoked (`TENANT_SWITCH`), a **new session and cookie** are issued for the target, and the switch is audited in **both** tenants' `audit_events`. Two concurrent switches of one session: exactly one succeeds (M5).

**Administering a multi-tenant person's login** (both reviews). The check runs when a credential act is requested, and **again when a setup or reset code is used**. It covers every tenant the person belongs to, **in any membership status**, and every tenant where they hold a protected Role. In each of those tenants the acting administrator must:
- hold that operation's capability there, **resolved** through `resolvePrincipalContextById`, so membership and tenant status, the DQ-007 Employee gate and stale-assignment exclusion all apply;
- be an **Owner** there wherever the person holds the Owner or Administrator Role.

Refusals are `PROTECTED_TARGET` (the home tenant's own Owner rule) or the generic `TARGET_NOT_ADMINISTRABLE` (anything learned from another tenant, never named). One tenant's administrator can never mint a credential that acts in a tenant where they hold nothing (M1, R1–R3).

**Preserved single-tenant behaviour.**
- `EOS_AUTH_MULTI_TENANT_SESSIONS` defaults to **disabled**. Then a human login is single-tenant exactly as after review finding 1: a Principal with a membership elsewhere cannot be provisioned or sign in, and switching answers `409 TENANT_SWITCHING_DISABLED` (M7, and the full `eosNativeLoginPostgres` suite).
- Multi-tenant operation is enabled only by that explicit setting, after it is proven in nonprod.

## 4. Cryptography (`credentialCrypto.ts`, `node:crypto` only)

| What | How |
|---|---|
| Password | scrypt N=2¹⁷, r=8, p=1, 16-byte salt, 32-byte key, stored self-describing. A weaker stored hash still verifies and is re-hashed at the next login. At most 2 hashes run concurrently, since each needs 128 MiB. |
| Opaque tokens | 32 random bytes, typed prefixes (`eosrt_`, `eoset_`, `eospr_`, `eosmc_`) that secret scanners can match; stored as SHA-256 only |
| TOTP secret | 20 random bytes, AES-256-GCM, AAD = factor id (a sealed secret moved to another factor fails); keyring `v1.<kid>.…` for rotation |
| Recovery codes | 12 Crockford symbols (60 bits), HMAC-SHA-256 under the factor key, per-account |
| Client address | HMAC under its own HKDF subkey of the factor key; truncated |

### Key management and rotation (Owner correction 5)

**Separation.** There are three secrets of three types, in three variables:

| Secret | Variable | Purpose |
|---|---|---|
| Ed25519 signing key | `EOS_AUTH_SIGNING_KEY_NONPROD` | access tokens |
| Persona-issuer credential hash | `EOS_PERSONA_ISSUER_CREDENTIAL_SHA256` | the persona issuer |
| Factor root keys | `EOS_AUTH_FACTOR_KEYS` | the purposes below |

A factor root key is **never used directly**. Each purpose gets its own HKDF-SHA-256 subkey (RFC 5869):

| Purpose | HKDF info | Used for |
|---|---|---|
| seal | `eos-login/totp-seal/v1` | AES-256-GCM over TOTP secrets, AAD = factor id |
| recovery | `eos-login/recovery-code/v1` | HMAC over recovery codes, per account |
| client | `eos-login/client-digest/v1` | HMAC over client addresses |

Config refuses:
- any key that is not 32 bytes;
- an all-zero key;
- two kids holding the same material (a relabel is not a rotation);
- more than 4 kids;
- a current kid not in the set;
- factor keys or the SameSite setting while login is off.

**Key ids.**
- Every sealed TOTP secret is `v1.<kid>.<iv>.<ct>.<tag>`, and the database CHECK enforces that shape.
- Every recovery code row stores its `key_id`.

**Rotation runbook (no downtime):**
1. Generate a new 32-byte key offline (operator custody).
2. Set `EOS_AUTH_FACTOR_KEYS={old,new}` and `EOS_AUTH_FACTOR_KEY_ID=new`, then deploy.
   - New enrolments and new recovery codes use `new`.
   - Each TOTP factor is **re-sealed under `new` the next time it verifies**, inside the same transaction (lazy rotation; S4).
   - Old recovery codes keep verifying under `old`.
3. Watch `factorKeyCensus()`: counts per kid of live factors and live recovery codes (no secrets, no accounts). It also lists `unheld` kids, meaning material under a key the service does not hold.
4. Drop `old` **only when the census shows zero** for it. Accounts still holding old recovery codes can regenerate them, or an administrator can reset MFA.

**Missing key fails closed.** A factor or recovery code under a key the service does not hold is refused with `503 MFA_KEY_UNAVAILABLE` and recorded in `authentication_events`. It is never treated as a pass, and never as a wrong code that counts toward lockout (S4).

## 5. Owner decisions

The code is built so that each of these can be decided without rework. **D-1, D-2, D-5 and D-10 must be decided before any deployment.**

| ID | Decision | Built default / recommendation |
|---|---|---|
| **D-1** | **Production.** The EOS API refuses `EOS_ENVIRONMENT=production`, and the login service signs with `nonprod-` keys only. Human login in production needs a production signing key, issuer and audience, and lifting the service-level refusal. That is irreversible security design. | Nonprod only. Production is a separate authorization. |
| **D-2** | **Identity provider.** EOS is its own IdP (passwords + TOTP in PostgreSQL). The alternative is a managed IdP or SSO (Entra ID / Google Workspace / Okta / Auth0 / WorkOS), mapped through `principal_identities`. | EOS-native, as directed. SSO stays addable later as another binding kind. **Confirm** before nonprod enablement. |
| **D-3** | **Token storage — CORRECTED per Owner.** The refresh token is now an HttpOnly `__Host-` cookie, and the access token stays in memory. **Remaining deployment fact:** nonprod today puts the app (`*.vercel.app`) and the API (`*.onrender.com`) on different sites, so the cookie is third-party and needs `SameSite=None; Partitioned`. Browsers that block third-party cookies outright, or don't support CHIPS, will not send it: sign-in still works, but every reload asks for sign-in again. | **Blocker to a good nonprod experience:** put the app and API under one registrable domain (e.g. `app.` + `api.`) and use `SameSite=Strict`. |
| **D-4** | **Lifetimes and lockout:** access 5 min, idle 12 h, absolute 7 d. Lock after 5 failures for 15 min; the count **restarts** when the lock expires (no escalation; review finding 4). Enrollment code 72 h, reset code 24 h. | As built. Residual: anyone who knows an identifier can hold that account locked with 5 guesses per 15 minutes. Tune for field technicians. |
| **D-5** | **Self-service recovery and invitations by email.** EOS has no outbound email. #54 defers any external provider, and #56's Firebase-native send conflicts with Firebase retirement. | **Admin-assisted codes only.** A new email decision is needed for "forgot password" self-service. |
| **D-6** | **Breached-password screening** (e.g. the Have I Been Pwned k-anonymity range API: an outbound call, with no password leaving EOS). | Off. Only an embedded common-password list. |
| **D-7** | **MFA policy.** Who *must* have two-step verification is per-account today, set in Administration. A role-based mandate (e.g. Owner, Administrator, Finance) is an authority-adjacent rule. **Passkeys/WebAuthn** are the next factor, either hand-rolled COSE/CBOR verification or a dependency such as `@simplewebauthn/server`. | Per-account flag. Recommend a mandate for Owner/Administrator/Finance, and passkeys as the next increment. |
| **D-8** | **Credential-administration authority.** §3(d) maps the operations onto existing keys, already held by admin and owner in PostgreSQL. #56 recorded `admin.credentialReset.initiate` as "inactive, no grants" on the **Firebase** side, and the PostgreSQL migration `1761609600000` grants it to admin and owner. Using it here relies on that existing PostgreSQL grant for an EOS-native reset. #56 also asks for a dedicated permission for session revocation, which is mapped to `admin.userStatus.write` today. | **Confirm the mapping**, or rule a dedicated `admin.loginSession.revoke` (a new capability means grant fan-out and an authority change). |
| **D-9** | **Moving people off Firebase Auth.** Firebase password hashes are **not** imported: that needs the project's hash key, which is a real credential. Each person gets a setup code and chooses a new password. Firebase and EOS sign-in run side by side until `FX-AUTH-001` retirement is separately authorized. | Re-enrollment. No credential migration. |
| **D-10** | **New nonprod secret** `EOS_AUTH_FACTOR_KEYS` / `EOS_AUTH_FACTOR_KEY_ID` (32 random bytes; seals TOTP secrets and peppers recovery codes). Without it, login is password-only and MFA refuses `MFA_NOT_CONFIGURED`. Also needed: `EOS_HUMAN_LOGIN=enabled` and the client build flag `VITE_EOS_HUMAN_LOGIN=enabled`. | Not generated, not set. Operator custody, as the signing key. |
| **D-12** | **RULED 2026-10-12.** One Principal may belong to many tenants; each session belongs to exactly one tenant. | **Implemented** (§3(f)). Behind `EOS_AUTH_MULTI_TENANT_SESSIONS`, default disabled (single-tenant preserved). |
| **D-13** | **RULED 2026-10-12.** A governed retention/archival policy for authentication events. | **Designed and built** (§8). Append-only, tenant-isolated, restricted reads, bounded audited policy, read-only plan, append-only manifest. **No job, no deletion.** |
| **D-11** | **Persona Principals and password logins.** A Principal holds one active EOS identity, so the 16 persona Principals cannot also have a password login. | Keep. The persona model is frozen, and human logins are for human Employees. |

## 6. Proofs

**`functions/test/eosNativeLoginPostgres.test.mjs`** (real postgres:16, the real in-process EOS API, a fake Firebase verifier, offline guard):

| | |
|---|---|
| L1 | inert without `EOS_HUMAN_LOGIN`; half-configurations refused |
| L2 | provisioning: binding `user.<hex>`, ticket once, audited without the ticket |
| L3 | refusals: self, Owner by non-Owner, persona Principal, no reason, duplicate identifier, non-administrator, **no Employee link**, each operation's capability |
| L4 | an Owner administers an Owner |
| L5–L6 | pending accounts refused uniformly; enrollment password policy; ticket single-use |
| L7 | **EOS login resolves identically to the Firebase path** (`resolveMyExperienceContext` bodies equal); claim set exact; CORS |
| L8 | lockout and administrative unlock |
| L9–L10 | refresh rotation; **reuse revokes the session and its live access token at once**; logout; idle and absolute expiry |
| L11–L14 | TOTP enrollment with real codes; MFA login; replay refused; recovery code single-use; MFA-required gating; administrator MFA reset |
| L15–L16 | password change ends every session; **reset issues no revocation** (#56); reset completion; audit coverage |
| L17–L19b | disable is immediate; **DQ-007 employment gate governs login**; retirement revokes the binding, and the subject is never reused; **last administrating login protected** |
| L20 | persona binding untouched; persona token cannot self-serve; forged human-without-sid, persona-with-sid and cross-subject `sid` all refused |
| L22 | **no password, code, token, recovery code or TOTP secret at rest or in logs** |
| L23 | append-only and immutability triggers |
| L24 | **authority digest identical** (scoped to the tenant under proof) |
| S1 | cookie attributes; never in a body; a body-presented token refused; logout revokes server-side and clears the cookie |
| S2 | Origin/CSRF/content-type refusals before any work; preflight grants credentials only to the allowed origin |
| S3 | five concurrent refreshes of one cookie: exactly one 200, four `REFRESH_SUPERSEDED`, the session survives, one current token |
| S4 | key loss gives 503 `MFA_KEY_UNAVAILABLE`, recorded, no session; rotation re-seals lazily; old-kid recovery codes still verify; census reports unheld kids |
| S5 | tenant resolution identical to Firebase across stated/unstated/foreign tenants; **another tenant's administrator cannot read or administer the login** of a Principal they share |
| S6 | the Owner protection refuses all eight credential mutations by an Administrator |
| S7 | existing business authorization unchanged: 8 operation pairs, EOS and Firebase identical |
| S8 | every administrative act is a persisted, append-only audit row naming the actor and the reason |

**Also:**
- **`functions/test/eosNativeLoginUnit.test.mjs` (U1–U11):** scrypt parameters and upgrade; NIST policy; **RFC 6238 vectors**; GCM binding and rotation; recovery and opaque token shapes; the `sid` claim; the composite gate; subjects and identifiers; the rate limiter; the pure handler; config.
- **`functions/test/eosNativeLoginUnit.test.mjs` U12:** cookie attributes per SameSite mode (Partitioned only with None); the cookie is the only refresh credential; the Origin/CSRF/content-type gate on every route.
- **`field-ops-app-vite/test/eosLoginClient.test.mjs`:** memory-only tokens with **no storage access**; CSRF header and credentials on every call; single-flight and **cross-tab Web Lock** refresh with a SUPERSEDED retry; refused-vs-network refresh; logout; self-service; no Firebase import.

## 7. Enablement sequence (each step needs its own authorization)

1. Owner rulings on D-1, D-2, D-5 and D-8 (and D-3 before production).
2. Merge. Inert: the migration creates empty tables, the routes are 404 and human tokens are refused.
3. Nonprod configuration (operator). **All of it is OFF today, and none of it has been generated or set.** In order:
   - `EOS_AUTH_FACTOR_KEYS` / `EOS_AUTH_FACTOR_KEY_ID`;
   - `EOS_AUTH_COOKIE_SAMESITE` (`Strict` once the app and API share a site, else `None`) and `EOS_AUTH_TRUSTED_PROXY_HOPS` (confirm against the raw `X-Forwarded-For` Render delivers; expected `1`);
   - `EOS_HUMAN_LOGIN=enabled` on `eos-api-nonprod`;
   - `VITE_EOS_HUMAN_LOGIN=enabled` on the nonprod client build.
4. Nonprod proof: provision one non-persona Employee login through Administration, enroll, MFA, refresh, reset, disable, and compare with the Firebase path.
5. Rollout: setup codes per person; Firebase sign-in stays available.
6. Later, separately: production (D-1, D-3), then Firebase Auth retirement (`FX-AUTH-001`).

## 8. Security-event retention — Owner ruling D-13 (DESIGN; nothing scheduled)

**Active history.**
- `authentication_events` is append-only: no UPDATE, DELETE or TRUNCATE, enforced by trigger. No code in this repository deletes, alters, moves or exports a row.
- Every row carries `tenant_id`, chosen in this order:
  1. the tenant the event is about: a selected tenant, but only where the person has a membership row (third review N1);
  2. else the session's tenant;
  3. else the account's home tenant.
- It is **NULL only for attempts that name no account**; those are operator-visible and never shown to a tenant (M12).

**Restricted access.** `readAuthenticationEvents` and `planAuthenticationEventArchive` require `admin.principalAccess.read` (admin and owner), and always read **the caller's tenant only**. `audit.event.read` was deliberately *not* used: twelve Roles hold it.

**Configurable retention.**
- `authentication_event_retention_policies` holds one row per tenant per change. It is **history-only** (append-only trigger), so the policy in force is the newest row.
- The bounds are 365–3650 days, for both active and archive retention, enforced by CHECK and by the API.
- A change (`setAuthenticationEventRetention`) requires `admin.securityPolicy.write` and a reason, and writes one `audit_events` row in the tenant (M13).
- **With no policy, nothing is ever eligible.**

**Auditable archival.**
- `planAuthenticationEventArchive` is **read-only**. It reports the eligible window for the caller's tenant (from the end of the last recorded archive to *now − active retention*), its row count, and the **SHA-256 of the canonical export**: NDJSON, one `canonicalEventLine` per row, ordered by `occurred_at, id` (M14).
- `authentication_event_archive_manifests` (append-only) records each archival an operator performs under authorization: window, row count, export digest, storage location, who and why. **It has no "purged" state.**

**No silent deletion.** Nothing archives automatically, no job exists, and no deletion path exists in code. If the Owner later authorises reclaiming space, the intended mechanism is a reviewed migration that converts `authentication_events` to monthly range partitions and **detaches** (never drops) a partition only after its manifest is recorded and the archive verified. That is a separate decision.

**Archival procedure** (operator, separately authorised, per tenant):
1. Call `planAuthenticationEventArchive` and record the window, count and digest.
2. Export exactly those rows with the canonical serializer, read-only and from a replica if available.
3. Verify the export's SHA-256 equals the plan's digest.
4. Store the export in write-once storage (object lock / retention).
5. Insert the manifest row (window, count, digest, location, reason). The next plan starts at that window's end.

**Retrieval and restoration:**
1. Fetch the archive by its manifest location.
2. Recompute the SHA-256 and compare it with the manifest. A mismatch means the archive is not trusted, and the incident is reported.
3. Load the rows into a **separate** read-only restoration schema (never back into the active table, whose history must not be rewritten), or query the NDJSON directly.
4. Record the retrieval as an `audit_events` row in the tenant, with who, which manifest and why.

## 8b. Second independent security review (final implementation, 2026-10-12)

A fresh reviewer with no authoring context reviewed the D-12/D-13 head. **No CRITICAL or HIGH finding.**
- **HIGH-1** (cross-tenant escalation): **closed** in both modes.
- **HIGH-2** (lockout): **closed**.
- **HIGH-3** (takeover through codes): closed at issue time; a use-time gap (finding 2) is **now closed**.

| # | Sev | Finding | Disposition (proof) |
|---|---|---|---|
| 1 | MED | Refresh held row locks while resolving eligibility on other pool connections, so a burst on one cookie could pin the pool | **Fixed.** Eligibility is resolved before the locking transaction; the same pattern was also removed from `issueLoginReset` (R5) |
| 2 | MED | An open setup or reset code outlived the issuer's authority (target promoted, or joined another tenant) | **Fixed.** `consumeTicket` re-runs the issue-time check against `issued_by`; a lapsed code is revoked and recorded `TICKET_ISSUER_AUTHORITY_LAPSED` (R1) |
| 3 | MED | Cross-tenant authority looped over *active* memberships only | **Fixed.** Every membership in any status, plus every tenant with a protected Role (R2) |
| 4 | MED | The actor's authority in other tenants bypassed principal resolution (DQ-007, stale assignments) | **Fixed.** Resolved through `resolvePrincipalContextById` per tenant (R3) |
| 5 | MED/LOW | The Employee requirement was enforced only in the home tenant | **Fixed.** A human session requires an Employee link **in its own tenant**: at login, refresh, switch and self-service (R4) |
| 6 | LOW/MED | A stolen access token could enroll the thief's authenticator | **Fixed.** `totp/begin` requires the current password (L11, R6) |
| 7 | LOW | Self-service skipped principal resolution | **Fixed.** `self` mode resolves fully (R7) |
| 8 | LOW | Refusals after tenant selection were recorded in the home tenant | **Fixed.** Recorded in the selected tenant (R4) |
| 9 | LOW | Forged-header refusals could flood the append-only log | **Fixed.** Coalesced to one record per session per minute; every request is still refused (M2) |
| 10 | LOW | Revocations failed when the event store failed | **Fixed.** Revocation events are best-effort in a savepoint; grants still fail closed (R10, M11). Governed `audit_events` stay strict |
| 11 | LOW | Refusal details disclosed other tenants' facts | **Fixed.** Anything learned from another tenant is the generic `TARGET_NOT_ADMINISTRABLE` (R2) |
| 12 | LOW | `EOS_AUTH_CLIENT_IP_HEADER` is spoofable if the origin is reachable directly | **Documented** (§9). Render services are reachable only through Render's edge; confirm by the §9 measurement |
| 13 | INFO | Doc mismatches; missing TRUNCATE guards; last-administrator guard in multi-tenant mode | **Fixed.** D-4 row, route header, TRUNCATE triggers on both governance tables, and the guard counts logins homed in any tenant |

**Third independent verification (head after these fixes).** Findings 1–11 and 13 verified **CLOSED**; HIGH-1, HIGH-2 and HIGH-3 confirmed **CLOSED**; no CRITICAL or HIGH open. Two new items, now fixed:
- **N1 (LOW, multi-tenant mode only).** A refusal for a tenant the person isn't a member of was recorded in that tenant, and a non-existent id answered 500. Now it is recorded in the home tenant and answers 401 (M3).
- **N2 (INFO).** `totp/begin` now uses the credential rate-limit budget.

Accepted residuals:
- **Promotion race (~100 ms).** A code's issuer re-check runs before the password hash, so a promotion that commits in that window still passes.
- **Employee link removed mid-session.** After a link is removed, API access continues until the access token expires (≤ 300 s). The next refresh refuses it, and status changes are enforced per request by DQ-007.
- **Provisioning refusal messages.** These say *whether* a login or membership exists elsewhere, but never where.

**Operational consequence of finding 3 (intended).** If a person holds a membership in another tenant, even a suspended one, then only an actor holding the authority in *every* such tenant can administer that person's login. The other tenant must remove the membership, or a dual-tenant Owner must act.

## 9. Nonproduction infrastructure assessment (no live change made)

**The problem.**
- The app is served from `verenwardeos.vercel.app` (Vercel); the API from `eos-api-nonprod.onrender.com` (Render).
- Those are different registrable domains, so the `__Host-eos_refresh` cookie is **third-party**. It needs `SameSite=None; Partitioned`, and browsers that block third-party cookies will not send it: sign-in still works, but a reload asks again.

**Recommendation: one registrable domain, two hosts.**

| Host | Serves | DNS | Platform step |
|---|---|---|---|
| `app.<eos-domain>` | the Vite app | `CNAME → cname.vercel-dns.com` | add the domain to the Vercel project |
| `api.<eos-domain>` | the EOS API | `CNAME → eos-api-nonprod.onrender.com` | add a custom domain to the Render service (Render issues the certificate) |

Then:
- `EOS_ALLOWED_ORIGINS=https://app.<eos-domain>`
- `VITE_EOS_API_BASE_URL=https://api.<eos-domain>`
- `EOS_AUTH_COOKIE_SAMESITE=Strict`

The cookie stays `__Host-` (host-only, on `api.`). The browser treats the two hosts as **same-site**, so the cookie is first-party and works with third-party-cookie blocking. CORS is still required (they are different *origins*), and the existing exact-origin allowlist already handles it.

*Rejected alternative:* proxying `/api/*` through a Vercel rewrite to Render, to make it same-origin. Vercel documents that it overwrites `X-Forwarded-For` and does not forward external IPs, so the API would see Vercel's addresses as the client and the per-client rate limiter would collapse. Upstream `Set-Cookie`, timeout and body-size behaviour for external rewrites is also not documented.

**Trusted-proxy findings.** No live system was probed; this is from documentation and published measurements.
- Render's own article *How Render handles DDoS attacks* states that all inbound traffic passes through **Cloudflare** and then Render's load balancers. It says to read the client IP from `x-forwarded-for`, but **does not say which entry**.
- Published measurements on Render (e.g. `johnbeynon/header-test`) report:
  - a **client-supplied `X-Forwarded-For` is kept, with the real client address *and* proxy addresses appended**. So the left side is forgeable and the number of appended hops is not documented;
  - `True-Client-IP` is **overwritten by the edge** with the real client address;
  - a spoofed `CF-Connecting-IP` is rejected at the edge.
- **Conclusion:** a fixed `EOS_AUTH_TRUSTED_PROXY_HOPS` value cannot be justified from documentation. This branch adds `EOS_AUTH_CLIENT_IP_HEADER` (`true-client-ip` | `cf-connecting-ip`), which takes precedence when the edge sets it (U13).
- **Recommended:** `EOS_AUTH_CLIENT_IP_HEADER=true-client-ip`. Keep `EOS_AUTH_TRUSTED_PROXY_HOPS` only as a fallback, set **after** one authorised measurement on nonprod: log the raw `X-Forwarded-For`, `True-Client-IP` and `CF-Connecting-IP` for a request from a known address. **That measurement is a blocker.**

## 10. Remaining Firebase Authentication dependencies (measured at this head)

| Dependency | Where | Count | Retires when |
|---|---|---|---|
| Human sign-in | `field-ops-app-vite/src` importing `firebase/auth` (`AuthContext.jsx`, `firebase/firebase.js`) | 2 files | EOS login enabled and every person re-enrolled (D-9) |
| Firestore client data access | files importing `firebase/firestore` | 22 | each domain moves to the EOS API (the Firebase exit ledger) |
| Functions callables | files importing `firebase/functions` | 23 | each callable is replaced (F-series) |
| Firestore Rules | `firestore.rules` `request.auth` references | 32 | the last Firestore read retires |
| Firebase Admin Auth on the server | `access/claimsWriter.ts`, `access/trustedWriterCommands.ts`, `access/adminCredentialCallables.ts` | 3 files | Users/status/reset move to EOS login administration |
| EOS API Firebase verifier | `eosApi/server.ts` `createFirebaseTokenVerifier` | 1 | no Firebase-token callers remain |
| Harnesses | scripts reading `SANDBOX_CREDENTIALS_FILE` | 5 | harnesses move to EOS persona or login sessions |

**Why an EOS-only session cannot use those surfaces.** Every Firestore read and every callable authorises with `request.auth` / the Firebase ID token. An EOS-only session therefore reaches the EOS-API surfaces only. Replacing Firebase Authentication requires those surfaces to move first, or to run side by side (D-9).

## 11. A pre-existing harness defect fixed here

The migrator's verbose log of every migration's SQL had reached **1,044,000 bytes**. That is within 4 KB of Node's default 1 MiB `execFileSync`/`spawnSync` buffer, and **141 PostgreSQL test files** spawn the migrator with that default. Any next migration, from any lane, would fail all of them with `ENOBUFS`. This branch's migration crossed the line first.

The fix is in the harnesses: an explicit `maxBuffer` on every migrator spawn, applied mechanically and listed in the commit. Trimming this migration would only have moved the cliff to the next one.
