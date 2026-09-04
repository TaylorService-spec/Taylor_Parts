# Deployment Training-Close Log

**Authority for the rule:** `docs/training/README.md`. This file operates that rule; it does not
restate or reinterpret it.
**Checked by:** `docs/customer-1/training/verify-training-index.mjs`
**Maintained by:** Verenward product training (Lane F)

## What this file is

The register where a deployment records the training receipt that lets it reach `CLOSED`.

Until this file existed, the close rule was stated but had nowhere to land: a deployment could be
called closed in prose with no record anyone could check. A deployment is `CLOSED` when — and only
when — a record for it appears below and the checker passes.

This is not an acceptance record. Taylor acceptance of training is Taylor's and appears nowhere in
this file.

## Record format

One fenced `text` block per deployment, exactly as specified in `docs/training/README.md`. Two forms
are valid, and no others.

**User-impacting deployment:**

```text
DEPLOYMENT: <release / SHA>
AFFECTED ROLES: <role, role>
AFFECTED WORKFLOWS: <workflow, workflow>
TRAINING GUIDES: <docs/training/…md; docs/training/…md>
TRAINING REPRESENTS: <deployed SHA>
TRAINING: COMPLETE
VERIFIED: <date / evidence — how the deployed behavior was exercised>
DEPLOYMENT STATE: CLOSED
```

**Verified no user impact:**

```text
DEPLOYMENT: <release / SHA>
USER IMPACT: NONE
REASON: <why no user-visible or procedural change — not a commit label>
TRAINING: NOT REQUIRED — VERIFIED NO USER IMPACT
DEPLOYMENT STATE: CLOSED
```

Every line is required. The checker rejects a record missing any of them, a `TRAINING:` receipt that
is not one of the two exact strings above, and a `TRAINING GUIDES:` path that does not exist.

## How a deployment gets closed

1. The deployment reaches `DEPLOYED` and is verifiable in the environment it was deployed to.
2. Training for every affected role/workflow is created or updated **and verified against that
   deployed behavior** — or a no-user-impact finding is verified, with its reason.
3. The record is appended below, and `node docs/customer-1/training/verify-training-index.mjs`
   passes.

A record may not be written ahead of step 2. "Probably no user impact" is not a finding, and a guide
written against merged code that nobody has exercised in a deployed environment does not support
`TRAINING: COMPLETE` — see the `DRAFT_PENDING_DEPLOYMENT` rows in
`docs/customer-1/training/DAY_1_TRAINING_MATRIX.md`.

## Closed deployments

None. No deployment has yet been closed under this rule.

The absence of records is not evidence that nothing has been deployed. It means no deployment has
been *closed*: the register starts here, and deployments that predate it were never issued a
training receipt. `docs/training/MY_DASHBOARD.md` is live-verified against `platform-sandbox` commit
`50792fef`, which is guide-level training completion for one screen — it is not a deployment close
record, and it is not written as one here.

New records are appended to this section, newest last.
