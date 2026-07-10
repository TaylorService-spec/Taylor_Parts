# AI Development Workflow v2

The standard lifecycle for all future work in this repository. See
`docs/ai/README.md` for why this exists and `chatgpt.md`/
`claude-code.md`/`codex.md` for each role's responsibilities and
boundaries.

```
Business Request
      │
      ▼
Repository Assessment      (Claude Code)
      │
      ▼
Architecture Review        (ChatGPT)
      │
      ▼
Sprint Specification       (Claude Code, approved by ChatGPT)
      │
      ▼
Implementation Plan        (Claude Code)
      │
      ▼
Implementation             (Claude Code)
      │
      ▼
Codex Review                (Codex)
      │
      ▼
Architecture Approval      (ChatGPT)
      │
      ▼
Merge                      (Claude Code)
```

## Stage detail

### 1. Business Request
A person states what outcome is wanted, in business terms. Not yet
scoped, not yet assessed. Recorded wherever the request originates
(conversation, issue, ticket) — this stage produces no repository
artifact by itself.

### 2. Repository Assessment (Claude Code)
Read-only inspection of the actual current repository against the
request: affected files, dependencies, current-state behavior,
migration risk, estimated PR count, implementation options. No code
written. Output: an Assessment Report, committed under
`docs/AssessmentReports/` using `docs/ai/templates/assessment-template.md`.

### 3. Architecture Review (ChatGPT)
Reviews the Business Request and the Assessment Report against the
Enterprise Platform Classification Model, governance documents, and
existing capability/entity model. Decides whether the request fits the
platform as proposed, needs reshaping, or needs a governance update
first. Output: an Architecture Review, committed under
`docs/ArchitectureReviews/` using
`docs/ai/templates/review-template.md`, recording an explicit
approval, requested changes, or rejection.

### 4. Sprint Specification (Claude Code, approved by ChatGPT)
Once the Architecture Review approves the direction, Claude Code
produces a detailed implementation specification: scope, explicit
out-of-scope, technical design, Firestore Rules impact, testing plan,
rollback plan, acceptance criteria. No code written at this stage.
Output: a Sprint Specification, committed under
`docs/SprintSpecifications/` using
`docs/ai/templates/specification-template.md`. ChatGPT reviews and
records approval on the same document before Stage 6 begins.

### 5. Implementation Plan (Claude Code)
A short, PR-level breakdown of the approved specification: which PR
covers which architectural concern, in what order, with what
dependencies between them. For a single-PR sprint this may be a short
section appended to the Sprint Specification rather than a separate
document — see `docs/ai/templates/implementation-plan-template.md` for
when a standalone plan is warranted (multi-PR sprints, sprints with
sequencing dependencies on other in-flight work).

### 6. Implementation (Claude Code)
Claude Code implements against the approved specification and plan —
one architectural concern per PR (see `claude-code.md`). Builds/lint
pass clean before a PR is opened. A PR's description links back to its
Sprint Specification and, where applicable, its Implementation Plan.

### 7. Codex Review (Codex)
Independent engineering review of each PR — code quality, performance,
security, test coverage, standards compliance (see `codex.md`).
Findings are addressed by Claude Code before the PR proceeds to Stage
8; an architecture-shaped finding is routed back to ChatGPT instead of
resolved in place.

### 8. Architecture Approval (ChatGPT)
Final review confirming the merged-candidate PR matches its approved
Sprint Specification and doesn't introduce an architecture conflict
Codex's review wasn't scoped to catch. This is the gate that must pass
before merge — see `chatgpt.md`'s "final approval" responsibility.

### 9. Merge (Claude Code)
Claude Code merges only after Stage 8's approval and any required CI
checks pass. Where the change touches Firestore Rules, deploy state is
confirmed as its own explicit step after merge, per this project's
standing rule that merged does not mean deployed
(`docs/CLAUDE_CONTEXT.md`'s "Standing operating rule: verify, don't
assume"). The branch is cleaned up and the repository returns to a
clean state, ready for the next Business Request.

## Exceptions

A live production incident (a security issue, a broken write path, an
outage) may skip directly to Implementation with a retroactive
Architecture Review and Assessment Report filed after the fix ships —
this is a deliberate, named exception, not a silent shortcut, and the
retroactive artifacts are still required before the incident is
considered closed.

Small, single-file, non-architectural changes (a typo fix, a copy
change, a dependency patch version bump) may skip the Architecture
Review and Sprint Specification gates at the implementer's judgment —
but Repository Assessment (even brief) and Codex Review remain in
effect for anything that touches application code, rules, or
configuration.

## Gates are not one-way

Any gate can send work backward: a Codex finding that reveals a
specification gap returns to Stage 4, not an in-PR workaround; an
Architecture Approval finding that reveals the assessment missed
something returns to Stage 2. See `docs/ai/README.md`.
