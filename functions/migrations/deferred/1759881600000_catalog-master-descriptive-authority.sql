-- Up Migration
--
-- ████████████████████████████████████████████████████████████████████████████████████████████████
-- ██  NOT APPLIED. THIS FILE IS NOT IN THE MIGRATION SET AND MUST NOT BE MOVED INTO IT YET.      ██
-- ████████████████████████████████████████████████████████████████████████████████████████████████
--
-- It lives in `functions/migrations/deferred/`, which neither node-pg-migrate nor
-- functions/test/support/migrationSchema.mjs reads (see the header of
-- deferred/1759190400000_employee-principal-link-employee-fk.sql for the measured reason). Moving it up one
-- directory is the deliberate act that applies it.
--
-- PRECONDITION: migration 025 (1759708800000_catalog-part-identity-reference-authority.sql, PR #1911) is in the
-- applied set. This migration EXTENDS 025's `eos_ops.parts` identity table; it does not restate it. On a tree
-- without 025 it fails on its first ALTER, which is exactly the refusal wanted.
--
-- ============================================================================
-- MIGRATION 027. Catalog cutover lane. The Part Master DESCRIPTIVE authority and the catalog write capability
-- vocabulary, the two things the PostgreSQL catalog writers (functions/src/catalogMaster/) need that no migration
-- provides yet.
--
-- ════════════════════ WHY ALTER 025'S TABLE, NOT A SECOND TABLE ════════════════════
--
-- 025's header: "NO LIFECYCLE / STATUS COLUMN ... it arrives with the Part Master descriptive move, additively."
-- This is that move. A second `part_master_records` table keyed by the same (tenant_id, id) would be a second
-- row per Part stating one identity twice -- the shape every eos_ops migration refuses. One Part, one row.
--
-- ════════════════════ WHAT EACH COLUMN IS (repository truth) ════════════════════
--
-- The columns are exactly the fields functions/src/partMaster/partMasterRepository.ts#partToFirestore writes,
-- validated by partMaster/validation.ts#validatePart. Nothing else on a Firestore `parts` document is master
-- data: `sku` (== partId), `unitOfMeasure` / `partTrackingMode` (legacy projections of stockingUnit /
-- controlType), `cert*` / `dataProvenance` / `certificationWorld` (Certification fixture metadata) are NOT
-- columns and are not copied. docs/architecture/catalog-cutover-plan.md §1.3 carries the inventory.
--
--   flags {expiryTracked, consumable, returnableCore}   three NOT NULL booleans, not JSON (A-class).
--   primaryManufacturerId                               opaque key: `manufacturers` is still Firestore-only and the
--                                                        Firestore command never checked its existence either.
--   wholeUnit absent                                    FALSE (validatePart's default).
--   equipmentModelId                                    a REAL tenant-scoped foreign key to eos_ops.equipment_models
--                                                        (migration 008) -- assertEquipmentModelExists, structurally.
--
-- Versions and timestamps are repository authority, carried verbatim by the one-time copy.
--
-- ════════════════════ WHAT IS DELIBERATELY NOT HERE ════════════════════
--
--   * NO UNIQUE on internal_part_number. Firestore never enforced it (dataImport's PART_NUMBER_AMBIGUOUS refusal
--     exists because duplicates are possible); the INTERNAL_PN alias authority (`part_aliases`) is what owns that
--     uniqueness, and it has not moved.
--   * NO manufacturers table, NO aliases table, NO supplier items. Other authorities, other moves.
--   * NO grant. The capability rows below are DEFINITIONS (migration 023's rule); no role_capabilities row.
--
-- STANDARD POSTGRESQL ONLY. Additive.
-- ============================================================================

SET search_path = eos_ops, public;

-- Pre-flight: NOT NULL columns cannot be added honestly to rows that have no value for them. 025 creates the
-- table empty and nothing writes it, so this only fires if something did.
DO $$
DECLARE
    occupied BIGINT;
BEGIN
    SELECT count(*) INTO occupied FROM eos_ops.parts;
    IF occupied > 0 THEN
        RAISE EXCEPTION 'migration 027 refuses to add Part Master descriptive columns: eos_ops.parts already holds % identities with no descriptive record', occupied
            USING HINT = 'No descriptive value is invented. Populate identities only through the catalog cutover copy, after this migration.';
    END IF;
END
$$;

-- partMaster/types.ts, verbatim and in order.
CREATE TYPE ops_part_status         AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED', 'DISCONTINUED');
CREATE TYPE ops_part_control_type   AS ENUM ('STANDARD', 'SERIALIZED', 'LOT', 'SERIALIZED_LOT');
CREATE TYPE ops_part_stocking_class AS ENUM ('STOCKED', 'NON_STOCK', 'SERVICE', 'KIT');
CREATE TYPE ops_part_oem_status     AS ENUM ('OEM', 'AFTERMARKET', 'UNKNOWN');
CREATE TYPE ops_part_unit           AS ENUM ('EACH', 'KIT', 'BOTTLE', 'TUBE', 'BOX', 'CASE', 'FOOT', 'ROLL', 'GALLON', 'OUNCE', 'POUND');

ALTER TABLE parts
    ADD COLUMN internal_part_number             TEXT                    NOT NULL,
    ADD COLUMN name                             TEXT                    NOT NULL,
    ADD COLUMN description                      TEXT,
    ADD COLUMN category                         TEXT,
    ADD COLUMN status                           ops_part_status         NOT NULL,
    ADD COLUMN stocking_unit                    ops_part_unit           NOT NULL,
    ADD COLUMN control_type                     ops_part_control_type   NOT NULL,
    ADD COLUMN stocking_class                   ops_part_stocking_class NOT NULL,
    ADD COLUMN expiry_tracked                   BOOLEAN                 NOT NULL,
    ADD COLUMN consumable                       BOOLEAN                 NOT NULL,
    ADD COLUMN returnable_core                  BOOLEAN                 NOT NULL,
    ADD COLUMN primary_manufacturer_id          TEXT,
    ADD COLUMN primary_manufacturer_part_number TEXT,
    ADD COLUMN oem_status                       ops_part_oem_status,
    ADD COLUMN whole_unit                       BOOLEAN                 NOT NULL,
    ADD COLUMN equipment_model_id               TEXT,
    ADD COLUMN version                          INTEGER                 NOT NULL,
    ADD COLUMN updated_by                       TEXT                    NOT NULL,
    ADD COLUMN updated_at                       TIMESTAMPTZ             NOT NULL DEFAULT now(),
    ADD CONSTRAINT part_name_present CHECK (name = btrim(name) AND name <> '' AND char_length(name) <= 200),
    ADD CONSTRAINT part_internal_part_number_present CHECK (internal_part_number <> ''),
    ADD CONSTRAINT part_manufacturer_id_shape CHECK (primary_manufacturer_id IS NULL OR primary_manufacturer_id ~ '^[A-Za-z0-9_-]{1,64}$'),
    ADD CONSTRAINT part_mpn_requires_manufacturer CHECK (primary_manufacturer_part_number IS NULL OR primary_manufacturer_id IS NOT NULL),
    -- validatePart's combination rules, structurally.
    ADD CONSTRAINT part_expiry_requires_lot CHECK (NOT expiry_tracked OR control_type IN ('LOT', 'SERIALIZED_LOT')),
    ADD CONSTRAINT part_service_is_standard CHECK (stocking_class <> 'SERVICE' OR control_type = 'STANDARD'),
    ADD CONSTRAINT part_stocked_only_flags CHECK (stocking_class = 'STOCKED' OR NOT (consumable OR returnable_core)),
    ADD CONSTRAINT part_model_requires_whole_unit CHECK (equipment_model_id IS NULL OR whole_unit),
    ADD CONSTRAINT part_whole_unit_serialized CHECK (NOT whole_unit OR (control_type IN ('SERIALIZED', 'SERIALIZED_LOT') AND stocking_class <> 'SERVICE')),
    ADD CONSTRAINT part_version_positive CHECK (version >= 1),
    ADD CONSTRAINT part_updated_by_present CHECK (updated_by <> ''),
    ADD CONSTRAINT part_equipment_model_same_tenant FOREIGN KEY (tenant_id, equipment_model_id)
        REFERENCES equipment_models (tenant_id, id);

CREATE INDEX parts_by_equipment_model ON parts (tenant_id, equipment_model_id) WHERE equipment_model_id IS NOT NULL;
CREATE INDEX parts_by_internal_part_number ON parts (tenant_id, internal_part_number);

-- The catalog write capability VOCABULARY: the exact ids functions/src/access/permissionCatalog.ts registers and
-- the Firestore commands check (partMasterCommands.ts CAP_CATALOG_MANAGE / CAP_CATALOG_ACTIVATE,
-- equipmentCompatibility/commands.ts COMMAND_CAPABILITIES.importEquipmentModel). Definitions, not grants.
SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_inventory_catalog_manage',
     'inventory.catalog.manage',
     'Create and edit canonical Part descriptive records through the governed PostgreSQL catalog writers.'),
    ('cap_inventory_catalog_activate',
     'inventory.catalog.activate',
     'Change Part lifecycle status through the governed PostgreSQL catalog writers.'),
    ('cap_equipment_model_manage',
     'equipment.model.manage',
     'Create and edit canonical Equipment Model records through the governed PostgreSQL catalog writers.');

-- Down Migration
SET search_path = eos_ops, public;

-- Refuse, never destroy (migrations 008 / 025): dropping these columns deletes Part Master records that exist
-- nowhere else in this schema, and deleting a capability a Role holds deletes an authorization fact.
DO $$
DECLARE
    occupied BIGINT;
    held BIGINT;
BEGIN
    SELECT count(*) INTO occupied FROM eos_ops.parts;
    IF occupied > 0 THEN
        RAISE EXCEPTION 'migration 027 cannot be reversed: eos_ops.parts holds % Part Master records', occupied
            USING HINT = 'A schema rollback will not delete catalog records. Resolve these records first.';
    END IF;
    SELECT count(*) INTO held FROM eos_policy.role_capabilities
     WHERE capability_id IN ('cap_inventory_catalog_manage', 'cap_inventory_catalog_activate', 'cap_equipment_model_manage');
    IF held > 0 THEN
        RAISE EXCEPTION 'migration 027 cannot be reversed: % Role grants hold a catalog write capability', held
            USING HINT = 'Withdraw the grants deliberately first.';
    END IF;
END
$$;

DELETE FROM eos_policy.capabilities
 WHERE id IN ('cap_inventory_catalog_manage', 'cap_inventory_catalog_activate', 'cap_equipment_model_manage');

DROP INDEX IF EXISTS parts_by_internal_part_number;
DROP INDEX IF EXISTS parts_by_equipment_model;
ALTER TABLE parts
    DROP CONSTRAINT part_equipment_model_same_tenant,
    DROP COLUMN internal_part_number, DROP COLUMN name, DROP COLUMN description, DROP COLUMN category,
    DROP COLUMN status, DROP COLUMN stocking_unit, DROP COLUMN control_type, DROP COLUMN stocking_class,
    DROP COLUMN expiry_tracked, DROP COLUMN consumable, DROP COLUMN returnable_core,
    DROP COLUMN primary_manufacturer_id, DROP COLUMN primary_manufacturer_part_number, DROP COLUMN oem_status,
    DROP COLUMN whole_unit, DROP COLUMN equipment_model_id, DROP COLUMN version, DROP COLUMN updated_by,
    DROP COLUMN updated_at;
DROP TYPE ops_part_unit;
DROP TYPE ops_part_oem_status;
DROP TYPE ops_part_stocking_class;
DROP TYPE ops_part_control_type;
DROP TYPE ops_part_status;
