# Supplier Master — Release Candidate RC-1

**Program:** Supplier Master adoption (Tier-2, DECISIONS #78) — establish a governed **Supplier**
business object replacing free-text `supplierName`.
**Status:** Repository-complete and **sandbox-verified** through S4. **NOT production-live.** Every
production change below is separately authorized and **none has been performed.**

> Repository completion ≠ production activation. A merge to `main` is not authorization to release
> production behavior. This RC identifies a specific version proposed for promotion; promotion is a
> separate, deliberate, Owner-gated act.

---

## 1. Exact RC SHA

**`bc16fe9`** (`origin/main` at RC authoring).

Constituent merges:

| Phase | Capability | PR | Merge |
|---|---|---|---|
| S1 | Architecture spec (`docs/architecture/supplier-master-architecture.md`) | #596 | — |
| S2a | Governed validator + types (`supplierMasterValidation`/`supplierMasterTypes`) | #598 | — |
| S2b | Trusted command service (`supplierMasterCommands` + repository) | #600 | `7657d61` |
| S3 | Purchasing → Suppliers read-only workspace | #602 | `13993d6` |
| S4 | Reorder-PO supplier-linkage migration (dry-run) | #604 | `bc16fe9` |

## 2. What you can safely experience / review

- **Purchasing → Suppliers workspace (the user-facing surface).** A read-only registry of governed
  suppliers: name, vendor #, contact, and governed **status** (Active / Inactive), with All / Active
  / Inactive / **Ungoverned** filters and an honest amber flag for legacy records that predate
  governance. This is the piece worth *experiencing*.
- **Governed write behavior (via emulator/tests, not UI yet).** create / update / activate /
  deactivate with capability gating, idempotency, versioning, server-authored audit, and create-time
  duplicate **detection** — exercised by the command tests. There is intentionally **no** write UI in
  this RC (writes are governed back-office commands).
- **Migration dry-run (via emulator/tests).** Classifies existing purchase orders against governed
  suppliers (exact / ambiguous / inactive / unmatched / historical) and produces a plan — **writing
  nothing**.

## 3. Where / how to review WITHOUT touching production

A **local sandbox** review path exists today (no production data, no production credentials):

1. Start the emulators: `firebase emulators:start --only firestore,auth,functions --project taylor-parts`
2. Seed the sign-in accounts + demo data using the existing harness
   (`field-ops-app-vite/.claude/skills/run-field-ops-app-vite/` — seeds an **admin** and a
   **dispatcher** account).
3. Seed representative suppliers:
   `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node functions/scripts/seedSupplierSandbox.mjs`
   (ACTIVE, INACTIVE, an ambiguous duplicate pair, and one legacy "Ungoverned" doc).
4. Run the app: `npm --prefix field-ops-app-vite run dev`, open
   **`http://localhost:5173/?emulator=1`**, sign in as the seeded admin/dispatcher, and go to
   **Purchasing → Suppliers**.

**Honest environment gap (routed to backlog, not faked):** there is **no hosted, turnkey integrated
preview** with pre-provisioned auth — the review above requires local emulator setup. A one-command
seeded preview environment (and/or a hosted non-production preview) is the missing capability; see
*Environment backlog* below. The only frontend deploy that exists is the ungated production GitHub
Pages workflow, which is **not** a review environment and is out of scope here.

## 4. Automated verification that passed (at `bc16fe9`)

| Suite | Type | Count | Script |
|---|---|---|---|
| `supplierMasterValidation` | offline | 12 | `test:supplierMaster` |
| `supplierMasterCommands` | emulator | 8 | `test:supplierMasterCommands` |
| `suppliersView` | offline | 5 | (app test chain) |
| `reorderPurchaseOrderSupplierLinkage` | offline | 9 | `test:supplierLinkage` |
| `reorderPurchaseOrderSupplierMigration` | emulator (dry-run) | 3 | `test:supplierMigrationEmulator` |

Plus: `tsc` build clean (functions); `vite build` clean (app); **three independent design-code
reviews** (S2 commands, S3 workspace, S4 migration) — **zero correctness findings**, all mechanical
legibility fixes applied.

## 5. Exact production changes eventually required (the promotion delta)

None of these are done. Each is separately authorized.

1. **Supplier command callables + Functions deploy.** The `supplierMasterCommands` are internal
   command services with **no callable wrapper** and are **not** exported from `functions/src/index.ts`
   (same posture as `partMasterCommands`). Production create/update/activate/deactivate therefore
   requires (a) building `onCall` wrappers (mirroring `truckRegistryCallables`/`receivingCallables`),
   and (b) a **Functions deploy**. *This is repo code that does not yet exist — the first
   production-enabling slice.*
2. **Capability grant.** `inventory.catalog.manage` / `inventory.catalog.activate` are defined but
   carried by **no standing role** (only a temporary execution-scoped Part-Master role). A supplier
   administrator role must be **granted** these. *Protected.*
3. **`suppliers` Rules — NO CHANGE.** Already fail-closed governed (`read: isAdminOrDispatcher()`,
   all writes `if false`; trusted commands write via Admin SDK, bypassing rules). Nothing to deploy.
4. **Frontend promotion.** The Suppliers workspace ships with the app bundle; making it visible to
   users requires a **frontend release** (Hosting/Pages) — *protected*. It degrades gracefully (empty
   list) until suppliers exist.
5. **Purchasing migration path (separate, S4 backlog).** To actually link POs: (a) widen the
   `reorder_purchase_orders` create Rule `hasOnly` allowlist to include `supplierId` +
   `supplierNameSnapshot` (**protected Rules deploy**); (b) a forward-compat client-writer change to
   persist `supplierNameSnapshot` on new POs; (c) a governed supplier picker in the reorder flow; (d)
   a manifest-gated real migration execute. See `docs/architecture/supplier-master-s4-migration-readiness.md`.

**Suggested deployment order (when authorized):** callables → Functions deploy → capability grant →
(operational verification of governed writes) → frontend promotion → *then, as its own track,* the
migration path (Rules delta → writer → picker → execute).

## 6. Rollback

| Change | Rollback |
|---|---|
| Supplier callables + Functions deploy | Re-deploy prior Functions estate; callables are additive (removing the exports + redeploy). |
| Capability grant | Revoke the RoleAssignment (no data mutation). |
| `suppliers` Rules | N/A — unchanged. |
| Frontend promotion | Revert to the prior frontend release. |
| Migration real-run (future) | `supplierId`/`supplierNameSnapshot` are **additive**; rollback = delete them. `supplierName` is never modified. |

Dry-run migration (this RC): nothing to roll back — it writes nothing.

## 7. Remaining protected authorizations (none granted)

- Functions deployment (supplier callables — after they are built).
- Capability grant of `inventory.catalog.manage` / `.activate`.
- Frontend/Hosting/Pages promotion.
- `reorder_purchase_orders` Rules deployment (migration allowlist delta).
- Production supplier creation; production migration execute.

## Included vs excluded in RC-1

**Included:** governed Supplier object (validator/types/commands/repository), audit actions, the
read-only Suppliers workspace + user guide, and the dry-run linkage migration tooling + evidence.
**Excluded / deferred:** supplier write UI, command callables, any deploy/grant/promotion, forward-compat
PO writer, governed supplier picker, real migration execute, and `mergeSupplier` (still deferred per S1).

## Environment backlog (route, do not build now unless it becomes the blocker)

- **Turnkey seeded preview:** one command to bring up emulator + seed accounts + seed domain data +
  serve the app in `?emulator=1`, so Owner experience review needs no manual setup.
- **Hosted non-production preview** with pre-provisioned admin auth (a real integrated preview
  endpoint distinct from the ungated production Pages workflow).
- **Deployed-vs-intended observability:** capture deployed SHA / Rules hash / Function estate after any
  promotion (operational verification), surfaced automatically.
