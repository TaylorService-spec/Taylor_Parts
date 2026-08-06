# Active Workstreams — multi-agent registry

**Status:** living registry — **the single authoritative surface for active assignment coordination.** Per [`AI_ENGINEERING_OPERATING_MODEL.md`](AI_ENGINEERING_OPERATING_MODEL.md) §8. The code-level ownership authority remains [`../architecture/SYSTEM_AUTHORITIES.md`](../architecture/SYSTEM_AUTHORITIES.md); this registry coordinates *who is actively writing where, right now*.

**Single owner of this concern (2026-08-06, Program 0 truth pass).** [`../session-state/`](../session-state/) previously carried overlapping active-lane coordination; it is now classified **HISTORICAL SNAPSHOT** and must not receive new in-flight assignments. Declare assignments here and nowhere else.

**Rules (summary — full text = the 8 numbered rules in the Operating Model §8):** declare the assignment here before writing; (1) one active writer per owned path; (2) no silent edits to a reserved shared file; (3) a shared-file collision does not stop a whole capability; (4) finish non-conflicting work and record the integration delta; (5) an Integration Agent owns high-collision files when practical; (6) a builder is not the sole approver of its own material change; (7) reviewers use repository evidence, not another agent's chat memory; (8) production promotion is serialized.

## How to use

When you begin a capability, add a row to **Active** with every declared field. Move it to **Recently completed** at capability completion (§6). Keep it short — this is a coordination surface, not a history log; `DECISIONS.md` is the durable record.

### Declared fields (template)

```
- Capability:          <business capability / feature area>
- Agent/session:       <session id or agent name> · Role: <builder|reviewer|integration|release-prep>
- Branch / worktree:   <branch> · <worktree path>
- Base commit:         <sha>
- Owned paths:         <paths this agent is the sole active writer of>
- Shared paths req'd:  <high-collision files needed; coordinate via Integration Agent>
- Dependencies:        <other workstreams/capabilities this waits on>
- Expected outcome:    <the completed capability>
- Protected boundaries:<Owner-gated items this will reach, if any>
- Lifecycle stage:     <DESIGNED|SANDBOX BUILD|SANDBOX VERIFIED|INTEGRATION|RELEASE CANDIDATE|OWNER REVIEW|PRODUCTION AUTHORIZED|OPERATIONALLY VERIFIED|RETIRED>
```

## Active

_None currently in flight. Add a row when you start a capability._

> **Standing note.** Concurrent sessions have recently merged without declaring an assignment here
> (PRs #584, #585). Per Operating Model §8 and §8a, declare the capability, branch, **verified base
> commit**, and owned/shared paths **before** writing — that declaration is what makes rules 1–2
> enforceable.

## Ready for assignment

- **Receiving activation (protected)** — the governed receive workflow now EXISTS (A1, scanner-within-FieldMode, DECISIONS #68) but is fail-closed on `RECEIVING_TRANSPORT_READY = false`. Turning it on is a **protected boundary**: Phase-F readiness flip + authorized Hosting release + the `inventory.stock.receive` grant already live for {admin,dispatcher,owner}. Owner-gated; not a repo-only capability.
- **(Optional) dedicated admin/dispatcher Receiving surface** — A1 placed the governed receive on the scanner (technician input tool); a separate Receiving home on an admin/dispatcher surface (driven from Purchasing → Purchase Orders) could reuse the same `ReceiveAgainstPurchaseOrder` component. Repo-only if pursued; not required by A1.
- Remaining Inventory placeholders — Cycle Counts, Back Orders (Truck Inventory already built; Transfers #71 and Warehouses #74 done). Both have little existing domain/backend/hooks/tests foundation → mostly net-new; sequence under §1a against Purchasing placeholders and any higher-priority risk/dependency work.
- Remaining Purchasing placeholders — Suppliers / Quotes / Receipts / Demand Planning (each a repo-only capability; Suppliers/Quotes would make currently-unused collections load-bearing → Tier-2 gate).

## Recently completed (this program window — see DECISIONS.md for the durable record)

| Capability | Stage | Record |
|---|---|---|
| Purchase Orders read surface (Purchasing item C) | MERGED (repo-only) | DECISIONS #64 · PR #578 |
| PartsScanner as a tool within FieldMode (item A) | MERGED (repo-only) | DECISIONS #65 · PR #581 |
| Default-autonomy operating mode (Charter Amendment 2) | MERGED | DECISIONS #66 · PR #582 |
| AI Engineering Operating Model + Owner/IP governance | MERGED | this program · see DECISIONS |
| Governed FieldMode Receive-against-Purchase-Order (A1) | MERGED (repo-only; readiness false) | DECISIONS #68 |
| Inventory → Receiving first-class workspace (one workflow, two launch points) | MERGED (repo-only) | DECISIONS #69 |
| Executive Architecture Office — Program 0 Authoritative Truth Pass | MERGED (docs-only) | DECISIONS #70 · `reviews/eao-program-0-truth-pass.md` |
| Inventory → Transfers first-class workspace (read-only; reuses canonical view-model) | MERGED (repo-only) | DECISIONS #71 |
| Inventory → Warehouses first-class workspace (read-only; registry + governed status/eligibility) | MERGED (repo-only) | DECISIONS #74 |
