-- Up Migration
-- EOS Operational Data Plane — the INVOICE business authority, with no header aggregate that can
-- disagree with its own lines.
--
-- ============================================================================
-- MIGRATION 008. The target architecture is PostgreSQL business authority -> governed EOS server
-- commands -> EOS APIs. Invoice is today held in Firestore `invoices` (deny-all in
-- firestore.rules, written only by the trusted callables in functions/src/finance/). This
-- migration lands the Postgres authority for the invoice ITSELF -- header identity, company,
-- account, sales-order lineage, and the billed lines -- and deliberately stops short of the AR
-- overlay (payments, applications, adjustments, refunds), which is a separate queued lane.
--
-- STANDARD POSTGRESQL ONLY, same as 001-007. Additive: no earlier migration is edited. There is
-- NO data migration in this packet, and nothing deployed writes these tables yet.
-- ============================================================================
--
-- ════════════════════ THE DEFECT THIS SCHEMA REFUSES TO REPRODUCE ════════════════════
--
-- In the Firestore representation the invoice header stores `subtotalMinor`, `discountMinor`,
-- `taxMinor` and `totalMinor` as numbers computed ONCE, at issuance, from the line array:
-- functions/src/finance/invoiceCommands.ts's `buildInvoiceRecord` reduces `out` into those four
-- fields and persists them beside `lines` on the same document.
--
-- Nothing anywhere re-checks them against those lines afterwards. The reconciler that exists --
-- functions/src/finance/financialReconciliation.ts's `reconcileInvoiceProjection` -- takes
-- `stored.totalMinor` as its GIVEN basis (`totalMinor: stored.totalMinor` in `derivedFacts`) and
-- proves only the AR overlay on top of it: appliedMinor, creditsMinor, chargesMinor,
-- writeOffMinor, outstandingMinor, state. So the one number every downstream AR figure is
-- computed from -- billed, outstanding, aging (financeReadProjection.ts's `summarizeAccountAr`
-- and `summarizeArAging`) -- is the only one with no reconciliation proof at all.
--
-- That is a stored aggregate that can disagree with its lines. This schema does not add a second
-- reconciler for it; it removes the possibility:
--
--   1. THE HEADER STORES NO TOTALS. There are no subtotal/discount/tax/total columns on
--      `invoices`. `invoice_totals` is a VIEW that SUMs the lines, so "the invoice total" has
--      exactly one definition and no storage of its own to drift from.
--   2. LINE ARITHMETIC IS GENERATED, NOT SUPPLIED. `subtotal_minor`, `taxable_base_minor` and
--      `line_total_minor` are GENERATED ALWAYS ... STORED. Postgres refuses an INSERT or UPDATE
--      that tries to supply one, so a writer cannot post a line whose own arithmetic is wrong --
--      not by mistake, and not deliberately.
--
-- The equivalent Firestore fields stay where they are; retiring them belongs to the cutover that
-- moves the read, not to a migration that adds a table nothing writes yet.
--
-- ════════════════════ WHY MONEY IS BIGINT MINOR UNITS, NEVER NUMERIC ════════════════════
--
-- The command core is already integer-minor-unit only: `isInt`/`isPosInt`/`isNonNegInt` in
-- invoiceCommands.ts reject any non-safe-integer amount, and every amount it produces is an exact
-- integer. NUMERIC here would introduce a representable value the application layer refuses, and
-- a scale nobody has decided. BIGINT carries every value the command core can produce, exactly.
--
-- ════════════════════ OWNERSHIP AND OPERATING COMPANY ════════════════════
--
-- The ownership matrix classifies Invoice under ruling D-15 (functions/src/ownership/
-- ownershipMatrix.ts, the COMPANY -- financial block): ownerClass COMPANY, ownerFields EMPTY,
-- transfer IMMUTABLE, companyScope SINGLE_COMPANY -- "Owner is the company whose books hold it --
-- NOT the salesperson it descends from." So there is NO owner-person column here, and that is a
-- classification, not a gap: the commercial attribution is reachable through the
-- Account -> Opportunity -> Sales Agreement -> Sales Order lineage, and the credited salesperson
-- is carried on the frozen attribution snapshot, not as ownership.
--
-- `operating_company_key` is therefore the ownership authority for this record. It is NOT NULL
-- with NO DEFAULT, exactly as migration 007 made it on the inventory tables, and for the same
-- reason: a DEFAULT would let a writer that never decided a company still produce a row claiming
-- one. It is never inferred from a warehouse, a truck, an employee or a homeWarehouseId. For a
-- Sales-Order-derived invoice the governed source is the ORDER's own company --
-- invoiceCommands.ts's `verifySalesOrderMatch` refuses COMPANY_REQUIRED when the order has none
-- and COMPANY_MISMATCH when a caller asserts a different one -- and this column stores that
-- decided key opaquely, the same way `location_id` is carried opaquely.
--
-- ════════════════════ IDENTITY: THE OPAQUE id, NOT THE INVOICE NUMBER ════════════════════
--
-- `id` is the canonical identity and `invoice_number` is the human REFERENCE, which is the split
-- the existing code already makes: invoiceCallables.ts allocates the number from a per-company
-- counter and then writes the record at a separately-minted document id ("canonical opaque
-- identity, distinct from the number"), and field-ops-app-vite/src/metadata/definitions/invoice.js
-- declares `makeIdentity({ referenceField: "invoiceNumber" })` with no nameField. The number is
-- unique PER TENANT PER OPERATING COMPANY because that is the scope it is allocated in
-- (invoiceNumbering.ts's `invoiceCounterRef` keys the counter `invoices_${companyId}`); making it
-- globally unique would assert a numbering authority the allocator does not have.
--
-- ════════════════════ WHY THERE IS NO `state` COLUMN ════════════════════
--
-- The vocabulary in field-ops-app-vite/src/domain/commercialFinance.js is DRAFT / ISSUED / SENT /
-- PARTIALLY_PAID / PAID / VOID, and the metadata definition already records that DRAFT and SENT
-- are unreachable by any write path that exists. Of the four that are reachable, only two are
-- facts this table owns:
--
--   * ISSUED is what a row in this table IS. `buildInvoiceRecord` has `state: "ISSUED"` as a
--     literal -- an invoice is created issued, there is no other creation state -- so a column
--     whose value is the same constant on every row states nothing.
--   * VOID is a real, durable decision someone makes, so the columns exist: `voided_at` /
--     `void_reason` / `voided_by`, all-or-nothing. AND NO WRITE PATH SETS IT TODAY -- searched:
--     every occurrence of "VOID" in functions/src/finance/ is a READ. Four commands refuse to act
--     on a void invoice (adjustmentCommands.ts:88, refundCommands.ts:79, paymentCommands.ts:123,
--     and paymentCommands.ts:84's terminal-state rule) and the AR read projects a VOID position
--     (financeReadProjection.ts:35), but nothing anywhere can make an invoice void. The columns
--     are here because the readers that already branch on it need a shape to read; a `voidInvoice`
--     command is NOT invented in this packet, because inventing one would be deciding a financial
--     policy -- who may void, against what evidence, with what effect on issued numbering -- that
--     nobody has decided.
--   * PARTIALLY_PAID and PAID are NOT facts. paymentCommands.ts's `deriveInvoiceStateFromFacts`
--     COMPUTES them from applied/credits/charges/write-offs, and `reconcileInvoiceProjection`
--     already treats a stored `state` as drift-prone enough to diff. Storing them here would
--     recreate, for the lifecycle, precisely the divergence this migration removes for the money.
--
-- They belong to the AR overlay the Payment lane owns, derived from its application facts joined
-- to `invoice_totals`. This migration deliberately leaves that join surface and writes none of it.
--
-- ════════════════════ WHAT THIS SCHEMA CANNOT ENFORCE, STATED PLAINLY ════════════════════
--
-- "An invoice has at least one line" (invoiceCommands.ts's NO_LINES) is a cross-table claim a
-- CHECK cannot make. It is enforced by the repository, which inserts header and lines in ONE
-- transaction and refuses an empty line set (functions/src/eosOps/invoiceAuthority.ts's
-- `insertIssuedInvoice`). Recorded here rather than asserted: a header with no lines is possible
-- at the SQL boundary alone, and `invoice_totals.line_count` is exposed so a reader can see it.

SET search_path = eos_ops, public;

-- ============================ the invoice ============================

CREATE TABLE invoices (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    -- OWNERSHIP AUTHORITY (ruling D-15). NOT NULL, no DEFAULT, never inferred. See the header.
    operating_company_key TEXT        NOT NULL,
    -- The human REFERENCE, allocated per company. Never the identity -- see the header.
    invoice_number        TEXT        NOT NULL,
    account_id            TEXT        NOT NULL,
    -- The billed Sales Order. NOT NULL because every issuance path that exists cross-checks
    -- against a governed order (verifySalesOrderMatch); an invoice with no order has no basis.
    sales_order_id        TEXT        NOT NULL,
    -- The code the minor-unit amounts are denominated in. Carried, not validated against a
    -- currency table -- no such authority exists here, and inventing one would be a second one.
    currency              TEXT        NOT NULL,
    -- AR aging begins here (carried at issuance, never computed). TIMESTAMPTZ rather than the
    -- ms-epoch integer the Firestore record uses: it is a date, and the storage shape it had was
    -- a Firestore limitation, not a decision.
    due_date              TIMESTAMPTZ NOT NULL,
    issued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Provenance the Firestore document does not have: no write path there ever stores WHO issued
    -- an invoice on the document itself (only the separate audit event does). Required here.
    issued_by             TEXT        NOT NULL,
    -- Provenance of the INJECTED tax determination. Nullable: the issuance input carries it
    -- optionally (`taxProvenance?: string | null`), and a null is an honest absence.
    tax_provenance        TEXT,
    -- VOID, the one post-issuance lifecycle fact this table owns. All three or none.
    voided_at             TIMESTAMPTZ,
    void_reason           TEXT,
    voided_by             TEXT,
    CONSTRAINT invoice_number_unique_per_company
        UNIQUE (tenant_id, operating_company_key, invoice_number),
    CONSTRAINT invoice_currency_present CHECK (length(btrim(currency)) > 0),
    CONSTRAINT invoice_number_present   CHECK (length(btrim(invoice_number)) > 0),
    CONSTRAINT invoice_company_present  CHECK (length(btrim(operating_company_key)) > 0),
    -- A void with no reason and no actor is an unattributable erasure of a financial record.
    CONSTRAINT invoice_void_is_complete CHECK (
        (voided_at IS NULL     AND void_reason IS NULL     AND voided_by IS NULL)
        OR
        (voided_at IS NOT NULL AND void_reason IS NOT NULL AND voided_by IS NOT NULL)
    )
);

-- The ONE query the read path actually makes today: financeReadCallables.ts's listAccountInvoiceAr
-- is literally `.where("accountId", "==", accountId)`.
CREATE INDEX invoices_by_account      ON invoices (tenant_id, account_id);
-- The Sales Order -> Invoice lineage, in the direction a fulfilment reader asks it.
CREATE INDEX invoices_by_sales_order  ON invoices (tenant_id, sales_order_id);
CREATE INDEX invoices_by_company      ON invoices (tenant_id, operating_company_key);

-- ============================ the billed lines ============================
--
-- One row per billed Sales Order line. The line is where the money IS; the header has none.
--
-- Multiple rows MAY reference the same `sales_order_line_id` on one invoice: the command core
-- accumulates per-line requests (`requestedById` in verifySalesOrderMatch) rather than refusing a
-- repeat, so a UNIQUE here would refuse something the governed command permits.

CREATE TABLE invoice_lines (
    id                   TEXT   PRIMARY KEY,
    tenant_id            TEXT   NOT NULL REFERENCES eos_policy.tenants(id),
    -- ON DELETE RESTRICT, not CASCADE: deleting an invoice out from under its own lines is not a
    -- convenience this schema offers for financial records.
    invoice_id           TEXT   NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    sales_order_line_id  TEXT   NOT NULL,
    line_kind            TEXT   NOT NULL,
    line_ref             TEXT   NOT NULL,
    -- FIN-002 reporting attribution, taken from the governed Sales Order line. NULL for
    -- pre-FIN-002 orders -- an honest absence, never a guess (InvoiceLineRecord.businessUnitId).
    business_unit_id     TEXT,
    billable_qty         INTEGER NOT NULL,
    unit_price_minor     BIGINT  NOT NULL,
    -- Explicit governed line discount. DEFAULT 0 is safe here and only here: the command core
    -- itself treats an absent discount as 0 (`l.discountMinor === undefined ? 0 : ...`), so zero
    -- is the stated meaning of absence rather than a manufactured value.
    discount_minor       BIGINT  NOT NULL DEFAULT 0,
    -- The INJECTED tax determination. NOT NULL and NO DEFAULT, deliberately unlike discount: the
    -- command core refuses issuance outright when a line has no determination
    -- (TAX_REQUIRES_REVIEW), so a DEFAULT 0 here would let the database claim a tax answer the
    -- application layer says nobody gave.
    tax_minor            BIGINT  NOT NULL,

    -- ════════ THE ARITHMETIC, GENERATED — NO WRITER MAY SUPPLY IT ════════
    -- Identical to buildInvoiceRecord's per-line computation, expressed where it cannot be
    -- bypassed. Postgres rejects any INSERT/UPDATE that supplies a value for these columns.
    subtotal_minor       BIGINT GENERATED ALWAYS AS (unit_price_minor * billable_qty) STORED,
    taxable_base_minor   BIGINT GENERATED ALWAYS AS (unit_price_minor * billable_qty - discount_minor) STORED,
    line_total_minor     BIGINT GENERATED ALWAYS AS (unit_price_minor * billable_qty - discount_minor + tax_minor) STORED,

    CONSTRAINT invoice_line_qty_positive      CHECK (billable_qty > 0),
    CONSTRAINT invoice_line_price_nonneg      CHECK (unit_price_minor >= 0),
    CONSTRAINT invoice_line_discount_nonneg   CHECK (discount_minor >= 0),
    CONSTRAINT invoice_line_tax_nonneg        CHECK (tax_minor >= 0),
    -- buildInvoiceRecord's "discount exceeds subtotal" refusal, structurally. A generated column
    -- cannot be referenced by a CHECK on the same table, so the expression is repeated rather
    -- than the rule being restated somewhere it is not enforced.
    CONSTRAINT invoice_line_discount_within_subtotal
        CHECK (discount_minor <= unit_price_minor * billable_qty)
);

CREATE INDEX invoice_lines_by_invoice ON invoice_lines (tenant_id, invoice_id);

-- ============================ the ONE definition of an invoice total ============================
--
-- Not a materialization and not a cache: a view, so it cannot be stale and cannot be written.
-- `line_count` is exposed because "zero lines" is the one shape the SQL boundary alone cannot
-- refuse (see the header), and a reader is entitled to see it rather than read a 0 total as
-- "nothing billed".

CREATE VIEW invoice_totals AS
SELECT
    i.id                                            AS invoice_id,
    i.tenant_id                                     AS tenant_id,
    i.operating_company_key                         AS operating_company_key,
    i.account_id                                    AS account_id,
    i.sales_order_id                                AS sales_order_id,
    i.currency                                      AS currency,
    i.due_date                                      AS due_date,
    (i.voided_at IS NOT NULL)                       AS is_void,
    count(l.id)                                     AS line_count,
    COALESCE(sum(l.subtotal_minor),     0)::BIGINT  AS subtotal_minor,
    COALESCE(sum(l.discount_minor),     0)::BIGINT  AS discount_minor,
    COALESCE(sum(l.taxable_base_minor), 0)::BIGINT  AS taxable_base_minor,
    COALESCE(sum(l.tax_minor),          0)::BIGINT  AS tax_minor,
    COALESCE(sum(l.line_total_minor),   0)::BIGINT  AS total_minor
FROM invoices i
LEFT JOIN invoice_lines l
       ON l.invoice_id = i.id
      AND l.tenant_id  = i.tenant_id
GROUP BY i.id;

-- Down Migration
SET search_path = eos_ops, public;

-- Financial records are not dropped silently. The up migration adds tables nothing deployed writes
-- yet; if that has changed by the time someone reverses it, the reversal destroys issued invoices
-- and their lines, and no HINT in a migration log is an acceptable record of that. Refuse instead,
-- the same way migration 007 refuses to invent -- or to discard -- authority it does not own.
DO $$
DECLARE
    occupied BIGINT;
BEGIN
    SELECT count(*) INTO occupied FROM eos_ops.invoices;
    IF occupied > 0 THEN
        RAISE EXCEPTION
            'migration 008 cannot be reversed: % invoice rows exist and would be destroyed',
            occupied
            USING HINT = 'Issued invoices are financial records. Export and retire them by governed means first.';
    END IF;
END
$$;

DROP VIEW  IF EXISTS invoice_totals;
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoices;
