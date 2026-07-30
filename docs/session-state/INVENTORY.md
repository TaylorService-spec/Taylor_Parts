# Inventory Session State

## Baseline
- Main commit: `f68f823293d4c9072d5231deb502a91231d44636`
- Last reconciled: 2026-07-30
- Relevant PRs: #445 (merged `2d08e2e`), #447 (merged `081df750`), #448 (**MERGED** `e1a23d6` — C2 Hosting evidence, DECISIONS #50), #479 (**MERGED** `3abdeddb512814ba39f016c420a21b3ef0a82c78` — WarehouseManagerHome canonical cutover, DECISIONS #57), #481 (**MERGED** `1f76f84cc38ddf9f611e79615c3b311ed1b21b2b` — C1/C2 invalid passthrough, DECISIONS #58)
- Relevant issues: C2 repository-only authorization DECISIONS #49; C2 Hosting deployment + production verification DECISIONS #50 (merged truth); WMH canonical cutover DECISIONS #57 (repository-only, not deployed); C1/C2 invalid passthrough DECISIONS #58 (repository-only, not deployed).

## Current Objective
Post-cutover operational-role Parts convergence governance. C1 (PartsList) and C2 (PartDetail) cutovers are merged, C2 is deployed to production with merged evidence (PR #448 / DECISIONS #50), the **WarehouseManagerHome canonical Parts Catalog cutover** is merged (PR #479, repository-only, **not deployed**), and the **C1/C2 invalid-passthrough** fail-closed correction is merged (PR #481, repository-only, **not deployed**). No implementation gate is open. The current bounded gate is this **post-cutover governance reconciliation** (docs-only): record the two merges, close the C1/C2 correction gate, and refresh session state. The next runtime step — a Hosting deployment of the merged WMH + C1/C2 changes — is on HOLD and requires its own separately-authorized deployment package (to be pinned to `1f76f84cc38ddf9f611e79615c3b311ed1b21b2b`).

## Status
C2 SATISFIED (merged + deployed + evidence merged, DECISIONS #49/#50). WMH canonical cutover MERGED (repository-only, DECISIONS #57, not deployed). C1/C2 invalid-passthrough MERGED (repository-only, DECISIONS #58, not deployed) — the separate C1/C2 correction gate is now **CLOSED**. No implementation gate open; active gate = this docs-only post-cutover reconciliation. Static-catalog retirement remains a later Phase F gate (not safe/authorized: 14 static-primary consumers — the PARTS_MANAGER/PARTS_ASSOCIATE role surfaces + `getCatalogItem` consumers, including `shared/search/searchProviders.js` — still read static; blocked by DECISIONS #45/UD-3 and excluded by #49). Hosting deployment of the merged WMH + C1/C2 runtime is HELD pending a separate deployment package + Owner decision.

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
The WarehouseManagerHome canonical cutover (PR #479, DECISIONS #57) and the **C1/C2 invalid-passthrough** fail-closed correction (PR #481, DECISIONS #58) are both **merged, repository-only, and NOT deployed**. **The separate C1/C2 correction gate is CLOSED** (2026-07-30): PartsList (C1) and PartDetail (C2) formerly dropped `fetchPartMasterList`'s `invalid` collection when mapping `canonicalRead`; they now **pass it through** into the shared `composeGovernedPartsWorkspace`, so both surfaces block (`BLOCKED_INCOMPLETE_INPUT`) on any present-non-empty or malformed `invalid` — an approved static-only exclusion can no longer mask an invalid document into a false READY, and raw invalid-document contents never surface (covered by `test/partDetailView.test.mjs` pure + `test/partsListInvalid.test.jsx` / `test/partDetailInvalid.test.jsx` render). No implementation gate is open.

The next runtime step is a **Hosting deployment** of the merged WMH + C1/C2 changes. It is HELD and must not proceed off any merge approval. When separately authorized, its deployment package pins the proposed Inventory runtime to `1f76f84cc38ddf9f611e79615c3b311ed1b21b2b` with ancestry + build-equivalence proof against then-current main, and stays DRAFT/unmerged pending Codex review and a separate Owner deployment decision.

The static catalog is NOT retired; the remaining **14 static-primary consumers** (the PARTS_MANAGER/PARTS_ASSOCIATE role surfaces plus the `getCatalogItem` consumers across operations/control-tower/technician/analytics/notifications, including `shared/search/searchProviders.js`) are a later separately-scoped convergence phase (OD-3 deferred).

## Stop Conditions
- A further C2 action (evidence merge, static-catalog retirement, or any new deployment) lacks its own separately-linked authorization; DECISIONS #49 authorizes the repository-only cutover merge alone.
- Canonical/static inputs are incomplete or diverge.
- Proposed destructive migration, silent fallback, competing source, or reference rewrite.
- Rules, Functions, deployment, or production mutation without its separate gate.

## Last Updated
- Date: 2026-07-30
- Commit: `f68f823293d4c9072d5231deb502a91231d44636` (reconciliation baseline; docs-only)
- Updated by: designated Inventory session
