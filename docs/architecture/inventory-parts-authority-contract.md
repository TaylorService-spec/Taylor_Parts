---
artifact_type: authority-contract
gate: Authority Decision Gate (INV-CONVERGENCE-C)
status: Draft — awaiting Owner and ChatGPT review (docs-only draft PR); authorizes the adapter CONTRACT only, not implementation
date: 2026-07-25
owner: Claude Code (Inventory)
baseline: d57eff7e06b0b4365b24a792e0ad95ebba7831da (origin/main)
records: directional authority contract for the future read-only Inventory→Parts compatibility adapter
related_decisions: "DECISIONS.md #37, #40, #42, #43, #44, #45"
related_adrs:
  - docs/architecture/ADR-008-part-master.md
  - docs/architecture/ADR-006-equipment-and-installed-asset-management.md
authorizes: nothing to implement — no Rules, Functions, Firestore writes, source switch, static-catalog edits, or deployment
---

# Inventory → Parts authority contract (INV-CONVERGENCE-C)

Directional authority contract for the **future** read-only compatibility adapter that will let the existing Inventory → Parts workspace read canonical identity from Firestore `parts` while preserving every current workflow. This gate records **directions and non-authorities**; it defers each implementation decision to its dependent phase. It authorizes the **adapter contract only — not adapter implementation**.

**Hard scope:** no implementation, no Rules, no Functions, no Firestore writes, no source switch, no static-catalog edits, no deployment. Nothing here changes current availability behavior or any existing workflow.

This contract builds on and does not alter: Decision #43 (Inventory→Parts primary; `parts` canonical identity; Part Master is restricted scaffolding) and Decision #44 (P0 = JOIN_CLEAN — canonical `partId` == operational `TST-####` SKU). Per Decision #44's preserved interpretation, **JOIN_CLEAN proves identifier compatibility on the 2026-07-24 read-back; it does not authorize a source switch and does not replace live shadow-parity immediately before any future cutover.**

---

## 1. UD-3 — On-hand authority

A movement ledger alone **cannot** derive absolute on-hand: it needs either a complete movement history beginning at zero, or a governed opening balance. The target on-hand authority is therefore a **three-part composition**, not a ledger aggregate alone:

1. **Governed opening balance / inventory-initialization event** — the absolute starting quantity, under trusted-writer governance.
2. **Append-only inventory movement ledger** — `inventory_transactions` (RESERVED / RELEASED / CONSUMED), unchanged.
3. **Trusted calculated on-hand projection** — derived from (1) + (2).

**Deferred (implementation form of the opening balance):** either a governed opening-balance ledger event, or a separately controlled initialization record feeding the projection. Not chosen here.

**Interim:** static `warehouseQty` is preserved as an **explicitly temporary compatibility fallback**. It is **not** current stock truth and must never be described as such; current availability behavior is unchanged by this gate.

**Required before:** static client catalog retirement · Functions catalog-mirror retirement · any declaration that all availability is ledger-derived. Coordinates with the INV-1 enterprise-plan ledger work.

## 2. UD-4 — Field authority separation

Cost, selling price, and reorder policy are **distinct authorities** — not one "commercial" authority.

| Concept | Target authority | Explicit NON-authority |
|---|---|---|
| Canonical identity & governance | Firestore `parts` | not the static catalog; not supplier records |
| Supplier acquisition **cost** & supplier-specific terms | `part_supplier_items` / governed supplier catalog | not the Part document; not the price book |
| Customer-facing **selling price** | future pricing / price-book authority | **not** `part_supplier_items` (do not place selling price on supplier-item records merely because cost lives there); not the Part document |
| **Reorder policy** | governed inventory policy, scoped as required (warehouse, stock location, company, part class, or other approved operational scope) | **not** a single universal threshold permanently on the canonical Part |

**Interim adapter fallback (compatibility enrichment only):** static catalog `cost`, `price`, `reorderThreshold`, `warehouseQty`. These are explicitly distinguishable from canonical and ledger-derived fields (see §4 source classification) and **are not copied into Firestore `parts` in this gate**.

**Required before:** removal of each static fallback is gated on its authority's implementation and coordinated with the procurement and pricing gates.

## 3. UD-5 — Part Master navigation

Retain the current **restricted admin/dispatcher** Part Master registry through convergence. **No navigation or component change now.** The retain-admin-only vs delete decision is made at **Phase E**, after the operational Parts workspace exposes canonical identity and parity is proven.

---

## 4. First compatibility adapter contract

The future read model is a **layered composition** of three sources. Every output field carries an explicit **source/authority classification** so callers cannot confuse where a value came from.

**Source classifications:** `CANONICAL` · `STATIC_FALLBACK` · `LEDGER_DERIVED` · `WORKFLOW_DERIVED` · `HISTORICAL_SNAPSHOT`.

### 4.1 Layer 1 — Firestore `parts` (CANONICAL)
`partId` · `internalPartNumber` (when available) · `name` · `category` · `stockingUnit` · `status` · `controlType` · `stockingClass` · canonical governance fields.

### 4.2 Layer 2 — Static catalog compatibility fallback (STATIC_FALLBACK, temporary)
`cost` · `price` · `reorderThreshold` · temporary `warehouseQty` baseline. Compatibility enrichment only; each explicitly flagged `STATIC_FALLBACK`; retired per its UD-3/UD-4 dependency.

### 4.3 Layer 3 — Inventory ledger / workflow overlay
- `reserved` / `released` / `consumed` and **calculated availability using current, unchanged behavior** → `LEDGER_DERIVED`.
- reorder and purchasing workflow state → `WORKFLOW_DERIVED`.
- any denormalized Work Order snapshot values consumed for display → `HISTORICAL_SNAPSHOT` (never rewritten).

### 4.4 Field authority matrix (adapter output)

| Adapter output field | Source layer | Classification | Interim → target |
|---|---|---|---|
| `partId` | `parts` | CANONICAL | stable (== operational SKU, Decision #44) |
| `internalPartNumber` | `parts` | CANONICAL | populate when exposed |
| `name`, `category`, `stockingUnit`, `status`, `controlType`, `stockingClass` | `parts` | CANONICAL | stable |
| `cost` | static catalog | STATIC_FALLBACK | → `part_supplier_items` (UD-4) |
| `price` | static catalog | STATIC_FALLBACK | → pricing/price-book authority (UD-4) |
| `reorderThreshold` | static catalog | STATIC_FALLBACK | → governed reorder policy (UD-4) |
| `warehouseQty` (baseline) | static catalog | STATIC_FALLBACK | → opening-balance + projection (UD-3) |
| `reserved` / `released` / `consumed` / availability | ledger | LEDGER_DERIVED | behavior unchanged |
| reorder / purchasing state | reorder collections | WORKFLOW_DERIVED | unchanged |
| WO snapshot display values | `fieldops_wos.inventorySnapshot` | HISTORICAL_SNAPSHOT | never rewritten |

**This gate authorizes the adapter contract only, not adapter implementation.**

---

## 5. Interim vs target state (summary)

| Concept | Interim (now) | Target |
|---|---|---|
| On-hand / availability | static `warehouseQty` baseline − ledger movement (unchanged) | opening balance + append-only ledger → trusted on-hand projection |
| Cost | static `cost` (STATIC_FALLBACK) | `part_supplier_items` / supplier catalog |
| Selling price | static `price` (STATIC_FALLBACK) | pricing / price-book authority |
| Reorder policy | static `reorderThreshold` (STATIC_FALLBACK; engine already ignores it) | governed, scoped inventory policy |
| Identity & descriptive | static catalog reads | Firestore `parts` (CANONICAL) via adapter |
| Part Master nav | restricted admin/dispatcher registry | decided at Phase E |

---

## 6. Phase dependencies

- **UD-3 final implementation** → required before Phase F (static-catalog / Functions-mirror retirement).
- **UD-4 supplier / pricing / reorder-policy implementation** → required before removal of their respective static fallbacks; coordinated with procurement and pricing gates.
- **UD-5 final navigation decision** → required at Phase E, after source-switch parity.
- **Operational-role Firestore `parts` read broadening** → a **separate future Rules decision** before any operational source switch; **not required for this decisions-only gate** and not for a read-only shadow (admin/dispatcher already read `parts`).

---

## 7. Explicit non-authorities (do not institutionalize)

- The static catalog is **not** current stock truth and **not** canonical identity — it is temporary compatibility enrichment.
- `part_supplier_items` is **not** the home of customer-facing selling price.
- The canonical Part document is **not** the permanent home of a universal reorder threshold, nor of cost/price.
- A ledger aggregate **alone** is **not** a complete on-hand authority.
- JOIN_CLEAN is **not** authorization for a source switch, and does not replace live shadow-parity before cutover.

## 8. Deferred decisions

- Opening-balance implementation form (governed ledger event vs initialization record) — UD-3.
- Concrete supplier-cost, selling-price, and reorder-policy models and their scopes — UD-4.
- Retain-admin-only vs delete for Part Master — UD-5 (Phase E).
- Operational-role `parts` read-broadening Rules change — separate future gate (Phase C).

## 9. Safeguards — existing Inventory → Parts workflows preserved

- No change to current availability computation or any reorder / purchasing / receiving workflow.
- No Firestore writes, Rules, Functions, indexes, source switch, static-catalog edits, or deployment.
- `PartsList`, `PartDetail`, the role homes, and all operational queues remain exactly as they are; the adapter, when later built, is additive and read-only with per-field source classification so nothing silently changes authority.
- No historical ledger, reorder, or Work Order snapshot is rewritten at any phase.
