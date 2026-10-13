-- Up Migration
-- Grant-impact preview (PR 3, arch/grant-impact-preview.md §2.5 layer 3): the DATABASE FENCE.
--
-- The Administration preview (src/adminPolicy/authorityChangePreview.ts) runs the UNCHANGED authority commands inside
-- one transaction that is ALWAYS rolled back. Its transaction marks itself with the transaction-local setting
-- eos_policy.preview = 'on'. This constraint trigger makes a COMMIT of such a transaction IMPOSSIBLE: any row the
-- transaction wrote to a table an authority command writes queues a DEFERRED check, and that check refuses at COMMIT
-- (PREVIEW_COMMIT_REFUSED), so the whole transaction rolls back.
--
-- ZERO COST FOR EVERY OTHER WRITER. The WHEN clause is evaluated at the row write and, for a constraint trigger, a row
-- whose WHEN is false is never queued -- an ordinary transaction (the setting unset) queues nothing and fires nothing.
-- The preview's simulated per-command commit point arms ONLY the named deferrable constraints of
-- role_capability_decisions, never this fence (and never SET CONSTRAINTS ALL), so the fence fires only at a REAL commit.
--
-- No capability, no grant, no data. Adds 7 triggers and 1 function; writes nothing.
SET search_path = eos_policy, public;

CREATE FUNCTION authority_preview_never_commits() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    RAISE EXCEPTION 'PREVIEW_COMMIT_REFUSED: an Administration preview transaction may never commit (% on %)', TG_OP, TG_TABLE_NAME;
END
$fn$;

CREATE CONSTRAINT TRIGGER preview_never_commits AFTER INSERT OR UPDATE OR DELETE ON audit_events
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (coalesce(current_setting('eos_policy.preview', true), '') = 'on')
    EXECUTE FUNCTION authority_preview_never_commits();
CREATE CONSTRAINT TRIGGER preview_never_commits AFTER INSERT OR UPDATE OR DELETE ON role_capabilities
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (coalesce(current_setting('eos_policy.preview', true), '') = 'on')
    EXECUTE FUNCTION authority_preview_never_commits();
CREATE CONSTRAINT TRIGGER preview_never_commits AFTER INSERT OR UPDATE OR DELETE ON role_capability_decisions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (coalesce(current_setting('eos_policy.preview', true), '') = 'on')
    EXECUTE FUNCTION authority_preview_never_commits();
CREATE CONSTRAINT TRIGGER preview_never_commits AFTER INSERT OR UPDATE OR DELETE ON capability_grant_conditions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (coalesce(current_setting('eos_policy.preview', true), '') = 'on')
    EXECUTE FUNCTION authority_preview_never_commits();
CREATE CONSTRAINT TRIGGER preview_never_commits AFTER INSERT OR UPDATE OR DELETE ON principal_capabilities
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (coalesce(current_setting('eos_policy.preview', true), '') = 'on')
    EXECUTE FUNCTION authority_preview_never_commits();
CREATE CONSTRAINT TRIGGER preview_never_commits AFTER INSERT OR UPDATE OR DELETE ON user_role_assignments
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (coalesce(current_setting('eos_policy.preview', true), '') = 'on')
    EXECUTE FUNCTION authority_preview_never_commits();
CREATE CONSTRAINT TRIGGER preview_never_commits AFTER INSERT OR UPDATE OR DELETE ON principal_access_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (coalesce(current_setting('eos_policy.preview', true), '') = 'on')
    EXECUTE FUNCTION authority_preview_never_commits();

-- Down Migration
SET search_path = eos_policy, public;

DROP TRIGGER IF EXISTS preview_never_commits ON principal_access_versions;
DROP TRIGGER IF EXISTS preview_never_commits ON user_role_assignments;
DROP TRIGGER IF EXISTS preview_never_commits ON principal_capabilities;
DROP TRIGGER IF EXISTS preview_never_commits ON capability_grant_conditions;
DROP TRIGGER IF EXISTS preview_never_commits ON role_capability_decisions;
DROP TRIGGER IF EXISTS preview_never_commits ON role_capabilities;
DROP TRIGGER IF EXISTS preview_never_commits ON audit_events;
DROP FUNCTION IF EXISTS authority_preview_never_commits();
