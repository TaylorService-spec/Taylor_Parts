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
| F4 | Service Billing Model | COMPLETE_MERGED | 04126d41 | f1627d63 | #1677 | bda2c5b2 |
| F5 | FIN-006 Cost & Margin | COMPLETE_MERGED | bda2c5b2 | 1cf358b1 | #1678 | 12ee21bc |
| F6 | FIN-003 Plan vs Actual | COMPLETE_MERGED | 12ee21bc | c5c55812 | #1679 | 73ba30cd |
| F7 | FIN-005 Forecasting | COMPLETE_MERGED | 73ba30cd | 85cd4c97 | #1680 | 208c7aea |
| F8 | FIN-007 Adjustments/Approvals | COMPLETE_MERGED | 208c7aea | 96dd3e8d | #1681 | fff6bef6 |
| F9 | FIN-008 Period & Close | COMPLETE_MERGED | fff6bef6 | 921579d4 | #1682 | 5303706d |
| F10 | FIN-009 Allocation & Intercompany | COMPLETE_MERGED | 5303706d | 385e7ca3 | #1683 | 92066be6 |
| F11 | FIN-010 Reconciliation/Traceability | COMPLETE_MERGED | 92066be6 | dcca36b4 | #1684 | 7b4a021f |
| F12 | Financials Product Surfaces | COMPLETE_PR_OPEN (map only — surfaces design-gated) | 7b4a021f | (see PR) | (opened below) | — |
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

### F5 — FIN-006 Cost & Margin
- SCOPE: the ONE margin invariant, encoded so it cannot be quietly violated; the cost-fact
  supply left explicitly undecided.
- IMPLEMENTED: pure derivation core (costMargin.ts, deriveGrossMargin) — COMPUTED only when
  EVERY revenue line has a governed cost fact (integer costMinor + basis + sourceType +
  sourceRecordId); otherwise UNKNOWN with NO margin number (never revenue − 0, never a
  borrowed supplier quote, never a partial margin); malformed facts thrown, orphan facts
  force UNKNOWN, negative margin legitimate; revenue still reported (it is governed).
  Today every real invocation returns UNKNOWN — the truthful current answer.
- NOT DECIDED (deliberate): costing method/basis vocabulary, capture point (receiving vs
  Epic-5 PO layer vs new record), labor cost policy, ND-27 valuation authority —
  FIN-BLOCK-003 (below).
- DOC: docs/financials/FIN-006_COST_MARGIN_MODEL.md · TESTS: pure 10/10; finance CI lane
  registered · CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE · No new DECISIONS number.

### F6 — FIN-003 Plan vs Actual
- SCOPE: versioned plan records + the never-blend comparison — invariant A made mechanical.
- IMPLEMENTED: planVsActual.ts — buildPlanRecord (GOAL≠BUDGET; DRAFT→APPROVED→SUPERSEDED;
  EXPLICIT measurementBasis BOOKED/BILLED/COLLECTED/COST; integer minor units; ISO period;
  scope = FIN-002 dimensions, nullable = unconstrained; frozen) and comparePlanToActual
  (only APPROVED measures; BASIS_MISMATCH/CURRENCY_MISMATCH are thrown category errors —
  compared never blended; out-of-period/out-of-scope facts are NAMED exclusions; variance =
  actual − plan).
- NOT DECIDED (deliberate, no new blocker): approval authority → FIN-007 (F8); storage +
  capability activation → F12/F14; actual-fact wiring is a surface concern.
- DOC: docs/financials/FIN-003_PLAN_VS_ACTUAL_MODEL.md · TESTS: pure 10/10; finance CI lane
  registered · CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE · No new DECISIONS number.

### F7 — FIN-005 Forecasting
- SCOPE: forecast = as-of-stamped expectation, a distinct fact class that is never an actual.
- IMPLEMENTED: forecasting.ts — buildForecastRecord (explicit basis/currency/period/scope +
  REQUIRED asOfMillis + REQUIRED method label; frozen); selectCurrentForecast (newest as-of
  supersedes per target; mixed targets and as-of ties REFUSED — never averaged, never
  array-order); compareForecastToActual (reuses the F6 shared never-blend accumulator —
  extracted as accumulateActualFacts in planVsActual.ts, plan comparison re-based on it,
  F6 suite green unchanged).
- NOT DECIDED (deliberate): forecast methodology/cadence; whether Opportunity pipeline ever
  feeds a derived forecast (expectedValue has no currency — FIN-001); storage/activation →
  F12/F14.
- DOC: docs/financials/FIN-005_FORECAST_MODEL.md · TESTS: pure 7/7 new + F6 10/10 unchanged;
  finance CI lane registered · CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE · No new DECISIONS
  number.

### F8 — FIN-007 Adjustment/Approval/Exception Governance
- SCOPE: the approval machinery, with policy VALUES left to the Owner.
- IMPLEMENTED: financialApprovals.ts — closed approvable-action set (INVOICE_ADJUSTMENT/
  WRITE_OFF/REFUND/PLAN_APPROVAL/ATTRIBUTION_CORRECTION); isApprovalRequired FAIL-CLOSED
  (no policy line ⇒ required; ambiguous policy thrown; thresholds cannot exempt amountless
  actions); buildApprovalRecord (frozen, mandatory reason, SELF-APPROVAL FORBIDDEN
  unconditionally); assertActionApproved (missing/mismatched/REJECTED refuse; approving
  100 is not approving 150; rejection is terminal).
- NOT DECIDED (deliberate): which actions/thresholds, who approves (capability/role),
  escalation/expiry — supplied as policy values + grants at F14 activation; until then all
  composed actions fail closed to required.
- DOC: docs/financials/FIN-007_APPROVAL_GOVERNANCE_MODEL.md · TESTS: pure 8/8; finance CI
  lane registered · CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE · No new DECISIONS number.

### F9 — FIN-008 Period & Close
- SCOPE: the OPERATIONAL reporting close (DECISIONS #145 — NOT an accounting close).
- IMPLEMENTED: financialPeriods.ts — per-company frozen period records (OPEN|CLOSED; a
  close carries who/why/when; REOPEN deliberately unmodeled); assertEventDateOpen refuses
  events dated inside a CLOSED period (closed history is not writable — late facts go
  through FIN-007 + an open-period adjustment); an UNCOVERED date is allowed (closing is
  an explicit act — absence of a period closes nothing); overlapping periods thrown as a
  configuration defect; one company's close never blocks the other company.
- NOT DECIDED (deliberate): cadence/calendar, who closes, late-event policy detail, which
  event date each fact class is judged by — policy values at F14 activation.
- DOC: docs/financials/FIN-008_PERIOD_CLOSE_MODEL.md · TESTS: pure 8/8; finance CI lane
  registered · CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE · No new DECISIONS number.

### F10 — FIN-009 Allocation & Intercompany
- SCOPE: the arithmetic every allocation policy must use + consolidation that cannot lie.
- IMPLEMENTED: financialAllocation.ts — allocateAmountExactly (largest-remainder integer
  allocation; parts sum EXACTLY to the whole; deterministic; credits symmetric) and
  summarizeByCompany (per-company totals; company-less facts refuse; consolidated figure
  TYPED as UNELIMINATED_SUM — no invented elimination, per FIN-001 FIN-GAP-011 + D-3).
- NOT DECIDED (deliberate): intercompany treatment (supplier transactions vs governed
  events), elimination policy, cross-company customer work, the 8 ambiguous ledger records
  — FIN-BLOCK-004 (below).
- DOC: docs/financials/FIN-009_ALLOCATION_INTERCOMPANY_MODEL.md · TESTS: pure 9/9; finance
  CI lane registered · CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE · No new DECISIONS number.

### F11 — FIN-010 Reconciliation / Traceability
- SCOPE: the projection promise made checkable; external reconciliation deferred with cause.
- IMPLEMENTED: financialReconciliation.ts — reconcileInvoiceProjection (recompute
  applied/credits/charges/writeoffs/outstanding/state from durable facts, diff vs stored;
  IN_SYNC or DRIFT with per-field stored/derived values; VOID terminal; foreign/malformed
  facts THROWN — an unreconcilable set never reports sync; nothing auto-fixed) and
  reconcileReceipt (amount = applied + unapplied; applied = Σ application facts;
  over-application drifts).
- DEFERRED WITH CAUSE (not a blocker): EXTERNAL reconciliation — the authority of record
  is not yet selected (DECISIONS #145); a speculative matcher would guess an interface.
  Drift sweeps/surfaces → F12/F14.
- DOC: docs/financials/FIN-010_RECONCILIATION_MODEL.md · TESTS: pure 9/9; finance CI lane
  registered · CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE · No new DECISIONS number.

### F12 — Financials Product Surfaces
- SCOPE: readiness map ONLY. Under the North Star three-authority model (DECISIONS #122)
  visual composition belongs to the DESIGN authority — twenty financial screens may not be
  minted autonomously. No surface was built or altered; every section keeps its honest
  Frame 0 placeholder.
- DELIVERED: docs/financials/F12_SURFACE_READINESS_MAP.md — per-section binding map
  (which merged dormant authority each of the 20 sections composes when its design source
  exists) + the four binding rules (compose cores only; FIN-004 on every read; UNKNOWN
  renders as unknown / UNELIMINATED_SUM carries its caveat; impeccable + taste bar against
  an approved design source).
- BLOCKER: FIN-BLOCK-005 (below) — design sources for financial surfaces.
- CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE · No new DECISIONS number.

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

### FIN-BLOCK-003 — the governed cost-fact supply (FIN-006)
- PHASE: F5; also constrains F12 Gross Margin surface and F13 margin/cost reporting (both
  can only ever show UNKNOWN until ruled).
- EXACT QUESTIONS: (1) costing method + admissible basis vocabulary (receipt/landed vs
  standard vs average vs last; supplier quote ruled non-admissible by FIN-001); (2) the
  capture point for cost EVENTS (receiving carries no price deliberately; Epic-5 PO price
  layer is UNKNOWN_REQUIRES_DECISION; or a new governed record); (3) labor cost policy
  (rates do not exist; hours ≠ cost ratified) — composes FIN-BLOCK-002(2); (4) ND-27
  inventory valuation authority (freight/landed allocation, revaluation, external
  accounting relation per DECISIONS #145).
- WHY CODE CANNOT ANSWER: costing method and valuation basis are accounting-policy
  decisions with cash/tax consequences; any repo-chosen default would silently become the
  company's costing policy.
- CURRENT SAFE BEHAVIOR: deriveGrossMargin returns UNKNOWN for everything — no fabricated
  cost, no margin number without governed facts.
- WHAT REMAINS UNIMPLEMENTED: cost capture, cost storage, any margin surface showing a
  number.

### FIN-BLOCK-004 — intercompany treatment & elimination policy (FIN-009)
- PHASE: F10; constrains F13's Consolidated reporting column (stays UNELIMINATED_SUM) and
  any future cross-company AR/AP or shared-cost surface.
- EXACT QUESTIONS: (1) is Taylor↔Ventana activity modeled as ordinary supplier
  transactions (Owner ruling D-3: Ventana = upstream SUPPLIER, not a peer) or as governed
  intercompany events; (2) the consolidation/elimination policy for double-counting
  prevention; (3) cross-company customer work treatment (FIN-001:
  UNKNOWN_REQUIRES_DECISION); (4) disposition of the 8 cross-company-ambiguous ledger
  records FIN-001 measured.
- WHY CODE CANNOT ANSWER: FIN-001 explicitly prohibits inventing elimination logic; D-3
  already constrains the shape and only the Owner can extend or specialize it.
- CURRENT SAFE BEHAVIOR: consolidated figures are TYPED UNELIMINATED_SUM — arithmetic
  sums that state they removed nothing; per-company totals are exact.
- WHAT REMAINS UNIMPLEMENTED: any intercompany record type, elimination, cross-company
  AR/AP.

### FIN-BLOCK-005 — design sources for financial surfaces (F12)
- PHASE: F12; gates all twenty Financials sections' real UI.
- EXACT QUESTION: approved North Star design sources (Design authority) for the Financials
  page family — none exist; the behavioral authority (this repo) may not invent visual
  composition (DECISIONS #122).
- CURRENT SAFE BEHAVIOR: honest Frame 0 placeholders; the readiness map tells Design and
  the Owner exactly what each screen can truthfully bind to.
- WHAT REMAINS UNIMPLEMENTED: every real financial screen.

