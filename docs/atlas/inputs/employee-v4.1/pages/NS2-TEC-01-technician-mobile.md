# NS2-TEC-01 — Technician Mobile Day (ADD — no North Star yet)
Prior input: Proposed - Technician Mobile.dc.html (EXPLORATORY MOCKUP only), HOME-01 Technician variant, Cycle Counts P1 technician MOBILE flow (My Truck → Cycle Count).

**What it should do.** The technician's whole field day on a phone: next job, route, readiness (required parts on truck?), job execution (arrive, diagnose, consume parts, complete, voice-note draft), truck inventory tasks (counts, transfers).

**Roles.** Technician only. Assignment scopes what they see (their jobs, their truck); assignment never *authorizes* — capabilities do (established authority boundary from Cycle Counts P1: "truck assignment answers which, not whether").

**Layout schema (phone 390)**
```
[Next job card: where, when, why, ready?]
[Today list ............................]
[My Truck: stock, counts due, transfers ]
[⚠ readiness problems always visible    ]
```
**Role interaction.** Execute-only surface; every action is a governed WO/inventory command; offline queue + retry is first-class (pattern from Cycle Counts refusals/offline frame). AI: voice-note cleanup → structured draft, technician confirms before the governed write.

**Status.** WORKFLOW GAP P2-G2 — day flow not yet grounded against the registry. Design the desired experience, mark gaps, no invented transitions.


OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN (see ns2/ATLAS-OBSERVATION-BASE.md — seeded from findings at/before ATLAS-BASE-2026-09-10-A).
