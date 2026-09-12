-- Up Migration
-- EOS Operational Data Plane — the AR CASH-APPLICATION authority: cash receipts and payment
-- applications, with the applied/unapplied balance DERIVED rather than stored.
--
-- ============================================================================
-- MIGRATION 008. Postgres becomes the business authority for MONEY RECEIVED and for HOW THAT MONEY
-- IS APPLIED. Additive: migrations 001-007 are not edited. STANDARD POSTGRESQL ONLY (no extension,
-- no vendor type) -- same constraint 005/006/007 hold themselves to.
-- ============================================================================
--
-- ════════════════════ THE DEFECT THIS MIGRATION EXISTS TO MAKE IMPOSSIBLE ════════════════════
--
-- The Firestore representation stores the applied balance in THREE places and reconciles it in
-- none of them at write time:
--
--   * `payments/{id}.appliedMinor` and `.unappliedMinor` -- written ONCE by
--     functions/src/finance/paymentCallables.ts's `tx.set(paymentRef, ...)` and NEVER updated by
--     any later command. The same file's header calls `payments` write-once, and
--     field-ops-app-vite/src/metadata/definitions/payment.js records the same measurement ("No
--     other command in this program ever calls .update() on a payments/{paymentId} document").
--   * `payment_applications/{id}.appliedAmountMinor` -- the durable FACT, one row per application.
--   * `invoices/{id}.appliedMinor` / `.outstandingMinor` -- a projection maintained in the same
--     transaction as the application fact by applyPayment, and ALSO rewritten independently by
--     functions/src/finance/refundCallables.ts (`tx.update(invoiceRef, { appliedMinor: ... })`) and
--     functions/src/finance/adjustmentCallables.ts.
--
-- Those three can disagree, and after a refund they are DESIGNED to. `recordRefund` lowers the
-- invoice's `appliedMinor` and writes a `refunds` row; it writes NO reversing payment_application
-- and does not touch the receipt. So once any refund exists:
--
--     SUM(payment_applications for invoice I) != invoices/I.appliedMinor
--
-- by construction, and `payments/P.appliedMinor` still claims the full amount was applied to an
-- invoice that no longer agrees. functions/src/finance/financialReconciliation.ts can DETECT the
-- first of those (`reconcileInvoiceProjection` subtracts refund facts, line 80) but not the second
-- (`reconcileReceipt` takes applications only -- it has no refund parameter at all, so a refunded
-- receipt reports IN_SYNC). And neither function is called from anywhere outside
-- functions/test/financialReconciliation.test.mjs: there is no scheduler, no callable, no export
-- in functions/src/index.ts. It is a detector that is never run.
--
-- THIS SCHEMA DOES NOT ADD A BETTER DETECTOR. It removes the thing being detected.
--
-- ════════════════════ WHY `payments` HAS NO applied_minor COLUMN ════════════════════
--
-- A stored aggregate that can be written independently of the rows it summarises is a second
-- accounting authority wearing a cache's clothes. `payment_applications` is the only place an
-- applied amount is stated; `payment_balances` (below) computes applied and unapplied from it.
-- There is therefore NO value for a writer to forget to maintain, NO value for a repair script to
-- set wrongly, and NO pair of numbers that can disagree -- the disagreement has no place to live.
--
-- The cost is honest and accepted: an unapplied-cash report aggregates rather than reads a column.
-- The alternative -- a stored column plus a trigger keeping it in step -- was refused because it
-- buys a cheaper SELECT with a permanent second authority, and a trigger that is ever disabled,
-- or a row ever written by a superuser session, restores exactly the defect above.
--
-- The `outstanding` half of the same question belongs to the INVOICE authority, which is NOT in
-- this schema and is NOT this migration's to define. What this schema can state -- and does, in
-- `invoice_application_totals` -- is how much cash IT has applied to a given invoice id. That is
-- the number the invoice authority must agree with, and it is now computable from facts rather
-- than asserted by a projection.
--
-- ════════════════════ WHY invoice_id IS AN OPAQUE GOVERNED KEY, NOT A FOREIGN KEY ════════════════════
--
-- For the same reason migration 005 has no `locations` table and migration 007 carries
-- `operating_company_key` as TEXT: an authority this schema does not own is not modelled here. The
-- Invoice authority's Postgres home does not exist yet. Inventing an `invoices` table to hang a
-- REFERENCES clause on would create an unmaintained copy of a record whose original stays
-- authoritative elsewhere -- the "unclear authority" copy the Owner ruling forbids. `invoice_id` is
-- carried as data, validated by the EOS authority layer, never joined as identity by this schema.
--
-- It is NOT NULL with no default: an application that cannot say which obligation it settled is not
-- an application, and there is no invoice this schema may substitute.
--
-- ════════════════════ WHY AN APPLICATION CARRIES NO SECOND COPY OF COMPANY OR ACCOUNT ════════════════════
--
-- Migration 007 already answered this shape for `cycle_count_lines`: a record whose parent is
-- NOT NULL and whose authority is the parent's does not restate the parent's facts, because a
-- second place to state one fact is the only way the two can ever disagree. An application is not
-- an independently-owned financial record -- it is how ONE receipt was allocated. The receipt
-- carries `operating_company_key` and `account_id`; the application carries neither and inherits
-- both through `payment_application_matches_receipt`.
--
-- `currency` IS carried on the application, and only because it is load-bearing in the FK: the
-- composite reference makes a cross-currency application STRUCTURALLY unrepresentable rather than
-- merely policed. It is not a second authority -- it is a column that can only ever hold the
-- receipt's own value, enforced by the database, which is the opposite of a divergence risk.
-- (functions/src/finance/paymentCommands.ts's CURRENCY_MISMATCH is the same rule stated in
-- TypeScript for the Firestore representation, where nothing can enforce it structurally.)
--
-- ════════════════════ THE ONE INVARIANT A CHECK CONSTRAINT CANNOT EXPRESS ════════════════════
--
--     SUM(applications of a receipt) <= that receipt's amount
--
-- is a cross-row predicate. Postgres has no declarative form for it: CHECK sees one row, and a
-- UNIQUE/EXCLUDE constraint cannot sum. The alternatives were a stored running total (refused
-- above, it is the defect) or nothing (the invariant then holds only while every writer remembers
-- it -- which is what "the writers will remember" already failed to deliver in Firestore).
--
-- So there is one trigger, `assert_application_within_receipt`, and it exists for exactly this one
-- claim. It takes `FOR UPDATE` on the receipt row before summing, so two concurrent applications
-- of the same receipt serialise on that row rather than both reading a stale total under READ
-- COMMITTED and both passing. `receipt_amount_covers_applications` closes the same invariant's
-- other door -- lowering a receipt's amount below what is already applied.
--
-- ════════════════════ APPEND-ONLY, BECAUSE A CORRECTION IS A NEW FACT ════════════════════
--
-- `refuse_financial_fact_delete` refuses DELETE on both tables. This is not novel severity: the
-- Firestore representation is already append-only in practice and says so
-- (field-ops-app-vite/src/metadata/definitions/payment.js: "A cash receipt is append-only by
-- construction (a new receipt, not an edit, is how a correction would be represented)"), and
-- firestore.rules denies all client writes to both collections. What changes here is that the
-- property is enforced instead of observed. An erased application silently unapplies money and
-- leaves the derived balance correct about a history that no longer exists -- the same class of
-- lie as a drifted aggregate, arrived at from the other direction.
--
-- A REVERSAL representation (the durable fact that returns applied money) is deliberately NOT
-- defined here. `refunds` is a separate Firestore collection with its own command and its own
-- owner, and guessing its Postgres shape from this side would be the speculative modelling this
-- schema has refused twice already. Until it exists, an over-applied receipt is corrected by
-- resolving the real authority, not by a DELETE. Named as a gap, not papered over.
--
-- ════════════════════ WHAT THIS MIGRATION DOES NOT DO ════════════════════
--
-- NO data migration. NO backfill. NO dual write. Nothing deployed reads or writes these tables:
-- the live cash-application path remains functions/src/finance/paymentCallables.ts against
-- Firestore, untouched by this packet. These tables start empty and stay empty until a governed
-- EOS server command is built over them and a cutover is separately authorised. This is financial
-- data; a schema that is ready is not a schema that has been switched to.

SET search_path = eos_ops, public;

-- ============================ cash receipts: money received ============================
--
-- A CASH RECEIPT is money that arrived. It is a distinct fact from how that money was allocated --
-- the same separation functions/src/finance/paymentCommands.ts's header draws, kept here so that
-- one receipt applying across many invoices, or leaving unapplied cash, needs no redesign. What is
-- different from the Firestore shape is that this table stores the receipt's AMOUNT and nothing
-- about its allocation.

CREATE TABLE payments (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- Migration 007's rule, unchanged: the books a transaction lands in are stated, never inferred
    -- from a warehouse, a truck, an employee or a homeWarehouseId. NOT NULL, NO DEFAULT -- a
    -- DEFAULT would let a writer that never decided a company still produce a row claiming one.
    -- OPAQUE: the EOS authority layer decides which keys are valid; this schema stores the key.
    operating_company_key TEXT NOT NULL,
    -- The customer the cash came from. Opaque governed key for the same reason invoice_id is --
    -- the Account authority is not in this schema.
    account_id            TEXT NOT NULL,
    -- The code the minor-unit amounts below are denominated in. Deliberately not an enum and not
    -- length-checked: a closed currency vocabulary would be this schema deciding which currencies a
    -- deployment may transact in, which is not its authority. Shape only -- non-empty.
    currency              TEXT NOT NULL,
    -- INTEGER MINOR UNITS, never a float and never NUMERIC-with-scale -- the same representation
    -- the whole finance core uses (paymentCommands.ts's isPosInt). BIGINT because a minor-unit
    -- total has no business being bounded by 2^31 cents.
    amount_minor          BIGINT NOT NULL,
    -- Free-form ("CHECK", "ACH", ...). No closed vocabulary exists anywhere in the program for
    -- this, and inventing one here would be inventing business policy.
    method                TEXT,
    -- A check or wire number. Genuinely optional in the existing command core, so genuinely
    -- nullable here; it is NOT identity and is never substituted for `id`.
    external_ref          TEXT,
    -- When the cash was actually received. CALLER-SUPPLIED and frequently in the past (a check
    -- recorded a week later), which is why it has no DEFAULT now() -- a default would silently
    -- convert "nobody said" into "it arrived at insert time".
    received_at           TIMESTAMPTZ NOT NULL,
    -- Provenance the Firestore receipt does not have: paymentCallables.ts records the actor only
    -- in the separate audit event, never on the record. A financial fact that cannot say who
    -- recorded it is not auditable from the record itself.
    recorded_by           TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT payment_currency_present CHECK (btrim(currency) <> ''),
    CONSTRAINT payment_company_present  CHECK (btrim(operating_company_key) <> ''),
    CONSTRAINT payment_account_present  CHECK (btrim(account_id) <> ''),
    -- The target of payment_applications' composite FK. Redundant with the primary key by itself;
    -- it exists so that an application referencing this receipt must also match its currency,
    -- which is what makes a cross-currency application unrepresentable rather than merely refused
    -- by application code.
    CONSTRAINT payments_currency_identity UNIQUE (tenant_id, id, currency)
);

CREATE INDEX payments_by_account ON payments (tenant_id, account_id);
CREATE INDEX payments_by_company ON payments (tenant_id, operating_company_key);

-- ============================ payment applications: how it was allocated ============================

CREATE TABLE payment_applications (
    id                   TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    payment_id           TEXT NOT NULL,
    -- Opaque governed key. The Invoice authority is not in this schema; see the header.
    invoice_id           TEXT NOT NULL,
    -- Only ever the receipt's own currency -- the FK below makes that structural.
    currency             TEXT NOT NULL,
    applied_amount_minor BIGINT NOT NULL,
    applied_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Idempotent replay, the same contract inventory_movements.idempotency_key gives: a retried
    -- application must not double-apply. NULL means this caller has no replay concern; where it is
    -- supplied it is unique per tenant.
    idempotency_key      TEXT,
    created_by           TEXT        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_application_amount_positive CHECK (applied_amount_minor > 0),
    CONSTRAINT payment_application_invoice_present CHECK (btrim(invoice_id) <> ''),
    -- Same tenant, same receipt, SAME CURRENCY. Cross-currency application: impossible.
    CONSTRAINT payment_application_matches_receipt
        FOREIGN KEY (tenant_id, payment_id, currency)
        REFERENCES payments (tenant_id, id, currency)
);

CREATE INDEX payment_applications_by_payment ON payment_applications (tenant_id, payment_id);
CREATE INDEX payment_applications_by_invoice ON payment_applications (tenant_id, invoice_id);
CREATE UNIQUE INDEX payment_applications_idempotency
    ON payment_applications (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ============================ the cross-row invariant ============================

CREATE FUNCTION assert_application_within_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    receipt_amount BIGINT;
    applied_total  BIGINT;
BEGIN
    -- FOR UPDATE, not a plain read: without the row lock two concurrent applications of the same
    -- receipt each see the other's row as uncommitted under READ COMMITTED, both pass, and the
    -- invariant is violated by a pair of individually-valid writes.
    SELECT p.amount_minor INTO receipt_amount
      FROM eos_ops.payments p
     WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.payment_id
       FOR UPDATE;

    -- The FK guarantees the receipt exists; this is a defensive read, not a second existence check.
    IF receipt_amount IS NULL THEN
        RAISE EXCEPTION 'payment % not found for tenant %', NEW.payment_id, NEW.tenant_id;
    END IF;

    SELECT COALESCE(sum(a.applied_amount_minor), 0) INTO applied_total
      FROM eos_ops.payment_applications a
     WHERE a.tenant_id = NEW.tenant_id AND a.payment_id = NEW.payment_id;

    IF applied_total > receipt_amount THEN
        RAISE EXCEPTION
            'over-application: payment % is applied % but received only %',
            NEW.payment_id, applied_total, receipt_amount
            USING ERRCODE = 'check_violation',
                  HINT = 'Cash that exceeds an obligation stays unapplied on the receipt; it is never allocated to an invoice it did not pay.';
    END IF;

    RETURN NULL;
END
$$;

-- AFTER, so NEW is already visible to the SUM and the check reads the true post-write total rather
-- than reconstructing it as "existing rows plus this one".
CREATE TRIGGER payment_application_within_receipt
    AFTER INSERT OR UPDATE ON payment_applications
    FOR EACH ROW EXECUTE FUNCTION assert_application_within_receipt();

CREATE FUNCTION assert_receipt_covers_applications() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    applied_total BIGINT;
BEGIN
    IF NEW.amount_minor = OLD.amount_minor THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(sum(a.applied_amount_minor), 0) INTO applied_total
      FROM eos_ops.payment_applications a
     WHERE a.tenant_id = OLD.tenant_id AND a.payment_id = OLD.id;

    IF NEW.amount_minor < applied_total THEN
        RAISE EXCEPTION
            'payment % cannot be reduced to % -- % is already applied',
            OLD.id, NEW.amount_minor, applied_total
            USING ERRCODE = 'check_violation',
                  HINT = 'Reduce or reverse the applications first; money already allocated cannot be un-received by editing the receipt.';
    END IF;

    RETURN NEW;
END
$$;

CREATE TRIGGER receipt_amount_covers_applications
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION assert_receipt_covers_applications();

-- ============================ append-only ============================

CREATE FUNCTION refuse_financial_fact_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'table %.% is append-only: a financial fact is corrected by a new fact, never by deletion',
        TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation',
              HINT = 'Deleting an application silently unapplies money and leaves every derived balance correct about a history that no longer exists.';
END
$$;

CREATE TRIGGER payments_append_only
    BEFORE DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION refuse_financial_fact_delete();

CREATE TRIGGER payment_applications_append_only
    BEFORE DELETE ON payment_applications
    FOR EACH ROW EXECUTE FUNCTION refuse_financial_fact_delete();

-- ============================ the derived read model ============================
--
-- Plain views, not materialized: a materialized view is a stored aggregate with a refresh schedule,
-- which is the defect this migration exists to remove, reintroduced with extra steps.

-- A receipt's own position. `unapplied_minor` is what the Firestore receipt stores as a column and
-- never updates; here it cannot be stale because it is not stored.
CREATE VIEW payment_balances AS
SELECT p.tenant_id,
       p.id                                       AS payment_id,
       p.operating_company_key,
       p.account_id,
       p.currency,
       p.amount_minor,
       COALESCE(a.applied_minor, 0)               AS applied_minor,
       p.amount_minor - COALESCE(a.applied_minor, 0) AS unapplied_minor,
       COALESCE(a.application_count, 0)           AS application_count
  FROM eos_ops.payments p
  LEFT JOIN (
        SELECT tenant_id, payment_id,
               sum(applied_amount_minor)::BIGINT AS applied_minor,
               count(*)::BIGINT                  AS application_count
          FROM eos_ops.payment_applications
         GROUP BY tenant_id, payment_id
  ) a ON a.tenant_id = p.tenant_id AND a.payment_id = p.id;

-- WHAT THE CASH-APPLICATION AUTHORITY SAYS IT HAS APPLIED to an invoice id. This is NOT an invoice
-- authority and states nothing about an invoice's total, credits, charges, write-offs or
-- outstanding balance -- none of which live in this schema. It is one side of the comparison the
-- Invoice authority must satisfy, expressed as a sum of facts rather than as a maintained number.
CREATE VIEW invoice_application_totals AS
SELECT tenant_id,
       invoice_id,
       currency,
       sum(applied_amount_minor)::BIGINT AS applied_minor,
       count(*)::BIGINT                  AS application_count,
       max(applied_at)                   AS last_applied_at
  FROM eos_ops.payment_applications
 GROUP BY tenant_id, invoice_id, currency;

-- Down Migration
SET search_path = eos_ops, public;

DROP VIEW IF EXISTS invoice_application_totals;
DROP VIEW IF EXISTS payment_balances;

DROP TRIGGER IF EXISTS payment_applications_append_only ON payment_applications;
DROP TRIGGER IF EXISTS payments_append_only ON payments;
DROP TRIGGER IF EXISTS receipt_amount_covers_applications ON payments;
DROP TRIGGER IF EXISTS payment_application_within_receipt ON payment_applications;

DROP FUNCTION IF EXISTS refuse_financial_fact_delete();
DROP FUNCTION IF EXISTS assert_receipt_covers_applications();
DROP FUNCTION IF EXISTS assert_application_within_receipt();

-- payment_applications first: it is the referencing side.
DROP TABLE IF EXISTS payment_applications;
DROP TABLE IF EXISTS payments;
