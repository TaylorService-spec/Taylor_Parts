---
artifact_type: specification
gate: Architecture Gate
status: Scheduled
date: 2026-08-17
owner: Claude Code
related_adrs: []
depends_on: [docs/governance/metadata-architecture-ip-boundary.md, docs/specifications/metadata-architecture.md]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: null
target_release: Metadata-to-Platform Program, before broad entity mass-definition
---

# Specification: Field Architecture v2

> **GOVERNING BOUNDARY — read first.**
> [`docs/governance/metadata-architecture-ip-boundary.md`](../governance/metadata-architecture-ip-boundary.md)
> is controlling for everything here. §3 (prohibited copying), §8 (no executable
> metadata) and §12 (stop conditions) apply to every decision downstream of this page.
>
> In particular: **no vendor-specific custom-field suffixes or naming conventions.** The
> requirement below is `systemName`, deliberately not "API Name" — the concept of a
> stable machine identity is universal; a particular platform's spelling of it is not.

**This specification authorizes no implementation.** It records a scheduled architecture
gate, its scope, and the sequencing constraint attached to it.

---

## 1. Why this exists, and why now

`FieldDefinition` v1 is **not superseded**. It remains the current read, query and render
contract, and every merged definition — `account.index`, `workOrder.index` — is written
against it and stays valid.

What v1 must not be is *final*. It was built to make a list honest at scale, and it does
that. It was not built to carry an enterprise field model: it has one identity (`id`),
one notion of a calculated value (none), and a `type` list that treats every number the
same way.

The timing is the whole point. Two entities are defined today. Every additional entity
defined against v1 increases the cost of changing the field contract — not linearly, but
by the number of definitions, tests, indexes and surfaces that would need to move
together. **The gate is scheduled BEFORE broad mass-definition of the remaining business
entities**, because after that point the cheapest correct change stops being cheap.

This is a sequencing constraint, not a stop. Work that consumes the definitions that
already exist continues.

---

## 2. Core identity

Two names, formalized as separate things:

| | Purpose | Mutability |
|---|---|---|
| `label` | Human-facing name | Editable, localizable |
| `systemName` | Stable machine identity | **Immutable after creation**, except through an explicit governed migration |

Everything that refers to a field by name refers to `systemName`: metadata references,
formulas, relationships, integrations, reporting, automation, and AI/tool contracts.

The failure this prevents is ordinary and severe. A label is the thing a business changes
its mind about — "Customer" becomes "Client", "Priority" becomes "Urgency" — and if a
formula, a report column or a tool contract is bound to the label, renaming a heading
silently breaks them. Binding to `systemName` means a rename is a display change and
nothing more.

**Not adopted:** vendor custom-field suffixes and naming conventions. `systemName` is the
EOS term.

---

## 3. Field classes

Four classes, kept distinct:

- **STANDARD** — an EOS-defined business field.
- **SYSTEM** — platform-maintained (identity, timestamps, audit lineage).
- **CUSTOM** — tenant-defined.
- **DERIVED** — computed rather than stored-and-entered.

`DERIVED` subdivides further, and **must not be collapsed into one generic
"calculated field"**:

- **FORMULA** — a deterministic expression over approved field dependencies.
- **LOOKUP** — obtains a value through a declared relationship.
- **ROLLUP** — aggregates related records.
- **PROJECTION** — governed/materialized operational or business state.

The four differ in where the value comes from, what it costs to read, when it can be
stale, and what authority it requires. A single "calculated" class would hide all four
distinctions behind one word, and the first thing lost would be that a ROLLUP is an
aggregate — precisely the confusion this program has already had to correct twice, on
the Customers portfolio cards and on inventory analytics.

---

## 4. Numeric semantics

Explicit semantics for: `INTEGER`, `DECIMAL`, `PERCENTAGE`, `RATIO`, `CURRENCY`,
`QUANTITY` (unit-aware).

Each declares:

- storage precision
- calculation precision
- display precision
- rounding mode
- minimum / maximum
- step, where applicable

**Formatting must never silently change an authoritative business value.** Display
precision is a rendering decision; it must not be the reason a stored number differs from
the number a calculation used. Rounding at display time that feeds back into arithmetic is
how totals stop reconciling.

**Percentage storage semantics must be explicit.** Whether `0.15` or `15` is stored for
"15%" is not inferable from the value, and two subsystems guessing differently produces
figures wrong by a factor of one hundred that still look plausible.

`CURRENCY` continues to follow the existing repo rule: integer minor units plus a currency
field, never a float.

---

## 5. Derived fields

No arbitrary JavaScript. No executable metadata (§8 of the boundary). Expressions use a
**constrained, validated vocabulary** — a closed set of operators and functions that can be
parsed, type-checked and dependency-analyzed before it ever runs.

A definition that could carry a function would make every definition a code path, and
"what can this configuration do?" would stop having an answerable form.

---

## 6. Dependency model

- Derived fields declare their dependencies by **`systemName`**.
- The dependency graph is validated.
- **Circular dependencies are rejected** — at definition time, not at evaluation time.
- Cross-entity dependencies respect the authority of the underlying data.

The last point is the load-bearing one. A rollup that reads records the viewer may not
read would be an **authorization bypass wearing a field's clothing**: the viewer never
sees the rows, only a number derived from them, which is the same disclosure with an extra
step. Authority is evaluated against the underlying data, not against the field that
summarizes it.

---

## 7. Queryability

Three distinct properties, declared separately:

- **VIRTUAL** — computed on read; displayable, not queryable.
- **MATERIALIZED** — persisted; queryable subject to an index.
- **AGGREGATE** — a complete measure over a set; not a row property at all.

**Displayable does not imply sortable or filterable at enterprise scale.** A field the
backend cannot filter on is a field the metadata must not offer a filter for — the v1 rule
that a declared operator is a promise, extended to derived and computed values where the
temptation to over-promise is strongest, because the value is *right there* on the row
once it has been computed for fifty of them.

---

## 8. Field behavior

The durable contract covers:

`required` / `optional` · `nullable` · default value · `mutable` / `immutable` ·
`createable` · `updateable` · read authority · write authority · validation constraints ·
sensitive classification · audit behavior · deprecation

**Metadata declares authority requirements. Metadata does not grant authority.** This is
§6 of the boundary and it does not soften in v2: a field carrying `readAuthority` is
stating what a caller must hold, and Rules plus trusted commands remain the only things
that decide whether the caller holds it.

`deprecation` is included deliberately. A field model without a way to retire a field
accumulates fields forever, and the alternative — deleting one — breaks every reference
that was correctly bound to its `systemName`.

---

## 9. Standard field vocabulary

Investigate an EOS-native standard vocabulary for concepts that genuinely recur: identity,
created/updated timestamps, ownership, contact information, addresses, currency/amounts,
priority, dates, assignment.

Two constraints:

- **Do not force every entity to use every standard field.** A vocabulary that mandates
  presence produces entities carrying fields nobody populates, which then read as missing
  data rather than as inapplicable.
- **Standardize semantic meaning, not mere naming.** The value is that "owner" means the
  same thing on a Work Order as on an Account. Two fields sharing a name while meaning
  different things is worse than two honestly different names.

The repo already demonstrates the payoff and the cost of not having this: Work Order
status and priority each needed a single vocabulary because surfaces had drifted, and both
were built only after the drift was visible.

---

## 10. Storage separation

**Do not assume `systemName == Firestore storage path.**

They may initially match, and for the fields defined today they do. The architecture must
keep three concerns separate:

```
label            what a person reads
systemName       what the platform references
storage mapping  where the value physically lives
```

If `systemName` *is* the storage path, then every future migration, projection, legacy
field mapping and tenant custom field makes a Firestore implementation detail part of the
EOS platform contract — and the contract can then only change when the database does.

---

## 11. Custom field seam

Tenant-defined fields must eventually participate in the same rendering and composition
system as EOS standard fields, without:

- becoming executable metadata, or
- overriding protected EOS semantics.

**Build the seam, not the product.** A complete custom-field administration product is not
in scope here and is not authorized by this gate. What is in scope is ensuring v2's shape
does not foreclose one — a field model that assumes every field is known at build time
would have to be reopened to add the first tenant field.

---

## 12. Sequencing

1. v1 remains the contract. Existing definitions and the surfaces consuming them continue.
2. Work that consumes already-defined entities is **not** blocked by this gate.
3. **Broad mass-definition of the remaining business entities waits for v2.** Defining
   many entities against v1 is what would make the field contract expensive to evolve.
4. This gate returns under the existing program-wide stop conditions only.

---

## 13. What this document does not do

It does not choose an expression syntax, a precision default, a storage layout, or a
migration mechanism. Those are v2's design work. This records the required scope, the
distinctions that must not be collapsed, and the point in the schedule before which the
work has to happen.
