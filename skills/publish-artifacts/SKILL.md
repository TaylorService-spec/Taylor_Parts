---
name: publish-artifacts
description: Safely publish one or more repository documents (analysis, spec, review, handoff) to a NEW branch off origin/main, committing ONLY the named paths, pushing, without merging — so other agents and sessions can see work that would otherwise be stranded in a local working copy. Use when asked to publish/push artifacts, share docs with reviewers, or when analysis/spec docs exist only locally.
---

# Publish artifacts to a shared branch

The git repository is the only context layer shared between separate agents and
sessions — a session's local working copy is private. Work that must be reviewed
elsewhere has to land on a remote branch, or it does not exist for others. This
skill publishes named documents to a NEW branch cleanly and reversibly, isolated
from a dirty working tree. It never merges, never deploys, and never touches
paths outside the exact list given.

## Execute

1. Confirm the exact artifact paths and the base. Get the paths the caller named
   (or auto-detect untracked/modified files under `docs/`). Confirm the list — do
   not publish more than asked. Base is `origin/main` unless told otherwise.
2. Build the plan deterministically and review it:
   `node skills/publish-artifacts/scripts/publish-artifacts.mjs --topic "<topic>" <path> [<path>...]`
   (dry-run by default — prints branch name, commit message, and the git steps; no
   git runs). The script validates every path against the allow/deny policy and
   fails closed on a missing or out-of-scope file.
3. Execute the publish once the plan is correct:
   `node skills/publish-artifacts/scripts/publish-artifacts.mjs --execute --topic "<topic>" <path>...`
   It fetches origin, adds an isolated worktree on the base, copies ONLY the named
   files in, stages them explicitly, verifies nothing unexpected is staged, commits
   with a `docs:` message, pushes the branch, and removes the worktree. It never
   merges and never pushes to `main`.
4. Report in a copy-paste block: Repository, Branch, Commit SHA, Base SHA, Push
   confirmed (YES/NO), committed paths. Label anything produced this session but
   NOT pushed as LOCAL ONLY.

Merge is a separate Owner gate — see `docs/DelegationCharter.md` and
`docs/ai/workflow.md`. Do not open+merge a PR here.

## Details

- Full workflow, path policy, and edge cases: `references/workflow.md`
- Refusals and safety boundaries: `references/refusals.md`

The deterministic planning core is pure and unit-tested
(`scripts/publish-artifacts.test.mjs`, `node --test skills/publish-artifacts/scripts/*.test.mjs`).
