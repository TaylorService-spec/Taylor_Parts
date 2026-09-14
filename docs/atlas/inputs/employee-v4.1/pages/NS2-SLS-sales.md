# NS2-SLS — Sales family
P1 sources: Opportunity List P1v4 (implemented evidence), Opportunity P1v2, Sales Agreement P1 (SA-G1–G3), Sales Orders Workspace P1 + Sales Order P1, Sales Dashboard.

## NS2-SLS-01 Opportunities workspace / NS2-SLS-02 Opportunity record
**Do.** Pipeline collection with downstream Agreement/Order column (gaps G1–G5 rendered honestly); record shows lifecycle position (opportunityLifecycle.js), next legitimate transition, commercial section, activity.
**Roles.** Salesperson (own pipeline, transitions under capability hooks), Sales Manager (team view, approvals), Owner (read/goal context).
**Record schema.** `[Identity + stage + next transition][Attention: stale/blocked][Overview/Details | Commercial/Agreement | Activity]` — URL-addressable sections.
**Interaction.** Transition buttons reflect useOpportunityTransitions truth: refused transitions show the refusing rule. Won → Agreement (SLS-03) → Sales Order (SLS-04) journey links.

## NS2-SLS-03 Sales Agreement record
**Do.** Agreement lifecycle between won opportunity and fulfillment; agreementToSalesOrder handoff.
**Roles.** Salesperson (draft), Sales Manager (approve), Finance (terms read).
**Gaps.** SA-G1–G3 stand; render designed slots with honest unavailable states.

## NS2-SLS-04/05 Sales Orders workspace / record
**Do.** Fulfillment truth: status (salesOrderStatus.js), money display, fulfillment progress, currency.
**Roles.** Salesperson (follow-up on won work), Warehouse/Parts (fulfillment), Finance (invoice handoff).
**Schema (record).** `[Identity + status + fulfillment progress][Lines + fulfillment][Money][History]`.

## NS2-SLS-06 Sales dashboard
Slice-and-dice, per-panel time frames, authority labels. P2 question: overlap with HOME-01 Sales + FIN-08 (P2-D5 / IA question) — do not merge silently.


OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN (see ns2/ATLAS-OBSERVATION-BASE.md — seeded from findings at/before ATLAS-BASE-2026-09-10-A).
