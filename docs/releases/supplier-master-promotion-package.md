# Supplier Master — Release / Promotion Package

**Purpose:** the single, coherent, evidence-backed plan to take Supplier Master from
repository-complete (RC-1.1) to production — consumed once (a) the shared sandbox/preview
environment exists, (b) Owner experience review is done, and (c) protected production authorization is
given. **This document is repo-only planning. It executes nothing.** Every production step is a
separately-authorized protected action.

> Companion docs: `docs/releases/supplier-master-rc-1.md` (RC identity + verification),
> `docs/architecture/supplier-master-architecture.md` (S1 / DECISIONS #78),
> `docs/architecture/supplier-master-s4-migration-readiness.md` (migration dry-run + Rules finding).

---

## 1. Exact capability / RC SHA

**`fef1ca3`** (`main` after PR #608, the callable-adapters slice). This is the proposed promotion
baseline. Constituents: S1 #596 · S2 validator #598 · S2 commands #600 · S3 workspace #602 · S4
dry-run migration #604 · RC-1 package #605 · callable adapters #608. (Re-pin to the then-current
`main` SHA at authorization time if `main` has advanced; the delta below is defined against this
content.)

## 2. Exact Functions to deploy

Four callables, deployed **by their frozen export names** (Firebase deploys by export property name):

```
firebase deploy --only functions:createSupplier,functions:updateSupplier,functions:activateSupplier,functions:deactivateSupplier
```

- Scope the deploy to exactly these four (do **not** blanket-deploy `functions` — that would touch
  unrelated functions). Confirm the deploy plan lists only these four adds.
- No other Functions are required for the read workspace (it reads `suppliers` client-side) or the
  migration dry-run (offline/Admin-SDK tooling, not a deployed function).

## 3. Required capability / role changes  → see §A (role proposal) for the authority analysis

- **No new capability is minted.** Supplier reuses `inventory.catalog.manage` (create/update) and
  `inventory.catalog.activate` (activate/deactivate) — the shared catalog capabilities (reconciled
  with R-1; `supplier-master-architecture.md` §6).
- **A governed role that carries these must exist and be granted.** Today: `inventory.catalog.manage`
  sits only on the temporary `inventoryCreateExecutor` role; **`inventory.catalog.activate` is on no
  role at all.** Promotion requires a durable role decision (§A) + a grant to the catalog-admin
  principal(s). Both are protected.

## 4. Frontend promotion requirements

- The Suppliers workspace is already in the app bundle (PR #602); it needs a **frontend release** to
  reach users. It is read-only and **degrades gracefully** (empty list) if promoted before suppliers
  exist, so frontend promotion is order-independent from the backend — but is most useful *after*
  reference-data creation (§7).
- **Caveat:** the only existing frontend deploy path is the ungated production GitHub Pages workflow
  (EAO-owned, flagged). Frontend promotion must go through whatever governed release mechanism the
  EAO/environment program defines — **not** an ad-hoc Pages push. *Protected.*

## 5. `reorder_purchase_orders` Rules delta (migration compatibility)

Required **only** for the migration track (not for governed supplier CRUD). The live create Rule pins
fields with `keys().hasOnly([...])`, which omits the two new fields. Delta:

- Add `supplierId` and `supplierNameSnapshot` to the create allowlist.
- Add type/optionality validation: both optional; when present, `supplierId is string` and
  `supplierNameSnapshot is string`. `supplierName` (historical authority) stays required and unchanged.
- Mirror the same allowance on any update path if/when the forward-compat writer or execute writes
  these fields.
- **This is a protected Rules deployment** (Tier-2; `firestore.rules` changes are always Tier-2).
  Prepare + emulator-verify the diff in sandbox first (§14); deploy is separately authorized.

## 6. Migration phases and ordering

1. **Dry-run (DONE, repo).** Classify existing POs (EXACT / AMBIGUOUS / INACTIVE / UNMATCHED /
   HISTORICAL); produce plan + fingerprint; writes nothing.
2. **Reference-data creation (§7).** Governed suppliers must exist before EXACT matches can resolve.
3. **Rules delta (§5).** Allow the two fields.
4. **Forward-compat writer.** Client `recordPurchaseOrder` persists `supplierNameSnapshot` on new POs
   (additive; depends on §5).
5. **Governed supplier picker** in the reorder flow to set `supplierId` at creation (replaces
   free-text for new POs). *Future UI slice.*
6. **Real migration execute** (existing POs): **TOOLING BUILT (repo-only, sandbox-verified)** —
   `functions/src/supplierMaster/reorderPurchaseOrderSupplierMigrationExecute.ts`
   (`executeSupplierLinkageMigration` + `rollbackSupplierLinkageMigration`). Manifest-gated, fail-closed;
   EXECUTE is impossible by accidental default (defaults to DRY_RUN; EXECUTE needs an explicit target +
   a `${projectId}/${databaseId}` confirmation token); writes ONLY the two additive fields, never
   `supplierName`; per-PO isolated transactions with bounded failure reporting; idempotent/re-runnable;
   EXACT auto, AMBIGUOUS/INACTIVE only via a human-chosen candidate in the manifest, HISTORICAL/UNMATCHED
   rejected. Emits a rollback artifact + evidence. **Running EXECUTE against production is still a
   separate protected step (§13).**

Ordering rule: **1 → 2 → 3 → (4,5 in parallel) → 6.** Execute (6) never runs before the Rules delta
(3) and reference data (2).

## 7. Prerequisite reference-data creation

- **Governed suppliers must be created first** (via the deployed callables + a granted catalog-admin
  role) before the migration can link POs. UNMATCHED POs in the dry-run indicate suppliers that must
  be created (or the PO left historical). This is **production supplier creation** — protected, and
  gated on §2 + §3/§A being live.
- Optionally seed a curated initial supplier set derived from the dry-run's UNMATCHED/HISTORICAL
  names (a human-reviewed list — never auto-created from free text).

## 8. Deployment dependency graph

```
[callables deploy §2] ──▶ [catalog-admin role defined+granted §3/§A] ──▶ [governed supplier creation §7]
                                                                              │
[frontend promotion §4] ◀── (independent; best after §7) ─────────────────────┘
                                                                              │
                              ─── migration track (separate) ────────────────▼
[reorder_purchase_orders Rules delta §5] ──▶ [forward-compat writer §6.4] ──▶ [supplier picker §6.5]
                                          └──▶ [real migration execute §6.6  (needs §7 + §5)]
```

Backend CRUD path (deploy → role → suppliers) and the migration track are **independent** up to the
execute step, which needs both. Frontend promotion is independent.

## 9. Explicit stop / fail-closed gates

- **G1 — Deploy scope gate:** abort if the deploy plan lists anything beyond the four supplier
  callables.
- **G2 — Ungranted gate (inherent):** until §3/§A grant, every supplier command is denied
  (`noQualifyingGrant`); activate/deactivate stay denied until a role carries `.activate`. No bypass.
- **G3 — Rules gate:** no migration write before the `reorder_purchase_orders` Rules delta is live +
  verified.
- **G4 — Execute manifest gate:** the real migration aborts if the live plan fingerprint ≠ the
  approved manifest (state drift), or if any AMBIGUOUS/INACTIVE remains unresolved.
- **G5 — No temporary bypass:** do not grant `.activate` to a broad/temporary role merely to activate
  Supplier Master (explicit Owner direction). The durable role decision (§A) is the only path.

## 10. Rollback per step

| Step | Rollback |
|---|---|
| Callables deploy (§2) | Redeploy prior Functions estate (delete the 4 functions); additive, no data effect. |
| Role define + grant (§3/§A) | Revoke the RoleAssignment (bump accessVersion); role definition is inert without a grant. |
| Supplier creation (§7) | Deactivate (never hard-delete) erroneously-created suppliers via the governed command. |
| Frontend promotion (§4) | Revert to the prior frontend release. |
| Rules delta (§5) | Redeploy the prior `firestore.rules`; additive allowlist entry, no data effect. |
| Forward-compat writer (§6.4) | Revert the client change; already-written snapshots are harmless. |
| Migration execute (§6.6) | `supplierId`/`supplierNameSnapshot` are additive → delete them; `supplierName` never modified. |

## 11. Operational verification per step

- **Callables deploy:** capture deployed SHA + function list; a smoke `createSupplier` call by a
  granted principal in a controlled window (or confirm `noQualifyingGrant` denial pre-grant).
- **Role/grant:** confirm `resolveEffectivePermission` yields the two capabilities for the granted
  principal and denies everyone else; confirm the audit event for the grant.
- **Supplier creation:** read-back the governed `suppliers` docs (status ACTIVE, version, audit).
- **Rules delta:** capture the deployed rules hash; emulator + live regression that the two fields are
  accepted and unrelated fields still rejected.
- **Migration execute:** post-run classification counts match the approved manifest; identity-set
  PRE==POST for untouched POs; evidence bundle archived.
- General: capture **deployed-vs-intended** (SHA / rules hash / function estate) after each step.

## 12. Evidence paths / artifacts

- Verification suites (all under `functions/` + `field-ops-app-vite/`): `test:supplierMaster`,
  `test:supplierMasterCommands`, `test:supplierMasterCallables`, `test:supplierLinkage`,
  `test:supplierMigrationEmulator`; app `suppliersView.test.mjs`.
- Dry-run plan + fingerprint: produced by `dryRunSupplierLinkageMigration` (S4).
- Sandbox seed: `functions/scripts/seedSupplierSandbox.mjs`.
- This package + `supplier-master-rc-1.md` + `supplier-master-s4-migration-readiness.md`.
- Promotion-time artifacts to capture: deploy logs, rules hash, grant audit event id, migration
  manifest + post-run evidence (archive under `Taylor-Migration-Evidence/` per prior convention).

## 13. Exact protected actions requiring Owner authorization

1. Functions deploy of the four supplier callables (§2).
2. Definition + grant of the catalog-admin role / capability grant (§3/§A).
3. Production governed supplier creation (§7).
4. Frontend promotion of the Suppliers workspace (§4).
5. `reorder_purchase_orders` Rules deployment (§5) — Tier-2.
6. Real migration execute against production POs (§6.6).

None are performed here. Each is a discrete Owner authorization.

## 14. What can be prepared / tested in sandbox before production

- Full CRUD + activate/deactivate against the emulator with a **test** role carrying both capabilities
  (already covered by `test:supplierMasterCommands`; the callable path by `test:supplierMasterCallables`).
- The `reorder_purchase_orders` Rules delta: author + emulator-regress the allowlist change (accept
  new fields, still reject unknown) **without** deploying.
- The migration execute: **DONE** — the manifest/execute + rollback tooling is built and emulator-tested
  against synthetic POs + suppliers (`test:supplierMigrationExecute` offline manifest/guard suite +
  `test:supplierMigrationExecuteEmulator` lifecycle: DRY_RUN no-write, additive-only EXECUTE with
  `supplierName` intact, idempotency, STALE_PRESTATE, UNEXPECTED_EXISTING_LINK, rollback). A production
  run is a separate protected step (§13).
- The catalog-admin role definition + a shadow-parity/permission test (no production grant).
- The full integrated experience — once the shared sandbox exists — presented as part of the whole
  product (not a Supplier-specific preview).

---

# §A. Supplier-administration role — authority proposal

**Finding that drives this:** `inventory.catalog.manage` and `inventory.catalog.activate` are **shared
catalog capabilities** governing *all* catalog reference data — Parts, Manufacturers, and (reused, per
DECISIONS #78) Suppliers. They are **registered but ungranted by design**; even `admin`/`owner` do
**not** carry them (a deliberate least-privilege posture — catalog write is a specific operational
authority, not a title-based one; see the `inventoryCreateExecutor` rationale in
`governedBusinessRoles.ts`). Therefore the correct authority is a **catalog / reference-data
administrator**, not a supplier-specific role — a supplier-only role would fragment a single catalog
authority and mint symmetry-only structure that R-1 would want to retire.

### Options evaluated

**Option A (recommended) — a new durable governed role: `inventoryCatalogAdministrator`.**
- **Persona / responsibility:** the person accountable for governed catalog reference data — creating
  and curating Parts, Manufacturers, and Suppliers, and changing their lifecycle status.
- **Capabilities (least-privilege, exactly two):** `inventory.catalog.manage` + `inventory.catalog.activate`.
  Nothing else. (No transaction/receiving/account capabilities — those are separate authorities.)
- **Durable, not transitional:** unlike `inventoryCreateExecutor` (execution-scoped, `.manage`-only,
  revoked after one run), this is a standing platform role for ongoing catalog administration.
- **Least-privilege rationale:** the two capabilities already form one coherent resource authority
  (`resource: "inventory.catalog"`, actions `manage` + `activate`); granting both to one purpose-built
  role is the minimal, auditable unit. It keeps catalog write off `admin`/`owner`, preserving the
  documented posture.
- **R-1 compatibility:** mints **no new capability** (reuses the existing `inventory.catalog.*`), so it
  is fully consistent with R-1's convergence — R-1 governs how capabilities map to roles, and this is a
  clean single-resource role with nothing for convergence to retire.

**Option B — extend an existing durable role (`operationsManager`).**
- `operationsManager` is the closest inventory-operations persona but today carries **read-only**
  inventory capabilities and no write authority. Adding catalog write+activate would turn an oversight
  role into a catalog *writer*. Defensible **only** if the business genuinely treats catalog curation
  as the operations-manager's job. Risk: broadens a multi-purpose role and couples catalog authority to
  ops oversight, making least-privilege audits coarser.

**Not the answer:** `inventoryCreateExecutor` (transitional, `.manage`-only, no `.activate`, meant to be
revoked), and `admin`/`owner` (deliberately excluded from catalog write).

> **SUPERSEDED IN PART, 2026-08-19 (Owner ruling).** The "catalog write stays off title-based
> Roles" posture recorded above no longer holds. `inventory.catalog.manage` is now carried by
> `admin`, `operationsManager` and `fieldManager` -- and by `owner` through composition. That is
> Option B below, applied more widely than Option B itself proposed.
>
> The duplicate-catalog risk this section implies was put to the Owner explicitly before the
> ruling, together with the fact that **no duplicate detection exists in this system today**. The
> decision was to grant now and begin duplicate detection immediately as the mitigation, rather
> than hold the grant until the defence exists.
>
> **`inventory.catalog.activate` was NOT part of the reversal.** It remains confined to
> `inventoryCatalogAdministrator` exactly as recommended here, owner included. Option A's durable
> Role stands, and changing a record's lifecycle status is still a separate authority from
> creating or correcting one.

### Recommendation

**Adopt Option A** — define a durable `inventoryCatalogAdministrator` role carrying exactly
`inventory.catalog.manage` + `inventory.catalog.activate`, and grant it to the designated catalog/
supplier administrator principal(s). Choose Option B only if the Owner decides catalog curation is
intrinsically the operations-manager's authority.

### Grant / revocation, accessVersion, audit (either option)

- **Grant:** a `roleAssignments/{id}` doc (`principalUid`, `roleId`, global scope, `status: "active"`,
  `accessVersionAtGrant`, `grantedBy`, `grantedAt`) via the governed access-command path — **not** a
  hand-written doc. This is the protected grant action.
- **accessVersion:** granting/revoking bumps the principal's `accessVersion` (and syncs custom claims),
  invalidating cached authorization so the change takes effect deterministically. `accessVersionAtGrant`
  pins the grant to the version at which it was issued.
- **Revocation:** set the assignment inactive (never delete history) + bump `accessVersion`; the role
  definition remains inert without any active grant.
- **Audit:** both the role-grant and every supplier command are server-authored audit events
  (`auditEventWriter`); the grant records `accessVersionAfter`. No client-authored authority changes.

### What this proposal does NOT do

Define or grant anything in production. It recommends the authority shape; the definition (repo) and
the grant (production) are separate, Owner-authorized steps. **No temporary bypass** to activate
Supplier Master (explicit Owner direction) — the durable role decision is the only path to
activate/deactivate authority.
