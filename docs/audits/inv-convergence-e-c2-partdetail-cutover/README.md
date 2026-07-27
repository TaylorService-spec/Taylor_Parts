# INV-CONVERGENCE-E C2 -- PartDetail cutover (evidence)

Repository-only cutover of the Inventory > Parts **detail** page from static catalog
data to the governed canonical compatibility-adapter output. Draft for Codex review.

- **Commit:** `94e322e5299e56e67fa8c8b99e46558d56a62502`
- **Base:** `origin/main` @ `f97edf1` (C1 Hosting deployment evidence merged)
- **Gate:** Stage C / C2. C1 (PartsList) is merged and its Hosting deployment gate is
  closed. **No deployment is performed or authorized here.**

## The contract this implements

From `docs/implementation-plans/inv-convergence-e-shadow-read-and-convergence.md`,
Stage C:

> **C2 — PartDetail** (highest risk — its own gate, after C1) — re-point
> `getCatalogItem` metadata and the `t.partId === partId` ledger filter **together**;
> preserve the full reorder/PO/receive/cancel/void/inventory-action write surface
> unchanged.

Both re-points ship in this single unit. That pairing is the point of the contract:
re-pointing metadata alone would let a page render canonical identity beside a
differently-keyed ledger.

## What changed

| # | Change | File |
|---|---|---|
| 1 | **Metadata re-point.** `getCatalogItem(partId)` replaced by the pure `buildPartDetailView({canonicalRead, staticCatalog, partId})`, composing the live canonical `parts` read with the static compatibility catalog through the existing `buildPartsWorkspace()` adapter. | `src/domain/partDetailView.js` (new), `src/modules/inventory/PartDetail.jsx` |
| 2 | **Ledger re-point.** `t.partId === partId` and the `healthEntries` lookup moved into `selectPartLedger({transactions, healthEntries, resolvedPartId})`, keyed on the **resolved governed identity**, not the raw route param. Same equality test, same sort, same 20-row cap. | `src/domain/partDetailView.js`, `PartDetail.jsx` |
| 3 | **Shared guard extraction.** C1's fail-closed precedence ladder + full-accounting invariant lifted out of `buildPartsCatalogRows` into `composeGovernedPartsWorkspace()` so C1 and C2 share **one** implementation. Behavior-neutral: C1's 23/23 pass unchanged. | `src/domain/partsCatalogView.js` |
| 4 | Test registration. | `package.json` |
| 5 | New test suite (34 cases). | `test/partDetailView.test.mjs` (new) |

**No competing Parts source was created.** The canonical `parts` collection stays
authoritative; the static catalog stays the compatibility *input* to the governed
adapter; the read reuses PR 1.9's `fetchPartMasterList` — **no new query surface**.

## Preserved (verified, not asserted)

All 200 Part IDs and their `/inventory/:partId` routes (key remains `sku == partId`),
the ten approved static-only Parts, Global Search → route → detail continuity,
`useInventoryLedger`, the inventory ledger, truck inventory, usage history, reorder,
Procurement, Work Order, manufacturer, alias, and supplier relationships, and the
static catalog + Functions mirror. Part remains under Inventory Management. No Parts
data was migrated, renamed, restructured, deleted, or rewritten.

## Fail-closed posture

Denied / unavailable / malformed / incomplete canonical input yields
`BLOCKED_PERMISSION` / `BLOCKED_UNAVAILABLE` / `BLOCKED_INCOMPLETE_INPUT` with
`part: null` and **no page body at all** — including no write surface. An omitted or
duplicated canonical Part blocks rather than silently falling back to static. There is
**no silent static fallback and no partial success** anywhere in the matrix
(see `parity.txt`).

A `BLOCKED_*` is never reported as the pre-existing `Unknown part` copy; that copy is
now reserved for a genuinely unknown id under a fully verified catalog (`NOT_FOUND`,
still rendered as before).

## Disclosed behavior changes (2) — for reviewer attention

1. **Unit token.** The Catalog card rendered the raw static token (`"ea"`); it now
   renders the canonical normalized stocking code (`"EACH"`). Verified for all 200
   that the rendered unit equals `normalizeUnit(static unit)`, and Stage A measured
   `UNIT_DIVERGENCE = 0` in production — the meaning is unchanged, only the displayed
   token. Canonical is authoritative on divergence by contract.
2. **Blocked page.** A denied/unavailable/incomplete canonical read now blocks the
   detail page instead of rendering static metadata — the same posture C1 shipped for
   the list.

Commercial + availability fields (`cost`, `price`, `reorderThreshold`, `warehouseQty`)
remain unchanged `STATIC_FALLBACK` values pending UD-3/UD-4, per the authority contract.

## Verification

| Gate | Result |
|---|---|
| `test/partDetailView.test.mjs` | **34 passed, 0 failed** |
| `test/partsCatalogView.test.mjs` (C1 regression) | **23 passed, 0 failed** |
| Full client chain (`npm test`) | **exit 0** |
| `npm run lint` | **exit 0** — pre-existing warnings only, zero findings in C2 files |
| `npm run build` | **exit 0** |
| `npm run verify:build-base` | **12 passed, 0 failed** |

Test coverage spans backward compatibility, routing, parity, and blocked states as
required: all 200 ids resolve and are never rewritten; every C1 route resolves; unknown
id → `NOT_FOUND` not `BLOCKED`; ledger slices byte-identical to the pre-C2 raw-param
filter for all 200; the full fail-closed matrix; and purity/non-mutation.

## Scope boundaries honored

Zero Rules / Functions / index / config changes. No deployment. No Firestore, Firebase
Auth, identity, role, claim, or production-data mutation. No Customer/Auth overlap.
Decisions #43–#46 unchanged. Stops before any separate Hosting deployment gate.

## Files

| File | Purpose |
|---|---|
| `README.md` | this summary |
| `diff-scope.txt` | exact changed-file accounting for the functional commit |
| `parity.txt` | identity / routing / field / ledger parity + fail-closed matrix |
| `test-summary.txt` | captured test, lint, build, and build-base results |
| `rollback.md` | revert procedure and blast radius |
| `SHA256SUMS.txt` | checksums of the five files above |
