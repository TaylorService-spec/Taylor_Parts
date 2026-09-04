# Customer 1 — Day-1 Training Matrix and Training-Close Evidence Index

**Gate:** `C1-TRAINING-01` (OPEN, launch-critical)
**Authority for the close rule:** `docs/training/README.md` — this document operates that rule and does not restate or reinterpret it.
**Maintained by:** Verenward product training (Lane F)
**Last derived:** 2026-09-04

## What this document is

One place that answers, for every Day-1 role and workflow: **does current training exist, and against
what deployed revision was it verified?**

It is a coverage ledger, not an acceptance record. Taylor acceptance of training is Taylor's to
record and appears nowhere in this file.

## Provisional-scope warning — read before using this as a completeness measure

The role families below are taken from the **stable guide families** listed in
`docs/training/README.md`. They are *not* a Taylor-confirmed Day-1 role roster.

`C1-SCOPE-01` (Day-1 scope and exclusions) is OPEN with no evidence, so no accepted Day-1
role/workflow set exists yet. Until it does:

- a row marked COVERED means **that guide is current**, not that the role is fully trained;
- **absence of a row is not evidence that a role is out of Day-1 scope**;
- the workflow column is populated only where a guide already establishes the workflow. Empty means
  *not yet enumerated*, never *none*.

This matrix therefore cannot be used to argue `C1-TRAINING-01` is close to closing. It exists so the
remaining distance is visible instead of assumed.

## Status vocabulary

| Status | Meaning |
|---|---|
| `COMPLETE_LIVE_VERIFIED` | A guide exists and was verified against a named deployed revision by exercising the deployed behavior. |
| `DRAFT_PENDING_DEPLOYMENT` | A guide exists and is accurate against merged code, but the behavior is not deployed anywhere it can be verified. Not current training. |
| `MISSING` | No guide exists for this role family. |
| `NOT_APPLICABLE_VERIFIED` | A verified finding that this role family needs no Day-1 training. Requires a recorded reason, per `docs/training/README.md`. |

`DRAFT_PENDING_DEPLOYMENT` and `MISSING` both leave the gate open. They are distinguished because
they need different work: a draft needs a deployment to verify against; a missing guide needs
writing.

## Role coverage matrix

| Role family | Workflow(s) covered | Guide | Status | Represents | Verification method |
|---|---|---|---|---|---|
| Every user (cross-role) | Reading My Dashboard; technician profile screen | `docs/training/MY_DASHBOARD.md` | `COMPLETE_LIVE_VERIFIED` | `platform-sandbox` live commit `50792fef` | Exercised against the running deployed screen; Owner accepted 2026-09-03 |
| Taylor EOS Administrator | — | — | `MISSING` | — | — |
| General Manager / Operations Manager | — | — | `MISSING` | — | — |
| Dispatcher | — | — | `MISSING` | — | — |
| Technician | Recording parts used on a Work Order | `docs/training/TECHNICIAN_RECORDING_PART_USAGE.md` | `DRAFT_PENDING_DEPLOYMENT` | merged Decisions #168 + #171 — not deployed | Nine end-to-end emulator proofs of the callable; **no deployed environment exercised** |
| Parts Associate | — | — | `MISSING` | — | — |
| Parts Manager | — | — | `MISSING` | — | — |
| Warehouse Manager / Warehouse user | — | — | `MISSING` | — | — |
| Salesperson | — | — | `MISSING` | — | — |
| Sales Manager | — | — | `MISSING` | — | — |
| Purchasing / Receiving | Record Purchase Order (price + currency entry) | `docs/training/PURCHASING_RECORD_PURCHASE_ORDER.md` | `DRAFT_PENDING_DEPLOYMENT` | merged `b19a7486` — not deployed | None in a deployed environment; sandbox is at `5eaa403a`, which predates the change |
| Accounting / Finance | — | — | `MISSING` | — | — |

## Training-close evidence index

Every guide, the revision its training represents, and how that was verified. A guide that cannot
name its verification basis is not COMPLETE.

| Guide | Deployed revision represented | Verification method | Status |
|---|---|---|---|
| `docs/training/MY_DASHBOARD.md` | `50792fef` (deployed to `platform-sandbox`) | Exercised against the running screen; Owner accepted 2026-09-03 | `COMPLETE_LIVE_VERIFIED` |
| `docs/training/TECHNICIAN_RECORDING_PART_USAGE.md` | none — merged code only | Emulator proofs of the callable; guide states plainly it is written against undeployed behavior | `DRAFT_PENDING_DEPLOYMENT` |
| `docs/training/PURCHASING_RECORD_PURCHASE_ORDER.md` | none — merged code only | None; guide states plainly it is written against undeployed behavior | `DRAFT_PENDING_DEPLOYMENT` |

`docs/training/README.md` and `docs/training/USER_GUIDE_TEMPLATE.md` are excluded: the first is the
close-rule authority and the second is a template. Neither is user training.

## What blocks progress, and what does not

**Blocked on a deployment (`BLOCKED_EXTERNAL`).** The two draft guides cannot become
`COMPLETE_LIVE_VERIFIED` by any writing work. They need the merged behavior deployed somewhere it can
be exercised. Rewriting them would not move the gate.

**Blocked on Taylor (`BLOCKED_TAYLOR`).** Whether the eleven role families above are the Day-1 roles,
and which workflows each must cover, is not Verenward's to decide.

**Not blocked.** Guides for already-deployed, already-accepted behavior can be written now against
the live sandbox revision — that is how `MY_DASHBOARD.md` reached COMPLETE.

## Keeping this file honest

`docs/customer-1/training/verify-training-index.mjs` checks this document against the guides it
names: that every referenced guide exists, and that nothing is claimed `COMPLETE_LIVE_VERIFIED` here
unless the guide itself carries a live-verification receipt. The same check validates every record in
`docs/customer-1/training/DEPLOYMENT_TRAINING_CLOSE_LOG.md`, the register where a deployment records
the training receipt that lets it reach `CLOSED`. Run it with `node` after any change to this matrix,
a guide's status, or the close log.
