# EOS User Training — Deployment Close Gate

**Class: RELEASE-CLOSE AUTHORITY FOR USER TRAINING.**

No customer-facing EOS deployment is considered `CLOSED` until the applicable user training documentation has been created or updated and verified against the deployed behavior.

This is a permanent release rule, not a Customer 1-only cleanup task.

## Deployment states

A release may be:

- `BUILT`
- `TESTED`
- `ACCEPTED`
- `DEPLOYED`
- `VERIFIED`
- `CLOSED`

`DEPLOYED` and `CLOSED` are intentionally different states.

A deployment may reach `DEPLOYED` before training is complete. It may not reach `CLOSED` until one of these receipts exists:

- `TRAINING: COMPLETE`
- `TRAINING: NOT REQUIRED — VERIFIED NO USER IMPACT`

## Required training-impact record

Every deployment close record must identify:

- affected user role(s);
- affected workflow(s);
- training guide(s) created or updated;
- deployed version/SHA represented by the training;
- effective date;
- material workflow changes;
- new user actions or responsibilities;
- changed permissions/access behavior when relevant;
- exceptions, warnings, or known limitations;
- support/escalation path where relevant;
- verification that instructions and screenshots describe the deployed application rather than a planned or superseded design.

## Training depth

### No user-impacting change

Backend-only, governance-only, security-only, documentation-only, or other work with no user-visible/procedural effect may close with:

`TRAINING: NOT REQUIRED — VERIFIED NO USER IMPACT`

The reason must be recorded. The absence of a training update may not be assumed from a commit label alone.

### Minor user change

Update the existing role/workflow guide and identify the affected section.

### Material workflow change

Update the complete workflow guide for the affected users. A patch note alone is not sufficient when the normal procedure changed.

### New workflow or role

Create the applicable initial training guide before deployment close.

## Role-based information architecture

Training should be organized primarily around what a Taylor employee must do, not around internal feature/package names.

Expected stable guide families include, as applicable:

- Taylor EOS Administrator
- General Manager / Operations Manager
- Dispatcher
- Technician
- Parts Associate
- Parts Manager
- Warehouse Manager / Warehouse user
- Salesperson
- Sales Manager
- Purchasing / Receiving
- Accounting / Finance

A role guide may link to shared workflow modules when reuse is truthful, but an employee should not need to reconstruct their job from a collection of engineering release notes.

## Day-1 Customer 1 gate

Before Taylor production dependency is authorized:

1. every Day-1 role/workflow has current training;
2. the training matches the exact production behavior intended for cutover;
3. designated Taylor EOS administrators have administrator training;
4. Taylor knows the official support/escalation path;
5. training ownership after initial handoff is explicit.

Taylor should ultimately be capable of ordinary new-hire operational training from maintained EOS materials without requiring the founder to personally teach every user.

## Training ownership

Verenward owns the accuracy of official EOS product/workflow training for the supported release.

Taylor owns ordinary internal scheduling, attendance, and ongoing employee onboarding after the agreed initial handoff, unless separately contracted.

## Closure record example

```text
DEPLOYMENT: <release / SHA>
AFFECTED ROLES: Dispatcher, Technician
AFFECTED WORKFLOWS: Reassign, reschedule, technician job acceptance
TRAINING GUIDES: docs/training/dispatcher.md; docs/training/technician.md
TRAINING REPRESENTS: <deployed SHA>
TRAINING: COMPLETE
VERIFIED: <date / evidence>
DEPLOYMENT STATE: CLOSED
```

For no-impact work:

```text
DEPLOYMENT: <release / SHA>
USER IMPACT: NONE
REASON: governed backend refactor; no user-visible or procedural change
TRAINING: NOT REQUIRED — VERIFIED NO USER IMPACT
DEPLOYMENT STATE: CLOSED
```

## Anti-drift rule

Training that describes a future design, sandbox-only behavior, superseded workflow, unavailable permission, or undeployed function is a defect in the release evidence. Fix the training or keep the deployment open; do not teach users functionality they do not actually have.
