# Development Standards

Working conventions for this repo, established across Sprints 2–3.3. See `PROJECT_ARCHITECTURE.md` for the system design these standards protect, and `CLAUDE_CONTEXT.md`'s "Product Authorities" section for the product documents new features are expected to satisfy.

## Feature Lifecycle

New features are expected to move through the following stages, front to back:

```
Business Need
     ↓
Product Review        (does this fit ProductVision.md / PlatformConstitution.md / ProductBlueprint.md?)
     ↓
Blueprint              (where does this fit in ProductBlueprint.md's domain/navigation model?)
     ↓
Architecture Review    (how does this fit PROJECT_ARCHITECTURE.md / SYSTEM_AUTHORITIES.md?)
     ↓
Implementation
     ↓
Testing
     ↓
Release
```

A feature that skips the Product Review/Blueprint stages risks conflicting with the platform's product governance after the fact (fragmented navigation, a competing business-domain model, a hardcoded assumption the Configurable Platform principle disallows) — see `PROJECT_ARCHITECTURE.md`'s "Relationship to Product Governance" section for how the Product and Architecture stages relate.

## Branching

- One branch per sprint/feature, always cut from an up-to-date `main` (`git checkout main && git pull && git checkout -b <branch>`), never stacked on another unmerged feature branch.
- Naming: `sprint-<N>.<M>-<short-description>` (e.g. `sprint-3.3-signal-schema`).
- After a PR merges: delete the branch (GitHub usually auto-deletes the remote copy on merge; `git fetch --prune` cleans up stale local remote-tracking refs), then branch the next sprint fresh from `main`.
- A merged/frozen sprint branch gets no further commits. If more work is needed after freeze, it goes on a new branch.

## Commits

- Prefer several small, focused commits over one large one when a sprint has logically distinct steps (see Sprint 3.3's six-commit structure: schema → dispatch scoring → risk scoring → panel split → styling → guardrails). Each commit should build and lint clean on its own.
- Commit message: imperative summary line, blank line, body explaining *why* (not just what), ending with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```
- Never amend a pushed/published commit. Amending an unpushed commit to consolidate a same-session tweak is fine.

## Verification, every commit

Run before committing, not just at the end of a sprint:
```
cd field-ops-app-vite
npm run build
npm run lint
```
Both must be clean (the only expected warning is a pre-existing, unrelated `react(only-export-components)` warning in `AuthContext.jsx`).

For anything touching Control Tower or the domain layer, also grep for accidental Firestore writes before committing:
```
grep -rn "addDoc\|setDoc\|updateDoc\|runTransaction\|writeBatch\|deleteDoc" <changed files>
```
Zero matches expected outside `domain/jobActions.js`.

## PR discipline

- One PR per sprint branch, targeting `main`.
- PR description states: what changed, what was verified (build/lint/no-writes), and an explicit test plan checklist.
- **Never assume PR/branch state — always verify it.** Before recommending a merge order, rebase, or "what's next," run the actual checks:
  ```
  git fetch origin main
  gh pr view <N> --json state,mergedAt,mergeable,mergeStateStatus,statusCheckRollup
  git log origin/main --oneline
  ```
  Prior conversation turns describing an intended action ("I would merge PR #4") are not evidence it happened.
- Merging requires CI green and `mergeStateStatus: CLEAN`. This repo does not currently gate merges on human review approval — don't assume it does.

## Domain layer rules

- All Firestore writes to jobs/technicians go through `domain/jobActions.js`'s `assignJob()`/`updateJobStatus()`. Any new write path is a violation, full stop — flag it, don't add it.
- Scoring/derivation modules (`domain/*Scoring.js`) are pure functions: no Firestore imports, no mutation of input arrays/objects, no side effects (`console.*`, `localStorage`, etc.). The only allowed non-determinism is an overridable `now = Date.now()` default for time-based calculations.
- Every scoring module that feeds a Control Tower panel returns the canonical Signal shape from `domain/controlTower/types.js` (`{ id, score, severity, label, metadata }`). Don't invent a new ad-hoc return shape.

## UI layer rules

- Control Tower panels (`modules/controlTower/panels/*.jsx`) receive only `{ jobs, technicians, workOrders }` as props. No panel fetches Firestore (`useFirestoreCollection` or `firebase/*` imports are forbidden inside `panels/`). No panel inlines scoring logic — call the domain layer and render its output.
- Dev-only guards (`assertPanelProps`, `assertValidSignal` in `domain/controlTower/types.js`) exist to catch contract violations early; extend this pattern for new panels rather than skipping it.

## Documenting approximations

Where a signal is derived from incomplete data (e.g. `createdAt`-only timestamps standing in for real lifecycle timestamps), say so explicitly in code comments *and* in the UI (e.g. an "(approx.)" label) — don't let an approximation read as precise operational fact to an end user or a future maintainer.
