---
artifact_type: implementation-plan
gate: Owner decision — NOT authorized for execution
status: Proposed
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
