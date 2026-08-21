# Full-Site UX + Functional Certification — Closeout

Program run 2026-08-20 → 2026-08-21. Certifies every reachable route, at five widths, for a
representative persona set, against the local emulator build. The deployed re-certification is a
separate, gated phase (see **Protected / blocked** below).

## Scope certified

| Dimension | Result |
|---|---|
| Routes / surfaces | 54 |
| Widths | 1440 / 1024 / 768 / 375 / 320 |
| Visits measured | **270 / 270** (navFailures 0, browser relaunches 0) |
| Representative personas | admin, ineligibleDispatcher, technicianMultiRole, eligiblePartsManager |
| Additional personas required | none — no unexplained signal appeared |
| Create → reach journeys | 6 / 6 |
| Node suites | 214 |
| Vitest | 147 files / 1646 tests |

Residual sweep findings are **informational only** and were each checked rather than assumed:
`TINY_TARGET_DESKTOP_SURFACE` (desktop workspaces measured at touch widths, which never promised a
44px target) and `OFFSCREEN_IN_SCROLLER` (controls reachable inside a deliberate scroll container —
the Scheduling board's documented containment, and tables the new safety net turned into their own
scrollers, which is the fix working rather than a residue of it).

## FIXED REGRESSIONS

Each was traced to an introducing commit before being fixed.

| Regression | Cause |
|---|---|
| 63 live CSS rules deleted while still referenced | `887a0a50` replaced `index.css` wholesale (-923/+112) and changed no JSX. Nothing threw; every automated signal stayed green for two weeks |
| Scheduling board blowout | `64096edb` (#1321) put the shared `Button` primitive on grid cells whose `white-space:nowrap` + padding pushed all seven day columns past their floor. That commit's own sibling diff had **declined** the same migration for the other board, for exactly this reason |
| A created Prospect was invisible | `bd576a92` (#1137) moved ordering server-side; `orderBy` silently excludes documents missing the ordered field, and the shared writer stamped only `createdAt` |
| Raw technician id rendered as a name | Ten surfaces hand-rolled the same lookup; nine printed the raw id |
| "You don't have access" for every failure | An offline device was told it lacked permission |
| Sales Workspace "not connected yet" | Four distinct states collapsed into one — including DENIED, the most common case |
| Cycle Counts empty location picker | A failed read was converted into a fact about the business |
| Sales order labelled by document id | `salesOrderNumber` was in the projection the whole time, never mapped through |
| Document panned sideways at 320 | `.fo-page-header__actions { flex: none }` refused to shrink, holding 550px inside a 292px header |
| 21 controls under the 44px touch floor | The floor existed in six places, applied per-control; the shared primitive was itself 4px under |
| Supplier / warehouse raw ids | Same defect class, two more collections |

## INTENTIONAL DENIALS — not defects

* **admin denied `/inventory-role/manager|warehouse|mine`** and **eligiblePartsManager denied the
  same three.** `navConfig.js` states the design in its own words: every item declares
  `operationalRoleAccess` "so `isDomainVisible()` is false … for admin/dispatcher and for any
  technician without a matching, ACTIVE operationalRole". These are *my-role* surfaces scoped to the
  person holding the operational role, not administrative views of it.
* **Zero `NAV_REDIRECTED` for every persona.** `App.jsx` generates a route for every nav item and
  renders "isn't available to your role" in place of the screen. Nobody is silently bounced. This is
  the designed outcome and the better one — a redirect tells you nothing about why you moved.

## GENUINE PRODUCT GAPS — carried, not fixed

* **Contacts, Locations and Employees have no edit path.** `updateContact` has zero callers in the
  entire history; `AccountDetail.jsx` records Locations as add-only. These were never built, so they
  are not regressions and building them is out of certification scope.
* **Driver probe suites need fixtures nothing available provides.** `verify-pr-a` and
  `verify-inventory-role-*` fail waiting on specific fixture rows. They fail **identically at the
  pre-certification commit `418af8a9`**, so this is not a regression from this program. They are not
  CI-covered (they need a browser + emulator), which is how they drifted broken unnoticed. The
  Issue-100 bootstrap that provisions such fixtures is marked OPERATOR-RUN ONLY and explicitly "not
  invoked by Claude Code", so it was not run.

## PROTECTED MIGRATIONS — packaged, not performed

* **Sales Order historical numbering backfill.** Sales Orders predating the numbering rollout carry
  no `salesOrderNumber` and are therefore invisible to the global list read — `orderBy` never returns
  them, and they are not counted in `skipped` either. The **write path is already correct**:
  `salesOrderCallables.ts` allocates inside the same transaction as the document write.
  Packaged by extending the existing `backfillOperationalNumbering.mjs` (dry-run by default,
  idempotent per-record re-read inside the write transaction, collision-checked at report and write
  time, production double-confirmation gate) rather than writing a second migration.
  Proven on emulator fixtures: **1 of 4 visible to `orderBy` before → 4 of 4 after**, the modern
  record's number untouched, second run a no-op.
  The affected count can only be measured against a real dataset — run the tool with no flags.

## DETECTOR FALSE-POSITIVE FAMILIES — and the permanent guard

The certification instrument produced **five** families of wrong answer, plus one guard that could
not fail at all:

1. Hash navigation on a path router → "53 of 54 routes clean", having never left page one.
2. Screen-reader landmarks counted as clipped text → "54 of 54 broken".
3. Desktop controls measured against a touch floor they never promised → 215 phantom findings.
4. Reachable-inside-a-scroller reported as offscreen → Scheduling board "broken" at every width.
5. A 20-character word treated as a Firestore key → `postPurchasingUpdate` flagged on the screen
   whose subject matter is capability ids.
6. A guard whose pattern stopped at the `)` closing an arrow parameter → matched **nothing** while
   ten violations sat in the tree.

Plus the worst one: a run measured **136 of 270** visits, turned one dead browser into 133 findings,
and printed a summary that read like a completed sweep.

**The permanent rule:** a detector is not trusted because it passes. `detectorsCanFail.test.mjs`
feeds each certification-gating detector a known violation and asserts it objects, then clean input
and asserts it does not. Coverage is now part of the sweep's result: a partial run prints
`COVERAGE INCOMPLETE` and exits non-zero, because on an unmeasured route the *absence* of a finding
reads exactly like a clean one.

The four guards were also **none of them in `test/suites.json`** — they ran only as path-filtered CI
steps, so the certification guards had weaker coverage than the code they guard. Now unconditional.

## SANDBOX REFRESH GATE

`scripts/_sandboxRegressionGate.sh` — deployed identity → repo guards → 5-width sweep → persona
reachability → create→reach → scanner scenarios. Every instrument accepts `CERT_BASE`, so the same
gate runs against a deployed origin; `?emulator=1` is scoped to local runs, since carrying it to a
deployed build would point the app at emulators that do not exist.

A deployed build is not an accepted sandbox refresh until this passes.
