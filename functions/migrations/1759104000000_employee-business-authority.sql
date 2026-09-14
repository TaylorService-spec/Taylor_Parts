-- Up Migration
-- The canonical business Employee relation — the place the PERSON finally lives.
--
-- ============================================================================
-- MIGRATION 019. Owner ruling #185 (`MI-ι`): **BUSINESS EMPLOYEE IS BUSINESS DATA, and the canonical
-- Employee authority belongs in EOS-owned PostgreSQL.** Until this migration there was no Employee
-- relation anywhere in this schema set. Migration 008
-- (functions/migrations/1758412800000_employee-principal-linkage.sql:47-48) says so in its own
-- header, in capitals: "THERE IS NO `employees` TABLE IN POSTGRESQL YET. The canonical Employee
-- record still lives in Firestore's `employees` collection." This migration is the one that changes
-- that sentence, and it is the ONLY new Employee authority — see the next section.
--
-- STANDARD POSTGRESQL ONLY, same as 001-018. Additive: no existing migration is edited, no existing
-- table gains or loses a column, and no existing constraint is added, dropped or altered.
-- ============================================================================
--
-- ════════════════════ THE THREE CONCEPTS THIS MIGRATION KEEPS APART ════════════════════
--
-- #185 rules them permanently separate, and the whole shape of this file follows from that:
--
--   EMPLOYEE    — who is this person operationally in the business  → THIS TABLE
--   PRINCIPAL   — who is this actor for authorization               → eos_policy.principals (002)
--   CREDENTIAL  — proof of who is signing in                        → the credential provider only
--
-- Resolution runs ONE way: CREDENTIAL → PRINCIPAL → EMPLOYEE LINK → EMPLOYEE. Never "Firebase user,
-- therefore Employee". Four consequences are built into the DDL below rather than left to prose:
--
--   * `eos_policy.principals` IS NOT TOUCHED. No `employee_id` column is added to it, and no
--     business fact about an Employee is written into it. Migration 008's header already refused
--     that (`:19-33`) and its three reasons are unchanged by this migration: a principal is not
--     tenant-scoped, 002 keeps `principals` provider-neutral so swapping the identity provider is a
--     row change rather than a schema change, and a business fact hung off the security identity
--     table makes the security identity table a business table.
--   * `employee_principal_links` IS NOT REPLACED. It stays the governed crosswalk, exactly as it is.
--     This migration adds no column to it and no constraint on it — see the FOREIGN KEY section,
--     which is the load-bearing decision in this file.
--   * A PRINCIPAL PK IS NOT AN EMPLOYEE PK. `employees.id` is the canonical business Employee id and
--     is never a `principals.id`, never an `external_subject`, never a Firebase UID, and never a
--     `fieldops_technicians` id. #185: "Insufficient as proof that an Employee exists: a non-empty
--     string · a Firebase uid · a technician id · Principal existence alone."
--   * THERE IS EXACTLY ONE NEW RELATION. Not an employee table plus a status-history table plus a
--     role table. A second Employee-shaped relation added in the same breath is a second place the
--     same person can be asserted, and #185's target names ONE "PostgreSQL Employee relation".
--
-- ════════════════════ WHY A NEW SCHEMA, AND WHY NOT eos_policy ════════════════════
--
-- `eos_workforce`. The alternative that looks smaller — putting `employees` in `eos_policy` beside
-- `principals` and `employee_principal_links` — is refused, and refused for the reason this migration
-- exists at all.
--
-- #185's "ARCHITECTURE AUTHORITY CONFLICT" section found FOUR places in the architecture documents
-- where the word `/Employee` had been appended to the IDENTITY carve-out, and ruled every one of them
-- wrong: "UID → PRINCIPAL correlation is legitimately identity; UID → EMPLOYEE is not... it is exactly
-- the seam by which Employee business data could have been retained in Firebase under an identity
-- label." A table called `eos_policy.employees` would rebuild that same seam in SQL — one schema
-- qualifier asserting that the business person record is policy/identity data. The schema name is the
-- part a reader sees at every call site, so it is the part that has to be right.
--
-- `eos_ops` was the other candidate and is also refused: it holds operational LOGISTICS authority —
-- warehouses, bins, trucks, equipment, suppliers, purchase orders, movements. A person is not a
-- location or a part. The repository's established idiom is one schema per business domain
-- (`eos_ops` 005, `eos_crm` 015, `eos_commercial` 016, `eos_finance` 017), and WORKFORCE is a domain
-- of that same grain. `declaredSchemas()` (functions/test/support/migrationSchema.mjs) derives the
-- schema list from the migration files, so adding one needs no shared test edited.
--
-- ════════════════════ WHY THE EMPLOYMENT VOCABULARY IS A SQL ENUM ════════════════════
--
-- Migration 016 states the repository's test for this (`1758844800000:161-164`): a closed vocabulary
-- "the platform defines, not something a customer configures" may be a SQL enum, and that is why
-- `commercial_handoff_source` is one while `operating_company_key` is only shape-checked.
--
-- EMPLOYMENT STATUS passes that test. It is platform-defined, frozen in code, and already guarded:
-- `EMPLOYMENT_STATUS_VALUES` at functions/src/access/employeeProfileCommands.ts:122-129, six values,
-- `Object.freeze`d. So it is an enum, and `link_source`'s CHECK idiom (008) is NOT copied here —
-- that vocabulary is two terms whose whole point is that the THIRD one must be unrepresentable, and
-- 008's header argues for the CHECK precisely so a new term costs a visible edit to a constraint.
-- Both idioms are in this repository on purpose and they answer different questions.
--
-- THE SIX VALUES, AND WHERE THEY WERE READ FROM. Verbatim, in order, from
-- functions/src/access/employeeProfileCommands.ts:122-129:
--
--     ACTIVE · ON_LEAVE · INACTIVE · TERMINATED · RETIRED · CONTRACTOR
--
-- Nothing is invented, nothing omitted, and the order is theirs. #186 §4 is explicit: "Preserve the
-- canonical governed Employee lifecycle vocabulary; do not create an accountability-specific
-- lifecycle vocabulary for this ruling, and do not invent statuses." #189 `MI-ε` repeats the six by
-- name and adds that the gate "must not flatten the six-value vocabulary into a hidden boolean
-- policy."
--
-- A CORRECTION CARRIED FROM #186, because it changes which file a drift guard must point at. That
-- module's own header (`:116-121`) claims `functions/scripts/provisionEmployeeAccess.js` mirrors the
-- same closed set. **It does not** — that script contains only `EMPLOYMENT_STATUS_ACTIVE`. The real
-- canonical home, and what the shipped mirror test at
-- functions/test/employeeProfileCommands.test.mjs:570 actually checks against, is
-- `field-ops-app-vite/src/domain/constants.js`'s `EMPLOYMENT_STATUS`. Both were read for this
-- migration and both hold the same six values in the same order.
--
-- NO DEFAULT on the column, for migration 008's reason for `operating_company_id` (`:100-104`): a
-- DEFAULT lets a writer that never decided a status produce a row that claims one, and after the fact
-- that is indistinguishable from a deliberate statement. `ACTIVE` is the value a careless default
-- would pick, and "silently ACTIVE" is the most expensive wrong answer this table can give.
--
-- ════════════════════ WHY employment_status IS NOT AN ELIGIBILITY FLAG ════════════════════
--
-- #186 (`MI-S`) and #189 (`MI-ε`) both bind here, and this column is where the mistake would be made.
--
--     "REFERENCE VALIDITY · EMPLOYEE LIFECYCLE STATUS · CURRENT ACCOUNTABILITY ELIGIBILITY are three
--      separate facts." (#186 §2)
--
-- So this table carries the LIFECYCLE STATUS and NOTHING ABOUT ELIGIBILITY. There is deliberately no
-- `is_eligible`, no `can_be_accountable`, no `is_active` boolean, and no partial index keyed on
-- `employment_status = 'ACTIVE'`. Any of those would encode `status <> 'ACTIVE' → not eligible` into
-- the schema, which #189 forbids in terms: "Do NOT implement this as `status != ACTIVE → refuse`
-- unless the governed eligibility policy for that operation explicitly says so."
--
-- A row's existence is the REFERENCE VALIDITY fact. Its `employment_status` is the LIFECYCLE fact.
-- ELIGIBILITY is a policy layer's answer, computed per operation from the lifecycle fact plus that
-- operation's governed policy, and it is not stored here. The existing consumer that gets this wrong
-- is named by #186 §4 — functions/src/access/operationalRoleContext.ts:123 reads all six values
-- through one `!== "ACTIVE"` test — and it is a CONSUMER defect, which is where the ruling says the
-- policy belongs and where it must be fixed. This migration does not change it.
--
-- Equally, a TERMINATED or RETIRED Employee is a perfectly good row here. #186 §1: "a FORMER /
-- INACTIVE / TERMINATED employee may remain a VALID REFERENCE while separately being NOT CURRENTLY
-- ELIGIBLE FOR NEW ACCOUNTABILITY." Deleting such a row to express ineligibility would destroy the
-- historical reference that #182 §2 and #186 §7 require be preserved.
--
-- ════════════════════ THE FOREIGN KEY DECISION — `MI-λ`, AND NO FK IS ADDED HERE ════════════════════
--
-- THIS MIGRATION ADDS NO FOREIGN KEY FROM ANY EXISTING PERSON-REFERENCE COLUMN TO `employees`. That
-- is a decision, not an omission, and #189 (`MI-λ`) is what governs it: "DECLARE AND QUARANTINE... A
-- direct FK requirement must not be allowed to destroy historical truth... MEASURE FIRST."
--
-- THE CENSUS, taken at this baseline across all 18 prior migrations. NINE columns in three schemas
-- hold an EMPLOYEE id, and not one of them carries a foreign key today:
--
--   eos_policy.employee_principal_links.employee_id          NOT NULL   (008:120)
--   eos_crm.accounts.owner_employee_id                       NULL       (015:176)
--   eos_crm.contacts.owner_employee_id                       NULL       (015:219)
--   eos_crm.account_locations.owner_employee_id              NULL       (015:262)
--   eos_commercial.opportunities.owner_employee_id           NOT NULL   (016:184)
--   eos_commercial.sales_agreements.owner_employee_id        NOT NULL   (016:208)
--   eos_commercial.sales_orders.owner_employee_id            NOT NULL   (016:233)
--   eos_commercial.ownership_handoffs.previous_owner_employee_id  NULL  (016:262)  APPEND-ONLY
--   eos_commercial.ownership_handoffs.new_owner_employee_id  NOT NULL   (016:263)  APPEND-ONLY
--
-- AND A DISTINCTION THAT MATTERS MORE THAN THE COUNT. The migration set also holds roughly sixty
-- `created_by` / `updated_by` / `actor_uid` / `granted_by` / `recorded_by` / `claimed_by` columns.
-- NONE of them is an Employee reference and none is in scope for this relation. They hold the
-- CREDENTIAL/PRINCIPAL-side actor id, and #185's chain runs CREDENTIAL → PRINCIPAL → EMPLOYEE LINK →
-- EMPLOYEE in that direction only. Keying any of them onto `employees` would be inferring an Employee
-- identity from a credential id — the precise inference #185 calls "insufficient as proof that an
-- Employee exists" and #189 forbids. The measurement script below classifies them as OUT OF SCOPE by
-- name rather than counting them, so the distinction is enforced by an artifact and not by memory.
--
-- WHY IT CANNOT BE ADDED IN THIS FILE. A foreign key is a claim about EVERY ROW THAT ALREADY EXISTS.
-- This table is created EMPTY by this migration — the Firestore `employees` crosswalk is #185's
-- prepared item **E** and is not in this wave — so on any database that already holds
-- `employee_principal_links` rows, or `eos_commercial` rows, the constraint would be evaluated
-- against person ids for which no Employee row can yet exist. There are then only three ways to make
-- it pass, and #189 forbids all three by name:
--
--   * fabricate an Employee row per unresolved id — "must not be fabricated into an Employee";
--   * infer the Employee from the id that happens to be there — "Identity must not be inferred from
--     matching strings · matching names · Firebase UID coincidence · technician ids · legacy `users`
--     ids · Principal existence alone";
--   * delete or rewrite the offending rows — "deleted from immutable history · rewritten merely to
--     satisfy a foreign key".
--
-- AND FOR `ownership_handoffs` A BAD ROW IS PERMANENT BY DESIGN, which is why #189 singles it out.
-- Verified at source: migration 016 protects that table with `refuse_ownership_history_mutation`
-- (`1758844800000:295-305`), and in the same CREATE TABLE four columns carry foreign keys while the
-- two PERSON columns carry none — `previous_owner_employee_id TEXT` and
-- `new_owner_employee_id TEXT NOT NULL` (`:256-263`). An UPDATE or DELETE there raises. So an
-- unresolvable person id already written to that table cannot be repaired at all, and a naive FK onto
-- it would either fail forever or demand the history mutation the trigger and the ruling both refuse.
--
-- I COULD NOT MEASURE, AND I WILL NOT GUESS. This migration was authored with NO reachable database:
-- `POLICY_TEST_DATABASE_URL` is unset and no credential for the local cluster was available to the
-- run. So the honest statement is that the FK is UNPROVEN rather than unsafe, and an unproven
-- constraint is not one this file may assert. What was delivered instead is the measurement itself:
--
--     functions/scripts/measureEmployeeReferenceIntegrity.js
--
-- — a read-only CLI that counts and classifies every existing person reference against this relation
-- and writes nothing. That is how "MEASURE FIRST" becomes an artifact rather than an intention.
--
-- WHERE THE CONSTRAINT ACTUALLY LIVES, so it is not lost:
--
--     functions/migrations/deferred/1759190400000_employee-principal-link-employee-fk.sql
--
-- A separate, complete, clearly-labelled follow-up migration — #185's prepared item **D**. It is in
-- `deferred/` and therefore NOT APPLIED: node-pg-migrate 9 lists only `dirent.isFile()` entries of
-- the migrations directory and never recurses, and the repository's own `migrationFiles()` helper
-- filters on `.endsWith(".sql")` in that one directory, so a subdirectory is invisible to both. It is
-- held there because its precondition — the Employee crosswalk of item **E** having run, and the
-- measurement above reporting ZERO unresolved links — is not met by this wave, and a migration that
-- asserts "apply me now" when that is false is a worse artifact than one that says why it waits.
--
-- ════════════════════ WHY `UNIQUE (tenant_id, id)` EXISTS ON A TABLE WITH A PK ════════════════════
--
-- It looks redundant next to `id PRIMARY KEY` and it is not. It is the TARGET the deferred constraint
-- needs, and it is what makes that constraint the one migration 003's Ruling B shape already
-- established rather than a weaker new one.
--
-- `employee_principal_links` carries `(tenant_id, employee_id)`. A key onto `employees(id)` alone
-- would prove the Employee EXISTS; it would not prevent tenant A's link from pointing at tenant B's
-- Employee — a cross-tenant identity leak rather than a dangling row. With this UNIQUE declared here,
--
--     employee_principal_links (tenant_id, employee_id) REFERENCES eos_workforce.employees (tenant_id, id)
--
-- is available and makes that unrepresentable. This is exactly how 008 keys onto `tenant_memberships`
-- (`:133-135`), reused rather than re-argued. Declaring it now costs one index and means the deferred
-- migration adds a constraint and nothing else — which is what 008 predicted it would be (`:55-57`:
-- "the constraint is the only thing that has to be added").
--
-- AND `id` IS STILL THE PRIMARY KEY, deliberately. Every existing person reference in this schema set
-- is a BARE id with no tenant beside it — `opportunities.owner_employee_id`,
-- `ownership_handoffs.new_owner_employee_id`, and the rest. A composite-only Employee key would make
-- those references unresolvable without a tenant the referring row does not carry, so the bare id has
-- to remain sufficient to identify one Employee. Both keys are needed and neither is decoration.
--
-- ════════════════════ WHY THE OPERATING COMPANY IS STATED, NOT DERIVED ════════════════════
--
-- Migration 008's reason exactly (`:96-107`), reused rather than re-argued. NOT NULL with NO DEFAULT,
-- because a DEFAULT lets a writer that never decided a company still produce a row that claims one.
-- Never derived — not from a warehouse, not from a truck, not from `homeWarehouseId`, and not from the
-- Employee's job title. The CHECK validates SHAPE only (the same slug pattern as
-- functions/src/ownership/operatingCompanyAuthority.ts's isOperatingCompanyIdShape), never
-- MEMBERSHIP: the governed set is the authority layer's answer, and encoding `taylor`/`ventana` here
-- would make adding a third company a schema migration.
--
-- ════════════════════ WHAT THIS TABLE DELIBERATELY DOES NOT CARRY ════════════════════
--
-- #185 lists many business facts an Employee has — job role, manager, department, availability,
-- proficiency, qualifications, certifications, assignment context, responsibility coverage. NONE of
-- them is here, and their absence is the smallest-correct-change discipline rather than an oversight.
-- This wave establishes the PERSON AUTHORITY: does this Employee exist, under which tenant and
-- operating company, and what is their lifecycle status. That is what `OD-6` Layer 1 resolution needs
-- and it is prepared items **A** and **B**. Every other fact arrives with the governed model that
-- owns it, in the wave that rules on it.
--
-- Four omissions are specifically worth naming because a reader will look for them:
--
--   * NO `display_name`. Migration 008 (`:116-121`) records `display_name` as authoritative on
--     `principals`, and a copy here would be a second place for one fact to be stated, "which is the
--     only way two places can ever disagree."
--   * NO `external_subject`, `identity_provider` or `firebase_uid`. Those are the credential/identity
--     side. A UID column on the Employee table is the `/Employee` seam again, in a column this time.
--   * NO `technician_id`. #187 §3 (`MI-θ`): technician linkage is a DOMAIN PROJECTION, not core person
--     authority, and "`fieldops_technicians` must NOT become canonical Employee authority". 008's
--     census is why — 11 of 13 technician ids coincide with Employee ids and 2 do not, so "a rule
--     inferred from the 11 is provably wrong for the 2."
--   * NO status-history table. #185's item **C** (historical retention semantics) is prepared, not
--     ruled. `audit_events` (001) already records governed mutations, and inventing a second history
--     mechanism before the ruling that shapes it is how the wrong one gets entrenched.
--
-- ════════════════════ THE DOWN MIGRATION REFUSES ════════════════════
--
-- Migration 015's shape ("REFUSE, NEVER DESTROY"), and for a stronger reason than customer master
-- data. This table is the canonical identity of PEOPLE, and every governed accountability and
-- ownership reference in the system is meant to resolve against it. Dropping it because someone
-- stepped one migration too far back is not a reversal, it is a deletion with no record of what was
-- deleted — and it is precisely the "deleted from immutable history" that #189 forbids. So the down
-- COUNTS first and RAISES with the count. An empty schema reverses freely; a populated one does not.

CREATE SCHEMA IF NOT EXISTS eos_workforce;
SET search_path = eos_workforce, public;

-- ============================ the employment vocabulary ============================
--
-- Mirrors EMPLOYMENT_STATUS_VALUES exactly (functions/src/access/employeeProfileCommands.ts:122-129),
-- whose canonical home is field-ops-app-vite/src/domain/constants.js's EMPLOYMENT_STATUS. Six values,
-- this order, platform-defined. functions/test/employeeBusinessAuthorityMigration.test.mjs asserts
-- this list against that export, so the mirror cannot drift silently -- the same guard the shipped
-- functions/test/employeeProfileCommands.test.mjs:570 keeps over the TypeScript copy.

CREATE TYPE workforce_employment_status AS ENUM (
    'ACTIVE',
    'ON_LEAVE',
    'INACTIVE',
    'TERMINATED',
    'RETIRED',
    'CONTRACTOR'
);

-- ============================ the Employee ============================

CREATE TABLE employees (
    -- The canonical business Employee id, and the only Employee identity in EOS. Never a
    -- principals.id, never an external_subject, never a Firebase UID, never a technician id.
    id                   TEXT PRIMARY KEY,
    -- An Employee IS tenant-scoped -- migration 008's header states this as the first of its three
    -- reasons a link table exists rather than a column on `principals`. A real key, because the
    -- tenant is the one thing here that is not allowed to dangle.
    tenant_id            TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    -- The LIFECYCLE fact. Not an eligibility flag; see the header. No DEFAULT, deliberately.
    employment_status    workforce_employment_status NOT NULL,
    -- Stated by the writer, never inferred. Shape-checked, never membership-checked.
    operating_company_id TEXT        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The TARGET the deferred employee_principal_links foreign key needs, and what makes that key
    -- migration 003's Ruling B shape (tenant-scoped) rather than a weaker existence-only one.
    CONSTRAINT employees_tenant_scoped_unique UNIQUE (tenant_id, id),

    -- The same id shape migration 008 requires of the value it carries opaquely
    -- (employee_principal_links_employee_id_shape): non-empty, trimmed, and not a path. An id
    -- containing "/" or untrimmed whitespace is not an id at all, it is a path or a typo -- and the
    -- two columns must agree on shape or the deferred key could never match.
    CONSTRAINT employees_id_shape
        CHECK (id <> '' AND btrim(id) = id AND position('/' in id) = 0),

    -- The same slug shape operatingCompanyAuthority.ts's isOperatingCompanyIdShape() accepts, and
    -- the same CHECK migration 008 writes for its own copy of this column.
    CONSTRAINT employees_operating_company_shape
        CHECK (operating_company_id ~ '^[a-z][a-z0-9_-]{1,62}$')
);

-- ============================ the reads the authority makes ============================
--
-- The resolution lookup is by bare `id` and the PRIMARY KEY already serves it -- which is the point of
-- the bare-id key (see the header).
--
-- This index is for the CENSUS read: "every Employee in this tenant, by lifecycle status". NOT
-- PARTIAL, and not keyed on 'ACTIVE'. A partial index `WHERE employment_status = 'ACTIVE'` would be
-- the schema quietly asserting that ACTIVE is the interesting value and the other five are one
-- bucket, which is exactly the collapse #186 §4 and #189 MI-ε forbid. All six values are equally
-- indexed because all six are equally real answers.

CREATE INDEX employees_by_tenant_status ON employees (tenant_id, employment_status);

-- Down Migration
SET search_path = eos_workforce, public;

-- ════════════════════ REFUSE, NEVER DESTROY ════════════════════
--
-- Migration 015's shape. `employees` is the canonical identity of PEOPLE and the target every governed
-- person reference is meant to resolve against; dropping it silently because someone stepped one
-- migration too far back is a deletion with no record of what was deleted, and #189 (`MI-λ`) forbids
-- exactly that. The down COUNTS first and RAISES with the count. A failed down is recoverable; a
-- successful one here would not be.

DO $$
DECLARE
    recorded BIGINT;
BEGIN
    SELECT count(*) INTO recorded FROM eos_workforce.employees;
    IF recorded > 0 THEN
        RAISE EXCEPTION
            'migration 019 refuses to drop eos_workforce: % Employee records are held and they are the canonical business identity of those people',
            recorded
            USING HINT = 'Reversing this migration deletes the Employee authority that governed ownership and accountability references resolve against. Export or re-home these rows deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP INDEX IF EXISTS employees_by_tenant_status;

DROP TABLE IF EXISTS employees;

DROP TYPE IF EXISTS workforce_employment_status;

DROP SCHEMA IF EXISTS eos_workforce CASCADE;
