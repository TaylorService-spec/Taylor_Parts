# Inventory Dashboard — design handoff (TARGET STATE)

**Route:** /inventory/dashboard
**Source:** North Star - Inventory Dashboard.dc.html · **Frames:** frames/inventory-dashboard-1440.png, frames/inventory-dashboard-375.png

## Purpose
Custody-and-demand dashboard: on-hand/committed/on-order units, movement trend with demand projection, exceptions (stockouts, below-reorder, no-movement aging), custody mix, warehouse distribution, fast movers. Unit counts are governed truth today; every dollar analytic is FIN-006-gated and renders an honest reserved slot.

## Panels & authority
| Panel | Frame(s) | Facts | Authority |
|---|---|---|---|
| KPI tiles (On hand / Committed / On order / Value) | Now / Now / Open / Now | governed custody + reservation + open-PO units; Value = honest "No cost authority" slot | inventory authority exists; value FIN-006 |
| Movement trend + demand projection | MTD/QTD/T12M + fcst | monthly received vs issued bars (governed movement events); dashed banded demand projection | movements governed; projection FIN-005, method TBD |
| Exceptions table | Now | stockouts w/ waiting WOs first, below-reorder, 180d no-movement | governed custody + movement dates; carrying-cost impact absent until FIN-006 |
| Custody mix (donut) | Now | Taylor-owned vs Ventana-owned units — governed custody fact, never warehouse-name inference | exists |
| On hand by warehouse (bars) | Now | unit distribution across Phoenix/Tucson/van stock | exists |
| Fastest movers | MTD/T90D | trailing issue counts (its own clock, printed) | exists |
| Turns & carrying cost | — | reserved slot, honest absence | FIN-006 |

## Gaps / questions
FIN-AG-COST-MARGIN (value, turns, carrying cost), FIN-AG-FORECAST (demand model + reorder recommendations), FIN-AG-VISIBILITY. Capabilities: none (read-only). PQ: reorder-point governance (who sets, versioned?).

## Slice-and-dice model (shared by both dashboards)
- Global filters set WHO/WHERE (dimension slice); each panel owns WHEN via its own time-frame chips (MTD/QTD/YTD/T12M/T90D/Now) — mixed horizons side-by-side are legitimate because every figure prints its frame and basis in its fact-class label; nothing sums across panels.
- Compare-vs control applies per panel against that panel's own frame, same basis only. Prior windows outside governed history report "no comparable period", never 0%.
- Every chart element drills to the governed events behind it, carrying the slice.
- Projections render dashed, in a shaded band, version/authority-labelled (FIN-005) — never blended into actuals.
- Visibility: FIN-004 scopes decide which slices render at all; restriction follows the number.
- All figures are Certification World specimen fixtures.

## Status
READY_FOR_AUTHORITY_AND_FEASIBILITY_REVIEW (target-state designs; not in the corrected P1 20-page scope — reviewed separately). No implementation performed.
