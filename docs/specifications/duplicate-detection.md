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

Five record types can be duplicated today with nothing to stop or even notice it: **Account,
Contact, Location, Part and Opportunity**. `createAccount`, `createContact` and `createLocation`
call `.add()` with no comparison against existing records at all. The only duplicate logic
anywhere — `contactDuplicateKey` in `domain/contactCsvImport.js` — runs on CSV import only and is
invisible to every interactive path.

This is now the mitigation the Owner attached to granting `inventory.catalog.manage` to `admin`,
`operationsManager` and `fieldManager` (2026-08-19): a field manager creating Parts at a machine
is the highest-volume, lowest-context place a duplicate is born.

**The model separates two concerns this repository would otherwise conflate**, which is the
difference between rules people can maintain and a matcher only its author understands:

| Object | Answers | Owner-editable in Admin |
|---|---|---|
| **Matching Rule** | *How* are two records compared? | yes |
| **Duplicate Rule** | *What happens* when they match? | yes |
| **Duplicate Record Set** | The queue of what was found | worked, not authored |

Rules are **metadata, not code** — created and modified from the Administration page, versioned
and audited, so changing what counts as a duplicate does not require a release.

## Sprint objective

Ship admin-authored duplicate rules for the five entities: a Matching Rule builder, a Duplicate
Rule policy (per-action Allow/Block with Alert and Report), the runtime that evaluates them on
create and edit, and the queue that collects what they find.

## Scope

### Matching Rule — how records are compared

Per entity, an ordered list of **field criteria**, each with a **match method**:

| Method | Behaviour | Example |
|---|---|---|
| `exact` | byte equality after trim | part number |
| `normalized` | case, punctuation, whitespace collapsed | `TST-1234` = `tst 1234` |
| `companyName` | normalized + legal suffixes stripped (`Inc`, `LLC`, `Corp`, `Ltd`) | `Taylor Freezer of Arizona` = `TAYLOR FREEZER OF ARIZONA, LLC` |
| `address` | normalized + street abbreviations (`St`/`Street`, `N`/`North`) | `123 Main St` = `123 North Main Street` |
| `phone` | digits only, trailing N digits | `(602) 555-0134` = `6025550134` |
| `email` | case-insensitive, whole value | the existing Contact rule |
| `acronym` | initials of significant words | `TFA` = `Taylor Freezer Arizona` |

Each criterion also carries **match blanks** (default off — two records both missing a phone are
not thereby similar; this is the single most common source of false positives) and the criteria
combine with **boolean logic**, defaulting to AND with custom expressions supported
(`1 AND (2 OR 3)`).

Deliberately a **named, bounded method set** rather than free-form fuzzy matching or user-entered
expressions. Every verdict must be explainable as "these fields matched by these methods" —
an unexplainable warning is one people learn to click through, and a free-form expression
language in an admin screen is an injection and support surface nobody here needs.

### Duplicate Rule — what happens on a match

Per entity, referencing one Matching Rule, and configured **separately for Create and for Edit**
(the Owner's "anything that *becomes* a duplicate" — editing a record into collision is as real
as creating one):

- **Action**: `allow` or `block`
- **Alert**: show a warning, with admin-authored message text
- **Report**: record the pair into the queue
- **Active**: rules can be deactivated without deletion
- **Bypass**: a capability that exempts its holder

Default posture for every entity at launch: **allow + alert + report**. Blocking is available
where the Owner wants it — the Part exact-part-number case is the likeliest candidate — but is
opt-in per rule, because a false positive that hard-stops a technician mid-job is how detection
gets switched off entirely.

### Duplicate Record Set — the queue

Every reported match becomes a set containing the two (or more) records, the rule that fired,
which criteria matched, who triggered it and when, and whether they proceeded. Worked outcomes:
`merged`, `not-a-duplicate`, `open`.

**A pair marked `not-a-duplicate` must never resurface.** Without that the queue refills with
rejected pairs every scan and stops being read.

### Admin surface

Lives with the existing Administration screens (`AdminRolesPermissions`, `AdminUsers`). Matching
Rules and Duplicate Rules are listed, created, edited, activated and deactivated there, with the
criteria builder following the idiom the Report Builder already establishes — the same
field-picker + operator + value shape people in this product already know.

## Seeded rules — everything below is DATA, not code

**No entity has compiled-in matching logic.** Every rule described in this specification ships as
a **seeded record** in `matching_rules` / `duplicate_rules`, visible in Administration →
Duplicate Rules, and editable, deactivatable and deletable there like any other rule. If a rule
in this document cannot be changed from that screen, the implementation is wrong.

This includes the Part decisions reached with the Owner on 2026-08-19 — they are recorded here as
the *initial values* of editable rows, not as behaviour:

| Entity | Criteria | Method | Action (Create / Edit) |
|---|---|---|---|
| Part | `internalPartNumber` | `normalized` | **block** / block |
| Part | `manufacturerPartNumber` AND `manufacturerId` | `normalized` + `exact` | allow + alert + report |
| Account | `name` | `companyName` | allow + alert + report |
| Account | `billingAddress` OR `phone` | `address` / `phone` | allow + alert + report |
| Contact | `email` | `email` | allow + alert + report |
| Contact | `name` AND `phone` | `normalized` + `phone` | allow + alert + report |
| Location | `street` AND `postalCode` | `address` + `exact` | allow + alert + report |
| Opportunity | `accountId` AND `name` AND both open | `exact` + `normalized` | allow + alert + report |

### Why Part blocks on `internalPartNumber` and not on `manufacturerPartNumber`

The two fields make different claims. `internalPartNumber` is **this catalog's own** number — it
is the `referenceField`, it is required, and `partMasterCommands.ts` already throws
`AlreadyExistsError` when one is claimed by another Part. Blocking at the form therefore prevents
nothing new; it converts a confusing post-submit failure into a clear pre-submit message.

`manufacturerPartNumber` is **someone else's** number and carries no uniqueness claim. Two
manufacturers can independently ship a part numbered `X-100`; those are two genuinely different
Parts with two different `internalPartNumber`s, and matching on the manufacturer's number alone
would flag them as duplicates when they are not. It only means something **paired with
`manufacturerId`** — same manufacturer, same number, twice.

### The case the alert text has to carry

A Part is stored with `primaryManufacturerId`, and `part_supplier_items` is keyed by `partId` —
so **one Part can be sourced from several manufacturers**. When the *same physical part* starts
being made by a second company, the correct action is adding a supplier item to the existing
Part, **not** creating a second Part. Someone creating a second Part record for it IS a duplicate
worth catching, and the seeded alert text says what to do instead:

> A part with this number already exists. If this is the same part from a new manufacturer, add a
> supplier item to the existing part rather than creating a new one.

That sentence is seeded data on the rule, not a string in a component — which is the whole point
of the rule living in Admin.

## Convergence: the existing CSV import rule

`contactDuplicateKey` (`domain/contactCsvImport.js`) currently hardcodes the Contact rule —
email, else name+phone — and CSV import is its only consumer. Once Contact matching is an
editable rule, leaving that function as it is produces **two sources of truth**: an admin edits
the Contact rule, interactive create honours it, and CSV import silently keeps the old behaviour.

CSV import must therefore evaluate the same rules as every other path. The existing rule is
seeded as the Contact rule's initial value so today's import behaviour is preserved exactly on
day one, and diverges only if an admin deliberately changes it.

### Import rejects ROWS, never the file (Owner, 2026-08-19)

Today `validateRows` already does the right thing: a duplicate row is pushed to `rejected` with
a human reason and the clean rows still import. The **only** whole-file rejection is the row-limit
case, which is a different concern.

Introducing a `block` action must not regress that. `block` is evaluated **per row** in an
import: matching rows are rejected with the rule's message and reported to the queue, and every
non-matching row imports normally. A single bad row must never cost someone a 400-row file — that
is how people start editing CSVs to defeat the check, which is worse than having no check.

Two behaviours in the current implementation are requirements, not incidental, and must survive
the migration to rule-driven matching:

- **Duplicates are detected against existing records AND within the file itself.** `seen` is
  seeded from the existing contacts and then accumulates as rows are read, so a file containing
  the same person twice rejects the second occurrence. Rule-driven matching must compare each row
  against both sets.
- **An existing record is never overwritten by an import.** Import can add; it cannot silently
  update, which is the import-shaped case of the "no silent merge" prohibition.

The rejection reason shown to the user comes from the rule's admin-authored alert text, so the
wording is editable like everything else rather than the hardcoded
`"Duplicate — already exists"` string it is today.

## Explicitly out of scope

- **Merging.** What happens to the losing record's Work Orders, Sales Orders, stock and history
  is a governed change needing its own specification. This sprint produces the queue and the
  verdict; queue items are initially dismissible but not resolvable, which is a stated limitation
  rather than an oversight.
- **Silent/automatic merge.** Prohibited outright.
- **Cross-object matching** — comparing records of one type against another. No equivalent
  pairing is needed yet; the rule shape does not preclude it later.
- **Retroactive scanning.** Live counts are 2 accounts, 2 contacts, 3 locations, 7 parts — there
  is nothing meaningful to backfill. A sweep becomes necessary before any real data import and is
  a named follow-up.

## Technical design

**Predicate shape differs from reporting, and that matters.** The Report Builder's filters are
*single-record* predicates — `fieldId, op, value` (`reportQueryModel.js`). Duplicate criteria are
*pair* comparisons — `fieldId, method` — comparing a candidate against an existing record with no
literal value at all. The UI idiom and the validation discipline are reused; the model is not,
and pretending otherwise would produce a filter builder that cannot express matching.

**Rules are inert metadata**, following `reportDefinition`'s established posture: a saved
definition is data, validated on write, that a separate runtime executes.

**Matching is a pure module** — no React, no Firebase import — so the identical evaluator runs
client-side today and inside the trusted server-side writer when the account write path migrates,
as `domain/accounts.js` already documents it will. This is the choice that makes that migration
cheap rather than a rewrite.

**Scale ceiling, stated plainly.** Phase 1 compares against records already loaded on the client:
O(n) per create, fine at today's volumes into low thousands. At tens of thousands, match keys
must be precomputed and indexed server-side. The pure evaluator is what makes that a move rather
than a rebuild.

## Firestore Rules impact

Three new collections — `matching_rules`, `duplicate_rules`, `duplicate_record_sets`. Following
the established posture for governed collections: **deny-all to clients**, written through a
trusted server-side path, read through a governed read service.

**Authoring a rule is a governed authority, not a preference.** Editing a Matching Rule to match
nothing silently disables a control the Owner installed deliberately; that must be capability-
gated and audited exactly like a role change. Rules changes are Tier 2 and are prepared here,
separately authorized.

## UI impact

- **Administration → Duplicate Rules**: list, create, edit, activate/deactivate for both objects.
- **Inline alert at create and edit** in the CRM forms for Account, Contact, Location and
  Opportunity, and in the Part create surface: the matched record, which criteria matched, the
  admin-authored message, and opening the existing record as the primary action.
- **Duplicate queue surface**: open sets with both records side by side and the matched criteria.
- **Empty state**: an empty queue means "nothing suspected" and must read differently from
  "detection is not running".

## Testing strategy

Normalization, match methods and boolean-logic evaluation are pure and unit-testable without a
browser or emulator — the property that makes `contactCsvImport.js` well covered today. Each
match method gets a table of positive **and negative** cases from realistic data. False-positive
cases are first-class: `Taylor Freezer of Arizona` vs `Taylor Ice of Arizona` must NOT match, and
two records both missing a phone must not match on blanks.

Rule-definition validation gets its own tests, mirroring `reportCatalogValidation`.

## Rollback strategy

Detection is additive and advisory in its default posture. Deactivating every Duplicate Rule
stops alerts and queue writes; no record is modified by this feature, so nothing unwinds. The
collections can be left inert.

A `block` rule is the one exception — it can prevent a legitimate create — which is why blocking
is opt-in, per rule, and deactivatable from Admin without a release.

## Acceptance criteria

1. An admin can create and modify a Matching Rule for ANY registered object from the
   Administration page, without a code change or release.
2. NO matching behaviour is compiled in. Every rule in "Seeded rules" above is a seeded record
   that can be edited, deactivated or deleted from Administration -> Duplicate Rules. A rule that
   cannot be changed from that screen is a defect, including the Part block.
3. CSV import evaluates the SAME rules as interactive create -- `contactDuplicateKey` stops
   being an independent source of truth.
4. A CSV import rejects only the ROWS that match a blocking rule, with a per-row reason, and
   imports every clean row. No duplicate ever causes a whole-file rejection. Duplicates are
   detected both against existing records and within the file, and an import never overwrites an
   existing record.
5. An admin can set, per entity and separately for Create and Edit, whether a match alerts,
   blocks, and reports.
6. A create matching an active rule shows the admin-authored alert naming the existing record and
   which criteria matched.
7. Continuing past an alert succeeds and produces a queue entry recording that they proceeded.
8. Editing a record into collision produces a queue entry.
9. A pair marked `not-a-duplicate` never reappears.
10. A `block` rule prevents the create and says why.
11. Deactivating a rule immediately stops its alerts, with no release.
12. No path silently merges or modifies an existing record.
13. Rule authoring is capability-gated and every rule change is audited.

## Risks

- **False positives train people to ignore alerts.** Mitigated by explaining which criteria
  matched, defaulting to allow rather than block, `match blanks` off by default, and treating
  false-positive tests as first-class.
- **A rule edit can silently disable a control.** Mitigated by capability-gating authoring and
  auditing every change — the reason rules are governed metadata rather than settings.
- **Queue becomes a graveyard.** A queue nobody works implies coverage that is not happening.
  Ownership is an open question below.
- **Client-side scale ceiling** as described above.

## Open questions

1. ~~Who authors rules, and who works the queue?~~ **ANSWERED (Owner, 2026-08-19): admin
   authors, and duplicate rules are available for ALL objects, not only the five named here.**
   The five are simply the ones with seeded rules; the rule shape is entity-agnostic and any
   registered EntityDefinition can have one.

   **The sub-question is also answered: admin works the queue.**

   Implemented as TWO distinct capability ids -- `duplicate.rule.manage` (author rules) and
   `duplicate.queue.resolve` (work the queue) -- with BOTH granted to admin today. They are
   separate ids rather than one because that is what keeps a narrower grant possible later
   without a code change. It is the same reasoning the permission catalog already applies to
   `crm.activity.create` vs `crm.activity.read`, and it is why the Owner was able to rule on
   CRM read alone when that came up. Splitting them later stays a grant decision; collapsing them
   now would make it a refactor.

   Worth noting for whoever implements it: this is the one place in the design where an admin can
   both write the rule that detects a duplicate and dispose of what it finds. That is a
   deliberate concentration, not an oversight -- the same separation-of-duties question the blind
   cycle count work answered the other way (counter cannot approve their own variance). It is
   acceptable here because resolving a duplicate is not a value-bearing write today: the queue
   can only dismiss, not merge, until the merge specification ships. If merge later lets an admin
   collapse two records and redirect their history, this concentration should be revisited.
2. ~~Which entity should default to block?~~ **ANSWERED (Owner, 2026-08-19): Part blocks on
   `internalPartNumber`; everything else is allow+alert+report.** Reasoning recorded under
   "Seeded rules" above -- `internalPartNumber` is this catalog own number and already throws
   `AlreadyExistsError` in `partMasterCommands.ts`, so blocking prevents nothing new. The
   manufacturer part-number case the Owner raised is explicitly NOT a block, because two
   manufacturers can ship the same number on genuinely different parts.
3. ~~Merge~~ **APPROVED to specify (Owner, 2026-08-19).** A separate specification follows;
   until it ships, queue items can be dismissed but not resolved.
