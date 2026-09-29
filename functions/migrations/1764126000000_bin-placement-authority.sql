-- Up Migration
-- BIN PLACEMENT ON POSTGRESQL -- the SMALLEST representation of the EXISTING put-away / placement record
-- (Controller ruling DQ-038, 2026-09-28; the Firestore shape is inventoryLocation/putAwayCommand.ts
-- buildPlacementEntries, collection `bin_placements`). Lane L3. Schema only: no row is written, nothing is granted.
--
-- WHAT A PLACEMENT IS -- unchanged from the Firestore record, and NOTHING MORE:
--   * an append-only EVENT, "N units of part P were stowed in bin B of warehouse W", never a balance (Decision
--     #116: a bin is a descriptive sub-location; the warehouse is the custody authority, so a placement moves no
--     stock and touches no ledger);
--   * one row per SERIAL (quantity 1), one row for a quantity stow;
--   * the same identity: id plc_<idempotencyKey>__<serial|part>, so a retry is recognised, never doubled;
--   * pickedForWorkOrderId (a pick is a placement with a reason) and an operator note, NULL rather than absent.
--
-- THE PLACEMENT BELONGS TO A GOVERNED WAREHOUSE. (tenant, warehouse) and (tenant, bin) are foreign keys, and a
-- trigger refuses a row whose bin is not a bin OF THAT warehouse -- the relationship is not a client pairing.
-- No operating company is stored or inferred: the warehouse already states its own.
--
-- HISTORY IS PRESERVED: append-only (no UPDATE, no DELETE); the down migration refuses while any placement exists.

SET search_path = eos_ops, public;

CREATE TABLE bin_placements (
    id                        TEXT        NOT NULL,
    tenant_id                 TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    warehouse_id              TEXT        NOT NULL,
    bin_id                    TEXT        NOT NULL,
    -- The bin's code AT THE TIME of the stow, as the Firestore record kept it (a code can later be superseded).
    bin_code                  TEXT        NOT NULL,
    part_id                   TEXT        NOT NULL,
    serial_number             TEXT,
    quantity                  INTEGER     NOT NULL,
    idempotency_key           TEXT        NOT NULL,
    picked_for_work_order_id  TEXT,
    note                      TEXT,
    placed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    placed_by                 TEXT        NOT NULL,
    CONSTRAINT bin_placements_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT bin_placements_warehouse FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id),
    CONSTRAINT bin_placements_bin FOREIGN KEY (tenant_id, bin_id) REFERENCES bins (tenant_id, id),
    CONSTRAINT bin_placements_quantity_positive CHECK (quantity > 0),
    CONSTRAINT bin_placements_serial_is_one_unit CHECK (serial_number IS NULL OR quantity = 1),
    CONSTRAINT bin_placements_id_shape CHECK (id LIKE 'plc\_%\_\_%'),
    CONSTRAINT bin_placements_note_bounded CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 500)),
    CONSTRAINT bin_placements_pick_stated CHECK (picked_for_work_order_id IS NULL OR btrim(picked_for_work_order_id) <> '')
);

CREATE INDEX bin_placements_by_bin    ON bin_placements (tenant_id, bin_id, placed_at DESC);
CREATE INDEX bin_placements_by_part   ON bin_placements (tenant_id, part_id, placed_at DESC);
CREATE INDEX bin_placements_by_serial ON bin_placements (tenant_id, part_id, serial_number) WHERE serial_number IS NOT NULL;

-- The bin must be a bin OF the stated warehouse (ADR-014 Model A: a bin's parent is immutable).
CREATE FUNCTION bin_placement_bin_in_warehouse() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_parent TEXT;
BEGIN
    SELECT warehouse_id INTO v_parent FROM eos_ops.bins WHERE tenant_id = NEW.tenant_id AND id = NEW.bin_id;
    IF v_parent IS DISTINCT FROM NEW.warehouse_id THEN
        RAISE EXCEPTION 'BIN_PLACEMENT_WAREHOUSE_MISMATCH: bin % belongs to warehouse %, not %', NEW.bin_id, v_parent, NEW.warehouse_id;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER bin_placement_bin_in_warehouse
    BEFORE INSERT ON bin_placements
    FOR EACH ROW EXECUTE FUNCTION bin_placement_bin_in_warehouse();

-- Placements are events: never rewritten, never removed.
CREATE FUNCTION bin_placement_append_only() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'BIN_PLACEMENT_APPEND_ONLY: % would rewrite placement history', TG_OP;
END
$$;
CREATE TRIGGER bin_placement_append_only
    BEFORE UPDATE OR DELETE ON bin_placements
    FOR EACH ROW EXECUTE FUNCTION bin_placement_append_only();

-- Down Migration
SET search_path = eos_ops, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.bin_placements;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'BIN_PLACEMENT_AUTHORITY: refuses to reverse -- % placement record(s) are history', v_n;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS bin_placement_append_only ON bin_placements;
DROP TRIGGER IF EXISTS bin_placement_bin_in_warehouse ON bin_placements;
DROP FUNCTION IF EXISTS bin_placement_append_only();
DROP FUNCTION IF EXISTS bin_placement_bin_in_warehouse();
DROP TABLE IF EXISTS bin_placements;
