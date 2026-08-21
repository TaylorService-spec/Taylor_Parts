# Scanner — release readiness matrix

**Reconciled against `origin/main` on 2026-08-20.**

Every fact below is asserted by a test, so this page cannot drift from the repository:

- `functions/test/scannerReleaseReadiness.test.mjs` — capability, activation, grants, readiness,
  callable exports, Rules and migration dependencies.
- `field-ops-app-vite/test/personaOperability.test.mjs` — what each persona can actually reach.

If a grant or an activation changes, those tests fail until they are updated in the same commit.

---

## 1. The release-blocking finding

> **No warehouse or parts persona holds any scanner capability.**

`warehouseManager`, `warehouseAssociate`, `partsManager` and `partsAssociate` hold **none** of the
thirteen. Activation alone would therefore change nothing for the people the scanner was built for: a
Parts Associate still could not receive, count, stow, pick or transfer. They reach **lookup only**,
and lookup is reachable because it is governed by `firestore.rules` rather than by a capability.

This is not an oversight to fix in code. Granting is a **rollout action and an Owner decision**, and
there is already a recorded deferral on the nearest one — `compatibilityRoles.ts` notes that
`PARTS_ASSOCIATE` is deferred for `inventory.stock.receive` *"until a separately ratified scoped
model or an explicit Owner acceptance of global Receiving authority."*

The same question now applies to twelve more capabilities. **§5 states the exact grant list.**

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

| Persona | Lookup | Receiving | Transfers | Cycle count | Put-away | Pick/stage | Tech scanner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Admin / Owner | VISIBLE | VISIBLE¹ | VISIBLE | VISIBLE | VISIBLE | VISIBLE | N/A |
| Dispatcher | VISIBLE | VISIBLE¹ | DENIED | DENIED | DENIED | DENIED | N/A |
| Technician | VISIBLE | DENIED | DENIED | DENIED | DENIED | DENIED | VISIBLE |
| Parts Associate | VISIBLE | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | N/A |
| Parts Manager | VISIBLE | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | N/A |
| Warehouse Associate | VISIBLE | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | N/A |
| Warehouse Manager | VISIBLE | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | N/A |

¹ Only where `RECEIVING_TRANSPORT_READY` is true — the sandbox. Elsewhere it is DENIED for
**readiness**, and the screen says so rather than claiming a permission problem.

The bold column is the finding in §1.

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

A **suggested** mapping, offered as a starting point rather than a recommendation to adopt as-is.
Who may receive stock, and whether that authority is global or scoped to an assigned warehouse, is
exactly the question already deferred once.

| Persona | Suggested grants | Why |
| --- | --- | --- |
| Parts Associate | bin.read, placement.record, cycleCount.create/submit, balance.read, alias.read, serializedAsset.read, location.display.read | The floor job: stow, pick, count, look things up |
| Warehouse Associate | same as Parts Associate, plus transfer.dispatch/receive | Also moves stock between sites and onto trucks |
| Parts Manager | Associate's set, plus bin.manage | Also labels racking |
| Warehouse Manager | Associate's set, plus bin.manage, returns.intake | Also labels racking and takes returns in |
| Technician | transfer.receive, cycleCount.create/submit | Accepts a truck handoff; counts their own van |
| Dispatcher | unchanged | Receiving only, as today |

**`inventory.stock.receive` is deliberately absent from every row.** That is the deferred decision,
and it should be settled on its own terms rather than swept in with twelve others.

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
