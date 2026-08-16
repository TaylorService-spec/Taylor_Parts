# Competitor pricing — what the alternatives actually cost

**Last researched:** 2026-08-16 · **By:** Claude (seed entry)

**Why this matters:** "Salesforce and Dynamics are too expensive for small businesses" is true
and well known to anyone in this market — but as an *assertion* it loses to a partner with a
quote sheet. Said with sourced numbers it becomes the strongest argument available.

## Licence cost (per user, per month)

| Product | Cost | Source |
| --- | --- | --- |
| Salesforce Field Service | ~$109 | [itqlick comparison](https://www.itqlick.com/dynamics-365-for-field-service-formerly-fieldone/pricing) |
| Dynamics 365 Field Service | ~$105 | [itqlick](https://www.itqlick.com/dynamics-365-for-field-service-formerly-fieldone/pricing) · [Rand Group](https://www.randgroup.com/insights/microsoft/dynamics-365/customer-engagement/field-service/understanding-dynamics-365-field-service-pricing/) |
| Dynamics 365 FS Contractor (external techs) | ~$50 | [Rand Group](https://www.randgroup.com/insights/microsoft/dynamics-365/customer-engagement/field-service/understanding-dynamics-365-field-service-pricing/) |
| Business Central **Essentials** | ~$80 | [ERP Software Blog](https://erpsoftwareblog.com/2026/07/business-central-pricing-and-licensing-guide/) |
| Business Central **Premium** | ~$110 | [ERP Software Blog](https://erpsoftwareblog.com/2026/07/business-central-pricing-and-licensing-guide/) |

## Implementation and ongoing cost

| Item | Cost | Source |
| --- | --- | --- |
| Implementation, 10–25 users | $25k–$45k | [MSDynamicsWorld](https://msdynamicsworld.com/blog-post/dynamics-365-business-central-implementation-cost-usa-2026-complete-guide) |
| First year all-in, ~20 users | $75k–$250k | same |
| Ongoing support | ~25% of implementation, per year | same |
| 50-user Dynamics FS, 3 years | ~$250k | [itqlick](https://www.itqlick.com/dynamics-365-for-field-service-formerly-fieldone/pricing) |
| 50-user Salesforce FS, 3 years | ~$280k | [itqlick](https://www.itqlick.com/dynamics-365-for-field-service-formerly-fieldone/pricing) |

## The number that matters for a service-and-parts business

A company that runs **both service and inventory/financials** needs **both products** — and
Business Central **Premium**, not Essentials, because Premium is the tier carrying Service
Management.

**$105 (Field Service) + $110 (BC Premium) = ~$215 per user per month.**

At 25 seats that is roughly **$64,500/year in licences alone**, before anyone implements
anything. Add $25–45k implementation and ~25% of that annually to keep it running:
**~$100k in year one, ~$65k+ every year after, indefinitely.**

## What this changes for us

**The licence is not what breaks a small business. Licence + implementation + an administrator
is.** A 25-person distributor will not hire a Dynamics admin, and an SI partner never raises
that in a pitch. That is the sharper version of "too expensive" and it is the one that is
actually true.

Note also that the "just enable the native Field Service ↔ Business Central integration"
counter (see [`microsoft-dynamics-field-service.md`](./microsoft-dynamics-field-service.md))
**requires holding both licences at the right tier** — which is precisely the cost above. The
capability objection and the pricing objection are the same objection.

## Caveats — read before quoting these in a room

- **These are partner blogs and aggregators, not vendor pricing pages.** Directionally reliable,
  not quotable as authoritative. Pull the primary Microsoft/Salesforce pricing page before use.
- **Totals move sharply with seat count.** A general argument becomes a specific one only once
  the prospect's actual seat count is known — worth asking.
- **List price is not street price.** Partners discount, and bundles change the arithmetic.

## Next research

1. Primary vendor pricing pages, to replace the aggregator citations above.
2. **Davisware / ECI pricing** — the vertical incumbent in commercial food equipment, and
   currently a complete blind spot.
3. Jobber / Housecall Pro pricing — the floor of the market, to bound the argument from below.

## ASSUMPTIONS (unsourced — verify before acting)

- That the prospect would need Premium rather than Essentials. Follows from them running
  service, but unconfirmed against their actual requirements.
- That no meaningful partner discount is available to a business this size.
