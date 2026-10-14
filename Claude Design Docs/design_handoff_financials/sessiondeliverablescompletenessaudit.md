# Session deliverables — completeness audit against main

**Measured 2026-09-03 against `origin/main` = `b6c1da49`.** Every row below was verified by reading
main, running the suites, or querying the live sandbox — not from recollection. Where a claim could
not be verified by measurement, it says so.

**Headline: all six directives are COMPLETE IN CODE AND MERGED. Nothing is DEPLOYED.** The single
open item spans every package: the sandbox deploy boundary was denied and was not routed around.

---

## 0. Merge SHAs — all confirmed ancestors of main

| Package | PR | Merge SHA | On main |
|---|---|---|---|
| EOS Dashboard + Performance Management | #1745 | `38709df0` | ✅ |
| G-05 Reporting Period Authority | #1751 | `225052f3` | ✅ |
| FIN-BLOCK-003 Cost Reconciliation | #1755 | `6873373d` | ✅ |
| Inventory Commitment Unification *(another session)* | #1749 | `0d76bea9` | ✅ |
| FIN-BLOCK-003A Cost Activation | #1762 | `b19a7486` | ✅ |
| Physical Consumption assessment | #1765 | `a846652c` | ✅ |
| Physical Consumption authority | #1772 | `616cda50` | ✅ |
| Consumption Source Selection + activation | #1775 | `f8708713` | ✅ |

## 0b. Decisions — all present on main

`#161` `#162` `#163` `#164` `#165` `#166` `#168` `#171` — each verified by heading match.
`#167`, `#169`, `#170` belong to other sessions; **`#169` collided with mine mid-flight and my
decision was renumbered to `#171` across 24 references.**

---

## 1. EOS Dashboard + Performance Management (#1745)

| # | Required | State | Evidence on main |
|---|---|---|---|
| 1 | Verify repo state before building | ✅ | census corrections landed in the same PR |
| 2 | Record canonical dashboard rule | ✅ | `docs/governance/eos-dashboard-composition-authority.md`, 10 rules |
| 3 | Owner ruling: labelled DERIVED info may appear | ✅ | Decision **#161** |
| 4 | Governed Performance Goal Authority (versioned, effective-dated, auditable) | ✅ | `performance/performanceGoal.ts`, `performanceGoalRepository.ts`, Decision **#162** |
| 5 | Governed metric registry, no free-form KPI ids | ✅ | `performanceMetricRegistry.ts` — **37 registered / 12 active / 25 blocked** (measured) |
| 6 | Goal management authority via Role/hierarchy/scope, NOT title comparison | ✅ | `performanceGoalAuthority.ts`, factors 0–5 |
| 7 | My Dashboard North Star P1v2 + six design corrections | ✅ | `docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md` (authored — no prior artifact existed at any commit) |
| 8 | Seeders seed BUSINESS EVENTS, not dashboard answers | ✅ | no answer-seeding path shipped |
| 9 | One reusable dashboard framework | ✅ | `domain/dashboardComposition.js` + `modules/dashboard/` |
| 10 | Bottom-left rail identity, no fake role switcher | ✅ | `navigation/AppRail.jsx` `RailIdentity` |
| 11 | Global search out of scope | ✅ | not touched |
| 12 | Do not bypass FIN-004 | ✅ | composed, never bypassed |
| 13 | Prepare activations, do not execute | ✅ | `docs/governance/performance-goal-activation-package.md`; **5 `performance.goal.*` capabilities registered, 0 active** (measured) |
| 14 | Deterministic tests | ✅ | `performanceGoal.test.mjs` (includes authority coverage) |
| 15 | No Windows GitHub-hosted Actions | ✅ | Linux lanes only |

## 2. G-05 Reporting Period Authority (#1751)

All **18 rulings** implemented and recorded in Decision **#163**.

| Ruling | State | Evidence |
|---|---|---|
| IANA reporting timezone `America/Phoenix` | ✅ | `reportingPeriod/reportingCalendar.ts` |
| Calendar year starts January 1, calendar quarters | ✅ | same |
| Half-open boundaries, no `23:59:59.999` | ✅ | `reportingPeriod.ts` — one exclusive boundary, two DERIVED inclusive shapes |
| MTD / QTD / YTD | ✅ | `reportingPeriod.ts` |
| **T12M rolling, one canonical definition** | ✅ | changed a shipped behaviour; UX note added |
| Prior full period · prior comparable period | ✅ | `comparisonMode` |
| No-comparable must not become 0% | ✅ | UNAVAILABLE with a stated reason |
| Calendar edge cases owned by the resolver | ✅ | clamping, leap years |
| Reporting day = local midnight to local midnight | ✅ | `startOfLocalDayMillis` |
| Goal pacing uses elapsed CALENDAR days | ✅ | `goalReportingPeriod.ts` |
| Domain event time wins, never `createdAt` | ✅ | `classifyEventTime` refuses rather than falling back |
| Explicit `asOf` | ✅ | every resolution takes one |
| Multi-company requires shared calendar | ✅ | `resolveSharedReportingCalendar` |
| Prospective versioning | ✅ | seam NAMED, not built |
| "G-05 defines WHEN, not WHAT" | ✅ | closed **exactly 2** metrics (10 → 12 active) |
| Client mirror at parity | ✅ | `domain/reportingPeriod.js` + 720-case parity corpus |

## 3. FIN-BLOCK-003 Cost Reconciliation (#1755)

| Required | State | Evidence |
|---|---|---|
| Census matrix, exactly one classification | ✅ | `docs/assessments/fin-block-003-cost-supply-reconciliation.md` — **CASE D** |
| Keep cost supply / valuation / COGS separate | ✅ | §0 of the assessment |
| Preserve integer minor units, no floats introduced | ✅ | asserted |
| Missing cost = UNKNOWN, never $0 | ✅ | asserted |
| MAY fix stale docs / mislabelled blockers | ✅ | corrected a stale `receiveInventoryStockCommand` header that would have misdirected the assessment |
| Structural guard so the absence cannot erode | ✅ | `costAuthorityAbsence.test.mjs` |
| **No DECISIONS entry merely because it ran** | ✅ | none added |

## 4. FIN-BLOCK-003A — cost supply + activation (#1760 authority, #1762 activation)

| Ruling | State | Evidence (measured) |
|---|---|---|
| Governed acquisition cost for purchased goods | ✅ | `finance/acquisitionCost.ts` |
| Live `reorder_purchase_orders` canonical | ✅ | price fields on the live PO |
| Dormant Epic-5 `purchase_orders` NOT canonical | ✅ | canonical line normalizes to UNPRICED; floats refused |
| Supplier quote is an input, not the cost event | ✅ | no import of `partSupplierItems` in the cost chain |
| Price governed at vendor commitment | ✅ | existing `recordReorderPurchaseOrder` transition |
| Receipt creates immutable evidence | ✅ | `inventory_acquisition_costs`, deterministic id |
| `operatingCompanyId` required, fail-closed | ✅ | no company ⇒ no fact |
| One basis `PURCHASE_ORDER_LINE_PRICE` | ✅ | single-member vocabulary |
| Freight / landed / labour excluded | ✅ | absent |
| **Price MANDATORY on new commitments** | ✅ | `PO_PRICE_REQUIRED` |
| Explicit ZERO legal, distinct from absent | ✅ | tested |
| Legacy grandfathered by SERVER stamp | ✅ | **`PRICE_AUTHORITY_VERSION = 2`** (measured) — not a date, not "missing price" |
| Purchasing UI captures price + currency | ✅ | `PartDetail.jsx` Record Purchase Order |
| Exact decimal → minor units | ✅ | `fromMajorString`; float route proven wrong by test |
| Valuation / COGS / margin remain OPEN | ✅ | registry unchanged |

## 5. Customer 1 — physical consumption (#1765 assessment, #1772 authority, #1775 selection)

| Ruling | State | Evidence (measured) |
|---|---|---|
| Physical consumption requires a governed source | ✅ | `consumptionSource.ts` |
| No source = REFUSAL, never SOURCE UNKNOWN | ✅ | tested E2E |
| Source-at-pick primary | ✅ | composes `bin_placements.pickedForWorkOrderId` |
| Ambiguity asks, never takes the first | ✅ | tested |
| Explicit source is fallback AND override | ✅ | tested; placement preserved |
| Source must be a governed location | ✅ | resolver takes the permitted set as input |
| Serialized uses `currentLocationId` | ✅ | contradiction refused, unknown fails closed |
| MOBILE valid custody; warehouse availability unchanged | ✅ | **double-subtraction proven**: warehouse stays 2, never 0 |
| Distinct from location-less `CONSUMED` | ✅ | **`WORK_ORDER_CONSUMPTION` in movement types = true** (measured) |
| Correction reverses original lineage, additively | ✅ | caps at what was consumed; pre-authority usage still correctable |
| Reservation stays location-less | ✅ | unchanged |
| **No general technician location/inventory read** | ✅ | **`firestore.rules` unchanged** — `warehouses` still `isAdminOrDispatcher() \|\| isAssignedToWarehouse`; **0 references to the new collections/callable in Rules** (measured) |
| Trusted command-scoped projection | ✅ | `listWorkOrderConsumptionSources` |
| No balances in the picker | ✅ | option shape pinned to 4 keys |
| Another technician's truck absent | ✅ | structural — no plural parameter |
| Execution Capture UI, handheld-safe | ✅ | native `<select>`, 44px, no overflow at 320px |
| **`PHYSICAL_CONSUMPTION_ACTIVE = true`** | ✅ | **measured true** — gate flipped, not deleted |
| **receive 5 → consume 2 → on-hand 3, SO availability 3** | ✅ | proven E2E through the real callable |

---

## 6. Gates that were required to STAY closed — all verified closed

| Gate | Required | Measured |
|---|---|---|
| `salesOrder.fulfill` | `active: false` | **false** ✅ |
| `performance.goal.*` | registered, not activated | **5 registered, 0 active** ✅ |
| ATP | OPEN | not defined ✅ |
| Stockout | OPEN | not defined ✅ |
| Valuation / COGS / margin / turns / carrying cost | OPEN | registry **37/12/25**, unchanged ✅ |
| Production | untouched | no deploy command issued to any project ✅ |
| Firestore Rules | no widening | unchanged ✅ |

---

## 7. Verification actually run on main (`b6c1da49`)

| Command | Result |
|---|---|
| `npm run test:fulfillment` | **166 pass / 0 fail** |
| acquisition + cost absence + goal + reporting period suites | **159 pass / 0 fail** |
| `npm run test:governance` | **667 pass / 0 fail** |
| `node scripts/syncAccessContracts.mjs --check` | **in sync (9 modules)** |
| CI on the final PR (#1775) | **105 / 105 pass** |

All 15 suites added this session are present on main. *(Goal-authority coverage lives inside
`performanceGoal.test.mjs`; there is no separate `performanceGoalAuthority.test.mjs` — that is by
construction, not a gap.)*

---

## 8. THE OPEN ITEM — one, and it spans everything

**NOTHING IS DEPLOYED.**

| | |
|---|---|
| Sandbox deployed SHA | **`5eaa403a`** (read from `/version.json`, built 2026-09-02T17:15Z) |
| Current main | `b6c1da49` |
| Client-facing commits behind | **19** |
| Authorization | **DENIED** at the permission boundary, twice. Not re-attempted, not routed around. |

### Deployment handoff — verified exported names

**Functions** (all confirmed exported from `functions/src/index.ts`):
`transitionWorkOrder` · `setWorkOrderPartsPlan` · `recordReorderPurchaseOrder` ·
`receiveInventoryStock` *(exported as `receiveInventoryStockCallable as receiveInventoryStock`)* ·
`updateWorkOrderExecutionData` · `listWorkOrderConsumptionSources`

**Hosting:** `field-ops-app-vite` — **whole-bundle, 19 client-facing commits.** It must not be
described as "the consumption picker" or "the purchase price UI".

**Rules:** NONE. **Indexes:** NONE (every new query is single-field equality). **Production:** NO.

### Consequences of not deploying

- **C1-PRODUCT-01 = `IN_PROGRESS`** (measured), launch-critical, 9 evidence items. Both Customer 1
  inventory blockers are `CLOSED_IN_CODE`, `DEPLOYMENT_PENDING` — **not live-closed.**
- **Both training guides = `DRAFT — PENDING DEPLOYMENT VERIFICATION`** (measured). Neither can reach
  COMPLETE: merged code is not a verification, and the sandbox predates both screens.
- **All live proofs unexecuted** — Taylor cost, Ventana cost, legacy cost, and every inventory proof.

---

## 9. Other non-closures (each named, none hidden)

- **Supplier-quote prefill** — no governed client read of `part_supplier_items` exists. Building one
  is a new gated visibility surface, a separate decision.
- **Cost correction authority** — no governed correction mechanism for an acquisition cost fact.
- **Returns / rebates / cost reversal**, **landed cost**, **FX**, **labour cost**, **carrying rate**.
- **Inventory ledger `operatingCompanyId`** — still absent; company attribution closed for the
  purchase path only.
- **Sales Order commitment unification** — its inventory prerequisite is now closed, but cross-family
  commitment remains its own package.
- **`firestore.rules` stale comment** on `reorder_purchase_orders` (describes a retired
  `keys().hasOnly` client-create posture; actual rule is `allow create: if false`). Recorded debt,
  deliberately not opened — a Rules file is not worth opening for a comment.

---

## 10. Corrections made to previously-shipped work

Recorded because each changed a claim that had been merged as true:

1. **A census finding was withdrawn mid-run** (#1743): "no Role carries `finance.visibility.*`" was
   measured by grepping Role sources, which cannot see admin's DERIVED grants. It was load-bearing in
   four places in my work; all four corrected, and the test INVERTED so it fails if the claim returns.
2. **`costAuthorityAbsence` assertions updated twice** — first when acquisition cost supply closed,
   then when activation superseded the optional-price phase. Both made **stricter**, never looser.
3. **The `WORK_ORDER` produces-no-movement guard inverted** — and tightened to *exactly one*.
4. **A COGS recognition point became selectable** — `#1776` derives its availability from
   `PHYSICAL_CONSUMPTION_ACTIVE` by explicit design. Flipping the gate lifted the last blocked point,
   so a test asserting "a blocked point is refused" lost its subject; rewritten to assert the rule
   conditionally with the current fact pinned beside it, rather than inventing a subject.
5. **Truck Registry hash re-pinned** — `#1763` changed both `firestore.rules` copies without moving
   the pin, failing every PR since. Re-pinned by synchronisation only, after proving the old pin
   matched the pre-`#1763` ruleset exactly and the whole delta was one deleted read arm.
