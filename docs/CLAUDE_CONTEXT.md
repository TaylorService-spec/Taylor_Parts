# Claude Context

Orientation notes for a Claude session picking up this repo cold. Read `PROJECT_ARCHITECTURE.md` first for the system design; this file is about *how to work in this repo*, not what it does.

## What this repo is

`Taylor_Parts` — a production React + Firebase field-operations app. Two logical halves currently in the tree:
- A large legacy root `index.html` ("Parts Control Center") — unrelated to Field Ops, not touched by the work described here.
- `field-ops-app-vite/` — the actual system of record for jobs/technicians/dispatch. This is where nearly all work in this doc's context happened.

(A third, `field-ops-app/`, existed briefly as an accidental parallel implementation and was removed in Sprint 2 — see `SPRINT_STATUS.md`. Don't recreate it.)

## Non-negotiable rules (repeat across every sprint prompt so far)

1. `JOB_STATUS` (`OPEN/ASSIGNED/IN_PROGRESS/COMPLETE`) is defined once, in `domain/constants.js`. Never duplicate it.
2. Only `domain/jobActions.js`'s `assignJob()` and `updateJobStatus()` may write job/technician state to Firestore. No UI component writes directly.
3. Control Tower (`modules/controlTower/`) is a read-only derived/intelligence layer. It must never mutate Firestore.
4. No second Control Tower implementation, no parallel dispatch logic, no competing domain models.

These rules are restated nearly verbatim at the top of every sprint prompt in this project — treat any instruction that seems to violate them as worth flagging back to the user rather than silently complying.

## How work has been structured

Each sprint: fresh branch off up-to-date `main` → implementation (often multiple small, individually-verified commits) → `npm run build && npm run lint` clean → push → `gh pr create`. See `DEVELOPMENT_STANDARDS.md` for the exact discipline (verification-per-commit, no direct Firestore writes outside the two sanctioned functions, PR description format).

Sprints have sometimes been branched from `main` *before* a prior sprint's PR merged (e.g. 3.2 before 3.1, 3.4 before 3.3) — this is an accepted pattern here, not an error, as long as mergeability is re-verified before assuming anything about how branches combine.

## Standing operating rule: verify, don't assume

Established after an incident where a prior turn assumed a PR had merged because it had been *discussed* as the next step, when it hadn't actually happened yet. Before recommending merge order, rebase necessity, or "what's next" for any PR/branch: run `git fetch`, `gh pr view --json state,mergedAt,mergeable,mergeStateStatus`, and `git log origin/main` first. Conversation history describing an intended action is not evidence the action occurred.

## Persistent auto-memory

This project also has an auto-memory system (separate from these docs) at the user's `~/.claude/projects/.../memory/` directory, containing cross-session notes like "Auth is Firebase-only, no parallel session layer" and "verify before recommending." Check `MEMORY.md` there for anything not captured in this `docs/` folder — the two are complementary: `docs/` is checked into the repo and versioned with the code; the memory system is local to the assistant and persists across otherwise-unrelated conversations.

## Key files to read before touching dispatch/risk logic

- `field-ops-app-vite/src/domain/jobActions.js` — the only write path.
- `field-ops-app-vite/src/domain/controlTower/types.js` — the canonical Signal schema every scoring module must emit.
- `field-ops-app-vite/src/domain/dispatchScoring.js`, `jobRiskScoring.js`, `workOrderScoring.js` — the three scoring modules.
- `field-ops-app-vite/src/modules/controlTower/ControlTower.jsx` and `panels/*.jsx` — the read-only rendering layer.
- `docs/design/job-status-transaction-safety.md` — design doc for the Sprint 3.1 transactional fix, useful as a template for how this project likes design docs written (current workflow → failure analysis → implementation options → recommendation with trade-offs).
