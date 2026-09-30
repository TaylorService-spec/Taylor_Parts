-- Up Migration
-- THE PINNED QUARANTINE OF THE THIRTEEN BAD-COPY WORK ORDERS (Owner: WORK ORDER CUTOVER COMPLETION PASS, 2026-09-30,
-- DECISION 3 -- "C: PINNED QUARANTINE").
--
-- WO-2026-000001..000008 and WO-2026-000060..000064 in eos_ops.work_orders (taylor-nonprod) are OBSOLETE/BAD_COPY
-- (the DQ-S2 reconciliation: operating company inferred, one shared created_at over 13 distinct source times, five
-- source assignments dropped). They are PRESERVED for migration traceability -- never deleted, overwritten,
-- re-copied, repaired, reassigned or re-pointed -- and QUARANTINED: no operational queue, search, analytics,
-- scheduling candidate or command reaches them (eosOps/workOrderQuarantine.ts).
--
-- NOT A GENERIC "IGNORE BAD ROWS" MECHANISM. The quarantine relation admits EXACTLY the pinned set: a CHECK
-- constraint names the thirteen (id, number, fingerprint) triples, so no other Work Order can ever be quarantined
-- without a new, reviewed migration. Each pin is the fingerprint of the row AS OBSERVED (read-only job,
-- 2026-09-30) under eos_ops.work_order_pin_fingerprint: sha256 over the ORIGINAL Work Order columns with epoch
-- timestamps -- stable across columns added later and independent of the session time zone.
--
-- FAIL CLOSED. A quarantine row is INSERTED only if the Work Order exists in that tenant with that number and its
-- CURRENT fingerprint equals the pin (trigger); a mismatch refuses the insert. The relation is append-only.
--
-- THIS MIGRATION QUARANTINES NOTHING BY ITSELF: it creates the function and the relation. The pins are applied in
-- the activation window by scripts/workOrderQuarantineCli.js (plan by default; --apply writes all thirteen or none).
SET search_path = eos_ops, public;

CREATE FUNCTION work_order_pin_fingerprint(w eos_ops.work_orders) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('id', w.id, 'tenant_id', w.tenant_id, 'operating_company_key', w.operating_company_key, 'work_order_number', w.work_order_number, 'status', w.status::text, 'work_order_type', w.work_order_type::text, 'priority', w.priority, 'severity', w.severity::text, 'customer_id', w.customer_id, 'location_id', w.location_id, 'equipment_id', w.equipment_id, 'sales_order_id', w.sales_order_id, 'scheduled_start', extract(epoch FROM w.scheduled_start), 'scheduled_end', extract(epoch FROM w.scheduled_end), 'estimated_duration_minutes', w.estimated_duration_minutes, 'dispatched_at', extract(epoch FROM w.dispatched_at), 'accepted_at', extract(epoch FROM w.accepted_at), 'en_route_at', extract(epoch FROM w.en_route_at), 'arrived_at', extract(epoch FROM w.arrived_at), 'work_started_at', extract(epoch FROM w.work_started_at), 'completed_at', extract(epoch FROM w.completed_at), 'closed_at', extract(epoch FROM w.closed_at), 'complaint', w.complaint, 'diagnosis', w.diagnosis, 'resolution', w.resolution, 'parts_plan_updated_at', extract(epoch FROM w.parts_plan_updated_at), 'provenance', w.provenance::text, 'created_by_principal_id', w.created_by_principal_id, 'updated_by_principal_id', w.updated_by_principal_id, 'created_at', extract(epoch FROM w.created_at), 'updated_at', extract(epoch FROM w.updated_at))::text, 'UTF8')), 'hex')
$$;

CREATE TABLE work_order_quarantine (
    tenant_id          TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    work_order_id      TEXT        NOT NULL,
    work_order_number  TEXT        NOT NULL,
    fingerprint        TEXT        NOT NULL,
    classification     TEXT        NOT NULL,
    reason             TEXT        NOT NULL,
    provenance         TEXT        NOT NULL,
    quarantined_by     TEXT        NOT NULL,
    quarantined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, work_order_id),
    CONSTRAINT wo_quarantine_work_order_fk FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id),
    CONSTRAINT wo_quarantine_classification CHECK (classification = 'OBSOLETE/BAD_COPY'),
    CONSTRAINT wo_quarantine_reason_stated CHECK (btrim(reason) <> '' AND btrim(provenance) <> '' AND btrim(quarantined_by) <> ''),
    CONSTRAINT wo_quarantine_exact_pinned_set CHECK ((work_order_id, work_order_number, fingerprint) IN (
        ('GN2tk1DgoxdOX0jMU7IO', 'WO-2026-000001', '2a794935df15ca40a21bf42a3a46ae7a2dc67661af6dd08913810f170b0df8f2'),
        ('yqFPzsUCs8XSvRUdSjTy', 'WO-2026-000002', '83b81368ee54d40ecff48fe69be98410a2e37ec604fed6fcebc571e71f086d89'),
        ('0XgbOsl56EJKBu7QNe8k', 'WO-2026-000003', '7d160b166df714b59b54caa0c39c445658b1392685a0f36f24a37f293b5d44c2'),
        ('NEz9qGYpNLtrbFHfisXE', 'WO-2026-000004', 'c1f007c37a0069cc7107c49f5ba35ffd9d0e8d899f4a29c508a822c67912badb'),
        ('DxeWmMoTAgS7uMbo9l4U', 'WO-2026-000005', 'c90b5e8e41cda102d192e24a33035f6d6e5a2e5a67e4889a919922a6e77e6d06'),
        ('FkA7SbwObO2tkORMgpCl', 'WO-2026-000006', '6e18fea984eecd09f81c0c97bc3e5218b9174deef4b4a72b2e160c72cec029c1'),
        ('ckY5gqO26LdKBMASmo5g', 'WO-2026-000007', '7d78fa6376fef3a25d6d3cc6f28b6bd6c57bed307ef00ee56db323f05b0f2650'),
        ('Hdsqhww2bosPHalW04C1', 'WO-2026-000008', 'a790a437450a70d17bd2061f9061b3e3ba161a64c6aa789236a1c49157375259'),
        ('rRTHrgl8Z667xFmyKuQ1', 'WO-2026-000060', 'abcffc10ee2cf5e3560a1cb99b090bdac690c77e5eac7a39e3fff7bc3bdb5170'),
        ('v6EsG4QU477L64QQerWC', 'WO-2026-000061', '4492d39266548ca9477c20318bf219acbdc38c89e3ef2dce5f5871ee4edb8cd1'),
        ('g0SNuHqL41o0eGEgbXJ5', 'WO-2026-000062', '74d28fe92a5ce184044dcad6eed67ca0de5f57a4b2e3ef1313be74ce6de2938a'),
        ('dDas6xXNgcPi3WYPPCIL', 'WO-2026-000063', 'c5e9810715abee0327b62684795b914cada23ada609321bd278b4ef7c4516009'),
        ('zcyG6tdnsgzOnjpMMnpS', 'WO-2026-000064', '34c81767678cc556f33fd18e75df523651cd24d0240ae4fd1e5ab06d88f49d49')))
);

CREATE FUNCTION work_order_quarantine_verify_pin() RETURNS trigger AS $$
DECLARE
    v_fp TEXT;
    v_number TEXT;
BEGIN
    SELECT eos_ops.work_order_pin_fingerprint(w), w.work_order_number INTO v_fp, v_number
      FROM eos_ops.work_orders w WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.work_order_id;
    IF v_fp IS NULL THEN
        RAISE EXCEPTION 'WORK_ORDER_QUARANTINE_PIN_MISSING: % is not a Work Order of this tenant', NEW.work_order_id;
    END IF;
    IF v_number IS DISTINCT FROM NEW.work_order_number THEN
        RAISE EXCEPTION 'WORK_ORDER_QUARANTINE_PIN_MISMATCH: % carries %, pinned as %', NEW.work_order_id, v_number, NEW.work_order_number;
    END IF;
    IF v_fp <> NEW.fingerprint THEN
        RAISE EXCEPTION 'WORK_ORDER_QUARANTINE_PIN_MISMATCH: % changed since it was pinned (fingerprint %)', NEW.work_order_id, v_fp;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER work_order_quarantine_pin BEFORE INSERT ON work_order_quarantine
    FOR EACH ROW EXECUTE FUNCTION work_order_quarantine_verify_pin();

CREATE FUNCTION work_order_quarantine_refuse_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'work_order_quarantine is append-only: a quarantine is lifted only by a reviewed migration';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER work_order_quarantine_append_only BEFORE UPDATE OR DELETE ON work_order_quarantine
    FOR EACH ROW EXECUTE FUNCTION work_order_quarantine_refuse_change();

-- Down Migration
SET search_path = eos_ops, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.work_order_quarantine;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_QUARANTINE: refuses to reverse -- % Work Order(s) are quarantined; reversing would return them to operations', v_n;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS work_order_quarantine_append_only ON work_order_quarantine;
DROP FUNCTION IF EXISTS work_order_quarantine_refuse_change();
DROP TRIGGER IF EXISTS work_order_quarantine_pin ON work_order_quarantine;
DROP FUNCTION IF EXISTS work_order_quarantine_verify_pin();
DROP TABLE IF EXISTS work_order_quarantine;
DROP FUNCTION IF EXISTS work_order_pin_fingerprint(eos_ops.work_orders);
