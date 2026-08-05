---
name: publish-artifacts
description: Safely publish one or more repository documents (analysis, spec, review, handoff) to a NEW branch off origin/main, committing ONLY the named paths, pushing, without merging — so ChatGPT/Codex and other sessions can see work that would otherwise be stranded in a local working copy. Use when asked to publish/push artifacts, share docs with ChatGPT/Codex, or when analysis/spec docs exist only locally.
---

# Publish artifacts (adapter)

The authoritative, platform-neutral workflow for this skill lives in the shared
repo skill at **`skills/publish-artifacts/`**:

- `skills/publish-artifacts/SKILL.md` — execution steps
- `skills/publish-artifacts/references/` — detailed workflow, path policy, refusals
- `skills/publish-artifacts/scripts/publish-artifacts.mjs` — deterministic
  plan-and-publish script (dry-run by default; `--execute` to publish)
- `skills/publish-artifacts/scripts/publish-artifacts.test.mjs` — unit tests

Read and follow `skills/publish-artifacts/SKILL.md`. Do not duplicate its content
here — this file is only a pointer so the shared version stays the single source
of truth for every agent.
