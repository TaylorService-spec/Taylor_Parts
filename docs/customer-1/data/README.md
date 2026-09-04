# Customer 1 — Data migration (gate `C1-DATA-01`)

This directory holds the migration record for Taylor Freezer of Arizona: what data
exists today, where it lives, what moves, what does not, and what could not be
reconciled.

Authority for the gate itself is `docs/customer-1/CUSTOMER_1_LEDGER.json`. Nothing
here closes a gate on its own.

## Files

- `source-census.json` — the machine-readable source-system census (objective 1).
- `migration-tiering.json` — the per-domain migration tiering record (objective 2).
- `../../../scripts/customer1-migration/validate-source-census.mjs` — the census
  validator.
- `../../../scripts/customer1-migration/validate-migration-tiering.mjs` — the tiering
  validator.

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

## Not yet done

Per-tier mapping specifications, the dry-run harness, and the opening-inventory
reconciliation (`C1-INV-01`) all depend on a populated census and an accepted tiering,
and are not started. The tiering instrument exists but holds no decisions: every domain
is `UNDECIDED` pending Taylor's answers to the census.
