---
artifact_type: release
gate: BIN + Cycle Count v2 — Owner rulings B2 / Decision #178, 2026-09-10 continuation / Decision #179
status: APPLICATION DEPLOYED (Vercel Production, GitHub Pages, Render eos-api-nonprod) — Firebase Functions/Hosting deployment is NOT part of this release's gate (Owner correction, 2026-09-10 continuation): see §0
date: 2026-09-10
target: Vercel Production + GitHub Pages (frontend) / Render eos-api-nonprod (policy API) — Firestore/Firebase Auth remain application services this build depends on, not a deployment destination this record gates on
---

# BIN + Cycle Count release — record

## 0. Deployment model correction (read this first)

An earlier version of this record treated `eos-platform-sandbox` (a Firebase project) as the release's
deployment destination, gated release readiness on an operator running `firebase deploy` for Functions +
Hosting, and named the executable pin below a "Firebase sandbox candidate pin." **That framing was wrong and
is retracted.** Firebase/Firestore/Firebase Auth remain application services this build calls — that is
unchanged and is not what this correction is about. What changed: **Firebase is not an application deployment
target for this release.** No `firebase deploy` — Functions, Hosting, or sandbox — is planned, requested,
pending, or a release gate here, unless the Owner explicitly authorizes one in a future instruction.

**What actually deploys this application**, confirmed against the live platforms rather than inferred from
old prose:

| Surface | Mechanism | Triggers on |
|---|---|---|
| Vercel Production (frontend) | native GitHub integration, no path filter | every push to `main` |
| GitHub Pages (frontend) | `.github/workflows/deploy-field-ops.yml`, path-filtered | a push to `main` touching `index.html` or `field-ops-app-vite/**` |
| Render `eos-api-nonprod` (policy API) | native GitHub integration (`render.yaml`, `rootDir: functions`) | a push to `main` touching the deployable service's inputs |
| Firebase Functions / Hosting | none | never, for this release |

§1 keeps the PR-by-PR content table and the Rules/indexes evidence as a historical, still-accurate record of
what shipped in this coherent change set. §2–§5, describing a Firebase Functions + Hosting sandbox refresh,
are retained as a **deferred, non-blocking operational procedure** — useful if the Owner ever separately
authorizes standing up a live Firebase environment for these callables — not a step in this release's gate.
§6 records the actual, already-completed deployment evidence and current-stack smoke check for this release.

## 1. What the release carries

**Executable release SHA: `96f9a66a995942fe3f671feea772e1094e0badc3`** (`origin/main` after #1854). This is
the exact commit built and deployed to Vercel Production, GitHub Pages, and Render `eos-api-nonprod` (see §6
for per-platform evidence). Every PR below is in it, and nothing was deployed from a branch.

**Release-document SHA: `1fdef0b748e8ec98bcd957375ef9f3689daa1e59`** (#1856, docs-only re-pin of this record
onto #1854's SHA). This is a documentation commit, not an executable build — it triggered a Vercel Production
redeploy (Vercel has no path filter) but no GitHub Pages or Render redeploy (both are correctly scoped to
executable paths, and #1856 touched only this file). Do not call the release-document SHA the executable
build, and do not repin the executable release merely because documentation changes.

> **SUPERSEDED — do not treat as current: `308efd8aa62212c5135c1baedc7db459f5b7e504`** (the #1852 pin). It
> lacks #1854, so `CycleCountScan`'s async start/resume discarded a genuine server result behind a React
> 18/19 StrictMode phantom-remount bug (shared by every scan workflow), and there was no governed
> technician-to-truck Cycle Count MOBILE read.
>
> **SUPERSEDED — do not treat as current: `72c111b33a147ace91702e61602267b14cff8a9d`** (the #1851 pin). It
> lacks #1852, so a technician holding the receiver Role could receive a Transfer but not see it on the
> handheld.

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
| #1851 | This record, first pin (superseded) | docs |
| #1852 | Technician Transfer discovery: `listMyReceivableTransfers` (IN_TRANSIT to the caller's own truck, `inventory.transfer.receive`); TransferScan adopts it; scanner scenario 13 | Functions + Hosting + scripts |
| #1854 | Cycle Counts North Star P1: fixes the React 18/19 StrictMode async-remount bug across every scan workflow (a real, live-reproduced defect, not a design gap); confirms handheld already reaches Cycle Counts through `WarehouseShell`/`ScanWorkspace` at 320/375/390/414 (no routing change needed); adds `getCycleCountAssignedMobileLocation` — a governed technician→truck MOBILE read reusing the existing `inventory.cycleCount.create`/`.submit` capability pair and the existing `readAssignedMobileLocation` truck resolver (no new capability, no new Role, no Rules change) | Functions + Hosting |
| #1856 | This record: re-pinned to #1854, corrected the record's own stale technician-authority and phone-routing claims | docs |

**Rules and indexes: no change.** `git diff 5ddb9e4a 96f9a66a995942fe3f671feea772e1094e0badc3 -- firestore.rules field-ops-app-vite/firestore.rules firestore.indexes.json firebase.json`
is empty, across the whole PR sequence above. `listCycleCountSheets` is one equality (`schemaVersion == 2`)
ordered by document id — served by the automatic single-field index. `listMyReceivableTransfers` is three
equalities (`destination.type`, `destination.locationId`, `status`) ordered by document id — also served by
automatic single-field indexes. `getCycleCountAssignedMobileLocation` performs no query of its own — it reads
one `users/{uid}` document and calls the existing `readAssignedMobileLocation` resolver. No composite index is
added anywhere in this release.

## 2. Deferred, non-blocking: a Firebase Functions + Hosting environment refresh procedure

**Not part of this release's gate — see §0.** The steps below describe how an operator would refresh a live
Firebase environment's Functions + Hosting from this executable SHA, if the Owner separately authorizes
standing one up in the future. They are retained for that eventuality, not as pending work.

```powershell
cd D:\Taylor_Parts
git fetch origin
git worktree add D:\Taylor_Parts-release 96f9a66a995942fe3f671feea772e1094e0badc3
cd D:\Taylor_Parts-release
git status --short        # must be empty
git rev-parse HEAD        # must equal 96f9a66a995942fe3f671feea772e1094e0badc3
```

If and when that refresh is authorized, verify (read-only):

```bash
curl -s https://eos-platform-sandbox.web.app/version.json
```

`commit` would need to equal `96f9a66a995942fe3f671feea772e1094e0badc3`.

```bash
npx firebase functions:list --project eos-platform-sandbox --json
```

**Would need to be present:** `relocateStock`, `lookupScannedPart`, `listStockMovementLocations`,
`createCycleCountSheet`, `openCycleCountLine`, `submitCycleCountLine`, `reconcileCycleCountLine`,
`cancelCycleCountLine`, `cancelCycleCountSheet`, `closeCycleCountSheet`, `listCycleCountSheets`,
`getCycleCountSheet`, `getCycleCountAssignedMobileLocation`, `createTransferOrder`, `receiveTransferOrder`,
`listMyReceivableTransfers` and the bin callables.

**Legacy environment cleanup — non-blocking.** #1848 stopped exporting the four v1 callables
(`createCycleCount`, `submitCycleCount`, `reconcileCycleCount`, `cancelCycleCount`). If an older Firebase
environment still has them deployed from before #1848, that is legacy environment state, not a defect in this
release: it requires no action now, and deleting them requires its own separate authorization if and when that
Firebase environment is ever formally retired or refreshed. This closure does not depend on that cleanup
happening. If it is ever performed:

```bash
npx firebase functions:delete createCycleCount submitCycleCount reconcileCycleCount cancelCycleCount --project eos-platform-sandbox
```

The v1 `cycle_counts/cyc_*` documents are **not** touched by this either way: they are retired in place and
preserved by the M-1 export (`docs/assessments/cycle-count-m1-v1-export-manifest-2026-09-10.md`). The v2
reader never deserializes them (distinct `ccs_` prefix and `schemaVersion == 2`). Certification is frozen and
is not part of this release.

## 3. Deferred: persona grants for a live Firebase-backed acceptance gate

**Not part of this release's gate — see §0.** These grants matter only if/when a Firebase environment serving
these callables is authorized and real end-to-end acceptance against it is run.

| Persona | Add | Why | Employee id used |
|---|---|---|---|
| `partsAssociate` | `inventoryStockRelocationOperator` | Move stock + scanner catalogue read (catalog.read now in the Role); already holds `inventoryPutAwayOperator` | *record* |
| `technician` | `inventoryTransferReceiver` | receive-only truck handoff; also authorizes listing the IN_TRANSIT Transfers bound for their own truck | *record* |
| `technician` | `inventoryCycleCountCounter` (only if this persona is also exercising Cycle Count MOBILE acceptance) | grants exactly `inventory.cycleCount.create`/`.submit`/`.cancel` — the same pair `getCycleCountAssignedMobileLocation` requires; carries no reconcile authority | *record* |
| `partsManager` | nothing | stays put-away-only; holds Cycle Count reconcile (reviewer) | — |
| `warehouseManager` | nothing | `inventoryTransferOperator` → custody-boundary persona; no counter authority (#111) | — |

Use `functions/scripts/operatorAccessCommand.js` (`grantRole`) with a named recipient, a stated need and an
operator-supplied idempotency key, exactly as `scanner-sandbox-validation-2026-08-21.md` §1 did. Grants are by
functional Role, never by job title.

**Technician data prerequisite (not a grant).** The technician's truck is resolved from existing data: the
persona's `users/{uid}.technicianId`, and exactly one ACTIVE `trucks` document whose `assignedDriverEmployeeId`
equals it. Scanner scenario 13 reports the truck it resolved; if it reports "No active truck is assigned", the
Truck Registry assignment is the missing input. The same truck resolution also gates Cycle Count MOBILE
(#1854): a technician with `inventoryCycleCountCounter` but no active truck sees a truthful "No active truck
is assigned to you" state, never a company-wide truck picker; more than one active assignment fails closed
(visible error, never picks one) rather than silently choosing a truck.

## 4. Deferred: Quick Gate (API-level acceptance against a live Firebase environment)

**Not part of this release's gate — see §0.** `runSandboxBinMoveScenarios.mjs` and
`runSandboxScannerScenarios.mjs` exercise these callables against a real, deployed Firebase project. They have
not been run against any live cloud project for this release, because no such deployment exists or is
authorized. The behavioral guarantees they check are instead evidenced for this release by:

- The Firestore-emulator test suites listed in the closure record's TESTS section (57/57 PR CI checks,
  including `cycleCountAssignedMobileLocation.test.mjs` 12/12 and `cycleCountScan.test.jsx` 18/18), which
  exercise the same command/read code against a real (emulated) Firestore, not a mock.
- The real-browser live acceptance performed during #1854 (desktop + 320/375/390/414 handheld, described in
  full in the PR and summarized in §6 below).

If a live Firebase environment is ever separately authorized, the two runner scripts below remain the correct
way to re-verify at the API level:

```bash
node scripts/runSandboxBinMoveScenarios.mjs
node scripts/runSandboxScannerScenarios.mjs
```

## 5. Deferred: device handheld checklist (for a live Firebase-backed environment)

**Not part of this release's gate — see §0.** This checklist is preserved for whenever real-device acceptance
against a live, authorized backend is run; §6 below records what was actually checked against the currently
deployed stack instead.

**Move stock** — signed in as `partsAssociate`, Scan → Move stock, at each width (320/375/390/414):

- [ ] warehouse picker, From and To pickers and the item scan field fit without horizontal scroll;
- [ ] a part lookup succeeds (no "not authorized to look up parts");
- [ ] scan a bin label (`EOS-LOC:` token) into To; scan the same part three times → one line, quantity 3;
- [ ] a second part → a second line; a serialized part prompts for the serial and refuses a duplicate;
- [ ] Confirm → per-line results; a refused line stays visible with its reason; "Try again" appears only for technical failures;
- [ ] as `partsManager`, Move stock is not offered; as `technician` + receiver, Transfer receive is offered and Move stock is not.

**Technician Transfer receive** — signed in as `technician` (receiver Role, one assigned truck), Scan → Transfer, at each width:

- [ ] the list is titled *Incoming to* the technician's truck and shows only transfers on their way to it;
- [ ] a transfer the warehouse sent to another truck is not listed;
- [ ] pick one → the prompt asks "Are you at truck …"; confirm; scan the part (or each serial) → verified count rises; a wrong or duplicate scan is refused;
- [ ] Receive → "Done — the transfer is now COMPLETED"; back to the list → it is gone;
- [ ] airplane mode before Receive → "pending sync", never "Done"; back online → it completes once;
- [ ] with the list loading while offline → "You are offline…", not "Nothing is on its way";
- [ ] list, verify and outcome fit without the page scrolling horizontally.

**Cycle Count** — `partsAssociate` counts, `partsManager` reviews, at each width:

- [ ] Scan → Count: scan a converted bin's label → the bin locks; an unconverted bin is refused with its reason;
- [ ] scan several distinct parts; a NONE-tracked part scanned three times → quantity 3; zero is enterable;
- [ ] a serialized part records each serial; a duplicate serial is refused; no expected figure or variance is shown before submit;
- [ ] submit → per-line outcomes; a refused line keeps its reason and the others stay submitted; "Try again" only for technical failures;
- [ ] offline (airplane mode) → the count queues; back online → it submits once;
- [ ] reload mid-count → the sheet resumes from the server (A4), counted lines shown as counted;
- [ ] start a sheet, leave the screen mid-count, come back → the workspace reaches ACTIVE again with the prior submitted lines intact (the async start/resume result is not silently discarded — #1854's StrictMode fix);
- [ ] as `partsManager`, Inventory → Cycle Counts lists the sheet; the line shows expected / counted / variance; approve or reject with a reason; the counter cannot approve their own material variance;
- [ ] the review workspace and sheet detail fit without the page scrolling horizontally.

**Cycle Count North Star P1 — MOBILE technician flow (#1854)** — signed in as `technician` holding
`inventoryCycleCountCounter`, Scan → Cycle count, at each width:

- [ ] with exactly one ACTIVE truck assigned: the counter workspace shows only that truck (no company-wide truck picker), Start reaches an active sheet, sticky header + "Scanner ready" line are visible, unsubmitted lines read "Hidden until submitted" with no expected/variance number anywhere in the DOM before their own submit;
- [ ] with no active truck assigned: a truthful "No active truck is assigned to you" state, no Start control;
- [ ] with more than one active truck assigned: a visible fail-closed message, never a truck picker and never a silently-chosen truck;
- [ ] as `partsAssociate`/warehouse persona: the existing manual BIN/Warehouse Start/Resume form is unchanged — the MOBILE truck path is additive, not a replacement;
- [ ] manager review reached live at 390: Approve/Reject reachable without horizontal scroll, SoD disabled state shown on a self-submitted variance, next-unresolved-variance scroll-into-view after a decision.

## 6. This release's actual deployment evidence and current-stack smoke check

**Deployment health for the executable SHA `96f9a66a995942fe3f671feea772e1094e0badc3`:**

| Platform | Result |
|---|---|
| Vercel Production | `success` — "Deployment has completed"; `verenwardeos.vercel.app/version.json` served `commit: "96f9a66"` at the time this SHA was the latest push |
| GitHub Pages | workflow run completed/`success`; `taylorservice-spec.github.io/Taylor_Parts/field-ops/version.json` reports `"commit": "96f9a66"` |
| Render `eos-api-nonprod` | deploy `dep-dahin7c9v7es73b5j75g` status `live`; `/health` returns `{"ok":true,"environment":"nonprod","reachable":true,"migrated":true}` |
| Firebase | not applicable / not performed — see §0 |

**Deployment health for the release-document SHA `1fdef0b748e8ec98bcd957375ef9f3689daa1e59` (#1856):**

| Platform | Result |
|---|---|
| Vercel Production | `success` (Vercel has no path filter, so this docs-only push still redeployed; `version.json` now reports `commit: "1fdef0b"`, the current latest) |
| GitHub Pages | correctly **not** triggered — no workflow run for this SHA (path filter excludes docs-only changes) |
| Render `eos-api-nonprod` | correctly **not** triggered — no new deploy for this SHA (no `functions/` change) |
| Firebase | not applicable / not performed |

**Current-stack smoke check (read-only, against the live deployed Vercel Production build; no acceptance
ceremony rerun — the #1854 real-browser live acceptance in the PR is the behavioral baseline this check
confirms is still reachable, not replaced):**

- Cycle Counts landing (`/inventory/cycle-counts`) loads: the North Star composition renders — header, blind
  counting explainer, "Show: Open" filter, "New count" action.
- Mobile route reaches Cycle Count: at 375px, Scan → "Count what is on the shelf" opens the real counter
  `StartOrResume` screen (COUNT A BIN / CONTINUE A COUNT / COUNT A WHOLE WAREHOUSE OR TRUCK) — confirms the
  phone-routing fact from #1854 (`WarehouseShell` → `ScanWorkspace` → `CycleCountScan`) holds on the deployed
  build, not only in a local dev server.
- No console/runtime crash on either screen; the app fails **honestly** rather than throwing: "The cycle count
  action could not be completed. Your work elsewhere is unaffected."
- **Finding, not a #1854 regression:** all four onCall callables probed (`listCycleCountSheets`,
  `getCycleCountAssignedMobileLocation`, `listMyReceivableTransfers`, `lookupScannedPart`) — two predating
  #1854, two added by it — fail identically with a CORS/connectivity error against
  `us-central1-eos-platform-sandbox.cloudfunctions.net` from the deployed origin. Identical failure across
  callables added in different PRs over different weeks means this is an environment characteristic (no
  Firebase Functions deployment currently serves this project for this origin — consistent with §0: Firebase
  deployment is out of scope for this release), not a code defect introduced by #1854. `getCycleCountAssignedMobileLocation`
  itself is confirmed present in the deployed bundle and correctly invoked (visible in the network/console log),
  so the new code path is wired end to end; only the backend it calls is unreachable, for the same reason every
  older callable also is.
- Manager review route: same page as the landing (`CycleCounts.jsx`'s `SheetDetail`/list composition) —
  renders, fails honestly for the same reason above; live per-line Approve/Reject interaction was not
  exercised against this deployed stack (no reachable backend to exercise it against, and no fixture data
  would be safe to manufacture here regardless). Behavioral evidence for manager review remains the #1854 PR's
  real-browser acceptance.
- No mutating write was attempted against the deployed environment. No production-like data was manufactured.

## 7. Recorded, not changed

- **Technician receive — closed by #1852.** The handheld no longer depends on the Rules-gated client
  `transfer_orders` read for a receive-only technician; it uses the governed `listMyReceivableTransfers` read. Rules
  are unchanged, and principals who dispatch keep the existing shared read.
- **Technician Cycle Count MOBILE authority — closed by #1854.** A prior draft of this PR's own body claimed no
  governed technician-to-truck assignment existed anywhere in the codebase. That claim was stale/wrong: #1852's
  `readAssignedMobileLocation` resolver already existed and is reused unchanged by
  `getCycleCountAssignedMobileLocation`, composed with the existing Cycle Count counter capability pair. No new
  authority, no new Rules, no client-side all-truck browse. Corrected in the PR body and here.
- **Async start/resume — closed by #1854.** React 18/19 StrictMode's development-only phantom
  mount→unmount→remount at initial mount permanently zeroed the `alive` ref used by every scan workflow's
  stale-response guard, silently discarding real server results (create/get Cycle Count sheet included). Fixed
  in the shared pattern across `CycleCountScan.jsx`, `LookupScan.jsx`, `MoveStockScan.jsx`, `PickScan.jsx`,
  `PutAwayScan.jsx`, `ReturnIntakeScan.jsx`, `TransferScan.jsx` and `ReceiveAgainstPurchaseOrder.jsx` — not a
  Cycle-Count-only patch. Real unmounts still discard in-flight results; only the StrictMode phantom cycle no
  longer does.
- **Handheld routing — corrected, not changed.** A prior draft of this PR's own body claimed <640px routes to a
  `WarehouseShell` that does not compose Cycle Counts, and that the handheld path was unreachable. Live browser
  verification at 320/375/390/414 (and reconfirmed against the deployed build at 375px in §6) found
  `WarehouseShell` already composes `CycleCountScan` via `ScanWorkspace`; no routing code changed. Corrected in
  the PR body and here.
- **Deployment model — corrected by this record (2026-09-10 continuation).** This record previously treated a
  Firebase Functions + Hosting deploy to `eos-platform-sandbox` as the release's own gate. That framing is
  retracted (§0); the application's actual deployment surfaces are Vercel Production, GitHub Pages, and Render
  `eos-api-nonprod`, all confirmed healthy for the executable SHA in §6.
- **Phoenix.** The Phoenix bin conversion needs on-site facts (bin layout, labels, counts) that are not in the
  repository; nothing here invents them. Tooling and runbook: #1837.

## 8. Result

Vercel Production, GitHub Pages, and Render `eos-api-nonprod` are confirmed deployed and healthy for the
executable SHA `96f9a66a995942fe3f671feea772e1094e0badc3` (§6). Firebase deployment is not applicable to this
release and was not performed (§0). §§2–5's Firebase-environment operator procedure, grants, Quick Gate and
device checklist remain deferred and non-blocking; they would be exercised only if the Owner separately
authorizes standing up a live Firebase environment for these callables. Training follows this closure — see
`docs/training/CYCLE_COUNTS.md`.
