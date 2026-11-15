# EOS Launch Readiness Audit

Issued: 2026-11-13 (America/Phoenix) · Baseline: `main @ afe621c04adaf090ed6118eee56cb84a846bebeb` (2026-10-30) · Previous audit: `main @ c73ce647` (2026-10-11, PR #2054)

**Status:** this is an assessment only. It authorizes no work, creates no authority, and reopens no Owner decision. Prepared under the direction of Rudy DiGiorgio using AI-assisted engineering tools.

## 0. Method and limits

**Sources**
- Repository read at `afe621c0` in an isolated worktree. Five read-only evidence sweeps covered:
  - identity and security;
  - Firebase exit;
  - deployment and operations;
  - persona UAT and defects;
  - commercial and configurability.
- The controller's local coordination records (`CONTROLLER-STATE.md`, `WORK-QUEUE.md`, `evidence/**`). These are uncommitted and outside the repository, and are cited as "controller evidence".

**Live, read-only checks (2026-11-13)**

| Check | Result |
|---|---|
| Non-prod API `/health` | `ok`, `migrated`, 119 migrations, HTTP 200 |
| Non-prod web `/version.json` | commit `aea6d20`, environment `platform-sandbox` |
| Web HSTS | Present. Vercel platform default: `max-age=63072000; includeSubDomains; preload` |
| API HSTS / CSP | No HSTS. No CSP on either surface |
| GitHub ruleset on `main` | Active ruleset 24909671 |
| Repository visibility | Public |
| Open PRs | 30, of which 8 are drafts |

**Local tests:** `node --test` over the four environment and deploy-guard suites gave 140 tests: 127 pass, 0 fail, 13 skipped.

**CI on `afe621c0`:** every completed `main` run succeeded.

**Not done**
- No production access and no production data read.
- No Render or Vercel console inspection beyond the public endpoints above.
- Optional AI was not re-assessed. It is carried over from the October audit as UNVERIFIED.

**Not deployed:** five commits on `main` after `aea6d20a` are not yet in non-prod: #2230, #2231, #2232, #2206 and #2221.

## 1. What "launch" means here

Owner decisions since the October audit change the definition:

- **DECISIONS #234 (2026-10-15)**
  - **O-1:** zero Firebase dependency is the target, including identity.
  - **O-9:** one shared codebase, **dedicated customer deployments**, with Taylor and Ventana kept as isolated operating companies.
- **Controller record, 2026-10-19 ("Production shouldn't be a thing")**
  - `main` becomes EOS-only.
  - The legacy Firebase production site stays untouched until the Owner retires it.
  - Recovery is from tags: `production-release/*`, plus `docs/operations/production-recovery-release-r1.md`.
- **DECISIONS #233:** repository privacy is deferred to final delivery.

This audit therefore assesses three gates:

| Gate | Meaning | Verdict |
|---|---|---|
| **L0: Non-prod UAT complete** | Every Day-1 process and persona is accepted on deployed non-prod EOS | **NOT PASSED** (release pin R2.4.1 states it; persona consolidation R3 accepts no persona fully) |
| **L1: Taylor/Ventana go-live on EOS** | A dedicated production EOS deployment replaces the Firebase site for Customer 1 | **NO-GO**. See §3 |
| **L2: Second customer** | A second, unrelated customer on its own dedicated deployment | **NO-GO**. See §6 |

## 2. What changed since 2026-10-11

150 commits landed. Firebase-exit counts are from `docs/architecture/firebase-exit-baseline.json`.

| Area | Oct-11 | Nov-13 | Evidence |
|---|---|---|---|
| EOS-native human login | Missing (Firebase only) | **Built and deployed to non-prod.** Password (scrypt, minimum 12 characters), lockout after 5 failed attempts for 15 minutes, rotating refresh sessions, session re-checked on every request, server-side sign-out | #2067, #2143, #2229; `functions/src/eosAuth/eosLoginService.ts`, `credentialCrypto.ts` |
| MFA | Missing | **Built and deployed to non-prod.** TOTP with QR enrollment, single-use recovery codes, forced setup gate. 16/16 personas passed MFA in a real browser; Codex passed QR and recovery | #2228; controller evidence |
| SSO / OIDC / SAML | Seam only | Unchanged (designed, `docs/architecture/eos-native-identity.md`) | — |
| Login rate limiting | Missing | Built: per-IP, per-process (10/min credential, 120/min routine) | `eosLoginHttp.ts:72-118` |
| Company isolation inside a tenant | Partial | **Large progress.** EOS Core company authority covers Analysis/My Work (#235), rental (#236), scheduling (#237), inventory (#2155/#2159), commercial (Q-1a #2194), and authorization before validation (#2217). **The Work Order company boundary is still open (#2200).** | `eosOps/companyAuthority.ts`; DECISIONS #235–#237, #248, #249 |
| Session–tenant binding | — | New: a session is bound to one tenant, a cross-tenant header is refused, and tenant switching is explicit | `eosAuth/requestTenantBinding.ts` |
| Firebase dependency | 280 entries / 273 fenced | **246 / 239**. Cloud Functions exports 95 → **82**. The EOS-only bundle is proven Firebase-free (`verify:eos-only`, every release R2.2–R2.4.1) | exit baseline; `test/verifyEosOnlyBuild.mjs` |
| `main` protection | **Reported unprotected** | **Correction:** active ruleset created 2026-10-11 22:31. Requires PRs, squash-only merges, 7 required checks, no force-push or deletion, no bypass actors. Requires **0** approving reviews. CODEOWNERS added | GitHub API; `.github/CODEOWNERS` |
| Release management | Manual, sandbox-centric | Pinned non-prod releases (R2 → R2.4.1) with manifests, rollback targets and post-deploy checks. Web rollback executed once (drift incident 2026-10-21); auto-deploy turned off | controller evidence `evidence/uat/*` |
| CI time | ~26 min admin gate | ~6.5 min (#2206, partitioned PostgreSQL suites) | `docs/engineering/ci-performance.md` |
| Production recovery | Undocumented | Tagged recovery refs and an operator recipe (documented, not executed) | `docs/operations/production-recovery-release-r1.md` |
| Taylor constants | Present | Rail company line **removed** (#2112). Operating-company ids, reporting calendar, line-of-business enum and the grant-seed tenant key are **unchanged** | `operatingCompanyAuthority.ts:22`; `reportingCalendar.ts:70`; `accountVocabulary.ts:22` |
| Business domains | Broad | Persona-proven live: full field chain, receiving, purchasing loop, transfers and cycle counts, dispatch, goals, invoice issue | §4 |
| Data import on PostgreSQL | Firestore adapters | SERVICE_HISTORY only on PostgreSQL. Other entities refuse (`ENTITY_NOT_WIRED`). Production refused | `eosOps/dataImportOperations.ts` |

**Unchanged since October:**
- no production EOS blueprint, and `server.ts:117-125` still refuses production;
- no RLS (119 migrations, 0 `CREATE POLICY`);
- no PostgreSQL backup or restore proof;
- no observability or alerting;
- no CSP, and no HSTS on the API;
- no dependency scanning (Dependabot and CodeQL off);
- no outbound email;
- no tenant lifecycle beyond create;
- no per-tenant entitlements;
- no SaaS billing;
- no support, incident response or SLA;
- the Customer-1 ledger was last reconciled 2026-09-09, and no gate has moved.

## 3. L1: Taylor/Ventana go-live on EOS (gate by gate)

Status key:
- **OPEN** = not satisfied.
- **PARTIAL** = materially progressed.
- **READY** = satisfied, with evidence.

| # | Gate | Status | Evidence / what is missing | Who unblocks |
|---|---|---|---|---|
| G1 | **Production EOS environment exists** | OPEN | Only `render.yaml`, which is non-prod. The API refuses `EOS_ENVIRONMENT=production` (`server.ts:117-125`) and the EOS token verifier refuses non-nonprod (`eosAuth/eosAuthConfig.ts:44-45, 134-137`). A production-role bundle is forced to Firebase sign-in (`auth/authSource.js:7-8,24-26`). O-9 is decided in principle, but no dedicated-deployment template exists | Owner authorization (production infra), then engineering |
| G2 | **Production identity** | OPEN | EOS login is proven in non-prod only. Real Taylor employees are not enrolled. Stored identities are Firebase-provider rows. No tool migrates Firebase Auth users. The identity-provider confirmation (D-2) is not on record | Owner (Q4, D-2), then engineering |
| G3 | **New-person onboarding** | OPEN (material) | No governed operation creates a Principal or tenant membership; only `tenantBootstrap` scripts do (`tenantBootstrap.ts:225,234,469,476`). `provisionLoginAccount` refuses non-members. No outbound email, so no invites | Owner design decision plus email provider |
| G4 | **Company isolation complete** | PARTIAL | See §2. #2200 (Work Order company boundary) is open and conflicting, being worked as controller lane A9. Ventana is not keyed in non-prod (FIX-VEN), so Taylor↔Ventana isolation has never been live-tested | Engineering (#2200); Owner (FIX-VEN) |
| G5 | **Day-1 scope frozen** | OPEN | C1-SCOPE-01 OPEN. Seven commercial spec PRs (#2167, #2170–#2175) are held with 12–18 Owner decisions each. Commercial scenarios A, C, D and E are BLOCKED, and B is untested | Owner |
| G6 | **Non-prod UAT (L0)** | PARTIAL | Live walks passed for receiving, the purchasing loop, transfers and cycle counts, the full field chain, dispatch, goals and invoice issue. Codex tests 9 and 10 and the R2.3 Parts/Access-explained checks are owed. Live walks owed: TW4/TW5, rebill, settlement, serial install, offline, scanner. General Manager and Office Manager have never been walked; Dispatcher only by API | Engineering/Codex; Owner sign-ins |
| G7 | **Data migration** | OPEN | Cutover tooling exists and is CI-tested (CRM, catalog, commercial C5, part master). No rehearsal on Taylor data. Historical Firebase data copies are Owner-held. "Three data questions" are pending. C1-DATA-01 and C1-INV-01 are OPEN | Owner, then operator |
| G8 | **Backup / restore / continuity** | OPEN | No Render PostgreSQL backup policy, restore rehearsal or RTO/RPO. Plan-tier behaviour is UNKNOWN. C1-RECOVERY-01 and C1-CONTINUITY-01 are OPEN | Engineering plus operator |
| G9 | **Operability** | OPEN | No error tracking, alerting or uptime monitor. The only signals are `/health` and in-process verifier counters. No IR plan, severity model or support path (C1-SUPPORT-01 OPEN) | Engineering; Owner (vendor spend) |
| G10 | **Security hygiene** | PARTIAL | Ruleset ✔ and gitleaks ✔. Missing: Dependabot, CodeQL, CSP, API HSTS, RLS backstop. MFA defaults off for new accounts and the role policy is pending. The rate limiter is per-process only. Lockout does not escalate (an attacker can keep an account locked; recorded residual risk). The repository is public (deferred, #233) | Engineering; Owner (MFA policy) |
| G11 | **Grant baseline governance** | PARTIAL | Live non-prod grants (1,047) differ from the repo seed (GRANT-DRIFT-01). Owner-pending: 228 grants with no command, 48 self-approval exemptions, 12 grid rows conflicting with code rules, the `admin` role's business capabilities | Owner |
| G12 | **Training and cutover rehearsal** | OPEN | C1-TRAINING-01 and C1-CUTOVER-01 OPEN. Training comes last by roadmap rule | After G1–G11 |
| G13 | **Owner production authorization** | NOT AUTHORIZED | C1-OWNER-01 | Owner, last |

**L1 verdict: NO-GO.** The critical path is:

```text
Day-1 scope (G5) → production blueprint + identity (G1, G2, G3)
                 → #2200 + Ventana keying (G4)
                 → backups / monitoring (G8, G9)
                 → data rehearsal (G7)
                 → UAT close (G6)
                 → training / cutover (G12)
                 → Owner authorization (G13)
```

## 4. Business-process acceptance on non-prod (summary)

These processes were proven live on deployed EOS by persona walks:

| Process | Result |
|---|---|
| Supplier PO receipt | PASS |
| Reorder → PO → receive | PASS |
| Transfers, put-away, blind cycle count with approve-and-adjust | PASS |
| Company-isolation retest | PASS |
| Full field chain (receipt → warehouse → truck → work order consumption → complete), ledger verified | PASS |
| Dispatch schedule/dispatch/cancel | PASS |
| Supplier PO authoring | PASS |
| Goal authoring with two-person approval (B1–B16) | PASS |
| Invoice issue | PASS |
| Sales-order allocation | PASS |
| Credits, refunds and voids | **Partial**: the rebill walk is owed after FU-2 |

**Not built**, with specs held:
- quotes and discount approval (Q-1);
- delivery and acknowledgment (D-1);
- warranty (W-1);
- territories (T-1);
- sign-in recovery and break-glass (REC);
- stock reservation specification (S1a).

**Persona coverage:**
- **Walked:** 9 of 16 personas through write workflows.
- **Partial:** Dispatcher, Retail Sales, National Accounts Sales, Reporting Analyst and General Employee.
- **Never walked:** General Manager and Office Manager.
- **Not exercised:** Ventana personas.

## 5. Readiness scores: October → November

Scale: 0 Missing … 5 Proven in repeatable production. No 5 is awarded. "≈" means unchanged.

| Domain (October matrix row) | Oct | Nov | Note |
|---|---|---|---|
| Production hosting of the target platform (1) | 1 | 1 | ≈ |
| Tenancy model (PostgreSQL) (2) | 4 | 4 | Plus session–tenant binding |
| Isolation backstop / RLS (3) | 0 | 0 | ≈ |
| Firebase dependency (4) | 0 | 2 | EOS-only bundle proven; 246 entries remain in source; client still carries the `firebase` package |
| Multiple operating companies (5) | 3 | 3 | Strong progress; Work Order boundary and Ventana live test still open |
| Human authentication (7) | 2 | 4 | Validated in non-prod; production path absent |
| MFA / SSO / SCIM (8) | 1 | 3 | MFA validated; SSO and SCIM missing |
| Authorization model (9) | 4 | 4 | Plus access explanation and access map; grant-drift items open |
| Audit (10) | 4 | 4 | ≈ |
| API security (11) | 2 | 3 | Login rate limit, authorization before validation; no CSP, no API HSTS |
| Source control / CI enforcement (13) | 2 | 3 | Ruleset with required checks; 0 approvals; public |
| Dependency management (14) | 1 | 1 | ≈ |
| Provisioning / onboarding (15) | 2 | 2 | Login-account administration added; Principal creation missing |
| Entitlements (16) | 2 | 2 | ≈ |
| Customer decoupling (17) | 2 | 2 | Less urgent under O-9 for Taylor; still blocks L2 |
| Business-domain coverage (18) | 4 | 4 | Many processes persona-proven; commercial extensions unbuilt |
| Import / export (19) | 2 | 2 | ≈ |
| Integrations (20) | 2 | 2 | ≈ (no email, no accounting adapter) |
| SaaS billing (21) | 0 | 0 | ≈ |
| Observability (22) | 0 | 0 | ≈ |
| Backup / DR on the target platform (23) | 1 | 1 | ≈ |
| Release management (25) | 3 | 4 | Repeated pinned releases; rollback executed once |
| Support operations (26) | 0 | 0 | ≈ |
| Compliance programme (27) | 1 | 1 | ≈ |

## 6. L2: second customer

Unchanged in substance from the October audit (PR #2054). Every L1 gate applies to the second customer's own dedicated deployment, plus the following:

- **Decoupling:**
  - operating-company ids;
  - reporting calendar;
  - line-of-business vocabulary;
  - the tenant-pinned grant seed;
  - the Taylor/Ventana inventory and rental semantics.
- **A dedicated-deployment template.** The registry change and IaC are still missing.
- **Per-tenant module activation.** Activation is still keyed by environment.
- **Tenant export.**
- **A commercial register and invoicing.** These can stay outside EOS at first.

## 7. Prioritized next actions

### Can proceed now, without Owner decisions

These are repository-only and inside existing authority.

1. Finish #2200, the Work Order company boundary (controller lane A9, already running).
2. Turn on Dependabot security updates and CodeQL default setup. This is a repository-settings change, so it needs a repository admin.
3. Add a CSP and `frame-ancestors` to `vercel.json` and to API responses, and HSTS to API responses.
4. Refresh the stale Customer-1 ledger (`docs/customer-1/*`, last reconciled 2026-09-09) to the post-October facts. It still says no Render resource exists.
5. Draft:
   - the production dedicated-deployment Blueprint (design only; deployment stays gated);
   - the PostgreSQL backup policy and restore-rehearsal script.
6. Prepare release candidate #2231 + #2232; deploying it needs Owner authorization.

### Need Owner decisions

These are in priority order.

1. **Day-1 scope (C1-SCOPE-01):** which of the seven held commercial specs are Day-1.
2. **Onboarding design and email provider.** Without them there is no way to add employees.
3. **Production EOS environment authorization (G1)** and identity-migration approach (Q4, D-2).
4. **FIX-VEN:** key Ventana so its isolation can be tested live.
5. **MFA policy** (everyone, or high-risk roles).
6. **Firebase data questions**, and the go/no-go on removing Firebase code.
7. **Monitoring and backup vendor/spend.**
8. **Grant-baseline items:** the 228 grants with no command, 48 self-approval exemptions, 12 grid rows, and the `admin` role's business capabilities.

## 8. Effort to L1 (engineering only; estimate)

These figures exclude Owner-gated spec work and the cost of building any commercial specs ruled Day-1.

| Item | Engineer-days |
|---|---|
| Production Blueprint and production-mode service/verifier fences | 8–12 |
| Production identity enablement and Firebase-user migration tooling | 8–15 |
| Governed Principal/membership creation and invites (after provider choice) | 5–8 |
| #2200 completion | in progress |
| Ventana personas and isolation walk (after FIX-VEN) | 3–5 |
| Backup policy and restore rehearsal | 3–5 |
| Monitoring and alerting baseline | 5–8 |
| CSP/HSTS and dependency scanning | 2–4 |
| Data-migration rehearsal on a Taylor export | 10–20 |
| UAT closure: owed walks and Codex tests | 5–10 |
| C1 ledger refresh, cutover runbook, rehearsal | 5–8 |
| **Total** | **≈ 54–95**, plus the commercial specs the Owner rules Day-1 |
