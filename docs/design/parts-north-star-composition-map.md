# Parts North Star P1 — composition map

The reconciliation between the design artifact
([`docs/north-star/parts/North Star - Parts P1.dc.html`](../north-star/parts/North%20Star%20-%20Parts%20P1.dc.html)),
the Parts surfaces as they stand, and the governed behavioral truth underneath them. Produced
**before any UI code changed**, per the North Star execution rule.

**Design authority:** the artifact above, frames 1a–1d, plus
[`DESIGN-HANDOFF-PARTS-P1.md`](../north-star/parts/DESIGN-HANDOFF-PARTS-P1.md) in the same folder.
**Behavioral authority:** `src/domain/partDetailView.js`, `partsCatalogView.js`,
`partsCompatibilityAdapter.js`, `partMasterView.js`, `partVocabulary.js`, `partTrackingMode.js`,
`partLookup.js`, `inventoryLedgerEvent.js`, `truckInventoryView.js`, `partsAttentionProjection.js`,
`inventoryAnalyticsEngine.ts`; `src/metadata/definitions/part.js`; the three readiness gates in
`src/config/`; `functions/src/partMaster/` and `functions/src/inventory/partBalance*`.
**Where they conflicted, behavioral truth won.** Each conflict is a ruling below, not a silent
resolution.

## The one thing to read first

**The design's central number does not exist, and the repository already knows it.**

Frame 1a puts **On hand** in the workspace table and frame 1b puts *"3 on hand across 2 locations"* in
the record header, sourced — the handoff says so explicitly — from `warehouseQty`, whose provenance is
`STATIC_FALLBACK`. That value comes from `src/data/partsCatalog.ts`, a file whose own header reads
**"METADATA ONLY — NO STOCK AUTHORITY … generated from a synthetic test dataset … NOT authoritative."**

This exact cell has already been wrong twice, in the same direction, and the Owner ruled on it on
**2026-08-24**. The ruling is preserved verbatim in `PartsList.jsx` above the cell it governs:

> The static catalogue proves a Part EXISTS. It does not prove we physically have N of it. A figure
> that is not a live warehouse count, sitting under a heading that reads as one, is FALSE_COMFORT on
> the exact column people scan when deciding what to reorder.

So the shipped list answers **"Not known"** where no ledger has spoken, and the design asks for a
number in that space. A migration that reproduced the mockup would re-introduce, as the centrepiece of
the North Star, the defect the Owner removed six days earlier — and would do it while carrying a
handoff whose first non-negotiable rule is *"never manufacture inventory mathematics."*

**Second, and structural: three of the four data sections in frame 1b read through capabilities that
are registered `active: false` and granted to no role.** Balances, serialized units and location
display are all built, all governed, and all switched off in every environment. The handoff labels
their absence **AUTHORITY REQUIRED**. That is the wrong label, and §16 of the directive is the reason
it matters: *capability unavailable* and *authority required* are two different states with two
different sentences and two different owners. Calling an inactive capability a missing authority
tells the Owner that something must be designed and built when in fact something must be activated.

Fifteen drawn elements were checked against the function that would have to supply them. Nine could
not be rendered as drawn. Three of those need an Owner ruling before any component is written.

## Verdict — two surfaces, one grammar, and the record moves first

Parts stays where it is: the workspace at `/inventory` (`PartsList.jsx`) and the record at
`/inventory/:sku` (`PartDetail.jsx`). Both are recomposed into the North Star grammar — kicker, rule
pair, serif title, restrained action cluster, main/rail split — and neither gains a read, a command,
a capability or a Rules change.

The record moves first. It is where the honest states live, where the three inactive capabilities have
to say so out loud, and where the identity defects below actually bite. The workspace follows, because
what its quantity column may say depends on **ND-25**.

## Item-by-item: does the drawn element fall within functionality?

### Buildable as drawn, no new read

| Drawn | Source | Note |
|---|---|---|
| Status / Control / Stocking / Unit / OEM as words | `partVocabulary.js` label maps | Sourced from the values they label, not a second copy |
| Kicker `Part · {control} · {stocking}` | adapter `controlType` / `stockingClass` fields | Carried by the adapter; `buildPartDetailView` must stop dropping them (P-N12) |
| Description as the serif subtitle | `toPartView().description` | Present on the projection; not yet carried through the adapter (P-N12) |
| Blocked / not-found states, four distinct sentences | `partDetailBlockedMessage` + `PART_DETAIL_STATES` | Already correct. The design's frame 1d matches the domain exactly |
| Identifiers section, inactive-alias treatment, five probe outcomes | `partIdentifiers.js` + `PartIdentifiersSection.jsx` | Already shipped, already honest — see P-N10 |
| Open demand, "planned demand, not a reservation" | `partWorkOrderDemand.js` + `PartWorkOrderDemandSection.jsx` | Already shipped |
| Used on | `partsCompatibilityAdapter` / `UsedInEquipmentSection.jsx` | Reference data, unchanged |
| Attention chip and count | `partsAttentionProjection.js` over `reorder_requests` | ACTION_ITEM / NOTIFICATION only — the projection carries no severity, deliberately |
| Scan entry point | `partLookup.js` (`LookupScan`) | Identification only; it has no command, no quantity input and no writer |
| Verenward tokens, Source Serif 4, Inter | `src/index.css` | Present and self-hosted |

### Not buildable as drawn — the nine rulings

| # | Drawn | Why it could not ship | Ruling |
|---|---|---|---|
| **P-N1** | **On hand**, as a workspace column and a header fact | `warehouseQty` is `STATIC_FALLBACK` from a file that declares itself non-authoritative. Owner ruling 2026-08-24 already removed it from this exact cell as FALSE_COMFORT. | **Blocked on ND-25.** No number is rendered under a quantity heading until the Owner rules. |
| **P-N2** | **Available** marked *AUTHORITY REQUIRED* | It exists. `getPartBalance` returns `available` (onHand − reserved, ACTIVE warehouses, excluding truck stock) and is the ratified composition of fulfillment's own functions. It is `active: false`, granted to nobody, and not deployed. | Not "authority required" — **capability inactive**, in `INVENTORY_BALANCE_UNAVAILABLE_REASON`'s own words. The section renders with that sentence. |
| **P-N3** | **On order** — *"not readable from this page yet"* | Same callable, same field, same gate. The sentence implies a read that was never built; one was. | Folded into the same capability-inactive block as P-N2. One sentence, not two. |
| **P-N4** | **Where it is** — a location table with per-location quantities | `inventory.location.display.read` is `active: false` and granted to nobody. `truckInventoryView.js` carries a **STRICT NON-COMPUTATION** boundary: it *"NEVER computes inventory value, on-hand, reserved, available."* There is no source for the quantity column and no source for the rows. | Section renders its heading, its location-is-not-custody sentence, and the capability-inactive state. No rows, no invented totals. |
| **P-N5** | **Serialized units** — three serials with status, location and context | `inventory.serializedAsset.read` is `active: false` and granted to nobody. | Capability-inactive state, gated on tracking mode so a LOT or untracked part still gets its own correct treatment rather than this one's absence. |
| **P-N6** | **Activity** — *"the governed movement ledger"*, seven movement types | `inventoryLedgerEvent.js` is a **pure shape contract with no persistence**: its own boundary list names *"persistence, Firestore, Rules, indexes, Functions, migration, or UI."* The seven types are declared ahead of a ledger that does not exist. The only real ledger is `inventory_transactions` (Work-Order reservation/consumption plus `RECEIVE_STOCK` / `ADJUST_STOCK` / `CORRECT_MISTAKE`). | Activity renders `inventory_transactions` and says which ledger it is. The seven types are not named on screen as though they were readable. |
| **P-N7** | **Cost** — `$2,480.00 baseline` | `metadata/definitions/part.js` declares `unitCost` `displayable: false`, `reportable: false`, `exportable: false` — *"BLOCKED — the canonical Part carries no cost of any kind"* (`PART_INVENTORY_VALUATION_AUTHORITY_GAP`). The drawn value is the legacy static one. | **Blocked on ND-27.** Not rendered meanwhile. |
| **P-N8** | **Reorder at 2 · baseline** | Two different facts wearing one label. `reorderPoint` is `DERIVED_AT_READ` from usage (`calculateReorderPoint`); the static `reorderThreshold` is legacy seed data. Showing the second under the first's name is the P-N1 error in miniature. | The derived value where the analytics read has already run, named as derived. Never the static threshold. |
| **P-N9** | Search placeholder — *"part number, description, barcode, or alias"* | Two of the four are not true. `description` is not carried through the composing adapter and `PART_DESCRIPTION_SEARCH_INDEX_GAP` is a declared gap; alias resolution needs the identifier read, which is `active: false`. A placeholder is a claim about what typing will do. | The placeholder names only what the lookup resolves today. It grows when the reads do. |

### Rulings inside the presentation rule

- **P-N10 — Manage identifiers / alias list.** The handoff annotates these **EOS ACTION**. The five
  alias callables are *exported but not deployed* and `inventory.catalog.manage` is granted to no
  standing role (`partIdentifierReadiness.js`). `PartIdentifiersSection.jsx` already renders this
  correctly. The migration **preserves it and copies nothing over it** — the action appears only
  behind its real gate.
- **P-N11 — "Bin R4-08" and "Staged for WO-2026-001241".** The handoff flagged both **VERIFY**. Both
  hang off P-N4 and P-N5 respectively, so both are unreachable while those capabilities are inactive.
  Recorded, not built.
- **P-N12 — the projection drops fields it already holds.** `buildPartDetailView` returns
  `partId, sku, name, category, unit, cost, price, reorderThreshold, warehouseQty` and stops. The
  adapter beneath it carries `internalPartNumber`, `status`, `controlType` and `stockingClass`; the
  document beneath *that* carries `description`, `primaryManufacturerId` and `oemStatus`. Every fact
  the North Star header needs is one projection widening away. This is a **projection fix inside the
  existing read** — no new query, no new collection, no new capability — and it is the only
  behavioral work this migration performs.

## Three defects found in passing — all live, all pre-existing

1. **The Manufacturer row on the Part record can never render.** `PartDetail.jsx:1528` gates it on
   `canonicalPart?.manufacturerId`. `canonicalPart` comes from `fetchPartMasterList` → `toPartView`,
   which projects no manufacturer field at all — and the stored key is `primaryManufacturerId`
   anyway (`partMasterRepository.ts:91`), so the expression is wrong twice over. The Wave 6 Owner
   Decision of 2026-08-15 to resolve manufacturer *names* rather than ids is wired to a value that
   never arrives. This is the same value-never-arrives class as the Sales Order timestamp defect in
   family 2.
2. **`PartIdentifiersSection` is passed `partNumber={canonicalPart?.partNumber}`** — also always
   `undefined`. The projection calls that field `internalPartNumber`.
3. **The workspace renders the document id under the heading "Part Number".** `PartsList.jsx:797`
   heads the column *Part Number*; the cell renders `part.sku`, and the comment above it asserts
   *"A BUSINESS IDENTIFIER, not a document id."* `toPartView` requires `partId === docId`, and
   `sku === key === partId` throughout the adapter. It is the document id. The real part number,
   `internalPartNumber`, is carried by the adapter one field away and unused. Under a directive whose
   standard is *recognition over IDs* and *document ids never render*, this is the finding that most
   deserves fixing, and P-N12 is what makes it possible.

## Named decisions — the Owner's, not this build's

**ND-25 — May a Parts surface show a quantity at all today, and which one?**
The design says **On hand**, from the static baseline. The Owner's 2026-08-24 ruling says that number
is FALSE_COMFORT and the column must answer *"Not known"*. The shipped list instead shows
`availableStock`, derived client-side from `inventory_transactions` by `inventoryAnalyticsEngine` —
which is an **available**-shaped number, the very column the design deliberately refuses to draw. So
the design and the shipped ruling disagree about both the value and its name. Three coherent answers
exist: keep the derived available and let the design's no-Available rule yield to the earlier ruling;
show nothing quantitative until `getPartBalance` is activated; or show the derived figure under a
heading that names its derivation. This build will not choose between an Owner ruling and an Owner
design.

**ND-26 — Which string is "the part number"?**
The design makes it the record title and forbids document ids on screen. `partId` is the immutable
document id. `internalPartNumber` is a separate, **mutable-under-governance** field whose previous
value is backfilled as a historical alias when it changes (`partMasterCommands.ts:293`). They are
definitively two different things, and today the workspace prints the first under the second's name.
The title, the breadcrumb and the workspace column should all read `internalPartNumber` — but that
makes the page title mutable, which is a product decision about identity, not a styling one.

**ND-27 — May the legacy static cost be displayed on the Parts record?**
The metadata register blocks `unitCost` from display, report *and* export, citing
`PART_INVENTORY_VALUATION_AUTHORITY_GAP`, and it blocks all three together specifically so the field
cannot reach the same person by a longer route. The design draws a cost anyway, marked *baseline*.
Either the register's refusal stands and the rail's Purchasing block loses its first row, or the
Owner rules that a marked legacy value is acceptable here — which reopens a refusal made deliberately.

## Gaps carried, not closed

- **P-G1** — `PART_CATALOGUE_WHOLE_COLLECTION_READ`. Six surfaces, this workspace among them, read the
  entire `parts` collection. Named and recorded; not this migration's to fix.
- **P-G2** — `PART_LIST_BALANCE_N1_GAP`. `getPartBalance` is single-part, so a balance column would
  issue one callable per row. The register already refuses *"rendering the columns anyway and hiding
  the cost behind a spinner."* The workspace inherits that refusal, which is a second and independent
  reason a governed On-hand column cannot exist yet.
- **P-G3** — the three inactive capabilities (`inventory.balance.read`,
  `inventory.serializedAsset.read`, `inventory.location.display.read`). Activation is an Owner action
  in its own gate. Until then the record's three largest sections state why they are empty rather than
  being omitted, which would read as *"this part has none."*

## What will deliberately not be done

No new Firestore read, no new Function, no Rules change, no capability grant or activation, no
readiness constant flipped, no state-machine change, no write path. `partLookup.js`'s
*lookup never moves inventory* invariant and every scanner invariant travel through untouched. No
availability math is written, no reorder algorithm, no vendor authority, no purchasing mutation from
Parts, no serialized mutation UI, no AI surface.

## Acceptance

Engineering proof is not acceptance. This family will end at **`AWAITING_OWNER_VISUAL_ACCEPTANCE`**,
and it cannot begin until **ND-25, ND-26 and ND-27** are answered — the first decides what the
workspace's principal column may say, the second decides what the record is called, and the third
decides whether a rail section exists.

---

# Part II — the Owner's rulings, and what shipped (2026-08-30)

ND-25, ND-26 and ND-27 were closed the same day they were raised. This section is appended rather
than folded into Part I, so the reconciliation that preceded the rulings stays readable as what it
was: an argument made without knowing the answer.

## The rulings

| | Ruling | Effect on the composition |
|---|---|---|
| **ND-25** | **Option (b).** No Parts surface may present `warehouseQty` as stock authority. No client-side N-part balance derivation and no relabelled `availableStock` to satisfy the mockup. Quantitative inventory facts reach a surface only through `getPartBalance`, once activated, labelled by their real semantics. Omit the workspace quantity column in P1. **TRUTHFUL ABSENCE > FALSE COMFORT.** | The record header states no quantity. Where-it-is states why it cannot list locations. The static baseline rows are gone. |
| **ND-26** | **Option (a).** `internalPartNumber` is the human-facing Part Number; `partId` stays the immutable document and routing key. A mutable business-facing title is acceptable. Never label `partId` "Part Number". | The record title, the breadcrumb leaf and the workspace column. The three defects were authorised as presentation/projection corrections. |
| **ND-27** | **Refuse display.** `unitCost` stays blocked from display, report and export. Remove the static Unit Cost row. Do not loosen cost governance as part of this migration. | The Purchasing block carries no cost row — and no price row either: `sellPrice` is blocked by the same clause of the register for the same reason. |

## What shipped, against the nine rulings of Part I

| # | Disposition |
|---|---|
| P-N1 | **Resolved by ND-25.** No quantity in the identity layer, and the static baseline appears nowhere. |
| P-N2, P-N3 | Rendered as **capability inactive** in `INVENTORY_BALANCE_UNAVAILABLE_REASON`'s own words — one sentence, not two, and not "authority required". |
| P-N4 | *Where it is* renders its heading, the location-is-not-custody sentence, and why it cannot list locations. **No empty table.** |
| P-N5 | The unit section is gated on the Part's own tracking mode through `resolveTrackingModeFromControlType`, so `SERIALIZED_LOT` fails closed instead of collapsing into `SERIAL`. Serial, lot, untracked and unsupported each render their own treatment; untracked renders **no section at all**. |
| P-N6 | *Activity* reads `inventory_transactions` and names it as the work-order and receiving ledger. The seven-type contract is not named as though it could be read. |
| P-N7 | **Resolved by ND-27.** No cost row, no price row. `money()` had no consumer left and was removed. |
| P-N8 | The derived reorder point stays inside the forecast section, named by its derivation. The static threshold is gone. |
| P-N9 | Deferred to the workspace, which is the surface that carries the search control. |
| P-N12 | Shipped in [#1593](https://github.com/TaylorService-spec/Taylor_Parts/pull/1593). |

## Three more enum leaks, found while composing

The reconciliation found three defects. Composing the page found three more of the same family, all
in cells that had been rendering database values at a reader:

1. **Activity's Type column printed the raw enum** — `CONSUMED`, `TRANSFER_OUT`. It now prints words
   from `LEDGER_TYPE_LABEL`, and an unrecognised type reads "Movement" rather than its token.
2. **The Risk cell printed `health.recommendation.urgency` raw** — while `PartsList` showed the word
   for the same value one page away. One vocabulary now serves both.
3. **`test/partsMasterDataEntryPoints.test.jsx` proved the manufacturer *name resolution* and not the
   row's reachability** — it mocked a canonical row that already carried `manufacturerId`, so it
   passed for the entire period the production row could not render. A test can be green about a
   value the running system never produces.

## ND-28 — the ledger-derived stock forecast has no ruling yet

ND-25 says quantitative inventory facts may appear only through `getPartBalance`. Taken to its
literal end that removes the **Stock Position** card entirely — and with it `RequestReorderControl`,
which is gated on `health.recommendation` and is the entry point to the governed reorder-request
workflow. That workflow is live, governed and working; it is not a mockup element, and deleting a
working command surface is not something a presentation migration may decide.

**Shipped meanwhile, on the reading that the ruling prohibits *substitution* rather than the
forecast's existence:** the card stays, renamed **Stock forecast**, with every figure named by its
derivation (*"Derived from this part's movements in the work-order and receiving ledger — not a
governed stock position"*), and `Available (ledger-derived)` renamed **Ledger-derived stock** so no
cell carries the word the ruling reserves. It is **not** promoted into the record's identity layer,
which is what ND-25's prohibition is aimed at. A part with no ledger movements gets a sentence saying
no forecast can be made — explicitly *"not a statement about how many exist"*.

**The decision:** is that reading right? Or does ND-25 mean the forecast card should go, taking the
reorder request's entry point with it until `getPartBalance` is activated and can gate it instead?
This build will not remove a working governed workflow on its own reading of a ruling aimed at a
different surface.

## Proof

| Suite | What it makes falsifiable |
|---|---|
| `test/partsNorthStarProjection.test.mjs` (11) | ND-25 as a shape rule (no composer may grow `available`/`onHand`/`onOrder`; `warehouseQty` keeps `STATIC_FALLBACK`), ND-26 as an identity rule, the manufacturer key, and the refusal to coerce an unknown `oemStatus` |
| `test/partsNorthStarIdentity.test.jsx` (4) | The three corrected renders |
| `test/partsNorthStarRecord.test.jsx` (21) | The record composition: title, kicker, no quantity in the identity, no cost or price anywhere, the four honest states as four sentences, one unit treatment per tracking mode, a rail that never repeats the header, words where enums leaked, and no liveness claim |

**Mutation proofs: 23 run, 22 caught,** source restored byte-identical after each. The one missed is
recorded in [#1593](https://github.com/TaylorService-spec/Taylor_Parts/pull/1593)'s body rather than
quietly dropped: reverting the Manufacturer row's JSX alone is no longer observable, because the
projection now supplies the same key to both objects. The behavioural fix is in the projection, and
both mutations that remove it there are caught.

CI: `.github/workflows/parts-north-star-tests.yml`, path-filtered to the five domain modules, the two
components and the three suites. `test/ciSuiteCoverage.test.mjs` passes — no suite here runs nowhere.

Local at implementation: **259/259 node suites, 2774/2774 vitest tests, `vite build` clean, oxlint
clean.**

## The shell obligation, declared rather than escaped

`PartDetail.jsx` left `CONFORMANT_WORKSPACES` when it stopped hosting `WorkspaceShell`, and had to be
declared in `NORTH_STAR_RECORD_PAGES` in the same commit. **GATE 2b² caught it** — the gate written
after families 1 and 2 shipped into exactly that hole. It worked.

## Still to come

The **workspace** (`PartsList.jsx`) — its quantity column omitted per ND-25, its Part Number column
already corrected, and its search placeholder narrowed to what the lookup resolves (P-N9). Then the
ledger row, sandbox refresh and Quick Gate.

---

# Part III — the workspace (2026-08-30)

## What ND-25 actually removed

The **quantity column is gone** from `/inventory`. Its history is the argument for removing it, and
each step subsumed the last:

1. The static catalogue quantity, welded to a `(baseline)` caveat in one string — nothing could sort,
   filter or report on it.
2. The two split apart. Readable, and it stopped short of the real problem: the **number**.
3. **Owner ruling 2026-08-24** — the catalogue is not an availability authority. The column answered
   from the ledger instead, and said *"Not known"* where the ledger had not spoken.
4. **ND-25, 2026-08-30, Option (b)** — that ledger figure is a client-side derivation and it is
   *available*-shaped. Quantitative inventory facts are reserved for `getPartBalance`, which is
   single-part (`PART_LIST_BALANCE_N1_GAP`) and switched off. With no list-scale projection to answer
   from, the column is **omitted** rather than answered from something else.

`test/inventoryHealthScaleSemantics.test.jsx` records the supersession chain in place rather than
deleting the assertions it replaces — that file's own convention, and the reason a reader six months
from now can see why the column left instead of guessing.

**Inventory Health stays.** It is a qualitative signal, not a quantity: it says whether a part needs
attention, never how many there are, and its three outcomes are three different statements about what
is *known*. Removing it would take an operational judgment away without a ruling asking for it. That
is a judgment call, made explicitly and pinned by a test so it can be reversed deliberately.

## A defect ND-26 created, and this pass fixed

Making `internalPartNumber` the displayed Part Number introduced a failure the record could not
show: **the parts search matched `sku + name + category`, and `sku` is the document id.** A person
could read `C712-COMP` off the row in front of them, type it, and be told no such part exists — the
one search a warehouse actually performs.

The provider now matches `internalPartNumber` and `description` as well, both of which the composed
row already carries: a wider read of loaded data, not a new query. `sku` stays in the haystack
deliberately — somebody holding a document id from a link or a log should still find the part — but
it is no longer the only identifier that works, and it is no longer what the result *labels* the part
with. **Barcodes and aliases are not searched and are not claimed**: resolving those needs the
identifier read, which is `active: false` and granted to nobody.

The placeholder moved from *"Search parts…"* to **"Search part number, description, or category"**,
and a test asserts every term it names actually matches while a barcode-shaped value matches nothing
— which is what makes the omission honest rather than merely cautious. This closes **P-N9** in the
opposite direction from the design, which claimed barcode and alias search the lookup cannot perform.

## What the workspace deliberately did NOT become

`PartsList.jsx` keeps its pre-North-Star multi-panel shell — Work, Parts and Flow groups holding the
reorder queues, the health panel, the catalogue table and the history lookup. It is a role home page
rather than a collection, and migrating it to the Lists P2 collection grammar means recomposing four
panels and the governed reorder queues inside them.

That is **Lists P2 work, not Parts North Star P1**, and doing it here would broaden the scope past
what was authorised — *"do not perform a platform rebuild"*. Recorded as the next piece rather than
half-done.

## Proof

`test/partsNorthStarWorkspace.test.mjs` (10) — the omission asserted four ways (no quantity heading,
no restored cell, no cell reading `health.stock.availableStock`, and the panel's own sentence no
longer promising a stock position), Inventory Health's survival pinned so a tidy-up cannot read ND-25
as removing the pair, and the six searchability rules. **Five mutation proofs, all caught** —
including restoring the column, reverting the search haystack, falling back to the key in a result
label, and claiming barcode search in the placeholder.

Local: **260/260 node suites, 2776/2776 vitest tests, `vite build` clean, oxlint clean.**

---

# Part IV — ND-28 closed, and the gate (2026-08-30)

**ND-28 is CLOSED: keep the Stock forecast card and `RequestReorderControl`.** The shipped
interpretation was correct.

The Owner's reasoning is worth carrying here rather than only in the decisions register, because it
is the rule that decides every future version of this question:

> INFORMATION: Stock forecast may compose clearly identified derived information.
> COMMAND: `RequestReorderControl` remains governed by its existing EOS command authority.
> **The informational number does not become the authority for the command merely because they share
> a card.**

So ND-25 is a prohibition on *disguise*, not on derived facts existing. A number may be shown when its
derivation is explicit and it does not imply stronger authority than it has; it may not be called On
hand, called Available where that implies `getPartBalance` authority, promoted into the record header
or the workspace's principal quantity column, or allowed to look like the thing that authorizes the
reorder.

**ND-28-F, open.** When `getPartBalance` is activated, the forecast composition must be reconciled
against the governed balance — replace, supplement, or remain distinct — as an explicit authority
change with its own tests. Semantics must not change silently when the capability flips.

## The gate

`field-ops-app-vite/.claude/skills/run-field-ops-app-vite/partsNorthStarQuickGate.mjs`, 16 checks,
one gate per accepted family (the `dispatchNorthStarQuickGate` / `serviceOperationsNorthStarGate`
pattern).

| Checks | What they hold the deployed bundle to |
|---|---|
| 0 | **Release identity** — a precondition, not a check. If the origin is not serving the named SHA the gate refuses with exit 2 rather than measuring the wrong bundle. |
| 1–5 | Frame 1a: loads at 1440 and 375, no document-level horizontal overflow, **no quantity column** (read from the deployed headings), the Part Number column is not the route id, and **the typed search finds the number the row displays**. |
| 6–14 | Frames 1b/1c: the record's title is the Part Number, the header states no quantity, no cost or price anywhere, *Where it is* states why it is empty and draws **no table**, the unit section matches the part's own control word, Activity renders words rather than tokens, and the record survives 375. |
| 13 | ND-28: the forecast names its derivation and the reorder control stays **reachable** — asserted by presence, never by pressing it. A gate that raised a real reorder request would be a gate that mutates. |
| 15–16 | Not-found is its own sentence, distinct from any blocked read; and nothing threw. |

Two decisions inside it are worth naming. **Check 5 types** the number it just read off the page
rather than asserting the provider's source, because the ND-26 search defect was invisible to every
static read and only a live typed search proves the deployed bundle carries the fix. **Check 2/14
measure `documentElement.scrollWidth`, not `body`** — #1594's overflow escape left `body` correct while
the document scrolled 122px sideways, so a body-only assertion reports a clean page and means nothing.

## Status: the gate has not run, and why

The Owner authorized the refresh against `main @ 67da42a9`. **This build could not perform it** —
`firebase deploy` and the `sandbox-refresh.ps1` launcher are both blocked by the session permission
layer, which an Owner authorization does not lift. That is a pre-existing property of the session,
measured 2026-08-27, not of the authorization.

Verified read-only instead: the live sandbox serves **`0a5aeca3`** (the family-6 release), so Parts P1
is confirmed *not* live from `/version.json` rather than assumed from a merge; the release
preconditions hold (clean tree, `HEAD == origin/main == 67da42a9`); and the gate's identity guard was
proved by running it against the live origin with `--expect 67da42a9`, where it correctly **refused,
exit 2**.

The operator command is in the ledger. The moment it lands, the gate answers all six of the Owner's
post-deployment steps in one run and prints the two URLs for visual acceptance.
