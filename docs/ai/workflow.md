# AI-SDLC Workflow

The standard lifecycle for work in this repository.

```
Business Objective
      │
      ▼
ChatGPT Architecture Review
      │
      ▼
Claude Code Repository Assessment / Specification
      │
      ▼
ChatGPT Approval
      │
      ▼
Claude Code Implementation
      │
      ▼
ChatGPT Final Review
      │
      ▼
Owner Merge Authorization
```

## Stage detail

1. **Business Objective** — a person states the wanted outcome. No
   artifact yet.
2. **ChatGPT Architecture Review** — decides whether the request fits
   the platform's classification model and governance as proposed, or
   needs reshaping first.
3. **Claude Code Repository Assessment / Specification** — inspects
   the actual current repository state (affected files, dependencies,
   risks, options), then writes the implementation spec (scope,
   out-of-scope, design, rules impact, testing, rollback, acceptance
   criteria). For a multi-PR sprint, this stage also produces a short
   PR-level breakdown — not a separate mandatory document, just a
   section of the same specification unless the sprint's size warrants
   splitting it out.
4. **ChatGPT Approval** — approves the specification before
   implementation starts.
5. **Claude Code Implementation** — builds against the approved spec,
   one architectural concern per PR.
6. **ChatGPT Final Review** — confirms the implemented PR matches its
   approved specification.
7. **Owner Merge Authorization** — the project owner authorizes the
   merge. Architecture approval is not merge authorization; they are
   separate, sequential gates. (For routine repo-only **Tier-1** PRs this
   gate is satisfied by the standing default-autonomy authority —
   [`../DelegationCharter.md`](../DelegationCharter.md) §8; explicit Owner
   authorization is required only where a protected/material boundary is
   crossed. See "Relationship to the AI Engineering Operating Model" below.)

## Codex — optional independent engineering review

Codex is not a mandatory gate for every PR. Request a Codex review when
independent engineering review adds real value — especially:

- Firestore Rules changes
- Security-sensitive changes
- Complex transactions
- Large refactors
- Performance-sensitive implementation

Codex review is not required for documentation-only PRs, small bug
fixes, routine UI changes, or low-risk implementation using established
patterns.

When requested, keep the request short — Codex does not share Claude
Code's operating instructions or this conversation's context:

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
the architecture.** A Codex finding that looks architectural is a
question for ChatGPT's next review pass on the PR, not an in-review
fix — see `claude-code.md`'s finding-classification requirement.

## Exceptions

A live production incident may skip directly to Implementation, with a
retroactive Architecture Review and Assessment filed after the fix
ships. Small, non-architectural changes (typo, copy, dependency patch)
may skip the Architecture Review and Specification stages.

Any stage can send work backward to an earlier one — these are
checkpoints, not one-way doors.

## Relationship to the AI Engineering Operating Model

This document is the **per-change** lifecycle (one architectural concern per PR). It sits inside the broader **capability-level** delivery frame in [`../engineering/AI_ENGINEERING_OPERATING_MODEL.md`](../engineering/AI_ENGINEERING_OPERATING_MODEL.md): the unit of delivery is a completed business capability (not a single PR); repo-only reversible work within an approved architecture runs autonomously ([`../DelegationCharter.md`](../DelegationCharter.md) §8) — the "Owner Merge Authorization" gate above is **not** required for routine repo-only Tier-1 PRs, only where a protected boundary is crossed; and work is promoted through DESIGNED → SANDBOX → INTEGRATION → RELEASE CANDIDATE → OWNER EXPERIENCE REVIEW → PRODUCTION with production promotion serialized. That document is the authority for the capability frame, environments, and multi-agent coordination; this one remains the authority for the per-change stages.
