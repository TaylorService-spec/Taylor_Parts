# Sandbox promotion package — metadata program

**Status: PREPARED, NOT DEPLOYED.** Nothing here has been applied to any environment. Preparing
a promotion is repo work; deploying it is a separate, protected authorization.

---

## A. Source binding

| | |
|---|---|
| **Promotion SHA** | **`b891fc689427aee2b1246f3132122e1a0feb2e8d`** |
| **Recorded baseline (claim)** | `23fd5692` — 2026-08-15 |
| **Verified live baseline** | **`cd442727103a983ec332fe880b7dcca1019773b5`** — 2026-08-16 |
| **Did they match?** | **No.** |

Read live from `https://eos-platform-sandbox.web.app/version.json`:

```json
{ "commit": "cd442727", "base": "/", "buildTime": "2026-08-17T04:45:17.863Z",
  "environmentId": "platform-sandbox", "environmentRole": "sandbox", "schema": 2 }
```

`environmentId` and `environmentRole` confirm the intended target. The served commit is an
ancestor of `main`, so the promotion is a fast-forward with no divergence.

`b891fc68` is the last commit that touches deployable runtime. The ledger and this document are
committed after it and are documentation-only — runtime-identical. Promote `b891fc68`'s tree, or
any later doc-only commit; verify by diffing the deployable paths rather than assuming.

### Why this mattered

The recorded baseline was **two days and many merges stale**, and every provisional number
computed from it was wrong — all in the direction of overstating the work:

| | from recorded `23fd5692` | from **verified `cd442727`** |
|---|---|---|
| Cloud Functions files | 74 | **31** |
| New callables | 8 | **2** |
| Firestore Rules | +10 lines, 1 new block | **zero delta** |
| Live indexes | 6 | **8** |
| Hosting/frontend files | 201 | **106** |

The most consequential correction is the Rules delta. From the recorded baseline it looked
like a Tier-2 protected action was required. **It is not** — `firestore.rules` is byte-identical
between the live commit and `main`. That protected boundary does not exist in this promotion,
and asserting it would have manufactured an approval gate out of a stale number.

This is exactly why deployment state must be read from the environment rather than inferred
from a repository record.

---

## B. Hosting / frontend delta

**106 changed files** under `field-ops-app-vite/src`, of which **46** are the metadata layer.

The metadata program is **entirely absent from the sandbox**: at `cd442727` there are **zero**
files under `src/metadata/definitions/`; `main` has **28**, plus 10 new runtime modules
(`entityDefinition`, `listViewDefinition`, `pageDefinition`, `listRuntime`, `pageRuntime`,
`listPresentation`, `registry`, `firestoreListSource`, `callableListSource`, `boardScope`).

This is a **platform introduction**, not an incremental update. Nothing in the sandbox has ever
exercised this code path.

User-visible changes carried by it include four surfaces migrated onto the shared list runtime
(Manufacturers, Warehouses, Suppliers, the Customer Equipment tab), the Account record page's
metadata-rendered sections, and five separate fixes where a raw Firestore document id was being
displayed as a human name.

Build: standard Vite build; no new build-time requirement.

---

## C. Cloud Functions delta

**31 changed files. Exported callables 82 → 84. Two new:**

- `getAccountPortfolioSummary`
- `listSalesOrderIndex` — the unscoped Sales Order INDEX read

No callable was removed or renamed. Runtime is **node 22** (`functions/package.json` engines),
unchanged from live.

Also changed but **not** new exports: the operational numbering allocators
(`transferOrderNumbering`, `receivingOrderNumbering`, `reorderRequestNumbering`), which are
wired into existing command paths rather than exposed directly.

**Deployment hazard, previously observed:** large `firebase deploy --only functions` batches
have transiently failed for a subset. Retry, then fall back to small named batches. This is a
recorded operational fact, not a new risk.

---

## D. Firestore index delta

| | |
|---|---|
| Live (at `cd442727`) | **8** |
| Declared on `main` | **38** |
| **Missing live** | **30** |

Computed by comparing declared index shapes, not by trusting the pending-deploy list — the two
agree, which is corroboration rather than assumption.

Missing by collection: `accounts` 3 · `parts` 3 · `equipment` 3 · `employees` 3 · `trucks` 3 ·
`equipment_models` 3 · `fieldops_wos` 2 · `contacts` 1 · `opportunities` 1 · `sales_orders` 1 ·
`locations` 1 · `warehouses` 1 · `suppliers` 1 · `manufacturers` 1 · `stock_locations` 1 ·
`mobile_locations` 1 · `transfer_orders` 1.

**Indexes must be deployed before the surfaces that depend on them.** A filtered or sorted read
without its composite index fails at runtime, not at build. The emulator does **not** enforce
composite-index requirements, so emulator-green is not evidence that a filtered read will work
in the sandbox.

Index builds are asynchronous. Record build state and wait for serving before running any
acceptance test that depends on one.

---

## E. Firestore Rules delta

**None.** `firestore.rules` is byte-identical between `cd442727` and `main`.

No Tier-2 authorization is required for this promotion, and no post-deploy Rules verification is
needed — because no Rules change is being deployed.

(The `cycle_counts` deny-all block that appeared in the provisional delta predates the live
commit and is already deployed.)

---

## F. Fixture / seed delta

No governed seed changes. Two operator scripts changed but are **inert**: the operational
numbering backfill (dry-run by default, production-guarded three ways) and the Sales Order
number backfill CLI. Neither runs as part of a promotion.

Population state affects what a smoke test can prove:

- `part_aliases` — genuinely unpopulated; no writer anywhere in the repo.
- `supplier_catalog` — read-live, written only by a local demo seed script.
- `transfer_orders`, `receiving_orders`, `reorder_requests` — legacy rows carry **no** business
  reference; the new `TO-`/`RO-`/`RR-` numbers apply to newly created records only.

An empty list on one of these confirms fixture state, not code correctness.

---

## G. Activation / config delta

**No sandbox activation change.** The only `config/environments.json` edit since the live commit
flips `TRUCK_MANAGEMENT_WRITE_READY` from `true` to `false` for **`taylor-parts-production`** —
a fail-closed production guard, unrelated to sandbox.

**Correcting an earlier draft of this document:** it warned that surfaces gated on
`salesOrder.read`, `opportunity.read` and `finance.read` would render denied for every viewer,
because those capabilities are registered `active: false`. That is true of the catalog default
and **false for this environment** — `platform-sandbox` carries **27 `capabilityActivationOverrides`**,
including all three. They are active in sandbox.

That distinction decides how verification reads a denied surface: in sandbox, a denied Sales
Order list is a **failure**, not expected behaviour.

---

## H. Proposed deployment order

Dependency-driven; verify against repo tooling before executing.

1. **Preflight** — confirm live `/version.json` still reports `cd442727`; abort if it moved.
2. **Indexes** — deploy all 30; wait for serving state before dependent acceptance.
3. **Rules** — *no action; zero delta.*
4. **Functions** — 2 new callables plus changed internals; small named batches on failure.
5. **Hosting** — the metadata platform introduction.
6. **Fixtures/seeds** — only if a verification step needs population that does not exist.
7. **Environment verification** — re-read `/version.json`; confirm the served commit equals the
   promotion SHA. A successful deploy command is not convergence evidence.
8. **Focused E2E** — the matrix below.

---

## I. Post-deploy verification matrix

Scoped to what changed. Prior E2E evidence is **not** current-main evidence and must not be
reclassified as such without fresh execution.

### Changed surfaces — must verify

| Area | What to prove |
|---|---|
| Metadata registry | Loads; definition coverage complete; every definition resolves |
| Field Architecture contracts | Identity modes hold; **no raw-id identity fallback anywhere** |
| List runtime | Bounded reads; deterministic ordering; denied / unavailable / empty stay three distinct states |
| Cursor pagination | Advances and terminates; **no offsets**; no fabricated totals from a bounded page |
| Sales Order unscoped INDEX | Authorized positive; unauthorized negative; cursor works; **Account-scoped related list still separately correct** |
| Declared filters | Actually execute live — this is what the 30 indexes are for |
| Identity | Opportunity/Sales Order references display; SYSTEM_ONLY records do not pretend to have human identity |
| Migrated surfaces | Manufacturers, Warehouses, Suppliers, Customer Equipment tab render |
| Account record page | Metadata-rendered sections; truncation disclosed, never presented as the whole set |
| **Raw document-id regression** | Five id-as-label defects were fixed; assert none returned |
| New callables | `getAccountPortfolioSummary`, `listSalesOrderIndex` reachable; correctly denied without capability |

### Regression smoke — previously proven core

Do not replay the full historical matrix unless a dependency changed.

- Parts Catalog renders
- Part-side on-hand remains governed-ledger based
- Receiving authorization reachability
- Transfer authorization reachability
- Cycle Count authorization reachability at least privilege
- **Sales Order allocation derives sellable stock from the governed ledger, not `stock_locations`**

That last one deserves attention: the live commit **is** the change that established it
(`cd442727`). It is the newest behaviour in the sandbox and the least re-verified.

---

## J. Stage discipline

Everything above is at **MERGED**. Nothing is DEPLOYED, ACTIVATED, USER-VISIBLE or E2E VERIFIED.

Each stage must be earned separately: export ≠ deployed, merge ≠ deployed, a successful deploy
command ≠ environment convergence, emulator pass ≠ live index availability, Hosting version ≠
Functions version, and old E2E evidence ≠ current-main E2E evidence.

---

# Tranche 0 — read-only preflight evidence

**Captured 2026-08-18T19:17:58Z. Read-only. No deployment, seed, or configuration mutation was
performed.**

## Result: PASS

| Check | Result |
|---|---|
| Working tree clean | **Yes** — `git status --porcelain` empty |
| Runtime SHA exists | **Yes** — `b891fc689427aee2b1246f3132122e1a0feb2e8d` |
| Delta from `main` | **Docs-only** (3 files under `docs/orchestration/metadata-program/`) — runtime-identical |
| Firebase project | **`eos-platform-sandbox`** — confirmed via `firebase projects:list` |
| Hosting site | `eos-platform-sandbox` → `https://eos-platform-sandbox.web.app` |
| Rules delta | **None** — byte-identical between live `cd442727` and the runtime SHA |
| Fixture delta requiring execution | **None** |
| Activation overrides | **27 present**, `salesOrder.read` included |

## Live `/version.json`

```json
{ "commit": "cd442727", "base": "/", "buildTime": "2026-08-17T04:45:17.863Z",
  "environmentId": "platform-sandbox", "environmentRole": "sandbox", "schema": 2 }
```

Unchanged from the package binding. `environmentId` and `environmentRole` confirm the target.

## Index reconciliation

| | |
|---|---|
| Declared at runtime SHA | **38** |
| Live in sandbox | **8** |
| **Missing** | **30** — matches the package exactly |
| **Unexpected live** | **0** |

Missing by collection: `accounts` 3 · `employees` 3 · `equipment` 3 · `equipment_models` 3 ·
`parts` 3 · `trucks` 3 · `fieldops_wos` 2 · `contacts` 1 · `locations` 1 · `manufacturers` 1 ·
`mobile_locations` 1 · `opportunities` 1 · `sales_orders` 1 · `stock_locations` 1 ·
`suppliers` 1 · `transfer_orders` 1 · `warehouses` 1.

**Error / deletion state:** none observed. All 8 live indexes are enumerable and every one is a
subset of the declared set, so nothing is orphaned or conflicting.

*Limitation, stated rather than glossed:* `firebase firestore:indexes` exports index
**configuration**, not build state — the output carries no `state` field. "No index in an error
or deleting state" is therefore supported by the absence of unexpected or orphaned entries, not
by a direct state read. Tranche 1 must confirm serving state through a channel that actually
reports it.

## Functions inventory

| | |
|---|---|
| Live functions | **82** — all `us-central1`, all `nodejs22` |
| Declared at runtime SHA | **84** |
| `getAccountPortfolioSummary` | **Not live** — expected |
| `listSalesOrderIndex` | **Not live** — expected |
| `listSalesOrdersForAccount` | Live |
| `listOpportunityContext` | Live |

Runtime `nodejs22` matches `functions/package.json` engines. No callable is being removed or
renamed.

## Validation run at the runtime SHA

Repository pinned to `b891fc68…` (detached) for these runs. Exit status checked directly, never
inferred from output text.

```
npm test                        → exit 0   182 suites
npx vitest run                  → exit 0   106 files / 1115 tests
listIndexCoverage --check       → exit 0   33 demands / 38 indexes
indexDriftGuard                 → exit 0
environmentArchitecture         → exit 0
functions build (tsc)           → exit 0
```

## Drift and stop conditions

**None triggered.** Live sandbox state matches the promotion package in every reconciled
dimension: index count and shape, functions inventory, activation overrides, Rules parity, and
the served commit.

## Stage

Sandbox remains at **`cd442727`**. Nothing has been deployed. The promotion stays at **MERGED**.

---

# Tranche 1 — Firestore indexes

**Result: PASS.** Indexes only. No Rules, Functions, Hosting, fixtures, seeds, or activation
changes were deployed.

## Timeline (UTC)

| | |
|---|---|
| Deploy start | `2026-08-18T19:25:13Z` |
| Deploy returned | `2026-08-18T19:25:28Z` (exit 0) |
| All indexes serving | `2026-08-18T19:30:53Z` |

Submission and completion are **not** the same event — the deploy returned in 15 seconds while
the builds took a further ~5.4 minutes. Treating exit 0 as tranche completion would have handed
Tranche 2 a false green.

## Command

```
firebase deploy --only firestore:indexes --project eos-platform-sandbox --non-interactive
```

Scoped deliberately: `firebase.json`'s `firestore` block declares **both** `rules` and `indexes`,
so the unscoped `--only firestore` target would have included Rules.

## Index counts

| | Before | After |
|---|---|---|
| Live in sandbox | 8 | **38** |
| Declared at runtime SHA | 38 | 38 |
| Missing | 30 | **0** |
| Unexpected | 0 | **0** |

30 indexes submitted, across `accounts` 3 · `employees` 3 · `equipment` 3 · `equipment_models` 3 ·
`parts` 3 · `trucks` 3 · `fieldops_wos` 2 · `contacts` 1 · `locations` 1 · `manufacturers` 1 ·
`mobile_locations` 1 · `opportunities` 1 · `sales_orders` 1 · `stock_locations` 1 · `suppliers` 1 ·
`transfer_orders` 1 · `warehouses` 1.

## Serving state — observed, not inferred

Tranche 0 flagged that `firebase firestore:indexes` exports configuration without a `state`
field, so serving could not be confirmed through it. Resolved by using
`gcloud firestore indexes composite list --format="value(state)"`, which does report state:

```
19:26:55Z   30 CREATING   8 READY
19:29:09Z   30 CREATING   8 READY
19:30:01Z   20 CREATING  18 READY
19:30:53Z   38 READY
```

**Final: 38 READY, 0 CREATING, 0 ERROR, 0 DELETING.**

This closes the Tranche 0 limitation. Tranche 2's "required indexes serving" gate now rests on a
direct state read rather than an absence-of-anomaly argument.

## Rules — compiled, not released

The deploy log contains exactly two Rules lines:

```
i  cloud.firestore: checking firestore.rules for compilation errors...
+  cloud.firestore: rules file firestore.rules compiled successfully
```

No ruleset was created and no release was issued — the only deployment line is
`deployed indexes in firestore.indexes.json successfully`.

Reported explicitly because it is stop-condition-adjacent: the `firestore` deploy target
**reads and compiles** `firestore.rules` as a validation step even under `--only
firestore:indexes`. That is validation, not an attempt to deploy. It is also moot in substance —
Rules are byte-identical to live, so a release would have been a no-op — but "would have been
harmless" is not the same claim as "did not happen", and the evidence supports the latter.

Five pre-existing rules **warnings** were surfaced by that compile (unused functions, invalid
function/variable names). They are pre-existing, unrelated to this promotion, and were not
introduced or altered here.

## Acceptance criteria

| | |
|---|---|
| All 38 declared indexes present | **Yes** |
| All required indexes ready/serving | **Yes** — 38 READY |
| None building / error / deleting / missing | **Yes** |
| No Rules or application runtime deployed | **Yes** |
| Existing sandbox behaviour still available | Unchanged — additive indexes only |

## Rollback position

None taken and none required. The 30 new indexes are additive and stay in place regardless of
later tranches, per the rollback policy.

## Stage

Hosting and Functions are untouched. `/version.json` still reports `cd442727`. The promotion
remains **MERGED** for application runtime; only the index layer has advanced.

---

# Tranche 2 — Functions

**Result: FAIL.** Deployment succeeded; **acceptance did not.** One of the two new callables is
unhealthy. Stopped before Tranche 3. **No rollback performed** — see the reasoning below.

## Timeline (UTC)

| | |
|---|---|
| Build | exit 0 |
| Deploy start | `2026-08-18T20:50:27Z` |
| Deploy complete | `2026-08-18T20:53:41Z` (exit 0) |
| Verification | `20:55Z – 21:0xZ` |

Command: `firebase deploy --only functions --project eos-platform-sandbox --non-interactive --force`.
Log header confirms `Deploying to 'eos-platform-sandbox'`. **84 successful create/update
operations, no Hosting or Rules lines.**

## A production-adjacency hazard found during reconfirmation

`.firebaserc` is a **tracked repo file** declaring `"default": "taylor-parts"` — **production**.
`firebase use` with no argument returns `taylor-parts`.

Every command in Tranches 0–2 passed `--project eos-platform-sandbox` explicitly, and both deploy
logs name the sandbox target, so nothing touched production. But **an unscoped `firebase deploy`
in this repository deploys to production**, and the deploy instructions do not require the flag.

Recorded as a standing hazard. Not remediated here: changing `.firebaserc` is a runtime-config
change, and generating changes during deployment is forbidden.

## Functions state

| | |
|---|---|
| Live before | 82 (rollback baseline captured) |
| Live after | **84** — all `ACTIVE` |
| `getAccountPortfolioSummary` | **ACTIVE**, healthy — returns `200 keys=[summary]` |
| `listSalesOrderIndex` | **ACTIVE**, **unhealthy** — returns `500 INTERNAL` |
| Runtime | `nodejs22`, entry point correct, deployed `20:52:19Z` |

## Authorization boundary — correct

| Probe | Result |
|---|---|
| `listSalesOrderIndex`, no auth | **401 UNAUTHENTICATED** |
| `getAccountPortfolioSummary`, no auth | **401 UNAUTHENTICATED** |
| `listSalesOrderIndex`, technician persona | **403 PERMISSION_DENIED** |
| `listSalesOrderIndex`, admin persona | reaches the query, then 500 |

The capability gate works: least-privilege is denied, admin passes the gate. The failure is
**after** authorization, in the read itself.

## The failure

`listSalesOrderIndex` returns `500 INTERNAL` with the message *"The Sales Order read is
temporarily unavailable."* — for **every** shape tried:

- unfiltered, `limit: 3` → 500
- `state: "CONFIRMED"` → 500
- `state: "CLOSED"` → 500
- `limit: 9999` (clamp probe) → 500

Invalid input is still rejected correctly (`state: "OPEN"` → `400 invalid-argument`, naming the
unrecognised state), so argument validation is intact.

### The root cause could not be determined from the environment

**The callable's own catch block discards the error**:

```ts
} catch (err) {
  if (err instanceof HttpsError) throw err;
  throw new HttpsError("internal", "The Sales Order read is temporarily unavailable.");
}
```

No `logger` call, no `console.error`. Cloud Logging therefore contains the 500 request entries
and the `Callable request verification passed` debug lines — **and no error message at all.**

That is a diagnosability defect in its own right, and arguably the more important finding: a
masked catch-all made a live 500 undiagnosable from logs. The user-facing message is honest
about impact but carries nothing an operator can act on.

### A hypothesis tested and disproved

The first hypothesis was a missing composite index: the query orders
`salesOrderNumber DESC` then `documentId() ASC` — mixed directions — while the only declared
`sales_orders` composite is `(state ASC, salesOrderNumber DESC, __name__ ASC)`, which serves the
**filtered** shape.

That would explain the unfiltered failure. **It does not explain the filtered one**, which
matches the declared index exactly and is now live and serving. Both fail identically, so a
missing index is not a sufficient explanation. Recorded so the next lane does not re-run a
disproved theory.

Further black-box narrowing would require either a code change (forbidden during deployment) or
Admin-SDK credentials (a boundary not to cross).

## Regression assessment — none observed

| Callable | Result |
|---|---|
| `listSalesOrdersForAccount` (account-scoped read) | **200** — unchanged |
| `listOpportunityContext` | **200**, 8 rows |
| `getAvailableEquipment`, `listCoordinatedOperations`, `getLocationDisplay` | **403** governed denial |

The 403s are fail-closed capability denials, not errors. **Honest limitation:** no pre-deploy
behavioural baseline was captured for those three, so "unchanged" is asserted only for the two
with before-and-after evidence.

## Why no rollback

The rollback trigger is a **material regression**. There is none:

- No pre-existing callable regressed.
- One new callable works.
- The broken callable is **not reachable from any UI** — Hosting is not deployed, so nothing
  calls it.

Rolling back would revert 82 healthy function updates and remove a working new callable in order
to fix nothing. The 82-function rollback baseline is captured and available if that judgement is
overridden.

## Stage

Functions: **DEPLOYED** at the promotion SHA, one callable unhealthy.
Hosting: untouched — `/version.json` still reports `cd442727`.
Tranche 3 **not** started.

Any fix must enter the normal reviewed workflow and produce a **new promotion identity**.

---

# Promotion reconstruction — after the Tranche 2 failure

**Recorded 2026-08-18T22:25:05Z. Nothing deployed. No live index deleted.**

Tranche 2 failed on `listSalesOrderIndex` returning `500 INTERNAL`. Two corrections merged through
the normal reviewed workflow, producing a **new promotion identity**. The stopped promotion is not
resumed.

## Corrections merged

| PR | Merge SHA | What |
|---|---|---|
| **#1273** | `79bbd6f8b1c46e325d3979252f1c1558308e9f91` | Governance: `equipment_models` stays D4-governed |
| **#1272** | `b237f652da490ac8880393c15bc6e17bdd6f9324` | Sales Order index read fix + masked-catch logging |

### #1273 — the boundary breach

`equipment_models` is declared as `EQUIPMENT_MODELS_COLLECTION` by D4
(`functions/src/equipmentCompatibility/repository.ts`), and D4 defers compound query shapes to D5.
PR #1206 declared an `equipmentModel.index` list view whose filters derived **three
`equipment_models` composites** — a breach of a boundary that was correct and specific.

It was invisible because the equipment-compatibility workflow's `paths:` filter did not include
`firestore.indexes.json`, so a change to the index file could not trigger the guard governing the
index file. Two of this program's own guards also missed it: `listIndexCoverage` and
`indexDriftGuard` compare *declared demands* against *declared indexes*, and both were perfectly
consistent — the metadata program declared a demand **and** an index to serve it. Neither guard has
any notion of **who may declare an index for which collection**.

Corrected by removing the list view and the three declarations, adding `firestore.indexes.json` to
the workflow path filters, and asserting the absence from the metadata side too — a boundary is
worth checking from both directions. Recorded as `DECISIONS #108`.

**The assertion was not weakened, skipped, or bypassed.**

### #1272 — the 500

Firestore appends `__name__` as an implicit tiebreaker **in the same direction as the last explicit
`orderBy`**. The query requested the opposite (`salesOrderNumber DESC`, `documentId ASC`), which
makes `__name__` a real part of the index requirement that no declared index satisfied. That is why
filtered and unfiltered failed identically — the observation that disproved the original
missing-index theory.

Fix: `documentId()` to `DESC`. **No index added or changed.**

Also closed: a limit contract gap the acceptance matrix exposed. An over-limit value was folded
into "not supplied" and returned a default 50-row page, telling a caller who asked for 9999
nothing — and the test description claimed it was "clamped", which was also untrue. An absent limit
still defaults; a supplied invalid one now returns `invalid-argument`.

All three previously-masked catches now log server-side. The client-facing message is byte-for-byte
unchanged and carries no secrets, tokens, authorization data or customer records.

## New promotion identity

| | |
|---|---|
| **New runtime promotion SHA** | **`b237f652da490ac8880393c15bc6e17bdd6f9324`** |
| Superseded promotion SHA | `b891fc689427aee2b1246f3132122e1a0feb2e8d` |
| Commits above it | **none** — it is the tip of `main` |

Between the superseded SHA and this one: three docs-only evidence commits (#1269–#1271) and the two
corrections above, **both runtime-affecting**. This is not a docs-only advance, and the old
promotion SHA must not be reused.

## Index reconciliation — source vs live

| | |
|---|---|
| Source-declared at the promotion SHA | **35** |
| Live in sandbox | **38** |
| **Missing live** | **0** |
| **Unexpected live** | **3** — all `equipment_models` |

The three unexpected entries are the **deliberate orphans** from #1273. Removing a declaration from
source does not authorize deleting a live index; deletion is destructive and separately authorized.
They serve no query and cost only storage. **They were not deleted.**

Source and sandbox are therefore intentionally divergent by exactly three indexes. Any future
reconciliation reporting "3 unexpected live / 0 missing" is reporting this decision, not drift.

**The Sales Order fix requires no index deployment.** `salesOrder.index` still declares exactly one
demand — `state ASC, salesOrderNumber DESC` — already live and `READY`. The fix makes the query
match the index that already existed rather than requiring a new one.

## Environment state — unchanged

| | |
|---|---|
| Hosting `/version.json` | **`cd442727`** — unchanged |
| Functions | **84 ACTIVE**, deployed at the superseded SHA; `listSalesOrderIndex` unhealthy |
| Indexes | 38 live, all `READY` |
| Rules | untouched |
| Activation overrides | **27**, `salesOrder.read` present |
| Fixtures / seeds | untouched |

Note the asymmetry Tranche 2R exists to close: the sandbox runs Functions built from `b891fc68`,
which contains the defect. The repository is ahead of the environment by exactly the two
corrections.

---

# Tranche 2R — targeted Functions repair (PREPARED, NOT AUTHORIZED)

Narrowest viable scope. **No Hosting. No Rules. No indexes. No seeds or fixtures. No activation
changes.**

## Target

    firebase deploy --only functions:listSalesOrderIndex --project eos-platform-sandbox --non-interactive

`--project` is mandatory and not optional convenience: **`.firebaserc` declares
`"default": "taylor-parts"` — production.** An unscoped `firebase deploy` in this repository targets
production. Every command must carry the flag, and the deploy log's `Deploying to` line must be read
back before the result is accepted.

Deploying only the single defective callable is deliberate. `getAccountPortfolioSummary` is already
healthy at the superseded SHA and the other 82 functions are unchanged by both corrections, so a
narrower target is both lower-risk and a clearer attribution if anything moves.

**Pre-deploy gate:** re-read `/version.json` and confirm Hosting still reports `cd442727`. If it
moved, someone else deployed and this plan's assumptions are void.

## Post-deploy verification — required

| # | Check | Expected |
|---|---|---|
| 1 | `listSalesOrderIndex` unfiltered | 200, bounded page |
| 2 | filtered `state: CONFIRMED` | 200 |
| 3 | filtered `state: CLOSED` | 200 (may be empty — empty is a **result**, not a failure) |
| 4 | Pagination + ordering | cursor advances and terminates; `salesOrderNumber` strictly descending |
| 5 | Empty result | honest ready+empty, never an error |
| 6 | Over-limit `limit: 9999` | **400 invalid-argument** |
| 7 | Unauthenticated | **401** |
| 8 | Technician persona | **403** |
| 9 | Authorized admin | **200** |
| 10 | `getAccountPortfolioSummary` | 200 — unchanged |
| 11 | `listSalesOrdersForAccount` | 200 — account-scoped read still separate and correct |
| 12 | `listOpportunityContext` | 200 |
| 13 | Core inventory smoke | Parts Catalog, part-side on-hand, receiving/transfer/cycle-count authorization reachability |
| 14 | Governed-ledger allocation smoke | sellable stock derives from the governed ledger, **not** `stock_locations` |
| 15 | Server-side diagnostics | a forced failure logs actionable context; the client message stays byte-identical and leaks nothing |

Checks 1–9 are the regression itself. **Check 15 is the one that was impossible before** — the
masked catch is why a live 500 had no trace in Cloud Logging, and confirming the logging works is
what makes the next failure diagnosable.

## What would constitute failure

Any of 1–9 not matching, any of 10–12 regressing, any inventory or ledger regression, or client
leakage in 15. Rollback target is the currently-deployed revision of `listSalesOrderIndex` alone —
the other 83 functions are untouched by this tranche.

## Emulator caveat — restated because it caused this

The emulator **does not enforce composite-index requirements**. The index suite passed against the
emulator *before* the fix, including a filtered call. Emulator-green proves the query shape is
correct at the API level; it proves nothing about production index availability. Checks 1–4 are the
only evidence that closes that gap.

---

# Tranche 2R — targeted Functions repair

**Result: PASS on all 15 criteria. The 500 is closed.** One material finding blocks Tranche 3 —
see the end of this section.

## Deployment

| | |
|---|---|
| Promotion SHA | `b237f652da490ac8880393c15bc6e17bdd6f9324` (pinned, clean tree) |
| Pre-deploy gate | `/version.json` re-read → `cd442727`, unchanged |
| Deploy start | `2026-08-18T22:53:30Z` |
| Deploy complete | `2026-08-18T22:54:46Z` (exit 0) |
| Rollback baseline | revision `listsalesorderindex-00001-din` |

    firebase deploy --only functions:listSalesOrderIndex --project eos-platform-sandbox --non-interactive

Log confirms `Deploying to 'eos-platform-sandbox'` and exactly one operation:
`functions[listSalesOrderIndex(us-central1)] Successful update operation`. **No Hosting, Rules,
index, seed or activation lines.**

## Verification matrix

| # | Check | Result |
|---|---|---|
| 1 | unfiltered | **PASS** — 200, bounded |
| 2 | `state: CONFIRMED` | **PASS** — 200 |
| 3 | `state: CLOSED` | **PASS** — 200 |
| 4 | pagination + descending order | **PASS** — single page, cursor terminated |
| 5 | empty result honesty | **PASS** — 200, `status: ready`, not an error |
| 6 | over-limit `9999` | **PASS** — **400 INVALID_ARGUMENT** |
| 7 | unauthenticated | **PASS** — 401 |
| 8 | technician | **PASS** — 403 |
| 9 | authorized admin | **PASS** — 200 |
| 10 | `getAccountPortfolioSummary` | **PASS** — 200 |
| 11 | `listSalesOrdersForAccount` | **PASS** — 200 |
| 12 | `listOpportunityContext` | **PASS** — 200 |
| 13 | core inventory reachability | **PASS** — see caveat |
| 14 | governed-ledger allocation reachability | **PASS** — see caveat |
| 15 | no client leakage | **PASS** — 5 error shapes probed, 0 leaked |

**13 / 14 caveat, stated precisely.** `receiveInventoryStock`, `createTransferOrder` and
`createCycleCount` each returned **401 unauthenticated** and, for an authenticated persona,
**400 invalid-argument**. A 400 proves the callable is reachable and validates input — it does
**not** prove the authorization outcome, because argument validation runs before the capability
check. Only `allocateSalesOrder` demonstrates the boundary directly: technician **403**, admin
**400**. No write was performed by any probe.

**15 caveat.** Leakage was tested against every error shape reachable from outside — over-limit,
bad state, bad cursor, unauthorized, unauthenticated — and none carried a stack, an internal
path, a Firestore status or a project id. Forcing a genuine *internal* failure from outside is not
possible without mutating state or code, so the logging path itself is proven by the emulator
suite rather than live.

## The finding that blocks Tranche 3

Every check above passed **against an empty result set**, and that is not because the sandbox has
no sales orders.

| Read | Rows |
|---|---|
| `listSalesOrdersForAccount` (account `acct-harbor`) | **14** |
| `listSalesOrderIndex` (unscoped, ordered) | **0** |

All 14 carry `salesOrderNumber: null`. The INDEX read orders by `salesOrderNumber`, and Firestore
**excludes any document missing the ordered field** — so **100% of live sales orders are invisible
to the INDEX read.**

This is the gap `salesOrder.js` already documented, now quantified live: not a sampling artifact,
but every row.

The callable is behaving correctly and honestly. The problem is what a *surface* built on it would
say. Shipping the metadata Sales Order INDEX in Tranche 3 would render **"no sales orders"** to
every viewer while 14 exist — a list presenting an empty set as the whole truth, which is exactly
the class of falsehood this program has spent the entire wave removing.

It also means checks 1–4 verified that the query *executes*, not that it *orders, paginates or
truncates correctly with data*. Those properties remain proven only by the emulator suite.

**This is a data-state problem, not a code defect, and its remedy is already a recorded protected
item** (`X-SALES-ORDER-NUMBER-BACKFILL`): allocating `SO-` numbers to legacy rows is a governed
write requiring separate authorization. The inert backfill tooling exists and has not been run.

## Stage

Functions: **DEPLOYED** at the promotion SHA — `listSalesOrderIndex` healthy.
Hosting: **untouched**, still `cd442727`.
Indexes: 38 live, unchanged. Rules: untouched. Activation overrides: 27, unchanged.
No live index deleted. No seed executed. No rollback required or performed.
