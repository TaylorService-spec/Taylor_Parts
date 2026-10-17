# Employee Work Schedule, Scheduler→Employee Navigation, Compact Board — Investigation & Design

Issued: 2026-10-15 (America/Phoenix) · base `a1261486` · branch `work/eos-employee-shift-schedule`
Status: **DESIGNED — awaiting Owner approval.** No code, schema, capability, role or business-rule change is made by this document.
Developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools.

Owner requirement: "EOS — Employee shift hours and scheduler navigation" (2026-10-15). Deliverables 1–6 follow in order.
Decisions needing the Owner are labelled **SCH-D1 … SCH-D4** (§3.4). Each has a recommendation. Everything else is presentation work inside an approved architecture, and those choices are logged in §3.5.
Added 2026-10-15: "EOS — Dispatch Map functionality review", covered in §7. Its Owner decisions are **MAP-D1 … MAP-D4**.

---

## 1. Where the displayed hours come from

### Verdict

The **"7a–4p"** under each technician's name comes from **governed EOS Core PostgreSQL records keyed by Employee ID**. It is **not** hardcoded, it is **not** a column on the Employee record, and it is **not** Firebase.

The values themselves are **SAMPLE data written by the nonprod seed**. No user interface writes working hours today.

There is a separate hardcoded **7a–5p display band**. It sets which hours the grid header draws, and it is not shift hours (see gap G-4).

| Candidate source (from the requirement) | Finding |
|---|---|
| Employee records (`eos_workforce.employees`) | No hours column. Only the Employee identity and `operating_company_id` the schedule is keyed to. |
| Scheduling configuration | **YES, this is the authority.** `eos_workforce.technician_working_schedules` (header: Employee, optional operating company, IANA time zone, `[effective_from, effective_to)`) plus `eos_workforce.technician_working_hours` (weekday intervals, local wall-clock). See `functions/migrations/1764320000000_technician-availability.sql`. Owner DECISION 5 (2026-09-30). |
| Availability rules | Derived from the tables above, not stored separately. `effectiveCalendar()` applies precedence: a company-specific schedule beats a company-wide one, and the newest recorded schedule wins for the dates it covers (`functions/src/eosOps/workOrderAvailability.ts:303`). |
| Hardcoded defaults | Only the **display band** `DAY_BAND_START_HOUR = 7` / `DAY_BAND_END_HOUR = 17` (`field-ops-app-vite/src/domain/dispatchBoardGeometry.js:41-42`). It is never used as a technician's hours. A technician with no schedule already reads **"Shift not recorded"** with no percentage (`DispatchLaneGrid.jsx:275`). |
| Existing shift / calendar tables | `eos_workforce.technician_unavailability` holds dated exceptions with kinds `PTO, LUNCH, TRAINING, MEETING, TRUCK_SERVICE, UNAVAILABLE, COMPANY_CLOSURE` (`workOrderAvailability.ts:75`). The Firestore `technician_working_availability` / `technician_blocked_time` tables are **retired**; nothing was backfilled from them (migration header; `services/schedulingCommandClient.js:1-7`). |
| Where the values were written | `functions/scripts/seedTaylorNonprodWorkforce.mjs:267-273` calls `setTechnicianWorkingHours` for every seeded service technician: `America/Phoenix`, Monday–Friday `07:00–16:00`, reason "SAMPLE". `functions/scripts/sandboxDispatchFixtures.js:28` holds the same shift for older sandbox fixtures. **Production relations start empty** (migration: "NO SEED ROWS AND NO BACKFILL"), so production lanes read "Shift not recorded" until hours are recorded. |

### Code path (read)

1. `DispatcherBoard.jsx:120-139` builds the availability window for the current view (Day = 1 day; Week = −7…+14 days; 2 Weeks = −7…+21 days) and calls `useTechnicianAvailability`.
2. `hooks/useTechnicianAvailability.js:58` calls `services/schedulingCommandClient.js` `readTechnicianAvailability`, which calls `services/workOrderService.ts:577` `run("readTechnicianAvailability")`, which posts to `POST /operations/work-orders` (EOS API).
3. On the server, `workOrderOperations.ts` dispatches to `readTechnicianAvailability` (`workOrderAvailability.ts:783`). That operation:
   - requires `workOrder.lifecycle.schedule` **or** `workOrder.lifecycle.dispatch` (`:481`);
   - loads schedules, hours and unavailability (`:323`, `:370`);
   - returns per Employee: `availabilityState`, `workingAvailability` (the schedule governing at the **start** of the range), `schedules`, `workingIntervals`, `notConfiguredIntervals`, `blockedTime` and `availableMinutes`.
4. The client normalizes the response (`schedulingCommandClient.js:~100-110`; it keeps `workingIntervals` and `notConfiguredIntervals`).
5. `DispatchLaneGrid.jsx:90` calls `shiftLabel(availability, band)` (`dispatchBoardGeometry.js:289-299`). That reads `workingAvailability.weeklyHours[weekday]` and formats `"07:00"`→`"7a"` (`:302`).

### Code path (write)

`setTechnicianWorkingHours` (`workOrderAvailability.ts:598`) requires `workOrder.lifecycle.schedule` (`:480`) and is append/close-only (database triggers enforce this). `recordTechnicianUnavailability` and `endTechnicianUnavailability` require the same capability. All three are exported by `schedulingCommandClient.js:139-145`, but **no component imports them**. The only writer is the seed script.

### Gaps found (no change made)

| ID | Gap | Evidence |
|---|---|---|
| G-1 | **No user interface records or views a schedule.** Employee Administration has no schedule surface. The commands exist with no consumer. | grep: no component imports `setTechnicianWorkingHours`, `recordTechnicianUnavailability` or `endTechnicianUnavailability` |
| G-2 | **The board never draws nonworking or unconfigured time.** The server sends `workingIntervals` and `notConfiguredIntervals`, and the lane ignores both. Today "outside the shift" looks the same as "open, bookable". | `DispatchLaneGrid.jsx:110-232` renders only past time, blocked time and work orders |
| G-3 | **Elapsed time and unavailable time use the same diagonal hatch.** The `--past` style is a 135° repeating gradient at 0.55 opacity, from the same family as blocked time, so the two are visually conflated. | `index.css:7026-7033` vs `index.css:6763-6769` |
| G-4 | **The display band defaults to 7a–5p, whatever the schedules say.** A lane whose shift is 05:00–13:00 draws 05:00–07:00 off the band's leading edge. The grid widens only for work orders and blocked time. | `dispatchBoardGeometry.js:65-92` |
| G-5 | **The shift label is computed in the browser's time zone, not the schedule's.** `new Date(band.startMillis).getDay()` picks the browser-local weekday and then reads the schedule's local `weeklyHours`. The label also uses only the schedule governing at the start of the range, so a schedule that changes mid-week mislabels later days. This is correct only while viewer and schedule are both in Phoenix. | `dispatchBoardGeometry.js:290-293`; `workOrderAvailability.ts:828-830` |
| G-6 | **Board state is held in component state.** View, date and technician filter are lost on any navigation, so a "return" to the board resets to today. | `DispatcherBoard.jsx:101-116` |
| G-7 | **Lane names are plain text.** | `DispatchLaneGrid.jsx:99` |
| G-8 | **One-day adjusted shifts cannot be expressed.** Unavailability can only *remove* time. Extending or moving one day's hours means ending and replacing the weekly schedule, and a bounded schedule cannot be inserted: `technician_working_schedules_end_is_complete` makes a set `effective_to` imply "ended". | migration `1764320000000`; `workOrderAvailability.ts:598-680` |
| G-9 (company boundary, for the security lane) | `setTechnicianWorkingHours` checks only that the `operatingCompanyId` is ACTIVE for the tenant (`:538-544`). It does not check that the Employee works for that company, or that the caller's company authority covers it. The DECISIONS #235 rollout should cover these operations. **This lane does not change company-authority code.** | `workOrderAvailability.ts:616-621` |
| G-10 | A holder of `employee.record.read` that is **only operating-company-scoped** does not appear in the flat Workforce capability offer, so such a caller would get no link (fails closed). | `employeeReadKernel.ts:63,127`; `myWorkforceCapabilities.ts` |
| G-11 (found while building PR-1) | **The 2-week band divided each day's bookings by the available minutes of the whole four-week read.** Every day therefore looked nearly empty. | `DispatchViews.jsx` (`laneCapacity(availability, …)` per day) |

---

## 2. Existing Employee Administration schedule capabilities

**None.** The Employee record is `/administration/users/:employeeId`, defined at `App.jsx:1165-1172`. It is mounted only when `isDomainVisible(administration)`, and the record read is governed by `employee.record.read` through `runEmployeeRead`. It has five URL tabs (`?tab=`, `UserDetail.jsx:49`): Overview, Roles & Access, Assignments, Workflows and Activity. None of them reads or writes working hours or unavailability.

Write controls are offered from `readMyWorkforceCapabilities` (`UserDetail.jsx:156-167`; list in `myWorkforceCapabilities.ts`), and that list contains no scheduling capability. The schedule authority belongs to the Work Order authority (`workOrder.lifecycle.schedule`), which Owner DECISION 5 deliberately kept in the "dispatcher bucket" with **no new capability**.

The schedule model already covers most of the requirement:

| Requirement | Existing EOS Core support |
|---|---|
| Operating company | ✅ `operating_company_id` per schedule (NULL = every company). Precedence is in `effectiveCalendar`. |
| Working days | ✅ weekday keys `"0"…"6"` |
| Shift start/end | ✅ `start_time` / `end_time`, local wall-clock; `24:00` is allowed |
| Breaks | ✅ for recurring breaks: up to 6 intervals per weekday, and a gap is a break (`MAX_INTERVALS_PER_WEEKDAY`). One-off breaks use the `LUNCH` unavailability kind. |
| Time zone | ✅ IANA zone per schedule, validated |
| Effective dates | ✅ `effectiveFrom` (no past dates), close-only `effective_to`; `weeklyHours: null` plus a reason ends a schedule |
| Exceptions: PTO | ✅ `technician_unavailability` kind `PTO` (plus TRAINING, MEETING, TRUCK_SERVICE, UNAVAILABLE, COMPANY_CLOSURE), ≤90 days, end-only |
| Exceptions: adjusted shift | ⚠️ only *reductions*, via unavailability. Extending or moving a day is not supported (G-8 → SCH-D3). |
| History / audit | ✅ append/close-only, enforced by database triggers; every row records who, when and why |

---

## 3. Proposed changes and data migration

### 3.1 Principle

Employee Administration becomes the **place where people see and manage** a schedule. It does **not** become a second authority. The tables, commands, precedence and refusal rules stay where they are (`eos_workforce.technician_*` and `workOrderAvailability.ts`). No Firebase. No parallel store. The board keeps reading the same `readTechnicianAvailability`.

### 3.2 Employee Record → Work Schedule tab (UX)

Add a sixth tab, `?tab=schedule`, "Work Schedule", to `UserDetail.jsx`. Its body is one new component, `modules/administration/EmployeeWorkSchedule.jsx`:

- **Current schedule** (compact definition grid): time zone · applies to (*All companies* / company name) · effective from · weekly grid of Sun–Sat rows, each showing intervals like `7:00a–12:00p · 12:30p–4:00p`, where the gap reads as "30 min break".
- **Upcoming / history**: schedules ordered by `effective_from`, each with an *ended by / why* line. Read-only.
- **Exceptions** (next 90 days): PTO and other unavailability, with kind, window and reason, plus an "End early" action (it calls `endTechnicianUnavailability` and requires a reason).
- **Edit schedule** (only when the caller holds the write capability, per SCH-D1). This is a form for a new schedule effective from a date: time zone, applies-to company, per-weekday intervals, and a reason. Submitting calls `setTechnicianWorkingHours`. It never edits in place, because the server supersedes.
- **Add exception**: kind, start, end and reason, sent to `recordTechnicianUnavailability`.
- **No governed schedule**: an honest state reading "No working schedule recorded. The scheduling board shows this person as *Shift not recorded* and placements are refused (AVAILABILITY_NOT_CONFIGURED)." It shows *Record schedule* if the caller can write. No default hours are pre-filled as a fact. The form may *offer* a "copy Mon to Tue–Fri" helper, and nothing is saved without an explicit submit.
- It reuses `RuledSection`, `StructuredFields`, `HonestState` / `EmptyState` and form primitives (the Lane UX compact standard). No new shared component.

### 3.3 Data model and migration

- **PR-1 to PR-3 need no migration.** Every field the requirement lists, except one-day adjusted shifts, already exists (§2).
- **Only if SCH-D3 = A:** an **additive** migration, `technician_working_day_overrides`. It holds the Employee, an optional operating company, a local date and a time zone, plus child interval rows. It uses the same append/end-only triggers and the same reason, recorder and ender columns. No existing table is changed and there is no backfill. `effectiveCalendar` gains one precedence rung: **day override > company schedule > company-wide schedule**. That rung is a business-rule change, and it would be reviewed with ND-20/24 placement-policy tests. A day off is still expressed as `PTO`/`UNAVAILABLE`, not as an override.

### 3.4 Owner decisions

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| **SCH-D1** | Which permission controls **schedule edits** from the Employee record? ("Edit permission controls schedule changes.") | **A.** Keep `workOrder.lifecycle.schedule`, the current server authority (DECISION 5). The tab offers editing only to holders, using `readMyWorkOrderCapabilities`, which already exists. No permission change. · **B.** A new `admin.employeeWorkSchedule.write`, accepted by the three commands alongside or instead of A. This is a capability, role and migration change (Tier-2). · **C.** Require `admin.employeeProfile.write` **and** A. This changes a server rule. | **A** now. B only if HR, rather than dispatch, should own schedules, as its own reviewed change. |
| **SCH-D2** | Who may **view** the Work Schedule tab? | **A.** Same as today's read: `workOrder.lifecycle.schedule` or `.dispatch`. A record viewer without those sees "Schedule visible to scheduling roles". No change. · **B.** Also accept `employee.record.read` through a new single-Employee read, `readEmployeeWorkSchedule`. This widens who can read schedule data (an authorization change, so review is needed). | **A** in PR-2. Take B if the Owner wants HR-only admins to see hours. |
| **SCH-D3** | **Adjusted shifts** (extend or move one day) | **A.** The additive override table (§3.3) plus one precedence rung. · **B.** Defer: managers end and replace the weekly schedule, and reductions use unavailability. | **A** as a separate PR-4 after PR-1 to PR-3 land. |
| **SCH-D4** | **Scoped** `employee.record.read` holders (G-10) | **A.** No link for them (fails closed) until the Workforce offer reports scoped holdings. · **B.** Extend the offer with per-company holdings. | **A**. B belongs with the security lane's #235 work. |

**Owner rulings (2026-10-15):**
- **SCH-D1 APPROVED**: the existing scheduling capability controls edits.
- **SCH-D2 APPROVED, as amended**: scheduling roles **intersected with** Employee and company read visibility. The PR-2 read therefore needs both:
  - `workOrder.lifecycle.schedule` or `workOrder.lifecycle.dispatch`;
  - the caller's Employee record visibility (`employee.record.read`) and the #235 company authority (`resolveCompanyAuthority`, `functions/src/eosOps/companyAuthority.ts`) covering that Employee's operating company.

  Missing either one shows the refused state, never a partial schedule.
- **SCH-D3 APPROVED**: one-day overrides are deferred to a separate PR-4.
- **SCH-D4 APPROVED**: unauthorized Employee links fail closed.

Also ruled:
- Presentation-only board corrections may begin; that is PR-1.
- **Work Schedule editing (PR-2) stays blocked until the G-9 server-side company protection is proven.** G-9 belongs to the security lane, and the Scheduling lane does not implement it.
- Presentation, the schedule UI, navigation and the optional migration stay separate PRs.

### 3.5 Decisions taken under governance (presentation-only; logged here)

1. Recurring breaks are **interval gaps**, and one-off breaks are the `LUNCH` unavailability kind. Paid and unpaid break accounting is out of scope (Technician Labor + Cost Accounting is deferred).
2. *(As built in PR-1.)* The board's display band is the 7a–5p drawing window **widened** by every lane's working intervals, as well as by placements and blocked time. It is never narrowed below that floor. A stable window keeps the hour header familiar, and existing placements outside it still widen the band so they are drawn. Under DECISION 5, which supersedes ND-20 for EOS, the server **refuses** placements outside recorded hours (`OUTSIDE_WORKING_HOURS`), and the board offers no extra targets for them. The window is never used as anyone's hours: minutes outside a recorded shift are drawn as *not working*, and lanes without a schedule are drawn as *no schedule*.
3. The lane label is derived from the server's `workingIntervals` for the drawn day. This fixes G-5 with no server change.

---

## 4. Scheduler → Employee navigation

**Link target:** `/administration/users/{employeeId}?tab=schedule&returnTo={encoded board URL}`

- `employeeId` is the lane id. The lanes come from `listWorkOrderTechnicians`, whose ids are Employee ids (`DispatcherBoard.jsx:95-96`). The link never uses a name.
- `returnTo` is accepted only when it is a same-app relative path starting `/service/dispatcher-board`. Anything else is ignored, which closes the open-redirect risk. The Employee record shows "← Back to Dispatcher Board" when `returnTo` is valid; otherwise there is no back control and the browser's Back still works.

**Return state = the URL.** Move the board's view, date and filter into query params on `/service/dispatcher-board`. That fixes G-6 for Back, refresh and links:

| Param | Today (`useState`) | Encoding |
|---|---|---|
| `view` | `DISPATCH_VIEW.DAY` (`:101`) | `day` · `week` · `fortnight` · `map`; unknown → `day` |
| `date` | `anchorMillis` (`:102`) | local `YYYY-MM-DD`; invalid → today |
| `techs` | `technicianFilter` (`:116`, `null` = all) | comma-separated Employee ids; absent = all (preserves the "new technician never silently hidden" rule) |

Writes use `setSearchParams(…, { replace: true })` for date stepping, so Back is not flooded, and push for view changes. Selection and drag state stay in memory.

**Authorization matrix.** The link is a convenience; the server still decides.

| Caller holds | Board | Name on lane | Employee record | Work Schedule tab | Edit schedule |
|---|---|---|---|---|---|
| `service.dispatch` surface only (scheduler) | ✅ | **plain text, no link** | ❌ route not mounted | — | — |
| scheduler + Administration domain + flat `employee.record.read` | ✅ | **link** | ✅ | ✅ (holds schedule/dispatch) | only with `workOrder.lifecycle.schedule` (SCH-D1 A) |
| `employee.record.read` + Administration, no schedule/dispatch | n/a (no board) | — | ✅ | "visible to scheduling roles" (SCH-D2 A) | ❌ |
| scoped-only `employee.record.read` | ✅ | plain text (SCH-D4 A) | server decides per record | — | — |

The link is shown when **both** of these are true: the caller can reach the route (`isDomainVisible(administration)`, the same check that mounts it in `App.jsx:1165`), **and** `useWorkforceCapabilities().has("employee.record.read")`. While either answer is loading or failed, the link is not shown. Being able to see the scheduler never grants Employee Administration access. If the server refuses the record, the record page shows its own existing denial.

---

## 5. Compact board: before / after

**Before (Day view, today 10:40a; Tech B has PTO 1–3p; Tech C has no schedule)**

```
          7a    8a    9a    10a   11a   12p   1p    2p    3p    4p
Tech A    ////////////////////|[WO-12 PM ]                             7a–4p · 25% booked
7a–4p · 25% booked
Tech B    ////////////////////|            [///PTO///////]             7a–4p · 2h blocked
Tech C    ////////////////////|      [WO-15]                           Shift not recorded · 2h booked
```

`////` covers both elapsed time (all lanes) and PTO with the same diagonal hatch. Time outside the shift (4p–5p) looks bookable. Tech C's lane looks just like a working lane.

**After**

```
          7a    8a    9a    10a ┃ 11a   12p   1p    2p    3p    4p ░5p
Tech A ↗  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒┃[WO-12 PM ]                      ░░░░   7a–4p · 25% booked
Tech B ↗  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒┃            [▚ PTO ▚▚▚▚▚▚]       ░░░░   7a–4p · 2h blocked
Tech C ↗  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┃┄┄┄┄┄┄[WO-15]┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄   ⚠ No schedule · 2h booked
Legend: ▒ elapsed  ░ not working  ▚ unavailable (PTO, training…)  ■ booked  ┄ no schedule recorded  ┃ now
```

| State | Treatment (tokens only; no new hex) | Notes |
|---|---|---|
| **Elapsed** (today, before now) | flat `var(--color-surface-sunken)` at ~0.45 opacity, **no pattern**. Work-order chips in the elapsed region drop to 0.85 opacity. | Replaces `index.css:7026-7033`. Still `pointer-events:none`; drop refusal is unchanged (`isSlotSelectable`). |
| **Not working** (configured, outside `workingIntervals`, including breaks) | solid `var(--verenward-stone-sunken)` | New, from `workingIntervals` (G-2). The server refuses placements here (`OUTSIDE_WORKING_HOURS`, DECISION 5). |
| **Unavailable** (blocked time) | **keeps** the existing 135° hatch, and is now the *only* hatched thing | Unchanged rules at `index.css:6763-6769`; the legend swatch stays bound to the same rule. |
| **Booked** | unchanged evergreen chip | — |
| **No schedule recorded** (`notConfiguredIntervals`) | 1px dashed top/bottom lane border, no fill; the name cell shows a compact `⚠ No schedule` marker (an InfoTip: "No governed working schedule. Placements are refused until one is recorded.") that links to `?tab=schedule` when the link rule in §4 passes | Never a default shift. The lane-line text "Shift not recorded" is shortened to "No schedule". |
| **Now** | a 2px `var(--color-brand-accent)` vertical line across header and lanes, `z-index` above chips, `aria-hidden`, with an `sr-only` "Current time 10:40 AM" in the header | Today only; refreshes each minute. |

The prose rule paragraph (`DispatcherBoard.jsx:526-532`) becomes the one-line legend above, which saves vertical space. The keyboard hints stay in the chip `title` and `aria-keyshortcuts`, plus a single "Keyboard" InfoTip. Week and 2 Weeks get the same elapsed / unavailable distinction on past days. Day cells with no schedule show the dashed treatment, never 0%.

---

## 6. Implementation PR plan

Each PR is verified locally (unit tests plus a Vite fixture screenshot), pushed once, and merged only with Owner approval. All PRs touch Scheduling-lane paths only. `DispatchViews.jsx:47,74` holds the Lane A2 view-chip semantics. Line 74 is the Map button's `role="tab"`, so the interim Map fix (§7.4) touches the same element. PR-1 therefore rebases on A2 when A2 lands first. If A2 has not landed, Lane A is asked to carry that one-element change instead.

| PR | Scope | Files | Tests | Gate |
|---|---|---|---|---|
| **PR-1 Board: compact states + URL state** (presentation only) | §5 treatments; band from working intervals; label from `workingIntervals` (G-2, G-3, G-4, G-5); now-line; missing-schedule marker (no link yet); `view`/`date`/`techs` query params (G-6); **interim Map fix (§7.4)**: the Map tab is visibly unavailable and `view=map` falls back to Day | `dispatchBoardGeometry.js`, `DispatchLaneGrid.jsx`, `DispatcherBoard.jsx`, `DispatchViews.jsx` (cell classes plus the Map button), `index.css` `.ns-dispatch*` | `dispatchBoardGeometry` unit tests: `nonWorkingSpans()` (break gap, overnight, unconfigured vs working), band union and fallback, label across a mid-week supersession and a non-Phoenix browser zone, `nowLinePercent`. Component tests: elapsed has no pattern class; blocked keeps hatch; unconfigured lane shows the marker and no %; URL round-trip (`?view=week&date=…&techs=…`), unknown params fall back. Map: the button has `aria-disabled="true"` and a reason linked by `aria-describedby`; activating it does not change the view; `?view=map` renders Day. Existing "absent is not empty" tests stay green. | Owner visual review of before/after screenshots |
| **PR-2 Employee Work Schedule tab** (read + existing write commands) | §3.2 tab; editor and exceptions over the **existing** commands; offer gated by SCH-D1 A / SCH-D2 A | new `EmployeeWorkSchedule.jsx`, one tab entry in `UserDetail.jsx`, a pure `domain/employeeWorkSchedule.js` (form ↔ `weeklyHours`, break gaps) | Domain: weekly-grid ↔ `weeklyHours` round-trip, overlap and 6-interval limits mirror the server refusals, the no-default rule (an empty form submits nothing). Component: no-schedule honest state; read refused shows the "scheduling roles" state; editor hidden without `workOrder.lifecycle.schedule`; the submit payload equals the command contract; each server refusal code renders its sentence. Postgres: existing `workOrderAvailabilityPostgres.test.mjs` unchanged. | SCH-D1, SCH-D2 |
| **PR-3 Scheduler → Employee links** | §4 link plus `returnTo`; the marker links to `?tab=schedule` | `DispatchLaneGrid.jsx`, the Week/2 Weeks identity cells, `UserDetail.jsx` back control, a tiny `safeReturnTo()` | Link is present only with Administration visible **and** `employee.record.read`; absent while loading or failed; href uses employeeId (a name change does not change the href); `returnTo` rejects absolute, protocol-relative and non-board paths; Back restores view, date and filter (router test). | SCH-D4 |
| **PR-4 (optional) Adjusted-shift overrides** | additive table plus a precedence rung plus `set/endTechnicianDayOverride` commands plus a tab section | migration, `workOrderAvailability.ts`, tests | Postgres: precedence (override > company > company-wide), append/end-only triggers, placement accept/refuse inside an extended day, read surfaces the override in `workingIntervals`. | SCH-D3 = A; schema plus business-rule review |

**PR-1 as built (2026-10-15).**
- **Frames.** Before and after renders of the real board with synthetic fixture data are in `docs/design/scheduling-board/frames/` (`before-day`, `after-day`, `before-week`, `after-week`). They come from `field-ops-app-vite/test/__visual__/renderDispatcherBoard.test.jsx` (`VISUAL=1`), so no server or credentials are involved.
- **Fixed alongside:** G-11 (the 2-week denominator). The unreachable placeholder map view and its CSS were removed.
- **Not in PR-1:** the Lane UX `InfoTip` component, which is still in open PR #2106. The marker and the Map reason therefore use `title` plus screen-reader text, and swap to `InfoTip` once #2106 merges.

**PR-2 as built (2026-10-16, on main 5e4afa12, which includes G-9 #2111).** Editing activation, merge and deploy are held by the Owner until the controlled G-9 proof passes and PR-2 is separately approved.
- **Server: one new read and nothing else.** `readEmployeeWorkSchedule {employeeId}` is on the Work Order route (`workOrderAvailability.ts`). There is no schema, capability, role or grant change.
  - **Gate (SCH-D2 as amended), all checked server-side:** `workOrder.lifecycle.schedule` or `.dispatch`; AND flat `employee.record.read`; AND `resolveCompanyAuthority` covering the Employee's company.
  - **Refusals:** an Employee outside the caller's companies is refused exactly like a nonexistent one (`EMPLOYEE_NOT_FOUND`, the G-9 rule). Empty authority is refused with `COMPANY_AUTHORITY_REQUIRED`. A holder of `employee.record.read` that is only assignment-scoped fails closed (SCH-D4).
  - **Returns:** schedules newest first, each with a `CURRENT` / `UPCOMING` / `ENDED` status, capped at 50 with `schedulesHasMore`. Also the exceptions overlapping the last 30 days and the next 90.
  - **Same tables, same loaders.** It reads through `loadSchedules` / `loadUnavailability`. It deliberately does **not** use `readTechnicianAvailability`, which is not company-isolated (#2110).
- **Frontend:**
  - an Employee record **Work Schedule** tab (`?tab=schedule`);
  - `EmployeeWorkSchedule.jsx`;
  - a pure `domain/employeeWorkSchedule.js`;
  - the fail-closed seam `config/employeeScheduleReadiness.js`.

  Behaviour:
  - A refusal renders as a refusal. The no-schedule state never shows hours.
  - The edit controls render only when `EMPLOYEE_SCHEDULE_EDIT_READY` is true **and** the caller holds `workOrder.lifecycle.schedule`. The flag is absent from `config/environments.json`, so it is false everywhere. While it is false, the tab makes no capability call and no command call.
- **Verification:**
  - Postgres (PG16): the new subtest in `workOrderAvailabilityPostgres.test.mjs`, plus 9 related Work Order suites, all pass.
  - Frontend: `employeeWorkSchedule.test.mjs` 9/9 and `employeeWorkScheduleTab.test.jsx` 11/11, plus the full suites.
- **Still open:** board and availability-read isolation is **not** provided by G-9 or by this PR (#2110 and follow-ups).

**PR-3 as re-scoped and built (Owner, "WORK HOURS AND PTO ENTRY", 2026-10-17).** #2118 made a lane NAME open the in-board technician review, so the §4 "name is the link" design was replaced:
- **Board entry point:** a secondary **Work schedule** link in the review panel, and the **No schedule** marker becomes a link.
- **Gating:** both are offered only when the Employee record route is mounted for the caller (`employeeRecordsReachable`, passed from `App.jsx` with the route's own `isDomainVisible(administration)` gate) AND the caller holds flat `employee.record.read`. They fail closed, and make no Workforce call without Administration.
- **The `back` parameter** carries the board's full address, including the open review. The record's **Back to the board** accepts only a board address (`domain/employeeScheduleLink.js` `safeBoardReturn`).
- **Activation:** in the same PR, editing is activated on nonprod only (`platform-sandbox`), per DECISIONS #238.

**Not in scope:** company-authority enforcement on the schedule commands (G-9, security lane / #235); production schedule data entry (an operator task after PR-2 ships); Firebase anything; the functional Map (§7, separately approved).

---

## 7. Dispatch Map: functionality review (Owner finding, 2026-10-15)

**Finding confirmed.** "Map · locations" is an active-looking tab that switches to a text placeholder. There is no map library, no provider, no coordinates, and no read that returns job addresses for a list of jobs. **The mapping infrastructure is missing**, so this section is a proposal only (§7.3). The one presentation change is the interim fix in §7.4, which is folded into PR-1.

### 7.1 The five questions

| # | Question | Answer and evidence |
|---|---|---|
| 1 | Does a map component exist? | **No.** `DispatchMapView` (`DispatchViews.jsx:254-275`) renders one paragraph: "Location-based dispatch is not available…". There is no map, tile, or canvas code. No source file imports leaflet, maplibre, mapbox, Google Maps or a geocoder. The only mention is a legacy Firebase `jobActions.js:24-28` comment: "`geo` (lat/lng) is intentionally not implemented yet". |
| 2 | Does the button act? | It switches the view: `onClick={() => onChange(DISPATCH_VIEW.MAP)}` (`DispatchViews.jsx:72-82`), which sets `view = MAP` (`DispatcherBoard.jsx:101`). That turns off the availability read (`:138`) and renders the placeholder (`:648`). So it looks active, is announced as a selectable `role="tab"`, and leads nowhere useful. |
| 3 | What data exists? | **Jobs:** `eos_ops.work_orders` has `operating_company_key`, `customer_id`, `location_id` (NOT NULL), `status`, `work_order_type`, `scheduled_start/end`, and the current assignee (migration `1761004800000:66,72,86,87,92`). **Addresses:** `eos_crm.account_locations` has `address_street/city/state/postal_code` and `access_notes`, but **no country and no latitude/longitude** (migration `1758758400000:251-262`). **The list read** (`listWorkOrders`, `SUMMARY_SELECT` at `workOrderQueries.ts:92-105`) returns `location_name` only, **not** the address. The address comes only from the single-record detail read (`:175`). **Warehouses:** there is no address column. **Technicians:** no position, base or GPS data exists. Employees do have personal `address_*` fields (migration `1759838400000:92-93`), and these must **never** be mapped. |
| 4 | Is a mapping provider configured? | **No.** `field-ops-app-vite/package.json` has no map dependency. `functions/package.json` has none either; `@google-cloud/secret-manager` is unrelated. The repo has no `.env*` example for the app or the API. The only one is `integrations/chatgpt-eos-intake/.env.example`, which is unrelated. No variable named `*MAP*`, `*GEO*`, `*GOOGLE*` or `*MAPBOX*` exists. |
| 5 | What visibility applies? | **Board route:** `/service/dispatcher-board`, surface `service.dispatch` (`navConfig.js:316,775`). **Job list:** `listWorkOrders` requires `workOrder.record.read` held unconditionally (`workOrderQueries.ts:200`) and filters **only by tenant** (`:239`), so it is tenant-wide across operating companies. This is the tracked company-isolation gap. DECISIONS #235 and `companyAuthority.ts` are **not on `main` at `a1261486`**; they are on the security lane's branch. **Detail views:** pins would open `/service/work-orders/:workOrderId` (`App.jsx:1217`, governed by the Work Order read) and `/customers/:accountId` (`App.jsx:1124`, mounted only when the Customers domain is visible, and its own read re-checks access). |

### 7.2 Required behaviour vs. what exists

| Owner requirement | Status |
|---|---|
| Map separate from route optimization | ✅ by design: display only. No routing, travel time or sequencing. |
| Functional map of permitted job locations | ❌ blocked: needs coordinates, a provider and a map read (§7.3) |
| Pin opens the governed Work Order or customer record | Designable: link by `workOrderId` / `customerId`; the customer link is shown only when the Customers domain is visible |
| Date, technician, company and status filters | Server filters exist for status, window and assignee. The company filter waits on #235. |
| Distinguish scheduled, unscheduled and location-unavailable | Designable once each job carries `coordinates: null` plus a reason |
| No fabricated coordinates; no implied live GPS | Enforced by the proposal: only job **sites**, labelled as such |
| Company isolation and server permissions preserved | ⚠️ the list is tenant-wide today. **The map must not ship before the #235 company filter applies to the read it uses.** |

### 7.3 Minimal implementation proposal (NOT approved; spending and backend decision)

**Shape.** There are four pieces.

1. **Coordinates live with the address they describe.** Add columns to `eos_crm.account_locations` (additive, nullable): `latitude`, `longitude`, `geocode_source`, `geocode_quality`, `geocoded_at`, and `geocoded_address_hash`. A coordinate is valid only while the hash matches the current address, so an edited address means `location unavailable` until it is re-geocoded. Nothing is guessed from a city or postal centroid unless the quality field says so and the pin is drawn as approximate.
2. **Geocoding is server-side only.** It runs as a job or command when a location is created or its address changes, plus a one-time batch for existing rows. That batch is an Owner-authorized production write. Failures are stored as `geocode_quality = 'UNMATCHED'`, never as a guessed point.
3. **One new read, `listWorkOrderMapPoints`.** It takes `{ from, to, statuses, assigneeEmployeeId, operatingCompanyKey }` and is gated exactly like `listWorkOrders`, **plus** the #235 company filter. For each job it returns: `workOrderId`, `number`, `status`, `scheduledStart/End`, `assignee`, `operatingCompanyKey`, `customerId/Name`, `locationId/Name`, and `point: {lat, lng, quality} | null` with `unavailableReason`. It is bounded by window and limit, with `hasMore` and no fabricated totals (#172 rule).
4. **The map view** shows job-site pins only. Pin colour or shape encodes scheduled vs unscheduled, and approximate points are hollow. Jobs without a point go to a "Location unavailable" side list that links to each Work Order. The legend reads "Job sites, not technician positions", and there are no technician markers. A pin opens a compact preview with "Open work order" and, when the Customers domain is visible, "Open customer".

**Provider options.** List prices change, so re-quote from each vendor's current price sheet before approval.

| Option | Basemap | Geocoding | Cost / licensing model | Data leaving EOS | Notes |
|---|---|---|---|---|---|
| **A. Open stack (recommended)** | MapLibre GL JS (BSD), with OpenStreetMap-derived vector tiles **self-hosted** as a Protomaps PMTiles file on object storage | US Census Geocoder (public, free, US addresses, batch); fallback is a commercial geocoder whose terms allow storing results | No per-view fee. You pay object storage and egress for a regional tile extract. OSM requires ODbL attribution. | Addresses go to the geocoder only (server-side). No browser key. Tile requests stay on our hosting. | Smallest third-party exposure. The OSM public tile server is **not** allowed for production use, so self-hosting is required. |
| B. Commercial tiles (MapTiler / Stadia) + MapLibre | Hosted vector tiles | As A | Monthly plan with a free tier and per-request overage | Viewers' tile requests (map extent, not job data) reach the vendor. A browser key, restricted by domain. | Quickest to stand up, and still a small bundle |
| C. Google Maps Platform | Google basemap | Google Geocoding | Per-load and per-request billing with a monthly credit | Browser key (restricted by referrer and API) plus a server key | **Terms restrict storing geocoded coordinates long-term**, which conflicts with §7.3-1. Use only if Google's current terms permit storage for our use. |
| D. Mapbox | Mapbox tiles (GL JS v2+ is proprietary-licensed) | Mapbox "permanent" geocoding (paid tier needed to store results) | Per-load and per-request with a free tier | Browser token plus a server token | Mature, but a vendor lock-in and license change from the open stack |

**Security considerations.**
- Only server-authorized jobs: the map read reuses the list gate plus the company filter, and the client never merges in other reads.
- No coordinates are computed or guessed in the browser.
- There is no GPS or technician position anywhere, and Employee home addresses are never geocoded.
- Geocoder keys are held server-side in the API's secret store (Render env), never in the repo or the bundle.
- Any browser key is restricted by domain and by API.
- Sending customer addresses to a third-party geocoder is a data-egress decision for the Owner (MAP-D3).
- The tile and attribution requirements are met in the legend.

**Owner decisions (map).**

| ID | Decision | Recommendation |
|---|---|---|
| MAP-D1 | Build the functional map at all, and when | After the #235 company filter is on `main` |
| MAP-D2 | Provider | **A** (open stack, self-hosted tiles) |
| MAP-D3 | Allow sending customer site addresses to an external geocoder (spending plus data egress) | Yes, to the US Census Geocoder, server-side, batch only |
| MAP-D4 | Schema plus read: coordinate columns on `account_locations` and `listWorkOrderMapPoints` | Approve as one separately reviewed backend PR (migration, read, Postgres tests), then a frontend PR |

### 7.4 Interim fix (presentation only, in PR-1)

The Map tab stays in place so the gap stays visible (the North Star rule: neither faked nor dropped), but it **stops looking active**.

- It reads `Map · not available`, has `aria-disabled="true"`, is muted with `cursor: not-allowed`, and its click does nothing.
- An `aria-describedby` reason (an InfoTip) says: "No map provider or job coordinates are configured yet. Day, Week and 2 Weeks are the scheduling views."
- `DISPATCH_VIEW.MAP` is removed from the reachable views, and `?view=map` falls back to Day.
- The placeholder `DispatchMapView` is deleted because nothing can reach it any more.
- No backend, provider or dependency change.

**Owner rulings (2026-10-15):**
- **MAP-D1**: build the basic map only **after Work Order company isolation is verified**.
- **MAP-D2**: MapLibre is provisionally accepted; validate the provider terms and hosting costs (§7.5).
- **MAP-D3**: external geocoding of customer addresses is **NOT YET AUTHORIZED**.
- **MAP-D4**: the separate governed backend design is approved (§7.6). Its implementation needs its own review.
- In the interim, show an honest unavailable Map state. That is §7.4, built in PR-1.

### 7.5 MAP-D2 validation: MapLibre, tiles and hosting

Prices are indicative as of this writing. Re-quote from each vendor's current price sheet before any spending approval.

**Terms**

| Component | Licence / terms | What it requires of us |
|---|---|---|
| MapLibre GL JS (the renderer) | BSD-3-Clause, open source | Keep the licence notice in the bundle's third-party notices. No key, account or usage fee. |
| Basemap data (OpenStreetMap) | ODbL 1.0 | Show "© OpenStreetMap contributors" on the map. Rendered tiles are a *produced work*, so share-alike applies only if we publish a derived **database**, which we do not. |
| Protomaps basemap (OSM → one PMTiles file, plus styles, fonts and sprites) | Tooling and styles are open source (BSD-style). The data stays ODbL. | Download a build and extract our region with the `pmtiles` CLI. No per-request licence. |
| OSM's public tile server (`tile.openstreetmap.org`) | Tile Usage Policy forbids heavy or production use | **Not used.** It is the reason self-hosting is required. |

**Hosting estimate (option A: self-hosted PMTiles)**
- **Size.** A regional extract, for example Arizona plus a margin up to zoom 15, is about 1–3 GB. The full planet is over 100 GB and is not needed.
- **Where it lives.** It needs object storage that supports HTTP range requests and CORS. For example:
  - Cloudflare R2: about $0.015/GB-month, no egress fees, and read operations cost a few cents per 100k.
  - AWS S3 plus CloudFront: about $0.023/GB-month plus egress per GB.
  - It cannot go on Vercel or GitHub Pages, because the file is beyond their static-asset limits. It cannot go on the EOS API (Render) without paying API bandwidth.
- **Load.** One dispatcher map session makes about 100–300 range requests. At 20 dispatchers × 20 sessions a day, that is roughly 3–4 million requests a month.
- **Order of magnitude:** under $5 a month on R2 for storage plus reads, plus a one-time engineering cost to build and refresh the extract. A quarterly refresh is enough for a basemap.
- **Data exposure:** none. Tiles are public basemap data, so the bucket can be public-read. No job, customer or technician data ever touches the tile host, and there are no browser keys.

**Coordinates without external geocoding (MAP-D3 is not authorized).** Without geocoding, every job would show as "location unavailable". The authorized-today path is **manual coordinates**. On the customer location record, a person with the existing location-edit authority places or confirms the pin on the self-hosted map. It is stored with `coordinate_source = 'MANUAL'`. No address leaves EOS. A geocoder can be added later behind MAP-D3, storing `coordinate_source = 'GEOCODED'`.

### 7.6 MAP-D4: governed backend design (design approved; implementation needs its own review)

Two backend PRs, each with its own review. The frontend map follows only after both, and only after Work Order company isolation is verified (MAP-D1).

**B-1. Coordinates on the location (additive migration plus one command)**
- **Columns on `eos_crm.account_locations`** (all nullable): `latitude NUMERIC(9,6)`, `longitude NUMERIC(9,6)`, `coordinate_source TEXT CHECK (IN ('MANUAL','GEOCODED'))`, `coordinate_quality TEXT CHECK (IN ('EXACT','APPROXIMATE'))`, `coordinates_address_hash TEXT`, `coordinates_recorded_by TEXT`, `coordinates_recorded_at TIMESTAMPTZ`.
- **CHECKs:** latitude is between -90 and 90 and longitude between -180 and 180; either all coordinate fields are null or the core four (latitude, longitude, source, hash) are all set.
- **Address hash:** SHA-256 of the normalized `street|city|state|postal_code`, taken when the coordinates are recorded.
- **Command `setAccountLocationCoordinates`** `{ locationId, latitude, longitude, quality, reason }`. It runs under the **existing** location-edit capability (no new capability; the PR names it after a resolver check). It is audited like every location change. Clearing the coordinates is the same command with nulls and a reason.
- **No backfill and no geocoding job** (MAP-D3).

**B-2. The map read `listWorkOrderMapPoints` (Work Order route)**
- **Gate:**
  - `workOrder.record.read`, exactly as `listWorkOrders` (`workOrderQueries.ts:200`);
  - **AND** company authority: `resolveCompanyAuthority(db, tenantId, principalId).companyKeys`, applied as `w.operating_company_key = ANY($keys)`;
  - empty authority refuses; it never returns an empty map that looks complete.
- **Input:** `{ from, to }`, with the window capped at 31 days. Optional filters: `statuses[]`, `assigneeEmployeeId`, `operatingCompanyKey` (refused if it is not among the caller's keys), `includeUnscheduled`. Also `limit ≤ 500`.
- **Output per job:**
  - `workOrderId`, `workOrderNumber`, `status`, `scheduledStart/End` (null when unscheduled), `assigneeEmployeeId` and display name, `operatingCompanyKey`, `customerId/Name`, `locationId/Name`;
  - `point: { latitude, longitude, quality, source } | null`;
  - `unavailableReason ∈ { NO_COORDINATES, ADDRESS_CHANGED }` when `point` is null. `ADDRESS_CHANGED` means the stored hash no longer matches the current address, so a moved customer is never pinned at the old address.
- **The page result carries `hasMore`** and no total (#172).
- **Never returns:** any technician position, Employee address or derived route.
- **Tests (Postgres):**
  - a Taylor-only caller sees no Ventana points;
  - an empty authority is refused;
  - an operating-company filter outside the caller's authority is refused;
  - missing coordinates and a stale hash return `point: null` with the right reason;
  - unscheduled jobs are included only on request;
  - `hasMore` at the limit.

**F-1. The map view (frontend; after B-1, B-2 and verified isolation)**
- MapLibre, lazy-loaded only when the Map view opens, with the self-hosted PMTiles style.
- Pins for scheduled and unscheduled jobs; APPROXIMATE points are drawn hollow.
- A "Location unavailable" list that links to each Work Order.
- Filters (date, technician, company, status) through the same URL-state module as the board.
- The pin preview has "Open work order" and, when the Customers domain is visible, "Open customer". Both target ids are re-checked by their own governed reads.
- The legend reads "Job sites, not technician positions".
- Re-enabling the Map control replaces §7.4 in the same PR.

