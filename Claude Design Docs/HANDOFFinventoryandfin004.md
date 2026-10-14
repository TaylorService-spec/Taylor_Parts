# Handoff — Inventory Commitment + FIN-004 work (session B)

Paste this into the other chat to fold this session's work in. Everything below is merged to
`main` unless marked otherwise. Repo: `TaylorService-spec/Taylor_Parts`.

---

## 1. What this session shipped, in order

| PR | Merge SHA | What |
|---|---|---|
| #1740 | `203848a1` | EOS Dashboard Reporting Authority Census — 132 fact families, 11 domains |
| #1743 | `c54cd218` | FIN-004 reach re-measured; the census's headline finding **withdrawn** |
| #1744 | `2c7c343d` | Finance Manager parity restored + the ruled financial visibility matrix (DECISIONS #159) |
| #1746 | `73616944` | Inventory commitment/reservation reconciliation — CASE C |
| #1749 | **OPEN** | Inventory commitment unification (DECISIONS #165) — CI green-in-progress at handoff |

---

## 2. Governance numbers claimed by this session

- **DECISIONS #159** — Finance Manager parity + FIN-004 visibility matrix.
- **DECISIONS #165** — one inventory commitment authority. *(Originally written as #160, then
  #162; both were taken by the other session mid-flight. Renumbered to #165 after merging main.)*

> **Coordination note:** we collided twice on `docs/DECISIONS.md` numbering. Always re-read the
> live tail (`grep -oE "^## #[0-9]+" docs/DECISIONS.md | tail`) **and** check open PRs for
> `+## #NNN` before claiming a number.

---

## 3. Two corrections that matter to any dashboard work

### 3.1 Role grants can be DERIVED — never measure them by grep

`admin`'s permissions are computed: `ADMIN_CURATED_PERMISSIONS` **plus every id in
`PERMISSION_CATALOG`** (Owner ruling 2026-08-19). So a capability can be a real, resolved grant on
`admin`/`owner` while appearing **nowhere as a literal** in any Role source.

I published a census claiming "no Role carries any `finance.visibility.*`" based on a grep. It was
**wrong**, and a green test already said so. Correct method:

```js
const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
ROLES.admin.permissions.includes("finance.visibility.consolidated"); // true
```

Pinned by `functions/test/fin004ReachComposition.test.mjs`.

### 3.2 Current FIN-004 financial reach (measured, post-#1744)

| Reaches in sandbox (CONSOLIDATED) | Granted but INACTIVE → zero reach | No scope → zero reach |
|---|---|---|
| `owner`, `admin`, `generalManager`, `financeManager`, `accountingManager` | `salesManager` (TEAM), `salesperson` (SELF) | everyone else, incl. `controller`, `operationsManager` |

- Production reach is **nil for every principal**, admin included.
- `financeManager` ↔ `accountingManager` are now **exactly equal** (18 permissions), built from one
  shared `MONEY_MANAGER_PERMISSIONS` constant.
- **TEAM and SELF are not in `SPINE_OVERRIDE_ELIGIBLE_IDS`** — declaring them in an environment
  registry would not activate them. Activating either is a separate Owner package.

---

## 4. Inventory: what is now true

**One on-hand authority (CLOSED).** `inventoryService.getAvailableQuantity` no longer reads the
static `partsCatalog` baseline. It composes `sumLedgerEligibleOnHand` — the same ratified
derivation the Sales Order path uses, over `status==ACTIVE` warehouses — minus open commitment, and
returns `null` for UNKNOWN. Dispatch fails closed on UNKNOWN with a refusal **distinct** from a
shortage. MOBILE/truck stock is excluded. The duplicate `sumGovernedLedger` is **deleted**.

**Reservation follows demand (CLOSED).** `reconcileReservation()` re-derives commitment from the
current plan: delta-reserve on increase, exact release on decrease, full release on removal,
all-or-nothing across parts. `releaseParts` now iterates the **ledger**, closing an orphan leak.
Wired into `setWorkOrderPartsPlan`, gated on the governed `processedStates.DISPATCHED` marker.

**Still true and unchanged:** picking and staging reserve nothing; demand ≠ commitment; planning
before dispatch has no inventory effect; `inventoryService.ts` is the **sole writer** of
`type: "RESERVED"` repo-wide.

### 4.1 The blocker you need to know about

> **Nothing removes consumed stock from physical on-hand.**

`CONSUMED` is not a physical movement type *and* legacy commitment rows carry no `location`, so it
is invisible to `sumLedgerEligibleOnHand` twice over. `consumeParts` writes no physical removal.

The two paths compensate differently:
- `inventoryService` never subtracts CONSUMED from commitment → right number, wrong reason.
- `openWorkOrderReserved` **does** subtract it and doesn't compensate → **the Sales Order path
  reports 5 available after 5 received and 2 consumed, when 3 physically remain.**

Proven in `functions/test/inventoryConsumptionOnHandGap.test.mjs`. **This blocks moving Sales Order
commitments into the ledger**, so `salesOrder.fulfill` must stay `active:false`.

### 4.2 Also blocked: company + location on reservations

- A **Work Order carries no `operatingCompanyId`** (DECISIONS #143 forbids inferring one).
- **Neither** family selects a warehouse — both pool across eligible ACTIVE warehouses.

Requiring both on every reservation would fail every dispatch closed. Creating the missing
selection authority is new business authority.

---

## 5. Still OPEN — do not close these by convenience

| Item | State |
|---|---|
| **ATP** | OPEN. A derivation exists (`computePartAvailability`); the policy does not. `onHand − committed` is **not** the formula. |
| **Stockout** | OPEN. No definition of any kind. `predictStockout` is a labelled forecast, not a state. |
| Consumption → on-hand | OPEN (§4.1) — blocks one commitment pool |
| Reservation company/location scope | OPEN (§4.2) |
| TEAM / SELF activation | OPEN — granted, not eligible, not active |
| Dashboard `Committed` / `Available` / ATP | **GATED.** A test fails if `availableToPromise` / `"Committed"` / "Reserved to WOs" reaches the client. |

---

## 6. Dashboard implications (from the census, as corrected)

**Safe now:** reachable destinations, scan-workflow availability, account portfolio counts, open WO
by status, scheduled/past-due/conflicts/parts-blocked, completion counts, movement counts, open POs,
suppliers, receiving queue, PO progress + discrepancies, reorder queue, technician my-work + all-time
performance, admin approval queues.

**Safe after activation only:** governed part balance (one transport flag —
`INVENTORY_BALANCE_READ_READY`), CRM activity, coordinated operations, sales spine, inventory ops,
equipment lifecycle.

**Financial:** reachable in **sandbox for the 5 CONSOLIDATED carriers** after a Functions deploy;
zero for everyone else and everywhere else.

**Do not implement:** margin / inventory value / turns (FIN-BLOCK-003), any period-relative KPI
(no reporting-period authority when I measured — note the other session merged #1751 "one authority
for when a period starts, ends, and what it compares to", so **re-check this one**), AOV, forecast,
goal %, pipeline value, first-time-fix, SLA, callbacks, inventory aging, shortages, notification
history.

---

## 7. Deploy status

**Nothing was deployed in this session.** #1749 changes deployed Functions, so runtime effect needs
a bounded sandbox deploy of `transitionWorkOrder` and `setWorkOrderPartsPlan`. Merge ≠ live.

---

## 8. Key artifacts to read

```
docs/assessments/eos-dashboard-reporting-authority-census.md   (+ .json companion)
docs/assessments/fin004-reach-reconciliation.md
docs/assessments/inventory-commitment-reservation-authority.md (carries a SUPERSEDED-IN-PART banner)
functions/test/fin004ReachComposition.test.mjs                 (18 checks)
functions/test/inventoryCommitmentAuthority.test.mjs           (14 checks)
functions/test/inventoryConsumptionOnHandGap.test.mjs          (5 checks — the blocker)
functions/test/reservationFollowsDemand.test.mjs               (9 checks — emulator)
```

## 9. Environment gotchas worth carrying over

- **Port 8080 is occupied by another session's emulator.** Run your own:
  `firebase emulators:start --only firestore --config <your-own>.json` on a distinct port and pass
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:<port>`. Clear between runs via the emulator REST
  `DELETE /emulator/v1/projects/taylor-parts/databases/(default)/documents`.
- `main` moved **15 commits** during one package. Merge (don't rebase/force-push) and re-run
  `test:access` / `test:fulfillment` / `test:governance` after.
- `npm run test:governance` regenerates artifacts then `git diff --exit-code` — it fails until you
  **commit** the regenerated files. Never hand-edit them.
