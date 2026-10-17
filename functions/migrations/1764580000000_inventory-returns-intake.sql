-- Up Migration
-- RETURNS INTAKE ON EOS CORE (Firebase exit F7a; Owner ruling 2026-10-17; DECISIONS #242).
--
-- The Firestore `inventory_returns` record, re-homed. Its behaviour is unchanged, by Owner ruling:
--   * INTAKE ONLY (DECISIONS #118). A return is recorded AWAITING_DISPOSITION and writes NO ledger movement -- intake never
--     restores sellable stock. The one state is a CHECK, so a second state is a visible migration, never a typo.
--   * The SAME closed vocabularies: sources WORK_ORDER / CUSTOMER / TRUCK / SUPPLIER / UNKNOWN; conditions UNOPENED / OPENED /
--     DAMAGED / UNKNOWN. A condition is an observation and gates nothing.
--   * Quantity XOR serials; one idempotency key = one return (the id is derived from it: ret_<key>).
-- NEW, by Owner ruling: the OPERATING COMPANY is REQUIRED and the receiving WAREHOUSE is optional (and, when stated, belongs to
-- that company). Authority is resolved server-side (eosOps/returnIntake.ts, the #237 company check).
--
-- AUTHORITY: `inventory.returns.intake` is registered here and granted to ONE Role, `inventoryReturnsIntakeClerk` (the Role
-- catalog's least-privilege intake Role), which has NO members: nobody is assigned anything by this migration. GRANT-BEARING
-- (Owner ruling E): roleCapabilityAuthorityBaseline.json carries the pair in the same change.
--
-- EXISTING FIRESTORE RECORDS are NOT moved by this migration. `provenance` = MIGRATED is reserved for the Owner-gated copy
-- (functions/scripts/returnIntakeCopy.js); a MIGRATED row may carry no `received_by` (a Firebase uid is never a column).

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_returns_intake', 'inventory.returns.intake',
     'Record a returned item (operating company, optional receiving warehouse, source, part, quantity or serials, condition, reason) as AWAITING_DISPOSITION. Intake only: no ledger movement, never restores sellable stock (DECISIONS #118).',
     'inventoryReturn', 'intake', 'BUSINESS_ACTION', 'Take Returns In')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_242_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764580000000', now(), 'migration:1764580000000', now(), 'migration:1764580000000', now()
  FROM roles r
  JOIN capabilities c ON c.key = 'inventory.returns.intake'
 WHERE r.key = 'inventoryReturnsIntakeClerk'
   AND NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

SET search_path = eos_ops, public;

CREATE TABLE inventory_returns (
    tenant_id            TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    -- ret_<idempotencyKey>, exactly as the Firestore document id was derived, so a copied record keeps its id.
    id                   TEXT        NOT NULL,
    idempotency_key      TEXT        NOT NULL,
    operating_company_id TEXT        NOT NULL,
    warehouse_id         TEXT,
    -- The part as scanned, verbatim (the Firestore command required non-blank and checked nothing else).
    part_id              TEXT        NOT NULL,
    source               TEXT        NOT NULL,
    source_reference     TEXT,
    condition            TEXT        NOT NULL,
    reason               TEXT,
    quantity             INTEGER,
    serial_numbers       TEXT[]      NOT NULL DEFAULT '{}',
    state                TEXT        NOT NULL,
    provenance           TEXT        NOT NULL,
    received_at          TIMESTAMPTZ NOT NULL,
    -- The EOS Principal who took it in. NULL only on a MIGRATED row, whose Firebase actor is evidence, never a column.
    received_by          TEXT,
    -- Who wrote the row: the intake Principal, or the copy's operator Principal.
    created_by           TEXT        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT inventory_returns_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT inventory_returns_one_key_one_return UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT inventory_returns_id_derived CHECK (id = 'ret_' || idempotency_key),
    CONSTRAINT inventory_returns_key_stated CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 200),
    CONSTRAINT inventory_returns_company FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT inventory_returns_warehouse FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses (tenant_id, id),
    CONSTRAINT inventory_returns_part_stated CHECK (btrim(part_id) <> '' AND length(part_id) <= 256),
    CONSTRAINT inventory_returns_source_known CHECK (source IN ('WORK_ORDER', 'CUSTOMER', 'TRUCK', 'SUPPLIER', 'UNKNOWN')),
    CONSTRAINT inventory_returns_source_reference_stated CHECK (source_reference IS NULL OR btrim(source_reference) <> ''),
    CONSTRAINT inventory_returns_condition_known CHECK (condition IN ('UNOPENED', 'OPENED', 'DAMAGED', 'UNKNOWN')),
    CONSTRAINT inventory_returns_reason_stated CHECK (reason IS NULL OR (btrim(reason) <> '' AND length(reason) <= 500)),
    CONSTRAINT inventory_returns_quantity_xor_serials CHECK ((quantity IS NULL) <> (cardinality(serial_numbers) = 0)),
    CONSTRAINT inventory_returns_quantity_positive CHECK (quantity IS NULL OR quantity > 0),
    CONSTRAINT inventory_returns_awaiting_disposition CHECK (state = 'AWAITING_DISPOSITION'),
    CONSTRAINT inventory_returns_provenance_known CHECK (provenance IN ('NATIVE', 'MIGRATED')),
    CONSTRAINT inventory_returns_native_actor CHECK (provenance = 'MIGRATED' OR (received_by IS NOT NULL AND btrim(received_by) <> '')),
    CONSTRAINT inventory_returns_writer_stated CHECK (btrim(created_by) <> '')
);

CREATE INDEX inventory_returns_by_company ON inventory_returns (tenant_id, operating_company_id, received_at DESC);

-- Down Migration
DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.inventory_returns;
    IF v_n > 0 THEN RAISE EXCEPTION 'RETURNS_INTAKE: refuses to reverse -- % return record(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key = 'inventory.returns.intake';
    IF v_n > 0 THEN RAISE EXCEPTION 'RETURNS_INTAKE: refuses to reverse -- % Administration decision(s) name inventory.returns.intake', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key = 'inventory.returns.intake';
    IF v_n > 0 THEN RAISE EXCEPTION 'RETURNS_INTAKE: refuses to reverse -- % direct grant(s) hold inventory.returns.intake', v_n; END IF;
END
$$;

DROP TABLE eos_ops.inventory_returns;

SET search_path = eos_policy, public;
DELETE FROM role_capabilities rc USING capabilities c WHERE c.id = rc.capability_id AND c.key = 'inventory.returns.intake';
DELETE FROM capabilities WHERE key = 'inventory.returns.intake';
