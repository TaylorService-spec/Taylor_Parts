# Customer 1 — Data migration (gate `C1-DATA-01`)

This directory holds the migration record for Taylor Freezer of Arizona: what data
exists today, where it lives, what moves, what does not, and what could not be
reconciled.

Authority for the gate itself is `docs/customer-1/CUSTOMER_1_LEDGER.json`. Nothing
here closes a gate on its own.

## Files

- `source-census.json` — the machine-readable source-system census (objective 1).
- `migration-tiering.json` — the per-domain migration tiering record (objective 2).
- `field-mappings.json` — the per-field mapping specification and its exception list
  (objective 3).
- `opening-inventory-reconciliation.json` — the opening-inventory reconciliation and
  the artifact Taylor signs (gate `C1-INV-01`, objective 5).
- `../../../scripts/customer1-migration/validate-source-census.mjs` — the census
  validator.
- `../../../scripts/customer1-migration/validate-migration-tiering.mjs` — the tiering
  validator.
- `../../../scripts/customer1-migration/validate-field-mappings.mjs` — the field-mapping
  validator.
- `../../../scripts/customer1-migration/validate-opening-inventory.mjs` — the
  opening-inventory validator.
- `export-intake-contract.json` — the file-shape contract a Taylor export must satisfy
  before the dry run can read it.
- `../../../scripts/customer1-migration/dry-run.mjs` — the migration dry-run harness
  (objective 4).
- `../../../scripts/customer1-migration/read-export.mjs` — the export intake reader
  that turns a directory of CSV exports into the harness's source-record shape.
- `seeded/` — SEEDED / SYNTHETIC fixtures the harness rehearses against. Not Taylor data.

## What the census is

One row per system that holds Taylor operational data today, recording: the system,
its vendor and kind, which domains it holds, how data can be got out of it, in what
format, at what volume, under which identity keys, and which Taylor person owns it.

Required domains: `parts`, `customers`, `equipment`, `inventory`, `purchasing`,
`serviceHistory`.

## Current state

**INCOMPLETE — every field is `UNKNOWN`.**

Taylor has not yet named its systems of record. Verenward has not assumed, inferred,
or guessed any of them. The census ships as a single placeholder row so the shape is
fixed and the gap is visible rather than absent.

The census cannot advance without Taylor supplying, for each system:

1. System name, vendor, and kind (hosted SaaS, on-prem database, spreadsheet, paper).
2. Which of the six required domains it holds, and which domains it is authoritative
   for where more than one system holds the same fact.
3. How data can be exported, in what format, and whether Taylor or the vendor
   performs the export.
4. Approximate record volume per domain.
5. The identity key(s) records are keyed by.
6. The Taylor owner responsible for that system.

## What the tiering is

One row per required domain, recording whether that domain is `DAY_1` (must exist in
the new system before Taylor can operate), `HISTORICAL_REFERENCE` (moves, but is not
needed to work), or `NOT_MIGRATED` (deliberately left behind), plus which census
systems it comes from, why, and Taylor's acceptance of that call.

**PROPOSED — every domain is `UNDECIDED`.** Tiering is downstream of the census: you
cannot say a domain moves on Day 1 without knowing what holds it, how much of it there
is, or how it gets out. The validator enforces that dependency — tiering cannot be
declared `ACCEPTED` while the census it rests on is `INCOMPLETE`.

Run it with:

```
node scripts/customer1-migration/validate-migration-tiering.mjs
```

## What the field mappings are

One row per source field, in a named census system, for a named domain, saying where
that field lands and under what transformation — or that it lands nowhere, and why.
The exception list is not a separate document: a row whose `disposition` is not
`MAPPED` **is** the exception. There is no shape in which "we could not map this" can
be dropped without leaving a row behind.

Dispositions: `MAPPED` (lands somewhere), `NOT_MIGRATED` (deliberately left behind),
`NO_TARGET` (nothing in EOS holds this fact), `UNRESOLVED` (open question, blocks
acceptance). Only `MAPPED` may name a `targetField` and a `transform`; the others must
be `null` for both.

**PROPOSED — empty by construction.** Mappings are downstream of tiering, which is
downstream of the census. A mapping names a source field in a specific system; no
census system exists yet and no domain is tiered as moving, so there is nothing to
name. The validator enforces that chain: mappings cannot be `ACCEPTED` while the
tiering beneath them is `PROPOSED`.

It also refuses to let mappings widen the tiering. A field may only belong to a domain
tiered `DAY_1` or `HISTORICAL_REFERENCE`, and may only cite a system that domain's
tiering already names. Every moving domain must be accounted for — it has field rows,
or it is listed in `domainsWithoutMappings`, never both and never neither.

Run it with:

```
node scripts/customer1-migration/validate-field-mappings.mjs
```

## What the opening-inventory reconciliation is (`C1-INV-01`)

One row per custody scope — `warehouse`, `bin`, `truck`, `serialized` — recording what
is in scope, how it is counted, who counts it, which census system holds the balance it
is counted against, how variances are dispositioned, and Taylor's acceptance. Plus one
document-level acceptance block: who accepted, when, and the statement they accepted.

**DRAFT — every field is `UNKNOWN`.** The scopes exist because the gate names them, not
because Taylor has confirmed it holds stock in all four. Truck and serialized custody in
particular are unanswered.

Two things this record refuses to let happen:

- **Verenward cannot accept the count.** The tooling produces the reconciliation; Taylor
  accepts it. The validator rejects any acceptance naming Verenward, the automation, or
  a lane, in either the per-scope acceptance or the document acceptance block.
- **A scope cannot be accepted against nothing.** Accepting a scope requires naming the
  census system whose balance it was reconciled against.

Run it with:

```
node scripts/customer1-migration/validate-opening-inventory.mjs
```

## Rules this record enforces

- **`UNKNOWN` is a value, not an omission.** A missing field is a validation error.
  You cannot quietly drop a question you could not answer.
- **Every required domain is accounted for.** A domain is either claimed by a system
  or explicitly listed in `unsourcedDomains`. Silence is not an option.
- **The declared status must match the contents.** The census may only declare
  `COMPLETE` when zero fields are `UNKNOWN` and zero domains are unsourced. The
  validator recomputes this and fails on a mismatch, so the record cannot claim to be
  finished while it is not.
- **Conflicts are blockers, not choices.** If two systems disagree about an
  authoritative fact, record both and raise it to Taylor. Verenward does not pick a
  winner.

## How to update it

1. Replace the placeholder row with one row per real system. Keep `id` unique and
   stable — later mapping specifications will reference it.
2. Fill in every field you have a Taylor-supplied answer for. Leave the rest as the
   literal string `UNKNOWN`.
3. Set `status` to `INCOMPLETE` until nothing is unknown and nothing is unsourced.
4. Run the validator:

   ```
   node scripts/customer1-migration/validate-source-census.mjs
   ```

   It exits non-zero on any structural error or on a dishonest status.

## What the dry run is (objective 4)

A rehearsal on paper. The harness reads a census/tiering/mapping chain plus a set of
source records, applies the mappings, and prints an exception report. It writes nothing,
holds no credentials, and has no notion of a target database.

The report is deterministic — same inputs, byte-identical output — so running it twice
proves idempotency rather than merely proving it ran again.

Three fail-closed rules:

- **The chain validates first.** A dry run over a mapping chain that does not validate
  proves nothing, so the harness refuses to read a single record until it does.
- **A record migrates whole or not at all.** Any exception on any field rejects the
  entire record. Half a migrated part is worse than an absent one.
- **An undispositioned source field is an exception.** If a column shows up that no
  mapping row accounts for, it is reported. The mapping table decides what gets left
  behind, on the record, in words — the harness never drops a column quietly.

Exception kinds: `DOMAIN_DOES_NOT_MOVE`, `UNEXPECTED_SOURCE_SYSTEM`, `DUPLICATE_RECORD_ID`,
`UNMAPPED_SOURCE_FIELD`, `MISSING_VALUE`, `UNSUPPORTED_TRANSFORM`, `TRANSFORM_FAILED`.

Supported transforms: `trim`, `upper`, `money`, `integer`. A mapping naming anything else
is reported as `UNSUPPORTED_TRANSFORM`, never silently applied as a copy.

Run it with:

```
node scripts/customer1-migration/dry-run.mjs
```

With no arguments it rehearses against `seeded/`. Pass real paths in the order
mappings, tiering, census, records to run it against anything else.

### The seeded fixtures

`seeded/` holds a SEEDED / SYNTHETIC census, tiering, mapping table, and source-record
set. Every file carries a banner saying so. They are invented, deliberately dirty rows
whose defects are chosen to make each exception kind fire.

**Seeded data proves the process. It cannot prove Taylor's data.** A green dry run over
`seeded/` says the harness works. It says nothing about Taylor's parts, balances, or
customers, and it does not advance `C1-DATA-01` past the point where Taylor's own export
is required.

## What the export intake contract is

The dry run consumes source records as JSON. Taylor will not hand over JSON; Taylor
will hand over files. `export-intake-contract.json` is the shape those files must
have — UTF-8 CSV, no byte order mark, a header row, one file per domain and source
system named `<domain>__<sourceSystemId>.csv`, and a `RECORD_ID` column carrying each
row's identity — and `read-export.mjs` is the reader that enforces it.

Intake runs **before** mapping. A file that is unreadable, wrongly encoded, badly
named, or whose header does not match the manifest is reported without a single value
being transformed, so "your export is unreadable" and "your data has a problem" never
arrive as the same message.

Two decisions worth knowing:

- **Spreadsheets are not read directly.** A workbook is a rendering — cell types,
  hidden sheets, and display formatting change what a reader sees — and reading one
  means adding a third-party parser to the migration path. Taylor or the vendor
  exports each sheet to CSV, and that CSV is the artifact of record.
- **The column manifest is derived, not written down twice.** The expected columns for
  a domain are exactly the source fields the accepted mapping table names for it;
  the required ones are exactly those dispositioned `MAPPED`. A hand-maintained column
  list beside the mapping table would drift, and the drift would show up as a silently
  dropped column.

File-level exceptions reject the whole file — the header is what tells the mapping
table which value is which, so a misread header misfiles every value beneath it.
Row-level exceptions reject only their row.

File-level kinds: `UNREADABLE_FILE`, `UNSUPPORTED_FORMAT`, `ENCODING_NOT_UTF8`,
`MALFORMED_DELIMITED`, `UNPARSEABLE_FILE_NAME`, `UNDECLARED_SOURCE`, `EMPTY_FILE`,
`MISSING_RECORD_ID_COLUMN`, `DUPLICATE_COLUMN`, `UNEXPECTED_COLUMN`, `MISSING_COLUMN`.
Row-level kinds: `RAGGED_ROW`, `BLANK_RECORD_ID`.

Run it with:

```
node scripts/customer1-migration/read-export.mjs
```

With no arguments it rehearses against `seeded/export/`, which is a deliberately
defective SEEDED / SYNTHETIC export directory — see `seeded/export/SEEDED-README.md`
for what each file is there to break. Pass a directory, a contract path, and a mapping
path to run it against anything else.

**PROPOSED.** The contract is Verenward's requirement on the export, not a Taylor fact.
Taylor has not confirmed its systems can produce UTF-8 CSV, can emit a stable per-record
identity column, or who performs the export during the rehearsal-to-cutover window.
Those three questions are recorded in the contract's `openWithTaylor` list.

## Not yet done

The census, tiering, mapping, and opening-inventory instruments all exist and the dry-run
harness runs end to end, but the real records hold no decisions: every census field is
`UNKNOWN`, every domain is `UNDECIDED`, the mapping table is empty, and every custody
scope is `UNKNOWN` — all pending Taylor's answers to the census. The intake path from a
file on disk to a mapped record now exists end to end, but it has only ever been run on
seeded files. The rehearsal that counts is the one run against a Taylor export, which
has not arrived.
