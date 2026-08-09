# Continuous Workstream Backlog & Orchestrator — Taylor / EOS adapter

**Status: design + repo-safe foundation (Tier-1 governance doc).** This is the **Taylor/EOS adapter** for a
reusable corporate methodology whose durable home is **Project Keystone →
`frameworks/continuous-workstream-orchestration/`** (contribution flagged in §9; authored here in liftable
form, following the precedent of [`../quality/agent-orchestration-adapter.md`](../quality/agent-orchestration-adapter.md)
which references `frameworks/agent-quality-system/`). The framework owns the *portable* state machine,
selection algorithm, checkpoint policy, and tool-permission tiering **principle**; this adapter owns the
*Taylor-specific* backlog instance, stop conditions, model policy, and concrete permission allow-list.

This document does **not** create any capability, grant, collection, or Rule. It is process governance.

---

## 1. The actual observed failure (scope discipline)

Repeated real execution evidence establishes **one** precise gap — and only one is in scope:

> A worker can autonomously **assess → implement → test → remediate → PR → merge → report** within a single
> invocation. But after it reports "next item starting now" and **returns control, no next invocation
> actually starts.** Prompt text saying "continue automatically" does not fix this, because the model has
> already yielded the turn.

This is a **continuation-trigger** gap, not a state-tracking gap. Two things are therefore needed, and they
are deliberately separated so we do not over-build:

| Concern | Status today | This design adds |
|---|---|---|
| **A. Durable "what's next" state** — an explicit backlog with per-item *schedulability* states and a deterministic *next-eligible* selection rule | Partially present as prose ([`ACTIVE_WORKSTREAMS.md`](../engineering/ACTIVE_WORKSTREAMS.md) "Ready for assignment" + the [roadmap register](../roadmaps/business-capability-register.md)) but with no explicit schedulability states and no encoded selection rule | A repo-native **Execution Backlog** ([`execution-backlog.md`](./execution-backlog.md)) + the state machine and selection rule in §3–§4 |
| **B. The continuation trigger** — the thing that *starts the next invocation* after a worker yields | **Does not exist as a repo artifact.** It is a *runtime/harness* capability, not a document | §5 assesses the real options and **returns a material decision to the Owner** (execution-authority / unattended-spend choice) |

Everything in Concern A is repo-safe and authority-clear, so it is built now. Concern B is a genuine
Owner-control decision (see §5) and is **returned with a recommendation**, not unilaterally activated.

## 2. Reuse map — what already exists (do not rebuild)

The minimum mechanism is mostly *composition* of existing infrastructure:

| Existing artifact | Role in the orchestrator | Reused as-is? |
|---|---|---|
| [`docs/roadmaps/business-capability-register.md`](../roadmaps/business-capability-register.md) | **Roadmap** — the durable memory of future capabilities and their `IDENTIFIED→…→DELIVERED` maturity + **Roadmap trigger** field | Yes — the backlog's upstream source |
| [`docs/engineering/ACTIVE_WORKSTREAMS.md`](../engineering/ACTIVE_WORKSTREAMS.md) | **Active-assignment coordination** ("who is writing where, right now") + "Ready for assignment" + "Recently completed" + lifecycle stage | Yes — the backlog *references* it; the orchestrator declares each RUNNING item here per Operating Model §8 |
| [`docs/engineering/AI_ENGINEERING_OPERATING_MODEL.md`](../engineering/AI_ENGINEERING_OPERATING_MODEL.md) §1a, §2, §4, §5, §8 | **Autonomy + stop rules** — evidence-based sequencing, default autonomy, protected boundaries, long work windows, multi-agent model | Yes — the orchestrator *executes* these rules; it does not restate them |
| [`docs/DelegationCharter.md`](../DelegationCharter.md) §8 / §8.3 | **Execution authority** — Tier 1/2/3 + the canonical protected-boundary enumeration | Yes — maps directly to the `PROTECTED_ACTION` / `OWNER_DECISION` states |
| [`docs/quality/agent-orchestration-adapter.md`](../quality/agent-orchestration-adapter.md) §G Run Control Board | **Live agent-run presentation** (session-local) + model policy (OPUS primary / SONNET delegated) | Yes — the orchestrator's per-run readout; the checkpoint (§6) is its *durable* sibling |
| `.claude/settings.json` `permissions.allow` | **Tool-permission policy** — what routine Bash is pre-authorized | Extended (§7), not replaced |
| Harness primitives: `/loop` (dynamic), `ScheduleWakeup`, `CronCreate`, `Workflow` | **Candidate continuation drivers** | Assessed in §5 |

**Nothing here requires** a new database, event bus, scheduler service, queue, dashboard, BPM engine, or
agent runtime. That prohibition is inherited verbatim from the quality adapter's §F and restated in §8.

## 3. Work-item state machine (portable — belongs in Keystone)

A backlog item carries exactly one **schedulability state**. These are distinct from ACTIVE_WORKSTREAMS
*lifecycle stages* (`DESIGNED→SANDBOX BUILD→…→RETIRED`), which describe *delivery maturity*; a single item
has both (e.g. lifecycle `SANDBOX VERIFIED` + schedulability `PROTECTED_ACTION`).

| State | Meaning | Orchestrator behavior |
|---|---|---|
| `READY` | Repo-safe, authority-clear, dependencies met, not UX-owned-only, no open material decision | **Eligible for selection now** |
| `RUNNING` | A worker currently owns it (declared in ACTIVE_WORKSTREAMS) | Let it finish; do not double-assign (§8 rule 1) |
| `BLOCKED_DEPENDENCY` | Waits on another item / evidence / sandbox that is not yet satisfied | **Skip; select another `READY`.** Promote to `READY` when the blocker reaches `DONE` |
| `OWNER_DECISION` | Needs a material business-semantics / canonical-architecture / policy decision | Do **not** invent an answer. Surface at the next checkpoint; keep working other `READY` items |
| `PROTECTED_ACTION` | Repo-complete but the next step crosses a protected boundary (grant / deploy / Rules deploy / prod / destructive) — Charter §8.3 | Wait for an **authorized operator**. Not an ordinary Owner gate; a *credentialed* one |
| `TOOL_PERMISSION_BLOCKED` | Work is legitimate and safe but a *tool/Bash approval* is blocking the mechanics | **Not a product decision.** Resolve via the permission policy (§7); if unresolved, note it and move on |
| `SAFE_CHECKPOINT` | Context/token pressure or a natural break — work is *not* done | **Not an Owner gate.** Persist state to the backlog and resume through a fresh worker/context |
| `BUDGET_LIMIT` | A declared token/cost cap for the window has been reached | Stop new work; emit a checkpoint; wait for Owner to extend the budget |
| `DONE` | Capability-complete per Operating Model §6 (built, tested, reviewed, merged, docs, records, cleanup) | Remove from active set; re-evaluate dependents for promotion; **select next eligible** |
| `ROADMAP_COMPLETE` | No `READY` item exists and none can be promoted — the roadmap is exhausted for now | Emit a terminal checkpoint; stop |

**Transitions.** `READY → RUNNING → { DONE │ BLOCKED_DEPENDENCY │ OWNER_DECISION │ PROTECTED_ACTION │
TOOL_PERMISSION_BLOCKED │ SAFE_CHECKPOINT │ BUDGET_LIMIT }`. `BLOCKED_DEPENDENCY → READY` when its blocker is
`DONE`. `SAFE_CHECKPOINT → RUNNING` on resume. `DONE` may promote dependents. Only `OWNER_DECISION`,
`PROTECTED_ACTION`, `BUDGET_LIMIT`, and `ROADMAP_COMPLETE` are genuine **stops**; the rest keep the
workstream moving.

## 4. Next-eligible selection rule (deterministic — portable)

The rule that makes "after DONE, do the next thing" unambiguous:

1. If an item is `RUNNING` and owned by the current worker → **continue it** (no new selection).
2. Else choose the **highest-priority `READY`** item. Priority order (first non-tie wins):
   a. Owner-pinned priority (explicit ordering in the backlog), then
   b. **Unblocks the most downstream items** (a dependency others wait on), then
   c. Lowest cost-to-value (smallest reversible increment that advances a roadmap capability), then
   d. Declared backlog order (seed order; ties resolved top-down).
3. If **no `READY`** item exists:
   a. Re-evaluate `BLOCKED_DEPENDENCY`: any whose blocker is now `DONE` → promote to `READY`, go to (2).
   b. Else emit an **Owner checkpoint** (§6) enumerating the `OWNER_DECISION` / `PROTECTED_ACTION` /
      `BUDGET_LIMIT` items that remain, and stop. This is a *genuine* gate, reached only when nothing is
      independently actionable.
4. `SAFE_CHECKPOINT` and `TOOL_PERMISSION_BLOCKED` never terminate the workstream — they route to resume
   (§5) and to the permission policy (§7) respectively.
5. If every roadmap-linked item is `DONE` and none can be promoted → `ROADMAP_COMPLETE`.

The rule is intentionally executable-by-a-human-worker from the backlog table alone — **no engine required**.
A tiny pure validator may be added later *iff* a pilot shows ambiguity; per §8 we do not build it speculatively.

## 5. The continuation trigger — MATERIAL OWNER DECISION (returned with recommendation)

This is the crux of the observed failure and the one place with **materially different, legitimately-Owner
choices about execution authority and unattended spend.** Per Operating Model §4 and the Owner's own
return-triggers, it is surfaced rather than chosen unilaterally.

| Option | Mechanism | Solves "auto-start next"? | Acts while Owner is away? | Unattended token spend | Risk |
|---|---|---|---|---|---|
| **A. In-session loop** | `/loop` dynamic mode: while a session is open, the loop reads the backlog, runs the top `READY` item to `DONE`, then **`ScheduleWakeup` fires the next invocation** — pausing only at genuine gates | **Yes**, whenever a session is live | No | Only while Owner has a session open | Low |
| **B. Self-scheduled wakeup / cron** | `ScheduleWakeup` / `CronCreate` re-invokes on a timer **even with no session open**, up to a hard budget cap, checkpointing on cadence | Yes, including unattended | **Yes** | Yes — spends tokens with no human present | Higher (autonomy + cost) |
| **C. Repo-state only, human-triggered** | Backlog + selection rule in repo; each fresh invocation (Owner opens a session / says "go") resumes deterministically. No auto-trigger | No (only the *deterministic-resume* half) | No | None | Lowest, but does not close the gap |

**Recommendation — a hybrid defaulting to A:** adopt the **durable backlog + deterministic resume (C is
subsumed)** *now* — which is exactly this PR — and use **Option A (`/loop` + `ScheduleWakeup`)** as the
default driver so any live session self-continues through gates. Keep **Option B behind an explicit Owner
opt-in** with (i) a hard per-window `BUDGET_LIMIT`, (ii) a mandatory checkpoint cadence (§6), and (iii) the
same protected-boundary hard stops. This closes the observed gap for the common case (Owner-in-session)
immediately, while reserving unattended self-invocation — the genuinely Owner-reserved escalation — for an
explicit toggle.

**Decision requested of the Owner:** enable **B (unattended self-scheduling)** now with a stated budget cap
and cadence, or keep **A (in-session continuation)** as the operating default? The backlog, state machine,
and selection rule in this PR are correct under either choice.

## 6. Owner visibility without Owner gating (checkpoint policy)

The autonomous system returns **compact checkpoints** that inform without stopping — a checkpoint halts
execution *only* if it contains a genuine gate (`OWNER_DECISION` / `PROTECTED_ACTION` / `BUDGET_LIMIT`).

**Checkpoint triggers** (any one): an elapsed work window (≈ one substantial engineering window, Operating
Model §5); several completed increments (default ≥ 3 `DONE`); a major domain transition; context/token
pressure (`SAFE_CHECKPOINT`); a significant finding; or reaching a protected boundary.

**Checkpoint content** (fixed shape — this document's own closing report is the first instance):

```
CONTINUOUS WORKSTREAM CHECKPOINT
  Window / trigger:        <what caused this checkpoint>
  Work completed:          <capabilities brought to DONE>
  Merged PRs / evidence:   <#PRs, CI state, SHAs>
  Material decisions made: <under EXISTING authority — §1a/§2>
  Agents used:             <agentId × model × count; retries; loops terminated>
  Blocked dependencies:    <BLOCKED_DEPENDENCY items + their blocker>
  Protected actions:       <PROTECTED_ACTION items awaiting authorized operator>
  Owner decisions needed:  <OWNER_DECISION items — the only thing that gates>
  Next automatic work:     <the top READY item the worker resumes>
  Context / budget health: <SAFE_CHECKPOINT? tokens vs cap?>
```

Goal, verbatim: **Owner visibility without Owner approval on every increment.** A report is not a gate
(Operating Model §2; Delegation Charter §8).

## 7. Tool-permission problem (distinct from Owner/Protected decisions)

**Symptom:** this EOS VS Code session repeatedly prompts the Owner to approve *routine, safe* Bash (e.g.
`git status`, `npm test`, `node --test`), which other Claude environments do not. That is
`TOOL_PERMISSION_BLOCKED` — an execution-mechanics concern, **not** a product or protected decision, and it
must be solved **without** globally allowing unrestricted Bash.

**Two-class policy** (portable principle; concrete list is Taylor-specific):

- **VERIFICATION class → pre-authorize** (additive `permissions.allow`). Read-only / evidence commands that
  cannot mutate production, credentials, access policy, or the working tree in a non-recoverable way:
  `git status|log|diff|show|fetch|ls-tree|merge-base|rev-parse|branch --show-current|worktree list`,
  `npm run build|test|lint|typecheck`, `node --test *`, `gh pr view|checks|list|diff`. These are exactly the
  commands generating the friction.
- **PROTECTED class → keep prompting (and hard-`deny` the sharp edges).** Never pre-authorized:
  `firebase deploy` / any deploy, credential access, production writes/verification, destructive ops
  (`rm -rf`, `git push --force`, `git reset --hard`, history rewrite), access/Rules widening, `gh secret`.
  A `permissions.deny` block should hard-stop these even if a broad allow is ever introduced.

**Proposed `.claude/settings.json` change (VERIFICATION allow-list additions + a PROTECTED deny block)** — a
governance/security change, so **it is NOT in this docs-only PR; it is returned for Owner ratification** (see
closing checkpoint). It never adds `Bash(*)`; it enumerates safe verbs and hard-denies the dangerous ones.

## 8. Anti-over-engineering boundary (what this deliberately does NOT build)

Per the Owner's explicit constraint and the quality adapter's §F: **no** orchestration database, event bus,
distributed scheduler, agent dashboard, token-billing engine, or generic BPM/workflow engine. The mechanism
is: a **repo-native backlog table** + a **documented state machine & selection rule** + **existing harness
primitives** for the trigger + the **existing checkpoint/Run-Control-Board** presentation. Executable
tooling (a selector validator, a backlog linter) is added only when a pilot demonstrates a concrete need —
registry-first, not infrastructure-first (Operating Model §1a; framework §12).

## 9. Corporate reuse split (Keystone vs Taylor)

- **Project Keystone `frameworks/continuous-workstream-orchestration/` (reusable, provider-independent):**
  the §3 state machine, §4 selection rule, §6 checkpoint-trigger policy, §7 tool-permission *tiering
  principle*, and the §5 continuation-**driver contract** (a driver MUST: read backlog → select next
  eligible → invoke worker → classify result into a state → update backlog → re-trigger or checkpoint). **No
  Taylor business assumptions.** *(This repo cannot push to Keystone; the contribution is authored here in
  liftable form and flagged as a follow-up, mirroring how the quality adapter references its framework.)*
- **Taylor_Parts `docs/orchestration/` (adapter + instance):** the seeded [`execution-backlog.md`](./execution-backlog.md);
  Taylor stop conditions (Finance/Coverage protected activation, deferred #12/#13, R-1 read authority,
  UX-owned surfaces); the concrete §7 allow-list; and the OPUS-primary / SONNET-delegated model policy from
  [`../quality/model-tier-config.md`](../quality/model-tier-config.md).

## 10. Status

Design + repo-safe foundation adopted as a Tier-1 repo-only governance capability. The backlog, state
machine, selection rule, checkpoint policy, and anti-over-engineering boundary are in force now. The
continuation-trigger activation (§5) and the tool-permission settings change (§7) are **returned for Owner
decision** and are the only two items here that are not self-adopted.
