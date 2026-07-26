---
artifact_type: assessment
unit: INV-CONVERGENCE-E Stage D — approved-ten static-only disposition
gate: Owner decision (approved-ten)
status: Approved — Owner decision recorded 2026-07-26 (all ten KEEP_VISIBLE_STATIC_ONLY_EXCLUDED; UQ-D1/D2/D3 resolved); docs-only, authorizes no implementation
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: db5fc5bf85cd2c6b562fea50741b7eddc5255821 (origin/main)
related_decisions: "DECISIONS.md #42 (D-M3), #43, #44, #46"
authorizes: nothing — no Firestore writes, static-catalog edits, adapter edits, PartsList/PartDetail change, or deployment
---

# INV-CONVERGENCE-E Stage D — approved-ten static-only disposition

Governed Owner-disposition package for the ten static-only Part records excluded from the canonical `parts` migration (Decision #42 D-M3; identity proven by INV-CONVERGENCE-B). **Docs-only; authorizes no implementation.** A **hard prerequisite** (with Stage B) for any C1 PartsList cutover — the ten must have an explicit disposition so cutover never silently drops them.

## 1. Scope and method
Docs-only assessment. No Firestore writes, static-catalog edits, adapter edits, PartsList/PartDetail changes, or deployment. Per-record evidence is **repository-grounded**; production ledger/reorder/PO/Work-Order-snapshot references are **not determinable from the repository** (no production data access) and are marked accordingly — which, per the default policy, supports keeping the record visible until such references are production-verified absent.

**Repository facts (baseline `db5fc5b`):**
- All ten exist in `field-ops-app-vite/src/data/partsCatalog.ts` (static catalog) with full fields (§3).
- All ten are **absent** from the 190 canonical production `parts` and from the 190-row migration input (INV-CONVERGENCE-B; live run sourceCounts static=200 / canonical=190).
- The **only** repository reference to the ten (beyond the static catalog) is the adapter's governed `APPROVED_STATIC_ONLY_EXCLUSIONS` constant (`src/domain/partsCompatibilityAdapter.js:32-35`) — by design. **No test, fixture, or other code references any of the ten individually** (verified by repo-wide grep).
- Production reference status (ledger / reorder / PO / WO snapshots) per SKU: **NOT DETERMINABLE FROM REPOSITORY.**

## 2. Allowed dispositions
1. `KEEP_VISIBLE_STATIC_ONLY_EXCLUDED`
2. `RETIRE_AFTER_DEPENDENCY_CLEARANCE`
3. `PROMOTE_TO_CANONICAL` — only if separately justified; **no write authorized here**
4. `BLOCKED_PENDING_EVIDENCE`

**Default (policy):** `KEEP_VISIBLE_STATIC_ONLY_EXCLUDED` unless record-specific evidence proves retirement is safe.

## 3. Decision table (all ten)

| SKU | Evidence summary (static identity) | Dependency status | Proposed disposition | Rationale | Required follow-up | Rollback consideration |
|---|---|---|---|---|---|---|
| TST-1047 | Hopper Agitator - Pro Series · Mix System · ea · cost 45 / price 97.39 · reorderThreshold 2 · warehouseQty 6 | repo: none but adapter exclusion const; prod ledger/reorder/PO/WO: **unknown** | KEEP_VISIBLE_STATIC_ONLY_EXCLUDED | retirement not provably safe (prod refs unknown); no test/fixture dep | production evidence of zero ledger/reorder/PO/WO reference before any RETIRE | none — KEEP = current behavior (no-op) |
| TST-1070 | Door Gasket - Gen II · Seals & Gaskets · ea · 3.12 / 8.03 · rt 3 · wq 6 | same | KEEP_VISIBLE_STATIC_ONLY_EXCLUDED | same | same | none (no-op) |
| TST-1074 | Sanitizer Solution 32oz · Cleaning Supplies · bottle · 9.07 / 15.95 · rt 3 · wq 10 | same | KEEP_VISIBLE_STATIC_ONLY_EXCLUDED | same | same | none (no-op) |
| TST-1080 | Syrup Pump - Single Flavor · Mix System · ea · 30.78 / 79.95 · rt 3 · wq 15 | same | KEEP_VISIBLE_STATIC_ONLY_EXCLUDED | same | same | none (no-op) |
| TST-1112 | Front Panel Assembly - Countertop · Cabinet Parts · ea · 37.06 / 92.1 · rt 3 · wq 8 | same | KEEP_VISIBLE_STATIC_ONLY_EXCLUDED | same | same | none (no-op) |
| TST-1136 | Brush Kit — Large - Single Flavor · Cleaning Supplies · kit · 21.9 / 42.2 · rt 1 · wq 20 | same | KEEP_VISIBLE_STATIC_ONLY_EXCLUDED | same | same | none (no-op) |
| TST-1143 | Mix Pump Assembly - HD · Mix System · ea · 111.78 / 307.91 · rt 4 · wq 6 | same | KEEP_VISIBLE_STATIC_ONLY_EXCLUDED | same | same | none (no-op) |
| TST-1175 | Auger Shaft - Single Flavor · Drive Components · ea · 53.47 / 137 · rt 1 · **warehouseQty 0** | same | KEEP_VISIBLE_STATIC_ONLY_EXCLUDED | same; note wq=0 (informational only — static baseline, not stock truth) | same | none (no-op) |
| TST-1189 | Brush Kit — Small - Compact · Cleaning Supplies · kit · 12.49 / 25.86 · rt 2 · wq 10 | same | KEEP_VISIBLE_STATIC_ONLY_EXCLUDED | same | same | none (no-op) |
| TST-1193 | Compressor 1 HP - Countertop · Compressors · ea · 158.17 / 406.49 · rt 2 · wq 10 | same | KEEP_VISIBLE_STATIC_ONLY_EXCLUDED | same | same | none (no-op) |

**Summary:** all ten → **`KEEP_VISIBLE_STATIC_ONLY_EXCLUDED`** (default). None qualifies for `RETIRE_AFTER_DEPENDENCY_CLEARANCE` today (dependency clearance not provable from the repository); none is justified for `PROMOTE_TO_CANONICAL`; none is `BLOCKED_PENDING_EVIDENCE` in the sense of blocking cutover — KEEP_VISIBLE is safe and requires no evidence. The Owner may override any row with record-specific production evidence.

## 4. What "retire" means (UI and data)
- **UI:** a retired SKU would no longer render in PartsList/PartDetail or Global Search results, and its detail route would no longer resolve to a live row (it would behave like any absent SKU). Retirement happens **only after dependency clearance**.
- **Data — retirement is NOT deletion.** Ordered from least to most invasive: (a) **hidden** (UI filter only; row remains in the static source); (b) **inactive** (a governed status excludes it from operational surfaces; still present); (c) **removed from the static source** (Phase F static-catalog removal — only after canonical convergence + dependency clearance); (d) **deleted** — **PROHIBITED**.
- **Prohibition on destructive deletion:** the ten (and any part) are **never** hard-deleted. Historical Work Order `inventorySnapshot` and `inventory_transactions`/reorder references are **append-only and immutable** and must be preserved; retirement must never orphan or rewrite them.

## 5. Exact prerequisite before any future static-catalog removal (Phase F)
Removing any of the ten from the static source requires **all** of:
1. **Production-verified zero references** for that SKU across `inventory_transactions`, `reorder_requests`, `reorder_purchase_orders`, and Work Order `inventorySnapshot` (append-only history preserved regardless);
2. the SKU's identity/commercial data is either **canonical** (promoted under a separate governed write gate) or **intentionally dropped** under an explicit Owner decision;
3. UD-1 (the discontinued-parts manifest) reconciled and the 200↔190 delta enumerable/auditable;
4. UD-3 (the static `warehouseQty` availability baseline) replaced by the governed on-hand projection, so removal cannot break availability;
5. the adapter's `APPROVED_STATIC_ONLY_EXCLUSIONS` set updated in the same governed change.

Until then, the ten **remain visible** and no static-catalog removal is authorized.

## 6. Owner decisions (RESOLVED — 2026-07-26)

**Disposition of all ten:** the Owner **APPROVES all ten SKUs** (TST-1047, TST-1070, TST-1074, TST-1080, TST-1112, TST-1136, TST-1143, TST-1175, TST-1189, TST-1193) as **`KEEP_VISIBLE_STATIC_ONLY_EXCLUDED`**. This is the recorded Owner decision, not merely the default recommendation.

- **UQ-D1 — RESOLVED:** production reference evidence is **not required** for the current keep-visible disposition. A **governed production reference assessment is mandatory before any future proposal** to (a) hide, (b) inactivate, (c) remove from the static catalog, or (d) retire after dependency clearance. No such proposal is authorized here.
- **UQ-D2 — RESOLVED:** **do not introduce a durable canonical lifecycle/`status` field in Stage D.** Continue using the governed `APPROVED_STATIC_ONLY_EXCLUSIONS` compatibility mechanism through C1 and C2. Any durable lifecycle model requires a **separate specification and decision**.
- **UQ-D3 — RESOLVED:** **none of the ten is approved for `PROMOTE_TO_CANONICAL`** in this unit. Any future promotion requires a **separate governed CREATE/write gate**.

**Boundaries preserved by this decision:** no deletion · no hiding · no canonical creation · no static-catalog edit · no adapter implementation change · no Firestore write · no deployment · no C1 authorization. The ten remain visible with `identityState = STATIC_ONLY_EXCLUDED`; behavior is unchanged (KEEP_VISIBLE is a no-op).

## 7. Non-authorizations
No Firestore writes, static-catalog edits, adapter edits, PartsList/PartDetail changes, or deployment. This package records a disposition recommendation for Owner decision; it does not itself change behavior. Decisions #43–#46 unchanged. This is a prerequisite (with Stage B) for C1; it does not authorize C1.
