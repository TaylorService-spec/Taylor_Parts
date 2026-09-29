# Catalog continuity boundary — what must move with Part Master

Branch `catalog/part-master-cutover`, from main `aa033dad`. **Read-only census. Nothing is written,
frozen, copied or activated by this document.**

The question this answers is deliberately narrow:

> What has to move together so a user can still **create, find, edit and use** a Part after Firestore
> Part authority is disabled?

It is not an architecture survey. Every row below is either INSIDE the slice — because a normal Part
workflow breaks without it — or OUTSIDE, with the reason it can stay.

---

## 1. The matrix

| # | Thing | In / out | Why, with evidence |
|---|---|---|---|
| 1 | `parts` | **INSIDE** | The authority being moved. PostgreSQL schema exists (migrations `1759795200000`, `1759881600000`); `eos_ops.parts` = **0** in nonprod. |
| 2 | `part_aliases` | **INSIDE — hard** | `updatePart` writes the Part **and** an `INTERNAL_PN` alias in **one Firestore transaction** (`partMasterCommands.ts:345-396`): when the internal part number changes the old value is preserved as an ACTIVE alias "atomically with the Part update", and a conflicting alias identity "rejects the ENTIRE update before any write". Parts in PostgreSQL with aliases in Firestore makes that write a cross-store transaction, which cannot exist. **`part_aliases` has NO PostgreSQL schema.** |
| 3 | `equipment_models` | **INSIDE — already handled** | `createPart`/`updatePart` assert the FK inside the transaction (`partMasterCommands.ts:344`). PostgreSQL table exists (`1758585600000`) and the copy tool already writes Equipment Models **before** Parts so the row-by-row FK holds. |
| 4 | Part **create / edit** | **INSIDE** | `createPart`, `updatePart`, `changePartStatus` — the only governed writers. Client writes are already closed: `firestore.rules:1585` is `allow create, update, delete: if false`. |
| 5 | Part **lookup / search** | **INSIDE — the real gap** | The CLIENT reads `parts` **directly from Firestore** under `firestore.rules:1581-1584`. Four modules query it: `services/partMasterQueries.js` (`fetchPartMasterList`), `hooks/useWholeUnitParts.js`, `hooks/useSerialTrackedParts.js`, `modules/inventory/PartsList.jsx`. Six surfaces read the **whole** catalogue, named in `PART_CATALOGUE_WHOLE_COLLECTION_READ`. Disabling Firestore Part authority breaks Part lookup unless a Render read exists **and** the client is cut over. |
| 6 | Receiving Part resolution | **INSIDE (read path only)** | `receivingCallableWiring.ts:66,113` resolves `parts/{id}` server-side. The receipt refuses `PART_NOT_FOUND` without it. |
| 7 | Inventory Part resolution | **INSIDE (read path only)** | `inventory/partBalanceReadService.ts:400`, `partBalanceBatchReadService.ts:227`. |
| 8 | Purchasing / Reorder Part selection | **INSIDE (read path only)** | The governed PostgreSQL Reorder create already reads `eos_ops.parts`; the legacy picker reads Firestore. |
| 9 | Supplier-item relationships | **OUTSIDE — its own authority** | `partSupplierItems.ts:307` **reads** `parts/{id}`; nothing in Part create/edit/lookup reads a supplier item. It is a CONSUMER of Part, not a dependency of it. Its own store (`part_supplier_items`, no PostgreSQL schema) may stay — but its **Part read** is row 6/7's problem and must move with them. |
| 10 | Compatibility records | **OUTSIDE — same shape** | `partReferenceCompatibility.ts:92` reads `parts/{id}`. `runEquipmentCompatibilityCommand` has **no deployed callable** (not exported from `index.ts`). Consumer, not dependency. |
| 11 | Manufacturer references | **OUTSIDE — proven opaque** | `manufacturerId` is **shape-validated only**: `validation.ts:178-182` checks the id's shape and that an MPN implies one. **No existence check anywhere in `partMasterCommands.ts`**, and PostgreSQL carries `primary_manufacturer_id TEXT` with a **shape CHECK and no foreign key** (`1759881600000:84,94`). `manufacturers` = **0** documents in sandbox. It can stay in Firestore without breaking any Part workflow. |
| 12 | Reporting / read consumers | **OUTSIDE (follow rows 5-8)** | They consume the read surfaces above; none is a separate authority. |

---

## 2. The boundary, stated

**INSIDE:** `parts`, `part_aliases`, `equipment_models`, the three write callables, and **every server
and client Part READ path**.

**OUTSIDE:** `part_supplier_items`, compatibility, `manufacturers` — each a separate authority whose
*own* data may remain in Firestore. What may **not** remain is their Part **read**, which is the same
read-path move as rows 6-8.

The distinction that makes this boundary decidable: a thing is INSIDE when Part create/edit/lookup
**cannot complete without it**, and OUTSIDE when it merely **reads** a Part.

---

## 3. What this changes about the plan

Two findings move the work, and neither is optional:

1. **`part_aliases` must gain a PostgreSQL schema before Parts can move.** The existing catalog
   cutover copies `parts` and `equipment_models` only (`exportCatalogSnapshot.js` allowlist). Copying
   Parts while aliases stay in Firestore leaves `updatePart` with a transaction it cannot perform —
   a **known broken business path**, which the Owner ruling forbids accepting merely to populate
   `eos_ops.parts`.

2. **COPY is not completion, and the gap is the read path.** Lane C's `renderState: null` is exactly
   this: no Render transport composes catalog reads or writes. The client reads Parts straight from
   Firestore today, so `parts` in PostgreSQL with the client unchanged means the catalogue is
   populated and invisible.

Neither is a reason to widen the slice beyond the matrix. Rows 9-11 stay out.

---

## 4. Six-state

| State | Reached? |
|---|---|
| BUILT | **yes** — schema for `parts` + `equipment_models`; `postgresPartMasterWriter.ts`, `postgresEquipmentModelWriter.ts` |
| MIGRATION TOOLING READY | **yes** — `exportCatalogSnapshot.js` → `catalogCutover.js` census / COPY / VERIFY, checksummed snapshot, drift and unknown-target refusal, advisory lock, production fence |
| RECONCILED | **no** — no snapshot exported, no census run, `eos_ops.parts` = 0 |
| CUT OVER / ACTIVE | **no** — `CATALOG_WRITER_AUTHORITY` is `firestore: OPEN, postgres: INACTIVE`; no Render Part transport exists |
| LEGACY RETIRED | **no** |
| ACCEPTED | **no** |

---

## 5. Source census (sandbox, read-only, 2026-09-20)

`parts` **54** — ACTIVE 52, DRAFT 2 · STANDARD 42, SERIALIZED 12 · STOCKED 51, NON_STOCK 3.
`equipment_models` **48**. `manufacturers` **0**.

**45 of 54 parts carry the certification markers** `certificationWorld` / `dataProvenance`
(`catalogSnapshot.ts:46-51`) and are excluded by existing policy, so the migratable population is
about nine. The real number comes from the cutover's own classifier at census time and is not
hard-coded anywhere.

Every Part id a Reorder candidate references is PRESENT and ACTIVE in the source — including
**`CW-P-0000`** (STANDARD / EACH / STOCKED), the only one that matters once the `ro-sbx-*` scenario
fixtures are retired.
