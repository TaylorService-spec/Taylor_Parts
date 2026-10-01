-- Up Migration
--
-- INVENTORY BASELINE CUTOVER CERTIFICATION (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01). Additive.
--
-- The Inventory writers (placement, relocation, transfer, cycle count, serialized acquire) flip to
-- { firestore: FROZEN, postgres: ACTIVE } in code, and a merged flip deploys BEFORE the governed baseline COPY can run.
-- The ruling requires the cutover to FAIL CLOSED until its prerequisites are proven, so each of those writers also
-- requires, per tenant, a CERTIFIED baseline: one row per stage written ONLY by the governed cutover tool
-- (src/eosOps/migration/inventoryBaselineCutover.ts certifyInventoryBaseline), and only when its VERIFY found the
-- legacy ledger + serialized custody reconciled with zero blocking refusals.
--
--   LEDGER    the legacy inventory_transactions baseline is COPIED (or proven excluded / deferred) and balanced.
--   CUSTODY   the legacy serialized custody is COPIED (or proven excluded / deferred), one location per unit, and agrees
--             with the ledger.
--
-- This is cutover CONTROL STATE, not an inventory representation: it holds no quantity, no location and no Part. It is
-- insert-once (a re-certification with the same evidence is a no-op; different evidence is refused by the tool) and
-- append-only (no UPDATE, no DELETE).

SET search_path = eos_ops, public;

CREATE TABLE inventory_baseline_cutovers (
    tenant_id        TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    stage            TEXT        NOT NULL CHECK (stage IN ('LEDGER', 'CUSTODY')),
    snapshot_sha256  TEXT        NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
    manifest_sha256  TEXT        NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    evidence         JSONB       NOT NULL,
    certified_by     TEXT        NOT NULL,
    certified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, stage)
);

CREATE FUNCTION inventory_baseline_cutovers_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'INVENTORY_BASELINE_CUTOVER_APPEND_ONLY: a certified inventory baseline is never changed or removed';
END
$$;

CREATE TRIGGER inventory_baseline_cutovers_append_only
    BEFORE UPDATE OR DELETE ON inventory_baseline_cutovers
    FOR EACH ROW EXECUTE FUNCTION inventory_baseline_cutovers_append_only();

-- Down Migration

SET search_path = eos_ops, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM inventory_baseline_cutovers;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INVENTORY_BASELINE_CUTOVER: refuses to reverse -- % tenant baseline certification(s) the active Inventory writers depend on', v_n;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS inventory_baseline_cutovers_append_only ON inventory_baseline_cutovers;
DROP FUNCTION IF EXISTS inventory_baseline_cutovers_append_only();
DROP TABLE IF EXISTS inventory_baseline_cutovers;
