# Agent Requests / Results ledger

Durable, repository-backed records so a workstream can request a bounded worker and receive its result
**without the Owner copy/pasting between sessions** ([design](../agent-manager.md)). **Chat text is never the
authoritative record — the files here are.**

- `*.request.json` — an [Agent Request](../lib/agentRequest.mjs) (`validateAgentRequest` must pass).
- `*.result.json` — an [Agent Result](../lib/agentResult.mjs) (`validateAgentResult` must pass), referencing
  its `requestId` and `routedBackTo` (the requesting workstream).

Lifecycle: a requesting workstream writes a `*.request.json`; the [Agent Manager](../lib/agentManager.mjs)
decides (`REJECT_INVALID` / `DEDUPE_REUSE` / `WAIT_NETWORK` / `READY_BUT_WAITING_RESOURCE` / `DISPATCH`) under
the [resource governor](../lib/resourceGovernor.mjs) and [network state](../lib/networkState.mjs); on
`DISPATCH` the session driver runs a bounded worker and writes `*.result.json`; the requesting workstream
consumes it on its next iteration.

**AGENT OUTPUT ≠ PRODUCT AUTHORITY.** Results are evidence; Design/UX interpret them. Nothing here grants a
capability, activates a backend, deploys, or crosses a protected boundary.

Owner/ChatGPT-originated top-level work enters through the sibling
[`work-intake/`](../work-intake/) hash-pinned ingress adapter, then projects into the same selector and
result-consumption paths. It is not added to this bounded-worker request ledger and does not create a
second queue.
