# Technician Labor Domain V1

**Owner-directed slice, 2026-08-23.** Closes `TECHNICIAN LABOR AUTHORITY GAP`.

---

## 1. The time model — INTERVAL *and* DURATION, chosen deliberately

Three options were on the table:

| | for | against |
|---|---|---|
| **A** start/end interval | knows *when*; overlap-checkable; reconcilable against a schedule | a technician entering "2 hours" at the end of the day does not know when they started |
| **B** entered duration | one field, fast on a phone | cannot detect overlap, cannot separate travel by time of day, cannot be reconciled |
| **C** start/stop producing an interval | precise | requires a running timer the operational UX does not have |

**Neither A nor B alone is honest.** Storing everything as an interval means inventing a start time to
fill the schema. Storing everything as a duration means throwing away *when* the work happened.

So a labor entry declares its own **shape**:

- **`INTERVAL`** — `startedAtMillis` + `endedAtMillis`. Duration and work date are *derived*, and
  supplying them is refused. Overlap-checkable.
- **`DURATION`** — `workDate` + `durationMinutes`. **No clock position, and it does not claim one.**

Overlap detection therefore applies to `INTERVAL` entries only. That limitation is **stated**, not
hidden: a `DURATION` entry genuinely cannot be checked against another.

The phone's common path produces `DURATION` — hours and minutes, a few taps. The richer shape is
available when the times are actually known.

## 2. Three facts the schema refuses to collapse

```
WORK PERFORMED   the technician spent this time on this job     <- recorded here
BILLABLE LABOR   some of it may be charged to a customer        <- not here
LABOR COST       the business incurs a cost for it              <- not here
```

A labor entry carries **no rate, no cost, no billable flag**. Asserted by a test that inspects a
stored document for `rate`, `hourlyRate`, `cost`, `laborCost`, `billable`, `revenue`, `amount` and
`price`, and fails if any appears.

Copying an hourly rate into an operational record would freeze a valuation nobody has decided, and it
cannot be un-frozen. The financial layer will derive its own facts from
`(work order, technician, date, duration, type)` — which is exactly what this stores.

## 3. Collection and authority

`work_order_labor_entries` — **no firestore.rules match block**, therefore deny-all to every client
including admin (the established `bins` / `inventory_returns` / `part_aliases` posture). A
technician's hours cannot be written from a browser at all.

Commands: `recordWorkOrderLabor`, `correctWorkOrderLabor`, `getWorkOrderLabor`.

## 4. Capabilities and Roles

| capability | Role | what it is not |
|---|---|---|
| `workOrder.labor.record` | `technicianLaborRecorder` | confers no correction, no cost visibility |
| `workOrder.labor.correct` | `workOrderLaborCorrector` | confers no authority to record new labor |

Two, not one: a technician fixing their own typo and a manager adjusting a crew's hours are different
acts with different accountability, even when the keystrokes match.

**Neither is the `technician` compatibility Role.** Job title is not authorization — a technician who
has not been staffed to record labor does not record labor.

**Both capabilities are `active: false` and activated in NO environment.** The Roles exist, are
grantable, and currently confer nothing anywhere; activation is a separate Owner decision. Asserted:
a principal *holding both Roles* is denied with `inactivePermission` — denied for inactivity, not for
a missing grant.

## 5. Work Order state rules

New labor is accepted only while the job is being executed:
`ACCEPTED · EN_ROUTE · ARRIVED · WORK_IN_PROGRESS`

`COMPLETED`, `CLOSED`, `CANCELLED` and every pre-execution state refuse it. Recording time against a
finished job is a **correction**, and corrections go through the correction authority where somebody
accountable can see them.

## 6. Validation — technical bounds, not HR policy

- end before or equal to start → refused
- negative or zero duration → refused
- **more than 16 hours in a single unbroken entry → refused**, for both shapes

Sixteen hours is not a shift limit anybody ratified. It is the point past which one unbroken entry is
more likely a runaway timer or a typo than a fact. It stops nonsense reaching the ledger and decides
nothing about what a working day is.

**Overlap:** one technician cannot be in two places at once. Touching intervals (09:00–11:00 and
11:00–12:00) do not overlap. Another technician's entries never block yours.

## 7. Idempotency

The entry id is derived from the idempotency key, so `create` **is** the check — Firestore rejects the
duplicate inside the transaction.

- identical retry → `replayed`, one record
- same key, different payload → `IDEMPOTENCY_CONFLICT`, never a silent overwrite

A phone on a bad connection retries. Hours must not double.

## 8. Correction — reverse and replace, never overwrite

The original entry is **never deleted**. It keeps its author, its timestamps and its values, gains
`status: REVERSED` and a pointer to its replacement. The replacement points back.

So *"why does this job show six hours when it used to show eight"* has an answer that does not require
a backup. Correcting an already-corrected entry chains **forward** — the original refuses with
`ENTRY_ALREADY_REVERSED` and names the replacement.

A correction keeps the **original technician**. It fixes what was recorded; it does not move labor
from one person to another. Who corrected it is recorded separately in `recordedByUid`.

## 9. Rollup is a projection

`projectWorkOrderLabor` derives totals — total, onsite, travel — from the entries on read.

**`workOrder.laborHours` is not written by this domain and must not become the source of truth.** A
denormalised total drifts from the entries the moment a correction lands, and then two numbers
disagree with nobody able to say which is right. The field remains declared-but-unwritten.

`REVERSED` entries are excluded from the totals **and still returned** — "what did this job cost in
time" and "what was recorded and later corrected" are different questions.

## 10. Device clock vs server clock

Two timestamps, and they are not the same fact:

- **`recordedAtMillis`** — the server's. When the platform accepted this.
- **`deviceReportedAtMillis`** — what the phone said, present **only** when the phone said something,
  which in practice means the entry was captured offline hours earlier.

A device clock is not an accounting authority: it can be wrong and it can be set. But rewriting work
time to sync time would be worse — it would move real work to the moment the signal came back. So both
are kept, neither is overwritten, and anything that later needs to reason about the difference can see
it. An entry recorded online carries no device claim at all.

## 11. Taylor / Ventana

Technician labor is **Taylor-performed labor**, whether the machine is a Taylor or an Icetro. There is
no Taylor-technician vs Ventana-technician labor model, and there must not be — equipment and
business-line attribution is a separate *reporting* dimension, resolved from the Work Order's
equipment, not from the person who turned the screws.

## 12. External vendor boundary

Out of scope. If an outside vendor performs Ventana service and EOS captures no financial or provider
transaction for it, **external labor cost is UNKNOWN — not zero.** No labor record is fabricated
because a service event occurred. This domain governs labor performed by internal technicians.

## 13. Explicitly not built

Payroll · wages · overtime · scheduling compliance · invoicing · customer labor rates · GL posting ·
the financial layer · external-vendor costing.

Seams, not implementations.
