# Implementation Plan: <sprint name>

**Date:** YYYY-MM-DD
**Produced by:** Claude Code
**Sprint Specification:** <link>
**Status:** Draft / In Progress / Complete

Use a standalone Implementation Plan for multi-PR sprints or sprints
with sequencing dependencies on other in-flight work. For a
single-PR sprint, a short version of this content appended directly to
the Sprint Specification is sufficient — don't create a separate
document for it.

## PR breakdown
One row per planned PR, in dependency order.

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|

## Sequencing notes
Why this order — what must land before what, and why (e.g. "rules
change in PR 2 depends on the collection created in PR 1").

## External dependencies
Anything outside this repository's own PRs this plan depends on
(another team's work, a manual deploy step, a credential/config
change).

## Tracking
Update PR statuses here as they merge. This document is the running
source of truth for "what's left in this sprint" until the sprint
completes — link it from `docs/SPRINT_STATUS.md` if the sprint spans
more than a couple of PRs.
