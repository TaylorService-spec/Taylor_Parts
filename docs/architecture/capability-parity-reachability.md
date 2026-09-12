# `CAPABILITY_PARITY_READY` reachability, and the governed non-production activation path

**Lane P2-C1.** Measured 2026-09-12 against integrated head `d104cf49`, in a throwaway
`postgres:16` container owned by this lane alone. **Nothing in production was contacted. No
Firestore document was read or written. No real tenant's grants changed.** Every number below is
reproducible from this repository plus an empty PostgreSQL 16.

---

## 0. The finding, in one paragraph

A prior lane reported that no tenant can reach `CAPABILITY_PARITY_READY`. **That is confirmed for
any principal who actually exercises an inventory writer — and it is refuted as stated**, because
the `capabilityParityReady` predicate is *vacuously satisfiable*: a principal set in which nobody
holds any of the eighteen census capabilities reports `CAPABILITY_PARITY_READY` with 18/18 PASS
(§3.3, measured). The sibling's diagnosis was also incomplete in a way that matters: the blocker is
**not only** that `eos_policy.role_capabilities` has no writer. It is that
`eos_policy.role_capabilities` reproduces **GRANT** and has **no representation of ACTIVATION at
all** — so running the grant migration in a non-activating environment does not move a tenant
*toward* parity, it moves it *away*, converting eight passing rows into `EXTRA_POSTGRES_GRANT`
failures (§3.1, measured). Parity is reachable only where the *environment* activates the
capability, which today means exactly one Firebase project: `eos-platform-sandbox`.

---

## 1. What the sibling claimed, and what is actually true

| Sibling's claim | Verdict | Measured |
|---|---|---|
| dry-run `proposed 28 / applied 0`; apply `0 → 28`; re-apply `28 → 28 / applied 0`; unknown tenant fails closed | **CONFIRMED, reproduced exactly** | §2.2 |
| `eos_policy.role_capabilities` has exactly one writer; no migration or seed inserts grants; 0 rows on a fresh tenant | **CONFIRMED** | §2.1 |
| 4 hardcoded-role keys are in no Role → can never be proposed | **CONFIRMED, and stronger than stated** — they are absent from `PERMISSION_CATALOG` entirely (147 ids), so even `admin`, which holds *every* catalog id by construction, cannot hold them | §2.3 |
| 5 `inventory.cycleCount.*` keys are reconciled by nothing | **CONFIRMED as to reconciliation, but the stated reason is wrong for 4 of the 5** | §2.4 |
| "the 9 operations the grant migration covers reach parity; the 9 it does not are exactly the failures" | **IMPRECISE.** Only **8** of the 9 uncovered operations can ever fail; `cycleCount.close` passes vacuously because *both* sides deny it (§2.5). And which of the 8 fail depends entirely on the principal — an admin fails 6, a technician 2 | §3.2 |
| "no tenant can reach `CAPABILITY_PARITY_READY` with or without a database URL" | **REFUTED AS STATED.** The predicate is vacuously satisfiable (§3.3). True in substance for any principal that exercises a writer | §3.3 |
| "blocked on Postgres/ADC was false" | **CONFIRMED.** This entire document was produced with no ADC, no Firestore, no GCP call, and a local container | throughout |

---

## 1.5 Reconciliation with lane P2-B3 — "zero catalogued capabilities are ungranted"

Lane P2-B3 reports that of **147 catalogued capabilities across 48 Roles, ZERO are
inert-and-ungranted**, and that the program-wide belief in ungranted catalogued capabilities is
stale. **I re-measured this independently and it is exactly right:**

```
catalog ids: 147 | roles: 48
catalogued-but-held-by-NO-role: 0   []
inventory.balance.read holders: 17
inventory.catalog.manage   active=undefined  holders=9
inventory.catalog.activate active=undefined  holders=3
admin permission count: 147
```

It could not be otherwise: `compatibilityRoles.ts:235-240` defines `ADMIN_ALL_PERMISSIONS` as every
`PERMISSION_CATALOG` id, so `admin` holds all 147 by construction and `owner` inherits by
composition. (21 of the 147 are held by `admin`/`owner` *only* — a different question, and not
this lane's.)

**Nothing in this document contradicts that, and no parity gap here is attributed to an absent Role
grant for a catalogued capability.** Two distinctions carry the whole analysis, and blurring either
one reproduces the stale belief in a new form:

**Distinction A — catalogued vs. not catalogued at all.** The five keys this lane names as
"held by no Role" are **not among the 147**. Measured:

| key | in `PERMISSION_CATALOG`? | Roles holding it |
|---|---|---|
| `inventory.workOrderConsumption.record` | **no** | 0 |
| `workOrder.lifecycle.dispatch` | **no** | 0 |
| `workOrder.lifecycle.cancel` | **no** | 0 |
| `workOrder.lifecycle.complete` | **no** | 0 |
| `inventory.cycleCount.close` | **no** | 0 |

These are not ungranted capabilities. They are **not capabilities** — they are hardcoded
`users/{uid}.role` string comparisons (§2.3) and, in the `close` case, a key nothing checks (§2.5).
P2-B3's census covers the 147; these five sit outside it. Both measurements are true.

**Distinction B — a Role's `permissions` array (code) vs. an `eos_policy.role_capabilities` row
(PostgreSQL).** These are different objects and the harness's failure reason names the second one.
`inventory.cycleCount.{create,submit,cancel,reconcile}` **are** granted in the Role catalog — §2.4
says so explicitly and corrects the earlier sibling claim that they were not. They nonetheless
report `MISSING_ROLE_CAPABILITY_GRANT` because the eos_policy **projection** of that grant was never
materialized: `newCapabilityKeys()` filters every `inventory.cycleCount.*` key out of what the grant
migration proposes (`inventoryWriterCapabilityCensus.ts:261`). The grant exists; the row does not.

**On the denial mechanism.** P2-B3 is right that the real mechanism is `active: false` plus
per-environment activation, and this document reaches the same conclusion from the other direction
and makes it the headline (§0, §2.6, §3.1) — with the measured consequence P2-B3's framing implies
but does not state: because `eos_policy.role_capabilities` has **no activation concept at all**,
applying the grant migration in a non-activating environment converts eight *passing* rows into
`EXTRA_POSTGRES_GRANT` failures. The remedy is **OR-1**, not a grant.

---

## 2. The verified chain, with `path:line` evidence

### 2.1 Capability definition → the grant table has exactly one writer

* `functions/migrations/1757721600000_operational-capabilities.sql:49` — migration 004 `INSERT INTO
  capabilities` (5 Cycle Count rows). `:62` creates `role_capabilities`. **The file inserts nothing
  into it.**
* `functions/migrations/1757894400000_operational-capability-vocabulary.sql:66` — migration 006
  `INSERT INTO capabilities` (13 rows). **Also inserts nothing into `role_capabilities`.**
* Those two `INSERT`s are the **only** `INSERT` statements in all 18 migration files.
* Repository-wide, exactly two statements write `role_capabilities`:
  `functions/src/eosOps/migration/inventoryCapabilityGrantMigration.ts:144` (the grant migration)
  and `functions/test/eosOpsPostgres.test.mjs:101` (a test fixture). There is **no Administration
  API operation** for capability grants: `functions/src/adminPolicy/adminPolicyApi.ts` contains no
  occurrence of the string `capability`.
* The tenant seed writes Roles and Object CRED and **never a capability grant**:
  `functions/src/adminPolicy/seed/policySeed.ts:197-215` (roles), `:220-232` (object permissions).

**Measured on a fresh tenant** (`bootstrapEosTenant.mjs --key p2c1-nonprod`, seed v1):
`capabilities = 18`, `roles = 48`, `role_capabilities = 0`.

### 2.2 The grant migration, rehearsed (throwaway container only)

```
DRY RUN   before 0   after 0    proposed 28   applied 0    unresolved 0
APPLY     before 0   after 28   proposed 28   applied 28   unresolved 0
RE-APPLY  before 28  after 28   proposed 0    applied 0    unresolved 0
unknown tenant → UnknownTenantError: unknown tenant: no-such-tenant
```

Identical to the sibling's numbers. The tool works. The tool is not the problem.

### 2.3 Role grants — what the 28 proposals actually are

`deriveLegacyRoleGrants()` reads the same `Role.permissions` arrays the live resolver reads
(`functions/src/eosOps/migration/inventoryCapabilityGrantMigration.ts:38-48`). Derived from the
compiled catalog:

| capability key (the 13 of migration 006) | Roles that declare it |
|---|---|
| `admin.dataImport.execute` | `admin`, `owner` |
| `equipment.install` | `admin`, `equipmentInstaller`, `owner` |
| `inventory.placement.record` | `admin`, `inventoryPutAwayOperator`, `owner` |
| `inventory.stock.receive` | `admin`, `dispatcher`, `inventoryReceivingClerk`, `owner` |
| `inventory.stock.relocate` | `admin`, `inventoryStockRelocationOperator`, `owner` |
| `inventory.transfer.cancel` | `admin`, `inventoryTransferOperator`, `owner` |
| `inventory.transfer.create` | `admin`, `inventoryTransferOperator`, `owner` |
| `inventory.transfer.dispatch` | `admin`, `inventoryTransferOperator`, `owner` |
| `inventory.transfer.receive` | `admin`, `inventoryTransferOperator`, `inventoryTransferReceiver`, `owner` |
| `inventory.workOrderConsumption.record` | **none** |
| `workOrder.lifecycle.cancel` | **none** |
| `workOrder.lifecycle.complete` | **none** |
| `workOrder.lifecycle.dispatch` | **none** |

= 28 pairs. `admin` appears against every catalogued key because
`functions/src/access/compatibilityRoles.ts:235-240` defines `ADMIN_ALL_PERMISSIONS` as *every*
`PERMISSION_CATALOG` id; `owner` inherits by composition. **Which is precisely why the four
hardcoded keys can never be proposed: they are not in `PERMISSION_CATALOG` at all** (measured: all
four `ABSENT`, catalog size 147). No amount of Role administration reaches them; they are not
capabilities anywhere in the legacy system — they are role-string comparisons
(`functions/src/updateWorkOrderExecutionData.ts` ~L128,
`functions/src/transitionEngine.ts` `ACTION_PERMISSIONS`).

### 2.4 Cycle Count — the sibling's reason is wrong for 4 of the 5 keys

Migration 004 created catalog rows, not grants — correct. But the Role catalog **does** declare
four of the five:

| key | Roles | in `PERMISSION_CATALOG`? |
|---|---|---|
| `inventory.cycleCount.create` | `admin`, `inventoryCycleCountCounter`, `owner` | yes (`permissionCatalog.ts:1345`) |
| `inventory.cycleCount.submit` | `admin`, `inventoryCycleCountCounter`, `owner` | yes (`:1352`) |
| `inventory.cycleCount.cancel` | `admin`, `inventoryCycleCountCounter`, `owner` | yes (`:1366`) |
| `inventory.cycleCount.reconcile` | `admin`, `inventoryCycleCountReconciler`, `owner` | yes (`:1359`) |
| `inventory.cycleCount.close` | **none** | **NO — absent entirely** |

So for the first four the fact is not "no Role holds them" but **"the grant migration deliberately
excludes them"**: `newCapabilityKeys()` filters every `inventory.cycleCount.*` key out
(`functions/src/eosOps/migration/inventoryWriterCapabilityCensus.ts:261`), because P1A-3
scoped itself to the keys migration 006 adds. The grants are derivable; the tool is told not to
derive them. That is a **scope** gap, not a data gap — and it is the single largest remaining
contributor to non-parity for an administrator principal (4 of its 6 failures).

### 2.5 `inventory.cycleCount.close` is a capability nothing checks — a census defect

* No `PERMISSION_CATALOG` entry. No Role. No code reference outside the census and the eos_policy
  catalog type (`functions/src/eosOps/capabilityAuthority.ts:45`).
* The actual close command authorizes against **`reconcile`**:
  `functions/src/cycleCount/cycleCountSheetCommand.ts:450` —
  `if (!(await deps.authorize(txn, actor.id, CYCLE_COUNT_CAPABILITY.reconcile))) throw new UnauthorizedCycleCountError();`
  inside `closeCycleCountSheet` (`:445`). `functions/src/cycleCount/cycleCountCommand.ts:78-81`
  declares only four capability constants; there is no close constant.
* Yet the census asserts `capabilityKey: "inventory.cycleCount.close"` **and**
  `legacyCapabilityKey: "inventory.cycleCount.close"` for operation `cycleCount.close`
  (`inventoryWriterCapabilityCensus.ts:202-207`), under a file header that promises the table is
  "read directly from source, never inferred from documentation."

**Consequence today:** harmless-looking. The legacy resolver returns
`DENY / unknownPermission` (`functions/src/access/resolveEffectivePermission.ts:242-244`) and
eos_policy has no grant, so the row passes — **vacuously, for the wrong reason**. **Consequence
tomorrow:** it is a trap. An operator chasing parity who grants `inventory.cycleCount.close` in
eos_policy creates authority that *no legacy check corresponds to*, and the row flips to
`EXTRA_POSTGRES_GRANT`. Conversely, once `reconcile` is granted, the harness will report the
close operation "in parity" while eos_policy holds nothing named `close`.

**Not fixed here** — see Owner ruling **OR-3** (§6). There are two defensible remedies and choosing
between them is a judgement about whether closing a sheet deserves its own authority.

### 2.6 Environment activation — the link the sibling's account omits entirely

Every census capability except `inventory.stock.receive` is registered `active: false` in
`PERMISSION_CATALOG`, which is an unconditional DENY *ahead of any Role grant*
(`functions/src/access/resolveEffectivePermission.ts:264-266`). The only thing that lifts it is a
per-environment activation override:

| Firebase project | role | census keys it activates |
|---|---|---|
| `eos-platform-sandbox` | sandbox | **12 of 14** (all 4 transfer, relocate, placement, equipment.install, admin.dataImport.execute, 4 cycleCount) |
| `demo-certworld` | sandbox | 9 (snapshot-only emulator, governed exception, `test/environmentCapabilityOverrides.test.mjs:274-277`) |
| `eos-platform-certification` | sandbox | 3 |
| `local-emulator`, `platform-integration` | sandbox / integration | 0 (no project id) |
| **`taylor-parts`** | **production** | **0** |

`inventory.stock.receive` carries no `active` flag at all — it is the one census capability live in
**every** environment, production included, wherever a Role grant exists.

**`eos_policy.role_capabilities` has no activation concept whatsoever.**
`capabilitiesForRoleKeys` (`functions/src/eosOps/capabilityAuthority.ts:76-92`) joins
`role_capabilities → capabilities → roles` and returns the key set. There is no `active` column, no
environment, no override. A granted capability is simply held.

### 2.7 Principal → tenant → resolver → API

* `resolvePrincipalContext` (`functions/src/adminPolicy/principalContext.ts:98-146`): unknown
  subject → `UNKNOWN_PRINCIPAL`; non-active principal → `PRINCIPAL_DISABLED`; no membership →
  `NO_TENANT_MEMBERSHIP`; **a stated tenant that is not a membership → `TENANT_NOT_A_MEMBERSHIP`**
  (never adopted); several memberships with none stated → `AMBIGUOUS_TENANT`; inactive tenant →
  `TENANT_NOT_ACTIVE`. `heldRoleKeys` (`:135`) is the last identity hop.
* The first administrator is created by `bootstrapAdministrator`
  (`functions/src/adminPolicy/tenantBootstrap.ts:160-235`): operator-run only, one-time per tenant
  (`tenant_admin_bootstraps` keyed by tenant), refuses if the tenant already has an administrator
  (`:190`), and assigns `ADMIN_ROLE_KEY` only.
* API surface: one read operation, `resolveMyCapabilities`
  (`functions/src/eosOps/eosOpsHttp.ts:37`), mounted at
  `functions/src/eosApi/server.ts:159`. **There is no write operation for capability grants
  anywhere in the transport.** Lane P2-B3 measured the deployed Render service as exposing exactly
  `/health`, `/admin/policy/*` and `/operations/inventory` — i.e. the transport carries *no* route
  to any other Postgres authority, so for every eos_ops domain except this one capability read,
  **transport, not authorization, is the binding constraint**. That does not change this lane's
  analysis, whose entire subject (`resolveMyCapabilities`) is one of the three routes that does
  exist.
* **Stale comment, recorded:** `functions/src/eosApi/server.ts:19-23` states "NOT DEPLOYED ... there
  is no Render service." There is: `eos-api-nonprod.onrender.com`
  (`docs/architecture/eos-real-nonprod-activation.md` §0), confirmed live by P2-B3's route census.
  The comment is wrong and is not corrected here (outside this lane's diff).
* That service refuses to start when `EOS_ENVIRONMENT` names production
  (`functions/src/eosApi/server.ts`, `ServiceConfigError`), and `render.yaml` declares a
  non-production Blueprint only.

---

## 3. Reachability, measured

Method: real PostgreSQL (throwaway container), real `PostgresPolicyRepository`, real seeded tenant,
real compiled resolver and Role catalog — and a **stub Firestore** supplying the legacy
`users/{uid}.role` / `accessVersion` / `roleAssignments` facts. `resolveRuntimeCapabilityOverrides`
reads only `process.env.GCLOUD_PROJECT` plus the in-bundle registry snapshot, so the environment
axis is exercised offline. No network, no GCP, no Firestore.

Three principals, in the tenant, after the grant migration applied its 28 rows:
`uid-admin` (`users.role=admin`, assigned `admin`), `uid-tech` (`technician` / `technician`),
`uid-xfer` (`users.role=technician`, assigned `inventoryTransferOperator`).

### 3.1 No activating environment (`GCLOUD_PROJECT` unset — the production-shaped case)

**54 compared · 36 passed · 18 failed · NOT READY**

* **8 × `EXTRA_POSTGRES_GRANT`** (`legacy=false eos_policy=true`) — transfer ×4, relocate,
  recordPlacement, serializedInstall, dataImport, for admin; transfer ×4 for the transfer operator.
  Legacy denies on `inactivePermission`; eos_policy has no such gate and allows.
* 10 × `MISSING_ROLE_CAPABILITY_GRANT` — the four hardcoded keys.

**This is the result that matters most and the sibling did not report it: in a non-activating
environment, applying the grant migration makes parity strictly worse.** Before the apply those
eight rows passed (both sides denied). The tool is safe, idempotent and correct, and running it in
the wrong environment still produces a *less* parity-ready tenant.

### 3.2 Sandbox activation on (`GCLOUD_PROJECT=eos-platform-sandbox`)

**54 compared · 44 passed · 10 failed · NOT READY**

Every remaining failure is `MISSING_ROLE_CAPABILITY_GRANT`, and there are exactly two families:

| # | rows | family | why it can never be closed by this tool |
|---|---|---|---|
| 1 | 4 (admin) | `cycleCount.create/submit/cancel/reconcile` | `newCapabilityKeys()` filters `inventory.cycleCount.*` out — §2.4 |
| 2 | 6 | `workOrderConsumption.record`, `workOrderReservation.dispatch/cancel/complete` | not in `PERMISSION_CATALOG`, so in no Role — §2.3 |

The admin principal alone yields **12 passed / 6 failed** — *exactly* the sibling's reported figure,
which identifies their run as a single administrator subject against an activating environment. The
9 operations the tool covers all pass here. Reproduced and explained.

### 3.3 The vacuity hole — `CAPABILITY_PARITY_READY` **is** reachable, falsely

One principal `uid-nobody`, assigned `generalEmployee` (holds none of the eighteen), same tenant,
same database, same sandbox activation:

```
operations compared     18
passed                  18
failed                  0
=> CAPABILITY_PARITY_READY
capabilityParityReady = true
```

`classify()` tests `legacyAllow === target.allow` **before** it inspects any refusal
(`functions/scripts/inventoryCapabilityParityHarness.js`, `classify`), so "denied by both" is a
PASS with `reason: "NONE"`, and the `hasUnresolvedIdentity` / `hasUnresolvedRoleOrCatalog` guards —
which only ever read reasons set on FAIL rows — never fire. `capabilityParityReady` therefore
means **"no disagreement was observed"**, not **"agreement was demonstrated"**.

This is the gate whose satisfaction is documented condition 1 for *deleting the harness and
re-pointing the eight writers' authorization at eos_policy*. It can be satisfied by choosing the
wrong principals. **This is the most dangerous defect found by this lane.** See **OR-4**.

---

## 4. The six answers

**WHO can invoke the activation path?**
Two distinct authorities, and conflating them is the root of the confusion in this workstream.

1. **The GRANT path** — writing `eos_policy.role_capabilities` — is invocable by **exactly one
   actor: a human operator at a terminal**, running
   `functions/scripts/inventoryCapabilityGrantMigrationCli.js --apply` with a `DATABASE_URL` they
   supplied themselves. No API, no callable, no HTTP route, no deploy step, no first-login path,
   no Firestore rule and no migration reaches this table. It is not exported from either closed
   operation list.
2. **The ACTIVATION path** — lifting `active: false` — is invocable by **nobody at runtime**. It is
   not a person's authority at all: it is a property of the *environment*, decided by an edit to
   `config/environments.json` (plus its mirrored in-bundle snapshot), reviewed in a pull request,
   and resolved by Firebase project id. There is no runtime toggle, no claim, no feature flag and
   no administrator who can turn a capability on.

**FOR WHICH tenant?**
`taylor-nonprod` — `tenant-6ce59be1-1979-45cd-9d17-a4969037fb25` — on the deployed non-production
stack (`eos-api-nonprod.onrender.com`, PostgreSQL `eos-policy-nonprod`), per
`docs/architecture/eos-real-nonprod-activation.md` §0. It is the only EOS tenant that exists
outside a throwaway container. Its first administrator is EOS principal
`639c1970-dbdb-4bc0-af7c-118559151e2f` ← Firebase subject `ZVu3lHTP1NQhj0Am04zTAGou0dx1`. Note the
precondition in §5: that database was recorded at migrations `001 002 003`, i.e. **migration 004 has
not necessarily been applied there, and migration 006 certainly has not**, so
`eos_policy.capabilities` may be empty and every proposal would report `UNKNOWN_CAPABILITY`.

**THROUGH WHICH capability?**
**`inventory.stock.receive`**, and only it, for a first end-to-end proof that requires no
environment change.

**WHY that one?**
Because it is the *only* census capability that carries no `active: false` flag
(`permissionCatalog.ts:1295`; measured `active: undefined`) and is therefore absent from
`SPINE_OVERRIDE_ELIGIBLE_IDS`. It needs no activation override to be legally exercisable, which
makes it the single capability whose legacy decision is ALLOW in **every** environment. It is
consequently the one key for which the grant migration's proposal moves a tenant *toward* parity
rather than away from it (§3.1: `receiving.receive` is the one non-cycleCount catalog operation
that passes with activation off). It is also held by four Roles including `dispatcher` and a
purpose-built `inventoryReceivingClerk`, so it can be proved with a narrow, non-administrator
principal.

**WHERE is the grant administered?**
Nowhere that a person can reach through the product. The grant fact is **declarative, in code** —
the `permissions` array of a `Role` in `functions/src/access/compatibilityRoles.ts` /
`governedBusinessRoles.ts`, which is also what the tenant seed reads
(`policySeed.ts:37-38,85`). `eos_policy.role_capabilities` is a **projection** of that code into one
tenant's database, materialized only by an operator running the grant migration. Changing who holds
a capability is a **pull request against the Role catalog**, reviewed as code; it is *not* an
Administration API operation, and the Administration API has no capability-grant surface at all.

**WHY can production not accidentally inherit it?**
Five independent, differently-shaped blocks. Any one alone would be an assumption; together they
are a design:

1. **Role-keyed code block.** `resolveCapabilityOverrides` returns `EMPTY` for
   `env.role === "production"` *before reading the registry data at all*
   (`environmentCapabilityOverrides.ts:354`). Measured: `taylor-parts` activates 0 of 14 census keys.
2. **Data block.** No `role: "production"` entry declares any override
   (`config/environments.json`, `taylor-parts-production`, `overrides = 0`), asserted by
   `scripts/environmentArchitecture.test.mjs`.
3. **Eligibility intersection.** The result is intersected with `SPINE_OVERRIDE_ELIGIBLE_IDS`
   (`environmentCapabilityOverrides.ts:362`), so a careless registry edit cannot sweep in an unrelated `active: false` capability.
4. **No production infrastructure.** `render.yaml` declares a non-production Blueprint only, and
   `functions/src/eosApi/server.ts` refuses to start when `EOS_ENVIRONMENT` names production —
   there is no deployed process in production that can read `eos_policy` at all.
5. **No production writer.** `bootstrapEosTenant.mjs` refuses a production `EOS_ENVIRONMENT`, and —
   **as of this lane** — so does the grant migration CLI (§7). Before this change the only writer
   of `role_capabilities` was the only operator script with no environment guard.

And the residue that is *not* blocked, stated plainly: **`inventory.stock.receive` is production-live
today** in the legacy resolver for `admin`, `dispatcher`, `owner` and `inventoryReceivingClerk`.
Activation blocks tell you nothing about it, because it was never deactivated. That is why it is the
right key to prove the path with, and why the proof must never be run against `taylor-parts`.

---

## 5. The smallest governed non-production path

Designed to grant **no broad permission for the sake of testing**, to invent no authority, and to
leave every production block untouched. Five steps, each independently reversible.

**Preconditions to name, not to guess:**

* **P1 — SATISFIED, per a sibling measurement I did not verify myself.** The grant migration needs
  `eos-policy-nonprod` at migration `1757894400000` (006) or later, or every proposal reports
  `UNKNOWN_CAPABILITY`. `docs/architecture/eos-real-nonprod-activation.md` §0 records `001 002 003`
  as of 2026-09-10, which would have failed this. **Lane P2-B3 measured it tonight at 7 of 18
  migrations.** Applied in order, 7 spans `admin-policy` → `operating-company-and-serialized-custody`
  and therefore **includes 004 (the Cycle Count capability catalog) and 006 (the 13-key
  vocabulary)** — so `eos_policy.capabilities` holds all 18 rows there and the precondition is met.
  `eos_crm`, `eos_commercial` and `eos_finance` do not exist in that database, which is consistent
  with 7 and irrelevant to this path. **I did not verify this myself** — it needs the Render
  `DATABASE_URL`, which this lane did not request and must not. Confirm before step 3.
* **P1b — strong corroboration of §2.1.** P2-B3 reports that a bootstrapped administrator on real
  nonprod resolves **256 object permissions and ZERO operational capabilities**. My throwaway seed
  produced `objectPermissions=256` and `role_capabilities=0` on a fresh tenant — identical. The
  "no writer for `role_capabilities`" finding is therefore not a container artefact: it is the
  observed state of the only real tenant.
* **P2.** The parity harness's Firestore side reads `eos-platform-sandbox`, whose *legacy* facts
  must exist for the chosen principal. The activation axis is keyed on **`GCLOUD_PROJECT`**, so the
  harness must be run with `GCLOUD_PROJECT=eos-platform-sandbox` explicitly set. Note the local ADC
  at `/mnt/c/Users/Rudy2/AppData/Roaming/gcloud` carries `quota_project_id = taylor-parts`
  (**production**); any `firebase-admin` run without an explicit project override inherits a
  production default. **The harness has no `--project` flag.** See **OR-5**.

**The path:**

1. **Apply migrations 004 and 006 to `eos-policy-nonprod`.** Catalog rows only. Grants nobody
   anything (§2.1, proven: `role_capabilities = 0` after a full migrate + seed).
2. **Create one narrow principal** in `taylor-nonprod` holding exactly the Role
   `inventoryReceivingClerk` — whose entire declared authority among the new keys is
   `inventory.stock.receive` (asserted by
   `functions/test/inventoryCapabilityGrantMigration.test.mjs:90`). Not `admin`. Not `owner`. The
   existing governed assignment path is used; no new Role is invented.
3. **Dry-run the grant migration** against `taylor-nonprod` with `--evidence-dir`. Expect
   `proposed 28 / applied 0 / unresolved 0`. **Read the evidence file before going further.** If
   `unresolved > 0`, stop — P1 failed.
4. **Apply it**, with `EOS_ENVIRONMENT=nonprod` (now enforced, §7). This writes 28 rows and is
   idempotent. It grants `admin`/`owner` more than the narrow principal needs — *that is the
   existing Role catalog's decision, already ratified in code, not a new grant invented for
   testing*. The narrow principal remains narrow.
5. **Run the parity harness with `--subject <the narrow clerk> --tenant taylor-nonprod` and
   `GCLOUD_PROJECT=eos-platform-sandbox`.** Expected, and this is the point: the clerk passes
   17 of 18 rows vacuously and **`receiving.receive` passes non-vacuously** — the one row where
   both sides say ALLOW for the same reason. That is the smallest possible *positive* evidence that
   the eos_policy chain reproduces a legacy decision.

**What this path deliberately does NOT do:** it does not activate any capability in any
environment; it does not edit `config/environments.json`; it does not grant a Role to anyone to make
a test pass; it does not touch Cycle Count; and it does not attempt `CAPABILITY_PARITY_READY`,
which **cannot** be honestly achieved until OR-1 and OR-2 are decided (§6).

---

## 6. Owner rulings required — recorded precisely, not decided here

**OR-1 — Does `eos_policy` need an activation gate, or is parity defined only within an activating
environment?**
`role_capabilities` reproduces GRANT and has no representation of ACTIVATION (§2.6), while the
legacy resolver denies on `inactivePermission` *ahead of* any grant. Measured consequence: 8
`EXTRA_POSTGRES_GRANT` failures per administrator-shaped principal in a non-activating environment
(§3.1). Two coherent answers, and they are not equivalent:
(a) parity is *defined* only for an environment that activates the key, and the cutover is
scoped to `eos-platform-sandbox` — cheap, but it means the eos_policy chain is **not** a faithful
replacement in production, where 8 of these capabilities are inert; or
(b) `eos_policy` grows its own activation representation before any cutover. **This is an
architecture decision about what the target authority model *is*. It is not mine to make.**

**OR-2 — Who owns the `inventory.cycleCount.*` grants, and may the P1A-3 tool be widened to derive
them?**
The Role catalog already declares holders for 4 of the 5 keys (§2.4) — so *who* holds them is
settled, in code, Owner-ratified. The only open question is whether the existing grant migration may
stop filtering `inventory.cycleCount.*` out of `newCapabilityKeys()`, or whether the P0 Cycle Count
packet owns its own reconciliation. Deriving them would be mechanically identical to what the tool
already does for the other nine keys. **Recorded, not implemented** — it changes what a shipped,
tested migration tool proposes, which is a packet-ownership decision.

**OR-3 — `inventory.cycleCount.close`: correct the census, or give closing its own authority?**
`closeCycleCountSheet` authorizes against `reconcile`
(`cycleCountSheetCommand.ts:450`); the key `inventory.cycleCount.close` is in the eos_policy catalog
(migration 004) and the census, and nowhere else in the system (§2.5). Two remedies:
(a) correct the census row to `inventory.cycleCount.reconcile` — the census's own contract says it
is read from source, and source is unambiguous; migration 004's catalog row becomes an orphan; or
(b) add a real `close` capability check to `closeCycleCountSheet` and a `PERMISSION_CATALOG` entry
and a Role grant — i.e. decide that closing a sheet is its own authority.
(a) is a factual correction; (b) is a separation-of-duties decision. **Choosing is a judgement about
who should hold a capability, so it is recorded, not decided.**

**OR-4 — `capabilityParityReady` is vacuously satisfiable. May the gate be strengthened?**
Proposed, strictly narrowing (it can only ever *withhold* readiness, never authorize anything):
require that at least one compared row observed `legacyAllow === true`, i.e. that the principal set
actually exercises the authority being migrated — and report the count of non-vacuous passes
alongside the total. **Not implemented here**: what constitutes sufficient evidence of parity is an
evidence-standard decision, and this predicate is the documented trigger for deleting the harness
and re-pointing eight writers.

**OR-5 — The parity harness has no explicit project selection.**
It calls `require("firebase-admin/firestore").getFirestore()` with no project override, so it
inherits whatever the ambient ADC names — and the ADC available on this machine names
**`taylor-parts` (production)** as its quota project. An operator running the harness "to check
sandbox" can silently read production. Proposed, fail-closed: require an explicit
`--project <id>` and refuse when it resolves to a `role: "production"` environment in the registry.
**Not implemented**: it changes an operator tool's required arguments, and this lane was scoped to
read-only investigation of that tool.

---

## 7. What this lane changed, and why it was mechanical rather than a judgement

**One change**, in `functions/scripts/inventoryCapabilityGrantMigrationCli.js`: the production
refusal that the file's own banner already declared and enforced nowhere.

* The file's header says **"NONPROD ONLY"** in a box, and enforced nothing.
* Every other operator entry point into `eos_policy` already enforces exactly this, in the process:
  `scripts/bootstrapEosTenant.mjs` (`EOS_ENVIRONMENT` production check, `exit 2`) and
  `src/eosApi/server.ts` (`ServiceConfigError`, refuses to start). This CLI was the exception — and
  it is the **only writer of `role_capabilities` in the entire repository** (§2.1).
* Nothing in the packet that introduced the file records a reason for it to be the exception. The
  omission is an oversight, not a decision.
* The change is **strictly narrowing and cannot create authority**: it can only cause a run to
  refuse. It does not alter what is proposed, what is applied, which tenant is reachable, or who
  holds anything. It grants nothing to anyone.
* It fires **before the pool is built**, so it holds even when `DATABASE_URL` points at something
  real — asserted by running the CLI as a subprocess with `DATABASE_URL` deliberately unset
  (`functions/test/inventoryCapabilityGrantMigration.test.mjs`, four new tests: three production
  labels refuse with exit 2, and `nonprod` demonstrably gets past the guard so the block is narrow
  rather than blanket).

**Honest about its strength:** it is a *label* check, exactly as strong as its siblings and no
stronger. An unset `EOS_ENVIRONMENT` reads as `local`, and the operator still chooses which database
`DATABASE_URL` names. It is defence in depth, not a proof of isolation.

**Not changed, on purpose:** migration 004, migration 006, the capability vocabulary,
`WRITER_CAPABILITY_CENSUS`, `newCapabilityKeys()`, any Role's `permissions` array, the
`capabilityParityReady` predicate, and every existing grant. Each of those is either an Owner
ruling above or outside this lane.

---

## 8. UNPROVEN

1. **The state of the real `eos-policy-nonprod` database, by my own hand.** Lane P2-B3 reports 7 of
   18 migrations and zero operational capabilities for a bootstrapped admin (§5, P1/P1b), which
   would satisfy the precondition. **I did not measure it** — that needs the Render `DATABASE_URL`;
   **this lane did not request one and none should be pasted.** Everything downstream of P1 in §5
   rests on a sibling's number, so confirm it before step 3.
2. **Whether `taylor-nonprod` currently has any `role_capabilities` rows.** P2-B3's "zero
   operational capabilities" for a bootstrapped admin is strong evidence of none, but it is an
   observation through the resolver, not a row count, and it covers one principal.
3. **Whether any `eos-platform-sandbox` Firestore principal exists whose legacy facts would make
   step 5 of §5 meaningful.** This lane read no Firestore — the legacy side of every measurement
   here came from a stub supplying facts of the shapes the harness reads.
4. **Whether the four `workOrder.lifecycle.*` / `workOrderConsumption` keys *should* become
   capabilities at all.** They are currently role-string comparisons with no catalog identity. Their
   absence is a fact; whether the remedy is a catalog entry, a Role grant, or leaving lifecycle
   authority with `transitionEngine.ts` is untouched by this lane and unaddressed by any ruling I
   could find.
5. **`admin.dataImport.execute` is reachable only because `admin` holds every catalog id by
   construction** (`compatibilityRoles.ts:235-240`). No Role names it deliberately. Whether that is
   intended for an authority that turns an import preview into governed records is not recorded
   anywhere I found, and I make no claim about it.

---

## 9. Reproduction

```bash
cd functions && npm ci && npm run build
docker run -d --name p2c1-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=eos -p 55474:5432 postgres:16
export POLICY_TEST_DATABASE_URL="postgres://postgres:pw@127.0.0.1:55474/eos"
export DATABASE_URL="$POLICY_TEST_DATABASE_URL"; export EOS_ENVIRONMENT=local
npx node-pg-migrate up --migrations-dir migrations
node scripts/bootstrapEosTenant.mjs --key p2c1-nonprod --name "P2C1 Throwaway" --performed-by p2c1
# role_capabilities = 0, capabilities = 18, roles = 48
node scripts/inventoryCapabilityGrantMigrationCli.js --tenant <id> --actor p2c1-operator          # 28 / 0
node scripts/inventoryCapabilityGrantMigrationCli.js --tenant <id> --actor p2c1-operator --apply  # 0 -> 28
npm run test:adminPolicyPostgres   # 357 pass / 0 fail
docker rm -f p2c1-pg
```

The §3 reachability probes were driven by a throwaway script (stub Firestore + real Postgres) kept
in this lane's scratchpad rather than committed: it exists to produce the numbers above once, not to
become a second harness.
