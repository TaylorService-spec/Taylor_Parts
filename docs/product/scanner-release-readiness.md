# Scanner — release readiness matrix

**Reconciled against `origin/main` on 2026-08-20.**

Every fact below is asserted by a test, so this page cannot drift from the repository:

- `functions/test/scannerReleaseReadiness.test.mjs` — capability, activation, grants, readiness,
  callable exports, Rules and migration dependencies.
- `field-ops-app-vite/test/personaOperability.test.mjs` — what each persona can actually reach.

If a grant or an activation changes, those tests fail until they are updated in the same commit.

---

## 1. The release-blocking finding — and how it was actually resolved

> **RESOLVED 2026-08-20 by the sandbox promotion.** The finding below was true, and the fix it
> originally implied was **wrong**. Both are recorded, because the correction is the useful part.

### What was found

`warehouseManager`, `warehouseAssociate`, `partsManager` and `partsAssociate` held **none** of the
thirteen capabilities. Activation alone would have changed nothing for the people the scanner was
built for: a Parts Associate still could not count, stow, pick or transfer.

### Why the obvious fix was wrong

This document originally proposed granting capabilities **to those four roles**. That would have been
a mistake. Those four are **org-chart positions** and carry no permissions by design — each says
*"Carries no permissions of its own"* in its own description. Operational authority has always lived
in separate **functional roles** (`inventoryTransferOperator`, `inventoryCycleCountCounter`), and a
principal holds a position *and* one or more functions.

Putting scanner capabilities on a position would have made every future warehouse hire an inventory
writer by virtue of their job title.

### What was done instead — four functional roles

| Role | Carries | Deliberately excludes |
| --- | --- | --- |
| `inventoryLookupReader` | The four lookup **reads** | Any write; `inventory.catalog.manage` |
| `inventoryPutAwayOperator` | `bin.read` + `placement.record` | `bin.manage` — a stower must not retire racking |
| `inventoryBinAdministrator` | `bin.manage` + `bin.read` | `placement.record` — a labeller must not stow |
| `inventoryReturnsIntakeClerk` | `returns.intake` | Any disposition authority (#118) |

All four are `privileged: false`, registered in the governed catalog **and** in the assignable
allowlist — a role missing from the latter is visible everywhere and impossible to actually grant.

**`inventory.stock.receive` is carried by none of them.** The recorded deferral stands:
`compatibilityRoles.ts` notes `PARTS_ASSOCIATE` is deferred for it *"until a separately ratified
scoped model or an explicit Owner acceptance of global Receiving authority."*

## 2. Capability matrix

| Capability | State | Held by | Callable | Deployed | Readiness gate | Rules | Migration | Workflow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `inventory.stock.receive` | **ACTIVE** | admin, dispatcher, owner | `receiveInventoryStock` + 2 reads | **No** | `RECEIVING_TRANSPORT_READY` | none | none | Receiving |
| `inventory.catalog.alias.read` | INERT | admin, owner | `resolveScannedPartIdentifier` | **No** | `PART_IDENTIFIER_TRANSPORT_READY` | none | none | Barcode lookup |
| `inventory.serializedAsset.read` | INERT | admin, owner, purchasingManager | `getAvailableEquipment` | **No** | none | none | none | Serialized lookup |
| `inventory.location.display.read` | INERT | admin, owner | `getLocationDisplay` | **No** | none | none | none | Location labels |
| `inventory.balance.read` | INERT | admin, owner | `getPartBalance` | **No** | `INVENTORY_BALANCE_READ_READY` | none | none | Balance lookup |
| `inventory.location.bin.manage` | INERT | admin, owner | `createBin`/`deactivateBin`/`reactivateBin` | **No** | none | **none needed** | none | Bin administration |
| `inventory.location.bin.read` | INERT | admin, owner | `resolveBin`, `listBins` | **No** | none | **none needed** | none | Put-away, pick |
| `inventory.placement.record` | INERT | admin, owner | `recordPutAway` | **No** | none | **none needed** | none | Put-away, pick |
| `inventory.transfer.dispatch` | INERT | admin, owner | `dispatchTransferOrder` | **No** | none | none | none | Transfers, truck handoff |
| `inventory.transfer.receive` | INERT | admin, owner | `receiveTransferOrder` | **No** | none | none | none | Transfers, truck handoff |
| `inventory.cycleCount.create` | INERT | admin, owner | `createCycleCount` | **No** | none | none | none | Cycle count |
| `inventory.cycleCount.submit` | INERT | admin, owner | `submitCycleCount` | **No** | none | none | none | Cycle count |
| `inventory.returns.intake` | INERT | admin, owner | `recordReturnIntake` | **No** | none | **none needed** | none | Returns intake |

**"None needed" is a claim the tests verify**: `bins`, `bin_placements` and `inventory_returns` have
no `firestore.rules` match block, because absent means deny-all and the commands run on the Admin
SDK. Nothing was weakened to add them.

**No scanner workflow depends on a migration or a backfill.** Every command derives its own document
ids and reads live authorities. Seeded data is a *demonstration* concern, not a release dependency.

## 3. Persona operability, today

`VISIBLE` = offered and usable · `DENIED` = listed with a stated reason · `N/A` = never applies

As assigned in **platform-sandbox** after the promotion. A position with no functional role assigned
still reaches lookup and nothing else — that invariant is separately asserted.

| Persona | Lookup | Receiving | Transfers | Cycle count | Put-away | Pick/stage | Tech scanner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Admin / Owner | VISIBLE | VISIBLE¹ | VISIBLE | VISIBLE | VISIBLE | VISIBLE | N/A |
| Dispatcher | VISIBLE | VISIBLE¹ | DENIED | DENIED | DENIED | DENIED | N/A |
| Technician | VISIBLE | DENIED | DENIED² | DENIED | DENIED | DENIED | VISIBLE |
| Parts Associate | VISIBLE | **DENIED** | DENIED | VISIBLE | VISIBLE | VISIBLE | N/A |
| Parts Manager | VISIBLE | **DENIED** | DENIED | VISIBLE | VISIBLE | VISIBLE | N/A |
| Warehouse Associate | VISIBLE | **DENIED** | VISIBLE | VISIBLE | VISIBLE | VISIBLE | N/A |
| Warehouse Manager | VISIBLE | **DENIED** | VISIBLE | DENIED³ | VISIBLE | VISIBLE | N/A |

¹ Only where `RECEIVING_TRANSPORT_READY` is true — the sandbox. Elsewhere it is DENIED for
**readiness**, and the screen says so rather than claiming a permission problem.

² **A real gap, recorded rather than fudged.** Accepting a truck handoff needs
`inventory.transfer.receive`, and the only role carrying it is `inventoryTransferOperator`, which also
confers create/dispatch/cancel — far too much for a van. A receive-only role is required before a
technician can take a handoff; inventing one was out of scope for this promotion.

³ **Deliberate.** Warehouse Manager holds `inventoryCycleCountReconciler` and **not**
`inventoryCycleCountCounter`, so they cannot open a count and then approve their own variance
(DECISIONS #111). A manager reconciling what an associate counted is the control working; one person
holding both halves is the control being waived, and that must be an explicit grant decision rather
than a default.

The bold column is what remains withheld: **receiving**, per §1.

## 4. What is NOT a gap

- **Excessive grants:** none found. Admin holds everything, which is its purpose; dispatcher holds
  receiving only; technician holds nothing.
- **Accidental access:** none. A test walks every persona × workflow and fails if any workflow is
  reached without its capability.
- **Unreachable workflows:** none. Every workflow is reachable by at least one persona.
- **Navigation mismatch:** none. Scan is reached through `capabilityAccess` (governed personas) or
  `legacyKey: "fieldMode"` (technicians); `ROLE_NAV_ACCESS` is untouched.

## 5. The exact rollout actions remaining

Everything below is a **protected action**. None has been taken.

### 5a. Capability activations — 12

`inventory.catalog.alias.read` · `inventory.serializedAsset.read` · `inventory.location.display.read`
· `inventory.balance.read` · `inventory.location.bin.manage` · `inventory.location.bin.read` ·
`inventory.placement.record` · `inventory.transfer.dispatch` · `inventory.transfer.receive` ·
`inventory.cycleCount.create` · `inventory.cycleCount.submit` · `inventory.returns.intake`

Each is independent: activating one lights its workflow and leaves the rest saying "not switched on".

### 5b. Grants by persona — the Owner decision

Grants are made by assigning **functional roles**, never by adding capabilities to a position (§1).

| Persona | Roles assigned in sandbox | Why |
| --- | --- | --- |
| Parts Associate | lookupReader · putAwayOperator · cycleCountCounter | The floor job: look things up, stow, pick, count |
| Warehouse Associate | the above, plus transferOperator | Also moves stock between sites and onto trucks |
| Parts Manager | Associate's set, plus binAdministrator | Also labels racking |
| Warehouse Manager | lookupReader · putAwayOperator · binAdministrator · transferOperator · returnsIntakeClerk · **cycleCountReconciler** | Labels racking, takes returns in, and **approves** counts — with no counter role, so they cannot approve their own |
| Technician | lookupReader | See §3 note ² — a receive-only transfer role does not exist yet |
| Dispatcher / Admin | unchanged | Compatibility roles, as today |

**`inventory.stock.receive` is carried by no role in this table.** That is the deferred decision, and
it should be settled on its own terms rather than swept in with the rest.

### 5c. Readiness flips — 3

`RECEIVING_TRANSPORT_READY` · `PART_IDENTIFIER_TRANSPORT_READY` · `INVENTORY_BALANCE_READ_READY`,
per target environment. Only the sandbox's receiving flag is currently true.

### 5d. Functions deployment — 16 callables

`receiveInventoryStock`, `getPurchaseOrderReceivingProgress`, `listReceivablePurchaseOrders`,
`resolveScannedPartIdentifier`, `getPartBalance`, `getAvailableEquipment`, `getLocationDisplay`,
`createBin`, `deactivateBin`, `reactivateBin`, `resolveBin`, `listBins`, `recordPutAway`,
`recordReturnIntake`, `dispatchTransferOrder`, `receiveTransferOrder`, `createCycleCount`,
`submitCycleCount`.

### 5e. Hosting release — 1

The client bundle. **Part-code lookup needs only this** — no activation, no grant.

## 6. The one thing that is operable without a rollout decision

**Part-code lookup.** `parts` is governed by `firestore.rules` (admin/dispatcher, or an ACTIVE
employee holding `PARTS_MANAGER` or `WAREHOUSE_MANAGER`) and that rule is live in production today.
Scanning or typing a part code and seeing what the part is works on a Hosting release alone.

Its inventory rows will say "not switched on" until §5a happens, which is truthful and useful:
identity is the half people ask for most.
