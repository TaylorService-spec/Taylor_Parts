# Warehouse / Parts Offline Runtime (WO-05 / WO-05A)

**Owner-directed slices, 2026-08-23.** Durable warehouse observations → governed sync →
inventory-safe reconciliation, and every warehouse form routed through it.

**UI-integrated today — all eight:** receiving · put-away · pick/stage · transfer dispatch ·
transfer receipt · truck handoff · cycle count · return intake. Each submits through one shared
policy (`useWarehouseSubmit`) and is proven through the **rendered form** in
`test/warehouseOfflineScreens.test.jsx`. The earlier caveat that the runtime was wired but the
screens were online-first no longer applies.

**Reconciliation is still absent, by design** — no intent type, no binding, and no screen path.

---

## 1. The command-safety gate, answered first

WO-05's hard gate says: if a canonical command is not safely replayable, **stop that workflow and
report the gap** rather than fabricating client-side deduplication. So every command was read before
a line of runtime was written.

| workflow | command | replay design | verdict |
|---|---|---|---|
| receiving | `submitCanonicalReceive` | per-line sha256 ledger key + `receivingOrderDocId(idempotencyKey)` | **SAFE** |
| put-away | `recordPutAway` | `derivePlacementId(key, serial-or-part)` | **SAFE** |
| pick / stage | `recordPutAway` into a staging bin | same | **SAFE** |
| transfer create | `createTransferOrder` | `transferOrderDocId(key)` + payload fingerprint | **SAFE** |
| transfer dispatch | `dispatchTransferOrder` | accepts `REQUESTED` **or** `IN_TRANSIT`; the already-dispatched path requires ledger effects to have replayed coherently or it throws | **SAFE** |
| transfer receive | `receiveTransferOrder` | accepts `IN_TRANSIT` **or** `COMPLETED`, same design | **SAFE** |
| truck handoff | *is* a transfer | inherits the above | **SAFE** |
| cycle count submit | `submitCycleCount` | accepts `OPEN` **or** `COUNTED`; same count replays, a **different** count is an idempotency conflict rather than an overwrite | **SAFE** |
| return intake | `recordReturnIntake` | `deriveReturnId(key)` | **SAFE** |

**No blocker.** Every one is server-side replay-safe, and nothing in this runtime dedupes on the
client. Two commands are notable: dispatch and receive are *state transitions* that were nonetheless
built to accept their own destination state and verify the ledger replayed — that is real idempotency,
not a lucky refusal.

## 2. The offline principle, and why it is stricter here

A technician's queued note is a claim about words. **A warehouse worker's queued receipt is a claim
about stock**, and stock is shared, contended and conserved while other people move it.

> Offline capture never reserves, never allocates, and never projects a balance.

Two workers can capture receipts against the same remaining quantity and both be right at capture.
The server decides at sync, and one of them is told no. That is correct. Asserted by scanning every
payload for `reserved`, `allocated`, `projectedBalance`, `onHandAfter`, `committed`.

The runtime also never computes `server balance + local pending` as though it were truth (§36).

## 3. What is shared, and what deliberately is not

**Shared** (`intentEnvelope.js`, extracted in this slice): identity derivation, payload fingerprint,
credential refusal, birth state. Two copies of that assembly would drift on exactly the things that
matter most.

**Not shared**: command semantics, dependencies, prechecks, conflict copy. Inventory has different
concurrency, custody, quantity, serial, location and approval constraints from a work order, and a
shared envelope must never be mistaken for shared behaviour.

**Separate storage namespace** (`eos.warehouse.offline`). One person can be both a technician and a
warehouse worker on one device; a shared key would let each runtime's save wipe the other's queue,
silently, on every write.

## 4. Intent types — eight, closed

`INVENTORY_RECEIVE` · `PUT_AWAY` · `PICK_STAGE` · `TRANSFER_DISPATCH` · `TRANSFER_RECEIVE` ·
`TRUCK_HANDOFF` · `CYCLE_COUNT_SUBMIT` · `RETURN_INTAKE`

Each maps to one existing governed command. Not a generic warehouse command blob.

**`TRUCK_HANDOFF` is a transfer.** The type exists so the screen can say what the work is called; it
binds to the transfer lifecycle and nothing else. There is no separate mobile movement model.

**`PICK_STAGE` reserves nothing**, offline or online — reservation is a Work Order lifecycle effect,
not an operator action, and capturing one offline must not quietly become the reservation the online
path deliberately does not perform.

## 5. Reconciliation is online only — permanently

There is **no reconcile intent type and no reconcile binding**. Absence at both layers, asserted.

Approving a variance is a decision against current inventory truth. An offline worker cannot approve
a state they have not re-read, and a queued approval would land hours later, on numbers that have
moved, made by somebody who never saw the ones it lands on.

This is a business rule, not a gap. The UI says *"Reconnect to reconcile this count."*

## 6. Dependencies — two required edges, and why

| edge | required | why |
|---|---|---|
| `INVENTORY_RECEIVE → PUT_AWAY` | **yes** | Put-away records where *existing* stock goes. Placing something the server does not know exists is not a race — it is a guaranteed refusal. |
| `TRANSFER_DISPATCH → TRANSFER_RECEIVE` | **yes** | A transfer must be `IN_TRANSIT` before it can be received. Only when both were captured on **this** device. |
| return intake | no | Nothing blocks taking a return in. A note must never hold up the intake it describes. |
| cycle count | no | An observation depends on nothing and changes no balance. |

A put-away captured with no local receipt declares **no** dependency — the stock may already exist
server-side, and blocking on an edge nobody declared would strand it.

## 7. Prechecks — re-read, never decide

Inventory truth moves while a phone is in a dead zone.

- **cancelled transfer** → conflict; never dispatched
- **already dispatched/completed** → reconciled as done, and recorded as *reconciled* rather than
  caused: somebody else may have done it, and claiming this intent did would put a name on an act
  that was not theirs
- **transfer still `REQUESTED` on a receive** → **waits**, retryable, rather than being burned as a
  refusal. This is §40's reverse-reconnect case: the destination reconnects first and simply holds.
- **retired bin** → conflict. **Nothing is substituted** — quietly choosing another bin puts stock
  somewhere nobody was told about.
- **count already reconciled** → refuses. Arguing with a closed book.
- **cannot read** → proceed, and let the command answer on its own authority.

A precheck that passes followed by a command that refuses is a normal race, and the command wins.

## 8. Conflict UX — an object, not a sentence

A technician conflict is prose, and prose is right there. A warehouse conflict is a different
question: somebody at a rack with a box needs to know **which field moved**.

So warehouse conflicts render as discrete fields, per the structured-object standard — this is the
case that standard exists for.

**Two statuses, always:**

```
Transfer status : Cancelled      <- what the BUSINESS says
Sync status     : Needs review   <- what THIS DEVICE managed to send
```

Collapsing them would make "the transfer was cancelled" indistinguishable from "your dispatch has not
been sent" — opposite problems with opposite fixes.

A reference nobody recorded is **omitted** rather than rendered blank: unlike an object's own
attributes, these vary legitimately by intent type, and "Serial: Not recorded" on a quantity-tracked
part is noise pretending to be information.

## 9. Storage, durability, isolation

Shared adapter chain: IndexedDB → localStorage → memory, probed rather than assumed. A device with
nowhere durable to write reports `durable: false` and the UI says **"This phone is not saving work
offline"** — never "saved on this device". A failed save does not clear the form and does not claim
the work is queued.

Principal isolation is enforced twice: the key is namespaced by uid and the record carries the uid.
A foreign record is refused, never adopted, and **never deleted**.

## 10. Performance

| | WO-04 | WO-05 |
|---|---|---|
| entry chunk | 578.72 kB | 597.28 kB (+18.56) |
| entry gzip | 171.89 kB | 176.68 kB (+4.79) |
| `WarehouseSyncQueue` | — | 6.99 kB (2.62 kB gzip), lazy |
| `ScanWorkspace` | 70.57 kB lazy | 69.96 kB lazy |

The queue detail is lazy; the indicator is eager, because the one state that must never exist is
unsynced warehouse work with nothing on screen saying so. Technician bundle splitting is untouched
and no technician UI chunk is pulled into the warehouse path.

## 11. Mobile — real browser, 320 / 375 / 390 / 414

The structured conflict card — the hardest thing here to fit on a phone — measured with the shipped
stylesheet at all four widths: **no overflow, no clipping, no sub-44px control, nav pinned**, and both
status fields present and distinct at 320.

## 11a. Screen integration (WO-05A)

One submit policy for every warehouse form, in `offline/useWarehouseSubmit.js`:

| server available and accepts | canonical result |
|---|---|
| device knows it is offline, or a retryable transport failure | durable queue intent |
| **business refusal or permission denial** | **shown immediately, never queued** |

A clear server "no" never becomes `Pending sync`. Six screens submitting warehouse work would
otherwise have produced six slightly different send-or-queue rules — one trusting `navigator.onLine`,
one queueing on any error, one burying a permission denial in a retry queue that never gives up.

**Put-away was migrated, not merely wired.** It already had the right policy but against a second
queue whose `localStorage` key was **not scoped to a principal** — two warehouse workers on one
device shared it. That queue is gone from this path; there is now one durable, principal-scoped
queue for all warehouse work, and its standing summary lives in one place (More → Sync status)
rather than inside a single form.

**The runtime is provided by the scan workspace as well as by the shell.** The workspace is reachable
directly from Service → Scan, and a stow started from that route is the same stow, on the same phone,
in the same dead zone. The shell's provider wins when there is one; `disabled` keeps the hook call
unconditional without opening a second queue.

**Per-workflow pending copy**, because "Receipt pending sync" and "Count pending sync" are what a
person is actually waiting on — and each says what has *not* happened:

- `Receipt pending sync — nothing has been received yet.`
- `Put-away pending sync — the stock has not been moved yet.`
- `Transfer dispatch pending sync — the transfer has not moved yet.`
- `Count pending sync — nothing has been counted on the platform yet.`
- `Return intake pending sync — nothing has gone back into stock.`

Each screen renders its queued state in **its own branch**, above and separate from the success
branch — `✓ Recorded` is a statement about the platform, and a truthy outcome is not the same thing.

## 12. What WO-05 did NOT build

- **No reconciliation offline**, permanently (§55).
- **No disposition** — returns remains intake-only. No restock, scrap, repair, vendor return or
  credit; those product authorities do not exist (§56).
- No new capability, no new command, no Rules change.
- No projected/pending inventory impact display (§36 — V1 deliberately does not).
