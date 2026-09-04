# My Dashboard — North Star P1v2 · design handoff

**Status:** DESIGN AUTHORITY for the My Dashboard family — **CLOSED / OWNER ACCEPTED 2026-09-03** (§0-C), with a **post-acceptance corrective 2026-09-04** (§0-D). The technician surface is a SEPARATE acceptance and is **not** covered by it (§0-E). Recorded 2026-09-02 under the Owner's
dashboard + performance-management direction. Governed by
[`eos-dashboard-composition-authority.md`](../../governance/eos-dashboard-composition-authority.md)
(Decision #161) and the Performance Goal Authority (Decision #162).

**Visual system:** [`../VISUAL-SYSTEM.md`](../VISUAL-SYSTEM.md), unchanged. **This document
redesigns nothing.** It composes the accepted grammar — the same tokens, the same primitives, the
same hover contract — into one dashboard family. Where it names a component it names an existing one.

---

## 0-D. POST-CLOSURE PERSONA VERIFICATION AND POST-ACCEPTANCE CORRECTIVE — 2026-09-04

**My Dashboard remains CLOSED / OWNER ACCEPTED.** This section records a verification sweep run
*after* closure and the corrective it produced. Acceptance is not revoked and is not re-sought; §0-C
stands.

### Why the sweep happened

The Owner accepted the **Admin** screen. The same `MyDashboard.jsx` engine resolves for twelve other
governed contexts, and `dashboardRoleMatrix` proves the *composition* for all of them — which is
exactly what was green while the receiving tile said "could not be read" and three account counts
rendered as dashes. **Composition tests cannot see the screen.**

### The representative set, derived rather than chosen

The thirteen governed contexts collapse to **eleven distinct compositions**; `partsManager` and
`warehouseManager` resolve identically, as do `partsAssociate` and `warehouseAssociate`. Five were
rendered: salesperson, sales manager, parts manager, warehouse manager and dispatcher — sales
manager included because it differs materially from salesperson (`ordersRequiringAction`), the two
warehouse personas kept separate because their goal *scope labels* differ even where their module
set does not.

### How the personas were made real

The emulator was run under the **sandbox project id**, so `capabilityActivationOverrides` actually
applied and the feed returned the decisions platform-sandbox returns. Under the default project the
overrides are empty and every commercial capability denies — which would have made the sweep
look clean by making it vacuous. Each persona is a governed `roleAssignment` against a real role id,
resolved by the real callable. No capability was bypassed, no Rules weakened, no sandbox data
touched.

### Result — 1440 and 375

| Persona | Modules rendered | Console errors | Failed requests | False "could not be read" | Overflow |
|---|---|---|---|---|---|
| salesperson | 5 | 0 | 0 | 0 | 0 / 0 |
| sales manager | 5 | 0 | 0 | 0 | 0 / 0 |
| parts manager | 5 | 0 | 0 | 0 | 0 / 0 |
| warehouse manager | 5 | 0 | 0 | 0 | 0 / 0 |
| dispatcher | 9 | 0 | 0 | 0 | 0 / 0 |

Go To absent, KPI tier 32px, ContextBand present, no empty section heading, no raw ids, no stuck
loading, bounded previews intact, money still per company and per currency.

**320 was not swept for the persona set.** The responsive contract is 1440/375 and nothing at 375
suggested it mattered; the technician surface, which is the one actually used on a handheld, was
checked at 320 and is recorded below.

### THE CORRECTIVE — what the sweep found (PR #1793)

Those clean rows are the state *after* three defects were fixed. Before it, the salesperson persona
composed **one** module.

| # | Defect | Class |
|---|---|---|
| 1 | Six governed capabilities the composition gates on were absent from `REPORT_CAPABILITY_REQUEST`. `hasCapability` answers from `feed.decisions[id]`, so an unrequested id is `undefined` — which is `false` — for every principal, permanently. `myOpportunities`, `myBooked`, `ordersRequiringAction`, `firmBilled`, `firmCollected`, `firmBooked` and `governedStockPosition` could not resolve for **anyone**; `accountPortfolio` survived only through a legacy path | EXISTING-AUTHORITY CLIENT DEFECT |
| 2 | **FIN-004.** `finance.read` is the fact-*family* gate and confers no reach alone; `listFinancialFacts` refuses a principal with no `finance.visibility.*` scope. The money modules gated on the family gate only, so they composed for people the server would always deny and read "could not be read" forever — a failure state standing in for a settled answer | EXISTING-AUTHORITY CLIENT DEFECT |
| 3 | `useOpportunities` and `useCoordinatedOperations` were not gated on their module, while the comment above them claimed every read was. A salesperson called `listCoordinatedOperations` on every load and took a 403 whose result the preview had already discarded. Separately, `receivingQueue` and `accountPortfolio` carried `\|\| isOperationsViewer(ctx)` — both are capability-governed *callables* honouring no legacy-role bypass | EXISTING-AUTHORITY CLIENT DEFECT |

No authority was invented. Every id was already registered in the server permission catalog; the
client simply never asked for a decision on it, or asked for half of one.

**Why no test caught any of this:** every composition suite supplies its own `hasCapability`, so none
of them can observe the request set. The role-matrix fixtures modelled `finance.read` without a reach
scope and therefore *agreed with* defect 2 — the same shape as the `summary.active` fixture that
agreed with the portfolio bug in §0-B. A fixture written from the same misreading as the code is not
evidence.

### Consequence the Owner should know

In platform-sandbox those six capabilities **are** activated. After the next Hosting release the
accepted screen will gain modules that were previously impossible to render — the finance tiles for a
principal with genuine reach, opportunities, orders requiring action. This is the dashboard finally
doing what §3 and §4 always said it did, and it is a visible change to a screen already accepted.
Recorded as **CLOSED + POST-ACCEPTANCE CORRECTIVE**, not as a reopening.

---

## 0-E. TECHNICIAN DASHBOARD — ITS OWN ACCEPTANCE SURFACE — 2026-09-04

**Status: CODE COMPLETE · DESIGN-CONFORMANCE GUARDED · VISUALLY VERIFIED · AWAITING OWNER
ACCEPTANCE.**

`TechnicianDashboard` is a **different screen**, selected by `DashboardIndex` in `App.jsx`. It shares
no component tree with `MyDashboard` beyond `GoalGrid` and the shell. The Owner's acceptance at
`50792fef` was given on the Admin My Dashboard and **does not extend to it** — §0-C is not stretched
to cover a screen the Owner has not seen.

Until this section it had no design-conformance coverage at all: every guard in
`dashboardDesignConformance` read `MyDashboard.jsx`. The one dashboard whose audience is standing in
front of a machine was the one with no design guard.

### The contract, as it exists in the repository

| | |
|---|---|
| **Routing** | `App.jsx` — `role === "technician"` returns `<TechnicianDashboard />`; everyone else gets `<MyDashboard />`. Composition still resolves from governed context; the branch chooses the SURFACE, not the reach |
| **Order** | ContextBand (status, active count) → `PerformanceSnapshot` → the four work buckets → `TechnicianPerformance`. **Work before targets, at every width** |
| **`PerformanceSnapshot` sits above the buckets deliberately** | It is a compact identity strip (completed all-time, parts used, average duration), not a scorecard. The section carrying *targets* is last. Recorded in the component's own comment as a product decision, and the guard encodes the invariant that matters: every bucket renders above `TechnicianPerformance` |
| **Goals** | The same governed `GoalGrid`, at `EMPLOYEE` scope, over the two registered technician metrics — not a firm figure re-labelled |
| **Reserved measures** | On-time completion, first-time fix and jobs per workday stay named and empty. `NOT_ENABLED`, not `UNAVAILABLE`: the latter carries `role="alert"`, and a definition nobody has written is not an alert to interrupt a technician with |
| **Identity** | `useCurrentTechnician` over `users/{uid}.technicianId` → `fieldops_technicians/{id}`; a missing record renders an explicit error, never an empty board that would read as "no work" |

### Guards added — `test/dashboardDesignConformance.test.mjs`, 9 tests

Routing · work-before-performance · the shared GoalGrid contract · reserved measures named and never
numeric · `NOT_ENABLED` non-alert semantics · governed identity failing closed · no management,
finance or admin leakage · status rendered as words · no desktop-only layout assumption.

**Mutation-proved, each verified non-vacuous before being counted** (the suites strip comments, so a
mutation landing in one passes for the wrong reason — that happened during the §0-C closure and the
check is now part of the harness): routing technicians into `MyDashboard`, moving performance above
the work buckets, turning the deliberate absence into an alert, and restoring the raw status render.
All four fail the suite.

### Defect found and fixed

`TechnicianWorkOrderCard` rendered the **raw** Work Order status, so a technician read
`WORK_IN_PROGRESS` and `EN_ROUTE` on their own work. It was on
`workOrderStatusLabelConformance`'s known-raw allowlist — a tracked burn-down item, and not one to
ship inside acceptance evidence. Routed through the existing `workOrderStatusLabel()`; the CSS class
keeps the machine value because it is a selector, not prose. Allowlist entry burned down.

### Visual verification — 1440 / 375 / 320

A governed technician with a reciprocal employee link, work across every bucket, and two APPROVED
`EMPLOYEE`-scope goals. No business result was fabricated: the completed count is what the seeded
work orders imply.

| Check | Result |
|---|---|
| Correct surface | PASS — `TechnicianDashboard`, not `MyDashboard` |
| Work first | PASS at all three widths |
| Buckets truthful | PASS — Ready to Start 2, In Progress 1, Waiting 2, Completed Today 1, active count 5 |
| All-time record | PASS — 1 completed, 0 parts |
| Avg. Job Duration | PASS — **N/A**, never a false zero |
| Status labels | PASS — Dispatched, In Progress, Accepted, En Route, Completed |
| Reserved measures | PASS — named, no number, non-alert |
| Raw ids · cross-technician leakage · manager comparison · finance · admin | PASS — none |
| Overflow / crash / stuck loading / console errors | PASS — 0 / none / none / none |

**One thing that looks like a defect in the handheld capture and is not.** The full-page screenshots
at 375 and 320 show the fixed `fo-tabbar` over mid-page content. That is how a full-page capture
renders a fixed element, not an overlap. Measured at the bottom of the scroll: the bar's top is
739px, the last content ends at 710px, `occluded: false` at both widths.

### Open, and deliberately not resolved here

`usePerformanceGoals` returned **"This target is outside your access"** for the technician's own
`EMPLOYEE`-scope targets: the fixture holds no governed role granting `performance.goal.read`. The
tile is honest — it is not a zero and not a fabricated target — but whether a technician should be
able to read a goal set *for them* is an **authority question for the Owner**, not a dashboard
defect, and no authority was invented to make the screen look complete.

---

## 0-C. OWNER ACCEPTANCE AND CLOSURE — 2026-09-03

**Status: CLOSED / OWNER ACCEPTED.**

| | |
|---|---|
| **Accepted environment** | `platform-sandbox` (`eos-platform-sandbox.web.app`) |
| **Accepted live commit** | `50792fef23f1aae3e1f68f395e548c7a0e5e7a55` (`/version.json` → `commit: 50792fef`, `environmentRole: sandbox`) |
| **Production** | untouched. No production deploy, no production data, no Rules, no Functions, no indexes |
| **Training** | [`docs/training/MY_DASHBOARD.md`](../../training/MY_DASHBOARD.md) — COMPLETE, LIVE VERIFIED |

Acceptance followed the live corrective recorded in 0-B — not the first sandbox build. The build the
Owner accepted is the one that removed Go To, fixed the Awaiting Receipt result comparison, fixed the
account-portfolio status shape and with it the Active Accounts goal actual, compacted unset team
goals into one counted line, labelled warehouse-scoped goals, turned an unresolvable technician id
into an explicit data-quality state, and shortened the two long blocker paragraphs — while preserving
the ContextBand, the AttentionBand, the 32px/24px KPI tier, Decision #172's bounded previews, and
UNKNOWN ≠ zero. **The intermediate builds at `6ac99d90` and earlier are not accepted and are not
restated as such.**

### Final module census — measured from `dashboardComposition.js` at the accepted commit

| State | Count |
|---|---|
| READY | 15 |
| SATISFIED_ELSEWHERE | 2 |
| GATED | 1 |
| UNAVAILABLE | 5 |
| **NOT_WIRED** | **0** |
| **Total** | **23** |

### What CLOSED means, and what it does not

CLOSED does **not** mean every figure a dashboard could imaginably carry is available. Five modules
render an honest unavailable state and one is gated, and that is the accepted result, not a shortfall
against it.

It means every module in the current design is in exactly one of four honest states — composed from
existing governed authority, satisfied on its owning profile surface, explicitly gated on a named
release decision, or explicitly unavailable for a named missing authority — that **no executable
dashboard composition debt remains** (`NOT_WIRED = 0`, and that zero is enforced by
`test/dashboardComposition.test.mjs`), that the running sandbox was reviewed on the screen rather
than in the diff, and that the Owner accepted the visual and operational result.

### The remaining blockers leave this family

The items below are **platform / domain authority backlog**, not dashboard defects, and they do not
hold this North Star open. Each is named on the tile that lacks it, so nothing is hidden by closing:

| Missing authority | Module it blocks | Owner |
|---|---|---|
| Governed `booked` read (no read exists at any period; the G-05 reporting calendar is *not* the blocker) | `myBooked`, `firmBooked` | Sales/Finance domain authority |
| On-time definition, first-time-fix linkage, workday definition | `technicianQualityMetrics` | Service Operations domain authority |
| Location-level governed stock aggregate | `governedStockPosition` | INV-1 inventory governance |
| `INVENTORY_BALANCE_READ_READY` client transport release decision | `governedStockPosition` (second, independent gate) | per-environment activation programme |
| Governed forecast-exception read (forecasts are per part by design) | `stockForecast` | INV-1 inventory governance |
| Costing method, carrying rate, waste-avoided event or counterfactual | `costImpact` | FIN-BLOCK-003A follow-on |
| Intercompany elimination rule (FIN-BLOCK-004) | `firmBooked` consolidated figures | Financials authority |

No new tickets are raised for these: each already has an owning authority above, and duplicating them
here would split ownership.

---

## 0-B. LIVE OWNER REVIEW — 2026-09-03, amendment

The dashboard was deployed to platform-sandbox at `6ac99d90` and the Owner reviewed the running Admin
screen. Verdict: **"its not super great but manageable"** — manageable, not accepted. This amendment
records what that review changed. Sections 0-A and 3 below are kept as written; where they disagree
with this section, **this section is current**.

### GO TO IS REMOVED FROM THE DASHBOARD

Owner: *"not sure we really need the links at the bottom."*

The rail and drawer already own navigation. Repeating the site map beneath the business content
duplicated that job and consumed most of the page. `goTo` and the `GO_TO` section are gone from the
composition — **not** from the application: `buildReachableGroups` still decides whether a
destination genuinely opens, and every "View all" and attention link still asks it.

The census is 23 modules, not 24. The historical count is preserved in 0-A as history; the current
number is the current truth.

### NO EMPTY SECTION HEADINGS, EVER

The live screen showed **"Performance against goal" with nothing under it**. `myGoals` resolves for
anyone with an employee identity, so the section was kept — and then the render returned `null`,
because EMPLOYEE-scope targets only exist for a technician binding and this surface carries none.

A module that RESOLVES must render something. It now says *"No individual goals are set for you."*
An unset goal is a management gap worth naming, not a blank.

### ABSENCE MUST NOT OUTWEIGH PERFORMANCE

Every metric a viewer's scope can carry a goal for is asked about, so with few targets configured the
grid became a wall of identical *"No target has been set."* tiles. Configured targets keep their full
tile; metrics with **no goal at all** collapse to one counted line. The distinction between "target
exists" and "target absent" is preserved — it is simply no longer the loudest thing on the screen.

A metric asked at several scopes is now **labelled by scope**. "Open reorder requests" and "Awaiting
receipt" appeared once per governed warehouse: legitimately distinct targets that looked like
duplicates because the warehouse name was fetched and discarded.

### UNRESOLVED IDENTITY IS A DATA-QUALITY STATE

Two rows read **"Unknown technician"**, which reads as a person whose name is missing. The truth is
that the Work Order names a technician id no technician record carries. Such rows now read
**"Technician identity unavailable"**, are visually distinguished, sort last, and keep their counts —
the work is real; the record it points at is not.

### DASHBOARD COPY IS CONCISE; THE REASONING STAYS IN THE METADATA

Stock forecast and Cost and waste avoided each had a paragraph on the tile. Modules may now carry a
`displayBlocker` — one or two sentences for the screen — while `blocker` keeps the full, exact
statement that docs, tests and this document read. Neither overstates readiness.

### TWO DEFECTS THE LIVE REVIEW EXPOSED

- **Awaiting receipt** reported *"could not be read just now"* on every load. `RECEIVING_OUTCOME.READY`
  is the lowercase `"ready"`; the dashboard compared against `"READY"`, so the check could never
  pass — including on a perfectly successful callable. Client-only; no receiving authority changed.
- **Account portfolio** showed `103` beside three dashes. The summary returns
  `byStatus.{ACTIVE,PROSPECT,INACTIVE,ARCHIVED}`; the module read `summary.active`, which has never
  existed. The same wrong field silently disabled the `crm.account.active.count` goal actual from the
  day it was "connected", and the test fixtures encoded the same wrong shape, which is why they
  agreed. One known figure now leads; the breakdown is a line, not four competing KPI slots.

**Status: CODE COMPLETE · AWAITING SANDBOX DEPLOYMENT AND OWNER ACCEPTANCE.** Not accepted, not closed.

---

## 0-A. IMPLEMENTATION RECONCILIATION — 2026-09-03

**Status: CODE COMPLETE · AWAITING SANDBOX DEPLOYMENT AND LIVE VERIFICATION.**
Not `ACCEPTED`, not `CLOSED`, not `LIVE VERIFIED`.

Three merged packages took this design from framework to composed surface. **`NOT_WIRED` is now
zero**: every module is composed, satisfied on another governed surface, gated on a named activation,
or unavailable for a named missing authority.

| | PR | What landed |
|---|---|---|
| 1 | #1786 | Goal actuals connected; four stale blockers corrected; booked/billed/collected split |
| 2 | #1787 | **Owner Decision #172** — bounded actionable previews |
| 3 | this | The last eight modules; role matrix; visual gate |

### The final module matrix — 24 modules

**READY (16)** — composed from governed authority on this surface.

`unverifiedSubmissions` · `serviceAttention` · `reorderQueue` · `receivingQueue` · `adminDecisions` ·
`myOpportunities` · `ordersRequiringAction` · `myGoals` · `teamGoals` · `workOrdersByStatus` ·
`technicianComparison` · `technicianAvailability` · `accountPortfolio` · `firmBilled` ·
`firmCollected` · `goTo`

**SATISFIED_ELSEWHERE (2)** — live on the governed surface that owns them. A new state, added by
#172 §11, because `NOT_WIRED` is a *work queue* and leaving a deliberately-delegated module in it
would keep proposing work that must never be done.

| Module | Where it lives |
|---|---|
| `myAssignedWork` | `TechnicianDashboard`, against the technician's own identity (PT-002) |
| `myPerformanceAllTime` | `TechnicianDashboard` |

**GATED (1)** — the authority exists; a named activation does not.

| Module | Blocker |
|---|---|
| `governedStockPosition` | Two, and neither is the one this used to claim. `inventory.balance.read` **is** activated in platform-sandbox and `getPartBalance` **is** deployed. What blocks it: the client transport flag `INVENTORY_BALANCE_READ_READY` is false (a separate release decision), and the reads answer **per part** while the tile claims a location |

**UNAVAILABLE (5)** — no authority exists; building one would invent it.

| Module | Blocker |
|---|---|
| `technicianQualityMetrics` | On-time, first-time fix and jobs-per-workday each need a business definition nobody has made |
| `myBooked` | Booked has no governed read, at any period |
| `firmBooked` | Same, plus consolidated figures have no intercompany elimination rule (FIN-BLOCK-004) |
| `stockForecast` | **Reclassified from NOT_WIRED.** The engine is real but answers per part, from that part's own history. A location figure built by adding per-part predictions would be a number with no authority behind it. No governed forecast-exception read exists to preview instead |
| `costImpact` | Acquisition-cost facts now exist (FIN-BLOCK-003A). Valuation does not: no costing method chosen, no carrying rate, and waste avoided still needs a prevention event and a stated counterfactual |

**NOT_WIRED: 0.** A test asserts this, and a second asserts every module resolves to exactly one of
the four states above.

### Decision #172 — bounded actionable previews

> **A LIST OF REAL WORK IS ALLOWED. A TOTAL DERIVED FROM THAT LIST IS NOT.**

Presentation authority only. It creates no data authority, no permission, no count authority, no
aggregate authority and no metric definition. A preview shows rows, at most five, in the domain's own
order, with "More items available" when truncated and a **View all** that is proven reachable through
the same function the nav rail uses — never a plausible URL. `dashboardPreview.js` has no function
that returns a length, and `hasMore` is a boolean, so there is nothing to render as a count.

`EMPTY` and `UNKNOWN` are separate states, permanently: one means the queue is clear, the other means
nobody could read it.

### Corrections to §3 of this document

§3.1–3.3 were measured on 2026-09-02 and three of their blockers have since been disproven. They are
kept as history; **this section supersedes them**:

- *"no reporting calendar"* — **false since G-05.** DAY/MTD/QTD/YTD/T12M on the America/Phoenix
  calendar. The period was never booked's real obstruction.
- *"`INVENTORY_BALANCE_READ_READY` transport flag is false"* — still true, but it was never the whole
  blocker, and the capability activation it was paired with **is** present.
- *"AB-3 `opportunity.read` catalog-inactive"* — activated in platform-sandbox; `MyOpportunities` is
  composed.
- `MyBilled`/`MyCollected` "awaiting per-environment activation" — activated, and now composed from
  the server's own per-company, per-currency rollup.

A test fails if any blocker sentence cites one of these closed gaps again.

### What the dashboard still must never do

No client money arithmetic; billed and collected are rendered per company and per currency exactly as
the server rolled them up, never summed across either. No count from a bounded page. No ranking of
technicians. No forecast presented as a stock position. No persona branching — composition reads
governed facts only, proven by a test that gives an unrecognised role string real scope and asserts
identical composition.

**Training:** [`docs/training/MY_DASHBOARD.md`](../../training/MY_DASHBOARD.md) — DRAFT, pending
deployment verification.

---

## 0. A correction to the premise, recorded first

The Owner's direction asked to "update My Dashboard P1v2" and listed six findings against it.
**There is no My Dashboard P1v2 artifact in this repository, at any commit, on any branch.**
Verified: `docs/north-star/` contains nine families (dispatch-board, equipment, financials, lists,
opportunity, parts, receiving, sales-agreement, service-operations) and no dashboard entry;
`git log --all --diff-filter=A -- "docs/north-star/**"` shows none ever added.

So the P1v2 the findings describe exists outside the repository. Two consequences, both acted on
rather than worked around:

1. **This document is authored, not edited.** The six findings in §L of the direction are precise
   enough to serve as authoring constraints — each names a real defect and the fact that makes it
   one — so they are applied here as design rules (§6) rather than as edits to a file that is not
   present.
2. **The repository is the source of truth, so the design now lives in it.** A design that exists
   only in a review tool is one cleared cache from being re-litigated, which is the failure this
   programme has already recorded once.

**Owner item:** if the P1v2 artboard should also be repo-resident as a `.dc.html` canvas alongside
the other nine families, it needs to be exported and committed. This document does not stand in for
the visual comp; it specifies composition, authority and states.

---

## 1. What every persona dashboard is

```
CURRENT WORK               what do I need to do
PERFORMANCE AGAINST GOAL   how am I performing against my goals
BUSINESS IMPACT            what business impact am I having
GO TO                      where can I go from here
```

Management variants add, at the manager's **existing governed scope**:

```
TEAM PERFORMANCE           how is my team / function performing
DRIVERS / EXCEPTIONS       why is performance above or below goal
```

**A section is never omitted for being empty.** Where a section's facts are not governed it renders
an honest unavailable state that NAMES the blocker. A dashboard that hides what it cannot answer
teaches its reader that the platform has nothing more to say; one that names the gap teaches them
what decision would unlock it.

**GO TO is not a leftover.** It is the shipped `LandingPage` behaviour — the person's REAL reachable
destinations, computed with the same `isDomainVisible` / `isNavItemVisible` the rail and route table
use — and it stays, demoted from the whole screen to the section it always was.

---

## 2. Composition resolves from authority, never from a persona name

The dashboard is ONE framework with reusable modules, not six hardcoded screens. A module is
composed when, and only when:

- the viewer's governed context supplies its **scope** (employee id, technician binding, location
  assignment, business-unit / operating-company scope, or global), **and**
- the viewer's authority resolves its **fact** through that domain's own read, **and**
- the module's fact family is REPORTABLE at that scope.

Nothing branches on `role === "technician"`. The platform's own precedent for this is
`deriveScanWorkflows`, which is capability-derived and *cannot* receive a persona — and which also
supplies the pattern for the unavailable case: it returns the REASON for every unavailability, not
merely the absence.

**What personas are for here:** naming the composition, not gating it. "The technician dashboard" is
a description of what a person with a technician binding and no management scope ends up seeing.

---

## 3. The module inventory

Every module names its fact family from the census and the authority that serves it. **A module not
in this table does not ship**, and a module here does not ship until its authority resolves.

### 3.1 SAFE NOW — governed today, at existing scope, with no activation and no new decision

| Module | Fact | Authority | Scope | Section |
|---|---|---|---|---|
| `MyAssignedWork` | T-1, T-2 | `subscribeAssignedWorkOrders()` (PT-002) | `users/{uid}.technicianId` | CURRENT WORK |
| `MyRequiredActions` | T-6 | `getAllowedActions()` | own assignment | CURRENT WORK |
| `UnverifiedSubmissions` | T-9 | `useSubmissionQueue()` | own device | CURRENT WORK |
| `ServiceAttentionQueues` | SV-2, SV-4, SV-5, SV-6 | the three attention projections | admin/dispatcher | CURRENT WORK |
| `ReorderQueue` | W-6, P-5 | `useReorderRequestsByStatuses` | `{type:"location"}` | CURRENT WORK |
| `ReceivingQueue` | W-1, W-2, P-6 | `listReceivablePurchaseOrders`, `getPurchaseOrderReceivingProgress` | `inventory.stock.receive` | CURRENT WORK |
| `OpenPurchaseOrders` | P-1 | `fetchProcurementPurchaseOrders` | admin/dispatcher | CURRENT WORK |
| `AdminDecisionQueue` | A-1, A-2, A-3 | `listPrivilegedRoleRequests`, access-request and reset reads | global admin | CURRENT WORK |
| `AccountPortfolio` | C-1 | `getAccountPortfolioSummary` | `customer.record.read` | BUSINESS IMPACT |
| `WorkOrdersByStatus` | SV-1 | `subscribeToWorkOrders` / `operationsQueries` | admin/dispatcher | TEAM PERFORMANCE |
| `CompletedWork` | SV-10, T-2 | real persisted `completedAt` | per scope | PERFORMANCE |
| `MyPerformanceAllTime` | T-4 | `getTechnicianExecutionStats` | own technician id | PERFORMANCE |
| `TechnicianAvailability` | SV-7 | `readTechnicianAvailability` | admin/dispatcher | DRIVERS |
| `StalledJobRisk` | SV-17 | `jobRiskScoring` / `dispatchScoring` **under their own labels** | admin/dispatcher | DRIVERS |
| `StockForecast` | I-5, I-7 | `inventoryAnalyticsEngine` — **labelled DERIVED** | per surface | DRIVERS |
| `MovementCounts` | I-9 | `operationsQueries` | admin/dispatcher | TEAM PERFORMANCE |
| `GoalProgress` | Decision #162 | `listCurrentPerformanceGoals` + the metric's own domain read | per goal scope | PERFORMANCE |
| `GoTo` | X-6, T-7/W-11, A-4 | `navConfig` visibility + `deriveScanWorkflows` | per principal | GO TO |

### 3.2 GATED — the authority exists; a named activation or grant does not

Each renders an honest unavailable state naming its blocker. **These are built, not deferred** — the
unavailable state IS the deliverable until the blocker clears, and building the module now is what
makes clearing the blocker a one-line change rather than a project.

| Module | Fact | Blocker |
|---|---|---|
| `MyOpportunities` | S-1, S-2, S-3 | AB-3 — `opportunity.read` catalog-inactive, sandbox-overridden |
| `AgreementsAwaitingAcceptance` | S-6 | AB-3 — same posture (`DECLINED` is modelled but unreachable, ND-14: no "declined" tile) |
| `OrdersRequiringAction` | S-18, SV-15 | AB-7 — `fulfillment.coordinatedVisit.read` |
| `GovernedStockPosition` | I-1..I-4 | AB-1 — `INVENTORY_BALANCE_READ_READY` transport flag is false |
| `TransfersInFlight`, `CycleCountVariances` | I-13, I-14 | AB-4 |
| `PutAwayAndPicks` | W-4, W-5, T-8 | AB-4 |
| `MyBooked` | S-9 | AB-2 — booked has no bounded read at all; independent of period and of reach |
| `MyBilled` / `MyCollected` | S-10, S-11 | **AUTHORITY-READY since Decision #163.** Read, event time, reach and window all exist; what remains is per-environment capability activation, enforced at runtime |
| `FirmBooked` / `FirmBilled` | S-9, S-10, S-17 | as above; consolidated additionally `UNELIMINATED_SUM` (FIN-BLOCK-004), which G-05 does not touch |
| `AccountsReceivable` | C-4, F-2 | FIN-004 reach for principals other than admin/owner (SELF/TEAM are granted but not activated) |
| `FinancialApprovals` | F-13 | FIN-007 policy values undecided |

> **FIN-004 is no longer the blanket blocker this table first named.** The census finding that no
> Role carried a `finance.visibility.*` scope was **WITHDRAWN** (#1743): it was measured by grepping
> Role sources, which cannot see `admin`'s derived grants. Measured by resolver, admin and owner
> carry all five scopes and resolve CONSOLIDATED reach in sandbox; #1744 gave salesManager TEAM and
> salesperson SELF, neither yet activated. So the financial rows above are blocked by the REPORTING
> PERIOD and by their own read wiring — and the blocker sentence each module renders says so.

### 3.3 DO NOT BUILD — no authority exists, and building one would invent it

Reserved in this design as named absences so a later session does not re-derive them: first-time fix
(SV-11), service response / SLA (SV-12), callbacks (SV-13), parts-delay impact (SV-14), technician
utilisation (SV-8), work-order aging buckets (SV-9), jobs-per-workday (needs both a workday
denominator and a reporting period), AOV (S-12), pipeline value (S-4), stockout rate (I-8), inventory
aging (I-11), inventory value / turns / carrying cost (I-15..I-17), **waste avoided** (needs a
prevention event, a cost basis, AND a stated counterfactual), emergency-purchase rate, PO cycle time,
supplier on-time (G-12), cross-domain activity roll-up (X-4, Owner-retired), notification history
(X-5).

The performance metric registry carries the same list with each blocker named, so the dashboard and
the goal system cannot drift about what is measurable.

---

## 4. Per-persona composition

Each is the framework resolved against a governed context, listed as what that context yields.

### 4.1 Technician

```
CURRENT WORK       MyAssignedWork (ready / in progress / waiting / completed today)
                   MyRequiredActions · UnverifiedSubmissions
PERFORMANCE        GoalProgress          technician.workOrder.completed.cumulative.count  (AT_LEAST)
                                         technician.workOrder.open.count                  (AT_MOST)
                   MyPerformanceAllTime  completed · parts used · avg duration
                   — on-time, first-time-fix and jobs/workday reserved and UNAVAILABLE
BUSINESS IMPACT    UNAVAILABLE — no governed attribution from completed work to capacity or value
GO TO              reachable destinations + scan workflows, each with its reason when unavailable
```

**Do not reward throughput alone.** The direction is explicit that productivity, on-time execution
and quality must be visually balanced. Today only productivity is governed — so the section renders
three slots with two of them honestly unavailable and NAMED, rather than one big completion count
that reads as the whole of a technician's performance. The unavailable slots are the design's
statement that the platform knows the number is incomplete.

### 4.2 Salesperson

```
CURRENT WORK       MyOpportunities (GATED, AB-3) · AgreementsAwaitingAcceptance (GATED)
                   OrdersRequiringAction (GATED, AB-7)
PERFORMANCE        MyBooked vs My Goal · % attainment · remaining to goal   — ALL GATED (FIN-004)
                   GoalProgress renders the TARGET (governed today) beside an UNAVAILABLE actual
BUSINESS IMPACT    AccountPortfolio — governed today, and the section's only live figure
                   FirmBooked / FirmBilled (GATED)
GO TO              as above
```

**The direction's sixth finding applied:** Accounts must NOT become the headline merely because
dollars are gated. So the financial layer keeps the position and the visual weight it will have when
FIN-004 is granted, rendering as unavailable-with-reason; the portfolio count sits in BUSINESS
IMPACT where it belongs rather than being promoted to fill the hole. **A gated module holds its
place.** Re-ranking a dashboard around what happens to be available today teaches the reader that
availability is importance.

One thing worth stating because it is visible: the goal half of "% attainment" IS governed now, and
the actual half is not. The tile therefore shows a real target and an unavailable actual — which is
the honest shape of "we know what you should do and cannot yet tell you how you did".

### 4.3 Parts / Warehouse

```
CURRENT WORK       ReorderQueue (location-scoped) · ReceivingQueue · PO discrepancies
                   UnverifiedSubmissions · PutAwayAndPicks (GATED, AB-4)
PERFORMANCE        GoalProgress   parts.reorderRequest.open.count           (AT_MOST, LOCATION)
                                  receiving.purchaseOrder.receivable.count  (AT_MOST, LOCATION)
                   availability / accuracy / receiving-accuracy goals RESERVED, UNAVAILABLE
DRIVERS            StockForecast + stockout risk, labelled DERIVED
                   GovernedStockPosition (GATED, AB-1)
BUSINESS IMPACT    UNAVAILABLE — every candidate here is cost-dependent (FIN-BLOCK-003).
                   "Waste avoided" renders as a NAMED absence, never a number.
GO TO              as above
```

The waste-avoided slot is worth its space precisely because it is empty: it states what three things
are missing (a prevention event, a cost basis, a counterfactual), which is the difference between a
gap someone can close and a gap nobody knows exists.

### 4.4 Service Manager / Dispatcher

```
CURRENT WORK       ServiceAttentionQueues — past due · ready to schedule · conflicts · parts-blocked
TEAM PERFORMANCE   WorkOrdersByStatus (real lifecycle statuses only)
                   CompletedWork · per-technician comparison (governed columns only)
                   GoalProgress at FIRM scope for the four service queue metrics
DRIVERS            TechnicianAvailability (ABSENT IS NOT EMPTY) · StalledJobRisk under its own labels
BUSINESS IMPACT    UNAVAILABLE — capacity created / backlog reduced need a baseline nobody has set
GO TO              as above
```

**The manager comparison rule.** A comparison table may compare people only on governed metrics at a
common basis. Today that is: completed count and open assignment count. On-time, jobs/day and
first-time-fix are reserved COLUMNS rendered as unavailable — present so the table's shape is honest
about what it will be, absent of values so nobody reads a placeholder as a score. **No substitution,
and no ranking on a partial basis** — sorting people by the one metric that happens to be governed
would present a throughput league table as a performance review.

### 4.5 Operations Manager / General Manager / Owner

Everything the Service Manager sees, plus the parts/warehouse queues, plus `AccountPortfolio`, plus
FIRM-scope goal progress across the four service metrics, the reorder queue and receiving. The
financial layer is present and gated.

### 4.6 Administrator

`AdminDecisionQueue` (privileged role requests, access requests, reset-eligible users), environment
capability activation state (A-6), and GO TO. Deliberately NOT a performance dashboard: admin holds
no goal write verbs (Decision #162), and administering access is not a business function with a
target.

---

## 5. The identity rail (§P)

The bottom-left rail carries the authenticated identity: display name, the person's real governed
role label, and the existing logout. Data comes from `useAuth()` — the same hook `AppHeader` already
uses.

**It is not a role switcher.** It reflects; it does not select. There is no path from this component
to a different authority, and it widens nothing: the rail already receives `role` and
`operationalContext` for its visibility decisions and gains no new input.

---

## 6. The six corrections, applied

1. **"Work Orders by Status" contains statuses.** The chart is built from the real 11-value
   `WorkOrderStatus` enum and nothing else. `WAITING_ON_PARTS` and `COMPLETED_TODAY` are projections,
   not statuses; they appear in their own modules under their own labels. Mixing them makes the bars
   un-addable, and a reader adds bars.

2. **No stacked composition for overlapping conditions.** Past due, scheduling conflict and
   parts-blocked can co-occur on ONE work order. They render as independent counts. Stacking would
   claim a whole that does not exist and double-count the record that is two of them at once —
   mutual exclusivity has not been proven and must not be implied by a shape.

3. **The parts CTA names a command that exists.** There is no governed reconciliation command for a
   receipt discrepancy; `getPurchaseOrderReceivingProgress` surfaces over-received lines with their
   reasons and stops there. The CTA is therefore **"Review discrepancy"**, navigating to the receipt.
   An imperative for an authority the platform does not have is a promise the button cannot keep.

4. **"Open work orders" is not used as an aggregate.** No governed definition of the status set
   exists. The dashboard shows `WorkOrdersByStatus` — which is provable — and the specific attention
   queues, each with its own named predicate.

5. **Past due is labelled global.** `workOrderPastDueItem()` is applied globally and is deliberately
   NOT week-bound, so it is not a subset of today's or this week's scheduled work. The label says so.
   The alternative — quietly scoping the query to match a tidier label — would hide exactly the work
   that fell overdue outside the window someone happens to be viewing.

6. **The sales financial layer keeps its weight.** Covered in §4.2.

---

## 7. Honest states

The vocabulary is `HonestState`'s existing 13 values. The four this family uses, and the distinction
that matters most:

| State | When | Never |
|---|---|---|
| `UNKNOWN` | the answer is genuinely not known (an ATP with an unknown on-hand) | rendered as `0` — there is no count slot on this branch, by construction |
| `DENIED` | outside the viewer's governed reach | phrased as an apology, or as an error a retry would fix |
| `NOT_ENABLED` | the authority exists, activation does not | a lock farm — one sentence, once |
| `UNAVAILABLE` | the fact family has no authority yet | as "none" or "0" |

**Three absences a goal module must draw differently** — the read service returns them separately for
exactly this reason: *no target has been set* (an honest empty, and an invitation to a manager),
*outside your reach* (a permission fact), and *a target exists but could not be resolved* (a data
defect, never shown as "no goal").

Every unavailable state NAMES its blocker in one sentence. "Cost authority not available" beats
"Unavailable", because the first tells a reader what would have to change.

---

## 8. 1440 and 375

Same authority, same modules, same order. Width chooses composition, never authority — the shipped
rule from `useIsPhone.js`.

**1440:** rail + workspace. `WorkspaceShell` with `ContextBand` for the situation line and
`AttentionBand` for ACTION_ITEMs. Sections are `RuledSection`s, not a card farm. Stat values at the
32px KPI tier; charts inside `overflow-x: auto` containers so the page body never scrolls sideways.

**375:** single column, and the order is the product decision. **CURRENT WORK first, always.** A
technician on a phone is standing in front of a machine; performance and impact are below the fold
and that is correct. Goal tiles collapse to one per row at the 24px handheld KPI tier. Charts that
cannot survive the width are replaced by their own summary line rather than shrunk into
illegibility — a chart nobody can read is worse than the sentence it was drawn from. The mobile tab
bar keeps its existing behaviour, including hiding while an input has focus.

**What must survive 375, non-negotiable:** every ACTION_ITEM, every goal's target-and-actual pair,
and every unavailable state's reason. Truncating the reason to fit is how an honest state becomes a
blank.

---

## 9. What this design does not do

- It does not redesign the visual system, add a token, or alter the hover contract.
- It does not mount a shell-wide global search. Global search is a separate workstream: the existing
  `GlobalSearch` is reachable in exactly one place (`PartsList`), its `accounts` and `workOrders`
  providers have no caller and must not gain one on a bounded list, and true site-wide search needs
  domain-authorized server-side providers that do not exist. Mounting an incomplete shell search to
  match a mockup would search one page and report "no results" for records that plainly exist.
- It does not introduce a charting library. The repository has none; charts are hand-rolled SVG, and
  series colours are the one permitted departure from the token schema — labels and axes are not.
- It does not create a dashboard read authority, a dashboard capability, or a dashboard-local
  calculation of anything.
