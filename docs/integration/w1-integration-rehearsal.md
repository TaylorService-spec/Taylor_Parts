# W1 Integration Rehearsal — 29 PRs merged, tested, and the script to do it for real

**Lane:** Phase 2 / P2-A (integration rehearsal)
**Rehearsal branch:** `phase2/integration-rehearsal` (local only — never pushed, no PR, nothing merged to main)
**Base:** `33945090d66d2287fe0cdc362c80ad6e4e311067` (`origin/main`, unmoved)
**Date:** 2026-09-12

---

## 0. The headline

**All 29 branches merge.** There is no branch that cannot be landed. Eight merges conflicted
textually; every conflict has a mechanical resolution recorded below.

What the rehearsal actually bought is the second list: **eighteen defects that no lane could have
seen and that no review of any individual PR would have caught**, because they only exist once the
branches are in the same tree. Sixteen are now fixed on the rehearsal branch. One is an environment
artifact. **One is a genuine domain contradiction between two lanes and is deliberately left
unresolved — see §6.**

The brief said 10 PRs add a migration. **Eleven do.** The tree goes from 7 migrations to **18**.

---

## 1. The merge order, with expected head SHAs

Merge order rule: the four non-migration PRs from the adversarial reviews first, then **the eleven
migration PRs in migration-timestamp order** (which is exactly what the prescribed order already
was — the reviews got this right), then the remaining fourteen.

For the last fourteen the order is **ascending PR number**, which is authoring order and minimises
surprise, with **one deliberate deviation**: `1891` is moved from 26th to **last**, because it
regenerates `docs/architecture/capability-graph.json`, a generated file. Regenerating it last means
the generator runs over the complete tree instead of over a partial one that then drifts. `1884`
before `1892` is preserved (it already holds in ascending order) because 1892 rewrites the guard
that 1884's new tests exercise.

| # | PR | Branch `origin/impl/w1-…` | Expected head SHA | Migration |
|---|----|---------------------------|-------------------|-----------|
| 1 | 1866 | part-admin-objects | `d31df998d576f3af9bb3b4b3cbac8f90306a4f84` | — |
| 2 | 1874 | inventory-action | `2d9e259c32bf2ef6b99fa415233ed0bbc19527e9` | — |
| 3 | 1878 | inventory-cutover-tooling | `9bccc0032af7c1b8fb4b09b7cac3e4f2afc62b4a` | — |
| 4 | 1880 | reporting-authority | `e8b1992d0d2763fc6526df582e2c678038243e39` | — |
| 5 | 1868 | inventory-commitment | `7d9496cb9026e898956953a720a096fc73a0c600` | `1758067200000_inventory-commitment-and-work-order-replay.sql` |
| 6 | 1877 | warehouse-bin | `f9eedaf54c07c157273159ad739359540b32ff72` | `1758240000000_warehouse-and-bin-location-authority.sql` |
| 7 | 1867 | truck-mobile | `5670c8fd62d2b79e3dc95c5d435742797a435dde` | `1758326400000_truck-and-mobile-location-registry.sql` |
| 8 | 1870 | employee-principal | `e284fca93a375032358add4896998f650d0db59c` | `1758412800000_employee-principal-linkage.sql` |
| 9 | 1872 | supplier-manufacturer | `286c0e3c6be8b51729ec2c6ca59cfd41f1a4c744` | `1758499200000_supplier-and-supplier-catalog-authority.sql` |
| 10 | 1876 | equipment | `2467361e1d7d995e54bfdbf23f41c6a3b8a958ba` | `1758585600000_equipment-and-installed-custody.sql` |
| 11 | 1879 | purchasing | `99c73ce821446686373237c33d6a305fde152f3b` | `1758672000000_purchasing-object-authority.sql` |
| 12 | 1871 | account-contact-location | `7cbf4204ff60f5f7961a1cce9ab672f9132cf100` | `1758758400000_crm-account-contact-location.sql` |
| 13 | 1869 | commercial | `cf45ef24aa74acea73b12a2390eb658b132f118f` | `1758844800000_commercial-ownership-authority.sql` |
| 14 | 1875 | invoice | `d99b6519b1526881e5c111527b4c54d95aebab4b` | `1758931200000_invoice-authority.sql` |
| 15 | 1881 | payment | `8860c9366633837ddaf7189848f7aa38a8c69348` | `1759017600000_ar-cash-application-authority.sql` |
| 16 | 1873 | part-ci-hardening | `c991e37b8241b07e7f4c4fce42602df14f0368c0` | — |
| 17 | 1882 | financial-authority | `06ab9f31dea21dfa4b1f4bd04a5b8262a1a04bba` | — |
| 18 | 1883 | integrations-review | `4e9020a2d7aa549c4fb0db223d3e4c066b00c861` | — |
| 19 | 1884 | firebase-retirement | `b42715c9a3ff21a9ec2fb83b7520569f5e836f93` | — |
| 20 | 1885 | scanner-warehouse | `e37366f59bbf3d71b3114bb7de9905ea092a885c` | — |
| 21 | 1886 | list-ns-migrations | `8f9b633f4a16893566697f9a1e1a0be49b6f1e94` | — |
| 22 | 1887 | serialized-asset | `25b99e31528c421fd740105333c3680dd6cc605a` | — |
| 23 | 1888 | workorder-authority | `f87a252689976764821fd4764be7d599493de345` | — |
| 24 | 1889 | cyclecount-authority | `4e309004383c68c71b7599f52c6298110b5f52f4` | — |
| 25 | 1890 | financial-surfaces | `041910067fe2ceba575db7552fd13549b4feb268` | — |
| 26 | 1892 | guard-coverage | `6787d27bb9e8e936d296fc52ec5ea2545aa7fb76` | — |
| 27 | 1893 | scheduling-authority | `3ee304f37861b28ec436a9e05ee959eea1c9c66f` | — |
| 28 | 1894 | ai-assistant-authority | `6c5a2a8ef3e212a26bda703a380abc517f456702` | — |
| 29 | 1891 | admin-configuration | `27b9ec212613ccb62a71b9a2c1aa36c26b8167a9` | — |

**Migration timestamps do not collide.** All eleven are distinct and all sort after migration 007.

### Hard ordering constraints (violating these breaks the merge)

1. **1875 and 1881 must merge after 1866.** Both ship
   `field-ops-app-vite/src/metadata/administration/profiles/*.js`, which is 1866's framework.
   1866's coverage test fails when a profile file exists that the registry does not list.
2. **1884 before 1892.** 1892 rewrites `classifyFile` in the guard 1884's new tests exercise.
3. **1891 last** (soft, but strongly preferred) so the capability-graph regeneration sees everything.
4. The eleven migration PRs should land in timestamp order. Nothing *forces* it — the migrations are
   independent and `node-pg-migrate` orders by filename, not by merge order — but landing them out
   of order means every intermediate main has a migration list whose tail is not its newest
   migration, which is precisely what breaks the suites in §3.

---

## 2. Every conflict, file by file, with the resolution

Eight of 29 merges conflicted. Twenty-one merged clean.

### 2.1 `functions/package.json` — 8 conflicts (PRs 1877, 1867, 1870, 1872, 1876, 1879, 1871, 1869, 1875, 1881, 1889)

**Resolution: UNION every lane's test-script entries, preserve all existing, drop none.**

Each lane appends its own suite to `test:adminPolicy` and/or `test:adminPolicyPostgres`. Git sees one
changed line and reports a conflict; taking either side silently deletes the other lane's suite —
which would not fail any test, because the deleted suite simply stops running. This is the most
dangerous conflict in the set precisely because mis-resolving it is *silent*.

The union was applied mechanically (token-union preserving HEAD order, appending incoming-only
tokens). Result: **`test:adminPolicyPostgres` runs all 17 lane suites**; `test:adminPolicy` retains
every lane's entry. Verified by listing the final script and counting.

### 2.2 The four shared migration-assertion suites — 7 conflicts

`functions/test/eosOpsOperatingCompanyCustody.test.mjs`,
`functions/test/adminPolicyPostgres.test.mjs`,
`functions/test/eosOpsOperatingCompanyCustodyPostgres.test.mjs`,
`functions/test/eosOpsPostgres.test.mjs`.

**Resolution: take HEAD.** Every lane independently rewrote these to say "…and now there are eight
migrations". Their forms differ only in naming (`MIGRATION_COUNT`, `downToBefore007`, `stepsBackTo`,
`files[6]`, `down 8`, `down 2`). Once the first migration PR (1868) established the
order-independent form, **HEAD's version is strictly more general than any later lane's**, so
taking HEAD both resolves the conflict and applies the canonical fix:

| Literal that was there | What replaced it |
|---|---|
| `assert.equal(files.length, 7)` + `files[files.length-1] === MIGRATION_FILE` | `const at = files.indexOf(MIGRATION_FILE); assert.ok(at >= 2); assert.equal(files[at-2], "1757808000000_eos-ops-foundation.sql")` |
| `down 7` / `down 8` | `down(migrationFileCount())` |
| `down 1` / `down 2` to reach 007 | `down(stepsBackTo("1757980800000_"))` — the filter form |
| closed `eos_ops` table list | derived from the migration files (§3.4) |
| `COMPANY_TABLES = [3 literals]` | `tablesWithColumn("eos_ops", "operating_company_key")` (§3.5) |

Confirmed: **PRs 1869, 1870 and 1877 each hardcoded a depth** (`down 8`, `down 2`), exactly as the
brief predicted. 1872 hardcoded `MIGRATION_COUNT - 7`. All were discarded in favour of HEAD's form.

### 2.3 `functions/test/adminPolicyActivation.test.mjs`, `adminPolicySeed.test.mjs`, `inventoryCapabilityGrantMigration.test.mjs` (PR 1869)

**Resolution: UNION — and this one is a genuine both-sides-required union, not a pick.**

1871 and 1869 *independently diagnosed the same defect*: a `reset()` that drops only the schemas it
knows about leaves the newer schema standing, and because `reset()` also drops `pgmigrations`, the
next `up` re-runs that migration against tables that still exist and fails. Each lane added only its
own schema — 1871 added `eos_crm`, 1869 added `eos_commercial`. **Both are required.** Replaced with
`declaredSchemas()` (derived), so the next new schema needs no edit here at all.

### 2.4 `functions/src/workOrderConsumption/consumptionSourceService.ts` (PR 1888)

**Resolution: UNION of the import blocks.** 1887 (serialized-asset) and 1888 (workorder-authority)
both added imports at the same line; their code bodies are in different regions and merged cleanly.
Verified every one of the four symbols (`readSerializedCustodyPair`, `PARTS_COLLECTION`,
`trackingModeFromStoredControlType`, `ControlTypeTrackingMode`) is referenced in the merged file, and
`tsc` compiles it.

### 2.5 `scripts/firebaseExitGuard.test.mjs` (PR 1892)

**Resolution: KEEP BOTH SIDES.** Exactly as briefed. One tail hunk, where git aligned 1884's appended
block (the W1-C21 retirement pins, 49 lines) against 1892's appended block (the scan-coverage suite
for its rewritten `classifyFile` / `categoriesForPath`, 260 lines). They are additive in different
places. Both kept, concatenated, with the closing `});` the two sides shared restored between them.
**Result: 42 tests, 42 pass** — both lanes' tests run and pass together.

### 2.6 What did NOT conflict but needed hand-work anyway

- **`field-ops-app-vite/test/suites.json`** — merged clean every time (only 1866 edits it). But PR
  **1874 ships a test file and never registers it**; its own handoff doc says so. Registered by hand
  (§4).
- **`field-ops-app-vite/test/entityRegistry.test.mjs`** — only 1881 touches the field census
  (394 → 395), so no SUM was needed. But **two further copies of that census exist** that 1881 did
  not know about (§3.7).
- **`docs/architecture/capability-graph.json`** — 1891's copy merged clean. Regenerated anyway per
  the standing rule.

---

## 3. Defects only the integrated tree could reveal

Everything in this section passed on its lane's own branch. **Root cause for most of it: the
Postgres suites SKIP when `POLICY_TEST_DATABASE_URL` is unset, so no lane ever ran them.** They were
green by abstention.

### 3.1 Four lanes each assert "my migration sorts last" — `test:adminPolicy`
`commercialOwnershipAuthority.test.mjs:48`, `crmCustomerNamespace.test.mjs:59`,
`eosOpsCashApplication.test.mjs:43`, `supplierCatalogAuthority.test.mjs:35`.
Eleven migrations landed; only one can be last. Replaced with the canonical order form: the migration
is present, and it sorts after 007.

### 3.2 `reset()` schema drops — the single highest-impact defect
Eight resetters, **each with a different partial list** of schemas to drop. Symptom:
`type "commercial_handoff_source" already exists`, surfacing 22 tests deep in a suite that has
nothing to do with the commercial schema; 48 of 349 Postgres tests failed from this one cause.
All now derive from `declaredSchemas()`.

### 3.3 DOUBLE UNWIND in `adminPolicyPostgres.test.mjs`
A lane's canonical `down(stepsBackTo("1757980800000_"))` (12 steps) landed on top of an earlier
generic post-007 pre-unwind (11 steps). 23 steps took migrations 001–006 down too and `eos_policy`
came back empty (`0 !== 21`). The pre-unwind was removed; the single named unwind stands. **This is
the failure mode that the "never hardcode a depth" rule does *not* protect against** — two correct
generic unwinds compounding — and is worth watching for at the real merge.

### 3.4 Closed `eos_ops` table lists
In `eosOpsPostgres`, `eosOpsInventoryCommitmentPostgres`, `crmCustomerPostgres`. Replaced by the rule
each stood in for. In `eosOpsPostgres` the live schema is now compared against what the migration
files declare, read by a small search_path-aware parser
(`functions/test/support/migrationSchema.mjs`, new).
**Tables and VIEWS are now read separately** — `information_schema.tables` lists both, and the
invoice and cash-application designs turn on balances being views rather than stored columns, so a
check that cannot tell them apart cannot see the claim it exists to make.

### 3.5 `COMPANY_TABLES` had fallen seven lanes behind
A literal naming migration 007's three tables. **Seven lanes added tables carrying
`operating_company_key`** — `mobile_locations`, `warehouses`, `suppliers`, `equipment`,
`inventory_commitments`, and the purchasing objects — and **not one updated the list**. The NOT NULL
sweep would have failed on every correct addition. Now derived via
`tablesWithColumn("eos_ops", "operating_company_key")`.

### 3.6 Five lane suites reverse "one migration" expecting their own
`eosOpsWarehouseBinPostgres`, `truckFleetPostgres`, `eosOpsEquipmentCustodyPostgres`,
`eosOpsPurchasingPostgres`, `employeePrincipalLinkPostgres`. Each proves "my down refuses while my
tables hold data" by running one `down` — which reverses whichever migration is newest. Reported as
`Missing expected exception` while the refusal logic worked perfectly. Fixed with
`peelMigrationsNewerThan(prefix)`, driven by **what is applied (`pgmigrations`)** rather than by a
file count, so calling it twice in one test is a no-op rather than digging past the migration under
test.

### 3.7 The field census exists in THREE places; PR 1881 updated one
- `field-ops-app-vite/test/entityRegistry.test.mjs:68` — 1881 updated this one (394 → 395).
- `functions/test/adminPolicySeedCoverage.test.mjs:58,62,65` — **missed**.
- `functions/test/adminPolicyActivation.test.mjs:147` — **missed**.

All three now read 395. Only one lane declared a field this round; had several done so, these deltas
would **SUM**, and three separate literals is three chances to get that sum wrong. Worth collapsing
to one derived source in a follow-up.

### 3.8 `carrying is not defined`
`eosOpsOperatingCompanyCustodyPostgres.test.mjs` — a merge kept a local's *use* while losing its
*definition*. Restored against the derived carrier list (the original form would have been
tautological against a pre-filtered query).

### 3.9 A latent flaky test, exposed
`crmCustomerPostgres.test.mjs:270` read `pg_enum` with **no `ORDER BY`** and compared against an
ordered literal. It passed on the lane branch on incidental row order; with eleven migrations
creating types ahead of it the order changed and it failed while the schema was entirely correct.
Now `ORDER BY t.typname, e.enumsortorder` — declaration order, which for a lifecycle enum is the
meaning.

### 3.10 Generated artifacts needing regeneration
- `functions/src/adminPolicy/seed/policySeedSnapshot.json` + `policySeedCoverage.json` —
  `node scripts/buildAdminPolicySeedSnapshot.mjs` (run from repo root).
- `docs/architecture/capability-graph.json` — `node scripts/buildCapabilityGraph.mjs`.

**Both must be re-run after the real merge**, as the last step.

### 3.11 Not a defect — environment only
`field-ops-app-vite/test/equipmentNorthStarQuickGateContract.test.mjs` (`@playwright/test`) and
`salesAgreementBackendSkew.test.mjs` (`react`) fail only when `field-ops-app-vite/node_modules` is
absent. After `npm ci` both pass. Not integration-related.

---

## 4. Shared-file registrations the integration writer must apply

Apply each at the merge point named. These are edits to files the lanes were forbidden to touch.

| At merge | File | Edit |
|---|---|---|
| **After 1874** | `field-ops-app-vite/test/suites.json` | Add `{"file": "test/inventoryActionRetirementContract.test.mjs", "runner": "node --test"}` in alphabetical position (immediately before `test/inventoryControlLifecycle.test.mjs`). Without it the retirement contract never runs in CI. Source: `docs/handoff/w1-c13-registrations.md` §1. |
| **At 1875** | `field-ops-app-vite/src/metadata/administration/administrationProfileRegistry.js` | `import { invoiceAdministrationProfile } from "./profiles/invoice.js";` + `invoiceAdministrationProfile,` in `ADMINISTRATION_PROFILES`. **Required** — 1866's coverage test fails when a profile file exists that the registry does not list. |
| **At 1881** | same file | `import { paymentAdministrationProfile } from "./profiles/payment.js";` + `paymentAdministrationProfile,` in `ADMINISTRATION_PROFILES`. Same requirement. |
| **After 1891 (last)** | generated | `node scripts/buildAdminPolicySeedSnapshot.mjs` and `node scripts/buildCapabilityGraph.mjs`, from the repo root. Commit the results. |

**A full sweep confirms exactly three profile files exist** across all 29 branches —
`profiles/part.js` (1866, self-registered), `profiles/invoice.js` (1875), `profiles/payment.js`
(1881). No other PR ships one.

`docs/handoff/w1-c15-registrations.md` (1878) confirms **no** registration is required for that lane.

---

## 5. Verification of the integrated tree — real output

Toolchain: node v22.23.2, npm 10.9.8, `postgres:16` (PostgreSQL 16.15) in container
`w2-rehearsal-pg` on port 55470.

### 5.1 Build
```
$ cd functions && npm ci && npm run build
> build
> tsc
```
Clean. No TypeScript errors — including the hand-unioned import block in
`consumptionSourceService.ts`.

### 5.2 `npm run test:adminPolicy`
```
# tests 513
# pass 512
# fail 0
# skipped 1
```

### 5.3 Postgres suites — all 17, ONE FILE per `node --test` invocation
```
adminPolicyPostgres.test.mjs                         tests  25  pass  25  fail 0
adminPolicySeed.test.mjs                             tests  15  pass  15  fail 0
adminPolicyActivation.test.mjs                       tests  38  pass  38  fail 0
eosOpsPostgres.test.mjs                              tests  29  pass  28  fail 1
       not ok 1 - clean database -> migrate -> eos_ops exists beside eos_policy, named exactly
eosOpsOperatingCompanyCustodyPostgres.test.mjs       tests  16  pass  16  fail 0
inventoryCapabilityGrantMigration.test.mjs           tests   7  pass   7  fail 0
eosOpsInventoryCommitmentPostgres.test.mjs           tests  28  pass  28  fail 0
eosOpsWarehouseBinPostgres.test.mjs                  tests  25  pass  25  fail 0
truckFleetPostgres.test.mjs                          tests  18  pass  18  fail 0
employeePrincipalLinkPostgres.test.mjs               tests  15  pass  15  fail 0
supplierCatalogPostgres.test.mjs                     tests  20  pass  20  fail 0
eosOpsEquipmentCustodyPostgres.test.mjs              tests  19  pass  19  fail 0
eosOpsPurchasingPostgres.test.mjs                    tests  27  pass  27  fail 0
crmCustomerPostgres.test.mjs                         tests  19  pass  19  fail 0
commercialOwnershipPostgres.test.mjs                 tests  19  pass  19  fail 0
invoiceAuthorityPostgres.test.mjs                    tests  13  pass  13  fail 0
eosOpsCashApplicationPostgres.test.mjs               tests  16  pass  16  fail 0
==================================================================
TOTAL: tests 349  pass 348  fail 1
```
**The single failure is the unresolved domain contradiction in §6.** Everything else is green.

### 5.4 The whole migration chain reverses and reapplies
```
MIGRATION COUNT: 18
applied: 18

$ npx node-pg-migrate down 18 --migrations-dir migrations
Migrations complete!
schemas left after full down: []

$ npx node-pg-migrate up --migrations-dir migrations
Migrations complete!
migrations applied: 18
schemas: eos_commercial, eos_crm, eos_ops, eos_policy
  eos_commercial: 4 tables
  eos_crm: 3 tables
  eos_ops: 25 tables
  eos_policy: 22 tables
```
**All 18 migrations reverse to nothing and reapply cleanly.** No orphaned schema, type, or table.

### 5.5 Firebase Exit Guard
```
$ node --test scripts/firebaseExitGuard.test.mjs
# tests 42
# pass 42
# fail 0

$ node scripts/firebaseExitGuard.mjs
no previous baseline found -- bootstrap accepted (candidate baseline exactly matches scan)
no new Firebase business-runtime dependencies beyond the committed baseline

$ node scripts/firebaseExitGuard.mjs --previous-baseline=<main's firebase-exit-baseline.json>
no new Firebase business-runtime dependencies beyond the committed baseline
```
The real ratchet (with `--previous-baseline`) **passes**. The baseline **shrank** on both sides
(frontend and server), consistent with 1884's retirements — a floor that may only shrink.

### 5.6 Frontend
```
$ cd field-ops-app-vite && npm test
runSuites: 291 suites passed

$ npm run test:components        # vitest
 Test Files  219 passed | 7 skipped (226)
      Tests  3320 passed | 7 skipped (3327)
```

### 5.7 `git diff --check`
Clean — no whitespace errors.

### 5.8 Not run, and why
**Firestore-emulator suites were not run.** Port 8080 is held by an unrelated uvicorn service and the
Admin SDK retries forever rather than failing, so those suites hang instead of erroring. This is an
environment fact, not a property of the integrated tree, and it is unchanged from main. They remain
unverified by this rehearsal. `.test.jsx` files are vitest and were run via `npm run test:components`,
not `node --test`.

---

## 6. UNRESOLVED — a domain contradiction between PR 1875 and PR 1881

**This is a finding, not a merge problem. It is deliberately left unresolved and failing.** Both
positions are internally coherent, both lanes wrote from the same base in isolation, and choosing
between them is a decision about where the Invoice authority lives — not something an integration
writer should decide by picking a side of a diff.

**PR 1881 (payment) — "the Invoice authority is not in this schema, and must not be":**
- `functions/migrations/1759017600000_ar-cash-application-authority.sql:56` — "The `outstanding` half
  of the same question belongs to the INVOICE authority, which is NOT in [this schema]".
- `…:66-68` — "Invoice authority's Postgres home **does not exist yet**. Inventing an `invoices` table
  to hang a REFERENCES clause on would create an unmaintained copy of a record whose original stays
  authoritative elsewhere — the 'unclear authority' copy the Owner ruling forbids."
- Consequently `payment_applications.invoice_id` is deliberately an **opaque governed key, not a
  foreign key** (`…:194-195`).
- And it adds `'invoices'` to the forbidden-table list at
  `functions/test/eosOpsPostgres.test.mjs:159`, asserting `eos_ops` holds "no copy of an authority
  this schema does not own".

**PR 1875 (invoice) — "the Invoice authority's Postgres home is `eos_ops`, and here it is":**
- `functions/migrations/1758931200000_invoice-authority.sql:119` — `SET search_path = eos_ops, public;`
- `…:123` — `CREATE TABLE invoices (...)`, and `…:180` — `CREATE TABLE invoice_lines (...)`.
- Its header explicitly expects the Payment lane to join against `invoice_totals`, so it knows the
  two lanes meet — it simply assumes the meeting point is inside `eos_ops`.

**The collision:** `eos_ops.invoices` now exists, so 1881's forbidden-list assertion fails. That is
the one red test in §5.3. The other two names 1881 forbids, `locations` and `accounts`, do **not**
collide (`accounts` correctly lives in `eos_crm`).

**What the Owner must decide** (each has consequences beyond the test):
1. **The Invoice authority belongs in `eos_ops`.** Then 1881's forbidden entry is stale and should be
   dropped — *and* `payment_applications.invoice_id` should almost certainly become a real foreign
   key, since the reason it wasn't one ("no invoices table to reference") no longer holds. That is a
   schema change to 1881's migration, not a test edit.
2. **The Invoice authority belongs in its own schema** (as CRM and commercial each got one). Then
   1875's migration moves to `eos_crm`-style `eos_invoice`, and 1881's forbidden entry is correct and
   stays.

Option 1 is the smaller change and matches what 1875 already shipped; **but it is a financial-data
authority decision and I am not making it.** I have deliberately left the assertion failing rather
than deleting a guard one lane wrote on purpose.

---

## 7. Ready-to-run merge script

Run from a clean checkout with `origin/main` at `33945090`. `--match-head-commit` makes each merge
**refuse** if that branch has been pushed to since this rehearsal — which is the point: a moved head
means the rehearsal no longer describes it.

```bash
#!/usr/bin/env bash
# W1 integration — real merge, in rehearsed order, with expected heads.
set -euo pipefail

test "$(git rev-parse origin/main)" = "33945090d66d2287fe0cdc362c80ad6e4e311067" \
  || { echo "main has moved -- re-run the rehearsal"; exit 1; }

merge() { echo "=== PR $1 ($2)"; gh pr merge "$1" --merge --match-head-commit "$2"; }

# --- framework and non-migration PRs -------------------------------------------------
merge 1866 d31df998d576f3af9bb3b4b3cbac8f90306a4f84   # part-admin-objects  (MUST be first)
merge 1874 2d9e259c32bf2ef6b99fa415233ed0bbc19527e9   # inventory-action
#   >>> then register test/inventoryActionRetirementContract.test.mjs in suites.json <<<
merge 1878 9bccc0032af7c1b8fb4b09b7cac3e4f2afc62b4a   # inventory-cutover-tooling
merge 1880 e8b1992d0d2763fc6526df582e2c678038243e39   # reporting-authority

# --- the eleven migration PRs, in migration-timestamp order --------------------------
merge 1868 7d9496cb9026e898956953a720a096fc73a0c600   # inventory-commitment       1758067200000
merge 1877 f9eedaf54c07c157273159ad739359540b32ff72   # warehouse-bin              1758240000000
merge 1867 5670c8fd62d2b79e3dc95c5d435742797a435dde   # truck-mobile               1758326400000
merge 1870 e284fca93a375032358add4896998f650d0db59c   # employee-principal         1758412800000
merge 1872 286c0e3c6be8b51729ec2c6ca59cfd41f1a4c744   # supplier-manufacturer      1758499200000
merge 1876 2467361e1d7d995e54bfdbf23f41c6a3b8a958ba   # equipment                  1758585600000
merge 1879 99c73ce821446686373237c33d6a305fde152f3b   # purchasing                 1758672000000
merge 1871 7cbf4204ff60f5f7961a1cce9ab672f9132cf100   # account-contact-location   1758758400000  (eos_crm)
merge 1869 cf45ef24aa74acea73b12a2390eb658b132f118f   # commercial                 1758844800000  (eos_commercial)
merge 1875 d99b6519b1526881e5c111527b4c54d95aebab4b   # invoice                    1758931200000
#   >>> register invoiceAdministrationProfile in administrationProfileRegistry.js <<<
merge 1881 8860c9366633837ddaf7189848f7aa38a8c69348   # payment                    1759017600000
#   >>> register paymentAdministrationProfile in administrationProfileRegistry.js <<<

# --- the remaining fourteen ----------------------------------------------------------
merge 1873 c991e37b8241b07e7f4c4fce42602df14f0368c0   # part-ci-hardening
merge 1882 06ab9f31dea21dfa4b1f4bd04a5b8262a1a04bba   # financial-authority
merge 1883 4e9020a2d7aa549c4fb0db223d3e4c066b00c861   # integrations-review
merge 1884 b42715c9a3ff21a9ec2fb83b7520569f5e836f93   # firebase-retirement  (BEFORE 1892)
merge 1885 e37366f59bbf3d71b3114bb7de9905ea092a885c   # scanner-warehouse
merge 1886 8f9b633f4a16893566697f9a1e1a0be49b6f1e94   # list-ns-migrations
merge 1887 25b99e31528c421fd740105333c3680dd6cc605a   # serialized-asset
merge 1888 f87a252689976764821fd4764be7d599493de345   # workorder-authority
merge 1889 4e309004383c68c71b7599f52c6298110b5f52f4   # cyclecount-authority
merge 1890 041910067fe2ceba575db7552fd13549b4feb268   # financial-surfaces
merge 1892 6787d27bb9e8e936d296fc52ec5ea2545aa7fb76   # guard-coverage       (AFTER 1884)
merge 1893 3ee304f37861b28ec436a9e05ee959eea1c9c66f   # scheduling-authority
merge 1894 6c5a2a8ef3e212a26bda703a380abc517f456702   # ai-assistant-authority
merge 1891 27b9ec212613ccb62a71b9a2c1aa36c26b8167a9   # admin-configuration  (LAST: regenerates the graph)

# --- regenerate, last ----------------------------------------------------------------
node scripts/buildAdminPolicySeedSnapshot.mjs
node scripts/buildCapabilityGraph.mjs
```

### After the script

The conflict resolutions in §2 and the fixes in §3 are **not** applied by `gh pr merge`; GitHub will
refuse each conflicting merge. Two ways to land this:

- **Preferred — land the rehearsal.** This branch already *is* the merged result with every conflict
  resolved and every integration defect fixed. Fast-forwarding main to it (or opening one PR from it)
  makes all 29 land atomically, in one reviewed diff, with a green build.
- **Or merge one at a time**, resolving each conflict on GitHub per §2 and applying §3's fixes and
  §4's registrations as you go. Expect the eight conflicting merges, and expect the tree to be red
  between 1868 and the end of the §3 fixes.

Either way, §6 must be decided before the result is green.

---

## 8. Provenance

- Nothing was pushed. `phase2/integration-rehearsal` exists only in this worktree.
- No PR was opened. `gh pr merge` was never run.
- Nothing was merged to `main`; `origin/main` is still `33945090`.
- No sibling worktree and no path under `/mnt/d/Taylor_Parts` was touched.
- Container `w2-rehearsal-pg` on port 55470 was used exclusively and is removed.
