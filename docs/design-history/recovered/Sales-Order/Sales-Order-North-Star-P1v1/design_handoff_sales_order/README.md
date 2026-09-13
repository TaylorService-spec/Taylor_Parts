# Handoff: Sales Order family — North Star recomposition
## VERSION: Sales Order North Star P1 — DESIGN PACKAGE ONLY. Do not implement until Owner review.

## Authorities
- **Visual authority:** `North Star - Sales Order P1.dc.html` (section 1a) and `North Star - Sales Orders Workspace P1.dc.html`, plus the accepted Work Order family grammar (`design_handoff_work_order/`). ◆-marked surfaces are the North Star destination, NOT the implementation target.
- **Implementation visual target:** `Implementation Render - Sales Order.html` in this folder — the same composition populated only with what EOS truthfully provides today.
- **Behavioral authority:** TaylorService-spec/Taylor_Parts @ main. Key files: domain/salesOrderView.js, salesOrderStatus.js, salesOrderActions.js, salesOrderMoneyDisplay.js, salesOrderDisplayCurrency.js, salesOrderFulfillmentProgress.js, metadata/definitions/salesOrder.js + salesOrderPage.js, modules/sales/SalesOrdersList.jsx + SalesOrderDetail.jsx + SalesOrderActions.jsx + SalesOrderFulfillmentSection.jsx, access/salesOrderCapabilityAccess.js, functions/src/salesAgreement/agreementToSalesOrder.ts.

## Page-family scope
1. Sales Orders workspace (`salesOrder.index`, readCallable listSalesOrderIndex, /customers route family)
2. Sales Order detail (/customers/opportunities/sales-order/:salesOrderId, getSalesOrderContext)
3. Account-related Sales Orders section (account.salesOrders) — same row grammar as the workspace, no separate design
Subpage relationships stay IN the record (provenance strip, terms rail section, operational-work section) — no new routes.

## Geometry & tokens (shared with the Work Order family — fix the system, no one-offs)
1360px measure · thick/thin rule pair · serif 40px title over bronze kicker · fact row 13px · action cluster right-baseline (one filled primary, outlined secondaries, red text destructive) · chevron band (10px notch) · minmax(0,1fr)/340px/56px body · rail heads 11px uppercase over 2px evergreen rule · table grammar: 2px evergreen header rule, hairline rows, uppercase 11px labels, tabular numerals right-aligned. All from ns-workorder.css/ns-shell.css; a future ns-salesorder.css adds only the provenance strip and 8-step chevron variants.

## One fact, one rendering (NS-P4)
- State words come from salesOrderStateLabel; tones from salesOrderStateTone. Never the raw machine string.
- Money comes from salesOrderDollars + salesOrderDisplayCurrency in EVERY surface (list cell, header fact, total row): $23,450.00 / "Partly priced" / "Not priced" / "No lines" / "—" for genuinely unknown. NULL IS NOT ZERO — never $0.00 for missing pricing. No currency selector, no FX; leave room for currency metadata (Record detail shows Currency) without implying multi-currency exists.
- Identity is salesOrderNumber; null → "Reference unavailable"; a document id is never displayed (DECISIONS #106).

## Action architecture (all existing commands; none invented)
- PRIMARY: Advance (transitionSalesOrder ADVANCE; label by next state: "Move to In Fulfillment" / "Mark Fulfilled" / "Close order") — offered per canAdvance (IN_FULFILLMENT requires allLinesFulfilled).
- SECONDARY: Allocate (salesOrder.fulfill; CONFIRMED|IN_FULFILLMENT), Create Service (salesOrder.service; no existing linked WOs).
- DESTRUCTIVE: Cancel order (illegal once FULFILLED).
- Capability protection: offered-but-ungranted renders protected+disabled with SALES_ORDER_WRITE_DISABLED_REASON — never live, never hidden.
- When the engine offers no primary, the slot carries the muted reason from the client mirror ("Mark Fulfilled becomes available when every line is fulfilled") — see decision S7.
- Read-only states (CLOSED, CANCELLED): fact-row sentence, no live buttons, composition unchanged.
- Workspace has NO create action: creation authority is createSalesOrderFromOpportunity only; the header states this.

## Honest states (NS-P3) — all designed, see North Star 1b
loading / denied (never empty) / unavailable vs not-found (distinct sentences) / no lines / unpriced / partly priced (priced lines still show figures; total shows the phrase) / no downstream work / read-only / reference-unavailable (SO number, SA, WO rows).

## Implementation reality matrix
| Concept | Classification |
|---|---|
| Workspace list, honest count, saved views (Recently viewed / Open), state filter, cursor paging | LIVE TODAY |
| Dollars vocabulary in list + detail; customer names resolved | LIVE TODAY |
| Detail identity, facts, lines quantity table, notes, Record detail | LIVE TODAY |
| Provenance: Account name, OP-number | LIVE TODAY |
| Fulfillment chevrons with honest unknown/blocked/failed | LIVE TODAY (workOrders=null → installation steps "not recorded") |
| Attention strip fed by pricingState/unpricedLineCount | LIVE TODAY (derived, not AI) |
| Persona capability protection | LIVE TODAY |
| SA reference in provenance + Commercial-terms rail | FOUNDATION EXISTS — UX NOT EXPOSED (sourceAgreementId stored; no projected SA number/terms — S2) |
| Per-line unit/extended prices + product display names | FOUNDATION EXISTS — UX NOT EXPOSED (unitPrice stored/authoritative; stripped from projection in PR #991 — S1) |
| Resolved WO rows (number, status, schedule, technician) | FOUNDATION EXISTS — UX NOT EXPOSED (read service pending — S3) |
| Created/Updated columns, date filters | FOUNDATION EXISTS — projection field-name defect (S4) |
| Workspace search by SO number / customer | REQUIRES PRODUCT BUILD (S5) |
| Billing/invoiced readiness in rail | REQUIRES PRODUCT BUILD (invoice read for this page) |
| Fulfillment risk, stock-short detection, receipt ETA, slip prediction (◆) | REQUIRES AI / FUTURE NORTH STAR |
| Customer handoff step completing | FUTURE (no custody event exists; stays "not recorded") |

## Behavioral gaps / product decisions (named, for Owner)
- **S1 — Re-expose line pricing to the read.** unitPrice is stored per line and authoritative for invoicing, but PR #991 deliberately excluded it from the projection. North Star shows unit/extended per line. Reversing #991 (read-only projection of unitPriceMinor + extended + product display name) is a product decision, not a presentation change.
- **S2 — Name the Agreement.** Denormalize sourceAgreementNumber at creation (exactly as sourceOpportunityNumber was) or resolve at read; also decide which accepted terms (warranty, ship-via, arrival) the detail rail may read from the Agreement.
- **S3 — Resolve WO lineage.** Ship the read that names serviceWorkOrders (number/status/schedule/technician) so the fulfillment section and Operational-work rows leave their unavailable states.
- **S4 — Fix the timestamp projection** (createdAtMillis/updatedAtMillis read names vs createdAt/updatedAt written) to unlock date columns/filters/sorts.
- **S5 — Search read** for the workspace (SO number prefix + customer). Until then the search slot renders disabled with an honest reason.
- **S6 — Sort gaps stay.** No customer-name sort, no dollars sort (derived value) — the workspace states its sort honestly instead.
- **S7 — Empty-primary grammar.** When the engine offers no advance, P1 renders the mirror's reason as muted text rather than a disabled button (the gate is state, not capability). Confirm or amend.

## Do-not-invent list
No fabricated: prices, totals ($0.00 for unknown), ETAs, risk scores, stock levels, billing status, SA terms, WO names/statuses, timestamps, search results, currency conversion, edit pencils (no field-update command exists), create-order button, approval warnings, customer-risk analysis. Every one of these renders its designed slot with the truthful state above.

## High-density stress results
Long customer names wrap within the Customer column (workspace row 2); 25+ lines group by kind with subtotals, no inner scroll; 100+ orders = cursor "Load 50 more" + honest aggregate count; unpriced/partly-priced rows carry the phrase with title reason; pre-numbering rows say "Reference unavailable"; denied persona gets the full denied state, not a blank; tablet drops the rail below main; 375/320 stacks cards (never a squeezed table — see North Star 1d).

## Acceptance checklist (for the eventual implementation pass — NOT now)
- [ ] Whole-composition side-by-side vs Implementation Render + North Star 1a (Design + Owner)
- [ ] All five view states reachable and distinct; denied never empty
- [ ] Money vocabulary identical in list/detail/rail (one function feeds all)
- [ ] No document id rendered anywhere; every gap slot carries its truthful sentence
- [ ] Actions: offer-gates + capability protection unchanged; no new write path
- [ ] Engineering regression on the real sandbox passes
