# UAT — Governed configuration + commercial pricing (DECISIONS #203)

Recorded 2026-10-02. These are **local** proofs only, from `functions/test/governedConfigSalesPricingPostgres.test.mjs` (real PostgreSQL, the real Administration dispatcher `executeAdminOperation`, the real Commercial / CRM / Finance commands), `field-ops-app-vite/test/salesAgreementPricingComposition.test.jsx` and `field-ops-app-vite/test/financeConfigurationAdministration.test.jsx`. All data is SAMPLE/UAT. Nothing is pushed or deployed, and nonprod is untouched.

Amounts are in minor units, so 40000 shows the Controller's 40000 example.

| # | Proof | Result |
|---|---|---|
| A / B | FINANCING_PROVIDER | **PASS.** A salesperson holding only customer create/update can't set the relationship (CAPABILITY_REQUIRED) on create or update. With `customer.governedField.write`, VENDOR + FINANCING_PROVIDER is stored: VENDOR is kept and CUSTOMER is not implied. Finance accepts the governed provider (APPLIED) and refuses an ordinary organization. Removing the relationship while an arrangement names the provider is refused (FINANCING_PROVIDER_IN_USE). |
| C / I | Business time zones through Administration | **PASS.** Taylor and Ventana are set to America/Phoenix. An unknown zone (Mars/Olympus) is refused. |
| D / E | Business date versus timestamp | **PASS.** The resolver returns 2026-10-02 for 2026-10-03 04:40 UTC and 2026-10-03 for 07:00 UTC. The receipt keeps its UTC timestamp 2026-10-03T04:40:00Z. |
| F | NET 90 | **PASS.** That receipt's intercompany correlation has obligation date 2026-10-02, 90 net days, due 2026-12-31 and status ESTABLISHED. Both paired obligations are due 2026-12-31. |
| J | Terms govern future obligations only | **PASS.** Changing the terms to NET 60 leaves the existing due dates at 2026-12-31. The next receipt (business date 2026-10-05) is due 2026-12-04. |
| G / H | Accounting destinations through Administration | **PASS.** A principal without `finance.configuration.manage` is refused, as is a change with no reason. CONSOLIDATED can't own a destination. Activating B steps A down to INACTIVE (kept); Ventana's destination is separate. Re-activation and deactivation work, deactivation leaves zero ACTIVE, and every change is audited. |
| G (handoffs) | Re-pointing | **PASS.** A handoff with a FAILED_RETRYABLE attempt keeps its destination. The untouched READY handoff follows the newly active destination, and Administration reports the re-pointed count. |
| K / L / M / N | Customer discount | **PASS.** 5.25% of 400.00 = 21.00, and the net selling price is 379.00. FIXED_AMOUNT 20.00 gives a net of 380.00 while the line price stays 400.00. Half-up rounding holds at the edges. Exceeding the selling price, more than 100% and fractional basis points are refused; clearing works. |
| O / Q / R / T / U | Trade-in | **PASS.** 40000 − 2000 = 38000 net; − 5000 trade-in − 3000 cash = 30000 remaining. The trade-in is not part of the discount. Provenance is recorded: description, manufacturer, model, serial, credit, receiving company taylor, status AGREED. An unknown identity stays null. A conflicting scalar trade-in is refused (TRADE_IN_CONFLICT). |
| S / Z / P / AB | Financed composition | **PASS.** The package is READY: subtotal 40000, discount 2000, total 38000, trade-in 5000, cash 3000, financed 30000. Finance creates FUNDING_RECEIVABLE 30000 (provider) and RECEIVABLE 3000 (customer); the trade-in creates no receivable. The v2 handoff carries `tradeInCreditMinor` 5000, total 38000 and discount 2000. |
| Y / AB | Direct sales | **PASS.** With a discount, the receivable is 38000. With a trade-in, it is 40000 − 5000 = 35000, and the v1 payload has the same shape (no discount key). A plain sale is exactly as before. |
| V / W / X | Independent values | **PASS.** A used unit bought for 4000 has acquisition evidence of 4000. Selling it needs an explicit price, and nothing defaults from 4000 or from the 5000 credit. The trade-in credit stays 5000. |
| AC | Static | **PASS.** No pricing path reads an acquisition value or a trade-in credit into a price. Finance/Commercial name no business zone. The new modules don't reference Firebase. |
| — | Customer-facing | **PASS (client).** The Agreement shows Selling price, Customer discount, Net selling price, Trade-in credit, Cash / down payment and Remaining balance. No enum, cost or margin appears. A percent is entered as 5.25 and sent as 525 basis points. |
| — | Administration screen | **PASS (client).** It lists destinations (including history), terms and zones. Each change carries its reason, and the server's refusal is rendered. |

**Finance preserved:** the financed-sale, accounting-delivery, billing-package, receivable-handoff, intercompany and read-projection suites all pass. The one intended change is the financed trade-in: the R proof now expects the governed trade-in, financed 30000.
