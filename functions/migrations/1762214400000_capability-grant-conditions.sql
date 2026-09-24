-- Up Migration
-- THE CONDITION BELONGS TO ONE GRANT -- structure only, and ZERO conditional entitlements activated.
--
-- ════════════════════ THE DEFECT THIS RELATION CLOSES ════════════════════
--
-- The governed model separates Capability / Work Eligibility / Operational Scope / Record
-- Assignment correctly, but it could not say:
--
--     Role A holds capability X unconditionally, while Role B holds the SAME X only when P holds.
--
-- There was nowhere to put P that named ONE grant. The two places it could go are both wrong:
--
--     on the ACTION      -> a per-action predicate constrains EVERY holder. Registering
--                           WORK_ELIGIBILITY(PARTS_OPERATIONS) on reorder.purchaseOrder.read would
--                           narrow the ELEVEN Roles the Owner deliberately left unconditioned, and
--                           make each of them pay a context read to be told yes.
--     on the GRANT ROW   -> a `condition` column on role_capabilities (or principal_capabilities)
--                           makes the grant tables answer WHICH as well as WHAT. Administration
--                           reads a grant row as one plain fact -- Role holds capability -- and a
--                           predicate hidden in that row silently changes what every existing
--                           reader of those two tables means.
--
-- SO IT GETS ITS OWN RELATION, keyed by (grantor, capability). `eos_policy.role_capabilities` and
-- `eos_policy.principal_capabilities` are NOT ALTERED BY THIS MIGRATION -- not a column, not a
-- constraint, not an index. That is the whole point of a separate table and it is asserted, not
-- merely intended: test/conditionalEntitlementPostgres.test.mjs measures role_capabilities' column
-- count and refuses any column named condition / condition_kind / predicate / scope / own_only.
--
-- ════════════════════ STRUCTURE ONLY -- ZERO ROWS ════════════════════
--
-- Owner ruling: the initial migration activates ZERO conditional business entitlements. This file
-- contains no INSERT of any kind. After it runs, `capability_grant_conditions` holds 0 rows, every
-- grant in the database is still unconditional, and NO deployed permission has changed -- the
-- effective access of every Role and every Principal is byte-for-byte what it was before.
--
-- THE WITHHELD TECHNICIAN PURCHASE ORDER CELLS REMAIN WITHHELD. `technician ->
-- reorder.purchaseOrder.read` and `technician -> reorder.purchaseOrder.create` are the two cells the
-- conditional model was designed to make expressible; they are NOT granted here, NOT conditioned
-- here, and NOT present as rows here. src/eosOps/conditionalEntitlement.ts keeps
-- SHIPPED_GRANT_CONDITIONS empty and frozen, and its production entry point refuses to run with a
-- catalog that names either cell. A condition row without a grant row confers nothing in any case:
-- this relation NARROWS an existing entitlement and can never create one.
--
-- ════════════════════ THE DDL IS LANE AB's, VERBATIM ════════════════════
--
-- The CREATE TABLE and CREATE INDEX below are `PROPOSED_GRANT_CONDITION_SCHEMA` from
-- functions/src/eosOps/conditionalEntitlement.ts, character for character. The reader
-- (capabilityAuthority.GRANT_CONDITION_RELATION / postgresGrantConditions) was written against that
-- exact text and is proved against it, so the migration carrying a paraphrase would mean the
-- relation the code reads and the relation the database holds were never the same object.
-- conditionalEntitlementPostgres.test.mjs asserts the two texts match.
--
-- What each column is for, and why it is shaped that way:
--
--   grant_scope + grantor_key   the grantor is a DISCRIMINATED UNION, not a role key, so a direct
--                               Principal grant is a first-class conditionable grantor from the
--                               start. Nothing produces one today; the model, key encoding and this
--                               relation all carry PRINCIPAL already, which keeps a future
--                               conditioned direct grant a data change rather than a redesign.
--   capability_key              FK to capabilities(key). A condition on a capability the governed
--                               authority does not know is unresolvable, so it cannot be stored.
--   condition JSONB             the predicate paths. NOT NULL: a row here means "conditioned", and a
--                               NULL condition would be an unconditional grant wearing a
--                               conditioned row's clothes. An unreadable value fails the WHOLE
--                               catalog closed rather than silently reading as unconditioned --
--                               dropping a condition it cannot parse would be a WIDENING.
--   status                      RETIRED rows stay as evidence and are not loaded. Withdrawing a
--                               condition is a status change, not a DELETE of the record that it
--                               ever existed.
--   UNIQUE (tenant, scope, grantor, capability)
--                               ONE grant cell, ONE condition. Two conditions on one cell would
--                               make "what narrows this grant" unanswerable by reading a row.
--
-- Counts: capabilities 76 -> 76, objects 39 -> 39, role_capabilities 387 -> 387,
-- principal_capabilities 0 -> 0, and one new EMPTY table. Nothing else moves.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_exists  INT;
    v_columns TEXT;
BEGIN
    -- THE CENSUS REFUSES RATHER THAN GUESSES.

    -- 1. The relation must not already exist. If it does, something created it outside this chain
    --    and its shape is unreviewed -- CREATE TABLE would fail anyway, and this says why.
    IF to_regclass('eos_policy.capability_grant_conditions') IS NOT NULL THEN
        RAISE EXCEPTION
          'CAPABILITY_GRANT_CONDITIONS: eos_policy.capability_grant_conditions already exists -- '
          'refusing to adopt a relation this chain did not create and has not reviewed';
    END IF;

    -- 2. The FK target must be there. capabilities(key) carries a UNIQUE constraint
    --    (capabilities_key_key); without it the REFERENCES clause below cannot be created, and the
    --    condition could name a capability the governed authority does not know.
    SELECT count(*) INTO v_exists FROM pg_constraint
     WHERE conrelid = 'eos_policy.capabilities'::regclass AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (key)';
    IF v_exists <> 1 THEN
        RAISE EXCEPTION
          'CAPABILITY_GRANT_CONDITIONS: eos_policy.capabilities has no UNIQUE (key) constraint -- '
          'a condition that cannot reference a capability by key has nothing to narrow';
    END IF;

    -- 3. THE TWO GRANT TABLES MUST STILL ANSWER *WHAT*, NEVER *WHICH*. Measured here because it is
    --    the reason this relation exists at all: if a condition/scope column had already appeared on
    --    a grant table, adding a second home for conditions would create two competing answers.
    SELECT string_agg(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name)
      INTO v_columns
      FROM information_schema.columns
     WHERE table_schema = 'eos_policy'
       AND table_name IN ('role_capabilities', 'principal_capabilities')
       AND column_name IN ('condition', 'condition_kind', 'conditions', 'predicate',
                           'qualification_code', 'scope', 'scope_type', 'own_only');
    IF v_columns IS NOT NULL THEN
        RAISE EXCEPTION
          'CAPABILITY_GRANT_CONDITIONS: a grant table already carries a condition/scope column (%) '
          '-- the grant tables answer WHAT, and this relation answers WHICH; two homes for one '
          'answer is the drift this separation exists to prevent', v_columns;
    END IF;
END
$$;

-- ════════════════════ PROPOSED_GRANT_CONDITION_SCHEMA, VERBATIM ════════════════════
-- Copied character for character from functions/src/eosOps/conditionalEntitlement.ts. Do not
-- reformat: a test asserts this text and that constant are the same schema.
CREATE TABLE eos_policy.capability_grant_conditions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    grant_scope     TEXT NOT NULL CHECK (grant_scope IN ('ROLE','PRINCIPAL')),
    grantor_key     TEXT NOT NULL,
    capability_key  TEXT NOT NULL REFERENCES eos_policy.capabilities(key),
    condition       JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
    established_by  TEXT NOT NULL,
    established_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, grant_scope, grantor_key, capability_key)
);
CREATE INDEX capability_grant_conditions_by_capability
    ON eos_policy.capability_grant_conditions (tenant_id, capability_key);

-- NO INSERT FOLLOWS. Structure only, by Owner ruling. The relation is created EMPTY and stays empty
-- until an Administration decision -- never a migration -- puts a condition in it.

-- Down Migration
SET search_path = eos_policy, public;

-- GUARDED. An empty relation is this migration's own work and reverses cleanly. A relation holding
-- rows is recorded policy an administrator established, and a down migration does not get to
-- destroy it: dropping the table would silently turn every conditioned grant back into an
-- UNCONDITIONAL one, which is a widening performed by a rollback.
DO $$
DECLARE
    v_rows INT;
BEGIN
    IF to_regclass('eos_policy.capability_grant_conditions') IS NULL THEN
        RETURN;
    END IF;

    SELECT count(*) INTO v_rows FROM eos_policy.capability_grant_conditions;
    IF v_rows > 0 THEN
        RAISE EXCEPTION
          'CAPABILITY_GRANT_CONDITIONS: refuses to reverse -- % grant condition row(s) exist, and '
          'dropping them would widen every one of those grants back to unconditional', v_rows;
    END IF;

    DROP INDEX IF EXISTS eos_policy.capability_grant_conditions_by_capability;
    DROP TABLE eos_policy.capability_grant_conditions;
END
$$;
