# Wave 7 — completion truth matrix

Every item's **actual** furthest state. Stages are strictly ordered and each implies all prior ones:

`DESIGNED → IMPLEMENTED → MERGED → DEPLOYED → ACTIVATED → USER-VISIBLE → E2E VERIFIED`

**Merged is not deployed. Deployed is not activated. Activated is not verified.** An item is
`COMPLETE` only when it reaches the terminal state its own nature requires — for a user-facing
capability that means E2E VERIFIED, and nothing short of it.

**Live sandbox at time of writing:** `platform-sandbox` serving commit `b09f3a13`
(`environmentId: platform-sandbox`), confirmed by reading the deployed `/version.json`.

Legend — ✅ reached · ⬜ not reached · n/a not applicable to this item.

| Item | Designed | Implemented | Merged | Deployed | Activated | User-visible | E2E verified | Status | Remaining blocker |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- | --- |
| Part Master write | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | **PARTIAL** | Needs `inventoryCatalogAdministrator` granted to a sandbox persona, then E2E |
| WO Parts Planning | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | **PARTIAL** | `workOrderPartsPlanner` Role now defined (#1023) but granted to nobody; positive path denies until granted |
| Part → WO Demand | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ⬜ | **PARTIAL** | Index is live; needs E2E against real data |
| Sales Order actions | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | **PARTIAL** | Capabilities already granted to admin/dispatcher — E2E only |
| SERIAL Receiving | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | **PARTIAL** | Capability already granted; needs E2E incl. duplicate/replay/atomic-failure |
| Serialized Asset foundation (M.1) | ✅ | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ | **PARTIAL (by design)** | `inventory.serializedAsset.read` deliberately left inactive + ungranted; no UI in scope |
| Operational-role resolver | ✅ | ✅ | ✅ | ✅ | n/a | n/a | ⬜ | **PARTIAL** | Shared infra; needs E2E proving a technician + ACTIVE operational role resolves, and the negatives deny |
| Opportunity create | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | **PARTIAL** | Capabilities already granted — E2E only |
| Opportunity lifecycle chevrons | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | **PARTIAL** | E2E only (incl. WON only from DECISION) |
| Account workspace | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ⬜ | **PARTIAL** | E2E only |
| Account Opportunities section | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | **IN PROGRESS** | Being built this package (Part 2) |
| Account Sales Orders section | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | **IN PROGRESS** | Being built this package (Part 3) |
| CRM Activity authority | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | **PARTIAL** | `crmActivityContributor` Role now defined (#1023) but granted to nobody |
| Follow-up / Next Action | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | **BLOCKED** | No task/follow-up authority exists; needs Exception Ownership capability (roadmap #10) |
| Account Attention | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ⬜ | **PARTIAL** | E2E only; may gain signals once Parts 2/3 land |
| WO / Dispatch Attention | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ⬜ | **PARTIAL** | Parts-blocked subsection honestly empty (dimensions not read by ControlTower) |
| Dispatch / Scheduling workspace | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | **IN PROGRESS** | Being built this package (Part 1) |
| Receiving (NONE path) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | **PARTIAL** | Pre-existing and live; E2E regression only |
| Purchasing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | **PARTIAL** | Largely pre-existing. Remaining gaps need protected Rules/Role actions — out of Wave 7 |
| Truck Inventory | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | **BLOCKED** | No Transfer Orders module ⇒ no ledger event can carry a MOBILE location |
| Cycle Count | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | **BLOCKED** | No adjustment authority; expected-quantity authority unresolved (Owner ruling) |
| Back Order | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | **DEFERRED** | Truthful only for Sales Orders; no ETA authority exists |

## What "PARTIAL" means here, concretely

Nine items are **user-visible in the live sandbox right now** and still not complete, for two distinct
reasons that should not be conflated:

1. **Awaiting a Role grant** — Part Master, WO Parts Planning, CRM Activity. The code is deployed and
   the capability is activated, but no principal holds it, so the positive path denies. These will
   *look* broken to a tester until the grants run. That is expected, not a defect.
2. **Awaiting E2E only** — Sales Order actions, SERIAL Receiving, Opportunity create/lifecycle, Part →
   WO Demand, Account workspace, both Attention projections. Everything is in place; nobody has yet
   proven the behavior against the live environment.

## Terminal-state exceptions

- **Serialized Asset foundation** is deliberately parked at DEPLOYED. Activation was intentionally
  withheld and there is no UI in scope; its terminal state for Wave 7 is *not* USER-VISIBLE.
- **Operational-role resolver** is shared infrastructure with no surface of its own — "user-visible"
  is not a meaningful stage for it, but E2E still is.
- **Follow-up, Truck Inventory, Cycle Count** are blocked on authorities that do not exist. They are
  not late; they are correctly not built.
