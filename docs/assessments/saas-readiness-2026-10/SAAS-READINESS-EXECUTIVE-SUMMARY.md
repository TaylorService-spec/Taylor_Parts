# Verenward EOS: SaaS Readiness Executive Summary

Issued: 2026-10-11 04:15:00 -0700 (America/Phoenix) · Baseline: `main @ c73ce6473028f13a2ed81f3ca4ae73fb450b0bce`

**Status:** ASSESSMENT ONLY. It does not authorize implementation, create an architectural authority, or reopen accepted decisions. Prepared under the direction of Rudy DiGiorgio using AI-assisted engineering tools.

## Document set

| # | Document | Question it answers |
|---|---|---|
| 1 | This summary | Where EOS stands and what to do first |
| 2 | [SAAS-ARCHITECTURE-INVENTORY.md](SAAS-ARCHITECTURE-INVENTORY.md) | What exists, where it runs, which domains are covered |
| 3 | [SAAS-SECURITY-TENANCY-ASSESSMENT.md](SAAS-SECURITY-TENANCY-ASSESSMENT.md) | Whether Tenant A can reach Tenant B; identity and authorization |
| 4 | [SAAS-COMMERCIAL-CAPABILITY-GAPS.md](SAAS-COMMERCIAL-CAPABILITY-GAPS.md) | Billing, entitlements, lifecycle; what belongs in a control plane |
| 5 | [SAAS-OPERATIONS-AND-RELIABILITY.md](SAAS-OPERATIONS-AND-RELIABILITY.md) | Hosting, CI/CD, backup/DR, observability, compliance evidence |
| 6 | [SAAS-COST-AND-SCALING-MODEL.md](SAAS-COST-AND-SCALING-MODEL.md) | Cost formulas, scenarios, bottlenecks |
| 7 | [SAAS-READINESS-MATRIX.md](SAAS-READINESS-MATRIX.md) | Scored 0–5 matrix across every domain |
| 8 | [SAAS-COMMERCIALIZATION-ROADMAP.md](SAAS-COMMERCIALIZATION-ROADMAP.md) | Phased backlog with IDs, acceptance criteria and effort |
| 9 | [SAAS-SECOND-CUSTOMER-ONBOARDING.md](SAAS-SECOND-CUSTOMER-ONBOARDING.md) | Today's onboarding path and the target workflow for customer two |

## Method and limits

- **Sources:** `main @ c73ce647` was read directly in an isolated worktree. Six read-only evidence sweeps covered tenancy, identity, onboarding and configuration, domains, infrastructure, and commercial/AI. High-impact claims were re-checked by hand.
- **Tests run locally:**
  - `node --test` over `scripts/firebaseExitGuard.test.mjs`, `eosApiEnvironmentContract.test.mjs`, `environmentArchitecture.test.mjs` and `firebaseDeployGuard.test.mjs`.
  - Result: 140 tests, 127 pass, 0 fail, 13 skipped.
  - PostgreSQL suites need `POLICY_TEST_DATABASE_URL`, so I did not run them locally. CI evidence is used for them instead.
- **CI on `c73ce647`:** all 60 completed `main` runs succeeded. `eos-admin-policy-tests.yml`, the PostgreSQL suite, was still running at the time of writing. It passed on the previous head `322db5b5`.
- **GitHub, queried live and read-only:**
  - `main` has **no branch protection** and no rulesets: `GET /branches/main/protection` returned 404.
  - The repository is **public**.
- **Not accessed:** Render, Vercel and Firebase consoles, production data, and live endpoints. Their deployment state is **UNVERIFIED** unless the repository records measured evidence, and every such case is marked.
- **Excluded:**
  - Owner rulings Q1–Q6 were not found in repository documents. Nothing here implements or presumes them.
  - Accepted Administrator decisions #211–#228 are taken as given.

## The answer in one paragraph

EOS is a deep, governed operations platform. Its business-domain and authorization engineering already goes beyond typical small-business SaaS. A PostgreSQL tenant model is real and well tested in CI, and every request derives its tenant from the server. **EOS is not yet a SaaS product.** Four facts carry most of the weight:

- **The target platform is not in production.** The PostgreSQL/Render platform runs only in non-production. The API refuses to start under a production label (`functions/src/eosApi/server.ts:107-113`). Production `taylor-parts` declares `eosApi: null` (`config/environments.json`) and still runs on the Firebase estate.
- **Tenancy is incomplete.** Isolation exists only as application-level query filters, with no Row-Level Security. The legacy Firestore plane has no tenancy at all.
- **Onboarding needs an operator.** Provisioning runs through operator CLIs, feature activation is per environment rather than per tenant, and several runtime constants assume Taylor/Ventana.
- **The SaaS business layer is absent.** There is no billing, subscription, metering, observability, compliance programme, or production backup proof for PostgreSQL.

**Recommendation:** start with Scenario A, managed dedicated deployments, as the first commercial model. Grow into Scenario C, a hybrid with a shared core and optional dedicated deployments. Do not onboard an unrelated customer into a shared environment until Phase 0 is proven.

## Owner briefing

### 1. What have we already built?

- **A broad set of business domains**, mostly re-implemented on PostgreSQL behind one trusted API (see [Architecture Inventory §4](SAAS-ARCHITECTURE-INVENTORY.md#4-business-operations-coverage)):
  - CRM, Retail and National Accounts sales channels, equipment and installed base, service and work orders, technician mobile, scheduling and dispatch, customer self-scheduling;
  - inventory, warehouse, bins, trucks, purchasing/reorder, suppliers, receiving, cycle counts, transfers;
  - finance (invoice/AR/billing packages), rental, analysis and reporting;
  - workflow engine, inbound email work, ownership/accountability, and append-only audit.
- **A governed authorization model** built on the accepted 16-persona foundation. It runs Principal → Membership → Security Role → Capability → Scope → Condition, and also covers Work Eligibility, Operational Scope, record relationships, a protected Owner and Administrator, anti-lockout, and decision history.
- **A PostgreSQL tenant model:** `tenants`, `tenant_memberships` and `tenant_operating_companies`. There are about 156 tenant-keyed tables, and the CI suites prove that cross-tenant requests are refused.
- **Release safety engineering:** 151 workflows, fail-closed deploy guards, a Firebase-exit ratchet (280 files remaining), environment registry contracts, and gitleaks.

### 2. What differentiates EOS from conventional SaaS?

- **Authority is explained, not just enforced.** The Effective Access chain and "View as user" preview (DECISIONS #210) reach a level of enterprise-IAM explainability that most SMB SaaS tools lack.
- **Ownership, accountability and assignment are three separate answers** (DECISIONS #209 §3), with immutable history.
- **Multi-operating-company operations inside one customer:** Taylor/Ventana, intercompany transactions, and consolidated analysis.
- **Server-composed persona workspaces** (Attention → Insight → Context → Authorized Action), with no client-side authority.
- **Governance by design:** append-only audit, append-only identity bindings, fail-closed environments, and an evidence-first release discipline.
- **Optional AI that cannot gain authority.** It is read-only, refuses any action, defaults to PRIVATE_ONLY routing, and EOS runs fully with AI disabled.

This places EOS closer to an **Enterprise Operations Platform** than to a conventional SaaS application. Its weakness is the commercial and operational shell around that core.

### 3. What is still missing?

- A production deployment of the EOS API and PostgreSQL. Customer 1 itself has not cut over.
- An EOS-native human login. Today only Firebase email/password exists, with no MFA or SSO.
- A defence-in-depth isolation layer (RLS or an enforced tenant-scoped query layer).
- Tenant lifecycle beyond create: suspend, export, delete.
- Self-service provisioning and invites.
- Per-tenant entitlements.
- Configuration that removes the Taylor constants.
- Billing and subscriptions.
- Observability, alerting, SLOs, incident response.
- PostgreSQL backup/restore proof and DR.
- Dependency scanning, branch protection, and a security/compliance programme.
- An accounting connector.

### 4. Top ten commercial launch blockers

1. **No production EOS/PostgreSQL runtime.** `server.ts:107-113` refuses production, `render.yaml` is non-production only, and production `eosApi` is null.
2. **No EOS human authentication, MFA or SSO.** `eos-identity-session-foundation.md:3` records "LOCAL FOUNDATION, NOT DEPLOYED".
3. **Tenant isolation is application filters only, and the Firestore plane is untenanted.** No `CREATE POLICY` exists in 95 migrations, and `firestore.rules` says "no per-account tenancy".
4. **`main` is unprotected and the repository is public.** The GitHub API shows this directly. The CI guards are advisory, and proprietary source is exposed.
5. **No observability or alerting.** `docs/design/c3-delivery-reliability-and-release-visibility.md:115-117`.
6. **No proven PostgreSQL backup/restore or DR.** C1-RECOVERY-01 is OPEN, and no Render Postgres restore document exists.
7. **Provisioning is operator-CLI only, with no production tenant-creation path.** `bootstrapEosTenant.mjs` refuses production.
8. **Taylor/Ventana runtime coupling.** `OPERATING_COMPANY_IDS` (`functions/src/ownership/operatingCompanyAuthority.ts:21-24`), the hardcoded reporting calendar, the line-of-business enum, and shell branding.
9. **No billing, subscription, entitlement or tenant lifecycle** (suspend, export, delete).
10. **No compliance evidence and no defined support or SLA.** There are no SOC 2 controls, DPA, privacy policy or IR plan. `docs/PlatformOperatingModel.md:88` explicitly defers them, and C1-SUPPORT-01 / C1-COMM-01 are OPEN.

### 5. Can we safely onboard a second unrelated customer today?

**No.**

- **Shared environment:** blocked by items 1, 3, 7 and 8. The Firestore-backed screens would mix data, because the Firestore plane has no tenant dimension. Operating-company scoping would not recognize the second customer's companies.
- **Dedicated environment:** technically closer, but still blocked by items 1, 2, 6 and 8.
- **Sales demonstration:** possible today in a separate non-production environment with synthetic data, under the existing environment fences.

### 6. Which launch model should Verenward pursue first?

**Scenario A: managed dedicated deployment per customer.** It is the shape the architecture already supports:

- The environment registry is role/deployment-agnostic (ADR-011). A second customer is `role: production, deployment: <customer>`.
- The Firebase plane is isolated per project.
- It avoids betting the first unrelated customer on application-filter-only isolation.

Plan the tenant-scoped PostgreSQL work so that A evolves into Scenario C. Full reasoning is in [Matrix §Launch scenarios](SAAS-READINESS-MATRIX.md#commercial-launch-scenarios).

### 7. What would it take to sell EOS to five customers?

1. **Complete Customer 1's production cutover.** This is the existing C1 gate programme.
2. **Phase 0:** security and isolation.
3. **Phase 1:** a repeatable dedicated-deployment template, generalization of the Taylor constants, production tenant provisioning, invites, and PostgreSQL data import.
4. **Minimum Phase 2:**
   - a lightweight commercial control plane (customer register, contract, plan, entitlements, invoicing through an Owner-selected provider or manual invoicing);
   - observability and alerting;
   - support intake and SLA;
   - per-environment cost tracking.
5. **Organizational work outside the code:** an IR policy, a DPA template, a security overview, and a vendor list.

For five customers, five dedicated deployments are operationally viable if they are automated.

### 8. Estimated implementation effort

The figures below are engineer-days. They exclude work already planned in the Firebase-retirement and Customer-1 programmes. Ranges reflect uncertainty; detail is in the [Roadmap](SAAS-COMMERCIALIZATION-ROADMAP.md).

| Phase | Engineer-days |
|---|---|
| Phase 0: security and isolation | 41–66 |
| Phase 1: first repeatable customer | 84–128 |
| Phase 2: commercial SaaS foundation | 79–125 |
| Phase 3: enterprise | 109–173, plus external auditor and pen-test vendor |
| Phase 4: AI and industry | 69–110 |
| **Total** | **≈ 382–602** |

Five-customer minimum (Phases 0–1 plus the Phase 2 items P2-05, P2-06, P2-08, P2-09, P2-10 and P2-12, with contracts and invoicing handled outside EOS): **≈ 158–244 engineer-days**.

### 9. Which work can proceed alongside Firebase retirement?

These items do not touch the Firebase-exit or Administrator paths:

- **Phase 0 items:**
  - P0-01 branch protection (an Owner/admin setting);
  - P0-02 repository visibility decision;
  - P0-04 global-id oracle;
  - P0-05 tenant-qualified secret names;
  - P0-06 rate limiting and headers;
  - P0-07 dependency scanning;
  - P0-09 second-tenant isolation suite;
  - P0-11 observability baseline;
  - P0-12 Render Postgres backup/restore rehearsal.
- **Phase 1 items:**
  - P1-04 reporting calendar from configuration;
  - P1-06 shell identity from tenant profile;
  - P1-11 tenant-neutral grant baseline;
  - P1-13 production-guard generalization.
- **All of Phase 2's control-plane design**, because it is a separate service.

**Must wait or coordinate:**

- P1-09 invites and P3-01 SSO, which depend on EOS human login (FX-AUTH-001).
- P1-12 PostgreSQL data import, which depends on the cutovers.
- P1-03 and P1-07 Taylor/Ventana generalization, which touch protected Parts/Inventory parity-fence semantics.
- P0-10 frontend tenant selection, which touches the session work.

### 10. What decisions require Owner approval?

See [Roadmap §Owner decisions](SAAS-COMMERCIALIZATION-ROADMAP.md#owner-decisions-required). The headline decisions:

- **OD-1:** launch model, A then C.
- **OD-2:** repository visibility, and branch protection as a repository-admin action.
- **OD-3:** isolation strategy, RLS or a wrapper.
- **OD-4:** production EOS blueprint authorization.
- **OD-5:** commercial control plane as a separate service.
- **OD-6:** billing provider.
- **OD-7:** pricing and packaging.
- **OD-8:** generalizing Taylor/Ventana semantics inside the parity fence.
- **OD-9:** SOC 2 pursuit and timing.
- **OD-10:** entity and IP documentation. The `LICENSE` and `docs/OWNERSHIP.md` name Rudy DiGiorgio, and Verenward LLC is not named as rights holder. This is an Owner/counsel matter only.
- **OD-11:** AI hosting model.
- **OD-12:** data residency commitments.

## Readiness scorecard (headline)

The scale runs 0 = Missing to 5 = Proven in repeatable production. The full matrix is in [SAAS-READINESS-MATRIX.md](SAAS-READINESS-MATRIX.md).

| Standard | Verdict |
|---|---|
| Traditional small-business SaaS | **Fails today.** No signup, billing, self-service onboarding or production multi-tenant runtime. Domain depth far exceeds the standard. |
| Enterprise SaaS | **Partially meets on authorization and audit (exceeds on explainability). Fails** on SSO/MFA, isolation defence-in-depth, observability, DR and compliance evidence. |
| Enterprise Operations Platform | **Meets or exceeds on domain breadth, governed workflows, ownership and multi-company design.** Configurability is partial: per-environment activation and Taylor constants. |

| Area | Score |
|---|---|
| Business-domain coverage | 4 |
| Authorization model | 4 |
| Audit | 4 |
| Tenancy model (PostgreSQL) | 4 |
| Isolation defence-in-depth | 0 |
| Human authentication (Firebase in production; EOS-native login missing) | 2 |
| Provisioning/onboarding | 2 |
| Configurability | 2 |
| Commercial/billing | 0 |
| Production hosting of target platform | 1 |
| Observability | 0 |
| Backup/DR (target platform) | 1 |
| CI/CD enforcement (`main` unprotected) | 2 |
| Compliance programme | 1 |
| Optional AI | 2 |
