# EOS MY DASHBOARD NORTH STAR P1v2 — DESIGN PACKAGE

Status: DESIGN COMPLETE — design only; no application code changed, no authority created, no capability activated.
Behavioral authority: docs/assessments/eos-dashboard-reporting-authority-census.md (binding; copy in this project at the same path).
Visual authority: docs/north-star/VISUAL-SYSTEM.md (Owner-accepted 2026-09-02) — true-white surfaces, semantic text tiers (16/15/14/13/12, KPI 32/24), border #87938D / strong #5F6C66, emphasis #005A3C, evergreen rail chrome #102B24 untouched. No page-local palette; chart series colours use the permitted chart exception with AA-clearing labels/axes.

## Package contents
- Editable sources (mirrors of project root):
  - North Star - My Dashboard P1v2 Owner.dc.html — frames 1a populated, 1b quiet, 1a-m 375
  - North Star - My Dashboard P1v2 Dispatch Technician.dc.html — 2a dispatcher, 2b technician, 2b-m 375
  - North Star - My Dashboard P1v2 Parts Sales Finance.dc.html — 3a parts (+3a-m 375), 3b salesperson, 3c finance gated
- frames/ — 10 PNGs (7 desktop 1440, 3 handheld 375)
- census-mapping.md — every visible module → census fact id(s), label, scope, STATUS (REPORTABLE_NOW / ACTIVATION_REQUIRED / HONEST_UNAVAILABLE)
- this README — component inventory, hierarchy, responsive/interaction notes, states, NOT-DESIGNED list, conflicts

## Frame index
1. 01-owner-populated-1440.png · 2. 02-owner-quiet-1440.png · 3. 03-dispatcher-1440.png · 4. 04-technician-1440.png · 5. 05-parts-manager-1440.png · 6. 06-salesperson-1440.png · 7. 07-finance-gated-1440.png · 8. 08-technician-375.png · 9. 09-parts-375.png · 10. 10-owner-375.png

## One adaptive framework
Every persona renders the same optional-section skeleton, in fixed priority order:
A. NEEDS YOUR ATTENTION (action cards, evergreen left rule, one action affordance each; what/why/record/age-where-governed readable without opening) →
B. current-state KPI band (3–5 figures, 32px KPI tier, each labelled with its census basis) →
C. two operational charts (distributions/queue states/progress — current-state only) →
D. WAITING / IN MOTION (visually secondary list) + exception/progress visualization →
E. role-specific current work →
F. clearly-badged DERIVED insights (only where ND-28 applies; tile placement itself flagged as Owner decision 4) →
G. GO TO (X-6 destination chips, always last).
Sections render only when eligible; an empty action queue renders the quiet state, never a blank screen and never invented work.

## Component inventory
- Rail (evergreen #102B24, existing) + NEW identity block at rail bottom: initials avatar (bronze), name, role context, chevron — entry point for session actions; NOT a role switcher. Existing masthead notification behavior retained (no relocation recommended in this package).
- Action card (.act): white, 1px #87938D border, 4px #005A3C left rule (amber #8F6109 variant for waiting-flavoured attention), title + why-line (13px muted) + primary/secondary button.
- KPI tile (.panel + .kpiL/.kpiV): 12px uppercase label, 32px serif value in #005A3C (24px handheld), 13px basis line.
- Distribution bar chart (SVG h-bars): 13px labels, governed-status rows, zero rows shown in words ("0 — shown, not hidden").
- Composition/stacked bar: only for complete, mutually-exclusive category sets (account status, service composition, work buckets).
- Progress bar (receiving): unit progress derived from committed receipts; discrepancy state amber with reason line.
- Derived badge (.drv): uppercase chip "Derived · not stock truth" — mandatory on every ND-28 figure.
- Gated/unavailable state: sunken surface #F2F5F3, 1px border, bold truth sentence + plain-language reason + what unlocks it.
- Quiet state: same treatment, "Nothing needs your action right now."
- Go-to chip (.dest): outlined destination; unreachable-with-reason renders dashed + muted (finance zero-reach).
- Hover-ⓘ annotation (.hlp/.tip): all design/census annotations live here per the project convention; only contract copy stays visible.

## Responsive behavior
375 recomposes, never shrinks: attention cards stack first and keep their buttons; KPI band → 2×2 grid at 24px KPI tier; one composition bar survives per screen (charts collapse to their stacked-bar form + words); waiting collapses to two-line rows; Go to becomes wrapped chips; scan workflows become large tap targets (≥44px). Rail collapses to masthead + avatar + menu.

## Interaction notes
Every count, bar segment and list row drills to the owning workspace pre-filtered (composition, not new reads). Action buttons invoke the existing domain action (review request, assign, reconcile, start work) — the dashboard never carries its own write path. Refresh is a manual re-read; read-checked timestamp shown. Tooltips are design annotations, not product UI.

## Empty / loading / denied / unavailable states
- Empty action queue → quiet state (frame 2).
- Loading → skeleton rows on white panels (no spinner-as-state; UNVERIFIED offline items are a real state, T-9).
- Denied/zero-reach → named withheld panel with the reason and unlock (finance frame 7; Financials chip dashed in Go to).
- Unavailable/gated → sunken panel stating the flag or grant (governed balances, transfers), never zeros; UNKNOWN never renders as 0 (X-9, I-3).
- Counts: only complete server-side aggregates render as totals; bounded lists say so (X-9).

## Explicit NOT DESIGNED / NOT AUTHORIZED
Revenue/billed/collected/A-R KPIs, margin, inventory value, turns, carrying cost, AOV, goal %, pace, forecast $, weighted pipeline $ · any time-series chart, MTD/QTD/YTD, prior-period delta (no reporting time authority, G-05) · overdue-PO flag, promised receipt dates, PO approval queue (P-3/P-4) · governed stockout count (I-8), shortages (W-7), inventory aging (I-11), demand/replenishment plan (I-18), truck replenishment (W-9) · governed on-hand/reserved/ATP numbers anywhere (gated, AB-1) · utilisation % (SV-8), WO aging buckets (SV-9), "next job" rule (T-3), weekly technician performance (T-5) · first-time fix, SLA, callbacks (SV-11/12/13) · stale opportunities (S-5), agreement DECLINED tile (ND-14) · notification history (X-5), cross-domain activity roll-up (X-4, Owner-retired), deployment status (A-7), Owner-decision counts (A-8) · site-wide search box (§11 — future-shell annotation only) · role switcher · any ALERT severity layer or re-badged risk vocabulary (X-3) · Taylor/Ventana split on operational records (X-7, NO_GOVERNED_COMPANY_SOURCE) · audit feed (A-5 — read authority unnamed).

## Open Design/Behavior conflicts (named, not resolved by Design)
1. OWNER DECISION 4 (census §9): do ND-28 derived figures (stock forecast, stockout risk) belong on a dashboard TILE? Designed behind a mandatory Derived badge; the panel drops without layout damage if ruled out.
2. FIN-004 reach (census §9 decision 1): finance persona is shell-only until a role carries finance.visibility.*; frame 7 is the designed truth.
3. Sales spine environment: frames show the sandbox-active composition (AB-3); production ships the gated variant of the same modules.
4. Receiving eligibility for parts associates is deferred in the census matrix (GATED row) — the parts frames scope receiving actions to the manager persona accordingly.
5. Shell-composition note: no session utilities were moved; the identity block is additive at the rail bottom.

## Acceptance
Whole-composition side-by-side vs these .dc.html sources on sandbox, at 1440 and 375, in the routed application, by Design and the Owner. Visual-system compliance is testable: tokens per VISUAL-SYSTEM.md §schema, no page-local palette beyond the chart-series exception.
