-- Up Migration
-- EOS Operational Data Plane — Supplier identity and the Part↔Supplier catalog item, in PostgreSQL.
--
-- ============================================================================
-- MIGRATION 008. Target architecture (firebase-exit-manifest.json): PostgreSQL is the authority,
-- governed EOS commands are the only writer, EOS APIs are the only transport, Administration→Objects
-- is the surface. This migration moves the SUPPLIER and SUPPLIER CATALOG ITEM business objects onto
-- that authority. It creates no Firestore collection, reads none, and mirrors none.
--
-- STANDARD POSTGRESQL ONLY, same as 001-007. Purely additive: no earlier migration is edited.
-- ============================================================================
--
-- ════════════════════ WHAT THESE TWO TABLES CORRESPOND TO TODAY ════════════════════
--
-- `suppliers` here is the governed Supplier of DECISIONS #78 -- the record validated by
-- functions/src/supplierMaster/supplierMasterValidation.ts and written by
-- functions/src/supplierMaster/supplierMasterCommands.ts. Its stored shape is
-- supplierMasterTypes.ts's `GovernedSupplier`: identity, a name, a normalized key, a status, a
-- version, the audit quad, and seven optional business strings. Every column below is one of those
-- fields and nothing else. No field is added here that the governed record does not already have,
-- because a column with no source is a fact nobody stated.
--
-- `supplier_catalog_items` here is the governed `part_supplier_items` authority of ADR-008 /
-- Decision #40 (functions/src/partMaster/partSupplierItems.ts) -- the normalized procurement terms
-- for one Part from one Supplier. It is NOT the older Epic 5 `supplier_catalog` collection
-- (functions/src/constants/collections.ts:41), which is a second, incompatible representation of
-- the same business fact and which this migration deliberately does not model. See the note on
-- duplicate authority at the end of this header.
--
-- ════════════════════ WHY IDENTITY IS (tenant_id, business_id) AND NOT A SURROGATE ════════════════════
--
-- Migrations 005-007 give their tables a generated `id TEXT PRIMARY KEY` because those records are
-- EVENTS -- a movement, a count line -- whose identity the platform mints. A Supplier is not an
-- event. Its identity is `supplierId`, a governed value the business already owns and already uses
-- as the Firestore document id (supplierMasterRepository.ts's `ref(id)`), and which
-- part_supplier_items already references by that exact string. Minting a surrogate key next to it
-- would create a second answer to "which supplier is this", and the two could only ever agree by
-- convention.
--
-- So the primary key IS the business identity, scoped by tenant because the same governed id string
-- may legitimately exist in two tenants:
--
--     suppliers              PRIMARY KEY (tenant_id, supplier_id)
--     supplier_catalog_items PRIMARY KEY (tenant_id, part_id, supplier_id)
--
-- The catalog item's key is the pair it is defined by, which is also exactly what makes the
-- Firestore doc id `<partId>__<supplierId>` deterministic (partSupplierItems.ts's
-- `buildSupplierItemId`). That doc id is reproduced as a GENERATED column rather than stored,
-- so the two can never disagree: there is one authority (the pair) and one derivation.
--
-- ════════════════════ THE FOREIGN KEY IS THE POINT ════════════════════
--
-- In Firestore, `part_supplier_items.supplierId` is a string that is HOPED to name a supplier.
-- Nothing checks it: partSupplierItems.ts validates the supplier id's FORMAT
-- (`SUPPLIER_ID_PATTERN`) and never reads the suppliers collection. A catalog item pointing at a
-- supplier that does not exist is writable today and discoverable only by a census.
--
--     FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, supplier_id)
--
-- is the single largest thing this migration buys. It is the relationship, enforced, and it is
-- the reason the Part↔Supplier link can stop being a convention.
--
-- `part_id` gets NO foreign key, and that is deliberate rather than an oversight. There is no
-- `parts` table in this schema: Part remains Firestore-authoritative in this tranche, and
-- migration 005 already carries `part_id` as an unjoined governed key for exactly that reason.
-- Inventing a local `parts` table to point at would be the "unmaintained copy of reference data
-- whose original stays authoritative elsewhere" that migration 007's header refuses. The value is
-- instead gated at the boundary by `requireCanonicalPartId`
-- (functions/src/eosOps/migration/partIdContract.ts) -- the one canonicalization, reused, never
-- restated -- and the CHECK below only re-states the id FORMAT that gate already enforces.
--
-- ════════════════════ ONE PREFERRED SUPPLIER, AS A DATABASE INVARIANT ════════════════════
--
-- "At most one ACTIVE preferred supplier item per part" is today an application invariant, held by
-- a Firestore transaction that queries the current preferred item and clears it before setting the
-- new one (partSupplierItems.ts's `setPreferredSupplier`). It is correct, and it is only as strong
-- as every future writer remembering to go through that one function.
--
--     CREATE UNIQUE INDEX supplier_catalog_items_one_preferred_per_part
--         ON supplier_catalog_items (tenant_id, part_id) WHERE preferred;
--
-- states it once, where no writer can route around it. The companion CHECK
-- (`preferred` implies `status = 'ACTIVE'`) carries the other half of the same rule --
-- partSupplierItems.ts refuses to prefer a non-ACTIVE item -- so "preferred" cannot survive a
-- deactivation as a stale flag.
--
-- ════════════════════ WHY THE DEDUP INDEX IS NOT UNIQUE ════════════════════
--
-- `normalized_key` exists to DETECT suppliers that look like duplicates. S2's stated policy is
-- detection, never auto-merge (supplierMasterTypes.ts: "for dedup DETECTION only -- never an
-- auto-merge key"; supplierMasterRepository.ts's `findActiveByNormalizedKey` flags for human
-- review). A UNIQUE index would convert that policy into a refusal at write time, silently
-- deciding a question the business reserved for a person. So the index is a plain lookup index,
-- partial on ACTIVE because that is the only set the detection query considers.
--
-- ════════════════════ WHY THERE IS NO operating_company_key HERE ════════════════════
--
-- Migration 007 added `operating_company_key NOT NULL` to the three tables that assert WHERE stock
-- is or WHOSE custody it sits in. Neither table here asserts either. The governed classification
-- that already exists says the same: functions/src/ownership/ownershipMatrix.ts:409-428 classifies
-- `part_supplier_items` as REFERENCE / COMPANY_NEUTRAL ("Both operating companies may legitimately
-- use the same record"), and :430-435 holds `suppliers` apart as an explicit OPEN QUESTION --
-- "Supplier identity is shared; supplier terms may be per-company."
--
-- This migration does not settle that question, and specifically does not settle it by adding a
-- column. There is no operating company on any governed Supplier or supplier-item record anywhere
-- in the source (the field does not exist in `GovernedSupplier` or `StoredPartSupplierItem`), so a
-- NOT NULL column would have to be defaulted or backfilled with a value nobody stated -- the
-- manufactured authority migration 007 refused -- and a NULLABLE one would record "we do not know"
-- as if it were data. The honest shape is the absence, plus this paragraph. When the Owner rules,
-- adding the column is a one-line additive migration against tables that are still empty.
--
-- What the two tables DO show, and what the ruling will want: the commercial terms -- cost,
-- currency, lead time, minimum order quantity, order multiple, contract window -- are ALL on
-- `supplier_catalog_items`, not on `suppliers`. The Supplier record carries identity and contact
-- plus `payment_terms_ref`, which supplierMasterTypes.ts states is "a label/reference, not a terms
-- engine". So if the ruling is "terms are company-scoped", the column lands on the catalog item.
--
-- ════════════════════ WHY THERE IS NO manufacturers TABLE ════════════════════
--
-- Manufacturer is a fully built governed object -- three trusted commands
-- (functions/src/partMaster/partMasterCommands.ts:481-640), three callables exported from
-- functions/src/index.ts:365-369, a read service, a metadata definition, UI surfaces -- and it is
-- NOT modelled here, for three reasons that are about evidence rather than effort:
--
--   1. Its ONLY relationship is `parts.manufacturerId` (functions/src/partMaster/types.ts:113),
--      and there is no `parts` table in this schema to hold the other end. The foreign key that
--      would justify the table cannot be created yet. Nothing joins a manufacturer to a supplier:
--      a full search of functions/src finds no field, on any record, relating the two.
--   2. It holds no rows. The `manufacturers` collection is declared in code
--      (partMasterRepository.ts:20) and is absent from the sandbox, and client writes are gated
--      off in every environment (field-ops-app-vite/src/config/environments.json's
--      MANUFACTURER_WRITE_READY: false).
--   3. A table with no data, no writer and no enforceable relationship is a shape, not an
--      authority. Creating it now would be the speculative architecture this schema has refused
--      since migration 005 declined a `locations` table.
--
-- ════════════════════ WHAT THIS DOES NOT RETIRE, AND WHY ════════════════════
--
-- `functions/src/supplierService.ts` reads the SAME `suppliers` collection through a second,
-- incompatible shape (`types/procurement.ts`'s `Supplier`: `contactEmail`, `leadTimeDays` -- fields
-- the governed record does not have, over a lead time that actually belongs to a catalog item), and
-- `supplier_catalog` is a second representation of this table's own subject. Both are duplicate
-- Firebase business authority and both should go. Deleting them changes
-- docs/architecture/firebase-exit-baseline.json, which this change is not permitted to edit; the
-- exact delta is specified in docs/handoff/w1-c6-registrations.md instead. Nothing here depends on
-- either of them.

SET search_path = eos_ops, public;

-- ============================ closed vocabularies ============================
--
-- Each mirrors a `const` tuple that is already the closed list in the governed source, so the
-- database refuses what the validator refuses rather than restating it loosely as TEXT.
--   ops_supplier_status       supplierMasterTypes.ts SUPPLIER_STATUSES
--   ops_supplier_item_status  partSupplierItems.ts   SUPPLIER_ITEM_STATUSES
--   ops_supplier_availability partSupplierItems.ts   AVAILABILITY_STATES

CREATE TYPE ops_supplier_status       AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE ops_supplier_item_status  AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE ops_supplier_availability AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'UNKNOWN');

-- ============================ suppliers: the governed identity ============================

CREATE TABLE suppliers (
    tenant_id         TEXT NOT NULL REFERENCES eos_policy.tenants(id),

    -- The governed supplierId, verbatim. supplierMasterTypes.ts SUPPLIER_ID_PATTERN, restated as a
    -- CHECK so a row can never carry an id the governed writer would have refused.
    supplier_id       TEXT NOT NULL CHECK (supplier_id ~ '^[A-Za-z0-9_-]{1,64}$'),

    name              TEXT NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),

    -- Carried verbatim from the governed record. It is NOT recomputed here: normalizeSupplierName
    -- (supplierMasterValidation.ts) is the one definition of "normalized", and a second one in SQL
    -- would drift from it exactly the way partIdContract.ts's header describes.
    normalized_key    TEXT NOT NULL CHECK (btrim(normalized_key) <> ''),

    status            ops_supplier_status NOT NULL,
    version           INTEGER NOT NULL CHECK (version >= 1),

    -- The seven optional business strings. Optional means ABSENT; when present the governed writer
    -- requires a non-blank string (supplierMasterCommands.ts's assertOptionalFields), so NULL or a
    -- real value, never an empty one pretending to be a value.
    vendor_number     TEXT CHECK (vendor_number     IS NULL OR btrim(vendor_number)     <> ''),
    contact_name      TEXT CHECK (contact_name      IS NULL OR btrim(contact_name)      <> ''),
    phone             TEXT CHECK (phone             IS NULL OR btrim(phone)             <> ''),
    email             TEXT CHECK (email             IS NULL OR btrim(email)             <> ''),
    address           TEXT CHECK (address           IS NULL OR btrim(address)           <> ''),
    payment_terms_ref TEXT CHECK (payment_terms_ref IS NULL OR btrim(payment_terms_ref) <> ''),
    notes             TEXT CHECK (notes             IS NULL OR btrim(notes)             <> ''),

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        TEXT NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        TEXT NOT NULL,

    PRIMARY KEY (tenant_id, supplier_id)
);

-- Dedup DETECTION, deliberately not UNIQUE -- see the header. Partial on ACTIVE because that is the
-- only set findActiveByNormalizedKey considers.
CREATE INDEX suppliers_by_normalized_key
    ON suppliers (tenant_id, normalized_key) WHERE status = 'ACTIVE';

CREATE INDEX suppliers_by_status ON suppliers (tenant_id, status);

-- ============================ supplier catalog items: the Part↔Supplier relationship ============================

CREATE TABLE supplier_catalog_items (
    tenant_id                 TEXT NOT NULL REFERENCES eos_policy.tenants(id),

    -- The canonical Part.partId (P1B ruling R1). Format only; EXISTENCE is the Part authority's
    -- question, and requireCanonicalPartId is the boundary gate every writer passes through.
    part_id                   TEXT NOT NULL CHECK (part_id ~ '^[A-Za-z0-9_-]{1,64}$'),
    supplier_id               TEXT NOT NULL,

    -- The Firestore document id this record had, DERIVED rather than stored, so there is exactly
    -- one authority for it (the key) and no possibility of a stored copy disagreeing.
    -- Mirrors partSupplierItems.ts buildSupplierItemId.
    item_id                   TEXT GENERATED ALWAYS AS (part_id || '__' || supplier_id) STORED,

    supplier_sku              TEXT NOT NULL CHECK (btrim(supplier_sku) <> '' AND length(supplier_sku) <= 120),

    -- Money and quantities as NUMERIC, never floating point. The source stores them as decimal
    -- STRINGS for the same reason (partSupplierItems.ts DECIMAL_PATTERN, max 4 dp).
    cost                      NUMERIC(19, 4) NOT NULL CHECK (cost >= 0),
    currency                  TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    lead_time_days            INTEGER NOT NULL CHECK (lead_time_days BETWEEN 0 AND 3650),
    min_order_qty             NUMERIC(19, 4) CHECK (min_order_qty  IS NULL OR min_order_qty  > 0),
    order_multiple            NUMERIC(19, 4) CHECK (order_multiple IS NULL OR order_multiple > 0),

    -- The purchase-unit conversion, decomposed into its two integers rather than stored as JSON:
    -- types.ts ConversionFactor is exactly {numerator, denominator}, and columns let the database
    -- state the positivity rule the validator states.
    purchase_unit             TEXT,
    conversion_numerator      INTEGER CHECK (conversion_numerator   IS NULL OR conversion_numerator   > 0),
    conversion_denominator    INTEGER CHECK (conversion_denominator IS NULL OR conversion_denominator > 0),

    contract_start            DATE,
    contract_end              DATE,

    availability              ops_supplier_availability NOT NULL,
    preferred                 BOOLEAN NOT NULL DEFAULT FALSE,
    last_verified_at          TIMESTAMPTZ,
    status                    ops_supplier_item_status NOT NULL,
    version                   INTEGER NOT NULL CHECK (version >= 1),

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                TEXT NOT NULL,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                TEXT NOT NULL,

    PRIMARY KEY (tenant_id, part_id, supplier_id),

    -- THE relationship. See the header: this is what the Firestore representation cannot state.
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, supplier_id),

    -- partSupplierItems.ts: "purchaseUnit requires conversionToStockingUnit". All three together or
    -- none -- a half-stated conversion is a silently wrong quantity.
    CONSTRAINT supplier_catalog_items_conversion_all_or_none CHECK (
        num_nulls(purchase_unit, conversion_numerator, conversion_denominator) IN (0, 3)
    ),

    -- partSupplierItems.ts INVALID_DATE_RANGE.
    CONSTRAINT supplier_catalog_items_contract_window CHECK (
        contract_start IS NULL OR contract_end IS NULL OR contract_end >= contract_start
    ),

    -- partSupplierItems.ts setPreferredSupplier: "only an ACTIVE supplier item can be preferred".
    -- As a CHECK it also means deactivation cannot leave `preferred` behind as a stale flag.
    CONSTRAINT supplier_catalog_items_preferred_is_active CHECK (
        NOT preferred OR status = 'ACTIVE'
    )
);

-- The invariant, held by the database instead of by every writer's memory. Partial on `preferred`,
-- so the table may hold any number of non-preferred items per part and exactly one preferred one.
-- No separate ACTIVE predicate is needed: the CHECK above already makes preferred imply ACTIVE.
CREATE UNIQUE INDEX supplier_catalog_items_one_preferred_per_part
    ON supplier_catalog_items (tenant_id, part_id) WHERE preferred;

CREATE INDEX supplier_catalog_items_by_supplier ON supplier_catalog_items (tenant_id, supplier_id);
CREATE INDEX supplier_catalog_items_by_status   ON supplier_catalog_items (tenant_id, status);

-- Down Migration
SET search_path = eos_ops, public;

-- Reverse dependency order: the catalog item references the supplier.
DROP TABLE IF EXISTS supplier_catalog_items;
DROP TABLE IF EXISTS suppliers;

DROP TYPE IF EXISTS ops_supplier_availability;
DROP TYPE IF EXISTS ops_supplier_item_status;
DROP TYPE IF EXISTS ops_supplier_status;
