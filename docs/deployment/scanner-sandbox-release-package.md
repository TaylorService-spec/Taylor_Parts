---
artifact_type: deployment
gate: Scanner — sandbox release · AUTHORIZATION PACKAGE
status: Awaiting Owner authorization — NOTHING released, NO capability activated, NO grant made
date: 2026-08-20
target: eos-platform-sandbox (platform-sandbox)
scope: Proposal and validation plan only. No deploy, no activation, no grant, no readiness flip, no seeding.
---

# Scanner — sandbox release package

**Nothing in this document has been executed.** Every step in §3 is a protected action requiring
explicit Owner authorization, and none has been taken.

Its companion is [`docs/product/scanner-release-readiness.md`](../product/scanner-release-readiness.md),
which states what is currently true and is held by two test suites. This document states what would
have to happen, in what order, and **how you would know afterwards whether it worked** — including the
scenarios whose correct outcome is a refusal.

---

## 1. The one thing to read before authorizing anything

> **No warehouse or parts persona holds any scanner capability.**

`warehouseManager`, `warehouseAssociate`, `partsManager` and `partsAssociate` hold none of the
thirteen. **Activation and deployment alone would change nothing for the people the scanner was built
for.** A Parts Associate would still be unable to receive, count, stow, pick or transfer — they would
reach lookup, and nothing else.

Steps 1 and 3 below without step 2 produce a release that demonstrates only that the refusals work.
That is a legitimate first release — it proves the gate before opening it — but it should be chosen
deliberately rather than discovered in the sandbox by an operator who cannot do their job.

---

## 2. What is being released

| | Count | Detail |
| --- | --- | --- |
| Client bundle | 1 | The Scan workspace, six workflows, offline put-away |
| Callables | 18 | Listed in §3.3 |
| Capability activations | 12 | Listed in §3.1 |
| Readiness flips | 3 | `RECEIVING_TRANSPORT_READY`, `PART_IDENTIFIER_TRANSPORT_READY`, `INVENTORY_BALANCE_READ_READY` |
| **`firestore.rules` changes** | **0** | `bins`, `bin_placements`, `inventory_returns` need none — absent is deny-all, and the commands run on the Admin SDK. A test asserts no match block exists for any of the three. |
| **`firestore.indexes.json` changes** | **0** | Every scanner query is a single-field equality, which Firestore indexes automatically |
| **Migrations / backfills** | **0** | Every command derives its own document ids and reads live authorities. Seeded data is a *demonstration* concern, not a release dependency. |

**Nothing in this release requires data to be migrated, and nothing requires Rules to be weakened.**

---

## 3. The release, in order

Each step is independently authorizable and independently reversible except where noted.

### 3.1 Capability activations — 12

`inventory.catalog.alias.read` · `inventory.serializedAsset.read` · `inventory.location.display.read` ·
`inventory.balance.read` · `inventory.location.bin.manage` · `inventory.location.bin.read` ·
`inventory.placement.record` · `inventory.transfer.dispatch` · `inventory.transfer.receive` ·
`inventory.cycleCount.create` · `inventory.cycleCount.submit` · `inventory.returns.intake`

Each is independent: activating one lights its workflow and leaves the rest saying *"not switched
on"*. `inventory.stock.receive` is already active.

### 3.2 Grants — the Owner decision

**Deliberately not proposed as a mechanical step.** §5b of the readiness document offers a suggested
mapping as a starting point. `inventory.stock.receive` is absent from every suggested row, because
whether a Parts Associate may accept stock — and whether that authority is global or scoped to an
assigned warehouse — is a question already deferred once in `compatibilityRoles.ts`, and it should be
settled on its own terms rather than swept in with twelve others.

### 3.3 Functions deployment — 18 callables

`receiveInventoryStock` · `getPurchaseOrderReceivingProgress` · `listReceivablePurchaseOrders` ·
`resolveScannedPartIdentifier` · `getPartBalance` · `getAvailableEquipment` · `getLocationDisplay` ·
`createBin` · `deactivateBin` · `reactivateBin` · `resolveBin` · `listBins` · `recordPutAway` ·
`recordReturnIntake` · `dispatchTransferOrder` · `receiveTransferOrder` · `createCycleCount` ·
`submitCycleCount`

Deploy in **small named batches**, not one large `--only functions` call: large batches transiently
fail a subset of the set for reasons unrelated to IAM or org policy.

### 3.4 Readiness flips — 3

Per environment. Only `platform-sandbox.RECEIVING_TRANSPORT_READY` is currently true anywhere.

### 3.5 Hosting release — 1

The client bundle. **Part-code lookup needs only this** — no activation, no grant. `parts` is governed
by `firestore.rules` and that rule is already live, so scanning a part code and seeing what the part
is works on a Hosting release alone.

---

## 4. Twelve validation scenarios

Run **after** release, in the sandbox, as the named persona. Six prove something works; six prove
something correctly refuses. **A refusal scenario that "passes" by succeeding is a release failure,
not a bonus.**

Each states what to observe. None requires reading a log or a database to judge.

### Scenarios that must SUCCEED

**V-1 · Part-code lookup, no activation needed**
*As:* any signed-in persona.
Open Scan → Look up, scan or type a known part code.
**Expect:** the part's identity. Its inventory rows say *"not switched on"* until 3.1 happens — which
is truthful and useful, since identity is the half people ask for most.
*This is the only scenario that passes on a Hosting release alone.*

**V-2 · Barcode resolves to the same part**
*As:* admin.
Scan a registered barcode for the same part as V-1.
**Expect:** the identical `partId`. Whitespace a wedge appends is trimmed. If the two disagree, stop
the release — every downstream stage keys on that string.

**V-3 · Balance reads as UNKNOWN, not zero**
*As:* admin. Look up a part that has never been received anywhere.
**Expect:** *unknown*, never a confident `0`. A blank cell in a warehouse reads as *"there are none of
these"*, and that is the failure this read exists to prevent.

**V-4 · Receive, and see it land**
*As:* admin or dispatcher. Receive a quantity against an open PO into a warehouse.
**Expect:** the receipt confirms, and the same part's lookup now shows that quantity **at that
warehouse**. This is the seam that matters most: the ledger receiving writes is the ledger lookup sums.

**V-5 · Stow it, and watch the count NOT move**
*As:* a persona holding `inventory.placement.record`. Create bin `A-14`, put the V-4 stock into it.
**Expect:** confirmation says *"Stock counts are unchanged"*, and lookup still shows the **same**
on-hand at the **same** warehouse.
> **DECISIONS #116. If the number drops, stop the release immediately** — every downstream authority
> is now wrong, and the damage compounds with every subsequent stow.

**V-6 · Truck handoff moves it out of the warehouse**
*As:* a persona holding both transfer capabilities. Transfer part of the V-4 stock to a truck, dispatch,
receive.
**Expect:** warehouse on-hand falls by the transferred amount at dispatch — not at receipt. The truck's
stock does **not** appear in the part balance, which is correct: van stock is not sellable warehouse
stock, and the balance screen is not an answer to *"does my technician have one"*.

### Scenarios that must REFUSE

**V-7 · A persona with no scanner capability**
*As:* `partsAssociate` (assuming §3.2 has not granted them anything).
Open Scan.
**Expect:** lookup offered; receiving, transfers, counting, put-away and pick all listed as
**unavailable with a stated reason**. Not hidden, not silently absent — the operator must be able to
tell their supervisor *what* they are missing.

**V-8 · Readiness refusal reads differently from a permission refusal**
*As:* admin, in an environment where a readiness flag is still false.
**Expect:** the reason given is **not ready**, not *not authorized*. An admin told "not authorized"
goes looking for someone to grant them something they already have — this distinction decides who gets
a phone call.

**V-9 · An unregistered barcode finds nothing, and invents nothing**
*As:* admin. Scan a code that was never registered.
**Expect:** *not found*. **No part is offered as a near match.** A fallback from a failed alias lookup
to an unrelated part is how the wrong part gets fitted.

**V-10 · An unknown bin is refused, not created**
*As:* a persona holding `inventory.placement.record`. Stow into a bin code nobody labelled.
**Expect:** refusal naming the bin. Racking must never come into existence by being scanned at, or the
registry means nothing. Repeat with a bin belonging to a **different** warehouse: also refused.

**V-11 · A count changes nothing**
*As:* a persona holding both cycle-count capabilities. Count a part deliberately short, submit.
**Expect:** submission accepted, **and the on-hand figure unchanged.** Counting is not adjusting;
reconciliation is a separate, reviewed authority (#111), and the count is blind — no expected figure
is shown before submitting.

**V-12 · A return restores nothing**
*As:* a persona holding `inventory.returns.intake`. Take a return in against a part with known stock.
**Expect:** the return is recorded **awaiting disposition**, and on-hand is **unchanged**.
> **DECISIONS #118. If the number rises, stop** — returned goods have become sellable without anyone
> deciding they were fit to sell.

### Two more worth running, off the phone

Not numbered because they need no persona:

- **Offline put-away.** Put the handheld in airplane mode mid-stow and confirm. The screen must say
  *"Saved on this phone… do not assume it is done"* — never a tick. Restore the network; it sends
  itself, and the count still does not move.
- **A phone that is actually 360px wide.** The regression suite pins the properties that make small
  screens work, but it measures no pixel. One real device, one real aisle.

---

## 5. What to do if a scenario fails

| Failing scenario | Meaning | Action |
| --- | --- | --- |
| **V-5** or **V-12** rises | A custody invariant is broken | **Stop. Roll back the client.** Damage compounds per operation. |
| V-4 does not land | Receiving and the balance read disagree about the ledger | Stop; do not grant further |
| V-7 or V-8 wrong | The gate is not doing its job | Stop before granting anything |
| V-9, V-10, V-11 wrong | A single workflow is wrong | Deactivate that one capability; the other eleven are independent |
| V-1, V-2, V-3 wrong | A read is wrong | Lower severity — nothing is being written |

**Rollback is a Hosting re-release plus deactivating the affected capability.** No data written by this
release needs undoing: put-away and returns write their own collections and no balance, and receiving,
transfer and cycle count were already live authorities before it.

---

## 6. What this package explicitly does not authorize

Production, of any kind. Any grant not named by an Owner in §3.2. Seeding, backfilling or migrating
any data. Any `firestore.rules` or `firestore.indexes.json` change. Activating
`inventory.stock.receive` for any persona beyond those who hold it today.
