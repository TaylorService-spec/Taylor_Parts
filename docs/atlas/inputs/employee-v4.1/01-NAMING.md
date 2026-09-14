# NS2 Naming System
Purpose: every P2 artifact carries an NS2 identity so the P2 corpus can be pulled, listed, zipped, and dispositioned independently of everything made before it. P1-era files are never renamed — they stay in place as archaeology input. Atlas is the process name only (ATLAS-CHARTER-v2.md §5): NS2-* ids remain the stable identifiers; no Atlas-driven mass rename.

## Identity
`NS2-<DOMAIN>-<NN>` — stable page/surface id. Never reused, never renumbered.
- Design file: `NS2-INV-04 Cycle Counts r1.dc.html` (revision suffix r1, r2… ; a new revision is a new file, prior kept)
- Page doc: `ns2/pages/NS2-INV-04-cycle-counts.md`
- Handoff: `design_handoff_ns2_<family>/`
- Gap/decision ids inside a family keep their established prefixes (CC-, RCV-, SA-…) and are indexed in 05/06.
- Approved reference frame (§27 / charter A8): `<NS2 id>-<width>`, e.g. `NS2-SVC-03-1440`, `NS2-SVC-03-1024`, `NS2-SVC-03-375`. Frames are named at Owner approval, listed in the family's handoff README, and are the visual-acceptance comparison targets at matching viewports.

## Domain codes
| Code | Domain | | Code | Domain |
|---|---|---|---|---|
| HOME | Role dashboards / My Dashboard | | FIN | Financials |
| EMP | Employee work & responsibility | | | |
| SVC | Service operations & work orders | | RPT | Reporting |
| DSP | Dispatch / scheduling | | ADM | Administration |
| TEC | Technician field (mobile) | | INB | Inbound work / VDX — Verenward Data Exchange |
| CRM | Accounts / customers | | PLT | Platform (Keystone, search, shell) |
| SLS | Sales (opportunity→agreement→order) | | LST | Cross-cutting list/collection grammar |
| EQP | Equipment | | PUR | Purchasing |
| INV | Inventory (parts, counts, trucks) | | WHS | Warehouse & receiving |

## Migration map (P1 corpus → NS2 identity)
Disposition column is the §20 archaeology verdict to be made when the family is opened in P2; PENDING until then.

| NS2 id | Surface | P1 source of record | Disposition |
|---|---|---|---|
| NS2-HOME-01 | My Dashboard (7 personas) | North Star - My Dashboard P1v2 ×3 files | PENDING |
| NS2-SVC-01 | Service Operations overview | North Star - Service Operations P1 | PENDING |
| NS2-SVC-02 | Work Orders list | North Star - Lists P2 (WO study) | PENDING |
| NS2-SVC-03 | Work Order record | North Star - Work Order | PENDING |
| NS2-DSP-01 | Dispatch Board | North Star - Dispatch Board P1 | PENDING |
| NS2-DSP-02 | Dispatch Map | Proposed - Dispatch Map.html | PENDING (never North-Starred) |
| NS2-TEC-01 | Technician mobile day | Proposed - Technician Mobile | PENDING (never North-Starred) |
| NS2-CRM-01 | Customers list | Proposed - Customers List | PENDING |
| NS2-CRM-02 | Account record | North Star - Account P1 | PENDING |
| NS2-SLS-01 | Opportunities workspace/list | North Star - Opportunity List P1v4 | PENDING |
| NS2-SLS-02 | Opportunity record | North Star - Opportunity P1v2 | PENDING |
| NS2-SLS-03 | Sales Agreement record | North Star - Sales Agreement P1 | PENDING |
| NS2-SLS-04 | Sales Orders workspace | North Star - Sales Orders Workspace P1 | PENDING |
| NS2-SLS-05 | Sales Order record | North Star - Sales Order P1 | PENDING |
| NS2-SLS-06 | Sales dashboard | North Star - Sales Dashboard | PENDING |
| NS2-EQP-01 | Equipment workspace + record | North Star - Equipment P1v2 | PENDING |
| NS2-INV-01 | Inventory dashboard | North Star - Inventory Dashboard | PENDING |
| NS2-INV-02 | Parts workspace | North Star - Parts P1v2 | PENDING |
| NS2-INV-03 | Part record | North Star - Parts P1v2 | PENDING |
| NS2-INV-04 | Cycle Counts | North Star - Cycle Counts P1v2 | PENDING — mature prior design exists (Owner-approved 2026-09-10) |
| NS2-INV-05 | Transfers & trucks | Proposed - Transfers Trucks | PENDING (never North-Starred) |
| NS2-WHS-01 | Receiving | North Star - Receiving P1 | PENDING |
| NS2-WHS-02 | Warehouse mobile | Proposed - Warehouse Mobile | PENDING (never North-Starred) |
| NS2-PUR-01 | Purchasing workspace | Proposed - Purchasing | PENDING (never North-Starred) |
| NS2-FIN-01…20 | Financials 01–20 | North Star - Financials 01–20 | PENDING (numbering carried over) |
| NS2-RPT-01 | Reporting | Proposed - Reporting | PENDING (never North-Starred) |
| NS2-ADM-01…04 | People & Access / Company Setup / Platform / Objects | Proposed - Administration | PENDING (grouping is a §8 hypothesis) |
| NS2-INB-01…05 | VDX overview/runs/exceptions/migration/wizard (HISTORIC TERM: KDX — now VDX) | KDX North Star P1v2 + P2 files (historical names kept) | PENDING |
| NS2-PLT-01…04 | Keystone shell/VDX/Verity/admin | North Star - Keystone ×4 | PENDING |
| NS2-PLT-05 | Global search / findability | — | ADD (output O, not yet designed) |
| NS2-LST-00 | Collection grammar + 17-state system | North Star - Lists P2 | PENDING — mature prior design exists (pattern library) |

Superseded/retained-only artifacts (Lists P1, Opportunity Workspace P1, Cycle Counts P1, Equipment P1, KDX P1v1, Current -*, Before-After ×5, Broadsheet option files) receive no NS2 id; they remain archaeology evidence.
