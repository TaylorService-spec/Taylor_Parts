# Query Contracts — when a field is optional but a record is invisible without it

**Status:** active
**Owner:** platform
**Mechanical enforcement:** `functions/scripts/certificationWorld/domainContracts.mjs` (`QUERY_REQUIRED_FIELDS`), asserted by `functions/test/certificationWorldContracts.test.mjs`

---

## The rule

> **Firestore's `orderBy` does not merely sort — it FILTERS.**
> A document missing the ordered field is silently excluded from the result set. No error, no warning, no indication that anything was left out.

A field the schema treats as optional can therefore be **mandatory for a record to be visible** on any surface that sorts or ranges over it.

We call that second requirement `QUERY_REQUIRED`. It is weaker-sounding than a schema requirement and harder to notice, because nothing fails — the data is correct, the write succeeded, the read succeeded, and the list is simply short.

**Optional schema does not imply optional query participation.**

---

## What this cost us

Three defects in one week, all the same shape:

| Surface | Field | Effect |
|---|---|---|
| `/customers` list | `updatedAt` | **101 of 103 customers** absent from the list, while the portfolio header — a different, unsorted read — still counted all 103 |
| `/customers` search | `nameLower` | Searching `mesquite` reported "No customer names start with mesquite" with **Mesquite Soda Works visible on the same screen** |
| Truck list "Last update" | `updatedAt` | 5 of 7 trucks would vanish the moment anyone clicked the column header |

The first was found by the Owner scrolling a list. The second by the Owner typing into a box. Neither was found by a test, because **every test passed**: the seeder wrote every record successfully, `verify` reported COMPLETE, and the world fingerprint matched.

A list quietly missing 94% of its rows looks exactly like a list of that size. Nothing about two rows says "there are a hundred more."

---

## Why it is easy to reintroduce

The failure has no symptom at the point of the mistake:

- The **writer** succeeds. Omitting a field is not an error.
- The **read** succeeds. A short result set is a valid result set.
- The **schema** is satisfied. The field was always optional.
- The **UI** is correct. It renders exactly what it was given.

Every layer behaves properly and the user still sees the wrong thing. That is why prose alone is not enough here, and why the contract is a data structure a test reads rather than a paragraph someone remembers.

---

## The contract

`QUERY_REQUIRED_FIELDS` maps a collection to the fields without which a record is unreachable, and **why**:

```js
accounts: [
  { field: "updatedAt", surface: "/customers list",   why: "metadata definition account.js defaultSort is updatedAt DESC" },
  { field: "nameLower", surface: "/customers search", why: "prefix range + orderBy on the normalized name" },
  { field: "name",      surface: "/customers search", why: "search results render the display name" },
],
mobile_locations: [
  { field: "updatedAt", surface: "truck list 'Last update' column", why: "exposed as a sortable column" },
],
```

Each entry names its surface and reason so a future reader can tell whether it still holds. **A stale entry is how a guard quietly becomes ceremony** — if a surface no longer sorts by the field, the entry should go, not linger.

---

## How it is enforced

1. **Fixture validation** — `validateWorldRecords()` reports `QUERY_INVISIBLE` for any built record missing a query-required field.
2. **Seeded-shape assertion** — the check runs against *builder output + seeder stamping*, because that union is what actually lands in Firestore. Checking only the builder would miss `updatedAt`; checking only the seeder would miss `nameLower`.
3. **Live surface verification** — `verifyLiveSurfaces.mjs` issues the real ordered reads against the real project and compares the count returned to the count that exists. A record that exists but cannot be retrieved by the query its screen runs is, for every practical purpose, absent.
4. **Mutation proof** — the guards are proven capable of failing by injecting a record with the field removed.

---

## When you add a sortable column or a new list

Ask: **can every record that should appear here actually be returned by this query?**

If a surface sorts, ranges, or filters on a field, add it to `QUERY_REQUIRED_FIELDS` and make sure every writer maintains it — the seeder, the client writers, and any backfill. A derived or stamped field is only as good as its weakest writer.

---

## Known open issue: mixed types in a sort field

`updatedAt` is currently written as **two different types**:

- the client writers (`domain/accounts.js` → `collectionStore`) write `Date.now()` epoch-**milliseconds**
- the Certification World seeder and backfills write Firestore **Timestamps**

Firestore orders mixed types **by type first**, so numbers sort as a separate block from timestamps. This does **not** hide records — exclusion only happens for a *missing* field — but it does mean a customer edited through the UI sorts into a different block from a seeded one, which is not what "most recently updated" is supposed to mean.

The client convention is deliberate and shared with `jobsStore`/`techniciansStore`, so changing it is a broader decision than this document should make. **Recorded here rather than silently normalized.**
