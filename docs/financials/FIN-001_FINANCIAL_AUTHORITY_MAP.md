# FIN-001 — Financial Authority & State Model Audit

**Status:** AUDIT COMPLETE — documentation only. No product source, Rules, Functions, schema,
capability, or deployment changes were made by this workstream.
**Baseline audited:** `main` @ `e007837711299a40d59dac03510a68497fdc8cb6` (2026-08-30)
**Parent register:** [FINANCIALS_AUTHORITY_AND_REPORTING_BASELINE.md](./FINANCIALS_AUTHORITY_AND_REPORTING_BASELINE.md)
(FIN-001..FIN-010 — this document is FIN-001's evidence base; FIN-001 remains OPEN until its
decisions are ratified, and nothing here implements anything.)

**Method.** Six parallel read-only audits (Sales chain; Service/Work Order; Parts/Inventory cost +
Equipment; Invoice/A-R/Payment + external accounting boundary; reporting attribution + financial
visibility; plan-vs-actual + adjustments + period/close + intercompany + audit machinery) over
tracked source, tests, both `firestore.rules` mirrors, Functions, and governance docs, with
follow-up primary-source verification of every load-bearing claim flagged uncertain. Every claim
below carries repository evidence. A missing authority is recorded as MISSING — never inferred
and never implemented.

**Classifications** (each fact gets exactly one):
`EOS_AUTHORITY` (EOS owns the fact with a governed source/write lifecycle) ·
`EXTERNAL_AUTHORITY` (another system is authoritative) · `DERIVED` (EOS calculates from
authoritative inputs) · `DISPLAY_ONLY` (EOS surfaces but neither owns nor derives) ·
`MISSING` (required but no governed authority exists) · `UNKNOWN_REQUIRES_DECISION`
(evidence exists but authority cannot be determined safely).

A recurring qualifier: **(dormant)** — the governed write/read path is fully implemented in the
repo, but its capability is registered `active:false` in `permissionCatalog.ts` (hard deny for
every principal), its collection is deny-all in both `firestore.rules` mirrors, no client UI
invokes it, and the Functions are undeployed. Dormant EOS_AUTHORITY is real architecture and
zero live behavior.

---

## FINANCIAL AUTHORITY SUMMARY

| Authority | Status |
|---|---|
| Sales price authority | **EOS_AUTHORITY (dormant)** — Sales Agreement owns committed price (`sales_agreements.lines[].unitPrice`, frozen at ACCEPTED); Sales Order freezes its copy at creation; all `salesAgreement.*`/`salesOrder.*` capabilities `active:false`, collections deny-all, undeployed |
| Sales Order total authority | **DERIVED (dormant)** — Agreement `totals.*` computed server-side (`computeAgreementTotals`), never client-supplied; deliberately NOT copied to the Sales Order (the order's money is its own lines); no stored "booked value" field exists anywhere |
| Service billing authority | **MISSING** — Work Orders carry zero monetary fields; no code path connects WO COMPLETED/CLOSED to billing; `billingEligibility.ts` derives from Sales Order lines only |
| Invoice authority | **EOS_AUTHORITY (dormant)** — `functions/src/finance/invoiceCommands.ts` + `invoiceCallables.ts`: immutable ISSUED invoices, server-recomputed amounts, SO price cross-check; `finance.invoice.issue` `active:false`, no UI trigger, undeployed; zero invoices exist |
| A/R authority | **DERIVED (dormant)** — `outstanding = total − applied − credits + charges − writeoffs` is a transactionally-maintained projection, explicitly "not an independent accounting authority"; read via `listAccountInvoiceAr` behind `finance.read` (`active:false`) |
| Payment authority | **EOS_AUTHORITY (dormant)** — cash receipt (`payments`) separated from application (`payment_applications`); over-application rejected; `finance.payment.apply` `active:false` |
| Parts cost authority | **MISSING** — no unit/standard/average/last/receiving cost anywhere; the canonical Part carries no cost by explicit ruling (`PART_INVENTORY_VALUATION_AUTHORITY_GAP`, ND-27 2026-08-30); `part_supplier_items.cost` is a supplier quote/term never linked to receipts or the ledger |
| Equipment cost authority | **MISSING** — no cost field on equipment models, serialized assets, or SO equipment lines; delivered/installed are custody states/dates, not accounting events |
| Labor cost authority | **MISSING (deliberate)** — labor domain records hours only (`work_order_labor_entries.durationMinutes`); rate/cost/billable fields test-asserted absent; recording capability itself `active:false` |
| Gross margin authority | **GROSS_MARGIN_AUTHORITY = MISSING** — governed revenue-side price exists (dormant); no governed cost side exists at all; the repo's own metadata layer refuses to synthesize a valuation and states there is "no basis on which one could be computed" |
| Goal authority | **MISSING** — no storage, no capability, no field, anywhere |
| Budget authority | **MISSING** — same |
| Forecast authority | **MISSING** — `FinancialForecastSection`/`financialForecastHorizons.js` are definitions-only display seams that structurally cannot render a figure (`forecastHorizonView` coerces any metrics state back to "not connected"); Opportunity `expectedValue` is a forecast number, explicitly never a price and never flowing downstream |
| Company attribution | **MISSING (authority registered, unstamped)** — `operating_companies` (`taylor`/`ventana`) authority exists and is explicitly INERT; **no transactional record stores `operatingCompanyId` today** (census 2026-08-30: 0 of 1,323 ownable records); the Opportunity→Sales Order conversion drops it (verified: neither `closeOpportunityAsWon.ts:280` nor `createSalesOrderFromOpportunity.ts:194` passes `operatingCompanyId`/`inheritedOperatingCompanyId`); invoice `companyId` is an ungoverned numbering key, not this authority |
| Business unit attribution | **MISSING** — no `businessUnit` concept exists anywhere in client or Functions source |
| Person attribution | **MISSING for sales credit / PRESENT_GOVERNED for ownership** — `ownerEmployeeId` (snapshotted at creation, D-1/D-4) exists on the sales chain, but the repo's own governance forbids reading it as credited salesperson; no `creditedSalespersonId`/`salespersonId`/commission field exists (commission "intentionally deferred policy", SYSTEM_AUTHORITIES row 76) |
| Financial visibility governance | **MISSING (coarse single-boolean only)** — one read id, `finance.read` (`active:false`), covers invoices+payments+adjustments+refunds identically for ten governed roles; `listAccountInvoiceAr` serves ANY caller-supplied accountId once granted; no SELF/TEAM/BUSINESS_UNIT/OPERATING_COMPANY scoping exists; `hierarchicalVisibility.ts` is built and tested but has ZERO consumers |
| Period/close governance | **MISSING** — no fiscal year/period/close/lock/late-posting/prior-period concept in code; transaction dates are per-document calendar dates; no point-in-time AR snapshots |
| Intercompany financial governance | **MISSING (and partially foreclosed)** — Owner ruling D-3 models Ventana as an upstream SUPPLIER, not a cross-franchise peer; no intercompany charge/elimination/cross-company AR-AP record type exists; inventory `operatingCompanyId` owner-tags (matrix-designed, unstamped) are custody, not financial treatment |
| External accounting authority | **EXTERNAL_ACCOUNTING_SYSTEM = NOT YET ESTABLISHED** — no accounting system named, connected, or scheduled anywhere; `IntegrationArchitecture.md` defines the boundary pattern only; whether EOS's dormant finance ledger becomes the "governed local ledger" authority (ADR-BMF-012) or an external system is connected is FIN-001's central open decision |

**Classification counts** (59 facts in the matrix below):
EOS_AUTHORITY **20** (of which 15 dormant) · EXTERNAL_AUTHORITY **0** (none established) ·
DERIVED **7** · DISPLAY_ONLY **3** · MISSING **25** · UNKNOWN_REQUIRES_DECISION **4**.

---

## 1. Authority matrix

Column key — **Class**: classification (+d = dormant). **Write**: governed writer (all writers are
Admin-SDK trusted callables unless noted; "—" = no writer exists). **Immutable**: when history
becomes fixed. Shared answers stated once per domain block to keep rows readable; the domain
notes below each table carry the remaining required per-fact record content (read path, currency,
attribution, period/date authority, visibility, audit, reconciliation).

### 1.1 Sales domain (Opportunity → Sales Agreement → Sales Order)

Collections `opportunities` / `sales_agreements` / `sales_orders`: all deny-all in both Rules
mirrors (`firestore.rules:1746-1748, 1800-1802, 1755-1757`); all capabilities `active:false`
(`permissionCatalog.ts:154-270`); undeployed. Currency: hard-coded `"USD"` server-side on
Agreement (`salesAgreementCommands.ts:266`) and Sales Order (`salesOrderCommands.ts:227`), never
caller-settable; all committed money is integer minor units (`money.js` discipline). Audit: every
create/transition/accept stages an append-only `auditEvents` event via the single central writer.
Reconciliation: none (no external seam). Visibility: coarse per-object read capabilities
(`opportunity.read`, `salesAgreement.read`, `salesOrder.read`), all `active:false`, no scoping.

| Fact | Storage / fields | Class | Write path | Immutable point | Evidence |
|---|---|---|---|---|---|
| Quoted/expected value | `opportunities.expectedValue` (plain number, NO currency field) | DISPLAY_ONLY | `buildCreateOpportunity` / `buildUpdateOpportunity` (open only) | Frozen when Opportunity closes (WON/LOST terminal) | `opportunityCommands.ts:170,312-318,265-267`; never flows downstream (`agreementToSalesOrder.ts:15-27` — "NO fallback to Opportunity lines, and none to expectedValue") |
| Negotiated unit price | `sales_agreements.lines[].unitPrice` (minor units) | EOS_AUTHORITY +d | `buildCreateSalesAgreement` / `buildUpdateSalesAgreementDraft` (DRAFT only) | **ACCEPTED** — `buildAcceptSalesAgreement` is the pricing-completeness gate (`UNPRICED_LINE` refusal); draft editing structurally refused post-DRAFT; no amendment path exists | `salesAgreementCommands.ts:288-311,419-491,424-429`; SYSTEM_AUTHORITIES row 80 ("THIS OBJECT OWNS COMMITTED PRICE") |
| Quantity (agreement/order lines) | `lines[].quantity` / `lines[].orderedQty` | EOS_AUTHORITY +d | same commands; SO quantities monotonic `ordered ≥ allocated ≥ fulfilled ≥ 0` | ACCEPTED (agreement) / creation (order) | `salesAgreementCommands.ts:163`; `salesOrderCommands.ts:5` |
| Line extended / subtotal / total / balance | `sales_agreements.totals.*` | DERIVED | `computeAgreementTotals` — never client-supplied; null-propagates while unpriced (never fabricated) | ACCEPTED | `salesAgreementCommands.ts:185-206,181-183,367-369` |
| Freight/shipping charge | `sales_agreements.totals.shippingMinor` | EOS_AUTHORITY +d (supplied) | agreement create/draft-edit | ACCEPTED; **deliberately not copied to Sales Order** (reachable via `sourceAgreementId` only) | `salesAgreementCommands.ts:169,194`; `agreementToSalesOrder.ts:125-138` |
| Installation charge | `totals.installChargeMinor` | EOS_AUTHORITY +d (supplied) | same | same | `salesAgreementCommands.ts:170,195` |
| Tax (agreement) | `totals.taxMinor` — supplied, "not a tax engine" | EOS_AUTHORITY +d (injected) | same | ACCEPTED | `salesAgreementCommands.ts:171,196,25` |
| Deposit / down payment | `totals.downPaymentMinor` | EOS_AUTHORITY +d (supplied) | same | ACCEPTED | `salesAgreementCommands.ts:172,197` |
| Trade-in | `totals.tradeInMinor` | EOS_AUTHORITY +d (supplied) | same | ACCEPTED | `salesAgreementCommands.ts:173,198` |
| Committed order price | `sales_orders.lines[].unitPrice` (minor units) | EOS_AUTHORITY +d | `buildCreateSalesOrder` — direct callable, or derived from ACCEPTED Agreement via `deriveSalesOrderLinesFromAgreement`; `requireCompletePricing` refuses unpriced lines; **never defaulted to zero** | **Creation** — direct-to-CONFIRMED; no update command for lines exists (`buildTransitionPatch` writes state only); invoicing then rejects any `PRICE_MISMATCH` | `salesOrderCommands.ts:207-238,158-161,170-180,253-273`; `invoiceCommands.ts:112-113` |
| Discount (sales chain) | none on Agreement/Order lines — discounting only via negotiated `unitPrice` or at invoice time | MISSING (chain) / EOS_AUTHORITY +d (invoice `discountMinor`) | invoice issuance only | invoice ISSUED | `invoiceCommands.ts:35,194-202` |
| Booked value | no field named/exposed as booked anywhere | MISSING | — | — | baseline doc lists "booked" as required basis; closest analog = SO committed lines at CONFIRMED, unlabelled |
| Commission | none | MISSING (explicitly deferred) | — | — | SYSTEM_AUTHORITIES row 76: "credit / commission are intentionally deferred policy — not implemented" |
| Cost / margin (sales chain) | none on any of the three objects | MISSING | — | — | FIN-006 OPEN; see §1.3 |

**Lifecycle (verified as implemented):** Opportunity (no prices; WON requires qty on every line;
WON/LOST terminal) → Sales Agreement DRAFT (priced via allowlisted draft edits) → **ACCEPTED**
(pricing-completeness gate; terminal) → Sales Order (two governed conversion paths —
`createSalesOrderFromOpportunity.ts:109-275` and the atomic `closeOpportunityAsWon.ts:114-375` —
both requiring WON + `assertAgreementConvertible` (same opportunity/account, state ACCEPTED, has
lines), deduped to at most one order per Opportunity, with backlinks written in the same
transaction). **Price becomes historical at Agreement ACCEPTED, and again (as an independent
frozen copy) at Sales Order creation.**

**Attribution on the sales chain:** `accountId` PRESENT_GOVERNED (immutable on Agreement/Order;
mutable on open Opportunity). `ownerEmployeeId` PRESENT_GOVERNED, copied-not-followed at
conversion (D-1/D-4). `operatingCompanyId` — field exists on Opportunity and Sales Order schemas,
resolver `resolveCommercialCompanyScope` is explicit-or-inherited-never-inferred (Ruling R-14)
with NO production default; **but neither conversion call site passes it** (verified directly:
`closeOpportunityAsWon.ts:280` and `createSalesOrderFromOpportunity.ts:194` pass neither
`operatingCompanyId` nor `inheritedOperatingCompanyId`, and `inheritedOperatingCompanyId` has
zero callers repo-wide), the Sales Agreement schema carries no such field at all, and
`salesOrderReadService.ts:16` deliberately does not project it. Census: zero records carry an
operating-company fact. **Business unit: MISSING** (no concept; `salesChannel` is a different
axis). **Sales Order transaction date: MISSING as a usable fact** — named defect
`SALES_ORDER_HAS_NO_USABLE_TIMESTAMP` (`salesOrder.js:261-280`: write path stores Timestamps,
read projection reads `*Millis` field names nothing writes; both project null).

### 1.2 Service domain (Work Order / labor / parts usage)

`fieldops_wos` denies all direct client writes (`firestore.rules:476-480`);
`work_order_labor_entries` has no Rules match block (deny-all by default). Currency: none — the
Work Order carries no monetary field of any kind (confirmed field-by-field;
also the metrics framework's own §20 verification). Audit: transitions, labor record/correct,
execution-data updates all stage `auditEvents`. Reconciliation: none.

| Fact | Storage / fields | Class | Write path | Op vs financial | Evidence |
|---|---|---|---|---|---|
| Labor hours | `work_order_labor_entries.durationMinutes` + `laborType` (ONSITE/TRAVEL) | EOS_AUTHORITY +d | `recordWorkOrderLabor`/`correctWorkOrderLabor` callables — capabilities `workOrder.labor.record`/`.correct` **`active:false`, carried by no Role** | OPERATIONAL — "WORK PERFORMED recorded here / BILLABLE LABOR not here / LABOR COST not here"; append-only, correction-by-reversal | `workOrderLaborCommand.ts:12-24,46,536-542`; `laborCallables.ts:11,138,155`; technician-labor-domain-v1.md §2 (test asserts rate/cost/billable fields absent) |
| Labor hours rollup | derived `projectWorkOrderLabor()` (total/onsite/travel minutes) | DERIVED | read-time only, never persisted | OPERATIONAL | `workOrderLaborCommand.ts:570-585`; `WorkOrder.laborHours` is declared-unwritten and must not become truth |
| Labor rate / labor cost / billable labor | none | MISSING (deliberate) | — | financial layer "will derive its own facts" — unbuilt | `workOrderLaborCommand.ts:22`; forbidden-field test |
| Parts used (qty) | `fieldops_wos.inventorySnapshot[].qtyUsed` | EOS_AUTHORITY | `updateWorkOrderExecutionData` — assigned technician only, blocked once terminal | OPERATIONAL quantity; no cost/price attached anywhere in the path | `updateWorkOrderExecutionData.ts:94,127,132,149-157` |
| Parts planned (qty) | `inventorySnapshot[].qtyPlanned` | EOS_AUTHORITY | `setWorkOrderPartsPlan` | OPERATIONAL | `types/workOrder.ts:180-182` |
| Parts sold price / part cost on WO | none | MISSING | — | — | no field on `InventorySnapshotItem`; cascades from §1.3 cost gap |
| Trip/service charges, freight, subcontractor, goodwill, internal/no-charge | none | MISSING | — | subcontractor explicitly scoped out with "UNKNOWN — not zero" doctrine | technician-labor-domain-v1.md §12; grep-verified absent |
| Warranty | `fieldops_wos.type == "WARRANTY"` (a WorkOrderType value) | EOS_AUTHORITY (categorization) | `createWorkOrder`, immutable after | OPERATIONAL type; warranty **cost** MISSING | `types/workOrder.ts:41` |
| Callback/rework | none | MISSING (documented non-decision) | — | — | `workOrderLaborCommand.ts:60-64` ("deliberately absent") |
| Billable-completion state | none — `COMPLETED`/`CLOSED` are lifecycle-only | MISSING | — | **No code anywhere reads `fieldops_wos.status` to gate or drive invoicing** | `transitionEngine.ts:47-49,77-78`; zero `workOrder` refs in `functions/src/finance/*` (grep) |
| Invoice readiness | `computeBillingEligibility` → NOT_YET/PARTIALLY_ELIGIBLE/ELIGIBLE/HELD/CANCELLED | DERIVED | pure function over **Sales Order** state + per-line fulfilled/ordered + hold flags — zero Work Order references | "invents NO invoice, NO amount"; Finance domain owns processing | `fulfillment/billingEligibility.ts:6-9` |

**Load-bearing negative finding:** a Work Order being COMPLETE is not, and must never be read as,
BILLED — no repository evidence connects them. **Attribution:** `customerId` PRESENT_GOVERNED
(create-only, live reference not snapshot); `assignedTechId` mutable-by-design (assignment, not
ownership — UNSAFE_TO_INFER as either credit or responsibility); `operatingCompanyId`/
`businessUnit` MISSING (ownership matrix reclassified WO to COMPANY-owned, D-13 — designed,
unstamped); labor-entry `technicianId` server-resolved from the caller, never payload-supplied.
**Lineage:** a Sales-Order-originated WO carries `salesOrderId` (stamped by
`createServiceForSalesOrder.ts:221`, C7 demand-lineage invariant); ad-hoc WOs carry none.
**Period/date:** `createdAt` only; completion/close timestamps are lifecycle facts, not
accounting dates.

### 1.3 Parts / Inventory cost

| Fact | Storage / fields | Class | Evidence |
|---|---|---|---|
| Unit acquisition cost (Part) | none — "Deliberately absent: … supplierCost, purchasePrice" | MISSING | `partMaster/types.ts:91-94` |
| Supplier quoted cost/terms | `part_supplier_items.cost` (+currency) — supplier-item grain, at most one ACTIVE preferred per part | EOS_AUTHORITY (quote/term only — **not** a landed/receipt cost; linked to nothing downstream) | `partSupplierItems.ts:326-348,392-403`; SYSTEM_AUTHORITIES row 57 ("cost/terms authority — NEVER on the Part core") |
| Standard / last / average cost | none | MISSING | grep-verified; no computation in ledger/analytics/reconciliation services |
| Sales/list price (Part) | none — `unitCost` and `sellPrice` metadata fields BLOCKED (`displayable:false, reportable:false, exportable:false`) | MISSING | `metadata/definitions/part.js:338-361`; selling price assigned to a "future pricing / price-book authority" (`inventory-parts-authority-contract.md`) |
| Receiving/receipt cost | none — `ReceivingLineValue` carries no price field of any kind; even `purchaseOrderNormalization.ts` strips price down to `{lineId, partId, quantity}` | MISSING | `receivingTypes.ts:73-89`; `purchasing/purchaseOrderNormalization.ts:38-42,140-158` |
| Transfer value | none — transfer module carries quantities/locations only | MISSING | `inventoryTransfer/*` (zero cost tokens) |
| Serialized asset cost | none — `VALUE_FIELDS` allowlist fail-closed rejects unknown fields | MISSING | `serializedAsset/types.ts:69-76,109` |
| Inventory valuation | none — **explicitly refused**: "There is no inventory value to display and no basis on which one could be computed"; refuses qty × supplier-quote shortcut; "A valuation basis is a policy decision, not a column" | MISSING | `PART_INVENTORY_VALUATION_AUTHORITY_GAP`, `part.js:474-489`; mirrored `partsNorthStar.js:29-30` (ND-27, Owner, 2026-08-30) |
| Freight allocation | none — D-6: "separate fields/processes, not lifecycle gates" (deferred, unbuilt) | MISSING | `DECISIONS.md:1244`; `purchase-order-structured-list.md:43` |
| Epic-5 procurement price layer | `purchase_orders.items[].unitPrice` / `.totalCost` — written by `procurementService.ts` but never consulted by receiving, ledger, or valuation; canonical collection had 0 documents (measured 2026-08-24); live `reorder_purchase_orders` carries **no money field at all** | UNKNOWN_REQUIRES_DECISION (future cost basis, or orphaned scaffolding?) | `procurementService.ts:34,50-51,71`; `purchaseOrder.js:250-299` (`PURCHASE_ORDER_MONEY_LIVES_ON_A_DIFFERENT_COLLECTION`, `…CANONICAL_COLLECTION_IS_EMPTY`) |
| Cycle-count valuation | none — quantities only | MISSING | `cycleCountMateriality.ts` (no cost multiplier) |

**GROSS_MARGIN_AUTHORITY = MISSING.** Revenue side is governed (dormant SO `unitPrice`); cost
side has no receipt-time capture, no costing method, no valuation basis, no freight allocation,
and no linkage from the one real cost field (`part_supplier_items.cost`) to any actual event.
Any margin figure computed today would borrow a non-authoritative cost — the exact shortcut the
repo's own metadata layer refuses (ND-27). Do not approximate.

### 1.4 Equipment

| Fact | Status | Class | Evidence |
|---|---|---|---|
| Equipment sales price | SO `EQUIPMENT_MODEL` line `unitPrice` (product-model ref only; serialized-asset ref FORBIDDEN at order time) | EOS_AUTHORITY +d (revenue) | `salesOrderLifecycle.ts:12`; `salesOrderCommands.ts:52,57,143-178` |
| Equipment cost | none on models, serialized assets, or SO lines | MISSING | `equipmentModel.ts:7` (MODEL_FIELDS has no money field); `serializedAsset/types.ts` |
| Freight / installation cost / commission | none | MISSING (commission explicitly deferred) | D-6; `installSerializedAssetCommand.ts:148-151` (ALLOWED_KEYS carries no money); SYSTEM_AUTHORITIES row 76 |
| Delivered date | no stored date — `DELIVERED` is a serialized-asset lifecycle STATE ("physically at the customer, not yet linked") | DISPLAY_ONLY (state, not a governed business date) | `serializedAsset/types.ts:53`; `installSerializedAssetCommand.ts:56,66` |
| Installed date | `installedDate` — governed custody/audit date, permission-gated read, reportable | EOS_AUTHORITY (operational/custody fact — NOT revenue recognition) | `installSerializedAssetCommand.ts:163,186-198,319`; `equipment-installation-recording-policy.md` |
| Revenue-recognition proxy | none — `FULFILLED→CLOSED` has **no payment/acceptance gate today** (open Owner gate D-5); no `revenueRecognizedDate`/`bookedDate` field exists | UNKNOWN_REQUIRES_DECISION (recognition point is an unresolved Owner decision, not implemented policy) | `DECISIONS.md:1232` (D-5, "load-bearing"); no repo authority claims install/delivery = recognition |

### 1.5 Invoice / A-R / Payment (the dormant finance ledger)

Collections `invoices` / `payments` / `payment_applications` / `invoice_adjustments` / `refunds`:
all deny-all both mirrors (`firestore.rules:1809-1851`), Admin-SDK-only. Capabilities
`finance.invoice.issue` / `finance.payment.apply` / `finance.adjustment.record` /
`finance.refund.record` / `finance.read`: **all `active:false`** (`permissionCatalog.ts:277-337`)
— "hard DENY for everyone until a separate Owner grant". **No client UI invokes any finance write
callable** (grep: zero call sites). Functions undeployed (EXPORT ≠ DEPLOY). **Zero invoices,
payments, adjustments, or refunds exist as live data.** Money: integer minor units + currency
throughout, guard-validated. Audit: every mutation stages an append-only `auditEvents` event in
the same transaction, idempotent via deterministic ids. Reconciliation: none — no external seam.

| Fact | Storage / fields | Class | Write path & key invariants | Immutable point | Evidence |
|---|---|---|---|---|---|
| Issued invoice (subtotal/discount/tax/total, lines) | `invoices.*Minor`, `lines[]` | EOS_AUTHORITY +d | `issueInvoice` — amounts recomputed server-side from the SO price snapshot + injected tax determination (absent tax ⇒ `TAX_REQUIRES_REVIEW`, issuance refused); `verifySalesOrderMatch` enforces account/currency/per-line price match and caps `billableQty` at `min(ordered, fulfilled) − billed`; per-company sequence via `invoiceNumbering.ts` inside the transaction | **ISSUED** — original amounts never touched by any later command | `invoiceCommands.ts:81-124,150-228,225`; `invoiceCallables.ts:45-102` |
| Billable quantity | derived `min(orderedQty, fulfilledQty) − billedQty` | DERIVED | pure recomputation at issuance + `billingEligibility.ts` | recomputed on demand | `invoiceCommands.ts:71-79` |
| Payment (cash receipt) | `payments` | EOS_AUTHORITY +d | `applyPayment` — receipt separated from application; over-application rejected; currency must match; VOID/PAID refused | each payment event immutable; reversals are new events | `paymentCommands.ts:1-9,61-63,109-112`; `paymentCallables.ts:62-117` |
| Payment application | `payment_applications` | EOS_AUTHORITY +d | same transaction as receipt + invoice AR patch ("no drift") | same | same |
| Outstanding / AR position | `outstandingMinor` = `total − applied − credits + charges − writeoffs`; `arPosition` CURRENT/OVERDUE/SETTLED/VOID/UNKNOWN | DERIVED — "a transactionally-maintained projection, not an independent accounting authority"; read side re-derives fresh, never trusting the stored balance | maintained per event | `paymentCommands.ts:61-63`; `financeReadProjection.ts:25-27,34-41,62-81`; SYSTEM_AUTHORITIES row 71 |
| Credit memo / debit charge / write-off | `invoice_adjustments` (`ADJUSTMENT_TYPES`) | EOS_AUTHORITY +d | `recordInvoiceAdjustment` — reason REQUIRED; credit & write-off capped at outstanding; a write-off never flips state to PAID; the issued invoice is never rewritten | each adjustment immutable once recorded | `adjustmentCommands.ts:1-8,72,87-91` |
| Refund | `refunds` | EOS_AUTHORITY +d | `recordRefund` — reverses applied payment (≤ applied), reopens AR; distinct from credit/write-off | immutable; corrections are new events | `refundCommands.ts:63,71,74` |
| Aging | `daysOverdue` derived from outstanding + `dueDate` + now | DERIVED | read-time only | — | `financeReadProjection.ts:34-41` |
| Account AR read | `listAccountInvoiceAr` → `useAccountAr` → `accountArView.js` → `AccountArSection` | DERIVED +d | the ONLY client-wired finance path; bounded `limit+1` fetch (truncation ⇒ `unavailable`, never a false empty); per-currency buckets never summed; UI states LOADING/DENIED/UNAVAILABLE/EMPTY/READY (denial shown as "Not available to you", never as empty) | — | `financeReadCallables.ts:45-74`; `accountArView.js:16-22,95-130,105-107`; `summarizeAccountAr` |
| Customer financial balance / statement | none beyond the per-invoice AR projection | MISSING | — | — | no account-grain balance authority exists |
| Historical AR snapshots (as-of/month-end) | none — `outstandingMinor` is live current-state; no period-close snapshot mechanism | UNKNOWN_REQUIRES_DECISION (write model is append-only/audit-friendly if activated; whether as-of snapshots are required is a FIN-008 design question) | — | — | agent finding A9; FIN-008 OPEN |
| Financial Summary / Forecast / Credit (account page) | `financialSummaryView.js` / `financialForecastHorizons.js` / sections | DISPLAY_ONLY | no write; provider states `UNCONFIGURED/ERROR/STALE/PARTIAL/COMPLETE` defined, **only `unconfigured` reachable in production**; `forecastHorizonView` structurally coerces any metrics state back to "Sales data source not connected"; sections don't even mount unless `financialProviderConfigured` (no caller passes true) | — | `financialSummaryView.js:1-24,43`; `financialForecastHorizons.js:10-22,118-125`; `AccountFinancialsSection.jsx:27-46` |
| Invoice document provenance (who acted) | none — "NO createdBy, NO updatedBy, ANYWHERE ON THIS DOCUMENT" (named gap); actor lives in the audit event, salesperson only via SO lineage | MISSING (on-document) / DERIVED (via `auditEvents` + lineage) | — | — | `invoice.js:71-82`; D-15 |
| Invoice `companyId` | caller-supplied numbering-sequence key; validated non-empty only; **never cross-checked against `operating_companies`** | UNKNOWN_REQUIRES_DECISION (decoy — must not be read as the governed company authority) | `issueInvoice` input | — | `invoiceCommands.ts:40,153,176,213`; `invoiceNumbering.ts:42-51` |

### 1.6 Plan vs actual (goals / budgets / forecasts)

No governed authority, storage, capability, or field exists for: sales goals, service revenue
goals, employee/team/company goals, cost budgets of any kind (department/labor/parts/vehicle/
subcontractor), or forecast values. All **MISSING** — verified by collection registry
(`constants/collections.ts`), Rules, capability catalog, and grep; this is the documented
expected state (FIN-003/FIN-005 OPEN). The only "forecast"-named surfaces are the DISPLAY_ONLY
account-page seams (§1.5) and Opportunity `expectedValue` (§1.1). The eventual required
distinction — **ACTUAL ≠ FORECAST ≠ BUDGET ≠ GOAL ≠ RECONCILED_ACCOUNTING_FACT** — is recorded
in the baseline doc and the metrics framework; nothing may blend them when they are built.

---

## 2. Reporting attribution grades

Grades: PRESENT_GOVERNED / PRESENT_BUT_MUTABLE / DERIVABLE / MISSING / UNSAFE_TO_INFER.
(Prohibited inferences honored throughout: location names ≠ Taylor/Ventana; current
Customer.owner ≠ historical sales attribution; ownerId ≠ credited salesperson; route/domain ≠
business unit.)

| Record type | operatingCompanyId | businessUnitId | creditedSalesperson | responsibleEmployee | customer/account | source lineage | transactionDate | currency |
|---|---|---|---|---|---|---|---|---|
| Opportunity | MISSING | MISSING | MISSING | PRESENT_GOVERNED (`ownerEmployeeId` = ownership, not credit) | PRESENT_GOVERNED | PRESENT_GOVERNED (forward) | MISSING (only createdAt/forecast close) | MISSING (`expectedValue` has no currency) |
| Sales Agreement | MISSING (no field on schema) | MISSING | MISSING | PRESENT_GOVERNED | PRESENT_GOVERNED (immutable, server-derived) | PRESENT_GOVERNED | PRESENT_GOVERNED (`acceptedAtMillis`, server-stamped) | PRESENT_GOVERNED |
| Sales Order | MISSING (schema field exists; conversion never populates; not read-projected) | MISSING | MISSING | PRESENT_GOVERNED (inherited D-4, copied-not-followed) | PRESENT_GOVERNED | PRESENT_GOVERNED (`sourceOpportunityId`/`sourceAgreementId`) | **MISSING — named defect** (`SALES_ORDER_HAS_NO_USABLE_TIMESTAMP`) | PRESENT_GOVERNED (value itself unvalidated free text) |
| Work Order | MISSING (D-13 designed COMPANY-owned, unstamped) | MISSING | MISSING | MISSING (`assignedTechId` = assignment; UNSAFE_TO_INFER) | PRESENT_GOVERNED | PRESENT_GOVERNED for SO-originated (`salesOrderId` stamped); absent on ad-hoc | PRESENT_GOVERNED (createdAt only) | MISSING (by design — no money) |
| Inventory ledger | MISSING (matrix-designed from warehouse; 8 records cross-company-ambiguous) | MISSING | N/A | PARTIAL (operational-shape `actor`, undeclared to metadata) | N/A | PARTIAL (legacy `workOrderId` declared; operational `sourceObject` struct undeclared) | PRESENT_GOVERNED but split across two incompatible shapes (`timestamp` vs `occurredAt`/`recordedAt`) | MISSING (by design — unit counts) |
| Purchase Order (live `reorder_purchase_orders`) | MISSING (named gap: multi-line PO may mix companies — "no single business line even in principle") | MISSING | MISSING (named gap: no buyer field; repo refuses createdBy backfill) | MISSING | N/A | PRESENT_GOVERNED (1:1 `reorderRequestId`) | PRESENT_GOVERNED (immutable `createdAt`) | MISSING (no money field at all on the live PO) |
| Invoice / AR | UNSAFE_TO_INFER (`companyId` decoy — ungoverned numbering key) | MISSING | MISSING (via lineage only, by D-15 design) | MISSING (no on-document actor) | PRESENT_GOVERNED | PRESENT_GOVERNED (SO cross-checked) | PRESENT_GOVERNED (`issuedAt` + `dueDate` — strongest of any record) | PRESENT_GOVERNED (best-governed money model) |

**Bottom line:** no transactional record in the repository carries a working operating-company
fact (census 2026-08-30: 0/1,323); `businessUnitId` and `creditedSalespersonId` do not exist as
concepts; the only person field is ownership, which governance forbids reading as sales credit.
FIN-002's attribution spine (**Company → Business Unit → Responsible/Credited Person →
Financial Event**) currently has, at best, one of its four links (person-as-owner) and that one
only on the dormant sales chain. Employee records carry no team/manager/business-unit structure
(`roleHierarchy.ts:9-16` — org tree lives on Role placement; `reportsTo` deliberately unmodeled).
`isNationalAccount` appears nowhere; `salesChannel` is the adjacent-but-different per-transaction
axis — UNKNOWN_REQUIRES_DECISION whether a distinct flag is intended.

---

## 3. Financial visibility audit

**Current mechanism, in full:**
- `ROLE_NAV_ACCESS` (legacy 3-role nav map) contains no financial concept and gates nothing financial.
- Exactly **five** finance capability ids exist: four writes + **one read** (`finance.read`)
  covering invoices+payments+adjustments+refunds together. All five `active:false`.
- `governedBusinessRoles.ts` grants `finance.read` identically to ten roles (Salesperson through
  Controller) — the same single boolean regardless of role.
- `listAccountInvoiceAr` authorizes on that one boolean and then serves **any caller-supplied
  `accountId`** — no self/team/BU/company check exists on the callable
  (`financeReadCallables.ts:23-33,65-73`). `salesOrder.read` follows the identical pattern.
- Firestore Rules deny-all on every financial collection — strong containment; the coarse
  callables are the only client path (no Rules-level bypass exists).
- `AccountFinancialsSection` gates on the single `finance.read` — the metadata layer itself
  documents the one-boolean-for-two-authority-levels defect (`accountPageComponents.js:90-108`).
- Report builder: no financial object is reachable — Invoice deliberately absent (deferred wave
  6), Sales Order not even a stub, the `financial` sensitivity class has zero populated fields,
  and only the Owner role holds any `report.*` capability.
- `hierarchicalVisibility.ts` (`visibleRoleIdsFor`/`visibleEmployeeIdsFor`/
  `canSeeEmployeeRecords`) is built and unit-tested — and **imported by no runtime code**
  (verified: zero consumers in `functions/src`). Team-scoped visibility machinery exists,
  wired to nothing.
- Leak check (dashboards/exports/search/notifications): no leakage found in the surfaces
  examined; a negative finding, not a guarantee (helper-formatted renders would evade a
  field-name grep).

**No current mechanism distinguishes** revenue vs cost vs margin vs budget vs goal vs forecast
vs A/R vs payments vs employee-performance vs company-wide vs consolidated — for most of these
because the underlying data model does not exist to gate.

**Gap table vs the approved future scopes** (design inputs for FIN-004 — NOT implemented here):

| Future scope | Exists today? | Evidence |
|---|---|---|
| SELF | Not supported — no scope parameter on any finance/sales read; `resolveEffectiveAccess` returns flat booleans | `financeReadCallables.ts:65-73` |
| TEAM | Not supported — no team/manager on Employee; `hierarchicalVisibility.ts` built but consumed by nothing | `roleHierarchy.ts:9-16`; zero-consumer grep |
| BUSINESS_UNIT | Not supported — the dimension itself does not exist | §2 |
| OPERATING_COMPANY | Not supported — no stamped fact to filter by even if a scope were added | §2 census |
| CONSOLIDATED | **This is what `finance.read` already grants** once activated — any account, no narrower option; the only scope the system can express is the widest one | `financeReadCallables.ts:69-73` |

**Invariant restated (baseline doc E):** visibility must follow the number everywhere — a
principal denied a fact in Financials must not receive it via Sales Order, Agreement, Customer,
Work Order, dashboards, reports, exports, APIs, search, or notifications. Today this holds
mostly *vacuously* (everything financial is denied to everyone); FIN-004 must make it hold
substantively.

---

## 4. Approval / adjustment governance

| Mechanism | Status | Who / threshold / reason / audit / immutability |
|---|---|---|
| Credit memo / debit charge / write-off | BUILT, governed, **dormant** | Capability `finance.adjustment.record` (`active:false`); **no amount threshold, no second approver**; reason REQUIRED (refused empty); audited in-transaction; issued invoice never rewritten |
| Refund | BUILT, governed, **dormant** | `finance.refund.record` (`active:false`); same posture; capped at applied amount |
| Discount approval / price override | **MISSING** — `discountMinor` is shape-validated only; `governedBusinessRoles.ts:277,332,577` records the caveat verbatim: "there is no approval-limit or discount-authority" check behind `salesAgreement.accept` | — |
| Goal / budget revision | MISSING (no goals/budgets exist) | — |
| Sales-credit reassignment / company-attribution correction | **DESIGNED, INERT** — `ownershipHandoffCommand.ts` (OWNERSHIP_HANDOFF event: previous/new owner, reason, source enum incl. ADMIN_CORRECTION; refuses IMMUTABLE families and cascades) is not exported from `index.ts` and stages-never-commits | — |
| Period correction | MISSING (no period model) | — |
| General audit machinery | `auditEvents` — single central writer, closed AuditAction allow-list, append-only (`.set()` on fresh/deterministic ids only; "no code path… mutates an existing Audit Event"), staged atomically with the business mutation, client deny-all | `auditEventWriter.ts:18-30,69-233,573,608-645`; `firestore.rules:1698` |

---

## 5. Period / close

**MISSING in full.** No fiscal year, fiscal period, month close, locked period, late-posting
rule, prior-period adjustment, or accounting-close status exists anywhere in code (grep: zero
hits for fiscal/period-close/lock constructs in `functions/`). Invoice `dueDate` and
adjustment/refund `effectiveDate` are calendar dates on individual transactions with no
lock/close check reading them. The metrics framework names "fiscal calendar" only as a
tenant-configurable open question. Calendar dates are not governed accounting periods and this
audit does not equate them. (FIN-008 OPEN.)

---

## 6. Intercompany

- Operating companies `taylor`/`ventana` are governed ids (`operatingCompanyAuthority.ts:21-50`)
  — authority INERT, collection unseeded in production, nothing reads or enforces it.
- `commercialCompanyScope.ts` defines the intended chain propagation (Opportunity → Agreement →
  Sales Order → Invoice → Payment/Adjustment/Refund; explicit-or-inherited, copied-not-followed,
  no production default) — design authority, explicitly unenforced "until the census gate passes."
- **Owner ruling D-3 (`BusinessEntityModel.md:1236-1244`): Ventana is modeled as an upstream
  SUPPLIER to Taylor, NOT a cross-franchise peer** — only universal invariants
  (custody≠ownership, presence≠availability, billing≠ownership) carry over. D-1: Taylor takes
  title on purchase/receipt.
- No intercompany charge, cross-company AR/AP, shared-labor allocation, or consolidated
  elimination record type exists anywhere in `functions/src/finance/`. The "Line of Business"
  wireframe doc covering intercompany flows is explicitly **NOT BUILT** and not queued.
- Inventory-adjacent records are matrix-designed to inherit `operatingCompanyId` from the owning
  warehouse (custody tagging — operational ownership, not financial treatment) — unstamped
  today, and 8 measured ledger records reference two distinct roots (cross-company-capable, so
  even derivation would sometimes be ambiguous).
- Consolidated double-counting prevention (the Intercompany nav section's stated future
  responsibility) has no supporting data model. **Elimination logic was not invented by this
  audit.** (FIN-009 OPEN; cross-company customer work = UNKNOWN_REQUIRES_DECISION.)

---

## 7. External accounting boundary

**EXTERNAL_ACCOUNTING_SYSTEM = NOT YET ESTABLISHED.** No accounting platform is named,
connected, or scheduled anywhere in code, config, or docs (repo-wide search: QuickBooks / Sage /
NetSuite / Intacct / Xero / GL / chartOfAccounts — zero code hits; docs discuss the category
only in the abstract). What DOES exist:

- `docs/IntegrationArchitecture.md` — the boundary pattern: external systems consume, never
  replace; Firestore owns operational data; any external copy is derived; external systems own
  their native data; and the platform "does not become the accounting ledger of record just
  because it exports Work Order cost data to one" (lines 16-56). No specific vendor committed
  (line 105).
- `enterprise-business-metrics-framework.md` §17 + ADR-BMF-012 — the financial-provider state
  contract (`complete/partial/stale/error/unconfigured`, lineage, freshness, **authority mode**);
  "a governed local ledger may itself be authoritative when explicitly configured as such —
  storage location alone never determines authority." Today only `unconfigured` is reachable.
- The account-page provider seam (§1.5) renders exactly that: "Sales data source not connected."

**FIN-001's central open decision (recorded, not made here):** whether the dormant EOS finance
ledger (§1.5) is designated the authoritative "governed local ledger" under ADR-BMF-012, or an
external accounting system is connected as the authority of record with EOS reconciling to it —
or a staged combination. Every downstream FIN item shapes differently depending on this answer.

**Dated-evidence note (not a SYSTEM_AUTHORITIES correction):** the metrics framework's §20
"actual current state" snapshot ("No Invoice, Opportunity/Quote, or Sales Order entity exists
today… Work Order has zero monetary fields") predates the governed-inert Sales/Finance spine and
is now stale on the entity-existence claims (the Work Order claim remains true).
SYSTEM_AUTHORITIES rows 69-84 carry the current truth. A similar micro-drift: a comment in
`functions/src/constants/collections.ts:46-51` says `sales_agreements` has no Rules match block,
while `firestore.rules:1800-1802` now carries an explicit deny-all block (same effective
posture; code wins). Both belong to routine doc hygiene, not governance falsehood.

## PROPOSED SYSTEM_AUTHORITIES CHANGES

**None required.** `docs/architecture/SYSTEM_AUTHORITIES.md` was reviewed in full against the
audit's primary findings; its finance rows (69-84) accurately describe the governed-inert
posture, ownership, and non-deployment of every financial authority audited. No factually false
financial authority statement was found, so no amendment rides in this branch. (The two stale
statements found live elsewhere — see the dated-evidence note above — and are recorded as
FIN-GAP-018.)

---

## 8. FIN-GAP register

Each gap: TITLE / CURRENT STATE / WHY IT MATTERS / SOURCE EVIDENCE / RISK IF GUESSED /
REQUIRED DECISION / LIKELY FOLLOW-ON.

### FIN-GAP-001 — Financial authority-of-record is undecided (governed local ledger vs external accounting)
**CURRENT STATE:** A complete, well-guarded invoice/payment/adjustment/refund command layer
exists and is fully dormant (`active:false` capabilities, deny-all collections, no UI, no
deploys, zero data); no external accounting system is named or connected.
**WHY IT MATTERS:** Every Financials section (A/R, Payments, Reconciliation, Reporting) means
something different depending on which side is authoritative; building any surface first would
bake in the answer silently.
**SOURCE EVIDENCE:** `functions/src/finance/*`; `permissionCatalog.ts:277-337`;
`firestore.rules:1809-1851`; `IntegrationArchitecture.md:16-56,105`; ADR-BMF-012.
**RISK IF GUESSED:** EOS quietly becomes (or quietly fails to become) the ledger of record;
reconciliation becomes unspecifiable; "reconciled accounting fact" loses meaning.
**REQUIRED DECISION:** Owner designates the authority mode per ADR-BMF-012 (local governed
ledger / external system / staged), and the activation path for the dormant capabilities.
**FOLLOW-ON:** FIN-001 ratification; shapes FIN-010 entirely.

### FIN-GAP-002 — Operating-company attribution is designed but stamped nowhere, and the conversion drops it
**CURRENT STATE:** `operating_companies` authority INERT; census 0/1,323; Opportunity and Sales
Order schemas carry the field but `closeOpportunityAsWon.ts:280` / `createSalesOrderFromOpportunity.ts:194`
pass neither `operatingCompanyId` nor `inheritedOperatingCompanyId` (zero callers repo-wide for
the inherited parameter), the Agreement schema lacks the field, `salesOrderReadService` refuses
to project it, and invoice `companyId` is an ungoverned caller-supplied numbering key never
cross-checked against the registry.
**WHY IT MATTERS:** Taylor-vs-Ventana-vs-Consolidated is the first reporting axis; without a
stamped, governed company fact every company-grain number is unanswerable.
**SOURCE EVIDENCE:** `commercialCompanyScope.ts`; `operatingCompanyAuthority.ts:10-19`;
`eos-ownership-model-reconciliation.md:55-65,250-320`; `invoiceCommands.ts:40,153,176,213`;
grep of `inheritedOperatingCompanyId`.
**RISK IF GUESSED:** Inferring company from warehouse/location names or lineOfBusiness — both
explicitly prohibited (R-14); silently mislabeled company revenue; a null-company Sales Order
population that later needs backfill under harder constraints.
**REQUIRED DECISION:** When/where the company fact is stamped (creation-time on each commercial
record, per the designed chain), who runs the census-gated backfill, and whether invoice
`companyId` converges with or stays distinct from `operatingCompanyId`.
**FOLLOW-ON:** FIN-002; FIN-009.

### FIN-GAP-003 — The business-unit dimension does not exist
**CURRENT STATE:** No `businessUnit`/`businessUnitId` concept anywhere; `salesChannel` and nav
domains are different axes; labor doc defers BU to "resolved from the Work Order's equipment"
(itself unbuilt).
**WHY IT MATTERS:** Service/Equipment Sales/Parts/Installation reporting — half the approved
Financials sections — needs this axis.
**SOURCE EVIDENCE:** repo-wide grep (zero hits); technician-labor-domain-v1.md §11.
**RISK IF GUESSED:** Route/nav/domain-derived BU attribution — explicitly prohibited; unstable
history when navigation changes.
**REQUIRED DECISION:** What object owns business-unit definitions, and how each financial event
is attributed (explicit stamp vs governed derivation with named rules).
**FOLLOW-ON:** FIN-002.

### FIN-GAP-004 — Credited-salesperson attribution does not exist (ownership is not credit)
**CURRENT STATE:** Only `ownerEmployeeId` (ownership, snapshotted at creation) exists;
governance explicitly separates it from sales credit; no credit/commission field anywhere;
coverage module disclaims credit/commission as intentionally deferred; Employee has no
team/manager structure ("EVERY salesManager sees EVERY salesperson").
**WHY IT MATTERS:** Sales-to-Goal and Employee Performance sections are unbuildable without an
explicit historical credit fact; using owner or current Customer.owner rewrites history.
**SOURCE EVIDENCE:** `eos-ownership-model-reconciliation.md:47`; SYSTEM_AUTHORITIES row 76;
`roleHierarchy.ts:9-16`.
**RISK IF GUESSED:** Misattributed commissions/performance; retroactive reassignment silently
rewriting past periods (violates invariant B).
**REQUIRED DECISION:** A credited-salesperson (possibly split-credit) model with explicit
effective dating, and its relationship to ownership, coverage, and commission.
**FOLLOW-ON:** FIN-002; feeds FIN-003 goal measurement bases.

### FIN-GAP-005 — No cost authority exists anywhere (gross margin impossible)
**CURRENT STATE:** GROSS_MARGIN_AUTHORITY = MISSING. No acquisition/standard/average/last/
receiving cost; Part carries no cost by ruling (ND-27); receiving is cost-blind end-to-end;
`part_supplier_items.cost` is an unlinked supplier quote; the Epic-5 PO price layer is orphaned
(and its canonical collection empty); no freight allocation (D-6 deferred); no valuation basis.
**WHY IT MATTERS:** Profitability, Cost-to-Budget, and any margin figure are impossible to build
truthfully; the Profitability placeholder correctly says margin must not be calculated yet.
**SOURCE EVIDENCE:** `part.js:338-361,474-489`; `receivingTypes.ts:73-89`;
`purchaseOrder.js:250-299`; `DECISIONS.md:1244`.
**RISK IF GUESSED:** Margin from retail price or supplier quotes — explicitly prohibited
(invariant D) and explicitly refused in-repo; confidently wrong profitability driving decisions.
**REQUIRED DECISION:** Valuation policy (which costing method), where landed cost is captured
(receiving? PO receipt?), the fate of the Epic-5 layer, and freight allocation policy.
**FOLLOW-ON:** FIN-006.

### FIN-GAP-006 — Labor is hours-only; rate/cost/billable are deliberate voids (and recording is dormant)
**CURRENT STATE:** `work_order_labor_entries` records duration+type append-only; rate/cost/
billable fields test-asserted absent; `workOrder.labor.*` capabilities `active:false`, carried
by no Role — even the hours fact is dormant. Subcontractor labor is out of scope with an
"UNKNOWN, not zero" doctrine.
**WHY IT MATTERS:** Labor cost is the largest service cost component; Cost-to-Budget and
service profitability depend on a derivation layer that does not exist.
**SOURCE EVIDENCE:** `workOrderLaborCommand.ts:12-24,60-64`; `laborCallables.ts:11`;
technician-labor-domain-v1.md §2, §12.
**RISK IF GUESSED:** hours × any-rate = fabricated cost; paid≠job≠travel≠onsite distinctions
collapsed (the exact confusion the labor domain was built to prevent).
**REQUIRED DECISION:** The labor cost derivation model (rates authority, burden, travel policy)
and activation of labor recording.
**FOLLOW-ON:** FIN-006; FIN-003.

### FIN-GAP-007 — Financial visibility is one coarse boolean with only consolidated scope
**CURRENT STATE:** One read id (`finance.read`) for all AR/payment/adjustment/refund data,
granted identically to ten roles (all `active:false` today); account parameter caller-supplied
and unchecked; no SELF/TEAM/BUSINESS_UNIT/OPERATING_COMPANY scope anywhere;
`hierarchicalVisibility.ts` built, tested, consumed by nothing; report-builder financial class
unused; single-gate section coarseness self-documented.
**WHY IT MATTERS:** Invariant E (visibility follows the number) currently holds only because
everything is denied; the first activation event will grant consolidated visibility as the only
available shape.
**SOURCE EVIDENCE:** `permissionCatalog.ts:277-337`; `financeReadCallables.ts:23-33,65-73`;
`governedBusinessRoles.ts` grant sites; zero-consumer grep of `hierarchicalVisibility`;
`accountPageComponents.js:90-108`.
**RISK IF GUESSED:** Activating `finance.read` "to light up the AR section" silently gives every
grantee company-wide AR for any account; a later scope retrofit becomes a breaking change.
**REQUIRED DECISION:** The FIN-004 scope model (SELF/TEAM/BU/COMPANY/CONSOLIDATED per metric
class), whether `finance.read` is split per fact family, and export/masking rules.
**FOLLOW-ON:** FIN-004.

### FIN-GAP-008 — No plan authority: goals, budgets, forecasts have no storage at all
**CURRENT STATE:** MISSING everywhere (verified); only display-seam placeholders exist.
**WHY IT MATTERS:** Sales-to-Goal, Cost-to-Budget, Budget/Goal Management, Forecasting — seven
of the twenty sections — have no data model; versioned/approved plan semantics (never rewriting
prior periods) must be designed, not retrofitted.
**SOURCE EVIDENCE:** collection registry, Rules, capability catalog, grep.
**RISK IF GUESSED:** Mutable UI-backed "goals" that silently rewrite prior-period comparisons
(violates invariants A and B).
**REQUIRED DECISION:** Plan object model (versioning, approval, measurement basis: booked/
billed/collected/cost/margin per goal), and its visibility model.
**FOLLOW-ON:** FIN-003; FIN-005.

### FIN-GAP-009 — No approval thresholds or dual control on financial mutations; discount authority explicitly absent
**CURRENT STATE:** Adjustment/refund commands require a reason and audit but have no amount
caps, no second approver; `salesAgreement.accept` carries a recorded caveat that no
approval-limit/discount-authority check exists; ownership-correction command built but inert.
**WHY IT MATTERS:** The moment capabilities activate, a single grantee can write off or credit
any amount with one call; discount governance is a stated business need.
**SOURCE EVIDENCE:** `adjustmentCommands.ts:72,87-91`; `refundCommands.ts:63`;
`governedBusinessRoles.ts:277,332,577`; `ownershipHandoffCommand.ts:9-24`.
**RISK IF GUESSED:** Inventing thresholds without Owner policy; or activating with none and
normalizing ungoverned write-offs.
**REQUIRED DECISION:** Approval matrix (who/threshold/second-approver per mutation type) before
any finance write capability activates.
**FOLLOW-ON:** FIN-007.

### FIN-GAP-010 — No period/close model and no as-of financial snapshots
**CURRENT STATE:** MISSING in full (§5); AR `outstandingMinor` is live-only.
**WHY IT MATTERS:** Month-close reporting, locked periods, late-posting policy, and
prior-period-adjustment discipline are unbuildable; period columns in every section header
currently mean nothing governed.
**SOURCE EVIDENCE:** grep (zero fiscal/close/lock constructs); `financeReadProjection.ts`.
**RISK IF GUESSED:** Calendar-date reports masquerading as closed periods; historical numbers
that change after the fact.
**REQUIRED DECISION:** Fiscal calendar definition, close workflow, lock semantics, and whether
as-of AR snapshots are stored or reconstructed from the event history.
**FOLLOW-ON:** FIN-008.

### FIN-GAP-011 — Intercompany financial treatment has no model, and D-3 constrains its shape
**CURRENT STATE:** Ventana ruled an upstream supplier (not a peer franchise); no intercompany
charge/elimination/cross-company AR-AP types; inventory company-tags are custody-designed and
unstamped; 8 ledger records already cross-company-ambiguous.
**WHY IT MATTERS:** The Intercompany section's stated responsibility (preventing consolidated
double counting) has no data to operate on; consolidated reporting is unsafe until treatment is
defined.
**SOURCE EVIDENCE:** `BusinessEntityModel.md:1236-1244`; `ownershipMatrix.ts` inventory rows;
reconciliation doc line 451.
**RISK IF GUESSED:** Inventing elimination logic (prohibited); double-counting Taylor↔Ventana
activity in consolidated views.
**REQUIRED DECISION:** Whether intercompany activity is modeled as ordinary supplier
transactions (per D-3) or as governed intercompany events; consolidation/elimination policy.
**FOLLOW-ON:** FIN-009.

### FIN-GAP-012 — No reconciliation seam exists (and nothing to reconcile against)
**CURRENT STATE:** No external system, no sync, no reconciliation process, no freshness
tracking; the provider-state contract exists as architecture only; `unconfigured` is the only
reachable state.
**WHY IT MATTERS:** Reconciliation & Exceptions section; invariant "reconciled accounting fact"
as a distinct basis; trust in every EOS-displayed figure.
**SOURCE EVIDENCE:** §7; `financialSummaryView.js:1-24`.
**RISK IF GUESSED:** Presenting EOS operational figures as reconciled facts.
**REQUIRED DECISION:** Downstream of FIN-GAP-001; the reconciliation grain, cadence, and
exception workflow.
**FOLLOW-ON:** FIN-010.

### FIN-GAP-013 — Sales Order has no usable timestamp (named defect) and the chain lacks a booking-date concept
**CURRENT STATE:** `SALES_ORDER_HAS_NO_USABLE_TIMESTAMP` — write path stores Timestamps, read
projection reads `*Millis` names nothing writes; both null on every row; `salesOrderNumber` is
the de facto ordering surrogate. No `bookedAt` concept exists anywhere on the chain
(Agreement has `acceptedAtMillis`; Opportunity has none).
**WHY IT MATTERS:** Period attribution of committed value (bookings by `bookedAt`, per the
metrics framework §12) is impossible; every KPI must declare a date basis it cannot obtain.
**SOURCE EVIDENCE:** `salesOrder.js:261-280`; metrics framework §12.
**RISK IF GUESSED:** Deriving order dates from document ids or numbering sequences; UI-state
periods (prohibited, invariant D).
**REQUIRED DECISION:** Fix the projection/write mismatch (a code defect repair, separately
scoped) and ratify which date is the booking date basis.
**FOLLOW-ON:** FIN-002; FIN-008. (The projection mismatch itself is an ordinary defect that may
be fixed outside FIN — flagged, not fixed here, per audit constraints.)

### FIN-GAP-014 — Operational completion and billing are unlinked, with no billable-work concept on Work Orders
**CURRENT STATE:** Nothing reads WO status for billing; `billingEligibility` is SO-grain only;
WOs carry no charges, no billable flag, no no-charge/warranty/goodwill cost semantics; the
Billing Queue section's operational-readiness question has no current data model spanning
service work.
**WHY IT MATTERS:** Service billing (the Billing Queue's core) requires an explicit governed
bridge from execution facts to billable facts; today the bridge is legitimately absent and must
not be inferred.
**SOURCE EVIDENCE:** §1.2 negative findings; `billingEligibility.ts:6-9`.
**RISK IF GUESSED:** COMPLETE⇒BILLED inference (explicitly unsupported); invoicing service work
with no price source (the metrics framework's no-price-source rule).
**REQUIRED DECISION:** The service billing model — what makes service work billable, its price
source, and its relation to Sales-Order-anchored billing.
**FOLLOW-ON:** FIN-001 (state model); FIN-003.

### FIN-GAP-015 — Agreement-level charges (freight/install/tax/deposit/trade-in) stop at the Agreement
**CURRENT STATE:** Supplied and frozen at ACCEPTED, deliberately not copied to the Sales Order
(no shipment object exists); invoice tax is a separately injected determination; no path carries
agreement-level charges into invoicing.
**WHY IT MATTERS:** Billed totals cannot currently include committed freight/install/deposit
components; deposit (down payment) has no linkage to payments.
**SOURCE EVIDENCE:** `agreementToSalesOrder.ts:125-138`; `salesAgreementCommands.ts:169-198`;
`invoiceCommands.ts:8-9`.
**RISK IF GUESSED:** Double-charging or dropping charges when invoice authority activates;
deposits neither applied nor tracked as liability.
**REQUIRED DECISION:** How header-level charges flow to invoices, and the deposit/prepayment
treatment.
**FOLLOW-ON:** FIN-001; FIN-006 (freight), FIN-007 (deposit application).

### FIN-GAP-016 — Invoice-document provenance gap and lineage-only sales attribution
**CURRENT STATE:** No createdBy/updatedBy on the invoice document (named gap; actor recoverable
from `auditEvents` only); salesperson reachable only via `salesOrderId` lineage per D-15; no
as-issued attribution snapshot.
**WHY IT MATTERS:** FIN-002 requires explicit historical reporting attribution on financial
events; a lineage-walk depends on upstream records never changing meaning.
**SOURCE EVIDENCE:** `invoice.js:71-82`; `eos-ownership-model-reconciliation.md:353-357`.
**RISK IF GUESSED:** Attributing invoices to whoever currently owns the upstream records.
**REQUIRED DECISION:** Whether financial events snapshot their attribution (company/BU/person)
at issuance — the FIN-002 model's central question.
**FOLLOW-ON:** FIN-002; FIN-010.

### FIN-GAP-017 — Sale-close criteria (D-5) and revenue-recognition point are open
**CURRENT STATE:** `FULFILLED→CLOSED` has no payment/acceptance gate (open Owner gate,
"load-bearing"); no recognition proxy exists; delivered/installed are custody facts; the
Ventana ice-machine lifecycle makes CLOSED an inventory-control exit condition, raising the
stakes of what CLOSED means.
**WHY IT MATTERS:** "Collected", "closed", and any future recognition basis must not be
conflated; the metrics framework bans "recognized revenue" without implemented policy.
**SOURCE EVIDENCE:** `DECISIONS.md:1232`; §1.4.
**RISK IF GUESSED:** Treating CLOSED or INSTALLED as revenue events.
**REQUIRED DECISION:** D-5 sale-close criteria (Owner), and — much later — whether any
recognition concept enters EOS at all or stays with the external authority.
**FOLLOW-ON:** FIN-001; FIN-008.

### FIN-GAP-018 — Documentation drift on financial current-state claims
**CURRENT STATE:** Metrics framework §20's verified-current-state snapshot predates the Sales/
Finance spine (entity-existence claims now stale); `constants/collections.ts:46-51` comment
contradicts the now-present explicit deny-all Rules block for `sales_agreements`; `salesChannel`
vs the undefined `isNationalAccount` naming question.
**WHY IT MATTERS:** FIN specs will cite these docs; stale current-state claims propagate.
**SOURCE EVIDENCE:** §7 dated-evidence note; metrics framework §20; `firestore.rules:1800-1802`.
**RISK IF GUESSED:** Specs designed against a world where the finance backend "doesn't exist."
**REQUIRED DECISION:** Routine doc-hygiene updates (ordinary PRs, no governance change); confirm
`isNationalAccount` intent.
**FOLLOW-ON:** FIN-010 (traceability hygiene); no new authority.

---

## 9. Implications for FIN-002..FIN-010 (mapping summary)

| Item | What this audit establishes |
|---|---|
| FIN-002 Reporting Attribution | The spine has one working link of four; needs company stamping (GAP-002), a BU model (GAP-003), a credit model (GAP-004), event-time attribution snapshots (GAP-016), and a booking-date basis (GAP-013) |
| FIN-003 Plan vs Actual | Plans are wholly MISSING (GAP-008); "actual" bases (booked/billed/collected) exist only as dormant facts or not at all (GAP-014); measurement-basis vocabulary comes from the metrics framework |
| FIN-004 Financial Visibility | Today: one boolean, consolidated-only, everything denied (GAP-007); unconsumed team-visibility machinery exists; the scope model is greenfield |
| FIN-005 Forecast | No forecast storage; display seams structurally inert; Opportunity `expectedValue` is the only forecast-ish fact and is quarantined by design |
| FIN-006 Cost & Margin | Blocked outright by GAP-005/GAP-006; ND-27 is the standing refusal to approximate |
| FIN-007 Adjustments/Approvals | Correction primitives exist (dormant) with reason+audit but no thresholds (GAP-009); discount authority absent by recorded caveat |
| FIN-008 Period & Close | Entirely greenfield (GAP-010); interacts with GAP-013's date defect and GAP-017's close semantics |
| FIN-009 Allocation & Intercompany | Constrained by D-3 (Ventana=supplier); no intercompany financial types (GAP-011); company stamping is prerequisite (GAP-002) |
| FIN-010 Reconciliation/Traceability/Audit | Strong shared audit machinery exists (append-only `auditEvents`); reconciliation blocked on GAP-001/GAP-012; provenance gaps GAP-016/GAP-018 |
