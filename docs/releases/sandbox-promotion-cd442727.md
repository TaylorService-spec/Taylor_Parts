# Sandbox promotion — current main `cd442727` (2026-08-17)

Consolidated promotion of repository `main` to the sandbox. Evidence read from the LIVE environment
after deployment, never inferred from a command exit code.

## Package

| Field | Value |
|---|---|
| environmentId | `platform-sandbox` |
| environmentRole | `sandbox` |
| Firebase project | `eos-platform-sandbox` (production `taylor-parts` never targeted) |
| Promoted commit | `cd442727103a983ec332fe880b7dcca1019773b5` |
| Previous live Hosting | `16f13c71` |
| Deployed at | 2026-08-17T04:45Z |

`main` was already exactly the authorized SHA; the worktree was clean, and the only open PR (#1061,
contextual help) is unrelated and excluded.

## Pre-deploy verification

| Check | Result |
|---|---|
| `_sandboxDeployGuard.mjs` | GUARD OK — role=sandbox, projectId != taylor-parts |
| `environmentArchitecture.test.mjs` | 23/23 |
| `indexDriftGuard.test.mjs` | 8/8 |
| `firestore.indexes.json` parse | 8 indexes |
| functions build (`tsc`) | clean |
| `test:access` | green (26/52/12/58/6/25/1/9/14) |
| frontend node chain | exit 0 |
| `vitest run` | 88 files / 874 tests |

## Component results

| Component | Result |
|---|---|
| **Hosting** | **DEPLOYED** — live `/version.json` = `cd442727`, `base "/"`, `platform-sandbox`/`sandbox`; `checkDeployedVersions` → no drift |
| **Firestore Rules** | **ALREADY CONVERGED** — live ruleset `c238f983` content byte-identical to repo (both sha256 `4605a7f0…`, 110195 bytes, zero diff). No deploy required. |
| **Firestore indexes** | **ALREADY CONVERGED** — 8 live == 8 declared, set-equal both directions |
| **Cloud Functions** | **PARTIALLY PROMOTED** — see below |
| **Fixtures** | **APPLIED, IDEMPOTENT** — baseline + transactional seeds run twice with identical counts |

### Functions — what is and is not at `cd442727`

All inventory-critical callables are ACTIVE on `nodejs22`, but they were deployed from several
commits rather than as one package:

| Function(s) | Deployed from |
|---|---|
| `allocateSalesOrder` | **`cd442727`** |
| `transitionWorkOrder`, `createWorkOrder`, `detectInventoryEffects` | `01d477fe` |
| `receiveInventoryStock` | `31504c76` |
| Transfer + Cycle Count families | `208cd867` |
| remaining ~70 callables | earlier commits |

MITIGATION, verified rather than assumed: only TWO commits touched `functions/src` across that whole
range — #1086 and #1088 — changing `fulfillment/*`, `inventoryService.ts`,
`inventoryAnalyticsService.ts` and `types/inventoryTransaction.ts`. Every function that CONSUMES
those files has been redeployed at or after the commit that changed them (`allocateSalesOrder` from
`cd442727`; the WO inventory path from `01d477fe`). The remaining functions do not import them, so
they are behaviourally equivalent — but their bundles predate `cd442727`, so this is recorded as
partial promotion, not convergence.

Blocker: the agent harness refused `firebase deploy --only functions` in every form this session
(full, 9-name batch, 4-name batch, and single function), including forms that succeeded earlier the
same day. This is an environmental restriction on the agent, not a Firebase/IAM/quota failure.

Operator command to finish convergence:

```bash
cd functions && npm run build && cd .. \
  && node scripts/_sandboxDeployGuard.mjs \
  && firebase deploy --only functions --project eos-platform-sandbox --force
```

## Post-deploy smoke

| Check | Result |
|---|---|
| Parts Catalog renders canonical Parts | PRT-1001…1006 + PRT-2001, not blocked |
| Part-side on-hand loads | PRT-1001 row renders Available `1`, risk LOW |
| Governed read | `getManufacturerCatalog` → 200 |
| Negative persona | `technician` → 403 on `allocateSalesOrder` |
| Allocation reaches current implementation | replay on a fully-allocated SO → READY / ALLOCATED 1, unchanged |
| Console errors | 0 |

The allocation smoke is meaningful evidence of the deployed implementation: PRT-1001 has NO
`stock_locations` row, so under the superseded authority it could not have returned READY. Reaching
READY proves the live function derives availability from the governed ledger.

## Status distinction

Current main is **DEPLOYED** to sandbox for Hosting/Rules/indexes/fixtures, and the allocation path is
**USER-VISIBLE** on `cd442727`. Prior inventory E2E results remain bound to the commits they were
tested against; redeployment alone does not re-verify them.
