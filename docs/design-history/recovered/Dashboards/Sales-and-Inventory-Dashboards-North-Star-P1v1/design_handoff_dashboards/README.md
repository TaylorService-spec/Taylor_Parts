# Design handoff — Sales & Inventory Dashboards (TARGET STATE)

Two slice-and-dice management dashboards in the North Star grammar, added after the Financials P1 correction pass at Owner request. Status: READY_FOR_AUTHORITY_AND_FEASIBILITY_REVIEW · design only, nothing implemented.

Contents: two .dc.html editable sources (mirrors of root) + support.js · pages/ (2 handoffs) · frames/ (4 PNGs).

Key design decisions
- Global filters slice WHO/WHERE; each panel owns WHEN (per-panel time-frame chips) — mixed time frames by design, every figure prints basis + frame.
- Charts throughout: KPI tiles with deltas, trend lines/bars, donuts, grouped bars, share bars — all drawn only over governed facts; projections dashed + banded + FIN-005-labelled; pipeline never enters a revenue chart.
- Honest absences preserved: inventory value / turns / carrying cost (FIN-006), billed-series activation, goal pacing (FIN-003), demand model (FIN-005).

Dependencies: FIN-003 (goals), FIN-004 (visibility), FIN-005 (projections/demand), FIN-006 (all dollar inventory analytics), finance read activation. Registers in the Financials master package apply.

Acceptance: whole-composition side-by-side vs these .dc.html sources on sandbox, by Design and Owner.
