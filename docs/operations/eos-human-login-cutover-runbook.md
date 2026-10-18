# EOS human login cutover (nonprod): operator runbook

**Batch:** Firebase exit B2 (identity and user administration) · **Issued:** 2026-10-17 (America/Phoenix) · **Scope:** NONPROD ONLY (`platform-sandbox`).
**Status:** PREPARED. **Credentialed execution is HELD until the Owner approves it.** Nothing in this document has been run, and no key, password, token or credential value exists in this repository, in chat or in any commit. Variable NAMES only.
**Completion level this reaches:** A, Firebase-free login. It is not "Firebase removed": business screens still owned by B1, B3 and B4 keep their Firebase dependencies and are blocked (section 9).

Architecture and security design: `docs/architecture/eos-native-identity.md` (login), `docs/architecture/eos-identity-session-foundation.md` (tokens, personas). Disposition of privileged approvals: `docs/governance/privileged-approvals-inventory-b2.md`.

## 1. What runs where (exact identifiers)

| Thing | Identifier |
|---|---|
| EOS API (Render web service) | `eos-api-nonprod`, service id `srv-dah49f1t0dsc73egpvi0`, `https://eos-api-nonprod.onrender.com`, health `GET /health` |
| EOS database (Render Postgres) | `eos-policy-nonprod`, database `eos_policy`. **Internal only** (`ipAllowList: []`): operator tools run in the **Render Shell on `eos-api-nonprod`**, never from a laptop |
| Frontend (Vercel) | project `verenwardeos`, stable domain `https://verenwardeos.vercel.app` (the only origin the API admits: `EOS_ALLOWED_ORIGINS`) |
| Build environment id | `platform-sandbox` (`VITE_ENVIRONMENT_ID`), `config/environments.json` |
| Firebase project (identity provider being left) | `eos-platform-sandbox`. Touched only by steps 1 and 6, read only. Hosting site `eos-platform-sandbox.web.app` is not changed |
| Tenant key | the sandbox tenant key (read it from `render.yaml` / `bootstrapEosTenant.mjs`; not repeated here) |

Merging B2 deploys code only. It sets nothing: the Vercel build keeps the Firebase sign-in until `VITE_AUTH_SOURCE=eos` is set, and the API keeps verifying Firebase until `EOS_AUTH_FIREBASE_VERIFIER=disabled` is set.

## 2. Variable names (values live only in the operator's secure store and the two dashboards)

**Render, `eos-api-nonprod`** (secrets marked S; set them as Render secret environment variables in the dashboard, never by command-line argument):

| Name | S | Purpose |
|---|---|---|
| `EOS_AUTH_VERIFY_KEYS` | | public JWK set `{ "<kid>": <public JWK> }`; every kid starts `nonprod-` |
| `EOS_AUTH_ISSUER` | | `https://eos-api-nonprod.onrender.com/auth` |
| `EOS_AUTH_AUDIENCE` | | `https://eos-api-nonprod.onrender.com` |
| `EOS_AUTH_SIGNING_KEY_NONPROD` | S | Ed25519 private JWK: signs access tokens |
| `EOS_AUTH_SIGNING_KID` | | the kid of that key (must be in `EOS_AUTH_VERIFY_KEYS`) |
| `EOS_AUTH_FACTOR_KEYS` | S | JSON `{ "<id>": "<base64url, 32 bytes>" }`: seals authenticator secrets, peppers recovery codes |
| `EOS_AUTH_FACTOR_KEY_ID` | | the id new secrets are sealed under |
| `EOS_HUMAN_LOGIN` | | `enabled` mounts `/auth/login` and friends |
| `EOS_AUTH_COOKIE_SAMESITE` | | `None` while the app and API are on different registrable domains; `Strict` after the `verenward.com` same-site plan (`eos-native-identity.md` 9a) |
| `EOS_AUTH_TRUSTED_PROXY_HOPS` | | `0`..`3`; the client address keys the login rate limit. Confirm by the section 9b measurement; expected `1` |
| `EOS_AUTH_CLIENT_IP_HEADER` | | optional `true-client-ip`; preferred once measured |
| `EOS_AUTH_MULTI_TENANT_SESSIONS` | | leave unset (disabled) |
| `EOS_PERSONA_ISSUER_CREDENTIAL_SHA256` | | SHA-256 (hex) of the persona-issuer credential; only the hash is ever stored. Leave as is if already set |
| **`EOS_AUTH_FIREBASE_VERIFIER`** | | **new (B2).** `disabled` turns the Firebase `verifyIdToken` fallback off. Unset or `enabled` = today. Refused unless human login is enabled |

Already present and not touched: `EOS_ENVIRONMENT=nonprod`, `DATABASE_URL`, `EOS_ALLOWED_ORIGINS`, `GOOGLE_CLOUD_PROJECT`.

**Vercel, project `verenwardeos`:** `VITE_ENVIRONMENT_ID` (`platform-sandbox`, present), `VITE_EOS_API_BASE_URL` (present), **`VITE_AUTH_SOURCE=eos`** (new, B2: the EOS-only sign-in build). `VITE_EOS_HUMAN_LOGIN` is not needed by that build. No Firebase variable exists or is added.

**Operator shell only:** `EOS_FIREBASE_OPERATOR_ACCESS_TOKEN` (a short-lived Google token minted outside the application, exported for one Render Shell session, steps 1 and 6 only); `EOS_PERSONA_CREDENTIALS_FILE` (a path, for the persona harness).

## 3. Flag order (each step is separately confirmed; stop and roll back on any failed check)

| # | Step | Reversible by |
|---|---|---|
| 0 | B2 merged and deployed; Owner approval of this runbook recorded | n/a |
| 1 | Preflight, read only: privileged-approval census must be 0 (section 4) | n/a |
| 2 | Generate keys offline (section 5) | discard |
| 3 | Render: set the `EOS_AUTH_*` variables and `EOS_HUMAN_LOGIN=enabled`; leave `EOS_AUTH_FIREBASE_VERIFIER` unset; deploy | unset `EOS_HUMAN_LOGIN`, redeploy |
| 4 | Validate the API (section 7, V1 and V2) | as step 3 |
| 5 | Enroll the 16 synthetic personas (section 6) | disable a persona login in Administration |
| 6 | ACTOR-NAME-1: populate Principal display names (section 6) | none needed: labels only; a name can be restated |
| 7 | Vercel: set `VITE_AUTH_SOURCE=eos`, redeploy | unset it, redeploy |
| 8 | **Early Firebase-blocked smoke** (section 7, V3 and V4) | step 7's rollback |
| 9 | Render: set `EOS_AUTH_FIREBASE_VERIFIER=disabled`, redeploy | set `enabled` or delete it |
| 10 | Re-run the smoke and read the verifier metric (V5 to V7) | step 9's rollback |

Real people do not get passwords from this runbook. **Re-enrollment of real users (D-9) is the Owner's process**: an administrator creates a sign-in in Administration, hands over the one-time setup code, and the person chooses their own password. No one sets a real person's credentials for them.

## 4. Step 1: preflight (read only)

1. **Privileged approvals: the PA-1 gate.** The reachability proof is `privileged-approvals-inventory-b2.md` (section 4). Its result: every change that needs approval in Firebase (grant or revoke of `owner` or `admin`) is controlled on EOS by authority rules at the cited `policyCommands.ts` lines (the Owner is refused outright; Administrator staffing is Owner-or-Administrator only, never self, audited; the Owner's ruling #223), no product workflow creates a request, and the queue is preserved in every Firebase-sign-in build. **The one cutover blocker is the live count.** On `eos-api-nonprod` (Render Shell), with `EOS_FIREBASE_OPERATOR_ACCESS_TOKEN` exported for this session only: run `node scripts/roleAssignmentCensusCli.js` per its header (read-only, sandbox project named explicitly). Record `privilegedRoleRequests.pendingApproval`.
   - **0:** the blocker is cleared; continue. (Zero is necessary, not sufficient: the sufficiency proof is the inventory document. Decided requests stay in Firestore as history; nothing is deleted.)
   - **Above 0:** stop. Decide each pending request in a Firebase-sign-in build (Administration, Roles and Permissions, Approval requests) or reject it, re-count, then continue.
   - Also record, from a Functions list (operator), whether `requestPrivilegedRole`, `decidePrivilegedRoleRequest` and `listPrivilegedRoleRequests` are deployed in each Firebase project. It does not block this cutover; it is item 10 of the proof.
2. `curl -s https://eos-api-nonprod.onrender.com/health`: `ok: true`, `migrated: true`. **`/health` carries no authentication detail** (Owner ruling MET-1); the verifier mode and counters are read in step 4 with an administrator EOS session, after the front door is on (they need one).
3. Confirm which of section 2's variables already exist (Render dashboard). Set only what is missing; never overwrite a signing key or a factor key that live sessions or factors depend on.

## 5. Step 2: generate and store the secrets (offline, operator custody)

Do this on the operator's own machine. Nothing here echoes a secret; each command writes a file, created exclusively, mode 0600, inside your secure store directory (`$SECURE`). Never paste any file's contents into chat, a ticket, a commit or a terminal log.

```
# Ed25519 signing key (kid is public; choose a dated label):
node -e "const c=require('crypto'),fs=require('fs');const k=c.generateKeyPairSync('ed25519');fs.writeFileSync(process.argv[2],JSON.stringify({kid:process.argv[1],priv:k.privateKey.export({format:'jwk'}),pub:k.publicKey.export({format:'jwk'})}),{flag:'wx',mode:0o600})" nonprod-ed25519-YYYY-MM "$SECURE/eos-signing-nonprod-ed25519-YYYY-MM.json"

# Factor key (32 random bytes, base64url):
node -e "const c=require('crypto'),fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({f1:c.randomBytes(32).toString('base64url')}),{flag:'wx',mode:0o600})" "$SECURE/eos-factor-keys.json"
```

Storage and copying:
- `EOS_AUTH_SIGNING_KEY_NONPROD` = the `priv` object; `EOS_AUTH_VERIFY_KEYS` = `{ "<kid>": <pub> }`; `EOS_AUTH_SIGNING_KID` = the `kid`; `EOS_AUTH_FACTOR_KEYS` = the whole factor file; `EOS_AUTH_FACTOR_KEY_ID` = `f1`.
- Copy each value from the file into the Render dashboard field, mark the secret ones as secret, then clear the clipboard. Keep the files: **losing the factor key makes every enrolled authenticator unusable** (`MFA_KEY_UNAVAILABLE`, fail closed) until accounts are re-enrolled.
- Rotation without downtime is in `eos-native-identity.md` section 4. Drop an old factor key only when `factorKeyCensus()` shows zero live material under it.

## 6. Steps 5 and 6: tooling run in the Render Shell on `eos-api-nonprod`

All tools default to a **dry run**, require `--environment platform-sandbox`, refuse production by role and project, require `EOS_ENVIRONMENT=nonprod`, take the database from the NAMED variable, and accept no credential argument.

**Persona enrollment (`functions/scripts/enrollPersonaLogins.js`).**
```
node scripts/enrollPersonaLogins.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey <key> \
  --personas all --reason "<at least 40 characters naming the purpose>" --operator "<your name or handle>"   # dry run: PLANNED / SKIPPED_EXISTS / REFUSED
node scripts/enrollPersonaLogins.js ... --apply --credentialsOut /tmp/eos-persona-credentials.json
```
- `--operator` is required. It is appended to every enrollment's recorded reason (`<reason> [<personaKey>] by <operator>`), so the audit trail says who ran it; the composed reason is capped at 470 characters. The credentials directory is checked on its REAL path (a symlink cannot put the file inside the repository), and it must already exist.
- It adds, per persona, a login account bound to the persona's **own existing** EOS binding, an scrypt password, an active authenticator and ten recovery codes. The Principal id, the `(firebase, uid)` alias, Roles, scopes, membership and Employee link do not move, and the persona issuer keeps working as the machine path. A persona that already has a login is **skipped**, never reset. It stops at the first failure.
- The password, authenticator secret and recovery codes are generated by the tool and written **only** to `--credentialsOut` (absolute path outside the repository, created exclusively, 0600, written before each enrollment commits). They are never printed.
- **Getting the file out of the shell** is the weakest point of running in the Render Shell. Encrypt before it leaves, with a passphrase typed at the prompt (never an argument), copy the base64 text, decrypt on your machine, then destroy the shell copy:
  ```
  openssl enc -aes-256-cbc -pbkdf2 -salt -in /tmp/eos-persona-credentials.json | base64 -w0
  shred -u /tmp/eos-persona-credentials.json
  ```
  Store the decrypted file in the secure store (or the existing sandbox-credentials mechanism, `scripts/sandboxCredentials.mjs`, which this change leaves read-only). Point the harness at it with `EOS_PERSONA_CREDENTIALS_FILE`.

**Employee enrollment, step 5 addendum (B2-x; `--employees` on the same tool).** Owner direction 2026-10-18: every nonprod employee who is not Inactive can sign in to EOS. The persona set above covers 16; this covers the scaled sample workforce (`np-taylor-*`) and the synthetic workforce (`synthetic-np-emp-*`). Run from `/opt/render/project/src/functions` in the `eos-api-nonprod` shell, dry run first, and read the plan before `--apply`:
```
node scripts/enrollPersonaLogins.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod \
  --employees all-missing --adminPrincipalId <administrator principal id> \
  --reason "<at least 40 characters naming the purpose>" --operator "<your name or handle>"   # dry run: PLANNED / SKIPPED_EXISTS / SKIPPED_EXCLUDED / REFUSED
node scripts/enrollPersonaLogins.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod \
  --employees all-missing --adminPrincipalId <administrator principal id> \
  --reason "<at least 40 characters naming the purpose>" --operator "<your name or handle>" \
  --apply --credentialsOut /tmp/eos-employee-credentials.json
```
`--employees` also takes a comma-separated list of ids instead of `all-missing`. Same file schema as the persona run (`eos.persona-login-credentials/1`, `personaKey` = the Employee id), the same encrypt-and-shred handling, and the same fences (named nonprod target, dry run default, no credential flag, file outside the repository, created exclusively with mode 0600, written before each enrollment commits, never reset or replaced, stop at the first failure). In addition:
- **Who.** Only ids prefixed `np-taylor-` or `synthetic-np-emp-`. The login name is the Employee's own `work_email`, which must be a reserved `*.invalid` address (missing, malformed, or any other domain is `REFUSED`). Status must be ACTIVE, CONTRACTOR or ON_LEAVE; an INACTIVE, TERMINATED or RETIRED Employee, or one with a separation date, is `REFUSED` when named and `SKIPPED_EXCLUDED` under `all-missing`. An ON_LEAVE Employee is enrolled but cannot sign in until ACTIVE (the access gate is not widened); the plan marks it with `signInNote`.
- **What it adds** per Employee: a human EOS identity (`user.<hex>`, the one Administration > Users "Create sign-in" mints) on the Employee's linked Principal, and a login account on it with a password, an active authenticator and ten recovery codes. The Principal id, its primary identity (`nonprod-sample.*` or `eos-synthetic-nonprod`), Roles, scopes, membership and Employee link do not move. A Principal that already holds an EOS identity (a persona's, or any human one) is never displaced (`REFUSED` when named, `SKIPPED_EXCLUDED` under `all-missing`); a live login is `SKIPPED_EXISTS`; a login someone **retired** (for the Principal or the login name) is never re-created (`LOGIN_RETIRED`); an Owner or Administrator Principal is never enrolled (`PRINCIPAL_IS_OWNER_OR_ADMINISTRATOR`). The last three are `REFUSED` when named and `SKIPPED_EXCLUDED` under `all-missing`, and the service enforces them again, so the dry run shows what the apply will do. The service also requires the login name to equal the Employee's `work_email` and records `--adminPrincipalId` as `assertedBy` in the audit event.
- **No Principal.** A `synthetic-np-emp-*` Employee with no Principal gets one through the existing governed path only: `ensureTenantPrincipal` (provider `eos-synthetic-nonprod`, subject `synthetic-np-principal-<id minus prefix>`, ACTIVE membership, no Security Role, no display name) and `establishLink` (`OPERATOR_ASSERTED`, asserted by `--adminPrincipalId` with the composed reason), exactly as the synthetic workforce seed does; each writes its own audit or assertion record, and the enrollment writes `enrollEmployeeLogin`. `--adminPrincipalId` is resolved as a request would be (qualifying, non-future, non-stale assignments only) and must hold `admin.roleAssignment.write`, the capability `ensureTenantPrincipal` itself requires; a General Manager or an administrator whose assignment has lapsed is refused at plan time. An `np-taylor-*` Employee with no Principal is `REFUSED`: the sample seed owns those. The new Principal has no display name until `populatePrincipalDisplayNames.js` (`enteredNames`) names it.
- **Not one transaction per Employee.** The Principal, the link and the enrollment are three separate commits (the enrollment itself is one transaction: identity, account, factor, recovery codes, audit). Each step is idempotent, so a failure part-way leaves a state the next run resumes from; the credential file entry is written before the first of them.
- **Re-running** after a partial failure is safe: a Principal that exists is found by its subject, a link that exists is not re-asserted, and every enrolled Employee is `SKIPPED_EXISTS`.

**ACTOR-NAME-1 (`functions/scripts/populatePrincipalDisplayNames.js`).** Names come from exactly two sources and are never inferred from an email address or copied from an Employee.
```
# the identity provider's verified profile name (needs EOS_FIREBASE_OPERATOR_ACCESS_TOKEN for this one session):
node scripts/populatePrincipalDisplayNames.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey <key> \
  --adminPrincipalId <administrator principal id> --source firebaseProfile --reason "<at least 40 characters>"
# the administration-entered names for the 16 synthetic personas (a JSON file { "<personaKey>": "<name>" } the Owner supplies):
node scripts/populatePrincipalDisplayNames.js ... --source enteredNames --namesFile /tmp/persona-names.json
# add --apply to write after reading the plan
```
The report lists every **unresolved** Principal (id, provider, subject, reason: no profile name, not a provider account, name rejected, **duplicate name**) for correction. A Principal that already has a name is left alone.

**The provider profile name is provider-held and operator-reviewed, not independently verified:** the account holder can edit it. So **the dry run is mandatory and its plan must be read, name by name, before `--apply`** (never run `--apply` first). A name that duplicates another Principal's in the tenant, in any letter case, is not applied (`NAME_DUPLICATE`, every collider listed) and the command refuses it again at write time; resolve those by hand with an Administration-entered name.

## 7. Validation checks (record the evidence under `D:/eos-lanes/lane-firebase/`)

| Id | Check | Pass |
|---|---|---|
| V1 | `GET /health` (public: no authentication detail) and, with an administrator EOS bearer, `POST /admin/policy` `{"operation":"readAuthVerifierDiagnostics","input":{}}` | `/health`: `ok`, `migrated`, **no `auth` key**. Diagnostics: `data.firebaseVerifier` as set. Obtain the bearer with `loginEosPersona("administrator")` (`scripts/eosPersonaSession.mjs`) once the persona is enrolled, or a Firebase administrator bearer while the Firebase verifier is still enabled. The read needs `admin.securityPolicy.read`; a principal without it gets `403` and no count. |
| V2 | `POST /auth/login` with `Origin: https://verenwardeos.vercel.app`, `X-EOS-CSRF: 1`, a bogus identifier | `401 LOGIN_REFUSED` (a `404` means `EOS_HUMAN_LOGIN` is not on) |
| V3 | Persona sign-in, API: `loginEosPersona("<key>")` from `scripts/eosPersonaSession.mjs`, then `POST /operations/experience` | `200`, the persona's usual Principal id |
| V4 | Browser, EOS-only build, with `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `firestore.googleapis.com`, `www.googleapis.com` and `*.cloudfunctions.net` **blocked at the network**: sign in as a persona (password, then authenticator), reload (cookie refresh), sign out | signed in and out; **0** requests to those hosts on the sign-in path; the already-migrated workflows load |
| V5 | After step 9: a Firebase bearer to `/admin/policy` | `401`; the diagnostics read (administrator EOS bearer, V1) shows `refused.firebase_disabled` rising and `verified.firebase` not |
| V6 | The verifier counters over the smoke, read as in V1 | `verified.eos_human` rises with each persona session; `verified.firebase` flat since step 9 (`since` shows the window). Take one reading before and one after; compare, do not rely on absolutes |
| V7 | Administration, Users, one synthetic Employee: create sign-in, setup code, status disable and enable, reset code, sign out everywhere, Change History | each works and is audited; the page never says "Firebase" |

**The smoke reports two separate results.** (1) Authentication passes without Firebase. (2) Business workflows still blocked, listed against their batch (section 9). The auth proof never claims the app is Firebase-independent.

## 8. Rollback (any step)

- **Browser:** unset `VITE_AUTH_SOURCE` in Vercel and redeploy. The ordinary Firebase sign-in build returns; Firebase accounts were never touched.
- **API verifier:** set `EOS_AUTH_FIREBASE_VERIFIER=enabled` (or delete it) and redeploy. Firebase bearers verify again; no data changed.
- **Login:** `EOS_HUMAN_LOGIN=disabled` (or unset, with the factor and cookie variables) turns the front door back into a 404.
- **A persona:** disable its login in Administration (Roles and Access, EOS Sign-in). A persona login is disabled, never removed (its binding belongs to the persona model); the persona issuer is unaffected.
- **Keys:** a leaked signing key is replaced per `eos-native-identity.md` section 4; every session then ends at its next refresh.
- Production is never involved: every tool and flag above refuses a production environment.

## 9. After the cutover: what is still Firebase in business screens, by owning batch

The EOS-only build has **no Firebase config**, so these screens cannot reach Firebase and fail through their existing error paths. They are recorded as "blocked by known unmigrated dependencies", not as working.

| Batch | Remaining Firebase client use |
|---|---|
| B1 Financials | `services/financeReadCallableClient.js` (`listFinancialFacts`), the Financials screens' `hooks/useEmployeeDirectory.js` Firestore directory |
| B3 Warehouse and receiving | `services/receivingCallableClient.js`, `services/binCommandClient.js`, `hooks/useInventoryActions.js` (frozen `inventory_actions` notes), `fetchWarehouses` (`services/operationsQueries.ts`) |
| B4 Records and reporting | `access/importedServiceHistorySource.js`, `access/dataImportClient.js`, `domain/reporting/reportExecutionSeam.js`, `domain/reporting/savedReportService.js`, `services/performanceGoalClient.js` |
| Production-only (no EOS API there) | `auth/employeeSession.js`, `access/useReportCapabilities.js`, `hooks/useCurrentTechnician.js` |
| Preserved (proof in `privileged-approvals-inventory-b2.md`; gated on the step 1 census) | `services/privilegedApprovalClient.js` (PA-1) |
| Held, with a named decision | the legacy Change History callable `listRecordChangeHistory` (LT-1) |

## 10. Residual risks the operator should know

- **Cross-site cookie.** Until the same-site domain plan is executed, the refresh cookie is third-party (`SameSite=None; Partitioned`). Browsers that block third-party cookies still sign in, but a reload asks again. Not a security gap; an experience gap.
- **Persona issuer.** The machine route stays available beside the persona password login, so disabling a persona's login does not end a persona-issuer token (900 s at most). Removing the route is unsetting `EOS_PERSONA_ISSUER_CREDENTIAL_SHA256`, after the harnesses use `loginEosPersona`.
- **The credentials file** is the only place the generated persona secrets exist. Treat it like a signing key; destroy the shell copy.
- **Counter scope.** The diagnostics counters are per process since `since`; a restart resets them. They are counts and the verifier mode only, never a token, identity or key, and they are readable only by an administrator (`admin.securityPolicy.read`), not on `/health`.
