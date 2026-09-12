-- Up Migration
-- EOS Operational Data Plane — the PURCHASING objects: Reorder Request, Purchase Order,
-- Receiving Order, Transfer Order.
--
-- ============================================================================
-- MIGRATION 008. Owner ruling (P1B, "PostgreSQL is the target authoritative operational
-- persistence"): the four purchasing objects get a Postgres authority whose SHAPE preserves the
-- purchasing governance already settled in the Firestore/Rules era, rather than a transliteration
-- that quietly drops it.
--
-- Five already-settled rulings are carried here as STRUCTURE, not as convention. Each one is
-- named at the table that enforces it:
--
--   1. IMMUTABLE PURCHASE ORDER          `purchase_orders` has no updated_at/updated_by and no
--                                        status column — there is nothing on the row an update
--                                        could be recorded in.
--   2. PO id == REQUEST id               `purchase_orders.id` IS the reorder request id: one
--                                        column, primary key AND foreign key. Two columns could
--                                        disagree; one cannot.
--   3. VOID WRITES A VOID RECORD         `purchase_order_voids` is a separate append-only table
--                                        keyed by the purchase order it voids. Voiding inserts a
--                                        row; it never updates or deletes the purchase order.
--   4. NO CLIENT OPERATING-COMPANY       every table carries a governed operating-company key,
--      AUTHORITY                         NOT NULL with NO DEFAULT, exactly as migration 007
--                                        established. A caller states it or the INSERT fails.
--   5. FAIL CLOSED                       every vocabulary is an enum, every pairing is a CHECK,
--                                        and no column that carries authority has a default.
--
-- STANDARD POSTGRESQL ONLY, same as 001-007. Additive: no earlier migration is edited, and none
-- of migration 005/007's tables is altered.
-- ============================================================================
--
-- ════════════════════ WHY THE PURCHASE ORDER HAS NO STATUS COLUMN ════════════════════
--
-- Because the stored one was never a fact the record decided. `buildRecordReorderPurchaseOrder`
-- (functions/src/reorderRequest/reorderCommands.ts) writes `status: "ORDERED"` as a literal on
-- every purchase order it has ever created, and firestore.rules then makes the document immutable
-- (`allow update, delete: if false`), so no later event can change it. The column would therefore
-- hold one constant, forever, on every row.
--
-- Worse, it would hold it WRONGLY. Everything a reader actually wants to know about a purchase
-- order after it is placed — partially received, fully received, voided — is decided by records
-- that arrive LATER: `receiving_order_lines` and `purchase_order_voids`. purchaseOrderNormalization.ts
-- already ruled that this is DERIVED and never stored ("Cumulative received quantity is the SUM OF
-- COMMITTED RECEIPTS, never a counter mutated on the PO"), for the reason that a stored counter on
-- an immutable document is a number nothing is allowed to correct. A stored status is the same
-- defect wearing a different name: the row cannot be updated, so the moment a receipt or a void
-- lands, the stored status is stale and there is no legal write that would fix it.
--
-- So the state is a query over the receipts and the void record, and the only thing this table
-- stores is what was COMMITTED TO THE VENDOR at the moment of ordering.
--
-- ════════════════════ WHY THE PURCHASE ORDER HAS NO updated_by / updated_at ════════════════════
--
-- Migration 005 enforced `inventory_movements`' immutability "at the application layer at minimum
-- ... the repository offers no update/delete method, and a static test proves it". That posture is
-- kept — purchasingRepository.ts exposes no update or delete for this table and a static test
-- proves it — and this table adds the structural half that a ledger row could not have: there is
-- no column in which an update could be recorded. A row that was modified would have no author and
-- no time, which makes a silent modification unrepresentable rather than merely discouraged.
--
-- ════════════════════ WHY THE PRICE CONSTRAINT IS A BICONDITIONAL, PLUS AN IMPLICATION ════════
--
-- FIN-BLOCK-003A settled two separate facts and this schema keeps them separate:
--
--   * An AMOUNT AND ITS CURRENCY MOVE TOGETHER. `governedPurchasePrice` returns one validated value
--     or null, so a stored purchase order "can never carry an amount whose currency is unknown".
--     `purchase_order_price_pairs` is that, as a biconditional.
--   * A STAMP IMPLIES A PRICE, BUT A PRICE DOES NOT IMPLY A STAMP. normalizeLegacyPurchaseOrder
--     refuses a document that "claims the price authority but carries no governed price"
--     (PO_PRICE_MISSING) — because the command that stamps the version is the same one that
--     requires the price. The converse is deliberately NOT constrained: a pre-authority purchase
--     order is legacy BY ITS MISSING STAMP, not by its missing price, and it stays receivable.
--     `purchase_order_stamp_implies_price` is that implication, one-directional on purpose.
--
-- ════════════════════ THE TRANSFER ORDER'S DIRECTIONAL COMPANY PAIR ════════════════════
--
-- A transfer order is the ONE purchasing object whose operating-company authority is not a scalar.
-- The ownership matrix (functions/src/ownership/ownershipMatrix.ts, family `transferOrder`) classes
-- it PARTICIPATING_COMPANIES / CROSS_COMPANY_CAPABLE and records the Owner's refusal to pick a
-- convention: "'Source always owns it' and 'destination always owns it' were both rejected: either
-- would record a company as responsible for a movement it may only have received." The stored
-- record carries the pair (`sourceOperatingCompanyId` + `destinationOperatingCompanyId`), and
-- transferOrderRepository.ts's deserializer already refuses a half-pair ("both or neither, never a
-- scalar owner").
--
-- So this table carries TWO NOT NULL company columns and no scalar owner. Both are mandatory even
-- when they are equal: a same-company transfer states the same key twice, which is a fact, whereas
-- a single nullable column would make "Taylor to Taylor" and "nobody decided" the same row.
--
-- `is_cross_company` is GENERATED ALWAYS ... STORED rather than written by a caller. It is a
-- restatement of the two columns beside it, and a restatement a writer can author is a restatement
-- a writer can get wrong; 23 of the 47 sandbox transfer orders are cross-company, which is far too
-- many for a hand-maintained flag to stay correct through an import.
--
-- ════════════════════ WHY inventory_movements' SCALAR COMPANY KEY IS STILL CORRECT ════════════
--
-- Migration 007 gave `inventory_movements` a single `operating_company_key`, and a cross-company
-- transfer plainly involves two. That is not a gap, and this migration deliberately does NOT widen
-- that column: a movement ROW is one-sided BY CONSTRUCTION. Transfer dispatch stages TRANSFER_OUT
-- at the ORIGIN and transfer receipt stages TRANSFER_IN at the DESTINATION — two rows, two
-- locations, two moments, never one row spanning both. Each row's company is the company of the one
-- endpoint it describes, which is a scalar.
--
-- Widening that column to a pair would state, on the TRANSFER_OUT row, a destination company that
-- had not yet received anything, and would put a second copy of the destination's authority
-- somewhere the destination's own TRANSFER_IN row already states it — the "two places for one fact"
-- shape migration 007's own header refused for cycle_count_lines. The projection from the pair to
-- the per-leg scalar lives in purchasingRepository.ts (`transferLegOperatingCompanyKey`), in ONE
-- place, so the ledger and the order can never disagree about which company a leg belongs to.
--
-- ════════════════════ WHY THE LEGACY WAREHOUSE SCALARS ARE NOT MIGRATED ════════════════════
--
-- `transfer_orders` in Firestore additively carries `fromWarehouseId`/`toWarehouseId` on exactly
-- the WAREHOUSE→WAREHOUSE orders (serializeTransferOrder writes them only when both endpoints are
-- WAREHOUSE), purely so a warehouse manager's Rules-scoped read and the legacy RawTransferOrder
-- client shape keep working. They are a SECOND representation of `origin`/`destination`, they exist
-- on 23 of 47 records, and in the live census they disagree with the typed refs zero times.
--
-- They are therefore RETIRED here rather than carried: this table has no from_warehouse_id and no
-- to_warehouse_id. `origin_location_*` / `destination_location_*` are total over all 47 records and
-- over every endpoint type; the scalars are total over none of them and are, by construction, a
-- lossy projection (a MOBILE endpoint has no warehouse id to write). The migration mapper
-- (eosOps/migration/purchasingMigrationMapping.ts) REFUSES any record whose legacy scalars disagree
-- with its typed refs, so the zero-disagreement finding is re-proved per record at import time
-- rather than trusted from a census — and then drops them.
--
-- ════════════════════ WHY RECEIVING CARRIES THE LEGACY IDENTITY EQUATION ════════════════════
--
-- receivingTypes.ts's `ReceivingSourceRef` says the legacy chain's `purchaseOrderId` "==
-- reorderRequestId (spec §2)" and the deserializer "enforces the pairing in both directions".
-- `receiving_order_source_identity` is that pairing as SQL: the reorder request id is present iff
-- the source is the legacy chain, AND when present it EQUALS the purchase order id. A canonical
-- `purchase_orders` receipt has no reorder request, and writing a blank one "would assert it has one
-- whose id we do not know".

SET search_path = eos_ops, public;

-- ============================ vocabulary ============================
--
-- Every one of these mirrors a vocabulary the product already ratified; none is invented here.

-- field-ops-app-vite/src/domain/constants.js REORDER_REQUEST_STATUS, verbatim and complete.
-- CANCELLED, RECEIVED and VOIDED are terminal; VOIDED is reachable only from ORDERED.
CREATE TYPE ops_reorder_request_status AS ENUM (
    'PENDING_REVIEW', 'APPROVED', 'REJECTED',
    'READY_FOR_PARTS_MANAGER', 'ASSIGNED_TO_PARTS_ASSOCIATE', 'PURCHASING_IN_PROGRESS',
    'ORDERED', 'RECEIVED', 'CANCELLED', 'VOIDED'
);

-- receivingTypes.ts RECEIVING_ORDER_STATUSES.
CREATE TYPE ops_receiving_order_status AS ENUM ('EXPECTED', 'CHECKED_IN', 'PUTAWAY_COMPLETE', 'CANCELLED');

-- receivingTypes.ts RECEIVING_SOURCE_TYPES — the closed discriminator that is why "there is NO
-- ambiguous collection lookup". Carried so a receipt still STATES which purchasing authority it
-- addresses instead of being inferred from which id happens to resolve.
CREATE TYPE ops_receiving_source_kind AS ENUM ('REORDER_PURCHASE_ORDER', 'PURCHASE_ORDER');

-- transferOrderTypes.ts TRANSFER_ORDER_STATUSES.
CREATE TYPE ops_transfer_order_status AS ENUM ('REQUESTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

-- ============================ Reorder Request ============================
--
-- The MUTABLE workflow record of the four — a request moves through review, assignment, purchasing
-- and closeout, and that progression is the object. Its operating company is derived ONCE from the
-- governed Warehouse at creation (ruling R-13) and never re-derived, which is why it is an ordinary
-- stored column here and not a join: re-deriving it later "would silently rewrite history if the
-- warehouse were later reassigned".

CREATE TABLE reorder_requests (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- Migration 007's contract, extended to purchasing: NOT NULL, NO DEFAULT, opaque governed key.
    -- REFUSED at the boundary as well (requireOperatingCompanyKey), so a caller that omitted it gets
    -- the reason rather than a constraint name.
    operating_company_key TEXT NOT NULL,
    part_id               TEXT NOT NULL,
    -- Opaque, carried as data, never joined as identity — the same treatment migration 005 gives
    -- `location_id`, and for the same reason: Warehouse authority is not owned by this schema.
    warehouse_id          TEXT NOT NULL,
    status                ops_reorder_request_status NOT NULL,
    -- A whole number. Zero is legal for a system RECOMMENDATION (buildCreateReorderRequest rejects
    -- <= 0 only for the manual NEEDS_PLANNING path), so this is >= 0 and the stricter manual rule
    -- stays where it already lives, in the command.
    requested_quantity    INTEGER NOT NULL CHECK (requested_quantity >= 0),
    recommended_quantity  INTEGER,
    work_order_id         TEXT,
    -- RR-YYYY-###### (reorderRequestNumbering.ts). NULL on records created before the allocator
    -- existed, and never backfilled — an absent reference is a true fact about a legacy record.
    reorder_request_number TEXT,
    requested_by          TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT        NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Six digits is a FLOOR, not a cap: formatReorderRequestNumber pads to six and does not truncate
    -- once the sequence outgrows it.
    CONSTRAINT reorder_request_number_format CHECK (
        reorder_request_number IS NULL OR reorder_request_number ~ '^RR-[0-9]{4}-[0-9]{6,}$'
    )
);

CREATE INDEX reorder_requests_by_status    ON reorder_requests (tenant_id, status);
CREATE INDEX reorder_requests_by_warehouse ON reorder_requests (tenant_id, warehouse_id);
CREATE INDEX reorder_requests_by_company   ON reorder_requests (tenant_id, operating_company_key);

-- ============================ Purchase Order ============================
--
-- IMMUTABLE. Created once, at the vendor commitment point, and never written again.

CREATE TABLE purchase_orders (
    -- RULING 2, STRUCTURALLY. The purchase order's identity IS the reorder request's identity
    -- (R-16: "The PO's document id IS the reorder request's id, its `reorderRequestId` is pinned
    -- equal to it, and the request's `purchaseOrderId` points back at the same value").
    --
    -- The Firestore shape needs THREE fields to say that and a command to keep them equal. Here it
    -- is ONE column that is simultaneously the primary key and the foreign key, so:
    --   · the purchase order cannot name a request it is not identified by — same column;
    --   · the request must exist          — foreign key;
    --   · a request can have at most ONE  — primary key (the PO_ALREADY_EXISTS guard, in SQL);
    --   · the back-link needs no column   — the request's purchase order is the row with its id.
    id                      TEXT PRIMARY KEY REFERENCES reorder_requests(id),
    tenant_id               TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- INHERITED from the request, never re-derived from the warehouse, and never client-supplied.
    operating_company_key   TEXT NOT NULL,
    part_id                 TEXT NOT NULL,
    -- A NAME, not a Supplier Master id — and honestly so. purchaseOrderNormalization.ts:
    -- "a legacy PO carries `supplierName` (a string), not a Supplier Master id. A name is not an id,
    -- and inventing a resolution here would either be a per-read lookup (an N+1) or a guess."
    -- Supplier identity is lane C6's object; this column is deliberately not a foreign key to it.
    supplier_name           TEXT        NOT NULL CHECK (length(btrim(supplier_name)) > 0),
    external_po_number      TEXT        NOT NULL CHECK (length(btrim(external_po_number)) > 0),
    ordered_quantity        INTEGER     NOT NULL CHECK (ordered_quantity > 0),
    -- A real DATE, not the ISO string the Firestore document stores. The import boundary converts
    -- and refuses anything it cannot convert, rather than carrying a string this authority could
    -- never order or compare.
    ordered_date            DATE        NOT NULL,
    expected_arrival_date   DATE,
    -- FIN-BLOCK-003A. Integer MINOR UNITS — there is no floating-point money on this path. NULL means
    -- UNKNOWN and is NEVER zero: an explicit 0 is a no-charge line (a warranty replacement, a sample)
    -- and is a different fact from a price nobody entered.
    unit_price_minor        BIGINT,
    currency                TEXT,
    -- The server-authored stamp. finance/acquisitionCost.ts PRICE_AUTHORITY_VERSION. NULL marks a
    -- purchase order recorded before the price authority existed — legacy by its MISSING STAMP, not
    -- by its missing price, and still fully receivable.
    price_authority_version INTEGER CHECK (price_authority_version IS NULL OR price_authority_version >= 1),
    created_by              TEXT        NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- DELIBERATELY NO updated_by / updated_at / status. See the header: an immutable record offers
    -- no place to record a modification, and its lifecycle state is derived from the receipts and
    -- the void record rather than stored where nothing may correct it.
    CONSTRAINT purchase_order_price_pairs CHECK ((unit_price_minor IS NULL) = (currency IS NULL)),
    CONSTRAINT purchase_order_currency_shape CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    -- One-directional on purpose. Stamp ⇒ price; price ⇏ stamp.
    CONSTRAINT purchase_order_stamp_implies_price CHECK (
        price_authority_version IS NULL OR unit_price_minor IS NOT NULL
    )
);

CREATE INDEX purchase_orders_by_company  ON purchase_orders (tenant_id, operating_company_key);
CREATE INDEX purchase_orders_by_supplier ON purchase_orders (tenant_id, supplier_name);

-- ============================ Purchase Order Void ============================
--
-- RULING 3, STRUCTURALLY. Voiding a purchase order APPENDS a record; it never deletes or mutates
-- the purchase order, which is exactly why the purchase order can be immutable at all.
--
-- Keyed by the purchase order it voids — which, by ruling 2, is also the reorder request id, which
-- is also the Firestore void document's own id ("a void record's document ID IS the reorderRequestId",
-- field-ops-app-vite/src/hooks/useReorderPurchaseOrderVoids.js). One void per purchase order, and no
-- second id to keep in step with anything.
--
-- The paired transition — this insert together with the request moving to VOIDED — is a TRANSACTION
-- boundary, not a constraint: a CHECK cannot see another table. purchasingRepository.ts's
-- `voidPurchaseOrder` performs both inside one BEGIN/COMMIT, the same way cycleCountRepository.ts's
-- `reconcileLine` stages its ledger row and its line update together, and for the same reason.

CREATE TABLE purchase_order_voids (
    purchase_order_id     TEXT PRIMARY KEY REFERENCES purchase_orders(id),
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_key TEXT NOT NULL,
    part_id               TEXT NOT NULL,
    -- A void with no stated reason is not evidence of anything. Required, and required to be
    -- non-blank, because the Rules contract already pins it equal to the request's voidReason.
    reason                TEXT        NOT NULL CHECK (length(btrim(reason)) > 0),
    voided_by             TEXT        NOT NULL,
    voided_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    -- No updated_*, no status, no "unvoid". Append-only means the row, once written, is the fact.
);

CREATE INDEX purchase_order_voids_by_company ON purchase_order_voids (tenant_id, operating_company_key);

-- ============================ Receiving Order ============================

CREATE TABLE receiving_orders (
    id                       TEXT PRIMARY KEY,
    tenant_id                TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- ONE destination, therefore ONE owning company (ownershipMatrix.ts, family `receivingOrder`:
    -- "Receiving has one destination, so it has one owning company. Unlike a transfer.").
    operating_company_key    TEXT NOT NULL,
    source_kind              ops_receiving_source_kind NOT NULL,
    -- Opaque on purpose: NOT a foreign key to purchase_orders. The canonical multi-line
    -- `purchase_orders` object is a DIFFERENT authority that this schema does not yet hold, and a
    -- foreign key would make every canonical receipt unrepresentable. The source_kind states which
    -- authority the id belongs to; nothing sniffs it.
    source_purchase_order_id TEXT NOT NULL,
    source_reorder_request_id TEXT,
    receiving_location_type  ops_location_type NOT NULL,
    receiving_location_id    TEXT NOT NULL,
    status                   ops_receiving_order_status NOT NULL,
    -- RO-YYYY-###### (receivingOrderNumbering.ts). NULL on pre-allocator records; never backfilled.
    receiving_order_number   TEXT,
    -- Receipt identity is the caller's idempotency key, hashed into the id. Unique per tenant so a
    -- retry cannot post a second receipt for one physical event.
    idempotency_key          TEXT        NOT NULL,
    created_by               TEXT        NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by               TEXT        NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT receiving_order_number_format CHECK (
        receiving_order_number IS NULL OR receiving_order_number ~ '^RO-[0-9]{4}-[0-9]{6,}$'
    ),
    -- The legacy chain's identity equation, in both directions.
    CONSTRAINT receiving_order_source_identity CHECK (
        (source_kind = 'REORDER_PURCHASE_ORDER') = (source_reorder_request_id IS NOT NULL)
        AND (source_reorder_request_id IS NULL OR source_reorder_request_id = source_purchase_order_id)
    )
);

CREATE UNIQUE INDEX receiving_orders_idempotency ON receiving_orders (tenant_id, idempotency_key);
CREATE INDEX receiving_orders_by_source  ON receiving_orders (tenant_id, source_kind, source_purchase_order_id);
CREATE INDEX receiving_orders_by_company ON receiving_orders (tenant_id, operating_company_key);

-- ============================ Receiving Order line ============================
--
-- THE derivation source for "how much of this purchase order has arrived". Cumulative received
-- quantity is the SUM over these rows and is never a counter on the purchase order — the ruling
-- purchaseOrderNormalization.ts already made, preserved as the only shape in which it is expressible
-- here (the purchase order has no column to count into).
--
-- No operating_company_key: a line is not an independently located record. Its receiving order is
-- the governed parent authority for the whole receipt, exactly as migration 007 argued for
-- cycle_count_lines — copying the key onto every line is the only way the two could ever disagree.

CREATE TABLE receiving_order_lines (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    receiving_order_id TEXT NOT NULL REFERENCES receiving_orders(id),
    -- The PO LINE this receipt addresses. `L1` for the legacy single-part chain (LEGACY_LINE_ID),
    -- a canonical line id otherwise. A receipt addresses a line BY ID, which is what makes
    -- "(purchaseOrderId, lineId)" mean the same thing forever.
    line_id            TEXT NOT NULL,
    part_id            TEXT NOT NULL,
    tracking_mode      ops_tracking_mode NOT NULL,
    -- What REMAINED on the PO line when this receipt was taken. Not what was ordered.
    expected_quantity  INTEGER NOT NULL CHECK (expected_quantity >= 0),
    received_quantity  INTEGER NOT NULL CHECK (received_quantity > 0),
    serial_numbers     TEXT[]  NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One line per PO line per receipt: the same line twice in one receipt makes the intended
    -- quantity ambiguous (validateProposedReceipt's RECEIPT_LINE_DUPLICATE, in SQL).
    CONSTRAINT receiving_order_lines_one_per_line UNIQUE (tenant_id, receiving_order_id, line_id),
    -- One physical unit, one serial. SERIAL carries exactly `received_quantity` serials; NONE
    -- carries none, and a NONE line with a serial "would create a second, unauthoritative place
    -- serial identity could live".
    CONSTRAINT receiving_line_serials_match_tracking CHECK (
        (tracking_mode = 'SERIAL'
            AND cardinality(serial_numbers) = received_quantity
            AND array_position(serial_numbers, NULL) IS NULL)
        OR (tracking_mode = 'NONE' AND cardinality(serial_numbers) = 0)
    )
);

CREATE INDEX receiving_order_lines_by_order ON receiving_order_lines (tenant_id, receiving_order_id);
CREATE INDEX receiving_order_lines_by_part  ON receiving_order_lines (tenant_id, part_id);

-- ============================ Transfer Order ============================

CREATE TABLE transfer_orders (
    id                                 TEXT PRIMARY KEY,
    tenant_id                          TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- THE DIRECTIONAL PAIR. Both NOT NULL, both with no default, and no scalar owner column beside
    -- them. See the header: the Owner refused source-owns and destination-owns alike, and the
    -- stored Firestore shape already refuses a half-pair.
    source_operating_company_key       TEXT NOT NULL,
    destination_operating_company_key  TEXT NOT NULL,
    -- DERIVED, never written. 23 of 47 sandbox transfer orders are cross-company; a hand-maintained
    -- flag at that rate is a flag that will be wrong.
    is_cross_company                   BOOLEAN GENERATED ALWAYS AS
        (source_operating_company_key <> destination_operating_company_key) STORED,
    part_id                            TEXT NOT NULL,
    tracking_mode                      ops_tracking_mode NOT NULL,
    quantity                           INTEGER NOT NULL CHECK (quantity > 0),
    -- TYPED endpoint refs, total over all 47 records and over every endpoint type. The legacy
    -- from_warehouse_id / to_warehouse_id scalars are deliberately absent — see the header.
    origin_location_type               ops_location_type NOT NULL,
    origin_location_id                 TEXT NOT NULL,
    destination_location_type          ops_location_type NOT NULL,
    destination_location_id            TEXT NOT NULL,
    serial_numbers                     TEXT[] NOT NULL DEFAULT '{}',
    status                             ops_transfer_order_status NOT NULL,
    -- TO-YYYY-###### (transferOrderNumbering.ts). NULL on pre-allocator records; never backfilled.
    transfer_order_number              TEXT,
    idempotency_key                    TEXT        NOT NULL,
    created_by                         TEXT        NOT NULL,
    created_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                         TEXT        NOT NULL,
    updated_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A transfer between one place and itself moves nothing. The stored deserializer refuses it too.
    CONSTRAINT transfer_order_endpoints_differ CHECK (
        (origin_location_type, origin_location_id) <> (destination_location_type, destination_location_id)
    ),
    CONSTRAINT transfer_order_serials_match_tracking CHECK (
        (tracking_mode = 'SERIAL'
            AND cardinality(serial_numbers) = quantity
            AND array_position(serial_numbers, NULL) IS NULL)
        OR (tracking_mode = 'NONE' AND cardinality(serial_numbers) = 0)
    ),
    CONSTRAINT transfer_order_number_format CHECK (
        transfer_order_number IS NULL OR transfer_order_number ~ '^TO-[0-9]{4}-[0-9]{6,}$'
    )
);

CREATE UNIQUE INDEX transfer_orders_idempotency ON transfer_orders (tenant_id, idempotency_key);
CREATE INDEX transfer_orders_by_origin      ON transfer_orders (tenant_id, origin_location_type, origin_location_id);
CREATE INDEX transfer_orders_by_destination ON transfer_orders (tenant_id, destination_location_type, destination_location_id);
-- Cross-company transfers are the reconciliation population that needs finding by itself.
CREATE INDEX transfer_orders_cross_company  ON transfer_orders (tenant_id, is_cross_company);

-- Down Migration
SET search_path = eos_ops, public;

-- Dropped child-first so no FOREIGN KEY has to be dropped by hand.
DROP TABLE IF EXISTS receiving_order_lines;
DROP TABLE IF EXISTS receiving_orders;
DROP TABLE IF EXISTS transfer_orders;
DROP TABLE IF EXISTS purchase_order_voids;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS reorder_requests;

DROP TYPE IF EXISTS ops_transfer_order_status;
DROP TYPE IF EXISTS ops_receiving_source_kind;
DROP TYPE IF EXISTS ops_receiving_order_status;
DROP TYPE IF EXISTS ops_reorder_request_status;
