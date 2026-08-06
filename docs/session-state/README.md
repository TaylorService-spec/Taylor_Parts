# Workstream Session State

> **CLASS: HISTORICAL SNAPSHOT — superseded for active coordination (2026-08-06, Program 0 truth pass).**
>
> The single authoritative registry of **who is actively writing where** is now
> [`../engineering/ACTIVE_WORKSTREAMS.md`](../engineering/ACTIVE_WORKSTREAMS.md), per
> [`../engineering/AI_ENGINEERING_OPERATING_MODEL.md`](../engineering/AI_ENGINEERING_OPERATING_MODEL.md) §8.
> Two registries for one concern violated the single-owner-concern rule in
> [`../PlatformOperatingModel.md`](../PlatformOperatingModel.md) §6.
>
> **Do not record new in-flight assignments here.** The files in this directory
> (`CUSTOMER.md`, `INVENTORY.md`, `PLATFORM.md`, `COORDINATION.md`) are retained as an accurate
> record of the multi-lane session period, last reconciled 2026-07-28/29. They remain useful for
> lane history — in particular the AUTH-PR-4 suspended-progression state and its protected rollback
> artifacts, which are **still live constraints** and must not be altered. Read them for that
> history; do not treat any status line as current, and do not rewrite them to look current.
>
> The concern each still owns: **historical lane narrative.** The concerns they no longer own:
> active assignment declaration, base-commit declaration, and shared-path coordination — all now
> owned by the registry above.

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
- Ownership allocation (Owner operating model): the **Customer** session owns Authentication architecture and repository implementation and maintains `CUSTOMER.md`, `PLATFORM.md`, and `COORDINATION.md`. There is **no independent Coordination session**. The **Inventory** session maintains `INVENTORY.md`. **Platform** involvement is required only for separately-authorized production configuration or deployment.
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
