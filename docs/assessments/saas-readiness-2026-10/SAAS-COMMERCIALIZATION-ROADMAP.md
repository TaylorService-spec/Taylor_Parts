# SaaS Commercialization Roadmap & Backlog

Issued: 2026-10-11 04:15:00 -0700 (America/Phoenix) · Baseline: `main @ c73ce647` · Status: **PROPOSED BACKLOG**

This document does not authorize work. No GitHub issues or PRs have been created from it. Items marked *Owner* need an Owner decision before they can start (see the last section).

## How to read this backlog

**Relationship to existing programmes.** Two programmes are dependencies of this backlog, not duplicates of it:
- the Customer-1 production cutover (`docs/customer-1/CUSTOMER_1_READINESS.md` gates);
- Firebase retirement (`docs/roadmaps/CURRENT.md` delivery order, FX-AUTH-001).

Their effort is **not** counted here. Every item preserves:
- the accepted 16-persona authorization model;
- the Parts/Inventory/Truck parity fence;
- accepted Administrator decisions #211–#228.

**Field meanings.**
- **Effort:** engineer-days, as a range.
- **Priority:** P1 (highest) to P3.
- **Blocks:** whether the item blocks a launch scenario.
  - **A** = managed dedicated deployment.
  - **B** = shared multi-tenant SaaS.
  - **—** = blocks neither.

## Phase 0: Critical security and isolation

These must be proven before any unrelated customer is onboarded.

| ID | Description | Why | Reuse | Acceptance criteria | Tests | Deps | Effort | Pri | Blocks |
|---|---|---|---|---|---|---|---|---|---|
| P0-01 | Protect `main` with required status checks, linear history, CODEOWNERS for protected paths (`firestore.rules`, `functions/migrations`, `functions/src/access`, `adminPolicy`) | CI guards are advisory today (GitHub API: unprotected) | Existing `governance-guard-enforcement.yml` as required check | Direct push to `main` refused; PR requires green required set; protected paths require owner review | Attempted direct push in a scratch repo mirror; settings exported as evidence | Owner/repo-admin action (OD-2) | 1–2 | P1 | A, B |
| P0-02 | Repository visibility decision and execution (private, or split public/private); review git history for sensitive operational detail | Proprietary source (`LICENSE`) is public | gitleaks history scan | Owner decision recorded; repository visibility matches it; history scan clean or remediated | gitleaks `detect` over full history | OD-2 | 1–2 | P1 | A, B |
| P0-03 | Tenant-isolation backstop: PostgreSQL RLS on tenant-keyed tables, with the tenant set per transaction from server-derived `actor.tenantId` (or an Owner-chosen mandatory tenant-scoped query layer) | Isolation is app-predicate only (0 `CREATE POLICY`) | `principalContext.ts` tenant derivation; composite `(tenant_id, …)` keys | Every tenant-keyed table under policy; a query omitting the tenant returns zero rows, not other tenants' rows; migration role vs runtime role separated | New PG suite: for every table, insert in T1/T2, read as T1 → only T1; a deliberate missing-predicate query is caught | OD-3 | 12–18 | P1 | B (A advised) |
| P0-04 | Remove global-id cross-tenant reads (e.g. `employeeCreationCommand.ts:181`); scope existence checks by tenant | Cross-tenant existence oracle | Existing tenant-scoped repositories | No `WHERE id = $1` on tenant-owned tables without `tenant_id` | Static census test over SQL literals (extends the 1,037-literal scan) plus targeted PG tests | — | 3–5 | P1 | B |
| P0-05 | Tenant-qualified secret names and an access path for integration credentials | `eos-email-connection-<connectionId>` lacks tenant | `providerCredentialVault.ts` | Secret name includes tenant; vault refuses cross-tenant lookup | Unit and PG tests | — | 2–3 | P2 | B |
| P0-06 | Rate limiting (per principal, per IP, stricter on `/public/self-scheduling` and auth routes); HSTS/CSP/Referrer-Policy on API and Vercel | No abuse protection; minimal headers | `adminPolicyHttp.ts` response helpers; `vercel.json` | Limits enforced with 429 and audit; headers present | HTTP tests; header assertions in `eosApiBlueprint.test.mjs` | — | 3–5 | P1 | A, B |
| P0-07 | Dependency and code scanning (Dependabot, CodeQL or equivalent); remove `--no-audit` from build, or audit in CI | No vulnerability management | Existing CI structure | Weekly scans; high/critical findings gate merges; patch SLA documented | Workflow run evidence | P0-01 | 1–2 | P1 | A, B |
| P0-08 | Shared-tenancy exclusion: a guard proving no Firestore-backed surface is reachable in any environment declared multi-tenant; registry flag `sharedTenancy` | Firestore plane has no tenant dimension | `firebaseExitGuard.mjs`, `environments.json` contracts | Build fails if a multi-tenant environment enables a Firestore-dependent surface | Contract test like `eosApiEnvironmentContract.test.mjs` | Firebase exit progress | 3–5 | P1 | B |
| P0-09 | Two-tenant end-to-end isolation suite across every EOS API route and the poller | Second tenant never instantiated (`eos-real-nonprod-activation.md`) | Existing PG persona journeys; `seedTaylorNonprodWorkforce.mjs` pattern | Synthetic T2 with all 16 personas; every route returns only own-tenant data; Analysis and search included | New CI PG suite | P0-03 helpful, not required | 5–8 | P1 | B (A advised) |
| P0-10 | Frontend tenant selection (send `x-eos-tenant`) or an explicit single-membership invariant enforced at membership creation | Multi-membership users get `AMBIGUOUS_TENANT` | `principalContext.ts` hint handling | Decided rule implemented and documented | Client and PG tests | Session work | 2–3 | P3 | — |
| P0-11 | Observability baseline: structured JSON logs with request id, tenant id and principal id; error tracking; uptime and alert routing | "No observability of any kind" | `x-request-id` handling; `/health` | Every request logged structurally; 5xx and health failures page an operator | Log-shape unit tests; synthetic alert drill | Vendor choice (spend → Owner) | 5–8 | P1 | A, B |
| P0-12 | Render PostgreSQL backup policy and restore rehearsal (non-prod), with measured RPO/RTO | No PG backup evidence; C1-RECOVERY-01 OPEN | `docs/audits/c3-p5a-pitr-rehearsal-*` method | Written policy; restore into fresh instance; row-count and audit-chain verification; timings recorded | Scripted verification (read-only on target) | Operator credentials (human-executed) | 3–5 | P1 | A, B |
| | **Phase 0 total** | | | | | | **41–66** | | |

## Phase 1: First repeatable customer

| ID | Description | Why | Reuse | Acceptance criteria | Tests | Deps | Effort | Pri | Blocks |
|---|---|---|---|---|---|---|---|---|---|
| P1-01 | Production EOS Blueprint, parameterized per customer (API, PG, env vars, origins), separate from the non-prod file; production-mode service config replacing the blanket refusal with explicit production fences | No production target platform | `render.yaml` patterns; ADR-011 registry | Template instantiates an environment for `deployment: <customer>` with no code edit; production guards remain fail-closed | Blueprint contract tests (extend `eosApiBlueprint.test.mjs`) | OD-4; C1 programme | 8–12 | P1 | A, B |
| P1-02 | EOS human front door via OIDC delegation (dependency; tracked in Firebase-exit programme FX-AUTH-001) | Firebase Auth is the only login | `(identity_provider, external_subject)`, `eosAccessToken.ts` | Per Firebase-exit programme | — | OD-3a | *(existing programme)* | P1 | A, B |
| P1-03 | Replace runtime use of `OPERATING_COMPANY_IDS` with `eos_policy.tenant_operating_companies` (scope vocabulary, report row scope, finance visibility, pickers) | Second customer's companies invisible to scoping | `tenantOperatingCompanies.ts`, reconcile CLIs | No runtime branch on TAYLOR/VENTANA ids; Taylor behaviour byte-identical (parity) | Parity tests for Taylor; new-company fixture tests | OD-8, parity fence | 8–12 | P1 | A, B |
| P1-04 | Reporting calendar from governed configuration (`business_time_zone`, fiscal calendar per operating company) | `TAYLOR_VENTANA_REPORTING_CALENDAR` hardcoded | `configuration_setting_definitions` (`1764500000000`) | Calendar resolved from config; Taylor values preserved | Unit tests both sides (server and client mirror) | — | 3–5 | P2 | A, B |
| P1-05 | Line-of-business vocabulary per tenant (replace `ACCOUNT_LINES_OF_BUSINESS=["TAYLOR","VENTANA"]`) | Product coupling in CRM, finance, intercompany UI | Metadata definitions (`metadata/definitions/account.js`); SQL column already generic | Vocabulary from tenant config; Taylor unchanged | CRM PG tests; UI tests | OD-8 | 5–8 | P2 | A, B |
| P1-06 | Shell identity and branding from tenant profile (`AppRail.jsx:387`, `AuthShell.jsx:39`) | Customer name hardcoded | Tenant `name`; brand tokens in `index.css` | Shell shows tenant/company name from data | Component tests | — | 2–3 | P2 | A, B |
| P1-07 | Generalize Taylor/Ventana ownership and custody semantics (`inventoryControlLifecycle.ts:76-91`, rental "Taylor custody", accounting strings) into operating-company roles | Domain logic names customer companies | Operating-company authority | Semantics expressed as roles (e.g. title-holding company vs servicing company); Taylor parity proven | Full inventory/rental parity suites | **OD-8, parity fence (protected)** | 8–12 | P2 | A, B |
| P1-08 | Production-capable, audited tenant provisioning command (API plus platform-operator CLI): tenant, first Owner/Administrator, operating companies, baseline grants | `bootstrapEosTenant.mjs` is non-prod CLI only | `tenantBootstrap.ts`, `bootstrapFirstOwner` | Idempotent; audited; refuses without Owner-authorized operator; works for any tenant key | PG tests; dry-run plan output | P1-01, P1-11 | 8–10 | P1 | A, B |
| P1-09 | Employee invite and principal creation in Administration (replaces operator scripts for ordinary onboarding) | Principal creation is script-only | `createEmployee`, `linkEmployeePrincipal` (no screen calls them yet) | Tenant admin invites by email; identity binds on first OIDC login; audited | PG and UI tests | P1-02 | 5–8 | P1 | A, B |
| P1-10 | Per-tenant entitlements and module activation, consulted with environment activation (environment = may; tenant = does) | Activation keyed by Firebase project id | `environmentCapabilityOverrides.ts`, `permissionCatalog.ts` | Two tenants in one environment can differ in modules; enforcement server-side; UI hides non-entitled modules | PG and client tests | OD-5 | 10–15 | P1 | B (A soft) |
| P1-11 | Tenant-neutral authority baseline seed (remove `"tenantKey": "taylor-nonprod"` pinning from `roleCapabilityAuthorityBaseline.json`) | Grant baseline tied to one tenant | Existing baseline replay (#210 addendum) | Baseline applies to any tenant; Taylor replay still equals nonprod 542 | Replay parity test | — | 3–5 | P1 | A, B |
| P1-12 | Data Import on PostgreSQL adapters (customers, parts, equipment, opening inventory, service history) | Import refuses CUSTOMERS/PARTS after cutovers; equipment still Firestore | `dataImport/*` contracts (ADR-015 seam) | Import into PG under the importer's own authority; preview before write preserved | Existing data-import suites ported to PG | Domain cutovers | 10–15 | P1 | A, B |
| P1-13 | Generalize production guards from `"taylor-parts"` literals to registry `role === "production"` allow-lists | N production projects coming | ADR-011 `isKnownProjectId()` | No customer-named literal in guards; invariant test retained | Guard tests | — | 3–5 | P2 | A |
| P1-14 | Second-customer onboarding runbook and checklist (see onboarding doc) | Onboarding is tribal knowledge | `docs/provisioning/*` manifests | Runbook executes end to end on a synthetic customer | Rehearsal record | P1-08 | 3–5 | P1 | A |
| P1-15 | Multi-project warehouse backup codec (`warehouseBackupCodec.ts:147`) | Single-customer tool | — | Codec accepts registry production projects | Unit tests | P1-13 | 1–2 | P3 | A |
| P1-16 | Tenancy ADR and documentation drift reconciliation (DeploymentModeStrategy §4, DECISIONS references, CURRENT.md) | Docs say "no tenancy" | This assessment | ADR accepted by Owner; stale statements annotated | — | Owner review | 2–3 | P2 | — |
| P1-17 | Synthetic different-industry customer rehearsal (e.g. a non-frozen-dessert service company) | Proves decoupling | Seed tooling | Provisioned, configured, operated by personas with zero code edits | Rehearsal evidence | P1-03..P1-12 | 5–8 | P1 | A |
| | **Phase 1 total** (excluding P1-02) | | | | | | **84–128** | | |

## Phase 2: Commercial SaaS foundation

| ID | Description | Why | Reuse | Acceptance criteria | Tests | Deps | Effort | Pri | Blocks |
|---|---|---|---|---|---|---|---|---|---|
| P2-01 | Verenward Commercial Control Plane MVP (separate service): customer register, deployments, plans, entitlement sets, contacts | No commercial system of record | — | Register drives entitlements for every deployment | Service tests | OD-5 | 15–25 | P2 | B |
| P2-02 | Billing provider integration (invoices, payment, dunning) | Collect revenue at scale | — | Invoice generated from plan and seats | Provider sandbox tests | OD-6, P2-01 | 10–15 | P3 | B |
| P2-03 | Entitlement sync from control plane to EOS (signed, cached, fail-safe for existing operations) | Decouple commercial from operational | P1-10 | Change propagates; outage does not stop operations | Contract tests | P1-10, P2-01 | 5–8 | P2 | B |
| P2-04 | Seat and usage metering events (append-only, tenant-keyed) | Seat/usage pricing | `tenant_memberships`; AI telemetry builders | Monthly seat/usage report per tenant | PG tests | P2-01 | 5–10 | P3 | B |
| P2-05 | Tenant suspend/resume/retire commands (Owner-protected, audited) | Status column has no writer | `principalContext.ts` refusal | Suspended tenant refused on every route; resume restores | PG tests | — | 3–5 | P1 | A, B |
| P2-06 | Tenant export (full, machine-readable, with audit) | Portability, offboarding, contracts | Domain read models | Export reproducible, complete, verified by row counts | PG tests | — | 8–12 | P1 | A, B |
| P2-07 | Tenant purge with retention policy (reconciled with immutable audit) | Cancellation and data deletion | Down-migration safety patterns | Policy-driven purge; audit retention per policy | PG tests | Owner/counsel retention policy | 8–12 | P2 | B |
| P2-08 | Audited, time-bound, Owner-approved support access plus diagnostic bundle | No support path | `previewMyWorkAs` (View as user) pattern | Support access logged and expiring; no write unless granted | PG tests | — | 8–10 | P1 | A, B |
| P2-09 | SLOs, alert routing, status page, incident-response runbook | No SLA/IR | P0-11 | Documented SLOs; IR drill performed | Drill record | P0-11 | 5–8 | P1 | A, B |
| P2-10 | Cost register and per-tenant attribution | No run-rate | Cost model formulas | Monthly cost per deployment/tenant | — | P0-11 | 3–5 | P1 | — |
| P2-11 | Audit export (CSV/API, SIEM-friendly) | Enterprise requirement | `readPolicyAuditHistory` | Tenant admin exports filtered audit | PG and UI tests | — | 3–5 | P2 | — |
| P2-12 | Fleet release management: deploy and migrate N deployments, scheduled drift checks | Scenario A operations | `deploymentDrift.mjs`, `checkDeployedVersions.mjs`, release provenance guard | One release train; drift report daily | Tooling tests | P1-01 | 6–10 | P1 | A (≥3 customers) |
| | **Phase 2 total** | | | | | | **79–125** | | |

## Phase 3: Enterprise capabilities

| ID | Description | Why | Reuse | Acceptance criteria | Tests | Deps | Effort | Pri | Blocks |
|---|---|---|---|---|---|---|---|---|---|
| P3-01 | Per-tenant SSO (OIDC; SAML via broker) | Enterprise requirement | Provider-neutral identity seam | Tenant admin configures IdP; JIT link to Employee | Integration tests with test IdP | P1-02 | 10–15 | P2 | — |
| P3-02 | MFA policy (IdP-enforced or EOS step-up for privileged actions) | Enterprise and security | Protected Administrator/Owner model | Privileged actions require MFA claim | Tests | P3-01 | 5–8 | P2 | — |
| P3-03 | SCIM provisioning | Enterprise lifecycle | `createEmployee`/principal commands | Joiner/mover/leaver via SCIM, audited | Conformance tests | P3-01 | 8–10 | P3 | — |
| P3-04 | Dedicated-deployment IaC automation (one command per customer) | Scenario A at scale | P1-01 | New environment in <1 day, reproducible | Teardown/rebuild drill | P1-01 | 10–15 | P2 | — |
| P3-05 | SOC 2 readiness programme: policies, control matrix, evidence automation | Enterprise questionnaires | Existing technical controls | Policies adopted; evidence collected for audit window | — | OD-9; auditor (spend) | 25–40 | P2 | — |
| P3-06 | External penetration test and remediation | Assurance | — | Report; criticals fixed | — | Vendor (spend) | 5–10 | P2 | — |
| P3-07 | DR: HA topology, replicas, proven RTO/RPO, optional multi-region | Availability commitments | P0-12 | Failover drill meets stated RTO/RPO | Drill record | P0-12 | 10–15 | P2 | — |
| P3-08 | Access reviews, session policy, IP allowlisting per tenant | Enterprise controls | Effective access explanation; role holders | Quarterly review export; policies enforced | Tests | P3-01 | 8–12 | P3 | — |
| P3-09 | First accounting/ERP connector | Finance handoffs are PENDING_DESTINATION | `eosFinance/accountingDelivery.ts` contract | Live handoff to one system, reconciled | Contract tests | Vendor choice | 15–25 | P2 | — |
| P3-10 | Data residency / region selection for dedicated deployments | Enterprise contracts | P1-01 | Region declared per deployment | — | P3-04 | 5–10 | P3 | — |
| P3-11 | Customer security documentation pack (security overview, subprocessor list, DPA support) | Sales enablement | This assessment | Pack reviewed by counsel | — | Counsel | 3–5 | P2 | — |
| P3-12 | Load/performance testing and capacity plan; worker/queue introduction where required | Scale | — | Documented limits per plan tier | Load test suite | P0-11 | 5–8 | P3 | — |
| | **Phase 3 total** | | | | | | **109–173** (+ vendors) | | |

## Phase 4: Optional AI and industry extensions

| ID | Description | Why | Reuse | Acceptance criteria | Tests | Deps | Effort | Pri | Blocks |
|---|---|---|---|---|---|---|---|---|---|
| P4-01 | Wire Contextual Assistant behind a per-tenant entitlement; read-only tools under the requesting principal's authority | Library exists, not wired | `assistant/*` (fail-closed, PRIVATE_ONLY default) | AI disabled = no behaviour change; enabled = answers only from reads the caller may perform | Extend `assistantSecurityBoundary.test.mjs`; PG authorization tests | P1-10, OD-11 | 8–12 | P3 | — |
| P4-02 | Persist AI audit and usage records per tenant | Builders exist, never persisted | `assistantTelemetry.ts` | Every AI call audited (no prompt content unless policy allows); usage per tenant | PG tests | P4-01 | 3–5 | P3 | — |
| P4-03 | Per-tenant AI gateway routing (replace env-wide `AI_SELF_HOSTED_TENANT_ID`) | One gateway tenant per environment | `aiProviderConfig.ts` | Gateway tenant derived from actor tenant | Unit tests | P4-01 | 3–5 | P3 | — |
| P4-04 | Industry package mechanism (vocabularies, equipment display, templates, workflow seeds) | Second industry | Metadata definitions; workflow seeds | A package applied at provisioning; base EOS unchanged | Package contract tests | P1-05, P1-17 | 15–25 | P3 | — |
| P4-05 | Transactional event outbox plus outbound webhooks | Integration fabric | Append-only history tables | At-least-once delivery, tenant-scoped, signed | PG tests | P3-12 | 10–15 | P3 | — |
| P4-06 | Analytical export / BI connector (tenant-scoped) | Enterprise analytics | `eosAnalysis/*` governed facts | Scheduled tenant export to customer destination | Tests | P4-05 | 10–15 | P3 | — |
| P4-07 | Human-approval flow: AI proposal → human executes governed command (AI never holds authority) | Consequential actions | `AI_OPERATIONAL_ACTION_DENIED` stance | Proposal shown; only the human's own command executes | Tests | P4-01 | 5–8 | P3 | — |
| P4-08 | Customer-hosted data plane adapter pilot (ADR-015 model 2/3) | Enterprise data-residency demand | ADR-015 seam | One domain operating over a customer-held store | Contract tests | Owner | 15–25 | P3 | — |
| | **Phase 4 total** | | | | | | **69–110** | | |

## Effort summary

| Phase | Engineer-days |
|---|---|
| 0 | 41–66 |
| 1 | 84–128 |
| 2 | 79–125 |
| 3 | 109–173, plus auditor and pen-test vendors |
| 4 | 69–110 |
| **Total** | **382–602** |

**Five managed customers (minimum):** Phases 0 and 1, plus P2-05, P2-06, P2-08, P2-09, P2-10 and P2-12, with contracts and invoicing handled outside EOS. That comes to **158–244 engineer-days**, after Customer 1 production cutover and the FX-AUTH-001 front door.

## Parallelism with Firebase retirement and Administrator work

**Safe now:** these touch none of the Firebase-exit or Administrator owned paths.
- P0-01, P0-02, P0-04, P0-05, P0-06, P0-07, P0-09, P0-11, P0-12
- P1-04, P1-06, P1-11, P1-13, P1-16
- P2-01 design

**Coordinate first:**
- P0-08 (exit guard files)
- P0-10 and P1-09 (session/front door)
- P1-03, P1-05 and P1-07 (parity fence; protected semantics)
- P1-10 (`environmentCapabilityOverrides.ts`, a shared file)
- P1-12 (domain cutovers)
- P0-03 (migrations; serialize with active migration lanes)

## Owner decisions required

| ID | Decision | Recommendation (non-binding) |
|---|---|---|
| OD-1 | First commercial launch model | Scenario A, designed to evolve into C |
| OD-2 | Repository visibility; branch protection (repo-admin action) | Private repository; protect `main` immediately |
| OD-3 | Isolation backstop strategy (RLS vs mandatory query layer) | PostgreSQL RLS (standard, auditable, defence in depth) |
| OD-3a | Human front door | OIDC delegation to an external IdP before any EOS-native password store |
| OD-4 | Production EOS Blueprint authorization (production infrastructure) | Authorize design now; deployment remains a separate gate |
| OD-5 | Commercial control plane as a separate service; per-tenant entitlements in EOS | Yes |
| OD-6 | Billing/payment provider | Defer until ≥3 customers; invoice manually first |
| OD-7 | Pricing and packaging (C1-COMM-01) | Dedicated tier priced on fixed floor plus operations; module add-ons |
| OD-8 | Generalizing Taylor/Ventana semantics inside the parity fence | Authorize as parity-preserving refactors with explicit parity proofs |
| OD-9 | SOC 2 pursuit and timing | Start policy work with the first enterprise prospect |
| OD-10 | Legal entity and IP documentation (Verenward LLC vs `LICENSE`/`OWNERSHIP.md`) | Owner/counsel only; not a repository action |
| OD-11 | AI hosting model (private gateway vs rented compute vs external providers) | Keep PRIVATE_ONLY default; price as add-on |
| OD-12 | Data residency and retention commitments | Define with counsel before the first enterprise contract |
