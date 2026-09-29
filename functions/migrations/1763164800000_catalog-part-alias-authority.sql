-- Up Migration
-- THE POSTGRESQL PART ALIAS AUTHORITY -- the half of Part identity that never moved.
--
-- ============================================================================
-- MIGRATION 035 (CATALOG RANGE). `eos_ops.part_aliases`: the alternative identifiers a Part is
-- known by, and the historical internal part numbers it used to be known by.
-- ============================================================================
--
-- ════════════════════ MIGRATION ID RANGE, RESERVED ════════════════════
--
-- RENUMBERED: authored as 1762560000000 on the Catalog cutover lane; renumbered to 1763164800000 when the coordinated
-- Catalog + Reorder activation candidate was assembled on current main (node-pg-migrate refuses an unapplied migration
-- that precedes applied ones; main had reached 1763078400000). The original reservation note follows.
-- Catalog reserves the day-aligned range beginning **1762560000000** (day 20400). It is DISJOINT
-- from and ABOVE every other authored or reserved range in this repository:
--
--   main                   ... 1760140800000   (day 20372)
--   Reorder cutover #1961      1760227200000 - 1760659200000  (days 20373-20378)
--   Work Order lane A          1761004800000 +                (day 20382, reserved)
--   CATALOG (this lane)        1762560000000 +                (day 20400)
--
-- Eighteen days of headroom are left between Lane A's reservation and this one so neither lane has
-- to renumber the other. Migration ids are immutable once authored; merge ordering is reconciled by
-- migration-count expectations, never by renumbering.
--
-- ════════════════════ WHY THIS EXISTS, AND WHAT IT UNBLOCKS ════════════════════
--
-- `postgresPartMasterWriter.ts` refuses an internalPartNumber change with
-- INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE. That refusal is CORRECT while this table does
-- not exist: the Firestore command preserves the OLD number as an ACTIVE INTERNAL_PN alias in the
-- SAME transaction as the Part update, and changing the number without the alias would silently
-- break historical lookup -- a part number printed on a shelf label, a purchase order or a
-- technician's notes would simply stop resolving.
--
-- The point of this migration is to remove the AUTHORITY GAP, not the refusal. The refusal goes only
-- because the thing it was protecting now exists.
--
-- ════════════════════ IDENTITY IS DERIVED, NEVER GENERATED ════════════════════
--
-- `id` is the alias document id the existing authority already derives:
-- `normalization.buildAliasKey` -> `<aliasType>__<normalizedValue>` -> `partAliasRepository.encodeAliasDocId`
-- (percent-encoding `%` then `/`). MANUFACTURER_PN embeds its manufacturer scope in the normalized
-- value as `<manufacturerId>|<value>`.
--
-- A random UUID here would be a SECOND identity authority: the same identifier would resolve to one
-- row in Firestore and a different one in PostgreSQL, the migration could not tell a copy from a
-- duplicate, and "is this identifier already taken" would have no answer. The derivation is the
-- uniqueness rule, so the primary key IS the rule rather than a guard beside it.

SET search_path = eos_ops, public;

CREATE TYPE ops_part_alias_type AS ENUM (
    'INTERNAL_PN', 'MANUFACTURER_PN', 'SUPPLIER_SKU', 'UPC', 'EAN', 'GTIN',
    'LEGACY', 'CUSTOMER_REF', 'VENDOR_REF', 'BARCODE_OTHER'
);
CREATE TYPE ops_part_alias_status AS ENUM ('ACTIVE', 'INACTIVE');
-- NATIVE was written by a governed PostgreSQL command; MIGRATED was copied from Firestore and may
-- therefore carry historical actors that no longer resolve to a Principal.
CREATE TYPE ops_part_alias_provenance AS ENUM ('NATIVE', 'MIGRATED');

CREATE TABLE part_aliases (
    -- The DERIVED alias document id. See the header: this is the identity, not a surrogate.
    id                TEXT NOT NULL,
    tenant_id         TEXT NOT NULL REFERENCES eos_policy.tenants(id),

    -- DANGLING ALIASES ARE IMPOSSIBLE, and tenant-scoped by the same key. An alias that resolves to
    -- no Part is an identifier that answers a lookup with a part that does not exist.
    part_id           TEXT NOT NULL,

    alias_type        ops_part_alias_type   NOT NULL,
    -- The identifier as a person typed it, preserved verbatim. Alias administration displays this;
    -- nothing matches on it.
    original_value    TEXT NOT NULL CHECK (btrim(original_value) <> ''),
    -- The output of the ONE normalization authority. Everything matches on this.
    normalized_value  TEXT NOT NULL CHECK (btrim(normalized_value) <> ''),
    status            ops_part_alias_status NOT NULL,
    -- Free-form classification the existing record carries ("import", "manual", ...). Not a
    -- vocabulary here, because it is not one there.
    source            TEXT NOT NULL CHECK (btrim(source) <> ''),

    -- OPTIONAL, AND DELIBERATELY NOT A FOREIGN KEY. Manufacturer Master is outside this slice: the
    -- Part command shape-validates a manufacturer id and never checks that one exists, and adding a
    -- key here would import an authority this cutover has no mandate over.
    manufacturer_id   TEXT CHECK (manufacturer_id IS NULL OR manufacturer_id ~ '^[A-Za-z0-9_-]{1,64}$'),
    effective_from    DATE,
    effective_to      DATE,

    version           INTEGER     NOT NULL CHECK (version >= 1),
    provenance        ops_part_alias_provenance NOT NULL,

    created_at        TIMESTAMPTZ NOT NULL,
    -- NATIVE writes carry an EOS Principal. MIGRATED records may carry NULL, which is how an
    -- historical actor that cannot be resolved EXACTLY is recorded: see the constraint below.
    created_by        TEXT,
    updated_at        TIMESTAMPTZ NOT NULL,
    updated_by        TEXT,
    deactivated_at    TIMESTAMPTZ,
    deactivated_by    TEXT,

    CONSTRAINT part_aliases_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT part_alias_part_same_tenant FOREIGN KEY (tenant_id, part_id)
        REFERENCES parts (tenant_id, id),

    -- ONE GOVERNED ALIAS IDENTITY CANNOT RESOLVE TO TWO PARTS.
    --
    -- The primary key already gives one row per identity, so this states the rule the derivation
    -- encodes: (type, normalized value) IS the identity, and nothing may introduce a second row
    -- carrying it under a different id. Together with the key, an ACTIVE alias collision is not
    -- merely refused -- it is unrepresentable, for ACTIVE and INACTIVE alike, so a deactivated alias
    -- still holds its identifier and reactivating it cannot collide with something created meanwhile.
    CONSTRAINT part_alias_identity_unique UNIQUE (tenant_id, alias_type, normalized_value),

    -- A MANUFACTURER_PN is scoped BY its manufacturer -- the scope is embedded in the normalized
    -- value -- so the column is required there and refused everywhere else. Mirrors
    -- normalization.normalizeIdentifier, which refuses a manufacturer scope on any other type.
    CONSTRAINT part_alias_manufacturer_scope CHECK (
        (alias_type = 'MANUFACTURER_PN') = (manufacturer_id IS NOT NULL)
    ),
    CONSTRAINT part_alias_effective_order CHECK (
        effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from
    ),
    -- DEACTIVATION IS A FACT WITH A MOMENT AND AN ACTOR, or it is not recorded at all. An INACTIVE
    -- alias that cannot say when it was deactivated is a lifecycle with a hole in it.
    CONSTRAINT part_alias_deactivation_complete CHECK (
        (status = 'INACTIVE') = (deactivated_at IS NOT NULL)
    ),
    -- A NATIVE record has no excuse for an unresolved actor: it was written by a governed command
    -- that had a Principal in hand. Only MIGRATED may be truthful about an unknown.
    CONSTRAINT part_alias_native_actors_present CHECK (
        provenance <> 'NATIVE'
        OR (created_by IS NOT NULL AND btrim(created_by) <> ''
            AND updated_by IS NOT NULL AND btrim(updated_by) <> ''
            AND (status = 'ACTIVE' OR deactivated_by IS NOT NULL))
    ),
    CONSTRAINT part_alias_actor_shape CHECK (
        (created_by IS NULL OR btrim(created_by) <> '')
        AND (updated_by IS NULL OR btrim(updated_by) <> '')
        AND (deactivated_by IS NULL OR btrim(deactivated_by) <> '')
    )
);

-- The lookup this table exists to answer: an identifier, scanned or typed, to a Part.
CREATE INDEX part_aliases_by_normalized ON part_aliases (tenant_id, normalized_value);
-- Alias administration for one Part.
CREATE INDEX part_aliases_by_part ON part_aliases (tenant_id, part_id);

-- ════════════════════ DELETE IS NOT THE LIFECYCLE ════════════════════
--
-- Deactivate and reactivate are governed facts with actors and moments; DELETE is neither. An alias
-- removed outright takes with it the answer to "what did this identifier used to mean", which is the
-- entire reason historical internal part numbers are preserved. Refused structurally rather than by
-- convention, because a convention is exactly what a cleanup script does not read.
CREATE FUNCTION refuse_part_alias_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'eos_ops.part_aliases rows are deactivated, never deleted: identifier %s would stop resolving with no record of why',
        OLD.id
        USING ERRCODE = 'restrict_violation',
              HINT = 'Deactivate the alias. A deleted alias silently breaks historical lookup for every label, purchase order and note that still carries the identifier.';
END
$$;

CREATE TRIGGER part_aliases_are_never_deleted
    BEFORE DELETE ON part_aliases
    FOR EACH ROW EXECUTE FUNCTION refuse_part_alias_delete();

COMMENT ON TABLE part_aliases IS
    'Alternative and historical identifiers for a Part. id is DERIVED by normalization.buildAliasKey + partAliasRepository.encodeAliasDocId -- never generated -- so the primary key IS the uniqueness rule. Deactivated, never deleted.';

-- Down Migration
SET search_path = eos_ops, public;

DROP TRIGGER IF EXISTS part_aliases_are_never_deleted ON part_aliases;
DROP FUNCTION IF EXISTS refuse_part_alias_delete();

-- Reversing this DISCARDS identifier history. A Part whose internal part number changed while this
-- authority existed has its previous number recorded ONLY here, so dropping the table would make
-- that number stop resolving with nothing left to say it ever did.
DO $$
DECLARE
    historical BIGINT;
BEGIN
    SELECT count(*) INTO historical FROM eos_ops.part_aliases WHERE alias_type = 'INTERNAL_PN';
    IF historical > 0 THEN
        RAISE EXCEPTION
            'the catalog alias migration cannot be reversed: % INTERNAL_PN aliases preserve internal part numbers that exist nowhere else',
            historical
            USING HINT = 'These are the historical part numbers labels and purchase orders still carry. Resolve them first.';
    END IF;
END
$$;

DROP TABLE IF EXISTS part_aliases;
DROP TYPE IF EXISTS ops_part_alias_provenance;
DROP TYPE IF EXISTS ops_part_alias_status;
DROP TYPE IF EXISTS ops_part_alias_type;
