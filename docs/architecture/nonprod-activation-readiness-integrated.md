# Non-production activation readiness — the integrated tree (Wave 1 + `eos_finance`)

**Lane P2-C3** · worktree `p2c3-nonprod-readiness` · branch `night/p2c3-nonprod-readiness` · base `d104cf49`
· measured 2026-09-12.

**Verdict: `READY_FOR_NONPROD_ACTIVATION`.** Activation was **not** performed: the authorization and the
credential that activation requires are both absent from this machine, and neither may be invented.
See §6 for the exact remaining blockers and who must supply each.

This document exists to stop one specific error: **calling schema existence "activation."** The five
states below are kept apart on purpose. The tables existing is the *first* of five, and on the real
non-production database it is currently the only one Wave 1 has not yet reached.

---

## 1. The five classifications

| | state | where the **real nonprod** environment is | where the **integrated tree** is |
|---|---|---|---|
| **SCHEMA_READY** | the tables exist | ❌ **NO** — 7 of 18 migrations; 25 of 57 tables; `eos_crm`, `eos_commercial`, `eos_finance` **do not exist** | ✅ 18/18, 57 tables, 5 schemas |
| **AUTHORITY_READY** | capabilities / grants / roles actually resolve | ⚠️ **UNPROVEN** — no credential exists here to read it | ✅ rehearsed end to end (§4) |
| **TRANSPORT_READY** | the API path works end to end | ✅ **YES** — measured live against the deployed service (§3) | ✅ |
| **DATA_READY** | the reference data an operator needs is present | ⚠️ **UNPROVEN** — reported by an earlier lane, not measurable from here | ✅ seed applies 37 objects / 395 fields / 48 roles / 256 object permissions / 5 workflows |
| **USER_READY** | a real principal can do real work | ❌ **NO** — blocked by SCHEMA and by the ungranted capability set (§4.4) | ✅ rehearsed |

The important asymmetry: **the deployed code is current, the deployed database is not.** Those two
drift independently, and conflating them is how "the API is deployed" becomes "the feature works."

---

## 2. SCHEMA — measured, not assumed

`GET https://eos-api-nonprod.onrender.com/health`, read live:

```json
{"ok":true,"environment":"nonprod","reachable":true,"migrated":true,"latencyMs":4,"migrations":7}
```

`migrated:true` is **not** a statement that the database matches this tree. It means the migrations
the *running build* knows about have been applied. The integrated tree carries **18**.

To measure the gap exactly rather than infer it, a fresh database was migrated to **exactly 7** —
reproducing nonprod's reported state — and diffed against a database at 18:

```
migrations on the replica-of-nonprod : 7
tables at 7  : 25          tables at 18 : 57
schemas at 7 : eos_ops, eos_policy      (eos_crm, eos_commercial, eos_finance ABSENT)
```

**32 tables absent from the real non-production database**, including every table of three whole
schemas:

```
eos_commercial.opportunities, ownership_handoffs, sales_agreements, sales_orders
eos_crm.accounts, account_locations, contacts
eos_finance.invoices, invoice_lines, payments, payment_applications
             + views invoice_totals, payment_balances, invoice_application_totals
eos_ops.warehouses, bins, bin_code_claims, trucks, mobile_locations, equipment, equipment_models,
        suppliers, supplier_catalog_items, purchase_orders, purchase_order_voids, receiving_orders,
        receiving_order_lines, reorder_requests, transfer_orders, inventory_commitments,
        work_order_inventory_effects
eos_policy.employee_principal_links          ← employee linkage: ABSENT on nonprod
```

One thing that is **not** missing, and which matters for §3: the operational capability vocabulary is
migration-seeded at migration 6, so `eos_policy.capabilities` holds **18 rows at migration 7 and still
18 at migration 18** — Wave 1 did not widen it. `capabilities`, `role_capabilities`, `principals` and
`tenant_memberships` all exist on nonprod. The capability *machinery* is present there; the Wave-1
*business* schemas are not.

### How the gap closes — and why it has not

`render.yaml` declares `preDeployCommand: npm run migrate:up`. Migrations are applied by Render in
the deploy phase, from the service's `rootDir` (`functions`), against the `DATABASE_URL` Render
injects `fromDatabase`. **The 11 outstanding migrations apply automatically on the next deploy of a
commit containing them.** No separate migration step is required, and none may be run by hand against
a real database. This lane did not deploy.

---

## 3. TRANSPORT — proven live, end to end

Measured against the deployed service. **Two transports, deliberately domain-separated**, both
current:

**Administration** — `POST /admin/policy`, operation in the body:

```
{"ok":false,"operation":"listRoles","code":"UNAUTHENTICATED","message":"a bearer token is required"}
{"ok":false,"operation":"definitelyNotAnOperation","code":"UNKNOWN_OPERATION","message":"no such Administration operation"}
{"ok":false,"operation":"listRoles","code":"UNAUTHENTICATED","message":"the token could not be verified"}
```

All **24 / 24** Administration operations in the integrated tree are recognized by the deployed
build (each returns `UNAUTHENTICATED`, never `UNKNOWN_OPERATION`). **Zero drift** at this surface.

**Operations** — `POST /operations/inventory`, the capability-resolution path:

```
{"ok":false,"operation":"resolveMyCapabilities","code":"UNAUTHENTICATED","message":"a bearer token is required"}
{"ok":false,"operation":"nope","code":"UNKNOWN_OPERATION","message":"no such Operations operation"}
{"ok":false,"operation":"resolveMyCapabilities","code":"UNAUTHENTICATED","message":"the token could not be verified"}
```

`the token could not be verified` is load-bearing evidence: reaching that message means the service
fetched Google's **public** signing certificates over HTTPS and checked the token's `kid`. Identity
verification works in the deployed environment **with no service-account credential present**, exactly
as `render.yaml` documents.

CORS, measured:

| request | result |
|---|---|
| `Origin: https://verenwardeos.vercel.app` | `access-control-allow-origin: https://verenwardeos.vercel.app` |
| `Origin: https://taylor-parts-preview.vercel.app` (the removed domain) | **no** `access-control-allow-origin` header — refused |
| `OPTIONS /admin/policy` | `204`, methods `POST, GET, OPTIONS`, headers `authorization, content-type, x-eos-tenant`, max-age 600 |

**A correction worth recording.** An initial probe of `/listRoles`, `/operations`, `/version` and
`/policy` returned `UNKNOWN_OPERATION` for every one, which reads like a broken or stale API. It is
not: the real contract is `POST /admin/policy` and `POST /operations/inventory` with the operation
**in the body**. Concluding "the API is behind" from the first probe would have been wrong. The
transport is healthy and current; only the database lags.

---

## 4. The rehearsal — real output, throwaway `postgres:16`

Container `p2c3-pg`, port 55476, this lane's alone, destroyed afterwards. Nothing below touched any
real database.

### 4.1 Build and migrations

`npm ci && npm run build` — clean, `tsc` exit 0.

```
$ npx node-pg-migrate up --migrations-dir migrations
Migrations complete!
$ select count(*) from pgmigrations;  →  18
```

Resulting census — **5 schemas, 53 base tables, 3 views, 4 functions**:

| schema | tables | views |
|---|---|---|
| `eos_policy` | 22 | 0 |
| `eos_ops` | 21 | 0 |
| `eos_commercial` | 4 | 0 |
| `eos_crm` | 3 | 0 |
| `eos_finance` | 4 | 3 |

### 4.2 PostgreSQL suites — 17 files, one file per `node --test` invocation

**357 assertions, 0 failures.**

```
rc=0 adminPolicyPostgres 25   adminPolicySeed 15   adminPolicyActivation 38   eosOpsPostgres 30
rc=0 eosOpsOperatingCompanyCustodyPostgres 16      inventoryCapabilityGrantMigration 7
rc=0 eosOpsInventoryCommitmentPostgres 28          eosOpsWarehouseBinPostgres 25
rc=0 truckFleetPostgres 18   employeePrincipalLinkPostgres 15   supplierCatalogPostgres 20
rc=0 eosOpsEquipmentCustodyPostgres 19             eosOpsPurchasingPostgres 27
rc=0 crmCustomerPostgres 19  commercialOwnershipPostgres 19     invoiceAuthorityPostgres 14
rc=0 eosOpsCashApplicationPostgres 22
```

**Four of those initially failed, and it was not a defect.** Run sequentially against one shared
database, `crmCustomerPostgres`, `commercialOwnershipPostgres`, `invoiceAuthorityPostgres` and
`eosOpsCashApplicationPostgres` all failed identically:

```
Error: Not run migration 1757462400000_admin-policy is preceding already run migration
       1758672000000_purchasing-object-authority
```

That is a **`pgmigrations` ledger left partial by an earlier suite in the same database**, not a
schema fault. Re-run each on its **own fresh database**, all four pass (19 / 19 / 14 / 22). Recorded
because the shipped `test:adminPolicyPostgres` script batches all 17 into a single `node --test`
invocation; splitting them — as this lane's brief requires — exposes cross-file database sharing.
**This is a harness property, not a Wave-1 regression.**

### 4.3 Tenant bootstrap — the real operator CLI

```
$ node scripts/bootstrapEosTenant.mjs --key taylor-nonprod-rehearsal \
      --name "Taylor Freezer (P2-C3 rehearsal)" --performed-by p2c3-rehearsal
database : postgres://***:***@127.0.0.1:55476/rehearsal
environment: local
tenant   : tenant-6e5cbc81-2ac5-4055-a9f8-2c8689844019 (taylor-nonprod-rehearsal) CREATED
seed     : v1 applied
           objects=37 fields=395 roles=48 objectPermissions=256
           workflows=5 versions=5 steps=36 actions=48 bindings=112
admin    : not bootstrapped (pass --admin-subject and --performed-by to create the first one)
```

First administrator — a **separate, deliberate** act, as the script's own header insists:

```
admin : principal 1da68d66-6933-4661-b920-f6799cebed84 holds the Admin Role
        (assignment 4449b9ec-f83b-4d33-8cb9-997920b8735a)
        access version 1, bootstrapped by p2c3-rehearsal
```

Idempotent on re-run: `seed: v1 already applied`, `objects=0 fields=0 roles=0 objectPermissions=0`.

Tenant membership and principal mapping both resolve:

```
principal 1da68d66… ← external_subject p2c3-rehearsal-subject-0001 → role `admin`
tenant_memberships: principal 1da68d66… / tenant-6e5cbc81… / status=active
```

### 4.4 Capability resolution — the finding that separates SCHEMA from AUTHORITY

Immediately after a complete, correct tenant bootstrap:

```
capabilities defined      : 18
role_capability grants    : 0        ← ZERO
role_object_permissions   : 256   (24 resolving for the bootstrapped administrator)
```

**A fully bootstrapped administrator resolves zero operational capabilities.** Administration
authority (object CRUD over 24 objects — `account`, `warehouse`, `workOrder`, `invoice`, `payment`,
`salesOrder`, `purchaseOrder`, …) resolves immediately. Operational authority —
`inventory.stock.receive`, `inventory.transfer.dispatch`, `inventory.cycleCount.close`,
`equipment.install`, `admin.dataImport.execute` — resolves to **nothing** until a **separate grant
step** runs. Schema existence and even tenant bootstrap are simply not the same event as authority.

The grant is a **direct-`pg` operator CLI**, not an API operation. Default is dry run:

```
$ node scripts/inventoryCapabilityGrantMigrationCli.js --tenant tenant-6e5cbc81… --actor p2c3-rehearsal
tenant tenant-6e5cbc81-2ac5-4055-a9f8-2c8689844019 -- DRY RUN
  before 0 | after 0 | proposed additions 28 | applied additions 0 | unresolved mismatches 0
→ role_capabilities after dry run: 0        (writes nothing, as designed)
```

Applied — **on the throwaway container only**:

```
  -- APPLY
  before 0 | after 28 | proposed additions 28 | applied additions 28 | unresolved mismatches 0

role_key                          caps        role_key                           caps
admin                             9           inventoryPutAwayOperator           1
owner                             9           inventoryReceivingClerk            1
inventoryTransferOperator         4           inventoryStockRelocationOperator   1
dispatcher                        1           inventoryTransferReceiver          1
equipmentInstaller                1
```

Idempotent: re-apply → `before 28 | after 28 | proposed 0 | applied 0 | unresolved 0`.

### 4.5 Operating-company authority and `eos_finance`

Operating-company scoping is carried structurally on **21 columns** across every schema that needs
it — `eos_ops` (10), `eos_commercial` (3), `eos_finance` (4, including the views), plus
`eos_ops.transfer_orders` separating `source_` from `destination_operating_company_key`, and
`eos_policy.employee_principal_links.operating_company_id`. It is a column on the facts, not an
afterthought in a filter.

`eos_finance` ships 4 tables, 3 views and **append-only enforcement in the database**:

```
payments_append_only              payment_applications_append_only
payment_application_within_receipt  receipt_amount_covers_applications
ownership_handoffs_are_append_only  (eos_commercial)
```

with guard functions `assert_application_within_receipt`, `assert_receipt_covers_applications`,
`refuse_financial_fact_mutation`, `refuse_ownership_history_mutation`. Financial history cannot be
rewritten by a mistaken UPDATE; the constraint is in PostgreSQL, not in a service that might be
bypassed. All 36 finance/commercial assertions pass.

---

## 5. No accidental business fallback to Firebase

Verified structurally and by test. `test/adminPolicyNoFirebase.test.mjs` (12) and
`test/eosOpsNoFirebase.test.mjs` (5) — **17 assertions, 0 failures**; they ban
`firebase/firestore`, `firebase-admin/firestore`, `firebase-admin` and `firebase-functions` imports
from the policy and operations subsystems.

In the serving path `firebase-admin` appears **once**, lazily imported in `src/eosApi/server.ts`, and
answers exactly one question: *which subject authenticated*. No claim it returns is read as EOS
authority. `src/adminPolicy/adminPolicyHttp.ts` takes `verifyToken` as a parameter and imports no
Firebase at all.

The remaining Firestore importers are **not** in the serving path: `firestorePolicyParityHarness.ts`,
`warehouseBinMigrationSource.ts`, `supplierCatalogMigration.ts` — migration sources and a read-only
cutover-parity harness, explicitly allow-listed and documented as uncalled by the running system.

`render.yaml` sets `GOOGLE_CLOUD_PROJECT=eos-platform-sandbox` — the non-production Firebase identity
— and declares **no service-account key**, because verifying an ID token needs only a project id and
Google's public certificates. §3's `the token could not be verified` proves that live.

**No business read or write falls back to Firebase.**

---

## 6. The exact remaining blockers, and who must act

Activation was **not** performed. The blockers are not technical unknowns; they are a missing
authorization and a missing credential, and this lane may invent neither.

| # | blocker | what is required | **who must act** |
|---|---|---|---|
| **1** | **Wave-1 migrations are not on nonprod** (7 of 18; 32 tables, 3 schemas absent) | Deploy a commit containing the integrated tree to the `eos-api-nonprod` Render service. `preDeployCommand: npm run migrate:up` applies migrations 8–18 automatically. **No hand-run migration against a real database.** | **The Owner** — deploy authority. This lane must not deploy. |
| **2** | **No `DATABASE_URL` and no Render credential exist on this machine** | The nonprod connection string, or a Render session able to reach the service. `ipAllowList: []` means the database takes **internal connections only** — nothing reaches it from the public internet, so even a leaked string is not usable from here. | **The Owner.** *Named, not requested — this lane does not ask for or paste credentials.* |
| **3** | **Capability grants do not exist until a human runs the grant CLI** (§4.4) | After #1: `node scripts/inventoryCapabilityGrantMigrationCli.js --tenant <id> --actor <uid>` (dry run), inspect the report, then `--apply`. It is **direct-`pg`, not an API operation** — verified: `reconcileInventoryCapabilityGrants` is referenced only in its own module, its CLI and tests, and **nowhere in `src/eosApi/` or `src/eosOps/eosOpsHttp.ts`**. **HTTPS cannot drive it.** | **An operator at a terminal** with #2 in hand. |
| **4** | **Tenant / first-administrator state on nonprod is UNPROVEN** (§7) | After #2, read-only: confirm `taylor-nonprod`, principal ← Firebase subject, `tenant_memberships.status='active'`, and resolved capability count. | **An operator** with #2. |

Blockers **1 → 2 → 3 → 4** are strictly ordered. Nothing after #1 can even be attempted first.

---

## 7. UNPROVEN — stated as such

- **Tenant presence, principal mapping, membership and resolved capabilities on the real nonprod
  database.** A prior lane reports tenant `taylor-nonprod` /
  `tenant-6ce59be1-1979-45cd-9d17-a4969037fb25` and first administrator principal
  `639c1970-…` ← Firebase subject `ZVu3lHTP1NQhj0Am04zTAGou0dx1`. **This lane did not verify any of
  it** — no credential exists here, and `/health` exposes none of it. Reported, not measured.
- **DATA_READY and AUTHORITY_READY on nonprod.** Same reason. Rehearsed locally (§4.3, §4.4); on the
  real database, unknown.
- **Whether nonprod's 7 applied migrations are byte-identical to this tree's first 7.** `/health`
  returns a count, not names. The replica in §2 assumes they are the first seven in order.
- **`docs/architecture/eos-real-nonprod-activation.md` is stale on this point** — it records
  migrations `001 002 003`, while `/health` reports 7. The document lagged reality before Wave 1;
  treat its counts as historical.

Employee linkage deserves its own line: `eos_policy.employee_principal_links` is **absent from
nonprod** (migration 11). Employee-linked authority cannot resolve there at all today — not because
it is misconfigured, but because the table does not exist.

---

## 8. Did Wave 1 change any precondition?

**No precondition was removed, and one was made materially larger.**

| precondition | before Wave 1 | now |
|---|---|---|
| migrations to apply on nonprod | 7 applied, 0 outstanding *for that build* | **11 outstanding** |
| schemas to create | `eos_policy`, `eos_ops` | **+ `eos_crm`, `eos_commercial`, `eos_finance`** |
| deploy mechanism | `preDeployCommand` | unchanged — still automatic |
| capability grant | direct-`pg` CLI, not API-reachable | **unchanged** — still direct-`pg` |
| capability vocabulary | 18 | **18 — unchanged**; Wave 1 added no new capability keys |
| identity / credential model | project id + public certs, no key | unchanged |
| CORS allowlist | one origin | unchanged |

The activation *procedure* is exactly what it was. The activation *payload* is three schemas and 32
tables larger. Wave 1 did not make activation harder to authorize; it made the deploy that satisfies
blocker #1 carry considerably more schema change, which is an argument for doing it deliberately and
verifying afterward — not for doing it faster.

---

## 9. Safety attestation

- **Production (`taylor-parts`) was never contacted.** No request, no read, no gcloud call.
- **Nothing was deployed.** No Render action of any kind.
- **No real database was written.** Every migration, bootstrap and grant ran against the disposable
  local container `p2c3-pg` on port 55476, since destroyed.
- **Firestore was never written**, in any project.
- **No credential was requested, pasted, or guessed.** Blocker #2 is *named*, not solicited.
- Only public unauthenticated reads (`/health`) and unauthenticated probes that were **refused**
  (`401` / `404`) touched the deployed non-production API. No authenticated call was made, because no
  token exists here.
- No dual write, no data migration, no cutover.
