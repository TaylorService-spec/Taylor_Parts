# End-to-End Sale→Delivery Lifecycle Audit (2026-08-13)

10 read-only agents traced the business object across every handoff (Opportunity→WON→Sales Order→Allocation→Work Order→Dispatch→Field Execution→Consumption→Completion→Equipment/custody→Invoice→AR), plus two cross-cutting lenses (state-propagation, conservation). Each distinguished a real **defect** from an **intentional not-yet-built seam** (the incremental Sales→Cash runway). Dedup'd against register.json + round3/round4-candidates.json.

Base: origin/main. This is NOT a "dispatch fixers now" list like site-work rounds 3/4 — most items are **latent behind `active:false` Sales→Cash capabilities**. It is a **runway-integrity map**: what's live-broken now, what integrity must be built-in as each capability activates, the one structural dead-end gating the fulfillment→billing tail, and where each chain intentionally stops.

## THE CAPSTONE — structural dead-end (build this to unlock the tail)
**`salesorder-fulfilledqty-never-written`** (`seamType: dead-end-state`, HIGH). SO line `fulfilledQty` is initialized to 0 (`salesOrderCommands.ts:98`) and **never written by any code in the repo** (one writer total). The `IN_FULFILLMENT→FULFILLED` gate (`salesOrderLifecycle.ts:66-73`, wired live in `transitionSalesOrder`) requires `fulfilledQty===orderedQty`; WO completion (`transitionEngine.ts`, `transitionWorkOrder.ts`) never touches `salesOrderId`/`fulfilledQty`. → Every SO wedges in IN_FULFILLMENT once activated; `computeBillingEligibility` (`billingEligibility.ts:46`) reports NOT_YET forever. **The missing WO-completion→SO-fulfillment write-back is the single gating link for the whole fulfillment→billing tail.** Owner decides: this is the next high-value slice of the Sales→Cash runway, not a patch.

## LIVE defect (fix now — fires today)
**`consumeparts-ignores-field-recorded-qtyused`** (`data-loss-across-seam`, HIGH, LIVE). `consumeParts()` (`inventoryService.ts:181-215`) always debits `qtyPlanned`, never reading the field-recorded `qtyUsed` on the same `inventorySnapshot` item. Its comment claims "qtyUsed has no populate path" — **false**: `updateWorkOrderExecutionData` is live/deployed and called from `PartsScanner`/`ExecutionCapture` today. → Ledger permanently consumes planned qty regardless of actual: phantom shrinkage when less used, invisible overage (clamped) when more. Physical stock vs the "sole source of truth" ledger diverge on every job where planned≠actual. **This one is fixable now** (make consumption consult qtyUsed within [0,qtyPlanned], and decide the overage policy).

## LATENT seam-integrity defects (build-in as each capability activates)
All behind `active:false` today; each fires the moment its capability is granted. Theme: **governed commands trust client-asserted upstream references without reading them**, and **allocation math** has a within-call gap.
| Discriminator | Seam | Problem |
|---|---|---|
| `won-to-so-no-referential-integrity` | WON→SO | `createSalesOrder` never reads the Opportunity for `sourceOpportunityId` — no existence/WON/account-match; SO can claim any/nonexistent/LOST lineage with unrelated data |
| `duplicate-so-per-won-opportunity` | WON→SO | no server-side dedup on `sourceOpportunityId` — one WON can mint multiple Sales Orders |
| `opportunity-missing-salesorder-backlink` | WON→SO | Opportunity never records which SO it produced — can't trace/detect the duplicate |
| `issueinvoice-unverified-so-pricing-and-qty` | Completion→Invoice | `issueInvoice` never `tx.get`s the Sales Order; recomputes totals from **client-supplied** unitPrice/qty/currency; header falsely claims "from committed SO snapshot"; `computeBillingEligibility` exists but is never called *(found independently by seam-8 and conservation lens — high confidence)* |
| `allocatesalesorder-duplicate-ref-lines-double-allocate` | SO→Allocation | one shared availability pool per ref, but `buildAllocationPlan` maps per-line without decrementing across siblings, and the write uses `Array.find(p=>p.ref===l.ref)` (first match) → ATP=5 + two lines of 5 each → both recorded allocatedQty=5. Distinct from #880 (rerun); this is one invocation |
| `setworkorderpartsplan-no-lifecycle-status-guard` | WO→Dispatch | `setWorkOrderPartsPlan` never checks `wo.status` — parts plan rewritable after CLOSED/CANCELLED (same class as the round-3 C2 terminal-guard fix, different callable) |

**Secondary (lower-confidence, flagged):** `Dispatch.jsx` filters technicians to AVAILABLE while `DispatcherBoard` offers all, and the server checks neither `TECH_STATUS` — cross-surface inconsistency.

## KNOWN-SEAM MAP — where each chain intentionally stops (the remaining runway)
Not defects; the incremental build hasn't reached them (mostly self-documented). This is the durable "where does the chain STOP" map.
| Chain stop | Where | Note |
|---|---|---|
| Opportunity WON → Sales Order | no trigger/UI/data-copy | WON is a clean terminal patch; no automated or UI path creates the SO yet |
| SO Allocation → Work Order parts plan | `createServiceForSalesOrder` | creates the WO with no `inventorySnapshot`; drops ordered/allocated qty — **documented follow-on** (`docs/design/sales-order-to-service-cycle7.md`). Load-bearing: without it a dispatched WO has zero planned parts. Prioritize building alongside the capstone |
| SCHEDULED → reschedule | `transitionEngine.ts:33` | only DISPATCHED/CANCELLED; re-timing is a documented "governed follow-on" |
| Completion → billing eligibility | no `BILL_NOW` producer | nothing computes billing-eligibility from a completed WO/fulfilled SO |
| Completion → Equipment/custody | `completeAssignedJob`/`transitionWorkOrder` | never creates Equipment, links serial, or transfers custody; pure modules deliberately non-persisting; Ventana two-condition exit (install-complete AND sale-closed) structurally unreachable pending D-5 + P1a |

## Recommendation
1. **Fix now (Tier-1, live):** `consumeparts-ignores-field-recorded-qtyused`. Optionally `setworkorderpartsplan-no-lifecycle-status-guard` (cheap terminal-guard, matches C2).
2. **Next runway slice (highest leverage):** the **WO-completion→SO-`fulfilledQty` write-back** (capstone) + the **SO→Service parts-plan wiring** (cycle-7 follow-on) — together these make the fulfillment→billing tail actually reachable.
3. **Build-in as each Sales→Cash capability activates:** the 5 latent referential-integrity / dedup / back-link / allocation-duplicate-ref defects — turn each into an acceptance criterion on the corresponding capability's activation PR, so they're closed *before* the capability goes live, never after.
4. The known-seam map = the remaining runway; sequence per the Owner velocity mandate.
