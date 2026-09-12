-- Up Migration
-- EOS Operational Data Plane — operating-company inventory authority + serialized custody of
-- installed units.
--
-- ============================================================================
-- MIGRATION 007. Owner ruling (P1B, "operating company is mandatory inventory authority"): every
-- eos_ops record that asserts WHERE stock is, or WHOSE custody it sits in, must also say WHICH
-- OPERATING COMPANY's inventory authority it belongs to. It is carried here as
-- `operating_company_key TEXT NOT NULL` -- tenant-scoped, OPAQUE authority data. The EOS authority
-- layer decides which keys are valid; Postgres stores the governed key and nothing more.
--
-- STANDARD POSTGRESQL ONLY, same as 001-006. Additive: migration 005 and 006 are not edited.
-- ============================================================================
--
-- ════════════════════ WHY A TEXT KEY, AND NOT AN ENUM OR A COMPANY TABLE ════════════════════
--
-- The two obvious shapes are both refused, for the same reason migration 005 refused a `locations`
-- table: neither one would be an authority this schema actually owns.
--
--   * A SQL ENUM naming this deployment's operating companies would hard-code one tenant's
--     commercial structure into the platform's own closed vocabulary -- the line migration 004's
--     header already drew between "something the platform defines" and "something a tenant
--     customizes". Adding or renaming a company would then be a schema migration, and a second
--     deployment's companies would be unrepresentable.
--   * A second company master table here would be an unmaintained copy of reference data whose
--     original stays authoritative elsewhere -- exactly the "unclear authority" copy the Owner
--     ruling forbids, and exactly why there is no `locations` table in migration 005.
--
-- So the column is an opaque governed key, in the same spirit as `location_id`: carried as data,
-- validated by the authority layer, never joined as identity by this schema.
--
-- ════════════════════ WHY THERE IS NO DEFAULT, AND NO BACKFILL ════════════════════
--
-- A DEFAULT would let a writer that never decided an operating company still produce a row that
-- claims one. That is manufactured authority, and it is indistinguishable after the fact from a
-- deliberate assignment. The column is therefore NOT NULL with NO DEFAULT: a caller must state the
-- authority or the INSERT fails.
--
-- These three tables are pre-cutover and nothing deployed writes them (migration 005's header says
-- so). That is an expectation, not a fact this migration is willing to assume. The pre-flight block
-- below COUNTS the rows and RAISES if any table is occupied, rather than inventing a company key
-- for records whose real one nobody knows. A failed migration is recoverable; a silently
-- backfilled inventory authority is not. There is no data migration in this packet by design.
--
-- ════════════════════ WHY cycle_count_lines DOES NOT GET THE COLUMN ════════════════════
--
-- A line is not an independently located record. `cycle_count_lines.sheet_id` is NOT NULL and
-- REFERENCES `cycle_count_sheets(id)`, the line carries no location of its own, and the repository
-- already reads the sheet for the location when it stages ledger evidence
-- (cycleCountRepository.ts's `selectSheetLocation`). The sheet is the governed parent authority for
-- the whole count. Copying the company key onto every line would create a second place for the same
-- fact to be stated, which is the only way the two could ever disagree.
--
-- ════════════════════ WHY A SEPARATE CUSTODY LOCATION TYPE ════════════════════
--
-- `ops_location_type` is the PHYSICAL INVENTORY MOVEMENT vocabulary -- WAREHOUSE / BIN / MOBILE,
-- the three places company-held stock can be, and the three the warehouse-aggregate invariant
-- (ADR-014 / Decision #160) is defined over. Customer Equipment is not one of them: a unit that has
-- been installed has LEFT the company's inventory, and a movement row pointing at an Equipment id
-- would silently enter customer-owned machines into a balance that sums company stock. EQUIPMENT is
-- therefore NOT added to `ops_location_type`.
--
-- CUSTODY is a different question from movement: `serialized_custody` answers "where is this unit
-- now", and after installation the honest answer is "it is the customer's Equipment E". So custody
-- gets its own enum, `ops_custody_location_type`, which is `ops_location_type` plus EQUIPMENT. The
-- three shared labels convert by NAME (`location_type::text::ops_custody_location_type`), so every
-- existing WAREHOUSE/BIN/MOBILE row converts deterministically with no data loss and no mapping
-- table. CUSTOMER is deliberately NOT a location type -- the custody pointer names the Equipment
-- record, which is what already carries the account, not a second account reference here.
--
-- ════════════════════ THE INSTALLED RULE, IN BOTH DIRECTIONS ════════════════════
--
-- Installation is the moment a company-held serialized unit becomes a customer's Equipment, and the
-- product's existing domain contract already states the coupling as a BICONDITIONAL, not an
-- implication: functions/src/serializedAsset/types.ts's `validateSerializedAssetValue` rejects
-- `installed_requires_link` (INSTALLED with no Equipment link) AND `link_requires_installed` (an
-- Equipment link on any other state), and the mirrored client module
-- field-ops-app-vite/src/domain/serializedAssetIdentity.js enforces the same pair. The install
-- command (functions/src/equipmentInstall/installSerializedAssetCommand.ts) writes both facts in one
-- transaction -- `inventoryState: INSTALLED` and `currentEquipmentId: equipmentId` -- and refuses a
-- second install on the LINK rather than the state, because the two are kept in step.
--
-- `serialized_custody_installed_is_equipment` is that same biconditional expressed structurally:
-- status = 'INSTALLED' IF AND ONLY IF location_type = 'EQUIPMENT'. An installed unit can therefore
-- never be represented as still sitting in WAREHOUSE/BIN/MOBILE custody, and an EQUIPMENT custody
-- row can never claim a unit is still AVAILABLE or RESERVED for company use. `location_id` on such
-- a row is the Equipment id (the install command's `currentEquipmentId`), carried opaquely like
-- every other location id in this schema.

SET search_path = eos_ops, public;

-- ============================ pre-flight: refuse, never manufacture ============================
--
-- Runs BEFORE the column is added, so a populated table stops the migration with a message naming
-- the table and its row count instead of an opaque NOT NULL violation.

DO $$
DECLARE
    occupied TEXT;
BEGIN
    SELECT string_agg(t.table_name || ' (' || t.row_count || ' rows)', ', ' ORDER BY t.table_name)
      INTO occupied
      FROM (
          SELECT 'inventory_movements' AS table_name, count(*) AS row_count FROM eos_ops.inventory_movements
          UNION ALL
          SELECT 'serialized_custody',               count(*)               FROM eos_ops.serialized_custody
          UNION ALL
          SELECT 'cycle_count_sheets',               count(*)               FROM eos_ops.cycle_count_sheets
      ) t
     WHERE t.row_count > 0;

    IF occupied IS NOT NULL THEN
        RAISE EXCEPTION
            'migration 007 refuses to add operating_company_key: % already contain rows whose operating company is unknown',
            occupied
            USING HINT = 'These tables are pre-cutover and must be empty. No default or backfilled operating company will be invented -- resolve the real authority for these rows first.';
    END IF;
END
$$;

-- ============================ operating company: the mandatory authority ============================
--
-- NOT NULL, NO DEFAULT, on each of the three tables that assert a location or a custody. Safe as a
-- single statement only because the block above proved each table is empty.

ALTER TABLE inventory_movements ADD COLUMN operating_company_key TEXT NOT NULL;
ALTER TABLE serialized_custody  ADD COLUMN operating_company_key TEXT NOT NULL;
ALTER TABLE cycle_count_sheets  ADD COLUMN operating_company_key TEXT NOT NULL;

-- ============================ serialized custody: the location vocabulary ============================

CREATE TYPE ops_custody_location_type AS ENUM ('WAREHOUSE', 'BIN', 'MOBILE', 'EQUIPMENT');

-- By LABEL, so the three physical values survive verbatim. `serialized_custody_by_location` is
-- rebuilt by the ALTER; no index or constraint is dropped by hand.
ALTER TABLE serialized_custody
    ALTER COLUMN location_type TYPE ops_custody_location_type
    USING location_type::text::ops_custody_location_type;

ALTER TABLE serialized_custody
    ADD CONSTRAINT serialized_custody_installed_is_equipment CHECK (
        (status = 'INSTALLED') = (location_type = 'EQUIPMENT')
    );

-- Down Migration
SET search_path = eos_ops, public;

ALTER TABLE serialized_custody DROP CONSTRAINT IF EXISTS serialized_custody_installed_is_equipment;

-- Reversing the custody vocabulary NARROWS it. A row parked on EQUIPMENT has no WAREHOUSE/BIN/MOBILE
-- equivalent, and choosing one would invent a physical location for a unit that is at a customer
-- site. Refuse instead, the same way the up migration refuses to invent a company key.
DO $$
DECLARE
    installed BIGINT;
BEGIN
    SELECT count(*) INTO installed FROM eos_ops.serialized_custody WHERE location_type = 'EQUIPMENT';
    IF installed > 0 THEN
        RAISE EXCEPTION
            'migration 007 cannot be reversed: % serialized custody rows are in EQUIPMENT custody and have no physical location to revert to',
            installed
            USING HINT = 'No physical location will be invented for an installed unit. Resolve these rows first.';
    END IF;
END
$$;

ALTER TABLE serialized_custody
    ALTER COLUMN location_type TYPE ops_location_type
    USING location_type::text::ops_location_type;

DROP TYPE ops_custody_location_type;

ALTER TABLE cycle_count_sheets  DROP COLUMN operating_company_key;
ALTER TABLE serialized_custody  DROP COLUMN operating_company_key;
ALTER TABLE inventory_movements DROP COLUMN operating_company_key;
