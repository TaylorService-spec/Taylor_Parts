-- Up Migration
-- EOS Customer Data Plane — the `eos_crm` schema: Account, Contact, and the CRM customer-site
-- Location, as PostgreSQL authority.
--
-- ============================================================================
-- MIGRATION 008. The customer master data the operational plane already points at, given a
-- PostgreSQL home of its own. Additive: 001-007 are not edited, and nothing deployed reads or
-- writes these tables yet -- the same pre-cutover posture migration 005 took for `eos_ops`.
--
-- STANDARD POSTGRESQL ONLY, same as 001-007.
-- ============================================================================
--
-- ════════════════════ WHY A THIRD SCHEMA, AND NOT A TABLE IN eos_ops ════════════════════
--
-- Migration 005's header states the rule this follows: "Domain separation is by SCHEMA, not by
-- database." It names two schemas, and the third one is earned here rather than assumed:
--
--   eos_policy   identity, tenancy, Roles, capability grants, workflow/policy configuration
--   eos_ops      operational business records -- the inventory ledger, custody, cycle counts
--   eos_crm      customer master data -- who the customer is, who to call, where their sites are
--
-- These tables could not go in `eos_ops` even if the domains were judged close enough, because
-- `eos_ops` has an explicit, deliberate, TESTED claim about itself that a customer-site table would
-- falsify. test/eosOpsPostgres.test.mjs asserts `eos_ops` holds "exactly four foundation tables --
-- no balance table, NO LOCATIONS TABLE", and migration 005's header gives the reason: a Postgres
-- locations table there would be an unmaintained copy of INVENTORY reference data (warehouses,
-- bins, trucks) whose Firestore original stays authoritative.
--
-- That claim is about the inventory namespace, and it stays true. `eos_crm.account_locations` is
-- not an inventory location table and must never be mistaken for one -- so it is not put where the
-- mistake would be one row of a catalog query away.
--
-- ════════════════════ THE TWO `location` NAMESPACES, AND HOW THEY ARE KEPT APART ════════════════════
--
-- THIS IS THE LOAD-BEARING DECISION OF THIS MIGRATION.
--
-- The product has TWO disjoint things called a "location", reached through fields that are spelled
-- almost identically, with NO type discriminator to tell them apart:
--
--   CRM CUSTOMER SITE      Firestore `locations/{id}` -- a customer's office, plant or delivery
--                          address. ALWAYS belongs to exactly one Account
--                          (docs/architecture/customer-domain-foundation.md section 4: "A physical
--                          place tied to exactly one Account ... First-class collection
--                          (`locations.accountId`), never embedded"). This is what
--                          `equipment.locationId` resolves against
--                          (functions/src/equipmentInstall/equipmentImportCommand.ts:155,
--                          installSerializedAssetCommand.ts:296, and firestore.rules:1438-1443's
--                          `equipmentLocationBelongsToAccount()`), and what `fieldops_wos.locationId`
--                          resolves against (functions/src/getWorkOrderFieldContext.ts:160).
--
--   INVENTORY LOCATION     `warehouses` / `mobile_locations` / bins -- a company-held stock
--                          position, carried in `eos_ops` as the PAIR (`location_type`,
--                          `location_id`) where `location_type` is WAREHOUSE / BIN / MOBILE
--                          (migration 005). Never account-scoped: company stock has no customer.
--
-- The repository already states the boundary in prose at
-- functions/src/inventoryLocation/locationDisplayReadService.ts:11-15 -- "CUSTOMER and any other
-- category have NO governed id->display-name authority in this repository today (`locations` as a
-- customer-site directory is not modeled here) -- this resolver NEVER fabricates a label or a
-- `type` for them" -- and the ownership matrix restates it at
-- functions/src/ownership/ownershipMatrix.ts:139 ("A CUSTOMER site, not one of ours. Distinct from
-- warehouses/stock_locations, which are company-owned physical roots.").
--
-- Prose is not a boundary. This migration makes the separation STRUCTURAL, four ways:
--
--   1. DIFFERENT SCHEMA. A CRM site is `eos_crm.account_locations`. An inventory position is an
--      opaque (`location_type`, `location_id`) pair inside `eos_ops`. No query reaches both by
--      accident, and no catalog listing shows them side by side.
--
--   2. MANDATORY ACCOUNT PARENTAGE. `account_locations.account_id` is NOT NULL with a composite
--      foreign key into `accounts`. A warehouse, a bin and a truck have no Account, so an inventory
--      location is not merely discouraged here -- it is UNREPRESENTABLE. This is the same fact the
--      live census found (every customer-site document carries an `accountId`) promoted from an
--      observation to an invariant.
--
--   3. NO TYPE COLUMN, DELIBERATELY ABSENT. `account_locations` has no `type` and no
--      `location_type`, and never gets one. The live census of the source collection found ZERO
--      documents carrying either. Adding a nullable one "for symmetry" would manufacture the exact
--      discriminator whose absence defines this namespace, and the first writer to set it to
--      'WAREHOUSE' would have merged the two namespaces with a single UPDATE.
--
--   4. NO COLUMN NAMED `location_id`, ANYWHERE IN THIS SCHEMA. A CRM site's key is
--      `account_locations.id`. The field NAME `location_id` belongs to the inventory pair and is
--      left there. This is what stops a future migration from UNIONing two `location_id`-named
--      columns into one "all locations" view on the strength of the shared spelling -- there is
--      nothing here for it to union with.
--
-- There is consequently NO foreign key in either direction between `eos_crm` and `eos_ops`, and
-- none may be added: the inventory `location_id` is opaque governed data by migration 005's ruling,
-- and pointing it at this table would assert that a stock position is a customer site.
--
-- ════════════════════ WHY THERE IS NO operating_company_key HERE ════════════════════
--
-- Migration 007 made `operating_company_key` mandatory on every `eos_ops` table that asserts WHERE
-- stock is or WHOSE custody it sits in. These three tables assert neither, and the ownership model
-- has already ruled on the question directly: `account`, `contact` and `location` are all
-- `companyScope: "COMPANY_NEUTRAL"` in functions/src/ownership/ownershipMatrix.ts:118-141, and none
-- of them declares a `companyScopeField`. functions/src/ownership/operatingCompanyAuthority.ts
-- contains no account, contact or location reference at all.
--
-- A customer is not Taylor's or Ventana's; a customer is a customer, and the operating company is a
-- property of the TRANSACTION with them (the Sales Order, the Invoice), which is where ruling R-8
-- puts it. Adding the column here with a NOT NULL would force every writer to invent an answer, and
-- adding it nullable would create a field that is empty on every row and true on none. The axis is
-- absent because the model says it does not apply, not because it was overlooked.
--
-- ════════════════════ OWNERSHIP: PERSON, EXPLICIT, AND LEGITIMATELY ABSENT ════════════════════
--
-- All three families are `ownerClass: "PERSON"`, `ownerType: USER` (ownershipMatrix.ts:118-141).
-- There is therefore ONE owner column, `owner_employee_id`, and no `owner_type` beside it: the type
-- is fixed by classification, and a second column stating it would be a second place for the same
-- fact -- the only way the two could ever disagree. (`OWNER_TYPES.USER`'s id namespace is the
-- canonical Employee id; see functions/src/ownership/typedOwner.ts's header, open item O-1.)
--
-- It is NULLABLE, and that is the point rather than a concession. The matrix's `unresolvedPolicy`
-- for an Account is "remains OWNERLESS until an owner is explicitly assigned", and ruling D-6
-- "forbids inferring an Account owner from creator, territory, coverage, activity, sales history,
-- or auth uid". OWNERLESS is a real, load-bearing state -- an ownerless Account makes inherited
-- Opportunity creation REFUSE, by design. A NOT NULL here would delete that state from the model
-- and force exactly the inference D-6 forbids.
--
-- Contact and Location inherit their owner from the parent Account AT CREATION
-- (`inheritanceSource: "parent Account owner at creation"`), which is a COMMAND rule, not a table
-- invariant: `transfer: "HANDOFF"` means each record's owner may later diverge from its parent's,
-- so a CHECK tying them together would be false the first time somebody hands one off. The
-- inheritance lives in the repository, in the same transaction as the INSERT.
--
-- ════════════════════ WHY `name` IS NOT UNIQUE ════════════════════
--
-- docs/architecture/customer-domain-foundation.md section 8 (D-C1-4) is explicit: "the doc id is
-- the only hard-unique key", `name` / `customerNumber` / `erpId` / `accountingId` / `legacyId` are
-- NOT database-unique, and duplicate prevention is ADVISORY-AT-CREATE on a normalized match. A
-- UNIQUE index on the folded name would convert that advisory check into a hard constraint the
-- product has deliberately refused, and would reject two genuinely distinct customers that happen
-- to share a name. The folded-name index below exists to make the advisory lookup fast, and is
-- non-unique on purpose. `lower(btrim(name))` is the SQL spelling of
-- functions/src/account/accountImportCommand.ts:85-90's `normalizeAccountSearchName`, which trims
-- and lowercases and deliberately does nothing else.
--
-- ════════════════════ THE ID IS THE SOURCE ID, NOT A NEW ONE ════════════════════
--
-- `accounts.id` is TEXT and carries the existing business id verbatim, including the import-derived
-- `IMP-<SLUG>-<DIGEST>` form minted by
-- functions/src/dataImport/firestoreDataImportAdapters.ts:227-228. Re-minting ids at the schema
-- boundary would break every pointer that already names them -- `equipment.accountId`,
-- `fieldops_wos.customerId`, `locations.accountId`, `contacts.accountId` -- and would make the
-- migration unreconcilable against its own source. The shape constraint is the one the existing
-- trusted writer already enforces (accountImportCommand.ts:138).

CREATE SCHEMA IF NOT EXISTS eos_crm;
SET search_path = eos_crm, public;

-- ============================ vocabulary ============================
--
-- The lifecycle of docs/architecture/customer-domain-foundation.md section 9 (D-C1-5),
-- PROSPECT -> ACTIVE <-> INACTIVE -> ARCHIVED, and the same four labels
-- functions/src/account/accountPortfolioSummary.ts:46 already counts over. ARCHIVED is a SOFT
-- terminal state: there is no delete path in this schema, because the product has none
-- ("`ARCHIVED` is soft-delete only"; Contacts and Locations are never hard-deleted).
--
-- This is a PLATFORM lifecycle, not a tenant customization, which is why it is an enum here and
-- `operating_company_key` was not one in migration 007.

CREATE TYPE crm_account_status AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- ============================ Account ============================
--
-- The root of the customer domain and of the person-owned inheritance chain.

CREATE TABLE accounts (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    name              TEXT NOT NULL,
    status            crm_account_status NOT NULL,
    -- PERSON ownership, explicitly assigned or legitimately absent. See the header.
    owner_employee_id TEXT,
    created_by        TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        TEXT        NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A record with no name reads as an absence, and docs/architecture/customers-structured-list.md
    -- is explicit that it "never falls back to the document id". A whitespace-only name would be
    -- exactly that absence wearing a NOT NULL.
    CONSTRAINT accounts_name_present CHECK (btrim(name) <> ''),
    -- The target of the CHILD tables' composite foreign keys: it is what lets a Contact or a
    -- customer site be checked against its parent's tenant in SQL, rather than by a convention
    -- every future writer would have to remember. Same device migration 003 used to tenant-scope
    -- `user_role_assignments`.
    CONSTRAINT accounts_tenant_scoped_identity UNIQUE (tenant_id, id)
);

CREATE INDEX accounts_by_owner ON accounts (tenant_id, owner_employee_id);
CREATE INDEX accounts_by_status ON accounts (tenant_id, status);
-- NON-UNIQUE, deliberately -- see "why `name` is not unique" in the header.
CREATE INDEX accounts_by_folded_name ON accounts (tenant_id, lower(btrim(name)));

-- ============================ Contact ============================
--
-- A person AT an Account. Not a login: docs/architecture/customer-domain-foundation.md section 4 --
-- "Not a login/auth identity." Nothing here references `eos_policy.principals`, and nothing may:
-- a customer's contact is not a principal of this system, and joining the two would make one.

CREATE TABLE contacts (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    account_id        TEXT NOT NULL,
    name              TEXT NOT NULL,
    email             TEXT,
    phone             TEXT,
    -- FREE TEXT, not an enum. field-ops-app-vite/src/metadata/definitions/contact.js:55 declares it
    -- as free text; a closed vocabulary here would refuse titles the product accepts today.
    contact_role      TEXT,
    -- NOT uniquely constrained per Account. contact.js:62 records that primary-contact uniqueness
    -- is NOT enforced, and docs/architecture/customers-structured-list.md:80 refused to promote the
    -- billing contact to "the" primary one because who to invoice and who to call are different
    -- questions. A partial unique index here would invent an answer to a question the product has
    -- deliberately left open, and would reject data that exists today.
    is_primary        BOOLEAN     NOT NULL DEFAULT FALSE,
    owner_employee_id TEXT,
    created_by        TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        TEXT        NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT contacts_name_present CHECK (btrim(name) <> ''),
    -- TENANT-SCOPED PARENTAGE. Not `REFERENCES accounts(id)`: that would happily let a Contact in
    -- one tenant name another tenant's Account, and the leak would read as a valid row.
    CONSTRAINT contacts_account_same_tenant
        FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id)
);

CREATE INDEX contacts_by_account ON contacts (tenant_id, account_id);
CREATE INDEX contacts_by_owner ON contacts (tenant_id, owner_employee_id);

-- ============================ CRM customer site ============================
--
-- READ THE "TWO `location` NAMESPACES" SECTION OF THIS HEADER BEFORE TOUCHING THIS TABLE.
--
-- Named `account_locations`, not `locations`: the source collection's name is the ambiguous one,
-- and carrying the ambiguity across the schema boundary would be the whole mistake. The `account_`
-- prefix says, in the table name itself, the fact that makes this namespace what it is -- every row
-- belongs to an Account.
--
-- The address is FOUR SCALAR COLUMNS, not a composite type or a JSON blob, because the source is
-- already two disagreeing shapes -- the client writes a nested `address{street,city,state,zip}`
-- (field-ops-app-vite/src/domain/locations.js:5-6) and the live census observed flat
-- `addressLine1`/`city`/`state` on stored documents. Flattening to named columns is what makes the
-- two reconcilable into ONE canonical shape; preserving either nesting would preserve the
-- disagreement. Every part is NULLABLE: the census found real sites with partial addresses, and a
-- NOT NULL would have to be satisfied by inventing one.

CREATE TABLE account_locations (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- NOT NULL is the namespace boundary, not a convenience. See the header, point 2.
    account_id          TEXT NOT NULL,
    name                TEXT NOT NULL,
    address_street      TEXT,
    address_city        TEXT,
    address_state       TEXT,
    address_postal_code TEXT,
    access_notes        TEXT,
    owner_employee_id   TEXT,
    created_by          TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          TEXT        NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT account_locations_name_present CHECK (btrim(name) <> ''),
    CONSTRAINT account_locations_account_same_tenant
        FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id),
    -- The handle a future Equipment table needs to enforce ADR-006 section 2.1 -- "Equipment belongs
    -- to one Account AND one Location that must belong to the SAME Account", today an integrity
    -- guard implemented in Rules (firestore.rules:1438-1443's `equipmentLocationBelongsToAccount()`)
    -- over a collection that validates nothing. With this key in place, that invariant becomes a
    -- composite FOREIGN KEY (tenant_id, account_id, location_id) on whichever table owns Equipment,
    -- rather than a `get()` that a reader has to trust. Declared here because it costs one unique
    -- index and it is the only place it CAN be declared; no Equipment table is created here.
    CONSTRAINT account_locations_account_scoped_identity UNIQUE (tenant_id, account_id, id)
);

CREATE INDEX account_locations_by_account ON account_locations (tenant_id, account_id);
CREATE INDEX account_locations_by_owner ON account_locations (tenant_id, owner_employee_id);

-- Down Migration
SET search_path = eos_crm, public;

-- ════════════════════ REFUSE, NEVER DESTROY ════════════════════
--
-- Migration 005's down is a bare `DROP SCHEMA ... CASCADE`, and that was right for a schema whose
-- tables were pre-cutover and provably empty. This schema holds CUSTOMER MASTER DATA -- the Account
-- that every Opportunity, Work Order, Invoice and Equipment record points at. Dropping it silently
-- because someone stepped one migration too far back is not a reversal, it is a deletion with no
-- record of what was deleted. So the down COUNTS first and RAISES with the row counts, exactly as
-- migration 007's up refuses to proceed over occupied tables. A failed down is recoverable.

DO $$
DECLARE
    occupied TEXT;
BEGIN
    SELECT string_agg(t.table_name || ' (' || t.row_count || ' rows)', ', ' ORDER BY t.table_name)
      INTO occupied
      FROM (
          SELECT 'accounts'           AS table_name, count(*) AS row_count FROM eos_crm.accounts
          UNION ALL
          SELECT 'contacts',                         count(*)              FROM eos_crm.contacts
          UNION ALL
          SELECT 'account_locations',                count(*)              FROM eos_crm.account_locations
      ) t
     WHERE t.row_count > 0;

    IF occupied IS NOT NULL THEN
        RAISE EXCEPTION
            'migration 008 refuses to drop eos_crm: % still hold customer master data',
            occupied
            USING HINT = 'Reversing this migration deletes Accounts, Contacts and customer sites that other records point at. Empty the tables deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP SCHEMA IF EXISTS eos_crm CASCADE;
