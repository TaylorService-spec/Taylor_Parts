-- Up Migration
-- EOS Commercial Data Plane — the ownership and operating-company authority for the three
-- PERSON-owned commercial records, plus the append-only handoff history that makes a transfer
-- auditable instead of a field overwrite.
--
-- ============================================================================
-- MIGRATION 008. Owner rulings D-1/D-4/D-5/D-6 and R-8 (2026-08-30), as declared in
-- functions/src/ownership/ownershipMatrix.ts:142-168 (opportunity / salesAgreement / salesOrder,
-- all ownerClass PERSON, ownerType USER, transfer HANDOFF, companyScopeField operatingCompanyId).
-- Those rulings are enforced TODAY only in TypeScript, over Firestore documents that have no
-- shape. This migration is the first place a commercial record's owner and operating company are
-- refused by the STORE rather than by a validator a future writer could forget to call.
--
-- STANDARD POSTGRESQL ONLY, same as 001-007. Additive: no earlier migration is edited, and this
-- one creates a NEW SIBLING SCHEMA -- `eos_commercial` -- exactly as migration 005 created
-- `eos_ops` beside `eos_policy`. Nothing in `eos_policy` or `eos_ops` is touched, which is also
-- why the per-migration table counts pinned in test/adminPolicyPostgres.test.mjs stay true.
-- ============================================================================
--
-- ════════════════════ WHAT THIS TABLE SET IS, AND WHAT IT DELIBERATELY IS NOT ════════════════════
--
-- It is the commercial IDENTITY + AUTHORITY spine: which record this is, who owns it, which
-- operating company's books it belongs to, and which record upstream it came from.
--
-- It is NOT the commercial object. There is no stage, no outcome, no state machine, no line item,
-- no price, no quantity, no close date and no channel column here. Every one of those is a
-- SEPARATE authority with its own settled rules (opportunityLifecycle.ts, salesAgreementCommands.ts's
-- line model, salesOrderCommands.ts), and porting them in the same packet that establishes ownership
-- would mean porting three state machines whose Firestore behaviour is under test and whose
-- PostgreSQL behaviour is not. A half-ported state machine that the database also enforces is worse
-- than no port: it would be a second authority, disagreeing.
--
-- So this migration answers the ownership questions completely and answers nothing else at all.
-- Nothing deployed writes these tables; the Firestore commands remain the live authority until a
-- separately authorized cutover. Like migrations 005 and 007 before it, the schema exists and is
-- provable before it is live.
--
-- ════════════════════ WHY sales_territories IS NOT HERE ════════════════════
--
-- Sales Territory IS a real, built object -- `sales_territories`, written by the governed
-- createSalesTerritory callable (functions/src/coverage/coverageCallables.ts:41-59) over the pure
-- command in coverageCommands.ts:36. It is not vapour and it is not a stub.
--
-- But it is EXCLUDED from ownership by explicit ruling: ownershipMatrix.ts:452 classifies
-- `salesTerritory` as `EXCLUDED` because "coverage is not ownership, credit, commission or
-- security". A territory has no owner to enforce, no operating company scope was ruled for it, and
-- resolveCommercialCoverage deliberately returns no owner and picks no winner
-- (coverage/coverageResolution.ts:78-95). This migration is about ownership authority. Giving
-- Territory a table here would either leave an owner column nothing may ever fill, or invent the
-- coverage-is-ownership conflation the ruling exists to prevent. It stays out, on purpose, and its
-- Firestore authority is untouched.
--
-- ════════════════════ WHY THE OWNER COLUMN IS `owner_employee_id` AND IS NOT NULL ════════════════════
--
-- NOT NULL, NO DEFAULT: "every record has an owner" is the first ruling, and a nullable column
-- would make an ownerless commercial record representable -- which is precisely the state the
-- ~1015-document ownership backfill was run to eliminate. A DEFAULT would be worse than a NULL: it
-- would manufacture an owner that is indistinguishable afterwards from a deliberate assignment,
-- which is the same objection migration 007 raised against defaulting the operating company.
--
-- The column is named for the EMPLOYEE id rather than carrying the two-field typed owner
-- (`{type,id}`, typedOwner.ts:19-22). That is not a simplification -- it is the structural form of a
-- ruling. These three families are ownerClass PERSON / ownerType USER, and the handoff command
-- already refuses "an owner whose type contradicts the family"
-- (ownership/ownershipHandoffCommand.ts:21-22). A COMPANY-typed owner on an Opportunity is
-- therefore not a value to be validated away; in this schema it is UNREPRESENTABLE. The COMPANY
-- half of the typed owner belongs to the financial families (invoices, payments), which are
-- explicitly not in this packet.
--
-- The employee id is an OPAQUE governed key, carried and never joined -- the same treatment
-- `operating_company_key` and `location_id` get in migration 007, and for the same reason: the
-- Employee authority lives elsewhere and a second copy of it here would be an unmaintained one.
--
-- ════════════════════ WHY created_by IS A SEPARATE COLUMN FROM owner_employee_id ════════════════════
--
-- Because the assistant case is the whole point of the model (creationOwnerResolution.ts:11-24):
--
--     Customer owner = Rudy. An assistant calls createOpportunity with no ownerEmployeeId.
--     Result: owner = Rudy, createdBy = the assistant.
--
-- Two facts, two columns. The moment they share one, "who did this" silently becomes "who owns
-- this", and every one of the six fallbacks ruling D-4 forbids becomes expressible again. They are
-- deliberately NOT constrained to differ: a salesperson creating their own Opportunity is the
-- ordinary case and both columns then hold the same id. The point is that they CAN differ.
--
-- ════════════════════ WHY account_id IS NOT NULL, AND IS NOT A FOREIGN KEY ════════════════════
--
-- NOT NULL because the Customer is the governed upstream that an Opportunity's owner is inherited
-- FROM when none is supplied (creationOwnerResolution.ts:9-10, "Upstream is the Account owner for a
-- new Opportunity"). An Opportunity with no Account has no upstream owner to default to, so the
-- second ruling -- customer owner default where governed -- would be inapplicable rather than
-- merely unused. Not a FOREIGN KEY because Account is a different authority, not yet in this
-- database; a `accounts` table created here to satisfy a constraint would be exactly the
-- unclear-authority copy migration 007's header refused. It is an opaque governed key.
--
-- ════════════════════ WHY THE LINEAGE COLUMNS ARE REAL FOREIGN KEYS ════════════════════
--
-- Unlike Account and Employee, the upstream commercial records ARE in this schema, so the chain
-- Opportunity -> Sales Agreement -> Sales Order is enforceable and is enforced. They are NULLABLE
-- because each of the three creation paths that exists today is real: a Sales Agreement may be
-- raised from an Opportunity (salesAgreementCallables.ts:185 inherits its operatingCompanyId) or
-- standalone; a Sales Order may come from an Agreement (salesAgreement/agreementToSalesOrder.ts),
-- from a won Opportunity (opportunity/createSalesOrderFromOpportunity.ts), or directly. Making them
-- NOT NULL would forbid a path the governed commands allow.
--
-- ════════════════════ WHY sales_orders.operating_company_key IS THE ONLY NOT NULL ONE ════════════════════
--
-- Because that is what the commands already rule. `resolveCommercialCompanyScope` returns a
-- nullable value for Opportunity (opportunityCommands.ts:175) -- an early-stage Opportunity may
-- legitimately not yet know whose books it will land in -- while salesOrderCommands.ts:274-285
-- REFUSES a Sales Order whose company scope did not resolve, in the command's own words because it
-- is a "commercial commitment and requires a governed operatingCompanyId". salesAgreementCommands.ts:354
-- refuses the same way, but only at the point of COMMITMENT, not at draft.
--
-- The schema mirrors the ruling instead of tightening it. Tightening it here would make the
-- database reject Opportunities the governed command deliberately accepts, and the disagreement
-- would be discovered at cutover. Where the command refuses, the column is NOT NULL; where the
-- command permits, the column is nullable and the command stays the authority on when it must
-- fill.
--
-- ════════════════════ WHY THE HANDOFF HISTORY IS A TABLE AND NOT A COLUMN ════════════════════
--
-- "Negotiated transfer is allowed", "historical ownership remains", and "future sales follow the new
-- owner" are three rulings about the SAME event, and a mutable `owner_employee_id` column can only
-- satisfy the first. Overwriting it destroys the history the fifth ruling requires, and leaves
-- nothing to distinguish a negotiated handoff from a typo.
--
-- So a transfer is an INSERT into `ownership_handoffs` and an UPDATE of the record's current owner,
-- in one transaction. The history is the evidence; the column is the answer to "who owns it now",
-- which is what "future sales follow the new owner" needs: a new Opportunity created tomorrow
-- inherits the CURRENT Account owner, and the handoff rows say who it was before without ever
-- changing what yesterday's records say.
--
-- NO CASCADE, structurally. `ownership_handoff_names_exactly_one_record` means one row names one
-- record. There is no list column and no "and its children" flag, because ruling D-1's "existing
-- ownership never changes implicitly" and the ruling's "do not cascade" are one requirement seen
-- from two sides (ownershipHandoffCommand.ts:25-30). Handing off an Opportunity leaves its Sales
-- Orders where they were; moving them is a separate row.
--
-- ════════════════════ WHY A TRIGGER, WHEN NOTHING ELSE IN 001-007 USES ONE ════════════════════
--
-- Because "historical ownership remains" is a claim about what CANNOT happen to a row after it is
-- written, and PostgreSQL has no declarative constraint for that -- a CHECK sees the new row, never
-- the fact that an old one is being replaced. The alternatives were both rejected:
--
--   * "no repository function issues an UPDATE or DELETE" is a property of code we happen to have
--     written, not of the store. It is the same "the writers will remember" claim migration 007's
--     tests already refuse to accept as a proof.
--   * REVOKE UPDATE/DELETE on the table binds a ROLE, and this deployment's migration role and
--     application role are the same connection string. It would revoke nothing.
--
-- The trigger is narrow on purpose: it raises on UPDATE and DELETE of `ownership_handoffs` only,
-- names nothing deployment-specific, and takes no arguments. INSERT is untouched. This is the
-- FIRST trigger in the migration set, which is why it is argued for here rather than added quietly.

CREATE SCHEMA IF NOT EXISTS eos_commercial;
SET search_path = eos_commercial, public;

-- ============================ the handoff vocabulary ============================
--
-- Mirrors OWNERSHIP_HANDOFF_SOURCES exactly (functions/src/access/auditEventWriter.ts:429-433). A
-- closed vocabulary the PLATFORM defines -- which is the test migration 004's header set for
-- whether something may be a SQL enum -- so unlike `operating_company_key` it is one. A handoff
-- whose source is not one of these three is not a handoff this model knows how to audit.

CREATE TYPE commercial_handoff_source AS ENUM (
    'DIRECT_HANDOFF',
    'CUSTOMER_HANDOFF_REVIEW',
    'ADMIN_CORRECTION'
);

-- ============================ Opportunity ============================
--
-- The pre-commitment commercial record. Owner NOT NULL; operating company nullable, per the
-- command (see the header's company-scope section).

CREATE TABLE opportunities (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- The user-visible canonical number, OPP-<year>-<six digits> (opportunityNumbering.ts:66).
    -- Unique per tenant: two records answering to one number is two identities for one deal.
    opportunity_number    TEXT NOT NULL,
    account_id            TEXT NOT NULL,
    owner_employee_id     TEXT NOT NULL,
    operating_company_key TEXT,
    created_by            TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT        NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT opportunities_number_unique UNIQUE (tenant_id, opportunity_number)
);

CREATE INDEX opportunities_by_owner   ON opportunities (tenant_id, owner_employee_id);
CREATE INDEX opportunities_by_account ON opportunities (tenant_id, account_id);

-- ============================ Sales Agreement ============================
--
-- The accepted terms a Sales Order is created FROM. Its operating company is nullable for the same
-- reason the Opportunity's is -- salesAgreementCommands.ts:354 refuses it at COMMITMENT, not at
-- draft, and this schema does not hold a lifecycle state to know which one a row is in.

CREATE TABLE sales_agreements (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    sales_agreement_number TEXT NOT NULL,
    account_id            TEXT NOT NULL,
    opportunity_id        TEXT REFERENCES opportunities(id),
    owner_employee_id     TEXT NOT NULL,
    operating_company_key TEXT,
    created_by            TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT        NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sales_agreements_number_unique UNIQUE (tenant_id, sales_agreement_number)
);

CREATE INDEX sales_agreements_by_owner       ON sales_agreements (tenant_id, owner_employee_id);
CREATE INDEX sales_agreements_by_opportunity ON sales_agreements (tenant_id, opportunity_id);

-- ============================ Sales Order ============================
--
-- The committed order. This is the row the operating-company axis exists for: ownershipMatrix.ts:161-168
-- records that "the Sales Order is where the company must enter the commercial chain, because every
-- financial artifact downstream inherits from it". So here, and only here, the key is NOT NULL.

CREATE TABLE sales_orders (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    sales_order_number    TEXT NOT NULL,
    account_id            TEXT NOT NULL,
    opportunity_id        TEXT REFERENCES opportunities(id),
    sales_agreement_id    TEXT REFERENCES sales_agreements(id),
    owner_employee_id     TEXT NOT NULL,
    operating_company_key TEXT        NOT NULL,
    created_by            TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT        NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sales_orders_number_unique UNIQUE (tenant_id, sales_order_number)
);

CREATE INDEX sales_orders_by_owner     ON sales_orders (tenant_id, owner_employee_id);
CREATE INDEX sales_orders_by_agreement ON sales_orders (tenant_id, sales_agreement_id);

-- ============================ ownership handoffs: the history ============================
--
-- Append-only. One row, one record, one transfer.
--
-- `previous_owner_employee_id` is NULLABLE and that nullability is load-bearing: it is NULL only
-- where the record genuinely had no owner (the backfill case), never as a placeholder. The
-- handoff command draws the same distinction in its own input contract
-- (ownershipHandoffCommand.ts:57 -- "`null` when it genuinely had none -- never a placeholder").
-- Since these three tables refuse an ownerless row, a NULL here can only ever describe a record
-- imported from before the rule existed.

CREATE TABLE ownership_handoffs (
    id                         TEXT PRIMARY KEY,
    tenant_id                  TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    opportunity_id             TEXT REFERENCES opportunities(id),
    sales_agreement_id         TEXT REFERENCES sales_agreements(id),
    sales_order_id             TEXT REFERENCES sales_orders(id),
    previous_owner_employee_id TEXT,
    new_owner_employee_id      TEXT NOT NULL,
    source                     commercial_handoff_source NOT NULL,
    -- Free text, held to the same 500-character ceiling the audit writer applies
    -- (auditEventWriter.ts:438 MAX_HANDOFF_REASON_LENGTH) so a reason that this table accepts is
    -- never one the audit event would then reject.
    reason                     TEXT,
    effective_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_by                TEXT        NOT NULL,
    recorded_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NO CASCADE, as a constraint rather than as a convention.
    CONSTRAINT ownership_handoff_names_exactly_one_record CHECK (
        (opportunity_id     IS NOT NULL)::int
      + (sales_agreement_id IS NOT NULL)::int
      + (sales_order_id     IS NOT NULL)::int = 1
    ),
    -- A handoff to the owner who already holds the record is not a negotiated transfer; the audit
    -- writer refuses it, and so does the store. IS DISTINCT FROM, not <>, so the ownerless-to-owned
    -- backfill case (NULL -> someone) is a real handoff rather than an unknown comparison.
    CONSTRAINT ownership_handoff_is_not_a_no_op CHECK (
        previous_owner_employee_id IS DISTINCT FROM new_owner_employee_id
    ),
    CONSTRAINT ownership_handoff_reason_length CHECK (
        reason IS NULL OR char_length(reason) <= 500
    )
);

CREATE INDEX ownership_handoffs_by_opportunity ON ownership_handoffs (tenant_id, opportunity_id, effective_at);
CREATE INDEX ownership_handoffs_by_agreement   ON ownership_handoffs (tenant_id, sales_agreement_id, effective_at);
CREATE INDEX ownership_handoffs_by_order       ON ownership_handoffs (tenant_id, sales_order_id, effective_at);

-- ============================ history is history ============================

CREATE FUNCTION refuse_ownership_history_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'ownership_handoffs is append-only: % on a recorded handoff would destroy the ownership history', TG_OP
        USING HINT = 'A correction is a NEW handoff row with source ADMIN_CORRECTION, not an edit to the old one.';
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER ownership_handoffs_are_append_only
    BEFORE UPDATE OR DELETE ON ownership_handoffs
    FOR EACH ROW EXECUTE FUNCTION refuse_ownership_history_mutation();

-- Down Migration
SET search_path = eos_commercial, public;

-- Reversing DESTROYS ownership history, so it refuses while any exists -- the same shape as
-- migration 007's refusal to invent a physical location for an installed unit. A schema nobody has
-- written to reverses freely; one that has recorded a transfer does not, because there is nowhere
-- else that transfer is written down.

DO $$
DECLARE
    recorded BIGINT;
BEGIN
    SELECT count(*) INTO recorded FROM eos_commercial.ownership_handoffs;
    IF recorded > 0 THEN
        RAISE EXCEPTION
            'migration 008 cannot be reversed: % ownership handoffs are recorded and dropping them would destroy the ownership history',
            recorded
            USING HINT = 'Historical ownership remains. Export or re-home these rows before reversing.';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS ownership_handoffs_are_append_only ON ownership_handoffs;
DROP FUNCTION IF EXISTS refuse_ownership_history_mutation();

DROP TABLE IF EXISTS ownership_handoffs;
DROP TABLE IF EXISTS sales_orders;
DROP TABLE IF EXISTS sales_agreements;
DROP TABLE IF EXISTS opportunities;

DROP TYPE IF EXISTS commercial_handoff_source;

DROP SCHEMA IF EXISTS eos_commercial CASCADE;
