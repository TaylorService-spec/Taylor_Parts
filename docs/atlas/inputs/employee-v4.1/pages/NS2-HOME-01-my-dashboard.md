# NS2-HOME-01 — My Dashboard (persona start pages)
Contract status: seeded from P1v2; full 35-point contract due at P2 disposition. P1 source: North Star - My Dashboard P1v2 ×3 files + design_handoff_my_dashboard/ (census-mapping.md).

**What it does.** The role's operating start page: today's SITUATION sentence, ATTENTION exceptions, a few KEY OUTCOMES, then WORK queues. Every number drills through to records. No dead KPIs.

**Roles.** 7 persona variants: Owner (populated + quiet states), Dispatcher, Technician (375 phone-first), Parts (375), Salesperson (activation-aware), Finance (capability-gated), Owner 375. Content per persona from the dashboard/reporting authority census — nothing rendered without an authorized read.

**Layout schema (desktop)**
```
[Situation line ......................................]
[Attention: exceptions only, ranked ..................]
[Key outcomes: 3-5 measures]  [Work queue(s) .........]
                              [→ drill-through rows ..]
```
Phone: same order, single column; queues become tappable lists ≥44px.

**Role interaction.** Read-only surface + navigation: acting on a queue item routes to the owning surface (WO → SVC-03, count sheet → INV-04, invoice → FIN-03). Finance variant renders DENIED honestly when capability absent.

**States.** populated / quiet ("nothing needs you") / gated (capability denied) / empty (new tenant) / stale-data warning.
**Gaps.** Merge questions vs SLS-06 and INV-01 → P2-D5, IA-Q. **Sources.** docs/assessments/eos-dashboard-reporting-authority-census.md, docs/north-star/VISUAL-SYSTEM.md.


OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN (see ns2/ATLAS-OBSERVATION-BASE.md — seeded from findings at/before ATLAS-BASE-2026-09-10-A).
