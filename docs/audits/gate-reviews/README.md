# Gate Review Audit Framework

This directory is the durable audit record for the Enterprise Operations OS repository review.

## Required sequence

Each gate follows this sequence and may not advance out of order:

1. Gate review
2. Gate decision
3. QA review of the completed gate
4. Recommendations and disposition
5. Owner approval
6. Next gate

## Gate outcomes

Gate decisions use one of:

- PASS
- PASS WITH CONDITIONS
- HOLD

QA decisions use one of:

- QA CONFIRMED
- QA CONFIRMED WITH RECOMMENDATIONS
- QA REOPENS GATE
- QA HOLD

## Recommendation disposition

Every recommendation is classified as:

- Required before next gate
- Recommended soon
- Future project
- No action

## Folder standard

Each gate receives its own folder:

```text
gate-XX-short-name/
  01-gate-review.md
  02-qa-review.md
  03-recommendations.md
  04-owner-approval.md
```

A gate is not complete until `04-owner-approval.md` records the Owner's decision. Pending files must remain visibly marked `PENDING`; they must not be treated as approval or completion.

## Review operating rule

Reviews should inspect only the artifacts necessary for the current gate. This keeps the process evidence-based, sequential, and token-efficient. No implementation, issue creation, deployment, merge, or progression to the next gate is authorized merely because a review or recommendation exists.
