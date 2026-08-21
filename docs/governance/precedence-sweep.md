# Precedence sweep — role authority, 2026-08-21

Ordered before PASS. The reconciliation had asked whether each mapping was **semantically** right —
does this capability govern this object. This asks the later question: even where the mapping is
correct, **did someone already decide who holds it?** A correct mapping applied over a recorded
decision is still a governance regression, and no semantic guard can see it.

**Precedence order (Owner, 2026-08-21):**

1. explicit Owner governance decision
2. canonical reconciled business-intent matrix (Detailed CRUD)
3. historical / current implementation
4. stale or generated summaries

Later Owner decisions outrank earlier ones. **Matrix silence is not denial.**

## Forward sweep — 180 role/capability pairs, 17 roles

| Classification | Count |
|---|---|
| `CANONICAL_MATRIX` | 118 |
| `EXPLICIT_OWNER_DECISION` | 56 |
| `WORKFLOW_REQUIRED` | 4 |
| `LEGACY_COMPATIBILITY_ONLY` | 2 |
| **`UNJUSTIFIED`** | **0** |

Machine-readable: `docs/governance/precedence-sweep.json`. Regenerate with
`node functions/scripts/governance/precedenceSweep.mjs`.

**The four `WORKFLOW_REQUIRED`** are capabilities with no CRUD cell and no composition, held because
a recorded Owner direction describes a **sequence** rather than one write. The matrix models objects;
it will never contain a cell for a workflow.

- `purchasingManager` → `reorder.request.read.queue` / `.startPurchasing` / `.recordPurchaseOrder` —
  Owner roster 2026-08-20 and the ruling of 2026-08-19 ("Purchasing falls under accounting"):
  *see what needs buying, take it into purchasing, record the resulting Purchase Order, keep it
  current.* Granting create without the queue read produces a buyer who cannot see what needs buying.
- `fieldManager` → `workOrder.cancel` — Spec §26.2: Service Manager holds the **full** Work Order
  lifecycle, and cancel is part of that lifecycle.

**The two `LEGACY_COMPATIBILITY_ONLY`** are `dispatcher` and `technician`: workbook roles implemented
as compatibility roles. The Owner ruled they are **not** to be reduced; they are out of scope.

## Reverse sweep — "which decisions should produce authority a Role may now be missing?"

Every guard in this repository ran one direction only: *does a Role hold more than allowed*. None
asked *does a Role hold less than a decision requires*. That direction was swept for the first time.

**Result: 0 missing decided mappings.** Verified live against the built role definitions:

- **#114** — all nine listed additions present across five roles; "every manager Role holds
  `account.record.read`" true for all twelve; the Operations Manager asymmetry
  (`account.record.create` yes, `.update` / `governedField.write` no) intact.
- **#113** — `fulfillment.coordinatedVisit.read` held by exactly `admin, dispatcher, fieldManager,
  operationsManager, owner`; all 31 governed roles present in `GOVERNED_ASSIGNABLE_ROLE_IDS`;
  `owner ≥ admin` holds.

### One candidate finding, and why it was wrong

The sweep first reported the **#114 Accounting/Finance parity** as broken: the reconciliation widened
Accounting Manager from 4 capabilities to 17 while Finance Manager stayed at 4, and #114 says the two
are identical *"by raising Accounting to Finance, not by lowering Finance."* Finance was raised to 17
to restore it.

**That was a precedence error of exactly the kind this sweep exists to catch.** #114 says *"FOR
NOW"*. The Owner ruling of 2026-08-19 — "Purchasing falls under accounting" — **ends** the parity
explicitly and replaces it with an **ordering**: *Accounting retains everything Finance holds, and may
now hold more.* Raising Finance would have handed it the entire purchasing workflow on the authority
of a superseded decision. The change was reverted; Finance stands at 4, Accounting at 17, and
`accounting ⊇ finance` holds.

The lesson generalises: **reading a decision without checking what superseded it produces a change
that cites governance while contradicting it.** It is recorded in the guard itself so the next sweep
does not rediscover the parity and "restore" it again.

## Unguarded decisions, ranked

| Rank | Decision | Status |
|---|---|---|
| SECURITY_CRITICAL | Owner ruling 2026-08-19 — Marketing Manager is a **peer** of Sales Manager (same parent), and the 2026-08-19 correction placing Sales beside Operations rather than beneath it | **now guarded** |
| HIGH | #78 / 2026-08-19 — no `supplier.*`, `marketing.*` or `commission.*` capability is invented to complete a CRUD row | **now guarded** |
| NORMAL | #113 — `inventoryCreateExecutor` unassigned until its recipient is presented | runtime assignment; belongs to the grant plan, not the repo |
| NORMAL | #56 — `admin.credentialReset.initiate` inactive, ungranted | already guarded (4 suites) |
| NORMAL | #111 / #116 / #117 / #118 | already guarded (2–4 suites each) |

**Why the hierarchy one is security-critical.** A parent is one string. Changing it breaks no build,
fails no test, and renders identically — while moving an entire branch inside another branch's
visibility. Placing Marketing under Sales would put every salesperson inside Marketing's visibility
and Marketing inside the Sales Manager's. It was recorded in a code comment and a commit message,
and asserted nowhere.

**Why the invented-capability one is high.** It is not an escalation; it is quieter. A symmetry-only
permission makes a Role *look* authorized while nothing enforces it — authorized in every report,
every audit and every UI gate, and granting nothing. The honest form is a recorded gap.

## Mutation proof

Every guard added here was proven able to fail, then restored.

| Guard | Mutation | Result |
|---|---|---|
| Accounting ⊇ Finance ordering | remove `account.governedField.write` from `accountingManager` | RED → restored GREEN |
| peer branch heads | reparent `marketingManager` under `salesManager` | RED (3 predicate families: parent, cross-visibility, descendancy) → restored GREEN |
| uninvented capabilities | register `supplier.manage` in the permission catalog | RED → restored GREEN |

The hierarchy mutation was additionally checked in isolation: a pre-existing test failed first and
short-circuited the file, so the new guard's own predicates were evaluated directly against the
mutated build to confirm the guard — not its neighbour — catches it.

## Sweep result

- `UNJUSTIFIED`: **0**
- missing decided mappings: **0**
- security-critical precedence conflicts: **resolved** (the one found was the sweep's own candidate
  fix, reverted)

**No grants issued. No capability activated. No Rules changed. Production untouched.**
