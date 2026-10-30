# Firebase retirement audit: source and deployed (2026-10-21)

**Status:** READ-ONLY EVIDENCE RECORD (Lane E). No code, config, grant, Firebase service, Render or Vercel setting was changed. The only network activity was `GET` requests for public static web assets of the nonprod frontend. Nothing is merged.
**Issued:** 2026-10-21 (America/Phoenix) · **Base:** `origin/main` `96530fe3` (the frozen nonprod pin) · **Deployed nonprod web build inspected:** `/version.json` = commit `203fcc0`, `environmentId: platform-sandbox`, `buildTime 2026-10-21T15:40:35Z`. `203fcc0e` is the parent of `96530fe3`; `96530fe3` (#2201) changed only the persona harness, so the two have the same client code.
**Builds on:** `docs/firebase-exit/firebase-dependency-reconciliation-2026-10-20.md` (section 3 reused, not rediscovered; sections 4 to 6 cited for the server and deletion order) and PR #2205 (open, not merged; head `90b979db`; CI checks read at that time: all listed checks pass, two admin-policy jobs skipped).

"Absence of network traffic is not proof" is honoured: every statement below is about code, the import graph, or the bytes of the shipped artifact. Where a number is derived rather than measured on the deployed artifact, it says so.

---

## 0. Metrics (the four required)

| # | Metric | Value | Basis |
|---|---|---|---|
| M1 | **Client Firebase imports remaining vs removed by #2205** | Source today: **26 import sites in 19 files** import `firebase/*` (23 static `from` + 3 dynamic `import("firebase/functions")`), plus **1** file that reaches Firebase only through the shim (`services/adminPolicyApiClient.js`). **#2205 removes 0 source imports** (it edits no `src/` file). In the **EOS build artifact** it removes **all 20 files' SDK code**: after #2205 the EOS bundle contains 0 SDK specifiers (all four are aliased to a fail-closed stand-in). | `node docs/firebase-exit/reconcile-firebase-deps.mjs` (19 + 1); grep of `src/` (26 sites); PR #2205 diff |
| M2 | **EOS API-server Firebase imports** | **1** file on the runtime import graph names `firebase-admin`: `functions/src/eosApi/server.ts:180`, a lazy `await import("firebase-admin")` inside `createFirebaseTokenVerifier`. **0** files name `firebase-functions`. **0** files on the graph load Firestore or a Google sign-in/identity endpoint. The graph is 341 files; its only non-Node external packages are `pg`, `firebase-admin` (that 1 site) and `@google-cloud/secret-manager` (not Firebase; section 3). | Own graph walk from `server.ts` (section 3), cross-checked with the reconciliation script (`eosApi-only: 1`, `callable+eosApi: 0`) |
| M3 | **Deployed-bundle Firebase byte presence (before #2205)** | **2 of 217** shipped files carry Firebase SDK code: `index-DBSdatdM.js` (**1,456,153 bytes**, the entry chunk) and `index.esm-BB1_G5S-.js` (**27,093 bytes**, `@firebase/app`). **1,483,246 bytes** are in files that contain the SDK, **39.3%** of the 3,777,379 JS bytes, **36.7%** of the 4,046,901 total asset bytes. The SDK itself is **about 547.5 kB (14.5% of JS)**, derived from #2205's local before/after total JS (3,787,326 to 3,239,788); the deployed `.map` is not served (HTTP 403), so the SDK's exact deployed size is not directly measured. Google hosts present in the entry chunk: 5 (section 4). Firebase project identity (`AIza...` apiKey): **0 occurrences**. | Section 4 |
| M4 | **Authority map coverage** | **5 of 5** areas (identity, permissions, data access, workflows, audit) have a named EOS-owned component serving them in the EOS build, with file evidence (section 5). **0 of 5** are served by Firebase at runtime in the EOS build today (handles are null). **9 capability families** still have no complete EOS equivalent (3 BUILD-FIRST, 6 HELD; section 6), so for those the EOS build fails closed rather than serving the capability. | Section 5 and 6; reconciliation section 4 |

---

## 1. Method

All commands are read-only. Scripts were run from the scratchpad, not committed.

1. Client: `node docs/firebase-exit/reconcile-firebase-deps.mjs`; grep of `field-ops-app-vite/src` for `from "firebase/..."`, `import("firebase/...")`, `initializeApp|getAuth|getFirestore|getFunctions|connect*Emulator`; reading `vite.config.js`, `config/environments.json`, `src/firebase/firebase.js`, `firebaseAbsent.js`. A small regex import-graph walk from `src/main.jsx` classes each file STATIC (reached by static imports) or LAZY (only through `import()`).
2. API: a regex import-graph walk (relative `import`, `export ... from`, dynamic `import()`, `require()`; `import type` excluded) from `functions/src/eosApi/server.ts`, listing every non-relative specifier reached. 341 files reached, 0 unresolved relative imports.
3. Deployed bundle: `GET /version.json`, `GET /`, then every `/assets/*.js|css` reference found in the HTML and, transitively, in each chunk (static and lazy). 217 real files. Vercel answers HTTP 200 + `index.html` for unknown paths, so the crawler rejects any response that starts with `<!doctype`. Each file was searched for 19 markers (section 4).
4. #2205: `gh pr view 2205` and `gh pr diff 2205` (read-only); nothing checked out, merged, or built.

Limits: regex import graphs miss computed paths; a minified chunk cannot be attributed byte-for-byte without its sourcemap; the live Render environment (`EOS_AUTH_FIREBASE_VERIFIER`) was not read (no Render or Firebase access was used).

---

## 2. Client register (`field-ops-app-vite/src`)

Status key. **Source status** is the reconciliation section 3 verdict for deleting the file from the repository: RETIRE-READY (an EOS path exists), HELD (production sign-in path, or a decision/copy is pending). **EOS artifact after #2205** is REMOVED-BY-#2205 for every row: the file's SDK import is replaced by the stand-in in a `VITE_AUTH_SOURCE=eos` build, so its Firebase code is not shipped there. Source deletion is a separate governed change and is not part of this audit.

**Reachability in the EOS (platform-sandbox / Vercel) build, before #2205.** Every row is bundled: the entry chunk carries all four SDKs (section 4). "STATIC" means the file is reached by static imports from `main.jsx` (so it is in the entry graph); "LAZY" means only through `import()`; "(lazy SDK)" means the file is static but loads `firebase/functions` through `import()` inside a function. At runtime in the EOS build the handles `db`, `auth`, `functions` are `null` (`firebaseAbsent.js`), so none of these can reach Firebase; they fail through their error path.

| # | File | SDK specifiers | Reach (main.jsx) | Source status | EOS artifact after #2205 |
|---|---|---|---|---|---|
| 1 | `firebase/firebase.js` (the shim; only `initializeApp`, `getAuth`, `getFirestore`, `getFunctions` and the 3 `connect*Emulator` calls in `src/`) | app, auth, firestore, functions | STATIC, aliased out in EOS build by `firebaseAbsent.js` | HELD, delete last | REMOVED-BY-#2205 (already not loaded since B2) |
| 2 | `auth/AuthContext.jsx` | auth | STATIC | HELD (production sign-in) | REMOVED-BY-#2205 |
| 3 | `auth/employeeSession.js` | firestore | STATIC | HELD (production path) | REMOVED-BY-#2205 |
| 4 | `access/useReportCapabilities.js` | firestore, functions | STATIC | HELD (production path) | REMOVED-BY-#2205 |
| 5 | `hooks/useCurrentTechnician.js` | firestore | STATIC | RETIRE-READY | REMOVED-BY-#2205 |
| 6 | `hooks/useEmployeeDirectory.js` | firestore | LAZY | RETIRE-READY | REMOVED-BY-#2205 |
| 7 | `hooks/useInventoryActions.js` | firestore | LAZY | HELD (Owner D-246-1) | REMOVED-BY-#2205 |
| 8 | `services/operationsQueries.ts` | firestore | LAZY | RETIRE-READY | REMOVED-BY-#2205 |
| 9 | `services/binCommandClient.js` | functions | LAZY | RETIRE-READY | REMOVED-BY-#2205 |
| 10 | `services/performanceGoalClient.js` | functions (lazy SDK) | STATIC | RETIRE-READY | REMOVED-BY-#2205 |
| 11 | `services/receivingCallableClient.js` | functions (lazy SDK) | STATIC | RETIRE-READY | REMOVED-BY-#2205 |
| 12 | `services/financeReadCallableClient.js` | functions (lazy SDK) | STATIC | RETIRE-READY | REMOVED-BY-#2205 |
| 13 | `services/privilegedApprovalClient.js` | functions | STATIC | RETIRE-READY (after R0 census) | REMOVED-BY-#2205 |
| 14 | `access/administrationUsersClient.js` | functions | LAZY | HELD (history copy) | REMOVED-BY-#2205 |
| 15 | `access/adminPasswordResetClient.js` | functions | LAZY | HELD (REC #2174) | REMOVED-BY-#2205 |
| 16 | `access/dataImportClient.js` | functions | LAZY | HELD (non-history imports have no EOS path) | REMOVED-BY-#2205 |
| 17 | `access/importedServiceHistorySource.js` | functions | LAZY | HELD (history copy) | REMOVED-BY-#2205 |
| 18 | `domain/reporting/reportExecutionSeam.js` | functions | LAZY | RETIRE-READY | REMOVED-BY-#2205 |
| 19 | `domain/reporting/savedReportService.js` | functions | LAZY | RETIRE-READY | REMOVED-BY-#2205 |
| 20 | `services/adminPolicyApiClient.js` | none directly; shim only (`auth.currentUser.getIdToken()`, line 356) | STATIC; `if (EOS_AUTH_ONLY) return null` (line 353) so no Firebase token path in the EOS build | HELD with `AuthContext` | REMOVED-BY-#2205 (never executed in EOS build) |

Tally (unchanged from reconciliation): **10 RETIRE-READY, 10 HELD** (rows 1 to 4 and 20 are the production sign-in path). Reachability: **10 STATIC** (rows 1 to 5, 10 to 13, 20), **10 LAZY** (rows 6 to 9, 14 to 19).

### 2.1 Configuration keys and other client surfaces

| Surface | Finding | Status |
|---|---|---|
| `config/environments.json` `firebase` blocks (apiKey, authDomain, projectId, storage, sender, appId) | Present for `platform-sandbox`, `platform-certification`, `taylor-parts-production`; `null` for `local-emulator`, `platform-integration`. Only `platform-sandbox` lists `authSources: ["firebase","eos"]` and declares `eosApi`. | HELD: the registry is the source of the non-EOS builds |
| `vite.config.js` | `__APP_FIREBASE_CONFIG__` defined from the registry (line 112); `VITE_AUTH_SOURCE` selects `firebase` (default) or `eos` (line 25); the B2 alias sends `firebase/firebase` to `firebaseAbsent.js` in an EOS-only build. `resolve: {}` otherwise. #2205 adds the `firebase/(app|auth|firestore|functions)` alias to `firebaseSdkAbsent.js` in the same EOS-only branch. | B2 live; the SDK alias is REMOVED-BY-#2205 |
| `VITE_FIREBASE_*` env keys | None. Firebase identity is injected only from the registry through `scripts/resolveEnvironment.mjs`, which injects none in an EOS-only build. | Nothing to remove |
| `initializeApp` | One call: `firebase/firebase.js:27`. | HELD; not loaded in EOS build |
| `getAuth` / `getFirestore` / `getFunctions` | One call each: `firebase/firebase.js:36,37,41`. No other file calls them. | HELD; not loaded in EOS build |
| Emulator connects | `firebase.js:62,63,69`, gated on `import.meta.env.DEV` and `?emulator=1`. | HELD |
| `field-ops-app-vite/package.json` | `firebase ^12.15.0` (dependency); `firebase-admin ^14.1.0` is also listed. | HELD; remove only with the last import |
| Static assets in `public/` | `404.html`, `favicon.svg`. No service worker, no `firebase-messaging-sw.js`, no `__/firebase/init.js` (these paths return the SPA fallback on the deployed site). | Clean |
| Root `index.html` "Parts Control Center" (repository root, GitHub Pages) | Reads and writes a Firestore `pcc` document with the production web config (reconciliation section 5.7). Not part of the Vercel EOS build. | Owner production decision; out of the EOS build |
| Repo-root Firebase config (`firebase.json`, `.firebaserc`, `firestore.rules`, `field-ops-app-vite/firestore.rules`) | Deploy/policy files for the Firebase-backed environments, not imported by any build. | HELD (protected policy) |

---

## 3. EOS API (Render service) import graph

Entry: `functions/src/eosApi/server.ts`, started by `functions/scripts/serveEosApi.mjs` (imports `../lib/eosApi/server.js`). **341 files** are reachable; **0 relative imports were unresolved**.

**Non-relative specifiers reached (complete list):** `node:crypto` (93 files), `node:http`, `node:async_hooks`, `node:net`, `node:zlib`, `pg` (3), `@google-cloud/secret-manager` (1), `firebase-admin` (1). There is **no** `firebase-functions`, `firebase-admin/*` subpath, `firebase`, `googleapis` or `google-auth-library` anywhere on the graph.

| Path | Specifier | Reachable at runtime? | Notes |
|---|---|---|---|
| `functions/src/eosApi/server.ts:180` `createFirebaseTokenVerifier` | `firebase-admin` (dynamic `await import`) | **Only if the composite verifier falls through to Firebase.** `startEosApi` wires it as the `firebase` half of `createCompositeTokenVerifier` (line 239). With `EOS_AUTH_FIREBASE_VERIFIER=disabled` (needs `EOS_HUMAN_LOGIN=enabled`; `eosAuth/eosAuthConfig.ts:129,207-212`; `eosAuth/eosAuthHttp.ts:77-79`) a non-EOS bearer is refused before the verifier is called, so `firebase-admin` is never loaded (DECISIONS line 9098). The default is `enabled`. | Load is lazy, so merely importing the module loads nothing. **The live setting was not read in this audit.** The reconciliation record states it was `disabled` on Render nonprod from 2026-10-18 (lane evidence); `render.yaml` does not declare it, so the repository cannot prove it. |
| `render.yaml` `GOOGLE_CLOUD_PROJECT=eos-platform-sandbox` | env, not an import | Read only by `firebase-admin` token verification | Removed with the verifier. |
| `functions/src/inboundWork/providerCredentialVault.ts` (reached via `eosOps/inboundProviderRuntime.ts`) | `@google-cloud/secret-manager` (dynamic) | Only when an email connection stores or reads a refresh token and the project id is valid (`inboundProviderRuntime.ts:92`) | Google Cloud, **not Firebase**; stores Gmail refresh tokens. A cloud-vendor dependency to carry into any hosting decision, not a Firebase one. |
| `functions/src/inboundWork/gmailTransport.ts`, `emailProvider.ts` | hosts `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`, `googleapis.com/gmail/v1/users/me` (string literals) | Only for a connected Gmail mailbox (inbound work intake) | Google **OAuth for a mailbox connection**, not user sign-in and not Firebase Auth. Listed so "Google identity" is answered completely. |
| `functions/src/access/oobCodeOutbound.ts` (`identitytoolkit.googleapis.com`) | host literal | **Not reachable** from `server.ts` (reachable only from `adminCredentialCallables.ts`, the Cloud Functions entry) | |

Repository dependency presence (not graph): `functions/package.json` still lists `firebase-admin` and `firebase-functions`, so both are installed in the Render image even though only the one lazy import can load `firebase-admin` and nothing loads `firebase-functions`. The reconciliation script reports 171 server files that name `firebase-admin*`/`firebase-functions*` (126 at runtime): 93 callable-only, 27 script-only, 49 test-only + 1 orphan (the 50 of reconciliation section 2), and the 1 `eosApi-only` file above.

---

## 4. Deployed nonprod bundle (before #2205)

`https://verenwardeos.vercel.app/version.json`: commit `203fcc0`, `platform-sandbox`, build `2026-10-21T15:40:35Z`. The page references `eos-api-nonprod.onrender.com` as the API (present in the entry chunk) and contains no Firebase project identity.

**Crawl:** 217 real files (every `assets/*` file referenced from the HTML or from another chunk, static and lazy), 4,046,901 bytes in total, 3,777,379 bytes of JavaScript. No source maps are served (`index-DBSdatdM.js.map` returns 403).

**Marker search across all 217 files:**

| Marker | Files containing it |
|---|---|
| `identitytoolkit.googleapis.com`, `securetoken.googleapis.com` (Firebase Auth REST hosts) | 1: entry chunk (offset ~324.9k) |
| `apis.google.com` (Auth popup/iframe loader) | 1: entry chunk |
| `firestore.googleapis.com`, `google.firestore` (Firestore) | 1: entry chunk (offsets ~611k to 623k) |
| `cloudfunctions.net` (Functions URL template) | 1: entry chunk (offset ~1.3146M) |
| `@firebase/` package names, `FirebaseError` | 2: entry chunk and `index.esm-BB1_G5S-.js` (the `@firebase/app` chunk, statically imported by the entry) |
| `firebaseapp.com`, `firebasestorage.app`, `firebaseio.com`, `AIza` (apiKey), `GoogleAuthProvider`, `signInWithPopup`, `firebase-admin` | **0** |
| `eos-platform-sandbox` | 1: `RolePolicyGrid-CZeSqKaj.js`, inside prose text ("MEASURED ... against eos-platform-sandbox on 2026-08-24"), not a config value |

**Reading:** the deployed EOS build ships the Firebase Auth, Firestore, Functions and App SDKs in the entry path and no Firebase project identity. This is exactly what #2205 describes: the SDK is present behind handles that are null at runtime. All of it is in the entry chunk and the `@firebase/app` chunk; **no lazy chunk carries any**. Lazy route chunks reach Firebase only through the already-bundled entry code. Total SDK weight (derived from #2205's local build): about 547.5 kB of 3.79 MB JS.

**What #2205 removes** (PR description, diff of head `90b979db`, and `npm run verify:eos-only`):
- `vite.config.js`: in an EOS-only build, `firebase/(app|auth|firestore|functions)` also alias to `src/firebase/firebaseSdkAbsent.js` (fail-closed stand-ins, `FIREBASE_ABSENT`; `httpsCallable` returns a callable that rejects). Every other build has no alias and is unchanged.
- Local evidence in the PR (not re-run here): entry chunk 1,454.21 kB to 929.10 kB (gzip 431.58 to 277.28); total JS 3,787,326 to 3,239,788 bytes; Firebase source in the sourcemap 1,938,980 characters to 0; the five Google hosts above present before and absent after.
- The guard: `verify:eos-only` (in CI `vite-build-check`) now also fails if the EOS output contains any of 10 SDK markers (`firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `cloudfunctions.net`, `apis.google.com`, `firebaseapp.com`, `firebasestorage.app`, `@firebase/`, `FirebaseError`, `google.firestore`) and requires every marker to be present in the ordinary Firebase build so the scan is not vacuous. A unit test pins the alias and that the stand-in exports every name `src` imports.
- What #2205 does **not** remove: any source import (M1), the `firebase.js` shim, the `firebase` and `firebase-admin` dependencies, the production sign-in path, the API's lazy `firebase-admin` verifier (M2), or anything deployed.
**Coverage check of the guard against this audit's markers:** the guard's 10 markers cover every marker that hit in this audit (`identitytoolkit`, `securetoken`, `apis.google.com`, `firestore.googleapis.com`, `google.firestore`, `cloudfunctions.net`, `@firebase/`, `FirebaseError`). After #2205 the 217-file crawl above should produce 0 hits; re-run the crawl against the build that contains #2205 to confirm on the artifact (not done: #2205 is not merged and its Vercel preview was not fetched).

---

## 5. Authority map: what serves each area in the EOS build

Each row names the EOS-owned component, its file evidence, and whether Firebase still serves any of it in the EOS-only build.

| Area | EOS-owned component (file evidence) | Firebase still serves it in the EOS build? |
|---|---|---|
| **Identity** | Server: `eosAuth/eosLoginService.ts` (human login, sessions, factors), `eosAuth/eosLoginHttp.ts`, `eosAuth/eosAccessToken.ts` (EOS-signed token verify), composite verifier in `eosApi/server.ts` (`createCompositeTokenVerifier`), `/auth/*` routes (404 unless `EOS_HUMAN_LOGIN=enabled`). Client: `auth/authSource.js` (`EOS_AUTH_ONLY`, never true for a production-role bundle), `auth/EosLogin.jsx`, `auth/eosLoginClient.js`, `auth/eosSession.js`, `AuthContext.jsx` EOS branch, `services/adminPolicyApiClient.js:353`. | **No** in the EOS build (no Firebase config, null handles, no token fallback). **Yes for production, certification, integration, local** (rows 1 to 4, 20 of section 2), and the API still accepts a Firebase ID token unless `EOS_AUTH_FIREBASE_VERIFIER=disabled` is set (section 3). |
| **Permissions** | `eos_policy` in PostgreSQL via `adminPolicy/postgresPolicyRepository.ts`; capability and role resolution `eosOps/capabilityAuthority.ts`, `adminPolicy/effectiveObjectAccess.ts`, `adminPolicy/administrationAuthority.ts`, `adminPolicy/policyCommands.ts`; operating-company and scope in `eosOps/operatingCompanyBinding.ts`, `eosOps/inventoryScopeAuthority.ts`. Client feed: `access/eosSessionSource.js` (EOS is the sole source when `EOS_SESSION_SOURCE`), `access/useEosCapabilityFeed.js`, `access/eosCapabilityAccess.js`. | **No** in the EOS build (rows 3 and 4 are aliased out and never consulted). Firebase `users/{uid}`, `resolveEffectiveAccessCallable` remain the permission source for the non-EOS builds. |
| **Data access** | Postgres domain transports: `eosOps/` (inventory, work orders, purchasing, receiving, bins, trucks, transfers, cycle counts, reports), `eosCommercial/`, `eosCrm/`, `eosFinance/`, `eosWorkforce/`, `catalogMaster/`, all behind `eosApi/server.ts` and `eosOps/eosOpsHttp.ts`. Client: `services/eosOperationsClient.js`, `commercialApiClient.js`, `eosFinancialsClient.js`, `eosRecordsClients.js`, `eosSupplierReceivingClient.js`, `eosRackingClient.js`, `operationsApiClient.js`. | **No** for the 11 RETIRE-READY families. **Gaps** (the EOS build fails closed instead): section 6. |
| **Workflows** | `adminPolicy/workflowEngine.ts` (step, action, role binding, own-assignment), `workflowInstances.ts`, `workflowLifecycle.ts`, `workflowAdministration.ts`; domain lifecycles `eosOps/workOrderLifecycle.ts`, `reorderLifecycleCommands.ts`, `transferOperations.ts`, `cycleCountOperations.ts`, `inboundWorkOperations.ts`. | **No** for the migrated families. Firebase callables for A2 (allocation), A3 (invoicing), A5 (coverage) have no EOS workflow. |
| **Audit** | `eos_policy.audit_events`, append-only by trigger (`functions/migrations/1757462400000_admin-policy.sql`, `1762646400000_administration-control-plane.sql`); one row per applied command in the command's own transaction (`eosAudit/commandAuditEvent.ts`); authorization denials (`eosAudit/authorizationDenialAudit.ts`); login security events (`EosSecurityEventGovernance`, `eosAuth/eosLoginService.ts`); change preview and commit audit (`eosOps/administrationReach.ts`, `eosOps/administrationPreviewAudit.ts`). 52 `INSERT INTO eos_policy.audit_events` sites. | **No** in the EOS build. Audit written by the Firebase callables (Firestore) is history that stays in Firestore (section 6, "pre-cutover history"). |

**Coverage statement:** 5 of 5 areas have an EOS owner; the EOS-only build contains no path from these five areas to Firebase. The areas are not equivalent in completeness: identity for production, and the capability gaps in section 6, are where Firebase is still the only implementation.

---

## 6. Gaps: where Firebase is still the only implementation

From reconciliation section 4 (21 deployed-function families; 11 RETIRE-READY, 1 split, 6 HELD, 3 BUILD-FIRST). In the EOS build all of these are unreachable at runtime and refuse; nothing falls back to Firebase.

| Gap | Kind | Where it blocks | Needs |
|---|---|---|---|
| A2 Allocation (`allocateSalesOrder`, `createServiceForSalesOrder`) | BUILD-FIRST | No EOS authority | S-1 (spec #2167) |
| A3 Invoicing, adjustments, refunds, payments (4 production callables) | BUILD-FIRST | `invoiceAuthority.ts`, `invoiceNumberAllocator.ts` unwired | F-1 (spec #2175, F-1a #2184) |
| A5 Coverage and territory (3 production callables) | BUILD-FIRST | No EOS authority | T-1 (spec #2173) |
| A8 Roles, users, sign-in administration (history, production password reset) | HELD | Production sign-in; pre-cutover history copy | REC #2174; Owner copy decision |
| A10 Labor, install, serialized assets | HELD | Labor semantics unruled (WOL-1/3/4) | Owner rulings |
| A13 Parts, suppliers, supplier terms | HELD | Equivalence gaps SUP-1/SUP-2, live proof pending | Re-verify on current main |
| A14 Part aliases and scans | HELD | ALS-1/2 (read gate narrowed) | Owner rulings |
| A17 Data import and imported history (non-service-history entity types; history copy) | HELD | No EOS import for customers/inventory/parts/equipment | Owner decision |
| A20 Inventory analytics (`detectInventoryEffects`) | HELD | Operator tool, no twin | Owner nod |
| Production Firebase sign-in (rows 1 to 4, 20) | HELD | No production EOS API and no recovery process | Owner-reserved |

Production keeps all 84 deployed functions, Hosting `4f30ab3a`, Rules `0526140d`; none of this audit touches them.

---

## 7. What the Owner can decide from this

1. **#2205** removes the SDK from the nonprod EOS artifact (about 14.5% of JS, 5 Google hosts, 0 apiKeys already) and adds the guard. It is repo-only and EOS-only. This audit found no case that the guard would miss among the markers that hit.
2. **API-side:** one lazy `firebase-admin` site remains. It is inert when `EOS_AUTH_FIREBASE_VERIFIER=disabled`. Confirming the live Render value is an operator read (not done here); deleting the verifier is HELD behind production sign-in (reconciliation step 8).
3. **Nothing in this audit authorizes a removal.** Removing a source import, the dependency, or the verifier is a separate governed change with the ratchet (`firebase-exit-baseline.json`) and equivalence gate.

## 8. Stated uncertainty

- The 14.5% SDK share and "about 547.5 kB" come from #2205's local build, not from the deployed artifact (no sourcemap is served). The byte counts of the two SDK-bearing files, and the marker absence elsewhere, are measured on the deployed artifact.
- Import graphs (client and server) are regex-based and miss computed paths; the server graph was cross-checked against the reconciliation script's independent classification (same answer: one `eosApi-only` file, no `callable+eosApi`).
- The live `EOS_AUTH_FIREBASE_VERIFIER` value, the live Render image contents and Vercel's `VITE_*` settings were not read. The deployed bundle itself proves the Vercel build is EOS-only (`eos-api-nonprod` present, no apiKey).
- A zero-hit crawl of the post-#2205 build is not yet performed; it is the one-command check that closes M3 after merge.
