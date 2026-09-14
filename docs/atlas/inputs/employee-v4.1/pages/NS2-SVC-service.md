# NS2-SVC-01 — Service Operations Overview
P1 source: North Star - Service Operations P1 + design_handoff_service_operations/. Verdict pending; P1 decisions SO-D1–D4 (WO wall cut, Parts Overview cut) stand until Owner reopens.

**What it does.** The service manager/coordinator's situational surface: is service healthy today, what is at risk, what is blocked. Six P1 panels ranked into attention / table / tray / rail.

**Roles.** Service Coordinator/Dispatcher (daily), Owner (health check, drill-in), Technician (no access needed — their view is HOME/TEC).

**Layout schema (desktop)**
```
[Attention band: at-risk + blocked WOs .............]
[WO table (ranked) ..................][Rail:       ]
[Dispatch queue tray ................][activity,   ]
                                      [capacity    ]
```
Phone: attention list → queue list; no dense table.

**Role interaction.** Coordinator acts from rows (assign → DSP-01, open → SVC-03); Owner drills only. All actions carry EOS capability checks; blocked-by-parts rows link the blocking part (INV-03).

**States.** healthy-quiet / attention-loaded / registry-degraded (feed unavailable) / denied.
**Sources.** field-ops-app-vite/src/modules/controlTower/* (see github.md).

---
# NS2-SVC-02 / NS2-SVC-03 — Work Orders List / Work Order Record
P1 sources: Lists P2 (WO study), North Star - Work Order + Work Order - Implementation vs North Star.dc.html (drift documented).

**What they do.** SVC-02: canonical WO collection in the shared list grammar (17-state register). SVC-03: the record — what is this job, what state, what next legitimate action (workOrderWorkflow.js order), parts plan, history.

**Roles.** Dispatcher (schedule/assign), Technician (execute; phone composition), Parts (parts plan fulfillment), Finance (completion → billing handoff), Owner (read).

**Record layout schema**
```
[Identity + state + next-action band ................]
[Attention (blocked/at-risk reason, always visible)  ]
[Work sections by job: Schedule | Parts | Execution | ]
[Completion & billing handoff | History              ]
```
**Role interaction.** Action availability from workflow + capability: AVAILABLE / UNAVAILABLE WITH REASON / NOT AUTHORIZED render distinctly. Completion hands off to FIN-02 billing queue (cross-object journey §13).
**Gaps.** B1/B2 (design_handoff_work_order/README.md); implementation drift study to be re-run at P2 open.


OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN (see ns2/ATLAS-OBSERVATION-BASE.md — seeded from findings at/before ATLAS-BASE-2026-09-10-A).
