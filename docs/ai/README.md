# AI Operating Manual

This directory defines how AI systems work in this repository: who does
what, in what order, and where the record of that work lives. It exists
because this project already runs a multi-AI workflow (ChatGPT for
architecture/governance, Claude Code for implementation, Codex for
independent engineering review) and that workflow was, until now, only
documented as convention inside individual conversations — not
discoverable by a fresh session, not enforceable, and not verifiable
after the fact. This manual makes it a repository artifact instead.

## The repository is the shared communication layer

No AI in this workflow has memory of another AI's conversations. ChatGPT
cannot see this session; a fresh Claude Code session cannot see a prior
one; Codex reviews a diff with no context beyond what's written down.
The only thing all three can reliably see is the repository itself —
its code, its `git log`, and its `docs/` tree. Every architectural
decision, approval, specification, and review that needs to survive
past the conversation that produced it must be committed here. A
decision that exists only in chat does not exist for the next session.

This is not a new principle for this project — `docs/CLAUDE_CONTEXT.md`
already opens with a warning about exactly this failure mode (a prior
session fabricated citations to architecture docs that were never
written, and separately treated a prior session's uncommitted claims as
fact). This manual generalizes the fix that document already applies to
architecture: don't trust a memory, trust a committed artifact.

## AI roles

- **ChatGPT** — enterprise architecture, governance, business-entity and
  capability modeling, security architecture, sprint approval,
  PR-level architecture review, final approval. See
  [`chatgpt.md`](chatgpt.md). Does not implement repository code.
- **Claude Code** — repository inspection, implementation, git
  operations, builds, tests, PR creation, applying approved
  corrections. See [`claude-code.md`](claude-code.md).
- **Codex** — independent engineering review: code quality,
  performance, security, test coverage, standards compliance. See
  [`codex.md`](codex.md). Does not redefine platform architecture.

Each role's document states what it owns and, just as importantly, what
it explicitly does not — the boundary matters as much as the
responsibility, since role bleed (an implementer deciding architecture,
a reviewer redefining scope) is the specific failure this workflow is
designed to prevent.

## Review gates

The full sequence — Business Request → Repository Assessment →
Architecture Review → Sprint Specification → Implementation Plan →
Implementation → Codex Review → Architecture Approval → Merge — is
defined in [`workflow.md`](workflow.md). Each gate has one clear owner
and produces a durable artifact before the next gate begins. No gate is
skipped by default; skipping a gate is a deliberate, stated exception
(e.g. a live production incident), not a shortcut taken silently.

## Repository-first philosophy

If it isn't written down in the repository, it didn't happen — the same
standard this project already holds code to (`main` is the source of
truth, not a branch, not a conversation) now applies to the *process*
that produces changes to `main`, not just the changes themselves.
Concretely: an architecture decision without a committed Architecture
Review is not approved; a sprint without a committed Sprint
Specification is not ready for implementation; a PR without a
traceable link back to its specification and review is not ready to
merge.

## Artifact locations

| Artifact | Location | Produced by |
|---|---|---|
| Architecture Reviews | `docs/ai/` templates, output committed under `docs/ArchitectureReviews/` (see `workflow.md`) | ChatGPT |
| Assessment Reports | output committed under `docs/AssessmentReports/` | Claude Code |
| Sprint Specifications | output committed under `docs/SprintSpecifications/` | Claude Code, approved by ChatGPT |
| Implementation Plans | output committed under `docs/SprintSpecifications/` alongside their spec, or inline in the PR description for small changes | Claude Code |
| Codex reviews | PR comments/review, referenced from the PR description | Codex |
| Standing governance | `docs/PROJECT_ARCHITECTURE.md`, `docs/BusinessEntityModel.md`, `docs/PlatformCapabilityModel.md`, `docs/GuidingPrinciples.md`, `docs/CLAUDE_CONTEXT.md` | ChatGPT decisions, recorded by Claude Code |

This table names target directories that do not all exist yet
(`ArchitectureReviews/`, `AssessmentReports/`, `SprintSpecifications/`)
— they are created on first use, the same "named for coherence, not
scoped yet" convention `docs/BusinessEntityModel.md` already uses for
future entities. This manual (`docs/ai/`) is the process definition;
those directories are where the process's output lives once work
starts flowing through it.
