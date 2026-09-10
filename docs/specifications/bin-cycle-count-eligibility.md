---
title: BIN-P7 — Cycle Count admits BIN behind the Bin conversion gate
status: Approved (Owner ruling B4, Decision #178) — implemented
plan: ../implementation-plans/bin-location-authority-and-scanning.md (BIN-P7, gate E)
depends_on: BIN-P6 (Decision #170), bin conversion runbook (../runbooks/bin-warehouse-conversion.md)
---

# BIN-P7 — Cycle Count admits BIN behind the Bin conversion gate

## 1. The problem gate E exists for

Before a Warehouse is converted, stock that physically sits in a bin is still recorded **direct** at the
Warehouse. Counting that bin would find stock the ledger does not place there, book it as a positive
variance, and an approved `ADJUSTED +N` would count it a second time. So a Bin may be counted only once
its Warehouse has *actually* moved to authoritative Bin custody and the move reconciled.

## 2. Reconciliation against what exists

| Candidate authority | Suitable? | Why |
|---|---|---|
| `warehouses/{id}.status` | **No** | It is the Receiving location-eligibility authority (ACTIVE/INACTIVE, I-LA C2). Its shape is locked by `validateGovernedWarehouse`, shared by Receiving, Transfer, the status writer, the governance verifier and Reorder. "Converted" is a different fact with different evidence. |
| An Administration setting | **No** | Owner ruling: no "Allow Bin counting" checkbox. An Admin edit must not be able to mark a Warehouse converted. |
| A new server-owned record | **Yes — the smallest one** | `warehouse_bin_conversions/{warehouseId}`. Absent = `NOT_CONVERTED`; the single stored state is `CONVERSION_COMPLETE`. No `firestore.rules` match block, so every client is denied by default. |

This is not a second Warehouse configuration registry: it holds one proved fact per Warehouse and the
evidence it was proved on, and nothing configures it.

## 3. Passing the gate

Only `functions/scripts/completeBinConversion.mjs` writes the record. It:

1. re-runs the same reconciliation as the read-only `binConversionReconciliation.mjs`
   (`functions/src/inventoryLedger/binConversionReport.ts` — shared, so the gate is passed on exactly the
   report that was reviewed);
2. requires `--expect-report <sha256>` — the hash of the report the operator reviewed; if the ledger moved
   since, nothing is written;
3. refuses unless, for every part, `relocationNet == 0` **and** `aggregateAfter − aggregateBefore ==
   explained other activity`, with no unresolved bin and no malformed ledger row
   (`buildConversionCompletion` throws otherwise);
4. writes create-only, in a transaction, with the evidence (report hash, window, part count, binned /
   direct / explained totals) and the operator's identity;
5. refuses `taylor-parts` by name. Production conversion needs its own authorization (and, then, a
   governed callable with an Owner-ruled capability — deliberately not invented here).

Stock deliberately left unbinned (floor stock, oversize) stays direct. It is recorded in the evidence
and named in the runbook's completion record; it does not block the gate.

## 4. Cycle Count eligibility policy

`CYCLE_COUNT_LOCATION_TYPES` gains `BIN` — **shape only**. Whether a particular location may be counted is
the command-time policy `makeResolveCycleCountLocationEligible`
(`functions/src/cycleCount/cycleCountLocationEligibility.ts`), pinned by the production composition so no
caller can substitute a permissive resolver. For a BIN, all four conditions, each failing closed:

1. the Bin is valid and ACTIVE at the current schema;
2. its governed parent Warehouse (`bins/{id}.warehouseId`, never the code) resolves and is ACTIVE;
3. that Warehouse has passed the Bin conversion gate;
4. the caller holds the existing Cycle Count capability (the command's own authorization — unchanged).

WAREHOUSE and MOBILE are unchanged. A refusal is the existing `LOCATION_INVALID`.

## 5. Expected quantity

Unchanged code, now proved for BIN: `computeExpectedQuantityThroughTxn` matches the **exact** location
(type and id) through the one sign rule (`locationOnHand.signedQuantity`). Counting Bin A therefore
expects Bin A's quantity — never direct Warehouse stock, never Bin B, never the roll-up. `RELOCATION_OUT`
at the source and `RELOCATION_IN` at the bin are exactly what put the quantity there, so relocation
cannot distort it. Serialized: the units whose `serialized_assets.currentLocationId` is the Bin.

A **WAREHOUSE** count expects the direct (unbinned) term only. That was already the behaviour and is now
stated: after conversion, a Warehouse count is a count of the floor, not of the building.

## 6. Unchanged

Counting is observation; reconciliation is the only adjustment authority, and an approved variance adjusts
the counted Bin only. Blind count and separation of duties (Decision #111) are unchanged. No capability,
Role, Rules or index change.

## 7. Evidence

- `functions/test/binCycleCountEligibility.test.mjs` (11/11, emulator, production composition): shape
  admitted; refused before conversion; conversion through `relocateStock` reconciled and recorded only from a
  balanced report; unbalanced and malformed-row reports refused; exact-Bin expected quantity (4 / 3 / direct 3
  of 10); serialized identity per Bin; reconciliation adjusts only the counted Bin; gate is per Warehouse;
  inactive bin, malformed record and unknown bin refused.
- Existing suites unchanged: `cycleCountCommand` 20/20, `scannerEndToEndContract` 17/17,
  `warehousePhysicalRootCompany` 17/17, `certificationCycleVariance` 27/27.
