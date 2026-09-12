-- Up Migration
-- EOS Operational Data Plane — the WAREHOUSE and BIN location reference data, as Postgres authority.
--
-- ============================================================================
-- MIGRATION 008. Migration 005's header named this migration before it existed:
--
--     "Promoting it to a real foreign key is exactly the reference-dependency migration named in
--      the cutover-boundary doc, and happens together with importing that reference data, not
--      before."
--
-- This is that migration for the two location types whose reference data this packet owns:
-- WAREHOUSE and BIN. MOBILE is deliberately NOT here (see below). Additive: migrations 001-007 are
-- not edited. STANDARD POSTGRESQL ONLY, same as 001-007.
-- ============================================================================
--
-- ════════════════════ WHY THIS IS NOT THE `locations` TABLE 005 REFUSED ════════════════════
--
-- Migration 005 refused a `locations` table for one stated reason: with no writer keeping it in
-- sync it would have been "a second, unmaintained copy of reference data whose Firestore original
-- stays authoritative". The refusal was about AUTHORITY, not about tables. What changes here is the
-- authority, not the appetite for a copy:
--
--   * `warehouseBinRepository.ts` lands in the same packet as the writer, so there is no unwritten
--     table.
--   * Nothing here is a projection of a Firestore document that keeps being written elsewhere. The
--     Firestore `warehouses` / `bins` collections are the MIGRATION SOURCE for these rows, and the
--     target state is that they stop being written at all -- see the reconciliation module
--     (eosOps/migration/warehouseBinMigrationSource.ts) for the mapping and what it refuses.
--   * The canonical ids are CARRIED, never re-derived. A warehouse's id is its existing document
--     id; a bin's id is its existing `bin_<sha256>`. There is no crosswalk table because there is
--     no renaming: an id that survives the move is an id no reconciliation has to explain.
--
-- ════════════════════ WHY THERE IS STILL NO BALANCE, AND NO `stock_locations` ════════════════════
--
-- A warehouse row and a bin row say WHERE a place is, never HOW MUCH is in it. Balance remains a
-- derived read over `inventory_movements` (migration 005's "WHY THERE IS NO BALANCE TABLE"), and
-- the warehouse aggregate remains direct + Σ(child bins) computed by a query (ADR-014 / Decision
-- #160). No quantity, quantity_on_hand, reserved or available column appears below, and
-- eosOpsPostgres.test.mjs names the balance-shaped table names that must never exist.
--
-- The legacy Firestore `stock_locations` -- a per-(warehouse, part, bin) row carrying BOTH
-- `quantity` and `quantityOnHand` -- is the shape that rule exists to prevent. It has no owner, no
-- writer in this repository's business code, and it diverged from the ledger in both directions
-- (functions/src/types/warehouse.ts's header records the measurement). This packet removes its
-- remaining seed writers and its dead composite index rather than giving it a home in SQL.
--
-- ════════════════════ WHY MOBILE IS ABSENT, AND WHY THERE IS NO TYPED-PAIR FOREIGN KEY YET ════════════════════
--
-- The physical movement vocabulary is WAREHOUSE | BIN | MOBILE (migration 005's `ops_location_type`;
-- EQUIPMENT stays out of it, migration 007). The honest referential rule is per-TYPE:
--
--     location_type = 'WAREHOUSE'  ->  location_id REFERENCES warehouses(id)
--     location_type = 'BIN'        ->  location_id REFERENCES bins(id)
--     location_type = 'MOBILE'     ->  location_id REFERENCES <the truck/mobile registry>
--
-- Standard PostgreSQL cannot express a foreign key that applies only for some values of a
-- discriminator column, and the MOBILE arm has no table here at all -- the Truck/MOBILE registry is
-- separate reference data and is not this packet's to import. So `inventory_movements`,
-- `serialized_custody` and `cycle_count_sheets` are NOT altered: adding two of the three arms by
-- hand would give the schema a half-enforced rule that reads as a whole one. The typed pair is
-- enforced at the repository boundary instead (`resolveOpsLocation`, which refuses a bare
-- `location_id`, refuses a mismatched pair, and refuses MOBILE as not-yet-in-Postgres), matching
-- this repository's stated convention of enforcing an invariant above the SQL boundary until the
-- database-level mechanism can be complete rather than decorative.
--
-- ════════════════════ THE OPERATING COMPANY LIVES ON THE WAREHOUSE, AND ONLY THERE ════════════════════
--
-- The Warehouse IS the company boundary root (functions/src/ownership/ownershipMatrix.ts: "none --
-- this IS the root"), so `warehouses.operating_company_key` is NOT NULL with NO DEFAULT, exactly as
-- migration 007 made it on the three authority-bearing tables, and for the same reason: a DEFAULT
-- would let a writer that never decided a company still emit a row claiming one.
--
-- `bins` deliberately does NOT carry the column. A bin's company is its warehouse's, reachable
-- through the composite foreign key below, and the ownership matrix already classifies every
-- warehouse-parented family as DERIVED rather than root. Copying the key onto each bin would create
-- a second place for the same fact, which is the only way the two could ever disagree -- the same
-- reasoning migration 007 gave for keeping it off `cycle_count_lines`.
--
-- ════════════════════ THE HIERARCHY IS A REAL FOREIGN KEY, AND IT IS TENANT-SAFE ════════════════════
--
-- `bins.warehouse_id` references `warehouses` on the COMPOSITE `(tenant_id, id)`, not on `id`
-- alone. A single-column reference would happily let tenant A's bin hang off tenant B's warehouse
-- and then report that stock under B's company. The composite makes that unrepresentable.
--
-- The parent is IMMUTABLE (binRegistry.ts's `warehouse_not_movable`): moving a bin between
-- warehouses would move every historical movement row at that bin across a custody boundary. The
-- repository exposes no method that changes it and a test proves the absence -- the same
-- above-the-SQL enforcement migration 005 used for the ledger's missing update/delete path.
--
-- ════════════════════ THE CODE IS A RENDERING; THE CLAIM IS PERMANENT ════════════════════
--
-- Decision #160 ruling O-3. `bins.id` is opaque and server-derived, and the CHECK below pins that
-- shape (`bin_` + 40 hex) so a human code can never be stored as an identity. `bin_code_claims` is
-- keyed on `(tenant_id, warehouse_id, code)` -- the natural key IS the primary key, so two claims on
-- the same code in the same warehouse are the same row and a duplicate has nowhere to go. That is
-- the structural form of the derived-document-id trick binRegistry.ts's `deriveBinClaimId` uses.
--
-- A claim is never released: a rename marks the old one SUPERSEDED and it stays pointed at the same
-- bin forever, which is what stops a stale printed label from resolving to a different shelf. There
-- is no DELETE path in the repository and none is added here.
--
-- Because the id is a FUNCTION OF THE CREATE NONCE, a create replay computes the SAME primary key
-- rather than a second row some uniqueness check then has to notice -- that is the whole reason
-- `deriveBinId` is derived rather than random, and it is the strongest form the guarantee takes.
-- `bins_idempotency` below is the tenant-scoped statement of the same fact. The id is tenant-blind,
-- so two tenants reusing one nonce collide on the primary key and the second create FAILS CLOSED;
-- it never lands in the wrong tenant.

SET search_path = eos_ops, public;

-- ============================ vocabulary ============================

-- Shared by warehouses and bins: both are ACTIVE or INACTIVE, and retiring either keeps history
-- readable rather than deleting a place that movements still point at. Mirrors
-- functions/src/types/warehouse.ts's WAREHOUSE_STATUSES and binRegistry.ts's BIN_STATUSES, which
-- are already the same two labels.
CREATE TYPE ops_location_status AS ENUM ('ACTIVE', 'INACTIVE');

-- The §3A governance-initialization discriminator, carried verbatim from
-- functions/src/types/warehouse.ts's WAREHOUSE_PROVENANCES. NATIVE = created by a governed writer;
-- MIGRATED = governance applied to a record that predates it. Carried rather than collapsed,
-- because "we know how this row came to be governed" is exactly what a reconciliation needs.
CREATE TYPE ops_location_provenance AS ENUM ('NATIVE', 'MIGRATED');

CREATE TYPE ops_bin_claim_state AS ENUM ('HELD', 'SUPERSEDED');

-- ============================ warehouses: the company boundary root ============================

CREATE TABLE warehouses (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- MANDATORY, never defaulted, never inferred. Opaque here for the reasons migration 007 gives.
    operating_company_key TEXT NOT NULL,
    name                  TEXT NOT NULL,
    -- The governed record's free-text `location` field -- a human site description ("Phoenix, AZ"),
    -- NOT a location id and never joined as one. Named `site_label` so no reader mistakes it for a
    -- reference to another row.
    site_label            TEXT NOT NULL,
    status                ops_location_status NOT NULL,
    provenance            ops_location_provenance NOT NULL,
    created_by            TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT        NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The id is used as an opaque reference by `inventory_movements.location_id` and as a document
    -- segment by the migration source. A blank or path-shaped id is neither.
    CONSTRAINT warehouses_id_is_a_safe_segment CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
    CONSTRAINT warehouses_company_is_stated CHECK (btrim(operating_company_key) <> ''),
    CONSTRAINT warehouses_name_is_stated CHECK (btrim(name) <> ''),
    -- The target of `bins`' composite parent reference. Redundant with the primary key by design:
    -- it is what makes the tenant-safe foreign key below expressible.
    CONSTRAINT warehouses_tenant_identity UNIQUE (tenant_id, id)
);

CREATE INDEX warehouses_by_company ON warehouses (tenant_id, operating_company_key);
CREATE INDEX warehouses_by_status  ON warehouses (tenant_id, status);

-- ============================ bins: an authoritative position beneath a warehouse ============================

CREATE TABLE bins (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    warehouse_id    TEXT NOT NULL,

    -- Structured racking. `bay` and `position` are INTEGERS: display width is a formatter setting,
    -- never a schema fact (binRegistry.ts's "WIDTH IS A RENDERING" note), so nothing here stores one.
    area            TEXT    NOT NULL,
    aisle           TEXT    NOT NULL,
    bay             INTEGER NOT NULL,
    "position"      INTEGER NOT NULL,

    -- DERIVED from the attributes above by the injected formatter. Stored because it is what is
    -- painted on the rack and scanned off it, not because it identifies anything.
    code            TEXT    NOT NULL,
    -- Descriptive only ("Bulk rack, north wall"). Never used for matching, never identity.
    name            TEXT,
    status          ops_location_status NOT NULL,
    -- The caller nonce `id` was derived from. Kept so a create replay is detectable as a replay
    -- rather than as a duplicate, the same contract binCommands.ts already has in Firestore.
    idempotency_key TEXT    NOT NULL,

    created_by      TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT        NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- THE HIERARCHY. Composite so a bin can never be parented to another tenant's warehouse.
    CONSTRAINT bins_parent_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES warehouses (tenant_id, id),

    -- Opaque, server-derived, and provably not a human code: `deriveBinId` is
    -- `bin_` + sha256(nonce) truncated to 40 hex characters.
    CONSTRAINT bins_id_is_opaque CHECK (id ~ '^bin_[0-9a-f]{40}$'),

    -- The same shapes binRegistry.ts validates before writing, restated where the data actually
    -- lands -- so a row that bypassed the validator is still refused.
    CONSTRAINT bins_area_is_canonical     CHECK (area  ~ '^[A-Z][A-Z0-9_]{0,31}$'),
    CONSTRAINT bins_aisle_is_canonical    CHECK (aisle ~ '^[A-Z]{1,2}$'),
    CONSTRAINT bins_code_is_canonical     CHECK (code  ~ '^[A-Z0-9][A-Z0-9.\-_]{0,31}$'),
    CONSTRAINT bins_bay_in_range          CHECK (bay BETWEEN 0 AND 9999),
    CONSTRAINT bins_position_in_range     CHECK ("position" BETWEEN 0 AND 99999),

    -- One physical shelf, one row. Two bins at the same rack position in the same warehouse would be
    -- two authorities for one place.
    CONSTRAINT bins_one_per_rack_position UNIQUE (tenant_id, warehouse_id, area, aisle, bay, "position"),
    -- Replay safety, structurally: the same nonce cannot produce a second bin.
    CONSTRAINT bins_idempotency UNIQUE (tenant_id, idempotency_key),
    -- Target of `bin_code_claims`' composite reference, for the same tenant-safety reason.
    CONSTRAINT bins_tenant_identity UNIQUE (tenant_id, id)
);

CREATE INDEX bins_by_warehouse ON bins (tenant_id, warehouse_id);
CREATE INDEX bins_by_status    ON bins (tenant_id, status);

-- ============================ bin code claims: a reservation that is never released ============================

CREATE TABLE bin_code_claims (
    tenant_id      TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    warehouse_id   TEXT NOT NULL,
    code           TEXT NOT NULL,
    bin_id         TEXT NOT NULL,
    claim_state    ops_bin_claim_state NOT NULL,
    claimed_by     TEXT        NOT NULL,
    claimed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at  TIMESTAMPTZ,

    -- The NATURAL key IS the key. A competing claim on the same code in the same warehouse has
    -- nowhere to go, so uniqueness cannot race the way a check-then-insert could.
    CONSTRAINT bin_code_claims_pkey PRIMARY KEY (tenant_id, warehouse_id, code),
    CONSTRAINT bin_code_claims_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES warehouses (tenant_id, id),
    CONSTRAINT bin_code_claims_bin FOREIGN KEY (tenant_id, bin_id) REFERENCES bins (tenant_id, id),
    CONSTRAINT bin_code_claims_code_is_canonical CHECK (code ~ '^[A-Z0-9][A-Z0-9.\-_]{0,31}$'),
    -- A superseded claim records WHEN it was superseded, and a held one never pretends it was.
    CONSTRAINT bin_code_claims_superseded_records_when CHECK (
        (claim_state = 'SUPERSEDED') = (superseded_at IS NOT NULL)
    )
);

-- A bin holds exactly one current code and any number of retired ones. Partial, so the permanent
-- SUPERSEDED history is unconstrained while the "current code" fact stays single-valued.
CREATE UNIQUE INDEX bin_code_claims_one_held_per_bin
    ON bin_code_claims (tenant_id, bin_id) WHERE claim_state = 'HELD';

CREATE INDEX bin_code_claims_by_bin ON bin_code_claims (tenant_id, bin_id);

-- Down Migration
SET search_path = eos_ops, public;

-- Reversing this DISCARDS the location reference data itself, not a projection of it: once these
-- rows are the authority there is no other copy to fall back to, and the movement/custody/sheet
-- rows that name a warehouse or bin would be left pointing at nothing. Refuse rather than destroy,
-- the same way migration 007's down refuses to invent a physical location for an installed unit.
DO $$
DECLARE
    occupied TEXT;
BEGIN
    SELECT string_agg(t.table_name || ' (' || t.row_count || ' rows)', ', ' ORDER BY t.table_name)
      INTO occupied
      FROM (
          SELECT 'warehouses'      AS table_name, count(*) AS row_count FROM eos_ops.warehouses
          UNION ALL
          SELECT 'bins',                          count(*)              FROM eos_ops.bins
          UNION ALL
          SELECT 'bin_code_claims',               count(*)              FROM eos_ops.bin_code_claims
      ) t
     WHERE t.row_count > 0;

    IF occupied IS NOT NULL THEN
        RAISE EXCEPTION
            'migration 008 cannot be reversed: % still hold location reference data that has no other authority',
            occupied
            USING HINT = 'Warehouses, bins and their permanent code claims are the authority here, not a copy of one. Resolve where this reference data should live before reversing.';
    END IF;
END
$$;

DROP TABLE IF EXISTS bin_code_claims;
DROP TABLE IF EXISTS bins;
DROP TABLE IF EXISTS warehouses;

DROP TYPE IF EXISTS ops_bin_claim_state;
DROP TYPE IF EXISTS ops_location_provenance;
DROP TYPE IF EXISTS ops_location_status;
