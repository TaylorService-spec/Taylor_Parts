---
artifact_type: architecture-review
gate: Gate A — Metadata Foundation
status: RULED — closing conditions applied
date: 2026-08-17
owner: Claude Code
depends_on: [docs/governance/metadata-architecture-ip-boundary.md, docs/specifications/metadata-architecture.md]
related_issue: 1096
---

# Gate A — Metadata Foundation Review Package

**RULED.** This package was assembled REVIEW-QUEUED and the program continued past it, per
the continuous-execution ruling. The Owner has since ruled on the question it raised
(2026-08-17 §3–§7), and the resulting architecture is recorded in §7 below. Gate A's
closing condition — that the ruling be reflected here — is met by this revision.

**What review is actually for.** Everything below is repo-only and reversible. The
question is not "may this merge" — it is **whether the spine is right before ~30 surfaces
are built on it.** Gate B (Work Orders) is the empirical half of that question; this is
the design half.

---

## 1. What Gate A comprises

| Layer | Artifact | PR | Tests |
|---|---|---|---|
| Entity / Field / Relationship | `metadata/entityDefinition.js` | #1106 **merged** `3a07e4d8` | 24 |
| List shape | `metadata/listViewDefinition.js` | #1115 | 26 |
| Component / action registries | `metadata/registry.js` | #1116 | 15 |
| Page composition | `metadata/pageDefinition.js` | #1118 | 17 |
| Specification | `specifications/metadata-architecture.md` | #1112 **merged** `abedeff5` | — |
| Governing boundary | `governance/metadata-architecture-ip-boundary.md` | #1092 **merged** `d90db46e` | — |

82 contract tests. All four layers are **data plus pure validators**. Nothing consumes
them yet — the runtimes are separate items, deliberately, so the contracts could be
reviewed before anything depends on their shape.

## 2. The five decisions worth disagreeing with

Everything else follows from these. If one is wrong, it is cheaper to find out now.

### 2.1 Four separate contracts, not one page schema

Entity, list, page and registry are separate modules referencing each other **by id
only**. Boundary §7 requires it, but the enforcement is structural: `listViewDefinition`
imports exactly two helpers from `entityDefinition` and nothing else.

*The alternative* — one `PageSchema` holding everything — is genuinely more convenient
for a first page and is how this ends up unmaintainable at page twelve.

### 2.2 Validation requires the entity; a definition cannot be checked alone

`validateListViewDefinition(def, entity)` and `validatePageDefinition(def, entity)` both
reject a null entity outright rather than doing what they can.

*Why:* a definition checked in isolation leaves every column, filter and field reference
unverified. That is precisely the metadata-that-lies problem, and a validator that
returns `[]` for an unverifiable definition is worse than no validator, because it
manufactures confidence.

### 2.3 A declared filter is a promise the backend must keep

A list may **narrow** a field's operators, never widen them. `requiredIndexes()` derives
the composite indexes a definition demands so CI can compare them against
`firestore.indexes.json`.

*The gap, stated plainly:* the derivation exists and is tested; **nothing calls it yet.**
Until the CI bridge lands (`A-INDEX-CI-BRIDGE`), this rule is enforced only for
definitions someone thought to check by hand. The mechanism is real; the enforcement is
not yet.

### 2.4 Total sort order is guaranteed twice, on purpose

The factory defaults the tiebreaker to `documentId()`; the validator independently
rejects a definition lacking one.

*Why both:* writing the test revealed the validator rule could never fire through the
factory — which was a more useful discovery than the failing assertion. Construction-time
defaulting protects definitions written in JavaScript today; the validator protects
definitions arriving as plain data from authored JSON or a future tenant override store.
Cursor paging over a tying sort key duplicates and drops rows, silently.

### 2.5 Operational section kinds are named, so their absence is visible

`SECTION_KIND` includes `LIFECYCLE`, `READINESS`, `BLOCKERS`, `NEXT_ACTIONS`,
`ATTENTION`, `CUSTODY` as first-class kinds.

*Why not a generic component slot:* because then a Work Order page expressing none of
them would be indistinguishable from one expressing all of them. **The failure this
program is most likely to suffer is not a security lapse — it is arriving at a competent
record page that turned an operations platform into CRUD screens, and passing every check
on the way.** Naming the kinds is what makes that detectable.

**This was the question Gate A raised, and it has been answered — see §7.** Naming the
kinds proved insufficient on its own: a Work Order page of fields and related lists still
validated. The resolution is a declared `compositionMode` with a conditional rule, not a
universal one.

## 3. Where the boundary is enforced structurally

| Rule | Mechanism |
|---|---|
| §6 metadata never grants authority | `declaredCapabilities()` / `declaredActionCapabilities()` return **ids**. A resolved action has no `allowed` field, and a test asserts that absence. A structural test asserts `entityDefinition.js` imports nothing from `access/` and calls no resolver — the cheapest way for this boundary to erode is an innocuous import. |
| §8 no executable metadata | A function anywhere in a definition, at any depth, is rejected. Renderers and actions are registered ids. Application code registers behavior; definitions select from what was registered. **Widening what a tenant may configure can never widen what code may run.** |
| §9 no client dataset ownership | Page size bounded; cursor pagination only. There is **no offset or page-number concept in the vocabulary at all**, and a test asserts the absence — an absence nobody checks quietly becomes an addition. |

## 4. Provenance (§1, §10)

Derived from `domain/reporting/reportCatalog.js`, which already models objects, fields
with a capability id **per field**, and single-hop relationships as validated pure data.
It exists because governed reporting needed field-level authorization — an EOS
requirement met before this program began.

Consequence worth noting: the report builder is recorded **exempt from migration**. It is
ahead of the runtime, not behind it.

## 5. What Gate A does NOT settle

Stated so review is not mistaken for broader approval:

- **No runtime exists.** No list renders, no page composes. Contracts only.
- **The index CI bridge is not wired** (§2.3).
- **Nothing populates the registries.**
- **Gate B has not run.** The framework is unproven against a non-CRM entity, which is
  the standard boundary §14 sets: *if the architecture only works well for CRM records,
  it is not yet an EOS metadata architecture.*

## 6. What Gate A does not settle — still true

Unchanged by the ruling, and stated so closure is not read as broader approval:

- **No runtime exists.** No list renders, no page composes. Contracts only.
- **The index CI bridge is not wired.** `requiredIndexes()` exists and is tested; nothing
  calls it, so §2.3's rule is enforced today only for definitions someone checked by hand.
- **Nothing populates the registries.**
- **Gate B has not run.**

## 7. RULING — page composition classification (Owner, 2026-08-17 §3–§7)

Gate A asked whether naming operational section kinds was a sufficient defense against
the CRUD-screens failure, or whether it needed to be a validation rule. The answer was
**neither, as posed**: naming is insufficient, and a universal rule is wrong.

### 7.1 What was adopted

A page **declares** what it is, and validation enforces that declaration:

```
compositionMode: RECORD | OPERATIONAL | ANALYTIC | CONFIGURATION
```

An `OPERATIONAL` page must carry at least **two distinct** operational section kinds from
the governed set (`LIFECYCLE`, `READINESS`, `BLOCKERS`, `NEXT_ACTIONS`, `ATTENTION`,
`CUSTODY`). A page of `FIELD_GROUP` and `RELATED_LIST` sections **cannot** validate as
`OPERATIONAL`.

The CRUD failure is now a build error rather than a judgement call.

### 7.2 Why conditional and not universal

Because a universal rule would have produced the failure it was meant to prevent. An
Account is genuinely record-shaped; requiring it to carry a `LIFECYCLE` section to pass
validation would yield hollow operational theatre — sections present to satisfy a
validator rather than because they mean anything.

**The validator enforces the contract a page declares. It does not decide that every
entity in EOS is operational.**

### 7.3 The three levels, which are easy to conflate

| Level | Answers | Can it be automated? |
|---|---|---|
| Validation | Does this page meet the minimum for what it *claims to be*? | Yes — and now is |
| Assessment | What operational quality does it exhibit beyond that minimum? | Partly — diagnostic only |
| **Gate B** | Is the resulting Work Order experience genuinely operation-centric? | **No** |

`assessOperationalComposition()` is retained with its role changed: diagnostics, not
enforcement. Per §6 of the ruling, no attempt is made to encode UX quality into
validation — such rules end up either trivially satisfiable or simply wrong.

### 7.4 What this deliberately does not prove

**Passing validation does not mean a Work Order page is good.** Two operational sections
can be two bad ones. Validation prevents architectural regression; **Gate B judges product
quality**, and remains the real semantic test of whether Work Order composition expresses
lifecycle, readiness, blockers, next work, operational relationships and governed actions
as a coherent operating experience.

That distinction is the most important thing this ruling establishes, because a mechanical
check that people mistake for a quality bar is worse than no check — it converts
"is this good?" into "did it pass?", which is exactly how a platform becomes compliant and
hollow.
