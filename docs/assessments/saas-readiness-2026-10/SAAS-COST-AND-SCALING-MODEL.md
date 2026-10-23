# SaaS Cost & Scaling Model

Issued: 2026-10-11 04:15:00 -0700 (America/Phoenix) · Baseline: `main @ c73ce647` · Status: ASSESSMENT ONLY

**Rule for this document:** no vendor price or usage volume is invented. Where the repository records a measured cost, it is cited. Everywhere else, costs are **symbols** that the Owner fills from current vendor invoices or price pages, and volumes are **scenario assumptions** marked as such.

## 1. Known cost evidence in the repository

| Item | Evidence | Value |
|---|---|---|
| Render non-prod database plan | `render.yaml:46-54` | Plan name `basic-256mb`, Postgres 16. **No price recorded.** |
| Render non-prod API plan | `render.yaml:57-75`; `docs/architecture/eos-real-nonprod-activation.md:448` | `starter` ("0.5c-512mb"). **No price recorded.** |
| Firestore protection (PITR plus backups), production | `docs/audits/c3-p2-p4-sizing-20260806/README.md:7,36-39,53,55` | Measured ≈ $0.002/month at current size. SKU rates recorded at the time: $0.15/GiB-month storage/PITR, $0.03 backup. $14.10/month at a 10 GiB upper bound. Full restore ≈ $0.0003. |
| Firebase Blaze | `docs/assessments/blaze-governance-amendment.md:28,140-148` | Active; "provides no blanket spend authority". **No run-rate recorded.** |
| Vercel | — | **No plan or cost recorded** (UNKNOWN) |
| Email / M365 / Google API | — | No cost recorded. Graph/Gmail API usage is typically within tenant licensing (UNVERIFIED). |
| Monitoring / logging | — | None in use, so no cost |
| AI | `docs/runbooks/private-ai-gateway-setup.md` | Private gateway is operator-run (local `127.0.0.1:8080`); external providers off by default. **No cost recorded.** |
| Support labour | — | UNKNOWN |

**No current total monthly run-rate exists in the repository.** Establishing one is roadmap item P2-10.

## 2. Cost model (formulas)

Let *E* be the set of environments. For a production customer environment *e*:

```
C_env(e) = C_api(e) + C_db(e) + C_frontend(e) + C_firebase(e) + C_secrets(e)
         + C_obs(e) + C_backup(e) + C_email(e) + C_ai(e)

C_api(e)      = P_api_instance(plan) × N_instances(e)
C_db(e)       = P_db_plan(plan) + P_storage × S_db(e) + P_backup × S_backup(e)
C_frontend(e) = P_vercel_project_share + bandwidth/invocation overage
C_firebase(e) = Firestore ops/storage + Functions + Hosting   # trends to 0 after Firebase retirement
C_obs(e)      = P_log_GB × L(e) + P_apm_host × N_instances(e) # currently 0 (no tooling)
C_ai(e)       = Σ_requests tokens × P_token(provider)  or  P_gpu_hour × H_gpu / customers_sharing
```

Monthly platform cost:

```
C_total = Σ_{e ∈ E_prod} C_env(e) + Σ_{e ∈ E_nonprod} C_env(e) + C_shared + C_support + C_compliance

C_shared     = control plane + CI minutes + status page + IdP (if Verenward-operated)
C_support    = H_support(customers) × R_hourly
C_compliance = auditor + pen-test + tooling, amortized monthly
```

Per-customer unit cost:

- **Scenario A (dedicated):** `U_A = C_env(e) + (C_shared + C_compliance)/n + C_support/n`
- **Scenario B (shared):** `U_B = (C_env(shared) + C_shared + C_compliance)/n + C_support/n`, where `C_env(shared)` grows step-wise with database size and API instances.

## 3. Scenario assumptions (to be replaced with measured data)

The assumptions below come from the shape of Customer 1. They are not measurements. Customer 1's scale per DECISIONS #210 non-prod sample: about 30 employees, 2 operating companies, about 10 trucks. Production holds only "two RoleAssignments on one principal" today (CUSTOMER_1_READINESS L59), so there is no production volume baseline yet.

| Scenario | Customers | Environments (Scenario A) | Environments (Scenario B) | Primary cost drivers |
|---|---|---|---|---|
| S1 | 1 | 1 prod + 1–2 non-prod | same | Fixed floor: DB plan, API instance, Vercel, Firebase (until retired), engineer time |
| S5 | 5 | 5 prod + shared non-prod | 1 prod + non-prod | A: 5× fixed floor plus 5× operational effort. B: 1× floor, larger DB tier |
| S25 | 25 | 25 prod | 1–2 prod (sharded by size) | A: fixed floors dominate; operations automation becomes mandatory. B: DB size, connections, API instances |
| S100 | 100 | 100 prod (only for enterprise tier) | 2–5 prod pools | B: DB IO/CPU, report/analysis query load, log volume, support headcount |

**Break-even question for the Owner (formula, not answer):** dedicated is cheaper per customer only while `C_env_fixed_floor < (C_ops_per_env_manual − C_ops_per_env_automated)`. Practically, dedicated suits tens of customers when IaC exists. Shared becomes necessary for an SMB tier at around 25+ low-revenue customers.

## 4. Architectural bottlenecks and cost drivers (from code)

| Bottleneck | Evidence | Effect at scale |
|---|---|---|
| Single API instance, no autoscaling | `render.yaml:57-75` | Availability (single point of failure) and throughput ceiling |
| Single shared database, no read replica | `render.yaml:46-54` | Analysis/reporting and OLTP contend; DB tier is the step-cost driver in Scenario B |
| Synchronous request processing; no queue | No queue library; `eosOps/inboundProviderRuntime.ts:750` `setInterval` | Long operations (imports, exports, report runs) block requests; the poller under one global advisory lock serializes all tenants' mailboxes |
| Firebase dual estate during migration | 280 files in exit baseline | Paying for two platforms until retirement; operational complexity |
| Per-environment activation config in code | `environmentCapabilityOverrides.ts:467-670` | Every customer environment adds code and registry edits, a linear engineering cost in Scenario A |
| Immutable audit with no archival | `1762646400000:154-172` | Storage grows without bound; needs archival tiering |
| No observability | ops doc §5 | Adding it adds cost (log GB, APM hosts), and that cost is needed to operate |
| AI (optional) | `functions/src/assistant/*` | Token or GPU cost. Must be metered per tenant before offering (P4-02). Private-GPU hosting cost is fixed and best shared across tenants. |

## 5. Recommendations

1. **Measure before modelling.** Pull 3 months of actual invoices (Render, Vercel, Google Cloud/Firebase, GitHub Actions) into a cost register (P2-10). Fill the symbols above.
2. **Tag per tenant now.** Structured logs with `tenantId` (P0-11) make later cost attribution possible.
3. **Price dedicated deployments to cover the fixed floor plus operations effort.** Price the shared tier on seats and modules once Scenario B readiness exists.
4. **Keep AI a separately priced add-on** with per-tenant metering and an explicit spend ceiling, so AI cost can never erode core margins.
