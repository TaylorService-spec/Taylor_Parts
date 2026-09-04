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

## Not yet done

The dry-run harness (objective 4) depends on at least one real mapping to exercise, and
is not started. The census, tiering, mapping, and opening-inventory instruments now all
exist, but they hold no decisions: every census field is `UNKNOWN`, every domain is
`UNDECIDED`, the mapping table is empty, and every custody scope is `UNKNOWN` — all
pending Taylor's answers to the census.
