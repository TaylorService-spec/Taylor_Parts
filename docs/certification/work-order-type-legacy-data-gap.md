# `WORK ORDER TYPE LEGACY DATA GAP`

**Status: RECORDED. Not corrected, not migrated.** Found 2026-08-23 while gating the technician
closeout installation on Work Order type.

---

## What is there

`WorkOrderType` is a closed union:

```ts
"SERVICE_CALL" | "PM" | "INSTALL" | "WARRANTY" | "INSPECTION"
```

The live sandbox holds 20 work orders:

| `type` | count | in the union? |
|---|---:|---|
| `INSTALL` | 5 | yes |
| `SERVICE` | 7 | **no** |
| *(absent)* | 8 | **no** |

So **15 of 20** carry a value the type contract does not define.

## Why it is not being fixed here

Three plausible corrections, and choosing between them is a data decision, not a code one:

- `SERVICE` was probably meant to be `SERVICE_CALL` — probably. Nobody has confirmed it, and
  rewriting seven records on an inference is how a wrong guess becomes indistinguishable from a fact.
- The eight untyped records may predate the field entirely, in which case they need a default that
  somebody chooses rather than one that happens to be first in the union.
- Some may be fixture debris that should be removed rather than typed.

Mass-correcting them inside a slice about installing machines would bundle a data migration into
unrelated work, with no record of the decision.

## How the installation path handles it — safely, without correcting anything

The closeout installation is gated on `type === "INSTALL"` **exactly**, and every other value is
refused with `WORK_ORDER_NOT_INSTALL_TYPE`:

- `"SERVICE"` → refused
- absent → refused
- `"install"` (wrong case) → refused

Asserted directly, because the tempting failure is the other direction: treating an unknown or
missing value as "probably an installation" would place machines at customers on jobs nobody
classified. A missing type is not a permissive default; it is an unanswered question.

The UI applies the same rule, so the section is not even offered on a job the server would refuse.

## What a fix would need

1. A decision on what `SERVICE` means and whether it becomes `SERVICE_CALL`.
2. A decision on what an untyped work order is.
3. A bounded, dry-run-first migration in the shape the equipment-model migration already established:
   preflight everything, refuse to apply if any record cannot be mapped deterministically, and name
   the out-of-scope records individually rather than summarising them away.
4. Ideally, a validator on the write path so the union stops being advisory.

Until then the data is wrong in a known, bounded, documented way, and nothing reads it permissively.
