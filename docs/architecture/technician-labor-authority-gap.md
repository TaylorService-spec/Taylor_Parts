# `TECHNICIAN LABOR AUTHORITY GAP`

**Status: OPEN. No labor UI was built.** Traced 2026-08-23 as WO-02 §1 required, before touching any
technician labor screen.

---

## What exists

One field, on the type, on both sides of the wire:

```ts
// functions/src/types/workOrder.ts  and  field-ops-app-vite/src/types/workOrder.ts
laborHours?: number;
```

## What writes it

**Nothing.**

- `createWorkOrder` — does not set it
- `transitionWorkOrder` — does not set it
- `updateWorkOrderExecutionData` — the only write path for execution data (`qtyUsed`, `executionLog`,
  `lastUpdated`) — does not set it

## What reads it

**Nothing.** No client surface, no report, no projection. A repo-wide search finds `laborHours` in
exactly four files: the two type declarations, and two documents (`docs/ROADMAP.md` and an
assessment) that describe it as intended future work.

## What does not exist at all

No labor collection. No time entries, no timesheet, no clock in/out, no activity segments, no
duration model, no cost or billing rate. `grep` across `functions/src` for `LABOR_`, `timeEntries`,
`timesheet`, `clockIn` returns nothing.

## So there is no labor model to build a UI against

Not a thin one, not an incomplete one — none. Building a technician labor screen would have required
inventing:

- what a labor record IS (duration? interval? segments?)
- where it lives
- who may correct it and when
- how it relates to a Work Order and to a technician's identity
- whether it is cost, billable time, or both

Every one of those is a business decision, and §1 said not to invent a second timekeeping model.

## This is already recorded as future work

The Owner's own roadmap register carries **Technician Labor + Cost Accounting** as an additive
requirement, with the shape already sketched: *paid ≠ job ≠ travel ≠ onsite*; a Tech × WO × interval
model; non-job time never disappearing and UNACCOUNTED being visible; effective-dated cost-rate
authority held away from Work Orders; and the explicit separation *hours ≠ cost ≠ billable ≠ revenue*.

That is a package, not a screen. The register also places it after Service Ops convergence.

## Consequence for WO-02

- No labor UI was built. §10 and §11 are not satisfied, deliberately.
- In the offline matrix, labor is `onlineRequired: true`, `capturable: false` — **not** because a
  device cannot capture time, but because there is nothing to capture it *into*. Classifying it as
  capturable would promise the WO-03 runtime something it could never deliver.

## What unblocks it

A labor domain package: the model, the authority, the correction rules, the audit shape. Once that
exists, the technician UI is small — a few taps against a contract that already knows what a labor
record means.
