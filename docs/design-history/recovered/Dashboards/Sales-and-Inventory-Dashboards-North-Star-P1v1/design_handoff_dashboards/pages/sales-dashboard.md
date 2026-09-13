# Sales Dashboard — design handoff (TARGET STATE)

**Route:** /sales/dashboard
**Source:** North Star - Sales Dashboard.dc.html · **Frames:** frames/sales-dashboard-1440.png, frames/sales-dashboard-375.png

## Purpose
Slice-and-dice sales management dashboard: bookings, billing, mix, per-person performance, company comparison, pipeline and projection — every figure named with basis, time frame and authority.

## Panels & authority
| Panel | Frame(s) | Facts | Authority |
|---|---|---|---|
| KPI tiles (Booked / Billed / AOV / Goal pacing) | per-tile chips: MTD, QTD, T12M, MTD | booked (attribution FIN-002 COMPLETE), billed (read activation pending), derived AOV, goal pacing (FIN-003) | mixed — each tile labelled |
| Bookings trend + projection | T12M + fcst | monthly booked series; goal line (FIN-003); dashed banded projection (FIN-005 forecast version) | actuals governed; overlays gated |
| Bookings by salesperson | MTD/QTD/YTD | credited bookings vs personal goal tick; "no goal set" renders no fake target bar | creditedSalespersonId (FIN-002); goals FIN-003 |
| Mix by business unit (donut) | MTD/YTD | booked mix from line-level attribution — mixed orders split correctly | FIN-002 COMPLETE |
| Taylor vs Ventana (grouped bars) | QTD/YTD | booked by company by month; arithmetic only, no eliminations (FIN-009) | FIN-002 COMPLETE |
| Pipeline | Open now | stage totals of Opportunity.expectedValue, neutral ink, excluded from revenue charts | existing pipeline reads; FIN-005 converts to forecast |
| Top customers table | YTD | booked, vs prior YTD, share bars; drills to Customer Financials | FIN-002 + read activation |

## Gaps / questions
FIN-AG-READ-ACTIVATION (billed series), FIN-AG-PLAN (goal line/pacing), FIN-AG-FORECAST (projection + demand method), FIN-AG-VISIBILITY. Capabilities: none (read-only dashboard). PQ: default panel frames per role.

## Slice-and-dice model (shared by both dashboards)
- Global filters set WHO/WHERE (dimension slice); each panel owns WHEN via its own time-frame chips (MTD/QTD/YTD/T12M/T90D/Now) — mixed horizons side-by-side are legitimate because every figure prints its frame and basis in its fact-class label; nothing sums across panels.
- Compare-vs control applies per panel against that panel's own frame, same basis only. Prior windows outside governed history report "no comparable period", never 0%.
- Every chart element drills to the governed events behind it, carrying the slice.
- Projections render dashed, in a shaded band, version/authority-labelled (FIN-005) — never blended into actuals.
- Visibility: FIN-004 scopes decide which slices render at all; restriction follows the number.
- All figures are Certification World specimen fixtures.

## Status
READY_FOR_AUTHORITY_AND_FEASIBILITY_REVIEW (target-state designs; not in the corrected P1 20-page scope — reviewed separately). No implementation performed.
