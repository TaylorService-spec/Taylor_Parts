# Historic Claude Design archaeology — Sales · CRM · Financials · Reporting · Administration

**Lane:** P3-A3 (Wave 2 overnight programme) · **Base:** integrated head `d104cf49` (32 Wave-1 lanes + the `eos_finance` ruling `8dfcd006`)
**Method:** recover first, reconcile second. Every existence claim carries a `path:line` or a commit SHA. Anything I could not prove is marked **UNPROVEN**.
**Authority:** none. This document changes no runtime code, grants no capability, and authorises no implementation. Where a recovered design implies a capability that does not exist, the disposition is `AUTHORITY GAP` — never an instruction to create it.

---

## 0. How to read this

Each surface is recorded in the programme's required shape:

> **PAGE / ROUTE** → **ORIGINAL CLAUDE DESIGN** → **WHAT ACTUALLY GOT BUILT** → **CURRENT EOS AUTHORITY** → **NEW OPPORTUNITIES** → **SCENARIO / OPERATIONAL QUESTIONS** → **DESIGN P2 DISPOSITION**

The dispositions are `KEEP` · `IMPROVE` · `REPLACE` · `REMOVE` · `ADD` · `PRODUCT GAP` · `WORKFLOW GAP` · `AUTHORITY GAP` · `UNKNOWN`.

**A route that renders over an inert capability is never `KEEP`.** Nine of the twenty-four surfaces below render beautifully over a capability that is `active: false` or over a command that is exported and undeployed. Those are `WORKFLOW GAP` or `AUTHORITY GAP`, and the fact that the page is finished is not a mitigation — it is the hazard, because a finished page is the thing that gets demoed.

---

## 1. THE RECOVERY — what was found, and where it had been

### 1.1 Provenance classes

| Class | Count | What it means |
|---|---|---|
| **Present in the current tree** | 120+ documents + 32 `.dc.html` artifacts + 44 acceptance PNGs | Recovered earlier by other passes and committed. |
| **Present only in git history / on an unmerged branch** | 2 design documents | Written, committed to a branch, never reached `d104cf49`. |
| **Cited by merged work but NEVER in this repository** | **20 `.dc.html` artifacts** | The original Claude Design pilot corpus. This is the single largest recovery finding in this lane. |
| **Deleted implementation files with design intent attached** | 7 source files | Removed; the design question they answered mostly survived them. |

### 1.2 The twenty artifacts that were never handed over

`docs/design/eos-north-star-sources.md:88-111` is a register of the recovered Claude Design package. It names 27 HTML files. **Only the ones later re-delivered as per-family packages are in the repository.** The register itself says so at `docs/design/eos-north-star-sources.md:249-253`:

> "The recovered package is **not** committed to this repository — it contains a full third-party design system and image assets… If the package is needed again it should be attached to the Owner decision record rather than vendored here."

I compared every `.dc.html` filename cited anywhere in `docs/` against every `.dc.html` on disk. The following are **cited and absent**, verified absent from *all* branches (`git log --all --name-only` returns zero matches for any of them):

| Missing artifact | Surface it governs | Cited at | Consequence for my domain |
|---|---|---|---|
| `EOS UX Pilot.dc.html` | The pilot report: audits five canonical surfaces, names the **eight-pattern design language**, scores each page, lists the governance findings that bound what design can achieve | `docs/design/eos-north-star-sources.md:94` | The scoring rubric and the eight patterns exist only as prose summary. **The original audit of the five surfaces is unrecoverable.** |
| `North Star - Subpage Expansion.dc.html` | Tests the language across **~46 destinations**; establishes the **ten page archetypes**, the **AI continuity model**, four design-system adjustments, and the **P0–P3 migration order** | `docs/design/eos-north-star-sources.md:95` | This is the only artifact that ever covered Reporting and Administration destinations. Its AI continuity model is the earliest recorded assistant/intelligence design in the programme and survives nowhere else. |
| `Proposed - Account.dc.html` | Customer 360 — "Ceiling set by capability activation" | `docs/design/eos-north-star-sources.md:103` | The first Account design. Never seen; family 3 was built from the grammar instead. |
| `North Star - Account P1.dc.html` | The **approved** Account record visual authority (1a 1440 / 1b 768 / 1c 375) | `docs/design/north-star-migration-ledger.md:130,175,180`; `docs/DECISIONS.md:2168` | **The Account record page's approved visual authority is not in this repository.** Family 3 was reconciled against it in a session that could read it; nobody can re-run that comparison now. |
| `Proposed - Account -Broadsheet-.dc.html` | The broadsheet styling experiment | `docs/design/eos-north-star-sources.md:238` | Exploratory; low loss. |
| `Proposed - Sales Order.dc.html` | Sales Order detail (Pilot 2) | `docs/design/eos-north-star-sources.md:102` | Register says **"NEVER HANDED TO THIS REPOSITORY… If this artifact exists, it has not been seen here."** Family 2 was migrated from the grammar, "which makes Owner visual acceptance load-bearing rather than confirmatory (DECISIONS #125)". |
| `Proposed - Opportunity.dc.html` | Opportunity detail | `docs/design/eos-north-star-sources.md:104` | Superseded by P1v2, which *is* present. Low loss. |
| `Subpages - Commercial.dc.html` | **Sales Agreement edit / accepted / states — "Hardest commercial surface"** | `docs/design/eos-north-star-sources.md:109` | Superseded for the *record* surface by Sales Agreement P1v2. The register is explicit: **"Whatever else this artifact covers has not been seen here."** The edit surface and the state set beyond the record are lost. |
| `Subpages - Lists and States.dc.html` | A **142-row list + 12 honest states** — "the density floor and the state vocabulary" | `docs/design/eos-north-star-sources.md:111` | Lists P2 (present) extracts the grammar, but the original density floor specimen is gone. |
| `Subpages - Operations.dc.html` | Receiving, scheduling, exception, **balances** | `docs/design/eos-north-star-sources.md:110` | The "balances" treatment is the earliest financial-surface design and is unrecoverable. |
| `Proposed - Work Order.dc.html`, `Proposed - Parts.dc.html`, `Proposed - Dispatch Board.dc.html`, `Proposed - Dispatch Map.html`, `Proposed - Technician Mobile.dc.html`, `Proposed - Warehouse Mobile.dc.html` | Out of this lane's domain | `docs/design/eos-north-star-sources.md:101-108` | Recorded for the coordinator; sibling lanes own them. |
| `1–5 * Before-After.dc.html` (5 files), `Current - *.dc.html` | Current-state recreations + severity-graded audits of each pilot surface | `docs/design/eos-north-star-sources.md:227-229` | **The severity-graded audit of the then-current Customers, Sales Order and Account surfaces is lost.** This was the only document that scored what existed against what was proposed. |

> **Recovery judgement.** `docs/north-star/opportunity/README.md:16-24` records that this exact failure already happened once: *"until 2026-08-26 they were in exactly the position it warns about: recovered once from a `.zip` in a Downloads folder, listed in a register, and present in no repository. A `find` for `*.dc.html` across this tree returned nothing. **Three page families were built without ever seeing their design source because of it.**"* The remedy applied was per-family: each family's package is committed when that family is designed. The twenty artifacts above are the ones no family pass has claimed, so the remedy has not reached them. **This is not a closed problem; it is an open one that has been narrowed.**

### 1.3 Two design documents that exist only on unmerged branches

| Document | Branch/commit | Why it matters |
|---|---|---|
| `docs/design/card-composition-recovery-audit.md` | added in `37af5dd2`, *"docs(design): site-wide card & composition recovery — repository-wide audit (read-only)"* — **not an ancestor of `d104cf49`** | A repository-wide card/composition audit. Site-wide, therefore covers my domain's surfaces. Not on the integrated head. |
| `docs/design/receiving-north-star-composition-map.md` | added in `cd885d6b` — **not an ancestor of `d104cf49`** | Out of domain (Receiving), recorded for the coordinator. |

### 1.4 Deleted implementation files carrying design decisions

Verified via `git log --all --diff-filter=D --name-only`:

| Deleted file | What it was |
|---|---|
| `field-ops-app-vite/src/modules/administration/EmployeesList.jsx` | The Employees index (61 LOC, `MetadataListGrid` + `WorkspaceShell` only, **no record route**) — `docs/north-star/lists/LISTS-P2-RECONCILIATION.md:A` inventory row. |
| `field-ops-app-vite/src/modules/administration/RoleObjectGrid.jsx` | The Role × Object CRED grid — the Administration screen the policy work is built around. |
| `field-ops-app-vite/src/domain/customers.js` | The pre-Account customer domain module. |
| `field-ops-app-vite/src/domain/reporting/savedReportStore.js` | **The saved-report store.** Its removal is load-bearing for the saved-definition question below. |
| `field-ops-app-vite/src/domains/analytics/AnalyticsDashboard.jsx` | The first analytics dashboard. |
| `field-ops-app-vite/src/hooks/useSalesOrderIndex.js` + `src/services/salesOrderIndexReadCallableClient.js` | The Sales Order index read seam, folded into the metadata runtime. |

### 1.5 The recovered historical wireframe — the largest single body of unbuilt design

`docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md` (2,228 lines) is itself a recovery: `:21-23` — *"This document was recovered from a stale local checkout, where it existed only on one machine. It was never on `origin/main`, yet [a merged review] cites it as `design_input`… That citation pointed at a file no other session could read."*

Its disposition table (`:29-34`) classifies its own sections:

- **CONSUMED** — §3.3 line-of-business distinction, §3.8 Account line-of-business relationship (built in wave W1).
- **NOT BUILT** — §3.1-3.2, §3.4-3.7 (operating-company models, intercompany flows, Ventana external sales, Controller ownership override); §4.0-4.4 (access modality, the **signature ladder**, templates **T1 Quote / T2 Sales Order / T3 Pick Ticket / T4 Service Invoice**).
- **OPEN** — §5 gap register (**G1–G56**), §6 sequencing, §7 Owner questions.

Its executive finding (`:84-90`) is the blunt one: of the fields on four real Taylor operating documents, **~24 have a real system home, ~6 have a specified-but-unbuilt home, and ~70 have no home at all** — pricing, tax, labor/travel billing, warranty, serialized equipment, sales orders, quotes, invoices, pick tickets, national-account routing.

---

## 2. A MEASUREMENT TRAP, RECORDED BEFORE ANY DISPOSITION DEPENDS ON IT

Two contradictory facts reached this lane about capability grants. Both were tested here, and **the resolution changes how several dispositions below must be read.**

**What I measured directly.**

| Measurement | Value | Evidence |
|---|---|---|
| Capability ids in the catalog | **147** | `functions/src/access/permissionCatalog.ts` — `grep -c '^\s*id: "'` |
| Ids carrying `active: false` **as a property** | **109** | `grep -cE '^\s*active: false,?\s*$'` |
| Ids that are active (`active: true`, or the flag omitted) | **38** | 147 − 109 |
| Governed business Roles | **45** | `functions/src/access/governedBusinessRoles.ts` |
| Compatibility Roles | **3** (`admin`, `dispatcher`, `technician`) | `functions/src/access/compatibilityRoles.ts:247,265,292` |

> **I corrected myself here.** My first measurement was `grep -c 'active: false'` = **119**. Ten of those hits are comment prose, not property lines (`permissionCatalog.ts:396, 636, 1051, 1112, 1132, 1158, 1185, 1218, 1250, 1380`). The property count is **109**. A raw grep over a file that discusses its own flags in comments over-counts, and 119 would have been wrong in this document the way five sibling summaries have already been wrong in this programme.

So **74% of the catalog (109 of 147) is registered inactive.** That is the real shape of the platform, and it is the shape every disposition below has to respect.

**The trap.** I grepped the Role catalogs for `coverage.read` / `coverage.write` — the Sales Territory capabilities — and found **zero literal occurrences** in either `governedBusinessRoles.ts` or `compatibilityRoles.ts`. That reads as "granted to no Role". **It is wrong.**

`functions/src/access/compatibilityRoles.ts:235-240`:

```ts
const ADMIN_ALL_PERMISSIONS = [
  ...ADMIN_CURATED_PERMISSIONS,
  ...PERMISSION_CATALOG.map((permission) => permission.id).filter(
    (id) => !ADMIN_CURATED_PERMISSIONS.includes(id),
  ),
];
```

The compatibility `admin` Role's permission list is **derived from the entire catalog**, so admin holds every one of the 147 ids including `coverage.*`. A grep over Role sources cannot see that. Only `admin` derives this way — `dispatcher` and `technician` do not (`PERMISSION_CATALOG.map` appears once in the file, at `:237`).

**This is the same trap that produced a withdrawn finding once already.** `docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md:705-709`:

> "The census finding that no Role carried a `finance.visibility.*` scope was **WITHDRAWN** (#1743): it was measured by grepping Role sources, which cannot see `admin`'s derived grants. Measured by resolver, admin and owner carry all five scopes."

**Binding rule for this document, and for any lane reading it:** *"no Role holds capability X"* is not a claim any grep can support. **No disposition below is justified on ungranted-ness.** What actually denies in this codebase is:

1. `active: false` in the catalog — the blanket gate; and
2. absence from the per-environment activation set — `functions/src/access/environmentCapabilityOverrides.ts`, whose `SPINE_OVERRIDE_ELIGIBLE_IDS` (`:79`) is intersected with any override so a careless config edit cannot sweep in an unrelated inactive id, and whose production path returns an empty set unconditionally on `role === "production"`; and
3. EXPORT ≠ DEPLOY — a callable exported from `functions/src/index.ts` is not thereby a deployed function.

Verified corollary for my domain: `finance.*` **is** granted (`functions/src/access/governedBusinessRoles.ts:174,229,255,278,285,369,375,438,440,447,519,664,666,671,816,817,862` — a salesManager gets `finance.visibility.team`, a salesperson `finance.visibility.self`, the money-manager set `finance.visibility.consolidated`). All of it is nonetheless `active: false` (`functions/src/access/permissionCatalog.ts:278-368`). **Grant was never the blocker. Activation is.**

---

## 3. SALES

### 3.1 `/customers/opportunities` — Opportunity collection

**ORIGINAL CLAUDE DESIGN** — `docs/north-star/opportunity/Opportunity-North-Star-List-P1v4.dc.html` (present), handoff `docs/north-star/opportunity/DESIGN-HANDOFF-LIST-P1v4.md`, reconciliation `docs/north-star/opportunity/README.md:73-155`.

- *Primary question:* which deals need me today, and which close soonest.
- *Facts shown:* governed reference + `need` as identity (there is no Opportunity Name field — G1); customer name; owner; channel; stage ordinal `n of 6`; attention; expected close; `expectedValue` as a **bare number with no currency symbol** (G5 — `expectedValue` has no governed currency); agreement/order lineage.
- *Proposed actions:* Create opportunity; `+ Save as view`; `Columns`; sort control; pagination `1–41 of 41 · 59 total`; `Updated moments ago · Refresh`.
- *Workflow:* attention-first ordering, then closing-soonest — a governed derivation, not a user sort.
- *Composition:* `WorkspaceIdentity` header (crumb, thick-thin rule pair, serif title, governed count, workload summary, action slot) → views radiogroup → search → result context → rows → record route.
- *Mobile:* 1440 → 1024 → 768 → 375 → 320 at **real container widths** (nav consumes 248–252px). Tablet **drops** columns in reverse row-priority rather than folding them into the identity cell.
- *Intelligence:* `deriveAttention` — four reasons, `CLOSE_SOON` at **seven** days (the artifact's "9 days" strip is illustrative, not a rule).
- *Exception handling:* seventeen distinct page states (`docs/north-star/lists/DESIGN-HANDOFF-LISTS-P2.md`, correction 10) — `IDLE ≠ LOADING`, `NOT ENABLED ≠ DENIED ≠ UNKNOWN`, seven distinct empties.
- *Suggested new capability:* user-created saved views (needs a user-scoped list-state write and read path).
- *Unresolved gaps:* G2 (agreement reference not on the list read), G4 (customer name resolution), G5 (currency).

**WHAT ACTUALLY GOT BUILT** — **implemented, with four documented deferrals and one Owner-ruled departure.**

- `field-ops-app-vite/src/modules/sales/OpportunityList.jsx` (543 lines) over `src/domain/opportunityListView.js`, view engine `src/domain/opportunityLifecycle.js`, header `src/shared/ui/WorkspaceIdentity.jsx`. Route generated from `field-ops-app-vite/src/navigation/navConfig.js:119` via `field-ops-app-vite/src/App.jsx:431-432,871-882`.
- **G2 resolved further than the design expected** — `docs/north-star/opportunity/README.md:80-93`. `projectOpportunity` is shared by the list read and the per-id read and *does* return `salesAgreementId` / `salesOrderId`, so existence is knowable at list level for free. It returns neither *reference* nor *state*, so the column states existence and stops: `Agreement` / `Order created` / `No agreement` / `Order not created`. Rendering a document id as a label is forbidden (DECISIONS #106). Per-row resolution is explicitly forbidden — *"one round trip per visible opportunity on a scanning surface"* — and a test renders 25 rows and asserts the governed source was invoked **once**.
- **Owner-ruled departure (DECISIONS #136).** P1v4's 768 frame folds owner/channel/attention into the identity cell. Built that way, rendered against the artifact, rejected on sight: *"the middle one goes into detail that consumes more space."* Tablet now **drops** channel and stage ordinal; rows 58px against desktop's 56 (they were 68). Attention keeps its own column at every width, *"because it is the reason to open a row."*
- **Deferred with reasons, not silently dropped** (`README.md:104-118`): `+ Save as view` (needs new user-scoped persistence authority); sort + `Columns` (*"Offering an arbitrary column sort would quietly replace the queue's meaning with a spreadsheet's"*); pagination (*"the governed read is not paged"*); `Updated moments ago` (*"a relative time the page invents is exactly the class of fabrication this family keeps finding"*).
- P1v3 — a revision of the master-detail workspace — was **abandoned without ever being built**; two pipeline views (`NEEDS_ATTENTION`, `AT_DECISION`) were lifted from it and nothing else merged (`README.md:40-49`).

**CURRENT EOS AUTHORITY**

| | |
|---|---|
| Object | `opportunities`, **Admin-SDK-only**, client deny-all — `firestore.rules:1740-1742` |
| Read command | `listOpportunityContext` (`functions/src/index.ts:56`), capability `opportunity.read` |
| Write commands | `createOpportunity` / `transitionOpportunity` / `updateOpportunity` (`functions/src/index.ts:42`), capability `opportunity.write` |
| Capabilities | `opportunity.read` (`permissionCatalog.ts:172`, **`active:false`**), `opportunity.write` (`:160`, **`active:false`**), `opportunity.createSalesOrder` (`:184`, **`active:false`**) |
| State machine | `functions/src/opportunity/opportunityLifecycle.ts:11,21,52,72` — `IDENTIFIED → QUALIFYING → SOLUTION → QUOTING → CUSTOMER_REVIEW → DECISION`; `LOST` from any open stage, `WON` only from `DECISION`; client mirror `field-ops-app-vite/src/domain/opportunityLifecycle.js:8` |
| Route guard | **None.** `navConfig.js:119` declares no `capabilityAccess` and no `legacyKey`, so it falls to `PLACEHOLDER_DEFAULT_ROLES = ["admin","dispatcher"]` (`navConfig.js:49,685`). Authority is entirely server-side. |
| Operating company | **Absent.** No `operatingCompanyId` on the Opportunity projection. |
| PostgreSQL | `functions/migrations/1758844800000_commercial-ownership-authority.sql:177` creates `opportunities`. The repository (`functions/src/eosCommercial/commercialOwnershipRepository.ts`) is imported **only by tests**. Not the system of record. |
| Firebase dependency | **Total.** Firestore is the sole authority. |

**NEW OPPORTUNITIES**
1. `salesAgreementNumber` / `salesOrderNumber` on the list projection closes G2 completely — a read change, one denormalisation or one batched resolve, not a presentation change.
2. A governed currency on `expectedValue` closes G5 and lets the pipeline state money at all.
3. User-scoped saved views would let the `+ Save as view` affordance ship as designed rather than as a named absence.

**SCENARIO / OPERATIONAL QUESTIONS**
- A salesperson with `opportunity.read` active in sandbox opens this page. Every row is visible regardless of owner. **Is a salesperson supposed to see the whole firm's pipeline?** `docs/north-star/financials/pages/08-sales-to-goal.md` insists *"Person rows only within viewer scope; attribution strictly creditedSalespersonId."* There is no such scope on this list. **UNPROVEN** whether any scoping is intended here.
- Taylor and Ventana opportunities appear in one undimensioned list. The same defect Wave 1 fixed for AR is present, unfixed, here.

**DESIGN P2 DISPOSITION:** **`WORKFLOW GAP`** — the composition is accepted and correct, and `opportunity.read`/`opportunity.write` are both `active:false` in the catalog, so the page is a truthful rendering of a pipeline nobody can operate outside a sandbox override. Sub-dispositions: existence-only relationship column `KEEP`; `+ Save as view` / sort / `Columns` / pagination / freshness `PRODUCT GAP` (each named, each needs authority); viewer scoping `AUTHORITY GAP`; operating-company dimension `ADD`.

### 3.2 `/customers/opportunities/:opportunityId` — Opportunity record

**ORIGINAL CLAUDE DESIGN** — `Opportunity-North-Star-P1v2.dc.html` (present) + `DESIGN-HANDOFF-P1v2.md`. P1v2 supersedes P1v1 by adding the Sales Agreement relationship: a main-column section, a header fact, a mobile row, the agreement states, and decision O6. The superseded `Proposed - Opportunity.dc.html` is **absent from the repository** (`docs/design/eos-north-star-sources.md:104`); its note *"requires a per-record route"* was answered — route and governed per-id read both shipped.

**WHAT ACTUALLY GOT BUILT** — **implemented, one structural deviation left open for Owner rejection.**
`field-ops-app-vite/src/modules/sales/OpportunityDetail.jsx` (517) over `src/domain/opportunityNorthStar.js`, agreement card `OpportunityAgreementCard.jsx` (221), editable sections `opportunitySections.jsx` (298) over `src/domain/opportunityFieldModel.js`, lifecycle control `OpportunityLifecycleControl.jsx` (163). Route `field-ops-app-vite/src/App.jsx:978`.

- **Deviation (`docs/north-star/opportunity/README.md:143-148`):** P1v2 draws Solution as a three-column table (Line / Kind / Qty); the implementation renders the shared `LineSummary` list, because that renderer also serves a ~340px column. *"Owner may reject this deviation, in which case the shared renderer gains a table layout rather than the page forking its own."* — **still open.**
- **ND-12 (Opportunity records no stage times) was WITHDRAWN 2026-08-26** — the design did not ask for stage times (`docs/design/north-star-open-product-decisions.md:297`).
- **ND-13 RESOLVED 2026-08-27: the master-detail pane is retired** (`:315`). The retired `SalesWorkspace.jsx` (556 lines) **is still in the tree and mounted by no route** — that is **ND-17**, open (`:351`).

**CURRENT EOS AUTHORITY** — as §3.1, plus `getOpportunityContext` (`functions/src/index.ts:61`) and `closeOpportunityAsWon` (`:67`, the atomic WON + Sales Order command). Editing seam `field-ops-app-vite/src/access/opportunityCapabilityAccess.js:34-37` resolves `opportunity.write` **and all four `salesAgreement.*` ids in one request**, fail-closed.

**NEW OPPORTUNITIES** — Owner ruling on the `LineSummary`-vs-table deviation; deletion of the unrouted `SalesWorkspace.jsx` (ND-17).

**SCENARIO / OPERATIONAL QUESTIONS** — `closeOpportunityAsWon` is atomic across two authorities. What does a salesperson see when the Opportunity is `WON` but agreement conversion refused? The refusal order is governed (`functions/src/salesAgreement/agreementToSalesOrder.ts` — agreement exists → `sourceOpportunityId` matches → `accountId` matches → state `ACCEPTED` → has lines), but **UNPROVEN** whether the page renders each refusal distinctly.

**DESIGN P2 DISPOSITION:** **`WORKFLOW GAP`** (`opportunity.write` inactive). Composition `KEEP`. `SalesWorkspace.jsx` `REMOVE` (ND-17). Solution table deviation `UNKNOWN` pending Owner.

### 3.3 `/customers/opportunities/sales-agreement/:salesAgreementId` — Sales Agreement record

**ORIGINAL CLAUDE DESIGN** — `docs/north-star/sales-agreement/North Star - Sales Agreement P1v2.dc.html` + `README.md` (528 lines). **The first family designed against verified repository truth rather than against a brief** (`docs/design/eos-north-star-sources.md:239-247`).

Twelve design decisions SA-D1…SA-D12. The load-bearing ones:
- **SA-D2 — no LifecycleBand.** `DRAFT → ACCEPTED | DECLINED` is a gate with terminal outcomes, not a progression; *"chevrons would manufacture a journey."*
- **SA-D3 — a draft with an unpriced line claims no subtotal, total or balance:** *"Incomplete — 1 line has no price"*, **never a partial sum, never `$0.00`.**
- **SA-D7 — the acceptance-evidence rule, binding on any implementation.** EOS proves exactly three things: state is `ACCEPTED`, `acceptedAtMillis` (server clock), `acceptedByUid`. **Forbidden vocabulary unless new governed evidence exists:** *binding · the customer accepted · signed · electronically accepted · e-signature*. A whole-artifact copy sweep removed every P1v1 occurrence.
- **SA-D8 — the two-block money ladder.** Sale composition (subtotal → shipping → installation → tax → **Total committed**), then, indented behind a left rule one step smaller, *Credits recorded at commitment* → Balance after credits, *"the agreement's own arithmetic and **not** an accounts-receivable balance."*
- **SA-D11 — state × permission never collapse.** `ACCEPTED` shows **no edit affordance at all** (absent, not disabled — the engine forbids editing a terminal record); a permission refusal is a *different* sentence: *"You do not have permission to accept Sales Agreements."*
- **SA-D12 — deliberately absent:** no AI panel, no risk/health score, no approval workflow, no e-signature or send-to-customer, no Presented/Rejected/Superseded/Expired/Void states, no discount/margin/cost/commission, no tax-calculation UI, no FX selection, no payment schedule, no PDF generation.

**WHAT ACTUALLY GOT BUILT** — **implemented as a first-class routed record page** (SA-G1 closed by Owner direction 2026-08-26). `field-ops-app-vite/src/modules/sales/SalesAgreementDetail.jsx` (645), lines `salesAgreementLines.jsx` (126), picker `ProductReferencePicker.jsx` (195). Route `field-ops-app-vite/src/App.jsx:970`. The by-id read already existed (`getSalesAgreementContext`), so this was *"a routing and navigation question, not a data question."*

**Built to `252 / 340 / 56`, not to the artifact's `300 / 820 / 40`** — Owner ruling 2026-08-26, ND-16: the new family matches the four already shipped; whether the shared grammar should move toward the artifact's proportions is the open half of ND-16 (`docs/design/north-star-open-product-decisions.md:431`).

**CURRENT EOS AUTHORITY**

| | |
|---|---|
| Object | `sales_agreements`, Admin-SDK-only — `firestore.rules:1794-1796` |
| Commands | `createSalesAgreement` / `updateSalesAgreementDraft` / `acceptSalesAgreement` (`functions/src/index.ts:74`); reads `getSalesAgreementContext` / `getSalesAgreementForOpportunity` (`:75`) |
| Capabilities | `salesAgreement.create` (`permissionCatalog.ts:199`), `.updateDraft` (`:207`), `.accept` (`:215`), `.read` (`:223`) — **all four `active:false`** |
| State machine | `functions/src/salesAgreement/salesAgreementLifecycle.ts:43` — `DRAFT | ACCEPTED | DECLINED`; `checkAgreementTransition` (`:81`) refuses any move out of a terminal state and any move back to `DRAFT` |
| Numbering | `SA-YYYY-######` from counter `sales_agreements_YYYY`, allocated once, immutable, never derived from a document id |
| One-per-Opportunity | In-transaction duplicate check refuses a second agreement |
| PostgreSQL | `functions/migrations/1758844800000_commercial-ownership-authority.sql:202` — schema only, test-only repository |

**Seven named product gaps, all still gaps:**

| Gap | Content | State |
|---|---|---|
| SA-G1 | Standalone routed record page | **RESOLVED and built** |
| SA-G2 | External/customer presentation and acceptance evidence — EOS holds no signature, no sent/viewed/presented evidence, no customer-facing surface | **OPEN**, deliberately not designed |
| SA-G3 | Agreement list / workspace / index read — only by-opportunity and by-id reads exist | **OPEN**; the collection was then **retired by ruling**, not built (`docs/north-star/lists/LISTS-P2-COLLECTION-DISPOSITION.md:246-249` — Option B, reclassified EXEMPT) |
| SA-G4 | Line display-name resolution — a line stores `ref` and no durable display name; the picker's `displayName` exists only at pick time. **"A duplicate display name must not be persisted onto the line to satisfy the mock."** | **OPEN** (honest fallback shipping: the reference is the identity, a resolved name is muted and daggered) |
| SA-G5 | `DECLINED` is modelled, its transition is legal, its label exists — **and no command produces it.** Ruling (ND-14, DECISIONS #134): **no decline command is to be created and Decline is never shown as an available action** | **RULED — permanently unreachable by design** |
| SA-G6 | No post-acceptance revision path. `ACCEPTED`/`DECLINED` cannot be edited and a second agreement is transactionally refused, so **EOS has no governed path for changing commercial commitment after terminal acceptance.** P1v1's *"a changed mind is a new agreement"* was removed as unsupported. **Do not invent revise / supersede / duplicate / reopen** | **OPEN (ND-15)** |
| SA-G7 | Line pricing is not on the record page — the Draft editor covers six scalar terms and does not price lines, so an acceptance blocked by an unpriced line **cannot be cleared from this page.** `SalesAgreementPanel` in the Opportunity workspace ships a full line editor and remains mounted. *"Two surfaces, one record, one editor."* | **OPEN — found during implementation, PR 4** |

**Honest unknowns carried by the design itself:** account/location display names (the projection carries ids); owner name resolution states; `installChargeMinor` 0-vs-null indistinguishable in the projection; `condition`/`warranty` value vocabulary (`AGREEMENT_LINE_CONDITIONS` is `NEW | USED`, the source marks itself `ARTIFACT_DETAIL_PENDING`, the projection stores free strings).

**A stale comment the design pass flagged rather than fixed:** `field-ops-app-vite/src/hooks/useSalesAgreement.js` still says the capability is granted in **no** environment; the override registry and `App.jsx` are current. Flagged in `docs/north-star/sales-agreement/README.md` — **unfixed at HEAD is UNPROVEN; I did not re-check the comment.**

**NEW OPPORTUNITIES**
1. **SA-G7 is the highest-value unbuilt item in Sales.** One record, two editors, and the only one that can unblock acceptance is on the retired-pane's surface. Either the record page gains per-line pricing or the panel is the agreement's editor — this cannot stay ambiguous.
2. SA-G6 — a governed revision path (supersede-with-lineage) is the difference between a system that records commercial commitment and one that can operate it. It must be designed, not improvised.
3. A catalogue read for SA-G4 that resolves names without persisting a duplicate onto the line.

**SCENARIO / OPERATIONAL QUESTIONS**
- A customer renegotiates after acceptance. Today there is **no governed action at all** — not edit, not a second agreement, not decline. What does the salesperson do? This is SA-G6 and it is a live operational hole, not a theoretical one.
- An agreement is drafted with one unpriced line. The record page shows the blocker naming the line and offers no way to clear it. The user must know to go to the Opportunity workspace panel. **That is a workflow the product never taught anyone.**

**DESIGN P2 DISPOSITION:** **`WORKFLOW GAP`** — a finished, carefully-reasoned record page over four `active:false` capabilities, with SA-G7 making the page unable to complete its own primary workflow even when activated. Composition and copy discipline `KEEP` (this is the strongest design artifact in the domain). SA-G6 `PRODUCT GAP`. SA-G7 `WORKFLOW GAP`. SA-G2 `PRODUCT GAP`. SA-G4 `IMPROVE`. SA-G5 `KEEP` (ruled: unreachable by design, and the state study says so).

### 3.4 `/customers/sales-orders` and `/customers/opportunities/sales-order/:salesOrderId` — Sales Order

**ORIGINAL CLAUDE DESIGN** — **the artifact was never handed over.** `docs/design/eos-north-star-sources.md:102`: *"`Proposed - Sales Order.dc.html` | Sales Order detail | Pilot 2. **NEVER HANDED TO THIS REPOSITORY.** The family was migrated 2026-08-26 from the ratified grammar and the shipped family-1 pattern instead, which makes Owner visual acceptance load-bearing rather than confirmatory (DECISIONS #125)."*

What design intent survives is second-hand: the ratified grammar, the family-1 (Work Order) pattern, and the three named decisions the migration surfaced.

**WHAT ACTUALLY GOT BUILT** — **implemented, with three honest departures from family 1**, each recorded rather than absorbed (`docs/design/north-star-migration-ledger.md:58-100`).

- List `field-ops-app-vite/src/modules/sales/SalesOrdersList.jsx` (225) via the metadata runtime over `listSalesOrderIndex`; record `SalesOrderDetail.jsx` (430) + `SalesOrderActions.jsx` (205) + `SalesOrderFulfillmentSection.jsx` (128). Routes `field-ops-app-vite/src/App.jsx:458-459,966`.
- **ND-8 — no lifecycle stage times.** `functions/src/salesOrder/salesOrderReadService.ts` projects `createdAt` and `updatedAt` and nothing else, *"because they are all the write path has ever written."* No `confirmedAt`, no `allocatedAt`, `fulfilledAt`, `closedAt` or `cancelledAt`. Shipped: the band keeps its structure, the Confirmed stage states its time from `createdAt`, every other stage states the absence in words and adds the quantity fact it can prove (*"2 of 3 lines allocated, 1 fully fulfilled"*). `updatedAt` renders **only** in the milestone list labelled "Last changed", *"because presenting it as a stage time would be a fabricated fact about a sale."* Asserted by `test/salesOrderNorthStar.test.mjs` ("only the Confirmed stage states a time").
- **ND-9 — a Sales Agreement has no resolvable reference.** `sourceAgreementId` is projected and carried; *"nothing anywhere resolves a Sales Agreement to a business reference."* The edge renders as UNRESOLVED naming the entity; the document id is not printed in either branch (DECISIONS #106, R03).
- **ND-10 — the page cannot claim to be live.** `useWorkOrder` is an `onSnapshot` subscription and family 1's live badge is true there. `useSalesOrder` is a **one-shot callable read with an explicit `refetch`**. Shipped: no live indicator; the utility line states *"Read once — refreshed when you act."* Asserted by `test/salesOrderNorthStarPage.test.jsx` ("the page does NOT claim to be live").

**CURRENT EOS AUTHORITY**

| | |
|---|---|
| Object | `sales_orders`, Admin-SDK-only — `firestore.rules:1749-1751` |
| Commands | `createSalesOrder` / `transitionSalesOrder` (`functions/src/index.ts:93`), `allocateSalesOrder` (`:95`), `createServiceForSalesOrder` (`:97`), `createSalesOrderFromOpportunity` (`:64`), `closeOpportunityAsWon` (`:67`); reads `getSalesOrderContext` / `listSalesOrdersForAccount` / `listSalesOrderIndex` (`:70`) |
| Capabilities | `salesOrder.read` (`permissionCatalog.ts:237`), `.write` (`:248`), `.fulfill` (`:259`), `.service` (`:270`) — **all four `active:false`** |
| State machine | `functions/src/salesOrder/salesOrderLifecycle.ts:9` — `CONFIRMED → IN_FULFILLMENT → FULFILLED → CLOSED`, plus `CANCELLED`; transitions `ADVANCE | CANCEL` (`:39,47`) |
| Operating company | **Absent from the Sales Order itself**; `issueInvoice` stamps `companyId` from the Sales Order's `operatingCompanyId` (`functions/src/finance/financeReadProjection.ts:20-24`), so the field exists upstream and is not surfaced here. |
| PostgreSQL | `functions/migrations/1758844800000_commercial-ownership-authority.sql:226` — schema only |

**A divergence with no recorded ruling.** `docs/assessments/sales-order-fulfillment-assessment.md:44` assessed the lifecycle as **`DRAFT → CONFIRMED → IN_FULFILLMENT → FULFILLED → CLOSED`, plus `CANCELLED`**. The shipped `SALES_ORDER_STATES` has **no `DRAFT`**. I found no decision record removing it. **UNPROVEN whether the removal was deliberate.**

**A second divergence, this one permitted.** The same assessment's ratified §9.1 named five commands (`createOpportunity` / `updateOpportunity` / `advanceOpportunityStage` / `closeOpportunityWon` / `closeOpportunityLost`); three shipped, with stage advance and both closes collapsed into `transitionOpportunity`. §9.1's own wording allows this ("not necessarily five Cloud Functions").

**NEW OPPORTUNITIES**
1. **Lifecycle stamps (ND-8) light up a band that is already built.** *"Answering it lights the existing band up with no further design work."* The question is behavioural — should Sales Order transitions record stamps the way Work Order transitions do — not compositional.
2. A governed Sales Agreement reference closes ND-9 and the Opportunity list's G2 with one change.
3. A subscription read closes ND-10 — *"a cost and authority question, not a design one. If it does, the badge returns with no other change."*

**SCENARIO / OPERATIONAL QUESTIONS**
- "When did this order enter fulfilment?" — **no surface can answer it today.** That is ND-8's real cost, and it is an operational question a dispatcher will ask on day one.
- `allocateSalesOrder` records allocation **entirely on `sales_orders`** (`docs/design/allocate-sales-order-cycle5.md:7-13`); inventory is a read-only availability source and the real reservation happens downstream at dispatch. Two commitments, one number: **what does a warehouse see when an order is allocated but nothing is reserved?**

**DESIGN P2 DISPOSITION:** **`WORKFLOW GAP`** — four `active:false` capabilities under a complete page. Composition `KEEP`. ND-8 stage stamps `ADD` (behavioural; the highest-value cheap win in Sales). ND-9 `PRODUCT GAP`. ND-10 `IMPROVE`. Missing `DRAFT` state `UNKNOWN` (undocumented divergence). Missing visual authority `PRODUCT GAP` — Owner visual acceptance is load-bearing here and cannot be discharged against an artifact nobody has.

### 3.5 Sales Territory / Coverage — built, registered, reachable by nobody

**ORIGINAL DESIGN** — `docs/architecture/customer-domain-foundation.md:379-401` (D-C1-6) reserved a nullable `territoryId` **on the Account** as *"descriptive metadata only… **not** an authorization boundary"*, explicitly proposed **no Territory entity or collection**, and deferred to ADR-005 the question of whether territory may ever scope reads/writes (D-C1-OPEN-d — **adopted NO**).

**WHAT GOT BUILT — something else.** A first-class `SalesTerritory` entity under a **Coverage** authority:
- `field-ops-app-vite/src/metadata/definitions/salesTerritory.js:91-98` — entity `salesTerritory` over collection `sales_territories`; registered `field-ops-app-vite/src/metadata/entityRegistry.js:46,78`.
- Commands `createSalesTerritory` / `createCoverageAssignment` (`functions/src/index.ts:113`), read `resolveCoverageForContext` (`:116`).
- Collections `sales_territories` (`firestore.rules:1832-1834`) and `commercial_coverage_assignments` (`:1835-1837`) — both Admin-SDK-only.

**CURRENT EOS AUTHORITY — the sharpest "built but not ownable" case in the domain.**

| | |
|---|---|
| Capabilities | `coverage.write` (`functions/src/access/permissionCatalog.ts:425`), `coverage.read` (`:436`) — **both `active:false`** |
| Grant | Held by compatibility `admin` **only by derivation** from the whole catalog (`functions/src/access/compatibilityRoles.ts:235-240`). No governed business Role names either id. |
| Sandbox activation | **Explicitly excluded.** `functions/src/access/environmentCapabilityOverrides.ts:33` names `coverage.*` among the ids that stay `active:false` **even in sandbox**, alongside `report.*`. |
| Own read | **None.** `field-ops-app-vite/src/metadata/definitions/salesTerritory.js:37` — *"NO CAPABILITY NAMES THIS COLLECTION'S OWN READ, BECAUSE NONE EXISTS."* `coverage.read` gates the coverage *resolver*, not a territory read. |
| Update path | **None.** `:74-75` — *"A GAP. `createSalesTerritory`'s own `tx.set` is the ONLY write this collection's one write path ever issues to a `sales_territories` document."* Create-only; no update, no retire. |
| Route | **None.** No territory route, no nav item, no screen. |
| Governance | `COVERAGE_TERRITORY_AUTHORITY_GAP` recorded **OPEN** — `functions/scripts/governance/effectiveAuthority.mjs:72`, `docs/governance/effective-authority.json:37-46` |

`docs/architecture/eos-admin-policy-workflow-reconciliation.md:366` lists **Sales Territory** among the thirteen entities that *"reached neither the policy model nor any Administration screen"* before the seed reconciliation — *"Nothing failed. No count looked wrong, because nobody was comparing the two lists — which is the defining shape of a silent omission."*

**DESIGN P2 DISPOSITION:** **`AUTHORITY GAP`.** A collection, an entity definition, two write commands and a resolver exist. There is no read capability for the object, no update command, no route, no activation path in any environment, and the only grant is a derivation artefact. **Sales Territory is real, built, and deliberately not ownable** — and the design that reserved it (D-C1-6) asked for a *field on the Account*, not this. Whether the Coverage entity supersedes D-C1-6 or duplicates it is **UNKNOWN and worth an Owner ruling before anything else is built on it.**
---

## 4. CRM — Customers · Accounts · Contacts · Locations

### 4.1 `/customers` — Accounts / Customers collection

**ORIGINAL CLAUDE DESIGN.** Two sources, one of which is missing.

- `Proposed - Account.dc.html` — *"Customer 360 | Ceiling set by capability activation"* (`docs/design/eos-north-star-sources.md:103`). **Absent from the repository.** Its one surviving note is the most prescient sentence in the register: the design already knew the surface's ceiling was activation, not composition.
- The built design authority is the structured-list work, `docs/architecture/customers-structured-list.md`: desktop columns `Customer · Status · Relationship · Line of Business · Owner · Tags · Created · Last update`; **phone recomposes each row into a labelled card**, never a run-together sentence — *"A responsive layout may rearrange fields; it may not destroy field semantics"* (`:142-168`); portfolio cards drive the same criteria the filter chips do *"so the two cannot disagree about what is applied"* (`:169-180`).
- The governing rule for counts: *"`0 Active` is a claim about the **business**; `—` is a claim about the **read**"* (`docs/north-star/lists/LISTS-VIEW-CHIP-ROLLOUT.md:56-63`) — three states (`undefined` / `null` / number), and *"an earlier cut of this work rendered `null` as nothing, which quietly demoted 'we could not count' into 'there is nothing to count'."*

**WHAT ACTUALLY GOT BUILT — implemented, and it is the strongest list in the domain.**
`field-ops-app-vite/src/modules/accounts/AccountsList.jsx` (418) over the metadata runtime + `getAccountPortfolioSummary` (server-side governed counts). Route generated from `navConfig.js:112`, dispatched `field-ops-app-vite/src/App.jsx:410-411`.

- Query contract: filters Status / Relationship / **Line of Business**; sorts Customer (`nameLower`) / Status / Created / Last update; default `updatedAt DESC` *"with its existing reason: name-ascending makes page one a permanent property of the alphabet"*; cursor paging `pageSize` 50, `limit` 51 (the +1 truncation probe); **index coverage 32/32**.
- **The two-array limit is refused at the plan, not at read time.** Firestore permits one array-contains-family constraint per query and no index changes that. A request naming both `relationshipTypes` and `lineOfBusiness` produced a descriptor that looked fine and would have failed at read. `MULTIPLE_ARRAY_FILTERS` refuses **whole**, never partially — *"applying one and dropping the other returns a broader set than was asked for, labelled as though both had been applied"* (`docs/architecture/customers-structured-list.md:103-121`).
- **Two defects found while migrating** (`:181-192`): the silent-truncation warning *had never rendered* (it read `presentation.page.rows`; `buildListPresentation` returns no `page` key, so the condition short-circuited on `undefined` — *"a safeguard against silent truncation that is itself silent is the worst of both"*); and list dates showed full timestamps (`8/12/2025, 5:00:00 AM`) — *"a list answers when, roughly; the record answers exactly when."*
- A screen-local relationship chip group was **removed**: it offered one hard-coded field and could never have offered Line of Business without editing that file.

**Eight registered gaps, all still gaps** (`docs/architecture/customers-structured-list.md:67-89`):

`ACCOUNT_MULTI_ARRAY_FILTER_GAP` · `ACCOUNT_STATUS_LIFECYCLE_ORDER_NOT_EXECUTABLE` · `ACCOUNT_CITY_STATE_NOT_PROJECTED` · `ACCOUNT_PRIMARY_LOCATION_NOT_MODELLED` · `ACCOUNT_INSTALLED_BASE_ROLLUP_GAP` · `ACCOUNT_SERVICE_ROLLUP_GAP` · `ACCOUNT_CONTACT_ROLLUP_GAP` · `ACCOUNT_FINANCIAL_METRICS_ABSENT`

The sharpest is `ACCOUNT_PRIMARY_LOCATION_NOT_MODELLED`: *"`account.locations` is a plain ONE_TO_MANY. Nothing marks one as primary and no write path sets one. **A customer with three sites does not have one obvious city merely because a list wants a column**, and whichever site happened to be created first is not an answer. The domain question comes first: is a primary location a billing address, a headquarters, or the site that gets service most often? Those are three different fields."* City and State are therefore blocked as reporting dimensions.

And the one deliberately unsolved: `CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS` — *"Paging by id, resolving names, and labelling the result 'Customer A → Z' is a false global sort."* The named future design boundary (a maintained `customerNameLower` on each operational document plus a governed Account rename-propagation authority) *"must address rename, consistency, idempotency, fan-out, failure and retry, audit, and backfill"* — **not approved, not built.**

**CURRENT EOS AUTHORITY**

| | |
|---|---|
| Object | `accounts` — **Firestore, client-direct write under Rules**, `firestore.rules:1319-1338`: `allow create/update: if isAdminOrDispatcher() && accountGovernedFieldsValid(...) && (isAdmin() || accountGovernedFieldsUnchanged())`, `delete: if false` |
| Client store | `field-ops-app-vite/src/domain/accounts.js:53` — the module comment is explicit: *"client-direct-write-with-rules, not a Cloud Function"* (`:13-15`) |
| Interim posture | `firestore.rules:1330-1332` flags this as INTERIM pending a trusted audited writer |
| Capabilities | `customer.record.read` (`permissionCatalog.ts:73`), `.create` (`:79`), `.update` (`:85`), `customer.governedField.write` (`:91`) — **all four ACTIVE.** These are among the 38. |
| Read | `getAccountPortfolioSummary` (`functions/src/index.ts:17`), capability `customer.record.read` |
| State machine | **None.** Four status values, no transition command — ND-11. |
| Operating company | **Absent, and the client says so.** `field-ops-app-vite/src/domain/companyAttribution.js:4-11` records the defect: *accounts are not partitioned by operating company; one account can carry both Taylor and Ventana invoices.* |
| PostgreSQL | `functions/migrations/1758758400000_crm-account-contact-location.sql:170` creates `accounts`. `functions/src/crm/customerRepository.ts` is imported **only by tests**. |

**This is the only surface in my domain whose capabilities are all active.** Everything else is gated. That makes Accounts the live CRM surface and everything downstream of it demo-only.

**NEW OPPORTUNITIES**
1. Answer the primary-location question (billing / HQ / most-serviced) — it unblocks City, State, three rollup gaps and the reporting dimensions in one ruling.
2. The trusted audited Account writer the Rules comment already anticipates. Today an audited-class field (`status`, `relationshipTypes`, `paymentTerms`, `taxStatus`) is changed by a client-direct write; `docs/architecture/customer-domain-foundation.md:405-431` specifies that those belong to the trusted writer.
3. An operating-company dimension on the Account, or an explicit ruling that there isn't one and the dimension lives only on the transaction.

**SCENARIO / OPERATIONAL QUESTIONS**
- A dispatcher edits an account's `paymentTerms`. Rules refuse a non-default governed value for non-admins — but **the edit is client-direct and emits no audit event.** Who changed a customer's credit terms, and when? **UNPROVEN that any audit record exists for ordinary account edits.**
- A national account has ten sites across both operating companies. The list shows one row, no city, no company. **What does a salesperson do with that?**

**DESIGN P2 DISPOSITION:** **`KEEP`** for the list composition, count honesty and query contract — this surface earns it, and the capabilities behind it are genuinely active. **`AUTHORITY GAP`** for the audited-class fields written client-direct with no trusted writer and no audit event. **`PRODUCT GAP`** for `ACCOUNT_PRIMARY_LOCATION_NOT_MODELLED` and the four rollup/metrics gaps. **`ADD`** operating-company dimension.

### 4.2 `/customers/:accountId` — Account record (Customer 360)

**ORIGINAL CLAUDE DESIGN — the approved artifact is missing.** `North Star - Account P1.dc.html` (1a desktop 1440 / 1b tablet 768 / 1c phone 375) is named as the **visual authority** at `docs/design/north-star-migration-ledger.md:130,175,180` and cited in `docs/DECISIONS.md:2168` as living in `design_handoff_account/`. **It has never been in this repository, on any branch.** Family 3's first pass was composed from the grammar; its second pass was reconciled against an artifact that a later session cannot open.

What survives is the six-section hierarchy from `docs/assessments/customer-account-business-model.md:144-160` (Owner Issue #158): **Account Summary** (always visible, never collapsed) → **Financial Summary** (provider-neutral; until a provider exists it renders exactly *"Sales data source not connected"* — *"never a fabricated `$0.00`"*) → **Contacts** → **Locations** → **Service Activity** (aggregate counts + a bounded cursor-paginated newest-first timeline) → **Notes / Identifiers** (the only section collapsed by default).

Plus four Owner-ruled design decisions from the Account North Star package (`docs/design/north-star-open-product-decisions.md:246-296`):
- **A-D1 Attention silence — RESOLVED: silence.**
- **A-D2 AR denied presentation — RESOLVED: preserve the geography.**
- **A-D3 Archived account editing — RESOLVED: Edit stays offered.**
- **A-D4 Prospect composition — RESOLVED: the same page.** (Prospect is a status value, not a family — `docs/north-star/lists/LISTS-P2-RECONCILIATION.md` inventory row.)

**WHAT ACTUALLY GOT BUILT — implemented.** `field-ops-app-vite/src/modules/accounts/AccountDetail.jsx` (903) over `src/domain/accountNorthStar.js`, with 18 sibling section components. Route `field-ops-app-vite/src/App.jsx:979`. Per-section capability gates declared in `field-ops-app-vite/src/metadata/definitions/accountPage.js:191,200,209,217,275` — `opportunity.read`, `salesOrder.read`, `finance.read`, `crm.activity.read`.

**Three findings recorded rather than smoothed over** (`docs/design/north-star-migration-ledger.md:137-171`):
- **The attention defect was ordering, not absence.** `AccountAttentionSection` rendered at the *bottom of the secondary column, below every related list* — *"a reader reached it after everything it should have warned them about."* It moved to its NS-P2 position saying exactly what it said before. It is deliberately **not** flattened into the shared `AttentionBand`: AR and Work-Order past-due are never merged into one ranked list, and *"a first draft of the derivation layer did adapt them, and was removed — overriding a behavioral rule to satisfy a visual pattern is what the three-authority model forbids."*
- **ND-11 — an Account has no lifecycle to make visible.** Four status values that *look* like a progression, and **no transition command anywhere**: `status` is an ordinary editable field in `accountRecordPage.editableFieldIds`, written through `updateAccount` exactly like `name` or `notes`. *"An archived account can be edited straight to Prospect and no guard would object."* Shipped: **no spine**, and the page states the reason in words — *"An account has no lifecycle to show. Its status is a field someone sets, not a stage it moves through."* A test fails the moment `status` leaves `editableFieldIds`, *"so this decision cannot quietly outlive its own premise."*
- **A-NS-1 — the approved design asserted something false about the repository.** It says *"`useAccount` is not a subscription"*; `hooks/useAccount.js` uses `onSnapshot(doc(...))` and has since Sprint 2.0.2. Only the premise was wrong; the design's conclusion (no live badge, honest "Read-checked · Refresh" wording) is implemented as written because *"the quieter claim is never wrong."* Recorded *"because a design note asserting something false about the repository is worth someone noticing before it is quoted as a fact somewhere consequential."*

**CURRENT EOS AUTHORITY** — as §4.1, plus:

| | |
|---|---|
| Contacts | `firestore.rules:1555-1559` — `allow create, update: if isAdminOrDispatcher()`. **No capability, no callable.** `objectPermissionMap.js:36` marks it `rulesOnly: "contacts"` with C/R/E/D all empty. Client store `field-ops-app-vite/src/domain/contacts.js:12`; CSV import writes documents directly at `src/domain/contactImport.js:38`. |
| Locations | `firestore.rules:1341-1345` — same shape. `objectPermissionMap.js:37` `rulesOnly: "locations"`. Client store `src/domain/locations.js:16`. |
| CRM Activity | `crm_activities` has **no Rules match block at all** → default deny. Commands `createCrmActivity` / `getCrmActivities` (`functions/src/index.ts:548-549`); capabilities `crm.activity.create` (`permissionCatalog.ts:1448`) and `.read` (`:1461`) — **both `active: false`**, but **granted to `ADMIN_ROLE` explicitly** (`functions/src/access/compatibilityRoles.ts:185,192-193`) and **deliberately NOT to the shared admin/dispatcher base, so dispatcher gains nothing** (`docs/governance/crm-activity-admin-authority-proposal.md:116-150`, applied in PR #1324). |
| AR section | `useAccountAr` → `financeReadCallableClient` → `listAccountInvoiceAr`. `docs/north-star/financials/FINANCIALS-UX-CURRENT-MAIN-RECONCILIATION.md` calls this **the only wired client read chain** in finance. `finance.read` is `active: false`. |

**The `crm.activity` episode is worth preserving as a pattern.** The investigation found *"Runtime enforcement matches the current role matrix, but the current role matrix appears inconsistent with the established admin-access invariant."* Admin and owner were both denied from a single cause, because `ADMIN_ROLE` is also the derivation source for `OWNER_PERMISSIONS`. The safer alternative — assigning the `crmActivityContributor` operational role to admin — was **explicitly rejected as the durable fix**: *"it turns canonical admin authority into accumulated operational-role workarounds."* And the catalog was **not** changed: both ids stay `active: false`. *"Grant-is-not-activation is preserved, and production remains triple-blocked."*

**NEW OPPORTUNITIES**
1. **Commit the Account P1 artifact, or re-derive it.** Family 3's second pass cannot be re-verified by anyone. This is the highest-value single recovery action available.
2. Contacts and Locations need either capabilities or an explicit Owner ruling that Rules is their permanent authority — today they are invisible to the capability catalog, to every Role definition, and to the policy seed (§6.3).
3. ND-11 — decide whether an Account should have a governed lifecycle. *"If the answer is yes, the spine follows for free."*

**SCENARIO / OPERATIONAL QUESTIONS**
- An account is archived, then edited straight back to Prospect. Nothing objects, nothing is recorded. **Is that acceptable?** ND-11 asks exactly this and is open.
- The Financial Summary renders *"Sales data source not connected"* while `finance.read` exists, is granted, and is inactive. **Two different absences — no provider, and no activation — render as one sentence.** UNPROVEN whether the surface distinguishes them.

**DESIGN P2 DISPOSITION:** **`IMPROVE`** — the composition is accepted, the honest-state discipline is exemplary, and the record's live capabilities (`customer.record.*`) are active, so this is not a workflow gap in its core. But four of its sections gate on `active: false` capabilities (`opportunity.read`, `salesOrder.read`, `finance.read`, `crm.activity.read`), so **most of Customer 360 is a set of honest refusals.** Sub-dispositions: attention ordering + ND-11 sentence `KEEP`; missing Account P1 artifact `PRODUCT GAP`; Contacts/Locations authority `AUTHORITY GAP`; ND-11 lifecycle `PRODUCT GAP`.

### 4.3 Contacts as a global collection — BLOCKED by design

`contactIndexList` declares `surface: "INDEX"`, and **there is no global route, no per-contact read and no record page.** Lists P2's 2j marks it `PRODUCT DECISION`. `docs/north-star/lists/LISTS-P2-COLLECTION-DISPOSITION.md:262-266,579`: *"A Contacts index needs a route and a record — both new. Contacts stay account-scoped (#15) meanwhile."*

**DESIGN P2 DISPOSITION:** **`PRODUCT GAP`** — correctly blocked, correctly named, deliberately not absorbed into List infrastructure.

### 4.4 The CRM design decisions that were ruled and then never built

`docs/architecture/customer-domain-foundation.md` (unit C-1, 533 lines) is Owner-approved on its core model and carries seven decisions. Traced through the repository:

| Decision | Content | State at HEAD |
|---|---|---|
| **D-C1-1** | Customer is a **role on an Account**, not an entity. *"There is no `customers` collection, now or planned."* | **ADOPTED**; the deleted `field-ops-app-vite/src/domain/customers.js` is its physical trace |
| **D-C1-2** | The billing customer is the Account; the service location is a Location. *"the Location is where the technician goes, the Account is who pays"* | ADOPTED; no separate Bill-To entity |
| **D-C1-3** | `parentAccountId` — nullable self-reference, single parent, acyclic, bounded depth, **rollups derived never stored**, **hierarchy is organizational not authorization** | **NOT BUILT.** `docs/handoff/w1-c9-registrations.md:149`: *"`parentAccountId` (D-C1-3) and the merge/tombstone policy (D-C1-7) are not modelled… neither is stored today, and building either here would be schema ahead of a decision."* |
| **D-C1-4** | Doc id is the only hard-unique key; duplicate prevention is **advisory-at-create, not a DB constraint**; external ids are correlation keys | **IMPLEMENTED — but in the Postgres `eos_crm` lane, not the Firestore path the document was written against**: `functions/src/crm/customerRepository.ts:389` (*"The ADVISORY duplicate lookup of D-C1-4 — a normalized-name match, never a constraint"*), `functions/migrations/1758758400000_crm-account-contact-location.sql:130` |
| **D-C1-5** | Status lifecycle `PROSPECT → ACTIVE ↔ INACTIVE`, all three → `ARCHIVED` (terminal, soft). *"`ARCHIVED` is soft-delete only… never hard-deleted"*; *"Status is not authorization"* | **IMPLEMENTED in the Postgres lane** (`functions/src/crm/customerRepository.ts:68` — *"the lifecycle of D-C1-5, not a free string"*). **Not enforced in Firestore** — that is ND-11. |
| **D-C1-6** | `accountOwner` stays a single named owner; reserved nullable **`territoryId` on the Account**, descriptive metadata only, **never an authorization boundary**; **no Territory entity or collection is proposed** | **NOT BUILT as specified.** Territory landed instead as a first-class Coverage entity (§3.5). `COVERAGE_TERRITORY_AUTHORITY_GAP` is recorded **OPEN** at `functions/scripts/governance/effectiveAuthority.mjs:72` and `docs/governance/effective-authority.json:37-46`. |
| **D-C1-7** | Merge policy, eight clauses: re-point live references, **preserve history in place**, resolve the rest through a **`mergedIntoAccountId` tombstone**; open Work Orders re-pointed by the trusted writer; **closed records retain their original `customerId`**; merged-away account is ARCHIVED, never hard-deleted | **NOT BUILT.** `mergedIntoAccountId` appears in **no code anywhere in the repository.** |

**Six implementation units were named. None exists.** C-2 Hierarchy · C-3 Status Lifecycle enforcement · C-4 Identity/Duplicate/Merge · C-5 Territory & Ownership · C-6 Customer Audit Trail — and C-2's own sub-units C-2.S / C-2.1 / C-2.2. Zero artifacts for any of them.

**Two id-namespace collisions that will bite anyone citing these.** `D-C2-1`/`D-C2-2` mean one thing in `docs/assessments/customer-hierarchy.md` and something completely unrelated in `docs/DECISIONS.md:590-591` (an Inventory PartDetail cutover). `C-3`…`C-6` mean one thing in `customer-domain-foundation.md` §13 and another in the bin-location docs. **Neither namespace is qualified anywhere.**

**Still open and answered by nothing:** D-C2-OPEN-b (manual vs bulk detach on parent-archive, *"finalize in C-2.S"* — and C-2.S does not exist) · D-C1-OPEN-c (`customerNumber` uniqueness, deferred to a C-4 that does not exist) · **commercial-profile inheritance down the hierarchy** (open question 3 of `docs/assessments/account-commercial-profile-and-financial-forecast-horizons.md` — *no document answers it*) · forecast cumulative bucket boundaries and driving date field · credit `ON_HOLD` enforcement semantics · custom payment-terms governance · `creditStatus` / `creditLimit` / `pricingTier` / `parentAccount` — all four designed, **none implemented**.

**DESIGN P2 DISPOSITION for the C-1 corpus:** **`PRODUCT GAP`** across D-C1-3, D-C1-6 and D-C1-7; **`AUTHORITY GAP`** for the commercial-profile fields that were designed as *governed* and are written client-direct; **`UNKNOWN`** for whether the Postgres `eos_crm` implementations of D-C1-4/-5 supersede the Firestore path or duplicate it — **nothing rules on that, and it is the single most consequential unanswered question in CRM.**
---

## 5. FINANCIALS — twenty designed pages, twenty built routes, and what that conceals

### 5.0 The set, reconciled

This is the most completely recovered design package in the repository: twenty `.dc.html` sources, twenty per-page handoffs, a 1,449-line master review package, a 1,350-line consolidated handoff, 44 acceptance PNGs at 1440 and 375, and a current-main reconciliation — all at `docs/north-star/financials/`. Design direction **APPROVED**; final status **`READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW` — never `READY_FOR_IMPLEMENTATION`**.

**And all twenty routes exist.** That is the single most misleading fact in my domain, so it is stated with its qualifier attached:

| Page | Route | Component | Backing read |
|---|---|---|---|
| 01 Overview | `/financials` | `FinancialsOverview.jsx` (202) | `useFinancialFacts` |
| 02 Billing Queue | `/financials/billing-queue` | `FinancialsBillingQueue.jsx` (108) | **`unwiredReadHonestState()` — no read wired** |
| 03 Invoices (+ `/:invoiceId`) | `/financials/invoices` | `FinancialsInvoices.jsx` (173), `FinancialsInvoiceDetail.jsx` (291) | `useFinancialFacts` |
| 04 Accounts Receivable | `/financials/accounts-receivable` | `FinancialsAccountsReceivable.jsx` (205) | `useFinancialFacts`, `AR_AGING_BUCKETS`, `agingCompanySpan` |
| 05 Payments (+ `/:paymentId`) | `/financials/payments` | `FinancialsPayments.jsx` (168), `FinancialsPaymentDetail.jsx` (222) | `useFinancialFacts` |
| 06 Credits & Adjustments | `/financials/credits-adjustments` | `FinancialsCreditsAdjustments.jsx` (95) | **`unwiredReadHonestState()` — no read wired** |
| 07 Customer Financials | `/financials/customer-financials` | `FinancialsCustomerFinancials.jsx` (282) | `useFinancialFacts` |
| 08 Sales to Goal | `/financials/sales-to-goal` | `FinancialsSalesToGoal.jsx` (92) | **static / honest-state only** |
| 09 Cost to Budget | `/financials/cost-to-budget` | `FinancialsCostToBudget.jsx` (86) | **static** |
| 10 Forecasting | `/financials/forecasting` | `FinancialsForecasting.jsx` (91) | **static** |
| 11 Profitability | `/financials/profitability` | `FinancialsProfitability.jsx` (128) | **static** |
| 12 Budget Management | `/financials/budgets` | `FinancialsBudgets.jsx` (88) | **static** |
| 13 Goal Management | `/financials/goals` | `FinancialsGoals.jsx` (104) | **static** |
| 14 Company Performance | `/financials/company-performance` | `FinancialsCompanyPerformance.jsx` (175) | `useFinancialFacts` + `OPERATING_COMPANY_IDS` |
| 15 Employee Performance | `/financials/employee-performance` | `FinancialsEmployeePerformance.jsx` (181) | `useFinancialFacts` |
| 16 Reconciliation | `/financials/reconciliation` | `FinancialsReconciliation.jsx` (92) | **static** |
| 17 Intercompany | `/financials/intercompany` | `FinancialsIntercompany.jsx` (74) | **static** |
| 18 Audit History | `/financials/audit` | `FinancialsAudit.jsx` (74) | **static** |
| 19 Reports & Exports | `/financials/reports` | `FinancialsReports.jsx` (83) | **hardcoded `CATALOG` + blocking reason; no export wired** |
| 20 Governance | `/financials/governance` | `FinancialsGovernance.jsx` (182) | **static** |

**8 of 20 read real data. 2 render an explicit unwired state. 10 are static compositions.** All 20 route dispatches are at `field-ops-app-vite/src/App.jsx:765-822`, record views at `:944,947`, nav domain at `field-ops-app-vite/src/navigation/navConfig.js:474-502`.

**Every one of the five finance capabilities is `active: false`** — `finance.invoice.issue` (`functions/src/access/permissionCatalog.ts:278`), `finance.payment.apply` (`:290`), `finance.adjustment.record` (`:302`), `finance.read` (`:313`), `finance.refund.record` (`:374`) — as are all five FIN-004 visibility scopes (`:330,338,346,354,362`). **All are granted** (§2). Activation is the only gate.

**And not one of the twenty routes has a capability guard.** `navConfig.js:478-481` says so deliberately — no financials item declares `capabilityAccess` or `legacyKey`, so all twenty fall to `PLACEHOLDER_DEFAULT_ROLES = ["admin","dispatcher"]` (`navConfig.js:49,685`), with financial data authorization server-side only. That is a defensible design (FIN-004 is the real boundary and UI hiding is never authority) **and it means any dispatcher can reach all twenty pages today.**

### 5.1 What the design said, page by page — the parts that are authority, not decoration

The per-page handoffs (`docs/north-star/financials/pages/*.md`) are unusually disciplined. The rules that bind any implementation:

- **Mobile is recomposition, never horizontal shrink.** Every page's §8. 01 becomes a 2×3 scorecard grid with *"exceptions outrank plan table"*; 02 becomes two-line rows with **no bulk actions** and the blocked reason verbatim; 05 puts unapplied first; 06 puts pending-approval triage first.
- **Fact classes stay labelled and separate** — `OPERATIONAL_ACTUAL` / `ACCOUNTING_RECONCILED_ACTUAL` / `FORECAST` / `BUDGET` / `GOAL` — and **`ACCOUNTING_RECONCILED_ACTUAL` appears nowhere**, because there is no accounting authority.
- **Missing authority renders its named honest state, never a zero.** 01: *"Reconciliation exception line renders 'No accounting authority' (never zero)."* 09: per-row *"Actual: no cost authority."* 11: *"before FIN-006 the truthful unavailable state IS the page."*
- **06's visible contract copy:** *"corrections create new governed events; the original remains history."*
- **19:** *"reports compose the same authority, never a new truth source; export re-authorizes."* Scope is re-checked at execution time; **no download-everything.**
- **20:** *"Financials-specific governed administration; not generic Admin; nothing here rewrites immutable history."*
- **Visibility, on every page:** `SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED` — ***"restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority."***

**Design corrections made in the 2026-09-01 authority pass, each removing a claim the engine could not support:** 05's unapplied-balance content relabelled FUTURE AUTHORITY (*"current core refuses over-application"*); 10's method claims removed — cells read *"Method TBD — FIN-005"*, and *"weighted by governed stage probability"* was **deleted**; 06's "auto" approver specimen became *"policy TBD"*; 12's self-approval-threshold wording removed; 20's period row corrected to AUTHORITY NOT IMPLEMENTED.

**Registers:** **15 authority gaps · 13 product questions · 3 design gaps.** Full tables at `docs/north-star/financials/FINANCIALS-NORTH-STAR-P1-DESIGN-REVIEW-PACKAGE.md:1376-1449`.

**Four cross-page consistency findings, all still open:** F1 aging-bucket vocabulary vs the brief; **F2 — "Invoices 60+ days" on page 01 vs "61+" on page 04; one wording must win**; F3 the approval sheet on 06/12/13 should be **one** shared component; F4 the fact-class label block recurs on nine pages and should be extracted.

### 5.2 What the backend actually is

`docs/north-star/financials/FINANCIALS-UX-CURRENT-MAIN-RECONCILIATION.md` is the binding reconciliation, and it is more honest than the handoffs it corrects:

| FIN phase | Handoff said | Current truth | Evidence |
|---|---|---|---|
| FIN-001 Authority map | COMPLETE | IMPLEMENTED | `docs/financials/FIN-001_FINANCIAL_AUTHORITY_MAP.md` |
| FIN-002 Reporting attribution | COMPLETE | IMPLEMENTED | `functions/src/finance/financialAttribution.ts` |
| FIN-003 Plan vs Actual | OPEN | **BUILT_DORMANT + DATA SUPPLY MISSING** — *no collection, no command, no read callable* | `functions/src/finance/planVsActual.ts` |
| FIN-004 Visibility | OPEN | **IMPLEMENTED server-side, NOT ACTIVATED** — 5 scopes + 5 capabilities, all `active:false` | `functions/src/finance/financialVisibility.ts` |
| FIN-005 Forecast | OPEN | BUILT_DORMANT + POLICY NOT CONFIGURED — *methodology is an unconfigured policy* | `functions/src/finance/forecasting.ts` |
| FIN-006 Cost & margin | OPEN | BUILT_DORMANT + DATA SUPPLY MISSING — margin = UNKNOWN unless every governed cost fact exists | `functions/src/finance/costMargin.ts` |
| FIN-007 Approvals | OPEN | BUILT_DORMANT + POLICY NOT CONFIGURED — self-approval forbidden; **missing policy fails closed** | `functions/src/finance/financialApprovals.ts` |
| FIN-008 Period & close | "AUTHORITY NOT IMPLEMENTED" | BUILT_DORMANT + POLICY NOT CONFIGURED — closed-period writes refuse; **reopen not modelled**; no storage | `functions/src/finance/financialPeriods.ts` |
| FIN-009 Intercompany | OPEN | BUILT_DORMANT; **consolidated = `UNELIMINATED_SUM`** until elimination policy exists | `functions/src/finance/financialAllocation.ts` |
| FIN-010 Reconciliation | OPEN | Internal: BUILT_DORMANT + NOT USER-EXPOSED. External: **FUTURE INTEGRATION — no accounting authority selected** | `functions/src/finance/financialReconciliation.ts` |

**Six finance modules have zero importers anywhere in `functions/src`:** `billingQueue.ts` (103), `forecasting.ts` (151), `costMargin.ts` (115), `financialAllocation.ts` (111), `inventoryCostEngine.ts` (425), and `financialReconciliation.ts` — which the AR migration itself calls *"a detector that is never run"* (`functions/migrations/1759017600000_ar-cash-application-authority.sql:36-39`).

**There is no Rules-only finance write anywhere.** Every finance collection is deny-all: `invoices` (`firestore.rules:1803-1805`), `payments` + `payment_applications` (`:1812-1817`), `invoice_adjustments` (`:1824-1826`), `refunds` (`:1843-1845`), `reportDefinitions` (`:1592-1594`). `performance_goals` and `financial_policy_profiles` have **no match block at all** and are denied by the unmatched-collection default. **The finance gap is the inverse of the reorder gap: not Rules-without-a-callable, but authorities with neither a callable nor a caller.**

**FIN-001's own count:** 59 facts — EOS_AUTHORITY **20** (15 dormant) · EXTERNAL **0** · DERIVED 7 · DISPLAY_ONLY 3 · **MISSING 25** · UNKNOWN_REQUIRES_DECISION 4. Eighteen FIN-GAP entries; the load-bearing ones: **-005 no cost authority anywhere** (`GROSS_MARGIN_AUTHORITY = MISSING`), **-008 no plan authority**, **-009 no approval thresholds or dual control**, **-010 no period/close model**, **-012 no reconciliation seam**.

### 5.3 The two Wave-1 corrections, verified

**AR and aging blended Taylor and Ventana into one number.** Verified fixed and verified how:
- `functions/src/finance/financeReadProjection.ts:9` — *"the projection carries `companyId`"*; `:20-24` — companyId is stamped from the Sales Order's `operatingCompanyId` by `issueInvoice`, **never caller-chosen**.
- `UNATTRIBUTED_COMPANY = "UNATTRIBUTED"` (`:158`), `companyKeyOf` (`:161`).
- **`summarizeArAgingByCompany` (`:174-190`)** partitions by `companyId` and hands each partition to the one bucketing rule — a second bucketing implementation was not written.
- `summarizeAccountAr` (`:233`) carries `byCompany` (`:241`), `companyIds` (`:242`), `spansMultipleCompanies` (`:282`).
- The client vocabulary is `field-ops-app-vite/src/domain/companyAttribution.js`, which **never infers a company** (`:18-22`) and falls back to consolidated rendering when the server did not supply the breakdown (`:23-28`).
- FIN-002 makes the invariant explicit: *"**NO REPORTABLE OPERATIONAL FINANCIAL EVENT EXISTS WITHOUT `operatingCompanyId`**"*, with refusals `COMPANY_REQUIRED` / `COMPANY_INVALID` / `COMPANY_MISMATCH`, and *"**INVOICE COMPANY IS GOVERNED BY ITS SOURCE SALES ORDER, NOT CHOSEN INDEPENDENTLY BY THE CALLER**"* — *"No inference, no Taylor default, no current-user fallback — anywhere."*

**Invoice `totalMinor` was a stored aggregate that could diverge from its lines.** The ruling is real; **the scope of the fix is narrower than the headline.**

- The Postgres DDL **does** make totals a view over `GENERATED ALWAYS` columns: `functions/migrations/1758931200000_invoice-authority.sql:252-254` (`subtotal_minor`, `taxable_base_minor`, `line_total_minor`, all `GENERATED ALWAYS … STORED`) and `:276-297` (`CREATE VIEW invoice_totals AS SELECT … COALESCE(sum(l.line_total_minor),0)::BIGINT AS total_minor … GROUP BY i.id`), carrying `operating_company_key` at `:282`. Stated intent at `:33-41`: *"THE HEADER STORES NO TOTALS … LINE ARITHMETIC IS GENERATED, NOT SUPPLIED."*
- **But nothing writes or reads it.** `:12-13`: *"There is NO data migration in this packet, and **nothing deployed writes these tables yet**."* `:42-44`: *"The equivalent Firestore fields stay where they are."*
- **The live path still stores header aggregates at issuance:** `functions/src/finance/invoiceCommands.ts:287` destructures `sumInvoiceLineAmounts(out)` and persists `subtotalMinor` / `discountMinor` / `taxMinor` / `totalMinor` on the header at `:302-306`, with `outstandingMinor: totalMinor` at `:306`.
- **What actually changed at runtime:** the arithmetic was extracted into one shared pure module so all three layers agree on the *definition*. `functions/src/eosOps/invoiceTotals.ts:1-31` is candid about the limit: *"an aggregate with one definition can still be stale, but it can no longer be a DIFFERENT answer depending on who asked"* (`:19-20`).

**So the precise statement is:** totals are a view over `GENERATED ALWAYS` columns **in the `eos_finance` Postgres schema, which no deployed code writes or reads**; at runtime `invoices.totalMinor` remains a stored Firestore header aggregate written once at issuance, now computed through one shared definition. The divergence class is narrowed, not eliminated. **Anyone repeating the headline without the qualifier will be wrong.**

### 5.4 Per-page dispositions

| # | Page | Disposition | Why |
|---|---|---|---|
| 01 | Overview | **`WORKFLOW GAP`** | Reads real facts; every figure it composes is gated by `finance.read` (`active:false`). FIN-AG-READ-ACTIVATION + FIN-AG-VISIBILITY. |
| 02 | Billing Queue | **`WORKFLOW GAP`** | `unwiredReadHonestState()`; `billingQueue.ts` has **zero importers**; service billing readiness is FIN-BLOCK-002, an undecided Owner package. The page's own §16 names this as its main remaining gap. |
| 03 | Invoices | **`WORKFLOW GAP`** | Reads exist; `finance.invoice.issue` inactive. Reconciliation Status column **withheld by design** until FIN-010 (FIN-DG-03, a named reserved slot) — that part is `KEEP`. |
| 04 | Accounts Receivable | **`IMPROVE`** | The company dimension is real and correct (§5.3). Blocked only by activation. Open: FIN-AG-DUEDATE-POLICY (disputes, promise-to-pay, post-issuance terms changes) and F1/F2 bucket-vocabulary inconsistency — **fix F2 outright; two pages must not disagree about "60+" vs "61+"**. |
| 05 | Payments | **`WORKFLOW GAP`** | No read callable exists for payments at all; unapplied cash is FUTURE AUTHORITY. FIN-PQ-UNAPPLIED-POLICY asks whether the workflow *should* exist — an **Owner decision, not a build item**. |
| 06 | Credits & Adjustments | **`WORKFLOW GAP`** | Unwired; FIN-007 policy values undecided, and the mechanism **fails closed on missing policy** (correct). The correction-event invariant is `KEEP`. |
| 07 | Customer Financials | **`IMPROVE`** | A composition page that never duplicates Customer identity — the right shape. Gated by activation. |
| 08 | Sales to Goal | **`AUTHORITY GAP`** | FIN-AG-PLAN: goal records have **no collection, no command, no read callable** (FIN-003 BUILT_DORMANT + DATA SUPPLY MISSING). Static page over absent authority. |
| 09 | Cost to Budget | **`AUTHORITY GAP`** | **No `budget.*` capability exists anywhere in the catalog.** FIN-006 cost supply is FIN-BLOCK-003, open. The page *is* the truthful state and says so — which is the correct design and still an authority gap. |
| 10 | Forecasting | **`AUTHORITY GAP`** | FIN-005 core merged, methodology unconfigured, no storage, no callable. *"`Opportunity.expectedValue` is never promoted to forecast revenue"* — `KEEP` that rule. |
| 11 | Profitability | **`AUTHORITY GAP`** | `GROSS_MARGIN_AUTHORITY = MISSING` (FIN-001 FIN-GAP-005). *"Before FIN-006 the truthful unavailable state IS the page."* |
| 12 | Budget Management | **`AUTHORITY GAP`** | Five actions drawn (New / Revise / Submit / Approve / Save draft); **no budget capability, no budget collection, no budget command.** |
| 13 | Goal Management | **`WORKFLOW GAP`** | Unlike budgets, goals **do** have authority: `performance.goal.read/.create/.approve/.supersede/.retire` (`permissionCatalog.ts:1533-1565`) and six callables (`functions/src/index.ts:563-570`) over `performance_goals`. All five capabilities `active:false`; the collection has **no Rules match block**. FIN-PQ-TEAM-GOAL (roster change mid-period) unanswered. |
| 14 | Company Performance | **`IMPROVE`** | Genuinely company-dimensioned (`OPERATING_COMPANY_IDS`). Consolidated is `UNELIMINATED_SUM` until FIN-BLOCK-004 — and the page must carry that caveat. |
| 15 | Employee Performance | **`WORKFLOW GAP`** | *"visibility as the composition"* — the design's own framing. FIN-004 is implemented and inactive. FIN-PQ-15a (who may see margin by person) unanswered. |
| 16 | Reconciliation | **`AUTHORITY GAP`** | No provider selected (DECISIONS #145). Detail frame **deliberately not drawn** (FIN-DG-16): *"with no state vocabulary an exception-detail composition would assert FIN-010 decisions."* That restraint is `KEEP`. |
| 17 | Intercompany | **`AUTHORITY GAP`** | `financial.intercompany.classify` is a **conceptual id that does not exist in the catalog.** Classification schema is FIN-009; who may classify is FIN-PQ-17a. **This is the clearest case in the domain of a design naming a capability the platform does not have.** |
| 18 | Audit History | **`IMPROVE`** | A **lens** over the existing append-only audit authority — *"never a second audit system."* The right architecture; the lens is not built. FIN-PQ-CORRELATION-IDS open. |
| 19 | Reports & Exports | **`WORKFLOW GAP`** | A hardcoded `CATALOG` of designed report groups with blocking reasons and **no export wired**. FIN-AG-REPORT-REGISTRY. See §6. |
| 20 | Governance | **`AUTHORITY GAP`** | FIN-008 period & close: BUILT_DORMANT, policy unconfigured, **no storage**, **reopen not modelled**. Both `financialPolicy.profile.*` ids `active:false`; `financialPolicyProfileCommand.ts` is **not exported from `functions/src/index.ts`** — **UNPROVEN whether any deployed path reaches it.** |

**Count: 20 routes. 0 `KEEP` at page level.** Six `AUTHORITY GAP`, nine `WORKFLOW GAP`, five `IMPROVE`. Several individual *rules* inside those pages earn `KEEP` and are named above — the restraint on page 16, the withheld column on page 03, the `expectedValue` prohibition on page 10, the correction-event invariant on page 06.

### 5.5 The finance opportunities worth naming

1. **Activation is one decision, not twenty.** Every finance capability is granted. Ten ids stand between the whole family and a live subledger, and the per-environment machinery to do it safely already exists and is triple-blocked for production (`functions/src/access/environmentCapabilityOverrides.ts:16-25`).
2. **FIN-BLOCK-003 (cost facts) unblocks four pages at once** — 09, 11, and the cost halves of 08 and 14. It is the highest-leverage open Owner package in the domain.
3. **Fix F2 now.** "60+" on page 01 and "61+" on page 04 is a one-word inconsistency in a design that is otherwise ruthless about not saying two things.
4. **Extract F3 and F4** — one approval sheet, one fact-class label block. Both are named, both are cheap, both prevent drift across nineteen pages.
5. **Page 02's real blocker is a definition, not code:** *"billing readiness ≠ WO COMPLETE"*, and the two readiness models (commercial Sales Order eligibility, which **is** governed, and service billing readiness, which is not) are deliberately kept separate. Do not let anyone build a universal readiness model to close it.

### 5.6 Finance scenario questions

- An invoice is issued for a Ventana sale against an account that also buys from Taylor. AR now partitions correctly. **But nothing on the Account record says which company an open balance belongs to** — `companyAttribution.js:4-11` names this exact defect. What does a collections call look like?
- FIN-008 models close but **not reopen.** A late transaction arrives against a closed period. The write refuses. **There is no modelled path forward.** FIN-PQ-20a asks this and is unanswered.
- `financialReconciliation.ts` is *"a detector that is never run."* If invoice totals and lines diverge in Firestore today, **nothing detects it** — which is the original defect, still live, now with a written detector sitting unwired beside it.
---

## 6. REPORTING

### 6.1 `/reporting/builder` — the governed object-based report creator (ADR-007)

**ORIGINAL CLAUDE DESIGN.** The design intent here is unusually complete because it exists as a full governance chain — Assessment (`docs/assessments/governed-object-based-report-creator.md`) → **ADR-007** (`docs/architecture/ADR-007-governed-object-based-report-creator.md`) → Specification → Implementation Plan (`docs/implementation-plans/governed-object-based-report-creator.md`). The visual design for the eight Reporting destinations was in `North Star - Subpage Expansion.dc.html`, which **is absent from the repository**.

- *Primary question:* what do I want to know about my business, over governed objects, that I am authorised to see?
- *The finding the whole architecture exists to answer:* ***"there is no field-level read authorization anywhere in the platform today"*** (Assessment `:76`). `account.record.read` grants the whole document; `GOVERNED_*_FIELDS` are **write** governance; ***"Firestore Rules are per-document all-or-nothing on read"*** and cannot return a partial document.
- *The decision (D1):* **trusted field projection.** Reads are server-mediated; a field the caller may not read is **absent from the response payload, not blanked and not returned-then-hidden.** Four alternatives rejected by name: client-direct + UI hiding (*"the single largest risk this ADR exists to prevent"*), per-field Rules (impossible), field-level encryption (*"does not remove the trust boundary, it relocates it"*), materialised per-role projections.
- *D4 — the predicate-drop rule, and it is the cleverest thing in the corpus:* a filter referencing an unreadable field is **dropped, never applied**. *"The trusted engine can read every field, so if it kept applying an author's `salary > 100000` filter for a lower-privileged runner, the **result-set membership would itself leak the hidden field** even though the salary column is projected out. Dropping the predicate widens the result rather than leaking; a leak is never the safe direction."* And the widening is **surfaced**, not silent.
- *D4 also:* **results are never cached across principals** — *"the cache must not become a side channel around re-evaluation."*
- *D5:* relationships predefined and **bounded to one hop**; the predicate rule crosses the hop identically.
- *D6:* financial, cost, margin, employee and audit fields **denied by default** until a dedicated security review per domain.
- *D8:* **CSV-first, export a separately-governed capability** — *"a runner may view but not export."*
- *Six activation waves*, each a catalog/capability operation, not a re-architecture.
- *Five open decisions carried to the Owner*, of which #2 is the most substantive and is still open: **operator-differentiated granularity.** *"That cannot express **aggregate-only** access — 'may see `SUM(salary)` by department but not any individual salary' — which is the single most common sensitive report (totals without line items)."* Ruled for v1: one `readCapability` per field, **no operator-differentiated grants**.
- *Owner rulings at the implementation-planning gate:* limits are **configurable governed limits**; **scheduling design-only, not wave 1**; **private-only first**, governed same-tenant sharing only after saved reports and export verify; Purchase Order cost fields stay wave 5.

**WHAT ACTUALLY GOT BUILT — substantially implemented, and better than most of this domain.**

| Piece | Location |
|---|---|
| Object / field / relationship catalog | `functions/src/reporting/reportCatalog.ts` — objects `:83-95`, wave-1 = customer / contact / location / equipment (`:84-87`); object gate derived `report.<objectId>.read` (`:78`); field gate `report.<objectId>.field.<group>.read` (`:116`) |
| Query model + validation | `functions/src/reporting/reportQueryModel.ts` (36), `reportQueryValidation.ts` (268) |
| Execution service | `functions/src/reporting/reportExecutionService.ts` (884) |
| Callable | `runReportDefinitionCallable` — `functions/src/index.ts:183`, **sandbox only, not production** (`:172-182`) |
| Saved definitions | `functions/src/reporting/savedDefinitionCommands.ts` + `savedDefinitionCallables.ts`; six callables `functions/src/index.ts:196-203` |
| Builder UI | `field-ops-app-vite/src/modules/reporting/ReportBuilder.jsx` (521); run seam `field-ops-app-vite/src/domain/reporting/reportExecutionSeam.js:31-40` |
| Saved reports UI | `field-ops-app-vite/src/modules/reporting/SavedReports.jsx` (241) |

**What matches the design, verified in source:** object gate first (`reportExecutionService.ts:423-449`); per-field authorization with dropped-column labels (`:452-463`); **predicate drop implemented as specified** (`:466-471`); no cross-principal cache — *"there is no cache to leak across principals because there is no cache, full stop"*, source-asserted by test (`:38-48`); one audit event per run carrying ***"NEVER row data"*** (`:29-35`); the one-hop join happens **before** filtering (a round-1 independent-review fix — joining after filtering made a filter on a related field read `undefined` and *"silently produce wrong results"*).

**The truncation fix, verified exactly.** The claim passed to this lane is correct and the code is worth quoting because the reasoning is the deliverable:

- The defect, recorded in the module's own doc comment (`reportExecutionService.ts:86-95`): a truncated slice's aggregate was *"returned as the aggregate's value with only a `truncated: true`"*, and **an aggregate run whose truncated slice matched no rows resolved to a state that outranked `"truncated-widened"` in the kind ladder** — i.e. **an understated total could arrive labelled "no results."**
- The fix (`:503-527`): completeness is judged **before any join read and before a single aggregate is computed**, *"so a refused run never produces a partial figure that some later branch could return."* On refusal it still writes an audit event — *"The run really happened (documents were read), so unlike a structurally invalid definition this IS an auditable outcome"* — and throws `IncompleteAggregateScanError`: *"the scan exceeded N documents, so any total would be lower than the truth. Narrow the report with filters, or run it without aggregates."*
- The governing principle is borrowed from FIN-004 and named at `:99`: ***"A page that would truncate… refuse."***

**CURRENT EOS AUTHORITY**

| | |
|---|---|
| Capabilities | `report.customer.read` + 13 field ids (`permissionCatalog.ts:640-741`) · `report.contact.read` + 5 (`:744-785`) · `report.location.read` + 4 (`:787-823`) · `report.equipment.read` + 8 (`:825-889`) · `report.definition.create/.read/.rename/.duplicate/.delete` (`:907-941`) — **all 38 `active: false`** |
| Environment | `report.*` is **explicitly excluded from the sandbox override set** — `functions/src/access/environmentCapabilityOverrides.ts:33`. It *is* in the production-adoption-eligible list (`:52-121`), with the ten sensitive field reads deferred (`:47-51`). |
| Route guard | `/reporting/builder` declares `capabilityAccess: REPORT_WAVE1_OBJECT_READ_CAPABILITIES` (`navConfig.js:517`) and `/reporting/saved` declares `[report.definition.read]` (`:522`) — **fail-closed, no compatibility-role fallback** (`navConfig.js:683`). These are the **only capability-guarded routes across Sales, CRM, Financials and Reporting** — 0 of the 6 sales/CRM routes and 0 of the 20 financials routes carry one. Administration adds exactly two more (§7.6), for **4 capability-guarded routes out of 62 in the whole domain** (7 Sales/CRM + 22 Financials incl. 2 record views + 10 Reporting + 3 Dashboard + 20 Administration incl. the unguarded diagnostics route). |
| Storage | `reportDefinitions` Firestore collection (`savedDefinitionCommands.ts:84`); `firestore.rules:1592-1594` `allow read, write: if false`; ownerUid always the trusted `request.auth.uid`, never client-supplied (`:31-32,331,503`) |
| Other 7 destinations | `/reporting` index + `/reporting/{service,inventory,purchasing,warehouse,employees,customers,financial}` are `navHidden` `PlaceholderPage` (`navConfig.js:523-530`) |

### 6.2 The three unclosed contracts

**(a) There is no row filtering at all — and the claim passed to this lane understates it.**

`functions/src/reporting/reportExecutionService.ts:420`:
```ts
const target: TargetContext = { scope: { type: "global" }, condition: {} };
```
`:500`:
```ts
const snap = await db.collection(object.collection).limit(maxScanDocs + 1).get();
```
with the inline comment at `:497`: *"Fetch (index-free: **no server-side `where()`**, bounded fetch, all filtering/grouping/aggregation/sort in-memory)."*

Two consequences, not one:
1. **A runner holding the object capability sees every row of the collection** — the "runner's authorized row set" that the Specification leans on (*"the runner's authorized row set still bounds it"*) does not exist in code.
2. **A grant held at `ownAssignment` or `location` scope will not resolve at all**, because the authorization target is hardcoded `global`. The scope model is bypassed in both directions.

This is safe today only because every `report.*` id is `active:false` — the service header says so: *"every real call today resolves every `report.*` capability to DENY — this service is 'unavailable-not-unsafe' by construction"* (`:23-28`). **It must be closed before W1 activation, not after.**

**(b) No report carries an operating-company dimension.** `grep -n "operatingCompany\|companyId\|company" functions/src/reporting/*.ts` returns exactly one hit, an unrelated comment at `savedDefinitionCommands.ts:207`. `reportCatalog.ts` field lists (`:120-181`) contain no company field on customer, contact, location or equipment. Meanwhile:
- `docs/financials/F13_REPORTING_MATRIX.md:11-14` makes **Company the first required reporting axis**: *"every reportable event carries a REQUIRED `operatingCompanyId`."*
- `docs/governance/eos-dashboard-composition-authority.md:56-57` lists `{type:"businessUnit"}` / `{type:"operatingCompany"}` as legitimate personalization scopes.
- `F13:52` — ***"Invariant E: every report and export path composes FIN-004 visibility — the export of a number is the number."*** There is **no** `financialVisibility` import in `reportExecutionService.ts`.

Not yet a live leak (W5/W6 financial waves are unactivated), **but the contract is unclosed and it becomes a defect at reporting wave 3, exactly as this programme predicted.**

**(c) Saved definitions: private-per-owner in code, designed for governed sharing.** Ownership check `savedDefinitionCommands.ts:268` (`if (data.ownerUid === actorUid) return;`), `:381`, list `where("ownerUid","==",actorUid)` at `:403-404` — **no admin override.** Sharing is designed (*"Sharing shares the definition, never a result set. A shared open re-executes under the recipient's permissions and Scope"*) and **not built**: no `report.definition.share` capability, no share command, no Share affordance. That **matches the plan** (private-only first, Owner decision 4). The open question the programme identified is real and upstream of it: **is a saved report definition user data or business configuration?** — which determines whether these rows migrate at all. **I found no ruling. UNPROVEN and genuinely open.**

Two more designed-and-unbuilt, both correctly sequenced: **export** (`report.export` does not exist anywhere in the repo; the Assessment's *"there is no CSV (or any) export/download capability anywhere in the app"* is still true) and **scheduling** (no capability, command or UI; `W-SCHED` named but unplanned).

A **stale comment worth fixing:** `field-ops-app-vite/src/access/reportAccess.js:30` says the `report.definition.*` ids are "all active"; `permissionCatalog.ts:907-941` registers all five `active: false`. One is wrong; no reconciling decision record exists. **UNPROVEN which.**

**NEW OPPORTUNITIES**
1. **Close the row-scope gap before wave 1 activates** — this is the one place in my domain where an unclosed contract becomes a data-exposure defect the moment a switch flips.
2. **Add the company axis to the report catalog**, and compose FIN-004 in the execution service. Both F13 Invariant E and FIN-004's own *"Exports re-authorize through the same loader"* currently have no implementation in the report path.
3. **Rule on saved definitions: user data or business configuration.** It gates the migration.
4. Reopen ADR-007 open decision #2 (**aggregate-only field access**) before wave 5 — the ADR itself says it is *"the single most common sensitive report"* and that surfacing it now beats discovering it in wave 5.

**SCENARIO / OPERATIONAL QUESTIONS**
- A salesperson is granted `report.customer.read` in wave 1. They build a customer report. **They see every customer in the tenant.** Is that intended? The ADR says the row set bounds the projection; the code says otherwise.
- A report aggregating over a collection larger than `MAX_SCAN_DOCS` now refuses. **Good — but the user's next move is "narrow it with filters", and the filters run in memory over the same truncated scan.** Does narrowing actually change what is scanned? **UNPROVEN — I did not trace whether filters influence the fetch. On the evidence of `:500` they do not.**

**DESIGN P2 DISPOSITION:** **`AUTHORITY GAP`.** The engine is real, the field projection and predicate-drop are correctly implemented, the truncation refusal is exemplary — and the authorization target is hardcoded `global` over an unfiltered collection scan. Sub-dispositions: field projection + predicate drop + no-cache + truncation refusal + audit-without-row-data `KEEP`; row-level scope `AUTHORITY GAP`; operating-company axis `ADD`; FIN-004 composition in the report path `AUTHORITY GAP`; saved-definition sharing `PRODUCT GAP`; export `PRODUCT GAP` (correctly sequenced); scheduling `PRODUCT GAP` (correctly deferred); the seven placeholder destinations `PRODUCT GAP`.

### 6.3 `/dashboard` — My Dashboard and the persona composition

**ORIGINAL CLAUDE DESIGN.** `docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md` (925 lines), governed by `docs/governance/eos-dashboard-composition-authority.md` (Decision #161) and the Performance Goal Authority (Decision #162). **CLOSED / OWNER ACCEPTED 2026-09-03**, post-acceptance correctives **LIVE VERIFIED 2026-09-04**; the Technician surface is a separate closed acceptance.

The composition rules that matter to my domain:
- **Rule 1** — *"A dashboard composes authority. It is never a second permission layer."* **No `dashboard.*` capability may be minted** — verified: zero `"dashboard."` ids in either catalog mirror.
- **Rule 1a** — personalization inputs are a **closed set**, and ***never a persona name***.
- **Rule 3** — *"the domain owns the actual; the goal authority owns the target."* Same measurement basis required; **never BOOKED actual vs BILLED goal**; windows come from `reportingPeriod` (Decision #163), never a period the dashboard decided for itself.
- **Rule 6** — ***"A bounded read may return a page and say so. A TOTAL may not."***
- **Rule 8** — a rate rolls up as `sum(numerator)/sum(denominator)`, **never `average(per-employee percentages)`**; cross-entity sums type as `UNELIMINATED_SUM`.
- **Rule 10** — *"An action a dashboard offers must be an action that exists."*

**Module classification — the design's own three-way split.** For the **Salesperson** persona:

```
CURRENT WORK    MyOpportunities (GATED, AB-3) · AgreementsAwaitingAcceptance (GATED)
                OrdersRequiringAction (GATED, AB-7)
PERFORMANCE     MyBooked vs My Goal · % attainment · remaining to goal — ALL GATED (FIN-004)
                GoalProgress renders the TARGET (governed today) beside an UNAVAILABLE actual
BUSINESS IMPACT AccountPortfolio — governed today, and the section's only live figure
                FirmBooked / FirmBilled (GATED)
```

**And the rule that makes it honest:** *"Accounts must NOT become the headline merely because dollars are gated… **A gated module holds its place.** Re-ranking a dashboard around what happens to be available today teaches the reader that availability is importance."* And: *"the goal half of '% attainment' IS governed now, and the actual half is not. The tile therefore shows a real target and an unavailable actual — which is the honest shape of 'we know what you should do and cannot yet tell you how you did'."*

**The DO-NOT-BUILD list is design authority too** — reserved as *named absences so a later session does not re-derive them*: AOV (S-12), **pipeline value (S-4)**, first-time fix, SLA/response, callbacks, parts-delay impact, technician utilisation, work-order aging buckets, jobs-per-workday, stockout rate, inventory aging, inventory value / turns / carrying cost, **waste avoided** (*"needs a prevention event, a cost basis, AND a stated counterfactual"*), emergency-purchase rate, PO cycle time, supplier on-time, cross-domain activity roll-up (Owner-retired), notification history.

**WHAT ACTUALLY GOT BUILT — implemented and Owner-accepted**, `field-ops-app-vite/src/modules/dashboard/MyDashboard.jsx` + `GoalGrid.jsx` + `GoalTile.jsx` + `PreviewList.jsx`. Routes `field-ops-app-vite/src/App.jsx:223-232,397-405`; `alwaysVisible: true` (`navConfig.js:57`).

**Four post-acceptance correctives, each verified an ancestor of the live commit before closure:**
| PR | What it corrected |
|---|---|
| #1793 | **Six governed capabilities the composition gates on were never in the access-feed request set, so seven modules could not resolve for anyone**; FIN-004 reach; two ungated reads |
| #1795 | Team performance rendered the **stored** Work Order status |
| #1796 | A **negative** Avg Job Duration presented as a performance fact |
| #1799 | Shared shell: duplicate account controls, notification relocation |

The duration rule as accepted is a small masterpiece of honesty: valid span → measured; zero-length → **valid** (*"unusual, not contradictory"*); inverted (`completedAt` before `workStartedAt`) → **the whole figure is withdrawn, never transformed**; missing a timestamp → outside the eligible population, *"and counted so the shortfall is not silent."*

**Rules checked against code (cheap checks only):** Rules 1, 1a, 5, 6 verified not violated; Rule 3 verified not violated (`MyDashboard.jsx:75` imports `resolveReportingPeriod` / `TAYLOR_VENTANA_REPORTING_CALENDAR`); Rule 9 verified not violated (`:264` explicitly refuses a stacked bar for co-occurring conditions); `:211` carries Rule 6's `unclassified` rule verbatim; `:290` — *"Counted independently — one work order can appear in more than one of these, so they are not a total."* **Rules 2, 4, 7, 8 and 10 require per-tile semantic review and are UNPROVEN at this depth.**

**A finding I must flag because it contradicts a document's own framing.** `docs/assessments/eos-dashboard-reporting-authority-census.md:563-569` records that **`financeManager` holds no `finance.*` capability at all while `accountingManager` holds all five**, though both Role descriptions claim they are *"intentionally identical"* — and *"the existing pinning test permits this because it asserts containment and `>=` rather than equality, so it passes while its own comment… is false."* **That is a live, unclosed inconsistency in the Role catalog, and it is in my domain.**

**DESIGN P2 DISPOSITION:** **`IMPROVE`.** The one accepted, live, Owner-closed surface in my domain — and for the Salesperson persona **every Current Work and Performance module is GATED**, so a salesperson's dashboard is one live figure (`AccountPortfolio`) and a column of honest refusals. The composition authority `KEEP` (it is the strongest governance document in the domain). The `financeManager` / `accountingManager` divergence `AUTHORITY GAP`. The census's §3 tables `IMPROVE` — they retain the pre-withdrawal `DEP` classification and *"a reader taking §3 at face value will over-state the blockage."*
---

## 7. ADMINISTRATION

### 7.1 The original design

Two chains, both Owner-approved, neither with a `.dc.html`. The Administration destinations were covered by `North Star - Subpage Expansion.dc.html` — **absent from the repository**.

**`docs/assessments/enterprise-access-and-administration-platform.md`** (Issue #226, Accepted, Option D ratified) proposed **seven governed objects** — Role · Permission · Scope · Condition · Approval Policy · Access Request · Audit Event — and **five distinctions the model must never collapse**: *Authentication ≠ Authorization ≠ Eligibility ≠ Organization ≠ Approval*, with *"Organization — which company/tenant you belong to. **Unresolved**"*. A six-layer enforcement matrix, with the governing sentence: ***"the lower layers are the authorities, the upper layers are UX."***

The named prohibitions are as load-bearing as the proposals:
- ***"`operationalRoles` must never silently become security roles."***
- ***"AI may recommend and explain, but never grants, revokes, or approves access."***
- **Impersonation — explicitly deferred, default no**; *"if ever pursued it needs its own ADR with mandatory audit, consent, scoping, and time-boxing."*
- **No break-glass UI** — break-glass stays an operator-script-only, audited procedure.
- Claims carry only `companyId` / `platformAdmin` / `companyAdmin` / `accessVersion` — ***never*** detailed permissions, Scopes or Conditions.
- Admin-portal MVP explicitly excludes: permission/Role-definition builders, custom Scope/Condition builders, direct overrides, an approval-policy editor, claims administration, break-glass administration, bulk migration, the Access Request UI, AI administration, impersonation.

**`docs/architecture/eos-admin-policy-workflow-reconciliation.md`** (476 lines) is the more recent and the more consequential. Its one-sentence problem:

> ***"Today code is the customer's policy. The target is code is how policy is enforced, and the EOS database is what the customer's policy says"*** — with Firebase reduced to identity and **Firestore excluded entirely from policy persistence**.

Its two findings shape everything:
- **§1.1** — *"There is no PostgreSQL, no DAL, and no migration tooling anywhere in this repository."* Recorded as **NAMED DECISION D-1** rather than silently resolved. **Now ruled and implemented**: PostgreSQL + `pg` + `node-pg-migrate`, **no ORM**, `EOS service → PolicyRepository/DAL → PostgreSQL adapter → PostgreSQL`.
- **§1.2** — *"`readGovernedList` — the governed read path — resolves capabilities against `COMPATIBILITY_ROLES` only (`admin`, `dispatcher`, `technician`). **A governed business Role reaches no governed read source at all**, whatever its 1,673 lines of permission lists say."* *"the 43 governed Roles are today **declarations**, not live authority."* **UNPROVEN whether §1.2 still holds at `d104cf49`** — I did not re-measure `readGovernedList`, and this is the single most important administration claim to re-verify before anything is built on the governed Roles.

**D-2 — an unsupported CRED cell. RULED: REFUSE.** *"An administrator cannot persist a CRED grant the enforcement engine has no governed way to enforce."*

**Workflow terminology (§11):** Administration presents **3 business areas over 5 versioned state machines** — Parts/Purchasing (1), Technician/Work Order (1), **Sales (3)**. *"Sales is three machines chained by **events**, not transitions: a won Opportunity **creates** an Agreement, and there is no edge from `WON` to `DRAFT`."* And: *"An **area** is a presentation grouping with no state, no transition and no Role binding of its own — asserted, because the moment it had one it would be a fourth thing authority could be resolved against."*

**The seed omission (§10), which is the design lesson worth keeping:** the first seed derived its objects from the CRUD matrix alone — 24 rows — while the metadata registry has 29 entities. Sixteen appeared in both, so **thirteen entities carrying 166 fields reached neither the policy model nor any Administration screen**: Supplier · Warehouse · Truck · Reorder Request · **Sales Agreement** · Part Alias · Stock Location · Manufacturer · Equipment Model · Mobile Location · **Sales Territory** · Purchase Order Void · Supplier Catalog Item.

> ***"Nothing failed. No count looked wrong, because nobody was comparing the two lists — which is the defining shape of a silent omission."***

The remedy: **one union, two consumers** (`field-ops-app-vite/src/access/policyObjectRegistry.js` feeds both the seed generator and the Administration grid, *"so 'which objects can policy govern?' has one answer rather than two"*) plus a generated ledger (`functions/src/adminPolicy/seed/policySeedCoverage.json`) whose test fails if an entity or field is unaccounted for. Reconciled: **37 seeded objects · 394 seeded fields · 0 excluded entities · 0 excluded fields.**

**The Reorder Request ruling (Owner, 2026-09-08) — the model the rest of Administration should follow.** Authority follows the record, and **data authority is separated from workflow authority**: Reorder Request *data* CRED on object `reorderRequest`; Reorder Request *transitions* as Parts/Purchasing **Workflow actions**; Purchase Order data CRED separately; PO lifecycle as workflow actions. Consequences, each proved by a test: *"A workflow action is never duplicated as a CRED checkbox"* — `WORKFLOW_ACTION_CAPABILITIES` and the matrix are **disjoint by construction**; *"Reorder Request's Edit column is therefore empty, and that emptiness now means 'every edit-shaped reorder capability is a workflow action', not 'nobody decided'"*; *"Neither authority implies the other, in either direction"*; *"Lineage is preserved, not renamed"* — every `reorder.*` id has **exactly one home** (six data, nine workflow, none with two and none with none).

### 7.2 THE HEADLINE NUMBER, RE-MEASURED — and it is wrong as passed to me

**Claim received:** *"30 of 58 capability ids are `active: false`; seven objects are inert on every verb."* Both halves needed correction.

**The catalog is not 58.** 58 does not correspond to any set that answers "which capability governs which verb". Measured:

| Set | Distinct ids | of which `active: false` |
|---|---|---|
| `OBJECT_PERMISSIONS` **CRED cells only** (`field-ops-app-vite/src/access/objectPermissionMap.js:33-105`) | 49 | 25 |
| `OBJECT_CAPABILITY_MAP` (`functions/scripts/governance/objectCapabilityMap.mjs:39-86`) | 27 | 13 |
| `MATRIX_GAP_CAPABILITIES` (`field-ops-app-vite/src/access/policyObjectRegistry.js:123-133`) | 6 | 4 |
| `reconcileCrudMatrix.mjs` private `OBJECTS` (`scripts/reconcileCrudMatrix.mjs:100-129`) | 42 | 22 |
| **Union of the advertised tables** | **56** | **30** |
| Whole `PERMISSION_CATALOG` | **147** | **109** |

**Verdict: the numerator 30 is correct; the denominator is 56, not 58.** The "58" is a different number that sits nearby — the count of distinct capability ids appearing *anywhere* in `objectPermissionMap.js`, i.e. the 49 CRED ids **plus the 9 ids on the `WORKFLOW_ACTION_CAPABILITIES` ban list** (`:129-142`), **all nine of which are active**. Two different sets were conflated. The defensible statements are **30 of 56 advertised ids (54%)** or **25 of 58 ids named in that file**. Neither is 30/58, and the source document's derived "52%" follows the wrong denominator.

**"Seven objects inert" is also wrong — the real number is twelve, and two of the specific claims invert.** Measured per object in `OBJECT_PERMISSIONS`, cross-referencing every advertised id against the catalog's `active` flag: **12 of 25 objects have zero active capability on any verb.**

*Advertise ids where every one is `active: false`* (the grid renders "· inert", `field-ops-app-vite/src/modules/administration/AdminObjects.jsx:149-153,176`):
- **Opportunities** (`objectPermissionMap.js:38-39`), **Sales Orders** (`:41-43`), **Dispatch Schedule** (`:47-48`), **Serialized Assets** (`:90-91`), **Invoices / AR** (`:93-94`), **Payments** (`:95-96`)

*Advertise no id at all:*
- **Contacts** (`:36`), **Customer Locations** (`:37`), **Equipment / Installed Base** (`:92`) — `rulesOnly`
- **Marketing Initiatives** (`:40`), **Commissions** (`:44`) — in `UNMODELLED_OBJECTS` (`objectCapabilityMap.mjs:37`)
- **Technician Time / Non-work** (`:49`) — advertises nothing, and is `RULE_GOVERNED` server-side despite **no corresponding `firestore.rules` collection**; the drift test's own comment calls it UNMODELLED, not Rules-governed (`functions/test/administrationObjectDrift.test.mjs:261-263`)

**Two specific corrections to the handoff that carried the "seven":**
- **`docs/handoff/w1-c18-registrations.md:159` says Transfer Orders is inert "on every advertised verb". It is not.** Transfer Orders (`objectPermissionMap.js:87-89`) is inert on C and E — all four `inventory.transfer.*` are inactive — but **its R is live**: `warehouse.transferOrder.read` is active.
- **The same list omits Dispatch Schedule, which measures fully inert.**

Also partially inert and worth naming: **Inventory Adjustments** (4 of 5 ids inactive), **Parts Catalog** (`inventory.catalog.read` inactive), **Users** (`admin.credentialReset.initiate` inactive).

**So the honest headline is:** *Administration advertises 56 capability ids across 25 objects; 30 of those ids cannot resolve for anyone, and 12 of the 25 objects have no working verb at all.* Rather than "advertises what cannot happen" as a rhetorical flourish, the measured statement is **48% of the objects the Administration grid renders are inert on every verb.**

**One thing that cannot be measured mechanically, and the code says so.** "No callable" is not provable by grep — `functions/test/administrationObjectDrift.test.mjs:36-43` states that capability ids reach enforcement through module constants and injected `authorize` seams, and that `docs/architecture/capability-graph.json` *"is evidence of reference, never proof of a callable."* The one provable case is asserted rather than assumed: the retired `inventory.action.create` writer (`field-ops-app-vite/src/domain/inventoryActions.js:31-35`) **throws unconditionally**, which is why that id was removed from both tables.

### 7.3 Four tables, one question, twenty-one disagreements

The four are named with exactly this framing in the header of `functions/test/administrationObjectDrift.test.mjs:1-23`:

1. `field-ops-app-vite/src/access/objectPermissionMap.js:33-105` — `OBJECT_PERMISSIONS`, **what the Administration screens render** (25 objects)
2. `functions/scripts/governance/objectCapabilityMap.mjs:39-86` — `OBJECT_CAPABILITY_MAP`, **what the governance contract and workbook generators read** (24 objects)
3. `field-ops-app-vite/src/access/policyObjectRegistry.js:123-133` — `MATRIX_GAP_CAPABILITIES`, the registry-only extension (`warehouse`, `stockLocation`, `salesAgreement`)
4. `scripts/reconcileCrudMatrix.mjs:100-129` — a **fourth, private copy inside the reconciliation report script** (24 objects)

…and a fifth answer for the `rulesOnly` objects: **`firestore.rules` itself** (e.g. `/employees/{employeeId}` at `:476-498`).

**Verified:**
- **21 disagreements — CONFIRMED, with the arithmetic made explicit.** Comparing tables 1 and 2 for objects present in both yields **20 verb-level disagreements**, matching `docs/handoff/w1-c18-registrations.md:100-127` row for row. The 21st row is `Reorder Requests (whole object)` — an **object-level** absence, not a verb-level diff. 20 + 1 = 21. Both numbers are defensible; the table is accurate.
- **`Reorder Requests` absent from one — CONFIRMED.** It is the *only* object in `OBJECT_PERMISSIONS` (`:79-81`) with no key in `OBJECT_CAPABILITY_MAP`. The reverse set is empty.
- **`Employees` has no row at all — CONFIRMED.** No object matching `/Employee/i` exists in **any** of the four.
- **Could not confirm:** whether any of the 20 disagreements is *intended*. Two are documented Owner decisions (`Users / E`, `Roles / Permissions / E` — `objectCapabilityMap.mjs:79-84`); **the other 18 carry no recorded rationale anywhere I found.**

### 7.4 `rulesOnly` — confirmed exactly, including the part that matters most

**Three entries, at the exact lines claimed:**
- `field-ops-app-vite/src/access/objectPermissionMap.js:36` — `Contacts` → `"contacts"`
- `field-ops-app-vite/src/access/objectPermissionMap.js:37` — `Customer Locations` → `"locations"`
- `field-ops-app-vite/src/access/objectPermissionMap.js:92` — `Equipment / Installed Base` → `"equipment"`

**`RULE_GOVERNED_OBJECTS` = 5 — CONFIRMED** (`functions/scripts/governance/objectCapabilityMap.mjs:31-34`): the three above plus `Notifications` and `Technician Time / Non-work`. So the "3 vs 5" is not a contradiction: 3 is the client marker, 5 is the server list, and the two extra are server-only. **But the server list carries its own contradiction, pinned by the drift test:** `Notifications` is `RULE_GOVERNED` server-side while `objectPermissionMap.js:97-98` advertises `R: ["reorder.request.read.queue"]` for it — a reorder capability governing notifications.

**"The policy seed drops `rulesOnly`" — CONFIRMED, and this is the finding with the longest tail.**
- The marker *is* carried into the registry: `field-ops-app-vite/src/access/policyObjectRegistry.js:155` (matrix rows copy it), `:179` (registry-only rows hardcode `null`).
- The seed builder is `scripts/buildAdminPolicySeedSnapshot.mjs:59-87`. Line 59 projects `key, label, labelPlural, description, domain, source, supportsDelete, capabilitiesByVerb, fields` — **and never `rulesOnly`.**
- Output: `functions/src/adminPolicy/seed/policySeedSnapshot.json` — `grep -c rulesOnly` returns **0**.

**Consequence, stated plainly: inside the tenant policy store, a Rules-governed object is indistinguishable from an unmodelled one.** An administrator looking at Contacts sees the same emptiness they would see for Marketing Initiatives. One is governed by role branches in `firestore.rules:1555-1559`; the other is governed by nothing. **The store cannot tell them apart, and neither can the person using it.**

### 7.5 Employees — the object with no row

**There is no capability row for Employees in any of the four tables.** So Administration → Objects renders no Employees row, and the policy seed has no matrix-derived `employees` governable object. Verbs:

| Verb | Authority | Evidence |
|---|---|---|
| **Create** | **No callable.** An out-of-band operator script: `functions/scripts/provisionEmployeeAccess.js` (+ `onboardEmployeePreflight.js` / `onboardEmployeeVerify.js`). `firestore.rules:497` — `allow create, update, delete: if false;` | |
| **Update** | Callable `updateEmployeeProfile` (`functions/src/index.ts:244`), capability **`admin.employeeProfile.write` — ACTIVE** (`functions/src/access/employeeProfileCommands.ts:101`); authorization `:429,494`; **denials are audited** (`:487`, `functions/src/access/auditEventWriter.ts:606`); editable field set `:198-221`; refused fields `:225` | |
| **Deactivate** | **Two different things, deliberately.** Employment state is `employmentStatus` via `updateEmployeeProfile`. *Access* is the **principal**, a different record: `setUserStatus` (`functions/src/index.ts:167`), capability `admin.userStatus.write`, **active**. The distinction is stated at `field-ops-app-vite/src/modules/administration/AdminUsers.jsx:9-11` | |
| **Read** | `firestore.rules:476-496` — admin/dispatcher, self (`userData().employeeId == employeeId`), or a narrowly-scoped `PARTS_MANAGER` assignment-candidate lookup | |

So an Employee is: **Rules for read, a governed audited callable for update, and a Node script for create** — and none of that is visible in the object model an administrator is shown. **The most fundamental record in an access-control system is the one Administration cannot describe.**

### 7.6 Routes and the capability guards that mostly are not there

Nineteen administration routes (`field-ops-app-vite/src/navigation/navConfig.js:531-612`, generated at `field-ops-app-vite/src/App.jsx:871-882`). **Only two carry a capability guard:**

| Route | Component | Guard |
|---|---|---|
| `/administration/data-import` | `AdminDataImport.jsx` | **`admin.dataImport.stage`**, no compatibility fallback → fail-closed |
| `/administration/email-communications` | `AdminEmailCommunications.jsx` | **`administration.emailIntake.read`**, fail-closed |
| `/administration/users` (+ `/:employeeId`) | `AdminUsers.jsx`, `UserDetail.jsx` | admin/dispatcher default |
| `/administration/roles-permissions` | `AdminRolesPermissions.jsx` | admin/dispatcher default |
| `/administration/objects` | `AdminObjects.jsx` | admin/dispatcher default |
| `/administration/workflows` | `AdminWorkflows.jsx` | admin/dispatcher default |
| `/administration/overview` | `AdministrationOverview.jsx` | admin/dispatcher default |
| `/administration/duplicate-rules` | `AdminDuplicateRules.jsx` | admin/dispatcher default |
| `/administration/warehouse-racking` | `AdminWarehouseRacking.jsx` | admin/dispatcher default |
| `/administration/financial-policy` | `AdminFinancialPolicy.jsx` | admin/dispatcher default; **both `financialPolicy.profile.*` ids `active:false`**, so it renders its honest ungated state (`App.jsx:645-649`) |
| `/administration/integrations` | `IntegrationsFaq.jsx` (static) | admin/dispatcher default |
| `/administration/permission-preview` · `/administration/audit-logs` | `AdministrationUnavailable.jsx` | admin/dispatcher default |
| `/administration/vehicles` · `/regions` · `/company-settings` | `PlaceholderPage` (`navHidden`, **but the route is still emitted**) | admin/dispatcher default |
| `/administration` · `/administration/employees` | `<Navigate to="/administration/users">` | **unconditional** |
| `/admin/diagnostics/inventory-parts-parity` | `PartsShadowParityDiagnostics` | **no route guard**; the component self-gates |

**`/administration/company-settings` is the only "companies" administration route and it is a placeholder.** For a platform whose financial model rests on Taylor-vs-Ventana operating-company attribution, that is a gap worth naming on its own.

**Permission Preview and Audit Logs both render `AdministrationUnavailable`** — the governed collections are deny-all in Rules and no Cloud Function read path is deployed. `docs/north-star/lists/LISTS-P2-COLLECTION-DISPOSITION.md:275-278`: *"A list needs a read that does not exist."*

**Password reset has no route.** It is a surface inside `UserDetail` → `UserAccessActions.jsx`. Backend `initiateAdminPasswordReset` / `listResetEligibleUsers` are **exported and not deployed** — not among the live Functions. Capability **`admin.credentialReset.initiate`** is registered **inactive** with no grant, exactly as DECISIONS #56 ruled. **And the confirmed guard gap remains:** *"disabled-user, missing-Employee-link, break-glass, and final-active-admin guards… are specified in AUTH-PR-1 §6/§8 but are **not in the merged command** — a real gap the UI cannot compensate for."* With the ruling that closes it: ***"The UI is not a security boundary."*** **UNPROVEN whether AUTH-PR-3.5 has landed at `d104cf49`.**

**Notification settings and list/view configuration have no administration route.** The only `notifications` nav item is under a different domain (`navConfig.js:76`, `navHidden`, placeholder). List definitions live in `src/metadata/definitions/*` with **no administration surface at all** — so the saved-view/list-configuration authority the Lists design repeatedly defers to (`+ Save as view`, `Columns`) has nowhere to live even if it were built.

### 7.7 Two deleted Administration screens, and what they were for

**`EmployeesList.jsx`** — deleted in `0dfafe28` (*"feat(administration): one Users destination, a record to read, and a history that is audited"*, 2026-09-05), merged as `3294d835` (#1806). Replaced by `AdminUsers.jsx`; the consolidation **removed the `employees` nav item outright rather than hiding it** and redirected both retired URLs. What it did: mounted the pre-existing `employee.index` metadata list on `useMetadataList` + `MetadataListGrid` inside `WorkspaceIdentity`. It had replaced the older `Technicians.jsx` under the Owner ruling of 2026-08-20 that ***"technician is a role"***. It withheld the record count until the cursor was exhausted, and recorded two honest limits: `securityRole` is a **denormalised mirror** of the legacy `users/{uid}.role`, and **there is no boolean `active` field** — only the six-value `employmentStatus`.

**`RoleObjectGrid.jsx`** — deleted in `a2a0a9f9` (*"Administration surfaces: the CRED grid gains fields, and one grid replaces two"*, 2026-09-08), merged as `51819f47` (#1822). Replaced by `RolePolicyGrid.jsx`, now imported by both consumers (`AdminObjects.jsx:11`, `AdminRolesPermissions.jsx:18`). It existed to end a duplication: *the same markup lived twice, from the same source data through different helpers, with different cell affordances and different accessible names for the same states.* **Its core idea is preserved and is the right one: three cell states, not two** — ticked = granted, blank = not granted, **em-dash = no capability governs this object/verb at all.** That third state is exactly what makes the 12 inert objects legible instead of merely empty.

### 7.8 Administration dispositions

| Surface | Disposition | Why |
|---|---|---|
| `/administration/objects` | **`IMPROVE`** | The three-state grid is right and the "inert" rendering is right. It renders 12 of 25 objects with no working verb, and the store behind it cannot distinguish Rules-governed from unmodelled. |
| `/administration/roles-permissions` | **`AUTHORITY GAP`** | **UNPROVEN but critical:** if §1.2 still holds, the 43–45 governed business Roles reach no governed read source at all. Re-verify `readGovernedList` before anything is built here. |
| `/administration/workflows` | **`IMPROVE`** | 3 areas over 5 state machines, correctly modelled, Sales correctly as **three** chained machines. *"No business record moves through the new Workflow definitions. They are drafts."* |
| `/administration/users` (+ record) | **`IMPROVE`** | The one consolidated, audited administration surface. Employee **create** is still an operator script. |
| `/administration/financial-policy` | **`WORKFLOW GAP`** | Both capabilities `active:false`; `financialPolicyProfileCommand.ts` **not exported from `index.ts`**. UNPROVEN whether any deployed path reaches it. |
| `/administration/permission-preview` · `/audit-logs` | **`AUTHORITY GAP`** | Deny-all collections, no deployed read path. The honest-unavailable state is correct; the absence is the gap. |
| `/administration/company-settings` | **`PRODUCT GAP`** | A placeholder, in a platform whose financial model is company-dimensioned. |
| `/administration/vehicles` · `/regions` | **`PRODUCT GAP`** | Placeholders; routes emitted despite `navHidden`. |
| `/administration/duplicate-rules` | **`AUTHORITY GAP`** | Rendered read-only because **the governed rules service does not exist**. |
| `/administration/integrations` | **`KEEP`** | Static FAQ on the approved integration boundary; no Firestore access; claims nothing. |
| Password reset (in `UserDetail`) | **`WORKFLOW GAP`** | Callables exported, not deployed; capability inactive; **four specified guards confirmed missing from the merged command**. |
| Employees as a governed object | **`AUTHORITY GAP`** | No row in any of the four tables. Create has no callable. |
| Contacts · Locations · Equipment (`rulesOnly`) | **`AUTHORITY GAP`** | No capability, no Role can name them, and the policy seed erases the distinction between governed-by-Rules and governed-by-nothing. |
| Notification settings · list/view configuration | **`PRODUCT GAP`** | No administration surface exists for either. |
| The four-table divergence | **`AUTHORITY GAP`** | Four sources answer one question, 18 of 21 disagreements carry no recorded rationale, and a fifth source (`firestore.rules`) answers it for three more objects. |

**Administration count: 1 `KEEP`, 4 `IMPROVE`, 7 `AUTHORITY GAP`, 2 `WORKFLOW GAP`, 4 `PRODUCT GAP`.**
---

## 8. SYNTHESIS

### 8.1 The biggest original ideas that were never implemented

Ranked by what the business loses, not by effort.

1. **The four operating-document templates — T1 Quote / T2 Sales Order / T3 Pick Ticket / T4 Service Invoice.** `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md` §4.1-4.4. Four real Taylor documents were analysed field by field, the chain between them mapped (`D2 signed agreement → D3 sales order → D4 pick ticket → D3 invoice → D1 service invoice on the same serial`), and **~70 of their fields have no home at all**. **Not built.** No invoicing, quoting, or document-template capability exists.
2. **The signature ladder** (§4.0a) — three rungs: on-device e-signature capture, print-and-photograph, blank printable form. Gap **G38** is the hidden cost: *"No Firebase Storage usage, no `storage.rules`, no upload path exists anywhere in the codebase today"* — net-new infrastructure. **Not built**, and the Sales Agreement design independently arrived at the same absence (SA-G2).
3. **Field-level visibility within a document (G35).** *"A technician completes work/parts/times/readings; pricing, rates, tax, and totals are office-only. Route-level `ROLE_NAV_ACCESS` cannot express this."* **Genuinely new capability, not built.** ADR-007 later solved the same problem for *reports* and nobody connected the two.
4. **The intercompany model, both directions (G21/G22).** Flow 1 Taylor→Ventana service, Flow 2 Ventana→Taylor equipment, an internal counterparty that is not a customer Account, and a **three-tier price ladder** (true cost → wholesale → sales) resolved by who is buying, with prices frozen onto the transaction. **Not built.** The wireframe's one unrelaxable ordering constraint: *"G21/G22 are **built** last (Phase 6) but must be **designed** in Phase 0. Pricing has to be shaped as a rate context resolved per billing relationship from the outset — a model that stores one price per line cannot later carry both a transfer price and a customer price… Getting this wrong means rebuilding pricing, quotes, orders, and invoices."* **Pricing is still unbuilt, so the constraint is still live and still unhonoured.**
5. **A governed post-acceptance revision path for a Sales Agreement (SA-G6 / ND-15).** Terminal records cannot be edited and a second agreement is transactionally refused, so **EOS has no path at all for changing commercial commitment after acceptance.** The design explicitly forbids improvising one.
6. **Aggregate-only field access in the report creator** (ADR-007 open decision #2). *"'May see `SUM(salary)` by department but not any individual salary' — the single most common sensitive report."* Ruled out for v1; the ADR surfaced it *"now rather than discovered in wave 5."* Wave 5 is the financial wave.
7. **The C-1 customer units — C-2 Hierarchy, C-3 Status Lifecycle enforcement, C-4 Identity/Duplicate/Merge, C-5 Territory, C-6 Audit Trail.** All five named, Owner-approved in principle, **none started.** `parentAccountId` and `mergedIntoAccountId` appear in no code. The merge policy — eight carefully-reasoned clauses about re-pointing live references while preserving closed history — is the most complete unbuilt design in CRM.
8. **User-created saved views** (`+ Save as view`) — deferred from the Opportunity list, from Lists P2, and from every list that followed, for the same reason each time: *"needs somewhere to persist a named view. That is new authority."* Meanwhile there is **no administration surface for list/view configuration at all.**
9. **Report export and sharing.** `report.export` does not exist anywhere in the repository, and the Assessment's *"there is no CSV (or any) export/download capability anywhere in the app"* is still true today. Correctly sequenced — but that means the governed report creator currently cannot get a number out of the building.
10. **The AI continuity model** from `North Star - Subpage Expansion.dc.html`. The earliest recorded assistant design in the programme. **The artifact is absent and the model survives nowhere.** What exists instead is `functions/src/assistant/` (16 files) — a provider abstraction, a governed tool registry, an answer contract with a four-value basis vocabulary, and a starter system — **exported from nothing.** `functions/src/index.ts` contains no assistant export; the only client references to "assistant" are dictation helpers (`modules/mobile/JobNote.jsx`, `shared/ui/DictatableNote.jsx`). **Verified unwired.**

### 8.2 Design assumptions now obsolete

Each of these appears in a document someone may still quote. Each is false at `d104cf49`.

| Assumption | Where it is still written | Current truth |
|---|---|---|
| *"There is no PostgreSQL, no DAL, and no migration tooling anywhere in this repository"* | `docs/architecture/eos-admin-policy-workflow-reconciliation.md:53-58` (§1.1) | **Obsolete.** `pg ^8.23.0` at `functions/package.json:172`; 18 migrations under `functions/migrations/`; `eos_finance`, `eos_crm`, commercial-ownership and admin-policy schemas all exist. D-1 was ruled and implemented. |
| *"There is no `invoices` collection, no invoice document, and no invoice-generation code"* | `docs/assessments/truck-parts-sale-to-invoice.md:26` | **Obsolete.** `functions/src/finance/invoiceCommands.ts`, `issueInvoice`, `firestore.rules:1803`, plus an entire `eos_finance` Postgres schema. |
| *"Finance is greenfield; financials nav is a `future` placeholder"* | `docs/assessments/completion-to-finance-and-billing-ar-assessment.md:3` | **Obsolete.** Twenty routed Financials pages, ten FIN authorities merged, five callables exported. |
| *"All eight Reporting sub-areas render `PlaceholderPage`"* and *"there is no report creator… of any kind"* | `docs/assessments/governed-object-based-report-creator.md:37-39` | **Obsolete for two of them.** `/reporting/builder` and `/reporting/saved` are real, capability-guarded surfaces. The other seven are still placeholders. |
| *"`useAccount` is not a subscription"* | The approved Account North Star design (A-NS-1) | **False, and recorded as such.** `hooks/useAccount.js` uses `onSnapshot` and has since Sprint 2.0.2. |
| *"No Role carries any `finance.visibility.*` capability"* | `docs/assessments/eos-dashboard-reporting-authority-census.md` headline | **WITHDRAWN (#1743)** — measured by grepping Role sources, which cannot see `admin`'s derived grants. §3's tables still carry the pre-withdrawal `DEP` classification. |
| *"The Sales Agreement capability is granted in NO environment"* | comment in `field-ops-app-vite/src/hooks/useSalesAgreement.js` | Flagged stale by the P1v2 design pass; the override registry and `App.jsx` are current. **UNPROVEN at HEAD — I did not re-read the comment.** |
| *"The `report.definition.*` ids are all active"* | `field-ops-app-vite/src/access/reportAccess.js:30` | Contradicted by `permissionCatalog.ts:907-941` (all five `active: false`). No reconciling record. |
| *"`inventory.catalog.manage` / `.activate` are inert"* | five comment blocks in `functions/src/index.ts` (reported by a sibling lane) | Reported ACTIVE and granted. **Out of my domain; passed through unverified — UNPROVEN here.** |
| *"`hierarchicalVisibility.ts` has ZERO consumers"* | `docs/financials/FIN-001_FINANCIAL_AUTHORITY_MAP.md:70,295-298` | **Obsolete.** FIN-004 made it *"its first live consumer."* |
| P1v1 Sales Agreement copy: *"the commitment is binding"*, *"recording the customer's commitment"*, *"a changed mind is a new agreement"* | P1v1 (never committed; recorded in the P1v2 change table) | **All removed.** EOS stores no customer-side evidence, and no post-acceptance revision path exists. |
| *"58 capability ids, 30 inactive"* | `docs/handoff/w1-c18-registrations.md:49,137` | **Denominator wrong.** The advertised union is **56**. See §7.2. |
| *"Transfer Orders is inert on every advertised verb"* | `docs/handoff/w1-c18-registrations.md:159` | **False.** Its R (`warehouse.transferOrder.read`) is active. |

### 8.3 Missing-workflow discoveries

Not gaps in a design — places where a person cannot finish a job they have started.

1. **A Sales Agreement blocked by an unpriced line cannot be unblocked from its own record page (SA-G7).** The Draft editor covers six scalar commercial terms; per-line pricing lives only in `SalesAgreementPanel` on the Opportunity workspace. Two surfaces, one record, one editor — and the product never taught anyone which.
2. **After acceptance, commercial terms cannot change at all (SA-G6).** No edit, no supersede, no second agreement, no decline. A renegotiation has no governed move.
3. **`DECLINED` is modelled, legal, labelled — and unreachable** (SA-G5/ND-14). Ruled deliberate: no decline command is to be created. The workflow gap is intentional and is still a workflow gap.
4. **"When did this order enter fulfilment?" has no answer anywhere** (ND-8). Three of four Sales Order stages genuinely do not know their own time.
5. **FIN-008 models period close but not reopen.** A late transaction against a closed period refuses, and there is no modelled path forward (FIN-PQ-20a).
6. **Employee create is a Node script.** `functions/scripts/provisionEmployeeAccess.js`. No callable, no screen, no capability row.
7. **Permission Preview and Audit Logs are unreachable** — deny-all collections, no deployed read path. An administrator cannot see who did what.
8. **Payments has no read callable at all.** Command cores merged; *"no read callable exists"*. Page 05 renders over nothing.
9. **Billing Queue is unwired and `billingQueue.ts` has zero importers.** The bridge from completed work to an invoice is written and connected to neither end.
10. **The report creator cannot export.** A governed report you cannot get out of the building is a report you looked at.
11. **Contacts has no global index, no per-contact read, no record page** — correctly BLOCKED, and a real operational absence.
12. **`financialReconciliation.ts` is "a detector that is never run."** The defect it detects — a header aggregate diverging from its lines — is still possible in the live Firestore path.

**Corroborating a sibling lane rather than repeating it.** P2-B2's reorder findings check out where they touch Administration: `functions/src/reorderRequest/reorderCallables.ts` exports exactly **three** `onCall` functions (`createReorderRequest:211`, `recordReorderPurchaseOrder:311`, `listReorderWarehouseOptions:410` — the other two `export const` are capability string constants at `:56-57`), while `firestore.rules:763-1001` carries a multi-branch OR'd transition machine with per-branch `affectedKeys().hasOnly([...])` field locks. And `accounts` / `contacts` / `locations` writes are likewise Rules-gated with no callable (§4.1, §4.2). **The same shape appears in my domain and the Reorder Request ruling of 2026-09-08 is the model for fixing it:** authority follows the record, data authority separates from workflow authority, and every id has exactly one home.

**One passed-on claim I must sharpen rather than repeat.** *"The contextual assistant's procurement/reorder decisions were made by a legacy role string, bypassing the capability catalog."* Measured: `functions/src/assistant/assistantStarters.ts:57-58` gates the reorder starter on **capability ids** (`inventory.balance.read`, `reorder.purchaseOrder.read`), not a role string, and there is no role-string branch anywhere in `functions/src/assistant/` or `functions/src/ai/`. **What does gate on legacy role strings is the UI control**: `field-ops-app-vite/src/shared/inventory/RequestReorderControl.jsx:65-67` —
```js
const isEligible =
  role === ROLES.ADMIN ||
  operationalRoles.includes(OPERATIONAL_ROLE.PARTS_MANAGER) ||
  operationalRoles.includes(OPERATIONAL_ROLE.WAREHOUSE_MANAGER);
```
— and `field-ops-app-vite/src/shared/ui/NotificationControl.jsx:66` (`fallback: role === "admin" || role === "dispatcher"`). **The claim is true of the reorder control, not of the assistant.** The assistant's real defect is different and larger: it is **wired to nothing.**

### 8.4 How much of Administration advertises verbs that cannot execute

Measured, not inherited:

- **25 objects** rendered by the Administration grid (`field-ops-app-vite/src/access/objectPermissionMap.js:33-105`).
- **56 distinct capability ids** advertised across the three live tables; **30 of them are `active: false`** — **54%**.
- **12 of the 25 objects (48%) have no working verb at all**: six advertise only inactive ids (Opportunities, Sales Orders, Dispatch Schedule, Serialized Assets, Invoices/AR, Payments), three are `rulesOnly` with empty CRED (Contacts, Customer Locations, Equipment), two are unmodelled (Marketing Initiatives, Commissions), and one (Technician Time / Non-work) advertises nothing and is classified `RULE_GOVERNED` server-side with **no corresponding `firestore.rules` collection**.
- **Three more are partially inert**: Inventory Adjustments (4 of 5 ids inactive), Parts Catalog, Users.
- **`Employees` has no row in any of the four tables** — the most fundamental record in the access model is absent from the object model.
- **The policy seed erases `rulesOnly`**, so inside the tenant store a Rules-governed object and an ungoverned one look identical.
- **Only 2 of 19 administration routes carry a capability guard.**

**The honest headline: Administration advertises 56 ids over 25 objects; 30 ids resolve for nobody, 12 objects work on no verb, and the store behind the screen cannot tell a Rules-governed object from an unmodelled one.**

### 8.5 Disposition counts

| Disposition | Count | Surfaces |
|---|---|---|
| `KEEP` | **2** | `/customers` list composition · `/administration/integrations` |
| `IMPROVE` | **9** | `/customers/:accountId` · Financials 04, 07, 14, 18 · `/dashboard` · Administration objects / workflows / users |
| `REPLACE` | **0** | — |
| `REMOVE` | **1** | `SalesWorkspace.jsx`, unrouted and still in the tree (ND-17) |
| `ADD` | **3** | Sales Order lifecycle stamps (ND-8) · operating-company dimension on Opportunity/Account · company axis in the report catalog |
| `PRODUCT GAP` | **14** | SA-G2, SA-G6 · Sales Order missing artifact · Contacts global index · Account P1 artifact · ND-11 lifecycle · `ACCOUNT_PRIMARY_LOCATION_NOT_MODELLED` + 4 rollup/metrics gaps · report sharing · report export · scheduling · 7 reporting placeholders · company-settings · vehicles/regions · notification & list configuration |
| `WORKFLOW GAP` | **13** | Opportunity list · Opportunity record · Sales Agreement record · Sales Order · Financials 01, 02, 03, 05, 06, 13, 15, 19 · financial-policy · password reset |
| `AUTHORITY GAP` | **15** | Sales Territory/Coverage · Contacts/Locations · C-1 commercial profile · Financials 08, 09, 10, 11, 12, 16, 17, 20 · report row-scope · FIN-004 in the report path · roles-permissions · permission-preview/audit-logs · duplicate-rules · Employees as an object · the four-table divergence · `financeManager`/`accountingManager` |
| `UNKNOWN` | **4** | Sales Order missing `DRAFT` state · Opportunity Solution-table deviation · Coverage vs D-C1-6 · whether Postgres `eos_crm` supersedes or duplicates the Firestore CRM path |

**62 routes, grouped into 24 assessed surfaces. Zero `KEEP` in Financials. Zero `KEEP` in Sales.** The two `KEEP`s in the domain are a list whose capabilities are genuinely active and a static FAQ that claims nothing.

### 8.6 UNPROVEN register

Everything below is stated in this document without proof, or was asserted elsewhere and not re-verified here.

1. **Whether §1.2 of the admin policy reconciliation still holds** — that `readGovernedList` resolves only against `COMPATIBILITY_ROLES`, making the 45 governed business Roles declarations rather than live authority. **The highest-priority re-measurement in Administration.**
2. Whether any of the 18 undocumented object/verb disagreements is intended.
3. Whether the removal of `DRAFT` from `SALES_ORDER_STATES` was a decision or a drift.
4. Whether AUTH-PR-3.5 has landed, closing the four confirmed-missing password-reset guards.
5. Whether `functions/src/finance/financialPolicyProfileCommand.ts` is reachable from any deployed surface.
6. Whether `config/environments.json` actually activates any sandbox-eligible id — eligibility is not activation, and I did not open the file.
7. Which of `reportAccess.js:30` and `permissionCatalog.ts:907-941` is stale.
8. Whether the `useSalesAgreement.js` stale comment persists at HEAD.
9. Whether report filters influence the fetch or only the in-memory pass (on the evidence of `reportExecutionService.ts:500`, they do not).
10. Whether ordinary Account edits emit any audit event.
11. Whether the Account Financial Summary distinguishes "no provider" from "not activated".
12. Whether the Opportunity record renders each `closeOpportunityAsWon` refusal distinctly.
13. Dashboard composition Rules 2, 4, 7, 8, 10 — per-tile semantic review not performed.
14. The live deployment set of any callable. The repository can show `EXPORT ≠ DEPLOY` posture comments and nothing more.
15. Whether Coverage supersedes or duplicates D-C1-6, and whether Postgres `eos_crm` supersedes or duplicates the Firestore CRM path. **Both need an Owner ruling, not a measurement.**
16. `inventory.catalog.manage` / `.activate` activity — sibling-lane claim, out of my domain, passed through unverified.

### 8.7 The one methodological finding

Five sibling summaries in this programme have been proven wrong by a lane that checked. **Three more were wrong in what reached me, and I made a fourth error myself before catching it:**

- *"30 of 58"* — denominator wrong (56).
- *"seven objects inert"* — undercount (12), with Transfer Orders wrongly included and Dispatch Schedule wrongly omitted.
- *"the contextual assistant's reorder decisions use a legacy role string"* — true of `RequestReorderControl.jsx`, not of the assistant.
- My own `grep -c 'active: false'` = 119, when the property count is 109; ten hits were comment prose.

**Every one of these is the same failure: a count taken from a text search over a file that talks about itself, or a set named without its denominator.** The `ADMIN_ALL_PERMISSIONS` derivation (§2) is the sharpest instance — a grep over Role sources cannot see a Role whose permission list is `PERMISSION_CATALOG.map(...)`, and that exact mistake has now produced a withdrawn census finding (#1743) and very nearly produced a wrong claim in this document.

**Proposed standing rule, for the coordinator:** a capability claim in this programme must state (a) the file, (b) the predicate that produced the number, and (c) the denominator's definition. *"Granted to no Role"* is not a claim any grep can support and should be refused on sight.
