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
