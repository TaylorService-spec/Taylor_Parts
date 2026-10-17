-- Up Migration
-- CRM ACTIVITY / NOTES ON EOS CORE (Firebase exit F7b; Controller decision under the Owner's preserve-functionality-and-access
-- rule, 2026-10-17; DECISIONS #243).
--
-- The Firestore `crm_activities` record, re-homed beside the Account it belongs to. Behaviour kept
-- (functions/src/eosCrm/crmActivityAuthority.ts): the five governed types, a required Account, optional Contact / Opportunity
-- / Sales Order references by id only, a non-blank body of at most 4000 characters, occurred_at (the interaction) distinct
-- from created_at (the recording), and one idempotency key per actor = one activity.
--
-- AUTHORITY, mirrored -- NO NEW HOLDER. crm.activity.read and crm.activity.create are registered here and granted to exactly
-- the Roles the Firebase catalog grants them today: admin (Owner ruling 2026-08-19), owner (OWNER_COMMERCIAL_AUTHORITY) and
-- crmActivityContributor. GRANT-BEARING (Owner ruling E): roleCapabilityAuthorityBaseline.json carries the six pairs in the
-- same change.
--
-- EXISTING FIRESTORE ACTIVITIES are NOT moved by this migration. provenance = MIGRATED is reserved for the Owner-gated copy
-- (functions/scripts/crmActivityCopy.js); a MIGRATED row carries no created_by and no idempotency key (a Firebase uid is
-- never a column).

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_crm_activity_read', 'crm.activity.read',
     'Read an Account''s CRM activity / notes timeline. Also requires reading the Account itself (customer.record.read).',
     'crmActivity', 'read', 'READ', 'Read CRM Activity'),
    ('cap_crm_activity_create', 'crm.activity.create',
     'Record a CRM activity / note (call, meeting, sales note, relationship touch) on an Account. Confers no Account write.',
     'crmActivity', 'create', 'CREATE', 'Record CRM Activity')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_243_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764590000000', now(), 'migration:1764590000000', now(), 'migration:1764590000000', now()
  FROM capabilities c
  JOIN roles r ON r.key IN ('admin', 'owner', 'crmActivityContributor') AND (r.key <> 'owner' OR r.protected = TRUE)
 WHERE c.key IN ('crm.activity.read', 'crm.activity.create')
   AND NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

SET search_path = eos_crm, public;

CREATE TABLE activities (
    tenant_id        TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    id               TEXT        NOT NULL,
    account_id       TEXT        NOT NULL,
    -- References BY ID ONLY, as the Firestore record held them: names, stages and totals resolve from their own authority.
    contact_id       TEXT,
    opportunity_id   TEXT,
    sales_order_id   TEXT,
    type             TEXT        NOT NULL,
    body             TEXT        NOT NULL,
    occurred_at      TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The EOS Principal who recorded it; NULL only on a MIGRATED row.
    created_by       TEXT,
    idempotency_key  TEXT,
    provenance       TEXT        NOT NULL,
    CONSTRAINT activities_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT activities_account FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id),
    CONSTRAINT activities_type_known CHECK (type IN ('SALES_NOTE', 'CALL', 'MEETING', 'RELATIONSHIP', 'GENERAL')),
    CONSTRAINT activities_body_stated CHECK (btrim(body) <> '' AND length(body) <= 4000),
    CONSTRAINT activities_references_stated CHECK ((contact_id IS NULL OR btrim(contact_id) <> '')
        AND (opportunity_id IS NULL OR btrim(opportunity_id) <> '') AND (sales_order_id IS NULL OR btrim(sales_order_id) <> '')),
    CONSTRAINT activities_provenance_known CHECK (provenance IN ('NATIVE', 'MIGRATED')),
    CONSTRAINT activities_native_actor CHECK (provenance = 'MIGRATED'
        OR (created_by IS NOT NULL AND btrim(created_by) <> '' AND idempotency_key IS NOT NULL AND btrim(idempotency_key) <> ''
            AND length(idempotency_key) <= 200))
);

CREATE UNIQUE INDEX activities_one_key_one_activity ON activities (tenant_id, created_by, idempotency_key) WHERE provenance = 'NATIVE';
CREATE INDEX activities_by_account ON activities (tenant_id, account_id, occurred_at DESC);

-- Down Migration
DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_crm.activities;
    IF v_n > 0 THEN RAISE EXCEPTION 'CRM_ACTIVITY: refuses to reverse -- % activity record(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key IN ('crm.activity.read', 'crm.activity.create');
    IF v_n > 0 THEN RAISE EXCEPTION 'CRM_ACTIVITY: refuses to reverse -- % Administration decision(s) name a CRM activity capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key IN ('crm.activity.read', 'crm.activity.create');
    IF v_n > 0 THEN RAISE EXCEPTION 'CRM_ACTIVITY: refuses to reverse -- % direct grant(s) hold a CRM activity capability', v_n; END IF;
END
$$;

DROP TABLE eos_crm.activities;

SET search_path = eos_policy, public;
DELETE FROM role_capabilities rc USING capabilities c WHERE c.id = rc.capability_id AND c.key IN ('crm.activity.read', 'crm.activity.create');
DELETE FROM capabilities WHERE key IN ('crm.activity.read', 'crm.activity.create');
