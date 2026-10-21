# Codex UAT handoff: independent browser and authorization test of EOS nonprod

> **#2201 IS MERGED (`96530fe3`) AND MUST BE NONPROD-VERIFIED before any run.** The persona harness target allowlist (registered nonprod endpoints only; caller config cannot widen the allowlist; the loopback test exception is test-only infrastructure; one guarded transport for every credential and token; browser login separate from issuer proof: results carry `proof: "login-mfa"` or `proof: "issuer-api"`) is a **prerequisite**. Until the controller confirms it is verified on nonprod and the version pin below includes it, **do not start any run that sends a credential, a password, an MFA code or a token anywhere.**
>
> Rows that depend on other unmerged PRs are marked `after #NNNN` in the manifest and are BLOCKED until the pin includes the merge: **#2200** (DWO: Work Order company boundary) and **#2199** (CLC: company-less record correction).
>
> **Codex's FIRST run is a Taylor-only BASELINE** (section 0). It starts as soon as #2201 is nonprod-verified. **Every Ventana case is BLOCKED** in the coverage report, with the reason "Ventana key not yet bound" (`../10-ventana-key-change-procedure.md`): never PASS, never FAIL.

Issued: 2026-10-21 (America/Phoenix) · Phase 2 update: 2026-10-21 (Owner decisions applied) · Repository pin at issue: `b433d396` (`origin/main`) · Authority: the Owner direction "Codex UAT" (2026-10-21). Claude stays the implementation controller and fixes **only** the defects Codex independently proves. Codex is the independent tester: it reports, it does not fix, it does not broaden any permission, and it does not trust the controller's own evidence.

## 0. The first run is a baseline

The first run covers, for each of the 16 personas: the **real UI**, **real MFA**, **business functionality** (the journeys each role exists for, on the existing Taylor records), **permissions** (every runnable manifest tier), and **active Firebase runtime dependencies** (a per-screen census of network requests to any Firebase or Google identity, Firestore, Cloud Functions or Hosting host; method, host, path without query, and status only; never headers, bodies or tokens). It produces ONE consolidated operational backlog. Classify every finding as exactly one of: **P0 security/data**, **P0 Firebase-exit**, **P0 workflow**, **P1 admin/config**, **P1 CI**, **P2**, **DEFERRED** (known and already tracked, such as Q-1 decline, DWO after #2200, CLC after #2199, or a row already in `../09-configuration-integrity-register.md`; record it, do not re-report it as new). The result template has the sections: a Firebase-runtime census and a missing-functionality section per role.

Scope of the baseline: Taylor only. The Taylor nonprod data exists (30 Opportunities, 17 Agreements, 13 Sales Orders, 77 Work Orders, 2 Invoices). The Ventana half, which needs the Ventana key bound and synthetic Ventana records, stays **BLOCKED (Ventana key not yet bound)**. The three existing Ventana intercompany receivables are protected and read-only. Accounts are shared customer records: readable across Taylor and Ventana with the existing Account authorization, never exposing the other company's Commercial or Finance records.

## 1. What is in this package

| File | Use |
|---|---|
| `expected-access-manifest.json` | Read-only, machine-readable EXPECTED access: ~13k rows `persona -> role(s) -> company -> object -> action/field -> allow / deny` (there are no UNDETERMINED rows after the Owner decisions), each with its governing source (capability key, role-object permission, or Owner ruling) in the top-level `sources` table, a `runStatus` and, where blocked, a `blockedBy` reason. Includes the separately tagged **pure-Administrator evidence** persona `administratorPure` (group `pure-admin`: the `admin` Role alone, OQ-11) and the `channel-boundary` tier (Retail vs National Accounts). Derived from governed authority, never from role names. |
| `role-inventory.md` | Deliverable A: all 55 Security Roles, the 16 personas, roles with no assignee, personas with no role. |
| `object-inventory.md` | Deliverable B: all Business Objects, fields, CRED, capabilities, pages, API operations, and the registered-vs-deployed reconciliation. |
| `effective-access-matrix.md` | Deliverable C: how EXPECTED is derived, headline views, configuration divergences, the decisions that change expectations after unmerged PRs. |
| `test-plan.md` | Deliverables D/E: per persona, positive and negative cases (Service, Sales Retail vs National Accounts, Inventory/Warehouse, Finance, Administration, Goals), search, related records, dashboards, reports, paired direct-API negatives, Taylor vs Ventana cases. |
| `codex-result-template.md` | What you must return, and the classification you must use. |
| `../05-ventana-fixture-plan.md`, `../tools/ventana-uat-fixture.mjs` | The synthetic Ventana fixtures. **The controller runs these before your cross-company pass.** You never run them. |
| `../06-coverage-denominators.md`, `../07-owner-questions.md`, `../data/*.csv` | Exact test counts; the Owner's 2026-10-21 decisions and how each was applied; flat data. |
| `../09-configuration-integrity-register.md` | Known grid-vs-capability divergences and other configuration findings (P1 admin/config; recorded, not failures; no automatic grants). |
| `../11-classification-tables.md` | Hidden built pages and unassigned Roles: purpose, users, ready or placeholder, proposal. Nothing is exposed or retired by it; hidden pages stay HIDDEN. |
| `../10-ventana-key-change-procedure.md` | The human-authorized procedure that binds the Ventana key. Until it is applied every Ventana case is BLOCKED. |
| `../tools/uatRouteCheck.mjs` | Offline check that every API path in the plan is a route the server dispatches (`/workforce/employees`, `/crm/customer`, `/commercial/sales`, `/operations/*`, `/admin/policy`). |

Regenerate nothing yourself. If a manifest row looks wrong, report it as a **manifest defect** with the evidence; do not edit the manifest.

## 2. Environment: nonprod EOS only

| Item | Value |
|---|---|
| Web app | `https://verenwardeos.vercel.app` |
| API | `https://eos-api-nonprod.onrender.com` |
| Tenant | the nonprod Taylor tenant (resolved from the Principal's membership; do not pass a tenant you were not given) |

**Never** use: production (`taylor-parts` hosting, GitHub Pages, any `taylor-parts` project), a real user's credentials, or any Firebase target. The old Firebase sandbox host (`eos-platform-sandbox.web.app`) is **disabled**; scripts that default to it (for example `field-ops-app-vite/scripts/personaSweep.mjs`, default `--target https://eos-platform-sandbox.web.app`) must be pointed at the nonprod web origin explicitly, and that script is **not suitable** for EOS login anyway (section 4.4).

### 2.1 Version pin check (before EVERY run; record both facts in every report)

1. **Web:** `GET https://verenwardeos.vercel.app/version.json`. A valid manifest is JSON with `commit`, `base`, `buildTime`, `schema`. Classify by **content, not status**: a missing `/version.json` returns HTTP 200 with `text/html` (SPA fallback); that means "no manifest" and the run is BLOCKED. Record `commit` and `buildTime`.
2. **API:** `GET https://eos-api-nonprod.onrender.com/health` (unauthenticated) returns `{ ok, environment, reachable, migrated, latencyMs, migrations }`. Record `environment` (must read `nonprod`), `reachable`, `migrated` and `migrations` (the applied-migration count). At the issue pin the repository has **118** migration files; the controller supplies the expected count for the pin you are testing.
3. **Agreement:** the web `commit` must equal the API's deployed commit. **`/health` does not report the API commit** at the issue pin, so the controller states the API's deployed commit in the run preamble (from the Render deploy record). If the preamble is missing, the pin is unproven: BLOCKED. Any mismatch between the web commit, the API commit, the controller's stated pin or the migration count is a **pin failure**: stop and report it; do not "test anyway".
4. Confirm the pin **includes #2201**, and (for the rows that need them) **#2200** and **#2199**. Rows with `dependsOn` run only when the pin includes the merge; otherwise they are BLOCKED (pending the PR), never FAIL.

## 3. Hard rules (non-negotiable)

1. **Every MFA-required persona:** assert that the password step returns `MFA_REQUIRED` **and** that the second factor completes. Both facts are evidence.
2. **A completed session without MFA for an MFA-required persona is a SECURITY FAILURE.** Record it (severity Critical). Never accept a password-only session as MFA proof.
3. Keep `loginEosPersona()` **API authentication** distinct from a real **Playwright browser login**. They are different proofs and go in different report sections.
4. **Browser UAT goes through the real EOS login and MFA screens.** The TOTP code is computed from the protected enrollment file and **typed into the UI**. Do not seed a session into a browser as a substitute for the login.
5. `EOS_PERSONA_ISSUER_CREDENTIAL` is for **nonprod direct-API authorization tests only**. Issuer sessions **never** count as login or MFA proof (section 6).
6. **Target safety.** Verify (#2201 is merged) that an explicit `baseUrl`, `EOS_API_BASE_URL` or `origin` override cannot point the harness at anything but a registered nonprod entry (test with a throwaway fake credential value and an unregistered URL; the expected result is a refusal that carries a code and the URL, **before** any request is sent). On a pin that lacks #2201 this is a known defect (section 5): do not run.
7. **Never expose** a password, a TOTP secret, a TOTP or recovery code, an access token, an MFA challenge value, or reusable session storage in logs, screenshots, traces, HAR files or reports (section 4.5 says how to configure Playwright so it cannot capture them).
8. **Do not search for credential files.** The operator sets `EOS_PERSONA_CREDENTIALS_FILE` explicitly. If it is unset, the persona is BLOCKED.
9. **Do not re-enroll** a persona with a missing or invalid MFA enrollment. Mark it **BLOCKED** and move on. Never run `functions/scripts/enrollPersonaLogins.js`.
10. **One isolated browser context per persona**, created fresh, closed at the end, no shared cookies or storage. Mutating personas run **sequentially**.
11. **After a successful MFA login, before any test:** verify the resolved Principal, Employee, Security Roles and company authority against the manifest persona entry (`personas[].login.expectedResolvedAfterLogin`). A mismatch stops that persona (BLOCKED) and is itself a finding.
12. After a successful MFA login, **run the full role x object positive and negative matrix** for that persona (every manifest tier whose `runStatus` is runnable). Report browser-login proof **separately** from API authority proof (two sections in `codex-result-template.md`).
13. **Do not broaden permissions, ever.** No grant, no role assignment, no company-access grant, no exemption-family grant. Authority changes are **preview only**. Do not create credentials, accounts, or enrollments. Do not alter another persona's data beyond what a test case states.
14. **Report discrepancies independently.** Do not reconcile your findings with the controller's before reporting; do not infer a permission to make a test pass.
15. **A foreign or condition-hidden record must be indistinguishable from a missing one.** Compare status, code, category and message for a foreign id and a random nonexistent id; any difference, or any echo of the foreign id, is a finding.

## 4. Credentials and sign-in (existing tooling only; names, never values)

### 4.1 Environment variables you need (set by the operator; you never discover or print them)

| Variable | Used for | Notes |
|---|---|---|
| `EOS_PERSONA_CREDENTIALS_FILE` | **Real sign-in** (password + MFA) for the browser and for `loginEosPersona()` | Absolute path, outside the repository, written by `functions/scripts/enrollPersonaLogins.js` (schema `eos.persona-login-credentials/1`, `entries[]` with `personaKey`, `state`, `loginIdentifier`, `password`, `totpSecretBase32`, `recoveryCodes`). Only entries with `state: "enrolled"` can sign in. |
| `EOS_PERSONA_ISSUER_CREDENTIAL` | **Direct-API authorization tests only** (the nonprod persona issuer) | Never login proof. |
| `EOS_API_BASE_URL` | Do **not** set. | Overrides are accepted only if they equal a registered nonprod entry (after #2201). Leave unset so the registered nonprod API is used. |

`SANDBOX_CREDENTIALS_FILE` is the **older, Firebase-era** credential source: `scripts/sandboxCredentials.mjs` reads `sandbox-credentials.local.json` (a table keyed by Job Role with an email and a password, no MFA secret) and `deployedSession.signInPersona` exchanges it at Google Identity Toolkit, i.e. a **Firebase target**. **Do not use it for EOS UAT.** Where an instruction elsewhere says to reuse `scripts/sandboxCredentials.mjs`, the Owner-verified tooling for EOS nonprod is `scripts/eosPersonaSession.mjs` and the enrollment file; the older loader would authenticate against Firebase, which this UAT must never touch. `*credentials.local.json` is gitignored (verified not tracked); keep every credential file outside the working tree.

### 4.2 Are the enrollment file and `SANDBOX_CREDENTIALS_FILE` the same file? (do not open either)

- **By environment:** compare the two variable values. If both resolve (`realpath`) to the same path they are the same file; do not assume. They are normally different files.
- **By code behaviour, with codes only:** `loginEosPersona(personaKey)` throws `NO_CREDENTIALS_FILE` (variable unset), `CREDENTIAL_FILE_INVALID` (not JSON, or no `entries` array: the Firebase-era table would fail here), `PERSONA_NOT_ENROLLED` (no `state: "enrolled"` entry for that key). `loadSandboxPersona` throws `CredentialAccessError` types (`FILE_NOT_FOUND`, `UNPARSEABLE`, ...). Run the preflight in 4.6; it prints persona keys and error codes only.
- If `EOS_PERSONA_CREDENTIALS_FILE` points at the Firebase-era table, every persona reports `PERSONA_NOT_ENROLLED`/`CREDENTIAL_FILE_INVALID`: report all as BLOCKED (credential source wrong) and stop.

### 4.3 How an EOS persona signs in (read from `scripts/eosPersonaSession.mjs`)

1. `POST {api}/auth/login` with `{ identifier, password }`, headers `origin: <registered web origin>` and `x-eos-csrf: 1`. A persona with an enrolled authenticator returns `{ ok: true, status: "MFA_REQUIRED", challenge }`.
2. `POST {api}/auth/login/mfa` with `{ challenge, code }`. The harness computes `code` locally as an **RFC 6238 TOTP** (HMAC-SHA1, 30-second step, six digits) from the enrolled base32 secret `entry.totpSecretBase32` using the exported `totpCode(secretBase32)`. The UI also accepts a **recovery code** (`{ recoveryCode }`); recovery codes are single-use, so **do not use them** for UAT; use TOTP. If TOTP is refused, record `MFA_CHALLENGE_INVALID`/`LOGIN_REFUSED` and mark the persona BLOCKED (clock skew is the usual cause: report the skew, do not retry in a loop).
3. The session is an EOS access token (`session.accessToken`, with `accessTokenExpiresAt`); the web app keeps it in `sessionStorage` key `eos.session.v1` (per tab). Never read, copy or log it.

### 4.4 What the existing tooling does and does not do today

| Tool | Does | Does not |
|---|---|---|
| `scripts/eosPersonaSession.mjs` `loginEosPersona` | Real password + TOTP sign-in over the API; returns a token for **API** calls | Drive a browser; it is API authentication |
| `scripts/eosPersonaSession.mjs` `issueEosPersonaSession`, `callEosApiAsPersona` | Mint/use an issuer session (`POST /auth/nonprod/persona-session`, header `x-eos-persona-issuer-credential`) for **API** authorization tests | Prove login or MFA |
| `.claude/skills/run-field-ops-app-vite/deployedSession.mjs` `openEosPersonaSession`, `seedEosSession` | Seed an issuer token into `sessionStorage` before the app boots | Prove login or MFA; it bypasses the login screens |
| `field-ops-app-vite/scripts/personaSweep.mjs` | Drives the **old** form (`input[type="email"]`, single step) with the Firebase-era loader | Work against the EOS login (different field, MFA step); defaults to the disabled web.app host. **Do not use.** |

**There is no committed Playwright helper that drives `EosLogin.jsx` with MFA.** That is the one precise gap. You write a thin driver in your own workspace (not in this repository's auth tooling, no new credential path): it reads the enrolled entry from `EOS_PERSONA_CREDENTIALS_FILE` **in-process only**, types the sign-in name and password into the real form, imports the exported `totpCode` to compute the code, and types it into the verification screen. The screens (from `field-ops-app-vite/src/auth/EosLogin.jsx`): step 1 labels **Sign-in name** and **Password**, button **Sign in**; step 2 title **Two-step verification**, label **Verification code**, button **Verify**.

### 4.5 Playwright configuration that cannot capture secrets

- `browser.newContext()` with **no** `storageState`, **no** `recordHar`, **no** `recordVideo`; never call `context.storageState()` or write cookies/storage to disk.
- **No Playwright trace** during or around login. If you need traces for later pages, start tracing only after the shell has rendered, with `screenshots: false, snapshots: false, sources: false`, and stop it before any navigation back to an auth screen; delete traces that were ever active on `/auth` requests.
- Screenshots: never take one on the sign-in or verification screens. Elsewhere, pass `mask` for `input[type=password]` and `input[autocomplete=one-time-code]`, and crop out any session/debug panel. Check each failure screenshot before attaching it.
- Do not attach `page.on('request'|'response')` loggers that print headers or bodies for `/auth/*`; if you log network at all, log method, path (without query), status only.
- Fill the password and code by passing the value straight from the in-process variable to `fill()`/`type()`; never put it in a log line, an exception message, a test name or a report. Clear the variables after use.
- Keep the process environment clean: do not echo `process.env`; do not run with debug flags that print environment or request headers.

### 4.6 Preflight (codes only; no secret is read into output)

Run this in a throwaway local script, not in a committed file. It prints persona keys and error codes; nothing else.

```js
import { loginEosPersona } from "<repo>/scripts/eosPersonaSession.mjs"; // after #2201 the target is allow-listed
const keys = ["ownerExecutive","administrator","generalManager","officeManager","serviceManager","dispatcher","serviceTechnician",
  "partsAssociate","partsManager","warehouseAssociate","warehouseManager","retailSales","nationalAccountsSales","financeAccounting","reportingAnalyst","generalEmployee"];
for (const k of keys) {
  try { await loginEosPersona(k); console.log(k, "API-LOGIN-OK"); }          // never print the returned token
  catch (e) { console.log(k, e.code ?? "ERROR"); }                          // codes only
}
```

`API-LOGIN-OK` shows that password and TOTP complete over the API; it is **not** the browser login proof (rule 3). Any other code: BLOCKED for that persona (rule 9).

## 5. Harness finding (fixed by #2201, merged as `96530fe3`) and what to verify on nonprod

### 5.1 The finding (read-only citation of the pre-fix code; it is the reason #2201 exists)

`scripts/eosPersonaSession.mjs`, function `eosApiBaseUrl` (lines 32-41): line 33 `if (baseUrl) return ...` and line 34 `if (env.EOS_API_BASE_URL) return ...` **return before** the production-role check at line 38 (`entry.role === "production"`), so an explicit override is never checked against production or against any allow-list. The `origin` override in `loginEosPersona` (line 143, `options.origin ?? ...`) is unchecked too. Both the password+MFA path and the issuer path call `eosApiBaseUrl`, so a mistyped override could send a password, an MFA code, the issuer credential or a token to an unintended host.

### 5.2 What #2201 changed (verify on the deployed pin, do not assume)

Registered nonprod endpoints only (exact, normalized comparison); caller config cannot widen the allowlist; API and origin must belong to the same registered environment; refusal **before** any secret leaves the process; no redirect out of the approved environment; one validator for both `loginEosPersona` and `issueEosPersonaSession`; results carry `proof: "login-mfa"` or `proof: "issuer-api"`. Record the checks you ran (a fake credential with an unregistered URL, a lookalike host, a production URL) and the refusal codes.

## 6. Why the issuer path is not login proof

`POST /auth/nonprod/persona-session` authenticates the **machine caller** by one shared issuer credential (header `x-eos-persona-issuer-credential`, verified by hash) and then mints a short-lived token for the **named persona** with **no password and no second factor**. It therefore proves only that the API's authorization behaves correctly for that Principal once a token exists. It bypasses: the password check, the MFA challenge and second-factor completion, lockout and rate limiting, the login audit/security events, the session cookie/CSRF handshake (`x-eos-csrf`), and the login and verification screens. A persona that "works" through the issuer says nothing about whether its login, its MFA enrollment or its MFA enforcement works. Label every issuer-derived result `proof: issuer-api` and keep it out of the browser-login section of the report.

## 7. Run order

1. Pin check (2.1) and #2201 confirmation. 2. Credential preflight (4.6) -> BLOCKED list. 3. **Login proof**, per persona in an isolated context: password -> `MFA_REQUIRED` -> TOTP -> shell; identity check (rule 11). 4. The persona's browser matrix (test plan section 2). 5. The paired direct-API negatives (test plan section 3), by `loginEosPersona()` token or issuer token, each labelled by proof type. 6. Firebase-runtime census and missing-functionality notes, recorded as you walk (test plan sections 7 and 8). 7. Report (`codex-result-template.md`). The Ventana half is NOT part of the baseline: it stays BLOCKED (Ventana key not yet bound); a later pass runs it only after the controller reports the key bound and the fixtures in place.

**API paths.** Direct-API calls go to the server's real routes only: `POST /workforce/employees`, `POST /crm/customer`, `POST /commercial/sales`, `POST /admin/policy`, and `POST /operations/<domain>` (`inventory`, `experience`, `cycle-count`, `relocation`, `transfer`, `placement`, `serialized-asset`, `work-orders`, `inbound-work`, `equipment`, `finance`, `rental`, `analysis`, `workspace`, `workflow`, `catalog`), each with body `{ "operation": "<name>", "input": { ... } }`. The bare prefixes `/workforce`, `/crm` and `/commercial` are NOT routes (phase 1 listed them by mistake; `tools/uatRouteCheck.mjs` now refuses them). A `UNKNOWN_OPERATION` from a path outside this list is a harness mistake, not a finding.

Persona order for mutating cases: run one persona at a time; finish and close its context before the next. Do not run two personas against the same record at once.

## 8. Classification and severity

Every test is exactly one of: **PASS** (observed equals expected), **FAIL** (observed differs from a determined expectation), **NOT CONFIGURED** (the record, fixture or enrollment the test needs does not exist), **BLOCKED** (cannot run: pin, credentials, MFA enrollment, unmerged PR, **Ventana key not yet bound** (every Ventana case; never PASS, never FAIL), identity mismatch), **NOT APPLICABLE** (no such act exists). Never count BLOCKED or NOT CONFIGURED as PASS.

Severity for FAIL and findings: **Critical** (MFA bypass; a refusal that leaks or writes; cross-company read or write; privilege escalation; a secret exposed), **High** (an unauthorized read of company, channel, or assignment-scoped data; an unauthorized mutation attempt that is accepted), **Medium** (missing legitimate access: a persona cannot do or see what the manifest says it must; UI offers a control the API refuses), **Low** (copy, ordering, cosmetic), **Info** (static findings confirmed, drift observed).
