# Work Order closeout — the contract, before any installation is built into it

**D1 trace, 2026-08-23.** Read from the code, not from UI labels. Nothing implemented yet.

---

## 1. The canonical completion path

`transitionWorkOrder` (`functions/src/transitionWorkOrder.ts`) — an onCall command taking
`{ workOrderId, action }`.

**Action-based, never a raw status.** A client names an ACTION and the server resolves the status
through `ACTION_TO_STATUS`, so no client can smuggle an arbitrary transition by naming a status.

`fieldops_wos` denies all direct client writes unconditionally, so this callable and its two
siblings are the only write paths that exist.

## 2. States that may close

```
WORK_IN_PROGRESS --Complete--> COMPLETED --Close--> CLOSED
```

`COMPLETED` and `CLOSED` are terminal for cancellation; `CLOSED` and `CANCELLED` have no outgoing
transitions at all. The whole state machine is one table (`TRANSITIONS`), so there is no special-case
branch to keep in sync with it.

**`Complete` is the technician's action.** `Close` is admin/dispatcher.

## 3. Actor resolution

`getCallerContext(uid)` reads `users/{uid}` and returns `{ role, technicianId }`.

`ACTION_PERMISSIONS.Complete` = `{ roles: ["technician"], requiresOwnAssignment: true }` — so
Complete is restricted to the technician **assigned to that specific Work Order**. That is already
the scoping the installation path needs; it does not have to be invented.

## 4. Customer and location

`WorkOrder.customerId` and `WorkOrder.locationId` are **required** fields on the record.

So an installation recorded at closeout inherits both. The technician needs no customer picker and
no location picker — which is the access reduction the recording policy depends on.

## 5. Equipment reference

**There is none.** The `WorkOrder` interface has no `equipmentId`.

That is coherent rather than a gap: for an INSTALL work order the machine does not exist as Equipment
until the installation creates it. The reference that matters flows the other way — the created
Equipment carries `serializedAssetId`, `partId` and `installedFromLocationId`.

`inventorySnapshot` exists but is explicitly "optional, non-authoritative, purely descriptive — NOT
read or written by createWorkOrder()/transitionWorkOrder()".

## 6. The installation indicator ALREADY EXISTS

```ts
export type WorkOrderType = "SERVICE_CALL" | "PM" | "INSTALL" | "WARRANTY" | "INSPECTION";
```

`type: "INSTALL"` is canonical and required on every Work Order. **No new field is needed**, and
inventing `requiresEquipmentInstallation` would be a second way to say something the model already
says.

Live sandbox today: 20 work orders — **5 INSTALL**, 7 `"SERVICE"`, 8 with no type.

> ⚠ `"SERVICE"` is **not** a member of `WorkOrderType`. Seven live records carry a value the type
> union does not define, and eight carry none. Recorded here as an observation; not this slice's
> business, but an INSTALL-gated flow must not assume `type` is always a valid member.

## 7. Transaction and atomicity, as it stands

`transitionWorkOrder` does its work in **one** `db.runTransaction` — read, verify, write — plus:

- a per-technician sentinel document (`work_order_tech_locks`), read AND written inside the same
  transaction, forcing write-write contention so two concurrent transitions for one technician cannot
  both commit against stale snapshots;
- **Sales Order write-back staged into the same transaction** on `Complete` — the precedent that
  matters here: coordinating a second effect with completion is already done by staging it into the
  transition's own transaction, with all reads before any write;
- `triggerInventoryEffects()` as a strictly **post-commit** side effect whose failure is logged, never
  surfaced as a transition failure.

So this codebase already distinguishes *effects that must be atomic with completion* (staged inside)
from *effects that must not block it* (post-commit).

## 8. Notes, labour and parts

A separate narrow callable: `updateWorkOrderExecutionData` — the only write path for `qtyUsed`,
`executionLog` and `lastUpdated`. It never touches status or lifecycle timestamps, and it refuses
terminal statuses.

It accepts an **optional client idempotency key**, so a retry carrying the same key replays exactly
once — the established pattern for the additive `qtyUsed` delta and the append-only log.

## 9. Idempotency of completion itself

`Complete` is **not** idempotent. A repeat call fails `failed-precondition`, because
`canTransition("COMPLETED", "COMPLETED")` is false.

That is correct for a state machine, and it is the constraint the installation design has to work
with: the WO transition cannot be safely retried after it succeeds, while the install command
**can** (same key → `replayed`, same Equipment id).

---

## 10. The consistency boundary — and why ordering answers it

The forbidden outcome is stated plainly: **WO CLOSED but installation FAILED.**

Two separate `runTransaction` calls in two separate commands cannot be made atomic. Firestore
transactions do not span callables, and pretending otherwise would be the fiction D8 forbids.

But the forbidden state is an **ordering** problem, and ordering is free:

```
1. installSerializedAsset   (its own transaction, idempotent, replayable)
2. transitionWorkOrder Complete
```

| what fails | resulting state | recoverable? |
|---|---|---|
| install fails | WO still `WORK_IN_PROGRESS`, no Equipment | yes — nothing happened |
| install succeeds, Complete fails | WO still open, machine installed | yes — retry Complete; the install replays if re-attempted |
| both succeed | WO completed, one Equipment | — |

**The forbidden state is unreachable by construction**, because completion is never attempted until
the installation has already succeeded. No compensating transaction, no saga, no invented atomicity.

The cost is honest and small: a window in which a machine is installed and its Work Order is not yet
complete. That is a *recoverable* state a person can see and retry, and it is strictly better than
the alternative — a closed Work Order whose installation silently did not happen.

The alternative worth naming: staging the install's writes into the transition's own transaction, the
way the Sales Order write-back is staged. That would be genuinely atomic. It requires
`installSerializedAsset` to expose a stage-into-a-caller's-transaction form, which is a real change to
a command whose single-transaction guarantee is currently its own. **Not chosen** — the ordering above
removes the failure mode without touching the install authority at all, and "do not create a second
install command" argues against reshaping the first one to serve a second caller.

---

## 11. What still has to be designed

- the technician-scoped read for installable assets (D4) — whether `getAvailableEquipment` can be
  reused under a technician's capability, or whether a narrower WO-scoped read is required
- where the closeout UI puts the Equipment Installed step (D6)
- scan → resolve → confirm, with scan explicitly **not** installing (D7)
- the refusal set (D10) and the audit shape (D12)

None of it is built. This document is the trace D1 asked for, and the ordering decision in §10 is the
answer to D8.
