---
artifact_type: implementation-note
unit: INV-CONVERGENCE-E Stage A COMPLETION — live readers, build id, gated route (implementation)
status: Draft — awaiting Owner and ChatGPT final review (additive code + tests; draft PR)
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: 6b99bda8e6e22784c04056e6e33c4cc5b0348fcf (origin/main)
implements: docs/implementation-plans/inv-convergence-e-stage-a-completion-plan.md
related_decisions: "DECISIONS.md #43, #44, #45"
authorizes: no deployment; read-only diagnostic; no Rules, writes, source switch, or PartsList/PartDetail behavior change
---

# INV-CONVERGENCE-E Stage A COMPLETION — implementation note

Completes the merged Stage A foundation (PR #423) into an executable, admin/dispatcher-only, read-only shadow-parity diagnostic. Follows the approved completion plan (PR #424). No Rules changes, no Firestore writes, no source switch, no deployment, no PartsList/PartDetail behavior change, no ordinary Inventory navigation exposure.

## Live one-shot readers (existing paths reused)
`src/services/operationsQueries.ts` gains two one-shot list readers mirroring the existing `listCollection` (`getDocs`; no subscription, no filter/index/query-shape change):
- `fetchReorderRequests()` → `reorder_requests`
- `fetchReorderPurchaseOrders()` → the **live** `reorder_purchase_orders` (**not** the dormant Epic-5 `purchase_orders`)

The ledger reuses the existing `fetchInventoryTransactions()` (`inventory_transactions`).

## Reader-outcome wrapper (offline-testable)
`src/domain/partsShadowParityReadOnce.js` — pure `readOnce(fetchFn)` turns a throwing `getDocs` into `{ ok:true, rows } | { ok:false, code }`, mapping `permission-denied` → `"permission-denied"`, else `"unavailable"`. Unit-tested with injected fakes; one call per read.

## Production reader bundle wired
`src/modules/inventory/partsShadowParityReaders.js` now wires: canonical `fetchPartMasterList`, static `PARTS_CATALOG`, and `ledgerReader/reorderReader/purchaseOrderReader` = `readOnce(fetch…)`. `adapterCommit = __APP_COMMIT__` (below); when absent/`"unknown"` the pure core resolves `BLOCKED_INCOMPLETE_INPUT` (never a false PASS). Overlays are still **derived inside the pure core** from the captured snapshots; availability reuses the existing `computeAvailableStockByPart` semantics (no new math).

## Deterministic build identifier
`vite.config.js` injects `__APP_COMMIT__` (git short SHA at build time; `"unknown"` fallback). `src/globals.d.ts` declares it. Build-time constant only — no runtime/routing/Rules/authorization effect.

## Dedicated gated route (Option A — operator-only, no nav entry)
`src/App.jsx` registers **`/admin/diagnostics/inventory-parts-parity`** rendering `PartsShadowParityDiagnostics`. It is **not** a navigation entry (no Inventory/nav exposure) and is reached only by direct URL. The component self-gates via `useAuth` + `isDiagnosticsAuthorized(role)` (admin/dispatcher), rendering the **standard No Access** state otherwise — a real gate, not route obscurity. **Firestore Rules unchanged.** Isolated from PartsList/PartDetail (no import either direction; no behavior change).

## Execution behavior
Manual start via a **Run** button; **only one run active at a time** (button `disabled` while running; repeat clicks ignored via an early `if (running) return`); result **ephemeral in memory**; **refresh clears** it (state resets on mount); **no background execution**, **no automatic persistence**, **no Firestore write**.

## Decision #44 evidence qualification (unchanged from the plan)
Only a live exported `status = PASS` (with sanitized source/parity counts, static-catalog hash, application/build id, run ID, capture timestamps) satisfies the Decision #44 live pre-cutover parity gate. `FAIL_PARITY` and all `BLOCKED_*` do **not** satisfy it (diagnostic evidence only). Manual export + repository commit remain a **separate reviewed operator step**.

## Tests (offline; registered in `npm test`)
- `partsShadowParityReadOnce.test.mjs` (4) — success→{ok,rows} one call; `permission-denied`→code; other→`unavailable`; non-array→[].
- `partsShadowParityView.test.mjs` (13) — + reader bundle wires the one-shot readers via `readOnce` + `__APP_COMMIT__`; new readers use the live reorder collections (not dormant `purchase_orders`); dedicated route present and **no nav entry**; route authorization via the component gate (standard No Access); execution manual/single-active-run/ephemeral/no-persistence/no-writes.
- Preserved: `partsShadowParity` (21), `partsShadowParityCapture` (8) — current-vs-shadow comparison, snapshot-derived overlays, injected-overlay-cannot-bypass, every BLOCKED incl. missing-commit, purity, sanitization, PartsList/PartDetail isolation.

Full `npm test` chain, `typecheck`, `oxlint`, and `build` are green (the build injects the git SHA as `__APP_COMMIT__`). **No deployment.** Decisions #43–#45 unchanged; no contradiction found.

## Not done (separate steps)
No deployment of the build-config change; no live run executed here; the exported PASS artifact (Decision #44 evidence) is a separate reviewed operator step. Stage A only — it gates, and does not perform, D (approved-ten) and B (operational-role Rules) then C1/C2.
