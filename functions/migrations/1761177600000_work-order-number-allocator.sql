-- Up Migration
-- THE NATIVE WORK ORDER NUMBER ALLOCATOR -- governed, tenant-scoped, concurrency-safe.
--
-- ════════════════════ THE SCOPE IS NOT A CHOICE MADE HERE ════════════════════
--
-- It is already governed by two independent pieces of existing evidence, and this table follows them
-- rather than deciding anything:
--
--   1. migration 1761004800000 declares
--        CREATE UNIQUE INDEX work_orders_number_unique ON work_orders (tenant_id, work_order_number)
--      Uniqueness is (TENANT, NUMBER). Not global, and NOT per operating company -- had numbering been
--      company-scoped the index would have carried operating_company_key, and it deliberately does not.
--      A Taylor and a Ventana Work Order in one tenant therefore draw from ONE sequence.
--
--   2. eos_commercial.number_counters (migration 1759449600000) is this platform's established
--      allocator, keyed (tenant_id, series, year). Same shape, same idiom.
--
-- The legacy Firestore allocator agrees: one counter document per YEAR, format WO-YYYY-######.
--
-- ════════════════════ WHY A COUNTER AND NOT max()+1 ════════════════════
--
-- `SELECT max(work_order_number)+1` reads a value it does not hold a lock on: two concurrent creates
-- read the same maximum, both compute the same next number, and one loses to the unique index -- so the
-- failure mode is a user-visible error on a perfectly valid Work Order. INSERT ... ON CONFLICT DO UPDATE
-- ... RETURNING takes the row lock and returns the incremented value in one statement, so concurrent
-- callers serialize on the counter row instead of colliding on the index.
--
-- ROLLBACK SEMANTICS, STATED DELIBERATELY. The counter is an ordinary row, so an allocation inside a
-- transaction that later rolls back is rolled back with it and the number is REUSED. That is the correct
-- behaviour for a business reference: a gap in WO numbers is a question somebody has to answer ("where
-- is WO-2026-000071?"), and a sequence would produce gaps precisely when a create fails. A PostgreSQL
-- SEQUENCE would NOT roll back, which is why one is not used here. The cost is that two concurrent
-- creates serialize briefly on the counter row; for Work Order creation rates that is not a real cost.
--
-- ════════════════════ THE SEED IS WHY THIS MIGRATION HAS AN INSERT ════════════════════
--
-- 13 historical Work Orders were migrated carrying numbers up to WO-2026-000064. An allocator starting
-- at 1 would hand out WO-2026-000001 and collide with a record a person can already see. So the counter
-- is seeded ONCE, here, from the numbers already present -- derived from the table it protects, not from
-- environment knowledge, and never consulted again at allocation time. Migrated numbers are not
-- rewritten, not renumbered and not touched.
--
-- A year with no rows gets no seed row, and the allocator correctly starts that year at 1.

SET search_path = eos_ops, public;

CREATE TABLE work_order_number_counters (
    tenant_id   TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    -- The YEAR the number carries, not the year the row was written: a number issued on 1 January
    -- belongs to the year printed inside it, and the two can disagree across a boundary.
    year        INTEGER     NOT NULL CHECK (year BETWEEN 1970 AND 9999),
    last_value  BIGINT      NOT NULL CHECK (last_value > 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, year)
);

-- Seed from the numbers that already exist. Positions are fixed by the format WO-YYYY-######:
-- characters 4..7 are the year, 9.. is the sequence.
INSERT INTO work_order_number_counters (tenant_id, year, last_value)
SELECT tenant_id,
       substring(work_order_number FROM 4 FOR 4)::int,
       max(substring(work_order_number FROM 9)::bigint)
  FROM work_orders
 WHERE work_order_number IS NOT NULL
 GROUP BY 1, 2;

-- Down Migration
SET search_path = eos_ops, public;

DROP TABLE IF EXISTS work_order_number_counters;
