# Role governance — execution plan

**Date:** 2026-08-21 · **Basis:** merged `27a6307b` (#1399) and `4586f928` (#1400), plus the Owner
decisions of 2026-08-21 implemented on this branch.

**Nothing here is executed.** No capability activated, no employee granted, no Rules changed, no
compatibility Role definition altered. This document is the execution *input*.

Generated data: `docs/governance/capacity-report.json`, `effective-authority.json`,
`precedence-sweep.json`, `role-capability-contract.json`.

---

## 1 — Reporting: final proposed model

Approved as tiered functional Roles. Grants stay **capability-driven, never job-title hardcoded** —
asserted by test: no business title may hold a `report.*` id.

| Role | Contents | Recommended holders |
|---|---|---|
| `reportViewer` | `report.definition.read` + the **26 active non-sensitive** object/field reads (Customer, Contact, Location, Equipment) | generalManager, operationsManager, salesManager, fieldManager, partsManager, warehouseManager, accountingManager, financeManager |
| `reportFinanceViewer` | the **5** commercial-terms Customer fields: `paymentTerms`, `taxStatus`, `commercialProfile`, `billingContact`, `billingAddress` | controller, accountingManager, financeManager, generalManager |
| `reportAuthor` | `report.definition.create`, `.rename`, `.duplicate` | operationsManager, generalManager |
| — Owner/Admin only — | `report.definition.delete` | owner |

**The recommended holder list is the MODEL; the grant plan grants fewer.** The table above names
the roles that should be able to hold each tier. The Certification World grant plan (§10) grants
reportViewer to seven employees only -- General Manager, Operations Manager, Accounting Manager and
Finance Manager -- because those are the ones assigned the Reporting workstream. Sales, Service,
Parts and Warehouse managers are eligible under the model and are not granted here, because
activation and grants are need-driven and no Certification World workflow exercises them yet.
Granting the full eligible set would be over-granting to make a model look complete.

**`reportFinanceViewer` is additive, not a superset.** A holder needs `reportViewer` as well to read
ordinary fields. Making it a superset would have collapsed "reporting access" into one decision when
the whole point of tiering is that it is two.

**The definition family splits three ways, not two:** `report.definition.read` is a **read** and sits
in `reportViewer` — opening a saved definition is not authoring one. Lumping it with
create/rename/duplicate would have forced every report reader to hold authoring rights.

### `REPORTING_SENSITIVITY_CAPABILITY_GAP` — recorded, not worked around

Three ids are excluded from every tier: `report.customer.field.notes.read`,
`report.customer.field.accountOwner.read`, `report.location.field.accessNotes.read`.

All three are `active:false` and all three are plausibly sensitive in ways **the catalog cannot
express** — there is no employee-sensitive or security-sensitive reporting dimension. Per the Owner's
instruction, no id was invented and access was not broadened to complete the model. The gap is
recorded against each capability in `effective-authority.json`.

**There are also no finance, sales-order, inventory or employee report capabilities in the catalog at
all.** The four report objects are Customer, Contact, Location and Equipment. The finance tier above
is finance-*sensitive customer fields*, not financial reporting, and should not be read as more.

---

## 2 — Equipment administration model

**`equipmentCatalogAdministrator`** — standalone functional Role, holding **`equipment.model.manage`
and nothing else**.

**Not composed into** Service Manager, Shop Manager, Shop Associate, Technician, Parts Associate, or
any Installed Base authority. Working *on* equipment is not administering the equipment **model
catalog** — the exact conflation that produced one of this program's three semantic mapping errors.
Installed Base (the customer's assets) remains a separate, Rules-governed object.

The Role mirrors `inventoryCatalogAdministrator` deliberately: the part master is administered by a
standalone Role rather than by a manager title, and the equipment model catalog is the same kind of
object.

### `EQUIPMENT_COMPATIBILITY_ENGINE_DRAFT` — the four compatibility ids stay Owner/Admin-only

`equipment.compatibility.view` / `.import` / `.verify` / `.correct` are **not** in the Role. The D4
engine is still a draft, and per the Owner's instruction draft authority is not activated merely
because a Role now exists that could hold it. They can be added by a later decision when there is
something to authorize.

---

## 3 — Coverage / Territory: deferral

`coverage.read` and `coverage.write` remain **unassigned, ungranted and inactive**.

`COVERAGE_TERRITORY_AUTHORITY_GAP` recorded. The architecture seam is preserved for a future
decision:

| Scope | Meaning | Roles that will need it |
|---|---|---|
| `own` | records where I am the assigned coverage | salesperson |
| `team` | everyone reporting to me | salesManager, fieldManager |
| `territory` | a geography/channel, **independent of who is assigned** | salesManager, operationsManager |
| `branch` / `company` | everything | generalManager, owner |

**Not compensated for with broad business-role reads** — that was the instruction, and it is the
correct one: widening ordinary reads to approximate territory would create authority that has to be
withdrawn when the real model lands.

Four separations to preserve when built: coverage ≠ credit ≠ commission ≠ security; territory
independent of salesperson (multi-assignment, not a single resolver); channel as configurable
reference data; Service Territory distinct from Sales Territory.

---

## 4 — Audit log: final role set

**Reconciled toward management oversight.** `audit.event.read` now has **11 holders**, all management:

`owner`, `generalManager`, `operationsManager`, `financeManager`, `accountingManager`, `controller`,
`fieldManager`, `salesManager`, `partsManager`, `warehouseManager`, `shopManager`.

| Change | Role | Reason |
|---|---|---|
| **Added** | `financeManager` | The anomaly that prompted the review: finance oversight could not read the audit trail. |
| **Added** | `operationsManager` | Cross-domain operational oversight; accountable for outcomes across Service, Inventory and Warehouse. |
| **Removed** | `shopAssociate` | Named by the Owner. Associates perform the work the audit trail records. |
| **Removed** | `partsAssociate` | **Not named individually by the Owner — but its category was.** See below. |

### Why `partsAssociate` was also removed

The Owner's ruling named Shop Associate and then stated the principle: *"Add regression guards
preventing audit-read drift onto ordinary associate roles without an explicit decision."*
`partsAssociate` held audit read on identical footing — the same canonical matrix rows, the same
associate level, no separate decision behind it.

The evidence that both were an artifact rather than an intent is in the matrix itself:
**`warehouseAssociate` has no audit row at all.** Parts and Shop associates read audit, warehouse
associates do not, and no business reason distinguishes them. That is what copying manager rows down
to associates looks like.

**Flagged explicitly because it extends a ruling by one row.** If the Owner intended Parts Associate
to keep audit read, that is a one-line reversal of `APPROVED_AUDIT_READERS`.

**Audit read confers no security administration** — asserted by test: no approved reader (except
`owner`, which composes admin) holds any `admin.*` id. The AUDIT workstream additionally *forbids*
`admin.roleAssignment.write`: an auditor who can grant themselves access is not an independent reader
of the record.

---

## 5 — Receiving workforce design

**The finding:** 0 assigned workers, 32 operable — every one of them through legacy authority.

**The design:** `inventoryReceivingClerk`, a standalone functional Role holding exactly
`inventory.stock.receive`, granted to **2** named employees.

**Why standalone rather than composed into `warehouseAssociate`:**

- Business intent does not say every warehouse or parts worker receives stock. Receiving is a
  **station** — someone accepts custody of goods into the company and is accountable for what was
  accepted.
- Composing it into an associate title would recreate at the governed level exactly the problem the
  coverage finding exposed: everyone able to receive, nobody responsible.
- It preserves a recorded deferral. `compatibilityRoles.ts` notes `PARTS_ASSOCIATE` is DEFERRED for
  `inventory.stock.receive` *"until a separately ratified scoped model or an explicit Owner
  acceptance of global Receiving authority."* Composing receiving into an associate Role would have
  resolved that deferral by the back door.

**Receiving ≠ Transfer.** `inventory.transfer.receive` moves custody between internal locations;
`inventory.stock.receive` accepts goods into the company from outside. The transfer operator does not
get it.

**Buyer ≠ receiver.** The new Procurement backup deliberately does **not** hold receiving. A buyer who
also accepts the goods they ordered closes the loop on their own purchase with nobody else in it —
the same separation the model already applies by withholding approve/reject from the Role that raises
orders, extended to the physical side.

| | Employee | Roles | Result |
|---|---|---|---|
| **Positive** | cw-emp-044 | warehouseAssociate + `inventoryReceivingClerk` | receives against a PO line |
| **Positive** | cw-emp-045 | warehouseManager + `inventoryReceivingClerk` | receives; redundancy |
| **Negative** | cw-emp-030..032 | warehouseAssociate, no clerk Role | denied |
| **Negative** | cw-emp-025..028 | partsAssociate, no clerk Role | denied |
| **Negative** | cw-emp-043 | transfer operator | denied — transfer is not receiving |
| **Negative** | cw-emp-046 | purchasingManager | denied — buyer is not receiver |

Governed-only operable: **2**. ADEQUATE without borrowing legacy authority.

---

## 6 — Four new employee fixtures

Deterministic synthetic identities, no real PII. Workforce **43 → 47**.

| Id | Business role | Functional roles | Workstreams | Closes |
|---|---|---|---|---|
| cw-emp-043 | warehouseAssociate | `inventoryLookupReader`, `inventoryTransferOperator` | Transfers, Parts Lookup | Transfers single-point-of-failure |
| cw-emp-044 | warehouseAssociate | `inventoryLookupReader`, `inventoryReturnsIntakeClerk`, `inventoryReceivingClerk` | Returns, Receiving | Returns SPOF + Receiving coverage |
| cw-emp-045 | warehouseManager | `inventoryBinAdministrator`, `inventoryReceivingClerk` | Put-away (bin side), Receiving | Bin-administration SPOF + Receiving redundancy |
| cw-emp-046 | purchasingManager | — | Procurement | Procurement SPOF |

**Reuse where it is clean, separation where a control requires it:**

- cw-emp-044 holds Returns **and** Receiving: both are intake stations at the same dock and no control
  separates accepting a customer return from accepting a purchase.
- cw-emp-045 is a **manager**, not an associate: the exclusive pair forbids the person defining where
  stock may live from also filling those locations, so this employee holds **no put-away**. Receiving
  is added here for the second receiver — the separation that matters survives, because they cannot
  *place* what they accept.
- cw-emp-043 holds **no** receiving, which is what keeps "a transfer operator cannot receive"
  provable.

---

## 7 — Employee-level authority guard evidence

**A correct Role definition is not proof of a correct employee.** Certification now produces two
results:

| Result | Question | Where |
|---|---|---|
| `ROLE_CONTRACT_RESULT` | is the Role definition correct? | `governedBusinessRoles.test.mjs`, `auditReadConfinement.test.mjs`, `generalManagerNoAdmin.test.mjs` |
| `EMPLOYEE_EFFECTIVE_AUTHORITY_RESULT` | is the **person's resolved** authority correct? | `employeeEffectiveAuthority.test.mjs` |

The union asserted for every employee: business Roles ∪ functional Roles ∪ compatibility Role.

| Guard | Asserts | Status |
|---|---|---|
| Decided denials survive the union | no `generalManager` employee resolves any `admin.*` through **any** combination | PASS |
| SoD survives the union | no employee holds both sides of an exclusive pair | PASS — 0 violations |
| SoD pairs are actually staffed | both sides staffed, by **different** people | PASS — counter 4 / reconciler 2, bin-admin 2 / put-away 8, disjoint |
| Receiving is never acquired sideways | no employee resolves `inventory.stock.receive` from governed Roles without `inventoryReceivingClerk` | PASS |
| Compatibility is not a back door | no legacy Role supplies a capability a decided denial removed | PASS |

**GM employee-level `admin.*`: 0.**

---

## 8 — Current vs governed-only capacity

**Governed-only is the primary readiness measure.** `owner` is excluded from it — it composes the
entire catalog by derivation, so counting it made the figure permanently ≥ 1 and silently rendered
`LEGACY_DEPENDENT` unreachable. One person who can do everything is not distributed capacity.

| Workstream | Assigned | Current operable | Governed-only | Available | Legacy dependency | Governed result |
|---|---:|---:|---:|---:|---|---|
| CRM / Sales | 7 | 0 | 0 | 0 | — | GRANTED_BUT_INACTIVE |
| Dispatch | 7 | 47 | 12 | 43 | union inflated by legacy | ADEQUATE |
| Service | 15 | 47 | 12 | 43 | union inflated by legacy | ADEQUATE |
| Parts Lookup | 10 | 0 | 0 | 0 | — | GRANTED_BUT_INACTIVE |
| Put-away | 8 | 0 | 0 | 0 | — | GRANTED_BUT_INACTIVE |
| Pick / Stage | 3 | 0 | 0 | 0 | — | GRANTED_BUT_INACTIVE |
| Transfers | 2 | 0 | 0 | 0 | — | GRANTED_BUT_INACTIVE |
| Cycle Count | 4 | 0 | 0 | 0 | — | GRANTED_BUT_INACTIVE |
| Cycle Count Reconcile | 2 | 0 | 0 | 0 | — | GRANTED_BUT_INACTIVE |
| Receiving | 2 | 36 | **2** | 34 | union inflated by legacy | ADEQUATE |
| Returns | 2 | 0 | 0 | 0 | — | GRANTED_BUT_INACTIVE |
| Procurement | 2 | 47 | **2** | 43 | union inflated by legacy | ADEQUATE |
| Finance / AR | 4 | 0 | 0 | 0 | — | GRANTED_BUT_INACTIVE |
| Administration | 5 | 1 | 0 | 1 | owner-only **by design** | THIN |
| Reporting | 6 | 8 | **7** | 8 | none | ADEQUATE |
| Audit | 7 | 15 | **14** | 15 | none | ADEQUATE |

- **≥2 governed-only operable:** 6 — Dispatch, Service, Receiving, Procurement, Reporting, Audit
- **exactly 1 governed-only:** 0
- **0 governed-only:** 10 — the nine inactive workstreams plus Administration
- **LEGACY_DEPENDENT: 0**

**Administration is THIN, not LEGACY_DEPENDENT, and the distinction is deliberate.** Owner-only
administration is Option 2 working exactly as decided: the authority *is* governed — it comes from
the `owner` Role — it is simply not distributed. `LEGACY_DEPENDENT` is reserved for work that can be
done *only* because a compatibility Role happens to carry the capability. Both classifications were
verified able to fire before the zero was reported.

**Authority attribution across 47 employees:** 985 of 1,475 operable holdings come from the legacy
compatibility Role alone (67%), 245 from a governed Role alone, 245 from both. **14 of 47 employees
would hold zero operable governed authority** if the compatibility Roles were removed today. Better
than the 80% measured at 43 employees, and still the dominant source.

### Governed-native classification (§11)

| Classification | Workstreams |
|---|---|
| `GOVERNED_NATIVE` | Reporting, Audit, Receiving, Procurement, Dispatch, Service |
| `GOVERNED_INACTIVE` | CRM/Sales, Parts Lookup, Put-away, Pick/Stage, Transfers, Cycle Count, Cycle Count Reconcile, Returns, Finance/AR |
| `LEGACY_DEPENDENT` | none |
| `LEGACY_ONLY` | none |

Every core workstream is either governed-native or governed-inactive. The nine inactive ones become
governed-native on sandbox activation with **no further grants** — the grants already exist.

---

## 9 — Exact sandbox activation manifest (NOT EXECUTED)

**15 capability ids, 5 groups.** Production state is `inactive, unchanged` for every row. Rollback for
every row is identical: **set `active:false` for the environment**, restoring
`DENY / inactivePermission` immediately with no grant change and no data migration.

**Excluded, deliberately:** all `coverage.*` (deferred), all `equipment.compatibility.*` (draft
engine), `equipment.model.manage` (Role exists, no Certification World workflow needs it yet),
`report.*` (already active), `inventory.stock.receive` (already active), and every other inactive id
no Certification World workflow requires. **Activation is need-driven, not catalog completeness.**

### Group 1 — Parts Lookup (prerequisite for Groups 2–4)

| Capability | Role | Employees | Workstream | Positive | Negative | SoD |
|---|---|---:|---|---|---|---|
| `inventory.balance.read` | `inventoryLookupReader` | 9 | Parts Lookup, Pick/Stage | associate reads a stock balance | technician without the Role denied | — |
| `inventory.catalog.alias.read` | `inventoryLookupReader` | 9 | Parts Lookup | scan resolves an alias to a part | holder **cannot** edit the catalog | lookup ≠ manage |
| `inventory.location.display.read` | `inventoryLookupReader` | 9 | Parts Lookup | location shown for a balance row | — | — |
| `inventory.serializedAsset.read` | `inventoryLookupReader` | 9 | Parts Lookup | serialized asset opens | — | — |

### Group 2 — Put-away and bins

| Capability | Role | Employees | Workstream | Positive | Negative | SoD |
|---|---|---:|---|---|---|---|
| `inventory.location.bin.read` | `inventoryPutAwayOperator` | 7 | Put-away | operator sees valid bins | — | — |
| `inventory.placement.record` | `inventoryPutAwayOperator` | 7 | Put-away | operator records a placement | **cannot** create or rename a bin | **exclusive pair** |
| `inventory.location.bin.manage` | `inventoryBinAdministrator` | 2 | Put-away (bin side) | administrator defines a bin | **cannot** record a placement | **exclusive pair** |

### Group 3 — Cycle count *(both sides together, or the separation is untested)*

| Capability | Role | Employees | Workstream | Positive | Negative | SoD |
|---|---|---:|---|---|---|---|
| `inventory.cycleCount.create` | `inventoryCycleCountCounter` | 4 | Cycle Count | counter opens a count | cannot reconcile their own variance | **exclusive** |
| `inventory.cycleCount.submit` | `inventoryCycleCountCounter` | 4 | Cycle Count | counter submits blind | expected qty hidden until submission (#111) | **exclusive** |
| `inventory.cycleCount.reconcile` | `inventoryCycleCountReconciler` | 2 | Cycle Count Reconcile | reconciler approves a variance | **cannot** submit a count | **exclusive** |

### Group 4 — Transfers and returns

| Capability | Role | Employees | Workstream | Positive | Negative | SoD |
|---|---|---:|---|---|---|---|
| `inventory.transfer.create` | `inventoryTransferOperator` | 2 | Transfers | operator opens a transfer | cannot receive purchased stock | transfer ≠ receiving |
| `inventory.transfer.dispatch` | `inventoryTransferOperator` | 2 | Transfers | operator dispatches | — | — |
| `inventory.transfer.receive` | `inventoryTransferOperator` | 2 | Transfers | operator receives the transfer | **not** `inventory.stock.receive` | transfer ≠ receiving |
| `inventory.returns.intake` | `inventoryReturnsIntakeClerk` | 2 | Returns | clerk takes a return into intake | **no disposition authority** (#118) | intake ≠ disposition |

### Group 5 — CRM / Sales and Finance

| Capability | Role | Employees | Workstream | Positive | Negative | SoD |
|---|---|---:|---|---|---|---|
| `opportunity.read` | salesperson, salesManager | 5 | CRM/Sales | salesperson opens an opportunity | warehouse associate denied | — |
| `crm.activity.read` / `.create` | `crmActivityContributor` | 4 | CRM/Sales | salesperson logs a customer touch | non-contributor denied — the 2026-08-19 ruling holds | — |
| `finance.read` | controller, accountingManager, financeManager, purchasingManager | 8 | Finance/AR | Accounting Manager opens AR | Purchasing has **read only** | buyer ≠ payer |

---

## 10 — Exact employee grant manifest (NOT APPLIED)

**Baseline business Role ≠ employee-specific functional Role.** Specialist functions are **not**
turned into business-role defaults: `inventoryReceivingClerk`, `inventoryTransferOperator`,
`inventoryBinAdministrator`, `inventoryCycleCountCounter`/`Reconciler`,
`inventoryReturnsIntakeClerk`, `equipmentCatalogAdministrator` and all three reporting tiers stay
per-employee grants.

Only `inventoryLookupReader`, `inventoryPutAwayOperator` and `crmActivityContributor` compose by
default, each on the standard that the work is normal for **every** employee in that role.

### New employees to create (4)

| Id | Business role | Functional roles | Compatibility role | Workstreams | Expected denials | SoD |
|---|---|---|---|---|---|---|
| cw-emp-043 | warehouseAssociate | `inventoryLookupReader`, `inventoryTransferOperator` | dispatcher | Transfers, Parts Lookup | `inventory.stock.receive`, `cycleCount.reconcile`, all `admin.*` | must not gain `inventoryBinAdministrator` |
| cw-emp-044 | warehouseAssociate | `inventoryLookupReader`, `inventoryReturnsIntakeClerk`, `inventoryReceivingClerk` | dispatcher | Returns, Receiving | disposition (does not exist), transfer ids, all `admin.*` | separate person from 043 |
| cw-emp-045 | warehouseManager | `inventoryBinAdministrator`, `inventoryReceivingClerk` | dispatcher | Put-away (bin), Receiving | `inventory.placement.record`, all `admin.*` | **must not** hold `inventoryPutAwayOperator` |
| cw-emp-046 | purchasingManager | — | dispatcher | Procurement | `reorder.request.approve`/`.reject`, `purchaseOrder.void`, `inventory.stock.receive` | raiser ≠ approver; buyer ≠ receiver |

### Existing employees gaining a functional Role (7)

| Id | Business role | Functional Role to grant | Why |
|---|---|---|---|
| cw-emp-001, -002 | generalManager | `reportViewer`, `reportAuthor` | Reporting assigned; previously UNDER_PRIVILEGED |
| cw-emp-003, -004 | operationsManager | `reportViewer`, `reportAuthor` | Reporting assigned; previously UNDER_PRIVILEGED |
| cw-emp-041 | financeManager | `reportViewer`, `reportFinanceViewer` | Reporting + finance-sensitive fields; previously UNDER_PRIVILEGED |
| cw-emp-039, -040 | accountingManager | `reportViewer`, `reportFinanceViewer` | Finance reporting and audit oversight |

### Role-definition changes (no employee grant)

| Change | Roles |
|---|---|
| `audit.event.read` **added** | operationsManager, financeManager |
| `audit.event.read` **removed** | shopAssociate, partsAssociate |

**Nobody is granted a capability to make a coverage cell read ADEQUATE.** Nine workstreams remain
GRANTED_BUT_INACTIVE after this plan, because activation — not granting — is what they need.

**Predicted SoD conflicts: 0**, verified across all 47 employees.

**Remaining UNDER_PRIVILEGED after this plan: 2** — cw-emp-005 and -006 (`officeManager`) assigned to
ADMINISTRATION, which requires `admin.roleAssignment.write`. This is a **workstream mislabel, not an
under-grant**: Administration as defined is security administration, and Office Manager is
office operations. Recommend renaming the workstream or splitting it; **do not** grant
`officeManager` role-assignment authority to close the gap.

---

## 11 — Positive / negative execution matrix

| Area | Positive | Negative |
|---|---|---|
| **Sales** | salesperson opens an opportunity and logs a customer activity | cannot read inventory balances or finance; cannot perform fulfillment |
| **Dispatch** | dispatcher transitions a Work Order and reassigns with a recorded reason | does **not** inherit commercial authority from the governed model — no `opportunity.write`, no `salesOrder.write` |
| **Technician** | completes assigned Work Order workflow | cannot transfer, receive, read finance, or touch any `admin.*` |
| **Parts Associate** | lookup, put-away, submit a blind count | **cannot reconcile** — SoD, not an oversight |
| **Parts Manager** | catalog and parts duties, reads audit history | cannot receive, purchase or transfer without the specific functional Role |
| **Warehouse** | transfer, put-away, pick, returns as assigned | **cannot receive** without `inventoryReceivingClerk` |
| **Receiving** | cw-emp-044 / -045 receive against a PO line | cw-emp-030..032 and cw-emp-025..028 denied; cw-emp-043 (transfer) denied; cw-emp-046 (buyer) denied |
| **Finance** | accountingManager reads AR, records an adjustment, reads audit | **cannot** administer Roles — no `admin.*` |
| **General Manager** | broad business access; reads audit; authors reports | **role assignment and every `admin.*` DENIED** — the load-bearing negative for Option 2 |
| **Audit** | 11 management readers read audit history | **shopAssociate and partsAssociate denied**; no reader gains `admin.*` |
| **Reporting** | `reportViewer` reads ordinary fields; `reportFinanceViewer` reads payment terms | `reportViewer` **denied** payment terms; unassigned employee denied everything; nobody but owner deletes a definition |

---

### The contract is executable, not narrative

The table above is encoded as `functions/test/executionContractProofs.test.mjs` — **25 assertions:
11 negative, 11 positive, 3 structural.** A contract stated only in prose is a claim; the same
contract as assertions is a claim that fails when it stops being true.

Every proof is computed on **governed authority only**, ignoring the legacy compatibility Role. That
is deliberate: 67% of this workforce's operable authority comes from compatibility Roles R-1 exists
to retire, so a proof computed on the union would mostly be proving the legacy model works.

The positives exist because without them the negatives are satisfiable by granting nobody anything —
the cheapest way to pass a security test and the least useful.

**Currently verified, on governed authority:**

| Proof | Result |
|---|---|
| transfer operator cannot receive | denied |
| buyer cannot receive; buyer cannot approve own request; cannot void | denied |
| bin administrator cannot record a placement | denied |
| counter cannot reconcile; reconciler cannot count | denied |
| General Manager cannot assign roles | denied |
| finance management cannot administer security | denied |
| warehouse/parts associate without the clerk Role cannot receive | denied |
| designated receiving clerks can receive | holds |
| reportViewer reads ordinary fields, refused payment terms | holds / denied |
| unassigned technician resolves no reporting at all | denied |

Mutation-proven. The first attempt proved nothing — giving the buyer receiving authority *passed*,
because the roster has two `purchasingManager` rows and the mutation replaced the first one, the
original employee rather than the added backup. Re-run against the correct target it fails, as does
giving the bin administrator put-away.

---

## 12 — Remaining legacy dependencies

Compatibility Role definitions are **unchanged**, per instruction. Recorded for the separate future
workstream:

1. **`dispatcher` (38 capabilities)** grants the full `reorder.request.*` purchasing workflow to all
   dispatcher-role employees. Procurement reads 47 operable against 2 governed-only.
2. **`technician` (14 capabilities)** includes `reorder.request.*` ids no technician job requires.
3. **`inventory.stock.receive` is active and held by 36 employees via legacy roles** while 2 are
   named receiving clerks. Reduced from "nobody accountable" to "two accountable, many able" — the
   accountability half is fixed, the over-privilege half is R-1's.
4. **`admin` is derived from the whole catalog**, so every future capability is automatically granted
   to admin. Correct per the 2026-08-19 ruling, and why capabilities read "owner/admin-only" without
   anyone deciding they are privileged.

**None is folded into this activation or grant plan.**
