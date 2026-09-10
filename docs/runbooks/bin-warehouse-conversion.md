---
title: Bin warehouse conversion runbook (Phoenix first)
status: Repository complete / sandbox ready / physical conversion pending
authority: Decision #160 / ADR-014 (Model A custody), Decision #170 (BIN-P6), plan §12 and gate E
tooling: functions/scripts/binConversionReconciliation.mjs (read-only)
---

# Bin warehouse conversion runbook

Converting a warehouse to bins means putting its existing, unbinned stock away into labelled bins so that
Bin-level on-hand becomes the whole truth for that warehouse. It is an **operational programme done with
ordinary governed commands**, not a migration.

## What conversion is — and is not

- **Is:** operators scanning stock from the warehouse floor into bins with **Scan → Move stock**. Each line
  is one governed `relocateStock` call that writes `RELOCATION_OUT` at the warehouse and `RELOCATION_IN` at
  the bin. The warehouse aggregate does not change; the Bin picture fills in.
- **Is not:** a script that writes ledger rows, an edit to any balance, a rewrite of historical
  `inventory_transactions`, or a backfill claiming stock was in a bin before anyone put it there (O-2).
  There is **no apply mode anywhere in the tooling**, deliberately.

A partly converted warehouse has a **correct aggregate and an incomplete bin picture**. That is a truthful
state, and the reconciliation report shows it as `direct` quantity still to put away.

## Preconditions (every one is required)

| # | Precondition | State on 2026-09-10 |
|---|---|---|
| 1 | BIN-P6 merged: one on-hand authority, `relocateStock`, multi-scan | **Done** (#1835, #1836) |
| 2 | Functions + client carrying P6 deployed to the target environment | **Not done** — sandbox release needs Owner deploy authorization |
| 3 | `inventory.stock.relocate` active in that environment (BIN-P4) | **Not done** — inert everywhere |
| 4 | The people doing the conversion hold a Role granting `inventory.stock.relocate` + `inventory.location.bin.read` | **Not done** — no functional Role carries relocate; Owner grant decision |
| 5 | Racking generated in Administration → Warehouse Racking (BIN-P3) with the **real** aisle/bay/position layout | **Onsite fact required** — the Phoenix layout is not in the repository and is not invented here |
| 6 | Labels printed and fixed to the racking (BIN-P5) | Needs C-1 bay width, C-2 area codes, C-4, C-5 |
| 7 | A quiet window agreed with the warehouse (conversion tolerates concurrent activity, but a quiet window makes the report short) | Operational |

## Inputs the operator must supply (not fabricated)

1. The warehouse id being converted (for Phoenix, the governed `warehouses/{id}` document id).
2. The Area codes, aisle letters, bays per aisle and positions per bay as physically built (C-2).
3. Bay width / label size (C-1) and the label stock (C-4/C-5).
4. The conversion start time (ISO, UTC) — written down **before the first scan**.
5. Who is doing the conversion (each already holding the granted Role from precondition 4).

## Procedure

1. **Record the start time.** e.g. `2026-09-15T13:00:00Z`. Everything before it is the "before" picture.
2. **Put stock away aisle by aisle** with Scan → Move stock: select the warehouse, *From* = the warehouse
   floor, *To* = scan the bin label, scan every item going into that bin, confirm. Each line reports its own
   result; anything that did not move is shown and is **not** silently retried.
   - Serialized units: scan the serial when prompted. The unit's custody moves with it.
   - Lot-tracked or unmapped parts show **Not supported here** and are left on the floor — record them.
   - Insufficient stock on a line means the warehouse ledger says fewer exist than are physically there.
     **Do not force it.** Note the part; it is a Cycle Count matter for after conversion, not a conversion
     step.
3. **Reconcile** (read-only, any number of times, during and after):

   ```bash
   node scripts/binConversionReconciliation.mjs --projectId eos-platform-sandbox --warehouse <warehouseId> --start 2026-09-15T13:00:00Z
   ```

   Run from `functions/` after `npm run build`, using the operator's existing `gcloud auth login`. The script
   refuses `taylor-parts` by name and creates no credential.
4. **Read the report.** Per part: `before`, `after`, `reloc` (must be 0), `other` (real activity during the
   window — receipts, job consumption, transfers), `binned`, `direct`.
   - `BALANCED` (exit 0): for every part, relocation contributed nothing and the aggregate change equals the
     explained concurrent activity.
   - `NOT BALANCED` (exit 2): a part moved in a way relocation cannot explain, or a row names a bin that does
     not resolve to this warehouse. **Stop and investigate before continuing**; nothing is corrected by script.
5. **Declare the warehouse converted** only when the report is `BALANCED` **and** `direct` is 0 for every
   part that physically lives in bins (stock deliberately kept unbinned — oversize, floor stock — stays
   `direct` and is listed by name in the completion record).
6. **Pass the Bin conversion gate** (BIN-P7) with the report you reviewed — note its `report sha256`:

   ```bash
   node scripts/completeBinConversion.mjs --projectId eos-platform-sandbox --warehouse <warehouseId> --start <start> --end <end> --expect-report <sha256>
   ```

   It re-runs the reconciliation and writes `warehouse_bin_conversions/<warehouseId>` = `CONVERSION_COMPLETE`
   **only** if that exact report balances. If anything moved since, the hash differs and nothing is written —
   reconcile and review again. Only after this may that warehouse's Bins be cycle counted
   ([spec](../specifications/bin-cycle-count-eligibility.md)).
7. **Completion record:** attach the final report output, the start/end times, the operators, and the list
   of deliberately-unbinned and not-supported parts to the program record.

## Why the report is trustworthy

- Parentage comes only from `bins/{id}.warehouseId` (never a code prefix).
- Quantity uses the one sign rule (`locationOnHand.signedQuantity`) every other reader uses.
- Proved on the emulator end to end: `functions/test/binConversionReconciliation.test.mjs` receives 12, puts 7
  away through `relocateStock`, moves 2 between bins, and requires the script to print `12 12 0 0 7 5 yes`.

## Current status

**REPOSITORY COMPLETE / SANDBOX READY TOOLING / PHYSICAL CONVERSION PENDING.** BIN-P4 (activation + Roles) is
merged (#1838). Still pending: the operator-run sandbox deployment, per-employee Role grants, and the onsite
facts for the pilot aisle ([pilot worksheet](bin-phoenix-pilot-worksheet.md)).
