-- Up Migration
-- SUP-1 (DECISIONS #230): Part Supplier Terms record + COMMERCIAL keys. No grant. See eosOps/partSupplierTerms.ts.
SET search_path = eos_policy, public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM capabilities WHERE object_key = 'supplierCatalogItem') THEN
        RAISE EXCEPTION 'SUP1_SUPPLIER_TERMS: supplierCatalogItem already has capabilities';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_supplier_terms_read', 'inventory.supplierTerms.read', 'List supplier terms (relationship, ordering).',
     'supplierCatalogItem', 'readTerms', 'READ', 'Read supplier terms'),
    ('cap_inventory_supplier_terms_create', 'inventory.supplierTerms.create', 'Add supplier terms (with cost.create).',
     'supplierCatalogItem', 'createTerms', 'CREATE', 'Add supplier terms'),
    ('cap_inventory_supplier_terms_edit', 'inventory.supplierTerms.edit', 'Edit relationship and ordering terms; set preferred.',
     'supplierCatalogItem', 'editTerms', 'EDIT', 'Edit supplier terms'),
    ('cap_inventory_supplier_terms_change_status', 'inventory.supplierTerms.changeStatus', 'Activate or deactivate supplier terms.',
     'supplierCatalogItem', 'changeStatus', 'BUSINESS_ACTION', 'Activate / deactivate supplier terms'),
    ('cap_inventory_catalog_cost_read', 'inventory.catalog.cost.read', 'See cost, currency, contract window (with catalog.read).',
     'supplierCatalogItem', 'readCost', 'READ', 'Read supplier cost & contract terms'),
    ('cap_inventory_catalog_cost_create', 'inventory.catalog.cost.create', 'Set cost, currency, contract window on new terms.',
     'supplierCatalogItem', 'createCost', 'CREATE', 'Set supplier cost & contract terms on new terms'),
    ('cap_inventory_catalog_cost_edit', 'inventory.catalog.cost.edit', 'Change cost, currency, contract window.',
     'supplierCatalogItem', 'editCost', 'EDIT', 'Change supplier cost & contract terms');

-- Down Migration
SET search_path = eos_policy, public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM role_capabilities rc JOIN capabilities c ON c.id = rc.capability_id WHERE c.object_key = 'supplierCatalogItem')
       OR EXISTS (SELECT 1 FROM principal_capabilities pc JOIN capabilities c ON c.id = pc.capability_id WHERE c.object_key = 'supplierCatalogItem') THEN
        RAISE EXCEPTION 'SUP1_SUPPLIER_TERMS: refuses to reverse -- a grant names a capability this migration registered';
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM role_capability_decisions
                   WHERE capability_key LIKE 'inventory.catalog.cost.%' OR capability_key LIKE 'inventory.supplierTerms.%') THEN
            RAISE EXCEPTION 'SUP1_SUPPLIER_TERMS: refuses to reverse -- an Administration decision names a capability this migration registered';
        END IF;
    END IF;
END
$$;

DELETE FROM capabilities WHERE id IN ('cap_inventory_supplier_terms_read', 'cap_inventory_supplier_terms_create', 'cap_inventory_supplier_terms_edit',
    'cap_inventory_supplier_terms_change_status', 'cap_inventory_catalog_cost_read', 'cap_inventory_catalog_cost_create', 'cap_inventory_catalog_cost_edit');
