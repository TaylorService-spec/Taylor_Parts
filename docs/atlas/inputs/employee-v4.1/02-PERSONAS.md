# NS2 Persona / Responsibility Map
Source: Owner brief Layer 4 + My Dashboard P1v2 census (docs/assessments/eos-dashboard-reporting-authority-census.md). Width never changes authority.

| Persona | Owns | Sees daily | May interrupt them | Home | Primary surfaces |
|---|---|---|---|---|---|
| Owner / GM | Whole-business outcomes | Sales vs goal, service health, AR/cash, inventory health, exceptions needing intervention | Owner-escalations only | NS2-HOME-01 (Owner) | FIN-01/08, SVC-01, INV-01 |
| Dispatcher / Service Coordinator | Today's schedule | Ready-to-schedule, late/unscheduled, capacity, conflicts, parts-blocked | Schedule conflicts, technician outages | NS2-HOME-01 (Dispatcher) | DSP-01, SVC-02/03 |
| Technician | Assigned jobs, own truck | Next job, today's route, readiness/required parts | Job change, parts arrival, safety | NS2-HOME-01 (Technician, phone-first) | TEC-01, SVC-03, INV-04 (truck counts) |
| Parts Associate | Pick/receive/count execution | Shortages blocking service, receipts due, count sheets | Service-impacting shortage | NS2-HOME-01 (Parts) | INV-02/03/04, WHS-01/02 |
| Parts Manager | Inventory accuracy & replenishment | Reorder work, cycle-count exceptions, unexplained loss | Count variances, stockouts | NS2-HOME-01 (Parts) | INV-01/02/04, PUR-01 |
| Warehouse Manager | Warehouse custody & movement | Receipts, transfers, truck stock | Receiving exceptions, custody breaks | NS2-HOME-01 (Parts) | WHS-01/02, INV-05 |
| Purchasing | Supply commitments | POs open, arrivals, supplier exceptions | Partial receipt, substitution | NS2-HOME-01 (Parts) | PUR-01, WHS-01, INV-03 |
| Salesperson | Own pipeline & won-work follow-up | My $ vs goal, pipeline needing action, stale opps | Customer response, won-work blockers | NS2-HOME-01 (Sales) | SLS-01/02/03, CRM-02 |
| Sales Manager | Team pipeline & goals | Company $, team pipeline, agreements pending | Approval requests | NS2-HOME-01 (Sales) | SLS-06, SLS-01, FIN-08 |
| Finance | Billing, AR, cash application | Billing queue, AR aging, payments, unapplied cash, reconciliation exceptions | Payment exceptions, period close | NS2-HOME-01 (Finance, capability-gated) | FIN-02…07, FIN-16 |
| Administrator | Access, objects, policy | Access changes, policy questions, object governance | Security events, denied-access reports | ADM-01 | ADM-01…04 |
| Reporting / Management | Cross-cutting analysis | Defined reports, exports | — (pull, not push) | RPT-01 | RPT-01, FIN-14/15/19 |

Rules: a role never sees the whole application merely because EOS contains it; navigation is role-shaped (03-IA.md); interrupts limited to the column above — everything else is queue/attention-panel material, never modal.
