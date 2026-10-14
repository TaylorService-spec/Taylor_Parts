# Codex review request — detailed workflow

Codex reviews a PR from **the repository and the diff only**. It has no
visibility into the chat, into any session's memory, or into the AI operating
instructions (`docs/ai/codex.md`, `docs/ai/workflow.md`). The request must be
short and fully self-contained: every fact Codex needs comes from committed
artifacts it can open, never from context only one session holds.

This workflow only **assembles** the request text. It does not send it, does not
merge anything, and does not act on the review that comes back. Send a concise
structured request — never a big operating prompt, and never ask Codex to
redesign architecture.

## Step 1 — Establish the real PR/branch state (do not trust the conversation)

Read actual state before writing a single field. Do not populate any field from
a memory of what the PR "should" be.

```bash
git fetch origin
gh pr view <PR#> --json number,title,headRefName,baseRefName,state,isDraft,files,url
# or, for a branch with no PR yet:
git log --oneline origin/main..<branch>
git diff --name-only origin/main...<branch>
```

If there is no PR yet, say so in the request (`PR: (none yet — branch <name>)`)
rather than inventing a number. If `gh` lacks access, fall back to the `git`
commands and note the branch is unpushed/unlinked — do not guess a PR URL.

## Step 2 — Decide whether Codex review is even warranted

`docs/ai/workflow.md` makes Codex **optional**, not a gate on every PR. Request
it when independent engineering review adds real value — specifically:

- `firestore.rules` changes (either copy)
- security-sensitive changes
- complex transactions
- large refactors
- performance-sensitive implementation

It is **not** warranted for documentation-only PRs, small bug fixes, routine UI
changes, or low-risk work on established patterns. If the diff is one of those,
recommend skipping Codex rather than generating a low-value request. State the
reason from the actual file list, e.g. "docs-only: every changed path is under
`docs/` — Codex not warranted per workflow.md."

`scripts/build-request.mjs` exposes `assessWarrant(files, opts)` which encodes
this: rules → warranted; security-sensitive paths (auth / permissions / Cloud
Functions) → warranted; a large change set (≥ threshold files) → warranted;
all-docs and routine/low-risk changes (routine UI, small fixes) → NOT warranted.
Pass `securitySensitive`, `complexTransaction`, or `forceWarrant` for risk the
path heuristic cannot see.

## Step 3 — Locate the governing artifacts

Codex needs the Specification and Implementation Plan the PR implements, by
repository path (not a chat summary). Find them under their standard homes
(`docs/ai/README.md`): specs in `docs/specifications/`, implementation plans in
`docs/implementation-plans/`, architecture reviews in `docs/reviews/`. Match by
the workstream slug. If either is missing, write `(not committed)` — do not
fabricate a path. A fabricated citation is a known past failure; never invent a
spec/plan/ADR link.

## Step 4 — Scope the "Review for" list to what the diff actually touches

Start from the canonical list in `docs/ai/workflow.md` and **prune it to the
diff**. Keep a line only if the changed files justify it:

- **Firestore Rules** — only if the diff touches a `firestore.rules` copy.
- **Performance** — only if it touches queries, `onSnapshot`, or hot render paths.
- **Testing** — keep whenever there is non-trivial behavior to demonstrate.
- **Correctness / Security / Maintainability** — keep by default for code PRs.

Do not pad the list with dimensions the diff can't exercise — a padded request
wastes Codex's pass. If Rules are touched, call that out first: it is the
highest-value reason to involve Codex at all. `buildReviewForList(files)` in the
script performs this pruning deterministically; explicit `rules`/`performance`
flags override the path heuristic when you have read the diff contents.

## Step 5 — Emit the request block

`buildReviewRequest(state)` renders exactly the `docs/ai/workflow.md` shape:

```
Repository: TaylorService-spec/Taylor_Parts
PR: #<number> — <title>   (or: (none yet — branch <headRefName>))
Branch: <headRefName>  (base: <baseRefName>)
Specification: docs/specifications/<slug>.md   (or (not committed))
Implementation Plan: docs/implementation-plans/<slug>.md   (or (not committed))

Review for:
- Correctness
- Security
- Firestore Rules          (only if a firestore.rules copy changed)
- Performance              (only if query/render/onSnapshot touched)
- Maintainability
- Testing

Changed files (<n>):
- <path>
  … (list, or "<n> files — see PR diff" if very large)
```

Below the block, note anything Codex should know is intentionally out of scope
(from the spec's "Explicitly out of scope"), and the standing boundary reminder:
**if architecture appears incorrect, raise it for ChatGPT's next pass — do not
redesign.**

## Running the builder

Gather state with gh/git, hand it to the pure builder as JSON:

```bash
gh pr view 189 --json number,title,headRefName,baseRefName,files \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0));
      process.stdout.write(JSON.stringify({
        pr:{number:d.number,title:d.title},
        branch:d.headRefName, base:d.baseRefName,
        changedFiles:d.files.map(f=>f.path),
        specPath:"docs/specifications/<slug>.md",
        planPath:"docs/implementation-plans/<slug>.md"
      }))' \
  | node skills/codex-review-request/scripts/build-request.mjs --json -
```

`--dry-run` prints the block plus the warrant assessment without implying any
send. The script never sends, merges, or contacts Codex — it prints text for the
operator to paste.

## Explicit refusals

- Do not send the request or contact Codex — output the block for the operator.
- Do not populate any field from conversation memory instead of `gh`/`git`.
- Do not invent a PR number, URL, spec path, or plan path that isn't real.
- Do not add a "Review for" dimension the diff cannot exercise.
- Do not ask Codex to redesign or re-approve architecture, or to reopen a spec.
- This workflow never merges and does not act on the review; any later merge
  follows the current Delegation Charter (a Tier-1-only change may be merged once
  verification passes; Owner authorization remains required for Tier-2/3 work).
