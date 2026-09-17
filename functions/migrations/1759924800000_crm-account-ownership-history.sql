-- Up Migration
-- CRM Account ownership history (append-only: OWNER_HANDOFF and INITIAL_OWNER_ASSIGNMENT) and the atomic Contact import
-- receipt operation. Timestamp 1759924800000; applies after 1759881600000. Depends on migration 008 (eos_crm) and 025
-- (command_receipts).
--
-- ════════════════════ WHY THIS EXISTS ════════════════════
--
-- Owner ruling recorded in migration 025's header: "legacy accountOwner.assignedBy* / assignedAt never become Account
-- columns; future owner changes go through a governed Account ownership-handoff writer (prior owner, new owner,
-- effective time, changed-by Principal, governed reason/source)". This is that writer's store. The writer is eos_crm
-- updateAccount under the EXISTING customer.record.update (whoever could edit an Account could change its owner in the
-- legacy product); no capability is registered or granted here.
--
-- Owner ruling (option b, 2026-09-16): an OWNERLESS Account (migration 008's legitimate legacy OWNERLESS state, carried by
-- the CRM cutover) receiving its FIRST owner is a DISTINCT governed ownership-history event, INITIAL_OWNER_ASSIGNMENT --
-- not a handoff. An owned Account moving to a different owner is OWNER_HANDOFF. Clearing an owner is refused by the
-- authority (a governed Account is never made ownerless) and has no event.
--
-- ════════════════════ ONE HISTORY TABLE WITH AN `event` COLUMN -- WHY ════════════════════
--
-- Both events answer the same question -- "who has owned this Account, since when, recorded by whom" -- and are read as
-- ONE ordered chain (the first handoff's predecessor IS the initial assignee). Two tables would split that chain across
-- a UNION and would need a cross-table rule for "initial assignment precedes every handoff". One table keeps the chain,
-- the append-only trigger and the tenant foreign key in one place; the `event` column plus a per-event CHECK keeps each
-- event's shape exact. The table is named for the history, not for one of its events.
--
--   OWNER_HANDOFF             previous owner NOT NULL and <> new owner; source REQUIRED from the platform handoff
--                             vocabulary (DIRECT_HANDOFF | CUSTOMER_HANDOFF_REVIEW | ADMIN_CORRECTION).
--   INITIAL_OWNER_ASSIGNMENT  previous owner IS NULL (a prior owner is never invented); source IS NULL. The handoff
--                             vocabulary names ways ownership is TRANSFERRED; none describes a first assignment, and no
--                             value is invented for it. reason stays optional for both.
--
-- At most ONE INITIAL_OWNER_ASSIGNMENT per Account (partial unique index), and it can never be recorded after any other
-- history row of that Account (BEFORE INSERT trigger): an Account that was ownerless starts its chain with it.
--
-- ════════════════════ OTHER DECISIONS ════════════════════
--
--   * `account_id` NOT NULL with the composite (tenant_id, account_id) foreign key onto accounts_tenant_scoped_identity:
--     a cross-tenant history row is unrepresentable. No list column: NO CASCADE to Contacts or customer sites
--     (docs/architecture/crm-cutover-plan.md ruling: a later Account owner change never propagates to historical children).
--   * person columns carry NO foreign key to eos_workforce.employees, exactly as eos_crm.accounts.owner_employee_id
--     carries none (migration 1759104000000's person-reference census). The authority resolves the new owner through the
--     governed Employee authority inside the transaction; the predecessor is read under FOR UPDATE, never supplied.
--   * source is a CHECK over the three values, NOT the eos_commercial.commercial_handoff_source enum: eos_commercial
--     depends on eos_crm (its account_id foreign keys, migration 1759449600000), and an eos_crm column typed by an
--     eos_commercial enum would make the dependency circular. The vocabulary is the platform's OWNERSHIP_HANDOFF_SOURCES
--     (access/auditEventWriter.ts), mirrored in eosCrm/accountAuthority.ts and pinned to the Commercial list by test.
--   * reason is stored trimmed and never blank (NULL means none), <= 500 characters, the audit writer's ceiling.
--   * `changed_by` is the performing EOS Principal id -- never an Employee, never a Firebase uid, and never the legacy
--     accountOwner.assignedBy* actor (which stays migration evidence only).
--   * `effective_at` is written by the authority as the statement time after the Account lock is held; `created_at` is
--     the transaction time.
--
-- ════════════════════ command_receipts: crm.importAccountContacts ════════════════════
--
-- The atomic CSV Contact import (legacy contactImport.js: all accepted contacts for ONE Account in one atomic batch, all
-- or none) records ONE idempotency receipt for the whole import, in the import's own transaction, exactly as the
-- governed creates do. Its target is the ACCOUNT the Contacts were imported into. Only the operation vocabulary widens.
--
-- NO grants, NO capability rows. STANDARD POSTGRESQL ONLY.

SET search_path = eos_crm, public;

CREATE TABLE account_ownership_history (
    id                         TEXT PRIMARY KEY,
    tenant_id                  TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    account_id                 TEXT        NOT NULL,
    event                      TEXT        NOT NULL,
    previous_owner_employee_id TEXT,
    new_owner_employee_id      TEXT        NOT NULL,
    source                     TEXT,
    reason                     TEXT,
    changed_by                 TEXT        NOT NULL,
    effective_at               TIMESTAMPTZ NOT NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT account_ownership_history_account_same_tenant
        FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id),
    CONSTRAINT account_ownership_history_ids_present CHECK (
        btrim(new_owner_employee_id) <> '' AND btrim(changed_by) <> ''
        AND (previous_owner_employee_id IS NULL OR btrim(previous_owner_employee_id) <> '')),
    CONSTRAINT account_ownership_history_event_vocabulary
        CHECK (event IN ('OWNER_HANDOFF', 'INITIAL_OWNER_ASSIGNMENT')),
    CONSTRAINT account_ownership_history_event_shape CHECK (
        (event = 'OWNER_HANDOFF'
            AND previous_owner_employee_id IS NOT NULL
            AND previous_owner_employee_id <> new_owner_employee_id
            AND source IS NOT NULL
            AND source IN ('DIRECT_HANDOFF', 'CUSTOMER_HANDOFF_REVIEW', 'ADMIN_CORRECTION'))
     OR (event = 'INITIAL_OWNER_ASSIGNMENT'
            AND previous_owner_employee_id IS NULL
            AND source IS NULL)),
    CONSTRAINT account_ownership_history_reason_shape CHECK (
        reason IS NULL OR (reason = btrim(reason) AND reason <> '' AND char_length(reason) <= 500))
);

CREATE INDEX account_ownership_history_by_account ON account_ownership_history (tenant_id, account_id, effective_at);

CREATE UNIQUE INDEX account_ownership_history_one_initial_assignment
    ON account_ownership_history (tenant_id, account_id) WHERE event = 'INITIAL_OWNER_ASSIGNMENT';

CREATE FUNCTION refuse_account_ownership_history_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'account_ownership_history is append-only: % on a recorded Account ownership event would destroy the ownership history', TG_OP
        USING HINT = 'A correction is a NEW handoff with source ADMIN_CORRECTION, not an edit to the old one.';
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_ownership_history_is_append_only
    BEFORE UPDATE OR DELETE ON account_ownership_history
    FOR EACH ROW EXECUTE FUNCTION refuse_account_ownership_history_mutation();

CREATE FUNCTION refuse_late_initial_owner_assignment() RETURNS trigger AS $$
BEGIN
    IF NEW.event = 'INITIAL_OWNER_ASSIGNMENT' AND EXISTS (
        SELECT 1 FROM eos_crm.account_ownership_history h
         WHERE h.tenant_id = NEW.tenant_id AND h.account_id = NEW.account_id) THEN
        RAISE EXCEPTION 'account_ownership_history_initial_assignment_first: an Account''s INITIAL_OWNER_ASSIGNMENT must precede every other ownership event'
            USING ERRCODE = '23514', CONSTRAINT = 'account_ownership_history_initial_assignment_first';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_ownership_history_initial_assignment_first
    BEFORE INSERT ON account_ownership_history
    FOR EACH ROW EXECUTE FUNCTION refuse_late_initial_owner_assignment();

ALTER TABLE command_receipts
    DROP CONSTRAINT command_receipts_operation_check,
    ADD CONSTRAINT command_receipts_operation_check
        CHECK (operation IN ('crm.createAccount', 'crm.createContact', 'crm.createAccountLocation', 'crm.importAccountContacts'));

-- Down Migration
SET search_path = eos_crm, public;

-- REFUSE WHILE HISTORY OR AN IMPORT RECEIPT EXISTS. Dropping a recorded ownership event destroys the only record of who
-- owned the Account before; dropping an import receipt lets a retry of a committed import duplicate every Contact.
DO $$
DECLARE
    recorded BIGINT;
BEGIN
    SELECT (SELECT count(*) FROM eos_crm.account_ownership_history)
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

DROP TRIGGER IF EXISTS account_ownership_history_initial_assignment_first ON account_ownership_history;
DROP FUNCTION IF EXISTS refuse_late_initial_owner_assignment();
DROP TRIGGER IF EXISTS account_ownership_history_is_append_only ON account_ownership_history;
DROP FUNCTION IF EXISTS refuse_account_ownership_history_mutation();
DROP TABLE IF EXISTS account_ownership_history;
