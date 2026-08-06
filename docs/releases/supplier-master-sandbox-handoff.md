# Supplier Master — Sandbox Handoff

**Status:** Supplier Master is **repo-complete and at rest** (RC-1.2). No Supplier-specific environment
work remains in Product Engineering. When the shared EAO Sandbox / Integration Environment exists, it
should be able to exercise Supplier Master as part of the **whole integrated product** (not a
Supplier-specific preview). This document maps each path the environment must exercise to the concrete
repo artifact that already provides it — nothing new is required here.

| What the sandbox must exercise | Concrete artifact (already in repo) |
|---|---|
| Suppliers registry | `field-ops-app-vite/src/modules/purchasing/Suppliers.jsx` + `domain/suppliersView.js` (Purchasing → Suppliers, read-only) |
| Synthetic Supplier records | `functions/scripts/seedSupplierSandbox.mjs` (emulator-only, fail-closed; ACTIVE/INACTIVE/ambiguous-duplicate/ungoverned) |
| create / update / activate / deactivate | `functions/src/supplierMaster/supplierMasterCommands.ts` (trusted commands) — coverage `test:supplierMasterCommands` |
| Callable adapters | `functions/src/supplierMaster/supplierMasterCallables.ts` (exported from `index.ts`, not deployed) — coverage `test:supplierMasterCallables` |
| `inventoryCatalogAdministrator` test persona | seed a test principal with a role carrying `inventory.catalog.manage` + `.activate` (the accepted role design; a **test** role, never the production grant). The command/callable tests already seed capability-bearing test actors — reuse that seam. |
| Denial cases | callable tests already exercise unauthenticated / no-capability / `.manage`-only-cannot-activate; command tests exercise capability denial |
| Dry-run migration | `functions/src/supplierMaster/reorderPurchaseOrderSupplierMigration.ts` (`dryRunSupplierLinkageMigration`) — coverage `test:supplierMigrationEmulator` |
| Execute migration against synthetic data | `functions/src/supplierMaster/reorderPurchaseOrderSupplierMigrationExecute.ts` (`executeSupplierLinkageMigration`, EXECUTE mode against the emulator) — coverage `test:supplierMigrationExecuteEmulator` |
| Rollback rehearsal | `rollbackSupplierLinkageMigration` (same module) — coverage in the execute emulator suite |
| D1/D2 deployed-SHA verification | tooling emits a plan/rollback fingerprint + evidence; the environment supplies the deployed-vs-intended SHA/rules-hash capture (an EAO env capability, not supplier-specific) |

**Local review path (interim, until the shared environment exists):** emulator + the
`run-field-ops-app-vite` harness (seeds admin/dispatcher sign-in) + `seedSupplierSandbox.mjs` +
`?emulator=1` — see `docs/releases/supplier-master-rc-1.md` §3.

**Boundaries unchanged:** the sandbox uses synthetic data + test roles only. Production Functions
deploy, production role/grant, frontend promotion, `reorder_purchase_orders` Rules deploy, production
supplier creation, production migration execute, and rollback-against-production remain **protected /
held** — see `docs/releases/supplier-master-promotion-package.md` §13.
