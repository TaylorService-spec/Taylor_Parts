---
artifact_type: review
gate: Issue #15 — Blaze / Functions activation decision package
status: DECISION PACKAGE — awaiting Owner authorization (Tier-3 Blaze + Tier-2 deploy)
date: 2026-08-06
owner: Claude Code
base_commit: 05451f2 (origin/main)
tier: Blaze enablement = Tier-3 (spending); Functions deploy = Tier-2 (protected)
---

# Issue #15 — Blaze / Functions activation decision package

**Repository-only decision doc. No Blaze enabled, no Functions deployed to produce it.**
This consolidates the one billing decision and its blast radius so the activation can be
authorized (or not) with full visibility.

## 0. The single true gate: Blaze enablement (Tier-3, Owner-only)

Every Cloud Function below is **built, tested, and index-wired, but NOT deployed** —
`firebase functions:list` is empty because the project is on the **Spark** plan.
Deploying Functions requires the **Blaze** (pay-as-you-go) plan. **Enabling Blaze is a
spending/billing decision — Tier-3, never delegated.** It is the real gate; the deploy is
mechanical once it's on.

## 1. What a Functions deploy publishes (the full blast radius)

`firebase deploy --only functions` publishes the **entire** `functions/src/index.ts`
surface — 8 workstreams' callables, not just the Work Order engine:

| # | Surface | Callables | What it unblocks |
|---|---------|-----------|------------------|
| 1 | **Work Order Engine v1.2** (Issue #15 core) | `createWorkOrder`, `transitionWorkOrder`, `updateWorkOrderExecutionData` | Real WO creation/lifecycle/execution (the wizard's write path) |
| 2 | F-RULES-1 | `completeAssignedJob` | Trusted technician job completion (gated on Gate D1) |
| 3 | Enterprise Access (Issue #226) | `grantRole`, `revokeRole`, `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`, `rejectAccessRequest` | In-product access admin |
| 4 | Reporting (Issue #325) | `runReportDefinitionCallable` + 6 saved-definition CRUD | Report execution + saved reports |
| 5 | Effective-access feed (Issue #226) | `resolveEffectiveAccessCallable` | Trusted capability feed |
| 6 | AUTH-PR-3 | `initiateAdminPasswordReset`, `listResetEligibleUsers` | Admin password reset |
| 7 | EI Truck Registry (ADR-010) | 9 truck callables | Truck registry writes |
| 8 | **EI Phase-2 Receiving** (W3) | `receiveInventoryStock`, `listReceivingLocationOptions` | The inventory write-loop |

## 2. Critical: DEPLOY ≠ ACTIVATE (each surface is fail-closed by its own downstream gate)

Publishing these callables does **not** turn the features on. By design, each stays
fail-closed until its OWN separate gate:
- **Receiving (#8):** requires the `inventory.stock.receive` capability — registered but the
  grant is merged repo-only; still denies until deployed Rules/grant confirm live.
- **Reporting (#4):** denies unless a `report.*` capability is granted (none is today).
- **AUTH-PR-3 (#6):** fails closed on the unconfigured email-delivery capability — zero Auth
  side effects until an email provider is configured.
- **Truck Registry (#7):** `deactivateTruck` fails closed (INVENTORY_STATE_UNKNOWN) until a
  predicate is injected.
- **Access commands (#3), effective-access (#5), completeAssignedJob (#2):** no client UI
  wired to call them until their own later Owner authorizations.
- **Work Order Engine (#1):** the wizard already calls `createWorkOrder`; on deploy, real WO
  creation begins working — this is the one surface that *does* light up on deploy.

So a full deploy is **relatively safe by construction** (most surfaces remain inert), but it
is still a broad publish. The Owner should authorize it understanding all 8 go live as
*callables*, even though most stay behind their own gates.

## 3. Recommended deploy scope + order

Two viable options:
- **(A) Deploy the whole index** — simplest, matches how these were built to co-deploy; each
  surface's own gate keeps it inert until separately activated. Recommended if you want the
  platform's backend "present and fail-closed."
- **(B) Scoped deploy** — `firebase deploy --only functions:createWorkOrder,transitionWorkOrder,updateWorkOrderExecutionData`
  first (the Issue #15 core), verify, then add `functions:receiveInventoryStock,functions:listReceivingLocationOptions`
  (W3) in a second pass. Smaller blast radius per step; more deploy cycles.

**Recommendation:** (B) scoped — deploy the Work Order Engine first (it's the original
Issue #15 and the one surface that actually activates), verify real WO creation, then W3
receiving. Defer #3/#6/#7 (they gain nothing until their own UI/config/predicate gates).

## 4. Rollback evidence (establish BEFORE deploy)

- Record the **pre-deploy state**: `functions:list` is currently **empty** — so the rollback
  target is "no functions deployed." Capture that explicitly.
- Retain the **exact deploy commit + `functions/package-lock.json`** as the known-good source.
- **Rollback = delete the deployed functions** (`firebase functions:delete <name>` per
  callable) OR redeploy an earlier known-good source. Since nothing is deployed today,
  deletion cleanly returns to the current state.
- No function *writes data on deploy*; the receiving ledger is append-only + idempotent, and
  WO writes are guarded by Rules — so a rollback has no data-cleanup burden beyond any writes
  users made while it was live (which are valid governed writes, not deploy artifacts).

## 5. Live-verification plan (Owner-operated / authorized; I do not use prod credentials)

Per deployed surface:
- **WO Engine:** create a real Work Order via the wizard → confirm `fieldops_wos` doc +
  `createWorkOrder` success; run one `transitionWorkOrder`; confirm Rules still deny direct
  client writes.
- **Receiving:** one `receiveInventoryStock` with a real reorder PO → `applied`; re-run same
  `idempotencyKey` → `replayed` (no double stock); non-granted principal denied.
- **All others:** confirm deployed + that they **deny** correctly (fail-closed) since their
  gates aren't open.
Record each in DECISIONS.md.

## 6. Scanner integration readiness (rides on the WO-engine deploy)

- **PartsScanner → tool within FieldMode** (Owner decision): once `createWorkOrder`/receiving
  are live, PartsScanner's actions wire to `receiveInventoryStock` (not the demo
  InventoryContext), and it renders as a tool *inside* FieldMode (FieldMode preserved). Until
  then it stays inherited-but-unrouted + demo-labeled.
- **Technician human-readable identities** (Owner decision): denormalize `customerName`
  (and location label) onto the `fieldops_wos` doc in `createWorkOrder`/`transitionWorkOrder`
  at creation/update, so technician surfaces show names with no accounts read. This is a
  small addition to the WO-engine functions — do it in the same deploy cycle.

## 7. THE DECISION (Owner)

1. **Enable Blaze?** (Tier-3 spending — only you.) Yes/No.
2. If yes: **deploy scope** — (A) whole index, or (B) scoped WO-engine-first (recommended).
3. Authorize the per-surface **downstream gates** separately as each feature is activated
   (grants, email config, UI wiring) — not bundled into the deploy.

Nothing is enabled or deployed by this package. Awaiting your authorization.
