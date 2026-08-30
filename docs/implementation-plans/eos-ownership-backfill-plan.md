---
artifact_type: implementation-plan
gate: Owner decision — NOT authorized for execution
status: Proposed — Revision 4 (complete migration, one final write set)
date: 2026-08-30
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/eos-ownership-model-reconciliation.md]
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# EOS Ownership Model v1 — proposed deterministic backfill plan

**NOTHING IN THIS DOCUMENT HAS BEEN EXECUTED.** The Owner's post-census ruling authorized a
*proposed* plan and explicitly withheld execution. No backfill script exists, no record has been
written, and no enforcement has been enabled.

Measured against the sandbox census of 2026-08-30 (`sb-evidence/ownership-census-sandbox-2026-08-30.txt`)
after the Account-owner seed correction: **1,229 ownable records scanned — 136 RESOLVED,
1,093 OWNERLESS, 0 INVALID, 0 UNKNOWN, 0 AMBIGUOUS.**

## The shape of the problem

The 1,093 outstanding records fall into four groups that need *completely different things*, and
the plan's whole value is keeping them apart. Three of them cannot be started at all today.

| Group | Records | What it is waiting for |
|---|---|---|
| **1. Derivable now** | 522 | Nothing. A deterministic source already exists in the data. |
| **2. Waiting on the physical roots** | 138 | Owner-supplied company for 19 sites/vehicles. Then derivable. |
| **3. Waiting on a business fact** | 386 | New input. No source exists and none can be invented. |
| **4. Waiting on a model decision** | 47 | An Owner ruling on shape, not on data. |

## Group 1 — derivable now (522 records)

The only group whose source exists in the data today, and it is a real relationship rather than a
proxy: `contacts.accountId` and `locations.accountId` are already enforced parentage in
`firestore.rules`.

| Collection | Records | Source | Confidence |
|---|---|---|---|
| `contacts` | 339 | parent Account's `accountOwner.assignedToEmployeeId` | Deterministic |
| `locations` | 183 | parent Account's `accountOwner.assignedToEmployeeId` | Deterministic |

**Caveat that bounds it:** 3 sandbox Accounts remain ownerless (the non-fixture records
`78FlpQX7iC7jQX528buX`, `acct-harbor`, `acct-summit`). Any contact or location under those three
inherits nothing and stays OWNERLESS — correctly. The 522 figure is the ceiling, not a promise.

**Ordering constraint:** Accounts must be resolved *first*. Running this before Account ownership is
complete silently under-fills, and the shortfall looks identical to success.

## Group 2 — waiting on the physical roots (138 records)

Ruling D-9 named four families as company-boundary roots. They are the only records whose company is
a *primary* business fact rather than something derived, so they must be supplied by governed
configuration — 19 decisions in total, and everything below them then follows.

| Root collection | Records | Needs |
|---|---|---|
| `warehouses` | 5 | Owner-supplied company per site |
| `stock_locations` | 5 | Owner-supplied company per location |
| `mobile_locations` | 7 | Owner-supplied company per location |
| `trucks` | 2 | Owner-supplied company per vehicle |
| **19 root decisions** | **19** | |

Once those 19 carry an `operatingCompanyId`, these derive (ruling D-10):

| Collection | Records | Derives from | Scope |
|---|---|---|---|
| `inventory_transactions` | 103 | the stock location's company | SINGLE_COMPANY |
| `cycle_counts` | 24 | the counted location's company | SINGLE_COMPANY |
| `receiving_orders` | 2 | the destination location's company | SINGLE_COMPANY |
| `reorder_requests` | 6 | the governed stock location's company | SINGLE_COMPANY |
| `reorder_purchase_orders` | 3 | the linked Reorder Request's company | SINGLE_COMPANY |
| **derived subtotal** | **138** | | |

**Not yet verified:** that every one of those 138 records actually carries a resolvable location
reference. The census measured ownership, not referential completeness. A dry run of the derivation
must report its own unresolvable count before any write — a derivation that silently skips is the
same defect as a census that silently truncates.

## Group 3 — waiting on a business fact (386 records)

No deterministic source exists, and every candidate visible on the record is a proxy the rulings
prohibit. These cannot be planned further without new input.

| Collection | Records | Why no source exists |
|---|---|---|
| `equipment` | 288 | Ruling D-12. Customer, title holder and location name are all prohibited proxies. The only non-prohibited candidate would be the unit's stocking/custody location, and the model does not currently tie an installed unit to one of our sites. |
| `fieldops_jobs` | 45 | Ruling D-13. Company must not come from the assigned technician (that is assignment) or the customer. No upstream commercial record carries a company either. |
| `fieldops_wos` | 30 | As above. |
| `accounts` | 3 | Ruling D-6 forbids every inference. These three need explicit assignment. |
| `invoices` | 1 | Ruling D-15. Owner is the company whose books hold it — and no upstream commercial record stores an operating company yet. |
| **subtotal** | **367** | |

`payments`, `payment_applications`, `invoice_adjustments`, `refunds`, `purchase_orders` and
`inventory_actions` are empty in sandbox (0 records) and belong to this group by classification.
The 386 figure counts the 367 above plus the 19 root decisions from Group 2, which are themselves
business facts rather than derivations.

**The equipment observation worth raising:** 288 records is 24% of the ownable population and the
single largest blocker. If a legitimate deterministic source exists in the business — a stocking
warehouse, a purchase lineage, a serial-range convention — naming it would collapse this group. If
one does not, 288 explicit assignments is the honest cost, and it should be priced before it is
scheduled.

## Group 4 — waiting on a model decision (47 records)

| Collection | Records | The question |
|---|---|---|
| `transfer_orders` | 47 | A transfer has a source *and* a destination, and a Taylor↔Ventana move is legitimate. A single `owner` may be the wrong shape. Ruling D-10 anticipated this: it may need **participating-company fields** instead of one owner. |

No backfill is proposed. The next step is a decision about the model, not about the data — and
until it is taken, any number assigned here would be a false fact rather than a missing one.

## What the plan deliberately does not contain

- **No inference from a prohibited proxy.** Not `lineOfBusiness`, display text, title holder,
  customer, location name, creator, assignment, territory, coverage, activity, sales history, or
  auth uid. The matrix (`functions/src/ownership/ownershipMatrix.ts`) records a `backfillSource` of
  `null` wherever none exists, and a test asserts no source names a prohibited proxy.
- **No default to Taylor.** Ruling D-11 forbids it, and Group 3 is the cost of honouring that.
- **No REFERENCE-family backfill.** 130 sandbox records (`parts` 52, `equipment_models` 48,
  `part_aliases` 21, `part_supplier_items` 7, `suppliers` 2) are classified company-neutral and are
  outside the invariant. They are not in any group above.
- **No enforcement.** The gate stays shut regardless of how much of this is executed.

## Proposed sequence, if and when authorized

1. Resolve the 3 remaining sandbox Accounts (explicit assignment).
2. Dry-run the Group 1 derivation; report unresolvable parentage; then apply. **522 records.**
3. Owner supplies the 19 physical-root companies.
4. Dry-run the Group 2 derivation; report unresolvable location references; then apply. **138.**
5. Owner ruling on `transfer_orders` shape. **47.**
6. Owner decision on the `equipment` source. **288.**
7. Explicit assignment for the service families. **75.**
8. Re-census. Only if it reads zero does the enforcement question open at all.

Every applying step is dry-run-first, idempotent, sandbox-before-production, and reports what it
could *not* resolve rather than skipping it silently.

## Open question carried forward

**`suppliers` (2 records) is provisionally classified REFERENCE.** A supplier's *identity* is shared
between operating companies; a supplier *relationship* — terms, pricing, account numbers, approval —
may well be company-specific. The census cannot tell which of those the collection represents.
Classified company-neutral for now and flagged in the matrix; if `suppliers` carries commercial
terms it belongs in COMPANY, and the 2 records move into Group 3.

---

# Revision 2 — measured, 2026-08-30

Revision 1's groups were derived from the matrix. The referential derivation check
(`sb-evidence/ownership-derivation-check-sandbox-2026-08-30.txt`) measured the data, and it moved a
substantial number of records. The Owner's instruction — *"do not assume the full 138 are derivable
until that check passes"* — was the right call: **it was not 138.**

## What the derivation check measured

199 records scanned across nine descendant families:

| Collection | scanned | DERIVABLE | MISSING_REF | INVALID_REF | X-COMPANY | CONFLICT |
|---|---|---|---|---|---|---|
| `cycle_counts` | 24 | **24** | 0 | 0 | 0 | 0 |
| `receiving_orders` | 2 | **2** | 0 | 0 | 0 | 0 |
| `inventory_transactions` | 103 | **91** | 4 | 0 | 8 | 0 |
| `transfer_orders` | 47 | 0 | 0 | 0 | **47** | 0 |
| `stock_locations` | 5 | **5** | 0 | 0 | 0 | 0 |
| `trucks` | 2 | **2** | 0 | 0 | 0 | 0 |
| `mobile_locations` | 7 | 5 | 2 | 0 | 0 | 0 |
| `reorder_requests` | 6 | 0 | **6** | 0 | 0 | 0 |
| `reorder_purchase_orders` | 3 | 0 | **3** | 0 | 0 | 0 |
| **total** | **199** | **129** | **15** | **0** | **55** | **0** |

Zero INVALID_REFERENCE and zero CONFLICT: no record points at a warehouse that does not exist, and
no record's two references disagree when they should have matched. The referential data is sound.

## What changed from revision 1

**Two families are not roots.** `stock_locations` turned out to be a per-warehouse-per-part *balance*
record, not a physical place — 5/5 derive from `warehouseId`. `trucks` carry `homeWarehouseId` —
2/2 derive. **The root decision count drops from 19 to 12** (5 warehouses + 7 mobile locations), and
7 records move from "needs a decision" to "derives".

**`reorder_requests` (6) and `reorder_purchase_orders` (3) carry no location reference of any kind.**
Revision 1 listed both as location-derivable. They are not: a reorder request records a part, a
quantity and a workflow, and never says where. The purchase order reaches a root only through the
request, and a two-hop derivation over a broken first hop is not a derivation. **9 records move to
"needs a business fact".**

**`inventory_transactions` splits three ways.** 91 derive; 4 are legacy-shape entries with no
location at all; 8 reference two distinct roots (a movement between two places) and are
cross-company-capable in the same way a transfer is.

**`mobile_locations` 2/7 are unreferenced** — the two `mobile-seed…` rows carry no home warehouse.
They are roots themselves, so they need a decision, not a derivation.

## Revised groups

| Group | Records | Waiting for |
|---|---|---|
| **1. Derivable now** (person) | 522 | Nothing — `contacts` 339 + `locations` 183 from the parent Account owner |
| **2. Derivable once the 12 roots carry companies** | 124 | 12 Owner decisions |
| **3. Cross-company pair, once roots carry companies** | 55 | The same 12 decisions, then a participating pair rather than one owner |
| **4. Needs a business fact** | 386 | New input — no source exists |

### Group 2 detail (124)

`inventory_transactions` 91 · `cycle_counts` 24 · `stock_locations` 5 · `trucks` 2 · `receiving_orders` 2.

### Group 3 detail (55)

`transfer_orders` 47 · `inventory_transactions` 8. These resolve to a **participating pair**
(`sourceOperatingCompanyId` + `destinationOperatingCompanyId`), not one owner — Owner ruling Q3. All
47 transfers reference two distinct roots today, so every one of them will carry a pair; whether any
pair actually crosses the Taylor/Ventana boundary depends on the 12 root assignments.

### Group 4 detail (386)

| Collection | Records | Why |
|---|---|---|
| `equipment` | 288 | Ruling Q2 — no deterministic source authorized from current data |
| `fieldops_jobs` + `fieldops_wos` | 75 | No company reference; technician and customer are prohibited proxies |
| `reorder_requests` | 6 | **Newly measured** — no location reference exists |
| `reorder_purchase_orders` | 3 | **Newly measured** — derives only through the above |
| `accounts` | 3 | Non-fixture; explicit assignment only |
| `invoices` | 1 | No upstream record carries an operating company |
| `mobile_locations` | 2 | Seed rows with no home warehouse; they are roots and need a decision |
| **plus the 12 root decisions** | 12 | Primary business facts |

## Equipment fixture provenance (Owner ruling: sandbox equipment)

**Measured: 278 of 288 equipment records are certification fixtures** (`dataProvenance:
SYNTHETIC_CERTIFICATION_FACT`); 10 are not.

**But zero of the 278 can receive a company fact from their fixture definition as it stands today.**
The fixture (`functions/scripts/certificationWorld/data/equipmentAssets.mjs`) writes `accountId`,
`locationId`, `manufacturer`, `model`, `equipmentModelId`, `serialNumber`, `status`, dates, and
`lineOfBusiness: model.lineOfBusiness`. Every one of those is either irrelevant or a prohibited
proxy — `lineOfBusiness` and the equipment model are both named in ruling Q2's forbidden list, and
they are the only company-shaped values present.

So this is not a case of promoting an existing fixture fact. It requires **adding a new explicit
fact to the fixture definition**: a declared, stated Taylor-or-Ventana assignment per fleet or per
account, authored as part of the synthetic world rather than inferred from it. The ruling permits
exactly that ("defining the synthetic business fact at creation") — but the rule itself is a
fixture-authoring decision about which company services which synthetic customer, and it is not
mine to invent.

**Recommendation:** declare it at the fleet level in `equipmentAssets.mjs` (each fleet definition
gains an explicit `operatingCompanyId`), so a rebuild produces correctly-owned equipment and a
marker-scoped applier can remediate the existing 278. The 10 non-fixture records stay untouched.
**What is needed from the Owner is the rule, not the code.**

## Still requiring a genuine business decision

1. **12 physical roots** — `config/ownership/operating-company-roots.sandbox.json`, every value
   `null`. Unblocks 124 + 55 records.
2. **The equipment fixture rule** — which company services which synthetic fleet. Unblocks 278.
3. **Service ownership source** — `fieldops_jobs` / `fieldops_wos` (75) have no company reference at
   all. Either one is added at creation, or they stay ownerless.
4. **`reorder_requests` location** (6+3) — newly discovered. Does a reorder request belong to a
   stocking location in the business, and should it record one?
5. **3 non-fixture accounts + 1 invoice + 2 seed mobile locations** — explicit assignment.
6. **Production census** — still unmeasured; see
   `docs/operations/production-ownership-census-operator-instructions.md`.

Nothing above has been executed.

---

# Revision 3 — simulated against authored facts, 2026-08-30

Rulings R-1 … R-10 supplied the facts the plan was missing. With the 12 physical roots assigned and
the equipment fleets authored, the backfill was **simulated read-only**
(`sb-evidence/ownership-backfill-simulation-sandbox-2026-08-30.txt`). Nothing was written; the tool
has no apply mode.

## PROPOSED SANDBOX WRITE COUNT: 974 documents. 19 blocked.

| Collection | scanned | WOULD WRITE | blocked | Source |
|---|---|---|---|---|
| `contacts` | 339 | **337** | 2 | parent Account owner |
| `locations` | 183 | **180** | 3 | parent Account owner |
| `equipment` | 288 | **278** | 10 | authored fixture fleet company |
| `inventory_transactions` | 103 | **99** | 4 | location's authored company |
| `transfer_orders` | 47 | **47** | 0 | origin + destination participating pair |
| `cycle_counts` | 24 | **24** | 0 | counted location |
| `stock_locations` | 5 | **5** | 0 | `warehouseId` |
| `trucks` | 2 | **2** | 0 | `homeWarehouseId` |
| `receiving_orders` | 2 | **2** | 0 | receiving location |
| **total** | **993** | **974** | **19** | |

## The cross-company path is now genuinely exercised

The mixed root assignment did what it was for. Of 47 transfers: **24 same-company, 23 cross-company.**
Of the 8 inventory transactions referencing two roots, **2 resolve to a genuine cross-company pair**
and 6 to two locations of the same company.

That distinction is only visible because the roots carry companies: the derivation check could see
*two distinct roots*, but only the simulation can see *two distinct companies*. A Taylor-only
sandbox would have produced 47 same-company transfers and certified nothing.

## The 19 blocked, by reason

| Reason | Records | Disposition |
|---|---|---|
| parent Account has no owner | 5 (2 contacts, 3 locations) | Correct. Ruling R-7 keeps the 3 non-fixture accounts ownerless as control records, and this is that decision propagating exactly as specified — unresolved, never a substitute owner. |
| non-fixture equipment | 10 | Correct. Ruling R-2: never overwrite non-fixture equipment. |
| no resolvable location reference | 4 | Correct. Ruling R-5: the four legacy inventory transactions stay unresolved. |

**Every blocked record is blocked by a rule, not by a defect.** There is no "could not figure it
out" bucket.

## Residual ownerless after the proposed backfill

Assuming all 974 writes were applied, these would remain — and each is a stated decision, not a gap:

| Collection | Records | Why it stays |
|---|---|---|
| `fieldops_jobs` | 45 | R-3. 41 are fixtures and *could* be authored; that authoring has not been done because the ruling asked for provenance reconciliation first, not the assignment. 4 are non-fixture. |
| `fieldops_wos` | 30 | `NO_GOVERNED_COMPANY_SOURCE`. R-12 withdrawn (DECISIONS #143): this is a company-provenance gap, not a lineage defect. |
| `reorder_requests` | 6 | R-4. 6/6 carry no `warehouseId`. Needs a schema change, not a backfill. |
| `reorder_purchase_orders` | 3 | R-4, blocked upstream by the above. |
| `accounts` | 3 | R-7. Deliberate control records. |
| `inventory_transactions` | 4 | R-5. Legacy shape, no location. |
| `contacts` / `locations` | 5 | Downstream of the 3 control accounts. |
| `invoices` | 1 | R-8. No Sales Order carries an operating company yet. |
| **total residual** | **97** | |

## The commercial company-scope gap (R-8)

The matrix now records `companyScopeField: "operatingCompanyId"` on `opportunities`,
`sales_agreements` and `sales_orders` — the orthogonal axis, **not** ownership. `ownerEmployeeId =
Rudy` and `operatingCompanyId = taylor` are both true on one record.

**The gap: none of the three stores it today.** That is why every financial artifact has a null
backfill source — the lineage
`Sales Order.operatingCompanyId → Invoice → Payment/Adjustment/Refund` has no first link. Closing it
is a commercial-chain change (where does a Sales Order get its operating company?), and it is
recorded here rather than guessed. It was **not** inferred from `lineOfBusiness`.

## Service provenance (R-3), measured

| | total | fixtures | non-fixture |
|---|---|---|---|
| `fieldops_jobs` | 45 | **41** | 4 |
| `fieldops_wos` | 30 | **0** | 30 |

41 jobs can be authored with an explicit company exactly as the equipment fleets were.

`fieldops_wos` carries `assignedTechId`, `scheduledTechId`, `customerId`, `locationId` and
`salesOrderId` — and no job reference. **This paragraph originally read that as a missing link and
called establishing it a prerequisite. That was wrong, and DECISIONS #143 corrects it:** R-12 is
withdrawn, `fieldops_wos` is the current Work Order authority and `fieldops_jobs` a distinct legacy
domain, and the absence of a link between them is not a defect because no such lifecycle was ever
required.

A Work Order's company resolves from **its own** governed context. The 30 are reclassified
`NO_GOVERNED_COMPANY_SOURCE` — a company-provenance gap. 11 of them carry a `salesOrderId` and become
*potentially* derivable once the commercial company axis exists; that is to be **measured, not
assumed**.

## Still requiring a genuine business decision

1. **Author the 41 service Job fixture companies** — same mechanism as equipment; needs the rule.
2. **The Job→Work Order link** — 30 work orders have no parent. Prerequisite to R-3 inheritance.
3. **`reorder_requests.warehouseId`** — schema addition; 6+3 records depend on it.
4. **Sales Order `operatingCompanyId`** — where does a commercial record get its company? Unblocks
   the whole financial lineage.
5. **Production census** — still unmeasured; runbook ready.
6. **Authorization to apply the 974 sandbox writes.** Not requested here.

---

# Revision 4 — the complete migration, simulated once (2026-08-30)

Rulings R-11 through R-15 closed the three structural gaps that would otherwise have forced a second
ownership migration. This is the **one final proposed write set**.

## PROPOSED SANDBOX WRITE COUNT: 1,015 documents. 99 blocked. Nothing written.

| Collection | scanned | WOULD WRITE | blocked | Source |
|---|---|---|---|---|
| `contacts` | 339 | **337** | 2 | parent Account owner |
| `locations` | 183 | **180** | 3 | parent Account owner |
| `equipment` | 288 | **278** | 10 | authored fixture fleet |
| `inventory_transactions` | 103 | **99** | 4 | location's authored company |
| `transfer_orders` | 47 | **47** | 0 | participating pair |
| `fieldops_jobs` | 45 | **41** | 4 | authored fixture Job company |
| `cycle_counts` | 24 | **24** | 0 | counted location |
| `stock_locations` | 5 | **5** | 0 | `warehouseId` |
| `trucks` | 2 | **2** | 0 | `homeWarehouseId` |
| `receiving_orders` | 2 | **2** | 0 | receiving location |
| `fieldops_wos` | 30 | 0 | 30 | no governed company source |
| `opportunities` | 14 | 0 | 14 | non-fixture, no company provenance |
| `sales_orders` | 17 | 0 | 17 | non-fixture |
| `sales_agreements` | 5 | 0 | 5 | non-fixture |
| `reorder_requests` | 6 | 0 | 6 | no `warehouseId` yet |
| `reorder_purchase_orders` | 3 | 0 | 3 | blocked upstream |
| `invoices` | 1 | 0 | 1 | non-fixture |
| **total** | **1,114** | **1,015** | **99** | |

## The gate answers

**Service Jobs.** 41 of 45 resolvable, authored in
`functions/scripts/certificationWorld/data/serviceJobCompany.mjs` — 27 Taylor / 14 Ventana, solved
exactly against the 2:1 target and persisted as literal values. Grouped by technician so no
technician works for two companies; the grouping is not a rule, and nothing computes it. The 4
non-fixture Jobs are absent from the map and stay unresolved.

**Work Orders.** 0 EXACT_PARENT, 0 MULTIPLE_CANDIDATES, **30 NO_CANDIDATE**. Company-resolvable:
**0**. The reconciliation is structural rather than a threshold judgement: Jobs serve `cw-acct-*`
customers, Work Orders serve `acct-harbor` / `acct-summit` / `probe-c`, and the two sets do not
intersect at all. 0 of 30 are fixtures and none carries a `jobId`.

The coincidence counts are the evidence for the ruling: 19 Work Orders coincide with 3 Jobs apiece,
three with 5, three with 4. Matching on customer or technician would have picked one arbitrary
parent out of up to five.

**Reorder requests.** 0 of 6 have explicit warehouse provenance. None is a certification fixture and
none carries a scenario id. Two mention "wh-main" in `reviewNotes` free text — **deliberately not
used**: prose in a note is display text, and reading a governed reference out of it is precisely the
inference every ruling has forbidden. **Reorder POs company-resolvable: 0**, blocked upstream.

**Commercial chain.** Opportunities with `operatingCompanyId`: **0 of 14**. Agreements: **0 of 5**.
Sales Orders: **0 of 17**. Invoice: **0 of 1**.

One fact explains all of it: **the entire commercial chain is non-fixture and sits under
`acct-harbor`** — one of the three control accounts R-7 deliberately leaves ownerless. There is no
certification commercial scenario to reconcile, so R-14's preferred sandbox remediation has nothing
to attach to. Per the ruling, all 37 stay unresolved.

**Equipment.** 278 fixture, all resolvable; 10 protected non-fixture. Unchanged.

**Final counts by shape.** PERSON 517 writes (contacts, locations). COMPANY 451 (equipment 278,
inventory 99, jobs 41, cycle counts 24, stock locations 5, trucks 2, receiving 2).
PARTICIPATING_COMPANIES 47 transfers — 24 same-company, 23 cross-company.

**INVALID / UNKNOWN / AMBIGUOUS: 0, and expected to remain 0.** Every write derives from a governed
authority or an authored fixture, and both are validated against `resolveOperatingCompany` before
use — a value that failed validation would raise rather than write. Nothing derives from a proxy, so
no record can acquire two disagreeing owners.

## The 99 blocked, every one by a rule

| Reason | Records |
|---|---|
| `NO_GOVERNED_COMPANY_SOURCE` -- R-12 withdrawn, DECISIONS #143 | 30 |
| non-fixture commercial record, no company provenance (R-14) | 37 |
| non-fixture equipment, never overwritten (R-2) | 10 |
| no `warehouseId`, schema addition required first (R-13) | 9 |
| parent Account has no owner (R-7 control accounts) | 5 |
| no resolvable location reference, legacy shape (R-5) | 4 |
| not an authored certification Job (R-11) | 4 |

**There is no "could not figure it out" bucket.**

## Confirmation on production

**No applier exists.** That is the strongest available answer to "the proposed applier cannot touch
production": there is nothing that can write. The simulation has no `--apply` mode, and
`functions/test/ownershipProductionGuard.test.mjs` asserts it cannot quietly acquire one.

The guard an applier must inherit is already shipped, and is now **asserted rather than promised**.
The same suite pins that every ownership-writing script refuses `taylor-parts` by name, refuses any
project whose registry role is `production`, fails closed on an unknown project, and has no default
target — and that all four read-only tools contain no Firestore write call at all.

## Still requiring a business decision

1. **Work Order operating-company provenance.** 30 Work Orders have no governed company source. (R-12 is WITHDRAWN -- see DECISIONS #143. There is no Job link to add and no missing parent to repair.)
2. **Commercial company provenance.** The whole chain is non-fixture; either a certification
   commercial scenario is authored, or these 37 stay unresolved indefinitely.
3. **`reorder_requests.warehouseId`.** The domain authority is written and inert
   (`functions/src/ownership/reorderRequestLocationAuthority.ts`); the 6 records need the field.
4. **Authorization to apply the 1,015 sandbox writes.**
