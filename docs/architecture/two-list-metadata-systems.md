# Two list-metadata systems, and which one should own object lists

**Analysis, 2026-08-24. Produced by the Customers / Accounts authority trace, before any code was
written for that package.** This is a blocking architectural finding, not a proposal to implement.

---

## What the trace found

The Customers / Accounts package asked me to *"create the governed Customer/Account display
projection that can be reused across EOS"*, *"establish the reusable related-field projection
pattern"*, and *"mount shared Add Filter in the actual Account list"* with *"no Account-specific filter
registry"*.

**All three already exist**, built to the same standard and to largely the same principles — in a
system my last three packages did not touch and did not discover.

### System 1 — `src/metadata/` (the incumbent)

| | |
|---|---|
| Entity definitions | **30**, incl. account, workOrder, salesOrder, equipment, opportunity, part, purchaseOrder, location, contact, employee, invoice, supplier |
| Screens mounted | **10** — AccountsList, AccountDetail, SalesOrdersList, SalesWorkspace, **PartsList**, EmployeesList, CustomerEquipment, Manufacturers, Warehouses, Suppliers |
| Runtime | `listRuntime` · `listPresentation` · `listViewDefinition` · `entityDefinition` · `firestoreListSource` / `callableListSource` · `MetadataListGrid` · `MetadataRecordPage` |
| Paging | bounded, cursor-paged |
| Index honesty | **CI-enforced.** `scripts/listIndexCoverage.mjs` fails the build when a declared filter has no declared composite index |
| Reference resolution | `referenceResolution.js` — `FOUND / NOT_FOUND / DENIED / LOADING / ERROR / LEGACY_UNSUPPORTED / UNRESOLVED`, and DENIED deliberately leaks neither name nor id |
| N+1 | solved. `useAccountReferenceResolver` collects ids from the loaded page and resolves them in **one chunked `documentId() in` read** |
| Raw ids | `cellValue` refuses to print a document id for a REFERENCE column, resolver or not |

Its `account.js` even carries the finding this package would otherwise have had to make:

> *"There is no reference number for an Account, and declaring one that does not exist would license a
> surface to render a document id in its place."*

### System 2 — `src/domain/fieldMetadata.js` (the pilot, mine)

| | |
|---|---|
| Object contracts | 6 — workOrder, salesOrder, equipment, availableUnit, purchaseOrder, part |
| Screens mounted | **1** — `PartMasterList` |
| Runtime | `fieldMetadata` · `listQueryState` · `ListControls` |
| Index honesty | declared per field (`NEEDS_INDEX`, `NOT_PROJECTED`, …) but **not verified against `firestore.indexes.json`** |
| Reference resolution | declares `unresolvedText` per field; **no resolver, no batching, no states** |

---

## The honest accounting

I built System 2 across PRs #1442, #1443 and #1444 without finding System 1. Five of my six object
contracts (workOrder, salesOrder, equipment, purchaseOrder, part) **duplicate an entity definition that
already existed**, and the one list I actually mounted controls into now sits beside a second Parts
list on the other system:

```
/inventory              PartsList        → System 1  (metadata runtime)
/inventory/part-master  PartMasterList   → System 2  (pilot contract)
```

Two Parts lists, two list systems, one object. That is a direct consequence of my work, and I would
rather name it than let the next package inherit it.

Mounting the pilot's `AddFilter` onto `AccountsList` — which the package asks for — would put **two
filter systems on one screen**, which is exactly what that package's own "no second registry" rule
forbids. So the instruction cannot be followed as written without violating its own principle.

---

## What each system has that the other does not

**System 1 only:**
- CI-enforced index coverage — the difference between *claiming* a filter is server-executable and
  *proving* it
- batched reference resolution with distinct states, already wired on real screens
- 30 definitions vs 6, and 10 mounted screens vs 1
- saved views, board scope, a record-page runtime

**System 2 only:**
- **URL-backed list state.** The metadata runtime has none — no `useSearchParams` anywhere in
  `src/metadata/`. Filters and sort do not survive opening a record and coming back, and a narrowed
  list cannot be shared or bookmarked. This is a real gap and the package asks for it explicitly.
- **Named reasons for unsupported.** `NOT_PROJECTED` / `DERIVED_AT_READ` / `NO_CANONICAL_ORDER` /
  `NEEDS_INDEX` / `NO_AUTHORITY` — System 1 omits an operator when it cannot serve one, but does not
  say *why*, so a person cannot tell "not built yet" from "cannot be built".
- **The gap register.** `PART_FIELD_GAPS`, `PO_FIELD_GAPS` — refusals recorded as data with what was
  refused and why, rather than as comments.
- **Dropped-criteria reporting.** A stale URL that asks for something unqueryable says so instead of
  rendering an unnarrowed list that looks narrowed.
- **Structured absence** — `ABSENCE.NOT_RECORDED / NOT_AUTHORIZED / UNRESOLVED`, and the
  unknown ≠ zero / zero ≠ absence discipline for money and quantities.

---

## Recommendation

**Converge on System 1. Fold System 2's five distinct ideas into it. Retire the duplicate contracts.**

System 1 is more complete, more widely mounted, and — decisively — it is the one whose filter promises
are *verified against real indexes in CI*. That is not a feature System 2 can catch up on cheaply; it
is the thing that makes "declared filters are promises" true rather than aspirational.

System 2's contributions are real but are each a **feature**, not an architecture. All five can be
added to System 1 without changing how any of its 10 screens work.

Suggested sequence, each a package:

1. **URL-backed list state in the metadata runtime** — smallest, highest daily value, unblocks the
   Back-navigation requirement the Accounts package asks for.
2. **Unsupported reasons + gap register** on `makeFieldDefinition` — the honesty rule, in the system
   that can actually verify half of it against `firestore.indexes.json`.
3. **Accounts structured list** on System 1, using 1 and 2. The related-field projection pattern is
   then *documented and extended* rather than re-invented.
4. **Retire the duplicate contracts** in `src/domain/objectFields.js` / `purchaseOrderFields.js` /
   `partFields.js`, and converge the two Parts lists.

### The alternative, stated fairly

Building Accounts on System 2 is possible. It would mean a second Account definition beside the
existing one, a second filter system on `/customers`, and no index verification for the filters it
declares. I do not recommend it, and I would want that decision made explicitly rather than arrived at
by me continuing.

---

## What the Customers / Accounts trace established regardless

These hold under either decision.

**Collection** `accounts`, `readVia: CLIENT_DIRECT`, Rules `read: isAdminOrDispatcher()`,
`create/update: isAdminOrDispatcher()` with two admin-only governed fields (`paymentTerms`,
`taxStatus`) validated in Rules, `delete: false`.

**Business identity is the NAME.** There is no account reference number. `customerNumber`, `erpId`,
`accountingId`, `legacyId` exist but are, per `domain/accounts.js`, *"reserved for future integrations
only"* — unvalidated, not unique, populated only with whatever a user types. **`Account Number` is
therefore NOT authoritative** and must not become a business-identity column.

> **ACCOUNT NUMBER NOT AUTHORITATIVE**

**Prospect is a STATUS, not a type and not a separate collection.**
`ACCOUNT_STATUS = ACTIVE | INACTIVE | PROSPECT | ARCHIVED`. There is no second Customer identity model
to avoid creating — the distinction is already a field.

**"Account Type" is `relationshipTypes: string[]`** (`CUSTOMER | VENDOR`) — multi-valued, informational
only, gates no authorization. An account can be both.

**"Business Line" is `lineOfBusiness: string[]`** (`TAYLOR | VENTANA`) — also multi-valued, "both" is a
first-class value, and it is deliberately a *fourth distinct concept*: **not** `operatingCompanyId`
(whose books a transaction lands in) and **not** `salesChannel` (retail vs national account, per
order).

Both being **arrays** is load-bearing: Firestore permits **one array filter per query** and **cannot
sort by an array field**. So `Business Line` and `Account Type` are filterable by `array-contains`
and are **never sortable**, and offering both filters at once promises an intersection no index serves.

**City / State are not on the Account.** They live on `locations` (`addressCity`, `addressState`,
`accountId`). A City column on the Account list is a cross-collection question, not a field.

**Owner** is `accountOwner`, a seven-field Person Assignment map. Only
`accountOwner.assignedToEmployeeId` is declared, and `AccountDetail` deliberately re-resolves the
*current* display name from the employee directory rather than trusting the stored
`assignedToDisplayName` snapshot. The name is on the employee document, so **Owner is not sortable**
without a projection.

### Customer Name sorting — the load-bearing question, answered

`accounts.nameLower` is a **maintained denormalized field**, derived inside `createAccount` /
`updateAccount` so a caller cannot forget it, and asserted by `accountWriteContract.test.mjs`. It is
what makes the Account list itself case-insensitively searchable and sortable by name.

**But no related object carries a customer name at all.** `workOrder.customerId` and
`salesOrder.accountId` are references, and the name lives only on the Account. The batched resolver
resolves names **for the rows already fetched** — which is correct for *display* and useless for
*sorting*, because the sort has to happen inside the query that chooses which rows to fetch.

> **CUSTOMER NAME NOT SORTABLE ON RELATED LISTS**
>
> Sorting Work Orders or Sales Orders by customer name requires a denormalized
> `customerNameLower` **on the Work Order / Sales Order document**, maintained by the same writer
> discipline `accounts.nameLower` already proves works — plus a rename-propagation authority, which
> `nameLower` does not need because it is derived from the same document it lives on.
>
> Refused: fetching an unbounded page and sorting by names resolved afterwards. That sorts the page,
> not the list, and the result is labelled as though it sorted the list.

The maintenance authority is the open question a projection package must answer: a customer rename
must reach every denormalized copy, and today nothing owns that.

---

## Status

**CUSTOMERS / ACCOUNTS — BLOCKED on a material architecture decision.**

Not blocked on effort or on unknowns: the authority trace is complete and above. Blocked because
building the list requires first choosing which metadata system owns object lists, and that choice has
repo-wide consequences that are not mine to make.
