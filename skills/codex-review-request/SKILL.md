---
name: codex-review-request
description: Assemble a concise, self-contained Codex independent-engineering-review request for an implementation PR or branch, populated from the ACTUAL current repository state (gh pr view / git). Produces the exact short request block from docs/ai/workflow.md -- repo, PR, branch, spec + impl-plan links, and a review-for list scoped to what the diff really touches. Use when asked to prepare, draft, or send a Codex review request for a PR or branch.
---

# Codex review request (independent engineering review)

Codex reviews from the repository and diff only — no chat, no session memory, no
AI operating instructions. The request must be short and self-contained: every
fact comes from committed artifacts Codex can open. This skill only assembles the
text; it does not send, merge, or act on the review.

## Execution

1. **Get real state — do not trust the conversation.** `git fetch origin`, then
   `gh pr view <PR#> --json number,title,headRefName,baseRefName,state,isDraft,files,url`
   (or `git log --oneline origin/main..<branch>` and
   `git diff --name-only origin/main...<branch>` when there is no PR). No PR yet
   → `(none yet — branch <name>)`; never invent a number or URL.
2. **Check it is warranted.** Codex is optional (`docs/ai/workflow.md`): request
   it for `firestore.rules` changes, security-sensitive work, complex
   transactions, large refactors, or performance-sensitive code. Skip it for
   docs-only / small-fix / routine-UI diffs and say so.
3. **Locate governing artifacts by path** — spec in `docs/specifications/`, plan
   in `docs/implementation-plans/`, matched by workstream slug. Missing → write
   `(not committed)`. Never fabricate a spec/plan/ADR path.
4. **Prune "Review for" to the diff.** Keep Correctness/Security/Maintainability/
   Testing for code; add **Firestore Rules** only if a `firestore.rules` copy
   changed, **Performance** only if query/`onSnapshot`/render paths changed.
5. **Emit the block** in the `docs/ai/workflow.md` shape, inside a copy-paste
   code block, then one line of intentional out-of-scope plus: *if architecture
   appears incorrect, raise it for ChatGPT's next pass — do not redesign.*

## Deterministic builder

`scripts/build-request.mjs` is the pure, side-effect-free renderer. Gather state
with gh/git, then pipe it in as JSON:

```
node skills/codex-review-request/scripts/build-request.mjs --json <state.json>
```

It exports `buildReviewRequest`, `assessWarrant`, `buildReviewForList`,
`touchesRules`, `touchesPerformance`, `isDocsOnly` for reuse; `--dry-run` prints
the block and warrant assessment without implying any send. Tests:
`node --test skills/codex-review-request/scripts/`.

## Refusals

Do not send or contact Codex. Do not fill fields from memory. Do not invent a
PR/URL/spec/plan path. Do not add a dimension the diff can't exercise. Do not ask
Codex to redesign architecture. This skill never merges and does not act on the
review; any later merge follows the current `docs/DelegationCharter.md` (a
Tier-1-only change may be merged once verification passes; Owner authorization
remains required for Tier-2/3 work).

Full workflow, edge cases, and the runnable gh/git pipeline: `references/workflow.md`.
