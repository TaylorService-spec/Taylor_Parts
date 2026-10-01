-- Up Migration
-- EQUIPMENT ACTIVATION (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01: OD-1 .. OD-5).
-- REGISTERS TWO CAPABILITIES, GRANTS THEM TO NOBODY, versions the register and adds its event history.
--
-- 1. equipment.record.read / equipment.record.manage -- the Equipment REGISTER authority (OD-3). PostgreSQL-native keys,
--    deliberately ABSENT from the in-repo PERMISSION_CATALOG, so no catalog reconcile can default-grant them to the
--    compatibility admin Role. READ is contextual: a global holder reads the tenant's register; a holder through a
--    salesChannel-scoped assignment reads only Equipment whose Account has commercial work in an admitted channel. The
--    Technician holds neither -- the Equipment of an ASSIGNED Work Order is read through the Work Order relationship.
--    MANAGE creates and updates register records; it never installs (equipment.install) and never moves custody.
--    Holders are an Administration execution packet (equipmentActivationDelta.ts), never this migration.
--
-- 2. eos_ops.equipment.version -- the optimistic-concurrency token an update states, so two edits cannot both win.
--
-- 3. eos_ops.equipment_events -- the SMALLEST durable, append-only Equipment history this journey needs: CREATED,
--    UPDATED, INSTALLED, with who / when / company / customer / site / Work Order / serial / ledger movement / source /
--    reason / idempotency. Not an event platform: one table, one Equipment, three kinds.

SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key IN ('equipment.record.read', 'equipment.record.manage')
        OR (object_key = 'equipment' AND action_key IN ('read', 'manage'));
    IF v_n > 0 THEN
        RAISE EXCEPTION 'EQUIPMENT_REGISTER_AUTHORITY: equipment.record.read / equipment.record.manage is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_equipment_record_read', 'equipment.record.read',
     'Read the customer Equipment register: list, search (name, serial, asset tag), by customer and by site, one record with its installed unit and history. Held globally it is the operational register; held through a salesChannel-scoped assignment it admits only Equipment whose customer has commercial work in that channel. Writes nothing. Granted only through Administration.',
     'equipment', 'read', 'READ', 'Read Equipment'),
    ('cap_equipment_record_manage', 'equipment.record.manage',
     'Create and update customer Equipment register records (name, model, serial, asset tag, dates, notes, status). Customer, site and operating company are fixed at create. Does NOT install a serialized unit (equipment.install), move inventory custody or read the register by itself. Granted only through Administration.',
     'equipment', 'manage', 'EDIT', 'Manage Equipment')
ON CONFLICT (key) DO NOTHING;

SET search_path = eos_ops, public;

ALTER TABLE equipment ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equipment ADD CONSTRAINT equipment_version_positive CHECK (version >= 1);
CREATE INDEX equipment_by_serial ON equipment (tenant_id, serial_number) WHERE serial_number IS NOT NULL;

CREATE TABLE equipment_events (
    id                     TEXT        NOT NULL,
    tenant_id              TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    equipment_id           TEXT        NOT NULL,
    event_type             TEXT        NOT NULL,
    operating_company_key  TEXT        NOT NULL,
    account_id             TEXT        NOT NULL,
    customer_location_id   TEXT        NOT NULL,
    work_order_id          TEXT,
    part_id                TEXT,
    serial_number          TEXT,
    ledger_movement_id     TEXT,
    source                 TEXT        NOT NULL,
    reason                 TEXT,
    changes                JSONB       NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key        TEXT,
    request_fingerprint    TEXT,
    actor_principal_id     TEXT        NOT NULL,
    occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT equipment_events_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT equipment_events_equipment FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment (tenant_id, id),
    CONSTRAINT equipment_events_type_known CHECK (event_type IN ('CREATED', 'UPDATED', 'INSTALLED')),
    CONSTRAINT equipment_events_source_known CHECK (source IN ('EOS_COMMAND', 'WORK_ORDER_INSTALL', 'SAMPLE_DATA_SEED')),
    -- An installation is only ever recorded with everything that makes it one.
    CONSTRAINT equipment_events_install_complete CHECK (
        event_type <> 'INSTALLED' OR (work_order_id IS NOT NULL AND part_id IS NOT NULL AND serial_number IS NOT NULL
                                      AND ledger_movement_id IS NOT NULL AND source = 'WORK_ORDER_INSTALL')),
    CONSTRAINT equipment_events_actor_present CHECK (btrim(actor_principal_id) <> '')
);
CREATE UNIQUE INDEX equipment_events_idempotency ON equipment_events (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX equipment_events_by_equipment ON equipment_events (tenant_id, equipment_id, occurred_at);
CREATE INDEX equipment_events_by_work_order ON equipment_events (tenant_id, work_order_id) WHERE work_order_id IS NOT NULL;

CREATE FUNCTION equipment_events_append_only() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'EQUIPMENT_EVENTS_APPEND_ONLY: % would rewrite Equipment history', TG_OP;
END
$$;
CREATE TRIGGER equipment_events_append_only
    BEFORE UPDATE OR DELETE ON equipment_events
    FOR EACH ROW EXECUTE FUNCTION equipment_events_append_only();

-- Down Migration
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capabilities WHERE capability_id IN ('cap_equipment_record_read', 'cap_equipment_record_manage');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'EQUIPMENT_REGISTER_AUTHORITY: refuses to reverse -- the Equipment register capabilities are held by % Role grant(s)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities WHERE capability_id IN ('cap_equipment_record_read', 'cap_equipment_record_manage');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'EQUIPMENT_REGISTER_AUTHORITY: refuses to reverse -- the Equipment register capabilities are held by % direct grant(s)', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions WHERE capability_key IN ('equipment.record.read', 'equipment.record.manage');
        IF v_n > 0 THEN
            RAISE EXCEPTION 'EQUIPMENT_REGISTER_AUTHORITY: refuses to reverse -- % Administration decision(s) name the Equipment register capabilities', v_n;
        END IF;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.equipment_events;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'EQUIPMENT_REGISTER_AUTHORITY: refuses to reverse -- % Equipment event(s) are history', v_n;
    END IF;
END
$$;

SET search_path = eos_ops, public;
DROP TRIGGER IF EXISTS equipment_events_append_only ON equipment_events;
DROP FUNCTION IF EXISTS equipment_events_append_only();
DROP TABLE IF EXISTS equipment_events;
DROP INDEX IF EXISTS equipment_by_serial;
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_version_positive;
ALTER TABLE equipment DROP COLUMN IF EXISTS version;

DELETE FROM eos_policy.capabilities WHERE id IN ('cap_equipment_record_read', 'cap_equipment_record_manage');
