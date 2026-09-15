-- Up Migration
-- CATALOG PART IDENTITY -- the PostgreSQL reference authority Commercial product lines validate against.
--
-- ============================================================================
-- MIGRATION 026. Lane D of the PostgreSQL authority wave. Depends on 001 (eos_policy.tenants) and 008
-- (eos_ops.equipment_models) only -- NOT on 023, 024 or 025.
--
-- The C2 Commercial command layer validates every PART / EQUIPMENT_MODEL line through the port
-- `CommercialCatalogAuthority.verifyReferences` (functions/src/eosCommercial/commands/commercialCommandKernel.ts)
-- and refuses CATALOG_AUTHORITY_UNAVAILABLE because no PostgreSQL authority answers it. Of the two kinds:
--
--   EQUIPMENT_MODEL  already has its canonical PostgreSQL identity: eos_ops.equipment_models, primary key
--                    (tenant_id, id), id = the canonical `{manufacturerId}--{modelNumber}` equipmentModelId
--                    (migration 008). Nothing is added for it here.
--   PART             has NO PostgreSQL identity at all. Migration 006 carries `part_id` as an unjoined
--                    governed key "because Part remains Firestore-authoritative in this tranche". This
--                    migration adds the canonical Part IDENTITY row, and nothing else.
--
-- ════════════════════ WHAT A PART REFERENCE IS (repository truth, not invented) ════════════════════
--
-- The only existing product-reference check (functions/src/salesAgreement/salesAgreementLineReferences.ts)
-- resolves a PART line's `ref` as the document id of Firestore `parts/{partId}` -- the Part Master record's own
-- `Part.partId` (partMasterRepository.ts: "Document identity IS domain identity"), which Decision #44 proved
-- equal to the operational SKU. The eos_ops part-id contract (eosOps/migration/partIdContract.ts, P1B ruling R1)
-- names the same identity and the same format rule, `parsePartId`'s /^[A-Za-z0-9_-]{1,64}$/, which migration
-- 006 already restates as a CHECK on `supplier_catalog_items.part_id`. This table's `id` is exactly that value:
-- no alias, no SKU substitute, no manufacturer number, no normalization.
--
-- ════════════════════ WHAT IS DELIBERATELY NOT HERE ════════════════════
--
--   * NO LIFECYCLE / STATUS COLUMN. The current reference check establishes existence and KIND only, and says
--     why: no sellability rule exists anywhere in the repository, and refusing a DISCONTINUED part would
--     "author commercial policy in a validation helper". Part Master has no physical delete ("lifecycle status
--     only"), so an identity, once minted, is durable. A status column no reader consults would be a speculative
--     second statement of Part Master's lifecycle; it arrives with the Part Master descriptive move, additively.
--   * NO DESCRIPTIVE FIELDS (name, internal part number, units, control type, ...). Those are Part Master
--     business authority and move with its writer, not with a reference check.
--   * NO FOREIGN KEYS FROM EXISTING part_id COLUMNS (cycle counts, movements, supplier catalog, purchasing).
--     Those columns hold ids for rows this table does not yet contain; constraining them is the job of the
--     catalog cutover that populates it, not of a reference check.
--   * NO CROSS-KIND UNIQUENESS. Firestore keeps `parts` and `equipment_models` as two collections; nothing in
--     the repository forbids one string from being both a partId and an equipmentModelId. The reference
--     authority answers a reference against its OWN kind first (FOUND), and only then reports the other kind
--     (WRONG_KIND) -- deterministic without inventing a shared namespace rule.
--   * NO DATA, NO WRITER, NO SYNC. Nothing copies Firestore `parts` here and nothing keeps the two in step: this
--     is the governed TARGET, empty in every environment, populated only by an explicit catalog cutover
--     (copy once -> verify -> reconcile -> cut over the Part Master writer). Until then a composed PostgreSQL
--     catalog authority answers NOT_FOUND -- fail-closed, never a false FOUND.
--
-- STANDARD POSTGRESQL ONLY. Additive: no existing migration, table, column or constraint is changed.
-- ============================================================================

SET search_path = eos_ops, public;

CREATE TABLE parts (
    -- The canonical Part.partId, carried verbatim. Unique WITHIN a tenant's catalog -- the same composite
    -- identity equipment_models uses, so two tenants may each catalogue the same SKU.
    id          TEXT NOT NULL,
    tenant_id   TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- Provenance: a writer that cannot name an actor is refused rather than recorded as nobody (migration 008).
    created_by  TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT parts_pkey PRIMARY KEY (tenant_id, id),
    -- parsePartId's format, exactly. Already canonical: never trimmed, case-folded or rewritten into one.
    CONSTRAINT part_id_canonical_shape CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
    CONSTRAINT part_created_by_present CHECK (created_by <> '')
);

-- Down Migration
SET search_path = eos_ops, public;

-- Reversing this would delete Part identities that exist nowhere else in this schema. Refuse, as 008 does.
DO $$
DECLARE
    occupied BIGINT;
BEGIN
    SELECT count(*) INTO occupied FROM eos_ops.parts;
    IF occupied > 0 THEN
        RAISE EXCEPTION 'migration 026 cannot be reversed: eos_ops.parts holds % Part identities', occupied
            USING HINT = 'A schema rollback will not delete catalog identities. Resolve these records first.';
    END IF;
END
$$;

DROP TABLE parts;
