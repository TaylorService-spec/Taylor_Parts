-- Up Migration
-- MIGRATION 026 -- CRM Account business facts and create idempotency receipts (wave D1-A corrections).
--
-- ════════════════════ WHAT MOVES, AND WHY THESE ════════════════════
--
-- Every column and table below is a CURRENT canonical Account business fact: written by the Account form's save
-- payload (field-ops-app-vite/src/modules/accounts/AccountForm.jsx onSubmit), read back by the Account record
-- (AccountDetail.jsx / metadata/definitions/account.js), and declared by the entity definition. Nothing here is a copy
-- of the legacy document: no JSON column, no Firestore field names, no display snapshots.
--
--   billing address       four scalar parts, written and cleared together (the form sends {street,city,state,zip}|null).
--                         Same spelling as eos_crm.account_locations' address parts.
--   notes                 free text.
--   external identifiers  customer_number / erp_id / accounting_id / legacy_id: typed, OPAQUE, NOT unique -- ruling
--                         D-C1-4 (docs/architecture/customer-domain-foundation.md section 8) makes the id the only
--                         hard-unique key; a unique index would reject data the product accepts.
--   commercial profile    default_currency (ISO 4217 alphabetic), purchase_order_required, invoice_delivery_method.
--   governed fields       payment_terms, tax_status -- written under the DISTINCT capability
--                         customer.governedField.write (firestore.rules accountGovernedFields*). NULL tax_status means
--                         UNKNOWN (domain/commercialProfile.js resolveTaxStatus), never TAXABLE.
--   billing contact       billing_contact_id: a Contact of THIS Account (commercialProfile.js isContactOnAccount),
--                         enforced by a composite foreign key rather than a convention.
--   tags                  multi-valued, ordered free-form labels -> account_tags.
--   relationship types    multi-valued enum set (CUSTOMER, VENDOR) -> account_relationship_types.
--   lines of business     multi-valued set -> account_lines_of_business. The KEY is opaque here (shape only): naming
--                         specific operating companies in executable SQL is refused repository-wide
--                         (eosOpsOperatingCompanyCustody.test.mjs), so the valid set is the authority layer's
--                         (src/eosCrm/accountVocabulary.ts), exactly as operating_company_key is.
--
-- ════════════════════ OWNER STAYS NULLABLE IN THE SCHEMA ════════════════════
--
-- The governed CRM authority refuses to CREATE an Account without an explicit, same-tenant Employee owner. The column
-- is NOT made NOT NULL and no CHECK is added, because OWNERLESS is a legitimate stored state elsewhere in the repository:
-- ownershipMatrix.ts's Account `unresolvedPolicy` ("remains OWNERLESS until an owner is explicitly assigned"), the
-- migration source's OWNERLESS finding (crm/customerMigrationSource.ts) that carries legacy rows across unfilled, the
-- R-7 control accounts, and the governed Commercial refusal of inherited creation under an ownerless Account (which its
-- PostgreSQL proofs exercise). A constraint would force exactly the inference ruling D-6 forbids on legacy rows.
--
-- ════════════════════ command_receipts ════════════════════
--
-- CRM create idempotency, narrow and CRM-owned (eos_commercial.command_receipts is Commercial's). One receipt per
-- (tenant, principal, operation, SHA-256 of the key), written in the SAME transaction as the create. The raw key is
-- never stored. `request_hash` is the SHA-256 of the canonical create input, so a reused key with a different request
-- refuses deterministically instead of replaying an unrelated result. Not audit infrastructure.
--
-- STANDARD POSTGRESQL ONLY. Independent of migrations 023 and 025.

SET search_path = eos_crm, public;

-- A Contact is addressable together with its Account, so an Account can point at ITS OWN Contact and no other.
ALTER TABLE contacts ADD CONSTRAINT contacts_account_scoped_identity UNIQUE (tenant_id, account_id, id);

ALTER TABLE accounts
    ADD COLUMN notes                    TEXT,
    ADD COLUMN billing_address_street   TEXT,
    ADD COLUMN billing_address_city     TEXT,
    ADD COLUMN billing_address_state    TEXT,
    ADD COLUMN billing_address_postal_code TEXT,
    ADD COLUMN customer_number          TEXT,
    ADD COLUMN erp_id                   TEXT,
    ADD COLUMN accounting_id            TEXT,
    ADD COLUMN legacy_id                TEXT,
    ADD COLUMN default_currency         TEXT,
    ADD COLUMN purchase_order_required  BOOLEAN,
    ADD COLUMN invoice_delivery_method  TEXT,
    ADD COLUMN payment_terms            TEXT,
    ADD COLUMN tax_status               TEXT,
    ADD COLUMN billing_contact_id       TEXT,
    ADD CONSTRAINT accounts_text_facts_not_blank CHECK (
        (notes IS NULL OR btrim(notes) <> '')
        AND (billing_address_street IS NULL OR btrim(billing_address_street) <> '')
        AND (billing_address_city IS NULL OR btrim(billing_address_city) <> '')
        AND (billing_address_state IS NULL OR btrim(billing_address_state) <> '')
        AND (billing_address_postal_code IS NULL OR btrim(billing_address_postal_code) <> '')
        AND (customer_number IS NULL OR btrim(customer_number) <> '')
        AND (erp_id IS NULL OR btrim(erp_id) <> '')
        AND (accounting_id IS NULL OR btrim(accounting_id) <> '')
        AND (legacy_id IS NULL OR btrim(legacy_id) <> '')),
    ADD CONSTRAINT accounts_default_currency_shape CHECK (default_currency IS NULL OR default_currency ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT accounts_invoice_delivery_method_vocabulary
        CHECK (invoice_delivery_method IS NULL OR invoice_delivery_method IN ('EMAIL', 'PORTAL', 'MAIL', 'EDI')),
    ADD CONSTRAINT accounts_payment_terms_vocabulary
        CHECK (payment_terms IS NULL OR payment_terms IN ('COD', 'NET_30', 'NET_60', 'NET_90')),
    ADD CONSTRAINT accounts_tax_status_vocabulary
        CHECK (tax_status IS NULL OR tax_status IN ('UNKNOWN', 'TAXABLE', 'EXEMPT', 'RESELLER')),
    ADD CONSTRAINT accounts_billing_contact_on_account
        FOREIGN KEY (tenant_id, id, billing_contact_id) REFERENCES contacts (tenant_id, account_id, id);

CREATE TABLE account_tags (
    tenant_id  TEXT     NOT NULL,
    account_id TEXT     NOT NULL,
    position   SMALLINT NOT NULL CHECK (position >= 0),
    tag        TEXT     NOT NULL CHECK (btrim(tag) <> '' AND tag = btrim(tag) AND char_length(tag) <= 200),
    CONSTRAINT account_tags_pkey PRIMARY KEY (tenant_id, account_id, position),
    CONSTRAINT account_tags_unique_per_account UNIQUE (tenant_id, account_id, tag),
    CONSTRAINT account_tags_account_same_tenant FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id)
);

CREATE TABLE account_relationship_types (
    tenant_id         TEXT NOT NULL,
    account_id        TEXT NOT NULL,
    relationship_type TEXT NOT NULL CHECK (relationship_type IN ('CUSTOMER', 'VENDOR')),
    CONSTRAINT account_relationship_types_pkey PRIMARY KEY (tenant_id, account_id, relationship_type),
    CONSTRAINT account_relationship_types_account_same_tenant FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id)
);

CREATE TABLE account_lines_of_business (
    tenant_id        TEXT NOT NULL,
    account_id       TEXT NOT NULL,
    line_of_business TEXT NOT NULL CHECK (line_of_business ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    CONSTRAINT account_lines_of_business_pkey PRIMARY KEY (tenant_id, account_id, line_of_business),
    CONSTRAINT account_lines_of_business_account_same_tenant FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id)
);

CREATE TABLE command_receipts (
    id                   TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL,
    principal_id         TEXT NOT NULL,
    operation            TEXT NOT NULL CHECK (operation IN ('crm.createAccount', 'crm.createContact', 'crm.createAccountLocation')),
    idempotency_key_hash TEXT NOT NULL CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
    request_hash         TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    target_type          TEXT NOT NULL CHECK (target_type IN ('ACCOUNT', 'CONTACT', 'ACCOUNT_LOCATION')),
    target_id            TEXT NOT NULL CHECK (target_id <> '' AND btrim(target_id) = target_id),
    result               JSONB NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT command_receipts_one_per_key UNIQUE (tenant_id, principal_id, operation, idempotency_key_hash),
    CONSTRAINT command_receipts_member_fk FOREIGN KEY (tenant_id, principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id)
);

-- Down Migration
SET search_path = eos_crm, public;

-- REFUSE WHILE ANY GOVERNED FACT THIS MIGRATION ADDS IS RECORDED. Dropping it would destroy Account business data or
-- the only record that a create already happened (a later retry would then duplicate the record).
DO $$
DECLARE
    recorded BIGINT;
BEGIN
    SELECT (SELECT count(*) FROM command_receipts) + (SELECT count(*) FROM account_tags)
         + (SELECT count(*) FROM account_relationship_types) + (SELECT count(*) FROM account_lines_of_business)
         + (SELECT count(*) FROM accounts WHERE notes IS NOT NULL OR billing_address_street IS NOT NULL
              OR billing_address_city IS NOT NULL OR billing_address_state IS NOT NULL OR billing_address_postal_code IS NOT NULL
              OR customer_number IS NOT NULL OR erp_id IS NOT NULL OR accounting_id IS NOT NULL OR legacy_id IS NOT NULL
              OR default_currency IS NOT NULL OR purchase_order_required IS NOT NULL OR invoice_delivery_method IS NOT NULL
              OR payment_terms IS NOT NULL OR tax_status IS NOT NULL OR billing_contact_id IS NOT NULL)
      INTO recorded;
    IF recorded > 0 THEN
        RAISE EXCEPTION 'migration 026 refuses to drop CRM Account business facts: % rows carry them', recorded
            USING HINT = 'Reversing this migration destroys Account business data or create receipts. Export it deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP TABLE IF EXISTS command_receipts;
DROP TABLE IF EXISTS account_lines_of_business;
DROP TABLE IF EXISTS account_relationship_types;
DROP TABLE IF EXISTS account_tags;

ALTER TABLE accounts
    DROP CONSTRAINT IF EXISTS accounts_billing_contact_on_account,
    DROP CONSTRAINT IF EXISTS accounts_tax_status_vocabulary,
    DROP CONSTRAINT IF EXISTS accounts_payment_terms_vocabulary,
    DROP CONSTRAINT IF EXISTS accounts_invoice_delivery_method_vocabulary,
    DROP CONSTRAINT IF EXISTS accounts_default_currency_shape,
    DROP CONSTRAINT IF EXISTS accounts_text_facts_not_blank,
    DROP COLUMN IF EXISTS billing_contact_id, DROP COLUMN IF EXISTS tax_status, DROP COLUMN IF EXISTS payment_terms,
    DROP COLUMN IF EXISTS invoice_delivery_method, DROP COLUMN IF EXISTS purchase_order_required,
    DROP COLUMN IF EXISTS default_currency, DROP COLUMN IF EXISTS legacy_id, DROP COLUMN IF EXISTS accounting_id,
    DROP COLUMN IF EXISTS erp_id, DROP COLUMN IF EXISTS customer_number, DROP COLUMN IF EXISTS billing_address_postal_code,
    DROP COLUMN IF EXISTS billing_address_state, DROP COLUMN IF EXISTS billing_address_city,
    DROP COLUMN IF EXISTS billing_address_street, DROP COLUMN IF EXISTS notes;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_account_scoped_identity;
