-- Up Migration
-- TRANSFER ON EOS -- the two storage facts the EXISTING Transfer lifecycle needs in PostgreSQL that eos_ops does not
-- yet hold (Controller rulings DQ-024 / DQ-026 / L0 shared-file release, 2026-09-28). Lane L3. Schema only: no row is
-- written, no capability is registered, nothing is granted. Transfer stays HELD behind its activation gate
-- (inventoryTransfer/transferWriterState.ts).
--
-- 1. A SERIAL UNIT IN TRANSIT. The Firestore command (transferOrderCommand.ts) flips a dispatched unit's
--    inventoryState to IN_TRANSIT -- a STATE change, not a location change -- so it stops being available at the
--    origin while it travels, and only receive moves its location. ops_serial_status had no such value, so the EOS
--    lifecycle could not say it; this adds exactly that value and nothing else.
-- 2. TO-YYYY-###### NUMBERING. The Firestore create allocates a Transfer Order number per UTC year
--    (transferOrderNumbering.ts). PostgreSQL gets its own counter, the receiving_number_counters shape exactly,
--    independent of every other family's sequence.

SET search_path = eos_ops, public;

ALTER TYPE ops_serial_status ADD VALUE IF NOT EXISTS 'IN_TRANSIT';

CREATE TABLE transfer_number_counters (
    tenant_id  TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    year       INTEGER     NOT NULL CHECK (year BETWEEN 1970 AND 9999),
    last_value BIGINT      NOT NULL CHECK (last_value > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, year)
);

COMMENT ON TABLE transfer_number_counters IS
    'TO-YYYY-###### allocation, per tenant per UTC year. Independent of the Transfer Order id and of every other numbering family. Allocated inside the create transaction, only for a genuine new transfer, never on replay.';

-- One number, one transfer, per tenant.
CREATE UNIQUE INDEX transfer_orders_number_unique
    ON transfer_orders (tenant_id, transfer_order_number)
    WHERE transfer_order_number IS NOT NULL;

-- Down Migration
SET search_path = eos_ops, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.serialized_custody WHERE status::text = 'IN_TRANSIT';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'TRANSFER_EOS_LIFECYCLE_SUPPORT: refuses to reverse -- % serialized unit(s) are IN_TRANSIT', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.transfer_number_counters;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'TRANSFER_EOS_LIFECYCLE_SUPPORT: refuses to reverse -- % Transfer number counter(s) have allocated numbers', v_n;
    END IF;
END
$$;

DROP INDEX IF EXISTS transfer_orders_number_unique;
DROP TABLE IF EXISTS transfer_number_counters;
-- The IN_TRANSIT enum value is LEFT IN PLACE, unused (checked above): PostgreSQL cannot drop an enum value without
-- rebuilding the type under every dependent constraint, and an unused value is inert. A re-run of the up migration
-- is idempotent (ADD VALUE IF NOT EXISTS).
