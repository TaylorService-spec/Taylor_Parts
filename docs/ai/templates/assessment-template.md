---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: YYYY-MM-DD
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Assessment Report: <topic>

**Business Request:** <one-line description or link to source request>

## Scope of this assessment
What was inspected, and what was explicitly not (time-box or boundary,
if relevant).

## Current repository state
What exists today, verified directly (not assumed) — relevant files,
functions, collections, rules, UI. Cite exact paths/line numbers where
useful.

## Affected files
| File | Current role | Why it's affected |
|---|---|---|

## Dependencies
What this touches or is touched by — other in-flight work, other
collections/rules, other consumers of the same code path.

## Risks
Concrete risks specific to this change, not generic disclaimers.

## Implementation options
If more than one viable approach exists, list them with trade-offs.
State a recommendation, but don't decide architecture here — that's
the Architecture Review's job.

## Estimated PR count
Rough estimate, with reasoning (e.g. "one PR per architectural
concern, per docs/ai/workflow.md").

## Open questions for Architecture Review
Anything that needs ChatGPT's decision before a Sprint Specification
can be written.
