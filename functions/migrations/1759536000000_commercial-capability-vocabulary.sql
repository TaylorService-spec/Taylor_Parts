-- Up Migration
-- EOS Commercial -- capability VOCABULARY for the governed PostgreSQL Commercial transport (wave C4).
--
-- ============================================================================
-- MIGRATION 023. CATALOG ONLY, exactly like migration 006: a capability row is a DEFINITION, not a grant.
--
-- The nine keys are the EXACT strings the C2 command layer (functions/src/eosCommercial/commands/
-- commercialCommandKernel.ts COMMERCIAL_CAPABILITIES) and the C3 read layer (functions/src/eosCommercial/reads/
-- commercialReadKernel.ts COMMERCIAL_READ_CAPABILITIES) already require, and that functions/src/access/
-- permissionCatalog.ts already registers active:false. Nothing is invented and nothing is renamed.
--
-- This migration grants NOTHING: no role_capabilities row, no Role, no assignment, no Security Role or Job Role
-- change. After it runs the Commercial transport exists and every ordinary principal still holds no Commercial
-- authority; a grant is a separate, governed act. Registering vocabulary is not activation.
--
-- Deliberately NOT registered: salesOrder.fulfill and salesOrder.service (D2 execution stays deferred).
-- ============================================================================

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_opportunity_write',
     'opportunity.write',
     'Create, edit or advance a Sales Opportunity through the governed PostgreSQL Commercial commands. Pre-commitment only.'),
    ('cap_opportunity_read',
     'opportunity.read',
     'Read governed PostgreSQL Opportunity projections (detail, list, Account-scoped).'),
    ('cap_opportunity_createSalesOrder',
     'opportunity.createSalesOrder',
     'Create the committed Sales Order from a WON Opportunity through the governed PostgreSQL Commercial commands.'),
    ('cap_salesAgreement_create',
     'salesAgreement.create',
     'Draft a Sales Agreement for an Opportunity through the governed PostgreSQL Commercial commands.'),
    ('cap_salesAgreement_updateDraft',
     'salesAgreement.updateDraft',
     'Edit a DRAFT Sales Agreement through the governed PostgreSQL Commercial commands.'),
    ('cap_salesAgreement_accept',
     'salesAgreement.accept',
     'Accept a DRAFT Sales Agreement, binding its committed prices, through the governed PostgreSQL Commercial commands.'),
    ('cap_salesAgreement_read',
     'salesAgreement.read',
     'Read governed PostgreSQL Sales Agreement projections (detail, list, Account-scoped).'),
    ('cap_salesOrder_write',
     'salesOrder.write',
     'Create or advance a committed Sales Order through the governed PostgreSQL Commercial commands. No execution authority.'),
    ('cap_salesOrder_read',
     'salesOrder.read',
     'Read governed PostgreSQL Sales Order projections (detail, list, Account-scoped). No execution facts.');

-- Down Migration
SET search_path = eos_policy, public;

-- A grant is an authorization fact. The rollback REFUSES while any Role holds one of these capabilities rather than
-- deleting the grant or cascading through it; the grant has to be withdrawn deliberately first.
DO $$
DECLARE
    held BIGINT;
BEGIN
    SELECT count(*) INTO held
      FROM eos_policy.role_capabilities rc
     WHERE rc.capability_id IN (
        'cap_opportunity_write', 'cap_opportunity_read', 'cap_opportunity_createSalesOrder',
        'cap_salesAgreement_create', 'cap_salesAgreement_updateDraft', 'cap_salesAgreement_accept', 'cap_salesAgreement_read',
        'cap_salesOrder_write', 'cap_salesOrder_read');
    IF held > 0 THEN
        RAISE EXCEPTION
            'migration 023 refuses to remove the Commercial capability vocabulary: % Role grant(s) still reference it; withdraw them through governed configuration first',
            held;
    END IF;
END $$;

DELETE FROM capabilities WHERE id IN (
    'cap_opportunity_write', 'cap_opportunity_read', 'cap_opportunity_createSalesOrder',
    'cap_salesAgreement_create', 'cap_salesAgreement_updateDraft', 'cap_salesAgreement_accept', 'cap_salesAgreement_read',
    'cap_salesOrder_write', 'cap_salesOrder_read'
);
