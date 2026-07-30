# Inventory Session State

## Baseline
- Main commit: `24b6c091d7fc20e7c29c6230fb22f20c0ce6cf6a`
- Last reconciled: 2026-07-29
- Relevant PRs: #445 (merged `2d08e2e`), #447 (merged `081df750`), #448 (**MERGED** `e1a23d6` — C2 Hosting evidence, DECISIONS #50)
- Relevant issues: C2 repository-only authorization DECISIONS #49; C2 Hosting deployment + production verification DECISIONS #50 (merged truth).

## Current Objective
Post-C2 operational-role Parts convergence. C1 (PartsList) and C2 (PartDetail) cutovers are merged, C2 is deployed to production, and the sanitized C2 Hosting evidence is now MERGED truth (PR #448 / DECISIONS #50). Current bounded gate (Owner-authorized 2026-07-29): the **WarehouseManagerHome canonical Parts Catalog cutover** — bring the one operational-role Inventory surface still reading static `PARTS_CATALOG` as primary onto the canonical-first path (the same `fetchPartMasterList` → `buildPartsCatalogRows` composition PartsList/PartDetail use; static demoted to `STATIC_FALLBACK`). Repository-only; no Rules/permission/deploy change (the WAREHOUSE_MANAGER canonical `parts` read Rule is already deployed).

## Status
C2 SATISFIED (merged + deployed + evidence merged, DECISIONS #49/#50). Active gate: WarehouseManagerHome canonical cutover (DRAFT implementation PR, repository-only, not merged — awaiting Codex review + a separate Owner merge decision). Static-catalog retirement remains a later Phase F gate (not safe/authorized: ~13 `getCatalogItem` consumers + the other role surfaces still read static; blocked by DECISIONS #45/UD-3 and excluded by #49).

## Delta Since Last Handoff
- C1 PartsList cutover and Hosting evidence are merged through PR #443.
- The separate C2 gate the C1 record required is satisfied: repository-only authorization is recorded in DECISIONS #49.
- PR #445 (C2 PartDetail cutover) merged as `2d08e2e`.
- PR #447 merged as `081df750`, landing the C2 Hosting runbook/preparation.
- C2 has been deployed to production after the `081df750` baseline; sanitized evidence is on draft PR #448 and is pending repository merge.

## Decisions
- [`DECISIONS.md`](../DECISIONS.md), especially Decisions #43–#46
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
- C2 production deployment: deployed and verified in production after the `081df750` baseline; sanitized evidence is pending repository merge on draft PR #448 — not yet merged truth.

### Unverified
- Any broader declaration that Parts Catalog integration repair is complete.

### Failed
- None recorded here.

### Not applicable
- This file authorizes no deployment or mutation.

## Risks
- Critical: introducing a competing Part source of truth or silently replacing the catalog.
- High: breaking stable part IDs, historical references, or operational joins.
- High: treating access-control completion as data-model reconciliation.

## Next Action
Land the WarehouseManagerHome canonical cutover (merged via PR #479, 2026-07-29). **Separate immediate correction gate — CLOSED (2026-07-29):** PartsList (C1) and PartDetail (C2) formerly dropped `fetchPartMasterList`'s `invalid` collection when mapping `canonicalRead`; the shared composer fails closed on `invalid`, and C1/C2 now **pass it through** via the follow-on **C1/C2 invalid-passthrough** PR (branch `feature/issue-100-c1c2-invalid-passthrough`, DRAFT for independent Codex review, repository-only, awaiting a separate Owner merge decision). Both surfaces now block (`BLOCKED_INCOMPLETE_INPUT`) on malformed canonical documents; an approved static-only exclusion can no longer mask an invalid document, and raw invalid contents never surface. Covered by `test/partDetailView.test.mjs` (pure) + `test/partsListInvalid.test.jsx` / `test/partDetailInvalid.test.jsx` (render). It reads canonical `parts` via the already-deployed WAREHOUSE_MANAGER Rule; it deploys nothing. Deployment of the cutover to Hosting is a later, separately-authorized step — never off a merge approval. The static catalog is NOT retired here; the remaining static consumers (the PARTS_MANAGER/PARTS_ASSOCIATE role surfaces plus ~13 `getCatalogItem` consumers across operations/control-tower/technician/analytics/notifications) are a later separately-scoped convergence phase (OD-3 deferred).

## Stop Conditions
- A further C2 action (evidence merge, static-catalog retirement, or any new deployment) lacks its own separately-linked authorization; DECISIONS #49 authorizes the repository-only cutover merge alone.
- Canonical/static inputs are incomplete or diverge.
- Proposed destructive migration, silent fallback, competing source, or reference rewrite.
- Rules, Functions, deployment, or production mutation without its separate gate.

## Last Updated
- Date: 2026-07-27
- Commit: `081df750d89d9044f0e09bb0241796b8171ed33f`
- Updated by: designated Inventory session
