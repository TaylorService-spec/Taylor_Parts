---
title: Phoenix Bin pilot — field worksheet (one representative aisle)
status: Ready to fill in onsite — nothing below is invented
authority: Owner ruling B3 (Decision #178): pilot-first, one aisle/area before the whole warehouse
procedure: bin-warehouse-conversion.md
---

# Phoenix Bin pilot — field worksheet

**Purpose.** Prove the physical process on ONE representative aisle before converting the Phoenix
warehouse. The repository has no Phoenix layout, and none is guessed here: every blank below is
filled in by the person standing in the aisle.

**Do not start** until the sandbox Quick Gate has passed. The pilot runs against
`eos-platform-sandbox` first. Production is a separate authorization.

## A. Pilot identity (fill once)

| Field | Value |
|---|---|
| Warehouse (governed `warehouses/{id}` id) | |
| Area name (e.g. Parts Room, Warehouse floor) | |
| Area code (C-2) | |
| Pilot aisle letter | |
| Why this aisle is representative (mix of small parts, serialized units, floor stock) | |
| Recorder / date | |
| Operators doing put-away (each holds Put-Away Operator **and** Stock Relocation Operator) | |

## B. Physical layout of the pilot aisle (C-1, C-2)

One row per bay. "Positions" means bin positions on that bay as physically built.

| Bay # | Positions on this bay | Bay width (C-1) | Irregular positions? (missing, double-width, blocked) | Notes |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |

These rows feed **Administration → Warehouse Racking** (aisle, bay counts, positions per bay, explicit
irregular positions). Preview before applying; the generator is idempotent.

## C. Bin-by-bin capture

One row per bin position. Complete BEFORE labels go up, then tick **Label fixed** after.

| Position (e.g. A01-001) | Current human label, if any | Desired canonical label | Parts physically present (part number / code) | Qty per part (NONE-tracked) | Serialized units present (serial numbers) | Label fixed ✓ |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

## D. Direct / unbinned stock that will move into the pilot bins

Stock currently on the floor (recorded direct at the Warehouse) that belongs in a pilot bin.

| Part | Quantity to put away | Destination bin | Serial numbers (if serialized) | Moved ✓ | Line result shown by Move stock |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |

**Stays unbinned on purpose** (oversize, floor stock) — named, so the completion record can list it:

| Part | Quantity | Why it stays direct |
|---|---|---|
| | | |

**Not supported by Move stock** (lot-tracked or unmapped parts show "Not supported here") — leave in
place and list:

| Part | What the screen said |
|---|---|
| | |

**Insufficient stock on a line** (the ledger says fewer exist than are physically here) — do not force it.
It is a Cycle Count matter after conversion:

| Part | Physically present | What the line reported |
|---|---|---|
| | | |

## E. Label and printer observations (C-4, C-5)

| Question | Observation |
|---|---|
| Label stock / size used | |
| Printer (model, driver, browser) | |
| Does the Code 128 label scan first time on the handheld? At what distance? | |
| Does the label fit the bay face without covering the next position? | |
| Glare / angle / height problems | |
| Labels reprinted, and why | |

## F. Pilot timeline and evidence

| Step | Time (UTC) | Result |
|---|---|---|
| Start time recorded (before the first scan) | | |
| Put-away finished | | |
| `binConversionReconciliation.mjs` result (BALANCED / NOT BALANCED) + report sha256 | | |
| Decision: extend to the whole warehouse, or fix and re-pilot | | |

The pilot does **not** run `completeBinConversion.mjs` unless the whole warehouse is being declared converted.
One aisle proves the process; the gate is per Warehouse.

## Facts still required before the pilot can start

1. The Phoenix Warehouse's governed id in the target environment.
2. The pilot aisle and its as-built bays and positions (section B).
3. C-1 bay width and C-2 area code(s).
4. C-4/C-5 label stock and printer.
5. Named operators, each granted `inventoryPutAwayOperator` + `inventoryStockRelocationOperator` in the
   target environment through the governed grant path.
