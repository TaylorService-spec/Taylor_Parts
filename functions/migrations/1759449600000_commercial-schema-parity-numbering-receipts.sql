-- Up Migration
-- COMMERCIAL SCHEMA PARITY, NUMBERING AND COMMAND RECEIPTS -- wave C1 of the Commercial PostgreSQL migration.
--
-- ============================================================================
-- MIGRATION 022. Owner plan acceptance 2026-09-14 (blocker #2 = the Commercial domain PostgreSQL migration wave).
--
-- PostgreSQL gains the columns and child tables to represent every CURRENT governed Commercial business fact of
-- Opportunity, Sales Agreement and Sales Order, a concurrency-safe business-number counter, and the idempotency
-- receipt a future governed command layer (C2) records. NOTHING WRITES ANY OF IT YET: no command, no callable, no
-- Render operation and no client is changed, and Firestore remains Commercial authority until cutover (C6/C7).
--
-- STANDARD POSTGRESQL ONLY. Additive: no existing migration is edited, no existing column changes type or
-- nullability, no existing constraint is dropped, and no existing row is rewritten.
-- ============================================================================
--
-- ════════════════════ WHAT IS HERE, AND WHAT IS DELIBERATELY NOT ════════════════════
--
-- Every column below was verified against current main as a PERSISTED business fact, or as an external contract
-- fact the governed builders accept and the workspace displays. Deliberately ABSENT:
--
--   * DERIVABLE facts. Opportunity -> Sales Agreement / Sales Order backlinks and Sales Agreement -> Sales Order
--     are the child foreign keys (made one-to-one below). `sourceOpportunityNumber` on a Sales Order is the
--     Opportunity's immutable number through that key. Line `extendedMinor` and Agreement `subtotal`, `total` and
--     `balance` are computed from stored inputs. A line's `lineId` ("line-N") is its `line_number`.
--   * LEGACY DEFECTS and NEVER-PERSISTED fields: Opportunity `name` (read, written by nothing), `createdAtMillis`
--     (stripped before every write -- `created_at` is the truthful fact), `closedAtMillis` / `updatedAtMillis`
--     client clock copies (`closed_at` and `edit_version` replace them), Sales Order `operationalBlocked`,
--     `additionalWorkPending` and line `selectedSerialIds` (read, written by nothing).
--   * D2 EXECUTION FIELDS, deferred by Owner ruling until execution migrates separately: Sales Order line
--     `allocatedQty`, `fulfilledQty`, `billedQty`; `fulfillmentReadiness*`, `allocatedAt`, `serviceWorkOrderIds`.
--   * `accountablePersonSource` on the record: provenance is the append-only `accountability_handoffs.source`.
--   * Job Role (NOT IMPLEMENTED as PostgreSQL authority) and any Employee foreign key (deferred, #189 MI-lambda).
--
-- ════════════════════ EXISTING ROWS ════════════════════
--
-- Current nonprod holds identity-only commercial rows (the synthetic seed, via createCommercialRecord). Every new
-- business column is therefore NULLABLE and receives NO DEFAULT that would invent a stage, state, channel or price
-- for a row that never had one. Completeness ("a governed create supplies a stage") belongs to the C2 command layer
-- that owns creation. Where a value IS present, the vocabulary, quantity, money and tenant constraints below hold.
-- The single defaulted column is `edit_version` (1): a concurrency token, not a business fact.
--
-- ════════════════════ MONEY ════════════════════
--
-- Sales Agreement and Sales Order prices and charges are non-negative integer MINOR UNITS in the governed builders
-- (`minorUnits`), so they are BIGINT >= 0 here. Opportunity `expectedValue` is NOT minor units: the builder accepts
-- any finite number as an estimate. It is stored as exact NUMERIC and refuses NaN and infinities; converting it to
-- minor units would change a contract, not persist one.
--
-- ════════════════════ ACCOUNT FOREIGN KEY, NOT VALID ════════════════════
--
-- `eos_commercial.*.account_id` and `eos_crm.accounts.id` name the SAME canonical identity: the Firestore Account
-- document id, carried verbatim (migration 007, D-C1-4; `customerIdentity.requireCrmId` has no normalize path).
-- Migration 008 left `account_id` unconstrained because Account was not yet PostgreSQL authority; Owner ruling D1
-- makes it so before Commercial cutover. The composite key (tenant_id, account_id) is added NOT VALID: it governs
-- every row inserted or updated from now on, and asserts nothing about rows that predate it.

SET search_path = eos_commercial, public;

-- ════════════════════ vocabularies (mirrors of the governed lifecycle modules) ════════════════════

CREATE TYPE commercial_sales_channel AS ENUM ('NATIONAL_ACCOUNTS', 'RETAIL', 'STRATEGIC_ACCOUNTS');
CREATE TYPE opportunity_stage AS ENUM ('IDENTIFIED', 'QUALIFYING', 'SOLUTION', 'QUOTING', 'CUSTOMER_REVIEW', 'DECISION');
CREATE TYPE opportunity_outcome AS ENUM ('WON', 'LOST');
CREATE TYPE commercial_line_kind AS ENUM ('EQUIPMENT_MODEL', 'PART', 'SERVICE');
CREATE TYPE commercial_business_unit AS ENUM ('SERVICE', 'EQUIPMENT_SALES', 'PARTS', 'INSTALLATION');
CREATE TYPE sales_agreement_state AS ENUM ('DRAFT', 'ACCEPTED', 'DECLINED');
CREATE TYPE agreement_fulfillment_intent AS ENUM ('DELIVER', 'INSTALL', 'BOTH');
CREATE TYPE agreement_line_condition AS ENUM ('NEW', 'USED');
CREATE TYPE sales_order_state AS ENUM ('CONFIRMED', 'IN_FULFILLMENT', 'FULFILLED', 'CLOSED', 'CANCELLED');
CREATE TYPE commercial_number_series AS ENUM ('OPPORTUNITY', 'SALES_AGREEMENT', 'SALES_ORDER');

-- ════════════════════ tenant-scoped identity, for composite child keys ════════════════════

ALTER TABLE opportunities    ADD CONSTRAINT opportunities_tenant_scoped_identity    UNIQUE (tenant_id, id);
ALTER TABLE sales_agreements ADD CONSTRAINT sales_agreements_tenant_scoped_identity UNIQUE (tenant_id, id);
ALTER TABLE sales_orders     ADD CONSTRAINT sales_orders_tenant_scoped_identity     UNIQUE (tenant_id, id);

-- ════════════════════ Opportunity ════════════════════

ALTER TABLE opportunities
    ADD COLUMN sales_channel                    commercial_sales_channel,
    ADD COLUMN stage                            opportunity_stage,
    ADD COLUMN outcome                          opportunity_outcome,
    ADD COLUMN closed_at                        TIMESTAMPTZ,
    ADD COLUMN need                             TEXT,
    ADD COLUMN expected_value                   NUMERIC,
    ADD COLUMN expected_close_at                TIMESTAMPTZ,
    ADD COLUMN next_action                      TEXT,
    ADD COLUMN credited_salesperson_employee_id TEXT,
    ADD COLUMN edit_version                     BIGINT NOT NULL DEFAULT 1;

ALTER TABLE opportunities
    ADD CONSTRAINT opportunities_closed_exactly_when_decided CHECK ((outcome IS NULL) = (closed_at IS NULL)),
    ADD CONSTRAINT opportunities_expected_value_finite
        CHECK (expected_value IS NULL OR expected_value NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
    ADD CONSTRAINT opportunities_need_not_blank CHECK (need IS NULL OR btrim(need) <> ''),
    ADD CONSTRAINT opportunities_next_action_not_blank CHECK (next_action IS NULL OR btrim(next_action) <> ''),
    ADD CONSTRAINT opportunities_credited_salesperson_shape CHECK (credited_salesperson_employee_id IS NULL
        OR (credited_salesperson_employee_id <> '' AND btrim(credited_salesperson_employee_id) = credited_salesperson_employee_id
            AND position('/' in credited_salesperson_employee_id) = 0)),
    ADD CONSTRAINT opportunities_edit_version_positive CHECK (edit_version > 0),
    ADD CONSTRAINT opportunities_account_fk FOREIGN KEY (tenant_id, account_id)
        REFERENCES eos_crm.accounts (tenant_id, id) NOT VALID;

CREATE TABLE opportunity_lines (
    tenant_id      TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    line_number    INTEGER NOT NULL CHECK (line_number > 0),
    kind           commercial_line_kind NOT NULL,
    ref            TEXT NOT NULL CHECK (ref <> '' AND btrim(ref) = ref),
    qty            INTEGER NOT NULL CHECK (qty > 0),
    PRIMARY KEY (tenant_id, opportunity_id, line_number),
    FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities (tenant_id, id)
);

-- ════════════════════ Sales Agreement ════════════════════

ALTER TABLE sales_agreements
    ADD COLUMN state                            sales_agreement_state,
    ADD COLUMN currency                         TEXT,
    ADD COLUMN credited_salesperson_employee_id TEXT,
    ADD COLUMN location_id                      TEXT,
    ADD COLUMN customer_po                      TEXT,
    ADD COLUMN is_lease                         BOOLEAN,
    ADD COLUMN fulfillment_intent               agreement_fulfillment_intent,
    ADD COLUMN shipping_instructions            TEXT,
    ADD COLUMN ship_via                         TEXT,
    ADD COLUMN special_instructions             TEXT,
    ADD COLUMN shipping_minor                   BIGINT,
    ADD COLUMN install_charge_minor             BIGINT,
    ADD COLUMN tax_minor                        BIGINT,
    ADD COLUMN down_payment_minor               BIGINT,
    ADD COLUMN trade_in_minor                   BIGINT,
    ADD COLUMN accepted_at                      TIMESTAMPTZ,
    ADD COLUMN accepted_by                      TEXT;

ALTER TABLE sales_agreements
    ADD CONSTRAINT sales_agreements_currency_usd CHECK (currency IS NULL OR currency = 'USD'),
    ADD CONSTRAINT sales_agreements_charges_minor_units CHECK (
        (shipping_minor IS NULL OR shipping_minor >= 0) AND (install_charge_minor IS NULL OR install_charge_minor >= 0)
        AND (tax_minor IS NULL OR tax_minor >= 0) AND (down_payment_minor IS NULL OR down_payment_minor >= 0)
        AND (trade_in_minor IS NULL OR trade_in_minor >= 0)),
    ADD CONSTRAINT sales_agreements_accepted_exactly_when_accepted
        CHECK ((state = 'ACCEPTED') = (accepted_at IS NOT NULL AND accepted_by IS NOT NULL)),
    ADD CONSTRAINT sales_agreements_credited_salesperson_shape CHECK (credited_salesperson_employee_id IS NULL
        OR (credited_salesperson_employee_id <> '' AND btrim(credited_salesperson_employee_id) = credited_salesperson_employee_id
            AND position('/' in credited_salesperson_employee_id) = 0)),
    ADD CONSTRAINT sales_agreements_location_shape CHECK (location_id IS NULL OR (location_id <> '' AND btrim(location_id) = location_id)),
    -- One Agreement per Opportunity (enforced in-transaction by createSalesAgreement today). This is also what makes
    -- the Opportunity -> Agreement backlink DERIVABLE rather than stored.
    ADD CONSTRAINT sales_agreements_one_per_opportunity UNIQUE (tenant_id, opportunity_id),
    ADD CONSTRAINT sales_agreements_account_fk FOREIGN KEY (tenant_id, account_id)
        REFERENCES eos_crm.accounts (tenant_id, id) NOT VALID;

CREATE TABLE sales_agreement_lines (
    tenant_id              TEXT NOT NULL,
    sales_agreement_id     TEXT NOT NULL,
    line_number            INTEGER NOT NULL CHECK (line_number > 0),
    kind                   commercial_line_kind NOT NULL,
    ref                    TEXT NOT NULL CHECK (ref <> '' AND btrim(ref) = ref),
    business_unit          commercial_business_unit NOT NULL,
    quantity               INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_minor       BIGINT CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
    condition              agreement_line_condition,
    warranty               TEXT,
    estimated_arrival_at   TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, sales_agreement_id, line_number),
    FOREIGN KEY (tenant_id, sales_agreement_id) REFERENCES sales_agreements (tenant_id, id)
);

-- ════════════════════ Sales Order ════════════════════

ALTER TABLE sales_orders
    ADD COLUMN state                            sales_order_state,
    ADD COLUMN sales_channel                    commercial_sales_channel,
    ADD COLUMN currency                         TEXT,
    ADD COLUMN credited_salesperson_employee_id TEXT,
    ADD COLUMN booked_at                        TIMESTAMPTZ,
    ADD COLUMN location_id                      TEXT,
    ADD COLUMN customer_po                      TEXT,
    ADD COLUMN notes                            TEXT;

ALTER TABLE sales_orders
    ADD CONSTRAINT sales_orders_currency_usd CHECK (currency IS NULL OR currency = 'USD'),
    ADD CONSTRAINT sales_orders_credited_salesperson_shape CHECK (credited_salesperson_employee_id IS NULL
        OR (credited_salesperson_employee_id <> '' AND btrim(credited_salesperson_employee_id) = credited_salesperson_employee_id
            AND position('/' in credited_salesperson_employee_id) = 0)),
    ADD CONSTRAINT sales_orders_location_shape CHECK (location_id IS NULL OR (location_id <> '' AND btrim(location_id) = location_id)),
    -- One Sales Order per source Opportunity and per source Agreement (enforced in-transaction by every create path
    -- today), which makes both backlinks DERIVABLE.
    ADD CONSTRAINT sales_orders_one_per_opportunity UNIQUE (tenant_id, opportunity_id),
    ADD CONSTRAINT sales_orders_one_per_agreement UNIQUE (tenant_id, sales_agreement_id),
    ADD CONSTRAINT sales_orders_account_fk FOREIGN KEY (tenant_id, account_id)
        REFERENCES eos_crm.accounts (tenant_id, id) NOT VALID;

-- Commercial line facts only. allocated/fulfilled/billed quantities are D2 execution fields and are NOT here.
CREATE TABLE sales_order_lines (
    tenant_id         TEXT NOT NULL,
    sales_order_id    TEXT NOT NULL,
    line_number       INTEGER NOT NULL CHECK (line_number > 0),
    kind              commercial_line_kind NOT NULL,
    ref               TEXT NOT NULL CHECK (ref <> '' AND btrim(ref) = ref),
    business_unit     commercial_business_unit NOT NULL,
    ordered_qty       INTEGER NOT NULL CHECK (ordered_qty > 0),
    unit_price_minor  BIGINT CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
    PRIMARY KEY (tenant_id, sales_order_id, line_number),
    FOREIGN KEY (tenant_id, sales_order_id) REFERENCES sales_orders (tenant_id, id)
);

-- ════════════════════ business numbering ════════════════════
--
-- One row per (tenant, series, UTC year). Allocation is a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING in
-- the CALLER's transaction (functions/src/eosCommercial/commercialNumbering.ts): the row lock serializes concurrent
-- allocators, and a rolled-back transaction rolls its increment back with it. No SELECT MAX, no Firestore counter.

CREATE TABLE number_counters (
    tenant_id   TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    series      commercial_number_series NOT NULL,
    year        INTEGER NOT NULL CHECK (year BETWEEN 1970 AND 9999),
    last_value  BIGINT NOT NULL CHECK (last_value > 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, series, year)
);

-- ════════════════════ command receipts: idempotency ONLY ════════════════════
--
-- Owner ruling: idempotency authority, replay/result receipt and duplicate-command prevention -- and NOTHING ELSE.
-- It is not Commercial audit and is not ownership or accountability history. One committed receipt per
-- (tenant, principal, operation, key): a second command with the same key replays `result` instead of executing.
-- The raw key is never stored, only its SHA-256; no token or credential is recorded.

CREATE TABLE command_receipts (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL,
    principal_id          TEXT NOT NULL,
    operation             TEXT NOT NULL CHECK (operation ~ '^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$'),
    idempotency_key_hash  TEXT NOT NULL CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
    target_family         TEXT CHECK (target_family IS NULL OR target_family IN ('opportunity', 'salesAgreement', 'salesOrder')),
    target_id             TEXT CHECK (target_id IS NULL OR (target_id <> '' AND btrim(target_id) = target_id)),
    result                JSONB NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT command_receipts_target_complete CHECK ((target_family IS NULL) = (target_id IS NULL)),
    CONSTRAINT command_receipts_one_per_key UNIQUE (tenant_id, principal_id, operation, idempotency_key_hash),
    CONSTRAINT command_receipts_member_fk FOREIGN KEY (tenant_id, principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id)
);

-- Down Migration
SET search_path = eos_commercial, public;

-- REFUSE WHILE ANY C1 FACT IS RECORDED: dropping these columns or tables would destroy Commercial business data.
DO $$
DECLARE
    recorded BIGINT;
BEGIN
    SELECT (SELECT count(*) FROM opportunity_lines) + (SELECT count(*) FROM sales_agreement_lines)
         + (SELECT count(*) FROM sales_order_lines) + (SELECT count(*) FROM number_counters)
         + (SELECT count(*) FROM command_receipts)
         + (SELECT count(*) FROM opportunities WHERE stage IS NOT NULL OR sales_channel IS NOT NULL)
         + (SELECT count(*) FROM sales_agreements WHERE state IS NOT NULL)
         + (SELECT count(*) FROM sales_orders WHERE state IS NOT NULL)
      INTO recorded;
    IF recorded > 0 THEN
        RAISE EXCEPTION 'migration 022 refuses to drop Commercial schema parity: % rows carry C1 facts', recorded
            USING HINT = 'Reversing this migration destroys Commercial business data. Export it deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP TABLE IF EXISTS command_receipts;
DROP TABLE IF EXISTS number_counters;
DROP TABLE IF EXISTS sales_order_lines;
DROP TABLE IF EXISTS sales_agreement_lines;
DROP TABLE IF EXISTS opportunity_lines;

ALTER TABLE sales_orders
    DROP CONSTRAINT IF EXISTS sales_orders_account_fk, DROP CONSTRAINT IF EXISTS sales_orders_one_per_agreement,
    DROP CONSTRAINT IF EXISTS sales_orders_one_per_opportunity, DROP CONSTRAINT IF EXISTS sales_orders_location_shape,
    DROP CONSTRAINT IF EXISTS sales_orders_credited_salesperson_shape, DROP CONSTRAINT IF EXISTS sales_orders_currency_usd,
    DROP COLUMN IF EXISTS notes, DROP COLUMN IF EXISTS customer_po, DROP COLUMN IF EXISTS location_id,
    DROP COLUMN IF EXISTS booked_at, DROP COLUMN IF EXISTS credited_salesperson_employee_id, DROP COLUMN IF EXISTS currency,
    DROP COLUMN IF EXISTS sales_channel, DROP COLUMN IF EXISTS state;

ALTER TABLE sales_agreements
    DROP CONSTRAINT IF EXISTS sales_agreements_account_fk, DROP CONSTRAINT IF EXISTS sales_agreements_one_per_opportunity,
    DROP CONSTRAINT IF EXISTS sales_agreements_location_shape, DROP CONSTRAINT IF EXISTS sales_agreements_credited_salesperson_shape,
    DROP CONSTRAINT IF EXISTS sales_agreements_accepted_exactly_when_accepted, DROP CONSTRAINT IF EXISTS sales_agreements_charges_minor_units,
    DROP CONSTRAINT IF EXISTS sales_agreements_currency_usd,
    DROP COLUMN IF EXISTS accepted_by, DROP COLUMN IF EXISTS accepted_at, DROP COLUMN IF EXISTS trade_in_minor,
    DROP COLUMN IF EXISTS down_payment_minor, DROP COLUMN IF EXISTS tax_minor, DROP COLUMN IF EXISTS install_charge_minor,
    DROP COLUMN IF EXISTS shipping_minor, DROP COLUMN IF EXISTS special_instructions, DROP COLUMN IF EXISTS ship_via,
    DROP COLUMN IF EXISTS shipping_instructions, DROP COLUMN IF EXISTS fulfillment_intent, DROP COLUMN IF EXISTS is_lease,
    DROP COLUMN IF EXISTS customer_po, DROP COLUMN IF EXISTS location_id, DROP COLUMN IF EXISTS credited_salesperson_employee_id,
    DROP COLUMN IF EXISTS currency, DROP COLUMN IF EXISTS state;

ALTER TABLE opportunities
    DROP CONSTRAINT IF EXISTS opportunities_account_fk, DROP CONSTRAINT IF EXISTS opportunities_edit_version_positive,
    DROP CONSTRAINT IF EXISTS opportunities_credited_salesperson_shape, DROP CONSTRAINT IF EXISTS opportunities_next_action_not_blank,
    DROP CONSTRAINT IF EXISTS opportunities_need_not_blank, DROP CONSTRAINT IF EXISTS opportunities_expected_value_finite,
    DROP CONSTRAINT IF EXISTS opportunities_closed_exactly_when_decided,
    DROP COLUMN IF EXISTS edit_version, DROP COLUMN IF EXISTS credited_salesperson_employee_id, DROP COLUMN IF EXISTS next_action,
    DROP COLUMN IF EXISTS expected_close_at, DROP COLUMN IF EXISTS expected_value, DROP COLUMN IF EXISTS need,
    DROP COLUMN IF EXISTS closed_at, DROP COLUMN IF EXISTS outcome, DROP COLUMN IF EXISTS stage, DROP COLUMN IF EXISTS sales_channel;

ALTER TABLE sales_orders     DROP CONSTRAINT IF EXISTS sales_orders_tenant_scoped_identity;
ALTER TABLE sales_agreements DROP CONSTRAINT IF EXISTS sales_agreements_tenant_scoped_identity;
ALTER TABLE opportunities    DROP CONSTRAINT IF EXISTS opportunities_tenant_scoped_identity;

DROP TYPE IF EXISTS commercial_number_series;
DROP TYPE IF EXISTS sales_order_state;
DROP TYPE IF EXISTS agreement_line_condition;
DROP TYPE IF EXISTS agreement_fulfillment_intent;
DROP TYPE IF EXISTS sales_agreement_state;
DROP TYPE IF EXISTS commercial_business_unit;
DROP TYPE IF EXISTS commercial_line_kind;
DROP TYPE IF EXISTS opportunity_outcome;
DROP TYPE IF EXISTS opportunity_stage;
DROP TYPE IF EXISTS commercial_sales_channel;
