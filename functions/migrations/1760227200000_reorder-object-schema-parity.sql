-- Up Migration
-- REORDER OBJECT SCHEMA PARITY -- phase 1 of the Reorder Domain Cutover.
--
-- ============================================================================
-- MIGRATION 035. The governed PostgreSQL Reorder gains the columns needed to represent every CURRENT
-- authored business fact of a legacy Firestore Reorder, plus the provenance needed to state a
-- migrated record's unknowns truthfully.
--
-- NOTHING WRITES ANY OF IT YET beyond stating NATIVE provenance on the existing create: no copy has
-- run, no route exists, no client is changed, and Firestore remains Reorder authority until cutover.
-- ============================================================================
--
-- ════════════════════ WHY THESE COLUMNS, AND NOT A JUDGEMENT CALL ════════════════════
--
-- Every column here is DERIVED from reorderFieldParityMatrix.ts, whose suite extracts the closed
-- legacy key set from firestore.rules and fails on any field without a disposition. A column exists
-- here for exactly those fields the matrix marks `schemaParityCorrection`, and the migration proof
-- asserts the two agree. Neither list is maintained by hand against the other.
--
-- The alternative was the status quo: purchasingMigrationMapping.ts reads ELEVEN of the legacy
-- document's THIRTY-EIGHT fields and ignores the rest without refusing, so a copy would have dropped
-- every review note, cancellation reason and purchasing update while appearing to succeed.
--
-- AN AUDIT EVENT IS NOT A BUSINESS FACT. `audit_events` records that a mutation happened. A review
-- note is what the reviewer wrote. These columns exist because no governed subordinate authority
-- already holds those facts -- unlike the void triple, which purchase_order_voids already holds by
-- name, and the assignment triple, which migration 1760140800000 owns.
--
-- ════════════════════ THE ONE NON-ADDITIVE CHANGE, AND WHY IT IS AUTHORIZED ════════════════════
--
-- `requested_by` loses NOT NULL. Every other change here is additive.
--
-- The native path means `requested_by` = an EOS Principal id, and that semantic is kept. The legacy
-- field is a Firebase uid, which is NOT copied verbatim: it resolves through
-- (identity_provider='firebase', external_subject) to a governed Principal, with no name, email or
-- role inference anywhere. When it resolves to nothing, the honest record is that the historical
-- requester is unknown -- so no Principal is fabricated, the migration executor is not substituted,
-- and no generic "migration Principal" is recorded as though it raised the Reorder.
--
-- A NOT NULL column cannot say "unknown", so it would have forced exactly the fabrication the ruling
-- forbids. The constraint below keeps the native guarantee intact while letting a MIGRATED row be
-- truthful, and it is the same shape reorder_assignment_native_actor_present already uses.
--
-- This is safe to relax because it is MEASURED, not assumed: `requested_by` is written by
-- createReorderRequest and never read back -- no SELECT in purchasingRepository.ts names it and
-- ReorderRequestRecord does not carry it -- so nothing authorizes, routes, owns, assigns or
-- transitions on its value.

SET search_path = eos_ops, public;

-- NATIVE means this Reorder was raised through the governed command. MIGRATED means it was copied
-- from the legacy Firestore object, where some facts may be unrecoverable. Same vocabulary as
-- ops_location_provenance and ops_assignment_provenance.
CREATE TYPE ops_reorder_provenance AS ENUM ('NATIVE', 'MIGRATED');

-- DEFAULT then DROP DEFAULT: the default exists only so the ALTER is safe against any row that may
-- already be present. Once dropped, every INSERT must STATE its provenance rather than inherit one,
-- which is the property that makes the constraint below meaningful.
ALTER TABLE reorder_requests
    ADD COLUMN provenance ops_reorder_provenance NOT NULL DEFAULT 'NATIVE';
ALTER TABLE reorder_requests
    ALTER COLUMN provenance DROP DEFAULT;

ALTER TABLE reorder_requests
    ALTER COLUMN requested_by DROP NOT NULL;

ALTER TABLE reorder_requests
    -- The recommendation classification authored at creation.
    ADD COLUMN recommendation_status                   TEXT,
    ADD COLUMN urgency                                 TEXT,
    ADD COLUMN quantity_source                          TEXT,
    -- Review.
    ADD COLUMN review_decision                          TEXT,
    ADD COLUMN review_notes                             TEXT,
    ADD COLUMN reviewed_at                              TIMESTAMPTZ,
    ADD COLUMN reviewed_by_principal_id                 TEXT,
    -- Purchasing progress.
    ADD COLUMN purchasing_started_at                    TIMESTAMPTZ,
    ADD COLUMN purchasing_started_by_principal_id       TEXT,
    ADD COLUMN purchasing_notes                         TEXT,
    -- A checkbox in the client (`e.target.checked`), so a boolean here and not a nullable string
    -- that would let "false" and "no" and "" all mean different things to different readers.
    ADD COLUMN vendor_contacted                         BOOLEAN,
    -- <input type="date"> -- an ISO calendar day, so DATE. Never parsed from a free string by a
    -- locale-dependent Date constructor that would read "03/04/2026" as March or April by mood.
    ADD COLUMN expected_availability_date               DATE,
    ADD COLUMN last_purchasing_update_at                TIMESTAMPTZ,
    ADD COLUMN last_purchasing_update_by_principal_id   TEXT,
    -- Cancellation: the Reorder's own terminal transition.
    ADD COLUMN cancelled_at                             TIMESTAMPTZ,
    ADD COLUMN cancelled_by_principal_id                TEXT,
    ADD COLUMN cancellation_reason                      TEXT,
    -- Receipt: also the Reorder's own terminal transition. Deliberately NOT retired into
    -- receiving_orders, which is a different object with its own lifecycle (EXPECTED -> CHECKED_IN
    -- -> PUTAWAY_COMPLETE) and supports partial and multi-line receipts, so its created_at is not
    -- this Reorder's received instant and there is no one-to-one guarantee to rely on.
    ADD COLUMN received_at                              TIMESTAMPTZ,
    ADD COLUMN received_by_principal_id                 TEXT;

ALTER TABLE reorder_requests
    -- The native guarantee, preserved; the migrated unknown, permitted. Same shape as
    -- reorder_assignment_native_actor_present.
    ADD CONSTRAINT reorder_native_requester_present CHECK (
        (provenance = 'NATIVE' AND requested_by IS NOT NULL AND btrim(requested_by) <> '')
        OR (provenance = 'MIGRATED' AND (requested_by IS NULL OR btrim(requested_by) <> ''))
    ) NOT VALID,

    -- Blank is not a value. Each of these is either absent or says something.
    ADD CONSTRAINT reorder_recommendation_status_shape
        CHECK (recommendation_status IS NULL OR btrim(recommendation_status) <> ''),
    ADD CONSTRAINT reorder_urgency_shape         CHECK (urgency IS NULL OR btrim(urgency) <> ''),
    ADD CONSTRAINT reorder_quantity_source_shape CHECK (quantity_source IS NULL OR btrim(quantity_source) <> ''),
    ADD CONSTRAINT reorder_review_notes_shape    CHECK (review_notes IS NULL OR btrim(review_notes) <> ''),
    ADD CONSTRAINT reorder_purchasing_notes_shape CHECK (purchasing_notes IS NULL OR btrim(purchasing_notes) <> ''),
    ADD CONSTRAINT reorder_cancellation_reason_shape
        CHECK (cancellation_reason IS NULL OR btrim(cancellation_reason) <> ''),

    -- firestore.rules admits exactly two review decisions (the APPROVED and REJECTED arms).
    ADD CONSTRAINT reorder_review_decision_known
        CHECK (review_decision IS NULL OR review_decision IN ('APPROVED', 'REJECTED')),

    -- A decision and its moment travel together: half a review is not a review.
    ADD CONSTRAINT reorder_review_decided_with_moment
        CHECK ((review_decision IS NULL) = (reviewed_at IS NULL)) NOT VALID,

    -- A terminal transition states WHEN it happened. WHO may be unknown on a migrated record, but
    -- the instant is on the source document, so its absence would mean the status is unexplained.
    ADD CONSTRAINT reorder_cancelled_with_moment
        CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL) NOT VALID,
    ADD CONSTRAINT reorder_received_with_moment
        CHECK (status <> 'RECEIVED' OR received_at IS NOT NULL) NOT VALID;

-- ════════════════════ RULING 3: THE OPERATING COMPANY MUST BE GOVERNED ════════════════════
--
-- requireOperatingCompanyKey is a non-empty-string check and never consults the ownership registry,
-- so today a valid-looking slug reaches a governed column unchallenged. A valid-looking slug is not
-- operating-company authority.
--
-- NOT VALID governs every future write without rewriting history, exactly as
-- opportunities_account_fk does in the Commercial parity migration.
--
-- The warehouse/company AGREEMENT is deliberately NOT a foreign key. A composite FK into
-- warehouses (tenant_id, id, operating_company_key) would re-derive the pair forever, so a warehouse
-- later changing company would break or silently restate every historical Reorder raised against it.
-- The company stored at creation is a fact about that moment. The creation and import boundaries
-- validate the pair ONCE; nothing re-derives it afterwards.
ALTER TABLE reorder_requests
    ADD CONSTRAINT reorder_operating_company_governed
        FOREIGN KEY (tenant_id, operating_company_key)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id) NOT VALID;

-- Every actor column is a Principal who is a member of THIS tenant. Composite keys throughout: a
-- bare principal_id reference would let one tenant's Reorder name another tenant's member.
ALTER TABLE reorder_requests
    ADD CONSTRAINT reorder_requested_by_member_fk FOREIGN KEY (tenant_id, requested_by)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id) NOT VALID,
    ADD CONSTRAINT reorder_reviewed_by_member_fk FOREIGN KEY (tenant_id, reviewed_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id) NOT VALID,
    ADD CONSTRAINT reorder_purchasing_started_by_member_fk
        FOREIGN KEY (tenant_id, purchasing_started_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id) NOT VALID,
    ADD CONSTRAINT reorder_last_purchasing_update_by_member_fk
        FOREIGN KEY (tenant_id, last_purchasing_update_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id) NOT VALID,
    ADD CONSTRAINT reorder_cancelled_by_member_fk FOREIGN KEY (tenant_id, cancelled_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id) NOT VALID,
    ADD CONSTRAINT reorder_received_by_member_fk FOREIGN KEY (tenant_id, received_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id) NOT VALID;

CREATE INDEX reorder_requests_by_provenance ON reorder_requests (tenant_id, provenance);

-- Down Migration
SET search_path = eos_ops, public;

ALTER TABLE reorder_requests
    DROP CONSTRAINT IF EXISTS reorder_native_requester_present,
    DROP CONSTRAINT IF EXISTS reorder_recommendation_status_shape,
    DROP CONSTRAINT IF EXISTS reorder_urgency_shape,
    DROP CONSTRAINT IF EXISTS reorder_quantity_source_shape,
    DROP CONSTRAINT IF EXISTS reorder_review_notes_shape,
    DROP CONSTRAINT IF EXISTS reorder_purchasing_notes_shape,
    DROP CONSTRAINT IF EXISTS reorder_cancellation_reason_shape,
    DROP CONSTRAINT IF EXISTS reorder_review_decision_known,
    DROP CONSTRAINT IF EXISTS reorder_review_decided_with_moment,
    DROP CONSTRAINT IF EXISTS reorder_cancelled_with_moment,
    DROP CONSTRAINT IF EXISTS reorder_received_with_moment,
    DROP CONSTRAINT IF EXISTS reorder_operating_company_governed,
    DROP CONSTRAINT IF EXISTS reorder_requested_by_member_fk,
    DROP CONSTRAINT IF EXISTS reorder_reviewed_by_member_fk,
    DROP CONSTRAINT IF EXISTS reorder_purchasing_started_by_member_fk,
    DROP CONSTRAINT IF EXISTS reorder_last_purchasing_update_by_member_fk,
    DROP CONSTRAINT IF EXISTS reorder_cancelled_by_member_fk,
    DROP CONSTRAINT IF EXISTS reorder_received_by_member_fk;

DROP INDEX IF EXISTS reorder_requests_by_provenance;

ALTER TABLE reorder_requests
    DROP COLUMN IF EXISTS recommendation_status,
    DROP COLUMN IF EXISTS urgency,
    DROP COLUMN IF EXISTS quantity_source,
    DROP COLUMN IF EXISTS review_decision,
    DROP COLUMN IF EXISTS review_notes,
    DROP COLUMN IF EXISTS reviewed_at,
    DROP COLUMN IF EXISTS reviewed_by_principal_id,
    DROP COLUMN IF EXISTS purchasing_started_at,
    DROP COLUMN IF EXISTS purchasing_started_by_principal_id,
    DROP COLUMN IF EXISTS purchasing_notes,
    DROP COLUMN IF EXISTS vendor_contacted,
    DROP COLUMN IF EXISTS expected_availability_date,
    DROP COLUMN IF EXISTS last_purchasing_update_at,
    DROP COLUMN IF EXISTS last_purchasing_update_by_principal_id,
    DROP COLUMN IF EXISTS cancelled_at,
    DROP COLUMN IF EXISTS cancelled_by_principal_id,
    DROP COLUMN IF EXISTS cancellation_reason,
    DROP COLUMN IF EXISTS received_at,
    DROP COLUMN IF EXISTS received_by_principal_id,
    DROP COLUMN IF EXISTS provenance;

DROP TYPE IF EXISTS ops_reorder_provenance;

-- requested_by returns to NOT NULL only if nothing relies on the truthful unknown.
ALTER TABLE reorder_requests ALTER COLUMN requested_by SET NOT NULL;
