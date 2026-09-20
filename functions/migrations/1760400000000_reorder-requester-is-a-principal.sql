-- Up Migration
-- REORDER requested_by IS A GOVERNED PRINCIPAL -- Owner ruling, Reorder Domain Cutover.
--
-- ============================================================================
-- MIGRATION 037. `eos_ops.reorder_requests.requested_by` gains a same-tenant Principal foreign key,
-- with NULL permitted so a MIGRATED row can state an unrecoverable historical requester truthfully.
-- ============================================================================
--
-- ════════════════════ WHY THIS COULD NOT BE ADDED IN MIGRATION 035 ════════════════════
--
-- It was, and it failed -- which is how the problem was found. Every Reorder the governed
-- sample-company seed writes violated it, because `purchasingRepository.createReorderRequest` took
-- an `actorId` and the seed passed `options.performedBy`, an operator token.
--
-- The conclusion drawn at the time was that the whole eos_ops actor convention meant "operator
-- token". The OWNER RULING is narrower and is the one implemented here: for the REORDER domain the
-- governed runtime actor is an EOS Principal, and the seed-only repository path does not get to
-- define that. So the repository parameter is renamed `requestedByPrincipalId`, the seed passes the
-- administering Principal it already resolved, and the column is constrained to say so.
--
-- ════════════════════ WHAT IS DELIBERATELY NOT HERE ════════════════════
--
-- `updated_by` on this same table is NOT constrained. recordPurchaseOrder and voidPurchaseOrder
-- write it from the same parameter they use for `purchase_orders.created_by` and
-- `purchase_order_voids.voided_by`, so constraining it here would pull two more tables -- and their
-- writers -- into a Reorder cutover. The ruling says to record that broader actor normalization
-- separately rather than perform it in passing, and this note is that record:
--
--   BROADER ACTOR NORMALIZATION, NOT DONE HERE:
--     eos_ops.reorder_requests.updated_by
--     eos_ops.purchase_orders.created_by
--     eos_ops.purchase_order_voids.voided_by
--     eos_ops.receiving_orders.created_by / updated_by
--     eos_crm and eos_ops location/truck created_by / updated_by
--   All currently receive whatever their caller passes as an actor, which for the sample-company
--   seed is an operator token. Each needs the same ruling this one got, and each needs its writers
--   changed with it.
--
-- NOT VALID: the constraint governs every future write without rewriting history, exactly as the
-- Commercial parity migration's account foreign key does.

SET search_path = eos_ops, public;

ALTER TABLE reorder_requests
    ADD CONSTRAINT reorder_requested_by_member_fk
        FOREIGN KEY (tenant_id, requested_by)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id) NOT VALID;

-- Down Migration
SET search_path = eos_ops, public;

ALTER TABLE reorder_requests DROP CONSTRAINT IF EXISTS reorder_requested_by_member_fk;
