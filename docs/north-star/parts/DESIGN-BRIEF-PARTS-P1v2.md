# Design brief — Parts P1v2

**For Design. Claude produced no composition and proposes none.**

A composition proposal was drafted before the Owner's instruction of 2026-08-30 arrived and has been
**withdrawn**; it is not in this brief and should not be reconstructed from it. Claude's next role is
an authority/feasibility review of Design's composition against the repository, **before** any
implementation.

---

## Status

| | |
|---|---|
| **Deployed** | `9848ec9d` — `platform-sandbox` / `sandbox` |
| **Technical gate** | **Quick Gate 25/25 PASS** against that release |
| **Owner finding** | *"The information is generally correct, but the Parts workspace and Part record are not laid out well."* |
| **Acceptance** | **VISUAL COMPOSITION REJECTED** for both `/inventory` and `/inventory/CW-P-0001` |

The implementation is not in question. The composition is.

---

## 1–3. Current deployed surfaces

Captured from the deployed build at `9848ec9d`, full-page, delivered alongside this brief:

| Frame | Surface | File |
|---|---|---|
| workspace 1440 | `/inventory` | `audit-workspace-1440.png` |
| workspace 375 | `/inventory` | `audit-workspace-375.png` |
| record 1440 | `/inventory/CW-P-0001` | `audit-record-1440.png` |
| record 375 | `/inventory/CW-P-0001` | `audit-record-375.png` |

Reproducible read-only at any time:

```bash
node field-ops-app-vite/.claude/skills/run-field-ops-app-vite/partsNorthStarQuickGate.mjs --expect <live-sha>
```

## 4. Existing North Star Parts design frames

`docs/north-star/parts/` — `North Star - Parts P1.dc.html` (frames 1a–1d) and
`DESIGN-HANDOFF-PARTS-P1.md`.

**Design should know which parts of P1 the repository could not build, and why**, so P1v2 does not
re-propose them: the full reconciliation is
[`parts-north-star-composition-map.md`](../../design/parts-north-star-composition-map.md), Parts I–XI.
The short version — P1 drew an **On hand** column and per-location quantities that no governed
authority can supply, and labelled three switched-off capabilities as *authority required* when they
are *capability inactive*.

---

## 5. Owner finding

> The information is generally correct, but the Parts workspace and Part record are not laid out
> well.

---

## 6. Product and governance constraints — ND-25 through ND-30

These are settled Owner rulings. A composition that requires any of them to be reopened should say so
explicitly rather than assume it.

| | |
|---|---|
| **No `warehouseQty` as governed stock** | Its own source file declares *"METADATA ONLY — NO STOCK AUTHORITY."* |
| **No invented inventory quantities** | Quantitative inventory facts reach a surface only through `getPartBalance`, once that capability is intentionally activated. **TRUTHFUL ABSENCE > FALSE COMFORT.** |
| **`internalPartNumber` is the human-facing Part Number** | `partId` is the immutable document/routing key and never appears as a label. |
| **No blocked cost/price fields** | `unitCost` and `sellPrice` are refused for display, report **and** export. |
| **Governed reorder authority stays separate** | The informational forecast number does not become the authority for the reorder command merely because they share a card. |
| **Derived stock stays explicitly derived** | Named by its derivation, never promoted into the record's identity layer. |
| **Unavailable capabilities stay truthful** | Balances, serialized-asset and location reads are built, governed and switched off. They say so; they are neither hidden nor faked. |
| **No new Rules / Functions / permissions / state semantics** | |
| **Scanner semantics stay governed** | A scan identifies; it never mutates, receives, transfers, counts or reserves. |
| **Serialized inventory semantics preserved** | Serialized units are assets, never loose quantity; `SERIALIZED_LOT` fails closed. |

---

## 7. Specific problems Design should solve

Measured on the deployed build, not inferred.

### Workspace — 1440

```
document height     3,406px
visible headings       13     H1 ×2, H2 ×2, H3 ×7, H4 ×2
empty-state lines       4
rows of real Work       1
Work group height   1,220px
content width       1,188px      catalogue table 1,076px
```

- **A third of the page is the Work group**, spending 1,220px on eight headings, four "nothing here"
  messages and one row.
- **Two of six table columns are effectively empty**: Manufacturer `Not recorded` ×25 (194px),
  Attention `—` ×23 (142px). 336px of table width carrying almost nothing. Both are governed and will
  populate one day; neither earns its width today.
- **The heading hierarchy misreports the structure.** *Waiting* and *In Progress* are H4s under *My
  Work*; *Team Work* and *All Assigned Work* are H3 siblings — so a section holding one row outranks
  the two holding the work.
- **Four slices of one collection, each with its own furniture.** Parts Manager Queue, Waiting, In
  Progress and All Assigned Work are all reorder requests split by status and assignee. The copy
  already apologises for the overlap: *"Your own assignments above are a subset of this list."*
- **The horizontal axis is unused below the header** — one 1,188px column top to bottom, while the
  record beside it uses a main/rail split.

Owner's stated goals: **stronger Parts-first hierarchy · better use of width · better collection/table
composition · clearer attention/exception scanning · Work and Flow must not visually compete with
Parts · avoid simply adding more cards.**

### Workspace — 375

```
document height     9,277px      ← 11.4 screens, and 2.7× the desktop page
```

- **The most serious finding in the audit.** Each part becomes a stacked card of six label/value rows,
  two of which read `Not recorded` and `—` on nearly every card. ~300px per part.
- The stacking rule exists so no value is orphaned from its heading — right for a table of numbers,
  heavy for a table of identity and words.
- **The Work group's four empty states render in full at 375**, on the device with least room.

### Record — 1440

```
document height     1,508px
headings                9     (2 × H1, 7 × H2)
sections                7
main column           680px    of 1,188px content width
```

- **The two-column top is unbalanced**, and the unavailable *Where it is* leaves a large dead area.
- **Absence occupies more of the page than fact.** Three of seven sections state that there is
  nothing, each with a heading, a meta line and an explanatory paragraph — roughly 700px for three
  absences.
- **What the page actually knows fits in four lines**: the identity, `Ledger-derived stock 6`, one
  Activity movement, and the classification.
- **Identifiers is a dense prose column** — three explanatory paragraphs and an unavailable notice
  where a rail wants scannable facts.
- **Governance explanations visually dominate useful business facts.**
- **Weak relative hierarchy between sections**, and an excessive horizontal-rule/document feeling.
- **Two tables carry almost nothing**: Activity is 4 columns × 1 row with two `—` cells; Stock
  forecast is 6 rows of which three read *Insufficient usage history*, *—* and *Not established*.

**The sentences themselves must survive.** ND-25's *"location describes where units sit — it never
implies custody or availability"* and the identifier *"this is not an empty list — it is an unread
one"* are the point of the page. The problem is not that absence is stated; it is that stating it
costs more than stating what is known.

### Record — 375

```
document height     2,615px
```

Proportionally the healthiest of the four. Inherits the same three absence sections at the same cost.
No horizontal overflow; the fixed tab bar clears the last content by 93px.

---

## 8. What the composition must answer visually

- What is this part?
- What do we know about it?
- Where is it?
- What needs attention?
- Is anything demanding it?
- What is the purchasing/reorder situation?
- What inventory information can truthfully be shown?
- What happened recently?

---

## 9. Owner-supplied record sketch

The Owner provided a record arrangement alongside this brief — grouped bands (*Availability /
Inventory*, *Demand & Purchasing*, *Part information*, *Identifiers*, *Activity*) with two-up
sub-columns inside each band. **Carried here as Owner direction for Design to work from, not as a
specification, and not reviewed or amended by Claude.**

---

## Requested output

| Frame | Surface |
|---|---|
| **1a** | Parts workspace — 1440 |
| **1a-mobile** | Parts workspace — 375 |
| **1b** | Part record — 1440 |
| **1b-mobile** | Part record — 375 |

## What happens next

1. Design produces the P1v2 composition.
2. **Claude performs an authority/feasibility review against the repository** — every drawn element
   checked against the function that would have to supply it, as in the P1 reconciliation, which found
   nine of fifteen drawn elements unbuildable as drawn.
3. Owner approves the direction.
4. Only then, implementation.

**No code until the Owner approves the new Design direction.**
