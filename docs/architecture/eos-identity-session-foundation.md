# EOS Identity and Session Foundation

Status: **LOCAL FOUNDATION, NOT DEPLOYED.** Controller ruling 2026-09-29, "EOS IDENTITY BOUNDARY",
Option A refined. Branch `identity/eos-session-foundation` (off `main` f53c0eaf). Nothing in this
document has been applied to Render, to the nonprod database or to any Firebase project.

## 1. What this is

This is the smallest EOS-owned authentication and session boundary that can eventually replace
Firebase Authentication. The nonprod persona harness is a controlled issuer and user of the same
session architecture. The foundation is **additive**: Firebase sign-in keeps working unchanged,
and every Firebase-verified request resolves exactly as before.

```
persona / human
  -> EOS authentication/session boundary        (issuer: src/eosAuth/eosSessionIssuer.ts)
  -> short-lived EOS access token (EdDSA JWS)   (src/eosAuth/eosAccessToken.ts)
  -> EOS API verifier                           (eosAccessToken.ts + eosAuthHttp.ts composite, in eosApi/server.ts)
  -> EOS Principal                              (ONE resolution function: resolvePrincipalContext
                                                 -> resolvePrincipalByVerifiedIdentity)
  -> EOS Employee                               (L5 employment gate, unchanged)
  -> EXISTING PostgreSQL authorization          (unchanged)
```

There are three concerns, and they stay separate:

| Concern | Question | Where it is answered |
|---|---|---|
| AUTHENTICATION | Who proved this identity? | The token: `(identity_provider, external_subject)` and nothing else |
| IDENTITY RESOLUTION | Which Principal and Employee is this? | `eos_policy.principals` primary columns OR an ACTIVE `eos_policy.principal_identities` row, then `employee_principal_links` |
| AUTHORIZATION | What may the Employee do? | The existing PostgreSQL system (Roles, capabilities, scopes, assignments, conditions). **Untouched.** |

Tokens carry **no roles and no capabilities**, and the verifier returns only
`{ externalSubject, identityProvider }`. That is the same `VerifiedIdentity` the Firebase verifier
returns, so no transport can tell which one produced it.

### Out of scope

The following are out of scope: SSO, SCIM, social login, MFA, a password product, federation,
generic impersonation, and any change to Employee, Job Role, Security Role, Functional Role,
capability resolution, scopes, assignment, ownership or workflow authority. How a *human* proves
identity to obtain an EOS token (the human front door) is a later decision. This foundation
supplies the token, verifier, binding and issuer primitives that front door will use.

## 2. What exists today (inspected at f53c0eaf)

- `functions/src/eosApi/server.ts`
  - `createFirebaseTokenVerifier(identityProvider)` lazily imports `firebase-admin` and takes
    only `decoded.uid`. It returns `{ externalSubject: uid, identityProvider }`.
  - `readServiceConfig` reads `EOS_ENVIRONMENT` and **refuses `production`/`prod`**: the service
    is nonprod-only. It also reads `EOS_IDENTITY_PROVIDER` (default `firebase`), `EOS_API_PORT`/`PORT`
    and `EOS_ALLOWED_ORIGINS`.
  - One `verifyToken` is injected into all six transports: Administration (`adminPolicyHttp`),
    Operations (`eosOpsHttp`, including the cycle-count, relocation, transfer, placement and
    serialized-asset command routes), Commercial, Workforce, CRM and Catalog. Each one passes
    `identity.identityProvider` and `identity.externalSubject` through unchanged.
- **Resolution.** Every transport reaches `resolvePrincipalContext` (directly, or through
  `resolveOperationalContext` / `resolveExperienceContext`). That calls
  `reader.getPrincipalBySubject(provider, subject)`, a single SELECT on
  `eos_policy.principals (identity_provider, external_subject)`. Migration 1757548800000 makes that
  pair UNIQUE (`principals_provider_subject_unique`) and indexes it (`principals_by_subject`).
- **L5 employment gate (DQ-007).** `contextForPrincipal` calls
  `reader.getLinkedEmployeeAccessFact(tenantId, principal.id)` and refuses
  `EMPLOYEE_NOT_ACCESS_ELIGIBLE` unless the linked Employee's PG status is ACTIVE or CONTRACTOR.
  It is keyed on the **Principal id**, so it is identity-provider-neutral by construction.
- `eos_policy.employee_principal_links` maps Principal id to Employee id, again provider-neutral.
- **Client token source.** `adminPolicyApiClient.currentIdToken()` returns
  `auth.currentUser.getIdToken()`. The catalog, operations, reorder, workforce and serialized-asset
  clients import it, commercial reaches it through a lazy seam, and `crmApiClient` read
  `auth.currentUser` directly. `AuthContext.jsx` is driven only by `onAuthStateChanged`.
- **Browser harness.** `deployedSession.mjs` loads a persona password through
  `scripts/sandboxCredentials.mjs` (SANDBOX_CREDENTIALS_FILE), exchanges it at Google Identity
  Toolkit and seeds Firebase's IndexedDB persistence record.
- **API harness.** `functions/_e2e.mjs` does the same password exchange, then calls **Firebase
  Functions callables** and reads Firestore with `firebase-admin` (ADC).
- **Personas.** `config/sandboxRoleIdentityRegistry.json` holds 16 canonical role keys. Each has a
  Firebase `uid` and an `expectedEmployeeId`.
- **Environment guards.** `config/environments.json` roles; `assertNonprodRuntime`
  (`EOS_ENVIRONMENT` must read exactly `nonprod`); `assertMeasurementTarget` (named environment,
  production refused by role and project id); Certification frozen by id.
- **Crypto.** Node 22 `crypto` signs and verifies Ed25519 natively (`crypto.sign(null, ...)`) and
  imports JWK/PKCS8/SPKI keys. `jose` and `jsonwebtoken` exist only transitively (through
  firebase-admin) and are **not** direct dependencies. This foundation adds **no dependency**.

## 3. Design constraints and how each is met

### (a) The token

It is a compact JWS: `base64url(header).base64url(payload).base64url(signature)`.

- Header: `{ "alg": "EdDSA", "typ": "JWT", "kid": "<kid>" }`. Only these three keys are accepted.
  A `jku`, `jwk`, `x5u`, `x5c` or `crit` header is refused, so a token can never name its own key.
- Claims, all required:

| Claim | Meaning |
|---|---|
| `iss` | The EOS issuer URL for the environment (`EOS_AUTH_ISSUER`) |
| `aud` | The EOS API for the environment (`EOS_AUTH_AUDIENCE`), a single string |
| `sub` | The EOS identity subject: the `external_subject` of an `eos` binding |
| `iat`, `exp` | Integer seconds. `exp - iat` must be at most **900 s (15 min)**, enforced by the verifier as well as the issuer |
| `nbf` | Optional. If present it must be at or before now plus skew |
| `jti` | 128-bit random, base64url |
| `env` | `"nonprod"` or `"production"` |

- There are **no roles, capabilities, tenant, employee or Principal id in the token.** The verifier
  refuses any payload that carries an authority-bearing claim (`roles`, `role`, `capabilities`,
  `permissions`, `scope`, `scp`, `tenantId`, `principalId`, `employeeId`, `securityRole`, `jobRole`,
  `admin`). A token that tries to state authority is refused rather than ignored.
- The verifier checks, in order:
  1. total length of at most 4096 bytes and exactly three strict-base64url segments;
  2. the header parses, `alg` is in the allow-list `["EdDSA"]` (`none`, `HS*`, `RS*` and `ES*` are
     refused), `typ` is `JWT`, `kid` is non-empty and in the keyset, and the kid's environment
     prefix matches the verifier's environment;
  3. the Ed25519 signature over the ASCII signing input;
  4. `iss` === configured, `aud` === configured, `env` === the verifier's environment;
  5. `exp` > now - skew, `iat` <= now + skew, `nbf` <= now + skew, and `exp - iat` in (0, 900];
  6. `sub` matches `^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$`, and `jti` is 16 to 128 characters.

  Skew is 30 s. Every failure is one refusal, `EosTokenError(code)`, which the transports turn into
  their existing `401 UNAUTHENTICATED`. No failure reason is echoed to the client.

### (b) Signing authority and secrets

The keys are Ed25519. The **private key exists only in the Render nonprod service environment.**
Verification keys come from the environment as a JSON keyset, which is what allows rotation.

**Render `eos-api-nonprod` environment (for the operator to set later, `sync: false`, NOT set by
this change and NOT declared in render.yaml):**

| Variable | Secret? | Format | Holder |
|---|---|---|---|
| `EOS_AUTH_SIGNING_KEY_NONPROD` | **SECRET** | Ed25519 private key: PKCS8 PEM (`-----BEGIN PRIVATE KEY-----`) **or** a private JWK JSON `{"kty":"OKP","crv":"Ed25519","x":"...","d":"..."}` | Render nonprod only |
| `EOS_AUTH_SIGNING_KID` | no | `nonprod-` + label, e.g. `nonprod-ed25519-2026-10`; must be a key of `EOS_AUTH_VERIFY_KEYS` | Render nonprod |
| `EOS_AUTH_VERIFY_KEYS` | no (public) | JSON object `{ "<kid>": {"kty":"OKP","crv":"Ed25519","x":"..."} , ... }`; every kid prefixed `nonprod-`; at most 4 keys | Render nonprod |
| `EOS_AUTH_ISSUER` | no | `https://eos-api-nonprod.onrender.com/auth` | Render nonprod |
| `EOS_AUTH_AUDIENCE` | no | `https://eos-api-nonprod.onrender.com` | Render nonprod |
| `EOS_PERSONA_ISSUER_CREDENTIAL_SHA256` | treat as secret | 64 lowercase hex: SHA-256 of the issuer credential below | Render nonprod only |

**Issuer credential (the second secret; see section 3(d)):**

| Name | Secret? | Format | Holder |
|---|---|---|---|
| `EOS_NONPROD_PERSONA_ISSUER_CREDENTIAL` | **SECRET** | at least 43 base64url characters (32 random bytes) | GitHub Actions secret (CI harnesses); the operator's local shell as `EOS_PERSONA_ISSUER_CREDENTIAL` for local runs. **Never in Render**, which holds only its SHA-256 |

Rules:

- **Key generation happens outside the repository**:
  `node -e "const c=require('crypto');const k=c.generateKeyPairSync('ed25519');console.log(JSON.stringify({priv:k.privateKey.export({format:'jwk'}),pub:k.publicKey.export({format:'jwk'})}))"`,
  run in an operator shell and pasted into Render. Nothing is committed, and nothing is printed by
  any EOS code path. Tests generate keys **in memory per run**.
- **Rotation.** Add the new public key to `EOS_AUTH_VERIFY_KEYS`, deploy, switch
  `EOS_AUTH_SIGNING_KEY_NONPROD`/`EOS_AUTH_SIGNING_KID`, deploy, then remove the old kid after
  15 minutes (the maximum token life).
- **Production and nonprod keys are isolated three ways.** They use different variables (the
  issuer reads only `EOS_AUTH_SIGNING_KEY_NONPROD`, and no production signing variable exists in this
  foundation). The kid prefix must equal the verifier environment. And there is a structural
  production refusal (below).
- **Production-mode verifier** (`environment: "production"`). This is a pure construct: the
  service itself still refuses to start in production. It
  - refuses at construction any keyset kid prefixed `nonprod-`, and any configured `iss`/`aud`
    containing `nonprod`;
  - refuses any token whose `env` is not `"production"`, whose kid is not `production-`-prefixed, or
    whose `iss`/`aud` contains `nonprod`, **even when the signature verifies under a key it
    trusts**. This is proved in the tests by handing a production verifier the very key that signed
    a nonprod token.
- **The client bundle never sees key material.** The client receives only a token. The dist build is
  scanned for `PRIVATE KEY`, `"d":` JWK members and the variable names.

### (c) Identity binding

Migration **`1764200000000_eos-principal-identities.sql`**, the new maximum. The previous maximum
on main is 1764129600000.

```sql
eos_policy.principal_identities (
  id                TEXT PRIMARY KEY,
  principal_id      TEXT NOT NULL REFERENCES eos_policy.principals(id),
  identity_provider TEXT NOT NULL CHECK (identity_provider = 'eos'),
  external_subject  TEXT NOT NULL CHECK (subject pattern, 3..128),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by        TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason            TEXT NOT NULL (non-blank),
  revoked_by, revoked_at, revoke_reason   (all set together, once)
  UNIQUE (identity_provider, external_subject)                 -- a subject is never reused, even after revocation
  UNIQUE (principal_id, identity_provider) WHERE status='active' -- one ACTIVE eos identity per Principal
)
```

- It is **tenant-independent, like `principals`.** Tenancy comes from membership, exactly as for
  the primary binding.
- Provider is **`eos` only**, never `firebase`. The existing `principals(identity_provider,
  external_subject)` columns are untouched and remain the primary Firebase binding.
- A trigger refuses a binding whose `(provider, subject)` is already some Principal's **primary**
  pair. The resolver also refuses if a primary and a binding ever disagree.
- The table is append-only: DELETE is refused, and the only permitted UPDATE is `active -> revoked`,
  once.
- The **down migration refuses while any binding row exists.**
- **ONE resolution function.** `resolvePrincipalByVerifiedIdentity(reader, provider, subject)` in
  `principalContext.ts`. `resolvePrincipalContext` (and therefore every transport) now calls it
  instead of `getPrincipalBySubject`:
  - the primary columns first (every Firebase request resolves exactly as before, with the same
    single query);
  - for provider `eos`, also an ACTIVE binding row. If both match *different* Principals, the
    request is refused as `UNKNOWN_PRINCIPAL` (fail closed, never pick one);
  - after that, `contextForPrincipal` runs unchanged: Principal status, membership, tenant, **the L5
    employment gate**, Roles, scopes and access version.
- **One Principal carries both identities.** There is no second Principal and no duplicate
  Employee, so every existing grant, assignment, scope and audit reference applies unchanged,
  because all of them key on the Principal id.
- **Governed commands.** Both live in `policyCommands.ts` and are gated
  `requireSecurityAdministrationCapability(actor, "assignRole")`, the same gate as
  `rebindPrincipalIdentity`. Each runs in one transaction, bumps the access version and appends
  one `audit_events` row with the actor, the target Principal and the before/after binding.
  - `bindPrincipalEosIdentity(repo, actor, { principalId, externalSubject, reason })` creates a
    binding. It refuses a target that is not an active member of the actor's tenant, a subject
    already bound or already a primary, a second active binding, or the actor binding itself.
    Re-stating an identical active binding is a silent no-op.
  - `revokePrincipalEosIdentity(repo, actor, { principalId, reason })` revokes a binding.
- **Operator CLI:** `functions/scripts/bindPrincipalEosIdentity.js`, modelled on
  `rebindPrincipalIdentity.js`. It requires `--environment`, refuses production by role and
  project id, requires `EOS_ENVIRONMENT=nonprod`, refuses frozen Certification, refuses unknown,
  authority-bearing and credential-bearing flags, reads the admin's Roles from PG, and defaults to a
  dry run. Its `--persona <key>` mode derives the Principal from the registry uid (the primary
  Firebase binding, used here only as a lookup key) and the subject from the persona key. `--persona` takes no `--principalId`: all 16 personas are bindable from the registry
  alone (the `reportingAnalyst` uid gap, D1, was corrected by this change per the Persona Foundation evidence P1). **It has
  not been run against nonprod.** That is the provisioning packet in section 6.

### (d) Nonprod persona issuance

- `issueNonprodPersonaSession({ personaKey, ... })` in `src/eosAuth/eosSessionIssuer.ts`:
  1. **Refuses unless `EOS_ENVIRONMENT === "nonprod"`** (code-level), and refuses unless a
     `nonprod-` signing key is configured. No production signing variable exists to fall back on.
  2. `personaKey` must be one of the **16 keys** in `NONPROD_PERSONA_KEYS`. A test pins that list to
     `config/sandboxRoleIdentityRegistry.json`, and the server never reads the registry at run time.
     Any other string is refused, so there is no subject parameter and no generic impersonation.
  3. The subject is the pure derivation `nonprod-persona.<personaKey>`.
  4. It resolves the Principal through **the same** `resolvePrincipalContext` a request uses, so an
     unbound, disabled, unmembered or employment-ineligible persona gets no session.
  5. It signs `{iss, aud, sub, iat, exp = iat + 900, jti, env: "nonprod"}`.
  6. It appends `audit_events` `issueNonprodPersonaSession` in the persona's tenant with
     **`actor_uid = the persona Principal id`**, `target_kind = "eosSession"`, `target_id = jti`,
     and `after = { personaKey, subject, expiresAt }`. The row never contains the token.
- It needs no password file, no Firebase Auth, no ADC and no credential discovery. The issuer
  module imports no Firebase or Google package (a static test enforces this).
- Every later request is resolved and audited as that Principal/Employee exactly as today, because
  the transports see a `VerifiedIdentity` like any other.

**WHO MAY CALL THE ISSUER: option (i) was chosen.** The endpoint is
`POST /auth/nonprod/persona-session`, body `{ "personaKey": "<key>" }`, header
`x-eos-persona-issuer-credential: <credential>`.

- It is **mounted only when** `EOS_ENVIRONMENT === "nonprod"`, and when the signing key, the
  verify keyset and `EOS_PERSONA_ISSUER_CREDENTIAL_SHA256` are all configured. Otherwise the path
  answers `404` exactly like any unknown route.
- Authentication compares `SHA-256(presented credential)` against the configured hash in
  **constant time** (`timingSafeEqual`). Render therefore holds only a hash, and the raw credential
  lives only where a harness runs. Credentials shorter than 43 characters are refused.
- CORS is not served. It is a machine-to-machine route, and browsers get no preflight answer.
- Responses: `200 { ok, token, tokenType: "Bearer", expiresAt, personaKey, principalId }` |
  `401 UNAUTHENTICATED` (missing or wrong credential) | `400 UNKNOWN_PERSONA` |
  `403 PERSONA_NOT_ELIGIBLE` (any `PrincipalContextError`, including unbound) | `503`. The token is
  never logged.

**Rationale and flag.** There are two alternatives, and both are worse. (ii-a) Hand the signing key
to CI and operators so they mint locally: that spreads the most sensitive key everywhere. (ii-b)
Let a Firebase-authenticated admin call the issuer: that adds Firebase responsibility, which the
Firebase retirement-only ruling forbids. Option (i) adds **one long-lived nonprod-only operator
secret** beyond the authorized signing key. Render holds only its hash, and it is scoped to minting
sessions for 16 synthetic nonprod personas.
**This new secret needs Controller confirmation** before any Render or GitHub secret is created.

### (e) Client and browser (additive)

- `field-ops-app-vite/src/auth/eosSession.js` imports no Firebase code. It reads
  `sessionStorage["eos.session.v1"]` (a raw token), decodes `exp`/`sub` **for expiry only** (the
  server is the verifier), and drops an expired or malformed token. It is **refused outright when
  the build's `APP_ENVIRONMENT.role === "production"`**.
- `adminPolicyApiClient.currentIdToken()` returns the EOS session token when one is present, and
  otherwise `auth.currentUser.getIdToken()` as before. Every `*ApiClient` already routes through
  it; `crmApiClient` was moved onto it.
- `AuthContext.jsx`: when an EOS session is present at mount, it treats the session as signed in.
  `user = { uid: <sub>, identitySource: "eos" }`, and identity is resolved from the EOS API
  (`resolveMyExperienceContext` gives `employeeId` and the Principal) instead of Firestore.
  `role` stays `null`: no frontend role map is derived. `logout` clears the EOS session and signs
  Firebase out. When there is no EOS session, the Firebase path is byte-for-byte the previous
  behaviour.
- **Harness entry.** `deployedSession.mjs` gains `issueEosPersonaSession(personaKey)`, which calls
  the issuer with `EOS_PERSONA_ISSUER_CREDENTIAL`, and `seedEosSession(page, origin, token)`, which
  writes `sessionStorage` through `addInitScript` before the app loads. `establishSession` uses the
  EOS path when `EOS_PERSONA_ISSUER_CREDENTIAL` is set and falls back to the Firebase path
  otherwise. **No SANDBOX_CREDENTIALS_FILE is needed.**
- **What still needs Firebase in the browser.** Screens that still read Firestore directly (the
  business-runtime baseline) do not work under an EOS-only session, because those reads need a
  Firebase user. EOS-API-served surfaces work. This gap is tracked by the Firebase exit baseline,
  not introduced here.

### (f) Firebase exit census

Firebase Authentication is reclassified from "kept after exit" to a **transitional ACTIVE
dependency pending retirement**:

- `docs/architecture/firebase-exit-manifest.json`: `classification.IDENTITY_ONLY` gains
  `exitStatus: "TRANSITIONAL_ACTIVE_PENDING_RETIREMENT"`, the ledger entry `FX-AUTH-001`, the
  replacement (this document) and the removal condition. Retirement needs separate authorization.
- `docs/architecture/firebase-exit-baseline.json`: `authority.firebaseAllowedAfterExit` becomes
  empty, and the transitional classification is recorded. The **file lists are unchanged**:
  frontend `firebase_auth` 2, server `firebase_auth` 3, server `firebase_admin_app` 2, **7 in
  total, no increase**. No new file imports Firebase: the new EOS modules and `eosSession.js` import
  none, and `AuthContext.jsx` was already in the list.

## 4. Proof map (tests)

| # | Proof | Test |
|---|---|---|
| 1 | EOS token accepted by the nonprod verifier and by the in-process EOS API | `eosAccessToken.test.mjs`, `eosIdentitySessionPostgres.test.mjs` |
| 2 | Firebase token still accepted (fake Firebase verifier through the composite seam, no network) | both |
| 3-6 | Bad issuer, bad audience, expired, malformed, bad signature, `alg:none`, unknown kid, over-long lifetime and authority claims are all refused | `eosAccessToken.test.mjs` |
| 7 | A nonprod token is refused by a production verifier that trusts the signing key; issuance refuses in production | `eosAccessToken.test.mjs`, `eosIdentitySessionPostgres.test.mjs` |
| 8, 9 | All 16 personas resolve to the right Principal and the right existing Employee through the EOS token | `eosIdentitySessionPostgres.test.mjs` |
| 10 | Identical authorization decisions on the EOS path and the Firebase path for the same Principal (capabilities, scoped holdings, experience surfaces, HTTP responses) | `eosIdentitySessionPostgres.test.mjs` |
| 11 | ON_LEAVE and TERMINATED are refused through the EOS path (L5 gate) | `eosIdentitySessionPostgres.test.mjs` |
| 12 | API harness runs without SANDBOX_CREDENTIALS_FILE | `eosIdentitySessionPostgres.test.mjs` (harness client against the in-process API) |
| 13 | Browser session is established without it | vitest `eosSession.test.js` / `AuthContext.eosSession.test.jsx`, plus the local Playwright run where feasible |
| 14 | Audit rows name the right Principal | `eosIdentitySessionPostgres.test.mjs` |
| 15 | No Firebase or Google package in the EOS path (static scan plus runtime probe) | `eosAuthNoFirebase.test.mjs` |
| 16 | No secrets in logs, source or the client bundle | `eosAuthNoFirebase.test.mjs`, dist scan |
| 17 | The census classifies Firebase Auth as transitional, with a count of 7 and no increase | `eosAuthNoFirebase.test.mjs` |

## 5. Harness consumers of SANDBOX_CREDENTIALS_FILE

- **Migrated to the EOS persona session:** `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/deployedSession.mjs`,
  which is used by the certify/gate instruments. It chooses the EOS path when the issuer credential
  is present.
- **Not migrated, and why:**
  - `functions/_e2e.mjs` drives **Firebase Functions callables** and reads Firestore via ADC. An EOS
    token cannot authenticate to a Firebase callable, and teaching callables to accept one would add
    Firebase responsibility. It retires with the callables.
  - The four `*NorthStarQuickGate.mjs` scripts, `serviceOperationsNorthStarGate.mjs`,
    `scripts/personaSweep.mjs` and the admin probes call Identity Toolkit themselves, then drive
    Firestore-backed screens. They are candidates once their screens are EOS-served.
  - Provisioning consumers (`sandboxPersonaBootstrap.js`, `seedSampleCompany.js`, the
    `sampleCompany/*Activation.js` scripts, `activateSandboxPersonas.js`,
    `seedTruckFleetFixtures.mjs`) and the frozen Certification consumers stay as they are, by
    ruling.

## 6. Deployment and cutover sequence (each step needs its own authorization)

1. **Merge** this branch after review. It is inert on deploy: without the new environment variables
   the composite verifier is Firebase-only, and the issuer route is not mounted. The
   `preDeployCommand` applies migration 1764200000000, which creates an empty table.
2. **Render secrets** (operator, `eos-api-nonprod`): generate an Ed25519 keypair offline, then set
   `EOS_AUTH_SIGNING_KEY_NONPROD`, `EOS_AUTH_SIGNING_KID`, `EOS_AUTH_VERIFY_KEYS`,
   `EOS_AUTH_ISSUER` and `EOS_AUTH_AUDIENCE`. Once the Controller confirms the issuer credential,
   generate the credential offline, put its SHA-256 in `EOS_PERSONA_ISSUER_CREDENTIAL_SHA256` and
   the raw value in the GitHub Actions secret `EOS_NONPROD_PERSONA_ISSUER_CREDENTIAL`.
3. **Health**: `/health` shows migration count +1. `POST /auth/nonprod/persona-session` without a
   credential returns 401.
4. **Binding provisioning packet** (nonprod, dry run first). For each of the 16 personas:
   `node scripts/bindPrincipalEosIdentity.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey <nonprod tenant key> --adminPrincipalId <admin> --persona <key> --reason "<names principal>" [--apply]`.
   The administering Principal cannot bind itself, so the administrator persona is bound by a
   different admin-capable Principal (owner or GM). Expect 16 bindings, 16 audit rows and 16
   access-version bumps, with no change to Roles, grants, scopes or Employees.
5. **Proof in nonprod**: issue one persona session per persona and call `resolveMyExperienceContext`.
   The `principalId` and `employeeId` must match the Firebase path for the same persona.
6. **Harness switch**: set `EOS_PERSONA_ISSUER_CREDENTIAL` in the CI job env for the browser
   harness. `establishSession` then uses the EOS path, and SANDBOX_CREDENTIALS_FILE is no longer
   needed for those runs.
7. **Later, under separate authorization**: the human front door, then Firebase Auth retirement
   (`FX-AUTH-001`).

## 7. Local proof results (2026-09-29, branch `identity/eos-session-foundation`)

All runs were local. Keys and credentials were generated in memory, the Firebase verifier was a
fake, and each PG run used a dedicated `idn_*` database on 127.0.0.1:55432, dropped afterwards.

| Suite | Result |
|---|---|
| `test/eosAccessToken.test.mjs` (1-7, config, resolution, persona keys) | 16/16 |
| `test/eosAuthNoFirebase.test.mjs` (15 static, 16 source, 17) | 4/4 |
| `test/eosIdentitySessionPostgres.test.mjs` (1, 2, 7-12, 14-16, CLI, DB fences, down-migration refusal) | 16/16; EOS-vs-Firebase matrix of 16 personas x 7 probes, 82 allowed and 30 refused, identical on both paths |
| vitest `test/eosSessionAuthContext.test.jsx` (13, client) | 8/8; the full vitest run is 3737 passed |
| Local browser (vite dev + Playwright + local EOS API + local PG, administrator persona) | Shell rendered and signed in through the EOS session. Every EOS API call carried the EOS token. Zero non-loopback hosts. Zero Firebase verifier calls |
| `npm run test:adminPolicy` (offline) | 1610 tests, 0 fail |
| `npm run test:governance` | 683/683 |
| `npm run test:platformQa` | 48/48 |
| `scripts/firebaseExitGuard.mjs --previous-baseline=<origin/main>`, and the shim ratchet | pass; 0 new |
| Targeted PG: `principalIdentityRebind`, `ownerIdentityBinding`, `employeeRuntimeReads`, `administrationControlPlaneSecurity`, `contextualActionAuthority`, `adminPolicyPostgres`, `sampleCompanyPostgres`, `administrationReadEnforcement` | all pass |

These pins moved because this change adds the migration and table: `migrationLedgerOrderGuard`
(71 runnable), `sampleCompanyPostgres` (last migration), `adminPolicyPostgres` (29 eos_policy
tables), `administrationReadEnforcement` (71 migrations), and `ownerIdentityBindingPostgres` (the
"no binding table" pin now admits the ruled, `eos`-only `principal_identities`).
