# NS2-EQP-01 — Equipment Workspace + Record
P1 source: North Star - Equipment P1v2.1 (design locked 2026-08-30) + design_handoff_equipment/.

**What it does.** Installed-base truth: what equipment exists, where, in what status, warranty position, service timeline. Workspace keeps the three-tab shape in the Lists grammar (Customer / Available / Register); record shows asset identity chain (asset → Part → model → manufacturer, governed line-mapping composition), status runtime model, timeline.

**Roles.** Service Coordinator (locate unit for a WO), Technician (unit at the job), Salesperson (install-base context for opportunities), Warehouse (available units, Add existing unit via WHS-01 journey).

**Record layout schema**
```
[Identity chain + status + location ("Location        ]
[unavailable" when unresolved — standard copy)        ]
[Warranty (warrantyExpiresDate) | Service timeline    ]
[Related: account, location, WOs, sales order origin  ]
```
**Role interaction.** Governed install confirmation flow; status transitions per equipmentStatus.js runtime models (EQ-G1/G2 corrected). Cross-links: WO consumption, account record.

**Standing rulings.** Stale P1 DENIED language kept only as annotated provenance; EQ-G5 operating-company seam rendered.
**Sources.** field-ops-app-vite/src/modules/equipment/*, equipmentTimelineView.js, installedEquipmentListView.js.


OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN (see ns2/ATLAS-OBSERVATION-BASE.md — seeded from findings at/before ATLAS-BASE-2026-09-10-A).
