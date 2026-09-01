# FIN-006 — Cost & Margin Authority (F5)

**Status:** margin invariant core IMPLEMENTED (repository, dormant); the entire cost-fact
supply is an UNDECIDED Owner decision set (FIN-BLOCK-003) and no cost is captured anywhere.
Recorded 2026-09-01, overnight financials run phase F5.
**Authority sources composed:** DECISIONS #145/#154; FIN-001 §1.3 (GROSS_MARGIN_AUTHORITY =
MISSING); ND-27 (`PART_INVENTORY_VALUATION_AUTHORITY_GAP`); technician-labor-domain v1
(hours-only by ratified design).

## 1. The one implemented invariant

`functions/src/finance/costMargin.ts` (`deriveGrossMargin`) is the canonical margin
derivation every future consumer (F12 Gross Margin surface, F13 reporting, dashboards,
exports) must compose:

> **Margin is computed ONLY from governed cost facts.** A revenue line with no matched
> governed cost fact makes the whole margin **UNKNOWN — with no number at all** (`costMinor`
> / `marginMinor` = null). Never "revenue − 0". Never a supplier quote borrowed as cost.
> Never a partially-costed margin presented as computed. Revenue (governed) is still
> reported; the margin is not.

Mechanics: closed status set `COMPUTED | UNKNOWN`; a governed cost fact = integer
`costMinor` + `costBasis` + `sourceType` + `sourceRecordId` (every number says where it came
from); malformed facts are THROWN caller defects (silently dropping one would shrink the
margin); orphan facts (no matching revenue line) force UNKNOWN; a negative margin is a
legitimate COMPUTED result. Mirrors the equipment-availability UNKNOWN-fail-closed
precedent.

Because no governed cost fact exists anywhere in the repository today (FIN-001 §1.3), every
real invocation returns UNKNOWN — which is the truthful current answer to every margin
question.

## 2. What is deliberately NOT decided — the cost supply (FIN-BLOCK-003)

1. **Costing method / basis vocabulary** — receipt/landed cost vs standard vs average vs
   last; which bases are margin-admissible. (`part_supplier_items.cost` is a quote/term —
   FIN-001 rules it non-authoritative for margin.)
2. **Capture point** — where a cost EVENT is recorded: receiving (`ReceivingLineValue`
   carries no price today, deliberately), the Epic-5 PO price layer (status
   UNKNOWN_REQUIRES_DECISION — orphaned or future basis?), or a new record.
3. **Labor cost** — rates do not exist and hours ≠ cost by ratified design; whether/how
   labor enters service margin is a policy decision (composes FIN-BLOCK-002's rate question).
4. **Valuation authority** — ND-27's Part inventory valuation gap: freight/landed
   allocation, revaluation, and the relation to any external accounting authority
   (DECISIONS #145: authority of record not yet selected).

Until ruled, no code path may fabricate a cost; the derivation core makes that structurally
impossible to do quietly.

## 3. Consumer contract

- Compose `deriveGrossMargin`; never subtract ad-hoc numbers from revenue.
- Display UNKNOWN as unknown (no 0%, no blank-as-zero); reasons name the uncosted lines.
- FIN-004 visibility governs who may see margin at all; FIN-002 attribution dimensions
  (company/BU/person) apply to cost facts exactly as to revenue.
