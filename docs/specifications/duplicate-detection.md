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
call `.add()` with no comparison against existing records at all. The only duplicate logic that
exists anywhere — `contactDuplicateKey` in `domain/contactCsvImport.js` — runs solely on CSV
import and is invisible to every interactive path.

This matters now rather than later because `inventory.catalog.manage` was just granted to
`admin`, `operationsManager` and `fieldManager` (Owner ruling 2026-08-19), on the explicit
condition that duplicate detection follows immediately. A field manager creating Parts at a
machine is the highest-volume, lowest-context place a duplicate gets born.

**One process, five match profiles, one queue.** The pipeline is shared and identical for every
entity; only the *signals* differ. Detection runs on create and on update, warns the person
before they commit, and records every suspected pair into a queue that can be worked.

## Sprint objective

Ship a single duplicate-detection mechanism that (a) warns in the CRM before a duplicate is
created, (b) captures every suspected pair — including ones created anyway and ones that become
duplicates through editing — into a workable queue, and (c) is configured per entity by data,
not by five parallel implementations.

## Scope

**The shared pipeline**, in one pure module with no React or Firebase import, so the identical
code runs client-side today and inside a trusted server-side writer when the write paths move
(`domain/accounts.js` already documents that migration as coming):

    normalize -> signature -> candidates -> score -> verdict

**Five match profiles.** Each entity supplies normalizers and weighted signals. Adding a sixth
entity is a config entry, not a new matcher.

| Entity | Strong signal (exact match ⇒ near-certain) | Supporting signals |
|---|---|---|
| Account | normalized legal name (case, punctuation, and `Inc`/`LLC`/`Corp`/`Ltd` suffixes stripped) | billing address, phone, domain of any contact email |
| Contact | email, case-insensitive | name + phone (the existing CSV rule, reused verbatim) |
| Location | normalized street + postal code | city/state, account it belongs to |
| Part | normalized part number (case, spaces, punctuation) | description, manufacturer, unit of measure |
| Opportunity | same account + normalized name + both still open | stage, expected close date proximity |

Opportunity is deliberately the narrowest: two *closed* opportunities with the same name are
normal history, not duplication. Only concurrently-open ones on the same account are suspect.

**Warn, do not block.** A likely match surfaces the candidate record inline with what matched,
and offers "open the existing one" as the primary action. Creating anyway is permitted and is
recorded. A false positive must never prevent a technician finishing a job — that is how
detection gets switched off.

**The queue.** Every suspected pair becomes a `duplicate_candidates` entry, whether the person
backed off or continued. Worked outcomes are `merged`, `not-a-duplicate`, or `still-open`.

**Dismissals are remembered.** A pair marked `not-a-duplicate` must never resurface. Without
this the queue refills with the same rejected pairs every scan and people stop reading it.

**Detection on update, not only create.** Renaming an Account or correcting a Part number can
make two records collide that did not collide before. "Anything that becomes a duplicate"
includes that path.

## Explicitly out of scope

- **Merging.** Deciding what happens to the losing record's Work Orders, Sales Orders, stock and
  history is a much larger governed change and needs its own specification. This sprint produces
  the queue and the verdict; the merge action is deferred and must not be improvised.
- **Automatic/silent merge.** Explicitly prohibited. The CRM audit's gate 3 names "no silent
  merge" and that stands.
- **Retroactive scanning of existing records.** Counts are currently 2 accounts, 2 contacts,
  3 locations, 7 parts, so there is nothing meaningful to backfill. A backfill sweep becomes
  necessary before any real data import and is called out as a follow-up, not done here.
- **Fuzzy/ML matching.** Deterministic normalized comparison only. A scoring model is not
  justifiable at this data volume and would make every verdict unexplainable.

## Technical design

**One pipeline, parameterized.** `domain/duplicateDetection.js` exports
`findDuplicateCandidates(entityType, candidateRecord, existingRecords, options)` returning ranked
matches, each carrying **which signals matched** so the UI can say *why* rather than asserting
"possible duplicate". An unexplained warning is one people learn to click through.

**Verdict bands**, from signal weight:

| Band | Meaning | Behaviour |
|---|---|---|
| `certain` | strong signal exact | warn prominently, offer the existing record first |
| `likely` | several supporting signals | warn, show what matched |
| `weak` | one supporting signal | queue entry only, no interruption |
| `none` | — | nothing |

**Normalization is shared and tested independently** — casing, whitespace collapse, punctuation,
company-suffix stripping, address abbreviations (`St`/`Street`, `N`/`North`), phone to digits.
This is where duplicate detection actually succeeds or fails, so it is a first-class module with
its own tests rather than helpers scattered per entity.

**Scale ceiling, stated honestly.** Phase 1 compares against records already loaded on the
client: O(n) per create, fine at today's volumes and up to low thousands. It is *not* the answer
at tens of thousands, where signature keys must be indexed and queried server-side. The pure
module is the thing that makes that migration cheap — the same matching code moves behind a
callable without being rewritten.

## Firestore Rules impact

A new `duplicate_candidates` collection. Following the established posture for governed
collections, it is **deny-all to clients** and written only through a trusted server-side path,
read through a governed read service. No client-direct access. Rules changes are Tier 2 and are
**not** included in this sprint's repo work — they are prepared and separately authorized.

## UI impact

- **Inline warning at create**, in the CRM create forms for Account, Contact, Location and
  Opportunity, and in the Part create surface. Shows the matched record, the matching signals,
  and offers opening it instead. Never blocks submission.
- **A duplicate queue surface**, listing open candidates with both records side by side and the
  matched signals, and actions to mark `not-a-duplicate` or flag for merge.
- **Empty state matters here**: an empty queue means "nothing suspected", which must be visually
  distinct from "detection is not running".

## Testing strategy

Normalization and matching are pure, so they are unit-testable without a browser or emulator —
the same property that makes `contactCsvImport.js` well covered today. Each match profile gets a
table of positive and negative cases drawn from realistic data (`Taylor Freezer of Arizona` vs
`TAYLOR FREEZER AZ, LLC`; `123 Main St` vs `123 N Main Street #4`; `TST-1234` vs `TST 1234`).
False-positive cases are as important as true positives and are asserted explicitly.

## Rollback strategy

Detection is additive and advisory. Disabling it removes warnings and stops queue writes; no
record is changed by this feature, so there is nothing to unwind. The `duplicate_candidates`
collection can be left in place inert.

## Acceptance criteria

1. Creating a record matching an existing one on its entity's strong signal produces a visible,
   explained warning naming the existing record — for all five entities.
2. Continuing past a warning succeeds and produces a queue entry.
3. Backing off and opening the existing record produces a queue entry too.
4. Editing a record into collision with another produces a queue entry.
5. A pair marked `not-a-duplicate` never reappears.
6. No path silently merges or modifies an existing record.
7. Adding a sixth entity requires a config entry and tests, not a new matcher.

## Risks

- **False positives train people to ignore warnings.** Mitigated by explaining the match, never
  blocking, and treating false-positive tests as first-class.
- **Queue becomes a graveyard.** A queue nobody works is worse than none, because it implies
  coverage that is not happening. Ownership of the queue is an open question below.
- **Detection is only as good as normalization.** Company-suffix and address rules are
  locale-specific and currently US-shaped; stated rather than hidden.
- **Client-side scale ceiling** as described above.

## Open questions

1. **Who works the queue?** `inventoryCatalogAdministrator` is the natural owner for Parts, but
   Accounts/Contacts/Locations/Opportunities have no equivalent role. Does this need a
   capability (`duplicate.queue.read` / `.resolve`), and which Roles hold it?
2. **Does a `certain`-band match ever block?** This spec says never. An exact part-number
   collision is arguably different from a similar company name, and the Owner may want the
   strong band to hard-stop for Parts specifically.
3. **Merge**, deferred here, needs its own specification before the queue can be fully worked —
   otherwise items can only ever be dismissed.
