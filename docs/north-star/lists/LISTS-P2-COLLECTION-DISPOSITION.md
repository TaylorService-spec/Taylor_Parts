# EOS collection disposition — every collection surface, classified

**Governance:** Owner addendum, 2026-08-27 ("Global application — all EOS lists"). The addendum's
rule is that no object may be silently skipped and none may be forced into the List grammar when its
interaction archetype legitimately differs. This file is the proof that every existing collection
surface was considered.

**Method:** derived from source at `main` @ `c75c10dc` — the routed nav table
(`navigation/navConfig.js` + `App.jsx`'s `renderSubnavItem`), every file rendering a `<table>` under
`src/modules` and `src/shared`, every consumer of `MetadataListGrid`, and every card/queue surface
under the board, handheld, scan, dashboard and administration module trees. **75 surfaces.**

**Classification:**

| | |
| --- | --- |
| **MIGRATE** | A true object collection. One row is one governed record of one family. Gets the full List North Star grammar. |
| **COMPOSE** | A specialised collection. Uses the shared List primitives (states, absence vocabulary, row identity, reference resolution) at a lighter configuration — typically the metadata layer's own `LIST_SURFACE: "RELATED"`. Does **not** get a page header, views row or footer: it lives inside another page. |
| **EXEMPT** | A legitimately different interaction archetype — a board, a scanner, a wizard, a matrix, a dashboard panel, an editor. Forcing it into the List grammar would destroy the thing it is good at. Still bound by the shared **vocabularies** (honest states, absence, no raw ids, touch floor). |
| **BLOCKED** | Needs a genuine domain or governance decision before it can be classified. Named with the exact question. **Reported, never resolved by manufacturing the authority that would make the surface conform.** |

**A fifth bucket is stated separately, deliberately.** *Not a surface* — a nav placeholder or a
retired screen with no collection behind it. The four classifications describe surfaces that exist;
recording these as EXEMPT would claim a considered design decision where the honest answer is "there
is nothing here yet."

---

## The Owner's proving set — status

**Owner ruling, 2026-08-27: the proving set is four.** Selling Agreement was removed from it and
classified EXEMPT — see §3.1. Four families are sufficient to prove the shared abstraction.

| Family | Disposition | Note |
| --- | --- | --- |
| Customer / Account | **MIGRATE** | Phase 4 |
| Opportunity | **MIGRATE** | Phase 2 — the reference implementation |
| Sales Order | **MIGRATE** | Phase 5 |
| Work Order | **MIGRATE** | Phase 3 — the cursor-paged proof |
| ~~Selling (Sales) Agreement~~ | **EXEMPT** | Removed from the proving set by Owner ruling. §3.1. |

---

## 1. MIGRATE — object index collections (14)

One row is one governed record. These get the full grammar: context line, rule pair, serif identity
with governed count, primary action in its three treatments, views, narrowing, result context, rows,
and the footer the read's data shape justifies.

| # | Family | Route | Read shape | Record route | Phase |
| --- | --- | --- | --- | --- | --- |
| 1 | Opportunities | `/customers/opportunities` | complete | `/customers/opportunities/:opportunityId` | 2 |
| 2 | Work Orders | `/service` | cursor-paged | `/service/work-orders/:workOrderId` | 3 |
| 3 | Accounts / Customers | `/customers` | cursor-paged + governed summary | `/customers/:accountId` | 4 |
| 4 | Sales Orders | `/customers/sales-orders` | cursor-paged (CALLABLE) | `/customers/opportunities/sales-order/:salesOrderId` | 5 |
| 5 | Part Master | `/inventory/part-master` | cursor-paged | `/inventory/:partId` — **declared but not wired**; Phase 6 wires it | 6 |
| 6 | Equipment / Assets | `/equipment` (Customer Equipment tab) | cursor-paged | `/equipment/:equipmentId` | 7 |
| 7 | Employees | `/administration` | cursor-paged | **none** — gap recorded, no route invented | 7 |
| 8 | Suppliers | `/purchasing/suppliers` | cursor-paged | **none** — declares no `rowNavigationTo`, correctly | 7 |
| 9 | Warehouses | `/inventory/warehouses` | cursor-paged | **none** — same | 7 |
| 10 | Manufacturers | `/inventory/manufacturers` *(navHidden)* | **whole collection, unbounded** | **none** | 7 |
| 11 | Purchase Orders | `/purchasing` | bespoke (two hooks, not the runtime) | **none** | 7 |
| 12 | Transfers | `/inventory/transfers` | bespoke over a shared view-model | **none** | 7 |
| 13 | Trucks | `/inventory/truck-inventory` | client-direct truck registry | **none** — a management **drawer**, not a route | 7 |
| 14 | Parts (catalog workspace) | `/inventory` | catalog + ledger + reorder | `/inventory/:partId` | see §1.1 |

### 1.1 — `/inventory` stays a workspace

Owner ruling, 2026-08-27: Part Master at `/inventory/part-master` is **the Parts collection**; the
Inventory workspace at `/inventory` remains separate. `PartsList.jsx` (961 LOC) composes a catalog
table *plus* the Inventory Health panel, the reorder manager queue and the associate request panel —
four surfaces on one page. Its catalog **table** adopts the shared row grammar and the honest-state
vocabulary; the page does **not** become a List North Star collection page, because it is not one.
Recorded so a later pass does not "finish the migration" by flattening a workspace into a list.

### 1.2 — Carried gaps on the MIGRATE set

* **#7–#13 have no record route.** Under P2, a row anchors *where a routed record page exists*.
  Where none does, the row does not become a link and **no route is invented** — that is a product
  decision, not a rendering one. Each family's migration records the gap.
* **#10 Manufacturers** reads the entire collection in one call with no `limit` and no `truncated`
  flag (`getManufacturerCatalog`). Its footer must render **nothing** — not "Load more", not a
  total. Recorded as R7.
* **#11 Purchase Orders** is `CONTRACT_ONLY`: a full metadata definition exists and the reachable
  screen mounts none of it, over a *different collection* from the one that stores PO money.
  Migration must not attach `totalCost` from `purchase_orders` to rows read from
  `reorder_purchase_orders`.
* **#12 Transfers** renders a part **document id** as its own visible link label
  (`Transfers.jsx:226`). R3 — fixed as part of its migration, not before.
* **#13 Trucks** — the drawer is the record surface. Do not promote it to a route during a list
  migration.

---

## 2. COMPOSE — specialised collections using shared primitives (24)

These are collections, but they live inside another page or answer a narrower question. They take
the shared **row identity, absence vocabulary, reference resolution and honest states**, and they do
**not** take the page header, views row, or footer. The metadata layer already models this shape as
`LIST_SURFACE: "RELATED"` — capped rows, no paging controls, a "view all" that hands off to the
INDEX pre-filtered by parent.

**The addendum's context-without-duplication rule binds hardest here.** A related list shows enough
governed context to explain *why the relationship matters on this surface* — and never rebuilds the
referenced object's record page inside a row, an expanded row, a rail, a drawer, a card or a preview.

### Account record (family 3)

| # | Section | Note |
| --- | --- | --- |
| 15 | Contacts | already on `MetadataListGrid` via `useContactsForAccount` |
| 16 | Locations | hand-rendered; has per-row affordances the shared grid now supports |
| 17 | Opportunities | CALLABLE-read related list |
| 18 | Sales Orders | CALLABLE-read related list; `rowNavigationTo` consumed here |
| 19 | Equipment | account-scoped equipment read gap (Account P1) carried |
| 20 | AR / Invoices | `finance.read`-gated; **denied must keep its geography** (A-D2) |
| 21 | Service Activity | |
| 22 | Attention items | derived, not a collection read |

### Part record

| # | Section |
| --- | --- |
| 23 | Used in Equipment |
| 24 | Part Identifiers |
| 25 | Work Order Demand |
| 26 | Inventory actions / activity |

### Sales / Service records

| # | Section | Note |
| --- | --- | --- |
| 27 | Sales Order → lines | money authority preserved exactly (`salesOrderDollars`, five readings) |
| 28 | Sales Order → fulfillment | |
| 29 | Sales Agreement → lines | |
| 30 | Opportunity → solution lines | `LineSummary`; the P1v2 three-column deviation is still the Owner's to reject |
| 31 | Work Order → parts plan (read view) | the **editor** is EXEMPT, #57 |
| 32 | Equipment → inventory control section | |
| 33 | Equipment → timeline | |

### Standalone specialised collections

| # | Surface | Note |
| --- | --- | --- |
| 34 | Receipts `/purchasing/receipts` | **Should become a saved VIEW of Purchase Orders, not a second list.** It already reuses `buildPurchaseOrdersView`'s RECEIVED subset and reads no `receiving_orders`. Two lists over one projection is exactly how the definitions and the screen drift apart. |
| 35 | Equipment Register (account-scoped) | deliberately *not* the business-wide list; its create flow needs one fixed Account |
| 36 | Available Equipment tab | honest not-yet-connected serialized-asset surface |
| 37 | Saved Reports `/reporting/saved` | a collection of governed report definitions |
| 38 | Admin → Users | gated inert today; still a collection of users |
| 39 | Admin → Duplicate Rules | reads the seeded ruleset; every edit control protected+disabled |

---

## 3. EXEMPT — different interaction archetypes (29)

### 3.1 — Selling (Sales) Agreement · **Owner ruling, 2026-08-27**

Raised as BLOCKED, and resolved by ruling rather than by building the read.

**The ruling: Option B.** A Selling Agreement is not required to gain a collection read merely to
participate in List North Star. The governed navigation model is preserved as it stands —
**Opportunity → Selling Agreement** — because *EOS presently defines a Selling Agreement as a
relationship-owned object reachable through its Opportunity, not as an independently browsable
collection.* That is a statement about the product, not about the migration, which is why it settles
the question rather than deferring it.

**Explicitly not created:** ~~listSalesAgreements~~ · ~~a Selling Agreement collection projection~~ ·
~~a capability~~ · ~~Rules~~ · ~~a route~~ · ~~a synthetic client-side collection~~. The last one is
the one worth naming: assembling a browsable set on the client from per-opportunity reads would have
produced a surface that *looked* like the others while being an N+1 fan-out wearing a collection's
clothes, and it would have created the product capability by accident — which is precisely what the
ruling withholds.

**This is not a permanent ruling that EOS may never have one.** It means List North Star is not
authorised to *create that product capability*. If a future operational requirement establishes that
users need to browse Selling Agreements independently, that is a separate governed product decision,
and the collection and its read authority get designed intentionally rather than arriving as a side
effect of a presentation migration.

The Sales Agreement **record** family (family 5) is accepted, untouched, and unaffected.

### 3.2 — The rest

Still bound by the shared **vocabularies** — honest states, absence, `Unassigned ≠ Unresolved`, no
document ids as labels, the touch floor. Not bound by the page anatomy.

### Operational boards — a time or assignment axis, drag-drop, realtime subscriptions (7)

40 Dispatcher Board · 41 Dispatch Queue · 42 Scheduling Workspace · 43 Dispatch/Scheduling Workspace ·
44 Control Tower / Service Operations panels (At Risk, Dispatch Queue, Overloaded Tech, Parts
Overview, WO Attention, Activity Timeline) · 45 Coordinated Visits Workspace · 46 Coordinated Mission
View.

> **Why exempt, not lazy.** `useWorkOrders` — the realtime subscription five of these share — was
> deliberately left in place when Work Orders migrated to the bounded list: "a board that shows a job
> five seconds late is a board that sends the wrong technician." Two surfaces, two contracts. Paging
> a dispatch board would be a dispatch decision taken under cover of a list migration.

### Handheld and scan workflows — one task at a time, not a set to compare (10)

47 Technician Shell / FieldMode · 48 Warehouse Shell · 49 Scan Workspace · 50 the six scan journeys
(Lookup, Pick, Put-away, Transfer, Cycle Count, Return Intake) · 51 Parts Scanner · 52 Multi-Scan
Receiving · 53 Receiving `/inventory/receiving` · 54 Cycle Counts `/inventory/cycle-counts` ·
55 Sync Queue / Warehouse Sync Queue · 56 Mobile inventory sections (stock, reservations, serialized
assets, activity, reconciliation, returns).

> P2's own 2j: **"Receiving — workflow surface, not a register"**, and **"Returns never auto-restore
> stock — the list must not imply it."** Rendering either as a register would imply an operational
> effect the authority refuses.

### Editors, wizards and matrices (6)

57 Work Order Parts Plan editor · 58 Work Order Wizard · 59 Contact Import modal · 60 Admin → Roles &
Permissions (a role × permission matrix) · 61 Admin → Objects (a matrix over metadata) · 62 Report
Builder (a builder; its **results grid** is arbitrary-shaped by definition and is exempt with it).

### Dashboard panels and summaries — tiles over a projection, not a set to scan (5)

63 Operations panels (Inventory Health, Procurement, Warehouse, Execution Insights) · 64 Inventory
role homes (Parts Manager, Warehouse Manager, Parts Associate) · 65 Technician Dashboard ·
66 Administration Overview · 67 Notification Panel and Global Search results · 68 Reorder panels
(Manager Queue, Associate Request, Assigned Work Oversight).

---

## 4. Not a surface — nothing to migrate (7)

Stated separately because classifying them would claim a design decision where none was taken.

| # | Item | State |
| --- | --- | --- |
| 69 | `Technicians.jsx` | **Unrouted dead code.** Its only nav item (`administration/employees`, `legacyKey: "technicians"`) is intercepted by the explicit `EmployeesList` branch, so `LEGACY_COMPONENTS.technicians` never renders. Superseded by the Owner's 2026-08-20 ruling that "technician is a role". Same status as `Inventory.jsx`. |
| 70 | `SalesWorkspace.jsx` | The retired Opportunity master-detail pane (ND-17: unrouted but still in the tree). |
| 71 | Quotes, Demand Planning | `/purchasing` placeholders; no object, no read |
| 72 | Back Orders, Warranty | `navHidden` placeholders |
| 73 | Regions, Vehicles, Company Settings | Administration placeholders |
| 74 | Notification history | placeholder; the bell is the live surface |
| 75 | Prospects | **Not a family.** `ACCOUNT_STATUS.PROSPECT` is a status value on Account and composes as the same page (A-D4). |

---

## 5. BLOCKED — genuine decisions required (4)

Each is a STOP condition under the addendum. None is absorbed into List infrastructure.

### 5.1 — *(withdrawn)* Sales Agreement collection

**Resolved by Owner ruling, 2026-08-27 — Option B.** No longer blocked, because the collection is no
longer sought. Reclassified **EXEMPT**; the reasoning is recorded in full at §3.1.

### 5.2 — Job Assignments (`/service/job-assignments`)

`Jobs.jsx` reads the **same** governed `fieldops_wos` collection as the Work Orders list, through the
realtime subscription, with an assignment lens. It is a second Work Order surface, not a second
object.

> **Decision required:** is Job Assignments a distinct operational surface (→ EXEMPT, an assignment
> board) or an assignment **view** of the Work Orders collection (→ folded into Phase 3)? This is the
> same shape as the Employees/Technicians question the Owner settled on 2026-08-20, and it is a
> product call, not a rendering one.

### 5.3 — Contacts as a global collection

`contactIndexList` declares `surface: "INDEX"`, and there is no global route, no per-contact read and
no record page. P2's 2j marks it `PRODUCT DECISION`. A Contacts index needs a route and a record —
both new. Contacts stay account-scoped (#15) meanwhile.

### 5.4 — Returns register

Scanner workflow only; no register, no read. Building one would imply stock effects the authority
refuses.

### 5.5 — Audit Logs · Permission Preview

Both render `AdministrationUnavailable`: the governed collections are deny-all in Rules and no Cloud
Function read path is deployed. A list needs a read that does not exist.

---

## 6. The restraint rules that bind every migration

Recorded here because they are acceptance criteria, not preferences (Owner addendum, 2026-08-27).

**A list is a scanning and navigation surface, not a compressed record page.** It exists to
identify → understand state → recognise attention → compare with neighbours → decide whether to
open. **Absence is intentional.** Data existing in an EOS domain model creates no requirement to
display it. A field earns a column only by materially improving identification, scanning,
comparison, prioritisation, navigation, or the immediate operational decision.

**Context without duplication.** Show only enough governed context to understand why a relationship
matters here. Never rebuild the referenced object's record page inside a row, expanded row, rail,
drawer, card or preview.

**Shared grammar ≠ identical content.** Each domain keeps ownership of which columns are legitimate,
which states are meaningful, which attention signals exist, which filters are supported, which
actions are authorised, whether bulk operations are legitimate, and what may be omitted at narrower
widths. Never manufacture domain behaviour to make an object conform to a shared component.

**Intel restraint.** No per-row AI summary; no duplicated record-level intelligence; AI never decides
row state or business truth; no fabricated priority, probability, money, inventory, dates, people or
actions; no AI action without an existing governed EOS action. List-level intelligence is limited to
exceptional scanning signals that are already governed deterministic facts. **The list is never an
AI authority surface.**

**Density.** Strong row identity, few high-value facts, clear state, selective attention, predictable
alignment, obvious navigation. Not 15 columns because 15 fields exist; not two pills for one concept;
not a duplicated account name; not verbose prose in a row; not an embedded mini record page; not
horizontal scroll as the phone interaction.

### The ten-question acceptance test — run per family before merge

1. Can I identify this record quickly?
2. Can I see its current meaningful state?
3. Can I tell if it needs attention?
4. Can I compare it with nearby records?
5. Can I open the correct record?
6. **Is anything shown that belongs on Detail instead?**
7. **Did we display a field merely because it was available?**
8. **Did we duplicate context from another object?**
9. **Did the list invent a fact, action or authority?**
10. Does handheld preserve the operational answer without becoming a tiny desktop table?

**A YES on 6, 7, 8 or 9 means simplify before merge.** Each family's migration records its answers.

---

## 7. Family answers to the acceptance test

Appended as each family merges. A YES on 6, 7, 8 or 9 means simplify before merge.

### Phase 2 — Opportunity (`/customers/opportunities`) · merged

The delta was near zero, as forecast. P1v4 had already made every choice P2 later ratified —
complete read so no pagination, Pattern A ordering so no sort control, no freshness claim, no
`+ Save as view`, no Columns control, existence-only relationship words, bare numbers with no
currency. Three things genuinely differed:

1. **A search that found nothing and a filter that ate everything shared one sentence.** Split. The
   search half now echoes the term and states that it reached only the rows loaded in this view; the
   filter half keeps the count it is narrowing away, beside the checkboxes that caused it.
2. **An unresolved viewer rendered as an empty view.** The sentence was already right — "we can't
   tell which opportunities are yours" — but it came through the empty-state component, which framed
   a resolution failure as a result. It is now `UNKNOWN`, a state with no count slot at all, so a `0`
   cannot appear beside it. The way out is kept.
3. **The search placeholder named three fields and matched four**, and named the object rather than
   the fields — implying stage, value and close date were searchable. Now: reference, need, customer,
   owner.

| # | Question | Answer |
| --- | --- | --- |
| 1 | Identify quickly? | Yes — governed reference bold, need beneath. |
| 2 | Current meaningful state? | Yes — the six governed stage words plus the `n of 6` ordinal. |
| 3 | Needs attention? | Yes — `deriveAttention` in its own column, never folded into stage. |
| 4 | Compare with neighbours? | Yes — attention first, then closing soonest; a governed operational order, not a spreadsheet. |
| 5 | Open the right record? | Yes — the reference is a real anchor; the row defers to it. |
| 6 | **Anything that belongs on Detail?** | **No.** Eight columns; the record holds lifecycle, activity, lines, terms and history. |
| 7 | **Any field shown merely because it existed?** | **No.** The projection also carries ids, channel keys and line arrays. Channel appears only as a subtitle where it disambiguates a customer; the rest do not appear. |
| 8 | **Duplicated context from another object?** | **No** — and this is the column where it would have happened. Agreement / Order states *existence* and stops: "Agreement", "Order created", "No agreement". No reference, no state, no per-row read, no fragment of the Agreement record. |
| 9 | **Invented a fact, action or authority?** | **No.** No currency on `expectedValue` (G5), no pipeline maths, no probability, no forecast, no inline stage mutation, no agreement workflow. Create is the existing governed form, rendered `protected` with the seam's own reason when write-readiness is off. |
| 10 | **Handheld preserves the answer?** | Yes — 375/320 recompose to structured rows (reference + attention, customer, stage · value · close · owner); the tablet **drops** rather than folds, per DECISIONS #136. |

**States reachable here:** IDLE (not reached — the source seam is injected and settles), LOADING,
POPULATED, TRUE_EMPTY, EMPTY_VIEW, SEARCH_ZERO, FILTER_ZERO, UNKNOWN, NOT_ENABLED, DENIED,
UNAVAILABLE. **DEGRADED is deliberately not rendered**: the read returns `accountNameById` with no
signal distinguishing "resolution failed" from "no name recorded", so the per-cell
"Customer — name unavailable" is the whole truth available and a quiet line above the table would be
a claim the read cannot support. OFFLINE_STALE and the four bulk-action states are unreachable
platform-wide.

### Phase 3 — Work Orders (`/service`) · merged

The cursor-paged proof. Most of P2's shape was already here and already correct — governed aggregate
total (null on failure, never 0), "Load more" instead of invented page boundaries, count-less status
chips, definition-declared filters/sorts/saved views, filter tokens and dropped/refused notices, the
customer filter as a picker of names, and a bounded prefix search with `WORK_ORDER_TEXT_SEARCH_GAP`
named rather than implied. Three things changed:

1. **The row destination now comes from the definition.** The screen navigated to a hard-coded path —
   correct, and correct in *one* of the two places that claimed to know the answer. `rowNavigationTo`
   said `/work-orders/:id`, a route this application does not mount, and the disagreement was
   invisible because nothing read the definition. Reading it makes the declaration guardable.
2. **DEGRADED became reachable.** Customer and Technician resolve through separate reads and either
   can fail while every work order loads perfectly. Each cell already said so in its own place; a
   reader scanning a column of "Name unavailable" could not tell one bad record from one failed read.
   One quiet line above the table now says which — and **withheld is a different sentence from
   failed**, because a permission fact no retry changes must not wear the words of a failure a retry
   might fix.
3. **The status chips were re-checked, not re-decided.** A shared grammar is exactly the moment
   somebody adds per-bucket counts back "for consistency". P2 2h agrees with the decision already
   made here, and a test now holds it.

| # | Question | Answer |
| --- | --- | --- |
| 1 | Identify quickly? | Yes — `WO-` reference bold, complaint beneath. |
| 2 | Current meaningful state? | Yes — the governed status vocabulary, grouped so every status is in exactly one chip. |
| 3 | Needs attention? | **Not yet, and not faked.** Attention derivations exist on the *record*; no collection-level projection does. P2 2h calls for the slot preserved, not invented — a test asserts no attention column and no `workOrderAttention` import. Closing it needs a projection, which is a read change. |
| 4 | Compare with neighbours? | Yes — Pattern B: definition-declared sorts only, and sorting by an optional date states on screen that unscheduled work cannot appear. |
| 5 | Open the right record? | Yes — and now from the definition. |
| 6 | **Anything that belongs on Detail?** | **No.** Six columns. Parts plan, labour, history, transitions and equipment all live on the record. |
| 7 | **Any field shown merely because it existed?** | **No.** The entity carries far more than six fields. |
| 8 | **Duplicated context from another object?** | **No.** Customer is a resolved *name*, one line; the Account record is not reproduced. Technician is a resolved name through the one technician vocabulary — never a `find(...)?.name ?? id`, which is how a raw id reaches a screen. |
| 9 | **Invented a fact, action or authority?** | **No.** No per-bucket counts, no attention column, no freshness claim, no text search implied beyond the number prefix. The realtime `useWorkOrders` subscription five dispatch surfaces depend on is untouched — paging it would have been a dispatch decision taken under cover of a list migration. |
| 10 | **Handheld preserves the answer?** | Yes — `MetadataListGrid` renders `fo-table--stack`, so each row becomes a labelled card below the phone breakpoint. |

**States reachable here:** LOADING, POPULATED, TRUE_EMPTY, FILTER_ZERO (via `ListEmptyState` with the
criteria visible), DENIED, UNAVAILABLE, **DEGRADED**. SEARCH_ZERO belongs to the search dropdown,
which states its own scope precisely — *"No work order numbers start with …"* — rather than claiming
a collection-wide absence. IDLE, EMPTY_VIEW, UNKNOWN, OFFLINE_STALE and the four bulk-action states
are not reachable on this surface.
