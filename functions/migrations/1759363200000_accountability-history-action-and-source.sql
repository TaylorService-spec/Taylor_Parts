-- Up Migration
-- ACCOUNTABILITY HISTORY becomes the governed accountability AUDIT AUTHORITY: what kind of change, and how.
--
-- ============================================================================
-- MIGRATION 021. Owner ruling 2026-09-14, activation blocker #1 (Option B): PostgreSQL -- not the Firestore
-- AuditAction vocabulary -- is the governed accountability audit authority. A change to an accountable
-- person and its `accountability_handoffs` row are written in ONE PostgreSQL transaction
-- (functions/src/eosCommercial/commercialAccountabilityRepository.ts), the shape
-- `transferCommercialOwnership` already gives ownership.
--
-- STANDARD POSTGRESQL ONLY. Additive: no existing migration is edited, no existing column changes type or
-- nullability, no existing constraint is dropped, and the append-only trigger is untouched.
-- ============================================================================
--
-- ════════════════════ action: DERIVED FROM THE ROW, SO IT CANNOT BE MISLABELLED ════════════════════
--
-- The Owner ruled the semantics in terms of one fact the row already carries:
--
--   ESTABLISHMENT  previous accountable Employee is NULL -- the first governed accountable person, whether at
--                  record creation or on an existing record that had none;
--   HANDOFF        previous accountable Employee is non-NULL, and it changes to a different Employee.
--
-- So `action` is a STORED GENERATED column over `previous_accountable_employee_id`, not a value a writer
-- supplies. A writer cannot label a first assignment a handoff, and any row already present evaluates
-- truthfully the moment this column exists. TEXT with a CHECK rather than an enum because a generation
-- expression must be immutable and an enum input cast is not.
--
-- ════════════════════ source: THE MINT'S PROVENANCE, NOT A CALLER'S ASSERTION ════════════════════
--
-- The governed mint (accountablePersonStorage.ts) already records HOW an accountable person was established:
-- ACCOUNTABLE_PERSON_SOURCES = EXPLICIT | DERIVED_FROM_RECORD_OWNER (#181). The writer persists exactly that
-- minted value, so this enum mirrors that vocabulary and adds NOTHING. `commercial_handoff_source`
-- (DIRECT_HANDOFF | CUSTOMER_HANDOFF_REVIEW | ADMIN_CORRECTION) is deliberately NOT reused: it names the
-- business channel of an OWNERSHIP transfer, which the accountability command does not have, and borrowing it
-- would record accountability in ownership's vocabulary (#187 s1).
--
-- A HANDOFF names its new person explicitly -- the governed handoff mints EXPLICIT -- so a HANDOFF whose
-- source is DERIVED_FROM_RECORD_OWNER is refused: derivation is initialization only (#181).
--
-- ════════════════════ EXISTING ROWS: NOTHING IS INVENTED, NOTHING IS REWRITTEN ════════════════════
--
-- No runtime writer has ever appended to this table, but emptiness is not assumed. A row recorded before this
-- migration has no recorded provenance, and the append-only trigger (020) forbids rewriting it -- correctly.
-- So `source` is nullable in the column, and the requirement is added NOT VALID: PostgreSQL enforces it on
-- every row inserted from now on and does not assert it about rows that predate it. A pre-021 row keeps
-- source NULL, which means "not recorded", and is never given a fabricated value. ADD COLUMN (including the
-- generated column's rewrite) fires no row trigger, so the append-only protection is neither tripped nor
-- disabled.

SET search_path = eos_commercial, public;

CREATE TYPE accountable_person_source AS ENUM (
    'EXPLICIT',
    'DERIVED_FROM_RECORD_OWNER'
);

ALTER TABLE accountability_handoffs
    ADD COLUMN action TEXT GENERATED ALWAYS AS (
        CASE WHEN previous_accountable_employee_id IS NULL THEN 'ESTABLISHMENT' ELSE 'HANDOFF' END
    ) STORED,
    ADD COLUMN source accountable_person_source;

ALTER TABLE accountability_handoffs
    ADD CONSTRAINT accountability_handoff_action_known CHECK (action IN ('ESTABLISHMENT', 'HANDOFF'));

ALTER TABLE accountability_handoffs
    ADD CONSTRAINT accountability_handoff_source_recorded CHECK (source IS NOT NULL) NOT VALID;

ALTER TABLE accountability_handoffs
    ADD CONSTRAINT accountability_handoff_is_explicit CHECK (action <> 'HANDOFF' OR source = 'EXPLICIT');

-- Down Migration
SET search_path = eos_commercial, public;

-- REFUSE WHILE THERE IS HISTORY: dropping `action` and `source` would erase how recorded accountability came to
-- be, which #189 MI-lambda forbids -- the same refusal migration 020's down migration makes.
DO $$
DECLARE
    recorded BIGINT;
BEGIN
    SELECT count(*) INTO recorded FROM eos_commercial.accountability_handoffs;
    IF recorded > 0 THEN
        RAISE EXCEPTION
            'migration 021 refuses to drop accountability history action/source: % accountability changes are recorded',
            recorded
            USING HINT = 'Reversing this migration deletes governed accountability provenance. Export it deliberately first, or do not reverse it.';
    END IF;
END
$$;

ALTER TABLE accountability_handoffs DROP CONSTRAINT IF EXISTS accountability_handoff_is_explicit;
ALTER TABLE accountability_handoffs DROP CONSTRAINT IF EXISTS accountability_handoff_source_recorded;
ALTER TABLE accountability_handoffs DROP CONSTRAINT IF EXISTS accountability_handoff_action_known;
ALTER TABLE accountability_handoffs DROP COLUMN IF EXISTS source;
ALTER TABLE accountability_handoffs DROP COLUMN IF EXISTS action;
DROP TYPE IF EXISTS accountable_person_source;
