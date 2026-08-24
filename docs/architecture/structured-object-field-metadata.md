# Structured Object UX + Field Metadata (Pilot)

**Owner-directed pilot, 2026-08-23.** Work Orders, Sales Orders, Equipment. The architecture is
proven on three objects and then stops — the migration pattern for the rest of the site is at the end.

---

## 1. The model

```
Object → Fields → Relationships → Derived Fields → Metrics
```

A business attribute stays independently addressable through storage, projection, read model, UI,
filter, sort, search, report, export and AI. Responsive design may rearrange fields; it may not
collapse them into a sentence, because concatenation is the one transformation no downstream consumer
can undo.

## 2. Field categories and types

| category | meaning |
|---|---|
| `OWNED` | native attribute of the object |
| `RELATED` | owned by another object, exposed through an explicitly approved relationship |
| `DERIVED` | calculated from authoritative facts; never a second source of truth |
| `FINANCIAL` | an authoritative financial value, with its own authority |

Types: `STRING · IDENTIFIER · ENUM · DATE · DATETIME · NUMBER · QUANTITY · CURRENCY · BOOLEAN ·
PERSON · OBJECT_REF · LOCATION · SERIAL`.

**Operators come from the TYPE, not the field.** A date behaves the same on every object. A field may
*narrow* its type's operators; it may never widen them, and `defineField` refuses a declaration that
tries — that is how one list ends up offering "contains" on a date.

## 3. The contract validates itself

`defineObjectFields` **throws at module load** on a bad declaration. Discovering a malformed field
contract when somebody opens a filter menu in production is far worse than a failed import.

Enforced:

- `filterable: false` / `sortable: false` **must state a reason**. Without this the metadata quietly
  becomes a list of things that mysteriously do not work.
- a `RELATED` field must name the object that owns it
- **an ENUM is sortable only with an explicit `statusOrder`** — alphabetical status order puts
  `CANCELLED` before `WORK_IN_PROGRESS` and calls it order

## 4. The honesty rule — what the query layer can actually do

`filterable` and `sortable` describe what is executable **at scale against the current data model**,
not what would be nice.

Firestore is not relational. The Work Order stores `customerId`, `locationId`, `assignedTechId` —
**ids, not values**. So:

| field | filter | sort | why |
|---|---|---|---|
| `status`, `type`, `priority`, dates | ✅ | ✅ (except type) | stored on the document |
| `technician.name` | ✅ | ❌ | the **id** is stored, so a name picker over an id query works; ordering by a name means ordering by a value this document does not hold |
| `customer.name`, `location.*`, `equipment.*` | ❌ | ❌ | `NOT_PROJECTED` |
| `partsReadiness` | ❌ | ❌ | `DERIVED_AT_READ` — nothing stored to order by |

`toQueryPlan` returns anything unqueryable as **`unsupported` with its reason**. It never degrades to
fetching the collection and filtering in the browser — the thing that passes a demo and dies on a real
customer's data. A page size is **always** applied.

**To make a related field queryable** the projection must exist first: denormalise the display value
onto the Work Order at write time (`customerName`, `locationCity`), or serve the list through a
trusted read that joins server-side. Both are real work with real trade-offs, and neither is faked here.

## 5. List state survives opening a record

Filters, sort and search serialize into the **URL** — survivable, shareable, bookmarkable, and
restored by a plain navigation.

A stale or hand-edited URL **degrades to an unfiltered list**, never a broken screen: a filter naming
a field this build no longer offers, an operator that field never allowed, or a sort on something
declared unsortable is dropped. Otherwise a pasted link could ask for a full-collection scan.

**Any criteria change resets the cursor.** Paging into a result set that no longer exists is how a
list shows the wrong records.

Relative ranges (`THIS_WEEK`) are stored as a **keyword**, resolved at query time — so a bookmarked
"this week" still means this week next month. A week starts Monday, because a service week is a
working week.

## 6. Back to Work Orders — the defect and the fix

`Back to Work Orders` navigated to **`/service/work-orders`**, which matches **no route**: the Work
Orders nav item declares `path: ""`, making it the **index of `/service`**. An unmatched path fell
through to the catch-all — the Dashboard. The label was telling the truth about intent; the code was
not, and nothing errored.

Fixed by **deriving** the path from the nav config (`objectListPath`), so a future nav move follows
automatically and an unknown key throws at the call site instead of routing somewhere plausible.

**Not browser history, deliberately.** History would send this control to the list when the record was
opened from the list, and somewhere arbitrary when it was opened from Dispatch, a dashboard tile or a
pasted link — one control meaning four different things. The saved list state (sessionStorage, because
a working list is a working-session fact) rides along, so filters and sort survive the round trip.

## 7. No Firestore ids — hard global rule

`FIRESTORE ID USER-VISIBLE = FALSE`. Every displayable reference field declares `unresolvedText`, and
the guard renders the real components and asserts on what appears.

**The guard is a render-path guard, not a regex ban.** The naive version greps source for id-like
strings, fails on every `accountId` in a query, and is disabled within a week. This one reads rendered
*values* — an id used to fetch is correct; an id shown to a person is the defect.

It carries a **mutation proof**: three cases deliberately render a raw reference as a normal label and
assert the guard fails. A fourth asserts it does **not** fire on `WO-2026-000123`, `CW-C161-0001`,
`TS-4410` or `TR-1042` — business identifiers people read aloud, which must pass.

### A superseded decision, recorded

`availableEquipmentLocationDisplay` previously asserted that an unresolvable location **keeps the raw
id**, judged more honest than fabricating a label. Given those two options it was. This standard adds
a third — an **absence** — and supersedes it: a raw key cannot be searched by the name a person knows,
cannot be read aloud, and teaches people to memorise internal identifiers. What those tests actually
protected (no fabricated label; a denied resolver never takes the tab down) is unchanged and still
asserted.

## 8. Pilot findings

### Work Orders
Six owned fields, seven related, one derived. Status sorts by **lifecycle**, reusing
`WORK_ORDER_STATUS_VALUES` rather than restating it — a second copy would drift, and then the list and
the workflow would disagree about what comes after what. `type` is filterable but **not** sortable: a
classification is not a sequence.

### Sales Orders — **Dollars is BLOCKED**

> **SALES ORDER TOTAL AUTHORITY GAP**

Traced before any of it was built:

- the Sales Order document carries **no** total, subtotal or amount
- `salesOrderReadService.projectLine` projects `lineId, kind, ref` and four **quantities** — no money
- `line.unitPrice` exists but is **optional** and documented in the command as *"NOT computed here"*;
  the read projection **strips it**, so the client cannot see it even where present
- authoritative money **does** exist — for **Invoices** (`invoiceCommands.ts`: `unitPriceMinor`,
  `lineTotalMinor`, `totalMinor`). An invoice is not its order, and an unbilled order would show nothing

Summing optional unit prices on the client is exactly the forbidden "parse UI line items", and would
put a number on screen no authority stands behind. The field is declared with
`displayable: false` so the requirement stays visible in the contract rather than being quietly
dropped, and `SALES_ORDER_DOLLARS_GAP` records the evidence.

**To unblock:** a Sales Order pricing authority, or an explicitly derived and stored order total with
stated semantics (tax/freight/discount in or out, currency, rounding). That is a Financial Architecture
decision, not a list decision.

### Equipment
Installed Equipment and uninstalled serialized stock get **separate field sets**. They share a serial
and a model and nothing else that matters — merging them makes "Customer" empty for half the rows with
no way to tell unassigned from uninstalled.

The Available Equipment row was:

```
Taylor C161 — S/N CW-C161-0001 · AVAILABLE · wh-main (unresolved id)
```

Five attributes in one string, with the location key shown **twice**: once as a place, once with a
parenthetical admitting it was not one. Now six fields, location resolved through the governed
projection, unresolved rendering as an absence.

## 9. Not built here

Full Reporting, exports, dashboards, AI, and the Financial Layer. The metadata is designed to be the
**one** canonical business-field definition those reuse — `reportable`, `exportable`, `groupable` and
`capability` exist so a second, incompatible field registry never has to be invented.

Column chooser is not built; the metadata carries `defaultVisible` and `displayable` so it can be
added without rewriting every list.

---

## Migration pattern for the remaining objects

1. **Trace the stored document first.** Declare `filterable`/`sortable` against what is actually
   stored — never against what would be convenient.
2. **Reuse existing domain constants** for status order and labels. Never restate one.
3. **Name every related field's owner**, and mark it `NOT_PROJECTED` unless the id is on the document.
4. **Declare `unresolvedText`** on every displayable reference.
5. **Add the object's list key** to `OBJECT_LIST_KEY` and route back-navigation through
   `objectListPath`.
6. **Run the raw-id guard** against the new surface.

### Prioritized order

| # | object | why here | note |
|---|---|---|---|
| **1** | **Purchase Orders** | first required follow-on | PO Number · Vendor · Status · Business Line · Buyer · Date · **Dollars**. Check for an authoritative PO total the same way; if absent, report the gap rather than manufacturing one. |
| 2 | Parts / Part Master | highest-volume list; filters matter most at scale | |
| 3 | Customers / Accounts | the most common related object — projecting its name unblocks filters everywhere | |
| 4 | Transfers | structured fields already exist from WO-05; needs metadata + list |
| 5 | Opportunities | shares Sales Order relationships |
| 6 | Invoices | **has** authoritative money — the natural first financial list |
| 7 | Employees / Technicians | small, but unblocks technician-name sorting elsewhere |
