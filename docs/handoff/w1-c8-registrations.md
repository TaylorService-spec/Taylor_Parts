# W1-C8 (Purchasing) — registrations owed in files this lane may not edit

Lane C8 owns Reorder Request, Purchase Order, Receiving Order and Transfer Order. Wave 1 runs ten
lanes concurrently, so a fixed set of shared files is off limits to every lane. Everything this
change needs in one of those files is recorded here instead of being edited, so nothing is silently
missing and nothing is silently in conflict.

---

## 1. REQUIRED — `functions/package.json` → `test:adminPolicyPostgres`

**Add `test/eosOpsPurchasingPostgres.test.mjs` to the `test:adminPolicyPostgres` script.**

Current value ends:

```
... test/eosOpsPostgres.test.mjs test/eosOpsOperatingCompanyCustodyPostgres.test.mjs test/inventoryCapabilityGrantMigration.test.mjs
```

Required value appends one file:

```
... test/inventoryCapabilityGrantMigration.test.mjs test/eosOpsPurchasingPostgres.test.mjs
```

### Why this is not optional

`test/eosOpsPurchasingPostgres.test.mjs` does `DROP SCHEMA ... CASCADE` and re-migrates, exactly as
`adminPolicyPostgres.test.mjs`, `adminPolicySeed.test.mjs`, `adminPolicyActivation.test.mjs`,
`eosOpsPostgres.test.mjs`, `eosOpsOperatingCompanyCustodyPostgres.test.mjs` and
`inventoryCapabilityGrantMigration.test.mjs` already do. `node --test` runs FILES concurrently by
default, so an unregistered resetter races the registered ones — one drops the schema mid-transaction
of another. That race already happened once in CI and is the reason the registered command carries
`--test-concurrency=1`.

The repository ALREADY has a guard for exactly this, and it is currently RED because of this change:

> `test/adminPolicyPostgres.test.mjs` → **"every suite that resets the schema is covered by that one
> command"** — fails with
> `eosOpsPurchasingPostgres.test.mjs resets the schema but the registered command does not run it`.

That failure is the guard working. It is the only failing test in the Postgres suite after this
change (147 of 148 pass), and it clears the moment the line above is added. **Whoever merges Wave 1,
or whichever lane holds `functions/package.json`, must make this edit.**

Verified locally by running the registered set plus the new file with the registration's own
semantics (`--test-concurrency=1`), against a real PostgreSQL 16:

```
node --test --test-concurrency=1 \
  test/adminPolicyPostgres.test.mjs test/adminPolicySeed.test.mjs test/adminPolicyActivation.test.mjs \
  test/eosOpsPostgres.test.mjs test/eosOpsOperatingCompanyCustodyPostgres.test.mjs \
  test/inventoryCapabilityGrantMigration.test.mjs test/eosOpsPurchasingPostgres.test.mjs
# tests 148 / pass 147 / fail 1  (the one failure is the registration guard above)
```

## 2. RECOMMENDED — `functions/package.json` → a pure test target

`test/purchasingMigrationMapping.test.mjs` needs no database and takes under a second (33 tests). It
belongs beside its siblings in `test:adminPolicy`, next to `legacyInventoryMovementMapping.test.mjs`,
which is the module it is modelled on:

```
... test/legacyInventoryMovementMapping.test.mjs test/purchasingMigrationMapping.test.mjs
```

---

## 3. NOT REQUESTED — and why

These are the shared files a purchasing change might be expected to touch. Each is deliberately left
alone, and the reason is recorded so the next reader does not have to re-derive it.

| File | Status | Reason |
| --- | --- | --- |
| `field-ops-app-vite/src/metadata/entityRegistry.js` | no change needed | Reorder Request, Purchase Order, Purchase Order Void, Receiving Order and Transfer Order are **already registered** (lines 40–43, 50; 72–75, 82). Migration 008 changes where the authority lives, not what the Objects are. |
| `field-ops-app-vite/src/access/objectPermissionMap.js` | no change needed | No new Object and no new permission. |
| `functions/src/access/permissionCatalog.ts` | no change needed | `reorder.purchaseOrder.void` and the rest of the purchasing permissions already exist; this change adds no capability. |
| `firestore.rules` | **must not change** | Nothing here moves a live read or write off Firestore, and the hard prohibition on new Rules-based authorization stands. The existing `reorder_purchase_orders` immutability (`allow update, delete: if false`) and the atomic VOIDED ↔ void-record pairing (`existsAfter()`/`getAfter()`) are untouched and still govern the deployed path. |
| `firebase-exit-baseline.json` / `firebase-exit-manifest.json` | no change needed | Every file this change adds is Firebase-free. `node scripts/firebaseExitGuard.mjs` passes with no baseline edit. |
| `capability-graph.json`, `.github/workflows/**`, navigation/app-shell | no change needed | No capability, no workflow trigger, no route. |

---

## 4. Follow-on work this change deliberately does NOT do

Recorded so the boundary is explicit rather than looking like an oversight.

* **No cutover, no import run, no dual-write, no freeze, no deploy.** Migration 008 and
  `purchasingRepository.ts` are the *authority and its boundary*, in the same posture as migration
  005 / `cycleCountRepository.ts`: nothing deployed reads or writes them.
* **No Operations API operation.** `eosOpsHttp.ts`'s closed list still holds exactly
  `resolveMyCapabilities`. Adding a purchasing operation is a transport decision that belongs with a
  command, not with a schema.
* **The legacy Firestore purchasing writers stay exactly as they are** —
  `reorderRequest/reorderCallables.ts`, `inventoryReceiving/*`, `inventoryTransfer/*`,
  `procurementService.ts`. They remain the live authority until a cutover is authorized.
* **`procurementService.ts` / `procurementBridge.ts` (the canonical `purchase_orders` layer) is not
  migrated.** `purchaseOrderNormalization.ts` records that whether that layer is retired or converted
  is an open Owner decision, and its price field is a currency-less float that must not become a cost
  authority. `receiving_orders.source_purchase_order_id` is therefore an opaque id with a stated
  `source_kind`, not a foreign key — so a canonical receipt stays representable without this schema
  pretending to hold an authority it does not.
