# Manufacturer (in-app catalog write) — RC (repo-side)

**Purpose:** close the upstream catalog reference-object gap the Part Master write created —
`parts.manufacturerId` referenced an entity no one could create, read, or manage. Adds a governed
in-app Manufacturer administration experience over the existing trusted `partMasterCommands` service.
**Repo-only and inert.** Every production step is a separately-authorized protected action; none done.

> Authority: `functions/src/partMaster/partMasterCommands.ts` (the ONE Manufacturer authority);
> catalog capabilities `inventory.catalog.manage` / `.activate` (same as Part/Supplier; the accepted
> `inventoryCatalogAdministrator` role design).

## What's built (repo-only)

**Phase 1 — callable adapters (PR #625, merged).** `functions/src/partMaster/manufacturerCallables.ts`
exposes `createManufacturer` / `updateManufacturer` / `changeManufacturerStatus` as `onCall` wrappers,
exported from `index.ts` under frozen public names. Actor from `request.auth.uid` only; capability
enforced inside the command; sanitized errors. Not deployed. 10 emulator + 2 export tests.

**Phase 2 — administration workspace + prepared Rules delta (this RC).** New
`field-ops-app-vite/src/modules/inventory/Manufacturers.jsx` (read + create/rename/status) reachable at
Inventory → Manufacturers. Reads via `services/manufacturerQueries.fetchManufacturerList` +
`domain/manufacturersView`; writes ONLY through `useManufacturerWrite` → `manufacturerCommandClient` →
the callables. Supporting: `config/manufacturerWriteReadiness.js` (fail-closed),
`domain/manufacturerWrite.js` (client status mirror + form + honest outcome mapping).

## Invariants

ONE Manufacturer authority · ONE trusted command path · NO client Firestore writes · NO parallel
validator · NO parallel status vocabulary (client mirror of `MANUFACTURER_STATUSES`, backend
authoritative) · actor server-derived · honest outcomes (never fabricates success; write-disabled +
read-denied are distinct honest states).

## Fail-closed posture

- `MANUFACTURER_WRITE_READY = false` everywhere (`config/environments.json`) → the workspace is
  write-disabled and `useManufacturerWrite` makes **zero** callable attempts.
- The `manufacturers` collection READ is currently Rules-closed; the governed read delta is **PREPARED,
  not deployed** (mirrors the `parts` read rule; both `firestore.rules` copies in parity). Until
  deployed, the workspace read **fails closed** to a denied state.

## Verification (repo-side)

- Phase 1: 10 emulator + 2 export. Phase 2: 5 offline domain tests; `vite build` clean; full app test
  chain + vitest gate green (485 component tests). Independent design-code review (Phase 2).

## Exact production delta (all protected; none done)

1. **Deploy the three Manufacturer callables:**
   `firebase deploy --only functions:createManufacturer,functions:updateManufacturer,functions:changeManufacturerStatus`.
2. **Deploy the `manufacturers` read Rules delta** — `firebase deploy --only firestore:rules` (Tier-2;
   run the `verify-rules-deploy` checklist; both copies already in parity). WITHOUT this, the workspace
   read stays denied.
3. **Define + grant the catalog-admin authority** — the accepted `inventoryCatalogAdministrator` role
   carrying `inventory.catalog.manage` + `.activate` (shared with Part/Supplier; no standing role carries
   these). Protected.
4. **Flip write-readiness:** `MANUFACTURER_WRITE_READY: true` for the target environment.
5. **Frontend promotion** of the bundle serving the workspace (governed release; not the ungated Pages
   workflow).

## Rollback (per step)

Callables deploy → redeploy prior estate (additive). Rules delta → redeploy prior `firestore.rules`
(additive read allowance, no data effect). Grant → revoke assignment. `MANUFACTURER_WRITE_READY` → false.
Frontend → revert release. No data migration involved.

## Sandbox handoff (shared environment; no Manufacturer-specific env)

Exercise: read registry · create synthetic Manufacturer · rename · activate/deactivate · invalid input
rejection · authorization allow/deny (`.manage`-only cannot change status) · idempotency/replay ·
NO orphan `manufacturerId` (Parts link to real Manufacturers) · SHA/D1–D2 verification. Via the deployed
callables + the deployed read Rules + a catalog-admin **test** persona, or `useManufacturerWrite`
readiness/mock injection. Manufacturer experienced as part of the whole integrated product.

## Modularity (Enterprise requirement)

Manufacturer and Part stay modular: `parts.manufacturerId` is OPTIONAL — a Part can be created and
operated without a Manufacturer. Manufacturer is a separately-manageable reference object, not a
prerequisite for basic Part catalog operation.

## Protected actions requiring Owner authorization

Functions deploy · `manufacturers` Rules deploy · capability/role grant · `MANUFACTURER_WRITE_READY`
activation · frontend promotion · production Manufacturer creation/edit/status. None performed here.
