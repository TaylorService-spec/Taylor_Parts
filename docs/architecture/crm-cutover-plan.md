# CRM cutover plan — Account, Contact, customer site: Firestore → PostgreSQL

Branch `crm/postgres-cutover`, based on main `736b1f17` (post-C4). Lane E of the Firestore → PostgreSQL migration wave:
**CENSUS → FREEZE LEGACY WRITERS → EXPORT → COPY ONCE → VERIFY → RECONCILE → ACTIVATE POSTGRESQL WRITERS → COMPOSE
RENDER TRANSPORT → VERIFY → DISABLE/REMOVE LEGACY WRITERS → UNFREEZE**, mirroring the approved catalog sequence
(`catalog/postgres-cutover`, `docs/architecture/catalog-cutover-plan.md`).

**Nothing is exported, copied, frozen or disabled in any environment by this change.** It builds and proves the
tooling and writes the plan. No Firebase project and no Render database was contacted. `firestore.rules` and
`functions/src/eosApi/server.ts` are not modified.

Dependency: the governed PostgreSQL CRM authority **#1912** (`d1a/crm-postgres-authority`: `functions/src/eosCrm/**`,
migration 024 vocabulary, migration `1759795200000_crm-account-business-facts-and-receipts.sql` — business facts,
child tables, `eos_crm.command_receipts`). Copy/verify execute against that schema and are finished after #1912 merges
(§3.4). Line numbers below are at main `736b1f17` unless a `#1912:` prefix says otherwise.

Mapping classes: **A** canonical (copied) · **B** derived (recomputed, not copied) · **C** legacy defect ·
**D** duplicated (a stored echo of another fact) · **E** Owner decision.

---

## 1. Source census (repository truth)

### 1.1 Collections, id semantics, tenancy

| Collection | Id | Tenancy | Relationship |
|---|---|---|---|
| `accounts` | Firestore auto-id from the client store (`field-ops-app-vite/src/firebase/collectionStore.js:88` `safeAddDoc`), or import-derived `IMP-<SLUG>-<DIGEST>` (`functions/src/dataImport/firestoreDataImportAdapters.ts:287` → `accountImportCommand.ts:139,156`), or seed ids (`acct-harbor`, `sbx-acct-grill-north`, `cw-acct-###`) | **none** — the Firebase project is the tenant | root |
| `contacts` | auto-id (`collectionStore.js:88`; batch `contactImport.js:38`) or seed ids | none | `accountId` → `accounts` (no Rules check: `firestore.rules:1555-1559`) |
| `locations` | auto-id (`collectionStore.js:88`) or seed ids (`loc-harbor-*`, `cw-acct-####-loc-##`) | none | `accountId` → `accounts`; `equipment.locationId` → `locations` enforced by Rules `firestore.rules:1441-1442` (`equipmentLocationBelongsToAccount`) |

PostgreSQL identity is `(tenant_id, id)` with the id carried **verbatim** (`functions/migrations/1758758400000_crm-account-contact-location.sql`,
"THE ID IS THE SOURCE ID"). Every stored id already satisfies or is checked against `^[A-Za-z0-9_-]{1,200}$`
(`functions/src/crm/customerIdentity.ts:59`); a non-conforming id blocks (never re-minted).

**Tenant mapping evidence (nonprod).** `render.yaml:29,77` declares the nonprod service with `EOS_ENVIRONMENT=nonprod`;
tenant key `taylor-nonprod` is the key the bootstrap and synthetic seed use (`functions/scripts/seedSyntheticNonprodWorkforce.js:43`, `functions/scripts/bootstrapEosTenant.mjs:14`);
`config/environments.json` declares `platform-sandbox` ↔ Firebase `eos-platform-sandbox`. So *platform-sandbox CRM →
tenant `taylor-nonprod`* is supported by evidence but is an **operator assertion**: `crmCutover.js` takes `--tenantKey`
explicitly and never infers it. **Production has no PostgreSQL tenant and no mapping** (§7).

**Previously measured population (not re-measured here).** The 2026-09-11 P1B sandbox census
(`docs/architecture/inventory-reference-authority-p1b-census.md:658-667`) read `accounts` 105 and `locations` 185
(180 `cw-acct-####-loc-##` Certification fixtures; 0 with `type`/`locationType`; flat `addressLine1/city/state`,
`owner{USER}`, `fieldProvenance`). The authorized export + census (§6 step 3) is what replaces these numbers.

### 1.2 Stored shapes and their writers

**Account** — the shape is the union of these writers (none validates the whole document; Rules check only the two
governed enums, `firestore.rules:1290-1339`):

| Writer | Evidence | Shape written |
|---|---|---|
| Account form create | `modules/accounts/AccountsList.jsx:138` → `domain/accounts.js:78` → `collectionStore.js:88` | `AccountForm.jsx:202-227` payload: `name, billingAddress{street,city,state,zip}\|null, status, relationshipTypes[], lineOfBusiness[], notes, tags[], customerNumber, erpId, accountingId, legacyId, defaultCurrency, purchaseOrderRequired, invoiceDeliveryMethod, paymentTerms, taxStatus, billingContact{contactId}\|null, accountOwner{7 fields}`; plus `nameLower` (`accounts.js:70-76`) and `createdAt/updatedAt` **server Timestamp** (`accounts.js:53-55`) |
| Account form edit | `AccountDetail.jsx:463` → `accounts.js:82` | same patch + `updatedAt` Timestamp |
| Data Import (callable `executeDataImport`) | `dataImport/dataImportCallables.ts:126` → `firestoreDataImportAdapters.ts:284` → `account/accountImportCommand.ts:164` | `customerImportContract.ts:195`: `name, status (ACTIVE/INACTIVE/PROSPECT), customerNumber, **billingAddress: free-text string** (`:66-73,117,177`), notes, erpId, accountingId, legacyId`; `nameLower`; Timestamp stamps; **no owner** |
| Sandbox baseline seed (raw Admin SDK, merge) | `functions/scripts/seedSandboxBaseline.js:111-114,221-226` | `accountId` (id echo), `name`, **`lineOfBusiness: "TAYLOR"` scalar**, `status`, Timestamp stamps, `createdBy/updatedBy: "sandbox-baseline-seed"` |
| Inbound-work sandbox seed | `functions/scripts/seedSandboxInboundWork.mjs:76-82`, `fixtures/inboundWorkFixtures.mjs:252-268` | `name, nameLower, status` — **no timestamps** |
| Certification world (frozen) | `certificationWorld/build.mjs:151-174`; owners `seedAccountOwners.mjs:223` | fixture fields (`category, city, state, addressLine1, phone, website, certLineMode, fixtureCompleteness, dataProvenance, fieldProvenance, publicSource, syntheticDataDisclaimer`), scalar `lineOfBusiness`, `certificationWorld` marker (`manifest.mjs:16,154`) |

Legacy variants observed in code: `billingAddress` map **or free-text string**; `lineOfBusiness` array **or scalar**;
`createdAt/updatedAt` Firestore Timestamp **or epoch-ms number** (the store stamped `Date.now()` before
`TIMESTAMP_SHAPE`, `collectionStore.js:11-45`; `updateAccount` did too, `accounts.js:83-85`) **or absent**
(`updatedAt` missing on pre-#1137 creates, `collectionStore.js:68-84`); statuses written outside the enum by fixtures
(`DORMANT`, corrected at `certificationWorld/build.mjs:141-145`); `accountOwner.assignedAt` is epoch ms
(`domain/commercialProfile.js:215`).

**Contact**

| Writer | Evidence | Shape |
|---|---|---|
| Add Contact | `AccountDetail.jsx:491` → `domain/contacts.js:28` | `ContactCreateModal.jsx:57-62`: `name, phone, email, isPrimary`; `accountId`; `createdBy/updatedBy` = **Firebase uid** (`contacts.js:30-36`); epoch-ms stamps |
| updateContact | `contacts.js:40` | **no caller** in `field-ops-app-vite/src` (dead writer) |
| CSV import (client batch) | `ContactImportModal.jsx:119` → `domain/contactImport.js:20-56` | `accountId, name, phone, email, **role**, isPrimary:false, createdAt/updatedAt` epoch ms, uid actors |
| Ownership backfill | `functions/scripts/ownershipSandboxBackfill.js:233`, rule `functions/src/ownership/ownershipBackfillRules.ts:70-78,96` | `owner: { type: "USER", id }` |
| Sandbox seeds | `seedSandboxBaseline.js:236-239` (`contactId` echo, **`title`**, Timestamp); `inboundWorkFixtures.mjs:267` (no timestamps) | |
| Certification world | `build.mjs:198-209` | `accountId, **locationId**, name, **title**, email, dataProvenance` + marker |

**Customer site (`locations`)**

| Writer | Evidence | Shape |
|---|---|---|
| Add Location | `AccountDetail.jsx:478` → `domain/locations.js:18` | `LocationCreateModal.jsx:53-62`: `name, address{street,city,state,zip}, accessNotes`; `accountId`; epoch-ms stamps; **no actor** |
| updateLocation | `locations.js:22` | **no caller** (dead writer) |
| Ownership backfill | as Contact | `owner{USER}` |
| Sandbox seeds | `seedSandboxBaseline.js:229-232` (`locationId` echo, **flat** `city/state`, Timestamp); `inboundWorkFixtures.mjs:256` | |
| Certification world | `build.mjs:180-191` | **flat** `addressLine1/city/state`, `fieldProvenance` + marker |

`type` / `locationType`: **no writer**; the PostgreSQL site table has no type column by design
(`1758758400000_crm-account-contact-location.sql`, "NO TYPE COLUMN, DELIBERATELY ABSENT").

### 1.3 Readers (summary — full classified list in §5)

Server: `getWorkOrderFieldContext.ts:159-160`; `equipmentInstall/installSerializedAssetCommand.ts:294-296`;
`equipmentInstall/equipmentImportCommand.ts:155`; `inboundWork/inboundCandidateResolution.ts:75`;
`inboundWork/inboundDecisionCommands.ts:132-133`; `opportunity/opportunityCallables.ts:225`;
`opportunity/opportunityReadService.ts:220`; `account/accountPortfolioSummary.ts:93-100`;
`dataImport/firestoreDataImportAdapters.ts:264,357,367,442,453`; `dataImport/firestoreServiceHistoryAdapters.ts:46,144`;
`reporting/reportExecutionService.ts:825` over `reporting/reportCatalog.ts:85-87`. Rules: `firestore.rules:1441-1442`.
Client: `hooks/useAccount.js:65`, `useAccountPicker.js:38`, `useAccountSearch.js:42`, `useAccountNames.js:84`,
`useContactsForAccount.js:39`, `useLocationsForAccount.js:60`, `useLocationsForAccounts.js:44`, `useLocation.js:42`,
`useLocationReferenceResolver.js:84`, `useInstalledEquipmentPage.js:98-99`, `metadata/firestoreListSource.js:73`
(Account index list via `AccountsList.jsx:118`), `hooks/useAccountPortfolioSummary.js:29` (callable),
`domain/reporting/reportCatalog.js:55-57`. Operator scripts: `_releaseStateSnapshot.mjs:67`,
`ownershipSandboxBackfill.js:89`, `ownershipBackfillSimulation.js:82`, Certification world scripts.

---

## 2. Canonical mapping

Canonical = what the governed D1-A authority (#1912 `src/eosCrm/**`) would store for the same value: names and
optional text **trimmed**, blank optional text **NULL**, enums **exact**, sets in **vocabulary order**
(#1912: `crmAuthorityKernel.ts` `optionalText`/`requireName`, `accountAuthority.ts` `enumSet`/`billingAddress`/`currency`).
A value that authority would refuse **blocks** (never repaired). The executable form is
`functions/src/crm/crmCutoverSnapshot.ts` (`ACCOUNT_/CONTACT_/LOCATION_FIELD_DISPOSITIONS`); **an unclassified stored
field blocks** (`UNCLASSIFIED_SOURCE_FIELD`).

### 2.1 Account → `eos_crm.accounts` (+ #1912 child tables)

| Firestore field | Target | Class | Rule |
|---|---|---|---|
| doc id | `id` | A | verbatim; shape-checked |
| `name` | `name` | A | required, trimmed |
| `status` | `status crm_account_status` | A | **exactly** PROSPECT/ACTIVE/INACTIVE/ARCHIVED. `Active`, `DORMANT`, absent, non-string → `STATUS_UNMAPPABLE` blocker. Never case-folded, aliased or defaulted. Census reports the raw distribution. D-C1-5 transitions are **not** enforced by the copy. |
| `accountOwner.assignedToEmployeeId` | `owner_employee_id` | A | must resolve to an Employee **of the target tenant** in `eos_workforce.employees` (governed employment status) → else `OWNER_UNRESOLVED` blocker. Absent/empty assignee → NULL (**legacy OWNERLESS row**, advisory; the authority refuses ownerless *creation*, not legacy rows). Never matched by uid or name. |
| `accountOwner.assignedToUserId` | — | provenance | Firebase uid → **evidence file only** |
| `accountOwner.assignedToDisplayName` | — | D | display snapshot; not migrated |
| `accountOwner.assignedByEmployeeId / assignedByUserId / assignedByDisplayName / assignedAt` | — | E (ruled) | **migration evidence only.** Never Account columns. A one-time transform into ownership history is allowed **only once a governed Account ownership-handoff history exists** — it does not (#1912 `ACCOUNT_OWNER_HANDOFF_PENDING`). Never fabricated into governed history. |
| `billingAddress {street,city,state,zip}` | `billing_address_street/_city/_state/_postal_code` | A | structured parts map **directly** (`zip` → `_postal_code`); blank part → NULL; unknown part → blocker |
| `billingAddress` **free-text string** | — | C | **never parsed.** Held verbatim in the census/copy evidence (`billingAddressResolution`), Account marked `BILLING_ADDRESS_REQUIRES_RESOLUTION` (blocker). No permanent free-text column. Resolution = a person records the structured address through the Account form before the freeze (or an Owner-approved staging path, §9). |
| `notes`, `customerNumber`, `erpId`, `accountingId`, `legacyId` | same-named snake columns | A | optional text; opaque; not unique (D-C1-4) |
| `defaultCurrency` | `default_currency` | A | `^[A-Z]{3}$` (+ #1912 ISO-4217 set after integration) |
| `purchaseOrderRequired` | `purchase_order_required` | A | boolean or NULL |
| `invoiceDeliveryMethod` | `invoice_delivery_method` | A | EMAIL/PORTAL/MAIL/EDI or NULL |
| `paymentTerms`, `taxStatus` | `payment_terms`, `tax_status` | A (governed) | COD/NET_30/NET_60/NET_90; UNKNOWN/TAXABLE/EXEMPT/RESELLER; invalid → blocker. NULL tax_status = UNKNOWN. The copy is not a `customer.governedField.write` command — it carries the stored, Rules-validated value verbatim and records it in the audit digest. |
| `billingContact {contactId}` | `billing_contact_id` | A | must be a **selected Contact of this Account** (#1912 FK `accounts_billing_contact_on_account`) → else blocker |
| `tags[]` | `eos_crm.account_tags (position, tag)` | A | ≤100 distinct non-blank ≤200, trimmed, order preserved |
| `relationshipTypes[]` | `eos_crm.account_relationship_types` | A | CUSTOMER/VENDOR set |
| `lineOfBusiness[]` | `eos_crm.account_lines_of_business` | A | TAYLOR/VENTANA set |
| `lineOfBusiness` **scalar** | — | C | `LINE_OF_BUSINESS_SCALAR_LEGACY` blocker (seed shape; the UI reads arrays only, `domain/accountNorthStar.js:125`) — a scalar is not promoted to a set by assumption |
| `createdAt`, `updatedAt` (Timestamp or epoch ms) | `created_at`, `updated_at` | A | microsecond ISO; drift counted. Absent/invalid `createdAt` → blocker (never fabricated). Absent `updatedAt` → `created_at` (the create path stamps both from one call, `collectionStore.js:85-88`), advisory. |
| `nameLower` | — | B | PostgreSQL folds `lower(btrim(name))`; stale value reported (advisory) |
| `accountId` (seed echo) | — | D | must equal the doc id, else blocker |
| `createdBy`, `updatedBy` | — | provenance | uid / seed actor → evidence only. `created_by`/`updated_by` = the **cutover EOS Principal** |
| `certificationWorld` | — | marker | record **excluded** (ids + reason in evidence) |
| `category, certLineMode, fixtureCompleteness, dataProvenance, fieldProvenance, publicSource, syntheticDataDisclaimer` | — | E | fixture-only; on an unmarked record → blocker |
| `city, state, addressLine1, phone, website` on an Account | — | E | no Account column (`metadata/definitions/account.js` gap `ACCOUNT_CITY_STATE_NOT_PROJECTED`) → blocker |

### 2.2 Contact → `eos_crm.contacts`

| Firestore field | Target | Class | Rule |
|---|---|---|---|
| doc id | `id` | A | verbatim |
| `accountId` | `account_id` | A | must be a **selected** Account → else `ACCOUNT_REFERENCE_DANGLING` / `ACCOUNT_ID_MISSING` |
| `name` | `name` | A | required, trimmed |
| `email`, `phone` | `email`, `phone` | A | optional text |
| `role` | `contact_role` | A | free text |
| `isPrimary` | `is_primary` | A | boolean; absent → false; multiple primaries per Account reported, not resolved |
| `owner {type:"USER", id}` | `owner_employee_id` | A | must resolve as for Account. Absent → NULL (advisory). **Never inherited from the Account at migration time** — inheritance is a creation rule. |
| `createdAt/updatedAt` | `created_at/updated_at` | A | as Account |
| `createdBy/updatedBy` (uids) | — | provenance | evidence only |
| `contactId` (seed echo) | — | D | must equal id |
| `title` | — | E | not asserted to be `role` → blocker (seed/Certification shape) |
| `locationId` | — | E | a Contact has no site column → blocker |
| `dataProvenance` | — | E | fixture-only |

### 2.3 Customer site → `eos_crm.account_locations`

| Firestore field | Target | Class | Rule |
|---|---|---|---|
| doc id | `id` | A | verbatim |
| `accountId` | `account_id` | A | selected Account, else blocker |
| `name` | `name` | A | required, trimmed |
| `address {street,city,state,zip}` | `address_street/_city/_state/_postal_code` | A | nested map → flat columns directly |
| flat `addressLine1 / city / state / zip` | same columns | C (legacy variant) | structured components map directly (`addressLine1`→street). Nested + flat that **agree** merge; that **disagree** → `ADDRESS_SHAPE_CONFLICT` blocker (no precedence chosen) |
| `accessNotes` | `access_notes` | A | optional text |
| `owner {USER}` | `owner_employee_id` | A | as Contact |
| `createdAt/updatedAt` | `created_at/updated_at` | A | as Account |
| `createdBy/updatedBy` | — | provenance | evidence only |
| `locationId` (seed echo) | — | D | must equal id |
| `type`, `locationType` | — | C | **no PostgreSQL target**; a typed site would merge the CRM and inventory namespaces → blocker |
| `fieldProvenance` | — | E | fixture-only |

### 2.4 Cross-record rules

- Duplicate ids in a snapshot block every copy of the id. Duplicate folded names are **advisory** (D-C1-4).
- An Account blocked for any reason makes its Contacts/sites dangle (reported, not copied without a parent).
- A Certification-marked record is excluded; an **unmarked** id with the `cw-` prefix blocks (`CERTIFICATION_ID_WITHOUT_MARKER`) — whether it is a fixture is not guessed.
- `eos_commercial.opportunities / sales_agreements / sales_orders`, `eos_finance.invoices / payments`, `eos_ops.equipment` rows of the tenant naming an Account the copy will not provide (and `eos_crm.accounts` does not already hold) → `COMMERCIAL_ACCOUNT_REFERENCE_UNRESOLVABLE` blocker.
- A Firebase uid is **never** written to `created_by`, `updated_by` or any principal column.

---

## 3. Tooling

```
exportCrmSnapshot.js (Firestore, read only, FIREBASE_EXIT_MIGRATION_ONLY) → crm-snapshot.json + .sha256
   → crmCutover.js --mode census | copy | verify (PostgreSQL; loads no Firebase module)
```

### 3.1 Exporter — `functions/scripts/exportCrmSnapshot.js` (the Owner's MIGRATION-ONLY exception)

First line is the literal `// FIREBASE_EXIT_MIGRATION_ONLY`. Only `db.collection(name).get()` over the exact
allowlist `accounts, contacts, locations`. Timestamps tagged `{$timestamp}`; any other Firestore type tagged
`{$unsupported}` (census blocks it) and a stored tag key refused. Output and `<out>.sha256` created `wx`, mode 0600,
never overwritten. **Fence (before firebase-admin loads):** `--environment` declared in `config/environments.json`;
`--projectId` refused (the project comes from the registry); `EOS_ENVIRONMENT` exactly `nonprod`; production by role
or project id refused with no confirmation path; `platform-certification`/`eos-platform-certification` refused;
environment with no Firebase project refused; `--out` required and must not exist. Not imported by any runtime module
(structural test over `functions/src`, `field-ops-app-vite/src`, `integrations`, and the other operator scripts); no
schedule, no sync, no handler.

Why `functions/scripts`: `scripts/firebaseExitGuard.mjs` fences the business-runtime roots only; every existing
Firestore operator tool lives in `functions/scripts`. The exception is still one small file nothing imports.

### 3.2 Snapshot format (`functions/src/crm/crmCutoverSnapshot.ts` header)

`{format:"EOS_CRM_SNAPSHOT", version:1, exporter:"FIREBASE_EXIT_MIGRATION_ONLY", source:{environmentId,
firebaseProjectId, exportedAt}, accounts:[{id,data}], contacts:[…], locations:[…]}` — any other top-level collection
is refused at parse.

### 3.3 `functions/scripts/crmCutover.js --mode census` (built)

Fence before `pg`/lib: registry `--environment`, production refused, `--databaseUrlEnv` (shared
`assertMeasurementTarget`); `EOS_ENVIRONMENT=nonprod` (shared `assertNonprodRuntime`); not `platform-certification`;
`--tenantKey`, `--snapshot`; copy additionally `--performedByPrincipalId` and `--evidenceOut`; an existing evidence file
is refused. After parse: the snapshot's `environmentId` must equal `--environment`, its project must equal the
registry's and must not be `taylor-parts`; a present `<snapshot>.sha256` must match (required for copy).

Census = pure snapshot census (`censusCrmSnapshot`) + READ ONLY target facts (`crmCutoverTarget.ts`
`measureCrmTarget`: owner ids resolved in `eos_workforce.employees` for the tenant; existing `eos_crm` rows;
distinct `account_id` of the six account-referencing tables; #1912 schema presence) folded by `finalizeCrmCensus`.
Reports: counts/selected/excluded, raw status distribution, timestamp shapes, field presence, address and billing
address shapes, owner references, ownerless counts, duplicate folded names, every finding with id/field/detail,
blockers, `copyReady`, canonical digest. `--evidenceOut` writes the reconciliation evidence (free-text billing
addresses, Certification exclusions with reason, per-record uid/assignment provenance). A census before owners are
measured is never copy-ready (`OWNER_RESOLUTION_NOT_MEASURED`).

### 3.4 `--mode copy` / `--mode verify` (design; executed after #1912 merges)

Until the #1912 schema is on this branch both modes refuse `CRM_COPY_SCHEMA_NOT_INTEGRATED` after the census, rather
than write a partial Account.

**Copy** — refuses unless census `copyReady`. ONE transaction under `pg_advisory_xact_lock('crm-cutover|<tenant>')`:
tenant exists; `--performedByPrincipalId` is an active Principal with an active membership in the tenant (it is the
`created_by`/`updated_by` of every row; never a uid); schema present. Plan per family (accounts → contacts → sites →
children → `billing_contact_id` update, so every composite FK holds row by row): absent → INSERT verbatim ids and
timestamps; present and identical → nothing; present and different → `DRIFT_DETECTED`, roll back, **never
overwritten**; tenant rows not in the snapshot → `TARGET_HAS_UNKNOWN_RECORDS`, roll back (the declared synthetic
nonprod seed ids of `scripts/fixtures/syntheticNonprodWorkforceSeed.v1.json` are reported separately; whether they
may coexist is §9). Identity for "identical" excludes `created_by/updated_by` (a rerun by another operator is still a
no-op) but includes every canonical field and child set. One `eos_policy.audit_events` row
(`crm.cutover.copy`, snapshot sha256, canonical digest, counts, evidence sha256) only if anything was inserted.
Evidence file written (`wx`, 0600) **before** BEGIN: uid provenance, owner-assignment trail, Certification
exclusions. Rerun of the same snapshot: `NO_CHANGES`.

**Verify** — READ ONLY (REPEATABLE READ): source vs target counts; id-set reconciliation; field-by-field equality
over a deterministic sha256-ordered sample (`--sample N|all`) including child sets and billing contact; FK integrity
(contacts/sites → accounts, billing contact on account, `NOT VALID` Commercial FKs checked by
`SELECT … WHERE NOT EXISTS`); **Commercial compatibility**: every `account_id` in `eos_commercial.*`/`eos_finance.*`
/`eos_ops.equipment` of the tenant resolves in `eos_crm.accounts`; no `created_by/updated_by` equals any uid in the
snapshot provenance; no Certification-excluded id present.

---

## 4. Render transport plan (doc only)

A domain-separated CRM transport, `functions/src/eosCrm/crmHttp.ts`, following `functions/src/eosCommercial/commercialHttp.ts`
exactly (bearer → injected `TokenVerifier` → `resolveOperationalContext` → `{tenantId, principalId, capabilities}` →
one operation from a closed list → safe response; tenant only from `x-eos-tenant`; authority-bearing body fields
refused; `STATUS_BY_CATEGORY` from `CrmAuthorityError.category`; body cap; CORS allowlist).

- **Route:** `CRM_ROUTE = "/crm/customers"`; `server.ts` `eosApiDomainFor` gains `path.startsWith("/crm/") → "crm"` and composes `createCrmHttpHandler` beside the commercial handler (a separate PR; not this lane).
- **Closed read list (`customer.record.read`):** `getAccount`, `listAccounts`, `getContact`, `listAccountContacts`, `getAccountLocation`, `listAccountLocations`.
- **Closed mutation list:** `createAccount` (`customer.record.create`, explicit same-tenant Employee owner, idempotency key), `updateAccount` (`customer.record.update`; `paymentTerms`/`taxStatus` changes also `customer.governedField.write`), `createContact`, `updateContact`, `createAccountLocation`, `updateAccountLocation` (`customer.record.create/update`, V1 ruling).
- **Not offered:** Account owner change (`ACCOUNT_OWNER_HANDOFF_PENDING`), delete, status-transition enforcement (D-C1-5 proposed), any generic/table route, any copy/migration operation (the cutover stays an operator tool, never an API).
- **Read gaps to close before client cutover:** a bounded **status count** read replacing `getAccountPortfolioSummary`; an **id-batch name** read replacing `useAccountNames`/`useLocationReferenceResolver`/`useInstalledEquipmentPage`; an **email → Contact** lookup replacing `inboundCandidateResolution.ts:75`; a **name-prefix search** replacing `useAccountSearch`. Each is a new closed read in `src/eosCrm`, capability `customer.record.read`.

**Sequencing:** the transport is composed **after** a reconciled verify and **after** PostgreSQL writers are activated
(§6 steps 6-7); reads may be composed earlier for consumer migration testing against the copied data, but no client
mutation path is pointed at it before the Firestore writers are frozen.

---

## 5. Consumer / client cutover inventory

Classes: **MUST** — must cut over before Commercial C6 (Commercial commands read `eos_crm.accounts`,
`eosCommercial/commands/commercialCommandKernel.ts:296-302`, and FK `(tenant_id, account_id)`); **FOLLOW** — can follow
after CRM core cutover (but stays on a *frozen* Firestore until it moves: no dual write); **LEGACY** — operator/seed/
verification tooling that must not run after the freeze; **REMOVE** — deleted with its replacement.

| # | Consumer | Evidence | Reads / writes | Class | Replacement PostgreSQL path |
|---|---|---|---|---|---|
| 1 | Account form create | `AccountsList.jsx:138` → `domain/accounts.js:78` | W accounts | **MUST** | CRM transport `createAccount` (explicit owner) |
| 2 | Account form edit | `AccountDetail.jsx:463` → `accounts.js:82` | W accounts | **MUST** | `updateAccount` (+ governed capability) |
| 3 | Data Import customers | `firestoreDataImportAdapters.ts:284` → `accountImportCommand.ts:118-185`; callable `executeDataImport` | W accounts | **MUST** (or frozen) | `createAccount` — **GAP**: import contract has no owner (`customerImportContract.ts:22-24`) and PostgreSQL refuses ownerless creation; free-text billing address (`:66-73`) has no target. Owner decision §9 |
| 4 | Data Import identity/equipment/service-history lookups | `firestoreDataImportAdapters.ts:264,357,367,442,453`; `firestoreServiceHistoryAdapters.ts:46,144` | R accounts, locations | FOLLOW | `listAccounts` name-fold lookup + `listAccountLocations` |
| 5 | Account picker | `hooks/useAccountPicker.js:38` (NewOpportunityForm.jsx:26, WorkOrderWizard.jsx:92, InboundWorkWorkspace.jsx:226) | R accounts | **MUST** | `listAccounts` |
| 6 | Account record | `hooks/useAccount.js:65` | R accounts | **MUST** | `getAccount` |
| 7 | Account index list | `metadata/firestoreListSource.js:73` via `AccountsList.jsx:118` (`metadata/definitions/account.js` `readVia: CLIENT_DIRECT`) | R accounts | **MUST** | `listAccounts` (definition `readVia` → transport) |
| 8 | Account search | `hooks/useAccountSearch.js:42`, `domain/accountSearch.js:97` (AccountsList.jsx:173, FinancialsCustomerFinancials.jsx:42) | R accounts | **MUST** | `listAccounts` folded-name prefix |
| 9 | Account name resolution | `hooks/useAccountNames.js:84` (SalesOrderDetail.jsx:94, SalesAgreementDetail.jsx:227, SalesOrdersList.jsx:69 via `useAccountReferenceResolver.js:65`, Financials*) | R accounts | **MUST** | new id-batch read (§4 gap) |
| 10 | Portfolio summary | callable `account/accountPortfolioSummary.ts:93-100`; client `useAccountPortfolioSummary.js:29` | R accounts (count) | FOLLOW | new status-count read (§4 gap) |
| 11 | Opportunity callables | `opportunity/opportunityCallables.ts:225` | R accounts (txn) | **REMOVE** at C6 | `commercialHttp` `createOpportunity` (reads `eos_crm.accounts`) |
| 12 | Opportunity read service | `opportunity/opportunityReadService.ts:220` | R accounts (names) | **REMOVE** at C6 | Commercial read projections |
| 13 | Contacts of an Account | `hooks/useContactsForAccount.js:39` (AccountDetail.jsx:392-394; billing contact choice in AccountForm) | R contacts | **MUST** (billing contact is an Account fact) | `listAccountContacts` |
| 14 | Add Contact | `AccountDetail.jsx:491` → `domain/contacts.js:28` | W contacts | FOLLOW | `createContact` |
| 15 | updateContact | `domain/contacts.js:40` (no caller) | W contacts | REMOVE | `updateContact` if a UI is added |
| 16 | Contact CSV import | `ContactImportModal.jsx:119` → `domain/contactImport.js:20-56` | W contacts (batch) | FOLLOW | `createContact` per row with idempotency keys (atomic-batch semantics change — §9) |
| 17 | Sites of an Account | `hooks/useLocationsForAccount.js:60` (AccountDetail.jsx, WorkOrderWizard.jsx:118, InboundWorkWorkspace.jsx:240, InstallAtCustomer.jsx:54) | R locations | FOLLOW | `listAccountLocations` |
| 18 | Sites of many Accounts | `hooks/useLocationsForAccounts.js:44` (CustomerPicker.jsx:42) | R locations | FOLLOW | `listAccountLocations` per Account or a batch read |
| 19 | One site / id resolution | `hooks/useLocation.js:42` (WorkOrderDetailPage.jsx:6), `useLocationReferenceResolver.js:84`, `domain/locationSubscription.js` | R locations | FOLLOW | `getAccountLocation` / id-batch read |
| 20 | Add Location | `AccountDetail.jsx:478` → `domain/locations.js:18` | W locations | FOLLOW | `createAccountLocation` |
| 21 | updateLocation | `domain/locations.js:22` (no caller) | W locations | REMOVE | — |
| 22 | Installed-equipment names | `hooks/useInstalledEquipmentPage.js:98-99` | R accounts, locations | FOLLOW | id-batch read |
| 23 | Work order field context | callable `getWorkOrderFieldContext.ts:159-160` | R accounts, locations | FOLLOW | `getAccount` + `getAccountLocation` (server-side, same tenant) |
| 24 | Serialized asset install | `equipmentInstall/installSerializedAssetCommand.ts:294-296` | R accounts, locations (txn existence) | FOLLOW* | PostgreSQL existence check; *a site created in PostgreSQL after writer activation is invisible to this Firestore txn → blocks writer activation unless moved |
| 25 | Equipment import | `equipmentInstall/equipmentImportCommand.ts:155` | R locations (txn) | FOLLOW* | as #24 |
| 26 | Rules equipment ↔ site check | `firestore.rules:1441-1442` | R locations (`get()`) | FOLLOW* | moves with Equipment's own PostgreSQL authority (`eos_ops.equipment`, composite FK on `(tenant_id, account_id, id)`) |
| 27 | Inbound email candidate | `inboundWork/inboundCandidateResolution.ts:75` | R contacts by email | FOLLOW | new email lookup read (§4 gap) |
| 28 | Inbound decision | `inboundWork/inboundDecisionCommands.ts:132-133` | R accounts, locations (txn) | FOLLOW* | PostgreSQL existence |
| 29 | Report catalog / execution | `reporting/reportCatalog.ts:85-87`, `reportExecutionService.ts:825`; client `domain/reporting/reportCatalog.js:55-57` | R all three | FOLLOW | report objects re-pointed to CRM read projections (reports on a frozen Firestore are stale after PG writes begin) |
| 30 | Ownership backfill rule | `ownership/ownershipBackfillRules.ts:96-97`; scripts `ownershipSandboxBackfill.js:89,233`, `ownershipBackfillSimulation.js:82` | R accounts, W contacts/locations `owner` | LEGACY → REMOVE | none — PostgreSQL owners are carried by the copy; post-cutover owners come from creation inheritance |
| 31 | Global search `accounts` provider | `shared/search/searchProviders.js:22-38` (no caller) | — | REMOVE | — |
| 32 | Sandbox seeds | `seedSandboxBaseline.js:221-240`, `seedSandboxInboundWork.mjs:76-82` | W all three (raw Admin SDK) | LEGACY | `seedSyntheticNonprodWorkforce.js` (governed CRM writers) |
| 33 | Certification world | `certificationWorld/build.mjs`, `seedAccountOwners.mjs:223`, `correctLiveWorld.mjs`, `verifyLiveSurfaces.mjs`, `verifyReferenceIntegrity.mjs` | W/R | LEGACY (frozen) | none |
| 34 | Release state snapshot | `_releaseStateSnapshot.mjs:67` | R accounts | LEGACY | PostgreSQL count |
| 35 | Firestore indexes | `firestore.indexes.json:138,152,166,216,396,526,540` | — | REMOVE (last) | PostgreSQL indexes (migration 008 / #1912) |
| 36 | Metadata definitions | `metadata/definitions/account.js:67`, `contact.js:29`, `location.js:92` (`readVia: CLIENT_DIRECT`) | — | FOLLOW | `readVia` → transport; `nameLower` field retired |

Rows 1-9 and 13 are the Commercial C6 Account dependency: a Commercial record created on PostgreSQL must be able to
pick, read, name and bill an Account that exists in `eos_crm`, and no Account may be created where Commercial cannot
see it. Rows marked FOLLOW* gate **writer activation** (§6 step 7), not the copy.

---

## 6. Old Firestore writer disablement plan and freeze sequence

### 6.1 The reader constraint

No dual write, no sync. After the copy, any Account/Contact/site write accepted by Firestore is drift, and any write
accepted by PostgreSQL is invisible to every Firestore reader in §5. So Firestore writers are frozen **before** the
export that is copied, and PostgreSQL writers open only when the readers that must see new records have moved (or the
Owner accepts a CRM write freeze for that window).

### 6.2 Exact legacy writers to freeze, then remove

| Writer | Freeze mechanism (plan) | Remove |
|---|---|---|
| `domain/accounts.js:78,82` (client-direct) | Rules: `accounts` `allow create, update: if false` (`firestore.rules:1332-1337`) | writer + `AccountForm` submit re-pointed to transport |
| `domain/contacts.js:28,40`, `domain/contactImport.js:20` | Rules: `contacts` `allow create, update: if false` (`firestore.rules:1557`) | writers |
| `domain/locations.js:18,22` | Rules: `locations` `allow create, update: if false` (`firestore.rules:1343`) | writers |
| `account/accountImportCommand.ts:118` (Admin SDK — Rules do not apply) | a retirement switch as the catalog lane's `firestoreCatalogWriterRetirement.ts`: `assertFirestoreCrmWriterOpen("account.import")` first statement; RETIRED → `failed-precondition`; deploy Functions | command + `CUSTOMERS` writer registration `dataImportCallables.ts:126` |
| `ownershipSandboxBackfill.js`, `seedAccountOwners.mjs`, `seedSandboxBaseline.js`, `seedSandboxInboundWork.mjs` (Admin SDK) | operator stop: must not be run after the freeze (recorded in the freeze evidence) | retire the CRM parts |
| Read Rules `allow read: if isAdminOrDispatcher()` (`:1320,1342,1556`) | unchanged during the window (frozen readers keep working) | `allow read: if false` after every §5 reader moved |

**Rules are not modified in this lane.** The Rules edits and the retirement switch are their own PRs, each deployed to
the environment as a separately authorized step.

### 6.3 Sequence (each step separately authorized and evidenced)

1. **Integrate** #1912 → main → this branch (merge); finish copy/verify; migrate nonprod.
2. **Census (pre-freeze)**: `exportCrmSnapshot.js --environment platform-sandbox` → `crmCutover.js --mode census --evidenceOut`. Resolve every blocker **at the source** through the existing governed paths (structured billing addresses through the Account form; statuses; owners via Employee reconciliation) — never in the tool. Owner decisions §9 recorded.
3. **Freeze legacy writers** (§6.2) and deploy Rules + Functions switch. Record the freeze time.
4. **Export** again after the freeze; record sha256.
5. **Census** on the post-freeze snapshot must be `copyReady`.
6. **Copy once** (`--performedByPrincipalId`, `--evidenceOut`); rerun must be `NO_CHANGES`.
7. **Verify `--sample all`**, reconciled, including Commercial compatibility. **Reconcile** any finding with a person.
8. **Activate PostgreSQL writers**: grant `customer.record.*` / `customer.governedField.write` through governed Role grants.
9. **Compose the Render CRM transport** (§4) and move the MUST consumers (§5 rows 1-9, 13), then the FOLLOW* consumers that gate site/Account creation (24-26, 28). **Verify** again (a `--mode verify` on the same snapshot must still reconcile for untouched rows; new PostgreSQL rows are expected and reported, not drift).
10. **Disable/remove legacy writers** and their callables, then legacy readers as they move; `allow read: if false`; drop Firestore indexes; shrink `docs/architecture/firebase-exit-baseline.json`.
11. **Unfreeze**: CRM writes resume on PostgreSQL only.

**Rollback rule.** Before step 8 (no PostgreSQL CRM write has been accepted), rollback = revert the Rules/switch
deploy and discard the copied tenant rows through a separately authorized, audited operation; Firestore is still the
authority. **From step 8 on there is no silent revert**: PostgreSQL is the authority; re-opening Firestore writers
would fork the data, and is refused without an Owner decision and a reverse reconciliation plan.

---

## 7. Production prerequisites and stop conditions

Stop and obtain separate authorization before any of: a production (`taylor-parts`) export or census (both tools refuse
it outright and have no production mode); creating a production PostgreSQL tenant or choosing its key; deploying the
Rules freeze or the retirement switch to production; any copy into a production database.

Production prerequisites: (1) **source census** of the production collections under an authorized read; (2) **tenant
mapping** production project → tenant key, Owner-approved; (3) **counts** reconciled source vs target per family,
after Certification/fixture exclusion; (4) **identity reconciliation**: every owner Employee id resolves in the
production `eos_workforce.employees` and the cutover EOS Principal exists with membership; (5) every free-text billing
address resolved; (6) Commercial compatibility verified; (7) **Owner authorization** for the freeze window and the copy.

Stop if: census reports any blocker; verify is not reconciled; a post-freeze rerun is not `NO_CHANGES`; any Firestore
CRM write is observed after the freeze; a Firebase uid appears in any `created_by`/`updated_by`.

---

## 8. Proof

- `functions/test/crmCutover.test.mjs` (offline): exporter marker, read-only verbs, exact allowlist, `wx`/0600,
  no schedule/handler; **structural: no runtime module imports the exporter**; census/copy modules and CLI load no
  Firebase (static + runtime probe); vocabulary parity with `constants.js` and `firestore.rules`; parser refuses
  foreign format/extra collection; clean census with exact canonical records; determinism; free-text billing address
  held for resolution and absent from canonical records; structured billing parts; unmappable statuses; dangling
  references; billing contact on another Account; Certification exclusion (+ children dangle, unmarked `cw-` blocks);
  uid/assignment provenance evidence-only; owner resolution; Commercial references; site `type`; address conflict;
  unclassified/legacy shapes; governed enums; timestamps; duplicates; snapshot source/checksum refusals.
- `functions/test/operatorScriptEnvironmentFence.test.mjs`: 20 subprocess refusals for the two scripts, each before
  any client library loads.
- `functions/test/governedOwnershipWriterCensus.test.mjs` + `docs/security/ownership-accountability-bypass-census.md`
  row 12a: `crmCutoverSnapshot.ts` classified INERT.
- PostgreSQL copy/verify suite: after #1912 (§3.4).

---

## 9. Unresolved facts and Owner decisions

- **E — Free-text billing addresses.** Default in this plan: resolve at the source before the freeze (copy blocked).
  Alternative requiring Owner approval: copy the Account with NULL billing columns and a governed, non-authoritative
  staging record that refuses authoritative execution of the field until resolved.
- **E — Data Import customers after cutover.** The customer contract carries no owner and a free-text billing address;
  the PostgreSQL authority refuses both. Freeze customer import, or extend the contract with an explicit Employee owner
  and structured address.
- **E — Legacy shapes with no target:** Contact `title` (map to `contact_role`?), Contact `locationId`, scalar
  `lineOfBusiness` (promote to a singleton set?), Account `city/state/addressLine1/phone/website`. Currently blockers.
- **E — Ownerless legacy Contacts/sites:** carried OWNERLESS (no migration-time inheritance). Confirm, or authorize a
  documented inheritance transform with evidence.
- **E — Declared synthetic nonprod seed rows** already in `eos_crm` for `taylor-nonprod`: allow them to coexist with the
  copy (reported separately), or remove them first.
- **E — Freeze window** between step 3 and step 11, and **contact CSV import atomicity** (one batch today; per-row
  idempotent creates on PostgreSQL).
- **Unresolved — live data shape.** Sandbox counts, blockers, timestamp drift and owner resolution are unmeasured until
  an authorized export + census. **Production tenancy** has no PostgreSQL tenant.
- **Unresolved — migration id.** The coordinator's brief names `1759708800000_crm-account-business-facts-and-receipts.sql`;
  #1912 at `f5147d7e` carries `1759795200000_…` (its header says "MIGRATION 026"). The integration uses whatever lands.
