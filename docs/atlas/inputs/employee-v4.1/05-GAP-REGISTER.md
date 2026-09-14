# NS2 Consolidated Gap Register (output P)
Index of named gaps/decisions carried into P2. Detail lives in the family handoff README named in Source. Types: AG authority gap, WG workflow gap, MC missing capability, PD product decision (Owner), DG design gap.

| Id | Type | Family | One-line | Source |
|---|---|---|---|---|
| CC-B1 | PD | Cycle Counts | Recount semantics after variance disposition | design_handoff_cycle_counts/README.md |
| CC-B2 | PD | Cycle Counts | "Finish Counting" sheet-level state | design_handoff_cycle_counts/README.md |
| CC-G2 | AG | Cycle Counts | (as registered) | design_handoff_cycle_counts/README.md |
| RCV-G1 | AG | Receiving | Receipt-history read | design_handoff_receiving/README.md |
| RCV-G2 | AG | Receiving | RO numbering authority | design_handoff_receiving/README.md |
| RCV-D1 | PD | Receiving | One queue vs two journeys | design_handoff_receiving/README.md |
| SA-G1…G3 | AG | Sales Agreement | Agreement lifecycle gaps | design_handoff_sales_agreement/README.md |
| OPP-G1…G5 | AG/WG | Opportunity list | Agreement/Order downstream column gaps | design_handoff_opportunity_workspace/README.md |
| EQ-G5 | AG | Equipment | Operating-company seam | design_handoff_equipment/README.md |
| DB-D1, DB-D2 | PD | Dispatch Board | Named with honest interim renderings | design_handoff_dispatch_board/README.md |
| SO-D1, SO-D4 | PD | Service Operations | Panel/queue decisions named for Owner | design_handoff_service_operations/README.md |
| FIN AG ×15 | AG | Financials | Canonical authority-gap register | design_handoff_financials/FINANCIALS-NORTH-STAR-P1-DESIGN-REVIEW-PACKAGE.md |
| FIN PQ ×13 | PD | Financials | Product-question register | same |
| FIN DG ×3 | DG | Financials | Design gaps | same |
| KEY-B1…B3 | PD | Keystone | Backlog decisions | design_handoff_keystone/README.md |
| B1, B2 | PD | Work Order | Original named backlog items | design_handoff_work_order/README.md |

## New in P2
| Id | Type | One-line | Status |
|---|---|---|---|
| P2-G1 | MC | Global search/findability model (NS2-PLT-05) — no read or capability exists | OPEN |
| P2-G2 | WG | Technician mobile day flow never grounded against registry (TEC-01) | OPEN |
| P2-G3 | AG | Purchasing surface (PUR-01) has no audited command/read set in this project | OPEN |
| P2-G4 | AG | Transfers/truck custody model (INV-05) unverified against current EOS | OPEN |
| P2-G6 | AG | OD-6 person-state reads (former / unresolved / unavailable) pending; OD-7 architectural boundary SETTLED 2026-09-13 — workflow-specific handoff semantics remain per-workflow hypotheses | PARTIAL |
| P2-G5 | AG | EMPLOYEE OPERATING MODEL DEFINED — RUNTIME SUPPORT NOT YET DELIVERED: canonical Employee authority, accountable-person persistence, authoritative person resolution, governed responsibility commands, responsibility reads/projections, census/integrity, handoff orchestration, person-state enforcement, governed role-shaped queues. Classification: MODEL EXISTS, IMPLEMENTATION/AUTHORITY GAP REMAINS | OPEN (runtime) |

Baseline note: all carried P1 gap findings are code-derived claims observed on/before ATLAS-BASE-2026-09-10-A (ns2/ATLAS-OBSERVATION-BASE.md); main has advanced since — every carried gap is OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN until re-read at a pinned baseline.

Rule: no gap closes by design polish. A gap closes only by CURRENT EOS evidence (merged authority) or OWNER RULING, recorded here with date.
