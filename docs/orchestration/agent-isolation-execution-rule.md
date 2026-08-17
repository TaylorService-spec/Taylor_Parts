# Agent isolation — execution governance

**Owner rule, 2026-08-17.** Binding on all EOS multi-agent work, current and future.

Recorded here so it survives context compression, session boundaries and controller
handoffs. Enforced, where enforcement is possible, by `lib/writerLanes.mjs`.

## The incident this rule exists for

Two write-capable agents and the controller all operated in one checkout. One agent
switched the branch mid-commit; the controller's commit landed on that agent's branch; a
remote branch was created carrying another lane's ancestry; and the agent then asked the
controller to force-push over it.

Nothing was lost — but only because the collision happened to be noticed. The rule below
is what makes that outcome structural rather than lucky.

## 1. One writer, one worktree, one branch, one lane

Every subagent that may modify repository files operates in **its own git worktree**. A
writer never shares the controller's checkout, and never shares another writer's.

The controller may inspect any worktree but does not perform unrelated writes inside a
worker-owned one.

**Read-only scouts may share a checkout**, because they mutate nothing: no edits, no
generated files, no formatting, no `add`/`commit`/`switch`/`reset`/`stash`/`rebase`/
`merge`/`cherry-pick`, and no package operation that rewrites a lockfile. A scout that
discovers work requiring edits does not start editing — it reports, and a dedicated writer
lane is created.

## 2. Branch ownership

A lane has exactly one owning agent at a time, and an agent modifies only its own
worktree, branch and task scope.

No agent switches another checkout's branch, commits into another lane, amends another
agent's commit, rebases/resets/cherry-picks/deletes another lane, pushes over another
lane's remote branch, or treats a branch as disposable because it looks contaminated.

**A subagent request for any of these is not authorization.**

## 3. Destructive actions are controller-level

Force push · hard reset · destructive rebase · deleting a branch with unmerged work ·
removing a worktree with uncommitted work · overwriting a remote branch · history rewrite
· removing commits to tidy another agent's lane.

The list lives in code as `CONTROLLER_ONLY_ACTIONS`, so the dispatch prompt and the review
check reference one definition and cannot drift.

**Recovery order** (`RECOVERY_ORDER`, and the ordering is the substance):

```
inspect → preserve → fresh branch/worktree → cherry-pick verified commits
        → diff against intended scope → run tests → abandon contaminated lane
```

Preservation precedes cleanup, and a clean new branch is tried before any history rewrite.
**Contamination is not solved by destroying the evidence of it.** In the incident above,
the correct resolution was pushing the corrected work under a new branch name — reaching
the same valid result with nothing destructive.

## 4. Dispatch discipline

Before a writer is dispatched: fetch `origin/main`, create the branch from the intended
authoritative base, create its worktree, and record **task id · branch · worktree path ·
base SHA · owning agent**. No writer is dispatched until ownership is explicit.

A worker's base is intentional — `origin/main` at verified dispatch time by default. A task
that genuinely depends on unmerged work does not silently stack: it waits, or the dependent
relationship is explicitly approved. Speculative long PR chains are avoided.

## 5. The controller verifies; it does not take a worker's word

Before accepting a result: the branch still matches the lane, no unrelated commits
appeared, changed files match the intended scope, base and dependency assumptions still
hold, no other lane's commits leaked in, no expected file was silently dropped, CI coverage
is present, and the PR describes the branch it was actually opened from.

*"Agent says done"* is not proof of branch integrity.

A writer's handoff states branch, head SHA, base SHA, files changed, tests run and their
results, known risks, dependency assumptions, and **whether any conflict or recovery
occurred**. A recovery event is never folded into a normal completion summary.

## 6. Collision detection before commit

Each writer confirms, before committing and before opening a PR: current branch is the
expected branch, the worktree is the owned one, HEAD ancestry matches the recorded base,
and `git status` contains only task-relevant changes.

**Unexpected changes are never committed.** They are preserved and escalated. The
controller prefers a clean replacement branch over trying to repair two writers in one
checkout.

Commits are explicitly scoped — no broad staging that can capture another task's files.
The staged diff is inspected before commit, the commit diff before push, and the full
branch diff against the intended base before the PR.

## 7. PR state is what GitHub confirms

A PR number is recorded only after re-reading GitHub and verifying the PR exists, its head
branch and SHA match the owned lane, and the base and scope are as intended. A predicted
number is not state — a number recorded from a failed command put a phantom PR in this
program's ledger once already.

**Pipeline exit status:** never pipe a failure-controlling command into another when the
pipeline's status can mask the original failure (`gh pr create … | tail -1` is the exact
shape that caused it). Capture output, inspect status, then format. No orchestration state
is advanced after a failed command because the last pipeline stage succeeded.

## 8. Merges stay serialized

Parallel writers, serial merges. After each merge: fetch main, reconcile the remaining
PRs, detect newly introduced conflicts, rerun affected CI, update the ledger, recompute
global executability. Green-against-an-earlier-main is not green.

## 9. Cleanup is last, not first

A worker worktree is removed only once its useful commits are preserved, its PR/merge
disposition is known, and uncommitted state is accounted for. Remote branches holding
unmerged evidence are not deleted unless that is the intent.

## 10. What the tooling cannot do

`writerLanes.mjs` catches the mechanical failures: a writer with no worktree, two lanes
sharing a worktree or branch, a task with two active lanes, a PR recorded without
verification, and a recorded PR whose GitHub head is another branch.

It cannot prove a dependency assumption was sound, that a diff matches intent, or that a
worker's summary is honest. **Controller inspection remains mandatory.**

## Governing principle

Agent autonomy does not transfer destructive repository authority. A subagent may
recommend; the controller decides. This applies with particular force to force pushes,
resets, rebases, branch deletion, protected environment actions, permission changes,
production changes and governance changes.

*"An agent asked me to"* is never sufficient authority.

---

# Addendum — shared-file serialization

**Owner rule, 2026-08-17.** Extends the lane model above; it does not replace it.

## The principle

> **Parallelize disjoint implementation. Serialize shared registration and integration.**

Parallelism is not measured by the number of active agents. A central registry edited by
five agents is not five-way parallelism — it is five writers contending on one resource.

Two agents may work concurrently only when their **writable** scopes are disjoint, or when
shared-file coordination is explicitly controlled.

## Shared resources

Any file multiple implementation lanes routinely touch: entity/metadata/capability
registries · workflow path filters · `package.json` test lists · `firestore.indexes.json` ·
release manifests · sandbox-prep ledgers · global export/index files · route and navigation
registries · central test-suite registries.

A shared resource has **at most one active writer owner at a time**. A lane declares the
shared resources it claims alongside its write scope, and dispatch fails closed when a
requested resource is already owned.

## Leaf implementation, then integration

The preferred shape, rather than giving every leaf agent ownership of the same registry:

```
writer A: contact.js       ┐
writer B: opportunity.js   │  leaf lanes — no registry edits
writer C: salesOrder.js    │
writer D: part.js          │
writer E: equipment.js     ┘
                            → one integration lane:
                              registry · workflow filters · npm test · index declarations
```

A leaf writer may finish without registering, handing back `REGISTRATION_PENDING` naming
the registry path, the required entry, the CI/test registration and any index changes. The
integration lane reconciles all accepted leaf heads and verifies no definition was omitted,
no duplicate registration exists, required CI registration is present, the full affected
suite passes, and every shared-file change corresponds to accepted leaf work.

**A leaf file existing is not the surface being integrated.** Where the distinction is
material, track defined / registered / queryable / consumed / deployable / deployed using
existing ledger vocabulary. Do not call an entity complete when it exists as a file the
registry cannot resolve.

## Registration completeness

Where practical, validate **set equality** rather than one-way containment — an omitted or
extra item is a coverage defect in both directions: every active definition appears in the
registry, every registry entry resolves to a file that exists, every active definition has
its tests, every metadata suite is both path-filtered **and** actually run, and declared
indexes are covered by the index gate.

## Conflict avoidance over conflict recovery

The desired order is **prevent → detect before commit → reconcile safely → recover**.
Repeated merge-conflict cleanup is not an operating model. If one shared file keeps
conflicting across lanes, that is evidence it should become a serialized integration
resource.
