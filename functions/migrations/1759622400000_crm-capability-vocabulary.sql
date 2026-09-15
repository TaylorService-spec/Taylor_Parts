-- Up Migration
-- MIGRATION 024 -- the CRM capability VOCABULARY in eos_policy (wave D1-A, CRM PostgreSQL business authority).
--
-- WHAT. Registers the four EXISTING catalogued Customer capability ids -- `customer.record.read`,
-- `customer.record.create`, `customer.record.update` and `customer.governedField.write`
-- (functions/src/access/permissionCatalog.ts) -- as rows of
-- `eos_policy.capabilities`, so a tenant's Role CAN be granted them through `role_capabilities` and
-- `resolveOperationalContext` can then compute them for the governed PostgreSQL CRM layer (functions/src/eosCrm/**).
-- Until this runs, those ids exist only in the Firebase-era catalog and are ungrantable in PostgreSQL.
--
-- WHAT NOT.
--   * No new capability id. Every key below is already published in the permission catalog.
--   * No GRANT. No `role_capabilities` row is written: who holds them is governed configuration, not a migration.
--   * No Contact / customer-site capability: Owner ruling (V1) -- Contacts and customer sites are governed by the same
--     three `customer.record.*` verbs as their Account. None is invented.
--   * `customer.governedField.write` stays DISTINCT: it governs the Account's paymentTerms / taxStatus, exactly as
--     firestore.rules' accountGovernedFields* functions do today.
--   * No dependency on migration 023 (Commercial vocabulary). The two sets of keys are disjoint.
--
-- STANDARD POSTGRESQL ONLY.

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_customer_record_read',
     'customer.record.read',
     'Read governed PostgreSQL CRM Accounts, and the Contacts and customer sites reached through them.'),
    ('cap_customer_record_create',
     'customer.record.create',
     'Create a governed PostgreSQL CRM Account, or a Contact or customer site under an Account of the same tenant.'),
    ('cap_customer_record_update',
     'customer.record.update',
     'Edit the allowlisted business fields of a governed PostgreSQL CRM Account, Contact or customer site.'),
    ('cap_customer_governedField_write',
     'customer.governedField.write',
     'Set or change a governed PostgreSQL CRM Account''s payment terms or tax status beyond the ungoverned baseline.');

-- Down Migration

SET search_path = eos_policy, public;

-- REFUSE, NEVER DESTROY A GRANT. Removing vocabulary a Role still holds would silently strip authority.
DO $$
DECLARE
    held BIGINT;
BEGIN
    SELECT count(*) INTO held
      FROM eos_policy.role_capabilities rc
     WHERE rc.capability_id IN ('cap_customer_record_read', 'cap_customer_record_create', 'cap_customer_record_update', 'cap_customer_governedField_write');
    IF held > 0 THEN
        RAISE EXCEPTION
            'migration 024 refuses to remove the CRM capability vocabulary: % Role grant(s) still reference it; withdraw them through governed configuration first',
            held;
    END IF;
END $$;

DELETE FROM capabilities WHERE id IN ('cap_customer_record_read', 'cap_customer_record_create', 'cap_customer_record_update', 'cap_customer_governedField_write');
