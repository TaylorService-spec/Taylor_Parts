# Financials Implementation Run Ledger

The execution record of the post-FIN-002 autonomous implementation run (started 2026-09-01).
One row per phase; a phase is COMPLETE_MERGED only when its content is reachable from current
origin/main. Boundary preserved throughout: EOS = governed operational financial subledger
(DECISIONS #145); FIN-002 attribution + required-company gates (DECISIONS #154) are merged
authority and are composed, never re-decided.

Run start: origin/main = `cfe9c8fb` (FIN-002 merge `d2085c01` verified reachable).

| Phase | Workstream | Status | Base main | Head | PR | Merge |
|---|---|---|---|---|---|---|
| F2 | FIN-004 Financial Visibility | COMPLETE_MERGED | cfe9c8fb | c7742232 | #1675 | 4b75fa45 |
| F3 | Finance Core Activation Readiness | COMPLETE_MERGED | 5a70fa6c | 45392f24 | #1676 | 04126d41 |
| F4 | Service Billing Model | COMPLETE_PR_OPEN | 04126d41 | (see PR) | (opened below) | — |
| F5 | FIN-006 Cost & Margin | NOT_STARTED | — | — | — | — |
| F6 | FIN-003 Plan vs Actual | NOT_STARTED | — | — | — | — |
| F7 | FIN-005 Forecasting | NOT_STARTED | — | — | — | — |
| F8 | FIN-007 Adjustments/Approvals | NOT_STARTED | — | — | — | — |
| F9 | FIN-008 Period & Close | NOT_STARTED | — | — | — | — |
| F10 | FIN-009 Allocation & Intercompany | NOT_STARTED | — | — | — | — |
| F11 | FIN-010 Reconciliation/Traceability | NOT_STARTED | — | — | — | — |
| F12 | Financials Product Surfaces | NOT_STARTED | — | — | — | — |
| F13 | Reporting Matrix | NOT_STARTED | — | — | — | — |
| F14 | Sandbox Activation Readiness | NOT_STARTED | — | — | — | — |
| F15 | E2E Financial Certification Readiness | NOT_STARTED | — | — | — | — |

Details per phase are appended below as each phase closes.

## Phase details

### F2 — FIN-004 Financial Visibility
- AUTHORITY CHANGED: financial visibility (new scope authority + 5 capability ids, all
  `active:false`); `finance.read` redefined to fact-family-gate semantics (safe: dormant)
- FILES: financialVisibility.ts (new), financeReadCallables.ts (loader + scoped read),
  permissionCatalog.ts ×2 mirrors (+5 ids), finance CI lane + emulator script, 2 new test
  suites, FIN-004 doc, DECISIONS #156, SYSTEM_AUTHORITIES row
- TESTS: pure 12/12; emulator scoped-read 9/9; finance read legacy suite updated (explicit
  CONSOLIDATED authority); catalog/resolver suites green
- CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE
- DEFECT FIXED IN PASSING: duplicate DECISIONS number on main — the later collider
  (R-34/2C-closed, merged numbering from a stale tail) renumbered #154→#155 with an inline
  note; FIN-002 keeps #154 (10+ code references); the one R-34 cross-reference updated
- BLOCKER: FIN-BLOCK-001 (below)
- NEXT DEPENDENCY: F3 finance-core readiness composes the visibility loader

### F3 — Finance Core Activation Readiness
- SCOPE: close the FIN-002 correctness gaps in the dormant money-event cores BEFORE any owner
  activation: payment receipt/application, adjustment (credit/charge/write-off), and refund
  records previously (a) took `companyId`/`accountId` from the CALLER and (b) carried no
  canonical attribution snapshot.
- CORRECTION (composes DECISIONS #154, no new decision minted): the issued INVOICE is the
  governed authority for every attribution fact of money moving against it. New shared
  helpers in `financialAttribution.ts` — `requireInvoiceParty` (invoice-derived company +
  customer; caller ids assertion-only ⇒ COMPANY_MISMATCH/ACCOUNT_MISMATCH; missing invoice
  facts fail closed ⇒ COMPANY_REQUIRED/ACCOUNT_REQUIRED) and `buildInvoiceEventAttribution`
  (one canonical snapshot per event: sourceType INVOICE, the invoice's frozen sales credit,
  server record time — mirroring how the invoice's own snapshot names its Sales Order).
  All five downstream records (receipt, application, adjustment, refund ×1 each; receipt +
  application share ONE snapshot) now stamp it.
- API COMPAT: `companyId`/`accountId` inputs became OPTIONAL assertions — a loosening; the
  callables are pass-throughs and needed no change. All capabilities remain `active:false`;
  activation is untouched and stays Owner-gated (F14 packages it).
- TESTS: pure suites extended (assertion-only + snapshot equality + fail-closed);
  80/80 across the finance pure set locally; callable deny-gate suites unaffected.
- CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE

### F4 — Service Billing Model
- SCOPE: the governed answer to "which commitments have billable work not yet billed?" —
  and an explicit ruling on what CANNOT be answered yet.
- IMPLEMENTED: pure Billing Queue projection (billingQueue.ts, deriveBillingQueueEntry) —
  composes the fulfillment eligibility seam + the issueInvoice-maintained billedQty
  projection; unbilled-eligible mirrors issuance's billableQty cap formula exactly; closed
  status set NOT_READY/READY_TO_BILL/PARTIALLY_READY/HELD/CANCELLED/FULLY_BILLED;
  over-billed lines surface reconciliation reasons; missing company surfaced (visibility
  never suppressed, billing refused); NO amounts/prices anywhere (test-asserted).
- NOT BUILT (deliberate): the service-work→billable bridge — FIN-BLOCK-002 (below).
  Service work cannot enter the queue at all until the Owner rules; fail-closed by absence.
- DOC: docs/financials/SERVICE_BILLING_MODEL.md · TESTS: pure 11/11; finance CI lane
  registered · CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE · No new DECISIONS number
  (composes #145/#154; the undecided parts are recorded as a blocker, not decided).

## Blockers (running list)

### FIN-BLOCK-001 — principal-to-company/business-unit scope binding
- PHASE: F2 (FIN-004); also constrains F12 company/BU surfaces and F13 company/BU reports for
  non-consolidated principals
- EXACT QUESTION: by what governed mechanism is a principal BOUND to an operatingCompanyId or
  businessUnitId value for financial visibility — (a) a new ScopeType (4 synchronized access-core
  edit points incl. trustedWriterCommands), (b) the defined-but-unused "domain" ScopeType,
  or (c) a governed Employee fact?
- WHY CODE CANNOT ANSWER: this is the Owner's live access-scope workstream (R-29/R-32/R-33
  lineage); minting the mechanism unilaterally would be inventing access authority.
- CURRENT SAFE BEHAVIOR: held COMPANY/BU visibility grants resolve to BLOCKED — no reach, with
  the reason carried on the authority; predicates fully implemented and tested.
- WHAT REMAINS UNIMPLEMENTED: honoring company/BU scope grants at runtime.
- RECOMMENDED OPTIONS: (b) is cheapest if "domain" was reserved for business-domain partitions;
  (a) is cleanest long-term ("company" ScopeType beside "location"); (c) couples visibility to
  employee master data. One ruling unblocks a ~30-line loader change.

### FIN-BLOCK-002 — the service-work→billable bridge (FIN-GAP-014)
- PHASE: F4 (Service Billing Model); also constrains F5 cost/margin for service work, F12
  Billing Queue surface completeness, F13 service-revenue reporting.
- EXACT QUESTIONS: (1) what makes service work billable (agreement-covered / T&M / warranty /
  no-charge-goodwill) and where that classification is recorded; (2) the price source for
  service labor + WO-consumed parts (no labor rates exist; hours ≠ billable by ratified
  design); (3) does service billing flow THROUGH a Sales Order or a new governed
  billable-work record; (4) who approves billable classification (FIN-007 tie-in).
- WHY CODE CANNOT ANSWER: this is business pricing/billing policy — inferring it from WO
  status or labor hours would violate invariant D (explicit attribution, never inferred).
- CURRENT SAFE BEHAVIOR: service work cannot enter the Billing Queue at all — fail-closed
  by absence; the SO-anchored queue is complete for Sales-Order-committed work.
- WHAT REMAINS UNIMPLEMENTED: any WO/service input into billing.

