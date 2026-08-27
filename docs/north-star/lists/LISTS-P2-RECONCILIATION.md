# EOS Lists North Star P2 — Phase 0 reconciliation

**Status:** Phase 0 complete (design reconciled against `main` @ `c75c10dc`). **No code written.**

**Scope rule in force:** presentation-layer migration. Data models, Functions, Rules, capabilities,
roles, state machines, financial logic, numbering, audit, domain derivations, inventory semantics
and existing read/write boundaries are **preserved**, not re-decided.

**Conflict rule:** where a visual requirement conflicts with repository business authority,
**repository authority wins** and the conflict is recorded below rather than closed in the UI.

---

## 0. Headline

P2 is an unusually low-conflict artifact. Every one of its six corrections to Lists P1
(pagination, freshness, unknown-is-not-zero, saved views, columns, sorting) **matches a decision the
Opportunity P1v4 implementation had already made and recorded as a deferral**. Design has converged
on the repository rather than the other way round.

The real work is therefore not "make the repo match the picture." It is:

1. **One grammar, two architectures.** EOS ships two working list architectures. P2's own component
   board (2l) names primitives from *both* and does not ask for either to be deleted. The migration
   is to put the **North Star page grammar on top of the metadata list runtime**, not to replace it.
2. **Extend the honest-state vocabulary from 7 to 17** — and render only the states a family can
   truthfully reach.
3. **Close three latent defects** that the row-to-record rule makes load-bearing (§D).
4. **Close a CI hole**: there is a conformance gate for North Star *record* pages and none for
   North Star *collection* pages (§H).

Zero Class C/D/E/F gaps were found in the shared grammar itself. The design asks for **no new read
authority, no new write authority, no state/workflow change and no financial/business-rule change**
for anything it marks as live.

---

## A. Current collection inventory

Route → component → read source → record route → grammar. Derived from `src/navigation/navConfig.js`,
`src/App.jsx`'s `renderSubnavItem`, and each screen's source.

| Family | Route | Component | List read | Record route | Row → record | Grammar today |
| --- | --- | --- | --- | --- | --- | --- |
| **Opportunities** | `/customers/opportunities` | `sales/OpportunityList.jsx` | `useOpportunities` → `listOpportunityContext` (complete, capped, carries `truncated`) | `/customers/opportunities/:opportunityId` | yes — anchor-deferring row | **North Star** (`WorkspaceIdentity` + `HonestState` + `ns-*`) |
| **Work Orders** | `/service` (domain index) | `workOrders/WorkOrdersList.jsx` | metadata runtime, cursor-paged, CLIENT_DIRECT | `/service/work-orders/:workOrderId` | yes — `onRowClick`, hard-coded and correct | **Hybrid** — `WorkspaceIdentity` header + metadata controls/grid |
| **Accounts** | `/customers` | `accounts/AccountsList.jsx` | metadata runtime + `getAccountPortfolioSummary` (governed server-side counts) | `/customers/:accountId` | yes | metadata runtime + `WorkspaceShell` |
| **Sales Orders** | `/customers/sales-orders` | `sales/SalesOrdersList.jsx` | metadata runtime → `listSalesOrderIndex` (CALLABLE, unscoped) | `/customers/opportunities/sales-order/:salesOrderId` | yes — via `rowNavigationTo` | metadata runtime + `WorkspaceShell` |
| **Equipment / Assets** | `/equipment` | `equipment/EquipmentWorkspace.jsx` → `CustomerEquipment.jsx` (tab 1) | metadata runtime, server-side filters | `/equipment/:equipmentId` | yes | metadata runtime |
| **Part Master** | `/inventory/part-master` | `inventory/PartMasterList.jsx` | `fetchPartMasterPage` over `buildQueryDescriptor` | none (`/inventory/:partId` is the Parts detail) | **no row nav** | metadata chrome + hand-rolled table + `WorkspaceShell` |
| **Parts** | `/inventory` | `inventory/PartsList.jsx` (961 LOC) | `PARTS_CATALOG` + `fetchPartMasterList` + ledger + reorder | `/inventory/:partId` | yes — `Link` | `WorkspaceShell` / `ActionRail`, `MetadataListGrid` in places |
| **Employees** | `/administration` | `administration/EmployeesList.jsx` (61 LOC) | metadata runtime (`employee.index`) | **none** | no | `MetadataListGrid` + `WorkspaceShell` only |
| **Suppliers** | `/purchasing/suppliers` | `purchasing/Suppliers.jsx` | metadata runtime (`supplier.index`) | **none** | no — declares no `rowNavigationTo` | `WorkspaceHeader` + `MetadataListGrid` |
| **Warehouses** | `/inventory/warehouses` | `inventory/Warehouses.jsx` | metadata runtime (`warehouse.index`) | **none** | no — declares no `rowNavigationTo` | `WorkspaceHeader` + `MetadataListGrid` |
| **Manufacturers** | `/inventory/manufacturers` (navHidden) | `inventory/Manufacturers.jsx` | `getManufacturerCatalog` CALLABLE — whole collection, unbounded, no `truncated` | **none** | no | `buildListPresentation` + `MetadataListGrid` |
| **Purchase Orders** | `/purchasing` | `purchasing/PurchaseOrders.jsx` | `useReorderRequestsByStatuses` + `usePurchaseOrdersByIds` — **not** the metadata runtime | **none** | no | `WorkspaceHeader` + `FilterBar` + bespoke table |
| **Receipts** | `/purchasing/receipts` | `purchasing/Receipts.jsx` | reuses `buildPurchaseOrdersView` (RECEIVED subset) | none | no | `WorkspaceHeader` |
| **Transfers** | `/inventory/transfers` | `inventory/Transfers.jsx` | `useTransferOrders` + `buildTransferOrdersView` | none | no | `WorkspaceHeader` + `FilterBar` + bespoke table |
| **Receiving** | `/inventory/receiving` | `inventory/Receiving.jsx` (79 LOC) | none — workflow surface, not a register | — | — | `WorkspaceHeader` |
| **Cycle Counts** | `/inventory/cycle-counts` (navHidden) | `inventory/CycleCounts.jsx` | none — session state from four callables; `cycle_counts` is Rules-denied | — | — | `WorkspaceHeader` |
| **Trucks** | `/inventory/truck-inventory` | `inventory/TruckInventory.jsx` | `truckInventorySource` (client-direct truck registry) | none — a drawer, not a route | no | `WorkspaceShell` + `ContextBand` + `TruckFleetCard` |
| **Contacts** | *(no global route)* | rendered inside `accounts/AccountDetail.jsx` | `useContactsForAccount` → `MetadataListGrid` | **none** | no | related-list only |
| **Prospects** | — | **not a family.** `ACCOUNT_STATUS.PROSPECT` is a status value on Account; same composition (A-D4) | — | — | — | — |
| **Sales Agreements** | *(no collection)* | — | **no collection read exists** — `getSalesAgreementForOpportunity` (per-opportunity) and by-id only | `/customers/opportunities/sales-agreement/:salesAgreementId` | — | record only |
| **Returns** | *(no register)* | scanner workflow only (`mobile/MobileInventorySections.jsx`) | — | — | — | — |

**Derived migration status** — computed, not asserted (`src/metadata/uxMigrationManifest.js`, run
against this tree):

```
workOrder      MERGED_UI      cards=true
salesOrder     MERGED_UI      cards=true
equipment      MERGED_UI      cards=true
part           MERGED_UI      cards=true   (PartMasterList)
purchaseOrder  CONTRACT_ONLY  cards=false  (definition exists; the screen mounts none of it)
account        MERGED_UI      cards=true
```

Opportunity is **absent from the manifest** — it is a complete-read North Star composition, and the
manifest's `MOUNT_EVIDENCE` tokens are all metadata-runtime tokens. Under P2 both data shapes are
first-class, so the manifest can no longer be the single measure of "migrated." See §H.

---

## B. Opportunity P1v4 — what generalises and what does not

### Shared grammar candidates (P2 confirms all of these as EOS-wide)

* Collection identity via `WorkspaceIdentity` (crumb, rule pair, serif title, governed count,
  workload summary, action slot) — **2l names it the ratified primitive**.
* Count and summary render **only on a settled read**; a null count renders nothing.
* Views as `role="radiogroup"`; the active view is URL-stated; the default view leaves no parameter
  behind.
* Narrowing runs **after** derivation, over rows already in hand; the result denominator is the
  **view**.
* Anchor-deferring row: a real `<a>` in the identity cell, the `<tr>` defers to it, no second tab
  stop, no `role="button"` on the row.
* One read per page regardless of row count; directory/reference resolution as a **map lookup**.
* Distinct sentences for loading / denied / unavailable / not-enabled / true-empty / filtered-empty.
* Create as `primary` when permitted, `protected` with **visible reason text** when not.
* Absence vocabulary: `Not estimated` is not `0`; `Unassigned` is not `Unresolved`; existence-only
  relationship words; never a document id as a label.

### Opportunity-specific — must not leak (P2 §2g agrees explicitly)

The six sales stages and the `n of 6` ordinal · `AT_DECISION` / `NEEDS_ATTENTION` view names ·
`deriveAttention`'s four reasons and its **7-day** `CLOSE_SOON` threshold · expected close and its
14-day proximity note · `expectedValue`'s bare-number rule (G5) · the pipeline view set ·
agreement/order lineage · owner-as-salesperson semantics.

The tablet **drop-rather-than-fold** ruling (DECISIONS #136) is a *rule* that generalises; the
specific columns Opportunity drops are Opportunity's.

---

## C. Shared infrastructure map (blast radius)

| Primitive | Consumers | Carries business logic? | Blast radius |
| --- | --- | --- | --- |
| `shared/ui/WorkspaceIdentity.jsx` | **2** (OpportunityList, WorkOrdersList) | No | Low — the growth path |
| `shared/ui/WorkspaceShell.jsx` | 22 | No | **High** — GATE 2 binds it |
| `shared/ui/WorkspaceHeader.jsx` | 11 | No | Medium |
| `shared/ui/ActionRail.jsx` | 13 | No | Medium |
| `shared/ui/HonestState.jsx` | **5** (all sales + WO detail) | No | Low — extend here |
| `shared/ui/StatusPill.jsx` | 33 | No | **High** — see §G.1 |
| `shared/ui/FilterBar.jsx` | 7 | No | Medium |
| `metadata/MetadataListGrid.jsx` | 13 | No (renders a model) | **High** |
| `metadata/MetadataListControls.jsx` | 5 | No | Medium |
| `metadata/ListViewHeader.jsx` | 5 | No | Medium |
| `hooks/useListViewChrome.js` | 5 | Aggregate count + saved-view application | Medium |
| `hooks/useMetadataList.js` | 8 | Paging state only | **High** |
| `metadata/listPresentation.js` | runtime-wide | State + cell vocabulary | **High** |
| `metadata/listUrlState.js` | 6 | Criteria legality | **High** |
| `navigation/objectRoutes.js` | back-links | Route derivation | Low |

**Two architectures, one grammar.** P2's 2l maps onto *both*: `WorkspaceIdentity` + `HonestState`
(North Star) for page structure and feedback; `FilterBar` / `AddFilter` / `ActiveCriteria` /
`ListViewHeader` / `useListViewChrome` (metadata runtime) for narrowing, saved views and the
governed aggregate total. **P2 does not ask for the metadata runtime to be replaced.** Do not
extract a new shared list component; put the North Star header/state/row grammar over the runtime
that already serves each family's read.

---

## D. Authority risk register

| # | Risk | Where | Class | Note |
| --- | --- | --- | --- | --- |
| R1 | `workOrderIndexList.rowNavigationTo = "/work-orders/:id"` — **that route does not exist**; it falls to the catch-all and lands on the Dashboard | `metadata/definitions/workOrder.js:299` | **A** | Harmless today only because `WorkOrdersList` hard-codes the correct path and nothing else consumes it. P2 makes row-to-record load-bearing. |
| R2 | `partIndexList.rowNavigationTo = "/parts/:id"` — **that route does not exist** (`/inventory/:partId` is the real one) | `metadata/definitions/part.js:680` | **A** | Same latency. `PartMasterList` has no row navigation at all today. |
| R3 | **Raw document id rendered as a label**: `{row.partId}` is the visible link text, and `partId` is `type: "REFERENCE" → part` | `modules/inventory/Transfers.jsx:226` | **A** | A real R03 / raw-id violation. Not covered by `rawIdPresentationGuard.test.jsx` (that suite tests the helpers and specific corpora). |
| R4 | `uxMigrationManifest` gives `salesOrder.route` as `/sales/sales-orders`; the real route is `/customers/sales-orders` | `metadata/uxMigrationManifest.js` | **H** | A stale string in a manifest whose whole point is not being stale. |
| R5 | Opportunity is measurable by no manifest; Purchase Orders is `CONTRACT_ONLY` with a full definition | `metadata/uxMigrationManifest.js` | **H** | The manifest needs a second (complete-read) evidence shape. |
| R6 | **No conformance gate exists for North Star collection pages** | `test/compositionConformance.test.jsx` | **H** | `OpportunityList.jsx` and `WorkOrdersList.jsx` are on **no** membership list and satisfy no composition obligation. See §H. |
| R7 | `getManufacturerCatalog` reads the **whole** collection unbounded — no `limit`, no `truncated` | `metadata/callableListSource.js` | **G** | Already recorded in source. A P2 footer must render **nothing** here — not "Load more", not a total. |
| R8 | `listAccountInvoiceAr` returns an **empty array** on `status: "unavailable"`; the generic unwrap reads that as zero rows | `metadata/callableListSource.js` | **G** | Recorded, no consumer today. Must be closed before any Invoice list. |
| R9 | Two search semantics: Accounts / Work Orders issue a **bounded server prefix re-read**; Opportunity narrows **locally** | `useAccountSearch`, `useWorkOrderSearch` vs `filterOpportunityRows` | — | **Not a conflict** — P2 §7 permits both explicitly. Neither widens the governed read: both re-run under the same Rules and the same capability. |
| R10 | Money: only `invoice` and `part` declare `CURRENCY_MINOR`; `opportunity.expectedValue` is a plain number with **no currency field** | definitions | — | Correct today. `salesOrderDollars` has five readings. **No `$` may be added anywhere by this migration.** |
| R11 | `PartsList` (961 LOC) and `PartMasterList` are two Parts collections; P2's 2i study matches neither exactly | `/inventory` vs `/inventory/part-master` | **Owner decision** | Which surface *is* "the Parts collection" is a product question, not a rendering one. |
| R12 | Sales Agreement has an entity but **no list view definition and no collection read** | `metadata/definitions/salesAgreement.js` | **C** if a list is wanted | P2's 2j already marks it `AUTHORITY REQUIRED`. **STOP** — do not build. |
| R13 | Work Order status-group chips carry **no counts**, deliberately | `domain/workOrderStatusGroups.js` | — | P2 §2h agrees: a count over a bounded page is a confident wrong claim. Preserve. |
| R14 | `.fo-button` ships at 40px — four pixels under the touch floor | `index.css`, **ND-6 open** | **Owner decision** | P2 requires 44px minimum "wherever touch is the interaction context". ND-6 already owns this; the Lists migration must not silently re-decide it. |

**N+1 baseline — currently good.** Every metadata list resolves references through a single chunked
`documentId() in` batch (`useAccountReferenceResolver`, `useLocationReferenceResolver`); Opportunity
resolves owners through one `useEmployeeDirectory` subscription and a map lookup; `useListViewChrome`
issues one `getCountFromServer` aggregate rather than tallying rows.
`test/opportunityCollectionPage.test.jsx` renders 25 rows and asserts the governed source was invoked
**once**. **No per-row read, per-row permission request or per-row display-name lookup was found on
any collection surface.** That property must survive the migration; it is the single easiest thing
to lose.

**Denied is not empty, unknown is not zero — currently good.** `HonestState` (7 states) and
`buildListPresentation`'s `LIST_STATE` (6 states) both distinguish denied from empty;
`useListViewChrome` returns `null` on **every** failure path rather than `0`; `cellValue` renders
`Not known` for an enum this build cannot name rather than the machine value.

---

## E. Design-to-Authority matrix

Action values are constrained to: `COMPOSE EXISTING` · `PRESENTATION ONLY` ·
`EXISTING BEHAVIOR PRESERVED` · `TRUTHFUL FALLBACK` · `PRODUCT / AUTHORITY GAP` ·
`OWNER DECISION REQUIRED`.

| # | Design element (P2) | Shared visual rule? | Existing authority | Existing implementation | Gap? | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Anatomy: context line → rule pair → serif title + count + summary → action → views → narrowing → result context → rows | Yes | none needed | `WorkspaceIdentity` (2 consumers) | A — not adopted by 11 families | **COMPOSE EXISTING** |
| 2 | Row anchors to the routed record; no pane, no auto-select | Yes | route table | Opportunity, WO, Accounts, SO, Equipment all correct | A — R1/R2 dead templates | **COMPOSE EXISTING** + fix R1/R2 |
| 3 | 17 UI states, one rendering each; IDLE is not LOADING | Yes | none needed | `HonestState` = **7**; `LIST_STATE` = **6** | A | **PRESENTATION ONLY** — extend the vocabulary; render only reachable states |
| 4 | SELECTION MODE / ACTION IN PROGRESS / FAILURE / SUCCESS | Yes | **governed bulk transitions** | none exist | 2k names it authority-dependent | **PRODUCT / AUTHORITY GAP** — vocabulary only, renders nowhere |
| 5 | OFFLINE / STALE | Yes | retained-data sync queue | exists only in the handheld runtime | — | **TRUTHFUL FALLBACK** — claimed nowhere else |
| 6 | No page numbers; complete read means no footer, cursor read means "Load more" + governed aggregate | Yes | `useMetadataList` cursor paging; `useListViewChrome` aggregate | already exactly this | none | **EXISTING BEHAVIOR PRESERVED** |
| 7 | No "Updated moments ago"; Refresh may render without a recency claim | Yes | — | Opportunity deferred it for this exact reason | none | **EXISTING BEHAVIOR PRESERVED** |
| 8 | Unknown is not zero: null counts render nothing | Yes | — | `useListViewChrome` null-on-failure; My-Opportunities null count | none | **EXISTING BEHAVIOR PRESERVED** |
| 9 | Definition-declared saved views are live; **user** "+ Save as view" renders nowhere | Yes | `listViewDefinition.savedViews` + `ListViewHeader` | live on 5 surfaces; absent on Opportunity | A — Opportunity shows no view selector, its views are domain slices, which 2g endorses | **EXISTING BEHAVIOR PRESERVED** |
| 10 | No Columns control | Yes | — | none exists | none | **EXISTING BEHAVIOR PRESERVED** |
| 11 | Sorting Pattern A (governed order, no control) / Pattern B (declared sorts only) | Yes | `defaultSort` + `sortable` columns + index governance | Opportunity = A; WO / Accounts / SO / Equipment / Part = B | none | **EXISTING BEHAVIOR PRESERVED** |
| 11b | Pattern B must state on screen that sorting by an optional date hides records lacking it | Yes | `describeSort` / `summarizeListView` | the sentence is not present | A | **PRESENTATION ONLY** |
| 12 | Search placeholder names exactly what search reaches; ids are never searchable | Yes | `accountSearchQueryShape`, `workOrderSearchQueryShape` | WO placeholder already says "starts with"; others are generic | A | **PRESENTATION ONLY** |
| 13 | Result denominator is the view | Yes | — | `opportunityResultContext` does this; metadata surfaces render `summarizeListView` instead | A | **COMPOSE EXISTING** |
| 14 | Five relationship treatments; never per-row reads; never ids as labels | Yes | `referenceResolution.REFERENCE_STATE` + batched resolvers | correct everywhere except R3 | A | **PRESENTATION ONLY** + fix R3 |
| 15 | Create: rendered / protected-with-reason / absent | Yes | each object's write-readiness seam | Opportunity correct; others vary | A | **COMPOSE EXISTING** |
| 16 | Object state is words + tone families, **no pills**, never colour alone | Yes | each domain's status vocabulary | `StatusPill` on 33 surfaces | A, but see §G.1 | **OWNER DECISION REQUIRED** (scope + sequencing) |
| 17 | Attention is its own first-class column where the object derives one; absent where it does not | Yes | `deriveAttention`, `partsAttentionProjection`, `workOrderAttentionProjection`, `accountAttentionProjection`, `salesOrderAttention`, `obligationAttention` | list-level only on Opportunity | **B** for Parts — the projection exists, the list does not use it | **COMPOSE EXISTING** for Parts |
| 17b | Work Orders: the attention slot is **preserved, not faked** | Yes | record-level derivations only; no list projection | no column | 2h names it | **TRUTHFUL FALLBACK** — no column until a list projection exists |
| 18 | Real content widths (nav consumes 248–252px; 1440 → ~1160) | Yes | `--rail-width: 252px` | matches | none | **EXISTING BEHAVIOR PRESERVED** — see §G.2 on ND-16 |
| 19 | Tablet: drop before fold | Yes | DECISIONS #136 | Opportunity correct; the metadata grid uses `fo-table--stack` cards | A | **PRESENTATION ONLY** |
| 20 | Mobile 375/320 structured rows, 44px minimum, no horizontal overflow | Yes | `.ns-collection__table` phone recomposition; `fo-table--stack` | two mechanisms | A + ND-6 | **PRESENTATION ONLY** (ND-6 stays the Owner's) |
| 21 | Numeric right-aligned and tabular; currency only where governed | Yes | `NUMERIC_CELL_TYPES`, `formatMinor`, `salesOrderDollars` | correct | none | **EXISTING BEHAVIOR PRESERVED** |
| 22 | Export / bulk actions / full-text search | Yes (2k) | none exist | none | **C / D** | **PRODUCT / AUTHORITY GAP** — STOP |
| 23 | Sales Agreement collection | 2j: `AUTHORITY REQUIRED` | no collection read | none | **C** | **PRODUCT / AUTHORITY GAP** — STOP |
| 24 | Contact route | 2j: `PRODUCT DECISION` | no per-contact read, no route | related list only | **C** | **OWNER DECISION REQUIRED** |
| 25 | Truck stock quantities on a list | 2j: `AUTHORITY REQUIRED` | no live truck-stock read | none | **C** | **PRODUCT / AUTHORITY GAP** — STOP |
| 26 | Parts: On hand is not Available; no Available column; provenance visible | Yes (2i inviolable) | inventory semantics | no Available column exists today | none | **EXISTING BEHAVIOR PRESERVED** |
| 27 | Parts: Scan as a second, non-mutating header action | Yes | `ScanWorkspace` / `PartsScanner` exist | not on the Parts list header | **B** | **COMPOSE EXISTING** (after R11 is decided) |
| 28 | Receiving and Returns must not be rendered as registers | Yes | Rules refuse receiving in places; returns never auto-restore stock | already workflow surfaces | none | **EXISTING BEHAVIOR PRESERVED** |

---

## F. Gap classification summary

* **Class A — presentation-only.** Items 1, 2, 3, 11b, 12, 13, 14, 15, 16, 19, 20, plus R1, R2, R3.
  Proceed under the presentation migration.
* **Class B — authority exists, the client does not compose it.** Item 17 (Parts attention), item 27
  (Scan action). Proceed after verifying no backend change is needed.
* **Class C — new read authority required.** Sales Agreement collection read, Contact per-contact
  read, truck stock read, full-text search read, export read. **STOP. Not built.**
* **Class D — new write authority required.** User saved-view persistence, column preferences, bulk
  mutations. **STOP. Not built.**
* **Class E / F — state, workflow, financial or business-rule change.** **None found.**
* **Class G — fixture / data limitation.** R7 (unbounded manufacturer catalog), R8 (invoice
  envelope), Work Order per-bucket counts, Sales Order's absent total and timestamp.
* **Class H — tooling / gate limitation.** R4, R5, R6.

---

## G. Named conflicts and carried decisions

1. **Item 16 — `StatusPill` versus "no pills".** P2 §2e rules object state as *words + tone
   families, never pills*. `StatusPill` is on 33 surfaces and was the **approved replacement** for
   the retired `fo-badge`. Verified against the gate source:
   `test/compositionConformance.test.jsx` **forbids `fo-badge` and never mandates `StatusPill`** —
   so a family may move a list-row state to tone-words without breaking GATE 1, 3 or 4. It is still
   a visible change to already-ratified surfaces, so scope and sequencing are the Owner's, not this
   migration's. ND-7 is **not** in conflict: it resolved the *record* treatment as a sentence, which
   is the same "words carry the meaning, colour is emphasis" rule.
2. **ND-16 partially narrows.** P2 §11 adopts **248–252px** for the application nav, which is the
   shipped `--rail-width: 252px`. The rail half of the Design/repo disagreement is closed by the
   artifact itself. The `340px` / `56px` **record**-body split remains open, and it is not a Lists
   question.
3. **ND-6 (the 40px `.fo-button`) is unchanged and still the Owner's.** P2 restates the 44px floor
   for touch contexts; this migration must not silently re-decide it.
4. **R11 — which surface is "the Parts collection"** is an Owner/product call. P2's 2i column set
   (Part · Manufacturer · Category · Control · Status · On hand · Attention) is closest to
   `PartMasterList` plus `partsAttentionProjection`, not to the 961-line `PartsList` workspace.
5. **P1v4's handoff cites a "Lists P1 16-state system" and a "list engine" it says Opportunity
   reuses.** Neither was ever in this repository, and `OpportunityList.jsx` uses **no** metadata
   list engine. P2 supersedes P1 and states the count as **17**. Read P1v4's "reused platform" line
   as design intent, not as an implementation claim.

**No design requirement was found that conflicts with repository business authority.** Nothing in P2
requires the business to change in order to make the mock true.

---

## H. The CI hole this migration must close first

`test/compositionConformance.test.jsx` has three membership lists:

* `CONFORMANT_WORKSPACES` — **must** import `WorkspaceShell` (GATE 2)
* `NORTH_STAR_RECORD_PAGES` — **must** compose `ns-page` + `RecordIdentity` and **must not** import
  `WorkspaceShell` (GATE 2b), with derived membership so the list cannot be quietly emptied (GATE 2b²)
* `CONFORMANT_SURFACES` — no `fo-badge` (GATE 3)

There is **no list for collection pages**. Consequences, all verified against source:

* `OpportunityList.jsx` and `WorkOrdersList.jsx` — the two surfaces already on the North Star
  collection grammar — appear on **no list** and satisfy **no** composition obligation.
* `AccountsList.jsx` is on `CONFORMANT_WORKSPACES`. Migrating it off `WorkspaceShell` onto
  `WorkspaceIdentity` **fails GATE 2** unless a third list exists to move it to.
* `NORTH_STAR_RECORD_PAGES` cannot absorb a collection: it demands `RecordIdentity`, which a
  collection does not compose.

**Phase 1 therefore begins with `NORTH_STAR_COLLECTION_PAGES`** — membership derived the same way
GATE 2b² derives it (any surface composing `ns-workspace` / `WorkspaceIdentity` must be declared),
with `WorkspaceShell` mutually exclusive, and the whole thing registered in a path-filtered
workflow. Per `test/ciSuiteCoverage.test.mjs`, **a suite runs in CI only where a workflow names it**
— a green PR whose expected lane was never created is **CI-INCOMPLETE**, not passing.

Also to close in Phase 1: R4 (the stale manifest route) and R5 (a complete-read evidence shape, so
Opportunity becomes measurable and Purchase Orders' `CONTRACT_ONLY` stays honest).

---

## I. Proposed migration sequence

Each family: focused implementation → tests → merge → **Owner-triggered** sandbox refresh → Quick
Gate → **Owner visual acceptance** → ledger update → next family. **No mass migration.** A Full
Regression Gate is required only if a slice crosses the authority threshold; none of Phases 1–5 is
expected to.

| Phase | Scope | Why here | Authority crossed |
| --- | --- | --- | --- |
| **0** | *This document.* | Contradictions classified before code. | none |
| **1** | Shared presentation primitives: the `NORTH_STAR_COLLECTION_PAGES` gate and its workflow lane · extend `HonestState` from 7 to 17 (vocabulary only; unreachable states render nowhere) · IDLE distinguished from LOADING · fix R1, R2, R4, R5 | The gate must exist before the first list moves, or the migration is CI-uncovered. Nothing is extracted that two families have not already proven. | none |
| **2** | **Opportunity conformance.** Re-read P1v4 against P2 and change only where P2 genuinely differs. | P1v4 works and is Owner-visible. Do **not** rewrite it for component purity. Expected delta: near zero. | none |
| **3** | **Work Orders** — the first non-sales proof family, and the one that proves the **cursor-paged** shape ("Load more" + governed aggregate + count-less status chips + prefix search with the gap named). Already half-migrated (`WorkspaceIdentity` header). | Proves the grammar over the metadata runtime rather than over a complete read. | none |
| **4** | **Parts / Inventory** — a different operational domain. **Blocked on R11** (which surface is the collection). Brings item 17 (attention from `partsAttentionProjection`) and item 27 (the Scan action). | Proves the grammar outside sales and service. | none |
| **5** | **Accounts** → **Sales Orders** → **Equipment** → **Employees** → **Suppliers** / **Warehouses** / **Manufacturers** → **Purchase Orders** → **Transfers** (carries R3) → **Trucks** | Descending evidence, ascending risk. Purchase Orders is `CONTRACT_ONLY`, and Transfers and Trucks are marked `unverified` in 2j — each needs its own source inspection first. | none |
| **—** | Sales Agreements · Contacts · Returns · Receiving registers · truck stock · export · bulk actions · full-text search · user saved views · column preferences | Class C / D. | **STOP** |

---

## J. Test map (prepared, not written)

Per-family focused suites, modelled on `test/opportunityCollectionPage.test.jsx` — the reference, and
the right one: its 43 tests survived 19 mutations with a single equivalent mutant.

Governed identity displayed and **zero document ids** · **one governed read regardless of row count**
· row navigates to the **real** record route, and that route exists · object state, attention and UI
state stay separate · denied is not empty · unavailable is not empty · unknown is not zero · search
and filter cannot widen the governed result set · the result denominator is the view · responsive
information priority and drop-before-fold · no horizontal overflow at 375 or 320 · touch-target floor
· action visibility follows existing authority · no dead controls · money truth (no fabricated `$`) ·
no invented freshness · no invented pagination · no invented saved-view persistence.

**Existing lanes that must stay green:** `composition-conformance-tests.yml` (the primary lane) ·
`metadata-contracts-tests.yml` · `client-suite-manifest-tests.yml` · `vite-build-check.yml`.

**Existing protections to reuse rather than duplicate:** `rawIdPresentationGuard.test.jsx`,
`uxMigrationManifest.test.jsx`, `objectListMetadataAuthority.test.mjs`,
`metadataConvergedFeatures.test.mjs`, `listViewChrome.test.jsx`.

---

## K. Release rule

No deploy in Phase 0 or Phase 1 without the Owner. Per family: merge → **Owner-triggered** sandbox
refresh under the existing governed release process → Quick Gate → verify the deployed identity from
`/version.json` (never from an exit code) → visual comparison against the approved artifact → Owner
acceptance → ledger update. **Test green is not visual acceptance.**
