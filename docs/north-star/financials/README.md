# Design handoff — Financials North Star P1 (pages 01–20)

**Design direction: APPROVED.** Authority correction pass 1: **COMPLETE** (2026-09-01). Implementation: **NOT performed**. FIN phase map corrected to the canonical FIN-001..FIN-010 (FIN-PQ-000 removed); BUILT_DORMANT authorities reclassified; all capability names marked CONCEPTUAL (exact governed IDs TBD).
Status: **READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW**.

Master review package (final-review entry point): `docs/north-star/financials/FINANCIALS-NORTH-STAR-P1-DESIGN-REVIEW-PACKAGE.md` (copy in this folder). Consolidated handoff: `DESIGN-HANDOFF-FINANCIALS-P1.md`. Per-page handoffs: `pages/`. Frames: `frames/` (44 PNGs, indexed in `frames/README.md`). Editable sources: the `.dc.html` files here (mirrors of root).

## What changed visibly in this pass (frames regenerated)
- **05 Payments** (all 4 frames): unapplied-balance content labelled FUTURE AUTHORITY — current core refuses over-application; composition retained as North Star target.
- **10 Forecasting** (2 frames): method claims removed — method cells read "Method TBD — FIN-005"; inputs rail marked illustrative; "weighted by governed stage probability" deleted.
- **20 Governance** (desktop frame): period row corrected to AUTHORITY NOT IMPLEMENTED — FIN-008 Period & Close (no "calendar months assumed").
- **02 Billing Queue** (2 item frames): capability line now conceptual; invoice command core BUILT_DORMANT.
- **06 Credits & Adjustments** (desktop frame): "auto" approver specimen → "policy TBD" (no FIN-007 policy asserted).
- **12 Budget Management** (revise frame): self-approval-threshold wording removed; approval routing deferred to FIN-007; capability conceptual.

## Handoff-only corrections (no visible frame change)
01, 03, 04, 07, 08, 09, 11, 13, 14, 15, 16, 17, 18, 19 — phase remapping (goals/budgets → FIN-003, forecast → FIN-005, period → FIN-008), BUILT_DORMANT vocabulary, conceptual-capability labels, canonical gap ids. (03/04/09/13 also received annotation-tooltip corrections in source with no visible layout change.)

## Remaining authority gaps (canonical register in the master file)
FIN-AG-READ-ACTIVATION · VISIBILITY (FIN-004) · SERVICE-BILLING-READINESS · 02b pricing action · PAYMENT-UNAPPLIED · DUEDATE-POLICY · PLAN (FIN-003) · APPROVALS (FIN-007) · FORECAST (FIN-005) · COST-MARGIN (FIN-006) · PERIOD (FIN-008) · INTERCO (FIN-009) · RECON (FIN-010) · AUDIT-LENS · REPORT-REGISTRY — 15 total.

## Remaining product questions (register in the master file)
13 — FIN-PQ-001, BUCKETS, PARTIAL-INVOICING, UNAPPLIED-POLICY, REFUND-ROUTING, 10a, 15a, 16a, 17a, CORRELATION-IDS, REPORT-SHARING, TEAM-GOAL, 20a.

## Acceptance
- [ ] Final authority & feasibility review of the master package — required before ANY implementation.
- [ ] Consistency findings F1–F4 dispositioned.
- [ ] Per page at implementation: whole-composition side-by-side vs the approved .dc.html source on sandbox, verified by Design and Owner.

Conventions honored: annotations behind hover-ⓘ; only contract copy visible; missing capability = preserved slot + honest state; specimens are Certification World fixtures.
