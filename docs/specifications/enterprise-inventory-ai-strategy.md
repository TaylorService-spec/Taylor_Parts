---
artifact_type: specification
gate: Sprint Specification
status: Draft — awaiting Architecture Review
date: 2026-07-21
owner: Claude Code (Inventory)
related_adrs:
  - docs/architecture/ADR-003-inventory-trigger-system.md
  - docs/architecture/ADR-004-technician-recommendation-engine.md
  - docs/architecture/ADR-007-governed-object-based-report-creator.md
depends_on:
  - docs/specifications/enterprise-inventory-architecture.md
implements: Owner authorization "Begin INV-1 Governance and Architecture" (2026-07-21)
supersedes: none
superseded_by: none
related_pr: TBD (this PR)
target_release: none — governance artifact only
---

# Enterprise Inventory AI Strategy — Enterprise Operations OS

**Derived from:** `docs/specifications/enterprise-inventory-architecture.md` (the "Spec"). **This document authorizes NO implementation.** It designs the AI recommendation layer for the inventory domain, company-neutral; Taylor Parts is the reference implementation only.

Verified against `origin/main` @ `8ebf140`.

---

## 1. Position in the platform

AI here is the **AI Decision Support platform service** (PROJECT_ARCHITECTURE classification A) applied to the inventory capability family. Precedents honored: ADR-004 (Technician Recommendation Engine — deterministic, recommend-only, implemented and live in `technicianRecommendationEngine.ts`/DispatcherBoard); the zero-history reorder behavior (`NEEDS_PLANNING` — the platform already refuses to fabricate recommendations without data); the roadmap's Phase 6 requirement that any AI-assisted workflow ship "under the AI-SDLC gates."

The single most important structural fact: the inventory domain's source of truth is an **append-only event ledger**. That is exactly the substrate AI needs — complete, immutable, timestamped history. No new data collection is required for the first generation of every recommender below; they all read the ledger, workflow objects, and supplier catalog that the Spec already defines.

## 2. Governance invariants for inventory AI

1. **Recommend, never execute.** No AI output mutates stock, creates a PO, or transitions a workflow object. Every recommendation lands in a human-owned governed flow (Reorder Request review, Transfer request, draft PO) — the same chains humans use, so accountability and audit are inherited, not reinvented.
2. **Recommendations are governed objects.** Each recommendation is a persisted record carrying provenance: model/heuristic ID + version, input window, generated-at, confidence class. Acceptance/rejection/modification by a human is recorded — this feedback stream is itself training signal.
3. **Deterministic first, learned later.** Generation 1 of every recommender is an explainable statistical heuristic (the platform already runs `EPIC3_LINEAR_V1`). Learned models replace heuristics only per-recommender, behind the same recommendation-object interface, each such upgrade its own gated decision.
4. **Abstain honestly.** Insufficient data → `NEEDS_PLANNING`-style abstention with the reason, never a fabricated number. (Established platform behavior; generalized here as a hard rule for all recommenders.)
5. **Server-side authority.** Recommenders run in trusted services reading with Admin SDK under capability checks; clients render outputs, never recompute authority.
6. **Tenant-inert, tenant-ready** (Spec §4.20). Models/heuristics are parameterized per deployment (per-tenant later, per #140); no cross-company data pooling is assumed or designed here — pooled/benchmark learning would be a Tier 3 commercial decision.
7. **Every recommender is measurable.** Each defines its metric (forecast error, acceptance rate, stockout rate, dead-stock ratio) before it ships; metrics feed the enterprise business-metrics framework.

## 3. Recommender designs

Each entry: input → method (Gen 1 → Gen 2) → output surface → metric.

### 3.1 Parts prediction (job → likely parts)
- **Input:** historical CONSUMED entries joined to Work Order attributes (job type, equipment model per ADR-006 linkage, season, technician).
- **Gen 1:** co-occurrence statistics — "for this equipment model + job type, these parts were consumed in N% of jobs." **Gen 2:** classifier with equipment age/fault codes.
- **Output:** suggested parts list at Work Order creation/dispatch (accept → reservation via Spec §4.2); pre-visit checklist in FieldMode.
- **Metric:** suggestion acceptance rate; % of jobs completed without a second parts trip ("first-time fix" contribution).

### 3.2 Truck loading (recommended mobile-stock profiles)
- **Input:** per-truck CONSUMED history (trucks are ledger locations, Spec §4.6), technician job-type mix, upcoming scheduled Work Orders, parts-prediction output (§3.1).
- **Gen 1:** per-truck min/max profile from trailing consumption percentiles + next-week scheduled demand. **Gen 2:** route/territory-aware optimization.
- **Output:** recommended restock Transfer Orders (Spec §4.5) awaiting human confirmation; "load-out" pick list per morning.
- **Metric:** truck stockout events per week; truck inventory value vs service level.

### 3.3 Replenishment
- **Input:** ledger demand history, supplier lead times (catalog), current position (on-hand, reserved, on-order), policy configuration.
- **Gen 1:** upgrade `EPIC3_LINEAR_V1` — per-part-per-location reorder points with supplier-specific lead times, volatility-scaled safety stock, order quantities respecting MOQ/pack size. **Gen 2:** probabilistic service-level optimization.
- **Output:** recommendations into the existing Reorder Request lifecycle (unchanged human chain) and Transfer recommendations for internal rebalance-first sourcing (§3.6 before buying).
- **Metric:** stockout rate vs inventory carrying value; recommendation acceptance rate.

### 3.4 Warehouse optimization
- **Input:** pick events (Transfer/Receiving/Count activity by bin), part velocity, part affinity (picked-together), bin topology.
- **Gen 1:** velocity-based slotting report (fast movers → accessible bins; affinity pairs adjacent) as recommended putaway rules. **Gen 2:** pick-path optimization.
- **Output:** slotting recommendations consumed as putaway guidance (Spec §4.3/§4.4); each physical move is a normal governed Transfer.
- **Metric:** picks per labor hour proxy (transfer cycle time); putaway-rule acceptance rate.

### 3.5 Purchasing
- **Input:** open reorder requests, supplier catalog (price, lead time, MOQ), demand forecast, PO history (quoted vs actual lead time, fill rate).
- **Gen 1:** order consolidation (group requests by supplier to hit MOQ/freight breaks), buy-timing suggestions, price-anomaly flags vs catalog. **Gen 2:** total-landed-cost optimization across suppliers.
- **Output:** draft PO proposals (extending the existing `procurementBridge` "never auto-creates" discipline) presented in the purchasing flow.
- **Metric:** cost per order line; expedite frequency; draft acceptance rate.

### 3.6 Stock balancing
- **Input:** per-location positions and forecasts (Spec §4.19), transfer costs/times as configuration.
- **Gen 1:** surplus/deficit detection — recommend transfers when one location's projected surplus covers another's projected stockout cheaper/faster than purchasing. Runs before Replenishment recommends a buy. **Gen 2:** network-level rebalancing.
- **Output:** recommended Transfer Orders with the surplus/deficit rationale attached.
- **Metric:** purchases avoided by internal transfer; dead-stock ratio per location.

### 3.7 Demand forecasting
- **Input:** full ledger demand series per part per location; Work Order pipeline (planned demand); seasonality; planner inputs (Spec §4.15).
- **Gen 1:** classical statistical forecasting (moving average / exponential smoothing with seasonality where history supports it; intermittent-demand handling — Croston-class — for the long-tail spare-parts pattern that dominates field service). **Gen 2:** learned models where they demonstrably beat Gen 1 on backtests.
- **Output:** the forecast surface every other recommender consumes (§3.2, §3.3, §3.5, §3.6); planner-visible projected-position curves.
- **Metric:** backtested forecast error (e.g. weighted MAPE) — the platform's first continuously-scored model; abstention rate on thin history.

### 3.8 Supplier recommendations
- **Input:** supplier catalog + realized PO outcomes (actual vs quoted lead time, fill rate, price drift, void/defect events from Returns).
- **Gen 1:** extend the existing `findBestSupplierForPart` (lowest price, tie-break lead time) into a transparent weighted scorecard: price, lead-time reliability, fill rate, recency. Weights are configuration. **Gen 2:** risk-aware scoring (single-source flags, degradation trends).
- **Output:** ranked supplier suggestions at PO creation; supplier scorecard surface for purchasing review.
- **Metric:** realized lead-time accuracy of chosen suppliers; single-source exposure count.

## 4. Data readiness and gaps

Available today: CONSUMED/RESERVED/RELEASED history (the live ledger), reorder lifecycle timestamps, supplier catalog schema. Gaps the Spec already closes (not new asks): location dimension on the ledger (Spec §4.1) — prerequisite for §3.2/§3.4/§3.6; `qtyUsed` reconciliation — prerequisite for honest §3.1/§3.7; supplier references replacing free-text names — prerequisite for §3.5/§3.8; realized receiving dates — prerequisite for lead-time learning. **The AI layer therefore has no schema demands of its own** — it consumes exactly what the enterprise architecture produces. Sequencing consequence: AI phases follow the corresponding capability phases (Implementation Plan §3, Phase 7).

## 5. Explicitly out of scope

Autonomous purchasing/auto-approval of any kind; cross-tenant data pooling or benchmarking (Tier 3); conversational/agent interfaces to inventory (platform-level concern, not this domain's); model-hosting vendor selection (Tier 2/3 external-dependency decision at implementation time); any change to the deployed `EPIC3_LINEAR_V1` behavior now.

## 6. Open questions

- OQ-AI-1: Should recommendation objects live in one platform-wide `recommendations` collection (AI Decision Support service scope) or per-domain collections? Recommendation: platform-wide, single envelope like `auditEvents` — but this touches platform-service design and needs Architecture Review.
- OQ-AI-2: Does Gen-2 (learned models) require a standing model-governance ADR (training data, evaluation, rollback) before any Gen-2 work? Recommendation: yes.
- OQ-AI-3: Metric ownership — do recommender metrics report through the enterprise business-metrics framework (`docs/architecture/enterprise-business-metrics-framework.md`)? Recommendation: yes, single metrics home.
