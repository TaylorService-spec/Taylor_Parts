# Supplier Master Architecture (S1 — architecture & domain reconciliation)

**Status:** S1 DESIGNED — architecture/domain reconciliation for the Owner-authorized Supplier Master adoption program (Tier-2). Repository-only; **no code, Rules, deploy, grant, or migration** is implied by this document. Subsequent phases (S2 backend, S3 workspace, S4 purchasing integration, S5 release candidate) implement against it.
**Related / reuses:** `docs/architecture/ADR-008` (Part Master) · `functions/src/partMaster/partMasterCommands.ts` (trusted-command machinery) · `functions/src/partMaster/partSupplierItems.ts` (governed part↔supplier authority) · `access/permissionCatalog.ts` (`inventory.catalog.*`) · `functions/src/partMaster/workOrderSnapshotCompatibility.ts` (snapshot convention). Reconciled against the R-1 authorization-convergence program.

## 1. Objective and boundary

Establish **Supplier as a governed business object** so Purchasing stops depending on free-text `supplierName`. Target chain: **Supplier Master → governed Supplier identity → supplier terms/relationships (via the existing `part_supplier_items`) → Purchasing references `supplierId` → a human-readable `supplierNameSnapshot` retained for history/display.**

**Active-flow boundary (Owner-directed):** the current, active purchasing flow is `reorder_purchase_orders` (written by `domain/reorderPurchaseOrders.js`). The dormant Epic-5 `purchase_orders` is **not** revived or made authoritative by this program. There is exactly **one** live Purchase Order authority (`reorder_purchase_orders`).

## 2. Collection reconciliation (the material clarifications)

| Collection | Role | Disposition in this program |
|---|---|---|
| `suppliers` (Epic-5) | free-text-era supplier list `{name, contactEmail, leadTimeDays}`, read-only Rules, no write path, inert | **Adopt the collection name for the governed Supplier Master** (S2 defines the governed §-shape + trusted writer). Legacy inert docs are reconciled by the S4 migration design, not silently trusted. |
| `supplier_catalog` (Epic-5) | `{supplierId, partId, unitPrice, available}` — a part↔supplier terms list | **DORMANT DUPLICATE of the governed `part_supplier_items`. Not revived, not made load-bearing.** `part_supplier_items` is the single part↔supplier authority (below). Formal retire-vs-keep-dormant is a separate Procurement decision, not this program. |
| `part_supplier_items` (INV-1 PR 1.4, ADR-008) | **THE governed part↔supplier authority** — deterministic `<partId>__<supplierId>`, supplier cost/terms, status ACTIVE/INACTIVE, ≤1 ACTIVE preferred supplier/part, trusted-service-only | **Reused unchanged as the authority.** The Supplier Master owns the `supplierId` space this collection already references (pattern `[A-Za-z0-9_-]{1,64}`). No second part↔supplier collection is created. |
| `purchase_orders` (Epic-5) | dormant factory-PO model | **Remains DORMANT.** Not authoritative, not deleted here. Its future belongs to a broader Procurement architecture decision, out of scope. |

**Key insight:** `part_supplier_items` already references governed `supplierId`s with no master that owns them. The Supplier Master closes that gap — it is the **owner of Supplier identity**, and `part_supplier_items` is the **owner of the part-scoped terms** for those suppliers. Distinct responsibilities, one authority each.

## 3. Supplier identity model (governed reference object)

`suppliers/{supplierId}` — governed record (server-authored; `active` legacy field forbidden, `status` is the authority — same discipline as governed warehouses/parts):

- **Identity:** `supplierId` (governed `[A-Za-z0-9_-]{1,64}`, the id `part_supplier_items` references); `name` (canonical display name); `normalizedKey` (deterministic normalization of the name — lowercase, collapse whitespace/punctuation — for **dedup detection only**, never an auto-merge key); `status` ∈ `{ACTIVE, INACTIVE}`.
- **Business info (only what the business needs — no speculative ERP fields):** optional `vendorNumber` (account/vendor identifier), `contactName`, `phone`, `email`, `address`, `paymentTermsRef` (a reference/label, not a terms engine), `notes`.
- **Governance:** `version` (int ≥ 1), `createdAt`/`createdBy`, `updatedAt`/`updatedBy`, and status-change auditing via the shared audit writer. No physical delete.

Model only these; extend later under governed change, not speculatively.

## 4. Duplicate-handling policy (identity ≠ display-name equality)

Supplier identity MUST NOT depend solely on display-name equality. Strategy:

- **Signals:** `normalizedKey` (name normalization), `vendorNumber`, and address/contact evidence — combined, not any single one.
- **Create-time:** a create whose `normalizedKey` (or `vendorNumber`, when present) matches an existing ACTIVE supplier is **flagged as a suspected duplicate for governed human review**, not blocked and not auto-merged. Exact `supplierId` collision is a hard `already-exists` conflict (deterministic id).
- **No silent auto-merge** on fuzzy/AI matching. `mergeSupplier` is **deferred** (§7) until merge semantics (reference re-pointing, reversibility, audit) are fully designed.
- AI may *later* recommend suspected duplicates (see the future Enterprise Assistant, `PlatformCapabilityModel` §13), but **governed human confirmation is always required** and AI is never an authorization control.

## 5. Status model

`ACTIVE` / `INACTIVE`, mirroring the established governed reference-data pattern (warehouses, part statuses). **INACTIVE** = preserved for historical references/reporting but **not selectable for new purchasing** (except an explicit governed exception, out of scope now). Suppliers are never physically deleted on deactivation.

## 6. Authorization (reconciled with R-1 — no new temporary path)

Supplier is a **catalog-governed object**, exactly like Part and Manufacturer, whose part-scoped terms (`part_supplier_items`) already gate on **`inventory.catalog.manage`** / **`inventory.catalog.activate`** (`partMasterCommands.ts`). Therefore the Supplier trusted commands **reuse those existing capabilities** (create/update → `inventory.catalog.manage`; activate/deactivate → `inventory.catalog.activate`) rather than inventing `supplier.manage`/`supplier.read`. This: (a) keeps Supplier inside the one catalog-governance authority; (b) avoids a symmetry-only permission; (c) needs nothing R-1's permission convergence would immediately retire. Workspace **read** follows the governed catalog read model; the initial Suppliers workspace read gates on `isAdminOrDispatcher()` (matching the current `suppliers` read rule and the other Purchasing surfaces), with any capability-scoped read tightening tracked with R-1 — not a new capability minted here.

## 7. Trusted write authority (S2 — prepared, not deployed)

`functions/src/supplierMaster/` implementing the established trusted-command pattern, **reusing** `partMasterCommands.ts`'s machinery (actor from trusted auth context, `requireCapabilityOrAudit`, idempotency, versioning, fingerprint, one-transaction, server-authored audit, bounded public `HttpsError` matrix, fail-closed validation, no client-direct writes):

- `createSupplier` (`inventory.catalog.manage`) — governed shape + duplicate-flagging (§4).
- `updateSupplier` (`inventory.catalog.manage`) — version-checked.
- `activateSupplier` / `deactivateSupplier` (`inventory.catalog.activate`) — status transitions, audited.
- `mergeSupplier` — **DEFERRED**; only if fully designed + safely reversible with reference re-pointing + audit. Not in this program's build unless a later gate designs it.

`suppliers` Rules become **fully backend-private for writes** (`create/update/delete: if false`, unchanged) with the governed read; the Rules diff is **prepared in S2 but NOT deployed** (Tier-2 protected gate).

## 8. Purchasing migration compatibility (S4 — repo-only tooling; no production migration)

Target: `reorder_purchase_orders` carries **`supplierId`** (governed identity) **+ `supplierNameSnapshot`** (what the document represented at transaction time). This governed-id-plus-display-snapshot shape is **validated by the existing `workOrderSnapshotCompatibility` convention** (a governed reference + a denormalized display snapshot on the transaction). Historical `supplierName` is **not removed**; the snapshot preserves history while `supplierId` provides current governed identity.

Migration tooling (repo-only, dry-run/rollback/evidence + acceptance criteria first) must classify every legacy `supplierName`: **exact match** (→ link `supplierId`), **ambiguous** (multiple candidate suppliers → operator-resolved manifest, never auto-picked), **unmatched** (→ create-supplier candidate or leave snapshot-only), **inactive-supplier** match, **duplicate-supplier** candidates, and **historical** records (snapshot-only, never rewritten in place without authorization). **No production migration is authorized**; the tooling produces the plan/evidence for a later protected gate.

## 9. Phased program + protected boundaries

S1 (this doc) → **S2** governed backend (validators/contracts, trusted commands, audit, tests; Rules prepared-not-deployed) → **S3** Suppliers registry/detail workspace (read stack, governed status, tests) → **S4** purchasing integration (supplier reference support, `supplierId`+`supplierNameSnapshot`, migration tooling/dry-run, parity/regression) → **S5** integration/release-candidate package (full verification, migration evidence, rollback, deployment package). **STOP before protected production activation.**

**NOT authorized (deferred to consolidated protected packages after sandbox/integration evidence):** Rules deploy, Functions deploy, production supplier creation, capability grants, production migration, rewriting existing `reorder_purchase_orders`, deleting dormant collections, activating supplier administration in production, Hosting/Pages release.
