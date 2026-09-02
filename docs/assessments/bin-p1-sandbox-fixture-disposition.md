---
artifact_type: assessment
gate: Assessment
status: Final
date: 2026-09-02
owner: Claude Code
related_adrs: ["ADR-014"]
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# BIN-P1 — sandbox fixture disposition (Owner ruling: REGENERATE)

**Environments**

| Role | Project |
|---|---|
| Sandbox | `eos-platform-sandbox` |
| Production | `taylor-parts` |

## Owner ruling

**REGENERATE.** Do not migrate the existing sandbox BIN records.

BIN-P1 replaces the code-derived bin document id with a stable surrogate `binId` (Decision #160 / ADR-014, ruling O-3). The mandatory pre-implementation census returned **CASE B** — production empty, sandbox non-empty — which blocked the clean shape replacement. The Owner ruled that building a v1 → v2 migration solely to preserve reproducible sandbox scenario artifacts is unnecessary migration debt.

Approved sequence: preserve evidence → delete only the proven disposable sandbox scenario records → re-census sandbox → re-census production → if both are empty, the clean-shape-replacement gate passes.

## Pre-cleanup census

| Environment | Project | `bins` | `bin_placements` | Measured |
|---|---|---|---|---|
| Sandbox | `eos-platform-sandbox` | **63** | **42** | 2026-09-02 |
| Production | `taylor-parts` | **0** | **0** | 2026-09-02, re-measured immediately before mutation |

Read-only, field-masked, over the Firestore REST API with the operator's existing `gcloud` login. Listings returned no `nextPageToken`, so the counts are complete rather than a first page. Project identities came from `config/environments.json` and `.firebaserc`; no project was switched and no Firebase configuration was modified.

## Fixture generation — why these records are disposable

Source: `scripts/runSandboxScannerScenarios.mjs`, the twelve sandbox scanner scenarios, run "as real personas against the real deployed callables". Its own header states that test data is created *"through the GOVERNED COMMANDS (createBin, createPartAlias), never by writing documents directly"* — which is why these are real governed records rather than seeded documents, and why a `functions/`-scoped source search did not surface the writer.

Per run, it computes once:

```
RUN        = `v${Date.now()}`                  e.g. v1787289290788
BIN        = `A14${RUN.slice(-5)}`   @ wh-main    -> bins/bin_wh-main__A1490788
STAGE_BIN  = `ST${RUN.slice(-5)}`    @ wh-main    -> bins/bin_wh-main__ST90788
other      = `NB${RUN.slice(-5)}`    @ wh-north   -> bins/bin_wh-north__NB90788
```

and records two placements for `PRT-1001`, keyed `plc-${RUN}` (scenario 6, put-away) and `pick-${RUN}` (scenario 7, pick/stage):

```
bin_placements/plc_plc-v1787289290788__PRT-1001
bin_placements/plc_pick-v1787289290788__PRT-1001
```

**Every one of the 105 records matches that generator**, independently re-measured and re-classified rather than accepted from the earlier census:

- **63 bins** = 21 `A14…` + 21 `ST…` at `wh-main`, 21 `NB…` at `wh-north`
- **42 placements** = 21 `plc-` + 21 `pick-` pairs, all `PRT-1001`, all `wh-main`
- **21 distinct scenario runs**, dated **2026-08-21 → 2026-08-26**
- **0 records outside the proven scenario shapes**, in either collection

Each record additionally had to pass a stored-field check, not just an id-shape check: a bin's stored `warehouseId` must agree with the shape its id implies, and its stored `code` must derive its own document id; a placement's stored `warehouseId` and `partId` must be `wh-main` / `PRT-1001`.

**Referential safety.** No code outside `functions/src/inventoryLocation/` references a bin id — verified by source search. Placements are the only referrers, and they are removed in the same operation, before their bins. The script additionally refuses if any *surviving* placement would point at a bin in the deletion set.

## Authorization boundary

This is **one-time sandbox test-fixture maintenance. It is not product behaviour.**

Authorized: removal of the identified disposable BIN scanner-scenario fixtures from `eos-platform-sandbox` only.

Not authorized, and not done:

- deleting any production record;
- deleting any sandbox record not proven to belong to the scenario runner;
- adding an operational delete-bin product command;
- weakening the product invariant that operational bins are retained for history (`binRegistry.ts`: *"Retiring keeps history readable; nothing is ever deleted"*) — **unchanged**;
- implementing BIN-P1, activating capabilities, changing Rules, deploying product code;
- migrating real records, deleting unrelated scanner fixtures, or any collection-wide blind deletion.

**No business or customer BIN record is authorized for deletion, and none exists** — production holds zero records in both collections.

## Cleanup mechanism

`scripts/clearSandboxBinScenarioFixtures.mjs` — a one-time maintenance script, written because no existing tooling covered this task. Its refusal posture mirrors `functions/scripts/certificationWorld/executionTarget.mjs`, the repository's single gate for live writes; it is mirrored rather than imported because that module resolves through `functions/lib` (a compiled build) while this script uses the Firestore REST API with the operator's existing `gcloud` login.

Guards, each verified to refuse:

| Invocation | Result |
|---|---|
| no `--projectId` | refused — "There is no default target." |
| `--projectId taylor-parts` | refused **by name** as the customer production project |
| `--projectId eos-platform-certification` | refused — sandbox-only maintenance |
| `--apply` without `--apply-live-sandbox` | refused — "`--apply` alone never deletes." |

Further properties: dry run by default; re-reads and re-classifies every candidate before deleting; names every id before removing any; refuses the whole run if a single non-scenario record is present; deletes placements before bins; re-measures afterwards and exits non-zero if the counts do not reconcile; idempotent — a second dry run finds nothing eligible. It creates no credential, touches no IAM, deploys nothing, adds no callable, capability or Rules change, and is not a general-purpose Firestore deletion utility.

**Audit manifest:** `docs/assessments/bin-p1-sandbox-fixture-manifest.txt` — 105 document ids, written by the script from the same classified set it deletes, so the filed record cannot drift from what was removed.

## Dry run

```
target   : eos-platform-sandbox
mode     : DRY RUN

bins                     : 63 total, 63 proven scenario, 0 other
bin_placements           : 42 total, 42 proven scenario, 0 other
distinct scenario runs   : 21
manifest : 105 id(s)
```

## Cleanup applied

```
target   : eos-platform-sandbox
mode     : APPLY

bins                     : 63 total, 63 proven scenario, 0 other
bin_placements           : 42 total, 42 proven scenario, 0 other
distinct scenario runs   : 21

removed  : 42 bin_placements, 63 bins
post     : bins 0, bin_placements 0

OK. Only the proven scanner-scenario fixtures were removed.
```

**Removed: 42 `bin_placements`, then 63 `bins`. Unrelated records removed: 0. Production touched: no.** The script's own reconciliation (removal counts against the re-measured post-state) passed; it would have exited non-zero otherwise.

## Post-cleanup census

Measured **2026-09-02T23:24:35Z**, independently of the cleanup script — a fresh read-only REST census, with production re-measured rather than carried forward:

| Environment | Project | `bins` | `bin_placements` |
|---|---|---|---|
| Sandbox | `eos-platform-sandbox` | **0** | **0** |
| Production | `taylor-parts` | **0** | **0** |

**Idempotency confirmed:** a second dry run reports `0 total, 0 proven scenario, 0 other` in both collections and exits 0.

## Gate result

> **BIN-P1 CLEAN SHAPE REPLACEMENT GATE = PASS.**
>
> - `schemaVersion` 1 → 2 is authorized as the implementation posture.
> - **No migration required.**
> - **No dual-version reader required.**

**Regeneration follow-up:** after BIN-P1 ships, re-run `scripts/runSandboxScannerScenarios.mjs` against the new governed commands to restore scanner release-readiness coverage. The twelve scenarios are the coverage; these 105 documents were only their output.

**Production must be re-confirmed empty immediately before implementation begins** — this census is a point-in-time reading, and nothing prevents a future scenario run from repopulating sandbox.

## What this did not change

- No product code: `binRegistry.ts`, `binCommands.ts`, `binCallables.ts` and `putAwayCommand.ts` are untouched.
- No Firestore Rules, no capability registration or activation, no role grant, no deployment.
- No Cycle Count code or eligibility.
- The retain-for-history invariant on operational bins stands exactly as written.
