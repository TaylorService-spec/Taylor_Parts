# NS2-DSP-01 — Dispatch Board (+ NS2-DSP-02 Dispatch Map)
P1 source: North Star - Dispatch Board P1 + design_handoff_dispatch_board/ (DB-D1/DB-D2 open, honest interim renderings).

**What it does.** The dispatcher's scheduling workspace over canonical Work Orders: day lanes per technician, blocked time, week/2-week views, map view. Live dispatch core.

**Roles.** Dispatcher (owner of the surface); Service Coordinator; Owner read-only. Technicians never schedule here.

**Layout schema (desktop)**
```
[Queue: ready-to-schedule / late .][Day lanes by tech  ]
[filters, parts-blocked flags ....][ blocks + conflicts]
[                                 ][ capacity shading  ]
```
Phone (honest alternative, brief §15): the scheduling queue as a list — no pretend timeline at 375.

**Role interaction.** Drag/assign invokes the normal EOS scheduling command; AI recommendation (technicianRecommendationEngine) renders as explainable suggestion → dispatcher reviews → clicks Assign → governed command. Conflicts and parts-blocked states stay visible, never tucked behind ⓘ.

**States.** empty-day / conflict / tech-unavailable / parts-blocked / command-refused (reason shown) / offline-retry.
**Gaps.** DB-D1, DB-D2 (register). DSP-02 Map: PROPOSED-ONLY — needs workflow grounding before an NS2 revision exists.
**Sources.** DispatcherBoard.jsx, WorkOrderQueue.jsx, TechnicianBoard.jsx, workOrderWorkflow.js.


OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN (see ns2/ATLAS-OBSERVATION-BASE.md — seeded from findings at/before ATLAS-BASE-2026-09-10-A).
