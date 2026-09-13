# ENG-IMPL-004 — KPI drill-through integrity: making a displayed number accountable

> **Register entry.** Documentation and design only. This entry authorizes no code, no schema, no
> activation, no grant and no deploy. See `./README.md` (created by `ENG-IMPL-001`) for the register
> schema and the standing rules this entry may not contradict.

| | |
|---|---|
| **Baseline SHA** | `64008d5ae0bdd9532909671b15a91122400accf1` — `origin/main` verified identical |
| **Short form** | `OBSERVED AT: 64008d5a` |
| **Lane** | UX-KPI-DRILL (extension lane, EVIDENCE_WRITE) |
| **Siblings referenced, not duplicated** | `ENG-IMPL-001` (company-scoped reporting) · `ENG-IMPL-003` (honest-absence state taxonomy, being written concurrently) |

## Register fields

| Field | Value |
|---|---|
| `SOURCE NORTH STAR` | **MISSING INPUT.** `docs/atlas/inputs/design-r1/` does not exist at `64008d5a`; neither does `docs/atlas/` at all (`git ls-tree -r 64008d5a -- docs/atlas` → empty). The need below is stated from an Owner framing plus measured code, never from a design page. |
| `USER NEED` | "When EOS shows me a number, I want to see the actual records behind it — and if I can't, I want to be told why, not shown a zero." |
| `DESIGN ELEMENT` | Any KPI / metric tile / summary count / total / percentage, and the path from it to its rows. |
| `CURRENT EOS STATUS` | **PARTIAL, and worse than partial in the two places that matter most.** EOS displays metrics on many surfaces. Exactly one class of them (§4 "good examples") derives the number and its rows from one predicate. The reporting engine — the only reporting family with **production capability activation** — has **no drill affordance at all** and is *structurally incapable* of returning an aggregate beside its rows (§2.3). A publicly-served page displays four tiles labelled "Live status" over hard-coded seed constants (§2.1). |
| `OBSERVED BASELINE` | `64008d5a` |
| `TYPE` | `READ MODEL / PROJECTION` · `API / TRANSPORT` · `OBSERVABILITY / AUDIT` · `FRONTEND PRIMITIVE` · `TESTABILITY` |
| `AUTHORITY IMPACT` | A drill-through is a **second authorization event over the same claim**. Today the aggregate and the rows are authorized by different targets, at different times, sometimes by different halves of the estate (R-K4). Getting this wrong either leaks rows behind a number the caller could legitimately see, or silently zeroes a number the caller legitimately holds. |
| `WORKFLOW IMPACT` | Whether a person can act on an EOS number. A number nobody can open is a number nobody can check, and a number nobody can check is one nobody should act on. |
| `PROPOSED DIRECTION` | The seven-part contract in §5, as testable requirements. |
| `DEPENDENCIES` | `ENG-IMPL-003`'s state taxonomy (R-K7) · Owner decisions `OD-R2`, `OD-R8` carried from `ENG-IMPL-001` · the new Owner decisions in §7 |
| `ACCEPTANCE / PROOF` | §6 |
| `IMPLEMENTATION STATUS` | **NOT AUTHORIZED** |

---

## 0. What this entry is, in one paragraph

A KPI tile is a claim about the business. This entry specifies the engineering contract that makes
such a claim **accountable**: for any number EOS displays, a person must be able to reach the exact
rows that produced it, under the same authority and the same scope, and get a consistent answer — or
be told honestly why not. It is **not** a design. It names required behaviour and required
*distinctions*; every genuine product judgement is marked **OWNER DESIGN DECISION** and left open.

Three things make it load-bearing rather than theoretical, and all three were measured, not assumed:

1. **Reporting is the one domain with production capability activation.** Twenty-five `report.*`
   capabilities are activated on the production project today (§1). So a drill-through is not a
   future surface — it is a missing half of a surface that is already live.
2. **The one production principal is the one who can run reports.** Production role occupancy is a
   single `admin@global` (§1.4). Authority-consistency is therefore not an edge case; it is the
   *normal* case.
3. **A page displaying four KPI tiles over seed constants, labelled "Live status", is served to the
   public internet at the product's own domain** (§2.1).

---

## 1. The load-bearing fact: reporting IS production-activated at this baseline

**This is the most misreported fact in the program, and a sibling register entry has it wrong.** It
is recorded here in full, with the method, because everything in §5 rests on it.

### 1.1 There are TWO activation fields, and each refuses the other's role

`config/environments.json` carries two *different* activation declarations, resolved by two
*different* functions in `functions/src/access/environmentCapabilityOverrides.ts`:

| Field | Resolver | Behaviour | Evidence (OBSERVED AT: 64008d5a) |
|---|---|---|---|
| `capabilityActivationOverrides` | `resolveCapabilityOverrides()` | `role === "production"` → **EMPTY unconditionally, ignoring the data** | `environmentCapabilityOverrides.ts:354` |
| `productionCapabilityActivations` | `resolveProductionCapabilityActivations()` | `role !== "production"` → **EMPTY unconditionally** | `environmentCapabilityOverrides.ts:748` |

They are combined in exactly one place:

```ts
// functions/src/access/environmentCapabilityOverrides.ts:773-775
const nonProduction = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
const production = resolveProductionCapabilityActivations(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
cachedOverrides = production.size > 0 ? production : nonProduction;
```

**The trap:** reading only `resolveCapabilityOverrides` (or only the field it consumes) yields
"production activates nothing", which is true *of that field* and false *of production*. The
non-production field is inert in production **by construction**; that is not evidence that production
is inert.

> **Correction to the brief, recorded because precision matters here.** The brief says the two fields
> "compose" in `resolveRuntimeCapabilityOverrides()`. The code is a **precedence ternary**, not a
> union (`:775`). The file's own comment at `:770-771` calls the result a union; it is not one. The
> distinction is currently harmless — exactly one of the two can be non-empty for any project,
> because each refuses the other's role — but a future project carrying both fields would get the
> production set and silently drop the other, and no test asserts a union.

### 1.2 What production actually activates — derived, with the method stated

**Method.** Static parse of the repository at `64008d5a`. No runtime, no production contact. Two
independent parses, both reproducible: (a) `config/environments.json`, per environment, length of
`productionCapabilityActivations` and `capabilityActivationOverrides`; (b) the literal id list inside
`PRODUCTION_ACTIVATION_ELIGIBLE_IDS`. The resolver intersects (a) with (b), so the activated set is
their intersection.

| Environment | `role` | `firebase.projectId` | `productionCapabilityActivations` | `capabilityActivationOverrides` |
|---|---|---|---|---|
| `local-emulator` | `sandbox` | — | 0 | 0 |
| `platform-sandbox` | `sandbox` | `eos-platform-sandbox` | 0 | 92 |
| `platform-certification` | `sandbox` | `eos-platform-certification` | 0 | 3 |
| `platform-integration` | `integration` | — | 0 | 0 |
| **`taylor-parts-production`** | **`production`** | **`taylor-parts`** | **25** | **0** |

`config/environments.json:303` onward declares those 25 ids. `PRODUCTION_ACTIVATION_ELIGIBLE_IDS`
(`environmentCapabilityOverrides.ts:52`) contains exactly 25 ids. **All 25 are `report.*`**, and the
two sets are identical, so the intersection is all 25:

`report.customer.read` · `report.contact.read` · `report.location.read` · `report.equipment.read` ·
`report.definition.read` · and 20 ordinary field reads (`customer.field.{name, status,
relationshipTypes, tags, createdAt, commercialProfile, billingContact}`, `contact.field.{name, role,
customer}`, `location.field.{name, address, customer}`, `equipment.field.{name, status, identity,
dates, customer, location, createdAt}`).

Deliberately **absent** and therefore still DENY in production: the four `report.definition`
*mutations* and the ten sensitive field reads (`environmentCapabilityOverrides.ts:39-52` states this
in terms). **Consequence for this entry: in production a caller may run a report and read a saved
definition, but may not create, rename, duplicate or delete one.** A KPI that cannot be saved cannot
be shared, and R-K1's provenance record has nowhere durable to live.

### 1.3 Activation lifts the catalogue deny — so the 25 really are reachable

| Link in the chain | Evidence |
|---|---|
| The catalogue registers **147** capabilities, **39** of them `report.*` | static parse of `functions/src/access/permissionCatalog.ts`; the 39 are at `:640-936` |
| **Zero** of the 39 is catalogue-`active` | static parse: 39 `report.*` blocks, 39 carrying `active: false` |
| `active: false` is lifted **iff** the id is in the activation set | `functions/src/access/resolveEffectivePermission.ts:264-265` — `if (permission.active === false && !input.activationOverrides?.has(input.permissionId)) return { decision: "DENY", reason: "inactivePermission" }` |
| The report engine passes the **runtime** (production-aware) set | `functions/src/reporting/reportExecutionService.ts:273` — `activationOverrides: resolveRuntimeCapabilityOverrides()` |
| Saved definitions likewise | `functions/src/reporting/savedDefinitionCommands.ts:184` |
| `admin` holds every catalogue id, `report.*` included | `functions/src/access/compatibilityRoles.ts:235-240` — `ADMIN_ALL_PERMISSIONS = [...ADMIN_CURATED_PERMISSIONS, ...PERMISSION_CATALOG.map(p => p.id).filter(...)]`, consumed at `:257` |
| The **callable is deployed in production** | `docs/audits/inv-convergence-e-c2-hosting-deploy/postdeploy-functions-inventory.normalized.json` lists `projects/taylor-parts/locations/us-central1/functions/runReportDefinitionCallable`, `state: ACTIVE`, `GEN_2`, alongside all six saved-definition callables. Stated flatly at `functions/test/reportingActivationBoundary.test.mjs:11`: *"`runReportDefinitionCallable` is ALREADY DEPLOYED IN PRODUCTION."* |
| The client seam is wired | `field-ops-app-vite/src/domain/reporting/reportExecutionSeam.js:32-40` calls `httpsCallable(functions, "runReportDefinitionCallable")` |

**Three in-repo comments assert the opposite and are false at this baseline.** Recorded, not fixed
(this lane may not touch `functions/` or the client):

| Location | The false claim |
|---|---|
| `functions/src/index.ts:173-182` | "NOT deployed to the production project"; "the client run seam … is unchanged and still unconditionally unavailable"; "requires NO Role grant exists for any `report.*` capability" |
| `functions/src/reporting/reportExecutionService.ts:22-28` | "every real call today resolves every `report.*` capability to DENY" |
| `functions/src/reporting/runReportDefinitionCallable.ts:9-15` | "NOT WIRED to any client" |

**And one CI guard is vacuous at this baseline — a LIVE testability defect.**
`functions/test/reportingActivationBoundary.test.mjs:77-79` asserts *"production carries no
activation overrides"* (`overrides.size === 0`) and **passes**, because `overridesFor()` resolves
through `resolveCapabilityOverrides()` — the non-production authority, which returns EMPTY for
`taylor-parts` by design (`:354`). The guard asks a production question of the authority that cannot
answer one, and every "production denies" assertion beneath it is tautologically true. A guard built
that way cannot fail. (Fixed on branch `rpt/client-outcome-honesty` by `510eba1c`; **LIVE at
`64008d5a`**.)

### 1.4 Who can exercise it — and why "an admin can drill in" proves nothing

| Fact | Evidence |
|---|---|
| Production has **2** `roleAssignments`, **16** `users`, **6** `employees` | `docs/assessments/r32-production-exposure-census.md` (committed census `be1e5579`, verified ancestor of `64008d5a`) |
| Exactly **one** principal holds any active RoleAssignment: **`admin` at `global` scope** | same |
| That principal has **no** `users/{uid}.employeeId` — anomaly `PRINCIPAL_HAS_NO_EMPLOYEE_LINK` | same |
| Three governed Roles exist that *would* carry report access to a non-admin: `reportViewer` (27 ids, `governedBusinessRoles.ts:1372`), `reportFinanceViewer` (5, `:1415`), `reportAuthor` (3, `:1441`) | — |
| **None is assigned to anyone in production** | the census's single-assignment finding |
| The `owner` Role's report grant is **empty at this baseline** — `OWNER_ACTIVE_REPORT_PERMISSIONS = PERMISSION_CATALOG.filter(p => p.id.startsWith("report.") && p.active !== false)` (`governedBusinessRoles.ts:66-68`) and no `report.*` is catalogue-active, so the filter yields **zero ids** | `governedBusinessRoles.ts:66-68`, `:83` |

So the *only* principal who can reach a production KPI is `admin@global`, who reaches it through
`ADMIN_ALL_PERMISSIONS` — the derived spread of the entire catalogue.

**This is why "an admin can drill in" is not evidence that drill-through works.** Held-only-by-admin
is one authority failure mode among several, and every one of them is a *different* required product
behaviour. Enumerated from the code, at this baseline:

| # | Authority failure mode | Evidence at `64008d5a` |
|---|---|---|
| A1 | **Held only by admin** — the capability is reachable, but only by the role that holds everything, so the feature is untested against any real grant | `compatibilityRoles.ts:235-240`; census single `admin@global` |
| A2 | **Granted but inactive** — the id is held and resolves DENY anyway | `resolveEffectivePermission.ts:264-265`; all 39 `report.*` are catalogue-inactive |
| A3 | **Active but ungranted** — the environment activates it and nobody holds it | the three report Roles exist and are unassigned (§1.4) |
| A4 | **Object-authorized, field-denied** — the caller may read the object but not the columns | `reportExecutionService.ts:462-464` drops columns; `:485-490` drops field-bound aggregates |
| A5 | **Predicate-denied** — a filter the caller may not see is silently *not applied*, widening the population the number covers | `reportExecutionService.ts:469`, `:492-495`; disclosed as a count only, `reportResultState.js:41-44` |
| A6 | **Scope-shaped denial** — a company-scoped assignment cannot satisfy a global target, so a company-bounded runner resolves DENY rather than getting their company's rows | `reportExecutionService.ts:420` hardcodes `{ scope: { type: "global" }, condition: {} }`; value-matching at `resolveEffectivePermission.ts:173-179` |
| A7 | **Client/server activation skew** — the two halves disagree about what is active, so a screen states an authority the backend does not have, or denies one it does | §1.5 |

### 1.5 The client half of the trap — a NEW finding, and the mirror image of the same mistake

The frontend learns its activation set at **build time** from a projection that is blind to the
production field:

```js
// scripts/resolveEnvironment.mjs:200-207
export function resolveCapabilityActivationOverrides(env) {
  if (!env || env.role === 'production') return [];
  const declared = Array.isArray(env.capabilityActivationOverrides) ? env.capabilityActivationOverrides : [];
  ...
}
```

`productionCapabilityActivations` **does not appear anywhere** in `scripts/resolveEnvironment.mjs`,
`scripts/buildCapabilityGraph.mjs`, or `field-ops-app-vite/` (grep at `64008d5a`: absent). The value
is baked at `field-ops-app-vite/vite.config.js:120` into `__APP_CAPABILITY_ACTIVATION_OVERRIDES__`,
read at `field-ops-app-vite/src/config/capabilityActivationOverrides.js:21-29`, and consumed by
`field-ops-app-vite/src/access/roleAccessModel.js:63` `operableCapabilityIds()`.

**So in a production build the client's operable set omits all 25.** The backend has them; the client
does not.

The sharpest evidence that this is a defect and not a design is the consuming file's own header:

> *"`active: false` in the catalog does NOT mean 'inert everywhere'. … A screen reading only the
> catalog reports a capability as denied while the backend resolver — reading the same override set —
> allows it."* — `field-ops-app-vite/src/access/roleAccessModel.js:40-45`

That is precisely the defect class the file was written to close, still open on the production half,
because the projection it trusts cannot see the production field. `roleAccessModel.js:52-57` asserts
the projection "is role-keyed (production resolves to `[]`) … so production cannot be widened from
here" — true of the *field it reads*, and the reason the gap exists.

**This entry's §2.2 shows that this is not abstract: it makes a shipped metric tile row wrong in
production by construction.**

---

## 2. KPI inventory at the baseline

**Scope of the census.** Every number EOS *displays* as a KPI / metric / tile / summary / count /
total / percentage. Four search axes were used so the census is not an artefact of one: (a) the shared
tile primitives `ContextBand` (17 module surfaces) and `primitives/CompactMetric.jsx`; (b) the domain
naming conventions `*NorthStar*`, `*Intelligence*`, `*AttentionProjection*`, `dashboard*`,
`*HealthStrip*`, `*Summary*`; (c) render-site grep for `.length` / `count` / `total` / `toFixed` in
JSX; (d) the reporting engine's aggregate path.

The inventory is presented in three tiers because the tiers differ in *kind*, not merely in count.

### 2.1 Tier 1 — the publicly-served legacy monolith. **UNACCOUNTABLE, and the worst case in the estate.**

**LIVE AT BASELINE.**

`index.html` at the repository root (740 KB, "Parts Control Center") **is deployed to the public
internet as the GitHub Pages site root**, not merely retained as legacy source:

| Fact | Evidence |
|---|---|
| The deploy workflow watches this exact file | `.github/workflows/deploy-field-ops.yml:9-12` — `paths:` includes `"index.html"` |
| …and copies it to the site root | `.github/workflows/deploy-field-ops.yml:58-63` — `cp index.html site/index.html`; the real app is staged under `site/field-ops/` |
| Documented as expected behaviour | `docs/DECISIONS.md:243` — *"the site root serves an unrelated legacy single-file app, 'Parts Control Center'"* |
| It points at the **production** project | `index.html:92-94` — `apiKey: "AIzaSy…"`, `projectId: "taylor-parts"` |
| Its only backend is one collection | `index.html:120`, `:127` — `db.collection("pcc")` |
| **`firestore.rules` has no `/pcc` rule at all** → every read denied | `grep -c "match /pcc" firestore.rules` → **0** |
| No Firebase Auth is loaded, so the reads are unauthenticated | `index.html:92-101` (config + warning only) |
| Each denied read is swallowed individually | `index.html:409-417` — nine `window.storage.get("pcc-…").catch(() => null)` |
| …and replaced with hard-coded seeds | `index.html:442-450` — `CATALOG_SEED`, `seedTrucks()`, `seedInventory()`, `seedWorkOrders()`, `seedUsers()`, `seedCustomers()` |
| The failure IS recorded — and **never read** | `index.html:399` declares `storageErrRef`, `:440` sets it `true`; those are its **only two occurrences in the file**. Write-only. |
| …under a claim of liveness | `index.html:1464` — *"Live status across the warehouse and all 10 service trucks."* |

The four tiles:

| Tile label | Render site | Value expression | Computation site |
|---|---|---|---|
| Parts in Catalog | `index.html:1467` | `catalog.length` | seed constant `CATALOG_SEED` (`:443`) |
| Total Units on Hand | `index.html:1468` | `totalUnits` | `index.html:682-685` over `seedInventory()` (`:444`) |
| Low Stock Alerts | `index.html:1469` | `lowStockRows.length` (turns accent-red when non-zero) | `index.html:669-680` |
| Open Work Orders | `index.html:1470` | `openWOCount` | `index.html:686` — `workOrders.filter(w => w.status === "open").length` over `seedWorkOrders()` (`:445`) |

Plus report totals at `index.html:1116-1124` (`totalUnits`, `totalValue`, `lowCount`, `partCount`,
`locationCount`), printed as a "Weekly Inventory Report" (`:1248-1251`) and tabulated (`:1888-1890`).

**Verdict: UNACCOUNTABLE.** There is no drill path, no provenance, no authority, and — the decisive
point — **no honest-absence state**. Every read fails, the failure is recorded in a ref nothing
renders, and fabricated constants are displayed under the word "Live". This is the exact inversion of
requirement R-K7: not "a zero shown where unavailable was meant", but *a confident non-zero shown
where nothing was read at all*.

> This entry does not propose a fix for the monolith; it is outside any product surface this register
> describes, and what to do with it is an Owner call (§7, `OD-K6`). It is inventoried because a census
> of "every number EOS displays" that omitted the only one on the public internet would be false.

### 2.2 Tier 2 — the React app (`field-ops-app-vite`). Metric surfaces, one of them wrong in production by construction.

**LIVE AT BASELINE.** The shared tile primitive `ContextBand` is used by **17** module surfaces
(`field-ops-app-vite/src/modules/**`, plus 3 shared-UI files that define or compose it);
`primitives/CompactMetric.jsx` by 4 more. This entry does not restate all of them — the
drill-integrity question is settled per-pair in §4, which covers the pairs that matter. Two are
called out here because they are *provenance* findings rather than drill findings.

#### 2.2.1 `AdminRolesPermissions` — a metric row about authority that is wrong in production

The Roles & Permissions surface renders a tile row of authority counts:

| Tile | Render site | Value |
|---|---|---|
| "Can actually do" | `field-ops-app-vite/src/modules/administration/AdminRolesPermissions.jsx:201` | `access.effective.length` |
| "Granted but inert" | `:205` | `access.inert.length` |
| "Active because of *{env}*" (rendered only when non-zero) | `:208-210` | `access.environmentActivated.length` |
| "Capabilities in catalog" | `:211` | `diagnostics.catalogSize` |
| "Active in catalog" | `:212` | `diagnostics.activeCount` |

Computation: `:148` `resolveRoleAccess(role, activation)` and `:150` `accessDiagnostics(…, activation)`,
both resolving through `operableCapabilityIds(activationOverrides)`
(`field-ops-app-vite/src/access/roleAccessModel.js:63`, `:185-190`). The `activation` value defaults
to `CAPABILITY_ACTIVATION_OVERRIDE_SET` (`AdminRolesPermissions.jsx:133`) — **empty in a production
build**, per §1.5.

**Therefore, in production, for the `admin` role:** the 25 production-activated `report.*` ids are
counted under **"Granted but inert"** instead of **"Can actually do"**, and the *"Active because of
taylor-parts"* tile reads 0 — so, being zero, `:208-210` **hides the row entirely**. The one tile that
would have disclosed the discrepancy is the one the discrepancy suppresses.

Two further notes, both material to R-K1:

- **Drill identity HOLDS here.** The tiles and the lists beneath them (`:289`, `:318`, `:330`) are
  computed from the same `access`/`diagnostics` objects, and `roleAccessModel.js:182-185` states the
  invariant explicitly (*"A diagnostics panel counting catalogue-inert while the list beside it counts
  environment-operable would put two numbers on one screen that disagree"*). The aggregate and its
  rows agree — **and are wrong together**. This is the cleanest available demonstration that drill
  identity (R-K2) and provenance (R-K1) are independent requirements: satisfying one does not
  approximate the other.
- **The rows are not Firestore rows.** The population is the bundled static catalogue and role
  definitions, and the subject is a *selected role*, not the viewer's own grants. A provenance record
  (R-K1) must be able to say "the source of this number is a build-time constant, and it describes
  someone else", because that is the truthful answer here.

#### 2.2.2 `MyDashboard` and the `*NorthStar*` family — the one place the invariant is stated and kept

`field-ops-app-vite/src/modules/dashboard/MyDashboard.jsx:286` renders tile values as
`g.items.length` — *the length of the very array the section below renders*. The file states the
limit of the claim at `:287-292` (the counts are "counted independently … they are not a total"), and
`field-ops-app-vite/src/domain/dashboardGoalActuals.js:8-16` carries the invariant in terms:

> *"If this file ever grows a query, a filter, a sum over rows, or a date comparison, the invariant has
> been broken."*

This is the pattern R-K2 requires, already in the codebase, already articulated. §4's "good examples"
table lists the other seven instances. **The contract in §5 is therefore not novel to EOS; it is the
generalisation of a rule EOS already enforces in about eight places and violates in about fourteen.**

### 2.3 Tier 3 — the reporting engine: aggregates without rows, and no drill affordance at all

**LIVE AT BASELINE, and production-activated (§1).** This is the tier the contract exists for.

| Fact | Evidence (OBSERVED AT: 64008d5a) |
|---|---|
| The single aggregate computation | `functions/src/reporting/reportExecutionService.ts:749-764` (`computeAggregate`), invoked per group at `:580` |
| Aggregate functions | `countRows` (fieldless, `:750` → `rows.length`), `count`, `sum`, `avg`, `min`, `max` (`:757-761`) |
| **An aggregate run returns NO ROWS.** `rows` and `aggregates` are mutually exclusive by construction | `:569-570` enters the grouped path when there is ≥1 groupBy **or** ≥1 aggregate; `:584` `resultRows = []`; `:601` `projectedRows = (grouped \|\| aggregated) ? null : …`; returned at `:639-640` |
| Aggregates are computed over `filtered` — the complete in-memory filtered+joined set, **before** the row cap | order: fetch `:500` → scan verdict `:507` → join `:550` → filter `:556` → sort `:562` → group+aggregate `:570-583` → caps `:592-596` |
| Non-numeric values are silently dropped from `count/sum/avg/min/max` | `:753-755` |
| `avg`/`min`/`max` over an empty set return **`0`**, indistinguishable from a real zero | `:759-761` |
| Group keys are `JSON.stringify(value ?? null)` joined with a space — two distinct group tuples can collide into one bucket | `:724-743` |
| **There is no drill affordance anywhere in the reporting UI.** Every `onClick` in `ReportBuilder.jsx` is Run / Save / add-filter / remove-filter / remove-sort (`:202`, `:261`, `:323`, `:355`, `:459`); every `onClick` in `SavedReports.jsx` is New / Refresh / Open / Rename / Duplicate / Delete. No result row, group row or aggregate cell is clickable, and no navigation is emitted from one | `field-ops-app-vite/src/modules/reporting/{ReportBuilder,SavedReports}.jsx` |

**So the defect is not "the drill query is a second implementation". It is that the drill query does
not exist, and the wire format cannot carry its answer.** An aggregate and its rows have never
travelled together in a single `RunReportOutcome`, so there is nothing for a user to reconcile and
nothing for a test to compare. That is the first thing R-K2 must change.

#### 2.3.1 The reconciliation facts, stated precisely

| Fact | Evidence | Why it defeats reconciliation |
|---|---|---|
| Bounds are `MAX_RESULT_ROWS = 10_000`, `MAX_GROUP_CARDINALITY = 1_000`, `MAX_SCAN_DOCS = 20_000` | `reportExecutionService.ts:136-147` | — |
| `rowCap` in the outcome is **always** `maxResultRows` | `:641` (and `:442` on the denial path) | It is a constant echo of the configured cap, **never the cap that actually bit** |
| On an aggregate run, `rowCapTruncated` is structurally unreachable: `aggregateRows` is already sliced to 1 000 at `:572` before `rowCountBeforeCap` is measured at `:589-590`, and 1 000 ≤ 10 000 | `:571-572`, `:589-593` | The real signal is `groupCardinalityTruncated`, and **there is no `groupCap` field in `RunReportOutcome` at all** (`:191-211`) |
| The client narrates the wrong cap back to the user | `field-ops-app-vite/src/domain/reporting/reportResultState.js:56-60`, `:72-76` — `Showing the first ${cap.toLocaleString()} rows` | Reads "Showing the first 10,000 rows" for a result cut at 1 000 groups |
| `truncated` is the OR of three unrelated facts | `:592-593` — `scanTruncated \|\| groupCardinalityTruncated \|\| rowCapTruncated` | One boolean cannot tell a reader which bound bit, so it cannot tell them what to narrow |
| Scan truncation **with** aggregates is refused, not understated — the X-9 precedent | `judgeScanCompleteness()` `:124-129`; refusal `:507-526` (`IncompleteAggregateScanError`), audited `outcome: "denied"` | This is the **right** behaviour and R-K5 adopts it rather than inventing one |
| …but the refusal reaches the user as "Reports aren't available yet" | `runReportDefinitionCallable.ts:56-57` maps it to `resource-exhausted`; `reportRunOutcome.js:71-81` has no branch for that code, so `default:` → `reportRunUnavailable()` → `reportRunOutcome.js:27` *"Running reports isn't available yet. Nothing was read or changed."* → `reportResultState.js:85-88` title *"Reports aren't available yet"* | **The sentence is false.** Documents *were* read — exceeding `maxScanDocs` is the entire reason the total could not be proven. A tool that misreports whether data was read is worse than one that errors, because the reader acts on it. |
| The refusal keys on `activeAggregates` — i.e. **after** authorization-dropping | `:507` reads `hasAggregates: activeAggregates.length > 0`; drops at `:485-490` | If every aggregate was dropped for lack of field authority, a truncated scan silently becomes a "bounded page" |
| A **groupBy-only** run (no aggregates) returns a DISTINCT-values list computed from a cut population, and `judgeScanCompleteness` never sees it | `:569` admits `activeGroupBy.length > 0` alone; `:507` gates on `hasAggregates` | A distinct-values list *is* an aggregate claim about the population |
| `countRows` is returned **unconditionally**, even to a caller holding zero field capabilities | `:486` — `isFieldlessAggregate(a.fn) \|\| (… authorizedFieldIds.has(a.fieldId))`; `:750` → `rows.length` | A caller with `report.customer.read` and no field capability receives an exact population count with every column dropped |
| A dropped **predicate** widens `filtered`, which is exactly the set `computeAggregate` runs over | `:469`, `:492-495`, `:570` | The returned number is a true total **of a population the author did not ask for**, disclosed only as "N filters were not applied" |
| The scan is unordered and unfiltered — `limit(maxScanDocs + 1)` with no `where()` and no `orderBy` | `:500`, `:501` | Which 20 000 documents you get is Firestore key order |

#### 2.3.2 The honest-absence defect at the KPI level — LIVE

```ts
// functions/src/reporting/reportExecutionService.ts:627-634
const kind: RunReportOutcomeKind =
  rowCount === 0 ? "empty"
  : droppedColumnLabels.length > 0 ? "partially-authorized"
  : truncated || widened ? "truncated-widened"
  : "results";
```

`rowCount === 0 → "empty"` is the **first** branch, outranking truncation, partial authorization and
widening alike. The client renders it as:

> *"No matching records" / "This report ran successfully but no records matched."* —
> `field-ops-app-vite/src/domain/reporting/reportResultState.js:26-29`

So a **KPI of zero over a page that was provably cut off is presented as a proven zero**, and one
audit event records the run as `outcome: "applied"` over it. This is the KPI-level instance of the
absence problem `ENG-IMPL-003` is specifying: see R-K7 — this entry states *which distinctions a KPI
must carry* and defers the state vocabulary to 003.

*(Fixed on branch by `b8308e48`, which introduces `judgeAbsenceProvenance()` / `UnprovenAbsenceError`
and refuses rather than understating. **LIVE at `64008d5a`.** The whole reporting remediation chain —
`92db1d19`, `b8308e48`, `8521cd88`, `510eba1c`, `5d8193fb`, `9d3ab48d`, `d65be79c`, `8e28e32d` on
`origin/rpt/reporting-remediation` — is FIXED ON A BRANCH and LIVE at this baseline. Nothing in this
entry may be read as describing it as fixed.)*

#### 2.3.3 Saved KPI definitions carry a different ownership model from everything else in EOS

This is directly in this lane's domain and is flagged as required by the brief.

| Fact | Evidence |
|---|---|
| The ownership matrix classifies `reportDefinition` / `reportDefinitions` as **`EXCLUDED`**, annotated *"platform record with its own private-by-owner model — do not disturb"* | `functions/src/ownership/ownershipMatrix.ts:521` |
| `EXCLUDED` families are *"not counted, not censused, and not backfilled"* | `ownershipMatrix.ts:548` |
| The stored record is `{ id, name, ownerUid, definition, createdAt, updatedAt }` — **no company, no scope, no provenance, no sharing field** | `functions/src/reporting/savedDefinitionCommands.ts:328-334` |
| Ownership is strict uid equality, with no admin or Owner override | `savedDefinitionCommands.ts:268` (`data.ownerUid === actorUid`), `:381-382`, list query `:404` `.where("ownerUid", "==", actorUid)` |
| `ownerUid` is always server-derived from `request.auth.uid`, never client input | `:331`, `:504`; `savedDefinitionCallables.ts:57,70,83,92,105,125` |
| A duplicate **reassigns ownership to the duplicator** | `:505-509` |
| Direct client access to the collection is closed entirely | `firestore.rules:1592-1594` — `allow read, write: if false` |
| There is no update/overwrite command; the UI always creates a new definition and says so | `ReportBuilder.jsx:107-120`, `:266` ("Save as new report") |
| The UI states the consequence to the user | `SavedReports.jsx:127` — "Your saved reports are private to you" |

**What this means for a shared or inherited KPI, stated plainly:**

1. **A shared KPI is not merely unimplemented — it is unrepresentable.** There is no field for it, and
   the family is deliberately outside the ownership invariant that would otherwise give it a company
   or a person owner. Adding sharing is therefore a change to the *ownership model*, not a feature
   flag, and it touches the one family the matrix says not to disturb.
2. **A saved KPI definition carries no company scope of its own.** Scope, when it exists at all, comes
   from the runner at run time. So the *same* saved definition, run by two principals, is a *different
   claim* — and nothing on the definition records which. At this baseline the two claims coincide
   because there is no scope at all (§2.3, `:500`); the moment scope lands (branch `92db1d19`) they
   diverge silently.
3. **An inherited KPI has no defined meaning.** Duplication reassigns `ownerUid` (`:505-509`), so the
   inherited copy's provenance is the duplicator, not the author — the definition's history is lost at
   exactly the moment a second person starts relying on the number.
4. **In production the mutations are not activated** (§1.2), so no saved definition can be created
   there at all. Nothing durable can currently record a production KPI's provenance.

This is `OD-R2` from `ENG-IMPL-001` ("is a saved report private user data, or shareable
configuration?") seen from the drill side. **It is not re-decided here**; §7 records what turns on it.

### 2.4 The inventory, summarised

| Tier | Surfaces | Numbers displayed | Drill path exists? | Provenance statable? | Status |
|---|---|---|---|---|---|
| 1 — public monolith `index.html` | 1 page | 4 tiles + 5 report totals | **No** | **No** — fabricated seed constants under a liveness claim | **LIVE AT BASELINE · UNACCOUNTABLE** |
| 2 — React app metric surfaces | 17 `ContextBand` + 4 `CompactMetric` module surfaces | not individually enumerated here; the drill-relevant pairs are settled in §4 | **Mixed** — ~8 pairs share one predicate, ~14 do not (§4) | Partial | **LIVE AT BASELINE** |
| 2a — `AdminRolesPermissions` authority tiles | 1 | 5 | Yes, and identity holds | **Yes, and wrong in production by construction** (§1.5, §2.2.1) | **LIVE AT BASELINE** |
| 3 — reporting engine aggregates | `ReportBuilder` / `SavedReports` | 6 aggregate functions over 4 objects | **No — none, anywhere** | **No** — see §3 | **LIVE AT BASELINE, production-activated** |

**Counts I will stand behind, with method:** 147 catalogue capabilities and 39 `report.*` of which 0
are catalogue-active (static parse of `permissionCatalog.ts`); 25 production-activated ids (static
parse of `config/environments.json` ∩ `PRODUCTION_ACTIVATION_ELIGIBLE_IDS`, and the two sets are
identical); 4 report objects reachable by the engine (`reportCatalog.ts:85-97`, per `ENG-IMPL-001`
§1.1); 17 `ContextBand` module surfaces and 4 `CompactMetric` module surfaces (grep over
`field-ops-app-vite/src/modules/**`); 2 production `roleAssignments` and 1 principal (census
`be1e5579`). **No overall capability ALLOW count is quoted anywhere in this entry**, per the standing
withdrawal of "62 of 147"; where a count was needed it was derived above and its method stated.

### 2.5 What the census also found, and what it costs

| Finding | Evidence | Why it belongs in a drill-through contract |
|---|---|---|
| **One surface already enforces the contract this entry proposes**, and states it in terms | `field-ops-app-vite/src/modules/controlTower/panels/MetricStrip.jsx:3-14` — *"EVERY NUMBER LINKS. The page it replaces had five tiles and not one of them was clickable, so a dispatcher could read '7 awaiting dispatch' and have nowhere to go with it."* … *"the exception links here are in-page anchors to the very sections that hold the rows the count came from, so the number and the evidence can never disagree."* … *"It renders 'unavailable' — never 0. A zero is a finding; an unread number is not."* | §5 is largely the **generalisation of this file**. The contract is not imported from outside EOS; it exists here, on one surface, and is unenforced everywhere else. |
| **My Dashboard: not one KPI tile is clickable** | `MyDashboard.jsx:286` renders `CompactMetric` (`shared/ui/primitives/CompactMetric.jsx`), which emits no link. The only reachable numbers on the page are the two AttentionBand sentences (`:601`, `:611`, hrefs `:591-592`) and bounded "View all" links (`:698`, `:775`, `:799`) | The default dashboard is the surface most people read, and it is entirely un-drillable. |
| **The four highest-value KPI screens gate on the legacy three-role list, not on capability ids** — Service Operations, Operations/Inventory Overview, Dispatcher Board, Technician Dashboard | `field-ops-app-vite/src/domain/constants.js:374-378` (`ROLE_NAV_ACCESS`); contrast the dashboard modules, which do gate on real ids (`domain/dashboardComposition.js:390`, `:405`, `:418`) | Requirement R-K4 cannot be stated per-capability on a surface whose gate is a role string. |
| **Two dashboard modules gate on raw role rather than capability** | `dashboardComposition.js:87` (`isOperationsViewer`, driving the service-attention tiles and the team projections) and `:200` (`ctx.role === "admin"`) | A raw role must never confer a governed capability (the rule `field-ops-app-vite/src/access/reportAccess.js:9-15` states for reporting); these two are the exception. |
| **Three full-collection `fieldops_wos` reads back user-visible numbers** | `field-ops-app-vite/src/analytics/executionAnalyticsService.ts:218` and `:251` (`getDocs` over the whole collection); `field-ops-app-vite/src/services/workOrderService.ts:93` (unbounded `onSnapshot`) | An unbounded read has no truncation signal at all, so R-K5's reconciliation has nothing to reconcile *against* and R-K6's as-of is a stream position, not an instant. |
| **A phantom KPI surface is described in dead metadata** | `field-ops-app-vite/src/modules/registry/moduleRegistry.ts` — zero importers (verified); its own header says *"unused, descriptive-only metadata, still not imported anywhere"* (`:4-5`, `:15-17`); `:59-65` declares `operationsDashboard: { screens: ["KPIs","Reports","Trends"] }` | "KPIs" as a named screen exists **only** here. Anyone reasoning from the registry would inventory a surface that does not exist. Recorded so the next reader does not. |
| **Dead KPI code** | `field-ops-app-vite/src/modules/controlTower/panels/PartsOverviewPanel.jsx` — aggregates planned-part quantities (`:24-43`), renders `×{qtyPlanned}` (`:61`), and is imported by nothing; `ControlTower.jsx:201-234` does not render it | — |
| **The `null` / `0` discipline is real, load-bearing, and inconsistently applied** | Kept: `MetricStrip.jsx:16`, `:22-23`; `hooks/useListViewChrome.js:111` (`total = null` on denial); `shared/ui/FilterBar.jsx:88-91` (distinguishes `undefined` / `null` / `0`); `GoalTile.jsx:19-21` (an unknown actual gets no number slot). Not kept: `reportExecutionService.ts:759-761` (`avg`/`min`/`max` over an empty set return `0`) | This is the seam R-K7 sits on, and it is `ENG-IMPL-003`'s subject. This entry supplies the KPI-specific cases; it does not restate the taxonomy. |
| **Deliberate refusals that any drill-through design must preserve** | No per-bucket counts on Work Orders because the read is bounded (`modules/workOrders/WorkOrdersList.jsx:170-181`) · no money on Purchase Orders (`modules/purchasing/PurchaseOrders.jsx:165-175`) · no on-hand on Parts (ND-25: `modules/inventory/PartsList.jsx:1192`, `PartDetail.jsx:1630`) · no summing across companies or currencies (`MyDashboard.jsx:972-977`, `domain/financialFactsView.js:71`) · 7 goal metrics render a named blocker instead of a number (`domain/dashboardGoalActuals.js:59-79`) · the technician table carries no rank or score (`MyDashboard.jsx:877-881`) | **These are the contract already being honoured by refusal.** A drill-through programme that "fills in the missing numbers" would break seven documented decisions. §5 must be readable as *permission to refuse*, not pressure to display. |

---

## 3. Per-KPI provenance

### 3.1 The provenance fields

> **Correction to the brief.** The brief calls these "the seven provenance fields from #1" but #1
> enumerates five (collection(s)/table(s), filter, time window, company scope, authority). Five fields
> cannot settle accountability, because two numbers with identical sources and filters can still
> disagree if they are computed in different places or if only one can be opened. This entry therefore
> uses **seven**, adding the two the drill question turns on, and says so rather than silently
> renumbering:

| # | Field | The question it answers |
|---|---|---|
| P1 | **Source** | Which collection(s) / callable / constant did the rows come from, with the query site? |
| P2 | **Computation site** | Where is this number actually produced? *(added)* |
| P3 | **Filter / predicate** | Which predicate selects the rows, expressed once? |
| P4 | **Time window / as-of** | Which instant, which window, whose timezone? |
| P5 | **Company scope** | Which operating company, established how? |
| P6 | **Authority** | Which capability id, at which scope, active in which environment? |
| P7 | **Drill path** | Can the rows be reached, and by what? *(added)* |

**A tile for which EOS cannot state P1–P7 is UNACCOUNTABLE, and this entry says so for each.**

### 3.2 The table

`—` means the field does not apply. **UNSTATABLE** means EOS has no answer, not that none was looked
for. All **OBSERVED AT: 64008d5a**.

| KPI | P1 Source | P2 Computation | P3 Filter | P4 Time / as-of | P5 Company scope | P6 Authority | P7 Drill | Verdict |
|---|---|---|---|---|---|---|---|---|
| **Monolith** "Parts in Catalog" / "Total Units on Hand" / "Low Stock Alerts" / "Open Work Orders" (`index.html:1467-1470`) | `db.collection("pcc")` (`:120`) — **every read denied, no `/pcc` rule exists**; values come from `CATALOG_SEED` / `seedInventory()` / `seedWorkOrders()` (`:443-445`) | `:669-680`, `:682-685`, `:686` | `qty < part.reorderThreshold`; `status === "open"` | **none** | **none** | **none** — no Auth loaded | **NO** | **UNACCOUNTABLE.** Fabricated constants displayed under "Live status" (`:1464`); the failure flag is write-only (`:399`, `:440`) |
| **Reporting** `countRows` / `count` / `sum` / `avg` / `min` / `max` (`reportExecutionService.ts:749-764`) | one of `accounts` / `contacts` / `locations` / `equipment` — `db.collection(object.collection).limit(maxScanDocs + 1).get()`, **no `where()`, no `orderBy`** (`:500`) | `:749-764`, per group at `:580` | the definition's filters, applied **in memory** (`:556`) — **minus any the caller may not read** (`:469`) | **UNSTATABLE.** No relative window, no "today", no as-of parameter, no timestamp in `RunReportOutcome` (`:191-211`); date compare is `Date.parse` UTC-instant arithmetic (`:712-722`), so `eq "2026-09-13"` matches only exact UTC midnight. A timezone authority exists in-repo and is not used: `functions/src/reportingPeriod/reportingCalendar.ts:57`, `:70-71` (`reportingTimeZone: "America/Phoenix"`), keyed per operating company at `:77-78` | **UNSTATABLE — none exists.** `operatingCompanyId` appears nowhere in the reporting stack (`ENG-IMPL-001` §1.2); target is hardcoded `{ scope: { type: "global" }, condition: {} }` (`:420`); the request contract is `{ definition, definitionId }` only (`runReportDefinitionCallable.ts:29-35`) | `report.<object>.read` (`reportCatalog.ts:78`, enforced `:424-450`) + `report.<object>.field.<group>.read` (`reportCatalog.ts:116`). **No `report.run` capability exists.** Catalogue-inactive; **25 activated in production** (§1.2) | **NO — none anywhere.** And `rows` is `null` on every aggregate run by construction (`:584`, `:601`) | **UNACCOUNTABLE on P4, P5, P7.** The one tier with production activation is the one that can state the least |
| **Reporting** "Results — N rows" (`ReportBuilder.jsx:508`) | same | **client-side `rows.length`**, not the server's `rowCount` (`:605-607`) | same | same | same | same | the table itself | **PARTIAL.** Two implementations of one count (§4 #18) |
| **`AdminRolesPermissions`** "Can actually do" / "Granted but inert" / "Active because of *{env}*" / "Active in catalog" (`:201-212`) | **a build-time constant**, not Firestore: `PERMISSION_CATALOG` + role definitions + `CAPABILITY_ACTIVATION_OVERRIDE_SET` (`:133`) | `roleAccessModel.js:63` `operableCapabilityIds`, `:181-190` `accessDiagnostics`; called `:148`, `:150` | `permission.active !== false \|\| activationOverrides.has(id)` | — (no time basis) | — (not company-scoped) | administration route, `ROLE_NAV_ACCESS` | **YES**, and identity holds (`:289`, `:318`, `:330`) | **ACCOUNTABLE in shape, WRONG IN PRODUCTION IN FACT.** The override set is empty in a production build (§1.5), so the 25 are counted "inert"; and the tile that would disclose it is hidden because it is zero (`:208-210`) |
| **`AdminDuplicateRules`** Objects / With active rules / Active rules (`:117-119`) | `RULE_OBJECTS` / `SEEDED_RULES` — **client-side constants** (`domain/duplicateRules.js`), no live read | inline | inline | — | — | administration route | **NO** | **UNACCOUNTABLE.** A metric row over seeded constants, presented as configuration state |
| **Service Operations metric strip** Awaiting dispatch / In progress / Technicians on shift / Completed, each with an exception count (`MetricStrip.jsx:25`, `:31`) | `fieldops_wos` **unbounded** `onSnapshot` (`services/workOrderService.ts:93`) + `fieldops_technicians` (`ControlTower.jsx:79-80`) | `domain/serviceOperationsNorthStar.js:176-191` | `byPhase()` `:176`; exceptions `:159-160`, `:188-191` | **UNSTATABLE as an instant** — a live snapshot has no as-of; the exception predicates use `startOfDay(now)` with no timezone authority | **UNSTATABLE** — no company predicate on `fieldops_wos` | **role list only** — `ROLE_NAV_ACCESS` admin+dispatcher (`domain/constants.js:375-376`); **no capability id** | **YES for all seven, and the exception counts anchor to the very sections holding their rows** (`:199`, `:203`, `:210`, `:213`, `:220`, `:223`, `:232`) | **BEST IN ESTATE on P7. UNACCOUNTABLE on P4, P5; weak on P6** |
| **My Dashboard** account totals + per-status counts + unclassified (`MyDashboard.jsx:222`, `:236`, `:243`) | `getAccountPortfolioSummary` callable (`hooks/useAccountPortfolioSummary.js:29`) | **server-side**, passed through `:32` | server-side | server-side | server-side | `customer.record.read` (`domain/dashboardComposition.js:390`) | **NO** | **PARTIAL.** P1/P3/P5 exist but are not *stated to the reader*, and there is no path to the rows |
| **My Dashboard** service-attention tiles Past Due / Ready to Schedule / Scheduling Conflict (`:286`) | `fieldops_wos` unbounded `onSnapshot` (`workOrderService.ts:93`) | `groupWorkOrderAttentionItemsBySection(workOrderAttentionItems(...))` at `:376`; predicates `domain/workOrderAttentionProjection.js` | `:104-109` (`SCHEDULED && scheduledStart < startOfDay(now)`) | **UNSTATABLE** — private `startOfDayMillis` (`workOrderAttentionProjection.js:56`), no timezone authority | **UNSTATABLE** | **raw role** `isOperationsViewer` (`dashboardComposition.js:87`, used `:167`) | **NO on the tile.** The same numbers reappear as two linked sentences (`:601`, `:611`) | **PARTIAL.** Drill identity HOLDS (one projection, `value={g.items.length}`) — the defect is reachability, not identity |
| **My Dashboard** work orders by status (`:827`) | same snapshot | `workOrdersByStatus()` `domain/dashboardTeamProjections.js:34-47` | Map reduce over stored `status` | same | **UNSTATABLE** | `isOperationsViewer` | **NO** | **PARTIAL** |
| **My Dashboard** per-technician "N open · N completed" (`:870`) | same snapshot + `fieldops_technicians` (`:429-430`) | `technicianComparison()` `dashboardTeamProjections.js:79+` | `COMPLETED_STATUSES = {COMPLETED, CLOSED, VERIFIED}` (`:55`), **`else → open`** | same | **UNSTATABLE** | `isOperationsViewer` | **NO — deliberately** (anti-leaderboard, `:877-881`) | **PARTIAL, with a predicate defect** (§4 #8): `CANCELLED` counted as open; `VERIFIED` is not in the lifecycle vocabulary (`domain/workOrderStatus.js:20-31`) so that branch is dead |
| **My Dashboard** Billed / Collected money per company per currency (`:965`) | `listFinancialFacts` callable (`services/financeReadCallableClient.js:40`) | server aggregate; `minor/100` is display only | server-side | **MTD window via `resolveReportingPeriod({ periodType: "MTD", asOfMillis, calendar: TAYLOR_VENTANA_REPORTING_CALENDAR })`** (`MyDashboard.jsx:455-459`) — **the one KPI in the app with a declared period, and the only one that uses the reporting-calendar authority** | **server-side, per company, never summed** (`:972-977`) | `finance.read` **and** one `finance.visibility.*` (`dashboardComposition.js:100-108`, used `:405`, `:418`) | **NO** | **STRONGEST provenance in the app on P3/P4/P5/P6; fails P7 outright** |
| **Financials** lifecycle scorecard, 6 slots (`FinancialsPrimitives.jsx:59`, via `FinancialsOverview.jsx:85-92`) | `listFinancialFacts` (`financeReadCallableClient.js:40`) | `lifecycleScorecard()` `domain/financialFactsView.js:182-217`; `formatByCurrency()` `:71` never sums currencies | server-side | server-supplied | server-side FIN-004 reach; requested company filter only (`FinancialsOverview.jsx:51-53`) | FIN-004 server-side; **the nav item declares no `capabilityAccess`, deliberately** (`navConfig.js:448-452`) | **YES (partial)** — per-slot `Link` (`FinancialsOverview.jsx:94`, map `:43`) | **ACCOUNTABLE, the best money case.** Booked / Billable now / Unbilled are *always absent* and say so (`financialFactsView.js:173`, `:217`) |
| **Financials** A/R aging buckets (`FinancialsAccountsReceivable.jsx:96`) | same | `agingSlots()` `financialFactsView.js:229-244`; unaged note `:258-262` | server-side | server-supplied | server-side FIN-004 | FIN-004 | **YES (rows)** | **ACCOUNTABLE** |
| **Account Health Strip** Open work orders (`AccountHealthStrip.jsx:48-53`) | `getCountFromServer` on `fieldops_wos` `where customerId` + `status in OPEN_WORK_ORDER_STATUSES` (`domain/accountWorkOrders.js:58-59`) | `openWorkOrdersMetric()` `domain/accountHealthStrip.js:43-57` | **8 statuses** (`accountWorkOrders.js:38-47`) | server aggregate instant, not surfaced | **UNSTATABLE** | server-side on the aggregate; no client capability check at render | **YES, and WRONG** — `href: "/service/work-orders"` when `count > 0` (`accountHealthStrip.js:56`), a firm-wide list whose "Open" chip is **3 statuses** | **PARTIAL → DEFECT.** Drill loses the account scope *and* changes the predicate (§4 #1) |
| **Account Health Strip** Outstanding AR / Past due (`:48`) | `listAccountInvoiceAr` callable (`financeReadCallableClient.js:28`) | `arMetrics()` `accountHealthStrip.js:110-127` over `domain/accountArView.js:106`, `:123` | server-side | server-supplied | server-side FIN-004 | server-side; DENIED renders as words (`AccountHealthStrip.jsx:41`) | **YES** — in-page anchor `#account-financials` (`:117`, `:125`) | **ACCOUNTABLE.** Per-currency, never summed |
| **Technician Dashboard** Completed / Parts Used / Avg. Job Duration (`PerformanceSnapshot.jsx:67`, `:71`, `:75`) | `fieldops_wos` `getDocs` `where assignedTechId` **with no limit** (`analytics/executionAnalyticsService.ts:136`) | `getTechnicianExecutionStats()` `:117`, `:135-137` | all-time, all statuses | **"all-time"** — no window, no as-of | **UNSTATABLE** | **role list only** (`domain/constants.js:377`) | **NO** | **UNACCOUNTABLE on P4, P5, P7** |
| **Operations / Inventory Overview** available stock · avg daily usage · days remaining · risk · recommended order qty (`InventoryHealthPanel.jsx:111-121`) | `inventory_transactions` (`Operations.jsx:92`) + a **static catalogue baseline** | `domain/inventoryAnalyticsEngine.ts:109-186`; available at `Operations.jsx:119` | client ledger replay — **no warehouse-eligibility fence, no bin resolution, no serialized assets, no `RETURNED`/`SCRAPPED`, no `null`-UNKNOWN, no floor at 0** | ledger replay to "now"; no as-of | **UNSTATABLE** | **role list only** (`domain/constants.js:375-376`) | **NO** | **UNACCOUNTABLE, and a second implementation of a governed number** (§4 #5) |
| **Dispatcher Board** "N past due" / "fleet booked N%" (`DispatcherBoard.jsx:227`, `:233`) | `fieldops_wos` snapshot + `readTechnicianAvailabilityCallable` | `workOrderPastDueItem` filter `:226`; `fleetBookedPercent()` `domain/dispatchBoardGeometry.js:204-211` | shared past-due predicate (good); capacity `laneCapacity()` `:169` | `startOfDay` with no timezone authority | **UNSTATABLE** | **role list only** | **NO on the number**; lane cells and scores do drill (`DispatchLaneGrid.jsx:277`, `WorkOrderPreview.jsx:111`) | **PARTIAL.** Predicate is shared; the count is firm-wide while the board shows a window, so the rows are not on the page (§4 #15) |
| **List-header count family** — 9+ surfaces via `WorkspaceIdentity.jsx:64-67` and `metadata/ListViewHeader.jsx:107` | per-entity `getCountFromServer` (`hooks/useListViewChrome.js:99-107`) | `:107`; `total = null` on denial (`:111`) | entity-level, unfiltered | server aggregate instant, not surfaced | **UNSTATABLE** | `readVia === "CLIENT_DIRECT"` only (`useListViewChrome.js:87`) | **NO** on the header number; chips do filter | **PARTIAL, and honest about denial** (`:111` — `null`, not 0) |

### 3.3 The pattern the table shows

1. **No KPI in EOS can state P4 (time / as-of) except one** — My Dashboard's money tiles, via
   `domain/reportingPeriod.js` (`MyDashboard.jsx:454-461`). Everything else is "now", from an unbounded
   live snapshot or a ledger replay, with no recorded instant and no timezone authority — while the
   `reportingTimeZone: "America/Phoenix"` authority at
   `functions/src/reportingPeriod/reportingCalendar.ts:70-71` sits unused by every other KPI and by the
   whole reporting engine.
2. **No KPI in EOS can state P5 (company scope) except the finance family.** Everything driven by
   `fieldops_wos` is company-blind, and so is every report (`ENG-IMPL-001` §1.2).
3. **P6 splits the estate in two.** The finance and dashboard-module numbers gate on capability ids; the
   four highest-value KPI screens gate on a three-item role list.
4. **P7 is satisfied on exactly one surface as a rule** (`MetricStrip.jsx:3-14`) and incidentally on the
   finance slots and AR anchors. Everywhere else it is absent — and in one case (`accountHealthStrip.js:56`)
   present but wrong, which is worse.
5. **The strongest provenance and the strongest drill are on different surfaces.** The money tiles can
   state almost everything and cannot be opened; the metric strip can be opened and can state almost
   nothing. **No surface in EOS satisfies both.**

---

## 4. Drill-identity census — every place an aggregate and its detail are computed by separate code

**The defect class:** two implementations of one number. The census below is the measured instance
list. Verdicts: **DUPLICATED** = the predicate is written twice and can diverge. **SHARED** = one
exported predicate produces both. Spot-checks marked ✔ were re-verified line by line for this entry.

### 4.1 The defects

| # | Aggregate | Detail / list | How they diverge | Shared predicate available? | Verdict |
|---|---|---|---|---|---|
| 1 ✔ | `field-ops-app-vite/src/domain/accountHealthStrip.js:43-57` "Open work orders" — count via `getCountFromServer`, `OPEN_WORK_ORDER_STATUSES` = **8** statuses (`domain/accountWorkOrders.js:38-47`), `customerId ==` scoped | drill target `/service/work-orders` (`accountHealthStrip.js:56`) → `modules/workOrders/WorkOrdersList.jsx`, whose "Open" chip is **3** statuses (`domain/workOrderStatusGroups.js:32`: `CREATED, READY_TO_DISPATCH, SCHEDULED`) | **Both axes at once.** Predicate: 8-status non-terminal set vs 3-status pre-dispatch set. Scope: account-scoped tile → firm-wide list. A tile reading "7" lands on a page showing either far more rows (all customers) or far fewer (the Open chip) | **No.** `workOrderStatusGroups.js:5-8` *predicts this exact defect*: *"the moment a second surface wants 'Open work', a copy appears, and the two disagree about whether SCHEDULED counts"* — and the copy exists. `:13-20` records that **five** senses of "active" coexist across screens (ADR-012) | **DUPLICATED — the canonical instance** |
| 2 ✔ | `domain/salesOrderNorthStar.js:180` + `:216` — "`N` of `M` lines allocated"; predicate is **per line**: `orderedQty > 0 && allocatedQty >= orderedQty` | `domain/salesOrderFulfillmentProgress.js:162` — "Inventory allocated" step COMPLETE iff **summed** `qty.allocated >= qty.ordered` (`summarizeQuantities` `:81`). Both render on one page (`modules/sales/SalesOrderDetail.jsx:337` → `SalesOrderFulfillmentSection.jsx:49`) | **Different basis.** 2 lines ordered 5+5, allocated 10+0 ⇒ the step says allocation COMPLETE while the spine says "1 of 2 lines allocated". Null handling also differs: `summarizeQuantities` yields `allocated: null` → UNKNOWN; `summariseLines` coerces missing to 0 → "0 of N" | **No.** `salesOrderNorthStar.js:5-14` names this duplication as the reason the file exists (*"`SalesOrderFulfillmentSection` separately re-derives progress from the same lines"*) — and the re-derivation is still wired up | **DUPLICATED — two contradictory answers on one screen** |
| 3 | `domain/opportunityLifecycle.js:51` `CLOSE_OVERDUE` when `close < nowMillis`; feeds `counts.needsAttention` (`:194`) and the "Needs attention" tab | `domain/opportunityListView.js:91`, `:129` — same row's close cell: `daysToClose = Math.round((close - nowMillis)/DAY)`, `overdue: daysToClose < 0` | **Different granularity on the same clock.** A close 8 h in the past: the tab counts it overdue; the column renders `0d`, which reads "due today". Divergence window ±12 h on every row | Partially — both receive one shared `nowMillis` (`modules/sales/OpportunityList.jsx:145`), but the comparison is written twice. No exported `isCloseOverdue` | **DUPLICATED** |
| 4 | `modules/service/CoordinatedVisitsWorkspace.jsx:175` "Needs attention N" (+ banner `:183`): `readiness === "ATTENTION"`, i.e. `blocked > 0` (`domain/coordinatedVisit.js:59`) | `domain/obligationAttention.js:66` — the detail pane's `needsIntervention` = `BLOCKED \|\| WAITING_ON_MATERIAL`, and `WAITING_ON_MATERIAL` can fire with `blocked === 0` (`:27`, `:57-60`) | A visit with parts-short units but no blocked work order is **excluded from the header count while its own detail says intervention may be required** | **Yes, and unused:** `summarizeObligationAttention` (`domain/obligationAttention.js:96-104`) | **DUPLICATED** |
| 5 | `functions/src/inventoryAnalyticsCallables.ts:196-217` — governed `getInventoryAnalytics`: ACTIVE-warehouse-fenced on-hand + bin parentage + serialized assets − net reserved | `field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts:273-296` (+ `hooks/useInventoryLedger.js:29-34`) — client replay from a static catalogue baseline. Feeds every visible health figure: `WarehouseManagerHome.jsx:240-242`, `modules/operations/Operations.jsx:119-126`, `PartsList.jsx:384`, `PartDetail.jsx:1334` | The **same four functions exist twice** (`inventoryAnalyticsEngine.ts:109/153/162/226` vs `functions/src/inventoryAnalyticsService.ts:132/197/206/246`) but the **input number differs**: client has no warehouse-eligibility fence, no bin resolution, no serialized assets, no `RETURNED`/`SCRAPPED`, no `null`-UNKNOWN, no floor at 0. Also diverges from the commitment authority `functions/src/inventoryService.ts:112-123` (`getAvailableQuantity`, `null` for "no evidence", floors at 0) | **The server authority exists and NO client surface calls it** (catalogued at `field-ops-app-vite/src/access/permissionCatalog.ts:547-567`) | **DUPLICATED — the highest-stakes instance: a governed number recomputed ungoverned** |
| 6 | `domain/workOrderAttentionProjection.js:104-109` — `workOrderPastDueItem` (`SCHEDULED && scheduledStart < startOfDay(now)`), with its own private `startOfDayMillis` (`:56`) | `domain/schedulingWorkspace.js:234` — inline `PAST_DUE` (`job.startMillis < todayStart && status === "SCHEDULED"`), with its own `startOfDayMillis` (`:104`), reached via `toScheduledJob` (`:155`) | Header comment at `workOrderAttentionProjection.js:98` admits it *"mirrors … EXACTLY"*. Current behavioural gaps: the projection additionally requires a non-empty `wo.id`; `toScheduledJob` drops `CANCELLED` first; **three copies of `startOfDayMillis`** exist | The projection *does* import `SCHEDULABLE_STATUS` / `toMillis` / `detectDayOverlaps` from `schedulingWorkspace.js` (`:36`) — but not a past-due predicate, because none is exported | **DUPLICATED (currently agreeing)** |
| 7 | `modules/technicianDashboard/TechnicianDashboard.jsx:93`, `:159` — "My Active Work Orders" from a **local** `ACTIVE_STATUSES` (`:43`) | the same screen's three bucket lists from local `READY_TO_START_STATUSES` / `WAITING_STATUSES` / `IN_PROGRESS_STATUSES` (`:40-42`), each with its own `({workOrders.length})` heading (`:53`) | A 4th derivation of the same five statuses the three lists partition. Add a status to one set and not the other and header ≠ sum of sections | **Yes, unused:** `domain/fieldWorkOrder.js:39-52` exports `FIELD_ACTIVE_STATUSES` and `isActiveFieldWorkOrder` — the identical set | **DUPLICATED** |
| 8 | `domain/dashboardTeamProjections.js:88-90` — per-technician `completed`/`open`, `COMPLETED_STATUSES = {COMPLETED, CLOSED, VERIFIED}` (`:55`), **`else → open`** | any list a reader reaches for "that technician's open work": `OPEN_WORK_ORDER_STATUSES` (`accountWorkOrders.js:38`, excludes `CANCELLED`) or `workOrderStatusGroups.js:32` | `else row.open += 1` puts **`CANCELLED` work in the Open column** — every other definition of "open" excludes it. `VERIFIED` is not in the lifecycle vocabulary at all (`domain/workOrderStatus.js:20-31`), so that branch is dead and hides the intent | No shared completed/open predicate is imported; **three definitions coexist** | **DUPLICATED — a wrong number, not merely a divergent one** |
| 9 | `modules/inventory/TruckInventory.jsx:211` — "With discrepancies N" (`metrics.discrepancies > 0`) | same file `:205-206` — filter chips: `yes` excludes `!(discrepancies > 0)`; `no` excludes `discrepancies !== 0` | **Null handling.** `metrics.discrepancies` is legitimately `null` (`domain/truckRegistry.js:178`, `domain/truckInventoryView.js:85`). Those trucks are absent from the count, absent from "yes", **and** absent from "no" — so `yes + no < Trucks` and **no chip can reach them** | No shared `hasDiscrepancy(truck)` | **DUPLICATED (null-scope) — rows unreachable from any affordance** |
| 10 | `domain/partsNorthStar.js:375-388` — chip counts (`status === "ACTIVE"`, `attention.has(sku)`, `controlType === "SERIALIZED"`) | `domain/partsNorthStar.js:393-398` — `applyPartsCollectionView` rewrites the same three predicates inline | Same file, same input ⇒ identical today; an edit to one drifts the count from the rows it opens | Not factored: no predicate map both read | **DUPLICATED (low severity, currently agreeing)** |
| 11 | `modules/inventory/PartsList.jsx:669` — category chip counts over **`catalogRows`** (the whole catalogue) | `PartsList.jsx:636-648` — the list is `applyPartsCollectionView(view)` → category → text search → sort | **Scope.** The chip says "Pumps 40" while the rows shown are the intersection with the active view *and* the search box, so a chip promising 40 can yield 3. "All Categories" is `catalogRows.length`, never the view-filtered length | The view half has a shared filter (`applyPartsCollectionView`); the chip count deliberately ignores it | **DUPLICATED (scope)** |
| 12 | `modules/inventoryRole/WarehouseManagerHome.jsx:261` — `catalogRows.filter(part => part.category === cat).length` | `WarehouseManagerHome.jsx:244` → `domain/warehouseManagerCatalogView.js:50` — `list.filter(r => r && r.category === category)` | Same concept, two expressions; the helper null-guards the row, the count does not (`part.category` on a null row throws rather than excluding) | **Yes — `filterCatalogRowsByCategory` is imported in this very file** and used for the list but not for the count | **DUPLICATED (low severity)** |
| 13 | `functions/src/finance/financeReadProjection.ts:46-52` — governed `deriveArPosition` (`SETTLED` when outstanding ≤ 0, `null` `daysOverdue` when not overdue); drives `overdueCount` (`:273-275`) and every AR row | `field-ops-app-vite/src/domain/commercialFinance.js:36-46` — a **second function of the same name**, different vocabulary (`PAID` from `state === "PAID"`, `daysOverdue: 0` for CURRENT) | A fully-paid invoice whose `state` was never advanced is `SETTLED` server-side and `UNKNOWN`/`OVERDUE` client-side. Same duplication for `arPositionTone` (`commercialFinance.js:91` vs `domain/accountArView.js:42`) | Server copy is the authority; the client copy is an unreferenced parallel definition (only `INVOICE_STATES` is imported, `metadata/definitions/invoice.js:2`) | **DUPLICATED (latent)** — the exact fork the AR strip relies on not existing |
| 14 | `functions/src/account/accountPortfolioSummary` via `hooks/useAccountPortfolioSummary.js:29` — server status counts | `domain/accountPortfolio.js:13-24` — `summarizeAccounts` counts the same five buckets client-side | A second implementation of the portfolio card numbers, differing in the unclassified rule (server subtracts; client counts `total` only) | Server is the authority; no importer exists for the client copy | **DUPLICATED (dead code)** |
| 15 | `modules/dispatcherBoard/DispatcherBoard.jsx:226-227` — "N past due" over **all** work orders | the board draws day / week / fortnight lanes (`:165-176`, `availabilityWindow` `:118-127`) and a `READY_TO_DISPATCH`-only queue (`:156-162`) | **Correct predicate, mismatched scope.** The count is deliberately firm-wide (`workOrderAttentionProjection.js:100-103`), so a dispatcher reads "4 past due" with no four rows anywhere on the board | **Yes — it uses the shared `workOrderPastDueItem`.** Only reachability is wrong | **SHARED predicate, scope mismatch** — an R-K3 failure, not an R-K2 one |
| 16 | `domain/cycleCountNorthStar.js:197-205` — `deriveSheetProgress` / `sheetProgressText` ("N of M lines counted", `status !== "OPEN"`) | `modules/scan/CycleCountScan.jsx:299-300` — `submittedCount` / `varianceCount` from session states `SUBMITTED \| DECIDED`; recap `:313` | Two derivations of "how many lines are counted" over two shapes (server `status` vs session `state`). `deriveSheetProgress` has **no caller outside tests** | The shared helper exists and is bypassed | **CANNOT DETERMINE** — an unused shared definition, no live pairing |
| 17 | `modules/accounts/ServiceActivitySection.jsx:132-133`, `:148-149` — "Open work orders" / "Completed" server counts in the section head | `:163-174` — the timeline below is `customerId`-ordered-by-`createdAt`, **all statuses**, page-limited (`domain/accountWorkOrders.js:86-90`) | Intentionally different populations (documented at `accountWorkOrders.js:20-26`) — but they sit in one header/body pair, so "Open 7" over a list containing cancelled and closed rows invites a reconciliation that cannot succeed | Not a duplicated predicate — a labelling / pairing hazard | **SHARED predicates, presentation defect** |
| 18 ✔ | `functions/src/reporting/reportExecutionService.ts:605-607` — server `rowCount`, also written to the audit event (`:620`) | `field-ops-app-vite/src/modules/reporting/ReportBuilder.jsx:508` renders the caption from **`rows.length`**, never `outcome.rowCount`; `domain/reporting/reportRunOutcome.js:49` falls back to `rows.length` when `rowCount` is not finite | On an **aggregate** run the server's `rowCount` counts **groups**, not documents (`:605-607`) — so the audit trail and the user's "Summary — N rows" both mean "groups", while "row count" reads as documents | No | **DUPLICATED** |
| 19 | `reportExecutionService.ts:750` — `countRows` aggregate = `rows.length` of the underlying group | `reportExecutionService.ts:605-607` — `rowCount` = number of returned aggregate/group rows | **Two unrelated counts, both labelled "rows", side by side** on one screen: `aggregateColumnLabel` → "Row count" (`domain/reporting/reportResultTable.js:27-28`) beside the caption "Summary — N rows" (`ReportBuilder.jsx:508`) | No | **DUPLICATED (naming collision)** |
| 20 | `reportExecutionService.ts:641` — `rowCap` (always `MAX_RESULT_ROWS` = 10 000) | `domain/reporting/reportResultState.js:57-60`, `:73-76` — narrates it as "Showing the first 10,000 rows" even when the actual bound was `MAX_GROUP_CARDINALITY` = 1 000 (`:571-572`) | **The clearest instance of one fact computed twice and disagreeing.** There is no `groupCap` field in `RunReportOutcome` (`:191-211`) for the client to read instead | No | **DUPLICATED** |
| 21 | `functions/src/reporting/reportCatalog.ts`, `reportQueryValidation.ts`, `reportQueryModel.ts` | `field-ops-app-vite/src/domain/reporting/reportCatalog.js`, `reportQueryValidation.js`, `reportQueryModel.js` | Not a number computed twice, but **the authority that decides which rows an aggregate covers**, duplicated. Held together only by `functions/test/reportCatalogParity.test.mjs` (declared `reportCatalog.ts:9-15`) | Parity test only | **DUPLICATED (by convention), gated** |
| 22 | `field-ops-app-vite/src/modules/dashboard/MyDashboard.jsx:286`, `:563`, `:601`, `:611` — dashboard counts over rows read directly from Firestore | the reporting engine's aggregates over the same business questions | **A fully independent second engine.** The dashboard path is assignment-scoped by its own domain reads; the report path is company-blind (§2.3). The file is candid about the risk (`:14-20`, `:287-292`) | No — and building one is the R-K2 question | **DUPLICATED, by architecture** |
| 23 | — | — | Client/server twins that are number-adjacent but not aggregate-vs-list pairs, recorded for a follow-up pass: `buildCoordinatedVisits` (`domain/coordinatedVisit.js:78` vs `functions/src/fulfillment/coordinatedVisit.ts:100`) · `computeInventoryControl` (`domain/inventoryControlLifecycle.js:75` vs `functions/src/fulfillment/inventoryControlLifecycle.ts:50`) · `generateProcurementDrafts` (`domain/procurementDraftEngine.ts:32` vs `functions/src/procurementBridge.ts:28`) · `deriveOutstandingMinor` twice inside `functions/` (`finance/paymentCommands.ts:77` vs `finance/financeReadProjection.ts:37`) | — | — |

**Count: 22 located instances. 18 DUPLICATED (2 dead/latent, 3 currently agreeing), 2 SHARED-with-a-different-defect, 1 CANNOT DETERMINE, 1 authority-duplication gated by a parity test.**

### 4.2 The good examples — the pattern R-K2 requires

These are load-bearing: the contract is not aspirational, it is **already met in eight places**.

| Number | Its rows | Why it is safe |
|---|---|---|
| `domain/dashboardGoalActuals.js:104-118` — the three FIRM service goal actuals | `MyDashboard.jsx:283-292` tiles + sections | Both read `groupWorkOrderAttentionItemsBySection(...)` `items.length` from **one** projection computed once and passed in. The invariant is stated at `dashboardGoalActuals.js:8-16`: *"If this file ever grows a query, a filter, a sum over rows, or a date comparison, the invariant has been broken."* |
| `domain/serviceOperationsNorthStar.js:159-160` `readyToScheduleCount` | the "Ready to Schedule" attention section on the same page | Reads the section's own `items.length` off the rendered projection — `:156-158` states exactly the rule this census is looking for |
| `domain/accountHealthStrip.js:97`, `:120-127` "Past due" · `modules/accounts/AccountArSection.jsx:125` "N open, N overdue" · `domain/accountAttentionProjection.js:98-100` AR attention rows | `domain/accountArView.js:121-153` rows | All three consume **one** server read: `overdueCount` and every row's `arPosition` are produced in one pass over one row set (`functions/src/finance/financeReadProjection.ts:253-282`), and the read **fails closed rather than truncating** (`functions/src/finance/financeReadCallables.ts:192-196`) |
| `domain/opportunityListView.js:21-46` `opportunityListCounts` | `domain/opportunityLifecycle.js:257-292` `selectOpportunityView` rows | Both derive from one `buildOpportunityPipeline` result computed once with one `nowMillis` (`OpportunityList.jsx:139-151`) — though the attention predicates are still typed twice (§4 #3) |
| `modules/accounts/AccountsList.jsx:157-158` portfolio cards | the bounded, cursor-paged row list | Cards come only from `getAccountPortfolioSummary`, and `:324-340` **explicitly reconciles `rows.length` against `summary.total`** rather than implying the page is the book. **This is requirement R-K5, already implemented.** |
| `modules/workOrders/WorkOrdersList.jsx:170-181` | the paged list | **The correct refusal.** Per-bucket counts are omitted *because the read is bounded*, rather than computed from the page |
| `domain/purchaseOrdersView.js:155-163` `summarize` + `modules/purchasing/PurchaseOrders.jsx:139-149` chips | the same rows | Both key off one derived `viewStatus` field, and the whole read resolves before READY (`:118-135`), so a count over rows *is* the set |
| `domain/commercialCoverage.js:126-141` `summarizeCoverage` | the `resolveCommercialCoverage` output it is handed | A projection over exactly the resolved list, not a second resolution |
| `field-ops-app-vite/src/modules/controlTower/panels/MetricStrip.jsx:3-14` + `domain/serviceOperationsNorthStar.js:199-232` | the in-page sections the exception anchors point at | *"the exception links here are in-page anchors to the very sections that hold the rows the count came from, **so the number and the evidence can never disagree**"* |

**Verified clean:** `domain/goalProgress.js`, `domain/financialSummaryView.js`, `domain/financialFactsView.js`
(`agingSlots` `:229-252`) and `modules/financials/FinancialsOverview.jsx:164-172` take server-supplied
figures only — no second derivation. (`FinancialsOverview.jsx:165` labels a *money* bucket "Invoices
61+ days overdue", a wording problem rather than a duplicated predicate.)

---

## 5. The contract

Seven requirements. Each is stated as **required behaviour** and **required distinctions** — never as a
screen, a component, or a schema. `R-K*` ids are for citation. Requirements are testable; §6 names the
test for each. Genuine product judgements are marked **OWNER DESIGN DECISION** and left open.

**One scoping rule for the whole contract, stated first because it changes how the rest reads:**

> **R-K0 — The contract binds a number that is DISPLAYED AS A CLAIM, and permission to refuse is part
> of it.** A count rendered beside the very rows it counted (a chip over a filtered list, a
> `({items.length})` heading) already satisfies the contract by construction and requires nothing
> further. And EOS's seven documented refusals (§2.5) are **compliant behaviour, not gaps**. A
> programme that reads §5 as pressure to display more numbers has misread it: the contract's purpose
> is to make displayed numbers accountable, and the cheapest way to be accountable is not to claim.

### R-K1 — PROVENANCE: every displayed number must be able to state P1–P7, or be marked unaccountable

**Required behaviour.** For each KPI, EOS must be able to produce — mechanically, not by a person
reading source — the seven fields of §3.1. A number whose provenance cannot be produced must be
**labelled unaccountable at the point of display**, not silently shown.

**Why this is not bureaucratic.** §3.2 shows that the most trustworthy number in EOS (money per
company per currency, `MyDashboard.jsx:965`) and the least (`index.html:1467`) are **visually
indistinguishable**: both are a large numeral above a label. The reader has no way to tell them apart,
and nothing in the estate tells them.

**Required distinctions.**

| Must be distinguishable | Must never be collapsed into |
|---|---|
| "the rows exist and this is their count" | "a constant is displayed here" (`index.html:1467-1470`, `AdminDuplicateRules.jsx:117-119`) |
| "this figure was read from a governed server projection" | "this figure was recomputed on the client from a different input" (§4 #5) |
| "this is a total over a proven-complete population" | "this is a total over a bounded page" (§2.3.1) |
| "this describes you / your scope" | "this describes a selected role or the whole firm" (`AdminRolesPermissions.jsx:133`; §4 #1, #15) |

**Required of the provenance record itself:**

1. It must be **derived from the same definition that produced the number** (R-K2), never authored
   alongside it. A hand-written provenance note is a second implementation of the number's meaning.
2. It must be **audit-bearing where an audit event already exists** and must not carry row data. The
   reporting engine's existing discipline is the model: exactly one audit event per run, never row data
   (`reportExecutionService.ts:29-35`, write at `:610-624`).
3. It must **never name a field the reader may not know exists.** Dropped *columns* may be named back;
   dropped *predicates* are a count only (`reportResultState.js:34-44`). So "N scope predicates were
   applied" is safe to display where the company *value* is not — a rule `ENG-IMPL-001` §6.3 already
   establishes and this entry inherits rather than restates.
4. It must **never emit a raw code, path, document id or collection name** into rendered copy
   (`reportResultState.js:1-8`, `:101-106`).

**OWNER DESIGN DECISION (`OD-K1`).** Whether provenance is *always visible*, *disclosed on demand*, or
*visible only for numbers that fail one of P1–P7. Engineering consequence: always-visible costs layout
on every tile and forces the honest answer into the reader's path; on-demand risks nobody asking;
failure-only requires the failure test to run at render time and be trustworthy — and makes the absence
of a badge a positive claim of accountability, which is the strongest version and the easiest to get
wrong.

### R-K2 — DRILL IDENTITY: the drill query must be derived from the aggregate's definition, not re-implemented

**Required behaviour.** There must be **one definition** of a KPI, and both the aggregate and the drill
must be **derived from it**. Two code paths that *happen to agree* do not satisfy this; agreement must
be structural.

**Why.** §4 locates **22** instances and **18** are duplications. Three of them are in files whose own
headers were written to prevent exactly this (`workOrderStatusGroups.js:5-8`,
`salesOrderNorthStar.js:5-14`, `workOrderAttentionProjection.js:98`). The pattern has already produced
at least two live wrong numbers: `CANCELLED` counted as open work (§4 #8) and a truck set reachable
from no filter chip (§4 #9).

**Required distinctions.**

| Must be distinguishable | Must never be collapsed into |
|---|---|
| one definition, two derivations | two definitions that currently agree |
| a count over the rows shown | a count over a different population than the rows shown (§4 #11) |
| a shared predicate with a *scope* mismatch (§4 #15) | a duplicated *predicate* (§4 #1) — the fixes are different |

**Required, concretely:**

1. **A predicate that names a business concept must be exported once and imported, never retyped.**
   Where a shared predicate already exists and is bypassed — §4 #4, #7, #12, #16 — that is a defect with
   a known fix.
2. **A number and its drill must be traceable to one source expression.** The mechanical form of this
   requirement is: *given a KPI identifier, a test can obtain both the aggregate expression and the
   drill expression and assert they are the same object.* If they cannot both be obtained, the KPI is
   not drill-identical, whatever the code looks like.
3. **For the reporting engine specifically, this is currently impossible and must become possible.** An
   aggregate run returns `rows: null` by construction (`reportExecutionService.ts:584`, `:601`,
   `:639-640`). Until an aggregate and its rows can travel together — or a drill can be *derived* from
   the aggregate's definition and re-executed under the same authority — there is no drill to be
   identical to. **This is the single largest engineering implication in this entry.**
4. **A client must not recompute a number a governed server authority already computes.** §4 #5 is the
   live instance: `getInventoryAnalytics` exists, is capability-catalogued, and **no client surface
   calls it**, while a client engine computes a materially different "available stock" for four
   surfaces.

**Not decided here:** whether the drill re-executes the definition or reads a retained row set. Both
satisfy R-K2; they differ under R-K6 (see `OD-K4`).

### R-K3 — SCOPE CONSISTENCY: the drill uses the aggregate's company scope, and scope FAILS CLOSED

**Required behaviour.** The drill must resolve company scope **the same way, from the same authority,
as the aggregate**. Scope must never be taken from user input. A scope that cannot be established is
**`scope unresolved`** — a refusal — and must never be rendered as "no rows for that company".

**Why, and what EOS already gets right.** The fail-closed discipline exists and is well built in the
finance / reorder / ownership families:

| Behaviour | Evidence |
|---|---|
| A principal with no reach gets a refusal, not a ready-empty page: *"'ready, nothing outstanding' and 'you cannot see this' are different facts"* | `functions/src/finance/financialReportingRead.ts:256-259`; callable refusal `:438-440` |
| Authorization runs **before** the caller's narrowing | `financialReportingRead.ts:272-276` |
| Malformed access data is a denial, never a default | `functions/src/finance/financeReadCallables.ts:73-75`, `:106-109` |
| A held capability that bound to **no** governed value confers no reach — *"a valueless grant confers no reach"* | `financeReadCallables.ts:131-136`; `financialVisibility.ts:137-141` throws `SCOPE_VALUE_REQUIRED` |
| Nothing attributable ⇒ fail closed | `financialVisibility.ts:173-174` |
| An unknown scope type denies | `functions/src/access/resolveEffectivePermission.ts:180-181` |
| "Unresolved" is a named state, kept apart from "empty" | `functions/src/reorderRequest/reorderWarehouseAuthority.ts:76-83` — `GOVERNED_ASSIGNMENT` / `NO_GOVERNED_WAREHOUSE_AUTHORITY` / `AUTHORITY_UNRESOLVED`, with *"A read failed. Fail-closed, and distinguishable from a genuine empty scope."* |
| `UNKNOWN` is deliberately not collapsed into `INVALID` | `functions/src/ownership/operatingCompanyAuthority.ts:54`, `:73-80` |
| "No governed company" has its own key, so per-company figures and it reconcile to the consolidated total | `field-ops-app-vite/src/domain/companyAttribution.js:35-42` (`UNATTRIBUTED_COMPANY`), plus `supplied: false` at `:80-91` for "the server gave no breakdown at all" — a third state |
| A company chip is a *requested filter*, enforced server-side: *"selecting a company you cannot see returns nothing rather than someone else's numbers"* | `modules/financials/FinancialsPrimitives.jsx:79-82`; `FinancialsOverview.jsx:51-53` |
| A user-typed warehouse id is tested against the same scope that built the picker | `functions/src/reorderRequest/reorderCallables.ts:164-167` |

**So R-K3 is mostly a requirement to extend an existing, well-stated discipline — with two exceptions
that are live defects.**

**Two live scope defects found, both recorded not fixed:**

| Defect | Evidence | Why it is a KPI-drill problem |
|---|---|---|
| **`coverage.read` takes the company id from the payload and uses it as the query scope with no membership check.** `requireCoverageRead(request.auth.uid)` is a **global-target** capability check only; `data.companyId` is validated for *presence*, never for entitlement, and never against `resolveOperatingCompany`; territories are read **unscoped entirely** | `functions/src/coverage/coverageReadCallables.ts:48`, `:50-51`, `:59-60` | This is exactly the "arbitrary user-entered company override" R-K3 forbids. **Latent, not currently exploitable**: `coverage.read` is catalogue-`active: false` and is *not* in the production activation set (§1.2), so it resolves `inactivePermission` DENY. It becomes live the moment coverage is activated. |
| **…and that same callable collapses every thrown error into `status: "unavailable"` with an empty array**, and its only states are `ready \| unavailable` | `coverageReadCallables.ts:65`, `:71`, `:72-74` | Combined with the above, a caller-supplied unreachable company yields `status: "ready"` with zero rows — **which reads as "this company has no coverage"**. That is precisely the failure R-K3 exists to forbid, already implemented. |
| **`createOpportunity` spreads attacker-controlled `request.data` wholesale**, so `operatingCompanyId` flows through and is validated only as a *governed id*, never against the caller's membership | `functions/src/opportunity/opportunityCallables.ts:198-201`, `:228`; `functions/src/opportunity/opportunityCommands.ts:175` | The value is then copied downstream to Sales Agreement → Sales Order → Invoice (`salesAgreementCommands.ts:304`, `salesOrderCommands.ts:274`, `closeOpportunityAsWon.ts:293`) where it becomes the **authorization key** for company-scoped finance reads (`financialVisibility.ts:170`). A mis-set company at creation silently relocates a record — **and therefore a KPI's rows** — between two visibility domains. Contrast the same pattern done right 180 lines away: `opportunityCallables.ts:378` (*"FIELDS ARE COPIED INDIVIDUALLY, NEVER SPREAD. `request.data` is attacker-controlled"*). |

**Required distinctions.**

| Must be distinguishable | Must never be collapsed into |
|---|---|
| `scope unresolved` | `zero rows in this scope` |
| `scope refused` (a scope was requested and cannot be honoured completely) | `partial result` |
| `company-neutral by nature` | `company-scoped and empty` |
| `no governed company` (`UNATTRIBUTED`) | `company unknown` or omission |
| `the server supplied no company breakdown` (`supplied: false`) | `every company is zero` |

**Inherited, not restated:** `ENG-IMPL-001` §6.1 defines the four scope classes (`COMPANY_SCOPED`,
`COMPANY_DERIVED`, `COMPANY_NEUTRAL`, `SCOPE_REFUSED`) and §6.2 the per-row facts. **A drill must carry
the same scope class as its aggregate, and a drill that would change the class must refuse rather than
present a differently-scoped population under the same number.** That sentence is this entry's only
addition to 001 on scope.

**A finding this entry adds to 001's scope work:** a **saved KPI definition carries no company scope of
its own** (§2.3.3). So the same saved definition run by two principals is two different claims, with
nothing on the definition recording which. At this baseline they coincide because there is no scope at
all; when scope lands they diverge silently. **R-K3 therefore requires that a drill's scope be recorded
on the result, never inferred from the definition.**

### R-K4 — AUTHORITY CONSISTENCY: "may see the aggregate, may not see the rows" is a real state

**Required behaviour.** The case where a caller may see a number but not its rows is a **real product
state** and must be expressed as one. It must never render as **zero**, and must never crash.

**Why this is the normal case, not an edge case.** Production role occupancy is one `admin@global`
(§1.4). Every non-admin authority path in reporting is unexercised. And the engine *already* produces
this state constantly, in the strongest possible form:

> **`countRows` is returned unconditionally to a caller holding zero field capabilities.**
> `reportExecutionService.ts:486` admits a fieldless aggregate with no authorization test at all;
> `:750` returns `rows.length`. So a principal holding only `report.customer.read` receives an **exact
> population count with every column dropped**. The aggregate is visible and the rows are not — by
> design, today, in production, for the one principal who exists.

And it is worse than a visibility asymmetry, because the population itself can differ from the one the
author asked for: a **dropped predicate** (`:469`) widens `filtered`, which is exactly the set
`computeAggregate` runs over (`:570`). The number is a true total **of a population the reader did not
request**, disclosed only as "N filters were not applied" (`reportResultState.js:41-44`).

**The seven authority failure modes are enumerated at §1.4 (A1–A7). Each requires a different
behaviour, and collapsing them is the defect.** In particular:

- **A2 (granted but inactive)** must not render like **A3 (active but ungranted)**. The first is "this
  environment does not have this"; the second is "you do not have this". `resolveEffectivePermission`
  already distinguishes them by reason (`inactivePermission` vs `noQualifyingGrant`, `:265`, `:298`) —
  **the distinction exists in the resolver and is discarded before display.**
- **A7 (client/server activation skew)** must be impossible, not merely unlikely. §1.5 is the live
  instance and §2.2.1 is a shipped tile it makes wrong.

**OWNER DESIGN DECISION (`OD-K2`) — the required behaviour when the aggregate is visible and the rows are
not.** Three candidates, with the engineering consequence of each:

| Option | Engineering consequence | Assessment against the baseline |
|---|---|---|
| **(a) Do not show the tile** | Requires the row-level authority answer **before** render, i.e. a pre-flight authorization the engine does not currently expose — authorization happens *inside* the run (`reportExecutionService.ts:424-450`). It also makes a tile's *absence* carry meaning, which `MetricStrip.jsx:12-14` already warns against for zeros (*"a permanent 0 teaches a reader to stop seeing the row"*) and which is worse for absence, since the reader cannot distinguish "not authorized" from "not built". | **Costly, and creates a new honest-absence problem to solve `ENG-IMPL-003`'s.** |
| **(b) Show the tile and refuse the drill honestly** | Cheapest against the baseline: the number is already computable and returned (`countRows`), the refusal vocabulary already exists (`permission-denied`, `reportResultState.js:30-33`), and no pre-flight is needed. **But it confirms a population size to a caller who may read none of it** — and §2.3.1 shows the population may be *wider* than the caller's own definition, so the disclosed cardinality is not even the cardinality of what they asked for. | **Already the de facto behaviour** (`:486`), reached without a decision being taken. If (b) is chosen it should be chosen, not inherited. |
| **(c) Show a scoped-down number** | Requires computing the aggregate over **only the rows the caller may read** — which for field-level denial is the whole population anyway (row visibility is per-object, not per-row, at this baseline), so (c) collapses into (b) for the reporting engine. Where it *does* differ is row-level scope (company), and there `ENG-IMPL-001` `OD-R8` already asks whether an aggregate over a derived population may be shown at all. **(c) cannot be decided independently of `OD-R8`.** | **Not independently decidable at this baseline.** |

**What engineering can state without the Owner:** whichever is chosen, the state must be **one named
state that travels on the result**, not an inference from a zero; and the choice must be **uniform
across the estate**, because a reader who learns tile-absence means "not authorized" on one screen and
"not built" on another has learned nothing.

**One requirement that is NOT an Owner decision:** *the number and the refusal must be produced by the
same authorization pass.* Authorizing the aggregate at one instant and the drill at another, through a
different target, is how (b) silently becomes a leak. Today they are: the aggregate authorizes at
`reportExecutionService.ts:420` against a hardcoded global target, and there is no drill to authorize.

### R-K5 — RECONCILIATION: the drill's row count reconciles with the aggregate, or the discrepancy is displayed

**Required behaviour.** After a drill, the number of rows reached must reconcile with the aggregate. Any
discrepancy must be **displayed**, never silent.

**The tolerance rule.**

| Quantity kind | Tolerance | Rationale, and the evidence it rests on |
|---|---|---|
| **Counts** | **Exact. Zero tolerance.** | A count is a claim about cardinality. A count that does not equal the number of rows reached is simply wrong. `AccountsList.jsx:324-340` already implements the honest form: it reconciles `rows.length` against `summary.total` and *states the difference* rather than implying the page is the book. |
| **Money** | **Exact in minor units.** No float tolerance, no epsilon. | EOS already carries money in minor units and divides only at render (`MyDashboard.jsx:965`). `financialFactsView.js:71` `formatByCurrency` **never sums across currencies**, and `MyDashboard.jsx:972-977` records the refusal. So the rule is: **reconcile per currency, per company, in minor units, and refuse to reconcile across either.** A cross-currency "total" has no reconcilable value and must not be displayed as one. |
| **Rounding** | **The displayed figure must be derived from the exact figure at render time only, and reconciliation must use the exact figure.** Never reconcile rounded against rounded. | `MyDashboard.jsx:926` (`Math.round(minutes/60)`), `InventoryHealthPanel.jsx:112` (`.toFixed(2)`), `:113` (1 dp), `:121` (`Math.ceil`) all round at the render site. That is the correct place; the requirement is that the reconciliation not see the rounded value. **Where rounding is applied before aggregation the figure is not reconcilable and must say so.** |
| **Percentages and ratios** | **Not reconcilable as a count.** A percentage must carry its numerator and denominator, or refuse. | `dispatchBoardGeometry.js:204-211` computes `Math.round(booked/available*100)` and displays only the quotient (`DispatcherBoard.jsx:233`). There is no way to reach "the rows behind 73%" because the denominator is not displayed. `GoalTile.jsx:104` does better — attainment percent sits beside actual and target. |
| **In-flight rows** | **The aggregate and the drill must declare a common as-of (R-K6). A row that changed between them must be reported as a named difference, never absorbed.** | This is the requirement the baseline cannot currently meet at all, because no KPI records an instant (§3.3). |
| **Bounded / truncated populations** | **Refuse, do not understate** — and say which bound bit. | **EOS already has the right precedent and this entry adopts it rather than inventing one:** `judgeScanCompleteness()` (`reportExecutionService.ts:124-129`) refuses an aggregate over a truncated scan (`:507-526`, `IncompleteAggregateScanError`, audited `outcome: "denied"`), on the stated ground that an incomplete total is worse than no total. `financeReadCallables.ts:192-196` fails closed rather than truncating. `WorkOrdersList.jsx:170-181` omits bucket counts *because* the read is bounded. **Three independent places in EOS already chose refusal over understatement. R-K5 makes that the rule.** |

**Four live reconciliation defects, all evidenced in §2.3.1:**

1. **`rowCap` is a constant echo** (`reportExecutionService.ts:641`), not the bound that bit; the client
   narrates it as a row limit that may be off by 10× (`reportResultState.js:57-60`). **`RunReportOutcome`
   has no `groupCap` field at all** (`:191-211`), so the client cannot be fixed without a wire change.
2. **`truncated` is the OR of three unrelated bounds** (`:592-593`), so it cannot tell a reader what to
   narrow.
3. **The truncation refusal keys on `activeAggregates`, i.e. after authorization-dropping** (`:507`,
   `:485-490`) — so losing an aggregate to a field denial converts a refusal into a silent bounded page.
4. **A groupBy-only run escapes the refusal entirely** (`:569` admits it, `:507` does not see it) and
   returns a distinct-values list over a cut population. **A distinct-values list is an aggregate claim
   about the population** and must be covered.

**Required distinctions.**

| Must be distinguishable | Must never be collapsed into |
|---|---|
| "this is the whole population" | "this is a page of it" |
| "the scan was complete" | "the scan was cut at N documents" |
| "the result was cut at N rows" | "the result was cut at N groups" |
| "these figures reconcile" | "these figures were not compared" |
| "a row changed between the two reads" | either figure being silently adjusted |

### R-K6 — TIME AND STALENESS: as-of semantics, and what must be shown when two reads are two instants

**Required behaviour.** Every displayed KPI must carry an **as-of instant**. A drill must declare its
own as-of. If the aggregate and the drill were read at different instants, **that must be shown**.

**The baseline cannot meet any part of this.** Measured:

| Fact | Evidence |
|---|---|
| `RunReportOutcome` carries **no timestamp field** and the returned object carries none | `reportExecutionService.ts:191-211`, `:636-649` |
| The only recorded instant is server-side on the audit event and is never returned | `functions/src/access/auditEventWriter.ts:732` (`FieldValue.serverTimestamp()`) |
| The only clock read in the engine is cosmetic — an audit correlation id | `reportExecutionService.ts:398` (`adhoc-${Date.now()}-…`) |
| There is **no relative window, no "today", no as-of parameter** in reporting at all | grep for `today` / `asOf` / `timezone` / `America/` over `functions/src/reporting/` and `field-ops-app-vite/src/domain/reporting/`: no functional hits |
| Date filters are literal values only (ISO-8601 string or epoch-ms) | `reportQueryValidation:251-254` |
| Comparison is UTC-instant arithmetic via `Date.parse` | `reportExecutionService.ts:712-722` (`toComparableDate`) |
| **Consequence: a calendar-day equality is effectively unmatchable.** `eq "2026-09-13"` matches only exactly UTC midnight; `between` on date-only strings silently means UTC-midnight boundaries | `:661-667`, `:698-704` |
| **A timezone authority exists in this repository and reporting does not use it** | `functions/src/reportingPeriod/reportingCalendar.ts:70-71` — `reportingTimeZone: "America/Phoenix"` — keyed per operating company at `:77-78` (both companies currently share **one** calendar object), with `resolveSharedReportingCalendar` at `:123` for the case where they diverge, and `resolveReportingPeriod` in `functions/src/reportingPeriod/reportingPeriod.ts`. Nothing under `functions/src/reporting/` imports any of it. |
| The dashboard/service surfaces each carry their own private `startOfDayMillis` — **three copies** | `domain/workOrderAttentionProjection.js:56`, `domain/schedulingWorkspace.js:104`, and a third (§4 #6) |
| Live snapshots have no as-of at all | `services/workOrderService.ts:93` unbounded `onSnapshot` feeds the dashboard tiles, all of Service Operations, and the Dispatcher Board |
| **The one KPI with a declared period, and the only consumer of the calendar authority** | `MyDashboard.jsx:455-459` — `resolveReportingPeriod({ periodType: "MTD", asOfMillis: Date.now(), calendar: TAYLOR_VENTANA_REPORTING_CALENDAR })`. Note the client carries its **own copy** of the calendar (`field-ops-app-vite/src/domain/reportingPeriod.js:25`), held to the server's by `functions/test/reportingPeriodParity.test.mjs` — a duplicated authority, gated. |

**So: "what does 'today' mean with no timezone authority?"** At this baseline it means **UTC midnight**,
by accident, through `Date.parse` — while the business's own declared reporting timezone is
`America/Phoenix`, **per operating company**. For a Phoenix business that is a **7-hour** displacement:
a work order scheduled at 4 p.m. Phoenix on the 12th is "the 13th" to every date predicate in the
reporting engine.

**Required distinctions.**

| Must be distinguishable | Must never be collapsed into |
|---|---|
| an as-of instant (a point) | a window (an interval) |
| a window in the company's reporting timezone | a window in UTC |
| "read once, both halves" | "read twice, at two instants" |
| "nothing changed between the reads" | "we did not check" |
| a live stream with no as-of | a snapshot with one |

**Required, concretely:** *"today" must never be computed from a bare clock where a reporting-calendar
authority exists.* `reportingCalendar.ts:77-78` keys the calendar **per operating company** while pointing both keys at
one object, and `:123` `resolveSharedReportingCalendar` exists precisely to refuse when two companies
disagree. So "today" is a single answer **today, by coincidence of configuration, not by rule** — and a
KPI spanning companies has no guaranteed single "today". That is a finding, not a gap to paper over.

**OWNER DESIGN DECISION (`OD-K3`).** May an aggregate and its drill be read at **different** instants at
all? Engineering consequence:

| Answer | Consequence |
|---|---|
| **No — one read, both halves** | Requires the aggregate and the rows to travel together, which the reporting engine forbids today (`:584`, `:601`). Strongest guarantee, largest change, and it bounds the drill to the aggregate's row cap. |
| **Yes, with the drift displayed** | Cheap, and honest only if drift is actually *detected* — which requires a comparable as-of on both halves, i.e. R-K6's first sentence, which nothing in EOS currently satisfies. |
| **Yes, silently** | The status quo. It is what makes §4's duplications invisible in testing: two reads at two instants can always be excused by "the data changed". |

**A related consequence for `OD-K4`** (§7): if a drill *re-executes* the definition it is a second read
and inherits `OD-K3`; if it reads a **retained** row set it is one read, and then retention becomes a
data-governance question (how long, where, under whose authority, and whether a retained row set is
itself a record).

### R-K7 — HONEST ABSENCE: a KPI of 0 and a KPI that is unavailable are different claims

**Required behaviour.** **A zero and an unavailable must never render alike.** A KPI must express, as
distinct states, at minimum: a proven zero · an unproven zero · unavailable (not read) · refused (not
authorized) · not applicable · not yet measured.

**`ENG-IMPL-003` (UX-HONEST-ABSENCE) is specifying the state taxonomy concurrently. This entry
references that contract and does not duplicate it.** What follows is only the KPI-specific material
003 needs and cannot derive from a general taxonomy.

**The KPI-specific cases, with evidence:**

| Case | Evidence at `64008d5a` | Status |
|---|---|---|
| **An unproven zero is presented as a proven zero.** `rowCount === 0 → "empty"` is the **first** branch of the kind ladder, outranking truncation | `reportExecutionService.ts:627-634`; rendered *"This report ran successfully but no records matched."* (`reportResultState.js:26-29`), and one audit event records `outcome: "applied"` over it | **LIVE.** Fixed on branch by `b8308e48` (`judgeAbsenceProvenance()` / `UnprovenAbsenceError`) |
| **A refusal is reported as "not available yet", asserting that nothing was read.** The server's `resource-exhausted` refusal falls to `default:` in `mapCallableError` | `runReportDefinitionCallable.ts:56-57` → `reportRunOutcome.js:71-81` → `reportRunOutcome.js:27` *"Running reports isn't available yet. Nothing was read or changed."* | **LIVE, and the sentence is false** — exceeding the scan cap is the reason the answer could not be proven. Fixed on branch by `9d3ab48d` |
| **`avg` / `min` / `max` over an empty set return `0`**, indistinguishable from a real zero | `reportExecutionService.ts:759-761` | **LIVE.** A mean of nothing is not zero. |
| **A fabricated constant renders under the word "Live"**, and the read-failure flag is write-only | `index.html:1464`, `:399`, `:440`, `:442-450` | **LIVE, publicly served** (§2.1) |
| **The `null` / `0` discipline is kept in six places and broken in the engine** | Kept: `MetricStrip.jsx:16`, `:22-23` (*"It renders 'unavailable' — never 0. A zero is a finding; an unread number is not"*) · `useListViewChrome.js:111` · `FilterBar.jsx:88-91` (`undefined`/`null`/`0`) · `GoalTile.jsx:19-21` · `AccountHealthStrip.jsx:41` · `financialFactsView.js:22-28` (`LOADING`/`DENIED`/`UNAVAILABLE`/`EMPTY`/`READY`, mapped `:37-51`) | The vocabulary exists; it is not universal |
| **A zero that suppresses its own disclosure.** The "Active because of *{env}*" tile is hidden when zero — and it is zero exactly when the production activation set is misread | `AdminRolesPermissions.jsx:208-210`; §2.2.1 | **LIVE.** *"a permanent 0 teaches a reader to stop seeing the row"* (`MetricStrip.jsx:12-14`) is sound reasoning that here hides the defect |
| **A refused KPI must not be reachable as a zero through a drill either.** `openWorkOrdersMetric` correctly suppresses the drill link when `count === 0` — *"Zero is a real, authoritative answer here — unlike an absent source — so it renders"* | `domain/accountHealthStrip.js:54-56` | **Correct behaviour, worth preserving** |

**The one distinction this entry contributes to 003's taxonomy**, because it is specific to aggregates
and a general absence taxonomy will not produce it:

> **An aggregate has two independent absences, and they must not be collapsed: the absence of *rows*
> and the absence of *proof*.** "No rows matched" and "we could not establish whether any rows matched"
> are different claims, and only the second is affected by truncation, scope-unresolution or a dropped
> predicate. EOS's kind ladder collapses them (`reportExecutionService.ts:627-634`) — a single
> single-winner `kind` cannot carry both, which is why `ENG-IMPL-001` §6.1 argues a scope class must be
> an **orthogonal descriptor** rather than a new `kind`. **Absence-provenance must be orthogonal for
> the same reason.**

**Also inherited, not restated:** the contract must satisfy the three display constraints
`ENG-IMPL-001` §6.3 establishes (never name a field the runner may not know exists; never emit a raw
code or path; exactly one audit event per run, never row data).

---

## 6. Acceptance proofs

**This entry writes and runs no tests and authorizes no product change.** Below, per requirement, is
the test that would demonstrate it, named, with the existing file it belongs in where one exists. All
listed existing files were verified present at `64008d5a`.

**Two standing rules for every proof below**, both learned from defects in this repository:

1. **A guard must be proved capable of failing.** `functions/test/reportingActivationBoundary.test.mjs:77-79`
   asserts a true-sounding safety property, **passes**, and is **false** — because it asks a production
   question of the non-production resolver (§1.3). Every proof below must be demonstrated fail-first:
   shown red against the current baseline, or red against an injected violation. *A guard that cannot
   fail proves nothing, and this repository has shipped one.*
2. **Assert the QUERY ISSUED, not only the rows returned.** An in-memory post-filter satisfies a
   row-count assertion while leaving an unbounded read intact, because Firestore applies the scan cap
   **before** any in-memory pass. This is the method `92db1d19` used to reproduce four unbounded axes
   that row-count assertions had missed.

| Req | Proof | Home | Negative case — the one that matters |
|---|---|---|---|
| **R-K1** | `kpiProvenanceCompleteness` — enumerate every KPI descriptor; assert each yields all seven P-fields or is explicitly marked `UNACCOUNTABLE`. A field may be `"none"` (a legitimate answer) but never absent. | new, beside `field-ops-app-vite/test/dashboardDesignConformance.test.mjs` | A KPI with a **silently missing** P-field must fail. A KPI marked `UNACCOUNTABLE` must render its marker — assert the marker reaches the DOM, not merely the model. |
| **R-K1** | `provenanceNeverLeaksDeniedFieldNames` — assert a provenance record names dropped **columns** but only **counts** dropped **predicates**, and emits no raw code, path, document id or collection name. | `field-ops-app-vite/test/reportResultState.test.mjs` (the constraint already lives there: `reportResultState.js:34-44`, `:101-106`) | Injecting a denied predicate whose field name appears anywhere in rendered copy must fail. |
| **R-K2** | `kpiDrillIdentity` — for each KPI id, obtain the aggregate expression and the drill expression and assert **object identity** (same exported function), not equal output. | new, `field-ops-app-vite/test/` | Two functions with identical behaviour must **fail**. This is the whole point: §4 #6 and #10 currently agree and are still defects. |
| **R-K2** | `noDuplicatedBusinessPredicate` — a ratchet: for each named business concept ("open work order", "past due", "allocated", "attention", "discrepancy", "available stock", "overdue"), assert exactly **one** exported predicate exists and that every count and every list imports it. | new ratchet; seed the concept list from §4 | Re-typing a predicate that an exported one already covers must fail. Seed it **red** against §4 #1, #4, #7, #12 — the four cases where the shared predicate exists and is bypassed — so the ratchet is proved capable of failing on real code. |
| **R-K2** | `clientDoesNotRecomputeGovernedNumber` — assert no client surface computes a figure for which a governed server authority exists. | new, seeded from §4 #5 | Must fail today: `getInventoryAnalytics` exists and is called by no client surface while `domain/inventoryAnalyticsEngine.ts` computes a different "available stock" for four surfaces. |
| **R-K2** | `reportAggregateAndRowsCanTravelTogether` — assert a run carrying an aggregate can also yield the rows behind it (or a derivable drill definition). | `functions/test/reportExecutionService.test.mjs` | **Must fail at this baseline**, by construction (`reportExecutionService.ts:584`, `:601`, `:639-640`). That red is the finding, and it is the acceptance criterion for the largest change this entry implies. |
| **R-K3** | `drillInheritsAggregateScope` — assert a drill's resolved company scope is **the same object** the aggregate resolved, and that a drill which would change the scope **class** refuses. | new, beside `functions/test/financialReportingRead.test.mjs` | A drill that silently re-resolves scope and happens to match must fail (identity, not equality). |
| **R-K3** | `companyScopeNeverFromCallerInput` — assert no read callable uses a caller-supplied company id as a query predicate without a membership check. Assert on the **query issued**. | new; extend `functions/test/financeReadCallables.test.mjs`'s posture | **Must fail today** on `functions/src/coverage/coverageReadCallables.ts:59-60`, and on the write side at `functions/src/opportunity/opportunityCallables.ts:228`. Both are named in §5 R-K3 so the red is expected, not a surprise. |
| **R-K3** | `scopeUnresolvedIsNotEmpty` — assert an unresolvable scope produces a named refusal and that no code path maps it to a zero-row ready result. | new; the vocabulary to assert against already exists at `functions/src/reorderRequest/reorderWarehouseAuthority.ts:76-83` and `functions/src/ownership/operatingCompanyAuthority.ts:54` | **Must fail today** on `coverageReadCallables.ts:72-74`, which returns `status: "ready"` with an empty array for every thrown error. |
| **R-K4** | `aggregateVisibleRowsDenied` — construct a principal who may see the aggregate and not the rows; assert the result is the **named state** chosen under `OD-K2`, and assert it is **neither `0` nor a throw**. | `functions/test/reportExecutionService.test.mjs` + a render assertion in `field-ops-app-vite/test/reportResultState.test.mjs` | The state must be asserted **in the DOM**, not only in the outcome object. A correct model rendered as "0" is the defect. |
| **R-K4** | `sevenAuthorityFailureModesAreDistinguishable` — assert A1–A7 (§1.4) produce seven distinguishable outcomes; in particular `inactivePermission` ≠ `noQualifyingGrant` **at the display layer**. | new, beside `functions/test/productionCapabilityActivation.test.mjs` | Collapsing any two must fail. The resolver already distinguishes them (`resolveEffectivePermission.ts:265`, `:298`); the proof is that the distinction survives to the reader. |
| **R-K4** | `clientAndServerActivationAgree` — assert the frontend's baked activation set equals `resolveRuntimeCapabilityOverrides()` for the **same project id**, production included. | new, spanning `scripts/environmentArchitecture.test.mjs` and `functions/test/environmentCapabilityOverrides.test.mjs` | **Must fail today** for `taylor-parts`: 25 server-side, 0 client-side (§1.5). This is the proof that §2.2.1's tile is wrong. |
| **R-K4** | `activationGuardsResolveThroughTheRuntimeAuthority` — a ratchet asserting that (i) no test or runtime module answers an activation question with `resolveCapabilityOverrides` where a production answer is required, and (ii) the two authorities **disagree** for production (0 vs 25) — because if they ever agree, the ratchet has stopped proving anything. | `functions/test/reportingActivationBoundary.test.mjs` — **the file that currently embodies the defect** | Swapping the resolver with **no assertion changed** must turn the file red. That substitution is the fail-first demonstration. |
| **R-K5** | `countReconcilesExactly` — after a drill, assert `rows reached === aggregate`, exactly, for counts. | new, beside `functions/test/reportExecutionService.test.mjs`; the honest pattern to imitate is already live at `field-ops-app-vite/src/modules/accounts/AccountsList.jsx:324-340` | A tolerance of ±1 must fail. A discrepancy that is **not displayed** must fail. |
| **R-K5** | `moneyReconcilesInMinorUnitsPerCurrencyPerCompany` — assert reconciliation in minor units, never across currency or company; assert a cross-currency total is not produced. | `functions/test/financeReadProjection.test.mjs` | Any float-epsilon comparison must fail. Any summed cross-currency figure must fail (`financialFactsView.js:71` already refuses it — the test pins the refusal). |
| **R-K5** | `truncationRefusesRatherThanUnderstates` — assert an aggregate over a bounded/truncated population refuses, and names **which** bound bit. | `functions/test/reportExecutionService.test.mjs` (extends the existing `judgeScanCompleteness` coverage of `reportExecutionService.ts:124-129`) | **Four must-fails at this baseline**: `rowCap` reporting the wrong bound (`:641` vs `:571-572`); `truncated` as an undifferentiated OR (`:592-593`); the refusal keying on post-authorization `activeAggregates` (`:507`); and a groupBy-only run escaping the check entirely (`:569`). |
| **R-K5** | `roundingNeverEntersReconciliation` — assert every reconciliation reads the exact figure and that rounding occurs only at the render site. | new | A figure rounded before aggregation must fail, or be required to declare itself non-reconcilable. |
| **R-K5** | `percentageCarriesNumeratorAndDenominator` — assert a displayed ratio exposes both terms or declares itself non-reconcilable. | new, beside `field-ops-app-vite/test/dashboardDesignConformance.test.mjs` | **Must fail today** on `DispatcherBoard.jsx:233` ("fleet booked N%" — denominator never shown). |
| **R-K6** | `everyKpiCarriesAnAsOf` — assert every KPI descriptor yields an as-of instant or the explicit state "live stream, no as-of". | new | **Must fail today** for nearly every KPI (§3.3); `MyDashboard.jsx:454-461` is the one that passes. |
| **R-K6** | `aggregateAndDrillDeclareTheirInstants` — assert both halves carry an as-of and that a difference is surfaced. | new, beside `functions/test/reportExecutionService.test.mjs` | **Must fail today**: `RunReportOutcome` has no timestamp field (`:191-211`). |
| **R-K6** | `todayUsesTheReportingCalendar` — assert no date predicate backing a displayed figure computes a day boundary from a bare clock where `functions/src/reportingPeriod/reportingCalendar.ts` applies; assert the boundary is the company's `reportingTimeZone`. | `functions/test/reportingPeriod.test.mjs` / `reportingPeriodParity.test.mjs` (both exist) | **Must fail today** on three counts: `reportExecutionService.ts:712-722` (UTC via `Date.parse`) and the three private `startOfDayMillis` copies (§4 #6). Include the 7-hour Phoenix case explicitly — a 4 p.m. local event landing on the wrong day. |
| **R-K7** | `zeroAndUnavailableNeverRenderAlike` — a render-level assertion, not a model one: for each KPI, assert the DOM differs between a proven zero, an unproven zero, unavailable, refused, not-applicable and not-yet-measured. | `field-ops-app-vite/test/reportResultState.test.mjs` + `dashboardDesignConformance.test.mjs`; the discipline to pin already exists at `MetricStrip.jsx:16`, `:22-23`, `useListViewChrome.js:111`, `FilterBar.jsx:88-91`, `GoalTile.jsx:19-21` | Two states producing identical DOM must fail. Assert by **injection**, per `8e28e32d`'s method: a state the build predates must not render as success, as a proven empty, as "nothing was read", or as a raw code. |
| **R-K7** | `absenceProvenanceIsOrthogonalToKind` — assert absence-provenance travels on **every** outcome, including `empty` and `permission-denied`, and is not a member of the single-winner `kind` ladder. | `functions/test/reportExecutionService.test.mjs` | **Must fail today**: `rowCount === 0 → "empty"` is the ladder's first branch and outranks truncation (`:627-634`). Reproduce it the way `b8308e48` did — four rows, one matching, `maxScanDocs 2`, assert `{ kind: "empty", truncated: true }` and an audit `outcome: "applied"` over a false negative. |
| **R-K7** | `emptyAggregateIsNotZero` — assert `avg` / `min` / `max` over an empty set are **not** `0`. | `functions/test/reportExecutionService.test.mjs` | **Must fail today** (`:759-761`). |
| **R-K7** | `refusalDoesNotClaimNothingWasRead` — assert no refusal path renders a sentence asserting nothing was read when documents were. | `field-ops-app-vite/test/reportRunOutcome.test.mjs` | **Must fail today**: `resource-exhausted` → `default:` → `reportRunOutcome.js:27` *"Running reports isn't available yet. Nothing was read or changed."* |
| **R-K7** | `noDisclosureTileIsHiddenByItsOwnZero` — assert a tile whose purpose is to disclose a discrepancy is not suppressed when the value is zero. | new, beside `field-ops-app-vite/test/` administration coverage | **Must fail today**: `AdminRolesPermissions.jsx:208-210` hides "Active because of *{env}*" exactly when the misread makes it zero (§2.2.1). |
| **Cross-cutting** | `clientServerKindContractIsDirectional` — `CURRENT_SUPPORTED_SERVER_KINDS ⊆ CLIENT_RECOGNIZED_KINDS`; a client-only kind permitted only when declared with a reason; an undeclared client-only kind, a reasonless entry and a stale entry all fail. | **Does not exist at this baseline.** Present only on `rpt/client-outcome-honesty` and `origin/rpt/reporting-remediation` as `field-ops-app-vite/test/reportOutcomeContractRatchet.test.mjs:140` | Recorded here as a **correction**: the brief states this invariant as current. It is **branch-only**. The reasoning is sound and worth adopting — set **equality** is illegitimate because the client and the trusted Function are independently deployable, and the last recorded production Functions deploy pins `fb45e6ee` (`docs/DECISIONS.md:744`), a **different** kind union. An unrecognised kind must degrade to an honest unknown, never to empty and never to success. |

### 6.1 What would NOT be a proof

| Not a proof | Why |
|---|---|
| "The aggregate and the drill returned the same number in a test" | Two implementations agree until they do not. R-K2 requires **identity**, and §4 #6 and #10 are live proof that agreement is not identity. |
| "An admin could open the drill" | `admin` holds the entire catalogue (`compatibilityRoles.ts:235-240`) and is the **only** production principal (§1.4). An admin passing exercises none of A1–A7. A proof must use a principal holding exactly one governed report Role. |
| "No rows leaked" | Row-count assertions are satisfied by an in-memory post-filter over an unbounded read. Assert the **query issued**. |
| "The guard passes" | See `reportingActivationBoundary.test.mjs:77-79`. Show it red first. |
| "The provenance note says the right thing" | A hand-authored note is a second implementation of the number's meaning (R-K1). It must be **derived**. |
| A count of ALLOW decisions offered as evidence of reach | The withdrawn "62 of 147" and its contested replacements (34/36/37/38/39) are why. Every method agreed **nothing commercial is reachable**; the disagreement was arithmetic and method-mixing. A count must state its method and be presented as method-dependent. |

---

## 7. What this entry does NOT decide

### 7.1 Carried from `ENG-IMPL-001`, not re-decided here

| ID | Decision | What this entry adds |
|---|---|---|
| `OD-R2` | Is a saved report private user data, or shareable configuration? | §2.3.3 measures the consequence: `reportDefinition` is the one family the ownership matrix marks `EXCLUDED` (`ownershipMatrix.ts:521`), the record has no company/scope/sharing field (`savedDefinitionCommands.ts:328-334`), a duplicate reassigns `ownerUid` (`:505-509`), and **production activates no definition mutation at all** (§1.2). So a shared KPI is currently *unrepresentable*, not merely unbuilt. |
| `OD-R8` | May an aggregate be computed over a company-derived population, or must it be refused? | §5 R-K4 shows `OD-K2`'s option (c) **collapses into `OD-R8`** and cannot be decided independently of it. |
| `OD-R11` | Where does the single company-scope authority for reporting live? | R-K3 adds one requirement that holds under any answer: a **drill must inherit the aggregate's resolved scope object**, never re-resolve it. |

### 7.2 Raised by this entry

| ID | Decision | Engineering consequence of each answer |
|---|---|---|
| `OD-K1` | Is provenance always visible, on demand, or only on failure? | §5 R-K1. Failure-only is strongest and makes the *absence* of a badge a positive accountability claim — so the failure test must be trustworthy at render time. |
| `OD-K2` | When the caller may see the aggregate but not the rows: (a) hide the tile, (b) show and refuse the drill honestly, (c) show a scoped-down number? | §5 R-K4 sets out all three with consequences. **(b) is already the de facto behaviour** via unconditional `countRows` (`reportExecutionService.ts:486`) — reached without a decision. **(c) collapses into `OD-R8`.** Engineering's only non-negotiable: one named state, uniform across the estate, produced by the **same** authorization pass as the number. |
| `OD-K3` | May an aggregate and its drill be read at different instants? | §5 R-K6. "No" forces the two halves into one read, which the engine forbids today. "Yes, with drift shown" requires an as-of that nothing in EOS currently has. "Yes, silently" is the status quo and is what makes duplication invisible in testing. |
| `OD-K4` | Does a drill **re-execute** the definition, or read a **retained** row set? | Re-execution is a second read and inherits `OD-K3`. Retention makes one read possible but raises retention governance — how long, where, under whose authority, and **whether a retained row set is itself a record** subject to the ownership model. |
| `OD-K5` | Is a KPI a **governed object** with an id, an owner and an audit trail, or a property of a screen? | Everything in §5 is cheap if a KPI has an identity and expensive if it does not. R-K1's provenance, R-K2's identity test and R-K5's reconciliation all presuppose "for each KPI id". At this baseline **no such identity exists** — and the only candidate (`reportDefinition`) is the family the ownership matrix excludes. |
| `OD-K6` | What happens to the publicly-served legacy monolith (§2.1)? | Displaying seed constants as "Live status" on the product's own public domain is a truthfulness question, not an engineering one. Engineering can state the options (remove from the Pages assembly at `.github/workflows/deploy-field-ops.yml:58-63`; label it honestly; give it a real read) and their costs; which is right is the Owner's. |
| `OD-K7` | Should the four highest-value KPI screens be moved from the three-item role gate to capability ids? | `domain/constants.js:374-378`. R-K1's P6 cannot be stated per-capability on a surface gated by a role string, and R-K4's A1–A7 cannot be distinguished there at all. Moving them is a governance change, not a refactor. |

### 7.3 Explicitly engineering, not product — decided here

| Decided | Why it is not a product judgement |
|---|---|
| A count reconciles **exactly**; money reconciles **exactly in minor units, per currency, per company** | A count that differs from its rows is wrong, not differently-valued. |
| Rounding never enters reconciliation | Arithmetic. |
| A drill inherits the aggregate's **resolved scope object**, never re-resolves it | Re-resolution is a second implementation (R-K2) wearing scope's clothes. |
| Company scope is never taken from caller input without a membership check | Already the estate's rule everywhere except two named call sites (§5 R-K3). |
| A guard must be demonstrated fail-first | This repository has shipped a passing guard that asserted a false safety property. |
| Absence-provenance is **orthogonal** to the outcome `kind`, not a member of it | A single-winner ladder cannot carry two independent facts; the same argument `ENG-IMPL-001` §6.1 makes for scope class. |
| An unrecognised outcome kind degrades to an **honest unknown**, never to empty and never to success | The client and the trusted Function are independently deployable and the last recorded production deploy pins a different kind union (`docs/DECISIONS.md:744`). |

---

## 8. UNPROVEN — what could not be established at this baseline

Each item names what would settle it. **An UNPROVEN item is a finding. An assumed answer would not be.**

| # | UNPROVEN | What would settle it |
|---|---|---|
| U1 | **Whether the production `admin@global` principal has ever run a report.** The capabilities are activated, the Role holds them, and the callable is deployed (§1.3) — but whether a run has occurred is an audit-log fact in production, and this lane makes no production contact. | A read-only query of the production audit-event collection for `runReportDefinition` actions, under a separate authorization. **Not performed.** |
| U2 | **Whether the frontend currently deployed to production was built from a registry containing the 25 production activations.** §1.5 proves the *projection* cannot carry them. What is actually in the served bundle is a different question: `docs/DECISIONS.md` #75 records both production frontends as stale (Pages ~13 h, Hosting ~5 days at that measurement) and the Pages publish path as unreliable. | Fetching and inspecting the served bundle's baked `__APP_CAPABILITY_ACTIVATION_OVERRIDES__`. **Not performed** — it is production contact. |
| U3 | **The exact production Functions estate at this baseline.** `docs/DECISIONS.md:884` records 22 live Functions and the post-deploy inventory used in §1.3 enumerates 12 (it is one audit's snapshot, not a full census). `runReportDefinitionCallable` is in that snapshot, `ACTIVE`, so its deployment is proven; the *total* is not. | A fresh read-only `gcloud functions list` against `taylor-parts`. **Not performed.** |
| U4 | **Whether any `reportDefinitions` document exists in production.** Production activates `report.definition.read` but no mutation (§1.2), and the collection is client-closed (`firestore.rules:1592-1594`), so nothing could have been created through the product. An Admin-SDK write could have. | Read-only count of the production collection. **Not performed.** |
| U5 | **Whether `resolveEffectiveAccessCallable` passes the production activation set to the client's capability feed.** The report nav gate consults the trusted feed rather than the baked set (`field-ops-app-vite/src/access/reportAccess.js:9-15`), so the feed may be correct where the baked set is not — which would mean the nav item appears while `AdminRolesPermissions` says the capability is inert. `functions/src/access/effectiveAccessFeed.ts` was not traced end-to-end for activation wiring in this lane. | Tracing `effectiveAccessFeed.ts` / `effectiveAccessFeedCallable.ts` for `resolveRuntimeCapabilityOverrides()`, then asserting client/server agreement (§6, `clientAndServerActivationAgree`). **Bounded out of this lane; it is the single highest-value follow-up.** |
| U6 | **Whether the legacy monolith is actually reachable right now.** The workflow assembles and uploads it (§2.1) and `docs/DECISIONS.md:243` documents the behaviour, but `docs/DECISIONS.md` #75 FINDING 2b records the Pages publish path as failing intermittently, so what is *currently* served is not established from the repository. | An HTTP GET of the site root. **Not performed** — it is production contact. |
| U7 | **Whether the reporting engine's four objects contain enough production data for any KPI to be non-trivial.** `ENG-IMPL-001` §4.5 measures population and records what the measurement is worth; this entry did not re-measure and does not restate it. | `ENG-IMPL-001` §4.5, plus a production row count under separate authorization. |
| U8 | **The complete count of displayed numbers in the React app.** The census used four independent search axes and located ~95 figures across ~40 surfaces, which is a floor, not a ceiling. A number rendered by an expression no axis matched would be missed. | An exhaustive AST pass over every JSX render site. Not attempted; the four-axis result is reported as a floor, and §2.2 deliberately does not claim a total. |
| U9 | **Whether `ENG-IMPL-003`'s state taxonomy will name the states §5 R-K7 requires.** 003 is being written concurrently in a sibling lane and is not present on any branch at the time of writing (`git ls-tree ext/ux-honest-absence -- docs/atlas` → empty). | Reading 003 when it lands, then reconciling §5 R-K7's KPI-specific cases against its vocabulary. **This entry references 003 by id and duplicates none of it, which is the correct posture but leaves the seam unverified.** |
| U10 | **Whether the `coverage.read` payload-scope defect (§5 R-K3) is reachable in any environment today.** It is catalogue-inactive and absent from the production activation set. Whether `platform-sandbox`'s 92-id override set includes it was not checked in this lane. | Intersecting `config/environments.json`'s `platform-sandbox` set with `coverage.*`. Cheap; not done here because the sandbox is out of this lane's frame. |

---

## 9. MISSING INPUT

| Input | Status | Consequence for this entry |
|---|---|---|
| **Atlas Design r1** — `docs/atlas/inputs/design-r1/` | **DOES NOT EXIST at `64008d5a`.** `docs/atlas/` does not exist at all (`git ls-tree -r 64008d5a -- docs/atlas` → empty; this entry creates the directory on its own branch). | `SOURCE NORTH STAR` is **MISSING INPUT**, not a guess. Any claim about *which* KPIs the design intends, how they should look, or which tiles a persona should see is **not made here**. §5 specifies required behaviour and required distinctions only. When r1 lands, this entry should be amended to cite the page. |
| **A designed KPI set** | Absent. `docs/north-star/` carries no reporting surface (per `ENG-IMPL-001`'s README note: its subdirectories are `dispatch-board`, `equipment`, `financials`, `lists`, `my-dashboard`, `opportunity`, `parts`, `receiving`, `sales-agreement`, `service-operations`, plus `VISUAL-SYSTEM.md`). | The inventory in §2 is a census of **what ships**, never of what was intended. §2.5 records that the only named "KPIs" *screen* in the repository exists solely in dead metadata (`modules/registry/moduleRegistry.ts:59-65`). |
| **`ENG-IMPL-003`** state taxonomy | Being written concurrently; not on any branch yet. | §5 R-K7 references the contract and supplies only the KPI-specific cases. **U9.** |
| **An Owner ruling on `OD-K1`–`OD-K7`** | Absent. | Seven decisions carried, none taken (§7.2). |

**Atlas never appears in customer-facing EOS.** Nothing in this entry proposes surfacing a register id, a
`ENG-IMPL-*` reference, or any Atlas vocabulary to a user. Where §5 requires copy, the copy is the
product's own existing vocabulary (`reportResultState.js`, `HonestState.jsx`, `MetricStrip.jsx`).

---

## 10. Corrections to the brief, and to a sibling entry

Recorded because correcting the brief was in scope and expected.

### 10.1 The brief was RIGHT where it mattered most, and a sibling entry is wrong

| Claim | Verdict |
|---|---|
| **Brief:** "`productionCapabilityActivations` holds 25 entries on `taylor-parts-production`, all `report.*`, adopted despite their catalog `active: false`" | **CONFIRMED**, independently, by static parse. §1.2. |
| **Brief:** "`environmentCapabilityOverrides.ts:354` returns EMPTY unconditionally when `role === "production"`, so `capabilityActivationOverrides` is inert in production by construction" | **CONFIRMED.** §1.1. |
| **Brief:** "this two-field trap is the most misreported fact in the program" | **CONFIRMED, and demonstrated.** `ENG-IMPL-001` §1.4 falls into it: it states *"Company-scoped reporting has no production exposure today. Every `report.*` capability resolves to DENY for every principal, so `runReportDefinition` returns `kind: "permission-denied"` … for every real caller — admin included."* **That is false at `64008d5a`.** It is true of the *catalogue* and of the *non-production* activation authority; it is false of production, where `resolveProductionCapabilityActivations()` activates 25 ids (`environmentCapabilityOverrides.ts:748-759`), `resolveRuntimeCapabilityOverrides()` returns them (`:773-775`), `resolveEffectivePermission` lifts the deny (`:264-265`), and the engine passes the set (`reportExecutionService.ts:273`). 001's §1.4 **also** asserts *"no Role grant exists"*-adjacent reasoning by inheriting `index.ts:178`; `ADMIN_ALL_PERMISSIONS` (`compatibilityRoles.ts:235-240`) grants all 39 to `admin`, and `reportViewer`/`reportFinanceViewer`/`reportAuthor` exist (§1.4). **001's §1.4 measurements (147 catalogue entries, 39 `report.*`, 0 active) are all correct and I reproduced every one; only its two conclusions are wrong.** Its §1.5 finding — that the client seam is live and three headers say otherwise — is correct, and this entry extends it. |
| **Brief:** "`reportRunOutcome.js:27` still ships 'Running reports isn't available yet.'" | **CONFIRMED**, exactly at line 27. |
| **Brief:** "the reporting remediation chain is FIXED ON BRANCHES, LIVE AT YOUR BASELINE" | **CONFIRMED.** Eight commits on `origin/rpt/reporting-remediation`, none an ancestor of `64008d5a`. §2.3.2. |
| **Brief:** "Production role occupancy is ZERO … 2 `roleAssignments`, one principal `admin@global` with `employeeId: null`" | **CONFIRMED** from the committed census `be1e5579` (verified ancestor). One refinement: "occupancy is zero" is precise for *governed operational* Roles; there **is** one principal with one active RoleAssignment, and that principal holds everything. §1.4. |
| **Brief:** "`ADMIN_ALL_PERMISSIONS` (`compatibilityRoles.ts:235`) spreads the whole catalogue onto `admin`; `OWNER_PERMISSIONS` composes from `ADMIN_ROLE`" | **CONFIRMED** at `:235-240` and `governedBusinessRoles.ts:83`. |
| **Brief:** "'An admin can drill in' is NOT evidence drill-through works — held-only-by-admin is one of seven authority failure modes" | **CONFIRMED and adopted.** §1.4 enumerates A1–A7 from the code; §6.1 makes "an admin passed" explicitly not a proof. |
| **Brief:** "the one ownership check in the product is `ownerUid` on saved report definitions — the single family the ownership matrix excludes" | **CONFIRMED** at `ownershipMatrix.ts:521` (`EXCLUDED`, *"platform record with its own private-by-owner model — do not disturb"*) and `:548`. §2.3.3 works out the consequences. |
| **Brief:** "`docs/atlas/inputs/design-r1/` does not exist at origin/main" | **CONFIRMED — and stronger than stated:** `docs/atlas/` does not exist **at all**. §9. |
| **Brief:** "Do not quote any capability ALLOW count" | **HONOURED.** No overall ALLOW count appears. Where counts were needed they were derived and their method stated (§2.4). |

### 10.2 Where the brief needs correcting

| # | Brief says | Correction |
|---|---|---|
| C1 | The two activation fields "**compose** in `resolveRuntimeCapabilityOverrides()`" | It is a **precedence ternary**, not a composition: `production.size > 0 ? production : nonProduction` (`environmentCapabilityOverrides.ts:775`). The file's own comment at `:770-771` calls the result a union; it is not one. Harmless today — exactly one can be non-empty, since each refuses the other's role — but a project carrying both fields would get the production set and silently drop the other, and **no test asserts a union**. §1.1. |
| C2 | "**`CURRENT_SUPPORTED_SERVER_KINDS` must be a SUBSET of `CLIENT_RECOGNIZED_KINDS`** — not equal" | **Correct as reasoning, wrong as a description of the baseline.** Neither identifier exists at `64008d5a`. Both appear only on `rpt/client-outcome-honesty` and `origin/rpt/reporting-remediation` (`field-ops-app-vite/src/domain/reporting/reportRunOutcome.js:25`, `field-ops-app-vite/test/reportOutcomeContractRatchet.test.mjs:13`, `:140`). At the baseline the client has a **five**-member `SERVICE_KINDS` set (`reportRunOutcome.js:13`) and an unrecognised kind fails closed to `reportRunFailure()` (`:43`) — whose copy is *"Something went wrong running this report. Try again in a moment."*, which asserts something the client cannot know under version skew. The invariant is worth adopting; it must be described as **branch-only**, and this entry does so (§6). |
| C3 | "the seven provenance fields from #1" | **#1 enumerates five.** This entry uses seven, adding **computation site** and **drill path**, and says so rather than renumbering silently — five fields cannot settle accountability, because two numbers with identical sources and filters still disagree if they are computed in different places or if only one can be opened. §3.1. |
| C4 | "Reporting is the ONE domain with production activations … which makes KPI/reporting the **only** place drill-through could be live" | **Correct about activation, incomplete about drill-through.** Reporting is indeed the only *capability-activated* family. But the drill-through *problem* is live on ~40 non-reporting surfaces that need no capability activation because they read Firestore directly under a three-item role gate (`domain/constants.js:374-378`) — and that is where the 18 duplications live (§4), where the only publicly-served KPI lives (§2.1), and where the only surface that gets drill-through right lives (`MetricStrip.jsx:3-14`). **Reporting is where drill-through is most *governed*; it is not where it is most *present*.** |
| C5 | The framing that authority-consistency (#4) "is not an edge case — it is the normal case today" | **Correct, and understated.** It is not merely normal, it is **already implemented, unconditionally, without a decision having been taken**: `countRows` is returned to a caller holding zero field capabilities (`reportExecutionService.ts:486`, `:750`). Option (b) of #4 is the status quo by default. §5 R-K4. |
| C6 | "If EOS displays **no** KPI at your baseline, say that plainly" | Does not arise — EOS displays roughly 95 figures across roughly 40 surfaces, plus four on the public internet. **No inventory was manufactured; the reverse risk was the real one**, and §2.2 deliberately declines to claim a total (U8). |

### 10.3 In-repo statements this entry records as false or vacuous at `64008d5a`

Recorded, not fixed — this lane's allowed surface is this file only.

| Location | The problem |
|---|---|
| `functions/src/index.ts:173-182` | Claims the report callable is not deployed to production, that the client seam is unconditionally unavailable, and that no Role grant exists for any `report.*`. All three false. |
| `functions/src/reporting/reportExecutionService.ts:22-28` | "every real call today resolves every `report.*` capability to DENY". False in production. |
| `functions/src/reporting/runReportDefinitionCallable.ts:9-15` | "NOT WIRED to any client". False. |
| `field-ops-app-vite/src/domain/reporting/reportExecutionSeam.js:10-14` | Describes the seam as resolving unconditionally to `unavailable`. False (also found by `ENG-IMPL-001` §1.5). |
| `functions/test/reportingActivationBoundary.test.mjs:77-79`, `:91-92`, `:116`, `:147` | **A vacuous guard.** Asserts production is fail-closed for all 39 `report.*`, **passes**, and is false — it resolves through the non-production authority (`:354`). Its header at `:5` states the same false conclusion. |
| `functions/src/access/permissionCatalog.ts:637-638` | Stale comment: *"Every other wave-1 field/object id is `active: true`"*. None is. (Also recorded by `ENG-IMPL-001` §1.4.) |
| `field-ops-app-vite/src/access/reportAccess.js:3` | "These four wave-1 object-read capabilities are the ones D-226 registered **active**". They are `active: false`; they are *production-activated*, which is a different mechanism. |
| `field-ops-app-vite/src/access/reportAccess.js:31` | "Mirrors `permissionCatalog.ts`'s `report.definition.*` ids (**all active**)". None is active; and production activates only `report.definition.read`, so the four mutation buttons this file gates can never succeed in production. |
| `field-ops-app-vite/src/modules/registry/moduleRegistry.ts:59-65` | Declares a `KPIs` screen that does not exist, in a file with zero importers. The only place in EOS where "KPIs" is a named surface. |
| `field-ops-app-vite/src/modules/administration/AdminRolesPermissions.jsx` + `AdministrationUnavailable.jsx` | Stale "backend is not yet deployed and verified" copy, already recorded as needing correction at `docs/deployment/w3-receiving-activation-closure.md:110-118` and still shipping. |

---

## 11. The plain answer

**Can a person reach the rows behind a number EOS shows them?**

On **one** surface, by design and by a stated rule: Service Operations' metric strip, where every number
links and every exception count anchors to the section holding its rows
(`field-ops-app-vite/src/modules/controlTower/panels/MetricStrip.jsx:3-14`). On the finance slots and the
AR strip, yes. On the default dashboard, **no** — not one tile is clickable. On the reporting engine —
the only family with production capability activation, the only one with an audit trail, and the only
one a person would call a KPI tool — **no, and not merely because the affordance is missing: an
aggregate run returns `rows: null` by construction, so the rows have never travelled with the number at
all.** On the public internet, four tiles labelled "Live status" show hard-coded constants over a
collection every read of which is denied, with the failure recorded in a variable nothing renders.

And where the rows *can* be reached, the number and the rows are usually computed by different code:
**22 aggregate/detail pairs located, 18 of them duplications**, three of them in files whose own headers
were written to prevent exactly this.

The contract in §5 is not imported from outside EOS. Eight places in this codebase already honour it,
and one of them states it better than this entry does. The engineering implication is that it should be
a rule rather than a habit — and that the rule's first requirement, for the one KPI surface that is
production-live, is that an aggregate and its rows be able to exist in the same answer.

---

**IMPLEMENTATION STATUS: NOT AUTHORIZED.** No code, schema, activation, grant or deploy is authorized
by this entry.
