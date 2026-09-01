# FIN-BLOCK-002 — Service Billing: Owner Decision Package

**Status:** ASSESSMENT ONLY — nothing implemented, no candidate classification coded.
Prepared 2026-09-01 (continuation run, Tranche 3) from a full read-only audit of the Work
Order, labor, parts-consumption, agreement, and pricing state. Composes DECISIONS #145/#154
and FIN-001 FIN-GAP-014.

## 1. What service financial classes are ALREADY representable

Only two facts in the repository carry any class-like signal, and neither is billing
authority:

- `WorkOrderType = SERVICE_CALL | PM | INSTALL | WARRANTY | INSPECTION`
  (`types/workOrder.ts:37-42`). `WARRANTY` is a bare categorization — no code anywhere
  gives it billing/coverage semantics. There is **no** charge/no-charge, callback, goodwill,
  or internal flag anywhere on a Work Order.
- Sales-agreement lines carry `warranty: string | null` — free text
  (`salesAgreementCommands.ts:92,142,202`), not a structured coverage link.

Of the candidate set (CUSTOMER_PAY / AGREEMENT_COVERED / WARRANTY / INTERNAL / GOODWILL /
CALLBACK_REWORK / NO_CHARGE): only WARRANTY has even a partial upstream signal (the WO
type), and it is categorization, not chargeability. **None of the seven is derivable from
current data**; coding any of them today would be inference, violating invariant D.

## 2. Required facts that are MISSING

| Missing fact | Evidence |
|---|---|
| `serviceFinancialClass` (any spelling) | zero matches repo-wide |
| `billingReadiness` on service work | zero matches repo-wide |
| Any billable flag on WO / labor / consumed parts | `workOrderLaborCommand.ts:12-24` ("No rate, no cost, no billable flag" — deliberate); `InventorySnapshotItem` has no price field (`types/workOrder.ts:188-202`) |
| Labor bill rate / cost rate | none anywhere (see §6/§7) |
| Agreement linkage on the WO | **no `salesAgreementId` field exists on WorkOrder**; only `salesOrderId`/`salesOrderLineRefs` |
| Payor / bill-to | no payor concept anywhere in code (docs-only mentions); WO carries `customerId` only |
| Service sell-price | Part `sellPrice` BLOCKED (`part.js:338-361`, PART_INVENTORY_VALUATION_AUTHORITY_GAP); no price book module exists |

## 3–4. Where `serviceFinancialClass` and `billingReadiness` should live (assessment)

- **`serviceFinancialClass`: on the Work Order**, set at creation (like `type`) and
  correctable only through a governed command with audit — it classifies the WORK, and the
  WO is the work's governed record. Deriving it from `WorkOrderType` alone is impossible
  (SERVICE_CALL may be customer-pay, agreement-covered, or goodwill). `WARRANTY` the TYPE
  and WARRANTY the FINANCIAL CLASS should remain distinct facts even if usually aligned
  (a warranty-type visit can still produce billable non-covered work).
- **`billingReadiness`: derived, never stored as independent authority** — the service
  analogue of `computeBillingEligibility`: a pure projection over (WO terminal state ×
  financialClass × priced facts), feeding `deriveBillingQueueEntry` as the queue's second
  input type (the queue was built to accept one without redesign). Mirrors the "outstanding
  is a projection" doctrine.

## 5. Existing price authorities reusable

- **SO line `unitPriceMinor`** (`salesOrderCommands.ts:68,113,133-140`) — the ONE governed
  sell-price fact; already refused-if-absent at invoicing. If service billing flows through
  Sales Orders (Q3 below), service lines reuse it unchanged.
- **`part_supplier_items.cost`** — procurement quote/term, NOT a sell price and (per
  FIN-001) not admissible as cost authority; reusable for neither side of service billing.
- Nothing else exists: no price book, no labor rates, Part sellPrice blocked.

## 6. Labor BILL-rate authority: **NONE exists.** 7. Labor COST-rate authority: **NONE exists.**

`work_order_labor_entries` records minutes + ONSITE/TRAVEL only; employee records carry no
wage/rate; the hours-only design is ratified (technician-labor-domain v1, test-asserted).
Any labor billing OR labor costing requires a NEW rate authority (bill rate ≠ cost rate ≠
hours — the labor doctrine already separates them). The cost side is FIN-BLOCK-003 Q3.

## 8. Can WO-consumed parts use a governed sell-price snapshot?

Not today: `InventorySnapshotItem` (sku/qtyUsed, no price) is explicitly "non-authoritative,
purely descriptive," and no Part sell price exists. Two viable Owner paths: (a) service
parts are billed as SO lines (SO `unitPriceMinor` at order time — works now, requires
service work to flow through an SO), or (b) a future price-book authority stamps a frozen
sell-price snapshot at consumption (new authority; consistent with the "snapshot at event
time" doctrine). (a) requires no new pricing authority.

## 9. Agreement-covered vs CUSTOMER_PAY

Today they are INDISTINGUISHABLE: no agreement linkage exists on the WO, and agreement
lines' `warranty` is free text. AGREEMENT_COVERED requires (i) a governed WO→agreement
link, (ii) a structured coverage term on the agreement (what work/parts/labor the agreement
covers), and (iii) the classification decision at WO creation or completion. Until then,
every class defaults to "unclassified = UNBILLABLE" (fail-closed).

## 10. WARRANTY / GOODWILL / CALLBACK / NO_CHARGE behavior (assessment for ruling)

Common shape: **classified work that produces NO customer invoice but SHOULD produce cost
attribution** (whose P&L absorbs it — warranty reserve, sales goodwill, rework quality).
That cost side is blocked on FIN-BLOCK-003 regardless; so these classes' immediate effect
is purely: excluded from the billing queue WITH a named reason (not silently absent).
CALLBACK_REWORK additionally wants the causal link to the original WO (a lineage field, not
a billing fact).

## 11. Does INSTALLATION use Work Orders but report to the INSTALLATION BU?

Split today: INSTALL-type Work Orders exist, and `deriveWorkOrderBusinessUnit` maps
INSTALL→INSTALLATION BU — but that function has **zero callers** (exported, unwired).
Separately, `equipmentInstall/` (the serialized-asset→customer-equipment transfer) creates
NO Work Order and carries NO BU. So: yes, installation work-execution is WO-shaped and its
BU vocabulary is ready, but nothing stamps it yet; the equipment-transfer event is a
custody event, not the billable work record.

## 12. Exact Owner choices remaining

1. **The classification set** — ratify/amend the candidate seven (CUSTOMER_PAY,
   AGREEMENT_COVERED, WARRANTY, INTERNAL, GOODWILL, CALLBACK_REWORK, NO_CHARGE); nothing in
   the repo contradicts them, nothing establishes them.
2. **Where classification is set and by whom** — at WO creation vs at completion; which
   role; whether reclassification requires FIN-007 approval (recommended: yes — it moves
   money).
3. **The billing route** — does billable service work flow THROUGH a Sales Order (service
   lines; reuses ALL existing price/eligibility/invoice machinery; the queue then needs no
   second input type) or through a new billable-work record feeding the queue directly?
   The audit found the SO route requires no new pricing authority.
4. **Labor billing** — whether labor is billable at all in v1 (flat/none/T&M); if T&M, the
   bill-rate authority (per-tech? per-class? per-agreement?) must be minted.
5. **Parts pricing on service work** — path (a) SO lines vs (b) future price book (Q8).
6. **Agreement coverage structure** — the governed shape of "what an agreement covers"
   (currently free text), prerequisite for AGREEMENT_COVERED.
7. **Payor** — whether bill-to ≠ customer is in scope (national accounts suggest yes
   eventually; nothing models it).
8. **Wire `deriveWorkOrderBusinessUnit`** — deterministic and safe once anything consumes
   WO-grain financial facts; today it is dead code by design.

No piece of service billing is deterministically resolvable from repository authority
alone; **no implementation was performed.**
