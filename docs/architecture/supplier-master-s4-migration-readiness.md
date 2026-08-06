# Supplier Master — S4 Purchasing Integration & Migration Readiness

**Status:** Sandbox-verified, repo-only. **No production rewrite. No Rules/Functions deploy.**
**Program:** Supplier Master adoption (Tier-2, DECISIONS #78). **Phase:** S4.

## Goal

Link existing `reorder_purchase_orders` records (the one live Purchase Order authority) to the
governed **Supplier Master** identity by deriving two additive fields — `supplierId` (the governed
match, when unambiguous) and `supplierNameSnapshot` (the historical free-text `supplierName` preserved
verbatim) — **without** rewriting production data and **without** disturbing the existing free-text
`supplierName` (which remains the historical authority and stays fully readable).

## What S4 delivers (inert, dry-run only)

- **`functions/src/supplierMaster/reorderPurchaseOrderSupplierCompatibility.ts`** — pure, never-throws
  compatibility layer (same discipline as `workOrderSnapshotCompatibility`): builds a
  `normalizedKey → {activeIds, inactiveIds}` index over the governed suppliers and derives one
  `SupplierLinkage` per PO. It **adds identity only when resolvable**; it never mutates or backfills.
- **`functions/src/supplierMaster/reorderPurchaseOrderSupplierMigration.ts`** — deterministic
  `planSupplierLinkageMigration` (pure: classification, counts, `needsResolution`, opaque
  `planFingerprint`) plus Admin-SDK **read-only** loaders and a `dryRunSupplierLinkageMigration`
  entry point. **Writes nothing.**

## Classification taxonomy & auto-link policy

| Classification | Meaning | `supplierId` | Migration action |
|---|---|---|---|
| `EXACT` | exactly one **ACTIVE** governed supplier matches the normalized name | set | auto-linkable |
| `AMBIGUOUS` | more than one ACTIVE supplier shares the normalized name (a duplicate) | null | **human resolution** — never auto-link |
| `INACTIVE` | no ACTIVE match, but an INACTIVE supplier matches | null | **human resolution** — not linkable for active purchasing |
| `UNMATCHED` | no governed supplier matches | null | candidate for governed supplier creation |
| `HISTORICAL` | record has no usable `supplierName` | null | readable history; nothing to link |

Only `EXACT` auto-links. `AMBIGUOUS`/`INACTIVE` are collected into `plan.needsResolution` and must be
resolved by a human before any real run — consistent with the dedup **detection-not-auto-merge**
policy from S2. `supplierNameSnapshot` is always the verbatim historical string (or `null`).

## Sandbox verification (evidence)

- **Offline unit tests** — `functions/test/reorderPurchaseOrderSupplierLinkage.test.mjs` (9):
  index grouping/key-recompute/sorting, every classification, verbatim snapshot preservation,
  `supplierId` only on an unambiguous ACTIVE match, deterministic plan counts, fingerprint
  determinism + drift, and no input mutation. Run: `npm run test:supplierLinkage`.
- **Emulator dry-run** — `functions/test/reorderPurchaseOrderSupplierMigrationEmulator.test.mjs` (3):
  seeds synthetic suppliers + reorder POs across all classes, runs the dry-run against live reads,
  asserts the counts/linkage, and **proves the dry-run wrote nothing** (every seeded PO is
  byte-identical afterward — no `supplierId`/`supplierNameSnapshot` added). Run under the Firestore
  emulator: `firebase emulators:exec --only firestore --project taylor-parts "node functions/test/reorderPurchaseOrderSupplierMigrationEmulator.test.mjs"`.

## Integration finding — the protected Rules gate (do not bypass)

The live `reorder_purchase_orders` **create** Rule pins its fields with
`request.resource.data.keys().hasOnly([...])`, and that allowlist does **not** include `supplierId`
or `supplierNameSnapshot` (`firestore.rules`, `match /reorder_purchase_orders/{requestId}`).
Therefore **persisting** the derived linkage — by the client writer *or* by a real migration —
is impossible until the Rules allowlist is widened. That is a **protected production Rules
deployment** and is **not** part of S4.

## Deferred to promotion / backlog (each separately authorized)

1. **`reorder_purchase_orders` Rules delta** — add `supplierId` + `supplierNameSnapshot` to the
   create `hasOnly` allowlist with appropriate type/optionality validation. *Protected Rules deploy.*
2. **Forward-compat client writer** — once (1) lands, have `recordPurchaseOrder`
   (`field-ops-app-vite/src/domain/reorderPurchaseOrders.js`) persist `supplierNameSnapshot` on new
   POs. *Additive; depends on (1).*
3. **Governed supplier picker** in the reorder flow to populate `supplierId` at creation time
   (replacing free-text entry for new POs). *Future UI workstream.*
4. **Real migration execute** — a manifest-gated, fail-closed execute step that writes the derived
   linkage for existing POs. *Protected; depends on (1); mirrors the warehouse-migration
   manifest/execute pattern.*

## Rollback

- **Dry-run:** nothing to roll back — it writes nothing.
- **Eventual real run:** both fields are **additive**; rollback = delete `supplierId` and
  `supplierNameSnapshot`. The historical `supplierName` is never modified, so a rollback restores the
  exact prior state.
