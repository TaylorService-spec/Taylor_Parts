-- Up Migration
-- DIRECT EXCEPTION CELL LOCK (lane DX, 2026-09-26). Local test databases only until the Owner promotes it.
--
-- Since lane DX a direct Principal grant (eos_policy.principal_capabilities) is enforced on every runtime gate, and
-- it may carry a PRINCIPAL-scoped condition in eos_policy.capability_grant_conditions. The retire/delete trigger
-- (capability_grant_conditions_never_widen, 1762646400000) takes grant_cell_lock(tenant, 'PRINCIPAL', principal,
-- capability) and refuses to lift an ACTIVE condition while the direct grant is held. Its `count(*)` cannot see an
-- UNCOMMITTED insert, so without a matching lock on the grant side a raw INSERT racing a retire could commit a held
-- direct grant with a RETIRED condition -- unconditioned access. This is the Pass 8 D3 race, already closed for
-- Role grants by role_capabilities_honour_decisions; this closes it for direct grants.
--
-- EVERY INSERT, and every UPDATE that re-identifies or refreshes a row (an expired exception refreshed by
-- grantObjectActionToPrincipal), takes the SAME advisory lock the retire trigger takes. It changes no row, adds no
-- capability, no grant, no table and no column.
--
-- SNAPSHOTS (Pass 10 P10-2). A lock only orders writers; the retire trigger's count is sound only on a fresh READ
-- COMMITTED snapshot, which is why capability_grant_conditions_never_widen refuses any other isolation level. This
-- trigger decides nothing from a read after the lock (it counts nothing), so it has no snapshot dependency of its own.

SET search_path = eos_policy, public;

CREATE FUNCTION principal_capabilities_cell_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
DECLARE
    v_cap TEXT;
BEGIN
    SELECT key INTO v_cap FROM eos_policy.capabilities WHERE id = NEW.capability_id;
    IF v_cap IS NULL THEN RETURN NEW; END IF; -- the FK refuses it
    PERFORM grant_cell_lock(NEW.tenant_id, 'PRINCIPAL', NEW.principal_id, v_cap);
    IF TG_OP = 'UPDATE' AND (OLD.tenant_id <> NEW.tenant_id OR OLD.principal_id <> NEW.principal_id
        OR OLD.capability_id <> NEW.capability_id) THEN
        RAISE EXCEPTION 'principal_capabilities: a direct exception''s cell is its identity and never changes';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER principal_capabilities_cell_lock
    BEFORE INSERT OR UPDATE ON principal_capabilities
    FOR EACH ROW EXECUTE FUNCTION principal_capabilities_cell_lock();

-- Down Migration
SET search_path = eos_policy, public;
DROP TRIGGER IF EXISTS principal_capabilities_cell_lock ON principal_capabilities;
DROP FUNCTION IF EXISTS principal_capabilities_cell_lock();
