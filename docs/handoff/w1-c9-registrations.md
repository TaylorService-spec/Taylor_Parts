# W1-C9 — registrations this lane could not make itself

Lane C9 owns **Account**, **Contact** and the CRM customer-site **Location**. It added migration
`1758758400000_crm-account-contact-location.sql` (the `eos_crm` schema), the domain/repository/
reconciliation modules under `functions/src/crm/`, and two test suites.

Several files are **shared across the twelve concurrent Wave-1 lanes and were deliberately not
edited**. Everything this lane needs from them is recorded here instead.

---

## 1. `functions/package.json` — test script registration (REQUIRED)

Two suites exist and are **not reachable from any npm script**. They must be registered:

| suite | belongs in | why |
|---|---|---|
| `test/crmCustomerNamespace.test.mjs` | `test:adminPolicy` | offline: SQL text, domain module, reconciliation. No database. |
| `test/crmCustomerPostgres.test.mjs` | `test:adminPolicyPostgres` | real `postgres:16`; skips cleanly when `POLICY_TEST_DATABASE_URL` is unset. |

Proposed edits:

```jsonc
// append to "test:adminPolicy"
" test/crmCustomerNamespace.test.mjs"

// append to "test:adminPolicyPostgres"
" test/crmCustomerPostgres.test.mjs"
```

### Note on the resetter guard

`test/adminPolicyPostgres.test.mjs`'s `"every suite that resets the schema is covered by that one
command"` scans every `test/*.test.mjs` for the literal `DROP SCHEMA` and requires each match to
appear in `test:adminPolicyPostgres`. **Neither new suite contains that string, and neither resets a
schema** — `crmCustomerPostgres.test.mjs` runs `migrate up` (a no-op when already current), works
only on the tenants `crm-tenant-a` / `crm-tenant-b`, and deletes only its own rows. It therefore
cannot drop a sibling suite's schema mid-transaction, which is the race that rule exists to stop.
Registering it in the serialized command is still the right thing to do — it shares one database
with the resetters and should not run beside them.

---

## 2. `.github/workflows/eos-admin-policy-tests.yml` — path triggers (REQUIRED)

The workflow's two `paths:` blocks list the files that trigger it. Add:

```yaml
      - 'functions/migrations/1758758400000_crm-account-contact-location.sql'
      - 'functions/src/crm/**'
      - 'functions/test/crmCustomerNamespace.test.mjs'
      - 'functions/test/crmCustomerPostgres.test.mjs'
```

Without this, a change to the CRM schema does not run the suite that proves it.

---

## 3. `field-ops-app-vite/src/metadata/entityRegistry.js` — no change requested

`account`, `contact` and `location` are already registered and already seeded into
`eos_policy.objects` (`functions/src/adminPolicy/seed/policySeedCoverage.json` lists all three as
`SEEDED`, `objectSource: MATRIX_AND_REGISTRY`). This lane changed no client metadata and needs no
registry entry.

**One drift worth a follow-up, recorded not fixed:** `policySeedSnapshot.json` declares the
`location` Object's address fields as `addressStreet` / `addressCity` / `addressState` /
`addressZip`, while `field-ops-app-vite/src/domain/locations.js:5-6` stores a nested
`address: { street, city, state, zip }` and the live census observed flat `addressLine1` / `city` /
`state` on stored documents. Migration 008's `account_locations` flattens all three shapes onto
`address_street` / `address_city` / `address_state` / `address_postal_code`, and
`reconcileCustomerMigrationSource` reports which source shape each document used and BLOCKS when a
document carries two that disagree. Aligning the Admin→Objects field keys to the canonical columns
is an Admin-metadata change, not a schema one, and belongs to whoever owns that seed.

---

## 4. `field-ops-app-vite/src/access/objectPermissionMap.js` — no change made, one gap recorded

Read-only for this lane. Current entries (`:34-37`):

```js
{ object: "Accounts", domain: "CRM", C: ["customer.record.create"], R: ["customer.record.read"],
  E: ["customer.record.update", "customer.governedField.write"], D: [] },
{ object: "Contacts", domain: "CRM", rulesOnly: "contacts", C: [], R: [], E: [], D: [] },
{ object: "Customer Locations", domain: "CRM", rulesOnly: "locations", C: [], R: [], E: [], D: [] },
```

**Contact and Customer Location are `rulesOnly` — governed by Firestore role checks with no catalog
capability at all**, and `firestore.rules:1341-1345` validates literally nothing on `locations`.
When the governed CRM command surface is wired (it is not wired here — see below), Contact and
Customer Location will each need real capabilities in
`functions/src/access/permissionCatalog.ts` and this map. Proposed, for whoever authorizes them:

| object | C | R | E | D |
|---|---|---|---|---|
| Contacts | `customer.contact.create` | `customer.contact.read` | `customer.contact.update` | — (`supportsDelete: false`) |
| Customer Locations | `customer.location.create` | `customer.location.read` | `customer.location.update` | — (`supportsDelete: false`) |

These are **proposals, not additions**. Nothing in this lane grants, activates or depends on them.

---

## 5. `functions/src/eosApi/server.ts` / the closed operation lists — deliberately not touched

`functions/src/crm/customerRepository.ts` is a repository contract, not an API. It is not reachable
from `ADMIN_READ_OPERATIONS` / `ADMIN_MUTATION_OPERATIONS`
(`functions/src/adminPolicy/adminPolicyApi.ts`) or from `OPERATIONS_READ_OPERATIONS`
(`functions/src/eosOps/eosOpsHttp.ts`), and no route was added. That is the same posture migration
005's `cycleCountRepository.ts` took, and the reason is the same: wiring a customer-mutating command
end to end means granting capabilities and cutting a client over, and neither is authorized here.

When it is wired, the Customer domain should get its **own** closed operation list in its own
transport module — a third domain list beside Administration's and Operations' — rather than
entries appended to either, for the reason `eosOpsHttp.ts`'s header already gives.

---

## 6. Sibling test files this lane did have to edit, and why

Adding an eighth migration invalidates assertions that were written when there were seven. These
were corrected in place rather than left red, and every edit makes the assertion *count-independent*
so the ninth migration does not re-break it:

| file | change |
|---|---|
| `test/adminPolicyActivation.test.mjs`, `adminPolicySeed`, `adminPolicyPostgres`, `eosOpsPostgres`, `eosOpsOperatingCompanyCustodyPostgres`, `inventoryCapabilityGrantMigration` | their `reset()` now also drops `eos_crm` before re-migrating. A surviving third schema plus a dropped `pgmigrations` makes the next `up` re-run 008 against tables that still exist. |
| `test/eosOpsOperatingCompanyCustody.test.mjs` | `files.length === 7` / "007 sorts last" → "007 is the seventh by timestamp". |
| `test/adminPolicyPostgres.test.mjs` | `down "7"` → `down String(MIGRATION_COUNT)`, read from the migrations directory; the 007/006 reversal walk now steps past anything newer than 007 first. |
| `test/eosOpsOperatingCompanyCustodyPostgres.test.mjs` | `migrate(["down", "1"])` → `downThrough007()`. |

Sibling lanes adding their own migrations will hit the same assertions; these edits should resolve
their conflicts in favour of the count-independent form.

---

## 7. Not done, and deliberately

- **No production cutover, import, dual-write, freeze or deploy.** The Firestore `accounts`,
  `contacts` and `locations` collections remain authoritative. Nothing deployed reads or writes
  `eos_crm`.
- **No Firestore Rules change**, no new Firestore collection, no new Firebase callable, no new
  Firebase business-runtime dependency. `functions/src/crm/` imports `pg` and `node:crypto` only.
- **No Equipment table.** `account_locations` carries
  `UNIQUE (tenant_id, account_id, id)` so that lane C7 can express ADR-006 §2.1 ("Equipment belongs
  to one Account and one Location that must belong to the same Account") as a composite foreign key
  instead of the Rules `get()` that implements it today (`firestore.rules:1438-1443`). The key is
  here because this is the only table it *can* be declared on; the Equipment side is C7's.
- **`parentAccountId` (D-C1-3) and the merge/tombstone policy (D-C1-7) are not modelled.** Both are
  PROPOSED in `docs/architecture/customer-domain-foundation.md`, neither is stored today, and
  building either here would be schema ahead of a decision.
