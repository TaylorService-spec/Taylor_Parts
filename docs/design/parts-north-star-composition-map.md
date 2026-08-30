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
