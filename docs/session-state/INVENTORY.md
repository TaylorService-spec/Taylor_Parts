# Inventory Session State

## Baseline
- Main commit: `f68f823293d4c9072d5231deb502a91231d44636`
- Last reconciled: 2026-07-30
- Relevant PRs: #445 (merged `2d08e2e`), #447 (merged `081df750`), #448 (**MERGED** `e1a23d6` — C2 Hosting evidence, DECISIONS #50), #479 (**MERGED** `3abdeddb512814ba39f016c420a21b3ef0a82c78` — WarehouseManagerHome canonical cutover, DECISIONS #57), #481 (**MERGED** `1f76f84cc38ddf9f611e79615c3b311ed1b21b2b` — C1/C2 invalid passthrough, DECISIONS #58)
- Relevant issues: C2 repository-only authorization DECISIONS #49; C2 Hosting deployment + production verification DECISIONS #50 (merged truth); WMH canonical cutover DECISIONS #57 (repository-only, not deployed); C1/C2 invalid passthrough DECISIONS #58 (repository-only, not deployed).

## Current Objective
Post-cutover operational-role Parts convergence governance. C1 (PartsList) and C2 (PartDetail) cutovers are merged, C2 is deployed to production with merged evidence (PR #448 / DECISIONS #50), the **WarehouseManagerHome canonical Parts Catalog cutover** is merged (PR #479, repository-only, **not deployed**), and the **C1/C2 invalid-passthrough** fail-closed correction is merged (PR #481, repository-only, **not deployed**). No implementation gate is open. The current bounded gate is this **post-cutover governance reconciliation** (docs-only): record the two merges, close the C1/C2 correction gate, and refresh session state. The next runtime step — a Hosting deployment of the merged WMH + C1/C2 changes — is on HOLD and requires its own separately-authorized deployment package (to be pinned to `1f76f84cc38ddf9f611e79615c3b311ed1b21b2b`).

## Status
C2 SATISFIED (merged + deployed + evidence merged, DECISIONS #49/#50). WMH canonical cutover MERGED (repository-only, DECISIONS #57, not deployed). C1/C2 invalid-passthrough MERGED (repository-only, DECISIONS #58, not deployed) — the separate C1/C2 correction gate is now **CLOSED**. OD-3 PartsManagerHome + PartsAssociateHome name-resolution cutover **MERGED** (PR #486); OD-3 **Operations dashboard** name resolution (WarehousePanel/ProcurementPanel/ExecutionInsightsPanel) **MERGED** (PR #489); both repository/test only, not deployed. OD-3 **shared InventoryHealthPanel** canonical name resolution across all four parents **MERGED** (PR #491, F1/F2 CLOSED); all repository/test only, not deployed. OD-3 **Work-Order-snapshot cohort** (WorkOrderDetail, PartsOverviewPanel, ExecutionCapture, TechnicianWorkOrderCard) static fallback removed — **MERGED** (PR #493, Option B); all repository/test only, not deployed. OD-3 **NotificationPanel** canonical name resolution via AppHeader **MERGED** (PR #494, zero read for unauthorized roles); all repository/test only, not deployed. Active gate = OD-3 **closure gate** (Owner-approved 2026-07-30, prepared in DRAFT PR; open until merged; repository/test only): (1) remove `PARTS_CATALOG.length` + its import from Operations.jsx (Option D — the descriptive static-baseline/not-live-stock meaning retained, no number); (2) correct the stale `searchProviders.js` "context.parts is PARTS_CATALOG (static)" comment (the Parts search is already canonical-first — PartsList injects the governed `catalogRows`; fail-closed + access-version guarded; governed 200-row set incl. the 10 STATIC_ONLY_EXCLUDED kept searchable per Stage D KEEP_VISIBLE); (3) governance reclassification. This **closes the OD-3 name-candidate set (→ 0)**. Static-catalog retirement remains a later Phase F gate (not safe/authorized: **2 static-primary consumers remain after this gate merges** — the 2 UD-3/UD-4 `warehouseQty` stock-authority readers only; blocked by DECISIONS #45/UD-3 and excluded by #49). Hosting deployment of the merged WMH + C1/C2 runtime is HELD pending a separate deployment package + Owner decision.

## Delta Since Last Handoff
- C1 PartsList cutover and Hosting evidence are merged through PR #443.
- The separate C2 gate the C1 record required is satisfied: repository-only authorization is recorded in DECISIONS #49.
- PR #445 (C2 PartDetail cutover) merged as `2d08e2e`.
- PR #447 merged as `081df750`, landing the C2 Hosting runbook/preparation.
- C2 has been deployed to production after the `081df750` baseline; sanitized evidence merged via PR #448 (`e1a23d6`, DECISIONS #50).
- WarehouseManagerHome canonical cutover merged (PR #479 → `3abdeddb512814ba39f016c420a21b3ef0a82c78`, DECISIONS #57) — repository-only, not deployed.
- C1/C2 invalid-passthrough fail-closed correction merged (PR #481 → `1f76f84cc38ddf9f611e79615c3b311ed1b21b2b`, DECISIONS #58) — repository-only, not deployed; the separate C1/C2 correction gate is now CLOSED.

## Decisions
- [`DECISIONS.md`](../DECISIONS.md), especially Decisions #43–#46, #49–#50, and #57–#58
- [`SYSTEM_AUTHORITIES.md`](../architecture/SYSTEM_AUTHORITIES.md)
- [`inventory-parts-convergence-recovery.md`](../assessments/inventory-parts-convergence-recovery.md)
- [`inv-convergence-e-shadow-read-and-convergence.md`](../implementation-plans/inv-convergence-e-shadow-read-and-convergence.md)
- [`enterprise-inventory-architecture.md`](../implementation-plans/enterprise-inventory-architecture.md)
- [`inv1-phase1-part-master.md`](../implementation-plans/inv1-phase1-part-master.md)

## Dependencies
- Part remains the shared authoritative entity under Inventory Management.
- Preserve stable part IDs and references across the ledger, manufacturers, aliases, supplier mappings, stock, truck inventory, usage history, reorder analytics, Work Orders, and Procurement.
- Firestore access repair does not prove catalog or integration reconciliation.
- Inventory-to-Procurement work ends at governed intake unless separately authorized.

## Production Evidence

### Verified
- C1 Hosting deployment and evidence: PR #443.
- C2 repository-only authorization: DECISIONS #49.
- C2 PartDetail cutover merged to `main`: PR #445 (`2d08e2e`).
- C2 Hosting runbook/preparation merged to `main`: PR #447 (`081df750`).
- C2 production deployment: deployed and verified in production after the `081df750` baseline; sanitized evidence merged via PR #448 (`e1a23d6`, DECISIONS #50) — merged truth.

### Unverified
- Any broader declaration that Parts Catalog integration repair is complete.
- WarehouseManagerHome canonical cutover (PR #479) and C1/C2 invalid passthrough (PR #481) in production: **NOT deployed** — repository-only merges; no Hosting release, no live persona verification (deployment HELD pending a separate package + Owner decision).

### Failed
- None recorded here.

### Not applicable
- This file authorizes no deployment or mutation.

## Risks
- Critical: introducing a competing Part source of truth or silently replacing the catalog.
- High: breaking stable part IDs, historical references, or operational joins.
- High: treating access-control completion as data-model reconciliation.

## Next Action
The WarehouseManagerHome canonical cutover (PR #479, DECISIONS #57) and the **C1/C2 invalid-passthrough** fail-closed correction (PR #481, DECISIONS #58) are both **merged, repository-only, and NOT deployed**. **The separate C1/C2 correction gate is CLOSED** (2026-07-30): PartsList (C1) and PartDetail (C2) formerly dropped `fetchPartMasterList`'s `invalid` collection when mapping `canonicalRead`; they now **pass it through** into the shared `composeGovernedPartsWorkspace`, so both surfaces block (`BLOCKED_INCOMPLETE_INPUT`) on any present-non-empty or malformed `invalid` — an approved static-only exclusion can no longer mask an invalid document into a false READY, and raw invalid-document contents never surface (covered by `test/partDetailView.test.mjs` pure + `test/partsListInvalid.test.jsx` / `test/partDetailInvalid.test.jsx` render).

**OD-3 PartsManagerHome + PartsAssociateHome canonical name-resolution cutover — MERGED (PR #486, 2026-07-30, repository/test only, not deployed):** those two surfaces resolve reorder-request part names via the shared governed path (`hooks/useCanonicalPartNames` → `domain/resolveCanonicalPartNames`), fail-closed to raw partId, access-version boundary-key guarded.

**OD-3 Operations dashboard name resolution — MERGED (PR #489, 2026-07-30, repository/test only, not deployed):** Operations.jsx owns one `useCanonicalPartNames` and feeds `resolveName` to WarehousePanel/ProcurementPanel/ExecutionInsightsPanel, fail-closed to raw partId, access-version guarded.

**OD-3 shared InventoryHealthPanel canonical name resolution — MERGED (PR #491, 2026-07-30, repository/test only, not deployed):** the shared panel takes a required `resolveName` (fail-closed default → raw partId); all four parents feed a governed canonical resolver; WMH + PartsList unified onto a decision-#2-compliant, access-version-guarded resolver (F1/F2 CLOSED).

**OD-3 Work-Order-snapshot cohort — MERGED (PR #493, 2026-07-30, Option B, repository/test only, not deployed):** the four components drop the static-catalog name fallback (name = valid recorded snapshot name → raw SKU; WorkOrderDetail category/unit → snapshot value or neutral); snapshot stays authoritative; no Work Order mutation.

**OD-3 NotificationPanel canonical name resolution — MERGED (PR #494, 2026-07-30, repository/test only, not deployed):** AppHeader owns one `useCanonicalPartNames({uid, accessVersion, enabled: canSeeReorderRequests})` (zero canonical read for unauthorized/non-notification roles), threads `resolveName` into NotificationPanel; fail-closed to raw partId; identity/link/sections/counts/urgency/focus/a11y preserved.

**Active gate — OD-3 closure gate (Owner-approved 2026-07-30, prepared in DRAFT PR; open until merged):** (1) **Operations.jsx** — remove `{PARTS_CATALOG.length}` + the `PARTS_CATALOG` import (Option D); the copy keeps "the static catalog is a static baseline … not live stock" without a number. (2) **searchProviders.js** — correct the stale "`context.parts` is PARTS_CATALOG (static)" comment: the Parts search is already canonical-first (PartsList injects the governed `catalogRows` = `buildPartsCatalogRows` output), access-version boundary-key guarded (via PartsList's read), and fails closed on a blocked read (empty `catalogRows` → no results, never the raw static catalog); the governed 200-row set (190 CANONICAL_MATCH + 10 STATIC_ONLY_EXCLUDED, kept searchable/routable per Stage D KEEP_VISIBLE) is what the caller injects. (3) **Governance** — searchProviders reclassified as already-canonical (not static-primary); this closes the OD-3 name-candidate set (→ 0). Repository/test only. Awaiting independent Codex review; merges repository-only under continuous authority once Codex passes and gates hold.

The next runtime step is a **Hosting deployment** of the merged WMH + C1/C2 changes. It is HELD and must not proceed off any merge approval. When separately authorized, its deployment package pins the proposed Inventory runtime to `1f76f84cc38ddf9f611e79615c3b311ed1b21b2b` with ancestry + build-equivalence proof against then-current main, and stays DRAFT/unmerged pending Codex review and a separate Owner deployment decision.

The static catalog is NOT retired. Authoritative accounting (one source of truth): **13** static-primary consumers after PM/PA (#486); #489 migrated **3** → 10; #491 (InventoryHealthPanel) migrated **1** → 9; #493 (Work-Order-snapshot cohort) migrated **4** → 5; #494 (NotificationPanel) migrated **1** → 4; this closure gate removes Operations.jsx's `PARTS_CATALOG.length` and reclassifies searchProviders as already-canonical (never actually static-primary — its search reads PartsList's governed `catalogRows`) → **2 remain once it merges** (do not mark closed while the PR is draft). **OD-3 name-resolution candidates: 0.** The 2 remaining are **UD-3/UD-4 stock-authority only**: `analytics/operationsIntelligenceService.ts` and `domain/inventoryAnalyticsEngine.ts` read `getCatalogItem(partId)?.warehouseQty` (physical-stock authority, not a name); canonical Part metadata must not be substituted for physical-on-hand authority — deferred to the stock-authority workstream. (WarehouseManagerHome and PartsList remain canonical-first surfaces, not counted.)

## Stop Conditions
- A further C2 action (evidence merge, static-catalog retirement, or any new deployment) lacks its own separately-linked authorization; DECISIONS #49 authorizes the repository-only cutover merge alone.
- Canonical/static inputs are incomplete or diverge.
- Proposed destructive migration, silent fallback, competing source, or reference rewrite.
- Rules, Functions, deployment, or production mutation without its separate gate.

## Last Updated
- Date: 2026-07-30
- Commit: `f68f823293d4c9072d5231deb502a91231d44636` (reconciliation baseline; docs-only)
- Updated by: designated Inventory session
