-- Up Migration
--
-- THE WORK ORDER PARTS PLAN -- "plan these parts for this Work Order", as a governed relation.
--
-- ════════════════════ WHY A CHILD TABLE ════════════════════
--
-- The legacy plan lives in `WorkOrder.inventorySnapshot[]`, a JSON array on the Work Order document.
-- Migration 1761004800000 already made this call once, for Sales Order line references: "a relationship
-- with its own cardinality is a child table, not a JSON array no key can check". The same is true here and
-- the array has already cost something real -- the legacy command's IDENTITY_AMBIGUOUS and SKU_CONFLICT
-- refusals exist ONLY because an array cannot have a primary key, so two rows could claim the same Part by
-- different identifiers and nothing structural could stop them. Here (tenant_id, work_order_id, part_id)
-- is the key, and both failures become unrepresentable rather than caught.
--
-- ════════════════════ PLAN != RESERVE != USE ════════════════════
--
-- The legacy command's first invariant, preserved structurally. This table carries qty_planned and nothing
-- else about quantity. There is deliberately NO qty_used column:
--
--   * reserved / consumed / released are `eos_ops.inventory_commitments` rows, written by
--     reconcileConsumption. That is the commitment authority and this is not a second one.
--   * a qty_used column here would be a second answer to "how much was used", free to disagree with the
--     commitment ledger, and the disagreement would decide whether a customer is billed for the part.
--
-- "A part with recorded usage cannot be un-planned" (the legacy USED_PART_REMOVAL rule) is therefore
-- answered by READING the commitment ledger, not by reading a column here.
--
-- ════════════════════ NO PART DESCRIPTION IS COPIED ════════════════════
--
-- No name, no sku, no internal part number. The legacy row carries `sku` because the live
-- updateWorkOrderExecutionData matches its rows BY sku -- a Firestore array-matching mechanism, not a
-- business fact about the plan. Copying it here would make this table a second Part Master for exactly the
-- fields most likely to be edited, and a plan showing last year's part name is the stale read that looks
-- correct. The Part id resolves against eos_ops.parts, which is the authority.
--
-- ════════════════════ THE PART REFERENCE IS OPAQUE, LIKE EVERY OTHER CROSS-DOMAIN ID ════════════════════
--
-- `part_id` carries NO foreign key into eos_ops.parts, matching the deliberate reversal migration
-- 1761004800000 records for customer_id / location_id / sales_order_id: a cross-domain foreign key couples
-- two domains' test lifecycles together forever. Existence is validated at the command boundary, once,
-- against the PostgreSQL Part policy authority -- and unlike those ids, this one lives in the same schema,
-- which makes the temptation to add the constraint stronger and the reason not to identical.

SET search_path = eos_ops, public;

CREATE TABLE work_order_parts_plan (
    tenant_id       TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    work_order_id   TEXT        NOT NULL,
    part_id         TEXT        NOT NULL,

    -- A planned requirement of zero is not a requirement. The legacy validator already refuses it
    -- (isPositiveInt), so a zero row could only arrive from a new caller, and it would read as "planned,
    -- none needed" -- which is a removal wearing a plan's clothes.
    qty_planned     INTEGER     NOT NULL CHECK (qty_planned > 0),

    -- WHO AND WHEN, per requirement rather than per plan. A plan is edited a line at a time by different
    -- people; one timestamp on the Work Order would lose which requirement each person actually added.
    planned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    planned_by      TEXT        NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT        NOT NULL,

    -- Optimistic concurrency, matching the Part/Work Order convention in this schema: a caller states the
    -- version it read, and two planners editing the same requirement cannot silently overwrite each other.
    version         INTEGER     NOT NULL DEFAULT 1 CHECK (version > 0),

    PRIMARY KEY (tenant_id, work_order_id, part_id),
    CONSTRAINT work_order_parts_plan_work_order_fk FOREIGN KEY (tenant_id, work_order_id)
        REFERENCES work_orders (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT work_order_parts_plan_part_stated CHECK (btrim(part_id) <> ''),
    CONSTRAINT work_order_parts_plan_actor_stated CHECK (btrim(planned_by) <> '' AND btrim(updated_by) <> '')
);

-- "What is planned for this Work Order" is the read the plan screen makes; the primary key already serves
-- it. This index serves the OTHER direction -- "which open Work Orders want this Part" -- which is what
-- procurement and the reorder surfaces ask.
CREATE INDEX work_order_parts_plan_by_part ON work_order_parts_plan (tenant_id, part_id);

-- Down Migration
SET search_path = eos_ops, public;

DROP INDEX IF EXISTS work_order_parts_plan_by_part;
DROP TABLE IF EXISTS work_order_parts_plan;
