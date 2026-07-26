---
artifact_type: implementation-plan
unit: INV-CONVERGENCE-E Stage A COMPLETION — live readers, build id, reviewed route
status: Draft — PLAN ONLY, awaiting Owner and ChatGPT review; authorizes no implementation
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: 02af217d13efbc337464cbf419299eb324c324a4 (origin/main)
builds_on: docs/implementation-plans/inv-convergence-e-stage-a-implementation-note.md
related_decisions: "DECISIONS.md #43, #44, #45"
authorizes: nothing — plan only; no code, Rules, writes, source switch, or deployment
---

# INV-CONVERGENCE-E Stage A COMPLETION — plan

Completes the merged Stage A **foundation** (PR #423, current-vs-shadow parity engine) into an executable, admin/dispatcher-only diagnostic that can produce **Decision #44 live pre-cutover parity** evidence. **Plan only — authorizes no implementation.** No Rules changes, no Firestore writes, no source switch, no deployment, no PartsList/PartDetail behavior change, no ordinary Inventory navigation exposure.

Stage A is **not complete** until this plan's separate, reviewed implementation ships. Until then the foundation reader bundle deliberately returns `BLOCKED_INCOMPLETE_INPUT` on a live run.

## 1. Exact existing reader functions and collections (identified before any code)

| Bundle input | Collection | Existing one-shot reader | Status | Completion action |
|---|---|---|---|---|
| `ledgerReader` | `inventory_transactions` | **`fetchInventoryTransactions()`** — `src/services/operationsQueries.ts:78` (`listCollection`, one-shot `getDocs`; the same call `useInventoryLedger.js:24` and Operations use) | **Exists — reuse directly** | Wrap to the `{ok,rows}` reader contract; one call; no subscription |
| `reorderReader` | `reorder_requests` (`src/domain/constants.js:169`) | One-shot `getDocs(collection(db, REORDER_REQUESTS_COLLECTION))` is already used inside `useReorderRequests.js` (history path), but there is **no standalone service function** | **Partial — add a one-shot service fn** | Add `fetchReorderRequests()` mirroring `listCollection` over the **same** `reorder_requests` collection — no `where`/`orderBy` added ⇒ **no new query surface**; one-shot; no `onSnapshot` |
| `purchaseOrderReader` | **`reorder_purchase_orders`** (`src/domain/constants.js:287`, the **live** reorder PO) | Read today only via per-doc `onSnapshot` (`useReorderPurchaseOrders.js:21-22`); **no collection-level one-shot reader** | **Missing — add a one-shot service fn** | Add `fetchReorderPurchaseOrders()` = one-shot `getDocs` over `reorder_purchase_orders`; no filters, no subscription. **NOT** the dormant Epic-5 `purchase_orders` (`operationsQueries.fetchPurchaseOrders`) — that is a different, inert collection |

**Notes / risks to resolve in the implementation gate:**
- The two new service functions are *new code* but reuse the **same collections** already read elsewhere — no new query surface, no new index, no filter change.
- These are **full-collection one-shot reads** (like the existing ledger read). Acceptable at current data volume; if volume grows, add pagination in the reader (still one logical capture; document any cap in the evidence).
- Availability continues to reuse the **existing** `computeAvailableStockByPart` semantics already mirrored in the foundation (`warehouseQty − (reserved − released)`); **no new inventory mathematics**.
- Read access: the diagnostic is admin/dispatcher-gated and these collections are already admin/dispatcher-readable under current Rules — **no Rules change**.

## 2. Deterministic application/build identifier

Replace the foundation's `adapterCommit: null` with a **deterministic build/commit identifier** injected at build time (e.g. a Vite `define` such as `__APP_COMMIT__`, or `import.meta.env.VITE_APP_COMMIT`, sourced from the git SHA in the build config). The pure core already **requires** it: a missing/`"unknown"` value yields `BLOCKED_INCOMPLETE_INPUT`, so an unidentified build cannot PASS. (Touches the build config only; named here, authorized in the implementation gate.)

## 3. Selected diagnostics access path

**Selected (one implementation, not a choice):**
- **Route:** `/admin/diagnostics/inventory-parts-parity`.
- **Navigation — Option A (selected):** a **direct operator-only route with NO navigation entry**. Not added to Inventory navigation, and not linked from PartsList/PartDetail. (Option B — a link from an already-restricted Administration diagnostics surface — is **not** selected.)
- **Authorization:** authenticated session required **and** role is `admin` or `dispatcher`, enforced through the **existing application access / no-access pattern** (`isDiagnosticsAuthorized(role)` at the component, plus the same route-gating the app already uses for restricted surfaces). Unauthorized users get the **standard No Access state** — access is **not** by route obscurity alone. **Firestore Rules remain unchanged** (admin/dispatcher already read the involved collections).
- **Isolation:** isolated from PartsList/PartDetail (no import either direction); **no change to PartsList/PartDetail behavior**. The route registration (an `App.jsx`/route-registry edit) is the single consumer-surface change, done **only** in the reviewed implementation gate; it adds **no** Inventory nav entry.

## 4. Live execution behavior + sanitized evidence capture

Wire the production reader bundle to the §1 readers + §2 build id, run `captureShadowParity` on **manual operator start**, and render the sanitized result (counts/hash/timestamps/`{key,kind}` summaries). Execution rules:
- the operator **starts the run manually**;
- **only one run may be active** in the component at a time — repeated clicks while a run is in flight are **ignored/disabled**;
- the result is **ephemeral in memory**; a **refresh clears** it;
- **no background execution**, **no automatic persistence**, **no Firestore write**.

Optional archival remains a **separate reviewed operator step**: a manual sanitized export committed under `docs/audits/inv-convergence-e-stage-a/` (SHA-256 + attestation).

### 4.1 Decision #44 evidence qualification

- **Only a live exported result with `status = PASS`** can satisfy the Decision #44 live pre-cutover parity gate.
- That PASS evidence **must include** the required sanitized fields: the parity/source **counts**, the **static-catalog hash**, the **application/build identifier**, the **run ID**, and the **capture timestamps**.
- **`FAIL_PARITY` and all `BLOCKED_*` results do NOT satisfy the gate.** They may be exported **only as diagnostic evidence**, never as pre-cutover clearance.
- Manual export **and** repository commit of the PASS artifact remain a **separate reviewed operator step**; the committed PASS artifact is the Decision #44 evidence.

## 5. Acceptance for the implementation gate

- All three readers are one-shot, invoked at most once per run, with **no active subscriptions** during comparison; **only one run active at a time** (repeated clicks ignored/disabled).
- A live run over production `parts` + the three snapshots yields `PASS` reproducing the expected totals (200 source / 190 CANONICAL_MATCH / 10 STATIC_ONLY_EXCLUDED / 0 row-missing / 0 field / 0 availability / 0 workflow divergence) — and **only** an exported `PASS` (with counts, catalog hash, build id, run ID, timestamps) is the Decision #44 live pre-cutover parity (§4.1).
- A denied/unavailable canonical read → `BLOCKED_*`; a missing snapshot or build id → `BLOCKED_INCOMPLETE_INPUT`. `FAIL_PARITY`/`BLOCKED_*` never satisfy the gate.
- Diagnostics reachable only by admin/dispatcher via `/admin/diagnostics/inventory-parts-parity` (Option A, no nav entry, standard No Access state for others); not in ordinary Inventory nav; PartsList/PartDetail unchanged.

## 6. Non-authorizations and dependencies

- **Authorizes nothing here.** The implementation is a separate, reviewed gate; deployment of any build-config change is its own step.
- No Rules changes, no Firestore writes, no source switch, no deployment, no historical rewrite.
- This is Stage **A** only. It gates, and does not perform, the later stages: D (approved-ten disposition) and B (operational-role Rules) — both prerequisites — then C1/C2 cutover (see `inv-convergence-e-shadow-read-and-convergence.md`). Decisions #43–#45 unchanged.
