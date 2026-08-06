---
artifact_type: design
gate: R-2 — GitHub Pages production-path remediation (target state + migration/rollback)
status: Design complete — awaiting Owner authorization before any workflow, Hosting, Pages, or DNS change
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: c002b5ee0834998207f7966be40bbd718cbd0e28 (verified origin/main)
authority: docs/engineering/AI_ENGINEERING_OPERATING_MODEL.md §7 · docs/DelegationCharter.md §8.3/§8.7
scope: Design only. NO workflow, Hosting, Pages, DNS, or deployment change performed.
---

# R-2 — Frontend Production Promotion: Target State

Owner-approved for architecture and design 2026-08-06. **The current Pages workflow must not be altered, disabled, deployed, or replaced yet.** This document defines target state, implementation boundaries, and migration/rollback strategy so the protected change can be authorized on evidence.

---

## 1. Problem statement (established, not asserted)

`.github/workflows/deploy-field-ops.yml` triggers on `push: branches: [main]` and publishes the built client to GitHub Pages. The published artifact is a **production client**:

- `field-ops-app-vite/src/firebase/firebase.js` hardcodes `projectId: "taylor-parts"`, the production `authDomain`, and `getFunctions(app, "us-central1")`. There is no build-time environment injection; the workflow passes no `VITE_*` variables and consumes no secrets.
- The emulator branch is gated on `import.meta.env.DEV` and is therefore unreachable in a production build.
- `src/config/env.js` blocks writes only under `?env=demo` or the console panic switch; the default is **writes enabled**.

**Consequence:** merging to `main` is, today, a production release. No release candidate, no Owner experience review, no explicit production authorization. This contradicts the promotion lifecycle (`AI_ENGINEERING_OPERATING_MODEL.md` §7) and the Owner reservation on production releases (`DelegationCharter.md` §8.3/§8.7) — and it undermines the premise that repo-only merges are reversible and unreleased, which the default-autonomy model depends on.

## 2. Target state

```
SANDBOX  →  INTEGRATION  →  RELEASE CANDIDATE  →  OWNER EXPERIENCE REVIEW
         →  EXPLICIT PRODUCTION AUTHORIZATION  →  PRODUCTION  →  OPERATIONAL VERIFICATION
```

**Binding invariant: no merge-to-`main` action may silently constitute production promotion.**

Target mapping of surfaces to lifecycle stages:

| Stage | Surface | Trigger | Authority |
|---|---|---|---|
| INTEGRATION | CI build/lint/typecheck/test on `main` | automatic on merge | agent |
| RELEASE CANDIDATE | a **non-production** preview build, pinned to an exact SHA, pointed at a **non-production Firebase project** | automatic on merge, or on demand | agent |
| OWNER EXPERIENCE REVIEW | the same RC artifact, reviewed by the Owner | manual | Owner |
| PRODUCTION AUTHORIZATION | explicit, naming the exact reviewed SHA | manual | Owner |
| PRODUCTION | Firebase Hosting release of that exact artifact | manual | human operator |
| OPERATIONAL VERIFICATION | post-release smoke + evidence capture | manual | human operator |

**Firebase Hosting becomes the sole production frontend surface.** It is already the governed, evidenced, Owner-authorized path (release pins under `docs/audits/inv-convergence-e-c2-hosting-deploy/`). This design does not invent a promotion mechanism; it removes the ungoverned second path and routes everything through the one that already works.

## 3. The decision that must be made first

**What becomes of the GitHub Pages surface?** Three viable options; all are protected changes.

| Option | Description | Consequence |
|---|---|---|
| **A — Retire Pages** | Stop publishing; Hosting is the only frontend. | Simplest and safest. **Breaks any bookmark or link to the Pages URL.** Requires knowing whether anyone uses it — this is unknown **U-1**. |
| **B — Demote Pages to a non-production preview** | Pages keeps auto-deploying but builds against a **non-production** Firebase project, and is labeled as a preview. | Preserves the URL and gains a genuine RC surface. **Requires a second Firebase project** — a spend/vendor decision (Tier 3) and real configuration work the platform does not currently have (there is no build-time environment injection; see §4). |
| **C — Gate Pages behind authorization** | Change the trigger from `push: main` to `workflow_dispatch` / release tag. | Smallest diff, immediately restores the invariant. Pages stays production-pointed, so the URL keeps working and nothing breaks — but the platform still has no RC surface. |

**Recommendation: C first, then B.** Rationale under evidence-based sequencing (Operating Model §1a): C closes an *active production risk* (priority 1) with a one-line trigger change, no new infrastructure, no spend, and no dependency on U-1. B delivers *operational reliability* (priority 3) but requires a second Firebase project — a Tier-3 spend decision — and is better sequenced with C3 Operational Readiness, where the environment topology is decided coherently rather than piecemeal. A is only correct if U-1 shows nobody uses the Pages URL, and it is strictly worse than C until that is known.

**This recommendation is not self-authorizing.** Selecting among A/B/C is an Owner decision; C's implementation is a protected change to a production release path.

## 4. Implementation boundaries

What Option C touches, and nothing more:

- **In scope:** the `on:` trigger of `.github/workflows/deploy-field-ops.yml`; a documented manual-dispatch procedure; `docs/Deployment.md` updated in the same change.
- **Out of scope:** the build itself, `firebase.js`, `config/env.js`, Firebase Hosting configuration, DNS, the Firestore project, Rules, Functions, and every application behaviour. The published artifact does not change — only *when* publishing happens.

Additional boundaries that apply to **B** if it is later chosen, and which are the real reason B is not first:

- The client has **no build-time environment injection**. Making the build target-aware requires introducing `VITE_*` configuration and refactoring `firebase.js` away from hardcoded values — a genuine change to the application's configuration architecture, which overlaps the **Configuration** Tier-2 ADR already on the roadmap. B should not pre-empt that ADR with a one-off.
- A second Firebase project is a spend/vendor commitment — **Tier 3, Owner only**.

## 5. Migration strategy (Option C)

1. **Establish U-1** — determine whether the Pages URL is in real use, and by whom, before changing its behaviour. Read-only; bundled in [`../operations/eao-readonly-evidence-package.md`](../operations/eao-readonly-evidence-package.md).
2. **Confirm Hosting currency** — verify the live Hosting release corresponds to current `main` (U-2). If Hosting is behind, deploy Hosting to parity *under existing authorization* **before** gating Pages, so no surface regresses.
3. **Owner authorization** naming the exact commit implementing the trigger change.
4. **Apply the trigger change** on a normal governed PR. Merging it is itself the last merge that auto-publishes.
5. **Verify** the workflow no longer runs on push, and that a manual dispatch still produces an identical artifact.
6. **Record** in `DECISIONS.md` and update `docs/Deployment.md` in the same PR.

**Sequencing constraint:** step 2 must precede step 4. Gating Pages while Hosting is behind current `main` would leave the only ungated surface frozen at a stale build and the gated surface stale too — a worse position than today.

## 6. Rollback strategy

**Rollback of the change itself is trivial and complete:** revert the workflow trigger to `push: branches: [main]`. The workflow's build and publish steps are untouched, so reverting restores the exact prior behaviour with no data, configuration, or infrastructure implication. There is no schema, no migration, and no state.

**Rollback of a bad frontend release (the durable capability this creates):** Firebase Hosting retains prior releases; rollback is a Hosting release rollback to a prior pinned version, following the existing evidenced pattern. **This capability is one of the reasons to make the change** — today, rolling back the Pages surface requires reverting `main` and waiting for a rebuild, which is slower and couples the release path to repository history.

**Rollback trigger conditions:** the Pages URL turns out to be in active use and manual dispatch proves insufficient (i.e. U-1 was answered wrong); or Hosting cannot be kept at parity.

## 7. Residual risk after Option C

Option C restores the *authorization* invariant but not the *environment* invariant: production remains the only place the integrated frontend can be exercised, because no non-production frontend environment exists. `AI_ENGINEERING_OPERATING_MODEL.md` §7 states production is never the exploratory test environment — with C alone, that holds by discipline rather than by construction. **Option B, sequenced with C3 Operational Readiness and the Configuration ADR, is what closes it.** This residual risk is recorded, not hidden.

## 8. Boundaries honored

No workflow, Hosting, Pages, DNS, Firebase, or deployment change was made. No production command executed. This document is a design and a recommendation; it authorizes nothing.
