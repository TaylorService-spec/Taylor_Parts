# Handoff: Sales Agreement family — North Star design source
## VERSION: Sales Agreement North Star P1 — DESIGN AUTHORITY. Design only; no implementation, no authority changes.

## Visual authority
`North Star - Sales Agreement P1.dc.html` in this folder: 1a desktop 1440 (ACCEPTED with downstream order — the canonical hierarchy), 1b tablet 768 (DRAFT — the working surface), 1c phone 375, 1d states.

## Behavioral authority
TaylorService-spec/Taylor_Parts @ main: domain/salesAgreementView.js (the full projected field list + six view states + label rule + acceptability reasons), hooks/useSalesAgreement.js (read/create/updateDraft/accept; per-intent idempotency; every mutation re-reads), services/salesAgreementCommandClient.js, functions/src/salesAgreement/* (lifecycle DRAFT/ACCEPTED/DECLINED — terminal, no return to draft; agreementToSalesOrder; SA-YYYY-###### numbering; product reference search), access/salesAgreementCapabilityAccess.js, modules/sales/SalesAgreementPanel.jsx (existing surface — behavioral evidence, not visual truth).

## Core composition (1440, top to bottom)
Utility line ("Read-checked · Refresh") → rule pair → identity header → lineage strip → body grid 1fr/340/56: MAIN = committed lines + money ladder, Acceptance, "What this agreement became"; RAIL = Commercial terms, Why this agreement exists (opportunity provenance), Customer, Record.

## Design decisions (SA-D1–D12)
- **SA-D1 Identity facts:** kicker "Sales Agreement · Negotiated commercial commitment"; title = salesAgreementNumber (fallback: the truthful generic "Sales Agreement", never a document id); fact row = state sentence with tone, account + location, total committed (with currency), customer PO, owner. Five facts; the state sentence carries the commercial meaning ("Accepted — binding and read-only" / "Draft — being negotiated, editable" / "Declined — terminal").
- **SA-D2 State treatment:** NO lifecycle band. Draft → Accepted | Declined is a gate with two terminal outcomes, not a progression — chevrons would manufacture a journey. State renders as the fact-row sentence (stated once), and the Acceptance section is the record of the one event that matters. LifecycleBand deliberately unused.
- **SA-D3 Value prominence:** total committed is a header fact AND the anchor of the lines section's money ladder (subtotal → shipping → tax → **total** → down payment → trade-in → balance, right-aligned tabular, minor units formatted through the one money display path, real $ because the agreement governs currency). Never a dashboard tile. A draft with unpriced lines claims NO total — "Incomplete — N unpriced lines," never a partial sum, never $0.00.
- **SA-D4 Lines responsive:** 1440 = full commercial grid (Item strong with kind/condition/warranty/arrival subline · Qty · Unit · Committed) + ladder. 768 = lines shed the unit column (per-line on expand), ladder collapses to the one truthful figure or the incompleteness statement. 375 = each line is a commercial card (item, qty × unit, committed value, critical distinctions), total + balance rows below; no horizontal scroll, no miniature spreadsheet.
- **SA-D5 Terms placement:** rail, first section — dl of the real fields only: customerPO, isLease ("No — purchase"/"Lease"), fulfillmentIntent in words (Deliver / Install / Deliver & install), shipVia, currency; shippingInstructions + specialInstructions as prose beneath. Absent fields are omitted, never dashed placeholders. No payment-terms/tax-treatment fields exist on the agreement — not invented (the tax AMOUNT is governed and lives in the ladder).
- **SA-D6 Acceptance evidence:** exactly what EOS proves — acceptedAtMillis + the resolved actor of acceptedByUid, worded "The governed accept action was executed {when} by {actor}, recording the customer's commitment," plus the pricing invariant and terminality. Explicitly states EOS holds no customer signature. No "customer accepted/signed" language anywhere. If the actor uid can't be resolved for the viewer: "by an authorized user (name unavailable to you)".
- **SA-D7 Opportunity provenance:** rail section "Why this agreement exists" — OPP number linked + the opportunity's need text + channel/owner; plus the lineage strip (Account → OPP → **SA** → SO, current record inked solid). Never the embedded opportunity page.
- **SA-D8 Downstream lineage:** main section "What this agreement became" — one row: SO number linked, "created from these committed lines and prices," state words. In ACCEPTED the header primary is "Open Sales Order {number}".
- **SA-D9 Before an order exists:** "No sales order yet — one is created from these committed lines when the opportunity closes won." Neutral, not failure; NO invented create button (the order comes from the opportunity's governed close, not from the agreement).
- **SA-D10 Actions by state:** DRAFT all-priced → primary **Record acceptance** (acceptSalesAgreement; no commercial payload), secondary Edit draft (updateSalesAgreementDraft, section-aware in place). DRAFT with unpriced lines → Record acceptance disabled with the view model's own reason naming every unpriced line; the attention strip carries the blocker. ACCEPTED → primary is navigation to the order (or the SA-D9 sentence); no edit affordance at all (engine forbids it — absent, not disabled, because it's a state restriction stated in the state sentence). DECLINED → no actions; record stays readable. Permission restriction is the different sentence: protected+disabled with "you don't have permission…". State vs permission never collapse.
- **SA-D11 Intelligence:** none. The only derivable condition (unpriced lines blocking acceptance) is a deterministic engine fact already rendered as the attention blocker with its named lines. No AI surface is warranted or designed.
- **SA-D12 Deliberately absent:** e-signature/DocuSign/send-to-customer; Presented/Rejected/Superseded/Expired/Void states; revision/amendment of accepted agreements ("a changed mind is a new agreement"); discounts, margin, cost, commission, approval thresholds; tax calculation UI (only the governed tax amount renders); FX/currency selection; payment schedules; invoice/fulfillment behavior; PDF generation; risk/health scores. Empty space stays empty.

## Attention
One condition only: DRAFT with unpriced lines (the acceptance blocker, from agreementAcceptability's reason). Nothing else is manufactured; ACCEPTED/DECLINED render no attention band.

## Honest states (all in 1d)
loading / **not enabled** ("Sales agreements aren't enabled in this environment yet" — no read attempted) / denied / unavailable / none-for-this-opportunity / unnumbered (generic label) / unresolved acceptor / draft-incomplete (no total claimed) — each its own sentence, per the view model's own six-state contract.

## Implementation mapping
### EXISTING EOS TRUTH
Identity + number, state words, account/location, lines (kind/ref/qty/unitPriceMinor/extendedMinor/condition/warranty/estimatedArrivalMillis), full money ladder (subtotal/shipping/installCharge/tax/total/downPayment/tradeIn/balance minor + currency), customerPO/isLease/fulfillmentIntent/shipVia/instructions, sourceOpportunityId, salesOrderId, acceptedAtMillis/acceptedByUid, lineage strip.
### EXISTING EOS ACTION
updateSalesAgreementDraft (draft only), acceptSalesAgreement (draft, all lines priced), navigation to Opportunity/Sales Order/Account. (createSalesAgreement lives on the Opportunity surface — P1v2 — not here.)
### HONEST UNKNOWN
Acceptor name where the employee directory is unreadable for the viewer; account name where the read doesn't resolve it; install-charge line absent when null (omitted from the ladder, not zeroed).
### PRODUCT GAP
- **SA-G1 — No route.** The agreement renders as a panel of the opportunity workspace; no /…/sales-agreement/:id route exists. This design assumes a real record page; the route is the gap (mirror of O5).
- **SA-G2 — Presentation evidence.** The business may eventually want customer-facing acceptance evidence (signature, sent/viewed). Nothing exists; named for roadmap, not designed.
- **SA-G3 — Agreement list/workspace.** No index read exists (only per-opportunity get). If agreements need browsing outside their opportunity, that's a new read.

## Owner decisions required
Only SA-G1 (fund the route as part of implementation, or keep the panel presentation) — SA-G2/G3 are roadmap items, not blocking decisions. Everything else is answered by existing authority.

## Cross-object consistency
Same grammar (rule pair, serif reference title, bronze kicker, fact-row state sentence, 1fr/340 body, evergreen-ruled tables, chevron vocabulary where a real lifecycle exists) — different hierarchy per object: **Opportunity** leads with stage chevrons + next action (pursuit); **Agreement** leads with committed lines + money ladder + acceptance record and has NO chevrons (commitment — a gate, not a journey); **Sales Order** leads with fulfillment chevrons + operational work (execution). Relabeling any one as another would visibly fail: their strongest sections are different objects' truths.

## Acceptance checklist (for the eventual implementation pass)
- [ ] Whole-composition side-by-side vs 1a (Design + Owner)
- [ ] No chevrons; state stated once as a sentence with tone
- [ ] Money: one display path, minor units, currency-aware; drafts with unpriced lines claim no total
- [ ] Acceptance copy contains no signature language; evidence = timestamp + actor only
- [ ] Actions match state × permission with distinct sentences; accepted/declined offer no edit
- [ ] All six view states reachable and distinct; 375 has no horizontal overflow, targets ≥44px
