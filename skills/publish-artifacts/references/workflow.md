# publish-artifacts — detailed workflow

## Why this exists

The git remote is the only shared context layer between separate agents and
sessions. A session's local working copy and any in-session notes are private:
another reviewer sees a document only after it lands on a remote branch. This
skill moves named documents onto a NEW branch **cleanly, explicitly, and
reversibly**, isolated from a dirty working tree, and stops before merge.

## Step 1 — Confirm the exact paths and base

- Get the exact artifact paths to publish. The caller usually names them; if asked
  to "publish the review/spec", auto-detect untracked/modified files under
  `docs/reviews/`, `docs/specifications/`, `docs/assessments/`,
  `docs/implementation-plans/`, then confirm the list explicitly. Do not publish
  more than asked.
- Record the base commit. Publish from `origin/main` unless told otherwise; pass
  `--base <ref>` to override. The script uses `git rev-parse <base>` at execute
  time and reports the resolved Base SHA.
- Verify each file exists and is complete (non-empty, first line, last line). The
  script fails closed if a named path is missing. Never recreate a file from
  memory — if a named file isn't in the working copy, stop and report where it is.

## Step 2 — Build and review the plan (dry-run)

The planning core is pure and deterministic. Run it with no `--execute` flag to
see exactly what will happen without touching git:

```
node skills/publish-artifacts/scripts/publish-artifacts.mjs \
  --topic "issue 100 spec" \
  docs/specifications/issue-100-spec.md \
  docs/reviews/issue-100-review.md
```

The dry-run prints:
- `branch` — e.g. `docs/issue-100-spec-artifacts` (derived from `--topic`, or from
  the first path's basename if no topic given)
- `message` — a `docs:` commit message listing each path, ending in the repo's
  `Co-Authored-By` line
- `steps` — the exact git commands the execute path will run
- `merge: false` — this operation never merges

## Step 3 — Execute

Re-run with `--execute`. The side-effecting path:

1. `git fetch origin`
2. Resolves and records the Base SHA (`git rev-parse <base>`).
3. `git worktree add <scratch-worktree> -b <branch> <base>` — a clean checkout of
   the base, so the branch can only contain what is copied in. The working tree is
   usually dirty (parked/unrelated work), which is exactly why an isolated worktree
   is used instead of `git checkout -b` in place.
4. Copies ONLY the named files into the worktree at the same relative paths, then
   `git add -- <path>` for each. Never `git add -A` / `git add .`.
5. Verifies `git status --porcelain` in the worktree shows only the intended paths.
   Stops if anything unexpected is staged.
6. Commits with the `docs:` message, captures the commit SHA.
7. `git push -u origin <branch>`.
8. Removes the worktree and prunes (branch + remote persist).

## Step 4 — Report

Deliver a copy-paste block:

```
Repository:     <repo>
Branch:         <branch>
Commit SHA:     <sha>
Base SHA:       <base sha>
Push confirmed: YES
Committed paths:
  - <path>
  - <path>
```

Anything produced this session that was NOT committed/pushed must be labeled
**LOCAL ONLY** so the reader knows other agents cannot see it.

## Optional — keep the handoff current

If publishing a substantive artifact, offer to also update the canonical handoff
doc `docs/CLAUDE_CONTEXT.md` current-state block on the same branch (base commit,
branch, published paths, LOCAL-ONLY parked work, open decisions) — a
minimum-footprint edit, one file, no revision of the artifacts themselves.

## Path policy (enforced by the script)

- Allowed prefixes: `docs/` (extend `ALLOWED_PREFIXES` in the script if a new
  artifact home is added).
- Denied even under an allowed prefix: anything containing `firestore.rules`,
  `.claude/`, `functions/`, or `field-ops-app-vite/src/` — never publish product
  code, Firestore Rules, identity, deploy config, or parked harness config.
- Rejected: absolute paths, drive-letter paths, and any path containing `..`
  (traversal).
- Duplicate paths are de-duplicated; order is preserved.
