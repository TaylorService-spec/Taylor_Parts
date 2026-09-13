# Claude Design archaeology — Inventory · Warehouse · Purchasing · Scanner

**Lane P3-A2 of the Taylor EOS overnight program.** Produced read-only against the integrated Wave-1
head `d104cf49`. **No runtime code was changed by this lane and nothing was pushed.**

This document recovers every prior Claude Design / North Star artifact that bears on Inventory,
Warehouse, Purchasing, Receiving and the Scanner; reconciles each drawn surface against what was
actually built; states the current EOS authority under each surface; and gives every route a Design
P2 disposition.

**Method rule applied throughout:** every existence claim carries a `path:line` or a commit SHA.
Anything that could not be verified inside this worktree is marked **UNPROVEN** rather than asserted.
A route that renders over a capability nobody holds is recorded as a **WORKFLOW GAP** or an
**AUTHORITY GAP**, never as `KEEP`.

---

## Part 0 — Provenance: what was recovered, and from where

### 0.1 The design canvases that exist

Thirty-two `.dc.html` Claude Design canvases exist in the repository. **Exactly two of them are in
this lane's domain**, and no `.dc.html` in this domain was ever deleted or renamed — the set of
canvases that ever existed on any ref is byte-for-byte the set present at HEAD
(`git log --all --diff-filter=A --name-only -- '*.dc.html'`, 32 paths, identical to
`find . -name '*.dc.html'`).

| # | Artifact | Frames | Provenance |
|---|---|---|---|
| 1 | `docs/north-star/parts/North Star - Parts P1.dc.html` | 1a workspace · 1b record 1440 · 1c handheld 375 · 1d honest states | `Claude Design Docs/Parts North Star P1v1.zip`, folder `design_handoff_parts`, received 2026-08-30 (`docs/north-star/parts/README.md:12-14`) |
| 2 | `docs/north-star/receiving/North Star - Receiving P1.dc.html` | 1a workspace · 1b supplier multi-scan · 1c add existing unit · 1d reorder journey · 1e truth states · 1f handheld 390 | `Claude Design Docs/Receiving North Star P1v1.zip`, folder `design_handoff_receiving`, received 2026-08-30; SHA-256 `fe72fe5f…3ff23e8d`, frozen at `b83a8bd6` |
| 3 | `docs/north-star/lists/Lists-North-Star-P2.dc.html` | carries a **2i Parts study** — the shared collection grammar this domain composes through (`docs/north-star/parts/README.md:30-33`) | Lists P2 |

**There is no Claude Design canvas for Warehouses, Bins/racking, Transfers, Truck Inventory,
Cycle Counts, Purchase Orders, Suppliers, Receipts, or any Scanner surface.** Those surfaces were
specified in prose and built without a visual authority. This is the single largest structural fact
in this archaeology: **two of roughly twenty-five routes in this domain have a design source.**

### 0.2 Design-authority documents in the current tree

| Artifact | What it is |
|---|---|
| `docs/north-star/parts/DESIGN-HANDOFF-PARTS-P1.md` | Design's own Parts P1 handoff, verbatim |
| `docs/north-star/parts/DESIGN-BRIEF-PARTS-P1v2.md` | The brief Claude wrote *for* Design after P1's composition was rejected on sight |
| `docs/north-star/parts/IMPLEMENTATION-DELTA-PARTS-P1v2.md` | The element-by-element delta against P1v2 + the seven Owner rulings that became the implementation contract |
| `docs/north-star/parts/README.md` | Declares the canvas **visual acceptance authority only** — not runtime, data, workflow or permission authority |
| `docs/north-star/receiving/DESIGN-HANDOFF-RECEIVING-P1.md` | Receiving handoff, with its own composition map and three declared gaps |
| `docs/north-star/receiving/RECEIVING-NORTH-STAR-DESIGN-START.md` | The **Owner's binding design-start brief**, 651 lines — the richest single statement of intent in this domain |
| `docs/design/parts-north-star-composition-map.md` | Parts I–XI, 742 lines — the reconciliation of canvas against repository |
| `docs/design/north-star-open-product-decisions.md` | ND-25 … ND-30 (+ amendment), ND-33 |
| `docs/design/north-star-migration-ledger.md` | Family 7 (Parts) and Family 9 (Receiving) closeouts |
| `docs/north-star/lists/LISTS-P2-COLLECTION-DISPOSITION.md` | The route-by-route disposition of all 75 collection surfaces, incl. 14 in this domain |
| `docs/design/eos-operational-data-plane-inventory-authority-cutover.md` | The 8-writer census and the Postgres cutover sequence |
| `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md` | 2,228-line wireframe; §4.3 is a **Pick Ticket** template (T3) that was never built |
| `docs/specifications/enterprise-inventory-ai-strategy.md` | Eight named inventory recommenders. **None built.** |

### 0.3 Recovered from history — not present at HEAD

| Artifact | Recovery |
|---|---|
| `docs/design/receiving-north-star-composition-map.md` | **Never merged to main.** Exists only on the unmerged branch `claude/receiving-p1-reconciliation`, single commit `cd885d6bc419d41b64d617e78f839560c9d57fa0` (2026-08-31). `git merge-base --is-ancestor cd885d6b HEAD` → **not an ancestor**. Recovered in full for this lane. |
| `docs/epics/INVENTORY-CAPABILITY-EXPANSION-PLAN.md` | Deleted at `16103f1f` (2026-07-07) when `docs/capabilities/` was established; last content at `3dbb214e`. |
| `docs/assessments/wo-parts-planning-assessment.md` | Added `1babc1c6` (2026-08-06), later removed. |
| `docs/audits/inv-convergence-b/production-parts-export.csv` | Deleted evidence file. |
| `docs/customer-1/data/seeded/export/{parts,inventory}__SEEDED-PARTSDB.csv` | Deleted seed exports. |

### 0.4 Design artifacts that were NEVER committed — permanently lost to the repository

These are the archaeology's real casualties. Each is cited by a merged artifact as its authority, and
none of them is in any commit on any ref (`git log --all --name-only` over the full history).

| Lost artifact | Cited by | Why it matters |
|---|---|---|
| **`DESIGN-HANDOFF-PARTS-P1v2.md` + frames `1a`, `1a-m`, `1b`, `1b-m`** **· RECOVERED 2026-09-13** | `docs/north-star/parts/IMPLEMENTATION-DELTA-PARTS-P1v2.md:34` names it as **"Design authority"** and `:35` names the four frames as **"Acceptance authority"** | ~~**The visual authority the currently-shipped Parts workspace and Part record were accepted against does not exist in this repository.** The delta and the ledger describe it; the artifact itself is gone. `Parts North Star P1v3.zip` was byte-identical to P1v2 (`IMPLEMENTATION-DELTA-PARTS-P1v2.md:28-30`) so nothing else carries it either.~~ → **SUPERSEDED 2026-09-13: all five files recovered** from `Parts North Star P1v2.zip`, at `docs/design-history/recovered/Parts/`. The first sentence re-verifies as a statement about *this repository* and is still true of it. The `Parts North Star P1v3.zip` reasoning was **correct and is the clue that mattered** — the authority travelled with the `.zip` deliveries, and one of them was still in local custody. **Conformance of the shipped surface is unaudited**, and the historic `audit-*.png` captures the P1v2 brief was built on are **still unavailable**, so a present-day mismatch could not be attributed to drift rather than intended change. |

> **SUPERSEDED IN PART — 2026-09-13, lane ARCH-RECOVER.** The first row above is **RECOVERED**; the
> other rows in this table are **unchanged** — `parts-ux-redesign-blueprint.md` and the four
> `audit-*.png` are in no archive. The sweep that produced this table was sound and re-verifies today;
> the artifacts were in delivery archives at `/mnt/d/Taylor_Parts/Claude Design Docs/`, outside this
> lane's authority to search. **Correct about the repository, incomplete about the world.**
>
> **RECOVERED HISTORICAL DESIGN EVIDENCE** — **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not proof that current EOS still conforms.** The Owner ruling of 2026-08-31 is neither re-opened nor re-confirmed by recovery. See `docs/design-history/recovered/RECOVERY-MANIFEST.md` and the recovery index at `historical-acceptance-evidence-register.md` §0.4.
| **`parts-ux-redesign-blueprint.md`** | `docs/ai/memory-archive/project_parts_ux_redesign.md:20` — the Wave-6 audit package delivered by four parallel Explore agents, containing §14d (manufacturer read authority), §14e (Action Center attention-item model) and §14g (queue dedup analysis) | The whole Wave-6 Parts UX analysis. Only its abstract survives, in the memory archive. |
| **`audit-workspace-1440.png` / `audit-workspace-375.png` / `audit-record-1440.png` / `audit-record-375.png`** | `docs/north-star/parts/DESIGN-BRIEF-PARTS-P1v2.md:29-34` | The deployed-state captures the P1v2 brief was built on. |
| **`docs/implementation-plans/cycle-count-multi-part-and-scheduling.md`** | `docs/specifications/cycle-count-multi-part-sheet.md:18` | Preserved **only** at tag `archive/cycle-count-a1-spec-f585125d`, explicitly "not yet on `main`". |

### 0.5 Artifact count

| Class | Count |
|---|---|
| Design canvases (`.dc.html`) in domain | **2** (+1 shared Lists P2 carrying a Parts study) |
| Design-authority / handoff / composition / brief documents at HEAD | **13** |
| Architecture + specification documents in domain at HEAD | **~110** (see `docs/` census in §0.6) |
| Recovered from history, absent at HEAD | **6** |
| Cited as authority but never committed | **7** (4 Parts frames counted as one row) |

### 0.6 Domain document census

152 distinct `docs/**` paths matching the domain vocabulary have existed across all refs; 146 are at
HEAD. The full path list is reproducible with:

```
git --no-pager log --all --name-only --pretty=format:"" -- 'docs/**' \
  | grep -iE 'inventory|warehouse|purchas|scanner|parts|receiv|stock|procure' | sort -u
```

---

## Part 1 — How to read the route sections

Every route below is given in the six-part form the lane brief requires. Two conventions:

* **"ORIGINAL CLAUDE DESIGN"** means a drawn frame or a written design brief that predates the
  implementation. Where no design source ever existed, the section says so explicitly — that absence
  is itself a finding, not a formatting gap.
* **A pretty page is not a workflow.** Where a route renders controls over a capability that is
  `active: false`, granted to no Role, never requested from the access feed, or gated behind a
  readiness constant that is `false` in the target environment, the disposition is **WORKFLOW GAP**
  or **AUTHORITY GAP** regardless of how well the page composes.

### Route census — this lane's domain

| # | Route | Surface | Design source |
|---|---|---|---|
| R1 | `/inventory` | Parts workspace | Parts P1 frame 1a (**not built**) → Parts P1v2 frame 1a (**lost**) |
| R2 | `/inventory/:partId` | Part record | Parts P1 frames 1b/1c/1d → P1v2 1b/1b-m (**lost**) |
| R3 | `/inventory/part-master` | Catalog Admin | Lists P2 MIGRATE #5 |
| R4 | `/inventory/manufacturers` | Manufacturers (navHidden) | Lists P2 MIGRATE #10 |
| R5 | `/inventory/warehouses` | Warehouses register | Lists P2 MIGRATE #9 |
| R6 | `/inventory/warehouse-workspace` | Warehouse handheld shell | Lists P2 EXEMPT #48 |
| R7 | `/administration/warehouse-racking` | Bin administration / racking generator | `docs/specifications/bin-administration-racking-generator.md` |
| R8 | `/inventory/transfers` | Transfers | Lists P2 MIGRATE #12 |
| R9 | `/inventory/truck-inventory` | Truck inventory | Lists P2 MIGRATE #13 |
| R10 | `/inventory/cycle-counts` | Cycle Counts | `docs/specifications/cycle-count-multi-part-sheet.md`; code-only "Cycle Counts North Star P1" |
| R11 | `/inventory/receiving` | Receiving workspace | **Receiving P1 frame 1a** |
| R11a | Supplier multi-scan session | mounted in R11 and R22 | **Receiving P1 frame 1b + 1f** |
| R11b | Reorder PO linear journey | mounted in R11 | **Receiving P1 frame 1d** |
| R11c | Add existing unit side sheet | mounted in R11 | **Receiving P1 frame 1c** |
| R12 | `/purchasing` | Purchase Orders | Lists P2 MIGRATE #11 |
| R13 | `/purchasing/suppliers` | Suppliers | Lists P2 MIGRATE #8 |
| R14 | `/purchasing/receipts` | Receipts | Lists P2 COMPOSE #34 |
| R15 | `/purchasing/quotes` | placeholder (navHidden) | Lists P2 "not a surface" #71 |
| R16 | `/purchasing/demand-planning` | placeholder (navHidden) | Lists P2 "not a surface" #71 |
| R17 | `/inventory/back-orders` | placeholder (navHidden) | Lists P2 "not a surface" #72 |
| R18 | `/inventory-role/manager` | Parts Manager home | Lists P2 EXEMPT #64 |
| R19 | `/inventory-role/warehouse` | Warehouse Manager home | Lists P2 EXEMPT #64 |
| R20 | `/inventory-role/mine` | Parts Associate / My Purchasing | Lists P2 EXEMPT #64 |
| R21 | `/service/scan` | Scan Workspace + nine workflows | Lists P2 EXEMPT #49/#50 |
| R22 | `modules/mobile/PartsScanner.jsx` | technician parts scanner | Lists P2 EXEMPT #51 |
| R23 | Warehouse Sync Queue | inside R6 | Lists P2 EXEMPT #55 |
| R24 | `/admin/diagnostics/inventory-parts-parity` | shadow-parity diagnostics | none |
| R25 | Returns register | **does not exist** | Lists P2 **BLOCKED 5.4** |

Route registration is generated, not tabulated: `field-ops-app-vite/src/navigation/navConfig.js:51`
declares `NAV_DOMAINS`, and `field-ops-app-vite/src/App.jsx:871-882` emits one `<Route>` per visible
subnav item, resolving the element through a `switch` on `domain.key + item.key`
(`App.jsx:396-830`). `navHidden: true` hides the rail entry only — the route still exists and still
renders the real component (`navConfig.js:275-278`).

---

## Part 2 — PARTS

### R1 · `/inventory` — Parts workspace

#### ORIGINAL CLAUDE DESIGN

**Frame 1a, Parts North Star P1** (`docs/north-star/parts/North Star - Parts P1.dc.html`):

* **Primary question** — *which parts need me, and where is the one I am holding?*
* **Facts shown** — a serif `Parts` identity block over a governed count (`1,412 parts · 1,286 active
  · 9 need attention`); view chips `Active 1,286` / `Needs Attention 9` / `Serialized` / `All 1,412`;
  a toolbar reading `Search part number, description, barcode, or alias` · Filter · Sort · **Scan**;
  one table `Part · Manufacturer · Category · Control · Status · On hand · Attention`.
* **Proposed actions** — `New Part` (only where the part-master write capability is granted), `Scan`
  (the existing scanner entry point, identification only).
* **Workflow** — scan or search to identify → scan the Attention column → open the record.
* **Composition** — Lists P1 grammar in full: context line, rule pair, serif identity, restrained
  action cluster, views, toolbar, 16 states.
* **Intelligence** — an `Attention` column sourced from `partsAttentionProjection`, e.g.
  *"Below reorder point"*. No AI surface: the handoff's do-not-invent list bars *"reorder algorithms
  or replenishment suggestions"* and *"AI surfaces"* outright.
* **Exception handling** — the Lists P1 16-state ladder; blocked ≠ not-found.
* **Suggested new capability** — none; the handoff labels the absent live multi-location position
  *AUTHORITY REQUIRED (UD-3/UD-4)*.
* **Unresolved gaps** — the design's own annotation: *"On hand is the governed baseline quantity …
  no 'Available' column is shown because no availability authority exists and On hand ≠ Available."*

**Frame 1a was rejected against the repository before it was built.**
`docs/design/parts-north-star-composition-map.md:82` (ruling **P-N1**) records that `warehouseQty` is
`STATIC_FALLBACK` from `src/data/partsCatalog.ts`, a file whose own header declares
*"METADATA ONLY — NO STOCK AUTHORITY"*, and that the Owner had already removed that exact cell as
FALSE_COMFORT six days earlier. Nine of fifteen drawn elements could not be rendered as drawn
(`:78-91`).

**Then the surface was not built at all.** `docs/design/north-star-migration-ledger.md:1175-1203` —
*"FRAME 1a WAS NOT BUILT, and offering `/inventory` for acceptance was wrong."* The PartsList scope
ruling of 2026-08-30 deliberately left the pre-North-Star multi-panel role home alone, and the
closeout then offered `/inventory` as an acceptance surface against frames it was never migrated to.

**Second design source — Parts P1v2 frames 1a and 1a-m — is the one that shipped, and it is lost.**
The measurements that motivated it are preserved in
`docs/north-star/parts/DESIGN-BRIEF-PARTS-P1v2.md:112-148`: the deployed workspace was **3,406px at
1440** with 13 visible headings, four empty-state lines and one row of real Work; **9,277px at 375 —
11.4 screens, 2.7× the desktop page**; two of six columns effectively empty (Manufacturer
`Not recorded` ×25, Attention `—` ×23, 336px of table width carrying almost nothing).

#### WHAT ACTUALLY GOT BUILT — **REPLACED, then IMPLEMENTED against a lost artifact**

`field-ops-app-vite/src/modules/inventory/PartsList.jsx`. Accepted release `0f1ac714`, Owner visual
acceptance 2026-08-31, closing gate `partsNorthStarQuickGate.mjs` **29/29**
(`docs/north-star/parts/IMPLEMENTATION-DELTA-PARTS-P1v2.md:7-18`).

Shipped composition: the catalogue **leads** the page (`north-star-migration-ledger.md`, Part IX of
the composition map, `docs/design/parts-north-star-composition-map.md:582-612`); Work and Flow groups
moved into a **320px secondary rail** under the ND-30 amendment; pagination kept with the true total;
views `All · Active parts · Needs attention · Serialized`.

| Design element | Disposition |
|---|---|
| `On hand` column | **REJECTED** — ND-25 Option (b), *TRUTHFUL ABSENCE > FALSE COMFORT*. The column is omitted, not answered from something else (`parts-north-star-composition-map.md:288-299`). |
| `Manufacturer` column | **REMOVED** in P1v2 and folded into the Part cell — it read `Not recorded` on 25 of 25 rows (`IMPLEMENTATION-DELTA-PARTS-P1v2.md:194-202`). |
| Search placeholder claiming barcode + alias | **REJECTED.** Two of the four terms were false; the shipped placeholder reads *"Search part number, description, or category"*, and a test asserts a barcode-shaped value matches nothing (`parts-north-star-composition-map.md:310-327`). |
| `Scan` in the toolbar | **NEVER BUILT.** `useAuth` exposes no capability context on this route and the admin persona does not see Scan in the Service nav at all (`parts-north-star-composition-map.md:619`). |
| `INVENTORY → PARTS` breadcrumb | Built in P1v2 via an opt-in `WorkspaceShell` slot; absent in P1 (`:617`). |
| Underlined tabs | P1: pill chips, because the Lists P2 COMPOSE contract reserves collection-views markup for declared collection pages (`:618`). P1v2 used `.ns-tabrail`, which turned out to already exist and not to be the collection markup (`north-star-migration-ledger.md:1674-1678`). |
| Height | 3,406 → **1,901px** at 1440 (accepted ≤1,950; design target 1,700); 9,277 → **3,543px** at 375 (accepted ≤3,600; target 2,400) — a reconciled ceiling, not a waiver (`north-star-migration-ledger.md:1686-1693`). |

#### CURRENT EOS AUTHORITY

* **Objects** — `parts` (canonical Part, ADR-008 hybrid identity: immutable `partId` document id +
  mutable governed `internalPartNumber`); `reorder_requests`; `reorder_purchase_orders`;
  `inventory_transactions` (the one ledger, ADR-003).
* **Commands reachable from this route** — `createPart` (callable, via `PartWriteModal` →
  `usePartMasterWrite` → `services/partMasterCommandClient.js:20`); `createReorderRequest` (callable,
  `services/reorderCallableClient.js:26-27`); `assignReorderRequest`, `startPurchasing`,
  `updatePurchasingProgress`, `recordPurchaseOrder`, `receiveReorderRequest` — **direct Firestore
  writes** from `src/domain/inventoryReorderRequests.js` and `src/domain/reorderPurchaseOrders.js`,
  authorised by Rules rather than by a trusted writer.
* **Capabilities** — route gate is `legacyKey: "inventory"` OR `CATALOG_SURFACE_CAPABILITIES`
  (`inventory.catalog.manage`, `inventory.catalog.activate`) at `navConfig.js:301` /
  `access/governedSurfaceCapabilities.js:50-53`.
* **Readiness constant, not capability, decides whether New Part works at all.**
  `PART_MASTER_WRITE_READY` (`config/partMasterWriteReadiness.js:16`) is **true only for
  `platform-sandbox`** — false in local-emulator, certification, integration and
  `taylor-parts-production` (`config/environments.json:54,85,220,249,281`). While false the client
  makes **zero callable attempts**.
* **PostgreSQL authority** — none yet. `parts` is classified AUTHORITATIVE REFERENCE and stays in
  Firestore for the current tranche
  (`docs/design/eos-operational-data-plane-inventory-authority-cutover.md:182`).
* **Remaining Firebase dependency** — total: the catalogue read, the reorder queues, the reorder
  lifecycle writes and the ledger are all Firestore.
* **`partsCatalog` residue** — `src/data/partsCatalog.ts` is a hardcoded array explicitly corrected
  out of the reference census on 2026-09-11 by P1B ruling R1 (*"a hardcoded array with no stock
  authority, not the Firestore reference"*, cutover doc `:182`). Its `warehouseQty` may no longer
  reach any Parts surface under ND-25.
* **Unknowns** — whether the reorder direct-Firestore write path survives the Ownership v1 move;
  `docs/specifications/reorder-trusted-command-authority.md` designs the narrow trusted boundary and
  is explicitly **"DESIGN ONLY, not authorized for implementation"** (`:3`).

#### NEW OPPORTUNITIES

1. **Close the P-G1 whole-collection read.** Every Parts surface reads the entire `parts` collection
   (`PART_CATALOGUE_WHOLE_COLLECTION_READ`), and a cold record deep-link once exceeded a 30s wait
   (`parts-north-star-composition-map.md:466-468`). Part Master's own list is already cursor-paged —
   the pattern exists one route away.
2. **Re-earn the quantity column honestly.** ND-28-F is open: when `getPartBalance` is activated, the
   Stock forecast must be reconciled against the governed balance as an explicit authority change
   (`north-star-migration-ledger.md:1227`). `PART_LIST_BALANCE_N1_GAP` (single-part callable) is the
   second and independent blocker.
3. **The Attention column is the only intelligence this page has, and it is deliberately flat** —
   `partsAttentionProjection` carries `ACTION_ITEM`/`NOTIFICATION` only, no severity
   (`parts-north-star-composition-map.md:74`). A governed severity would make the column sortable.

#### SCENARIO / OPERATIONAL QUESTIONS

* A warehouse manager opens `/inventory` in production. `PART_MASTER_WRITE_READY` is false, so
  **New Part** is inert. Does the button render protected, or is it absent? (Verified inert; the
  presentation of that inertness is **UNPROVEN** for this route.)
* A part number is read off a printed label and typed. Barcodes and aliases are **not** searched and
  the placeholder does not claim them. Is that acceptable to a warehouse, or is alias search the
  reason `inventory.catalog.manage` should be activated?
* The page shows no quantity anywhere. What does an operator do next to answer *"do we have any?"* —
  and is that route (Scan → Look up) actually reachable from here? It is not: `Scan` was never built
  into this toolbar.

#### DESIGN P2 DISPOSITION — **IMPROVE** (composition accepted) **+ AUTHORITY GAP** (quantity)

The composition is Owner-accepted and must not be reopened to chase the original mockup heights
(`IMPLEMENTATION-DELTA-PARTS-P1v2.md:18`). The gap is that the page cannot answer a quantity question
at all, and the capability that would (`getPartBalance` / `inventory.balance.read`) is built,
governed and switched off.

---

### R2 · `/inventory/:partId` — Part record

#### ORIGINAL CLAUDE DESIGN

**Frames 1b (desktop 1440), 1c (handheld 375), 1d (honest states)**, plus the handoff's
composition paragraph (`DESIGN-HANDOFF-PARTS-P1.md`).

* **Primary question** — *what is this part, what do we know about it, and where is it?*
* **Facts shown** — kicker `Part · {control words} · {stocking words}` → title = the part number →
  serif description subtitle → status/manufacturer/category/unit/OEM words → `3 on hand across 2
  locations`. MAIN: *Where it is* (a location table with per-location quantities and a
  `Bin R4-08` note) → *Serialized units* (three serials with status, location and
  `Staged for WO-2026-001241`) → *Open demand* → *Activity* (20 most recent, seven governed movement
  types, each with a human reference PO/TR/CS/WO, the location **and the actor**). RAIL:
  Classification → Identifiers → Purchasing context (`Cost $2,480.00 baseline`, `Reorder at 2
  baseline`, `On order — Not readable from this page yet`) → *Used on*.
* **Proposed actions** — exactly two: **Edit part** and **Manage identifiers**. Nothing else.
* **Workflow** — identify → read state → see where units sit → see what is demanding them → read the
  ledger.
* **Mobile (1c)** — sticky search+scan at top → identity → status/control/on-hand → location cards →
  serials → *More* (identifiers, demand, activity). Targets ≥44px; no horizontal scroll.
* **Intelligence** — an Attention strip: *"2 open work orders plan this part (demand 3) against 3 on
  hand"*, annotated *"Derived from the existing demand read; no reservation is implied."*
* **Exception handling (1d)** — four distinct sentences: blocked-permission / blocked-unavailable /
  blocked-unverified / not-found; plus zero-inventory-valid-part and capability-inactive.
* **Suggested new capability** — the design labels Available, live multi-location position, the
  open-PO read and any replenishment calculation **AUTHORITY REQUIRED**.
* **Unresolved gaps** — the handoff's own VERIFY list: the `Bin R4-08` display note and the
  serialized *"staged for WO"* context line.

#### WHAT ACTUALLY GOT BUILT — **PARTIAL, with five drawn sections replaced by stated absence**

`field-ops-app-vite/src/modules/inventory/PartDetail.jsx`. The record migrated first, deliberately
(`parts-north-star-composition-map.md:50-59`).

| Drawn | Built | Why |
|---|---|---|
| `3 on hand across 2 locations` in the header | **REMOVED** | ND-25 Option (b). The identity layer states no quantity. |
| *Where it is* location table | **HEADING ONLY**, with the location-is-not-custody sentence and a capability-inactive state. **No empty table.** | `inventory.location.display.read` is `active:false` and granted to nobody; `truckInventoryView.js` carries a *STRICT NON-COMPUTATION* boundary (`:85`) |
| *Serialized units* table | **Capability-inactive state**, gated on the part's own tracking mode so `SERIALIZED_LOT` fails closed and untracked parts render **no section at all** | `inventory.serializedAsset.read` is `active:false` (`:86`, `:208`) |
| `Available` / `On order` | **One capability-inactive sentence, not two.** The design called this AUTHORITY REQUIRED; it is **capability inactive** — `getPartBalance` exists and returns `available` (`:83-84`) | §16 of the directive: *capability unavailable* and *authority required* are two different states with two different owners |
| Activity with **actor** and **description** | **REJECTED.** `LedgerTransaction` is exactly `id · workOrderId · partId · type · quantity · timestamp` (`src/domain/inventoryAnalyticsEngine.ts:17`). The actor and note live on `inventory_actions`, *"never joined or reconciled by any code in this repository"*, whose write side was retired in #1625. Sourcing them there would have rebuilt the join the retirement removed (`IMPLEMENTATION-DELTA-PARTS-P1v2.md:49-83`) | Owner ruling: **adopt Design's own mobile grammar at both widths** (`:280`) |
| `Cost $2,480.00 baseline` and the price row | **REFUSED.** ND-27: `unitCost` stays blocked from display, report **and** export; `sellPrice` falls to the same clause. `money()` had no consumer left and was removed (`parts-north-star-composition-map.md:199`, `:210`) | `PART_INVENTORY_VALUATION_AUTHORITY_GAP` |
| `Reorder at 2 baseline` | **REPLACED** by the derived reorder point, named as derived — then by **`Not established`** under ND-29, because a zero reorder point and an absent usage history are the same condition (`:480-496`) | |
| *Used on* populated | **TRUTHFUL ABSENCE.** `equipment.compatibility.view` is `active:false` and granted to nobody (`IMPLEMENTATION-DELTA-PARTS-P1v2.md:85-108`, Owner ruling `:281`) — **independently re-verified for this lane**, and the only capability in this domain for which the "ungranted" half of the claim still holds | |
| `Bin R4-08` note; `Staged for WO-2026-001241` | **NOT BUILT** — P-N11; both hang off the two inactive capabilities (`parts-north-star-composition-map.md:99-101`) | |
| Two actions only | **KEPT**, plus `Change Status`; Owner ruled **primary first at both widths** (`IMPLEMENTATION-DELTA-PARTS-P1v2.md:285`) | |
| Frame 1d's four honest states | **BUILT AND MATCHED EXACTLY** — the composition map records these as already correct before the migration (`parts-north-star-composition-map.md:70`) | |

**Three live pre-existing defects were found by the reconciliation and fixed** — the Manufacturer row
that could never render (gated on `canonicalPart?.manufacturerId`, a field the projection never
produced, while the stored key is `primaryManufacturerId`); `PartIdentifiersSection` passed an
always-`undefined` `partNumber`; and the workspace rendering the **document id under the heading
"Part Number"** (`:110-127`). A green test had proved the manufacturer *name resolution* for the
entire period the production row could not render (`:225-227`).

**Two facts were deliberately removed in P1v2:** *Recommended reorder qty* and *Risk*
(Owner ruling 4, `IMPLEMENTATION-DELTA-PARTS-P1v2.md:282`) — an intentional presentation removal,
recorded rather than silent.

#### CURRENT EOS AUTHORITY

* **Objects** — `parts`, `part_aliases`, `inventory_transactions`, `reorder_requests`,
  `reorder_purchase_orders`, `inventory_actions` (**read-only history**, writer retired 2026-08-30,
  `parts-north-star-composition-map.md:678-737`).
* **Commands** — `createPart` / `updatePart` / `changePartStatus`
  (`services/partMasterCommandClient.js:19-23`), all behind `PART_MASTER_WRITE_READY`; the full
  reorder lifecycle (Cancel Reorder Request `PartDetail.jsx:216`, Void Purchase Order `:254`,
  Approve/Reject `:344`/`:347`, Assign `:459`, Start `:530`, Receive `:939`) through the direct
  Firestore writers.
* **State machine** — the part status machine (`changePartStatus`) and the reorder-request lifecycle.
* **Capabilities — and this is where the 2026-08 design record is now wrong.**
  `inventory.catalog.manage` / `.activate` are **ACTIVE and granted** (`permissionCatalog.ts:1071`,
  `:1077`). Of the four reads the composition map called *"built, governed and switched off … granted
  to no role"* (P-G3, `parts-north-star-composition-map.md:165-168`), **re-verified individually for
  this lane**: `inventory.balance.read` is `active: false` (`permissionCatalog.ts:1221`) but appears in
  **14** grant sites in `functions/src/access/governedBusinessRoles.ts`;
  `inventory.serializedAsset.read` is `active: false` (`:1269`) with **12**;
  `inventory.location.display.read` is `active: false` (`:1498`) with **1**
  (`inventoryLookupReader`, `governedBusinessRoles.ts:1573`). Only
  `equipment.compatibility.view` is **both** `active: false` (`:1385`) **and genuinely ungranted** —
  `governedBusinessRoles.ts:1471` states it outright: *"THE FOUR COMPATIBILITY IDS ARE NOT
  INCLUDED."* See Part 7.
* **`recordInventoryAction()` is kept and now throws** rather than being deleted, so the reason
  travels with the refusal (`:718-720`). **The `firestore.rules` `allow create: if
  isAdminOrDispatcher()` on `inventory_actions` was never closed** — closing it is Tier-2 and the
  presentation ruling did not authorise it. *"It is now the only remaining way to create a new
  document."* (`:731-736`)
* **PostgreSQL authority** — none.
* **Unknowns** — whether production holds `inventory_actions` records and whether any reporting or
  compliance consumer depends on them. The Owner reserved that question; it requires a production
  read (`:738-742`). **UNPROVEN here and not investigated — production contact is prohibited.**

#### NEW OPPORTUNITIES

1. **Activating three capabilities would light four sections at once.** `inventory.balance.read`,
   `inventory.serializedAsset.read` and `inventory.location.display.read` are all built. The record
   already renders their absence honestly; nothing else has to be written for them to speak.
2. **The design's Activity actor is genuinely missing from the platform**, not merely ungranted. If
   the business wants *who moved this*, that is a ledger-schema decision, and the cutover to
   `eos_ops.inventory_movements` is the moment to take it.
3. **`inventory_actions`' orphaned `allow create` rule is a live second write path** into a
   collection whose product surface was retired. It is the only remaining door.

#### SCENARIO / OPERATIONAL QUESTIONS

* A part has three units in Phoenix and one on Truck 12. What does this page tell an operator today?
  **Nothing about location or quantity.** Is that the state the business wants to run on?
* A part is scrapped. The ledger records `SCRAPPED`. Does the record's Activity row read a word or a
  token? (Words — `LEDGER_TYPE_LABEL`, with an unrecognised type reading *"Movement"* rather than its
  token, `:220-222`.)
* Someone with admin or dispatcher role writes an `inventory_actions` document directly through the
  still-open Rule. Nothing in the product created it and nothing reconciles it. Who notices?

#### DESIGN P2 DISPOSITION — **KEEP** (composition) **+ AUTHORITY GAP** (four inactive reads) **+ PRODUCT GAP** (ledger actor)


---

### R3 · `/inventory/part-master` — Catalog Admin · R4 · `/inventory/manufacturers`

#### ORIGINAL CLAUDE DESIGN

No canvas. The design authority is **Lists P2** (`LISTS-P2-COLLECTION-DISPOSITION.md:56`, `:61`):
Part Master is **MIGRATE #5**, a cursor-paged object index whose record route `/inventory/:partId`
was *"declared but not wired"* until Phase 6; Manufacturers is **MIGRATE #10** and reads *"the
entire collection in one call with no `limit` and no `truncated` flag"*, so **its footer must render
nothing — not "Load more", not a total** (R7, `:81-83`).

The deeper design intent is Owner Decision #43 (INV-CONVERGENCE-A), preserved in
`docs/ai/memory-archive/project_parts_ux_redesign.md:18`: *"Inventory → Parts (PartsList/PartDetail)
is the primary, permanent user-facing operational product… Part Master is temporary
verification/admin scaffolding… must not remain a competing general-user workspace."*

#### WHAT ACTUALLY GOT BUILT — **IMPLEMENTED then DEMOTED**

`src/modules/inventory/PartMasterList.jsx` and `src/modules/inventory/Manufacturers.jsx`. Both were
**demoted rather than removed** via `navHidden` (PRs #993/#995, memory archive `:26-28`): the routes
still exist and still render the real component (`navConfig.js:275-278`), only the rail entry is
gone. Part Master survived retirement because its *bulk browse-by-status table* has no Parts
equivalent — Decision #43's UD-5, decided partially.

* Part Master's write controls are **all disabled when `!writeReady`** (`PartMasterList.jsx:305`,
  `:328`) — i.e. inert everywhere except `platform-sandbox`.
* Manufacturers renders a DENIED state (`Manufacturers.jsx:87`) and a `!writeReady` banner (`:221`);
  navConfig itself records the read as Rules-closed to every persona (`navConfig.js:341-346`).

#### CURRENT EOS AUTHORITY

* `parts` writer `partMaster/partMasterCommands.ts:235` / `:299` / `:430`, capability
  `inventory.catalog.manage` (`permissionCatalog.ts:1071`, **active**) and `.activate` (`:1077`,
  **active**), granted to seven roles including `inventoryCatalogAdministrator`
  (`governedBusinessRoles.ts:1065`) and `warehouseManager` (`:738`).
* Part status machine `PART_STATUS_TRANSITIONS` (`partMaster/partMasterCommands.ts:61`, enforced
  `:455`): `DRAFT · ACTIVE · INACTIVE · SUPERSEDED · DISCONTINUED` (`partMaster/types.ts:28`).
* `manufacturers` writer `partMasterCommands.ts:490,541,594`; read capability
  `inventory.catalog.read` (`permissionCatalog.ts:1086`) is **`active: false`**, granted to 14 roles.
* PostgreSQL: none for `parts`, `part_aliases` or `manufacturers`.

#### DISPOSITION

* **R3 Part Master — WORKFLOW GAP.** The page renders a full governed CRUD surface whose every write
  control is inert outside one environment, on a route the Owner demoted from navigation. It is
  admin scaffolding kept alive by one missing feature (bulk browse-by-status) in Parts.
* **R4 Manufacturers — AUTHORITY GAP.** `inventory.catalog.read` is `active: false`; the read is
  Rules-closed to every persona. The page is unusable by anyone in any environment and reachable only
  by typing the URL.

---

## Part 3 — RECEIVING

### R11 · `/inventory/receiving` — Receiving workspace (frame 1a)

#### ORIGINAL CLAUDE DESIGN

The richest design record in this domain: an **Owner-authored 651-line binding brief**
(`RECEIVING-NORTH-STAR-DESIGN-START.md`), a handoff with its own ten-row composition map, six frames,
and a reconciliation that **never reached main**.

* **Primary question** — the brief states six, at a glance (`:186-196`): *What am I receiving? Why is
  it entering company inventory? Where is it going? What governed source supports the transaction?
  What needs my attention? What can I safely do next?*
* **Facts shown (frame 1a)** — `Inventory → Receiving` crumb, `Read-checked 9:12 AM · Refresh`, the
  identity line *"Receive purchased inventory and record company-owned units entering managed
  custody"*, `Governed transaction · limited to Admin, Dispatcher, Owner`; **a scan-first order-entry
  field**; one `Awaiting receipt · 5 orders` queue with columns
  `Order · Journey · Supplier · Lines · Receipt progress · Order status · Action`; the exceptional
  *"A unit the company already owns"* section set apart below; a `Recent receipts` slot.
* **Proposed actions** — `Open` (scan entry), `Receive →` per row, `Add existing unit`.
* **Workflow** — **RCV-D1**: one queue, two governed journeys, the row stating which. *"A reorder PO
  (one part, immutable, full quantity) and a supplier PO (several lines, partial receipts) are
  different things the operator has to know they are holding."*
* **Composition** — the union of two existing governed reads, client-side only; each row routes to
  its own governed workflow; both submit through the same trusted command.
* **Mobile (1f)** — 390px dock posture, one column, labelled cells.
* **Intelligence** — none, deliberately. The brief's §16 non-goals forbid new inference of any kind.
* **Exception handling (1e)** — four mutually exclusive truth states, never collapsed:
  **Not activated** (*"This is not an empty list — it is an unread one"*) / **Denied**
  (authorization-specific, retry not implied, Add existing unit **absent entirely**) /
  **Locations unreadable** (picker disabled, no default — *a selected location and "could not be
  read" are never shown together*) / **Held, not received** (queued on device, rendered **above** the
  receipt block, *"the word 'Received' belongs only to a receipt the platform returned"*).
* **Suggested new capability** — none. The handoff instead declares **AUTHORITY GAP RCV-G1**
  (no governed receipt-history read) and **RCV-G2** (`RO-YYYY-######` unreachable client-side).
* **Unresolved gaps at design time** — RCV-G1, RCV-G2, RCV-D1.

**The reconciliation that checked it is stranded.** `docs/design/receiving-north-star-composition-map.md`
exists only at `cd885d6bc419d41b64d617e78f839560c9d57fa0` on the unmerged branch
`claude/receiving-p1-reconciliation`. It recorded: **every one of the handoff's ten COMPOSE claims
holds** — *"No drawn element was found to require authority the repository lacks"* — a materially
better starting position than Parts. It also found two things worth carrying forward:

1. **RCV-G1's wording is too strong.** Four functions read `receiving_orders` and one is
   client-reachable (`purchaseOrderProgressRead.ts:95`, `partBalanceReadService.ts:308`,
   `partBalanceBatchReadService.ts:137`, `receivingRepository.ts:318`). The gap's *substance* stands
   because the progress callable **discards `receivingId` before responding**; the corrected wording
   is *"no governed read returns `receiving_orders` records to a client."*
2. **RCV-G3 — the metadata register states a falsehood that carries a hazard.**
   `field-ops-app-vite/src/metadata/definitions/receivingOrder.js:18-20` still reads
   *"No function anywhere in this repository reads back a `receiving_orders` document by id, by
   query, or in bulk."* **Verified still present at HEAD.** Two of the readers are by query and one
   is in bulk. `source.purchaseOrderId`, `lines[].lineId` and `lines[].receivedQuantity` are
   load-bearing to three server-side readers; a future reader who believes that sentence is free to
   change the stored shape and silently break part balances and PO progress.

#### WHAT ACTUALLY GOT BUILT — **IMPLEMENTED, six frames, Owner-accepted**

`field-ops-app-vite/src/modules/inventory/Receiving.jsx`. Frames merged 1a `543303ae` · 1b `69bf5981`
· 1d `10e06190` · 1c `6e27d5a0` · 1e `3adcc15d` · 1f `33b72707`; deployed `0abc2353`; Quick Gate
**20/20**; **Owner visual acceptance 2026-08-31** (`north-star-migration-ledger.md:1802-1814`).
No Functions, Rules, capability, Role, schema, command or numbering change at any point.

| Drawn | Built | Note |
|---|---|---|
| Awaiting-receipt queue with Journey column (RCV-D1) | **YES** — `Receiving.jsx:122-140`, over the two existing candidate reads | the family's largest new composition |
| **Scan-first order entry** | **NOT BUILT — RCV-G7** | No governed scan-identifier/barcode contract exists for purchase orders, and canonical `purchase_orders` carry **no business order number at all (RCV-G5)**. *"A field captioned 'scan a purchase order, or type its number' would claim an identifier authority that does not exist."* Queue-row navigation is the entry path; pinned by regression tests in both suites |
| Recent receipts populated | **HONEST SLOT ONLY** — `Receiving.jsx:173-179`, *"Not connected yet"* | RCV-G1 |
| `RO-YYYY-######` on results | **ABSENCE STATED**, never `receivingId` | RCV-G2 |
| Per-row receipt progress | **NOT AVAILABLE — RCV-G6.** The list read carries none; none fabricated. Progress renders per opened order | |
| Add existing unit set apart, **absent** without capability | **YES** — `Receiving.jsx:163`, gated on `useSerializedAssetAcquireCapability` | ND-33 |
| Four mutually exclusive truth states | **YES**, and the 1e sweep found **two real defects**: the destination picker discarded the location read's STATUS (a denied/unavailable/failed read rendered as an innocently empty select), and the option label fell back to the raw `locationId` — a storage key as a place name | `north-star-migration-ledger.md:1765-1766` |
| Handheld 390 | **YES**, measured in a real browser at 1440/768/375/320: zero horizontal overflow; one genuine touch-floor failure (~15px inline link-buttons) fixed | `:1780` |

**A test moved with the truth:** `multiScanReceiving.test.jsx` had asserted
`heading { name: "PO-1" }` — **the document id AS the journey title.** Corrected to assert the
supplier-name identity and the id's absence (`:1739`).

#### CURRENT EOS AUTHORITY

* **Objects** — `purchase_orders` (`metadata/definitions/purchaseOrder.js:153`),
  `reorder_purchase_orders`, `receiving_orders` (`receivingOrder.js:113`,
  **deny-all in Rules at `firestore.rules:548`**), `inventory_transactions`, `serialized_assets`.
* **Commands** — `receiveInventoryStock`
  (`functions/src/inventoryReceiving/receiveInventoryStockCommand.ts:180`, capability
  `inventory.stock.receive` at `:59`); `acquireSerializedAsset` (capability
  `inventory.serializedAsset.acquire`); `listReceivingLocationOptions`.
* **State machine** — Receiving Order `EXPECTED · CHECKED_IN · PUTAWAY_COMPLETE · CANCELLED`
  (`inventoryReceiving/receivingTypes.ts:22`); receivable PO source states `APPROVED · SENT`
  (`receivingSourceResolver.ts:42`).
* **Capabilities** — `inventory.stock.receive` is the **one capability in this whole domain with no
  `active:` flag at all, i.e. ACTIVE** (`permissionCatalog.ts:1295`), granted to
  `inventoryReceivingClerk` (`governedBusinessRoles.ts:1514`) and directly to admin+dispatcher
  through `compatibilityRoles.ts:88`. `inventory.serializedAsset.acquire` is **`active: false`**
  (`permissionCatalog.ts:1282`), granted to `inventorySerializedAssetAcquirer`
  (`governedBusinessRoles.ts:1546`).
* **The readiness constant is the real gate.** `RECEIVING_TRANSPORT_READY`
  (`config/receivingReadiness.js:27`) is **true only for `platform-sandbox`**
  (`config/environments.json:47,78,213,242,274`). While false the transport makes **zero callable
  attempts** — the page renders, the queue reads, and no receipt can ever be submitted.
* **Ledger** — `RECEIVED` is a physical movement type (`operationalMovementTypes.ts:19`), signed by
  `MOVEMENT_SIGN` (`inventoryLedger/locationOnHand.ts:45`).
* **Numbering** — `RO-YYYY-######` allocated transaction-safely inside
  `receiveInventoryStockCommand` (`functions/src/inventoryReceiving/receivingOrderNumbering.ts:60`,
  merged 2026-08-18, #1259). **Reorder-request numbering: declared, allocator built, UNWIRED**
  (`north-star-migration-ledger.md:1828`).
* **Operating company** — not consulted anywhere in the receive path (§Part 7).
* **PostgreSQL** — `eos_ops.receiving_orders` + `receiving_order_lines` exist
  (`functions/migrations/1758672000000_purchasing-object-authority.sql:295`, `:345`) with **no
  writer pointed at them**.

#### NEW OPPORTUNITIES

1. **RCV-G5 is the cheapest high-value gap in this domain.** Canonical purchase orders carry no
   business number anywhere. Everything downstream — scan entry (RCV-G7), receipt-history labels
   (RCV-G2), an operator saying *"PO two-one-four"* out loud — waits on it.
2. **Fixing RCV-G3 is a comment edit with real safety value.** The false sentence is the stated
   justification for `readVia: UNKNOWN`; the conclusion survives, the justification does not.
3. **RCV-G1 could be closed by exposing `receivingId` that the progress callable already computes
   and then throws away** (`purchaseOrderProgressRead.ts:123-139`).

#### SCENARIO / OPERATIONAL QUESTIONS

* A pallet arrives in production. `RECEIVING_TRANSPORT_READY` is `false`. The queue lists the order
  and the Receive button opens the journey — and no receipt can be submitted. What does the operator
  see, and is it the *Not activated* state or a failure at submit?
* A supplier ships 4 of 12 on a line. The design says *"a line still short stays open and a partially
  received order stays SENT — no control here can close a line short, because no governed command
  exists to do it."* Is that still true, and who closes a genuinely short line?
* Two receivers scan the same box on two devices offline. The design's answer is the idempotency key
  travelling with the queued intent. **UNPROVEN at runtime in this lane.**

#### DESIGN P2 DISPOSITION — **KEEP** (the best-composed surface in the domain) **+ WORKFLOW GAP**

The composition is Owner-accepted and the truth states are exemplary. But in every environment except
one sandbox, **the page is a reader over a write path that refuses to attempt a call**. That is a
workflow gap, not a KEEP.

---

### R11a · Supplier multi-scan session (frames 1b + 1f)

**ORIGINAL DESIGN.** *"Scanning never moves inventory. Every quantity shown is the server's
derivation; the client only mirrors rules the command re-validates."* Scan line with serial field,
`Undo last scan` / `Clear queue`, a running `7 scans · 9 units queued` with the sentence
*"Scanning records what you saw — nothing moves until you submit. Focus returns here after every Add,
so a hardware scanner never needs a touch."* An **Expected versus observed** table
(`Line · Part · Ordered · Already received · Outstanding · Scanned now · Remaining after`), a
`Needs attention · 1` block for a scan not on the order — *"A blocked scan is never silently dropped
and never silently included"* — a receiving-location select, and a **protected Submit that says out
loud why it is protected**: *"Resolve the blocked scan first."*

**WHAT GOT BUILT — IMPLEMENTED.** `src/modules/receiving/MultiScanReceiving.jsx`, mounted from both
`Receiving.jsx:188` and `ScanWorkspace.jsx:305` — two launch points, one workflow. Submit disabled
unless `reconciliation.submittable && locationId` (`MultiScanReceiving.jsx:341`); command
`submitCanonicalReceive` (`services/receivingCallableClient.js:145`). Frame 1b's recomposition made
the **governed supplier name** the journey identity and stated *"No order number recorded"* rather
than rendering the opaque order id (`north-star-migration-ledger.md:1737`).

The multi-line capability itself was a blocking reconciliation: the deployed authority originally
accepted **exactly one line, one part, at exactly full ordered quantity**; resolved by Owner ruling
2026-08-20 as **derived-only** `NOT_RECEIVED / PARTIALLY_RECEIVED / RECEIVED` with **no persisted
partial status** (`docs/product/inventory-scanner-reconciliation.md:241-251`).

**AUTHORITY.** `submitCanonicalReceive` → `receiveInventoryStock`; `inventory.stock.receive` ACTIVE
and granted; **`RECEIVING_TRANSPORT_READY` sandbox-only**. Offline intent `INVENTORY_RECEIVE`
(`docs/architecture/warehouse-parts-offline-runtime.md:24,68`).

**DISPOSITION — KEEP + WORKFLOW GAP** (same readiness gate). One additional finding: the sandbox
validation records that receiving was **granted to no warehouse persona** — deliberately withheld
(`docs/releases/scanner-sandbox-validation-2026-08-21.md:36,54-56,124-125`). A multi-scan receiving
screen that no warehouse role may complete is a screen over an inert grant.

---

### R11b · Reorder PO linear journey (frame 1d)

**ORIGINAL DESIGN.** Four steps — Destination → Serials (serial-tracked only) → Confirm → Result.
*"Quantity is a confirmation, never an editable field (v1 contract)."* Serial capture shows the
duplicate inline (*"Duplicate serial numbers aren't allowed — each unit needs its own"*), `Enter`
advances so a hardware scanner walks the list hands-free, and **serial identity is case-significant;
nothing is folded or normalized**. The confirm step reads back part, PO, `Quantity to receive 2
(full order)`, location and serials. *"A retry rebuilds the identical request — a double press yields
'Already received', never duplicate stock."*

**WHAT GOT BUILT — IMPLEMENTED.** `src/modules/receiving/ReceiveAgainstPurchaseOrder.jsx` over
`src/domain/receiveAgainstPurchaseOrder.js` (`RECEIVE_STEP` at `:31`; the pure duplicate/blank
diagnostic at `:118-133`). Frame 1d additionally **removed a `?? reorderRequestId` raw-id fallback**
from both the candidate list and the review read-back — absence is now stated and the pattern is
source-pinned unrepresentable (`north-star-migration-ledger.md:1751`).

**AUTHORITY.** Same command and same readiness gate as R11a. The full-quantity v1 contract is in the
domain module's own header.

**DISPOSITION — KEEP + WORKFLOW GAP.** Also **PRODUCT GAP**: there is still no governed command to
receive a partial quantity against a reorder PO, so a short delivery has no representation on this
journey at all.

---

### R11c · Add existing unit — side sheet (frame 1c)

**ORIGINAL DESIGN.** The Owner's brief §7–§11 specifies this surface more precisely than anything
else in the domain: field order (Part → Serial number → Company location → Reason → Provenance note),
label wording, the exact three-reason closed vocabulary with its three hint sentences, the
**two-stage Review → Confirm** rule (*"Do not commit merely because the last required field became
valid"*), the consequence sentence (*"This creates a company-owned serialized asset in AVAILABLE
inventory without a purchase order or supplier receipt. It does not assign the unit to a customer."*),
the success wording *"Added to company inventory"*, and the location truth model's **critical
invariant**: never simultaneously show a selected location and text claiming locations could not be
read. The canvas adds *"A closed set with no default — no reason is true by omission, and 'we bought
it' is deliberately not among them."*

**WHAT GOT BUILT — IMPLEMENTED.** `src/modules/receiving/AcquireExistingUnit.jsx` over
`src/domain/serializedAssetAcquireForm.js` / `serializedAssetAcquireVocabulary.js` (`ACQUIRE_REASON`
is a closed vocabulary of exactly three). PR #1639 already composed the dialog to North Star quality;
frame 1c **re-hosted it in the shared `Modal` primitive as a right-docked side sheet** (additive
`variant="sheet"`, same trap/Escape/backdrop/restore contract) and corrected the post-success truth
so the sheet stops looking armed (`north-star-migration-ledger.md:1752`).

**AUTHORITY.** `acquireSerializedAsset`, capability `inventory.serializedAsset.acquire`,
**`active: false`** (`permissionCatalog.ts:1282`), granted to `inventorySerializedAssetAcquirer`
(`governedBusinessRoles.ts:1546`). Placement ruled by **ND-33** — Inventory → Receiving, not Equipment
(`north-star-open-product-decisions.md:1198-1213`).

**DISPOSITION — KEEP.** This is the one surface in the domain where a written design brief, a drawn
frame, an existing trusted writer and a shipped composition all agree. The action is **absent, not
disabled**, without its capability — the correct treatment. The gap is only that the capability is
`active: false`, so in production the section is invisible to everyone.

---

## Part 4 — WAREHOUSE · BIN · LOCATION · TRANSFERS

**No Claude Design canvas exists for any surface in this part.** The design record is ADR-014
(Decision #160, amended by #170), five bin specifications, one implementation plan, two runbooks and
four assessments. It is a *written* design tradition of unusual quality — and none of it was ever
drawn, reviewed visually, or given a visual acceptance gate.

### R5 · `/inventory/warehouses` — Warehouses register

**ORIGINAL DESIGN.** Lists P2 **MIGRATE #9**: cursor-paged, **no record route, and none invented**
(`LISTS-P2-COLLECTION-DISPOSITION.md:60`, `:78-80`). The user guide states the primary question:
*"Which warehouses exist, are they Active, and are they eligible to receive?"*
(`docs/user-guide/inventory/view-warehouses.md:3`). Facts: total / eligible-to-receive / inactive,
filters All·Active·Inactive with per-filter counts, columns Warehouse · Status · Receiving. The
eligibility rule is *"exactly the same rule Receiving uses"* (`:23`). Actions: **none** — *"Can't find
a create/edit/activate button: that's expected"* (`:31`). Named gap: *"This screen doesn't show
bin-level stock or reconciliation for a warehouse"* (`:24`).

**WHAT GOT BUILT — IMPLEMENTED, read-only, as designed.**
`src/modules/inventory/Warehouses.jsx`; exact counts only when the cursor is exhausted (`:132-139`);
ungoverned warning (`:173-179`); **no write action at all — deliberately absent, not disabled**
(`:162-163`). Lists P2 records it complete with *"rows inert, no route invented"*
(`LISTS-P2-COLLECTION-DISPOSITION.md:540`).

**CURRENT EOS AUTHORITY — this is the gap.**

* Object `warehouses` (`metadata/definitions/warehouse.js:74`), Rules `firestore.rules:1176`.
  PostgreSQL mirror `eos_ops.warehouses`
  (`functions/migrations/1758240000000_warehouse-and-bin-location-authority.sql:129`).
* **VERIFIED, all three parts of the lane-brief claim.** The governed writer
  `functions/src/warehouseGovernance/warehouseStatusWriter.ts` declares itself at `:1-6` as *"the
  INERT, UNEXPORTED trusted warehouse-status writer … NOT exported from functions/src/index.ts; no
  callable; production-inert (no caller)."* A repo-wide grep for `warehouseStatusWriter` finds **only
  test files** — `functions/test/warehouseStatusWriter.test.mjs:14`,
  `functions/test/warehousePhysicalRootCompany.test.mjs:223,234` — and **no `src/` importer**. Its
  capability `inventory.warehouse.status.set` (`warehouseStatusWriter.ts:24`, checked `:127`, `:176`)
  is **absent from `permissionCatalog.ts` and from every Role**; the file's own comment at `:23`
  admits *"Referenced by string only."*
* **The second warehouse writer is equally inert.** `functions/src/eosOps/warehouseBinRepository.ts`
  states at `:10-13` that it is *"NOT wired to an HTTP operation and NOT called by the deployed
  client"*; its only importers are two test files.
* **There is no registered warehouse WRITE capability anywhere in this repository.** The only three
  registered warehouse capabilities are reads — `warehouse.record.read`
  (`permissionCatalog.ts:590`), `warehouse.stockLocation.read` (`:596`),
  `warehouse.transferOrder.read` (`:602`).
* **Every real warehouse row therefore came from a seed or an operator CLI** — consistent with the
  provisioning runbook (`docs/operations/warehouse-assignment-provisioning-runbook.md:46-55`), which
  is an Owner-authored-manifest, dry-run-by-default, plan-hash-gated tool and not a product surface.

**NEW OPPORTUNITIES.** Registering `inventory.warehouse.status.set` (ungranted) and exporting the
writer are two small, separable gates — the ADR-014 estate cannot be operated without a governed way
to activate a warehouse. Today the custody parent of the entire inventory model is created by hand.

**SCENARIO QUESTIONS.** A new site opens. Who creates the warehouse, through what surface, and what
proves it was governed? Today: an operator, through a script, and nothing product-side.

**DISPOSITION — KEEP** (read surface, correctly restrained) **+ AUTHORITY GAP** (no governed
warehouse write path exists at all).

---

### R7 · `/administration/warehouse-racking` — Bin administration & racking generator

**ORIGINAL DESIGN.** `docs/specifications/bin-administration-racking-generator.md`. Primary question
(`:24`): *"What racking exists in this warehouse, and what exactly will be created if I apply this
layout?"* Composition `Administration → Inventory/Locations → Warehouses → Racking/Bins`
(`:136-141`). Workflow: `configure → preview → validate/classify → explicit Apply → governed
createBin → bins/{binId}` (`:120-128`), with server-authoritative classification
`NEW | ALREADY_EXISTS | CODE_RESERVED | INVALID | MALFORMED` (`:286-292`) — *`ALREADY_EXISTS` means
replay, not resemblance* (`:294`). Any `INVALID` row blocks apply (`:322`); changing an input
invalidates the preview (`:458`); **partial apply stays committed** — *"Row 301 failing does not roll
back 300 successfully configured physical locations"* (`:338`). Deliberately absent: **no delete, no
claim-release, no warehouse creation, no formatter-width control** (`:356`) — *"a button for an
operation the server refuses is a lie."* Mobile: desktop/tablet first, *"mobile must remain usable …
but is not the design target"* (`:145`). New capability proposed: **none** — `previewBinCreates` is a
new command shape under the existing `inventory.location.bin.read` (`:267`, `:612`).

A second section, **Labels & Export** (`docs/specifications/bin-location-labels-and-export.md`),
answers *"What goes physically on the rack, and can I get that same data out?"* (`:22-26`): Code 128
encoding `EOS-LOC:<binId>` (`:261-266`), deterministic byte-identical CSV with no timestamp in the
body (`:371-373`), `INACTIVE` labels carrying a visible **OUT OF USE** mark (`:278-279`), and an
explicit refusal to model `labelVersion` / `lastPrintedCode` / `printedAt` / `physicalLabelStatus` —
*"EOS has no way to know what is physically stuck to a shelf; a field claiming otherwise would be
fiction"* (`:184`).

**WHAT GOT BUILT — IMPLEMENTED (repository), NOT DEPLOYED, AND UNREACHABLE.**
`src/modules/administration/AdminWarehouseRacking.jsx` with
`src/modules/administration/BinLabelsAndExport.jsx`. Commands `previewBinCreates`, `createBin`,
`renameBin`, `deactivateBin`, `reactivateBin`, `listBins`, `resolveBin`
(`services/binCommandClient.js:31-41`; server `functions/src/inventoryLocation/binCommands.ts:143`,
`:229`, `:303`, `:354`, `:378`, `:390`).

**THE FINDING OF THIS LANE.** `AdminWarehouseRacking.jsx:42` reads
`CAP_MANAGE = "inventory.location.bin.manage"` and checks it at `:158`. But
`REPORT_CAPABILITY_REQUEST` (`access/reportCapabilityAccess.js:30-37`) pulls in
`GOVERNED_SURFACE_CAPABILITY_IDS` (`access/governedSurfaceCapabilities.js:225-243`), whose
`PLACEMENT_SURFACE_CAPABILITIES` contains **only** `placement.record` + `bin.read`
(`governedSurfaceCapabilities.js:78-81`), and `hasCapability` returns `true` only when
`feed.decisions[id] === true` (`reportCapabilityAccess.js:139-149`). **`inventory.location.bin.manage`
is never requested, so `canManage` is `false` for every principal, in every environment, forever** —
including a holder of `inventoryBinAdministrator` (`access/governedBusinessRoles.ts:1268-1269`).
Create / Rename / Activate / Apply all render through `<Ungated>` (`AdminWarehouseRacking.jsx:323`).
This is the same "unasked question" class the same file already documents for Data Import
(`governedSurfaceCapabilities.js:96-120`) and Administration→Users (`:179-200`).

**CURRENT EOS AUTHORITY — and a correction to the lane brief.**

* Objects `bins`, `bin_code_claims` (`binCommands.ts:59-60`), `bin_placements`
  (`putAwayCommand.ts:51`), `warehouse_bin_conversions` (`binConversionGate.ts:18`). **None of the
  four is in the client entity registry** (`metadata/entityRegistry.js:56`, 29 entities) — a
  registry blind spot. All four are **deny-all by absence** from `firestore.rules`
  (`firestore.rules:1189-1191`, `binConversionGate.ts:7-8`).
* **`active: false` — VERIFIED.** `inventory.placement.record` `permissionCatalog.ts:1128` ·
  `inventory.stock.relocate` `:1157` · `inventory.location.bin.manage` `:1182` ·
  `inventory.location.bin.read` `:1190`.
* **"granted to no Role" — REFUTED.** Four governed Roles carry them
  (`access/governedBusinessRoles.ts`, exported at `:1711-1713`):
  `INVENTORY_PUT_AWAY_OPERATOR_ROLE` `:1239` → `bin.read` + `placement.record` `:1248-1249`;
  `INVENTORY_BIN_ADMINISTRATOR_ROLE` `:1259` → `bin.manage` + `bin.read` `:1268-1269`;
  `INVENTORY_STOCK_RELOCATION_OPERATOR_ROLE` `:1289` → `bin.read`, `catalog.read`,
  `catalog.alias.read`, `stock.relocate` `:1298-1301`; `INVENTORY_LOOKUP_READER_ROLE` `:1561` →
  `location.display.read` `:1573`. They are further **activated in `platform-sandbox`**
  (`config/environments.json:123-126`; Functions snapshot
  `access/environmentCapabilityOverrides.ts:522-528`, eligibility `:198-204`).
  **Net effect** — production DENY for everyone, because `active:false` short-circuits at
  `resolveEffectivePermission.ts:264` *before* Role eligibility; sandbox ALLOW for a Role holder. So
  *"inert in production"* is right and *"granted to no Role"* is **wrong**.
  **Four source comments repeat the stale claim and should not be trusted**:
  `field-ops-app-vite/src/services/binCommandClient.js:4`,
  `src/services/stockMovementClient.js:4`, `src/hooks/useLocationDisplaySource.js:12`, and
  `docs/implementation-plans/bin-location-authority-and-scanning.md:99`.
* **Sandbox bin counts.** The 2026-09-02/09-03 censuses measured **0 bins and 0 placements in both
  sandbox and production** (`docs/specifications/bin-stable-identity-and-racking-structure.md:471-472`;
  `docs/assessments/bin-p1-sandbox-fixture-disposition.md:130`, `:143-146`). **UNPROVEN as of
  d104cf49**: `docs/releases/bin-sandbox-release-2026-09-10.md:37` records PR #1846 — *"Scanner runner
  creates bins through the BIN-P1 contract"* — and the identity spec warns at `:486` that
  *"nothing prevents a future scenario run from repopulating sandbox."* **No document states the
  current count, and this lane did not contact any environment.**
* Bin state machine `ACTIVE ↔ INACTIVE`, nothing ever deleted
  (`inventoryLocation/binRegistry.ts:48`; `bin-stable-identity-and-racking-structure.md:86`); code
  claims `HELD → SUPERSEDED`, permanently reserved, **no release command exists** (`:277-289`).

**NEW OPPORTUNITIES.** Adding `inventory.location.bin.manage` to `PLACEMENT_SURFACE_CAPABILITIES`
would make an entire built, tested, specified administration surface reachable. It is a one-line
registry addition, not an authority change — the capability stays `active: false` and the server
stays the decision-maker.

**SCENARIO QUESTIONS.** Phoenix is to be racked. A bin administrator signs in, opens the page, and
every control is `Ungated`. What do they do? (Today: nothing. The racking is created by nobody.)

**DISPOSITION — WORKFLOW GAP** (the screen renders over a capability the shell never asks about)
**+ AUTHORITY GAP** (all four bin capabilities inert in production).

---

### R8 · `/inventory/transfers` — Transfers

**ORIGINAL DESIGN.** Lists P2 **MIGRATE #12**, with a named defect to fix during migration:
*"renders a part **document id** as its own visible link label (`Transfers.jsx:226`)"* — R3
(`LISTS-P2-COLLECTION-DISPOSITION.md:88-89`). The user guide gives the question — *"What inventory is
moving between locations right now, and what is its status?"*
(`docs/user-guide/inventory/view-transfers.md:3`) — the state machine
`Requested → In transit → Completed`, or `Cancelled` (`:25`), and the read-only posture: *"Transfers
are created by Field Ops' backend processes, not from this screen"* (`:9`).

**WHAT GOT BUILT — IMPLEMENTED, and then it grew write actions the guide does not describe.**
`src/modules/inventory/Transfers.jsx`. R3 was corrected and the part label is **BLOCKED**, stating
`Unresolved reference`, with the id surviving only in the `href`
(`LISTS-P2-COLLECTION-DISPOSITION.md:591`) — every alternative (widening the read, a resolver
callable, a client read, fabricating a name) was available and refused.

But the page now renders four write controls — **New transfer** (`Transfers.jsx:151-155`),
**Dispatch** (`:277`), **Cancel** (`:280`), **Receive** (`:286`) — all wired to real callables
(`services/transferCommandClient.js:22-27`), **none client-disabled**, over an in-page warning at
`Transfers.jsx:111-115`:

> *"Transfer actions need the inventory transfer authority, which is not switched on for most
> accounts here. You can review transfers below; creating, dispatching, receiving or cancelling one
> will be refused unless that authority has been granted to you."*

The warning is accurate. `inventory.transfer.create|dispatch|receive|cancel` are all **`active:
false`** (`permissionCatalog.ts:1309,1316,1323,1330`) but **are** granted —
`inventoryTransferOperator` (`governedBusinessRoles.ts:1153-1156`) and, for `.receive` only, the
narrower `inventoryTransferReceiver` (`:1318`), which exists because the design found that a
technician accepting a truck handoff needed receive **without** create/dispatch/cancel — *"far too
much for a van"* (`docs/product/scanner-release-readiness.md:98-101`).

**CURRENT EOS AUTHORITY.** `transfer_orders` (`metadata/definitions/transferOrder.js:126`;
`firestore.rules:1199`); commands `inventoryTransfer/transferOrderCommand.ts:165` / `:290` / `:394` /
`:499`; state machine `REQUESTED · IN_TRANSIT · COMPLETED · CANCELLED`
(`inventoryTransfer/transferOrderTypes.ts:22`); ledger types `TRANSFER_OUT` / `TRANSFER_IN`
(`operationalMovementTypes.ts:21-22`). PostgreSQL `eos_ops.transfer_orders`
(`1758672000000_purchasing-object-authority.sql:379`), **no writer**. BIN-P6 widened
`TRANSFER_ENDPOINT_TYPES` to `WAREHOUSE | BIN | MOBILE`
(`docs/specifications/bin-stock-relocation-and-multi-scan.md:262`); **UNPROVEN** how a BIN endpoint
renders on this list — the user guide still describes only warehouse and mobile.

**DISPOSITION — IMPROVE + WORKFLOW GAP.** The list composition is correct and the honest
`Unresolved reference` treatment is exemplary. The four action buttons render live over capabilities
that are inactive in production; the page says so in prose rather than in the control's own state.

---

### R9 · `/inventory/truck-inventory` · R6 · `/inventory/warehouse-workspace` · R10 · `/inventory/cycle-counts`

**R9 Truck Inventory.** Lists P2 **MIGRATE #13**: *"the drawer **is** the record surface. Do not
promote it to a route during a list migration"* (`LISTS-P2-COLLECTION-DISPOSITION.md:90-91`). Built at
`src/modules/inventory/TruckInventory.jsx`; management gated on **both** role (admin/dispatcher,
`App.jsx:248`) and `TRUCK_MANAGEMENT_WRITE_READY` (`hooks/useTruckManagement.js:41-42`), which is
**false in certification and `taylor-parts-production`** (`config/environments.json:51,82,217,246,278`);
`TRUCK_DEACTIVATE_READY` and `TRUCK_DELETE_READY` are **false everywhere**. The scan-review dialog
carries a hard-coded permanently-inert control:
`<button disabled title="Movement is not available in this workspace">Confirm (not available)</button>`
(`TruckInventory.jsx:153`). **DISPOSITION — WORKFLOW GAP.**

**R6 Warehouse handheld shell.** Design: `docs/architecture/warehouse-parts-handheld.md`.
**"Width chooses composition, never authority"** (`:46-50`) — phone gets `WarehouseShell`, wider gets
`ScanWorkspace`, both reaching the same governed workflows. Navigation is *"`Home | Scan | Work |
More` — four, and no more"*, because *"every extra tab is a decision somebody makes before doing any
work"* (`:55-66`). **The decisive design finding**: only receiving has a governed list callable, so
**every other queue is offered as a way in with no number** — *"A missing number is a small
disappointment. A wrong number in a warehouse is a stock-out somebody discovers at a customer site"*
(`:26-40`). Attention order is **declared, not scored**, because there is no cross-domain urgency
model and inventing one would mean a number nobody agreed on (`:69-83`). Touch floor **48px, not 44**
— *"Apple's 44pt assumes a bare fingertip, and a warehouse in winter does not have one"*
(`docs/product/inventory-scanner-program-state.md:906-911`). Measured at 320/375/390/414; **a first
measurement pass was invalid** because HMR had removed the injected stylesheet and it measured
unstyled markup — recorded *because the numbers looked fine and were meaningless* (`:141-142`).
**Built** (`src/modules/warehouse/WarehouseShell.jsx`, `App.jsx:850-853`). **But the route declares
`capabilityAccess: WAREHOUSE_HANDHELD_CAPABILITIES` with no `legacyKey`, and `navConfig.js:683`
fails closed — so a plain admin or dispatcher cannot see or reach it**; the same `ScanWorkspace` is
still reachable at `/service/scan`, which does carry the `fieldMode` legacyKey.
**DISPOSITION — KEEP + WORKFLOW GAP** (nav fail-closed inconsistency).

**R10 Cycle Counts.** Design: `docs/specifications/cycle-count-multi-part-sheet.md` (APPROVED
Revision 2, 2026-09-10) plus a **code-only "Cycle Counts North Star P1" derivation layer**
(`field-ops-app-vite/src/domain/cycleCountNorthStar.js:1`) that carries its own backlog in its header
— **CC-B1** no recount/reopen concept, REJECT is terminal; **CC-B2** no stored counter-completion
state; **CC-D3** a progress denominator `N of M` is produced only when the caller can prove it read
every line. There is **no `.dc.html` for Cycle Counts** — the North Star grammar reached this family
as code without ever being drawn. Built at `src/modules/inventory/CycleCounts.jsx`; every action is
wired to a real callable (`services/cycleCountCommandClient.js:29-40`); client-side disabling is
**courtesy only**, the server is the separation-of-duties authority (`CycleCounts.jsx:41-43`).
Capabilities `inventory.cycleCount.create|submit|reconcile|cancel` are **all `active: false`**
(`permissionCatalog.ts:1345,1352,1359,1366`), granted to `inventoryCycleCountCounter`
(`governedBusinessRoles.ts:1183-1185`) and `inventoryCycleCountReconciler` (`:1208`).
**`inventory.cycleCount.close` is referenced in code
(`eosOps/migration/inventoryWriterCapabilityCensus.ts:205`) and is NOT in the permission catalog at
all.** Blind counting (Decision #111) and separation of duties are intact; the count is an
observation and only reconcile writes `ADJUSTED`.
**DISPOSITION — KEEP + AUTHORITY GAP** (unregistered `close` capability; all four inactive).

---

## Part 5 — PURCHASING

**No Claude Design canvas exists for any purchasing surface.** The design record is Lists P2, the
Purchase Order structured-list migration, and a reorder-lineage reconciliation.

### R12 · `/purchasing` — Purchase Orders

**ORIGINAL DESIGN.** Lists P2 **MIGRATE #11**, and the sharpest warning in the disposition:
*"`CONTRACT_ONLY`: a full metadata definition exists and the reachable screen mounts none of it, over
a **different collection** from the one that stores PO money. Migration must not attach `totalCost`
from `purchase_orders` to rows read from `reorder_purchase_orders`"*
(`LISTS-P2-COLLECTION-DISPOSITION.md:84-87`). The structured-list design
(`docs/architecture/purchase-order-structured-list.md`) then specified the full surface: desktop
columns `Purchase Order · Vendor · Status · Ordered · Received · Remaining · Receipt State · Created
Date · Dollars`, mobile as label/value cards with identical field semantics (`:136-138`), and a
**"Dollars never lies"** contract (`:140-148`) — the raw number kept on the field so sorting compares
values (*"`$1,000.00` sorts before `$9.00` as text, which is the classic way a money column
misleads"*), **unknown is not zero** (*"`$0.00` says an order is worth nothing; a missing total says
we do not know what it is worth — on a purchasing list those are opposite facts"*), and `NaN` /
`Infinity` / a numeric *string* all rendering as an absence. Two fields were **refused rather than
filled**: `PO BUYER FIELD NOT AUTHORITATIVE` and `PO BUSINESS LINE NOT DERIVABLE` — both left
`displayable: false` **and** non-reportable and non-exportable, *"so an export cannot become the back
door through which an unproven column ships"* (`:76-89`).

**WHAT GOT BUILT — PARTIAL. The designed list is not the shipped list.**
`src/modules/purchasing/PurchaseOrders.jsx` is a read-only cross-request join of `reorder_requests` +
`reorder_purchase_orders` with filter chips Open / Received / Voided / Needs-attention / All
(`:81-87`, `:182`), an ORPHAN integrity note (`:237-242`) and an expandable *Receipt source*
descriptor (`:243-261`). It shows **no money anywhere, deliberately** (`:165-177`) and has **no create
action** — *"absent, not disabled"* (`:178-179`).

So the Dollars contract, the nine-column grammar and the mobile card composition were designed
against `purchase_orders`, and the reachable screen reads `reorder_purchase_orders`. Lists P2 records
the migration as *"complete — **CONTRACT_ONLY on money preserved**"*
(`LISTS-P2-COLLECTION-DISPOSITION.md:542`), which is the correct outcome, and it means **the designed
Purchase Order list has never been built for the collection users actually see**.

**CURRENT EOS AUTHORITY — three rulings, all verified.**

1. **Immutable PO — VERIFIED.** `match /reorder_purchase_orders/{requestId}` carries
   `allow update, delete: if false`
   (`docs/assessments/reorder-purchase-order-lineage-reconciliation.md:26`).
2. **PO id == request id — VERIFIED.** The PO's document id **is** the reorder request's id, and the
   create rule additionally pins `reorderRequestId == requestId`; the create and the request's
   transition to `ORDERED` must land **in the same commit** (`existsAfter`/`getAfter`) — *"Neither
   can exist without the other"* (`:26`, `:40-46`). Consequence, stated in the source:
   *"a multi-line PO spanning three parts has no single reorder request to be named after"*
   (`functions/src/purchasing/purchaseOrderNormalization.ts`, quoted at `:24`).
3. **Void writes a void record — VERIFIED.** Object `purchaseOrderVoid`
   (`metadata/definitions/purchaseOrderVoid.js:114`), collection `reorder_purchase_order_voids`
   (`firestore.rules:1098`), PostgreSQL `eos_ops.purchase_order_voids`
   (`1758672000000_purchasing-object-authority.sql:278`). **Its sole writer is the client**,
   `field-ops-app-vite/src/domain/reorderPurchaseOrders.js:147`.

Also established, and load-bearing:

* **There is no trusted command that creates a reorder PO.** *"No such command exists. The write path
  is the CLIENT, through Rules"* (`reorder-purchase-order-lineage-reconciliation.md:60`).
* **A canonical PO has no business number at all (RCV-G5)** and no operating company; the second is
  refused rather than inferred because *"a PO may legitimately mix Taylor and Ventana parts, so there
  is no single business line to assign even by inference"* (`purchase-order-structured-list.md:86`).
* **`totalCost` carries no declared unit.** Major units are an **inference from evidence**, recorded
  as `PO_TOTAL_UNIT_CONVENTION` — *"A 100× formatting error on a purchasing total is severe"*
  (`:47-60`).
* PO state machine `procurementService.ts:25-31` (`VALID_TRANSITIONS`, enforced `:97`):
  `DRAFT → {APPROVED, CANCELLED}` · `APPROVED → {SENT, CANCELLED}` · `SENT → {RECEIVED, CANCELLED}` ·
  `RECEIVED`/`CANCELLED` terminal. **UNPROVEN:** no capability check was found inside
  `procurementService.ts:59,85` (`createPurchaseOrder` / `updatePurchaseOrderStatus`); the caller may
  enforce it.
* One measured data integrity fact: the sandbox holds **one orphan PO**, `ro-sbx-005`, seeded through
  the Admin SDK by `functions/scripts/seedSandboxTransactional.js:518`, bypassing Rules; all three
  seeded POs are *"shapes the governed client path could not have produced"*
  (`reorder-purchase-order-lineage-reconciliation.md:64-72`).

**NEW OPPORTUNITIES.** A governed PO business number (RCV-G5) unlocks scan entry (RCV-G7), receipt
labels (RCV-G2), and the ability for two people to talk about the same order out loud. Declaring the
`totalCost` minor-unit convention closes a severe-consequence inference.

**SCENARIO QUESTIONS.** A buyer needs to change a quantity on an order already placed. The PO is
immutable and voiding writes a separate record — so the answer is void and re-raise. Does the reorder
request lifecycle support that, and what happens to the original request's `ORDERED` state?

**DISPOSITION — IMPROVE + PRODUCT GAP.** The reachable list is honest and restrained; the designed
list (columns, Dollars contract, mobile cards) exists only against a collection the screen does not
read.

---

### R13 · `/purchasing/suppliers` · R14 · `/purchasing/receipts` · R15–R17 placeholders

**R13 Suppliers.** Lists P2 **MIGRATE #8**, *"declares no `rowNavigationTo`, correctly"*
(`LISTS-P2-COLLECTION-DISPOSITION.md:59`). Built at `src/modules/purchasing/Suppliers.jsx`, read-only,
**no write path — `suppliers` is Admin-SDK-write-only and create is absent by design** (`:184-186`).
Authority: `supplierMaster/supplierMasterCommands.ts:81,149,271,274` under
`inventory.catalog.manage`/`.activate`; state `ACTIVE · INACTIVE`
(`supplierMaster/supplierMasterTypes.ts:9`); PostgreSQL `eos_ops.suppliers`
(`1758499200000_...sql:165`) with a migration mapper and **no live writer**.
The design tension recorded in the memory archive is still live: governed supplier selection was
built for the **admin/dispatcher PO path only**, and *"PARTS_ASSOCIATE PO surface
(PartsAssociateHome) stays free-text — recorded as a tracked follow-on AT THE SITE; NOT converted
(would require widening the legacy `suppliers` read Rules, which Owner forbade)"*
(`docs/ai/memory-archive/project_purchasing_po_ui_and_scanner.md:20`).
**DISPOSITION — KEEP + WORKFLOW GAP** (one of the two PO-creation paths still persists a free-text
supplier name).

**R14 Receipts.** Lists P2 **COMPOSE #34**, with an explicit recommendation that was not taken:
*"**Should become a saved VIEW of Purchase Orders, not a second list.** It already reuses
`buildPurchaseOrdersView`'s RECEIVED subset and reads no `receiving_orders`. Two lists over one
projection is exactly how the definitions and the screen drift apart."*
(`LISTS-P2-COLLECTION-DISPOSITION.md:145`). Built as a separate route
(`src/modules/purchasing/Receipts.jsx`), honestly stating that the governed receipt ledger is
backend-only and not shown (`:19-24`, `:37-41`).
**DISPOSITION — REPLACE** (fold into Purchase Orders as a saved view, per the standing Lists P2
recommendation) **+ AUTHORITY GAP** (RCV-G1: no governed receipt-history read exists).

**R15 `/purchasing/quotes` · R16 `/purchasing/demand-planning` · R17 `/inventory/back-orders`.**
All three are `navHidden` placeholders rendering `PlaceholderPage` (`App.jsx:829`), classified by
Lists P2 as *"Not a surface — nothing to migrate"*, *"no object, no read"*
(`LISTS-P2-COLLECTION-DISPOSITION.md:234-235`). The routes still exist and are reachable by URL.
**DISPOSITION — REMOVE** the routes, or **ADD** the objects. A reachable URL that renders *"This area
isn't built yet"* is a promise with no owner.

---

### R18–R20 · The three inventory role homes, and the reorder workflow they carry

**ORIGINAL DESIGN.** Lists P2 **EXEMPT #64** — *"Inventory role homes (Parts Manager, Warehouse
Manager, Parts Associate)"* are dashboard panels over a projection, not a set to scan
(`LISTS-P2-COLLECTION-DISPOSITION.md:219-220`). The consolidation design is recorded in
`docs/ai/memory-archive/project_parts_ux_redesign.md:34`: three role surfaces plus `/inventory`'s
Work group now share **one implementation each** of `ManagerQueuePanel` / `AssociateRequestPanel` /
`AssignedWorkOversightTable`, with *"zero capability widened"*.

**WHAT GOT BUILT — IMPLEMENTED.** `src/modules/inventoryRole/{PartsManagerHome,WarehouseManagerHome,
PartsAssociateHome}.jsx`, each gated by `operationalRoleAccess` requiring role `technician` **plus**
ACTIVE employment **plus** the matching operational role (`navConfig.js:406`, `:412`, `:422`;
predicate `navConfig.js:635-640`). Admin and dispatcher are redirected to `/inventory`
(`App.jsx:1102-1104`). **No per-action capability checks exist inside these three — the route gate is
the gate** (stated at `PartsManagerHome.jsx:20-24`, `PartsAssociateHome.jsx:14-18`).

**CURRENT EOS AUTHORITY — the reorder lifecycle.** Ten states
(`src/domain/constants.js:227-247`, mirrored `eosOps/purchasingRepository.ts:67-71` and
`eosOps/migration/purchasingMigrationMapping.ts:71-76`):
`PENDING_REVIEW · APPROVED · REJECTED · READY_FOR_PARTS_MANAGER · ASSIGNED_TO_PARTS_ASSOCIATE ·
PURCHASING_IN_PROGRESS · ORDERED · RECEIVED · CANCELLED · VOIDED`. The from→to edge table with its
capability per edge is at `src/domain/adminWorkflowView.js:49-60`. Fourteen `reorder.*` capabilities
are registered and **all are ACTIVE** (`permissionCatalog.ts:447-535`) — the only substantial cluster
of active write capabilities in this entire domain — granted across `partsManager`,
`purchasingManager`, `warehouseManager`, `operationsManager`, `generalManager` and, by compatibility,
admin + dispatcher (`compatibilityRoles.ts:58-72`).

**But only two transitions go through a trusted command.** `buildCreateReorderRequest`
(`reorderRequest/reorderCommands.ts:112`) and `buildRecordReorderPurchaseOrder` (`:287`). **Every
other transition — approve, reject, assign, start purchasing, post-purchasing update, mark received,
cancel, void — is a direct client Firestore write** from
`field-ops-app-vite/src/domain/inventoryReorderRequests.js` and
`src/domain/reorderPurchaseOrders.js`, governed by Rules alone. The narrow trusted boundary that
would close this is fully designed and explicitly **not authorised**:
`docs/specifications/reorder-trusted-command-authority.md:3` — *"gate: Owner decision — DESIGN ONLY,
not authorized for implementation"*, and its own framing at `:19` — *"It is a **Tier-2 authority
change**, not an inert metadata addition."*

**DISPOSITION — KEEP + AUTHORITY GAP.** This is the one genuinely complete operational workflow in
the domain: ten states, real capabilities, real grants, real users. Its authority model is the
weakest — eight of ten transitions are client-authoritative — and the fix is designed, costed and
sitting unbuilt.

---

## Part 6 — SCANNER

**No Claude Design canvas exists for any scanner surface.** The design record is the four-document
`docs/product/inventory-scanner-*` programme, `docs/architecture/warehouse-parts-handheld.md`,
`docs/architecture/warehouse-parts-offline-runtime.md`, a governance decision, two release records
and a blind mission review. Lists P2 classifies the whole family **EXEMPT #47–#56** — *"one task at a
time, not a set to compare"* (`LISTS-P2-COLLECTION-DISPOSITION.md:199-205`).

### The founding principle

`docs/product/inventory-scanner-program.md:25-28`:

> `scan → resolve → establish context → queue → validate → review → confirm → trusted bulk command →
> ledger/custody/audit → receipt`

and `:21` — *"The scanner identifies an object and prepares an operation; it never changes inventory
merely because a barcode was read."* In source: *"Scanning resolves IDENTITY. Scanning does NOT
determine AUTHORITY."* One shared engine, not three (`:30`) — verified at closeout,
`resolveScannedIdentity` is defined exactly once
(`docs/product/inventory-scanner-program-state.md:1079-1082`).

### R21 · `/service/scan` — Scan Workspace and its nine workflows

**ORIGINAL DESIGN.** Primary question: *"What are you here to do?"* — listing **only workflows the
caller can actually complete** (`docs/user-guide/inventory/scan-workspace.md:14-17`). Unsupported
workflows are **absent, not disabled**, *because a disabled control asserts the operation exists*
(`inventory-scanner-program-state.md:107-112`; `warehouse-parts-handheld.md:90-93`). Access composes
`capabilityAccess: RECEIVING_SURFACE_CAPABILITIES` **and** `legacyKey: "fieldMode"` on one nav item,
with `ROLE_NAV_ACCESS` untouched and **no `scanner.access` capability invented** (`:76-94`).

**Hardware-scanner input rules** (`shared/ui/ScanInput.jsx` over pure `domain/scanInputPolicy.js`)
are the most carefully-reasoned design in the domain (`inventory-scanner-program-state.md:584-624`):
repeat-suppression windows differ by source — **250 ms for a hardware wedge, 1500 ms for a camera**,
with an unrecognised source defaulting to the shorter — because *"counting ten identical boxes means
scanning the same value ten times, deliberately"* and suppressing that would silently under-count. A
suppressed repeat is **NEUTRAL, never an error**. Focus returns to the field after every scan.
Feedback runs three channels: sound distinguished by **pitch** (survives a forklift), vibration as a
**rhythm** (a gloved hand cannot tell one buzz from another), and one `aria-live` sentence that always
**names the value** — *the text channel **is** the accessibility channel*. Camera degrades honestly:
no `getUserMedia`, refused permission, and no `BarcodeDetector` are **three different messages**.

**Dictation** (`shared/ui/DictatableNote.jsx`) is *"an input method, **not an assistant**"* — a test
asserts it reaches no transport, resolves no identity, and cannot even name `intent`, `parseCommand`,
`assistant` or `nlp`; there is **no path where spoken words are stored without a human having seen
them** (`:860-879`). Conversational assistant, voice commands, AI route optimization, automatic
replenishment, camera damage recognition and autonomous exception classification are **explicitly out
of scope, none built or scaffolded** (`:913-918`).

**WHAT GOT BUILT — IMPLEMENTED.** `src/modules/scan/ScanWorkspace.jsx`, with an explicit
*"Not available to you"* list carrying per-workflow reasons (`:353-364`) and a never-blank empty
state (`:330-339`). Nine workflows are registered
(`field-ops-app-vite/src/access/scanWorkflows.js:26-37`):

| Workflow | Component | Command | Capability | Writes |
|---|---|---|---|---|
| Look up | `modules/scan/LookupScan.jsx` | read-only | **none** — always available (`scanWorkflows.js:157`) | nothing |
| Transfer | `TransferScan.jsx` | `dispatchTransferOrder` / `receiveTransferOrder` | `inventory.transfer.dispatch` OR `.receive` (`:164`) | existing transfer ledger |
| Cycle count | `CycleCountScan.jsx` | `createCycleCountSheet`, `openCycleCountLine`, `submitCycleCountLine` | `.create` AND `.submit` (`:174`) | an observation; no stock movement |
| Put away | `PutAwayScan.jsx` | `resolveBin`, `recordPutAway` | `placement.record` AND `bin.read` (`:186`) | `bin_placements` only |
| Move stock | `MoveStockScan.jsx` | `relocateStock` (`services/stockMovementClient.js:9,14`) | `stock.relocate` AND `bin.read` (`:211`) | `RELOCATION_OUT`/`RELOCATION_IN` ledger pair |
| Pick | `PickScan.jsx` | `resolveBin`, `recordPutAway` | `placement.record` AND `bin.read` (`:196`) | same placement + `pickedForWorkOrderId` |
| Return intake | `ReturnIntakeScan.jsx` | `recordReturnIntake` | `inventory.returns.intake` (`:217`) | `inventory_returns`, **no ledger event** |
| Receive (supplier) | `modules/receiving/MultiScanReceiving.jsx` | `submitCanonicalReceive` | `inventory.stock.receive` AND `RECEIVING_TRANSPORT_READY` (`:131-135`) | receipt + `RECEIVED` ledger + serial registration |
| Work-order scan | `modules/mobile/PartsScanner.jsx` | `updateWorkOrderExecutionData` | role `technician` + technicianId + ≥1 assigned WO (`:230-239`) | WO execution data |

**`inventory.stock.relocate` is never requested from the access feed.** Its only definition sites are
`access/scanWorkflows.js:91` and `governedBusinessRoles.ts:1307`; it is absent from
`GOVERNED_SURFACE_CAPABILITY_IDS`. **The Move stock workflow can therefore never become available
through the shell-supplied `hasCapability`, even for a holder of
`inventoryStockRelocationOperator`.** This is the same defect class as R7's, and it disables the only
scanner workflow that moves quantity.

### `recordPutAway` — verified in full

**Definition** `functions/src/inventoryLocation/putAwayCommand.ts:280`; callable wrapper
`inventoryLocation/binCallables.ts:246-249`; exported `functions/src/index.ts:512`.

**It writes exactly one thing: documents in `bin_placements`.** The only write statement in the
function is `txn.create(deps.db.collection(BIN_PLACEMENTS_COLLECTION).doc(e.id), e.data)` at `:376`;
`BIN_PLACEMENTS_COLLECTION = "bin_placements"` at `:51`. It reads `bins` + `bin_code_claims`
(`:299-316`) and `serialized_assets` (`:336-337`), and nothing else.

**No ledger event, no balance.** `putAwayCommand.ts:13-15`: *"this command writes a PLACEMENT RECORD
and NOTHING ELSE. It writes no ledger event, changes no quantity, and touches no balance. A test
asserts the module never imports the ledger, a movement type, or any balance function."* Corroborated
independently at `docs/architecture/inventory-reference-authority-p1b-census.md:164`.

**The lane brief's phrasing needs one correction.** `recordPutAway` is **not** quantity-free: the
placement record carries a `quantity` field — `{...base, serialNo, quantity: 1}` per serial (`:151`),
or `{...base, serialNo: null, quantity}` for a bulk stow (`:155`). What is true, and stronger, is
that **that quantity participates in no balance**: `:19-22` — *"A bin is not a custody location, so
there is no authoritative 'how many are in A-14' … any 'where is it' answer is explicitly 'where it
was last put', not 'what is there now'."* So: **placement only, a descriptive quantity, no ledger
event**.

**And since BIN-P6 / Decision #170, `recordPutAway` alone no longer completes an authoritative
put-away.** An operation that both moves stock and records where it went requires **both**
`inventory.placement.record` **and** `inventory.stock.relocate`, atomically; an actor holding only
placement is **refused** the quantity movement rather than given a descriptive-only success that looks
authoritative (`ADR-014:93-95`; `governedBusinessRoles.ts:1235-1238`;
`inventoryLocation/stockRelocationCallables.ts:120-121`).

A real latent defect was found and fixed on the way through: `recordPutAway` looked serials up by
`${partId}__${serial}` and then a bare serial id, neither of which any writer produces, so **every
serialized put-away of a real registered unit was refused as `serial_unknown`**
(`putAwayCommand.ts:331-335`; `docs/specifications/bin-stock-relocation-and-multi-scan.md:415-421`).

### The case-only collision — VERIFIED, and fixed

**The leak was real.** `Part.partId` is governed by the **case-sensitive** `ID_PATTERN`
`/^[A-Za-z0-9_-]{1,64}$/` (`functions/src/partMaster/validation.ts:27`), so `prt-1001` and `PRT-1001`
are two different canonical Parts. `lookupScannedPart` deliberately fetches **both** the scanned code
and its upper-cased form (`functions/src/partMaster/scannerPartLookup.ts:9-10`). `MoveStockScan` feeds
the resolved `part.partId` to `relocateStock`, which writes it verbatim into `RELOCATION_OUT` /
`RELOCATION_IN` ledger rows (`functions/src/inventoryLocation/stockRelocationCommand.ts:263`) — and
every downstream validator passes it, because it *is* well-formed.

**Fixed.** `field-ops-app-vite/src/domain/scannedIdentity.js:237-244` — the dedupe key is now
`` `${m.entityType}:${String(m.entityId)}` ``, the **exact** canonical identifier, not a case-folded
one. The comment at `:221-236` states the failure precisely: *"Folding the key here made those two
collapse into one and the scan RESOLVE to whichever the governed read happened to list first — a
silent pick of a canonical id the operator never chose."* Matching itself stays case-insensitive
(`:141-142`) because a label printed `prt-1001` and one printed `PRT-1001` should both find the Part;
two distinct governed identities behind one scan now resolve **AMBIGUOUS** (`:246`).

Two enforcement tests: `field-ops-app-vite/test/scannedIdentity.test.mjs:89-105` and
`field-ops-app-vite/test/partLookup.test.mjs:66-84`.

**Provenance correction.** The fix is commit `e37366f59bbf3d71b3114bb7de9905ea092a885c`,
*"fix(scanner): refuse a case-only Part id collision instead of picking one"*, 2026-09-11, and it
**is an ancestor of the integrated head `d104cf49`** (verified with `git merge-base --is-ancestor`).
The label *"Wave 1"* is the calling programme's naming; **no document in this repository names a
Wave 1 for scanner work** — treat the label as external, the fix as verified.

**A deliberate asymmetry, and it is UNPROVEN whether it was intended.** Bin codes **are** upper-cased
on normalisation, because `a-14` and `A-14` are the same physical rack
(`inventory-scanner-program-state.md:660-663`). Serials are **trimmed but not case-folded** —
*"serial identity is case-significant"* (`test/receivingScanQueue.test.mjs:109`) — yet
`recordPutAway`'s within-request duplicate check **is** case-insensitive
(`putAwayCommand.ts:243-244`), as are cycle-count duplicate detection
(`src/domain/cycleCountScanSession.js:36-39`) and transfer serial matching
(`test/transferScanVerification.test.mjs:169`). **No document addresses the asymmetry.**

### Offline runtime — the most complete design in the domain

`docs/architecture/warehouse-parts-offline-runtime.md`. The principle, stricter here than for
technicians (`:39-50`): *"A technician's queued note is a claim about words. A warehouse worker's
queued receipt is a claim about stock."* → **"Offline capture never reserves, never allocates, and
never projects a balance."** Asserted by scanning every payload for `reserved`, `allocated`,
`projectedBalance`, `onHandAfter`, `committed`.

* **Eight closed intent types**, each mapping to one existing governed command, *"not a generic
  warehouse blob"* (`:66-78`): `INVENTORY_RECEIVE · PUT_AWAY · PICK_STAGE · TRANSFER_DISPATCH ·
  TRANSFER_RECEIVE · TRUCK_HANDOFF · CYCLE_COUNT_SUBMIT · RETURN_INTAKE`.
* **Two required dependency edges** (`:90-100`): `INVENTORY_RECEIVE → PUT_AWAY` (*placing something
  the server does not know exists is "not a race — it is a guaranteed refusal"*) and
  `TRANSFER_DISPATCH → TRANSFER_RECEIVE`, only when both were captured on **this** device.
* **UNVERIFIED is a first-class state, not a spinner** — *"Sent, but not confirmed yet — do not assume
  it is done"*; *"A spinner would be a lie of omission"*
  (`inventory-scanner-program-state.md:1009-1017`). An UNVERIFIED submission is **never re-sent
  automatically**; reconnection is a **read** (`:1019-1026`).
* **"Safe-to-replay and will-replay are different promises, and only the second is ours to make"**
  (`:1028-1034`). Key prefixes `rcvc_`, `plc_`, `ret_`.
* **A refusal is not a retry.** `permission-denied`, `invalid-argument`, `failed-precondition`,
  `not-found`, `unauthenticated` are terminal (`:1036-1044`). One submit policy:
  **"A clear server 'no' never becomes `Pending sync`"** (`offline/useWarehouseSubmit.js`,
  `warehouse-parts-offline-runtime.md:170-181`).
* **Durability is probed, never assumed** — IndexedDB → localStorage → memory; a device with nowhere
  durable reports `durable: false` and the UI says **"This phone is not saving work offline"**, never
  "saved on this device" (`:141-146`).
* **Principal isolation enforced twice** and a **separate storage namespace
  `eos.warehouse.offline`**, so one person being both technician and warehouse worker cannot have one
  runtime wipe the other's queue (`:62-64`, `:148-149`). Put-away was **migrated, not merely wired** —
  it had had a second queue whose `localStorage` key was **not scoped to a principal**, so two
  warehouse workers on one device shared it (`:183-188`).
* **Reconciling is permanently online-only** — no reconcile intent type, no binding, asserted at both
  layers: *"Reconnect to reconcile this count."* **A business rule, not a gap** (`:80-88`).

### R22 · Technician Parts Scanner, and the F2 mission review

**ORIGINAL DESIGN.** Three questions, then it gets out of the way: what did I scan? can I see it?
what can I do with it? (`docs/user-guide/technician-field/parts-scanner.md:9-14`). **Exactly ONE
action, `RECORD_PART_USAGE`**, enabled only when four conditions hold — caller's role is
`technician`, they hold the technician identity, the WO is assigned to them, and the part is planned
on that job — with `deriveScanActions` **mirroring, in order, what the server enforces** and the
server rejecting independently (`docs/governance/parts-scanner-access-decision.md:26-34`).

**The five-action demo menu (receive / use on WO / load truck / cycle count / add to PO) was removed
deliberately** — it ran against an in-memory demo parts array (`:22-26`). A stale-documentation
defect was found with it: **four user-guide entries claimed the Parts Scanner has a "Receive a
purchase order" action. It does not** (`:140-150`).

**THE OPEN EXPERIENCE FINDING.** `docs/reviews/f2-scanner-technician-missions.md:6-12` — three blind
rounds; FUNCTIONAL converged to PASS by round 3, **EXPERIENCE FAILED all three**.

Fixable without a decision (`:35-41`): errors styled weaker than success and not in
`role="status"`/`role="alert"`; error copy conflating *"not real"* (`PRT-9999`) with *"real, other
job"* (`PRT-1002`); `−` at quantity 1 a live button that does nothing; camera-denied message below
the fold; the scanner sitting **~1,900px from the job it acts on**.

Needs a decision (`:43-55`): **part identity is a bare SKU** — *"the single highest-value gap,
recurred in all three rounds"*; no running total and silent duplicate recording; **no undo or
correction of a recorded consumption**; off-plan/substitute parts hard-blocked server-side;
`Complete job` unguarded and irreversible; the scanner bound to one implicit job.

**F2 explicitly DOES NOT CLOSE** warehouse availability, truck availability, shortage orchestration,
fulfilment, job parts readiness or substitution (`:64-66`).

### Scanner disposition

| Surface | Disposition |
|---|---|
| `/service/scan` shell | **KEEP** — absence-not-disablement, derived availability, honest reasons |
| Look up | **KEEP** — the only always-available workflow; the three enrichment reads are `active:false` so rows state absences |
| Put away | **KEEP + AUTHORITY GAP** — capability inert in production; and placement alone is no longer an authoritative put-away |
| Pick / stage | **KEEP** — and **PRODUCT GAP**: it reserves nothing, and says so, so picked stock stays available to other jobs |
| Move stock | **WORKFLOW GAP** — `inventory.stock.relocate` is never requested from the access feed, so the only quantity-moving scanner workflow can never appear |
| Cycle count | **KEEP + AUTHORITY GAP** |
| Transfer / truck handoff | **KEEP** — *"a handoff IS a transfer whose destination is a truck"*; **no parallel handoff state machine was invented**, and a test asserts the surface cannot even name `handoff`, `truck` or `custody` (`inventory-scanner-program-state.md:829-832`) |
| Return intake | **PRODUCT GAP** — backend built, **no scan-workspace tile exists**; backend-operable only (`docs/releases/scanner-sandbox-validation-2026-08-21.md:133-134`) |
| Supplier receive | **KEEP + WORKFLOW GAP** (readiness constant) |
| Technician Parts Scanner | **IMPROVE** — F2's five fixable findings; **PRODUCT GAP** on part identity, undo, and running total |
| Offline runtime | **KEEP** — the strongest design artefact in the domain |

---

## Part 7 — Capability truth: a standing correction to the 2026-08 design record

**Every "granted to no Role" sentence written into this domain's design documents and source comments
during August 2026 is now stale, and several were never true.** This lane re-verified each capability
it relies on, directly against `functions/src/access/permissionCatalog.ts` and the Role catalogs. A
sibling lane's independent census of the whole catalog — 147 capabilities across 48 Roles — found
**zero that are inert-and-ungranted**.

**The two conditions are different, and only one of them is a retirement.**

| Condition | What it means | Where it is decided |
|---|---|---|
| `active: false` | The capability is switched off. `resolveEffectivePermission.ts:264-265` (`inactivePermission`) denies **before any Role check**, so no grant can override it. Lifted per environment by `activationOverrides`. | `permissionCatalog.ts`, plus `access/environmentCapabilityOverrides.ts` |
| granted to no Role | Nobody holds it even where it is on. | `access/governedBusinessRoles.ts`, `access/compatibilityRoles.ts` |

### Re-verified for this lane

| Capability | `active:` | Granted? | Evidence |
|---|---|---|---|
| `inventory.catalog.manage` | **true** (no `active:` key) `permissionCatalog.ts:1071` | **yes**, 7 roles incl. `inventoryCatalogAdministrator` `governedBusinessRoles.ts:1065`, `warehouseManager` `:738` | writes **allow** for a granted principal wherever deployed |
| `inventory.catalog.activate` | **true** `:1077` | **yes** `:1065` | same |
| `inventory.stock.receive` | **true** (no `active:` key) `:1295` | **yes** — `inventoryReceivingClerk` `governedBusinessRoles.ts:1514`, plus admin+dispatcher via `compatibilityRoles.ts:88` | the receive path is gated by a **readiness constant**, not by capability |
| 14 × `reorder.*` | **all true** `:447-535` | **yes**, across 6 governed roles + compatibility `:58-72` | the domain's one fully-live write cluster |
| `inventory.balance.read` | **false** `:1221` | **yes — 14 grant sites** | the P-G3 "granted to nobody" claim is wrong |
| `inventory.serializedAsset.read` | **false** `:1269` | **yes — 12** | wrong |
| `inventory.catalog.read` | **false** `:1090` | **yes — 15** | wrong |
| `inventory.location.display.read` | **false** `:1498` | **yes — 1** (`inventoryLookupReader` `:1573`) | wrong |
| `inventory.location.bin.read` / `.manage` | **false** `:1190` / `:1182` | **yes** — `inventoryBinAdministrator` `:1268-1269`, `inventoryPutAwayOperator` `:1248`, `inventoryStockRelocationOperator` `:1298` | wrong; **and activated in `platform-sandbox`** (`config/environments.json:123-126`; `access/environmentCapabilityOverrides.ts:522-528`, eligibility `:198-204`) |
| `inventory.placement.record` | **false** `:1128` | **yes** — `inventoryPutAwayOperator` `:1249` | wrong |
| `inventory.stock.relocate` | **false** `:1157` | **yes** — `inventoryStockRelocationOperator` `:1301` | wrong |
| `inventory.transfer.*` (4) | **false** `:1309,1316,1323,1330` | **yes** — `inventoryTransferOperator` `:1153-1156`; `.receive` also `inventoryTransferReceiver` `:1318` | wrong |
| `inventory.cycleCount.create/submit/reconcile/cancel` | **false** `:1345,1352,1359,1366` | **yes** — `inventoryCycleCountCounter` `:1183-1185`, `inventoryCycleCountReconciler` `:1208` | wrong |
| `inventory.returns.intake` | **false** `:1108` | **yes** — `inventoryReturnsIntakeClerk` `:1337` | wrong |
| `inventory.serializedAsset.acquire` | **false** `:1282` | **yes** — `inventorySerializedAssetAcquirer` `:1546` | wrong |
| **`equipment.compatibility.view`** | **false** `:1385` | **NO** — `governedBusinessRoles.ts:1471`: *"THE FOUR COMPATIBILITY IDS ARE NOT INCLUDED"* | **the only capability in this domain where "ungranted" still holds** |
| **`inventory.warehouse.status.set`** | **NOT REGISTERED AT ALL** | n/a | `warehouseGovernance/warehouseStatusWriter.ts:24`, referenced by string only |
| **`inventory.cycleCount.close`** | **NOT REGISTERED AT ALL** | n/a | referenced at `eosOps/migration/inventoryWriterCapabilityCensus.ts:205` |

### Consequences for this archaeology

1. **No disposition in this document rests on "no Role holds it."** Every AUTHORITY GAP recorded here
   rests on one of three verified conditions: `active: false` with no environment override; the
   capability being **absent from the permission catalog entirely**; or the capability being **never
   requested from the client access feed**, which is a third and separate failure mode described
   below.
2. **Source comments repeating the stale claim should not be trusted.**
   `field-ops-app-vite/src/services/binCommandClient.js:4`,
   `src/services/stockMovementClient.js:4`, `src/hooks/useLocationDisplaySource.js:12`,
   `docs/implementation-plans/bin-location-authority-and-scanning.md:99`, and the five comment blocks
   in `functions/src/index.ts` reported by the sibling lane.
3. **A third failure mode, found by this lane, is worse than either.** A capability can be registered,
   active-able and granted, and still be permanently `false` on the client because
   `REPORT_CAPABILITY_REQUEST` never asks about it. `hasCapability` returns `true` only when
   `feed.decisions[id] === true` (`access/reportCapabilityAccess.js:139-149`), and the request set is
   `GOVERNED_SURFACE_CAPABILITY_IDS` (`access/governedSurfaceCapabilities.js:225-243`). Two capability
   ids this domain's screens check are **not in it**:
   * **`inventory.location.bin.manage`** — checked at `AdminWarehouseRacking.jsx:158`;
     `PLACEMENT_SURFACE_CAPABILITIES` carries only `placement.record` + `bin.read`
     (`governedSurfaceCapabilities.js:78-81`). **Every bin write control on that page is `Ungated` for
     every principal, in every environment, including a holder of `inventoryBinAdministrator`.**
   * **`inventory.stock.relocate`** — the gate for the **Move stock** scan workflow
     (`access/scanWorkflows.js:211`), whose only other mention is its Role grant. **The one scanner
     workflow that moves quantity can never be offered.**
   The same file already documents this exact class for Data Import
   (`governedSurfaceCapabilities.js:96-120`) and Administration→Users (`:179-200`), so it is a known
   failure mode that recurred twice more here undetected.

---

## Part 8 — The biggest original ideas that were never implemented

Ordered by the size of the gap between what was designed and what exists.

1. **The eight inventory AI recommenders.** `docs/specifications/enterprise-inventory-ai-strategy.md`
   designs a complete recommendation layer — §3.1 **parts prediction** (job → likely parts, from
   CONSUMED history joined to equipment model and job type), §3.2 **truck loading profiles** from
   per-truck consumption percentiles, §3.3 **replenishment** (per-part-per-location reorder points
   with supplier-specific lead times and volatility-scaled safety stock), §3.4 **warehouse
   optimisation** (velocity slotting, pick-path), §3.5 **purchasing** (order consolidation to hit
   MOQ/freight breaks, buy-timing, price-anomaly flags), §3.6 **stock balancing** (rebalance before
   buying), §3.7 **demand forecasting** (Croston-class intermittent demand — the pattern that actually
   dominates field-service spares), §3.8 **supplier scorecards**. Each with its Gen-1 heuristic, its
   Gen-2 successor, its output surface and its metric. Its governance is already written: *"Recommend,
   never execute"*, recommendations as governed objects carrying model id and version, *"abstain
   honestly"*, server-side authority, tenant-inert. It states it has **no schema demands of its own**
   (`:96-98`). **Nothing from it was built.** The only live intelligence in the domain is
   `EPIC3_LINEAR_V1` and `partsAttentionProjection`.
2. **The Wave-6 AI insertion points**, a separate and more concrete list
   (`docs/ai/memory-archive/project_parts_ux_redesign.md:24`): job blocker explanation, parts
   readiness summary, shortage prediction, reorder recommendation explanation, incoming-stock /
   truck-stocking / reallocation recommendations, abnormal consumption detection over
   `ExecutionCapture.jsx`'s `qtyUsed`, and next-best-action synthesis. **Analysis only, nothing
   implemented** — and its own analysis document, `parts-ux-redesign-blueprint.md`, was never
   committed.
3. **The Action Center.** A normalised, cross-EOS Attention Item model, designed after an explicit
   Owner/ChatGPT correction requiring the architecture *before* any implementation, to avoid a
   "frontend hook aggregator" anti-pattern. Key decisions already made: Attention Items are
   non-authoritative **projections** that never invent lifecycle, permission or severity;
   **SEEN ≠ RESOLVED**; every surfaced action invokes **the same governed command the source domain
   uses**. Four backend architectures compared; hybrid recommended. **Only the first bounded slice was
   built** (`domain/partsAttentionProjection.js` + re-pointing the notification bell).
4. **The Pick Ticket (template T3).**
   `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md:1528-1564` draws a full
   warehouse picking instruction — shelf/bin location, item serial location, UoM, qty ordered /
   shipped / backorder, per-line pick confirmation — from a real Taylor document (D4, order 239164).
   Its own governance note already anticipated the trap: a *Confirm Pick* either waits for the trusted
   write path or logs an audit note that explicitly does **not** move stock, and *"must not quietly
   invent a second stock authority"* (`:1556-1561`). Gap **G6** in the register. **Never built.**
   Nothing in this platform produces a pick list.
5. **Inventory ownership as a dimension separate from location** — gaps **G26/G27**
   (`:1726-1727`). One shared physical warehouse holds Taylor-owned parts, Taylor-owned equipment and
   **Ventana-owned ice machines side by side**, and the model *"has no owner dimension at all"*
   (`:978-982`). With it goes the **title-transfer event** (Ventana → Taylor at retail sale, priced
   and auditable). **Never built** — and this is the design root of the operating-company blindness
   measured in Part 9.
6. **Serialized unit reservation and the FIFO/best-cost allocation engine** — gaps **G48/G49**
   (`:1700-1701`). *"The moment a specific serial is chosen on an order, it must become unavailable to
   every other order"*; the ranking engine is a pure function computed on read, never persisted,
   non-binding, deviations recorded — explicitly matching the existing `dispatchScoring.js` idiom and
   named *"genuinely low-cost"*. **Never built.**
7. **Parts weighted-average costing** — gap **G50** (`:1702`), *"one `averageCost` per part,
   recomputed on each receipt"*, the standard answer to the fungible-goods problem the wireframe works
   through at `:752-800`. **Never built**, and it depends on an authoritative on-hand quantity.
8. **The warehouse-manager scoped access model.** `assignedWarehouseIds` with a fail-closed table
   where *"a missing field is never treated as 'all warehouses'"*, and three named capability ids
   (`warehouse.record.read`, `warehouse.stockLocation.read`, `warehouse.transferOrder.read`) plus a
   `ConditionKind: "assignedToWarehouse"`. **PLANNED-ONLY** since 2026-07-16 — and **partially
   overtaken**: `assignedWarehouseIds` went live in Rules, while the `stock_locations` arm was
   retired by BIN-P2R, which **inverted the very test that guarded it**.
9. **Returns disposition.** Returns intake is built and writes `inventory_returns` with exactly one
   state, `AWAITING_DISPOSITION`, **and no transition out of it** — *"the honest shape of a process
   whose second half is a business decision nobody has made"*
   (`inventory-scanner-program-state.md:977-985`). No disposition capability is registered, enforced
   by a catalog test. Two structural gaps must settle first: **a returned item has no location**, and
   **nothing records whose property it is**.
10. **Frame 1a of Parts North Star P1** — the only drawn frame in this domain that was never built and
    then superseded. And **six of nine drawn Parts P1 elements** never shipped as drawn.

---

## Part 9 — Design assumptions that are now obsolete

| Assumption, and where it was written | Why it is obsolete |
|---|---|
| **`warehouseQty` from `partsCatalog` is a usable stock baseline** — ADR-003's `available = warehouseQty − (grossReserved − released)` | ND-25 (2026-08-30) forbids any Parts surface presenting it as stock authority; `inventoryService.ts:12-16` records that as of DECISIONS #165 it *"NO LONGER PARTICIPATES IN ANY OPERATIONAL AVAILABILITY DECISION."* **Two client derivations still use it** — see below |
| **`stock_locations` is the bin-level balance** — Epic 4, the permission catalog's own description, and the Operations WarehousePanel | **Retired.** BIN-P2R measured it refusing real stock *and* promising imaginary stock (`PRT-1001` held 3 received units while the row said 0; `PRT-1005` said 40 with nothing ever received). 0 readers, 0 writers, 0 Rules allows. Tonight's Owner ruling retires it as an operational authority; **do not restore its index, and retire the stale list/metadata registration** |
| **A bin is descriptive; put-away must not move stock** — Decision #116 | **Amended** by ADR-014 / Decision #160: a bin is now an authoritative physical position, and the `WAREHOUSE` component becomes the **direct/unbinned** balance rather than the whole. Decision #170 then split put-away into two capabilities |
| **`recordPutAway` is a complete put-away** | Since BIN-P6 / #170, *"an operation that both moves stock and records where it went requires **both** capabilities, atomically"* |
| **"Capability inactive" and "authority required" are the same state** — the Parts P1 handoff labelled three switched-off reads *AUTHORITY REQUIRED* | §16 of the directive: two different states, two different sentences, two different owners. *"Calling an inactive capability a missing authority tells the Owner that something must be designed and built when in fact something must be activated"* |
| **"granted to no Role"** — the entire August 2026 vocabulary | See Part 7. Stale for every capability in this domain except `equipment.compatibility.view` |
| **`RCV-G1`: "no client or callable read of `receiving_orders` exists anywhere in the repo"** | Four functions read it and one is client-reachable. The gap's substance survives in corrected form; **the metadata register still states the false version at `metadata/definitions/receivingOrder.js:18-20`, and it is the stated justification for `readVia: UNKNOWN`** |
| **`SCAN_WORKFLOW` holds seven workflows** (`inventory-scanner-program-state.md:1116`) | It holds **nine** (`access/scanWorkflows.js:26-37`). `MOVE_STOCK` and `relocateStock` — the one scanner surface that writes ledger rows — are **undocumented in the entire scanner programme doc set** |
| **Offline: only put-away is adopted** (`inventory-scanner-program-state.md:1211-1218`) | Superseded by WO-05A: **all eight** intents are UI-integrated (`warehouse-parts-offline-runtime.md:6-10`). The §5 backlog table in the state doc was never updated and still lists put-away as unbuilt |
| **`/inventory` is a collection page** — implied by frames 1a | Owner ruling 2026-08-27 and Lists P2 §1.1: `/inventory` **stays a workspace**; Part Master at `/inventory/part-master` is the Parts collection. `LISTS-P2-COLLECTION-DISPOSITION.md:834` marks `LISTS-VIEW-CHIP-ROLLOUT` §4.2 obsolete on exactly this point |
| **The Parts Scanner can receive a purchase order** | Four user-guide entries claimed it; **it cannot** (`docs/governance/parts-scanner-access-decision.md:140-150`) |
| **Warehouse creation is a product action** | There is no registered warehouse write capability and the writer is unexported. Every warehouse came from a seed or an operator CLI |

### The three client availability derivations — verified, and worse than the brief stated

There are **two distinct implementations** and **three live client call sites**.

**Implementation 1 — `computeAvailableStockByPart`,
`field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts:273-291`.** The formula is **not**
`warehouseQty − (RESERVED − RELEASED)`; it is

```
warehouseQty + governedDelta − (reserved − released)      // :288
const warehouseQty = getCatalogItem(partId)?.warehouseQty ?? 0;   // :287
```

with `governedDelta` summing `RECEIVED`/`TRANSFER_IN` as `+`, `TRANSFER_OUT` as `−`, `ADJUSTED` as
`+` (`:279-281`). So it **adds the static-catalogue baseline on top of ledger movements**, and it
handles only four of the nine physical movement types — **`RETURNED`, `SCRAPPED`, `RELOCATION_IN`,
`RELOCATION_OUT` and `WORK_ORDER_CONSUMPTION` are all missing**
(`inventoryLedger/operationalMovementTypes.ts:18-42`).

**It is location-blind by its own docblock** (`:267-268`): *"Summed across ALL locations, which is
what a Part-level 'available' figure means."* No location filter, no warehouse-eligibility set, no
bin parentage — **truck/MOBILE stock reads as available**. The server does not do this:
`inventoryService.ts:113-114` and `fulfillment/fulfillmentAvailability.ts:88-118` both fence on
`status == "ACTIVE"` warehouses, and `fulfillmentAvailability.ts:64` explicitly excludes MOBILE.

Two live call sites — `src/hooks/useInventoryLedger.js:29` (consumed by `PartsList.jsx:384`,
`PartDetail.jsx:1334`, `WarehouseManagerHome.jsx:138`, `PartsManagerHome.jsx:61`) and
`src/modules/operations/Operations.jsx:119` (the Inventory Health panel). Rendered at
`modules/operations/panels/InventoryHealthPanel.jsx:111`, `modules/inventory/PartDetail.jsx:1642`,
`modules/inventoryRole/WarehouseManagerHome.jsx:367`.

**Implementation 2 — `deriveLedgerOverlay`,
`field-ops-app-vite/src/domain/partsShadowParity.js:63-81`.** This one **is** exactly
`(warehouseQty ?? 0) − (reserved − released)` (`:78`), also location-blind, also baselined on the
hardcoded catalogue (`:64`). Third live call site:
`modules/inventory/partsShadowParityReaders.js:14` → `PartsShadowParityDiagnostics.jsx:13-15`. Its own
header calls it *"Non-authoritative diagnostic"* (`:4`).

`src/domain/partsCompatibilityAdapter.js:156` passes an injected overlay through and is **not** a
fourth derivation.

### `partsCatalog` — verified

`field-ops-app-vite/src/data/partsCatalog.ts:31` exports `PARTS_CATALOG`, ending `:234`. **Exactly 200
SKUs** — corroborated by `metadata/administration/profiles/part.js:368`, *"src/data/partsCatalog.ts
(200 hardcoded SKUs)"*. Header `:1-19`: *"generated from a synthetic test dataset … NOT
Firestore-backed, NOT authoritative … METADATA ONLY — NO STOCK AUTHORITY."* Server mirror at
`functions/src/data/partsCatalog.ts`.

**Six client paths still read it:** `modules/inventory/PartsList.jsx:3` ·
`modules/inventory/PartDetail.jsx:3` · `modules/inventoryRole/WarehouseManagerHome.jsx:2` (renders
`part.warehouseQty` as the "(baseline)" Available value at `:367`) · `hooks/useCanonicalPartNames.js:3`
· `modules/inventory/partsShadowParityReaders.js:14` · `domain/inventoryAnalyticsEngine.ts:15`
(**the availability baseline itself, at `:287`**).

The repository already records the governance position at
`metadata/administration/profiles/part.js:382` — *"It is the ONLY warehouseQty baseline the
availability math has, and its SKUs are not canonical."* **The claim that ten of its SKUs have no
canonical Part record is UNPROVEN in this lane** — establishing it requires reading the `parts`
collection in a live environment, which is prohibited here.

---

## Part 10 — Operating company: allocation is blind, and it was designed not to be

**Verified.** The eligibility set in every allocation path is built with no operating-company
predicate:

```
functions/src/inventoryService.ts:113    .collection(WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE")
functions/src/inventoryService.ts:114    const eligibleWarehouseIds = new Set(whSnap.docs.map((d) => d.id));
functions/src/fulfillment/allocateSalesOrder.ts:122  const eligibleWarehouseIds = new Set(whSnap.docs.map((d) => d.id));
```

`grep -n operatingCompany` over `allocateSalesOrder.ts`, `inventoryService.ts`,
`partBalanceReadService.ts` and `inventoryAnalyticsCallables.ts` returns **zero hits**. The only fence
is warehouse status, plus bin parentage (`inventoryService.ts:120`).

**The model exists — on the side that is not in the path.**
`functions/src/eosOps/operatingCompanyCustody.ts:47` declares `OperatingCompanyKey`;
`functions/src/eosOps/warehouseBinRepository.ts:29-33` **requires** the governed key on
`createWarehouse` and states *"A Warehouse IS the company boundary root"* — and that module is
**inert and unwired** (`:10-13`). Firestore `warehouses.operatingCompanyId` is **optional**:
`eosOps/migration/warehouseBinMigrationSource.ts:20-26` — *"a warehouse without it is a VALID LEGACY
GOVERNED WAREHOUSE."*

So the boundary is **declared in the ownership/Postgres layer and not enforced in the live Firestore
allocation path**. A Ventana order can be promised against Taylor stock, and the wireframe predicted
exactly this in 2026-07: *"Inventory ownership is a separate dimension from inventory location … the
current model has no owner dimension"* (G26,
`inventory-sales-templates-and-lines-of-business-wireframe.md:978-982`, `:1726`).

---

## Part 11 — Screens rendering over inert capabilities

The lane brief's headline restated precisely, with the failure mode named per row.

| Route / control | Failure mode | Evidence |
|---|---|---|
| `/administration/warehouse-racking` — Create, Rename, Activate, Deactivate, Apply | **Capability never requested from the access feed.** `inventory.location.bin.manage` is absent from `GOVERNED_SURFACE_CAPABILITY_IDS`, so `hasCapability` is `false` for everyone forever, including `inventoryBinAdministrator` | `AdminWarehouseRacking.jsx:42`,`:158`,`:323`; `governedSurfaceCapabilities.js:78-81`,`:225-243`; `reportCapabilityAccess.js:30-37`,`:139-149` |
| Scan → **Move stock** | Same. `inventory.stock.relocate` is absent from the request set — the only quantity-moving scanner workflow can never be offered | `access/scanWorkflows.js:91`,`:211`; `governedBusinessRoles.ts:1307` |
| `/inventory/transfers` — New transfer / Dispatch / Cancel / Receive | Four live, undisabled buttons over four `active: false` capabilities; the page explains in prose instead of in the control state | `Transfers.jsx:111-115`,`:151-155`,`:277`,`:280`,`:286`; `permissionCatalog.ts:1309-1330` |
| `/inventory/receiving` + both journeys + multi-scan | **Readiness constant**, not capability. `RECEIVING_TRANSPORT_READY` is true only for `platform-sandbox`; elsewhere the transport makes **zero callable attempts** | `config/receivingReadiness.js:27`; `config/environments.json:47,78,213,242,274` |
| `/inventory` New Part · `/inventory/:partId` Edit/Change Status · `/inventory/part-master` all writes | **Readiness constant.** `PART_MASTER_WRITE_READY` sandbox-only — while the capability is ACTIVE and granted | `config/partMasterWriteReadiness.js:16`; `config/environments.json:54,85,220,249,281`; `PartMasterList.jsx:305`,`:328` |
| `/inventory/manufacturers` | `inventory.catalog.read` is `active: false`, and the read is Rules-closed to every persona. Reachable only by URL | `permissionCatalog.ts:1090`; `navConfig.js:341-346`; `Manufacturers.jsx:87`,`:221` |
| `/inventory/truck-inventory` — Add truck, Manage, and a hard-coded `Confirm (not available)` | Readiness constants false in certification and production; `TRUCK_DEACTIVATE_READY` / `TRUCK_DELETE_READY` **false everywhere** | `TruckInventory.jsx:153`,`:214-217`; `hooks/useTruckManagement.js:41-42`; `config/environments.json:51,82,217,246,278` |
| `/inventory/warehouse-workspace` | Route declares `capabilityAccess` with no `legacyKey`, so `navConfig.js:683` **fails closed** — plain admin/dispatcher cannot reach the handheld at all | `navConfig.js:352`,`:683`; `governedSurfaceCapabilities.js:150-165` |
| `/inventory/cycle-counts` — every action | All four capabilities `active: false`; `inventory.cycleCount.close` is **not in the catalog at all** | `permissionCatalog.ts:1345-1366`; `eosOps/migration/inventoryWriterCapabilityCensus.ts:205` |
| Part record — *Where it is*, *Serialized units*, *Available/On order*, *Used on* | Four `active: false` reads. The record renders **stated absence** rather than empty tables — the correct treatment, and still four dead sections | `permissionCatalog.ts:1221`,`:1269`,`:1498`,`:1385` |
| `/purchasing/quotes`, `/purchasing/demand-planning`, `/inventory/back-orders` | Reachable URLs rendering *"This area isn't built yet"*. No object, no read, no owner | `navConfig.js:433`,`:435`,`:375`; `App.jsx:829` |
| Multi-scan receiving | Deliberately **granted to no warehouse persona** at sandbox validation time | `docs/releases/scanner-sandbox-validation-2026-08-21.md:36,54-56,124-125` |
| Returns intake | The inverse: a **built, granted backend command with no screen at all** | `docs/releases/scanner-sandbox-validation-2026-08-21.md:133-134` |

### Orphaned components — files that exist and no route reaches

| File | Evidence |
|---|---|
| `field-ops-app-vite/src/modules/inventory/Inventory.jsx` | Imported into `LEGACY_COMPONENTS.inventory` (`App.jsx:201`), but every nav item carrying `legacyKey: "inventory"` has an explicit branch **before** the fallthrough (`App.jsx:550`,`:734`,`:743`; fallthrough `:825-828`) ⇒ **never rendered.** It is the demo/in-memory screen with `On Hand` quantities that `IMPLEMENTATION-DELTA-PARTS-P1v2.md:169` also flags |
| `src/modules/inventory/mobile/MobileInventorySections.jsx` + `PartsStockSection` · `SerializedAssetsSection` · `ReservationsSection` · `ReconciliationSection` · `ActivitySection` | Header states it: *"has NO production caller and no route wiring in this slice"* (`MobileInventorySections.jsx:6`). Lists P2 counts these as EXEMPT #56 |
| `src/modules/inventory/truckManagement/TruckManagementPreview.jsx` + `mockTruckCommandClient.js` | Test-only harness (`test/truckManagementView.test.jsx:16`) |

---

## Part 12 — Missing-workflow discoveries

Workflows an operator would reasonably expect, which this archaeology found do not exist anywhere —
not as a disabled control, not as a gap document, not as a command.

1. **Nothing produces a pick list.** Template T3 was drawn from a real Taylor pick ticket; gap **G6**;
   never built. `PickScan` stages against a Work Order's existing `inventorySnapshot` and **reserves
   nothing** — *"picked stock stays available to other jobs"*
   (`inventory-scanner-program-state.md:784-787`).
2. **No governed command closes a short receipt line.** The Receiving canvas states it as a fact:
   *"no control here can close a line short, because no governed command exists to do it."* A line
   short stays open and the order stays `SENT`, indefinitely.
3. **Returns have no second half.** `AWAITING_DISPOSITION` has no transition out of it, no disposition
   capability is registered, and **no scan tile exists** even for intake. Two structural gaps block
   the design: a returned item has no location, and nothing records whose property it is.
4. **`RETURNED` is a schema-legal movement type with no writer anywhere in the platform** — and that
   is deliberate: writing one at intake *would be* the automatic restock Decision #118 forbids
   (`inventory-scanner-program-state.md:961-972`).
5. **Consumed stock never leaves physical on-hand.** `inventoryService.ts`'s own docblock names it:
   *"NOTHING REMOVES CONSUMED STOCK FROM PHYSICAL ON-HAND … a REAL PRE-EXISTING OVER-AVAILABILITY
   DEFECT"*, proven in `inventoryConsumptionOnHandGap.test.mjs` and deliberately not fixed because the
   fix is an inventory-semantics ruling
   (`docs/design/eos-operational-data-plane-inventory-authority-cutover.md:105-108`).
6. **Availability is double-counted during a known window.** A WO's `RESERVED` commitment opens in
   full at `DISPATCHED` and stays open until `COMPLETED`, while the technician's truck-level
   `WORK_ORDER_CONSUMPTION` already removed the units from eligible on-hand — so the same units are
   excluded **twice**. It is an under-count (stricter, never an over-promise), self-correcting at
   completion, and recorded rather than fixed (`:131-147`).
7. **No governed way to create or activate a warehouse.** See Part 4, R5.
8. **A purchase order has no business number.** RCV-G5. Nothing prints, encodes or resolves a
   scannable order label, so RCV-G7 (scan-first receiving entry) cannot be built.
9. **Reorder-request numbering is declared, its allocator is built, and it is UNWIRED**
   (`north-star-migration-ledger.md:1828`).
10. **Eight of ten reorder transitions are client-direct Firestore writes.** The trusted boundary is
    designed in full (`docs/specifications/reorder-trusted-command-authority.md`) and explicitly
    **not authorised**.
11. **No serialized install or remove command exists.** ADR-010 specified it; no button is offered and
    a test enforces the absence (`inventory-scanner-program-state.md:947-957`).
12. **Van stock is invisible to the part balance read** — correct by design, but the balance screen
    cannot answer *"does my technician already have one?"* (`:1189-1191`).
13. **A technician cannot accept a truck handoff without over-granting** — resolved by creating
    `inventoryTransferReceiver` (`governedBusinessRoles.ts:1318`), but the design record still
    describes it as open in three places.
14. **Three parallel on-hand implementations** remain inside the transfer, cycle-count and fulfillment
    transactions — behaviourally identical, each emulator-tested; convergence is a recorded follow-up
    (`inventory-scanner-program-state.md:424-429`, `:1236-1238`).
15. **`inventory_actions` still has an orphaned `allow create: if isAdminOrDispatcher()`** with no
    field validation and an unbound `createdBy`, after the product surface was retired. *"It is now
    the only remaining way to create a new document"*
    (`parts-north-star-composition-map.md:731-736`).

---

## Part 13 — `stock_locations`: the Owner ruling, and what it requires

Tonight's Owner ruling retires `stock_locations` as an operational authority. The repository has
already done most of the work and the archaeology confirms the rest.

* **ADR-014 already classified it**: *"`stock_locations` … and the Epic 4 `StockLocation` /
  bin-transfer model are **legacy competing concepts and must never become the new authority.**
  Nothing writes `stock_locations`; it was superseded by the ledger on 2026-08-17 after measured
  divergence in both directions."* (`ADR-014` *Legacy authority retirement*).
* **BIN-P2R executed the retirement**: the `fetchStockLocations` reader, the WarehousePanel bin-stock
  table, the Reconciliation section and `domain/warehouseReconciliationEngine.ts` are gone; backend
  readers 0, client readers 0, writers 0, `match /stock_locations/` in either Rules copy 0
  (`docs/assessments/bin-p2-legacy-inventory-authority-retirement.md:186-189`). Residual data is
  **not deleted** — 5 sandbox, 4 production documents, inert (`:215`).
* **The measured reason, worth preserving**: the row *"can both refuse real stock and promise
  imaginary stock"* — `PRT-1001` held 3 received units while the row said 0; `PRT-1005` said 40 with
  nothing ever received (`:22`).
* **The anti-pattern its successor test forbids**: *"Do not feed that engine an empty array as a
  shortcut… the panel would render 'No discrepancies' — a clean result for a check that never ran"*
  (`:124`). `stockLocationSurfaceRetired.test.jsx` makes the false-clean **unreachable by shape**
  (`:180`).

**What is still outstanding, and is this ruling's actual work:**

1. **The list/metadata registration is stale.** `field-ops-app-vite/src/metadata/definitions/stockLocation.js:73`
   still declares the entity over collection `stock_locations` (`:76`), and it is one of the 29
   entities in `metadata/entityRegistry.js:56`. **Retire the registration.**
2. **Two registered capabilities still describe it as authoritative**: `warehouse.stockLocation.read`
   (`permissionCatalog.ts:596`, **active**, granted to `operationsManager`
   `governedBusinessRoles.ts:574`) and, historically, the permission catalog's bin-level-quantity
   description ADR-014 flags at *Legacy authority retirement*.
3. **Do not restore the index.**
4. **The warehouse-manager scoped-access design still has a `stock_locations` arm** that must be
   struck from `docs/assessments/warehouse-manager-scoped-access.md` and
   `docs/specifications/warehouse-manager-scoped-access.md` before anyone implements from them —
   BIN-P2R already **inverted the test that guarded it**
   (`bin-p2-legacy-inventory-authority-retirement.md:211`).

**DISPOSITION — REMOVE.** Registration, capability description and design-doc arms. The runtime work
is already done.

---

## Part 14 — Disposition summary

`KEEP` means the surface is right as it stands. A surface that renders well over authority nobody can
exercise is never `KEEP` alone.

| # | Route / surface | Disposition |
|---|---|---|
| R1 | `/inventory` Parts workspace | **IMPROVE** + **AUTHORITY GAP** (no quantity authority reachable) |
| R2 | `/inventory/:partId` Part record | **KEEP** + **AUTHORITY GAP** (4 inactive reads) + **PRODUCT GAP** (ledger has no actor) |
| R3 | `/inventory/part-master` | **WORKFLOW GAP** (writes inert outside one environment; route demoted) |
| R4 | `/inventory/manufacturers` | **AUTHORITY GAP** (`inventory.catalog.read` inactive; Rules-closed to all) |
| R5 | `/inventory/warehouses` | **KEEP** + **AUTHORITY GAP** (no governed warehouse write path exists) |
| R6 | `/inventory/warehouse-workspace` | **KEEP** + **WORKFLOW GAP** (nav fails closed for admin/dispatcher) |
| R7 | `/administration/warehouse-racking` | **WORKFLOW GAP** (capability never requested) + **AUTHORITY GAP** (bin caps inactive in production) |
| R8 | `/inventory/transfers` | **IMPROVE** + **WORKFLOW GAP** (live buttons over inactive capabilities) |
| R9 | `/inventory/truck-inventory` | **WORKFLOW GAP** (readiness false in production; a permanently-inert control) |
| R10 | `/inventory/cycle-counts` | **KEEP** + **AUTHORITY GAP** (`inventory.cycleCount.close` unregistered; four inactive) |
| R11 | `/inventory/receiving` | **KEEP** + **WORKFLOW GAP** (readiness constant) |
| R11a | Supplier multi-scan | **KEEP** + **WORKFLOW GAP** |
| R11b | Reorder PO journey | **KEEP** + **WORKFLOW GAP** + **PRODUCT GAP** (no partial receipt) |
| R11c | Add existing unit | **KEEP** |
| R12 | `/purchasing` Purchase Orders | **IMPROVE** + **PRODUCT GAP** (no PO business number; designed list never built for the read collection) |
| R13 | `/purchasing/suppliers` | **KEEP** + **WORKFLOW GAP** (associate PO path still free-text supplier) |
| R14 | `/purchasing/receipts` | **REPLACE** (fold into PO as a saved view) + **AUTHORITY GAP** (RCV-G1) |
| R15 | `/purchasing/quotes` | **REMOVE** or **ADD** |
| R16 | `/purchasing/demand-planning` | **REMOVE** or **ADD** |
| R17 | `/inventory/back-orders` | **REMOVE** or **ADD** |
| R18 | `/inventory-role/manager` | **KEEP** + **AUTHORITY GAP** (client-direct transitions) |
| R19 | `/inventory-role/warehouse` | **KEEP** + **AUTHORITY GAP** (same; and it renders the static-baseline Available at `:367`) |
| R20 | `/inventory-role/mine` | **KEEP** + **AUTHORITY GAP** (same) |
| R21 | `/service/scan` shell | **KEEP** |
| R21a | Look up | **KEEP** |
| R21b | Put away | **KEEP** + **AUTHORITY GAP** |
| R21c | Pick / stage | **KEEP** + **PRODUCT GAP** (reserves nothing) |
| R21d | **Move stock** | **WORKFLOW GAP** (capability never requested) |
| R21e | Cycle count scan | **KEEP** + **AUTHORITY GAP** |
| R21f | Transfer / truck handoff | **KEEP** |
| R21g | Return intake | **PRODUCT GAP** (no tile; no disposition half) |
| R21h | Supplier receive | **KEEP** + **WORKFLOW GAP** |
| R22 | Technician Parts Scanner | **IMPROVE** + **PRODUCT GAP** (identity, undo, running total — F2) |
| R23 | Warehouse Sync Queue / offline runtime | **KEEP** |
| R24 | `/admin/diagnostics/inventory-parts-parity` | **KEEP** — read-only, self-gated, no writes; but it is the third live consumer of the static-catalogue availability derivation |
| R25 | Returns register | **PRODUCT GAP** — does not exist; Lists P2 **BLOCKED 5.4**, *"building one would imply stock effects the authority refuses"* |
| — | `stock_locations` registration + capability description | **REMOVE** (Part 13) |
| — | `Inventory.jsx` and the six orphaned mobile sections | **REMOVE** |
| — | The eight AI recommenders | **ADD** (Part 8) |
| — | Pick Ticket / G6 | **ADD** |
| — | Inventory ownership dimension / G26-G27 | **ADD** — the design root of the operating-company blindness |
| — | Serialized reservation + allocation engine / G48-G49 | **ADD** |

### Counts

| Disposition | Count |
|---|---|
| **KEEP** (alone or with a qualifier) | 18 |
| **IMPROVE** | 4 |
| **REPLACE** | 1 |
| **REMOVE** | 5 (3 placeholder routes + the `stock_locations` registration + the orphan components) |
| **ADD** | 5 |
| **PRODUCT GAP** | 8 |
| **WORKFLOW GAP** | 11 |
| **AUTHORITY GAP** | 11 |
| **UNKNOWN** | 0 |

**Routes covered: 25 named routes/surfaces plus 9 scan workflows, 4 mounted receiving workflows, 3
role homes and 9 orphaned components.**

---

## Part 15 — UNPROVEN register

Everything this lane could not establish from the worktree alone.

| Claim | Why unproven |
|---|---|
| **Current bin count in sandbox.** The censuses that measured 0 bins / 0 placements are dated 2026-09-02/09-03 (`bin-stable-identity-and-racking-structure.md:471-472`; `bin-p1-sandbox-fixture-disposition.md:143-146`). `docs/releases/bin-sandbox-release-2026-09-10.md:37` records PR #1846 — *"Scanner runner creates bins through the BIN-P1 contract"* — and `:486` of the identity spec warns *"nothing prevents a future scenario run from repopulating sandbox."* **No document states the current count** and no environment was contacted. The lane brief's "sandbox has zero bins" should be treated as a dated measurement, not a current fact |
| **Ten `partsCatalog` SKUs having no canonical Part record.** Establishing it requires reading the `parts` collection live |
| **Whether production holds `inventory_actions` records, and whether reporting or compliance depends on them.** The Owner reserved this; it needs a production read |
| **Deployed Functions manifest.** Client-side callable names and readiness constants were verified; whether `createBin`, `relocateStock`, `createTransferOrder` etc. are deployed in any given environment was not |
| **Whether any `inventoryPutAwayOperator` / `inventoryBinAdministrator` / `inventoryStockRelocationOperator` / `inventoryLookupReader` role assignment actually exists in a live environment.** Declarations were read; assignment data is runtime |
| **Authorization for `procurementService.ts:59,85`** (`createPurchaseOrder` / `updatePurchaseOrderStatus`) — no capability check was found inside the file; a caller may enforce it |
| **The writer of `inventory_actions`** — appears client-direct under `firestore.rules:1154`; not traced to a command |
| **Whether the 200-SKU count matches between `field-ops-app-vite/src/data/partsCatalog.ts` and the server mirror `functions/src/data/partsCatalog.ts`** — only the client copy was counted |
| **How a BIN endpoint renders on `/inventory/transfers`.** BIN-P6 widened `TRANSFER_ENDPOINT_TYPES` to `WAREHOUSE \| BIN \| MOBILE`; the user guide still describes only warehouse and mobile |
| **Whether the serial case-folding asymmetry is deliberate** — serials are case-significant in matching but case-insensitive in three duplicate checks. No document addresses it |
| **Whether `inventory.cycleCount.*` is activated in any current target environment** — `navConfig.js:369-373` asserts it in a code comment; `capabilityActivationOverrides` was not cross-checked per environment |
| **The runtime cause of the Parts `Inventory` H1 defect** — `IMPLEMENTATION-DELTA-PARTS-P1v2.md:158-174` states it was **not reproducible from source** and had to be diagnosed against the live build. Whether it was ever diagnosed is not recorded |
| **Whether frame 1c of Receiving's offline idempotency behaves as designed at runtime** — asserted by design and by test, not exercised here |
| **"Wave 1" as a repository term.** The scanner case-collision fix (`e37366f5`, 2026-09-11) is verified and is an ancestor of `d104cf49`; no document in this repository names a Wave 1 for scanner work |

---

## Part 16 — Scenario and operational questions for the Owner

1. **Can anyone rack a warehouse today?** No — `inventory.location.bin.manage` is never asked about,
   so every control on the racking page is `Ungated` for every principal. Is that intended, and is the
   fix a one-line addition to `PLACEMENT_SURFACE_CAPABILITIES`?
2. **Who creates a warehouse?** There is no registered write capability and the writer is unexported.
   Is the operator CLI the intended permanent answer?
3. **Should `/inventory` be able to answer "do we have any?" at all?** ND-25 removed the quantity
   column; `getPartBalance` is built and inactive; `PART_LIST_BALANCE_N1_GAP` blocks a list column
   independently. ND-28-F is the open follow-up.
4. **A Ventana order is promised against Taylor stock.** Is operating-company-blind allocation
   acceptable until G26/G27 land, and if not, what is the interim fence?
5. **Two client derivations still add the static catalogue on top of ledger movements, miss five of
   nine movement types, and count truck stock as available.** The three surfaces that render them are
   the Inventory Health panel, the Part record's stock forecast, and the Warehouse Manager home. Which
   of the three, if any, may keep doing so?
6. **A short delivery arrives.** No governed command closes a short line. What should the operator do,
   and what does the order status mean in the meantime?
7. **A part comes back from a job.** Intake writes a return with one state and no exit, and there is
   no tile to record it from. Who decides the disposition half?
8. **Eight of ten reorder transitions are client-authoritative.** The trusted boundary is fully
   designed. Is it authorised?
9. **Three placeholder routes are reachable by URL and say "not built yet."** Remove the routes, or
   commit to the objects?
10. **`/purchasing/receipts` was designed to be a saved view of Purchase Orders, and shipped as a
    second list.** Fold it, or keep two lists over one projection?
11. **The accepted visual authority for the shipped Parts pages does not exist in this repository.**
    Should `DESIGN-HANDOFF-PARTS-P1v2.md` and its four frames be re-obtained and committed, so a
    future reader can see what was accepted?

    **ANSWERED IN PART 2026-09-13 — they have been re-obtained.** All five files were recovered from
    `Parts North Star P1v2.zip` and committed as **historical evidence** at
    `docs/design-history/recovered/Parts/Parts-North-Star-P1v2/`, so a future reader *can* now see what
    was accepted. **They were deliberately NOT committed as current authority.** Whether they should be
    promoted to repo-resident *design authority* under `docs/north-star/parts/` is the Owner question
    this item raised, and it remains open. **RECOVERED HISTORICAL DESIGN EVIDENCE** — **not** current
    North Star, **not** current implementation authority, **not** permission to redesign, **not proof
    that current EOS still conforms.**
12. **Nothing in this platform produces a pick list**, and the design for one has existed since
    2026-07. Is that a gap or a decision?

---

## Provenance of this document

Produced by lane **P3-A2** against the integrated Wave-1 head `d104cf49`, in worktree
`/home/rudy2/.local/share/eos-worktrees/p3a2-arch-inventory` on branch
`night/p3a2-archaeology-inventory`.

**This lane changed no runtime code, no configuration, no test, no capability, no Rules file and no
design artifact. It added exactly one file — this one — and pushed nothing.** Recovered historical
artifacts were read with `git show` into a scratch directory and were **not restored into the tree**;
the three recoverable ones are named with their commit SHAs in §0.3 so any future lane can recover
them the same way.
