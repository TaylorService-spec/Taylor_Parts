# The Verenward Global Record Identity Standard (VGRIS v1)

**Status:** PROPOSED — design settled, adoption not started.
**Scope:** every first-class Verenward/EOS record, in every tenant, every operating company, every
environment, and every future Verenward product sharing the platform namespace.
**Companion artifacts:** `verenward-object-code-registry-proposed.md` (the code registry),
`record-id-migration-impact-census.md` (what exists today and what it would cost to change).

> **Nothing in this document has been migrated.** No existing identifier is rewritten by adopting
> this standard as written; adoption is a forward-only program described in §12.

---

## 0. The one-sentence standard

> Every first-class Verenward record has exactly one **EOS Record ID**: a fixed-length,
> case-normalised, opaque, immutable, globally unique 31-character token of the form
> `OOOO_XXXXXXXXXXXXXXXXXXXXXXXXXX` — a 4-character centrally registered object code, one `_`,
> and a 26-character Crockford Base32 rendering of 128 bits minted by the platform.

```
ACCT_01JQ4T8H9M2XKPR7VBN3DZ5WF6
└┬─┘│└────────────┬───────────┘
 │  │             └── 26 chars, Crockford Base32, 128 bits, platform-minted
 │  └──────────────── exactly one U+005F LOW LINE, always at index 4
 └─────────────────── 4 chars, A–Z, centrally registered object code
```

---

## 1. Verdict on the starting proposal: 31 / 4 / 26 is correct — adopt it

The starting direction was `OOOO_` + 26 = 31 characters. **The evidence supports it**, but the
reasons usually given for it are the weak ones, and three things it left open are load-bearing.
This section states the verdict, the real reasons, and the amendments.

### 1.1 Why 26 is the right payload width — and not an arbitrary number

26 characters of Crockford Base32 carry 130 bits of alphabet capacity, which is the smallest whole
number of Base32 characters that holds **exactly 128 bits**. 128 bits is not a preference; it is the
width of a UUID, which means the payload is losslessly and bijectively convertible to and from a
standard `uuid` value. That bijection is what buys:

- a Postgres `uuid` column (16 bytes, native index) whenever a table wants one, **without changing
  the printed identifier**;
- interoperability with every tool, warehouse, and BI product that already understands UUIDs;
- a single, testable round-trip property (`decode(encode(u)) === u`) instead of a bespoke format
  nobody else can parse.

A shorter payload was considered. 20 characters (100 bits) is more than enough entropy and would
give a 25-character ID. It was **rejected**: six characters is a cheap price for standard-type
convertibility, and a non-standard bit width is a permanent tax on every future integration.

A longer payload was considered and rejected for the same reason in reverse: there is nothing to
put in the extra bits that is not forbidden by §3.

### 1.2 Why 4 is the right object-code width — and not for the reason usually given

The usual argument is capacity: 26⁴ = 456,976 codes. That argument is worthless. Three characters
already gives 17,576, and the platform object model is on the order of a hundred objects. Capacity
does not decide this.

**Readability under near-homonyms decides it.** The real EOS object model is full of pairs that a
3-character code cannot separate legibly:

| Pair | At 3 chars | At 4 chars |
|---|---|---|
| Purchase Order / Purchase Order Void | `POR` / `POV` | `PORD` / `PVOD` |
| Sales Order / Sales Agreement | `SOR` / `SAG` | `SORD` / `SAGR` |
| Receiving Order / Reorder Request | `RCV` / `RRQ` | `RCVO` / `RORQ` |
| Inventory Transaction / Inventory Commitment | `INT` / `INC` | `IVTX` / `IVCM` |
| Equipment / Equipment Model | `EQP` / `EQM` | `EQIP` / `EQMD` |
| Location / Mobile Location | `LOC` / `MLC` | `LOCN` / `MLOC` |

At three characters these become codes you look up. At four they become codes you read. A support
engineer scanning a log line, an administrator reading an export, and a developer reviewing a diff
all pay the readability cost thousands of times and the capacity cost never.

Five characters was considered. It buys nothing (`PURCHORD` is not clearer than `PORD`) and
lengthens every identifier everywhere. **4 is adopted.**

### 1.3 Why the object code exists at all — the strongest argument, which was not stated

The proposal treats the object code as a convenience. It is not. It is what makes global uniqueness
**provable from constraints the platform already enforces**.

Global uniqueness across every tenant, product, and data plane cannot be enforced by a single
database, because there is no single database — Firestore collections, `eos_policy`, `eos_ops`,
`eos_commercial`, `eos_finance`, and any future customer-hosted plane are separate uniqueness
domains. Without a prefix, "globally unique" is an assertion resting on probability alone.

With the prefix it decomposes into two enforced facts:

1. **Across objects:** two IDs with different object codes cannot be equal — string inequality.
2. **Within one object:** the owning store's primary key (Firestore document id, or
   `id TEXT PRIMARY KEY`) already guarantees uniqueness.

Global uniqueness is then the conjunction of an obvious lexical fact and a constraint the database
enforces. Probability is a third line of defence, not the first.

Three further properties follow from the prefix and are worth naming because each removes a real
class of defect:

- **Mis-wiring is caught at the boundary, not at the 404.** Passing an Account ID where a Work Order
  ID is expected fails validation immediately and with the right message, instead of producing a
  "record not found" three services away.
- **Spreadsheet safety is structural.** The first character is always `A`–`Z`. The ID can therefore
  never be parsed by Excel or Google Sheets as a number, a date, or scientific notation, and can
  never begin with `=`, `+`, `-`, or `@` — the four characters that make a CSV cell a formula.
  Without the prefix this would be a probabilistic argument; with it, it is a guarantee.
- **Triage without a lookup.** An ID alone tells an operator which object, which surface, and which
  owner team.

### 1.4 Amendments to the starting proposal

| # | Amendment | Why it is needed |
|---|---|---|
| **A1** | Time-ordering is a **per-object-code policy flag**, not a global property (§5.3) | A globally time-ordered key is a documented Firestore write-hotspot on the platform's primary data plane. Uniform format, variable ordering, is the only design that is correct on both planes. |
| **A2** | The Crockford ambiguity mapping is a **read-boundary** behaviour only, never a storage behaviour (§6.2) | Accepting `O`→`0` at the datastore would let one record exist under two distinct keys in a case- and character-sensitive store. |
| **A3** | **No check character** (§6.4) | Record IDs are never hand-keyed; the business number is the human channel. A check symbol would cost a character and buy nothing. |
| **A4** | The object-code namespace is **partitioned by first letter**; `X???` is reserved for customer-defined objects (registry §4) | The proposal specified "collision-free" but not *how* a future customer object is guaranteed never to collide with a future Verenward object. |
| **A5** | The separator is fixed at **index 4 and always present** (§6.3) | Makes a future width change a parse-compatible change rather than a breaking one. |

---

## 2. What an EOS Record ID is not — four identifier kinds, kept apart

This is the most important section in the document. The integrated tree contains live examples of
all four kinds, and most of the identity confusion in the codebase today is one kind doing another
kind's job.

| Kind | Owner | Mutable? | Meaningful? | Unique across? | Live example today |
|---|---|---|---|---|---|
| **EOS RECORD ID** | Verenward platform | **Never** | **Never** | Globally, all tenants + products | `Part.partId` (document id) |
| **BUSINESS NUMBER** | the customer's business process | Yes | Yes, by design | A tenant, usually a year, sometimes nothing | `Work Order.woNumber` (`WO-2026-000008`) |
| **LEGACY ID** | a system the customer is leaving | Frozen at cutover | Whatever it meant there | The old system only | the `IMP-`-prefixed account ids |
| **EXTERNAL ID** | a system EOS talks to | Owned elsewhere | Whatever it means there | That system only | `principals.external_subject` (the Firebase UID) |

### 2.1 The rules that keep them apart

1. **Exactly one Record ID per record, forever.** Not per environment, not per tenant, not per data
   plane. If a record is exported and re-imported, it keeps its ID or it is a different record.
2. **A Record ID is never displayed as a label.** The repository already ruled this (`IDENTITY_MODE`,
   DECISIONS #106, `field-ops-app-vite/src/metadata/entityDefinition.js`): an entity names itself by
   `nameField` or `referenceField`, and `SYSTEM_ONLY` is the explicit way to say it has no human
   name. `?? record.id` as a display fallback is a defect, and this standard does not soften that —
   it is the reason the Record ID may be opaque at all.
3. **A Business Number is never a foreign key.** Every reference between records stores the Record
   ID. A business number may be *shown* next to the reference; it is never what is *stored*.
4. **A Legacy ID never becomes a Record ID and never a prefix on one.** It lands in the crosswalk
   (§10). A Record ID that begins `IMP-` is a Record ID carrying provenance, which is provenance
   that can never be corrected.
5. **An External ID is never trusted as unique inside EOS.** It is unique in *its* system. It is
   stored with the name of the system it came from, and the pair is what is unique.
6. **An idempotency key is none of the four.** Client-minted idempotency keys (present today in
   `useOpportunityCreate.js`, `useSalesOrderActions.js`, `reorderCallableClient.js` and others) are
   request de-duplication tokens with a lifetime of one call. They must never be stored as identity
   and never derived from, or into, a Record ID.

### 2.2 Why "nothing business-mutable in the ID" is not negotiable

Every value a business can change is a value that will change: a Location moves between operating
companies, an Account is re-assigned, a Work Order's status advances, a Bin is re-coded, a tenant is
merged into another tenant. An ID that encodes any of these is an ID that must either lie or be
rewritten — and rewriting an ID means rewriting every foreign key, every export, every document, and
every customer's spreadsheet that ever quoted it.

**Forbidden in the visible ID, without exception:** tenant, operating company, owner, assignee,
status, lifecycle state, location, warehouse, site, region, environment, customer, supplier, year,
period, sequence-within-anything, source system, import batch, and record class beyond the registered
object code.

**The one thing that is in the ID and needs defending: the creation instant.** A time-ordered payload
(§5.3) contains a 48-bit millisecond timestamp. That is not a business date — it is the moment the
*identity* was minted, which for an imported record is the import time and not the historical event
date. It is therefore useless as business data and harmful if read as such. The rule is absolute:

> **No production code path may decode a timestamp out of a Record ID.** Creation time is a stored,
> queryable field (`createdAt`). The bits inside the ID exist for index locality and for nothing else,
> and are not a documented part of the format.

---

## 3. Fixed properties of the format

| Property | Value | Enforcement |
|---|---|---|
| Total length | exactly **31** characters | regex; `CHAR(31)`/`VARCHAR(31)`; CHECK constraint |
| Object code | 4 characters, `A`–`Z` only | registry (`verenward-object-code-registry-proposed.md`) |
| Separator | exactly one `_`, always at index 4 | regex |
| Payload | 26 characters, Crockford Base32 | regex |
| Payload bits | 128, big-endian, 2 leading pad bits zero | first payload char ∈ `0`–`7` |
| Case | **UPPERCASE is the only canonical form** | normalise at ingress; reject non-canonical at rest |
| Encoding | 7-bit ASCII; no Unicode, no normalisation forms | byte-for-byte comparable |
| Comparison | **byte-exact, case-sensitive** | never `ILIKE`, never `lower()` |
| Mutability | immutable for the life of the record **and after** | tombstones (§11), never reuse |

### 3.1 The canonical regexes

```
Permissive (accept):   ^[A-Z]{4}_[0-9A-HJKMNP-TV-Z]{26}$
Strict (mint + store): ^[A-Z]{4}_[0-7][0-9A-HJKMNP-TV-Z]{25}$
```

The strict form encodes the two-pad-bit fact and should be the database CHECK constraint. The
permissive form is for parsers that must tolerate a future widening of the payload's leading bits.

The Crockford alphabet is `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — the digits and the uppercase letters
**excluding `I`, `L`, `O` and `U`**. `I`, `L` and `O` are excluded because they are visually
confusable with `1` and `0`; `U` is excluded to make an accidental obscenity impossible. The
alphabet is in strictly ascending ASCII order, which is the property §5.2 depends on.

---

## 4. Payload source: UUIDv7, rendered in Crockford Base32

### 4.1 The decision

> The 128-bit payload is minted as a **UUIDv7 (RFC 9562)** and rendered as 26 Crockford Base32
> characters. The rendering is the canonical, printed, stored form. The UUID is an optional
> storage representation, provably bijective with it.

### 4.2 Why UUIDv7 rather than ULID

Both are 128 bits with a leading 48-bit millisecond timestamp; both sort lexically by time. They are
near-equivalent, and the tie is broken on governance and tooling, not on bits:

| | UUIDv7 | ULID |
|---|---|---|
| Specification | **RFC 9562** (IETF, 2024) | a project README |
| Random bits | 74 | 80 |
| Native database support | Postgres `uuid` column; `uuidv7()` in PG 18 | none |
| Canonical text form | 36-char hyphenated hex | 26-char Crockford Base32 |
| Monotonicity within a millisecond | optional, specified as a set of methods | implementation-defined |

The 6 random bits ULID gains are the UUID version and variant nibbles. Losing them is immaterial
(§7). Gaining an IETF specification and a native column type is not.

**This design takes ULID's text ergonomics and UUIDv7's governance**, which is available precisely
because the text form is a rendering decision and not part of the generation decision.

### 4.3 Node does not generate UUIDv7 today — verified

`crypto.randomUUID()` on Node 22.23.2 (this repository's `engines.node`) produces a v4. The
`{ version: 7 }` option is **accepted and silently ignored** — it still returns a v4:

```
$ node -e "console.log(require('crypto').randomUUID({version:7}))"
9f41cada-2b6a-4465-9ef5-de40d76a0492     # version nibble is 4, not 7
```

A v7 generator must therefore be written (roughly fifteen lines over
`crypto.randomFillSync`) or taken as a dependency. §9 specifies the generator; the reference
implementation is `functions/src/identity/recordId.ts`.

### 4.4 The bit layout

```
 0                   48  52          64  66                             128
 ├────────────────────┼───┼───────────┼───┼──────────────────────────────┤
 │ unix_ts_ms (48)    │ver│ rand_a(12)│var│ rand_b (62)                  │
 │                    │ 7 │           │ 10│                              │
 └────────────────────┴───┴───────────┴───┴──────────────────────────────┘
                      ↑ RFC 9562 §5.7
```

Rendered: `00` pad ‖ 128 bits → 26 × 5-bit groups → Crockford alphabet.

---

## 5. Sorting

### 5.1 What the ID sorts by

Lexical order of the 31-character string is: **object code, then creation millisecond, then
arbitrary.**

Because the object code is a strict prefix, all IDs of one object sort together. That is a useful
property for exports and a neutral one for indexes.

### 5.2 Why lexical order equals time order — the proof

Crockford Base32 is a positional, big-endian encoding over an alphabet whose symbols are in strictly
ascending ASCII order. For two equal-length encodings, comparing the strings character by character
is therefore identical to comparing the 130-bit values digit by digit, which is identical to
comparing the 128-bit values (the 2 pad bits are constant zero). The leading 48 bits are the
big-endian millisecond timestamp. Therefore:

> `idA < idB` (byte comparison) ⟺ `uuidA < uuidB` (numeric) ⟹ `msA ≤ msB`.

This holds only because the alphabet skips `I`, `L`, `O`, `U` rather than remapping them — skipping
preserves order; remapping would not. It also holds only for equal-length strings, which fixed
length guarantees.

### 5.3 Amendment A1 — time-ordering is per object code, because Firestore

A monotonically increasing document id is a **documented Firestore anti-pattern**. Firestore splits
its key space by lexicographic range; a key whose leading characters advance with wall-clock time
sends every write in a collection to the same range, and Google's published guidance puts the
sustained ceiling for one such range at roughly 500 writes/second. Firestore's own auto-IDs are
deliberately random for exactly this reason. Postgres has the opposite preference: a random key
fragments a B-tree and amplifies writes, which is *why* UUIDv7 exists.

A single global choice is therefore wrong on one of the two data planes EOS actually runs on.

**The resolution:** the format is uniform; the ordering is a registry attribute.

| `ordering` | Payload source | Use for |
|---|---|---|
| `TIME_ORDERED` (default) | UUIDv7 | every object whose sustained write rate is far below the hotspot ceiling — i.e. nearly all of them |
| `SCATTERED` | 128 CSPRNG bits, version/variant nibbles set to v4 | designated ultra-high-write ledger objects |

Nothing outside the generator can tell the difference: same length, same alphabet, same validation,
same opacity. The object code still groups the key space into ~100 disjoint ranges, so even a
`TIME_ORDERED` object contends only with itself.

**Sizing, so this is a decision and not a worry.** The highest-volume EOS object is the inventory
movement ledger. A distribution and field-service business of the size EOS serves writes movements
in the thousands per day — three to four orders of magnitude below 500/second sustained. Every
object in the registry is therefore proposed as `TIME_ORDERED`, with `SCATTERED` retained as a
declared, reversible escape hatch rather than a redesign.

**Revisit trigger:** any single object code sustaining more than 50 writes/second (10% of the
ceiling) over a five-minute window flips to `SCATTERED` for records minted after the change. Because
the flag affects only minting, the flip requires **no migration** — old and new IDs remain valid,
comparable, and indistinguishable.

### 5.4 What the ID does *not* give you

- **Not a total creation order.** IDs minted in the same millisecond are mutually unordered. Two
  records created "at the same time" have no defined sequence.
- **Not an audit sequence.** Use the audit event's own ordering, never ID order.
- **Not a count.** Nothing about an ID reveals how many records exist.
- **Not a business date.** See §2.2.

---

## 6. Case, ambiguity, separator, check character

### 6.1 Case policy

**UPPERCASE is the only canonical form, and the only form that is ever stored, compared, indexed,
logged or printed.** Both the object code (`A`–`Z`) and the Crockford payload are uppercase, so the
whole token is uppercase; there is no mixed-case variant to reason about.

Comparison is **byte-exact and case-sensitive**. `lower(id)`, `ILIKE`, and case-insensitive
collations are forbidden on a Record ID column. The reason is blunt: Firestore document ids and
Postgres `TEXT` are both case-sensitive, so a case-insensitive *comparison* layered over a
case-sensitive *store* produces "the same record" that the store believes is two records.

### 6.2 Amendment A2 — the ambiguity mapping is an ingress behaviour, and only that

Crockford Base32 defines a decode-time leniency: `I`, `i`, `l`, `L` → `1`; `o`, `O` → `0`; lowercase
→ uppercase. This is genuinely valuable when a human retypes an ID from a printed document, and it
is genuinely dangerous anywhere else.

The rule:

> **Normalise at the ingress boundary; store and compare only the canonical form.** A Record ID
> arriving from any external source — a URL, a form field, a query parameter, an import file, an API
> body, a support ticket — is passed through `normalizeRecordId()` exactly once, at the edge, before
> it is used for anything. From that point inward, only the canonical form exists.

Consequences that must be enforced, not assumed:

- The normaliser is never called on a value already inside the system.
- No write path ever accepts a non-canonical ID and stores it. Storage validates with the strict
  regex and **rejects**, it does not repair.
- A lookup by a normalised ID that differs from the input **redirects** (HTTP 301-equivalent) rather
  than serving content at the non-canonical URL, so a non-canonical form can never accumulate links.

### 6.3 Separator policy (Amendment A5)

Exactly one `_` (U+005F), always at index 4, never optional, never repeated, never any other
character.

**Why a separator at all**, rather than `ACCT01JQ4T...` at 30 characters:

- It makes the code boundary explicit to a human and to a parser.
- It makes a future 5-character object code a **parse-compatible** change: a parser that splits on
  the first `_` keeps working. A parser that slices `[0..4)` would not.
- It gives the eye a fixed anchor at a constant position in every log line and every column.

**Why `_` rather than `-`:**

| | `_` | `-` |
|---|---|---|
| URL-unreserved (RFC 3986) | yes | yes |
| Word character in editors, browsers, terminals | **yes — double-click selects the whole ID** | no — selects only one half |
| `\b`/`\w` in grep and most regex flavours | yes — `grep -w` matches the whole token | no |
| Read as a minus sign or a date part by a spreadsheet | no | possible in some locales |
| Consistent with identifiers already minted in this repository | **yes** (`opp_`, `sag_`, `sor_`, `cmt_`, `inv_`, `trf_`, `rcv_`, `ccs_`, `epl_`) | no |

The double-click property is not cosmetic. A support engineer copies an ID out of a log a hundred
times a week, and `-` makes every one of those a drag-select.

**The one hazard, stated so it is designed around:** `_` is the single-character wildcard in SQL
`LIKE`. `WHERE id LIKE 'ACCT_%'` matches more than intended. The remedy is not to change the
separator but to never `LIKE` an ID: use `left(id, 4) = 'ACCT'`, or `LIKE 'ACCT\_%' ESCAPE '\'`.

### 6.4 Amendment A3 — no check character

Crockford Base32 defines an optional mod-37 check symbol. It was considered and **rejected**.

A check character protects hand-keyed entry. EOS Record IDs are never hand-keyed: they move by
click, scan, copy, API and export. The identifier a human reads aloud, writes on a pick ticket, or
quotes on the phone is the **business number** (`WO-2026-000008`), and that is where human-entry
protection belongs. Adding a 32nd character would cost every column, every log line and every export
one character to defend a path that does not exist.

---

## 7. Collision protection

Four independent layers, in the order they act.

**1. Entropy (probabilistic).** A `TIME_ORDERED` payload carries 74 random bits *within a single
millisecond*; a `SCATTERED` payload carries 122 over all time. Two records collide only if they are
minted in the same millisecond, for the same object, with the same 74 random bits. By the birthday
bound, a 50% chance requires ≈2³⁷ ≈ 1.4 × 10¹¹ records **in one millisecond**. This is not a
guarantee, and this document does not present it as one.

**2. Structural partitioning (certain).** Two IDs with different object codes are different strings.
Cross-object collision is impossible, not improbable.

**3. Database uniqueness (enforced, and this is the real protection).**

- **Firestore:** every create must use `DocumentReference.create()`, which **fails** if the document
  exists. `set()` on a create path silently overwrites and is forbidden by this standard. This is a
  behavioural requirement on existing code, and the census flags where it is not yet met.
- **Postgres:** `id TEXT PRIMARY KEY` — already the house pattern in every `eos_*` schema — plus the
  shape constraint in §8.

**4. Retry-on-collision (belt and braces).** The minting library retries once on a unique-violation
and fails loudly on the second. A collision is a bug or a broken RNG, and must page someone rather
than be absorbed.

---

## 8. Uniqueness and shape enforcement in the database

### 8.1 Postgres

Every Record ID column carries a CHECK constraint naming its own object code:

```sql
ALTER TABLE eos_ops.warehouses
  ADD CONSTRAINT warehouses_id_shape
  CHECK (id ~ '^WHSE_[0-7][0-9A-HJKMNP-TV-Z]{25}$');
```

This is cheap and it catches, **at the database**, the entire class of "the right-shaped ID of the
wrong object ended up in this column" — including in a foreign-key column:

```sql
ALTER TABLE eos_ops.bins
  ADD CONSTRAINT bins_warehouse_id_shape
  CHECK (warehouse_id ~ '^WHSE_');
```

A foreign key alone cannot catch it if both tables' ids are `TEXT`; the shape constraint can. Note
that today **several `eos_*` tables use composite `(tenant_id, ...)` primary keys** rather than a
global surrogate — `suppliers`, `supplier_catalog_items`, `equipment_models`, the truck/mobile
registry, `bin_code_claims`, and the inventory-commitment table. Those are, by construction,
**tenant-local identities**, and they are the structural obstacle to global identity, not a detail.
See the census.

### 8.2 Firestore

Firestore cannot express a CHECK constraint. Shape is enforced in three places instead:

1. the trusted command, which is the only writer for nearly every governed collection;
2. `firestore.rules`, which can constrain a document id with a `matches()` on `request.path`;
3. a drift test that scans the write shapes, in the style this repository already uses.

`create()`-not-`set()` (§7) is the uniqueness mechanism.

### 8.3 Fixed-width columns

31 is fixed, so `CHAR(31)` is available and `VARCHAR(31)` is honest. Log and report layouts can
reserve a fixed column. Nothing truncates.

---

## 9. Centralised generation

### 9.1 The rule

> **Record IDs are minted by the platform, server-side, in exactly one library. Nothing else, ever,
> mints one.**

No client, no import file, no fixture, no migration script, no seed, no customer, no integration
partner and no administrator may supply a Record ID for a record being created.

### 9.2 The library surface

`functions/src/identity/recordId.ts` — pure, dependency-free apart from `node:crypto`:

| Function | Contract |
|---|---|
| `mintRecordId(objectCode, opts?)` | the only minting path; validates the code against the registry; honours the object's `ordering` |
| `parseRecordId(value)` | `{ objectCode, payload }` or `null` — never throws |
| `isRecordId(value, objectCode?)` | strict validation; optionally asserts the expected object |
| `normalizeRecordId(value)` | the §6.2 ingress normaliser, and the **only** place ambiguity mapping happens |
| `recordIdToUuid(value)` / `uuidToRecordPayload(uuid)` | the §4.1 bijection, with a round-trip property test |
| `assertRecordId(value, objectCode)` | throws with a message naming both the expected and the actual object code |

`assertRecordId` at every service boundary is what converts §1.3's mis-wiring property from a claim
into a mechanism.

### 9.3 The obstacle this creates, named honestly

Centralised, server-side generation is **not** achievable for every object today. Per ADR-015,
**Accounts and Equipment are still written client-direct under `firestore.rules`**, and a
client-direct create mints a Firestore auto-ID in the browser. Those two objects therefore require
either a trusted create command or a mint-then-create callable before they can conform. That is a
real, named prerequisite, not an implementation detail.

### 9.4 Idempotency keys are not record ids

Client code minting a `crypto.randomUUID()` idempotency key is correct and must continue. It is a
de-duplication token for one request. It is never stored as identity, never derived from a Record
ID, and never used to derive one.

---

## 10. Import protections and legacy crosswalks

### 10.1 What an import may and may not do

| | Allowed |
|---|---|
| Supply a Record ID for a **new** record | **Never.** The importer mints it. |
| Supply a Record ID to **match an existing** record | Yes — validated against the strict regex *and* the expected object code for the target. |
| Supply a legacy / source / external id | Yes. It lands in the crosswalk and on the record's own external-id fields. Never in the Record ID. |
| Derive a Record ID from file content | **Never.** This is what produced the `IMP-` prefixed account ids. |

An import that supplies a syntactically valid Record ID whose object code does not match the import
target is rejected at preview, not at execution — the repository's Data Import architecture already
draws that line (`importPreview.ts` has no write capability at all), and this rule sits naturally
above it.

### 10.2 The crosswalk

One durable, append-mostly authority. It is never truncated, never archived away, and never
reconstructed from the records themselves.

```
record_identity_crosswalk
  eos_record_id     TEXT NOT NULL      -- the VGRIS id
  object_code       CHAR(4) NOT NULL
  id_kind           TEXT NOT NULL      -- LEGACY | EXTERNAL | PRIOR_EOS
  source_system     TEXT NOT NULL      -- 'taylor-legacy', 'quickbooks', 'firestore-autoid', ...
  source_value      TEXT NOT NULL
  tenant_id         TEXT NOT NULL      -- scope of the SOURCE's uniqueness, not of the EOS id
  recorded_at       TIMESTAMPTZ NOT NULL
  recorded_by       TEXT NOT NULL
  PRIMARY KEY (source_system, tenant_id, source_value, id_kind)
```

Three properties make it load-bearing:

- **The old id keeps working forever.** Any integration, document, report or human that still knows
  the old identifier can resolve it. This is what makes "we changed the ID" survivable.
- **`tenant_id` scopes the *source*, not the EOS record.** A legacy system's ids were tenant-local;
  the EOS Record ID is not. Putting tenant on the source side is the difference between recording a
  fact and re-introducing tenant into identity.
- **`PRIOR_EOS`** is its own kind, because the largest population of "legacy" ids will be EOS's own
  pre-standard ids (Firestore auto-IDs, `opp_<uuid>`, `bin_<sha256>`, `IMP-...`).

---

## 11. Merge, tombstone, and the meaning of "immutable"

A Record ID is immutable **and the immutability outlives the record.**

### 11.1 A dead ID must resolve, not 404

```
record_id_tombstones
  dead_record_id    TEXT PRIMARY KEY
  object_code       CHAR(4) NOT NULL
  disposition       TEXT NOT NULL   -- MERGED_INTO | SUPERSEDED_BY | DELETED | NEVER_EXISTED
  surviving_id      TEXT            -- required for MERGED_INTO / SUPERSEDED_BY, null otherwise
  at                TIMESTAMPTZ NOT NULL
  actor             TEXT NOT NULL
  reason            TEXT
```

A lookup of a tombstoned ID returns a **redirect to the survivor**, not "not found". The difference
matters: a customer's document, a partner's integration, and a three-year-old export all quote IDs
that were correct when written, and telling them "no such record" when the record exists under
another id is a lie.

### 11.2 The rules

1. **An ID is never reused.** Not after delete, not after merge, not after a tenant is removed.
2. **Merge picks a survivor; it does not mint a third id.** Minting a new ID for the merged record
   would orphan both histories.
3. **Merge chains collapse on read.** If A→B and later B→C, a lookup of A returns C in one hop. The
   chain is stored as written and flattened at read time, so history stays truthful.
4. **A merge is never silently reversed.** An un-merge is a new record with a new ID plus a
   `SUPERSEDED_BY` tombstone — not a resurrection of the old ID.
5. **Object class never changes.** If a record turns out to be a different kind of thing, that is a
   new record of the right object plus a `SUPERSEDED_BY` tombstone on the old one. This is the only
   answer compatible with the object code being part of the ID, and it is the right answer anyway.

---

## 12. Adoption posture — forward-only, and explicitly not tonight

This standard is **design**. Nothing in the integrated tree has been migrated, and adopting it does
not require migrating anything.

The adoption model that costs nothing on day one:

1. **New objects** get VGRIS ids from the day the registry accepts their code. No existing record is
   touched.
2. **Existing objects** keep their current ids, which become `PRIOR_EOS` crosswalk entries whenever
   the object is converted — object by object, on that object's own schedule, never as a platform
   event.
3. **Conversion of one object** is: mint a VGRIS id for every record, write the crosswalk, switch
   references over behind a resolver that accepts both, then retire the old id from write paths.
   Never a big-bang rewrite of foreign keys.
4. **Some objects may never convert.** An object whose id is already opaque, server-derived, globally
   unique and stable is not obviously improved by conversion. The census identifies which.

**What this standard does *not* authorise:** any mass ID migration, any data migration, any schema
change that rewrites existing identity, any production contact, and any deployment.

---

## 13. Safety matrix

| Context | Safe? | Why |
|---|---|---|
| URL path segment | yes | every character is RFC 3986 *unreserved*; no percent-encoding, ever |
| URL query value | yes | same |
| JSON | yes | no escaping; no surrogate pairs; ASCII only |
| CSV field | yes | contains no comma, quote, newline, or CR |
| **CSV formula injection** | yes | first character is always `A`–`Z`; never `=`, `+`, `-`, `@`, tab or CR |
| **Excel / Sheets auto-format** | yes | cannot be read as a number (letters at index 0–3), a date (no `-` or `/`), scientific notation (no leading digits + `E` + digits pattern), or a leading-zero-stripped number |
| SQL literal | yes | no quote character to escape |
| SQL `LIKE` pattern | **caution** | `_` is the single-character wildcard — see §6.3 |
| Shell argument | yes | no glob metacharacter (`*?[]{}~!$&|;<>()`), no whitespace, no quote |
| Regex literal | yes | no metacharacter in the alphabet |
| `grep -w` / `\b` | yes | `_` is a word character, so the whole 31 characters is one word |
| Filename (POSIX + Windows) | yes | no reserved character; 31 chars; cannot equal `CON`/`PRN`/`NUL`/`COM1`… |
| Firestore document id | yes | not `.`, not `..`, does not match `__.*__`, contains no `/`, far under 1500 bytes |
| Log line | yes | fixed width; one grep-able word; no escaping |
| QR / Code 128 barcode | yes | Code 128 subset B covers the alphabet; 31 chars is a practical symbol |
| Spoken aloud | **partly** | Crockford removes `I`/`L`/`O`/`U` confusion, but 26 characters is not a phone-friendly identifier. Speak the **business number** instead. |
| Double-click to select | yes | `_` keeps the token whole; `-` would not |

---

## 14. Open technical questions

These are genuinely open and are not resolved by this document.

1. **Does the `SCATTERED` escape hatch ever get used?** It is specified because the Firestore
   hotspot rule is real, and left unused because EOS's measured write rates are far below the
   ceiling. The trigger in §5.3 is a guess at a threshold, not a measurement. **Measure the inventory
   ledger's actual peak write rate before finalising.**
2. **Is the Record ID a tenant-visible surface at all?** If a customer never sees one, the case-
   normalisation and hand-entry arguments soften considerably. If they see one on an invoice PDF or
   an API response, they do not.
3. **What is the authority for the registry itself?** A checked-in file, a database table, or both?
   A file is reviewable and diffable; a table is queryable at runtime by the generator. The likely
   answer is a checked-in file that seeds a table, but that is a decision, not a conclusion.
4. **Do line-level records (invoice lines, order lines, receipt lines) get Record IDs?** They already
   get ids (`invl_…`, `rcvl_…`). They are arguably not first-class — you never link to one from
   outside its parent. Giving every line a 31-character global id is a real storage and index cost
   on the highest-cardinality tables in the system. **This document does not settle it**; the
   registry marks them `LINE` and defers.
5. **Which composite-keyed `eos_*` tables convert, and when?** Several tables' identity is
   `(tenant_id, …)` by design (§8.1). Converting them is the single largest piece of work implied by
   "global identity", and each needs its own decision about whether global identity is worth it.
6. **What happens to a Record ID when a tenant is exported to a customer-hosted data plane?** It
   travels unchanged — that is the point of global identity. But whether the *receiving* plane may
   mint new VGRIS ids, and under whose object-code registry, is unsettled.
7. **Audit events derive some ids deterministically from content** (`createWorkOrder_<sha256[0:40]>`)
   and use that derivation *as* the idempotency mechanism. Those ids cannot simply become random
   VGRIS ids without replacing the idempotency mechanism first. See the census.

---

## 15. What was rejected, and why

| Rejected | Why |
|---|---|
| Hyphen separator | breaks double-click selection and `\b`; inconsistent with ids this repo already mints |
| No separator (30 chars) | makes a future code-width change a breaking parse change |
| 3-character object code | unreadable across the real object model's homonym pairs (§1.2) |
| 20-character payload (100 bits) | saves 6 characters, loses lossless UUID convertibility |
| Base64url payload (22 chars) | mixed case is meaningful; contains `-` and `_`; hostile to humans and to double-click |
| RFC 4648 Base32 | keeps `I`, `L`, `O`, `U` — the exact confusions Crockford removes |
| Hex (32 chars) | longer *and* lower entropy density than Base32 |
| Crockford check symbol | protects hand entry, which does not happen (§6.4) |
| Lowercase canonical form | a case-insensitive comparison over a case-sensitive store creates duplicate identities |
| UUIDv4 everywhere | no index locality; and the ordering trade-off is better made per object (§5.3) |
| ULID | equivalent bits, weaker governance; its ergonomics are adopted without adopting its spec |
| Encoding tenant or company | the first thing to change when a company is restructured |
| Encoding year or sequence | a business number's job, and a permanent lie once backdated data arrives |
| Deriving the id from content (hash) | two records that are legitimately identical today become one record forever |
| Letting an import supply an id | hands platform identity to a customer spreadsheet |
| Reusing a retired id | silently re-points every historical reference at the wrong record |

---

## 16. The reference implementation, and why adding it was safe

The default posture for this work was **design and census only**. One thing was added anyway:

- `functions/src/identity/recordId.ts` — the minting, parsing, validation, normalisation and
  UUID-bijection functions specified in §9.2.
- `functions/test/recordIdStandard.test.mjs` — 28 tests, one per claim this document makes.
- one line in `functions/package.json`: `"test:recordId"`.

### 16.1 Why it forces no migration and breaks nothing

| Property | Evidence |
|---|---|
| **Zero call sites.** Nothing in the repository imports it. | `grep -rn "identity/recordId"` across `functions/src`, `field-ops-app-vite/src`, `scripts` and `functions/test` returns only the test file. |
| **No record's identity changes.** It never runs in any code path that writes. | There is no write path to run in. |
| **No data, no schema, no collection, no table, no migration.** | The module's only import is `node:crypto`. It names no collection and no table. |
| **No existing file's behaviour changes.** | The only edit to an existing file is one added `scripts` entry — `git diff --stat functions/package.json` is `1 insertion(+)`. |
| **It compiles and the suite passes.** | `npm ci && npm run build` clean; `npm run test:recordId` → 28 pass, 0 fail. |
| **It honours ADR-015.** | It decides what an identifier *means* and knows nothing about where anything is *kept*. |

### 16.2 Why it was worth adding at all

Because **the tests found a real bug in the specification's own encoding, which prose review did not.**

The first implementation of `decodePayload` treated the two pad bits as *trailing* rather than
*leading*, so the decoder was misaligned against the encoder and the §4.1 bijection did not hold.
The round-trip test failed immediately. Had this been shipped as a paragraph in a document, the
error would have been discovered by whoever first tried to put a Record ID into a Postgres `uuid`
column — probably years later, and probably after ids had been minted.

The suite also pins the two properties that would otherwise fail silently and expensively:

1. **§5.2 — lexical order equals time order.** 400 ids across shuffled millisecond values, plus the
   full 48-bit range from `0` to `0xFFFFFFFFFFFF`, sorted as strings and compared against sorting by
   timestamp.
2. **§6.2 — the ambiguity mapping never touches the object code.** `LOCN` (Location) contains both
   `L` and `O`. A naive whole-string Crockford normalisation turns it into `10CN` and silently
   resolves a Location id to a record that does not exist. The test asserts every `I`/`L`/`O`-bearing
   code in the proposed registry — `LOCN`, `MLOC`, `IVTX`, `OPPT`, `IADJ`, `RLOC`, `SLOC`, `PALS` —
   survives normalisation unchanged, while the payload beside it is still repaired.

That second one is the clearest argument for writing the code: it is a bug the standard as first
drafted would have caused, and no amount of reading would have caught it.

### 16.3 What was deliberately NOT added

- **No dependency.** `node:crypto` only. Node 22 does not generate UUIDv7 (§4.3), so the generator
  is fifteen lines in-repo rather than a package.
- **No runtime object-code registry.** `assertRegisteredObjectCode` validates shape and is the seam
  a future registry table plugs into. Which form that authority takes is open question §14.3.
- **No consolidation of the seven existing `newId` copies.** That is a real change to live minting
  paths and belongs to an authorised step, not to a design lane.
- **No crosswalk table, no tombstone table, no Firestore Rules, no migration.**
