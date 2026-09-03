# Sandbox release readiness — Profile Dashboard / Customer 1

**Generated 2026-09-03.** Measured against the live sandbox and current main, not against any prior
handoff.

> ## ⚠ THIS HANDOFF EXPIRES IF THE DEPLOYABLE SURFACE MOVES
>
> Valid for `LIVE_SANDBOX_SHA = 5eaa403a`, with the deployable surface measured through `8ae9c7e1`.
> If the sandbox is deployed by anyone, or if `origin/main` gains a commit touching `functions/src`,
> `field-ops-app-vite/src`, either `firestore.rules`, `firestore.indexes.json` or
> `config/environments.json`, **every figure below is stale** — re-run §13 before deploying.
>
> Docs-only commits do not expire it, which is the distinction that lets this document survive its own
> merge. The Rules requirement in this release is the proof of why the check matters at all: it entered
> through a commit no audited workstream authored.

| | |
|---|---|
| **LIVE_SANDBOX_SHA** | `5eaa403a` |
| sandbox project | `eos-platform-sandbox` (env id `platform-sandbox`, role `sandbox`, status `live`) |
| sandbox build time | `2026-09-02T17:15:02.702Z` |
| **DEPLOYABLE SURFACE MEASURED THROUGH** | `8ae9c7e1b969842476e82b5ec2f387d8f2386138` |
| **RELEASE_CANDIDATE** | current `origin/main` — see below |
| status | **PARTIAL — one attempt ran and FAILED during Functions.** See §0. |

## 0. Attempt log — 2026-09-03, PARTIAL / FAILED

The Owner launched the governed refresh. Preflight passed. **The release did not complete.**

| Phase | Outcome |
|---|---|
| Preflight + guards | PASSED |
| Functions — 4 named batches | **DEPLOYED** — 11 functions, 09:16:04Z → 09:22:07Z |
| Functions — `remaining estate` | **FAILED** — `Secret KEYSTONE_* not found or has no versions` ×5 |
| Hosting | **NOT REACHED** |
| Rules | **NOT DEPLOYED** |

**Cause.** The final batch was `firebase deploy --only functions` — unfiltered, so it pulled in
`interpretWorkOrderReadinessContext`, which binds five `KEYSTONE_*` Secret Manager secrets.
platform-sandbox does not have them **on purpose**: `privateAiSyntheticOperationalInterpretation` is
`false` there. The only ways to satisfy that command were to provision Keystone credentials for a
capability nobody authorized, or to weaken the function's secret binding. Both are wrong.

**Measured live state** (`gcloud functions list`, read-only). Exactly 11 functions carry a
2026-09-03 `updateTime`; the next most recent is `listFinancialFacts` at 2026-09-02T15:42Z, i.e. the
*previous* release. So the partial deploy is precisely the four named batches and nothing else:

```
resolveScannedPartIdentifier  getPartBalance
createBin  deactivateBin  reactivateBin  resolveBin  listBins
recordPutAway  recordReturnIntake
getPurchaseOrderReceivingProgress  listReceivablePurchaseOrders
```

`interpretWorkOrderReadinessContext` is **MISSING** from platform-sandbox — it has never been
deployed there, and this change does not deploy it. Its non-secret sibling
`getWorkOrderReadinessContext` is live and unaffected. Live estate: 132 functions.

**Consequence of the partial deploy: none that blocks a retry.** All 11 are idempotent redeploys of
scanner and receiving reads from the same candidate tree; Hosting still serves `5eaa403a`, so
`LIVE_SANDBOX_SHA` is unchanged and every measurement below still holds.

**Remedy — merged.** `scripts/_sandboxRefresh.run.sh` no longer issues an unfiltered
`--only functions`. It derives the deployable set from the compiled manifest
(`functions/lib/index.js` — the same artifact `firebase deploy` loads) minus a governed exact-id
exclusion list, and deploys it in batches. See `scripts/sandboxDeployableFunctions.mjs`.

- The excluded function still requires all five secrets **when it is itself deployed**. Nothing was
  weakened, stubbed, faked or created. No secret exists that did not exist before.
- No private-AI capability was activated anywhere.
  `privateAiSyntheticOperationalInterpretation` remains `false` in all five environments.
- `--except` is **not** the mechanism. firebase-tools 15.22.4 applies `--except` as a plain string
  difference over *top-level* targets and never splits on `:` — so
  `--except functions:interpretWorkOrderReadinessContext` would have excluded **nothing**, and
  `--except functions` would have dropped the entire estate. Verified in the installed CLI.
- A future secret-bound function does **not** get skipped: the derivation **refuses the release** and
  names it, so a human decides. "Has a secret" never means "skip in sandbox."

**Action: re-run the governed refresh from the beginning.** Do not resume mid-way. The four named
batches re-run harmlessly, and the guards must all execute against the current tree.

**Why the candidate is a ref and not a pinned SHA.** The governed runbook derives its own approved
commit from `HEAD` and gates on `HEAD == origin/main`; it takes no pinned SHA. Naming one here would
also be self-defeating: merging this very document moves `origin/main`, which by the expiry rule above
would make the document stale the moment it lands.

So the durable fact is the **deployable surface**: every Functions, client, Rules, index and
environment measurement below was taken through `8ae9c7e1`. Commits after it that touch **none** of
those paths — this document among them — do not change the release. The preflight in §9 is what proves
that still holds at deploy time.

---

## 1. The delta — 44 commits

| Dimension | Count |
|---|---|
| Total commits | **44** |
| Client-facing (`field-ops-app-vite/src`) | **19** |
| Functions source (`functions/src`) | **22 commits · 58 files** |
| `firestore.rules` | **1** |
| `firestore.indexes.json` | **0** |
| `config/environments.json` | 5 |
| Package manifests | 11 |

---

## 2. Functions — a bounded deployment is NOT possible for this release

**This is the finding that matters most, and it overturns the earlier six-function list.**

Every exported Function was classified by tracing changed modules through the transitive import graph:

| Classification | Count |
|---|---|
| Exported Functions examined | **143** |
| `OWN_CODE_CHANGED` | 22 |
| `SHARED_DEPENDENCY_CHANGED` | **121** |
| `UNCHANGED` | **0** |
| `UNKNOWN` | 0 |

**Zero Functions are unaffected.** Shared modules changed in the gap — `constants/collections.ts`,
`access/permissionCatalog.ts`, `access/roleHierarchy.ts`, `access/auditEventWriter.ts`,
`access/environmentCapabilityOverrides.ts` — and essentially the whole estate imports them. A
"bounded list" would ship a half-updated estate whose functions disagree about shared contracts.

**`OWN_CODE_CHANGED` (22):** `approvePerformanceGoal` · `createBin` · `createPerformanceGoalDraft` ·
`createReorderRequest` · `deactivateBin` · `getInventoryAnalytics` · `listBins` ·
`listCurrentPerformanceGoals` · `listGoalSubjects` · `listPerformanceGoalVersions` ·
`listReorderWarehouseOptions` · `listWorkOrderConsumptionSources` · `previewBinCreates` ·
`reactivateBin` · `recordPutAway` · `recordReorderPurchaseOrder` · `renameBin` · `resolveBin` ·
`resolveBinToken` · `retirePerformanceGoal` · `setWorkOrderPartsPlan` ·
`updateWorkOrderExecutionData`

**Note:** `transitionWorkOrder` and `receiveInventoryStock` are `SHARED_DEPENDENCY_CHANGED`, not
`OWN_CODE_CHANGED` — their own files are unchanged, their dependencies are not. A bounded list built
from "what did we edit" would have shipped them stale.

### The governed mechanism already resolves this

`scripts/_sandboxRefresh.run.sh` deploys the estate **in small named batches**, not one
`--only functions` call — because a large single batch "transiently fails a SUBSET… so the estate is
left half-new". That is the reviewed whole-estate mechanism §7 asks to be compared against a bounded
one, and with **0 unchanged Functions** the comparison is settled: use the runbook.

---

## 3. Firestore Rules — REQUIRED, and it is a coordinated cutover

**Required: YES.** Measured with the runbook's own computation (`git diff <deployed> HEAD --
firestore.rules firestore.indexes.json`).

- **Only one** rules-touching commit in the entire gap: `5824df2a` / **#1763**.
- **Complete semantic delta** — one block removed, nothing added:

```
- match /stock_locations/{stockLocationId} {
-   allow read: if isAdminOrDispatcher() || isAssignedToWarehouse(resource.data.warehouseId);
-   allow create, update, delete: if false;
- }
```

- **Narrowing only.** The read arm is deleted, leaving deny-all-by-absence. Nothing is granted.
- Both governed copies (`firestore.rules`, `field-ops-app-vite/firestore.rules`) are **identical** on
  the RC.

**#1763's coordinated cutover.** It retired the last `stock_locations` client reader *and* the Rules
arm serving it. Hosting without the narrowing leaves a read arm live for a surface that no longer
exists; the narrowing without Hosting breaks a client still reading it.

**⚠ The governed runbook does NOT deploy Rules.** Its final step computes the diff and says: *"A
Rules/index deploy is a SEPARATE protected action. STOP and get it authorized."* So this release needs
a **separately authorized Rules deploy** alongside the runbook — see §8.

## 4. Indexes — NOT required

`firestore.indexes.json` has **zero** commits in the entire gap. Verified across all 44, not inferred
from the audited workstreams.

---

## 5. Hosting — whole bundle, 19 client-facing commits

**Required: YES.** Hosting is a whole-artifact release. **This is not "the dashboard deploy".**

| Family | Commits |
|---|---|
| Dashboard / profile / performance goals | #1745 |
| Reporting period authority (G-05) | #1751 |
| Reporting activation | #1768 |
| Financial Policy | #1776, #1778 |
| Purchasing / acquisition cost | #1755, #1762 |
| Inventory — BIN identity, racking, labels | #1756, #1771, #1774 |
| Inventory — stock-location retirement | #1759, **#1763** |
| Inventory — movement type retirement | #1767 |
| Physical consumption + source selection | #1772, **#1775** |
| Access — Finance Manager parity / financial reach | #1744 |
| Governance / certification backlog / docs | #1764, #1777, #1780 |

---

## 6. Environment posture — measured from `config/environments.json`

| Environment | Role | `capabilityActivationOverrides` | `productionCapabilityActivations` |
|---|---|---|---|
| `local-emulator` | sandbox | 0 | 0 |
| **`platform-sandbox`** | sandbox | **83** — 36 `report.*`, 2 `financialPolicy.profile.*`, 45 other | **0** |
| `platform-certification` | sandbox | 3 (cycle count) | 0 |
| `platform-integration` | integration | 0 | 0 |
| `taylor-parts-production` | production | 0 | **25** (all `report.*`) |

- **Sandbox Reporting:** 36 `report.*` overrides — governed activation present.
- **Sandbox Financial Policy:** `financialPolicy.profile.read` + `financialPolicy.profile.configure`.
- **Production:** 25 activations exist as **repository representation**. Production Hosting is at
  `4f30ab3a` (2026-08-19) — these are merged and **not deployed**. This release targets sandbox only
  and cannot change production behaviour.

**`checkDeployedVersions.mjs` also reports production surfaces disagreeing with each other**
(hosting `4f30ab3a` vs pages `b6c1da4`). Recorded as an observation. **Out of scope, not touched.**

---

## 7. Pre-deploy gates — all green on the RC

| Gate | Result |
|---|---|
| `npm run test:governance` | **667 pass / 0 fail** |
| `node scripts/syncAccessContracts.mjs --check` | **in sync (9 modules)** |
| Generated governance artifacts | **no drift** |
| `npm run test:fulfillment` | **166 pass** |
| Cost / purchasing / dashboard / reporting / financial policy (pure) | **251 pass** |
| Customer 1 E2E + execution idempotency (emulator) | **22 pass** |
| `inventoryService` (emulator) | **26 pass** |
| `reservationFollowsDemand` (emulator) | **9 pass** |
| Financial policy command + activation (emulator) | **38 pass** |
| `acquisitionCostReceipt` (emulator) | **10 pass** |
| Client `npm ci` + node manifest | **274 suites passed** |
| Client components | **3152 pass / 7 skipped** |
| Client build · lint | **clean** |
| `npm run verify:build-base` | **12 pass / 0 fail** |

Emulator ran on an **isolated port 8097**. No other session's emulator was touched.

### Authority states, read from compiled code

`PHYSICAL_CONSUMPTION_ACTIVE = true` · `WORK_ORDER_CONSUMPTION` in movement types · 
`PRICE_AUTHORITY_VERSION = 2` · `salesOrder.fulfill active = false` · 
metric registry **37 registered / 12 active / 25 blocked** · `performance.goal.*` **5 registered, 0 active**

### Customer 1 proofs (emulator, through the real callable)

receive 5 → consume 2 → **on-hand 3, SO availability 3** · truck consume after transfer leaves
**warehouse 2, never 0** · correction restores original source once · no-source **refused** with
qtyUsed and stock unchanged · completion does **not** double-decrement.

**These are emulator proofs, not live proofs.** Live proof requires deployment.

---

## 8. Release order — use the governed runbook

The runbook is the mechanism. **Do not hand-assemble `firebase deploy` calls.**

It already sequences: structural safety guard → release provenance guard → build functions lib →
Functions in named batches → build-base contract → build for `platform-sandbox` → verify artifact
project → release identity gate → Hosting → deployed-revision gate → callable verification →
Rules/index diff report.

**Its own header states it is "intentionally NOT run by any agent session — deploy is a
human-triggered action."** That is the boundary this run stops at.

| Stage | What changes | Why required | Verify before continuing | Rollback point |
|---|---|---|---|---|
| **0** | nothing | prove target ≠ production and artifact provenance | guard exits 0; release commit printed = `8ae9c7e1` | abort costs nothing |
| **1** | Functions estate (named batches) | 0 of 143 Functions are unaffected | each batch exits 0; a failed batch **stops** the script | previous Functions revision |
| **2** | Hosting artifact | 19 client commits; #1763 removes the last `stock_locations` reader | identity gate: deployed `version.json` commit == `8ae9c7e1` | previous Hosting release |
| **3** | **Firestore Rules** — SEPARATE, SEPARATELY AUTHORIZED | #1763's coordinated cutover; narrowing only | `stock_locations` read denied; no other rule changed | redeploy prior rules |

**Ordering note.** The runbook ships Functions then Hosting. Rules is not in it. Between stage 2 and
stage 3 the retired read arm is still permitted while no client uses it — a **permissive** interval,
not a breaking one. The reverse order (Rules first) would break any still-deployed client that reads
`stock_locations`, so **Rules must follow Hosting.**

---

## 9. Exact commands — NOT EXECUTED

Every command names `eos-platform-sandbox` explicitly. **None relies on `.firebaserc` default, which
resolves to `taylor-parts` (production).**

**Preflight — confirm the handoff has not expired:**

```bash
git fetch origin && git rev-parse origin/main            # must equal 8ae9c7e1b969842476e82b5ec2f387d8f2386138
curl -s https://eos-platform-sandbox.web.app/version.json # must still report commit 5eaa403a
node scripts/_sandboxDeployGuard.mjs                      # must print GUARD OK, projectId eos-platform-sandbox
```

**Stage 1 + 2 — Functions and Hosting, via the governed runbook (human-triggered):**

```powershell
.\scripts\Invoke-SandboxRefresh.ps1
```

or, directly, using Git's bash **wrapper** (`bin/`, not `usr/bin/` — the raw binary loses `/usr/bin`
and fails several steps in):

```bash
& "D:/Git/bin/bash.exe" scripts/_sandboxRefresh.run.sh
```

**Stage 3 — Rules. SEPARATE, and requires its own authorization:**

```bash
node scripts/_sandboxDeployGuard.mjs
firebase deploy --only firestore:rules --project eos-platform-sandbox
```

**Indexes: no command — not required for this release.**

**Never run:** a bare `firebase deploy`, any command without `--project eos-platform-sandbox`, or
anything naming `taylor-parts`.

---

## 10. Post-deploy verification — for the next authorized session

**Identity first. Nothing below is meaningful until this passes.**

1. `curl -s https://eos-platform-sandbox.web.app/version.json` → `commit` == `8ae9c7e1`
2. `node scripts/checkDeployedVersions.mjs` → `platform-sandbox` reports **no DRIFT**

**Dashboards** — route `https://eos-platform-sandbox.web.app/dashboard` (nav: *Dashboard → My
Dashboard*), at **1440** and **375**:
composition matches the signed-in identity/role · reporting periods render (MTD/QTD/YTD/T12M) ·
gated/unavailable modules say so honestly · **no fabricated 0s** where a metric is blocked.

**Customer 1 inventory** — through the real UI:
receive 5 → consume 2 → on-hand **3**, SO availability **3** · warehouse→truck transfer, then consume
from truck → warehouse **unchanged** · decrement restores the original source once · usage with no
source **refused** with actionable wording · completion does not decrement twice.

**Purchasing / cost:** Taylor priced PO → receipt → `AcquisitionCostFact`; Ventana the same under its
governed `operatingCompanyId`; a legitimate legacy unpriced PO → receipt → **no** cost fact, cost
UNKNOWN not $0. *(Do not manufacture a legacy record through the new API — the command refuses an
unpriced commitment.)*

**Rules:** the retired `stock_locations` client surface is gone from the app, and a direct client read
is **denied**.

**Reporting:** sandbox activation resolves through runtime environment identity; withheld sensitive
fields remain withheld.

**Financial Policy:** sandbox read/configure resolves; the profile lock is absolute;
`WORK_ORDER_CONSUMPTION` is **selectable** as a recognition point — **selectable is not recognized**,
and no cost-relief writer exists.

**Training — only after the above passes:** verify the deployed workflow against
`TECHNICIAN_RECORDING_PART_USAGE.md` and `PURCHASING_RECORD_PURCHASE_ORDER.md`, then move each to
`COMPLETE`. Merged code is not a verification.

**Owner visual acceptance:** `https://eos-platform-sandbox.web.app/dashboard` (My Dashboard) at 1440
and 375, per role.

---

## 11. State that must NOT change in this release

`salesOrder.fulfill` **inactive** · ATP **open** · stockout **open** · valuation **open** · recognized
COGS **open** · margin / turns / carrying cost **open** · `performance.goal.*` **registered, not
activated** · production **untouched**.

Blocked metrics do **not** block deployment: the dashboard renders their unavailability truthfully.

## 12. Blockers

**Deployment blockers: NONE remaining.** One blocker was hit and is now fixed — the unfiltered
`--only functions` batch that demanded absent `KEYSTONE_*` secrets (§0). The release is assembled,
gated and green, and the refresh must be **re-run from the beginning**.

**Authorization gates (not defects):**

1. **Sandbox deploy is human-triggered** — the runbook says so in its own header, and the boundary has
   been denied to agent sessions. This run stops here by design.
2. **Rules deployment is separately authorized** and is not part of the runbook.

**Open authorities recorded, none invented:** cost correction · returns/rebates · landed cost · FX ·
labour cost · carrying rate · supplier-quote prefill (needs a governed client read of
`part_supplier_items`) · inventory ledger `operatingCompanyId` · Sales Order commitment unification ·
Taylor's accounting method selection *(a deployment profile choice, not release housekeeping — not
made here)*.

## 13. Re-measure before deploying

```bash
git fetch origin && git rev-parse origin/main
curl -s https://eos-platform-sandbox.web.app/version.json
git log --oneline <deployed>..origin/main -- functions/src
git log --oneline <deployed>..origin/main -- field-ops-app-vite/src
git log --oneline <deployed>..origin/main -- firestore.rules field-ops-app-vite/firestore.rules
git log --oneline <deployed>..origin/main -- firestore.indexes.json
```

If either SHA moved, this document is stale. **A Rules or index requirement arriving through a commit
no workstream here authored is exactly as binding as one it did** — which is how the Rules
requirement in this very release was found.
