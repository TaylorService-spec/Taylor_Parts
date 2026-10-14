# publish-artifacts — refusals and safety boundaries

This operation is repo-only and fully reversible. Hold these lines even when asked
to relax them:

- **This skill never merges, and never pushes to `main`.** It only publishes a
  branch for review; it does not open+merge a PR. Any later merge of that branch
  follows the current `docs/DelegationCharter.md` — a Tier-1-only change may be
  merged once its verification conditions pass, and Owner authorization remains
  required for Tier-2/3 work.
- **Never commit paths beyond those named/confirmed.** No product code, Firestore
  Rules, identity, deploy config, `.claude/` parked work, or unrelated changes. The
  script enforces this with an allow/deny path policy and fails closed.
- **Never `git add -A` / `git add .`.** Stage explicit paths only. The execute path
  copies named files into a clean worktree and adds them one by one.
- **Never recreate a named file from memory** if it is missing. Stop and report
  where it is or why it can't be found.
- **Never revise the artifacts' content while publishing.** You are publishing the
  documents exactly as written, not producing a revision. (If content parity
  matters to the caller, compare a hash of source vs. what landed after execute.)
- **Do not deploy, run migrations, touch production data, or change identity.** None
  of that is in scope for publishing docs.

If a request would cross one of these lines, decline the crossing, explain which
boundary applies, and offer the in-scope alternative (publish the branch; any later
merge follows the current Delegation Charter).
