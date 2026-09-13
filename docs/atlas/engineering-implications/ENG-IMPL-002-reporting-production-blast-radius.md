# ENG-IMPL-002 — The production blast radius of the activated `report.*` capabilities

> **MODE: EVIDENCE_WRITE.** Documentation only. This entry changes no runtime code, no test, no
> configuration, no schema, and **no activation**. It proposes no migration and **adds no field to
> any object.** It does not resolve `OD-R4`.
>
> **BASELINE:** `64008d5ae0bdd9532909671b15a91122400accf1` = `ATLAS-BASE-2026-09-12-A`.
> Every code-derived fact carries `file:line` and **OBSERVED AT: 64008d5a**.
>
> **METHOD IS LABELLED PER CLAIM.** `EXECUTED` = the module was run in this environment (Node
> 22.23.2 `--experimental-strip-types` with an extensionless/`.js`→`.ts` import loader hook, a
> parameter-property source rewrite, and a stubbed `firebase-admin/firestore`; **zero
> `node_modules`**). `RECONCILED` = source read against configuration, not run. `STATIC` = source
> read only. **No production contact, no deploy, no Firestore read or write was made.**
>
> **THE RELIABILITY ORDER THIS ENTRY OBEYS:** executed resolver behaviour > source + config
> reconciliation > static source reading. Where runtime truth was needed, the resolver was run.

---

## Register fields

| Field | Value |
|---|---|
| **SOURCE NORTH STAR** | Owner ruling. Continues `ENG-IMPL-001`; the governing authorities are the five company-scope standing rules in [the register](./README.md#standing-rules-an-entry-may-not-contradict), `DECISIONS #167` (catalogue flip), `DECISIONS #169` (2C.6F production adoption), and `OD-R4`. |
| **USER NEED** | "Tell me exactly what a production report can read today, and what would have to be switched off to stop it." |
| **DESIGN ELEMENT** | The production activation boundary for the `report.*` family, and the row-scope it does not have. |
| **CURRENT EOS STATUS** | **`MISSING`** for row scope — unchanged from `ENG-IMPL-001`. **But the exposure is not zero:** `ENG-IMPL-001 § 1.4`'s conclusion that "nothing is leaking company-crossed data today because nothing can run" is **refuted by execution**. See § 0. |
| **OBSERVED BASELINE** | `64008d5a` |
| **TYPE** | `READ MODEL / PROJECTION` · `GOVERNED COMMAND` · `OBSERVABILITY / AUDIT` · `TESTABILITY` |
| **AUTHORITY IMPACT** | Establishes that 24 production-adopted capabilities reach whole-collection, company-crossed reads with **no row-scope mechanism of any kind**, and that the containment boundary is **4 ids, not 25**. |
| **WORKFLOW IMPACT** | None by this entry. A containment decision would remove the Reporting surface for its holders until row scope exists. |
| **PROPOSED DIRECTION** | §§ 3–4. Framing only. |
| **DEPENDENCIES** | `OD-R4`, `OD-R1`, `OD-R5`, `OD-R7`; `REPORTING_ROW_SCOPE_DEPENDENCY` (`DECISIONS #169`). |
| **ACCEPTANCE / PROOF** | § 5. |
| **IMPLEMENTATION STATUS** | **`NOT AUTHORIZED`.** |

---

## 0. The correction that makes this entry necessary

`ENG-IMPL-001 § 1.4` measured, correctly, that **all 39 `report.*` catalogue entries declare
`active: false`** and concluded:

> "Company-scoped reporting has no production exposure today. Every `report.*` capability resolves to
> DENY for every principal … This is a design window, not an incident."

**That conclusion is wrong.** It read the flag and not the mechanism that overrides it. `active: false`
does not mean not-production-active.

| # | Fact | Method |
|---|---|---|
| 0.1 | All 39 `report.*` catalogue entries declare `active: false`. | **EXECUTED** — `PERMISSION_CATALOG.filter(id.startsWith("report."))` → 39, `every(p => p.active === false)` → `true`. |
| 0.2 | `taylor-parts-production` declares **25** `productionCapabilityActivations` — a **different field** from `capabilityActivationOverrides`, introduced by `DECISIONS #169` (2C.6F) precisely because the latter's production hard-block is absolute. | **STATIC** — `functions/src/access/environmentCapabilityOverrides.ts:679-705`. |
| 0.3 | `resolveRuntimeCapabilityOverrides()` composes both authorities at **one** point and is the activation source for **eleven** runtime consumers, reporting execution and saved definitions among them. | **STATIC** — `functions/src/access/environmentCapabilityOverrides.ts:761-776`. |
| 0.4 | **`resolveRuntimeCapabilityOverrides()` under `GCLOUD_PROJECT=taylor-parts` returns a set of size 25.** | **EXECUTED.** |
| 0.5 | With those 25 as `activationOverrides` and a **global-scoped** `RoleAssignment`, at the exact target reporting builds (`{ scope: { type: "global" }, condition: {} }`): `owner` → **ALLOW 25/25**; `admin` → **ALLOW 25/25**; `reportViewer` → **ALLOW 23/25**; `reportFinanceViewer` → **ALLOW 2/25**; `reportAuthor`, `dispatcher`, `technician` → 0/25. | **EXECUTED.** |
| 0.6 | The other 14 `report.*` ids deny with reason **`inactivePermission`** — activation, ahead of eligibility. Their absence from `PRODUCTION_ACTIVATION_ELIGIBLE_IDS` is what holds them. | **EXECUTED.** |
| 0.7 | A full end-to-end `runReportDefinition()` run as `owner` against a synthetic two-company Firestore returned **both companies' rows in one result**, unfiltered. | **EXECUTED** — § 1.4 T1. |

### 0.8 A second correction, in the direction of MORE exposure — the guard that reads as protecting production and does not

`functions/test/reportingActivationBoundary.test.mjs` asserts, in its own words, *"PRODUCTION: every
`report.*` capability is inactive, so admin resolves DENY"* and *"every other environment — production
AND both certification worlds — is fail-closed"*.

It resolves activation through **`resolveCapabilityOverrides`** (`:28`, `:58`) — the **non-production**
resolver, which returns `EMPTY` for a production role by design. It never calls
`resolveProductionCapabilityActivations` or `resolveRuntimeCapabilityOverrides`. **The test is
structurally blind to the field that actually activates these 25 in production, and passes while the
runtime path resolves ALLOW.** Two functions, two answers, one of them load-bearing:

| Resolver | `taylor-parts` result | Is it what reporting calls? |
|---|---|---|
| `resolveCapabilityOverrides` | **0** ids | No. |
| `resolveProductionCapabilityActivations` | **25** ids | Indirectly. |
| `resolveRuntimeCapabilityOverrides` | **25** ids | **Yes** — `reportExecutionService.ts:273`, `savedDefinitionCommands.ts:184`. |

**EXECUTED** (all three, same process, `GCLOUD_PROJECT=taylor-parts`). This is the same class of error
as the predecessor lane's, embedded in a test whose name claims the opposite. `functions/test/productionCapabilityActivation.test.mjs`
does exercise the production resolver — but it does not repair the reporting-boundary test's claim,
and the reporting-boundary test is the one a reader would consult.

### 0.9 A third correction — "LIVE" is a deployment fact, and the repository's own record disagrees with itself

The brief states the 25 are **LIVE IN PRODUCTION**. Precision matters here, and it cuts **both** ways.

| Fact | Method |
|---|---|
| `DECISIONS #169` (2026-09-03) states in terms: `REPORTING_PRODUCTION_TARGET = APPROVED_25, REPRESENTABLE`; **`REPORTING_PRODUCTION_LIVE = STILL_0`**, "and stays 0 until a governed production deployment publishes this configuration". The activation snapshot ships **inside** the Functions bundle (`environmentCapabilityOverrides.ts:405-412`) — `config/environments.json` is not uploaded. | **STATIC** — `docs/DECISIONS.md:5468-5556`. |
| `runReportDefinitionCallable` **and all six saved-definition callables are deployed to `taylor-parts`** (`docs/DECISIONS.md:440`), and `functions/test/reportingActivationBoundary.test.mjs:11` states it as a fact: *"`runReportDefinitionCallable` is ALREADY DEPLOYED IN PRODUCTION."* | **STATIC** |
| The **last recorded** production Functions deploy pinned source `fb45e6eed77f1a3ad89737ee22618a770e6362b5` (2026-08-06, estate 20 → 22, `firebase functions:list --json` count 22). **No production Functions deploy is recorded after `DECISIONS #169`.** | **STATIC** — `docs/DECISIONS.md:744-745`; no later entry through `#179`. |
| At `fb45e6ee`, **36 of the 39 `report.*` entries are `active: true`** — and in this architecture catalogue `active: true` means live in every environment, activation set or not. Running the resolver **at that commit's source**: the `owner` Role resolves **ALLOW 36/39**. `admin` resolves 0 there (the admin-holds-whole-catalogue derivation post-dates it), and `reportViewer`/`reportFinanceViewer`/`reportAuthor` do not yet exist. The 3 inactive are `customer.notes`, `customer.accountOwner`, `location.accessNotes`. | **EXECUTED** (against `git archive fb45e6ee`). |
| `firebase.json` declares one functions codebase with no per-function filter, so a `--only functions` publish ships whatever `index.ts` exports. | **STATIC** — `firebase.json:11-14`. |

**Therefore there are two reconcilable readings of the live estate, and both are non-zero:**

| Reading | Live `report.*` set | Includes |
|---|---|---|
| **(a)** The running bundle is the pre-`#167` one pinned at `fb45e6ee` (what the deployment record supports). | **36** for a global-scoped `owner` | Everything in the 25 **plus** `billingAddress`, `externalIds`, `paymentTerms`, `taxStatus`, `contact.email`, `contact.phone`, `equipment.notes`, and **all five `report.definition.*` mutations**. |
| **(b)** An unrecorded later publish of current `main` has landed. | **25** for `admin`/`owner`, **23** for `reportViewer` | The 25 named by `#169`. |

**The 25 is the FLOOR, not the ceiling.** Which reading holds is **UNPROVEN** from this worktree
(**U1**, § 6) and is settled only by `firebase functions:list --project taylor-parts` plus the deployed
bundle's identity — an Owner-authorised operator action, not a read this lane may make. **Every
classification below is stated against the 25, and every one of them holds a fortiori under reading (a).**

---

## 1. Deliverable 1 — the blast-radius map

### 1.1 The five engine facts every row below depends on

| Fact | Value | Method |
|---|---|---|
| Base objects a definition may name | Exactly **4** — `customer`(`accounts`), `contact`(`contacts`), `location`(`locations`), `equipment`(`equipment`). `validateReportDefinition` defaults `activatedObjectIds` to `objectsWithPopulatedFields()`. | **EXECUTED** — `reportQueryValidation.ts:84-86`; `reportCatalog.ts:224-226`, `:85-97`. Verified as the brief asked. |
| The fetch | `db.collection(object.collection).limit(maxScanDocs + 1).get()` — **no `where()`, no `orderBy()`**. Every filter/group/sort/aggregate runs in memory afterwards. | **STATIC** — `reportExecutionService.ts:500`. The only other `.where()` in the file is on `roleAssignments` (`:247`). |
| Scan cap | **`MAX_SCAN_DOCS = 20_000`** (`= MAX_RESULT_ROWS * 2`), `MAX_RESULT_ROWS = 10_000`, `MAX_GROUP_CARDINALITY = 1_000`. | **EXECUTED** — printed from the loaded module; declared `:136-147`. Verified as the brief asked. |
| The join | **One hop, strictly outbound.** `resolveDefinitionField` admits only a catalogued `hop: 1` relationship *from* the base; `joinRelatedDocs` reads a reference field *on the base document* and `.doc(id).get()`s the target. | **EXECUTED** (T8/T9/T10) — `reportQueryValidation.ts:70-77`; `reportExecutionService.ts:766-812`. Verified as the brief asked. |
| Authorization target | Fixed **`{ scope: { type: "global" }, condition: {} }`**. | **STATIC** — `reportExecutionService.ts:420`. Consequence in § 1.3. |

### 1.2 The row-scope mechanisms that exist — measured, not assumed

Four candidate mechanisms. **All four are unavailable.**

| Candidate mechanism | Verdict | Evidence |
|---|---|---|
| A server-side `where(operatingCompanyId == x)` | **Impossible.** No `where()` is issued at all, and `operatingCompanyId` appears nowhere in `functions/src/reporting/`. | **STATIC**; confirms `ENG-IMPL-001 § 1.2`. |
| A catalogued company **field** to filter on | **Impossible.** No report object declares one. A definition naming `equipment.operatingCompanyId` is refused by the validator: `"filters[0]: equipment.operatingCompanyId is not a field of equipment or a one-hop relationship"`. | **EXECUTED** — T6. |
| An `operatingCompany`-scoped `RoleAssignment` | **Counter-productive, not narrowing.** `scopeMatches` requires the *target* to declare the same scope type **and value**; reporting's target is always `global`. An `operatingCompany`-scoped assignment therefore matches nothing: `owner` @ `{operatingCompany: "taylor"}` → **DENY `noQualifyingGrant`, 0/25**, and an end-to-end run returns `kind: "permission-denied"`. | **EXECUTED** — § 0.5, T7; `resolveEffectivePermission.ts:173-179`. |
| An in-memory company predicate | **Not correct even if built.** § 1.5. | **EXECUTED** — F1. |

> **This is a direct refinement of `ENG-IMPL-001 § 5.5`,** which says of the `operatingCompany` scope
> type: *"Already exists. Authorization. Does not need a new concept."* It exists in the **permission
> model**; it confers **nothing** in **reporting**, and cannot until the execution service builds a
> company-typed target. Today, granting Reporting at a company scope does not narrow a report — it
> **disables** reporting for that principal entirely. Seating scope in the authorization model is a
> code change to `reportExecutionService.ts:420`, not a configuration choice.

### 1.3 The object gate is **base-only** — the finding that decides containment

`resolveFieldAuthorization` checks the field's own `readCapability` **and**, for a joined field, the
relationship's `traversalCapability` — and **never the related object's `objectReadCapability`**
(`reportExecutionService.ts:286-318`). The object gate is applied once, to the **base** object only
(`:420-450`).

**EXECUTED PROOF (T3/T4).** A synthetic Role holding exactly
`{ report.equipment.read, report.equipment.field.customer.read, report.customer.field.name.read }`
and **not** `report.customer.read`:

| Run | Result |
|---|---|
| base `equipment`, fields `[equipment.name, customer.name]` | `kind: partially-authorized`, **`customer.name` returned for both companies** (`equipment.name` dropped — the Role lacks it) |
| base `customer`, fields `[customer.name]` | `kind: permission-denied`, `rows: null` |

**Consequence, and it is the single most important containment fact in this entry:** deactivating
`report.customer.read` does **not** contain Customer field data. Account names remain readable through
an `equipment`, `contact` or `location` base. **A containment plan that switches off object reads
selectively leaks through the joins.**

### 1.4 Executed reachability — what each base object actually reads

Runs as a global-scoped `owner` against a synthetic Firestore holding one Taylor-side and one
Ventana-side record per collection. **EXECUTED, all rows below are verbatim outcomes.**

| Run | Definition | Collections read | Outcome |
|---|---|---|---|
| **T1** | base `customer`, fields `name, status` | `accounts` | `results`, **2 rows — both companies** |
| **T2** | base `customer`, + `paymentTerms`, `billingAddress.city`, `customerNumber` | `accounts` | `partially-authorized`; the 3 unadopted fields **dropped**. Field-level activation works. |
| **T3** | base `equipment` (narrow Role, no `report.customer.read`) | `equipment` + `accounts` | `partially-authorized`, **account names for both companies** |
| **T4** | base `customer` (same narrow Role) | none | `permission-denied`, `rows: null` |
| **T5** | base `customer`, `aggregates: [{fn:"countRows"}]`, **no fields at all** | `accounts` | `results`, `countRows: 2` — **unscoped whole-collection cardinality with zero field capabilities** |
| **T6** | base `equipment`, filter `equipment.operatingCompanyId == "taylor"` | none | `InvalidReportDefinitionError` — the predicate is inexpressible |
| **T7** | base `customer`, runner's assignment scoped `{operatingCompany: "taylor"}` | none | `permission-denied` |
| **T8** | base `contact`, fields `contact.name, customer.name, customer.status` | `contacts` + `accounts` | `results`, both companies |
| **T9** | base `location`, fields `location.name, location.address.city, customer.name` | `locations` + `accounts` | `results`, both companies |
| **T10** | base `equipment`, fields `equipment.name, equipment.serialNumber, location.name, customer.name` | `equipment` + `locations` + `accounts` | `results`, both companies — **three collections, one run** |

Reachable-column counts per base, computed from the catalogue ∩ the executed 25:

| Base object | Collections reachable | Activated reachable columns | Blocked by non-activation |
|---|---|---|---|
| `customer` | `accounts`, `contacts` | **12** of 26 | 14 |
| `contact` | `contacts`, `accounts` | **12** of 26 | 14 |
| `location` | `locations`, `accounts` | **15** of 28 | 13 |
| `equipment` | `equipment`, `accounts`, `locations` | **26** of 40 | 14 |

**EXECUTED.** `equipment` is the widest base: it is the only object with two activated outbound
traversals. **Nothing joins *to* `equipment`** — no catalogue relationship has `toObjectId: "equipment"`
(**EXECUTED** over `REPORT_RELATIONSHIPS`). That asymmetry is what makes the Equipment field reads
containable and the Customer field reads not.

### 1.5 The scan bound makes an in-memory scope wrong, not merely slow — now EXECUTED

`ENG-IMPL-001 § 5.4` inferred this from source. It is now measured.

| Run | Setup | Outcome |
|---|---|---|
| **F1** | 3 documents, `maxScanDocs: 2`, filter matches **only the 3rd** | **`kind: "empty"`, `rowCount: 0`, `truncated: true`, `rows: []`** |
| **F2** | identical definition, full scan | `kind: "results"`, `rowCount: 1`, the matching row |
| **F5** | `countRows`, `maxScanDocs: 2` | **`IncompleteAggregateScanError`** — refused, per census X-9 |

**EXECUTED.** The client renders `empty` as *"No matching records — This report ran successfully but no
records matched"* (`field-ops-app-vite/src/domain/reporting/reportResultState.js:26-29`, **STATIC**).
So a filtered list over a collection larger than 20,000 documents can return a **false negative
presented as a successful empty result**, because `rowCount === 0 → "empty"` is evaluated before any
truncation branch (`reportExecutionService.ts:627-634`). The engine already **refuses** in exactly this
situation for aggregates and does not for lists. A company scope applied in memory would inherit this
defect precisely: *bounding a scoped list produces a set smaller than the truth while still labelled
"your company's records."*

### 1.6 Predicate-drop widens the answer — EXECUTED

| Run | Setup | Outcome |
|---|---|---|
| **F3** | filter on `customer.paymentTerms` (**not** production-adopted) | predicate **dropped**, **all 3 rows returned**, `widened: true` |
| **F4** | `countRows` with the same dropped predicate | `countRows: 3` — a total that answers a **different question** than the one asked |

**EXECUTED.** The predicate-drop rule (ADR-007 §2.4) is deliberate and correct as an anti-leak rule —
it widens rather than reveals membership. Its interaction with the 14 **non-adopted** fields is the
part worth recording: because production adopted the ordinary fields and deferred the sensitive ones,
**every filter a production user writes on a sensitive field is silently discarded and the report
widens to the whole collection.** Non-activation of a field is not neutral; it converts a narrow
request into a broad one.

### 1.7 The 25-row blast-radius table

Columns: **CAPABILITY → REPORT SOURCE → OBJECT → AVAILABLE ROW-SCOPE MECHANISM → ACTUAL QUERY BEHAVIOUR → VERDICT.**
`Reachable from` names every base object from which the capability can be exercised, which is what
determines whether deactivating an object read contains it.

#### Object-read gates (4)

| # | Capability | Report source | Object / collection | Row-scope mechanism available | Actual query behaviour | Verdict |
|---|---|---|---|---|---|---|
| 1 | `report.customer.read` | `reportExecutionService` base gate | `customer` / **`accounts`** | **NONE** (§ 1.2, all four candidates refuted) | Unfiltered `limit(20001)` scan of `accounts`; opens the outbound join to `contacts`; `countRows` alone yields whole-collection cardinality | **UNSAFE** |
| 2 | `report.contact.read` | base gate | `contact` / **`contacts`** | **NONE** | Unfiltered scan of `contacts`; opens the join to `accounts` | **UNSAFE** |
| 3 | `report.location.read` | base gate | `location` / **`locations`** | **NONE** | Unfiltered scan of `locations`; opens the join to `accounts` | **UNSAFE** |
| 4 | `report.equipment.read` | base gate | `equipment` / **`equipment`** | **NONE.** The model's company *is* authoritative here, but the field is absent from the report catalogue (T6) and has **no live writer** (`ownershipBackfillRules.ts:125-138`, fixture-only) | Unfiltered scan of `equipment`; opens **two** joins — to `accounts` **and** `locations` (T10). **Widest single id in the set.** | **UNSAFE** |

#### Customer field reads (7) — reachable from **all four** bases

| # | Capability | Fields it exposes | Reachable from | Row-scope mechanism | Verdict |
|---|---|---|---|---|---|
| 5 | `report.customer.field.name.read` | `customer.name` | `customer`, `contact`, `location`, `equipment` | **NONE** | **UNSAFE** |
| 6 | `report.customer.field.status.read` | `customer.status` | all four | **NONE** | **UNSAFE** |
| 7 | `report.customer.field.relationshipTypes.read` | `customer.relationshipTypes` | all four | **NONE** | **UNSAFE** |
| 8 | `report.customer.field.tags.read` | `customer.tags` | all four | **NONE** | **UNSAFE** |
| 9 | `report.customer.field.createdAt.read` | `customer.createdAt` | all four | **NONE** | **UNSAFE** |
| 10 | `report.customer.field.commercialProfile.read` | `defaultCurrency`, `purchaseOrderRequired`, `invoiceDeliveryMethod` — sensitivity **`commercial`** | all four | **NONE** | **UNSAFE** |
| 11 | `report.customer.field.billingContact.read` | `customer.billingContact` **and is the `customer → contact` traversal capability** | all four (as a column); as a traversal, from base `customer` | **NONE** | **UNSAFE** |

> Two of these carry non-`standard` sensitivity. The `#169` note describes the adopted 20 as "ordinary
> field reads" and the 10 deferred as the sensitive ones; `commercialProfile` (`commercial`) and
> `billingContact` are adopted and are two of `reportFinanceViewer`'s five tier-2 fields
> (`governedBusinessRoles.ts:1416-1436`). Not a contradiction of `#169` — its deferred list is exactly
> the 10 named — but "ordinary" is doing more work in that sentence than the catalogue supports.
> **STATIC/EXECUTED.**

#### Contact field reads (3) — reachable from `contact` and from `customer` via `billingContact`

| # | Capability | Fields | Reachable from | Row-scope mechanism | Verdict |
|---|---|---|---|---|---|
| 12 | `report.contact.field.name.read` | `contact.name` | `contact`, `customer` | **NONE.** Worse than none: **no authoritative company derivation for a Contact exists at all** (`ENG-IMPL-001 § 4.3`, exhaustive) | **UNSAFE** |
| 13 | `report.contact.field.role.read` | `contact.role` | `contact`, `customer` | **NONE** | **UNSAFE** |
| 14 | `report.contact.field.customer.read` | `contact.accountId` **and is the `contact → customer` traversal capability** | `contact` | **NONE** | **UNSAFE** |

#### Location field reads (3) — reachable from `location` and from `equipment` via `locationId`

| # | Capability | Fields | Reachable from | Row-scope mechanism | Verdict |
|---|---|---|---|---|---|
| 15 | `report.location.field.name.read` | `location.name` | `location`, `equipment` | **NONE.** Derivation exists but is **thin**: no record type carries both a `REQUIRED` company and a `REQUIRED` reference to a customer `locations` doc (`ENG-IMPL-001 § 4.2`) | **UNSAFE** |
| 16 | `report.location.field.address.read` | `address.street/city/state/zip` — a customer **site address** | `location`, `equipment` | **NONE** | **UNSAFE** |
| 17 | `report.location.field.customer.read` | `location.accountId` **and is the `location → customer` traversal capability** | `location` | **NONE** | **UNSAFE** |

#### Equipment field reads (7) — reachable from `equipment` **ONLY**

Nothing in the catalogue joins **to** `equipment` (**EXECUTED**). These seven are therefore the only
field capabilities in the set whose entire reach is closed by deactivating **one** object read.

| # | Capability | Fields | Reachable from | Row-scope mechanism | Verdict |
|---|---|---|---|---|---|
| 18 | `report.equipment.field.name.read` | `equipment.name` | `equipment` only | **NONE** | **UNSAFE** |
| 19 | `report.equipment.field.status.read` | `equipment.status` | `equipment` only | **NONE** | **UNSAFE** |
| 20 | `report.equipment.field.identity.read` | `manufacturer`, `model`, **`serialNumber`**, `assetTag` | `equipment` only | **NONE** | **UNSAFE** |
| 21 | `report.equipment.field.dates.read` | `installedDate`, `warrantyExpiresDate` | `equipment` only | **NONE** | **UNSAFE** |
| 22 | `report.equipment.field.customer.read` | `equipment.accountId` **and is the `equipment → customer` traversal capability** | `equipment` only | **NONE** | **UNSAFE** |
| 23 | `report.equipment.field.location.read` | `equipment.locationId` **and is the `equipment → location` traversal capability** | `equipment` only | **NONE** | **UNSAFE** |
| 24 | `report.equipment.field.createdAt.read` | `equipment.createdAt` | `equipment` only | **NONE** | **UNSAFE** |

#### The one that is not a data read (1)

| # | Capability | Report source | Object / collection | Row-scope mechanism | Actual query behaviour | Verdict |
|---|---|---|---|---|---|---|
| 25 | **`report.definition.read`** | `savedDefinitionCommands.getSavedDefinition` / `listSavedDefinitions` | **`reportDefinitions`** — saved-definition metadata, **not a business object** | **ALREADY ROW-SCOPED, per-owner.** `listSavedDefinitions` issues `.where("ownerUid", "==", actorUid)` (`:402-405`); `getSavedDefinition` throws `NotOwnerError` when `data.ownerUid !== actorUid` (`:381-383`) | Returns only the actor's own definitions. Reaches **no** `accounts`/`contacts`/`locations`/`equipment` row, and **does not gate or enable a run** — `runReportDefinition` never consults `reportDefinitions` | **SAFE** |

**STATIC** for row 25; the ownership predicate and the `NotOwnerError` guard were read directly and no
path in `savedDefinitionCommands.ts` returns another principal's definition under
`report.definition.read`.

### 1.8 The exact unsafe set — and why it is 24 and not 25

> **THE PROVEN-UNSAFE SET IS 24 OF 25.** Every production-adopted capability except
> `report.definition.read` reaches `accounts`, `contacts`, `locations` or `equipment` rows or field
> values that **cannot currently be row-scoped to an operating company by any mechanism**.

```
report.customer.read                          report.contact.field.name.read
report.contact.read                           report.contact.field.role.read
report.location.read                          report.contact.field.customer.read
report.equipment.read                         report.location.field.name.read
report.customer.field.name.read               report.location.field.address.read
report.customer.field.status.read             report.location.field.customer.read
report.customer.field.relationshipTypes.read  report.equipment.field.name.read
report.customer.field.tags.read               report.equipment.field.status.read
report.customer.field.createdAt.read          report.equipment.field.identity.read
report.customer.field.commercialProfile.read  report.equipment.field.dates.read
report.customer.field.billingContact.read     report.equipment.field.customer.read
                                              report.equipment.field.location.read
                                              report.equipment.field.createdAt.read
```

**Nothing is classified `UNKNOWN` on the row-scope question.** The absence of a mechanism is *proven*
(§ 1.2), not uncertain. What **is** unknown is whether the exposure has been **realised** — and that is
a different question, kept separate on purpose:

| Question | Status |
|---|---|
| Can these capabilities reach company-crossed rows? | **PROVEN YES**, executed. |
| Is the running production bundle the one that honours the 25? | **UNPROVEN** (U1). Under the alternative it honours **36**, which is worse. |
| Does any production principal hold a qualifying `RoleAssignment` today? | **UNPROVEN** (U2). No Firestore read was made. |

### 1.9 Who can hold it — and the `#169` safety condition that no code enforces

`DECISIONS #169` accepted SET 2 on a stated condition:

> "**REPORTING_ROW_SCOPE_DEPENDENCY.** … SET 2 is safe for admin **only** because admin already holds
> whole-collection read on accounts/contacts/equipment/locations. A Role with narrower source-record
> authority must not receive Reporting on field permissions alone until row scope is proven no broader
> than that Role's source authority."

| Fact | Method |
|---|---|
| Client-direct read of all four collections requires `isAdminOrDispatcher()` (`firestore.rules:1320, 1342, 1506, 1556`). For an admin, Reporting adds no new reach — the `#169` premise holds. | **STATIC** |
| `reportViewer` is `privileged: false`, `compatibility: false`, and carries **23 of the 25** — including all four object reads. `reportFinanceViewer` carries 2. Both are grantable `systemSeed` governed Roles. | **EXECUTED** (23/25, 2/25) + **STATIC** `governedBusinessRoles.ts:1372-1436`. |
| Neither Role declares `scopesByPermission`, so a **global** assignment is permitted by `bindingAllowsAssignmentScope` (absent declaration → allow, `bindingScopePolicy.ts:36-38, :60-67`). | **STATIC** |
| **Nothing in code enforces the `#169` condition.** A governed `grantRole` of `reportViewer` at global scope to a principal who is neither admin nor dispatcher would confer whole-collection, company-crossed read of all four collections — strictly wider than that principal's source authority — and would pass every guard. | **RECONCILED** |

> **This is the sharpest realisable risk in the set.** It is not that admin can see both companies
> (admin already could, through Rules). It is that `reportViewer` **manufactures** whole-collection
> authority for a principal who has none, and the condition `#169` attached to prevent exactly that is
> recorded in prose and asserted nowhere.

---

## 2. Deliverable 2 — the exact consequences of `OD-R4`

> **`OD-R4` — MAY EOS USE DERIVED COMPANY SCOPE FOR REPORTING WHEN THE OBJECT ITSELF DOES NOT CARRY
> AUTHORITATIVE SINGLE-COMPANY OWNERSHIP?**

**This entry does not resolve `OD-R4`.** Consequences per object, YES and NO stated separately.
Recommendations appear only where the evidence supports one and are labelled **RECOMMENDATION**.

### 2.1 ACCOUNT (`customer` / `accounts`)

Derivation is **strong**: six record types carry a `REQUIRED` operating company alongside an
`accountId` (`sales_orders`, `invoices`, `payments`, `invoice_adjustments`, `refunds`,
`payment_applications`), plus `sales_agreements` at `REQUIRED-AT-COMMIT`
(`ENG-IMPL-001 § 4.1`). **And a customer may legitimately transact with both Taylor and Ventana
(R-14/R-15).**

| | Consequence |
|---|---|
| **If YES** | A Customer report may be company-scoped by derivation. **Five things become mandatory, not optional.** (1) The grain must be **(account, deriving fact)** — an account with a Taylor order and a Ventana order yields **two** rows and is **never collapsed**; `MULTI_COMPANY_REACH` is the legitimate normal case, not a `CONFLICT`. (2) Every row must carry `derivationStrength`, so a `REQUIRED` company is never presented alongside a `FIXTURE_BACKFILL_ONLY` one as though they were equally true. (3) The result must be labelled `COMPANY_DERIVED`, never `COMPANY_SCOPED`. (4) **Coverage must be reported as a number** — accounts with no governed commercial activity acquire no reach and are `UNKNOWN`; they must not silently vanish from a scoped report, which is `OD-R3`. (5) Because the engine cannot ask the inbound question at all (§ 3.1), the derivation must be **precomputed** — YES to `OD-R4` for Account therefore **entails** Deliverable 3's projection. It is not a smaller change. |
| **If NO** | Customer reports are **honestly company-neutral** and must be labelled so. A Taylor operator asking "show me my customers" gets every customer of both companies with an explicit neutrality statement. `report.customer.read` and the seven Customer field reads remain **UNSAFE-BY-DESIGN-BUT-DECLARED** rather than incorrect — the data is wide and the label is true. The only alternative path to `COMPANY_SCOPED` for Account is a company field on `accounts`, which **R-15 and standing rules 2/5 forbid**, and this entry does not propose it. |
| **RECOMMENDATION** | None on the YES/NO axis — it is a product-truth question. **One recommendation regardless of the answer:** the multi-company case must not be resolved by tiebreak, most-recent-wins, or a "primary company". Under YES it is two rows; under NO it needs no resolution. **Under no answer does a single company get written onto an Account.** |

### 2.2 CONTACT (`contacts`)

**No authoritative company derivation exists.** `ENG-IMPL-001 § 4.3` establishes this exhaustively
across every contact-shaped storage site; `ContactRecord` is
`{ id, tenantId, accountId, name, email, phone, contactRole, isPrimary, ownerEmployeeId }` —
no company field of any kind. Even the one code path that reaches `contacts` from a company-bearing
record keeps the **`accountId`** and discards the contact id.

| | Consequence |
|---|---|
| **If YES** | It **cannot be satisfied for Contact on Contact's own evidence.** The only available construction is **second-order**: inherit the parent Account's derived reach. Consequences: (1) confidence can never exceed the Account's, and the Account's is itself derived — so a Contact scope is a derivation **of a derivation** and must be labelled as such; (2) an Account with `MULTI_COMPANY_REACH` propagates **multi-company reach to every one of its contacts**, so a single-company Contact report is not achievable even under YES; (3) a contact of an account with no commercial activity is `UNKNOWN` and **must stay `UNKNOWN`**. This is `OD-R7`, already open, and it is a *narrower* question than `OD-R4` — answering `OD-R4` YES does **not** answer `OD-R7` YES. |
| **If NO** | Contact reports are declared **company-neutral**, permanently, until business authority establishes a company-bearing Contact fact. This is the honest answer and it costs nothing that exists today. |
| **RECOMMENDATION** | **Declare Contact reports company-neutral.** This is the one object where the evidence genuinely supports a recommendation, and it supports it in the negative direction: there is **nothing to derive from**. Manufacturing a Contact company — by inheritance presented as authority, by `ownerEmployeeId`'s company, or by any other proxy — would be the invented join the register forbids. A second-order inherited **label**, clearly marked as inherited and carrying the Account's multi-company reach intact, is the *most* that could be offered under YES; it must never be presented as the Contact's company. |

### 2.3 LOCATION (`locations`)

Derivation exists and is **thin**. The structural finding: **no record type at this baseline carries
both a `REQUIRED` company and a `REQUIRED` reference to a customer `locations` document.** The
strongest company (`sales_orders`) has an **optional** `locationId`; the strongest location reference
(`equipment.locationId`, required and doubly enforced) has a company **no live writer produces**
(`ENG-IMPL-001 § 4.2`). And the warehouse/`mobile_locations`/bin/truck family is closed to `locations`
by ruling **and** by a throwing guard (`customerIdentity.ts:196-218`).

| | Consequence |
|---|---|
| **If YES** | A Location report may be company-scoped by derivation **only with a published coverage figure**, because the coverage will be materially lower than Account's and the shortfall is structural, not a data-quality gap. Consequences: (1) a large fraction of sites will be `UNKNOWN` and must be **visible as `UNKNOWN`**, never dropped; (2) the `equipment`-mediated path must be **excluded or marked `FIXTURE_BACKFILL_ONLY`** — including it unmarked would present a capped sandbox backfill as a governed fact; (3) the thinness must be carried in the label, not just in a design document. A "Taylor sites" report that silently omits most sites is worse than a neutral one. |
| **If NO** | Location reports are honestly company-neutral. Nothing is lost that is currently true. |
| **RECOMMENDATION** | **Do not elevate Location derivation to authority.** If `OD-R4` is YES, Location must be gated on the coverage measurement (**U4**) being taken **first**: a derived Location scope whose coverage is unknown cannot be honestly labelled at all. This is a sequencing recommendation, not an answer to `OD-R4`. |

### 2.4 EQUIPMENT (`equipment`)

Company ownership **is** authoritative in the model — `ownershipMatrix.ts:461-463` declares
`ownerFields: ["operatingCompanyId"]`, `SINGLE_COMPANY`. `OD-R4` therefore **does not apply to
Equipment**: Equipment does carry authoritative single-company ownership, so standing rule 1
(`SINGLE_COMPANY` facts may be directly company-filtered) governs, not `OD-R4`.

**But the reporting path cannot use it, for three independent reasons, and the order matters:**

| # | Blocker | Evidence |
|---|---|---|
| 1 | **No live writer.** The sole writer is a capped, fixture-only sandbox backfill (`ownershipBackfillRules.ts:125-138`, cap 278 at `:222`); the live create path's allowed-keys list has no company (`equipmentImportCommand.ts:62-63`). A record created today gets **no** company. | **STATIC** |
| 2 | **Not in the report catalogue.** `EQUIPMENT_FIELDS` has twelve fields and no company, so **no predicate can bind to it** — the validator refuses the definition outright. | **EXECUTED** (T6) |
| 3 | **No activated capability, and no `orderBy`-compatible index.** A field capability would have to be catalogued, made production-eligible, and adopted; `firestore.indexes.json` contains zero occurrences of `operatingCompanyId`. | **STATIC** |

| | Consequence |
|---|---|
| **If `OD-R4` is YES** | Equipment gains nothing from it. Equipment does not need derivation — it needs (1) a live writer, (2) a catalogue field + capability, (3) an activation decision, (4) an index. **A `where()` is the last of those, not the first.** |
| **If `OD-R4` is NO** | Equipment is unaffected. It remains the one object that **could** become genuinely `COMPANY_SCOPED`, and the only object for which that phrase would be honest. |
| **RECOMMENDATION** | **Equipment is the correct first object to make genuinely company-scoped, and it must not be done by backfill.** `ownershipMatrix.ts:465-467` already rules: *"No deterministic source exists: every candidate on the record (customer, title holder, location name) is a prohibited proxy. No mass assignment."* So the order is **live writer first, then catalogue field, then activation, then index** — and existing records stay `UNKNOWN` until a governed act assigns them. An `UNKNOWN` equipment company must never be converted into a company by the reporting layer. |

### 2.5 What `OD-R4` cannot decide, either way

| Fact | Why `OD-R4` does not reach it |
|---|---|
| **The engine has no row-scope mechanism at all** (§ 1.2) | YES requires building the projection **and** a way to apply it; NO requires building the **labelling**. Neither answer leaves today's engine correct. |
| **The object gate is base-only** (§ 1.3) | Under either answer, per-object scope decisions leak through the joins unless traversal is gated too. |
| **The 20,000-doc scan bound** (§ 1.5) | Under YES, an in-memory scope produces false empties; a scoped run whose scan truncated must **refuse**. Under NO, the same defect already exists for ordinary filters and is unaddressed. |
| **`report.definition.read` is already correctly scoped** | Per-owner, by `ownerUid`. `OD-R4` does not touch it. |

---

## 3. Deliverable 3 — the structurally required projection

### 3.1 Why it is structural and not stylistic

The engine's traversal is **one-hop and strictly outbound**: `joinRelatedDocs` reads a reference field
**on the base document** and fetches that document by id, and `resolveDefinitionField` admits only a
catalogued `hop: 1` relationship *from* the base (**EXECUTED** T8/T9/T10).

Deriving a company for an Account requires the **inbound** question — *find the sales orders whose
`accountId` is this account*. **The engine cannot express it at all,** and no amount of catalogue work
makes it expressible: a relationship needs a reference field on the base document, and an Account has
none pointing at a sales order. **EXECUTED** confirmation: `REPORT_RELATIONSHIPS` has six entries, all
outbound from the base, and **nothing joins to `equipment`** — the direction is a property of the
mechanism, not of the catalogue's current contents.

**Therefore the derivation must be precomputed.** This entry adopts `ENG-IMPL-001 § 5.2`'s shape and
states the **smallest correct requirements** against it, adding what the executed evidence demands.

### 3.2 The smallest correct requirements

**R1 — Grain.** One row per **(tenant, object, record, deriving fact)**. **Never** one row per record.
A single company per record is forbidden wherever multi-company reach is legitimate, which for Account
is ruled legitimate (R-14/R-15).

**R2 — Fact classes, carried per row and never merged.**

| Class | Meaning | Rule |
|---|---|---|
| `AUTHORITATIVE FACT` | The record itself carries a governed operating company. | Today: **Equipment only**, and only where a governed act wrote it. Never produced by the projection. |
| `DERIVED FACT` | A governed company-bearing fact references this record. | Must carry `derivingFactType`, `derivingFactId`, `derivingFactCompanyField`, `derivationStrength`. |
| `UNKNOWN` | No governed path reaches a company. | **Never converted into a company.** Must remain visible as `UNKNOWN` in the result, not filtered away. |

**R3 — Strength is mandatory, not decorative.** `REQUIRED` / `REQUIRED_AT_COMMIT` / `OPTIONAL` /
`FIXTURE_BACKFILL_ONLY`. Flattening `sales_orders` (refused without a company) together with
`equipment` (fixture-only, no live writer) would present a fixture artifact as a governed fact.

**R4 — Outcome vocabulary: reuse `ownershipDerivation.ts`'s five values**, add exactly one.
`DERIVABLE` / `MISSING_REFERENCE` / `INVALID_REFERENCE` / `POTENTIALLY_CROSS_COMPANY` / `CONFLICT`,
plus **`MULTI_COMPANY_REACH`** — more than one governed company reaches this record through governed
facts. **Legitimate, never a defect, never collapsed, never a `CONFLICT`.**

**R5 — Per-context minimum content.**

| Context | Minimum correct content | Why |
|---|---|---|
| **Account** | Derived rows from the six `REQUIRED` financial/commercial types + `sales_agreements` at commit; `MULTI_COMPANY_REACH` preserved; coverage countable. | § 2.1 |
| **Contact** | **No first-order rows exist.** Either omitted entirely, or a row explicitly typed as `INHERITED_FROM_ACCOUNT` carrying the Account's reach **including its multi-company reach**, never presented as the Contact's own company. | § 2.2 |
| **Location** | Derived rows from `sales_orders`/`sales_agreements` where `locationId` is present; the `equipment`-mediated path **excluded or marked `FIXTURE_BACKFILL_ONLY`**; coverage figure mandatory. | § 2.3 |
| **Equipment** | **No projection row.** Equipment needs the authoritative field made writable, catalogued and filterable — a projection here would be a duplicate authority, which is prohibited. | § 2.4 |
| **Operating-company participation** | The set of companies reaching a record, as a **set**, with each member's deriving fact and strength. Never reduced to a scalar. | R-14/R-15, D-10 |
| **Cross-company participation where legitimate** | `ownerClass === "PARTICIPATING_COMPANIES"` is the cross-company discriminator — **not** the presence of a company pair. `inventory_transactions` carries the same pair while being `SINGLE_COMPANY`; `transferOrder` is the sole `CROSS_COMPANY_CAPABLE` holder and **its pair is declared but never produced** — no create path writes it, and no query-level guard refuses a scalar company predicate against the family. A projection must therefore treat a declared-but-unproduced pair as **`UNKNOWN`**, never as evidence of participation. | `ENG-IMPL-001 § 3.2-3.3`, verified as the brief asked |

**R6 — Prohibitions, load-bearing.**
- **No resolved single company per record.** No `accounts/{id}.derivedCompanyId`, no
  `resolvedCompanyId`, no "primary" company, no most-recent-wins tiebreak.
- **The projection is a reader of company authority, never an author.** It writes nothing onto
  `accounts`, `contacts` or `locations` — a projection that wrote back would be the prohibited field
  under another name.
- **Never add `operatingCompanyId` to Account, Contact or Location** to make reporting easier.
  Owner-forbidden; not proposed here in any form.
- **No `where(operatingCompanyId == x)` against an object with no such authoritative field.**

**R7 — Requirements the executed evidence adds to `ENG-IMPL-001 § 5.2`.** These are new.

| # | Requirement | Because |
|---|---|---|
| **R7.1** | **Traversal must be gated by the scope, not only the base object.** The object gate is **base-only** (§ 1.3, EXECUTED T3): a scoped Equipment report that joins to `accounts` would return account fields with **no Account-side scope applied at all**. Scoping the base is not scoping the result. | T3/T4 |
| **R7.2** | **A scoped run whose scan truncated must REFUSE**, not return a page. `judgeScanCompleteness` needs a fourth verdict — `refuse-incomplete-scope`. F1 shows a filtered run returning `kind: "empty"` with `truncated: true`, rendered to the user as a successful empty result. | F1/F2 |
| **R7.3** | **The scope predicate must be server-side against the projection**, which is keyed by company and can therefore be paged completely. An in-memory scope inherits the arbitrariness of a `where()`-less, `orderBy()`-less 20,000-document page. This needs an index that does not exist (`firestore.indexes.json`: zero `operatingCompanyId`). | § 1.5 |
| **R7.4** | **The scope must not be droppable.** Reporting's predicate-drop rule silently discards a predicate the runner may not read and **widens** the result (F3/F4, EXECUTED). A company scope routed through the same path would widen to every company on a permission edge. A scope is not a user predicate and must not share its failure mode. | F3/F4 |
| **R7.5** | **Authorization must carry a company-typed target.** `reportExecutionService.ts:420` builds `{ scope: { type: "global" } }`; an `operatingCompany`-scoped assignment therefore resolves **DENY**, not "narrowed" (EXECUTED T7, § 0.5). Until that target is company-typed, the `operatingCompany` scope type is **unusable** in reporting — this is a code change, not configuration. | T7 |
| **R7.6** | **Coverage and staleness must be readable from the result.** `builtAt`/`builtAtBaseline` plus a coverage count, so a reader can distinguish a true empty from an unbuilt projection. | § 2.3 |

---

## 4. Deliverable 4 — the TEMPORARY REPORTING CONTAINMENT decision, framed

> **FRAMING ONLY. NO PRODUCTION CHANGE IS MADE OR IMPLIED. NO AUTHORIZATION IS CONFERRED.**
> This lane has no authority to change any activation and has changed none.

### 4.1 The decision

For every production-active capability classified **UNSAFE** (24 of 25):

- **Option A — FAIL CLOSED.** Temporarily withdraw production activation until correct row scope
  exists.
- **Option B — ACCEPT KNOWN EXPOSURE.** Keep active with the exposure documented and accepted while
  remediation is built.

**Recommended default: FAIL CLOSED (A).**

### 4.2 The precision that matters — A does **not** mean 25 ids

Withdrawing all 24 unsafe ids is **not necessary**, because the **base-object gate runs first and
returns `permission-denied` with `rows: null` before a single collection read** (`reportExecutionService.ts:420-450`,
**EXECUTED** T4/T7), and a definition's base object **must** be one of exactly four
(**EXECUTED**, § 1.1).

> **MINIMAL SUFFICIENT CONTAINMENT SET — 4 ids.** Remove these four from
> `taylor-parts-production.productionCapabilityActivations`, and **every possible report definition
> returns `permission-denied` before any document is read**:
>
> ```
> report.customer.read
> report.contact.read
> report.location.read
> report.equipment.read
> ```
>
> **Each of the four is necessary.** Leaving any one active leaves that collection fully scannable
> **plus every collection its activated outbound traversals reach** — leaving only
> `report.equipment.read` still reaches `equipment` + `accounts` + `locations` in one run
> (**EXECUTED** T10). **All four are sufficient**: no fifth id opens a row read, because § 1.3's
> join bypass operates *within* a run whose base object was already admitted, never to start one.

### 4.3 The three options, with exact id sets

| Option | Ids touched | Effect | Cost |
|---|---|---|---|
| **A-MIN** (recommended) | **4** — the four object reads above | Every report run returns `permission-denied`, `rows: null`, nothing read. `report.definition.read` keeps working (per-owner, SAFE), so saved definitions remain listable and are not lost. The 20 field reads become **inert** — they authorize columns in runs that can no longer start. | Reporting unavailable in production. Honest: the surface renders `permission-denied`, which the client already handles. |
| **A-FULL** | **24** — the full unsafe set (§ 1.8); `report.definition.read` retained | Same runtime effect as A-MIN, with no inert-but-adopted ids left in the registry. | 20 additional registry removals with no additional runtime effect. Defensible as hygiene; **not** required for containment. Re-adopting 24 ids later is 24 decisions instead of 4. |
| **B** | **0** | Status quo. Requires **explicit written acceptance** of: whole-collection company-crossed reads of `accounts`/`contacts`/`locations`/`equipment` (T1, T8, T9, T10); unscoped cardinality from an object read alone (T5); the base-only object gate (T3); false-empty-as-success above 20,000 documents (F1); silent predicate-drop widening on the 14 non-adopted fields (F3/F4); and the unenforced `#169` `REPORTING_ROW_SCOPE_DEPENDENCY` condition (§ 1.9). | Exposure persists. **Under reading (a) of § 0.9 the accepted exposure is 36 ids, not 25** — including the four definition mutations and the sensitive fields. |

**Explicitly NOT recommended: disabling all 25.** `report.definition.read` is genuinely row-scoped by
`ownerUid` and reaches no business object. Withdrawing it would destroy access to saved definitions
without containing anything.

### 4.4 Two non-activation actions this lane recommends regardless of the option chosen

Neither is a production change; both are repository work, and neither is authorized by this entry.

| # | Action | Why |
|---|---|---|
| **N1** | **Repair `functions/test/reportingActivationBoundary.test.mjs` to resolve through `resolveRuntimeCapabilityOverrides`.** It currently asserts production is fail-closed for all 39 while the runtime path resolves 25 ALLOW (§ 0.8). A guard that passes while stating the opposite of the runtime is worse than no guard. **A concurrent lane owns `functions/**`; this lane changed nothing.** | § 0.8 |
| **N2** | **Establish the deployed production bundle's identity** under Owner-authorised operator action. Reading (a) and reading (b) of § 0.9 differ by 11 capabilities including four mutations; a containment decision taken against the wrong reading is taken against the wrong set. | § 0.9, U1 |

---

## 5. Acceptance / proof

A containment or remediation is demonstrated correct only if the **negative** cases hold.

| # | Negative case | Today |
|---|---|---|
| N-1 | A run as a global-scoped `owner`/`admin` after A-MIN returns `permission-denied` for **all four** base objects. | Returns rows (T1, T8, T9, T10). |
| N-2 | A definition whose base is `equipment` cannot return an **Account** field when the runner lacks `report.customer.read`. | **It can** (T3). |
| N-3 | A scoped list whose scan truncated **refuses**, and never returns `kind: "empty"`. | Returns `empty` with `truncated: true` (F1). |
| N-4 | An `operatingCompany`-scoped assignment **narrows** a report rather than denying it. | Denies (T7). |
| N-5 | A company predicate is expressible against `equipment`. | Refused by the validator (T6). |
| N-6 | An `UNKNOWN` company is never rendered as a company. | No scope exists to render. |
| N-7 | An account reached by both companies yields two rows and is never collapsed. | No projection exists. |
| N-8 | A dropped predicate never widens a **scoped** result. | Widens an unscoped one (F3/F4). |
| N-9 | The activation-boundary test fails when production activates a `report.*` id. | **It passes** while 25 are activated (§ 0.8). |

**Positive cases** worth asserting: field-level activation genuinely drops non-adopted columns (T2,
already true); `report.definition.read` returns only the actor's own definitions (already true);
`countRows` over a truncated scan refuses (F5, already true).

**What would NOT be a proof:** a static parse of `active: false`. That is exactly the reading that
produced the error this entry corrects.

---

## 6. UNPROVEN

| # | Not established | What would settle it |
|---|---|---|
| **U1** | **Which source commit the running production Functions bundle was built from**, and therefore whether the live `report.*` set is **25** (reading b) or **36** (reading a). The last recorded production Functions deploy pinned `fb45e6ee` (2026-08-06, estate 22) and no later one is recorded through `DECISIONS #179`; `#169` itself records `REPORTING_PRODUCTION_LIVE = STILL_0`. No production contact was made. | `firebase functions:list --project taylor-parts` plus the deployed bundle's identity, under Owner-authorised operator action. |
| **U2** | **Whether any production `RoleAssignment` currently confers these capabilities on any principal**, and at what scope. No Firestore read was made. A capability that is ALLOW-able is not the same as one that is held. | An Owner-authorised count of `roleAssignments` by `roleId` ∈ {`owner`, `admin`, `reportViewer`, `reportFinanceViewer`} and `scope.type`. |
| **U3** | **Whether the client Reporting surface is reachable in production.** `reportExecutionSeam.js:32-40` calls the callable (per `ENG-IMPL-001 § 1.5`) and the Hosting catch-up is separately recorded as unauthorized. Whether the deployed Hosting bundle exposes the report builder is unverified. | Compare the deployed Hosting bundle's identity against `main`. |
| **U4** | **Coverage** — what fraction of Accounts and Locations would acquire a derived reach over real data. Carried from `ENG-IMPL-001 U4`; not re-measured. Without it, § 2.3's labelling requirement has no number. | Build the projection read-only against a sandbox and count. |
| **U5** | **Whether `MULTI_COMPANY_REACH` occurs in real data, and at what rate.** Carried from `ENG-IMPL-001 U5`. If rare, `OD-R5` is small; if common, defining. | Count distinct `derivedCompanyId` per `(tenantId, accountId)`. |
| **U6** | **Row counts in the four production collections** — whether any exceeds `MAX_SCAN_DOCS = 20_000` and so is already subject to F1's false-empty. Sandbox figures (`accounts` 103, `contacts` 339, `locations` 183, `equipment` 288) are sandbox, dated 2026-08-30, and were **not** re-measured. | An Owner-authorised production count per collection. |
| **U7** | **Whether the audit trail actually records these runs in production.** `recordStandaloneAuditEvent` is called on every outcome (`reportExecutionService.ts:612-625`) but the stubbed-Firestore harness recorded **0** audit writes, so this lane verified the **call sites** and **not** the write. | Run `functions/test/reportExecutionService.test.mjs` against a built `functions/lib` with an emulator. |
| **U8** | **Whether a governed `grantRole` path would in fact permit `reportViewer` at global scope to a non-admin.** § 1.9 is reconciled from `bindingScopePolicy.ts`'s absent-declaration-allows contract and the Role definitions; the `grantRole` command itself was not executed. | Execute `grantRole` against the emulator with a `reportViewer` + global request. |

---

## 7. Corrections to the brief and to `ENG-IMPL-001`

| # | Claim | Measured at `64008d5a` | Method | Where |
|---|---|---|---|---|
| **D1** | `ENG-IMPL-001 § 1.4`: "Company-scoped reporting has **no production exposure** today. Every `report.*` capability resolves to DENY for every principal … admin included." | **Refuted.** `resolveRuntimeCapabilityOverrides()` under `GCLOUD_PROJECT=taylor-parts` returns **25**; `owner`/`admin` resolve **ALLOW 25/25** and a full run returns both companies' rows. The reliability order was inverted: a static flag was allowed to overrule the executed mechanism. | **EXECUTED** | § 0 |
| **D2** | Brief: "**25 report capabilities are LIVE IN PRODUCTION.**" | **The mechanism claim is correct; "LIVE" needs a deployment qualifier, and the correction runs toward MORE exposure.** 25 is what production has **adopted** and what current-`main` source resolves. The last recorded production Functions deploy pinned `fb45e6ee`, where **36 of 39 are `active: true`** and `owner` resolves **ALLOW 36/39** — including the four definition mutations and the sensitive fields. **25 is the floor.** | **EXECUTED** + **STATIC** | § 0.9, U1 |
| **D3** | Not raised by the brief — found. | **`functions/test/reportingActivationBoundary.test.mjs` asserts production is fail-closed for all 39 `report.*` and passes while 25 are production-activated,** because it resolves through `resolveCapabilityOverrides` (non-production) and never through `resolveRuntimeCapabilityOverrides`. | **EXECUTED** | § 0.8 |
| **D4** | Not raised — found. | **The object-level read gate is BASE-ONLY.** A related object's `objectReadCapability` is never checked on a join. A principal with `report.equipment.read` and **no** `report.customer.read` read Account names. Deactivating an object read does **not** contain that object's field data. | **EXECUTED** | § 1.3 |
| **D5** | `ENG-IMPL-001 § 5.5`: the `operatingCompany` scope type "already exists … does not need a new concept." | **Refinement.** It exists in the permission model and confers **nothing** in reporting: an `operatingCompany`-scoped assignment resolves **DENY `noQualifyingGrant`** for all 25 and a run returns `permission-denied`, because reporting's target is hardcoded `global`. Granting Reporting at a company scope **disables** it rather than narrowing it. Seating scope there is a code change. | **EXECUTED** | § 1.2, R7.5 |
| **D6** | Brief: "`report.customer.field.*` **may** have materially narrower reach than object-read ids — establish that." | **Established, and the answer is the opposite of the hint for Customer and correct for Equipment.** Customer field reads are reachable from **all four** bases (via three inbound-to-`customer` traversals), so their reach is **wider**, not narrower. **Equipment** field reads are reachable from `equipment` **only** — nothing joins to `equipment` — so those seven are the genuinely narrow ones. | **EXECUTED** | § 1.4, § 1.7 |
| **D7** | Brief: verify "report execution reaches four objects because `validateReportDefinition` defaults its activated set to `objectsWithPopulatedFields()`"; "`MAX_SCAN_DOCS = 20,000`"; "the join is one-hop outbound only". | **All three verified.** Four objects (`customer`, `contact`, `location`, `equipment`); `MAX_SCAN_DOCS` printed as `20000`; one-hop outbound confirmed by executed join runs and by `REPORT_RELATIONSHIPS` having no inbound edge to `equipment`. | **EXECUTED** | § 1.1 |
| **D8** | Brief: "Return the smallest exact set … whose reachable data cannot currently be row-scoped." | **24 of 25** (not 25). `report.definition.read` is already row-scoped per-owner by `ownerUid` and reaches no business object. **Separately, and more usefully: the minimal CONTAINMENT set is 4, not 24** — the four object reads, because the base gate precedes every read and the base must be one of four. | **EXECUTED** | § 1.7-1.8, § 4.2 |
| **D9** | `DECISIONS #169`: the 20 adopted field reads are "**ordinary** field reads". | **Two carry non-`standard` sensitivity:** `commercialProfile` (`commercial` — `defaultCurrency`, `purchaseOrderRequired`, `invoiceDeliveryMethod`) and `billingContact`, and both are members of `reportFinanceViewer`'s tier-2 finance set. Not a contradiction — `#169`'s deferred list is exactly the 10 it names — but "ordinary" understates two of the twenty. | **EXECUTED** + **STATIC** | § 1.7 |
| **D10** | `DECISIONS #169`'s `REPORTING_ROW_SCOPE_DEPENDENCY` condition. | **Recorded in prose, enforced by nothing.** `reportViewer` is `privileged: false`, carries 23 of the 25 including all four object reads, declares no `scopesByPermission`, and would confer whole-collection company-crossed read on a principal whom `firestore.rules` grants no direct read at all. | **EXECUTED** + **RECONCILED** | § 1.9 |
| **D11** | Brief's surviving findings, re-verified rather than inherited. | **All hold.** `companyScopeField` ⟂ `companyScope`; `ownerClass === "PARTICIPATING_COMPANIES"` is the cross-company discriminator, not the presence of a pair (`inventory_transactions` carries the same pair while `SINGLE_COMPANY`); `transferOrder` is the sole `CROSS_COMPANY_CAPABLE` holder and its pair is declared but never produced, with no query-level guard refusing a scalar predicate against the family; neither company-scope column has a runtime reader; Accounts strong-but-legitimately-multi-company; Locations thin; **Contacts none**; Equipment authoritative in the model, absent from the report catalogue, no live writer; the Work Order carries **no** company field at all; matrix distribution 20/30/1 (itself `UNPROVEN` per `ENG-IMPL-001 U2`). | **STATIC**, re-read at `64008d5a` | throughout |

---

*End of `ENG-IMPL-002`. `IMPLEMENTATION STATUS: NOT AUTHORIZED`. No activation was changed by this entry; this lane has no authority to change one.*
