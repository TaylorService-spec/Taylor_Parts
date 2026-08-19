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

---

# X-SALES-ORDER-NUMBER-BACKFILL — sandbox execution package (PREPARED, NOT EXECUTED)

**Prepared 2026-08-18. Read-only. No sandbox data or configuration was mutated. Nothing deployed.**
Tranche 3 remains blocked.

## 1. Authority and tooling

| | |
|---|---|
| Ledger entry | `X-SALES-ORDER-NUMBER-BACKFILL` — BLOCKED_PROTECTED |
| Runbook | `docs/operations/sales-order-number-backfill-runbook.md` |
| CLI | `functions/scripts/salesOrderNumberBackfillCli.js` |
| Core | `functions/src/salesOrder/salesOrderNumberBackfill.ts` |
| Evidence | `functions/src/salesOrder/salesOrderNumberBackfillEvidence.ts` |

**Inertness verified from code.** The CLI acts only under `require.main === module`, and
`firebase-admin` is required lazily inside the production-deps closure — importing the file
performs no Firestore I/O.

**Dry-run performs zero Firestore writes — verified before invoking.** `runDryRun` calls only
`readAllSalesOrders` and `readAllCounters`, then writes local evidence files. The only `txn.set` /
`txn.update` calls live inside `runExecuteTxn`, reachable solely through `runExecute`, which
requires `--execute`.

### Guard chain (as built)

`--project` and `--confirm-project` must match exactly · `--execute` additionally requires
`--acknowledge-production-write`, `--plan`, and `--plan-sha256` matching the exact bytes of a prior
dry-run plan · execute re-reads counters and every record inside **one** transaction, aborting on
counter drift, missing records, or a changed pre-state fingerprint · any collision or blocked entry
in the plan means **zero writes**.

### Defect: no environment allowlist — Owner decision required

The tool has **no explicit sandbox allowlist and no explicit production rejection.** It will accept
`--project taylor-parts` provided `--confirm-project taylor-parts` matches and the execute flags are
supplied. That is coherent with its original purpose — it was built as the *production* backfill
tool, hence `--acknowledge-production-write` — but it does **not** satisfy this task's stated
safety contract:

- *"fails closed unless the project is exactly `eos-platform-sandbox`"* — **not implemented**
- *"`taylor-parts` must be rejected explicitly"* — **not implemented**

**Not repaired here.** Modifying the tooling during preparation would both violate the instruction
and produce a new promotion identity. Correction plan, for a separate reviewed PR:

1. Add an explicit target allowlist resolved from `config/environments.json` by `role`, refusing any
   project whose role is not `sandbox` unless a distinct production-authorization flag naming that
   exact project id is supplied — the pattern `backfillOperationalNumbering.mjs` already uses.
2. Refuse **before** any Firestore connection, as that sibling does.
3. Add a test asserting `taylor-parts` is rejected with no network call.

Until that lands, **project targeting is enforced by the operator's command, not by the tool.** The
commands below are written accordingly and must not be varied.

## 2. Sandbox inventory (read-only)

Two independent sources agree.

| Source | Result |
|---|---|
| CLI dry run — full `sales_orders` collection scan | **14 documents** |
| `listSalesOrdersForAccount` (`acct-harbor`) | **14** |
| `listSalesOrderIndex` (ordered, unscoped) | **0** |

| Condition | Count |
|---|---|
| Total Sales Orders | **14** |
| Valid `salesOrderNumber` | **0** |
| Field present but null | **0** |
| **Field absent entirely** | **14** |
| Duplicate existing numbers | 0 |
| Invalidly formatted numbers | 0 |

**The affected population is exactly 14.** No discrepancy.

**A correction to the brief's premise, established by direct REST reads.** The task states the 14
documents have `salesOrderNumber: null`. They do not — **the field is absent.** Sampled documents
carry 15–16 fields with no `salesOrderNumber` key at all; the `null` seen through
`listSalesOrdersForAccount` is a **projection artifact** of that read, not stored state.

This is not pedantry: it decides the rollback contract. Restoring `null` would leave the documents
in a state they have never been in. Correct rollback is **field deletion**.

It also confirms the mechanism behind the empty index read — Firestore `orderBy` excludes documents
missing the ordered field, and here the field is missing rather than null.

Counter state: **no `sales_orders_2026` counter document exists** (`sequenceBefore: 0`), consistent
with no Sales Order ever having been numbered in this project.

## 3. Proposed assignment manifest

Produced by the dry run. **Plan hash `e7a7058182abaaba1e72d8cfdea9b8be50cb02c6e0aa90698f73495273107ea3`.**

Counts: total 14 · alreadyNumbered 0 · toAssign 14 · collisions 0 · blocked 0.
Counter snapshot: year 2026, `sequenceBefore: 0`. Year policy: `CREATED_AT` for **all 14** — every
record carries a genuine `createdAt` Timestamp, so no record falls to the `SO-0000-######` sentinel.

| # | Document ID | Current | Proposed | Basis | Collision | Action |
|---|---|---|---|---|---|---|
| 1 | `GJEuh1ImKCe7G2kvNtCy` | *(absent)* | `SO-2026-000001` | CREATED_AT, seq 1 | none | ASSIGN |
| 2 | `INqO9CaHMdQMp2g030yf` | *(absent)* | `SO-2026-000002` | CREATED_AT, seq 2 | none | ASSIGN |
| 3 | `OAWJJ7fE3fKrrbub01aD` | *(absent)* | `SO-2026-000003` | CREATED_AT, seq 3 | none | ASSIGN |
| 4 | `cIk3hlPDTXH5IB3VHdLy` | *(absent)* | `SO-2026-000004` | CREATED_AT, seq 4 | none | ASSIGN |
| 5 | `NNC1iU4DPoxJ26c35E2T` | *(absent)* | `SO-2026-000005` | CREATED_AT, seq 5 | none | ASSIGN |
| 6 | `V4otE0s7EAp7ABCZEjam` | *(absent)* | `SO-2026-000006` | CREATED_AT, seq 6 | none | ASSIGN |
| 7 | `qrlfHGG8x8nGMTmot9pZ` | *(absent)* | `SO-2026-000007` | CREATED_AT, seq 7 | none | ASSIGN |
| 8 | `up3SPzmTtIZ98kCkqInI` | *(absent)* | `SO-2026-000008` | CREATED_AT, seq 8 | none | ASSIGN |
| 9 | `eUZ7CCDAiL5BdPtgrwa4` | *(absent)* | `SO-2026-000009` | CREATED_AT, seq 9 | none | ASSIGN |
| 10 | `EG6Mir8wXt33IUJcASMr` | *(absent)* | `SO-2026-000010` | CREATED_AT, seq 10 | none | ASSIGN |
| 11 | `8ax2cA1DyCx8CC2hxTky` | *(absent)* | `SO-2026-000011` | CREATED_AT, seq 11 | none | ASSIGN |
| 12 | `tCXSzCiNmn6N4kqlTfVo` | *(absent)* | `SO-2026-000012` | CREATED_AT, seq 12 | none | ASSIGN |
| 13 | `yBimvZe72foVbX8gwrb9` | *(absent)* | `SO-2026-000013` | CREATED_AT, seq 13 | none | ASSIGN |
| 14 | `woLlxBdWk81BW6bg8zkY` | *(absent)* | `SO-2026-000014` | CREATED_AT, seq 14 | none | ASSIGN |

All 14 proposed values are unique. No existing number is reused or overwritten — there are none.

### Numbering contract — evidence, not invention

`SO-YYYY-######` is the established Sales Order family, already implemented by the live allocator
and matching `WO-`/`OPP-`/`INV-`/`TO-`/`RO-`/`RR-`. Ordering is the tool's documented deterministic
key: **(year, `createdAt` millis, document id)**, with document id as the final tiebreak so ordering
is never arbitrary between runs. Where `createdAt` is a genuine Timestamp its UTC year is
authoritative; where it is not, the tool assigns the sentinel year `0` rather than inventing a
chronology. **No such record exists here**, so the sentinel path is not exercised.

## 4. Safety evidence

**Determinism — proven, not asserted.** Two independent dry runs produced **byte-identical plan
hashes** (`e7a70581…`) and identical assignments. `generatedAt` differs between runs and is
excluded from the hash, which is what makes the hash a usable execution binding.

**Idempotency.** `classifyRecord` routes any record with a non-blank `salesOrderNumber` to
`ALREADY_NUMBERED`, which is skipped and **never renumbered**. After a successful execute, a fresh
dry run classifies all 14 as already-numbered and plans zero assignments. An unchanged unnumbered
record yields the same proposed number on every run, by the deterministic key above.

**Collision prevention.** Existing numbers are reserved at planning; a candidate duplicating one
becomes a `CollisionEntry`, and every later record in that year becomes `YEAR_BLOCKED_BY_EARLIER_COLLISION`.
`executeBackfill` refuses outright if the plan carries **any** collision or blocked entry —
**zero writes**, not partial application.

**Concurrency.** Execute re-reads inside one transaction and fails closed on: counter drift for any
touched year, any planned record that cannot be re-read, or any record whose pre-state fingerprint
changed. A Sales Order created through the normal path between plan and execute advances the 2026
counter and **aborts the run** rather than silently reordering sequences.

**Partial failure.** There is none by construction — the whole batch commits in a single Firestore
transaction, all-or-nothing. Evidence is published atomically only after a passing post-write
verification, so a failed run leaves **no** report directory.

**Scope.** Only `salesOrderNumber` is written on each document, plus the `counters/sales_orders_2026`
sequence. The document id is never rewritten and no relationship field is read or touched.

**Batch limit.** 14 records is far inside Firestore's 500-write transaction bound. The tool does not
chunk, which is irrelevant at this size.

## 5. Snapshot and rollback design (design only — nothing written)

The tool **has no rollback mode**, and the runbook has no rollback section. This is the one genuine
gap in an otherwise complete package. The plan's `fingerprint` is a hash — it can *prove* pre-state
was unchanged but cannot *restore* it.

For this population that is recoverable, because the pre-state is uniform and now established:
**the field is absent on all 14.**

**Pre-execution snapshot format** (capture before execute; one row per target):

    { salesOrderId, fieldPresent: false, originalValue: null, updateTime: "<Firestore updateTime>" }

`updateTime` is the precondition token — Firestore supports a document-level update precondition,
so a rollback can refuse any document modified after the backfill.

**Execution evidence** is already produced by the tool: attempted, assigned, skipped, and the exact
value per document, published atomically.

**Rollback procedure:**

1. For each row, re-read the document and compare `updateTime` against the post-backfill evidence.
2. If it differs, **refuse that document** — a legitimate later change exists and must not be lost.
3. Otherwise **delete the `salesOrderNumber` field** (`FieldValue.delete()`) — not set it to null.
4. Reset `counters/sales_orders_2026` to its captured `sequenceBefore` of **0** — but only if no
   Sales Order has been numbered by the normal creation path since; otherwise leave the counter
   advanced and record why, because rewinding a live counter would risk reissuing numbers.
5. Emit a rollback audit record of its own.

**Restoration semantics by category:** all 14 fall in one category — *field previously absent* →
rollback **deletes the field**. No document requires restoring a prior value, and **none should be
set to null**, since null was never the stored state.

## 6. Commands

**Dry run — already executed twice, read-only, zero Firestore writes:**

    node scripts/salesOrderNumberBackfillCli.js \
      --project eos-platform-sandbox \
      --confirm-project eos-platform-sandbox \
      --commit b237f652da490ac8880393c15bc6e17bdd6f9324 \
      --evidence-dir <fresh-dir> \
      --operator <operator-id>

Run from `functions/`.

**Execution — NOT RUN, requires separate authorization:**

    node scripts/salesOrderNumberBackfillCli.js \
      --project eos-platform-sandbox \
      --confirm-project eos-platform-sandbox \
      --commit b237f652da490ac8880393c15bc6e17bdd6f9324 \
      --evidence-dir <fresh-dir> \
      --operator <operator-id> \
      --execute \
      --acknowledge-production-write \
      --plan <path-to-reviewed-plan.json> \
      --plan-sha256 e7a7058182abaaba1e72d8cfdea9b8be50cb02c6e0aa90698f73495273107ea3

Both commands name the project explicitly and twice. No shell variable, no `.firebaserc` default —
which matters more than usual here, because `.firebaserc` declares `"default": "taylor-parts"`
(production) and, per §1, **the tool does not reject production on its own.**

`--acknowledge-production-write` is the tool's generic mutation acknowledgement; its name reflects
the tool's original production purpose and does **not** mean this run targets production.

**Expected writes:** exactly **15 document writes** in one transaction — 14 `salesOrders`
documents each receiving one new `salesOrderNumber` field, plus `counters/sales_orders_2026`
created with `sequence: 14`. No other field, document, or collection is touched.

## 7. Post-execution verification matrix

| # | Check | Expected |
|---|---|---|
| 1 | All 14 have valid non-null `salesOrderNumber` | `SO-2026-000001`…`000014` |
| 2 | No duplicates | 14 unique |
| 3 | No non-target field changed | only `salesOrderNumber` + the counter |
| 4 | `listSalesOrderIndex` unfiltered | **14 rows — not 0** |
| 5 | `CONFIRMED` filter | correct subset |
| 6 | `CLOSED` filter | correct subset |
| 7 | Descending order **with real data** | strictly descending by number |
| 8 | Pagination | no omissions, no duplicates across pages |
| 9 | Cursor transitions | stable, terminating |
| 10 | Empty-result filter | still honest |
| 11 | Over-limit | **400** |
| 12 | Unauthenticated | **401** |
| 13 | Technician | **403** |
| 14 | Authorized admin | **200** |
| 15 | `listSalesOrdersForAccount` | still 14, consistent |
| 16 | `getAccountPortfolioSummary` | correct |
| 17 | Core inventory smoke | passes |
| 18 | Governed-ledger allocation smoke | passes |
| 19 | Audit evidence | accounts for all 14 attempted |
| 20 | `/version.json` | still `cd442727` — Hosting not part of this |

Checks 7–9 are the ones that **cannot be satisfied today**: with zero visible rows, ordering and
pagination are currently proven only by the emulator suite. They become real evidence only after
this backfill.

**Tranche 3 stays blocked** until check 4 returns the complete population and 7–9 are verified
against real sandbox rows.

## 8. Confirmation

No sandbox data or configuration was mutated. No deploy, seed, rollback, or snapshot write was
performed. The three live orphan indexes were not deleted. Production was not touched. Tranche 3 is
not authorized. Two dry runs and read-only REST/callable reads are the entirety of the sandbox
interaction.

---

# X-SALES-ORDER-NUMBER-BACKFILL — §9 addendum: environment guard applied, package re-issued

Recorded 2026-08-18. **Still not executed.** Two corrections merged through the normal reviewed
workflow; the plan was regenerated twice; nothing was written to the sandbox.

## 9.1 What changed and why

**#1277 — fail-closed environment guard.** Command-enforced targeting was insufficient while
`.firebaserc` declares `"default": "taylor-parts"` (production) and the tool *accepted*
`--project taylor-parts`. `--environment` is now required, the only accepted value is `sandbox`,
and under it the only accepted `--project` is the single sandbox id **resolved from
`config/environments.json`** — not hardcoded, so the two cannot drift. `--project`/`--confirm-project`
remain mandatory and identical; the new check narrows further, it does not replace them.

The guard lives inside `parseArgs`, which every caller runs **before** `buildProductionDeps()` — the
only place `firebase-admin` is required. The tests assert `getApps().length === 0` after each
rejected run, so a regression that moved the guard past initialization fails the suite rather than
passing quietly. Five refusals verified independently, capturing node's real exit status:
`taylor-parts`, missing `--environment`, `--environment production`, the near-miss
`eos-platform-sandbox-2`, and a `--confirm-project` mismatch — **all exit 2**, and the evidence
directory named on those runs **was never created**.

**#1278 — the dry-run report named the wrong hash.** Found while regenerating the plan. The report
printed the *operative* hash under the label "bind this to `--plan-sha256`", while `runExecute` binds
`sha256(plan.json bytes)`. An operator following the artifact exactly would have hit
`plan hash mismatch: refusing to execute (no writes)` — fail-closed, nothing at risk, but a false
instruction on the artifact execution reads from. The report now prints **both**, each labelled;
`plan.json` is serialized once and those exact bytes hashed, so report, `checksums.sha256` and file
cannot disagree. The regression test drives `runExecute` to a completed transaction with the printed
value, and was proven to fail (exit 1) against the old label.

**Unchanged by both:** `--plan`/`--plan-sha256` pinning, `--execute` requiring
`--acknowledge-production-write`, and every transaction-time counter-drift, record-fingerprint and
collision check. `salesOrderNumberBackfill.ts` was not edited.

## 9.2 Promotion identity

| | |
|---|---|
| **Package commit** | **`6810aa83d81c61787f50f9be4c03cca4bad42c5b`** (tip of `main`) |
| Previous package commit | `b237f652da490ac8880393c15bc6e17bdd6f9324` |

The diff between them is documentation, `functions/scripts/salesOrderNumberBackfillCli.js` and its
test. The deployed Functions entrypoint is `lib/index.js`, compiled from `src/`; the operator CLI
under `scripts/` is not imported by it. **Deployed runtime behaviour is therefore identical to the
Tranche 2R deployment** — no redeploy is implied or requested by this addendum. The commit of record
still advances, and `--commit` must carry the new value.

## 9.3 Two regenerations — result

Both runs at `6810aa83`, read-only, exit 0.

| | run 1 | run 2 |
|---|---|---|
| Operative plan hash | `01b4c39f…5297` | `01b4c39f…5297` — **identical** |
| `plan.json` byte hash | `abec4e11…1c74` | `e33157cd…1d6f` |
| Only differing JSON field | — | `generatedAt` |
| Assignments | 14 | 14 — identical |

**Assignments and the operative hash match each other.** The byte hashes differ *by design*: the
plan file embeds `generatedAt`, so two runs seconds apart produce different bytes carrying identical
content. That is exactly why the two hashes exist, and why §9.1's label correction mattered.

**Difference from `e7a705…`, explained:** `e7a705…` was the operative hash at commit `b237f652`.
The operative hash covers `projectId + governedCommit + assignments + collisions + blocked +
counterSnapshot` — **`governedCommit` is inside it**. The commit advanced, so the hash had to change.
Verified directly: the assignments, collisions, blocked list, counter snapshot and counts of the new
plan are **byte-identical** to the `e7a705…` plan. The change is the commit pin and nothing else.

Plan, unchanged across all four runs: 14 records, 14 to assign, **0 collisions, 0 blocked**,
`SO-2026-000001` … `SO-2026-000014`, counter `sales_orders_2026` `sequenceBefore: 0`.

## 9.4 Pre-execution snapshot — captured, read-only

`sha256 440806d709ed398b434cdbb37521ebb8c7981215aed4e80262507db09dee6639`, 14 rows, held outside the
tool's evidence directory so that directory's published checksums stay exact.

Every row: `fieldPresent: false`, `originalValue: null`, plus the document's Firestore `updateTime`
— the rollback precondition token. **This re-confirms at capture time what §2 established: the field
is absent on all 14, not null.**

## 9.5 Rollback — preserved exactly, as accepted

No coded rollback mode. Accepted because execution is one all-or-nothing transaction, the original
fields are absent, and rollback deletes those fields while conservatively leaving the counter
advanced. §5's design stands unchanged; these are its literal commands and preconditions.

**Preconditions — all must hold before any rollback write:**

1. The execution evidence directory exists and records exactly the 14 assignments above.
2. For each document, current `updateTime` equals the value recorded **after** the backfill. Any
   document whose `updateTime` has moved since carries a legitimate later change and **must be
   skipped**, not overwritten.
3. Every value to be removed is byte-equal to the `SO-2026-0000NN` this plan assigned. A different
   value means someone else numbered it — **skip**.
4. `counters/sales_orders_2026` is inspected but, per the accepted design, **left advanced** unless
   it is proven that no Sales Order has been numbered by the normal creation path since. Rewinding a
   live counter risks reissuing numbers.

**Rollback command** — save as `functions/rollback.local.mjs` and run from `functions/`, targeting
the sandbox explicitly as at execute:

    import admin from "firebase-admin";
    import { readFileSync } from "node:fs";
    admin.initializeApp({ projectId: "eos-platform-sandbox" });
    const db = admin.firestore();
    const rows = JSON.parse(readFileSync("<post-execution-evidence>/execution.json", "utf8")).assigned;
    let removed = 0, skipped = 0;
    for (const r of rows) {
      const ref = db.collection("sales_orders").doc(r.salesOrderId);
      const snap = await ref.get();
      if (snap.get("salesOrderNumber") !== r.salesOrderNumber) { skipped++; continue; }  // precondition 3
      await ref.update(                                                                   // precondition 2
        { salesOrderNumber: admin.firestore.FieldValue.delete() },
        { lastUpdateTime: snap.updateTime }
      );
      removed++;
    }
    console.log(JSON.stringify({ removed, skipped, counter: "left advanced (deliberate)" }));

    node rollback.local.mjs

`FieldValue.delete()` — **not** `null`. Null was never the stored state, and writing it would leave
the documents in a condition they have never been in. The `lastUpdateTime` precondition makes the
write fail rather than clobber if the document moved between read and write.

**Verify rollback:** re-read all 14 and confirm `salesOrderNumber` is absent (not null) on every
document the run reports as `removed`, and present-and-unchanged on every `skipped` one.

## 9.6 Commands — re-issued at `6810aa83`

Both name the project explicitly and twice, and now carry `--environment sandbox`. Run from
`functions/`.

**Dry run — executed twice above, read-only, zero Firestore writes:**

    node scripts/salesOrderNumberBackfillCli.js \
      --project eos-platform-sandbox \
      --confirm-project eos-platform-sandbox \
      --environment sandbox \
      --commit 6810aa83d81c61787f50f9be4c03cca4bad42c5b \
      --evidence-dir <fresh-dir> \
      --operator <operator-id>

**Execution — NOT RUN, requires separate authorization:**

    node scripts/salesOrderNumberBackfillCli.js \
      --project eos-platform-sandbox \
      --confirm-project eos-platform-sandbox \
      --environment sandbox \
      --commit 6810aa83d81c61787f50f9be4c03cca4bad42c5b \
      --evidence-dir <fresh-dir> \
      --operator <operator-id> \
      --execute \
      --acknowledge-production-write \
      --plan <reviewed-plan.json> \
      --plan-sha256 <that file's byte hash, from its own plan-report.md / checksums.sha256>

`--plan-sha256` binds the **byte hash of the specific plan file passed to `--plan`** — for run 1's
artifact that is `abec4e1101c2d7faa41ccbe81024f2b9d0f67ce3e2b10300d013f495480a1c74`. It is
deliberately **not** the operative hash `01b4c39f…`, which is the reproducibility value. Pairing a
plan file with another run's byte hash fails closed with zero writes.

`--acknowledge-production-write` is the tool's generic mutation acknowledgement; its name reflects the
tool's original purpose and does **not** mean this run targets production. The guard now makes that
structurally impossible.

**Expected writes:** exactly **15 document writes in one transaction** — 14 `sales_orders` documents
each gaining one `salesOrderNumber` field, plus `counters/sales_orders_2026` created with
`sequence: 14`. No other field, document or collection is touched. §7's 20-check post-execution
matrix is unchanged and still governs acceptance.

## 9.7 Confirmation

No sandbox data or configuration was mutated. Two dry runs, one read-only snapshot read, and
read-only REST/callable reads are the entirety of the sandbox interaction. No deploy, no seed, no
rollback, no activation change. The three live orphan indexes were not deleted. Production was not
touched.

`X-SALES-ORDER-NUMBER-BACKFILL: AUTHORIZATION REQUESTED — environment guard applied.`
**Tranche 3 remains blocked.**

---

# X-SALES-ORDER-NUMBER-BACKFILL — §10: EXECUTED

**Authorized, executed, and verified 2026-08-19. 20 of 20 acceptance checks PASS.** No deploy. No
Hosting change. Tranche 3 not entered.

## 10.1 Execution

| | |
|---|---|
| Tooling SHA | `6810aa83d81c61787f50f9be4c03cca4bad42c5b` — working copy detached at it, tree clean |
| Project | `eos-platform-sandbox` |
| Bound plan | run 1 `plan.json`, byte hash `abec4e11…1c74` — matched the authorized value before the run |
| Command | §9.6 execute form, verbatim |
| Result | `{ "ok": true, "mode": "execute" }` — **14 assigned, 0 skipped** |
| Executed at | `2026-08-19T00:08:31.499Z` |

Evidence published atomically: `execution-result.json`
(`4389ce4a96712c2c03266e1b380656aa634c44d8a13a146caa7dfa38dbd82beb`), `execution-report.md`
(`26d098e94fdff802ddc5578bd43adcd5a16e49318f2a76ad6882811ea1884d5a`), `checksums.sha256`. The
report records the bound plan hash, which is the value the authorization named.

## 10.2 Pre-mutation revalidation — 9 checks, all PASS

Run read-only against live sandbox immediately before execute:

| Check | Result |
|---|---|
| Population size | 14 live, 14 planned |
| Every planned document exists | missing 0 |
| `salesOrderNumber` absent on all 14 | present 0 |
| Pre-state fingerprints match the plan | mismatch 0 |
| `updateTime` unchanged since the snapshot | moved 0 |
| Assigned numbers unique | 14 |
| Collision / blocked state | 0 / 0 |
| Counter snapshot matches live | live absent (0) = planned `sequenceBefore` 0 |
| No live document already holds a planned number | holders 0 |

The environment guard was re-probed at the authorized SHA in the same session: `taylor-parts` and a
missing `--environment` both **exit 2**, and the evidence directory named on those runs was not
created.

These are in addition to — not instead of — the tool's own in-transaction re-checks, which recompute
every fingerprint and the counter inside the transaction and abort the whole write on any drift.

## 10.3 Data verification — 10 checks

| Check | Result |
|---|---|
| Population unchanged | 14 |
| All 14 carry a non-null `salesOrderNumber` | 14 |
| Values equal the authorized plan exactly | `SO-2026-000001` … `SO-2026-000014` |
| No duplicates | 14 unique |
| Format | all match `SO-2026-\d{6}` |
| `createdAt` untouched | 14/14 — the pre-state fingerprint still reproduces from live `createdAt` |
| Exactly one write per document since the snapshot | moved 14, unmoved 0 |
| **One atomic transaction** | **all 14 share a single `updateTime`** — `2026-08-19T00:08:31.499Z` |
| Counter | `counters/sales_orders_2026` created, `sequence: 14` |
| Field shapes | see below |

**15 writes, exactly as planned** — 14 documents plus one counter, and the single shared `updateTime`
across all 14 is the direct evidence that they landed in one transaction rather than a sequence.

`createdAt` deserves its own note: the plan's fingerprint covers `salesOrderNumber + createdAt`, so
recomputing it from live data with `salesOrderNumber` treated as absent reproduces the recorded
pre-state hash only if `createdAt` is byte-unchanged. It reproduced on all 14.

**Field-shape check, stated honestly.** My first pass flagged 4 distinct field shapes (16/17/18
fields) as a possible non-target change. It is not: the variation is the optional `currency` and
`serviceWorkOrderIds` fields, distributed across the population exactly as before. The check that
matters passed — `salesOrderNumber` is now in the set of keys **common to all 14**, and nothing else
entered that set. Firestore keeps no document history, so "no non-target field changed" is
established by the transaction's own write set (only `salesOrderNumber` plus the counter), the
single-`updateTime` evidence, and the `createdAt` fingerprint reproduction — not by a full pre-image
diff, which was never captured.

## 10.4 Live acceptance matrix — 20 / 20 PASS

| # | Check | Result |
|---|---|---|
| 1 | Unfiltered completeness | **200, 14 rows — was 0 before** |
| 2 | Strictly descending with real data | `SO-2026-000014` → `000001` |
| 3 | No duplicates in page | 14 unique ids |
| 4 | Pagination covers the population | 3 pages, 14 ids, 0 duplicates |
| 5 | Cursor terminates | final cursor null |
| 6 | Paged order == single-page order | identical sequences |
| 7 | Cursor stability | same cursor twice → identical page |
| 8 | Filter `CONFIRMED` | 200, 8 rows, every row matches |
| 9 | Filter `CLOSED` | 200, 0 rows — empty is a result |
| 10 | Filter `CANCELLED` | 200, 0 rows |
| 11 | Over-limit `9999` | **400 INVALID_ARGUMENT** |
| 12 | Unauthenticated | **401** |
| 13 | Technician | **403** |
| 14 | Authorized admin | **200** |
| 15 | `listSalesOrdersForAccount` consistent | 200, 14 rows |
| 16 | `getAccountPortfolioSummary` | 200 |
| 17 | `listOpportunityContext` | 200 |
| 18 | Governed allocation boundary | `allocateSalesOrder` technician **403** |
| 19 | No internal detail leaks | 4 error shapes probed, 0 leaky |
| 20 | Hosting untouched | `/version.json` still **`cd442727`** |

**Checks 2, 4, 6 and 7 are the ones that could not be satisfied before this backfill.** With zero
visible rows, ordering, pagination and cursor behaviour were proven only by the emulator suite — and
the emulator does not enforce composite-index requirements, which is exactly how the Tranche 2 `500`
reached live. They are now proven against real sandbox data.

Correction worth recording: checks 3 and 4 failed on my first pass because my probe read
`salesOrderId` while the callable returns `id`. That was a defect in the probe, not the data;
re-run with the correct field, both pass. The response shape is `id`, not `salesOrderId`.

Inventory reachability was not re-probed. This transaction wrote only `sales_orders` and one counter
document, and Tranche 2R already established inventory and ledger reachability at the same deployed
runtime, which this change does not alter.

## 10.5 Observation, not a blocker

`listSalesOrderIndex` returns `createdAtMillis: null` and `updatedAtMillis: null` on every row, while
the underlying documents carry `createdAt` and `updatedAt` (the fingerprint check above depends on
`createdAt` being present and unchanged). A surface that renders those columns would show blanks for
records that do have timestamps. Out of scope for this authorization; recorded for the Tranche 3
assessment.

## 10.6 Rollback position

Rollback is **not** required — nothing regressed. The tokens for it are captured:
`post-execution-snapshot.json` holds each document's `salesOrderId`, assigned `salesOrderNumber`, and
post-write `updateTime`, which is the `lastUpdateTime` precondition §9.5's procedure requires. Every
row carries the shared `2026-08-19T00:08:31.499Z` stamp, so any later divergence is detectable
per-document.

Per the accepted design, a rollback would delete the field (never write null) and leave
`counters/sales_orders_2026` advanced at 14.

## 10.7 Confirmation

One transaction, 15 writes, inside the authorized boundary. No deploy, no Hosting change, no Rules
change, no seed, no activation change. The three live orphan indexes were not deleted. Production was
not touched. Tranche 3 was not entered.

`X-SALES-ORDER-NUMBER-BACKFILL: EXECUTED AND VERIFIED — 20/20.`
**Tranche 3 (Hosting) requires separate authorization.**

---

# §11 — Timestamp consumer gate (read-only)

**Result: neither `createdAtMillis` nor `updatedAtMillis` is consumed by any Sales Order surface in
the built Hosting artifact.** No callable repair is required before Hosting. One separate finding
about the INDEX surface itself is recorded at §11.5 and does change what Tranche 3 delivers.

Nothing was deployed. The only action taken was a local production build and static inspection of it.

## 11.1 The artifact inspected

Built from `main` at `0884e480` (`npm run build`, exit 0). Output is a **single** JS chunk,
`dist/assets/index-BzYeQU86.js`, plus one CSS file — so "is it in the bundle" is answerable by
inspecting one file, with no lazy chunk able to hide a consumer.

## 11.2 The Sales Order INDEX surface, as built

Recovered verbatim from the bundle:

    id: "salesOrder.index", entityId: "salesOrder", surface: "INDEX",
    readCallable: "listSalesOrderIndex",
    columns: [salesOrderNumber (sortable), accountId, state (sortable), salesChannel, customerPO],
    filters: [state], defaultSort: [salesOrderNumber DESC], pageSize: 50

**Five columns, none a timestamp. One filter, not a timestamp. Sort by `salesOrderNumber`, not a
timestamp.** The related Sales Orders list under an Account is the same story:
`salesOrderNumber, state, salesChannel, customerPO, sourceOpportunityNumber`.

Nothing else in the pipeline could reach the fields implicitly:

- **Rendering.** `listPresentation.js` formats a value through the timestamp formatter only when a
  column declares `type: "TIMESTAMP"` or `"DATE"`. This list declares neither, so no cell reads a
  timestamp.
- **Sorting.** `defaultSort` names `salesOrderNumber`; the two sortable columns are
  `salesOrderNumber` and `state`.
- **Export.** There is **no list export path in the artifact.** The single `text/csv` occurrence is
  the Contact *import* modal's file picker.
- **Saved views.** `salesOrder.index` declares a `RECENTLY_VIEWED` default view, which might be
  expected to sort by recency — but `savedView.kind` has **no runtime consumer anywhere in the
  source**. It is a declaration, not behaviour, so it reads no timestamp either.

## 11.3 Where the fields *are* consumed — and why neither is a Sales Order surface

Five occurrences of each name in the bundle, all accounted for:

| Consumer | Field | Source of the value |
|---|---|---|
| CRM Activity view | `createdAtMillis` | `crmActivityReadService.ts` — `toMillis(data.createdAt)` |
| Saved Reports list | `updatedAtMillis` | computed client-side, `toMillis(rec.updatedAt)` |

Both derive millis from a real stored timestamp, so both are correct and unaffected.

**A dead consumer exists in source and is worth naming, because a grep of `src/` alone would suggest
otherwise.** `src/domain/accountSalesOrdersView.js` maps `so.updatedAtMillis` and
`src/modules/accounts/AccountSalesOrdersSection.jsx` formats it for display — a genuine Sales Order
timestamp consumer. It is **not in the artifact**: `AccountDetail.jsx` replaced those hand-rendered
sections with the metadata list resolver, nothing imports them any more, and `AccountSalesOrders`
appears **zero times** in the built bundle. It would have displayed a blank column had it survived;
it did not survive.

## 11.4 Root cause — field naming and projection, not serialization

Confirmed by reading both sides of the write/read pair:

**Write** (`salesOrderCallables.ts`, `persistCreatedSalesOrder`) explicitly *strips* the millis
fields and stores real server timestamps:

    const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;
    tx.set(ref, { ...fields, salesOrderNumber,
                  createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });

**Read** (`salesOrderReadService.ts`) projects fields with those stripped names:

    createdAtMillis: num(data.createdAtMillis),
    updatedAtMillis: num(data.updatedAtMillis),

`data.createdAtMillis` is `undefined` on every document — nothing writes it — so `num()` yields
`null`. The stored `createdAt`/`updatedAt` Timestamps are never read.

**It is therefore projection logic reading the wrong field names — not Firestore timestamp
serialization.** Serialization is provably fine: the backfill's pre-state fingerprint (which hashes
`createdAt`) reproduced from live data on all 14 documents in §10.3, which requires reading those
Timestamps correctly.

The correct pattern already exists one directory over, in `crmActivityReadService.ts`:
`createdAtMillis: toMillis(data.createdAt)` — read the stored Timestamp, convert at the projection
boundary. The Sales Order read service simply never did this.

This was a **known** gap, not a new discovery: `salesOrder.js`'s list-view comment states that the
write path stores Timestamps while the read projection reads names "nothing writes," and cites that
as the reason it sorts by `salesOrderNumber`. The defect and the surface's avoidance of it were
authored together — which is why no consumer exists to break.

## 11.5 Separate finding — the INDEX surface has no page

`salesOrder.index` appears **twice** in the bundle: its own definition, and the related list's
`viewAllListId` pointer to it. **Nothing renders it.**

The only Sales Order route in `App.jsx` is the detail page
(`opportunities/sales-order/:salesOrderId` → `SalesOrderDetail`). There is no route, nav entry, or
page definition that mounts `salesOrder.index`; the only metadata page definition in the app is the
Account record page.

So the list view, its `listSalesOrderIndex` wiring in `callableListSource.js`, and the now-populated
callable are all present and correct — but **deploying Hosting today would not put a Sales Order
INDEX page in front of any user.** The 14 rows the backfill made visible are visible to the
*callable*, and through the related Sales Orders list under an Account; not through an index page,
because none is mounted.

That does not make Hosting unsafe — it makes its user-visible effect smaller than the promotion
narrative assumed, and it is the honest precondition for authorizing it.

## 11.6 Position

| Gate item | Result |
|---|---|
| Inspect the INDEX surface in the built artifact | Done — §11.2 |
| Does it display / sort / filter / export the fields? | **No — none of the four** |
| Neither consumed → record evidence, return for authorization | This section |
| Either consumed → repair the callable first | **Not triggered** |
| Serialization, naming, or projection? | **Naming + projection** — §11.4 |
| Deploy Hosting or make unrelated changes | Neither |

The timestamp mapping defect is real and should be fixed, but it is **not a user-exposure risk on
this artifact** because no surface reads it. Recorded for the next Sales Order read slice rather than
patched here, since a callable repair now would be an unrelated change to a gate that came back
clean.

`TRANCHE 3 — TIMESTAMP CONSUMER GATE: CLEAR.` No Functions repair required. Hosting authorization
requested, with §11.5 on the record.

---

# Tranche 3 — Hosting: DEPLOYED

**Deployed 2026-08-19. Live `/version.json` = `0884e480`, `environmentId: platform-sandbox`.**
No Functions, Rules, indexes, seeds, backfills, activations, or production actions. No rollback
performed — see §12.5 for the one acceptance item that did not pass and why it is not a deploy
regression.

## 12.1 What was built and shipped

The artifact reviewed under the §11 gate was built with the **default** environment, whose manifest
says `taylor-parts-production` and whose base is the GitHub Pages path. That artifact was correct to
*inspect* — list definitions and columns are environment-independent — but **must never be
deployed**: it would publish a sandbox surface that misreports its own environment, defeating D1/D2.

`scripts/deployHosting.mjs` exists for exactly this failure and was used:

    node scripts/deployHosting.mjs --environment platform-sandbox --dry-run   # verified, no deploy
    node scripts/deployHosting.mjs --environment platform-sandbox             # deployed

It injects `VITE_ENVIRONMENT_ID` from the resolved target, re-reads `dist/version.json` after the
build, and **asserts the artifact's baked identity against the target before any upload**. It
deploys with `--project eos-platform-sandbox` explicitly, and the log confirms
`Deploying to 'eos-platform-sandbox'` with `hosting` as the only component.

    Artifact identity verified: platform-sandbox @ 0884e480

**Built at `0884e480`** — the authorized commit, checked out detached with a clean tree, not from the
later `main`.

## 12.2 The deployed artifact is the reviewed artifact

Every served file hashed against the local build:

| File | Result |
|---|---|
| `index.html` | identical |
| `assets/index-BmuCD58g.js` | **identical** |
| `assets/index-DdvObLuX.css` | identical |
| `version.json` | identical |
| `404.html`, `favicon.svg` | identical |

The §11 gate findings were re-verified **on this bundle**, not only on the inspected one:
`salesOrder.index` still declares 5 columns with no timestamp, the related Sales Orders list declares
`salesOrderNumber, state, salesChannel, customerPO, sourceOpportunityNumber` — **no timestamp
column** — and `AccountSalesOrders` (the dead timestamp-consuming section) appears **zero** times.

## 12.3 Acceptance

| Requirement | Result |
|---|---|
| `/version.json` identifies the artifact | **PASS** — `0884e480`, `platform-sandbox`, base `/` |
| Related Sales Orders shows all expected records | **PASS** — `listSalesOrdersForAccount` 200, **14 of 14** |
| Focused E2E matrix on changed surfaces | **PASS** — 19 checks; see below |
| Governed-ledger boundary | **PASS** — `allocateSalesOrder` technician **403** |
| 27 activation overrides intact | **PASS** — all 27 evaluate live |
| No timestamp columns on the related Sales Orders list | **PASS** — statically proven on the served bundle |
| Core inventory smoke | **FAIL** — pre-existing, §12.5 |
| App boots without error | **PASS** — login screen renders, **zero console errors** |

The 20-check matrix re-run post-deploy: 19 pass. The twentieth asserted *"Hosting still
`cd442727`"* — a pre-deploy invariant that this tranche deliberately changes. It now reads
`0884e480`, which is the intended outcome, not a failure.

Environment state after deploy: **84 Functions** (unchanged), **38 indexes** including the 3
deliberate `equipment_models` orphans (unchanged), Rules untouched, activation overrides unchanged.

**All 27 activation overrides confirmed live** by calling `resolveEffectiveAccessCallable` with the
declared override set: 27 submitted, **27 evaluated**. (13 resolve `allowed` for the admin persona;
the rest are denied by *role* grant, not by activation — the override makes a capability evaluable,
the role still has to grant it.) Hosting cannot alter this set in any case: it is derived inside the
Functions runtime from `GCLOUD_PROJECT`, with no caller seam.

## 12.4 What is NOT proven — stated plainly

Rendering was verified as far as it can be without signing in: the app boots clean, the served bundle
is byte-identical to the reviewed one, and the callables behind the Account page and its related
Sales Orders list return correct data live. **The authenticated UI was not driven**, because doing so
requires entering a persona password into a login form, which I do not do. "The Account page renders
those 14 rows" therefore rests on (a) the reviewed bundle being what is served and (b) its data
source being correct — not on an observed screen. An Owner-driven pass would close that gap.

## 12.5 The one failing acceptance item — pre-existing, not a deploy regression

`getInventoryAnalytics` returns **500 INTERNAL**, deterministically, for both admin and dispatcher
(4 attempts). The authorization boundary is intact — technician gets a clean **403
PERMISSION_DENIED** with the correct message — so the fault is *after* the capability gate, in the
deployed data path.

Three facts make this a separate item rather than a rollback trigger:

1. **Hosting cannot cause it.** Functions were not deployed in this tranche; the callable is byte-
   unchanged from before it.
2. **No UI calls it.** `getInventoryAnalytics` appears exactly **once** in the deployed bundle — inside
   a permission-catalog *description string*, not a call site. It had no client caller at `cd442727`
   either. Nothing a user can click reaches it.
3. **Current repo code does not reproduce it.** Replaying the callable's exact data path locally
   against the same live collections (16 `inventory_transactions`, 5 `stock_locations`) completes
   successfully — normalization and dashboard generation both return. The sandbox runs an **older
   Functions build** for this callable (only `listSalesOrderIndex` was redeployed in Tranche 2R), so
   the evidence points at deployed-vs-repo drift, and a Functions redeploy is the likely remedy.

That remedy is a **Functions deploy — outside this authorization**, so it was not taken. Recorded as
an open item.

Rolling Hosting back would not affect it, and there is no material UI regression: the deploy's
observable effects are the reviewed bundle and a truthful manifest.

## 12.6 Recorded, per the authorization

`salesOrder.index` and its callable infrastructure are **deployed but not mounted**. The list view
definition and its `listSalesOrderIndex` entry in `callableListSource.js` are both present in the
served bundle, and the callable is live and healthy — but **no standalone Sales Order index route
exists**. `salesOrder.index` appears twice in the bundle: its own definition, and the related list's
`viewAllListId` pointer. The only Sales Order route remains the detail page.

Mounting it is a separate future implementation slice and was **not** performed in this tranche.

## 12.7 Confirmation

Hosting only, `--project eos-platform-sandbox`, built at `0884e480`, artifact identity asserted
before upload, served files byte-identical to the reviewed build. No Functions, Rules, indexes,
seeds, backfills, or activation changes. Production untouched. No rollback performed or required.

`TRANCHE 3 — HOSTING: DEPLOYED AND VERIFIED.`
Open items: `getInventoryAnalytics` 500 (Functions redeploy candidate, unconsumed by any UI); the
Sales Order read service's `createdAtMillis`/`updatedAtMillis` projection defect (§11.4); mounting a
standalone Sales Order index route (future slice).

---

# §13 — `getInventoryAnalytics` investigation and narrow deploy plan (PREPARED, NOT AUTHORIZED)

Hosting stays at `0884e480`. Nothing deployed. The repair is merged to `main` and awaits a separate
Functions authorization.

## 13.1 Root cause — the log named it exactly

    Unhandled error Error: Data cannot be encoded in JSON: Infinity
        at encode (firebase-functions/lib/common/providers/https.js:174:11)

The analytics engine models "this part has no usage history, so it never runs out" as
`daysRemaining: Infinity`. Correct **in process** — and the domain already had a wire-safe way to say
it, because `estimatedStockoutDate` is `null` for exactly those entries. `Infinity` has no JSON
representation, so firebase-functions throws **after** the handler returns and the caller receives a
bare 500 naming no field.

In the live sandbox, **4 of 5 parts have no usage history**, so 4 of 5 entries carried `Infinity`.
One is enough to poison the whole response.

The capability gate is unaffected and was never implicated: technician receives a clean **403** with
the correct message, which is why the fault had to be after the gate.

## 13.2 Deployed-vs-current identity — no drift

The tranche opened on a drift hypothesis. There is none.

| | |
|---|---|
| Deployed revision | `getinventoryanalytics-00010-hes`, ACTIVE, nodejs22, updated `2026-08-18T20:52:36Z` |
| Deployed build | `builds/eb216d76-cb2d-44e2-993a-0d2650c6d765` from `getInventoryAnalytics/function-source.zip` |
| `git diff b891fc68 HEAD` over the analytics path | **empty** |
| Commits touching those files since | **none** |

`inventoryAnalyticsCallables.ts`, `inventoryAnalyticsService.ts`, `ledgerNormalizer.ts` and
`effectiveAccessFeed.ts` are byte-identical between the deployed build's commit and current `main`.
**The deployed code is the current code, and the current code has the defect.**

**Correcting my Tranche 3 report.** I recorded this as "not reproducible against live data with
current repo code," and used that to argue deployed-vs-repo drift. That was wrong. I had replayed the
data path locally and checked only that it did not *throw* — it doesn't; it returns fine, and what it
returns cannot be transmitted. `JSON.stringify` does not catch it either: it silently converts
`Infinity` to `null`. Only the real encoder rejects it, and I had not run the real encoder. The drift
hypothesis was mine, and the evidence killed it.

## 13.3 The repair — merged as #1283, `923ed5b1`

A transport defect gets a transport fix, at the boundary:

- The **engine is untouched.** Every in-process consumer, including the client's own mirror engine,
  keeps existing semantics.
- The callable projects `Infinity` to `null` — the same value `estimatedStockoutDate` already uses
  for the same condition, so a consumer reads one consistent "not predicted" signal.
- `NaN` and `-Infinity` are **not** mapped. Only a positive-infinite `daysRemaining` has a defined
  meaning; anything else non-finite is a genuine computation bug, so `assertWireEncodable` throws
  with the offending path (`result.health[0].recommendation.reorderPoint: NaN`) and logs
  server-side, instead of shipping quiet nulls or repeating a fieldless 500.

**Tests use the real encoder,** imported by relative path because the package's `exports` map hides
the subpath — deliberately, so the assertion runs against the thing that actually rejected the
payload rather than a re-implementation that could be wrong in the same way. The suite asserts the
raw payload **is rejected** and the projected one **is accepted**, so it reproduces the defect rather
than passing beside it. 9 tests pass; the existing emulator-backed suite still passes (exit 0);
62 CI checks green.

**Why CI missed it:** the analytics path had **no workflow path-filtering it** — a change to the
callable or the engine ran no test at all, and the one existing test asserts what the numbers *are*,
never that the result can be *transmitted*. #1283 adds `inventory-analytics-tests.yml` covering both
source files and the new suite. It ran and passed on the PR.

## 13.4 Live-data verification, read-only, no mutation

Replayed the repaired path against the live sandbox collections (16 `inventory_transactions`, 5
`stock_locations`) and pushed the result through the real encoder:

    raw payload  -> REJECTED by encoder (reproduces the live 500)
    wire payload -> ACCEPTED by encoder
    PRT-1001: availableStock=-2  daysRemaining=-30   READY            urgency=CRITICAL
    PRT-1003: availableStock=6   daysRemaining=null  NEEDS_PLANNING   urgency=null
    PRT-1004: availableStock=12  daysRemaining=null  NEEDS_PLANNING   urgency=null
    PRT-1005: availableStock=40  daysRemaining=null  NEEDS_PLANNING   urgency=null
    PRT-1006: availableStock=3   daysRemaining=null  NEEDS_PLANNING   urgency=null

The one part with usage history keeps its finite value; the four without return `null`. No write of
any kind was performed.

**Unrelated observation, deliberately not fixed here:** `PRT-1001` reports `availableStock: -2` — a
negative on-hand. Reservation-netting can legitimately go negative, but it is worth its own look.

## 13.5 Narrow deploy plan — NOT AUTHORIZED

Single function. **No Hosting. No Rules. No indexes. No seeds. No activation changes. No other
Functions.**

    firebase deploy --only functions:getInventoryAnalytics --project eos-platform-sandbox --non-interactive

`--project` is mandatory, not convenience: `.firebaserc` declares `"default": "taylor-parts"` —
production. The deploy log's `Deploying to` line must be read back before any result is accepted.

**Deploy commit:** `923ed5b1` (or the then-current `main`, provided the analytics path is unchanged
from it).

**Pre-deploy gates:**

1. `/version.json` still reports `0884e480` — Hosting must not have moved.
2. Working tree clean at the deploy commit; `npm run build` exit 0.
3. Capture the rollback baseline revision (`getinventoryanalytics-00010-hes` today).

**Post-deploy verification — required:**

| # | Check | Expected |
|---|---|---|
| 1 | Admin | **200** with a `health` array |
| 2 | Dispatcher | **200** |
| 3 | Technician | **403** with the unchanged message |
| 4 | Unauthenticated | **401** |
| 5 | Result validation | 5 entries; `PRT-1001` finite `daysRemaining`; the four zero-usage parts `null`, never `Infinity` or a string |
| 6 | `availableStock` still reservation-netted | matches the local replay values above |
| 7 | No leakage | error shapes carry no stack, path, or field values |
| 8 | Governed-ledger smoke | `allocateSalesOrder` technician **403** |
| 9 | Core inventory regression | sibling inventory callables unchanged |
| 10 | Tranche 3 API checks | the 19-check Sales Order matrix still passes |
| 11 | Tranche 3 UI check | `/version.json` still `0884e480`; served bundle hash unchanged |
| 12 | Cloud Logging | no `cannot be encoded` errors after the deploy |

**Failure and rollback:** any of 1–5 not matching, any regression in 8–11, or a new error class in
12. Rollback target is the captured revision of `getInventoryAnalytics` **alone** — the other 83
functions are untouched by this deploy.

## 13.6 Status

`SANDBOX PROMOTION CLOSEOUT: STILL BLOCKED` — the repair is merged but not deployed, so the live
smoke still returns 500.

Tracked separately, unchanged by this section:

- Sales Order `createdAtMillis`/`updatedAtMillis` projection — correct **before** any surface consumes
  those fields (§11.4).
- Mounting `salesOrder.index` — its own reviewed UX slice.
- Owner-driven authenticated Account-page check (§12.4).

---

# §14 — Targeted Functions repair: `getInventoryAnalytics` DEPLOYED

**Deployed 2026-08-19T01:37:54Z. 12 of 12 post-deploy checks PASS. The live encoder error is gone.**
Hosting untouched. No rollback required or performed.

## 14.1 Pre-deploy gates — all four passed

| Gate | Result |
|---|---|
| Working copy at the authorized commit | detached at `923ed5b1`, **tree clean** |
| `npm run build` | exit **0** |
| Hosting unmoved | `/version.json` = `0884e480` |
| Rollback baseline captured | revision **`getinventoryanalytics-00010-hes`** |

## 14.2 Deployment

    npx firebase-tools deploy --only functions:getInventoryAnalytics --project eos-platform-sandbox --non-interactive

The log confirms exactly one operation —
`functions[getInventoryAnalytics(us-central1)] Successful update operation` — and **no Hosting,
Rules, index, seed or activation lines**. New revision **`getinventoryanalytics-00011-sas`**, ACTIVE.
Function count unchanged at **84**.

## 14.3 Post-deploy matrix — 12 / 12

| # | Check | Result |
|---|---|---|
| 1 | Admin | **200**, 5 entries |
| 2 | Dispatcher | **200**, 5 entries |
| 3 | Technician | **403**, message byte-unchanged |
| 4 | Unauthenticated | **401** |
| 5 | Result validation | 5 entries; `PRT-1001` finite `-30`; four zero-usage parts **`null`**; the string `Infinity` appears **nowhere** in the payload |
| 6 | `availableStock` still reservation-netted | `-2, 6, 12, 40, 3` — identical to the pre-deploy local replay |
| 7 | No leakage | 3 error shapes probed, 0 leaky |
| 8 | Governed-ledger boundary | `allocateSalesOrder` technician **403** |
| 9 | Sibling inventory callables unchanged | see caveat |
| 10 | Sales Order regression matrix | index **14 rows**, strictly descending; account read **14**; over-limit **400**; unauthenticated **401**; technician **403** |
| 11 | Hosting untouched | `/version.json` `0884e480`, bundle still `index-BmuCD58g.js` |
| 12 | Cloud Logging | **no encoder errors after the deploy** |

**Check 5 is the repair itself.** The four zero-usage parts now return `daysRemaining: null` — the
same value `estimatedStockoutDate` already carried for that condition — rather than an `Infinity`
that could not cross the wire. The one part with usage history keeps its computed `-30` unchanged, so
the projection did not flatten real values into nulls.

**Check 12 is the proof the defect is gone, not merely masked.** The only errors in the trailing hour
are from `00:55Z` — my own pre-deploy probes. Nothing after `01:37:54Z`, across roughly ten live
invocations during this matrix. Before the deploy, every authorized call produced one.

**Check 9 caveat, stated precisely.** `detectInventoryEffects` returns **400 invalid-argument** and
`receiveInventoryStock` returns **400** for a technician. A 400 proves the callable is reachable and
validating input; it does **not** prove the authorization outcome, because argument validation runs
before the capability check. The authorization boundary is demonstrated directly by checks 3 and 8
instead. No write was performed by any probe.

## 14.4 Position

The four conditions named for closeout are met:

| Condition | Status |
|---|---|
| Live encoder error absent | **YES** — check 12 |
| Authorized personas receive valid wire-safe results | **YES** — checks 1, 2, 5 |
| Access boundaries hold | **YES** — checks 3, 4, 7, 8 |
| Inventory and Sales Order regression matrices pass | **YES** — checks 6, 9, 10 |

Deployed strictly within scope: one callable, one commit, explicit project. No Hosting, Rules,
indexes, other Functions, seeds, activations, or production. **Negative available stock on
`PRT-1001` was not remediated**, per the authorization — it remains an open observation.

Still tracked separately and unchanged by this repair:

- Sales Order `createdAtMillis`/`updatedAtMillis` projection — correct **before** any surface consumes
  those fields (§11.4).
- Mounting `salesOrder.index` — its own reviewed UX slice (§12.6).
- Owner-driven authenticated Account-page check (§12.4) — the one acceptance item no automated
  evidence in this program can supply, because signing in means entering a password.

`TARGETED FUNCTIONS REPAIR: DEPLOYED AND VERIFIED — 12/12.`
`SANDBOX PROMOTION CLOSEOUT: conditions met; closeout is the Owner's call.`
