# Inventory-authority capability parity — P1A evidence

Step 2 of [`docs/design/eos-operational-data-plane-inventory-authority-cutover.md`](design/eos-operational-data-plane-inventory-authority-cutover.md):
"Capability authority seeded/reconciled in PostgreSQL." This document records what P1A shipped, the
exact writer → capability matrix, the parity harness and grant-migration tool contracts, and the
`CAPABILITY_PARITY_READY` activation rule. **No inventory writer authority changed. No client
transport changed. No tenant was cut over.** This is control/tooling evidence only.

## 1. Writer → capability matrix

Source of truth: `functions/src/eosOps/migration/inventoryWriterCapabilityCensus.ts`
(`WRITER_CAPABILITY_CENSUS`). Read directly from source, not inferred from documentation.

| Writer family | Operation | Capability key | Legacy mechanism |
|---|---|---|---|
| Receiving | receive | `inventory.stock.receive` | Capability catalog |
| Transfer | create / dispatch / receive / cancel | `inventory.transfer.{create,dispatch,receive,cancel}` | Capability catalog |
| Relocation | relocate, then optionally recordPlacement | `inventory.stock.relocate`, `inventory.placement.record` | Capability catalog (two-stage) |
| Work Order physical consumption | record | `inventory.workOrderConsumption.record` | **Hardcoded `users/{uid}.role !== "technician"` + ownership guard — no legacy capability key existed** |
| Serialized asset install | install | `equipment.install` | Capability catalog |
| Data Import opening balance | openingBalance | `admin.dataImport.execute` | Capability catalog |
| Cycle Count reconcile | create / submit / cancel / reconcile / close | `inventory.cycleCount.*` | Capability catalog — **already migrated, migration 004, P0. Untouched here.** |
| Work Order reservation/commitment lifecycle | dispatch / cancel / complete | `workOrder.lifecycle.{dispatch,cancel,complete}` | **Hardcoded `transitionEngine.ts` `ACTION_PERMISSIONS` role matrix — `inventoryService.ts` itself performs zero authorization; authority is entirely inherited from the WO transition that triggered it** |

13 new capability catalog rows (migration 006); 9 preserve an existing legacy string exactly, 4 are
new vocabulary for the two writers above. The five Cycle Count keys (migration 004) are untouched.

**Load-bearing scope note.** `workOrder.lifecycle.*` covers exactly the three `ACTION_PERMISSIONS`
entries (`Dispatch`, `Cancel`, `Complete`) that drive the inventory-commitment triggers — not the
full WO action matrix (`MarkReady`/`Schedule`/`Unschedule`/`Accept`/`Travel`/`Arrive`/`WorkStart`
are unrelated to the inventory-authority writer boundary and are untouched).

**Legacy scope is global, not tenant-scoped.** Every `resolveEffectivePermission` call the six
capability-catalog writers make passes `{ scope: { type: "global" }, condition: {} }` — confirmed by
direct read of every `make*PermissionThroughTxn` wiring function. The legacy decision for a given
principal is therefore the SAME regardless of which `eos_policy` tenant it is being compared
against; only the `eos_policy` side is tenant-scoped. The parity harness's `SPOOFED_TENANT_REFUSAL`
class exists specifically to make this asymmetry explicit rather than let a stated foreign tenant
silently "inherit" a tenant-agnostic legacy allow.

## 2. PostgreSQL

`functions/migrations/1757894400000_operational-capability-vocabulary.sql` — additive, catalog-only
(no `role_capabilities` rows), reversible, idempotent through `node-pg-migrate`'s own tracking,
tenant-safe (the `capabilities` catalog itself carries no `tenant_id`, same as migration 004). No
Role model change — extends the existing `eos_policy.capabilities` / `role_capabilities` shape
migration 004 established.

## 3. Parity harness

`functions/scripts/inventoryCapabilityParityHarness.js`. **MIGRATION_ONLY, read-only, both sides.**

- **Why it lives in `functions/scripts/`, not `functions/src/eosOps/` or `functions/src/adminPolicy/migration/`:**
  it genuinely needs to read Firestore (`roleAssignments`, `users/{uid}.accessVersion`,
  `users/{uid}.role`) to prove parity against the exact legacy data the live writers read today.
  `scripts/firebaseExitGuard.mjs` fences any NEW `firebase-admin/firestore` dependency added under
  `functions/src` — adding one there would require a new `firebase-exit-baseline.json` entry, which
  this packet's brief explicitly forbids. `functions/scripts/` is operator-run tooling, is never
  bundled into the deployed Cloud Functions runtime, and is outside both of the guard's scan roots.
  It is inert on `require` — nothing executes except under `require.main === module`.
- **Legacy source:** Firestore `roleAssignments` (`principalUid`, `roleId`, `status`) +
  `users/{uid}.accessVersion`, resolved through the SAME `resolveEffectivePermission` +
  `COMPATIBILITY_ROLES`/`GOVERNED_BUSINESS_ROLES` catalog + `resolveRuntimeCapabilityOverrides()`
  every live writer's `authorize(...)` call uses, for the 6 capability-catalog writers;
  `users/{uid}.role` directly for the 2 hardcoded-role writers.
- **Target source:** `eos_policy` via `resolvePrincipalContext` (adminPolicy) +
  `capabilitiesForRoleKeys`/`listCapabilityKeys` (eosOps's `capabilityAuthority.ts` — the ONE module
  permitted to hold SQL against `role_capabilities`/`capabilities`; the harness itself contains no
  SQL and no `pg` import).
- **Read only by default:** always — there is no write path in this module at all (no
  `.set`/`.add`/`.update`/`.delete`/`.create` against Firestore, no PostgreSQL write of any kind).
- **Mismatch classes covered** (`classify()`, proved in
  `test/inventoryCapabilityParityHarnessClassification.test.mjs`): `MISSING_PRINCIPAL_MAPPING`,
  `MISSING_ACTIVE_ASSIGNMENT` (no membership / ambiguous tenant / inactive tenant),
  `DISABLED_PRINCIPAL`, `DISABLED_ASSIGNMENT` (stale-assignment exclusion), `MISSING_ROLE`,
  `MISSING_CAPABILITY_CATALOG_ENTRY`, `MISSING_ROLE_CAPABILITY_GRANT`, `EXTRA_POSTGRES_GRANT`,
  `SPOOFED_TENANT_REFUSAL` (a stated foreign tenant is refused — reported PASS, the correct security
  behavior, never a migration gap), `CAPABILITY_KEY_MISMATCH`.
- **Deletion condition** (also in the module's own header): delete this file, its test, when (1)
  every tenant reports `CAPABILITY_PARITY_READY`, (2) the eight writers' authorization has been
  re-pointed at `eos_policy` (a future packet, not this one), and (3) the legacy Firestore checks it
  reads are no longer read by anything in production.

## 4. Capability grant migration tool

`functions/src/eosOps/migration/inventoryCapabilityGrantMigration.ts`, CLI in
`functions/scripts/inventoryCapabilityGrantMigrationCli.js`. **Nonprod. No Firestore access at
all** — the "legacy source" it reconciles is the in-repo Role catalog
(`compatibilityRoles.ts`/`governedBusinessRoles.ts`'s declared `permissions` arrays), not Firestore
data, so there is nothing for `eosOpsNoFirebase.test.mjs`'s guard to catch.

- **Dry-run default:** `apply` defaults to `false`; nothing writes unless `--apply` is passed.
- **Apply flag:** `--apply` on the CLI (`apply: true` on the underlying function).
- **Idempotency proof:** `test/inventoryCapabilityGrantMigration.test.mjs` (real PostgreSQL,
  postgres:16 CI lane) — a first `apply` writes exactly the proposed additions; a second `apply`
  over the same tenant proposes and applies zero additional changes.
- **Refusals:** unknown tenant (throws outright), unresolved role (`UNRESOLVED_ROLE`, reported never
  fabricated), unknown capability (`UNKNOWN_CAPABILITY`, reported never fabricated). Cross-tenant
  mappings are structurally impossible, not merely refused: every read and write is filtered
  `tenant_id = $1`, so a Role in a different tenant is indistinguishable from one that does not
  exist — proved by the dedicated cross-tenant isolation test.
- **Evidence:** `describeReconcileReport()` (human-readable) and the CLI's `--evidence-dir` flag
  (deterministic JSON: sorted rows, before/after counts, proposed/applied counts, unresolved list).

## 5. `CAPABILITY_PARITY_READY`

A tenant is `CAPABILITY_PARITY_READY` (`buildInventoryCapabilityParityReport`'s
`capabilityParityReady`) only when, over every (principal, operation) pair compared:

- every row is `PASS` (`failed === 0`);
- at least one row was compared (`rows.length > 0` — an empty comparison is not evidence of
  readiness);
- no row's mismatch reason is `MISSING_PRINCIPAL_MAPPING` or `DISABLED_PRINCIPAL` (every principal
  resolved);
- no row's mismatch reason is `MISSING_ROLE` or `MISSING_CAPABILITY_CATALOG_ENTRY` (every role
  mapping and capability key resolved).

This packet proves the tooling that CAN compute this rule. It does not run the harness against any
real tenant's live data, and it does not switch runtime authorization for any of the 8 writers —
that remains step 4/8 of the cutover document's future work.
