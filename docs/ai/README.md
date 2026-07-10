# AI Operating Manual

This directory documents how AI agents collaborate on this project — not
to instruct AI memory, but to record the engineering process for future
contributors. The repository, not any chat session, is the durable
source of truth.

## Why the repository is the durable communication layer

No agent in this workflow has memory of another agent's conversations,
and no conversation survives past its own session. ChatGPT cannot see
a Claude Code session; a fresh Claude Code session cannot see a prior
one; Codex reviews a diff with no context beyond what's written down.
The only thing every agent can reliably see is the repository itself.

## Why architecture decisions are committed, not chat-only

A decision that exists only in chat does not exist for the next
session. This project has already been burned by that gap twice: a
prior session fabricated citations to architecture docs that were
never written, and a merged Firestore Rules change sat undeployed for
months because nothing forced a re-check (`docs/CLAUDE_CONTEXT.md`'s
intro and "Standing operating rule" sections). Committing every
architecture decision closes that gap the same way version control
already closes it for code.

## Relationship to ADRs

`docs/architecture/ADR-00N-*.md` remains the permanent record of major,
closed architecture decisions (Work Order Engine, inventory ledger
design, etc.). This manual doesn't replace or duplicate that — it
defines the *process* that produces new ADRs and governance updates,
not their content.

## Relationship to governance documents

`docs/PROJECT_ARCHITECTURE.md`, `docs/BusinessEntityModel.md`,
`docs/PlatformCapabilityModel.md`, and `docs/GuidingPrinciples.md`
remain the authoritative content for what the platform is and how it's
classified. This manual defines who is authorized to change them
(ChatGPT, see `chatgpt.md`) and through what process (`workflow.md`).

## Relationship to assessments, specifications, reviews, and plans

Repository Assessments, Sprint Specifications, Architecture Reviews,
and Implementation Plans are the working artifacts `workflow.md`'s
gates produce — each one is a committed document, not a chat summary,
so the reasoning behind a change is verifiable after the fact by
reading the repository, the same way `git log`/`git blame` already are.

See `workflow.md` for the full process, and `chatgpt.md`/
`claude-code.md`/`codex.md` for each agent's responsibilities and
boundaries.
