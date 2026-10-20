# W-1: Warranty spec (EOS)

**Status:** SPEC. Docs only. No code, no migration, no capability, no grant, no activation, no deploy.
**Issued:** 2026-10-20 (America/Phoenix). **Base:** `main` `b3d09dc3`.
**Plan row:** lane W-1 of the B5 acceptance matrix (`evidence/B5-ACCEPTANCE-MATRIX.md`, lane evidence, not in the repository): stage 10 "Warranty (object, terms, start date; `installed_on` set at install)" is PARTIAL (one optional date) and BLOCKED; commercial scenarios A (retail equipment sale, ends in "warranty") and F (post-installation service).
**Reads:** the D-1 spec (PR #2170, `docs/architecture/d1-delivery-acknowledgment-spec.md` on branch `d1/delivery-acknowledgment-spec`, not yet on `main`), whose OD-17 hands "warranty start and `installed_on`" to this lane.
**Machine-readable companion:** [`w1-warranty-grant-parity.json`](w1-warranty-grant-parity.json) (Firebase-parity holders, derived read-only).
**In flight, not read:** F-1 (invoicing), Q-1 (quotes), S1a (PR #2167). Every link to them below is stated as an interface to confirm, not as a fact about their design.
Every material choice is a numbered **OWNER DECISION** (section 9), with options and a recommendation.

---

## 1. Summary

| Question | Answer |
|---|---|
| Does EOS have a warranty concept? | **One optional date.** `eos_ops.equipment.warranty_expires_on DATE` and `installed_on DATE` exist, are importable, editable by `equipment.record.manage`, and are read on the Equipment record, the Work Order detail, the technician field context and the report catalog. There is no warranty object, no term, no start rule, no status and no claim. |
| Does an install set `installed_on`? | **No.** The install command passes `{ name, notes }` only (`workOrderEquipmentInstall.ts:389`). The engine already accepts `installedOn` (`equipmentCustody.ts:461`); nothing supplies it. Every Equipment minted by an install has `installed_on = NULL` and so can never have a computed warranty start. |
| Did Firebase do better? | Only by accident. The Firebase install command accepted an optional caller-supplied `installedDate` (`installSerializedAssetCommand.ts:150,195,319`) and no warranty field at all. Firebase never computed, derived, judged or stored anything about warranty status. Parity to preserve is therefore thin: two optional dates on Equipment, edited by Admin and Dispatcher. |
| Is warranty a new object or fields on Equipment? | A **coverage record** per Equipment, with terms resolved from a small catalog (OD-1, OD-3). `equipment.warranty_expires_on` stays as the one date every existing reader uses and becomes a projection once coverage exists (OD-2). Recommended. |
| Where does the start date come from? | A coverage record states its start **basis** and the dated fact it used. Recommended default: the install date for a unit Taylor installs, the acknowledged delivery date for a delivery-only unit (D-1 OD-17 A), both from the server clock (OD-6, OD-7). A device clock claim never starts a warranty. |
| What does a service Work Order show? | A derived status, never stored as authority: `IN_WARRANTY`, `OUT_OF_WARRANTY` or `UNKNOWN`, as of the date the problem was reported (OD-9). `UNKNOWN` is the honest answer when no unit or no coverage is recorded, and it is never read as either of the other two. |
| Who decides "claim" versus "billable"? | A person, with the derived status as the prompt (OD-10). The Work Order type `WARRANTY` and the financial class "warranty" stay distinct facts (FIN-BLOCK-002 section 3-4). F-1 consumes the class; this spec does not decide invoicing. |
| Manufacturer claims? | Not in v1 (OD-12). An inbound-created Work Order already carries the manufacturer's `authorizationNumber` / `externalReference` as text; a claim record waits for Returns/RMA and F-1. |
| Does it need a grant? | **Not if the Owner takes OD-14 A.** Firebase held no warranty key, so a new key has an empty parity set and would be a non-parity grant (a STOP). Reusing `equipment.record.read`, `equipment.record.manage`, `workOrder.record.read` and `equipment.model.manage` needs no grant. |
| Can PR 2 be built now? | **No.** Even the smallest slice (the install setting `installed_on`) contains four unruled choices. Section 8. |

---

## 2. What was read

| Subject | Where | Fact that matters |
|---|---|---|
| Equipment table | `functions/migrations/1758585600000_equipment-and-installed-custody.sql:235-236` | `installed_on DATE`, `warranty_expires_on DATE`, both nullable, "real DATEs" for what Firestore stored as `YYYY-MM-DD` text. No start date, no term, no coverage kind, no source. |
| Equipment model | same file, `equipment_models` | Carries `manufacturer_id`, `manufacturer_name`, `model_number`. No warranty term. A `manufacturers` table exists (`1761782400000_manufacturer-catalog-authority.sql`), name and status only. |
| Equipment events | `1764400000000_equipment-activation.sql:49-79` | `CREATED`, `UPDATED`, `INSTALLED`. An edit of a date records a before and after (`equipmentOperations.ts:480-495`). `occurred_at` is `now()`, the server clock. |
| Install | `eosOps/workOrderEquipmentInstall.ts:389,402-408` | One transaction. Equipment attributes `{ name, notes }`. The `INSTALLED` event carries `changes` with name, model, origin and notes: no date. The Work Order must be `WORK_IN_PROGRESS` (`:57`). Install input keys are a closed list with no date (`:231`). |
| Install engine | `eosOps/equipmentCustody.ts:450-462` | Inserts `attributes.installedOn ?? null` and `attributes.warrantyExpiresOn ?? null`. The capability to carry a date is there; the caller never uses it. |
| Business date | `eosOps/operatingCompanyBusinessTime.ts`, DECISIONS #203 | `businessDateOn(db, tenantId, operatingCompanyId, instant)` is "the ONE place domain code asks for a business date". Taylor and Ventana are `America/Phoenix`. |
| Register edit | `eosOps/equipmentOperations.ts:354-381` | `installedOn` and `warrantyExpiresOn` are editable by `equipment.record.manage`, any valid `YYYY-MM-DD`, with no relationship check between them. |
| Import | `dataImport/contracts/equipmentImportContract.ts:97-108,211-218` | CSV import accepts both dates; warns (does not refuse) when expiry precedes install. Synonyms include "warranty". |
| Reads | `workOrderQueries.ts:164-185`, `workOrderFieldContext.ts:158-169`, `reportOperations.ts:359-368`, `reporting/reportCatalog.ts:170-171` | Both dates are returned on the Work Order detail, the technician field context and the report catalog (`dates` field group). |
| Display stance | `field-ops-app-vite/src/domain/equipmentNorthStar.js:24-26` | EQ-D2: "no helper here that compares it to a date ... or produces the words 'in warranty' / 'expired'. A record page that judged warranty status would be asserting a coverage fact no authority in this system holds." **This spec is the authority that sentence waits for** (OD-13). |
| Work Order type | `1761004800000_work-order-object-authority.sql:54`; `types/workOrder.ts:41`; `workOrderEquipment.ts:39` | `WARRANTY` is a type in the enum. It may name an existing Equipment (`OPTIONAL_EXISTING`). Inbound email routes the warranty mailbox to it (`inboundWorkDecisions.ts:88`). It carries no coverage, no charge semantics and no check against the unit's dates. |
| Service billing | `docs/financials/FIN-BLOCK-002_SERVICE_BILLING_DECISION_PACKAGE.md` section 1, 3-4, 10 | "`WARRANTY` is a bare categorization". `serviceFinancialClass` appears nowhere. Recommended there: set on the Work Order by a governed command, distinct from the type; a warranty-class job is excluded from the billing queue with a named reason and wants cost attribution (blocked on FIN-BLOCK-003). The package is Owner-unruled. |
| Cost | `docs/financials/FIN-BLOCK-003_COST_AUTHORITY_DECISION_PACKAGE.md:46` | "Warranty cost: WARRANTY is a WO type only; no cost semantics anywhere. MISSING." |
| Sold warranty | `1759449600000_commercial-schema-parity-numbering-receipts.sql:169`; `salesAgreement/agreementToSalesOrder.ts:133` | A Sales Agreement line has `warranty TEXT`, free text, "a commitment to the customer, settled at sale, read from the Agreement". It is deliberately not copied to the Sales Order and nothing reads it. |
| Responsibility | `docs/specifications/ventana-ice-machine-lifecycle-responsibility-model.md:28,34,79,91`; DECISIONS D-6 | `warrantyResponsibility` is a separate axis. D-6: "Warranty follows the applicable manufacturer/Taylor warranty process", not a lifecycle gate. |
| Cross-franchise | `docs/business-processes/cross-franchise-equipment-receiving-installation.md` section 12 | "Original seller is not the required warranty service provider." The local Taylor services and handles qualifying warranty work. |
| Boundaries set earlier | ADR-006 line 53; assessment section 9; specification line 43 | "No warranty adjudication engine (warranty is at most a reference date field, informational only)." A claim or entitlement engine was **deferred, not rejected**. This spec proposes the smallest step past that line and is explicit about where it stops (OD-1, OD-9, OD-12). |
| Navigation | `navigation/navConfig.js:346,889,1124` | A hidden `service/warranty` item whose recorded gap is "No warranty domain, no capability, no backend." It stays hidden. |
| Register | `docs/roadmaps/business-capability-register.md` section 2 | "Warranty / Service Entitlement": maturity IDENTIFIED. "Who is financially responsible for a given service ... Customer, Taylor Parts, the Manufacturer, a Warranty, a Service Agreement, or an approved goodwill/exception." Trigger: before Service billing is designed. |
| Replacement | ADR-010 section 4 | A replacement retires the old Equipment and installs the new serial as **new** Equipment with `REPLACES` / `REPLACED_BY`. Equipment records are never reused for a new serial. |
| Firebase | `firestore.rules:1334-1363,1468-1508`; `functions/src/access/*` | Equipment read, create and edit are `isAdminOrDispatcher()` in Rules. `installedDate` and `warrantyExpiresDate` are ordinary optional strings, editable in place. There is no `equipment.record.*` or warranty permission key. The report key `report.equipment.field.dates.read` is held by `admin`, `owner`, `reportViewer`. |

---

## 3. What is missing

1. **No start date.** An install leaves `installed_on` NULL. A warranty term with nothing to count from is unusable.
2. **No term.** Nothing says how long, for what (parts, labour, both) or who gave it (manufacturer, Taylor). The only trace is free text on a Sales Agreement line that nothing reads.
3. **No status.** Nothing answers "is this machine in warranty today". The UI deliberately refuses to try (EQ-D2).
4. **No link from a service job to coverage.** A `WARRANTY` Work Order proves the job was *called* warranty, not that it *is*.
5. **No classification of the work.** Billable, covered by the manufacturer, covered by Taylor as goodwill: nothing records which (FIN-BLOCK-002).
6. **No manufacturer claim.** Taylor cannot record that it asked the manufacturer to pay, or what came back.
7. **No evidence for the start date.** The two dates are free to edit with no reason, and edits are audited only as a before and after.
8. **Fields wrongly assumed present.** A report on "warranty expiring" over EOS-installed units returns nothing for any unit installed since activation.

---

## 4. Design

### 4.1 The object (OD-1, OD-2)

Recommended: a **coverage record** that belongs to one Equipment, plus a small **terms catalog**. Equipment keeps `installed_on` as the install fact and `warranty_expires_on` as the one date existing readers use.

```
equipment_warranty_terms         (catalog: what a manufacturer or Taylor promises)
   scope: MANUFACTURER | MODEL    ref: manufacturer_id or equipment_model_id
   coverage: PARTS | LABOR | PARTS_AND_LABOR     months: integer    provider: MANUFACTURER | TAYLOR
   start_basis: INSTALL | ACKNOWLEDGED_DELIVERY | ...    (OD-6)
        |
        v   resolved when the start fact exists, frozen into the record (never re-resolved)
equipment_warranty_coverages     (one row per coverage of one Equipment; append-only)
   equipment_id   coverage   provider   starts_on   ends_on   start_basis   start_fact_ref
   terms_id (nullable: a manual coverage has none)   source: DERIVED | RECORDED   reason
        |
        v   projection, one writer
equipment.warranty_expires_on    = latest ends_on of the coverages (NULL when none)
```

Why a record and not more columns: one machine commonly carries more than one coverage (a manufacturer's parts coverage, a longer compressor coverage, Taylor's labour coverage). Columns on Equipment cannot say which coverage a date belongs to, and an edit destroys the previous answer. An append-only record keeps the sold, the derived and the corrected values side by side.

Why not a full Warranty aggregate with its own lifecycle (registered, claimed, voided, transferred): that is the adjudication engine ADR-006 deferred, and nothing in the repository says what Taylor's registration, void or transfer rules are. The coverage record carries no lifecycle state beyond "ended" being a date.

Why a catalog at all: terms differ by manufacturer and model, and today they live in people's heads and a free-text line. A coverage derived from a catalog row is reproducible; one typed by hand is a record the Owner can audit as hand-entered (`source: RECORDED` with a reason).

**Backfill: none.** Existing Equipment keeps whatever `warranty_expires_on` it has; no coverage rows are inferred from it. For such a unit the status is derived from the recorded date alone and is labelled `RECORDED_DATE` (OD-9), never "covered by X".

### 4.2 Terms (OD-3, OD-4, OD-5)

- **Keyed by** manufacturer, with an optional model override (the most specific row wins). Not by Part: a warranty on a replacement part is a separate question (OD-11).
- **Vocabulary** (v1): coverage `PARTS`, `LABOR`, `PARTS_AND_LABOR`; provider `MANUFACTURER` or `TAYLOR`. Exclusions (travel, consumables, misuse) are free text on the record, not logic.
- **Duration** is whole months. Expiry is the last covered day: `ends_on = starts_on + N months - 1 day`, with month-end clamping in the operating company's business calendar (OD-5). The existing field is documented "When the warranty ends" (`equipmentImportContract.ts:107`), so it already means "last covered day".

### 4.3 Start date (OD-6, OD-8)

The rule belongs to the **term**, and the **fact used** is stored on the record, so the date is explainable:

| Situation | Dated fact | Recommended |
|---|---|---|
| Taylor installs the unit | the server-recorded install event (`equipment_events INSTALLED.occurred_at`), as a business date | start = install date |
| Taylor delivers, customer or third party installs | the acknowledged delivery date (D-1) | start = acknowledged delivery date (D-1 OD-17 A) |
| The unit never came through Taylor stock (register import, a customer's existing machine) | none | no derived coverage. A person with `equipment.record.manage` records one with a start date and a reason (OD-8) |
| Replacement under warranty | the new unit's install | its own coverage; whether it inherits the remaining term is OD-11 |

A device clock claim (`deviceReportedAtMillis`) is evidence only and never starts a coverage (D-1 OD-17 and its section on times).

### 4.4 `installed_on` at install (OD-7)

The install fact is `installed_on`. The recommended source is the business date of the server-recorded install event: `businessDateOn(client, tenantId, wo.operatingCompanyKey, <the INSTALLED event's occurred_at>)`, passed as `attributes.installedOn` to the engine that already accepts it, in the same transaction, with the event's `changes` extended by the date. This is a three-line change and is **not built here**: section 8 lists the four choices inside it.

### 4.5 Warranty status on a service Work Order (OD-9)

A **derived** read, never a stored column. Inputs: the Work Order's Equipment (`work_orders.equipment_id`), its coverage rows (or its recorded date), the **as-of date** (the date the problem was reported, OD-9), and the kind of work.

| Status | Meaning | Rule |
|---|---|---|
| `IN_WARRANTY` | a coverage row whose `starts_on <= asOf <= ends_on` exists | names the coverage(s), provider and kind (parts, labour or both) |
| `OUT_OF_WARRANTY` | Equipment is known, coverage data is complete enough, no coverage spans the as-of date | shows the last `ends_on` |
| `RECORDED_DATE_ONLY` | no coverage row, but `warranty_expires_on` is recorded | shows the date; says plainly that no coverage terms are recorded |
| `UNKNOWN` | no Equipment on the Work Order, or no date and no coverage | fail closed: never rendered as in or out |

`UNKNOWN` is the default and the common case until data exists. It must not be coerced: the Owner's own rule for missing data is "unclassified is UNBILLABLE (fail-closed)" for money (FIN-BLOCK-002 section 9), and the matching rule for a coverage claim is "unclassified is not covered".

### 4.6 Claim versus billable (OD-10)

- Status is a **prompt**, the classification is a **human act**. A job can be in warranty and still produce billable work (misuse, an excluded part, a labour-only window), and a job can be covered by Taylor goodwill with no warranty row (FIN-BLOCK-002 section 3-4 reaches the same conclusion for the type versus the class).
- The classification (`serviceFinancialClass`) is FIN-BLOCK-002's, not this spec's. W-1 supplies one thing to it: `warrantyBasis`, the coverage id the person relied on, so a warranty-class job always points at a coverage record or says it has none.
- F-1 reads the class. A warranty-class job is excluded from invoicing with a named reason ("covered by manufacturer warranty", "covered by Taylor warranty"), never silently. Cost attribution and the manufacturer reimbursement are blocked on FIN-BLOCK-003 and OD-12.

### 4.7 Manufacturer claims (OD-12)

Not in v1. A Work Order created from inbound email already carries the manufacturer's own identifiers as bounded external text, `externalReference` and `authorizationNumber` ("a warranty authorization, a case number", `createWorkOrder.ts:66-75`); they are not authority and resolve no permission. That is the whole v1 claim surface. A claim record (manufacturer, claim number, status, amounts, parts returned) is a Returns/RMA and purchasing question: a manufacturer is not a Supplier in this schema (separate tables), and nothing governs a manufacturer as a receivable counterparty.

### 4.8 Reads per role (OD-13, OD-14)

The recommended design adds **no read capability**. Warranty is shown through surfaces whose gate already exists:

| Surface | Gate (exists today) | EOS holders (ruled, repository seed) | Firebase parity |
|---|---|---|---|
| Equipment record and register | `equipment.record.read` | fieldManager, dispatcher, officeManager, owner, partsAssociate, partsManager; salesperson only through a salesChannel-scoped assignment (`adminPolicy/equipmentActivationDelta.ts`, Controller ruling 2026-10-01 OD-3) | Rules: Admin, Dispatcher |
| Work Order detail and field context | `workOrder.record.read` on a Work Order the caller may read; the assigned Technician through the Work Order | per the Work Order read decision | Technician had no equipment in the Firebase field context (`getWorkOrderFieldContext.ts` has no equipment); Admin and Dispatcher read equipment by Rules |
| Reports | `report.equipment.field.dates.read` | Firebase: admin, owner, reportViewer | same keys, EOS-mirrored |
| Maintaining coverage | `equipment.record.manage` | equipmentRegisterManager (initial holder: Office Manager) | Rules: Admin, Dispatcher edit both dates |
| Maintaining terms | reuse `equipment.model.manage` (OD-14) | Firebase: admin, equipmentCatalogAdministrator | exact parity |

The EOS read set is wider than Firebase's (EOS added Technician, Salesperson and the operational roles on 2026-10-01). That divergence is an existing Owner ruling and this spec neither widens nor narrows it. The EOS write set is narrower than Firebase's (Dispatcher can no longer edit the dates): also existing, also untouched. A role that can see a unit sees its warranty status; no separate "warranty reader" exists.

### 4.9 Links

- **D-1.** D-1 supplies two server-clock dates: the install event time and the acknowledgment time. W-1 owns which one starts the warranty (OD-6), and owns setting `installed_on` (OD-7). D-1 changes nothing in the install command. If D-1's acknowledgment table is not built when W-1 builds, the delivery-only branch of the rule has no fact to use and derives no coverage (it falls to the manual path, OD-8). Neither spec's build order is blocked by the other.
- **F-1.** F-1 owns invoicing. W-1 supplies the status and `warrantyBasis`; FIN-BLOCK-002 supplies the class; F-1 excludes warranty-class work with a reason. This spec changes nothing in billing eligibility or the billing package (DECISIONS #201 rules that delivery, installation and customer acceptance never entitle financed funding: the precedent that an operational event does not itself entitle money).
- **Sales Agreement.** The free-text `warranty` on an Agreement line remains the commitment made to the customer. It is not parsed (OD-16). It is shown beside the derived status so a person can see a promise that exceeds the catalog.
- **Cross-franchise.** Warranty follows the unit and the Taylor warranty process, not the seller (cross-franchise doc section 12). Terms are tenant-wide with an optional per-operating-company override (OD-15).

---

## 5. Firebase-parity holders (A7 method)

Derived read-only from `functions/src/access/{permissionCatalog,compatibilityRoles,governedBusinessRoles}.ts` at `b3d09dc3` using a scratch copy; nothing was written to a role, a grant, a database or a fixture, and nothing was deleted. The result is [`w1-warranty-grant-parity.json`](w1-warranty-grant-parity.json). Findings:

- A new warranty key (`warranty.*`) has **no Firebase holders**. Any grant of one is a non-parity grant and a STOP.
- Every key the recommended design reuses already exists with an Owner-ruled holder set. The JSON lists them.
- EOS holders were **not** read from any environment. The EOS baseline above is the repository seed (`equipmentActivationDelta.ts`), not the live `role_capabilities` table.

---

## 6. Non-goals and boundaries kept

No warranty adjudication or entitlement engine; no automatic decision that a job is free; no customer-facing certificate, portal or registration; no manufacturer claim record or reimbursement; no extended-warranty product or sale; no change to billing eligibility, the billing package, inventory control, title or custody; no change to the install command (see section 8); no Rules or schema change; no un-hiding of `service/warranty`; no Firebase writer.

---

## 7. Proposed build order after the Owner rules (none is started)

1. **W1a. Install records `installed_on`.** The three-line change in section 4.4, with its tests. Needs OD-7 (and OD-6 only to the extent the rule consumes the date).
2. **W1b. Terms catalog and coverage record, derived on install.** Table(s), append-only trigger, the derivation inside the install transaction, the projection to `warranty_expires_on`, a manual-record command on `equipment.record.manage`. Needs OD-1 to OD-6, OD-8, OD-14. The migration is written by the controller from a `.txt` handoff.
3. **W1c. Status read on the Equipment record, Work Order detail and field context.** A pure derived projection; reverses EQ-D2 deliberately (OD-13). Needs OD-9.
4. **W1d. `warrantyBasis` and the class hand-off to FIN-BLOCK-002 / F-1.** Waits on those rulings. Needs OD-10.
5. **Later:** manufacturer claims (OD-12), replacement-part warranty (OD-11), delivery-only derivation (waits on D-1 D1a).

---

## 8. Is PR 2 buildable? No.

The brief builds PR 2 only if there is one governed answer. The candidate is "the install path sets `installed_on` from the server clock when an install completes, where the column already exists and the install command already runs". It was tested:

| Choice inside the slice | Why it is not settled |
|---|---|
| **Which instant.** The install is recorded while the Work Order is `WORK_IN_PROGRESS`; completion is a later, separate edge. | D-1 OD-17 names the install event as the default but is itself an unruled Owner decision on an unmerged PR. The install visit, the install record and the completion can fall on different days. |
| **Offline lag.** An install captured offline syncs later (`technicianIntent.js`; install is a required dependency of completion). The server clock then records the sync, not the work. | Kitchens, basements and rural sites are exactly where signal is missing. Using the server date can start a warranty days late; using the device claim contradicts D-1 OD-17's "never". Either is a ruling, and it moves a customer's coverage by days. |
| **Whose date for a rental.** `recordRentalDeploymentOn` runs in the same transaction for a rental fleet unit. | A rental unit is Taylor's, not sold: stamping `installed_on` and a later warranty start on it may be wrong. Nothing says which. |
| **Whether the technician states it.** The Firebase command accepted a caller `installedDate`. | EOS closed the input list on purpose (`INSTALL_INPUT_KEYS`). Re-opening it reverses a design choice; not opening it removes a Firebase behavior. |
| **Business time zone.** `businessDateOn` needs an operating company with a configured zone. | Default is `'UTC'` (`1764500000000`). An unconfigured company would write a UTC date. Fail-closed versus fall back is unruled. |
| **What the tests pin.** `workOrderEquipmentInstallPostgres.test.mjs` exercises the install transaction and reads the Equipment back; none passes a date. | No existing test would fail, and none would prove the date. A build adds a test per branch above, which is only well-defined once the branches are ruled. |

No part of the slice is a mechanical consequence of settled rulings. Writing it now would choose for the Owner. **PR 2 was not built.**

---

## 9. OWNER DECISIONS

Each has options and a recommendation. Until the Owner rules, the repository stays as it is.

**OWNER DECISION 1. The warranty object.**
Options: (A) Keep two optional dates on Equipment and nothing else. (B) An append-only coverage record per Equipment, resolved from a terms catalog (section 4.1). (C) A full Warranty aggregate with its own lifecycle (registered, claimed, voided, transferred).
**Recommend B.** A cannot say which coverage a date belongs to and loses the previous answer on every edit. C is the adjudication engine ADR-006 deferred, with rules (registration, void, transfer) nothing in the repository defines.

**OWNER DECISION 2. What `equipment.warranty_expires_on` becomes.**
Options: (A) It stays a hand-edited field alongside coverage rows (two answers). (B) It becomes a projection of the latest coverage `ends_on`, written only by the coverage command; existing units keep their recorded value until a coverage is recorded. (C) It is dropped.
**Recommend B.** Every existing reader (Work Order detail, field context, reports, import) keeps working, and there is one writer. C breaks those readers and discards every date already recorded.

**OWNER DECISION 3. Terms: keyed by what, maintained by whom.**
Options: (A) By manufacturer, with an optional model override. (B) By manufacturer, model and Part class. (C) No catalog; every coverage is recorded by hand.
**Recommend A.** It is the resolution the data supports (`equipment_models.manufacturer_id`). B needs a Part-to-warranty mapping nothing holds. C loses reproducibility.

**OWNER DECISION 4. Coverage vocabulary in v1.**
Options: (A) `PARTS`, `LABOR`, `PARTS_AND_LABOR`; provider `MANUFACTURER` or `TAYLOR`; exclusions as text. (B) Add per-component coverage (compressor, evaporator). (C) A single undifferentiated "covered".
**Recommend A.** It is what the claim-versus-billable question needs (OD-10) and no more. C cannot separate a labour-only window.

**OWNER DECISION 5. Duration and expiry arithmetic.**
Options: (A) Whole months; `ends_on = starts_on + N months - 1 day`, month-end clamped, in the operating company's business calendar. (B) Whole months; `ends_on = starts_on + N months` (the anniversary is the last day). (C) Days.
**Recommend A.** It matches the field's documented meaning ("When the warranty ends", last covered day). Whether the anniversary day itself is covered is a business and legal call; **confirm it, because it moves every boundary case by a day.**

**OWNER DECISION 6. The start-date rule.**
Options: (A) Install date for a unit Taylor installs; acknowledged delivery date for a delivery-only unit (D-1 OD-17 A). (B) The acknowledgment date always. (C) The later of install and acknowledgment. (D) Sale or invoice date. (E) A per-term `start_basis`, with A as the default.
**Recommend A as the default, built as E** so a manufacturer whose clock starts at ship or registration is a catalog row and not a code change. D is rejected: it starts the clock before the machine works, and DECISIONS #201 already rules that a commercial or operational event does not stand in for another (there, funding).

**OWNER DECISION 7. `installed_on` at install: which instant, and what offline lag does.**
Options: (A) The business date of the server-recorded install event; a device clock claim is kept as evidence only. (B) A (a), but accept the device claim when the install was captured offline and is within N days of the sync. (C) The technician states the date on the install screen, as Firebase allowed. (D) The Work Order completion date.
**Recommend A.** It is the only option that cannot be mis-stated by a phone, matches D-1 OD-17, and a wrong value is correctable through `equipment.record.manage` with its audit. Its known cost is days of lag for an offline install, which **the Owner should accept or reject explicitly.** D starts coverage after the visit and conflates the install with its paperwork.

**OWNER DECISION 8. A unit that never came through Taylor stock.**
Options: (A) No derived coverage. A person with `equipment.record.manage` records a coverage with a start date and a reason (`source: RECORDED`). (B) Infer from `installed_on` when present. (C) Treat the register date as authoritative for status only.
**Recommend A.** B turns an imported guess into a coverage claim. C is the `RECORDED_DATE_ONLY` display, which is already the fallback in section 4.5.

**OWNER DECISION 9. Warranty status on a Work Order: as-of date and vocabulary.**
Options on the as-of date: (A) The date the problem was reported (the Work Order's creation, in business time). (B) The scheduled service date. (C) The completion date.
**Recommend A.** A customer must not lose coverage because dispatch slipped past the expiry. Options on the vocabulary: (A) `IN_WARRANTY`, `OUT_OF_WARRANTY`, `RECORDED_DATE_ONLY`, `UNKNOWN` as in section 4.5, derived and never stored. (B) A boolean. (C) Stored on the Work Order at creation.
**Recommend A.** B hides the unknown, which is the common case. C stores a derived fact that goes stale when a coverage is corrected.

**OWNER DECISION 10. Claim versus billable: who classifies.**
Options: (A) The status prompts; a person with the Work Order's service authority classifies; W-1 supplies `warrantyBasis`; the class belongs to FIN-BLOCK-002. (B) The system classifies automatically when the status is `IN_WARRANTY`. (C) Warranty is the Work Order type and nothing more.
**Recommend A.** B would decide that work is free from a date; exclusions, misuse and part-versus-labour windows make that wrong often enough to cost money. C is today's gap. Note this does not answer FIN-BLOCK-002's open decisions (the class set, who sets it, whether reclassification needs approval); it only fixes what W-1 gives them.

**OWNER DECISION 11. Replacement units and replacement parts.**
Options: (A) A replacement unit is new Equipment (ADR-010 section 4) with its own coverage from its own install; no inheritance. (B) The replacement inherits the remaining term of the original. (C) A part replaced under warranty carries its own warranty from the repair date.
**Recommend A for units and defer C.** B requires a link between the two records and a rule for terms that differ; C needs a Part-level term (OD-3 B). Both are follow-ups; neither is blocked by choosing A.

**OWNER DECISION 12. Manufacturer claims.**
Options: (A) None in v1; the Work Order keeps the `authorizationNumber` / `externalReference` text it already has. (B) A claim record on the Work Order (manufacturer, claim number, status, amount, parts returned). (C) Full RMA and reimbursement as a receivable from the manufacturer.
**Recommend A.** A manufacturer is not a Supplier in this schema, no counterparty exists to owe the money, and F-1 and FIN-BLOCK-003 are unruled. B follows them. C is the Returns/RMA capability.

**OWNER DECISION 13. Show derived status where EQ-D2 forbade it.**
Options: (A) Yes: the Equipment record, Work Order detail and technician field context show the derived status with its coverage, replacing EQ-D2's "no judgment" with a governed one, once W1b/W1c exist. (B) Keep EQ-D2 for the Equipment page and show status only on a Work Order. (C) Never show status; reports only.
**Recommend A.** The reason for EQ-D2 ("no authority holds the coverage fact") stops being true when OD-1 B is ruled. Until then the pages stay exactly as they are.

**OWNER DECISION 14. Who may maintain terms and coverage (grants).**
Options: (A) Reuse existing keys: `equipment.record.manage` for coverage, `equipment.model.manage` for the terms catalog (holders: Firebase admin and equipmentCatalogAdministrator, exact parity); reads through existing gates; **no new key, no grant**. (B) New `warranty.terms.manage` and `warranty.coverage.record` keys. (C) Add Dispatcher to coverage maintenance (restoring the Firebase Rules reach).
**Recommend A.** B has an empty Firebase parity set, so every holder would be a non-parity grant and a STOP. C is a policy ruling on a role the Owner narrowed on purpose (2026-10-01 OD-3) and is not mine to reopen.

**OWNER DECISION 15. Operating company.**
Options: (A) Terms are tenant-wide; a unit's coverage carries its Equipment's operating company; an optional per-company override exists. (B) Terms are per operating company only. (C) Ventana-sourced equipment is excluded.
**Recommend A.** Taylor and Ventana can differ in practice (D-6 leaves Ventana-specific commercial terms to be captured later), and B duplicates every row for the common case. C is the question D-6 explicitly left open.

**OWNER DECISION 16. The sold warranty text.**
Options: (A) Leave Agreement-line `warranty` as free text; show it beside the derived status; never parse it. (B) Make it a reference to a term at sale (waits on Q-1). (C) Copy it onto the coverage record at install as a note.
**Recommend A now, B when Q-1 settles quoting.** C copies a commercial promise into an operational record (the reason `agreementToSalesOrder.ts:133` does not copy it to the order).

**OWNER DECISION 17. Void, transfer and lapse.**
Options: (A) Out of v1; a coverage can be ended early by recording an `ends_on` correction with a reason. (B) Model void (misuse, unauthorized service) and transfer (change of customer or site). (C) Tie coverage to the customer's relationship (a lapse when the account closes).
**Recommend A.** The repository holds no rule for any of them, and a correction with a reason is auditable and reversible.

**Not decided here, still open:** the service financial class set and who sets it (FIN-BLOCK-002); service invoicing and cost attribution of warranty work (F-1, FIN-BLOCK-003); quote-time warranty terms (Q-1); manufacturer reimbursement and RMA; the legal effect of a warranty statement and its customer-facing wording (counsel); retention of coverage history (counsel); whether Taylor and Ventana honour each other's coverage.

---

## 10. Boundaries

No code, migration, capability, grant, role, Rules, schema or deployment is changed by this document. No Firebase or production system was read or written; every fact above comes from the repository at `b3d09dc3` and the cited evidence. The Firebase writers stay frozen. The install command, the billing package, inventory control and custody are unchanged. The scratch copy used for the section 5 derivation lived in the lane scratchpad and nothing was deleted.
