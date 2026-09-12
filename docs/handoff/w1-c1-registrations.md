# W1-C1 — required shared-file registrations

Lane: **C1 — inventory commitment persistence + `inventory_sync_status` / Work Order replay authority**
Branch: `impl/w1-inventory-commitment`
Migration: `functions/migrations/1758067200000_inventory-commitment-and-work-order-replay.sql`

This lane may not edit shared/integration-writer files. The registrations below are the exact,
complete set this branch needs. **Everything else in this lane is domain-local and needs no
integration work.**

---

## 1. `functions/package.json` — REQUIRED, and a test currently FAILS without it

`test/eosOpsInventoryCommitmentPostgres.test.mjs` drops and re-migrates `eos_policy` + `eos_ops` from
clean, exactly as the three existing resetters do. `adminPolicyPostgres.test.mjs`'s guard *"every
suite that resets the schema is covered by that one command"* scans `functions/test/*.test.mjs` for
`DROP SCHEMA` and asserts each hit appears in the registered command. Until this edit lands, that
guard fails with:

```
eosOpsInventoryCommitmentPostgres.test.mjs resets the schema but the registered command does not run it
```

That is not a flake and not a false positive — it is the guard doing its job. Two schema-resetting
files that are not serialized by one command raced in CI before, which is why the guard exists.

**Edit:** append `test/eosOpsInventoryCommitmentPostgres.test.mjs` to the `test:adminPolicyPostgres`
script. Position within the list does not matter; `--test-concurrency=1` must stay.

Current value:

```
"test:adminPolicyPostgres": "npm run build && node --test --test-concurrency=1 test/adminPolicyPostgres.test.mjs test/adminPolicySeed.test.mjs test/adminPolicyActivation.test.mjs test/eosOpsPostgres.test.mjs test/eosOpsOperatingCompanyCustodyPostgres.test.mjs test/inventoryCapabilityGrantMigration.test.mjs"
```

Required value:

```
"test:adminPolicyPostgres": "npm run build && node --test --test-concurrency=1 test/adminPolicyPostgres.test.mjs test/adminPolicySeed.test.mjs test/adminPolicyActivation.test.mjs test/eosOpsPostgres.test.mjs test/eosOpsOperatingCompanyCustodyPostgres.test.mjs test/eosOpsInventoryCommitmentPostgres.test.mjs test/inventoryCapabilityGrantMigration.test.mjs"
```

### Optional, same file — the non-database suite

`test/eosOpsInventoryCommitment.test.mjs` needs no database and no serialization. It is covered
by nothing today. If a home is wanted, the natural one is `test:adminPolicy`:

```
... test/eosOpsOperatingCompanyCustody.test.mjs test/eosOpsInventoryCommitment.test.mjs test/legacyInventoryMovementMapping.test.mjs
```

---

## 2. Nothing else is required

Checked and deliberately **not** needed by this branch:

| Shared file | Needed? | Why not |
|---|---|---|
| `field-ops-app-vite/src/metadata/entityRegistry.js` | **No** | This lane adds no new business Object. The commitment record is already described by the existing `inventoryTransactionEntity` (its header documents the legacy `{workOrderId, partId, type, quantity}` shape verbatim), and `inventory_sync_status` is internal processing metadata that was deliberately never an Object — Rules keep it fully closed, and `types/inventoryTransaction.ts` says it is kept out of the Work Order's public contract on purpose. |
| `field-ops-app-vite/src/access/objectPermissionMap.js` | **No** | No new capability is introduced, because no command or HTTP operation is introduced. The repository is inert, like `cycleCountRepository.ts`. |
| `functions/src/access/permissionCatalog.ts` | **No** | Same reason. A capability with no operation behind it would be a grant for nothing. |
| `firestore.rules` | **No** | Postgres only. No collection is added, removed, or re-scoped. |
| `.github/workflows/**` | **No** | Registering the test in `test:adminPolicyPostgres` (item 1) is the whole CI story; no workflow names these files directly. |
| `docs/architecture/firebase-exit-baseline.json`, `firebase-exit-manifest.json`, `capability-graph.json` | **No** | No Firebase business-runtime dependency is added or removed. `node scripts/firebaseExitGuard.mjs` passes unchanged on this branch. |
| navigation / app shell | **No** | No client surface. |

---

## 3. Non-shared files this branch edited that another lane may also touch

Flagged for merge awareness, not for action. All three are existing tests whose assertions counted
schema objects or migrations by a literal, and each is now computed from the directory or from a
named list so the **next** additive migration does not break them again:

- `functions/test/eosOpsPostgres.test.mjs` — the expected `eos_ops` table list gains the two new tables.
- `functions/test/eosOpsOperatingCompanyCustodyPostgres.test.mjs` — `COMPANY_TABLES` gains
  `inventory_commitments`; `migrate(["down", "1"])` became `downThrough007()`, which counts the
  migrations newer than 007 instead of assuming there are none.
- `functions/test/adminPolicyPostgres.test.mjs` — `down 7` became `down <migration file count>`, and
  the "newest migration reverses alone" proof first unwinds anything newer than 007 so it keeps
  proving what it names.

If another Wave 1 lane also adds a migration, these three now absorb it without further edits.
