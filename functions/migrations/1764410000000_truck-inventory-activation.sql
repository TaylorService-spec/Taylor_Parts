-- Up Migration
-- TRUCK INVENTORY ACTIVATION (Controller TRUCK INVENTORY ACTIVATION AUTHORIZED, 2026-10-01: OD-T1 .. OD-T7).
--
-- 1. OD-T1: an Employee's relationship to a truck IS an Employee Operational Scope of type MOBILE, over the truck's MOBILE
--    inventory location (eos_ops.mobile_locations). The EXISTING effective-dated scope rows, writer, history and audit are
--    reused -- no second assignment table, no Firebase assignedDriverEmployeeId. Several Employees may hold MOBILE scope over
--    one truck; an Employee may change trucks; a scope change affects FUTURE authority only (ledger, custody, transactions,
--    audit and Work Orders are never rewritten). Truck/vehicle, MOBILE location, warehouse binding and Employee scope stay
--    four distinct records.
--
-- 2. OD-T6: inventory.catalog.alias.read -- the resolve-only right (scanned or typed identifier -> Part) the Catalog scan read
--    has always required, never registered in PostgreSQL until now, so no Role could hold it. Registered and granted to
--    NOBODY here; its holders are the inventoryLookupReader composition, applied through Administration.
--
-- 3. OD-T7: inventory.truckRegistry.manage -- ordinary truck / MOBILE-location registry administration (create, link, relink,
--    unlink, status) on the Administration control plane. PostgreSQL-native (absent from PERMISSION_CATALOG, so no catalog
--    reconcile default-grants it). Granted to NOBODY; the ruled holder is the Operational Configuration Administrator Role.
--    The Dispatcher reads truck information operationally and is NOT a registry administrator.
--
-- 4. OD-T5: purchase-order / Reorder receipt INTO A MOBILE LOCATION IS REFUSED. Purchased stock arrives at a WAREHOUSE or
--    BIN and reaches a truck only through a governed Transfer. The commands refuse it; this CHECK closes the generic receipt
--    writer (purchasingRepository.insertReceivingOrder) so no future caller can reopen it. Refuses to apply if a MOBILE
--    receipt already exists (it would be evidence to classify, not to rewrite).

SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key IN ('inventory.catalog.alias.read', 'inventory.truckRegistry.manage')
        OR (object_key = 'part' AND action_key = 'resolveAlias') OR (object_key = 'mobileLocation' AND action_key = 'manageRegistry');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'TRUCK_INVENTORY_ACTIVATION: a capability this migration registers already exists';
    END IF;
END
$$;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.receiving_orders WHERE receiving_location_type = 'MOBILE';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'TRUCK_INVENTORY_ACTIVATION: % receiving order(s) already name a MOBILE destination; classify them first', v_n;
    END IF;
END
$$;

ALTER TABLE eos_ops.receiving_orders
    ADD CONSTRAINT receiving_destination_not_mobile CHECK (receiving_location_type <> 'MOBILE');

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_catalog_alias_read', 'inventory.catalog.alias.read',
     'Resolve a scanned or typed identifier (Part number, alias, barcode, UPC, supplier SKU, MPN) to the Part it names. Resolve-only: does not list a Part''s identifiers (inventory.catalog.manage) and does not by itself read the Part record (inventory.catalog.read). Granted only through Administration.',
     'part', 'resolveAlias', 'READ', 'Resolve Part Identifier'),
    ('cap_inventory_truckRegistry_manage', 'inventory.truckRegistry.manage',
     'Administer the truck and MOBILE inventory location registry: create a MOBILE location, create a truck, link / relink / unlink a truck to its MOBILE location, change truck status. Confers no inventory movement, no warehouse binding (inventory.location.scopeBinding.manage) and no Employee scope (admin.employeeOperationalScope.write). Granted only through Administration.',
     'mobileLocation', 'manageRegistry', 'ADMIN_ACTION', 'Manage Truck Registry')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE eos_workforce.employee_operational_scopes
    DROP CONSTRAINT operational_scope_type_known;
ALTER TABLE eos_workforce.employee_operational_scopes
    ADD CONSTRAINT operational_scope_type_known
    CHECK (scope_type IN ('WAREHOUSE', 'REORDER_QUEUE', 'MOBILE'));

CREATE OR REPLACE FUNCTION eos_workforce.operational_scope_target_exists() RETURNS trigger AS $$
BEGIN
    IF NEW.scope_type = 'WAREHOUSE' THEN
        PERFORM 1 FROM eos_ops.warehouses w
          WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.scope_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'operational_scope_target_exists: warehouse % does not exist in this tenant', NEW.scope_id;
        END IF;
    ELSIF NEW.scope_type = 'REORDER_QUEUE' THEN
        PERFORM 1 FROM eos_policy.tenant_operating_company_keys k
          WHERE k.tenant_id = NEW.tenant_id AND k.operating_company_key = NEW.scope_id
            AND k.status = 'ACTIVE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'operational_scope_target_exists: operating company key % is not ACTIVE in this tenant', NEW.scope_id;
        END IF;
    ELSIF NEW.scope_type = 'MOBILE' THEN
        -- OD-T1: the scope names a governed MOBILE inventory location of this tenant (never a truck id, never a vehicle).
        PERFORM 1 FROM eos_ops.mobile_locations m
          WHERE m.tenant_id = NEW.tenant_id AND m.location_type = 'MOBILE' AND m.location_id = NEW.scope_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'operational_scope_target_exists: MOBILE location % does not exist in this tenant', NEW.scope_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_workforce.employee_operational_scopes WHERE scope_type = 'MOBILE';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'TRUCK_INVENTORY_ACTIVATION: refuses to reverse -- % MOBILE operational scope row(s) are Employee history', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM role_capabilities WHERE capability_id IN ('cap_inventory_catalog_alias_read', 'cap_inventory_truckRegistry_manage');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'TRUCK_INVENTORY_ACTIVATION: refuses to reverse -- % Role grant(s) name a capability this migration registered', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities WHERE capability_id IN ('cap_inventory_catalog_alias_read', 'cap_inventory_truckRegistry_manage');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'TRUCK_INVENTORY_ACTIVATION: refuses to reverse -- % direct grant(s) name a capability this migration registered', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions WHERE capability_key IN ('inventory.catalog.alias.read', 'inventory.truckRegistry.manage');
        IF v_n > 0 THEN
            RAISE EXCEPTION 'TRUCK_INVENTORY_ACTIVATION: refuses to reverse -- % Administration decision(s) name a capability this migration registered', v_n;
        END IF;
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION eos_workforce.operational_scope_target_exists() RETURNS trigger AS $$
BEGIN
    IF NEW.scope_type = 'WAREHOUSE' THEN
        PERFORM 1 FROM eos_ops.warehouses w
          WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.scope_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'operational_scope_target_exists: warehouse % does not exist in this tenant', NEW.scope_id;
        END IF;
    ELSIF NEW.scope_type = 'REORDER_QUEUE' THEN
        PERFORM 1 FROM eos_policy.tenant_operating_company_keys k
          WHERE k.tenant_id = NEW.tenant_id AND k.operating_company_key = NEW.scope_id
            AND k.status = 'ACTIVE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'operational_scope_target_exists: operating company key % is not ACTIVE in this tenant', NEW.scope_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE eos_workforce.employee_operational_scopes
    DROP CONSTRAINT operational_scope_type_known;
ALTER TABLE eos_workforce.employee_operational_scopes
    ADD CONSTRAINT operational_scope_type_known
    CHECK (scope_type IN ('WAREHOUSE', 'REORDER_QUEUE'));

ALTER TABLE eos_ops.receiving_orders DROP CONSTRAINT receiving_destination_not_mobile;

DELETE FROM eos_policy.capabilities WHERE id IN ('cap_inventory_catalog_alias_read', 'cap_inventory_truckRegistry_manage');
