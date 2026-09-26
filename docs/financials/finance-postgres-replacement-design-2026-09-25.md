# Finance on PostgreSQL: execution-grade dependency map (design, 2026-09-25)

**Status: DESIGN — HOLD.** Docs only. Nothing here is code, a migration, a copy, a cutover, a grant or an activation.
Base `09d63c4e`; all `file:line` references are to that base (paths relative to `functions/src/` unless they start
with `functions/`, `field-ops-app-vite/`, `docs/` or `firestore.rules`). Input note: #1976
(`docs/financials/financial-facts-read-temporary-firebase-limit-2026-09-25.md`, branch
`lane/s4-financial-facts-complete-read`) scoped the reporting read only. This doc covers **every** Firebase finance
reader and writer.

**Target (Owner):** zero Firebase, including auth. EOS/PostgreSQL owns finance facts, authorization and aggregates.
Firebase is transitional and is not extended. The #1976 Firebase read is a stopgap, deleted at N15.

**How to read this.** §0 is the dependency graph: 18 nodes (N1–N18), each with the nodes and Owner decisions that
must exist before it. §1–§6 give each node's evidence. §7 is rollback per step. §8 is the Owner decision sheet
(F1–F6). §9 lists the remaining lane-level decisions. §10 is the step table.

---

## 0. Dependency graph

`A ← B` means **B must exist (merged, applied or ruled) before A starts.** `F#` = Owner decision (§8).

| Node | What | Depends on (edges) | Kind |
|---|---|---|---|
| N1 | Existing `eos_finance` inputs (invoices, lines, totals view, payments, applications) | — (merged; 0 rows) | exists |
| N2 | `eos_finance.invoice_adjustments` | N1, **F4** | migration |
| N3 | `eos_finance.refunds` | N1, **F4** | migration |
| N4 | Attribution columns on `invoices` | N1, D-4 | migration |
| N5 | `invoice_number_counters` + `legacy_*` provenance columns | N1, D-7 | migration |
| N6 | Governed visibility: 5 capability rows + PG visibility loader + SQL reach | N1, N4, **F1**, **F2**, **F3** | migration + code |
| N7 | SQL aggregation contract (`facts.list`, `account.ar`) | N1, N2, N3, N4, N6 | code |
| N8 | Completeness guarantee | N7 | code property |
| N9 | Render transport `/finance/` + `FINANCE_AUTHORITY` state constant | N6, N7, N8 | code |
| N10 | Snapshot export + census/copy/verify tooling | N2, N3, N4, N5 (target shape), N9 (state module) | tooling |
| N11 | Firestore writer freeze (FREEZE) | N9 (guard module), **F5** | operator + code constant |
| N12 | COPY once → VERIFY zero diffs | N10, N11 (+ quiescence proof) | operator |
| N13 | ACTIVATE_POSTGRES (nonprod) | N12, N9, **F6** | Owner, irreversible |
| N14 | Client switch to Render | N13 | code |
| N15 | Firebase reader deletion (`listFinancialFacts`, `listAccountInvoiceAr`) | N14 + zero-invocation window | code |
| N16 | PostgreSQL write commands (apply, adjust, refund; issue later) | N13, N2, N3, N5, **F3**, **F4**, M-4; issue also ← Commercial C6 | code |
| N17 | Firebase writer deletion (`issueInvoice`, `applyPayment`, `recordInvoiceAdjustment`, `recordRefund`) | N11, and N16 **or** F5 = "unavailable is acceptable"; RETIRE_FIRESTORE | code, irreversible |
| N18 | Rules + legacy catalog cleanup | N15, N17; production Rules fence | protected policy |

Critical path: F1–F4 → N2–N6 (one migration) → N7 → N9 → N10 → F5 → N11 → N12 → F6 → N13 → N14 → N15 → N17 → N18.
N16 runs in parallel after N13; it gates N17 only if F5 rejects write unavailability.

---

## 1. Authoritative inputs and schema gaps (N1–N5)

### 1.1 N1 — what PostgreSQL already has (`eos_finance`, **0 rows**: `docs/testing/persona-object-workflow-access-matrix.md:147`, `:585`)

| Object | Evidence | Carries | Gap |
|---|---|---|---|
| `invoices` | `functions/migrations/1758931200000_invoice-authority.sql:153-212` | tenant, `operating_company_key` (NOT NULL), `invoice_number` (unique per tenant+company), `account_id`, `sales_order_id`, `currency`, `due_date`, `issued_at`, `issued_by`, void triple | **No attribution** (`:58-61`); no stored state/totals by design (`:36-40`, `:80-102`) |
| `invoice_lines` | same `:225-265` | `business_unit_id` (nullable, FIN-002), qty/price/discount/tax, generated totals | none |
| `invoice_totals` view | same `:276-296` | total, `line_count`, `is_void` | none |
| `payments` | `functions/migrations/1759017600000_ar-cash-application-authority.sql:167-210` | company, account, currency, `amount_minor`, method, `received_at`, `recorded_by` | none |
| `payment_applications` | same `:217-248`; append-only triggers `:411-415` | `payment_id`, `invoice_id`, `applied_amount_minor`, `idempotency_key` (unique) | **No reversal fact** (`:138-143`) |
| views | same `:426`, `:449` | receipt applied/unapplied; applied per invoice | none |
| capabilities | `functions/migrations/1761609600000_finance-administration-reorder-vocabulary.sql:47-66`, grants `:93-160` | `finance.invoice.read`, `finance.payment.read` (14 Roles each, `:17-20`), `invoice.issue`, `payment.apply`, `adjustment.record`, `refund.record` | **`finance.visibility.*` not registered** (0 hits in `functions/migrations`) |
| repositories | `eosOps/invoiceAuthority.ts:110`, `:223-261`, `:304`; `eosOps/cashApplicationAuthority.ts:144-191` (pure) | invoice insert/read/reconcile; cash math | **No payment/adjustment/refund repository** |

### 1.2 N2–N5 — Firestore-only families the target must gain

| Node | Firestore family | Evidence | Why the read needs it | PG target |
|---|---|---|---|---|
| N2 | `invoice_adjustments` (`constants/collections.ts:77`) | writer `finance/adjustmentCallables.ts:58`, write `:84`; record shape `finance/adjustmentCommands.ts:44-56` | `outstanding = total − applied − credits + charges − writeoffs` (`finance/financeReadProjection.ts:37-39`); summary/aging/rollups `:124-150`, `:233-283` | append-only table, FK `(tenant_id, invoice_id, currency)`, type CREDIT_MEMO / DEBIT_CHARGE / WRITE_OFF |
| N3 | `refunds` (`collections.ts:82`) | writer `finance/refundCallables.ts:57`, write `:79`; reduces `appliedMinor` (`finance/refundCommands.ts:82-101`) | net applied, collected, outstanding | append-only table, nullable `payment_id` (`refundCommands.ts:37`) |
| N4 | invoice `attribution` map | written `finance/invoiceCommands.ts:233-239`, `:317`; shape `finance/financialAttribution.ts:160-170` | SELF/TEAM reach and `byCreditedSalesperson` (`finance/financialVisibility.ts:178-179`, `:190-198`) | nullable columns `credited_salesperson_id`, `responsible_employee_id`, `attribution_source_type`, `attribution_source_record_id`, `attribution_event_at`, `attribution_business_unit_id` |
| N5 | `counters/invoices_<companyId>` + audit actor | `finance/invoiceNumbering.ts:19-20`, `:48`; actor only in audit events (`finance/invoiceCallables.ts:17`, `:57-76`) | writes only; PG requires `issued_by`/`recorded_by` (`1758931200000:172-174`; `1759017600000:195-199`) | `invoice_number_counters (tenant, company, next_value)` seeded at COPY; `legacy_actor_uid` columns |

Out of this wave: `inventory_acquisition_costs` (Reorder/Receiving lane; `listFinancialFacts` serves only
INVOICE/RECEIPT/APPLICATION, `finance/financialReportingRead.ts:50`), `financial_policy_profiles` (no callable export),
`work_order_labor_entries` (FIN-BLOCK-002). `invoices.account_id`/`sales_order_id` have no FK, so COPY does not require
CRM or Commercial rows; census reports orphans as advisory. PG **issuance** needs the Sales Order in PG
(`invoiceCallables.ts:80` reads Firestore today) → waits for Commercial C6.

**Edges.** N2, N3 ← F4 (scope). N4 ← D-4. N5 ← D-7. N2–N5 ship as **one additive migration** (S1) with N6's
capability rows, guarded down while empty (`1758931200000` pattern).

---

## 2. N6 — Governed field/object visibility

**Today (FIN-004).** Five scopes `finance.visibility.{self,team,businessUnit,company,consolidated}`
(`finance/financialVisibility.ts:52-70`; legacy catalog `access/permissionCatalog.ts:330-370`) plus fact-family gate
`finance.read` (`financialVisibility.ts:74`; `permissionCatalog.ts:313-320`: "this id alone reads nothing"). Reach = union
of grants (`financialVisibility.ts:152-186`). Loader reads Firestore `users` + `roleAssignments`
(`finance/financeReadCallables.ts:57-165`); company/BU binding from assignment scope types (DECISIONS #157, `:114-135`);
SELF = `users/{uid}.employeeId` (`:142`); TEAM = `access/hierarchicalVisibility.ts:67-86` (`visibleRoleIdsFor(viewer.roleIds)`:
the **role hierarchy, not the reporting line**).

**PG already has:** `user_role_assignments.scope_type/scope_value` (`functions/migrations/1757462400000_admin-policy.sql:178-193`),
fail-closed scope evaluator (`adminPolicy/assignmentScope.ts:61`, `:73`), `employee_principal_links`
(`functions/migrations/1758412800000*:115`), `employee_reporting_relationships` (`functions/migrations/1759838400000*:128-163`).

**Field visibility.** There is no per-field finance mask today: every field of an in-reach fact is returned
(`financialReportingRead.ts:74-102`). The PG read preserves that; field masking is **not** introduced in this wave.

**Reach as SQL (F1 = A).** Parameters are server-bound, never caller-supplied.

```sql
-- :consolidated bool, :companies text[], :units text[], :self text|null, :team text[]
SELECT i.id FROM eos_finance.invoices i
 WHERE i.tenant_id = :tenant AND (
       :consolidated
    OR i.operating_company_key = ANY(:companies)
    -- BU: each grant judged ALONE (parity financialVisibility.ts:171-175): invoice has lines and EVERY line = that unit
    OR EXISTS (SELECT 1 FROM unnest(:units) u(bu)
                WHERE EXISTS (SELECT 1 FROM eos_finance.invoice_lines l WHERE l.tenant_id=i.tenant_id AND l.invoice_id=i.id)
                  AND NOT EXISTS (SELECT 1 FROM eos_finance.invoice_lines l WHERE l.tenant_id=i.tenant_id
                                   AND l.invoice_id=i.id AND l.business_unit_id IS DISTINCT FROM u.bu))
    OR (i.credited_salesperson_id IS NOT NULL AND i.credited_salesperson_id = :self)
    OR  i.credited_salesperson_id = ANY(:team))
-- applications: invoice_id IN visible; receipts: id IN (payment_id of visible applications)
```

No reach → `NO_REACH`, no SQL. A valueless scoped grant confers nothing (`assignmentScope.ts`). Caller filters are
extra `AND`s after reach, so they only narrow (SYSTEM_AUTHORITIES.md:88).

**Edges.** N6 ← N1 (tables), N4 (SELF/TEAM columns), F1 (model), F2 (TEAM source), F3 (payments gate). Registering
5 capability rows moves ~6–7 pinned expectations per key (memory: "registering a canonical PG capability fans out").

---

## 3. N7–N8 — SQL aggregation contract and completeness

### 3.1 Callers (all route through `field-ops-app-vite/src/services/financeReadCallableClient.js`)

| Surface | File:line | PG op |
|---|---|---|
| Overview / Invoices / AR | `modules/financials/FinancialsOverview.jsx:54`, `FinancialsInvoices.jsx:57`, `FinancialsAccountsReceivable.jsx:42` | `facts.list` |
| Company / Employee Performance | `FinancialsCompanyPerformance.jsx:49`, `FinancialsEmployeePerformance.jsx:56` | `facts.list include:"aggregates"` |
| Payments | `FinancialsPayments.jsx:46` | `facts.list` RECEIPT+APPLICATION |
| Customer Financials | `FinancialsCustomerFinancials.jsx:48` | `facts.list {accountId}` |
| Invoice / Payment Detail | `FinancialsInvoiceDetail.jsx:50`, `FinancialsPaymentDetail.jsx:44` (whole tenant today) | `facts.list` + `invoiceId`/`paymentId` narrowing filter (new) |
| My Dashboard | `modules/dashboard/MyDashboard.jsx:479` | `facts.list include:"aggregates"` |
| Account AR ×4 | `hooks/useAccountAr.js:48` → `AccountArSection.jsx:51`, `AccountDetail.jsx:409`, `AccountAttentionSection.jsx:98`, `accountPageComponents.js:302` | `account.ar` |

### 3.2 Contract

| Concern | Rule (evidence) |
|---|---|
| Response parity | `facts.list` = `FinancialFactsResult` field for field (`financialReportingRead.ts:104-128`, rows `:74-102`, rollups `financeReadProjection.ts:130-138`, summary `:233-246`). `account.ar` = `AccountInvoiceArResult` (`financeReadCallables.ts:171`). Client view modules unchanged. Additive only: `page.nextCursor`, `rowsComplete`, `asOfMillis`. |
| Outstanding / state | `outstanding = total − (Σapplied − Σrefunded) − Σcredit + Σcharge − Σwrite_off`; VOID if voided, PAID if ≤0, PARTIALLY_PAID if net applied >0, else ISSUED (ports `finance/paymentCommands.ts:83-90`). |
| Money | `BIGINT` minor units, every aggregate `GROUP BY currency` (FIN-003 never-blend). Refuse (`FAILED`) any non-`Number.isSafeInteger`. Unknown currency key `"UNSPECIFIED"` (`financeReadProjection.ts:128`). `agingByCompany`/`summary.byCompany` exact partitions (`:174-190`). |
| Aging | `floor((now − due_date)/1 day)`, `now` read once, returned as `asOfMillis`. Buckets Current/1-30/31-60/61+/unaged (`:115-150`). |
| Period (G-05) | `[start, endExclusive)` via `reportingPeriod.ts` + company calendar (`reportingCalendar.ts:71-80`). Event columns `issued_at`/`received_at`/`applied_at` (`financialReportingRead.ts:186-196`). Shim: client's inclusive `periodEndMillis` (`field-ops-app-vite/src/modules/financials/financialsPeriod.js:25-28`) → `end + 1 ms`. Undated facts excluded under a period (`:199-207`). |
| Rows | Keyset `(event_at DESC, id)`, default 500, hard max 2,000. Aggregates never depend on the page. |

### 3.3 N8 — Completeness guarantee

| Property | Guarantee | Replaces |
|---|---|---|
| Snapshot | One `READ ONLY, REPEATABLE READ` transaction per request | Firestore multi-query reads |
| Aggregates | Computed in SQL over the **whole** visible+filtered set → always `COMPLETE` | #1976 `SCAN_CEILING_REACHED` (cannot occur) |
| References | FKs make an application without its receipt/invoice unrepresentable (`1759017600000:217-248`) | `DANGLING_REFERENCE` (cannot occur) |
| Failure | Any SQL error → `500 FAILED`; never a ready empty page | `financialReportingRead.ts:240-248` |

**Edges.** N7 ← N1, N2, N3 (outstanding is wrong without them), N4 (rollups), N6 (reach). N8 ← N7.

---

## 4. N9 — Render transport and the authority state

| Element | Design | Evidence / pattern |
|---|---|---|
| Route | `/finance/` → `"finance"`, sixth domain in `eosApiDomainFor` (`eosApi/server.ts:41-47`); `createFinanceHttpHandler({reader,pool,verifyToken,allowedOrigins})` next to CRM (`server.ts` ~`:201-214`) | `eosCrm/crmHttp.ts` |
| State | `finance/financeAuthorityState.ts` (proposed): `FINANCE_AUTHORITY` code constant, same machine as `crm/crmWriterState.ts:16-21`, `:38-43`. First act of every op: `assertPostgresFinanceActive` → `503 POSTGRES_FINANCE_INACTIVE` while INACTIVE, **reads included** | `crmHttp.ts:11-12`, `:81`, `:96` |
| Identity | Injected `TokenVerifier` returns subject only (`server.ts:15-17`, `:108-120`; Firebase ID token today). Swapped for EOS session verifier at Authorization v2; handler unchanged | `adminPolicyHttp.ts` |
| Context | `resolveOperationalContext` (`eosOps/capabilityAuthority.ts:165`); tenant only from `x-eos-tenant`; authority-naming body fields refused (`crmHttp.ts:182`) | |
| Loader | `loadFinancialVisibilityFromPostgres(pool, ctx)` → `FinancialVisibilityGrant[]`, reusing pure `buildFinancialVisibilityAuthority` (`financialVisibility.ts:152`). **No Firestore, no `users/{uid}`** | replaces `financeReadCallables.ts:57-165` |
| Errors | 401 unverified; 403 no fact family; 200 `grantedScopes:[]`/`NO_REACH`; 503 inactive; 500 FAILED | |

**Edges.** N9 ← N6, N7, N8. N9's state module is the dependency for N10 (scripts load it pre-SDK) and N11 (writer guard).

---

## 5. N10–N12 — Copy/export, writer freeze, verification

### 5.1 N10 — Tooling (none exists: #1976 note §3.2 item 4)

| Tool | Mode | Behavior | Modelled on |
|---|---|---|---|
| `functions/scripts/exportFinanceSnapshot.js` | Firebase side, read-only | `EOS_FINANCE_SNAPSHOT` v1: invoices, payments, applications, adjustments, refunds, `counters/invoices_*`, finance audit events (actor provenance); `.sha256`; refuses production | `functions/scripts/exportCrmSnapshot.js` |
| `functions/scripts/financeCutover.js` | `--mode census` | **No Firebase module.** Counts per family; dangling refs; invoice with no lines/company/currency mismatch; header totals vs lines (`eosOps/invoiceAuthority.ts:304`); stored projection vs facts (`reconcileInvoiceProjection`); actor uid → Principal resolvable; `cw-` fixtures excluded; CRM/Commercial orphans (advisory); target empty | `functions/scripts/crmCutover.js:1-40`; `crm/crmCutoverSnapshot.ts:471` |
| same | `--mode copy` | ONE transaction, ONE tenant; refuses unless census copy-ready; line ids `<invoiceId>:<index>`; INSERT only; counters `max(allocated)+1`; refuses non-identical non-empty target | `crm/crmCutoverCopy.ts:197` |
| same | `--mode verify` | Id sets equal; per invoice total/applied/credits/charges/writeOff/outstanding/state (PG SQL) = Firestore stored projection; per receipt amount = applied + unapplied; per currency × company billed/collected/outstanding; `facts.list` = `listFinancialFacts` for CONSOLIDATED/company/SELF personas (minus `completeness.scans`) | `crmCutoverCopy.ts:376` |

Runs in the Render Shell against `eos-api-nonprod`, CRM environment fence (`crmCutover.js:23-31`).

### 5.2 N11 — Writer freeze (`FIRESTORE_FINANCE_WRITERS`, SERVER_GUARD first act; mirrors `crmWriterState.ts:77-80`)

| Writer id | Entry | Export | Capability gate | UI callers |
|---|---|---|---|---|
| `finance.issueInvoice` | `finance/invoiceCallables.ts:112` (+ `invoiceNumbering.ts:48`) | `index.ts:100` | `finance.invoice.issue` (`invoiceCallables.ts:28`) | **none** (`field-ops-app-vite/src/modules/financials/FinancialsBillingQueue.jsx:11`, `:50`) |
| `finance.applyPayment` | `paymentCallables.ts:62` | `index.ts:103` | `finance.payment.apply` (`paymentCallables.ts:22`, `:43-53`) | **none** (`FinancialsPaymentDetail.jsx:199-201`) |
| `finance.recordInvoiceAdjustment` | `adjustmentCallables.ts:58` | `index.ts:106` | `finance.adjustment.record` | **none** (`FinancialsCreditsAdjustments.jsx:8`) |
| `finance.recordRefund` | `refundCallables.ts:57` | `index.ts:119` | `finance.refund.record` | **none** |
| `finance.reviewFixtures` | `functions/scripts/financialReviewFixtures.mjs:18-24` | — | operator | script |

All four capabilities are `active:false` in the legacy catalog (`access/permissionCatalog.ts:278-310`, `:374-380`) and all
collections are deny-all (`firestore.rules:1752-1794`), so the freeze needs **no Rules change** and no client fuse.
Quiescence proof: `max(issuedAt/receivedAt/appliedAt/recordedAt)` and the finance audit-event count unchanged across an
agreed window; zero Functions invocations of the 4 callables.

### 5.3 N12 — Verification gates

| Gate | Proof |
|---|---|
| G2 schema | migration applied locally; PG suites green (`POLICY_TEST_DATABASE_URL`); pinned-expectation fan-out updated |
| G3 contract | `facts.list`/`account.ar` = `financeReadProjection` fixtures; never-blend and partition tests |
| G4 transport | 503 while INACTIVE; per-persona reach while ACTIVE (incl. BU-per-grant and valueless-grant refusals) |
| G6 census | copy-ready evidence file |
| G8 verify | zero diffs (§5.1 verify) |
| G10 client | 16 canonical personas per-page e2e; Firebase finance callable invocations = 0 over the window |

**Edges.** N10 ← N2–N5, N9. N11 ← N9, F5. N12 ← N10, N11 + quiescence.

---

## 6. N13–N18 — Activation, client switch, deletion, cleanup

| Node | Action | Items (evidence) | Depends on |
|---|---|---|---|
| N13 | ACTIVATE_POSTGRES (nonprod) | flip `FINANCE_AUTHORITY` to FROZEN/ACTIVE; smoke reads per persona | N12 zero diffs, F6 |
| N14 | Client switch | `field-ops-app-vite/src/services/financeReadCallableClient.js` (both functions) → Render client; Detail pages use id filters; `metadata/callableListSource.js:104-120` | N13 |
| N15 | **Reader deletion** | `listAccountInvoiceAr`, `listFinancialFacts` exports (`index.ts:109-110`); `finance/financeReadCallables.ts` (incl. `loadFinancialVisibilityAuthority` `:57`); `finance/financialReportingRead.ts`; their tests; #1976 stopgap | N14 + zero-invocation window |
| N16 | PG write commands | `finance.payment.apply`, `adjustment.record`, `refund.record` over `eos_finance`, reusing pure cores (`paymentCommands.ts`, `adjustmentCommands.ts`, `refundCommands.ts`); idempotency via `payment_applications.idempotency_key` + equivalents; audit to PG (accountability audit ruling). `invoice.issue` after Commercial C6 | N13, N2, N3, N5, F3, F4, M-4 |
| N17 | **Writer deletion** | exports `index.ts:100`, `:103`, `:106`, `:119`; `invoiceCallables.ts`, `paymentCallables.ts`, `adjustmentCallables.ts`, `refundCallables.ts`, `invoiceNumbering.ts`; `functions/scripts/financialReviewFixtures.mjs` (retire or port); admin profile citations `metadata/administration/profiles/invoice.js:254-258`, `profiles/payment.js:199-279`; **keep** pure cores | N11, RETIRE_FIRESTORE, N16 or F5 |
| N18 | **Rules + catalog cleanup** | Rules: `firestore.rules:1752-1794` (invoices, payments, payment_applications, invoice_adjustments, refunds) + mirror `field-ops-app-vite/firestore.rules` — nonprod first; production only under its own gate (production Rules fence). Catalog: `access/permissionCatalog.ts:278-380` (finance.invoice.issue, payment.apply, adjustment.record, read, visibility.×5, refund.record) + client mirror `field-ops-app-vite/src/access/permissionCatalog.ts:284-386`; `access/environmentCapabilityOverrides.ts:129-133`, `:243`, `:493-497`, `:547`; `access/governedBusinessRoles.ts:209-218` + mirror; client `finance.read` gates (`App.jsx`, `financialsSurface.js`, `governedSurfaceCapabilities.js`, `objectPermissionMap.js`) → canonical keys. Also `constants/collections.ts:71-82`, `ownership/ownershipMatrix.ts:184-185`, `performance/performanceMetricRegistry.ts:439`, `:449`, SYSTEM_AUTHORITIES.md rows 88, 107-111 | N15, N17 |
| — | Firestore data deletion | archived snapshot retained, then delete `invoices`, `payments`, `payment_applications`, `invoice_adjustments`, `refunds`, `counters/invoices_*`, finance `audit_events` (destructive, Owner) | N18 |
| — | Final proof | static grep for the 6 callable names across `field-ops-app-vite/src`, `functions/src`, `functions/scripts` = 0 outside tests/docs; runtime invocations = 0; no `firebase` import in finance modules | all |

---

## 7. Rollback (per step)

Semantics mirror `crm/crmWriterState.ts`: `ROLLBACK_BEFORE_POSTGRES_WRITES` exists only from FROZEN/INACTIVE (`:17`, `:40`);
OPEN/ACTIVE is refused as `TWO_AUTHORITATIVE_WRITER_SETS` (`:57`); any ACTIVE→OPEN attempt is refused as
`NO_SILENT_REVERT_TO_FIRESTORE` (`:66`). Nothing leaves ACTIVE through the machine.

| Step | How to revert | Irreversible part | Data at risk |
|---|---|---|---|
| S1 migration (N2–N6 rows) | guarded down migration while tables are empty | none while empty | none |
| S2–S5 code (loader, repos, handler, tooling) | revert PR; dormant behind INACTIVE | none | none |
| S6 FREEZE (N11) | `ROLLBACK_BEFORE_POSTGRES_WRITES` → OPEN/INACTIVE (code-constant PR) | none | none (no UI caller) |
| S7 COPY/VERIFY (N12) | `TRUNCATE` the tenant's `eos_finance` rows (only while INACTIVE), then rollback as S6 | none; Firestore untouched | none |
| S8 ACTIVATE (N13) | **No machine revert** (`NO_SILENT_REVERT_TO_FIRESTORE`). Before any PG write, reads can be re-pointed only by an Owner-ruled code change adding a new transition; PG holds only copied facts, so Firestore is still whole | the state transition | none until the first PG write |
| S9 first PG write (N16) | forward-fix only | **Irreversible**: PG-born facts have no Firestore counterpart; reverting would need a reverse copy that is deliberately not built | every PG-born fact |
| S10 client switch (N14) | revert client PR (Render read stays authoritative) | none | none |
| S11 RETIRE + reader/writer deletion (N15, N17) | re-deploy deleted code from git; state stays RETIRED | RETIRED is terminal | none (PG authoritative) |
| S12 Rules/catalog (N18) | revert Rules PR + redeploy (Owner gate) | none | none |
| S13 Firestore data deletion | restore from archived `EOS_FINANCE_SNAPSHOT` (read-only archive, not an authority) | **Irreversible** as live data | archive only |

---

## 8. Owner decision sheet (F1–F6)

| # | MEASURED FACT (cited) | RECOMMENDATION | DECISION REQUIRED | IMPLEMENTATION CONSEQUENCE |
|---|---|---|---|---|
| **F1 Visibility model** | FIN-004 has 5 scopes + gate (`financialVisibility.ts:52-74`); company/BU via assignment scope (DECISIONS #157); PG has `user_role_assignments.scope_type/value` (`1757462400000:178-193`) and a fail-closed evaluator (`assignmentScope.ts:61`, `:73`); `finance.visibility.*` unregistered in PG; only `isOwnAssignment` may get a PG condition evaluator (accepted dispositions) | **A**: register the 5 `finance.visibility.*` keys; company/BU reach from scoped assignments. Reject B (grant conditions) and C (own table = second grant authority) | Approve A (or choose B/C) | S1 adds 5 capability rows + grants (~6–7 pinned expectations per key); N6 loader uses `assignmentAdmitsDecision`; no new grant table |
| **F2 "Team"** | TEAM = role hierarchy (`access/hierarchicalVisibility.ts:67-86`, `visibleRoleIdsFor(viewer.roleIds)`), not the reporting line; PG has `employee_reporting_relationships` (`1759838400000:128-163`) | **Parity (role hierarchy)** for the cutover; any move to reporting line is a separate, later ruling | Parity or reporting line | Parity: port the role-hierarchy set into PG (needs PG role hierarchy source). Reporting line: behavior change, re-baselines persona e2e and verify's SELF/TEAM comparisons |
| **F3 Payment permission gate** | Read: one legacy key `finance.read` covers invoices+payments (`permissionCatalog.ts:313-320`); PG split into `finance.invoice.read` and `finance.payment.read`, same 14 Roles (`1761609600000:17-20`). Write: `applyPayment` gates on `finance.payment.apply` only (`paymentCallables.ts:43-53`), legacy `active:false` (`permissionCatalog.ts:290-296`); PG grants it to 6 Roles (accountingManager, admin, controller, financeManager, generalManager, owner; `1761609600000:141-146`) — unlike `invoice.issue`/`adjustment.record`, which add partsManager | Read: payments require **`finance.payment.read` AND invoice reach** (payments inherit invoice visibility). Write: keep `finance.payment.apply` with the 6 PG Roles | Confirm read gate (payment.read alone vs + invoice.read) and the 6-Role apply set | Read gate fixes the N6 WHERE for RECEIPT/APPLICATION; apply set fixes N16 authorization and test personas. No new capability either way |
| **F4 Adjustment/refund scope** | PG has no adjustment or refund table (`1759017600000:138-143`); outstanding depends on both (`financeReadProjection.ts:37-39`; `refundCommands.ts:82-101`); nonprod volume unmeasured (#1976 §4); FIN-007 approval values absent (M-4) | **Same wave** for the tables (N2, N3) and COPY; PG adjust/refund **commands** wait for M-4 | Same wave, or defer (allowed only if census = 0 of each **and** writers stay frozen) | Same wave: S1 includes both tables; verify compares credits/charges/writeoffs/refunds. Defer: outstanding in PG is wrong the moment one exists; N17 cannot delete those writers |
| **F5 Writer-freeze behavior** | All 4 writers have **zero UI callers** (§5.2); all are server callables, legacy `active:false`, collections deny-all (`firestore.rules:1752-1794`); CRM froze with SERVER_GUARD first-act (`crmWriterState.ts:72-80`) | Freeze via SERVER_GUARD, no Rules change; accept **writes unavailable** from FREEZE until each PG command ships (issue until Commercial C6) | Accept unavailability, or require PG write commands before ACTIVATE | Accept: N13 and N17 do not wait on N16; reads cut over first. Require: N16 (except issue) moves before N13 and the critical path grows by one L-sized step |
| **F6 Cutover/rollback expectation** | CRM machine: rollback only before PG writes; `NO_SILENT_REVERT_TO_FIRESTORE` (`crmWriterState.ts:17`, `:66`); `eos_finance` has 0 rows (access matrix `:147`); production Rules fence (never deploy main's Rules to production) | Adopt the CRM semantics verbatim: rollback free through COPY/VERIFY; ACTIVATE is a one-way door; first PG write is irreversible; nonprod first, production is its own later gate | Accept one-way ACTIVATE and nonprod-first sequencing | `financeAuthorityState.ts` copies the CRM transitions and error codes; §7 table becomes the runbook; production activation needs a separate Owner authorization and operator execution |

---

## 9. Other decisions and missing authority

| # | Item | Recommendation | Who | Blocks |
|---|---|---|---|---|
| D-4 | Attribution on `invoices`: columns / JSONB / derive via Sales Order (contradicts SYSTEM_AUTHORITIES.md:88 "never re-derived") | columns | Owner ratifies | N4 |
| D-7 | Copied `issued_by`/`recorded_by`/`created_by`: audit-event actor → Principal / declared migration actor + legacy uid | audit mapping, migration actor fallback | Owner ratifies | N5, N12 |
| D-8 | Reporting calendar: TS constant / column on `tenant_operating_companies` | keep constant | Lane | — |
| D-9 | Row page bound + `rowsComplete` UI copy | 500 / 2,000 | Lane, Owner UX | N14 |
| M-1 | Accounting system of record (DECISIONS #145 §3 "NOT YET SELECTED") | EOS stays operational subledger | Owner | not this wave |
| M-2 | Service billing (FIN-BLOCK-002) | only Sales-Order invoices move | Owner | not this wave |
| M-3 | Void policy; no write path (`1758931200000:93-103`) | — | Owner | nothing |
| M-4 | FIN-007 approval values for adjust/refund | — | Owner | N16 adjust/refund |
| M-5 | Nonprod Firestore finance volume | — | Operator census | N12 |

---

## 10. Step table

| # | Step | Nodes | Owner | Reversible? | Proof | Size |
|---|---|---|---|---|---|---|
| S0 | Rulings F1–F6, D-4, D-7 | — | Owner | yes | DECISIONS.md entries | S |
| S1 | Migration: adjustments, refunds, attribution, counters, `legacy_*`, 5 visibility capabilities | N2–N6 | Lane | yes while empty | PG suites green; pin fan-out | M |
| S2 | PG visibility loader + SQL reach | N6 | Lane | yes (dormant) | per-scope tests | M |
| S3 | `facts.list` / `account.ar` repositories | N7, N8 | Lane | yes | G3 | L |
| S4 | `financeAuthorityState.ts` + `/finance/` handler | N9 | Lane, Owner review | yes (INACTIVE) | G4 | M |
| S5 | Export + census/copy/verify | N10 | Lane | yes | fence tests; fixture round-trip | L |
| S6 | FREEZE → quiescence → export → census | N11 | Operator, Owner authorizes | yes (ROLLBACK_BEFORE_POSTGRES_WRITES) | G6 | S |
| S7 | COPY once → VERIFY | N12 | Operator | yes (empty target, INACTIVE) | G8 | S |
| S8 | ACTIVATE_POSTGRES (nonprod) | N13 | Owner | **no** | smoke reads per persona | S |
| S9 | PG write commands (apply/adjust/refund; issue after C6) | N16 | Lane | per command until first write; **first write irreversible** | command + idempotency + PG audit tests | L |
| S10 | Client switch | N14 | Lane, Owner UX | yes (revert client) | G10 | M |
| S11 | RETIRE_FIRESTORE + reader/writer deletion | N15, N17 | Owner | **no** (RETIRED terminal) | grep = 0; invocations = 0 | M |
| S12 | Rules + catalog cleanup (nonprod; production under its own gate) | N18 | Owner (protected policy) | yes (redeploy) | Rules tests; catalog pins | M |
| S13 | Firestore finance data deletion | — | Owner (destructive) | **no** | archive sha256 recorded | S |
