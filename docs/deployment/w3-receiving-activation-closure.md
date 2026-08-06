---
artifact_type: closure
gate: W3 receiving activation — scoped two-function deploy (CLOSED)
wave: W3
status: DEPLOYED & CONFIGURATION-VERIFIED 2026-08-06 — operational acceptance DEFERRED (business-data/UI prerequisite, not a deployment failure)
date: 2026-08-06
owner: Claude Code (docs closure); deploy executed by Owner-operator
runbook: docs/deployment/w3-receiving-activation-runbook.md
pinned_source: fb45e6eed77f1a3ad89737ee22618a770e6362b5
scope: functions:receiveInventoryStock, functions:listReceivingLocationOptions — ONLY
---

# W3 receiving activation — closure record

The two W3 receiving callables are **live in `taylor-parts`.** This record closes the
engineering/deploy/verification portion of W3 and states precisely what remains (operational
acceptance) and why it is deferred. **This is a docs-only closure; it changed no backend code,
deployed nothing, granted no capability, and altered no Rules.**

## 1. Deployment result
- **Deployment date:** 2026-08-06
- **Pinned source commit:** `fb45e6eed77f1a3ad89737ee22618a770e6362b5`
- **Pre-deploy estate:** 20 Functions.
- **Post-deploy estate:** 22 Functions.
- **Exact two additions:** `receiveInventoryStock`, `listReceivingLocationOptions`.
- All original 20 deployed Functions remain present and unchanged. No other function was
  created, updated, or deleted.
- Verified via `firebase functions:list --project taylor-parts --json` → count `22`,
  including both new names.

> **Deploy-evidence note (not a failure):** the deploy command was invoked twice. The final
> output showed `listReceivingLocationOptions` as a successful **create** and
> `receiveInventoryStock` as a successful **update** — consistent with the first invocation
> having created `receiveInventoryStock` before its output was captured and the second
> creating `listReceivingLocationOptions` while re-applying (updating) the first. No other
> function was shown created/updated/deleted, and the final 22-function reconciliation is
> exact. This is NOT a failed deployment.

## 2. Live configuration verified (both functions)
Both `receiveInventoryStock` and `listReceivingLocationOptions`:

| Field | Value |
|-------|-------|
| Version / Generation | `v2` / `GEN_2` |
| Trigger | `callable` |
| Region | `us-central1` |
| Runtime | `nodejs20` |
| Memory | `256Mi` |
| State | `ACTIVE` |

- `receiveInventoryStock` URI: `https://receiveinventorystock-5d4sshsceq-uc.a.run.app`
  (updateTime `2026-08-06T14:14:50.787718520Z`).
- `listReceivingLocationOptions` URI: `https://listreceivinglocationoptions-5d4sshsceq-uc.a.run.app`
  (updateTime `2026-08-06T14:14:36.322865544Z`).

## 3. Repository + emulator verification (at the pinned source)
- Node `v20.20.2`, npm `10.8.2`; `npm ci` completed.
- `npm run build` — PASS. `npx tsc --noEmit` — PASS.
- Focused emulator suites — 5 files passed, 0 failed, exit 0:
  `receiveInventoryStockCommand.test.mjs`, `receivingCallables.test.mjs`,
  `receivingCallablesExport.test.mjs`, `receivingGrantGate.test.mjs`,
  `operationalMovementLedger.test.mjs`.
- Confirmed behaviors: authorized-NONE receipt atomic; missing capability denies with zero
  writes; authorization checked through the transaction; ORDERED source-state enforced;
  wrong PO/request state fails closed; SERIAL/LOT deferred & fail-closed; exact retry replays
  with no duplicate writes; changed-payload reuse conflicts; operational-movement ledger
  append-only & idempotent; callable request validation + public error mapping bounded; exact
  public exports present; role/capability grant gate fail-closed.

## 4. Operational acceptance — DEFERRED (prerequisite, not a failure)
The full production receipt test requires BOTH, and neither was authorized/created here:
1. An already-live actor holding `inventory.stock.receive` (no grant was authorized), and
2. A legitimate production source: `reorder_requests/{id}.status = ORDERED` **with** its linked
   `reorder_purchase_orders/{id}.status = ORDERED` (no synthetic production PO was authorized).

Until both pre-exist, the "applied receipt" acceptance test cannot run. A missing grant returns
`permission-denied` (a valid fail-closed result), and there is currently no application UI path
to inspect/verify an ORDERED/ORDERED source (Purchasing → Purchase Orders reports "This area
isn't built yet"). **This is a business-data/UI prerequisite, not a deployment defect.**

## 5. W3 status
| Dimension | Status |
|-----------|--------|
| Engineering | COMPLETE |
| Repository verification | COMPLETE |
| Emulator verification | COMPLETE |
| Production deployment | COMPLETE |
| Live configuration verification | COMPLETE |
| Operational acceptance | DEFERRED (needs a pre-existing authorized `inventory.stock.receive` actor + an ORDERED/ORDERED source) |

## 6. Explicitly NOT done in this activation
No Rules change; no capability grant; no `createWorkOrder`/`transitionWorkOrder` redeploy;
no PartsScanner wiring; no `customerName` denormalization; no unrelated Functions changed.

## 7. Separate later slices (tracked, not part of W3 closure)
- **A. PartsScanner integration** — PartsScanner as a tool within FieldMode (Technician
  Workspace preserved); replace demo `InventoryContext` writes in the real receiving action
  with a live `receiveInventoryStock` call using `listReceivingLocationOptions`; preserve
  honest failure/loading/replay states.
- **B. Technician display snapshot** — denormalize `customerName` + location display fields
  onto `fieldops_wos` in the trusted create/update Work Order backend; redeploy only those
  specific existing Functions; do NOT add technician Accounts read access.
- **C. Purchase Order UI** — build the real Purchase Orders surface; expose governed
  ORDERED receipt candidates; enable the first real production receiving acceptance test.
- **D. Runtime modernization (separate governed story)** — Firebase warned Node.js 20 is
  deprecated (2026-04-30) / decommissioned (2026-10-30) and `firebase-functions` is outdated.
  Track as its own governed runtime-upgrade story; do NOT fold into W3.

## 8. Known stale wording to correct separately (frontend, out of docs-only scope)
The Administration Permission Preview placeholder still reads that the "Enterprise Access &
Administration Platform's trusted backend … is not yet deployed and verified (Issue #15)" — in
`field-ops-app-vite/src/modules/administration/AdminRolesPermissions.jsx` and
`AdministrationUnavailable.jsx`. That wording is stale/over-broad: Blaze is active, 22 Functions
are deployed (incl. `resolveEffectiveAccessCallable` and now the W3 receiving callables). The
accurate distinction is: **W3 receiving backend = DEPLOYED**; the Permission Preview / Enterprise
Access UI backend integration for that specific surface is still incomplete/unverified. Correcting
JSX copy is a frontend change (not docs), so it is deferred to a separate small UI slice rather
than mixed into this docs-only closure.
