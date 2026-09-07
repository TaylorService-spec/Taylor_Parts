# Three Capability Parity Proposals

**PROPOSAL ONLY. Nothing here is implemented.** No capability is minted, no Role is edited, no
`permissionCatalog.ts` or `compatibilityRoles.ts` line is changed by this document. It exists so an
authorization-definition decision can be made from measured facts rather than from a migration's
convenience.

Three surfaces are blocked on a capability that does not exist. Each is otherwise ready: the
trusted-command and governed-read shapes are established and the code pattern is mechanical. What
is missing is the authority definition, which is not the migration's to decide.

---

## The mechanism that makes "parity" measurable here

Two facts about how Roles acquire capabilities, both read from the constructed Role objects the
resolver itself reads — not grepped from the Role source files, because some permission lists are
built by derivation and the literal arrays understate the real population:

```
compatibilityRoles.ts:  ADMIN_ALL_PERMISSIONS = [...ADMIN_CURATED, ...PERMISSION_CATALOG.map(p => p.id)]
governedBusinessRoles.ts: OWNER_PERMISSIONS   = [...ADMIN_ROLE.permissions, ...OWNER_ACTIVE_REPORT_PERMISSIONS]
```

**Any capability added to the catalog is held by `admin` and `owner` automatically.** Neither Role
is edited to grant one; they derive the whole catalog. Only `dispatcher` — whose list is explicit —
needs a line added.

This matters for reading every table below: "proposed grants" names the one Role that changes, and
the derived pair is stated rather than left implicit.

### The precedent, on the same collection

The contacts **read** Rule was `allow read: if isAdminOrDispatcher()` — the identical predicate to
the two blocked read surfaces and to the contacts write. It has already been migrated, to
`crm.contact.read`. Asked of the resolver, its holders are exactly:

```
crm.contact.read  =>  admin, dispatcher, owner
```

That is not a coincidence to be reproduced by intuition; it is the ratified answer for this exact
predicate, and each proposal below copies it rather than inventing a population.

### One honest discrepancy, stated once

`isAdminOrDispatcher()` admits `users/{uid}.role in {admin, dispatcher}`. It does **not** admit
`owner`. So every proposal below is, strictly, `admitted population + owner`.

That widening is structural rather than chosen: `owner` derives the entire catalog, so it holds
every already-migrated capability including `crm.contact.read` on this same collection. There is no
version of any of these proposals that excludes `owner` without changing how `OWNER_PERMISSIONS` is
built, which would be a far larger decision than the three below. Recorded as a real difference, not
smoothed over.

---

## 1. `contactImport` — Contact write authority

| | |
|---|---|
| **CURRENT FIREBASE AUTHORITY** | `match /contacts/{contactId} { allow create, update: if isAdminOrDispatcher(); allow delete: if false; }` — i.e. `users/{uid}.role in {admin, dispatcher}`. The legacy identity role, not a governed EOS Role. |
| **CURRENT EOS CAPABILITY** | **None.** `permissionCatalog.ts` declares `crm.contact.read` against resource `contact.record` and no write capability of any action for that resource. |
| **PROPOSED CAPABILITY** | `crm.contact.create` — "Create Contact records. Confers no update, no delete, and no read." Resource `contact.record`, action `create`. |
| **PROPOSED GRANTS** | `dispatcher` (explicit line). `admin` and `owner` acquire it by derivation, no edit. |
| **PARITY** | Proposed population = {admin, dispatcher, owner}. Admitted population = {admin, dispatcher}. Identical apart from the structural `owner` derivation noted above, and identical to `crm.contact.read`'s measured holders on this same collection under this same predicate. |
| **SCOPE** | **Global.** The current Rule has no account scope, no company scope and no record scope — a dispatcher may create a contact under any account. Proposing anything narrower would NARROW access, which this migration is not permitted to do. If contact creation should be account-scoped, that is a separate decision to make deliberately, not as a side effect of a transport change. |
| **WHY NO EXISTING CAPABILITY** | `crm.contact.read` is a read and explicitly "confers no write". `customer.record.create` is the **Account** object, a different resource, and its 8 holders are a materially wider population. Reusing either would misstate what the caller is authorized to do. |

**Note on `create` vs a broader `write`.** The proposal is deliberately `create` only. The import
writes new contact rows and nothing else. A `crm.contact.write` covering update would grant the
import path an authority it does not use, and the Rule's own `allow delete: if false` shows the
surface was already split by action.

---

## 2. `supplier` — Supplier list read authority

| | |
|---|---|
| **CURRENT FIREBASE AUTHORITY** | `match /suppliers/{supplierId} { allow read: if isAdminOrDispatcher(); allow create, update, delete: if false; }` |
| **CURRENT EOS CAPABILITY** | **None.** No `supplier.*` capability of any kind exists in the catalog. |
| **PROPOSED CAPABILITY** | `supplier.record.read` — "Read Supplier records. Confers no write." Resource `supplier.record`, action `read`. |
| **PROPOSED GRANTS** | `dispatcher` (explicit). `admin`, `owner` derived. |
| **PARITY** | {admin, dispatcher, owner} vs admitted {admin, dispatcher} — same structural `owner` note. Matches `crm.contact.read`'s holders, migrated from the identical predicate. |
| **SCOPE** | **Global.** The Rule is unscoped; suppliers are not partitioned by operating company in the current data model, and inventing a company scope here would narrow access on an unproven assumption. |
| **WHY NO EXISTING CAPABILITY** | The nearest candidate is `inventory.catalog.read`, and it is the wrong answer twice over: a Supplier is not a Part, and its measured holder count is **18** against the Rule's admitted 2. Reusing it to finish the migration would widen supplier visibility to fifteen additional Roles as an implementation detail — the exact "broader generic capability just to finish the migration" that must not happen. |

---

## 3. `supplierCatalogItem` — Supplier catalog read authority

| | |
|---|---|
| **CURRENT FIREBASE AUTHORITY** | `match /supplier_catalog/{catalogItemId} { allow read: if isAdminOrDispatcher(); allow create, update, delete: if false; }` |
| **CURRENT EOS CAPABILITY** | **None.** |
| **PROPOSED CAPABILITY** | `supplier.catalog.read` — "Read Supplier catalog items: the parts a supplier offers and the price at which they offer them. Confers no write and no Part Master authority." Resource `supplier.catalog`, action `read`. |
| **PROPOSED GRANTS** | `dispatcher` (explicit). `admin`, `owner` derived. |
| **PARITY** | Identical to the two above. |
| **SCOPE** | **Global**, matching the unscoped Rule. |
| **WHY NO EXISTING CAPABILITY** | Same as `supplier` — `inventory.catalog.read` is a different resource with a 9× wider population. It is also **not** simply `supplier.record.read`: a catalog item carries `unitPrice`, which is commercial terms rather than supplier identity. Proposed as a second capability so that "may see who we buy from" and "may see what we pay" stay separable, which a single merged capability would foreclose. |

**This one carries a real open question.** Whether supplier pricing should share a population with
supplier identity is a commercial-confidentiality judgement, not a migration detail. The proposal
keeps them separate so the decision remains available; if the answer is that they are the same
thing, one capability serves both and this table collapses into the previous one.

---

## What is NOT proposed

- **No `supplier.*` write capability.** The Rule denies all supplier writes unconditionally. There
  is no admitted write population to preserve.
- **No `crm.contact.update` or `crm.contact.delete`.** Update is admitted by the current Rule but
  no blocked surface needs it; delete is denied outright. Minting capabilities nothing calls would
  create unexercised authority.
- **No generic `supplier.read` covering both collections.** See proposal 3.
- **No change to how `ADMIN_ALL_PERMISSIONS` or `OWNER_PERMISSIONS` derive.** The `owner`
  discrepancy is recorded, not fixed here.

## If approved

Each is a small, mechanical change: one `permissionCatalog.ts` entry, one `dispatcher` line, the
governed source or trusted command, and the drift artifacts. The blocked surfaces then close and
`firestoreListSource.js` loses its last callers.

## Related

- `docs/governance/workflow-action-census.md` — the blocked table these expand on.
- `docs/governance/metadata-governed-read-migration.md` — the read surfaces.
