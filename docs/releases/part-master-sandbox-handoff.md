# Part Master (in-app catalog write) — Sandbox Handoff

**Status:** repo-complete and **at rest**. No Part-Master-specific environment work remains in Product
Engineering. When the shared Sandbox Operating Simulation exercises the integrated product, Part Master
should be experienced as part of the whole — **not** a Part-specific preview. This maps each path the
sandbox must exercise to the concrete repo artifact that already provides it.

| What the sandbox must exercise | Concrete artifact (already in repo) |
|---|---|
| Existing Part registry | `field-ops-app-vite/src/modules/inventory/PartMasterList.jsx` (read via `services/partMasterQueries.fetchPartMasterList` + `domain/partMasterView`) |
| Create synthetic Part | `createPart` callable (`functions/src/partMaster/partMasterCallables.ts`) via `usePartMasterWrite` → `partMasterCommandClient` |
| Edit governed Part fields | `updatePart` callable (same seam); the workspace edit flow |
| Activate/deactivate / status transition | `changePartStatus` callable (`inventory.catalog.activate`); the workspace status control (client mirror of `PART_STATUS_TRANSITIONS`, backend re-validates) |
| Validation failure | the command's `validatePart` → `invalid-argument` → the workspace's honest `invalid` outcome (`domain/partMasterWrite.js` outcome mapping) |
| Permission denial | capability enforced inside the command; a no-capability actor / `.manage`-only-on-status → `permission-denied` (covered by `test:partMasterCallables`) |
| Idempotency / replay | client-supplied idempotency key per attempt (`usePartMasterWrite`); `applied`/`replayed` outcomes |
| Catalog-administrator persona | seed a **test** principal with a role carrying `inventory.catalog.manage` + `.activate` (the accepted `inventoryCatalogAdministrator` design — a test role, never the production grant). The callable/command tests already seed capability-bearing test actors — reuse that seam. |
| Exact SHA / D1–D2 verification | environment registry records commit + environmentId; deployed-vs-intended SHA/rules-hash capture is an EAO env capability (not Part-specific) |

**Write-readiness:** `PART_MASTER_WRITE_READY = false` in every environment
(`config/environments.json`). The sandbox exercises the write flows by injecting an explicit readiness +
a mocked command client via `usePartMasterWrite(deps)`, or (once the callables are deployed to the
sandbox project and a test role is granted there) against the live callables. Server authorization is
re-enforced regardless.

**Boundaries unchanged (protected / held):** deploy the three Part callables · define + grant
`inventoryCatalogAdministrator` in production · flip `PART_MASTER_WRITE_READY` · frontend production
promotion · production Part creation/edit/status. See `docs/releases/part-master-write-rc.md`.

**UI experience:** the RC recommends a pre-promotion UI-polish / impeccable pass driven by the **real
integrated sandbox experience** (Owner experience review → usability findings → focused polish → update
the RC/promotion package), NOT a speculative redesign while waiting.
