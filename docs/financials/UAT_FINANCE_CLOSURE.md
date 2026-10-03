# UAT — Finance Closure (DECISIONS #206, roadmap Package A)

Recorded 2026-10-03. The local proofs come from `functions/test/financeClosurePostgres.test.mjs` and
`functions/test/financeFinancedSalePostgres.test.mjs`. They run over the real governed Commercial, Work Order, Reorder → PO
→ Receipt and Finance paths, on the real transports, against PostgreSQL. All data is SAMPLE/UAT. The nonprod evidence is
appended below once the package is deployed.

| # | Proof | Result |
|---|---|---|
| AUTH | Authority separation (A13) | **PASS.** `finance.settlement.record` / `.apply` / `.correct` and `finance.reconciliation.record` are distinct capabilities. They are held by owner, generalManager, controller, accountingManager and financeManager, and not by admin, Sales or Technician. Viewing is `finance.payment.read`. A viewer without a settlement capability is refused each command (403). |
| DS | Direct sale | **PASS.** Package → RECEIVABLE → handoff, then a partial payment and a second payment, ending SETTLED. Over-application is refused. |
| MANY | Many-to-many | **PASS.** One payment is applied across two receivables of one customer, and the unapplied remainder is derived. Application beyond the payment is refused. |
| FIN | Financed sale (#200 / #201) | **PASS.** Discount + approved trade-in + cash, then entitlement and FUNDING_RECEIVABLE. A manual FUNDED transition is refused (FUNDING_NOT_RECEIVED). Provider funding from the FINANCING_PROVIDER, fully applied, moves the arrangement to FUNDED in the same transaction. The customer contribution is a separate RECEIVABLE with its own settlement. No trade-in becomes a settlement. |
| PUR | Vendor payable | **PASS.** A priced external receipt opens one PAYABLE toward the supplier organization at the receipt's business date, due by governed NET days, plus a VENDOR_PAYABLE handoff. A vendor payment settles it. |
| F4 | Late cost evidence (FBR-F4) | **PASS.** An unpriced receipt opens an exception and no payable. Governed late cost evidence writes a supply record and an exception resolution, and then the PAYABLE exactly once. The receipt is not rewritten, and a second supply is refused. |
| IC | Intercompany (FBR-F1 / F3) | **PASS.** Ventana → Taylor creates paired obligations and two company-side handoffs, each to its own destination and acknowledged with its own reference, never netted. The Ventana relief (INTERCOMPANY_SALE_RELIEF on Ventana's ledger) happens once. Relief is refused from Taylor's warehouse record, refused outside the operator's warehouse scope, and refused a second time (no double decrement). An intercompany payment and receipt settle each side separately. |
| IC + F4 | Unpriced intercompany receipt | **PASS.** The receipt is held at COST_EVIDENCE_MISSING. Late cost evidence then establishes the pair and both handoffs exactly once. |
| F2 | Taylor service for a Ventana sale | **PASS.** Without authorization, SALES_ORDER_COMPANY_MISMATCH. Once Ventana authorizes Taylor for INSTALLATION, a Taylor INSTALL Work Order is accepted. The fulfillment keeps seller `ventana` and records service company `taylor`, and the billing package and receivable stay Ventana's. Once revoked, the order is refused again, and the history is kept. |
| CORR | Correction | **PASS.** Reverse restores the balance, and the application can be re-applied. Void is refused while applications are live. Void then replace works once; a second replacement is refused. |
| RECON | Reconciliation | **PASS.** RECONCILED when the amounts agree. MISMATCH otherwise, which requires a reason. A VOID settlement is not reconciled. |
| NEG | Refusals | **PASS.** Wrong company, wrong currency, wrong counterparty, wrong kind, a future business date and CONSOLIDATED recording are all refused, at the command and in the database. |
| WS | Finance workspace | **PASS.** Per company, plus the CONSOLIDATED projection, which cannot record anything. The workspace is exception-first, and drill-through reaches an obligation with its facts and applications. Sales and Technicians cannot read it. |

## Not built (recorded, not invented)

GL, banking integration, a real accounting provider, AP bill entry, three-way match, payment runs, netting, elimination,
and intercompany SERVICE charges (Taylor billing Ventana for service is not ruled).
