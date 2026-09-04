# Lane E — Commercial / Legal / Support

**Priority 50. Branch prefix `customer1/e-`.**

## Mandate

Convert platform and support scope into a commercial structure, a support
operating model, and draft agreements — all of which stop one step short of any
decision. This lane drafts; humans decide.

## Gates owned

- `C1-COMM-01` — Commercial model (OPEN, launch-critical)
- `C1-CONTRACT-01` — Executed customer agreements (OPEN, launch-critical)
- `C1-SUPPORT-01` — Support and escalation model (OPEN, launch-critical)

## Owned paths

```
docs/customer-1/commercial/**
docs/customer-1/support/**
```

## May

- Draft the commercial structure: implementation, subscription, support,
  founding-customer treatment, change requests, billable custom work.
- Build pricing **decision worksheets** — inputs, cost drivers, options,
  trade-offs, and the question the Owner must answer. Not a price.
- Draft the support model: intake, severity definitions, escalation, hours and
  expectations, the bug-vs-enhancement boundary, and third-party IT
  responsibility.
- Draft contract, SOW, data/confidentiality, and support artifacts as clearly
  marked **DRAFT — NOT LEGAL ADVICE, NOT EXECUTED**.
- Maintain the unresolved decision register.

## Must not

- Make a final pricing choice.
- Bind Verenward or Taylor contractually.
- Make a legal judgment or present drafting as legal advice.
- Sign or approve anything.
- Assume founder labor is free. The readiness ledger names that as a red line:
  subscription economics that depend on it are not sustainable, and a worksheet
  that hides it is not a worksheet.

## Seeded objectives

1. Cost model: what it actually costs to run and support one Taylor-sized
   customer, including labor, with the assumptions stated.
2. Pricing decision worksheet per revenue line, ending in a named Owner
   question.
3. Support operating model with severity definitions tied to real Day-1
   workflows rather than generic P1/P2 language.
4. Draft agreement set, each with an explicit open-issues list.
5. The unresolved decision register: every commercial and legal question this
   lane could not answer, and who must answer it.

## Blocker triggers

Nearly everything terminal in this lane is a blocker by design. Record
`BLOCKED_OWNER` for pricing and commercial posture, `BLOCKED_TAYLOR` for
customer expectations and responsibility boundaries, and `BLOCKED_EXTERNAL`
for anything requiring counsel.

The lane stays productive by drafting around open decisions rather than waiting
on them.

## Proofs

Documentation consistency: every draft names its status, its open issues, and
its decision owner. A draft with no open-issues list is incomplete.
