# EOS Structured Object Presentation Standard

**Recorded 2026-08-23 during WO-04.** Established in the Warehouse / Parts handheld; **not** applied
site-wide yet. The site-wide audit is deliberately out of scope here and is queued for the
post-handheld pivot.

---

## The principle

> A business object is a set of separately addressable fields. It is never a sentence.

An attribute stays independently addressable all the way down the chain:

```
STORAGE → PROJECTION → READ MODEL → API → UI → FILTER → SORT → REPORT → ANALYTICS → AI
```

A responsive layout may **rearrange** fields, **stack** them, or **drop** low-priority ones on a
narrow screen. It must never **concatenate** them, because concatenation is the one transformation
no downstream consumer can undo.

## What this exists to stop

```
Taylor C161 · S/N CW-C161-0001 · AVAILABLE · wh-main
```

That single line was rendered by `EquipmentInstallCloseout` before WO-04. It contains five business
attributes and exposes none of them:

| problem | consequence |
|---|---|
| status is inside prose | cannot filter, sort, group or report by it |
| quantity is absent | a serialized unit's "one" is implied, not stated |
| location is a **raw id** | `wh-main` is unreadable, unsearchable by the name people use, and teaches staff to memorise internal keys |
| separator-joined | a screen reader reads it as one run-on string |
| no field identity | analytics and AI see text, not an object |

The corrected form — six fields, six labels, one worked example:

| Field | Value |
|---|---|
| Equipment | Taylor C161 |
| Serial Number | CW-C161-0001 |
| Quantity | 1 |
| Status | Available |
| Location | Main Warehouse |
| Description | Whole Unit Equipment |

## Status is a field

`IN_TRANSIT` remains the domain value. `In Transit` is what a person reads. **Both exist at once**,
and the raw value travels on the rendered element (`data-raw`) so a filter, a sort, a test or a
report reaches the enum rather than the wording.

Status must remain independently **filterable, sortable, reportable, accessible and styleable**.

**Colour may supplement a status. It may never be its only representation.** Strip every class from
the markup and the meaning must survive — a phone in direct sunlight, a colour-blind operator and a
greyscale screenshot in a support ticket all have to work. Asserted by a test that removes all
classes and re-reads the text.

## Absence has three meanings, and they never collapse

| absence | means | example |
|---|---|---|
| `Not recorded` | nobody entered it | a unit with no description |
| `Not available to you` | authority does not permit it | stock balances with no governed client read |
| `Unavailable` | a join did not resolve | a location id the display projection could not map |

An absent field still **renders**. Omitting the row makes "we have no serial for this" identical to
"this object has no serial concept", and an operator acts differently on each.

**`UNKNOWN` is not zero, and zero is not absence.** A falsy check that turns `0` into "Not recorded"
makes an empty shelf indistinguishable from one nobody has looked at.

## Responsive rule

Each field carries a `priority`: 1 always, 2 when there is room, 3 detail only. A narrow screen
**drops** by priority. At ≤359.98px the label/value pair **stacks** rather than splitting into two
columns — a two-column split at 320px leaves the value about 120px wide, and a half-shown serial
number is worse than a wrapped one.

## Implementation

- `src/domain/structuredFields.js` — the pure field model, and per-object builders.
- `src/shared/ui/StructuredFields.jsx` — one renderer, a `<dl>`, so each attribute is addressable to
  a screen reader, a stylesheet and a test. Never a `<table>`: a desktop grid on a phone is a
  horizontal scrollbar with extra steps.

## Fields that must stay independent

Status · Quantity · Location · Description · Serial Number · Customer · Vendor · Owner · Technician ·
Date · Type · Amount / Dollars · Cost · Revenue

## Not done here

The site-wide audit. WO-04 establishes the standard and applies it in the Warehouse / Parts handheld
and the whole-unit install display. Every other surface is unchanged, and converting them is the
post-handheld pivot — see the companion note on Sales Order and Purchase Order Dollars columns.
