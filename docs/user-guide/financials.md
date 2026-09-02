# Financials — user guide

The **Financials** section in the left navigation is the operational financial subledger for
Taylor and Ventana. It is not the general ledger: no external accounting system is connected
yet, and every page says so where it matters.

Who sees it: administrators and dispatchers. Seeing a page never by itself grants access to
financial numbers — every figure is authorized on the server when it is read, so two people
on the same page can legitimately see different data (or an explicit "not available to you").

## What the pages show today

Financial record-keeping (invoices, payments, corrections) is built but **not switched on**
in any environment yet. Until it is activated, the Financials pages show their full layout
with plain statements in place of numbers. This is deliberate: a missing number is stated in
words — you will never see a `0` that secretly means "we couldn't read it."

Sentences you will meet and what they mean:

- **"Read not activated"** — the record-keeping behind this figure exists but hasn't been
  turned on. Nothing is wrong.
- **"No governed read surface exists…"** — this kind of record can't be listed by the app
  yet at all.
- **"Not available to you."** — the server declined your access. That is a permissions fact;
  ask an administrator if you believe you need it.
- **"FUTURE AUTHORITY"** — a workflow shown for completeness that is not implemented (for
  example, unapplied payment cash). It will not accept input.
- **"Method TBD"** — a forecast exists in design but no forecasting method has been chosen.

## The five working pages (first wave)

- **Overview** (`Financials → Overview`) — the management scorecard: Booked, Billable now,
  Billed, Collected, A/R outstanding, and Unbilled (the one derived figure, always labelled
  "booked − billed"). Each figure links to the page that owns it.
- **Invoices** — the invoice list. There is intentionally **no "New Invoice" button**:
  invoices are issued from the Billing Queue, and an issued invoice is permanent history —
  corrections happen in Credits & Adjustments.
- **Accounts Receivable** — money invoiced but not yet collected, aged from each invoice's
  due date into Current / 1–30 / 31–60 / 61+ days.
- **Payments** — payments received and how they were applied to invoices. The "Unapplied"
  view is part of the design but the unapplied-cash workflow is future.
- **Customer Financials** — pick a customer to see their financial picture in one place.
  Nothing loads until you choose a customer; the customer's identity links back to their
  Account record.

Filters (Company, Business unit, Period) appear in the same order with the same wording on
every Financials page. The little ⓘ markers explain the rules behind a figure — hover or
focus them.

The remaining pages (Forecasting, Budgets, Reconciliation, …) still show an honest
"not built yet" placeholder and will fill in wave by wave.

## Second wave: billing and corrections

- **Billing Queue** — what can be invoiced and what is blocked, with the blocking reason on
  the row. The "Create invoices" button is visible but disabled until invoice issuance is
  switched on; a note under it says exactly why.
- **Credits & Adjustments** — the correction workspace. Its rule is printed on the page:
  corrections create new governed events; the original event remains history. "New
  correction" stays disabled until correction commands and an approval policy are activated.
  Declined corrections are always shown, never hidden.

## Third wave: plans and forecasts

- **Sales to Goal** — performance against goals, with each goal's measurement basis
  (Booked, Billed, Collected, Revenue, Gross margin) shown beside it. Different bases are
  never added together, so there is no grand total — that's deliberate.
- **Cost to Budget** — budgets beside cost columns that stay empty-with-words until the
  business decides how costs are captured. You will never see a $0 that means "unknown."
- **Forecasting** — forecasts stay separate from actuals, goals and budgets. Each future
  forecast will carry a version and as-of date; the method reads "Method TBD" until a
  forecasting method is chosen.
- **Budget Management / Goal Management** — versioned plans. A revision creates a new
  version; history is never rewritten. "New budget" / "New goal" stay disabled until plan
  record-keeping and an approval policy are switched on.

## Fourth wave: performance

- **Gross Margin & Profitability** — until the business decides how costs are captured,
  the page says plainly that margin cannot be reported yet. Margin is never guessed from
  sell prices. Net profit, overhead and tax will never appear here — they belong to a
  future accounting system.
- **Company & Business Unit Performance** — Taylor vs Ventana side by side. "Consolidated"
  is a plain arithmetic sum across the two companies, clearly labelled as such — it is not
  an accounting consolidation.
- **Salesperson & Employee Performance** — what you see here follows your granted
  visibility scope. Anything outside your scope is named as withheld — you'll never see a
  misleading zero where a number was hidden.

## Fifth wave: governance and integrity

- **Reconciliation & Exceptions** — two clearly separated halves: EOS's own internal
  integrity check (records classified IN_SYNC or DRIFT once activated) and reconciliation
  against an external accounting system, which is a future integration — no provider has
  been chosen, so it reports "no counts", never zero.
- **Intercompany** — Taylor↔Ventana activity gets classified, never merged away.
  Unclassified items are flagged loudly and left out of company splits.
- **Financial Audit & History** — a financials view over the one audit trail. Read-only.
- **Reporting & Exports** — the report catalog lists every planned report group and says
  exactly what each is waiting on. Exports will re-check your access when they run.
- **Financial Settings & Governance** — the status board: each governance area carries a
  chip (Configured / Not configured / Built dormant / Future integration) so you can see at
  a glance what exists, what's switched off, and what's waiting on a business decision.

All twenty Financials pages are now real compositions — none are placeholders.

## Where the numbers come from

Five pages now show real, governed figures — Invoices, Accounts Receivable, Payments,
Company & Business Unit Performance, and Salesperson & Employee Performance — alongside
Customer Financials, which already did.

A few things worth knowing about what you see there:

- **Your filters ask; the server decides.** The company chip and the view tabs narrow what
  comes back. They cannot widen it. If you pick a company or a person outside your granted
  visibility, you get an empty result, not their numbers — and not an error, because asking
  is allowed.
- **Every amount was calculated by the server.** The pages format money; they never add it
  up. That is why a few slots still say what they are missing instead of showing a figure:
  the A/R aging buckets, the "Booked" row on Company Performance, and the Consolidated
  column all need totals this app deliberately will not compute for itself. A number
  assembled from one page of records would look like a statement about your whole book.
- **"Not attributed" is not zero.** Some invoices were issued before the system began
  recording which salesperson gets credit. Those invoices are real and you can see them,
  but they cannot be placed against a person. Salesperson & Employee Performance counts
  them in a note beneath the table rather than showing anyone a zero for work the record
  cannot attribute to them.
- **Nothing shown is truncated.** If a result would be incomplete, the page says the read
  was unavailable rather than showing you a partial total. An incomplete financial figure
  is worse than none.
