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

**Detailed roadmap progress (Phase 2):** for the full EOS → Domain → Capability → Milestone → Work Item →
Evidence hierarchy with per-item status/ownership/evidence/deployment distinctions, see the
[Owner Roadmap Projection](./roadmap-projection.md) — its structured model
([`lib/roadmapModel.mjs`](./lib/roadmapModel.mjs)) is the single durable roadmap state, and the rendered
snapshot [`roadmap/ROADMAP.md`](./roadmap/ROADMAP.md) is a read-only projection of it (not a second roadmap).
This schedulability ledger and that roadmap are both projections of the same state.

Baseline reconciled at `origin/main` = `d1ab2ae` (pin `ff22df90…`; Finance + Coverage capabilities
`active:false`; all new collections deny-all in both Rules mirrors).

---

## READY — eligible for selection now (repo-safe, authority-clear, unblocked)

| # | Item | Why READY | Next reversible increment |
|---|---|---|---|
| SO-HANDOFF-1 | **Opportunity line-item model + Sales Order transfer contract** (spec) | Repo-safe documentation work with no capability, grant, Rule or collection change. It is the named prerequisite for SO-HANDOFF-2 (Owner, 2026-08-20: "First define the Opportunity line-item model and determine what transfers into the Sales Order") | Write the spec: what a line item is on an Opportunity, which fields transfer into the Sales Order, and what the Sales Order derives rather than copies. No code |
| IDEMPOTENCY-KEY-SCOPE | **`mkAuditId` does not include the target id** (functions/src/opportunity/opportunityCallables.ts) | Repo-safe. Evidenced by test: one actor reusing an idempotency key across two DIFFERENT Opportunities collides, and the second call returns a false `replayed` that skips every validation and silently does not apply. `updateOpportunity` was fixed on 2026-08-20 by composing the id with the opportunityId; `transitionOpportunity` and `createOpportunity` still carry the collision | Narrow their audit ids the same way. Deliberately NOT done as a rider on the update work: it changes a live idempotency space with keys already in use, so it needs its own before/after reasoning |
| HELP-GUIDANCE-HOME | **PR #1061 (contextual help on empty states) is PARTIALLY SUPERSEDED — where does first-run guidance live now?** | Repo-safe design question, evidenced by a trial merge in an isolated worktree (2026-08-20): 5 files conflict, one hunk each. `EmptyState.jsx` resolves cleanly — icons and `guidance` are orthogonal and both survive. But Suppliers, Warehouses and AccountsList no longer render `EmptyState` directly: main migrated them to `MetadataListGrid`, which owns their empty state. The PR&#39;s per-screen guidance text therefore has nowhere to attach. Resolving it means deciding whether guidance belongs on the ListViewDefinition, on the presentation builder, or stays a component prop for hand-rolled screens only — a design decision, not a rebase | Decide the home for first-run guidance in the metadata list layer, then rebase #1061 onto that. Do NOT force-merge: taking main&#39;s side silently drops the guidance text, and taking the branch&#39;s side reverts the metadata migration. PR left OPEN, not closed — it is not fully superseded and its `EmptyState` half is still valid |

> **UX workstream registered 2026-08-09.** The prior terminal CHECKPOINT was reached with the UX
> workstream **absent from this ledger** — UX items existed only in session state, so the selector could not
> see them and correctly concluded "no authorized READY work" from the items it had. That was an
> ORCHESTRATOR_INTEGRATION_GAP in registration, not a genuine terminal state. UX-1..UX-3 above are
> UX-owned, repo-safe and unblocked; UX now selects through this same ledger and the shared
> `selectNextWork()` rather than a second mechanism.

> **Selection rule last run 2026-08-09 (post driver + permission-policy merges) → terminal CHECKPOINT.**
> After the orchestrator (R1), the `/loop` driver, and the bounded permission policy reached `DONE`, no
> product item is independently `READY`. Applying the ratified **blocker-decomposition** step (§4.3.b) to the
> top blocked chain (R-1 catalog-read → Manufacturer / `part_supplier_items` read surfaces): its repo-safe
> prerequisite — the R1-A domain **parity corpus** and shadow-parity gate — **already exists and is
> CI-enforced** (`functions/src/access/legacyAuthorizationSurface.ts` + `legacyAuthorizationSurface.test.mjs`;
> 47 legacy sites / 22 collections, grouped by cutover row, with post-cutover permission IDs). The impactful
> R-1 remainder (criterion-6 production evidence, Row 19 authorization request, the R1-C cutovers) is all
> `PROTECTED_ACTION` / `OWNER_DECISION`. Rebuilding the existing corpus would be duplication, which the rule
> forbids. **"No authorized READY work" is a legitimate terminal state** (Owner, 2026-08-09) — the loop
> checkpoints and does not manufacture work. New product `READY` items are promoted here as blockers clear.

## RUNNING — a worker currently owns it

| Item | Worker | Declared in |
|---|---|---|
| *(none)* | — | UX-1 vocabulary sweep CLOSED (#714 fix, #717 record); Owner Control Center CLOSED (keystone PR #8, Taylor #726/#728) |

## BLOCKED_DEPENDENCY — skip; select another READY; promote when blocker is DONE

| Item | Blocked on | Type |
|---|---|---|
| SO-HANDOFF-2 · **Opportunity → Sales Order creation UX** | **SO-HANDOFF-1** (line-item model + transfer contract). The backend is already complete and deployed — `createSalesOrderFromOpportunity` writes the lineage and its capability `opportunity.createSalesOrder` is granted and sandbox-activated — but the client has **zero call sites** (its only textual appearance is a comment in `metadata/definitions/salesOrder.js`), so a WON Opportunity cannot produce a Sales Order through the product. The upstream cause is that the Opportunity form never collects line items, so the handoff has nothing to hand over (`docs/assessments/sandbox-gap-scan-2026-08-19.md` H11). **Expose the EXISTING callable — do not write a second create service.** Must prevent duplicate Sales Orders, preserve lineage, surface validation/failure states distinctly, and navigate to the created order | product gap, backend-complete |
| ~~Control Center — Agent Operations / Network Health / Recent Progress / UX board~~ | **RESOLVED (#732 / keystone #9).** All four projection gaps filled by extending `controlCenterAdapter` (schema 1.1.0: `agentOperations`, `networkHealth` sanitized-only, `recentProgress` from PR evidence, populated `uxBoard`); keystone renders them; UX capabilities registered in `roadmapModel.mjs`. Not approximated | ~~projection~~ → DONE |
| Serialized Equipment availability | P1a real serialized-asset availability signal **+** #12 Temporary Equipment/Placement. Do **not** fabricate availability data | roadmap |
| #12 Temporary Equipment / Placement | Assess only **after** F2 + integrated sandbox mature (custody persistence shape unresolved) | roadmap (preserved) |
| #13 Technician Labor / Cost | Assess only **after** Service Ops convergence + F2 + sandbox | roadmap (preserved) |
| Manufacturer read surface · `part_supplier_items` read/Purchasing UI | **R-1 catalog-read authority** (`inventory.catalog.read` / `.cost.read`). Repo-safe R1-A prerequisite (parity corpus + shadow gate) already exists + CI-enforced; the wiring (R1-C cutover) is gated behind R1-B **protected production deployment** (Issue #226 Rows 19/20/22). Workspaces fail closed today | repo-complete, read-blocked |
| Supplier Master · Part Master — integrated-sandbox experience review | EAO integrated-sandbox environment program (not yet available) | AT REST |
| Final Service IA | UX journey evidence still being accumulated (UX-owned; evidence-dependent) | evidence-dependent |

## OWNER_DECISION — genuine gate; do not invent an answer; keep other READY items moving

| Item | Decision needed |
|---|---|
| ~~Continuation-trigger activation (§5)~~ | **RESOLVED 2026-08-09 → Option A adopted** (in-session `/loop`; PR #710). Option B (unattended) deferred with its own design checklist. |
| ~~Tool-permission allow-list (§7)~~ | **RESOLVED 2026-08-09 → ratified** (bounded two-class policy; PR #712). |
| **R-1 catalog-read authority** | Adopt a durable `inventory.catalog.read` (+ separate `inventory.catalog.cost.read`) model? Unblocks Manufacturer / `part_supplier_items` read surfaces. Requirement: [`docs/assessments/r1-catalog-read-authority-requirement.md`](../assessments/r1-catalog-read-authority-requirement.md). *(Note: the repo-safe R1-A prerequisite corpus already exists; activation is R1-B/R1-C protected.)* |
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
| Routine safe Bash (`git status`, `npm test`, `node --test`) prompts for approval in this VS Code session | **RESOLVED** — bounded two-class permission policy merged (PR #712): VERIFICATION-class pre-authorized in `.claude/settings.json`, PROTECTED-class hard-denied, no `Bash(*)`. Policy: `.claude/permission-policy.md` |

## DONE — recent capability completions (see DECISIONS.md for the durable record)

| Capability | Evidence | Schedulability note |
|---|---|---|
| **Continuous Workstream Orchestrator** — design + seeded backlog + Option A `/loop` driver (tested selector + CI) + blocker-decomposition correction | #703 · #710 | orchestrator capability DONE |
| **Bounded two-class tool-permission policy** (VERIFICATION allow + PROTECTED deny, no `Bash(*)`) | #712 | DONE (Tier-2, Owner-ratified) |
| **Authority-map currency** — Finance/Coverage + Sales-Opportunity/Order/Fulfillment rows in `SYSTEM_AUTHORITIES.md` | #706 · #707 | DONE (governance hygiene) |
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

## Owner Control Center — DONE (recorded 2026-08-09)

Reusable Owner Control Center UI shipped to `project-keystone` per the Owner placement
decision; **data stays here**, keystone renders.

| Evidence | Where |
|---|---|
| Control Center UI (zero-dep, local-first, read-only) | project-keystone PR #8, merged, content-verified on its `main` |
| Adapter contract + placement decision | #726 |
| Contract split into a dependency-free module | #728 |
| Live browser verification | 1280px + 390px · 0 page errors · 10 sections · 3 named gaps · provenance visible · no horizontal scroll |
| Tests | 10 (keystone) + 7 (adapter contract, CI-enforced here) |

**The split in #728 was made on consumer evidence, the only condition the placement
decision permits.** `checkPayloadCompatibility` lived in the adapter, which imports
`roadmapModel.mjs` — a module keystone does not have and must never need. Vendoring the
adapter dragged those imports along, the browser could not load the check, and every
project rendered as incompatible: a compatibility mechanism failing closed against
itself. One definition remains; only its packaging changed.

The four projection gaps have since been **closed at the source** (#732 / keystone #9) by
extending `controlCenterAdapter` (Agent Operations, sanitized Network Health, Recent
Progress, populated UX board) — never worked around inside keystone. The boundary held:
keystone renders only what the governed envelope carries.

### Delivery phase (recorded 2026-08-09)

Owner ratified security-gating **Model A** (Firestore-gated envelope) and **authorized**
the Hosting site + deploy and the Tier-2 Rules change + deploy **for operator execution**.

| Evidence | Where |
|---|---|
| Hosting/auth/freshness design + `freshnessState()` helper | #738 |
| Model-A publish tooling (`publishControlCenterEnvelope.mjs`, dry-run default) + parameterized Rule proposal + operator runbook + roadmap reconciliation | #739 |
| One-click Windows launcher (hosted-first / governed local-fallback, §13 safety) | keystone #10 |
| Launcher handoff | `UX-LAUNCHER-001` via the shared Agent Manager (0 Owner relay) |

**Still Owner/operator-gated (unexecuted):** Hosting site creation + deploy · Firestore
Rules deploy + authorized-Owner uid · credential/billing · any scheduled publish job.
Register ≠ grant · Export ≠ deploy · Merge ≠ live.

## UX-2 — CLOSED, ACCEPTABLE (recorded 2026-08-09)

The SAMPLE treatment shipped in #683 **resolves the demonstrated confusion**. Evidence
reused from the routed Agent Manager result `UX-2.result.json` (BROWSER_RUN) — no new
persona request was made, because valid current evidence already answered the question.

The result raised two points; UX interpreted both rather than treating them as verdicts.

**1. "SAMPLE renders run-on with the customer name" — NOT a defect.** Traced to the
markup and styling on `main`: `.fo-sample-badge` is `display:inline-block` with
`margin-left:6px`, padding, a border and a pill radius. It is a visually distinct badge.
The run-on appearance was an artifact of **accessibility-text extraction**, which
concatenates inline elements — the observation was real, the diagnosis was not.
Classified `NO_DEFECT`. No agent re-run was needed; repository tracing answered it.

**2. "Operational History renders Invalid Date" — STALE_OR_INVALID_EVIDENCE.** Current
`main` already routes that surface through `formatClockTime(event.timestamp,
{ unknown: "—" })`, which refuses unusable values and additionally guards the literal
string. The run was against a local dev server predating the fix. **Not routed as a
Product finding** — per the build-currency rule, a stale-build observation is
invalidated evidence, not a defect.

## UX-3 — CLOSED (Owner decided 2026-08-09: retire the standalone destination)

Activity destination scope. Evidence `UX-EX-001.result.json` interpreted and traced;
**no new agent requested**. Full disposition:
[`docs/reviews/ux3-activity-destination-scope.md`](../reviews/ux3-activity-destination-scope.md).

"Activity" names **four surfaces at four grains over three data sources**. Two share one
authority (Operational History is `buildTimeline` scoped to a single Work Order — a
narrower view, not a competitor). The other two are genuinely different: a session-only
in-memory feed and a persisted per-Account query. **Not a duplicate entry point.**

The open question is what a standalone `/dashboard/activity` should BE — global (which
would duplicate the live Service Operations timeline), "my activity" (a grain no surface
provides), or a cross-domain roll-up (a new projection). Each is a different product,
not a different layout, and nothing in the repository decides between them. **No UX fix
was manufactured to close the item.**

One routed finding was **refuted by tracing**: the claim that no screen is labelled
"Service Operations". `navConfig.js` declares exactly that domain at `/service-operations`;
"Control Tower" is the internal component name. The #708 copy is correct and unchanged.
