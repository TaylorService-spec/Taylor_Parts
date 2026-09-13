# OWN-DESIGN — Business Ownership Model × EOS Object Families

**LANE:** OWN-DESIGN · **MODE:** EVIDENCE_WRITE
**BASELINE:** `64008d5ae0bdd9532909671b15a91122400accf1` (`ATLAS-BASE-2026-09-12-A`)
**OBSERVED AT:** `64008d5a` for every claim below.
**SCOPE:** map the business ownership/accountability model onto EOS object families and name the gaps. This lane does **not** derive what *should* be true (`EMP-ACCOUNTABILITY`) and does **not** audit runtime lifecycle behaviour (`OWN-E2E`).
**RULE THIS LANE OBEYS:** `ownershipMatrix.ts` is DESCRIPTIVE of existing storage. No field is proposed. No schema is proposed. Gaps are **classified**, not filled.

---

## 0. Reading this document

- A **deliberate `NONE` / `REFERENCE` / `COMPANY`** answer is a *valid outcome*, not a gap. §7 lists them explicitly so the synthesizer does not read them as gaps.
- Gap classes: **MODEL GAP** (the business model has no answer) · **ENGINEERING GAP** (the model has an answer, storage does not exist or is not read) · **AUTHORITY GAP** (two authorities disagree, or no authority owns the question) · **WORKFLOW GAP** (the answer depends on a process step nobody has defined).
- **MISSING INPUT** = only the Owner's separate employee-design conversation can settle it. Not reconstructed here.
- **UNPROVEN** = a claim this lane could not verify from `64008d5a` alone; several are deferred to `OWN-E2E`.

---

## 1. Verification of the measured facts handed to this lane

Every inherited fact was re-derived at `64008d5a`. Results:

| # | Inherited claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Matrix distribution **20 SINGLE_COMPANY / 30 COMPANY_NEUTRAL / 1 CROSS_COMPANY_CAPABLE** | **CONFIRMED** (51 families) | `functions/src/ownership/ownershipMatrix.ts:117-538`. Literal `companyScope:` occurrences are 15/9/1 because four spread blocks emit many rows from one literal: financial ×5 (`:180-196`), roots ×2 (`:312-325`), REFERENCE ×6 (`:479-494`), EXCLUDED ×17 (`:509-535`). Expanded: SINGLE = 5+2+12+1 = **20**; NEUTRAL = 6+6+1+17 = **30**; CROSS = **1**. Independently corroborated by `sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.txt:3` ("27 of 51 declared families are ownable") and its class tally (COMPANY 20, EXCLUDED 17, PARTICIPATING 1, PERSON 6, REFERENCE 7). |
| 2 | Sole cross-company holder is `transferOrder` with `participatingFields: ["sourceOperatingCompanyId","destinationOperatingCompanyId"]` | **CONFIRMED** | `ownershipMatrix.ts:447-459`; `crossCompanyFamilies()` at `:570-572` filters `companyScope === "CROSS_COMPANY_CAPABLE"` and only this row matches. |
| 3 | The discriminator is `ownerClass === "PARTICIPATING_COMPANIES"`, **not** the presence of a company pair; `inventory_transactions` carries the same pair while `SINGLE_COMPANY` | **CONFIRMED, and sharper than stated** | `ownershipMatrix.ts:385-394`: `inventoryTransaction` declares `ownerClass: "COMPANY"`, `companyScope: "SINGLE_COMPANY"`, `ownerFields: ["operatingCompanyId"]` **and** `participatingFields: [...]` at `:390`. `participatingCompanyFamilies()` (`:556-558`) filters on `ownerClass`, so it **excludes** `inventoryTransaction` even though that row carries participating fields — the pair is declared on a family the participating-family accessor will never return. The census, by contrast, reads `participatingFields` structurally (`ownershipCensus.ts:127-156`), so census and accessor disagree about the same row. |
| 4 | `companyScope` and `companyScopeField` are orthogonal; `companyScope` alone cannot decide filterability; `salesOrder` is `COMPANY_NEUTRAL` yet carries a **required** authoritative company | **CONFIRMED** | `companyScopeField` is declared at `ownershipMatrix.ts:94` and set on exactly three rows (`:148` opportunity, `:157` salesAgreement, `:167` salesOrder). `salesOrder` is `companyScope: "COMPANY_NEUTRAL"` (`:168`) while `salesOrderCommands.ts:274-283` **refuses creation** with `COMPANY_REQUIRED` when no governed `operatingCompanyId` resolves. A `COMPANY_NEUTRAL` row therefore holds a hard-required company. |
| 5 | **Neither column has any runtime reader** | **CONFIRMED** | Repo-wide grep: `companyScopeField` appears only at `ownershipMatrix.ts:94,148,157,167` — declaration and three assignments, zero reads. `companyScope` is read nowhere in `functions/`. The only other `companyScope` symbol in the repo is an **independent** frontend field on admin profiles (`field-ops-app-vite/src/metadata/administration/objectAdministrationProfile.js:216,386`, values re-typed by hand in `profiles/invoice.js:95`, `profiles/part.js:89`, `profiles/payment.js:111`) — a hand-copied mirror, not a reader. See OD-OWN-004. |
| 6 | The Work Order carries **no company field at all** (`ownerFields: []`) | **CONFIRMED** | `ownershipMatrix.ts:250-256`; the row's own comment (`:221-247`) records the correction and the census proof. `sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.txt` measures `fieldops_wos` 0/30 with reason "family has no ownership storage yet", the string emitted only for empty `ownerFields` (`ownershipCensus.ts:157-163`). |
| 7 | `accounts`, `contacts`, `locations` are `COMPANY_NEUTRAL` with no company field; a customer may legitimately span Taylor and Ventana (R-14/R-15); no single company resolves for an Account; **Contact has no authoritative company derivation at all** | **CONFIRMED** | `ownershipMatrix.ts:118-141` — all three `PERSON`/`COMPANY_NEUTRAL`, no `companyScopeField`, owner storage only (`accountOwner`, `owner`, `owner`). R-15 is restated in code at `commercialCompanyScope.ts:16-19`: "a Customer must NOT carry a single operating company just to make this chain resolve." |
| 8 | `ownershipMatrix.ts:392-414` points four rows at `stock_locations`, **which was retired** | **CONFIRMED on the retirement; WRONG on two of its three consequences** | See OD-OWN-002. (a) **The retirement is real and I initially got this wrong.** `docs/DECISIONS.md:4605-4611` Ruling O-6 retires `stock_locations` "as quantity authority"; BIN-P2 removed every backend reader and BIN-P2R the last client reader (Decision #160 / ADR-014); `firestore.rules:1181-1191` deliberately has **no match block** ("absent means deny-all… Existing documents are inert legacy data"); `functions/src/constants/collections.ts:24-28` records that `STOCK_LOCATIONS_COLLECTION` was **removed** ("There is no second balance table, and adding one back would recreate exactly the divergence that retired this one"). (b) But the **ownership tooling still carries live rows for it** — `ownershipMatrix.ts:328-335`, `ownershipBackfillRules.ts:105`, `ownershipDerivation.ts:~80`, `config/ownership/operating-company-roots.sandbox.json` — and that is a *deliberate* KEEP per `docs/assessments/bin-p2-legacy-inventory-authority-retirement.md:43`. **So the real finding is the split, not the retirement: the ownership model is the last authority in EOS still deriving from a collection retired everywhere else.** (c) The brief's fourth row is misidentified and the span is wrong. The true span is **`:385-417`** and its rows are `inventoryTransaction`, `inventoryAction`, `receivingOrder`, `cycleCount` — **`transfer` is not among them, and is not a family name at all** (the family key is `transferOrder`). `receivingOrder` was omitted from the brief's list. Independently reached by OWN-E2E. `transferOrder` (`:447-459`) derives from `origin/destination.locationId` and never names a stock location. (d) "Those four have no company-inheritance source" is **wrong for three of them**: the *implemented* rules resolve a `locationId` against `rootCompanyById`, built from `ROOT_COLLECTIONS = ["warehouses","mobile_locations"]` (`functions/scripts/ownershipDerivationCheck.js:29`; rules at `ownershipBackfillRules.ts:124-125,154-186`), and the census measures `cycle_counts` 24/24, `receiving_orders` 2/2, `inventory_transactions` 99/103. The matrix *prose* names a source the *code* does not use. The one that genuinely has no source is `inventoryAction` — OD-OWN-006. |
| 9 | Two further rows stale: `:287-296`, `:327-336` | **`:287-296` IS STILL STALE — I disagree with the later coordinator correction and hold this. `:327-336` REFRAMED: not a defect** | See OD-OWN-003. `reorderRequest` (`:287-296`) declares `ownerFields: []` and "MEASURED DESIGN GAP: 6/6 sandbox requests carry no warehouseId. Adding it is a schema change." **That schema change has shipped.** `reorderCommands.ts:91-92` makes `warehouseId` and `operatingCompanyId` required on the built record; `:190` derives the company from the governed Warehouse; `:130-135` **refuses** a client-supplied company (`COMPANY_NOT_CLIENT_SUPPLIABLE`); `:181-185` refuses a warehouse with no company (`WAREHOUSE_NO_COMPANY`); `reorderCallables.ts:177-178` persists both. `reorderPurchaseOrder` (`:425-431`) is stale the same way — `reorderCommands.ts:236,293-297` inherit the company from the request and refuse a caller-supplied one. `stockLocation` (`:327-336`) is not wrong, it is **spent**: its `backfillSource: "warehouseId -- measured 5/5 DERIVABLE"` describes work already applied (census 5/5 RESOLVED), so it reads as pending when it is complete — **not carried as a defect**, in agreement with OWN-E2E. **But `:287-293` is verbatim, at `64008d5a`, still:** `ownerFields: []` · `unresolvedPolicy: "remains OWNERLESS -- measured 6/6 MISSING_REFERENCE, the record cannot say where"` · `note: "MEASURED DESIGN GAP: 6/6 sandbox requests carry no warehouseId. Adding it is a schema change to the reorder request, not a backfill."` — while `reorderCommands.ts:91-92` makes both fields **required** on the built record and `reorderCallables.ts:177-178` persists them. **The schema change the row calls prospective has shipped. The row was not corrected.** See §15. |
| 10 | Ownership handoff has historically been **INERT** | **CONFIRMED WITH ONE EXCEPTION — not activated by this lane** | `ownershipHandoffCommand.ts:8-14` claims inertness on two grounds, and the first is true: nothing in `functions/src/index.ts` reaches it (grep: zero hits). But `stageOwnershipHandoff` **does** have one live caller — the offline operator script `functions/scripts/assignWarehouseRootCompany.js:72,234`. "Inert" is therefore accurate for *callables* and inaccurate for *operator tooling*. See OD-OWN-005. |

### Facts in the brief this lane found wrong or imprecise

| Brief statement | Finding |
|---|---|
| "`ownershipMatrix.ts:392-414` … `transfer` … at `stock_locations`" | The fourth row in that range is `receivingOrder`, not `transfer`. `transferOrder` (`:447-459`) never names a stock location. |
| "`stock_locations`, **which was retired** as operational authority" | **The brief is right and this lane's first pass was wrong.** Retired as *quantity* authority by Ruling O-6 (`docs/DECISIONS.md:4605-4611`), client read removed by BIN-P2R, `firestore.rules:1181-1191` deny-all by absence, constant deleted (`constants/collections.ts:24-28`). The imprecision is only in the words "operational authority": it was retired as the **balance/quantity** authority, and physical on-hand is now `inventory_transactions` (NONE) and `serialized_assets` (SERIAL). Note the **five named docs in the brief's evidence list contain no statement of this retirement** — it lives in `DECISIONS.md`, `firestore.rules`, `constants/collections.ts` and `docs/assessments/bin-p2-legacy-inventory-authority-retirement.md`. |
| "those four have no company-inheritance source" | Three of the four (`cycle_counts`, `receiving_orders`, `inventory_transactions`) have a **working implemented** source resolving against physical roots, and the census measures them 24/24, 2/2 and 99/103 RESOLVED. The one that genuinely has none is `inventoryAction` — see OD-OWN-006. |
| `docs/OWNERSHIP.md` (63) listed as record-ownership evidence | `docs/OWNERSHIP.md` is about **IP / company / product ownership and AI attribution** — Founder, entity formation, trademark, `Co-Authored-By` policy. It contains nothing about record ownership. The record-ownership authority is `docs/specifications/record-ownership.md`. Citing it for this concern is a category error. |
| `salesOrderCommands.ts:287` as the commercial-company call site | Actual site is `salesOrderCommands.ts:274`. (`ownershipMatrix.ts:146` also cites `:287`; both are stale by 13 lines.) |

---

## 2. The five authorities the model is actually spread across

The business ownership model does not live in one place at `64008d5a`. It lives in five authorities that were built at different times against different rulings, and they do not agree.

| # | Authority | Question it answers | Storage | Read at runtime? |
|---|---|---|---|---|
| A1 | `functions/src/ownership/ownershipMatrix.ts` (51 families) | who owns a record, per family | none — it is a declaration | **Barely.** `ownershipFamily()` is read by `ownershipHandoffCommand.ts:89` and `eosCommercial/commercialOwnershipAuthority.ts:116`; `ownableFamilies()` by `ownershipCensus.ts:251`. `participatingCompanyFamilies()`, `transferableFamilies()`, `crossCompanyFamilies()`, `familiesWithoutBackfillSource()` have **zero callers** — dead exports. |
| A2 | `functions/src/ownership/operatingCompanyAuthority.ts` + `commercialCompanyScope.ts` + `reorderRequestLocationAuthority.ts` | which operating company is conducting / bears the obligation | `operatingCompanyId`, `source/destinationOperatingCompanyId`, `companyId` | **Yes, and enforced.** `opportunityCommands.ts:175`, `salesAgreementCommands.ts:304`, `salesOrderCommands.ts:274` (hard refusal), `reorderCommands.ts:190` (hard refusal), `invoiceCommands.ts:132-142,294` (hard refusal). |
| A3 | `functions/src/finance/financialAttribution.ts` (FIN-002) | who gets **sales credit** and which business unit | `creditedSalespersonId`, `businessUnitId`, `attribution.*` snapshot | **Yes.** Composed on every commercial and financial record. Explicitly *not* ownership: `financialAttribution.ts:15-18` — "OWNERSHIP != SALES CREDIT". |
| A4 | `functions/src/finance/financialVisibility.ts` (FIN-004) + `functions/src/access/hierarchicalVisibility.ts` + `roleAssignments` | who may **see** a record | no field on the record; grants live on `roleAssignments` | **Yes.** This is the only visibility authority, and it keys on `creditedSalespersonId` and `companyId` — **never on an owner field.** |
| A5 | `functions/src/reporting/savedDefinitionCommands.ts` | who owns a saved report | `ownerUid` (a Firebase **uid**) | **Yes, and it is the only place an owner field gates access.** `:268,381,404`. |

### The four cross-authority contradictions

| ID | Contradiction | Class |
|---|---|---|
| C-1 | `docs/specifications/record-ownership.md` (2026-08-19) is still the named record-ownership specification and states the **superseded** model: "Whoever creates a record owns it" (`:32`), "the owner always resolves to the actor" and "A create command never accepts an owner from input" (`:~220`). `creationOwnerResolution.ts` implements the **opposite** rule (D-4, 2026-08-30): EXPLICIT → INHERIT GOVERNED UPSTREAM → REFUSE, with the actor explicitly never a fallback (`:12-23`). The spec was never revised. | **AUTHORITY GAP** |
| C-2 | `record-ownership.md:~226` promises "Account transfer moves the owner-scoped visibility of its Contacts and Locations." `ownershipHandoffCommand.ts:24-30` forbids exactly that: "NO CASCADE … Handing off an Account leaves its Opportunities exactly where they were." Contacts and Locations store their **own** `owner` (`ownershipMatrix.ts:128,135`), so an Account handoff moves nothing. | **AUTHORITY GAP** |
| C-3 | Ownership is declared for 51 families and read by nothing that grants or denies anything. Visibility is decided entirely by A3/A4 — sales credit plus role-assignment grants. **Ownership has no visibility effect anywhere in EOS except `reportDefinitions`,** and `reportDefinitions` is the one family the matrix classifies EXCLUDED (`ownershipMatrix.ts:521`). | **ENGINEERING GAP** |
| C-4 | Two owner id namespaces coexist: canonical `employeeId` (`record-ownership.md:§7`; open item O-1 in `docs/assessments/eos-ownership-model-reconciliation.md:218-225`) and Firebase `uid` (`savedDefinitionCommands.ts:331`; also `requestedBy: ctx.actorUid` on reorder requests, `reorderCommands.ts:201`). O-1 is still open, so nothing has ruled which is canonical where. | **MODEL GAP** (O-1) |

---

## 3. Owner type vocabulary as used in this lane

| Value | Meaning | Families |
|---|---|---|
| **PERSON** | one named employee is responsible | Account, Contact, Location, Opportunity, Sales Agreement, Sales Order (6) |
| **COMPANY** | one operating company is responsible | 20 matrix families incl. Work Order, Job, Equipment, Warehouse, Mobile Location, Truck, Reorder Request, PO, Cycle Count, Invoice, Payment (20) |
| **PARTICIPATING COMPANIES** | the shape is two named participants, not one owner | Transfer Order (1) |
| **REFERENCE** | governed, intentionally company-neutral, not an owned business object | Part, Part Alias, Part Supplier Item, Manufacturer, Equipment Model, Supplier Catalog Item, Supplier (7) |
| **NONE** | deliberately not an ownership object: identity, access, audit, coverage, infrastructure | 17 EXCLUDED families incl. Employee, Role Assignment, Saved Report Definition, Audit Event, Sales Territory (17) |

`NONE` here is the matrix's `EXCLUDED`. The mapping is exact; no new value is introduced.

---

## 3.1 THE TIER DISTINCTION THE MATRIX DOES NOT MAKE

`ownerFields` declares *that a field exists*. It does not say whether anything writes it. Three tiers recur across the 51 families, and conflating them is how this model has been misread repeatedly:

| Tier | Meaning | Families |
|---|---|---|
| **LIVE** | a deployed writer sets it on every new record | `opportunities`, `sales_agreements`, `sales_orders` (`operatingCompanyId`); `reorder_requests`, `reorder_purchase_orders` (`operatingCompanyId`); `cycle_counts` (`operatingCompanyId`, `cycleCountSheetRepository.ts:113-128`); `invoices`, `payments`, `refunds`, `invoice_adjustments` (**`companyId`**); `inbound_work_requests` (`operatingCompanyId`); `accounts` (`accountOwner`); `reportDefinitions` (`ownerUid`) |
| **BACKFILL-ONLY** | in the stored-key allowlist and/or the matrix, written **only** by the Owner-authorized 2026-08-30 sandbox backfill; the live create path omits it | `contacts.owner`, `locations.owner`, `trucks.operatingCompanyId`, `equipment.operatingCompanyId` (fixtures only), `receiving_orders.operatingCompanyId`, `inventory_transactions.*`, `transfer_orders.source/destinationOperatingCompanyId` (in `STORED_KEYS` at `inventoryTransfer/transferOrderRepository.ts:94`, **absent from** `serializeTransferOrder` at `:57-84`), `fieldops_jobs.operatingCompanyId`, `stock_locations.operatingCompanyId` |
| **DECLARED, NEVER AUTHORED** | in the type, no writer at all | `warehouses.operatingCompanyId` — `functions/src/types/warehouse.ts:76-79` states "nothing in this repository may author this field yet"; the only path is the offline script `functions/scripts/assignWarehouseRootCompany.js`. `mobile_locations` has no company field at all (`truckRegistryRepository.ts:71-79`) |

**Two consequences the synthesizer must carry forward.**

1. **A non-empty `ownerFields` is not evidence of populated ownership.** `trucks` is the clean case: the matrix keeps `ownerFields: ["operatingCompanyId"]` (`:364`) while the derivation rule was **deleted** (`ownershipBackfillRules.ts:100-121`) and `truckRegistry/truckRegistryCommands.ts` never writes it. The field's two values are backfill residue. Likewise `contacts.owner` / `locations.owner` are set only by `ownershipBackfillRules.ts:96-97`; the live client writers (`field-ops-app-vite/src/domain/contacts.js`, `domain/locations.js`) set no owner at all. **Anything assuming Contact or Location ownership is populated is assuming a backfill.**
2. **A grep for `operatingCompanyId` misses the entire financial tier.** Invoices and payments store the company as **`companyId`**, with `operatingCompanyId` present only *nested* inside `attribution` (`invoiceCommands.ts:292-294,314`). This is why the matrix's financial block reads `ownerFields: []` while the storage is required and live — OD-OWN-008.

## 3.2 OWNERSHIP IS NOT ENFORCED IN FIRESTORE RULES — AT ALL

`firestore.rules` (and its byte-identical copy `field-ops-app-vite/firestore.rules`) contains **zero owner-field predicates**: no `accountOwner`, no `ownerEmployeeId`, no `ownerUid`, no `data.owner`. `operatingCompanyId` appears on five lines and none is an access predicate — `:248,254` place it in a `hasOnly`/`hasAll` key list (field-shape immutability, not authorization) and `:698,1067,1077` are comments.

What Rules *do* enforce, and the distinction matters for every row of Panel E:

| Mechanism | Example |
|---|---|
| static role | `isAdminOrDispatcher()` gates `accounts:1319-1338`, `contacts:1555-1559`, `locations:1341-1345` |
| **own-assignment** | `isOwnTechnician(resource.data.assignedTechId)` (`:508`); `resource.data.technicianId == callerTechnicianId()` (`:363,388`); `resource.data.assignedToUserId == request.auth.uid` (`:661,793,809,849,951,1058,1109`) |
| employee-assignment scope | `isAssignedToWarehouse()` (`:139-150`) reads `employees.assignedWarehouseIds` + `operationalRoles` + `employmentStatus` — **never a company field** |
| operational-role queue | `isActiveOperationalRole("PARTS_MANAGER"/"PARTS_ASSOCIATE")` + `resource.data.status` (`:650-661`) |

**Rules enforce ASSIGNMENT and ROLE. They never enforce OWNERSHIP.** Every governed-ownership collection is `if false` for clients (`opportunities:1740`, `sales_orders:1749`, `sales_agreements:1794`, `invoices:1803`, `payments:1812`, `cycle_counts:1212`, `parts:1632`, `reportDefinitions:1592`), so ownership never needs evaluating there. The one place a real ownership check runs anywhere in EOS is `savedDefinitionCommands.ts:268,381` on `ownerUid`.

## 3.3 THE MATRIX IS OFFLINE GOVERNANCE TOOLING, NOT A RUNTIME CONTRACT

`functions/src/index.ts` (87 exports) contains **zero** ownership references. `ownershipHandoffCommand` is imported only by `functions/scripts/assignWarehouseRootCompany.js` and tests; `ownershipCensus` only by `functions/scripts/ownershipCensusDryRun.js` and tests. The only ownership modules on a deployed path are `operatingCompanyAuthority.ts`, `commercialCompanyScope.ts` and `creationOwnerResolution.ts`. `functions/src/eosCommercial/commercialOwnershipAuthority.ts` reads `ownershipFamily()`, but its only importer — `commercialOwnershipRepository.ts` (Postgres-backed) — has no importers of its own.

This is the most load-bearing framing in this lane: **the ownership matrix is the clearest statement of intent in the repository and nothing deployed reads it.**

---

## 3.4 THE PERSON AXIS HAS NO REFERENTIAL INTEGRITY. THE COMPANY AXIS DOES.

This asymmetry is not documented anywhere in the matrix and it invalidates the plain reading of every `RESOLVED` count on a PERSON-owned family.

| Derivation | What it validates | What it does **not** |
|---|---|---|
| `deriveAccountOwner` (`typedOwner.ts:95-109`) | that `accountOwner` is a map, that `assignedToEmployeeId` is a non-empty string, and that the string is a usable id **shape** | **it never reads the `employees` collection** |
| `deriveEmployeeRefOwner` (`typedOwner.ts:112-125`) | that `ownerEmployeeId` is a non-empty string of usable id shape | **it never reads the `employees` collection** |
| `deriveCompanyOwner` (`typedOwner.ts:131-144`) | resolves the value through `resolveOperatingCompany`, distinguishing `INVALID` (malformed) from `UNKNOWN` ("names no seeded company") from `INACTIVE` | — it is genuinely referential |

**Consequence:** a record whose `ownerEmployeeId` names a **terminated, deleted or never-existent employee censuses as `RESOLVED`.** The census's 100/103 accounts, 337/339 contacts, 180/183 locations, 14/14 opportunities, 5/5 agreements and 17/17 sales orders are **shape-valid, not referentially valid.** By contrast `deriveCompanyOwner` would report `UNKNOWN` for an unseeded company and deliberately resolves `INACTIVE` ("a record owned by a since-deactivated company still HAS an owner, and calling it unresolved would invite a backfill to reassign it", `:127-129`).

So the correct reading of Panel A's OWNER STORAGE column for the six PERSON families is: **storage exists and cannot be trusted to point at a live employee.** This is the mechanism behind MG-5 — employee deactivation has no ownership consequence *because nothing on the ownership path ever looks an employee up.* → classified **ENGINEERING GAP (EG-11)**, since the model's answer is clear and the validation is missing.

## 3.5 THE PRECEDENT FOR A SECOND AXIS ALREADY EXISTS — ON THE COMPANY AXIS ONLY

Recorded as precedent, **not** as a proposal. Two mechanisms in this codebase already show how a second independent fact can be added to a record without rewriting a historical one:

1. **`companyScopeField`** (`ownershipMatrix.ts:86-96`). One record carries two true, independent facts: `ownerEmployeeId = Rudy` (who is responsible commercially) and `operatingCompanyId = taylor` (whose books it lands in). The column's own comment is explicit that "This column is NOT ownership" and exists "so the financial lineage Sales Order → Invoice → Payment can inherit a company without anyone concluding the company displaced the salesperson."
2. **Ruling R-20's accept-in-storage / refuse-in-assignment asymmetry** (`warehouseRootCompanyAssignment.ts:39-45`): "Storage validity and assignment eligibility are different questions. A warehouse may legitimately keep carrying the id of a company that later went inactive — that is history, and this command never rewrites it. But creating a NEW operating relationship with an already-inactive company is refused… deliberately and not by oversight."

Together these are the shape an accountability axis would take if one were ever ruled: a second column that is explicitly not ownership, tolerant in storage, strict at assignment, and inherited rather than inferred. **This lane cites the pattern and proposes nothing.** Whether an accountability axis exists at all is MI-1, and designing it is `EMP-ACCOUNTABILITY`'s lane.

---

## 4. The family × 19-attribute matrix

19 columns (OBJECT + 18 attributes), split into five readable panels over the same 25 rows. `Mobile Location/Truck` is split because the two matrix families answer differently. All line references are `64008d5a`.

### 4.1 Panel A — OWNER

**‡** OWNER TRANSFER RULE, uniformly: **handoff is inert for all 14 HANDOFF-capable families** (`account`, `contact`, `location`, `opportunity`, `salesAgreement`, `salesOrder`, `workOrder`, `workOrderLegacy`, `reorderRequest`, `warehouse`, `mobileLocation`, `truck`, `supplierCompanyTerms`, `equipment`), and **the one live owner-change control in the product bypasses the authority entirely.** `updateOpportunity` accepts `ownerEmployeeId` in its patch vocabulary (`opportunityCommands.ts:244`), refuses an empty value (`OWNER_REQUIRED`, `:312-315`) and on change calls the generic `record()` helper (`:302-306,316-317`), which pushes a `{field, before, after}` entry into an `OpportunityFieldChange[]`. The module contains **no reference to `OWNERSHIP_HANDOFF` or `stageOwnershipHandoff`**. So an Opportunity owner change files as an ordinary field edit, not as an ownership handoff — the audit trail of the one ownership move EOS can actually perform is in the wrong vocabulary. → **AUTHORITY GAP (AG-12)**.

**†** Every PERSON row carries the §3.4 caveat: the storage exists and is **shape-validated only**. Nothing on the ownership path reads the `employees` collection, so a row reading `PERSON` does not warrant that a live employee is on the other end.

| OBJECT | RECORD OWNER TYPE | OWNER STORAGE / SOURCE | OWNER CREATION RULE | OWNER TRANSFER RULE |
|---|---|---|---|---|
| Account | PERSON † | `accountOwner` — a **7-key Person Assignment map**, not a scalar: `assignedToEmployeeId`, `assignedToUserId`, `assignedToDisplayName`, `assignedByEmployeeId`, `assignedByUserId`, `assignedByDisplayName`, `assignedAt`; partial records are rejected (`field-ops-app-vite/src/domain/commercialProfile.js:206-216`). Projected by `typedOwner.ts:95-109` (`ownershipMatrix.ts:120`) | **EXPLICIT ONLY.** `inheritanceSource: null` (`:120`). D-6 forbids creator, territory, coverage, activity, sales history, auth uid (`:122`). An ownerless Account makes inherited Opportunity creation REFUSE by design (`:124`) | HANDOFF (`:120`) — declared, INERT, **no cascade** to Contacts/Locations/Opportunities (`ownershipHandoffCommand.ts:24-30`) |
| Contact | PERSON | `owner` as a typed `{type:"USER",id}` map (`ownershipMatrix.ts:128`) — **BACKFILL-ONLY**: set only by `ownershipBackfillRules.ts:70-79,96`; `field-ops-app-vite/src/domain/contacts.js` never sets it | INHERIT parent Account owner at creation; PROTECTED (not substituted) when the Account has none (`ownershipBackfillRules.ts:77`) | HANDOFF (`:128`) — INERT |
| Location | PERSON | `owner` typed map (`:135`) — **BACKFILL-ONLY** (`ownershipBackfillRules.ts:97`); `domain/locations.js:18-24` sets no actor and no owner. **A CUSTOMER site**, distinct from warehouses (`:139`) | INHERIT parent Account owner (`:136`) | HANDOFF (`:136`) — INERT |
| Opportunity | PERSON | `ownerEmployeeId` (`:149`) | **EXPLICIT → INHERIT Account owner → REFUSE** (`creationOwnerResolution.ts:59-80`, wired at `opportunityCommands.ts`). Actor/createdBy/assignedTo/admin/first-available all forbidden (`creationOwnerResolution.ts:12-23`) | HANDOFF (`:149`) — INERT |
| Sales Agreement | PERSON | `ownerEmployeeId` (`:158`) | EXPLICIT → INHERIT Opportunity owner → REFUSE | HANDOFF (`:158`) — INERT |
| Sales Order | PERSON | `ownerEmployeeId` (`:168`) | EXPLICIT → INHERIT Opportunity owner → REFUSE, **and** a separate hard `COMPANY_REQUIRED` refusal (`salesOrderCommands.ts:274-283`) | HANDOFF (`:168`) — INERT |
| Work Order (`fieldops_wos`) | COMPANY | **NONE. `ownerFields: []`** (`:251`). Measured 0/30 (`sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.txt`) | Declared "explicit at creation, or a governed upstream source that already carries one (e.g. a Sales Order)" (`:252`) — **but there is no field to write it to.** 11/30 carry a `salesOrderId` and are *potentially* derivable, unmeasured (`:255`) | HANDOFF declared (`:253`) over storage that does not exist — the handoff command would accept this family and there is nothing to move |
| Service Visit / Job (`fieldops_jobs`) | COMPANY | `operatingCompanyId` (`:269`) — real storage, 41/45 measured | Explicit at creation, or the governed upstream service/commercial source company (`:269`). Never technician / dispatcher / createdBy / assignedTo (`:259-262`) | HANDOFF (`:270`) — INERT |
| Equipment | COMPANY | `operatingCompanyId` (`:462`) — **BACKFILL-ONLY and fixture-only** (`ownershipBackfillRules.ts:129-138`). Held **DISTINCT** from `explicitTitleHolder` (`:466`; `inventoryControlLifecycle.ts:79`) and from `accountId`, which is the **CUSTOMER** — neither is an owner | **EXPLICIT ONLY.** `backfillSource: null` (`:465`) — every candidate on the record (customer, title holder, location name, model, manufacturer, serial prefix) is a prohibited proxy. Backfill touched only authored fixtures (`ownershipBackfillRules.ts:129-141`) | HANDOFF (`:462`) — INERT |
| Part | **REFERENCE** | **NONE, deliberately** (`:489`). Both operating companies may legitimately use the same part number (`:471-474`) | N/A — not ownable by classification (`NOT_OWNABLE`, `:113`) | `N_A` (`:491`) — handoff refuses with `FAMILY_NOT_OWNABLE` (`ownershipHandoffCommand.ts:110-115`) |
| Warehouse | COMPANY | **DECLARED, NEVER AUTHORED.** Matrix says `ownerFields: []` (`:318`); the type declares `operatingCompanyId?` and states "nothing in this repository may author this field yet" (`functions/src/types/warehouse.ts:76-79`). Measured 0/5 | `inheritanceSource: "none -- this IS the root"` (`:319`). Source is explicit governed configuration, Owner-supplied per site, **never the display name** (`:321`) | HANDOFF (`:320`) — and this is the one family with a live handoff path: `functions/scripts/assignWarehouseRootCompany.js:234` |
| Mobile Location (`mobile_locations`) | COMPANY | **NONE — no company field exists at all.** `ownerFields: []` (`:318`); `truckRegistry/truckRegistryRepository.ts:71-79` writes none. Measured 0/7 | `"none -- this IS the root"`; explicit governed configuration (`:321`). Deliberately **no** backfill rule (`ownershipBackfillRules.ts:122-123`) | HANDOFF (`:320`) — INERT |
| Truck (`trucks`) | COMPANY | `operatingCompanyId` (`:364`) — **BACKFILL RESIDUE ONLY.** 2/2 stored by the applied sandbox backfill; the rule that produced them was **deleted** (`ownershipBackfillRules.ts:100-121`) and `truckRegistryCommands.ts` never writes it. **The matrix OVERSTATES this row** | **EXPLICIT governed configuration for the vehicle — NOT its home warehouse** (`:365`). `backfillSource: null` (`:368`). The derivation was deleted, not corrected, because `cert-trk-04/05` are `ventana` vehicles homed at a `taylor` warehouse (`ownershipBackfillRules.ts:100-121`) | HANDOFF (`:366`) — INERT |
| Purchase Order (`purchase_orders`) | COMPANY | **NONE, and stated explicitly in code:** "No company field exists on this shape. Null is the true statement" (`purchasing/purchaseOrderNormalization.ts:253-255`). Matrix `ownerFields: []` (`:419`). Census scans 0 records | "the buying company" (`:419`); `backfillSource` marked "to be confirmed against purchasing semantics" (`:421`) — **unsettled** | `IMMUTABLE` (`:419`) — handoff refuses with `FAMILY_IMMUTABLE` |
| Reorder Request | COMPANY | **MATRIX SAYS `[]` (`:288`) — THAT IS STALE.** Actual storage is `warehouseId` + `operatingCompanyId`, both required on the built record (`reorderCommands.ts:91-92`), persisted at `reorderCallables.ts:177-178` | **DERIVED from the governed Warehouse at trusted creation, then STORED** (`reorderCommands.ts:190`). A client-supplied company is **REFUSED** `COMPANY_NOT_CLIENT_SUPPLIABLE` (`:130-135`); a warehouse with no company is **REFUSED** `WAREHOUSE_NO_COMPANY` (`:181-185`) | HANDOFF (`:289`) — INERT |
| Transfer Order | **PARTICIPATING COMPANIES** | `sourceOperatingCompanyId` + `destinationOperatingCompanyId` as `participatingFields`, deliberately **not** `ownerFields` (`:449-451`; `:78-83`) — **BACKFILL-ONLY**: in `STORED_KEYS` (`inventoryTransfer/transferOrderRepository.ts:94`) but **absent from** `serializeTransferOrder` (`:57-84`), so no live create writes them; both-or-neither is enforced at `:107-110` | The governed source and destination location authorities (`:452`). BOTH participants or nothing (`ownershipBackfillRules.ts:196-205`). "Source always owns it" and "destination always owns it" were both **rejected** (`:440-443`) | **`N_A`** (`:453`). The handoff command **refuses this family** with its own code `FAMILY_PARTICIPATING_COMPANIES` (`ownershipHandoffCommand.ts:101-106`): changing participants is transaction-domain state, not an ownership handoff |
| Cycle Count | COMPANY | `operatingCompanyId` (`:412`) — 24/24 measured | The counted location's company, resolved against a physical **root** (`ownershipBackfillRules.ts:124`) — *not* a stock location, despite the matrix prose at `:414` | `IMMUTABLE` (`:412`) |
| Invoice | COMPANY | **MATRIX SAYS `[]` (`:182`) — THAT IS WRONG.** `InvoiceRecord.companyId: string` is **required** (`invoiceCommands.ts:214`) and written at `:294`, with the structural invariant `companyId === attribution.operatingCompanyId` (`:292-293`) | The governed Sales Order's `operatingCompanyId`. Caller `companyId` is **assertion-only**; a mismatch is refused `COMPANY_MISMATCH` (`:138-142`) and a companyless SO is refused `COMPANY_REQUIRED` (`:132-135`) | `IMMUTABLE` (`:186`) — historical ownership stays historical |
| Payment | COMPANY | **MATRIX SAYS `[]` (`:182`) — WRONG.** `companyId` is stored (`paymentCommands.ts:35,53`) | Inherited from the governed **Invoice**; caller `companyId` assertion-only (`paymentCommands.ts:93-94`). Same shape for `refunds` (`refundCommands.ts:38,80,92`) and `invoice_adjustments` (`adjustmentCommands.ts:47`) | `IMMUTABLE` (`:186`) |
| Report (a report *run*) | **NONE — no record exists** | No collection. A run is an audit action (`runReportDefinition`, `exportReportDefinition`) and a `FINANCIAL_SOURCE_TYPES` lineage token, never a persisted owned object | N/A | N/A |
| Saved Report Definition | **MATRIX SAYS NONE (EXCLUDED, `:521`). IMPLEMENTATION SAYS PERSON.** | `ownerUid` — a Firebase **uid**, not an `employeeId` (`savedDefinitionCommands.ts:110,331,503`) | **THE CREATOR CLAIMS IT.** `ownerUid: params.actorUid` (`:331,503`), never client-supplied (`:31-32`). This is the one family where the actor *does* become owner | **NONE EXISTS.** No transfer command, no share command. `shareReportDefinition` exists only in the audit-action vocabulary (`auditEventWriter.ts:297`) with no implementation. Ownership is permanent and non-transferable |
| Employee | **NONE** (EXCLUDED, `:512`) | "person authority — a subject of ownership, not an object" (`:512`) | N/A — deliberate | `N_A` (`:532`) |
| Role Assignment | **NONE** (EXCLUDED, `:518`) | "access authority, governed separately" (`:518`) | N/A — deliberate | `N_A` (`:532`) |
| Approval / Exception | **NO MATRIX FAMILY — BUT APPROVAL RECORDS DO EXIST, FRAGMENTED ACROSS SIX SURFACES** | No collection and no subcollection anywhere (zero nested `match` blocks in `firestore.rules`). The six surfaces: `ApprovalRecord` (`finance/financialApprovals.ts:15-20,67-85`) over `APPROVABLE_ACTION_TYPES` = `INVOICE_ADJUSTMENT`/`WRITE_OFF`/`REFUND`/`PLAN_APPROVAL`/`ATTRIBUTION_CORRECTION`; `accessRequests.ApprovalPolicy{requiresApproval, approverConstraint}` (`types/access.ts:181-205`); `roleAssignments.approvedBy` (`:171`); `data_import_jobs.approvedBy/approvedAt` (`dataImport/importJob.ts:109-110`); `performance_goals.approvedByUid` (`performance/performanceGoal.ts:110-111`); `financialPolicyProfile.approval.approvedBy` (free text, `:246-327`) | `decidedByUid` is the approver. **Self-approval is forbidden unconditionally — "no policy input can re-enable it"** (`financialApprovals.ts:~86`), and `performanceGoal.ts:232-243` refuses it too | None — an approval is a decision record, not a transferable object |
| Inbound Work (`inbound_work_requests`) | **UNCLASSIFIED — ABSENT FROM THE MATRIX** | No owner field. **But it carries a governed `operatingCompanyId`** (`inboundIntakeCommand.ts:279`), from the routing-rule outcome or the mailbox default | `operatingCompanyId` comes from `routing.outcome.operatingCompanyId ?? mailbox.operatingCompanyId ?? null` — a **configuration** derivation with no counterpart anywhere in the matrix | None. The family is not in the allow-list, so a handoff would be refused `FAMILY_UNKNOWN` (`ownershipHandoffCommand.ts:89-95`) |

### 4.2 Panel B — ACCOUNTABILITY AND ASSIGNMENT

The distinction this panel holds: **ACCOUNTABLE** = the person answerable for the outcome; **ASSIGNEE/EXECUTOR** = the person who does the work. EOS has almost no storage for the former.

| OBJECT | ACCOUNTABLE PERSON | ACCOUNTABILITY SOURCE | ASSIGNEE / EXECUTOR | ASSIGNMENT SOURCE |
|---|---|---|---|---|
| Account | = the owner. No separate field | `accountOwner.assignedToEmployeeId`. The nearest distinct fact is `accountOwner.assignedByEmployeeId` + `assignedAt` (`record-ownership.md:46`) — who *assigned*, not who is *accountable* | NONE — an Account has no executor | — |
| Contact | = the owner (inherited) | `owner` | NONE | — |
| Location | = the owner (inherited) | `owner` | NONE | — |
| Opportunity | = the owner | `ownerEmployeeId` | NONE stored | — |
| Sales Agreement | = the owner | `ownerEmployeeId` | NONE stored | — |
| Sales Order | **TWO CANDIDATES, DELIBERATELY SEPARATE** | `ownerEmployeeId` (ownership) **and** `creditedSalespersonId` (sales credit, FIN-002). `financialAttribution.ts:15-18` insists they are different questions | NONE stored on the order | — |
| Work Order | **NOT STORED — MODEL GAP.** The declared owner is a COMPANY; no person is accountable on the record | none | `assignedTechId` (dispatch) and `scheduledTechId` (planning) — **two distinct fields, neither ownership** (`types/workOrder.ts:107,122`) | Dispatch / Scheduler. Reassignment is denormalized as `reassignedFromTechId` / `reassignedAt` / `reassignedReason` with the durable record in a **`reassignWorkOrderTechnician` audit event** (`types/workOrder.ts:139-147`) — a *different* action from `OWNERSHIP_HANDOFF` (`auditEventWriter.ts:256`). **This is the code-level proof that reassignment ≠ ownership transfer** |
| Service Visit / Job | **NOT STORED — MODEL GAP** | none | `assignedTechId` — "assignedTechId remains ASSIGNMENT" (`ownershipMatrix.ts:272`) | Dispatch |
| Equipment | **NOT STORED** | none. `explicitTitleHolder` is legal title, not accountability | NONE | — |
| Part | **NONE, deliberate** (REFERENCE) | — | NONE | — |
| Warehouse | **NOT STORED — MODEL GAP.** No site manager, no responsible person | none | NONE | — |
| Mobile Location | **NOT STORED** | none | NONE | — |
| Truck | **`assignedDriverEmployeeId` EXISTS** (`truckRegistry/validation.ts:34`) — nullable, and explicitly **not custody**. It is the closest thing in EOS to a named person accountable for a non-commercial asset, and it is not wired to ownership, escalation or visibility | `assignedDriverEmployeeId` — stored, unread by any authority | the driver; plus indirect custody via `location_truck_claims` (EXCLUDED infrastructure, `:524`) | truck registry; claim records |
| Purchase Order | **NOT STORED** | none | NONE | — |
| Reorder Request | **NOT STORED as accountability.** Three separate person/role facts exist and none is accountability | `requestedBy` = **the actor** (`reorderCommands.ts:200-201`: "The ACTOR. Deliberately not the owner") | `assignedToUserId` (processor, per D-14) | the reorder workflow, unchanged client-direct path |
| Transfer Order | **NOT STORED** — and by design: the shape is two companies | none | NONE stored | — |
| Cycle Count | **NOT STORED** | none | counter/assignee fields exist in the cycle-count domain, outside the ownership model | cycle-count sheet domain |
| Invoice | **NOT A PERSON.** COMPANY-owned by ruling D-15 | `companyId` | NONE — an invoice is not executed | — |
| Payment | **NOT A PERSON** (D-15) | `companyId` | NONE | — |
| Report | N/A | — | N/A | — |
| Saved Report Definition | = `ownerUid` (the creator) | `ownerUid` (`savedDefinitionCommands.ts:331`) | NONE | — |
| Employee | **NONE, deliberate.** An Employee is the *subject* of accountability | — | — | — |
| Role Assignment | **NONE, deliberate** (access authority) | — | — | — |
| Approval / Exception | `decidedByUid` / `approvedBy` / `approvedByUid` — **six different field names across six surfaces**, no shared vocabulary | the six surfaces above. `approverConstraint` on `accessRequests` is the only *typed* accountability constraint in EOS: `distinctFromRequester` / `platformAdmin` / `companyAdmin` (`types/access.ts:181-205`) | `requestedByUid` / `requestedBy` — the requester, never the approver | the requesting command |
| Inbound Work | `decisionBy` = the reviewer who accepted/declined/attached (`inboundDecisionCommands.ts:188,258,315`) — an **after-the-fact** actor record, not a pre-assigned accountable person | `decisionBy` (a uid) | NONE before decision. The record sits in a `queue` until someone acts | `queue` from `routing.outcome.queue ?? mailbox.defaultQueue` (`inboundIntakeCommand.ts:276`) |

### 4.3 Panel C — ESCALATION AND STEWARDSHIP

**Three findings apply to every row and are stated once here rather than repeated 25 times.**

**(0) EVERY ROLE-VALUED QUEUE IN THIS PANEL MAY BE EMPTY IN PRODUCTION.** OWN-E2E reports role occupancy as **measured: production zero assignments; sandbox 86 across 30 roles.** I could not locate the artifact behind that at `64008d5a` (UP-10) and this lane performs no live reads, so it is recorded as measured-per-OWN-E2E rather than restated as mine. **If it holds, `currentOwner`, `queue`, `roleKeys` and `requiresOwnAssignment` are inert in production for want of occupants, not for want of mechanism** — a materially different diagnosis from every other gap in this document, and the only one that a grant rather than a design would close.

**(i) No EOS family stores an escalation owner.** Repo-wide, `escalat*` appears only in governance prose (`docs/OWNERSHIP.md:63`, `docs/DelegationCharter.md`, `docs/PlatformOperatingModel.md` — escalation *to the Owner* as an AI-agent boundary) and in deploy-gate scripts. There is no escalation field, no escalation target, and no escalation timer on any business record. → **MODEL GAP**, uniform.

**(ii) The manager edge EXISTS but nothing routes on it.** `managerEmployeeId` is a real, governed, relationally-validated field on `employees`: declared `{ key: "managerEmployeeId", kind: "MANAGER" }` at `functions/src/access/employeeProfileCommands.ts:214`, and the update command *reads the referenced employee inside its transaction* to prove it exists (`:498-515`). Its spec home is `docs/specifications/administration-users-consolidation.md:206-209` (**not** `employee-foundation.md`, whose schema at `:91-110` omits it — a lane reading only that spec would wrongly conclude no manager field exists). But the field has **zero authorization, visibility or routing readers** — the only other references are display metadata (`field-ops-app-vite/src/domain/employeeProfile.js:84`, `src/metadata/definitions/employee.js:225`). So "escalate to their manager" has storage and no mechanism. → **ENGINEERING GAP**, not a model gap.

**(iii) MANAGER is answered twice, in opposite directions, at this baseline.** `functions/src/access/roleHierarchy.ts:9-20` states the hierarchy deliberately lives on the **Role**, not per employee: "the Owner named `reportsTo` on the employee as a NICE TO HAVE — a later refinement… It is deliberately not modelled yet", with the stated consequence "**With role-only hierarchy, EVERY salesManager sees EVERY salesperson.**" Meanwhile `employeeProfileCommands.ts:214` stores exactly that per-employee edge. Any escalation rule resolving to "their manager" inherits this contradiction. → **AUTHORITY GAP**.

**(iv) There is no DOMAIN STEWARD anywhere, and no vocabulary one could be stored in.** "steward" appears in no doc and no module. The candidate stores are both unusable as authority: `jobTitle` is **free text** (`employeeProfileCommands.ts:213`, `kind: "TEXT"`), and `operationalRoles` is a closed 8-value list (`:131-140` — `PARTS_MANAGER`, `PARTS_ASSOCIATE`, `TECHNICIAN`, `WAREHOUSE_MANAGER`, `WAREHOUSE_ASSOCIATE`, `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE`) of which `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE` and `WAREHOUSE_ASSOCIATE` have essentially no consumer. The separate security-Role set is **48** — 45 in `functions/src/access/governedBusinessRoles.ts` plus `admin`/`dispatcher`/`technician` in `compatibilityRoles.ts:16` (that file's own header at `governedBusinessRoles.ts:61` still says "eight governed business" and is stale; cite the code, never the header). **Where a family's steward or accountability source would naturally be a role, EOS has no authoritative role vocabulary to store it in.** → **MODEL GAP**, uniform across every row below.

| OBJECT | ESCALATION OWNER | ESCALATION RULE | DOMAIN STEWARD |
|---|---|---|---|
| Account | NOT STORED | none. Would resolve through owner → `managerEmployeeId`, which nothing reads (ii) | NOT STORED (iv). Accounts are curated by whoever holds `crm` capabilities; no steward concept |
| Contact | NOT STORED | none | NOT STORED (iv) |
| Location | NOT STORED | none | NOT STORED (iv) |
| Opportunity | NOT STORED | none | NOT STORED (iv) |
| Sales Agreement | NOT STORED | Workflow-level only: `SALES_AGREEMENT_WORKFLOW` (`workflowSeeds.ts:243`) gates transitions by `roleKeys` + `capabilityId`. That is authorization, not escalation | NOT STORED (iv) |
| Sales Order | NOT STORED | Workflow-level only (`SALES_ORDER_WORKFLOW`, `workflowSeeds.ts:260`) | NOT STORED (iv) |
| Work Order | NOT STORED | **The closest thing in EOS, and it is not escalation:** `transitionEngine.ts:129-140` gates each transition on `roles` + `requiresOwnAssignment`. Dispatcher-held transitions (`MarkReady`/`Schedule`/`Dispatch`/`Close`/`Cancel`) are `requiresOwnAssignment: false`; technician transitions (`Accept`/`Travel`/`Arrive`) are `true`. A dispatcher acting on a technician's Work Order is **role authority, not escalation and not an ownership transfer** | NOT STORED (iv) |
| Service Visit / Job | NOT STORED | none | NOT STORED (iv) |
| Equipment | NOT STORED | none | NOT STORED (iv). Master-data curation of `equipment_models` (REFERENCE) has no owner |
| Part | **NONE — deliberate.** A REFERENCE record has no owner to escalate past | N/A | **NOT STORED — and this is the sharpest instance of (iv).** Parts are the canonical shared-master-data case (`ownershipMatrix.ts:471-474`) and are exactly what a steward would govern. Classification `REFERENCE` correctly says "no *business owner*"; it does not say "no *curator*", and no curator exists |
| Warehouse | NOT STORED | none. R-29-style `{type:"location"}` RoleAssignment scope bindings exist (`reorderWarehouseAuthority.ts:24,160`) but they are access grants, not escalation | NOT STORED (iv) |
| Mobile Location | NOT STORED | none | NOT STORED (iv) |
| Truck | NOT STORED | none | NOT STORED (iv) |
| Purchase Order | NOT STORED | none | NOT STORED (iv) |
| Reorder Request | **A ROLE QUEUE, NOT A PERSON.** `currentOwner` holds a role token, never an employee id: `"INVENTORY"` at creation (`reorderCommands.ts:198`), handed to `PARTS_MANAGER` on approval and `PARTS_ASSOCIATE` on assignment (`field-ops-app-vite/src/domain/inventoryReorderRequests.js:215,235`, which states "`currentOwner` stays role-level") | **The one real escalation ladder in EOS, and it is a STATUS ladder:** `PENDING_REVIEW → READY_FOR_PARTS_MANAGER → ASSIGNED_TO_PARTS_ASSOCIATE → PURCHASING_IN_PROGRESS → ORDERED → RECEIVED`, each transition gated by capability + `roleKeys` (`workflowSeeds.ts:119-145`). `startPurchasing` carries `requiresOwnAssignment: true` (`:134`). **Not ownership:** D-14 keeps `currentOwner`, `requestedBy` and `assignedToUserId` all separate from the COMPANY owner | NOT STORED (iv) |
| Transfer Order | **NONE — deliberate.** There is no single owner to escalate past; the shape is two participants | N/A | NOT STORED (iv) |
| Cycle Count | NOT STORED | Cycle-count domain has its own count/recount/variance-approval steps outside the ownership model | NOT STORED (iv) |
| Invoice | NOT STORED | none. Correction runs through FIN-007 attribution-adjustment events, not escalation (`financialAttribution.ts:20-22`) | NOT STORED (iv) |
| Payment | NOT STORED | none | NOT STORED (iv) |
| Report | N/A | N/A | N/A |
| Saved Report Definition | **NONE, AND THIS IS A LIVE PROBLEM.** `ownerUid` is the only gate (`savedDefinitionCommands.ts:268,381,404`) and there is no transfer, no share and no admin override path in the command module | **On employee deactivation the definition becomes unreachable by everyone.** This is open question 3 of `docs/specifications/record-ownership.md:~255` ("their owned records need to go somewhere… the most likely way the model rots in practice"), still unanswered | N/A |
| Employee | **`managerEmployeeId` — the only manager edge in EOS** (`employeeProfileCommands.ts:214`) | Stored, validated, **never read for routing** (ii); contradicted by `roleHierarchy.ts:9-20` (iii) | N/A — an Employee is the subject |
| Role Assignment | NOT STORED | `accessRequests` is the request/decide path (EXCLUDED, `ownershipMatrix.ts:520`) | N/A |
| Approval / Exception | **NOT STORED** | Threshold-based, not person-based: `ApprovalPolicyLine{actionType, requiresApproval, thresholdMinor}` (`financialApprovals.ts:~33-40`) decides *whether* approval is needed, never *who*. `accessRequests`' workflow and UI are explicitly **deferred** (`types/access.ts:193-197`). A rejection is terminal and `assertActionApproved` refuses quiet re-attempts | N/A |
| Inbound Work | **A QUEUE, NOT A PERSON.** `queue` from `routing.outcome.queue ?? mailbox.defaultQueue ?? null` (`inboundIntakeCommand.ts:276`) | **A status-level escalation exists:** `NEEDS_REVIEW` — "Routing demanded manual review, or thread association was ambiguous. **Same queue, louder**" (`inboundWorkModel.ts:35-36`); `QUARANTINED` is refusal before review (`:45-46`). No person, no timer, no target | NOT STORED (iv) |

### 4.4 Panel D — TIME AND OPERATING COMPANY

| OBJECT | HISTORICAL RULE | FUTURE-RECORD RULE | OPERATING-COMPANY RELATION |
|---|---|---|---|
| Account | Ownerless historical records **stay ownerless**; not retroactively attributed to whoever created them (`record-ownership.md:§6`). R-7 keeps 3 non-fixture Accounts deliberately ownerless as control records | EXPLICIT assignment required; creation of a dependent Opportunity REFUSES rather than defaulting (`ownershipMatrix.ts:124`) | **NONE — and deliberately so.** `COMPANY_NEUTRAL`, no company field. R-15: "a Customer must NOT carry a single operating company just to make this chain resolve" (`commercialCompanyScope.ts:16-19`). A customer may span Taylor and Ventana |
| Contact | stays ownerless if the parent Account is ownerless — propagated, never substituted (`ownershipBackfillRules.ts:77`) | INHERIT at creation | **NONE, deliberate.** No company field and **no derivation path at all** — the parent Account has none to inherit |
| Location | same as Contact | INHERIT at creation | **NONE, deliberate** (customer site) |
| Opportunity | measured 14/14 resolved; `backfillSource: null` | EXPLICIT → INHERIT → REFUSE | `companyScopeField: "operatingCompanyId"` (`:148`) — the **entry point** of the commercial company axis. EXPLICIT ONLY at this hop (`opportunityCommands.ts:175` passes no inherited value) |
| Sales Agreement | 5/5 resolved | EXPLICIT → INHERIT → REFUSE | `companyScopeField` (`:157`); EXPLICIT or INHERITED from the Opportunity (`salesAgreementCommands.ts:304`) |
| Sales Order | 17/17 resolved | company is **hard-required** at creation | `companyScopeField` (`:167`) — the axis's load-bearing hop, since every financial artifact downstream inherits from it. `COMPANY_NEUTRAL` in the matrix yet `COMPANY_REQUIRED` in code (`salesOrderCommands.ts:274-283`) |
| Work Order | 0/30, reason "family has no ownership storage yet" — a **company-provenance gap, explicitly NOT a lineage defect** (`ownershipMatrix.ts:254`; R-12 withdrawn by DECISIONS #143) | Declared as explicit-or-inherited; unimplementable without storage | **NO COMPANY FIELD AT ALL.** 11/30 carry `salesOrderId` and would become derivable *if* the field existed and the SO company were read at creation — **UNPROVEN, to be measured** |
| Service Visit / Job | 41/45 resolved; the 41 are authored certification fixtures (R-11), the 4 non-fixture stay unresolved | explicit or governed upstream | `operatingCompanyId` stored, historical fact. Never from technician/dispatcher/createdBy/assignedTo |
| Equipment | 278/288; the 10 non-fixture records are **never overwritten** (R-2) | EXPLICIT only | `operatingCompanyId`, distinct from `explicitTitleHolder`. No mass assignment |
| Part | N/A — not ownable | N/A | **COMPANY-NEUTRAL BY DESIGN.** Both companies may use the same part. No default to Taylor (D-11) |
| Warehouse | 0/5 — awaiting the Owner's root assignments | explicit governed configuration per site | **THE COMPANY BOUNDARY ROOT.** `config/ownership/operating-company-roots.sandbox.json` authors them and forbids inference in its own header |
| Mobile Location | 0/7 | explicit governed configuration per vehicle | the second root. Deliberately no backfill rule |
| Truck | 2/2 stored by the applied backfill; the **licence** to derive was withdrawn, the two stored values kept (`ownershipMatrix.ts:369`) | explicit configuration for the vehicle | a truck **works out of** a depot; it does not belong to the depot's company. `cert-trk-04/05` settle it |
| Purchase Order | `IMMUTABLE`; 0 records exist | "the buying company" | single-company by ruling. `reorder_purchase_orders` **REFUSES** a PO mixing companies: `PO_MIXED_COMPANY` (`reorderRequestLocationAuthority.ts:86-92`) — "two companies' obligations in one document would be a single legal commitment nobody owns" (`:79-81`) |
| Reorder Request | matrix records 6/6 MISSING_REFERENCE — **superseded by the shipped schema**; historical requests still carry nothing | company **derived from the governed Warehouse at trusted creation, then STORED** — materialized precisely so a later warehouse reassignment cannot rewrite a historical obligation (`reorderRequestLocationAuthority.ts:23-26`) | `operatingCompanyId`, derived, client-supply refused |
| Transfer Order | `IMMUTABLE`/`N_A`; 47/47 resolve to two distinct roots | both participants or nothing | **CROSS-COMPANY CAPABLE.** Taylor→Taylor, Ventana→Ventana, Taylor→Ventana and Ventana→Taylor are all valid; the shape holds all four (`ownershipMatrix.ts:459`) |
| Cycle Count | `IMMUTABLE`; 24/24 | counted location's company | single company — one counted location |
| Invoice | `IMMUTABLE`. `backfillSource: null` **on purpose**: pre-axis records have no SO company to inherit, and choosing one for a historical ledger entry is a business decision, not a derivation (`ownershipMatrix.ts:188`). A frozen attribution snapshot is corrected only by a governed FIN-007 event | `COMPANY_REQUIRED` at issuance | `companyId` === `attribution.operatingCompanyId`, always (`invoiceCommands.ts:292-294`). An invoice **cannot span** operating companies under this authority (`:311`) |
| Payment | `IMMUTABLE` | inherited from the Invoice | `companyId`, assertion-only from the caller |
| Report | N/A | N/A | N/A |
| Saved Report Definition | permanent; no transfer exists | `ownerUid` = creator, forever | **NONE.** No company field; report scope is decided by FIN-004 grants at *run* time, not by the definition |
| Employee | N/A | N/A | **TWO company fields on one collection, neither authoritative.** `employees.companyId` is declared but "Future — reserved, unused this sprint" (`docs/specifications/employee-foundation.md:76-77,103`). Separately, `employees.operatingCompanyId` is **live-editable**: `{ key: "operatingCompanyId", kind: "OPERATING_COMPANY" }` in `EDITABLE_EMPLOYEE_FIELDS` (`employeeProfileCommands.ts:215`), validated `:348`, merged by `updateEmployeeProfile`. It is **not** set by `functions/scripts/provisionEmployeeAccess.js`, so it exists only where someone later edited a profile. → **AUTHORITY GAP** |
| Role Assignment | N/A | N/A | RoleAssignments carry governed `{type:"operatingCompany"}` and `{type:"businessUnit"}` **access-scope** bindings (DECISIONS #157, `financialVisibility.ts:40-48`). **This is the only place a company binds to a person, and it is access authority, not employee accountability** |
| Approval / Exception | a rejection is **terminal** for that request; governance events are history (`financialApprovals.ts` header invariant C) | policy is Owner-gated; thresholds and capability activation both stay ungranted | `accessRequests.approverConstraint: "companyAdmin"` is the only company-scoped approver constraint |
| Inbound Work | not classified | `operatingCompanyId` from routing rule or mailbox default at intake (`inboundIntakeCommand.ts:279`) | **A governed company fact on an unclassified family** — the only such case at this baseline |

### 4.5 Panel E — EFFECTS AND OPEN DECISIONS

**A THIRD VALUE IS REQUIRED IN THESE COLUMNS: `WRITE-ONLY`.** A company or owner fact that has a live writer, is rendered nowhere and is reportable nowhere is **not** the same condition as absent storage, and scoring it as "present" overstates the model. OWN-E2E reports **11 of 13 stored company fields as WRITE-ONLY**. I adopt the *value* — it is clearly the right distinction — and attribute the *count* to that lane, because my own spot-check at `64008d5a` diverges slightly: `operatingCompanyId` or `companyId` is read by 24 frontend files, and the financial pair in particular **is** rendered (`FinancialsInvoiceDetail.jsx`, `FinancialsInvoices.jsx`, `FinancialsCustomerFinancials.jsx`) and reportable (`financialReportingRead.ts`), with `domain/companyAttribution.js` as a dedicated surface; inbound work's company reaches `InboundWorkWorkspace.jsx` and `AdminEmailCommunications.jsx`; equipment's is read by `domain/equipmentNorthStar.js:163` **and reported as UNKNOWN**. So the direction is confirmed and the denominator is OWN-E2E's — recorded as UP-9 rather than restated as mine.

**The single most important finding in this lane, stated before the table:** ownership has **no visibility effect, no work-queue effect and no reporting effect** on 24 of the 25 families. Visibility is decided by FIN-004 scopes keyed on `creditedSalespersonId`/`companyId` plus RoleAssignment grants (`financialVisibility.ts:16-38,170-179`); work queues are decided by `status` + `currentOwner` role tokens + `requiresOwnAssignment`; reporting is decided by the FIN-002 attribution snapshot. None of these reads an owner field. The sole exception is `reportDefinitions`, which the matrix classifies EXCLUDED.

| OBJECT | VISIBILITY EFFECT | WORK-QUEUE EFFECT | REPORTING EFFECT | OPEN DECISION |
|---|---|---|---|---|
| Account | **NONE today.** `record-ownership.md:187-191` designs an owner-scoped server-side `employeeId`↔`uid` join; nothing implements it. Hierarchy exists (`hierarchicalVisibility.ts`) but reaches only FIN-004's TEAM scope | NONE | Commercial attribution root: Customer → Opportunity → Agreement → Sales Order lineage | Does an Account handoff move Contact/Location visibility? `record-ownership.md:~226` says yes; `ownershipHandoffCommand.ts:24-30` forbids the cascade. **UNRESOLVED — C-2** |
| Contact | NONE | NONE | inherits via `accountId` | as Account |
| Location | NONE | NONE | inherits via `accountId` | as Account |
| Opportunity | NONE from ownership | NONE | `creditedSalespersonId` defaults from the commercial owner at entry and is thereafter carried (`financialAttribution.ts:321-330`) — **never re-derived from whoever owns the Customer today** | Is `ownerEmployeeId` or `creditedSalespersonId` the reporting authority when they diverge? Both are stored and both are legitimate |
| Sales Agreement | NONE | workflow `roleKeys` | `creditedSalespersonId` frozen credit, inherited by the Sales Order | as Opportunity |
| Sales Order | NONE from ownership | workflow `roleKeys` | **The pivot.** `operatingCompanyId` + `creditedSalespersonId` + per-line `businessUnitId` feed every downstream financial artifact | Reconcile `companyScope: COMPANY_NEUTRAL` against the `COMPANY_REQUIRED` refusal — **OD-OWN-001** |
| Work Order | NONE | `transitionEngine.ts:129-140` — `roles` + `requiresOwnAssignment`. **Assignment gates work; ownership gates nothing** | `WORK_ORDER` is a governed `FINANCIAL_SOURCE_TYPES` member (`financialAttribution.ts:44-52`) so Service billing will attribute to it — **but the Work Order has no company to attribute with** | Does the Work Order get company storage, and from where? **MISSING INPUT** on whether the Sales Order is the authoritative source for the 11/30 that carry one |
| Service Visit / Job | NONE | dispatch boards read `assignedTechId`/`scheduledTechId` | `operatingCompanyId` available | Is the legacy Job retired or dual-run? Out of this lane's scope — **defer to OWN-E2E** |
| Equipment | NONE | NONE | company available on 278/288 | Who is accountable for a customer-titled unit? `explicitTitleHolder` ≠ owner and neither is a person |
| Part | **NONE — deliberate.** REFERENCE data is visible to whoever holds part capabilities | NONE | company-neutral by design; a part's cost/price attribution lives on the transaction | Who **curates** the part master? No steward exists (Panel C iv) |
| Warehouse | NONE from ownership. Access is scoped by `{type:"location"}` RoleAssignment bindings (`reorderWarehouseAuthority.ts:151-162`) — a grant, not ownership | gates reorder creation: `WAREHOUSE_NOT_IN_SCOPE` (`reorderCommands.ts` code list) | the root every inventory company fact derives from | The 12 root company assignments are Owner-supplied and **not yet supplied** — this blocks 0/5 + 0/7 |
| Mobile Location | NONE | NONE | root | as Warehouse |
| Truck | NONE | `location_truck_claims` (EXCLUDED infrastructure) | company stored on 2/2 | Is a truck's company the vehicle's or the mobile location's? `ownershipBackfillRules.ts:117-120` says company "belongs to the MOBILE LOCATION that holds the stock" while the matrix keeps `trucks.operatingCompanyId` — **two answers, OD-OWN-007** |
| Purchase Order | NONE | NONE (empty collection) | single-company | Is `purchase_orders` live or superseded by `reorder_purchase_orders`? 0 records and a `backfillSource` marked "to be confirmed" |
| Reorder Request | NONE from ownership; warehouse-scope grants decide reach | **`currentOwner` role token + `status` ARE the queue.** `requiresOwnAssignment: true` on `startPurchasing` | company available | Nothing open — the model is coherent here. **The matrix row is what needs updating** (OD-OWN-003) |
| Transfer Order | NONE | NONE | two participants, so single-company reporting must not sum it as one company's | Whether formal transaction responsibility is ever assigned. "If the business later assigns it, that is a decision to add, not one to assume" (`ownershipMatrix.ts:443-445`) — **MISSING INPUT** |
| Cycle Count | NONE | cycle-count sheet domain | company available | none |
| Invoice | **`companyId` + `attribution.creditedSalespersonId` ARE the visibility keys** (`financialVisibility.ts:170-179`) — but as *attribution facts*, not as ownership | NONE | the primary reportable financial fact | Fix the matrix: `ownerFields` must name `companyId` — **OD-OWN-008** |
| Payment | same as Invoice | NONE | reportable | as Invoice |
| Report | N/A | N/A | FIN-004 scopes decide reach at run time; a caller-chosen `accountId` can never widen it (`financialVisibility.ts:23-25`) | none |
| Saved Report Definition | **`ownerUid` IS the visibility gate — the only ownership-driven visibility in EOS** (`savedDefinitionCommands.ts:268,404`). Firestore denies clients outright and **unconditionally, admin included** (`firestore.rules:1592-1594`), and there is deliberately **no owner-override capability**: `permissionCatalog.ts:890-910` — "there is no owner-override id here, matching Spec §9's 'private by default, no admin override'". The capability gate runs *before* the ownership check so a capability-less caller cannot distinguish "not mine" from "not allowed" (`:262-282`) | NONE | none | Should this be brought under the ownership model, or stay EXCLUDED "do not disturb"? **OD-OWN-009** |
| Employee | subject, not object | `operationalRoles` gate operational paths | goal/metric targets bind to `EMPLOYEE` scope (`performanceGoal.ts:434`) | canonical owner id namespace — **open item O-1**, still open |
| Role Assignment | **decides visibility for everything** via FIN-004 scope bindings | decides who may transition | binds company/business-unit reach | none for this lane |
| Approval / Exception | none | approval gates transitions (`workflowSeeds.ts:130-131`) and financial actions (`assertActionApproved`) | `ATTRIBUTION_CORRECTION` is the FIN-007 path by which a frozen reporting snapshot may be changed — the only sanctioned way history moves | Six approval vocabularies, one concept. Consolidating them is a real decision — **OD-OWN-011** |
| Inbound Work | `service.inboundWork.read` capability (`inboundWorkCallables.ts:39`) — capability-only, no owner scoping | **`queue` + `status` ARE the queue.** `AWAITING_DECISION`, `NEEDS_REVIEW`, then `ACCEPTED`/`DECLINED`/`ATTACHED` | none | Classify this family. It carries a governed company and is absent from the matrix — **OD-OWN-010** |

---

## 5. The four gap classes, tallied

### 5.1 MODEL GAP — the business model has no answer (11)

| ID | Gap | Families affected |
|---|---|---|
| MG-1 | **No ACCOUNTABLE PERSON concept exists anywhere.** The model has PERSON owner, COMPANY owner, assignee and credited salesperson. It has no "answerable for the outcome" that is distinct from all four | all 20 COMPANY-owned families — every one of them has a company answerable and no person |
| MG-2 | **No ESCALATION concept exists.** No field, no target, no timer, on any family | all 25 |
| MG-3 | **No DOMAIN STEWARD concept exists,** and no role vocabulary it could be stored in: `jobTitle` is free text, `operationalRoles` is 8 closed values of which 4 have essentially no consumer, and the 48 security Roles are authorization not stewardship | all 25, most acutely the 7 REFERENCE families |
| MG-4 | The canonical owner **id namespace** is unruled — `employeeId` vs Firebase `uid` (open item O-1) | Account, Contact, Location, Opportunity, Sales Agreement, Sales Order, Reorder Request, Saved Report Definition |
| MG-5 | **Employee deactivation has no ownership consequence.** Named as open question 3 of `record-ownership.md`, unanswered. It orphans `reportDefinitions` outright | Account, Contact, Location, Opportunity, Sales Agreement, Sales Order, Saved Report Definition |
| MG-6 | Whether a non-admin may transfer a record they own is unruled (`record-ownership.md` open question 2) | all **14** HANDOFF-capable families |
| MG-7 | Whether a Transfer Order ever acquires formal transaction responsibility. Deliberately left open (`ownershipMatrix.ts:443-445`) | Transfer Order |
| MG-8 | Whether `suppliers` carries company-specific commercial terms — if it does it is COMPANY, not REFERENCE. Flagged for ruling, `PROVISIONALLY not ownable` (`ownershipMatrix.ts:503-506`) | Supplier |
| MG-9 | Whether `purchase_orders` is live or superseded by `reorder_purchase_orders`. `backfillSource` marked "to be confirmed against purchasing semantics" (`:421`); 0 records | Purchase Order |
| MG-10 | Whether an approval/exception is a record at all. Six approval vocabularies, no collection | Approval / Exception |
| MG-11 | Whether `inbound_work_requests` is an ownable family. It is not in the matrix and carries a governed company | Inbound Work |

### 5.2 ENGINEERING GAP — the model has an answer, storage does not exist or is not read (9)

| ID | Gap | Evidence |
|---|---|---|
| EG-1 | **The Work Order's declared owner has nowhere to live.** `inheritanceSource` is stated; `ownerFields` is `[]`; six independent negatives confirm no company field in type, app mirror, create payload, any update writer, backfill/derivation/config, or Rules | `ownershipMatrix.ts:230-256`; measured 0/30 |
| EG-2 | **`managerEmployeeId` is stored, validated and read by nothing but display metadata.** "Escalate to their manager" has storage and no mechanism | `employeeProfileCommands.ts:214,498-515` vs zero routing readers |
| EG-3 | **Ownership has no visibility effect.** `record-ownership.md:187-191` specifies an owner-scoped server-side `employeeId`↔`uid` join; nothing implements it. Rules carry zero owner predicates | §3.2 |
| EG-4 | **`companyScope` and `companyScopeField` have no runtime reader.** The frontend's `companyScope` is a separate hand-copied literal that does not import the matrix | §1 row 5 |
| EG-5 | **Four matrix accessors are dead exports:** `participatingCompanyFamilies()`, `transferableFamilies()`, `familiesWithoutBackfillSource()` have zero callers; `crossCompanyFamilies()` is called only from a test | `ownershipMatrix.ts:556-578` |
| EG-6 | **`participatingFields` is read two incompatible ways.** The census reads it structurally on any family (`ownershipCensus.ts:127-156`), so `inventory_transactions` is honoured; `participatingCompanyFamilies()` filters on `ownerClass`, so the same row is excluded | §1 row 3 |
| EG-7 | **`inventoryAction` has a declared `backfillSource` and no derivation rule and no backfill rule.** It is the only family in the location-derived block with neither | `ownershipMatrix.ts:396-401`; absent from `DERIVATION_RULES` and `BACKFILL_RULES` |
| EG-8 | **`contacts.owner` / `locations.owner` are declared but never written by any live path.** Only the sandbox backfill sets them | `ownershipBackfillRules.ts:96-97` |
| EG-9 | **`warehouses.operatingCompanyId` has no authorized writer at all** — the roots the whole inventory company chain hangs off cannot be populated through any callable | `types/warehouse.ts:76-79` |
| EG-11 | **The PERSON ownership axis has no referential integrity.** `deriveAccountOwner` and `deriveEmployeeRefOwner` are shape-only and never read `employees`, so an owner who has left the company censuses `RESOLVED`. `deriveCompanyOwner` does resolve against its authority | §3.4; `typedOwner.ts:95-125` vs `:131-144` |

### 5.3 AUTHORITY GAP — two authorities disagree, or nobody owns the question (8)

| ID | Gap | The two authorities |
|---|---|---|
| AG-1 | **The record-ownership specification states the superseded model.** "Whoever creates a record owns it" / "the owner always resolves to the actor" / "A create command never accepts an owner from input" | `docs/specifications/record-ownership.md:32,~57,~220` **vs** `creationOwnerResolution.ts:12-23` (EXPLICIT → INHERIT → REFUSE; the actor is never a fallback) |
| AG-2 | **Cascade.** Account transfer moves Contact/Location visibility, or it does not | `record-ownership.md:~226` **vs** `ownershipHandoffCommand.ts:24-30` |
| AG-3 | **MANAGER.** The per-employee manager edge is deliberately not modelled, and is also stored | `roleHierarchy.ts:9-20` **vs** `employeeProfileCommands.ts:214` |
| AG-4 | **Two owner id namespaces** in live use | `employeeId` (`typedOwner.ts:101`) **vs** Firebase `uid` (`savedDefinitionCommands.ts:331`, `reorderCommands.ts:201`) |
| AG-5 | **Two company fields on `employees`,** neither authoritative | `companyId` reserved (`employee-foundation.md:76-77`) **vs** `operatingCompanyId` live-editable (`employeeProfileCommands.ts:215`) |
| AG-6 | **`stock_locations` is retired everywhere except the ownership model,** which still derives from it in four places by deliberate decision | Ruling O-6 / Decision #160 / ADR-014 **vs** `ownershipMatrix.ts:328-335` + `bin-p2-…-retirement.md:43` (KEEP) |
| AG-7 | **A truck's company is the vehicle's, or the mobile location's.** Both are asserted at this baseline | `ownershipMatrix.ts:364-370` (`trucks.operatingCompanyId`) **vs** `ownershipBackfillRules.ts:117-120` ("company … belongs to the MOBILE LOCATION that holds the stock") |
| AG-12 | **The one live owner-change control bypasses the ownership authority.** An Opportunity owner change is recorded as a generic field edit, never as `OWNERSHIP_HANDOFF` | `opportunityCommands.ts:244,302-306,312-317` (no handoff reference in the module) **vs** `ownershipHandoffCommand.ts` (the declared authority, reachable only from an operator script) |
| AG-8 | **Two parallel ownership vocabularies.** The frontend admin profiles re-type `ownerClass`/`companyScope`/`companyField` by hand for 3 of 51 families, citing the matrix without importing it — and `payment.js:112`/`invoice.js:96` correctly say `companyField: "companyId"` where the matrix says `ownerFields: []` | `ownershipMatrix.ts` **vs** `field-ops-app-vite/src/metadata/administration/profiles/*.js` |

### 5.4 WORKFLOW GAP — the answer depends on a process step nobody has defined (5)

| ID | Gap |
|---|---|
| WG-1 | **Who supplies the 12 physical-root company assignments, and when.** Until they land, `warehouses` 0/5 and `mobile_locations` 0/7 stay ownerless and every location-derived family downstream inherits nothing |
| WG-2 | **How a Work Order acquires a company at creation.** The 11/30 that carry a `salesOrderId` need both a field and a creation-path read; neither exists |
| WG-3 | **Who un-orphans a deactivated employee's owned records.** No process, no actor, no capability |
| WG-4 | **The `accessRequests` approval workflow and UI are explicitly deferred** (`types/access.ts:193-197`), so the one typed accountability constraint in EOS (`approverConstraint`) has no process behind it |
| WG-5 | **Inbound Work has no assignee step.** A request sits in a `queue` with `NEEDS_REVIEW` as its only escalation and no mechanism assigns it to anyone before `decisionBy` records who happened to act |

**Tally at this point: 11 MODEL · 9 ENGINEERING · 8 AUTHORITY · 5 WORKFLOW = 33.** EG-11 and AG-12 above, plus Section 8's four more (EG-10, AG-9, AG-10, WG-6), bring the **final tally to 11 MODEL · 11 ENGINEERING · 11 AUTHORITY · 6 WORKFLOW = 39 classified gaps.** No field, collection or schema is proposed for any of them.

---

## 6. Families where the business model needs something EOS cannot currently represent

These are the cases where classification is the honest output and a schema proposal would be the wrong one.

| Family | What the business model needs | Why EOS cannot represent it | Class |
|---|---|---|---|
| Work Order | a company answerable for the job | no company field exists, and every candidate on the record (technician, dispatcher, creator, `assignedTo`, customer, location name, `lineOfBusiness`) is a prohibited proxy | ENGINEERING (EG-1) + WORKFLOW (WG-2) |
| Work Order, Service Visit, Equipment, Warehouse, Truck, Cycle Count, Purchase Order, Transfer Order | a **named person answerable** for a company-owned operational record | the model has PERSON-owner, COMPANY-owner, assignee and credited-salesperson and no fifth slot. `assignedDriverEmployeeId` on `trucks` is the only near-miss and is explicitly not custody | MODEL (MG-1) |
| every family | an escalation target | no escalation storage of any kind; `managerEmployeeId` exists and is unread | MODEL (MG-2) + ENGINEERING (EG-2) |
| Part, Manufacturer, Equipment Model, Supplier Catalog Item, Part Alias, Part Supplier Item | a **curator** for shared master data | `REFERENCE` correctly says "no business *owner*". It does not say "no *curator*", and there is no role vocabulary a curator could be stored in | MODEL (MG-3) |
| Account | reporting/commission attribution that survives an owner change | `creditedSalespersonId` already does this correctly and is a *separate* authority; the gap is that nothing states which of the two is authoritative when they diverge | MODEL (MG-4-adjacent) |
| Saved Report Definition | an owner who can hand it on, and an admin who can recover it | no transfer command, no share command, no owner-override capability **by design** (`permissionCatalog.ts:890-910`) | MODEL (MG-5) |
| Approval / Exception | one approval concept | six approval field names across six surfaces and no collection; consolidating is a decision, not a schema edit | MODEL (MG-10) |
| Inbound Work | an owner on arrival | the family is not classified at all, yet carries a governed company from mailbox configuration | MODEL (MG-11) |
| Employee | one authoritative company | two fields, one reserved and one live-editable, neither ruled | AUTHORITY (AG-5) |

---

## 7. Families with a DELIBERATE `NONE` / `REFERENCE` / `COMPANY` answer — **NOT GAPS**

The synthesizer must not read any row in this section as a gap. Each is a decided, evidenced outcome.

### 7.1 Deliberate REFERENCE — no owner, by classification (7 families)

`parts`, `part_aliases`, `part_supplier_items`, `manufacturers`, `equipment_models`, `supplier_catalog` (`ownershipMatrix.ts:479-494`) and `suppliers` (`:496-506`, *provisional*).

The test applied was "Can Taylor and Ventana both legitimately use the same record?" and the answer is yes for all of them: "a part number, a manufacturer, an equipment model and a supplier's catalog entry describe the WORLD, not our side of it" (`:471-474`). `unresolvedPolicy` is the explicit string `"not ownable -- excluded from the invariant by classification, not by omission"` (`:113`). The census does not scan them and reports them as *classified out*, never as a backlog (`ownershipCensus.ts:244-249`). **`suppliers` is the one provisional row** — if it carries commercial terms it is COMPANY, and MG-8 tracks that.

### 7.2 Deliberate NONE / EXCLUDED — not a business record (17 families)

`users`, `employees`, `fieldops_technicians`, `permissions`, `roles`, `roleAssignments`, `accessRequests`, `auditEvents`, `reportDefinitions`, `sales_territories`, `commercial_coverage_assignments`, `counters`, `inventory_sync_status`, `location_truck_claims`, `technician_working_availability`, `technician_blocked_time`, `operating_companies` (`ownershipMatrix.ts:509-535`).

Four of these carry a reason worth restating because they look like gaps and are not:

| Family | Why NONE is correct |
|---|---|
| **Employee** | "person authority — a subject of ownership, not an object" (`:513`). An Employee being unowned is the model working |
| **Role Assignment** | "access authority, governed separately" (`:518`). Coverage/credit/security are explicitly *not* ownership |
| **Sales Territory / Coverage Assignment** | "coverage is not ownership, credit, commission or security" (`:522-523`) |
| **Operating Company** | "the company authority itself — companies are not owned by companies" (`:527`) |

`reportDefinitions` is in this list and is the one entry this lane flags: it is EXCLUDED with the note "platform record with its own private-by-owner model — do not disturb" (`:521`), which is a **deliberate deferral, not a classification of ownerlessness** — and it is simultaneously the only family in EOS where ownership actually gates access. Recorded as OD-OWN-009; **not** a gap to close.

### 7.3 Deliberate COMPANY — company ownership is the right answer, not a substitute for a missing person (20 families)

Three rulings each state this affirmatively:

| Ruling | Statement | Evidence |
|---|---|---|
| **D-13** (service) | "The responsible operating company owns the job; the technician performs it. That keeps the ownership/assignment distinction this whole model rests on, and it is why `assignedTechId` is deliberately NOT an ownerField" | `ownershipMatrix.ts:200-204` |
| **D-15** (financial) | "A ledger entry belongs to the books it lands in, not to the salesperson upstream of it… accounting ownership and sales credit are different questions and must not share one field" | `:172-178` |
| **D-14** (inventory obligation) | `currentOwner` (role queue), `requestedBy` (actor) and `assignedToUserId` (processor) all stay separate from the COMPANY owner | `:279-286`; `reorderCommands.ts:198-201` |

**A COMPANY answer on these 20 families is the model's correct output.** The absence of a person owner is not an omission — the omission is MG-1, which is about *accountability*, a different column.

### 7.4 Deliberate PARTICIPATING COMPANIES (1 family)

`transfer_orders`. "Source always owns it" and "destination always owns it" were **both explicitly rejected** because either would record a company as responsible for a movement it may only have received (`ownershipMatrix.ts:440-443`). `transfer: "N_A"` is what enforces it: the handoff command refuses the family with its own error code (`ownershipHandoffCommand.ts:101-106`). **Having no single owner is the decided answer.**

### 7.5 Deliberate NONE on the company axis for the commercial head (3 families)

`accounts`, `contacts`, `locations` carry **no company field and must not acquire one**. R-15, stated in code: "a Customer must NOT carry a single operating company just to make this chain resolve. The customer relationship and the transacting company are different questions, and collapsing them would silently decide the second by answering the first" (`commercialCompanyScope.ts:16-19`). The company enters at the **Opportunity** instead. **That an Account has no resolvable company is the design, not a gap.**

---

## 8. Corroboration from the sibling corpora — and four gaps only they exposed

Sources (read-only, actual paths and counts verified): the registry at `/home/rudy2/.local/share/eos-worktrees/p3d-workflow-registry/docs/architecture/eos-workflow-registry.json` — **86 workflows**, 14 domains, **106 owner questions**, and **0 in state `WORKS_END_TO_END`** (27 WORKS_WITH_GAPS / 31 BROKEN_MIDWAY / 23 CANNOT_START / 5 NO_IMPLEMENTATION); three archaeology documents under `docs/design/archaeology/` in `p3a1/p3a2/p3a3`; the corpus at **1,010 records / 1,009 distinct** across `p3b1` (330), `p3b2` (330) and `p3b3` (350).

**The quantified measure of this lane's central finding.** The corpus carries a dedicated `ownershipUnclear` friction flag. It is raised on **75 of 330** service activities and **91 of 330** inventory activities — **166 of 660, one activity in four.** `roleHandoffUnclear` is raised 90 more times. Ownership is not merely declared-and-unread; its absence is felt at a measured rate in the operating narrative.

### Four findings the sibling lanes surfaced and this lane then verified in code at `64008d5a`

| ID | Finding | Verified by me at `64008d5a` |
|---|---|---|
| **AG-9** | **For the Reorder Request, assignment IS an ownership move — and Rules enforce it.** The Assign branch changes `currentOwner` to `"PARTS_ASSOCIATE"` **and** sets `assignedToUserId` in one write: `affectedKeys().hasOnly(["status","currentOwner","assignedToUserId","assignedBy","assignedAt"])`. The Approve branch writes `currentOwner == "PARTS_MANAGER"` with **no assignee at all** | **CONFIRMED.** `firestore.rules:765-790`. This is the **one genuine contradiction of "reassignment ≠ ownership transfer" in EOS.** The defence — that `currentOwner` holds a role and was never ownership — is precisely the naming collision `field-ops-app-vite/src/domain/constants.js:276-287` warns about: `OPERATIONAL_ROLE.PARTS_MANAGER` and `REORDER_REQUEST_OWNER.PARTS_MANAGER` "are the same string but mean two unrelated things on two unrelated fields". A field named `currentOwner`, mutated by an approval, is the collision doing damage. → **AUTHORITY GAP** |
| **AG-10** | **Report row scope is hardcoded global, bypassing the scope model in both directions.** A runner holding the object capability sees **every row**; a grant held at `ownAssignment` or `location` scope resolves to **nothing** | **CONFIRMED.** `functions/src/reporting/reportExecutionService.ts:421` — `const target: TargetContext = { scope: { type: "global" }, condition: {} };`. So the one reporting surface that could have honoured owner-scoping deliberately does not. → **AUTHORITY GAP** |
| **WG-6** | **Manager intervention is not merely "not an ownership transfer" — it is IMPOSSIBLE where it matters most.** `Accept`, `Travel`, `Arrive`, `WorkStart` and `Complete` are all `requiresOwnAssignment: true`, so disabling a principal strands every Work Order assigned to them and **nobody else can advance them.** One administrative click can immobilise a day's field work | **CONFIRMED.** `functions/src/transitionEngine.ts:138-140` (`Accept`/`Travel`/`Arrive` → `requiresOwnAssignment: true`). This is the operational face of MG-5: employee deactivation has no ownership *or* assignment consequence, and the absence bites hardest on the family with no owner at all. → **WORKFLOW GAP** |
| **EG-10** | **The ownership model's one hard refusal is unreportable.** An ownerless Account makes Opportunity creation REFUSE by design (`ownershipMatrix.ts:124`), yet no report can list ownerless Accounts | **CONFIRMED.** `functions/src/access/permissionCatalog.ts:735-739` — `report.customer.field.accountOwner.read` is "deferred to wave 4 despite sitting in the wave-1 object table". The field the whole PERSON chain hangs off cannot be read by any report. → **ENGINEERING GAP** |

### Three sibling findings that CORRECT or SHARPEN this lane's reading

| Topic | Sibling finding | This lane's reconciliation |
|---|---|---|
| Cycle Count company source | The registry's own owner question records that `cycleCount` "was declared to inherit its operating company from `stock_locations`, a hop now retired; **nothing says what they inherit from now**" | **Both statements are true and they are about different layers.** The matrix *prose* hop (`ownershipMatrix.ts:414`) is broken by Ruling O-6. The *implemented* backfill rule is not: `ownershipBackfillRules.ts:124` resolves `location.locationId` against `rootCompanyById`, and the census measures 24/24 RESOLVED. So the **documentation is broken and the code is fine** — which is a worse failure mode than the reverse, because the code cannot be audited against its own description. → folds into **AG-6** |
| Saved report deletion | `reportAuthor` holds `.create`, `.rename`, `.duplicate` and **not** `.delete`; `report.definition.delete` is owner+admin only (EXECUTED: `reportAuthor` → SANDBOX DENY) | Compatible with, and worse than, my reading. Two gates stack: the **capability** gate (only owner/admin hold `.delete`) runs first, then `requireOwnershipOrAudit` (`savedDefinitionCommands.ts:381`) requires `ownerUid === actorUid`. So an author cannot delete their own definition for want of the capability, and an admin who holds the capability cannot delete someone else's for want of ownership. **The record is undeletable by anyone.** → sharpens **MG-5** |
| Exception-row ownership | Ruling **SO-N4** struck "an Owner per row" from the exception surface because "`recipientRole` is a role, not a person" | This is a **deliberate NONE**, not a gap. Recorded in §7.6 below so the synthesizer does not read it as one |
| Value-threshold approval | `WF-SLS-005` "Accept above a value threshold with a senior approval" has **no surface**, recorded as a deliberate governance gap at `functions/src/access/governedBusinessRoles.ts:388-394`; the consequence is "a Salesperson may bind the same terms a General Manager can". Separately, FIN-007 §2 approval policy *values are unset*, so the financial approval machinery is built and inert | Both belong to **MG-10** (one approval concept, six vocabularies) and **WG-4**. Neither is a schema gap: the machinery exists and the **policy values and the second-approver identity are Owner input** — see §10 |

### 7.6 (addendum) One further DELIBERATE NONE

**Exception rows carry no owner, by ruling.** SO-N4 removed "an Owner per row" from the cross-object exception surface on the grounds that a `recipientRole` is a role and not a person (`p3a1` archaeology, `docs/design/archaeology/service-scheduling-technician-equipment.md:236`). The archaeology also records the cost of that choice in the same document (`:283-284`): "The page shows the technician but no owner, because no ownership model exists. **Who is accountable for an exception that nobody is assigned?**" **The NONE is decided; the accountability question it leaves open is MG-1, not a reversal of the ruling.**

### The registry's own summary, which this lane endorses

The company boundary "is declared in the ownership and Postgres layers and **enforced in exactly ONE place in the whole system** — AR cash application. Everywhere else it is absent: allocation is company-blind, **Work Orders have no field**, reporting has no company axis, and the two physical roots that would supply it are `OWNERLESS_UNTIL_SUPPLIED`… **And inference is explicitly forbidden, so the gap cannot be closed by a default.**" (`eos-workflow-registry.json` `$.workflows[82].break_point`.) Corroborated in code by `commercialCompanyScope.ts:25-28`: "there is no enforcement, and none may be added until the census gate passes."

**Final tally: 11 MODEL · 11 ENGINEERING · 11 AUTHORITY · 6 WORKFLOW = 39 classified gaps.**

---

## 9. Numbered decisions — `OD-OWN-nnn`

These are **descriptive corrections and classification decisions.** None proposes a field, a collection, or a schema. Each says what the matrix should *describe*, or what only the Owner can settle.

| ID | Decision | Basis | Kind |
|---|---|---|---|
| **OD-OWN-001** | `companyScope` and `companyScopeField` **cannot decide filterability** and must not be read as though they could. `salesOrder` is `COMPANY_NEUTRAL` with a hard-required company. Neither column has a runtime reader; the frontend's identically-named field is a hand-copied literal that does not import the matrix | §1 rows 4-5; `salesOrderCommands.ts:274-283`; `objectAdministrationProfile.js:216` | DESCRIPTIVE |
| **OD-OWN-002** | The **discriminator for the participating-companies shape is `ownerClass === "PARTICIPATING_COMPANIES"`,** never the presence of a company pair. `inventory_transactions` carries the pair while `SINGLE_COMPANY`, and the census and the accessor read it two incompatible ways | §1 row 3; `ownershipCensus.ts:127-156` vs `ownershipMatrix.ts:556-558` | DESCRIPTIVE |
| **OD-OWN-003** | The `reorderRequest` and `reorderPurchaseOrder` rows are **STALE and must be re-measured, not re-designed.** The `warehouseId` schema change the matrix calls "a schema change, not a backfill" **has shipped**, with a derived company, a client-supply refusal and a companyless-warehouse refusal. `ownershipDerivation.ts:~104` also still asserts "a reorder request carries NO location reference of any kind today" — false | `reorderCommands.ts:91-92,130-135,181-190`; `reorderCallables.ts:177-178` | DESCRIPTIVE |
| **OD-OWN-004** | There are **two parallel ownership vocabularies** and the frontend's is more accurate on the financial tier. `profiles/invoice.js:96` and `profiles/payment.js:112` correctly say `companyField: "companyId"` where the matrix says `ownerFields: []`. Only 3 of 51 families have a profile | AG-8 | DESCRIPTIVE |
| **OD-OWN-005** | "The handoff is INERT" is **true for callables and false for operator tooling.** `functions/scripts/assignWarehouseRootCompany.js:72,234` calls `stageOwnershipHandoff`. This lane does **not** activate anything; the statement is recorded so nobody relies on an inertness that has one door | `ownershipHandoffCommand.ts:8-14` vs the script | DESCRIPTIVE |
| **OD-OWN-006** | **`inventoryAction` is the only ownable family with a declared `backfillSource` and neither a derivation rule nor a backfill rule.** It is absent from `DERIVATION_RULES` and from `BACKFILL_RULES`. Census scans 0 records, so the gap is invisible today | `ownershipMatrix.ts:396-401` | DESCRIPTIVE |
| **OD-OWN-007** | A truck's company is asserted **twice, incompatibly**: the matrix keeps `trucks.operatingCompanyId`; `ownershipBackfillRules.ts:117-120` says company "belongs to the MOBILE LOCATION that holds the stock". Only the Owner can settle which. Note `mobile_locations` has no company field at all | AG-7 | **MISSING INPUT** |
| **OD-OWN-008** | The **financial block's `ownerFields: []` is factually wrong.** `InvoiceRecord.companyId: string` is required (`invoiceCommands.ts:214`) and written (`:294`) under a structural invariant with `attribution.operatingCompanyId`; `payments`, `refunds` and `invoice_adjustments` carry `companyId` too. The census consequently reports a company-stamped invoice as OWNERLESS ("family has no ownership storage yet"). **This is the `workOrder` correction in the opposite direction, and it has not been made** | §1; `sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.txt` | DESCRIPTIVE |
| **OD-OWN-009** | `reportDefinitions` is **simultaneously the only family where ownership functions and the only ownership model the matrix excludes.** Whether it stays "do not disturb" or comes under the model is the Owner's call. Recording it here so the synthesizer does not read `EXCLUDED` as ownerlessness | `ownershipMatrix.ts:521`; `savedDefinitionCommands.ts:268,381,404`; `permissionCatalog.ts:890-910` | **MISSING INPUT** |
| **OD-OWN-010** | **`inbound_work_requests` must be classified.** It carries a governed `operatingCompanyId` (from mailbox or routing-rule configuration) and is absent from the matrix — as are `email_connections`, `email_mailboxes` and `email_routing_rules`, which carry it too. The matrix's own header says a collection absent from the file "would be indistinguishable from one nobody thought about" (`:509-511`). Four such collections exist | `inboundIntakeCommand.ts:277-279`; `constants/collections.ts:127-130` | **MISSING INPUT** |
| **OD-OWN-011** | **Six approval vocabularies describe one concept** — `ApprovalRecord.decidedByUid`, `accessRequests.ApprovalPolicy.approverConstraint`, `roleAssignments.approvedBy`, `data_import_jobs.approvedBy`, `performance_goals.approvedByUid`, `financialPolicyProfile.approval.approvedBy`. There is no approval collection and no matrix family. Consolidation is a decision, not a schema edit | §5.1 MG-10 | **MISSING INPUT** |
| **OD-OWN-012** | **`stock_locations` is retired everywhere except the ownership model**, which still derives from it in four places by an explicit KEEP. The ownership model is the last authority in EOS reading a retired collection, and the KEEP should be reaffirmed or withdrawn deliberately | AG-6; Ruling O-6 (`docs/DECISIONS.md:4605-4611`); `bin-p2-legacy-inventory-authority-retirement.md:43` | **MISSING INPUT** |
| **OD-OWN-013** | **The record-ownership specification states the superseded model and must not be read as current.** "Whoever creates a record owns it" / "the owner always resolves to the actor" / "a create command never accepts an owner from input" were all replaced by D-4's EXPLICIT → INHERIT → REFUSE on 2026-08-30. Until that document is revised, any lane citing it will reconstruct the wrong model | AG-1 | DESCRIPTIVE |
| **OD-OWN-014** | **`currentOwner` on `reorder_requests` is the one place EOS lets assignment move "ownership",** Rules-enforced, in a single write. Either the field is renamed in description (it is a queue, not an owner) or the principle is amended. This lane recommends the former and decides neither | AG-9; `firestore.rules:765-790` | **MISSING INPUT** |
| **OD-OWN-015** | **`ownerFields` non-empty ≠ ownership populated.** Three tiers exist (LIVE / BACKFILL-ONLY / DECLARED-NEVER-AUTHORED) and the matrix expresses none of them. `trucks` overstates; `reorder_requests` understates; `warehouses` — the root the whole inventory chain depends on — has no authorized writer at all | §3.1 | DESCRIPTIVE |
| **OD-OWN-019** | **Stale comments are the least reliable artifact class in this codebase, and three are load-bearing.** `ownershipBackfillRules.ts:5` says "the Owner authorized exactly **1,015** writes" while `AUTHORIZED_TOTAL` computes **1013** (`:224-234`, after `trucks: 2` was removed with its rule) and the matrix's truck row cites "applied **1015**/1015" (`:369`) — three numbers for one authorization. `governedBusinessRoles.ts:61` says "eight governed business" Roles against 45. `ownershipDerivation.ts:~104` still says a reorder request "carries NO location reference of any kind today". **Cite the code, never the header.** | §15 | DESCRIPTIVE |
| **OD-OWN-020** | **Handoff is inert for all 14 HANDOFF-capable families, and the one live owner-change control (Opportunity) bypasses it**, filing an owner change as a generic field edit. Recorded, not fixed; this lane activates nothing | AG-12; `opportunityCommands.ts:302-317` | DESCRIPTIVE |
| **OD-OWN-021** | **`WRITE-ONLY` is a required third value** for VISIBILITY EFFECT and REPORTING EFFECT: a company fact with a live writer, no surface and no report is a distinct condition from absent storage and must not be scored as present | §4.5; OWN-E2E's 11-of-13 measure | DESCRIPTIVE |
| **OD-OWN-017** | **Every `RESOLVED` count on a PERSON-owned family is shape-validity, not referential validity.** The census must not be read as evidence that owners exist. The COMPANY axis is referential; the PERSON axis is not | §3.4 | DESCRIPTIVE |
| **OD-OWN-018** | **The pattern for a second, non-ownership accountability axis already exists** — `companyScopeField` (two independent facts on one record) plus R-20's accept-in-storage / refuse-in-assignment asymmetry. **Cited as precedent; no schema proposed.** Whether such an axis should exist is MI-1 | `ownershipMatrix.ts:86-96`; `warehouseRootCompanyAssignment.ts:39-45` | **MISSING INPUT** |
| **OD-OWN-016** | **Ownership is not enforced in Firestore Rules at all**, and the one ownership check in the entire product is `savedDefinitionCommands.ts:268,381`. Rules enforce assignment and role. Any statement that ownership "governs access" is false at this baseline | §3.2 | DESCRIPTIVE |

---

## 10. MISSING INPUT — only the Owner's employee-design conversation can settle these

Not reconstructed, not guessed.

| # | Question | Why only the Owner can answer |
|---|---|---|
| MI-1 | **Is there an ACCOUNTABLE PERSON distinct from owner, assignee and credited salesperson?** (MG-1) | This is the central question of this lane and EOS has no slot for it. Answering it by adding a field is exactly what the rule forbids. 20 COMPANY-owned families wait on it |
| MI-2 | **Who is accountable for a COMPANY-owned Work Order?** The operating company owns it; the technician performs it; nobody answers for it | `record-ownership.md` open question 1 asked "Are Work Orders ownable?" and D-13 answered "COMPANY". It did not answer "which person" |
| MI-3 | **What is the canonical owner id namespace** — `employeeId` or Firebase `uid`? (open item O-1, AG-4) | O-1 is explicitly still open: "the ruling named the type, not the identifier" |
| MI-4 | **What happens to owned records on employee deactivation?** (MG-5, WG-3, WG-6) | `record-ownership.md` open question 3, unanswered. The `reportDefinitions` case is already live and unrecoverable |
| MI-5 | **May a non-admin transfer a record they own?** (MG-6) | `record-ownership.md` open question 2: "Letting a rep hand off their own account is natural; letting them push an unwanted one onto a colleague is not" |
| MI-6 | **Is MANAGER a per-employee edge or a Role position?** (AG-3) | Both exist. `roleHierarchy.ts` says `reportsTo` is deliberately not modelled; `employeeProfileCommands.ts` stores it |
| MI-7 | **Does a DOMAIN STEWARD exist, and what vocabulary holds it?** (MG-3) | There is no role vocabulary that could carry it: `jobTitle` is free text, `operationalRoles` has 8 values with 4 near-unused, and the 48 security Roles are authorization |
| MI-8 | **A truck's company: the vehicle's or the mobile location's?** (OD-OWN-007) | Two code authorities assert opposite answers at one baseline |
| MI-9 | **Does `reportDefinitions` come under the ownership model?** (OD-OWN-009) | It is the only working ownership model and the only one excluded |
| MI-10 | **How is `inbound_work_requests` classified, and the three email collections with it?** (OD-OWN-010) | Four collections carry a governed company and no classification |
| MI-11 | **One approval concept or six?** And the FIN-007 §2 threshold values and second-approver identities, which are unset | The machinery is built and inert pending Owner policy values |
| MI-12 | **Is the `stock_locations` KEEP in the ownership tooling still intended** after Ruling O-6? (OD-OWN-012) | The KEEP was deliberate; whether it survives the retirement is a decision |
| MI-13 | **Does `suppliers` carry company-specific commercial terms?** (MG-8) | Flagged in the matrix itself as an open question; the classification is `PROVISIONALLY not ownable` |
| MI-14 | **Is `purchase_orders` live or superseded?** (MG-9) | 0 records, no company field, `backfillSource` "to be confirmed against purchasing semantics" |
| MI-15 | **The 12 physical-root company assignments** (WG-1) | Owner-supplied by design; `config/ownership/operating-company-roots.sandbox.json` forbids inference in its own header |
| MI-16 | **Does an Account handoff move Contact/Location visibility?** (AG-2) | The spec and the command contradict each other and neither is authoritative over the other |

---

## 11. UNPROVEN at this baseline

Claims this lane could not verify from `64008d5a` alone. Several are `OWN-E2E`'s to settle.

| # | Claim | Why unproven | Route |
|---|---|---|---|
| UP-1 | That the 11/30 Work Orders carrying a `salesOrderId` would actually resolve a company if the field existed | requires reading the linked Sales Orders' `operatingCompanyId` in live data. The matrix itself says "to be measured, never assumed" (`:255`) | **OWN-E2E** |
| UP-2 | Whether ownership state changes anything a user can see or do in any of the 16 lifecycle stages | this lane measured *storage and authority*, not runtime behaviour. The static answer is "no" (§3.2) but only a runtime audit can close it | **OWN-E2E — explicitly deferred, not duplicated** |
| UP-3 | Whether the census numbers still hold. All census figures here are from `sb-evidence/…-postbackfill-2026-08-30.txt`, **two weeks stale**, and `reorder_requests` has demonstrably changed shape since | open item O-3: "the census cannot be run from a repository session — needs Admin-SDK credentials against a real target, separately Owner-authorized" | Owner-authorized census run |
| UP-4 | Whether any production record carries `trucks.operatingCompanyId`, `contacts.owner` or `locations.owner` | those values are sandbox-backfill artifacts; production population is unmeasured | **OWN-E2E** / census |
| UP-5 | Whether the four email/inbound collections carry `operatingCompanyId` on real records, or only in the write path | no census covers them — they are not matrix families | census scope extension |
| UP-6 | Whether the `reassignWorkOrderTechnician` audit action and `OWNERSHIP_HANDOFF` ever both fire for the same record | would prove or disprove "reassignment ≠ ownership transfer" empirically | **OWN-E2E** |
| UP-7 | Whether `commercialOwnershipAuthority.ts`'s Postgres path agrees with the Firestore matrix. It reads `ownershipFamily()` but its only importer has no importers of its own | the Postgres plane was out of this lane's read surface | separate lane |
| UP-9 | **OWN-E2E's "11 of 13 stored company fields are WRITE-ONLY".** I adopt the distinction and cannot reproduce the denominator: I count more than 13 collections carrying a stored company field, and the financial pair plus inbound work do have surfaces | their family scope and renderability criteria are not stated in what reached me | **OWN-E2E** |
| UP-10 | **Role occupancy: production ZERO assignments; sandbox 86 across 30 roles.** Reported measured by OWN-E2E. **I could not establish its provenance at `64008d5a`** — there is no role-occupancy census artifact in `sb-evidence/` or `docs/audits/` in this worktree, and this lane performs no live reads. If it rests on a committed census artifact it is *source-derived evidence about production*, not a live read; if it rests on a live query it is outside this lane's authority to confirm. **"Unknown" is nonetheless the wrong word — treat it as measured-per-OWN-E2E.** Consequence if it holds: **a production work queue keyed on any governed Role is EMPTY, not merely unverifiable**, which makes every role-valued queue in Panel C (`currentOwner`, `queue`, `roleKeys`, `requiresOwnAssignment`) inert in production for want of occupants rather than for want of mechanism | no artifact locatable at this baseline; provenance unstated in what reached me | **OWN-E2E — name the artifact** |
| UP-8 | The sibling-corpus figures (86 workflows, 1,010 activities, 166/660 `ownershipUnclear`) are **cited as reported by those lanes**; I verified the four code-level findings in §8 but not the corpus counts themselves | they live in sibling worktrees at different HEADs (`79d21d7d`, `72c34c94`, `0a1a6d49`), not at `64008d5a` | those lanes |

---

## 12. Deferred to OWN-E2E (not duplicated here)

- Whether ownership affects behaviour at any of the 16 lifecycle stages (UP-2).
- Whether the legacy `fieldops_jobs` domain is retired or dual-run alongside `fieldops_wos`.
- The runtime consequence of `requiresOwnAssignment: true` when a principal is disabled (WG-6 is the static finding; the operational blast radius is E2E's).
- Whether any live path writes `contacts.owner` / `locations.owner` / `trucks.operatingCompanyId` (UP-4).
- **Name the artifact behind the role-occupancy measurement** (production zero / sandbox 86 across 30 roles) and state whether it is a committed census or a live read (UP-10). If production occupancy is genuinely zero, that reclassifies every role-valued queue in Panel C from a design gap to a provisioning gap — the only gap in this document a grant rather than a decision would close.
- The 11-of-13 WRITE-ONLY denominator and its renderability criteria (UP-9).

## 13. Deferred to EMP-ACCOUNTABILITY (not derived here)

This lane names MG-1 (no accountable-person concept) and MG-3 (no steward vocabulary) as gaps and **deliberately does not propose what should fill them.** Deriving the target accountability model is `EMP-ACCOUNTABILITY`'s lane. What this lane contributes to it: the 20 COMPANY-owned families that have a company answerable and no person, and the evidence that `managerEmployeeId`, `assignedDriverEmployeeId` and `currentOwner` are the only three near-miss stores that exist.

---

## 14. Coordinator corrections received mid-lane, and their disposition

All were re-verified at `64008d5a` rather than inherited.

| From | Correction | Disposition |
|---|---|---|
| EMP-ROLE | The security-Role set is **48**, not 45 (45 in `governedBusinessRoles.ts` + `admin`/`dispatcher`/`technician` in `compatibilityRoles.ts:16`) | **VERIFIED** (45 `id: "` entries) and applied in §4.3(iv). The stale header at `governedBusinessRoles.ts:61` ("eight governed business") is recorded |
| EMP-ROLE | `jobTitle` and `managerEmployeeId` are **absent from `employee-foundation.md`** and arrived via `administration-users-consolidation.md` | **VERIFIED** — both are real governed fields (`employeeProfileCommands.ts:213-214`), and the spec home is `docs/specifications/administration-users-consolidation.md:206-209` (**not** `docs/assessments/…`, which does not exist). Applied in §4.3(ii); it changed the ESCALATION column from "no field exists" to ENGINEERING GAP |
| EMP-ROLE | No job-role vocabulary — five disjoint ones, no mapping; `jobTitle` free text; 5 of 8 `operationalRoles` unconsumed | **VERIFIED** in substance: `jobTitle` is `kind: "TEXT"`; `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE` and `WAREHOUSE_ASSOCIATE` have ≤2 non-declaring consumer files. Stated once at §4.3(iv) as MG-3 |
| EMP-ROLE | MANAGER and JOB ROLE conflated in opposite directions by two subsystems | **VERIFIED** — `roleHierarchy.ts:9-20` vs `employeeProfileCommands.ts:214`. Recorded as AG-3 / §4.3(iii) |
| EMP-ACCOUNTABILITY | `docs/OWNERSHIP.md` is **not** a record-ownership authority | **VERIFIED and independently found before the correction arrived.** It is IP/attribution governance. Recorded in §1's errors table; not cited anywhere in this lane's substance |
| EMP-ACCOUNTABILITY | `record-ownership.md` carries a **superseded, unmarked** rule | **VERIFIED.** No OWNER CREATION RULE cell is populated from it; it is cited only as superseded (AG-1, OD-OWN-013) |
| EMP-ACCOUNTABILITY | **51** families, not 50; the Work Order absence must **not** generalise to `fieldops_jobs`, which does store the company | **VERIFIED.** 51 confirmed two ways (§1 row 1). Panel A holds Work Order and Service Visit / Job as **separate rows with opposite storage answers** |
| EMP-ACCOUNTABILITY | The PERSON axis has no referential integrity; the COMPANY axis does | **VERIFIED and it is the single most consequential correction this lane received.** §3.4, EG-11, OD-OWN-017, and a `†` footnote on every PERSON row |
| EMP-ACCOUNTABILITY | ACCOUNTABLE PERSON and ESCALATION OWNER have no representation at all | **VERIFIED.** MG-1 and MG-2, stated once at §4.2 and §4.3 rather than 25 times |
| EMP-ACCOUNTABILITY | `companyScopeField` + R-20 are the **precedent** for a second axis — cite, do not propose | **VERIFIED** (`warehouseRootCompanyAssignment.ts:39-45`). §3.5, OD-OWN-018. **No schema proposed anywhere in this document** |
| EMP-ACCOUNTABILITY | Handoff is inert as a callable but **is** invoked by an operator script | **VERIFIED independently** before the correction arrived. OD-OWN-005. **Not activated by this lane** |

| OWN-E2E (via coordinator) | The `:392-414` span is wrong: `transfer` is not a family, `receivingOrder` was omitted, the real span is **`:385-417`** | **VERIFIED and adopted.** I had independently found `transfer` absent and `receivingOrder` present; the span is now corrected to `:385-417` in §1 row 8 |
| OWN-E2E (via coordinator) | Both flagged stale rows (`:287-296`, `:327-336`) are **already corrected** — do not carry either as a defect | **SPLIT.** `:327-336` — agreed, not a defect (already reframed as "spent, not wrong"). `:287-296` — **I disagree and hold my finding.** See §16 |
| OWN-E2E (via coordinator) | **11 of 13 stored company fields are WRITE-ONLY** | **Distinction adopted as a required third column value** (§4.5, OD-OWN-021). Count attributed to OWN-E2E, not restated as mine — my spot-check diverges (UP-9) |
| OWN-E2E (via coordinator) | Handoff inert for **all 14** capable families; the one live owner-change control (Opportunity) **bypasses the authority** | **VERIFIED.** `opportunityCommands.ts:244,302-306,312-317` routes an owner change through the generic `record()` helper with no handoff reference in the module. New **AG-12** / **OD-OWN-020**. I had under-counted HANDOFF families as 13; corrected to 14 |
| OWN-E2E (via coordinator) | `AUTHORIZED_TOTAL` is **1013** against its header's 1,015 while 1015 were applied | **VERIFIED** (`ownershipBackfillRules.ts:5` vs `:224-234` vs `ownershipMatrix.ts:369`). Folded into **OD-OWN-019** with the two other stale-comment instances |
| OWN-E2E (via coordinator) | Role occupancy is **measured**: production zero, sandbox 86 across 30 roles — not unknown; **check provenance** | **ADOPTED AS MEASURED-PER-OWN-E2E, provenance unestablished by me.** No such artifact in `sb-evidence/` or `docs/audits/` at `64008d5a`, and this lane performs no live reads. Recorded as **UP-10** with the consequence stated at §4.3(0): a production Role-keyed work queue is **empty, not unverifiable** |

---

## 15. One correction this lane declines: `ownershipMatrix.ts:287-296` is still stale

Recorded explicitly so the synthesizer can adjudicate rather than silently inherit whichever lane it read last.

**The claim I was asked to drop:** that the `reorderRequest` row is stale.

**What the file says at `64008d5a`** (`functions/src/ownership/ownershipMatrix.ts:287-293`, verbatim):

```
family: "reorderRequest", collection: "reorder_requests", ownerClass: "COMPANY", ownerType: cmp,
ownerFields: [], inheritanceSource: "the warehouse the replenishment is for, at trusted creation",
transfer: "HANDOFF", companyScope: "SINGLE_COMPANY",
backfillSource: null,
unresolvedPolicy: "remains OWNERLESS -- measured 6/6 MISSING_REFERENCE, the record cannot say where",
note: "MEASURED DESIGN GAP: 6/6 sandbox requests carry no warehouseId. Adding it is a schema change to the reorder request, not a backfill.",
```

**What the code does at the same baseline:** `reorderCommands.ts:91-92` declares `warehouseId: string` and `operatingCompanyId: string` as **required** on the built record; `:190` derives the company from the governed Warehouse; `:130-135` refuses a client-supplied company (`COMPANY_NOT_CLIENT_SUPPLIABLE`); `:181-185` refuses a warehouse with no company (`WAREHOUSE_NO_COMPANY`); `reorderCallables.ts:177-178` persists both. `reorderPurchaseOrder` (`:425-431`) inherits the same way (`reorderCommands.ts:236,293-297`).

**Therefore:** `ownerFields: []` is wrong, `unresolvedPolicy` describes a condition the record can no longer be in, and the `note`'s prospective "Adding it is a schema change" describes a change that **has shipped**. `ownershipDerivation.ts:~104` carries the same stale assertion ("carries NO location reference of any kind today").

**Why the disagreement is plausible rather than a contradiction:** the *substantive design* for reorder requests **is** corrected — company derivation, the two refusals, the stored-not-resolved rule are all live and coherent, and OWN-E2E is right that there is no *behavioural* defect here. What is stale is the **matrix row that describes it.** Under this lane's own framing (§3.3, OD-OWN-015) that is the more dangerous failure: the code is fine and cannot be audited against its own description. **Carried as a documentation defect, not a behavioural one — OD-OWN-003 stands.**

---

## 16. Lane closure

- **No field proposed. No collection proposed. No schema proposed.** Every gap is classified into one of the four classes.
- **No generic `ownerId` invented.** The nine concepts stay separate throughout: owner, accountable person, assignee/executor, escalation owner, domain steward, credited salesperson, queue role, approver, company scope.
- **`accountable` / `assignee` / `owner` are never collapsed.** Panel B exists to keep them apart, and its central finding is that EOS can express two of the three.
- **Ownership handoff was not activated.** Its one live door (`assignWarehouseRootCompany.js`) is recorded, not used.
- **No production contact, no deploys, no Firestore reads or writes.** Every figure is from committed code or committed `sb-evidence/` files at `64008d5a`.
- **Files written: this one only.**
- **One coordinator correction declined, with evidence, at §15** rather than silently accepted or silently ignored.
- **Two items adopted but attributed rather than restated as mine:** OWN-E2E's 11-of-13 WRITE-ONLY count (UP-9) and its role-occupancy measurement (UP-10), whose artifact I ask that lane to name.
