-- Up Migration
-- SERIALIZED ASSET ACQUISITION ON EOS (Controller ruling DQ-036(b), 2026-09-28). Lane L3.
-- REGISTERS ONE CAPABILITY, GRANTS IT TO NOBODY, and adds the acquisition provenance table.
--
-- 1. inventory.serializedAsset.acquire -- OPERATIONAL INVENTORY / RECEIVING authority: bring an ALREADY-OWNED
--    serialized unit into managed custody without a purchase (opening balance, legacy migration, existing company
--    asset). Object serializedAssets, action acquire, BUSINESS_ACTION. The key already exists in the in-repo
--    PERMISSION_CATALOG (the Firebase command's gate, registered active:false); it is FENCED from every default
--    writer by roleCapabilityAdministration.ADMINISTRATION_GRANT_ONLY_CAPABILITIES, so no catalog reconcile, seed or
--    activation tool can default-grant it -- the admin Role's whole-catalog composition included. Its initial
--    holders (Parts Associate, Parts Manager, Warehouse Associate, Warehouse Manager) are an Administration
--    execution packet, never this migration.
--
-- 2. eos_ops.serialized_asset_acquisitions -- the PROVENANCE the Firestore asset document carried beside the unit
--    (acquisitionReason / acquisitionProvenance NON_PO_ACQUISITION / acquisitionNote / acquisitionIdempotencyKey),
--    kept as its own append-only fact so a unit that arrived by RECEIPT and one acquired without a purchase stay
--    distinguishable forever, and a retry is recognised by its key. The custody itself stays in serialized_custody.

SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key = 'inventory.serializedAsset.acquire' OR (object_key = 'serializedAssets' AND action_key = 'acquire');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'SERIALIZED_ASSET_ACQUIRE_AUTHORITY: inventory.serializedAsset.acquire / serializedAssets.acquire is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_serializedAsset_acquire', 'inventory.serializedAsset.acquire',
     'Bring an already-owned serialized unit into managed custody without a purchase order (opening balance, legacy migration, existing company asset). Requires, besides this capability, the Warehouse Operations eligibility and operational scope over the receiving warehouse, an ACTIVE serialized Part, and a governed company-compatible warehouse. Creates no Equipment, no customer relationship and no purchasing history. Granted only through Administration.',
     'serializedAssets', 'acquire', 'BUSINESS_ACTION', 'Acquire Existing Serialized Unit')
ON CONFLICT (key) DO NOTHING;

SET search_path = eos_ops, public;

CREATE TYPE ops_acquisition_reason AS ENUM ('OPENING_BALANCE', 'LEGACY_MIGRATION', 'EXISTING_COMPANY_ASSET');

CREATE TABLE serialized_asset_acquisitions (
    id                     TEXT        NOT NULL,
    tenant_id              TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    part_id                TEXT        NOT NULL,
    serial_number          TEXT        NOT NULL,
    warehouse_id           TEXT        NOT NULL,
    operating_company_key  TEXT        NOT NULL,
    reason                 ops_acquisition_reason NOT NULL,
    provenance             TEXT        NOT NULL DEFAULT 'NON_PO_ACQUISITION',
    note                   TEXT,
    idempotency_key        TEXT        NOT NULL,
    ledger_movement_id     TEXT        NOT NULL,
    acquired_by            TEXT        NOT NULL,
    acquired_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT serialized_asset_acquisitions_pkey PRIMARY KEY (tenant_id, id),
    -- One physical unit is acquired at most once.
    CONSTRAINT serialized_asset_acquisitions_one_per_unit UNIQUE (tenant_id, part_id, serial_number),
    CONSTRAINT serialized_asset_acquisitions_warehouse FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id),
    CONSTRAINT serialized_asset_acquisitions_provenance CHECK (provenance = 'NON_PO_ACQUISITION'),
    CONSTRAINT serialized_asset_acquisitions_note CHECK (note IS NULL OR btrim(note) <> '')
);

CREATE FUNCTION serialized_asset_acquisition_append_only() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'SERIALIZED_ASSET_ACQUISITION_APPEND_ONLY: % would rewrite acquisition provenance', TG_OP;
END
$$;
CREATE TRIGGER serialized_asset_acquisition_append_only
    BEFORE UPDATE OR DELETE ON serialized_asset_acquisitions
    FOR EACH ROW EXECUTE FUNCTION serialized_asset_acquisition_append_only();

-- Down Migration
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capabilities WHERE capability_id = 'cap_inventory_serializedAsset_acquire';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'SERIALIZED_ASSET_ACQUIRE_AUTHORITY: refuses to reverse -- inventory.serializedAsset.acquire is held by % Role grant(s)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities WHERE capability_id = 'cap_inventory_serializedAsset_acquire';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'SERIALIZED_ASSET_ACQUIRE_AUTHORITY: refuses to reverse -- inventory.serializedAsset.acquire is held by % direct grant(s)', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions WHERE capability_key = 'inventory.serializedAsset.acquire';
        IF v_n > 0 THEN
            RAISE EXCEPTION 'SERIALIZED_ASSET_ACQUIRE_AUTHORITY: refuses to reverse -- % Administration decision(s) name inventory.serializedAsset.acquire', v_n;
        END IF;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.serialized_asset_acquisitions;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'SERIALIZED_ASSET_ACQUIRE_AUTHORITY: refuses to reverse -- % acquisition record(s) are provenance history', v_n;
    END IF;
END
$$;

SET search_path = eos_ops, public;
DROP TRIGGER IF EXISTS serialized_asset_acquisition_append_only ON serialized_asset_acquisitions;
DROP FUNCTION IF EXISTS serialized_asset_acquisition_append_only();
DROP TABLE IF EXISTS serialized_asset_acquisitions;
DROP TYPE IF EXISTS ops_acquisition_reason;

DELETE FROM eos_policy.capabilities WHERE id = 'cap_inventory_serializedAsset_acquire';
