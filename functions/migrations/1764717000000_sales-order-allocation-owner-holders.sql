-- Up Migration
-- S1c holders (Owner ruling 2026-10-20: "owner, admin, general manager, warehouse manager, service manager can allocate" + "and parts manager"). Adds `salesOrder.fulfill` to the four
-- Roles migration 1764714000000 did not grant: generalManager, warehouseManager, fieldManager (display name "Service Manager") and partsManager. admin and owner already hold it.
-- dispatcher keeps its Firebase-parity grant from 1764714000000: the ruling names who CAN allocate and revokes nothing; any revocation is a separate, explicit decision.
--
-- Explicit VALUES, no sweep. An Administration ADMIN_REVOKED decision is honoured and never re-granted; ON CONFLICT DO NOTHING; nothing is deleted.
-- Holding the key still allocates nothing on its own: the caller needs company authority over the order and a WAREHOUSE operational scope over the warehouse.

SET search_path = eos_policy, public;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_s1ch_' || substr(md5(r.tenant_id || r.id || c.id), 1, 24),
       r.tenant_id, r.id, c.id,
       'migration:1764717000000', now(), 'migration:1764717000000', now(), 'migration:1764717000000', now()
  FROM capabilities c
  JOIN (VALUES
        ('generalManager', 'salesOrder.fulfill'),
        ('warehouseManager', 'salesOrder.fulfill'),
        ('fieldManager', 'salesOrder.fulfill'),
        ('partsManager', 'salesOrder.fulfill')
       ) AS g(role_key, capability_key) ON g.capability_key = c.key
  JOIN roles r ON r.key = g.role_key AND r.protected = FALSE
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
-- Removes only the rows this migration wrote (by their granted_by stamp); refuses once an Administration decision names the capability for these Roles.
DO $$
DECLARE v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions
     WHERE capability_key = 'salesOrder.fulfill' AND role_key IN ('generalManager', 'warehouseManager', 'fieldManager', 'partsManager');
    IF v_n > 0 THEN RAISE EXCEPTION 'S1C_HOLDERS: refuses to reverse -- % Administration decision(s) name salesOrder.fulfill for these Roles', v_n; END IF;
END
$$;

SET search_path = eos_policy, public;
DELETE FROM role_capabilities WHERE granted_by = 'migration:1764717000000';
