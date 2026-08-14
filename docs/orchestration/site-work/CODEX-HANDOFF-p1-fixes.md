# Codex Handoff — P1 build-defect fixes (post-P1 re-audit)

Repo: `TaylorService-spec/Taylor_Parts`, base `main`. **Everything repo-only. NEVER: deploy, edit `firestore.rules`, touch production, grant/activate capabilities (all stay `active:false`), or auto-merge without CI green.**

Full finding detail: `docs/orchestration/site-work/lifecycle-reaudit-post-p1.md` (BD-1…BD-15). Governing decisions: `docs/roadmaps/sales-to-cash-lifecycle-build-plan.md` (settled decisions #1–#3) + `docs/design/p1-fulfillment-billing-spine-spec.md`. **Owner ratified for BD-2: AUTO-ADVANCE** (see CX-1).

## Context
The P1 fulfillment→billing spine (PRs #945–952) passed CI but is a **silent no-op for PART lines**: the WO-completion `fulfilledQty` write-back keys PART acceptances by `sku` while SO lines key by `partId`, so acceptances never match and are dropped. Fix that and the other build defects below. CI was green because one emulator test's fixture used `ref === sku` — that test MUST be fixed to use real `partId ≠ sku`.

## Execution rules (per work-item)
- One PR per CX item, base `main`, title `fix(...): <desc> (p1-fix CX-N)`. Do NOT merge; Owner/Codex merges only after CI green.
- Focused test that FAILS pre-fix / PASSES post-fix. Capabilities stay `active:false`.
- **Infra guards (worktrees share a git-stash stack + emulator port):** do NOT use `git stash` (cp files for fail-pre); use a UNIQUE emulator port and never kill another emulator; run synchronously (no background-wait). See `docs/orchestration/site-work/` register note / memory `reference_worktree_fleet_shared_infra_hazard`.
- Items are file-disjoint (below) → safe to parallelize.

## Work-items (do CX-1 FIRST — it makes P1 actually work)

### CX-1 (CRITICAL) — write-back correctness + auto-advance + CI  [BD-1, BD-9, BD-2, BD-7]
Files: `functions/src/transitionWorkOrder.ts`, `functions/src/salesOrder/salesOrderFulfillmentWriteBack.ts` (if needed), `functions/test/salesOrderFulfillmentWriteBackEmulator.test.mjs`, the CI workflow + `functions/package.json`.
- **BD-1:** in `transitionWorkOrder.ts`'s Complete-action derivation (~lines 238-245), key PART fulfillment acceptances by the SO line's identity = **`partId`** (the `inventorySnapshot` item's `partId`, which equals the SO line `ref`), NOT `item.sku`. So a PART acceptance matches the SO PART line under `applyFulfillmentAcceptance`'s `(ref,kind)` match.
- **BD-9:** for PART lines with no recorded actuals, derive qty as **`qtyUsed ?? qtyPlanned`** (consistent with consumeParts P0.1), not `0` — so a completed WO with no partial actuals counts as full planned fulfillment. (Overage used>planned stays the deferred governed exception path — unchanged.)
- **BD-2 (Owner: AUTO-ADVANCE):** after the write-back updates the SO lines in the same Complete transaction, if `allLinesFulfilled(nextLines)` becomes true, advance the SO `IN_FULFILLMENT→FULFILLED` **in the same transaction**, routed through the governed lifecycle authority (`salesOrderLifecycle.ts` `checkTransition`) rather than a raw state write where feasible (this also reconciles BD-13's asymmetry). No-op when there's no `salesOrderId` or not all lines fulfilled.
- **BD-7 + masking test:** rewrite the emulator test fixture to use a real `partId ≠ sku` (e.g. SO line `ref: 'P-1'`, inventorySnapshot `{partId:'P-1', sku:'IPN-1'}`) and assert PART `fulfilledQty` actually increments and the SO reaches FULFILLED. Then WIRE `salesOrderFulfillmentWriteBack.test.mjs` + the emulator variant into a CI workflow (add to the sales-order or work-order functions workflow run step + a `functions/package.json` script) so they actually run in CI.

### CX-2 — invoice conservation  [BD-3, BD-4, BD-4b]
Files: `functions/src/finance/invoiceCommands.ts`, `functions/src/finance/invoiceCallables.ts`, `functions/src/salesOrder/salesOrderCommands.ts` (schema).
- **BD-4:** in `verifySalesOrderMatch`, index SO lines by **`(ref,kind)`**, not bare `ref` (same class P1.1 fixed).
- **BD-4b:** accumulate `billableQty` across duplicate-ref input lines in one call; reject if the sum exceeds eligible.
- **BD-3:** add a per-line `billedQty` (or `invoicedQty`) to the SO schema; `issueInvoice` must enforce `billableQty ≤ min(orderedQty,fulfilledQty) − alreadyBilled` and write back the increment to the SO in the same transaction. Prevents a 2nd invoice (different idempotencyKey) re-billing already-billed qty.

### CX-3 — direct createSalesOrder line fidelity  [BD-5]
File: `functions/src/salesOrder/salesOrderCallables.ts`. When `sourceOpportunityId` is set, cross-validate the client `lines` (kind/ref/qty) against the Opportunity's lines and reject divergence — so a valid WON id can't lend legitimacy to unrelated line data. (The governed `createSalesOrderFromOpportunity` path already derives lines server-side — leave it.)

### CX-4 — allocation SERVICE pooling + kind-scoped keys  [BD-6, BD-10]
Files: `functions/src/fulfillment/allocateSalesOrder.ts`, `functions/src/fulfillment/allocationProjection.ts`. SERVICE lines are unconstrained ("always allocatable") — do NOT apply P1.7's per-ref pool decrement to SERVICE. Key the availability pool / `remainingByRef` by **`(kind,ref)`**, not bare `ref`, so PART/EQUIPMENT_MODEL/SERVICE (and duplicate-ref SERVICE) never share one pool. Preserve the PART duplicate-ref fix (#949) and self-netting (#880).

### CX-5 — Opportunity requires ≥1 line to reach WON  [BD-8]
Files: `functions/src/opportunity/opportunityCommands.ts`, `functions/src/opportunity/opportunityLifecycle.ts`. Reject the WON outcome transition (or require at create) when the Opportunity has zero lines — closing the permanent dead-end against P1.3's fail-closed derive.

### CX-6 — createSalesOrderFromOpportunity idempotency scope  [BD-11]
File: `functions/src/opportunity/createSalesOrderFromOpportunity.ts`. Include `opportunityId` in the deterministic audit-id (or verify the replayed audit event's opportunityId matches the request) so a reused key across two Opportunities can't return a reply mislabeled with the wrong SO id.

### CX-7 (LOW) — stale typing  [BD-15]
Files: `functions/src/fulfillment/coordinatedVisit.ts`, `functions/src/fulfillment/coordinatedFieldMission.ts`. Update `salesOrderLineRefs` typing from `string[]` to the `SalesOrderLineRef[]` shape P1.2 now writes (import the type from `types/workOrder.ts`).

### Deferred (intentional — note, don't build unless asked)
- BD-14 (qtyPlanned=orderedQty when allocatedQty=0: WO creatable before allocation) — accept or gate on allocation; Owner call.
- BD-13 (CONFIRMED→IN_FULFILLMENT raw write) — largely reconciled by CX-1's governed auto-advance; revisit if it remains asymmetric.

## After the batch
Codex integrates each PR (CI green → squash-merge), then a short re-verify of CX-1 end-to-end (a real PART-line SO→Service→WO→Complete drives fulfilledQty→FULFILLED→billing eligibility). Report status to the Owner (sole conduit). Claude will re-sync from `main` next window.
