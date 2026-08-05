# scaffold-workstream-doc — detailed workflow

This is the reference detail for the concise `SKILL.md`. It captures the rules,
conventions, and edge cases that keep AI-SDLC artifacts consistent across the
Taylor_Parts repository. Governing docs: `docs/ai/README.md`,
`docs/ai/workflow.md`, `docs/DelegationCharter.md`.

## Why this exists

`docs/ai/README.md` records that this project has been burned by artifacts that
diverged — wrong folder, missing front-matter, an inconsistent slug, or (worst)
fabricated citations/approval dates. The scaffolder removes boilerplate friction
and mechanically prevents those divergences. It is intentionally dumb: it copies
a template, fills three known fields, and refuses to overwrite. It never writes
analysis and never advances a gate.

## Artifact type → template → home

| Type | Template | Home | Default front-matter owner |
|---|---|---|---|
| assessment | `docs/ai/templates/assessment-template.md` | `docs/assessments/` | Claude Code |
| specification | `docs/ai/templates/specification-template.md` | `docs/specifications/` | Claude Code |
| implementation-plan | `docs/ai/templates/implementation-plan-template.md` | `docs/implementation-plans/` | Claude Code |
| architecture-review | `docs/ai/templates/review-template.md` | `docs/reviews/` | ChatGPT |

The script accepts convenient aliases: `assess`, `spec`, `impl-plan`/`plan`,
`review`/`arch-review`. They all normalize to the canonical types above.

**ADRs are not in scope.** They live in `docs/architecture/ADR-00N-*.md`, follow
their own sequential numbering, and must never be created with this skill.

## Slug convention

- One shared kebab-case slug per workstream, reused across all four folders, so a
  spec lands next to its assessment under the same name (e.g.
  `employee-foundation.md` in `assessments/`, `specifications/`,
  `implementation-plans/`).
- Reviews sometimes suffix the role to match an existing pattern
  (`employee-foundation-architecture-review.md`). Follow whatever the existing
  file for that workstream did rather than inventing a new convention — the
  scaffolder does not auto-append a suffix, so pass the full slug you want.
- Before choosing a slug, grep so you either reuse an existing workstream slug or
  avoid colliding with an unrelated one:

  ```bash
  ls docs/assessments docs/specifications docs/implementation-plans docs/reviews 2>/dev/null | grep -i <keyword>
  ```

- If no artifact exists for the workstream yet, propose a slug and confirm it with
  the operator before writing — it anchors every sibling artifact afterward.
- The script validates the slug (`^[a-z0-9]+(-[a-z0-9]+)*$`), strips a trailing
  `.md`, and rejects spaces, uppercase, and path separators. This guarantees the
  output can never escape its home folder.

## Front-matter fill rules

The script rewrites **only** three fields, and only inside the leading YAML
front-matter block (a `date:` mention in the body is never touched):

- `status: Draft` — always, on creation.
- `date:` — today (`YYYY-MM-DD`), or `--date` override for deterministic runs.
- `owner:` — the template default, or `--owner` override (e.g. `Codex`, `ChatGPT`).

Every other field (`related_adrs`, `depends_on`, `implements`, `supersedes`,
`related_pr`, `target_release`, …) is left at its template default. Fill those by
hand afterward from what the operator states or what you can verify in the repo.

**Never fabricate.** An empty/placeholder field is correct; a fabricated ADR
number, PR number, citation, or approval date is the exact failure `docs/ai/README.md`
records this project being burned by. Do not invent them to look complete.

For a Specification, after scaffolding set the `# Sprint Specification: <name>`
heading and the `Architecture Review:` link line — but only if that review already
exists in `docs/reviews/`. Otherwise leave the placeholder and note it's pending.

## Overwrite refusal

The script throws and writes nothing if `<home>/<slug>.md` already exists. This is
a hard stop, not a prompt. When it triggers, report it and let the operator decide
whether to edit the existing artifact instead of scaffolding a new one. Do not
delete or rename the existing file to work around it.

## Gate awareness

The template gate ordering in `docs/ai/workflow.md` is real:

Repository Assessment → Architecture Review (ChatGPT approval) → Sprint
Specification → Implementation Plan → Implementation.

When you scaffold, state which gate the new artifact sits at and what must happen
next. Do not pre-fill an approval, decision, or review outcome that has not
actually occurred. If a sibling that the workflow expects first is missing (e.g. a
spec with no assessment), say so.

## DECISIONS.md and SYSTEM_AUTHORITIES.md

`docs/DECISIONS.md` is an append-only log of **Tier 1 decisions** a future session
would need (`docs/DelegationCharter.md` Section 3). Creating a draft artifact is
usually not such a decision — do not add an entry just for scaffolding. Add a
one-line pointer only if a real Tier 1 decision was made (e.g. sprint
scoping/sequencing), following the existing numbered format (date, decision,
reason, alternatives rejected). Never edit or delete a past entry.

If the work involves a canonical ownership shift (Work Order lifecycle, writes,
reads, nav authority, etc.), flag that `docs/architecture/SYSTEM_AUTHORITIES.md`
must be updated in the same PR.

## Reporting

Return: the created path(s), the slug, the gate the artifact sits at, and the
explicit next step. Note any missing sibling for the same workstream. Do not stage
a commit or open a PR unless asked — and any resulting PR follows the normal Owner
Merge Authorization gate.

## The deterministic script

`scripts/scaffold-workstream-doc.mjs` (Node stdlib only) separates a pure core
(no fs/network/git) from a thin fs runner:

- Pure, exported, unit-tested: `normalizeType`, `resolveArtifact`, `normalizeSlug`,
  `computeOutputPath`, `todayISO`, `setFrontMatterField`, `fillFrontMatter`,
  `planScaffold`.
- Side-effecting: `runScaffold` (reads the template, writes the output, enforces
  overwrite refusal) and the CLI. No git and no network — it only touches the
  local filesystem.

CLI:

```bash
node skills/scaffold-workstream-doc/scripts/scaffold-workstream-doc.mjs \
  --type specification --slug my-workstream [--owner Codex] [--date 2026-08-05] \
  [--repo-root <dir>] [--dry-run]
```

`--dry-run` computes and prints the full plan (destination path, resolved owner
and date) without writing anything. Always dry-run first when unsure.

Tests: `node --test skills/scaffold-workstream-doc/scripts/*.test.mjs`. They use
temp dirs and a fake template only — never a push, deploy, or network call.
(On some Node builds the bare-directory form `node --test <dir>/` misresolves the
directory as a module; use the `*.test.mjs` glob.)
