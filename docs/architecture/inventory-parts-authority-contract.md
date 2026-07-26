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

**Physical on-hand, reserved, and available are three different quantities and must not be conflated.** A movement ledger alone cannot derive absolute physical on-hand — it needs either a complete physical-movement history beginning at zero, or a governed opening physical balance — and **the current `inventory_transactions` event set (RESERVED / RELEASED / CONSUMED) is not a complete physical on-hand ledger.**

Definitions:
- **PHYSICAL ON-HAND** — the actual quantity physically present at a governed stock location.
- **RESERVED** — the portion of physical on-hand committed to work but still physically present.
- **AVAILABLE** — physical on-hand minus active reserved quantity.

Event effects: **RESERVED / RELEASED affect *availability*, not physical on-hand. CONSUMED reduces physical on-hand.** A complete physical on-hand projection additionally requires governed treatment of all approved physical stock movements — opening balance / initialization, receiving, positive and negative inventory adjustments, inbound and outbound transfers, consumption, cycle-count corrections, returns to stock, damage / loss / write-off, and other approved physical movement types — **none of which the current taxonomy fully covers.**

**Target authority (four parts):**
1. **Governed opening physical balance / initialization event** — the absolute starting quantity, under trusted-writer governance.
2. **Governed append-only physical inventory movement authority** — covering *all* approved quantity-changing events (the physical-movement taxonomy above).
3. **Governed reservation ledger / state** — for commitments that do not yet change physical possession.
4. **Trusted projections:**
   - `physicalOnHand` = opening balance + physical movements (2);
   - `reserved` = active reservation / release events (3);
   - `available` = `physicalOnHand − reserved`.

**Do not assume the current `inventory_transactions` event taxonomy is already sufficient for the final physical on-hand authority.** Two safe directions are recorded; **neither is chosen in this gate** — the final ledger topology is **DEFERRED** and must not be decided here unless the repository already proves it (it does not):
- **Direction A** — in a future separately governed phase, expand `inventory_transactions` to support the complete physical-movement taxonomy while preserving all historical event semantics; **or**
- **Direction B** — retain `inventory_transactions` as the work-order reservation/consumption ledger and establish a *separate* governed physical-stock movement ledger / projection.

**Deferred:** the implementation form of the opening balance (governed ledger event vs separately controlled initialization record) **and** the A-vs-B ledger topology.

**Interim (behavior unchanged):** static `warehouseQty` remains an **explicitly temporary compatibility baseline** — **not** physical on-hand truth and never described as such. The current reservation / release / consumption overlay and availability computation are unchanged; no new event types, no writes, no Functions, no source switch, no deployment in this gate.

**Required before:** static client catalog retirement · Functions catalog-mirror retirement · any declaration that availability (or physical on-hand) is ledger-derived. Coordinates with the INV-1 enterprise-plan ledger work.

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
- `reserved` / `released` / `consumed` and **calculated availability using current, unchanged behavior** → `LEDGER_DERIVED`. (Per §1, availability and physical on-hand are distinct; the interim overlay computes availability against the static baseline and is unchanged by this gate.)
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
| `warehouseQty` (baseline) | static catalog | STATIC_FALLBACK | → `physicalOnHand` projection from governed opening balance + physical movements (UD-3) |
| `reserved` / `released` / `consumed` | ledger | LEDGER_DERIVED | RESERVED/RELEASED affect availability; CONSUMED reduces physical on-hand (behavior unchanged) |
| `available` (= physicalOnHand − reserved) | ledger projection | LEDGER_DERIVED | interim computed against static baseline; target = governed physical-on-hand − reserved (UD-3) |
| reorder / purchasing state | reorder collections | WORKFLOW_DERIVED | unchanged |
| WO snapshot display values | `fieldops_wos.inventorySnapshot` | HISTORICAL_SNAPSHOT | never rewritten |

**This gate authorizes the adapter contract only, not adapter implementation.**

---

## 5. Interim vs target state (summary)

| Concept | Interim (now) | Target |
|---|---|---|
| Physical on-hand | static `warehouseQty` baseline (temporary; NOT physical truth) | `physicalOnHand` = governed opening balance + governed physical-movement authority (full taxonomy) |
| Reserved | current RESERVED/RELEASED overlay (unchanged) | governed reservation ledger/state (does not change physical possession) |
| Available | interim: baseline − active reservations (unchanged behavior) | `available` = physicalOnHand − reserved |
| Final ledger topology | n/a | **DEFERRED** — Direction A (expand `inventory_transactions`) vs B (separate physical-stock ledger) |
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
- The current `inventory_transactions` taxonomy (RESERVED / RELEASED / CONSUMED) is **not** a complete physical on-hand authority; a movement ledger **alone** (without a governed opening physical balance) is **not** a complete on-hand authority.
- **Reserved is not physical on-hand**, and **availability is not physical on-hand** — they are distinct quantities (physicalOnHand − reserved = available).
- JOIN_CLEAN is **not** authorization for a source switch, and does not replace live shadow-parity before cutover.

## 8. Deferred decisions

- **Final physical on-hand ledger topology — Direction A (expand `inventory_transactions` for the full physical-movement taxonomy) vs Direction B (separate governed physical-stock movement ledger)** — UD-3; not decided here.
- Opening-balance / initialization implementation form (governed physical-balance ledger event vs separately controlled initialization record) — UD-3.
- Concrete supplier-cost, selling-price, and reorder-policy models and their scopes — UD-4.
- Retain-admin-only vs delete for Part Master — UD-5 (Phase E).
- Operational-role `parts` read-broadening Rules change — separate future gate (Phase C).

## 9. Safeguards — existing Inventory → Parts workflows preserved

- No change to current availability computation or any reorder / purchasing / receiving workflow.
- No Firestore writes, Rules, Functions, indexes, source switch, static-catalog edits, or deployment.
- `PartsList`, `PartDetail`, the role homes, and all operational queues remain exactly as they are; the adapter, when later built, is additive and read-only with per-field source classification so nothing silently changes authority.
- No historical ledger, reorder, or Work Order snapshot is rewritten at any phase.
