# Wave 7 — Sandbox deployment manifest

**Purpose:** the running ledger of work **merged to `main` but not yet deployed to the
`platform-sandbox` environment** for the Wave 7 execution package (Parts / Work Orders /
Sales Orders / Serialized Assets).

**This artifact does not deploy anything.** It records what a *pooled* sandbox deployment
would have to promote, so that one consolidated, authorized deployment can replace a stream
of per-PR deployments. Adding a row here changes no infrastructure.

**Scope:** supersedes nothing. The Wave 6 package is already deployed and is *not* tracked
here. This manifest starts empty at the Wave 6 deployed baseline and accumulates forward.

## Baseline

| Field | Value |
| --- | --- |
| Deployed sandbox baseline (Wave 6) | `23fd569209c946c3025bb6812185167f1b432964` (`#998`) |
| Environment | `platform-sandbox` → Firebase project `eos-platform-sandbox` |
| Environment registry (authoritative) | [`config/environments.json`](../../config/environments.json) |
| Deployed-vs-expected check | `node scripts/checkDeployedVersions.mjs` |

`config/environments.json` remains the **single source of truth** for environment identity,
readiness flags, and capability activation. This manifest references it; it never duplicates it.

## Status vocabulary

Rows use the promotion lifecycle established in
[`docs/engineering/AI_ENGINEERING_OPERATING_MODEL.md`](../engineering/AI_ENGINEERING_OPERATING_MODEL.md) §8
and mirrored in [`ACTIVE_WORKSTREAMS.md`](../engineering/ACTIVE_WORKSTREAMS.md):

`DESIGNED` → `SANDBOX BUILD` → `SANDBOX VERIFIED` → `INTEGRATION` → `RELEASE CANDIDATE` →
`OWNER REVIEW` → `PRODUCTION AUTHORIZED` → `OPERATIONALLY VERIFIED` → `RETIRED`

A merged PR that has not been deployed to sandbox is `SANDBOX BUILD`. It only becomes
`SANDBOX VERIFIED` after the pooled deployment **and** the recorded validation actually runs.

**Merged is not deployed. Deployed is not verified.**

## Pending sandbox merges

*(none yet — Wave 7 has not merged its first PR)*

<!-- Row template — copy per merged PR:

### PR #NNN — <capability / workstream>

| Field | Value |
| --- | --- |
| Merge SHA | `<full sha>` |
| Lifecycle stage | SANDBOX BUILD |
| Functions impact | <new/changed callables, or NONE> |
| Hosting impact | <frontend rebuild required?, or NONE> |
| Rules impact | <firestore.rules change + whether deploy is runtime-required, or NONE> |
| Indexes / config impact | <firestore.indexes.json, config/environments.json, or NONE> |
| Readiness flags required | <FLAG_NAME=true for platform-sandbox, or NONE> |
| Capability activation / grants | <capability ids needing activation override + Role grants, or NONE> |
| Smoke / E2E validation required | <what must be exercised post-deploy to reach SANDBOX VERIFIED> |
| Rollback notes | <what reverting costs; any one-way steps> |
| Deployment status | PENDING |

-->

## Consolidated deploy requirements

Filled in as rows accumulate; this is the checklist a single authorized deployment executes.

| Area | Required |
| --- | --- |
| Functions | *(pending)* |
| Hosting | *(pending)* |
| Rules | *(pending)* |
| Indexes / config | *(pending)* |
| Capabilities / grants | *(pending)* |
| Readiness flags | *(pending)* |
| Seed / migration steps | *(pending)* |
| Smoke tests | *(pending)* |
| E2E tests | *(pending)* |

## Boundaries

- **No production deployment** is in scope for this manifest under any circumstance.
- A **Firestore Rules deployment is a protected boundary** (Tier 2,
  [`docs/DelegationCharter.md`](../DelegationCharter.md)) and is not authorized by the
  existence of a row here. Rules changes may be *prepared and tested* in a PR; deploying
  them requires separate authorization. See the `verify-rules-deploy` skill.
- The **pooled sandbox deployment itself** is a separate authorization. Rows accumulate
  until that authorization is given.
