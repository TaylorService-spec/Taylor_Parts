# Four Final Functional Areas: Readiness Review and Owner Decision Packet

Issued: 2026-10-14 17:44:15 -07:00 (America/Phoenix) · Head: `origin/main` `09b2a043`
Status: **READ-ONLY ASSESSMENT + PROPOSED rulings.** Nothing here is decided until the Owner marks it.
No code, data, grants or deployments were changed to produce it.
Related: `docs/architecture/eos-product-program.md` (branch `docs/eos-product-program-artifacts`), Phase 4.

Developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools.

## How to use this document (for the executing Claude session)

1. Act only on rulings the Owner has marked **APPROVED** in §6. A **PROPOSED** ruling authorizes nothing.
2. Before acting, re-verify the evidence in §2–§5 against the current head. Code and migrations are the authority; docs may be stale. If the head, the files, or a governing decision differ from this packet, stop and report.
3. Autonomy follows `docs/DelegationCharter.md` §8:
   - Ordinary code (operations, client wiring, tests, docs, equivalence records) may be implemented, reviewed and merged under the exact-head guard once its ruling is approved.
   - **These always need explicit Owner authorization, even after a ruling:** every new migration, every capability or grant change, production activation, production writes or bulk loads, Firebase Functions deletion, and every production deploy.
4. Every Firebase retirement follows the Business Capability Equivalence Gate (`docs/architecture/firebase-capability-equivalence-gate.md`). Gate B needs a screen-level test **and** a recorded live persona run.

## 1. Summary matrix

| | Reporting | CRM Activities | Data Imports | Financial Adjustments |
|---|---|---|---|---|
| Completion | ~40%: EOS **Analysis** live (37 measures, tenant + company scoped); Builder/Saved are Firebase-only | ~25%: Account page section works on Firestore only; no PostgreSQL activity table | ~30%: full pipeline, but Firebase + sandbox only; Contact CSV import is on EOS | ~45%: settlement correction on EOS (#2092); no refund / credit memo / write-off |
| Firebase exports left | 7 | 2 | 4 | 6 (only 2 reads live in browser) |
| Missing capability | saved definitions; ad-hoc execution; field-level grants | activity table + ops; PG capability vocabulary; Contact/Opportunity timelines | EOS import route; job/staging tables; service-history table; production use | refund; credit/debit memo; write-off; FIN-007 approvals; invoice void; period close |
| Defect found | — | Firebase activity has no tenant/company/owner scoping | **D-1: EQUIPMENT import writes frozen Firestore** | **D-2: admin + partsManager hold refund/adjustment grants** |
| New Owner decisions | 2 | 3 | 3 | 6 |
| Estimated PRs | 3 (retire Builder) / 5–7 (rebuild) | 4–5 | 7–9 | 6–8 |
| Autonomous execution | **CONDITIONAL** | **CONDITIONAL** | **CONDITIONAL** | **NO** |

**CONDITIONAL:** code can proceed autonomously after the ruling; migrations, grants, activation and deploy stay Owner-gated.
**NO:** almost every remaining piece moves money or changes authority.

**Recommendation on expanded autonomy:** do **not** expand merge/deploy authority for these four areas. Their critical paths are migrations, grants and production activation. Production deploys stay with the operator.

## 2. Reporting

**Exists**
- `functions/src/eosAnalysis/analysisOperations.ts:8-19`: `/operations/analysis` (`readAnalysisCatalog`, `readAnalysisWorkspace`, `readMeasureAnalysis`), registered at `eosOps/eosOpsHttp.ts:272,899-907`.
- Every measure is filtered by tenant and operating company (`eosAnalysis/measures.ts:96-100`, `analysis.ts:76-81`). Each is gated on its own read capability, narrowed by sales channel / warehouse / queue.
- Migration `1762300800000_authority-activation-and-reporting-read.sql`: `reportDefinition.read` (:266-268), granted to admin, owner and reportViewer (:315-317). No authoring verb; `reportAuthor` holds nothing.
- UI: `modules/analysis/AnalysisWorkspace.jsx` → `services/analysisApiClient.js`. Nav `navConfig.js:228-234`, surface `analysis.workspace` (:791).

**Still on Firebase**
- Exports `runReportDefinitionCallable` + 6 saved-definition callables (`functions/src/index.ts:240,252-260`). Data in Firestore `reportDefinitions`.
- Clients: `domain/reporting/reportExecutionSeam.js`, `domain/reporting/savedReportService.js`, `access/useReportCapabilities.js` (also a Firestore `users/{uid}` listener).
- Nav `builder` / `savedReports` (`navConfig.js:601,606`) have no `surfaceAccess`; listed in `NAV_SURFACE_GAPS` (:897-898).

**Missing:** PostgreSQL saved-definition storage + operations; ad-hoc report execution; field-level reporting grants (`role_field_permission_overrides` is empty).

**Governing:** #208 (saved definitions "not built"; need an authoring-authority ruling, DECISIONS.md:7428-7433), #209 queue HELD (:7494), #167, #169 Group B (no auto-adoption), #192, #163, #230.

**Tests to finish**
- PostgreSQL: definition CRUD is tenant-isolated and author-only; a definition grants no data; audit per mutation.
- UI: nav maps Saved to an EOS surface.
- Baseline: exports removed.

**UAT:** Analyst sees catalog but no figures without measure grants; Retail seller sees RETAIL measures only; Taylor-scoped user cannot see Ventana; Owner sees consolidated view; save / rename / delete a view that another user cannot see; a revoked grant takes effect without sign-out.

## 3. CRM Activities

**Exists (Firebase only)**
- `functions/src/crmActivity/*` over Firestore `crm_activities`. Types SALES_NOTE, CALL, MEETING, RELATIONSHIP, GENERAL (`crmActivityTypes.ts:19`).
- No assignee, due date or status, by design: "PART 1.5" (`crmActivityCommands.ts:9-14`).
- No tenant / company / owner scoping.

**PostgreSQL / EOS:** `eos_crm` has accounts (`tenant_id`, `owner_employee_id`), contacts, locations, ownership history and command receipts. The CRM runner covers Account / Contact / Location only (`eosCrm/crmHttp.ts:49-53`). There is no activity table in any migration.

**Authority:** `crm.activity.create/read` exist only in the Firebase catalog (`access/permissionCatalog.ts:1501-1520`, `active:false`), activated for eos-platform-sandbox only (`environmentCapabilityOverrides.ts:147-148,503-504`).

**Still on Firebase:** exports `createCrmActivity`, `getCrmActivities` (`index.ts:531-532`); client `services/crmActivityCallableClient.js` → `useCrmActivities` / `useCrmActivityActions` → `modules/accounts/ActivityAndNotesSection.jsx`.

**Missing**
- `eos_crm` activity table (tenant-scoped, account FK, optional contact/opportunity refs, actor, `occurred_at`, idempotent via `command_receipts`).
- EOS create/list operations through the CRM authority kernel.
- PostgreSQL capability vocabulary + grants.
- Client cutover to `crmApiClient`.
- Contact/Opportunity timelines.

**Data migration:** likely unnecessary. Production never activated the capability; sandbox may hold documents (UNVERIFIED).

**Governing:** #128, #127, #176, #162, #208/#209 (Retail ≠ National Accounts; channel-narrowed reads), Owner ruling 2026-08-19 (PR #1324).

**Tests:** PostgreSQL authority/transport tests following `crmAuthorityPostgres` and `crmTransportPostgres` (tenant isolation, cross-tenant refused, idempotent replay, capability denial); client cutover parity test.

**UAT:** Retail rep logs a call on an owned account and sees it; a National Accounts rep cannot see Retail-only activity; Admin/Owner see all; dispatcher can contribute; no-capability user denied; retry does not duplicate; second tenant isolated.

## 4. Data Imports

**Exists (Firebase, sandbox only):** `functions/src/dataImport/*` (~3.5k lines):
- CSV/xlsx intake (2 MB / 5000 rows), mapping suggest/validate, preview/dry-run, explicit approval.
- Duplicate handling: `DUPLICATE_IN_FILE`, `ALREADY_EXISTS`; create-only, never overwrite.
- Per-row idempotency, atomic execution claim, audit events.
- Types PARTS, CUSTOMERS, EQUIPMENT, INVENTORY, SERVICE_HISTORY.
- Production is refused by name (`importTargetGuard.ts:33,149`). Code calls it "migration TOOLING (nonprod-only by the Catalog Lane 2 ruling)" (`access/governedBusinessRoles.ts:301-303`).

**PostgreSQL / EOS**
- Only `admin.dataImport.execute` is seeded. No import job, staging or service-history tables.
- Working EOS path: `eosCrm/contactAuthority.ts:176` `importAccountContacts`.
- Unused EOS writers: `crm/postgresCustomerImport.ts`, `catalogMaster/postgresPartMasterWriter.ts:99` `createPart`, `eosOps/equipmentOperations.ts:380` `createEquipment`, `eosOps/serializedAssetAcquireOperations.ts:55`.

**Still on Firebase:** exports `stageDataImport`, `executeDataImport`, `listDataImportJobs`, `listImportedServiceHistory` (`index.ts:567-580`); clients `access/dataImportClient.js`, `access/importedServiceHistorySource.js`.

**Effective state today:** CUSTOMERS refused (CRM freeze), PARTS refused (catalog freeze), INVENTORY refused (catalog read guard). Only EQUIPMENT and SERVICE_HISTORY execute, both into Firestore.

**Defect D-1 (verified)**
- `dataImportCallables.ts:404-426` guards CUSTOMERS, PARTS and INVENTORY only.
- EQUIPMENT still writes Firestore `equipment`, while `eosOps/equipmentWriterState.ts:15` sets `firestore: "FROZEN"`.
- Sandbox only, but it is a write to a retired store.

**Missing:** EOS import route (stage / execute / list) + PostgreSQL job store; entity writers onto the PostgreSQL authorities; service-history PostgreSQL home; a production onboarding path.

**Governing:** #223, #175, #176, Catalog Lane 2 ruling (`catalogMaster/catalogActivationLedger.ts:249-255`), CRM cutover ruling 2, the all-or-nothing Contact import ruling.

**Tests:** PostgreSQL per entity (idempotent replay, ALREADY_EXISTS, per-row audit); route allow/deny; EQUIPMENT freeze refusal; no-Firebase census for clients.

**UAT:**
- Admin stages a 500-row customer file, fixes the mapping, previews, approves and executes.
- Re-running the same file gives ALREADY_EXISTS with zero writes.
- Unauthorized user denied.
- Equipment rows referencing imported customers succeed.
- Imported service history shows on the Account.

## 5. Financial Adjustments

**Exists (EOS)**
- `finance.settlement.correct` (`migrations/1764510000000_finance-closure.sql:33-51`; owner / GM / controller / accountingManager / financeManager, not admin).
- Settlements RECORDED/VOID and applications APPLIED/REVERSED, immutable via triggers (:71-189).
- Facts are corrected by exact reversal, once, idempotent (`1764420000000_finance-foundation.sql:192-252`).
- Ops `reverseSettlementApplication`, `voidSettlement` (`eosFinance/financeOperations.ts:311-326`; `settlement.ts:241-275`). UI `SettlementCorrections.jsx`.

**Still on Firebase:** 6 exports (`index.ts:107-126`: `issueInvoice`, `applyPayment`, `recordInvoiceAdjustment`, `listAccountInvoiceAr`, `listFinancialFacts`, `recordRefund`). Only the reads are live in the browser (`services/financeReadCallableClient.js` → `useAccountAr`, `useFinancialFacts`).

**Built but unused:** `finance.adjustment.record` / `finance.refund.record` capabilities (`1761609600000_finance-administration-reorder-vocabulary.sql:57-65`) have no operation. `reverseFinancialFact` / `correctFinancialFact` are not exposed. FIN-007 approval code is not composed.

**Defect D-2 (verified)**
- `1761609600000_...sql:113-119,161-166` grants refund/adjustment to **admin**, and adjustment to **partsManager**.
- This contradicts #206 ("not admin") and #193 §3 (the partsManager grant is a defect).
- No later migration revokes it. Live database state is UNVERIFIED.

**Missing:** refund; credit memo / debit / write-off; FIN-007 enforcement; invoice void command; period close; Credits & Adjustments UI (`FinancialsCreditsAdjustments.jsx` is a placeholder); EOS replacements for the 2 live reads (UNVERIFIED whether equivalents exist).

**Governing:** #145 (EOS is the operational subledger), #206 §5/§13, #193 §3, #205, #232 + Amendment A + P0 company-assignment correction, #229, FIN-007.

**UAT evidence:** `docs/financials/UAT_*.md` are test-suite write-ups, which count as doc evidence, not live runs. Nothing covers refunds or adjustments.

**Tests:** PostgreSQL idempotency/immutability; over-refund and over-credit refused; approval above threshold; self-approval refused; company scope (out-of-scope behaves like unknown); admin and partsManager denied; no partial write on refusal.

**UAT:**
- Taylor controller issues a credit memo; the balance drops.
- financeManager refunds an overpayment.
- Write-off above threshold waits for a second approver.
- Ventana-only user refused on Taylor.
- Sales and Technician users refused.
- Reverse and re-apply an application.
- Void refused while applications are live.

## 6. Owner decisions (PROPOSED: mark each APPROVED / REJECTED / AMENDED)

### Defects (do first)
| # | Proposed ruling | Boundary | Status |
|---|---|---|---|
| D-1 | Add the writer-freeze guard to EQUIPMENT import execution so it refuses while Firestore equipment is FROZEN | Ordinary code (autonomous once approved) | PROPOSED |
| D-2 | Revoke `finance.refund.record` and `finance.adjustment.record` from admin, and `finance.adjustment.record` from partsManager, aligning with #206 and #193 §3 | Grant change + migration (Owner-authorized) | PROPOSED |

### Reporting
| # | Proposed ruling | Status |
|---|---|---|
| R-1 | Retire Report Builder for v1.0; EOS Analysis is the employee reporting surface | PROPOSED |
| R-2 | Saved definitions = **private saved Analysis views**, owned by the author, granting no data access. Authoring is available to any `reportDefinition.read` holder. Sharing and field-level grants are deferred past v1.0. This releases the #209 HELD item. | PROPOSED |

### CRM Activities
| # | Proposed ruling | Status |
|---|---|---|
| C-1 | Parity = the existing five activity types; tasks and follow-ups (PART 1.5) come after v1.0 | PROPOSED |
| C-2 | `crm.activity.create/read` go to the Retail Sales, National Accounts Sales and service-dispatcher roles, plus Admin/Owner. Visibility is narrowed by sales channel per #208/#209. | PROPOSED |
| C-3 | Activate in production as part of the CRM cutover; no Firestore activity data migration | PROPOSED |

### Data Imports
| # | Proposed ruling | Status |
|---|---|---|
| I-1 | Data Import becomes a **production onboarding capability** for Administrators, enabled per tenant (supersedes "nonprod tooling only" for onboarding) | PROPOSED |
| I-2 | One permission, `admin.dataImport.execute`, covers stage, preview and execute | PROPOSED |
| I-3 | Imported service history gets a PostgreSQL table, readable on the Account | PROPOSED |

### Financial Adjustments
| # | Proposed ruling | Status |
|---|---|---|
| F-1 | A refund is a **DISBURSEMENT settlement** against a customer credit balance, requiring an external payment reference. EOS never invents a bank fact. | PROPOSED |
| F-2 | Credit memo, debit and write-off are **obligation adjustment facts**, using the existing reversal pattern | PROPOSED |
| F-3 | FIN-007: write-offs and refunds above a per-company threshold need a second approver; no self-approval. Threshold values are to be set by the Owner per company. | PROPOSED (values needed) |
| F-4 | Holders of refund/adjustment: owner, controller, accountingManager, financeManager. Not admin, not partsManager (see D-2). | PROPOSED |
| F-5 | Invoice void is allowed only when no application is live | PROPOSED |
| F-6 | Period close is deferred past v1.0 (EOS is a subledger; the GL closes) | PROPOSED |
| F-7 | Execute the pending `financeCompanyAccess` role assignments (Finance users fail closed without them) | PROPOSED (Owner-executed) |

## 7. Execution sequence after approval

1. **D-1** (code) and **D-2** (grant migration).
2. **CRM Activities:** migration + vocabulary → EOS ops + PostgreSQL tests → client cutover → retirement + equivalence → UAT.
3. **Financial Adjustments:** migration + domain → ops + capabilities → FIN-007 → Credits & Adjustments UI → read cutover → retirement → UAT.
4. **Data Imports:** migration (job store, service history) → route → entity writers → client cutover → per-tenant production enablement → retirement → UAT.
5. **Reporting:** saved-view storage + ops → Saved surface on EOS → retire Builder + 7 exports → UAT.

Total: roughly 20–29 PRs. Retiring the 19 Firebase exports in these areas is part of each area's final step.
