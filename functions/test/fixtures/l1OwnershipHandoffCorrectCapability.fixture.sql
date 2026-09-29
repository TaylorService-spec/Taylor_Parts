-- THROWAWAY TEST FIXTURE (DQ-033, lane L3). NOT a migration and never applied by node-pg-migrate.
-- Verbatim Up section of lane L1's functions/migrations/1763683200000_ownership-handoff-correction-capability.sql
-- at lane/p11-l1-commercial 329bd11a (file last changed 1b41bf12). L1 owns the real registration; this copy exists only
-- so operationalConfigurationAdministratorPostgres can prove the DQ-033 Role chain before the lanes integrate.
-- The test applies it ONLY when the capability is absent, so it stays harmless once L1's migration is in the chain.
-- OWNERSHIP HANDOFF CORRECTION -- a distinct governed capability for the administrative handoff sources
-- (Controller ruling DQ-022, 2026-09-28). Lane L1. REGISTERS ONE CAPABILITY AND GRANTS IT TO NOBODY.
--
-- ============================================================================
-- WHAT IT GOVERNS. An ownership handoff states the authority it came from (OWNERSHIP_HANDOFF_SOURCES):
--   DIRECT_HANDOFF            an ordinary handoff by whoever may edit the record -- unchanged, needs nothing more;
--   CUSTOMER_HANDOFF_REVIEW   a reassignment made by the customer-handoff review;
--   ADMIN_CORRECTION          an administrator correcting a wrong owner.
-- Until now any holder of the record's edit capability could state either of the last two, so the trail could claim
-- an administrative act nobody with that authority performed. From this migration the two administrative sources
-- require `ownership.handoff.correct` in addition to the record's own edit capability, on EVERY handoff surface:
-- the CRM Account (eosCrm/accountAuthority.ts updateAccount) and the Commercial Opportunity edit
-- (eosCommercial/commands/opportunityCommandService.ts updateOpportunity).
--
-- OBJECT. `account`: an Account is the root of the ownership chain -- every Commercial record's creation owner is
-- inherited from its Account's owner -- and the handoff vocabulary is one domain across the Account and the Commercial
-- records. Kind BUSINESS_ACTION, as every other governed business decision in this catalog.
--
-- POSTGRESQL-NATIVE. Deliberately ABSENT from the in-repo PERMISSION_CATALOG (as admin.employeeFunctionalRole.write is):
-- the in-repo admin Role composes the whole catalog, so a catalog entry would grant it to admin through the policy seed
-- and the Sample Company reconcile -- a grant by default, which DQ-022 forbids.
--
-- NO GRANT. No Role receives it here: who performs administrative ownership corrections is an Administration decision
-- (grantObjectActionToRole), never a migration default. Until it is granted, the two administrative sources are
-- refused for everyone and DIRECT_HANDOFF is unaffected.
-- ============================================================================

SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key = 'ownership.handoff.correct' OR (object_key = 'account' AND action_key = 'correctOwnershipHandoff');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'OWNERSHIP_HANDOFF_CORRECTION: ownership.handoff.correct / account.correctOwnershipHandoff is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_ownership_handoff_correct', 'ownership.handoff.correct',
     'Record an ownership handoff as an ADMINISTRATIVE act -- source ADMIN_CORRECTION or CUSTOMER_HANDOFF_REVIEW -- on an Account or a Commercial record (DQ-022). Required IN ADDITION to the record''s own edit capability; an ordinary DIRECT_HANDOFF needs no more than that. Confers no edit authority of its own, no other source, and no ownership of any record.',
     'account', 'correctOwnershipHandoff', 'BUSINESS_ACTION', 'Record Administrative Ownership Corrections')
ON CONFLICT (key) DO NOTHING;

