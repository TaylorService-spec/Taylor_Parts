# SaaS Security & Tenancy Assessment

Issued: 2026-10-11 04:15:00 -0700 (America/Phoenix) · Baseline: `main @ c73ce647` · Status: ASSESSMENT ONLY

Scope: tenancy and isolation, identity, authorization, API security, and secrets. Nothing was tested against live data. Findings come from code, migrations and CI test suites. Every PostgreSQL test cited runs in CI against a `postgres:16` service (`.github/workflows/eos-admin-policy-tests.yml`), and is skipped locally unless `POLICY_TEST_DATABASE_URL` is set.

## 1. Two tenancy planes

| Plane | Tenancy | Evidence | Confidence |
|---|---|---|---|
| **PostgreSQL / EOS API** (target) | **Real.** The tenant is derived on the server from verified identity plus active membership. A client-named tenant is only a hint that is checked against memberships. Errors: `TENANT_NOT_A_MEMBERSHIP`, `AMBIGUOUS_TENANT`, `TENANT_NOT_ACTIVE`. | `functions/src/adminPolicy/principalContext.ts:112-123, 180-250 (196-211)`. The token verifier takes only `uid` and ignores claims (`eosApi/server.ts:160-175`). The EOS token refuses any `tenantId` claim (`eosAuth/eosAccessToken.ts:41-44, 288-290`). | High |
| **Firestore / Firebase** (production today, residual non-prod) | **None.** A Firebase project is the isolation unit. | `firestore.rules` L1395–1399 ("no per-account tenancy at all … #140 is authoritative"). Tenant scope in the Firestore resolver is "reserved and inert until Issue #140" (`access/resolveEffectivePermission.ts:150-165`). `field-ops-app-vite/src/domain/usernames.js:242` calls `tenantId` an "inert placeholder". | High |

**Implication:** anything that still reads Firestore can only be isolated per Firebase project. As long as any customer-facing screen reads Firestore (19 client files per `firebase-exit-baseline.json`), a shared multi-tenant environment is unsafe. Dedicated per-customer projects are safe.

## 2. PostgreSQL isolation mechanics

- **Schema:**
  - 162 `CREATE TABLE`s. Only 6 lack `tenant_id`, all global by design: `tenants`, `principals`, `capabilities`, `principal_identities`, `supported_languages`, `configuration_setting_definitions`.
  - About 49 composite `PRIMARY KEY (tenant_id, …)` and many composite `(tenant_id, …)` FKs. These stop a row in one tenant from referencing a row in another.
- **Enforcement layer:** application query predicates only.
  - **No `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` in any migration.**
  - One shared database and role per environment (`render.yaml`, user `eos`).
  - Schemas are split by domain, not by tenant.
- **Query sampling:** 1,037 SQL literals in `functions/src` were scanned. 38 lack a tenant predicate. The ones reviewed are benign:
  - global vocabulary tables and `to_regclass` probes;
  - fragments whose callers append `WHERE tenant_id = $1` (`catalogMaster/catalogRows.ts:97-109` → `postgresCatalogReads.ts:51,72,392`);
  - updates by a row id previously read under a tenant filter;
  - a token-hash lookup (`eosOps/selfScheduling.ts:430`).
- **Residual risks:**
  - **R-T1, no backstop.** Nothing structural guarantees the predicate, such as RLS or a mandatory tenant-scoped repository. One forgotten `WHERE tenant_id` would leak silently. **Severity: High** for a shared environment.
  - **R-T2, cross-tenant existence oracle.** Some tables have a global `id` primary key. Example: `eos_workforce.employees`, read with `WHERE id = $1` across tenants (`eosWorkforce/.../employeeCreationCommand.ts:181`; the in-code comment acknowledges it). This can reveal whether an id exists in another tenant. **Severity: Medium.**
  - **R-T3, multi-membership users.** The frontend never sends `x-eos-tenant`. A principal in two tenants receives `AMBIGUOUS_TENANT`. This fails safe, but it means multi-tenant users (for example Verenward support staff) are not supported. **Severity: Low (security) / Medium (product).**

## 3. Can Tenant A reach Tenant B?

| Path | Result (PostgreSQL plane) | Evidence | Confidence |
|---|---|---|---|
| API requests | **Refused.** Tenant comes from membership, spoofed tenant is refused, explicit `tenantId` body fields are rejected (`FIELD_NOT_ACCEPTED`). | `test/adminPolicyAuthorization.test.mjs:439`, `adminPolicyIdentity.test.mjs:298`, `adminPolicyWorkflow.test.mjs:669`, `commercialPersonaJourneyPostgres.test.mjs:473`, `catalogReferenceAuthorityPostgres.test.mjs:114`, `assignableEmployeePostgres.test.mjs:219`, `myWorkPostgres.test.mjs:167-193` | High (CI) |
| Direct database access | **Not isolated.** Any holder of the database credential sees all tenants (no RLS, single role). Mitigation: internal-only network (`ipAllowList: []`) and a credential injected by Render. | `render.yaml:46-54` | High |
| Background jobs | The inbound mail poller is **deliberately cross-tenant**. It iterates `(tenant_id, id)` per mailbox and joins on `tenant_id`, under one global advisory lock. It is tenant-correct by construction; cycle-level cross-tenant tests are limited. | `eosOps/inboundProviderRuntime.ts:706-721`; `inboundProviderRuntimePostgres.test.mjs` | Medium |
| Reporting / Analysis | Analysis receives `actor.tenantId` plus company/warehouse scope. **No dedicated cross-tenant Analysis test located.** Legacy Firestore reporting is bounded by operating company only (`reporting/reportRowScope.ts`). | `eosAnalysis/analysis.ts:124-137` | Medium (PG) / N/A (Firestore) |
| Search (`searchEos`) | Composed from existing governed reads under their own scope (#209 §4). Covered by `myWorkPostgres.test.mjs`. | DECISIONS #209 | Medium |
| File attachments | Stored in PostgreSQL with `tenant_id`; Firebase Storage is deny-all. | `1764350000000_inbound-provider-runtime.sql`, `storage.rules` | High |
| Administrative functions | Tenant-scoped (`getMembership(actor.tenantId, …)`). **No cross-tenant platform-operator plane exists.** This is safe, but there is no supported support-access path. | `adminPolicy/adminPolicyApi.ts:418-449, 594`; `administrationControlPlaneSecurityPostgres.test.mjs` | High |
| Integration credentials | Connections are tenant-keyed, but Secret Manager names are `eos-email-connection-<connectionId>` **without a tenant**, in one GCP project. Isolation depends on globally unique connection ids. | `inboundWork/providerCredentialVault.ts:40-46` | Medium |
| Optional AI | Assistant refuses a mismatched `companyId` (`assistantContext.ts:90-92`; `assistantSecurityBoundary.test.mjs:210`). The gateway tenant is **one per environment** via env var (`AI_SELF_HOSTED_TENANT_ID`, `aiProviderConfig.ts:83-88`). Not wired to any route. | | Medium |

**Verdict:** within the PostgreSQL API, Tenant A cannot reach Tenant B through any path tested. Isolation depends entirely on application code, though. The Firestore plane offers no tenant isolation inside a project. The direct-database path is open to anyone holding the credential.

## 4. Three tenancy capabilities, assessed separately

| Capability | Status | Evidence |
|---|---|---|
| **A. Multiple operating companies within one customer** | **Implemented + tested (PG)**; partially hardcoded in legacy and runtime constants | `eos_policy.tenant_operating_companies` (PK `(tenant_id, operating_company_id)`, `1759968000000`); 41 migrations reference operating company; intercompany (`1764490000000`); Taylor/Ventana/Consolidated analysis (#209). **But** `OPERATING_COMPANY_IDS {TAYLOR, VENTANA}` (`ownership/operatingCompanyAuthority.ts:21-24`) drives scope vocabulary (`access/trustedWriterCommands.ts:319`), report row scope (`reporting/reportRowScope.ts:99-100,312`) and finance visibility (`finance/financeReadCallables.ts:120`). |
| **B. Multiple unrelated customers in one environment** | **Partially implemented.** PG model and tests exist; never instantiated beyond one tenant (`eos-real-nonprod-activation.md`). Blocked by the Firestore plane, environment-scoped activation, no RLS, and operator-only provisioning. | §1–§3 |
| **C. Dedicated deployments per enterprise customer** | **Designed; partially enabled.** ADR-011 separates `role` from `deployment` ("a second customer is `role: production, deployment: <customer>` with no code change"). ADR-015 scopes Verenward-hosted, customer-hosted and adapter data planes. **No production blueprint, no IaC per customer, and hardcoded project-id literals (`taylor-parts`, `eos-platform-sandbox`, `eos-platform-certification`): 21 occurrences in 9 `functions/src` files, 132 in operator scripts, 21 in workflows.** | `docs/architecture/ADR-011-environment-configuration-architecture.md` §1, §5; `render.yaml:30-32` |

## 5. Identity and authentication

| Item | Status | Evidence |
|---|---|---|
| API token verification | Implemented + tested. Firebase ID token → `uid` only; composite verifier routes EdDSA tokens to the EOS verifier. | `eosApi/server.ts:160-175`; `eosAuth/eosAuthHttp.ts:48-61` |
| Provider-neutral principals | Implemented + tested. `principals.id` is EOS-native, and `(identity_provider, external_subject)` is a mapping. Identity bindings are append-only, revoke-once. | `1757548800000_tenant-and-identity.sql`, `1764200000000_eos-principal-identities.sql`; `principalIdentityRebindPostgres`, `ownerIdentityBindingPostgres` |
| Per-request revocation | Implemented + tested. Every request re-checks principal status, membership, tenant status and employee access eligibility; `accessVersion` is read. | `principalContext.ts:187-247` |
| EOS session token | Implemented, **not deployed**. Ed25519, ≤900 s, kid/environment fence; production verifier refuses non-prod keys. | `eosAuth/eosAccessToken.ts`; `docs/architecture/eos-identity-session-foundation.md:3` |
| Human login (EOS-native) | **Missing.** Humans sign in with Firebase email/password (`auth/AuthContext.jsx:170`). EOS session refused in production builds (`auth/eosSession.js:45`). | |
| Token revocation (individual) / logout invalidation | Missing. No `jti` denylist; Firebase `checkRevoked` not used (mitigated by per-request principal checks). | `server.ts:169` |
| Password recovery | Implemented + tested (Firebase self-service; admin-initiated reset on the legacy `users/{uid}.role==="admin"` gate, sandbox only). | `domain/passwordRecovery.js`; `access/adminCredentialCommands.ts` |
| MFA | Missing | No code |
| SSO / OIDC / SAML / SCIM | Designed seam only (an OIDC verifier is "a change to `server.ts` alone", `server.ts:10-11`); explicitly out of scope for the identity foundation | `eos-identity-session-foundation.md:39-43` |
| Firebase Auth retirement | Designed; `FX-AUTH-001` TRANSITIONAL. Step 7 (human front door, then retirement) not authorized. | `firebase-exit-manifest.json:14-23` |

**Security implications of retiring Firebase Identity completely.** EOS would take over duties Firebase performs today:

- password hashing and storage, or delegation to an external IdP;
- account recovery email;
- brute-force and credential-stuffing protection;
- session issuance and refresh;
- MFA.

**Recommendation for Owner decision OD-3a:** make the first human front door **OIDC delegation to an external IdP**, for example customer Entra ID / Google Workspace, or a Verenward-operated IdP for SMB customers. Building password storage inside EOS should not come first.

- The provider-neutral principal model already supports this.
- It also delivers enterprise SSO and MFA together.
- Any EOS-native password path needs rate limiting (currently Missing), lockout, breach-password checks and audited recovery before it ships.

## 6. Authorization (accepted 16-persona foundation, preserved)

The model is assessed as-is. No replacement with generic RBAC is proposed.

- **Chain:** Principal → Membership → Security Role → Capability → Scope → Condition → Effective Access (ADR-012). Job Role is a persona/layout selector that "grants nothing" (#209, #210).
  - Work Eligibility: `1760054400000`.
  - Operational Scope (WAREHOUSE / REORDER_QUEUE / MOBILE): `1760097600000`.
  - Functional Role: `1762819200000`.
  - Conditional grants: `1762214400000`.
  - Direct principal grants: `1761436800000`.
- **16 personas:** `functions/src/eosAuth/nonprodPersonas.ts`, `config/sandboxRoleIdentityRegistry.json`. Tests: `personaAuthorityDimensions`, `personaBusinessAccessRegression`, `platformQaPersonaRuntimeMatrixPostgres`.
- **Owner and Administrator protections:**
  - protected roles;
  - no self-appointment or removal;
  - last-Administrator protection;
  - anti-lockout capabilities (`policyCommands.ts:1625-1664`);
  - Owner+Administrator conflict refusal;
  - Administrator authority by standing (#223, `adminPolicy/protectedAdministrator.ts`).
  - Tests: `protectedOwnerInvariantPostgres`, `protectedAdministrator*`, `firstOwnerBootstrapPostgres`.
- **Ownership / accountability / assignment:** separate answers, with history (`docs/security/ownership-accountability-bypass-census.md`).
- **Audit provenance:** `audit_events` is append-only via UPDATE/DELETE/TRUNCATE triggers (`1762646400000:154-172`); Administrator provenance in every direct writer (#225).
- **Status: Implemented + validated in controlled environments (4/5).** Not yet proven in production. Production has "two RoleAssignments on one principal" (CUSTOMER_1_READINESS L59).

**Open authorization items, all Owner-held and not acted on here:**

- DQ-210-A: the `admin` compatibility role holds 56 business capabilities.
- Two-person privileged approval was dropped (`docs/governance/privileged-two-person-approval-gap.md`).
- Two authorization planes coexist (Firestore `users/{uid}.role` and PostgreSQL) until Firebase retirement.

## 7. API and platform security

| Control | Status | Evidence |
|---|---|---|
| CORS | Implemented + tested (explicit allowlist, `*` refused) | `server.ts:121-128`; `eosApiBlueprint.test.mjs` |
| Input limits | Implemented (1 MB body, closed operation lists, NUL refusal) | `adminPolicyHttp.ts:219` |
| Security headers | Partial (`nosniff`, `no-store` only; no HSTS/CSP on API or Vercel) | `adminPolicyHttp.ts:74-81`; `vercel.json` |
| Rate limiting / abuse protection | **Missing**, including the unauthenticated `/public/self-scheduling` route (single-use hashed expiring token mitigates) | `eosOps/selfScheduling.ts:24-26, 339-353` |
| Service-to-service auth | Partial (hashed persona-issuer credential; AI gateway `X-API-Key`; no mTLS/workload identity) | `eosAuthHttp.ts:72-77` |
| Secrets | Implemented: Render-injected `DATABASE_URL`, no secrets in `render.yaml`, gitleaks CI, `functionsSecretIsolation.test.mjs`. **Per-tenant secret isolation weak** (§3). | `.github/workflows/gitleaks.yml` |
| Dependency vulnerability scanning | **Missing** (no Dependabot/CodeQL/npm audit; Render build uses `--no-audit`) | `render.yaml:72` |
| Security monitoring / SIEM / alerting | **Missing** | — |
| Source control protection | **`main` unprotected; repository public** | GitHub API |
| Customer security administration | Partial. Tenant admins manage roles, grants, conditions, employee links and lifecycle in UI. **Creating principals and identities is operator-script only.** **No audit export.** | `employeePrincipalLinkCommands.ts:258`; `scripts/provisionGovernedPrincipal.js` |

## 8. Enterprise customer security requirements: gap list

| Requirement | Status |
|---|---|
| SSO (OIDC/SAML) per tenant | Missing (seam exists) |
| MFA enforcement policy | Missing |
| SCIM provisioning | Missing |
| Audit log export / SIEM stream | Missing (read-only history views exist) |
| Customer-managed access policies | **Exceeds typical**: customer admins govern roles, object grants, conditions and workflows (#210) |
| Access reviews / attestation | Missing (data exists for a report: effective access, role holders) |
| Session policy (idle timeout, device) | Missing |
| IP allowlisting per tenant | Missing |
| Data residency selection | Missing (single region per environment; UNKNOWN for Render region) |
| Encryption at rest / in transit | Provided by the platforms (Render/Vercel/Firebase): UNVERIFIED in repo; no customer-managed keys |

## 9. Priority remediation (detail in the roadmap)

| ID | Item | Severity |
|---|---|---|
| P0-01/02 | Branch protection; repository visibility decision | Critical |
| P0-03 | RLS (or mandatory tenant-scoped query layer) as defence in depth, with tests that fail if a query omits tenant | High |
| P0-04 | Remove global-id cross-tenant reads | Medium |
| P0-05 | Tenant-qualified secret names / per-tenant secret scope | Medium |
| P0-06 | Rate limiting plus HSTS/CSP | High |
| P0-07 | Dependency scanning | High |
| P0-08 | Rule that no unrelated customer shares a Firebase project; Firestore screens excluded from shared tenancy | Critical (shared model) |
| P0-09 | Two-tenant end-to-end isolation suite across every route | High |
| P0-10 | Frontend tenant selection or explicit single-membership rule | Low |
| P3-01/02 | OIDC SSO and MFA (depends on FX-AUTH-001 front door) | High (enterprise) |
