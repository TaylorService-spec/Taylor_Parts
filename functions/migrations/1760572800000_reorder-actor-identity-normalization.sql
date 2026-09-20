-- Up Migration
-- REORDER-OWNED ACTOR COLUMNS ARE GOVERNED PRINCIPALS -- Owner Ruling B, Reorder Domain Cutover.
--
-- ============================================================================
-- MIGRATION 039. The actor columns THIS CUTOVER ACTIVELY OWNS gain same-tenant Principal foreign
-- keys, so the identity is enforced structurally rather than by string shape.
-- ============================================================================
--
-- ════════════════════ WHAT IS IN SCOPE, AND WHY THESE AND NOT EVERY COLUMN ════════════════════
--
-- The target runtime actor is an EOS Principal. This migration takes the columns the Reorder slice
-- writes through its own governed commands -- so every writer is code this cutover changed, and the
-- constraint can be satisfied rather than merely declared:
--
--   eos_ops.reorder_requests.updated_by                  every governed lifecycle command
--   eos_ops.purchase_orders.created_by                   recordReorderPurchaseOrder
--   eos_ops.purchase_order_voids.voided_by               voidReorderPurchaseOrder
--
-- `reorder_requests.requested_by` already gained its key in migration 037; the five
-- `*_by_principal_id` lifecycle columns gained theirs in migration 035. Together with these three,
-- every actor column the Reorder business slice writes is now a governed Principal.
--
-- DELIBERATELY OUT OF SCOPE, and recorded as its own workstream rather than done in passing:
--
--   ══════════ EOS OPS ACTOR IDENTITY NORMALIZATION (future workstream) ══════════
--   eos_ops.receiving_orders.created_by / updated_by
--   eos_ops.warehouses.created_by / updated_by
--   eos_ops.bins, mobile_locations, trucks created_by / updated_by
--   eos_ops.inventory_movements, cycle_count_* actor columns
--   eos_crm.accounts / contacts / account_ownership_history actor columns
--   eos_commercial opportunity / agreement / order actor columns
--   and every other generic created_by / updated_by / *_by column in eos_ops and eos_crm.
--
--   Each still receives whatever its caller passes -- for the sample-company seed, an operator
--   token. Normalizing them means changing their writers, which is a different slice for each
--   domain, and doing it here would re-specify an identity convention for several schemas on the
--   way past a Reorder cutover.
--
-- MIGRATED historical unknowns stay truthfully nullable ONLY where already ruled: that is
-- `reorder_requests.requested_by` (migration 037) and the five lifecycle actor columns (035).
-- The three columns below are NOT NULL and stay NOT NULL -- nothing migrated writes them, because a
-- copied Reorder brings no purchase order and no void with it.
--
-- NOT VALID: governs every future write without rewriting history, as the Commercial parity
-- migration's account foreign key does.

SET search_path = eos_ops, public;

ALTER TABLE reorder_requests
    ADD CONSTRAINT reorder_updated_by_member_fk
        FOREIGN KEY (tenant_id, updated_by)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id) NOT VALID;

ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_order_created_by_member_fk
        FOREIGN KEY (tenant_id, created_by)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id) NOT VALID;

ALTER TABLE purchase_order_voids
    ADD CONSTRAINT purchase_order_void_voided_by_member_fk
        FOREIGN KEY (tenant_id, voided_by)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id) NOT VALID;

-- Down Migration
SET search_path = eos_ops, public;

ALTER TABLE purchase_order_voids DROP CONSTRAINT IF EXISTS purchase_order_void_voided_by_member_fk;
ALTER TABLE purchase_orders      DROP CONSTRAINT IF EXISTS purchase_order_created_by_member_fk;
ALTER TABLE reorder_requests     DROP CONSTRAINT IF EXISTS reorder_updated_by_member_fk;
