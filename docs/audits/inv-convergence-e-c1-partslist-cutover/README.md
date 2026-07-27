# INV-CONVERGENCE-E C1 — PartsList cutover evidence

Sanitized evidence for the C1 unit: replace the **Inventory > Parts** catalog's
identity/metadata source from the static `PARTS_CATALOG` to the **governed
compatibility-adapter output** (live canonical `parts` composed with the static
catalog via `buildPartsWorkspace()`), while preserving all 200 visible records,
every Part ID/route, ledger overlays, reorder analytics, and Global Search.

**Draft, repository-only. No deployment. No production data or credentials touched.**

## What changed (frontend only)
- **NEW** `field-ops-app-vite/src/domain/partsCatalogView.js` — pure
  `buildPartsCatalogRows({canonicalRead, staticCatalog}) → {status, rows, meta}`.
  Reuses the governed `buildPartsWorkspace` composition (the same one Stage A's
  `buildShadowModel` uses); enforces "all 200 accounted, or BLOCKED" (never a silent
  partial); BLOCKED_PERMISSION / BLOCKED_UNAVAILABLE / BLOCKED_INCOMPLETE_INPUT with
  `rows: []`, never an empty list presented as success, never a silent static fallback.
- **MODIFIED** `field-ops-app-vite/src/modules/inventory/PartsList.jsx` — reads
  canonical `parts` once (PR 1.9 `fetchPartMasterList`, no new query surface),
  composes the catalog via `buildPartsCatalogRows`, and repoints the catalog table,
  categories, filter counts, and Global Search seed at the composed rows. Reorder-queue
  name lookups resolve via the composed rows with a static `getCatalogItem` fallback
  (so those Firestore-backed workflows never regress to raw partId). Adds explicit
  loading / BLOCKED / READY rendering for the Parts Catalog section.
- **NEW** `field-ops-app-vite/test/partsCatalogView.test.mjs` (19 assertions) +
  registered in `field-ops-app-vite/package.json` test chain.

## Preserved (unchanged)
`PartDetail.jsx` (still static `getCatalogItem` — C1/PartDetail boundary), the
`/inventory/:partId` route, `useInventoryLedger` and the health overlay (keyed by
partId==sku), every reorder/PO/receiving/cancellation/voiding workflow, the
GlobalSearch parts provider, the compatibility adapter, and the static catalog +
Functions mirror (no removal, no restructure). Route key stays `sku`==`partId` so
every catalog/search/reorder link lands on the identical PartDetail.

## Files
- `test-summary.txt` — new suite (19/19), full client chain (exit 0), lint, build, build-base guard.
- `parity.txt` — deterministic offline parity (200/190/10, 0 divergence) + live-parity provenance (Decision #46).
- `diff-scope.txt` — exact changed files + the zero-change list.
- `rollback.md` — pure code revert, no data effect.
- `SHA256SUMS.txt` — manifest (verify with `sha256sum -c`; excludes itself).

## Key behavioral change (for Owner + ChatGPT review)
Before C1, the Parts Catalog **always** rendered 200 static rows regardless of
Firestore access. After C1, identity flows through the canonical read, so a
denied/unavailable/incomplete canonical read **BLOCKS the catalog** (0 rows + a clear
banner) rather than showing static data. This is the intended governance posture
("never a silent static fallback") and mirrors `PartMasterList.jsx`. For the READY
path (admin/dispatcher/PARTS_MANAGER/WAREHOUSE_MANAGER post-Stage-B) all 200 remain
visible. This is the one deliberate resilience trade-off; flagged for confirmation.

## Boundaries
C1 only; PartDetail source unchanged; no C2. No deployment, no production data/identity
mutation, no Rules/Functions/index/config edits, no static-catalog/Functions-mirror
removal, no parallel Parts source of truth. Decisions #43–#46 unchanged.
