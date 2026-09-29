-- Up Migration
-- THE POSTGRESQL RECEIVING AUTHORITY'S MISSING FACTS -- Reorder Receiving Owner Rulings R2/R3.
--
-- ============================================================================
-- MIGRATION 040. Receipt BUSINESS TIME, receipt REQUEST IDENTITY, Receiving's OWN reference-number
-- allocator, and the FINANCIAL acquisition-cost fact.
-- ============================================================================
--
-- `eos_ops.receiving_orders`/`receiving_order_lines` already hold a receipt. What they could not
-- hold is everything the Firestore receiving command records AROUND one, and a receipt without
-- those is not a replacement for it:
--
--   business time       the instant the goods were received, as opposed to the instant the row was
--                       written. Every downstream fact -- the inventory movement, the cost evidence,
--                       the Reorder closeout -- must carry the SAME instant, and a replay must
--                       return the original rather than acquire a new one.
--   request identity    the receipt's own fingerprint, so a replayed key carrying a DIFFERENT
--                       payload conflicts instead of silently returning someone else's receipt.
--   reference number    RO-YYYY-###### allocated transactionally, by RECEIVING's own counter.
--   acquisition cost    the governed monetary evidence of what the stock cost to acquire.
--
-- ════════════════════ WHY RECEIVING GETS ITS OWN COUNTER ════════════════════
--
-- `eos_commercial.number_counters` exists and could be widened with an 'RO' series. That was
-- refused. Its series enum is `commercial_number_series`, so reusing it would make COMMERCIAL the
-- authority for an OPERATIONS reference number: the Commercial slice would own the enum every
-- Receiving number is drawn from, and a Commercial migration could renumber or retire it. The
-- counter here is small, owned by eos_ops, and keyed by nothing but the tenant and the UTC year.
--
-- Duplicate allocation under concurrency is prevented by the PRIMARY KEY plus the row lock an
-- `INSERT ... ON CONFLICT DO UPDATE` takes: two concurrent receipts serialize on the counter row,
-- and the second reads the first's committed value. `receiving_orders_number_unique` is the
-- independent structural proof -- even a caller that bypassed the allocator could not post the
-- same number twice.

SET search_path = eos_ops, public;

-- ============================ receipt business time ============================
--
-- NULLABLE, BACKFILLED, THEN NOT NULL. Existing receipts have no separately recorded business time;
-- `created_at` is the only instant they carry, so it is the truthful answer for them rather than an
-- invented one. New receipts establish `received_at` explicitly and once.
ALTER TABLE receiving_orders ADD COLUMN received_at TIMESTAMPTZ;
UPDATE receiving_orders SET received_at = created_at WHERE received_at IS NULL;
ALTER TABLE receiving_orders ALTER COLUMN received_at SET NOT NULL;

COMMENT ON COLUMN receiving_orders.received_at IS
    'The governed BUSINESS EVENT time of the receipt: when the goods arrived. inventory_movements.occurred_at, the acquisition-cost fact and the Reorder closeout all carry this same instant. created_at remains persistence time. Established once; a replay returns the original.';

-- ============================ receipt request identity ============================
--
-- The fingerprint of the REQUEST this receipt was built from. `UNIQUE (tenant_id, idempotency_key)`
-- already makes one key one receipt; this is what decides whether a second arrival of that key is a
-- REPLAY (same payload) or a CONFLICT (different payload) -- the distinction the Firestore authority
-- draws in `stageReceivingOrderValue`, preserved here.
--
-- NULLABLE for the same reason as above, and it FAILS CLOSED: a receipt recorded before this column
-- existed cannot prove payload equality, so a key that resolves to one is refused as a conflict
-- rather than replayed on an assumption.
ALTER TABLE receiving_orders ADD COLUMN request_fingerprint TEXT;
ALTER TABLE receiving_orders
    ADD CONSTRAINT receiving_order_fingerprint_shape
        CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{16}$');

-- One number, one receipt, per tenant. The allocator is the normal path; this is the structure that
-- holds whether or not the allocator was used.
CREATE UNIQUE INDEX receiving_orders_number_unique
    ON receiving_orders (tenant_id, receiving_order_number)
    WHERE receiving_order_number IS NOT NULL;

-- ============================ receiving's own number counter ============================

CREATE TABLE receiving_number_counters (
    tenant_id  TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    year       INTEGER     NOT NULL CHECK (year BETWEEN 1970 AND 9999),
    last_value BIGINT      NOT NULL CHECK (last_value > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, year)
);

COMMENT ON TABLE receiving_number_counters IS
    'RO-YYYY-###### allocation, per tenant per UTC year. Independent of the Receiving Order id, of Work Order / Transfer / Purchase Order numbering, and of eos_commercial.number_counters. Allocated inside the receipt transaction, only for a genuine new receipt, never on replay.';

-- ============================ the acquisition-cost fact ============================

CREATE SCHEMA IF NOT EXISTS eos_finance;
SET search_path = eos_finance, public;

CREATE TYPE finance_acquisition_cost_basis AS ENUM ('PURCHASE_ORDER_LINE_PRICE');

-- ONE IMMUTABLE FACT PER RECEIPT LINE, for the quantity received NOW, at the price governing THIS
-- receipt. A partial receipt needs no rule of its own: receiving 4 of 10 records evidence for 4, and
-- the remaining 6 record their own fact later against whatever price governs then.
--
-- NO PRICE MEANS UNKNOWN, NEVER ZERO. A line with no governed price produces NO ROW. The absence of
-- a row is how "the cost is not known" is said. A zero-cost row would read as "this was free" and
-- would silently inflate every margin derived from it, which is why the writer refuses to create one
-- and why nothing here defaults a price.
CREATE TABLE inventory_acquisition_costs (
    id                         TEXT PRIMARY KEY,
    tenant_id                  TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    cost_basis                 finance_acquisition_cost_basis NOT NULL,

    -- THE GOVERNED BUSINESS COMPANY, FROZEN AT RECEIPT TIME (Owner Ruling R3).
    --
    -- The company ID, never the operational company KEY. The purchase order carries the key; this
    -- fact carries the id the key was BOUND to, resolved through
    -- eos_policy.tenant_operating_company_keys in the receipt transaction. The two are different
    -- vocabularies and are never assumed equal by string comparison. A key rebound or retired later
    -- does not rewrite history, because the id was resolved and stored once, here.
    operating_company_id       TEXT NOT NULL
        CONSTRAINT acquisition_cost_company_id_shape CHECK (operating_company_id ~ '^[a-z][a-z0-9_-]{1,62}$'),

    -- Exact lineage. Every one of these is required: a cost with no traceable source is not evidence.
    purchase_order_id          TEXT NOT NULL CHECK (btrim(purchase_order_id) <> ''),
    purchase_order_line_id     TEXT NOT NULL CHECK (btrim(purchase_order_line_id) <> ''),
    purchase_order_source_type TEXT NOT NULL
        CHECK (purchase_order_source_type IN ('REORDER_PURCHASE_ORDER', 'PURCHASE_ORDER')),
    -- The canonical purchase order's concurrency version, when the source has one. The legacy chain
    -- has no revisions, so NULL there is the true statement rather than a missing value.
    purchase_order_version     INTEGER CHECK (purchase_order_version IS NULL OR purchase_order_version >= 0),
    supplier_id                TEXT,
    supplier_name              TEXT,
    part_id                    TEXT NOT NULL CHECK (btrim(part_id) <> ''),

    received_quantity          INTEGER NOT NULL CHECK (received_quantity > 0),
    -- Integer MINOR UNITS with an explicit currency. Fractional money is refused, never rounded.
    -- Zero is a legal governed PRICE (a free-of-charge line someone priced at zero on purpose); it is
    -- the ABSENCE of a fact, not a zero in one, that means unknown.
    unit_price_minor           BIGINT  NOT NULL CHECK (unit_price_minor >= 0),
    extended_cost_minor        BIGINT  NOT NULL CHECK (extended_cost_minor >= 0),
    currency                   TEXT    NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- The stamp the SOURCE purchase order carries, copied verbatim -- the version of the price
    -- authority the price was governed by. NULL where the purchase order predates that authority:
    -- its price is still a fact and still produces this evidence, and claiming a stamp it never had
    -- would be worse than recording that it has none.
    price_authority_version    INTEGER CHECK (price_authority_version IS NULL OR price_authority_version >= 1),

    receiving_id               TEXT NOT NULL CHECK (btrim(receiving_id) <> ''),
    receiving_line_id          TEXT NOT NULL CHECK (btrim(receiving_line_id) <> ''),
    -- The receipt's own business event time, never a write clock.
    received_at                TIMESTAMPTZ NOT NULL,
    receiving_location_type    TEXT NOT NULL CHECK (receiving_location_type IN ('WAREHOUSE', 'BIN', 'MOBILE')),
    receiving_location_id      TEXT NOT NULL CHECK (btrim(receiving_location_id) <> ''),

    created_by                 TEXT        NOT NULL CHECK (btrim(created_by) <> ''),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- IDEMPOTENT BY IDENTITY, not by a check the writer must remember to perform. A duplicated cost
    -- event is a financial defect, so the shape prevents it.
    CONSTRAINT acquisition_cost_one_per_receipt_line UNIQUE (tenant_id, receiving_id, receiving_line_id),
    -- The extended cost is DERIVED and is proved here, so a writer cannot post a total that disagrees
    -- with the unit price and quantity sitting beside it in the same row.
    CONSTRAINT acquisition_cost_extended_is_exact
        CHECK (extended_cost_minor = unit_price_minor * received_quantity),
    CONSTRAINT acquisition_cost_supplier_name_present
        CHECK (supplier_name IS NULL OR btrim(supplier_name) <> '')
);

CREATE INDEX inventory_acquisition_costs_by_part
    ON inventory_acquisition_costs (tenant_id, part_id, received_at);
CREATE INDEX inventory_acquisition_costs_by_company
    ON inventory_acquisition_costs (tenant_id, operating_company_id, received_at);
CREATE INDEX inventory_acquisition_costs_by_source
    ON inventory_acquisition_costs (tenant_id, purchase_order_source_type, purchase_order_id);

-- APPEND-ONLY, the same posture `payments` and `payment_applications` already hold in this schema.
-- A cost fact is corrected by a NEW fact against a NEW receipt, never by editing the evidence of a
-- receipt that already happened.
CREATE TRIGGER inventory_acquisition_costs_append_only
    BEFORE UPDATE OR DELETE ON inventory_acquisition_costs
    FOR EACH ROW EXECUTE FUNCTION refuse_financial_fact_mutation();

-- Down Migration
SET search_path = eos_finance, public;

DROP TRIGGER IF EXISTS inventory_acquisition_costs_append_only ON inventory_acquisition_costs;
DROP TABLE IF EXISTS inventory_acquisition_costs;
DROP TYPE IF EXISTS finance_acquisition_cost_basis;

SET search_path = eos_ops, public;

DROP TABLE IF EXISTS receiving_number_counters;
DROP INDEX IF EXISTS receiving_orders_number_unique;
ALTER TABLE receiving_orders DROP CONSTRAINT IF EXISTS receiving_order_fingerprint_shape;
ALTER TABLE receiving_orders DROP COLUMN IF EXISTS request_fingerprint;

-- Reversing the business time DISCARDS it. Where a receipt's arrival instant differs from the
-- instant its row was written, that difference is not recoverable from anything else on the row, so
-- the reversal refuses rather than silently collapsing two distinct facts into one.
DO $$
DECLARE
    divergent BIGINT;
BEGIN
    SELECT count(*) INTO divergent FROM eos_ops.receiving_orders WHERE received_at <> created_at;
    IF divergent > 0 THEN
        RAISE EXCEPTION
            'migration 040 cannot be reversed: % receipts record a business time that differs from their write time',
            divergent
            USING HINT = 'Dropping received_at would discard the only record of when those goods actually arrived. Resolve these rows first.';
    END IF;
END
$$;

ALTER TABLE receiving_orders DROP COLUMN IF EXISTS received_at;
