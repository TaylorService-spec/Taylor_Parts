# Design archaeology — Service · Scheduling · Technician · Equipment

Lane **P3-A1** of the Taylor EOS overnight program. Recovery and reconciliation of all prior
Claude Design / North Star work for the Service, Scheduling, Technician and Equipment surfaces,
checked against what the repository actually contains at integrated head `d104cf49`.

**No runtime code was changed by this lane. Nothing was pushed.** Every claim below carries a
`path:line` or a commit SHA. Anything not verifiable in this repository is marked **UNPROVEN**.

---

## 0. Recovery report — where the design work actually is

### 0.1 Search performed

- current tree (`docs/north-star/`, `docs/design/`, `docs/ai/`, `docs/architecture/`,
  `docs/handoff/`, `docs/assessments/`, `docs/certification/`, `docs/epics/`)
- `git log --all` across **1818 refs** (`git branch -a | wc -l`)
- every `.dc.html` ever added on any branch:
  `git log --all --diff-filter=A --name-only -- '*.dc.html'`
- every `.html` ever added on any branch (to catch non-`.dc` design renders)
- deletions: `git log --all --diff-filter=D --name-only -- 'docs/design/*' 'docs/north-star/*' 'docs/ai/*'`
- renames: `git log --all --diff-filter=R -M -- 'docs/*'`

### 0.2 Recovered artifacts — 24, all in the CURRENT tree

**Nothing in this domain was ever deleted or renamed.** The deletion sweep returned an empty set
and the rename sweep found exactly one hit, unrelated (`16103f1f`,
`docs/epics/INVENTORY-CAPABILITY-EXPANSION-PLAN.md` → `docs/capabilities/InventoryManagementPlan.md`).
So the recovery answer is unusually clean: **history holds nothing this domain has lost.**

| # | Artifact | Where found | First commit |
|---|---|---|---|
| 1 | `docs/north-star/service-operations/North Star - Service Operations P1.dc.html` | current | `621ef23a` / `7b7b15cd` (2026-08-30) |
| 2 | `docs/north-star/service-operations/DESIGN-HANDOFF-SERVICE-OPERATIONS-P1.md` | current | same |
| 3 | `docs/north-star/service-operations/README.md` (verdict, SO-D1–D4, SO-G1–G5) | current | same |
| 4 | `docs/north-star/dispatch-board/North Star - Dispatch Board P1.dc.html` | current | `4a5a8054` / `b8fffa0e` (2026-08-27) |
| 5 | `docs/north-star/dispatch-board/DESIGN-HANDOFF-DISPATCH-BOARD-P1.md` | current | same |
| 6 | `docs/north-star/equipment/North Star - Equipment P1.dc.html` (provenance copy) | current | `d9e9a1cb` / `a17ce0d7` (2026-08-30) |
| 7 | `docs/north-star/equipment/North Star - Equipment P1v2.dc.html` (locked authority) | current | same |
| 8 | `docs/north-star/equipment/DESIGN-HANDOFF-EQUIPMENT-P1v2.1.md` | current | same |
| 9 | `docs/design/service-operations-north-star-composition-map.md` | current | `621ef23a` |
| 10 | `docs/design/dispatch-north-star-composition-map.md` | current | `4a5a8054` |
| 11 | `docs/design/equipment-north-star-composition-map.md` | current | `d9e9a1cb` |
| 12 | `docs/design/dispatch-scheduling-authority-map.md` | current | 2026-08-27 |
| 13 | `docs/design/governed-scheduling-domain.md` | current | `f563649c` / `24ffbd54` (2026-08-27) |
| 14 | `docs/design/scheduling-functional-gate-findings.md` | current | `771137b5` / `bdb4eae2` |
| 15 | `docs/design/work-order-scheduling-workspace.md` | current | `d124714e` (2026-08-06) |
| 16 | `docs/design/service-operations-design-review-brief.md` | current | 2026-08-30 |
| 17 | `docs/design/eos-north-star-design-grammar.md` (archetypes §6, handheld §7, AI model §8, R23 §10) | current | — |
| 18 | `docs/design/eos-north-star-sources.md` (the artifact register — **the key to what is missing**) | current | — |
| 19 | `docs/design/north-star-migration-ledger.md` (Families 1, 6, 8, 11 + Dispatch acceptance) | current | — |
| 20 | `docs/design/north-star-open-product-decisions.md` (ND-3, ND-18–ND-24, SO-N1–N9, SO-G7, ND-31/32) | current | — |
| 21 | `docs/design/coordinated-field-mission-cycle9.md` | current | — |
| 22 | `docs/design/sales-order-to-service-cycle7.md` | current | — |
| 23 | `docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md` (§0-E Technician Dashboard) | current | — |
| 24 | `docs/north-star/VISUAL-SYSTEM.md` (the 2026-09-02 palette amendment the handoffs defer to) | current | — |

Supporting (not design artifacts, but design-bearing): `docs/handoff/w1-c27-registrations.md`
(scheduling/dispatch fifteen-dimension census), `docs/handoff/w1-c7-registrations.md` (equipment
census), `docs/architecture/ADR-002/004/006/010`, `docs/architecture/technician-labor-authority-gap.md`,
`docs/epics/EPIC-6-Technician-Execution-Workspace.md`.

### 0.3 Artifacts that are DESIGN AUTHORITY and are NOT in this repository — 8

> **SUPERSEDED IN PART — 2026-09-13, lane ARCH-RECOVER. Three of these eight are RECOVERED; five are
> not.** The heading and the original rows below are kept verbatim as the record of what was measured.
> **The measurement was not wrong.** All three sweeps re-verify today: none of the three has ever been
> in any commit on any branch. They were produced from **delivery archives held outside this
> repository**, at `/mnt/d/Taylor_Parts/Claude Design Docs/`, which were outside this lane's authority
> to search. The finding was **correct about the repository and incomplete about the world.**
>
> Recovered: `North Star - Work Order.dc.html`, `Implementation Render - Work Order.html`,
> `Proposed - Work Order.dc.html` — all three from `Scoping answers needed P1.zip` / `P1v2.zip`, at
> `docs/design-history/recovered/Scoping/`.
>
> **Still absent, unchanged:** `Proposed - Dispatch Board.dc.html`, `Proposed - Dispatch Map.html`,
> **`Proposed - Technician Mobile.dc.html` — still the highest-value gap; the technician handheld still
> has no design artifact**, and its "four moments" are still unenumerated —
> `Subpages - Operations.dc.html`. Their filenames are independently corroborated by a delivered index
> recovered from the same archive; corroborating a name is not recovering a file.
>
> **RECOVERED HISTORICAL DESIGN EVIDENCE** — **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not proof that current EOS still conforms.** Family 1's acceptance is **still closed 2026-08-25** and **nobody has audited its visual
> conformance.** See `docs/design-history/recovered/RECOVERY-MANIFEST.md` and the recovery index at `historical-acceptance-evidence-register.md` §0.4.

`docs/design/eos-north-star-sources.md:93-115` names these as visual sources. **None has ever
existed at any commit on any branch** — proved twice, by the exhaustive `.dc.html` add-list and by
a per-filename sweep of `git log --all`, both returning zero:

| Missing artifact | What the register says it covers | Consequence |
|---|---|---|
| `North Star - Work Order.dc.html` **· RECOVERED 2026-09-13** | **The approved visual source for Family 1** (`eos-north-star-sources.md:186-196`) | ~~Family 1 closed 2026-08-25 against an artifact no one here can re-read~~ → **the artifact is readable again.** The acceptance is still closed and **still unaudited** |
| `Implementation Render - Work Order.html` **· RECOVERED 2026-09-13** | The explicit pixel target for Family 1 | ~~same~~ → same correction; from `Scoping answers needed P1v2.zip` |
| `Proposed - Work Order.dc.html` **· RECOVERED 2026-09-13** | Pilot 1; **its technician run sheet is still named as reference for a later family** | ~~the technician run-sheet concept is unrecoverable~~ → **recovered and readable** |
| `Proposed - Dispatch Board.dc.html` | "Densest board; drag-scheduling with refusal reasons" | the Dispatch P1 artifact is the *elevation* of this; the base is gone |
| `Proposed - Dispatch Map.html` | Dispatch map concept | the Map tab's design intent survives only as one sentence |
| `Proposed - Technician Mobile.dc.html` | "Four moments of a field day" | **the technician handheld has no recoverable design artifact at all** |
| `Subpages - Operations.dc.html` | "Receiving, **scheduling**, exception, balances — cross-object consequence" | the cross-object scheduling consequence design is gone |
| `Proposed - Equipment.dc.html` | The superseded Equipment concept (repair economics, warranty, opportunity flagging) | survives **only** as the disposition table in frame 1e of `North Star - Equipment P1v2.dc.html` |

`EOS UX Pilot.dc.html` and `North Star - Subpage Expansion.dc.html` — the two programme reports that
establish the eight patterns, ten archetypes and the AI continuity model — are also absent. The
grammar document is a *derivative* of them, not the artifacts.

**This is the single largest recovery finding of the lane.** For Equipment, Service Operations and
Dispatch the design survives in full. For **Work Order** and **Technician Mobile** — two of the four
domains in scope — the primary design artifacts are unrecoverable, and everything below about those
routes is reconstructed from prose (`eos-north-star-sources.md`, `north-star-migration-ledger.md`,
the composition maps) rather than from a drawing. Marked **UNPROVEN** wherever it matters.

### 0.4 `.dc.html` census for this domain

Three artifacts, all present, all readable, none ever deleted:
`North Star - Dispatch Board P1.dc.html` (1a day board · 1b guarded moves · 1c honest states ·
1d implementation-reality matrix · 1e week + two-week), `North Star - Service Operations P1.dc.html`
(1a canonical · 1b clean day · 1c honest states · 1d disposition + the brief's seven answers),
`North Star - Equipment P1.dc.html` + `P1v2.dc.html` (1a–1e).

---

## 1. Authority facts — verified this lane

Each program fact was re-checked rather than inherited.

| Program fact | Verdict | Evidence |
|---|---|---|
| WO lifecycle authoritative in `transitionEngine.ts` `ACTION_PERMISSIONS`; `fieldops_wos` client writes `if false` | **CONFIRMED** | `firestore.rules:509` — `allow create, update, delete: if false` |
| Legacy `fieldops_jobs` encodes a client-writable lifecycle in Rules | **CONFIRMED** | `firestore.rules:329-334` `isValidJobTransition(from,to)`; `:343-345` `isTechnicianJobTransition`; collection block `:353`; client transaction `field-ops-app-vite/src/domain/jobActions.js:89-131` |
| No Work Order carries `operatingCompanyId`; no `workOrder.read` capability | **CONFIRMED** | grep of `functions/src/types/workOrder.ts` and the client mirror returns zero; `functions/src/access/permissionCatalog.ts` holds `workOrder.create` (`:94`), `workOrder.transition` (`:100`), `workOrder.cancel` (`:107`), `workOrder.labor.record` (`:125`), `workOrder.labor.correct` (`:133`) and **no read capability**. Visibility is `firestore.rules:507-508` — `isAdminOrDispatcher()` or `isTechnician() && isOwnTechnician(...)`, i.e. legacy role strings |
| `woNumber` can silently reuse numbers if its counter is lost | **CONFIRMED** | `functions/src/woNumbering.ts:50` — `snap.exists ? data.sequence + 1 : 1`. A missing counter restarts at 1. `counters` is `allow read: if false` (`firestore.rules:513`), so no client surface can even detect the collision |
| ADR-004 claims the technician recommendation engine has no implementation — stale; it ships | **CONFIRMED STALE** | `docs/architecture/ADR-004-technician-recommendation-engine.md:13` — *"no implementation exists yet. Nothing in `functions/src/` or `field-ops-app-vite/src/` implements any part of this ADR"*. It ships at `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts` and is consumed at `modules/dispatcherBoard/DispatcherBoard.jsx:16,210` |
| Factor C reads the compatibility collection and never the governed availability authority | **CONFIRMED** | `technicianRecommendationEngine.ts:119-127` — `AVAILABILITY_BY_STATUS` keyed on `available/on_job/off_shift`, scored from `tech.status` at `:175`. No import of `useTechnicianAvailability`, `technician_blocked_time` or `technician_working_availability` anywhere in the file. Corroborated independently by `docs/handoff/w1-c27-registrations.md` census row 7 |
| Equipment `locationId` resolves 100% into CRM `locations`, never inventory | **CONFIRMED (as a recorded census result)** | `docs/handoff/w1-c7-registrations.md:150-153` — 290/290 into `locations`, 0/290 into any inventory registry. I did not re-run the census against live data; the count itself is **UNPROVEN by this lane** |
| WO physical consumption hardcoded `trackingMode = "NONE"` until Wave 1 | **NOT RE-VERIFIED HERE** — outside this lane's files; **UNPROVEN by P3-A1** | — |
| Owner ruling: overlapping blocked time is legitimate; unavailable time is the UNION | **NOTED, AND IT OVERTURNS SHIPPED CODE** — see §4.1 | `functions/src/scheduling/schedulingCommands.ts:435-458` currently **refuses** overlap |

### 1.1 Two more stale-authority documents found by this lane

ADR-004 is not alone.

- **`docs/architecture/technician-labor-authority-gap.md:3`** — *"Status: OPEN. No labor UI was
  built… No labor collection. No time entries, no timesheet…"*. **Stale.** A governed labor
  authority ships: collection `work_order_labor_entries`
  (`functions/src/workOrderLabor/workOrderLaborCommand.ts:46`), callables in
  `functions/src/workOrderLabor/laborCallables.ts`, two registered capabilities
  (`permissionCatalog.ts:125,133`), a client transport
  (`field-ops-app-vite/src/services/workOrderLaborCallableClient.js`), a pure domain module
  (`src/domain/technicianLaborEntry.js`), an offline binding
  (`src/offline/technicianCommandBindings.js`) and a UI (`src/modules/mobile/JobLabor.jsx:24,27`).
- **`field-ops-app-vite/src/modules/equipment/AvailableEquipment.jsx:17-25`** — the file's own header
  records that it *used* to assert `inventory.serializedAsset.read` was "granted to no Role" and the
  surface "fails closed to DENIED in EVERY environment". The Equipment P1v2 design corrected the
  repository here (EQ-G1/EQ-G2), not the other way round — the only case in this domain where the
  **design** was ahead of the **code comments**.

### 1.2 "Granted to no Role" is the wrong retirement class — measured, not inherited

A coordinator correction mid-lane (sibling lane P2-B3) reported that *no* catalogued capability is
inert-and-ungranted, and that what actually denies is `active: false` plus per-environment
activation. **This lane re-measured its own three equipment capabilities directly rather than
inheriting either claim.** Result — the correction holds, and the composition map's role count was
low:

| Capability | Catalog `active` | Roles holding it (`governedBusinessRoles.ts`) | `platform-sandbox` activation |
|---|---|---|---|
| `inventory.serializedAsset.read` | **`false`** (`functions/src/access/permissionCatalog.ts:1269`) | **12** — purchasingManager, shopManager, shopAssociate, salesperson, fieldManager, generalManager, warehouseManager, warehouseAssociate, partsManager, partsAssociate, controller, inventoryLookupReader | **ACTIVATED** |
| `inventory.location.display.read` | **`false`** (`:1498`) | inventoryLookupReader | **ACTIVATED** |
| `equipment.install` | **`false`** (`:1432`) | equipmentInstaller | **ACTIVATED** |

Measured against `config/environments.json` — the `role: sandbox` environment carrying
**92** `capabilityActivationOverrides` entries contains all three; the second sandbox environment
(3 entries, cycle-count only) contains none.

**The distinction matters and is recorded here so it is not re-collapsed.** These capabilities are
**granted and inactive**, not ungranted. `active: false` is the *production* posture — a blanket
DENY lifted per environment by Owner-authorized activation, never by a role grant
(`config/environments.json`, `$capabilityActivationOverrides_comment`: *"Activation != authorization:
a persona still needs a qualifying Role grant"*). So:

- **No disposition in §2 rests on "no Role holds the capability."** Available Equipment's `IMPROVE`
  rests on the absent recovery command; the unit record's `IMPROVE` rests on **undeployed
  trusted-writer Functions** (EQ-G4 — a deployment fact, surfaced through
  `trustedActionUnavailable()` at `src/domain/equipment.js:679-688`, not a grant fact).
- The **Equipment permission claim in §2.14 is about expressibility, not grants**, and was verified
  directly: `field-ops-app-vite/src/access/objectPermissionMap.js:92` —
  `{ object: "Equipment / Installed Base", rulesOnly: "equipment", C: [], R: [], E: [], D: [] }`.
  Equipment's permissions are not expressible as capabilities **at all**, which is a third and
  distinct condition from both "ungranted" and "inactive".
- The composition map's *"granted to eight governed Roles"* is itself now a **stale figure** — the
  count is 12 for the read capability. Low by four, in the same direction as every other stale claim
  in this domain (§1.1): understating what exists.

**Pattern worth naming: in this domain, the stale claim is always "it does not exist."** Three
documents asserted absence; all three shipped. No document was found over-claiming a capability.

---

## 2. Reconciliation entries

Route→component resolution is by `field-ops-app-vite/src/App.jsx` (explicit branches at `:409-560`)
over `field-ops-app-vite/src/navigation/navConfig.js` (the `service`, `equipment` and
`serviceOperations` domains at `:151-283`).

---

### 2.1 PAGE / ROUTE — `/service-operations` (internal key `controlTower`)

**ORIGINAL CLAUDE DESIGN** — `North Star - Service Operations P1.dc.html` 1a–1d +
`DESIGN-HANDOFF-SERVICE-OPERATIONS-P1.md` + `README.md`.

- *Primary question*: "what needs a decision before the board or the record" — the cross-cutting
  exceptions read for Admin + Dispatcher. Archetype: **Overview** (one of the grammar's ten,
  `eos-north-star-design-grammar.md:157-165`).
- *Facts shown*: an attention block with severity word · plain-language fact with the WO reference
  bold · account · owner · deep link; a 4-cell metric strip (Awaiting dispatch / In progress /
  Technicians on shift / Completed this week), **every number linked and carrying an exception
  count**; an At-risk table (WO · account · severity · age · why · technician); a Technician-load
  table (technician · status · active WOs · load); a suggestion tray; an Activity rail.
- *Proposed actions*: **none governed.** Header cluster is navigational, `Open Dispatch Board` the
  single filled primary. "No optimistic writes, no mutations anywhere on this page."
- *Workflow*: ordering law `kicker → header → attention → work → rail`; attention renders **nothing**
  when clean (frame 1b: "silence is the designed clean state").
- *Composition*: `1fr 300px`, 40px gap, ~1240px max; tables never wrapped in cards; 32px rows;
  numerals Inter tabular right-aligned; one filled primary per surface.
- *Mobile behaviour*: **none designed.** The artifact ships one frame width (desktop 1440). This is
  a real hole — the Sales Agreement family was drawn at 1440/768/375 and this one was not.
- *Intelligence / AI*: one suggestion tray, amber ruled, "Recommended dispatch — n open, m
  placeable", each row `WO → technician (score + reasons)`, no-candidate rows stating why. Footer:
  *"Suggestions are read-only here. Assignment is the governed command on the Dispatch Board —
  reasons always shown, accept with undo there."* One suggestion slot per page, per the AI trust
  contract (`eos-north-star-design-grammar.md:197-203`).
- *Exception handling*: frame 1c — loading withholds counts ("A zero is only reported when zero is
  known"); WO read failure says *"Your work elsewhere is unaffected."*; technician read degrades
  **independently** and says so.
- *Suggested new capability/workflow*: **SO-G5** — wire `partsReadinessByWorkOrderId` into this page
  so the Parts Blocked attention section can populate. **SO-D4** — build a windowed "completed this
  week" read.
- *Unresolved design gaps*: SO-D1 (should the page exist at all — delete remains on the table),
  SO-G1 (unknown age), SO-G2, SO-G3 (activity is a snapshot derivation, not an audit log), SO-G4.

**WHAT ACTUALLY GOT BUILT** — **IMPLEMENTED, and Owner-accepted** (migration ledger Family 6,
`docs/design/north-star-migration-ledger.md:952-1035`).

- Composition root `src/modules/controlTower/ControlTower.jsx`; derivations in
  `src/domain/serviceOperationsNorthStar.js`; six panels under `modules/controlTower/panels/`.
- Verified present: attention (`panels/WorkOrderAttentionPanel.jsx:71-73` `aria-label="Needs
  attention"`), metric strip (`serviceOperationsNorthStar.js:197,208,218,230`), At risk
  (`panels/AtRiskPanel.jsx:21-23`), Technician load (`panels/TechnicianLoadPanel.jsx:22-24`),
  suggestion tray (`panels/DispatchQueuePanel.jsx:33-35` `aria-label="Recommended dispatch"`),
  activity rail (`panels/ActivityTimelinePanel.jsx:5-8`), ordering law
  (`ControlTower.jsx:203-243`), degradation notice (`ControlTower.jsx:190-196`).
- **Replaced, not built as drawn — nine items.** The composition map
  (`service-operations-north-star-composition-map.md`, "the nine rulings") rejected every drawn
  element the page would have had to *invent*: SO-N1 severity words on attention rows; SO-N2 an
  "Urgent" section that double-counted; SO-N3 a per-entry clock time (`timelineBuilder` stamps every
  milestone with the same `createdAt` — three milestones, one identical time); SO-N4 an Owner per
  row (`recipientRole` is a role, not a person); SO-N5 an actor on activity entries; SO-N6 a
  technician-preselected board link (no URL seam); SO-N7 "Technicians on shift" over
  `technicians.length` (includes `OFF_SHIFT`); SO-N8 the route `/work-orders/:id` (**does not
  exist** — the governed route is `/service/work-orders/:id`); SO-N9 "past readiness" (not a
  repository fact under any name).
- **Obsolete**: the five-tile stat grid, the bare ⚠ div, the WO card wall, per-card
  `WorkOrderActions`.
- **Dead but not deleted**: `modules/controlTower/panels/PartsOverviewPanel.jsx` has **no caller in
  `src/`** (only `test/workOrderSnapshotNames.test.jsx:26` imports it) — SO-D3's dead-code decision
  was never executed. `modules/controlTower/WorkOrderDetail.jsx` likewise has no `src/` caller;
  `WorkOrderActions.jsx` survives because `modules/workOrders/WorkOrderDetailPage.jsx:17,306` uses it.
- **Never built**: SO-G5's parts-readiness read. The slot renders its honest line verbatim
  (`panels/WorkOrderAttentionPanel.jsx:92`).

**CURRENT EOS AUTHORITY**

- *Canonical objects*: Work Order (`fieldops_wos`), Technician (`fieldops_technicians`), Account.
- *Commands*: **none on this page, by design.**
- *Workflow / state machine*: read-only projection of `transitionEngine.ts`'s statuses via
  `domain/fieldWorkOrder.js` phases.
- *Capabilities*: none. Reach is `firestore.rules:507-508` — the legacy role strings
  `isAdminOrDispatcher()` / `isTechnician()`.
- *Ownership*: none modelled. SO-N4 is the design consequence of that absence.
- *Operating company*: absent. Work Orders carry no `operatingCompanyId`, so this page cannot scope
  to a company and does not claim to.
- *PostgreSQL authority*: none. No scheduling or work-order table exists —
  `docs/handoff/w1-c27-registrations.md` §1 records that migration id `1760140800000` was reserved
  for this domain and **deliberately not used**.
- *Remaining Firebase dependency*: total. Three `onSnapshot` reads (`useWorkOrders`,
  `useFirestoreCollection(TECHNICIANS_COLLECTION)`, `useAccountNames`).
- *Unknowns*: whether the Owner still wants the page at all (SO-D1 was ratified as "keep", but the
  delete option was explicitly left open).

**NEW OPPORTUNITIES**

1. The attention block is the only cross-object exception surface in EOS. It currently reads Work
   Orders only. Parts readiness (SO-G5) is the named next feed; **equipment warranty expiry**
   (`warrantyExpiresDate` exists and is governed) and **blocked-time collisions with placed work**
   (the governed-scheduling doc explicitly says "the board surfaces the collision; a person decides"
   — but no surface does) are two more the projection could carry with no new authority.
2. `detectOverloadedTechnicians` decides overload from active WO count alone. The governed
   `availableMinutes` denominator now exists (`readTechnicianAvailability`) — overload could become
   a truthful capacity statement rather than a headcount heuristic.

**SCENARIO / OPERATIONAL QUESTIONS**

- A dispatcher sees "2 stalled". Whose stall is it? The page shows the technician but no owner,
  because no ownership model exists. Who is accountable for an exception that nobody is assigned?
- The Activity rail says "Derived from the loaded work-order snapshot — not an audit log." An
  `auditEvents` authority **does** exist and scheduling commands write to it. Why does the
  operations page read a derivation when the audit authority is real?

**DESIGN P2 DISPOSITION: `IMPROVE`**
The page is genuinely built, genuinely honest, and Owner-accepted. It is not KEEP because two named
slots are inert (SO-G5) or provably lossy (SO-G7, §4.2), and because it has no mobile composition at
all.

---

### 2.2 PAGE / ROUTE — `/service/dispatcher-board`

**ORIGINAL CLAUDE DESIGN** — `North Star - Dispatch Board P1.dc.html` (1a/1b/1c/1d/1e) +
`DESIGN-HANDOFF-DISPATCH-BOARD-P1.md`. Archetype: **Board/scheduler**.

- *Primary question*: where does this work go, and who has room for it.
- *Facts shown*: a workload sentence ("3 unassigned in the ready queue · 1 past due needs a new
  window · fleet booked 64%"); an hour-header lane grid (170px identity + 7a–4p), one lane per
  technician; WO chips (reference + type / customer); **hatched blocked-time chips**; a per-lane
  shift + %-booked + blocked line; a "Ready to schedule" queue with priority word, reference,
  duration/type, resolved customer, attention note and the top recommendation with its score.
- *Proposed actions*: **drop = the governed transition.** Queue→lane schedules; lane→lane reassigns;
  lane→queue unassigns. A typed reason gates reassignment (Owner ruling H20). A "Dispatch to…"
  picker is the accessible equivalent of drag.
- *Workflow*: nothing writes optimistically; the subscription is the refresh; only eligible work
  presents drop targets; refusals arrive in words, never codes; double-drop guarded.
- *Composition*: context line → rule pair → serif title + workload sentence → view switcher
  (Day · Week · 2 weeks · Map) + technician picker → lane grid → queue → board rules + session feed.
- *Mobile behaviour*: **none designed** — 1440 only. The handoff names 44px touch targets (ND-6) and
  keyboard nav (↑↓/Esc) but draws no phone composition for the densest surface in EOS.
- *Intelligence / AI*: informational ranking — *"Rankings are visible scores that never hide or
  reorder technicians away."* Per the grammar's AI model the Dispatch board's role is
  "Recommended action — placements you accept/undo" (`eos-north-star-design-grammar.md:186`).
- *Exception handling*: 1c — loading skeletons; WO read failed (never a false-empty board);
  technician read failed with its own sentence; queue clear as *good news*, distinct from empty;
  schedule-data-absent interim; denied ("nothing leaks"); dispatch in progress.
- *Suggested new capability/workflow*: **DB-D1** governed shift records + a schedule-window write
  from a board drop; **DB-D2** a blocked-time record type.
- *Unresolved design gaps*: ND-3 (no undo, no reverse command); "recommendation reasons beside
  scores = VERIFY AUTHORITY"; Map view rides on DB-D1 + location reads.

**WHAT ACTUALLY GOT BUILT** — **IMPLEMENTED and Owner-accepted on live interactions**
(`north-star-migration-ledger.md:881-950`, accepted deployed commit
`36280c306188b725ac549a4e31ef321b20abb0ac`, 2026-08-29).

- Every file the composition map planned exists: `modules/dispatcherBoard/DispatchLaneGrid.jsx`,
  `DispatchViews.jsx` (week/fortnight/map), `ReadyToScheduleQueue.jsx`, `PlacementDialog.jsx`,
  `TechnicianFilter.jsx`, plus `services/schedulingCommandClient.js`,
  `hooks/useTechnicianAvailability.js`, `domain/dispatchBoardGeometry.js`,
  `domain/schedulingRefusal.js`.
- View switcher Day/Week/2 weeks/Map: `DispatcherBoard.jsx:101,583,606,634,645`;
  `DispatchViews.jsx:36-37,81,329-331`.
- Hatched blocked chips from real `startMillis`/`endMillis` with governed `kind` labels:
  `DispatchLaneGrid.jsx:129-136`.
- Honest capacity: `DispatchLaneGrid.jsx:271-283` — `"Shift not recorded"` and **no percentage**
  when `percentBooked == null`. The two-week grid renders a dash, not 0% (`DispatchViews.jsx:246`).
- **The artifact's own interim renderings are obsolete and were correctly not built.** The
  composition map's headline is the archaeological fact worth preserving: *"The artifact was drawn
  ~14 hours before the authority it was waiting for existed."* `Dispatch and Schedule North Star
  P1v1.zip` is timestamped 2026-08-27 04:54; PR #1549 (the governed scheduling domain) merged 18:45
  the same day. So DB-D1 and DB-D2 were `PRODUCT BUILD` in the artifact and **governed and certified**
  by the time it was implemented.
- **Rejected**: the artifact's reading that a drop is a `Dispatch`. A queue Work Order is
  `READY_TO_DISPATCH` with no window; the gesture drawn is a **Schedule**. The map of gesture →
  command is `dispatch-north-star-composition-map.md` ("Drop gesture — Dispatch vs Schedule").
- **Narrowed, not repealed**: ND-3's "no undo". ND-18 admitted `SCHEDULED → READY_TO_DISPATCH`, the
  first reverse edge in ADR-002. ND-3 still holds from `DISPATCHED` onward.
- **Never built**: the Map view's content. `DispatchViews.jsx:254-267` renders the tab and states
  truthfully that location-based dispatch is not available. **DB-G1** — the queue's "past due" note
  — remains unbuildable: there is no due-date model for unscheduled work.
- **Added after the fact, and worth recording**: the technician selector. Frame 1a drew
  `All technicians (n) ▾`; the first build omitted it, and the omission only became visible on the
  *deployed* board where 24 lanes pushed the queue below the fold. `TechnicianFilter.jsx`; "All" is
  a `null` sentinel, not a set of every id, so a new technician is never silently filtered out.

**CURRENT EOS AUTHORITY**

- *Canonical objects*: Work Order; `technician_working_availability/{technicianId}` (doc id **is**
  the technician id — two disagreeing schedules are unrepresentable,
  `functions/src/scheduling/schedulingCommands.ts:377`); `technician_blocked_time/{blockId}`
  (closed `kind` vocabulary: PTO/LUNCH/TRAINING/MEETING/TRUCK_SERVICE/UNAVAILABLE/COMPANY_CLOSURE).
- *Commands*: `transitionWorkOrder` actions `Schedule`, `Dispatch`, `Unschedule`;
  `rescheduleWorkOrderCallable`; `reassignScheduledWorkOrderCallable`;
  `setWorkOrderEstimatedDurationCallable`; `setTechnicianWorkingAvailability`;
  `createTechnicianBlockedTime`; `deleteTechnicianBlockedTime`; read projection
  `readTechnicianAvailabilityCallable` (`functions/src/scheduling/schedulingCallables.ts:53-62`).
- *Workflow / state machine*: `ACTION_ALLOWED_FROM` is the third table that stops `MarkReady`
  becoming a silent second unschedule path. Re-timing is deliberately **not** a transition;
  un-scheduling **is** (`governed-scheduling-domain.md`, "The one structural decision worth reading
  twice").
- *Capabilities*: **none registered.** Authorization is role-based `admin`/`dispatcher` via
  `ACTION_PERMISSIONS` and `requireDispatcher` (`schedulingCommands.ts:82-91`), matching the existing
  convention rather than opening a second pattern.
- *Ownership*: `ownershipMatrix.ts:445` excludes technicians as "person authority — a subject of
  ownership, not an object". Neither availability collection appears in the matrix at all.
- *Operating company*: **absent and unenforced.** `docs/handoff/w1-c27-registrations.md` census row
  5: `operatingCompanyId` appears nowhere in `functions/src/scheduling/`,
  `technicianRecommendationEngine.ts` or `dispatchBoardGeometry.js`. **A cross-company placement
  would not be refused.**
- *PostgreSQL authority*: **none built.** Migrations end at
  `1757980800000_operating-company-and-serialized-custody.sql`; no scheduling table exists. The
  eventual shape is named: a `tstzrange` exclusion constraint (`w1-c27-registrations.md` census
  row 13).
- *Remaining Firebase dependency*: total. Firestore + seven `onCall` adapters. Both availability
  collections `allow read, write: if false` (`firestore.rules:1773,1776`), so the board's *only*
  path to them is the trusted callable (`hooks/useTechnicianAvailability.js`).
- *Unknowns*: whether the Rules blocks are live in **production**. The governed-scheduling doc
  records the sandbox as proved (403 on a client ID token) and production as still carrying the
  caveat that `firestore.rules` has no CI deploy. **UNPROVEN by this lane** — no production contact.

**NEW OPPORTUNITIES**

1. **Make the recommendation engine consult the availability authority it sits next to.** Today the
   board draws a technician's PTO as a hatched chip *and* recommends them at availability 100 in the
   same viewport, because factor C reads `fieldops_technicians.status`
   (`technicianRecommendationEngine.ts:119-127,175`) and the chip reads
   `technician_blocked_time`. One screen, two disagreeing answers to "is this person available".
2. `setWorkOrderEstimatedDurationCallable` exists and the board has a queue card with no duration
   for work that has never been placed. Wiring it closes the "a dispatcher dragging from the queue
   must still state an end time" friction the authority map named.
3. Blocked time is deliberately *not* checked against existing placed work when recorded — "the
   board surfaces the collision; a person decides." **Nothing surfaces it.** That is the cheapest
   unbuilt safety feature in the domain.

**SCENARIO / OPERATIONAL QUESTIONS**

- A technician records PTO for Thursday. Three Work Orders are already placed inside it. The write
  succeeds by design. Who is told, and on what screen?
- Two operating companies, one technician roster, no company gate on placement. When Taylor and
  Ventana share a dispatcher, what stops a Ventana job landing on a Taylor-only technician?
- `rescheduledFrom*` is a single denormalized slot; a second reschedule overwrites the first. The
  board reads it. Does any surface say "this is the latest change, not the history"?

**DESIGN P2 DISPOSITION: `IMPROVE`**
The board is the most completely realised design in the domain and it was accepted on live governed
writes, not on a screenshot. It is not KEEP because its own AI factor contradicts its own
blocked-time rendering, and because `blockedMinutesInBand` now computes the wrong quantity under
tonight's Owner ruling (§4.1).

---

### 2.3 PAGE / ROUTE — `/service/scheduling` (navHidden) and `/service/dispatch-scheduling` (navHidden)

**ORIGINAL CLAUDE DESIGN** — no North Star artifact. The design of record is
`docs/design/work-order-scheduling-workspace.md` (2026-08-06, `d124714e`): a weekly dispatcher board
(technician rows × 7 day columns, Mon–Sun) built to fix a concrete defect — *"Control Tower's one
live 'Schedule' button fired `transitionWorkOrder("Schedule")` with an empty payload, which the
backend rejected with `invalid-argument`"*. Deliberate boundaries as written: **no re-scheduling**,
no drag/drop, no optimizer, no route/drive-time/capacity/skill matching. A second surface,
`DispatchSchedulingWorkspace` (day board, 15-minute snapping, 06:00–19:00), was added later as an
explicitly **additive** Wave-7 workspace (`App.jsx:495-499`).

**WHAT ACTUALLY GOT BUILT** — both shipped and both are now **OBSOLETE**.

- `modules/scheduling/SchedulingWorkspace.jsx` and `modules/dispatch/DispatchSchedulingWorkspace.jsx`
  exist and are still routed. `navConfig.js:279-281` marks them `navHidden` with a comment that the
  route generator does not check the flag, *"so every URL still resolves and every component still
  renders"*.
- Both still write through `transitionWorkOrder("Schedule", …)` only
  (`DispatchSchedulingWorkspace.jsx:165`; `SchedulingWorkspace.jsx:22`).
- **Their headers now state things that are false.** `SchedulingWorkspace.jsx:25` —
  *"already-SCHEDULED time (true 'reschedule') is NOT a deployed transition"*. `rescheduleWorkOrder`
  has been a deployed, certified callable since 2026-08-27.

**CURRENT EOS AUTHORITY** — same objects and the same `Schedule` action as §2.2, minus every command
added by the governed scheduling domain. No capabilities, no operating company, no Postgres, full
Firebase dependency. Reachable by direct URL by anyone `PLACEHOLDER_DEFAULT_ROLES` admits
(admin/dispatcher) regardless of the nav flag.

**NEW OPPORTUNITIES** — deleting two of the three boards is a net reduction in surface area, test
burden and dispatcher confusion, and requires no new authority.

**SCENARIO / OPERATIONAL QUESTIONS** — three scheduling boards exist at three URLs against one
authority. Which one does a dispatcher open, and who told them?

**DESIGN P2 DISPOSITION: `REMOVE`**
Superseded by the accepted North Star board. Hidden-but-routed is not retirement; a stale surface
that still writes governed data and carries an out-of-date claim about the state machine in its own
header is a liability, not a fallback.

---

### 2.4 PAGE / ROUTE — `/service/dispatch` ("Jobs") and `/service/job-assignments`

**ORIGINAL CLAUDE DESIGN** — none recovered. These are pre-North-Star surfaces on the legacy Job
model. `EPIC-6-Technician-Execution-Workspace.md` §2.1 is the closest thing to a design record and
it describes them as what the platform was migrating *away from*.

**WHAT ACTUALLY GOT BUILT** — `modules/dispatch/Dispatch.jsx` and `modules/jobs/Jobs.jsx`, both
still routed, `jobAssignments` still **visible in nav** (`navConfig.js:204`).

- `Dispatch.jsx:117` calls `transitionWorkOrder(job.id, "Dispatch", …)` — partly migrated.
- `domain/jobActions.js:89-131` is a **client-side transaction** writing `fieldops_jobs.technicianId`
  / `.status` and `fieldops_technicians.status` directly. The only thing between a browser and a
  dispatch assignment is `isAdminOrDispatcher()` at `firestore.rules:373-395` and `:418`.
- The lifecycle itself is in Rules: `isValidJobTransition` (`firestore.rules:329-334`) and
  `isTechnicianJobTransition` (`:343-345`).
- The client guard reads `TECH_STATUS` before writing (`jobActions.js:110-123`) — inside
  `runTransaction`, so Firestore does serialize it correctly, **on a field that is frequently wrong**
  (`w1-c27-registrations.md` Q2.3).

**CURRENT EOS AUTHORITY**

- *Canonical object*: `fieldops_jobs` — the **compatibility** representation, not the governed one.
- *Commands*: none. Direct client writes.
- *Workflow / state machine*: **in Firestore Rules.** This is the prohibited class: authorization,
  workflow and assignment routing expressed as Rules predicates.
- *Capabilities*: none. `callerTechnicianId()` (`firestore.rules:325`) routes both visibility
  predicates through the technician-identity key space.
- *Operating company*: absent.
- *PostgreSQL authority*: none.
- *Firebase dependency*: total, and uniquely load-bearing — this is the one surface whose
  **business rules** are a Firebase artifact.

**NEW OPPORTUNITIES** — retiring `fieldops_jobs` removes an entire client-writable lifecycle from the
attack surface and deletes ~15 lines of workflow from `firestore.rules`.

**SCENARIO / OPERATIONAL QUESTIONS** — a Work Order and a Job can describe the same physical visit.
Which one is the record when they disagree? Nothing in the domain answers this.

**DESIGN P2 DISPOSITION: `AUTHORITY GAP`**
Not REMOVE, because these routes are live and reachable and something still depends on the Job
model; the gap is that the *lifecycle authority for a nav-visible production surface lives in
Firestore Rules*, which no design in this domain ever sanctioned.

---

### 2.5 PAGE / ROUTE — `/service` (Work Orders list)

**ORIGINAL CLAUDE DESIGN** — Lists P2 grammar (`docs/north-star/lists/`), which is the cross-family
list authority rather than a Work Order artifact. No Work-Order-specific list design was recovered.

**WHAT ACTUALLY GOT BUILT** — **IMPLEMENTED** in the Lists P2 grammar.
`modules/workOrders/WorkOrdersList.jsx:1-30` composes `useMetadataList`, `useListCriteria`,
`useListViewChrome`, `MetadataListGrid`, `ListViewHeader` + `CollectionResultContext`, `AddFilter`,
`SortControl`, `ActiveCriteria`, `DroppedCriteriaNotice`, `WorkspaceIdentity`, `HonestState`.

**CURRENT EOS AUTHORITY** — Work Order; no commands from the list; reach by role string
(`firestore.rules:507-508`); no `workOrder.read` capability; no operating company; no Postgres; full
Firebase.

**NEW OPPORTUNITIES** — the list is the natural home for the windowed "completed this week" read
SO-D4 wants and Service Operations cannot make.

**SCENARIO / OPERATIONAL QUESTIONS** — a technician opening this list sees their own work by Rules
predicate. Is a technician-scoped list the same product as a dispatcher-scoped one, or two?

**DESIGN P2 DISPOSITION: `KEEP`**

---

### 2.6 PAGE / ROUTE — `/service/work-orders/:workOrderId` (the Work Order record)

**ORIGINAL CLAUDE DESIGN** — ~~**UNRECOVERABLE.**~~ **RECOVERED 2026-09-13.**

> The original verdict is struck through, not deleted. The original sentence, preserved verbatim:
> *"`North Star - Work Order.dc.html` and `Implementation Render - Work Order.html` are named as the
> approved visual source and the pixel target (`eos-north-star-sources.md:186-196`) and **have never
> existed in this repository** (§0.3)."* **Every word of that re-verifies today** — neither has ever
> been in any commit on any branch. Both were recovered from delivery archives outside it and now sit at
> `docs/design-history/recovered/Scoping/`. **The word "UNRECOVERABLE" was never justified by a
> git-scoped method** (see the register §1.4); the defensible word was, and is, *unavailable*.
>
> **RECOVERED HISTORICAL DESIGN EVIDENCE** — **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not proof that current EOS still conforms.** **The prose below remains the only evidence for what was quoted from the artifact; it has
> not been re-checked against the recovered file.** Family 1 is still closed 2026-08-25 and **no
> conformance audit has been run** — recovering the yardstick is not measuring with it. See `docs/design-history/recovered/RECOVERY-MANIFEST.md` and the recovery index at `historical-acceptance-evidence-register.md` §0.4.

What survives in this document is prose, and it is quoted as evidence *about* the artifact:

- The artifact's own masthead is quoted: *"live truck-stock reads · WO naming service · notification
  channel · suggestion engine. None exist today."*
- The implementable rule it produced, which became family-wide law:
  **"KEEP THE DESIGNED STRUCTURAL SLOT. RENDER A TRUTHFUL STATE IN IT. NEVER FABRICATE THE CONTENT."**
- A suggestion strip, a dispatcher-context section and a first-visit-fix slot are named as
  structural slots that keep their position and geometry.
- `eos-north-star-design-grammar.md:216-218` forbids copying "the horizon Work Order's live numbers —
  ETAs, confidence percentages and first-visit-fix rates", calling shipping them without the
  services behind them "the most damaging possible outcome: a fabricated number in an operations
  system."
- ND-1 (which model owns Work Order history), ND-2 ("Repair" is not a governed WO type), ND-4, ND-5,
  ND-6 remain open; ND-3 answered with behaviour deferred; ND-7 resolved as a sentence.

Everything else about the original design — primary question, mobile behaviour, exception handling,
composition — is **UNPROVEN** and unrecoverable from this repository.

**AMENDED 2026-09-13.** That sentence stands as written about *this repository*. It is no longer the
whole picture: those questions are now answerable by reading the recovered artifact directly at
`docs/design-history/recovered/Scoping/`. **This lane did not read it and did not answer them** — the
prose above remains prose evidence only, unreconciled against the recovered file.

**WHAT ACTUALLY GOT BUILT** — **IMPLEMENTED and closed** (Family 1, closed 2026-08-25,
`north-star-migration-ledger.md:32-56`). `modules/workOrders/WorkOrderDetailPage.jsx` over
`domain/workOrderNorthStar.js`, with six proof suites. The ledger also records that this family's own
falsifiable-contract suite (`test/workOrderNorthStar.test.mjs`) was registered in neither
`suites.json` nor any workflow, so **the family was closed partly on a CI run that never executed
it** — now fixed by `test/ciSuiteCoverage.test.mjs`.

**CURRENT EOS AUTHORITY**

- *Canonical object*: `fieldops_wos`.
- *Commands*: `createWorkOrder`, `transitionWorkOrder`, `updateWorkOrderExecutionData`, plus the
  scheduling callables and the labor callables.
- *Workflow*: `transitionEngine.ts` — `TRANSITIONS`, `ACTION_TO_STATUS`, `ACTION_PERMISSIONS`,
  `ACTION_ALLOWED_FROM`, mirrored at `domain/workOrderWorkflow.js` and pinned by
  `workOrderWorkflowMirrorContract.test.mjs`.
- *Capabilities*: `workOrder.create`, `.transition`, `.cancel`, `.labor.record`, `.labor.correct`.
  **No read capability exists.**
- *Ownership*: none.
- *Operating company*: **no Work Order carries `operatingCompanyId`.**
- *PostgreSQL*: none.
- *Firebase*: total.
- *Unknowns*: `woNumber` uniqueness. There is no unique constraint anywhere and
  `woNumbering.ts:50` restarts at 1 if the counter document is lost, while `counters` is unreadable
  by any client (`firestore.rules:513`) so the collision is undetectable from the product.

**NEW OPPORTUNITIES** — `work_order_labor_entries` now exists with correction semantics (the original
is never deleted; it keeps its author and gains a pointer to its replacement,
`permissionCatalog.ts:133`). The record page is where that belongs and the labor UI currently lives
only on the handheld (`modules/mobile/JobLabor.jsx`).

**SCENARIO / OPERATIONAL QUESTIONS** — two operating companies, one Work Order collection, no
company field, visibility by role string. How does a Ventana dispatcher fail to see Taylor work?

**DESIGN P2 DISPOSITION: `AUTHORITY GAP`**
The page renders and was accepted, but the object under it carries no operating company and no read
capability, and its business key can silently collide. The design that would let anyone check the
composition against intent is gone.

---

### 2.7 PAGE / ROUTE — `/service/work-orders/new` (the create wizard)

**ORIGINAL CLAUDE DESIGN** — none recovered. The grammar's **Create/edit** archetype
(`eos-north-star-design-grammar.md:157-165`) is the only authority; no artifact draws it.

**WHAT ACTUALLY GOT BUILT** — `modules/workOrders/WorkOrderWizard.jsx` over
`domain/workOrderWizard.js`, with an idempotency-key holder, `equipmentAllowedAtCreate`, a customer
picker and an equipment picker (`WorkOrderWizard.jsx:1-17`).

**CURRENT EOS AUTHORITY** — `createWorkOrder` callable + `workOrder.create` capability; `woNumber`
allocated in-transaction; no operating company assigned at creation; no Postgres; full Firebase.

**NEW OPPORTUNITIES** — creation is the only point at which operating company could be captured
without a backfill. ND-21's `estimatedDurationMinutes` is likewise cheapest here.

**SCENARIO / OPERATIONAL QUESTIONS** — a wizard that cannot ask which company owns the work is a
wizard that guarantees a backfill later.

**DESIGN P2 DISPOSITION: `UNKNOWN`**
No design authority was ever produced for this route, so there is nothing to reconcile against. That
is itself the finding.

---

### 2.8 PAGE / ROUTE — `/service/inbound-work`

**ORIGINAL CLAUDE DESIGN** — Family 12 (Email & Communications + Inbound Work),
`north-star-migration-ledger.md:1998-2093`. Design artifacts for Family 12 are outside this lane's
four domains; the route is listed here because it sits in the Service domain and feeds work-order
creation.

**WHAT ACTUALLY GOT BUILT** — `modules/service/InboundWorkWorkspace.jsx`, routed at `App.jsx:482-484`,
capability-gated `service.inboundWork.read` (`navConfig.js:198`). **Accepted** by the Owner
2026-09-06 and deployment CLOSED (ledger `:2067`, `:2093`).

**CURRENT EOS AUTHORITY** — capability-gated (`service.inboundWork.read`) — notable as the **only
surface in this domain whose reach is a capability rather than a role string**.

**DESIGN P2 DISPOSITION: `KEEP`**

---

### 2.9 PAGE / ROUTE — `/service/coordinated-visits` and `/service/coordinated-mission`

**ORIGINAL CLAUDE DESIGN** — `docs/design/coordinated-field-mission-cycle9.md` and
`sales-order-to-service-cycle7.md`. The mission design: ONE shared customer/location context carried
from a coordinated visit with divergence surfaced; per-equipment units, one row per Work Order, with
**independent execution authority preserved, not merged for presentation**; honest readiness — a unit
is READY only when parts are READY *and* the truck load is verified, and missing evidence is
**UNKNOWN, never a fake READY**; coordinated load readiness; overall mission readiness as
worst-known, PARTIAL when some units are done.

The design document states its own status plainly: *"The consuming Field/Dispatch UI is deferred
(data pipeline is inert until grants/deploys; UX synthesis owns final placement)."*

**WHAT ACTUALLY GOT BUILT** — the projection
(`functions/src/fulfillment/coordinatedFieldMission.ts`) **and** two consuming surfaces that the
design said were deferred: `modules/service/CoordinatedVisitsWorkspace.jsx` and
`modules/mobile/CoordinatedMissionView.jsx`, routed at `App.jsx:505-511`. `App.jsx:503` records them
as *"user-consumable reads of the already-built projections… Read-only synthetic source; no authority
invented, nothing written."*

**CURRENT EOS AUTHORITY**

- *Canonical objects*: none of its own. A coordinated visit is a **projection**, not a record — the
  C8 conclusion was explicitly "no Job/Visit/WorkOrderGroup authority".
- *Commands*: **none.** Nothing can be done on either screen.
- *Workflow*: the Sales Order coordinates; Work Orders keep independent execution authority.
- *Capabilities / ownership / operating company / Postgres*: none.
- *Firebase*: reads only.
- *Unknowns*: whether the SO→Service pipeline is granted/deployed anywhere. The design says the
  pipeline is inert until grants/deploys land; I did not verify deployment state. **UNPROVEN.**

**NEW OPPORTUNITIES** — the three high-value journeys the design names are still untested:
a dispatcher coordinating a five-unit install with one blocked unit; a technician executing one
coordinated visit with multiple equipment Work Orders; the Sales Order → Service → field-completion
journey.

**SCENARIO / OPERATIONAL QUESTIONS** — five Work Orders, one truck, one customer site. The mission
view shows PARTIAL. What command moves it forward? There isn't one.

**DESIGN P2 DISPOSITION: `WORKFLOW GAP`**
Two routes render a governed, honest, well-designed read over a capability with **no command
surface at all**. This is precisely the "a route that renders beautifully over an inert capability"
case.

---

### 2.10 PAGE / ROUTE — `/service/warranty` (navHidden)

**ORIGINAL CLAUDE DESIGN** — none. The word "warranty" appears in the Equipment design as the
`warrantyExpiresDate` field (EQ-D2, closed) and explicitly **not** as a workflow: *"No derived
semantics (in/out of warranty, days remaining, provider, coverage)."*

**WHAT ACTUALLY GOT BUILT** — nothing. `navConfig.js:281` declares the item `navHidden`; `App.jsx`
has no branch for it, so it falls through to `PlaceholderPage` (`App.jsx:161`, generic branch at
`:826`).

**CURRENT EOS AUTHORITY** — one governed Equipment field, `warrantyExpiresDate`. No claim, no
coverage model, no provider, no service-under-warranty concept anywhere.

**NEW OPPORTUNITIES** — warranty expiry is a date EOS already holds on an installed unit, on a
customer site, that a Work Order can be raised against. It is the most complete unexploited fact in
the domain.

**SCENARIO / OPERATIONAL QUESTIONS** — a technician replaces a compressor. Is it warranty work? EOS
cannot answer, and cannot bill differently for the answer.

**DESIGN P2 DISPOSITION: `PRODUCT GAP`**

---

### 2.11 PAGE / ROUTE — `/service/technician-workspace` (the handheld)

**ORIGINAL CLAUDE DESIGN** — the artifact, `Proposed - Technician Mobile.dc.html` ("four moments of a
field day"), is **UNRECOVERABLE** (§0.3). The design that survives is the grammar's **Handheld
model** (`eos-north-star-design-grammar.md:167-179`), which is unusually specific and reads as a
distillation of the missing artifact:

- *Primary question*: what do I do next, here, now.
- *Composition*: "Language inherited, composition rebuilt" — explicitly **not** compressed desktop.
  Dark condensed header, status inline; **one filled action per screen**; 44px+ targets; scan-first
  tab bar; tables become labelled stacks; bottom bar holds 1–2 actions.
- *Workflow*: **"A route, not a list"** — pickups appear as route steps and the next action is the
  only filled button.
- *Mobile behaviour*: **offline-first with a visible sync queue** — "every write queues and syncs —
  the sync state is always visible."
- *Exception handling*: **"Honest exits are first-class"** — *"Could not complete…"* sits beside
  Complete. **"Unplanned parts flag variance, never block the job."**
- *Intelligence / AI*: the handheld is not in the AI model's table at all; the adjacent Scanner and
  cycle-count rows are marked **Quiet** ("suggestions would bias counts").
- *Suggested new capability*: mode before capture (use / look up / return).

**WHAT ACTUALLY GOT BUILT** — **IMPLEMENTED, and the Epic-6 platform migration completed.**

- `App.jsx:513-522`: **"WIDTH CHOOSES COMPOSITION, NEVER AUTHORITY."** `TechnicianWorkspaceSurface`
  (`App.jsx:839`) renders `TechnicianShell` on a phone and `FieldMode` on desktop; both resolve
  capability identically and read the same technician-scoped Work Orders. The comment records that
  `TechnicianShell`, built in WO-02 for exactly this, "was reachable from nowhere at all" before.
- `FieldMode.jsx` is **no longer Job-based** — it imports `transitionWorkOrder` (`:4`) and calls it
  (`:140`) against `fieldops_wos`. EPIC-6 §2.1's premise is discharged.
- Offline-first is real: `OfflineRuntimeProvider` / `useOfflineRuntime` (`TechnicianShell.jsx:31,48`),
  a visible sync queue (`modules/mobile/SyncQueue.jsx`, surfaced at `TechnicianShell.jsx:110-113,
  205, 212-214` with an "n not sent" count), and `offline/technicianCommandBindings.js`.
- Labor capture exists (`modules/mobile/JobLabor.jsx`), contradicting
  `technician-labor-authority-gap.md:3`.
- Parts readiness renders honestly (`FieldMode.jsx:431-434`, `domain/fieldCurrentJob.js:101`
  — *"Parts readiness can't be confirmed"*).
- **Never built / UNPROVEN**: "a route, not a list" (route-step ordering needs travel/sequence
  authority that does not exist); the "four moments" structure cannot be checked against anything.

**CURRENT EOS AUTHORITY**

- *Canonical objects*: `fieldops_wos`, `work_order_labor_entries`, truck stock.
- *Commands*: `transitionWorkOrder` (`Accept`/`Travel`/`Arrive`/`WorkStart`/`Complete`),
  `updateWorkOrderExecutionData`, the labor callables, `completeAssignedJob` (legacy path).
- *Workflow*: `transitionEngine.ts`, with `isOwnAssignment` gating.
- *Capabilities*: `workOrder.transition`, `workOrder.labor.record`, `workOrder.labor.correct`.
- *Ownership*: the technician identity key space is `fieldops_technicians` doc ids, **not** Firebase
  uids (`domain/actorDisplayName.js:61`; `functions/src/callerContext.ts:20`). This is the "identity
  trap" C5 fenced.
- *Operating company*: absent.
- *PostgreSQL*: none.
- *Firebase*: total, plus the client-writable `fieldops_technicians.status` path
  (`firestore.rules:407,418`) that the recommendation engine then scores on.
- *Unknowns*: whether `TechnicianShell` or `FieldMode` is the surface a real technician sees in
  production. Width decides, and no field measurement exists here. **UNPROVEN.**

**NEW OPPORTUNITIES**

1. The handheld is the only place a technician could record **blocked time about themselves** (sick,
   truck down). The governed command `createTechnicianBlockedTime` exists and is admin/dispatcher
   only. A technician-initiated absence with dispatcher acknowledgement is a small authority change
   with a large operational payoff — and it is exactly where tonight's Owner ruling on overlapping
   blocked-time facts becomes load-bearing (two people recording the same absence from two
   directions must both be allowed to be right).
2. "Honest exits are first-class" is designed and **not verified as built** — a `Could not
   complete…` action beside Complete needs a governed non-completion outcome the state machine does
   not model (`CANCELLED` is the only non-forward edge).

**SCENARIO / OPERATIONAL QUESTIONS**

- A technician's truck breaks down at 10:00. What do they press? Nothing in the lifecycle says
  "I cannot do this today" short of Cancel, which is the customer's outcome, not the technician's.
- Offline writes queue. A dispatcher reschedules the same Work Order while the technician is
  offline. Which wins, and what does the technician see when the queue drains?

**DESIGN P2 DISPOSITION: `WORKFLOW GAP`**
The platform migration is genuinely done and the offline runtime is real. The gap is the designed
workflow the grammar names and the system cannot express: an honest exit, and a route rather than a
list.

---

### 2.12 PAGE / ROUTE — `/service/scan`

**ORIGINAL CLAUDE DESIGN** — grammar §7 (scan-first tab bar, **mode before capture**: use / look up /
return) and §8's **Quiet** ruling for Scanner / cycle count / signatures — "suggestions would bias
counts". No artifact.

**WHAT ACTUALLY GOT BUILT** — `modules/scan/` composed by `App.jsx:537-545`, deriving which journeys
to offer **from the trusted effective-access feed, never from a role name**. Capability-gated
(`RECEIVING_SURFACE_CAPABILITIES`, `navConfig.js:249`).

**CURRENT EOS AUTHORITY** — capability-driven composition (one of only two surfaces in this domain
that gate on capabilities rather than role strings); the technician `PartsScanner` journey is
additionally reachable from `FieldMode`, so it is not moved, only additionally reachable.

**DESIGN P2 DISPOSITION: `KEEP`**

---

### 2.13 PAGE / ROUTE — `/dashboard` when `role === "technician"` (Technician Dashboard)

**ORIGINAL CLAUDE DESIGN** — `DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md` §0-E. Its own acceptance,
separate from My Dashboard, because it is a different surface.

- *Composition*: ContextBand (status, active count) → `PerformanceSnapshot` → four work buckets →
  `TechnicianPerformance`. **"Work before targets, at every width."**
- *Facts shown*: completed all-time, parts used, average duration as a compact identity strip — *not*
  a scorecard; goals at `EMPLOYEE` scope over two registered technician metrics.
- *Exception handling*: reserved measures (on-time completion, first-time fix, jobs per workday) stay
  **named and empty** as `NOT_ENABLED`, deliberately **not** `UNAVAILABLE` — because `UNAVAILABLE`
  carries `role="alert"` and *"a definition nobody has written is not an alert to interrupt a
  technician with."* A missing technician record renders an explicit error, **never an empty board
  that would read as "no work"**.
- *Identity*: `useCurrentTechnician` over `users/{uid}.technicianId` → `fieldops_technicians/{id}`.

**WHAT ACTUALLY GOT BUILT** — **IMPLEMENTED, Owner accepted, live verified** 2026-09-04
(migration ledger Family 11, `:1935-1958`, `:1971`). Post-acceptance correctives landed for two
defects the handoff preserves rather than hides: `TechnicianWorkOrderCard` rendered the **raw** Work
Order status; and a Work Order whose `completedAt` precedes its `workStartedAt` pushed a negative
duration into the average — *"the underlying records were NOT repaired"* (§0-C), the sandbox still
holds them, the surface was made honest instead.

**CURRENT EOS AUTHORITY** — Work Order + `fieldops_technicians` + goal authority at `EMPLOYEE` scope.
Routing branches on `role === "technician"` — a **role string**, not a capability. Open in the
handoff: *"A technician still cannot read an approved `EMPLOYEE`-scope goal set for their own
governed employee"*. On-time / first-time-fix / workday definitions are assigned to
`technicianQualityMetrics` and named as **Service Operations domain authority** that does not exist.

**NEW OPPORTUNITIES** — the three reserved measures are the domain's clearest stated demand for a
service-quality authority, already named, already slotted, already rendering an honest empty.

**SCENARIO / OPERATIONAL QUESTIONS** — a technician's average duration is computed over records the
lifecycle says are impossible. Who owns repairing the data rather than the display?

**DESIGN P2 DISPOSITION: `KEEP`**

---

### 2.14 PAGE / ROUTE — `/equipment`, tab 1 · Customer Equipment

**ORIGINAL CLAUDE DESIGN** — `North Star - Equipment P1v2.dc.html` frame 1a +
`DESIGN-HANDOFF-EQUIPMENT-P1v2.1.md`. Archetype: **Workspace + Record**.

- *Primary question*: which units are installed where, for whom.
- *Facts shown*: Equipment (display name + muted `manufacturer · model · S/N` summary) · Customer ·
  Location · Manufacturer · Model · Status.
- *Composition*: workspace header with **NO count** ("three tabs, one number would be ambiguous" —
  repo law) → tab rail → tab-level governed aggregate + saved views → **server-side** filters
  (Customer as a picker of *names*, Status; manufacturer/model stay columns — no composite index) →
  result context directly above rows → table → Load more.
- *Workflow*: the three populations are **never merged** — a cross-account read of `equipment`, a
  trusted callable read of `serialized_assets`, and an account-scoped create flow are three different
  things.
- *Exception handling*: unresolved location renders `"Location unavailable"`; **raw ids never shown;
  names and types never guessed.**
- *Unresolved design gaps*: **EQ-G5** — installed Equipment must **never** show Taylor/Ventana derived
  from the Customer, because a customer may own units from both operating companies.

**WHAT ACTUALLY GOT BUILT** — **IMPLEMENTED, Owner accepted 2026-08-31** (Family 8,
`north-star-migration-ledger.md:1233`, `:1535`).
`modules/equipment/EquipmentWorkspace.jsx` + `CustomerEquipment.jsx`. The composition map records
**sixteen of twenty-two drawn elements already built and correct** before the migration began.

- **Two design elements were ruled against, and the repository won both.** **ND-31**: the design drew
  the single string "Location unavailable" in the 1a table; `metadata/referenceResolution.js`
  distinguishes NOT_FOUND / DENIED / LOADING / ERROR and renders a different sentence for each.
  Collapsing them "would re-introduce the exact defect that module was written to remove — telling an
  operator their data is broken when the truth is that their role is narrow." **ND-32**: the design
  drew a concatenated `Name · Manufacturer Model · S/N` identity cell *while also* drawing
  Manufacturer and Model as their own columns; the repo gives each attribute its own sortable column.
- **One pre-existing defect corrected in passing**: `EquipmentTimeline.jsx` printed a Work Order's
  `type` and `status` **raw** (`Service · WO-873 · REPAIR · IN_PROGRESS`) — the same "stored token
  reaching a reader" shape as Parts defects #4/#5.

**CURRENT EOS AUTHORITY**

- *Canonical object*: `equipment` (installed units). Three live composite indexes:
  `(accountId,name)`, `(status,name)`, `(accountId,status,name)`.
- *Commands*: `updateEquipment` (allowlist **imported** from the write path, not re-declared).
- *Capabilities*: **none expressible.** Verified directly at
  `field-ops-app-vite/src/access/objectPermissionMap.js:92` —
  `{ object: "Equipment / Installed Base", domain: "Service", rulesOnly: "equipment", C: [], R: [], E: [], D: [] }`.
  Administration → Objects therefore shows an Equipment object *whose permissions are not
  expressible as capabilities at all* — a third condition, distinct from both "ungranted" and
  "inactive" (§1.2). Corroborated by `docs/handoff/w1-c7-registrations.md:50-54`.
- *Operating company*: **`operating_company_key` has no source.**
  `EQUIPMENT_BUSINESS_LINE_NOT_RECORDED` records that nothing on an installed unit names a line of
  business, and that deriving it from the owning Account is *"confidently wrong for exactly the
  customers it matters most for."* The Postgres column is NOT NULL with no default.
- *PostgreSQL authority*: **built but not cut over.** `equipment` / `equipment_models` tables exist;
  `functions/src/eosOps/equipmentCustody.ts` is **not wired** to `eosOpsHttp.ts`'s closed operation
  list. Nothing reads or writes them at runtime.
- *Remaining Firebase dependency*: total.
- *Unknowns*: `equipment.locationId` is a **CRM customer site, never an inventory location** —
  290/290 into `locations`, 0/290 into any inventory registry
  (`w1-c7-registrations.md:150-153`). One field name, two disjoint namespaces, **no discriminator on
  either side**. Also unsourced: `created_by` / `updated_by` (`X-EQUIPMENT-PROVENANCE-GAP`).

**NEW OPPORTUNITIES** — Equipment is the only object in this domain with a built Postgres schema and
no client cutover. It is the natural first candidate for the migration this program is heading
toward.

**SCENARIO / OPERATIONAL QUESTIONS** — a customer owns Taylor and Ventana units at one site. Which
company's technician is dispatched, and which company invoices? EOS records neither the unit's
company nor the Work Order's.

**DESIGN P2 DISPOSITION: `KEEP`**

---

### 2.15 PAGE / ROUTE — `/equipment`, tab 2 · Available Equipment

**ORIGINAL CLAUDE DESIGN** — frame 1b. The most carefully specified honest-state design in the
domain.

- *Facts shown*: Serial · Model · Condition · Location, grouped by operating line, **both lines always
  named including at zero** (`Taylor: 4 · Ventana: 2`).
- *Proposed actions*: **Install at customer** as a capability-gated, **confirmed** governed command —
  a read-back of Unit / Serial / Customer / Installation location, primary `Confirm installation`,
  secondary `Cancel`. *"Not casual reassignment; no recovery command designed in P1."*
- *Workflow / intelligence*: the line is **not stored on the asset and nothing is inferred from the
  Customer.** It is composed: Serialized Asset → whole-unit Part → canonical Equipment Model identity
  → manufacturer → the existing declared manufacturer-to-operating-line mapping → Taylor / Ventana /
  Unclassified.
- *Exception handling*: **all five runtime states designed** — LOADING / READY / EMPTY / DENIED /
  UNAVAILABLE — each with its own copy. *"Denied and Unavailable are different facts and never share
  a rendering."* *"A denied read is never relabelled 'not found'."* Empty splits filtered vs genuine.
- *Design correction worth preserving*: **EQ-G1/EQ-G2 in P1v2 corrected the design's own earlier
  claim** that these capabilities were "granted to no role / DENIED in every environment". This is the
  one case in the domain where the design fixed itself against the code rather than the reverse.

**WHAT ACTUALLY GOT BUILT** — **IMPLEMENTED.** `modules/equipment/AvailableEquipment.jsx`; the five
states branch at `:112` (LOADING), `:116` (DENIED), `:125` (UNAVAILABLE), `:208` (EMPTY), with READY
as the composed default; `deriveAvailableState` → `AVAILABLE_STATE` in the domain layer. Line grouping
via `domain/wholeUnitAssetDisplay.js` (`LINE_BY_MANUFACTURER`). Install confirmation built as
designed and as a **read-back, not a second step**: `modules/equipment/InstallAtCustomer.jsx:150-195`
— labelled Unit / Serial number / Customer / Installation location rows, `Confirm installation`
primary, *"the same dialog, the same command, the same idempotency key. Nothing about the write
changed."*

**CURRENT EOS AUTHORITY**

- *Canonical object*: `serialized_assets`, read through a trusted callable.
- *Commands*: `callInstallSerializedAsset` → `equipment.install`. The server re-checks capability and
  the availability invariant **inside its transaction**.
- *Capabilities*: `inventory.serializedAsset.read` (12 roles), `inventory.location.display.read`
  and `equipment.install` — **all three `active: false` in the catalog**
  (`permissionCatalog.ts:1269`, `:1498`, `:1432`), **all three granted**, and **all three activated
  in `platform-sandbox`** via `capabilityActivationOverrides`. Granted-and-inactive, not ungranted —
  see §1.2. Production remains DENY until Owner-authorized activation.
- *Operating company*: derived for *available* stock only, and never stored.
- *PostgreSQL*: `INSTALLABLE_CUSTODY_STATUSES` exists in `functions/src/eosOps/equipmentCustody.ts`;
  no client is cut over.
- *Unknowns*: **there is no recovery command.** `installSerializedAssetCommand.ts` says so in its own
  words, and ADR-010 §4's uninstall / return / replacement is not built — *"the schema does not forbid
  it… but there is no command, and the Firestore path has none either"* (`w1-c7-registrations.md`
  §5).

**NEW OPPORTUNITIES** — uninstall/return/replacement is a named, schema-permitted, unbuilt command.
Install is currently a one-way door.

**SCENARIO / OPERATIONAL QUESTIONS** — a unit is installed at the wrong customer. What happens? Today:
nothing. The design said "confirm the handoff deliberately" precisely because it knew this.

**DESIGN P2 DISPOSITION: `IMPROVE`**
Built to design, honestly stated, and permanently one-directional.

---

### 2.16 PAGE / ROUTE — `/equipment`, tab 3 · Add Equipment

**ORIGINAL CLAUDE DESIGN** — frame 1d. *"Choose a customer — Select a customer to see the equipment
installed at their locations."* The account **bounds the query**; until one is chosen nothing has been
read *and the page says so* rather than reading the whole collection. `+ New Equipment` exists only
once a customer is fixed. Filtered-empty vs database-empty are distinct facts with distinct remedies
("clear the filters" vs "add a record"). Failure ≠ not found.

**WHAT ACTUALLY GOT BUILT** — **IMPLEMENTED.** `modules/equipment/EquipmentRegister.jsx` +
`EquipmentCreateModal.jsx`; the four distinct states render through `MetadataListGrid`'s `StateBody`.

**CURRENT EOS AUTHORITY** — account-scoped create; Location options and the write bound to one fixed
Account; `rulesOnly` permissions as above; ND-33 closed 2026-08-30 (non-PO serialized-asset
acquisition lives in Inventory → Receiving, not here).

**DESIGN P2 DISPOSITION: `KEEP`**

---

### 2.17 PAGE / ROUTE — `/equipment/:equipmentId` (the unit record)

**ORIGINAL CLAUDE DESIGN** — frame 1c.

- *Facts shown*: identity header with the status **word** beside the name; the shared record shell
  (labelled fields, em dash where genuinely absent, **a pencil only on fields the edit command
  accepts**); Name / Manufacturer / Serial number / Model / Asset tag / **Warranty expires** / Notes.
- *Warranty*: `warrantyExpiresDate` rendered **exactly as recorded** — "no 'in warranty' / 'expired'
  judgment, days remaining, or coverage semantics" (EQ-D2 closed).
- *Composition*: Customer & Location kept **apart** from the record shell on purpose, because each
  read fails independently with its own Retry — *"'we could not look' never renders as 'Unknown
  customer'."*
- *Exception handling* — the **reference resolution ladder**, the sharpest piece of design in the
  corpus: *resolved* → the human-readable name; *failed read* → "Location unavailable" + Retry;
  *proven unset* → "Unknown location", **only when the read succeeded and resolved to nothing.**
  A database key is never a fallback business label; a location type is never guessed.
- *Inventory control*: honest **UNKNOWN** with the reason — the two-condition read (install complete
  AND sale close) needs a sale-close signal this surface does not have. *"Not a P1 gap to solve."*
- *Lifecycle actions*: Move / Retire **present but disabled with the reason stated** — *"Hiding them
  would claim the asset can never move; enabling them would promise a write nothing can perform."*
  Edit sits apart because it is genuinely available, **including on a retired asset**.
- *Timeline*: unified, source-tagged, newest first, with the inventory note kept **verbatim**; a
  failed service read renders "Activity unavailable", never "No activity yet".
- *Intelligence / AI*: **none, deliberately.** EQ-D1 (repair economics: repairs-12mo,
  repair-spend-vs-replacement, "repair-heavy" flagging) and EQ-D3 (Equipment→Opportunity linkage,
  "flag this serial for OP-…") were both **deferred as inventing authority**, and the composition map
  verifies by grep that no such composer exists and none was added.

**WHAT ACTUALLY GOT BUILT** — **IMPLEMENTED.** `modules/equipment/EquipmentDetail.jsx` — `ns-page` +
`RecordIdentity` (`:21,153,162`), "Location unavailable" only on a failed read (`:120-124`),
independent `data-account-error` / `data-location-error` with Retry buttons (`:252,267`),
`trustedActionUnavailable("equipment.move")` supplying the one shared reason string (`:129`),
`InventoryControlSection.jsx`, `EquipmentTimeline.jsx`.

**CURRENT EOS AUTHORITY**

- *Commands*: `updateEquipment` only. **Move / Retire / Reactivate trusted-writer Functions are
  undeployed** (EQ-G4) — the buttons are honest, the capability is absent.
- *Capabilities*: none expressible (`rulesOnly`).
- *Operating company*: **never inferred from the Customer.** EQ-G5 is an open authority seam, and the
  gap is a first-class named record (`EQUIPMENT_BUSINESS_LINE_NOT_RECORDED`).
- *PostgreSQL*: schema exists; `operating_company_key` NOT NULL with no source; `created_by` /
  `updated_by` NOT NULL with no source.
- *Unknowns*: EQ-G3 — the timeline's inventory half (`inertInventoryHistorySource`) stays inert.

**NEW OPPORTUNITIES** — `warrantyExpiresDate` + the equipment-scoped Work Order query already on this
page are, together, everything a warranty-expiry attention feed needs (see §2.10).

**SCENARIO / OPERATIONAL QUESTIONS** — a unit must move from one customer site to another. Today the
record says, truthfully, that it cannot. How is the move actually recorded in the business, and where
does that record live?

**DESIGN P2 DISPOSITION: `IMPROVE`**
The composition is complete and unusually honest; the object underneath it cannot move, cannot be
uninstalled, and cannot name its own operating company.

---

## 3. Disposition summary

| Disposition | Count | Routes |
|---|---|---|
| `KEEP` | 6 | `/service` · `/service/inbound-work` · `/service/scan` · `/dashboard` (technician) · `/equipment` Customer Equipment · `/equipment` Add Equipment |
| `IMPROVE` | 5 | `/service-operations` · `/service/dispatcher-board` · `/equipment` Available Equipment · `/equipment/:equipmentId` |
| `REMOVE` | 2 | `/service/scheduling` · `/service/dispatch-scheduling` |
| `AUTHORITY GAP` | 3 | `/service/dispatch` · `/service/job-assignments` · `/service/work-orders/:workOrderId` |
| `WORKFLOW GAP` | 3 | `/service/coordinated-visits` · `/service/coordinated-mission` · `/service/technician-workspace` |
| `PRODUCT GAP` | 1 | `/service/warranty` |
| `UNKNOWN` | 1 | `/service/work-orders/new` |

(`IMPROVE` counts 5 because Available Equipment and the unit record are separate entries under the
same route family; 20 reconciliation entries, 18 distinct URLs.)

---

## 4. Findings this lane produced that no prior document records

### 4.1 Tonight's Owner ruling overturns shipped code — and the shipped fix was applied in the wrong place

**Owner ruling (tonight):** overlapping blocked-time facts are **legitimate**; unavailable time is the
**UNION** of blocked intervals, never the sum; **overlap must not be prohibited.**

What ships today does the opposite. `functions/src/scheduling/schedulingCommands.ts:435-458`
(**ND-25**, as recorded in `docs/design/governed-scheduling-domain.md` and
`docs/handoff/w1-c27-registrations.md` §7) **refuses** a blocked-time record that overlaps another for
the same technician, raising `BLOCKED_TIME_CONFLICT`, serialized on
`work_order_tech_locks/{technicianId}`.

The reasoning it was built on is explicit and is now superseded: two functions answer "how many
minutes are blocked", and they disagree —

| function | method | result |
|---|---|---|
| `functions/src/scheduling/availabilityModel.ts:293` `blockedMinutesInWindow` | walks minutes | **UNION** |
| `field-ops-app-vite/src/domain/dispatchBoardGeometry.js:222-230` `blockedMinutesInBand` | `reduce` summing clipped durations | **SUM** |

ND-25 chose to make them agree **by forbidding overlap at the write path**, so that `sum == union`
holds by construction. Under tonight's ruling that fix is no longer available: overlap is legitimate,
so the two readers will genuinely disagree, and the board's lane meta line
(`DispatchLaneGrid.jsx:281` — `${formatHours(blockedMinutes)} blocked`) will over-report. Two
identical eight-hour PTO records draw **sixteen hours blocked** on a lane whose day is eight hours
long.

**The correct fix is now at the reader, not the writer**: `blockedMinutesInBand` must compute a union
(merge intervals before measuring), matching `availabilityModel`'s minute walk. The server function
is already correct and needs no change.

Consequences of relaxing ND-25 that the ruling should be taken to have accepted, stated so they are
not rediscovered: the deletion-honesty argument returns (deleting one of two overlapping PTO records
stages an Audit Event saying the absence was removed while the technician stays blocked — current
state and history disagreeing), and the `work_order_tech_locks` sentinel read+write that ND-25 added
to `createTechnicianBlockedTime` should be **retained** for the placement-contention reason even if
the exclusion rule goes. Also worth noting: `w1-c27-registrations.md` census row 13 records that the
eventual Postgres form of ND-25 is a `tstzrange` **exclusion constraint** — that design target is now
wrong and must not be carried into the migration.

### 4.2 SO-G7 — the Work Order the system knows least about is the one it shows least

Recorded in `north-star-open-product-decisions.md:895-918` as open, and it inverts R23 (lossless
composition). `jobRiskScoring` scores an unusable `createdAt` as 0 for both the age and stagnation
factors; the total falls to `LOW`; `detectStalledJobs` returns only `HIGH` and `CRITICAL`; the work
order is dropped from the At-risk table entirely. The projection's "age unknown" row is implemented
and tested and is **unreachable through this path**. Fixing it is a risk-scoring change, not a
presentation change.

### 4.3 The AI trust contract and the Dispatch design contradict each other on undo

`eos-north-star-design-grammar.md:197-203` trust contract item 2 is **"Accept-with-undo."** The
Dispatch handoff's board rules state **"No undo — Dispatch is a forward transition with no reverse
command (ND-3). The board confirms before acting rather than pretending a drop can be taken back."**
Service Operations' own suggestion tray repeats the grammar's promise verbatim: *"accept with undo
there"* — pointing at a board that has never offered undo. ND-18 later admitted `Unschedule` from
`SCHEDULED`, which narrows but does not repeal ND-3. **The Service Operations tray copy is therefore
inaccurate about the board it links to**, and this was never caught by the nine SO-N rulings because
they checked drawn *facts* against projections, not drawn *promises* about another page.

### 4.4 The recommendation engine projects reason sentences, and the Dispatch design said it could not

`DESIGN-HANDOFF-DISPATCH-BOARD-P1.md` classifies recommendation reasons **VERIFY AUTHORITY** —
"score only until the engine's factors are confirmed projectable as words", and
`dispatch-north-star-composition-map.md` restates it: *"the engine projects a score, not words. Score
only — no fabricated explanations."*

`technicianRecommendationEngine.ts:143-165` `buildReasons()` projects a full sentence per factor, and
`modules/dispatcherBoard/WorkOrderPreview.jsx:16,25-27` **renders them**, alongside a four-line
breakdown and a `qualitativeSummary` (`:35-42`). The design's caution was unnecessary and the
implementation quietly went past it. That is not a defect — the reasons are derived, not fabricated —
but the design record is wrong about its own engine, which is the same failure mode as ADR-004.

### 4.5 ND-25 is two different decisions with one number

`north-star-open-product-decisions.md:920` — **ND-25: "May a Parts surface show a quantity at all
today?"** (closed 2026-08-30). `governed-scheduling-domain.md` and
`docs/handoff/w1-c27-registrations.md` — **ND-25: "one technician's absences may not overlap each
other."** Two decisions, two domains, one identifier, and only the Parts one is in the canonical
register. Any instruction naming "ND-25" is ambiguous. Given §4.1 overturns the scheduling one, this
matters immediately.

### 4.6 Four surfaces with no design authority at all

`/service/work-orders/new`, `/service/warranty`, `/service/job-assignments`, `/service/dispatch`. The
first two are unbuilt or undesigned; the last two are the legacy Job model, which no North Star
artifact ever dispositioned. The migration ledger has twelve families and none of them covers the Job
compatibility surfaces — they were never given a retirement design, only a comment.

---

## 5. The biggest original ideas that were never implemented

1. **"A route, not a list."** The handheld model's central idea — the technician's day as an ordered
   route where the next action is the only filled button. EOS has no travel, sequence, or ETA
   authority, so the handheld renders a list. Its artifact is also gone.
2. **The four moments of a field day** (`Proposed - Technician Mobile.dc.html`). Unrecoverable. The
   only structural description of the technician experience that ever existed as a drawing.
3. **Honest exits as first-class** — *"Could not complete…"* beside Complete. The state machine models
   forward edges and `CANCELLED`; there is no "I could not do this" outcome, so a technician's real
   day has no governed expression.
4. **Repair economics (EQ-D1)** — repairs-12mo, repair spend vs replacement cost, "repair-heavy"
   flagging. Deferred and never built; the composition map re-verified by grep that no composer
   exists.
5. **Equipment → Opportunity linkage (EQ-D3)** — "flag this serial for OP-…". Deferred; no
   equipment↔opportunity relationship exists in any entity definition.
6. **The Map view.** Drawn as "the same day in space", implemented as a truthful refusal
   (`DispatchViews.jsx:254-267`). No routing, travel-time, GPS or optimization authority exists and
   none is being built.
7. **Parts readiness on Service Operations (SO-G5).** Designed as a slot, shipped as one honest
   sentence, never wired. The projection already accepts the feed.
8. **The windowed "Completed this week" read (SO-D4).** The label was downgraded to "Completed" over
   snapshot truth rather than fabricate a window.
9. **Fleet-wide `% booked`.** Drawn in the workload sentence ("fleet booked 64%"); renders only when
   every technician in view has a recorded schedule, which in practice means never.
10. **DB-G1 — "past due" on the queue.** There is no due-date model for unscheduled work, so the
    artifact's most operationally obvious queue annotation cannot be drawn at all.
11. **Uninstall / return / replacement (ADR-010 §4).** Install is a one-way door by construction.
12. **Move / Retire / Reactivate equipment.** Designed as present-but-disabled, and still disabled —
    the trusted-writer Functions were never deployed (EQ-G4).

---

## 6. Design assumptions now obsolete

| Assumption, as written | Why it is obsolete |
|---|---|
| Dispatch DB-D1: scheduling windows, shift records and `% booked` are `PRODUCT BUILD` | Governed and certified 14 hours after the artifact was drawn. The interim renderings were never built |
| Dispatch DB-D2: blocked time is `PRODUCT BUILD`; nothing hatched renders | `technician_blocked_time` ships; hatched chips are real (`DispatchLaneGrid.jsx:129-136`) |
| Dispatch 1d: "the live core is `transitionWorkOrder \"Dispatch\"`" | A queue drop is a **Schedule**, not a Dispatch. Corrected in the composition map's gesture→command table |
| ND-3: "Dispatch is a forward transition with no reverse command" | ND-18 admitted `SCHEDULED → READY_TO_DISPATCH`. Narrowed to `DISPATCHED` onward, not repealed |
| ND-23: "the Dispatch North Star design package is not in the repository" | It arrived on 2026-08-27 (`4a5a8054`). The doc that says otherwise (`governed-scheduling-domain.md`) still says it |
| `SchedulingWorkspace.jsx:25`: "true reschedule is NOT a deployed transition" | `rescheduleWorkOrderCallable` deployed and certified 2026-08-27 |
| `work-order-scheduling-workspace.md`: "no drag/drop, no optimizer, no capacity" as deliberate boundaries | All but the optimizer now exist on the North Star board |
| ADR-004:13 "no implementation exists yet" | The engine ships and is consumed by the board |
| `technician-labor-authority-gap.md:3` "No labor collection… none" | `work_order_labor_entries` + two capabilities + a handheld UI ship |
| `AvailableEquipment.jsx:17-25` "granted to no Role… DENIED in EVERY environment" | Granted to **12** roles and sandbox-activated; the denial class is `active: false` + per-environment activation, not absence of grants (§1.2). **Corrected by the design, not by the code** |
| `equipment-north-star-composition-map.md` "granted to eight governed Roles" | Measured as **12** for `inventory.serializedAsset.read`. Stale in the same direction as every other stale claim here: understating what exists |
| Equipment P1 "no warranty field exists" | `warrantyExpiresDate` is an existing governed fact (EQ-D2 closed in P1v2) |
| Equipment P1 Available Equipment modelled around a **universal** DENIED state | Replaced by the five-state runtime model (EQ-G1) |
| ND-25 (scheduling): overlap must be excluded so `sum == union` | **Overturned tonight.** Overlap is legitimate; the union must be computed at the reader (§4.1) |
| Service Ops tray: "accept with undo there" | The board has never offered undo (§4.3) |
| Dispatch: recommendation reasons are `VERIFY AUTHORITY`, score only | The engine projects sentences and the board renders them (§4.4) |
| Every handoff's hard-coded hex palette | Superseded by `docs/north-star/VISUAL-SYSTEM.md` (2026-09-02). The handoffs that named CSS variables inherited the new system automatically; only one that copied hexes would have needed changing — recorded in the Service Operations handoff as the point of the rule |

---

## 7. Missing-workflow discoveries

1. **No blocked-time collision surface.** Blocked time is deliberately not checked against placed
   work — *"the board surfaces the collision; a person decides."* Nothing surfaces it.
2. **No recovery from install.** No uninstall, return or replacement command exists on either the
   Firestore or Postgres path.
3. **No equipment move.** Move/Retire/Reactivate render disabled because their trusted writers are
   undeployed.
4. **No governed non-completion.** A technician cannot record "I could not do this", only Cancel.
5. **No technician-initiated absence.** `createTechnicianBlockedTime` is admin/dispatcher only.
6. **No command on either coordinated surface.** Two routes, read-only, over a projection the design
   itself says awaits grants/deploys.
7. **No warranty workflow.** One date, no claim, no coverage, no billing consequence.
8. **No cross-company scheduling refusal.** Scheduling is company-blind; a cross-company placement is
   not refused.
9. **No `woNumber` uniqueness enforcement**, and `counters` is client-unreadable, so a collision is
   invisible from the product.
10. **No windowed completion read** anywhere in Service.
11. **No service-quality authority.** On-time completion, first-time fix and jobs-per-workday are
    named, slotted and empty on an accepted surface, assigned to a Service Operations domain
    authority that does not exist.
12. **Three scheduling boards, one authority**, two of them hidden-but-routed and carrying stale
    claims about the state machine in their own headers.

---

## 8. UNPROVEN — stated plainly

- Everything about the original **Work Order** and **Technician Mobile** designs beyond the prose
  quoted in §2.6 and §2.11. The artifacts have never existed here.
- Whether `firestore.rules` blocks for `technician_working_availability` /
  `technician_blocked_time` are live in **production**. No production contact was made.
- Whether the SO→Service pipeline feeding the coordinated surfaces is granted/deployed anywhere.
- The 290/290 `equipment.locationId` census figure — cited from
  `docs/handoff/w1-c7-registrations.md:150-153`, not re-run against live data by this lane.
- The `trackingMode = "NONE"` hardcoding and its Wave-1 fix — outside this lane's file set; not
  re-verified here.
- Which technician composition (`TechnicianShell` vs `FieldMode`) real technicians actually see.
- Every emulator-gated suite named in the scheduling and equipment documents. Firestore-emulator
  suites hang in this environment (port 8080 is an unrelated uvicorn), so none was run.

---

*Lane P3-A1. Recovery and reconciliation only. No runtime code changed; no UI or design implemented;
no production contact; nothing pushed.*
