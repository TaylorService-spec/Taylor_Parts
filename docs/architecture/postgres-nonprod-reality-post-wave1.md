# PostgreSQL Schema and Nonprod Reality at Post-Wave-1 Mainline

**Lane:** P3-MIG · **Baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` (post-Wave-1 `main`, PR #1898 merged)
**Date:** 2026-09-12 · **Mode:** read-only with respect to code and databases

> **NO DATABASE WAS CONTACTED TO PRODUCE THIS DOCUMENT.**
> No production database, no nonprod database, no locally started container. No migration command was
> run, with or without `--apply`. No Firestore read or write. No deploy.
>
> No explicit nonprod target and credential were supplied to the session that produced this document,
> so every statement below is derived from **repository source at the baseline SHA** or cited to
> another document. Live state is recorded as **unmeasured**, with the exact read that would settle it
> (§7). That register is the deliverable, not a shortfall.

---

## 0. The one distinction this document holds throughout

| | means | established by |
|---|---|---|
| **DECLARED** | the repository says this should exist | reading source at the baseline SHA |
| **KNOWN** | somebody measured the running thing and recorded it | a dated, sourced measurement |
| **UNKNOWN** | nobody has measured it | absence of any such measurement |

A migration file in `functions/migrations/` is **DECLARED**. A row in `public.pgmigrations` in a
running database is **KNOWN** only once read. This document contains no measurement of any running
database. Where a prior document does contain one, it is cited as that document's measurement and
dated, never restated as this lane's.

---

## 1. Migration inventory — DECLARED, re-derived at this baseline

`functions/migrations/` is the only migration directory in the repository, and the only `.sql` files
in the repository live in it. Verified: `find . -name '*.sql'` outside that directory returns nothing.

**Count at baseline: 18 files.** Re-derived directly, not inherited.

```
git ls-tree --name-only 64008d5a functions/migrations/ | wc -l   → 18
git ls-tree --name-only 64008d5a^1 functions/migrations/ | wc -l →  7
git diff --stat 64008d5a^1 64008d5a -- functions/migrations/     → 11 files changed, 3582 insertions(+)
```

### 1.1 CORRECTION TO THE BRIEF

The tasking brief states *"A prior lane verified 18 files existed pre-merge."* **That is wrong.**
**7 migration files existed pre-merge; the Wave-1 merge added 11; 18 exist at the baseline.** The
brief's own parenthetical ("Wave 1 changed 244 files and added migrations") is the correct reading,
and the re-derivation the brief ordered is what caught it. The `244 files changed` figure is
confirmed: `git diff --stat 64008d5a^1 64008d5a` reports 244 files, 38 508 insertions, 1 516 deletions.

This correction is load-bearing: the numbers 7 and 18 are the provenance of the withdrawn claim (§6).

### 1.2 The 18, in applied order

Ordering is by filename timestamp prefix, which is what `node-pg-migrate` uses. Each migration
declares its target schema with `SET search_path = <schema>, public`, then creates unqualified
relations, so the schema attribution below comes from the `search_path` in force.

| # | timestamp prefix | name | schema | CREATE TABLE | ALTER TABLE | CREATE VIEW | creates schema |
|---|---|---|---|---|---|---|---|
| 01 | 1757462400000 | `admin-policy` | `eos_policy` | 16 | 0 | 0 | **yes** — `eos_policy` |
| 02 | 1757548800000 | `tenant-and-identity` | `eos_policy` | 3 | 13 | 0 | — |
| 03 | 1757635200000 | `assignment-integrity` | `eos_policy` | 0 | 8 | 0 | — |
| 04 | 1757721600000 | `operational-capabilities` | `eos_policy` | 2 | 0 | 0 | — |
| 05 | 1757808000000 | `eos-ops-foundation` | `eos_ops` | 4 | 0 | 0 | **yes** — `eos_ops` |
| 06 | 1757894400000 | `operational-capability-vocabulary` | `eos_policy` | 0 | 0 | 0 | — |
| 07 | 1757980800000 | `operating-company-and-serialized-custody` | `eos_ops` | 0 | 10 | 0 | — |
| 08 | 1758067200000 | `inventory-commitment-and-work-order-replay` | `eos_ops` | 2 | 0 | 0 | — |
| 09 | 1758240000000 | `warehouse-and-bin-location-authority` | `eos_ops` | 3 | 0 | 0 | — |
| 10 | 1758326400000 | `truck-and-mobile-location-registry` | `eos_ops` | 2 | 0 | 0 | — |
| 11 | 1758412800000 | `employee-principal-linkage` | `eos_policy` | 1 | 0 | 0 | — |
| 12 | 1758499200000 | `supplier-and-supplier-catalog-authority` | `eos_ops` | 2 | 0 | 0 | — |
| 13 | 1758585600000 | `equipment-and-installed-custody` | `eos_ops` | 2 | 4 | 0 | — |
| 14 | 1758672000000 | `purchasing-object-authority` | `eos_ops` | 6 | 0 | 0 | — |
| 15 | 1758758400000 | `crm-account-contact-location` | `eos_crm` | 3 | 0 | 0 | **yes** — `eos_crm` |
| 16 | 1758844800000 | `commercial-ownership-authority` | `eos_commercial` | 4 | 0 | 0 | **yes** — `eos_commercial` |
| 17 | 1758931200000 | `invoice-authority` | `eos_finance` | 2 | 0 | 1 | **yes** — `eos_finance` |
| 18 | 1759017600000 | `ar-cash-application-authority` | `eos_finance` | 2 | 0 | 2 | — |
| | | **TOTAL** | **5 schemas** | **54** | **35** | **3** | |

Migrations 01–07 are the 7 that existed pre-merge. Migrations 08–18 are the 11 the Wave-1 merge added.

**All 18 declare a Down section** (`grep -cE '^-- ?Down'` returns 1 for every file), so the chain is
declared reversible. Whether it *is* reversible against any given database is a measurement, and the
only such measurement on record was made against a disposable local container (§6.3).

---

## 2. Declared schema surface — DECLARED

Five schemas, 54 tables, 3 views: **57 declared relations.** All five live inside the single
PostgreSQL database that `render.yaml` declares (`databaseName: eos_policy`) — the database name and
the `eos_policy` schema name collide, which is a readability hazard worth knowing when reading a
connection string, but they are different objects.

| schema | created by migration | tables | views | relations | pre-Wave-1 tables | added by Wave 1 |
|---|---|---|---|---|---|---|
| `eos_policy` | 01 | 22 | 0 | 22 | 21 | 1 |
| `eos_ops` | 05 | 21 | 0 | 21 | 4 | 17 |
| `eos_crm` | 15 | 3 | 0 | 3 | **0 — schema did not exist** | 3 |
| `eos_commercial` | 16 | 4 | 0 | 4 | **0 — schema did not exist** | 4 |
| `eos_finance` | 17 | 4 | 3 | 7 | **0 — schema did not exist** | 4 |
| **TOTAL** | | **54** | **3** | **57** | **25** | **29** |

### 2.1 Declared relations, by schema

**`eos_policy` — 22 tables.** `tenants`, `objects`, `object_fields`, `roles`,
`role_object_permissions`, `role_field_permission_overrides`, `user_role_assignments`,
`principal_access_versions`, `workflows`, `workflow_versions`, `workflow_steps`, `workflow_actions`,
`workflow_role_bindings`, `workflow_instances`, `workflow_instance_events`, `audit_events` (01);
`principals`, `tenant_memberships`, `tenant_admin_bootstraps` (02); `capabilities`,
`role_capabilities` (04); `employee_principal_links` (11).

**`eos_ops` — 21 tables.** `inventory_movements`, `serialized_custody`, `cycle_count_sheets`,
`cycle_count_lines` (05); `inventory_commitments`, `work_order_inventory_effects` (08);
`warehouses`, `bins`, `bin_code_claims` (09); `mobile_locations`, `trucks` (10); `suppliers`,
`supplier_catalog_items` (12); `equipment_models`, `equipment` (13); `reorder_requests`,
`purchase_orders`, `purchase_order_voids`, `receiving_orders`, `receiving_order_lines`,
`transfer_orders` (14).

**`eos_crm` — 3 tables.** `accounts`, `contacts`, `account_locations` (15).

**`eos_commercial` — 4 tables.** `opportunities`, `sales_agreements`, `sales_orders`,
`ownership_handoffs` (16).

**`eos_finance` — 4 tables, 3 views.** `invoices`, `invoice_lines`, view `invoice_totals` (17);
`payments`, `payment_applications`, views `payment_balances`, `invoice_application_totals` (18).

---

## 3. What `render.yaml` and the environment registry DECLARE

### 3.1 `render.yaml` — the only Render blueprint in the repository

`find` over the repository returns exactly one blueprint: `./render.yaml`. It declares itself, in its
own header, as the **NON-PRODUCTION** blueprint.

| declared resource | value | note |
|---|---|---|
| database | `eos-policy-nonprod` | `databaseName: eos_policy`, user `eos`, `plan: basic-256mb`, PostgreSQL major 16, `ipAllowList: []` |
| web service | `eos-api-nonprod` | `runtime: node`, `plan: starter`, `rootDir: functions` |
| build | `npm ci --include=dev --no-audit --no-fund && npm run build` | |
| **pre-deploy** | **`preDeployCommand: npm run migrate:up`** | runs after build, before the new instance starts |
| start | `npm start` | |
| health check | `healthCheckPath: /health` | |
| `EOS_ENVIRONMENT` | `nonprod` | the service refuses to start if this names production |
| `DATABASE_URL` | `fromDatabase: eos-policy-nonprod` | internal connection string, injected by Render, never in git |
| `EOS_ALLOWED_ORIGINS` | `https://verenwardeos.vercel.app` | one origin, never `*` |
| `GOOGLE_CLOUD_PROJECT` | `eos-platform-sandbox` | identity only; no service-account key declared anywhere |

`npm run migrate:up` resolves, in `functions/package.json`, to
`node-pg-migrate up --migrations-dir migrations`. No `--schema` or migrations-table override is
configured, so the ledger is `node-pg-migrate`'s default: **`public.pgmigrations`**. That is confirmed
independently by the reader in `functions/src/adminPolicy/policyDatabase.ts:171`, which queries
`SELECT name FROM public.pgmigrations ORDER BY run_on, id`.

**So migrations are DECLARED to apply automatically on every Render deploy of this service.** This is a
declaration about a mechanism, not a measurement of an outcome. Whether any deploy has occurred at or
after the baseline commit, and whether its `preDeployCommand` succeeded, is **UNKNOWN** (§7).

### 3.2 §5 of the brief — VERIFIED, and the answer is no

> *"Whether a production PostgreSQL policy database is declared at all."*

**CONFIRMED at this baseline: no production PostgreSQL database is declared anywhere in the
repository.** `render.yaml` declares exactly one database, `eos-policy-nonprod`, and states in its own
header: *"There is no production blueprint in this repository and this file must not become one by
editing a string."* A repository-wide search for a production Postgres declaration finds only prose in
`docs/`, no resource declaration.

**Cutover consequence, stated plainly:** there is no production `eos_policy` database to migrate,
because there is no production PostgreSQL resource. Any cutover plan that speaks of "migrating
production Postgres" is describing a resource that does not exist and has never been declared.
Provisioning it is unstarted work, not a migration step. This materially changes cutover planning and
should be treated as a finding, not a footnote.

### 3.3 `config/environments.json` — declares no PostgreSQL at all

`config/environments.json` describes itself as *"THE single source of truth for environment identity
across Enterprise Operations OS."* It declares five environments:

| id | role | deployment | status |
|---|---|---|---|
| `local-emulator` | sandbox | platform | not-provisioned |
| `platform-sandbox` | sandbox | platform | live |
| `platform-certification` | sandbox | platform | live |
| `platform-integration` | integration | platform | not-provisioned |
| `taylor-parts-production` | production | taylor-parts | live |

**A search of that file for `postgres`, `database`, `eos_policy`, `eos_ops`, `render` or `migration`
returns zero matches.** The registry models Firebase identity, readiness flags, capability activation
overrides and frontend surfaces — and models the PostgreSQL tier **not at all**.

**This is a structural gap, and it is the reason a claim like the withdrawn one could circulate
unchallenged.** The registry that calls itself the single source of truth for environment identity
cannot answer "which environment has a policy database, and at what schema version", because it does
not carry the concept. Two registries therefore describe the platform: `environments.json` for
Firebase-shaped environments, `render.yaml` for the Postgres-shaped one, with no cross-reference
between them and no environment id in `render.yaml` tying `eos-api-nonprod` to any registry entry.

---

## 4. Declared versus live — the gap, per schema and per migration

### 4.1 Per schema

| schema | DECLARED at baseline | live existence | live table count | live row content |
|---|---|---|---|---|
| `eos_policy` | 22 tables, created by migration 01 | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** |
| `eos_ops` | 21 tables, created by migration 05 | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** |
| `eos_crm` | 3 tables, created by migration 15 | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** |
| `eos_commercial` | 4 tables, created by migration 16 | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** |
| `eos_finance` | 4 tables + 3 views, created by migration 17 | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** |

Every cell in the live columns is UNKNOWN for the same single reason: **no explicit nonprod
environment and credential has been supplied to any lane authorised to read one, so no lane has read
`public.pgmigrations` or `information_schema` in any deployed database at or after this baseline.**

### 4.2 Per migration

The honest table has one row per migration and the same value in the live column for all 18:

| migrations | DECLARED | live applied state at baseline |
|---|---|---|
| 01–07 (pre-Wave-1) | present in the tree before the merge | **UNMEASURED** |
| 08–18 (added by Wave 1) | present in the tree at the baseline | **UNMEASURED** |

There is no partial answer available and no basis for one. A count between 0 and 18 could be
substituted here and nothing in the repository would contradict it — which is precisely how the
withdrawn claim survived.

### 4.3 The nearest thing to a live measurement, cited not restated

| measurement | source | date / commit | what it said |
|---|---|---|---|
| nonprod PostgreSQL applied migrations | `docs/architecture/eos-real-nonprod-activation.md:39` | measured **2026-09-10**, at `main` `44f423c9` | `eos-policy-nonprod` · `dpg-dah48qht0dsc73egnml0-a` · PostgreSQL 16 · `basic_256mb` · 15 GB · HA false · `ipAllowList: []` · **migrations `001` `002` `003`** |
| nonprod `/health` response | same doc, lines 242 / 298 / 521 | 2026-09-10 | `{"ok":true,"environment":"nonprod","reachable":true,"migrated":true,"latencyMs":2,"migrations":3}` |

**That is somebody else's measurement, of an earlier commit, and it says 3 — not 7.** At the time it
was taken, only a handful of migrations existed, so "3 applied" was not a deficit. It is cited here
because it is the *only* dated nonprod measurement on record, it establishes that the nonprod database
is real and was reachable, and it establishes that **`/health` already reports an applied-migration
count** — which makes the settling read in §7 cheap. It does **not** establish anything about the
state of that database at this baseline, eight migrations and two days later.

### 4.4 A real defect in the readiness check, found while deriving this

`requirePolicyDatabaseReady` (`functions/src/adminPolicy/policyDatabase.ts`) refuses to start the
service when the database is unreachable, and refuses when it is *unmigrated*. But its definition of
migrated is:

```
migrated: applied.length > 0
```

**"Migrated" means "at least one migration has ever been applied", not "the schema matches the tree".**
A nonprod database holding only migrations 001–003 would therefore report `migrated: true`, pass
`requirePolicyDatabaseReady`, start, serve `/health` with `"ok":true` — and then fail every request
that touches `eos_crm`, `eos_commercial` or `eos_finance` with "relation does not exist". The module's
own header comment says conflating reachable and migrated "is how a service starts, reports healthy,
and then fails every request"; the check closes that gap one notch and leaves the next notch open.

Consequence for anybody reading a green `/health`: **`migrated: true` is not evidence that the schema
is current.** The `migrations: <n>` count in the same payload is the field that carries the
information, and it must be compared against 18. This is reported, not fixed — this lane is read-only
with respect to code.

---

## 5. Nonprod readiness, six dimensions

Each dimension is labelled **KNOWN** (measured and recorded), **DECLARED-ONLY** (the repository says
so; nobody has confirmed it running) or **UNKNOWN**.

| dimension | label | what stands behind the label |
|---|---|---|
| **SCHEMA** | **DECLARED-ONLY** | 18 migrations, 5 schemas, 54 tables + 3 views are declared in the tree at this baseline and re-derived above. Nothing establishes what the nonprod database actually contains. The one dated nonprod reading (2026-09-10, `44f423c9`) recorded 3 applied migrations against a tree that has since grown to 18. |
| **AUTHORITY** | **DECLARED-ONLY** | `render.yaml` declares `preDeployCommand: npm run migrate:up`, so schema authority is declared to flow from the tree to the database on every deploy of `eos-api-nonprod`. `functions/migrations/` is the single schema authority and `postgresPolicyRepository.ts` the only module that knows what a database is. Whether that pipeline has run at this baseline: unknown. |
| **TRANSPORT** | **KNOWN, and narrow** | Cited from other lanes, not measured here: the Render EOS API **is deployed for nonprod** (`eos-api-nonprod.onrender.com`). Its route surface is a closed list — `functions/src/adminPolicy/adminPolicyHttp.ts` states it in terms: `GET /health`, `POST /admin/policy`, `OPTIONS *`, plus `/operations/inventory` routed separately via `functions/src/eosOps/eosOpsHttp.ts`. **There is deliberately no route taking a table name, a SQL fragment or a generic patch.** So most Postgres authorities — `eos_crm`, `eos_commercial`, `eos_finance`, most of `eos_ops` — have **no HTTP transport at all** and are unreachable from a browser regardless of schema state. Four lanes tripped on stale "NOT DEPLOYED" comments; one such stale comment still stands in `docs/architecture/SYSTEM_AUTHORITIES.md` (§6.5). |
| **DATA** | **UNKNOWN** | No lane has read a row from any deployed database. Table occupancy, tenant rows, whether the 2026-09-10 tenant `taylor-nonprod` still exists: all unmeasured. Note that a schema can be fully migrated and entirely empty, and the two are independent questions. |
| **USER / ROLE ASSIGNMENT** | **capacity KNOWN, occupancy UNKNOWN** | Cited from other lanes: governed-role binding is **real** — 45 governed business Roles are live authority and `roleAssignments` is the sole source of an ALLOW. **Capacity is proven; occupancy is not.** No lane has established whether any principal holds any governed Role, and that read is refused for exactly the reason this lane's is. Separately, source confirms `eos_policy.role_capabilities` has **exactly one writer**: an operator running a CLI with a `DATABASE_URL` they supply. No API, callable, route, deploy step or migration reaches that table — so capability grants cannot have arrived by deploy, and their presence in nonprod is unknown and *not* implied by a successful migration. |
| **REACHABILITY** | **DECLARED-ONLY at this baseline** | Declared: `ipAllowList: []` — internal connections only, nothing reaches the database from the public internet, so the database is reachable only from the Render service or a Render-side shell. The API's own reachability was **KNOWN as of 2026-09-10** (live end to end, browser → Vercel → Render → PostgreSQL, per `eos-real-nonprod-activation.md`), and is **UNKNOWN at this baseline**. That same document records that direct Render MCP SQL **fails on TLS**, which is a standing obstacle to the settling read in §7 and must be planned around. |

---

## 6. The withdrawn claim: purge, and its provenance reconstructed

### 6.1 The claim

> **"Nonprod Postgres sits at 7 of 18 applied migrations."**

**WITHDRAWN. Never to be reused.** Companions, equally withdrawn: **"25 of 57 tables"** and
**"`eos_crm` / `eos_commercial` / `eos_finance` absent."**

A verification lane searched all eleven Phase-3 inputs and found the claim in none of them, concluding
it was untraceable. **This lane traced it.** It is not fabricated from nothing — it is a **correct
source-tree fact about the repository, restated as a false measurement of a running database.**

### 6.2 Provenance, reconstructed arithmetically

| withdrawn figure | true source-derived meaning | verification at this baseline |
|---|---|---|
| **7** | migration **files in the tree before** the Wave-1 merge | `git ls-tree 64008d5a^1 functions/migrations/ \| wc -l` → **7** |
| **18** | migration **files in the tree after** the Wave-1 merge | `git ls-tree 64008d5a functions/migrations/ \| wc -l` → **18** |
| **25** | **tables declared by the 7 pre-Wave-1 migrations** (`eos_policy` 21 + `eos_ops` 4) | summed from source → **25** |
| **57** | **relations declared by all 18** (54 tables + 3 views) | summed from source → **57** |
| **`eos_crm`/`eos_commercial`/`eos_finance` absent** | true of the **pre-Wave-1 tree** — those schemas are created only by migrations 15, 16 and 17, all added by Wave 1 | confirmed: `CREATE SCHEMA` for all three appears only in files added by the merge |

Every figure lands exactly. These are file and DDL counts comparing the pre-merge tree to the
post-merge tree. **None of them was ever a reading of a database.**

The documentary origin is explicit. `docs/integration/w1-integration-rehearsal.md:21`:

> *"The brief said 10 PRs add a migration. **Eleven do.** The tree goes from 7 migrations to **18**."*

That sentence is **correct and must not be altered.** The error was committed downstream of it, by
re-voicing "the tree goes from 7 to 18" as "nonprod sits at 7 of 18 applied". A statement about two
git trees became a statement about a running database, and the "of" did the damage.

### 6.3 The "18 applied" measurement, and why it is not nonprod

`docs/integration/w1-integration-rehearsal.md` §5.4 does record a migration run reporting
`migrations applied: 18` and a clean full `down` and re-`up`. **That run was against a disposable
local container, not nonprod.** The same document records: toolchain `postgres:16` (PostgreSQL 16.15)
**in container**, and *"Container `w2-rehearsal-pg` on port 55470 was used exclusively and is
removed."* The rehearsal branch was local-only, never pushed, never merged.

So it is good evidence that **the chain applies and reverses cleanly**, and **no evidence at all**
about nonprod. Both readings must be kept apart, and the container's destruction means even that
evidence is not re-inspectable.

### 6.4 What replaces the claim

**Live migration state at this baseline is UNMEASURED.** It must be read directly from the target
database when an explicit environment and credential exist. **No lane has done so.** No number is
substituted here, and none should be inferred from the 2026-09-10 reading of 3, from the declared 18,
or from the container's 18.

### 6.5 Purge record — every occurrence found, and its disposition

Swept `docs/**` for the claim and its variants: `7 of 18`, `7/18`, `seven of 18`, `7 applied`,
`18 migrations`, `25 of 57`, `57 tables`, numeric 7-near-18 and 25-near-57 proximity, `sits/stands at
N of M`, `N of M applied`, and the three-schema `absent` forms. Also swept the whole repository
outside `docs/`.

| # | file : line | text found | disposition |
|---|---|---|---|
| 1 | *(none)* | the withdrawn claim **in its withdrawn form** — nonprod at 7 of 18 applied | **ZERO occurrences in `docs/**`.** The claim lived in controller output, not in the committed corpus. Nothing to correct. |
| 2 | `docs/integration/w1-integration-rehearsal.md:21` | "The tree goes from 7 migrations to **18**." | **LEFT UNCHANGED — deliberately.** This is a true source-tree statement and the provenance of the corruption. Editing it would replace a fact with an error. Recorded here so the lineage is never lost. |
| 3 | `docs/integration/w1-integration-rehearsal.md:319-336` | `MIGRATION COUNT: 18 / applied: 18`, per-schema table counts | **LEFT UNCHANGED — correctly scoped.** A local-container measurement, and the document says so. Two reading hazards flagged in §6.6 rather than edited, as the file is another lane's evidence. |
| 4 | `docs/roadmaps/2026-08-16-external-capability-discovery.md:85` | "17 of 18 registered capabilities…" | **NOT THE CLAIM.** Capability discovery, unrelated to migrations. No action. |
| 5 | `docs/audits/truck-registry-functions-deployment/deployment-report.md:49` | "Sequence (7 applied + deactivate fail-closed)" | **NOT THE CLAIM.** Test sequence count. No action. |
| 6 | `docs/orchestration/metadata-program/sandbox-promotion-package.md:1327` | "4 distinct field shapes (16/17/18…" | **NOT THE CLAIM.** Field-shape analysis. No action. |
| 7 | `docs/architecture/SYSTEM_AUTHORITIES.md:54` | **"NOT DEPLOYED: no Render service, no Vercel variable, no environment holds a policy database"**, and "`functions/migrations/` is the single schema authority (001 policy, 002 tenant + identity)" | **HANDED OFF, NOT EDITED.** A *different* stale claim, not the withdrawn one, so outside this lane's allowed surface. **Both halves are false at this baseline:** a Render service and a nonprod policy database demonstrably exist (`eos-real-nonprod-activation.md`, 2026-09-10), and the schema authority is 18 migrations across 5 schemas, not 2. This is one of the stale "NOT DEPLOYED" comments four lanes tripped on, still standing in the corpus. **Recommend the controller assign its correction.** |

**Net: the withdrawn claim required no in-place correction, because it is absent from `docs/**`.** The
corpus was never poisoned; the controller's working state was. Replacement language for it is §6.4.
One adjacent stale claim (row 7) is handed to the controller.

### 6.6 A discrepancy worth the controller's attention

`docs/integration/w1-integration-rehearsal.md` §5.4 reports its post-`up` schema listing as:

```
schemas: eos_commercial, eos_crm, eos_ops, eos_policy
  eos_commercial: 4 tables   eos_crm: 3 tables   eos_ops: 25 tables   eos_policy: 22 tables
```

Two things disagree with source at this baseline:

1. **`eos_finance` is missing from that schema list**, yet migration 17
   (`1758931200000_invoice-authority.sql:148`) contains `CREATE SCHEMA IF NOT EXISTS eos_finance`
   followed by `SET search_path = eos_finance, public`. At this baseline the schema is unambiguously
   declared.
2. **`eos_ops` is listed at 25 tables**; source declares **21**. The difference is exactly 4 — the
   four `eos_finance` tables.

`4 + 3 + 25 + 22 = 54`, which **matches** this lane's source-derived total exactly. So the two
derivations agree on *how many* relations exist and disagree on *which schema owns four of them*. The
most likely explanation is that the rehearsal's schema-listing step mis-attributed the `eos_finance`
tables to `eos_ops` and dropped the schema from its list; a real possibility worth excluding is that
the rehearsal branch differed from what was merged. **Either way, the per-schema attribution in that
document should not be relied on, and the discrepancy is unresolved.** Not edited: another lane's
evidence, and the container is destroyed, so it is no longer re-measurable there. `eos_finance`
appears in **no** rehearsal schema list, which also means the withdrawn companion claim about the
three schemas being "absent" had a second place it could have been picked up from.

---

## 7. UNPROVEN / UNKNOWN register — and the exact read that settles each

Nothing in this section has been attempted. Each row names the minimum read, its prerequisite, and
what it would and would not establish.

| # | unknown | the precise read that settles it | prerequisite | credential needed |
|---|---|---|---|---|
| **U1** | How many migrations are applied in nonprod | `GET https://eos-api-nonprod.onrender.com/health` → read the `migrations` integer; compare against **18** | the service is running | **none** — `/health` is explicitly unauthenticated (`adminPolicyHttp.ts:122`) and returns no policy data |
| **U2** | **Which** migrations are applied, by name and order | `SELECT name, run_on FROM public.pgmigrations ORDER BY run_on, id;` | an explicit nonprod target **and** a `DATABASE_URL` supplied by an authorised operator | yes — and `ipAllowList: []` means this runs only from inside Render |
| **U3** | Whether all 5 schemas exist live | `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'eos%';` | as U2 | as U2 |
| **U4** | Live table count per schema, against the declared 54 + 3 | `SELECT table_schema, count(*) FROM information_schema.tables WHERE table_schema LIKE 'eos%' GROUP BY 1;` | as U2 | as U2 |
| **U5** | Whether a deploy has occurred at or after `64008d5a`, and whether its `preDeployCommand` succeeded | Render deploy list for `srv-dah49f1t0dsc73egpvi0`, filtered to commits at or after the baseline; then that deploy's pre-deploy log | Render dashboard or API access | yes |
| **U6** | Whether the nonprod API is reachable **now** (it was on 2026-09-10) | the same `GET /health`; any 2xx proves reachability | none | none |
| **U7** | Governed-Role **occupancy** — does any principal hold any governed Role | `SELECT count(*) FROM eos_policy.user_role_assignments WHERE status='active';` | as U2 | as U2 |
| **U8** | Whether any capability grants exist in `eos_policy.role_capabilities` | `SELECT count(*) FROM eos_policy.role_capabilities;` | as U2 | as U2 — and note the table's **only** writer is an operator CLI, so a green migration implies nothing about its contents |
| **U9** | Whether the tenant recorded on 2026-09-10 (`taylor-nonprod`) still exists | `SELECT id, slug FROM eos_policy.tenants;` | as U2 | as U2 |
| **U10** | Whether the 18-migration chain reverses cleanly against a **persistent** database, not a throwaway container | `node-pg-migrate down 18` then `up`, against a **disposable** database only | an explicit disposable target. **Never against nonprod** — a full `down` destroys data | yes |
| **U11** | Whether the per-schema attribution in the rehearsal doc (§6.6) or this document's source derivation is right about `eos_finance` | U3 + U4 together decide it | as U2 | as U2 |
| **U12** | Whether a production PostgreSQL resource exists outside the repository | ask the Owner; inspect the Render account for a non-blueprint database | Owner statement or Render account access | yes |

### 7.1 The cheapest read is nearly free, and no lane has done it

**U1 and U6 need no credential.** One unauthenticated HTTP GET against `/health` returns
`{"ok", "environment", "reachable", "migrated", "latencyMs", "migrations"}`, and the `migrations`
integer compared against 18 would settle the single question the withdrawn claim pretended to answer.
The proof it is unauthenticated is in source, and the proof it reports the count is in source
(`server.ts:150`, `migrations: health.appliedMigrations.length`).

**This lane did not perform it, deliberately.** No explicit nonprod environment was supplied to this
session, and the lane's rule is that an environment must be given, not inferred — the URL is
inferable from `render.yaml` and a prior document, and inferring it is exactly the step the rule
forbids. Recorded as the recommended first action for a lane that *is* given an environment.

**Two caveats on U1, both load-bearing.** First, per §4.4, `migrated: true` means only "at least one
migration applied" — the boolean must be ignored and the integer read. Second, the integer is a
**count, not a list**: it can prove the schema is *behind* (n < 18), and it can prove the count
matches, but it cannot prove the *right* 18 ran. Only U2 settles identity, and U2 needs a credential
and an inside-Render path, because `ipAllowList: []`.

---

## 8. Corrections this lane makes to the brief that tasked it

| # | the brief said | the finding |
|---|---|---|
| 1 | "A prior lane verified 18 files existed pre-merge." | **Wrong. 7 existed pre-merge; the merge added 11; 18 exist at the baseline.** The brief's own parenthetical ("Wave 1 … added migrations") was right, and the ordered re-derivation caught it. |
| 2 | The withdrawn claim "is untraceable to any source." | **Traceable, and now traced.** All four figures (7, 18, 25, 57) and the three-schema "absent" companion reconstruct exactly from pre-merge-versus-post-merge source counts; the documentary origin is `docs/integration/w1-integration-rehearsal.md:21`. The verification lane searched the eleven Phase-3 *inputs*; the source was outside that set. The claim is a true source fact mis-voiced as a live measurement — which is a more instructive failure than fabrication, and a more recurrable one. |
| 3 | Sweep `docs/**` "and correct each occurrence in place". | **No occurrence exists to correct.** The claim is absent from `docs/**` in its withdrawn form. The only 7-and-18 statement in the corpus is true and was deliberately left alone. One *adjacent* stale claim was found and handed off (§6.5 row 7). |
| 4 | Implied that `render.yaml` provisioning only `eos-policy-nonprod` needed verification. | **Verified and true**, and stronger than stated: it is the *only* blueprint in the repository and disclaims production in its own header. No production PostgreSQL resource is declared anywhere. |
| 5 | The nonprod API "exposes only `/health`, `/admin/policy/*`, `/operations/inventory`". | **Nearly right; the middle term is not a wildcard.** Source is a single exact path: `adminPolicyHttp.ts` returns 404 for any path that is not literally `/admin/policy` (`if (path !== "/admin/policy") return json(404, …)`), and every operation is a named command in one `POST` body. There is no `/admin/policy/<something>` sub-route surface. The distinction matters to anyone probing the API by URL: guessing sub-paths returns 404 for every one of them, which reads like "not deployed" and is not. |

Two findings the brief did not anticipate: the `migrated: true` weakness in `requirePolicyDatabaseReady`
(§4.4), and `config/environments.json` — the self-declared single source of truth for environment
identity — containing **no PostgreSQL concept at all** (§3.3). The second is the structural reason a
claim of this shape could circulate: there is no registry field it would have contradicted.

---

## 9. Method and provenance

| | |
|---|---|
| baseline | `64008d5ae0bdd9532909671b15a91122400accf1` — post-Wave-1 `main`, merge of PR #1898 |
| databases contacted | **none** |
| migration commands run | **none** |
| Firestore operations | **none** |
| deploys | **none** |
| network reads of any deployed environment | **none** |
| source of every DECLARED fact | files at the baseline SHA, and `git ls-tree` / `git diff` against `64008d5a^1` |
| source of every cited measurement | named document, with its own date and commit, never restated as this lane's |

Primary sources read: `functions/migrations/` (all 18 files), `functions/package.json`, `render.yaml`,
`config/environments.json`, `functions/src/adminPolicy/policyDatabase.ts`,
`functions/src/adminPolicy/adminPolicyHttp.ts`, `functions/src/eosApi/server.ts`,
`functions/src/eosOps/eosOpsHttp.ts`.

Documents cited, not re-measured: `docs/architecture/eos-real-nonprod-activation.md`,
`docs/integration/w1-integration-rehearsal.md`, `docs/architecture/SYSTEM_AUTHORITIES.md`.

Facts cited from other lanes, with their attribution and not as this lane's measurement: the nonprod
Render API's deployment and narrow route surface; 45 governed business Roles as live authority with
`roleAssignments` the sole source of an ALLOW, capacity proven and occupancy unknown; and
`eos_policy.role_capabilities` having exactly one writer, an operator CLI.
