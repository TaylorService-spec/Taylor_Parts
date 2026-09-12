# W1-C15 — Inventory Transaction cutover tooling: registrations

Lane C15 (`impl/w1-inventory-cutover-tooling`). Scope: read-only/offline cutover **tooling** for the
legacy Inventory Transaction → `eos_ops.inventory_movements` migration. No cutover was performed.

## Shared files edited

**None.** This lane edited no file on the DO-NOT-EDIT list.

## Registrations required right now

**None.** The deliverable is one pure TypeScript module plus its test:

- `functions/src/eosOps/migration/legacyInventoryMovementRun.ts`
- `functions/test/legacyInventoryMovementRun.test.mjs`

It declares no entity, no permission, no callable, no route, no navigation entry and no collection,
so there is nothing to register in `entityRegistry.js`, `objectPermissionMap.js`,
`permissionCatalog.ts`, `firestore.rules`, `capability-graph.json` or the app shell. It imports no
Firebase and touches no Firestore collection name, so `firebase-exit-baseline.json` /
`firebase-exit-manifest.json` are unchanged (guard verified clean).

## SQL migration

**None needed.** Deliberately, and verified mechanically by the last test in
`legacyInventoryMovementRun.test.mjs`:

- `migrations/1757808000000_eos-ops-foundation.sql` already declares
  `idempotency_key TEXT` and `CREATE UNIQUE INDEX inventory_movements_idempotency ON
  inventory_movements (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL` — which is the
  entire mechanism this lane's replay safety rests on.
- `migrations/1757980800000_operating-company-and-serialized-custody.sql:126` already added
  `operating_company_key TEXT NOT NULL` to `inventory_movements`.

Pre-allocated migration id `1759190400000` was therefore **not used** and remains free.

Consequence: the shared migration-count assertions
(`functions/test/eosOpsOperatingCompanyCustody.test.mjs:37` — `assert.equal(files.length, 7)`;
`functions/test/eosOpsPostgres.test.mjs:109` — the exact four-table list) were **not touched and did
not need the canonical ORDER-not-COUNT fix**. A future lane that does add a migration still will.

## Deliberately deferred — for whichever lane actually cuts over

These are named so they are decisions someone makes, not omissions someone discovers:

1. **Reject-bucket persistence.** The reject bucket is a serializable value (`RejectBucket`), not an
   `eos_ops` table. If the cutover wants it durable in Postgres, that is a new migration + a writer +
   a reader, and it needs the migration id this lane did not spend. An offline JSON artifact next to
   the manifest requires nothing new.
2. **Operating-company → `eos_policy.tenants.id` crosswalk.** `OpsMovementCandidate` carries
   `operatingCompanyKey` (`taylor` | `ventana`), never a `tenant_id`. The manifest takes
   `destinationTenantId` as an operator-supplied input. Owning that crosswalk is someone else's job.
3. **The source-side census.** `planLegacyInventoryMovementRun` accepts `expectedBalances` and
   reports `UNVERIFIED` without them. Producing those expectations means reading the legacy store —
   out of scope here, and the reason the verdict is allowed to abstain.
4. **The importer itself.** Nothing in this lane writes Postgres. `planImport()` hands a future
   importer `toInsert` / `alreadyPresent`; that importer must write `idempotencyKey` (never NULL) and
   should use `ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`.
