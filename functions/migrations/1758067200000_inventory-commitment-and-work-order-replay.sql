-- Up Migration
-- EOS Operational Data Plane — inventory COMMITMENT persistence, and the Work Order inventory-effect
-- REPLAY authority.
--
-- ============================================================================
-- MIGRATION 008. Closes the two census blockers that have no target table in any migration:
--
--   NB-2  docs/architecture/inventory-reference-authority-p1b-census.md:960 — the live ledger's
--         RESERVED / RELEASED / CONSUMED rows "have no value in `ops_movement_type`", and
--         "**No `eos_ops` reservation table exists in any migration.**"
--   NB-7  same file:960 / :1019 — "`inventory_sync_status` (16 docs, 5 carrying recorded failures)
--         is the idempotency guard for work-order inventory effects and has no target table in any
--         migration. Dropping it re-opens processed work orders to replay."
--
-- Both are classified **POSTGRES_AUTHORITY_REQUIRED_BEFORE_INVENTORY_CUTOVER** (:1019, :1042). This
-- migration gives each one a home. It imports nothing, cuts nothing over, and is read and written by
-- no deployed process — exactly the posture migrations 005 and 007 established.
--
-- STANDARD POSTGRESQL ONLY, same as 001-007. Additive: no existing migration is edited.
-- ============================================================================
--
-- ════════════════════ WHY COMMITMENT IS NOT A MOVEMENT, STRUCTURALLY ════════════════════
--
-- RESERVED / RELEASED / CONSUMED are COMMITMENT LIFECYCLE FACTS, not physical inventory movements,
-- and this migration makes that a property of the schema rather than a convention writers must
-- remember.
--
--   * They are NOT added to `ops_movement_type`, and must never be. That enum is the vocabulary of
--     `inventory_movements`, which migration 005 calls "THE SOLE QUANTITY-MUTATING RECORD in
--     eos_ops" (:87-89). A reservation moves no stock: it is a claim ON stock that has not moved.
--     Adding the three labels there would make every balance sum over the movement ledger silently
--     include promises alongside physical facts.
--   * They could not be stored there even if someone wanted to.
--     `functions/src/inventoryService.ts:186-192` (`writeLedgerEntry`) writes exactly
--     `{workOrderId, partId, type, quantity}` — no location, no tracking mode, no schema version.
--     `inventory_movements` requires NOT NULL `tracking_mode`, `location_type`, `location_id`,
--     `source_kind`, `source_id`, and `CHECK (quantity_delta <> 0)`. A commitment row satisfies none
--     of the location columns, and inventing values for them would manufacture a physical location
--     for a fact that has never had one.
--   * `functions/src/inventoryLedger/operationalMovementTypes.ts:45-48` already declares
--     `LEGACY_TRANSACTION_TYPES` "deliberately DISJOINT from the operational set, so `type` alone
--     distinguishes the two ledger families". Two tables with two disjoint enums is that same rule,
--     expressed where it cannot be forgotten.
--
-- So: a SEPARATE enum (`ops_commitment_event_type`), a SEPARATE table, no location columns at all.
--
-- ════════════════════ WHY QUANTITY IS UNSIGNED HERE AND SIGNED THERE ════════════════════
--
-- `inventory_movements.quantity_delta` is signed. `inventory_commitments.quantity` is strictly
-- POSITIVE, with the direction carried entirely by `event_type` — the same shape the live authority
-- writes (`inventoryService.ts` never writes a negative quantity; `openCommitment()` at :152-160
-- reads `type` to decide the sign).
--
-- This is deliberate, and it is a defence against census finding NB-1 (:952), which measured THREE
-- sign conventions inside one live source column and warned that "a naive `quantity →
-- quantity_delta` copy inverts 4 TRANSFER_OUT rows and 1 CONSUMED row — silent balance corruption
-- that satisfies every table constraint." A column that only ever holds positive numbers cannot be
-- corrupted by a sign convention it does not have; `CHECK (quantity > 0)` makes an accidental signed
-- copy fail loudly at the INSERT rather than quietly at the sum.
--
-- ════════════════════ WHY THE OPERATING COMPANY IS MANDATORY ON A COMMITMENT ════════════════════
--
-- Migration 007's rule is that every eos_ops record asserting WHERE stock is, or WHOSE custody it
-- sits in, must say which operating company's inventory authority it belongs to. A commitment
-- asserts neither — but it is netted DIRECTLY against records that do.
--
-- The committed-quantity derivation exists to be subtracted from physical on-hand, and physical
-- on-hand is a sum over `inventory_movements`, every row of which carries a NOT NULL
-- `operating_company_key` (007:126). A commitment without one could only be netted against ALL
-- companies' stock at once — promising Taylor's shelf to a Ventana Work Order, or hiding a claim
-- from the company that actually holds the part. The column is therefore NOT NULL with NO DEFAULT,
-- on the same terms as 007: the governed command states the key or the INSERT fails.
--
-- It is never inferred. Not from a Warehouse, a Truck, an Employee, or a `homeWarehouseId` —
-- `functions/src/eosOps/operatingCompanyCustody.ts:17-19` already states that rule, and
-- `requireOperatingCompanyKey` is the refusal that enforces it above the SQL boundary.
--
-- This is also why no data moves here. The live Work Order commitment carries no operating company
-- at all (docs/assessments/inventory-commitment-reservation-authority.md, §2.1 "Company scope:
-- **None.**"), so any import would have to invent one. There is no import in this packet.
--
-- ════════════════════ WHY THERE IS NO `location` ON A COMMITMENT, EITHER ════════════════════
--
-- The same assessment measures the live reservation as having no location scope: "Summed across ALL
-- locations, warehouse and mobile alike." Adding location columns here would assert a warehouse
-- choice that neither demand family makes, and the assessment records (under DECISIONS #165) that
-- requiring one "would fail every dispatch closed; inventing either is forbidden". A commitment is
-- a claim against a Part's pool, and this schema says exactly that and no more.
--
-- ════════════════════ WHY THE REPLAY AUTHORITY IS ONE ROW PER (WORK ORDER, STATE) ════════════════════
--
-- Firestore models this as ONE document per Work Order carrying three maps —
-- `processedStates`, `claims` and `failures`, keyed by state (`functions/src/types/
-- inventoryTransaction.ts`'s `InventorySyncStatus`). That shape exists because Firestore has no
-- composite key and merging map fields is how sibling states avoid clobbering each other.
--
-- In SQL the state IS part of the identity, so it becomes part of the PRIMARY KEY, and the three
-- maps collapse into one `status` column that can hold only one value at a time. That removes a
-- whole class of representable-but-impossible state the document shape allows: a Firestore doc can
-- say `processedStates.DISPATCHED = true` AND `claims.DISPATCHED = true` simultaneously; this table
-- cannot.
--
-- THE PRIMARY KEY IS THE COMPOSITE, not a surrogate id. Every other table in this schema uses
-- `id TEXT PRIMARY KEY`, and this one deliberately does not: the entire purpose of the table is that
-- (tenant, work order, state) may exist AT MOST ONCE. A surrogate key with a UNIQUE constraint
-- beside it would express the same thing less directly, and would invite a writer to treat the
-- surrogate as the identity it is not.
--
-- ════════════════════ THE CLAIM IS AN `INSERT ... ON CONFLICT`, NOT A READ-THEN-WRITE ════════════
--
-- `inventoryService.ts:465-476` (`claimStateForProcessing`) closes the check-then-act gap with a
-- Firestore transaction: read the doc, refuse if processed or already claimed, otherwise write the
-- claim. Postgres gives the same guarantee in one statement — `INSERT ... ON CONFLICT
-- (tenant_id, work_order_id, state) DO UPDATE ... WHERE status = 'FAILED' RETURNING` — which claims
-- iff the row is absent or FAILED, and returns nothing otherwise. The uniqueness of the primary key
-- is the serialization; there is no window to lose a race in.
--
-- THE STUCK-CLAIM BEHAVIOUR IS PRESERVED, NOT FIXED. A process that dies mid-trigger leaves a
-- CLAIMED row that nothing will clear, and a later retry cannot claim it — exactly as a Firestore
-- `claims[state]` survives a crash between `claimStateForProcessing()` and `clearClaim()` today. A
-- lease/expiry would be a new behaviour, not a migration of the existing one, and inventing one here
-- would change the failure model this table exists to carry across.
--
-- ════════════════════ WHY THIS TABLE HAS NO UPDATE PATH, AND THAT ONE DOES ════════════════════
--
-- `inventory_commitments` is immutable evidence, like `inventory_movements`: a release is a NEW row,
-- never an edit to the reservation it releases. Enforced at the repository layer (it offers no
-- update or delete method) and proved by a static test, matching migration 005's stated convention
-- (:53-59).
--
-- `work_order_inventory_effects` is explicitly NOT evidence — it is current processing state, and it
-- is supposed to change: claimed -> processed, or claimed -> failed -> re-claimed. It is the one
-- mutable table in this migration and says so.

SET search_path = eos_ops, public;

-- ============================ vocabulary ============================

-- THE COMMITMENT LIFECYCLE. Deliberately disjoint from `ops_movement_type` — see the header. These
-- three labels must never be added to that enum, and no row of `inventory_movements` may ever carry
-- one; `test/eosOpsInventoryCommitmentPostgres.test.mjs` proves both directions of that disjointness.
CREATE TYPE ops_commitment_event_type AS ENUM ('RESERVED', 'RELEASED', 'CONSUMED');

-- The Work Order states that HAVE an inventory effect, and only those. Exactly the three keys of
-- `STATE_TRIGGERS` (`functions/src/inventoryService.ts:432-440`): DISPATCHED reserves, COMPLETED
-- consumes, CANCELLED releases. ARRIVED and WORK_IN_PROGRESS are deliberately absent — that file's
-- own comment (:423-431) says they "never appear in inventory_sync_status at all, rather than
-- appearing as a no-op 'processed' entry", and an enum is how that stays true of a SQL writer too.
CREATE TYPE ops_work_order_effect_state AS ENUM ('DISPATCHED', 'COMPLETED', 'CANCELLED');

-- CLAIMED  a trigger is in flight for this (work order, state)
-- PROCESSED the effect was applied; it must never run again
-- FAILED   the attempt failed and the claim was released; a retry may claim it again
CREATE TYPE ops_work_order_effect_status AS ENUM ('CLAIMED', 'PROCESSED', 'FAILED');

-- ============================ the commitment ledger ============================
--
-- Append-only. One row per commitment EVENT, never a mutable "currently reserved" total — the same
-- reason migration 005 refused a balance table (:22-30): a second maintained number is a second
-- thing to disagree with the evidence. Committed quantity is a SUM over these rows, computed by a
-- query (see inventoryCommitmentRepository.ts).

CREATE TABLE inventory_commitments (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- MANDATORY, never defaulted, never inferred. See the header for why a commitment needs it even
    -- though it names no location.
    operating_company_key TEXT NOT NULL,
    -- The demand that raised this claim. `work_order_id` rather than a polymorphic
    -- (source_kind, source_id) pair because the Work Order transition path is the ONLY commitment
    -- writer that exists: docs/assessments/inventory-commitment-reservation-authority.md §2.1 proves
    -- `inventoryService.ts` is "the SOLE writer of `type: \"RESERVED\"` in the entire repository
    -- (proven by exhaustion over `functions/src`)", and §2.2 records that the Sales Order path
    -- writes NO ledger event at all. DECISIONS #165 blocks Sales Order commitments from becoming
    -- ledger events until the consumption/on-hand gap is ruled. Modelling a second source before a
    -- second source exists would be a shape chosen from imagination; widening this to a source pair
    -- when that ruling lands is an additive migration.
    work_order_id         TEXT NOT NULL,
    part_id               TEXT NOT NULL,
    event_type            ops_commitment_event_type NOT NULL,
    -- Strictly positive; the direction is `event_type`. See the header on NB-1.
    quantity              INTEGER NOT NULL,
    -- Every commitment write originates in a Work Order state transition that is RETRIED on failure
    -- (`triggerInventoryEffects` records `retryNeeded: true` and a later call re-attempts it), so
    -- replay is ALWAYS a concern here. Unlike `inventory_movements.idempotency_key`, which is
    -- nullable for movement kinds that have no replay concern, this column is NOT NULL: there is no
    -- commitment event that may be written without a replay identity.
    idempotency_key       TEXT NOT NULL,
    occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT commitment_quantity_positive CHECK (quantity > 0)
);

-- The committed-quantity derivation's access path: the pool is (company, part), tenant-scoped.
CREATE INDEX inventory_commitments_by_part
    ON inventory_commitments (tenant_id, operating_company_key, part_id);
-- The per-Work-Order outstanding derivation's access path (release and consumption both read it).
CREATE INDEX inventory_commitments_by_work_order
    ON inventory_commitments (tenant_id, work_order_id);
CREATE UNIQUE INDEX inventory_commitments_idempotency
    ON inventory_commitments (tenant_id, idempotency_key);

-- ============================ the Work Order replay authority ============================
--
-- NB-7's target. This is what stops an already-applied inventory effect from being applied a second
-- time, and it is the reason `inventory_sync_status` cannot simply be dropped at cutover.

CREATE TABLE work_order_inventory_effects (
    tenant_id       TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    work_order_id   TEXT NOT NULL,
    state           ops_work_order_effect_state NOT NULL,
    status          ops_work_order_effect_status NOT NULL,
    -- Who holds (or last held) the claim. Present on every row: a row only ever comes into existence
    -- by being claimed.
    claimed_by      TEXT        NOT NULL,
    claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    -- The recorded failure, preserved verbatim from the Firestore model's
    -- `failures[state] = { error, at, retryNeeded }`. `retry_needed` is not a column: in this shape
    -- it is precisely `status = 'FAILED'`, and a boolean beside the status would be a second place
    -- to state the same fact.
    failure_message TEXT,
    failed_at       TIMESTAMPTZ,
    -- How many times this (work order, state) has been claimed. Not present in the Firestore model,
    -- which cannot count them; it is free here because a claim is already an UPSERT, and the
    -- operator runbook's retry story (docs/operations/inventory-effect-recovery-runbook.md) is the
    -- reader it exists for.
    attempts        INTEGER     NOT NULL DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- (tenant, work order, state) at most once. This uniqueness IS the idempotency guarantee.
    PRIMARY KEY (tenant_id, work_order_id, state),

    CONSTRAINT wo_effect_processed_records_when CHECK (
        (status <> 'PROCESSED') OR (processed_at IS NOT NULL)
    ),
    CONSTRAINT wo_effect_failure_records_why CHECK (
        (status <> 'FAILED') OR (failure_message IS NOT NULL AND failed_at IS NOT NULL)
    ),
    -- Success clears the failure, exactly as `markStateProcessed()` deletes `failures[state]`
    -- (`inventoryService.ts:489-506`). A PROCESSED row carrying a live failure would tell a retry
    -- tool that something still needs attention when it does not.
    CONSTRAINT wo_effect_processed_has_no_open_failure CHECK (
        (status <> 'PROCESSED') OR (failure_message IS NULL AND failed_at IS NULL)
    ),
    CONSTRAINT wo_effect_attempts_positive CHECK (attempts >= 1)
);

-- The operator queries this table needs: "what still needs attention in this tenant".
CREATE INDEX work_order_inventory_effects_by_status
    ON work_order_inventory_effects (tenant_id, status);

-- Down Migration
SET search_path = eos_ops, public;

DROP TABLE IF EXISTS work_order_inventory_effects;
DROP TABLE IF EXISTS inventory_commitments;

DROP TYPE IF EXISTS ops_work_order_effect_status;
DROP TYPE IF EXISTS ops_work_order_effect_state;
DROP TYPE IF EXISTS ops_commitment_event_type;
