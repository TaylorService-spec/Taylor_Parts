# Wave 7 — consolidated sandbox deployment runbook

**Status: READY TO DEPLOY — but the deployment could not be executed from the build session.**
The agent session's tool policy denies `firebase deploy`, so every repo-safe prerequisite is complete
and this runbook exists to be executed by the operator. Nothing below has run.

## Reconciliation from the deployed baseline

Recalculated from the repository, not carried forward from any earlier total.

| Field | Value |
| --- | --- |
| Deployed sandbox baseline | `23fd569209c946c3025bb6812185167f1b432964` |
| **Final intended runtime head** | `b09f3a133d9fdc6f68df2135aac924b0328d7e5b` |
| Commits since baseline | **22** |
| Files changed | **151** (+12,405 / −299) |
| `functions/src` delta | 23 files (+1,411 / −51) |
| **`firestore.rules` delta** | **NONE — untouched across the entire package** |
| New Firestore indexes | **1** (`fieldops_wos(status ASC, createdAt DESC)`) |

### PR sequence (21 PRs + 1 direct doc commit)

**Runtime-affecting (13):** #1000 Part Master write readiness · #1001 WO parts planning UI ·
#1002 Sales Order actions · #1003 Part→WO demand · #1004 Serialized Asset contract + read ·
#1006 SERIAL receiving intake · #1009 SERIAL callable/transport fix · #1011 operational-role resolver ·
#1012 Opportunity create + chevrons · #1013 receiving serial capture UI · #1014 WO/Dispatch attention ·
#1016 Account workspace redesign · #1017 Account Attention · #1019 CRM Activity authority ·
#1020 sandbox capability activation.

**Docs / manifest only (7):** #999 · #1005 · #1007 · #1010 · #1015 · #1018 · plus the direct
`fd1069e3` roadmap commit.

## Deployment sequence

Order matters in exactly one place: **the index must exist before or with the Hosting release**, or
the Part → Work Order Demand query fails at runtime.

```bash
# 0. Deploy from the final runtime head -- never an intermediate build.
git fetch origin && git checkout b09f3a133d9fdc6f68df2135aac924b0328d7e5b

# 1. Indexes (must precede or accompany Hosting)
npx firebase deploy --only firestore:indexes --project eos-platform-sandbox

# 2. Functions
npx firebase deploy --only functions --project eos-platform-sandbox

# 3. Hosting -- ONE final build/release, after 1 and 2
cd field-ops-app-vite && npm ci && npm run build && cd ..
npx firebase deploy --only hosting --project eos-platform-sandbox
```

**Do NOT deploy `firestore:rules`.** The package changes none, and a Rules deployment is a separate
protected boundary.

### Functions in this deployment

Newly deployable: `createPart`, `updatePart`, `changePartStatus`, `setWorkOrderPartsPlan`,
`transitionSalesOrder`, `allocateSalesOrder`, `createServiceForSalesOrder`, `getAvailableEquipment`,
`createOpportunity`, `transitionOpportunity`, `createCrmActivity`, `getCrmActivities`.

Changed behavior in an already-deployed callable: **`receiveInventoryStock`** (now accepts SERIAL) and
the shared authorization path used by every callable (**operational-role conditions now resolve**).

### Capability activation (already in the repo, ships with the build)

`workOrder.parts.plan`, `crm.activity.create`, `crm.activity.read` are activated for
`platform-sandbox` only. Production is triple-blocked and unchanged.

### Role grants — the remaining protected step

Activation is not authorization. After deploying, grant to **sandbox test personas only**, via the
governed `grantRole` / `assignApprovedRole` path (which bumps `accessVersion` and syncs claims) —
never a hand-written `roleAssignments` document:

| Capability | Grant needed |
| --- | --- |
| `inventory.catalog.manage` + `.activate` | `inventoryCatalogAdministrator` (Role now exists; granted to nobody) |
| `workOrder.parts.plan` | a Role carrying it — no Role carries it today |
| `crm.activity.create` / `.read` | a Role carrying them — no Role carries them today |
| `salesOrder.*`, `opportunity.*` | already granted to `admin` / `dispatcher` — nothing to do |
| `inventory.stock.receive` | already granted to `{admin, dispatcher, owner}` — nothing to do |

`inventory.serializedAsset.read` is deliberately left **inactive and ungranted**.

## After a successful deployment

1. Record the deployed commit and verify `/version.json` reports `b09f3a13`.
2. Run the E2E matrix in [`wave7-sandbox-manifest.md`](wave7-sandbox-manifest.md) — each row carries
   its own smoke list.
3. Flip verified rows to `SANDBOX VERIFIED`; leave any row whose validation did not actually run.
4. **Remove `fieldops_wos|COLLECTION|status:ASCENDING,createdAt:DESCENDING` from
   `PENDING_DEPLOY_INDEX_KEYS`** in `scripts/indexDriftGuard.test.mjs` — that is what restores the
   guard's declared-equals-live assertion. Leaving it listed would let a genuinely undeclared index hide.

## Rollback implications

Most of the package is frontend-only and reverts with the Hosting release. Two exceptions:

- **#1006 SERIAL receiving is not a pure code rollback once exercised.** Reverting restores NONE-only
  receiving, but `serialized_assets` documents and per-serial ledger events created during validation
  **remain** — the ledger is append-only and completed business history is immutable by design (§L).
  In sandbox these are synthetic records.
- **#1011's rollback direction of risk is inverted.** The prior state was *more* restrictive, so
  reverting **removes** access rather than granting it.
