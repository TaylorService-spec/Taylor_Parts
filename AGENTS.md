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
