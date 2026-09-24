-- Up Migration
-- THE NATIVE WORK ORDER CAPABILITY VOCABULARY -- the two keys the effect-boundary packet left out.
--
-- ════════════════════ WHAT WAS ALREADY HERE, AND WHY IT WAS NOT ENOUGH ════════════════════
--
-- Migration 1757894400000 catalogued three Work Order keys and said exactly why only three:
--
--     workOrder.lifecycle.dispatch / .cancel / .complete
--       "... the WO transitions (Dispatch, Cancel, Complete) that drive inventoryService.ts's
--        triggerInventoryEffects() -- the RESERVED / RELEASED / CONSUMED commitment writes ...
--        Scoped to exactly these three actions, not the full ACTION_PERMISSIONS table
--        (MarkReady/Schedule/Unschedule/Accept/Travel/Arrive/WorkStart are not part of the
--        inventory-authority writer boundary and are out of this packet's scope)."
--
-- That packet was about the INVENTORY WRITER BOUNDARY, not about Work Orders. It never claimed to
-- cover creating a Work Order or moving one through an edge that writes no commitment, and it said
-- so. This migration adds exactly those two, and nothing else.
--
-- ════════════════════ WHY NOT `workOrder.cancel` ════════════════════
--
-- Because `workOrder.lifecycle.cancel` already exists and already means it: "Transition a Work Order
-- to CANCELLED, closing its open RESERVED inventory commitment as RELEASED." Adding a second key for
-- the same governed act would give one business action two names in one authority, and the two would
-- be granted separately, drift, and eventually disagree about who may cancel. The Owner ruling is to
-- reuse the existing key, and the native lifecycle engine is corrected to ask for it.
--
-- ════════════════════ THE SPECIFIC KEY IS NOT A SUBSET OF THE GENERAL ONE ════════════════════
--
-- `workOrder.transition` does NOT authorize dispatch, cancel or complete. Those three edges each fire
-- an inventory effect and each already has a dedicated key; letting the general capability stand in
-- for them would make the specific keys decorative -- a caller holding only `workOrder.transition`
-- could reserve, release or consume stock. The lifecycle engine maps each edge to exactly one
-- capability and a test proves the general key appears on none of the three.
--
-- VOCABULARY IS NOT A GRANT. These rows make the keys nameable. No role_capabilities row is written
-- here: grants are reconciled from the governed Role catalog by the established operator tool, which
-- is a separate, reviewable act.

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_workOrder_create',
     'workOrder.create',
     'Create a native Work Order through the governed PostgreSQL Work Order authority: the record, its allocated business number and its opening lifecycle evidence, in one transaction.'),
    ('cap_workOrder_transition',
     'workOrder.transition',
     'Execute an allowed NON-EFFECT Work Order lifecycle transition through the governed lifecycle engine. Deliberately does NOT authorize dispatch, cancel or complete -- each of those writes an inventory commitment and carries its own workOrder.lifecycle.* capability.');

-- Down Migration
SET search_path = eos_policy, public;

DELETE FROM capabilities WHERE id IN ('cap_workOrder_create', 'cap_workOrder_transition');
