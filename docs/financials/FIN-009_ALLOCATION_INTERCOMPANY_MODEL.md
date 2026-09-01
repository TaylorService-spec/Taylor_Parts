# FIN-009 — Allocation & Intercompany Governance (F10)

**Status:** allocation arithmetic + honest consolidation IMPLEMENTED (repository, dormant);
intercompany treatment + elimination policy is an UNDECIDED Owner decision (FIN-BLOCK-004)
— elimination logic is prohibited to invent (FIN-001 FIN-GAP-011 / Owner ruling D-3).
Recorded 2026-09-01, overnight financials run phase F10.

## 1. Implemented (policy-free)

`functions/src/finance/financialAllocation.ts`:

- **`allocateAmountExactly`** — exact integer allocation: one amount split across weighted
  targets, parts summing EXACTLY to the whole (largest-remainder, deterministic, credits
  allocate symmetrically; a cent that vanishes in allocation is a reconciliation failure by
  construction). WHAT is allocated by WHICH weights (shared labor, overhead, freight) is
  Owner policy; this is only the arithmetic every such policy must use.
- **`summarizeByCompany`** — per-company totals for company-stamped facts (a company-less
  fact refuses the rollup — FIN-002), plus a consolidated figure whose TYPE is
  `UNELIMINATED_SUM`: an arithmetic sum that has removed NO Taylor↔Ventana activity and
  says so. No code path can present a consolidated figure as eliminated.

## 2. Undecided — FIN-BLOCK-004

Whether intercompany activity is modeled as ordinary supplier transactions (Owner ruling
D-3: Ventana is an upstream SUPPLIER to Taylor, not a peer franchise) or as governed
intercompany events; the consolidation/elimination policy; cross-company customer work
treatment; and the fate of the 8 cross-company-ambiguous ledger records FIN-001 measured.
Until ruled: no intercompany record type, no elimination, consolidated figures stay
labeled uneliminated.

## 3. Composition contract

F13 reporting's Company axis uses `summarizeByCompany` (Consolidated column =
UNELIMINATED_SUM, displayed with that caveat); any future shared-cost policy (FIN-006
freight/labor allocation) uses `allocateAmountExactly`; FIN-010 reconciliation checks
allocation exactness by re-summing.
