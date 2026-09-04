# Cost to Serve One Taylor-Sized Customer

**Status: DRAFT — NOT A PRICE, NOT A QUOTE, NOT ACCEPTED.**
**Decision owner: Verenward Owner (cost inputs and labor rate); Taylor (scale inputs).**
**Gate: `C1-COMM-01`.**

This document is the cost side of the commercial model only. It produces no
price. It defines what one Taylor-sized customer costs to run and support for a
year, names every input the arithmetic needs, and marks each input that nobody
has supplied yet as `UNKNOWN`.

Every `UNKNOWN` in this document is a real gap, not a placeholder to be filled
in with a plausible guess. An `UNKNOWN` filled by an agent is an invented
customer fact and is prohibited by `docs/customer-1/README.md` authority rule 3.

## The red line this model exists to enforce

`CUSTOMER_1_READINESS.md` lists as a production red line:

> subscription economics depend on treating founder labor as free

So labor is a first-class cost line here, carrying a loaded hourly rate, on the
same footing as infrastructure. A cost model that shows a low monthly
infrastructure number and omits the hours behind it is the exact failure the red
line names. Section 4 may not be zeroed out, and it may not be priced at $0/hr,
for any reason including "the founder was going to do it anyway."

## The arithmetic

```
one_time_cost      = implementation_labor + migration_labor + training_delivery_labor
                     + one_time_third_party

annual_run_cost    = annual_infrastructure
                     + annual_tooling
                     + annual_support_labor
                     + annual_sustaining_engineering_labor
                     + annual_account_and_admin_labor
                     + contingency_reserve

monthly_floor      = annual_run_cost / 12
```

`monthly_floor` is a **cost floor**, not a subscription price. Converting it to a
price requires margin, risk, term, and founding-customer posture decisions that
this lane must not make. Those go to the pricing worksheets and end in a named
Owner question.

## 1. Scale inputs (drive every other number)

"Taylor-sized" is currently undefined. These are the quantities that move cost.

| Input | Unit | Value | Source |
|---|---|---|---|
| Named users | count | `UNKNOWN` | Taylor — ties to `C1-IDENTITY-01` |
| Concurrent field technicians | count | `UNKNOWN` | Taylor |
| Work orders per month | count | `UNKNOWN` | Taylor |
| Service/dispatch events per work order | count | `UNKNOWN` | Taylor |
| Part master SKUs | count | `UNKNOWN` | Taylor — ties to `C1-DATA-01` |
| Purchase orders + receipts per month | count | `UNKNOWN` | Taylor |
| Sales orders / invoices per month | count | `UNKNOWN` | Taylor |
| Photos and attachments per month | count + avg MB | `UNKNOWN` | Taylor |
| Required data retention | months | `UNKNOWN` | Taylor + Verenward |
| Migrated historical record volume | count by system | `UNKNOWN` | `C1-DATA-01` |

**Open issues**

- No scale input is known. Until at least users, work orders per month, and
  attachment volume are supplied, sections 2 and 4 cannot be quantified at all.
- Historical migration volume is owned by lane B (`C1-DATA-01`). This lane
  consumes that output; it must not estimate it.

## 2. Platform infrastructure (recurring)

Metered cloud cost attributable to this one customer.

| Line | Meter | Cost driver | Value |
|---|---|---|---|
| Firestore reads | per 100k docs read | screen loads, dashboards, list views | `UNKNOWN` |
| Firestore writes/deletes | per 100k ops | work orders, inventory movements, audit records | `UNKNOWN` |
| Firestore stored data | GB-month | record volume + retention | `UNKNOWN` |
| Cloud Functions invocations | per million | governed callables, triggers | `UNKNOWN` |
| Cloud Functions compute | GB-seconds | callable duration × volume | `UNKNOWN` |
| Cloud Storage | GB-month | photos, attachments, exports | `UNKNOWN` |
| Egress / Hosting bandwidth | GB | app delivery, exports, data return | `UNKNOWN` |
| Backup storage and restore egress | GB-month + per restore | `C1-RECOVERY-01` policy | `UNKNOWN` |
| Logging and audit retention | GB ingested | audit and governance retention policy | `UNKNOWN` |

**Assumptions stated**

- Assumes the Day-1 architecture as it exists in this repository, with no new
  paid managed service introduced for Customer 1.
- Assumes cost is attributed to a single customer project. If Customer 1 shares
  a project with other tenants or with development, per-customer attribution is
  an accounting choice, not a meter reading, and must be decided before this
  section can be closed.

**Open issues**

- No billing observation exists. These meters are the right ones; nobody has
  read them for a Taylor-shaped load.
- Backup and retention policy is not set (`C1-RECOVERY-01`). Retention is a
  direct multiplier on the three largest storage lines, so this section cannot
  be closed before that gate produces a policy.
- Whether the private AI assistant runtime is inside Day-1 scope is unresolved
  (`C1-SCOPE-01`). If it is, it adds a compute/inference line that is absent
  above, and a self-hosted host cost that does not scale to zero.

**Decision owner:** Verenward Owner, after `C1-RECOVERY-01` sets retention and
`C1-SCOPE-01` freezes scope.

## 3. Tooling and third-party (recurring)

| Line | Basis | Value |
|---|---|---|
| CI/CD minutes attributable to sustaining this customer | per-minute | `UNKNOWN` — see `C1-COST-01` |
| Domain, DNS, certificates | annual | `UNKNOWN` |
| Error/uptime monitoring | monthly | `UNKNOWN` |
| Transactional email / SMS, if any Day-1 workflow sends it | per message | `UNKNOWN` |
| Any per-seat third-party dependency | per seat | `UNKNOWN` |

**Open issues**

- Shared tooling cost must be allocated, not measured. The allocation rule
  (per customer, per seat, or absorbed as company overhead) is unset, and it
  changes the answer materially while Customer 1 is the only customer.
- `C1-COST-01` is open and records that broad application CI still runs on
  changes that do not need it. That is an active, unbounded cost line.

**Decision owner:** Verenward Owner (allocation rule).

## 4. Labor (recurring) — may not be zero

Loaded hourly rate applies to **all** labor including founder labor. A loaded
rate is the fully-burdened cost of an hour of that person's time, not a salary
divided by hours, and not zero.

| Line | Basis | Hours | Rate | Value |
|---|---|---|---|---|
| Support intake and triage | hours/month | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| Escalation and incident response | hours/month | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| Off-hours / on-call availability | hours/month or retainer | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| Sustaining engineering — defects | hours/month | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| Administration Taylor cannot self-serve | hours/month | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| Account management and reviews | hours/month | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| Refresher and new-hire training | hours/year | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |

**Assumptions stated**

- Enhancement work is **excluded** from this table. Enhancements are billable
  custom work and belong to a separate revenue line; folding them into the
  recurring cost of support hides the bug-vs-enhancement boundary that
  `C1-SUPPORT-01` exists to draw.
- "Administration Taylor cannot self-serve" is a cost line today because
  `C1-ADMIN-01` is open. If that gate closes well, this line shrinks. It is
  listed separately so the saving is visible rather than buried.
- Support hours cannot be estimated before the support model defines what
  Verenward is committing to answer, how fast, and during which hours.

**Open issues**

- The loaded hourly rate for founder labor is unset. Every labor line is
  unquantifiable without it, and the readiness red line makes `$0` an invalid
  answer.
- On-call has a cost even in months when nothing breaks. Whether that is priced
  as availability or as consumed hours is a posture decision, not a measurement.
- Support hours depend on the support model, which is drafted separately under
  `C1-SUPPORT-01`. This model consumes that output.

**Decision owner:** Verenward Owner (rate, on-call posture); support hour
estimates follow the `C1-SUPPORT-01` draft.

## 5. One-time implementation cost

Recovered through the implementation revenue line, not the subscription.

| Line | Basis | Value |
|---|---|---|
| Discovery, scope freeze, configuration | hours × loaded rate | `UNKNOWN` |
| Data migration build, rehearsal, reconciliation | hours × loaded rate | `UNKNOWN` — sized by `C1-DATA-01` |
| Opening inventory reconciliation support | hours × loaded rate | `UNKNOWN` — sized by `C1-INV-01` |
| Identity and role provisioning | hours × loaded rate | `UNKNOWN` — `C1-IDENTITY-01` |
| Training delivery | hours × loaded rate | `UNKNOWN` — `C1-TRAINING-01` |
| Cutover rehearsal and cutover | hours × loaded rate | `UNKNOWN` — `C1-CUTOVER-01` |
| Post-cutover stabilization period | hours × loaded rate | `UNKNOWN` |

**Open issues**

- Migration rehearsal is explicitly plural in `C1-CUTOVER-01`. How many
  rehearsals are included before additional ones become billable is an unmade
  commercial decision, and it is a common source of unbounded implementation
  cost.
- The stabilization period has no defined length. Without one, "implementation"
  never ends and its cost is open-ended.

**Decision owner:** Verenward Owner, with Taylor agreement on rehearsal count
and stabilization length.

## 6. Contingency reserve

**Open issues**

- No reserve percentage is set. Given that every input above is `UNKNOWN` and
  this is the first customer of the platform, a reserve is not optional, but
  its size is an Owner decision and this lane must not pick one.

**Decision owner:** Verenward Owner.

## What this model deliberately does not do

- It does not produce a price, a margin, or a discount.
- It does not assume a contract term, a payment schedule, or a founding-customer
  concession.
- It does not estimate any `UNKNOWN`. Filling one requires a measurement or a
  named human decision.

## Consumers of this document

- `PRICING_DECISION_WORKSHEETS.md` — one worksheet per revenue line
  (implementation, subscription, support, founding-customer treatment, change
  requests, billable custom work), each ending in a named Owner question.
- The unresolved decision register, which carries every `UNKNOWN` above to its
  decision owner.
