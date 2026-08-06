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

> **CORRECTION (2026-08-06, Owner) — the deployment-state premises below are SUPERSEDED.**
> Blaze is **ACTIVE** on `taylor-parts`, and the Firebase console shows **live Functions
> invocations** — so the "nothing deployed / `functions:list` empty / on Spark" premises in
> §0 and §4 are **WRONG and must not be used**. Most Inventory capability is already built
> AND deployed. The real open question is narrow: are the specific **receiving /
> location-options** callables live, and how PartsScanner integrates with the trusted
> receiving path. The accurate version of this package is a **scoped delta** produced from
> the operator's `firebase functions:list --project taylor-parts` output (pending) — NOT a
> blanket deploy, deletion-based rollback, or "WO-engine-first" plan. See §8.

**Repository-only decision doc. No Blaze enabled, no Functions deployed to produce it.**
This consolidates the one billing decision and its blast radius so the activation can be
authorized (or not) with full visibility.

## 0. The single true gate: Blaze enablement (Tier-3, Owner-only)

**SUPERSEDED — see the correction banner at the top.** Blaze is ACTIVE and Functions are
already deployed/invoked live. The original text claimed everything was un-deployed on
Spark; that was a stale carried-over premise. The real work is a **scoped delta** vs the
actual deployed estate (§8), not a first-time activation. Enabling Blaze is no longer the
gate (it's on); the remaining gates are the specific per-callable deploys/grants that the
`functions:list` reconciliation identifies as genuinely missing.

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

- **CORRECTED:** `functions:list` is NOT empty — Functions are already deployed. The
  rollback target is the **currently-deployed revisions/configuration**, captured from
  `functions:list` (+ each function's active revision) BEFORE any new deploy. Deletion is
  NOT the rollback (it would remove already-live capability); rollback = **redeploy the
  captured prior revision/source** of the specific function(s) changed.
- Retain the **exact deploy commit + `functions/package-lock.json`** as the known-good source.
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

## 8. RECONCILED ESTATE (authoritative — from operator `functions:list` + `gcloud functions list`, 2026-08-06)

Blaze ACTIVE. **21 functions deployed, all ACTIVE / GEN_2 / us-central1 / nodejs20.** This
section supersedes §0–§7's empty-baseline framing.

**Deployed & current (20) — no source change on main since their deploy → up to date:**
- **Work Order Engine:** `createWorkOrder`, `transitionWorkOrder`, `updateWorkOrderExecutionData`
  (deployed 2026-07-21). ← already LIVE; the wizard's real WO creation works today.
- **Reporting:** `runReportDefinitionCallable` + `create/get/list/rename/duplicate/delete
  SavedDefinitionCallable` (2026-07-21).
- `resolveEffectiveAccessCallable` (2026-07-21).
- `completeAssignedJob` (2026-07-23).
- **Truck registry (8):** create/assignDriver/reassignDriver/unassignDriver/changeStatus/
  changeHomeWarehouse/deactivate/reactivate (2026-08-02). `truckRegistryCallables.ts` changed
  post-deploy ONLY to add the new delete callable; the 8 deployed callables' logic is unchanged.

**Repo-wired but NOT deployed (the genuine delta):**
- **W3 receiving: `receiveInventoryStock`, `listReceivingLocationOptions` — NOT LIVE.** ← the
  answer to the narrow W3 question. This is the real W3 activation delta.
- Access commands (6): `grantRole`/`revokeRole`/`assignApprovedRole`/`setUserStatus`/
  `approveAccessRequest`/`rejectAccessRequest` — behind their own Issue #226 Row-19+ gate.
- AUTH-PR-3 (2): `initiateAdminPasswordReset`, `listResetEligibleUsers` — behind email-config.
- `deleteTruckCreatedInErrorCallable` (1) — new, behind its own gate.

**Obsolete/unexpected deployed: NONE** — every deployed function maps to a current index export.

**Rollback baseline (captured 2026-08-06):** the 21 currently-deployed ACTIVE GEN_2 revisions
(names + run.app URIs + update times from the operator output). THIS is the rollback target,
not "no functions."

**5-way separation (Owner-requested):**
1. **Already-live (no action):** the 20 above.
2. **W3 receiving activation:** deploy ONLY
   `firebase deploy --only functions:receiveInventoryStock,functions:listReceivingLocationOptions`
   (2 additive/new callables). Rollback = delete just those 2 (clean — they're new, deletion
   returns to today's estate). Verify: `applied`→re-`replayed` idempotency; non-granted denied.
3. **Scanner integration:** repo change — PartsScanner as a tool WITHIN FieldMode, its actions
   wired to the (now-live) `receiveInventoryStock` instead of demo `InventoryContext`.
   Deployable after (2).
4. **Technician `customerName` denormalization:** a CODE change to the ALREADY-LIVE
   `createWorkOrder`/`transitionWorkOrder` (stamp `customerName` + location label onto the
   `fieldops_wos` doc at create/update) + **REDEPLOY those two** (not a first deploy).
   Rollback = redeploy their current revision.
5. **Unrelated existing Inventory:** truck registry + reporting are deployed already; not W3.

**Corrected W3 recommendation:** the only genuine deploy for W3 is the 2 receiving callables
(optionally alongside a `createWorkOrder`/`transitionWorkOrder` redeploy if the `customerName`
denormalization is bundled). Do NOT blanket-deploy or delete anything already live.
