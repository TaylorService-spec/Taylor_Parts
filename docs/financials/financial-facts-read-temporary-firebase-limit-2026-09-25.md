# Financial facts read: temporary Firebase limit, necessity review, and PostgreSQL path (2026-09-25)

**Scope.** This note covers `listFinancialFacts`, the Firestore-backed Financials reporting callable,
as changed by PR #1976 (branch `lane/s4-financial-facts-complete-read`, base `09d63c4e`). The
line references are to `functions/src/finance/financialReportingRead.ts` at the head of that branch,
unless the reference says otherwise.

**Owner constraint.** Firebase is being retired completely. #1976 is a narrow repair to a live
Firebase read, made so that Financials does not show incorrect figures before cutover.
**It is not the finished scale solution.** EOS/PostgreSQL must own finance facts and aggregates.
This note adds no Firebase functionality.

---

## 1. Temporary Firebase limitation

### 1.1 Thresholds (verified in code)

| Bound | Value | Where | Notes |
|---|---|---|---|
| Page size (`MAX_REPORTING_LIMIT`) | 500 | `:89` | This is the page size of one cursor page. It is not the size of the answer. The callable rejects any value above 500 (`:699`), and the core clamps to 500 (`:463`). |
| Default page size | 500 (base: 200) | `:90`; client `field-ops-app-vite/src/hooks/useFinancialFacts.js:21` | At base, both the server default and the client default were 200 (base `:54`, base hook `:14`). |
| `REPORTING_SCAN_CEILING` | 5,000 | `:102` | Counted **per collection, per call**. The callable cannot override it. Only tests can inject a ceiling (`options.scanCeiling`, `:463-467`), and test 53 pins that the callable source never passes one. |
| Ceiling boundary | 5,000 is COMPLETE; 5,001 is PARTIAL | `:386`, `:397` | On the final page the read asks for one row past the ceiling (`take = min(page, ceiling − read + 1)`). If that extra row exists, the read throws `SCAN_CEILING_REACHED`. |
| Receipts by id | ids > 5,000 is refused before any receipt is read | `:418` | The count is the distinct `paymentId`s named by the caller's authorized applications. |
| `APPLICATIONS_BY_INVOICE_MAX` | 900 | `:167` | 900 authorized invoice ids or fewer: applications are read `BY_INVOICE_ID`. More than 900: the read falls back to a tenant-wide `CURSOR_SCAN` of `payment_applications` (`:553-564`). |
| `in` chunk size | 30 | `:168`, `:558` | Chunks share one accumulator, so the 5,000 ceiling bounds the collection total for the call, not each chunk separately (`:380-383`). |
| Transaction | one read-only transaction | `:646` | Firestore expires a transaction after 270 s, or after 60 s idle (header `:37-43`). An expired transaction is reported as `READ_FAILED`. |
| Callable | `onCall({ region: "us-central1" })` | `:686` | No timeout or memory is set, and the repo has no `setGlobalOptions`. The v2 defaults therefore apply: 60 s timeout and 256 MiB memory. The response-size budget cited in the header has **not been measured** at the ceiling. The same is true of time and memory. |
| Round trips at the ceiling | roughly 30 to 60, sequential | derived | 11 invoice pages, plus up to 30 application chunks (or 11 tenant-wide pages), plus up to 10 `getAll` receipt batches. Not measured against live Firestore. |

### 1.2 What is counted before and after FIN-004 visibility

| Collection | Counted against 5,000 | Relation to FIN-004 |
|---|---|---|
| `invoices` | Every document the query returns (`:512-516`) | **Before visibility.** Visibility filters in memory only after the scan (`:520`). The only filter pushed into the query is `accountId` (`:512`). Company, business unit, salesperson and period filters are applied after the read, so they do not reduce the count. |
| `payment_applications`, `BY_INVOICE_ID` | Applications whose `invoiceId` is in the caller's **authorized** invoice set | **After visibility and before the caller's own filters.** The count depends on scope. |
| `payment_applications`, tenant-wide `CURSOR_SCAN` | Every application in the tenant | **Before visibility.** This mode is used only when the authorized invoice set has more than 900 ids. |
| `payments` (`BY_ID`) | Distinct receipt ids named by authorized applications | **After visibility and before the period filter.** A missing id is counted as `danglingIds` and makes the answer `DANGLING_REFERENCE` (`:438`). |

### 1.3 Behaviour at 5,000 compared with 5,001 (per collection)

| Collection | 5,000 | 5,001 |
|---|---|---|
| invoices (unnarrowed, whole tenant) | COMPLETE and `ready`: 10 pages plus a 1-row probe that returns empty | `unavailable`. Completeness is PARTIAL with reason `SCAN_CEILING_REACHED`, and `tenantWide: true`. **No rows, no summary, no aging, no rollups** (`withheld`, `:474`). |
| invoices (`accountId`-narrowed) | COMPLETE | Same PARTIAL result, but for that one account only. |
| payment_applications | COMPLETE | The **whole answer** is PARTIAL. Invoices are not served next to a partial payments view (test 47). |
| payments by id | COMPLETE (5,000 ids) | PARTIAL and refused before any receipt is read (`:418`). |

For every non-COMPLETE answer, each page shows `incompleteReadNote`
(`field-ops-app-vite/src/domain/financialFactsView.js:108`), for example: "This tenant holds more
than 5000 invoices … Nothing is shown". It never shows a figure (`financialFactsState`, `:44-60`).

### 1.4 Who is affected, and which pages

Once the tenant holds more than 5,000 invoice documents, **every page that is not narrowed by
account goes dark for every persona, whatever their scope.** That includes a SELF-scope
salesperson who can see only 12 invoices. The reason is that the invoice ceiling is counted
before visibility is applied (see 1.2).

| Page (caller) | Read issued | Narrowed by the query? | Past 5,000 tenant invoices |
|---|---|---|---|
| Overview (`FinancialsOverview.jsx:54`) | INVOICE, company/unit/period | no | dark |
| Invoices (`FinancialsInvoices.jsx:56`) | INVOICE, company/period | no | dark |
| Accounts Receivable (`FinancialsAccountsReceivable.jsx:42`) | INVOICE, company/period | no | dark |
| Company & BU Performance (`FinancialsCompanyPerformance.jsx:49`) | INVOICE, period | no | dark |
| Employee Performance (`FinancialsEmployeePerformance.jsx:55`) | INVOICE, period | no | dark |
| Payments (`FinancialsPayments.jsx:46`) | RECEIPT + APPLICATION, company/period | no | dark |
| Invoice Detail (`FinancialsInvoiceDetail.jsx:49`) | `{}`: all three families, whole tenant, to find one invoice on the client | no | dark (**reads more than it needs**) |
| Payment Detail (`FinancialsPaymentDetail.jsx:43`) | `{}`: all three families, whole tenant, to find one receipt | no | dark (**reads more than it needs**) |
| Customer Financials (`FinancialsCustomerFinancials.jsx:48`) | `{accountId}`, all three families | **yes** | **still completes**, as long as that account has 5,000 invoices or fewer. If the account has more than 900 visible invoices, the application read falls back to the tenant-wide scan and becomes subject to the tenant's application count. |
| My Dashboard finance tiles (`modules/dashboard/MyDashboard.jsx:479`) | period only, **no `factTypes`**, so all three families | no | dark (**reads more than it needs**: it uses only `byCompany`, `:952-953`) |

### 1.5 Verification

`cd functions && npx tsc -p . && node --test test/financialReportingRead.test.mjs` gives
**61/61 passing**, both before and after this doc change. The tests that prove the boundaries are:

- 45: past the ceiling the answer is PARTIAL, with no rows or figures (`test/...:603`).
- 46: exactly at the ceiling the answer is COMPLETE (`:621`).
- 47: an application ceiling hit makes the whole answer partial (`:627`).
- 51: a SELF principal over 600 invoices sees only its own invoices (`:669`).
- 54: a single account completes even when the tenant has more applications than the ceiling (`:700`).
- 55: in-chunks of 30 or fewer (`:721`).
- 56: a tenant-wide scan above the by-invoice bound (`:731`).
- 58: a dangling receipt (`:755`).
- 59: one read-only transaction (`:774`).

**Limitation of the tests.** They use a fake Firestore with a scaled ceiling (for example 10). They
prove the boundary logic, but not the 5,000 constant against real latency, memory or response size.

---

## 2. Necessity review against the zero-Firebase target

Diff reviewed: `git diff 09d63c4e..HEAD -- functions/src/finance/financialReportingRead.ts field-ops-app-vite/src`.

### 2.1 What base actually did

- Base read invoices once with `limit + 1` (base `:266`). If the result was over the limit, it
  returned `unavailable` (base `:270`).
- It read applications tenant-wide with `limit 501` (base `:299-300`), and payments tenant-wide with
  `limit 501` (base `:330-331`). Either one over 500 also returned `unavailable`.
- Any error also returned `unavailable` (base `:377-379`).
- The client mapped `unavailable` to a generic but truthful sentence: "did not return a complete
  result, so nothing is shown".
- **Base never presented a truncated set as a total.** The two incorrect-output paths it did have
  are these:
  1. **A dangling receipt was silently dropped.** Payments were filtered by `paymentIds.has(d.id)`
     (base `:333`). If an authorized application named a receipt that did not exist, the answer
     was still `ready`, with that receipt missing from the list. The payments view and the
     applications view then disagreed, with nothing to say so.
  2. **There was no shared snapshot.** Invoices, applications and payments were three separate
     non-transactional reads. If a payment was recorded between them, a `ready` answer could pair
     an invoice's pre-payment outstanding balance with the post-payment application. Invoice Detail
     and Payment Detail render both side by side. The window is small, but the answer is internally
     inconsistent and labelled complete.

### 2.2 Classification of each change

| # | Change (head location) | Class | Incorrect base behaviour it prevents |
|---|---|---|---|
| 1 | Completeness contract type plus the `completeness` payload (`:104-161`, `:474-490`, `:624`) | ACCURACY (reporting) | None directly. Base already withheld figures when it was not complete. This makes the withholding explicit and machine-readable. |
| 2 | No rows or figures unless COMPLETE (`withheld`, `:474`) | ACCURACY, **already true at base** | None. Base returned `empty`. Kept as the invariant. |
| 3 | Dangling-receipt detection (`readByIds` `:409-441`, reason `DANGLING_REFERENCE`) | **ACCURACY** | Base defect 1: a `ready` answer with a referenced receipt silently missing. |
| 4 | One read-only transaction (`:646`; header `:31-43`) | **ACCURACY** | Base defect 2: an internally inconsistent `ready` answer across three reads. |
| 5 | Named reasons and counts on pages (`financialFactsView.js:44-60`, `:83-140`; every page now passes `detail`) | ACCURACY (clarity) | None incorrect. The base sentence was truthful but generic. This distinguishes "too many" from "index missing" from "failed". |
| 6 | Client: a `ready` response next to a non-COMPLETE contract is treated as incomplete (`financialFactsView.js:60`) | NEUTRAL (defence in depth) | None at base. |
| 7 | `INDEX_MISSING` vs `READ_FAILED` split (`:351-356`, `:393`, `:426`) | ACCURACY (clarity) | None incorrect. Base reported both as `unavailable`. |
| 8 | `NO_REACH` reason (`:502`) | NEUTRAL | Base already returned `unavailable`, and the callable denies first (`:691-693`). |
| 9 | Cursor paging to exhaustion, with the 5,000 ceiling (`scanToExhaustion` `:372-402`, `:102`) | **AVAILABILITY-EXTENSION** | None. Base returned `unavailable` above 200 or 500. |
| 10 | Default page size from 200 to 500, server and client (`:90`; hook `:21`) | **AVAILABILITY-EXTENSION** | None. |
| 11 | Applications `BY_INVOICE_ID` in 30-id chunks, with the 900 bound (`:167-168`, `:553-564`) | **AVAILABILITY-EXTENSION** | None. Base returned `unavailable` above 500 applications tenant-wide. |
| 12 | Receipts `BY_ID` via `getAll` (`:597`) | **AVAILABILITY-EXTENSION**, and it carries #3 | None by itself. Dangling detection could also be done over base's bounded tenant-wide payments read. |
| 13 | `tenantWide` / `mode` / `pages` scan metadata (`:135-150`) | NEUTRAL (serves #5) | None. |
| 14 | Header docs, and this note's comment edits | NEUTRAL/CLEANUP | None. |

### 2.3 Recommendation (Owner decides; neither variant is implemented here)

**(A) Minimal accuracy-only.** Keep base's single bounded query for each collection and base's
limits. Add only #3 (dangling detection, done over the bounded payments read), #4 (read-only
transaction around the three bounded reads), and #1/#2/#5/#7 (contract and named reasons).
This is much smaller: no cursor paging, no `in` chunks, no `getAll`.

**(B) #1976 as it stands.** Everything in (A), plus #9 to #12, which extend Firebase
availability from 200/500 up to 5,000 per collection.

**Which fits the constraint.** **(A)** fits the Owner's rule that a narrow Firebase repair should
prevent incorrect behaviour, not add capability. #9 to #12 are roughly 150 lines of Firestore
paging machinery. Their only effect is to make a retiring store answer in more cases, and all of
it is deleted at cutover.

**The tradeoff, stated plainly.**

- **Under (A)**, with base limits and the 200-row client default, pages show "unavailable" in these cases:
  - When the tenant holds **more than 200 invoice documents**. This counts every invoice, before
    visibility, whatever the persona's scope. Affected: Overview, Invoices, AR, Company and
    Employee Performance, Payments, Invoice Detail, Payment Detail and the My Dashboard tiles.
  - Customer Financials only when the selected account has more than 200 invoices.
  - When the tenant holds **more than 500 payment applications** or **more than 500 receipts**,
    every page that requests payment families goes dark: Payments, both Detail pages, Customer
    Financials and My Dashboard.
  - A sub-option (A′) is to have the client send the existing server maximum page of 500. That is a
    one-constant change with no new mechanism, and it moves the invoice threshold to more than 500.
    Strictly, it is still an availability extension.
- **Under (B)**, the same pages stay live up to 5,000 per collection, as described in section 1.
- **Cost of choosing (A) now.** Rework on an already-reviewed branch: 61 tests exist, and roughly a
  third of them exercise #9 to #12.
- **Cost of choosing (B).** Firebase-only machinery to maintain until retirement, with no path to
  reuse.
- **Sandbox impact of (A) is unmeasured.** No count of the current nonprod Firestore `invoices`,
  `payment_applications` or `payments` documents exists in the repo (section 4). If each is below
  200/500, (A) loses nothing today.

---

## 3. Bounded path to authoritative server-side finance aggregates on EOS/PostgreSQL

This is a path, not a cutover. Nothing below is authorized by this note.

### 3.1 What already exists

- **Invoice authority schema:** `functions/migrations/1758931200000_invoice-authority.sql`. It
  establishes `eos_finance`, with `invoices` (`operating_company_key`, `account_id`,
  `sales_order_id`, `currency`, `due_date`, void fields), `invoice_lines` (with a FIN-002
  `business_unit_id`), and the `invoice_totals` view.
- **Cash application schema:** `functions/migrations/1759017600000_ar-cash-application-authority.sql`.
  It adds `payments`, append-only `payment_applications`, and plain (not materialized) views
  `payment_balances` (`:426`) and `invoice_application_totals` (`:449`).
- **Repositories:** `functions/src/eosOps/invoiceAuthority.ts`,
  `functions/src/eosOps/cashApplicationAuthority.ts`, `functions/src/eosOps/invoiceTotals.ts`.
- **Current state:** `eos_finance` has **0 rows**
  (`docs/testing/persona-object-workflow-access-matrix.md:147`, `:585`). There is **no Render
  route**: `functions/src/eosApi/server.ts:41-44` routes only crm, commercial, operations,
  workforce and administration.

### 3.2 What is missing

1. **A Render finance read transport.** This would be a sixth domain handler in `eosApi/server.ts`.
2. **A PostgreSQL aggregate read** that applies FIN-004 reach **server-side, as SQL predicates**
   (company, business unit, credited salesperson/SELF). It would return per-currency summaries,
   aging and rollups, following the same completeness contract. **`finance.visibility.*` is not
   registered in PostgreSQL**: 0 hits in `functions/migrations`. The only authority is the Firebase
   loader in `functions/src/finance/financialVisibility.ts`. It needs its own PostgreSQL model, and
   that model is gated by the Owner. PG `invoices` has **no credited-salesperson column** (see the
   migration's own note, `:58-61`). SELF reach would therefore resolve through the Sales Order
   lineage, or through the frozen attribution snapshot. That choice is part of the model decision.
3. **Missing tables.** There are no PostgreSQL tables for adjustments, refunds or acquisition cost.
   The Firestore commands for them live in `functions/src/finance/{adjustment,refund}Commands.ts`
   and `acquisitionCost.ts`. The cash migration names the reversal gap explicitly (`:138-143`).
4. **Missing copy tooling.** There is no Firestore-to-PostgreSQL finance copy tooling. A grep shows
   no finance copier. `crmCutoverSnapshot.ts` only references the collections.

### 3.3 Step sequence

| # | Step | Decision owner | Reversible? | What proves it |
|---|---|---|---|---|
| 1 | **Census.** Read-only counts of the Firestore finance collections per tenant, the dangling and orphan rate, and a list of every consumer of `invoices` / `payments` / `payment_applications` / `refunds` / `adjustments`. | Lane (read-only) | yes (no writes) | A committed census doc with counts and a grep plus runtime consumer list |
| 2 | **PostgreSQL visibility model** for `finance.visibility.*`: scope kinds, the SELF attribution join path, capability and grant rows. | **Owner** | yes until activation (a migration down path) | Owner ruling recorded, and the migration applied to local PG with the pinned-expectation fan-out updated |
| 3 | **Aggregate read plus tests on local PG.** A repository function returning the same `FinancialFactsResult` shape, with reach as `WHERE` predicates and a parity test against `financeReadProjection.ts` fixtures. | Lane | yes (dormant code) | PG suite green on `POLICY_TEST_DATABASE_URL`, and parity fixtures equal |
| 4 | **Render transport behind a fail-closed finance read state**, modelled on `functions/src/crm/crmWriterState.ts` and `functions/src/catalogMaster/catalogWriterState.ts`. Every operation refuses until the state is ACTIVE. | Lane, with Owner review | yes (state stays DORMANT) | Transport tests: refused while DORMANT, and correct reach while ACTIVE on local PG |
| 5 | **Copy-once tooling** (Firestore to `eos_finance`, no dual write), with a dry run and a VERIFY mode. | Lane builds; **operator** runs | yes before activation (truncate the empty target) | A dry-run report, then an apply report with counts equal to the census |
| 6 | **Verify.** Row counts, per-currency totals, and per-account outstanding balance compared between the two stores. | Operator | yes | A VERIFY report with zero diffs |
| 7 | **Activate** the finance read state in nonprod. | **Owner** | yes (flip back to DORMANT) | The state row is ACTIVE, and a smoke read per persona matches the census |
| 8 | **Client flip.** `useFinancialFacts` calls Render for all pages listed in 3.4. | Lane, with Owner approval | yes (revert the client) | Per-page e2e for the 16 canonical personas, and the Firebase callable call count at 0 |
| 9 | **Retire the Firebase callable**, after the delete condition below holds. | **Owner** | no, in practice (code deleted; recoverable only from git) | The checklist in 3.4 is all checked |

### 3.4 Delete condition for the Firebase `listFinancialFacts` reader (checklist)

- [ ] The PostgreSQL aggregate read is **active and verified** for every page that uses
      `listFinancialFacts` today:
  - Overview
  - Invoices
  - Accounts Receivable
  - Company & Business Unit Performance
  - Employee Performance
  - Payments
  - Customer Financials
  - Invoice Detail
  - Payment Detail
  - the My Dashboard finance tiles (`firmBilled` / `firmCollected`)

  That is 9 Financials pages plus the dashboard. An earlier count of "8 pages" missed Invoices.
- [ ] `field-ops-app-vite/src/hooks/useFinancialFacts.js` is flipped to the Render transport.
      No client path still calls `fetchFinancialFacts` → `listFinancialFacts`.
- [ ] **Zero callers**, confirmed by both checks:
  - A static grep for `listFinancialFacts` in `field-ops-app-vite/src`, excluding tests, returns nothing.
  - A **runtime call census** of Cloud Functions invocation logs for `listFinancialFacts` shows 0
    calls over an agreed window.
- [ ] The export `export { listFinancialFacts } from "./finance/financialReportingRead";` is removed
      from `functions/src/index.ts:110`, and the file and its tests are deleted.
- [ ] The Firestore finance collections have **no other reader**. `listAccountInvoiceAr`, the
      `performanceMetricRegistry.ts` finance metrics, and any census scripts are migrated or retired
      first, so that retiring this reader leaves no Firestore finance read behind.

---

## 4. Interim guidance: what the 5,000 limit means for the sandbox today

- **Current nonprod Firestore finance volume is unmeasured.** The repo has no count of
  `invoices`, `payment_applications` or `payments` documents in nonprod Firestore. (The PostgreSQL
  side, `eos_finance`, is 0 rows, but that is not the store this callable reads.)
- If the volume is below 5,000 per collection, the only effects under #1976 as it stands are the
  intended ones: complete answers, one snapshot, and dangling receipts refused. No page goes dark
  because of size.
- If a dangling receipt exists in sandbox data, the Payments page, both Detail pages, Customer
  Financials and My Dashboard will show `DANGLING_REFERENCE` instead of figures. That is the correct
  outcome. The fix is in the data, not in the reader.
- **Do not raise the ceiling or add Firebase paging modes to extend it.** Growth past these bounds
  is the trigger for the PostgreSQL path in section 3, not for more Firebase work.
