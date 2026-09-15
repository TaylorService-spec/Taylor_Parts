# Commercial C5 — one-time Commercial data migration and reconciliation (Firestore → PostgreSQL)

Branch `commercial/c5-data-migration`, based on main `f6400cf7`. Wave C5 of the Commercial migration
(Opportunity, Sales Agreement, Sales Order → `eos_commercial` behind the Render trusted API): C1 schema, C2 governed
commands, C3 reads, C4 transport `/commercial/sales` are on main. **C5 preserves whatever Firestore Commercial data must
survive** — or proves, with evidence, that none must.

**Nothing is exported, copied, discarded, frozen or deleted in any environment by this change. C5 was NOT run. C6 was
not begun.** It builds and proves the tooling and writes this plan. No Firebase project and no Render database was
contacted. `firestore.rules`, `functions/src/eosApi/server.ts` and every Firestore writer are unchanged. **This change
adds no migration.**

Mapping classes: **A** canonical (copied) · **B** derived (recomputed or checked, not copied) · **C** legacy
defect/variant · **D2** deferred execution state (NOT migrated as authority; counted) · **E** Owner decision ·
**P** provenance (evidence only) · **F** fixture marker.

---

## 1. Source census (repository truth)

### 1.1 Collections, ids, tenancy, numbering

| Collection | Id | Business number | Firestore counter | Rules |
|---|---|---|---|---|
| `opportunities` (`functions/src/constants/collections.ts:56`) | Firestore auto-id (`opportunityCallables.ts:96` `.doc()`) | `opportunityNumber` `OPP-YYYY-######`, allocated in the create transaction (`opportunityCallables.ts:106`) | `counters/opportunities_YYYY` `{year, sequence, updatedAt}` (`opportunityNumbering.ts:49-55,77-93`) — **global per year** | deny-all (`firestore.rules:1740`) |
| `sales_agreements` (`collections.ts:69`) | auto-id | `salesAgreementNumber` `SA-YYYY-######` (`salesAgreementCallables.ts:198`) | `counters/sales_agreements_YYYY` (`salesAgreementNumbering.ts:52-95`) | deny-all (`firestore.rules:1794`) |
| `sales_orders` (`collections.ts:61`) | auto-id | `salesOrderNumber` `SO-YYYY-######` (`salesOrderCallables.ts:111`, `closeOpportunityAsWon.ts:316`, `createSalesOrderFromOpportunity.ts`); legacy **unnumbered** orders backfilled by `salesOrderNumberBackfill.ts` with the sentinel year `SO-0000-######` (`:51` `UNKNOWN_YEAR_SENTINEL = 0`); fixture numbers `SO-FR-XXXXXX` (`scripts/financialReviewFixtures.mjs:272`) | `counters/sales_orders_YYYY` (`salesOrderNumbering.ts:40-84`) | deny-all (`firestore.rules:1749`) |

Tenancy: none — the Firebase project is the tenant. PostgreSQL identity is `(tenant_id, id)` with the id a global primary
key, numbers `UNIQUE (tenant_id, <number>)` (migration `1758844800000`), counters `(tenant_id, series, year)` (migration
`1759449600000`, `commercialNumbering.ts:335-354`) — **per tenant per year**, same visible format.

**Firestore counters are NOT exported.** The Owner allowlist is exactly the three record collections; `counters` also
holds `work_orders_YYYY`, `receiving_orders_YYYY`, … PostgreSQL counters are seeded from the migrated numbers (§8).

### 1.2 Stored shapes and their writers

**Opportunity** — `persistCreatedOpportunity` spreads `BuiltOpportunity` (`opportunityCommands.ts:149-177`, built at
`:181-236`) minus `createdAtMillis`, plus `opportunityNumber`, `updatedAtMillis` (the optimistic-concurrency token),
`createdAt`/`updatedAt` server Timestamps (`opportunityCallables.ts:108-128`). Transition writes `stage`, `outcome`,
`updatedByUid` and a `closedAt` Timestamp (`:164-169`; the pure `closedAtMillis` is stripped). Edit writes the named
editable fields plus `updatedByUid`, `updatedAtMillis` (`opportunityCommands.ts:289-307,443-445`). Forward links:
`salesAgreementId` (`salesAgreementCallables.ts:214`), `salesOrderId` (`salesOrderCallables.ts:116`,
`closeOpportunityAsWon.ts:322-330`, `createSalesOrderFromOpportunity.ts:265`). Readers also accept legacy `name`,
`createdAtMillis`, `closedAtMillis` (`opportunityReadService.ts:81-128`).

**Sales Agreement** — `tx.set(ref, {...built, salesAgreementNumber, salesOrderId: null, createdAt, updatedAt})`
(`salesAgreementCallables.ts:202-209`) over `BuiltSalesAgreement` (`salesAgreementCommands.ts:265-300`): header facts,
`lines[] {lineId "line-N", kind, ref, businessUnitId, quantity, unitPrice, condition, warranty, estimatedArrivalMillis,
extendedMinor}` (`:148-160`), `totals {subtotal, shipping, installCharge, tax, total, downPayment, tradeIn, balance}Minor`,
`createdByUid`, **`createdAtMillis` / `updatedAtMillis` (the spread keeps them)**. Accept writes `state: ACCEPTED`,
`acceptedAtMillis`, **`acceptedByUid`** (`:383-420`). `salesOrderId` is set by the conversion
(`closeOpportunityAsWon.ts:333`).

**Sales Order** — `BuiltSalesOrder` (`salesOrderCommands.ts:226-275`) with `lines[] {lineId, kind, ref, businessUnitId,
orderedQty, allocatedQty, fulfilledQty, billedQty, unitPrice?}` (`:118-128,170-180`), `bookedAtMillis`, `createdByUid`,
`createdAtMillis`, `updatedAtMillis`; plus `salesOrderNumber`, `sourceOpportunityNumber`, `sourceAgreementId`
(`closeOpportunityAsWon.ts:336-345`). Later writers — **all D2 execution state**: `allocateSalesOrder.ts:182-188`
(`lines[].allocatedQty`, `fulfillmentReadiness`, `fulfillmentReadinessCounts`, `allocatedAt`),
`createServiceForSalesOrder.ts:228-232` (`state: IN_FULFILLMENT`, `serviceWorkOrderIds`), `invoiceCallables.ts:96`
(`lines[].billedQty`), and the **Work Order → Sales Order fulfillment write-back** `transitionWorkOrder.ts:450,621-623`
over `salesOrderFulfillmentWriteBack.ts` (`lines[].fulfilledQty`, `state`). Known legacy defects: "seven of fourteen
sandbox orders" unpriced (`salesOrderCommands.ts:189`), orders with no `operatingCompanyId` (FIN-001), unnumbered
orders (backfill).

**Fixtures in the same collections:** Certification world records (`certificationWorld` marker / `dataProvenance:
SYNTHETIC_CERTIFICATION_FACT`, the rule `catalogSnapshot.ts:362-366`), and the FINANCIAL_REVIEW_P1 orders (marker
`financialReviewP1`, `scripts/financialReviewFixtures.mjs:66,241-275`).

**Responsibility fields.** Owner `ownerEmployeeId` (a canonical Employee ref, required until D-4). Accountable person
`accountableEmployeeId` + `accountablePersonSource` — written only from a minted establishment
(`accountablePersonStorage.ts:69-98,429-445`); **there is no Firestore accountability history** (Owner ruling
2026-09-14: PostgreSQL is the accountability audit authority). Credited salesperson `creditedSalespersonId` (FIN-002).
Legacy actor uids `createdByUid`, `updatedByUid`, `acceptedByUid`. Firestore audit events (`auditEvents`, via
`stageAuditEventWithId`) are idempotency/audit of the Firestore callables and are **not migrated** (not allowlisted;
PostgreSQL `command_receipts` are idempotency only).

**Previously measured population (not re-measured here).** `eos-platform-sandbox`: `opportunities` 14,
`sales_agreements` 5, `sales_orders` 17, all owner-RESOLVED, all "non-fixture"
(`docs/assessments/eos-ownership-model-reconciliation.md:281-292`, `docs/implementation-plans/eos-ownership-backfill-plan.md:401-403`);
14 live orders at the phantom-link audit (`docs/audits/phantom-sales-order-repair/dry-run-evidence-package.md:21`).
**Production `taylor-parts`: unmeasured.** The authorized export + census (§9, §10) replaces these numbers.

### 1.3 Readers (Firestore, all to move or retire at C6/C7)

`opportunityReadService.ts` (incl. a lineage read of the wrong collection name `salesOrders`, `:410-425` — legacy
defect), `salesAgreementReadService.ts`, `salesOrderReadService.ts:353,438,591`, `coordinatedVisitReadService.ts:197`,
`allocateSalesOrder.ts:106,125`, `invoiceCallables.ts:80`, `transitionWorkOrder.ts:450`,
`createServiceForSalesOrder.ts:140`, the callables' own duplicate checks, and client hooks through those callables
(`field-ops-app-vite/src/hooks/useOpportunities.js`, `modules/sales/*`, `modules/accounts/Account*Section.jsx`).

---

## 2. Canonical mapping (executable form: `functions/src/commercialMigration/commercialC5Snapshot.ts` `FIELD_DISPOSITIONS`)

Every stored field is classified; **an unclassified field blocks** (`UNCLASSIFIED_SOURCE_FIELD`). A value the governed
C2 authority would refuse blocks — never repaired, defaulted or guessed.

### 2.1 Opportunity → `eos_commercial.opportunities` + `opportunity_lines`

| Firestore | Target | Class | Rule |
|---|---|---|---|
| doc id | `id` | A | verbatim |
| `opportunityNumber` | `opportunity_number` | A | `OPP-YYYY-######` exactly; missing/invalid/duplicate → blocker |
| `accountId` | `account_id` | A | must resolve in `eos_crm.accounts` of the tenant (§5) |
| `ownerEmployeeId` | `owner_employee_id` | A | must resolve as a same-tenant Employee (any status) → else `OWNER_UNRESOLVED` |
| `accountableEmployeeId` + `accountablePersonSource` | `accountable_employee_id` + ONE `accountability_handoffs` ESTABLISHMENT | A | §7 |
| `creditedSalespersonId` | `credited_salesperson_employee_id` | A | same-tenant Employee; absent → NULL |
| `operatingCompanyId` | `operating_company_key` | A | governed registry (`commercialCompanyScope.ts`); absent → NULL |
| `salesChannel`, `stage`, `outcome` | enums | A | exact vocabularies (`opportunityLifecycle.ts`); missing stage → blocker (a lifecycle is never invented) |
| `closedAt` Timestamp / legacy `closedAtMillis` | `closed_at` | A / C | required iff outcome |
| `need`, `nextAction` | text | A | trimmed; blank → NULL |
| `expectedValue`, `expectedCloseAt` (epoch ms) | `expected_value`, `expected_close_at` | A | finite number / valid ms |
| `lines[] {kind, ref, qty}` | `opportunity_lines (line_number = position)` | A | kind vocabulary, trimmed ref, positive integer qty |
| `createdAt` / legacy `createdAtMillis` | `created_at` | A / C | microseconds; neither → `CREATED_AT_MISSING` (never fabricated) |
| `updatedAt` / `updatedAtMillis` / else `created_at` | `updated_at` | A / C | |
| `updatedAtMillis` (version token) | — (`edit_version = 1`) | B | PostgreSQL versions start fresh |
| `salesAgreementId`, `salesOrderId` | — | B | recomputed from children; disagreement → `LINEAGE_FORWARD_LINK_DISAGREES` |
| `createdByUid`, `updatedByUid` | — | P | evidence file only; `created_by`/`updated_by` = the C5 EOS Principal |
| `name` | — | E | no target column → blocker `FIELD_REQUIRES_OWNER_DECISION` |
| `accountabilityExceptionId` | — | E | no governed exception writer/column → blocker |
| `certificationWorld`, `dataProvenance` | — | F | record excluded (ids + reason) |
| `financialReviewP1` | — | F | fixture provenance (§4) |

### 2.2 Sales Agreement → `eos_commercial.sales_agreements` + `sales_agreement_lines`

As §2.1 for id, number (`SA-`), account, owner, accountable, credited, company, timestamps (legacy
`createdAtMillis`/`updatedAtMillis` C), uids P. Plus: `sourceOpportunityId` → `opportunity_id` (A; must be a selected
Opportunity of the same Account; one Agreement per Opportunity); `state` (A); `currency` (A, `USD` or NULL);
`locationId`, `customerPO`, `isLease`, `fulfillmentIntent`, `shippingInstructions`, `shipVia`, `specialInstructions` (A);
`totals.{shipping,installCharge,tax,downPayment,tradeIn}Minor` → `*_minor` (A); `totals.{subtotal,total,balance}Minor` and
`lines[].extendedMinor` (B, recomputed arithmetic); `acceptedAtMillis` → `accepted_at` (A; required iff ACCEPTED);
**`acceptedByUid` (P) → `accepted_by` = the C5 EOS Principal** (E-ruled default, §10); `lines[]` → `sales_agreement_lines`
with `lineId` (B: must be `line-<position>`, else `LINE_ID_NOT_POSITIONAL` — downstream line references would break),
`businessUnitId` → `business_unit` (A; legacy absent → derived for EQUIPMENT_MODEL/PART via `deriveLineBusinessUnit`,
an ambiguous SERVICE line blocks), `unitPrice` → `unit_price_minor` (an ACCEPTED line must be priced), `condition`,
`warranty`, `estimatedArrivalMillis` → `estimated_arrival_at`. `salesOrderId` (B, checked).

### 2.3 Sales Order → `eos_commercial.sales_orders` + `sales_order_lines`

As §2.1 for common fields (`SO-`). Plus `sourceOpportunityId` → `opportunity_id`, `sourceAgreementId` →
`sales_agreement_id` (A; same tenant and Account, the Agreement's Opportunity = the Order's, the Agreement ACCEPTED, one
Order per Opportunity and per Agreement); `sourceOpportunityNumber` (B echo; must equal the Opportunity's number);
`operatingCompanyId` → `operating_company_key` (A; **NOT NULL** — missing → `COMPANY_REQUIRED`); `state`, `salesChannel`,
`currency`, `locationId`, `customerPO`, `notes` (A); `bookedAtMillis` → `booked_at` (A; legacy absent → NULL, advisory);
`lines[].{kind, ref, businessUnitId, orderedQty, unitPrice}` (A; unpriced legacy lines carried as NULL, advisory — a
price is never invented). **D2, not migrated as authority, counted in the census:** `lines[].allocatedQty`,
`lines[].fulfilledQty`, `lines[].billedQty`, `fulfillmentReadiness`, `fulfillmentReadinessCounts`, `allocatedAt`,
`serviceWorkOrderIds`.

### 2.4 Never migrated

Firestore `counters/*`; Firestore `auditEvents` (idempotency/audit of the legacy callables); any `command_receipts`
(C5 writes none); ownership handoffs (a creation owner has none in C2 either); Certification fixtures; D2 execution
state.

---

## 3. Tooling

```
exportCommercialSnapshot.js (Firestore, read only, FIREBASE_EXIT_MIGRATION_ONLY) → commercial-snapshot.json + .sha256
   → commercialC5.js --mode census | copy | verify (PostgreSQL; loads no Firebase module)
```

### 3.1 Exporter — `functions/scripts/exportCommercialSnapshot.js` (the migration-only exception)

First line literally `// FIREBASE_EXIT_MIGRATION_ONLY`. Only `db.collection(assertAllowlisted(name)).get()` over exactly
`opportunities`, `sales_agreements`, `sales_orders`. Timestamps tagged `{$timestamp}`, any other Firestore type
`{$unsupported}` (the census blocks it). Output and `.sha256` created `wx`, 0600, never overwritten. **Fence before
firebase-admin loads:** `--environment` declared in `config/environments.json`; `--projectId` refused (the project is the
registry's); `--confirmProduction` refused (no production mode); production by role or project refused;
`platform-certification` / `eos-platform-certification` refused; `--out` required and absent. No write verb, no schedule,
no handler, no delete. **Structural test:** no module under `functions/src`, `field-ops-app-vite/src`, `integrations`
references it; not in `package.json`; workflows name it only as a path filter. Retired with the legacy writers (C7).

### 3.2 Snapshot format

`{format: "EOS_COMMERCIAL_SNAPSHOT", version: 1, source: {environmentId, firebaseProjectId, exportedAt},
opportunities: [{id, data}], salesAgreements: [...], salesOrders: [...]}` — any other top-level key is refused.

### 3.3 `functions/scripts/commercialC5.js`

Fence before `pg`/lib (subprocess-proved): `--mode`; `--environment` registry + production refusal + `--databaseUrlEnv`
(shared `assertMeasurementTarget`); `EOS_ENVIRONMENT=nonprod` (shared `assertNonprodRuntime`); not
`platform-certification`; `--tenantKey`, `--snapshot`; copy additionally `--principalId` and a 64-hex
`--confirmMigrationRequired`; any Certification inclusion option and any `--confirmProduction` refused. After the fence:
checksum must match; the snapshot must name the environment and its registry project and never `taylor-parts`; copy
refuses unless `--confirmMigrationRequired` equals the snapshot sha256 **and** the disposition is
`MIGRATION_REQUIRED_OR_OWNER_REVIEW` — both before any database connection.

---

## 4. The disposition decision — discard + reseed vs migrate

`decideDisposition` (`commercialC5Snapshot.ts`), pure and ordered:

1. **Production source** (`taylor-parts`), any count **including zero** → `STOP_FOR_OWNER_DECISION`. Production is never
   declared empty or disposable by a tool.
2. No records (nonprod) → `NO_SOURCE_RECORDS`.
3. Every record is an identified Certification fixture or carries a fixture marker (`financialReviewP1`) →
   `DISPOSABLE_FIXTURE_ONLY`, basis `ALL_RECORDS_FIXTURE_PROVENANCE`.
4. An **Owner ruling** covers the environment (registry `OWNER_DISPOSITION_RULINGS`: **D3**, 2026-09-14,
   `platform-sandbox`/`eos-platform-sandbox`, recorded census 14/5/17), the snapshot holds **no more records per family**
   than that census, and **no record without fixture provenance carries a VALUE SIGNAL** → `DISPOSABLE_FIXTURE_ONLY`,
   basis `OWNER_RULING_D3`.
5. Otherwise → `MIGRATION_REQUIRED_OR_OWNER_REVIEW` (basis `RECORDS_WITHOUT_FIXTURE_PROVENANCE`,
   `OWNER_RULING_D3_NOT_APPLICABLE:VALUE_SIGNALS` or `…:COUNTS_EXCEED_RECORDED_CENSUS:<families>`).

**Value signals ("looks valuable")** — downstream business effects, on a record WITHOUT fixture provenance: any Sales
Order line `billedQty > 0` (invoiced money), `fulfilledQty > 0` (goods moved), non-empty `serviceWorkOrderIds`
(operational work), or state `CLOSED`. Lifecycle position alone (ACCEPTED, WON) is reported, not a signal. The census
lists every record without fixture provenance and every signal, so the Owner sees exactly what a DISPOSABLE decision
would discard.

**Outputs.** `DISPOSABLE_FIXTURE_ONLY` → documented path **DISCARD + RESEED**: do not copy; preserve the census output,
the snapshot and its sha256 as evidence; reseed nonprod through the governed synthetic seed
(`scripts/seedSyntheticNonprodWorkforce.js`). **No C5 tool deletes a Firestore document** (the source is retired with
C7, not by C5). `MIGRATION_REQUIRED_OR_OWNER_REVIEW` → STOP for review; migrate only with explicit confirmation once
every blocker is clear. `STOP_FOR_OWNER_DECISION` → report the census; there is no production copy in this change.

Census exit code: 0 when copy-ready or decided without copy (DISPOSABLE / NO_SOURCE_RECORDS); 1 otherwise.

---

## 5. Census (read only) — what it measures

**Source** (`censusCommercialSnapshot`): counts and exact ids per family; Certification exclusions (counts, ids,
reason); fixture provenance; every finding with family/id/code/detail; advisories; numbers per series/year (count,
max, exact numbers), sentinel-year numbers, duplicates; D2 field presence and records with non-zero execution
quantities; lifecycle distribution; lineage (§2.2-2.3); every referenced Employee, Account, site and catalog ref; legacy
uid provenance; the disposition; the canonical digest.

**Target** (`measureC5Target` + `finalizeC5Census`, one READ ONLY transaction): each person through the governed
PostgreSQL Employee authority (`createPostgresEmployeeAuthority`, same tenant); Accounts against `eos_crm.accounts`;
sites against `eos_crm.account_locations` (advisory — no FK); PART/EQUIPMENT_MODEL refs with the #1911 probe shape
(restated; parity-tested against `postgresCatalogReferenceAuthority`) — an absent Part Master schema is
`CATALOG_REFERENCES_UNVERIFIABLE`, **never FOUND**; the tenant's existing rows (unknown rows, already-present rows,
declared synthetic seed rows retained only with `--retainDeclaredSyntheticSeedRows`); ids held by another tenant;
numbers held by another record; counters and the counter seed plan; the **accountability plan** (§7);
**gating conditions** (§9).

Blockers (target): `OWNER_UNRESOLVED`, `CREDITED_SALESPERSON_UNRESOLVED`, `ACCOUNTABLE_PERSON_UNRESOLVED`,
`ACCOUNTABLE_PERSON_NOT_CURRENTLY_ELIGIBLE` (actionable only), `ACCOUNTABLE_PERSON_UNDERIVABLE`,
`EMPLOYEE_AUTHORITY_UNAVAILABLE` (never read as a verdict), `ACCOUNT_UNRESOLVED`, `CATALOG_REFERENCE_NOT_FOUND` /
`_WRONG_KIND` / `CATALOG_REFERENCES_UNVERIFIABLE`, `ID_HELD_BY_ANOTHER_TENANT`, `NUMBER_HELD_BY_ANOTHER_RECORD`,
`TARGET_HAS_UNKNOWN_RECORDS`, and `DISPOSITION_<non-migrate>`. **Any source finding blocks the whole copy.**

---

## 6. Copy and verify (`functions/src/commercialMigration/commercialC5Target.ts`)

### 6.1 Copy — ONE transaction

Under `pg_advisory_xact_lock('commercial-c5|<tenant>')`: production source / STOP disposition refused unconditionally;
confirmation must name the snapshot; tenant exists; `--principalId` is an active Principal with an active membership
(a Firebase uid is refused as a non-member); **the target census is re-measured inside the transaction** and must be
copy-ready. Per family in FK order (Opportunities → Agreements → Orders):

* absent → `INSERT` verbatim id, number, facts, lines, `created_at`/`updated_at`; actor columns = the Principal;
* present and identical (every canonical field, lines, accountable person) → nothing;
* present and different → `DRIFT_DETECTED`, roll back, **never overwritten**;
* tenant rows the snapshot does not hold → `TARGET_HAS_UNKNOWN_RECORDS` (in-transaction census), roll back.

After each insert: the accountable person (§7), then `updated_at` restored to the preserved source value (the governed
writer stamps `now()`, which describes the migration, not the business record). **No `command_receipts`.** Counters
seeded (§8). One `eos_policy.audit_events` row `commercial.c5.copy` (snapshot sha256, canonical digest, counts,
accountability summary, counter actions, exclusions) only when something was written. Rerun of the same snapshot:
`NO_CHANGES`, nothing written.

### 6.2 Verify — commits nothing

One REPEATABLE READ transaction, always rolled back: counts and exact ids per family (retained synthetic rows excluded);
field-by-field equality of **every** record incl. lines; number continuity (every migrated number on its id, format valid,
no duplicate in the tenant); counters (`last_value ≥` highest migrated sequence per series/year, and a **probe
allocation** through `allocateCommercialNumber` inside a savepoint that is rolled back — it must exceed the migrated max
and not collide); owner / credited / accountable resolve in the tenant; accountability history (exactly one
ESTABLISHMENT with a recorded source per record, history ends at the current person); Account FK validity; lineage;
Certification fixtures absent; no actor column (`created_by`, `updated_by`, `accepted_by`, `recorded_by`) holds a legacy
uid, and every actor is an EOS Principal; receipts naming migrated records reported.

---

## 7. Accountability history

No Firestore accountability history exists; nothing is fabricated or backdated. Each migrated record gets **exactly one
ESTABLISHMENT** row (`previous_accountable_employee_id` NULL → generated `action = ESTABLISHMENT`), `recorded_by` = the
C5 Principal, `eligibility_policy_id = COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1`, `source` as below, `reason`
`C5_MIGRATION_* snapshot:<sha16>`.

| Source record | Plan | Writer |
|---|---|---|
| recorded person resolves, currently eligible (ACTIVE / CONTRACTOR) | `GOVERNED_ESTABLISHMENT`, recorded source | `mintGovernedAccountablePerson` → **`stageCommercialAccountablePersonChange(..., "ESTABLISHMENT")`** (#1905), the C2 creation path |
| recorded person resolves, NOT eligible, **HISTORICAL** record (Opportunity WON/LOST, Agreement ACCEPTED/DECLINED, Order CLOSED/CANCELLED — `accountablePersonStorage.ts:136-163`) | `HISTORICAL_PRESERVED`, recorded source, `reason` carries the employment status | the writer's exact column set, direct: the mint refuses a not-currently-eligible person **by design** (#189 MI-ε), while #186 §7 keeps historical accountability valid. Same single-row, same columns, same generated action; proven equal in shape by the PG suite |
| recorded person resolves, NOT eligible, ACTIONABLE record | blocker `ACCOUNTABLE_PERSON_NOT_CURRENTLY_ELIGIBLE` | — (a governed handoff at the source first) |
| recorded person does not resolve | blocker `ACCOUNTABLE_PERSON_UNRESOLVED` | — |
| no recorded person; owner resolves and is currently eligible | `GOVERNED_ESTABLISHMENT`, source `DERIVED_FROM_RECORD_OWNER` (#181 rung 2), listed in `derivedAccountablePersons` | mint + #1905 writer |
| no recorded person; owner not eligible or unresolved | blocker `ACCOUNTABLE_PERSON_UNDERIVABLE` | — |
| recorded person without a recorded source / unreadable value | blocker (`…_SOURCE_UNRECORDED`, `…_UNREADABLE`) | — (the source is never inferred) |

Owner ≠ Accountable ≠ Assignee: the owner is copied verbatim; the accountable person is never defaulted from the owner
except by the explicit rung-2 rule above; no assignee exists in these families.

---

## 8. Number continuity

* Every migrated record keeps its id and its business number verbatim; format validated against
  `formatCommercialNumber` (parity test); duplicates per series block; a missing number blocks (run the governed backfill
  at the source first — the migration never mints a number).
* `number_counters` per `(tenant, series, year)` = **max(existing counter, highest migrated sequence)** — inserted if
  absent, raised if lower, untouched if higher; never lowered. Sentinel-year numbers (`SO-0000-…`) are preserved and seed
  no counter (`year` CHECK 1970..9999; no allocation ever targets year 0).
* After the copy the next governed allocation is the migrated max + 1 (proven by the verify probe and by a real C2
  `createOpportunity` in the PG suite).
* **E — numbers above the seed.** Firestore counters are global per year and not exported: numbers consumed by
  excluded Certification/fixture records, or by any record not migrated, can be re-issued in PostgreSQL. Default: seed
  from migrated numbers (the spec). Alternative requiring an Owner decision: seed from the max over every snapshot number
  including exclusions, or add the three `counters/*` documents to a separately authorized export.

---

## 9. Gating conditions (C5 cannot run until each is met)

1. **CRM cutover reconciled** (draft PR #1916): every `account_id` resolves in `eos_crm.accounts` of the target tenant
   and the CRM verify evidence is attached. Until then the census reports `ACCOUNT_UNRESOLVED`.
2. **Catalog cutover reconciled** (`catalog-cutover-plan.md`) for PART / EQUIPMENT_MODEL line references; before it the
   probe answers NOT_FOUND / UNVERIFIABLE and blocks.
3. **Employee authority populated** (`eos_workforce`, migration `1759838400000` on main): owners, credited salespersons and
   accountable persons of the tenant.
4. **Disposition decided**: `MIGRATION_REQUIRED_OR_OWNER_REVIEW` confirmed by the Owner for copy; a DISPOSABLE outcome
   takes the discard + reseed path instead.
5. **Freeze before export** (§10): the snapshot copied is exported after the Firestore Commercial writers are frozen.
6. **Production**: an authorized read-only census of `taylor-parts`, a production tenant mapping and an Owner decision.
   **This change has no production mode**; production is STOP by construction (fence, snapshot source, disposition,
   copy guard).

---

## 10. Interplay with the C6 cutover and C7

* **C6 cutover rule: never both Firebase and Render mutation authority for the same operation.** Sequence per
  environment: census (pre-freeze, resolve blockers at the source through governed paths) → **freeze** every Firestore
  Commercial writer (the Rules are already deny-all; the Admin-SDK callables `createOpportunity`, `transitionOpportunity`,
  `updateOpportunity`, `closeOpportunityAsWon`, `createSalesOrderFromOpportunity`, `createSalesAgreement`,
  `updateSalesAgreementDraft`, `acceptSalesAgreement`, `createSalesOrder`, `transitionSalesOrder`, and the D2 writers that
  touch `sales_orders` — `allocateSalesOrder`, `createServiceForSalesOrder`, `issueInvoice`'s `billedQty` write, the
  Work Order write-back — need a retirement switch, as the catalog lane's) → export → census must be copy-ready → copy →
  rerun `NO_CHANGES` → verify reconciled → only then does C6 open the Render mutation path (grant Commercial
  capabilities, point clients at `/commercial/sales`). Rollback before C6 opens writes = discard the copied tenant rows
  through a separately authorized, audited operation; after that, no silent revert.
* **D2 is deferred:** allocation, fulfillment and billing quantities, service Work Orders and invoices are not migrated
  as authority. A D2 lane owns them.
* **C7 — the Work Order → Firestore Sales Order fulfillment write-back** (`transitionWorkOrder.ts:450,621-623`,
  `salesOrderFulfillmentWriteBack.ts`) **must be removed or fail closed at cutover**: after C6 a Work Order completion
  would otherwise write `fulfilledQty`/`state` into a frozen Firestore order that is no longer the authority. Noted here;
  not implemented in C5.
* The exporter and every legacy Firestore Commercial writer/reader are removed in C7; the snapshot + census remain as
  evidence.

---

## 11. Proof

* `functions/test/commercialC5Migration.test.mjs` (offline, in `test:adminPolicy`, 20 tests): exporter marker, exact
  allowlist, read-only verbs, `wx`/0600, fences, encoding; **structural: no runtime module reaches the exporter, the CLI
  or `src/commercialMigration`**; no Firebase (static + runtime probe); no C2 command layer / catalog authority import;
  parity (V1 policy, fixture marker, D3 census, number format, sentinel year); field classification coverage of every
  Firestore writer; census (counts/ids, Certification exclusion, canonical rows, D2 exclusion, uid provenance only,
  numbers, lineage, legacy shapes); disposition (production STOP incl. empty, empty nonprod, all-fixture, D3, D3 overruled
  by value signals and growth, other environments); finalize (accountability plan, owner/accountable/Account/catalog
  blockers, outage ≠ verdict, counters max(existing, migrated), unknown rows, synthetic retention); CLI post-fence checks.
* `functions/test/operatorScriptEnvironmentFence.test.mjs`: 19 subprocess refusals (12 CLI, 7 exporter), each before any
  client library loads.
* `functions/test/commercialC5MigrationPostgres.test.mjs` (real postgres:16, in `test:adminPolicyPostgres`, migrations
  pinned by name): catalog probe = #1911 adapter; census copy-ready; uid / other-tenant Principal / missing confirmation /
  production refused; exact copy with Principal attribution, one audit event, no receipts, no ownership handoff,
  fixtures absent; accountability rows (governed, derived, historical preserved); no uid in any column; counters and
  rolled-back probe; verify reconciled; rerun `NO_CHANGES`; drift refused and not overwritten; verify detects field
  change, uid attribution and a lowered counter; a real C2 create allocates the next number and then makes a rerun refuse;
  counters raised-not-lowered; tenant isolation; the CLI end to end with no connection string, `:password@` or password in
  any output.
* `functions/test/governedOwnershipWriterCensus.test.mjs` + `docs/security/ownership-accountability-bypass-census.md`
  rows 15k/15l and §5.2 rows 11-12 classify the two modules.
* Two existing ratchets name C5 as their one sanctioned outside importer, exactly: `commercialSchemaParity.test.mjs` (18)
  admits `commercialC5Target.ts` as a reader of `commercialNumbering` (the rolled-back verify probe), and
  `commercialAccountabilityHistory.test.mjs` (15) admits it as an importer of the #1905 writer. No runtime entry point
  reaches either (STRUCTURAL test).
* **Negative controls** (each red, then restored byte-identically): counter seeded below the migrated max; the Principal
  membership fence removed so a uid becomes `created_by`; the Certification exclusion bypassed; the production copy guard
  removed.

---

## 12. Unresolved facts and Owner decisions

* **Unresolved — live shape and counts.** Sandbox and production populations are unmeasured until an authorized export.
  The previous sandbox census (14/5/17, non-fixture) predates accountability storage and D2 quantities.
* **E — `accepted_by`.** Default: the C5 Principal (recorder semantics, like `created_by`), the legacy `acceptedByUid`
  kept as evidence. Alternative: a governed uid → Principal resolution, which would need its own ruling (a uid is never a
  Principal id).
* **E — counter seed above migrated numbers** (§8).
* **E — `name`, `accountabilityExceptionId`** on a record: no target; blocker until ruled.
* **E — declared synthetic seed rows** in the nonprod tenant: retained with the explicit flag, or removed first.
* **E — historical accountable persons no longer eligible:** preserved (§7) per #186 §7; confirm the `reason` wording as
  the evidence of record.
* **E — actionable records whose accountable person is ineligible / underivable:** resolved at the source by a governed
  handoff before the freeze (default), or an Owner-approved exception.
