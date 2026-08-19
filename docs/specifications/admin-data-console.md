---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-08-19
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Sprint Specification: <sprint name>

**Architecture Review:** <link> — Approved YYYY-MM-DD

## Executive summary

An admin-facing data console: browse object metadata, inspect any record's real stored values,
export query results, and import or bulk-edit records. The reference is **Salesforce Inspector
Reloaded**, which admins use to answer "what does this record actually contain" and "get me this
data out" without waiting for a screen to be built for it.

The gap is real. There is **no export anywhere in this product** — Report Builder can define and
run a report and then not get the data out. Import exists for **Contacts only**
(`domain/contactImport.js`). Meanwhile **30 EntityDefinitions** are already registered with
fields, types and operators, so the metadata needed to drive a generic console mostly exists.

**One line governs the whole design.** Salesforce Inspector's power comes largely from bypassing
the UI: it drives a generic REST/SOQL API under the user's own permissions. This platform is
built the other way — writes go through governed commands with capability checks and audit
events. A generic paste-and-update tool here would be an audit bypass wearing an admin tool's
clothes.

So: **reads generic, writes never.**

## Relationship to the approved Admin portal — read this before building

`docs/specifications/enterprise-access-and-administration-platform.md` is SPECIFICATION-APPROVED
and lists among its hard prohibitions: *"any Admin UI beyond the ADR-approved MVP"*, and among
its deferrals *"complex builders"*. This console is **not** part of that MVP and does not extend
it by implication. It is a separately-authorized addition (Owner, 2026-08-19) and is specified
here so the boundary stays explicit rather than being absorbed into ADR-005's Admin portal by
proximity.

Nothing here changes the authorization model, and no capability, Role, Rule or grant is created
by this document.

## Sprint objective

Give an admin one place to see what the system actually holds — object metadata, record values,
and data out — and one governed path for data in, without opening a route around the audit trail.

## Scope

### 1. Metadata browser (cheapest, build first)

Read-only view over the registered EntityDefinitions: objects, their fields, types, which
operators each field supports, relationships. This is presentation over data that already exists
in `src/metadata/definitions/` — no new source of truth, and it stays correct automatically
because it reads the same definitions the app renders from.

### 2. Record inspector — "show all data"

Given an object and a record id, show **every stored field and its raw value**, including fields
no page displays. This is the feature that repays itself fastest: today, answering "what does
this record actually contain" means reading source or writing a script.

**Capability-filtered, per field.** The report catalog already registers field-level ids —
`report.customer.field.taxStatus.read`, `report.contact.field.email.read` and dozens more. The
inspector honours them: a field the caller cannot read is **absent**, and the response says how
many fields were withheld rather than silently returning a partial record that looks complete.

### 3. Export

Query results out, as CSV. Missing entirely today.

**Export is an exfiltration surface, not a convenience.** It gets its own capability, and every
export writes an audit event recording who, which object, which fields, the row count and the
filter. "Who exported the customer list, and when" must be answerable. Row caps apply and a
truncated export must say so on the artifact itself, not only on screen — a CSV that silently
stops at 10,000 rows becomes someone's source of truth.

### 3.1 Who may export what (Owner, 2026-08-19)

**Admin: no restrictions.** Admin exports any object, all rows, all fields. Every export is still
audited — "no restrictions" governs *what may be exported*, not *whether it is recorded*.

**Sales: only what they own.** A sales role exports only records it owns, filtered server-side by
the same resolver that authorizes the read. Ownership is never a client-side filter over a fuller
result set, because a client filter means the data was already sent.

#### What "own" means, per object

Ownership already exists in the data model, keyed by **employeeId**, not uid:

| Object | Ownership field | Notes |
|---|---|---|
| Account | `accountOwner.assignedToEmployeeId` | stored inside a Person Assignment map |
| Opportunity | `ownerEmployeeId` | |
| Sales Order | `ownerEmployeeId` | caller-supplied at creation |
| Contact | — | owned *derivatively*, through its parent Account |
| Location | — | owned *derivatively*, through its parent Account |
| Part | **none** | Parts have no owner concept at all |

Two consequences that must be decided rather than discovered during implementation:

1. **Contacts and Locations have no owner of their own.** "What they own" can only mean "belonging
   to an Account they own". That is a defensible reading and it is what this specification adopts
   — but it is a derivation, not a field, and a Contact whose Account is reassigned silently
   changes who can export it.
2. **Parts have no owner.** "Only what they own" is therefore undefined for Parts, and the honest
   result is that a sales role exports **no** Parts rather than all of them. Falling back to
   "unowned means everyone" would turn an ownership rule into an open door on the one object the
   duplicate work just widened write access to.

#### The manager rollup is NOT specified here

Whether a **sales manager** owns their team's records is the coverage/territory question the Owner
recorded as a roadmap requirement and explicitly deferred ("record and preserve the seams, do not
build during the runway"). This specification does not resolve it. Until it is resolved,
`salesManager` exports what that person owns directly — the same rule as any other sales role —
and any team rollup is a later, separate change. Inventing a rollup here would be building the
deferred territory model by accident.

#### An existing invariant this ruling collides with

The permission catalog states, for saved report definitions:

> ownership (`ownerUid` == the trusted actor) is enforced by the service itself … there is no
> owner-override id here, matching "private by default, **no admin override**"

So **admin deliberately cannot see another user's saved report definitions today.** Read
literally, "admins have no restrictions" reverses that invariant.

This specification does **not** apply the ruling there, because the two are different things: a
saved report *definition* is a person's private working artifact, whereas the *records* the
console exports are company data. The ruling is read as covering company records — Accounts,
Contacts, Locations, Parts, Opportunities — and the report-definition privacy invariant stands
unchanged.

**If the Owner does intend admin to read others' saved report definitions, that is a separate
decision and a separate change**, and it should be made deliberately rather than inherited from a
sentence about exports.

### 4. Import and bulk edit — through governed commands only

Generalizes today's Contact-only import across objects.

- Every write routes through the **same governed command** the UI uses for that object. No
  generic collection writer, no client-direct path, no "admin mode" that skips validation.
- **Duplicate rules apply** exactly as specified in `duplicate-detection.md`, including its
  per-row requirement: a blocking rule rejects **rows**, never the file, and clean rows import.
- Every imported or bulk-edited record produces the same audit event as the equivalent UI action.
  An import of 200 records is 200 audited writes, not one opaque bulk event.
- **Dry run is mandatory before any write**: the console shows what would be created, updated,
  rejected and why, and the operator confirms. This is the same posture as the provisioning and
  backfill CLIs already in this repo, which all require a dry-run manifest first.
- **Delete is out of scope.** A generic bulk delete over governed records is not a tool this
  system should have before merge and retention questions are settled.

## Explicitly out of scope

- **Bulk delete**, per above.
- **A generic REST/SOQL-style query API.** The thing that makes Inspector powerful in Salesforce
  is the thing this platform deliberately does not expose. Queries run through governed read
  services with the caller's capabilities applied.
- **Editing metadata definitions.** This console reads EntityDefinitions; authoring them is a
  different concern and is deferred in the approved Admin spec.
- **Impersonation** — explicitly deferred by ADR-005 and not reintroduced here.
- **Anything that widens the ADR-005 Admin-portal MVP**, per the section above.

## Technical design

**Reads are one generic seam, writes are N specific ones.** That asymmetry is the design, not an
inconsistency: a single governed read service can serve any object because capability filtering
is uniform, while each object's write has its own preconditions, validation and audit shape that a
generic writer would have to reimplement — badly.

**The metadata is the schema.** The browser, the inspector's field list, the export column picker
and the import column mapper all read the same EntityDefinitions. Adding a new object to the
console is registering its definition, not extending the console.

**Field-level capability filtering is shared** between inspector and export. One implementation,
so a field withheld in one is withheld in the other.

## Firestore Rules impact

None expected: everything routes through existing governed read services and existing governed
write commands. If any part of this turns out to need a new client-direct read, that is a signal
the design has drifted from "reads generic, writes never" and should be re-examined rather than
solved with a Rules change.

## UI impact

New Administration surfaces: Metadata Browser, Record Inspector, Export, Import. Consistent with
the existing `AdminUsers` / `AdminRolesPermissions` screens rather than a separate console shell.

Two states matter more than usual here:

- **Withheld fields** must read as "you cannot see this" — never as absent data. An inspector
  that silently omits fields teaches admins to trust an incomplete picture.
- **Truncated results** must be unmistakable, on screen and in the exported file.

## Testing strategy

Metadata reading, capability filtering, CSV shaping and import row validation are pure and
unit-testable. Field-level filtering gets adversarial tests: a caller lacking
`report.customer.field.taxStatus.read` must not receive that field through the inspector, the
export, or an error message — the last being the easy leak to miss.

Import tests reuse the duplicate-rule fixtures so the two specifications cannot drift.

## Rollback strategy

The browser, inspector and export are read-only; disabling them removes surfaces and changes no
data. Import is the one path that writes, and it writes only through existing governed commands,
so its rollback story is whatever those commands already provide — no new mutation path is
introduced that would need its own reversal.

## Acceptance criteria

1. An admin can browse every registered object, its fields and their types, without a code change.
2. The record inspector shows every stored field the caller is permitted to read, and states how
   many were withheld.
3. A caller lacking a field-level read capability receives that field from no surface — inspector,
   export, or error text.
4. Export produces a CSV of the query result and writes an audit event naming who, object, fields,
   row count and filter. Admin export is unrestricted in scope and still fully audited.
5. A sales role's export returns only records it owns, filtered SERVER-SIDE. A sales role exporting
   Parts -- which have no owner -- receives no rows, not all rows.
6. A truncated export is marked as truncated in the file itself, not only on screen.
7. Import performs a mandatory dry run showing creates, updates and rejects with reasons, before
   any write.
8. Every imported record produces the same audit event as the equivalent UI action.
9. Import honours duplicate rules per row: blocked rows are rejected with reasons, clean rows
   import, and the file is never rejected wholesale for duplicates.
10. No surface in this console writes to a collection except through an existing governed command.
11. No bulk delete exists.

## Risks

- **This becomes a way around the governed write path.** The single largest risk, and the reason
  "writes never generic" is stated as an acceptance criterion rather than a principle. Review
  should treat any new direct collection write in this console as a defect.
- **Export is the data-loss surface.** Mitigated by its own capability, audit, and honest
  truncation.
- **Field-level filtering is easy to leak through error messages.** Called out in testing.
- **Scope creep into the ADR-005 Admin portal.** Mitigated by the boundary section above.

## Open questions

1. ~~Which capabilities, and who holds each?~~ **PARTLY ANSWERED (Owner, 2026-08-19): admin
   holds all of them without restriction; sales holds export scoped to what it owns.** Ids remain
   as proposed — `admin.console.metadata.read`, `admin.console.record.read`,
   `admin.data.export`, `admin.data.import` — distinct so export can be granted without import.
   Still open: whether `salesManager` differs from `salesManager`-as-individual once the
   deferred coverage/territory model lands, and whether any non-admin role gets `admin.data.import`.
2. **Export row cap**, and whether a large export needs approval rather than just an audit event.
3. **Does bulk edit ship with import, or later?** Import alone is the smaller, safer first cut;
   bulk edit multiplies the blast radius of a bad mapping.
