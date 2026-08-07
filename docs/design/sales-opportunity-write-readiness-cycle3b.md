# Sales — Opportunity Write-Readiness Seam (Cycle 3b)

Status: **BUILT (repo-only, fail-closed).** Surfaces the ratified Opportunity lifecycle actions in the
workspace as **honest, disabled affordances**, gated by a write-readiness seam. No write occurs; nothing is
granted or deployed.

## What it adds
- `access/opportunityWriteReadiness.js` — the single seam answering "may Opportunity writes happen from this
  client now?" Fail-closed by construction today (the Cycle-3 governed write is built but inert: capability
  `opportunity.write` is `active:false` and the callables are undeployed), so it returns `{ enabled:false }`
  with an honest reason. It requires **both** a capability grant **and** a command deploy to flip — future,
  separately-authorized actions. The workspace reads readiness **only** through here, so enabling later needs
  no UI change.
- `SalesWorkspace` — the Opportunity detail now shows a **Lifecycle** block: the actions the governed command
  *would* accept (from the pure `allowedActions` graph — advance one stage / Mark Won / Mark Lost) rendered
  **disabled** with the honest reason. Same posture as the inert "New opportunity" button.

## Invariants preserved
- Server (`functions/src/opportunity/*`) remains the write authority; the UI only mirrors the transition graph
  and never decides authorization. Still no client write path (Rules deny-all; callable undeployed).
- Pre-commitment: nothing here creates a Work Order, inventory movement, or invoice.

## Pilot note
This increment was the **first real agent-orchestration pilot** (OPUS Product/Design + SONNET delegated
agents: GOV-DRIFT, P-SALES, UX-COMPOSE). See the cycle readout / `docs/quality/` for the populated Agent
Control Board, findings, and the model-tier finding.

## Not built here
Live writes (need grant + deploy), a governed read model (needs read Rules), estimate/quote, Won→Sales Order.
