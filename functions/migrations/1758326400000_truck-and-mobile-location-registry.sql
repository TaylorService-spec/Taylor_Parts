-- Up Migration
-- EOS Operational Data Plane — the MOBILE Location and Truck registries, and the 1:1 relationship
-- between them.
--
-- ============================================================================
-- MIGRATION 008. Migration 005's header named this packet explicitly and deferred it:
--
--     "Warehouses, Bins and the Truck Registry remain FIRESTORE reference data in this tranche ...
--      Promoting it to a real foreign key is exactly the reference-dependency migration named in
--      the cutover-boundary doc, and happens together with importing that reference data, not
--      before."
--     (1757808000000_eos-ops-foundation.sql, "WHY LOCATION IS TWO COLUMNS, NOT A FOREIGN KEY")
--
-- This migration does the MOBILE half of that promotion: it stands up the two tables that make a
-- truck and its MOBILE inventory location real records in `eos_ops` instead of opaque strings,
-- and it makes the relationship between them a database invariant instead of an application-level
-- guard document. It cuts NOTHING over -- no deployed process reads or writes these tables, the
-- Firestore Truck Registry stays authoritative until a separately authorized import runs, and the
-- import's own refusal rules live in
-- functions/src/eosOps/migration/truckFleetMigrationSource.ts.
--
-- WAREHOUSE and BIN are deliberately NOT promoted here. They are a different object with a
-- different owner and a different reference graph; doing all three in one migration would make
-- every constraint below negotiable against warehouse concerns it has no business knowing about.
--
-- STANDARD POSTGRESQL ONLY, same as 001-007. Additive: 005, 006 and 007 are not edited.
-- ============================================================================
--
-- ════════════════════ R3: IDENTITY IS THE TYPED PAIR, SO THAT IS THE PRIMARY KEY ════════════════════
--
-- A location's identity is `(location_type, location_id)`, not `location_id` alone. Migration 005
-- already records every located row that way (`inventory_movements`, `serialized_custody`,
-- `cycle_count_sheets` all carry the pair). `mobile_locations` below is therefore keyed on
-- `(tenant_id, location_type, location_id)` -- the identity VERBATIM -- rather than on the id with
-- the type implied by the table name. Two consequences that are the point of doing it this way:
--
--   * the key that identifies a row here is byte-for-byte the key a ledger row already carries, so
--     a future `inventory_movements` -> `mobile_locations` reference is a plain composite foreign
--     key against columns that already exist, with no mapping step and no id rewriting;
--   * `mobile_location_is_mobile` pins this table's half of the vocabulary. The column is a real
--     `ops_location_type` and it is CHECKed, not defaulted, so a row can never quietly claim to be
--     a WAREHOUSE that happens to live in the mobile table.
--
-- The physical movement vocabulary is unchanged by this migration: `ops_location_type` remains
-- exactly WAREHOUSE | BIN | MOBILE. Nothing is added to it and nothing is removed from it.
--
-- ════════════════════ MOBILE LOCATION IDS ARE OPERATOR-TYPED, AND STAY THAT WAY ════════════════════
--
-- Nothing in the product constructs a MOBILE location id. `validateCreateInput`
-- (functions/src/truckRegistry/validation.ts:39-50, 73-98) accepts any non-empty, trimmed,
-- <=200-character string as `locationId` and writes it straight to the document key, and the live
-- sandbox accordingly carries three unrelated ad-hoc conventions at once (`cert-trk-01`,
-- `mobile-seed1786749487428-101`, and others). That is not a defect this migration is allowed to
-- fix: the id is already referenced by ledger evidence, and rewriting it would break the only link
-- between a movement and the place it happened.
--
-- So `location_id` is TEXT with no format constraint and no generated component, and the import
-- carries every id across UNCHANGED. What this migration adds is not a better id -- it is the
-- guarantee that the id is now unique, typed, and attached to a row that states its authority.
--
-- ════════════════════ THE OPERATING COMPANY IS AUTHORED, NEVER INFERRED ════════════════════
--
-- `mobile_locations.operating_company_key` is `TEXT NOT NULL` with NO DEFAULT, for exactly the
-- reason migration 007's header gives: a default would let a writer that never decided a company
-- still produce a row that claims one, and after the fact that is indistinguishable from a
-- decision.
--
-- There is one additional refusal specific to this object, and it is the sharpest fact in this
-- packet. A MOBILE location's operating company MUST NOT be derived from the truck's
-- `homeWarehouseId`, and the live sandbox proves that the derivation is WRONG, not merely
-- unprincipled: all five `cert-trk-01`..`cert-trk-05` MOBILE locations carry
-- `homeWarehouseId: "wh-main"`, which config/ownership/operating-company-roots.sandbox.json assigns
-- to `taylor`, while the same authored file assigns `cert-trk-04` and `cert-trk-05` to `ventana`.
-- A warehouse-derived answer is provably wrong for 2 of the 5. That configuration file forbids the
-- inference in its own header ("THEY ARE NOT INFERRED, AND NO CODE MAY EVER INFER THEM ... If a
-- rule appears to exist in the data below, it is a coincidence of authoring order and must not be
-- implemented"), and scripts/employeeTruckCrosswalk.lib.mjs:38-57 already implements the only
-- permitted resolution: authored configuration in, company out, with MISSING and CONFLICT as
-- refusals rather than guesses.
--
-- This schema cannot enforce "not inferred" -- provenance is not a column type. What it enforces is
-- that the fact must be STATED. A row with no company cannot exist, so an importer that cannot name
-- one has nowhere to put the record and must refuse instead. `truckFleetMigrationSource.ts` is that
-- refusal; the NOT NULL below is what makes bypassing it impossible.
--
-- ════════════════════ WHY `trucks` HAS NO OPERATING COMPANY COLUMN ════════════════════
--
-- Because a truck does not hold stock -- its MOBILE location does. Operating company enters this
-- schema as an INVENTORY authority: migration 007 put the column on the three tables that assert
-- where stock is or whose custody it sits in, and on nothing else. A truck row is a vehicle
-- business record (number, label, status, home warehouse); every quantity that rides on it is
-- recorded against the MOBILE location, which states the company.
--
-- Giving `trucks` its own copy would create a second place the same fact is stated, which is the
-- only way the two could ever disagree -- the identical argument migration 007 used to keep the
-- column off `cycle_count_lines`. Reading "which company's stock is on this truck" is a join to the
-- linked `mobile_locations` row, i.e. reading the one authoritative statement, which is not the
-- same thing as inferring it. An unlinked truck (see below) carries no stock, so the question does
-- not arise for one.
--
-- `home_warehouse_id` is carried opaquely and is DESCRIPTIVE ONLY: it is where the truck is based.
-- It is deliberately NOT a foreign key (warehouses are not in this schema yet) and, per the
-- paragraph above, it is never an input to any company answer.
--
-- ════════════════════ THE 1:1 LINK: A UNIQUE INDEX, NOT A CLAIM TABLE ════════════════════
--
-- Firestore carries a third collection, `location_truck_claims/{locationId}`, whose entire purpose
-- is stated in functions/src/truckRegistry/types.ts:7-9: "The cross-document 1:1 Truck<->MOBILE-
-- Location invariant CANNOT be expressed in Firestore Rules, so it is enforced HERE, inside one
-- transaction, via the create-if-absent of a location_truck_claims/{locationId} guard doc."
--
-- That collection is a WORKAROUND FOR A MISSING DATABASE FEATURE, not a domain object. It has no
-- fields of its own beyond the pair it guards, no lifecycle, and nothing reads it except the
-- commands that maintain it -- firestore.rules:1245-1248 denies clients even READ access to it,
-- with the comment "INTERNAL bookkeeping ... carries no reporting value and is never read by any
-- client surface". Postgres has the feature. So the claim is RETIRED here rather than
-- transliterated: the link lives on the truck as `(mobile_location_type, mobile_location_id)`, and
--
--   * `trucks_one_per_mobile_location`, a partial UNIQUE index, is the "at most one truck per
--     location" half -- the exact guarantee the claim document existed to provide;
--   * the composite FOREIGN KEY is the "the location exists" half, which the claim could not
--     provide at all (a Firestore transaction had to read the location separately and trust it);
--   * a truck holds at most one link because the pair is two columns on its own row.
--
-- Importing the claim collection into a table here would keep a third copy of a fact two columns
-- already state, and would reintroduce the drift the claim was invented to prevent. The importer
-- therefore reads the claims as EVIDENCE -- it checks every claim agrees with the truck it names,
-- and refuses on any mismatch -- and writes none of them.
--
-- ════════════════════ THE LINK IS OPTIONAL, BECAUSE THE LIVE DATA SAYS SO ════════════════════
--
-- Both link columns are NULLABLE, and that is a measured decision, not a convenience. In the live
-- sandbox 5 of the 7 `mobile_locations` (`cert-trk-01`..`cert-trk-05`) have NO truck and NO claim,
-- yet carry 55 ledger references between them. `trucks` and `mobile_locations` are, today, two
-- unlinked registries describing the same physical vehicles.
--
-- A mandatory link would make those five records unrepresentable, and the only ways to import them
-- anyway would be to invent five truck records or to drop five locations that operational history
-- already points at. Both are worse than the truth, which is: the location exists, it is a real
-- inventory location, and no truck business record has been linked to it yet.
--
-- The nullability is confined to the link and nothing else. `truck_mobile_link_whole` forbids a
-- half-link (a type without an id or an id without a type), so the pair is present or absent as a
-- unit and can never be partially stated.
--
-- ════════════════════ REASSIGNMENT CHANGES THE RELATIONSHIP, NEVER THE IDENTITY ════════════════════
--
-- Relinking a truck to a different MOBILE location is an UPDATE of two nullable columns on the
-- truck row. `truck_id` is part of the primary key and is never rewritten; `location_id` belongs to
-- the location row and is never rewritten either. Neither record's identity participates in the
-- relationship, so there is no operation in this schema that can change one by changing the other.
--
-- No assignment HISTORY table is created, because none exists to import: nothing in the Firestore
-- Truck Registry persists prior links (the commands overwrite the current value and record only an
-- Audit Event summary). Creating an empty history table here would be a second authority for a
-- question nothing can answer yet.
--
-- ════════════════════ WHAT IS DELIBERATELY ABSENT: THE DRIVER ════════════════════
--
-- `trucks` has NO `assigned_driver_employee_id` column. The truck side of the driver relationship
-- is real, but the identity on the other side of it is not settled in this schema: `employees`,
-- `fieldops_technicians` and `eos_policy.principals` are three different things today, and
-- scripts/employeeTruckCrosswalk.lib.mjs:18-37 documents at length why a technician id must never
-- be treated as an employee id. Adding the column now would force this migration to pick one of
-- them, which is a decision about Employee identity, not about Trucks.
--
-- Nothing is lost by waiting: the Firestore field stays authoritative, and adding one nullable
-- column plus a foreign key later is a strictly additive migration once the Employee record exists
-- here to point at. See docs/handoff/w1-c4-registrations.md.
--
-- ════════════════════ WHY THERE IS NO FOREIGN KEY FROM THE LEDGER YET ════════════════════
--
-- `inventory_movements.(location_type, location_id)` is not made to reference `mobile_locations`,
-- even though the columns now line up exactly. A foreign key there would constrain WAREHOUSE and
-- BIN rows too -- and those locations have no table in this schema, so every non-MOBILE movement
-- would become unwritable. SQL has no "foreign key only when location_type = 'MOBILE'" form.
--
-- That reference is correct and intended; it becomes available in the migration that promotes
-- Warehouse and Bin, and it is left for that migration rather than half-built here.

SET search_path = eos_ops, public;

-- ============================ vocabulary ============================
--
-- Exactly the three values functions/src/truckRegistry/types.ts:11-12 declares. OUT_OF_SERVICE is
-- the terminal DEACTIVATED_STATUS (types.ts:20); the biconditional below is what makes it terminal
-- in storage rather than only in the command layer.

CREATE TYPE ops_truck_status AS ENUM ('ACTIVE', 'IDLE', 'OUT_OF_SERVICE');

-- ============================ the MOBILE inventory location ============================

CREATE TABLE mobile_locations (
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- The typed pair, stored verbatim. See the R3 section above for why the type is a real column
    -- on a table that can only ever hold one of its values.
    location_type         ops_location_type NOT NULL,
    -- Operator-typed free text, carried across unchanged. No format is imposed; see above.
    location_id           TEXT NOT NULL,
    -- MANDATORY authority. Never defaulted, never inferred, and in particular never derived from
    -- any warehouse -- the derivation is provably wrong for 2 of the 5 certification trucks.
    operating_company_key TEXT NOT NULL,
    -- Required and non-empty, matching the governed read contract the Firestore write path already
    -- enforces (validation.ts:19-22: composeTruckFleet drops a record without one).
    display_label         TEXT NOT NULL,
    active                BOOLEAN NOT NULL,
    created_by            TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT        NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, location_type, location_id),
    CONSTRAINT mobile_location_is_mobile CHECK (location_type = 'MOBILE'),
    CONSTRAINT mobile_location_id_present CHECK (location_id <> ''),
    CONSTRAINT mobile_location_company_present CHECK (operating_company_key <> ''),
    CONSTRAINT mobile_location_label_present CHECK (display_label <> '')
);

-- "Every MOBILE location belonging to this company", the read the ownership model needs and the one
-- a truck row cannot answer for itself.
CREATE INDEX mobile_locations_by_company ON mobile_locations (tenant_id, operating_company_key);

-- ============================ the Truck business record ============================

CREATE TABLE trucks (
    tenant_id            TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    truck_id             TEXT NOT NULL,
    vehicle_number       TEXT NOT NULL,
    display_label        TEXT NOT NULL,
    status               ops_truck_status NOT NULL,
    active               BOOLEAN NOT NULL,
    -- DESCRIPTIVE ONLY. Where the truck is based. Not a foreign key (no warehouse table yet) and
    -- never an input to an operating-company answer.
    home_warehouse_id    TEXT NOT NULL,
    -- The 1:1 link. NULL together or set together; see `truck_mobile_link_whole`.
    mobile_location_type ops_location_type,
    mobile_location_id   TEXT,
    created_by           TEXT        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by           TEXT        NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, truck_id),
    CONSTRAINT truck_id_present CHECK (truck_id <> ''),
    CONSTRAINT truck_vehicle_number_present CHECK (vehicle_number <> ''),
    CONSTRAINT truck_label_present CHECK (display_label <> ''),
    CONSTRAINT truck_home_warehouse_present CHECK (home_warehouse_id <> ''),
    -- A half-stated link is never a valid state.
    CONSTRAINT truck_mobile_link_whole CHECK (
        (mobile_location_type IS NULL) = (mobile_location_id IS NULL)
    ),
    -- A truck links to a MOBILE location or to nothing. The FK below would already reject a
    -- WAREHOUSE pair (nothing in `mobile_locations` can carry that type), but stating it here makes
    -- the intent legible at the column rather than as a side effect of another table's CHECK.
    CONSTRAINT truck_mobile_link_is_mobile CHECK (
        mobile_location_type IS NULL OR mobile_location_type = 'MOBILE'
    ),
    -- The structural restatement of the governed lifecycle. `deactivateTruck`
    -- (truckRegistryCommands.ts:339-360) sets status = OUT_OF_SERVICE and active = false in one
    -- transaction; `reactivateTruck` (:362-381) sets active = true and a status that
    -- `isReactivationStatus` restricts to ACTIVE|IDLE; and `changeStatus` refuses OUT_OF_SERVICE
    -- outright (validation.ts:57-63, "that state is only reachable via the governed,
    -- inventory-guarded deactivateTruck path"). The three rules together are a biconditional, and
    -- it is written as one here for the same reason migration 007 wrote the INSTALLED rule
    -- structurally: an out-of-service truck that still claims to be active, or an active truck
    -- parked on the terminal status, is a state the command layer cannot produce and storage should
    -- not accept.
    CONSTRAINT truck_out_of_service_is_inactive CHECK (
        (status = 'OUT_OF_SERVICE') = (active = false)
    ),
    -- The location half of the 1:1 relationship: the link resolves to a row that exists, in the
    -- same tenant. This is what the Firestore claim document could not do.
    CONSTRAINT truck_mobile_location_exists FOREIGN KEY (tenant_id, mobile_location_type, mobile_location_id)
        REFERENCES mobile_locations (tenant_id, location_type, location_id)
);

-- The truck half of the 1:1 relationship, and the whole reason `location_truck_claims` existed.
-- PARTIAL, so the unlinked trucks the live data contains do not collide with each other on NULL.
CREATE UNIQUE INDEX trucks_one_per_mobile_location
    ON trucks (tenant_id, mobile_location_type, mobile_location_id)
    WHERE mobile_location_id IS NOT NULL;

-- Down Migration
SET search_path = eos_ops, public;

-- Reversing this migration DESTROYS two canonical registries, including every authored operating
-- company assignment they carry -- a fact with no other home in this schema. Refuse while either
-- table is occupied, the same way migration 007 refuses to reverse an EQUIPMENT custody it cannot
-- give a physical location back to. An empty pair reverses cleanly.
DO $$
DECLARE
    occupied TEXT;
BEGIN
    SELECT string_agg(t.table_name || ' (' || t.row_count || ' rows)', ', ' ORDER BY t.table_name)
      INTO occupied
      FROM (
          SELECT 'trucks' AS table_name, count(*) AS row_count FROM eos_ops.trucks
          UNION ALL
          SELECT 'mobile_locations',      count(*)             FROM eos_ops.mobile_locations
      ) t
     WHERE t.row_count > 0;

    IF occupied IS NOT NULL THEN
        RAISE EXCEPTION
            'migration 008 cannot be reversed: % still contain rows, including operating-company authority stated nowhere else',
            occupied
            USING HINT = 'Export or resolve these registries first. Nothing here will be dropped out from under the records that reference it.';
    END IF;
END
$$;

DROP INDEX IF EXISTS trucks_one_per_mobile_location;
DROP TABLE trucks;
DROP INDEX IF EXISTS mobile_locations_by_company;
DROP TABLE mobile_locations;
DROP TYPE ops_truck_status;
