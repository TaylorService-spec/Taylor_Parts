# Coordinated Operations — Service/Dispatch + Technician surfaces

**Status:** Design + repo-only implementation. Read-only, fail-closed; synthetic source; no authority added,
nothing activated/deployed/Rules-widened.
**Scope:** two user-consumable surfaces over the already-built projections
`functions/src/fulfillment/coordinatedVisit.ts` and `coordinatedFieldMission.ts`.

## Why

The coordinated-visit and coordinated-field-mission projections existed only in the backend. This increment
exposes them as usable operating experiences, and is specifically the **substrate for the next C713×5 journey
mission** (a dispatcher and a technician can now actually look at one coordinated obligation). It does **not**
redesign the authority model, and it makes **no** final Service IA consolidation decision — after the surfaces
are usable, the sequential C713×5 journey rerun (UX) determines the next IA decision.

## Authority model (unchanged — exposed, not redesigned)

- **Sales Order = coordination anchor.** Work Orders that fulfil one Sales Order share its `salesOrderId`.
- **Work Order = individual execution / accountability.** One Work Order per serialized equipment unit.
- **coordinatedVisit** = the Service/Dispatch projection (group WOs by `salesOrderId`).
- **coordinatedFieldMission** = the Technician projection (one customer mission, N per-equipment executions).
- **No new authority.** No Job, Visit, WorkOrderGroup, or scheduling authority is invented. Partial completion
  is honest: **3 of 5 done + 1 blocked is NOT complete.**

## Architecture (mirrors the Opportunity read-first pattern)

```
data/coordinatedOperationsFixtures.js   synthetic C713×5 scenario (SBX-*)
  → access/coordinatedOperationsSource.js   injected SOURCE seam (synthetic today; governed read later)
     → hooks/useCoordinatedOperations.js     builds coordinated visits (pure projection) + name/signal maps
        → domain/coordinatedVisit.js          PURE mirror of coordinatedVisit.ts
           domain/coordinatedFieldMission.js  PURE mirror of coordinatedFieldMission.ts
        → modules/service/CoordinatedVisitsWorkspace.jsx   Service/Dispatch surface (Wave-0 primitives)
        → modules/mobile/CoordinatedMissionView.jsx        Technician surface (field density)
```

The client-side `domain/*` files are **read-side mirrors** of the backend TS authority (kept in sync), so the
surfaces render today without a governed read callable. When the governed read is deployed, the source seam
swaps in one line — the projections, hooks, and surfaces are unchanged.

## Service / Dispatch — Coordinated Visits (`/service/coordinated-visits`)

A dispatcher understands one coordinated obligation in one operating context: **customer, location, coordinated
obligation (the Sales Order + unit count), related Work Orders / equipment units, scheduled context +
technician / truck WHERE KNOWN, readiness, blockers, completion progress, and remaining obligation.** The visit
queue sorts attention-first; the detail aside shows the per-unit rows (per-unit accountability preserved).
Nav: Service → Dispatch group; admin/dispatcher (no legacyKey → `PLACEHOLDER_DEFAULT_ROLES`).

## Technician — Coordinated Mission (`/service/coordinated-mission`)

The technician sees **one customer mission with N equipment-specific executions**. The Work Orders keep
**independent** execution and per-equipment completion — they are **not** merged into one record. Shared context
is surfaced once: customer/location, mission context, related units, coordinated load/readiness, blockers, and
overall progress. Field density (large targets). Nav: Service → Technician Workspace group; legacyKey
`fieldMode` so it inherits the Technician Workspace's visibility (admin + technician) without inventing a new
`ROLE_NAV_ACCESS` key. Nav visibility is never the security boundary — Rules are — and this surface is
read-only synthetic.

## Honest state (F1/F2)

Missing evidence stays **UNKNOWN / UNAVAILABLE / DEGRADED**. Nothing is manufactured: not readiness, not ETA,
not equipment/material availability, not commissioning state, not load verification. A done unit is READY; a
blocked status is ATTENTION; unknown parts evidence or an undetermined load is UNKNOWN (never a fake READY). An
unconnected source renders an honest **"not connected yet"**, distinct from an empty list.

## Service ↔ Inventory (material blocker) — expose where supported, route the gap

A blocked unit's **material blocker** is exposed: the short part is **named**. The **resolution** is shown only
if the canonical replenishment/Purchasing substrate is connected; otherwise it is honestly **UNKNOWN and routed
to Inventory / Purchasing** — never a fabricated ETA or availability. In the synthetic scenario
`replenishmentConnected:false`, so the surfaces show *"replenishment status not connected (routed to Inventory /
Purchasing)"*. This is the Service↔Inventory connection point; the canonical replenishment truth remains an
Inventory/Purchasing foundation gap, preserved and routed rather than answered locally.

## Fail-closed / not done

Read-only synthetic. No governed read callable wired, no capability grant, no callable deploy, no Rules change,
no Work Order / scheduling / inventory write. No final Service IA consolidation — that waits on the C713×5
journey evidence.

## Tests

- `test/coordinatedVisit.test.mjs` (node:test, 8) — grouping excludes standalone WOs; readiness (READY/ATTENTION/
  PARTIAL/IN_PROGRESS); honest counts + remaining; contextConsistent; unknown-status = not-done; tones.
- `test/coordinatedFieldMission.test.mjs` (node:test, 8) — per-unit + mission readiness (UNKNOWN on missing
  evidence); load rollup; honest progress; material-blocker normalization routes an unconnected substrate to
  UNKNOWN.
- `test/coordinatedOperationsSurfaces.test.jsx` (vitest, 7) — both surfaces: attention-first order, honest 3/5
  partial (not complete), routed material blocker, N independent units, honest not-connected state.
- `test/serviceNavGroups.test.mjs` — extended for the two new items (Dispatch / Technician Workspace groups; the
  technician sees Coordinated Mission via `fieldMode` but never the admin/dispatcher Coordinated Visits).
- Verified in a real browser (synthetic source, no auth/emulator) at 900px (no master/detail overlap) and 400px
  (no horizontal page scroll); honest content present.
