# W1-C20 — Serialized Asset: registrations, rulings and open items

Lane C20 owns **Serialized Asset** — `serialized_assets`, the serial lifecycle, and serialized
custody as a Firestore object. This packet makes the custody **location** honest. It adds no
migration, no collection, no callable, no capability and no dependency.

---

## 1. What shipped

`serialized_assets.currentLocationType` is now a real, written, validated field, and location
identity for a serialized unit is the typed pair `(currentLocationType, currentLocationId)`.

| Writer | Where the type comes from | File |
|---|---|---|
| Receipt (activation) | `receivingLocation.type`, narrowed to a custody type; a serial line at a non-custody location is **refused** | `functions/src/inventoryReceiving/receiveInventoryStockCommand.ts` · `functions/src/serializedAsset/serializedAssetRegistration.ts` |
| Acquisition | `ACQUIRED_LOCATION_TYPE` — the same constant the endpoint resolver accepts | `functions/src/serializedAsset/acquireSerializedAssetCommand.ts` · `acquireCallableWiring.ts` |
| Relocation | `req.destination.type` (`RELOCATION_ENDPOINT_TYPES` = WAREHOUSE\|BIN) | `functions/src/inventoryLocation/stockRelocationCommand.ts` |
| Transfer receive | `stored.value.destination.type` (`TRANSFER_ENDPOINT_TYPES` = WAREHOUSE\|BIN\|MOBILE) | `functions/src/inventoryTransfer/transferOrderCommand.ts` |

The single reader, `workOrderConsumption/consumptionSourceService.ts`, no longer defaults a missing
type to `"WAREHOUSE"`. It returns the typed pair or `null`, and `null` lands in the
`SERIAL_CUSTODY_UNKNOWN` refusal that `consumptionSource.ts` already specified and that the old
default had made unreachable.

**Vocabulary:** `SERIALIZED_CUSTODY_LOCATION_TYPES = WAREHOUSE | BIN | MOBILE` — exactly what the
writers can produce. **EQUIPMENT is deliberately excluded** (an installed unit's custody is
`currentEquipmentId`, and migration 007 draws the same line between `ops_custody_location_type` and
`ops_location_type`). The ledger's VENDOR/CUSTOMER/VIRTUAL are movement counterparties, not custody.

---

## 2. Registrations

**None required, and none made.** Nothing here is a new governed surface:

- **No new capability.** `inventory.serializedAsset.read` / `.acquire` are unchanged; no new
  permission-catalog entry (`permissionCatalog.ts` is a shared file and was not edited).
- **No new callable, collection, index or Firestore rule.** `firestore.rules` untouched.
- **No migration.** Migration id `1759622400000` is **unspent** — see §4.
- **No new Firebase business-runtime dependency** (`scripts/firebaseExitGuard.mjs` passes).

### Admin → Objects — the registry line, recorded not written

There is no Serialized Asset entity definition today, and this packet does not add one.
`field-ops-app-vite/src/metadata/entityRegistry.js` is a **shared file this lane must not edit**, and
`field-ops-app-vite/test/entityRegistry.test.mjs:16-30` reads the definitions directory and fails if a
definition exists without a registry import — so shipping a definition file alone would break that
test. C2's Admin→Objects framework (PR #1866) is also not on main.

When #1866 merges, the owner of the registry adds:

```js
import { serializedAssetEntity } from "./definitions/serializedAsset.js";   // ... and in ENTITY_REGISTRY:
  serializedAssetEntity,
```

The profile must carry the location as the **typed pair** (`currentLocationType` +
`currentLocationId`), never the bare id.

---

## 3. Ruling: the serial status vocabulary (8 declared vs 5 in `ops_serial_status`)

**8-vs-5 is the wrong frame.** The set that matters is the states a writer can actually produce.
Computed from code, not memory, and pinned by
`functions/test/serializedCustodyTypedPair.test.mjs`:

| State | Writer | `ops_serial_status`? |
|---|---|---|
| `RECEIVED` | `serializedAssetRegistration.ts` (`RECEIPT_INVENTORY_STATE`) | **NO** |
| `AVAILABLE` | `acquireSerializedAssetCommand.ts:72` (`ACQUIRED_INITIAL_STATE`), `transferOrderCommand.ts` (receive) | yes |
| `IN_TRANSIT` | `transferOrderCommand.ts` (dispatch) | **NO** |
| `INSTALLED` | `installSerializedAssetCommand.ts` (`INSTALLED_STATE`) | yes |
| `RESERVED`, `STAGED`, `LOADED`, `DELIVERED` | **none — unreachable** | RESERVED only |

**RECEIVED → refuse at import. Do not fold into AVAILABLE or RESERVED.** The install command's own
gate states why in code: `INSTALLABLE_STATES` excludes RECEIVED because a unit that has "arrived at
the dock and not yet put away" would "skip custody"
(`functions/src/equipmentInstall/installSerializedAssetCommand.ts:65-66`, whose doc comment gives the reason verbatim). Mapping it to AVAILABLE
asserts a pickability the domain explicitly denies; mapping it to RESERVED asserts a reservation that
does not exist. Live impact: 2 rows.

**IN_TRANSIT → refuse at import. Newly identified here, not previously flagged.**
`transferOrderCommand.ts` sets it at dispatch while leaving `currentLocationId` at the origin.
Folding it to AVAILABLE would offer a unit that has left its origin for picking at that origin. Live
impact 0 rows today, but fully reachable in code.

**STAGED / DELIVERED / LOADED / RESERVED → do NOT widen the enum, and do not build import handling.**
No writer exists anywhere in the repository. This **narrows C7's finding**: STAGED and DELIVERED are
indeed in `INSTALLABLE_STATES` with no `ops_serial_status` value, but nothing can put a unit into
either state, so the hazard is unreachable rather than latent. If a lane adds a writer, the guard
test above fails and the question must be re-decided then.

**Should `ops_serial_status` be widened with RECEIVED and IN_TRANSIT? Yes — but not here, and not
yet.** The gap is real and its fix is deterministic, but an enum value that no importer reads and no
writer produces is unexercised schema. It belongs in the migration that ships the importer (cutover
tooling, lane C15), where the refusal path and the widened enum can be tested together. **Migration id
`1759622400000` is therefore left unspent by this lane.** Escalated, with the evidence above, rather
than guessed.

**Also recorded, not acted on:** three `ops_serial_status` values — `CONSUMED`, `RESERVED`,
`SCRAPPED` — have no Firestore producer at all. In particular, consuming a serialized unit on a work
order does **not** change its `inventoryState`, so a consumed serial remains `AVAILABLE`. That is a
lifecycle gap in the consumption path, not in this registry, and is left to its owner.

---

## 4. Open items this lane did NOT resolve (deliberately)

1. **OR-3 — custody semantics for INSTALLED units.** Unchanged and still an owner ruling. Install
   preserves `currentLocationId` at the origin warehouse (`installSerializedAssetCommand.ts`), so an
   installed unit's stamped pair describes where it *was*, not custody. Migration 007's biconditional
   (`status='INSTALLED'` ⟺ `location_type='EQUIPMENT'`) means an importer must derive EQUIPMENT
   custody from `currentEquipmentId` and **must not** carry the physical pair for INSTALLED rows.
   Nothing here pre-empts that.
2. **`installedFromLocationId`** (`installSerializedAssetCommand.ts:327`) is still a bare id with no
   type, for the same reason its sibling was: nobody wrote one. It is provenance, not custody, and
   fixing it belongs with the install link (lane C7).
3. **The Available Equipment projection still returns only `currentLocationId`.** The stored type is
   now plucked and validated (`serializedAssetReadService.ts`) but not exposed, because the
   projection's field list is described in `permissionCatalog.ts` — a shared file. Widening the
   trusted read to the typed pair is a catalog-owning change, and it is what would finally let the
   client's `composeAvailableEquipment` consume this projection directly (see §5).
4. **Legacy documents are not backfilled.** 0 of 35 sandbox rows carry the field; they validate as
   `currentLocationType: null` (honestly unknown) and are refused by the consumption path rather than
   assumed to be warehouses. Backfill is cutover tooling (C15), not this lane, and no reconciler was
   added — inferring the type from the id, or from a registry lookup, is the second canonicalization
   the location ruling forbids.

## 5. A pre-existing contradiction this closes half of

`functions/src/serializedAsset/types.ts`'s header recorded that the backend flattened location to a
scalar `currentLocationId` while the already-merged pure client contract
(`field-ops-app-vite/src/domain/serializedAssetIdentity.js:51,129`) has always required the reference
object `{ type, locationId }` via `validateLocationRef` — and that, in consequence,
`composeAvailableEquipment` could not consume the backend projection. The backend now **carries both
halves**, so the remaining work is to expose them through the read (item 3 above). The client module
was not edited.
