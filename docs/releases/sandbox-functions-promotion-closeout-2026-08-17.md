# Sandbox Functions promotion — CLOSEOUT (2026-08-17)

Supersedes the "Cloud Functions partially promoted" condition recorded in
[sandbox-promotion-cd442727.md](./sandbox-promotion-cd442727.md) and closes the regression recorded in
[sandbox-functions-regression-2026-08-17.md](./sandbox-functions-regression-2026-08-17.md).

Every statement below was read from the LIVE environment after the operator deployment, not inferred
from CLI exit status.

## Deployment

| Field | Value |
|---|---|
| environmentId / role | `platform-sandbox` / `sandbox` |
| Firebase project | `eos-platform-sandbox` (production `taylor-parts` never targeted) |
| Operator checkout | `2ed157c873b984ee5f0ba4de2b134586f7d58eff` |
| Batches | 14 of 14 OK, 0 failed |

The checkout is exactly current `origin/main`, so this deployment carries the full authorized
promotion package (`cd442727`) plus two documentation-only commits.

## Functions verification — INDEPENDENT

| Check | Result |
|---|---|
| Expected exports (`functions/src/index.ts` @ main) | **82** |
| Present live | **82** |
| Missing | **NONE** |
| Unexpected/extra | **NONE** |
| State | **82/82 ACTIVE** — none failed, stuck or updating |
| Generation / runtime | **82/82 v2 · nodejs22** |
| `updateTime` clustering | **82/82 in a single `2026-08-17T06` cluster** |

The single cluster is the decisive fact: after the previous incident the estate was split across four
timestamp clusters (17 regressed at `05`, plus `00–01`, `21–23`, and 35 stragglers at `2026-08-16T04`).
Every function now shares one deployment generation.

Note on tooling: the repository's `verifyTruckFunctionsDeployment.js` was deliberately NOT used. It is
scoped to the eight truck exports and provisions disposable personas and fixtures; it is not a general
Functions verifier, and running it would have created throwaway identities purely to prove a
deployment. Authoritative platform state reads plus behavioural probes were used instead.

## Regression closure — both proven defects are gone

Re-tested exactly as they were caught:

| Regression | Before (stale `70b314bf`) | Now |
|---|---|---|
| #1071 — Role catalog split-brain | `getManufacturerCatalog` → **403** for `partsManager` while the access feed said `inventory.catalog.read: true` | **200 `status: ready`** — the two agree again |
| #1088 — allocation authority | PRT-1005 (40 in `stock_locations`, **0** governed ledger) would allocate from the legacy projection | **`readiness: UNKNOWN`, `UNKNOWN: 1`** — no governed stock evidence, so nothing is promised |

The PRT-1005 probe is the discriminator that matters. `stock_locations` claims 40 units; the governed
ledger has never recorded a receipt. Returning UNKNOWN rather than ALLOCATED proves the live function
derives availability from the ledger, not the superseded projection.

## Inventory smoke

| Check | Result |
|---|---|
| Parts Catalog renders canonical Parts | PRT-1001…1006 + PRT-2001, not blocked |
| Part-side on-hand consistent with ledger | PRT-1001 → `1` (3 physical − 2 net reserved) |
| `getManufacturerCatalog` authorized positive | `partsManager` → **200** |
| Unauthorized negative | `technician` → **403** (catalog and transfer) |
| Transfer authority wiring (#1072) | `warehouseManager` `createTransferOrder` → **200 applied** |
| Cycle Count authority wiring (#1072) | `partsAssociate` `createCycleCount` → **200 applied** |
| Console errors | **0** |

`admin` is correctly DENIED `createCycleCount` (403). That is least-privilege working as designed, not
a regression: cycle-count authority lives on `inventoryCycleCountCounter`/`Reconciler`, which `admin`
does not hold. Confirming with the correct persona is what separates a genuine wiring regression from
correct refusal — worth stating, because the raw 403 looks alarming out of context.

The two probes above created one CREATED transfer order and one OPEN cycle count. Neither moves stock;
no existing transactional evidence was recreated or destroyed.

## Component state — exact, per component

| Component | Commit represented | Stage |
|---|---|---|
| Cloud Functions | `2ed157c8` (= current main) | DEPLOYED, ACTIVATED, USER-VISIBLE |
| Hosting | `cd442727` | DEPLOYED, ACTIVATED, USER-VISIBLE |
| Firestore Rules | `cd442727` content (byte-identical to main) | DEPLOYED |
| Firestore indexes | 8 live == 8 declared | DEPLOYED |
| Fixtures | current governed seeds, idempotent | APPLIED |

Hosting reports `cd442727` while Functions report `2ed157c8`. That is a real difference and is stated
rather than smoothed over — but the delta between those two commits is **documentation only**
(`docs/releases/*`), verified with `git diff --name-only`. There is **no runtime delta** between any
deployed component and current main.

## Status

The "Cloud Functions partially promoted" blocker is **CLOSED**.

Sandbox runtime is converged to current main. Per the repository state contract, deployment and live
behavioural probes establish DEPLOYED → ACTIVATED → USER-VISIBLE. They do **not** re-establish
E2E VERIFIED: the completed inventory E2E matrix remains bound to the commits it was tested against,
and this closeout does not relabel it.
