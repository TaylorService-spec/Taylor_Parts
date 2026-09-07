# Metadata List Reads — Migration to the Governed Read Path

Where each metadata-driven list gets its rows, and — for the one entity that did not move — the
precise reason.

**Authority boundary this serves.** Firebase authenticates. EOS authorizes. A metadata list used to
compose its own Firestore query in the browser and rely on Rules to refuse the bad ones. It now
names a **source id** and the server resolves the collection, the ordering, the filters, the
projection and the capability from `functions/src/access/governedReadRegistry.ts`. The browser can
no longer name a collection, a field, a where clause, an operator, an orderBy or a raw cursor.

## What the client is allowed to say

| The client sends | The server decides |
|---|---|
| `sourceId` — an opaque EOS source name | which collection, and which capability gates it |
| `sortKey` — a token the source registered (`updatedAtDesc`) | the Firestore field and direction that token means |
| `filters` — registered NAMES with values | the field and the operator each name maps to |
| `pageSize` | the cap (`maxPageSize`), and the `+1` truncation probe |
| `cursor` — an opaque string the server issued | what it decodes to, and that it belongs to this source |

A token or filter name the source did not register is **refused**, never silently replaced with a
default. `status` and `statusIn` are two registered filters over one field precisely because the
operator is the server's to choose.

## Migrated (17)

`account`, `contact`, `employee`, `equipment`, `inventoryAction`, `inventoryTransaction`,
`location`, `mobileLocation`, `part`, `purchaseOrder`, `purchaseOrderVoid`, `reorderRequest`,
`supplier`, `supplierCatalogItem`, `transferOrder`, `truck`, `warehouse`.

`supplierCatalogItem` has no list view today. It is registered from the FIELD-LEVEL declarations
its entity already carries, because an entity says how it is read and leaving it `CLIENT_DIRECT`
would keep a deny-all collection reachable by a client-direct query for a surface that does not
exist yet.

Each declares `readVia: "CALLABLE"` and a `readCallable` naming its governed source. Every sort and
filter registered was **measured from the definition that already shipped** — the `sortable: true`
fields, the declared filter operators, and each list's own `defaultSort`. No sortable field was
added, and none was dropped to make a registration tidier: a sort registered that the UI never
offered is an unindexed query nobody proved, and one omitted is a control that silently stops
working.

## NOT migrated (1) and DELETED (1)

| Entity | Collection | Blocker |
|---|---|---|
| `workOrder` | `fieldops_wos` | **Authority boundary is not global.** Work-order read authority includes assigned-technician self scope. Every source in the registry is a global capability check; registering one would either widen the read (a technician seeing every work order) or narrow it (a dispatcher losing rows). The self-scoped read model is a design decision, not a migration step. |
| `stockLocation` | `stock_locations` | **DELETED, not blocked.** The surface was retired by Decision #160 / ADR-014: nothing ever wrote the collection, it disagreed with the ledger wherever it was seeded, and every backend reader was removed. Measured 2026-09-07 — no route, no registry mount, no `src/` caller. The entity definition, its index list and its definition test were deleted rather than kept alive to hold Firestore access open for dead product. `test/stockLocationSurfaceRetired.test.jsx` still guards the operator surface. The `warehouse.stockLocation.read` capability is left in the catalog untouched: removing a capability is a capability change, and no ruling covers it. |

Because `workOrder` still reads directly, **`field-ops-app-vite/src/metadata/firestoreListSource.js`
still has a caller and has NOT been deleted.** It is not dormant scaffolding kept "just in case" —
it is the live path for that one entity, and it goes when the technician/self-scope seam lands.

## What checks this

`field-ops-app-vite/test/metadataDefinitionsValidate.test.jsx` runs `validateListViewDefinition`
and `validateEntityDefinition` over **every shipped definition**, enumerated by glob.

This test exists because of a measured hole. Before it, nothing called either validator over the
definitions the app actually ships — they were exercised only against hand-built fixtures. Deleting
a registered sort from the governed read registry left all 3,286 client tests passing. A check that
runs on nothing checks nothing, which is the same defect the validators were written to close, one
layer further out.

For a governed source, the validator additionally proves that every sortable column has a
registered sort, every declared filter+operator has a registered filter name, and the list's page
size is within the source's cap — at definition time, rather than when a user clicks the column
header and the server refuses.

## Related

- `functions/src/access/governedReadRegistry.ts` — the closed catalogue (canonical; mirrored to the
  client by `scripts/syncAccessContracts.mjs` with CI drift enforcement, for definition-time
  validation only — the server never trusts the mirror).
- `functions/src/access/governedListReadService.ts` — `readGovernedList`, one paginated callable
  over the whole registry.
- `functions/test/governedListRead.test.mjs` — the read contract, including that a sort token
  resolves to the field the *registry* chose and never to the caller's string.
- `docs/governance/workflow-action-census.md` — the write side, measurement only.
