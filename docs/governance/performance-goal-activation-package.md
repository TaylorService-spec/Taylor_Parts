# Performance Goal Authority — activation package

**Status:** PREPARED, NOT EXECUTED. Every command below is written out so it can be run without
re-deriving it, and **none of them has been run**. Recorded 2026-09-02 alongside Decision #160.

**Why it stops here.** Each step crosses a boundary this session does not cross on its own
authority: a `firestore.rules` edit is Tier-2, and a Functions/Rules deploy is executed by the human
operator against a live environment. The repository work is complete and merged-ready; what remains
is execution.

**Production is not in this document.** No step below touches `taylor-parts`. The five
`performance.goal.*` capabilities are registered `active:false`, and production resolves its
activation override set to EMPTY unconditionally regardless of registry data — so even a deployed
callable denies for every principal there until a separate, explicit Owner decision that has not
been asked for.

---

## What is already true, with no action

- The five capabilities are **registered** and `active:false`.
- Role grants are in the repository (Decision #160's table). **A grant is not a runtime assignment**
  — no `roleAssignment` document has been written for anyone.
- `performance_goals` is **already denied to every client**, in every environment, with no Rules
  change: `firestore.rules` has no match block for it, and a collection no rule matches is denied.
  This is the posture `crm_activities` already relies on.
- Sandbox activation is **declared** in all three registries that must agree
  (`config/environments.json`, `functions/src/access/environmentCapabilityOverrides.ts`, and
  `scripts/resolveEnvironment.mjs`, which the frontend bakes into its bundle). Declaring is not
  deploying.

---

## Step 1 — the explicit deny-all Rules block (OPTIONAL, Tier-2)

**This changes no behaviour.** The collection is already denied by rule absence. The block exists
only so a reader of `firestore.rules` finds the collection where they look for it, matching how
every other Admin-SDK-only collection is documented there.

It is presented as optional precisely because it is behaviourally inert: a Rules edit forces a
deploy-and-verify cycle, and spending one on a no-op is a decision, not an obligation.

Apply to **both** copies — they are verified byte-identical by the regression runner, which refuses
to start on a mismatch:

- `firestore.rules`
- `field-ops-app-vite/firestore.rules`

Insert beside the other Admin-SDK-only blocks, before the closing braces:

```
    // Performance Goal Authority (Decision #160) -- versioned, effective-dated, approved TARGETS.
    // Admin-SDK-only, same fail-closed posture as the collections above. ALL direct client
    // read/write denied; the only paths are the trusted commands in
    // functions/src/performance/performanceGoalCommands.ts and the bounded read in
    // performanceGoalReadService.ts. A goal holds a TARGET and never an ACTUAL. Deployment is a
    // separate operator gate; merging this block changes nothing -- the collection is already
    // denied by rule ABSENCE, and this states it where a reader looks for it.
    match /performance_goals/{goalId} {
      allow read, write: if false;
    }
```

Then, from the repository root:

```bash
node functions/scripts/rulesRegressionRunner.mjs
```

and deploy per the `verify-rules-deploy` checklist — including the step that is the whole point of
that checklist: fetch the LIVE rules afterwards and confirm they match the committed source. An exit
code is not evidence that rules are live.

---

## Step 2 — deploy the six callables to sandbox

```bash
cd functions && npm run build
firebase deploy --only functions:createPerformanceGoalDraft,functions:approvePerformanceGoal,functions:retirePerformanceGoal,functions:listCurrentPerformanceGoals,functions:listPerformanceGoalVersions,functions:listGoalSubjects --project eos-platform-sandbox
```

**Named individually, not as `--only functions`.** A large batch deploy against this project
transiently fails a subset without failing the command, and the resulting "deployed" claim is then
wrong in a way nothing catches. Verify afterwards rather than trusting the exit code:

```bash
node scripts/verifySandboxFunctions.mjs
```

**Deploying the read callables also lights up the dashboard's goal tiles.** Until this step runs,
`listCurrentPerformanceGoals` is unreachable and every goal tile renders "Targets could not be read
just now" — which is correct, and is exactly what the surface does today.

---

## Step 3 — deploy the activation registry

The sandbox override set is compiled into the Functions bundle, so Step 2 carries it. Nothing
separate to run. Confirm it took effect by observing that a principal holding a goal Role stops
resolving `inactivePermission` — **not** by reading the config file, which is the input rather than
the evidence.

---

## Step 4 — grant the Roles (Owner decision, then execution)

No principal holds any goal capability until a `roleAssignment` is written. The Roles carrying them
are in Decision #160. Two grants are needed for the sandbox story to be exercisable end to end,
because **the author of a goal may never approve it**:

| Persona | Role to assign | Scope |
|---|---|---|
| a manager who AUTHORS | `fieldManager` / `salesManager` / `partsManager` / `operationsManager` | `{ type: "global" }`, plus `{ type: "location", value: <warehouseId> }` for a location goal |
| a DIFFERENT manager who APPROVES | any Role above, held by another principal | as above |
| every person who should SEE their target | `performanceGoalSubject` | `{ type: "global" }` — it is a read grant; hierarchy narrows what it reaches |

A location-scoped goal requires the manager's assignment to actually cover that warehouse. That is
the Owner's "a Parts Manager for wh-north may not modify a goal for a location outside their
governed location authority", enforced by the existing value match — so granting a manager `global`
when they should be `location:wh-north` widens them silently. Grant the narrower one.

**Grants run through `grantRole` (`functions/src/access/trustedWriterCommands.ts`)**, not by writing
`roleAssignments` directly. Note that `performanceGoalSubject` is registered in that command's
governed-assignable allowlist — a Role the writer cannot name is a Role nobody can hold.

---

## Step 5 — seed the operating story

Once Steps 2 and 4 are done:

```bash
cd functions && npm run build
node scripts/seedSandboxPerformanceStory.mjs --projectId eos-platform-sandbox --dry-run
node scripts/seedSandboxPerformanceStory.mjs --projectId eos-platform-sandbox
```

The seeder refuses `taylor-parts` and any environment whose declared role is `production`, at three
points. It creates goals **through the governed commands**, so if Step 4 was skipped or granted to
one principal only, the seeder fails on authority — which is the check working, not a defect.

---

## What is NOT in this package, and why

- **Any production activation.** Not asked for, not prepared, and deliberately not written down as a
  command anyone could run by adjusting a flag.
- **A `finance.visibility.*` grant.** Fourteen dashboard fact families and three goal metrics are
  blocked behind it, and it is the census's Owner decision 1 — a governance decision about who may
  see the company's money, not a step in a goal rollout.
- **Activating any metric the registry marks inactive.** Each names a blocker that is a definition
  or an authority, and neither is unblocked by deploying anything.
