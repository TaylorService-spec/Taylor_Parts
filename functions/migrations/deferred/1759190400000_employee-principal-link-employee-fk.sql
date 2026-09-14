-- Up Migration
--
-- ████████████████████████████████████████████████████████████████████████████████████████████████
-- ██  NOT APPLIED. THIS FILE IS NOT IN THE MIGRATION SET AND MUST NOT BE MOVED INTO IT YET.      ██
-- ████████████████████████████████████████████████████████████████████████████████████████████████
--
-- It lives in `functions/migrations/deferred/` and NOT in `functions/migrations/`, which is the whole
-- reason it is safe to have written it. Both the runner and the repository's own test helper look at
-- exactly one directory and never recurse:
--
--   * node-pg-migrate 9.0.0 lists the migrations directory with `readdir(dir, { withFileTypes: true })`
--     and keeps only `dirent.isFile() || dirent.isSymbolicLink()` entries — a subdirectory is dropped;
--   * functions/test/support/migrationSchema.mjs's `migrationFiles()` does
--     `readdirSync(dir).filter(f => f.endsWith(".sql"))` on that same one directory, and `deferred`
--     does not end in `.sql`.
--
-- So `npm run migrate:up` will not apply this, `migrationFiles()` will not count it, and no Postgres
-- suite's `migrateFromClean()` will execute it. Moving it up one directory is the deliberate act that
-- turns it on, and that act must not happen until the PRECONDITION below is met.
--
-- ════════════════════ WHAT THIS IS ════════════════════
--
-- #185's prepared item **D** — `employee_principal_links` FK integrity — and the constraint migration
-- 008 predicted would one day be the only thing left to add. Its own header, at
-- functions/migrations/1758412800000_employee-principal-linkage.sql:55-57:
--
--     "When an `employees` table does arrive, this column is already the right name, the right type
--      and the right cardinality to take a foreign key with no restructuring -- the constraint is the
--      only thing that has to be added, and that is a follow-up this header names rather than one a
--      reader has to infer."
--
-- Migration 019 (1759104000000_employee-business-authority.sql) made the table arrive, including the
-- `employees_tenant_scoped_unique UNIQUE (tenant_id, id)` this key targets. This is the follow-up.
--
-- ════════════════════ WHY IT IS NOT PART OF MIGRATION 019 ════════════════════
--
-- Because a foreign key is a claim about EVERY ROW THAT ALREADY EXISTS, and migration 019 creates
-- `eos_workforce.employees` EMPTY. The Firestore `employees` crosswalk is #185's prepared item **E**
-- and is not in the wave that wrote this file. So on any database that already holds
-- `employee_principal_links` rows, this constraint would be evaluated against Employee ids for which
-- no Employee row can yet exist, and there are exactly three ways to make it pass — all three of which
-- #189 (`MI-λ`) forbids by name:
--
--   * fabricate an Employee row per unresolved id — "must not be fabricated into an Employee";
--   * map the id by coincidence — "Identity must not be inferred from matching strings · matching
--     names · Firebase UID coincidence · technician ids · legacy `users` ids · Principal existence
--     alone";
--   * delete or rewrite the offending link rows — "deleted from immutable history · rewritten merely
--     to satisfy a foreign key".
--
-- The ruling's instruction instead is **MEASURE FIRST**, and the run that authored this file could not:
-- no database was reachable to it (`POLICY_TEST_DATABASE_URL` unset, no credential for the local
-- cluster). The honest classification is therefore **UNPROVEN**, not "unsafe" and certainly not
-- "safe" — and an unproven constraint is not one a migration may assert.
--
-- ════════════════════ THE PRECONDITION FOR MOVING THIS FILE ════════════════════
--
-- Run, against the target database, and read the output rather than assuming it:
--
--     node functions/scripts/measureEmployeeReferenceIntegrity.js \
--         --environment <env> --databaseUrlEnv <VAR>
--
-- It writes nothing. Move this file into `functions/migrations/` only when its report shows, for
-- `eos_policy.employee_principal_links.employee_id`:
--
--     UNRESOLVED = 0        (every employee_id resolves to an eos_workforce.employees row)
--     CROSS_TENANT = 0      (every one resolves WITHIN the link's own tenant)
--
-- If either is non-zero the answer is NOT to weaken this constraint. It is to complete item **E**'s
-- governed crosswalk, or to QUARANTINE the rows that no governed evidence can resolve — #189's
-- "declare and quarantine" — and only then to key the column.
--
-- ════════════════════ WHAT THIS DELIBERATELY DOES NOT DO ════════════════════
--
-- IT KEYS ONE COLUMN, NOT NINE. The other eight Employee-id columns censused in migration 019's header
-- — three in `eos_crm`, five in `eos_commercial` — are NOT keyed here, and two of them CANNOT be keyed
-- by any migration without violating a ruling:
-- `ownership_handoffs.previous_owner_employee_id` and `.new_owner_employee_id` sit on an APPEND-ONLY
-- table (`refuse_ownership_history_mutation`, 016:295-305, raising on UPDATE and DELETE). A bad person
-- id already recorded there is PERMANENT BY DESIGN, exactly as #189 found. Those two columns need a
-- declare-and-quarantine classification, not a key, and that is a separate governed decision.
--
-- `employee_principal_links` is the one column where a key is the right instrument, because that table
-- is NOT append-only, carries `status IN ('active','revoked')` for exactly this kind of lifecycle, and
-- is the governed crosswalk whose entire purpose (#185: "made referentially sound with real foreign
-- keys") is to be referentially sound.
--
-- ════════════════════ WHY THE KEY IS COMPOSITE ════════════════════
--
-- Migration 003's Ruling B shape, which migration 008 already reuses for its principal side
-- (`employee_principal_links_member_fk`, 008:133-135). A key onto `employees(id)` alone would prove
-- the Employee EXISTS; it would not prevent tenant A's link from pointing at tenant B's Employee — a
-- cross-tenant identity leak rather than a dangling row. `(tenant_id, employee_id)` onto
-- `(tenant_id, id)` makes that unrepresentable, and migration 019 declared the UNIQUE it targets.
--
-- NO ON DELETE CASCADE, and no ON UPDATE action. Deleting an Employee must not silently delete the
-- crosswalk row that records who their login was; that row is history. The default NO ACTION is
-- correct here and is stated rather than defaulted into.

SET search_path = eos_policy, public;

ALTER TABLE employee_principal_links
    ADD CONSTRAINT employee_principal_links_employee_fk
    FOREIGN KEY (tenant_id, employee_id)
    REFERENCES eos_workforce.employees (tenant_id, id);

-- Down Migration
SET search_path = eos_policy, public;

-- Dropping a constraint destroys no data, so this down is unconditional -- unlike migration 019's,
-- which refuses because dropping it would destroy the Employee records themselves.

ALTER TABLE employee_principal_links
    DROP CONSTRAINT IF EXISTS employee_principal_links_employee_fk;
