---
artifact_type: release
gate: BIN + Cycle Count v2 release to eos-platform-sandbox (Owner rulings B2 / Decision #178, 2026-09-10 continuation / Decision #179) — sandbox only
status: NOT DEPLOYED — operator action required (agent sessions are hard-denied deploy by .claude/settings.json)
date: 2026-09-10
target: eos-platform-sandbox — never taylor-parts
---

# BIN + Cycle Count release to sandbox — operator record

## 1. What the release carries

**Pinned SHA: `72c111b33a147ace91702e61602267b14cff8a9d`** (`origin/main` after #1850). This is one coherent release: every PR below is in it, and
nothing is deployed from a branch. If `main` moves before the deploy, anything after `72c111b33a147ace91702e61602267b14cff8a9d` must be docs-only
(`git diff --stat 72c111b33a147ace91702e61602267b14cff8a9d origin/main` touches only `docs/`); otherwise re-pin. `/version.json` is the evidence
afterwards.

| PR | Content | Surface |
|---|---|---|
| #1833 | BIN-P6 specification | docs |
| #1835 | `relocateStock`, one on-hand authority, Transfer BIN endpoints | Functions |
| #1836 | Scan → Move stock multi-scan | Hosting |
| #1837 | Conversion reconciliation + runbook | scripts/docs |
| #1838 | BIN-P4: `inventory.stock.relocate` active in platform-sandbox; two functional Roles | Functions + Hosting |
| #1840 | BIN-P7: Cycle Count admits BIN behind the conversion gate | Functions |
| #1841 / #1843 | A1 Revision 2; M-1 Option A — v1 export manifest and closeout | docs/scripts |
| #1844 | Strict readers accept the governed Ownership Model fields the sandbox backfill wrote | Functions |
| #1845 | Scanner governed reads: `lookupScannedPart`, `listStockMovementLocations`; relocation Role gains `inventory.catalog.read` | Functions + Hosting |
| #1846 | Scanner runner creates bins through the BIN-P1 contract | scripts |
| #1848 | A1 sheet/line model (schema v2) + A4 durable read; v1 callables unexported | Functions |
| #1849 | P8 multi-part bin counting on `scanObservationQueue`; Cycle Counts review workspace on A4 | Hosting |
| #1850 | Scanner runner scenarios 10/12 on the v2 callables | scripts |

**Live sandbox before this release:** `5ddb9e4a` (buildTime 2026-09-07T16:51:52Z).

**Rules and indexes: no change.** `git diff 5ddb9e4a 72c111b33a147ace91702e61602267b14cff8a9d -- firestore.rules field-ops-app-vite/firestore.rules firestore.indexes.json firebase.json`
is empty. The release is **Functions + Hosting only**; no Rules or index deploy is needed or authorized by this record.
`listCycleCountSheets` is one equality (`schemaVersion == 2`) ordered by document id — served by the automatic
single-field index.

**Release order.** Functions first, then Hosting (the governed script's own order). The new client calls the v2
callables and `lookupScannedPart`; Hosting first would show screens whose callables do not exist yet.

## 2. Operator commands

The release checkout `D:\Taylor_Parts-eos` belongs to whichever session holds it — do not reset, clean, stash or
check out over it. Use a clean release worktree instead:

```powershell
cd D:\Taylor_Parts
git fetch origin
git worktree add D:\Taylor_Parts-release 72c111b33a147ace91702e61602267b14cff8a9d
cd D:\Taylor_Parts-release
git status --short        # must be empty
git rev-parse HEAD        # must equal 72c111b33a147ace91702e61602267b14cff8a9d
```

Then run the governed sandbox refresh from that worktree (Functions + Hosting). Verify (read-only):

```bash
curl -s https://eos-platform-sandbox.web.app/version.json
```

`commit` must equal `72c111b33a147ace91702e61602267b14cff8a9d`.

```bash
npx firebase functions:list --project eos-platform-sandbox --json
```

**Must be present:** `relocateStock`, `lookupScannedPart`, `listStockMovementLocations`, `createCycleCountSheet`,
`openCycleCountLine`, `submitCycleCountLine`, `reconcileCycleCountLine`, `cancelCycleCountLine`,
`cancelCycleCountSheet`, `closeCycleCountSheet`, `listCycleCountSheets`, `getCycleCountSheet`,
`createTransferOrder`, `receiveTransferOrder` and the bin callables.

**Retire the v1 functions.** #1848 no longer exports `createCycleCount`, `submitCycleCount`, `reconcileCycleCount`,
`cancelCycleCount`. A Functions deploy does not delete a function that is merely unexported, so the operator deletes
the four by name (sandbox project only), then re-lists and confirms they are gone:

```bash
npx firebase functions:delete createCycleCount submitCycleCount reconcileCycleCount cancelCycleCount --project eos-platform-sandbox
```

The v1 `cycle_counts/cyc_*` documents are **not** touched: they are retired in place and preserved by the M-1
export (`docs/assessments/cycle-count-m1-v1-export-manifest-2026-09-10.md`). The v2 reader never deserializes
them (distinct `ccs_` prefix and `schemaVersion == 2`). Certification is frozen and is not part of this release.

## 3. Grants for the gate personas (governed grantRole path, operator-applied)

| Persona | Add | Why | Employee id used |
|---|---|---|---|
| `partsAssociate` | `inventoryStockRelocationOperator` | Move stock + scanner catalogue read (catalog.read now in the Role); already holds `inventoryPutAwayOperator` | *record* |
| `technician` | `inventoryTransferReceiver` | receive-only truck handoff | *record* |
| `partsManager` | nothing | stays put-away-only; holds Cycle Count reconcile (reviewer) | — |
| `warehouseManager` | nothing | `inventoryTransferOperator` → custody-boundary persona; no counter authority (#111) | — |

Use `functions/scripts/operatorAccessCommand.js` (`grantRole`) with a named recipient, a stated need and an
operator-supplied idempotency key, exactly as `scanner-sandbox-validation-2026-08-21.md` §1 did. Grants are by
functional Role, never by job title.

## 4. Quick Gate

```bash
node scripts/runSandboxBinMoveScenarios.mjs
node scripts/runSandboxScannerScenarios.mjs
```

- **Move stock / BIN (items 1–18).** `runSandboxBinMoveScenarios.mjs` covers items 1–3, 6–8 and 10–17 at the API as
  real personas and asserts the Warehouse aggregate is conserved end to end. Items 4, 5, 9 (session batching,
  repeated-scan aggregation, retry of only technical failures) are screen behaviour — proved in
  `moveStockScan.test.jsx` and checked in the handheld pass. Item 18 (Receiving unchanged): scenario 5 of the
  scanner runner.
- **Scanner.** All twelve scanner scenarios, including the Parts Associate lookup (scenario 1) through the governed
  read — no Rules change.
- **Cycle Count.** Scanner scenario 10 at the API: the counter starts a sheet, a line opens **blind**, the submitted
  count moves **no** stock, the reviewer finds it again through A4, the counter cannot dispose of it, the reviewer
  REJECTs with no ledger effect. Warehouse manager and parts manager cannot open a count; the technician cannot
  (scenario 12). The remaining Cycle Count items are the handheld checks below — multi-part session, NONE-tracked
  increment, serial identity and duplicate refusal, zero quantity, one failed line not erasing the others, retry
  idempotent, exact bin lineage, line-level discrepancy after submit — each proved in `cycleCountScan.test.jsx` /
  `cycleCountsBlindReview.jsx` and checked on the device.

## 5. Handheld pass (320 / 375 / 390 / 414)

**Move stock** — signed in as `partsAssociate`, Scan → Move stock, at each width:

- [ ] warehouse picker, From and To pickers and the item scan field fit without horizontal scroll;
- [ ] a part lookup succeeds (no "not authorized to look up parts");
- [ ] scan a bin label (`EOS-LOC:` token) into To; scan the same part three times → one line, quantity 3;
- [ ] a second part → a second line; a serialized part prompts for the serial and refuses a duplicate;
- [ ] Confirm → per-line results; a refused line stays visible with its reason; "Try again" appears only for technical failures;
- [ ] as `partsManager`, Move stock is not offered; as `technician` + receiver, Transfer receive is offered and Move stock is not.

**Cycle Count** — `partsAssociate` counts, `partsManager` reviews, at each width:

- [ ] Scan → Count: scan a converted bin's label → the bin locks; an unconverted bin is refused with its reason;
- [ ] scan several distinct parts; a NONE-tracked part scanned three times → quantity 3; zero is enterable;
- [ ] a serialized part records each serial; a duplicate serial is refused; no expected figure or variance is shown before submit;
- [ ] submit → per-line outcomes; a refused line keeps its reason and the others stay submitted; "Try again" only for technical failures;
- [ ] offline (airplane mode) → the count queues; back online → it submits once;
- [ ] reload mid-count → the sheet resumes from the server (A4), counted lines shown as counted;
- [ ] as `partsManager`, Inventory → Cycle Counts lists the sheet; the line shows expected / counted / variance; approve or reject with a reason; the counter cannot approve their own material variance;
- [ ] the review workspace and sheet detail fit without the page scrolling horizontally.

## 6. Recorded, not changed

- **Technician receive.** `receiveTransferOrder` is authorized by the receiver Role, but the Transfer screen lists
  orders from a client `transfer_orders` read that Rules limit to admin/dispatcher/assigned warehouse managers. The
  API receive works; whether a technician can *see* the order on the handheld is recorded, not fixed here (a governed
  read or a Rules change — Rules are Tier 2).
- **Phoenix.** The Phoenix bin conversion needs on-site facts (bin layout, labels, counts) that are not in the
  repository; nothing here invents them. Tooling and runbook: #1837.

## 7. Result

*To be filled in after the operator deploy:* `/version.json` commit, `functions:list` evidence (v2 present, v1 four
gone), grant idempotency keys and employee ids, both runners' output, handheld notes. Training follows only after the
gate passes.
