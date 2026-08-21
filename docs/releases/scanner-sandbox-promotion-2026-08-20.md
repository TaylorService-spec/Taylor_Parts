---
artifact_type: release
gate: Scanner sandbox promotion — BEFORE captured, execution PENDING an operator
status: Repo side MERGED (main c9fd788c). Deploy and grants NOT executed — blocked in-session.
date: 2026-08-20
target: eos-platform-sandbox (platform-sandbox) — sandbox only, never taylor-parts
---

# Scanner sandbox promotion — before / after record

## 0. What actually happened, plainly

| Phase | State |
| --- | --- |
| Repo: four functional Roles + sandbox activation | **MERGED** — main `c9fd788c` |
| Deploy: Functions + Hosting | **NOT DONE** — `firebase deploy` is denied to this session |
| Grants: role assignments to personas | **NOT DONE** — needs the deploy first, and a named-recipient manifest |
| After-validation | **NOT RUN** — there is nothing deployed to validate |

**The before-state below is measured, not assumed.** The after-state is empty because the
promotion has not been executed, and no part of this document should be read as saying it has.

---

## 1. BEFORE — measured 2026-08-20

### Deployed revision

```
https://eos-platform-sandbox.web.app/version.json
{
  "commit": "969305e1",
  "environmentId": "platform-sandbox",
  "environmentRole": "sandbox",
  "buildTime": "2026-08-20T04:03:49.992Z"
}
```

`origin/main` is at **`c9fd788c`**. The sandbox is **43 commits behind** and predates the entire
scanner program — every phase from the shared Scan workspace (#1356) onward is absent.

### Callables — 84 deployed, 11 of the 18 scanner callables missing

| Present | Absent |
| --- | --- |
| `receiveInventoryStock` · `getAvailableEquipment` · `getLocationDisplay` · `dispatchTransferOrder` · `receiveTransferOrder` · `createCycleCount` · `submitCycleCount` | `getPurchaseOrderReceivingProgress` · `listReceivablePurchaseOrders` · `resolveScannedPartIdentifier` · `getPartBalance` · `createBin` · `deactivateBin` · `reactivateBin` · `resolveBin` · `listBins` · `recordPutAway` · `recordReturnIntake` |

The seven present ones shipped in earlier waves (transfers, cycle count, serialized-asset and
location reads). **Every callable the scanner program added is absent.**

> Method note: the first attempt to capture this parsed zero rows and would have reported all
> eighteen as absent. That was a parsing failure, not a measurement. The table above comes from a
> corrected parse of `firebase functions:list` that returns 84 rows.

### Rules and indexes

`git diff 969305e1 c9fd788c -- firestore.rules firestore.indexes.json` is **empty**.
No Rules or index deploy is required, and none is authorized.

---

## 2. What was merged (repo side)

Four least-privilege **functional** Roles — not permissions bolted onto job titles:

| Role | Carries | Excludes, deliberately |
| --- | --- | --- |
| `inventoryLookupReader` | the four lookup reads | any write; `inventory.catalog.manage` |
| `inventoryPutAwayOperator` | `bin.read` + `placement.record` | `bin.manage` |
| `inventoryBinAdministrator` | `bin.manage` + `bin.read` | `placement.record` |
| `inventoryReturnsIntakeClerk` | `returns.intake` | any disposition authority (#118) |

Six capabilities made eligible and declared activated for `platform-sandbox` only, in the canonical
registry, the frontend mirror, **and the runtime snapshot that ships inside the Functions bundle** —
all three, because the deployed backend reads the snapshot rather than `environments.json`.

**No Role carries `inventory.stock.receive`.** The deferral stands.

---

## 3. Execution — one command, then one grant step

### 3a. Deploy

```bash
./scripts/_sandboxRefresh.run.sh
```

Updated for this promotion: it now deploys Functions in **small named batches** (a single
`--only functions` call transiently fails a subset and leaves the estate half-new), verifies all
eighteen callables are ACTIVE afterwards, and **computes** the Rules/index parity claim against the
commit the sandbox is actually serving instead of carrying a hardcoded note that silently rots.

It must be run from a shell with `firebase` logged in. It refuses to run against production at three
separate points.

### 3b. Grants — the manifest

Grants are made by assigning functional Roles through the governed `assignApprovedRole` path, which
requires a **named recipient and a stated business need** per the 2026-08-18 Owner ruling.

| Persona | Roles to assign | Business need |
| --- | --- | --- |
| `sbx-partsassoc` | `inventoryLookupReader`, `inventoryPutAwayOperator`, `inventoryCycleCountCounter` | The parts-room floor job: look up, stow, pick, count |
| `sbx-partsmgr` | the above, plus `inventoryBinAdministrator` | Also labels and retires racking |
| `sbx-whmgr` | `inventoryLookupReader`, `inventoryPutAwayOperator`, `inventoryBinAdministrator`, `inventoryTransferOperator`, `inventoryReturnsIntakeClerk`, **`inventoryCycleCountReconciler`** | Runs the warehouse; **approves** counts |
| `sbx-tech` | `inventoryLookupReader` | Looks parts up in the field |

Two deliberate omissions, both of which would be easy to grant and wrong to:

1. **`sbx-whmgr` does not get `inventoryCycleCountCounter`.** Holding counter *and* reconciler would
   let one person open a count and approve their own variance — the control #111 exists to impose.
   Granting both must be an explicit waiver, not a convenience.
2. **Nobody gets `inventory.stock.receive`.** The deferred decision is untouched.

There is **no `sbx-whassoc` persona** in the sandbox register, so Warehouse Associate cannot be
exercised until one exists.

---

## 4. AFTER — the twelve scenarios

**Not yet run.** Full detail in
[`../deployment/scanner-sandbox-release-package.md`](../deployment/scanner-sandbox-release-package.md) §4.
Six must succeed; **six must refuse**, and a refusal scenario that "passes" by succeeding is a
release failure.

| | Scenario | Result |
| --- | --- | --- |
| V-1 | Part-code lookup | — |
| V-2 | Barcode resolves to the same part | — |
| V-3 | Balance reads UNKNOWN, not zero | — |
| V-4 | Receive, and see it land | — |
| V-5 | **Stow it, and the count does NOT move** (#116) | — |
| V-6 | Truck handoff removes it from the warehouse | — |
| V-7 | A persona with no functional Role reaches lookup only | — |
| V-8 | Readiness refusal reads differently from permission refusal | — |
| V-9 | Unregistered barcode finds nothing, invents nothing | — |
| V-10 | Unknown bin refused, not created | — |
| V-11 | A count changes nothing (#111) | — |
| V-12 | **A return restores nothing** (#118) | — |

**V-5 and V-12 are stop-the-release.** If either number moves the wrong way, a custody invariant is
broken and the damage compounds with every subsequent operation.

Two more worth running off the phone: an offline put-away (airplane mode mid-stow — the screen must
say *"do not assume it is done"*, never a tick), and one real 360px device in a real aisle.

---

## 5. Known gap carried into this promotion

**A technician cannot accept a truck handoff.** That needs `inventory.transfer.receive`, and the only
Role carrying it is `inventoryTransferOperator`, which also confers create/dispatch/cancel — far too
much authority for a van. A receive-only Role is required before the truck-handoff leg is operable
for technicians. Recorded rather than solved by over-granting.
