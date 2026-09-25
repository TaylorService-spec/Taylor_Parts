# The Owner capability contract

Lane BN, 2026-09-24. Owner ruling A: **narrow the compiled Owner Role; do not widen live Owner to match Admin.**

> Owner = business / enterprise oversight authority. Admin = access / security / platform administration authority.

Source of truth for the declaration is `functions/src/access/governedBusinessRoles.ts`; this table is the reasoning behind it and is pinned by `functions/test/ownerCapabilityContract.test.mjs`.

`Object` and `action` are the canonical `eos_policy.capabilities` columns where the id is in the governed vocabulary; ids outside it are Firebase-era `PERMISSION_CATALOG` entries with no canonical Object and are marked `(ungoverned)`.

`ADMIN_ONLY` means: granted to `admin` and NOT to `owner` in live nonprod `eos_policy` as measured 2026-09-24.

Four ids (`customer.record.read`, `opportunity.read`, `salesAgreement.read`, `salesOrder.read`) appear in two authority groups because they genuinely belong to both -- enterprise visibility and the Owner's own commercial work. The source lists them twice and de-duplicates; nothing is granted twice.

## 1. Enterprise visibility

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `admin.principalAccess.read` | principal | read | Oversight must see who can do what. Settled by migration 1762041600000 as an authority of exactly {admin, owner}: administration READS do not separate the two. | **yes** | no |
| `audit.event.read` | auditLog | read | Accountability without the audit trail is a claim, not a control. Oversight IS audit read. | **yes** | no |
| `customer.record.read` | account | read | The Owner's own book of business. | **yes** | no |
| `employee.record.read` | employee | read | The Owner is the employer of record. | **yes** | no |
| `equipment.compatibility.view` | equipmentModel | read | Read of the installed-base reference data the service business runs on. | **yes** | no |
| `fulfillment.coordinatedVisit.read` | salesOrder | readCoordinatedVisits | Reads coordinated-visit state on the Sales Order -- the commercial commitment Owner is accountable for. | **yes** | no |
| `inventory.action.read` | inventoryAction | read | Stock adjustments are a shrink/control signal. Read, not create. | **yes** | no |
| `inventory.analytics.read` | inventoryAnalytics (ungoverned) | read | Inventory performance is a capital-efficiency question. | **yes** | no |
| `inventory.balance.read` | inventoryBalance (ungoverned) | read | Stock value. | **yes** | no |
| `inventory.catalog.read` | part | read | What the business sells. | **yes** | no |
| `inventory.location.bin.read` | bin (ungoverned) | read | Read of warehouse layout; MANAGE is excluded. | **yes** | no |
| `inventory.location.display.read` | stockLocation (ungoverned) | read | Read-only location display. | **yes** | no |
| `inventory.serializedAsset.read` | serializedAssets | read | Serialized assets are capital on the balance sheet. | **yes** | no |
| `inventory.transaction.read` | inventoryTransaction | read | Where the stock actually is and how it moved. | **yes** | no |
| `opportunity.read` | opportunity | read | The pipeline. | **yes** | no |
| `reorder.purchaseOrder.read` | purchaseOrder | read | What the business has committed to buy. | **yes** | no |
| `reorder.request.read.own` | reorderRequest (ungoverned) | readOwn | Scoped read, subsumed by the enterprise read. | **yes** | no |
| `salesAgreement.read` | salesAgreement | read | What the business has committed to deliver. | **yes** | no |
| `salesOrder.read` | salesOrder | read | Order book. | **yes** | no |
| `service.inboundWork.read` | inboundWork (ungoverned) | read | Seeing what work is arriving; triage verbs are excluded. | **yes** | no |
| `warehouse.record.read` | warehouse | read | The warehouse register. | **yes** | no |
| `warehouse.stockLocation.read` | stockLocation (ungoverned) | read | Confined to Operations Manager and Owner by its own pinned check. | **yes** | no |
| `warehouse.transferOrder.read` | transferOrder | read | Inter-warehouse movement visibility; canonical CRUD row grants it to Owner. | **yes** | no |

## 2. People and access accountability

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `admin.accessRequest.decide` | rolesPermissions | decideAccessRequest | Privileged Roles need a SECOND distinct approver (Spec 15). A decider population of one cannot satisfy that; Owner is the accountable second. | **yes** | no |
| `admin.credentialReset.initiate` | employee | resetCredential | Business continuity when the administrator is unavailable. Resets a credential, never reveals one. | **yes** | no |
| `admin.employeeJobRole.write` | employee | assignJobRole | Job Role is a BUSINESS fact (tenant position catalog, EMP-RT-08), not a security fact. Who holds which position is the Owner's call. | **yes** | no |
| `admin.employeeOperationalScope.write` | employee | setOperationalScope | Operational Scope is organisational design: which warehouses and queues a person covers. | **yes** | no |
| `admin.employeeProfile.write` | employee | edit | Employee record stewardship is HR, not platform. | **yes** | no |
| `admin.employeeWorkEligibility.write` | employee | setWorkEligibility | Work Eligibility is a competency attestation about a person -- an employment judgement (2026-09-17 Workforce split). | **yes** | no |
| `admin.roleAssignment.write` | rolesPermissions | assignRole | The one genuine access-administration WRITE Owner keeps, and argued rather than assumed: two-person approval needs two populations, and an Owner who cannot assign a Security Role can be locked out of their own business by their own administrator. | **yes** | no |
| `admin.userStatus.write` | employee | setStatus | Enabling/disabling an account follows an EMPLOYMENT decision; PG employment status governs access. The Owner terminates, the administrator executes. | **yes** | no |

## 3. Commercial authority

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `coverage.read` | salesTerritory (ungoverned) | read | Commercial coverage is enterprise structure. | **yes** | no |
| `coverage.write` | salesTerritory (ungoverned) | write | The shape of the commercial organisation is an ownership decision -- the same ruling that made Marketing a peer of Sales rather than a report. | **yes** | no |
| `crm.activity.create` | account (ungoverned) | createActivity | Account-relationship notes. Owner ruling 2026-08-19 put CRM activity on admin; with the spread gone it must be stated on Owner or it disappears. | **yes** | no |
| `crm.activity.read` | account (ungoverned) | readActivity | Same ruling; reading what was said to a customer is oversight. | **yes** | no |
| `customer.record.create` | account | create | Owner opens accounts; the relationship is theirs. | **yes** | no |
| `customer.record.read` | account | read | The Owner's own book of business. | **yes** | no |
| `customer.record.update` | account | edit | Maintaining the account record Owner owns. | **yes** | no |
| `opportunity.read` | opportunity | read | The pipeline. | **yes** | no |
| `opportunity.write` | opportunity | edit | Owner runs the pipeline. | **yes** | no |
| `salesAgreement.create` | salesAgreement | create | Owner originates commercial agreements. | **yes** | no |
| `salesAgreement.read` | salesAgreement | read | What the business has committed to deliver. | **yes** | no |
| `salesAgreement.updateDraft` | salesAgreement | edit | Drafting only -- acceptance is withheld, see the exclusions. | **yes** | no |
| `salesOrder.fulfill` | salesOrder (ungoverned) | fulfill | A Phase 6a spine id the 2026-08-14 spec assigned to owner/admin. Not in the governed vocabulary, so nothing measured speaks to it; a first-principles reading would call it fulfilment execution and drop it, but this lane does not overturn a recorded decision on inference. | **yes** | no |
| `salesOrder.read` | salesOrder | read | Order book. | **yes** | no |
| `salesOrder.service` | salesOrder (ungoverned) | service | Same Phase 6a spec block, same reasoning. | **yes** | no |
| `salesOrder.write` | salesOrder | edit | Owner can raise and amend the order directly; this is why withholding opportunity.createSalesOrder costs nothing real. | **yes** | no |
| `workOrder.create` | workOrder | create | Taking the job is a commercial act. | **yes** | no |
| `workOrder.transition` | workOrder | transition | Advancing the job Owner took. Live-granted (CANONICAL_CATALOG). Sits uneasily beside the lifecycle exclusions and is flagged, not silently adopted. | **yes** | no |

## 4. Financial authority

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `finance.adjustment.record` | invoice | recordAdjustment | A credit against a customer invoice is a commercial concession. | **yes** | no |
| `finance.invoice.issue` | invoice | issue | Issuing the invoice is the revenue act. | **yes** | no |
| `finance.payment.apply` | payment | apply | Cash application is a control point -- misapplied cash hides AR problems. | **yes** | no |
| `finance.read` | finance (ungoverned, superseded) | read | Legacy finance umbrella, superseded by finance.invoice.read + finance.payment.read. Retained because other Roles still declare it and Owner's finance visibility must not depend on which id a caller uses. | **yes** | no |
| `finance.refund.record` | payment | recordRefund | Money out of the business. | **yes** | no |
| `finance.visibility.businessUnit` | financialVisibility (ungoverned) | tier:businessUnit | As above. | **yes** | no |
| `finance.visibility.company` | financialVisibility (ungoverned) | tier:company | As above. | **yes** | no |
| `finance.visibility.consolidated` | financialVisibility (ungoverned) | tier:consolidated | Enterprise-wide consolidated financial visibility is the defining Owner read. | **yes** | no |
| `finance.visibility.self` | financialVisibility (ungoverned) | tier:self | Visibility tiers are cumulative scopes; Owner holds all five because consolidated subsumes them and a partial set produces holes. | **yes** | no |
| `finance.visibility.team` | financialVisibility (ungoverned) | tier:team | As above. | **yes** | no |
| `financialPolicy.profile.configure` | financialPolicyProfile (ungoverned) | configure | Pinned to exactly {admin, owner} by financialPolicyAuthorityActivation.test.mjs: supplying or approving an accounting policy confers no authority to configure it. | **yes** | no |
| `financialPolicy.profile.read` | financialPolicyProfile (ungoverned) | read | Reads the policy governing the Owner's numbers. | **yes** | no |

## 5. Procurement and stock-commitment authority

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `inventory.catalog.manage` | part | edit | Owner ruling 2026-08-19 put catalog WRITE on the management Roles including Owner, with duplicate detection as the mitigation. Live agrees (migration 1761609600000). | **yes** | no |
| `inventory.transfer.create` | transferOrder | create | Deciding stock should move is planning. Executing the move is not Owner's. | **yes** | no |
| `reorder.purchaseOrder.create` | purchaseOrder | create | Committing the business's money. | **yes** | no |
| `reorder.purchaseOrder.void` | purchaseOrder (ungoverned) | void | Carries an isOwnAssignment Condition, inherited from admin's condition map. Owner raises POs, so Owner may void its own. | **yes** | no |
| `reorder.request.approve` | reorderRequest (ungoverned) | approve | Spend authorisation. See the recorded SoD note: Owner holds raise AND approve because there is nobody above the Owner to escalate to. | **yes** | no |
| `reorder.request.cancel` | reorderRequest (ungoverned) | cancel | Standing down a purchase is a business decision. | **yes** | no |
| `reorder.request.create.manual` | reorderRequest | createManual | Owner may raise a replenishment need. | **yes** | no |
| `reorder.request.create.system` | reorderRequest | createSystem | The AUTOMATIC replenishment raiser. Questionable on ANY human Role; retained because live grants it and this lane may not narrow below live. | **yes** | no |
| `reorder.request.reject` | reorderRequest (ungoverned) | reject | Same authorisation decision, negative. | **yes** | no |

## 6. Enterprise performance authority

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `performance.goal.approve` | performanceGoal (ungoverned) | approve | As above -- approving the targets the business is measured against. | **yes** | no |
| `performance.goal.create` | performanceGoal (ungoverned) | create | The Owner's goal policy names Owner. Re-declared explicitly because removing the admin spread would otherwise delete the Owner's own goal authority. | **yes** | no |
| `performance.goal.read` | performanceGoal (ungoverned) | read | As above. | **yes** | no |
| `performance.goal.retire` | performanceGoal (ungoverned) | retire | As above. | **yes** | no |
| `performance.goal.supersede` | performanceGoal (ungoverned) | supersede | As above. | **yes** | no |

## 7. Reporting (Issue #325 / ADR-007 W1 + W-SAVE)

Owner holds **every registered `report.*` id (39)** and is the only Role that holds any. Enumerated as families because the rationale is identical within each: enterprise reporting is the Owner's read of the business, and the W-SAVE ruling states that only the approved W-SAVE role (Owner) holds the five saved-definition ids.

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `report.contact.*` (6 ids) | reporting (ungoverned) | read | Enterprise reporting read over the contact object and its fields. Registered `active:false`; activation is per-environment (36 of 39 in eos-platform-sandbox), which is why catalog membership must not be filtered on activation state. | **yes** | no |
| `report.customer.*` (14 ids) | reporting (ungoverned) | read | Enterprise reporting read over the customer object and its fields. Registered `active:false`; activation is per-environment (36 of 39 in eos-platform-sandbox), which is why catalog membership must not be filtered on activation state. | **yes** | no |
| `report.definition.*` (5 ids) | reporting (ungoverned) | read | Saved-definition CRUD, enforced exclusively through savedDefinitionCommands.ts; firestore.rules denies all direct client access to reportDefinitions. `delete` is Owner-only by ruling; create/rename/duplicate are delegable to reportAuthor. | **yes** | no |
| `report.equipment.*` (9 ids) | reporting (ungoverned) | read | Enterprise reporting read over the equipment object and its fields. Registered `active:false`; activation is per-environment (36 of 39 in eos-platform-sandbox), which is why catalog membership must not be filtered on activation state. | **yes** | no |
| `report.location.*` (5 ids) | reporting (ungoverned) | read | Enterprise reporting read over the location object and its fields. Registered `active:false`; activation is per-environment (36 of 39 in eos-platform-sandbox), which is why catalog membership must not be filtered on activation state. | **yes** | no |

## 8. Excluded -- the 19 admin-only capabilities

Every one is in the governed vocabulary and every one is granted to `admin` and withheld from `owner` in live nonprod. Seventeen were declared on the compiled Owner by the `ADMIN_ROLE` spread; the two `workOrder.lifecycle.*` ids have no `PERMISSION_CATALOG` entry and so were never declarable, and are listed so the ruling that excluded `owner` survives their future registration. Exported as `OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES`.

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `admin.dataImport.execute` | dataImport | execute | Platform administration. Bulk-loading records through the import pipeline is migration TOOLING (nonprod-only, Catalog Lane 2 ruling), not a business act. | **no** | yes |
| `customer.governedField.write` | account | editGovernedField | Credit control. Payment terms / tax status / commercial profile belong to accountingManager and financeManager; the party accountable for revenue must not unilaterally relax a customer's credit terms. | **no** | yes |
| `equipment.install` | equipment | install | Field execution -- the installer's act, at a customer site. | **no** | yes |
| `equipment.model.manage` | equipmentModel | edit | Reference-data administration of the equipment model catalog. | **no** | yes |
| `inventory.catalog.activate` | part | activate | Part LIFECYCLE administration. Owner may edit a Part; changing its lifecycle status stays with the durable catalog administrator (the ACTIVATE half of the 2026-08-19 ruling was explicitly not reversed). | **no** | yes |
| `inventory.cycleCount.cancel` | cycleCount | cancel | Warehouse execution. | **no** | yes |
| `inventory.cycleCount.create` | cycleCount | create | Warehouse execution. | **no** | yes |
| `inventory.cycleCount.reconcile` | cycleCount | reconcile | Warehouse execution, and submit+reconcile in one Role is already a recorded internal-control problem; Owner does not join it. | **no** | yes |
| `inventory.cycleCount.submit` | cycleCount | submit | Warehouse execution. | **no** | yes |
| `inventory.placement.record` | inventoryTransaction | recordPlacement | Physical put-away. | **no** | yes |
| `inventory.stock.receive` | receivingOrder | receive | Physical receiving. | **no** | yes |
| `inventory.stock.relocate` | inventoryTransaction | relocate | Physical stock movement. | **no** | yes |
| `inventory.transfer.cancel` | transferOrder | cancel | Execution, as above. | **no** | yes |
| `inventory.transfer.dispatch` | transferOrder | dispatch | Executing a transfer Owner may itself have raised. Raise is not dispatch. | **no** | yes |
| `inventory.transfer.receive` | transferOrder | receive | Execution, as above. | **no** | yes |
| `opportunity.createSalesOrder` | opportunity | createSalesOrder | Maker/checker. Owner can edit an Opportunity's stage and value, so Owner must not also be the actor who converts it into a committed Sales Order. Owner can still raise an order directly (salesOrder.write). | **no** | yes |
| `salesAgreement.accept` | salesAgreement | accept | Maker/checker on a binding document. Owner drafts the Agreement; the actor recording the counterparty's acceptance must not be its author. | **no** | yes |
| `workOrder.lifecycle.cancel` | workOrder | cancel | Excluded from Owner EXPLICITLY by the five-row Work Order lifecycle activation ruling. Not in PERMISSION_CATALOG, so never declarable -- listed so the exclusion survives any future registration. | **no** | yes |
| `workOrder.lifecycle.dispatch` | workOrder | dispatch | Same ruling, same explicit exclusion of owner. | **no** | yes |

## 9. Excluded -- in the vocabulary, but not an admin-only authority either

Exported as `OWNER_EXCLUDED_NOT_AN_AUTHORITY`. Kept separate so section 8 stays exactly the admin-only set the Sample Company manifest can assert as Owner `forbiddenCapabilities`.

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `reorder.request.assign` | reorderRequest | assign | Assigning a reorder request to a buyer is work COORDINATION, not oversight. (Not admin-only in live -- admin does not hold it either.) | **no** | no |
| `reorder.request.read.queue` | reorderRequest | readQueue | SUPERSEDED. Retained in eos_policy only as migration evidence after the 2026-09-17 ruling moved whole-queue visibility into Operational Scope; the manifest's own words are that it may never be granted again. | **no** | no |

## 10. Excluded -- outside the governed vocabulary

Firebase-era `PERMISSION_CATALOG` ids the old spread handed Owner. None can ever be granted in `eos_policy`, so none affects the reconcile proof; they matter because the Firebase-era resolver still reads them.

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `admin.dataImport.stage` | (not in governed vocabulary) | -- | Platform administration, pairs with dataImport.execute. | **no** | no |
| `administration.emailIntake.manage` | (not in governed vocabulary) | -- | Platform administration. | **no** | no |
| `administration.emailIntake.read` | (not in governed vocabulary) | -- | Platform administration -- mailbox intake plumbing. | **no** | no |
| `equipment.compatibility.correct` | (not in governed vocabulary) | -- | Reference-data curation. | **no** | no |
| `equipment.compatibility.import` | (not in governed vocabulary) | -- | Reference-data curation / bulk tooling. | **no** | no |
| `equipment.compatibility.verify` | (not in governed vocabulary) | -- | Reference-data curation. | **no** | no |
| `inventory.action.create` | (not in governed vocabulary) | -- | Raising a stock correction is floor work; Owner reads adjustments instead. | **no** | no |
| `inventory.catalog.alias.read` | (not in governed vocabulary) | -- | Resolving a Part alias belongs to the inventoryLookupReader FUNCTIONAL Role; the recorded decision in scannerReleaseReadiness.test.mjs is that "reusing it by position is the mistake that capability was created to avoid". Owner is a position. | **no** | no |
| `inventory.location.bin.manage` | (not in governed vocabulary) | -- | Warehouse layout administration. | **no** | no |
| `inventory.returns.intake` | (not in governed vocabulary) | -- | Physical intake. | **no** | no |
| `inventory.serializedAsset.acquire` | (not in governed vocabulary) | -- | Physical acquisition into inventory. | **no** | no |
| `reorder.request.markReceived` | (not in governed vocabulary) | -- | Receiving execution; consistent with excluding inventory.stock.receive. | **no** | no |
| `reorder.request.postPurchasingUpdate` | (not in governed vocabulary) | -- | The buyer's workflow. | **no** | no |
| `reorder.request.recordPurchaseOrder` | (not in governed vocabulary) | -- | The buyer's workflow. | **no** | no |
| `reorder.request.startPurchasing` | (not in governed vocabulary) | -- | The buyer's workflow (Purchasing Manager's sequence). | **no** | no |
| `service.inboundWork.accept` | (not in governed vocabulary) | -- | Intake triage -- coordination, not oversight. | **no** | no |
| `service.inboundWork.attachExisting` | (not in governed vocabulary) | -- | Intake triage. | **no** | no |
| `service.inboundWork.decline` | (not in governed vocabulary) | -- | Intake triage. | **no** | no |
| `workOrder.cancel` | (not in governed vocabulary) | -- | LEGACY id for what workOrder.lifecycle.cancel now names -- the canonical vocabulary omits it as a duplicate. The five-row activation ruling excluded owner from lifecycle.cancel, so leaving the legacy id on Owner would grant through the Firebase-era resolver exactly the authority the governed ruling withholds. | **no** | no |
| `workOrder.labor.correct` | (not in governed vocabulary) | -- | Technician labour correction. | **no** | no |
| `workOrder.labor.record` | (not in governed vocabulary) | -- | Technician labour entry. | **no** | no |
| `workOrder.parts.plan` | (not in governed vocabulary) | -- | The parts planner's act. | **no** | no |

## 11. Six live Owner grants this catalog cannot declare

A catalog gap, not a decision. These exist in the `eos_policy` vocabulary and are already granted to `owner` in live nonprod, but have **no `PERMISSION_CATALOG` id**. Declaring one would be registering a capability, which this lane is forbidden to do.

| capability | Object | action | business rationale | OWNER_REQUIRED | ADMIN_ONLY |
|---|---|---|---|---|---|
| `admin.securityPolicy.read` | rolesPermissions | read | Same settled {admin, owner} authority. NOT declarable here -- no PERMISSION_CATALOG id exists; Owner already holds it in live nonprod. | **yes** | no |
| `finance.invoice.read` | invoice | read | AR visibility. NOT declarable here -- no PERMISSION_CATALOG id; Owner already holds it live. | **yes** | no |
| `finance.payment.read` | payment | read | Cash visibility. NOT declarable here -- no PERMISSION_CATALOG id; Owner already holds it live. | **yes** | no |
| `inventory.manufacturer.read` | manufacturer | read | Supplier/manufacturer reference read. NOT declarable here -- no PERMISSION_CATALOG id; Owner already holds it live. | **yes** | no |
| `reorder.request.read` | reorderRequest | read | Replenishment visibility. NOT declarable here -- no PERMISSION_CATALOG id; Owner already holds it live. | **yes** | no |
| `workflowDefinition.read` | workflowDefinition | read | Reads the governed workflow definitions. NOT declarable here -- no PERMISSION_CATALOG id; Owner already holds it live (migration 1762128000000). | **yes** | no |

## Counts

| | owner | admin |
|---|---|---|
| compiled declarations BEFORE | 151 | 151 |
| compiled in-vocabulary BEFORE | 60 | 60 |
| compiled declarations AFTER | 110 | 151 |
| compiled in-vocabulary AFTER | 41 | 60 |
| live nonprod grants | 47 | 66 |

## Reconcile proof

The seed writes `eos_policy.role_capabilities` from this catalog, and can only write ids the vocabulary knows. Owner's in-vocabulary declaration is now a **strict subset of the live Owner grant set** (41 of 47, the missing 6 being the undeclarable ids of section 11), and its intersection with the 19 admin-only capabilities is **empty**. A seed apply against live nonprod with `owner` named on a Principal would therefore write **zero** new `role_capabilities` rows, so removing `withheldFromReconciliation: ["owner"]` cannot widen the live Owner Role at all, let alone by an admin-only capability. Machine-checked by `functions/test/ownerCapabilityContract.test.mjs` against `roleCapabilityAuthorityBaseline.json` (measured nonprod, 2026-09-24).

The withholding is **not removed by this lane**. The proof is the deliverable; removing the guard is the activation lane's decision.

## Recorded tensions -- flagged, not silently adopted

1. `reorder.request.create.manual` + `reorder.request.approve` on one Role is the very segregation `PURCHASING_MANAGER_ROLE` is denied. Defensible only because the Owner is the terminal approver.
2. `reorder.request.create.system` names the automatic replenishment raiser; a human Role holding a system-actor verb is questionable for any Role.
3. `workOrder.transition` sits uneasily beside the deliberate exclusion of `workOrder.lifecycle.dispatch` / `.cancel`.
4. `inventory.catalog.manage` on Owner is in tension with `INVENTORY_CREATE_EXECUTOR_ROLE` existing purely to make that id temporarily grantable.

All four are places where **live nonprod is more generous than a first-principles reading of the ruling**. This lane does not narrow below live: doing so would put the compiled catalog UNDER live, which needs a revoking migration -- and this lane may write none. They are recorded here for a deliberate later ruling.
