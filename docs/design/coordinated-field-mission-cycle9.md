# Coordinated Field Mission (Cycle 9)

Status: **BUILT (pure projection, repo-only).** The technician-facing read of a coordinated visit — one
customer/location mission with per-equipment execution + honest readiness. The consuming Field/Dispatch UI is
deferred (data pipeline is inert until grants/deploys; UX synthesis owns final placement).

## What it adds
`functions/src/fulfillment/coordinatedFieldMission.ts` (pure): `buildCoordinatedFieldMission(visit, signals)`
turns a coordinated visit (`coordinatedVisit.ts`) + injected per-Work-Order field signals into a mission view:
- **ONE shared context** (customer/location) carried from the coordinated visit; divergence surfaced.
- **Per-equipment units** — one row per Work Order (independent execution authority preserved, not merged for
  presentation): status · parts readiness · load verified · `unitReadiness`.
- **Honest readiness (F1/F2):** missing evidence ⇒ **UNKNOWN**, never a fake READY. A unit is READY only when
  parts are READY *and* the truck load is verified; parts ATTENTION or an unverified/missing load ⇒ ATTENTION;
  a blocked status ⇒ ATTENTION.
- **Coordinated load readiness** (all verified ⇒ READY; any false ⇒ ATTENTION; any undetermined ⇒ UNKNOWN) —
  the "is the truck ready for this visit?" picture.
- **Overall progress + mission readiness** (worst-known; PARTIAL when some units are done and the rest ready) —
  honest partial completion, never a fake whole-visit COMPLETE.

## Authority / principles
- The **Sales Order coordinates**; **Work Orders keep independent execution authority** (no merged WO authority
  for presentation) — consistent with the C8 conclusion (no Job/Visit/WorkOrderGroup authority).
- Field signals (parts readiness, load verification) are **injected from governed sources** (the WO parts
  readiness projection, F2 load verification); this projection never fabricates them and has **no demo path**.
- Operational (Service/Field), **separate from commercial coverage** (register #15) — asserts no sales ownership.

## Persona/Journey trigger (deferred until usable)
When the data pipeline is live (SO→Service granted/deployed) or wired to synthetic fixtures, this projection
backs a bounded Technician/Dispatcher surface — at which point the high-value missions become testable:
Dispatcher coordinating a five-unit install with one blocked unit; Technician executing one coordinated visit
with multiple Equipment Work Orders; the Sales Order → Service → Field-completion journey. No persona runs on
this backend-only change.

## Next
Completion → Finance seam (billing eligibility from commercial commitment + fulfillment evidence + operational
completion; Finance owns financial processing; no invoice policy invented) → Billing/AR assessment.
