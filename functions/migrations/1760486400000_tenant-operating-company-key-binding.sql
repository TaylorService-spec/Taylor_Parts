-- Up Migration
-- THE OPERATING COMPANY -> eos_ops KEY BINDING -- Owner ruling, Reorder Domain Cutover.
--
-- ============================================================================
-- MIGRATION 038. A governed, narrow binding from a tenant's AUTHORIZED OPERATING COMPANY to the
-- OPAQUE PARTITION KEY its eos_ops rows carry. Nothing is unified and nothing is renamed.
-- ============================================================================
--
-- ════════════════════ TWO CONCEPTS, AND THE MISSING EDGE BETWEEN THEM ════════════════════
--
--   eos_policy.tenant_operating_companies.operating_company_id
--       WHICH COMPANIES THIS TENANT MAY OPERATE AS. A closed governed vocabulary --
--       ownership/operatingCompanyAuthority.ts declares exactly `taylor` and `ventana` -- established
--       by an operator through the reconciliation CLI, never inferred.
--
--   eos_ops.*.operating_company_key
--       WHICH PARTITION AN OPERATIONAL ROW BELONGS TO. Migration 007 states it is opaque here
--       because "Warehouse authority is not owned by this schema".
--
-- They were never the same thing, and the sample company proves it deliberately rather than by
-- accident: its manifest sets operatingCompanyId `taylor` and operatingCompanyKey
-- `sample-co-synthetic`, so that "eos_ops rows this seed writes are confined to a company nothing
-- else in nonprod uses". A migration that copied one into the other would be asserting an equality
-- the repository explicitly denies.
--
-- What was missing was the EDGE: a governed statement that, for this tenant, company X operates
-- under key Y. Without it a legacy `operatingCompanyId` cannot be turned into a key at all, and the
-- only way to proceed would have been to assume they are equal.
--
-- ════════════════════ THE SHAPE FOLLOWS ITS SIBLING ════════════════════
--
-- Same columns, same idioms and same refusal-to-destroy posture as
-- tenant_operating_companies (migration 1759968000000): status as TEXT with a CHECK rather than a
-- new enum, an explicit source, and both actors recorded. A second vocabulary for the same idea is
-- how two readers reach different conclusions.
--
-- ONE KEY PER COMPANY, ONE COMPANY PER KEY, PER TENANT. Both directions are unique: a company
-- operating under two keys would make "which partition is this company's" unanswerable, and two
-- companies sharing a key would make an eos_ops row's owner unanswerable. The migration needs both
-- questions to have exactly one answer.

SET search_path = eos_policy, public;

CREATE TABLE tenant_operating_company_keys (
    tenant_id             TEXT        NOT NULL,
    operating_company_id  TEXT        NOT NULL,
    operating_company_key TEXT        NOT NULL,
    status                TEXT        NOT NULL,
    -- NATIVE: authored by an operator for a live company. MIGRATED: established to let a legacy
    -- population be copied. Same two words eos_ops provenance enums use.
    provenance            TEXT        NOT NULL,
    source                TEXT        NOT NULL,
    established_by        TEXT        NOT NULL,
    established_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT        NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, operating_company_id),
    -- The company must already be one this tenant is AUTHORIZED to operate as. A binding cannot
    -- introduce a company; it can only say how an authorized one is keyed.
    CONSTRAINT tenant_operating_company_key_company_fk
        FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT tenant_operating_company_key_unique UNIQUE (tenant_id, operating_company_key),
    -- The eos_ops key shape: an opaque, safe segment. Deliberately NOT the governed company-id
    -- shape, because it is not a company id.
    CONSTRAINT tenant_operating_company_key_shape
        CHECK (operating_company_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
    CONSTRAINT tenant_operating_company_key_status_known CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT tenant_operating_company_key_provenance_known CHECK (provenance IN ('NATIVE', 'MIGRATED')),
    CONSTRAINT tenant_operating_company_key_source_present CHECK (btrim(source) <> ''),
    CONSTRAINT tenant_operating_company_key_actor_present
        CHECK (btrim(established_by) <> '' AND btrim(updated_by) <> '')
);

CREATE INDEX tenant_operating_company_keys_by_key
    ON tenant_operating_company_keys (tenant_id, operating_company_key);

-- Down Migration
-- REFUSE, NEVER DESTROY: a binding is what makes an eos_ops row's owner knowable, and the same
-- posture tenant_operating_companies takes for the same reason.
DO $$
DECLARE
    bound BIGINT;
BEGIN
    SELECT count(*) INTO bound FROM eos_policy.tenant_operating_company_keys;
    IF bound > 0 THEN
        RAISE EXCEPTION 'refusing to drop tenant_operating_company_keys: % binding(s) exist, and dropping them would make every eos_ops row''s operating company unattributable', bound;
    END IF;
END $$;

DROP TABLE IF EXISTS eos_policy.tenant_operating_company_keys;
