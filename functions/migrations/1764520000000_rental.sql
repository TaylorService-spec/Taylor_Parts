-- Up Migration
-- RENTAL (EOS CONTROLLER -- NEXT 3 MAJOR ROADMAP BLOCKS, Package B, 2026-10-03; DECISIONS #207; the model of #190 §13-§18).
--
-- Rental is NOT a sale, NOT provider financing, NOT a loan and NOT a transfer: Taylor RETAINS OWNERSHIP of rental equipment.
-- OWNER != CUSTODIAN != LOCATION != COMMERCIAL DISPOSITION, each held by its own record here:
--
--   OWNER       eos_rental.fleet_units.owner_operating_company_key -- fixed at designation, never changed by anything rental does
--   LOCATION    eos_ops.serialized_custody (WAREHOUSE / BIN while in Taylor custody; EQUIPMENT at the customer site once deployed)
--   CUSTODIAN   the deployed Equipment record's customer + site (customer custody), ended by the governed return receipt
--   RENTAL      fleet_units.availability (AVAILABLE / RESERVED / ON_RENT / SERVICE_HOLD / RETURN_PENDING / INSPECTION / UNAVAILABLE)
--   SERVICE     Work Orders on the deployed Equipment (the normal Work Order architecture; completion never transfers ownership)
--
-- RECORDS: the Rental Agreement (RA-YYYY-######, the governed <PREFIX>-YYYY-###### convention) with APPEND-ONLY versioned terms
-- (rate, billing frequency, expected end, governed delivery / install charges) -- an extension or amendment is a new version,
-- never an overwrite; assignments (one LIVE assignment per fleet unit: double booking is unrepresentable); return inspections;
-- an append-only fleet-unit event log (the utilization / downtime facts Analysis consumes); and rental CHARGES -- the explicit
-- billing eligibility of one whole agreed period or one governed one-time charge. Each charge flows through the frozen
-- Finance path: Operational Billing Package (source RENTAL_CHARGE, disposition RENTAL) -> customer RECEIVABLE -> accounting
-- handoff -> settlement / application -> reconciliation. No Sales Order, no financing arrangement, no ownership transfer.
--
-- NO INVENTED POLICY (#191 §6; target model §9 / L323): EOS never decides WHEN a period is billed (a charge is a governed act
-- by a Finance holder, per what the customer agreed), never prorates (a partial period is refused, RENTAL_PARTIAL_PERIOD_UNRULED),
-- and invents no deposit, late fee, damage charge, minimum term, renewal or tax (tax is the human-supplied evidence the Sales
-- Agreement already uses: DETERMINED amount or NOT_DETERMINED, which HOLDS the package).

-- ════════════════════ 1. rental authority ════════════════════

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_rental_agreement_read', 'rental.agreement.read',
     'View the rental fleet, Rental Agreements (terms history, assignments, charges) and the Rental workspace. Changes nothing.',
     'rentalAgreement', 'read', 'READ', 'View Rentals'),
    ('cap_rental_agreement_manage', 'rental.agreement.manage',
     'Create, activate, amend / extend (a new terms version, history kept), close or cancel a Rental Agreement. Grants no equipment movement and no billing.',
     'rentalAgreement', 'manage', 'BUSINESS_ACTION', 'Manage Rental Agreements'),
    ('cap_rental_charge_record', 'rental.charge.record',
     'Record the billing eligibility of one whole agreed rental period or one governed one-time charge; it prepares the RENTAL Operational Billing Package. Invents no amount.',
     'rentalAgreement', 'charge', 'BUSINESS_ACTION', 'Record Rental Charges'),
    ('cap_rental_unit_assign', 'rental.unit.assign',
     'Reserve an AVAILABLE fleet unit for a Rental Agreement (or for an exchange), or release a reservation. Never deploys.',
     'rentalEquipment', 'assign', 'BUSINESS_ACTION', 'Assign Rental Equipment'),
    ('cap_rental_unit_return', 'rental.unit.return',
     'Initiate a return / pickup, receive returned rental equipment back into the owning company''s custody, and record its inspection outcome.',
     'rentalEquipment', 'return', 'BUSINESS_ACTION', 'Return and Inspect Rental Equipment'),
    ('cap_rental_fleet_manage', 'rental.fleet.manage',
     'Designate a company-owned serialized unit into the rental fleet, mark a unit UNAVAILABLE, or release a service hold -- always with a reason.',
     'rentalEquipment', 'manage', 'BUSINESS_ACTION', 'Manage Rental Fleet')
ON CONFLICT (key) DO NOTHING;

-- GRANT-BEARING (Owner ruling E), each by analogy to the existing governed holders -- never by Job Role, never admin:
--   read     -> the commercial, service, warehouse and finance managers who answer for rentals
--   manage   -> the commercial agreement authorities (owner, generalManager, salesManager)
--   assign   -> those plus the dispatcher who schedules the delivery
--   return   -> the warehouse receiving authorities plus the field (service) manager who inspects
--   fleet    -> owner, generalManager, warehouseManager (warehouse record authority)
--   charge   -> the Finance execution roles of #206 (owner, generalManager, controller, accountingManager, financeManager)
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_207_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764520000000', now(), 'migration:1764520000000', now(), 'migration:1764520000000', now()
  FROM (VALUES
          ('rental.agreement.read', ARRAY['owner', 'generalManager', 'salesManager', 'officeManager', 'dispatcher', 'fieldManager', 'warehouseManager',
                                         'controller', 'accountingManager', 'financeManager']),
          ('rental.agreement.manage', ARRAY['owner', 'generalManager', 'salesManager']),
          ('rental.unit.assign', ARRAY['owner', 'generalManager', 'salesManager', 'dispatcher']),
          ('rental.unit.return', ARRAY['owner', 'generalManager', 'warehouseManager', 'warehouseAssociate', 'fieldManager']),
          ('rental.fleet.manage', ARRAY['owner', 'generalManager', 'warehouseManager']),
          ('rental.charge.record', ARRAY['owner', 'generalManager', 'controller', 'accountingManager', 'financeManager'])
       ) AS g(capability_key, role_keys)
  JOIN capabilities c ON c.key = g.capability_key
  JOIN roles r ON r.key = ANY(g.role_keys) AND (r.key <> 'owner' OR r.protected = TRUE)
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- ════════════════════ 2. the rental domain ════════════════════

CREATE SCHEMA IF NOT EXISTS eos_rental;
SET search_path = eos_rental, public;

CREATE TABLE rental_number_counters (
    tenant_id   TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    year        INTEGER     NOT NULL CHECK (year BETWEEN 1970 AND 9999),
    last_value  BIGINT      NOT NULL CHECK (last_value > 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, year)
);

-- A Taylor-owned serialized unit designated into the rental fleet. OWNERSHIP is fixed here; location is custody's.
CREATE TABLE fleet_units (
    id                           TEXT PRIMARY KEY,
    tenant_id                    TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    part_id                      TEXT NOT NULL,
    serial_number                TEXT NOT NULL,
    owner_operating_company_key  TEXT NOT NULL CHECK (btrim(owner_operating_company_key) <> ''),
    availability                 TEXT NOT NULL CHECK (availability IN ('AVAILABLE', 'RESERVED', 'ON_RENT', 'SERVICE_HOLD', 'RETURN_PENDING', 'INSPECTION', 'UNAVAILABLE')),
    current_assignment_id        TEXT,
    display_name                 TEXT NOT NULL CHECK (btrim(display_name) <> '' AND length(display_name) <= 200),
    version                      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    designated_by                TEXT NOT NULL CHECK (btrim(designated_by) <> ''),
    designated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fleet_unit_one_per_serial UNIQUE (tenant_id, part_id, serial_number),
    CONSTRAINT fleet_unit_custody_fk FOREIGN KEY (tenant_id, part_id, serial_number) REFERENCES eos_ops.serialized_custody (tenant_id, part_id, serial_number),
    -- A unit committed to an agreement names its assignment; a free unit names none.
    CONSTRAINT fleet_unit_assignment_shape CHECK (
        (availability IN ('RESERVED', 'ON_RENT', 'RETURN_PENDING')) = (current_assignment_id IS NOT NULL))
);
CREATE INDEX fleet_units_by_availability ON fleet_units (tenant_id, availability);

-- The owner never changes through rental.
CREATE OR REPLACE FUNCTION assert_fleet_unit_owner_fixed() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_rental, public AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'RENTAL_FLEET_UNIT_HISTORY: a fleet unit is never deleted';
    END IF;
    IF NEW.owner_operating_company_key <> OLD.owner_operating_company_key OR NEW.part_id <> OLD.part_id OR NEW.serial_number <> OLD.serial_number
       OR NEW.tenant_id <> OLD.tenant_id OR NEW.designated_at <> OLD.designated_at THEN
        RAISE EXCEPTION 'RENTAL_OWNERSHIP_FIXED: rental never changes who owns the unit or which unit it is';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER fleet_units_owner_fixed BEFORE UPDATE OR DELETE ON fleet_units FOR EACH ROW EXECUTE FUNCTION assert_fleet_unit_owner_fixed();

CREATE TABLE rental_agreements (
    id                      TEXT PRIMARY KEY,
    tenant_id               TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    rental_agreement_number TEXT NOT NULL CHECK (rental_agreement_number ~ '^RA-[0-9]{4}-[0-9]{6,}$'),
    -- The lessor: the operating company that owns the fleet and is owed the rent.
    operating_company_key   TEXT NOT NULL CHECK (btrim(operating_company_key) <> ''),
    account_id              TEXT NOT NULL,
    customer_location_id    TEXT NOT NULL,
    status                  TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED')),
    start_date              DATE NOT NULL,
    currency                TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    delivery_requirements   TEXT CHECK (delivery_requirements IS NULL OR (btrim(delivery_requirements) <> '' AND length(delivery_requirements) <= 2000)),
    return_expectations     TEXT CHECK (return_expectations IS NULL OR (btrim(return_expectations) <> '' AND length(return_expectations) <= 2000)),
    version                 INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    idempotency_key         TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_fingerprint     TEXT NOT NULL,
    created_by              TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_by            TEXT,
    activated_at            TIMESTAMPTZ,
    ended_by                TEXT,
    ended_at                TIMESTAMPTZ,
    end_reason              TEXT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rental_agreement_number_unique UNIQUE (tenant_id, rental_agreement_number),
    CONSTRAINT rental_agreement_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT rental_agreement_activation_shape CHECK ((status = 'DRAFT') = (activated_at IS NULL) OR status = 'CANCELLED'),
    CONSTRAINT rental_agreement_end_shape CHECK ((status IN ('CLOSED', 'CANCELLED')) = (ended_at IS NOT NULL AND ended_by IS NOT NULL AND end_reason IS NOT NULL))
);
CREATE INDEX rental_agreements_by_status ON rental_agreements (tenant_id, status);

-- Agreed commercial terms, APPEND-ONLY. Version 1 is the original; every extension / amendment is a later version.
CREATE TABLE rental_agreement_terms (
    tenant_id               TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    agreement_id            TEXT NOT NULL REFERENCES rental_agreements(id),
    version                 INTEGER NOT NULL CHECK (version >= 1),
    rate_minor              BIGINT NOT NULL CHECK (rate_minor > 0),
    billing_frequency       TEXT NOT NULL CHECK (billing_frequency IN ('DAY', 'WEEK', 'MONTH')),
    expected_end_date       DATE NOT NULL,
    delivery_charge_minor   BIGINT CHECK (delivery_charge_minor IS NULL OR delivery_charge_minor >= 0),
    install_charge_minor    BIGINT CHECK (install_charge_minor IS NULL OR install_charge_minor >= 0),
    change_kind             TEXT NOT NULL CHECK (change_kind IN ('ORIGINAL', 'EXTENSION', 'AMENDMENT')),
    reason                  TEXT NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 1000),
    recorded_by             TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agreement_id, version),
    CONSTRAINT rental_terms_original_first CHECK ((version = 1) = (change_kind = 'ORIGINAL'))
);

CREATE TABLE rental_assignments (
    id                        TEXT PRIMARY KEY,
    tenant_id                 TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    agreement_id              TEXT NOT NULL REFERENCES rental_agreements(id),
    fleet_unit_id             TEXT NOT NULL REFERENCES fleet_units(id),
    status                    TEXT NOT NULL CHECK (status IN ('RESERVED', 'DEPLOYED', 'RETURN_PENDING', 'RETURNED', 'RELEASED')),
    -- An EXCHANGE: this assignment replaces another of the same agreement (whose return follows).
    replaces_assignment_id    TEXT REFERENCES rental_assignments(id),
    reserved_by               TEXT NOT NULL CHECK (btrim(reserved_by) <> ''),
    reserved_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    deployment_work_order_id  TEXT,
    equipment_id              TEXT,
    deployed_at               TIMESTAMPTZ,
    return_initiated_by       TEXT,
    return_initiated_at       TIMESTAMPTZ,
    expected_pickup_date      DATE,
    return_work_order_id      TEXT,
    returned_by               TEXT,
    returned_at               TIMESTAMPTZ,
    return_warehouse_id       TEXT,
    released_by               TEXT,
    released_at               TIMESTAMPTZ,
    release_reason            TEXT,
    idempotency_key           TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT rental_assignment_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT rental_assignment_deployed_shape CHECK (
        (status IN ('DEPLOYED', 'RETURN_PENDING', 'RETURNED')) = (deployed_at IS NOT NULL AND equipment_id IS NOT NULL AND deployment_work_order_id IS NOT NULL)),
    CONSTRAINT rental_assignment_return_shape CHECK (
        (status IN ('RETURN_PENDING', 'RETURNED')) = (return_initiated_at IS NOT NULL AND return_initiated_by IS NOT NULL)),
    CONSTRAINT rental_assignment_returned_shape CHECK (
        (status = 'RETURNED') = (returned_at IS NOT NULL AND returned_by IS NOT NULL AND return_warehouse_id IS NOT NULL)),
    CONSTRAINT rental_assignment_released_shape CHECK (
        (status = 'RELEASED') = (released_at IS NOT NULL AND released_by IS NOT NULL AND release_reason IS NOT NULL))
);
-- DOUBLE BOOKING IS UNREPRESENTABLE: at most ONE live assignment per fleet unit.
CREATE UNIQUE INDEX rental_assignment_one_live_per_unit ON rental_assignments (tenant_id, fleet_unit_id)
    WHERE status IN ('RESERVED', 'DEPLOYED', 'RETURN_PENDING');
CREATE INDEX rental_assignments_by_agreement ON rental_assignments (tenant_id, agreement_id, status);

ALTER TABLE fleet_units ADD CONSTRAINT fleet_unit_current_assignment_fk FOREIGN KEY (current_assignment_id) REFERENCES rental_assignments(id);

-- The return inspection that decides availability (never automatic). Append-only.
CREATE TABLE rental_inspections (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    fleet_unit_id     TEXT NOT NULL REFERENCES fleet_units(id),
    assignment_id     TEXT REFERENCES rental_assignments(id),
    outcome           TEXT NOT NULL CHECK (outcome IN ('READY', 'NEEDS_SERVICE', 'UNAVAILABLE')),
    condition_notes   TEXT NOT NULL CHECK (btrim(condition_notes) <> '' AND length(condition_notes) <= 2000),
    inspected_by      TEXT NOT NULL CHECK (btrim(inspected_by) <> ''),
    inspected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key   TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT rental_inspection_idempotency UNIQUE (tenant_id, idempotency_key)
);

-- THE ANALYTIC FACT LOG: every availability move, with its agreement / Work Order / Equipment. Append-only.
CREATE TABLE fleet_unit_events (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    fleet_unit_id      TEXT NOT NULL REFERENCES fleet_units(id),
    event_type         TEXT NOT NULL CHECK (event_type IN ('DESIGNATED', 'RESERVED', 'RESERVATION_RELEASED', 'DEPLOYED', 'RETURN_INITIATED',
                                                           'RETURN_RECEIVED', 'INSPECTED', 'SERVICE_HOLD_RELEASED', 'MARKED_UNAVAILABLE', 'AVAILABILITY_RESTORED')),
    from_availability  TEXT,
    to_availability    TEXT NOT NULL,
    agreement_id       TEXT REFERENCES rental_agreements(id),
    assignment_id      TEXT REFERENCES rental_assignments(id),
    work_order_id      TEXT,
    equipment_id       TEXT,
    owner_operating_company_key TEXT NOT NULL,
    location_type      TEXT,
    location_id        TEXT,
    reason             TEXT,
    actor_principal_id TEXT NOT NULL CHECK (btrim(actor_principal_id) <> ''),
    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fleet_unit_events_by_unit ON fleet_unit_events (tenant_id, fleet_unit_id, occurred_at);

-- BILLING ELIGIBILITY: one whole agreed period, or one governed one-time charge. Immutable.
CREATE TABLE rental_charges (
    id                   TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    agreement_id         TEXT NOT NULL REFERENCES rental_agreements(id),
    kind                 TEXT NOT NULL CHECK (kind IN ('PERIOD', 'DELIVERY', 'INSTALL')),
    terms_version        INTEGER NOT NULL,
    period_start         DATE,
    period_end           DATE,
    period_count         INTEGER NOT NULL CHECK (period_count > 0),
    unit_amount_minor    BIGINT NOT NULL CHECK (unit_amount_minor >= 0),
    amount_minor         BIGINT NOT NULL CHECK (amount_minor >= 0),
    currency             TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    notes                TEXT CHECK (notes IS NULL OR (btrim(notes) <> '' AND length(notes) <= 1000)),
    idempotency_key      TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_fingerprint  TEXT NOT NULL,
    recorded_by          TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rental_charge_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT rental_charge_terms_fk FOREIGN KEY (agreement_id, terms_version) REFERENCES rental_agreement_terms (agreement_id, version),
    CONSTRAINT rental_charge_amount_exact CHECK (amount_minor = unit_amount_minor * period_count),
    CONSTRAINT rental_charge_period_shape CHECK (
        (kind = 'PERIOD') = (period_start IS NOT NULL AND period_end IS NOT NULL) AND (period_end IS NULL OR period_end > period_start)),
    CONSTRAINT rental_charge_one_time_once CHECK (kind = 'PERIOD' OR period_count = 1)
);
-- A one-time charge of a kind is recorded once per agreement (no policy governs a second delivery charge).
CREATE UNIQUE INDEX rental_charge_one_time_per_agreement ON rental_charges (tenant_id, agreement_id, kind) WHERE kind <> 'PERIOD';
CREATE INDEX rental_charges_by_agreement ON rental_charges (tenant_id, agreement_id, period_start);

-- TAX EVIDENCE of a charge, APPEND-ONLY and human-supplied (the Sales Agreement's own vocabulary): DETERMINED with an amount,
-- or NOT_DETERMINED (the package is HELD as TAX_NOT_DETERMINED -- never a zero). A later version re-evaluates the package.
CREATE TABLE rental_charge_tax_evidence (
    tenant_id     TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    charge_id     TEXT NOT NULL REFERENCES rental_charges(id),
    version       INTEGER NOT NULL CHECK (version >= 1),
    status        TEXT NOT NULL CHECK (status IN ('DETERMINED', 'NOT_DETERMINED')),
    tax_minor     BIGINT CHECK (tax_minor IS NULL OR tax_minor >= 0),
    reason        TEXT NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 1000),
    recorded_by   TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (charge_id, version),
    CONSTRAINT rental_tax_shape CHECK ((status = 'DETERMINED') = (tax_minor IS NOT NULL))
);

-- Periods never overlap within an agreement: no period is ever billed twice.
CREATE OR REPLACE FUNCTION assert_rental_charge_integrity() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_rental, public AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'RENTAL_CHARGE_IMMUTABLE: a recorded rental charge is never edited or deleted';
    END IF;
    IF NEW.kind = 'PERIOD' AND EXISTS (
        SELECT 1 FROM rental_charges c WHERE c.tenant_id = NEW.tenant_id AND c.agreement_id = NEW.agreement_id AND c.kind = 'PERIOD'
           AND daterange(c.period_start, c.period_end, '[)') && daterange(NEW.period_start, NEW.period_end, '[)')) THEN
        RAISE EXCEPTION 'RENTAL_PERIOD_ALREADY_CHARGED: that period overlaps a period already charged on this agreement';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER rental_charges_integrity BEFORE INSERT OR UPDATE OR DELETE ON rental_charges FOR EACH ROW EXECUTE FUNCTION assert_rental_charge_integrity();

CREATE OR REPLACE FUNCTION refuse_rental_history_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'RENTAL_HISTORY_APPEND_ONLY: % would rewrite rental history (%)', TG_OP, TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER rental_agreement_terms_append_only BEFORE UPDATE OR DELETE ON rental_agreement_terms FOR EACH ROW EXECUTE FUNCTION refuse_rental_history_mutation();
CREATE TRIGGER rental_inspections_append_only BEFORE UPDATE OR DELETE ON rental_inspections FOR EACH ROW EXECUTE FUNCTION refuse_rental_history_mutation();
CREATE TRIGGER rental_charge_tax_evidence_append_only BEFORE UPDATE OR DELETE ON rental_charge_tax_evidence FOR EACH ROW EXECUTE FUNCTION refuse_rental_history_mutation();
CREATE TRIGGER fleet_unit_events_append_only BEFORE UPDATE OR DELETE ON fleet_unit_events FOR EACH ROW EXECUTE FUNCTION refuse_rental_history_mutation();

CREATE OR REPLACE FUNCTION refuse_rental_record_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'RENTAL_HISTORY: % rows are never deleted (%)', TG_TABLE_NAME, TG_OP;
END;
$$;
CREATE TRIGGER rental_agreements_no_delete BEFORE DELETE ON rental_agreements FOR EACH ROW EXECUTE FUNCTION refuse_rental_record_delete();
CREATE TRIGGER rental_assignments_no_delete BEFORE DELETE ON rental_assignments FOR EACH ROW EXECUTE FUNCTION refuse_rental_record_delete();

-- ════════════════════ 3. Work Orders and the inventory ledger ════════════════════

SET search_path = eos_ops, public;

-- A Work Order performed for a Rental Agreement (delivery / install, service while rented, pickup). Opaque like sales_order_id.
ALTER TABLE work_orders ADD COLUMN rental_agreement_id TEXT;
CREATE INDEX work_orders_by_rental_agreement ON work_orders (tenant_id, rental_agreement_id) WHERE rental_agreement_id IS NOT NULL;

-- A deployed rental unit leaves Taylor's stock location for the customer site (still Taylor's), and comes back: neither is a
-- consumption, so Analysis never counts a rental as parts used.
ALTER TYPE ops_movement_type ADD VALUE IF NOT EXISTS 'RENTAL_DEPLOYMENT';
ALTER TYPE ops_movement_type ADD VALUE IF NOT EXISTS 'RENTAL_RETURN';

-- The deployed rental Equipment's history: deployed by the install (INSTALLED), returned by the governed return receipt.
ALTER TABLE equipment_events DROP CONSTRAINT equipment_events_type_known;
ALTER TABLE equipment_events ADD CONSTRAINT equipment_events_type_known CHECK (event_type IN ('CREATED', 'UPDATED', 'INSTALLED', 'RENTAL_RETURNED'));
ALTER TABLE equipment_events DROP CONSTRAINT equipment_events_source_known;
ALTER TABLE equipment_events ADD CONSTRAINT equipment_events_source_known CHECK (source IN ('EOS_COMMAND', 'WORK_ORDER_INSTALL', 'SAMPLE_DATA_SEED', 'RENTAL_RETURN'));

-- ════════════════════ 4. the RENTAL Operational Billing Package ════════════════════

SET search_path = eos_finance, public;

ALTER TABLE billing_packages ALTER COLUMN sales_order_id DROP NOT NULL;
ALTER TABLE billing_packages ADD COLUMN rental_charge_id TEXT, ADD COLUMN rental_agreement_id TEXT;
ALTER TABLE billing_packages DROP CONSTRAINT billing_packages_source_kind_check;
ALTER TABLE billing_packages
    ADD CONSTRAINT billing_package_source_kind_known CHECK (source_kind IN ('SALES_ORDER', 'RENTAL_CHARGE')),
    ADD CONSTRAINT billing_package_source_shape CHECK (
        (source_kind = 'SALES_ORDER' AND sales_order_id IS NOT NULL AND rental_charge_id IS NULL AND rental_agreement_id IS NULL)
        OR (source_kind = 'RENTAL_CHARGE' AND rental_charge_id IS NOT NULL AND rental_agreement_id IS NOT NULL AND sales_order_id IS NULL
            AND commercial_disposition = 'RENTAL' AND sales_agreement_id IS NULL AND financing_arrangement_id IS NULL)),
    DROP CONSTRAINT billing_package_disposition_known,
    ADD CONSTRAINT billing_package_disposition_known CHECK (commercial_disposition IN ('SALE', 'DIRECT_ORDER', 'LEASE', 'FINANCED_SALE', 'RENTAL')),
    DROP CONSTRAINT billing_package_obligor_basis_known,
    ADD CONSTRAINT billing_package_obligor_basis_known CHECK (obligor_basis IN ('DIRECT_SALE_CUSTOMER', 'FINANCING_PROVIDER_FUNDED', 'RENTAL_CUSTOMER', 'UNRESOLVED')),
    ADD CONSTRAINT billing_package_rental_obligor CHECK ((obligor_basis = 'RENTAL_CUSTOMER') <= (commercial_disposition = 'RENTAL'));
CREATE UNIQUE INDEX billing_package_rental_version_unique ON billing_packages (tenant_id, rental_charge_id, version) WHERE source_kind = 'RENTAL_CHARGE';
CREATE UNIQUE INDEX billing_package_rental_one_current ON billing_packages (tenant_id, rental_charge_id)
    WHERE source_kind = 'RENTAL_CHARGE' AND status IN ('HELD', 'READY');

ALTER TABLE billing_package_lines ALTER COLUMN sales_order_id DROP NOT NULL, ALTER COLUMN sales_order_line_number DROP NOT NULL;
ALTER TABLE billing_package_lines ADD COLUMN rental_charge_id TEXT;
ALTER TABLE billing_package_lines DROP CONSTRAINT billing_package_lines_price_source_check;
ALTER TABLE billing_package_lines
    ADD CONSTRAINT billing_package_line_price_source_known CHECK (price_source IN ('SALES_ORDER_LINE', 'RENTAL_AGREEMENT_TERMS')),
    ADD CONSTRAINT billing_package_line_source_shape CHECK (
        (price_source = 'SALES_ORDER_LINE' AND sales_order_id IS NOT NULL AND sales_order_line_number IS NOT NULL AND rental_charge_id IS NULL)
        OR (price_source = 'RENTAL_AGREEMENT_TERMS' AND rental_charge_id IS NOT NULL AND sales_order_id IS NULL AND sales_order_line_number IS NULL));

-- Down Migration
DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_finance.billing_packages WHERE source_kind = 'RENTAL_CHARGE';
    IF v_n > 0 THEN RAISE EXCEPTION 'RENTAL: refuses to reverse -- % rental billing package(s) are Finance history', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_rental.rental_agreements;
    IF v_n > 0 THEN RAISE EXCEPTION 'RENTAL: refuses to reverse -- % Rental Agreement(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_rental.fleet_units;
    IF v_n > 0 THEN RAISE EXCEPTION 'RENTAL: refuses to reverse -- % fleet unit(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.work_orders WHERE rental_agreement_id IS NOT NULL;
    IF v_n > 0 THEN RAISE EXCEPTION 'RENTAL: refuses to reverse -- % Work Order(s) name a Rental Agreement', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.equipment_events WHERE event_type = 'RENTAL_RETURNED';
    IF v_n > 0 THEN RAISE EXCEPTION 'RENTAL: refuses to reverse -- % rental return event(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.inventory_movements WHERE movement_type::text IN ('RENTAL_DEPLOYMENT', 'RENTAL_RETURN');
    IF v_n > 0 THEN RAISE EXCEPTION 'RENTAL: refuses to reverse -- % rental ledger movement(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key LIKE 'rental.%';
    IF v_n > 0 THEN RAISE EXCEPTION 'RENTAL: refuses to reverse -- % Administration decision(s) name a rental capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key LIKE 'rental.%';
    IF v_n > 0 THEN RAISE EXCEPTION 'RENTAL: refuses to reverse -- % direct grant(s) hold a rental capability', v_n; END IF;
END
$$;

SET search_path = eos_finance, public;
ALTER TABLE billing_package_lines DROP CONSTRAINT IF EXISTS billing_package_line_source_shape, DROP CONSTRAINT IF EXISTS billing_package_line_price_source_known;
ALTER TABLE billing_package_lines ADD CONSTRAINT billing_package_lines_price_source_check CHECK (price_source = 'SALES_ORDER_LINE');
ALTER TABLE billing_package_lines DROP COLUMN IF EXISTS rental_charge_id;
ALTER TABLE billing_package_lines ALTER COLUMN sales_order_id SET NOT NULL, ALTER COLUMN sales_order_line_number SET NOT NULL;
DROP INDEX IF EXISTS billing_package_rental_one_current;
DROP INDEX IF EXISTS billing_package_rental_version_unique;
ALTER TABLE billing_packages
    DROP CONSTRAINT IF EXISTS billing_package_rental_obligor,
    DROP CONSTRAINT IF EXISTS billing_package_obligor_basis_known,
    DROP CONSTRAINT IF EXISTS billing_package_disposition_known,
    DROP CONSTRAINT IF EXISTS billing_package_source_shape,
    DROP CONSTRAINT IF EXISTS billing_package_source_kind_known;
ALTER TABLE billing_packages
    ADD CONSTRAINT billing_package_disposition_known CHECK (commercial_disposition IN ('SALE', 'DIRECT_ORDER', 'LEASE', 'FINANCED_SALE')),
    ADD CONSTRAINT billing_package_obligor_basis_known CHECK (obligor_basis IN ('DIRECT_SALE_CUSTOMER', 'FINANCING_PROVIDER_FUNDED', 'UNRESOLVED')),
    ADD CONSTRAINT billing_packages_source_kind_check CHECK (source_kind IN ('SALES_ORDER'));
ALTER TABLE billing_packages DROP COLUMN IF EXISTS rental_agreement_id, DROP COLUMN IF EXISTS rental_charge_id;
ALTER TABLE billing_packages ALTER COLUMN sales_order_id SET NOT NULL;

SET search_path = eos_ops, public;
ALTER TABLE equipment_events DROP CONSTRAINT equipment_events_source_known;
ALTER TABLE equipment_events ADD CONSTRAINT equipment_events_source_known CHECK (source IN ('EOS_COMMAND', 'WORK_ORDER_INSTALL', 'SAMPLE_DATA_SEED'));
ALTER TABLE equipment_events DROP CONSTRAINT equipment_events_type_known;
ALTER TABLE equipment_events ADD CONSTRAINT equipment_events_type_known CHECK (event_type IN ('CREATED', 'UPDATED', 'INSTALLED'));
-- The two ledger labels stay (PostgreSQL cannot drop an enum value); with no row using them they are inert.
DROP INDEX IF EXISTS work_orders_by_rental_agreement;
ALTER TABLE work_orders DROP COLUMN IF EXISTS rental_agreement_id;

DROP SCHEMA IF EXISTS eos_rental CASCADE;

SET search_path = eos_policy, public;
DELETE FROM role_capabilities rc USING capabilities c WHERE c.id = rc.capability_id AND c.key IN ('rental.agreement.read', 'rental.agreement.manage',
    'rental.charge.record', 'rental.unit.assign', 'rental.unit.return', 'rental.fleet.manage');
DELETE FROM capabilities WHERE key IN ('rental.agreement.read', 'rental.agreement.manage', 'rental.charge.record', 'rental.unit.assign',
                                       'rental.unit.return', 'rental.fleet.manage');
