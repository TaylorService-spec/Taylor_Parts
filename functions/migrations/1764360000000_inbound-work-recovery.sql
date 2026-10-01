-- Up Migration
-- INBOUND WORK RECOVERY: RELEASE / REASSIGN (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30, increment B).
--
-- WHAT IS RECOVERED. An Inbound Work item a reviewer has ACCEPTED -- the governed ACCEPTING claim
-- (inbound_work_requests.status = 'ACCEPTING', accept_claimed_by_principal_id) -- that did not finish: the reviewer's
-- Accept was interrupted (a lost response, a closed browser, a crash between the Work Order create and the record),
-- and until now only that same Principal could ever complete it (ACCEPT_IN_PROGRESS for everyone else). A completed
-- intake (ACCEPTED / ATTACHED / DECLINED) is a decision, not a claim, and is NOT recoverable here.
--
--     RELEASE   ACCEPTING  -> the review queue (the status it was claimed from)
--     REASSIGN  ACCEPTING  -> ACCEPTING, claimed by ANOTHER eligible reviewer (an Employee, never a raw Principal id)
--
-- ONE INTAKE, ONE WORK ORDER, STILL. The Work Order create is idempotent PER CREATOR (tenant, creator, key), so a
-- claim released after its claimant's create committed would let the next reviewer mint a second Work Order. Recovery
-- therefore CARRIES any Work Order the original claimant already created (accept_pending_work_order_id) and the next
-- Accept links THAT Work Order instead of creating one.
--
-- HISTORY IS NEVER REWRITTEN. inbound_work_claim_events is APPEND-ONLY: every claim (CLAIMED), release (RELEASED),
-- reassignment (REASSIGNED) and completion (COMPLETED) keeps who held the claim, who acted, the new claimant, when,
-- why, and the audit event it was recorded with. The original reviewer and the original accepted timestamp are the
-- CLAIMED row; nothing overwrites it.
--
-- CAPABILITY: ONE, REGISTERED WITH NO GRANT (definition != grant). inboundWork.request.recover on the existing
-- inboundWorkRequest Object. The ruled holder is the canonical Service Manager (fieldManager) -- applied later through
-- the Administration API, never by this migration. Recovery is SERVICE-domain only: an intake routed to PARTS / SALES /
-- OTHER is refused (a Parts-specific recovery authority is a separate, unruled boundary).
--
-- Counts: capabilities +1; role_capabilities +0.
SET search_path = eos_policy, public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM capabilities WHERE key = 'inboundWork.request.recover') THEN
        RAISE EXCEPTION 'INBOUND_WORK_RECOVERY: inboundWork.request.recover is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inboundWork_request_recover', 'inboundWork.request.recover',
     'RECOVER an accepted-but-unfinished Service Inbound Work item: RELEASE the reviewer''s claim back to the review queue, or REASSIGN it to another eligible reviewer (an Employee whose linked Principal may accept Inbound Work). History is preserved; a Work Order the original reviewer already created is carried forward, never duplicated. Service-domain intake only. Confers no Accept, Decline or Attach authority.',
     'inboundWorkRequest', 'recover', 'BUSINESS_ACTION', 'Recover Inbound Work')
ON CONFLICT (key) DO NOTHING;

SET search_path = eos_ops, public;

ALTER TABLE inbound_work_requests
    ADD COLUMN accept_claimed_at            TIMESTAMPTZ,
    ADD COLUMN accept_pending_work_order_id TEXT,
    ADD CONSTRAINT inbound_request_pending_work_order_fk FOREIGN KEY (tenant_id, accept_pending_work_order_id) REFERENCES work_orders (tenant_id, id);

CREATE TABLE inbound_work_claim_events (
    id                          TEXT        PRIMARY KEY,
    -- Insertion order: one Accept records CLAIMED and COMPLETED at the same logical instant, so history is ordered by
    -- (occurred_at, event_seq), never by the random id.
    event_seq                   BIGINT      GENERATED ALWAYS AS IDENTITY,
    tenant_id                   TEXT        NOT NULL,
    request_id                  TEXT        NOT NULL,
    event_kind                  TEXT        NOT NULL,
    -- The claim holder BEFORE this event (null for CLAIMED) and AFTER it (null for RELEASED / COMPLETED).
    from_principal_id           TEXT,
    to_principal_id             TEXT,
    to_employee_id              TEXT,
    actor_principal_id          TEXT        NOT NULL,
    reason                      TEXT,
    carried_work_order_id       TEXT,
    occurred_at                 TIMESTAMPTZ NOT NULL,
    audit_event_id              TEXT,
    CONSTRAINT inbound_claim_event_request_fk FOREIGN KEY (tenant_id, request_id) REFERENCES inbound_work_requests (tenant_id, id),
    CONSTRAINT inbound_claim_event_kind_known CHECK (event_kind IN ('CLAIMED', 'RELEASED', 'REASSIGNED', 'COMPLETED')),
    CONSTRAINT inbound_claim_event_shape CHECK (
        (event_kind = 'CLAIMED' AND to_principal_id IS NOT NULL)
        OR (event_kind = 'RELEASED' AND from_principal_id IS NOT NULL AND to_principal_id IS NULL AND reason IS NOT NULL)
        OR (event_kind = 'REASSIGNED' AND from_principal_id IS NOT NULL AND to_principal_id IS NOT NULL AND to_employee_id IS NOT NULL
            AND from_principal_id <> to_principal_id AND reason IS NOT NULL)
        OR (event_kind = 'COMPLETED' AND from_principal_id IS NOT NULL)),
    CONSTRAINT inbound_claim_event_reason_bounded CHECK (reason IS NULL OR (btrim(reason) <> '' AND length(reason) <= 500))
);
CREATE INDEX inbound_claim_events_by_request ON inbound_work_claim_events (tenant_id, request_id, occurred_at, event_seq);
CREATE TRIGGER inbound_work_claim_events_append_only BEFORE UPDATE OR DELETE ON inbound_work_claim_events
    FOR EACH ROW EXECUTE FUNCTION inbound_work_refuse_change();

-- Down Migration
SET search_path = eos_policy, public;
DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capabilities WHERE capability_id = 'cap_inboundWork_request_recover';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_WORK_RECOVERY: refuses to reverse -- inboundWork.request.recover is held by % Role grant(s)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities WHERE capability_id = 'cap_inboundWork_request_recover';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_WORK_RECOVERY: refuses to reverse -- inboundWork.request.recover is held by % direct grant(s)', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions WHERE capability_key = 'inboundWork.request.recover';
        IF v_n > 0 THEN
            RAISE EXCEPTION 'INBOUND_WORK_RECOVERY: refuses to reverse -- % Administration decision(s) name inboundWork.request.recover', v_n;
        END IF;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.inbound_work_claim_events;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_WORK_RECOVERY: refuses to reverse -- % claim history event(s) are retained evidence', v_n;
    END IF;
END
$$;
SET search_path = eos_ops, public;
DROP TRIGGER IF EXISTS inbound_work_claim_events_append_only ON inbound_work_claim_events;
DROP TABLE IF EXISTS inbound_work_claim_events;
ALTER TABLE inbound_work_requests
    DROP CONSTRAINT IF EXISTS inbound_request_pending_work_order_fk,
    DROP COLUMN IF EXISTS accept_pending_work_order_id,
    DROP COLUMN IF EXISTS accept_claimed_at;
DELETE FROM eos_policy.capabilities WHERE id = 'cap_inboundWork_request_recover';
