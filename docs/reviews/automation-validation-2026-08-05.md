---
title: Claude-only Automation Validation
workstream: automation-validation
date: 2026-08-05
author: Claude Code
status: Complete
base: origin/main @ 4ab2346
type: review
---

# Claude-only Automation Validation (2026-08-05)

Purpose: before trusting the repo-local `.claude/` automation inside the
autonomous build loop, prove each piece actually fires and produces usable
output. Recorded here so ChatGPT/Codex and future sessions have the evidence in
the repo, not just in a transcript.

Ground truth confirmed: authoritative `main = 4ab2346` (`git rev-parse
origin/main`); PRs #556 (skills), #557 (DECISIONS #61), #558 (35 user guides)
all merged; their feature branches deleted on origin.

All checks below are **local and reversible**. Nothing was deployed, no
production system was touched, no `firestore.rules` content was changed
(the one rules Edit was a comment marker, reverted immediately, never committed).

## Results

| # | Surface | Type | Result | Evidence |
|---|---------|------|--------|----------|
| 2a | `SessionStart` → `session-context.mjs` | live | **PASS** | Fired this session; delivered the Charter / CLAUDE_CONTEXT / SPRINT_STATUS / SYSTEM_AUTHORITIES orientation block + standing rules. |
| 2b | `PostToolUse(Edit\|Write\|MultiEdit)` → `rules-guard.mjs` | live + direct | **PASS** | Direct-invoke on a `firestore.rules` path → full Tier‑2/parity/deploy reminder; on a non-rules path → silent, exit 0. Live: a comment-only Edit to `field-ops-app-vite/firestore.rules` auto-fired the hook (reminder injected into context), then reverted. |
| 2c | `Stop` → `unpublished-work-guard.mjs` | wired + live | **PASS** | Was **not** registered in `settings.json`; added the `Stop` hook block (Owner-approved this session). Direct-invoke and then live turn-end firing both flagged the 6 stranded artifact docs listed below. |
| 2d | `design-code-reviewer` agent | spawned | **PASS** | Reviewed `field-ops-app-vite/src/modules/mobile/PartsScanner.jsx` — ranked findings with real line numbers, governance cross-refs, and a separate mechanical safe-fix list. Usable output. |
| 2d | `user-docs-writer` agent | spawned | **PASS** | Wrote a grounded end-user sign-out how-to; correctly located the real control (`AppHeader.jsx:75` → `logout` from `AuthContext.jsx:177`), invented no UI. |

## Gap found and fixed

`unpublished-work-guard.mjs` existed on disk but the `Stop` hook was never wired
into `.claude/settings.json` (`grep -c "Stop" settings.json` → `0`). Added the
`Stop` block this session (Owner-approved). Confirmed firing live at turn end.

## Incidental findings (recorded, not acted on this workstream)

1. **The entire `.claude/` automation was uncommitted/untracked** — the hooks,
   agents, and `settings.json` wiring existed only in the local working copy,
   never published. This validation workstream publishes them.

2. **Stranded artifact docs** the Stop guard flagged (pre-existing, other
   workstreams — NOT published here):
   - `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md`
   - `docs/reviews/design-code-legibility-and-docs-review.md`
   - `docs/reviews/project-integrity-review.md`
   - `docs/reviews/tooling-skill-marketplace-scan.md`
   - `docs/reviews/what-would-perfect-look-like.md`
   - `docs/specifications/rough-complete-build-blueprint.md` (the Blueprint referenced for the next step)

3. **Governance drift in parallel-session WIP** (surfaced by the
   design-code-reviewer smoke test, left untouched — belongs to another
   session): `field-ops-app-vite/src/modules/mobile/PartsScanner.jsx` is wired
   into the production nav (`App.jsx`, `technicianWorkspace` under `service`) but
   is backed entirely by the in-memory demo `InventoryContext` with no label
   saying its stock movements are cosmetic. A developer would reasonably mistake
   it for the real `inventory_transactions` write path. Worth an explicit
   demo/placeholder header comment or a `demo/` relocation before it's mistaken
   for governed inventory code.

## Working-tree note

The working tree at validation time was a three-way tangle: (a) this new
`.claude/` automation, (b) redundant untracked copies of already-merged `main`
content (`skills/`, `docs/user-guide/`, `AGENTS.md` from PR #556/#558), and
(c) a parallel session's WIP (`field-ops-app-vite/src/demo/*`, `PartsScanner.jsx`,
`administration/`). The tree was **not** force-switched, to respect
parallel-session isolation; the automation + this evidence doc are published to a
fresh branch off `main` via the `publish-artifacts` skill, committing only the
named paths.
