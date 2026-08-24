# Customers / Accounts — Structured List + Related-Field Projection

**First object migration after the metadata convergence, 2026-08-24.** Built on ADR-013; the Account
authority trace it relies on was completed in #1446 and is not repeated here.

---

## A — Account metadata

One definition, extended: `src/metadata/definitions/account.js`. No `domain/accountFields`, no
Account-specific filter or sort registry.

**Business identity is the NAME.** There is no account reference number.

> **ACCOUNT NUMBER NOT AUTHORITATIVE** — `customerNumber` / `erpId` / `accountingId` / `legacyId`
> exist and are, per `domain/accounts.js`, *"reserved for future integrations only"*: unvalidated,
> not unique, populated with whatever a user types. None is a default column, and a test asserts it.

A record with no name reads as an absence. It never falls back to the document id.

### Fields added by this migration

| field | why it was added |
|---|---|
| `lineOfBusiness` | **`AccountDetail` has rendered `account.lineOfBusiness` since the LOB wireframe shipped, and the definition did not declare it** — metadata describing *less* than the document holds |
| `nameLower` | declared because a query actually uses it. `displayable: false` — showing it beside `name` would put the same value on screen twice, once in the wrong case |
| `createdAt` | the list shows it; it was undeclared |

### Status

`ACTIVE` · `INACTIVE` · `PROSPECT` · `ARCHIVED`, labelled from `domain/constants.js`.

**Prospect is a STATUS.** Not a type, not a collection — there is no second Customer identity model
to avoid creating, because the distinction is already a field.

> **ACCOUNT_STATUS_LIFECYCLE_ORDER_NOT_EXECUTABLE**
>
> Firestore orders by the **stored string**. Status has a real business sequence and no ordinal is
> stored, so the sequence cannot be executed. A status sort **groups** — every ACTIVE together — and
> that is genuinely useful. The control therefore reads **"Status — grouped A to Z"**. "First to
> last" would read as the lifecycle and deliver the alphabet.

### The two arrays

`relationshipTypes` (`CUSTOMER` | `VENDOR`) and `lineOfBusiness` (`TAYLOR` | `VENTANA`). Both
multi-valued, both informational, **"both" is a first-class value** in each.

Line of Business is a *fourth distinct concept*: **not** `operatingCompanyId` (whose books a
transaction lands in), **not** `salesChannel` (retail vs national account), **not** the
manufacturer's line. Nothing infers it from any of them, or from the account's name.

**Neither is sortable.** Sorting rows by an array field orders them by whatever the first element
does, which is not a business ordering of anything — and alphabetising the array's *contents* and
calling the list "sorted by Relationship" would be worse: it looks sorted and means nothing.

### Owner

`accountOwner` is a seven-field Person Assignment map; only `assignedToEmployeeId` is declared.

The stored `assignedToDisplayName` is **deliberately ignored** in favour of the current directory
name, matching `AccountDetail`. A person who changed their name — or a record written before they
did — would otherwise be shown as somebody who no longer exists.

Not sortable (`NOT_PROJECTED`): the name lives on the employee document, and a sort has to happen
inside the query that chooses the rows.

### Gaps registered (8)

`ACCOUNT_MULTI_ARRAY_FILTER_GAP` · `ACCOUNT_STATUS_LIFECYCLE_ORDER_NOT_EXECUTABLE` ·
`ACCOUNT_CITY_STATE_NOT_PROJECTED` · `ACCOUNT_PRIMARY_LOCATION_NOT_MODELLED` ·
`ACCOUNT_INSTALLED_BASE_ROLLUP_GAP` · `ACCOUNT_SERVICE_ROLLUP_GAP` · `ACCOUNT_CONTACT_ROLLUP_GAP` ·
`ACCOUNT_FINANCIAL_METRICS_ABSENT`

**City and State are not Account fields.** They live on `locations`, and:

> **ACCOUNT_PRIMARY_LOCATION_NOT_MODELLED** — `account.locations` is a plain ONE_TO_MANY. Nothing
> marks one as primary and no write path sets one. **A customer with three sites does not have one
> obvious city merely because a list wants a column**, and whichever site happened to be created
> first is not an answer. The domain question comes first: is a primary location a billing address,
> a headquarters, or the site that gets service most often? Those are three different fields.

**Contacts:** `billingContactId` is a *billing* role. Promoting it to "the" primary contact was
refused — who to invoice and who to call are different questions.

**Financial:** the Account carries commercial **process** metadata (payment terms, tax status,
invoice delivery, an ISO currency *code*) and no monetary value of any kind. Pipeline, Revenue,
Margin and Sales-to-goal do not appear, and are not derived by summing related records per row.

---

## B — Query contract

| | |
|---|---|
| **Filters** | Status (`EQUALS`/`IN`), Relationship (`array-contains`), **Line of Business** (`array-contains`) |
| **Sorts** | Customer (via `nameLower`), Status (grouped), Created, Last update |
| **Default sort** | `updatedAt DESC` — **preserved**, with its existing reason: name-ascending makes page one a permanent property of the alphabet |
| **Paging** | bounded, cursor-only, `pageSize` 50, `limit` 51 (the +1 truncation probe) |
| **Search** | prefix on `nameLower`, unchanged. The copy says "starts with" because that is what it can serve |
| **URL state** | filters · sort · search. Cursor deliberately excluded |
| **Index coverage** | **32/32 demands declared**, `--check` green |

### The two-array limit — the hard part

Firestore permits **one** array-contains-family constraint per query, and **no index can change
that**. `requiredIndexes()` already knew: it emits one index *family* per array filter rather than
combining them.

**The runtime did not.** A request naming both produced a descriptor that looked fine and would have
failed at read time — the same class of defect as the retired Parts tie-break. So
`MULTIPLE_ARRAY_FILTERS` was added to `listRuntime`, and the request is refused **at the plan**.

Refused **whole**, never partially:

- applying one and dropping the other returns a broader set than was asked for, labelled as though
  both had been applied
- silently preferring whichever came first is the same failure with less traceability

The five index families this list demands contain **no** relationshipTypes + lineOfBusiness entry,
and a test asserts that absence directly.

### Two different failures, two different messages

A **dropped** criterion leaves a list that renders and is *broader* than requested. A **refused**
request runs no query at all, so the screen is *empty* — and telling somebody looking at an empty
screen that it is "broader than requested" describes the opposite of what is in front of them.

`describeRefusal` therefore says what happened, why, and what to do:

> These criteria cannot be applied together, so no customers are shown. Only one of these can be
> used at a time, because each matches a list of values rather than a single one. Remove one of them
> to see results.

**In business language.** The runtime's own message — *"Firestore allows one array filter per query;
this asks for 2 (lineOfBusiness, relationshipTypes)"* — is true, is right for whoever is debugging a
definition, and names the database, the field ids and an index concept. None of that belongs in
front of a person choosing customers. Unknown error kinds still fall through to the technical
message, because an unexplained refusal is worse than an awkwardly worded one.

---

## C — UX

Desktop columns: `Customer · Status · Relationship · Line of Business · Owner · Tags · Created ·
Last update`. Arrays render every member as a label — an `ENUM_SET` rendered raw prints
`TAYLORVENTANA`.

**Phone: structured cards.** The shared `MetadataListGrid` already carries `fo-table--stack`, which
recomposes each row into a labelled card below the phone breakpoint, with `data-label` carrying the
column heading to each value. Measured at 320px:

```
Customer          Harbor Grill Restaurant Group
Status            Active
Relationship      Customer
Line of Business  Taylor, Ventana
Owner             Freya Vance
Tags              key account
Created           Aug 12, 2025
Last update       Aug 23, 2025
```

Never `Harbor Grill · Active · Customer · Taylor · Freya`. A responsive layout may rearrange fields;
it may not destroy field semantics.

**This is the fix for the Parts readability finding**, which the canonical grid already had and the
Parts table did not.

### What the screen no longer decides

A screen-local relationship chip group was removed. It offered exactly one field, hard-coded, and
could never have offered Line of Business without somebody editing that file. The canonical control
offers whatever the definition declares and its composite indexes prove.

**The portfolio cards now drive the same criteria** the chips do, so the two cannot disagree about
what is applied. They remain **whole-book** claims from the server-side summary — deriving them from
the page would produce numbers smaller than the truth while still labelled "Total". An unavailable
count shows `—`, never `0`: *"0 Active" is a claim about the business; "—" is a claim about the
read.*

### Two defects found while migrating

**1. The silent-truncation warning had never rendered.** The guard read
`presentation.page.rows`, and `buildListPresentation` returns `{ state, columns, rows, hasMore }`
with no `page` key at all — so the whole condition short-circuited on `undefined`. A safeguard
against silent truncation that is itself silent is the worst of both. It now reads
`presentation.state` / `presentation.rows` and fires: *"Showing 1 of 103 customers. The rest are
missing the 'last update' value this list is sorted by."*

**2. List dates showed full timestamps.** `8/12/2025, 5:00:00 AM` in a column, and a whole line of a
phone card spent on seconds nobody reads. `formatDateOnly` was added and the shared cell renderer
uses it: a list answers *when, roughly*; the record answers *exactly when*.

### Navigation

`Back to Customers` routes through `objectListPathWithState(OBJECT_LIST_KEY.CUSTOMERS, …)` — the
canonical helper plus the remembered criteria — so it means Customers whether the record was opened
from the list, a dashboard tile or a pasted link, and lands on the list the person was actually
using. Not browser history, not a hardcoded path.

### Prospect reachability

Creating a customer while filtered to a status that excludes it **clears that filter**, so a new
Prospect is never immediately contradicted by an empty table. Create / update / Rules validation /
the admin-only `paymentTerms`+`taxStatus` boundary / `delete: false` are all untouched.

---

## D — Related-field projection

**The pattern already existed and is preserved**, not reinvented:

```
parent document stores accountId / customerId
  → the loaded page collects the ids
  → ONE chunked documentId()-in read (useAccountReferenceResolver)
  → id → human identity
  → FOUND / NOT_FOUND / DENIED / LOADING / ERROR, each said differently
```

Owner resolution on this list follows the same rule with the employee directory: **one subscription
for the whole page**, so adding an Owner column costs no reads per record. A loading directory says
*Loading*, not *no longer exists* — "not yet arrived" and "does not exist" are different facts about
an owner, and only one of them is alarming.

> **CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS** — unchanged, and deliberately **not** solved here.
>
> The batched resolver resolves names for the rows **already fetched**: correct for display, useless
> for a sort that must happen inside the query choosing the rows. Paging by id, resolving names, and
> labelling the result "Customer A → Z" is a false global sort.
>
> **Future design boundary, for approval before implementation:** a maintained `customerNameLower`
> on each operational document, written by that object's canonical writer, plus a governed Account
> **rename-propagation authority**. That design must address rename, consistency, idempotency,
> fan-out, failure and retry, audit, and backfill of existing records. `accounts.nameLower` needs
> none of that because it derives from the document it lives on; a copy on another document does.

---

## E — Performance and reporting

| | |
|---|---|
| initial list requests | **1** bounded page read (limit 51) |
| portfolio summary | **1** server-side callable, whole-book |
| owner resolution | **1** directory subscription for the page — **no N+1** |
| account reference resolution | already batched, unchanged |
| filter / sort | criteria change the same single query; no extra request |
| bundle | no change (`599.93 kB` entry, unchanged from ADR-013) |

**Reporting dimensions** (proven only): Account Name · Status · Relationship · Line of Business ·
Created · Last update · Owner. City/State blocked pending the primary-location decision. Financial
metrics absent. `nameLower` is non-reportable and non-exportable — it is a sort key, not a value.

**Export:** human values, no ids; blocked fields are non-exportable by validator rule.

---

## F — Tests

**30 new proofs** in `test/accountsStructuredList.test.jsx`, weighted at the array limit: each filter
alone executes, both together produce **no descriptor at all**, neither is silently preferred, and
status + one array is fine because the limit is on arrays rather than on filters. Plus: preserved
portfolio-card semantics, the now-live truncation warning, prospect reachability, human owner names,
loading-vs-missing, and the phone-card structure.

**4 new proofs** on the raw-id guard for Account paths, including the assertion that no reserved
identifier is a default column.

Gates: node **229/229** · client **1,882** · lint 0 errors · typecheck clean · build ok · index
coverage **32/32**.

Backend untouched: no functions, no `firestore.rules`, no capability, no role. Two composite index
**declarations** were added to `firestore.indexes.json`; deploying them remains an operator action.

---

## Next

`PARTSLIST / INVENTORY HEALTH — SCALE + PAGING` (queued, unchanged), then Transfers, Opportunities,
Invoices, Employees/Technicians, and the remaining object lists.
