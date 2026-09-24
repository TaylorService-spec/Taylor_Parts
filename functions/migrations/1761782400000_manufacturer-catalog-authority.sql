-- Up Migration
-- THE MANUFACTURER AUTHORITY -- reference data for the Catalog, in the domain that already owns it.
--
-- ════════════════════ WHERE IT BELONGS, AND HOW THAT WAS DECIDED ════════════════════
--
-- eos_ops, beside parts and equipment_models, because that is where Manufacturer already lives:
-- MANUFACTURERS_COLLECTION is declared in functions/src/partMaster/partMasterRepository.ts, its
-- commands are partMasterCommands.ts, and its read service authorizes with the Catalog's own
-- capability. Manufacturer is a Part Master concept; putting it anywhere else would split one
-- bounded domain across two schemas.
--
-- ════════════════════ NO OPERATING COMPANY, DELIBERATELY ════════════════════
--
-- The source record is {manufacturerId, name, status} and nothing else -- no company, no owner, no
-- branch. Manufacturer is REFERENCE data: "Taylor" is the same manufacturer whichever company sells
-- it. It is tenant-scoped like every other governed table, and adding operating-company ownership
-- because neighbouring tables have one would invent a business rule the source does not have.
--
-- ════════════════════ STATUS, NOT DELETION ════════════════════
--
-- MANUFACTURER_STATUSES is exactly ACTIVE / INACTIVE, and the write path is
-- changeManufacturerStatusCallable. A manufacturer is deactivated, never deleted -- equipment that
-- names one must not lose its reference because somebody stopped buying from them. No delete
-- capability is registered anywhere in this migration.
SET search_path = eos_ops, public;

CREATE TABLE manufacturers (
    -- SOURCE IDENTITY IS PRESERVED. The Firestore document id IS the manufacturerId (the repository
    -- comment says so: "Document identity IS domain identity ... never derived from mutable
    -- business labels"), so a copy carries ids across unchanged and dependent records keep working.
    id              TEXT        NOT NULL,
    tenant_id       TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    name            TEXT        NOT NULL,
    -- The source stores this too, and it is what a case-insensitive uniqueness rule would use. Kept
    -- because it is SOURCE DATA, not because this table enforces anything with it: the source has
    -- no uniqueness constraint on it and inventing one here could refuse a legitimate record.
    normalized_name TEXT        NOT NULL,
    status          TEXT        NOT NULL,
    provenance      TEXT        NOT NULL,
    created_by      TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT        NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT manufacturers_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT manufacturers_status_known CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT manufacturers_provenance_known CHECK (provenance IN ('NATIVE', 'MIGRATED')),
    CONSTRAINT manufacturers_name_stated CHECK (btrim(name) <> ''),
    CONSTRAINT manufacturers_normalized_name_stated CHECK (btrim(normalized_name) <> '')
);

-- The list read's order, and the lookup a Part or Equipment form needs.
CREATE INDEX manufacturers_by_name ON manufacturers (tenant_id, normalized_name);

-- ════════════════════ THE CAPABILITY: A SPLIT, NOT A NEW POWER ════════════════════
--
-- Manufacturer Read is governed TODAY by `inventory.catalog.read` -- manufacturerReadService.ts
-- names it, and the Object catalog's own capabilitiesByVerb for `manufacturer` is exactly that key.
-- But a canonical capability names ONE Object, and that key already governs `part`. So it splits,
-- exactly as finance.read split into finance.invoice.read and finance.payment.read.
--
-- The new key goes to EXACTLY the nineteen Roles that hold inventory.catalog.read today, all
-- unconditioned. Nobody gains Manufacturer access and nobody loses it.
--
-- WRITE IS NOT REGISTERED HERE, and that is a reported gap rather than an oversight:
-- createManufacturer / updateManufacturer / changeManufacturerStatus are real governed commands,
-- authorized by `inventory.catalog.manage`, which is mapped to the `part` Object. So "manage
-- manufacturers" currently projects under Part in the Object view. Splitting it is the same kind of
-- change as this one, but the measured CRED evidence for Manufacturer is READ only -- there is not
-- one can_create or can_edit row for it -- and this slice preserves what was measured.
SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_manufacturer_read', 'inventory.manufacturer.read',
     'View manufacturers in the Catalog. Split from inventory.catalog.read so the capability names one Object.',
     'manufacturer', 'read', 'READ', 'View Manufacturers');

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_m_' || substr(md5(r.tenant_id || r.id || c.id), 1, 26),
       r.tenant_id, r.id, c.id,
       'migration:1761782400000', now(), 'migration:1761782400000', now(), 'migration:1761782400000', now()
  FROM (VALUES
        ('accountingManager'), ('admin'), ('controller'), ('dispatcher'), ('fieldManager'),
        ('financeManager'), ('generalManager'), ('inventoryCatalogAdministrator'),
        ('inventoryStockRelocationOperator'), ('owner'), ('partsAssociate'), ('partsManager'),
        ('purchasingManager'), ('salesManager'), ('salesperson'), ('shopAssociate'),
        ('shopManager'), ('warehouseAssociate'), ('warehouseManager')
      ) AS g(role_key)
  JOIN roles        r ON r.key = g.role_key
  JOIN capabilities c ON c.key = 'inventory.manufacturer.read'
 ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
SET search_path = eos_policy, public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM eos_ops.manufacturers) THEN
        RAISE EXCEPTION 'migration 1761782400000 refuses to reverse: manufacturer records are recorded, and dropping the table would destroy Catalog reference data';
    END IF;
END $$;

DELETE FROM role_capabilities WHERE granted_by = 'migration:1761782400000';
DELETE FROM capabilities WHERE id = 'cap_inventory_manufacturer_read';
DROP TABLE IF EXISTS eos_ops.manufacturers;
