# Sales — Opportunity Operating Workspace (Cycle 2)

Status: **BUILT (repo-only, read-first, synthetic source).** Ratified entry point for the Sales program.
No production data, no governed write path, no Rules/Functions change.

## 1. Why this, and why read-first

Opportunity Management — not Account → Create Work Order — is the ratified entry point to Sales (Owner
correction, Cycle 1 review). The Opportunity is the **pre-commitment commercial object**: it captures a
customer *need* and a proposed *solution* (product/model/part lines) before any operational commitment.
Nothing here creates a Work Order, reserves inventory, or touches an invoice.

Cycle 2 deliberately ships **read-first**: it renders a realistic pipeline over **synthetic** opportunities
so the Wave-0 composition primitives get their first Sales-side proving ground, without prematurely building
a write path. Mutation (create/advance/win/lose) arrives in a later cycle through a **trusted command
service + governed callable** (client stays deny-by-Rules); the "New opportunity" affordance is intentionally
inert until then so it is honest rather than a dead button.

## 2. Ratified lifecycle (single, shared)

One commercial lifecycle serves **both** channels (National Accounts and Retail — channel is context, not a
fork):

```
IDENTIFIED → QUALIFYING → SOLUTION → QUOTING → CUSTOMER_REVIEW → DECISION → (WON | LOST)
```

`WON` = the customer commitment (the seam to downstream Ops in a later cycle). `owner` is a canonical
Employee reference (`ownerEmployeeId`), never free text or a raw UID.

## 3. Two-vocabulary state model (reused from readiness)

State renders through the shared **semantic tone** layer (Wave-0 `tone.js`), so "attention looks like
attention" on every surface. Commercial state reads by **outcome** once closed (WON=positive, LOST=muted)
and by **stage** while open (DECISION=attention, else info). Attention is derived **honestly** from the
fields we actually have — no fabricated CRM signals: missing next action, overdue/imminent expected close,
pending decision. Closed opportunities never carry attention.

## 4. Architecture — the injected source seam

The single boundary between "where opportunities come from" and everything above it:

```
access/opportunitySource.js   →  hooks/useOpportunities.js  →  domain/opportunityLifecycle.js  →  SalesWorkspace
   (synthetic today,               (React adapter;              (pure projection: pipeline,        (Wave-0
    governed read model later)      injectable source)           attention, tone)                   primitives)
```

Swapping the synthetic source for a governed Firestore/callable read model is a **one-line change** in
`access/opportunitySource.js` — no component edit, no projection change, no hook-signature change. The
`{ loading, error }` shape is preserved so a later live source (onSnapshot / awaited callable) slots in
without changing the consumer contract, matching every other read hook in the app.

## 5. Files

| File | Role |
|------|------|
| `src/domain/opportunityLifecycle.js` | PURE domain: lifecycle vocabulary, stage→tone, attention derivation, pipeline projection |
| `src/data/opportunityScenarioFixtures.js` | SYNTHETIC scenario opportunities (SBX-OPP-*), clearly non-production |
| `src/access/opportunitySource.js` | The injected SOURCE seam (synthetic default; inert + governed later) |
| `src/hooks/useOpportunities.js` | React adapter over the seam |
| `src/modules/sales/SalesWorkspace.jsx` | Read-first pipeline + read-only detail on WorkspaceShell/ContextBand/StatusPill/ActionRail |
| `src/navigation/navConfig.js`, `src/App.jsx` | `opportunities` subnav under the CRM/Sales area (admin/dispatcher via PLACEHOLDER_DEFAULT_ROLES) |
| `test/opportunityLifecycle.test.mjs` (9), `test/salesWorkspace.test.jsx` (4) | Domain + render tests |

## 6. UX / experience posture

A **pipeline built for rapid scanning and comparison** — not a metric-card CRM dashboard, not a
giant-card-per-opportunity page. Attention sorts to the top; the detail aside is read-only. Final page-type
assignment and cross-persona validation are **UX-owned** and happen on realistic sandbox data later (per the
Product/Design vs UX split); this build does not pre-decide them.

## 7. Preserved seams for recorded roadmap requirements

- **Temporary Equipment Pool + Placement (SALES_EVALUATION):** a future Temporary Equipment Request can
  originate from an Opportunity; solution lines reference product/model/part (never a serialized asset), so
  that downstream-request seam is left open with no schema foreclosed.
- Opportunity owns no labor/cost/billing authority (Technician Labor + Cost Accounting requirement).

## 8. Not built here (later cycles)

Governed write path (trusted command + callable), estimate/quote inside the Opportunity, Won→Ops handoff
(`createWorkOrder`), Sales management/monitoring, and the end-user how-to guide (deferred until the pipeline
reads real data — documenting synthetic data would mislead).
