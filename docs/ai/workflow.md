# AI-SDLC Workflow

The standard lifecycle for work in this repository.

```
Business Request
      │
      ▼
Repository Assessment        (Claude Code)
      │
      ▼
Architecture Review          (ChatGPT)
      │
      ▼
Sprint Specification         (Claude Code, approved by ChatGPT)
      │
      ▼
Implementation Plan          (Claude Code)
      │
      ▼
Implementation                (Claude Code)
      │
      ▼
Engineering Review (Codex)
      │
      ▼
Architecture Resolution      (ChatGPT)
      │
      ▼
Implementation Corrections   (Claude Code)
      │
      ▼
Final Architecture Approval  (ChatGPT)
      │
      ▼
Owner Merge Authorization
```

## Stage detail

1. **Business Request** — a person states the wanted outcome. No
   artifact yet.
2. **Repository Assessment** — Claude Code inspects the actual current
   repository state: affected files, dependencies, risks, options. No
   code written.
3. **Architecture Review** — ChatGPT decides whether the request fits
   the platform's classification model and governance as proposed, or
   needs reshaping first.
4. **Sprint Specification** — Claude Code writes the implementation
   spec (scope, out-of-scope, design, rules impact, testing, rollback,
   acceptance criteria); ChatGPT approves it before implementation
   starts.
5. **Implementation Plan** — Claude Code breaks the spec into PR-level
   steps, for multi-PR sprints.
6. **Implementation** — Claude Code builds against the approved spec,
   one architectural concern per PR.
7. **Engineering Review (Codex)** — independent review of the PR. See
   the request format below.
8. **Architecture Resolution** — ChatGPT resolves any Codex finding
   Claude Code flagged as needing architecture judgment (see
   `claude-code.md`'s finding-classification requirement).
9. **Implementation Corrections** — Claude Code applies whatever the
   prior two stages required.
10. **Final Architecture Approval** — ChatGPT confirms the corrected PR
    matches its approved spec and the resolved findings.
11. **Owner Merge Authorization** — the project owner authorizes the
    merge. Architecture approval is not merge authorization; they are
    separate, sequential gates.

## Codex review request format

Keep the request short — Codex does not share Claude Code's operating
instructions or this conversation's context.

```
Repository:
PR:
Branch:
Specification:
Implementation Plan:

Review for:
- Correctness
- Security
- Firestore Rules
- Performance
- Maintainability
- Testing
```

**If architecture appears incorrect: raise the issue, do not redesign
the architecture.** A Codex finding that looks architectural routes to
Architecture Resolution (stage 8), not to an in-review fix.

## Exceptions

A live production incident may skip directly to Implementation, with a
retroactive Architecture Review and Assessment filed after the fix
ships. Small, non-architectural changes (typo, copy, dependency patch)
may skip the Architecture Review and Sprint Specification stages, but
Engineering Review remains in effect for anything touching code, rules,
or configuration.

Any stage can send work backward to an earlier one — these are
checkpoints, not one-way doors.
