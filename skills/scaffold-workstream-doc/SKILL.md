---
name: scaffold-workstream-doc
description: Create a new AI-SDLC working artifact (assessment, specification, implementation plan, or architecture review) from the matching docs/ai/templates file, placed in its standard docs/ home with a filled front-matter block, a consistent workstream slug, and a one-line DECISIONS.md pointer when warranted. Use when starting a new workstream artifact or when asked to scaffold/create a spec, assessment, implementation plan, or review doc.
---

# Scaffold an AI-SDLC working artifact

The repository — not chat — is the durable source of truth (`docs/ai/README.md`).
Every gate in `docs/ai/workflow.md` produces a committed document from a standard
template in a standard home. This skill instantiates one correctly so artifacts
stay consistent and greppable across workstreams.

It creates a **draft skeleton only**. It does not write the analysis, approve
anything, or merge. Filling the body is the real work that follows.

## Execution

1. **Identify the artifact type and home.**

   | Type | Template (`docs/ai/templates/`) | Home |
   |---|---|---|
   | Repository Assessment | `assessment-template.md` | `docs/assessments/` |
   | Sprint Specification | `specification-template.md` | `docs/specifications/` |
   | Implementation Plan | `implementation-plan-template.md` | `docs/implementation-plans/` |
   | Architecture Review | `review-template.md` | `docs/reviews/` |

   ADRs are out of scope — they live in `docs/architecture/ADR-00N-*.md` with their
   own numbering. Do not create one here.

2. **Derive one consistent kebab-case slug** for the workstream. Reuse the same
   slug a workstream already uses so siblings sit together. Grep first:
   `ls docs/assessments docs/specifications docs/implementation-plans docs/reviews | grep -i <keyword>`.
   If none exists, propose a slug and confirm with the operator before writing.

3. **Run the scaffolder** (deterministic; refuses to overwrite):

   ```bash
   node skills/scaffold-workstream-doc/scripts/scaffold-workstream-doc.mjs \
     --type <assessment|specification|implementation-plan|architecture-review> \
     --slug <kebab-slug> [--owner <name>] [--dry-run]
   ```

   Preview with `--dry-run` first. It fills `status: Draft`, today's `date`, and
   `owner` (default `Claude Code`; `ChatGPT` for reviews — override with `--owner`,
   e.g. `Codex`). It leaves genuinely-unknown front-matter fields at their template
   default — never fabricate ADR/PR numbers, citations, or approval dates.

4. **State the gate, don't skip ahead.** Name which gate the artifact sits at and
   what must happen next (e.g. "Specification draft created — body still to write,
   then Architecture Review approval before implementation"). Do not pre-fill an
   approval that has not happened.

5. **DECISIONS.md only when warranted.** Scaffolding a draft is not itself a Tier 1
   decision — do not add a `docs/DECISIONS.md` entry just for it. Add a one-line
   pointer only if a real Tier 1 decision was made (`docs/DelegationCharter.md`
   Section 3). If a canonical ownership shifts, flag that
   `docs/architecture/SYSTEM_AUTHORITIES.md` must update in the same PR.

6. **Report** the created path, slug, gate, and next step. Note any missing sibling
   (e.g. "spec created but no assessment exists"). Do not stage a commit or open a
   PR unless asked; any PR follows the normal Owner Merge Authorization gate.

## Refusals

- No ADRs (wrong home/numbering).
- No overwriting an existing artifact at the target path (the script enforces this).
- No fabricated front-matter values, citations, ADR/PR numbers, or approvals.
- No `DECISIONS.md` entry for mere scaffolding.
- No marking any gate (approval, review) as passed.
- No artifact outside its standard home.

Detailed rules, edge cases, and the slug/front-matter conventions live in
`references/workflow.md`.
