-- Up Migration
-- CRM Account ownership handoffs (append-only history) and the atomic Contact import receipt operation.
-- Timestamp 1759924800000; applies after 1759881600000. Depends on migration 008 (eos_crm) and 025 (command_receipts).
--
-- ════════════════════ WHY THIS EXISTS ════════════════════
--
-- Owner ruling recorded in migration 025's header: "legacy accountOwner.assignedBy* / assignedAt never become Account
-- columns; future owner changes go through a governed Account ownership-handoff writer (prior owner, new owner,
-- effective time, changed-by Principal, governed reason/source)". Until now that writer did not exist and an Account
-- owner change was ACCOUNT_OWNER_HANDOFF_PENDING. This is its store. The writer is eos_crm updateAccount under the
-- EXISTING customer.record.update (whoever could edit an Account could change its owner in the legacy product); no
-- capability is registered or granted here.
--
-- PARITY WITH COMMERCIAL, NOT A NEW MODEL. The shape is eos_commercial.ownership_handoffs (migration 1758844800000):
-- one row per transfer, previous + new owner, closed source vocabulary, reason <= 500, the recording Principal, an
-- effective time, and a trigger that refuses UPDATE and DELETE. A transfer is this INSERT plus the owner column UPDATE
-- in ONE transaction; the history is the evidence, the column is "who owns it now".
--
-- ════════════════════ DELIBERATE DIFFERENCES FROM THE COMMERCIAL TABLE ════════════════════
--
--   * ONE record family, so `account_id` is NOT NULL with the composite (tenant_id, account_id) foreign key onto
--     accounts_tenant_scoped_identity: a cross-tenant handoff row is unrepresentable. No "exactly one record" CHECK is
--     needed -- the table names Accounts only, and there is no list column: NO CASCADE to Contacts or customer sites
--     (docs/architecture/crm-cutover-plan.md ruling: a later Account handoff never propagates to historical children).
--   * previous_owner_employee_id is NOT NULL. Governed Accounts are never ownerless (createAccount refuses one), so a
--     governed handoff always has a predecessor. A LEGACY ownerless row (migration 008's OWNERLESS state) getting its
--     first owner is an initial ASSIGNMENT, not a handoff, and is not recorded here: the authority refuses it until an
--     Owner ruling says how it is governed.
--   * person columns carry NO foreign key to eos_workforce.employees, exactly as eos_crm.accounts.owner_employee_id
--     carries none (migration 1759104000000's person-reference census). The authority resolves the new owner through
--     the governed Employee authority inside the transaction; the predecessor is read under FOR UPDATE, never supplied.
--   * source is a CHECK over the same three values, NOT the eos_commercial.commercial_handoff_source enum. eos_commercial
--     depends on eos_crm (its account_id foreign keys, migration 1759449600000); an eos_crm column typed by an
--     eos_commercial enum would make the dependency circular and tie dropping Commercial to CRM history. The vocabulary
--     is the platform's OWNERSHIP_HANDOFF_SOURCES (access/auditEventWriter.ts), mirrored in eosCrm/accountAuthority.ts
--     and pinned to the Commercial list by test.
--   * the reason is stored trimmed and never blank (NULL means none), <= 500 characters, the audit writer's ceiling.
--   * attribution is `handed_off_by` (the acting EOS Principal id), never an Employee and never a Firebase uid.
--
-- ════════════════════ command_receipts: crm.importAccountContacts ════════════════════
--
-- The atomic CSV Contact import (legacy contactImport.js: all accepted contacts for ONE Account in one atomic batch, all
-- or none) records ONE idempotency receipt for the whole import, in the import's own transaction, exactly as the
-- governed creates do. Its target is the ACCOUNT the Contacts were imported into. Only the operation vocabulary widens.
--
-- NO grants, NO capability rows. STANDARD POSTGRESQL ONLY.

SET search_path = eos_crm, public;

CREATE TABLE account_ownership_handoffs (
    id                         TEXT PRIMARY KEY,
    tenant_id                  TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    account_id                 TEXT        NOT NULL,
    previous_owner_employee_id TEXT        NOT NULL,
    new_owner_employee_id      TEXT        NOT NULL,
    source                     TEXT        NOT NULL,
    reason                     TEXT,
    handed_off_by              TEXT        NOT NULL,
    effective_at               TIMESTAMPTZ NOT NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT account_ownership_handoffs_account_same_tenant
        FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id),
    CONSTRAINT account_ownership_handoffs_owner_ids_present CHECK (
        btrim(previous_owner_employee_id) <> '' AND btrim(new_owner_employee_id) <> '' AND btrim(handed_off_by) <> ''),
    CONSTRAINT account_ownership_handoffs_is_not_a_no_op CHECK (previous_owner_employee_id <> new_owner_employee_id),
    CONSTRAINT account_ownership_handoffs_source_vocabulary
        CHECK (source IN ('DIRECT_HANDOFF', 'CUSTOMER_HANDOFF_REVIEW', 'ADMIN_CORRECTION')),
    CONSTRAINT account_ownership_handoffs_reason_shape CHECK (
        reason IS NULL OR (reason = btrim(reason) AND reason <> '' AND char_length(reason) <= 500))
);

CREATE INDEX account_ownership_handoffs_by_account ON account_ownership_handoffs (tenant_id, account_id, effective_at);

CREATE FUNCTION refuse_account_ownership_history_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'account_ownership_handoffs is append-only: % on a recorded Account handoff would destroy the ownership history', TG_OP
        USING HINT = 'A correction is a NEW handoff with source ADMIN_CORRECTION, not an edit to the old one.';
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_ownership_handoffs_are_append_only
    BEFORE UPDATE OR DELETE ON account_ownership_handoffs
    FOR EACH ROW EXECUTE FUNCTION refuse_account_ownership_history_mutation();

ALTER TABLE command_receipts
    DROP CONSTRAINT command_receipts_operation_check,
    ADD CONSTRAINT command_receipts_operation_check
        CHECK (operation IN ('crm.createAccount', 'crm.createContact', 'crm.createAccountLocation', 'crm.importAccountContacts'));

-- Down Migration
SET search_path = eos_crm, public;

-- REFUSE WHILE HISTORY OR AN IMPORT RECEIPT EXISTS. Dropping a recorded handoff destroys the only record of who owned
-- the Account before; dropping an import receipt lets a retry of a committed import duplicate every Contact.
DO $$
DECLARE
    recorded BIGINT;
BEGIN
    SELECT (SELECT count(*) FROM eos_crm.account_ownership_handoffs)
         + (SELECT count(*) FROM eos_crm.command_receipts WHERE operation = 'crm.importAccountContacts')
      INTO recorded;
    IF recorded > 0 THEN
        RAISE EXCEPTION 'migration 1759924800000 refuses to drop CRM Account ownership history or Contact import receipts: % rows are recorded', recorded
            USING HINT = 'Historical ownership remains. Export these rows deliberately first, or do not reverse this migration.';
    END IF;
END
$$;

ALTER TABLE command_receipts
    DROP CONSTRAINT command_receipts_operation_check,
    ADD CONSTRAINT command_receipts_operation_check
        CHECK (operation IN ('crm.createAccount', 'crm.createContact', 'crm.createAccountLocation'));

DROP TRIGGER IF EXISTS account_ownership_handoffs_are_append_only ON account_ownership_handoffs;
DROP FUNCTION IF EXISTS refuse_account_ownership_history_mutation();
DROP TABLE IF EXISTS account_ownership_handoffs;
