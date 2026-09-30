-- Up Migration
-- CUSTOMER SELF-SCHEDULING (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30, increment C).
--
-- Built ON the existing PostgreSQL scheduling and Technician availability engine (workOrderAvailability.ts,
-- workOrderScheduling.ts) -- there is no second engine and no customer-only schedule record:
--
--     eligible Work Order -> governed scheduling session -> slots from THE availability engine, inside the governed
--     window -> the customer selects one -> EOS revalidates it -> the governed scheduleWorkOrder command -> the SAME
--     eos_ops.work_orders / work_order_assignments rows the Service Office reads.
--
-- ════════════════════ THE GOVERNED WINDOW (configuration, never hardcoded) ════════════════════
--
-- self_scheduling_policies: per tenant, optionally narrowed to an operating company and / or a Work Order type. The
-- most specific enabled policy applies: (company, type) > (company, any) > (any, type) > (any, any). NO POLICY -> no
-- self-scheduling (refused SELF_SCHEDULING_NOT_CONFIGURED); there is no built-in default window.
--     earliest_offset_minutes   nothing is offered sooner than now + this
--     horizon_days              nothing is offered later than now + this
--     default_duration_minutes  the visit length when the Work Order carries no estimate (else the estimate governs)
--     slot_increment_minutes, max_offered_slots, session_ttl_minutes, time_zone (how the customer sees the grid)
--
-- ════════════════════ THE SESSION (no EOS login, no general access) ════════════════════
--
-- self_scheduling_sessions: ONE governed Work Order, ONE purpose. The token is 32 random bytes shown ONCE at issue;
-- only its sha256 is stored (a database read yields nothing presentable). It expires; it is single-use (COMPLETED);
-- issuing a new one SUPERSEDES the old. The customer-facing projection carries no tenant, customer, Work Order or
-- Technician identifier. self_scheduling_session_events is the APPEND-ONLY history (issued, viewed, selected,
-- refused-stale, revoked, superseded).
--
-- CAPABILITIES: TWO, REGISTERED WITH NO GRANT (definition != grant), on the existing workOrder Object:
--     workOrder.selfScheduling.issue       issue / revoke a customer scheduling link for one eligible Work Order
--     workOrder.selfScheduling.configure   ADMINISTRATIVE: create and change the self-scheduling policies
--
-- Counts: capabilities +2; role_capabilities +0.
SET search_path = eos_policy, public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM capabilities WHERE key IN ('workOrder.selfScheduling.issue', 'workOrder.selfScheduling.configure')) THEN
        RAISE EXCEPTION 'CUSTOMER_SELF_SCHEDULING: a self-scheduling capability is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_workOrder_selfScheduling_issue', 'workOrder.selfScheduling.issue',
     'Issue (or revoke) a customer self-scheduling link for ONE eligible, unscheduled Work Order. The customer then chooses a slot from governed availability; the booking is performed by the governed scheduleWorkOrder command under this issuer''s authority, re-checked at selection. Requires workOrder.lifecycle.schedule as well.',
     'workOrder', 'issueSchedulingLink', 'BUSINESS_ACTION', 'Issue Customer Scheduling Link'),
    ('cap_workOrder_selfScheduling_configure', 'workOrder.selfScheduling.configure',
     'ADMINISTRATIVE CONFIGURATION: create and change the customer self-scheduling policies -- the earliest offered slot, the maximum scheduling horizon, the default visit length, the slot grid and the link lifetime, per operating company and Work Order type. Confers no scheduling authority.',
     'workOrder', 'configureSelfScheduling', 'ADMIN_ACTION', 'Configure Customer Self-Scheduling')
ON CONFLICT (key) DO NOTHING;

SET search_path = eos_ops, public;

CREATE TABLE self_scheduling_policies (
    tenant_id                  TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    id                         TEXT        NOT NULL,
    operating_company_id       TEXT,
    work_order_type            TEXT,
    enabled                    BOOLEAN     NOT NULL DEFAULT true,
    earliest_offset_minutes    INTEGER     NOT NULL,
    horizon_days               INTEGER     NOT NULL,
    default_duration_minutes   INTEGER,
    slot_increment_minutes     INTEGER     NOT NULL DEFAULT 30,
    max_offered_slots          INTEGER     NOT NULL DEFAULT 40,
    session_ttl_minutes        INTEGER     NOT NULL,
    time_zone                  TEXT        NOT NULL,
    version                    INTEGER     NOT NULL DEFAULT 1,
    updated_by_principal_id    TEXT        NOT NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT self_sched_policy_id_shape CHECK (id ~ '^[A-Za-z0-9_-]{1,120}$'),
    CONSTRAINT self_sched_policy_type_known CHECK (work_order_type IS NULL OR work_order_type IN ('SERVICE_CALL', 'PM', 'INSTALL', 'WARRANTY', 'INSPECTION')),
    CONSTRAINT self_sched_policy_earliest CHECK (earliest_offset_minutes BETWEEN 0 AND 43200),
    CONSTRAINT self_sched_policy_horizon CHECK (horizon_days BETWEEN 1 AND 60),
    CONSTRAINT self_sched_policy_window_nonempty CHECK (earliest_offset_minutes < horizon_days * 1440),
    CONSTRAINT self_sched_policy_duration CHECK (default_duration_minutes IS NULL OR default_duration_minutes BETWEEN 15 AND 1440),
    CONSTRAINT self_sched_policy_increment CHECK (slot_increment_minutes IN (15, 30, 60)),
    CONSTRAINT self_sched_policy_max_slots CHECK (max_offered_slots BETWEEN 1 AND 200),
    CONSTRAINT self_sched_policy_ttl CHECK (session_ttl_minutes BETWEEN 15 AND 20160)
);
-- One policy per applicability.
CREATE UNIQUE INDEX self_sched_policy_one_per_scope ON self_scheduling_policies
    (tenant_id, COALESCE(operating_company_id, ''), COALESCE(work_order_type, ''));

CREATE TABLE self_scheduling_sessions (
    tenant_id                TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    id                       TEXT        NOT NULL,
    token_sha256             TEXT        NOT NULL,
    work_order_id            TEXT        NOT NULL,
    status                   TEXT        NOT NULL DEFAULT 'ACTIVE',
    issued_by_principal_id   TEXT        NOT NULL,
    issued_at                TIMESTAMPTZ NOT NULL,
    expires_at               TIMESTAMPTZ NOT NULL,
    policy_id                TEXT        NOT NULL,
    policy_version           INTEGER     NOT NULL,
    delivery_channel         TEXT        NOT NULL DEFAULT 'LINK',
    selected_start           TIMESTAMPTZ,
    selected_end             TIMESTAMPTZ,
    selected_employee_id     TEXT,
    completed_at             TIMESTAMPTZ,
    closed_by_principal_id   TEXT,
    closed_reason            TEXT,
    closed_at                TIMESTAMPTZ,
    version                  INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT self_sched_session_token_is_a_hash CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT self_sched_session_token_unique UNIQUE (token_sha256),
    CONSTRAINT self_sched_session_work_order_fk FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id),
    CONSTRAINT self_sched_session_policy_fk FOREIGN KEY (tenant_id, policy_id) REFERENCES self_scheduling_policies (tenant_id, id),
    CONSTRAINT self_sched_session_status_known CHECK (status IN ('ACTIVE', 'COMPLETED', 'REVOKED', 'SUPERSEDED')),
    CONSTRAINT self_sched_session_channel_known CHECK (delivery_channel IN ('LINK')),
    CONSTRAINT self_sched_session_window CHECK (expires_at > issued_at),
    CONSTRAINT self_sched_session_completed_whole CHECK (
        (status = 'COMPLETED') = (completed_at IS NOT NULL AND selected_start IS NOT NULL AND selected_end IS NOT NULL AND selected_employee_id IS NOT NULL)),
    CONSTRAINT self_sched_session_closed_whole CHECK ((status IN ('REVOKED', 'SUPERSEDED')) = (closed_at IS NOT NULL))
);
-- At most one live link per Work Order: issuing another SUPERSEDES it.
CREATE UNIQUE INDEX self_sched_session_one_active ON self_scheduling_sessions (tenant_id, work_order_id) WHERE status = 'ACTIVE';

CREATE TABLE self_scheduling_session_events (
    id             TEXT        PRIMARY KEY,
    -- Insertion order breaks same-instant ties deterministically; the random id never orders history.
    event_seq      BIGINT      GENERATED ALWAYS AS IDENTITY,
    tenant_id      TEXT        NOT NULL,
    session_id     TEXT        NOT NULL,
    event_kind     TEXT        NOT NULL,
    detail         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    occurred_at    TIMESTAMPTZ NOT NULL,
    CONSTRAINT self_sched_event_session_fk FOREIGN KEY (tenant_id, session_id) REFERENCES self_scheduling_sessions (tenant_id, id),
    CONSTRAINT self_sched_event_kind_known CHECK (event_kind IN ('ISSUED', 'VIEWED', 'SELECTED', 'REFUSED', 'REVOKED', 'SUPERSEDED'))
);
CREATE INDEX self_sched_events_by_session ON self_scheduling_session_events (tenant_id, session_id, occurred_at, event_seq);

CREATE FUNCTION self_scheduling_refuse_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: self-scheduling history is never edited or removed', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER self_scheduling_session_events_append_only BEFORE UPDATE OR DELETE ON self_scheduling_session_events
    FOR EACH ROW EXECUTE FUNCTION self_scheduling_refuse_change();
CREATE TRIGGER self_scheduling_sessions_retained BEFORE DELETE ON self_scheduling_sessions
    FOR EACH ROW EXECUTE FUNCTION self_scheduling_refuse_change();

-- Down Migration
SET search_path = eos_policy, public;
DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capabilities
     WHERE capability_id IN ('cap_workOrder_selfScheduling_issue', 'cap_workOrder_selfScheduling_configure');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'CUSTOMER_SELF_SCHEDULING: refuses to reverse -- self-scheduling capabilities are held by % Role grant(s)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities
     WHERE capability_id IN ('cap_workOrder_selfScheduling_issue', 'cap_workOrder_selfScheduling_configure');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'CUSTOMER_SELF_SCHEDULING: refuses to reverse -- self-scheduling capabilities are held by % direct grant(s)', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions
         WHERE capability_key IN ('workOrder.selfScheduling.issue', 'workOrder.selfScheduling.configure');
        IF v_n > 0 THEN
            RAISE EXCEPTION 'CUSTOMER_SELF_SCHEDULING: refuses to reverse -- % Administration decision(s) name a self-scheduling capability', v_n;
        END IF;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.self_scheduling_sessions;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'CUSTOMER_SELF_SCHEDULING: refuses to reverse -- % scheduling session(s) are retained evidence', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.self_scheduling_policies;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'CUSTOMER_SELF_SCHEDULING: refuses to reverse -- % self-scheduling polic(ies) are configured', v_n;
    END IF;
END
$$;
SET search_path = eos_ops, public;
DROP TRIGGER IF EXISTS self_scheduling_session_events_append_only ON self_scheduling_session_events;
DROP TRIGGER IF EXISTS self_scheduling_sessions_retained ON self_scheduling_sessions;
DROP FUNCTION IF EXISTS self_scheduling_refuse_change();
DROP TABLE IF EXISTS self_scheduling_session_events;
DROP TABLE IF EXISTS self_scheduling_sessions;
DROP TABLE IF EXISTS self_scheduling_policies;
DELETE FROM eos_policy.capabilities WHERE id IN ('cap_workOrder_selfScheduling_issue', 'cap_workOrder_selfScheduling_configure');
