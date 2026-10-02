# UAT — Finance Activation 2: Operational Receivable, Tax Evidence, Accounting Handoff

Recorded 2026-10-02 (DECISIONS #197). These are **local** proofs from two suites against real PostgreSQL:

- `functions/test/financeReceivableHandoffPostgres.test.mjs`
- `functions/test/financeBillingPackagePostgres.test.mjs`

All data is SAMPLE/UAT.

| ID | Scenario | Result |
|---|---|---|
| UAT-FIN-AR-001 | Direct sale → READY package → receivable | **PASS.** One RECEIVABLE is created for `taylor` toward the customer's EXTERNAL_ORGANIZATION counterparty, in USD. Its amount equals the package total (37460), and the balance is originated 37460 / settled 0 / outstanding 37460. The only fact is the foundation's `RECEIVABLE_ORIGINATED` (correlation = the Sales Order). No invoice, revenue or GL fact is created. |
| UAT-FIN-AR-002 | Explicit zero tax | **PASS.** An Agreement with `{ DETERMINED, 0, USD }` stores status DETERMINED with tax 0, and its package is READY with tax 0. |
| UAT-FIN-AR-003 | Positive determined tax | **PASS.** An Agreement with `{ DETERMINED, 2460, USD }` produces a READY package. |
| UAT-FIN-AR-004 | Tax not determined | **PASS.** Omitted tax, or a bare `taxMinor`, is NOT_DETERMINED, even though the writer stores 0. The package is HELD with [TAX_NOT_DETERMINED] and its tax and total are NULL. No receivable is created. |
| UAT-FIN-AR-005 | Package replay | **PASS.** The package replays as `replayed` with the same receivable. A Work Order completion replay gets 409. Recovery establishes nothing. There is exactly one obligation, one handoff and one fact, and the database refuses a second receivable. |
| UAT-FIN-AR-006 | Unsupported financed sale | **PASS.** A LEASE disposition is HELD with [UNSUPPORTED_FINANCIAL_OBLIGOR], and no customer receivable is created. Establishing one is refused (BILLING_PACKAGE_NOT_READY). No receivable exists from Rental or any other source. |
| UAT-FIN-AR-007 | Missing accounting destination | **PASS.** The receivable stands. The handoff is PENDING_DESTINATION with [ACCOUNTING_DESTINATION_MISSING], and its provider reference, acknowledgement and failure columns are empty. |
| UAT-FIN-AR-008 | Configured company destination | **PASS.** Configuring Taylor's destination attaches it to the pending handoff, which moves to READY_FOR_DELIVERY. A new Taylor package is READY_FOR_DELIVERY at once. A Ventana package uses Ventana's own destination, distinct from Taylor's. Nothing is sent. |
| UAT-FIN-AR-009 | Unauthorized receivable manufacture | **PASS.** No operation exists to create one (UNKNOWN_OPERATION). The handoff's identity can't be changed, and a provider reference can't be written. Salesperson, salesManager and technician hold no Finance write. |
| UAT-FIN-AR-010 | Legacy ambiguous zero | **PASS.** A pre-evidence Agreement is LEGACY_UNVERIFIED with tax 0; its package is HELD with [TAX_NOT_DETERMINED] and records `tax_evidence_status = LEGACY_UNVERIFIED`. |
| UAT-FIN-AR-011 | Tax evidence validation | **PASS.** A negative or fractional amount, a missing amount and an unknown status are all refused (TAX_EVIDENCE_INVALID). A non-USD currency is refused (TAX_CURRENCY_MISMATCH), and the database also refuses it. A disagreeing bare `taxMinor` is refused (TAX_EVIDENCE_CONFLICT). A changed bare amount on a draft resets the status to NOT_DETERMINED. |
| UAT-FIN-AR-012 | Package supersession | **PASS.** The superseded version's receivable is VOID, with its origination kept and an equal reversal fact (net 0). The new version has its own OPEN receivable (12500), and the old handoff is SUPERSEDED. |
| UAT-FIN-AR-013 | Pre-evidence READY package (Controller correction) | **PASS.** A package that was READY under the pre-evidence rules (no tax-evidence state) is SKIPPED by recovery, and establishing a receivable from it is refused (TAX_NOT_DETERMINED). The row stays unchanged and no evidence is fabricated. A current DETERMINED package whose receivable is missing is recovered exactly once. |
| UAT-FIN-AR-014 | Wrong company / CONSOLIDATED | **PASS (fail closed).** OPERATING_COMPANY_UNRESOLVED and CONSOLIDATED_NOT_A_COMPANY. |

## Dependencies

- **Delivery:** the delivery adapter, attempts, provider acknowledgement and document reference (columns reserved).
- **Settlement:** settlement / payment.
- **Broader package corrections:** VOID / reissue beyond supersession.
- **Tax source:** the tax source itself; tax evidence is recorded, never calculated.
- **Financed / intercompany:** a financed-sale (Saratoga) marker and intercompany sales.
- **Partial billing:** partial-billing policy.
