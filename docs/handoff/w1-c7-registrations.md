# W1 · C7 Equipment — registrations, gaps and obligations this lane could not close

Branch `impl/w1-equipment`. Migration `functions/migrations/1758585600000_equipment-and-installed-custody.sql`
(migration 008). Everything below is either a change to a file this lane may not edit, or a fact
found during inspection that belongs to somebody else's authority.

---

## 1. Registrations required in files this lane may not edit

### 1.1 `functions/package.json` — the Postgres test command

`functions/test/eosOpsEquipmentCustodyPostgres.test.mjs` needs registering:

```
"test:equipmentInstalledCustodyPostgres":
  "npm run build && node --test --test-concurrency=1 test/eosOpsEquipmentCustodyPostgres.test.mjs"
```

and, more importantly, it should be appended to the existing serialized command:

```
"test:adminPolicyPostgres": "... test/eosOpsEquipmentCustodyPostgres.test.mjs"
```

**Why, precisely.** `adminPolicyPostgres.test.mjs`'s "every suite that resets the schema is covered
by that one command" guard looks for the literal `DROP SCHEMA` in each test file. This suite
deliberately contains none — it migrates forward, seeds its own tenant and deletes only its own rows
— so the guard does not currently demand its registration and **the guard is not being evaded**.
It still needs to be in that command for the other half of the reason the command exists: the three
resetters would drop the schema out from under it if `node --test` ran the files concurrently.

A companion static suite, `functions/test/eosOpsEquipmentCustody.test.mjs`, needs no database and
could join `test:adminPolicy`.

### 1.2 `field-ops-app-vite/src/metadata/entityRegistry.js` — nothing to do

Already correct: `equipmentEntity` and `equipmentModelEntity` are both registered
(`entityRegistry.js:28-29`, `:60-61`). **Admin → Objects already lists both objects.** No change
requested.

### 1.3 `field-ops-app-vite/src/access/objectPermissionMap.js` — a real gap, recorded not closed

`objectPermissionMap.js:86` carries Equipment as:

```js
{ object: "Equipment / Installed Base", domain: "Service", rulesOnly: "equipment", C: [], R: [], E: [], D: [] }
```

All four CRUD capability lists are **empty**, and the object is marked `rulesOnly`. Admin → Objects
therefore shows an Equipment object whose permissions are not expressible as capabilities at all —
authorization lives in `firestore.rules` by ROLE (admin/dispatcher), which the metadata definition
records honestly (`definitions/equipment.js`, `readCapability: null`). There is no `equipment_models`
row in this map at all. Whether Equipment gets governed C/R/E/D capabilities is an access-model
decision, not this lane's; it is named here so it is not discovered again.

### 1.4 `functions/src/access/permissionCatalog.ts` — no new capability requested

This lane adds **no** capability. Note for whoever owns that catalog: `equipmentImportCommand.ts`
reuses `equipment.install` for Data Import creation and says so in its own header
(`CAP_EQUIPMENT_CREATE`), explicitly flagging "whether Equipment deserves its own create capability
is a real question and a separate decision". Still open.

---

## 2. Shared test files this lane DID edit, and why

Four existing suites made claims that an eighth migration invalidates. Each was changed to keep
making the claim it was written to make, rather than to accommodate this migration:

| File | Was | Now |
|---|---|---|
| `functions/test/adminPolicyPostgres.test.mjs` | `down 7`, hardcoded | `down <count of migration files>` |
| `functions/test/adminPolicyPostgres.test.mjs` | "the newest migration reverses alone" stepped down 1 to reach 007 | steps back to **007 by name** |
| `functions/test/eosOpsOperatingCompanyCustody.test.mjs` | `assert.equal(files.length, 7)` | asserts 007's **position** relative to 005/006 |
| `functions/test/eosOpsOperatingCompanyCustodyPostgres.test.mjs` | counted every `operating_company_key` column in `eos_ops` | scoped to **007's own three tables** |
| `functions/test/eosOpsOperatingCompanyCustodyPostgres.test.mjs` | inserted `INSTALLED/EQUIPMENT` custody at a made-up id | creates the Equipment record first (008's FK) |
| `functions/test/eosOpsPostgres.test.mjs` | "exactly four foundation tables" | the four plus `equipment` / `equipment_models` |

**Nine sibling lanes are adding migrations concurrently.** The first three changes above are the ones
every one of those lanes will otherwise hit; they are now derived from the directory rather than
hardcoded, so the next migration does not break them again. Expect textual merge conflicts here and
resolve in favour of the derived form.

---

## 3. Findings that belong to other lanes or other authorities

### 3.1 The serial-status vocabularies disagree, 8 against 5 — INVENTORY'S CALL, NOT EQUIPMENT'S

`functions/src/serializedAsset/types.ts:46-56` governs **eight** lifecycle states (RECEIVED,
AVAILABLE, RESERVED, STAGED, LOADED, IN_TRANSIT, DELIVERED, INSTALLED).
`eos_ops.ops_serial_status` (migration 005:80) has **five** (AVAILABLE, RESERVED, INSTALLED,
CONSUMED, SCRAPPED).

The install command permits four source states — AVAILABLE, RESERVED, **STAGED, DELIVERED**
(`installSerializedAssetCommand.ts` `INSTALLABLE_STATES`). Two of those four cannot be represented in
Postgres at all. `INSTALLABLE_CUSTODY_STATUSES` in `functions/src/eosOps/equipmentCustody.ts` is
therefore `["AVAILABLE", "RESERVED"]` — the honest intersection, asserted as such by
`eosOpsEquipmentCustody.test.mjs`. **Nothing maps DELIVERED onto AVAILABLE to make an install go
through.** Widening `ops_serial_status` (or deciding those states are not custody statuses) is the
inventory vocabulary's decision. Until it is made, a delivered unit cannot be installed through the
Postgres path.

### 3.2 ADR-010 §3's "CONSUMED installation effect from the customer Location" cannot be honoured

ADR-010 §3 step 2 says installation appends a governed `CONSUMED` ledger effect *from the customer
Location*. Migration 007 ruled the customer's Equipment out of `ops_location_type`, so there is no
movement row this schema can emit from a customer site, and emitting one from the origin warehouse
would claim stock left a place it left at delivery time. **Migration 008 writes no ledger row and
`installSerializedUnitAsEquipment` emits none.** Whether installation has a ledger effect at all —
and from where — is an unresolved conflict between ADR-010 and migration 007's ruling, and is for
the ledger authority to settle.

### 3.3 `serialized_assets.currentLocationType` is read but never written

`serialized_assets` carries `currentLocationType`, read with a `?? "WAREHOUSE"` default and written
by nothing. The P1B census measured 0/35 serialized assets carrying a type (§12.7), and named the
readers that discard it: `functions/src/inventoryAnalyticsCallables.ts:91-95` (says outright the field
is a typeless scalar, then assumes warehouse), `inventoryTransfer/transferOrderCommand.ts:232,:332`,
`cycleCount/cycleCountExpectedQuantity.ts:74`. Equipment's side of this is closed — 008's install
origin is read off `serialized_custody.location_type`, a real enum — but the Firestore defect is
untouched and belongs to the serialized-asset/inventory lanes.

### 3.4 Two live INSTALLED assets have a stale `currentLocationId`

Two serialized assets are INSTALLED at customer sites (`loc-harbor-airport`,
`cw-acct-0003-loc-00`) while `currentLocationId` still reads `wh-main`. This is **not a bug**:
install deliberately does not move the physical pointer and preserves the origin as
`installedFromLocationId`. It is recorded because a naive importer reading `currentLocationId` as
"where the unit is" would place two customer-owned machines back into warehouse stock.

### 3.5 Equipment serial numbers are not unique, and one writer pretends otherwise

`definitions/equipment.js` states `serialNumber` and `assetTag` are both optional and neither is
enforced unique by Rules or by `normalizeEquipmentInput`. But `equipmentImportCommand.ts` enforces
serial uniqueness inside its own transaction ("a duplicate serial created by a re-run is a register
that quietly doubled"). Migration 008 follows the register as it actually is: `serial_number` is
nullable with **no** unique constraint, because a UNIQUE here would assert an invariant the 290 live
documents have never been held to. If uniqueness is wanted, it is a data-quality decision that must
be measured against the live register first.

---

## 4. The import obligation this migration deliberately does not discharge

There is **no data migration in this packet**, by design (as with 005 and 007). What a later import
must resolve, stated so it is not rediscovered:

1. **`equipment.locationId` is a CRM customer site, never an inventory location.** 290/290 resolve
   into `locations`; 0/290 into any inventory registry (census §12.7). It must land in
   `equipment.customer_location_id` and must never be unioned with `serialized_assets.currentLocationId`
   or `cycle_counts.location.locationId`, which resolve 100% the other way. One field name, two
   disjoint namespaces, no discriminator on either side.
2. **`operating_company_key` has no source.** `EQUIPMENT_BUSINESS_LINE_NOT_RECORDED`
   (`definitions/equipment.js`) records that nothing on an installed unit names a line of business,
   and that deriving it from the owning Account is "confidently wrong for exactly the customers it
   matters most for". The column is NOT NULL with no default: an import must be given the authority,
   not compute it.
3. **`manufacturer` / `model` free text does not become two columns.** They are import input,
   resolved through `equipment_model_aliases` to a canonical `equipment_model_id`. An unresolved
   model lands as NULL. The count of the 290 that fail to resolve is a number the import should
   report, not silently absorb.
4. **`created_by` / `updated_by` have no source either.** `X-EQUIPMENT-PROVENANCE-GAP` records that
   the Firestore collection stores neither. Both are NOT NULL in Postgres — that is the write-path
   change the gap says the remediation actually is — so an import must state the importing actor
   rather than recording nobody.
5. **EQUIPMENT custody rows must be imported after their Equipment.** The up migration counts them
   and refuses rather than dangling the reference.

---

## 5. Not done, plainly

- **No client is cut over.** Nothing reads or writes these tables at runtime; `equipmentCustody.ts`
  is not wired to `eosOpsHttp.ts`'s closed operation list, and adding an operation there is a
  separate, governed step.
- **No Firestore change of any kind** — no Rules, no collection, no callable, no trigger.
- **No import, dual-write, backfill, freeze or deploy.**
- **Firestore-emulator suites were not run** — this environment has no Firebase emulator. The
  emulator-gated Equipment suites (`test:equipmentCompatibilityEmulator`, install callable wiring)
  are unrun here, not passing-by-assumption.
- **Uninstall / return / replacement (ADR-010 §4) is not built.** The schema does not forbid it —
  a custody row can leave EQUIPMENT custody the same way it entered — but there is no command, and
  the Firestore path has none either (`installSerializedAssetCommand.ts`: "there is no recovery
  command").
