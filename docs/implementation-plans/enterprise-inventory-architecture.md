---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft — awaiting Architecture Review
date: 2026-07-21
owner: Claude Code (Inventory)
related_adrs:
  - docs/architecture/ADR-002-work-order-engine.md
  - docs/architecture/ADR-003-inventory-trigger-system.md
  - docs/architecture/ADR-006-equipment-and-installed-asset-management.md
  - docs/architecture/ADR-007-governed-object-based-report-creator.md
depends_on:
  - docs/assessments/enterprise-inventory-architecture.md
  - docs/specifications/enterprise-inventory-architecture.md
  - docs/specifications/enterprise-inventory-ai-strategy.md
implements: Owner authorization "Begin INV-1 Governance and Architecture" (2026-07-21)
supersedes: none
superseded_by: none
related_pr: TBD (this PR)
target_release: none — governance artifact only
---

# Implementation Plan: Enterprise Inventory Architecture

**Derived from:** the Assessment and Specification of the same topic name, plus the AI Strategy companion.

**This Implementation Plan authorizes NO implementation.** Every row below requires its own Owner go-ahead; Rules rows are additionally Tier 2 under the DelegationCharter; every deploy follows the platform's separate authorize → deploy → verify gates ("export is not deployment"). This plan is the running source of truth for sequencing only.

Verified against `origin/main` @ `8ebf140`.

---

## 1. What this Plan fixes vs. later gates

Fixed now: phase ordering, phase boundaries, per-phase exit criteria, decision list for the Owner, roadmap mapping. **Not fixed now:** per-PR file scopes, exact schemas, capability-catalog final names, test counts — each phase begins with its own detailed specification row that pins those, following the house pattern (bounded rows, like the enterprise-access plan §3/§16).

## 2. Non-negotiable invariants (carried from the Specification)

Single ledger of record; append-only events; trusted-writer-only stock mutation; document-pair atomicity; capability-based authorization (#226); tenant-shaped-tenant-inert (#140); configuration over code; AI recommends, humans decide; merge ≠ deploy ≠ verify. Any row that would bend one of these is invalid as scoped and must return to Architecture Review.

## 3. Bounded phase sequence

Statuses: all rows **NOT AUTHORIZED**. "Est. PRs" are bounded-unit estimates, refined at each phase's spec row.

| Phase | Name | Content | Spec §§ | Est. PRs | Depends on |
|---|---|---|---|---|---|
| **0** | **INV-1 Work-Order Inventory Effect Recovery** | Detection: reconciliation job/report surfaces WOs whose expected effects are missing from the ledger (read-only detector first). Retry driver: idempotent re-trigger for `inventory_sync_status.retryNeeded` entries via trusted command. No behavior change to the happy path. | Spec §2 invariant 4 | 3–4 | none — deployable against today's schema |
| 1 | Ledger generalization + catalog governance | ADR for Part master as governed collection (Assessment OQ-C); `locationId` dimension + new entry types (additive); materialized aggregates + `rebuildAggregates`; inventory capability catalog (Spec §5); replace unbounded client ledger reads | Spec §3.1, §4.1, §5 | 5–6 | Phase 0 |
| 2 | Warehouse activation + receiving + adjustments | Trusted-writer warehouse commands (retire non-idempotent `updateStockLocation`); Receiving Order object → RECEIVED entries; Adjustment object (approval-gated, applies what `inventory_actions` only logged); location-aware reconciliation with repair-via-Adjustment | Spec §4.3, §4.4, §4.8 | 5–6 | Phase 1 |
| 3 | Procurement unification | Unified PO object on the live reorder chain; supplier references replace free-text; Epic 5 `purchase_orders` deprecation (D-3); receiving closes PO→ledger loop; realized-lead-time capture | Spec §4.17 | 4–5 | Phase 2 |
| 4 | Transfers + truck inventory | Full Transfer Order lifecycle with in-transit location; trucks as MOBILE locations; FieldMode consumption onto real ledger; `qtyUsed` reconciliation into CONSUMED entries; demo-layer retirement after parity | Spec §4.5, §4.6 | 4–5 | Phase 2 |
| 5 | Cycle counting + reservations | Count Sheet lifecycle + COUNTED entries; first-class Reservation objects (WO migration last, own ADR per Spec OQ-E) | Spec §4.2, §4.7 | 3–4 | Phase 2 (counting), Phase 4 (reservations) |
| 6 | Tracked stock: serials, lots, expiration, returns | Tracking modes on Part master; serial/lot capture at receiving; FEFO guidance; RMA workflow object | Spec §4.9–§4.12 | 4–5 | Phases 3–4 |
| 7 | AI wave 1 | Recommendation-object envelope (AI OQ-1 resolved first); Gen-1 recommenders in dependency order: demand forecasting → replenishment upgrade → truck loading → parts prediction; each behind its own row | AI Strategy §3 | 4–6 | Phases 1, 4 (data readiness, AI §4) |
| 8 | Barcode + VMI + tenant conformance | Scan-event platform capability wired to receiving/transfers/counts; VENDOR locations/VMI; #140 tenant-conformance checklist executed across all inventory collections when #140 lands | Spec §4.13, §4.18, §4.20 | 3–4 | Phases 2–6; #140 for tenant items |

Sequencing notes: Phase 0 is deliberately independent — it repairs the live integrity gap without waiting for any architecture work. Phases 2/3/4 may interleave at row granularity where files don't overlap, subject to the concurrent-workstream check. Every phase ends with its rules-regression pinned-count update and a phase validation row.

## 4. Object/storage ownership (target)

New collections (names pinned at phase-spec time) are all client-write-closed; trusted writers own them. `inventory_transactions` remains owned by the inventory ledger service; `reorder_requests` ownership unchanged. `SYSTEM_AUTHORITIES.md` must be updated in the same PR as each ownership-introducing row (standing convention).

## 5. External dependencies

None new at this gate. Later phases: barcode scanning may introduce a scanning library (Tier 2 external-dependency decision at that row); AI Gen-2 model hosting is explicitly deferred (AI Strategy §5).

## 6. Roadmap impacts

Mapped against `docs/roadmaps/roadmap-reconciliation-2026-07.md` (this plan proposes; the roadmap doc itself is not edited by this PR):

- **Candidate gate B is satisfied** — INV-1 now has its governance home (this package); **OQ-4 is answered**: the home is the `enterprise-inventory-architecture` chain, and the recommended priority is Phase 0 immediately after the currently-open production gates (D-2 below).
- **Phase 4 of the proposed roadmap** ("reconcilable ledger with detected/repairable effects; activated procurement-to-inventory chain") maps to this plan's Phases 0–3; its exit criterion is achieved at Phase 3 completion.
- **Phase 6 of the proposed roadmap** (AI-Assisted Operations, "at least one governed AI-assisted workflow") maps to this plan's Phase 7; the first continuously-scored model is demand forecasting (AI §3.7).
- Dormant-surface reconciliation: the roadmap's "Warehouse/Transfers/Procurement DORMANT (services unwired)" rows become Phases 2–4 here.
- Issue #182 (truck-parts sale-to-invoice) remains deferred; Phase 4 creates its prerequisite (real truck stock) but does not implement it.

## 7. Decision recommendations (for the Owner — none are made by this document)

| # | Decision | Recommendation | Tier |
|---|---|---|---|
| D-1 | Adopt this architecture package (Assessment + Specification + AI Strategy + this Plan) as the governing chain for the inventory domain | Adopt | 2 |
| D-2 | Authorize Phase 0 (INV-1 recovery) as the next inventory implementation work, independent of and not blocking the open #226 Row 19–22 and F-RULES-1 gates | Authorize when Owner attention allows; it is the only High-severity integrity finding | 2 |
| D-3 | Deprecate the dormant Epic 5 `purchase_orders` surface in favor of the unified PO object (Phase 3) | Deprecate (no data exists in production to migrate per current seeding state — verify at phase start) | 2 |
| D-4 | Require an ADR for Part-master-as-data before Phase 1 (Assessment OQ-C) | Yes | 1 (ADR authoring) |
| D-5 | Resolve AI OQ-1 (platform-wide recommendation envelope) at Architecture Review of Phase 7's spec row, not before | Defer to Phase 7 | 1 |
| D-6 | Record adoption in `docs/DECISIONS.md` (append-only, house format) upon Owner decision on D-1 | Record | — (mechanical) |

## 8. Validation

**Of this package (done now):**
- All claims about current state were grounded in the pinned checkout `origin/main` @ `8ebf140` with file/line evidence gathered by three independent repository surveys (client implementation, backend/governance patterns, documentation landscape), then cross-checked against `docs/DECISIONS.md` #35/#36 for live-deployment facts rather than the stale CLAUDE_CONTEXT/SPRINT_STATUS statements.
- Deliverable coverage check: all ten Owner-listed review domains appear in Assessment §2; all five gap dimensions in Assessment §3; all twenty specification areas in Spec §4.1–§4.20; all eight AI areas in AI Strategy §3.1–§3.8; governance artifacts = Assessment, Specification, this Plan, D-1–D-6, §6 roadmap impacts, this §8.
- Constraint compliance: this PR contains only new documentation files; no production code, no Firestore changes, no Functions, no UI, no deployment; no shared/existing document is modified (zero conflict surface with concurrent workstreams).

**Of future phases (defined now, executed per row):** each phase's exit requires — full rules-regression suite green with pinned counts updated; domain unit suites green; ledger replay-determinism property tests green (Phases 1+); idempotency double-fire tests for every new trusted command; a phase validation row confirming `SYSTEM_AUTHORITIES.md` and capability-catalog accuracy; deployment rows carry their own Owner authorization naming exact commit and surface, per the Rows 19–22 house pattern.

## 9. Tracking

This table is the running source of truth for what's left. Phase rows convert to GitHub issues at authorization time (house pattern: enterprise-access rows → issues #243–#273). Board: Taylor Freezer, statuses reconciled at each phase close.
