---
artifact_type: specification
gate: Architecture Capture
status: Recorded
date: 2026-08-17
owner: Claude Code
related_adrs: []
depends_on: [docs/governance/metadata-architecture-ip-boundary.md, docs/specifications/field-architecture-v2.md]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: null
target_release: Metadata-to-Platform Program, post Field Architecture v2
---

# Specification: EOS Platform Architecture Addendum

> **GOVERNING BOUNDARY.** [`metadata-architecture-ip-boundary.md`](../governance/metadata-architecture-ip-boundary.md)
> is controlling. Nothing here adopts another platform's metadata schema, terminology
> bundle, URL conventions, automation model or proprietary behavior. Where an industry
> concept is genuinely generic — a query language, a flow builder, a bulk importer — it is
> implemented from EOS requirements in EOS terms.

This records architecture decisions taken after the Field Architecture v2 package. It is
**capture and sequencing**, not authorization to build. Two of its items are implemented
already (§1 provenance; §10 traversal rules, inside the v2 formula contract); the rest are
scheduled workstreams.

## Reconciliation — what already exists

Recorded first, because the instruction is to extend rather than duplicate.

| Concern | Existing authority | Disposition |
|---|---|---|
| Mutation history | `functions/src/access/auditEventWriter.ts` — the audit event contract with actor, action, target, outcome, scope | **Extended, not replaced.** Provenance describes current state; audit describes each material mutation. §3 makes the distinction explicit rather than building a second history. |
| Actor identity/display | existing governed actor architecture | **Reused.** The origin seam names `initiatedBy` and `sourceExecutionId` but resolves actors through what exists. |
| Report definitions | `docs/specifications/governed-object-based-report-creator.md` | **Convergence target.** The unified query model (§16) must absorb it rather than run beside it. |
| Field identity, numeric semantics, derived fields, queryability | `docs/specifications/field-architecture-v2.md`, `src/metadata/v2/` | **The base contract.** Every workstream below consumes it; none re-derives it. |
| Board scope | `src/metadata/boardScope.js` | Already distinct from list pagination. The unified query model must not collapse the distinction. |

---

## 1. Record provenance — a platform invariant (IMPLEMENTED)

Every durable EOS business record carries `createdAt` / `createdBy`. Every **mutable**
durable record additionally carries `updatedAt` / `updatedBy`.

These are `SYSTEM` fields. Admins may expose them on pages, lists, reports and exports
where authorized; they may not redefine their semantics or write them directly.

**Server-authoritative.** A client-supplied timestamp or actor identity is a *claim*, not
provenance — any caller able to write the record is able to write the claim. So the fields
carry no `writeCapability`: there is no authority under which a caller sets them, because a
trusted command writes them or they are not provenance.

**Append-only records get two fields, not four.** An issued invoice or a posted ledger
entry has no mutation path; emitting `updatedAt` would imply one that must not exist.

**Exemptions require a stated reason.** Caches, locks, transient execution state and derived
indexes are not business records. Forcing provenance onto them would make the invariant
meaningless by making it universal — but an exemption without a reason is a gap somebody
left rather than a decision somebody made, so validation rejects it.

**Synonyms are rejected.** `creationDate` beside `createdAt` is two answers to one question,
and every report, formula and export then has to pick one. Where legacy storage differs, the
separation is `systemName` vs `storagePath`, never a second name in the standard vocabulary.

Implemented at `src/metadata/v2/provenance.js`.

## 2. Actor and origin provenance (SEAM)

`createdBy` is not always a human at a keyboard. Origins: `USER`, `AUTOMATION`, `IMPORT`,
`INTEGRATION`, `SYSTEM`, `AI_ASSISTED`.

The seam names `createdVia`, `updatedVia`, `initiatedBy`, `sourceExecutionId`,
`correlationId` — **shape to be reconciled against the existing audit/event architecture
before anything writes them.** Inventing a parallel actor vocabulary is precisely what this
addendum forbids.

The capability required is that these stay answerable: *who ultimately caused this, when,
through what mechanism, from which execution, and what governed operation occurred.*
"A dispatcher did this" and "an import did this on a dispatcher's behalf" are different
answers, and the difference is the first thing asked when data looks wrong.

## 3. Provenance is not audit history

Provenance describes the record's **current** state. It cannot answer "what changed on the
fourteenth", and reconstructing history from `updatedBy`/`updatedAt` yields a confident
wrong answer: the last writer looks like the only writer.

Material mutation history — each governed change, its actor, timestamp, changed state,
mechanism, execution identity and governed action — remains the audit event architecture's.

---

## 4–9. Admin metadata configuration and the page designer (SCHEDULED)

Admins configure EOS through business concepts, not Firestore, React, JSON or source. The
navigation sketch (Administration → Data Model → Entity → Fields / Pages / List Views /
Actions / Automation / Permissions) is illustrative; the architectural requirement is that
metadata is manageable **without editing implementation or storage artifacts**.

Admin field creation exposes business-friendly choices (Text, Number, Currency, Percentage,
Date, Boolean, Picklist, Multi-select Picklist, Relationship, Formula, Lookup, Rollup) and
EOS translates each into the governed field contract. `systemName` is proposed from the
label, may be corrected before creation, and is stable after — a later label change never
moves it.

**Optional semantic documentation, not mandatory paperwork.** `description`, `purpose`,
`businessMeaning`, `ownerDomain`, `sourceOfTruth` are supported and are distinct from
frontend help text. Their absence must never invalidate an otherwise valid field: requiring
documentation to create a simple field produces documentation written to satisfy a
validator.

**Page metadata requests presentation; it never grants authority.** "Editable" means an
editable presentation is requested *if* the field is updateable, the viewer holds governed
write authority, the domain command permits the mutation, and the record's lifecycle state
allows it. Page configuration can never bypass a governed command.

**Operational pages are protected.** Where an `OPERATIONAL` page contract requires
Lifecycle / Readiness / Blockers / Next Actions, layout flexibility must not remove or
reconfigure them into violation. Placement flexibility and composition invariants are
separate concerns and only one of them is negotiable.

**Preview evaluates real authority.** Preview-as-persona must resolve actual governed
visibility and editability rather than inventing page-builder permissions — a preview with
its own permission model tells the admin what the builder thinks, not what the platform
will do. Publication validates field definitions, systemName uniqueness, relationship
validity, the derived dependency graph, authority declarations, page and operational
composition, queryability, required indexes, protected-name collisions and unsupported
filters. **Publication must not succeed where the backend cannot honestly support the
declared behavior.**

## 10. Declared relationship traversal (RULES IMPLEMENTED)

Fields traverse entities only through **registered relationships**. One hop is the first
durable capability; bounded multi-hop may follow with an explicit depth policy.

Arbitrary dot-path traversal is forbidden, and the v2 formula contract already enforces it:
a field reference containing a dot is rejected, because a dotted path silently crosses an
entity boundary that `LOOKUP` exists to make explicit and authority-checked.

Traversal validates that the relationship exists, the direction is valid, the source field
exists, the result type is known, authority is preserved, cycles are rejected, and
queryability claims are honest.

---

## 11–13. Automation Architecture v1 (SCHEDULED)

Visual flow builder → declarative EOS automation model → governed execution engine.

`WHEN` (trigger) / `IF` (conditions) / `THEN` (registered governed actions). No
unrestricted JavaScript, Python, SQL writes, `eval`, arbitrary functions or executable
metadata reaches an administrator.

**The core invariant:** *admins may compose approved business capabilities; automation may
not invent new executable authority.* An automation engine that could write arbitrary
fields would be a database backdoor with a friendly interface. Trigger authority, field
read authority, traversal authority, command authority, mutation rules, tenant scope and
lifecycle rules all continue to apply.

Operability is part of v1, not a later hardening pass: validation before activation,
dry-run, execution audit, causality and correlation identity, loop and recursion
prevention, failure state, retry and idempotency, draft/active lifecycle, versioning.
Automation A changing a status that triggers B changing a status that triggers A is the
canonical incident, and execution causality is cheaper to design than to diagnose.

## 14–18. EQL and the unified query model (SCHEDULED)

EQL is SQL-**inspired**, because SQL concepts are already understood by developers,
analysts, admins, BI users and AI systems. It claims **no ANSI compatibility**, exposes no
Firestore, and must not imply relational joins EOS cannot execute honestly.

It references stable `systemName`s, so a label change never breaks a query. Relationships
are traversed by their registered names (`account.name`), not by reconstructing storage
join predicates — EOS metadata already owns that relationship, and arbitrary joins are not
permitted merely because SQL syntax makes them expressible.

**The convergence objective is the load-bearing part of this section.** List filters, saved
views, the report builder, automation conditions, EQL, AI-generated queries and the admin
visual builder converge on **one** internal governed query model:

```
visual builder ─┐
list filters ───┤
reports ────────┼──▶ EOS Query AST ──▶ metadata validation ──▶ authority validation
automation ─────┤                      ──▶ queryability validation ──▶ index validation
EQL ────────────┤                      ──▶ planner ──▶ governed execution
AI ─────────────┘
```

Independent query semantics per feature is how six subsystems end up disagreeing about
what a filter means. This is recorded as a **shared architectural dependency** so it is not
rediscovered five times.

**EQL is read-oriented.** No `UPDATE`, `DELETE`, `INSERT`, `DROP` or `ALTER`. Writes go
through registered governed commands. Bulk modification is: query → preview matched scope →
choose a registered governed action → validate authority → execute → audit.

**AI receives no bypass.** AI-generated queries, reports, formulas, page definitions and
flows pass the same metadata, authority, queryability, action, tenant-isolation and audit
validation as human-authored ones. That is the point of one contract.

## 19–29. Bulk Data Architecture v1 (SCHEDULED)

Import and export, both first-class.

**The core invariant:** *bulk changes scale, not authority.* A bulk operation cannot do
what its initiating actor could not do through the governed platform one record at a time.

**Identity** uses the approved model: `recordId`, business reference, approved
`alternateKey` — never a mutable human label. Matching semantics: 0 matches → create only
if mode and authority permit, else reject; 1 match → eligible for governed update; **>1
matches → integrity failure, never a guess.** `unique` and `alternateKey` remain separate,
as v2 already enforces.

**Dry run mutates nothing** and reports creates, updates, validation failures, no-matches
and ambiguous-key conflicts. Correctness scope includes large-file and asynchronous
processing, batching, resumability, idempotency, partial failure, retry, relationship
resolution, enum and date and currency and percentage parsing, numeric precision, derived-
field import restrictions, duplicate detection, automation-trigger policy, compensation
where feasible, tenant isolation and audit lineage. Purpose-built governed bulk commands
may be required where per-record command execution is inappropriate — but volume is never a
reason to bypass domain commands.

**Export modes** are distinct: human (display values), update (immutable `recordId` plus
canonical machine values for deterministic round-trip), integration (`systemName` schema
and approved alternate keys), template, and audit/archive. Not every user gets every mode.

**Export authority is a hard boundary.** An export may never exceed the initiating user's
authorized read scope — tenant, entity, row, field, sensitivity. If a user may read 4,200
accounts and 8 fields, "Export All" means *all records and fields within their authorized
export scope*, not 4,201 records or a ninth field. UI hiding is not enforcement; the
server-side job enforces it.

Large exports must not become browser-side whole-collection reads, must not present a
partial page as a complete export, and must not silently broaden a list's scope because an
export was requested.

**Display values are not machine values.** `Active` / `12.69%` for humans; `ACTIVE` /
`0.126875` for round-trip. Formatting must never corrupt an authoritative value through an
export/re-import cycle — the same rule v2 enforces by making display formatting return a
string.

**Every export produces an immutable audit record**: who, when, tenant, dataset, requested
scope, *effective authorized* scope, fields, record count, mode, outcome, result identity,
sensitivity classification, correlation id — plus denied attempts where policy requires.
The architecture must be able to answer who exported what, when, from which scope, how many
records, which fields, through which execution. Bulk mutations carry the same lineage, and
a record changed by `IMPORT-000192` must be traceable to that job.

**Export authority is not inferred from read authority.** It may never exceed it, and
policy may later make it stricter. The seam is preserved now precisely because retrofitting
a narrower authority after people rely on the wider one is the expensive direction.

## 30–31. Integration with Field Architecture v2

The provenance fields join the standard `SYSTEM` vocabulary (§1, implemented).
`systemName`, relationship traversal, formula dependencies, alternate keys, numeric
semantics, queryability, authority declarations, custom fields and record provenance are
**one set of concepts reused** by pages, lists, reports, automation, EQL, AI, imports and
exports — not per-subsystem versions of the same idea.

## 32. Sequencing

Recorded as ledger entries so none is rediscovered: Automation Architecture v1, EQL /
Governed Query Architecture v1, Bulk Data Architecture v1, Admin Metadata Configuration /
Page Builder, and the unified query model as a **shared dependency** of the first three
plus Lists and Reports.

None of these blocks current executable migration work.
