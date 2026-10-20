-- Up Migration
-- S1c: SALES ORDER ALLOCATION -- registers the allocation authority `salesOrder.fulfill` and grants it by EXACT Firebase parity (Owner register 2026-10-20,
-- S1a OD-12 "Confirm exact Firebase parity": admin, dispatcher, owner). DECISIONS #S1c.
--
-- ============================================================================
-- WHAT THIS DOES (and nothing else)
--   1. REGISTERS ONE capability, `salesOrder.fulfill` (BUSINESS_ACTION). Migration 1759536000000 left it unregistered ("D2 execution stays deferred");
--      the Owner rebuilt allocation in EOS (S-1, 2026-10-19) and S1b/S1c delivered the hard-reservation ledger and the command, so it is registered now.
--   2. GRANTS it to THREE Roles, explicit VALUES, no sweep:
--        admin      the protected Administrator Role (also holds the whole catalog by derivation; the explicit row is the baseline's record)
--        dispatcher Firebase SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS
--        owner      Firebase OWNER_COMMERCIAL_AUTHORITY
--      The protected Roles (admin, owner) are matched ONLY as the protected rows; an Administration ADMIN_REVOKED decision is honoured and never
--      re-granted; ON CONFLICT DO NOTHING; nothing is deleted, no role is modified.
--
-- NOT HERE: `salesOrder.service` / create-service (the OD-10 hand-over is a later lane); any grant to salesManager, salesperson, generalManager,
-- officeManager, partsManager, warehouseManager or fieldManager (not Firebase holders; any extension is a separate Owner ruling).
--
-- The capability authorizes the COMMAND only. Reaching a warehouse still needs the caller's WAREHOUSE operational scope, and reaching an order still
-- needs company authority (functions/src/eosOps/salesOrderAllocation.ts): holding salesOrder.fulfill alone allocates nothing.
--
-- Firebase registered the key active:false (sandbox-activated, production off). This grant is live in whichever environment the migration runs; the
-- reservation ledger itself is inert until the operator inserts the company's stock_reservation_activation row (S1b), so production allocation
-- stays refused RESERVATION_NOT_ACTIVATED until that separate operator step and Owner gate.
-- ============================================================================

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_salesOrder_fulfill', 'salesOrder.fulfill',
     'Allocate stock to a Sales Order line (a hard reservation of the line''s quantity at a warehouse the caller states, in the order''s operating company) and release it. The caller still needs company authority over the order and their WAREHOUSE operational scope over the warehouse; confers no Sales Order edit, no service creation and no stock movement.',
     'salesOrder', 'allocate', 'BUSINESS_ACTION', 'Allocate Stock to Sales Order')
ON CONFLICT (key) DO NOTHING;

-- 3 grants (Firebase parity, S1a OD-12).
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_s1c_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764714000000', now(), 'migration:1764714000000', now(), 'migration:1764714000000', now()
  FROM capabilities c
  JOIN (VALUES
        ('admin', 'salesOrder.fulfill'),
        ('dispatcher', 'salesOrder.fulfill'),
        ('owner', 'salesOrder.fulfill')
       ) AS g(role_key, capability_key) ON g.capability_key = c.key
  JOIN roles r ON r.key = g.role_key AND (r.key NOT IN ('owner', 'admin') OR r.protected = TRUE)
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
-- Refuses once an Administration decision or a direct grant names the capability, or any Sales Order allocation exists: a down migration never silently
-- discards a decision or leaves a reservation with no authority that created it.
DO $$
DECLARE v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.inventory_commitments WHERE sales_order_id IS NOT NULL;
    IF v_n > 0 THEN RAISE EXCEPTION 'S1C_SALES_ORDER_ALLOCATION: refuses to reverse -- % Sales Order commitment row(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key = 'salesOrder.fulfill';
    IF v_n > 0 THEN RAISE EXCEPTION 'S1C_SALES_ORDER_ALLOCATION: refuses to reverse -- % Administration decision(s) name salesOrder.fulfill', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key = 'salesOrder.fulfill';
    IF v_n > 0 THEN RAISE EXCEPTION 'S1C_SALES_ORDER_ALLOCATION: refuses to reverse -- % direct grant(s) hold salesOrder.fulfill', v_n; END IF;
END
$$;

SET search_path = eos_policy, public;
DELETE FROM role_capabilities rc USING capabilities c WHERE c.id = rc.capability_id AND c.key = 'salesOrder.fulfill';
DELETE FROM capabilities WHERE key = 'salesOrder.fulfill';
