# UAT — Supplier Administration + Operational Billing Package

Recorded 2026-10-02 (DECISIONS #196). The proofs come from three suites against real PostgreSQL, plus one client suite:

- `functions/test/supplierAdministrationPostgres.test.mjs`
- `functions/test/financeBillingPackagePostgres.test.mjs`
- `field-ops-app-vite/test/supplierAdministrationPanel.test.jsx`

All data is SAMPLE/UAT.

## Supplier administration

| ID | Scenario | Result |
|---|---|---|
| UAT-SUP-001 | Supplier creation | **PASS.** Offered organizations are ACTIVE, governed as VENDOR, and have no supplier yet; they are picked by name. `sup-arcticparts` (administrator) and `sup-coldchain` (Parts Manager) are created. The supplier's name comes from the organization and the normalized key is the Supplier Master's. The creation is audited, and a replay returns `replayed`. |
| UAT-SUP-002 | Duplicate / invalid organization | **PASS (refused).** A second supplier for the same organization is refused, and so is a taken id for a different organization. An unknown organization, a customer-only organization and an inactive organization are all refused, as is a typed `name`. |
| UAT-SUP-003 | New PO with a governed supplier | **PASS.** The PO stores the identity and the server writes its name. Operational fields update with optimistic concurrency, and the organization link cannot be changed. |
| UAT-SUP-004 | Supplier deactivation | **PASS.** A Parts Manager without `inventory.catalog.activate` is refused. When the administrator deactivates a supplier, it disappears from the PO options and can't be named on a new PO. The historical PO stays readable and the supplier record is never deleted. Reactivation restores it. |
| UAT-SUP-005 | Unauthorized supplier administration | **PASS.** The Parts Associate and the Technician are refused create, status change and the organization list. An Administration grant of `inventory.catalog.activate` lets a Role change status, and a revoke removes that, with no source edit. |

## Operational Billing Package

| ID | Scenario | Result |
|---|---|---|
| UAT-FIN-BPK-001 | Direct-sale Billing Package | **PASS.** One INSTALL Work Order covers Equipment (serial), Parts and the install line, and completion produces one READY package, version 1. Lines: 500000 + 2 × 2500 + 30000. Subtotal 535000, shipping 5000, install 0, tax 4100, total 544100, down payment 10000, balance 534100. Company is `taylor`, customer `acct-r`, counterparty the customer's EXTERNAL_ORGANIZATION (DIRECT_SALE_CUSTOMER). Lineage reaches fulfillment, Work Order, serial, Sales Order line, Agreement and customer. No invoice, receivable, posting or delivery is created. |
| UAT-FIN-BPK-002 | Replay | **PASS.** The same package is returned, and recovery finds nothing to do. Package and line content can't be updated or deleted. |
| UAT-FIN-BPK-003 | Non-eligible sale | **PASS.** Outcome NOT_ELIGIBLE / NOT_YET, and no package is created. |
| UAT-FIN-BPK-004 | Partial eligibility | **PASS.** Outcome NOT_ELIGIBLE / PARTIALLY_ELIGIBLE, and no package is created (partial billing is deferred). |
| UAT-FIN-BPK-005 | Missing tax evidence | **PASS.** The package is HELD with [TAX_EVIDENCE_MISSING] and a NULL total, never zero. Once the governed tax is provided, re-evaluation writes version 2 as READY (total 32460); version 1 becomes SUPERSEDED with its content unchanged. A direct order, which has no tax source, is HELD. |
| UAT-FIN-BPK-006 | Missing price | **PASS.** The package is HELD with [PRICE_EVIDENCE_MISSING], and subtotal, total and the line's extended amount are NULL. |
| UAT-FIN-BPK-007 | Financed-sale refusal | **PASS.** A LEASE disposition is HELD with [FINANCED_DISPOSITION_UNSUPPORTED]. The counterparty is NULL and the obligor UNRESOLVED; it is never billed to the customer as a direct sale. |
| UAT-FIN-BPK-008 | Wrong company | **PASS (fail closed).** An unbound company and CONSOLIDATED are both refused, and no package is written. Any source other than a Sales Order (for example Rental) is refused by the schema. |
| UAT-FIN-BPK-009 | Unauthorized package manufacture | **PASS.** No operation exists to create a package (UNKNOWN_OPERATION). A READY row with totals that don't reconcile, or without a counterparty, is refused. Salesperson, technician and dispatcher hold no finance execution right. |

## Held

- **AR obligation:** the originating event is not ruled, so this needs an Owner ruling.
- **Partial-billing policy:** deferred.
- **Financed / Saratoga marker:** not yet represented in PostgreSQL Commercial.
- **Commercial tax determination authority:** the tax value is an Agreement input.
- **Later packages:** VOID / SENT / ACKNOWLEDGED, the outbox, and the provider adapter.
