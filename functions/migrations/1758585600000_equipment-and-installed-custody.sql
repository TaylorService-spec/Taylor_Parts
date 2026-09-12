-- Up Migration
-- EOS Operational Data Plane — customer Equipment, the Equipment Model catalog, and the INSTALLED
-- serialized custody relationship made referential.
--
-- ============================================================================
-- MIGRATION 008. Migration 007 already ruled that EQUIPMENT is a CUSTODY location type and not a
-- physical one, and expressed the install rule structurally:
--
--     CHECK ((status = 'INSTALLED') = (location_type = 'EQUIPMENT'))
--
-- What it could not express is the other half of that sentence. `serialized_custody.location_id`
-- is an OPAQUE string, so an EQUIPMENT custody row could name an Equipment record that does not
-- exist, or one belonging to another tenant, and nothing would notice. The reason it was opaque is
-- the same reason migration 005 refused a `locations` table: the referent lived in Firestore and a
-- Postgres copy of it would have been a second, unmaintained authority.
--
-- THAT REASON DOES NOT APPLY TO EQUIPMENT, AND THIS MIGRATION IS WHERE THAT STOPS BEING TRUE.
-- Equipment is not inventory reference data owned elsewhere; it is the record installation MINTS
-- (functions/src/equipmentInstall/installSerializedAssetCommand.ts creates it in the same
-- transaction that links the unit). Bringing it into `eos_ops` makes the one custody location type
-- whose referent this schema owns into a REAL relationship, while WAREHOUSE / BIN / MOBILE stay
-- opaque exactly as migration 005 left them, because their reference data is still Firestore's.
--
-- STANDARD POSTGRESQL ONLY, same as 001-007. Additive: no earlier migration is edited.
-- ============================================================================
--
-- ════════════════════ EQUIPMENT IS STILL NOT A PHYSICAL LOCATION ════════════════════
--
-- `ops_location_type` is NOT touched. No ALTER TYPE, no ADD VALUE, no new physical label. Migration
-- 007's header gives the reason and it is unchanged: a movement row pointing at an Equipment id
-- would enter a customer-owned machine into a balance that sums company stock. This migration only
-- gives the CUSTODY vocabulary's EQUIPMENT label a referent it can be checked against.
--
-- ════════════════════ THE HAZARD THIS MIGRATION IS SHAPED AROUND ════════════════════
--
-- `equipment.locationId` IS NOT AN INVENTORY LOCATION ID. The P1B census measured it
-- (docs/architecture/inventory-reference-authority-p1b-census.md §12.7): 290 of 290 `equipment`
-- documents resolve 100% into the CRM `locations` collection — customer sites — and 0% into any
-- inventory registry, while `serialized_assets.currentLocationId` and
-- `cycle_counts.location.locationId` resolve 100% the other way. ONE FIELD NAME, TWO DISJOINT
-- NAMESPACES, NO TYPE DISCRIMINATOR ON EITHER SIDE. The census states the consequence plainly: "a
-- migration that unions `locationId`-named fields merges 290 customer sites into the inventory
-- location namespace."
--
-- So this schema does not have a column called `location_id` on `equipment`. It has
-- `customer_location_id`, and the name is the discriminator the source data does not carry. The
-- separation is structural, not conventional:
--
--   * the column is NOT typed `ops_location_type` or `ops_custody_location_type`, so it cannot be
--     stored, compared or joined as an inventory location without an explicit cast a reviewer sees;
--   * `equipment` carries NO `location_type` column at all, because a customer site has no physical
--     inventory type and inventing one (WAREHOUSE, say) would be the exact merge the census warns of;
--   * the only columns on this table that DO hold an inventory location are named
--     `installed_from_location_type` / `installed_from_location_id`, they are typed with the
--     PHYSICAL enum, and they are about where the unit CAME FROM, never where the Equipment is.
--
-- ════════════════════ WHY THE INSTALL ORIGIN IS TYPED, AND NEVER DEFAULTED ════════════════════
--
-- The install command preserves the origin (`installedFromLocationId` = the asset's
-- `currentLocationId`) deliberately: installation does not move the unit's physical pointer. But in
-- Firestore that origin is an untyped scalar — the census measured `serialized_assets` at 0/35 rows
-- carrying a type — and the live readers guess: `functions/src/inventoryAnalyticsCallables.ts:91-95`
-- says outright that `currentLocationId` is a typeless scalar and then assumes WAREHOUSE.
--
-- Here the origin is READ OFF THE CUSTODY ROW, whose `location_type` is a real enum column, so the
-- type is known rather than assumed. The pair is nullable (an imported machine has no company
-- origin) but never HALF known:
--
--     CHECK ((installed_from_location_type IS NULL) = (installed_from_location_id IS NULL))
--
-- There is no `DEFAULT 'WAREHOUSE'` anywhere in this migration, and there must never be one.
--
-- ════════════════════ WHY THE LINK IS A GENERATED COLUMN AND NOT A SECOND FIELD ════════════════════
--
-- `serialized_custody.equipment_id` is GENERATED ALWAYS AS a projection of `location_id`, not a
-- column a writer sets. A plain second column would be a second place the same fact is stated, which
-- is the only way the two could ever disagree — the objection migration 007 raised against copying
-- the company key onto every cycle count line. Generated, there is exactly one writable fact
-- (`location_id`), and the foreign key is enforced against a view of it that is true by construction.
--
-- The key is COMPOSITE — (tenant_id, equipment_id) — so a custody row can never be installed into
-- another tenant's Equipment. With MATCH SIMPLE semantics a row whose `equipment_id` is NULL (every
-- WAREHOUSE / BIN / MOBILE row) is exempt, which is precisely the intent: the reference applies to
-- EQUIPMENT custody and to nothing else.
--
-- ════════════════════ ONE EQUIPMENT RECORD, AT MOST ONE INSTALLED UNIT ════════════════════
--
-- ADR-010 §3 states it: "An Equipment record links to exactly one Serialized Asset." The Firestore
-- command enforces only the other direction — installSerializedAssetCommand.ts refuses a second
-- install by checking the ASSET's `currentEquipmentId`. Nothing, anywhere, stopped two units from
-- naming one Equipment record. `serialized_custody_one_unit_per_equipment` is that missing half.
--
-- ════════════════════ WHY THERE IS NO DATA MIGRATION, AGAIN ════════════════════
--
-- Same as 005 and 007: nothing deployed writes these tables, no client is cut over, and no live
-- record is imported here. The pre-flight below COUNTS the EQUIPMENT custody rows before adding the
-- reference and RAISES with the count rather than letting an opaque foreign-key violation stand in
-- for an explanation. What a later import must resolve is recorded in
-- docs/handoff/w1-c7-registrations.md, not guessed at here.

SET search_path = eos_ops, public;

-- ============================ pre-flight: refuse, never manufacture ============================
--
-- Runs BEFORE the reference exists. An EQUIPMENT custody row already in the table names an Equipment
-- id that no `equipment` row can possibly have yet, and the honest failure is one that says so.

DO $$
DECLARE
    installed BIGINT;
BEGIN
    SELECT count(*) INTO installed FROM eos_ops.serialized_custody WHERE location_type = 'EQUIPMENT';
    IF installed > 0 THEN
        RAISE EXCEPTION
            'migration 008 refuses to add the Equipment reference: % serialized custody rows are already in EQUIPMENT custody and name Equipment records this schema does not hold',
            installed
            USING HINT = 'Import the Equipment records these rows point at first. No placeholder Equipment will be invented to satisfy the foreign key.';
    END IF;
END
$$;

-- ============================ the Equipment Model catalog ============================
--
-- The (B) collection of field-ops-app-vite/src/metadata/definitions/equipment.js's header — the
-- manufacturer/model CATALOG entry a Part's compatibility points at — NOT the installed register.
-- The two share a word and nothing else, and this schema keeps them in two tables for that reason.

CREATE TYPE ops_equipment_model_status AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'RETIRED');

CREATE TABLE equipment_models (
    -- THE CANONICAL ID IS THE ROW'S IDENTITY, not a surrogate beside it:
    -- `{manufacturerId}--{modelNumber}` exactly as buildEquipmentModelId /
    -- isCanonicalEquipmentModelId mint it
    -- (functions/src/equipmentCompatibility/domain/equipmentModel.ts, mirrored in
    -- field-ops-app-vite/src/domain/equipmentModel.js). The Firestore adapter already treats the
    -- document id AS the identity (`modelFromFirestore` throws if the two disagree), and a surrogate
    -- key here would create a second answer to "which model is this".
    id                TEXT NOT NULL,
    -- The composite primary key is deliberate. A canonical model id is unique WITHIN a tenant's
    -- catalog; it is not a global identifier, and making it the sole primary key would forbid two
    -- tenants from cataloguing the same manufacturer's model.
    tenant_id         TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    manufacturer_id   TEXT NOT NULL,
    manufacturer_name TEXT NOT NULL,
    model_number      TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    family            TEXT,
    subtype           TEXT,
    revision          TEXT,
    status            ops_equipment_model_status NOT NULL,
    source_authority  TEXT NOT NULL,
    version           INTEGER NOT NULL,
    created_by        TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        TEXT        NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT equipment_models_pkey PRIMARY KEY (tenant_id, id),
    -- THE SHAPE OF THE IDENTITY, NOT ITS DERIVATION. buildEquipmentModelId's output alphabet is
    -- [A-Z0-9] with single hyphens between runs, joined by exactly one '--' (neither half can
    -- contain '--', because each folds runs of non-alphanumerics to ONE hyphen). That is checkable
    -- here and true of every canonical id.
    CONSTRAINT equipment_model_id_canonical_shape CHECK (
        id ~ '^[A-Z0-9]+(-[A-Z0-9]+)*--[A-Z0-9]+(-[A-Z0-9]+)*$'
    ),
    CONSTRAINT equipment_model_manufacturer_canonical_shape CHECK (
        manufacturer_id ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
    ),
    -- The manufacturer half of the id IS the manufacturer_id column -- the one half of the
    -- derivation that survives normalization unchanged, so the two can be held in agreement.
    CONSTRAINT equipment_model_id_agrees_with_manufacturer CHECK (
        split_part(id, '--', 1) = manufacturer_id
    ),
    -- THE MODEL HALF IS DELIBERATELY NOT RE-DERIVED HERE. `normalizeModelNumber` applies Unicode
    -- NFKC before uppercasing, and NFKC is not expressible in standard PostgreSQL. A near-miss
    -- restatement (upper() + regexp_replace) agrees with the domain authority on ASCII and diverges
    -- on exactly the inputs normalization exists for -- it would REFUSE records the domain considers
    -- canonical, which is worse than not checking. `model_number` is therefore asserted only to be
    -- present and untrimmed-of-nothing; the derivation stays where it is already tested.
    CONSTRAINT equipment_model_number_present CHECK (
        model_number <> '' AND model_number = btrim(model_number)
    ),
    CONSTRAINT equipment_model_display_name_present CHECK (display_name <> ''),
    CONSTRAINT equipment_model_source_authority_present CHECK (source_authority <> ''),
    -- validateEquipmentModel rejects `version_invalid` below 1; the same floor, structurally.
    CONSTRAINT equipment_model_version_positive CHECK (version >= 1)
);

-- The read the catalog is actually scanned by: a manufacturer's models, ordered by model number --
-- the search definitions/equipmentModel.js declares (modelNumber filterable/sortable).
CREATE INDEX equipment_models_by_manufacturer
    ON equipment_models (tenant_id, manufacturer_id, model_number);

-- ============================ the installed Equipment register ============================
--
-- ADR-006 §2.1: a first-class record, one owning Account, exactly one Account Location, and a
-- governed ACTIVE / INACTIVE / RETIRED lifecycle.

CREATE TYPE ops_equipment_status AS ENUM ('ACTIVE', 'INACTIVE', 'RETIRED');

CREATE TABLE equipment (
    -- The Firestore document id, carried across unchanged: `eq_<sha256 of the idempotency key>`
    -- for an installation (equipmentDocIdFor) or a generated id for an imported machine. Globally
    -- unique already, so unlike the model catalog this table keeps the house `id TEXT PRIMARY KEY`.
    id                           TEXT PRIMARY KEY,
    tenant_id                    TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- MANDATORY, NO DEFAULT, NEVER INFERRED -- migration 007's rule, and the reason it exists
    -- applies here with more force than anywhere else: EQUIPMENT_BUSINESS_LINE_NOT_RECORDED
    -- (definitions/equipment.js) records that an installed unit names no line of business today, and
    -- that deriving it from the owning Account is "confidently wrong for exactly the customers it
    -- matters most for", because an account can hold equipment from both operating companies.
    operating_company_key        TEXT NOT NULL,
    account_id                   TEXT NOT NULL,
    -- A CRM CUSTOMER SITE ID -- the `locations` collection. NOT an inventory location, NOT in the
    -- `ops_location_type` / `ops_custody_location_type` namespace, and deliberately not named
    -- `location_id`. See this migration's header for the measured reason.
    customer_location_id         TEXT NOT NULL,
    -- THE CANONICAL MODEL RELATIONSHIP, and the only model reference on this table. Nullable,
    -- because the live register does not have it: `equipment` stores `manufacturer` and `model` as
    -- free strings (EQUIPMENT_WRITABLE_KEYS in equipmentImportCommand.ts) and neither is resolved
    -- against the catalog by anything. Those two strings are import INPUT -- resolved through
    -- equipment_model_aliases -- not a second model authority, so they are not carried here as
    -- columns: an unresolved model is NULL, which is honest, rather than two spellings of a fact.
    equipment_model_id           TEXT,
    name                         TEXT NOT NULL,
    status                       ops_equipment_status NOT NULL,
    -- Optional and NOT unique, matching the register as it actually is. definitions/equipment.js is
    -- explicit that serial_number and asset_tag "look like a business reference but are NOT": both
    -- optional, neither enforced unique by Rules or by normalizeEquipmentInput. Only the bulk import
    -- path enforces uniqueness, and only within its own transaction. A UNIQUE constraint here would
    -- assert an invariant the source data has never been held to.
    serial_number                TEXT,
    asset_tag                    TEXT,
    -- Real DATEs. Firestore stores these as 'YYYY-MM-DD' strings (plain calendar dates, never
    -- Timestamps -- definitions/equipment.js), which is a date that has been spelled as text.
    installed_on                 DATE,
    warranty_expires_on          DATE,
    notes                        TEXT,
    -- WHERE THE UNIT CAME FROM. Typed with the PHYSICAL enum, because an origin is always physical:
    -- migration 007's biconditional makes a pre-install custody row WAREHOUSE / BIN / MOBILE by
    -- construction, so EQUIPMENT is structurally unrepresentable here.
    installed_from_location_type ops_location_type,
    installed_from_location_id   TEXT,
    -- Provenance, in full. X-EQUIPMENT-PROVENANCE-GAP (definitions/equipment.js) records that the
    -- Firestore collection has NO createdBy/updatedBy at all -- equipmentWritableKeys() lists
    -- neither -- and stores its timestamps as epoch numbers. Both actors are NOT NULL here: this is
    -- the write-path change that gap says the remediation actually is, and a writer that cannot name
    -- an actor is refused rather than recorded as nobody.
    created_by                   TEXT        NOT NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                   TEXT        NOT NULL,
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Exists so the serialized custody reference below can be TENANT-SCOPED. Redundant in content
    -- with the primary key, load-bearing as a foreign-key target.
    CONSTRAINT equipment_tenant_identity UNIQUE (tenant_id, id),
    CONSTRAINT equipment_model_same_tenant FOREIGN KEY (tenant_id, equipment_model_id)
        REFERENCES equipment_models (tenant_id, id),
    CONSTRAINT equipment_name_present CHECK (name <> ''),
    CONSTRAINT equipment_account_present CHECK (account_id <> ''),
    CONSTRAINT equipment_customer_location_present CHECK (customer_location_id <> ''),
    CONSTRAINT equipment_operating_company_present CHECK (operating_company_key <> ''),
    -- HALF AN ORIGIN IS NOT AN ORIGIN. Both or neither -- never an id whose type a reader has to
    -- guess, which is the defect this pair exists to stop repeating.
    CONSTRAINT equipment_install_origin_typed CHECK (
        (installed_from_location_type IS NULL) = (installed_from_location_id IS NULL)
    )
);

-- The three composites definitions/equipment.js measured as live in the Firestore estate --
-- (accountId, name), (status, name), (accountId, status, name) -- preserved as the two Postgres
-- indexes that serve all three, since a leading-column prefix of the first covers (accountId, ...).
CREATE INDEX equipment_by_account ON equipment (tenant_id, account_id, status, name);
CREATE INDEX equipment_by_status  ON equipment (tenant_id, status, name);
-- The relationship the CRM side asks for: every machine at one customer site.
CREATE INDEX equipment_by_customer_location ON equipment (tenant_id, customer_location_id);
CREATE INDEX equipment_by_model ON equipment (tenant_id, equipment_model_id)
    WHERE equipment_model_id IS NOT NULL;

-- ============================ the installed serialized custody relationship ============================
--
-- Migration 007 said INSTALLED means EQUIPMENT. This says WHICH Equipment, and proves it exists.

ALTER TABLE serialized_custody
    ADD COLUMN equipment_id TEXT
        GENERATED ALWAYS AS (CASE WHEN location_type = 'EQUIPMENT' THEN location_id END) STORED;

ALTER TABLE serialized_custody
    ADD CONSTRAINT serialized_custody_equipment_exists
        FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment (tenant_id, id);

-- ADR-010 §3's "exactly one Serialized Asset", enforced from the side nothing was watching.
CREATE UNIQUE INDEX serialized_custody_one_unit_per_equipment
    ON serialized_custody (tenant_id, equipment_id)
    WHERE equipment_id IS NOT NULL;

-- Down Migration
SET search_path = eos_ops, public;

-- Reversing this DROPS customer Equipment records and the model catalog. There is nowhere else in
-- this schema for either to go, so -- the same way 007 refuses to invent a physical location for an
-- installed unit -- this refuses rather than deleting business records as a side effect of a schema
-- rollback.

DO $$
DECLARE
    occupied TEXT;
BEGIN
    SELECT string_agg(t.table_name || ' (' || t.row_count || ' rows)', ', ' ORDER BY t.table_name)
      INTO occupied
      FROM (
          SELECT 'equipment'        AS table_name, count(*) AS row_count FROM eos_ops.equipment
          UNION ALL
          SELECT 'equipment_models',               count(*)              FROM eos_ops.equipment_models
      ) t
     WHERE t.row_count > 0;

    IF occupied IS NOT NULL THEN
        RAISE EXCEPTION
            'migration 008 cannot be reversed: % hold records that exist nowhere else in this schema',
            occupied
            USING HINT = 'A schema rollback will not delete customer Equipment or the model catalog. Resolve these records first.';
    END IF;
END
$$;

DROP INDEX IF EXISTS serialized_custody_one_unit_per_equipment;
ALTER TABLE serialized_custody DROP CONSTRAINT IF EXISTS serialized_custody_equipment_exists;
ALTER TABLE serialized_custody DROP COLUMN IF EXISTS equipment_id;

DROP TABLE equipment;
DROP TYPE ops_equipment_status;
DROP TABLE equipment_models;
DROP TYPE ops_equipment_model_status;
