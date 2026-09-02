# EOS Dashboard Composition Authority

**Status:** CANONICAL. Owner-directed 2026-09-02. This document records the platform-wide rules a
dashboard obeys. It creates no capability, grants nothing to nobody, and activates nothing.

**What it closes.** The dashboard reporting authority census
([`../assessments/eos-dashboard-reporting-authority-census.md`](../assessments/eos-dashboard-reporting-authority-census.md))
left three formalization items and one Owner decision open against this exact subject:

| Census item | Closed by |
|---|---|
| §7 F-01 — dashboard read/scope rule (K-17, X-8) | Rule 1 below |
| §7 F-02 — the attention taxonomy as the dashboard vocabulary | Rule 5 below |
| §7 F-11 — truncation/completeness honesty as a dashboard-wide rule (X-9) | Rule 6 below |
| §9 Owner decision 4 — do derived informational figures belong on a dashboard | Rule 4 below |

The census itself is a point-in-time analysis and is **not rewritten** by this document. It recorded
what was true on 2026-09-02; this records what was decided on 2026-09-02.

---

## Rule 1 — A dashboard composes authority. It is never a second permission layer.

> **EOS dashboards compose existing domain authority. A dashboard is never a second permission
> layer.**

A dashboard tile reads through the SAME read authority, at the SAME scope, that the domain's own
workspace uses. It does not hold a capability of its own, it does not widen one, and it does not
narrow one either — a tile that a person's authority would refuse is **absent**, not empty and not
zero.

The shipped precedent is [`LandingPage.jsx`](../../field-ops-app-vite/src/navigation/LandingPage.jsx):
it computes its destination list with `isDomainVisible`/`isNavItemVisible`, the exact functions the
navigation rail and the route table already use for that same principal. It cannot show a
destination the person cannot open, and cannot omit one they can, because it is not a second
opinion about their access — it is the same one.

**No dashboard-scoped capability may be created.** There is no `dashboard.*` read capability today
and none is to be minted. A dashboard that needed its own capability would be asserting reach that
no domain granted it.

### Rule 1a — Personalization inputs are a closed set

Dashboard personalization may use ONLY governed context that already exists:

- the authenticated principal
- Roles held (`roleAssignments`, resolved by `resolveEffectivePermission`)
- capabilities resolved for that principal
- employee identity (`users/{uid}.employeeId`)
- organizational position, where already governed
  ([`roleHierarchy.ts`](../../functions/src/access/roleHierarchy.ts) /
  [`hierarchicalVisibility.ts`](../../functions/src/access/hierarchicalVisibility.ts))
- record ownership and assignment
- technician binding (`users/{uid}.technicianId`)
- location / warehouse scope (`{type:"location"}` RoleAssignments)
- business-unit / operating-company scope (`{type:"businessUnit"}` / `{type:"operatingCompany"}`,
  DECISIONS #157)
- each domain's existing read authority

Anything not on this list is not a personalization input. In particular a dashboard never branches
on a **persona name**: the platform's own precedent for this is `deriveScanWorkflows`, which is
capability-derived and *cannot* receive a persona (census T-7/W-11). Composition resolves from what
a principal may DO, never from what they are called.

---

## Rule 2 — What a persona dashboard is for

Every primary EOS persona dashboard should provide, **where governed facts exist**:

```
CURRENT WORK               what do I need to do
PERFORMANCE AGAINST GOAL   how am I performing against my goals
BUSINESS IMPACT            what business impact am I having
GO TO                      where can I go from here
```

Management dashboards may additionally compose, **at the manager's existing governed scope**:

```
TEAM PERFORMANCE           how is my team / function performing
DRIVERS / EXCEPTIONS       why is performance above or below goal, and what conditions drive it
```

"Where governed facts exist" is load-bearing. A section with no governed fact behind it renders an
honest unavailable state naming what is missing — it does not disappear silently, and it does not
get filled with something adjacent. A section is reserved in Design and honest in implementation.

---

## Rule 3 — The domain owns the actual; the goal authority owns the target

```
DOMAIN AUTHORITY OWNS THE ACTUAL.
PERFORMANCE GOAL AUTHORITY OWNS THE TARGET.
THE DASHBOARD COMPARES THEM.
```

No goal record ever carries, caches, or recomputes an actual. No dashboard recomputes either half.
A comparison is only legitimate when the actual and the target share a **measurement basis** — the
metric registry is what makes that checkable, and a mismatch is refused rather than rendered.

Never compare a BOOKED actual to a BILLED goal, and never label either "Revenue" when the basis is
known (census S-9/S-10, FIN-002 Invariant A).

**And never compare across a period a dashboard decided for itself.** WHEN is a third authority
(Decision #163): a tile computing month boundaries from the browser's timezone is inventing reach in
exactly the way Rule 1 forbids, because it makes the business month a property of where the reader is
sitting. Windows come from `reportingPeriod`, and an incomplete period compares only against the
equivalent elapsed portion of the preceding one — never against a whole prior month, which would
report a collapse every month in every business forever.

---

## Rule 4 — Derived information on a dashboard (Owner ruling, 2026-09-02)

**Ruling.** Clearly identified derived informational projections **MAY** appear on a dashboard when
the derivation already exists and is already governed.

This extends ND-28, which ruled for a *record page* and expressly did not address a dashboard tile.
The Owner has now addressed it.

**Conditions, all required:**

1. The derivation already exists and is governed. A dashboard may not derive something new.
2. It is **unmistakably labelled as derived** — `DERIVED`, `FORECAST`, `PREDICTION`, or `INSIGHT`.
3. It does not replace, rename, or visually impersonate authoritative operational truth.
4. It is not given the visual weight of a governed principal quantity.

**Allowed:** the ledger-derived stock forecast and days-remaining (census I-5), stockout
risk/prediction (I-7), and any other already-governed derived projection.

**Refused, by name:**

| Refused | Why |
|---|---|
| calling a forecast "On hand" | I-1 is a governed ledger position; a forecast is not |
| calling a prediction "Available" | I-3 ATP is a governed computation with infectious UNKNOWN |
| treating derived inventory as ATP | it would enter commitment decisions it cannot support |
| presenting UNKNOWN as zero | UNKNOWN is a value, and zero is a different claim |

`NEEDS_PLANNING` from the stockout engine means "the engine had nothing to compute" — **not** "risk
is low" — and must never render as a clean state.

**UNKNOWN remains UNKNOWN**, everywhere, on every surface, including a tile whose layout would look
tidier with a number in it.

---

## Rule 5 — The attention taxonomy is the dashboard vocabulary

The Owner-ratified two-value taxonomy already carried by
[`workOrderAttentionProjection.js`](../../field-ops-app-vite/src/domain/workOrderAttentionProjection.js),
[`partsAttentionProjection.js`](../../field-ops-app-vite/src/domain/partsAttentionProjection.js) and
[`accountAttentionProjection.js`](../../field-ops-app-vite/src/domain/accountAttentionProjection.js)
is hereby the platform-wide dashboard vocabulary:

- **ACTION_ITEM** — you need to do something.
- **NOTIFICATION** — something happened or is in motion; no action required from you right now.

**There is no ALERT category.** No repository evidence justifies inventing a severity axis
independent of workflow status, and a third value would be invented rather than composed.

**No re-badging.** The existing severity models (`jobRiskScoring.js`, `dispatchScoring.js`) are NOT
re-projected into this taxonomy. Re-projecting them would produce the same badge vocabulary
carrying a different meaning — the exact confusion the pattern's own consumer warns against
(census X-3). They may appear on a dashboard **as themselves**, under their own labels.

---

## Rule 6 — Truncation and completeness honesty

> A bounded read may return a page and say so. **A TOTAL may not.**

Bounding an aggregate produces a number smaller than the truth while still labelled "Total", which
is worse than the slow unbounded read it replaced. The two existing statements of this rule —
[`accountPortfolioSummary.ts`](../../functions/src/account/accountPortfolioSummary.ts)'s aggregate
contract ("no cursor, no pageSize, no limit") and FIN-004's unfiltered-set truncation honesty — are
one rule, and it binds every dashboard count.

A dashboard count that cannot be completed renders **unavailable**, never a partial figure labelled
as complete.

Corollary, from the same source: unknown or unrecognized values surface as an explicit
`unclassified` bucket rather than vanishing from a total.

---

## Rule 7 — No dashboard-local domain calculation

Every reportable fact names a canonical derivation. A dashboard that recomputes one creates a
second implementation of domain logic — the failure mode this platform has already been bitten by,
in both directions.

Charts and tiles consume canonical facts and canonical projections. They do not:

- re-derive a status, a past-due predicate, a readiness, an availability, or a balance
- average an already-computed rate (see Rule 8)
- infer a lifecycle state from a timestamp
- fill a gap in one authority from a different authority that happens to be nearby

---

## Rule 8 — Rollups are declared, not assumed

The same metric may be viewed at more than one scope only where the metric registry says the rollup
is exact and states how it is computed.

**A rate does not roll up by averaging.** A team on-time rate is

```
sum(valid numerator) / sum(valid denominator)
```

and **not** `average(per-employee percentages)`, which silently weights a technician who closed two
jobs equally with one who closed forty. A metric whose rollup rule is not declared does not roll up
at all, and its higher-scope tile renders unavailable rather than wrong.

Where a rollup is a sum across entities that transact with each other, it is typed as such and must
render with its caveat — the governed precedent is FIN-009's `UNELIMINATED_SUM` on the Consolidated
column (census S-17/F-7).

---

## Rule 9 — Chart honesty

1. **A chart labelled "by Status" contains statuses.** It may not mix a real lifecycle status with
   a projection (`WAITING_ON_PARTS`, `COMPLETED_TODAY`), because the reader adds the bars and the
   sum is then meaningless. Projections get their own chart, with their own label.
2. **Stacked composition asserts mutual exclusivity.** Conditions that can co-occur — past due,
   scheduling conflict, parts-blocked — are rendered as independent counts or independent bars.
   Stacking them claims a whole that does not exist and double-counts the record that is two of
   them at once.
3. **An aggregate needs a proven definition.** "Open work orders" is not a definition; the set of
   statuses it names is. A tile whose population is not provable from an existing authority does
   not ship.
4. **A scope stated in a label is the scope measured.** Past-due work is measured globally, not
   within today's scheduled window (census SV-4); a tile that implies otherwise is corrected in the
   label, not in the query.

---

## Rule 10 — An action a dashboard offers must be an action that exists

A call to action names a governed command. Where no such command exists, the CTA becomes navigation
to the record where a person can decide — "Review discrepancy", "Open receipt" — never an
imperative for an authority the platform does not have.

---

## Consequences already known

Applying these rules to current `main`, the following remain honestly unavailable and are not to be
filled by inference:

- every period-based financial figure — the reporting-period authority (below), not reach. **The
  census's "no Role carries any `finance.visibility.*` capability" finding was WITHDRAWN** (#1743):
  it was measured by grepping Role sources, which cannot see admin's derived grants. Measured by
  resolver, admin and owner carry all five scopes and resolve CONSOLIDATED reach in sandbox; #1744
  additionally gave salesManager TEAM and salesperson SELF, both still awaiting activation
- every margin, inventory value, turns and carrying-cost figure — FIN-BLOCK-003, no governed cost
  fact exists
- ~~every period-relative KPI, pacing figure and prior-period delta — no reporting-period authority
  exists (census G-05)~~ **CLOSED by Decision #163.** MTD/QTD/YTD/T12M, the America/Phoenix reporting
  timezone, half-open boundaries, the prior-comparable rule and calendar-day pacing are all governed
  now (`functions/src/reportingPeriod/`). A dashboard module may state a period-relative figure
  where the metric's OWN authority exists — and no metric became measurable merely because the
  calendar did: G-05 defines WHEN, never WHAT
- first-time fix, SLA/response, callbacks, utilisation, inventory aging, shortages, AOV, pipeline
  value — each a named authority or definition gap in census §8

A dashboard built today renders these as honest unavailable states. That is the correct behaviour,
and stating it here is what stops the next session from quietly resolving one of them with a
plausible number.
