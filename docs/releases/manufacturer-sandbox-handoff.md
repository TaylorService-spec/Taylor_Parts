# Manufacturer (in-app catalog write) — Sandbox Handoff

**Status:** repo-side implementation **COMPLETE**; **READ-BLOCKED** pending R-1's governed catalog-read
authority (Owner decision, option (b) — WAIT: do not add a new legacy `isAdminOrDispatcher` read site).
When the shared sandbox exercises Manufacturer, it must do so **through the governed catalog-read model**
R-1 provides — not a Manufacturer-specific legacy read.

## Status matrix

| Aspect | State |
|---|---|
| Repo-side implementation | COMPLETE (Phase 1 callables #625 + Phase 2 workspace #626) |
| Write authority model | COMPLETE / NOT DEPLOYED |
| Read authority | **WAITING ON R-1 governed catalog-read model** (see `docs/assessments/r1-catalog-read-authority-requirement.md`) |
| Sandbox experience | **BLOCKED on read authority** (the workspace read fails closed until the governed read lands) |
| Production promotion | PROTECTED / HELD |

## What the sandbox will exercise (once the governed read lands)

read registry · create synthetic Manufacturer · rename · activate/deactivate · invalid input rejection ·
authorization allow/deny (`.manage`-only cannot change status) · idempotency/replay · **no orphan
`manufacturerId`** (Parts link to real Manufacturers) · SHA/D1–D2 verification. Via the deployed callables
+ the governed catalog read + a catalog-admin **test** persona, or `useManufacturerWrite` readiness/mock
injection. Until then, the write flows are exercisable (mock/injected) but the read is fail-closed.

| Path | Artifact |
|---|---|
| Read registry | `field-ops-app-vite/src/modules/inventory/Manufacturers.jsx` + `services/manufacturerQueries` + `domain/manufacturersView` (read fails closed until the governed read lands) |
| create/rename/status | `functions/src/partMaster/manufacturerCallables.ts` via `useManufacturerWrite` → `manufacturerCommandClient` |
| catalog-admin test persona | a test role carrying `inventory.catalog.manage` + `.activate` (accepted `inventoryCatalogAdministrator` design) |
| denial cases / idempotency | `test:manufacturerCallables` (10 emulator) |

## Boundaries (protected / held)

Functions deploy · **the governed catalog READ (R-1) + any Rules deploy** · capability/role grant ·
`MANUFACTURER_WRITE_READY` flip · frontend promotion · production Manufacturer mutation. None done.
**No new legacy `isAdminOrDispatcher` read site was added** (R-1 convergence preserved).

## Modularity

`parts.manufacturerId` is OPTIONAL — a Part is created and operated without a Manufacturer. Manufacturer
is a separately-manageable reference object, never a prerequisite for basic Part catalog operation.
