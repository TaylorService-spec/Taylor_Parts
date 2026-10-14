---
name: codex-review-request
description: Assemble a concise, self-contained Codex independent-engineering-review request for an implementation PR or branch, populated from the ACTUAL current repository state (gh pr view / git). Produces the exact short request block from docs/ai/workflow.md -- repo, PR, branch, spec + impl-plan links, and a review-for list scoped to what the diff really touches. Use when asked to prepare, draft, or send a Codex review request for a PR or branch.
---

# Codex review request

The authoritative, platform-neutral workflow for this skill lives at the repo
root and is shared by all agents (Claude and ChatGPT/Codex):

- `skills/codex-review-request/SKILL.md` — concise execution steps
- `skills/codex-review-request/references/workflow.md` — full workflow, edge cases, gh/git pipeline
- `skills/codex-review-request/scripts/build-request.mjs` — deterministic request builder (pure core)
- `skills/codex-review-request/scripts/codex-review-request.test.mjs` — `node --test`

Read and follow `skills/codex-review-request/SKILL.md`. Do not duplicate its
content here — that file is the single source of truth.
