-- Up Migration
-- SUP-1 GOVERNED FIELD GROUPS (Owner field-permission directive 2026-10-11; DECISIONS #210; r1 Owner ruling 2026-08-07).
-- Registers the COMMERCIAL field group keys of supplierCatalogItem (cost, currency, contract window). REGISTER != GRANT:
-- PostgreSQL-native keys (not in PERMISSION_CATALOG), no grant of any kind. Rationale: eosOps/partSupplierTerms.ts header.
-- Kept short on purpose: node-pg-migrate echoes every applied file, and fixtures capture that echo in a 1 MiB buffer.
SET search_path = eos_policy, public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM capabilities WHERE key LIKE 'inventory.catalog.cost.%'
               OR (object_key = 'supplierCatalogItem' AND action_key IN ('readCost', 'createCost', 'editCost'))) THEN
        RAISE EXCEPTION 'SUP1_COMMERCIAL_FIELD_GROUP: a capability this migration registers already exists';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_catalog_cost_read', 'inventory.catalog.cost.read',
     'See Part Supplier Terms cost, currency and contract window. Requires inventory.catalog.read too (r1). Granted only through Administration.',
     'supplierCatalogItem', 'readCost', 'READ', 'Read supplier cost & contract terms'),
    ('cap_inventory_catalog_cost_create', 'inventory.catalog.cost.create',
     'Set cost, currency and contract window on new Part Supplier Terms (required to create terms). Granted only through Administration.',
     'supplierCatalogItem', 'createCost', 'CREATE', 'Set supplier cost & contract terms on new terms'),
    ('cap_inventory_catalog_cost_edit', 'inventory.catalog.cost.edit',
     'Change cost, currency and contract window of existing Part Supplier Terms. Granted only through Administration.',
     'supplierCatalogItem', 'editCost', 'EDIT', 'Change supplier cost & contract terms');

-- Down Migration
SET search_path = eos_policy, public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM role_capabilities WHERE capability_id LIKE 'cap_inventory_catalog_cost_%')
       OR EXISTS (SELECT 1 FROM principal_capabilities WHERE capability_id LIKE 'cap_inventory_catalog_cost_%') THEN
        RAISE EXCEPTION 'SUP1_COMMERCIAL_FIELD_GROUP: refuses to reverse -- a grant names a capability this migration registered';
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM role_capability_decisions WHERE capability_key LIKE 'inventory.catalog.cost.%') THEN
            RAISE EXCEPTION 'SUP1_COMMERCIAL_FIELD_GROUP: refuses to reverse -- an Administration decision names a capability this migration registered';
        END IF;
    END IF;
END
$$;

DELETE FROM capabilities WHERE id IN ('cap_inventory_catalog_cost_read', 'cap_inventory_catalog_cost_create', 'cap_inventory_catalog_cost_edit');
