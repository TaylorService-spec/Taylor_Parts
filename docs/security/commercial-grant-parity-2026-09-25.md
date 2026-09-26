# Commercial Grant Parity — 2026-09-25

**Classification: PARITY_CORRECTION_AWAITING_AUTHORIZATION** (controller reclassification, 2026-09-26).
The salesManager finding is a **GOVERNED_AUTHORITY_PARITY_GAP**, not a speculative policy proposal. `salesAgreement.accept`
and `opportunity.createSalesOrder` are required by the governed catalog (`governedBusinessRoles.ts:608,610`),
DECISIONS #121, the Object matrix (`role-capability-contract.json:1549`) and the workflow bindings
(`workflowSeeds.ts:231,254`). Only the PostgreSQL grant projection left them out. Applying the correction is still a
protected grant action, so **nothing here grants, revokes or applies anything** until authorized.

**Owner clarification (2026-09-26).** `salesManager` is a valid Security Role whether or not a canonical Sales Manager
Job Role exists (Job Role ≠ Security Role). How sales management is organised for employees — one Sales Manager over
Retail and National Accounts, or separate Retail and National Accounts Sales Managers — is a separate, future Employee
Operating Model decision. It does not block this parity correction.
No migration, seed, Role catalog, `role_capabilities` row or environment was changed to produce it.

- Lane: S5 (builder, proposal only) · base `09d63c4e`
- Measured: 2026-09-25, offline, from the repository (compiled catalog + committed baseline + committed matrix)
- Proof of every number below: `functions/test/commercialGrantParity.test.mjs` (current state runs; proposed state is skipped until the Owner rules)

## 1. Sources compared

| Source | What it is | File |
|---|---|---|
| **CATALOG** | Compiled legacy Role catalog, read through `deriveLegacyRoleGrants` (the derivation the governed reconcile applies) | `functions/src/access/compatibilityRoles.ts`, `functions/src/access/governedBusinessRoles.ts` |
| **BASELINE** | Deterministic rebuild of the PostgreSQL authority (migrations → seed → catalog reconcile). `rebuildTotal` 413. Its `deployment` block still records `measuredInNonprodTotal: 387` / `notYetAppliedToNonprod: ["migration:1762300800000"]`. That block has been stale since the Phase 3 apply (operator record, 2026-09-25, merge `11668e53`, nonprod measured 413 afterwards); the file itself does not claim nonprod = 413 | `functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json` |
| **MATRIX** | Governed business-intent Object matrix (workbook v2, generated from `docs/assessments/detailed-crud.json`) | `docs/governance/role-capability-contract.json`, `docs/governance/workbook-v2/4-role-to-capability.csv` |

The commercial PostgreSQL vocabulary is exactly nine keys (migration `1759536000000`). `coverage.read/.write` and
`salesOrder.fulfill/.service` are catalog-only (they are deliberately not registered in PostgreSQL). Commercial accountability
(migration `1759276800000`) is a column, not a capability. No `*.accountab*` key exists.

## 2. Measured matrix

Cell = CATALOG / BASELINE. `C` = declared, `M` = MIGRATION_BACKED, `K` = CANONICAL_CATALOG (catalog reconcile), `–` = absent.
**Bold** = discrepancy.

| capability | salesperson | salesManager | owner | dispatcher | generalManager | admin |
|---|---|---|---|---|---|---|
| opportunity.read | C/M | C/M | C/M | C/M | C/M | C/M |
| opportunity.write | C/M | C/M | C/M | C/M ¹ | C/M | C/M |
| **opportunity.createSalesOrder** | C/K | **C/–** | –/– ² | C/K ¹ | C/K | C/K |
| salesAgreement.create | C/M | C/M | C/M | C/M ¹ | C/M | C/M |
| salesAgreement.read | C/M | C/M | C/M | C/M | C/M | C/M |
| salesAgreement.updateDraft | C/M | C/M | C/M | C/M ¹ | C/M | C/M |
| **salesAgreement.accept** | C/K | **C/–** | –/– ² | C/K ¹ | C/K | C/K |
| salesOrder.read | C/M | C/M | C/M | C/M | C/M | C/M |
| salesOrder.write | C/M | C/M | C/M | C/M ¹ | C/M | C/M |
| salesOrder.fulfill *(catalog-only)* | – | – | C | C | – | C |
| salesOrder.service *(catalog-only)* | – | – | C | C | – | C |
| coverage.read/.write *(catalog-only)* | – | – | C | – | – | C |

MATRIX (Opportunities / Sales Orders): salesperson, salesManager, generalManager, admin **and owner** = `CRE` with
`opportunity.createSalesOrder` on Opportunities. Dispatcher = Opportunities *(no access)* / Sales Orders `R`.
Sales Agreement has **no matrix row**; its authority is DECISIONS #121.

¹ Dispatcher over-grant against the MATRIX (D-18). ² Owner is withheld by a deliberate ruling (§3.2).

## 3. Discrepancies

### 3.1 salesManager lacks `salesAgreement.accept` and `opportunity.createSalesOrder`: this is an omission, not a ruling

Evidence:

1. **Every authority that speaks to it says salesManager holds them.** DECISIONS #121 (Owner, 2026-08-25) grants all four
   `salesAgreement.*` to "Salesperson, Sales Manager and General Manager". `SALES_MANAGER_ROLE` in `governedBusinessRoles.ts`
   declares both keys, and has done so since `a030790d` (#1471). The MATRIX names salesManager for `opportunity.createSalesOrder`.
   The seeded workflows bind `salesManager` to `salesAgreement.accept` and to `salesOpportunity.win` (`adminPolicy/workflowSeeds.ts`).
2. **Nothing says otherwise.** No DECISIONS entry, migration header, refused-grant record (`pendingAuthorityCorrections.json`) or
   catalog comment withholds either key from salesManager. The persona matrix (`docs/testing/persona-object-workflow-access-matrix.md`
   §8) states that salesManager "holds no elevated commercial authority over the sales person", so it expected parity, not less.
3. **The mechanism explains the gap.** No migration can produce either pair. `1761523200000` has no `('salesOrder','CREATE')`
   row and excludes `salesAgreement.E` as ambiguous (updateDraft vs accept). No other migration inserts either capability.
   Both pairs therefore depend on the catalog reconcile alone. The only reconcile ever run for them was the Sample Company seed
   (`observedGrantedBy: sample-company-v2:rudy` on all 8 existing pairs), and that seed is scoped to manifest Roles.
   `salesManager` is not a manifest Role (`sampleCompanyRoleKeys`). The baseline records both pairs under
   `catalogDeclaredNotActivated[26,27]`, and its own comment names the cause: "a governed reconcile run that was scoped to a
   subset of Roles … so the catalog moved ahead of the environment".
4. **Consequence:** because a workflow never widens, a Sales Manager bound to *Record customer acceptance* is refused, and cannot
   convert a WON Opportunity. At the capability layer they hold *less* commercial authority than the Salesperson they manage.
   Measured impact today: nonprod salesManager has **0 holders** (persona matrix §2.1), so no live principal is affected.

### 3.2 owner lacks the same two keys: this is DELIBERATE (Owner ruling A), but one record is stale

- **Ruling A** (2026-09-24, commit `fbd670c2`, `docs/governance/owner-capability-contract.md` rows 153–154): maker/checker.
  "Owner can edit an Opportunity's stage and value … so Owner must not also be the actor who converts it", and "the actor
  recording the counterparty's acceptance must not be its author". Owner can still raise an order directly with
  `salesOrder.write` (`salesOrderCommandService.createSalesOrder` requires only that). Both keys are in
  `OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES`, and `ownerCapabilityContract.test.mjs` pins the exclusion.
- **Stale record.** The baseline was generated at `87835135` (03:24), before ruling A narrowed Owner at `fbd670c2` (19:36) the
  same day. `catalogDeclaredNotActivated` therefore still lists **17 owner pairs** (including `[24] owner/opportunity.createSalesOrder`
  and `[25] owner/salesAgreement.accept`) that the catalog **no longer declares**. They are exactly ruling A's in-vocabulary
  exclusions. No guard catches this: `assertGlobalCatalogGrantsAreCatalogDeclared` checks CANONICAL_CATALOG grants only.
- **Unresolved tension.** The MATRIX (designStatus *Proposed*) still names Owner for `opportunity.createSalesOrder`. Ruling A came
  later and was taken on the evidence, so it should prevail, but the matrix has not been corrected to say so.

### 3.3 dispatcher holds the full sell side; the matrix asks for Sales Order READ only (D-18, carried)

These 6 pairs came from `SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS`, a shared list rather than a business ruling:
`opportunity.write`, `opportunity.createSalesOrder`, `salesAgreement.create`, `.updateDraft`, `.accept`, `salesOrder.write`.
The matrix also asks for no Opportunity read, which leaves `opportunity.read` and `salesAgreement.read` as a sub-question.
This is already recorded as persona matrix D-18 (`DO_NOT_GRANT — violates separation of duties`) and as
`workbook-v2/6-gaps-decisions.csv` `LEGACY_COMPATIBILITY_ANOMALY, OPEN`. **Out of scope for this correction.** Withdrawing
these grants is a revoke plus a catalog change to the shared base. Because 1761523200000 re-derives from `role_object_permissions`, the
rebuild shifts too, so it needs its own ruling and regression pass.

## 4. Correction proposal

### Proposal A: grant the two omitted salesManager rows (recommended)

| role | capability | source after | evidence |
|---|---|---|---|
| `salesManager` | `opportunity.createSalesOrder` | MIGRATION_BACKED | `migration:1762387200000` |
| `salesManager` | `salesAgreement.accept` | MIGRATION_BACKED | `migration:1762387200000` |

**Remove nothing.** No catalog change is needed because the catalog already declares both.

**Migration shape.** Use a new, appended migration `functions/migrations/1762387200000_sales-manager-commercial-commitment.sql` with
the 1762300800000 / 1761609600000 shape. Ruling E requires the migration and the baseline to land as **one change**:

- Up: `INSERT INTO role_capabilities … SELECT … FROM (VALUES ('salesManager','opportunity.createSalesOrder'),
  ('salesManager','salesAgreement.accept')) g JOIN roles r ON r.key = g.role_key JOIN capabilities c ON c.key = g.capability_key
  ON CONFLICT DO NOTHING`, stamped `migration:1762387200000`. **Do not precondition on the Role existing.** Roles are written by
  the seed after migrations, and fixture DBs define subsets. After the insert, assert granted == salesManager Roles present.
  Guard (RAISE EXCEPTION): `owner` holds neither key afterwards (ruling A cannot be swept in).
- Down: `DELETE … WHERE granted_by = 'migration:1762387200000'` by provenance only.
- Why a migration rather than a scoped catalog reconcile (the CANONICAL_CATALOG route): a migration reproduces the grant in every
  environment's rebuild and carries its own provenance. It also follows the S2 precedent: `inventoryPutAwayOperator` /
  `inventoryStockRelocationOperator` were catalog-declared-not-activated pairs activated by migration 1762300800000.

**Optional Proposal B (housekeeping, no authority change):** remove the 17 stale `owner` rows from `catalogDeclaredNotActivated`,
which takes it from 30 − 2 − 17 to 11. Also add a guard that every `catalogDeclaredNotActivated` pair is still catalog-declared.

### Fan-out: pinned expectations that must move in the same change

| # | File | Pin | From → to |
|---|---|---|---|
| 1 | `functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json` | `totalGrants`, `grants[]`, `countsBySource.MIGRATION_BACKED`, `grantBearingMigrations`, `deployment.{rebuildTotal,measuredInNonprodTotal,notYetAppliedToNonprod}`, `catalogDeclaredNotActivated` | 413→415; 355→357; +`migration:1762387200000`; `deployment` 413/387/[`migration:1762300800000`] (as committed; stale since the Phase 3 apply, operator record 2026-09-25) → 415/413/[`migration:1762387200000`]. The stale block is corrected in the same change, and `personaBusinessAccessRegression.test.mjs` L338–339 moves with it (row 4); 30→28 (→11 with B) |
| 2 | `functions/test/roleCapabilityAuthorityBaselinePostgres.test.mjs` | L142 total, L144 counts, L243 CDNA length | 413→415, 355→357, 30→28 |
| 3 | `functions/test/pendingAuthorityCorrectionsPostgres.test.mjs` | L112, L117, L551 totals; L114 counts; L198 CDNA; L209–210 assert owner rows remain in CDNA (breaks under B) | 413→415, 355→357, 30→28 |
| 4 | `functions/test/personaBusinessAccessRegression.test.mjs` | L256 migration files; L336–337 rebuild total; L339 `notYetAppliedToNonprod`; L344 stamped count | 51→52, 413→415, re-measure |
| 5 | `functions/test/authorityActivationVehiclePostgres.test.mjs` | L154 `Math.max(ids) == 1762300800000`; L369/L378 `grants: 413` | must be relaxed to "≤ latest" and 413→415 |
| 6 | `functions/test/sampleCompanyPostgres.test.mjs` | L218–219 `PINNED_LAST_MIGRATION` / `PINNED_MIGRATION_COUNT`; **L443 asserts salesManager holds 0 grants** (verify whether its fixture seeds Roles before migrations) | 1762300800000→1762387200000, 51→52 |
| 7 | `functions/test/administrationReadEnforcement.test.mjs` | L163 `migrations.length` | 51→52 |
| 8 | `functions/test/migrationLedgerOrderGuard.test.mjs` | L158 `PENDING_AT_MEASUREMENT` | re-measure against nonprod ledger |
| 9 | `functions/test/commercialGrantParity.test.mjs` (this lane) | set `OWNER_RULING`; the GAP / MECHANISM / WORKFLOW current-state tests go red by design and are rewritten | proposed-state tests un-skip |
| 10 | Docs | `docs/DECISIONS.md` new entry; persona matrix §8 "salesManager differs … by exactly one"; `docs/engineering/ACTIVE_WORKSTREAMS.md` | — |

**Not moved** (verified): Sample Company `postgresCapabilityVocabulary` (no new capability); `adminPolicyActivation` /
`adminPolicySeedCoverage` / `policyObjectRegistry` object counts; governance censuses and `docs/governance/*` (the catalog is
unchanged); `ownerCapabilityContract.test.mjs` (Owner is untouched). If the activation is also recorded in
`pendingAuthorityCorrections.json` `activatedGrants`, then its ruling union, `countsByRuling` and the "exactly the two S2
`alreadyCatalogDeclared` pairs" assertion (`pendingAuthorityCorrectionsPostgres` L203) move too. The recommendation is to record the
activation in the migration header and DECISIONS instead.

Verification after the change: `test:roleCapabilityAuthorityBaseline`, `pendingAuthorityCorrectionsPostgres`,
`authorityActivationVehiclePostgres`, `sampleCompanyPostgres`, `personaBusinessAccessRegression`, and `test:adminPolicy`. Run the PG
suites one at a time.

## 5. Owner decisions needed

1. **Grant `salesAgreement.accept` and `opportunity.createSalesOrder` to `salesManager`** (Proposal A). This carries out
   DECISIONS #121 and the Object matrix, and closes an omission caused by the reconcile's scope. **Yes / No.** If No, the catalog
   declarations, #121 and the two workflow bindings must be withdrawn instead, because a declared-but-never-granted authority is
   the drift AN2 forbids.
2. **Confirm ruling A prevails over the Object matrix for Owner**, so Owner keeps neither key, and authorize correcting
   the matrix row and removing the 17 stale owner `catalogDeclaredNotActivated` rows (Proposal B).
3. **D-18 (dispatcher sell side)**: leave OPEN, or open a separate withdrawal lane. Not decided by this proposal.

The #121 caveat still stands: there is no approval-limit model, so accept is all-or-nothing per Role.
