# SaaS Readiness Matrix

Issued: 2026-10-11 04:15:00 -0700 (America/Phoenix) · Baseline: `main @ c73ce647` · Status: ASSESSMENT ONLY

**Maturity scale:**

| Score | Meaning |
|---|---|
| 0 | Missing |
| 1 | Designed |
| 2 | Partially implemented |
| 3 | Implemented but not fully validated |
| 4 | Validated in controlled environments |
| 5 | Proven in repeatable production operations |

No 5 is awarded. No item has repeatable production operations on the target platform. Firebase-era production operation for Customer 1 is noted where it applies.

**Other scales:**
- **Confidence:** H, M or L, for how strong the evidence behind the score is.
- **Severity, business risk and security risk:** Critical, High, Medium or Low.
- **Effort:** engineer-days, taken from the roadmap.
- **Blocks launch:** **A** means it blocks Scenario A (managed dedicated), **B** means it blocks Scenario B (shared multi-tenant), **—** means it blocks neither.

## Matrix

| # | Domain | Current state | Target state | Evidence | Score | Conf | Gap severity | Business risk | Security risk | Effort (d) | Dependencies | Workstream | Blocks launch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Production hosting of target platform | Non-prod Render only; API refuses production | Per-customer production Blueprint, IaC | `render.yaml:30-32`; `server.ts:107-113`; prod `eosApi: null` | 1 | H | Critical | Critical | High | 8–12 (P1-01) + C1 programme | C1 cutover gates, OD-4 | Platform | A, B |
| 2 | Tenancy model (PostgreSQL) | Tenant derived server-side; ~156 tenant-keyed tables; CI cross-tenant tests | Same, instantiated with ≥2 tenants and proven | `principalContext.ts:180-250`; tests in security doc §3 | 4 | H | Medium | Medium | High | 5–8 (P0-09) | — | Platform | B |
| 3 | Isolation defence-in-depth | App predicates only; no RLS; global-id oracle | RLS or mandatory scoped query layer; no global-id reads | 0 `CREATE POLICY` in 95 migrations; `employeeCreationCommand.ts:181` | 0 | H | High | High | Critical | 15–23 (P0-03, P0-04) | OD-3 | Platform | B |
| 4 | Firestore-plane tenancy | None (project = isolation unit) | Retired or excluded from shared tenancy | `firestore.rules` L1395–1399; 280-file exit baseline | 0 | H | Critical (B) | High | Critical (B) | 3–5 (P0-08) + Firebase retirement | Firebase exit programme | Firebase exit | B |
| 5 | Multiple operating companies per customer | PG authority + intercompany + consolidated analysis; runtime constant TAYLOR/VENTANA | Fully data-driven | `1759968000000`; `operatingCompanyAuthority.ts:21-24` | 3 | H | High | High | Medium | 8–12 (P1-03) | Parity fence, OD-8 | Customer/Inventory | A, B |
| 6 | Tenant lifecycle | Create = non-prod CLI; status column with no mutation; no export/delete | Audited create/suspend/resume/export/purge | `tenantBootstrap.ts`; `principalContext.ts:210` | 1 | H | High | High | Medium | 3–5 + 8–12 + 8–12 + 8–10 (P2-05/06/07, P1-08) | OD-5 | Platform | A (export), B |
| 7 | Human authentication | Firebase email/password in production (operated); EOS-native login missing | OIDC front door; Firebase Auth retired | `AuthContext.jsx:170`; `eos-identity-session-foundation.md:3` | 2 | H | Critical | High | High | Firebase-exit programme | FX-AUTH-001 | Platform | A, B |
| 8 | MFA / SSO / SCIM | Seam only | Per-tenant OIDC/SAML, MFA policy, SCIM | `server.ts:10-11` | 1 | H | High (enterprise) | High | High | 23–33 (P3-01/02/03) | #7 | Platform | — (enterprise tier) |
| 9 | Authorization model (16-persona) | Full chain; Owner/Admin protections; CI-validated | Proven in production | ADR-012; #209/#210/#223; PG suites | 4 | H | Low | Low | Medium | — | Production cutover | Administration | — |
| 10 | Audit and provenance | Append-only PG audit; history tables | Plus export, retention policy | `1762646400000:154-172` | 4 | H | Medium | Medium | Medium | 3–5 (P2-11) | OD retention | Platform | — |
| 11 | API security (rate limit, headers, abuse) | CORS, input limits; no rate limit, no HSTS/CSP | Rate limits incl. public route; headers | `adminPolicyHttp.ts:74-81`; `selfScheduling.ts` | 2 | H | High | Medium | High | 3–5 (P0-06) | — | Platform | A, B |
| 12 | Secrets and integration credential isolation | Render-injected; gitleaks; secret names not tenant-qualified | Tenant-qualified / per-tenant scope | `providerCredentialVault.ts:40-46` | 3 | M | Medium | Low | Medium | 2–3 (P0-05) | — | Platform | B |
| 13 | Source control and CI enforcement | 151 workflows; `main` unprotected; public repo; no CODEOWNERS | Protected `main`, required checks, private source | GitHub API | 2 | H | Critical | Critical (IP) | High | 2–4 (P0-01/02) | OD-2 | Coordination | A, B |
| 14 | Dependency / vulnerability management | gitleaks only | Dependabot/CodeQL, patch SLA | No `dependabot.yml`; `render.yaml:72 --no-audit` | 1 | H | High | Medium | High | 1–2 (P0-07) | — | Platform | A, B |
| 15 | Provisioning and onboarding | Operator CLIs and manifests; admin UI for roles/warehouses | Audited provisioning API, invites, runbook | ops in onboarding doc | 2 | H | High | High | Medium | 8–10 + 5–8 + 3–5 (P1-08/09/14) | #7 | Platform/Administration | A, B |
| 16 | Configurability and entitlements | Per-environment activation; 2 governed settings; custom fields and workflows | Per-tenant entitlements; config replaces constants | `environmentCapabilityOverrides.ts:467-670` | 2 | H | High | High | Low | 10–15 (P1-10) | OD-5 | Platform | A (soft), B |
| 17 | Customer decoupling (Taylor/Ventana) | ~44 non-comment runtime lines in `functions/src`, 63 in client | Data-driven vocabularies, branding, calendars | onboarding doc §C | 2 | H | High | High | Low | 18–28 (P1-04/05/06/07) | OD-8, parity fence | Customer/Inventory | A, B |
| 18 | Business-domain coverage | Broad; PG cutovers non-prod; Firebase-era accepted families | Same domains live on PG in production | Architecture inventory §4 | 4 | M | Medium | Medium | Low | (existing C1 programme) | C1 gates | Domain lanes | A, B |
| 19 | Data import / export / portability | Import sandbox-only on Firestore adapters; no export | PG import; tenant export | `dataImportCallables.ts:404,425` | 2 | H | High | High | Medium | 10–15 + 8–12 (P1-12, P2-06) | Cutovers | Platform | A, B |
| 20 | Integrations (email, ERP, webhooks) | M365/Gmail inbound built, unbound; ERP registry empty; no webhooks | Bound mailbox; first accounting adapter; event outbox | `accountingDelivery.ts:12` | 2 | H | Medium | High | Low | 15–25 + 10–15 (P3-09, P4-05) | OD vendor | Platform | — |
| 21 | Commercial / billing / subscriptions | Missing (EOS business invoicing exists separately) | Control plane plus provider | commercial doc §2 | 0 | H | High | Critical | Low | 15–25 + 10–15 + 5–8 + 5–10 (P2-01..04) | OD-5/6/7 | Commercial control plane | B (A can bill manually) |
| 22 | Observability and alerting | None | Structured tenant-tagged logs, errors, metrics, alerts, SLOs | `c3-delivery-reliability…md:115-117` | 0 | H | Critical | High | High | 5–8 + 5–8 (P0-11, P2-09) | — | Platform | A, B |
| 23 | Backup / restore / DR (target) | Firestore PITR executed; PG none; Auth uncovered | Proven PG restore; RTO/RPO; HA | ops doc §4 | 1 | H | Critical | Critical | Medium | 3–5 + 10–15 (P0-12, P3-07) | — | Platform | A, B |
| 24 | Background processing / scale | Synchronous; in-process poller; single instance | Queue/workers; autoscaling | `inboundProviderRuntime.ts:750` | 1 | H | Medium | Medium | Low | 5–8 (P3-12) + queue in P4-05 | — | Platform | — (until scale) |
| 25 | Release management across deployments | Strong single-environment discipline; manual drift checks | Fleet deploy plus scheduled drift | `deploymentDrift.mjs` | 3 | H | Medium | Medium | Medium | 6–10 (P2-12) | #1 | Platform | A (≥3 customers) |
| 26 | Support operations | None (no diagnostics, no support access, no SLA) | Audited support access, intake, SLA | `PlatformOperatingModel.md:88` | 0 | H | High | High | Medium | 8–10 (P2-08) | C1-SUPPORT-01 | Operations | A, B |
| 27 | Compliance programme (SOC 2, DPA, privacy, IR) | Technical controls only | Policies, evidence, audit | ops doc §6 | 1 | H | High | High (enterprise sales) | Medium | 25–40 + 5–10 + 3–5, plus vendors (P3-05/06/11) | OD-9 | Org / counsel | — (A for enterprise deals) |
| 28 | Optional AI | Library implemented, fail-closed, not wired; external gateway | Per-tenant enablement, metered, audited | `assistant/*`, `ai/*` | 2 | H | Low | Low | Medium | 19–30 (P4-01/02/03/07) | OD-11 | AI | — |
| 29 | Cost visibility and unit economics | No run-rate; Firestore protection measured | Cost register, per-tenant attribution | cost doc §1 | 1 | H | Medium | High | — | 3–5 (P2-10) | — | Operations | — |
| 30 | Industry extensibility | Frozen-dessert vocabulary in places; no extension mechanism | Industry packages | `wholeUnitAssetDisplay.js:68-69` | 1 | M | Medium | Medium | — | 15–25 (P4-04) | #17 | Product | — (second industry) |

## Assessment against three standards

| Standard | Meets / exceeds | Partially meets | Fails |
|---|---|---|---|
| **Traditional SMB SaaS** | Domain depth (exceeds), admin self-service of roles (exceeds) | Configurability, onboarding (admin UI exists) | Signup, billing, self-service provisioning, production multi-tenant runtime, support/SLA |
| **Enterprise SaaS** | Authorization explainability, ownership/accountability, append-only audit, release evidence discipline (exceed) | Tenancy (PG), secrets, CI | SSO/MFA/SCIM, isolation defence-in-depth, observability, DR proof, compliance evidence, audit export, branch protection |
| **Enterprise Operations Platform** | Domain breadth across service/sales/inventory/finance/rental; governed workflows; multi-company with intercompany; persona workspaces (meets/exceeds) | Configurability (workflows, custom fields, policy profile exist; activation is per environment); integrations | Industry extension mechanism; ERP connector; event/webhook integration fabric |

## Commercial launch scenarios

| | **A — Managed dedicated deployment** | **B — Shared multi-tenant SaaS** | **C — Hybrid (shared core plus optional dedicated)** |
|---|---|---|---|
| **Required architecture** | One production environment per customer (Render API + PG + Vercel + Firebase project until retired); registry entry per customer (ADR-011 already models this); IaC template | One production environment; PG tenancy with backstop; Firestore fully retired for in-scope modules; per-tenant entitlements; self-service provisioning | Both, with one control plane and one release train; tenant model identical in both |
| **Current readiness** | Closest. Blocked by matrix rows 1, 7, 13, 17, 22, 23, plus C1 production cutover | Furthest. Additionally blocked by rows 3, 4, 6, 15, 16, 21 | Follows A, then B |
| **Security implications** | Strong isolation (separate DB and Firebase project); blast radius one customer; credential sprawl must be managed | Isolation rests on application code unless RLS lands; one breach exposes all | Enterprise isolation where sold; shared risk confined to SMB tier |
| **Cost implications** | Fixed floor × customers; linear operations cost unless automated | Lowest per-customer marginal cost; step costs in DB/API | Mixed; highest platform-engineering cost, best margin flexibility |
| **Operational complexity** | N deployments to patch, migrate, monitor; needs fleet release (P2-12) | One deployment; complex tenant operations (export, purge, noisy neighbours) | Highest |
| **Time to launch** (after Customer 1 production cutover) | Phase 0 + Phase 1 + minimum Phase 2 ≈ 158–244 engineer-days | Add rows 3/4/6/15/16/21 and full Phase 2: ≈ 300+ engineer-days, plus Firebase retirement complete | A first, then B increment |
| **Implementation dependencies** | C1 cutover; production Blueprint (OD-4); OIDC front door; decoupling; observability; PG backup | All of A plus Firebase retirement, RLS, entitlements, control plane, billing | A and B |
| **Main risks** | Operations toil; configuration drift across customers; per-customer code edits in `environments.json` | Cross-tenant leak; noisy neighbour; premature before Firestore exit | Two operating models at once with a small team |
| **Recommended first milestone** | **"Customer 2 dedicated":** a second customer (different industry if possible) provisioned from template with zero code edits to customer constants, isolated, monitored, backed up, restored once | "Two synthetic tenants in one non-prod environment pass the full isolation suite" (P0-09), as a proof, not a launch | — |

**Recommendation:** pursue **Scenario A** first. Plan its tenant-scoped PostgreSQL work (P0-03, P1-08, P1-10, P2-01) so that every A deployment is already a single-tenant instance of the shared model. **Scenario C** is then a hosting change, not a re-architecture. Revisit **Scenario B** only for a low-touch SMB tier, after Firebase retirement and Phase 0 are complete.
