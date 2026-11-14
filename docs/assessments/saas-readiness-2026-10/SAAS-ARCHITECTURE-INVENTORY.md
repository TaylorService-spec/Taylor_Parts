# SaaS Architecture Inventory

Issued: 2026-10-11 04:15:00 -0700 (America/Phoenix) · Baseline: `main @ c73ce647` · Status: ASSESSMENT ONLY

Status vocabulary: **Implemented+deployed**, **Implemented, not deployed**, **Implemented, untested**, **Designed only**, **Missing**, **UNKNOWN**. "Deployed" means the repository records measured live evidence. Console state was not inspected.

## 1. Repository baseline

| Item | Value | Evidence |
|---|---|---|
| Repository | `TaylorService-spec/Taylor_Parts` (public) | `gh api repos/...` → `visibility: public` |
| `main` | `c73ce647` (2026-10-11 03:55 -0700), F0 Firebase deploy guard (#2051) | `git log` |
| Branch protection | None (no rules, no rulesets) | `GET /branches/main/protection` → 404 |
| History | 4,073 commits on `main` since 2026-07-02 | `git log` |
| Workflows | 151 | `.github/workflows/` |
| PostgreSQL migrations | 95 applied, plus 1 deferred (`functions/migrations/deferred/`) | `functions/migrations/` |
| Server tests | 729 files | `functions/test/` |
| Client tests | 627 files | `field-ops-app-vite/test/` |

### Major packages

| Package | Purpose | Runtime |
|---|---|---|
| `functions/` | TypeScript server. Contains the EOS trusted API (`src/eosApi/server.ts`, domain routers) and the legacy Firebase Cloud Functions (`src/index.ts`, about 95 exports after F2). | Render (non-prod API); Firebase Functions (legacy) |
| `functions/migrations/` | PostgreSQL schema in domain schemas: `eos_policy`, `eos_ops`, `eos_crm`, `eos_commercial`, `eos_finance`, `eos_workforce`, `eos_rental` | node-pg-migrate ^9 via Render `preDeployCommand` |
| `field-ops-app-vite/` | React SPA | Vercel (non-prod `verenwardeos.vercel.app`), Firebase Hosting, GitHub Pages (production publish) |
| `config/environments.json` | Single environment registry (ADR-011) | Build-time |
| `scripts/` | Release, drift, guard and census tooling | Operator/CI |
| `integrations/chatgpt-eos-intake` | Developer intake MCP server | Dev tooling, not product |
| Root `index.html` | Legacy "Parts Control Center" | Not served by Hosting (`firebase.json` serves `field-ops-app-vite/dist`) |

## 2. Deployment targets and environments

From `config/environments.json`. Production is decided by `role` only (ADR-011).

| Environment | Role | Status | Firebase project | EOS API | Frontends |
|---|---|---|---|---|---|
| `local-emulator` | sandbox | not provisioned | — | — | — |
| `platform-sandbox` | sandbox | live | `eos-platform-sandbox` | `https://eos-api-nonprod.onrender.com` | `verenwardeos.vercel.app`, `eos-platform-sandbox.web.app` |
| `platform-certification` | sandbox | live, frozen | `eos-platform-certification` | null | — |
| `platform-integration` | integration | not provisioned | — | null | — |
| `taylor-parts-production` | production | live | `taylor-parts` | **null** | `taylor-parts.web.app`, GitHub Pages `/field-ops` |

- **Render** (`render.yaml`, non-production only):
  - Database `eos-policy-nonprod`: `basic-256mb`, Postgres 16, `ipAllowList: []`.
  - Web service `eos-api-nonprod`: `starter`, `rootDir: functions`, migrations in `preDeployCommand`, `/health`.
  - The file states "There is no production blueprint in this repository" (`render.yaml:30-32`).
- **Production refusal:** `readServiceConfig` throws on `EOS_ENVIRONMENT=production|prod` (`functions/src/eosApi/server.ts:107-113`).
- **Recorded non-prod acceptance:** "TECHNICAL ACCEPTANCE: COMPLETE (non-production)" (`docs/architecture/eos-real-nonprod-activation.md`). The same document records that a second tenant was **not** instantiated.
- **Firebase:**
  - `.firebaserc` defaults to `demo-eos-no-default-project`, a deliberate fail-closed default.
  - `scripts/firebaseDeployGuard.mjs` is the first predeploy hook on every target.
  - Production deploy needs `EOS_FIREBASE_PRODUCTION_DEPLOY=<projectId>@<HEAD sha>:<target>`.
- **Vercel:** `field-ops-app-vite/vercel.json` holds only an SPA rewrite. Project settings and env vars were not inspected (UNVERIFIED).

**Conclusion:** The target architecture (Vercel → Render EOS API → PostgreSQL) is **implemented and deployed in non-production only**. Production for Customer 1 is the Firebase estate (Firestore, 11+ Gen2 Functions per DECISIONS #36, Firebase Auth, Hosting).

## 3. Platform layers

| Layer | Current state | Status |
|---|---|---|
| API transport | POST command tables per route (`*_ROUTE` constants; `eosApiDomainFor`, `server.ts:59`). Routes: `/crm/customer`, `/commercial/sales`, `/workforce/employees`, `/operations/{inventory, experience, catalog, cycle-count, relocation, transfer, placement, serialized-asset, work-orders, equipment, finance, rental, analysis, workspace, workflow, inbound-work}`, `/public/self-scheduling`, `/auth/nonprod/persona-session` | Implemented, non-prod deployed |
| API contract | No OpenAPI or published schema | Missing |
| Identity | Firebase ID token → `principals` via `(identity_provider, external_subject)`. EOS Ed25519 token foundation exists but is inert | See security doc |
| Authorization | PostgreSQL policy store plus resolver; legacy `firestore.rules` (1,838 lines) still authoritative for Firestore | Implemented (two planes coexist) |
| Data | PostgreSQL: about 162 tables, about 389 FK references, about 20 append-only/immutability triggers. Firestore: production and residual non-prod | Implemented |
| Files | Inbound attachments as PostgreSQL bytes (`inbound_work_attachments`, tenant-keyed). `storage.rules` denies everything | Implemented |
| Jobs / queues | None. One in-process `setInterval` poller (`eosOps/inboundProviderRuntime.ts:750`), refused in production | Missing |
| Caching | Environment-config cache only (`environmentCapabilityOverrides.ts:709`) | N/A |

## 4. Business operations coverage

Writer-state constants in `functions/src/**/*WriterState.ts` show `{firestore:"FROZEN", postgres:"ACTIVE"}` for Catalog, CRM, Cycle Count, Equipment, Work Order, Placement, Relocation, Transfer and Acquire. **These are non-production authorities.** Production still runs the Firebase-era implementation.

Owner visual acceptances in `docs/design/north-star-migration-ledger.md` were given against the Firebase-era sandbox in late Aug to early Sep. The later PostgreSQL cutovers rest on Controller/Owner rulings DECISIONS #190–#228. This assessment does **not** reopen any accepted domain.

| Domain | Implementation | Non-prod authority | Tests (CI workflow) | Acceptance evidence | Open items / dependencies | Generic or customer-specific |
|---|---|---|---|---|---|---|
| CRM / customers | `eosCrm/*`, `/crm/customer`, `modules/accounts` | PG (CRM activities still Firebase callables) | crm-activity, crm-quiescence, contact-provenance, account-workspace, PG suites | Account family `AWAITING_OWNER_VISUAL_ACCEPTANCE` (ledger :135) | Customer Data Import refuses after cutover (`dataImportCallables.ts:404`) | Generic. `ACCOUNT_LINES_OF_BUSINESS=["TAYLOR","VENTANA"]` is customer-specific (`eosCrm/accountVocabulary.ts:22`) |
| Retail sales | `eosCommercial/*`, `/commercial/sales` | PG | sales-opportunity*, sales-order-*, opportunity-* | Sales Agreement closed 2026-08-27; Order/Opportunity awaiting | HELD: above-limit discount, trade-in receiving (#209) | Generic |
| National Accounts | Sales channel `NATIONAL_ACCOUNTS`, job role, channel scope (`1762905600000`) | PG | commercial and role-governance suites | #209: "Retail and National Accounts stay distinct" | No dedicated workflow found (UNKNOWN) | Generic concept |
| Equipment | `eosOps/equipmentOperations.ts` | PG | equipment-north-star, equipment-install-*, equipment-compatibility-*, serialized-asset-* | Family 8 CLOSED / OWNER ACCEPTED 2026-08-31 | Equipment import still on the Firestore adapter (`firestoreDataImportAdapters.ts:336`) | Generic. Display vocabulary is Ventana/Icetro-specific (`wholeUnitAssetDisplay.js:68-69`) |
| Service operations | `eosOps/workOrder*`, `coordinatedVisitPostgresRead.ts` | PG | service-operations-north-star, -risk, service-work-order-authority | Family 6 CLOSED 2026-08-30 | — | Generic |
| Work orders | `eosOps/workOrder*.ts` | PG | work-order-*, wo-parts-plan | Family 1 closed 2026-08-25 (Firebase era) | `completeAssignedJob` still a Firebase callable | Generic |
| Technician ops | `modules/technicianDashboard`, `modules/mobile` | PG (`useCurrentTechnician` still Firestore) | complete-assigned-job, work-order-field-context | Family 11 CLOSED / LIVE VERIFIED 2026-09-04 | — | Generic |
| Scheduling & dispatch | `eosOps/workOrderScheduling.ts` | PG | dispatch-scheduling-*, dispatch-north-star, dispatch-intelligence | Dispatch P1v1 ACCEPTED 2026-08-29 | — | Generic |
| Customer self-scheduling | `eosOps/selfScheduling.ts`, `/public/self-scheduling` | PG (token-authorized) | `customerSelfSchedulingPostgres` | UNKNOWN | Unauthenticated route has no rate limit | Generic |
| Inventory | `eosOps/partsReads.ts`, `catalogMaster/*` | PG catalog/baseline; balances and returns still Firebase | inventory-*, parts-north-star, on-hand-sign-authority | Parts P1v2 CLOSED 2026-08-31 | Parity fence governs (`roadmaps/2026-09-16-parts-inventory-truck-parity-fence.md`) | Mostly generic. Taylor/Ventana ownership semantics in `fulfillment/inventoryControlLifecycle.ts:76-91` |
| Warehouse ops | `eosOps/warehouseBin*`, `binPlacement*`, `stockRelocation*`, `transfer*`, `cycleCount*` | PG; bins also via Firebase callables | warehouse-governance, cycle-count, transfer suites | Cycle Count certified (#179) | `TAYLOR_WAREHOUSE_ID="taylor-main"` in grant delta (`inventoryWarehouseActivationDelta.ts:30`) | Generic with fixtures |
| Truck stock | `eosOps/truckFleetRepository.ts`, `mobileStockAuthority.ts` | PG | truck-registry-* (4) | UNKNOWN | — | Generic |
| Purchasing / reorder | `eosOps/purchasingRepository.ts`, `reorderLifecycleCommands.ts` | PG | reorder-request, reorder-domain-client | #193, #194 | — | Generic |
| Supplier mgmt | `eosOps/supplierAdministration.ts` | PG (Firebase callables removed in F2) | supplier-master | #196 | — | Generic |
| Receiving | `eosOps/receiveReorderStockCommand.ts` | Dual: PG and legacy `receiveInventoryStock` | inventory-receiving-*, receiving-* | Family 9 CLOSED 2026-08-31 | Open PRs #1974/#1977/#1979 (held) | Generic |
| Financial ops | `eosFinance/*`, `/operations/finance` | PG; some Firebase reads remain | finance-invoice-persistence, commercial-finance, financials-north-star | #191, #197, #206 (Finance Closure PROVEN) | No accounting destination (handoffs PENDING_DESTINATION, #209). Billing default carries a Taylor comment (`financeBillingPolicy.js:4,45`) | Generic policy profile (`finance/financialPolicyProfile.ts`) |
| Rental | `eosRental/*`, `1764520000000_rental.sql` | PG | (within PG suites) | #207 CLOSED/PROVEN | "Taylor custody" strings (`eosRental/rental.ts:166,194,450`) | Mostly generic |
| Reporting & dashboards | `eosAnalysis/*` (PG); legacy `reporting/*` (Firestore) | Mixed | report-execution-service, reporting-client-contract | Analysis #208 PROVEN; My Dashboard accepted 2026-09-03 | Reporting calendar hardcoded (`reportingPeriod/reportingCalendar.ts:70-78`) | Catalog generic; calendar customer-specific |
| Administration | `adminPolicy/*`, `eosAdministration/*` | PG; legacy callables remain | eos-admin-policy, administration-users, role-governance | #211–#228 | C1-ADMIN-01 OPEN | Generic |
| Workflow mgmt | `eosOps/workflowRuntimeOperations.ts` | PG | workflow PG suites | #219–#221; not live-accepted | DQ-210-B: domain commands still run their own matrices | Generic |
| Communications / inbound work | `eosOps/inboundWork*`, M365/Gmail transports | PG | inbound-work-tests | Family 12 surfaces accepted 2026-09-06 | No mailbox bound; outbound email not built | Generic |
| Ownership & accountability | `eosCommercial/commercialOwnership*`, `ownership/*` | PG with history | eos-ownership-model-tests | #209 §3 | — | Generic. `OPERATING_COMPANY_IDS` hardcoded |
| Audit & compliance | `eos_policy.audit_events` (append-only triggers, `1762646400000:154-172`) plus Firestore `auditEvents` | PG and Firestore | access-audit-service, governance-guard-enforcement | #225 | No retention policy, no export | Generic |

## 5. Remaining Firebase runtime dependencies

These are distinct from accepted domain migrations.

### Exit guard and baseline

- Guard: `scripts/firebaseExitGuard.mjs`.
- Baseline: `docs/architecture/firebase-exit-baseline.json`. **280 files**, a ratchet that can only shrink. 273 are guarded; the 7 identity files are pinned by `functions/test/eosAuthNoFirebase.test.mjs`.
- Files by category:

  | Location | Category | Files |
  |---|---|---|
  | Client | `firestore_client` | 19 |
  | Client | `firebase_functions_client` | 22 |
  | Client | `firebase_auth` | 2 |
  | Server | `firebase_admin_firestore` | 168 |
  | Server | `firebase_functions_server` | 64 |
  | Server | `firebase_auth` | 3 |
  | Server | `firebase_admin_app` | 2 |

- Progress: F1 290→282 and F2 282→280. Open draft #2053 proposes F4 280→278.

### What still depends on Firebase

- **Firebase Auth:** `FX-AUTH-001` is `TRANSITIONAL_ACTIVE_PENDING_RETIREMENT` (`docs/architecture/firebase-exit-manifest.json`). It is the only human sign-in.
- **Firestore still authoritative in non-prod:** report definitions, performance goals, CRM activities, data-import jobs, `users`/`roleAssignments`/`employees` directory reads, frontend `warehouses`, the inventory ledger behind `getPartBalance`, returns, and bins.
- **Production:** everything.
- **Hosting:** three publish paths exist (Firebase Hosting, GitHub Pages, Vercel).
- **Storage:** deny-all, no runtime use.

## 6. Integrations and data platform

| Capability | Status | Evidence |
|---|---|---|
| Microsoft 365 / Gmail inbound | Implemented, not deployed (no mailbox bound; poller refuses production) | `inboundWork/microsoftGraphTransport.ts`, `gmailTransport.ts`, `inboundProviderRuntime.ts:744` |
| Outbound email | Missing | CUSTOMER_1_READINESS |
| ERP / accounting | Designed (provider-neutral payload); "production adapter registry is EMPTY" | `eosFinance/accountingDelivery.ts:12` |
| Webhooks / event outbox | Missing | — |
| Import | Data Import P1 (XLSX; customer, part, equipment, inventory, service history) on **Firestore adapters**; sandbox-only; refuses CUSTOMERS/PARTS after cutovers | `functions/src/dataImport/*`, `importTargetGuard.ts:33` |
| Export / portability | Missing (only Firestore-era migration snapshots and bin-label export) | `scripts/export*Snapshot.js`, `BinLabelsAndExport.jsx` |
| Referential integrity | Strong: about 389 FKs, composite `(tenant_id, …)` FKs, one `ON DELETE CASCADE` | migrations |
| History | `audit_events`, `account_ownership_history`, `equipment_events`, `work_order_schedule_history`, `workflow_instance_events`, and others | migrations |
| Analytical access | Governed Analysis reads; no warehouse or BI export | `eosAnalysis/*` |
| Data-plane portability | ADR-015: Verenward-hosted, customer-hosted and enterprise-adapter models in scope; Firestore is "an implementation, not the domain contract" | `docs/architecture/ADR-015-eos-data-plane-portability.md` |

## 7. Open PRs relevant to this assessment

These were inspected and **not modified**. Work that exists only in these PRs is classified as pending.

| PR | Relevance |
|---|---|
| #2053 (draft) | Firebase exit F4: 280→278 files |
| #2046 (draft) | Administrator appointment control (#223) |
| #1821 | Moving authorization out of Firebase Rules into the governed capability model |
| #1982 / #1981 / #1976 | Finance PostgreSQL read replacement (held) |
| #1975 | Protected capability-grant proposal (held, Owner) |
| #1972 | One-writer fence on Commercial mutations |
| #1965 | Audit Logs wired to governed history |
| #1855 (draft) | Assistant dashboard boundary |

## 8. Documentation drift

- **Superseded or stale:**
  - `docs/SPRINT_STATUS.md` (self-declared superseded).
  - `docs/CLAUDE_CONTEXT.md` (2026-08-26; some deployment claims stale).
  - `docs/roadmaps/CURRENT.md:39`: CRM writer shown inactive; code shows PG ACTIVE (`crm/crmWriterState.ts:37`).
- **"No tenancy implemented" statements contradicted by later PostgreSQL migrations:**
  - `docs/DeploymentModeStrategy.md` §4.
  - DECISIONS L457, L824, L1127, L1168.
  - `firestore.rules` L1395–1399.
  - A tenancy ADR is the right fix.
