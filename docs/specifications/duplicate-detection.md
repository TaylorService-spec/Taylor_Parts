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

**The model follows Salesforce's, deliberately**, because it is the mature shape for exactly this
problem and separates two concerns that this repository would otherwise conflate:

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

## Explicitly out of scope

- **Merging.** What happens to the losing record's Work Orders, Sales Orders, stock and history
  is a governed change needing its own specification. This sprint produces the queue and the
  verdict; queue items are initially dismissible but not resolvable, which is a stated limitation
  rather than an oversight.
- **Silent/automatic merge.** Prohibited outright.
- **Cross-object matching** (Salesforce matches Lead against Contact). No equivalent pairing is
  needed yet; the rule shape does not preclude it later.
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

1. An admin can create and modify a Matching Rule for each of the five entities from the
   Administration page, without a code change or release.
2. An admin can set, per entity and separately for Create and Edit, whether a match alerts,
   blocks, and reports.
3. A create matching an active rule shows the admin-authored alert naming the existing record and
   which criteria matched.
4. Continuing past an alert succeeds and produces a queue entry recording that they proceeded.
5. Editing a record into collision produces a queue entry.
6. A pair marked `not-a-duplicate` never reappears.
7. A `block` rule prevents the create and says why.
8. Deactivating a rule immediately stops its alerts, with no release.
9. No path silently merges or modifies an existing record.
10. Rule authoring is capability-gated and every rule change is audited.

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

1. **Who authors rules, and who works the queue?** Authoring is plausibly `admin` only. Working
   the queue is broader and has no natural holder for Accounts/Contacts/Opportunities. Does this
   need `duplicate.rule.manage` and `duplicate.queue.resolve` as distinct capabilities?
2. **Which entity, if any, should default to `block`?** The Owner raised exact part-number
   collisions specifically. This spec defaults everything to allow+alert; blocking Parts on an
   exact part-number match is a one-line rule change if wanted at launch.
3. **Merge** must be specified before queue items can be resolved rather than only dismissed.
