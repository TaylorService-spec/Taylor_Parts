# Session Handoff Protocol

Last updated: 2026-07-14 23:34:06 -07:00 (America/Phoenix)

Use delta-only handoffs across Customer, Inventory, Platform, and Coordination sessions.

- Treat repository documents, merged pull requests, issue comments, and review history as the durable record of completed work and evidence.
- Do not repeat historical implementation details, completed validation matrices, or standing governance rules in each new authorization.
- Include only the current objective, exact starting state, newly changed scope, required gates, merge authority, stop conditions, and final reporting requirements.
- Begin every handoff with `Issued: YYYY-MM-DD HH:mm:ss Z (America/Phoenix)` and the exact relevant commit head. The commit head is authoritative; the timestamp helps identify stale instructions.
- Reference the authoritative repository document, issue, pull request, or prior evidence instead of copying it into the handoff.
- Restate prior evidence only when a new result changes it or when it is necessary to authorize a safety-sensitive action.
- Preserve newer work by integrating current `main`; never allow an older handoff to overwrite newer code or decisions.
- If the current head, file surface, project state, or governing decision differs from the handoff, stop and report the discrepancy before acting.

Keep handoffs short enough to scan once. Project history belongs in the repository, not in repeated session prompts.

# Operating mode — default autonomy (MANDATORY)

Operate autonomously through repo-only implementation work; Rudy is the exception handler, not an approval relay. **Do NOT stop for routine merge, documentation, exact-head, review-routing, or cleanup approvals.** For reversible repo-only work within an already-approved architecture with all required checks passing: implement the approved design, fix review findings, run verification, update user docs / execution records / `DECISIONS.md`, open PRs, complete governed review, merge approved Tier-1 PRs under the exact-head guard, clean branches/worktrees, and continue into the next already-directed section. Make small implementation decisions that have one reasonable governed answer, log the reasoning, and continue.

**STOP and ask the Owner only for genuine boundaries:** a material product/architecture decision with multiple valid directions; a security/authorization-model change; a `firestore.rules` or other protected-policy change; a capability grant/revoke/role/access-administration action; a production deploy, Hosting release, Functions deploy, or live verification; a migration, destructive cleanup, production write, or rollback; spending/billing/vendor commitment; an irreversible action; crossing a clearly parallel-owned surface without a handoff; tests failing with a cause not safely resolvable within the approved design; uncertain evidence or an unproven zero-consumer/deletion claim; conflicting authoritative artifacts with no safe precedence; or scope that broadens beyond the approved direction.

Return at meaningful milestones, not after every PR — report what was done, what merged, verification performed, decisions made under governance, blocked items, and the next recommended lever (not routine approval questions). The human operator still executes all production-credentialed commands; the Owner still decides protected/material boundaries. **Full policy: `docs/DelegationCharter.md` §8 (Amendment 2).**
