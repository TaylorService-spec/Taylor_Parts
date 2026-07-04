---
name: branch-hygiene
description: Keep a PR/branch scoped to its stated purpose when unrelated work has accumulated in the working tree (e.g. a chore fix landing alongside feature work). Use whenever asked to "keep PR #N scoped," or when uncommitted changes clearly belong to two different concerns and need splitting across branches cleanly.
---

# branch-hygiene

The sequence used once this session to keep an open PR scoped while moving a large chunk of unrelated (but already-written) feature work onto its own branch, without losing or duplicating any of it.

## When this applies

You're on a branch with an open PR, and the working tree has a mix of:
- small, unrelated fixes that legitimately belong in that PR's scope (or are so minor they don't matter either way), and
- a larger, distinct feature that does *not* belong in that PR.

## Steps

1. **`git status --short`** first, always -- know exactly what's staged, unstaged, and untracked before touching anything (per the standing "verify, don't assume" rule -- see `docs/CLAUDE_CONTEXT.md`).

2. **Commit the small/unrelated fix on the current branch first**, and push it, so the open PR picks up only that scoped change:
   ```bash
   git add <the-unrelated-files>
   git commit -m "..."
   git push
   ```

3. **Branch off from that exact point**, before touching the larger feature work:
   ```bash
   git checkout -b <new-feature-branch>
   ```
   Any uncommitted changes in the working tree carry forward onto the new branch automatically (they were never committed to the original branch, so nothing needs to be cherry-picked or stashed) -- confirm with `git status --short` right after switching.

4. **Commit the feature work on the new branch**, push it separately:
   ```bash
   git add <feature-files>
   git commit -m "..."
   git push -u origin <new-feature-branch>
   ```

5. **Verify both branches independently** -- `gh pr view <original-PR>` should show only the scoped commit; `git log <new-branch> --oneline` should show the feature work, not duplicated on both branches.

## Why order matters

Committing the unrelated fix *before* creating the new branch is what keeps it out of the new branch's history (a new branch created after the commit doesn't inherit it as an uncommitted change, and won't re-commit it there). Doing it in the other order -- branching first, then trying to cherry-pick the fix back onto the original branch -- is more error-prone and was avoided deliberately.

## Related

`docs/CLAUDE_CONTEXT.md`'s "How work has been structured" section documents this exact pattern as an established convention for this project, not a one-off.
