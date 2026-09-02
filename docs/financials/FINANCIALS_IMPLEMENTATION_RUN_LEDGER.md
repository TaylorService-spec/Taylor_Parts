# Financials Implementation Run Ledger

The execution record of the post-FIN-002 autonomous implementation run (started 2026-09-01).
One row per phase; a phase is COMPLETE_MERGED only when its content is reachable from current
origin/main. Boundary preserved throughout: EOS = governed operational financial subledger
(DECISIONS #145); FIN-002 attribution + required-company gates (DECISIONS #154) are merged
authority and are composed, never re-decided.

Run start: origin/main = `cfe9c8fb` (FIN-002 merge `d2085c01` verified reachable).
Run end: 2026-09-01, origin/main = `8fd76a62` — ALL PHASES F2–F15 COMPLETE_MERGED (14 PRs #1675–#1688, every one exact-head squash-merged with all matching CI lanes green and trigger coverage CLEAN). The last 14 commits on main are exactly this run — no foreign commits intervened. Open blockers: FIN-BLOCK-001..005 (Owner decisions). Nothing deployed, activated, granted, or written outside the repository.

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
| F12 | Financials Product Surfaces | COMPLETE_MERGED (map only — surfaces design-gated) | 7b4a021f | 80c051b4 | #1685 | b742d56b |
| F13 | Reporting Matrix | COMPLETE_MERGED | b742d56b | c95d3a0d | #1686 | 4dc9fd82 |
| F14 | Sandbox Activation Readiness | COMPLETE_MERGED (package only — zero execution) | 4dc9fd82 | be802ba5 | #1687 | 610d5b3c |
| F15 | E2E Financial Certification Readiness | COMPLETE_MERGED (scenario definition only) | 610d5b3c | d5a0c635 | #1688 | 8fd76a62 |

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

### F13 — Reporting Matrix
- DELIVERED: docs/financials/F13_REPORTING_MATRIX.md — the five approved axes (Company/BU/
  Person/Period/Basis) mapped to merged governed authority, with honest statuses: Cost and
  Gross margin STRUCTURALLY UNKNOWN (FIN-BLOCK-003); Reconciled accounting fact ABSENT BY
  DECISION (#145); Consolidated = UNELIMINATED_SUM (FIN-BLOCK-004); service billable
  absent (FIN-BLOCK-002); plus the four rendering rules (one labeled basis per figure —
  cross-basis via the comparison cores only; UNKNOWN renders as unknown; invariant E on
  every export; reports compose cores/trusted reads, never raw collections).
- CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE · No new DECISIONS number.

### F14 — Sandbox Activation Readiness (package only)
- DELIVERED: docs/financials/F14_SANDBOX_ACTIVATION_READINESS.md — READY_FOR_OWNER_DEPLOY:
  staged capability activation order (read spine → company/BU reach [needs FIN-BLOCK-001]
  → money-in → corrections → issuance), the Owner policy values everything fails closed
  without (FIN-007 thresholds/approvers, FIN-008 cadence/closer, FIN-004 grants), exact
  deploy steps (small named function batches; no Rules change needed; index-deploy hazard
  flagged; environment-truth verification), and the explicit out-of-scope list (production,
  backfill, genesis, cert writes, external accounting).
- EXECUTION: NONE — no deploy, no activation, no grant, no data write occurred.
- CERT_WORLD_IMPACT: NONE · No new DECISIONS number.

### F15 — E2E Financial Certification Readiness (scenario definition only)
- DELIVERED: docs/financials/F15_E2E_CERTIFICATION_READINESS.md — seven scenarios (S1
  attribution end-to-end · S2 visibility scopes incl. held-COMPANY safe behavior · S3 AR
  integrity + deliberate-drift detection · S4 approval governance · S5 per-company period
  close · S6 plans/forecasts never-blend · S7 honest unknowns), each EXPECTED/RECORDED/
  OBSERVED per the v1.7 correction discipline; preconditions = F14 stages A–D + policy
  values. Blockers 001–005 do NOT block certification — S2/S7 certify their safe behavior.
- EXECUTION: NONE — no cert-world write, no genesis, no run.
- CERT_WORLD_IMPACT: NONE · No new DECISIONS number.

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


## POST-OVERNIGHT CONTINUATION (2026-09-01)

Owner-directed continuation from main `9d6c1348`. Append-only; the overnight history above is
final.

### FIN-BLOCK-001 — CLOSED (DECISIONS #157)
- MECHANISM: two new governed access ScopeTypes `operatingCompany` / `businessUnit` on
  RoleAssignments (Owner-directed; explicit scopes, NOT employee master data, NOT Customer
  owner, NOT warehouse projections, NOT the generic "domain" scope).
- SYNCHRONIZED EDIT POINTS: types/access.ts (both mirrors), resolveEffectivePermission
  (scopeMatches value-match + narrowness order + shape validator; synced via
  scripts/syncAccessContracts.mjs), trustedWriterCommands (SCOPE_TYPES + governed-value grant
  validation — free text refused), auditEventWriter SCOPE_TYPES.
- LOADER: loadFinancialVisibilityAuthority now resolves COMPANY/BU reach per governed value
  (2 companies × 4 units) through the ONE canonical resolver from a single principal-state
  snapshot (the R-32/#1672 loaded-authority pattern); global-target semantics for the other
  ids unchanged; a held capability with no scoped binding is surfaced BLOCKED and confers
  nothing.
- UNCHANGED: GLOBAL/LOCATION semantics; existing assignments; no automatic grants; no
  migration; all finance capabilities stay active:false and in NO activation registry.
- TESTS: financialScopeBinding.test.mjs 15/15 pure (company/BU reach, cross-refusals,
  never-widens, legacy semantics, R-32 binding-policy composition, dormant active:false
  reality); trustedWriterCommands +3 grant-validation checks (CI lane);
  financeVisibilityRead 10/10 on isolated emulator incl. the bound-but-dormant deny;
  financeReadCallables 5/5 regression; access pure suites 52/52.

### FIN-BLOCK-005 — RECLASSIFIED (Owner): DESIGN AUTHORITY HANDOFF IN PROGRESS
- No longer an Owner-decision blocker; blocks final 20-page UI composition only.
- Expected corrected master package
  docs/north-star/financials/FINANCIALS-NORTH-STAR-P1-DESIGN-REVIEW-PACKAGE.md: ABSENT on
  current main and on every remote branch (checked this run). UI implementation gate remains
  CLOSED; no UI invented.

### Activation package (F14) — UPDATED
- Stage B prerequisite replaced with the #157 governed mechanism; persona grant-example table
  added (mechanism governed; carrying roles marked TBD — no repository role carries
  finance.visibility.* and choosing one is an Owner act); activation-registry step made
  explicit (finance.visibility.* are in NO registry — sandbox activation needs the
  Owner-authorized registry PR + deploy).

### Emulator dry-run (repository/emulator only, nothing persisted beyond test fixtures)
- inactive capability ⇒ DENY (loader + resolver) · active(simulated) + no binding ⇒ DENY ·
  active + taylor binding ⇒ taylor only, ventana refused · BU binding ⇒ that unit only,
  cross-BU refused · company binding ⇏ consolidated · consolidated ⇒ via express grant only ·
  caller-supplied ids expand nothing · mixed-BU invoice hidden under BU scope · admin reach
  only through the same resolver. ALL PASS (financialScopeBinding + financeVisibilityRead).

### Decision packages for FIN-BLOCK-002/003/004 — PREPARED (assessment only, no policy coded)
- FIN-BLOCK-002_SERVICE_BILLING_DECISION_PACKAGE.md — 12 questions answered from repo
  evidence; headline findings: NO agreement linkage exists on Work Orders, NO payor concept,
  NO labor rates of any kind, deriveWorkOrderBusinessUnit is exported-but-unwired; the SO
  route needs no new pricing authority; 8 exact Owner choices listed.
- FIN-BLOCK-003_COST_AUTHORITY_DECISION_PACKAGE.md — 14 sources classified; exactly ONE
  candidate capture path exists (the dead Epic-5 purchase_orders price layer; the live
  reorder PO collection carries no money field); per-domain recommendations (receipt cost
  for parts, specific identification for serialized equipment) evaluated but NOT adopted;
  freezing-event doctrine stated; 5 Owner choices in dependency order.
- FIN-BLOCK-004_INTERCOMPANY_DECISION_PACKAGE.md — every Taylor↔Ventana flow classified;
  NO flow qualifies as a true intercompany event candidate; recommendation: NO generic
  intercompany ledger yet (supplier transactions per D-3 + explicit attribution cover
  current operations); consolidated stays UNELIMINATED_SUM; found + recorded a stale D-3
  citation (BusinessEntityModel.md:1236-1244 does not exist — the live ruling is in the
  Ventana lifecycle responsibility model).

### FIN-BLOCK-005 — UPDATE (Owner, 2026-09-01): DESIGN DIRECTION APPROVED; UX IN A SEPARATE STREAM
- The corrected Financials North Star P1 Design package was delivered OUTSIDE the repo and
  reviewed: DESIGN DIRECTION APPROVED · AUTHORITY CORRECTION PASS 1: PASS · REDESIGN
  REQUIRED: NO · DESIGN AUTHORITY: AVAILABLE.
- STILL REQUIRED: repo ingest of the package + reconciliation against current main. The
  package text is not in this stream's possession — ingest happens when its content reaches
  a stream (no placeholder was committed; absence of the repo copy is NOT permission to
  invent design).
- UX IMPLEMENTATION: IN PROGRESS in a separate Claude stream. STREAM SEPARATION (Owner):
  this continuation stream owns authority / decision packages / activation readiness and
  MUST NOT implement or modify the 20 Financials UX surfaces; the UX stream owns Design
  composition. Owner visual acceptance remains sandbox/Quick-Gate dependent.
- Remaining Owner decisions in THIS stream stay focused on: (1) financial roles/
  capabilities + activation-registry authorization; (2) FIN-BLOCK-002 service billing
  route/policy; (3) FIN-BLOCK-003 cost basis/capture authority; (4) FIN-BLOCK-004
  intercompany ratification.

---

## FINANCIALS NORTH STAR UX IMPLEMENTATION

Stream: UX composition (separate from the authority/continuation stream, per Owner
STREAM SEPARATION above). Run start 2026-09-01. START MAIN: dfb362d5e863472f0dd55b7121f4103f5d9cdba7.

### FIN-BLOCK-005 — CLOSED (2026-09-01): DESIGN AUTHORITY AVAILABLE IN-REPO
- The approved Financials North Star P1 design package (20 pages, corrected pass-1
  handoffs, 44 frames, editable .dc.html sources) is installed at
  `docs/north-star/financials/`.
- Current-main authority reconciliation: COMPLETE —
  `docs/north-star/financials/FINANCIALS-UX-CURRENT-MAIN-RECONCILIATION.md`.
  Stale "FIN-003..010 OPEN" handoff wording superseded by the truth table there;
  visible design deltas applied to pages 16 (internal/external reconciliation split)
  and 20 (period + policy rows → BUILT_DORMANT / POLICY NOT CONFIGURED); pages 05/10
  bindings updated with no visual change.
- FINANCIALS NORTH STAR P1: DESIGN DIRECTION APPROVED · CURRENT-MAIN AUTHORITY
  RECONCILIATION COMPLETE · IMPLEMENTATION COMPOSITION MAP READY. Owner visual
  acceptance NOT claimed — that follows sandbox deployment + Quick Gate.

### Wave ledger (append per wave)

#### WAVE UX-1 — Financial lifecycle read spine (2026-09-01)
- PAGES: 01 Overview (/financials) · 03 Invoices · 04 Accounts Receivable · 05 Payments ·
  07 Customer Financials.
- BASE MAIN: 429d8de1 (design-install merge). HEAD/PR/MERGE: recorded at PR close below.
- DESIGN SOURCES: docs/north-star/financials/North Star - Financials {01,03,04,05}*.dc.html
  + 07; frames 01/03/04/05/07 at 1440+375.
- AUTHORITY SOURCES: FINANCIALS-UX-CURRENT-MAIN-RECONCILIATION.md truth table; the one wired
  read chain (useAccountAr → financeReadCallableClient → listAccountInvoiceAr, dormant) is
  composed on page 07 via the existing AccountArSection; account selection via the governed
  bounded accountSearch read. All other fact families render their reconciled honest state
  (NOT_ENABLED with the not-activated / not-wired contract sentences). No new callable, no
  raw collection read, no client financial arithmetic.
- NEW SURFACES: src/modules/financials/ (5 pages + FinancialsPrimitives: page frame, filter
  rail, figure block w/ fact-class label, hover-ⓘ annotation, honest section);
  src/domain/financialsSurface.js (surface vocabulary + read-state mapping); fin-* CSS
  extending the ns-* grammar with 375 recomposition (2-up scorecards, stacked rail).
- VISIBLE DESIGN DELTAS: none beyond the reconciliation (compositions follow the approved
  sources adapted to the shipped app shell; specimen values replaced by honest states per
  the run instructions).
- TESTS: test/financialsSurface.test.mjs (vocabulary + source-level contracts: no specimen
  values, no raw Firestore, no float money) · test/financialsUxLifecycle.test.jsx (8
  composition cases incl. DENIED-as-permission-fact and FUTURE AUTHORITY payments) ·
  financialsNavStructure.test.mjs evolved (implemented-sections set). Full registered suite
  (runSuites, 270 files) green; typecheck + build + oxlint green.
- CI: new lane .github/workflows/financials-north-star-tests.yml (path-filtered; runs the
  three suites + lint + typecheck). NOTE: a PR adding a workflow gets no pull_request run of
  that lane on itself — suites executed locally and via the standard build lane.
- VISUAL GATE: emulator-backed live check at 1440 and 375 (admin persona): scorecard/fact
  classes/truth bands/exception rail/Method TBD verified on 01; no New Invoice on 03; one
  aging grammar on 04; FUTURE AUTHORITY band on 05; live governed customer search with
  truthful EMPTY on 07; 375 recomposes without horizontal scroll. (Local gate only — Owner
  visual acceptance remains sandbox Quick-Gate dependent.)
- BLOCKERS: none for this wave. FIN-BLOCK-002/003/004 unchanged (rendered truthfully).
- DEPLOYMENT: NONE. CERT_WORLD_IMPACT: NONE. CAPABILITIES/GRANTS: NONE.
- NEXT: WAVE UX-2 (02 Billing Queue, 06 Credits & Adjustments).

#### WAVE UX-2 — Billing / corrections (2026-09-01)
- PAGES: 02 Billing Queue (/financials/billing-queue) · 06 Credits & Adjustments
  (/financials/credits-adjustments).
- BASE MAIN: 47b84bfb (Wave UX-1 merge). HEAD/PR/MERGE: recorded at PR close.
- DESIGN SOURCES: North Star - Financials {02,06}*.dc.html + frames.
- AUTHORITY: no billing-readiness read exists (service side = FIN-BLOCK-002, commercial SO
  eligibility logic server-side only); invoice/adjustment/refund cores dormant, capabilities
  inactive; FIN-007 policy not configured (self-approval forbidden, fails closed). Both
  gated actions render DISABLED with the capability-inactive / policy-not-configured
  one-liners the design draws; queue and corrections bodies state the not-wired truth.
- TESTS: two composition cases added to financialsUxLifecycle.test.jsx (disabled gated
  actions, invariant sentence, view/type grammar, no specimen values); registries updated
  (listsP2Compose COLLECTION_SURFACES). Full component sweep (2,988) + runSuites (269) +
  typecheck + build + lint green.
- VISUAL GATE: emulator-backed live check 1440 + 375 (disabled actions with one-liners,
  totals slots, honest bodies; 375 recomposes without horizontal scroll).
- DEPLOYMENT NONE · CERT_WORLD_IMPACT NONE · CAPABILITIES/GRANTS NONE.
- NEXT: WAVE UX-3 (08 Sales to Goal, 09 Cost to Budget, 10 Forecasting, 12 Budgets, 13 Goals).

#### WAVE UX-3 — Plan / Forecast (2026-09-01)
- PAGES: 08 Sales to Goal · 09 Cost to Budget · 10 Forecasting · 12 Budget Management ·
  13 Goal Management.
- BASE MAIN: a2afa845 (Wave UX-2 merge). HEAD/PR/MERGE: recorded at PR close.
- DESIGN SOURCES: North Star - Financials {08,09,10,12,13}*.dc.html + frames.
- AUTHORITY: FIN-003 plan core (GOAL ≠ BUDGET, versioned, explicit basis) and FIN-005
  forecast core (as-of versioning, method label) merged, dormant, NO storage/read — bodies
  state that truth. Measurement-basis vocabulary (BOOKED/BILLED/COLLECTED/REVENUE/
  GROSS_MARGIN) as chips; no total rows across bases. Page 10 approved as drawn — method
  stays "Method TBD — FIN-005", version selector honestly empty, expectedValue never
  promoted. Page 09 reserved columns never zero-filled (FIN-BLOCK-003 stated). New budget/
  New goal actions DISABLED with command-inactive + policy-not-configured truth.
- VOCAB FIX: "Active" tab → "Active budgets" (ADR-012 §2.2a bare-Active gate).
- TESTS: five composition cases added; registries updated (FinancialsBudgets in
  COLLECTION_SURFACES). Component sweep 2,993 green · runSuites 269 · typecheck/build/lint.
- VISUAL GATE: emulator-backed 1440 (08/09/10/12) + 375 (13) — grammar, truth bands,
  disabled actions, basis rail verified.
- DEPLOYMENT NONE · CERT_WORLD_IMPACT NONE · CAPABILITIES/GRANTS NONE.
- NEXT: WAVE UX-4 (11 Profitability, 14 Company Performance, 15 Employee Performance).

#### WAVE UX-4 — Performance (2026-09-01)
- PAGES: 11 Gross Margin & Profitability · 14 Company & Business Unit Performance ·
  15 Salesperson & Employee Performance.
- BASE MAIN: 22630ecb (Wave UX-3 merge). HEAD/PR/MERGE: recorded at PR close.
- DESIGN SOURCES: North Star - Financials {11,14,15}*.dc.html + frames.
- AUTHORITY: page 11 IS the truthful FIN-006 state — UNKNOWN margin (never derived from
  sell price / partial cost), reserved cost/GM/GM% columns, never-on-this-page rail
  (statutory profit/overhead/tax → external authority). Page 14 keeps the UNELIMINATED_SUM
  caveat on every consolidated figure (FIN-009 classification dormant; eliminations
  external; FIN-BLOCK-004 open); consolidated attainment deliberately "—" (would mix
  bases). Page 15 composes FIN-004 truth: scope statement in header (honestly "none" —
  finance.visibility.* inactive), NAMED withheld panel (never zeros, never fetch-and-hide),
  credit vs responsibility views never merged, margin-by-person absence (FIN-PQ-15a).
- TESTS: three composition cases added; sweep 2,996 · runSuites 269 · typecheck/build/lint
  green. VISUAL GATE: 1440 (11/14) + 375 (15) verified.
- DEPLOYMENT NONE · CERT_WORLD_IMPACT NONE · CAPABILITIES/GRANTS NONE.
- NEXT: WAVE UX-5 (16 Reconciliation, 17 Intercompany, 18 Audit, 19 Reports, 20 Governance).

#### WAVE UX-5 — Governance / integrity (2026-09-01)
- PAGES: 16 Reconciliation & Exceptions · 17 Intercompany · 18 Financial Audit & History ·
  19 Reporting & Exports · 20 Financial Settings & Governance.
- BASE MAIN: 528b454d (Wave UX-4 merge). HEAD/PR/MERGE: recorded at PR close.
- DESIGN SOURCES: North Star - Financials {16,17,18,19,20}*.dc.html (16/20 as reconciled
  in the installed sources) + frames.
- AUTHORITY: page 16 composes the CURRENT FIN-010 truth — two sections: internal
  operational integrity (IN_SYNC/DRIFT core merged, BUILT_DORMANT, only actual governed
  results ever render → honest "none to show") vs external accounting reconciliation
  (FUTURE INTEGRATION, no provider, no counts not zero counts, dimmed structural specimen,
  provisional state vocabulary). Page 17: classification never elimination; FIN-009 schema
  not built (FIN-BLOCK-004); unclassified = loud exception, excluded from splits. Page 18:
  lens over the ONE auditEvents authority; FIN-AG-AUDIT-LENS not built — no raw log sweep
  substituted; correlation column reserved (FIN-PQ-CORRELATION-IDS). Page 19: catalog with
  per-group blocking phases; no export wired (FIN-AG-REPORT-REGISTRY); restricted = named
  panel, never partial render. Page 20: five-state chips from the reconciliation truth
  table — period + goal/budget/correction rows BUILT_DORMANT · Policy not configured (the
  required correction; "AUTHORITY NOT IMPLEMENTED" appears on no row); companies/units/
  currency from governed vocabulary; visibility summary read-only.
- TESTS: five composition cases added; component sweep 3,001 · runSuites 269 · typecheck/
  build/lint green. VISUAL GATE: 1440 (16/20/19) + 375 (20) verified.
- DEPLOYMENT NONE · CERT_WORLD_IMPACT NONE · CAPABILITIES/GRANTS NONE.

### RUN CLOSEOUT — FINANCIALS NORTH STAR UX IMPLEMENTATION (2026-09-01)
All 20 pages of the approved Financials North Star P1 composition are implemented in-repo
across five wave PRs, each merged at its exact reviewed head with CLEAN path-filter
coverage. Page 16 internal reconciliation: IMPLEMENTED (as truthful composition). Page 20
period state: CORRECTED. Specimen values in runtime: NONE (source-level test enforced).
New client financial authority: NONE. New raw financial collection reads: NONE. Capability
activations / grants / deploys / backfills / sandbox / production / certification writes:
NONE. Owner visual acceptance NOT claimed — sandbox deployment + Quick Gate remain a
separately gated action. STATUS: FINANCIALS_READY_FOR_SANDBOX_UX_GATE.

### SANDBOX RELEASE + QUICK GATE (2026-09-01)
- START MAIN: d0186da5 · DEPLOY MAIN: c88f1581 (after one in-boundary fix, below).
- SANDBOX PROJECT: eos-platform-sandbox (environment platform-sandbox, resolved via
  scripts/deployHosting.mjs — fail-closed target identity; production untouched).
- DEPLOYED SURFACES: HOSTING ONLY. Functions/Rules/Indexes NOT deployed (rules/indexes
  unchanged since deployed 0abc2353; functions source has merged-but-undeployed dormant
  finance/access changes tracked by the Owner-gated refresh queue — the Financials UX
  genuinely requires none of them; every read renders truthfully with the callable absent,
  present, or refused).
- HOSTING RELEASES: d0186da5 (19:07Z) then c88f1581 (19:18Z). The second exists because the
  first live gate run found a deterministic 375 defect INSIDE the UX boundary — bare-1fr
  mobile grid track let wide tables force document-level horizontal scroll on
  /financials/sales-to-goal and /financials/profitability — fixed as minmax(0,1fr)
  (PR #1700, merged at exact reviewed head, CLEAN coverage), redeployed from fresh main.
- VERSION.JSON IDENTITY: PASS — served {commit c88f1581, environmentId platform-sandbox,
  role sandbox}; checkDeployedVersions: no drift.
- QUICK GATE: PASS — financialsNorthStarQuickGate.mjs (new canonical per-family gate,
  in-repo via #1700), seeded admin persona: 243/243 checks. 20/20 routes at 1440 AND 375.
  (A confirmation re-run showed one transient cold-navigation render timeout on
  /financials at 375, passing in the canonical run and in direct probes; recorded, not a
  defect.)
- AUTHORITY LEAK: NONE — zero client reads of deny-all financial collections (measured
  from the network log); zero uncaught JS/React/console errors; visibility remains
  inactive ("no financial visibility scope granted" renders on page 15).
- SPECIMEN LEAK: NONE — zero $-figures anywhere across all 40 page-views (capabilities
  dormant ⇒ any $-figure would be specimen or fabrication).
- TRUTHFUL-STATE GATES: FIN-003 no fabricated plans · FIN-004 not activated · FIN-005
  "Method TBD — FIN-005", no version invented · FIN-006 UNKNOWN margin, no $0 cost ·
  FIN-007 gated actions DISABLED with policy truth (no silent/self approval) · FIN-008
  page 20 reads BUILT DORMANT · Policy not configured (no "Authority not implemented"
  row) · FIN-009 UNELIMINATED_SUM caveat present · FIN-010 page 16 visibly separates
  internal IN_SYNC/DRIFT from external FUTURE INTEGRATION. Page 05 unapplied cash stays
  FUTURE AUTHORITY with no fake records.
- PAGE 07: live governed customer search returned 11 sandbox accounts; selecting one
  composed the AR read truthfully (honest state, no numbers — finance.read inactive).
  No new raw read, no duplicated truth store.
- ACTIONS: Create invoices / New correction / New budget / New goal — DISABLED with their
  capability-inactive / policy-not-configured one-liners. No other mutating action exists.
  44px touch target verified at 375.
- KNOWN TRUTHFUL DORMANT STATES (visual review less representative there): every read
  body is NOT_ENABLED words (no data renders anywhere by design until Owner activation);
  pages 03/04/05 bodies are column grammar + honest state only.
- OWNER REVIEW STATUS: AWAITING_OWNER_VISUAL_ACCEPTANCE at
  https://eos-platform-sandbox.web.app/financials (all 20 routes; version c88f1581).
- DEPLOYMENT BOUNDARY: CAPABILITIES ACTIVATED NO · GRANTS NO · BACKFILL NO ·
  PRODUCTION WRITES NO · CERTIFICATION WRITES NO · policies untouched.

### OWNER VISUAL ACCEPTANCE REVIEW — ROUND 1 (2026-09-01)
- REVIEWED BUILD: c88f1581 on eos-platform-sandbox. Method: seeded ADMIN on the deployed
  sandbox, 40 full-page captures (20 routes × 1440/375), structural metrics per view, live
  interaction on page 07. No edits during the sweep.
- OWNER DECISION: **B — ACCEPT WITH CORRECTIONS.** Owner visual acceptance remains PENDING
  until the Owner accepts the corrected result.
- MATERIAL FINDING F1 (V4, corrected): pages asserted `finance.read is inactive`,
  `finance.visibility.* inactive`, `no financial visibility scope granted`. FALSE in
  platform-sandbox — `finance.read` is activated there by the pre-existing Owner-authorized
  environment override (`environmentCapabilityOverrides`, in the deployed Functions bundle,
  NOT changed by any run in this program), and the governed callable returns
  `{status:"ready"}` for the admin persona, which it only reaches when the fact-family gate
  AND a visibility scope both allow. Direction of error was CONSERVATIVE (under-claimed
  reach; no leak, no over-claim), but a surface stating an authority fact it never resolved
  is the same defect class as one inventing a number. Copy now states what the SURFACE does.
  NOTE: the earlier Quick Gate + release ledger entry repeated the same imprecise
  "capabilities inactive" characterization; the gate's own header comment is corrected too.
- CORRECTED (PR #1702, merged 648927d7 → main 6d0fae6f): F1 authority copy family-wide ·
  F2 ~83 sub-44px touch targets at 375 (other North Star families had zero) · F3 footer
  links rendered above the empty state · F4 Overview said the custody sentence twice ·
  F5 Governance row wrapping · F6 Billing Queue totals band filled 2 of 4 ruled columns.
  Follow-up (PR #1703): last 44px straggler + Quick Gate retry/assertion hardening.
- GUARDS ADDED: two source-level contracts in `financialsSurface.test.mjs` — the honest-state
  constants and every rendered string under `src/modules/financials/` may not assert a
  capability's activation state. MUTATION-PROVED (reintroducing the claim fails the suite).
  A literal control byte introduced by the first draft of that guard (which would have made
  two assertions unfalsifiable) was caught by the repo's `noLiteralControlBytes` guard.
- DEFERRED FOR OWNER STEER (not corrected): F7 (V2) page 01 mobile order — approved handoff
  says exceptions outrank the plan table and the cost/margin band is omitted at 375 ·
  F8 (V2) page 07 omits approved slots (Outstanding figure, Sales-vs-Service split,
  financial history ledger, open-items/context rails) rather than showing honest-state slots ·
  F10 Method TBD demoted to prose · F11 Profitability pivots look enabled while copy says
  inactive · F12 NOT CONFIGURED and FUTURE INTEGRATION chips share identical styling.
- RE-GATE ON CORRECTED BUILD: financialsNorthStarQuickGate 245/245 at 6d0fae6f; 20/20 routes
  at 1440 and 375; zero $-figures; zero deny-all collection reads; zero console errors;
  sub-44px targets at 375 reduced ~83 → 0.
- DEPLOYMENT: HOSTING ONLY (c88f1581 → 6d0fae6f, and the follow-up build). Functions, Rules,
  Indexes NOT deployed. CAPABILITIES ACTIVATED: NO · GRANTS: NO · POLICY: unchanged ·
  BACKFILL/PRODUCTION/CERTIFICATION WRITES: NO.
- STATUS: AWAITING_OWNER_VISUAL_ACCEPTANCE (round 2, on the corrected build).

### OWNER CORRECTIONS ROUND 2 (2026-09-01)
- OWNER DIRECTION: F7 FIX · F8 FIX · F10 NO CHANGE · F11 FIX LIGHTLY · F12 FIX LIGHTLY.
- F7 (PR #1704): page 01 at 375 now follows approved handoff §8 — exception rail outranks
  the plan table, cost/margin band omitted (it lives on Cost to Budget and Profitability).
  Scoped to a `--home` modifier inside the mobile breakpoint; DESKTOP UNCHANGED. Consequence
  recorded: the rail is one grid child, so the Forecast teaser rises with Exceptions —
  375 order is scorecard → exceptions → forecast → plan.
- F8 (PR #1704, #1705): page 07 restores every approved slot — Outstanding (5th summary
  figure), Sales-vs-Service split, financial history event ledger, open-items rail, context
  rail. NO new reads, NO widened authority: each renders its honest state. Outstanding is a
  SLOT not a figure — the wired AR read returns outstanding PER CURRENCY and collapsing it
  would be the client-side arithmetic this family forbids; the AR section renders the
  per-invoice truth. Five figures sit on one row (a 3-col grid wrapped 3+2 and left a ruled
  empty cell reading as a missing sixth figure).
- F10: unchanged by Owner decision — "Method TBD — FIN-005" in prose is accepted.
- F11 (PR #1704): Profitability dimension pivots are no longer interactive chips while the
  page states they are inactive; rendered in the family's existing static chip grammar.
- F12 (PR #1704): Governance's four states now carry four treatments — "Not configured"
  (solid quiet) and "Future integration" (dashed) no longer share one outline. Same chip,
  same tokens, existing grammar; only the border treatment differs.
- GATE HARDENING (PR #1705, this PR): viewport-aware assertions (the cost band is REQUIRED
  at 1440 and FORBIDDEN at 375, so a viewport-blind check had to be wrong at one width);
  a positive F7 check measuring EXCEPTIONS-BEFORE-PLAN by painted position, since the
  recomposition is CSS `order` and a DOM-order check would report desktop sequence and pass.
  ROOT-CAUSED A GATE DEFECT PREVIOUSLY MISDIAGNOSED AS A COLD-CDN FLAKE: on /financials
  alone the shell's visually-hidden domain <h1> and the page title are both "Financials", so
  the role query matched two elements and threw strict-mode; it passed only when the check
  beat the title's paint. Now addressed via `h1.ns-workspace__title`. Two consecutive clean
  runs.
- RE-GATE: financialsNorthStarQuickGate **246/246** at aeb413bd; 20/20 routes at 1440 and
  375; zero $-figures; zero deny-all collection reads; zero console errors; sub-44px targets
  0 across all 20 routes.
- DEPLOYMENT: HOSTING ONLY (5a67502f → 0c005b85 → aeb413bd). Functions/Rules/Indexes NOT
  deployed. CAPABILITIES/GRANTS/POLICY/BACKFILL/PRODUCTION/CERTIFICATION: unchanged, none.
- STATUS: AWAITING_OWNER_VISUAL_ACCEPTANCE (round 3, on aeb413bd + this gate fix).

### OWNER REVIEW FIXTURES — FINANCIAL_REVIEW_P1 (2026-09-01)
- START MAIN ab64af79 → fixtures merged (#1707) + company-assertion fix (#1708).
- SANDBOX: eos-platform-sandbox. Hosting/Functions/Rules/Indexes: NOT deployed (fixture data
  only; the deployed runtime is unchanged at aeb413bd).
- METHOD: `functions/scripts/financialReviewFixtures.mjs` — bounded, idempotent, sandbox-only
  (refuses any other projectId, refuses a disagreeing ambient project, requires --apply AND
  --apply-live-sandbox). Modes verify/install/remove; own marker `financialReviewP1`, so it
  never touches certificationWorld-marked or hand-created records. NOT a rebuild: the sandbox
  certification world is at 1.6.0 vs repo 1.8.0, so `certificationWorld rebuild` would have
  destructively reset unrelated review state — installed alongside instead.
- SEEDED SOURCE FACTS (Admin SDK, ADC): 6 governed Sales Orders, fulfilled/priced/attributed.
- DERIVED THROUGH GOVERNED COMMANDS (deployed issueInvoice/applyPayment, admin persona token):
  6 invoices, 4 payment applications. The seeder cannot express a total, balance or aging
  bucket — a test asserts it does not — and both commands replay on a deterministic
  idempotencyKey (proved live: a rerun replayed the first invoice rather than re-issuing).
- DERIVED RESULT: taylor INV-000001..5 + ventana INV-000001 (separate governed per-company
  sequences). PAID ×2 (outstanding 0) · PARTIALLY_PAID ×2 (570000, 815000) · open ×2
  (2735000 overdue by governed dueDate, 187500 ventana). Arithmetic reconciles exactly.
- ATTRIBUTION: creditedSalespersonId explicit and frozen per order — A cw-emp-034 (Lucian
  Brightwater, 4 events, 3 customers) and B cw-emp-035 (Petra Lindqvist, 2 events, 2
  customers). Two orders carry ownerEmployeeId != creditedSalespersonId; createdByUid is the
  operator on all six, so neither ownership nor record creation can be read as sales credit.
- VISIBILITY (verified live through listAccountInvoiceAr as the seeded admin): cw-acct-0000
  1 invoice/0 open · cw-acct-0001 1/1 open $8,150 · cw-acct-0002 1/1 open AND 1 OVERDUE
  $27,350 · cw-acct-0003 3 invoices/2 open $7,575.
- NOT SEEDED, DELIBERATELY: no cost facts (FIN-BLOCK-003 — Profitability still says UNKNOWN),
  no service-origin billing (FIN-BLOCK-002), no intercompany/eliminations (FIN-BLOCK-004 —
  the Ventana order is an ordinary same-company sale; consolidated stays UNELIMINATED_SUM),
  no unapplied cash (page 05 keeps FUTURE AUTHORITY), no adjustments (FIN-007 policy
  unconfigured), no goals/budgets/forecasts (FIN-003/FIN-005 have NO persistence path — no
  collection, no command, no read; seeding one would have meant inventing storage).
- CAPABILITIES/GRANTS/POLICY: unchanged. No production or certification path touched.
- PAGE STATUS AFTER SEED (deployed sandbox, seeded admin):
  · /financials/customer-financials POPULATED — real per-invoice receivables, "Overdue ·
    75d overdue", $27,350.00, "1 open, 1 overdue"; summary/split/history slots remain honest.
  · every other Financials route HONESTLY_DORMANT — unchanged by the seed, because those
    pages issue no read of their own. MISSING READ SEAM (the single blocker to a populated
    review): a company/BU/salesperson-scoped financial read. Only the account-scoped
    listAccountInvoiceAr exists today, which is why page 07 alone populates.
- OWNER VISUAL ACCEPTANCE: PENDING (unchanged by this run).

## 2026-09-01 — GOVERNED REPORTING READ SEAM (PR #1709 read + tests, PR #1710 surface bindings)

Closes the MISSING READ SEAM named in the entry above: the family had exactly one governed
read and it was account-scoped, which is why page 07 alone populated after the fixture seed.

- AUTHORITY AUDIT FIRST (no API designed before it). Reusable and reused unchanged:
  `loadFinancialVisibilityAuthority(db, uid)` (the ONE canonical FIN-004 resolver, admin
  included, no bypass), `authority.isInvoiceVisible`, `invoiceVisibilityFacts(doc)`, and the
  pure derivations `projectInvoiceAr` / `summarizeAccountAr` / `deriveOutstandingMinor` /
  `deriveArPosition`. NO second visibility predicate and NO second outstanding formula exist.
- THE READ: one trusted callable `listFinancialFacts({companyId?, businessUnitId?,
  creditedSalespersonId?, accountId?, periodStartMillis?, periodEndMillis?, factTypes?,
  limit?})`. Fact types are only what is PERSISTED — INVOICE, PAYMENT_RECEIPT,
  PAYMENT_APPLICATION. No goal, budget, forecast, cost or margin type exists, and a test
  fails if the source ever names one.
- FILTERS ARE NOT AUTHORIZATION, structurally. The visible set is computed from the authority
  predicate BEFORE any caller filter is consulted; filters then narrow that already-authorized
  set. Widening is not expressible. Proved: asking for another salesperson's credit under SELF
  reach returns an honest EMPTY, not their facts; no filter combination yields a record the
  unfiltered read did not.
- ATTRIBUTION PRESERVED, NEVER RE-DERIVED. `creditedSalespersonId` is exposed verbatim from the
  invoice's frozen attribution. Credit is never sourced from customer owner, createdBy,
  assignment, technician or warehouse, and the read deliberately does NOT join invoice → Sales
  Order to recover it: that would re-derive historical credit from a mutable record.
- FAIL-CLOSED TWICE: `permission-denied` at the callable when reach is absent, and the core
  read returns `unavailable` rather than a `ready` empty page. Truncation honesty follows the
  existing precedent and is judged on the UNFILTERED page, so a narrow scope cannot mask an
  incomplete one.
- TESTS: 24 offline contract cases (injected authority + fake Firestore — the scope rules are
  provable without a live grant) + 3 callable-boundary cases on the existing emulator suite +
  10 client view-model cases including a guard that the client performs NO money arithmetic.
  Emulator run on port 8123; port 8080 (private AI gateway) untouched.
- SURFACES BOUND (PR #1710): 03 Invoices, 04 Accounts Receivable (exposure table), 05 Payments,
  14 Company Performance, 15 Salesperson & Employee Performance. Page 07 unchanged.
- DELIBERATELY LEFT HONEST, with the reason on the page: the 04 AGING SCORECARD (bucketing is
  money arithmetic the client must not do, and the read returns no aged rollup); COMPANY
  PERFORMANCE "Booked" (a Sales Order fact, not an invoice fact — Billed is NOT substituted);
  the CONSOLIDATED column (the server returns per-company rollups and no consolidated row; the
  page will not add the columns together); PAYMENTS "Unapplied" (no governed record can carry
  an unapplied balance, so the column is dashed rather than subtracted).

### KNOWN PARTIAL — salesperson and business-unit dimensions

The 7 invoices in eos-platform-sandbox carry `companyId` but `attribution: null` and no line
`businessUnitId`: the DEPLOYED `issueInvoice` (last updated 2026-08-26) predates current main's
attribution stamping. Company / account / period / lifecycle dimensions are therefore reportable
today; SALESPERSON AND BU DIMENSIONS ARE NOT PRESENT IN THE PERSISTED FACTS. The read reports
this truthfully as `unattributed`, and page 15 states the count beside its table rather than
showing anyone a zero row. Closing it requires the broader Functions refresh below.

### DEPLOYMENT PACKAGE — NOT EXECUTED

Per the mission's own instruction ("if deployment scope becomes materially broader than this
mission, STOP and return the deployment package instead of executing"):

1. `firebase deploy --only functions:listFinancialFacts --project eos-platform-sandbox` —
   the bounded deploy this seam needs. It leaves every other function's revision untouched.
   NOT EXECUTED in this session (the deploy command was refused at the tool boundary).
2. BROADER REFRESH, NOT RECOMMENDED AS PART OF THIS MISSION: 36 commits touch `functions/src`
   since the sandbox Functions build of 2026-08-26, spanning `access/` (permissionCatalog,
   resolveEffectivePermission, compatibilityRoles, governedBusinessRoles, bindingScopePolicy,
   trustedWriterCommands, environmentCapabilityOverrides), `finance/`, `ownership/`,
   `opportunity/`, `ai/`, `constants/` and `index.ts`. Only this refresh would make
   `issueInvoice` stamp attribution — and the FINANCIAL_REVIEW_P1 invoices would then need
   re-issuing to carry it, since issued invoices are immutable. That is an access-surface
   change and an Owner decision, not a side effect of a reporting read.
3. Hosting deploy for the surface bindings, after PR #1710 merges.

- OWNER VISUAL ACCEPTANCE: PENDING (unchanged by this run).

## 2026-09-02 — SANDBOX VISIBILITY ACTIVATION + POPULATED OWNER REVIEW GATE

The Financials family renders real governed data for the first time.

- ACTIVATION (PR #1711, merge cc261540): `finance.visibility.consolidated` activated for
  eos-platform-sandbox ONLY, through the canonical per-environment mechanism. `finance.read` was
  already active; FIN-004 requires a reach scope IN ADDITION, so every page denied until now —
  correct, and unreviewable. NO Role definition changed and NO grant written: `admin` and `owner`
  already hold the capability, and the catalog's active:false was the only blocker.
- DEPLOY SCOPE, computed rather than assumed: of 132 deployed sandbox functions, exactly ONE
  needed to move. `listFinancialFacts` (e35e4b97 → ceb8e533, srcGen 1788314175006305) was the only
  deployed function whose decision the added id changes; its delta from the previously deployed
  768f9c1c was ACTIVATION_ONLY (environmentCapabilityOverrides.ts +28, package.json test script).
  Every other function retained its prior source generation — verified after the deploy.
- DELIBERATELY NOT REFRESHED: issueInvoice (authorizes finance.invoice.issue, already active — its
  decision is bit-identical under both override sets; refreshing it would introduce FIN-002
  attribution stamping); listAccountInvoiceAr (populates page 07 today precisely BECAUSE it
  predates FIN-004 enforcement; refreshing is MATERIAL_GOVERNANCE_CHANGE); applyPayment;
  resolveEffectiveAccessCallable. The broader refresh (39 commits, 72 files, +10,027 lines under
  functions/src) was NOT performed.
- DEFECT FOUND AND FIXED (PR #1712, merge 9195ce88): Payments rendered 0 rows at both widths while
  the server returned 4 payments and 4 applications. Page 05 requests factTypes
  [PAYMENT_RECEIPT, PAYMENT_APPLICATION], so `invoices` comes back empty by design —
  and `financialFactsState` tested `result.invoices` alone, declaring the page empty while it held
  the records it had asked for. Emptiness is a fact about the whole answer, not about invoices.
  Presentation-layer state branch only; no new derivation, no authority change.
- HOSTING: 9195ce88 (buildTime 2026-09-02T02:07:51.708Z, platform-sandbox/sandbox). Functions
  untouched by the hosting deploy — confirmed by source generation.
- GATE: 70/70 at 1440 and 375. Zero raw client financial reads, zero 403s for the review persona,
  zero console errors, zero horizontal overflow, zero fabricated figures.
    03 POPULATED — 7 invoices · 04 POPULATED/PARTIAL — 5 open incl. the 76-day overdue $27,350 ·
    05 POPULATED — 4 receipts · 07 POPULATED — ONYX settled, Novel $8,150 open, Churn overdue,
    Handel's long name without overflow · 14 PARTIAL — Billed/Collected/A-R per company, Booked
    still "Not an invoice fact", Consolidated still "Not summed here" ·
    15 TRUTHFULLY SPARSE — no rows, and the page states "7 visible invoices carry no credited
    salesperson" rather than showing Lucian or Petra a zero.
- UPSTREAM CREDIT EVIDENCE PRESERVED: the 6 FINANCIAL_REVIEW_P1 Sales Orders still carry explicit
  credit — Lucian Brightwater (cw-emp-034) ×4, Petra Lindqvist (cw-emp-035) ×2 — with 2 orders
  where ownerEmployeeId != creditedSalespersonId and 6/6 where createdByUid != creditedSalespersonId.
  The sales-credit model exists upstream; the historical invoice generation simply lacks the frozen
  attribution, and that gap is reported rather than filled.
- LEGACY UPPERCASE `TAYLOR`: preserved, not normalized. One $50 invoice (acct-harbor) rolls up under
  its own company key and therefore appears in no governed lowercase column on page 14 while
  remaining visible on page 03. Truthful, and left for an Owner decision.
- FIXTURES: UNCHANGED. Nothing deleted, mutated, reissued, backfilled or normalized.
- OWNER VISUAL ACCEPTANCE: PENDING.

## 2026-09-02 — SALESPERSON ATTRIBUTION REVIEW ENABLEMENT

Page 15 shows named salespeople with real governed figures, beside an honest statement of the
facts it cannot attribute. Both generations coexist, which was the point.

- DEPLOY SCOPE, computed from the IMPORT CLOSURE rather than guessed. Firebase bundles a function
  with everything it transitively imports, so the closure IS the deploy surface. `issueInvoice`'s
  closure is 19 files, of which 14 changed since its deployed generation (+1,267/−61) — far
  narrower than the 39-commit / 72-file broader delta, which was NOT deployed.
- THE ACCESS CORE MOVED IN THAT BUNDLE, AND IT WAS PROVED UNREACHABLE. R-32 (#1668, breaking)
  ships inside issueInvoice's bundle. Its constraint set was enumerated: `scopesByPermission` is
  declared by exactly two roles (warehouseManager, partsManager) over exactly two permissions
  (inventory.transaction.read, reorder.request.create.manual). `finance.invoice.issue` — the ONE
  capability issueInvoice evaluates — is unconstrained, and admin/owner still resolve ALLOW
  qualifyingGrant. Bundles are per-function, so no other deployed function's resolver changed.
- DEPLOYED: `functions:issueInvoice` ONLY (7a8dbd08 → ceb8e533, srcGen 1788317210074627).
  applyPayment, listAccountInvoiceAr and listFinancialFacts retained their source generations;
  132 functions before and after. No Rules, no indexes, no grants, no role changes.
- PAYMENT COMMAND: NOT refreshed. The deployed applyPayment worked unchanged against newly issued
  invoices — proved by installing, not assumed.
- PAGE 15 NAME RESOLUTION (PR #1714): the rollup key is creditedSalespersonId, and the page was
  rendering it raw ("cw-emp-034" where a name belongs) — the defect class actorDisplayName.js
  exists to prevent. Reuses resolveEmployeeIdentity against the existing useEmployeeDirectory
  byEmployeeId map: no new read, no server join, no new authority. resolveEmployeeIdentity gained
  an optional `noun` (default "owner", so every existing caller is untouched); Financials passes
  "salesperson", because calling an unresolved credit "Unknown owner" would assert the conflation
  FIN-002 forbids. GROUPING IS UNCHANGED and tested: rollupRow receives only the server row, the
  label is resolved FROM row.key, and money cannot regroup when someone is renamed. The guard is
  mutation-proved — swapping in row.ownerEmployeeId makes it fail.
- THREE ATTRIBUTED FIXTURES (fr-p2-*), additive. The six existing orders replayed as no-ops on the
  same idempotency keys; only the three new ones executed.
    NEW A  INV-000006 · taylor · EQUIPMENT_SALES · PAID     · 512,500 · credited cw-emp-034
    NEW B  INV-000002 · ventana · PARTS          · PARTIAL  · 743,000 (250,000 applied) · cw-emp-035
    NEW C  INV-000007 · taylor · EQUIPMENT_SALES · OPEN     · 1,050,000 · credited cw-emp-034,
           owned by cw-emp-035 — owner != credited, and createdByUid (the operator) is neither.
  A fixture-contract test caught a real mistake while writing these: NEW B first took Petra's own
  customer for Lucian, collapsing the "each salesperson holds an account the other does not"
  property. Corrected in the fixture, not relaxed in the test.
- ATTRIBUTION VERIFIED ON THE PERSISTED RECORDS: 3 invoices carry a frozen
  attribution.creditedSalespersonId and a line businessUnitId; company is derived from the
  governed Sales Order on all three; createdByUid never became credit; customer owner never
  overrode it. The 7 historical invoices remain UNATTRIBUTED and unmutated — no backfill.
- BU AXIS EXERCISABLE FOR THE FIRST TIME: page 14's "By unit" view now resolves EQUIPMENT_SALES
  and PARTS from the new invoices. Old invoices were not retrofitted.
- LEGACY UPPERCASE `TAYLOR`: unchanged — LEGACY_UNNORMALIZED_BY_DESIGN.
- HOSTING: 16087a74 (2026-09-02T02:57:27.318Z). No function moved with it.
- GATE: 66/66 across six routes × two widths. Zero raw employee ids rendered anywhere, zero raw
  client financial reads, zero 403s, zero console errors, zero horizontal overflow.
    Page 15 · Lucian Brightwater — Billed $15,625.00 · Collected $5,125.00 · Outstanding $10,500.00
              Petra Lindqvist   — Billed  $7,430.00 · Collected $2,500.00 · Outstanding  $4,930.00
              plus "7 visible invoices carry no credited salesperson…" — the unattributed count is
              NOT merged into either person.
- OWNER VISUAL ACCEPTANCE: PENDING.
