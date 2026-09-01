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
