# UX Sweep — do rendered signals claim more than their authority supports?

Bounded, evidence-driven. Every candidate was traced to its authority **before** any
judgement, per the symptom→trace→diagnose contract. **No universal status taxonomy was
created** — the shared pattern is a diagnostic lens, not a thing to build.

## Classification of every candidate traced

| Signal | Authority | Class | Disposition |
|---|---|---|---|
| Reconciliation row severity | warehouse reconciliation | **OVERCLAIM** — `CRITICAL` over `NaN` | FIXED (#673) |
| Notification urgency badge | `reorder_requests` | **VOCABULARY_COLLISION** with stock severity | FIXED (#696) |
| Purchase-order "Needs attention" | ORPHAN view status | **OVERCLAIM** — integrity exception as workflow state | FIXED (#699) |
| Dispatch queue chip | `computeJobRisk()` (age/status) | **OVERCLAIM** — derived risk as `Emergency` | FIXED (#709) |
| Work Order `priority` | canonical, chosen at creation | **VOCABULARY_COLLISION** — one field, three renderings | FIXED (#714) |
| Parts urgency `CRITICAL`/`HIGH` | `inventoryAnalyticsEngine` recommendation | **HONEST_DERIVATION** | no action |
| Coordinated obligation reasons | `obligationAttention` over WO states | **HONEST_DERIVATION** | no action |

## Why the last two are not defects

**Parts urgency** describes the thing it measures — stock condition — using the
analytics engine's own vocabulary. It also deliberately keeps `NEEDS_PLANNING` out of
the urgency ranking rather than forcing it onto a severity scale it does not belong on.
The word is proportionate to the derivation.

**Obligation reasons** are the cleanest example in the codebase of what the rest of
this sweep was correcting:

```
BLOCKED              -> "Blocked"
WAITING_ON_MATERIAL  -> "Waiting on material"
PARTIAL              -> "Partially complete"
REMAINING_WORK       -> "Work remaining"
UNKNOWN              -> "State unknown"
```

Every label states exactly what was derived and nothing more. `UNKNOWN` renders as
*"State unknown"* rather than borrowing a severity word or disappearing — the same
honesty rule the reconciliation and notification fixes had to restore elsewhere.

## The rule this sweep produced

A rendered signal is honest when its **strongest word is one the authority can
support**:

- a value the user **chose** may be named (priority);
- a value the system **derived** may describe the derivation (*at risk*, *waiting on
  material*) but must not assert a business fact the platform has no field for
  (*Emergency*);
- a value the system **could not evaluate** is `UNKNOWN`, never the most severe state
  and never blank;
- two different authorities must not share one vocabulary without saying which is which.

Recorded as a diagnostic lens for future review. **Not** implemented as a shared
status enum: the five defects had five different causes and a single taxonomy would
have obscured that, which is precisely how "CRITICAL over NaN" survived three
missions.

## Sweep status: COMPLETE for currently rendered signals

Five defects found and fixed; two signals confirmed honest. Re-run this lens when a
new derived signal reaches a surface, not on a schedule.
