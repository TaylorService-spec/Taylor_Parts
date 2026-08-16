# Domain knowledge register

**What this is:** durable, sourced knowledge about how field-service and CRM software actually
works and is actually sold. Written by the
[`field-service-domain-researcher`](../../../.claude/agents/field-service-domain-researcher.md)
agent, read by the next run before it searches anything.

**Why it exists:** an agent has no memory between runs. Without somewhere to put what it
learns, every run re-researches the same ground at full cost and teaches nothing. This register
*is* the learning — knowledge accumulates here, and each run starts from it rather than from
zero.

It also means the Owner and ChatGPT read the same sourced facts, per
[`docs/ai/ai-state-contract.md`](../../ai/ai-state-contract.md). Nothing here is private
recall; every claim is checkable.

## The rule

**NO SOURCE, NO FINDING.** Every claim carries a URL and a quote or specific reference. A claim
that cannot be sourced is recall, not knowledge, and model recall is what this project has
learned not to trust. Confident-but-unsourced belongs under **`ASSUMPTION`**, labelled as such.

## Entry format

Each topic file uses this shape:

```markdown
# <Product or topic>

**Last researched:** YYYY-MM-DD · **By:** field-service-domain-researcher

## Capability claims (what the vendor says it does)
| Claim | Source | Notes |

## Lived experience (what users say after buying)
| Theme | Frequency | Source | Notes |

## Positioning (how they sell, and what they pre-empt)
- what they claim · what they pre-empt · what they omit

## Barriers (licence tier, pricing, configuration cost)

## What this changes for us
- build / claim / stop-doing implications

## ASSUMPTIONS (unsourced, do not act on without verifying)
```

## The distinction to preserve in every entry

**"Exists" is not "works." "Works" is not "affordable." "Affordable" is not "adopted."**
Four different facts. Collapsing them produces conclusions that fail the moment a real buyer
pushes back.

## Index

| Topic | File | Last researched |
| --- | --- | --- |
| Microsoft Dynamics 365 Field Service + Business Central | [`microsoft-dynamics-field-service.md`](./microsoft-dynamics-field-service.md) | 2026-08-16 |
| Competitor pricing (Salesforce / Dynamics / Business Central) | [`competitor-pricing.md`](./competitor-pricing.md) | 2026-08-16 |

## Scope note

Everything here comes from **public sources** — vendor documentation, training curricula,
marketing and comparison pages, public forums, review sites. It contains no customer data and
no confidential information, which is why it can live in this repository.

Taylor's own operational weaknesses are **not** recorded here. Those live in
`project-keystone` (private).
