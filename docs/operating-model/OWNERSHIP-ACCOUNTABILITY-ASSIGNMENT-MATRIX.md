---
artifact_type: operating-model-canonical
lane: EMP-OWN-SYNTHESIZER
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
date: 2026-09-13
implementation_status: NOT AUTHORIZED
---

# OWNERSHIP · ACCOUNTABILITY · ASSIGNMENT MATRIX

**OBSERVED AT: 64008d5a.** Integrated from **OWN-DESIGN** §4 (the five-panel family matrix — primary),
**EMP-ACCOUNTABILITY** §2 and §8–§9, **OWN-E2E** §8, **EMP-EXPERIENCE** §2. Conflicts are in
[`EMPLOYEE-OPERATING-MODEL.md`](EMPLOYEE-OPERATING-MODEL.md) §5.

**NO FIELD, COLLECTION OR SCHEMA IS PROPOSED ANYWHERE IN THIS DOCUMENT. No generic `ownerId` is
invented. The nine concepts stay separate throughout.**

---

## 0. Reading this matrix — four rules that bind every row

**R1. A deliberate `NONE` / `REFERENCE` / `COMPANY` answer is a VALID OUTCOME, not a gap.** §6
enumerates them. OWN-DESIGN's instruction is binding: *"The synthesizer must not read any row in this
section as a gap."*

**R2. A non-empty `ownerFields` is NOT evidence of populated ownership.** Three tiers recur and the
matrix expresses none of them (OWN-DESIGN §3.1, OD-OWN-015):

| Tier | Meaning | Families |
|---|---|---|
| **LIVE** | a deployed writer sets it on every new record | `opportunities`, `sales_agreements`, `sales_orders` (`operatingCompanyId`); `reorder_requests`, `reorder_purchase_orders`; `cycle_counts`; `invoices`, `payments`, `refunds`, `invoice_adjustments` (**`companyId`**); `inbound_work_requests`; `accounts` (`accountOwner`); `reportDefinitions` (`ownerUid`) |
| **BACKFILL-ONLY** | in the stored-key allowlist and/or the matrix, written **only** by the Owner-authorized 2026-08-30 sandbox backfill; the live create path omits it | `contacts.owner`, `locations.owner`, `trucks.operatingCompanyId`, `equipment.operatingCompanyId` (fixtures only), `receiving_orders`, `inventory_transactions.*`, `transfer_orders.source/destinationOperatingCompanyId` (in `STORED_KEYS` but **absent from** `serializeTransferOrder`), `fieldops_jobs`, `stock_locations` |
| **DECLARED, NEVER AUTHORED** | in the type, **no writer at all** | `warehouses.operatingCompanyId` — `types/warehouse.ts:76-79` states *"nothing in this repository may author this field yet"*; the only path is an offline script. `mobile_locations` has **no company field at all** |

**R3. A grep for `operatingCompanyId` MISSES THE ENTIRE FINANCIAL TIER.** Invoices and payments store
the company as **`companyId`**, with `operatingCompanyId` present only *nested* inside `attribution`.
This is why the matrix's financial block reads `ownerFields: []` while the storage is **required and
live** — conflict **O-7**.

**R4. `WRITE-ONLY` is a required third value** for VISIBILITY EFFECT and REPORTING EFFECT
(OD-OWN-021): *"a company fact with a live writer, no surface and no report is a distinct condition
from absent storage and must not be scored as present."* **The count is contested — conflict E-4 —
and is attributed to OWN-E2E, never restated as a synthesis figure.**

**And the caveat that qualifies every PERSON row (`†`):** the storage exists and is
**shape-validated only**. Nothing on the ownership path reads the `employees` collection, so a row
reading `PERSON` **does not warrant that a live employee is on the other end** (OWN-DESIGN §3.4,
OWN-E2E F-8 EXECUTED).

**And every ownable row carries `‡`: handoff is INERT for all 14 HANDOFF-capable families, and the one
live owner-change control in the product (Opportunity) BYPASSES the authority entirely** —
`updateOpportunity` accepts `ownerEmployeeId` in its patch vocabulary, refuses an empty value
(`OWNER_REQUIRED`), and on change calls the generic `record()` helper. **The module contains no
reference to `OWNERSHIP_HANDOFF` or `stageOwnershipHandoff`. So an Opportunity owner change files as an
ordinary field edit: the audit trail of the one ownership move EOS can actually perform is in the wrong
vocabulary** (OWN-DESIGN AG-12, OD-OWN-020).

---

## 1. The distribution, and what it means for the invariant

| `ownerClass` | Count | Every family in the class is… |
|---|---:|---|
| **COMPANY** | **20** | operational — service, inventory, purchasing, finance, physical. **A company is answerable and no person is** |
| **EXCLUDED** (`NONE`) | **17** | identity, access, audit, coverage, infrastructure — **deliberately not ownership objects** |
| **REFERENCE** | **7** | shared master data describing the world, not our side of it |
| **PERSON** | **6** | **ALL SIX ARE COMMERCIAL** — Account, Contact, Location, Opportunity, Sales Agreement, Sales Order |
| **PARTICIPATING_COMPANIES** | **1** | Transfer Order — the shape is two named participants, not one owner |
| **Total** | **51** | *(EXECUTED by OWN-E2E; confirmed two ways by OWN-DESIGN; evaluated by EMP-ACCOUNTABILITY. The ratified reconciliation document's prose says 50 — conflict **E-9**)* |

Other EXECUTED distributions (OWN-E2E §2): `companyScope` = COMPANY_NEUTRAL **30** / SINGLE_COMPANY
**20** / CROSS_COMPANY_CAPABLE **1** · `ownerType` = COMPANY **20** / USER **6** / null **25** ·
`transfer` = N_A **25** / HANDOFF **14** / IMMUTABLE **12** · **rows with empty `ownerFields`: 38 of
51** · `ownableFamilies()` / `CENSUS_FAMILIES` = **27** · families with a **MODEL** gap (census reason
*"family has no ownership storage yet"*) = **13** · families with a **DATA** gap = **14**.

> **THE STRUCTURAL FINDING (EMP-ACCOUNTABILITY §9).** Of the 27 ownable families, **20 are COMPANY, 1
> is PARTICIPATING_COMPANIES, and 6 are PERSON — and all 6 PERSON families are commercial.** Every
> operational family is owned by a company. **A company cannot be asked why the next thing has not
> happened.** The ownership model is therefore, for operations, a **books-and-records model rather
> than an accountability model.** *That is a legitimate thing for it to be* — but it means **the
> invariant cannot be satisfied by the ownership model at all** and needs a second, orthogonal axis.
> **OWN-DESIGN §7.3 agrees from the other side: a COMPANY answer on those 20 families is the model's
> correct output, and MG-1 is a different column.** (Conflict **A-2** — recorded so no later reader
> manufactures a disagreement where the two lanes agree.)

---

## 2. Panel A — OWNER

| OBJECT | RECORD OWNER TYPE | OWNER STORAGE / SOURCE | OWNER CREATION RULE | OWNER TRANSFER RULE |
|---|---|---|---|---|
| **Account** | PERSON † | `accountOwner` — **a 7-key Person Assignment map, not a scalar** (`assignedToEmployeeId`, `assignedToUserId`, `assignedToDisplayName`, `assignedByEmployeeId`, `assignedByUserId`, `assignedByDisplayName`, `assignedAt`); partial records rejected. Projected by `typedOwner.ts:95-109` | **EXPLICIT ONLY.** `inheritanceSource: null`. **D-6 forbids creator, territory, coverage, activity, sales history, auth uid.** An ownerless Account makes inherited Opportunity creation **REFUSE by design** | HANDOFF ‡ — **no cascade** to Contacts/Locations/Opportunities. **And this is the one family whose owner is changed by an UNGOVERNED client write** (§5, AU-5) |
| **Contact** | PERSON † | `owner` as a typed `{type:"USER",id}` map — **BACKFILL-ONLY**; `domain/contacts.js` never sets it. **And the only writer is POSTGRES-ONLY** (`crm/customerRepository.ts`), so the matrix describes storage in a different datastore from the one the census and Rules operate on (EG-C2) | INHERIT parent Account owner at creation; **PROTECTED, not substituted, when the Account has none** | HANDOFF ‡ — INERT |
| **Location** | PERSON † | `owner` typed map — **BACKFILL-ONLY**; `domain/locations.js:18-24` sets no actor and no owner. **A CUSTOMER site**, distinct from warehouses | INHERIT parent Account owner | HANDOFF ‡ — INERT |
| **Opportunity** | PERSON † | `ownerEmployeeId` | **EXPLICIT → INHERIT Account owner → REFUSE** (`creationOwnerResolution.ts:59-80`). **Actor / `createdBy` / authenticated user / `assignedTo` / an arbitrary salesperson / an admin / first-available are ALL forbidden** (`:12-23`) | HANDOFF ‡ — **and the ONE live owner-change control in EOS, bypassing the handoff authority** |
| **Sales Agreement** | PERSON † | `ownerEmployeeId` | EXPLICIT → INHERIT Opportunity owner → REFUSE | HANDOFF ‡ — INERT; **owner displayed, no way to change it** |
| **Sales Order** | PERSON † | `ownerEmployeeId` | EXPLICIT → INHERIT Opportunity owner → REFUSE, **plus a separate hard `COMPANY_REQUIRED` refusal** (`salesOrderCommands.ts:274-283`) | HANDOFF ‡ — INERT; owner displayed, no change control |
| **Work Order** (`fieldops_wos`) | COMPANY | **NONE. `ownerFields: []`.** Measured **0/30** | Declared *"explicit at creation, or a governed upstream source that already carries one (e.g. a Sales Order)"* — **but there is no field to write it to.** 11/30 carry a `salesOrderId` and are *potentially* derivable, **unmeasured** | **HANDOFF declared over storage that does not exist** — the handoff command would accept this family and there is nothing to move |
| **Service Visit / Job** (`fieldops_jobs`) | COMPANY | `operatingCompanyId` — **real storage, 41/45 measured**. *(The legacy family DOES store it; the two Work Order families differ and must not be generalised)* | Explicit at creation, or the governed upstream source company. **Never technician / dispatcher / `createdBy` / `assignedTo`** | HANDOFF ‡ — INERT. **And the field is client-writable with no `hasOnly`** (§5) |
| **Equipment** | COMPANY | `operatingCompanyId` — **BACKFILL-ONLY and FIXTURE-ONLY.** Held **DISTINCT** from `explicitTitleHolder` (legal title) and from `accountId` (the **CUSTOMER**) — **neither is an owner** | **EXPLICIT ONLY.** `backfillSource: null` — **every candidate on the record (customer, title holder, location name, model, manufacturer, serial prefix) is a prohibited proxy** | HANDOFF ‡ — INERT. Display renderer exists and **is deliberately not called** |
| **Part** (+ 6 REFERENCE families) | **REFERENCE** | **NONE, deliberately.** Both operating companies may legitimately use the same part number | N/A — `NOT_OWNABLE` by classification | `N_A` — handoff refuses `FAMILY_NOT_OWNABLE` |
| **Warehouse** | COMPANY | **DECLARED, NEVER AUTHORED.** Matrix `ownerFields: []`; the type declares `operatingCompanyId?` and states *"nothing in this repository may author this field yet"*. Measured **0/5** | `inheritanceSource: "none -- this IS the root"`. Explicit governed configuration, Owner-supplied per site, **never the display name** | HANDOFF ‡ — **the ONE family with a live handoff path, and it is an operator CLI**: `assignWarehouseRootCompany.js:234` |
| **Mobile Location** | COMPANY | **NONE — no company field exists at all.** Measured 0/7. **Deliberately no backfill rule** | *"none — this IS the root"*; explicit governed configuration | HANDOFF ‡ — INERT |
| **Truck** | COMPANY | `operatingCompanyId` — **BACKFILL RESIDUE ONLY.** 2/2 stored by the applied backfill; **the rule that produced them was DELETED** and `truckRegistryCommands.ts` never writes it. **The matrix OVERSTATES this row** | **EXPLICIT governed configuration for the VEHICLE — not its home warehouse.** `backfillSource: null`. The derivation was **deleted, not corrected**, because `cert-trk-04/05` are `ventana` vehicles homed at a `taylor` warehouse | HANDOFF ‡ — INERT. **A truck's company is asserted twice, incompatibly — conflict O-3** |
| **Purchase Order** | COMPANY | **NONE, and stated in code:** *"No company field exists on this shape. Null is the true statement."* Census scans **0 records** | *"the buying company"*; `backfillSource` *"to be confirmed against purchasing semantics"* — **unsettled** | `IMMUTABLE` — refuses `FAMILY_IMMUTABLE` |
| **Reorder Request** | COMPANY | **MATRIX SAYS `[]` — CONTESTED, conflict O-1.** Actual storage is `warehouseId` + `operatingCompanyId`, **both required on the built record** and persisted | **DERIVED from the governed Warehouse at trusted creation, then STORED.** A client-supplied company is **REFUSED** `COMPANY_NOT_CLIENT_SUPPLIABLE`; a companyless warehouse is **REFUSED** `WAREHOUSE_NO_COMPANY` | HANDOFF ‡ — INERT |
| **Transfer Order** | **PARTICIPATING COMPANIES** | `sourceOperatingCompanyId` + `destinationOperatingCompanyId` as **`participatingFields`, deliberately NOT `ownerFields`** — **BACKFILL-ONLY** (in `STORED_KEYS` but absent from `serializeTransferOrder`); both-or-neither enforced | The governed source and destination location authorities. BOTH participants or nothing. ***"Source always owns it" and "destination always owns it" were BOTH REJECTED*** | **`N_A`.** The handoff command **refuses with its own code `FAMILY_PARTICIPATING_COMPANIES`** — changing participants is transaction-domain state, not an ownership handoff |
| **Cycle Count** | COMPANY | `operatingCompanyId` — **24/24 measured** | The counted location's company, resolved against a **physical root** — *not* a stock location, despite the matrix prose | `IMMUTABLE` |
| **Invoice** | COMPANY | **MATRIX SAYS `[]` — THAT IS WRONG (conflict O-7).** `InvoiceRecord.companyId: string` is **required** and written, under the structural invariant `companyId === attribution.operatingCompanyId` | The governed Sales Order's `operatingCompanyId`. **Caller `companyId` is ASSERTION-ONLY**; a mismatch is refused `COMPANY_MISMATCH`; a companyless SO refused `COMPANY_REQUIRED` | `IMMUTABLE` — **historical ownership stays historical** |
| **Payment** (+ `refunds`, `invoice_adjustments`, `paymentApplications`) | COMPANY | **MATRIX SAYS `[]` — WRONG.** `companyId` is stored | Inherited from the governed **Invoice**; caller `companyId` assertion-only | `IMMUTABLE` |
| **Report** (a report *run*) | **NONE — no record exists** | No collection. A run is an **audit action** and a `FINANCIAL_SOURCE_TYPES` lineage token, never a persisted owned object | N/A | N/A |
| **Saved Report Definition** | **MATRIX SAYS NONE (EXCLUDED). IMPLEMENTATION SAYS PERSON** — conflict **A-4** | `ownerUid` — a Firebase **uid**, not an `employeeId` | **THE CREATOR CLAIMS IT.** `ownerUid: params.actorUid`, never client-supplied. **The ONE family where the actor DOES become owner** | **NONE EXISTS.** No transfer, no share command. `shareReportDefinition` exists only in the audit-action vocabulary **with no implementation.** **Ownership is permanent and non-transferable** |
| **Employee** | **NONE** (EXCLUDED) | *"person authority — a subject of ownership, not an object"* | N/A — **deliberate** | `N_A` |
| **Role Assignment** | **NONE** (EXCLUDED) | *"access authority, governed separately"* | N/A — deliberate | `N_A` |
| **Approval / Exception** | **NO MATRIX FAMILY — BUT APPROVAL RECORDS EXIST, FRAGMENTED ACROSS SIX SURFACES** | No collection and no subcollection anywhere (**zero nested `match` blocks in `firestore.rules`**). The six: `ApprovalRecord` over `APPROVABLE_ACTION_TYPES` (`INVOICE_ADJUSTMENT`/`WRITE_OFF`/`REFUND`/`PLAN_APPROVAL`/`ATTRIBUTION_CORRECTION`) · `accessRequests.ApprovalPolicy{requiresApproval, approverConstraint}` · `roleAssignments.approvedBy` · `data_import_jobs.approvedBy/approvedAt` · `performance_goals.approvedByUid` · `financialPolicyProfile.approval.approvedBy` (**free text**) | `decidedByUid` is the approver. **Self-approval is forbidden UNCONDITIONALLY — "no policy input can re-enable it"** — and `performanceGoal.ts:232-243` refuses it too | None — an approval is a decision record, not a transferable object |
| **Inbound Work** (`inbound_work_requests`) | **UNCLASSIFIED — ABSENT FROM THE MATRIX** | No owner field. **But it carries a governed `operatingCompanyId`** from the routing-rule outcome or the mailbox default | `routing.outcome.operatingCompanyId ?? mailbox.operatingCompanyId ?? null` — **a CONFIGURATION derivation with no counterpart anywhere in the matrix** | None. Not in the allow-list, so a handoff is refused `FAMILY_UNKNOWN` |

---

## 3. Panel B — ACCOUNTABILITY AND ASSIGNMENT

**ACCOUNTABLE** = the person answerable for the outcome. **ASSIGNEE/EXECUTOR** = the person who does
the work. **EOS has almost no storage for the former.**

| OBJECT | ACCOUNTABLE PERSON | ACCOUNTABILITY SOURCE | ASSIGNEE / EXECUTOR | ASSIGNMENT SOURCE |
|---|---|---|---|---|
| Account | = the owner. **No separate field** | `accountOwner.assignedToEmployeeId`. The nearest distinct fact is `assignedByEmployeeId` + `assignedAt` — **who ASSIGNED, never who is ACCOUNTABLE** | NONE — an Account has no executor | — |
| Contact / Location | = the owner (inherited) | `owner`. **Inheritance is a ONE-TIME SNAPSHOT**, so after an Account handoff the child's accountable person is the **FORMER** Account owner until separately moved | NONE | — |
| Opportunity / Sales Agreement | = the owner | `ownerEmployeeId` | NONE stored | — |
| **Sales Order** | **TWO CANDIDATES, DELIBERATELY SEPARATE** | `ownerEmployeeId` (ownership) **and** `creditedSalespersonId` (sales credit, FIN-002). `financialAttribution.ts:15-18` insists they are different questions: **"OWNERSHIP != SALES CREDIT"** | **NONE stored on the order** — *"The Sales Order names the salesperson, never who must ship it"* | — **ORPHAN-5** |
| **Work Order** | **NOT STORED — MODEL GAP.** The declared owner is a COMPANY; **no person is accountable on the record** | none | `assignedTechId` (dispatch) and `scheduledTechId` (planning) — **two distinct fields, NEITHER ownership** | Dispatch / Scheduler. **Reassignment is denormalized as `reassignedFromTechId`/`reassignedAt`/`reassignedReason` with the durable record in a `reassignWorkOrderTechnician` AUDIT EVENT — a DIFFERENT action from `OWNERSHIP_HANDOFF`. THIS IS THE CODE-LEVEL PROOF THAT REASSIGNMENT ≠ OWNERSHIP TRANSFER** |
| Service Visit / Job | **NOT STORED — MODEL GAP** | none | `assignedTechId` — *"`assignedTechId` remains ASSIGNMENT"* | Dispatch |
| Equipment | **NOT STORED** | none. `explicitTitleHolder` is **legal title**, not accountability | NONE | — |
| Part (REFERENCE) | **NONE, deliberate** | — | NONE | — |
| Warehouse | **NOT STORED — MODEL GAP. No site manager, no responsible person** | none | NONE | — |
| Mobile Location | **NOT STORED** | none | NONE | — |
| **Truck** | **`assignedDriverEmployeeId` EXISTS** — nullable, and **explicitly NOT custody.** **The closest thing in EOS to a named person accountable for a non-commercial asset, and it is not wired to ownership, escalation or visibility** | `assignedDriverEmployeeId` — **stored, unread by any authority** | the driver; plus indirect custody via `location_truck_claims` (EXCLUDED infrastructure) | truck registry; claim records |
| Purchase Order | **NOT STORED** | none | NONE | — |
| **Reorder Request** | **NOT STORED as accountability. THREE separate person/role facts exist and NONE is accountability** | `requestedBy` = **the ACTOR** — *"Deliberately not the owner"* | `assignedToUserId` (processor, per D-14) | the reorder workflow, **unchanged client-direct path** |
| Transfer Order | **NOT STORED — and by design: the shape is two companies** | none | NONE stored | — |
| Cycle Count | **NOT STORED** | none | counter/assignee fields exist in the cycle-count domain, **outside the ownership model** | cycle-count sheet domain |
| Invoice / Payment | **NOT A PERSON.** COMPANY-owned by ruling **D-15** | `companyId` | NONE — an invoice is not executed | — |
| Saved Report Definition | = `ownerUid` (**the creator**) | `ownerUid` | NONE | — |
| Employee | **NONE, deliberate.** An Employee is the **SUBJECT** of accountability | — | — | — |
| Role Assignment | **NONE, deliberate** (access authority) | — | — | — |
| **Approval / Exception** | `decidedByUid` / `approvedBy` / `approvedByUid` — **SIX different field names across six surfaces, no shared vocabulary** | The six surfaces. **`approverConstraint` on `accessRequests` is the ONLY TYPED accountability constraint in EOS**: `distinctFromRequester` / `platformAdmin` / `companyAdmin` — **and its workflow and UI are explicitly DEFERRED** | `requestedByUid` / `requestedBy` — the requester, **never the approver** | the requesting command |
| **Inbound Work** | `decisionBy` = the reviewer who accepted/declined/attached — **an AFTER-THE-FACT actor record, not a pre-assigned accountable person** | `decisionBy` (a uid) | **NONE before decision.** The record sits in a `queue` until someone acts | `queue` from `routing.outcome.queue ?? mailbox.defaultQueue` |

---

## 4. Panel C — ESCALATION AND STEWARDSHIP

**Five findings apply to EVERY row and are stated once rather than 25 times** (OWN-DESIGN §4.3):

**(0) EVERY ROLE-VALUED QUEUE IN THIS PANEL IS MEASURED-EMPTY IN PRODUCTION.** `currentOwner`,
`queue`, `roleKeys` and `requiresOwnAssignment` are **inert in production for want of OCCUPANTS, not
for want of MECHANISM** — *"a materially different diagnosis from every other gap in this document,
and the only one that a GRANT rather than a DESIGN would close."* **OWN-DESIGN recorded this
conditionally (UP-10, provenance unlocatable in its worktree); it is now established — see
`EMPLOYEE-OPERATING-MODEL.md` §2.**

**(i) NO EOS FAMILY STORES AN ESCALATION OWNER.** Repo-wide, `escalat*` appears only in governance
prose (escalation *to the Owner* as an AI-agent boundary) and in deploy-gate scripts. **No escalation
field, no escalation target, no escalation timer on any business record.** → **MODEL GAP, uniform.**

**(ii) THE MANAGER EDGE EXISTS AND NOTHING ROUTES ON IT.** `managerEmployeeId` is real, governed and
relationally validated — the update command **reads the referenced employee inside its transaction** to
prove it exists. **Its spec home is `administration-users-consolidation.md:206-209`, NOT
`employee-foundation.md`** (whose schema omits it — *"a lane reading only that spec would wrongly
conclude no manager field exists"*). **But the field has ZERO authorization, visibility or routing
readers.** → **ENGINEERING GAP, not a model gap** — and see **EG-C1**: EMP-ACCOUNTABILITY classifies
the same fact a MODEL GAP for a different question, and **both classifications are correct.**

**(iii) MANAGER IS ANSWERED TWICE, IN OPPOSITE DIRECTIONS.** → **AUTHORITY GAP**, conflict **AU-1**.

**(iv) THERE IS NO DOMAIN STEWARD ANYWHERE, AND NO VOCABULARY ONE COULD BE STORED IN.** Both candidate
stores are unusable as authority: `jobTitle` is **free text**, and `operationalRoles` is a closed
8-value list of which 3–5 have essentially no consumer. The separate security-Role set is **48** and
those are **authorization, not stewardship.** → **MODEL GAP, uniform.**

**(v) `NEEDS_REVIEW` AND `requiresOwnAssignment` ARE NOT ESCALATION.** The closest thing in EOS to
escalation is `transitionEngine.ts:129-140` gating each transition on `roles` + `requiresOwnAssignment`
— **and a dispatcher acting on a technician's Work Order is ROLE AUTHORITY, not escalation and not an
ownership transfer** (conflict **AS-3**).

| OBJECT | ESCALATION OWNER | ESCALATION RULE | DOMAIN STEWARD |
|---|---|---|---|
| Account / Contact / Location / Opportunity | NOT STORED | none. Would resolve through owner → `managerEmployeeId`, **which nothing reads** (ii) | NOT STORED (iv) |
| Sales Agreement / Sales Order | NOT STORED | **Workflow-level only** — `SALES_AGREEMENT_WORKFLOW` / `SALES_ORDER_WORKFLOW` gate transitions by `roleKeys` + `capabilityId`. **That is AUTHORIZATION, not escalation** | NOT STORED (iv) |
| **Work Order** | NOT STORED | **The closest thing in EOS, and it is not escalation** (v) | NOT STORED (iv) |
| Service Visit / Job | NOT STORED | none | NOT STORED (iv) |
| Equipment | NOT STORED | none | NOT STORED (iv). Master-data curation of `equipment_models` (REFERENCE) has **no owner** |
| **Part** | **NONE — deliberate.** A REFERENCE record has no owner to escalate past | N/A | **NOT STORED — and this is the SHARPEST instance of (iv).** Parts are the canonical shared-master-data case and are **exactly what a steward would govern.** Classification `REFERENCE` correctly says *"no BUSINESS OWNER"*; **it does not say "no CURATOR", and no curator exists** |
| Warehouse | NOT STORED | none. R-29-style `{type:"location"}` RoleAssignment scope bindings exist **but they are access grants, not escalation** | NOT STORED (iv) |
| Mobile Location / Truck / Purchase Order | NOT STORED | none | NOT STORED (iv) |
| **Reorder Request** | **A ROLE QUEUE, NOT A PERSON.** `currentOwner` holds a role token, never an employee id — `"INVENTORY"` at creation, handed to `PARTS_MANAGER` on approval and `PARTS_ASSOCIATE` on assignment, and the client states *"`currentOwner` stays role-level"* | **THE ONE REAL ESCALATION LADDER IN EOS, AND IT IS A STATUS LADDER:** `PENDING_REVIEW → READY_FOR_PARTS_MANAGER → ASSIGNED_TO_PARTS_ASSOCIATE → PURCHASING_IN_PROGRESS → ORDERED → RECEIVED`, each gated by capability + `roleKeys`; `startPurchasing` carries `requiresOwnAssignment: true`. **NOT ownership: D-14 keeps `currentOwner`, `requestedBy` and `assignedToUserId` all separate from the COMPANY owner** | NOT STORED (iv) |
| **Transfer Order** | **NONE — deliberate.** There is no single owner to escalate past | N/A | NOT STORED (iv) |
| Cycle Count | NOT STORED | The cycle-count domain has its own count/recount/variance-approval steps **outside the ownership model** | NOT STORED (iv) |
| Invoice / Payment | NOT STORED | none. Correction runs through **FIN-007 attribution-adjustment events**, not escalation | NOT STORED (iv) |
| **Saved Report Definition** | **NONE, AND THIS IS A LIVE PROBLEM.** `ownerUid` is the only gate; **no transfer, no share, no admin override path in the command module** | **On employee deactivation the definition becomes UNREACHABLE BY EVERYONE.** This is open question 3 of `record-ownership.md` — *"their owned records need to go somewhere… the most likely way the model rots in practice"* — **still unanswered** | N/A |
| **Employee** | **`managerEmployeeId` — the only manager edge in EOS** | **Stored, validated, NEVER READ FOR ROUTING** (ii); **contradicted by `roleHierarchy.ts:9-20`** (iii) | N/A — an Employee is the subject |
| Role Assignment | NOT STORED | `accessRequests` is the request/decide path (EXCLUDED) | N/A |
| **Approval / Exception** | **NOT STORED** | **Threshold-based, NEVER person-based:** `ApprovalPolicyLine{actionType, requiresApproval, thresholdMinor}` decides *WHETHER* approval is needed, **never *WHO***. `accessRequests`' workflow and UI are **explicitly deferred.** A rejection is **terminal** and `assertActionApproved` refuses quiet re-attempts | N/A |
| **Inbound Work** | **A QUEUE, NOT A PERSON** | **A STATUS-level escalation exists:** `NEEDS_REVIEW` — *"Routing demanded manual review, or thread association was ambiguous. **Same queue, louder**"*; `QUARANTINED` is refusal before review. **No person, no timer, no target — and the distinction is in a code comment and nowhere on screen** | NOT STORED (iv) |

---

## 5. WHERE OWNERSHIP, ASSIGNMENT AND COMPANY ARE CONFUSED

### 5.1 Owner vs assignee — the exceptions, and the counter-examples

**EOS is mostly very good at this. Both halves must travel together.** (EMP-ACCOUNTABILITY §8;
OWN-E2E §8)

| Place | Confusion | Verdict |
|---|---|---|
| **`accounts.accountOwner`** | Ownership stored **inside a 7-field assignment record**; `customerMigrationSource.ts:127-158` accepts **two owner shapes on one field** | **VOCABULARY CONFUSION AT THE STORAGE LEVEL.** *"The platform's best-provenanced structure, describing ownership in the language of assignment — which is why 'who accepted it' was never asked."* **OWN-E2E: the single highest-value corruption path in the model.** → conflict **O-10**, `OD-24` |
| **`reorder_requests.currentOwner`** | A **role queue** named `currentOwner`, **rendered as "Current owner" directly above "Assigned to"** while the real company owner is **never rendered at all** | **REAL, and actively misleading.** Three responsibility concepts on one document. **Remedy contested — conflict A-3, `OD-18`.** EMP-ACCOUNTABILITY: keep, do not rename (**Tier-2 Rules risk; `firestore.rules` is hash-anchored to the live deploy**). OWN-DESIGN: rename **in description**, which carries no Rules risk |
| **The reorder Assign branch** | `firestore.rules:765-790` changes `currentOwner` **and** sets `assignedToUserId` in one write | **THE ONE GENUINE CONTRADICTION of "reassignment ≠ ownership transfer" in EOS** (AG-9). *"A field named `currentOwner`, mutated by an approval, is the collision doing damage."* → **AS-1** |
| **Sales Order owner vs fulfilment** | The record names the salesperson and **nobody** who must ship it | **REAL CONFUSION BY OMISSION** — an **AUTHORITY GAP**, a missing *role definition*. ORPHAN-5 |
| **`requiresOwnAssignment`** | Assignment used as **authorization** | **Correct as authorization, DANGEROUS as accountability** — it makes the assignee the only possible actor, **converting an assignment gap into a hard lock.** → **AS-2** |
| `record-ownership.md` §4 *"Work Order — owned, open question"* | The spec asks whether Work Orders are ownable and warns `scheduledTechId`/`assignedTechId` *"are ASSIGNMENT, not ownership, and conflating them would be easy and wrong"* | **SUPERSEDED AND CORRECT** — D-13 answered COMPANY, and `assignedTechId` is **deliberately excluded from `ownerFields`** |
| **`reassignWorkOrderTechnician`** | — | **CORRECTLY SEPARATED, and it is the proof.** A separate audited action with a **required reason** (H20) — *"the only audited person-change in the platform"* |
| `truckRegistry.reassignDriver` / `setDriver` | — | **CORRECTLY SEPARATED** |
| `explicitTitleHolder` | Legal title vs record ownership | **CORRECTLY SEPARATED** (D-3) — *"and the matrix says so explicitly to stop a future reader reconciling them"* |
| `sales_territories`, `commercial_coverage_assignments` | Coverage vs ownership | **CORRECTLY SEPARATED and EXCLUDED** — *"coverage is not ownership, credit, commission or security"* |
| `equipment` Rules | — | **CORRECTLY SEPARATED** — `hasOnly(equipmentEditableKeys())` **omits `operatingCompanyId`**, so the client cannot touch the company. **The pattern that SHOULD have been used elsewhere** |

### 5.2 The ownership-write exposure — and why it is sharp

**`accounts.accountOwner`, `contacts.owner`, `locations.owner` and `fieldops_jobs.operatingCompanyId`
are rewritable by any `admin` OR `dispatcher` via a generic client Firestore write, with no handoff, no
audit event, and no governed command.** (OWN-E2E F-4; corroborated from the UI side by
EMP-EXPERIENCE §3.4)

| Collection | Owner field | Rule | Field-level guard? |
|---|---|---|---|
| `accounts` | `accountOwner` | `firestore.rules:1335-1337` — governed fields are **only `paymentTerms` and `taxStatus`**; **no `hasOnly`** | **NONE** |
| `contacts` | `owner` | `:1557` — bare `isAdminOrDispatcher()` | **NONE** |
| `locations` | `owner` | `:1343` | **NONE** |
| `fieldops_jobs` | `operatingCompanyId` | `:382-391` — transition-gated only, **no `hasOnly`** | **NONE** |

**Protected by contrast:** `equipment` (`hasOnly`, company omitted) · `opportunities`, `sales_orders`,
`sales_agreements` (`allow read, write: if false`) · `warehouses`, `trucks`, `fieldops_wos`
(`allow create, update, delete: if false`).

> **THIS INTERSECTS THE OCCUPANCY FINDING AND MAKES IT SHARP. Production holds exactly ONE active role
> assignment and it is `admin` at global scope. The one principal that exists in production is
> precisely the one who can silently rewrite ownership on `accounts`, `contacts` and `locations`.**
> Rules themselves record this as an *"INTERIM path"* pending a trusted audited writer. And
> **`assignAccountOwner` — which calls itself *"the ONLY way one is ever set after creation"* — is
> exposed by no callable and called by no UI. The governed path is unreachable and the ungoverned path
> is the product.** → `OD-8`

**One honest caveat from OWN-E2E about its own headline (U-9): the Rules behaviour was read as source,
never executed** (no JRE; port 8080 held by an unrelated process). *"This is the one place my headline
claim rests on STATIC READ, and it should be executed before it is relied on."* Partially corroborated
from the other side: the client-direct owner write ships in `AccountForm.jsx:162-171` (plus a "Clear
owner" button at `:465`) and evidently succeeds.

### 5.3 Company ownership vs employee accountability

Full table in [`EMPLOYEE-OPERATING-MODEL.md`](EMPLOYEE-OPERATING-MODEL.md) Q4. The two patterns to
propagate and the one not to:

| Pattern | Verdict |
|---|---|
| **`companyScopeField`** — *"Do not interpret `operatingCompanyId` as replacing salesperson ownership… one record with two true, independent facts"* | **EXEMPLARY. PROPAGATE THIS** |
| **R-20** — accept INACTIVE in storage, refuse it in assignment | **EXEMPLARY — and the pattern the PERSON axis needs** |
| **D-13 / D-14 / D-15** — PERSON → COMPANY reclassification | **Correct about ownership, and it silently VACATED the accountability question.** *"This is the moment the invariant became unsatisfiable for service work."* **DO NOT PROPAGATE this pattern into new families without answering `OD-1` first** |

---

## 6. DELIBERATE `NONE` / `REFERENCE` / `COMPANY` — **NOT GAPS**

**Binding on every artifact.** Each is a decided, evidenced outcome (OWN-DESIGN §7).

### 6.1 Deliberate REFERENCE — no owner, by classification (7 families)

`parts`, `part_aliases`, `part_supplier_items`, `manufacturers`, `equipment_models`, `supplier_catalog`
and `suppliers` (**provisional**). The test applied was *"Can Taylor and Ventana both legitimately use
the same record?"* and the answer is **yes for all of them** — *"a part number, a manufacturer, an
equipment model and a supplier's catalog entry describe the WORLD, not our side of it."*
`unresolvedPolicy` is the explicit string *"not ownable -- excluded from the invariant by
classification, not by omission"*, and **the census does not scan them and reports them as CLASSIFIED
OUT, never as a backlog.**

**`suppliers` is the one PROVISIONAL row** — if it carries company-specific commercial terms it is
COMPANY, not REFERENCE → `OD-29`.

**But note the limit EMP-ACCOUNTABILITY establishes (§2.7, OD-OWN-001): REFERENCE correctly removes
*OWNERSHIP* and leaves *STEWARDSHIP* unassigned. The invariant explicitly requires a steward for
exactly these objects, so REFERENCE as currently defined does NOT satisfy the invariant — it exempts
the object from a DIFFERENT statement.** → `OD-11b`

### 6.2 Deliberate NONE / EXCLUDED — not a business record (17 families)

`users`, `employees`, `fieldops_technicians`, `permissions`, `roles`, `roleAssignments`,
`accessRequests`, `auditEvents`, `reportDefinitions`, `sales_territories`,
`commercial_coverage_assignments`, `counters`, `inventory_sync_status`, `location_truck_claims`,
`technician_working_availability`, `technician_blocked_time`, `operating_companies`.

Four carry a reason worth restating because they **look** like gaps and are not:

| Family | Why NONE is correct |
|---|---|
| **Employee** | *"person authority — a subject of ownership, not an object."* **An Employee being unowned is the model working** |
| **Role Assignment** | *"access authority, governed separately."* Coverage/credit/security are explicitly **not** ownership |
| **Sales Territory / Coverage Assignment** | *"coverage is not ownership, credit, commission or security"* |
| **Operating Company** | *"the company authority itself — companies are not owned by companies"* |

**`reportDefinitions` is the one entry in this list that is flagged** — EXCLUDED with the note
*"platform record with its own private-by-owner model — do not disturb"*, which is **a deliberate
DEFERRAL, not a classification of ownerlessness** — and it is simultaneously the only family in EOS
where ownership **actually gates access.** Conflict **A-4**, `OD-21`. **Not a gap to close.**

### 6.3 Deliberate COMPANY — the right answer, not a substitute for a missing person (20 families)

Three rulings each state this **affirmatively**:

| Ruling | Statement |
|---|---|
| **D-13** (service) | *"The responsible operating company owns the job; the technician performs it. That keeps the ownership/assignment distinction this whole model rests on, and it is why `assignedTechId` is deliberately NOT an ownerField"* |
| **D-15** (financial) | *"A ledger entry belongs to the books it lands in, not to the salesperson upstream of it… accounting ownership and sales credit are different questions and must not share one field"* |
| **D-14** (inventory obligation) | `currentOwner` (role queue), `requestedBy` (actor) and `assignedToUserId` (processor) **all stay separate from the COMPANY owner** |

**A COMPANY answer on these 20 families is the model's CORRECT OUTPUT. The absence of a person owner
is not an omission — the omission is MG-1, which is about ACCOUNTABILITY, a different column.**

### 6.4 Deliberate PARTICIPATING COMPANIES (1 family)

`transfer_orders`. *"Source always owns it"* and *"destination always owns it"* were **both explicitly
rejected**, because either would record a company as responsible for a movement it may only have
received. `transfer: "N_A"` is what enforces it — the handoff command refuses the family **with its own
error code**. **Having no single owner is the DECIDED ANSWER.**

### 6.5 Deliberate NONE on the company axis for the commercial head (3 families)

`accounts`, `contacts`, `locations` carry **no company field and must not acquire one.** **R-15, stated
in code:** *"a Customer must NOT carry a single operating company just to make this chain resolve. The
customer relationship and the transacting company are different questions, and collapsing them would
silently decide the second by answering the first."* The company enters at the **Opportunity** instead.
**That an Account has no resolvable company is THE DESIGN, not a gap.**

### 6.6 One further deliberate NONE — exception rows

**Ruling SO-N4 removed "an Owner per row" from the cross-object exception surface** on the grounds that
a `recipientRole` is a **role and not a person.** The archaeology records the cost of that choice in the
same document: *"The page shows the technician but no owner, because no ownership model exists. **Who
is accountable for an exception that nobody is assigned?**"*

**The NONE is DECIDED; the accountability question it leaves open is MG-1, not a reversal of the
ruling.**
