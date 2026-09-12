# Non-production activation readiness — measured, not asserted

**Lane P2-C, Phase 2. Evidence only. No object changed, no grant changed, nothing deployed.**

P1A shipped the capability-activation tooling and has been recorded as blocked on
"Postgres/ADC prerequisites" ever since. This document measures that claim instead of repeating it.

**The headline: "blocked on Postgres/ADC prerequisites" is wrong.** Migration 006 is already applied
to the real non-production database; Firestore read access to the sandbox works. What actually
blocks activation is one access gap and two *tooling* gaps that no prerequisite would have fixed —
and the tooling gaps were invisible for as long as the tooling was never run.

Everything below was produced in this worktree, against a throwaway `postgres:16` container on port
`55471`. Nothing ran with `--apply` outside that container. Production (`taylor-parts`) was never
contacted. No Firestore write of any kind was made. No `eos_policy` grant on any real tenant was
changed.

---

## 1. What activation actually requires

Read from source, not from documentation:
`functions/src/eosOps/migration/inventoryCapabilityGrantMigration.ts`,
`functions/scripts/inventoryCapabilityGrantMigrationCli.js`,
`functions/scripts/inventoryCapabilityParityHarness.js`,
`functions/src/eosOps/migration/inventoryWriterCapabilityCensus.ts`,
`functions/src/access/environmentCapabilityOverrides.ts`, `config/environments.json`.

| # | Precondition | Status | Evidence |
|---|---|---|---|
| P1 | A PostgreSQL database carrying migration 006 (`operational-capability-vocabulary`) | **SATISFIED — on the real nonprod database** | `GET https://eos-api-nonprod.onrender.com/health` → `{"ok":true,"environment":"nonprod","reachable":true,"migrated":true,"latencyMs":3,"migrations":7}`. Seven migrations: 006 is applied. Render's `preDeployCommand` (`npm run migrate:up`) applied 004–007 on the deploys that followed 2026-09-10 |
| P2 | A bootstrapped tenant in `eos_policy` | **SATISFIED (documented) / UNPROVEN here** | `docs/architecture/eos-real-nonprod-activation.md` §0, §6: tenant `taylor-nonprod` = `tenant-6ce59be1-1979-45cd-9d17-a4969037fb25`, seeded, with a first administrator. The live `/health` being `migrated:true` corroborates the database; **the tenant row itself was not re-read from the live database by this lane** — see P3 |
| P3 | `DATABASE_URL` reaching that database, for the grant-migration CLI | **BLOCKED** | Verified in this environment: `DATABASE_URL` unset, `POLICY_DATABASE_URL` unset, zero `RENDER_*` variables, no `~/.render`. The Blueprint declares `ipAllowList: []` (not independently verifiable from here — **UNPROVEN**). The CLI is a direct `pg` tool and is **not** an Admin API operation, so it cannot be driven over HTTPS |
| P4 | Compiled `lib/` (`npm ci && npm run build`) | **SATISFIED** | Both ran clean in this worktree; `npm run test:adminPolicyPostgres` → **121 pass, 0 fail** |
| P5 | Firestore read access for the parity harness (`users/{uid}`, `roleAssignments`) | **SATISFIED** | Read-only REST against `eos-platform-sandbox`: `GET users/ZVu3lHTP1NQhj0Am04zTAGou0dx1` → **HTTP 200** (`role="admin"`, `accessVersion=1`); `runQuery` on `roleAssignments` → **HTTP 200**, 1 active global `admin` assignment |
| P6 | The environment's capability **activation overrides** reproduced when the harness runs | **SATISFIED — but previously unnamed** | See §3. `resolveRuntimeCapabilityOverrides()` keys on `GCLOUD_PROJECT ?? GOOGLE_CLOUD_PROJECT`. Unset → empty set → 8 of the 18 compared operations report a **false** `EXTRA_POSTGRES_GRANT` failure |
| P7 | The roster of principal subjects to compare | **PARTIAL** | One real subject is known and readable. `capabilityParityReady` requires `rows.length > 0` over *the principals that matter*; nothing in the repo enumerates them |
| P8 | Grants for the 4 hardcoded-role capabilities | **MISSING — no tool exists** | See §4. Measured, not inferred |
| P9 | Grants for the 5 `inventory.cycleCount.*` capabilities | **MISSING — no tool exists** | See §4. Measured, not inferred |

Environment facts, each re-verified rather than accepted: `sudo` requires a password; the local
cluster on `/var/run/postgresql:5432` has **no role for `rudy2`** (`FATAL: role "rudy2" does not
exist`); `docker` works and `postgres:16` runs.

**A hazard worth naming.** The only Application Default Credential available is an `authorized_user`
whose `quota_project_id` is **`taylor-parts` — production**. Any `firebase-admin` process that does
not explicitly set `GOOGLE_CLOUD_PROJECT` inherits a production-shaped default. Every read this lane
made was scoped explicitly to `eos-platform-sandbox` over REST.

---

## 2. The rehearsal — it worked

Full sequence against the throwaway container (`w2c-pg`, port `55471`), real output.

**Migrations up — all seven.**

```
$ npx node-pg-migrate up --migrations-dir migrations
Migrations complete!

pgmigrations                 7
eos_policy.capabilities     18      (5 from migration 004 + 13 from migration 006)
eos_policy.role_capabilities 0
```

**Tenant seeded** through the canonical operator script, no manual SQL:

```
$ node scripts/bootstrapEosTenant.mjs --key w2c-rehearsal --name "P2-C Rehearsal Tenant" ...
tenant   : tenant-f4a3ed93-c45a-4233-a0ab-2d80f62b9cf7 (w2c-rehearsal) CREATED
seed     : v1 applied
           objects=37 fields=394 roles=48 objectPermissions=256
           workflows=5 versions=5 steps=36 actions=48 bindings=112
```

**The grant migration, DRY RUN — the thing that was supposedly blocked:**

```
$ node scripts/inventoryCapabilityGrantMigrationCli.js --tenant <t> --actor <a> --evidence-dir <d>
tenant tenant-f4a3ed93-c45a-4233-a0ab-2d80f62b9cf7 @ 2026-09-12T06:40:59.421Z -- DRY RUN
  before                  0
  after                   0
  proposed additions      28
  applied additions       0
  unresolved mismatches   0
EXIT=0
```

**28 proposed additions · 0 unresolved · exit 0.** Every Role key the in-repo legacy catalog declares
resolved against a seeded tenant, and every capability key resolved against the catalog. There is no
`UNRESOLVED_ROLE` and no `UNKNOWN_CAPABILITY`. The 28 pairs span 9 Role keys (`admin`, `owner`,
`dispatcher`, `equipmentInstaller`, `inventoryPutAwayOperator`, `inventoryReceivingClerk`,
`inventoryStockRelocationOperator`, `inventoryTransferOperator`, `inventoryTransferReceiver`) and 9
capability keys.

**`--apply`, twice, against the throwaway container only — idempotence measured rather than asserted:**

```
APPLY RUN 1     before 0 · after 28 · proposed 28 · applied 28 · unresolved 0
APPLY RUN 2     before 28 · after 28 · proposed 0  · applied 0  · unresolved 0
UNKNOWN TENANT  UnknownTenantError: unknown tenant: tenant-does-not-exist
```

**The parity harness, against REAL sandbox legacy data.** The legacy side is genuine
`eos-platform-sandbox` content — `users/ZVu3lHTP1NQhj0Am04zTAGou0dx1` and its one active
`roleAssignments` row — read read-only over the Firestore REST API and replayed through a shim
exposing only the two read shapes the harness uses. The `eos_policy` side is the real
`PostgresPolicyRepository` and a real `pg.Pool` against the container, after the full apply above.
With `GOOGLE_CLOUD_PROJECT=eos-platform-sandbox` so the legacy resolver sees the same activation
overrides the sandbox runs with:

```
  operations compared     18
  passed                  12
  failed                  6
  => NOT READY -- do not switch runtime authorization

operation                        legacy  eos    parity  reason
receiving.receive                true    true   PASS    NONE
transfer.create                  true    true   PASS    NONE
transfer.dispatch                true    true   PASS    NONE
transfer.receive                 true    true   PASS    NONE
transfer.cancel                  true    true   PASS    NONE
relocation.relocate              true    true   PASS    NONE
relocation.recordPlacement       true    true   PASS    NONE
workOrderConsumption.record      false   false  PASS    NONE
serializedInstall.install        true    true   PASS    NONE
dataImport.openingBalance        true    true   PASS    NONE
cycleCount.create                true    false  FAIL    MISSING_ROLE_CAPABILITY_GRANT
cycleCount.submit                true    false  FAIL    MISSING_ROLE_CAPABILITY_GRANT
cycleCount.cancel                true    false  FAIL    MISSING_ROLE_CAPABILITY_GRANT
cycleCount.reconcile             true    false  FAIL    MISSING_ROLE_CAPABILITY_GRANT
cycleCount.close                 false   false  PASS    NONE
workOrderReservation.dispatch    true    false  FAIL    MISSING_ROLE_CAPABILITY_GRANT
workOrderReservation.cancel      true    false  FAIL    MISSING_ROLE_CAPABILITY_GRANT
workOrderReservation.complete    false   false  PASS    NONE

capabilityParityReady: false
```

**The nine operations the grant migration covers all reach parity. The nine it does not cover are
exactly the failures.** That is the finding, and it is not a prerequisite problem.

---

## 3. The precondition nobody had named: activation overrides

The legacy half of the parity comparison calls `resolveRuntimeCapabilityOverrides()`, which reads
`process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT`
(`functions/src/access/environmentCapabilityOverrides.ts:763`). Measured:

| capability | `permissionCatalog` `active` | in `platform-sandbox` overrides |
|---|---|---|
| `inventory.stock.receive` | (default active) | no — and it does not need to be |
| `inventory.transfer.{create,dispatch,receive,cancel}` | **false** | yes |
| `inventory.stock.relocate`, `inventory.placement.record` | **false** | yes |
| `equipment.install`, `admin.dataImport.execute` | **false** | yes |
| `inventory.cycleCount.{create,submit,cancel,reconcile}` | **false** | yes |
| `inventory.cycleCount.close` | **false** | **no** |

Eight of these are registered `active:false` — a fail-closed deny that only an environment
activation override lifts. Run the harness with the project id unset and the legacy side denies
them, so the harness reports:

```
FAIL .../transfer.create: EXTRA_POSTGRES_GRANT (legacy=false eos_policy=true)     [x8]
```

Eight failures that are **artefacts of the operator's shell**, not of the migration. An operator who
ran the harness without knowing this would have concluded that `eos_policy` had over-granted, and
the natural remedy — removing grants — would have been exactly wrong.

**Any real parity run must export `GOOGLE_CLOUD_PROJECT=eos-platform-sandbox`** (or the target
environment's project id). Neither the harness header, the P1A evidence document, nor the activation
documents say so.

`inventory.cycleCount.close` is registered `active:false` and is **absent** from the sandbox
override list, so it is denied in sandbox for everyone. Its parity `PASS` above is a true negative,
not coverage.

---

## 4. What is still missing for a real nonprod tenant

### 4.1 Access to the database — the only genuine infrastructure gap

The grant migration is a direct `pg` tool. It is deliberately **not** one of the Admin API's 9 reads
or 14 mutations, so the deployed HTTPS surface cannot run it. It needs a live `DATABASE_URL` to
`eos-policy-nonprod`, which this environment does not have and which no work here should guess,
request or paste.

**Who supplies it:** the **Owner**. Two shapes, and the second is better:

1. An external connection string plus an `ipAllowList` entry — widens a database currently closed to
   the public internet.
2. Run the CLI **inside Render**, where `DATABASE_URL` is already injected `fromDatabase` — a
   one-off job or a shell on `eos-api-nonprod`, `rootDir: functions`, after `npm run build`:
   `node scripts/inventoryCapabilityGrantMigrationCli.js --tenant <id> --actor <uid> --evidence-dir <dir>`
   (no `--apply` first). Nothing is widened and no credential leaves Render.

### 4.2 Two capability families no tool can grant — the real blocker

**`eos_policy.role_capabilities` has exactly one writer in the entire repository**:
`inventoryCapabilityGrantMigration.ts:143`. No migration seeds it; the tenant bootstrap does not
(measured: `role_capabilities` = **0** rows on a freshly seeded tenant). So every grant that store
will ever hold must come from that one tool — and that tool derives its proposals from
`deriveLegacyRoleGrants()`, which reads each Role's declared `permissions` array, restricted to
`newCapabilityKeys()`.

**Gap A — the 4 hardcoded-role capabilities.** Measured:

```
capability keys with ZERO legacy role grant:
    inventory.workOrderConsumption.record
    workOrder.lifecycle.cancel
    workOrder.lifecycle.complete
    workOrder.lifecycle.dispatch
```

These are new vocabulary (migration 006). They exist in no Role's `permissions` array, because their
legacy mechanism was a hardcoded `users/{uid}.role` string or `transitionEngine.ts`'s
`ACTION_PERMISSIONS` matrix — `WRITER_CAPABILITY_CENSUS` records the legacy authority as
`legacyRoles: ['technician']` and `['admin','dispatcher']`. The grant migration is therefore
**structurally incapable** of proposing them: a complete, successful, zero-unresolved apply run
leaves all four ungranted, for every Role, for ever. The P1A evidence document's
`CAPABILITY_PARITY_READY` rule can never be met while that is true.

Proved twice, under the same sandbox environment. The real-sandbox `admin` principal fails
`workOrderReservation.{dispatch,cancel}` (§2). A second rehearsal, with a principal holding
`inventoryReceivingClerk` + `technician` on both sides, returns **16 passed / 2 failed** — failing
`workOrderConsumption.record` and `workOrderReservation.complete`, both
`MISSING_ROLE_CAPABILITY_GRANT`. Between them the two runs cover all four hardcoded-role
capabilities, and every one of them fails.

**Gap B — the 5 cycle-count capabilities.** The P1A evidence document says Cycle Count is "already
migrated, migration 004, P0. Untouched here." Migration 004 creates the **catalog rows**; it does
not create **grants**, and `newCapabilityKeys()` returns 13 keys that exclude all five. So no tool
reconciles them either, and the census compares them — producing the four `cycleCount.*` failures
above.

**Who supplies these:** an **engineering decision, then the Owner**. Neither is a credential
problem. The census already records the legacy authority for the four hardcoded keys, so the fix is
a deliberate extension — a declared role→capability mapping for the hardcoded writers, and widening
the reconciled key set to include migration 004's five — each an Owner-visible authority decision,
not a mechanical backfill. **Until one lands, no tenant can reach `CAPABILITY_PARITY_READY`, with or
without a database URL.**

### 4.3 The principal roster

`capabilityParityReady` requires `rows.length > 0` and every principal resolved. The harness takes
`--subject` arguments and nothing in the repository enumerates which subjects a real verdict must
cover. **Who supplies it:** the **Owner** names the sandbox principals that must be in parity.

### 4.4 Not blockers

Re-pointing the eight writers' authorization at `eos_policy` is step 4/8 of the cutover document and
explicitly out of scope. Nothing here changes runtime authorization for any writer.

---

## 5. Does Wave 1 change any precondition? No.

Read from the branches, not from titles. Eleven of the open Wave-1 branches add a migration:

| branch | migration | schema |
|---|---|---|
| `w1-inventory-commitment` | `1758067200000_inventory-commitment-and-work-order-replay` | `eos_ops` |
| `w1-warehouse-bin` | `1758240000000_warehouse-and-bin-location-authority` | `eos_ops` |
| `w1-truck-mobile` | `1758326400000_truck-and-mobile-location-registry` | `eos_ops` |
| `w1-employee-principal` | `1758412800000_employee-principal-linkage` | **`eos_policy`** |
| `w1-supplier-manufacturer` | `1758499200000_supplier-and-supplier-catalog-authority` | `eos_ops` |
| `w1-equipment` | `1758585600000_equipment-and-installed-custody` | `eos_ops` |
| `w1-purchasing` | `1758672000000_purchasing-object-authority` | `eos_ops` |
| `w1-account-contact-location` | `1758758400000_crm-account-contact-location` | `eos_crm` |
| `w1-commercial` | `1758844800000_commercial-ownership-authority` | `eos_commercial` |
| `w1-invoice` | `1758931200000_invoice-authority` | `eos_ops` |
| `w1-payment` | `1759017600000_ar-cash-application-authority` | `eos_ops` |

Measured across all eleven files: **zero** references to `eos_policy.role_capabilities` or
`eos_policy.capabilities`. The one that writes into `eos_policy` adds `employee_principal_links` and
touches no authority table. Their references to `eos_policy.tenants` / `eos_policy.principals` are
foreign keys.

Measured across all 32 `impl/w1-*` branches: **none** modifies `permissionCatalog.ts`,
`environmentCapabilityOverrides.ts`, `config/environments.json`, `compatibilityRoles.ts`,
`governedBusinessRoles.ts`, migration 006, the parity harness, the grant CLI, or the writer census.
Five add new, unrelated files under `src/eosOps/migration/` (per-domain migration sources).

Applied together on a separate database in the same throwaway container, in timestamp order:

```
### MIGRATION 1757462400000_admin-policy (UP) ###
  ... all 18 ...
### MIGRATION 1759017600000_ar-cash-application-authority (UP) ###
Migrations complete!

pgmigrations                 18
eos_policy.capabilities      18      <- unchanged: Wave 1 adds zero capabilities
eos_policy.role_capabilities  0
schemas: eos_commercial 4 · eos_crm 3 · eos_ops 25 · eos_policy 22 (was 21) · public 1
```

**Wave 1 changes no activation precondition.** It raises the migration count 7 → 18 and adds two
schemas, both handled by the existing `preDeployCommand`. Every timestamp is later than
`1757980800000`, so ordering is unambiguous. (Whether the eleven branches integrate *as code* is
lane P2-A's verdict, not this one's — what is measured here is only that their migrations coexist.)

---

## 6. UNPROVEN — recorded rather than repeated

- The Render database's `ipAllowList: []` and the tenant id `tenant-6ce59be1-…` are read from
  `eos-real-nonprod-activation.md`. This lane holds **no** Render credential and did not verify
  either. The live `/health` response is the only direct measurement of that database taken here.
- Whether the real `taylor-nonprod` tenant's `role_capabilities` table is empty is **unknown** — it
  cannot be read without P3. On a freshly bootstrapped tenant it is empty, and the only writer is a
  tool nobody has reported running, so empty is likely; it is not proved.
- The parity numbers in §2 are for a **rehearsal tenant** whose seed is current-`main`'s (48 Roles).
  The real tenant was seeded 2026-09-10 at 46 Roles. Role-catalog drift between the seeded tenant and
  today's code is a real risk for a live run and is **not measured here**.
- The legacy Firestore data replayed in §2 is real, but covers **one** principal.

---

## 7. The answer

**Is nonprod activation achievable now? No — and not for the reason recorded.**

The prerequisites everyone has been waiting on are largely already met: migration 006 is live on the
real non-production database, and sandbox Firestore is readable. The grant migration runs, proposes
28 correct grants, applies them idempotently and refuses an unknown tenant — measured, end to end,
today.

What stands between here and an activated tenant is one access decision the Owner can make in an
afternoon (§4.1), and two capability families that **no tool in the repository can grant** (§4.2).
The second is the real blocker, it is an engineering gap rather than an infrastructure one, and it
would have stayed invisible for exactly as long as the tooling went unrun.
