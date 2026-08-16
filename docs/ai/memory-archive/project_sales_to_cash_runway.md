<!-- ARCHIVED AI WORKING NOTES — NOT AUTHORITY -->
> **Historical AI working notes**, moved out of Claude's private memory on 2026-08-16 so they are
> visible and auditable in the repository. **This file is not authoritative.** The authoritative
> record for this workstream is the linked `docs/` specification, DECISIONS entry, or PR history.
> Retained verbatim so nothing is lost; do not cite it as a decision of record.

---
name: project_sales_to_cash_runway
description: "Sales→Fulfillment→Ops autonomous build runway (Owner velocity mandate 2026-08-07): Opportunity→WON→Sales Order→Fulfillment→Warehouse→Dispatch→Field→Completion→Billing→AR. Compact Product ledger + where it stops."
metadata: 
  node_type: memory
  type: project
  originSessionId: c981623b-0554-459a-9918-1dca1eec1135
  modified: 2026-08-15T03:21:17.419Z
---

**Owner mandate 2026-08-07: PRODUCT VELOCITY.** Build the commercial→operational runway across MULTIPLE
connected repo-only cycles before returning; UX PAUSED (record UX/IA findings, don't make material IA changes
without evidence); agents are supporting infra (use only when justified). Return ONLY for material business
decision / new canonical authority / GRANT / DEPLOY / Rules DEPLOY-or-widen / production / destructive /
security conflict / material-undeferrable-UX. NOT for cycle-complete / PR-merge / ordinary defect / new SHA.

**Assessment (grounds Cycles 4–9): `docs/assessments/sales-order-fulfillment-assessment.md`.** Authority map
(reuse, no forks): accounts/contacts/locations/parts(ADR-008)/equipment_models/equipment(ADR-006/010)/Employee
/WO lifecycle/inventory. ONE new authority for the whole runway = `sales_orders`. Core invariant: commercial
line qty vs physical serialized (C713×5 = ONE line qty5 → 5 equipment at FULFILLMENT, never at SO/Opportunity).
Money concepts distinct (order≠invoice≠payment≠revenue≠cost≠commission).

**COMPACT PRODUCT LEDGER (main e9c33df):**
- Opportunity: Cycle 2 read-first (#649) · Cycle 3 write authority (#651) · Cycle 3b write-readiness seam
  (#656) · Cycle 3c trusted read projection (#654). All fail-closed/inert.
- **Cycle 4 MERGED (#659, ade8ce6): Sales Order authority.** New `sales_orders` collection (Admin-SDK-only
  deny-all Rules both mirrors + hash re-pin b99e1bea…, NO deploy). functions/src/salesOrder/{lifecycle,commands,
  callables}.ts: create/transition, capability `salesOrder.write` active:false. Lifecycle CONFIRMED→IN_FULFILLMENT
  →FULFILLED(gated all-lines-fulfilled)→CLOSED +CANCELLED-pre-FULFILLED. Line qty model ordered≥allocated≥
  fulfilled; serialized-asset line FORBIDDEN; unitPrice=passive snapshot (no pricing authority). 8 tests, CI.
- **Cycle 5 seam MERGED (#660, e9c33df): allocation-seam LOGIC (pure).** functions/src/fulfillment/
  allocationProjection.ts: availability KNOWN{qty}/UNAVAILABLE/UNKNOWN (never silently 0); per-line ALLOCATED/
  PARTIAL/BACKORDERED/UNAVAILABLE/UNKNOWN; readiness rollup READY/PARTIAL/BLOCKED/UNKNOWN.
- **Cycle 5 LIVE MERGED (#661, a0fc92e): allocateSalesOrder command.** Owner RESOLVED availability semantics
  2026-08-07 (parts ATP = eligible-ACTIVE-warehouse ON_HAND − open-WO-reservations − other-active-SO-allocations,
  floored, missing⇒UNKNOWN-never-0; exclude truck/mobile/customer/temp; no double-allocate; no auto-PO/substitution
  /date; serialized eq allocated individually w/ full custody/eligibility/temp-placement checks). NON-FORKING:
  allocation recorded ONLY on sales_orders (allocatedQty); inventory/warehouses/equipment READ-ONLY; NO write to
  WO-keyed inventory ledger (ADR-003) or Equipment authority (real reservation happens downstream at WO dispatch).
  functions/src/fulfillment/fulfillmentAvailability.ts (pure: openWorkOrderReserved/computePartAvailability/
  computeEquipmentAvailability/sumOtherSoCommitments) + allocateSalesOrder.ts (transactional; SO-vs-SO race
  prevented by re-reading other-SO commitments in tx). capability salesOrder.fulfill active:false. PARTS path
  FULLY built; EQUIPMENT path = UNKNOWN/fail-closed this slice (equipment-availability contract = next slice).
  10 pure tests, CI. No Rules change.

- **Equipment-availability CONTRACT + assessment MERGED (#662, 94da585).** Owner-directed canonical-equipment-
  read assessment. OUTCOME: serialized-equipment availability correctly stays UNKNOWN/fail-closed today (Owner
  invariant #2) — 3 unestablishable facts: (1) serialized-asset `availability` signal INJECTED/not-yet-connected
  (P1a "Available Equipment" honest not-connected); (2) ordered EQUIPMENT_MODEL ref ↔ serialized-asset partId/
  part.model MAPPING UNRESOLVED (serial assets are partId-keyed w/ part.model; equipment_models separate; the
  ref semantics = the key modeling Q when registry connects); (3) #12 Temp Placement authority absent → can't
  establish no-placement. functions/src/fulfillment/equipmentAvailabilityContract.ts: temporaryPlacementConflict()
  reports available:false=UNDETERMINED (empty list is NOT "no conflicts" — honest, not fake no-op),
  serializedAssetSubstrateConnected()=false, readEquipmentAvailability()=>UNKNOWN auto-activating when connected;
  allocateSalesOrder derives equipment avail via the contract. doc=docs/assessments/equipment-availability-
  contract-assessment.md. KEY FINDING: serialized-EQUIPMENT fulfillment (the PRIMARY C713 case) is BLOCKED on
  the not-yet-connected serialized-asset registry + the model↔serial mapping — an inventory/registry FOUNDATION
  gap outside the Sales runway. PARTS path fully live.

- **C7 SO→Service seam + DEMAND LINEAGE MERGED (#663, 22423f5).** Extracted createWorkOrderRecord core from
  the createWorkOrder callable (ADR-009, behavior-identical; WO engine emulator test green); new trusted
  createServiceForSalesOrder command (capability salesOrder.service active:false) creates ONE coordinated WO
  per SO via the WO core w/ salesOrderId lineage (SO never writes WO state/assignment/schedule); SO records
  serviceWorkOrderIds + advances to IN_FULFILLMENT. NO-DOUBLE-COUNT invariant: openWorkOrderReserved now
  EXCLUDES reservations from WOs linked to an active SO (SO-origin demand counted once via SO allocation;
  standalone WO reservations still count); regression demandLineage.test.mjs proves SO-allocated-2 + its-WO-
  reserved-2 = 2 not 4. No competing inventory authority (allocation on sales_orders; reservation in WO-keyed
  ledger; salesOrderId = dedup link). No Rules change.
- **C8 multi-equipment coordination ASSESSMENT MERGED (#664, 2f790ea, docs-only). CONCLUSION: NO new authority
  needed — the Sales Order IS the coordinator.** WOs sharing one salesOrderId (C7) + shared customer/location +
  existing Scheduling/Dispatch already coordinate per-equipment WOs: per-unit accountability = one WO per
  serialized unit; one coordinated visit = the salesOrderId-group w/ shared window/tech/truck (grouping/read
  concern); partial completion native (4/5=ATTENTION). Do NOT invent Job/Visit/WorkOrderGroup. Only the
  per-unit WO fan-out waits on the serialized-equipment-allocation parallel dependency; coordinated-visit
  grouping (Dispatch/Scheduling read over salesOrderId) is buildable NOW.

- **C8 coordinated-visit projection MERGED (#666, c8aaa56).** functions/src/fulfillment/coordinatedVisit.ts
  (pure): groupWorkOrdersBySalesOrder + buildCoordinatedVisit(s) — per-unit accountability (one WO per row),
  one coordinated visit (salesOrderId group), HONEST partial completion (all-done=READY/any-blocked=ATTENTION/
  some-done=PARTIAL/else IN_PROGRESS), shared customer/location context w/ divergence surfaced. NO new
  authority. Operational Service/Dispatch read, SEPARATE from commercial coverage. 6 tests.
- **Commercial Coverage & Territory Management RECORDED (register #15, #665 d3f523f + [[project_commercial_
  coverage_territory]]).** Owner mid-runway: RECORD+preserve seams, do NOT build during runway. Seams preserved
  in runway code: SO uses ownerEmployeeId+salesChannel+canonical Account/Location; coordinated-visit asserts NO
  sales ownership (operational, separate). SALES_CHANNELS const still RETAIL/NATIONAL_ACCOUNTS (STRATEGIC_
  ACCOUNTS + configurable = deferred to #15, not a hot-fix). No single-salesperson resolver introduced. No code
  assumptions needed correcting; no UX remediated (backend only).

- **C9 coordinated field-mission projection MERGED (#667, e16fd34).** functions/src/fulfillment/coordinated
  FieldMission.ts (pure): technician view of a coordinated visit — ONE customer/location context + per-equipment
  units (independent WO execution preserved) + HONEST readiness (F1/F2: missing evidence⇒UNKNOWN never fake
  READY; READY only when parts READY AND load verified; blocked⇒ATTENTION) + coordinated load readiness +
  overall progress/PARTIAL. Field signals injected from governed sources; no demo path. 6 tests.
- **Completion→Finance seam + Billing/AR assessment MERGED (#668, 71a9adf).** functions/src/fulfillment/
  billingEligibility.ts (pure): computeBillingEligibility(commitment + fulfillment evidence + operational
  completion) → ELIGIBLE/PARTIALLY_ELIGIBLE/HELD(blocker/additional-work)/CANCELLED/NOT_YET. Reports ONLY
  eligibility + fulfilled fraction — NO invoice/amount/tax/when-to-bill (Finance greenfield owns processing);
  WO/SO never the accounting authority; money concepts distinct. 6 tests. Assessment doc = future Billing/AR
  flow (invoice→sent→due→payment→overdue→collections→paid; operationally-complete≠invoiced≠financially-complete).

**SERVICE↔INVENTORY MATERIAL-TRUTH ASSESSMENT MERGED — PR #675 (docs-only).** Owner: trace why 5 surfaces
"disagree" (repo-truth-first, NOT make numbers match). One scoped SONNET data-flow reviewer traced + I verified.
VERDICT: no single number conflicts. TWO authorities: inventory_transactions (live forecast, inventoryAnalytics
Engine) → Operations Overview "nothing to reorder" + "Critical&High(0)" = REORDER_RECOMMENDATION (2 independent
one-shot reads = transient-drift smell, consistent by construction); reorder_requests (durable workflow docs) →
Purchasing PRT-1001(ORPHAN integrity)=PURCHASING_ACTION / Inventory "Assigned work" PRT-1006=WORK_ASSIGNMENT /
Notifications PRT-1003 pending review=NOTIFICATION. A request ORIGINATES from a recommendation (buildReorder
RequestFields snapshots recommendationStatus/recommendedQty at creation) but is NEVER reconciled back (recommend
engine never reads reorder_requests; nothing retires a request when recommendation clears). CLASSIFY: 1v5=
consistent; 1/5 vs 2/3/4=LEGITIMATELY_DIFFERENT_CONCEPTS ("nothing to reorder" coexists w/ open requests); 2v3v4
=TERMINOLOGY_PROBLEM. No fixture inconsistency (demo InventoryContext unread by these 5). RECS (no universal
procurement state): terminology separation (Design-safe) · reconciliation READ projection (assess→build, not new
authority) · single shared ledger read for 1&5 · name ORPHAN integrity. doc=docs/assessments/service-inventory-
material-truth-reconciliation.md. Do NOT auto-retire requests (workflow-authority decision). IA=UX-owned.

**COMMITTED-OBLIGATION ATTENTION PROJECTION MERGED — PR #676 (squash cd0fbe4).** Owner 2nd Q: can existing
facts build an HONEST operational-attention signal (Service counterpart to Sales pre-commitment attention)?
ASSESSMENT: YES → a PURE PROJECTION over coordinatedVisit(+mission) facts, NOT a new authority (a coordinated
visit IMPLIES a committed SO in fulfillment via salesOrderId lineage; SO states CONFIRMED→IN_FULFILLMENT→
FULFILLED→CLOSED). domain/obligationAttention.js deriveObligationAttention(visit,mission?) → honest reasons
ONLY: BLOCKED|WAITING_ON_MATERIAL|PARTIAL|REMAINING_WORK|UNKNOWN + needsIntervention/watch/needsReview/satisfied
+tone; NO SLA/risk/severity/promise/ETA (unit-tested absent). Wired additively into Coordinated Visits detail
("Obligation attention" line; C713×5 blocked/material→"Waiting on material — intervention may be required").
11 node:test + 1 vitest; doc=docs/assessments/committed-obligation-attention.md. **Also fixed a PRE-EXISTING
time-fragile flake (PR #677): serviceOperationsRisk AtRiskPanel age test used un-anchored /0h since creation/
that matched live "8870h" (panel uses real Date.now); anchored \b0h.** Cross-workflow gotcha: "Equipment
compatibility UI" workflow runs the FULL vitest suite → a shared-file (index.css) PR triggers it and inherits
any suite-wide flake; merge the fix first then merge-main into the feature PR.

**COORDINATED-OPERATIONS SURFACES MERGED — PR #674 (squash 6b44e78).** Owner: expose the already-built
coordinatedVisit + coordinatedFieldMission projections as USER-CONSUMABLE surfaces (substrate for the next
C713×5 journey rerun); do NOT redesign authority. Repo-only, read-only, fail-closed, SYNTHETIC source; NO new
authority/activation/deploy/Rules. Client PURE mirrors domain/coordinatedVisit.js + coordinatedFieldMission.js
(read-side mirrors of functions/src/fulfillment TS, kept in sync) + data/coordinatedOperationsFixtures.js
(C713×5: 1 SO/5 WOs shared cust+site, 3 done+1 in-prog+1 BLOCKED w/ material blocker replenishmentConnected:
false→UNKNOWN+routed; +clean 2-unit visit; +standalone WO excluded) + access/coordinatedOperationsSource.js
(injected seam, synthetic→governed one-line swap) + hooks/useCoordinatedOperations.js. Surfaces:
modules/service/CoordinatedVisitsWorkspace.jsx (Service/Dispatch, admin/dispatcher, /service/coordinated-
visits) + modules/mobile/CoordinatedMissionView.jsx (Technician, legacyKey fieldMode→admin+technician,
/service/coordinated-mission, field density). Nav: Service Dispatch group + Technician Workspace group
(serviceNavGroups test extended; technician sees Mission NOT Visits). HONEST: partial≠complete (3/5+1 blocked),
UNKNOWN on missing evidence, Service↔Inventory blocker names part but ROUTES unconnected replenishment (no fake
ETA). Tests 8+8 node:test + 7 vitest; full suite 39 files/533 green; VISUALLY verified real browser (no
master/detail overlap 900px reusing the #672 pipeline classes, no h-scroll 400px). Own CI workflow. Design doc
+ dispatcher/technician user-guides. NO final Service IA consolidation — hand back to UX for the C713×5 journey
rerun (persona discovery now justified — a usable surface exists). See [[project_eos_design_system_and_sales]].

**RUNWAY REPO-ONLY DESIGN COMPLETE (main 71a9adf).** Full spine Opportunity→WON→Sales Order→allocate→Service
(WO, demand-lineage)→coordinated visit→coordinated field mission→billing-eligibility, all fail-closed/inert.
**REMAINING = Owner-gated or deferred:** (1) Finance/Billing/AR DOMAIN (greenfield, its own authorized
design-first cycle); (2) UI surfaces (Opportunity write-readiness, coordinated visit, field mission — need UX
return AND/OR grants+deploys for live data); (3) serialized-equipment allocation + per-unit WO fan-out (parallel
Inventory/Equipment foundation, NOT Sales: registry connect + ordered-model↔serial mapping — gates per-unit WO
fan-out + equipment allocation); (4) Commercial Coverage & Territory #15 (own assessment when My Book/commission/
account-ownership hardens); (5) all protected activation (capability grants opportunity.write/read + salesOrder.
write/fulfill/service; callable deploys; Rules deploys). Resume persona/Journey discovery once a USER-USABLE
surface exists (all runway is inert backend — no usable UI yet). Preserve #12 + #13 seams.
See [[project_eos_design_system_and_sales]], [[project_business_capability_register]], [[project_commercial_coverage_territory]].

**FINANCE/BILLING/AR DESIGN-FIRST FOUNDATION MERGED — PR #688 (main 1219375).** §13 next-after-#15. Repo
reconciled: only op→Finance handoff is the pure billingEligibility seam; Finance greenfield beyond. PURE
amounts-free foundation field-ops-app-vite/src/domain/commercialFinance.js: invoice lifecycle DRAFT→ISSUED→
SENT→(PARTIALLY_PAID⇄PAID)→|VOID (PAID/VOID terminal; canTransitionInvoice; OVERDUE derived not stored);
deriveArPosition→CURRENT/OVERDUE/PAID/VOID/UNKNOWN + factual daysOverdue (missing due date⇒UNKNOWN; NO aging
buckets=policy); invoiceCandidateFromBillingEligibility→ candidate {ref,billableQty}=fulfilled portion, NO
amount/tax, ELIGIBLE full / PARTIALLY_ELIGIBLE finalityDeferredToFinance / HELD/NOT_YET/CANCELLED⇒NONE
fail-closed. Money concepts distinct by construction (moves quantities never amounts, tested). 8 tests, own CI,
doc=docs/assessments/finance-billing-ar-authority-model.md. **MATERIAL DECISIONS RETURNED (§13, Owner/Finance
judgment): revenue recognition · tax computation · pricing→amounts source · AR aging buckets+collections
triggers · partial-billing policy · invoice numbering · credits/adjustments/refunds.** Amount-bearing Finance
work + governed persistence gated on those. No grant/deploy/Rules/amounts/persistence.

**ROADMAP STATE (all major branches at protected/UX/material boundary):** Option A remaining (avail signal P1a
+ #12) = data/protected · #15 remaining (governed persistence = protected-or-inert-repo; read/My-Book surface =
UX-owned) · Finance amount-bearing = RETURNED material decisions above · #12 Temp Equipment / #13 Tech Labor =
deferred roadmap reqs. See [[project_commercial_coverage_territory]], [[project_equipment_custody_serialized_asset]].

**FINANCE POLICY DECISIONS RATIFIED + AMOUNT-BEARING FOUNDATION MERGED — PR #690 (main 74f2aee).** Owner
cleared the Finance return point with full semantics (§1-15). Ratified: rev-rec = SEPARATE, NOT auto from
workflow (record seam, ERP may own; §14 guardrail don't block on it); tax = calc at INVOICE gen from
jurisdiction+taxable-facts+exemption/taxStatus+engine, snapshot on invoice, NO hardcoded rates, NO vendor this
cycle, insufficient⇒fail-closed/review; pricing = SO unitPrice snapshot is billing basis, NO silent re-price/NO
price book, explicit adjustments, central deterministic rounding, NO float; AR age from INVOICE DUE DATE,
daysPastDue canonical, buckets/collections = CONFIGURABLE policy (Taylor CURRENT/1-30/31-60/61-90/90+ not
hardcoded), no auto-escalation; partial billing FIRST-CLASS but ELIGIBILITY≠POLICY, default BILL_ON_COMPLETE,
PARTIALLY_ELIGIBLE visible-not-auto (protects C713×5); invoice# = trusted server PER-COMPANY sequence (not
global/SO/WO/timestamp/client), immutable, no reuse; credits/adjustments = explicit linked records (CREDIT_MEMO/
DEBIT/PAYMENT/REFUND/WRITE_OFF), never rewrite ISSUED invoice; money = integer minor units+currency NEVER float,
distinct concepts; Invoice(what billed)≠AR(what owed)≠Payment(received)≠Collections; payment 1-invoice-many-
payments; PAID≠COMMISSION (commission/#15/credit separate). AUTHORIZED repo-only/inert Finance persistence
(collections+pure command core+thin callables+capabilities active:false+client deny-all Rules+audit+trusted
reads+tests; NO grant/deploy/prod/Rules-deploy; NO client-direct financial writes) + #15 inert persistence.
#690 built: domain/money.js (integer minor units, exact arith, central roundedDiv HALF_UP, multiplyMoneyByRate,
allocateMoney largest-remainder, currency fail-closed) + financeBillingPolicy.js (BILL_ON_COMPLETE default /
BILL_AS_FULFILLED / MILESTONE / DEPOSIT; resolveBillingDecision separates fact from policy; PARTIALLY_ELIGIBLE
never auto) + financeInvoiceAmounts.js (SO unitPrice snapshot × qty, UNPRICED fail-closed, tax INJECTED else
REQUIRES_REVIEW). 21 pure tests, Finance CI extended.
**NEXT INCREMENT (ready, Rules-delicate — execute carefully w/ verify-rules-deploy): GOVERNED INERT FINANCE
PERSISTENCE.** Pattern = Opportunity/SalesOrder: functions/src/finance/ invoice command core (per-company
sequence) + thin callable; register finance.invoice.issue active:false in permissionCatalog (BOTH mirrors) +
resolveEffectivePermission.test buildDeferredForNow allowlist + permissionCatalog.test ACTIVE_DECLARING_PREFIXES
(finance.* prefix); firestore.rules deny-all `match /invoices/{id}` BOTH mirrors + RE-PIN GOVERNED_RULES_SHA256
(verifyTruckRegistryDeployment.js:30, current b99e1bea…) via `git show :firestore.rules|sha256sum` LF blob; tests
+ CI. Then payments/adjustments/AR + trusted reads. Rules MERGED≠LIVE (deploy is operator/protected). Also #15
inert persistence pending. See [[reference_ci_matrix_and_auditaction_parser]], [[feedback_emulator_rules_source_gotcha]].

**GOVERNED INERT INVOICE PERSISTENCE MERGED — PR #691 (main 717d8ff).** §13 executed w/ high-care Rules
procedure. functions/src/finance/: invoiceNumbering.ts (PER-COMPANY, tx-safe, mirrors woNumbering, reuses
`counters` doc invoices_<companyId>, never reused, canonical doc-id ≠ human number, not from SO/WO/ts/client) +
invoiceCommands.ts (PURE; trusted layer RE-COMPUTES integer-minor amounts from SO unitPrice snapshot + INJECTED
tax; fail-closed non-BILL_NOW→NOT_BILLABLE / missing price→UNPRICED / missing tax→TAX_REQUIRES_REVIEW; immutable
ISSUED, outstanding=total, dueDate carried) + invoiceCallables.ts (thin onCall issueInvoice; capability finance.
invoice.issue fail-closed; tx: allocate number+write invoice+stage AUDIT; idempotent via deterministic audit
id→replay). Governance: finance.invoice.issue active:false in permissionCatalog + resolver buildDeferredForNow +
catalog ACTIVE_DECLARING_PREFIXES "finance." + issueInvoice AuditAction (union types/access.ts + runtime
auditEventWriter mirror; server-only, omitted from frontend subset) + INVOICES_COLLECTION + index export
(EXPORT≠DEPLOY). RULES (Tier-2 high-care): deny-all `match /invoices/{invoiceId}` BOTH copies (parity verified) +
GOVERNED_RULES_SHA256 RE-PINNED b99e1bea→**784a1c8de2bd01f6f7162795a4904a79ce6fc7d42fcfad172108d45a89395b3c**
(sha256 of committed LF blob; pin-guard verifyTruckRegistryDeployment.test asserts HEAD:firestore.rules). MERGED
≠ LIVE (deploy = operator gate, NOT done). 6+5+21+41 tests; full CI incl Firestore Rules Regression emulator
(4m13s) + Truck Registry verifier (pin guard) all GREEN. **NEXT (high-care, fresh context allowed per §15):
PAYMENTS → AR position** (payments collection + applyPayment command + finance.payment.apply active:false +
deny-all Rules + RE-PIN + audit; 1-invoice→many-payments §10; outstanding = total − payments − credits + charges
§9) → adjustments/credits (CREDIT_MEMO/DEBIT/PAYMENT/REFUND/WRITE_OFF linked, never rewrite issued invoice §7) →
trusted Finance reads → #15 inert persistence. Rev-rec = seam only (§14, not EOS engine). See [[reference_ci_matrix_and_auditaction_parser]].

**GOVERNED INERT PAYMENT/AR PERSISTENCE MERGED — PR #692 (main 932f61c).** Owner payment/AR guardrail delta
honored. functions/src/finance/: paymentCommands.ts (PURE) — CASH RECEIPT (money received) SEPARATE from
PAYMENT APPLICATION (how applied); flat application facts keyed paymentId+invoiceId ⇒ schema permits 1-payment→
many-invoices/partial/unapplied-credit WITHOUT redesign (built minimum: receipt→1 invoice, 1 invoice→many
applications). OUTSTANDING = total−applied−credits+charges−writeoffs DERIVED (deriveOutstandingMinor); invoice
outstandingMinor/state = TRANSACTIONALLY-MAINTAINED PROJECTION updated in SAME tx as the application fact (no
drift, reconcilable). buildApplyPayment fail-closed: over-application (excess=future unapplied credit, not
built)/currency/already-paid/void/not-open/bad-amount. paymentCallables.ts applyPayment: capability finance.
payment.apply fail-closed; tx reads invoice + writes payments + payment_applications + updates invoice AR
projection + stages AUDIT; idempotent. Governance: finance.payment.apply active:false + resolver deferred +
applyPayment AuditAction (union+runtime, server-only) + PAYMENTS_COLLECTION/PAYMENT_APPLICATIONS_COLLECTION +
export. RULES (Tier-2 high-care): deny-all payments + payment_applications BOTH copies (parity) + RE-PIN
784a1c8d→**12a9afeabc9c247bccd5f364a87e5fe8d38ec66613ea00df312d74d1009eb90e** (committed LF blob; pin-guard
verified). MERGED≠LIVE (deploy=operator gate, NOT done). 7+11+5+21+41 tests; full CI incl Firestore Rules
Regression (4m13s) + pin guard GREEN. **NEXT (high-care, §15 allows fresh context): ADJUSTMENTS/CREDITS** — new
invoice_adjustments collection + recordAdjustment command + finance.adjustment.record active:false + deny-all
Rules + RE-PIN + audit; types CREDIT_MEMO(credits+)/DEBIT_CHARGE(charges+)/WRITE_OFF(writeoffs+) map to the
already-built derived-outstanding formula (explicit linked records, never rewrite issued invoice §7); REFUND is
payment-side (receipt reversal) — defer to a follow. Then trusted Finance reads → #15 inert persistence. Current
Finance pin = 12a9afea. See [[reference_ci_matrix_and_auditaction_parser]].

**FINANCE + #15 BACKENDS COMPLETE (governed inert) — PRs #691-#701.** Finance Billing/AR backend COMPLETE:
money model (#690) · invoice persistence issueInvoice (#691) · payment/AR applyPayment (#692) · adjustments
recordInvoiceAdjustment CREDIT_MEMO/DEBIT_CHARGE/WRITE_OFF (#693) · trusted AR read listAccountInvoiceAr (#694) ·
refund recordRefund (#701, reverses applied payment, reopens AR, distinct from credit/writeoff). #15 backend
COMPLETE: persistence createSalesTerritory/createCoverageAssignment (#695) · trusted read resolveCoverageForContext
(#697). All capabilities active:false (finance.invoice.issue/payment.apply/adjustment.record/refund.record/read +
coverage.write/read); all Admin-SDK-only collections deny-all (invoices/payments/payment_applications/invoice_
adjustments/refunds/sales_territories/commercial_coverage_assignments); **current governed rules pin = ff22df90
580ee91ead797f19c62e71c7300a0c56a56964776f783a9fde5809da**. MERGED≠LIVE everywhere (NO deploy/grant done —
operator-gated). Money = integer minor units; outstanding = total−applied−credits+charges−writeoffs DERIVED
(tx-maintained projection, not a 2nd authority); receipt≠application (1-payment→many-invoices schema-permitted);
BILL_ON_COMPLETE default; per-company invoice#. REMAINING buildable-inert: essentially none in Finance/#15
backend. REMAINING gated/UX: capability GRANTS + callable DEPLOYS + Rules DEPLOY (all protected/operator) ·
Finance AR + My-Book/coverage SURFACES (UX-owned) · precedence/credit/commission + rev-rec engine (deferred
material decisions) · Option A availability signal (P1a data/protected) · #12 Temp Equipment / #13 Tech Labor
(deferred roadmap reqs). See [[project_commercial_coverage_territory]], [[reference_ci_matrix_and_auditaction_parser]].

**2026-08-15 UPDATE (post-Wave-5 gap audit + execution package):** correction to "capability GRANTS + callable
DEPLOYS ... gated/protected" above — verified false for most of the spine. The full 11-capability sales/
fulfillment/finance spine (opportunity.*/salesOrder.*/finance.*) IS already granted in `compatibilityRoles.ts`
AND sandbox-activated in `config/environments.json`'s `capabilityActivationOverrides` (PR #970, predates this
finding) — confirmed by direct code read. What was actually missing was pure frontend wiring, not
grants/deploys: PR #987 wired the real `listAccountInvoiceAr` into a new `AccountArSection.jsx` (Account
detail); PR #988 wired the real `listOpportunityContext` into `SalesWorkspace` via `governedOpportunitySource()`
(useOpportunities rewritten to properly await an async source — a real bug caught pre-ship, sync `useMemo`
would have silently rendered permanently-empty). Opportunity WRITE side (create/transition/create-SO/allocate/
invoice) remains wired to nothing — `opportunityWriteReadiness()` still hard-coded disabled — and there is
**zero Sales Order UI anywhere in the repo** (list/detail/lifecycle screen). Full gap audit (105-row P/E/UX/E2E
matrix across Sales/WO/Inventory/Billing/Ventana/personas) delivered as `eos-gap-audit-full.md`. Top recommended
next slice: Sales spine write-side + a MINIMUM usable Sales Order workspace (not a CRM redesign) — the read-side
wiring done this pass de-risks it. Serialized-asset registry (blocks Ventana exit, RMA, Equipment serial link,
Truck stock) confirmed as the single highest-leverage true-build gap, NOT blocked by Ventana D-5 for its
foundation half (only the exit/commercial logic needs D-5). See [[project_card_composition_standardization]] for
full session detail, [[project_ventana_ice_machine_lifecycle]].

**`salesOrder.read` MERGED — PR #990 (main `0224b827`, 2026-08-14).** Owner Decision: closed the "zero Sales
Order UI anywhere" gap flagged above. New trusted read service `getSalesOrderContext` (mirrors
`opportunityReadService.ts` exactly) projects identity/account/source-Opportunity/lifecycle-state/lines(ordered/
allocated/fulfilled/billed)/service-WO-lineage; `sales_orders` stays Admin-SDK-only deny-all (no Rules widening).
Capability registered `active:false`, granted admin+dispatcher via `SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS`
(Owner inherits, technician does NOT), sandbox-activated across all 3 required mirrors. Minimum read-only
`SalesOrderDetail.jsx` shipped at `/customers/opportunities/sales-order/:salesOrderId`; Opportunity projection now
also exposes `salesOrderId` so the Opportunity→Sales Order link is visible for the first time (closes
"coordination invisibility"). All 47 CI checks green, self-merged under standing Tier-1 authority. Incidentally
fixed pre-existing test/code drift in `scripts/environmentArchitecture.test.mjs` (stale `BOOTSTRAP_ADMIN_PROJECT`
literal assertion, superseded by PR #973's stronger cross-project guard weeks earlier) — was blocking `drift-core`
CI. Sales Order write-side UX (allocation trigger, service creation, billing/invoice-issue buttons) remains the
next slice if pursued.

**VERIFIER CORRECTION MERGED — PR #991 (main `ebfda2da`).** External verifier caught that #990's projection
included `SalesOrderLineProjection.unitPrice` despite the authorized scope explicitly excluding pricing — the
frontend never rendered it, so it was pure scope creep against the read service's own "no pricing policy"
contract. Removed `unitPrice` from the projection interface + `projectLine()`; added an explicit regression
seeding a raw doc WITH `unitPrice` and asserting the projected line strips it. All CI green, self-merged.
**Current head for `salesOrder.read` = `ebfda2da`.** Not yet deployed — pooled into `wave5-sandbox-manifest.md`
for the later consolidated sandbox deploy.
