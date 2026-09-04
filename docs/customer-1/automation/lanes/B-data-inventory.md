# Lane B — Data / Inventory

**Priority 20. Branch prefix `customer1/b-`.**

## Mandate

Turn "we will migrate Taylor's data" into measured facts, accepted mappings, and
a rehearsal that can be run more than once. `C1-DATA-01` is second on the
critical path and `C1-INV-01` is a Taylor acceptance gate that no amount of
tooling can close on Taylor's behalf.

## Gates owned

- `C1-DATA-01` — Data migration scope and rehearsal (OPEN, launch-critical)
- `C1-INV-01` — Opening inventory reconciliation (OPEN, launch-critical, **Taylor authority**)

## Owned paths

```
docs/customer-1/data/**
scripts/customer1-migration/**
```

## May

- Inventory Taylor source systems and record the census.
- Define migration schemas, field mappings, and transformation validators.
- Build repeatable dry runs against fixtures or sandbox — never production.
- Build exception reporting and reconciliation tooling.
- Build opening-inventory reconciliation tooling and the report Taylor will sign.

## Must not

- Make destructive writes against customer production data. Any production
  contact is read-only, separately authorized, and never automated here.
- Invent a source-of-truth choice where evidence is ambiguous. If two systems
  disagree about a fact, that is a blocker, not a coin flip.
- Accept physical opening inventory on behalf of Taylor. The tooling produces
  the reconciliation; Taylor accepts the count.

## Seeded objectives

1. Source census: what systems hold Taylor's parts, customers, equipment,
   inventory, purchase, and service history today, in what format, at what
   volume, with what identity keys.
2. Migration tiering: which data is required for Day 1, which is historical
   reference, and which is explicitly not migrated.
3. Mapping specifications per tier, with an explicit unmapped/exception list.
4. A dry-run harness that produces a deterministic exception report.
5. Opening inventory: the reconciliation procedure and the acceptance artifact
   Taylor completes.

## Seeded evidence rule

**Seeded data can prove the process. It cannot prove Taylor's actual data.**

The absence of a real Taylor export is NOT a reason to stop. Build the process
against deterministic, source-shaped synthetic data and prove it runs: a
repeatable migration dry run, mapping and transformation execution, an exception
report, reconciliation output, and a rerun that proves idempotency.

Every synthetic artifact must be marked SEEDED / SYNTHETIC in its filename or a
banner at the top of the file, so nobody can mistake a rehearsal for Taylor's
real numbers. Seeded evidence advances the PROCESS half of a gate. It never
closes a gate that needs Taylor's own data or Taylor's acceptance.

## Blocker triggers

- Source system access, export format, or volume is unknown AND the work cannot
  be rehearsed on synthetic data (`BLOCKED_TAYLOR`). Raise this only for work
  that genuinely depends on a real Taylor fact -- never merely because an export
  has not arrived. Missing exports are the expected state right now: rehearse
  against seeded data and record what Taylor still has to supply.
- Two sources disagree on an authoritative fact (`BLOCKED_TAYLOR`).
- A mapping would require a schema or authority change (`BLOCKED_GOVERNANCE`).
- Production read access is required (`BLOCKED_OWNER`).

## Proofs

Validators and dry-run tooling ship with a runnable check against fixture data.
Prefer `node --test` on the narrowest new file over any broad suite.
