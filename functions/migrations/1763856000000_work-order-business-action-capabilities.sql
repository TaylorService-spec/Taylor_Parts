-- Up Migration
-- WORK ORDER BUSINESS-ACTION CAPABILITIES (Controller rulings DQ-010 / DQ-011, 2026-09-28). Vocabulary only.
--
-- DQ-010: the governed PostgreSQL lifecycle gated every non-effect edge with the single broad
-- `workOrder.transition`, which the baseline grants to eleven Roles (technician, partsAssociate,
-- shopAssociate, generalManager, owner, ...). The live process (transitionEngine.ts ACTION_PERMISSIONS)
-- distinguishes MarkReady, Schedule/Unschedule and Close as dispatcher-bucket actions, distinct from the
-- technician runtime. The ruling: replace the broad gate for those materially distinct actions with DISTINCT
-- governed BUSINESS_ACTION capabilities, in the existing workOrder.lifecycle.* family, with NO legacy or
-- default grants:
--
--     workOrder.lifecycle.ready      workOrder / markReady   CREATED   -> READY_TO_DISPATCH
--     workOrder.lifecycle.schedule   workOrder / schedule    READY_TO_DISPATCH <-> SCHEDULED (schedule, unschedule)
--     workOrder.lifecycle.close      workOrder / close       COMPLETED -> CLOSED
--
-- (dispatch / cancel / complete already exist as workOrder.lifecycle.*; the technician runtime edges
-- accept / startTravel / arrive / startWork keep workOrder.transition.)
--
-- DQ-011: register `workOrder.parts.plan` (workOrder / planParts), the key workOrderPartsPlanAuthority.ts
-- already requires, so the governed parts-plan command is reachable once Administration grants it.
--
-- NO GRANTS. Not one role_capabilities row: who holds these is an Administration decision (Object Security
-- -> Work Order -> action), never a migration. Until then every one of these edges fails closed with
-- CAPABILITY_MISSING, which is the ruling working.
--
-- Counts: capabilities +4; role_capabilities +0.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key IN ('workOrder.lifecycle.ready', 'workOrder.lifecycle.schedule', 'workOrder.lifecycle.close', 'workOrder.parts.plan')
        OR (object_key = 'workOrder' AND action_key IN ('markReady', 'schedule', 'close', 'planParts'));
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_BUSINESS_ACTIONS: % of the four keys / (Object, action) pairs are already registered', v_n;
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_workOrder_lifecycle_ready', 'workOrder.lifecycle.ready',
     'Mark a CREATED Work Order ready to dispatch (CREATED -> READY_TO_DISPATCH). Controller ruling DQ-010. Confers no scheduling, dispatch, completion or close authority.',
     'workOrder', 'markReady', 'BUSINESS_ACTION', 'Mark Work Order Ready'),
    ('cap_workOrder_lifecycle_schedule', 'workOrder.lifecycle.schedule',
     'Schedule a ready Work Order, or return a scheduled one to the queue (READY_TO_DISPATCH <-> SCHEDULED; Owner ruling ND-18 keeps Unschedule in the Schedule bucket). Controller ruling DQ-010. Confers no dispatch (reservation) authority.',
     'workOrder', 'schedule', 'BUSINESS_ACTION', 'Schedule Work Order'),
    ('cap_workOrder_lifecycle_close', 'workOrder.lifecycle.close',
     'Close a COMPLETED Work Order (COMPLETED -> CLOSED). Controller ruling DQ-010. Confers no completion authority.',
     'workOrder', 'close', 'BUSINESS_ACTION', 'Close Work Order'),
    ('cap_workOrder_parts_plan', 'workOrder.parts.plan',
     'Plan the parts a Work Order requires (the governed setPartsPlan command). Controller ruling DQ-011. Planning is not reserving and not consuming.',
     'workOrder', 'planParts', 'BUSINESS_ACTION', 'Plan Work Order Parts')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capability_decisions
     WHERE capability_key IN ('workOrder.lifecycle.ready', 'workOrder.lifecycle.schedule', 'workOrder.lifecycle.close', 'workOrder.parts.plan');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_BUSINESS_ACTIONS: refuses to reverse -- % Administration decision(s) name these capabilities', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM role_capabilities
     WHERE capability_id IN ('cap_workOrder_lifecycle_ready', 'cap_workOrder_lifecycle_schedule', 'cap_workOrder_lifecycle_close', 'cap_workOrder_parts_plan');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_BUSINESS_ACTIONS: refuses to reverse -- these capabilities are held by % Role grant(s)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities
     WHERE capability_id IN ('cap_workOrder_lifecycle_ready', 'cap_workOrder_lifecycle_schedule', 'cap_workOrder_lifecycle_close', 'cap_workOrder_parts_plan');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_BUSINESS_ACTIONS: refuses to reverse -- these capabilities are held by % direct grant(s)', v_n;
    END IF;
    DELETE FROM capabilities
     WHERE id IN ('cap_workOrder_lifecycle_ready', 'cap_workOrder_lifecycle_schedule', 'cap_workOrder_lifecycle_close', 'cap_workOrder_parts_plan');
END
$$;
