# EOS Native Identity — the human front door

Status: **LOCAL, NOT PUSHED, NOT DEPLOYED.**
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

The schema is eight `eos_policy` tables. They are empty on deploy, with no seed, no backfill and no Firebase import.

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
- **Refresh tokens:** opaque, rotating and single-use. **Presenting a spent one revokes the whole session** (reuse is the theft signal; L9). Sessions idle out after 12 h and end absolutely at 7 days (D-4).

### (c) Routes (`eosLoginHttp.ts`, under the existing `/auth/` domain)

**Unauthenticated** (the body is the credential): `login`, `login/mfa`, `refresh`, `logout`, `enrollment/complete`, `password/reset/complete`.

**Authenticated** with the holder's own human session: `account`, `password/change`, `mfa/totp/begin|confirm|remove`, `mfa/recovery-codes/regenerate`, `sessions/revoke`, `sessions/revoke-others`.

**Uniform refusal.**
- An unknown identifier, wrong password, lock, disable, pending enrollment and ineligible Principal all return the same 401 `LOGIN_REFUSED`, after the same scrypt work. The reason goes to `authentication_events`.
- Five consecutive failures lock the account for 15 min, doubling to a 24 h cap. A failed second-factor code counts too.
- A per-client-address limiter answers 429 before any password work: 10/min on credential routes, 120/min on routine ones. With `trustForwardedFor`, the client address is the rightmost `X-Forwarded-For` hop.
- CORS serves `EOS_ALLOWED_ORIGINS` only, with no credentials mode. Every response is `no-store`.

**Password policy (NIST 800-63B).**
- 12–128 characters, NFKC-normalised, no composition rules.
- Refused: common passwords, near-repetition, and passwords containing the identifier.
- A password change ends **every** session, including the current one, and returns a fresh session.

**MFA.**
- TOTP per RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step).
- **A code works once:** the accepted step must exceed the last one (L12).
- Enrolling issues 10 recovery codes and ends every other, password-only session.
- An account with `mfa_required` and no factor gets a session that reaches `/auth/*` only, until it enrolls (L13). Its holder cannot remove a required factor.
- Removing a factor or regenerating codes needs the password **and** a current code.

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
- **An Owner's login only by an Owner.**
- The target must be a tenant member.
- Provisioning and resets need **exactly one linked Employee**: a service Principal gets no password.
- A Principal that already holds an EOS identity (every persona) is refused. Provisioning never revokes another identity to make room.
- **The last enabled EOS login held by an Owner or Administrator** cannot be disabled or retired.
- **Issuing a reset revokes nothing** (#56 D-ROUTINE-REVOKE). Ending sessions is the separate, separately confirmed `revokeLoginSessions`. When the holder uses the code, their sessions end, as any password change does.

Setup and reset codes are returned **once** to the administrator, to hand over in person or by phone. They are not stored readably, not logged and not in the audit event (L22).

### (e) Client (`field-ops-app-vite`)

- **`auth/eosLoginClient.js`** has no Firebase import.
  - Login, MFA, single-flight refresh 60 s before expiry, logout with server revocation, tickets, and self-service.
  - The access token goes under the existing `eos.session.v1` key, so every API client sends it unchanged. The refresh token goes in `eos.refresh.v1`, in sessionStorage (D-3).
- **`auth/EosLogin.jsx`** shows sign-in, then the second factor, then the setup/reset code form. `App.jsx` renders it instead of `Login.jsx` **only** when the build sets `VITE_EOS_HUMAN_LOGIN=enabled` and is not a production build.
- **`AuthContext.jsx`** restores a session silently from the refresh token, once per page load. It re-resolves identity after login and revokes on logout. The Firebase path is unchanged.
- **`modules/account/AccountSecurity.jsx`** (`/account/security`) covers password, authenticator enrollment with an `otpauth://` link plus a manual key, recovery codes, and sessions.
- **`modules/administration/EmployeeLoginAccount.jsx`** adds the "EOS Sign-in" section in User detail > Roles & Access. It covers create, setup/reset code, unlock, sign out everywhere (confirmed), reset two-step, require two-step, enable/disable, and remove (confirmed), plus recent activity.

## 4. Cryptography (`credentialCrypto.ts`, `node:crypto` only)

| What | How |
|---|---|
| Password | scrypt N=2¹⁷, r=8, p=1, 16-byte salt, 32-byte key, stored self-describing. A weaker stored hash still verifies and is re-hashed at the next login. At most 2 hashes run concurrently, since each needs 128 MiB. |
| Opaque tokens | 32 random bytes, typed prefixes (`eosrt_`, `eoset_`, `eospr_`, `eosmc_`) that secret scanners can match; stored as SHA-256 only |
| TOTP secret | 20 random bytes, AES-256-GCM, AAD = factor id (a sealed secret moved to another factor fails); keyring `v1.<kid>.…` for rotation |
| Recovery codes | 12 Crockford symbols (60 bits), HMAC-SHA-256 under the factor key, per-account |
| Client address | HMAC under a key derived from the factor key; truncated |

## 5. Owner decisions

The code is built so that each of these can be decided without rework. **D-1, D-2, D-5 and D-10 must be decided before any deployment.**

| ID | Decision | Built default / recommendation |
|---|---|---|
| **D-1** | **Production.** The EOS API refuses `EOS_ENVIRONMENT=production`, and the login service signs with `nonprod-` keys only. Human login in production needs a production signing key, issuer and audience, and lifting the service-level refusal. That is irreversible security design. | Nonprod only. Production is a separate authorization. |
| **D-2** | **Identity provider.** EOS is its own IdP (passwords + TOTP in PostgreSQL). The alternative is a managed IdP or SSO (Entra ID / Google Workspace / Okta / Auth0 / WorkOS), mapped through `principal_identities`. | EOS-native, as directed. SSO stays addable later as another binding kind. **Confirm** before nonprod enablement. |
| **D-3** | **Token storage.** The refresh token sits in sessionStorage, readable by any XSS on the app origin. The stronger option is an HttpOnly, SameSite cookie, which needs the API and the app on one site (e.g. `app.` + `api.` under one domain). | sessionStorage now. **Recommend custom domains + cookie before production.** |
| **D-4** | **Lifetimes and lockout:** access 5 min, idle 12 h, absolute 7 d; lock at 5 failures for 15 min, doubling to 24 h; enrollment code 72 h, reset code 24 h. | As built. Tune for field technicians (e.g. a longer idle window on managed devices). |
| **D-5** | **Self-service recovery and invitations by email.** EOS has no outbound email. #54 defers any external provider, and #56's Firebase-native send conflicts with Firebase retirement. | **Admin-assisted codes only.** A new email decision is needed for "forgot password" self-service. |
| **D-6** | **Breached-password screening** (e.g. the Have I Been Pwned k-anonymity range API: an outbound call, with no password leaving EOS). | Off. Only an embedded common-password list. |
| **D-7** | **MFA policy.** Who *must* have two-step verification is per-account today, set in Administration. A role-based mandate (e.g. Owner, Administrator, Finance) is an authority-adjacent rule. **Passkeys/WebAuthn** are the next factor, either hand-rolled COSE/CBOR verification or a dependency such as `@simplewebauthn/server`. | Per-account flag. Recommend a mandate for Owner/Administrator/Finance, and passkeys as the next increment. |
| **D-8** | **Credential-administration authority.** §3(d) maps the operations onto existing keys, already held by admin and owner in PostgreSQL. #56 recorded `admin.credentialReset.initiate` as "inactive, no grants" on the **Firebase** side, and the PostgreSQL migration `1761609600000` grants it to admin and owner. Using it here relies on that existing PostgreSQL grant for an EOS-native reset. #56 also asks for a dedicated permission for session revocation, which is mapped to `admin.userStatus.write` today. | **Confirm the mapping**, or rule a dedicated `admin.loginSession.revoke` (a new capability means grant fan-out and an authority change). |
| **D-9** | **Moving people off Firebase Auth.** Firebase password hashes are **not** imported: that needs the project's hash key, which is a real credential. Each person gets a setup code and chooses a new password. Firebase and EOS sign-in run side by side until `FX-AUTH-001` retirement is separately authorized. | Re-enrollment. No credential migration. |
| **D-10** | **New nonprod secret** `EOS_AUTH_FACTOR_KEYS` / `EOS_AUTH_FACTOR_KEY_ID` (32 random bytes; seals TOTP secrets and peppers recovery codes). Without it, login is password-only and MFA refuses `MFA_NOT_CONFIGURED`. Also needed: `EOS_HUMAN_LOGIN=enabled` and the client build flag `VITE_EOS_HUMAN_LOGIN=enabled`. | Not generated, not set. Operator custody, as the signing key. |
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
| L24 | **authority digest identical** |

**Also:**
- **`functions/test/eosNativeLoginUnit.test.mjs` (U1–U11):** scrypt parameters and upgrade; NIST policy; **RFC 6238 vectors**; GCM binding and rotation; recovery and opaque token shapes; the `sid` claim; the composite gate; subjects and identifiers; the rate limiter; the pure handler; config.
- **`field-ops-app-vite/test/eosLoginClient.test.mjs`:** flag and production refusal; storage; **single-flight refresh**; refused-vs-network refresh; logout; self-service; no Firebase import.

## 7. Enablement sequence (each step needs its own authorization)

1. Owner rulings on D-1, D-2, D-5 and D-8 (and D-3 before production).
2. Merge. Inert: the migration creates empty tables, the routes are 404 and human tokens are refused.
3. Nonprod secrets (operator): `EOS_AUTH_FACTOR_KEYS`/`_ID`, then `EOS_HUMAN_LOGIN=enabled` on `eos-api-nonprod`, then `VITE_EOS_HUMAN_LOGIN=enabled` on the nonprod client build.
4. Nonprod proof: provision one non-persona Employee login through Administration, enroll, MFA, refresh, reset, disable, and compare with the Firebase path.
5. Rollout: setup codes per person; Firebase sign-in stays available.
6. Later, separately: production (D-1, D-3), then Firebase Auth retirement (`FX-AUTH-001`).

## 8. A pre-existing harness defect fixed here

The migrator's verbose log of every migration's SQL had reached **1,044,000 bytes**. That is within 4 KB of Node's default 1 MiB `execFileSync`/`spawnSync` buffer, and **141 PostgreSQL test files** spawn the migrator with that default. Any next migration, from any lane, would fail all of them with `ENOBUFS`. This branch's migration crossed the line first.

The fix is in the harnesses: an explicit `maxBuffer` on every migrator spawn, applied mechanically and listed in the commit. Trimming this migration would only have moved the cliff to the next one.
