-- Up Migration
-- EOS Operational Data Plane — the `eos_ops` schema foundation.
--
-- ============================================================================
-- MIGRATION 005. Owner ruling (2026-09-10, "EOS Operational Data Plane P0"): PostgreSQL is the
-- target authoritative operational persistence for EOS, reusing the EXISTING Render Postgres
-- database and connection (`DATABASE_URL`) that already holds `eos_policy` -- no second database,
-- no second connection string. Domain separation is by SCHEMA, not by database:
--
--   eos_policy   identity, tenancy, Roles, capability grants, workflow/policy configuration
--   eos_ops      operational business records (this migration)
--
-- This migration does NOT cut any client over. It stands up the schema and the smallest coherent
-- set of foundation tables the P0 census showed were clearly required, and nothing this schema
-- creates is read or written by any deployed process yet -- see
-- docs/design/eos-operational-data-plane-inventory-authority-cutover.md for the full migration
-- boundary and why the cutover itself is deliberately out of scope here.
--
-- STANDARD POSTGRESQL ONLY, same as 001-004.
-- ============================================================================
--
-- ════════════════════ WHY THERE IS NO BALANCE TABLE ════════════════════
--
-- The existing Firestore authority already answers this question, and the answer is preserved
-- rather than reinvented: on-hand quantity for a NONE-tracked Part is the SUM of signed movements
-- at a (part, location) pair over the ledger, never a second maintained number. Collections.ts
-- records that `stock_locations` -- a per-(warehouse, part, bin) balance row -- was retired in this
-- same codebase after measured divergence from the ledger in both directions. Transliterating that
-- retired shape into SQL here would recreate exactly the failure it was retired to stop. Balance is
-- a DERIVED READ over `inventory_movements`, computed by a query, not stored.
--
-- ════════════════════ WHY LOCATION IS TWO COLUMNS, NOT A FOREIGN KEY ════════════════════
--
-- Warehouses, Bins and the Truck Registry remain FIRESTORE reference data in this tranche -- their
-- authority classification is not being changed by this PR (see the cutover-boundary doc). Adding a
-- Postgres `locations` table now, with no writer keeping it in sync, would be a second, unmaintained
-- copy of reference data whose Firestore original stays authoritative -- the exact "unclear
-- authority" copy the Owner ruling forbids. So a location is recorded here the same way Cycle
-- Count's OWN Firestore model already records it (`CycleCountLocationRef`): a `location_type` in
-- ('WAREHOUSE', 'BIN', 'MOBILE') and an opaque `location_id` string, carried as data rather than
-- joined as identity. Promoting it to a real foreign key is exactly the reference-dependency
-- migration named in the cutover-boundary doc, and happens together with importing that reference
-- data, not before.
--
-- ════════════════════ THE WAREHOUSE-AGGREGATE INVARIANT (ADR-014 / Decision #160) ════════════════════
--
-- Preserved exactly, not reinterpreted: a WAREHOUSE row means the direct/unbinned balance; a BIN row
-- means that exact bin; the warehouse aggregate is direct + Σ(child bins), always a derived read,
-- never a stored aggregate. A same-warehouse relocation (WAREHOUSE-direct<->BIN, BIN<->BIN) records
-- two movement rows whose signed deltas cancel in the aggregate by construction -- there is no
-- separate "aggregate" column for a relocation to leave stale.
--
-- ════════════════════ WHY THE LEDGER HAS NO UPDATE OR DELETE PATH ════════════════════
--
-- `inventory_movements` is immutable evidence, never a mutable "history" table -- the same rule this
-- schema's own `audit_events` table already keeps in `eos_policy`. Enforced at the application layer
-- at minimum in this tranche (the repository that will be written against this table offers no
-- update/delete method, and a static test proves it), matching this repository's existing convention
-- of enforcing invariants above the SQL boundary before reaching for a database-level mechanism.

CREATE SCHEMA IF NOT EXISTS eos_ops;
SET search_path = eos_ops, public;

-- ============================ vocabulary ============================

CREATE TYPE ops_tracking_mode AS ENUM ('NONE', 'SERIAL');
CREATE TYPE ops_location_type AS ENUM ('WAREHOUSE', 'BIN', 'MOBILE');

-- Preserves the distinct vocabulary Decision #170 ruled on: a relocation (same Warehouse custody
-- parent) is never spelled with Transfer's verbs, and vice versa. WORK_ORDER_CONSUMPTION and
-- ADJUSTED are carried over from the existing operational ledger's own vocabulary.
CREATE TYPE ops_movement_type AS ENUM (
    'RECEIVED', 'RETURNED',
    'TRANSFER_OUT', 'TRANSFER_IN',
    'RELOCATION_OUT', 'RELOCATION_IN',
    'WORK_ORDER_CONSUMPTION',
    'SCRAPPED', 'ADJUSTED'
);

CREATE TYPE ops_serial_status AS ENUM ('AVAILABLE', 'RESERVED', 'INSTALLED', 'CONSUMED', 'SCRAPPED');

CREATE TYPE ops_cycle_count_sheet_status AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');
CREATE TYPE ops_cycle_count_line_status  AS ENUM ('OPEN', 'COUNTED', 'RECONCILED', 'REJECTED', 'CANCELLED');
CREATE TYPE ops_cycle_count_review_decision AS ENUM ('APPROVE', 'REJECT');

-- ============================ the inventory movement ledger ============================
--
-- THE SOLE QUANTITY-MUTATING RECORD in eos_ops. For any quantity-affecting transaction, the
-- authoritative balance change IS a row here (there is no separate balance mutation to keep in
-- step) -- and any serialized-custody mutation that accompanies it commits in the SAME database
-- transaction as the row below, so the two can never disagree about whether a movement happened.

CREATE TABLE inventory_movements (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    part_id         TEXT NOT NULL,
    tracking_mode   ops_tracking_mode NOT NULL,
    location_type   ops_location_type NOT NULL,
    location_id     TEXT NOT NULL,
    movement_type   ops_movement_type NOT NULL,
    -- Signed. NONE mode: the quantity moved. SERIAL mode: always 1 or -1, one row per serial unit --
    -- a multi-serial movement is multiple rows, so the ledger never encodes "which serials" as a
    -- count that could disagree with a units list held elsewhere.
    quantity_delta  INTEGER NOT NULL,
    -- Populated for SERIAL mode only; NULL for NONE mode. Enforced below rather than left to callers
    -- to remember, because a NONE-mode row with a serial number would silently claim serial identity
    -- for a Part this ledger never tracks that way.
    serial_number   TEXT,
    source_kind     TEXT        NOT NULL,
    source_id       TEXT        NOT NULL,
    -- Idempotent replay: the same source retrying the same movement must not double-post it. NULL
    -- means "this movement kind has no replay concern"; where it is used it is unique per tenant.
    idempotency_key TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT movement_quantity_nonzero CHECK (quantity_delta <> 0),
    CONSTRAINT movement_serial_matches_tracking CHECK (
        (tracking_mode = 'SERIAL' AND serial_number IS NOT NULL AND quantity_delta IN (1, -1))
        OR (tracking_mode = 'NONE' AND serial_number IS NULL)
    )
);

CREATE INDEX inventory_movements_by_part_location
    ON inventory_movements (tenant_id, part_id, location_type, location_id);
CREATE INDEX inventory_movements_by_source ON inventory_movements (tenant_id, source_kind, source_id);
CREATE UNIQUE INDEX inventory_movements_idempotency
    ON inventory_movements (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================ serialized custody ============================
--
-- The CURRENT custody pointer for one serialized unit. Not the ledger -- the ledger is the evidence
-- of how it got there; this is where it IS right now, which is what a lookup by serial number needs
-- without replaying every movement. Kept in the same transaction as the ledger row that moved it.

CREATE TABLE serialized_custody (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    part_id        TEXT NOT NULL,
    serial_number  TEXT NOT NULL,
    status         ops_serial_status NOT NULL,
    location_type  ops_location_type NOT NULL,
    location_id    TEXT NOT NULL,
    updated_by     TEXT        NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One serial number identifies exactly one physical unit of one Part, tenant-wide. A duplicate
    -- row would be two custody authorities for the same physical thing.
    CONSTRAINT serialized_custody_unique UNIQUE (tenant_id, part_id, serial_number)
);

CREATE INDEX serialized_custody_by_location ON serialized_custody (tenant_id, location_type, location_id);

-- ============================ Cycle Count: sheet ============================
--
-- Preserves the settled v2 model exactly: OPEN/CLOSED/CANCELLED, no recount, no reopen, no
-- whole-sheet approval step beyond closing once every line is dispositioned.

CREATE TABLE cycle_count_sheets (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    location_type ops_location_type NOT NULL,
    location_id   TEXT NOT NULL,
    status        ops_cycle_count_sheet_status NOT NULL DEFAULT 'OPEN',
    created_by    TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    TEXT        NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_by     TEXT,
    closed_at     TIMESTAMPTZ,
    CONSTRAINT sheet_closed_records_when CHECK (
        (status <> 'CLOSED') OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)
    )
);

CREATE INDEX cycle_count_sheets_by_location ON cycle_count_sheets (tenant_id, location_type, location_id);
CREATE INDEX cycle_count_sheets_by_status   ON cycle_count_sheets (tenant_id, status);

-- ============================ Cycle Count: line ============================
--
-- One Part + tracking path per sheet. The BLIND CONTRACT lives at the repository/read layer, not
-- here: `expected_quantity` / `expected_serial_numbers` are columns like any other, and the schema
-- makes no attempt to hide them from SQL -- what makes the count blind is that the repository
-- function a counter's read path calls never selects them before `submitted_at` is set. A test
-- proves that repository contract; this migration only proves the column exists to snapshot into.
--
-- `submitted_by` is carried independently of `updated_by` so it survives a later reconcile (which
-- would otherwise overwrite `updated_by`) -- it is the fact a future reconcile command needs to
-- refuse self-approval.

CREATE TABLE cycle_count_lines (
    id                       TEXT PRIMARY KEY,
    tenant_id                TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    sheet_id                 TEXT NOT NULL REFERENCES cycle_count_sheets(id),
    part_id                  TEXT NOT NULL,
    tracking_mode            ops_tracking_mode NOT NULL,
    status                   ops_cycle_count_line_status NOT NULL DEFAULT 'OPEN',

    -- the blind expected snapshot, frozen when the line opens
    expected_quantity        INTEGER,
    expected_serial_numbers  TEXT[] NOT NULL DEFAULT '{}',
    expected_snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- the observation -- NOT an adjustment. Recording a count changes nothing about on-hand truth.
    counted_quantity         INTEGER,
    counted_serial_numbers   TEXT[] NOT NULL DEFAULT '{}',
    variance                 INTEGER,
    submitted_by             TEXT,
    submitted_at             TIMESTAMPTZ,

    -- the disposition -- ONLY this creates an inventory adjustment, and only on APPROVE.
    review_decision          ops_cycle_count_review_decision,
    reconciliation_reason    TEXT,
    reconciled_by            TEXT,
    reconciled_at            TIMESTAMPTZ,
    -- Present only when reconciliation staged ledger evidence (APPROVE with a non-zero variance).
    -- Points at THE transaction boundary this disposition committed with -- schema/design intent for
    -- the future reconcile command, proved here as a structural link rather than wired end to end.
    ledger_movement_id       TEXT REFERENCES inventory_movements(id),

    created_by               TEXT        NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by               TEXT        NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One line per Part per sheet -- mirrors the Firestore v2 model's `{sheetId}/lines/{partId}`.
    CONSTRAINT cycle_count_lines_one_per_part UNIQUE (tenant_id, sheet_id, part_id),
    CONSTRAINT cycle_count_line_submission_records_when CHECK (
        (status IN ('OPEN', 'CANCELLED')) OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
    ),
    CONSTRAINT cycle_count_line_review_records_when CHECK (
        (status NOT IN ('RECONCILED', 'REJECTED'))
        OR (review_decision IS NOT NULL AND reconciled_by IS NOT NULL AND reconciled_at IS NOT NULL)
    ),
    -- A rejection stages no adjustment -- the expected-quantity authority is left untouched, exactly
    -- as the existing Firestore command family already behaves.
    CONSTRAINT cycle_count_line_reject_stages_no_ledger CHECK (
        review_decision <> 'REJECT' OR ledger_movement_id IS NULL
    )
);

CREATE INDEX cycle_count_lines_by_sheet  ON cycle_count_lines (tenant_id, sheet_id);
CREATE INDEX cycle_count_lines_by_status ON cycle_count_lines (tenant_id, status);

-- Down Migration
SET search_path = eos_ops, public;

DROP SCHEMA IF EXISTS eos_ops CASCADE;
