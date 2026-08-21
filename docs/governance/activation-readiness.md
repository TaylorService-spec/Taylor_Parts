# Role governance — activation readiness

**Date:** 2026-08-21 · **Basis:** merged `27a6307b` (PR #1399) plus the capacity analysis on this branch
**Generated data:** `docs/governance/capacity-report.json` (`node functions/scripts/governance/capacityReport.mjs`)

**Nothing in this document has been executed.** No capability activated, no employee granted, no
Rules changed, no compatibility role altered.

---

## The distinction this report is built on

Capacity is not headcount, job title, granted capability, or functional-role assignment. It is all of
them intersected with the permission catalog's own active flag:

```
EMPLOYEE → BUSINESS ROLE(S) → FUNCTIONAL ROLE(S) → GRANTED → ACTIVE → OPERABLE
```

**A capability that is granted but inactive resolves `DENY / inactivePermission` for every principal
including owner.** It is zero operational capacity. 44 of 116 catalog capabilities are inactive, and
they are not spread evenly — they are concentrated in inventory, which is why nine of fifteen
workstreams come back `GRANTED_BUT_INACTIVE`.

---

## 1 — Two findings that changed the report

### A. A governance decision was being defeated at the employee level

Both General Manager employees held all four `admin.*` capabilities.

`generalManagerNoAdmin.test.mjs` was green throughout, and correctly so — the governed
`generalManager` Role holds zero `admin.*`, exactly as the Owner's Option 2 decision requires. The
roster then gave those employees the legacy `admin` compatibility role, and the server resolves the
**union** of legacy and governed authority. `admin.userStatus.write`,
`admin.roleAssignment.write`, `admin.accessRequest.decide` and `admin.credentialReset.initiate` all
came back.

**Every authority guard in this repository asserts things about roles. This defect was in a person.**

Corrected in the **fixture**, not the compatibility role: General Managers now carry `dispatcher`,
the widest legacy role carrying no `admin.*` (38 capabilities, verified). `admin`, `dispatcher` and
`technician` keep every capability they have. Guarded by
`workforceDoesNotDefeatGovernance.test.mjs`, mutation-proven.

The correction is visible below: ADMINISTRATION and REPORTING drop from 3 operable workers to 1.

### B. 80% of this workforce's authority is legacy, not governed

| Source of operable capability-holdings | Count | Share |
|---|---:|---:|
| Legacy compatibility role **only** | 976 | 80% |
| Both legacy and governed | 224 | 18% |
| Governed role **only** | 24 | **2%** |

**14 of 43 employees would hold zero operable authority if the compatibility roles were removed
today.** Every workstream below is therefore counted twice — on the union, and on governed grants
only. Reporting one number would let a workstream read ADEQUATE while borrowing its entire authority
from the thing R-1 exists to retire.

---

## 2 — Workstream capacity matrix

| Workstream | Assigned | Granted-eligible | Operable-eligible | Governed-only | Available | Blocked reason | Result |
|---|---:|---:|---:|---:|---:|---|---|
| CRM / Sales | 7 | 32 | 0 | 0 | 0 | inactive: `opportunity.read` | GRANTED_BUT_INACTIVE |
| Dispatch | 7 | 43 | 43 | 13 | 39 | — | ADEQUATE |
| Service | 15 | 43 | 43 | 13 | 39 | — | ADEQUATE |
| Parts Lookup | 9 | 23 | 0 | 0 | 0 | inactive: `inventory.balance.read` | GRANTED_BUT_INACTIVE |
| Put-away | 7 | 10 | 0 | 0 | 0 | inactive: `inventory.placement.record`, `inventory.location.bin.read` | GRANTED_BUT_INACTIVE |
| Pick / Stage | 3 | 23 | 0 | 0 | 0 | inactive: `inventory.balance.read` | GRANTED_BUT_INACTIVE |
| Transfers | 1 | 4 | 0 | 0 | 0 | inactive: `inventory.transfer.create`, `.dispatch` | GRANTED_BUT_INACTIVE |
| Cycle Count | 4 | 7 | 0 | 0 | 0 | inactive: `inventory.cycleCount.create`, `.submit` | GRANTED_BUT_INACTIVE |
| Cycle Count Reconcile | 2 | 5 | 0 | 0 | 0 | inactive: `inventory.cycleCount.reconcile` | GRANTED_BUT_INACTIVE |
| Receiving | **0** | 32 | 32 | 1 | 30 | nobody assigned | ADEQUATE |
| Returns Intake | 1 | 4 | 0 | 0 | 0 | inactive: `inventory.returns.intake` | GRANTED_BUT_INACTIVE |
| Procurement | 1 | 43 | 43 | 2 | 39 | — | ADEQUATE |
| Finance / AR (Accounting) | 4 | 19 | 0 | 0 | 0 | inactive: `finance.read` | GRANTED_BUT_INACTIVE |
| Administration | 5 | 1 | 1 | 1 | 1 | owner only — no backup | THIN |
| Reporting | 6 | 1 | 1 | 1 | 1 | owner only — no backup | THIN |
| Audit | — | — | — | — | — | no workstream declared (see §6D) | NOT MODELLED |

**Coverage summary**

- **≥2 operable workers:** 4 — Dispatch, Service, Receiving, Procurement
- **Exactly 1 operable worker:** 2 — Administration, Reporting *(both owner-only)*
- **0 operable workers:** 9 — CRM/Sales, Parts Lookup, Put-away, Pick/Stage, Transfers, Cycle Count, Cycle Count Reconcile, Returns, Finance/AR

**Assignment classifications across 43 employees:** 37 `GRANTED_BUT_INACTIVE`, 29 `OPERABLE`,
6 `UNDER_PRIVILEGED`, 0 `SOD_CONFLICT`, 0 `AUTHORITY_BLOCKED`, 0 `OVER_PRIVILEGED` at assignment level.

**The six `UNDER_PRIVILEGED` rows are real and each is a genuine gap, not a fixture error:**

| Employee | Governed role | Workstream | Missing |
|---|---|---|---|
| cw-emp-003, -004 | operationsManager | Reporting | `report.definition.read` |
| cw-emp-005, -006 | officeManager | Administration | `admin.roleAssignment.write` |
| cw-emp-041 | financeManager | Finance/AR | `finance.read` |
| cw-emp-041 | financeManager | Reporting | `report.definition.read` |

Four of these six are the Reporting gap (decision package §6A). The Administration two are
deliberate: `officeManager` was never intended to administer security, so its assignment to the
ADMINISTRATION workstream is the mislabel — **the workstream requirement, not the role, is what
should change** (Administration currently requires `admin.roleAssignment.write`, which makes it a
security workstream rather than an office-operations one).

**Two counts that look wrong and are not:**

- **Dispatch/Service/Procurement granted-eligible = 43 (everyone).** Correct: every employee carries
  a legacy compatibility role, and `dispatcher` (38 capabilities) and `technician` (14) both include
  `workOrder.transition` and the `reorder.request.*` workflow. Governed-only, the figures are 13, 13
  and 2 — the honest numbers.
- **Receiving: 0 assigned, 32 operable.** Nobody was given receiving responsibility, yet a third of
  the workforce could perform it, all through legacy authority (governed-only = 1). This is a
  coverage gap **and** a standing over-privilege, and it is the clearest single argument for R-1.

---

## 3 — The nine inert functional Roles

Four facts are kept separate here on purpose, because collapsing them is what makes a grant plan
wrong: **ROLE EXISTS** ≠ **ROLE IS ASSIGNED** ≠ **CAPABILITY IS ACTIVE** ≠ **WORKFLOW IS OPERABLE**.

| Role | Capabilities | All inactive | Assigned to a planned employee | Both true | Dependent workstream | Activation needed | Grant needed |
|---|---|:--:|:--:|:--:|---|:--:|:--:|
| `inventoryLookupReader` | `inventory.balance.read`, `.catalog.alias.read`, `.location.display.read`, `.serializedAsset.read` | yes | yes (7) | no | Parts Lookup, Pick/Stage | yes | no |
| `inventoryPutAwayOperator` | `inventory.location.bin.read`, `.placement.record` | yes | yes (7) | no | Put-away | yes | no |
| `inventoryBinAdministrator` | `inventory.location.bin.manage`, `.bin.read` | yes | yes (1) | no | Put-away (bin side) | yes | no |
| `inventoryCycleCountCounter` | `inventory.cycleCount.cancel`, `.create`, `.submit` | yes | yes (4) | no | Cycle Count | yes | no |
| `inventoryCycleCountReconciler` | `inventory.cycleCount.reconcile` | yes | yes (2) | no | Cycle Count Reconcile | yes | no |
| `inventoryTransferOperator` | `inventory.transfer.cancel`, `.create`, `.dispatch`, `.receive` | yes | yes (1) | no | Transfers | yes | no |
| `inventoryReturnsIntakeClerk` | `inventory.returns.intake` | yes | yes (1) | no | Returns Intake | yes | no |
| `crmActivityContributor` | `crm.activity.create`, `.read` | yes | yes (4) | no | none declared | yes | no |
| `workOrderPartsPlanner` | `workOrder.parts.plan` | yes | **no** | **yes** | none declared | yes | **yes** |

**Eight of the nine are already assigned and simply switched off.** Granting them again would change
nothing; the only thing standing between the workforce and the work is activation.

**`workOrderPartsPlanner` is the one that is both inactive and unassigned** — nobody in the planned
roster holds it. It also has no declared workstream, so nothing currently depends on it. Recommend
leaving it unassigned until a workstream requires it, rather than granting it to make a table
symmetrical.

**SoD impact:** none of the nine creates a conflict as planned. Both exclusive pairs are staffed by
**disjoint** people — counter (4) vs reconciler (2), bin-administrator (1) vs put-away (7) — and zero
employees hold both sides of either pair. Activation does not change that; it makes the existing
separation *effective* rather than theoretical.

---

## 4 — Deliberately privileged vs unresolved business ownership

This distinction is permanent and must appear in every future governance report. Presenting the
second group as if it were the first reports an undecided question as settled policy.

### DELIBERATELY PRIVILEGED — 4

| Capability | Why it stays Owner/Admin |
|---|---|
| `admin.userStatus.write` | security administration |
| `admin.roleAssignment.write` | grants privilege; two-person control preserved |
| `admin.accessRequest.decide` | approves privilege requests |
| `admin.credentialReset.initiate` | credential authority (registered inactive, ungranted — #56) |

Owner decision 2026-08-21, Option 2. General Manager is the highest **business** role and is not
security administration. **Settled — no action requested.**

### UNRESOLVED BUSINESS OWNERSHIP — 46

These are Owner/Admin-only because **admin holds the entire catalog by derivation** (Owner ruling
2026-08-19, `ADMIN_ALL_PERMISSIONS` derived from `PERMISSION_CATALOG`), not because anyone decided
this work is privileged.

| Family | Count | Decision package |
|---|---:|---|
| `report.*` | 39 | §6A |
| `equipment.*` | 5 | §6B |
| `coverage.*` | 2 | §6C |

---

## 5 — Minimum staffing gaps

Zero SoD violations in the planned roster. Both exclusive pairs disjoint. The gaps are coverage
depth, not conflicts.

| Gap | Workstream | Current | Risk | Recommendation |
|---|---|---:|---|---|
| No assigned worker | **Receiving** | 0 | Nobody is responsible, while 32 people can do it via legacy authority | Assign 2 (1 warehouse associate + 1 parts associate as backup) |
| Single point of failure | **Transfers** | 1 | The one `inventoryTransferOperator` is also the sole bin administrator and returns clerk | Add 1 warehouse associate with `inventoryTransferOperator` |
| Single point of failure | **Returns Intake** | 1 | Same person as Transfers — one absence closes both | Add 1 (see below) |
| Single point of failure | **Procurement** | 1 | One `purchasingManager`; no backup buyer | Add 1 purchasing backup, **without** approve/reject (SoD) |
| Single point of failure | **Bin administration** | 1 | One `inventoryBinAdministrator`; SoD forbids giving it to a put-away operator | Add 1 warehouse **manager**, not an associate |
| Owner-only | **Administration** | 1 | Only `owner` can administer | Expected under Option 2 — no change requested |
| Owner-only | **Reporting** | 1 | Only `owner` can read reports | Resolved by decision package §6A |

**Recommended additional synthetic certification employees: 4.**

| # | Role shape | Purpose |
|---|---|---|
| 1 | `warehouseAssociate` + `inventoryTransferOperator` | Transfers backup |
| 2 | `warehouseAssociate` + `inventoryReturnsIntakeClerk` | Returns backup, separate from Transfers |
| 3 | `warehouseManager` + `inventoryBinAdministrator` | Bin-administration backup that does not violate the put-away SoD |
| 4 | `purchasingManager` | Procurement backup; approve/reject stays withheld |

This is sandbox fixture staffing, not hiring advice. Roster grows 43 → 47.

---

## 6 — Four Owner decision packages

### A — REPORTING (39 capabilities)

**What actually exists.** Not a general reporting engine — 39 concrete ids in two groups:

- **34 object/field READS** over exactly four objects: Customer (13), Contact (6), Location (5),
  Equipment (9), plus one object-level read each. Three are inactive
  (`customer.field.notes`, `customer.field.accountOwner`, `location.field.accessNotes`).
- **5 definition-CRUD** ids: `report.definition.create` / `.read` / `.rename` / `.duplicate` /
  `.delete`.

**There are no finance, sales-order, inventory or employee report ids at all.** The Owner asked me to
separate finance-sensitive and employee-sensitive reporting; those categories **do not exist yet** in
the catalog, and I will not invent them to fill the table. What does exist is a finance-sensitive
subset *within* Customer.

**Recommended model — a functional Role, not embedding in business titles.**

Reporting is *read of data the Role can already see*: a Sales Manager reading a customer report
learns nothing they could not read record by record. But field-level reads are not uniform in
sensitivity, so one bundle would over-grant.

| Proposed functional Role | Contents | Recommended holders |
|---|---|---|
| `reportViewer` | The 5 definition ids minus `delete`, plus the 26 active non-sensitive object/field reads (name, status, dates, identity, address, contact fields, relationships, tags, external ids) | generalManager, operationsManager, salesManager, fieldManager, partsManager, warehouseManager |
| `reportFinanceViewer` | `customer.field.paymentTerms`, `.taxStatus`, `.commercialProfile`, `.billingContact`, `.billingAddress` | controller, accountingManager, financeManager, generalManager |
| `reportAuthor` | `report.definition.create`, `.rename`, `.duplicate` | operationsManager, generalManager |
| — retained owner-only — | `report.definition.delete` | owner |

**Why a functional Role rather than adding 39 ids to ten business roles:** it keeps reporting
independently grantable and withdrawable, matches the architecture already used for inventory, and
avoids a Salesperson silently gaining payment terms because a manager's bundle was copied down.
`report.definition.delete` stays owner-only because destroying a shared definition is not reading.

**Requested:** approve the model (or amend the tiers). No grants until then.

### B — EQUIPMENT ADMINISTRATION (5 capabilities)

These are **two different questions wearing one prefix**, and Installed Base CRUD is excluded from
both, as instructed.

| Capability | Business action | Recommended owner |
|---|---|---|
| `equipment.compatibility.view` | See which parts fit which equipment model | Hold — see below |
| `equipment.compatibility.import` | Bulk-load a compatibility dataset | Hold |
| `equipment.compatibility.verify` | Confirm an imported mapping is correct | Hold |
| `equipment.compatibility.correct` | Amend a wrong mapping | Hold |
| `equipment.model.manage` | Administer the equipment **model catalog** | New `equipmentCatalogAdministrator` functional Role |

**The four compatibility ids: hold, do not assign.** The Equipment Compatibility program (D4) is
still a draft — its alias identity contract is decided but unbuilt. Assigning authority over an
unfinished engine authorizes nothing and creates a grant to unwind later.

**`equipment.model.manage`: a standalone functional Role, not a business title.**

- **Service Manager — no.** Working on equipment is not administering the model catalog. This is
  precisely the conflation that produced one of this program's three semantic mapping errors.
- **Shop Manager — no.** Same reasoning; Shop works on units, not the catalog.
- **Parts Manager — closest, but still no as a title.** The analogous authority for the part master
  is `inventory.catalog.manage`, which is held through the standalone
  `inventoryCatalogAdministrator` functional Role rather than by any manager title. Equipment model
  administration should mirror it exactly.

**Recommended:** create `equipmentCatalogAdministrator` holding `equipment.model.manage`, granted per
employee, typically to the same person who holds `inventoryCatalogAdministrator`. Symmetry with the
part master is the argument, and it keeps catalog administration separately withdrawable.

### C — COVERAGE / TERRITORY (2 capabilities)

`coverage.read`, `coverage.write`. **Recommendation: leave unassigned. Do not implement.**

Commercial Coverage & Territory Management is a recorded roadmap requirement whose seams are
deliberately preserved and whose build is not authorized. Assigning these now would model a design
that has not been decided.

**The future authority model, as architecture only.** Coverage needs a *scope* concept the platform
does not have. Four scopes, and the recommendation is that they be modelled as a scope dimension on
the capability rather than as four separate capabilities:

| Scope | Meaning | Roles that will need it |
|---|---|---|
| `own` | Records where I am the assigned coverage | salesperson |
| `team` | Everyone reporting to me | salesManager, fieldManager |
| `territory` | A defined geography/channel, **independent of who is assigned** | salesManager, operationsManager |
| `branch` / `company` | Everything | generalManager, owner |

**Four separations to preserve when this is built:** coverage ≠ credit ≠ commission ≠ security;
territory must be independent of salesperson (multi-assignment, not one resolver); channel is
configurable reference data; Service Territory is a separate concept from Sales Territory.

**Requested:** acknowledge the model as recorded architecture. No build, no grants.

### D — AUDIT LOG

`audit.event.read` — **already assigned**, and it is not owner/admin-only.

Current holders (12): `owner`, `admin`, `generalManager`, `operationsManager`, `controller`,
`accountingManager`, `fieldManager`, `salesManager`, `warehouseManager`, `partsManager`,
`shopManager`, `shopAssociate`.

| Role | Holds | Recommendation |
|---|:--:|---|
| Owner | yes | keep |
| General Manager | yes | keep |
| Operations Manager | yes | keep |
| Finance Manager | **no** | **grant** — see below |
| Accounting Manager | yes | keep |
| Controller | yes | keep |
| Service Manager | yes | keep |
| Sales Manager | yes | keep |

**One anomaly worth the Owner's attention: `shopAssociate` holds audit read and `financeManager` does
not.** An associate-level role reading audit history while a manager-level finance role cannot is
not a defensible ordering. Both follow correctly from their sources — `shopAssociate` from a
canonical matrix row, `financeManager` from having no matrix row at all — which is exactly how an
indefensible combination arises from two individually correct decisions.

**Recommended:** grant `audit.event.read` to `financeManager`; **re-examine** `shopAssociate`'s. Audit
read is oversight, not security administration, and oversight only the Owner can perform is not
oversight. Note this capability is also what distinguishes `salesManager` from `salesperson` — a
distinction worth confirming as intended.

---

## 7 — Sandbox activation plan (NOT EXECUTED)

Sandbox only. **Production state is unchanged for every row.** Grouped by workstream and ordered so
each group can be activated and proven independently — this is deliberately **not** a mass activation
of all 44 inactive capabilities.

Every row: current production state = **inactive, unchanged**. Rollback for every row is the same and
is why this is safe: **set `active:false` for the environment**, which restores `DENY /
inactivePermission` for every principal immediately, with no grant changes and no data migration.

### Group 1 — Parts Lookup *(unblocks the most workers; prerequisite for everything else)*

| Capability | Target Role | Sandbox | Grant needed | Positive test | Negative test | SoD |
|---|---|---|:--:|---|---|---|
| `inventory.balance.read` | `inventoryLookupReader` | activate | none (7 hold it) | Parts associate reads a stock balance | Technician without the Role is denied | — |
| `inventory.catalog.alias.read` | `inventoryLookupReader` | activate | none | Scan resolves an alias to a part | Alias lookup ≠ `catalog.manage`: holder cannot edit the catalog | Lookup stays separate from Manage |
| `inventory.location.display.read` | `inventoryLookupReader` | activate | none | Location displayed for a balance row | — | — |
| `inventory.serializedAsset.read` | `inventoryLookupReader` | activate | none | Serialized asset opens | — | — |

### Group 2 — Put-away and bins

| Capability | Target Role | Sandbox | Grant needed | Positive test | Negative test | SoD |
|---|---|---|:--:|---|---|---|
| `inventory.location.bin.read` | `inventoryPutAwayOperator` | activate | none (7 hold it) | Operator sees valid bins | — | — |
| `inventory.placement.record` | `inventoryPutAwayOperator` | activate | none | Operator records a placement | Operator **cannot** create or rename a bin | **bin-admin ≠ put-away** |
| `inventory.location.bin.manage` | `inventoryBinAdministrator` | activate | none (1 holds it) | Bin administrator defines a bin | Bin administrator **cannot** record a placement | **Exclusive pair — must stay disjoint** |

### Group 3 — Cycle count *(the SoD pair; activate both sides together or the separation is untested)*

| Capability | Target Role | Sandbox | Grant needed | Positive test | Negative test | SoD |
|---|---|---|:--:|---|---|---|
| `inventory.cycleCount.create` | `inventoryCycleCountCounter` | activate | none (4) | Counter opens a count | Counter cannot reconcile the variance they produced | **Exclusive** |
| `inventory.cycleCount.submit` | `inventoryCycleCountCounter` | activate | none | Counter submits blind (expected qty hidden) | Expected quantity not visible before submission (#111) | **Exclusive** |
| `inventory.cycleCount.reconcile` | `inventoryCycleCountReconciler` | activate | none (2) | Reconciler approves a variance | Reconciler **cannot** submit a count | **Exclusive** |

### Group 4 — Transfers and returns

| Capability | Target Role | Sandbox | Grant needed | Positive test | Negative test | SoD |
|---|---|---|:--:|---|---|---|
| `inventory.transfer.create` / `.dispatch` / `.receive` / `.cancel` | `inventoryTransferOperator` | activate | **+1 backup employee** | Operator dispatches and receives a transfer | Operator **cannot** receive purchased stock (`inventory.stock.receive` withheld) | Transfer ≠ Receiving |
| `inventory.returns.intake` | `inventoryReturnsIntakeClerk` | activate | **+1 backup employee** | Clerk takes a return into intake | Clerk has **no disposition authority** (does not exist — #118) | Intake ≠ disposition |

### Group 5 — CRM / Sales and Finance reads

| Capability | Target Role | Sandbox | Grant needed | Positive test | Negative test | SoD |
|---|---|---|:--:|---|---|---|
| `opportunity.read` | salesperson, salesManager | activate | none | Salesperson opens an opportunity | Warehouse associate is denied | — |
| `crm.activity.read` / `.create` | `crmActivityContributor` | activate | none (4) | Salesperson logs a customer touch | Non-contributor cannot log activity — the Owner ruling of 2026-08-19 holds | — |
| `finance.read` | controller, accountingManager, financeManager, purchasingManager | activate | none | Accounting Manager opens AR | Purchasing has **read only**, no finance write | Buyer ≠ payer |

**Deliberately NOT in this plan:** `inventory.stock.receive` (already active; the gap is assignment,
not activation), all 44 remaining inactive ids not listed above, and every `report.*`, `equipment.*`
and `coverage.*` id — those are blocked on decision packages §6A–C. Activation follows operating
need, not catalog completeness.

---

## 8 — Employee grant plan (NOT APPLIED)

**Eight of the nine functional Roles are already assigned in the roster.** For those, the plan is
*activation*, not granting — re-granting would change nothing. The genuine grant actions are few:

| # | Employee | Business role(s) | Functional role(s) to grant | Effect | Workstreams | Why needed | Expected denials | SoD |
|---|---|---|---|---|---|---|---|---|
| 1 | **new** cw-emp-043 | warehouseAssociate | `inventoryTransferOperator` | +4 transfer ids | Transfers | Transfers has one operator; an absence closes the workstream | cannot receive purchased stock; cannot reconcile counts | must not also hold `inventoryBinAdministrator` |
| 2 | **new** cw-emp-044 | warehouseAssociate | `inventoryReturnsIntakeClerk` | +1 intake id | Returns Intake | Returns shares its only worker with Transfers | no disposition authority (does not exist) | separate person from #1 |
| 3 | **new** cw-emp-045 | warehouseManager | `inventoryBinAdministrator` | +2 bin ids | Put-away (bin side) | One bin administrator; SoD forbids giving it to a put-away operator | cannot record placements | **must not** hold `inventoryPutAwayOperator` |
| 4 | **new** cw-emp-046 | purchasingManager | — | business role only | Procurement | One buyer, no backup | cannot approve/reject own requests; no `purchaseOrder.void` | raiser ≠ approver |
| 5 | cw-emp-030 (existing) | warehouseAssociate | — *(assignment only)* | none | **+ Receiving** | Receiving has 0 assigned workers while 32 can perform it via legacy authority | — | — |
| 6 | cw-emp-025 (existing) | partsAssociate | — *(assignment only)* | none | **+ Receiving** | Receiving backup | — | — |

**Rows 5 and 6 grant nothing** — they assign responsibility for work the employees can already
perform. That distinction is the point: Receiving's problem is accountability, not authority.

**Blocked on decisions:** `reportViewer` / `reportFinanceViewer` / `reportAuthor` grants (§6A) and
`equipmentCatalogAdministrator` (§6B). None are included here.

**No employee is granted a capability to make a coverage cell read ADEQUATE.** Six workstreams remain
GRANTED_BUT_INACTIVE after this plan is applied, because activation — not granting — is what they
need.

**Predicted SoD conflicts after applying this plan: 0.** Verified: rows 1–3 are three different
people, and none holds both sides of either exclusive pair.

---

## 9 — Positive / negative execution plan

Each workstream must prove an authorized worker succeeds **and** a nearby unauthorized worker is
denied. The negative half is the stronger evidence — "a parts associate can count" says little;
"can count **and cannot reconcile**" proves the control.

| Workstream | Positive | Negative |
|---|---|---|
| Parts Lookup | Parts associate resolves a scanned identifier to a part and reads its balance | Technician (no lookup Role) is denied; lookup holder cannot edit the catalog |
| Put-away | Put-away operator records a placement into a valid bin | Same operator **cannot create or rename a bin** |
| Bin administration | Bin administrator defines a new bin | Bin administrator **cannot record a placement** into it |
| Cycle Count | Counter opens and submits a blind count | Counter **cannot reconcile** the variance they produced; expected qty hidden until submission |
| Cycle Count Reconcile | Reconciler approves a material variance | Reconciler **cannot submit** a count |
| Transfers | Transfer operator dispatches and receives a transfer between locations | Transfer operator **cannot receive purchased stock** — receiving is withheld |
| Returns Intake | Intake clerk takes a return into intake | Clerk has **no disposition authority** (#118 — it does not exist) |
| Receiving | Assigned warehouse associate receives against a PO line | A technician cannot receive; a transfer operator cannot receive |
| CRM / Sales | Salesperson opens an opportunity and logs a customer activity | Warehouse associate denied both; non-contributor cannot log activity |
| Service / Dispatch | Dispatcher transitions a Work Order and reassigns with a recorded reason | Technician cannot cancel a Work Order |
| Procurement | Purchasing Manager starts purchasing and records a PO | Purchasing Manager **cannot approve/reject** their own request and **cannot void** a PO |
| Finance / AR | Accounting Manager reads AR and records an adjustment | Purchasing Manager has finance **read only** — no write |
| Administration | Owner assigns a role through the trusted audited path | **General Manager cannot grant any role** — Option 2, the load-bearing negative |
| Reporting | *(blocked on §6A)* Holder runs a customer report | Salesperson cannot read payment terms; nobody but owner deletes a definition |
| Audit | Controller reads audit history | Audit read confers **no** security administration |

---

## 10 — Legacy compatibility anomalies (recorded, not actioned)

Per instruction, `admin`, `dispatcher` and `technician` are **unchanged**. Recorded for the separate
future workstream:

1. **`dispatcher` (38 capabilities) grants the full `reorder.request.*` purchasing workflow** to all
   29 dispatcher-role employees, including `startPurchasing` and `recordPurchaseOrder` — authority the
   governed model confines to `purchasingManager`. This is why Procurement reads 43 granted-eligible
   against 2 governed-only.
2. **`technician` (14 capabilities) includes `reorder.request.*` ids**, so 11 technicians hold
   purchasing-workflow authority no technician job requires.
3. **`inventory.stock.receive` is active and held by 32 employees via legacy roles** while zero are
   assigned receiving responsibility — the largest standing over-privilege in the workforce.
4. **`admin` is derived from the whole catalog**, so every future capability is automatically granted
   to admin. Correct per the 2026-08-19 ruling, and the reason 46 capabilities read "owner/admin-only"
   without anyone deciding they are privileged.

**None of these is folded into the activation or grant plan.** They are the argument for R-1, not
work for this phase.
