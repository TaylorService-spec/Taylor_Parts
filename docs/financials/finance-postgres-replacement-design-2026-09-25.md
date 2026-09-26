# Finance on PostgreSQL: replacing every Firebase finance reader and writer (design, 2026-09-25)

**Status: DESIGN — HOLD.** Docs only. Nothing here is code, a copy, a cutover, a grant or an activation.
Base `09d63c4e`. Line references are to that base unless a path says otherwise. Input note:
#1976's `docs/financials/financial-facts-read-temporary-firebase-limit-2026-09-25.md` (branch
`lane/s4-financial-facts-complete-read`), which scoped the reporting read only. This doc covers **all** Firebase
finance readers and writers.

**Target (Owner):** zero Firebase, including auth. EOS/PostgreSQL owns finance facts, authorization and aggregates.
Firebase is not extended. The #1976 Firebase read is a stopgap and is deleted at the end of this plan.

**Headline design.**
1. **Schema first.** `eos_finance` can't answer "outstanding" today. It has no adjustments, no refunds and no
   invoice attribution. One additive migration closes those gaps (§1).
2. **One Render domain, `/finance/`.** A sixth handler in `eosApi/server.ts` serves two SQL reads,
   `facts.list` and `account.ar`. Their response shapes match `listFinancialFacts` and `listAccountInvoiceAr`
   exactly, so the client flip is only a transport swap (§3, §4).
3. **Reach is a SQL `WHERE` clause.** It is computed from PostgreSQL grants only (§2).
4. **One state constant, `FINANCE_AUTHORITY`.** It is Firestore OPEN/FROZEN/RETIRED × PostgreSQL
   INACTIVE/ACTIVE, the CRM pattern, and it gates reads **and** writes together. The Firebase writers have
   **zero UI callers**, so a freeze costs no production workflow. That lets the read cutover go ahead before the
   PostgreSQL write commands exist (§5).
5. **Copy once from a snapshot file.** Then verify against the Firestore-stored AR projection, activate, flip the
   client, and delete (§5, §6).

---

## 1. Authoritative finance inputs: PostgreSQL today vs Firestore-only

### 1.1 What exists in PostgreSQL (`eos_finance`, **0 rows**: `docs/testing/persona-object-workflow-access-matrix.md:147`, `:585`)

| Object | Source | What it carries | Gap for the Financials read |
|---|---|---|---|
| `invoices` | `migrations/1758931200000_invoice-authority.sql:153-212` | tenant, `operating_company_key` (NOT NULL, no default), `invoice_number` (unique per tenant+company), `account_id`, `sales_order_id`, `currency`, `due_date`, `issued_at`, `issued_by`, void triple | **No credited salesperson, responsible employee or attribution snapshot.** The migration says so at `:58-61`: attribution is "carried on the frozen attribution snapshot" and the invoice has no owner column. There is also no stored state or totals, by design (`:36-40`, `:80-102`). |
| `invoice_lines` | same, `:225-265` | `business_unit_id` (FIN-002, nullable), qty/price/discount/tax, and **generated** subtotal/taxable/line total | none (BU reach works per line) |
| `invoice_totals` (view) | same, `:276-296` | total per invoice, derived from the lines, plus `line_count` and `is_void` | none |
| `payments` | `migrations/1759017600000_ar-cash-application-authority.sql:167-210` | company, account, currency, `amount_minor`, method, `external_ref`, `received_at`, `recorded_by` | none |
| `payment_applications` | same, `:217-248` | `payment_id`, `invoice_id`, currency, `applied_amount_minor`, `applied_at`, `idempotency_key` (unique), `created_by`. **Append-only** (triggers `:411-415`). | **No reversal fact.** The migration says so at `:138-143`: "`refunds` is a separate Firestore collection … Named as a gap." |
| `payment_balances`, `invoice_application_totals` (views) | same, `:426`, `:449` | receipt applied/unapplied; applied per invoice | none |
| canonical capabilities | `migrations/1761609600000_finance-administration-reorder-vocabulary.sql:47-66`, grants `:93-160` | `finance.invoice.read`, `finance.payment.read` (split from `finance.read`, same 14 Roles, `:17-20`), `finance.invoice.issue`, `finance.payment.apply`, `finance.adjustment.record`, `finance.refund.record` | **`finance.visibility.*` is not registered** (0 hits in `functions/migrations`). |
| repositories | `eosOps/invoiceAuthority.ts:110` `insertIssuedInvoice`, `:223-261` reads, `:304` `reconcileMigratedInvoice`; `eosOps/cashApplicationAuthority.ts` (**pure**, with no SQL: `:144-191`); `eosOps/invoiceTotals.ts` | Invoice insert, read and reconcile. Cash math only. | **No payment, adjustment or refund repository.** Nothing composes `insertIssuedInvoice` outside tests. |

### 1.2 Firestore-only families

| Family | Written today by | Needed by the Financials read? | PostgreSQL target needed? |
|---|---|---|---|
| `invoice_adjustments` (`constants/collections.ts:77`) | `recordInvoiceAdjustment` (`finance/adjustmentCallables.ts:58`, write `:84`). Record: type CREDIT_MEMO/DEBIT_CHARGE/WRITE_OFF, amount, reason, `effectiveDate`, attribution (`adjustmentCommands.ts:44-56`). | **YES.** `outstanding = total − applied − credits + charges − writeoffs` (`financeReadProjection.ts:37-39`), and summary, aging and rollups all read it (`:124-150`, `:233-283`). | **YES: `eos_finance.invoice_adjustments`**, append-only, with an FK to `(tenant_id, id, currency)`. Without it, PostgreSQL outstanding is wrong whenever any adjustment exists. |
| `refunds` (`collections.ts:82`) | `recordRefund` (`refundCallables.ts:57`, write `:79`). It reduces the invoice's `appliedMinor` (`refundCommands.ts:82-101`). | **YES.** It is part of net applied, collected and outstanding. | **YES: `eos_finance.refunds`**, append-only, with a nullable `payment_id` (`refundCommands.ts:37`). PostgreSQL applications are append-only, so the reversal has to be its own fact. |
| `counters/invoices_<companyId>` | `issueInvoice` via `invoiceNumbering.ts:19-20`, `:48` | no (read only) | **YES, for writes only:** `eos_finance.invoice_number_counters (tenant, company, next_value)`, seeded at COPY from the Firestore counter. |
| invoice **attribution snapshot** (the `attribution` map on the invoice document, `invoiceCommands.ts:233-239`, `:317`; shape in `financialAttribution.ts:160-170`) | `issueInvoice` | **YES.** SELF and TEAM reach and `byCreditedSalesperson` read `attribution.creditedSalespersonId` (`financialVisibility.ts:178-179`, `:190-198`). | **YES: columns on `invoices`**: `credited_salesperson_id`, `responsible_employee_id`, `attribution_source_type`, `attribution_source_record_id`, `attribution_event_at`, `attribution_business_unit_id`. All are nullable where FIN-002 says so. |
| `inventory_acquisition_costs` (`acquisitionCost.ts:45`) | receiving (`inventoryReceiving/receiveInventoryStockCommand.ts:468`) | **NO.** `listFinancialFacts` serves only INVOICE, PAYMENT_RECEIPT and PAYMENT_APPLICATION (`financialReportingRead.ts:50`). Margin is UNKNOWN (FIN-006). | Yes eventually, but in the **Reorder/Receiving** lane, not this wave. |
| `financial_policy_profiles` (`financialPolicyProfileCommand.ts:40`) | the command module only. It has **no callable export** in `index.ts`. | NO | Later (FIN-007 policy values). Not this wave. |
| `work_order_labor_entries` (`workOrderLabor/workOrderLaborCommand.ts:46`) | labor callables (`index.ts:539`) | NO. Service billing is FIN-BLOCK-002. | Work Orders lane. Not this wave. |
| finance **audit events** (`stageAuditEventWithId`: `invoiceCallables.ts:17`, `paymentCallables.ts:19`, …) | all four writers. The audit id is the idempotency key (`invoiceCallables.ts:57-76`). | no | **Provenance input to COPY:** the invoice and payment documents don't store the actor. PostgreSQL requires `issued_by` and `recorded_by` (`1758931200000:172-174`; `1759017600000:195-199`). |

**Dependencies.** `invoices.account_id` and `sales_order_id` have no FK (`1758931200000`), so COPY does not
*require* CRM or Commercial rows. Census should still report orphans against `eos_crm` / `eos_commercial` when
they are populated. PostgreSQL **issuance** needs the governed Sales Order in PostgreSQL
(`invoiceCallables.ts:80` reads the Firestore order today), so it waits for Commercial C6.

---

## 2. Governed object-level visibility in PostgreSQL

**Today (FIN-004).** `financialVisibility.ts:52-70` defines five scopes, with capabilities `finance.visibility.{self,team,businessUnit,company,consolidated}`.
There is also a fact-family gate, `finance.read` (`:74`). Reach is the union of the grants (`:152-186`). The loader
`financeReadCallables.ts:57-165` reads Firestore `users` and `roleAssignments`. Company and BU binding come from
role-assignment scope types `operatingCompany` and `businessUnit` (DECISIONS #157, `:114-135`). SELF is
`users/{uid}.employeeId` (`:142`). TEAM is `hierarchicalVisibility.ts:67-86`, which follows the **role hierarchy, not the
reporting line**.

**What PostgreSQL already has.** `user_role_assignments.scope_type` and `scope_value` (`1757462400000_admin-policy.sql:178-193`).
There is a fail-closed evaluator that matches `operatingCompany` and `businessUnit` by exact value
(`adminPolicy/assignmentScope.ts:61`, `:73`). There is `employee_principal_links` (`1758412800000:115`) and
`employee_reporting_relationships` (`1759838400000:128-163`). So the COMPANY and BU binding model from #157 can be expressed in
PostgreSQL without any new mechanism.

### 2.1 Options (**OWNER DECISION D-1**)

| Option | Fact-family gate | Reach | Assessment |
|---|---|---|---|
| **A (recommended). Scope on the role assignment plus visibility capability keys.** | `finance.invoice.read` (INVOICE), `finance.payment.read` (RECEIPT/APPLICATION, **and** the invoice gate, because payments inherit invoice visibility) | Register the 5 `finance.visibility.*` keys in `eos_policy.capabilities`. Company and BU reach come from assignments with `scope_type` `operatingCompany` / `businessUnit`, checked through `assignmentAdmitsDecision`. SELF, TEAM and CONSOLIDATED come from `global` assignments. | This is #157 carried over exactly, and the evaluator exists. It moves the pinned capability expectations: one key moves about 6-7 pins (see memory "registering a canonical PG capability fans out"). |
| B. Fold reach into the read capability as a `capability_grant_conditions` row (`1762214400000:127-139`) | `finance.invoice.read` | JSON condition per grant | Conflicts with the accepted condition dispositions (only `isOwnAssignment` gets a PostgreSQL evaluator). **Not recommended.** |
| C. A dedicated `eos_finance.visibility_grants` table | as in A | per principal, scope and value | This is a second grant authority beside `user_role_assignments`. **Rejected** by the one-authority rule. |

**Sub-decisions:** **D-2** TEAM semantics: keep the role hierarchy (parity) or switch to the reporting line (a behavior change).
**D-3** whether the payments family requires `finance.payment.read` alone, or both `finance.payment.read` and
`finance.invoice.read`. Today one key, `finance.read`, covers both.

### 2.2 Reach as SQL (Option A). The server binds the parameters, which are never supplied by the caller.

```sql
-- :consolidated bool, :companies text[], :units text[], :self text (employee id | null), :team text[]
WITH visible_invoice AS (
  SELECT i.id FROM eos_finance.invoices i
   WHERE i.tenant_id = :tenant AND (
         :consolidated
      OR i.operating_company_key = ANY(:companies)
      -- BU: each grant is judged ALONE (parity with financialVisibility.ts:171-175): the invoice has lines and
      -- EVERY line is exactly that unit. A BU1+BU2 invoice is NOT visible to a BU1+BU2 holder -- today's rule.
      OR EXISTS (SELECT 1 FROM unnest(:units) u(bu)
                  WHERE EXISTS (SELECT 1 FROM eos_finance.invoice_lines l WHERE l.tenant_id=i.tenant_id AND l.invoice_id=i.id)
                    AND NOT EXISTS (SELECT 1 FROM eos_finance.invoice_lines l
                                     WHERE l.tenant_id=i.tenant_id AND l.invoice_id=i.id
                                       AND l.business_unit_id IS DISTINCT FROM u.bu))
      OR (i.credited_salesperson_id IS NOT NULL AND i.credited_salesperson_id = :self)
      OR  i.credited_salesperson_id = ANY(:team)))
-- applications: invoice_id IN visible_invoice; receipts: id IN (payment_id of those applications)
```

If no grant confers reach, the answer is `NO_REACH` and no SQL runs. A valueless company or BU grant confers nothing
(`assignmentScope.ts` refuses a scoped assignment that has no value). Caller filters are extra `AND`s applied after reach, so a filter can only narrow the answer
(`financialReportingRead` contract, SYSTEM_AUTHORITIES.md:88).

---

## 3. SQL aggregate and read contract

### 3.1 Callers (from `useFinancialFacts` and `useAccountAr`)

| Surface | File:line | Request today | PostgreSQL operation |
|---|---|---|---|
| Overview | `modules/financials/FinancialsOverview.jsx:54` | INVOICE, company/unit/period | `facts.list` |
| Invoices | `FinancialsInvoices.jsx:57` | INVOICE, company/period | `facts.list` (rows) |
| Accounts Receivable | `FinancialsAccountsReceivable.jsx:42` | INVOICE, company/period | `facts.list` |
| Company & BU Performance | `FinancialsCompanyPerformance.jsx:49` | INVOICE, period | `facts.list` (aggregates) |
| Employee Performance | `FinancialsEmployeePerformance.jsx:56` | INVOICE, period | `facts.list` (aggregates) |
| Payments | `FinancialsPayments.jsx:46` | RECEIPT and APPLICATION | `facts.list` (rows) |
| Customer Financials | `FinancialsCustomerFinancials.jsx:48` | `{accountId}` | `facts.list` |
| Invoice Detail | `FinancialsInvoiceDetail.jsx:50` | `{}`, the whole tenant | `facts.list` plus `invoiceId` filter (new, narrowing only) |
| Payment Detail | `FinancialsPaymentDetail.jsx:44` | `{}`, the whole tenant | `facts.list` plus `paymentId` filter (new, narrowing only) |
| My Dashboard tiles | `modules/dashboard/MyDashboard.jsx:479` | period only, all families | `facts.list` with `include:"aggregates"` |
| Account AR (4 sites) | `hooks/useAccountAr.js:48` → `AccountArSection.jsx:51`, `AccountDetail.jsx:409`, `AccountAttentionSection.jsx:98`, `accountPageComponents.js:302` | `listAccountInvoiceAr {accountId}` | `account.ar` |

### 3.2 Response parity

`facts.list` returns `FinancialFactsResult` **field for field** (`financialReportingRead.ts:104-128`): `status`,
`invoices[]` (`InvoiceReportRead` `:74-78`), `payments[]` (`:80-92`), `applications[]` (`:94-102`), `summary`
(`summarizeAccountAr` shape `financeReadProjection.ts:233-246`), `agingByCurrency`, `agingByCompany`, `byCompany`,
`byBusinessUnit`, `byCreditedSalesperson` (`DimensionRollup` `:130-138`), `grantedScopes`, `unattributed`. It also returns
#1976's `completeness` object if #1976 merges. `account.ar` returns the `AccountInvoiceArResult` envelope
(`financeReadCallables.ts:171`). The client domain modules (`financialFactsView.js`, `accountArView.js`) stay
unchanged. Only `services/financeReadCallableClient.js` changes.

### 3.3 Semantics

| Concern | Rule |
|---|---|
| **Completeness** | One `READ ONLY, REPEATABLE READ` transaction per request, which gives a single snapshot by construction. Every aggregate is computed in SQL over the **whole** visible and filtered set, so it is always `COMPLETE`. There is no scan ceiling and no pre-visibility counting. #1976's `SCAN_CEILING_REACHED` cannot happen. |
| **Rows** | Keyset paging on `(event_at DESC, id)`. `page.size` defaults to 500 and has a hard maximum of 2,000. `page.nextCursor` and `rowsComplete:boolean` are the **only** additive fields. Aggregates never depend on the page. `include:"aggregates"` returns no rows (Dashboard, Performance pages). |
| **Dangling references** | FKs make an application without its receipt or invoice unrepresentable (`1759017600000:217-248`), so `DANGLING_REFERENCE` cannot happen. |
| **Money** | `BIGINT` minor units plus `currency`, and every aggregate is `GROUP BY currency` (FIN-003 never-blend, `planVsActual.ts`). They're serialized as JSON numbers, and the server **refuses** (`FAILED`) any value that is not `Number.isSafeInteger`. There is no float and no string-decimal. The unknown-currency key stays `"UNSPECIFIED"` (`financeReadProjection.ts:128`). Company partition: `agingByCompany` and `summary.byCompany` stay exact partitions (`:174-190`). |
| **Outstanding / state** | `outstanding = invoice_totals.total_minor − (Σapplied − Σrefunded) − Σcredit + Σcharge − Σwrite_off`. State is VOID if `voided_at`, else PAID if outstanding ≤ 0, else PARTIALLY_PAID if net applied > 0, else ISSUED. This ports `paymentCommands.ts:83-90`. |
| **Aging** | `daysOverdue = floor((now − due_date)/1 day)`, with `now` read **once** per request. Buckets are Current / 1-30 / 31-60 / 61+ / unaged (`financeReadProjection.ts:115-150`). |
| **Period (G-05)** | The server resolves `[start, endExclusive)` using `reportingPeriod.ts` with the company calendar (`reportingCalendar.ts:71-80`, America/Phoenix, a code constant). SQL is `event_at >= $start AND event_at < $end`. Event columns: `invoices.issued_at`, `payments.received_at`, `payment_applications.applied_at` (`financialReportingRead.ts:186-196`). **Parity shim:** today's client sends an inclusive `periodEndMillis` (`financialsPeriod.js:25-28`), and the handler maps it to `end + 1 ms`. Undated facts are excluded when a period is requested (`:199-207`). |
| **Snapshot of `now`** | This is the only clock in the read, and it is returned as `asOfMillis`. |

---

## 4. Render transport

| Element | Design | Pattern / evidence |
|---|---|---|
| Route | `eosApiDomainFor`: `/finance/` → `"finance"`, the sixth domain (`eosApi/server.ts:41-47`). `createFinanceHttpHandler({ reader, pool, verifyToken, allowedOrigins })` composed next to CRM (`server.ts` CRM block `~:201-214`). | `eosCrm/crmHttp.ts` |
| Fail-closed state | The **first act** of every operation is `assertPostgresFinanceActive(FINANCE_AUTHORITY)`. While INACTIVE it returns `503 POSTGRES_FINANCE_INACTIVE`, **reads included**, because an un-copied `eos_finance` is not an answer. The state is a code constant, never an env var or flag. | `crmHttp.ts:11-12`, `:81`, `:96`; `crm/crmWriterState.ts:1-26`; `origin/lane/s2-commercial-writer-fence:functions/src/eosCommercial/commercialWriterState.ts` |
| Identity | The `TokenVerifier` is injected and returns only the subject (`server.ts:15-17`, `:108-120`, Firebase ID token today). At Authorization v2 it's swapped for the EOS session verifier and **the handler does not change**. | `adminPolicyHttp.ts` `TokenVerifier` |
| Context | `resolveOperationalContext` (`eosOps/capabilityAuthority.ts:165`) returns the EOS Principal, ACTIVE membership, roles and capabilities. The tenant comes only from `x-eos-tenant`. Body fields that name authority are refused (`crmHttp.ts:182`). | |
| Visibility loader | `loadFinancialVisibilityFromPostgres(pool, ctx)` → `FinancialVisibilityGrant[]`. Pure `buildFinancialVisibilityAuthority` (`financialVisibility.ts:152`) is reused for the grant shape. Scoped assignments go through `assignmentsInScope` / `assignmentAdmitsDecision`. SELF uses `employee_principal_links`. TEAM follows D-2. **No Firestore read, no `users/{uid}`.** | replaces `financeReadCallables.ts:57-165` |
| Errors | `401` unverified, `403 FORBIDDEN` no fact family, `200` with `status:"ready"` and `grantedScopes:[]` / `NO_REACH` when there is no reach (parity with `:502` on #1976), `503` when inactive, `500 FAILED` on any SQL error. A failure is never a ready empty page. | `financialReportingRead.ts:240-248` |

---

## 5. COPY / VERIFY and the one-writer switch

### 5.1 State machine: `functions/src/finance/financeAuthorityState.ts` (proposed)

`OPEN/INACTIVE → FREEZE → FROZEN/INACTIVE → ACTIVATE_POSTGRES → FROZEN/ACTIVE → RETIRE_FIRESTORE → RETIRED/ACTIVE`.
`ROLLBACK_BEFORE_POSTGRES_WRITES` is allowed only from FROZEN/INACTIVE. OPEN/ACTIVE is incoherent, and nothing leaves ACTIVE. This is the
CRM machine verbatim (`crmWriterState.ts:14-18`, `:37-42`). One constant covers **reads and writes**. A partial cutover
(reads on PostgreSQL, writes on Firebase) would mean two authorities for one fact.

### 5.2 Writers that must freeze (`FIRESTORE_FINANCE_WRITERS` registry, SERVER_GUARD as their first act)

| Writer id | Entry | UI callers today |
|---|---|---|
| `finance.issueInvoice` | `finance/invoiceCallables.ts:112` (+ counter `invoiceNumbering.ts:48`) | **none**: `FinancialsBillingQueue.jsx:11`, `:50` ("no governed command path wired") |
| `finance.applyPayment` | `paymentCallables.ts:62` | **none**: `FinancialsPaymentDetail.jsx:199-201` |
| `finance.recordInvoiceAdjustment` | `adjustmentCallables.ts:58` | **none**: `FinancialsCreditsAdjustments.jsx:8` |
| `finance.recordRefund` | `refundCallables.ts:57` | **none** (same) |
| `finance.reviewFixtures` | `functions/scripts/financialReviewFixtures.mjs` (calls issueInvoice/applyPayment, `:18-24`) | operator script |

Every writer is a server callable and the collections are already deny-all (`firestore.rules:1752-1794`), so the freeze
needs **no Rules change** and no client fuse. Quiescence proof: `max(issuedAtMillis/receivedAtMillis/appliedAtMillis/
recordedAtMillis)` and the finance audit-event count are unchanged across an agreed window, and Functions logs show zero
invocations of the 4 callables.

**Write cutover.** PostgreSQL commands (`finance.invoice.issue`, `payment.apply`, `adjustment.record`, `refund.record`)
reuse the pure cores (`invoiceCommands.ts`, `paymentCommands.ts`, `adjustmentCommands.ts`, `refundCommands.ts`) over
`eos_finance`. Idempotency uses `payment_applications.idempotency_key` plus equivalents; audit goes to PostgreSQL (accountability audit ruling).
Because no UI calls the writers, **D-6** may allow FROZEN/ACTIVE with read operations only. Writes would then be
*unavailable* (not Firebase) until the PostgreSQL commands ship, and `issue` stays unavailable until Commercial C6.

### 5.3 Tooling (none exists: #1976 note §3.2 item 4)

| Tool | Mode | Checks / behavior | Modelled on |
|---|---|---|---|
| `functions/scripts/exportFinanceSnapshot.js` | operator, Firebase side, read-only | `EOS_FINANCE_SNAPSHOT` v1 file with invoices, payments, payment_applications, invoice_adjustments, refunds, `counters/invoices_*`, and finance audit events (actor provenance). Plus `.sha256`. Refuses production. | `functions/scripts/exportCrmSnapshot.js` |
| `functions/scripts/financeCutover.js` | `--mode census` | Loads **no Firebase module**. Counts per family. Dangling application→invoice/receipt. Invoice with no lines, no company, or a currency mismatch. Stored header totals vs lines (`invoiceAuthority.ts:304`). Stored projection vs facts (`financialReconciliation.ts` `reconcileInvoiceProjection`). Actor uid → EOS Principal resolvable? `cw-` Certification fixtures excluded. Orphans vs `eos_crm` / `eos_commercial` (advisory). Target `eos_finance` empty? | `scripts/crmCutover.js:1-40`; `crm/crmCutoverSnapshot.ts:471` |
| same | `--mode copy` | ONE transaction and ONE tenant (`--tenantKey`). Refuses unless census is copy-ready. Deterministic line ids `<invoiceId>:<index>`. Only INSERTs (append-only triggers hold). Counters seeded at `max(allocated)+1`. Refuses non-empty non-identical target rows. | `crm/crmCutoverCopy.ts:197` |
| same | `--mode verify` | Id sets equal. Per invoice: `total/applied/credits/charges/writeOff/outstanding/state` from **PostgreSQL SQL** = Firestore stored projection. Per receipt: amount = applied + unapplied. Per currency × company: billed, collected and outstanding equal. `facts.list` for 3 personas (CONSOLIDATED / company / SELF) = `listFinancialFacts` output byte-equal (minus `completeness.scans`). | `crmCutoverCopy.ts:376` |

The census, copy and verify steps run in the Render Shell against `eos-api-nonprod`, with the same environment fence as CRM
(`crmCutover.js:23-31`).

---

## 6. Activation, client switch, removal

### 6.1 Gates (in order, each one blocks the next)

G1 Owner D-1/D-2/D-3/D-5 ruled → G2 schema migration applied locally, PG suites green (`POLICY_TEST_DATABASE_URL`)
→ G3 `facts.list` / `account.ar` parity tests = `financeReadProjection` fixtures → G4 transport tests (503 while
INACTIVE; reach correct per persona while ACTIVE) → G5 operator FREEZE + quiescence → G6 export, census copy-ready → G7
COPY → G8 VERIFY zero diffs → G9 Owner ACTIVATE_POSTGRES (nonprod) → G10 client flip, per-page e2e for the 16 canonical
personas, Firebase finance callable invocations = 0 over the window → G11 RETIRE_FIRESTORE → G12 deletion.

### 6.2 Deletion checklist (G12, all required)

| # | Item | Location |
|---|---|---|
| 1 | Read exports `listAccountInvoiceAr`, `listFinancialFacts` | `functions/src/index.ts:109-110` |
| 2 | Writer exports `issueInvoice`, `applyPayment`, `recordInvoiceAdjustment`, `recordRefund` | `index.ts:100`, `:103`, `:106`, `:119` |
| 3 | Firestore adapters and their tests | `finance/financeReadCallables.ts` (incl. `loadFinancialVisibilityAuthority` `:57`), `financialReportingRead.ts`, `invoiceCallables.ts`, `paymentCallables.ts`, `adjustmentCallables.ts`, `refundCallables.ts`, `invoiceNumbering.ts`. **Keep** the pure cores that the PostgreSQL code reuses. |
| 4 | Client transport | `field-ops-app-vite/src/services/financeReadCallableClient.js` (both functions) → Render client; `metadata/callableListSource.js:104-120` |
| 5 | Admin profile citations of callables | `metadata/administration/profiles/invoice.js:254-258`, `profiles/payment.js:199-279` → PostgreSQL command citations |
| 6 | Firestore Rules blocks (nonprod first; production only under its own gate, per the production Rules fence) | `firestore.rules:1752-1794` (invoices, payments, payment_applications, invoice_adjustments, refunds) and the mirror in `field-ops-app-vite/firestore.rules` |
| 7 | Firestore data (archived snapshot retained, then deleted: destructive, Owner) | `invoices`, `payments`, `payment_applications`, `invoice_adjustments`, `refunds`, `counters/invoices_*`, finance `audit_events` |
| 8 | Legacy TS capability catalog entries | `functions/src/access/permissionCatalog.ts:278-380`; `field-ops-app-vite/src/access/permissionCatalog.ts:284-386`; `access/environmentCapabilityOverrides.ts:129-133`, `:243`, `:493-497`, `:547`; `access/governedBusinessRoles.ts:209-218` (and the client mirror); client gates on `finance.read` (`App.jsx`, `financialsSurface.js`, `governedSurfaceCapabilities.js`, `objectPermissionMap.js`) → canonical keys |
| 9 | Collection constants and ownership rows | `constants/collections.ts:71-82`; `ownership/ownershipMatrix.ts:184-185` |
| 10 | Firestore fixture script | `functions/scripts/financialReviewFixtures.mjs` (retire, or port to the PostgreSQL commands) |
| 11 | Doc text naming the callable as the authority | `performance/performanceMetricRegistry.ts:439`, `:449`; SYSTEM_AUTHORITIES.md rows 88, 107-111 |
| 12 | Proof | Static grep for the 6 callable names across `field-ops-app-vite/src`, `functions/src`, `functions/scripts` = 0 outside tests/docs; runtime invocations = 0; `firebase` import absent from finance modules |

---

## 7. Decisions and missing authority

| # | Decision | Options | Who decides | Blocks |
|---|---|---|---|---|
| D-1 | Visibility model in PostgreSQL | A scope-on-assignment plus 5 keys (rec.) / B grant conditions / C own table | **Owner** (security model) | S2 onward |
| D-2 | TEAM meaning | role hierarchy (parity, `hierarchicalVisibility.ts:67`) / reporting line (`employee_reporting_relationships`) | **Owner** | S2 |
| D-3 | Payments fact-family gate | `payment.read` only / `payment.read` + `invoice.read` | **Owner** | S2 |
| D-4 | Attribution columns on `invoices` | columns (rec.) / JSONB snapshot / derive via Sales Order lineage at read (contradicts SYSTEM_AUTHORITIES.md:88 "never re-derived") | Owner ratifies, lane proposes | S1 |
| D-5 | Adjustments and refunds in the **same wave** | same wave (rec.: outstanding is wrong without them) / defer, only if the census shows 0 of each **and** the writers stay frozen | **Owner** | S1, S7 |
| D-6 | Writes unavailable between FREEZE and the PostgreSQL commands | allow (no UI caller today) / require PostgreSQL write commands before ACTIVATE | **Owner** | S9 |
| D-7 | Provenance for copied `issued_by`/`recorded_by`/`created_by` | from Firestore audit events mapped to an EOS Principal / declared migration actor with the legacy uid kept | Owner ratifies | S6-S7 |
| D-8 | Reporting calendar location | TS constant (today, not Firebase) / column on `tenant_operating_companies` | Lane (one reasonable answer: keep the constant) | none |
| D-9 | Row page bound, plus `rowsComplete` UI copy on the Invoices/Payments pages | 500 default / 2,000 max | Lane, Owner UX review | S10 |
| **M-1** | **Accounting system of record** (DECISIONS #145 §3: "NOT YET SELECTED") | — | **Owner** | not this wave. EOS stays an operational subledger. External reconciliation (FIN-010) stays absent. |
| **M-2** | **Service billing policy (FIN-BLOCK-002)** | — | **Owner** | not this wave. The copy moves only Sales-Order invoices, and there are no service invoices to move. |
| M-3 | Void policy (who may void, and the effect on numbering). No write path exists (`1758931200000:93-103`). | — | Owner | nothing (columns exist) |
| M-4 | FIN-007 approval policy values for adjust/refund | — | Owner | PostgreSQL adjust/refund commands (S9), not the read |
| M-5 | Nonprod Firestore finance volume | unmeasured (#1976 note §4) | Operator census | S6 |

---

## 8. Step table

| # | Step | Owner | Reversible? | Proof | Size |
|---|---|---|---|---|---|
| S0 | Owner rulings D-1, D-2, D-3, D-5, D-6 | Owner | yes | DECISIONS.md entries | S |
| S1 | Migration: `invoice_adjustments`, `refunds`, attribution columns, `invoice_number_counters`, `legacy_*` provenance; 5 visibility capabilities if D-1 = A | Lane | yes while empty (guarded down, `1758931200000` pattern) | local PostgreSQL suites green; pinned-expectation fan-out updated | M |
| S2 | `loadFinancialVisibilityFromPostgres` plus the SQL reach predicate | Lane | yes (dormant) | per-scope tests incl. the BU-per-grant and valueless-grant refusals | M |
| S3 | `facts.list` and `account.ar` SQL repositories | Lane | yes | parity against `financeReadProjection` fixtures; never-blend and partition tests | L |
| S4 | `financeAuthorityState.ts` plus `/finance/` handler in `server.ts` | Lane, Owner review | yes (INACTIVE) | 503-while-INACTIVE; persona reach tests | M |
| S5 | Snapshot export plus `financeCutover.js` census/copy/verify | Lane builds | yes (tooling) | fence tests; fixture round-trip | L |
| S6 | FREEZE (4 callables plus fixture script) → quiescence → export → census | Operator, Owner authorizes | yes until S8 (ROLLBACK_BEFORE_POSTGRES_WRITES) | census evidence file copy-ready | S |
| S7 | COPY ONCE → VERIFY | Operator | yes before S8 (empty target) | verify report zero diffs | S |
| S8 | ACTIVATE_POSTGRES (nonprod) | Owner | **no** (nothing leaves ACTIVE) | state constant merged; smoke reads per persona | S |
| S9 | PostgreSQL write commands (apply/adjust/refund; issue after Commercial C6) | Lane | yes (per command) | command tests; idempotency; PostgreSQL audit | L |
| S10 | Client flip: `financeReadCallableClient.js` → Render; Detail pages use id filters | Lane, Owner UX | yes (revert client) | 16-persona e2e; callable invocations = 0 | M |
| S11 | RETIRE_FIRESTORE plus deletion checklist §6.2 | Owner (destructive items) | **no** | checklist all checked; grep = 0 | M |
