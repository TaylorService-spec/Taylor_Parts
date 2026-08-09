# Taylor / EOS — Execution Backlog (orchestrator instance)

**Status: durable schedulability ledger.** This is the Taylor *instance* of the
[Continuous Workstream Orchestrator](./continuous-workstream-orchestrator.md). It records each work item's
**schedulability state** (§3 of the design) so the next eligible item is selected deterministically (§4)
after any `DONE` — closing the observed "completed work does not trigger the next execution" gap.

**Sources of truth (this table aggregates; it does not override them):** the
[roadmap register](../roadmaps/business-capability-register.md) (future capabilities),
[`ACTIVE_WORKSTREAMS.md`](../engineering/ACTIVE_WORKSTREAMS.md) (active-assignment coordination + lifecycle
stage), [`DECISIONS.md`](../DECISIONS.md) (durable decisions), and [`DelegationCharter.md`](../DelegationCharter.md)
§8.3 (protected boundaries). When this table and a source disagree, **the source wins** and this table is
corrected. Advancing roadmap maturity remains a governance act, not an edit here.

**This ledger creates no capability, grant, collection, or Rule.** `Register ≠ grant · Export ≠ deploy ·
Merge ≠ live.`

Baseline reconciled at `origin/main` = `e096f56` (pin `ff22df90…`; Finance + Coverage capabilities
`active:false`; all new collections deny-all in both Rules mirrors).

---

## READY — eligible for selection now (repo-safe, authority-clear, unblocked)

| # | Item | Why READY | Next reversible increment |
|---|---|---|---|
| R1 | **Continuous Workstream Orchestrator foundation** *(this workstream)* | Owner-directed; repo-only governance docs; no material dependency | Backlog + state machine + selection rule + checkpoint policy → PR → merge *(in progress)* |

> After R1 merges, the highest-value **non-protected, non-UX-only, non-deferred** product increments are
> gated on an `OWNER_DECISION` (R-1 catalog-read authority — see below) or a `PROTECTED_ACTION` (Finance /
> Coverage / Receiving activation). This is *why* the process capability (R1) is correctly the top READY
> item: the product backends have reached their authorized repo-only boundary. New product READY items are
> promoted here as their blockers clear.

## RUNNING — a worker currently owns it

| Item | Worker | Declared in |
|---|---|---|
| R1 (this doc) | session `c981623b` (Claude Code, OPUS) | [`ACTIVE_WORKSTREAMS.md`](../engineering/ACTIVE_WORKSTREAMS.md) |

## BLOCKED_DEPENDENCY — skip; select another READY; promote when blocker is DONE

| Item | Blocked on | Type |
|---|---|---|
| Serialized Equipment availability | P1a real serialized-asset availability signal **+** #12 Temporary Equipment/Placement. Do **not** fabricate availability data | roadmap |
| #12 Temporary Equipment / Placement | Assess only **after** F2 + integrated sandbox mature (custody persistence shape unresolved) | roadmap (preserved) |
| #13 Technician Labor / Cost | Assess only **after** Service Ops convergence + F2 + sandbox | roadmap (preserved) |
| Manufacturer read surface · `part_supplier_items` read/Purchasing UI | **R-1 catalog-read authority** (`inventory.catalog.read` / `.cost.read`) — no legacy read site to reuse; workspaces fail closed today | repo-complete, read-blocked |
| Supplier Master · Part Master — integrated-sandbox experience review | EAO integrated-sandbox environment program (not yet available) | AT REST |
| Final Service IA | UX journey evidence still being accumulated (UX-owned; evidence-dependent) | evidence-dependent |

## OWNER_DECISION — genuine gate; do not invent an answer; keep other READY items moving

| Item | Decision needed |
|---|---|
| **Continuation-trigger activation** *(from this design §5)* | Enable **B: unattended self-scheduling** (with a budget cap + checkpoint cadence) now, or keep **A: in-session `/loop` continuation** as default? |
| **Tool-permission allow-list** *(from this design §7)* | Ratify the VERIFICATION-class `permissions.allow` additions + PROTECTED-class `deny` block in `.claude/settings.json` |
| **R-1 catalog-read authority** | Adopt a durable `inventory.catalog.read` (+ separate `inventory.catalog.cost.read`) model? Unblocks Manufacturer / `part_supplier_items` read surfaces. Requirement: [`docs/assessments/r1-catalog-read-authority-requirement.md`](../assessments/r1-catalog-read-authority-requirement.md) |
| Coverage precedence / override / inheritance · sales credit · commission | Intentionally deferred policy (#15). Do **not** manufacture to make "My Book" easier |
| Finance revenue recognition engine | Separate future accounting-policy seam; not an EOS engine now |
| Cycle Counts · Back Orders | Design-first (DECISIONS #76): each needs a spec/ADR defining the business workflow + trusted write authority **before** any workspace. Not a CRUD-fill task |

## PROTECTED_ACTION — repo-complete; waits for an authorized operator (Charter §8.3)

| Item | Protected step held |
|---|---|
| **Finance Billing/AR activation** (#690–#694, #701) | Grant `finance.*` capabilities · deploy callables · deploy Rules · production write. `active:false` today |
| **Commercial Coverage #15 activation** (#695, #697) | Grant `coverage.*` · deploy callables · deploy Rules |
| **Receiving activation** | `RECEIVING_TRANSPORT_READY` flip + authorized Hosting release (`inventory.stock.receive` grant already live for {admin,dispatcher,owner}) |
| **Truck Management activation** | Deploy the 8 undeployed truck callables + Rules (draft PR #518 repo-only) |
| Supplier / Part Master / Manufacturer / `part_supplier_items` promotion | Rules deploy · Functions deploy · prod create/migration · grants — all held behind sandbox + Owner experience review |

## TOOL_PERMISSION_BLOCKED — execution mechanics, not a decision

| Symptom | Resolution |
|---|---|
| Routine safe Bash (`git status`, `npm test`, `node --test`) prompts for approval in this VS Code session | Apply the two-class permission policy — orchestrator design §7. Pending the Owner-ratified `settings.json` change (an `OWNER_DECISION` row above); until then, individual prompts are approved ad hoc and do **not** count as product gates |

## DONE — recent capability completions (see DECISIONS.md for the durable record)

| Capability | Evidence | Schedulability note |
|---|---|---|
| Finance: money model · invoice issuance · payment/AR · adjustments · trusted AR read · refund | #690 · #691 · #692 · #693 · #694 · #701 | → `PROTECTED_ACTION` (activation held) |
| Commercial Coverage #15: governed inert persistence · trusted resolution | #695 · #697 | → `PROTECTED_ACTION` (activation held) |
| Supplier Master (S1–S5, RC + promotion package + migration tooling) | #596–#612 | AT REST → sandbox review |
| Part Master in-app governed write (callables + workspace) | #617 · #619 | AT REST → sandbox review |
| Manufacturer governed write (callables + workspace) | #625 · #626 | → read-blocked on R-1 |
| Part↔Supplier procurement terms — write layer + projection | #629 | → read-blocked on R-1 |
| Purchasing PO read surface · PartsScanner-in-FieldMode · Receive-against-PO (fail-closed) · Inventory Receiving/Transfers/Warehouses/Receipts workspaces | #578 · #581 · DECISIONS #68/#69/#71/#74/#76 | repo-only DONE |
| Default-autonomy operating mode · AI Engineering Operating Model + Owner/IP governance · EAO Program-0 truth pass | DECISIONS #66/#67/#70 | governance DONE |

## ROADMAP_COMPLETE

Not reached — READY item R1 is in flight, and the roadmap register carries multiple `IDENTIFIED` capabilities
(Service Contracts/PM, Warranty/Entitlement, Installed Base, Returns/RMA, and others) whose roadmap triggers
have not yet fired.

---

### Maintenance rule

The worker updates this ledger as part of each item's `DONE` transition (Operating Model §6 cleanup step):
move the finished item to **DONE**, re-evaluate **BLOCKED_DEPENDENCY** for promotion, then apply the §4
selection rule to name the next **READY** item. Keep it short — this is a schedulability surface, not a
history log; `DECISIONS.md` and `ACTIVE_WORKSTREAMS.md` remain the durable records.
