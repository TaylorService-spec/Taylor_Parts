-- Up Migration
-- ACCOUNTABLE PERSON on the commercial chain — the place the second person axis finally lives.
--
-- ============================================================================
-- MIGRATION 020. Owner rulings #181 (`MI-N`), #187 §1 (`MI-Y`) and #189 (`OD-16`, `MI-λ`).
--
-- #181: "For Opportunity, Sales Agreement and Sales Order, ACCOUNTABLE PERSON IS A SEPARATELY
-- CARRIED BUSINESS FACT. It is not permanently derived from RECORD OWNER."
--
-- #189 `OD-16` fixes the scope at exactly those three families and rules every other family
-- **NOT APPLICABLE** — "not MISSING, not OWNERLESS, not DEFECTIVE" — so no other table in this
-- schema set gains an accountability column, in this migration or by implication from it.
--
-- STANDARD POSTGRESQL ONLY, same as 001-019. Additive: no existing migration file is edited, no
-- existing column changes type or nullability, and no existing constraint is dropped or altered.
-- ============================================================================
--
-- ════════════════════ WHY A COLUMN BESIDE owner_employee_id, AND NOT A ROW SOMEWHERE ELSE ════════════════════
--
-- The alternative that looks more general — one `record_accountability` table keyed by
-- (family, record_id) — is refused, and #187 §1 is the reason. It rules AGAINST expanding the
-- ownership census "into a generic mega-census" and for accountability getting "its own
-- measurement"; a generic polymorphic responsibility table is the same generalisation one layer
-- down, and it would buy exactly one thing this program does not want: the ability to assert
-- accountability on a family no ruling has admitted. A column on three named tables cannot do that.
--
-- It is also the smaller change against what 008 already built. `owner_employee_id` is a column on
-- each of the three tables (1758844800000:184, :208, :233). The accountable person is the SAME shape
-- of fact about the SAME row — one governed Employee id — so it is the same shape of storage, one
-- column over, and every existing read of a commercial row gets it for free.
--
-- ════════════════════ THE COLUMN IS NULLABLE, AND THAT IS A MEASUREMENT DECISION ════════════════════
--
-- `owner_employee_id` is NOT NULL because 008 could declare it so on an empty table. This column
-- cannot be, and inventing a value to make it so is the single thing #189 `MI-λ` forbids most
-- plainly:
--
--     "MEASURE FIRST... Such a reference must not be fabricated into an Employee · silently mapped
--      by id coincidence · silently mapped through a Firebase UID · deleted from immutable history ·
--      rewritten merely to satisfy a foreign key."
--
-- A `NOT NULL DEFAULT owner_employee_id` would be all four at once: it would fabricate an
-- accountability fact for every existing row, it would do it by copying another axis, it would be
-- indistinguishable afterwards from a governed decision, and it would make #181's "NOT permanently
-- derived from RECORD OWNER" false in the storage itself. So NULL means exactly one thing here —
-- **this row has no governed accountable person recorded yet** — and it is a fact the census counts
-- rather than a gap the schema hides. `functions/scripts/measureCommercialAccountability.js` is the
-- read-only artifact that counts it; any backfill is a separate, separately-proven decision.
--
-- ════════════════════ NO FOREIGN KEY TO eos_workforce.employees, AND WHY NOT ════════════════════
--
-- #189 `MI-λ` measured this exact question on this exact table set and its finding is the reason:
--
--     "`ownership_handoffs` is protected against mutation by `refuse_ownership_history_mutation`...
--      and in the same CREATE TABLE four columns carry foreign keys while the two person columns
--      carry none... So a bad person id already written there is permanent by design, and adding a
--      naive FK would either fail or require the history mutation this ruling forbids."
--
-- The same reasoning applies forward, not only backward. An FK here would mean the DATABASE decides
-- referential integrity for a person reference, which #182 §1 assigns to the authoritative person
-- resolver, and it would mean a legacy unresolved reference could only ever be made insertable by
-- rewriting it. `accountability_handoffs` below therefore carries FOUR foreign keys — tenant and the
-- three record ids — and ZERO on either person column, exactly as `ownership_handoffs` does. The
-- symmetry is deliberate and it is checked: functions/test/commercialAccountabilityMigration.test.mjs
-- asserts that neither person column in either table carries a key.
--
-- What IS enforced is SHAPE, the same shape 019 requires of `employees.id`
-- (`employees_id_shape`) and 008 of the value it carries opaquely: non-empty, trimmed, not a path.
-- An id containing "/" or untrimmed whitespace is not an id at all. Shape is a statement about the
-- string; existence is a statement about the person, and only the authority may make that one.
--
-- ════════════════════ WHAT IS DELIBERATELY *NOT* CONSTRAINED ════════════════════
--
-- There is NO constraint requiring `accountable_employee_id <> owner_employee_id`, and its absence
-- is load-bearing. #181: "For normal sales work they will frequently be the same employee. EOS must
-- nevertheless be able to represent them as different people." A uniqueness-style constraint between
-- the two columns would forbid the ordinary case; a constraint requiring them EQUAL would be the
-- permanent computed identity #181 forbids in capitals. Both axes are independently nullable-or-set,
-- independently written, and independently readable. The schema takes no position on whether they
-- agree, because the business does not.
--
-- There is also NO eligibility column. #186 §2: "REFERENCE VALIDITY · EMPLOYEE LIFECYCLE STATUS ·
-- CURRENT ACCOUNTABILITY ELIGIBILITY are three separate facts", and the third is a verdict of a
-- governed policy at the moment a command runs, not a property of the commercial row. Storing it
-- here would freeze one policy's answer into the record and make the row disagree with the authority
-- the next time the policy or the employee's status changed. The row stores the REFERENCE. The
-- authority answers for the person. The census composes them.
--
-- ════════════════════ WHY accountability_handoffs IS A SECOND TABLE AND NOT A SOURCE VALUE ════════════════════
--
-- The tempting smaller change is to add 'ACCOUNTABILITY' to `commercial_handoff_source` and record
-- accountability transfers as rows in `ownership_handoffs`, carrying the accountable person in
-- `previous_owner_employee_id` / `new_owner_employee_id`. #187 §1 forbids precisely that:
-- "accountability must not be redefined as ownership". The column NAMES would then be lying about
-- what they hold, every existing ownership query would silently include accountability events, and
-- `ownership_handoffs_by_owner`-shaped reads would return a person who never owned the record.
--
-- So: a separate table, with its own columns named for what they hold, and the SAME three
-- protections 008 gave the ownership history — exactly-one-record, no-op refusal, append-only
-- trigger. History is history on both axes or on neither.
--
-- `eligibility_policy_id` is NOT NULL, and it is the one column with no counterpart in
-- `ownership_handoffs`. #189 `MI-ε` makes the eligibility answer a governed fact and requires the
-- gate to "consume the governed eligibility result"; a governed fact whose author is not recorded
-- cannot be re-examined later. It is the same requirement
-- `functions/src/employeeIdentity/employeeAuthority.ts` states on
-- `AccountabilityEligibilityPolicy.policyId`, held in the history rather than only in the process
-- that made the decision.
--
-- ════════════════════ THE DOWN MIGRATION REFUSES WHEN THERE IS HISTORY ════════════════════
--
-- 008's shape, and 019's. Dropping `accountability_handoffs` while it holds rows destroys the record
-- of who was responsible for what and when — the "deleted from immutable history" #189 forbids. The
-- down COUNTS first and RAISES with the count. The three COLUMNS reverse freely: dropping a column
-- whose only content is a reference that the history table still records is a reversal, not a
-- deletion, PROVIDED the history is still there — which the count is what guarantees.

SET search_path = eos_commercial, public;

-- ============================ the accountable person, per family ============================
--
-- Three tables, one column each, identical shape. Nothing generic: #189 `OD-16` admits these three
-- families and no others, and a reader of this file can see the whole scope without leaving it.

ALTER TABLE opportunities
    ADD COLUMN accountable_employee_id TEXT,
    ADD CONSTRAINT opportunities_accountable_employee_shape CHECK (
        accountable_employee_id IS NULL
        OR (accountable_employee_id <> ''
            AND btrim(accountable_employee_id) = accountable_employee_id
            AND position('/' in accountable_employee_id) = 0)
    );

ALTER TABLE sales_agreements
    ADD COLUMN accountable_employee_id TEXT,
    ADD CONSTRAINT sales_agreements_accountable_employee_shape CHECK (
        accountable_employee_id IS NULL
        OR (accountable_employee_id <> ''
            AND btrim(accountable_employee_id) = accountable_employee_id
            AND position('/' in accountable_employee_id) = 0)
    );

ALTER TABLE sales_orders
    ADD COLUMN accountable_employee_id TEXT,
    ADD CONSTRAINT sales_orders_accountable_employee_shape CHECK (
        accountable_employee_id IS NULL
        OR (accountable_employee_id <> ''
            AND btrim(accountable_employee_id) = accountable_employee_id
            AND position('/' in accountable_employee_id) = 0)
    );

-- The census read: "every commercial record in this tenant accountable to this person", and the
-- inverse "which records have none". A plain btree serves both; NOT partial, for the same reason
-- 019's status index is not partial — a partial index would be the schema asserting which value is
-- the interesting one.

CREATE INDEX opportunities_by_accountable     ON opportunities     (tenant_id, accountable_employee_id);
CREATE INDEX sales_agreements_by_accountable  ON sales_agreements  (tenant_id, accountable_employee_id);
CREATE INDEX sales_orders_by_accountable      ON sales_orders      (tenant_id, accountable_employee_id);

-- ============================ accountability handoffs: the history ============================
--
-- Append-only. One row, one record, one transfer of ACCOUNTABILITY — never of ownership.

CREATE TABLE accountability_handoffs (
    id                               TEXT PRIMARY KEY,
    tenant_id                        TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- The same three nullable record keys, with the same exactly-one CHECK. Keys, because a
    -- commercial record id that dangles is a dangling row rather than a person reference.
    opportunity_id                   TEXT REFERENCES opportunities(id),
    sales_agreement_id               TEXT REFERENCES sales_agreements(id),
    sales_order_id                   TEXT REFERENCES sales_orders(id),
    -- NO FOREIGN KEY on either person column. See the header: #189 `MI-λ`, measured on this table's
    -- ownership counterpart, and true for the same reason here.
    previous_accountable_employee_id TEXT,
    new_accountable_employee_id      TEXT NOT NULL,
    -- The governed policy that answered the eligibility question. #189 `MI-ε`.
    eligibility_policy_id            TEXT NOT NULL,
    reason                           TEXT,
    effective_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_by                      TEXT        NOT NULL,
    recorded_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT accountability_handoff_names_exactly_one_record CHECK (
        (opportunity_id     IS NOT NULL)::int
      + (sales_agreement_id IS NOT NULL)::int
      + (sales_order_id     IS NOT NULL)::int = 1
    ),
    -- A handoff to the person who is already accountable is not a transfer. IS DISTINCT FROM, not
    -- <>, so the none-to-someone establishment case (NULL -> someone) is a real handoff rather than
    -- an unknown comparison — 008's own reasoning, unchanged.
    CONSTRAINT accountability_handoff_is_not_a_no_op CHECK (
        previous_accountable_employee_id IS DISTINCT FROM new_accountable_employee_id
    ),
    CONSTRAINT accountability_handoff_person_shape CHECK (
        (previous_accountable_employee_id IS NULL
         OR (previous_accountable_employee_id <> ''
             AND btrim(previous_accountable_employee_id) = previous_accountable_employee_id
             AND position('/' in previous_accountable_employee_id) = 0))
        AND new_accountable_employee_id <> ''
        AND btrim(new_accountable_employee_id) = new_accountable_employee_id
        AND position('/' in new_accountable_employee_id) = 0
    ),
    CONSTRAINT accountability_handoff_policy_stated CHECK (
        eligibility_policy_id <> '' AND btrim(eligibility_policy_id) = eligibility_policy_id
    ),
    CONSTRAINT accountability_handoff_reason_length CHECK (
        reason IS NULL OR char_length(reason) <= 500
    )
);

CREATE INDEX accountability_handoffs_by_opportunity ON accountability_handoffs (tenant_id, opportunity_id, effective_at);
CREATE INDEX accountability_handoffs_by_agreement   ON accountability_handoffs (tenant_id, sales_agreement_id, effective_at);
CREATE INDEX accountability_handoffs_by_order       ON accountability_handoffs (tenant_id, sales_order_id, effective_at);

-- ============================ history is history, on this axis too ============================
--
-- A SECOND function rather than reusing `refuse_ownership_history_mutation`. The message names the
-- table and the axis, and #187 §1's rule that accountability is not ownership applies to the error
-- text a DBA reads at 2am as much as to the column names.

CREATE FUNCTION refuse_accountability_history_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'accountability_handoffs is append-only: % on a recorded handoff would destroy the accountability history', TG_OP
        USING HINT = 'A correction is a NEW accountability handoff row, not an edit to the old one. Historical accountability remains valid even when the person is no longer eligible (#186 s7).';
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER accountability_handoffs_are_append_only
    BEFORE UPDATE OR DELETE ON accountability_handoffs
    FOR EACH ROW EXECUTE FUNCTION refuse_accountability_history_mutation();

-- Down Migration
SET search_path = eos_commercial, public;

-- ════════════════════ REFUSE WHILE THERE IS HISTORY ════════════════════

DO $$
DECLARE
    recorded BIGINT;
BEGIN
    SELECT count(*) INTO recorded FROM eos_commercial.accountability_handoffs;
    IF recorded > 0 THEN
        RAISE EXCEPTION
            'migration 020 refuses to drop eos_commercial.accountability_handoffs: % accountability transfers are recorded and they are the history of who was responsible',
            recorded
            USING HINT = 'Reversing this migration deletes governed accountability history, which #189 MI-lambda forbids. Export it deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS accountability_handoffs_are_append_only ON accountability_handoffs;
DROP FUNCTION IF EXISTS refuse_accountability_history_mutation();

DROP INDEX IF EXISTS accountability_handoffs_by_opportunity;
DROP INDEX IF EXISTS accountability_handoffs_by_agreement;
DROP INDEX IF EXISTS accountability_handoffs_by_order;
DROP TABLE IF EXISTS accountability_handoffs;

DROP INDEX IF EXISTS opportunities_by_accountable;
DROP INDEX IF EXISTS sales_agreements_by_accountable;
DROP INDEX IF EXISTS sales_orders_by_accountable;

ALTER TABLE opportunities    DROP CONSTRAINT IF EXISTS opportunities_accountable_employee_shape;
ALTER TABLE sales_agreements DROP CONSTRAINT IF EXISTS sales_agreements_accountable_employee_shape;
ALTER TABLE sales_orders     DROP CONSTRAINT IF EXISTS sales_orders_accountable_employee_shape;

ALTER TABLE opportunities    DROP COLUMN IF EXISTS accountable_employee_id;
ALTER TABLE sales_agreements DROP COLUMN IF EXISTS accountable_employee_id;
ALTER TABLE sales_orders     DROP COLUMN IF EXISTS accountable_employee_id;
