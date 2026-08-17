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

## 9a. Push before handoff

A lane's output is durable only once **pushed**. An isolated worktree lives with the
session that created it, so a writer that finishes without pushing has produced nothing
recoverable — the isolation held, and the work simply did not exist anywhere.

This is §9's principle at the other end of the lane. Cleanup waits until commits are
preserved; dispatch must equally require that they *become* preserved. Push-before-handoff
belongs in the dispatch contract, not in the writer's discretion.

An unpushed lane is **lost, not resumable**. Re-dispatch it clean rather than trying to
reconstruct it, and tell the replacement explicitly to push.

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

---

# Addendum — leaf ownership vs integration

**Owner rule, 2026-08-17.** Governs what the single integration lane may and may not do
when it consumes accepted leaf work.

> **Leaf lanes own meaning. Integration lanes own convergence.**

## The split

A leaf writer owns the **semantic correctness** of its artifact — the entity's fields,
identity, relationships, classes, types, authorities and queryability claims. The
integration lane does **not** become the semantic owner merely because it holds the
registry, workflow and index files open.

Ownership does not drift to whoever happens to have the shared files checked out.

## What the integrator may change

Mechanical convergence only: add an accepted entity to the registry · register an accepted
test in a workflow · add a missing `working-directory` · add a path filter · add npm test
registration · translate an already-declared index demand into a shared declaration · sort
entries · resolve an append-only conflict without dropping any · normalize syntax the
shared file requires.

**Every mechanical change preserves the accepted leaf meaning exactly.**

## What the integrator may never change

Field type · `fieldClass` · `systemName` · label semantics · identity/name/reference choice
· enum vocabulary · numeric or percentage-storage semantics · mutability · provenance
meaning · read/write authority · `sourceAuthority` · relationship cardinality or direction ·
derivation type · queryability class · business-reference policy · storage meaning.

**A shared-file conflict does not authorize semantic reinterpretation.**

## When integration exposes a semantic defect

Record the finding, identify the owning leaf, open a focused correction lane in its own
worktree, preserve integration state, and continue integrating other independent leaves.

**Do not turn the integration lane into a hidden semantic repair branch.** Only the
affected lane reopens; accepted work elsewhere is never rebuilt.

A narrow exception exists for a clerical error whose intent is already unambiguous from
repo evidence, requires no business judgement, crosses no protected boundary, changes no
product meaning, and is recorded in the integration summary with a test pinning the intent.
A misspelled import path is mechanical. **Changing `NUMBER` to `CURRENCY` is not.** When
uncertain, route it back.

## Index cost is a product signal, not an integration problem

The leaf declares filter and sort demand; the integrator derives the composite
declarations, reconciles duplicates and checks Firestore spelling and shape.

The integrator must **not** decide *"this filter is too expensive, remove it"*. Index
explosion usually exposes a product or architecture question, and that routes back to the
semantic lane or the controller.

## Verification is two-directional

After integration: every accepted active leaf **is** registered, and every registry entry
resolves to a real accepted definition. Reject orphan definitions, entries pointing at
missing files, duplicate systemNames or entity registrations, stale deleted definitions,
and registration of a leaf still marked unaccepted.

Prefer **set equality** where both sides should match — an omitted or an extra item is a
defect in both directions.

Conflict resolution on shared registration files is never wholesale *ours*/*theirs*:
enumerate pre-existing entries, enumerate accepted new entries, produce the union
deliberately, then assert nothing pre-existing was dropped and nothing accepted was omitted.
**The resolver validates the outcome, not merely that the file parses.**

## Tests prove the accepted state, not the edit

- Not *"registry.js changed"* — but *"the accepted systemNames resolve through the registry"*.
- Not *"the workflow mentions the path"* — but *"both suites are path-filtered **and** executed with correct working directories"*.
- Not *"the indexes file parses"* — but *"every filter combination the accepted definitions demand is covered"*.

## Status honesty

A leaf file existing is not platform integration, and a changed registry file is not
completed registration. Where the distinction is material, distinguish leaf-implemented,
registration-pending, integrated and consumed — using existing ledger vocabulary rather
than inventing states.

## Adjacent defects

Find, record, continue owned scope — never silently expand the branch. The
`SalesOrderActions` id-as-label finding is the model: discovered by the header lane,
recorded as its own item, and deliberately left untouched because it sat outside that
lane's declared scope.

## Legacy provenance is not an integration concern

If leaf work reveals epoch timestamps, missing actor fields, client-claim provenance or
unknown mutability, those are recorded as semantic and migration findings owned by focused
lanes. The integration lane does **not** "standardize" legacy storage because Field
Architecture v2 defines a target state. `systemName` vs `storagePath` exists precisely so
integration never requires rewriting legacy storage shape.
