# AI Engineering Operating Model

**Status:** Version 1 — governance document (single owner concern: *how AI engineering agents deliver work* — outcome-based delivery, environment promotion, multi-agent coordination, and cost discipline).
**Related / defers to:**
- [`DelegationCharter.md`](../DelegationCharter.md) — the *authority* for what is delegated (Tiers) and §8 the default-autonomy rule. This document operationalizes §8; it does not restate the Tier definitions.
- [`ai/workflow.md`](../ai/workflow.md) — the per-change AI-SDLC lifecycle (assessment → review → implementation → merge). This document frames delivery at the *capability* level above that per-change flow.
- [`PlatformOperatingModel.md`](../PlatformOperatingModel.md) §7 Release Management — releases are capability-driven; [`PlatformCapabilityModel.md`](../PlatformCapabilityModel.md) — capability maturity. This document adopts that frame; it does not redefine capabilities.
- [`DeploymentModeStrategy.md`](../DeploymentModeStrategy.md) §8 Deployment Lifecycle — production/deployment specifics remain owned there.
- [`OWNERSHIP.md`](../OWNERSHIP.md) — ownership/IP posture the boundaries below reference.

Where this document conflicts with any of the above or with a governance document above the Delegation Charter, **the other document wins** (same deference rule as `PlatformOperatingModel.md` §6).

---

## 1. Outcome-based delivery

The unit of delivery is a **completed business capability**, not an individual commit, PR, story, section, or documentation update. The Owner reviews the **designed endpoint and integrated user experience** — not routine implementation mechanics. Commits and PRs remain the traceability record (kept small and logical), but "done" is measured at the capability, per §6 below.

## 2. Default autonomy

Repo-only, reversible implementation within an already-approved architecture is delegated (Delegation Charter Tier 1 + §8). Within that scope an AI agent autonomously: implements; tests; obtains independent review; corrects review findings; updates user and technical documentation; updates decision (`DECISIONS.md`) and execution records; opens and **merges** governed repo-only PRs under the exact-head guard; cleans branches and worktrees; proceeds to the next already-directed work item; and **reports at capability milestones, not after every PR**. See [`DelegationCharter.md`](../DelegationCharter.md) §8 for the standing rule and its do-not-stop list.

## 3. Question filter (before asking the Owner)

- **A.** Does existing governance, architecture, specification, decision history, or precedent already answer it? → **Yes:** follow it and continue.
- **B.** Is there only one reasonable governed implementation answer? → **Yes:** choose it, record it briefly, implement it, continue (Charter §8.4).
- **C.** Will the final product materially change based on the Owner's answer? → **No:** proceed without asking.
- **D.** Does the decision cross a protected boundary (§4)? → **Yes:** stop and ask.

## 4. Protected boundaries (Owner decision required)

The **authoritative enumeration is [`DelegationCharter.md`](../DelegationCharter.md) §8.3** (Tiers 2–3); consult it as the canonical list. In summary, stop and ask the Owner for any of: a material product or architecture choice with multiple valid directions; a security or authorization-model change; a `firestore.rules` or other protected-policy change; a capability grant/revocation/role or access-administration action; a production Functions or Hosting deployment; production live verification involving writes; a data migration or destructive cleanup; rollback execution; breaking an external contract or API; spending/billing/licensing/vendor commitment; a legal entity, IP-transfer, trademark, patent, or contractual decision (see [`OWNERSHIP.md`](../OWNERSHIP.md) §7); or an unresolved conflict between authoritative governance artifacts. The human operator still executes every production-credentialed command.

## 5. Long work windows

An AI agent continues until the earliest of: the assigned capability is complete; approximately one substantial engineering work window is complete; a true protected boundary is reached; or an unrecoverable blocker is found. Do not stop for routine implementation mechanics. This is a statement of **uninterrupted scope and milestone-sized delivery** — not literal wall-clock tracking, and not a promise of asynchronous/background work.

## 6. Capability completion standard

A capability is complete only when, as applicable, it is: implemented; tested; independently reviewed; review findings resolved; integrated; documented (user + technical); merged; governance records updated (`DECISIONS.md`, and any ownership map per [`architecture/SYSTEM_AUTHORITIES.md`](../architecture/SYSTEM_AUTHORITIES.md)); branches/worktrees cleaned; and known limitations and protected deferrals explicitly recorded.

## 7. Environment and promotion lifecycle

```
DESIGNED → SANDBOX BUILD → SANDBOX VERIFIED → INTEGRATION → RELEASE CANDIDATE
        → OWNER EXPERIENCE REVIEW → PRODUCTION AUTHORIZED → OPERATIONALLY VERIFIED → RETIRED
```

- **Sandbox** — isolated branches/worktrees; Firebase Emulator Suite; deterministic fixtures; synthetic users and IDs; **no production credentials; no production data writes**; experimentation and correction allowed; parallel AI-agent work encouraged.
- **Integration** — completed capability branches are combined; shared surfaces resolved; full lint/build/typecheck/tests + emulator workflow tests + architecture/authorization/governance checks run; **no new feature design** except correcting a verified integration defect.
- **Release candidate** — a stable integrated build with **no new scope**; the Owner evaluates the complete user experience; defects return to Sandbox; release evidence and a rollback plan are prepared.
- **Production** — one exact reviewed source revision; one authorized release scope; the **human operator executes credentialed actions**; pre-deploy baseline captured; rollback target recorded; post-deploy smoke and evidence completed. **Production is never the exploratory test environment.** Deployment mechanics/specifics remain owned by [`DeploymentModeStrategy.md`](../DeploymentModeStrategy.md) and the `docs/deployment/` runbooks.

> Naming note: the technical Sandbox is **not** renamed "Digital Twin." No Digital Twin semantics are defined in the architecture today; it may be a future capability, and this document does not overstate the current environment.

## 8. Multi-agent engineering model

Multiple approved AI agents may work concurrently in isolated sandboxes. Each **active assignment** is declared in [`ACTIVE_WORKSTREAMS.md`](ACTIVE_WORKSTREAMS.md) with: capability; agent/session identifier; role (builder, reviewer, integration, or release-preparation); branch; isolated worktree; base commit; owned paths; shared paths requested; dependencies; expected outcome; protected boundaries; current lifecycle stage.

Rules:

1. **One active writer per owned path.**
2. No two agents may **silently** edit the same reserved shared file.
3. A shared-file collision does **not** automatically stop an entire capability.
4. The agent completes all non-conflicting work and records the required **integration delta** in the registry.
5. An **Integration Agent** owns coordinated changes to high-collision files when practical.
6. A builder does **not** provide the sole independent approval for its own material change.
7. A reviewer uses **repository evidence**, not another agent's chat memory.
8. **Production promotion is serialized** even when Sandbox work is parallel.

(Each active assignment must also be **declared in the registry before an agent begins writing** — the enabling precondition for rules 1–2, stated in the paragraph above.)

Likely high-collision shared surfaces (coordinate via the registry / Integration Agent; the code-level ownership authority is [`architecture/SYSTEM_AUTHORITIES.md`](../architecture/SYSTEM_AUTHORITIES.md), not this list): `field-ops-app-vite/src/App.jsx`, `field-ops-app-vite/src/index.css`, `package.json`/lockfiles, `firestore.rules`, `firebase.json`, `functions/src/index.ts`, `docs/DECISIONS.md`, `docs/architecture/SYSTEM_AUTHORITIES.md`, and root governance files.

## 8a. Baseline and worktree discipline

§8 requires a **base commit** to be *declared*. This section requires it to be *verified*, and states what to do when the guard fails. (Complements [`../ai/claude-code.md`](../ai/claude-code.md)'s "fresh branch off updated `main`"; that line stands, this is the enforceable form.)

**Default baseline rule.** Every new capability or architecture program begins from the **latest verified `origin/main`**, unless it is explicitly continuing an existing governed branch/worktree.

**Pre-write guard.** Before writing, in order: `git fetch origin`; resolve and record the exact `origin/main` SHA; confirm the working tree is clean; confirm branch and base match the declared assignment in [`ACTIVE_WORKSTREAMS.md`](ACTIVE_WORKSTREAMS.md). **If any check fails, abort and create a fresh isolated worktree from the verified SHA** — do not repair an ambiguous checkout in place. Re-branching under this rule is routine Tier-1 work; do not ask the Owner whether to do it.

**Dirty trees are never disposable.** A dirty or stale checkout may hold another session's unmerged work. Before any cleanup: inventory untracked and modified paths; determine whether another session or worktree owns them; preserve anything uncertain. **Never** run a destructive `reset --hard`, `clean -fd`, or force-checkout against an unattributed tree. The correct response to an ambiguous checkout is to leave it untouched and work elsewhere; reconciling it is a separate, explicitly-scoped task.

**Read-only assessment worktrees** are permitted and encouraged for discovery, evidence comparison, and historical baseline review: pin one to an explicit SHA, never commit from it, record the pinned baseline where it is cited, and re-pin or remove it when its baseline goes stale. Creating and removing them is routine Tier-1 work needing no approval.

**Staleness is a first-class risk.** `origin/main` can advance mid-program. Re-verify the baseline before merging, and state the SHA any assessment was performed against — an assessment without a baseline SHA is not evidence.

## 9. Cost and token efficiency

The goal is **one authoritative strategic reasoning stream**, with implementation agents consuming only the context their bounded capability needs — not one literal token consumer. Practices:

- reason architecture and decisions **once** and persist them (repo, not chat);
- read authoritative artifacts **before** asking;
- do **not** repeat broad repository discovery when a current program map exists — use targeted file/diff review after the initial map;
- avoid exhaustive historical PR review unless formally required;
- do **not** route the same change through multiple redundant reviewers; choose **review depth by risk**, reserving the highest-cost architecture review for material decisions;
- use capability agents for implementation and focused reviewers for changed surfaces;
- **report deltas**, not re-summaries of established history.

## 10. Status

Version 1, adopted 2026-08-06 as a Tier-1 repo-only governance capability. See `docs/DECISIONS.md`. This document is subject to the same "verify, don't assume" discipline as every governance document (`CLAUDE_CONTEXT.md`).
