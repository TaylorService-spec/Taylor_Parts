# Persona Experience Review — Gate 2 Shell, Rounds 1 & 2

**Status:** COMPLETE · Gate 2 shell **PASS** (merged in PR #633) · **product findings preserved and routed**
**Method:** four independent persona agents per round, each returning a FUNCTIONAL and an EXPERIENCE verdict.
**Round 1 build:** `dd1916f` (Inventory review straddled `dd1916f`→`eaff2f4`, see §5)
**Round 2 build:** `f2291e7` — agents were given **business missions only**, no defect list, no knowledge of what had been fixed.
**Merged shell:** `0210148` (merge `b3558ab`)

---

## 1. Verdicts

| Persona | Round 1 | Round 2 |
|---|---|---|
| Dispatcher / Service Manager | FUNCTIONAL PASS · EXPERIENCE FAIL | FUNCTIONAL PASS (barely) · EXPERIENCE FAIL |
| Technician | FUNCTIONAL PASS · EXPERIENCE FAIL | FUNCTIONAL FAIL · EXPERIENCE FAIL |
| Inventory / Warehouse | FUNCTIONAL FAIL · EXPERIENCE FAIL | FUNCTIONAL FAIL · EXPERIENCE FAIL |
| Administrator / Owner | FUNCTIONAL PASS · EXPERIENCE FAIL | FUNCTIONAL FAIL · EXPERIENCE FAIL |

**The shell passed at Round 2.** Across four independent missions, no reviewer reported a remaining defect in the rail, drawer, navigation mechanics, selected state, contrast, touch targets, keyboard behaviour, focus behaviour, or shell accessibility. Round 1's shell defects did not recur. The Administrator review named accessibility "the one bright spot… better than most production apps."

**Round 2's failures are the application beneath the shell.** Given real work, the personas walked past navigation and hit the product. Those failures are preserved below and routed — they are *not* Gate 2 defects, and #633 was not made responsible for them.

**This is the intended pattern:** superficial problem → fixed → same mission rerun → deeper problem becomes visible. A FAIL-heavy Round 2 means the method is penetrating the product, not that it failed.

---

## 2. Round 1 — shell defects found and fixed

All measured, not impressionistic.

| Defect | Measurement | Fix |
|---|---|---|
| Multi-expand scroll trap | 1462px of nav in an 800px rail; brand block **and** current selection scrolled off-screen | sticky brand + active item scrolls into view |
| Inverted selected hierarchy | on `/service/dispatch` the brightest row was "Service Operations" — the wrong place | current domain outranks merely-expanded; expansion = chevron only |
| Leaf row overflow | leaf measured 270px inside a 252px rail, clipping; label 3px off every sibling | box-sized to 100% + chevron-width spacer |
| Active item contrast | **1.41:1** against the rail — invisible in sunlight | `--color-rail-selected` **3.18:1** vs rail, **4.74:1** white-on-it |
| Touch targets | nav toggle **34×30**, drawer items **40.9px**, Close **28px** | 44×44 / 44px minimum |
| Group labels | faintest text in the rail, yet they carry the 3-level hierarchy | full opacity |
| Self-referential accordions | Equipment → "Equipment"; Service Operations → "Service Operations" | single-destination domains render as leaf links |
| Second navigation axis | "Home" navigated `/service` → `/dashboard` | removed |
| Browser function as chrome | "Refresh" beside Home, identical in appearance | removed |
| Fifth product name | "Field Ops Platform" alongside Verenward / EOS / Taylor Parts / Arizona Operations | removed |
| Utility bar contrast | title **3.96:1** — fails AA | own surface; title deleted |
| No skip link | ~40 tab stops before `<main>` (WCAG 2.4.1) | skip link added |
| Dangling `aria-controls` | collapsed domain referenced an id not in the DOM | panel always rendered, `hidden` when collapsed |
| Drawer rows on phone | 66px × 10 children = 78% of screen; 4 domains pushed below fold | 48px |

---

## 3. Regressions introduced during this work — all fixed

Recorded because they are the highest-value regression tests in the set.

**R1 — Firestore Timestamp coercion (from F0).** Legacy `fieldops_jobs` stored `createdAt` as epoch **milliseconds**; governed `fieldops_wos` stores a Firestore **Timestamp object**. F0 changed the data source and left `now - job.createdAt` arithmetic intact. Symptoms: *"478391h since creation"* (≈54 years), *"19932d ago"*, *"Invalid Date"*, `NaN` reconciliation variance, and an At Risk panel reporting **100% of open jobs CRITICAL**.

> A risk panel that flags everything flags nothing. The dispatcher's own words: *"I would learn to ignore it inside one day — and then miss the real one."*

Fixed by `domain/timestampMillis.js`, which accepts number | Date | Timestamp | `{seconds}` | ISO string and returns **null** when the value cannot be trusted. Deliberately **not** defaulting to `0` or `now` — both produce a confident lie. **Regression protection is warranted anywhere a shared time/duration projection consumes a Firestore Timestamp.**

**R2 — permission denial swallowed into infinite loading.** `subscribeToWorkOrders` is an *unfiltered* collection listener and had **no error channel**. `firestore.rules` only permits a technician to read their own assigned Work Orders, so the read is denied — and the denial went nowhere, leaving `/service/job-assignments` spinning forever. Two personas hit it independently.

> **Standing rule this establishes:** `denied` · `unavailable` · `loading` · `empty` are four distinct states. A permission denial must never masquerade as perpetual loading.

**R3 — selected-state collision / single-expand.** Both introduced by my own Round-1 fixes and both corrected; neither recurred in Round 2. Round 1 produced *opposing* findings here (admin wanted less expansion, inventory needed more) — rationing fixed the symptom and broke the workflow, so the underlying scroll defects were fixed instead.

**R4 — missing `<h1>`.** The rail rewrite dropped the shell's level-one landmark, leaving **zero `<h1>` on every page**. Restored inside `<main>`, and improved: it names the current domain, so it changes as you navigate. **Page-level landmark hierarchy is part of the shell accessibility contract.**

**R5 — two stale test assertions.** `appHeaderBase.test.mjs` and `verifyBuildBase.mjs` both asserted the removed "Refresh" link. Rewritten to assert the invariant that actually mattered (no hard-coded host path) plus a new assertion that the second navigation axis cannot be reintroduced. `verify:build-base` is a CI-only check and is now part of the local gate set.

---

## 4. Round 2 product findings — preserved and routed

**Not Gate 2 defects. Do not fold these into a shell PR.**

### Finding A — Service ↔ Inventory seam is broken · **HIGH** · owner: **F2 / Materials**

All four personas converged on one severed seam: **Service knows which parts a Work Order needs; Inventory knows where parts are; nothing joins them.**

- Dispatcher could not determine parts risk for any job — four screens, no answer. WO-SBX001 plans `PRT-1005 ×2`, unconsumed, on a HIGH-severity in-progress job.
- Technician's job needs `PRT-1001`; the scanner only resolves `CMP-048-230` — **two disconnected part-number universes on one screen**.
- Warehouse Manager could not traverse from job demand to fulfilment at all.
- Work Order parts panels are captioned *"Visual only — no inventory engine connected yet."*

Classified: **SYSTEMIC CROSS-DOMAIN OPERATING SEAM.** Feeds F2 entity resolution + WO Parts Readiness + production-derived fixtures + later warehouse fulfilment. **F2 must not be inflated into a Materials programme to absorb it.**

### Finding B — navigation exposes too much incomplete product · owner: **UX / IA**

**17 of 53 destinations are stubs**, plus ~6 non-functional shells. The shell faithfully renders the navigation *model*; the model itself is the finding.

Open questions for later synthesis — **do not act on this single review**: why are incomplete capabilities peer destinations? Should stubs appear in persona navigation at all? Is navigation reflecting repository modules rather than usable workspaces? Which destinations should be hidden until coherent, and which should consolidate?

### Finding C — Work Order experience is fragmented · owner: **UX discovery**

Seven Work Orders render across **six destinations** (Work Orders, Job Assignments, Dispatcher Board, Scheduling, Dispatch Queue, Service Operations), with contradictory vocabulary — the same record showed as `Priority 2`, `Emergency`, and `High` on different screens.

Classified: **POSSIBLE WORKSPACE FRAGMENTATION.** Do **not** conclude the six routes must collapse. Future missions should test whether personas repeatedly reconstruct the same Work Order context across surfaces. **Do not prime future agents with a proposed answer.**

### Finding D — management / owner experience is missing · owner: **UX discovery**

`/dashboard` is a link farm (~65% empty, zero operational data); `/reporting` (Executive) is a stub; there is no owner surface. Access management is entirely inert — role select disabled, no user list, Permission Preview empty — and the unavailability copy shows an owner *"Issue #226… (Spec sec12)"*.

Classified: **MANAGEMENT / OVERSIGHT EXPERIENCE UNRESOLVED.** This is why Control Tower has not been prematurely renamed or redesigned. Future missions determine independently: who monitors, what they are responsible for, what decisions result, and whether monitoring belongs inside operating workspaces.

### Also recorded

- **Fabricated CRITICAL alarms**: reconciliation rows reading `Expected 0 · Actual NaN · Variance NaN · CRITICAL`. Never badge a row whose value is non-numeric.
- **Dispatch Queue** appears to map status `DISPATCHED` → "Emergency"; routine PM work badged red.
- **Raw identifiers to operators**: `acct-harbor`, `tech-sbx-other`, `PRT-1001` where names belong — while another screen resolves the same record correctly.
- **Dead "Notifications (2)"** badge over a stub page.
- **Pre-existing access gap** (`#226` Assessment, not a Gate 2 regression): `WAREHOUSE_MANAGER` / `PARTS_MANAGER` cannot reach Inventory or Purchasing. Round 2 measured the Warehouse Manager's entire application as **four destinations, none of them a warehouse**. Owner: **#226 / R-1**.

---

## 5. Method notes

- **Round 2 was blind.** Agents received business missions, invariants and the first-five-seconds test — never a defect list, never "is X better now?". Navigation behaviour was treated as evidence.
- **Round 1's Inventory review straddled two builds** (ran 34 min, picked up the fix deploy mid-run — it reported `rgb(51,129,90)`, a token that only exists in the fix commit). Its findings are valid but are *not* clean Round-1 evidence. Round 2 was pinned to a single build for exactly this reason. **Pin the build for every future round.**
- **Two reviewers mishandled credentials** — one hardcoded live sandbox passwords into scratch scripts, another dumped the raw credentials file to output. Sandbox-only fictional personas, so low material impact, but the practice is wrong. Future persona prompts must require reading credentials from file at runtime and never echoing them.
- Persona reviews are for **discovery, workflow evaluation and UX critique**. Deterministic invariants, authorization and state transitions belong in automated tests. Not every finding should become a browser test.
