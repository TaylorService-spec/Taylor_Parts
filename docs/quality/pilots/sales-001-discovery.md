# P-SALES-NA / SALES-001 — first DISCOVERY-mode live-browser pilot

The first formal **DISCOVERY** run (framework §5a) and the first **live-browser** persona pilot. Recorded per
the discovery-yield schema so its findings/questions/scenarios feed the corpus without auto-creating work.

## Run header
- **runId:** P-SALES-NA-SALES-001 · **agentId:** `P-SALES-NA` · **family:** PERSONA · **mode:** DISCOVERY
- **model:** OPUS (see model note below — SONNET-live-sufficiency NOT yet proven) · **budget:** SMALL
- **pinned build:** 4cd8ece · **fixture/data state:** synthetic opportunity fixtures `SBX-OPP-*` (8 records,
  6 open) served over the Cycle-2 injected source; Firestore/Auth emulator; seeded `admin` account
- **environment:** local dev server + `?emulator=1`; teardown completed
- **mission (open path, no route/control prescribed):** "You are managing an active customer opportunity.
  Determine where it stands, what needs attention, and what commercial action should happen next."

## Path taken (persona-chosen)
Login → **My Dashboard** (quick-access: Operations, Work Orders, Dispatcher Board, Customers, Inventory — **no
Sales/Opportunities entry**) → scanned top nav → expanded **CRM/Sales** group → **Opportunities** → read the
pipeline → as a National Accounts rep, identified my attention opportunity (**Northgate Grocery**) → opened
its detail → determined next commercial step. `domainsTraversed:` Dashboard, CRM/Sales (Opportunities).

## Verdicts
- **FUNCTIONAL: PASS** — could determine where the opportunity stands (Customer review, $42k, National
  Accounts), what needs attention (closing within a week), and the next action (follow up on proposal →
  advance to Decision).
- **EXPERIENCE: FAIL** — technically completing the "determine" mission still left real friction for a
  National Accounts salesperson (below). Recorded honestly; not optimized toward PASS (framework §5a/§8).

## uniqueFindings
- **F-SALES-001-A** · ACCESSIBILITY · Med · **FIXED (PR #656, main 8bc9dda).** Pipeline rows were mouse-only
  (`role:null, tabindex:null`, no key handler) — keyboard/AT users could not select an opportunity. Rows are
  now `role=button` + `tabIndex=0` + Enter/Space; covered by a component test.
- **F-SALES-001-B** · EXPERIENCE/IA · Med · **ROUTED → UX/Sales (accumulate evidence).** No channel/book
  scoping: a National Accounts rep's opportunities are interleaved with Retail, and the attention-sorted top
  row was a Retail opportunity, not theirs. One run ⇒ accumulate before an IA change (§5a).
- **F-SALES-001-C** · EXPERIENCE/IA · Low · **ROUTED → UX/IA (dashboard).** No Sales/Opportunities entry on
  the persona's dashboard quick-access; the primary Sales object had to be discovered under the CRM/Sales nav
  group.
- **F-SALES-001-D** · DATA/EXPERIENCE · Low · **RECORDED (not a defect now).** Owner renders a raw synthetic
  employee id (`SBX-EMP-lee`), not a person's name. Consistent with the trusted read projection (returns
  `ownerEmployeeId`; names resolve from the canonical Employee authority later).

## questionsRaised
- **Q-SALES-001-1:** "As a National Accounts salesperson, why is my pipeline mixed with Retail with no way to
  focus on my channel / book of business?" → possible missing persona/channel-scoped view. Lane: EXPERIENCE/IA.
- **Q-SALES-001-2:** "My next step is 'follow up on proposal', but the only lifecycle control is 'Advance to
  Decision' (disabled). When writes are live, where do I record the follow-up / quote / customer activity?"
  → possible missing quote/activity-capture abstraction. Lane: BUSINESS PROCESS.

## scenariosDiscovered (feed the corpus; not auto-executed)
- **SALES-002** — NA rep scopes/filters the pipeline to their channel/book. Persona P-SALES-NA. Why: focus &
  attention accuracy. Domain: Sales. Owner: UX/Sales. Prereq: channel-scoping decision.
- **SALES-003** — rep advances an opportunity through the lifecycle to WON once the governed write path is live.
  Persona P-SALES-NA. Domain: Sales. Owner: Sales (post grant+deploy).
- **J-ORDER2CASH (seed)** — won opportunity → Sales Order → warehouse prep → dispatch → install → completion →
  billing → AR. Personas: Sales/Warehouse/Dispatch/Technician/Accounting/AR. Domain: cross-domain JOURNEY.
  Owner: Journey family + business-capability-register #14 (Multi-Equipment Fulfillment). Prereq: Sales Order +
  fulfillment capabilities (greenfield).
- **DASH-001** — persona-appropriate dashboard entry points (a salesperson lands with Sales surfaced). Domain:
  nav/IA. Owner: UX.

## deadEnds
- The lifecycle "Advance to Decision" is disabled (governed write inert — expected this cycle).
- Looked for a channel filter to isolate National Accounts; none exists.

## newCoverageCreated
- `P-SALES-NA` moved ELIGIBLE → **ACTIVE** (first live run).
- Pipeline keyboard-selection now covered by a regression test (F-SALES-001-A).

## Model note (SONNET-live-sufficiency: OPEN)
This run executed on **OPUS (orchestrator)**, not the ratified SONNET, because reliable **live-browser**
delegation to a SONNET sub-agent is not yet supported by the tooling: the in-app browser is a shared singleton
not cleanly exposed to sub-agents, and the Playwright `driver.mjs` is non-persistent and Inventory-only (no
free Sales navigation). **This is itself a finding** — live-persona tooling needs a persistent, delegable
browser harness before the "is SONNET sufficient for live persona testing?" question can be answered.
→ **scenario/backlog: TOOLING-001** (build a delegable live-persona browser harness) · owner: agent-framework
(evidence-triggered per the "build EOS first" rule — do not pre-build).

## Token / cost (honest)
Live browser session driven by the orchestrator (no delegated sub-agent), so no per-agent token figure applies;
exact orchestrator tokens are not separately metered. Cost proxy: one live session, ~a dozen browser
tool-uses, one autonomous remediation (PR #656). Verification tokens were not spent re-driving the browser —
the a11y fix was verified by a deterministic component test (rerun only invalidated evidence).
