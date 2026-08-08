# Committed Customer Obligation Attention (Assessment + projection)

**Status:** Assessment → repo-only projection built (authority already determined: none new). Read-only,
fail-closed. No SLA / risk / promise / severity / ETA invented.
**Question:** Sales can flag *pre-commitment* Opportunity attention. Service currently cannot clearly identify,
for a *committed* obligation, that: commitment exists · execution has begun · obligation remains incomplete · a
blocker exists · intervention may be required. Are existing governed facts sufficient to construct an honest
operational-attention projection — or is new authority needed?

## Finding: existing facts are sufficient — a projection, not a new authority

The platform already owns every fact needed:

| Fact | Source (existing) |
|---|---|
| Commitment exists | a **Sales Order** (`sales_orders`, states CONFIRMED→IN_FULFILLMENT→FULFILLED→CLOSED/CANCELLED; CONFIRMED = commercial commitment from WON) |
| Execution has begun | the SO's **Work Orders** exist (`createServiceForSalesOrder` ⇒ IN_FULFILLMENT, `serviceWorkOrderIds`) |
| Obligation incomplete | `coordinatedVisit` **remaining / completed<total**; SO `FULFILLED` gated on all-lines-fulfilled |
| Blocker exists | `coordinatedVisit.blocked` > 0; `coordinatedFieldMission` unit `ATTENTION` / `materialBlocker` |
| Material wait | mission unit `partsReadiness = ATTENTION` or a `materialBlocker` |
| Evidence gap | `contextConsistent = false`; mission `missionReadiness = UNKNOWN` |

Because a **coordinated visit already implies a committed Sales Order in fulfillment** (its Work Orders carry the
SO's `salesOrderId`, Cycle 7 lineage), `commitmentExists` / `executionBegun` are **read from that fact**, not
manufactured. So the answer is a **pure projection over existing authorities** — no new collection, no new
authority, no universal state.

## The projection (`domain/obligationAttention.js`)

`deriveObligationAttention(visit, mission?)` returns honest, fact-derived flags + a reason set drawn **only**
from the vocabulary the facts support:

```
BLOCKED             a Work Order is blocked (non-material)
WAITING_ON_MATERIAL a unit is parts-short, or a blocked unit's blocker is material
PARTIAL             some units complete, some outstanding, none blocked (progressing)
REMAINING_WORK      work outstanding, none complete yet, none blocked (progressing)
UNKNOWN             evidence missing/inconsistent — state cannot be asserted
```

Derived booleans (no severity, no ranking): `needsIntervention` (BLOCKED or WAITING_ON_MATERIAL),
`watch` (PARTIAL/REMAINING_WORK), `needsReview` (UNKNOWN), `satisfied`. Tone maps intervention→attention,
progress→info, gap→unknown, satisfied→positive. **It exposes no `severity` / `risk` / `sla` / `eta` / `promise`
field** (unit-tested to prove absence). This is the operational counterpart to Sales' pre-commitment
`deriveAttention` in `domain/opportunityLifecycle.js`.

## Surfaced (additive, honest)

Wired into the existing **Coordinated Visits** detail as an "Obligation attention" line — the C713×5 blocked unit
(material blocker) reads **Waiting on material — intervention may be required**, so a dispatcher sees the
intervention signal directly. No IA change; additive to the surface merged in #674.

## Boundaries

Read-only, fail-closed, synthetic source (same seam as the coordinated surfaces). No capability grant, callable
deploy, or Rules change. A future refinement can read the Sales Order status directly (to distinguish CONFIRMED
vs IN_FULFILLMENT vs FULFILLED) when a governed SO read is wired — the projection already treats those as facts,
so that is an input swap, not a redesign. It deliberately stops at the level of truth the facts support:
BLOCKED / WAITING_ON_MATERIAL / PARTIAL / REMAINING_WORK / UNKNOWN.

## Tests

- `test/obligationAttention.test.mjs` (node:test, 11) — each reason path, material specialization, satisfied,
  UNKNOWN on evidence gaps / no-visit, commitment/execution read-from-fact, **no invented severity/SLA/ETA**,
  honest summary counts.
- `test/coordinatedOperationsSurfaces.test.jsx` (+1) — the wired detail shows WAITING_ON_MATERIAL + intervention.
