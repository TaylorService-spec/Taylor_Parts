---
name: scaffold-workstream-doc
description: Create a new AI-SDLC working artifact (assessment, specification, implementation plan, or architecture review) from the matching docs/ai/templates file, placed in its standard docs/ home with a filled front-matter block, a consistent workstream slug, and a one-line DECISIONS.md pointer when warranted. Use when starting a new workstream artifact or when asked to scaffold/create a spec, assessment, implementation plan, or review doc.
---

# Scaffold an AI-SDLC working artifact

This is a thin pointer. The authoritative, platform-neutral workflow lives in the
shared repo skill at **`skills/scaffold-workstream-doc/`**:

- `skills/scaffold-workstream-doc/SKILL.md` — the execution steps.
- `skills/scaffold-workstream-doc/references/workflow.md` — detailed rules, slug
  and front-matter conventions, edge cases.
- `skills/scaffold-workstream-doc/scripts/scaffold-workstream-doc.mjs` — the
  deterministic scaffolder (Node stdlib only).
- `skills/scaffold-workstream-doc/scripts/scaffold-workstream-doc.test.mjs` — its
  test.

Read and follow `skills/scaffold-workstream-doc/SKILL.md`. Do not duplicate its
content here — that shared copy is the single source of truth so Claude and
ChatGPT/Codex stay in sync.
