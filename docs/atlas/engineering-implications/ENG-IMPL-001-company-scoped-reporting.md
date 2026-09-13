# ENG-IMPL-001 — Company-scoped reporting over company-neutral objects

> **MODE: EVIDENCE_WRITE.** Design and documentation only. This entry changes no runtime code, no
> test, no configuration, no schema. It proposes no migration and **adds no field to any object.**
>
> **BASELINE:** `64008d5ae0bdd9532909671b15a91122400accf1` = `ATLAS-BASE-2026-09-12-A`.
> Every code-derived fact below carries `file:line` and **OBSERVED AT: 64008d5a**.
>
> **Matrix and permission-catalog counts in this entry were produced by static parse of the
> TypeScript source at this baseline, not by executing it.** `functions/lib/` is not built in this
> worktree, `functions/node_modules/` is absent, and the Firestore emulator cannot run here. No
> figure below is presented as an executed result.

---

## Register fields

| Field | Value |
|---|---|
| **SOURCE NORTH STAR** | **An Owner ruling, not a page.** The Atlas Design r1 artifacts are not in the repository at this baseline: `docs/atlas/` does not exist (created by this entry) and `docs/north-star/` carries no reporting surface. The governing rulings are the five company-scope rules in [the register](./README.md#standing-rules-an-entry-may-not-contradict), plus matrix rulings **D-8, D-10, D-11, D-12, D-13, D-15** and **R-8** as recorded in `functions/src/ownership/ownershipMatrix.ts:1-47,76-93`. |
| **USER NEED** | "Show me *my company's* customers, contacts, sites and equipment — and don't show me the other company's." Stated by a Taylor or Ventana operator who has been told the two operating companies are separate businesses. |
| **DESIGN ELEMENT** | A company selector / company context on the report builder, and a company-scoped report result. |
| **CURRENT EOS STATUS** | **`MISSING`.** Not "partial". Nothing in the reporting stack can scope a report to a company today, and the one object whose company *is* authoritative cannot be filtered on it either, because the field is not in the report catalog. See § 1. |
| **OBSERVED BASELINE** | `64008d5ae0bdd9532909671b15a91122400accf1` |
| **TYPE** | `READ MODEL / PROJECTION` (primary) · `OBSERVABILITY / AUDIT` · `TESTABILITY` · `DATABASE / SCHEMA` (secondary, projection storage only) · `PERFORMANCE` (secondary, the scan-bound interaction) |
| **AUTHORITY IMPACT** | **A derived company reach must never become an ownership claim.** The projection proposed in § 4 records *reach* (which company's authoritative facts touch this record), and reach is not ownership, not custody, and not a company field on the neutral object. It writes nothing back onto Account / Contact / Location. It is a second *reader* of company authority, never a second *author* of it — the distinction `ownershipMatrix.ts:29-33` draws for `inheritanceSource` and D-1 forbids collapsing. |
| **WORKFLOW IMPACT** | Today: no company scoping exists, and every report is silently whole-tenant. Under this design: a runner sees an explicitly *labelled* result — company-scoped, company-derived, or company-neutral — and can tell which. The behaviour change users will feel most is that some results will be honestly labelled **neutral** rather than appearing to be their company's. |
| **PROPOSED DIRECTION** | §§ 3–6 below. In one line: **do not filter neutral objects; derive reach in a rebuildable projection keyed by the deriving fact, and label every result with its scope class — and refuse, rather than silently widen or silently narrow, where neither is possible.** |
| **DEPENDENCIES** | Owner decisions `OD-R1`…`OD-R10` (§ 8). Technically: none — no other lane blocks this design. |
| **ACCEPTANCE / PROOF** | § 7, including the negative case. |
| **IMPLEMENTATION STATUS** | **`NOT AUTHORIZED`** |

---

## 1. What the baseline actually is

### 1.1 The engine

| Fact | Evidence (OBSERVED AT: 64008d5a) |
|---|---|
| Report execution reaches exactly **four** objects. `validateReportDefinition` defaults its activated set to `objectsWithPopulatedFields()`. | `functions/src/reporting/reportQueryValidation.ts:84-86`; `functions/src/reporting/reportCatalog.ts:224-226` |
| Those four are the objectIds **`customer`, `contact`, `location`, `equipment`** — over collections `accounts`, `contacts`, `locations`, `equipment`. The other eight catalog objects are `fieldsPopulated: false`. | `functions/src/reporting/reportCatalog.ts:85-97` |
| **The engine issues no `where()` at all.** The fetch is `db.collection(object.collection).limit(maxScanDocs + 1).get()` — no predicate, no `orderBy`. Every filter, group, sort and aggregate runs in memory over that page. | `functions/src/reporting/reportExecutionService.ts:497-500`, `553-586` |
| Bounds: `MAX_RESULT_ROWS = 10_000`, `MAX_SCAN_DOCS = 20_000`, `MAX_GROUP_CARDINALITY = 1_000`. | `functions/src/reporting/reportExecutionService.ts:136-147` |
| Relationship traversal is **one hop, outbound only**: the join reads a reference field *on the base document* and fetches that document by id. | `functions/src/reporting/reportExecutionService.ts:766-812`; `reportQueryValidation.ts:70-77`; `reportCatalog.ts:203-210` (`hop: 1`) |
| Authorization is evaluated at a **fixed global scope with an empty condition** — `{ scope: { type: "global" }, condition: {} }`. No company scope is ever passed. | `functions/src/reporting/reportExecutionService.ts:420` |
| The permission model **does** already have an `operatingCompany` scope type, value-matched like `domain`/`location`, introduced for financial visibility reach. Reporting does not use it. | `functions/src/types/access.ts:21-33` (`operatingCompany` at `:33`), `:25-32` (the FIN-BLOCK-001 note); resolver `functions/src/access/resolveEffectivePermission.ts:103,173`; a live consumer at `functions/src/finance/financeReadCallables.ts:121` |

### 1.2 `operatingCompanyId` does not appear anywhere in the reporting stack

A grep for `operatingCompanyId` across `functions/src/reporting/`, `field-ops-app-vite/src/domain/reporting/` and `field-ops-app-vite/src/access/report*.js` returns **nothing** at this baseline.

The consequence corrects the brief's framing:

> **`equipment` is `SINGLE_COMPANY` and its company *is* authoritative — but it is still not filterable through the report engine, because `operatingCompanyId` is not a field in the report catalog.**

`EQUIPMENT_FIELDS` is `name, status, manufacturer, model, serialNumber, assetTag, installedDate, warrantyExpiresDate, notes, accountId, locationId, createdAt` — twelve fields, no company (`functions/src/reporting/reportCatalog.ts:163-176`). Meanwhile the ownership matrix declares `equipment.ownerFields = ["operatingCompanyId"]` (`functions/src/ownership/ownershipMatrix.ts:461-463`).

So the brief's arithmetic needs restating. A fix that only adds a `where()` closes **zero of four** objects, not one of four. Closing `equipment` requires a **catalog field + a capability + an activation decision** first; only then is there anything for a predicate to bind to.

### 1.3 There is no index for a company predicate

`firestore.indexes.json` contains **zero** occurrences of `operatingCompanyId` (count: 0, **OBSERVED AT: 64008d5a**). A server-side company predicate combined with any sort would require a new composite index on every scoped collection.

### 1.4 All 39 `report.*` capabilities are `active: false` — a correction to the brief

The brief states that "all 25 production-activated capabilities are `report.*` — the reporting family is the only family activated in production." **That is not the state at this baseline.** Measured by static parse of `functions/src/access/permissionCatalog.ts`:

| Measure | Value at `64008d5a` |
|---|---|
| Catalog entries | 147 |
| `active` (grantable) | 38 |
| `active: false` (hard, unconditional DENY regardless of any Role grant — `functions/src/types/access.ts:69-80`) | 109 |
| **`report.*` entries** | **39** |
| **`report.*` that are `active`** | **0** |

The 39 are listed at `functions/src/access/permissionCatalog.ts:640-935` (`report.customer.*` 640-741, `report.contact.*` 744-784, `report.location.*` 787-822, `report.equipment.*` 825-883, `report.definition.*` 907-936).

**Where the brief's figure came from.** Commit `0dd5e104` — *"fix(access): Reporting had eligibility control and no activation control (#1768)"*, 2026-09-02, DECISIONS #166 — flipped every `report.*` entry from `active: true` to `active: false`. Its own message records the pre-fix state: *"36 of 39 report.\* were catalogued active:true, which in this architecture means LIVE IN EVERY ENVIRONMENT"*. Static parse of `0dd5e104^:functions/src/access/permissionCatalog.ts` confirms 36 active `report.*` of 72 active entries. So the brief's figure is a **pre-`0dd5e104` recollection**, and neither 25 nor 36 describes `64008d5a`.

**Why this matters to the design rather than being pedantry.** Two things follow:

1. **Company-scoped reporting has no production exposure today.** Every `report.*` capability resolves to DENY for every principal, so `runReportDefinition` returns `kind: "permission-denied"` (`functions/src/reporting/reportExecutionService.ts:421-450`) for every real caller — admin included. This is a design window, not an incident. Nothing is leaking company-crossed data today because nothing can run.
2. **The activation boundary is the natural place to seat a company rule.** Because activation is already a per-capability, fail-closed gate that an override set can only *add* to (`functions/src/access/environmentCapabilityOverrides.ts:1-25`), "a `report.*` object capability may not be activated until its company-scope class is declared" is enforceable at a gate that already exists, rather than requiring a new one.

There is also a **stale comment defect** worth recording: `functions/src/access/permissionCatalog.ts:637-638` still reads *"Every other wave-1 field/object id is `active: true` — their review IS the merged Specification itself."* At `64008d5a` none of them is. `0dd5e104` changed the values and not the paragraph above them. **Not fixed by this entry** (EVIDENCE_WRITE forbids touching `functions/`); recorded for a lane that may.

### 1.5 The client seam is wired, and its own header says otherwise

`field-ops-app-vite/src/domain/reporting/reportExecutionSeam.js:32-40` calls `httpsCallable(functions, "runReportDefinitionCallable")` and maps the real outcome. Its header at `:10-14` still describes the seam as resolving unconditionally to `unavailable`, and `functions/src/reporting/runReportDefinitionCallable.ts:9-11` and `functions/src/index.ts:172-183` repeat that claim. The seam is live; only the capability gate (§ 1.4) makes it inert. Recorded as a second **documentation-vs-code drift**, not changed here.

---

## 2. The two-column question — `companyScopeField` + `COMPANY_NEUTRAL`

**The Owner's question:** rows at `ownershipMatrix.ts:148-150`, `:157-159`, `:167-169` declare `companyScopeField: "operatingCompanyId"` **and** `companyScope: "COMPANY_NEUTRAL"` together. Contradiction, legitimate distinction, or data defect?

**Verdict: a legitimate distinction, correctly valued — and a latent trap in the naming that this design must route around.** Not a data defect. Not a contradiction.

### 2.1 What each column means, in the file's own words

| Column | Declared at | The file's own definition |
|---|---|---|
| `companyScope` | `ownershipMatrix.ts:97`; doc comment `:34-36` | An **ownership-shape** column. "`SINGLE_COMPANY / CROSS_COMPANY_CAPABLE / COMPANY_NEUTRAL` (ruling D-10 — a transfer between a Taylor and a Ventana site has no single owning company, and picking one would be the false owner the ruling warns about)." It answers *is a company the owner, and if so, one or two?* |
| `companyScopeField` | `ownershipMatrix.ts:94`; doc comment `:76-93` | **"This column is NOT ownership."** It is "the ORTHOGONAL operating-company axis a PERSON-owned record may also carry" (ruling R-8). "A Sales Order owned by Rudy and booked to Taylor is one record with two true, independent facts… It exists so the financial lineage Sales Order -> Invoice -> Payment can inherit a company without anyone concluding the company displaced the salesperson." |

The three rows in question are `opportunity`, `salesAgreement`, `salesOrder` — all `ownerClass: "PERSON"` (`:142`, `:155`, `:163`). For a PERSON-owned family the honest value of an *ownership-shape* column is "no company owns this" = `COMPANY_NEUTRAL`. That the record nonetheless *carries* a company for lineage is the other column's business. The two statements are both true and they are about different things.

### 2.2 The trap, and why rule 4 cannot be decided from `companyScope`

The column is named `companyScope` but does not mean "is this company-scoped". For three families the two readings diverge:

| Family | `companyScope` | `companyScopeField` | Is a `where(operatingCompanyId == x)` predicate legitimate? |
|---|---|---|---|
| `account` (`accounts`) | `COMPANY_NEUTRAL` | **absent** | **No.** No such field exists. Matches zero documents. |
| `contact` (`contacts`) | `COMPANY_NEUTRAL` | **absent** | **No.** |
| `location` (`locations`) | `COMPANY_NEUTRAL` | **absent** | **No.** |
| `opportunity` | `COMPANY_NEUTRAL` | `operatingCompanyId` | **Yes** — authoritative, explicit-or-inherited, never inferred. |
| `salesAgreement` | `COMPANY_NEUTRAL` | `operatingCompanyId` | **Yes.** |
| `salesOrder` | `COMPANY_NEUTRAL` | `operatingCompanyId` | **Yes** — and `ownershipMatrix.ts:164-166` calls this "the one that matters", because every financial artifact downstream inherits from it. |
| `equipment` | `SINGLE_COMPANY` | absent (it is in `ownerFields` instead, `:462`) | **Yes** — via `ownerFields`, not `companyScopeField`. |
| `transferOrder` | `CROSS_COMPANY_CAPABLE` | absent (`participatingFields`, `:450`) | **No — see § 3.** A scalar equality predicate is the wrong shape. |

**So the decision procedure the Owner's rule 4 needs is:**

```
a company equality predicate is legitimate on a family iff
      family.companyScopeField is present            (the R-8 lineage axis)
   OR family.ownerFields includes an operating-company field   (the D-12/D-15 ownership axis)
   AND family.ownerClass !== "PARTICIPATING_COMPANIES"          (shape guard, § 3)
```

`companyScope` alone decides it correctly for `accounts`/`contacts`/`locations` **by coincidence** — those three have neither column populated — and incorrectly for `opportunity`/`salesAgreement`/`salesOrder`. **Both columns are required.** That is the direct answer to the Owner's question of whether "has no such authoritative field" can be decided from `companyScope` alone: **it cannot.**

### 2.3 Neither column has a runtime reader

| Symbol | Consumers at `64008d5a` |
|---|---|
| `companyScopeField` | **None.** Declaration (`ownershipMatrix.ts:94`) and three assignments (`:148`, `:157`, `:167`) only. One test *mentions* it in an assertion message: `functions/test/crmCustomerPostgres.test.mjs:274`. |
| `companyScope` | **No production reader.** The only accessor is `crossCompanyFamilies()` (`ownershipMatrix.ts:566-573`), whose sole consumer is a test (`functions/test/ownershipModel.test.mjs:31,212`). The client has an independent, hand-maintained restatement at `field-ops-app-vite/src/metadata/administration/objectAdministrationProfile.js:208-216,386` with per-object profiles for `invoice`, `part` and `payment` only. |
| `participatingCompanyFamilies()` | **Zero callers anywhere** — dead export at this baseline (`ownershipMatrix.ts:556-559`). |

This is the second half of the verdict: the distinction is legitimate, and **nothing enforces it**. A future reader who takes `companyScope === "COMPANY_NEUTRAL"` as "no company field exists" gets three families wrong and no test fails. The design in § 4 therefore treats the decision procedure in § 2.2 as something that must be **expressed once, in code, with a test** — not restated in prose in a third place.

---

## 3. `CROSS_COMPANY_CAPABLE` — what it is, who holds it, and what a report must do with it

### 3.1 Establishing the term

| Question | Answer (OBSERVED AT: 64008d5a) |
|---|---|
| Where is the vocabulary declared? | `functions/src/ownership/ownershipMatrix.ts:67` — `type CompanyScope = "SINGLE_COMPANY" \| "CROSS_COMPANY_CAPABLE" \| "COMPANY_NEUTRAL"` |
| Distribution across the 51 matrix families (static parse) | **`SINGLE_COMPANY` 20 · `COMPANY_NEUTRAL` 30 · `CROSS_COMPANY_CAPABLE` 1** — total 51. By `ownerClass`: `PERSON` 6, `COMPANY` 20, `PARTICIPATING_COMPANIES` 1, `REFERENCE` 7, `EXCLUDED` 17. |
| Which object holds `CROSS_COMPANY_CAPABLE`? | Exactly one: **`transferOrder` / `transfer_orders`** (`ownershipMatrix.ts:447-457`; `companyScope` at `:453`). Pinned by `functions/test/ownershipModel.test.mjs:212`. |
| What is its bound? | `participatingFields: ["sourceOperatingCompanyId", "destinationOperatingCompanyId"]` (`ownershipMatrix.ts:450`) — "the two company references that TOGETHER constitute the record's ownership shape. Deliberately not `ownerFields`" (`:76-82`). `ownerFields: []`, `ownerType: null`, `transfer: "N_A"`. |

**A correction to the brief's counts.** The brief gives `SINGLE_COMPANY` 15 and `COMPANY_NEUTRAL` 9. Static parse at this baseline gives **20 and 30**. The `1` for `CROSS_COMPANY_CAPABLE` is correct. The discrepancy is not a counting difference over the same set: the matrix builds 25 syntactic blocks, five of which are `.map()` spreads over id tuples (5 financial, 2 physical roots, 6 reference, 17 excluded), so counting literal `companyScope:` occurrences undercounts by 26. Neither 15 nor 9 matches any subset I can reconstruct — `ownableFamilies()` at this baseline is 27 (20 + 6 + 1). The count should be re-derived before it is quoted anywhere.

### 3.2 The sibling lane's finding — **verified, with an important refinement**

The brief reports that a sibling lane found the bound to be *a participating pair, not single-field equality*. **That is correct about `transferOrder`, and the pair is not the discriminator.**

`inventoryTransaction` / `inventory_transactions` declares the **same** `participatingFields` pair (`ownershipMatrix.ts:390`) while being `ownerClass: "COMPANY"` and `companyScope: "SINGLE_COMPANY"` (`:391`). The census reads the pair there only as a fallback when no scalar owner is present (`functions/src/ownership/ownershipCensus.ts:125-156`).

> **So "carries a participating pair" ≠ `CROSS_COMPANY_CAPABLE`.** The load-bearing discriminator is **`ownerClass === "PARTICIPATING_COMPANIES"`**, which is what the census (`ownershipCensus.ts:103-124`) and the handoff refusal (`functions/src/ownership/ownershipHandoffCommand.ts:101-106`) both actually branch on. A scoping rule written against `companyScope` or against "has a pair" would mis-handle `inventory_transactions`.

### 3.3 What the pair *is* at this baseline — a declared shape, not a produced one

| Layer | Evidence | State |
|---|---|---|
| Firestore **write** path | `functions/src/inventoryTransfer/transferOrderRepository.ts:57-85` (`serializeTransferOrder`); only caller `functions/src/inventoryTransfer/transferOrderCommand.ts:250` | **Never writes either field.** A newly created transfer order carries no company facts at all. |
| Firestore **read** path | `transferOrderRepository.ts:87-95` (`STORED_KEYS`, pair at `:94`), `:105` (unknown-field rejection), `:106-110` (both-or-neither + `isOperatingCompanyIdShape`) | **Tolerate-and-validate.** A backfilled document is accepted; a half-pair or malformed id throws `TransferMalformedStoredRecordError`. |
| Typed model | `functions/src/inventoryTransfer/transferOrderTypes.ts:52-60`, `:62-77`; reader `transferOrderRepository.ts:162-184` | **Tolerate-and-drop.** Neither field appears on any transfer-order type. Read, shape-checked, discarded. |
| A scalar `operatingCompanyId` on a transfer order | absent from `STORED_KEYS` ⇒ rejected by `transferOrderRepository.ts:105`; asserted by `functions/test/ownershipFieldStrictReaders.test.mjs:72-76`; refused again at `functions/src/eosOps/migration/purchasingMigrationMapping.ts:777-784` ("a transfer order carries a participating pair, never a scalar operatingCompanyId") | **Actively refused.** |
| Who ever wrote the pair | `functions/src/ownership/ownershipBackfillRules.ts:186-210`, cap `transfer_orders: 47` at `:225`; applied by `functions/scripts/ownershipSandboxBackfill.js` | A one-time, Owner-authorised **sandbox backfill script**. No production command. |
| Sandbox measurement | `sb-evidence/ownership-census-sandbox-2026-08-30.json:697` (47 scanned, 47 ownerless, "no participating companies recorded") → `sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.json:639` (47 resolved) | The shape is real storage **in the sandbox only**. |
| Rules | `firestore.rules:1199-1204` | Read gated on `fromWarehouseId`/`toWarehouseId` via `isAssignedToWarehouse`; **no company predicate**; `create, update, delete: if false`. |
| Indexes | `firestore.indexes.json:511-524` | The only `transfer_orders` index is `status ASC, createdAt DESC`. **No company index exists.** |
| Postgres estate — a different story | `functions/migrations/1758672000000_purchasing-object-authority.sql:379-390` (`source_operating_company_key` / `destination_operating_company_key` both `NOT NULL`; **`is_cross_company` GENERATED** at `:389-390`), index at `:428`, rationale `:77-95`; per-leg projection `functions/src/eosOps/purchasingRepository.ts:698-719` (`transferLegOperatingCompanyKey`: OUT⇒source, IN⇒destination) | The pair is **mandatory, NOT NULL, indexed, and accompanied by a generated `is_cross_company` flag**. The design in § 4 should reuse this vocabulary rather than invent one. |
| A guard refusing a scalar company predicate against a `PARTICIPATING_COMPANIES` family | — | **Does not exist at this baseline.** No query/report/scoping code consults `ownerClass` or `companyScope` before applying a company filter. The four refusals that do exist are storage/domain-level, not query-level: `ownershipHandoffCommand.ts:101-106`, `transferOrderRepository.ts:105-110`, `purchasingMigrationMapping.ts:769-784`, `functions/src/inventoryLedger/operationalMovementRepository.ts:244-251`. |

### 3.4 What a company-scoped report must do with a participating-pair bound

`transfer_orders` is **not** one of the four objects report execution reaches today (`reportCatalog.ts:85-97`) — there is no `transferOrder` report object at all. So this section is a **rule to be established before such an object is catalogued**, not a defect to be fixed.

The rule, and why each clause:

1. **A scalar equality predicate is forbidden by shape, not merely unsupported.** `where(operatingCompanyId == "taylor")` against `transfer_orders` matches zero documents *and* asserts a false thing — that one company owns the movement. `ownershipMatrix.ts:437-445` records that "source always owns it" and "destination always owns it" were **both rejected** as conventions, because "either would record a company as responsible for a movement it may only have received."
2. **The legitimate predicate is participation, not equality**: `sourceOperatingCompanyId == x OR destinationOperatingCompanyId == x`. A Taylor-scoped report must include a Taylor→Ventana transfer, because Taylor participated in it.
3. **Every such row must be labelled with its participation role and its cross-company status.** A Taylor→Ventana transfer appearing in a Taylor report is not a Taylor-owned row; presenting it as one is the D-10 false-owner error re-entering through a report. The Postgres estate already names the fact: `is_cross_company` (`1758672000000_purchasing-object-authority.sql:389-390`). A report row should carry the same three facts — `participationRole ∈ {SOURCE, DESTINATION, BOTH}` and `isCrossCompany`.
4. **A total over participating rows is not additive across companies.** Sum the same cross-company transfer into both a Taylor and a Ventana report and a consolidated figure double-counts it. Given the engine already refuses an aggregate over a truncated scan on exactly this "a wrong total is worse than a slow one" reasoning (`reportExecutionService.ts:79-101`, census X-9, FIN-004), the consistent answer is that **an aggregate over a `PARTICIPATING_COMPANIES` object under a single-company scope must be refused, not reported** — unless the Owner rules how a participating row is attributed (**`OD-R6`**, § 8).
5. **Half a pair is not a scope.** `transferOrderRepository.ts:106-110` already refuses a half-pair at read; a projection must inherit that and classify such a record `UNRESOLVED`, never assign it the one company it does name.

---

## 4. The derivation paths that actually exist at this baseline

Method: for each of the four report objects, find every record type that carries **both** an
authoritative operating-company fact **and** a reference to that object. Report the *strength* of
the company fact, because the evidence shows the strengths differ by more than the presence does.

**Strength vocabulary** used in the tables below:

| Strength | Meaning |
|---|---|
| `REQUIRED` | The creation path **refuses** the record without a governed company. Reproducible for every new record. |
| `REQUIRED-AT-COMMIT` | Nullable in a draft state; refused at the committing transition. |
| `OPTIONAL` | Written when supplied, `null` otherwise. No guard. |
| `FIXTURE-BACKFILL-ONLY` | **No live writer stamps it.** Storage exists only because a one-time, capped, Owner-authorised sandbox backfill wrote it onto fixture records. **A record created today gets no company.** |
| `ABSENT` | The field does not exist on the document at all — a *model* gap, not a data gap. |

### 4.1 `customer` (collection `accounts`) — **derivation exists, and is strong**

| Deriving fact | Company field | Strength | Ref to account | Evidence (OBSERVED AT: 64008d5a) |
|---|---|---|---|---|
| `sales_orders` | `operatingCompanyId` | **`REQUIRED`** | `accountId` (required) | `functions/src/salesOrder/salesOrderCommands.ts:274-282` (`COMPANY_REQUIRED`, "never inferred or defaulted"), typed non-nullable at `:228`, stored `:287`; `accountId` required `:256`, stored `:284` |
| `invoices` | `companyId` (= `attribution.operatingCompanyId`) | **`REQUIRED`** | `accountId` + `attribution.customerId` | `functions/src/finance/invoiceCommands.ts:132-137` — the guard the brief names, **verified** (at `:132-137`, not `:106`): refuses an invoice whose Sales Order has no resolved `operatingCompanyId`. Re-asserted `:254-257`; caller's `companyId` is assertion-only (`COMPANY_MISMATCH`, `:138-143`); structural invariant `companyId === attribution.operatingCompanyId` at `:292-293,314`; stored `:294-295` |
| `payments` | `companyId` | **`REQUIRED`** | `accountId` | `functions/src/finance/paymentCommands.ts:120,142-143` via `requireInvoiceParty`, `functions/src/finance/financialAttribution.ts:262-286` (`COMPANY_REQUIRED` `:269-271`) |
| `invoice_adjustments` | `companyId` | **`REQUIRED`** | `accountId` | `functions/src/finance/adjustmentCommands.ts:89,115-116` |
| `refunds` | `companyId` | **`REQUIRED`** | `accountId` | `functions/src/finance/refundCommands.ts:80,92-93` |
| `payment_applications` | `companyId` | **`REQUIRED`** | `attribution.customerId` only — **no bare `accountId`** | `functions/src/finance/paymentCommands.ts:155-157`; `financialAttribution.ts:305` |
| `sales_agreements` | `operatingCompanyId` | **`REQUIRED-AT-COMMIT`** | `accountId` (required) | `functions/src/salesAgreement/salesAgreementCommands.ts:354-361` (`COMPANY_REQUIRED` at accept — "A DRAFT may negotiate company-unresolved (R-14 posture); committing that way is refused HERE"); nullable at draft `:304`; `accountId` `:279,300` |
| `opportunities` | `operatingCompanyId` | `OPTIONAL` — no guard | `accountId` (required) | `functions/src/opportunity/opportunityCommands.ts:175` (`resolveCommercialCompanyScope`), typed `string \| null` `:137`; `accountId` `:153,172` |
| `equipment` | `operatingCompanyId` | **`FIXTURE-BACKFILL-ONLY`** | `accountId` (required, immutable) | Declared `ownershipMatrix.ts:461-462`; sole writer `functions/src/ownership/ownershipBackfillRules.ts:125-138` (`if (!isFixture(doc.data)) return PROTECTED`), cap 278 at `:222`; the live create path `functions/src/equipmentInstall/equipmentImportCommand.ts:62-63` has no company in its allowed-keys list; `accountId` `:103,193` |
| `inbound_work_requests` | `operatingCompanyId` | `OPTIONAL` **and ungoverned** | `customerId` | `functions/src/inboundWork/inboundIntakeCommand.ts:279`; the value is a bounded 120-char string never validated against `operatingCompanyAuthority` (`functions/src/inboundWork/inboundRouting.ts:128-130`) — **not usable as an authoritative derivation source** |
| `fieldops_wos` (governed Work Order) | — | **`ABSENT`** | `customerId` (required) + `locationId` (required) | `ownershipMatrix.ts:248-254` (`ownerFields: []`, "MEASURED 0/30 — the collection has no company storage at all"); `functions/src/types/workOrder.ts:94-95`; `functions/src/createWorkOrder.ts:87-91,108-113` |
| `crm_activities` | — | **`ABSENT`** | `accountId` + `contactId` | `functions/src/crmActivity/crmActivityCommands.ts:114-115`; no company field (confirmed: the only file in `functions/src` mentioning both `operatingCompanyId` and a contact-shaped field is `permissionCatalog.ts`, and there only as capability ids) |

**Verdict for Accounts: `COMPANY_DERIVED` is achievable and well-founded.** Six record types give a
`REQUIRED` company alongside an account reference.

### 4.2 `location` (collection `locations`, a **customer site**) — **derivation exists but is thin**

`locations` is a customer site, explicitly disjoint from our own physical roots
(`ownershipMatrix.ts:139`: "A CUSTOMER site, not one of ours. Distinct from warehouses/stock_locations").
The disjointness is **enforced**, not merely documented: `functions/src/crm/customerIdentity.ts:196-211`
throws `CrmLocationNamespaceError` on any attempt to give a CRM site an inventory-location
discriminator, and `:213-218` records that `eos_crm.account_locations` has **no `locationId` field at
all**, "so that no future reader can union the two on the strength of a shared spelling."

> **Consequence:** no warehouse / `mobile_locations` / bin / truck company may ever reach a customer
> `locations` record. That entire family of derivations is closed by ruling and by a throwing guard.

| Deriving fact | Company strength | Ref to `locations` | Evidence |
|---|---|---|---|
| `sales_orders` | **`REQUIRED`** | `locationId` — **optional in storage** (`null` when absent) | `salesOrderCommands.ts:297`; `field-ops-app-vite/src/metadata/definitions/salesOrder.js:149-164` (`referenceTo: "location"`). A separate path does require it: `functions/src/salesOrder/createServiceForSalesOrder.ts:154` |
| `sales_agreements` | `REQUIRED-AT-COMMIT` | `locationId` — optional | `salesAgreementCommands.ts:309`; `field-ops-app-vite/src/metadata/definitions/salesAgreement.js:82-88` |
| `equipment` | **`FIXTURE-BACKFILL-ONLY`** | `locationId` — **required and referentially enforced twice** | `functions/src/equipmentInstall/equipmentImportCommand.ts:155-160` (in-transaction: refuses unless `location.accountId === input.accountId`); `firestore.rules:1438-1443` (`equipmentLocationBelongsToAccount()` enforces the same on every client create/update) |
| `fieldops_wos` | **`ABSENT`** | `locationId` (required) | as § 4.1 |

> **The structural finding: there is no record type at this baseline that carries BOTH a `REQUIRED`
> company AND a `REQUIRED` reference to a customer `locations` document.** The strongest company
> (`sales_orders`) has an optional location; the strongest location (`equipment`, required and
> doubly-enforced) has a company no live writer produces.

**Verdict for Locations: `COMPANY_DERIVED` is achievable but with materially lower coverage, and the
coverage figure must be reported, not assumed.**

### 4.3 `contact` (collection `contacts`) — **no authoritative derivation exists. Say so.**

This is the honest gap, and it is exhaustive rather than a failure to look. Every contact-shaped
storage site in the repository:

| Storage site | Evidence | Carries a company? |
|---|---|---|
| `crm_activities.contactId` | `functions/src/crmActivity/crmActivityCommands.ts:115` (optional, `string \| null`) | **No.** The same command writes `accountId` at `:114` and no company field of any kind. |
| `accounts.billingContact.contactId` | `field-ops-app-vite/src/metadata/definitions/account.js:287-300` | **No.** `accounts` is `COMPANY_NEUTRAL` with no company field (`ownershipMatrix.ts:118-125`). |
| `contacts.accountId` | `functions/src/crm/customerMigrationSource.ts:304` ("a Contact is a person AT an Account; there is no unparented Contact") | Points *away* from any company. |

One near-miss, named so it is not later mistaken for a path: `functions/src/inboundWork/inboundCandidateResolution.ts:75-78`
queries `contacts` by sender email from a company-bearing record — and stores the contact's
**`accountId`**, discarding the contact id. Even the one code path that reaches `contacts` from a
company-bearing record keeps no edge back to the contact.

The canonical type is decisive: `ContactRecord` is `{ id, tenantId, accountId, name, email, phone,
contactRole, isPrimary, ownerEmployeeId }` — `functions/src/crm/customerIdentity.ts:244-254`.
`AccountRecord` (`:235-241`) and `AccountLocationRecord` (`:220-232`) are the same shape story:
**`tenantId` and `ownerEmployeeId`, and no company field of any kind.**

> **Verdict for Contacts: NO AUTHORITATIVE DERIVATION EXISTS AT THIS BASELINE.** A Contact's company
> can be reached only transitively, through its parent Account — and ruling R-15
> (`functions/src/ownership/commercialCompanyScope.ts:17-20`) forbids putting a single company on the
> Customer to make such a chain resolve. A transitive Account-inherited reach is therefore **at best
> a second-order derivation whose confidence cannot exceed the Account's**, and it is an Owner
> decision (`OD-R7`, § 8) whether it may be offered at all or whether Contact reports are simply
> declared company-neutral.
>
> This is the honest answer the brief asked for in preference to an invented join.

### 4.4 `equipment` — `SINGLE_COMPANY`, directly filterable in principle, **not filterable today**

| Fact | Evidence |
|---|---|
| The matrix declares `ownerFields: ["operatingCompanyId"]` | `ownershipMatrix.ts:461-463` |
| `backfillSource: null` — "No deterministic source exists: every candidate on the record (customer, title holder, location name) is a prohibited proxy. No mass assignment." | `ownershipMatrix.ts:465-467` |
| The field is **not in the report catalog** — so no predicate can bind to it | `functions/src/reporting/reportCatalog.ts:163-176` |
| No live writer produces it | `ownershipBackfillRules.ts:125-138` (fixture-only); `equipmentImportCommand.ts:62-63` |
| The client authority hard-codes the company as UNKNOWN with an explicit anti-inference reason | `field-ops-app-vite/src/domain/equipmentNorthStar.js:150-170` |

So `equipment` needs three things before a company predicate is meaningful, in this order:
a **live writer** for the field, a **catalog field + capability**, and an **activation decision**.
A `where()` is the last of the three, not the first.

### 4.5 Population, measured — and what the measurement is worth

From `sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.json` (and its `.txt` twin),
the repository's own recorded sandbox census, **dated 2026-08-30 and therefore predating this
baseline**. Cited as repository evidence, **not** as a measurement I performed; the emulator cannot
run in this environment and no production or sandbox contact was made.

| Collection | scanned | resolved | ownerless | Reason recorded for the gap |
|---|---|---|---|---|
| `sales_orders` | 17 | 17 | 0 | — |
| `sales_agreements` | 5 | 5 | 0 | — |
| `opportunities` | 14 | 14 | 0 | — |
| `invoices` | 1 | **0** | 1 | the one pre-guard invoice carries no company |
| `equipment` | 288 | 278 | 10 | `no operatingCompanyId` — **fixture-authored, not writer-produced** |
| `fieldops_jobs` | 45 | 41 | 4 | `no operatingCompanyId` — fixture-authored |
| `fieldops_wos` | 30 | **0** | 30 | `family has no ownership storage yet` — a **model** gap |
| `warehouses` | 5 | **0** | 5 | `family has no ownership storage yet` |
| `mobile_locations` | 7 | **0** | 7 | `family has no ownership storage yet` |
| `accounts` | 103 | 100 | 3 | *person* owner (`accountOwner`), **not a company** |
| `contacts` | 339 | 337 | 2 | *person* owner |
| `locations` | 183 | 180 | 3 | *person* owner |

Two cautions attach to this table:

1. **The census JSON's family labels for the two service collections are inverted relative to the
   matrix at this baseline.** The evidence file records `workOrder → fieldops_jobs` and
   `workOrderLegacy → fieldops_wos`; the matrix at `64008d5a` records the opposite
   (`ownershipMatrix.ts:248` and `:267`). The matrix documents the correction and why it mattered
   at `ownershipMatrix.ts:203-216` — `family` is the handoff command's audit `targetType`. **Read
   this table by COLLECTION, never by family name.** The collection-level facts are unaffected.
2. **Two matrix rows are stale and must not be quoted.** `ownershipMatrix.ts:287-296` says
   `reorder_requests` carries no `warehouseId` — superseded; `functions/src/reorderRequest/reorderCommands.ts:138-140`
   now requires it. And `ownershipMatrix.ts:327-336` still declares `stock_locations`, a collection
   retired by BIN-P2 (`functions/src/constants/collections.ts:24-36`: "nothing in this repository
   writes, reads, indexes, seeds or extracts `stock_locations` any more").

---

## 5. The read-model shape

### 5.1 Why a projection is *required*, not merely convenient

The Owner's sketch is a projection keyed by `(object, recordId, derivedCompanyId, derivingFactType,
derivingFactId)`. Asked to justify or reject it on the evidence: **justify the key, with four
additions and one prohibition.** The justification is structural, not aesthetic:

> **The report engine's relationship traversal is one-hop and strictly OUTBOUND.** `joinRelatedDocs`
> reads a reference field *on the base document* and fetches that document by id
> (`functions/src/reporting/reportExecutionService.ts:766-812`), and `resolveDefinitionField` admits
> only a catalogued `hop: 1` relationship from the base object
> (`functions/src/reporting/reportQueryValidation.ts:70-77`; `reportCatalog.ts:203-210`).
>
> Deriving a company for an Account requires the **inbound** question — *find the sales orders whose
> `accountId` is this account* — which this engine cannot express at all. There is no
> `rel("customer", "salesOrder", …)` and there could not be one, because the join mechanism needs a
> reference field on the base document and an Account has none.

So the derivation cannot be done at query time by this engine under any amount of catalog work. It
must be **precomputed**. That is the evidence that carries the Owner's sketch, and it is a stronger
reason than "it would be faster".

A second, independent reason: the engine's scan is `db.collection(...).limit(maxScanDocs + 1).get()`
with no `where()` and **no `orderBy`** (`reportExecutionService.ts:497-500`). Any set-membership test
applied in memory over that page inherits the page's arbitrariness. See § 5.4.

### 5.2 The proposed shape

One derived, rebuildable collection. **It is a reader of company authority, never an author of it.**
It writes nothing onto `accounts`, `contacts` or `locations` — the Owner's prohibition on
duplicating company authority onto those objects applies to a projection exactly as it applies to a
field, and a projection that wrote back onto them would be that prohibited field under another name.

**Grain: one row per (neutral record, deriving fact).** Never one row per record.

| Field | Purpose | Why, on the evidence |
|---|---|---|
| `tenantId` | Tenant partition | **Addition to the sketch.** Every CRM record is tenant-scoped (`customerIdentity.ts:222,237,246`) and `functions/test/crmCustomerPostgres.test.mjs:262` proves another tenant's site reads as *absent*. A projection keyed without tenant could collide across tenants. |
| `objectId` | `customer` / `contact` / `location` | Report-catalog objectId, so the projection speaks the reporting vocabulary rather than the ownership-matrix one. |
| `recordId` | The neutral record's id | As sketched. |
| `derivedCompanyId` | `taylor` \| `ventana` | As sketched. Validated against `functions/src/ownership/operatingCompanyAuthority.ts:21-24`. **Never** inferred. |
| `derivingFactType` | e.g. `salesOrder`, `invoice`, `salesAgreement`, `equipment` | As sketched. |
| `derivingFactId` | The deriving document's id | As sketched. Makes every row auditable back to a single governed fact. |
| `derivingFactCompanyField` | e.g. `operatingCompanyId`, `companyId` | **Addition.** The field name genuinely differs — `sales_orders.operatingCompanyId` vs `invoices.companyId` (`invoiceCommands.ts:294`). Recording it stops a rebuild from guessing. |
| `derivationStrength` | `REQUIRED` / `REQUIRED_AT_COMMIT` / `OPTIONAL` / `FIXTURE_BACKFILL_ONLY` | **Addition, and the most important one.** § 4 shows the strengths differ by an order of magnitude in trustworthiness. A projection that flattened `sales_orders` (refused without a company) together with `equipment` (fixture-only, no live writer) would present a fixture artifact as a governed fact. |
| `derivationOutcome` | See § 5.3 | **Addition.** Reuses and extends the existing vocabulary rather than inventing one. |
| `builtAtBaseline`, `builtAt` | Rebuild provenance | A derived projection must be able to say how stale it is, or a reader cannot tell a true empty from an unbuilt one. |

**Prohibited by construction, and this is the load-bearing prohibition:** the projection carries
**no resolved single company per record**. There is no `accounts/{id}.derivedCompanyId`, no
`companyReach.resolvedCompanyId`, no "primary" company, no most-recent-wins tiebreak. Collapsing
multiple reaches to one is exactly the false-owner error D-10 warns of
(`ownershipMatrix.ts:34-36`, `:437-445`) and exactly what R-15 forbids
(`commercialCompanyScope.ts:17-20`).

### 5.3 The outcome vocabulary — reuse, do not invent

`functions/src/ownership/ownershipDerivation.ts` already establishes a five-valued outcome vocabulary
for exactly this class of question, with a stated invariant the projection must inherit:

| Existing value | `ownershipDerivation.ts` | Applies to this projection as |
|---|---|---|
| `DERIVABLE` | `:29-34`, `:186-192` | Exactly one governed company reached through this fact. |
| `MISSING_REFERENCE` | `:157-159`, `:166-168` | The deriving fact exists but carries no reference to the neutral record. |
| `INVALID_REFERENCE` | `:169-171` | The reference names no record that exists. |
| `POTENTIALLY_CROSS_COMPANY` | `:173-182` | Reserved for the `PARTICIPATING_COMPANIES` case (§ 3). |
| `CONFLICT` | `:181` | Two references that **must** agree do not. |

Its stated invariant, which the projection must carry verbatim in spirit:

> "`deriveRoot()` returns root IDS and never reads a company, so this cannot produce an operating
> company even by accident, and it writes nothing. **What must not happen again is a reader promoting
> 'DERIVABLE' into 'its company is its depot's'**" — `ownershipDerivation.ts:90-101`.

**One value must be added, and getting it wrong is the central correctness risk.** When two deriving
facts reach the *same* neutral Account with *different* companies — a Taylor sales order and a
Ventana sales order against one customer — that is **not** a `CONFLICT`. It is the
**ruled-legitimate normal case**: `commercialCompanyScope.ts:14-20` (R-14/R-15) explicitly permits
one customer transacting with both operating companies, and R-15 forbids resolving it by putting a
company on the Customer.

| New value | Meaning |
|---|---|
| `MULTI_COMPANY_REACH` | More than one governed company reaches this record through governed facts. **Legitimate, never a defect, never collapsed.** |

`accounts`/`contacts`/`locations` carry **no** `DERIVATION_RULES` entry today — the eight rules at
`ownershipDerivation.ts:59-137` are `cycleCount`, `receivingOrder`, `inventoryTransaction`,
`transferOrder`, `stockLocation`, `truck`, `reorderRequest`, `reorderPurchaseOrder`. So this is new
surface, not a modification of an existing rule set.

### 5.4 The scan bound defeats in-memory scoping — a first-class finding

Suppose a company scope were applied as an in-memory predicate (the only place the current engine
could apply one). The sequence is:

1. Fetch up to `maxScanDocs + 1 = 20_001` documents with no `where()` and **no `orderBy`** — `reportExecutionService.ts:500`.
2. `scanTruncated = snap.size > maxScanDocs` — `:501`.
3. Filter in memory — `:555`.
4. `kind` resolves `rowCount === 0 → "empty"` **before** any truncation branch — `:627-634`.
5. The client renders `empty` as **"No matching records — This report ran successfully but no records matched."** — `field-ops-app-vite/src/domain/reporting/reportResultState.js:26-29`.

> **So a company-scoped list over a collection larger than 20,000 documents can return a false
> negative presented as a successful empty result.** The runner's company's rows may simply lie
> outside the arbitrary page that was scanned. `truncated` is set, but `kind: "empty"` outranks it,
> and the `empty` branch of `describeRunOutcome` reads no truncation flag at all — the same class of
> defect that `reportResultState.js:45-55` already documents having been fixed for the
> `partially-authorized` branch, unfixed here.

The engine already refuses in exactly this situation for aggregates, on exactly this reasoning:

> "A bounded read may return a page and say so; a TOTAL may not — bounding an aggregate produces a
> number smaller than the truth while still labelled 'Total', which is worse than the slow unbounded
> read it replaced." — `reportExecutionService.ts:79-101` (census X-9, FIN-004 precedent).

A scope-filtered page is the same failure with a different name: *bounding a scoped list produces a
set smaller than the truth while still labelled "your company's records."*

**Design consequence.** `judgeScanCompleteness` (`reportExecutionService.ts:124-130`) returns
`"complete" | "bounded-page" | "refuse-incomplete-total"`. A company-scoped run needs a fourth
verdict — `refuse-incomplete-scope` — and a scope-filtered run whose scan truncated must **refuse**,
not return a page. This is a *design proposal*; the code is unchanged by this entry.

The alternative is a server-side `where()` on the projection (which is keyed by company and so can
be paged completely). That is the stronger answer and one more reason the projection is required
rather than optional — but it needs an index that does not exist today (§ 1.3).

### 5.5 Where the scope belongs in the authorization model

The permission model already has a value-matched `operatingCompany` scope type
(`functions/src/types/access.ts:33`, resolver `functions/src/access/resolveEffectivePermission.ts:103,173`),
introduced for financial visibility reach and live at `functions/src/finance/financeReadCallables.ts:121`.
Reporting evaluates every capability at a fixed `{ scope: { type: "global" }, condition: {} }`
(`reportExecutionService.ts:420`).

There are therefore two distinct, independent questions, and conflating them is the mistake to avoid:

| Question | Mechanism | Note |
|---|---|---|
| **May this runner see company X's data at all?** | A `RoleAssignment` at `{ type: "operatingCompany", value: x }` | Already exists. Authorization. Does not need a new concept. |
| **Which rows does this report select?** | The projection (§ 5.2) plus the labelling (§ 6) | Read-model. A *separate* question. |

A runner may be authorized for exactly one company and still run a report whose result is honestly
**company-neutral** — and must be told so. **Authorization narrowing is not scope labelling.** A
result that is correct row-by-row can still be mislabelled, and the Owner's third rule is precisely
about the label, not the rows.

---

## 6. Honest labelling

**The requirement:** a reader must never be misled about what they are looking at. A neutral result
presented inside a company-scoped report is a correctness problem even when every row is authorized.

### 6.1 Four scope classes, carried on every result

Proposed as an **orthogonal descriptor**, deliberately *not* a new `RunReportOutcomeKind`. The
existing `kind` is a single-winner ladder (`reportExecutionService.ts:627-634`) whose collapsing has
already produced one documented defect (`reportResultState.js:45-55`). A scope class must travel on
*every* outcome — including `empty` and `permission-denied` — the way `truncated`/`widened` were
meant to.

| Class | When | What the reader is told | May the result be presented as the runner's company's? |
|---|---|---|---|
| `COMPANY_SCOPED` | A predicate was applied to an **authoritative company field on the base object itself** | "Scoped to *Taylor*." | **Yes** |
| `COMPANY_DERIVED` | Rows selected via the § 5 projection, through a named deriving fact type | "Scoped to *Taylor* by the sales orders, invoices and agreements that reach these customers. Records with no such activity are not shown." | **Qualified yes** — and the deriving fact types and the coverage caveat must be shown, not buried |
| `COMPANY_NEUTRAL` | No company scoping was possible or none was requested | "**This result is not scoped to a company.** These records are shared across Taylor and Ventana." | **No — and the UI must say so, prominently** |
| `SCOPE_REFUSED` | A company scope was requested and cannot be honoured completely (§ 5.4) | "A company-scoped result could not be produced completely. Nothing partial is shown." | **N/A — nothing is shown** |

**`COMPANY_SCOPED` is reachable by no report object at this baseline** (§ 1.2, § 4.4). Recording the
class now means the honest label exists before the capability does, rather than being retrofitted
onto a surface that has already taught users to read an unlabelled result as scoped.

### 6.2 Per-row facts, where a row's own status differs from the result's

| Row field | Class it belongs to | Purpose |
|---|---|---|
| `derivedVia` (fact type, never the fact's content) | `COMPANY_DERIVED` | So a row can be traced to a governed fact. |
| `multiCompanyReach: boolean` | `COMPANY_DERIVED` | Marks an Account with governed activity from **both** companies. Legitimate (R-14/R-15). Must be visible, because it is the row a reader is most likely to misread as "ours". |
| `participationRole`, `isCrossCompany` | `PARTICIPATING_COMPANIES` objects (§ 3.4) | Names the D-10 fact rather than collapsing it. Vocabulary already exists in the Postgres estate: `functions/migrations/1758672000000_purchasing-object-authority.sql:389-390`. |

### 6.3 The three constraints the existing display layer already imposes

Any labelling must satisfy rules the reporting surface already holds, or it will be the thing that
breaks them:

1. **Never name a field the runner may not know exists.** Dropped *columns* may be named back to the
   runner; dropped *predicates* are surfaced as a **count only**, because a shared report's hidden
   filter may reference a field the runner cannot see (`reportResultState.js:34-44`; Spec §6/§12).
   **So a company predicate the runner is not authorized to see must be counted, not named** — and
   that means the *number* of scope predicates applied is safe to show while the company value may
   not be.
2. **Never emit a raw code, path, document id or collection name** (`reportResultState.js:1-8`,
   `:101-106`). So `derivingFactId` belongs in the audit record and in the projection, **not** in
   rendered copy.
3. **Exactly one audit event per run, never row data** (`reportExecutionService.ts:29-35`, audit
   write at `:610-624`). The scope class, the deriving fact **types**, and the counts belong in that
   event. Company *values* are governed ids, not row data, so `operatingCompanyId` is admissible
   there — but the summary string is fixed and templated and must stay so.

### 6.4 Aggregates under a derived scope

A `COMPANY_DERIVED` scope selects a *subset defined by activity*, not a partition. Two consequences:

- A `count` over `COMPANY_DERIVED` Accounts is **not** "Taylor's customers" — it is "customers with
  Taylor activity of the named kinds". Those differ by every customer with no such activity.
- Summing a `MULTI_COMPANY_REACH` Account into both a Taylor and a Ventana report **double-counts it
  in any consolidated view.**

Given the engine already refuses rather than understates a total (§ 5.4), the consistent design is:
**an aggregate over a `COMPANY_DERIVED` result must either be refused, or be labelled with the
derived-population definition inline.** Which of the two is `OD-R8` (§ 8) — it is a product decision
about what a number means, not a join.

---

## 7. Where derivation is ambiguous — product decisions, not joins

Each of these is named as a decision because no code can settle it without inventing a fact.

| Situation | Why it is not a join | What must be decided |
|---|---|---|
| **An Account with governed activity from both companies.** Not an edge case: `commercialCompanyScope.ts:14-20` (R-14/R-15) **expressly permits** one customer transacting with both, and R-15 forbids resolving it by giving the Customer a company. | Any tiebreak — most recent, highest value, first-ever, "primary" — is a convention invented to satisfy a field. That is the thing `ownershipMatrix.ts:437-445` records as having been **rejected twice** for transfer orders. | `OD-R5`: does the Account appear in **both** reports (marked `multiCompanyReach`), in **neither**, or in a **company-neutral** section? |
| **A Location serving both companies.** Same shape; thinner evidence, because the `locations` derivation depends on optional `locationId` fields (§ 4.2). | Same. | `OD-R5` (same ruling; the shape is identical). |
| **An Account or Location with no company-bearing activity at all.** Under `COMPANY_DERIVED` it is simply absent from both companies' reports. | "Absent" and "does not exist" are indistinguishable to the reader. A prospect with no orders yet is invisible to everyone. | `OD-R3` (Owner's standing decision on ownerless-row visibility) **applies directly here** and settles it. |
| **A Contact.** No authoritative derivation exists (§ 4.3). | A transitive Account-inherited reach is a derivation over a neutral intermediate; its confidence cannot exceed the Account's, and R-15 forbids the shortcut. | `OD-R7`: may Contact reports carry an Account-inherited derived scope at all, or are they declared company-neutral? |
| **A `PARTICIPATING_COMPANIES` record under a single-company scope** (§ 3.4). | Attribution was deliberately left undecided: "If the business later assigns formal transaction responsibility, that is a decision to add, not one to assume" — `ownershipMatrix.ts:437-445`. | `OD-R6`: how is a participating row attributed for counting and for totals? |
| **A `FIXTURE_BACKFILL_ONLY` company** (`equipment`, `fieldops_jobs`). The value is real storage written once by a capped sandbox script; no live writer reproduces it. | Deriving from it produces a reach for fixture records and none for real ones — a scope that looks populated and is an artifact of the fixture set. | `OD-R9`: may a `FIXTURE_BACKFILL_ONLY` fact ever be a derivation source, or must the projection exclude it until a live writer exists? |

---

## 8. Acceptance / proof

No test is written by this entry. These are the tests that **would** demonstrate the design is
correct, each modelled on a proof pattern the repository already uses, so none of them is a new
testing capability.

### 8.1 The negative cases — the ones that matter most

| # | Proof | Pattern it reuses |
|---|---|---|
| **N1** | **A neutral object never acquires a company predicate.** Strip comments from every file under `functions/src/reporting/` and assert the remaining source contains no company-field predicate against `accounts`, `contacts` or `locations`. | Exactly the comment-stripping source assertion at `functions/test/ownershipModel.test.mjs:469-483`, which strips `//` and `/* */` then asserts the source "must not branch on a location name". A structural guard, not a behavioural one — it holds even for code paths no test exercises. |
| **N2** | **The projection never writes to a neutral object.** Assert no writer touches `accounts`/`contacts`/`locations`, and that no field named `*ompany*` appears on `AccountRecord`, `ContactRecord` or `AccountLocationRecord`. | `functions/test/crmCustomerPostgres.test.mjs:267-274` already does the schema half: it queries `information_schema.columns` for `eos_crm` columns matching `%operating_company%` and asserts the result is **empty**, with the message "ownershipMatrix.ts:118-141 classifies account/contact/location as COMPANY_NEUTRAL with no companyScopeField". **This test is the negative case, already written.** It must keep passing. **Caveat:** it is gated on `POLICY_TEST_DATABASE_URL` and *skips* rather than fails when no database is available (`functions/test/crmCustomerPostgres.test.mjs:39`), so it proves the schema only where that URL is set — the Firestore-side half of N2 is genuinely new. |
| **N3** | **A derived reach is never promoted to ownership.** Assert the projection's public type exposes no single `resolvedCompanyId`/`primaryCompanyId`/`ownerCompany`, and that `MULTI_COMPANY_REACH` is never reduced to one value on any path. | The invariant is already stated for the sibling module at `functions/src/ownership/ownershipDerivation.ts:90-101`; this is its enforcement. |
| **N4** | **No inference.** Assert no derivation source names a prohibited proxy — `lineOfBusiness`, display text, title holder, customer name, location name, creator, `assignedTo`, territory, coverage, activity, sales history, auth uid. | `functions/test/ownershipModel.test.mjs:178-189` already does this for `backfillSource`, with an allowance for a string that is *itself* a prohibition statement. Extend the same regex to the projection's declared sources. |
| **N5** | **A scalar company predicate is refused against a `PARTICIPATING_COMPANIES` family.** No such guard exists at this baseline (§ 3.3); this test would be the thing that makes the § 3.4 rule real rather than documented. | New. The domain-level analogue is `functions/src/ownership/ownershipHandoffCommand.ts:101-106`, which refuses the family by a distinct reason code rather than a generic one. |
| **N6** | **A scope-filtered run whose scan truncated returns nothing, not a page.** Seed more than `maxScanDocs` documents (injectable via `RunReportServiceOptions.maxScanDocs`, `reportExecutionService.ts:177-182`) and assert the outcome is `SCOPE_REFUSED`, never `empty` and never `results`. | The existing `IncompleteAggregateScanError` test shape, and `judgeScanCompleteness` is already isolated as a pure helper for exactly this reason (`reportExecutionService.ts:103-130`). |
| **N7** | **A `COMPANY_NEUTRAL` result is never rendered without its neutral label.** Assert `describeRunOutcome` emits the neutral statement for **every** `kind` when the scope class is `COMPANY_NEUTRAL` — including `empty` and `results`, where a missing label is most likely. | `field-ops-app-vite/test/` already unit-tests `reportResultState.js` per-kind; this is one more axis on the existing matrix, and it is the direct fix for the collapsing-ladder defect documented at `reportResultState.js:45-55`. |

### 8.2 The positive cases

| # | Proof |
|---|---|
| **P1** | A Taylor sales order against Account A produces exactly one projection row `(tenant, customer, A, taylor, salesOrder, so-1, operatingCompanyId, REQUIRED, DERIVABLE)`. A second Taylor order produces a second row — the grain is per deriving fact, and two rows are the correct answer, not a duplicate. |
| **P2** | A Taylor order **and** a Ventana order against Account A produce two rows with different `derivedCompanyId`, the record resolves `MULTI_COMPANY_REACH`, and **no path collapses it to one company**. |
| **P3** | An Account with no company-bearing activity produces **zero** rows, and the run reports it as absent-from-scope rather than as company-neutral. The distinction is the whole point of `OD-R3`. |
| **P4** | A Contact report requests a company scope and the result is labelled **`COMPANY_NEUTRAL`** with the neutral statement rendered — the § 4.3 gap surfacing as an honest label rather than an empty result. |
| **P5** | Rebuild determinism: rebuilding the projection from the same governed facts produces a byte-identical row set. A derived projection that cannot be rebuilt is a second authority, which D-1 forbids. |
| **P6** | Every run emits exactly one audit event carrying the scope class, the deriving fact **types**, and the counts — and **no** `derivingFactId` and **no** row data in the summary string (`reportExecutionService.ts:29-35`). |
| **P7** | Parity: the server projection vocabulary and any client restatement agree structurally. `functions/test/reportCatalogParity.test.mjs` is the established pattern (`reportCatalog.ts:9-15`) — this repository has no shared/monorepo tooling, so "duplicate and prove parity" is the convention, and a company-scope vocabulary restated in `field-ops-app-vite/src/metadata/administration/objectAdministrationProfile.js:208-216` without a parity test would be the third uncoordinated authority (§ 2.3). |

### 8.3 What would *not* be a proof

- A test that asserts a company-scoped Account report returns rows. It can pass against fixture
  data whose company came from the capped sandbox backfill (§ 4.5) and tell you nothing about a
  record created today.
- Any count quoted from the 2026-08-30 sandbox census as though it were current (§ 4.5).
- A test that exercises the ALLOW path using the `RunReportServiceOptions.roles` test seam
  (`reportExecutionService.ts:161-182`) and is then read as evidence that production behaves that
  way. Every `report.*` capability is `active: false` at this baseline (§ 1.4), and `active: false`
  is a hard DENY *regardless of any Role grant* (`functions/src/types/access.ts:69-80`) — the seam
  bypasses the Role catalog, not the activation gate.

---

## 9. Owner decisions remaining

**No decision below is answered here.** Each states precisely what turns on it.

### 9.1 Carried, already open — not re-decided

| ID | Decision | What turns on it |
|---|---|---|
| **`OD-R1`** | Does a report **default to the runner's company**, or **require an explicit company filter**? | The default is the difference between a reader who is shown scoped data without asking and a reader who must ask. It also decides whether `COMPANY_NEUTRAL` (§ 6.1) is the *default* class or an *exception* class — and therefore what an unlabelled legacy saved report means when it is next run. Note the baseline has no company axis at all, so **today every report is silently whole-tenant**; whichever way this goes, existing saved definitions change meaning. |
| **`OD-R2`** | Is a saved report **private user data** or **shareable configuration**? | Baseline behaviour, for information only: `reportDefinitions` is `allow read, write: if false` for all clients (`firestore.rules:1592-1594`); the server commands enforce `ownerUid === actorUid` (`functions/src/reporting/savedDefinitionCommands.ts:268,381,404`); and the ownership matrix classifies the family `EXCLUDED` with the note "platform record with its own private-by-owner model — do not disturb" (`ownershipMatrix.ts:521`). **That is the current mechanism, not the ruling.** If saved reports become shareable, a saved *company* filter becomes a filter one runner may see and another may not — which lands directly on the predicate-drop rule (`reportExecutionService.ts:466-471`) and on § 6.3's constraint that a dropped predicate is counted and never named. |
| **`OD-R3`** | Should **ownerless rows be invisible to every runner**? | Decides § 7's third row directly. Under `COMPANY_DERIVED`, an Account with no company-bearing activity has no reach and is absent from both companies' reports — which is either the correct answer to this question or an accidental implementation of it. It also decides what a prospect with no orders is: a customer nobody can report on, or a company-neutral row. |

### 9.2 Raised by this entry

| ID | Decision | What turns on it |
|---|---|---|
| **`OD-R4`** | Is a **`COMPANY_DERIVED`** result acceptable at all as an answer to "show me my company's customers", or must the answer be either genuinely company-scoped or honestly neutral — with nothing in between? | This is the entry's central question. If derived results are acceptable, §§ 5–6 are the design. If they are not, then **company-scoped reporting over `accounts`/`contacts`/`locations` cannot be made correct at this baseline** (§ 10) and the honest product answer is a neutral label plus a separate company-scoped report over company-bearing objects (sales orders, invoices) that happens to name customers. |
| **`OD-R5`** | An Account (or Location) with governed activity from **both** companies: does it appear in **both** company reports marked `multiCompanyReach`, in **neither**, or only in a **company-neutral** section? | R-14/R-15 make this the legitimate normal case, not an exception (`commercialCompanyScope.ts:14-20`). No tiebreak may be invented (§ 7). Also decides whether consolidated counts double-count (§ 6.4). |
| **`OD-R6`** | For a `PARTICIPATING_COMPANIES` object (`transfer_orders`), how is a row **attributed** for counting and for totals under a single-company scope? | `ownershipMatrix.ts:437-445` records that both available conventions were rejected and that assigning responsibility "is a decision to add, not one to assume". Until ruled, § 3.4 holds that participating rows may be **listed** with a participation role but **not aggregated** under a single-company scope. |
| **`OD-R7`** | May a **Contact** report carry an Account-inherited derived scope, or must Contact reports be declared **company-neutral**? | § 4.3 establishes there is no authoritative Contact→company edge and that R-15 forbids creating one. An Account-inherited reach is a derivation over a neutral intermediate whose confidence cannot exceed the Account's, and it would inherit the Account's `MULTI_COMPANY_REACH` ambiguity. |
| **`OD-R8`** | May an **aggregate** be computed over a `COMPANY_DERIVED` population, or must it be refused? | A count of derived Accounts is not "Taylor's customers" but "customers with Taylor activity of the named kinds" (§ 6.4). The engine's existing posture is to refuse rather than understate (`reportExecutionService.ts:79-101`, census X-9 / FIN-004). Consistency argues for refusal; usefulness argues for an inline population definition. This decides which. |
| **`OD-R9`** | May a **`FIXTURE_BACKFILL_ONLY`** company fact (`equipment`, `fieldops_jobs`) ever be a derivation source? | `equipment` is the structurally strongest edge to a customer Location (required, doubly enforced — `equipmentImportCommand.ts:155-160`, `firestore.rules:1438-1443`) and has the weakest company (no live writer — `ownershipBackfillRules.ts:125-138`). Including it produces a scope populated for fixtures and empty for real records. Excluding it removes the only strong Location edge. |
| **`OD-R10`** | Should `equipment` be given a **live** `operatingCompanyId` writer and a **report-catalog company field**, making it the first genuinely `COMPANY_SCOPED` report object? | `ownershipMatrix.ts:465-467` states `backfillSource: null` and that "No deterministic source exists: every candidate on the record … is a prohibited proxy. No mass assignment." So the company must be **supplied**, per record, by business authority. This is a data-acquisition decision, not an engineering one — and it is the only path to a `COMPANY_SCOPED` class (§ 6.1) existing at all. |
| **`OD-R11`** | Where does the **single** company-scope authority for reporting live, and what happens to the restatements? | § 2.3 shows the decision procedure of § 2.2 is currently expressed nowhere in runtime code and restated in three places with no parity test (`ownershipMatrix.ts` columns; `objectAdministrationProfile.js:208-216`; report catalog, which has no company concept at all). D-1 forbids a second authority. This decides which one is authoritative. |

---

## 10. The plain answer, if it is wanted plainly

**Company-scoped reporting over `accounts`, `contacts` and `locations` cannot be made correct at this
baseline without a business ruling.** Specifically:

1. For **Contacts** there is **no authoritative company-bearing relationship at all** (§ 4.3). No
   engineering work produces one; only a business decision to create a company-bearing fact about a
   Contact would, and R-15 (`commercialCompanyScope.ts:17-20`) currently forbids the obvious version
   of that. Until then, a Contact report can only be honestly **labelled neutral**.
2. For **Accounts** a derivation exists and is strong, but it cannot produce a single company per
   Account, because R-14/R-15 make a customer transacting with both companies legitimate. The ruling
   needed is **`OD-R5`** — what a multi-company customer *is*, in a company-scoped report.
3. For **Locations** a derivation exists and is thin: no record type carries both a required company
   and a required customer-location reference (§ 4.2). The coverage gap is a data fact, not a design
   choice, and the ruling needed is **`OD-R9`**.
4. `COMPANY_SCOPED` — the clean answer — is reachable by **no report object today**, `equipment`
   included, because the field is absent from the report catalog and has no live writer (§ 1.2,
   § 4.4). The ruling needed is **`OD-R10`**.

The engineering is buildable. What it cannot do is decide what the answer means. **The design in
§§ 5–6 is the honest machinery; `OD-R4` is the question of whether the honest machinery is the
product the Owner wants.**

---

## 11. UNPROVEN

Everything below is explicitly **not** established by this entry.

| # | Claim not established | What would settle it |
|---|---|---|
| **U1** | That the 2026-08-30 sandbox census figures still hold. They are repository evidence predating this baseline and were **not** re-measured; the emulator cannot run here (no JRE; port 8080 is held by an unrelated process) and no production or sandbox contact was made. | Re-run `functions/scripts/` census against a sandbox and compare. |
| **U2** | The **exact** matrix distribution figures. `20 / 30 / 1` and `147 / 38 / 109` come from a **static parse of the TypeScript source** (script retained in the lane scratchpad), not from executing the module. `functions/lib/` is not built here and `functions/node_modules/` is absent. | Build `functions/` and evaluate `OWNERSHIP_MATRIX` and `PERMISSION_CATALOG` directly. The Owner's stated `15 / 9 / 1` disagrees and should be re-derived before either figure is quoted. |
| **U3** | Whether `equipment.locationId` in **Firestore** always points at a `locations` document. The report catalog asserts the relationship (`reportCatalog.ts:174,204`) and `equipmentImportCommand.ts:155-160` plus `firestore.rules:1438-1443` enforce it on the governed create path. Whether every *existing* document satisfies it is unmeasured. | A referential sweep, in the shape of `ownershipDerivation.ts`'s own check. |
| **U4** | Row counts and coverage rates for a `COMPANY_DERIVED` projection over real data — i.e. **what fraction of Accounts and Locations would actually acquire a reach.** Without this the design's usefulness is unquantified, and § 6.1's coverage caveat has no number in it. | Build the projection read-only against a sandbox and count. |
| **U5** | Whether the `MULTI_COMPANY_REACH` case occurs in real data at all, and at what rate. If it is rare, `OD-R5` is a small decision; if common, it is the defining one. | Count distinct `derivedCompanyId` per `(tenantId, accountId)` over `sales_orders` ∪ the four financial types. |
| **U6** | Whether `field-ops-app-vite/src/metadata/administration/objectAdministrationProfile.js`'s `companyField` slot (`:216`) is actually consistent with `ownershipMatrix.ts` for the three profiles that exist (`invoice`, `part`, `payment`). No parity test binds them. | Add the parity test `OD-R11` implies, or read all three profiles against the matrix. |
| **U7** | Whether `inbound_work_requests.operatingCompanyId` could be made an authoritative source. It carries company + `customerId` + `customerLocationId` with an account/location cross-check (`functions/src/inboundWork/inboundDecisionCommands.ts:132-140,190-191`) — but the company is an unvalidated 120-char string (`functions/src/inboundWork/inboundRouting.ts:128-130`), so it is **excluded from § 4 as a source**. Whether validating it would make it one is unassessed. | Assess against `operatingCompanyAuthority.ts:66-80`; it is a change to that command's contract, out of scope here. |
| **U8** | Whether any **saved** report definition exists in production that would change meaning under `OD-R1`. `reportDefinitions` is client-deny-all and was not read (no Firestore access was made). | An Owner-authorised count, not a read by this lane. |

---

## 12. Corrections to the brief — recorded because correcting it was in scope

| # | The brief said | Measured at `64008d5a` | Where |
|---|---|---|---|
| **C1** | "all 25 production-activated capabilities are `report.*` — the reporting family is the only family activated in production" | **0 of 39 `report.*` capabilities are active.** 38 of 147 catalog entries are active, none of them `report.*`. The figure is a pre-`0dd5e104` recollection; that commit (2026-09-02, DECISIONS #166) flipped all 39 to `active: false`, and its own message records the prior state as **36**, not 25. | § 1.4 |
| **C2** | `SINGLE_COMPANY` 15 entries, `COMPANY_NEUTRAL` 9 | **20 and 30** (static parse; `CROSS_COMPANY_CAPABLE` 1 is correct). 51 families total, built from 25 syntactic blocks of which five are `.map()` spreads — counting literal occurrences undercounts by 26. | § 3.1, U2 |
| **C3** | "`equipment` = SINGLE_COMPANY — directly filterable" | True of the **data model**, false of the **report engine**: `operatingCompanyId` is not in the report catalog, so no predicate can bind to it. And the field has **no live writer** — only a fixture-capped sandbox backfill. So a `where()`-only fix closes **zero of four** objects, not one of four. | § 1.2, § 4.4 |
| **C4** | "a company predicate against them would match zero documents" (of `accounts`/`contacts`/`locations`) | Correct, and the stronger statement holds: the canonical types carry **no company field at all** (`customerIdentity.ts:220-254`), and `functions/test/crmCustomerPostgres.test.mjs:267-274` already asserts the `eos_crm` schema has no such column (skip-gated on `POLICY_TEST_DATABASE_URL`, `:39`). The prohibition is already tested on the Postgres side. | § 4.3, N2 |
| **C5** | The `companyScopeField` + `COMPANY_NEUTRAL` pairing might be a contradiction or a data defect | **Neither.** A legitimate distinction, correctly valued — `companyScope` is an *ownership-shape* column, `companyScopeField` is explicitly "**NOT ownership**" (`ownershipMatrix.ts:91`). But the Owner's implied worry is justified from the other side: **`companyScope` alone cannot decide filterability**, and neither column has any runtime reader. | § 2 |
| **C6** | "a sibling lane found its bound is a *participating pair*, not single-field equality. Verify that." | **Verified for `transferOrder`, with a refinement that matters:** `inventory_transactions` declares the **same pair** while being `SINGLE_COMPANY`/`COMPANY` (`ownershipMatrix.ts:390-391`). "Carries a pair" is therefore **not** the discriminator — `ownerClass === "PARTICIPATING_COMPANIES"` is, and it is what the census and the handoff refusal actually branch on. | § 3.2 |
| **C7** | Implied: a Work Order is a candidate company-bearing relationship | `fieldops_wos` has **no company field at all** — `ownerFields: []`, "MEASURED 0/30 — the collection has no company storage at all" (`ownershipMatrix.ts:248-254`). It carries the required `customerId` and `locationId` and none of the company. The company/reference halves are split across two different collections and neither is a path. | § 4.1, § 4.2 |
| **C8** | The invoice guard is at `invoiceCommands.ts:106` | The guard is real and reads as described, but it is at **`functions/src/finance/invoiceCommands.ts:132-137`**, re-asserted at `:254-257`. | § 4.1 |
| **C9** | The commercial company authority is at `functions/src/eosCommercial/commercialCompanyScope.ts` | That path does not exist. The authority is **`functions/src/ownership/commercialCompanyScope.ts`**; `functions/src/eosCommercial/` contains only `commercialOwnershipAuthority.ts` and `commercialOwnershipRepository.ts`. | § 4 |
| **C10** | Not raised by the brief — found incidentally | **Two documentation-vs-code drifts, and two stale matrix rows.** `permissionCatalog.ts:637-638` still claims "Every other wave-1 field/object id is `active: true`" when none is. `reportExecutionSeam.js:10-14`, `runReportDefinitionCallable.ts:9-11` and `index.ts:172-183` still claim the client seam resolves unconditionally to `unavailable`; it calls the callable (`reportExecutionSeam.js:32-40`). `ownershipMatrix.ts:287-296` (reorder-request `warehouseId`) and `:327-336` (`stock_locations`, a retired collection) are stale. **None fixed here** — EVIDENCE_WRITE forbids touching those trees. | § 1.4, § 1.5, § 4.5 |

---

*End of ENG-IMPL-001. `IMPLEMENTATION STATUS: NOT AUTHORIZED`.*
