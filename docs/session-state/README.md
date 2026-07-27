# Workstream Session State

This directory extends the delta-only Session Handoff Protocol in
[`AGENTS.md`](../../AGENTS.md); it does not replace it.

- `AGENTS.md` remains the global session handoff protocol.
- [`docs/CLAUDE_CONTEXT.md`](../CLAUDE_CONTEXT.md) remains the cold-start repository orientation.
- [`docs/DelegationCharter.md`](../DelegationCharter.md) and
  [`docs/DECISIONS.md`](../DECISIONS.md) remain governance authorities.
- These files contain short, delta-only operational summaries. They are not product, architecture, deployment, or production truth.
- Permanent truth remains in governed product documents, architecture documents, specifications, implementation plans, decisions, merged pull requests, issues, and committed production evidence.
- Link to authoritative artifacts instead of copying their contents.
- Git history is the archive. Do not create timestamped or versioned duplicates.
- Update a state file only after a material state change.
- Each session may read every state file but may modify only its assigned workstream file.
- “Not observed” does not mean “passed.”
- A closed issue does not prove production completion.
- Cross-stream conflicts must be recorded and escalated. Never reconcile them silently.
- Production completion requires linked production evidence.

## New-session instruction

Read, in order:

1. `AGENTS.md`
2. `docs/DelegationCharter.md`
3. `docs/DECISIONS.md`
4. `docs/CLAUDE_CONTEXT.md`
5. `docs/session-state/README.md`
6. the assigned workstream state file
7. only the linked source artifacts needed for the active assignment

Use the repository as the source of truth.
Do not rely on prior chat history.
Do not modify another workstream’s state file.
