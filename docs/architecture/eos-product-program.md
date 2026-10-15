# EOS Product Program: Firebase Exit → UAT → v1.0 → Customers

Issued: 2026-10-14 (America/Phoenix) · Starting head: `origin/main` `c42d6f6e`
Status: **PLAN, not authorized for execution.** This is read-only analysis: no code, config, deploy or identity was changed.
Owner direction (session, 2026-10-14):
- EOS is a **product** that customers deploy and rebrand. Taylor is customer #1.
- The release is **versioned and upgradeable** after UAT.
- The **mobile app is built after v1.0**, once the browser version is correct and complete. Mobile prerequisites are carried now.
- **Firebase DNS is removed last.**

Formal rulings are still required in §3.

Developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools.

## 1. Target state

```
Browser / (later) mobile app
  -> Vercel           static app only: no secrets, no server functions, no authority
  -> Render EOS API   /auth/* (EOS login, MFA, sessions) + every business operation
  -> EOS authorization (Principal -> membership -> Employee gate -> Roles -> capabilities -> scope)
  -> PostgreSQL       sole system of record (business data, identity, sessions, audit)
```

- **EOS Core controls (O-2), enforced server-side:** the domain model, identity and Employee association, sessions, effective permissions, record ownership and assignment, company and tenant boundaries, workflows and approvals, entitlements, business data access, audit and administrative configuration.
- **Navigation is a projection of that authority, not an authorization boundary.**
- **Vercel serves files.** It decides nothing and holds no credentials.
- **Firebase: zero.** No Auth, Firestore, Functions, Hosting, Storage or CI dependency.
- **One product, many deployments.** Every customer runs the same versioned release from a per-customer template:
  - their own Vercel project, Render API and PostgreSQL database;
  - their own brand and domains.
  - Customers configure the product; they never fork it.

This supersedes the "IDENTITY_ONLY" end state in `firebase-exit-ratchet.md` / `firebase-exit-baseline.json`
(FX-AUTH-001). That change needs ruling **O-1**.
Product shape follows the SaaS readiness assessment (PR #2054, Scenario A): managed dedicated deployments, designed to grow into Scenario C.

## 2. Where we actually are (measured on `c42d6f6e`)

| Area | State |
|---|---|
| **Repository** | **PUBLIC** (and `main` unprotected per #2054). Privacy is deferred to the final delivery stage (O-0, DECISIONS #233); until then nothing sensitive may be committed. |
| Production platform | The Render/PostgreSQL EOS API runs **nonproduction only**: it refuses a production label. Production is still Firebase. |
| Exit baseline | 275 entries. Frontend: 19 Firestore, 22 callable, 2 Auth. Server: 166 admin-Firestore, 61 Functions, 3 Auth, 2 admin-app. |
| Functions exports | 82. Live browser callers remain in Manufacturer, Finance reads, Access/Admin, Reporting, the Scanner set, CRM activity, Performance and Data import. |
| EOS native login | **Merged** (#2067): password + TOTP + recovery, `__Host-` refresh cookie, server sessions. **Flags off, nonproduction only (D-1).** The independent security review (D-2) has not been done. |
| Render token verifier | Composite: an EOS token **or** a Firebase ID token (`eosApi/server.ts`). The client prefers EOS and falls back to Firebase. |
| Navigation authority | `EOS_NAVIGATION_AUTHORITY_READY` is on in `platform-sandbox` only. Anywhere else, a user signed in through EOS sees "No access". |
| Capability gates in UI | `hasCapability` comes from a Firestore listener plus a callable (`access/useReportCapabilities.js`). Under EOS it fails closed. |
| Unreachable menu items | 18 of 20 Financials items, Reporting builder/saved, 6 Admin items and the inventoryRole items have no `surfaceAccess`. |
| Vercel ↔ Render | `*.vercel.app` and `*.onrender.com` are different sites, so the refresh cookie is third-party. The fix (app + api under one domain) is designed but not done. |
| Customer coupling | Taylor/Ventana are hard-coded: `OPERATING_COMPANY_IDS`, the line-of-business enum, the reporting calendar and shell branding. |
| Versioning | No release tags. Both packages are at `0.0.0`. Render nonprod auto-deploys `main`. Migrations (`node-pg-migrate`) run as `preDeployCommand`. |
| Mobile | Phone-built technician and warehouse screens, an offline queue (IndexedDB, unencrypted), camera and wedge scanning. **Not installable:** no manifest, no service worker. The approved strategy is PWA-first (`docs/MobileStrategy.md`). |
| UAT evidence | PR #2068 (draft): read-only, 16 personas, 272 PASS. Put Away/Pick are offered to no EOS persona. |

## 3. Owner rulings

### Needed now
| # | Ruling | Blocks | Recommendation |
|---|---|---|---|
| ~~O-0~~ | Repository privacy. **DEFERRED — OWNER DIRECTED (2026-10-15, DECISIONS #233):** visibility is not changed now; it is revisited as a final commercial-release readiness item. It blocks nothing listed here. Secret scanning and the no-credentials / no-sensitive-evidence rules stay in force. | — (final release item) | Deferred |
| O-1 | End state is zero Firebase: authentication, navigation, business data, security rules and application access. Supersedes FX-AUTH-001. Identity and data cutovers each need proof plus a separate Owner authorization. | Everything | **DECIDED (2026-10-15, #234)** |
| O-2 | **EOS Core authority.** EOS Core owns the domain model and **all governed business authority**, enforced server-side: entities and relationships; identity and Employee association; effective permissions; record ownership, accountability and assignment; company and tenant boundaries; workflows, rules and approvals; business data access; audit and administrative configuration. **Frontend navigation is not an authorization boundary.** | Phases 2–6 | **DECIDED (2026-10-15, #234)** |
| O-9 | Shared product codebase; dedicated customer deployments; governed customer/company isolation. Taylor Freezer of Arizona and Ventana keep distinct operating-company boundaries. | Phase 1 template | **DECIDED (2026-10-15, #234)** |
| O-15 | (Formerly listed as O-2.) Product domain: each deployment gets an app + api pair under one registrable domain: `<customer>.<product>` / `<customer>-api.<product>`, or the customer's own `app.` / `api.` (premium). | Phase 1.2, login UX | Approve (open) |

### Needed before identity cutover
| # | Ruling | Recommendation |
|---|---|---|
| O-3 | Employees get EOS credentials through admin-issued, single-use enrollment codes. No Firebase password-hash import. | Approve |
| O-4 | Production recovery: admin-issued codes (D-5) now, an email provider later (spend). | Admin codes at go-live |
| O-5 | Lift D-1 (nonprod-only) for production after a passed security review | Decide after review |
| O-10 | The security review **includes the future native-app sign-in design**: secure device storage, no cookie, Origin rules for app clients. Nothing is built for it before v1.0. | Approve; avoids a second review |

### Needed per domain
| # | Ruling | Recommendation |
|---|---|---|
| O-6 | Authority gaps: PA-1 / `inventory.location.bin.read` (Put Away/Pick), ALS-1, AUD-1, CAT-3, SUP-1/2/3, WOL-3/4 | I bring each with options |
| O-7 | Build or accept the gap for each MISSING capability (§4 Phase 4) | Build Reporting, Finance adjustments and Data import |
| O-8 | Retention of the final Firestore export before project shutdown | 90 days |
| O-11 | Generalize Taylor/Ventana semantics inside the parity fence (#2054 OD-8) | Parity-preserving refactors with proofs |

### Deferred until after v1.0 (mobile)
| # | Ruling |
|---|---|
| O-12 | Amend `MobileStrategy.md`: from PWA-first to native shell (Capacitor) with store distribution |
| O-13 | Push notifications: Android push effectively requires Firebase Cloud Messaging. Choose a named exception, iOS-only push, or no push. |
| O-14 | Store branding: one product app with brand applied after sign-in (recommended), or per-customer store apps (premium; likely published under the customer's own developer account or private distribution) |

## 4. Phases and work packages

Size: S ≈ 1 PR, M ≈ 2–4 PRs, L ≈ 5+ PRs or a full capability lifecycle.
**Tier:** **A** = autonomous repo work (DelegationCharter §8). **O** = Owner ruling. **Op** = operator executes.

### Phase 0: Re-baseline (starts immediately, A)
| WP | Scope | Size | Tier |
|---|---|---|---|
| 0.1 | Refresh `firebase-retirement-roadmap.md` and the capability matrix to `c42d6f6e`. Classify each live client file: REPLACED-not-migrated / MISSING / DEAD. | S | A |
| 0.2 | **Firestore data-residency census:** collection → reader/writer → PostgreSQL table, or "none". This is a code census; production counts are **Op**. | M | A + Op |
| 0.3 | Register lanes in `ACTIVE_WORKSTREAMS.md` (§9) | S | A |
| 0.4 | Reconcile open PRs #2068 (UAT evidence), #2093 (UAT credentials) and #2054 (SaaS assessment) into this plan | S | A |

### Phase 1: Platform seam and per-customer production template
| WP | Scope | Size | Tier |
|---|---|---|---|
| 1.1 | **Production EOS Blueprint, parameterized per customer:** API, PostgreSQL, env, origins, brand. Production fences replace the blanket production refusal. Taylor is deployment #1 (#2054 P1-01). | M | A (design/code) + O-9 |
| 1.2 | Domains for nonprod and Taylor. Add DNS records (app + api, **DNS only / grey cloud**, CAA allows Let's Encrypt). **Existing Firebase records are left untouched until 7.3.** | S | O-15 → Op |
| 1.3 | Render env per deployment: `EOS_ALLOWED_ORIGINS`, `EOS_AUTH_COOKIE_SAMESITE=Strict`, trusted-proxy hops measured | S | Op |
| 1.4 | `vercel.json` hardening: CSP `connect-src` limited to the deployment's api host, security headers, only public env vars | S | A |
| 1.5 | Confirm production is served by Vercel, then remove `hosting` from `firebase.json` and disable Firebase Hosting (DNS stays until 7.3) | S | A + Op |

### Phase 2: Make EOS the controlling shell (P0 for UAT)
| WP | Scope | Size | Tier |
|---|---|---|---|
| 2.1 | Replace `useReportCapabilities` (Firestore + callable) with capabilities and access version from EOS `/operations/experience`. This restores every `hasCapability` gate. | M | A |
| 2.2 | Declare `surfaceAccess` for unreachable menu items using **existing** capability keys. Items that need new keys go to O-6. | M | A (+O) |
| 2.3 | Remove legacy-role reads under an EOS session (notification bell, `role`, `displayName`, `operationalRoles`) | S | A |
| 2.4 | Turn `EOS_NAVIGATION_AUTHORITY_READY` on for integration and certification | S | A |
| 2.5 | Enable EOS login in nonprod integration so UAT runs on EOS-only identity | S | Op |
| 2.6 | **Per-tenant module entitlements**, consulted with environment activation, enforced server-side (#2054 P1-10) | M | A |

### Phase 2P: Product generalization (parallel with Phase 3)
Taylor's behavior must stay byte-identical; each WP carries parity proofs.

| WP | Scope | Size | Tier |
|---|---|---|---|
| 2P.1 | Replace runtime `OPERATING_COMPANY_IDS` with `eos_policy.tenant_operating_companies` (#2054 P1-03) | M | A (O-11) |
| 2P.2 | Line-of-business vocabulary and reporting calendar per tenant (P1-05) | M | A (O-11) |
| 2P.3 | Taylor/Ventana custody and ownership semantics → operating-company roles (P1-07). **Protected parity fence.** | M | O-11 |
| 2P.4 | **Brand settings per deployment:** product name, logo, colors (existing design tokens), favicon, login screen, email sender name. Remove hard-coded shell branding. | M | A |

### Phase 3: Client cutovers where an EOS replacement exists
Each WP updates the equivalence manifest (Gates A–E + audit). A WP is done when the file leaves the baseline.

| WP | Live client → EOS replacement | Size | Blocker |
|---|---|---|---|
| 3.1 | Manufacturer read/command clients → `manufacturerAuthority` | M | — |
| 3.2 | Catalog client contract defects CAT-1/2 | S | — |
| 3.3 | Admin user detail: history → EOS audit read (#2079), status → `login_accounts`, password reset → EOS recovery codes | M | #2079; O-3 |
| 3.4 | `useWorkOrderPartsPlanCapability` → EOS Work Order capabilities | S | — |
| 3.5 | `financeReadCallableClient` → EOS finance reads | M | Refunds/adjustments are MISSING |
| 3.6 | `privilegedApprovalClient`: verify the EOS replacement; otherwise move it to Phase 4 | S–M | 0.1 |
| 3.7 | Scanner set: receiving, returns, bins, balance (16 exports) | L | O-6; `getPartBalances` on-order gap |
| 3.8 | F5 `getWorkOrderFieldContext`: screen test, then a recorded technician run | S | Op |
| 3.9 | Dead code: `completionService`, legacy `fieldops_jobs`, roadmap §3.6 items | S | Legacy-jobs ruling if data remains |

### Phase 4: Build what EOS is missing
| Capability | Firebase exports | Size | Ruling |
|---|---|---|---|
| Reporting: execution + saved definitions | 7 | L | O-7; lift the HELD status |
| Finance refunds / adjustments | part of 6 | M | O-7 |
| Data import (also needed for **customer onboarding**) | 4 | M | O-7 |
| CRM activity | 2 | M | — |
| Performance goals (incl. creation UI) | 6 | M | O-7 |
| Coverage / territory authority | 3 | L | O-7 |
| Account portfolio summary | 1 | M | Build |
| Scheduling cutover (EOS exists) | 7 | M | Scheduling functional gate HELD |
| Inventory analytics/effects, WO readiness AI | 4 | M–L | O-7 |

### Phase 5: Server and data retirement
| WP | Scope | Tier |
|---|---|---|
| 5.1 | Delete server Firestore/Functions code per cut-over domain and shrink the baseline (166 + 61), under the equivalence gate | A |
| 5.2 | Migrate the Firestore-only business data found in 0.2 into PostgreSQL: verification counts plus a rollback snapshot | O + Op |
| 5.3 | Delete deployed Cloud Functions in bounded deletion windows (F0 guard) | Op |
| 5.4 | Delete the emulator-based CI with its code. Keep the exit and equivalence guards. | A |
| 5.5 | **Tenant-isolation backstop** (PostgreSQL RLS, #2054 P0-03). Required before any two customers share a database; advised before customer #2. | O (OD-3) + A |

### Phase 6: Identity cutover (the last runtime dependency)
| WP | Scope | Tier |
|---|---|---|
| 6.1 | Independent security review of EOS login (D-2), **including the native-app sign-in design (O-10)** | O |
| 6.2 | Enrollment runbook: Owner first with MFA, plus break-glass. Then administrators, then employees by company via admin-issued codes bound to existing Principals. Employee ↔ Principal links, Roles and grants are untouched (proof L24). | A + Op |
| 6.3 | Production parallel run: both logins and the composite verifier. Track enrollment % per company. **Precheck:** add `app.<domain>` to the Firebase Auth authorized domains, and to the browser API key's referrer restrictions if it has any. | O-5 → Op |
| 6.4 | Cutover: production EOS login and nav authority on; Firebase login hidden | O → Op |
| 6.5 | After a stable window: remove the Firebase verifier and `firebase/auth`, `firebase.js`, `claimsWriter`, `trustedWriterCommands`, `adminCredentialCallables`. Baseline Auth goes to 0. | A |
| Rollback | Until 6.5 merges: an env flip restores Firebase login with no data change. After 6.5: revert the PR. | Op |

### Phase 7: Decommission
| WP | Scope | Tier |
|---|---|---|
| 7.1 | Remove `firebase.json`, `.firebaserc`, rules and index files, the `firebase` / `firebase-admin` / `firebase-tools` packages and the F0 deploy guard. Baseline empty; the ratchet forbids any Firebase import. | A (rules files Tier 2: O) |
| 7.2 | Final Firestore export to archive, disable Auth, delete the remaining Functions, shut down the project after the O-8 retention period | O + Op (irreversible) |
| 7.3 | **Firebase DNS last.** Remove the Firebase records from Cloudflare (Hosting A/CNAME, ownership TXT) in the **same window** as 7.2, so no record points at a Firebase host nobody controls. | Op |

## 5. Release and versioning (set up before UAT sign-off)

| WP | Scope | Tier |
|---|---|---|
| R.1 | **One product version** across app, API and migrations: `vX.Y.Z` git tags, release notes from merged PRs, hotfix branches `release/X.Y.x`. **UAT sign-off = `v1.0.0`.** | A |
| R.2 | **Versioned API artifact:** a container image per version (`eos-api:X.Y.Z`) in a private registry; each customer's Render service pins a tag. Upgrade or rollback = change the tag. | A (recipe) + Op (registry, Render) |
| R.3 | **Versioned app build:** each customer's Vercel project builds from the release tag with its deployment settings | A + Op |
| R.4 | **Per-customer deployment manifest** (pinned version, brand, domains, entitlements), separate from code. An upgrade is a reviewed PR changing the pin. | A |
| R.5 | **Forward-only, compatible migrations:** release N must run against schema N−1 (expand/contract), so an app rollback never needs a database rollback. Backup before every upgrade. A CI check enforces this. | A |
| R.6 | **Client compatibility:** the API supports the current and previous minor version, and clients report their version. This is the foundation the mobile app needs later. | A |
| R.7 | **Staged rollout:** staging → Taylor → other customers, with a UAT smoke run (the #2068 persona runner) at each step | Op |
| R.8 | Support window: the current minor and the previous one | O |

## 6. UAT (runs alongside Phases 2–6)

- **Environment:** integration on Render nonprod + nonprod PostgreSQL + Vercel at the deployment domain, with EOS-only login and nav authority on. Mock-only results don't count.
- **Harness:** extend the #2068 persona runner from read-only to writes. Write runs need mutation authorization per run set (**Op**).
- **Matrix:** 16 personas × {login/MFA, navigation, record read, create/update, approvals, assignment, ownership, reporting, **cross-company denial**, **capability denial**}. Taylor and Ventana are run separately.
- **Real phones:** the Technician and Warehouse journeys run on real phones in the browser, so later mobile work inherits proven screens.
- **Evidence:** each pass becomes Gate B `uat` evidence in `firebase-capability-equivalence.json`.
- **Blocked journeys:** a journey stays "blocked" until its Phase 2–4 dependencies land. That is not a failure.
- **Sign-off:** produces `v1.0.0` (R.1).

## 7. Mobile track

**Before v1.0 (prerequisites only; no app work):**
- M-P1: the native sign-in design is included in the 6.1 security review (O-10).
- M-P2: Technician and Warehouse UAT runs on real phones (§6).
- M-P3: client-version compatibility exists from v1.0 (R.6).
- M-P4, *optional*: make the browser app installable (manifest + service worker). Do it only if field UAT shows queued offline work being lost (Safari storage eviction).

**After v1.0 (needs O-12, O-13, O-14):**
| WP | Scope |
|---|---|
| M.1 | Capacitor shell around the same React app; same release version as web |
| M.2 | Native sign-in per the reviewed design (secure device storage) |
| M.3 | Native barcode scanning; encrypted offline queue |
| M.4 | Minimum-supported-version enforcement against R.6 |
| M.5 | Store distribution: Apple Developer (~$99/yr), Google Play (~$25 once); private distribution through Apple Business Manager and managed Google Play for business customers |
| M.6 | Push notifications per O-13 |

## 8. Completion criteria

**Firebase exit:**
1. The exit baseline is empty, and the ratchet forbids any Firebase import.
2. No Firestore reads or writes and no callable in any runtime path.
3. Production login is EOS-only; the Firebase verifier is removed.
4. All business data is in PostgreSQL, with verified counts from 0.2 / 5.2.
5. No CI or deploy path uses Firebase; Hosting is retired; Firebase DNS is removed (7.3).
6. Server-side authorization and audit are unchanged (L24-style before/after proofs).
7. Owner access is verified with MFA, and break-glass is tested.
8. Every in-scope capability is REPLACED or SUPERSEDED, or carries an Owner-accepted GAP.

**v1.0 release:**

9. The UAT matrix passes for every persona and both companies.
10. `v1.0.0` is tagged and deployed to Taylor from the per-customer template, with the release process (§5) proven by one upgrade and one rollback in staging.

**Product proof (after v1.0):**

11. Customer #2 is onboarded from the template with **no code changes**: brand, domains, companies and entitlements set by configuration only.

Training and operator handoff are a **separate** go-live checklist.

## 9. How the work is run

| Lane | Scope | Concurrency |
|---|---|---|
| L1 Platform/Identity | Phases 1, 6 | Serial; mostly Op/O steps |
| L2 Shell authority | Phase 2 | Starts first; unblocks UAT |
| L3 Client cutovers | Phase 3 | Parallel worktrees, one domain per session |
| L4 Capability builds | Phase 4 | One capability at a time per domain |
| L5 Product & release | Phase 2P, §5 | Parallel with L3; owns template, brand and versioning |
| L6 Retirement & CI | Phases 5, 7 | Follows L3/L4 per domain |
| L7 UAT | §6 | Continuous from 2.4 |
| L8 Mobile | §7 | Prerequisites only until v1.0 |

- I sequence the lanes, take autonomous (A) work to merge under the exact-head guard, and record each lane in `ACTIVE_WORKSTREAMS.md`.
- I stop only at O/Op boundaries.
- Milestone reports:
  1. end of Phase 0;
  2. the shell runs on EOS (2.4);
  3. each domain retired;
  4. identity cutover readiness;
  5. UAT sign-off and v1.0.

**Critical path:** (O-1/O-2/O-9 decided 2026-10-15) → O-15 for domains → 0.1/0.2 → 2.1/2.2 → 2.4 → UAT on EOS identity → 6.1 review → O-5 → 6.3/6.4 → v1.0 → 6.5 → 7.

Phases 2P, 3, 4 and §5 run in parallel with the critical path and gate criteria 8–11.
