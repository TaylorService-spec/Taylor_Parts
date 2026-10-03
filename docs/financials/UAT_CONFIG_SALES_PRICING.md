# UAT — Governed configuration + commercial pricing (DECISIONS #203)

Recorded 2026-10-02. These are **local** proofs only, from `functions/test/governedConfigSalesPricingPostgres.test.mjs` (real PostgreSQL, the real Administration dispatcher `executeAdminOperation`, the real Commercial / CRM / Finance commands), `field-ops-app-vite/test/salesAgreementPricingComposition.test.jsx` and `field-ops-app-vite/test/financeConfigurationAdministration.test.jsx`. All data is SAMPLE/UAT. Nothing is pushed or deployed, and nonprod is untouched.

Amounts are in minor units, so 40000 shows the Controller's 40000 example.

| # | Proof | Result |
|---|---|---|
| A / B | FINANCING_PROVIDER | **PASS.** A salesperson holding only customer create/update can't set the relationship (CAPABILITY_REQUIRED) on create or update. With `customer.governedField.write`, VENDOR + FINANCING_PROVIDER is stored: VENDOR is kept and CUSTOMER is not implied. Finance accepts the governed provider (APPLIED) and refuses an ordinary organization. Removing the relationship while an arrangement names the provider is refused (FINANCING_PROVIDER_IN_USE). |
| C / I | Business time zones through Administration | **PASS** (moved to System Configuration by #204 — see H / I below). Taylor and Ventana are set to America/Phoenix. An unknown zone (Mars/Olympus) is refused. |
| D / E | Business date versus timestamp | **PASS.** The resolver returns 2026-10-02 for 2026-10-03 04:40 UTC and 2026-10-03 for 07:00 UTC. The receipt keeps its UTC timestamp 2026-10-03T04:40:00Z. |
| F | NET 90 | **PASS.** That receipt's intercompany correlation has obligation date 2026-10-02, 90 net days, due 2026-12-31 and status ESTABLISHED. Both paired obligations are due 2026-12-31. |
| J | Terms govern future obligations only | **PASS.** Changing the terms to NET 60 leaves the existing due dates at 2026-12-31. The next receipt (business date 2026-10-05) is due 2026-12-04. |
| G / H | Accounting destinations through Administration | **PASS.** A principal without `finance.configuration.manage` is refused, as is a change with no reason. CONSOLIDATED can't own a destination. Activating B steps A down to INACTIVE (kept); Ventana's destination is separate. Re-activation and deactivation work, deactivation leaves zero ACTIVE, and every change is audited. |
| G (handoffs) | Re-pointing | **PASS.** A handoff with a FAILED_RETRYABLE attempt keeps its destination. The untouched READY handoff follows the newly active destination, and Administration reports the re-pointed count. |
| K / L / M / N | Customer discount | **PASS.** 5.25% of 400.00 = 21.00, and the net selling price is 379.00. FIXED_AMOUNT 20.00 gives a net of 380.00 while the line price stays 400.00. Half-up rounding holds at the edges. Exceeding the selling price, more than 100% and fractional basis points are refused; clearing works. |
| O / Q / R / T / U | Trade-in | **PASS.** 40000 − 2000 = 38000 net; − 5000 trade-in − 3000 cash = 30000 remaining. The trade-in is not part of the discount. Provenance is recorded: description, manufacturer, model, serial, credit, receiving company taylor, status AGREED. An unknown identity stays null. **Superseded by #204:** the credit is now the APPROVED value, and a client-stated credit is refused (TRADE_IN_REQUIRES_APPROVAL). |
| S / Z / P / AB | Financed composition | **PASS.** The package is READY: subtotal 40000, discount 2000, total 38000, trade-in 5000, cash 3000, financed 30000. Finance creates FUNDING_RECEIVABLE 30000 (provider) and RECEIVABLE 3000 (customer); the trade-in creates no receivable. The v2 handoff carries `tradeInCreditMinor` 5000, total 38000 and discount 2000. |
| Y / AB | Direct sales | **PASS.** With a discount, the receivable is 38000. With a trade-in, it is 40000 − 5000 = 35000, and the v1 payload has the same shape (no discount key). A plain sale is exactly as before. |
| V / W / X | Independent values | **PASS.** A used unit bought for 4000 has acquisition evidence of 4000. Selling it needs an explicit price, and nothing defaults from 4000 or from the 5000 credit. The trade-in credit stays 5000. |
| AC | Static | **PASS.** No pricing path reads an acquisition value or a trade-in credit into a price. Finance/Commercial name no business zone. The new modules don't reference Firebase. |
| — | Customer-facing | **PASS (client).** The Agreement shows Selling price, Customer discount, Net selling price, Trade-in credit, Cash / down payment and Remaining balance. No enum, cost or margin appears. A percent is entered as 5.25 and sent as 525 basis points. |
| — | Administration screen | **PASS (client).** It lists destinations (including history), terms and zones. Each change carries its reason, and the server's refusal is rendered. |

**Finance preserved:** the financed-sale, accounting-delivery, billing-package, receivable-handoff, intercompany and read-projection suites all pass. The one intended change is the financed trade-in: the R proof now expects the governed trade-in, financed 30000.

## Owner rulings #204 — configuration authority, discount authority, trade-in approval

These are local proofs, from the same PostgreSQL suite: its `#204` subtests plus the rewritten #203 subtests. The client tests are `systemSalesConfigurationAdministration.test.jsx` and `salesAgreementTradeInApproval.test.jsx`. Trade-in values in the proofs are minor units.

| # | Proof | Result |
|---|---|---|
| A | `finance.configuration.manage` is assignable through Administration | **PASS.** The migration writes exactly the 11 ruled (capability, Security Role) pairs. The capability appears under `financeConfiguration` in the Object security matrix (the Roles & Permissions checkbox). A new Role is granted it, and its holder can then use it. |
| B–E | Owner / GM / Finance / System Administrator | **PASS.** `owner`, `generalManager`, `controller` and `admin` holders each read Finance configuration. A Parts Associate cannot. |
| F | Revocation | **PASS.** Revoking it through Administration removes the delegate's configuration authority. |
| G / AA | System Administrator is not an approver | **PASS.** `admin` holds no `salesAgreement.tradeIn.approve`, and its approve attempt is refused (CAPABILITY_REQUIRED). |
| H / I | Time zone and language through System Configuration | **PASS.** Taylor and Ventana are set to America/Phoenix. Ventana's language changes from the en-US default to es-US. Taylor's unset language reads "en-US (default)". Each change is audited with before, after and actor. |
| J | Invalid values refused | **PASS.** These are refused: Mars/Olympus, `xx-ZZ`, `english`, an unknown setting key, and a change with no reason. The database also refuses an unsupported language. Finance / Accounting cannot read System Configuration. |
| K / L | Individual maximum, set by an authority | **PASS.** The GM sets the seller to 10%. The audit records the user, previous NOT_CONFIGURED, new 1000 bp, actor, time and reason (correlated to its request). Owner, Controller and Administrator can also manage limits. Values above 100% are refused. |
| M | No self-raise | **PASS.** The seller's own attempt to set their limit is refused. |
| N / O / P | Percentage | **PASS.** 5.25% and exactly 10% are accepted; 10.01% is refused (DISCOUNT_EXCEEDS_AUTHORITY). |
| Q / R | Fixed amount, 10% of 40000 | **PASS.** 3500 and 4000 are accepted; 4001 and 5000 are refused. Lowering the selling price under a standing 4000 fixed discount (to 30000) is refused, as is a 15% update. |
| S / T | 0% and missing | **PASS.** 0% is listed as CONFIGURED 0 and admits no discount. A missing limit is listed as NOT_CONFIGURED and refused (DISCOUNT_AUTHORITY_NOT_CONFIGURED); it never means unlimited. A sale with no discount needs no authority. |
| U / V | Proposal reduces nothing | **PASS.** The proposal (5500, with notes and evidence) leaves the balance at 35000 and trade-in credit at 0. Neither a bare `tradeInMinor` nor an item `creditMinor` can be stated (TRADE_IN_REQUIRES_APPROVAL). Acceptance waits for the decision (TRADE_IN_APPROVAL_PENDING). |
| W / X | Owner and GM approve | **PASS.** The Owner approves at 5000, assigning the value (proposed 5500). The GM approves a 6000 proposal at 5000. The GM declines another item with a reason; a decline without a reason is refused. A decided item cannot be decided again. |
| Y / Z | Salesperson and Finance cannot approve | **PASS.** Both are refused (CAPABILITY_REQUIRED). |
| AB / AE | Approved credit buys down the balance | **PASS.** 40000 − 2000 = 38000; − 5000 approved − 3000 cash = 30000. Discount + net = selling. A changed item returns to PROPOSED with credit 0; an unchanged edit keeps the approval. |
| AC / AD / AI | Financed sale | **PASS.** The package is 38000 = 3000 cash + 5000 approved trade-in + 30000 financed. The obligations are FUNDING_RECEIVABLE 30000 (provider) and RECEIVABLE 3000 (customer). There are no payments and no cash facts. |
| AF / AG | No book value, no price | **PASS.** The approved item stays AGREED with no receipt. No acquisition evidence equals any trade-in value. No selling price equals any trade-in value, and the used unit's price stays the explicit 10000. |
| AH | Direct sale | **PASS.** The receivable is the total less the approved credit (35000); v1 shape is unchanged. |
| AJ | Finance Business Relationships | **PASS.** The intercompany NET 90 (2026-12-31), FINANCING_PROVIDER and destination proofs run unchanged in the same suite. |
| AK | No Firebase | **PASS.** The static scan of the new modules finds no Firebase reference, and the Firebase exit guard holds. |

## Owner ruling #205

| Proof | Result |
|---|---|
| Exact holders, measured in the database | **PASS.** Finance configuration and Sales discount-limit management are each held by exactly accountingManager, admin, controller, financeManager, generalManager and owner. System Configuration is held by exactly admin and owner. Trade-in approval is held by exactly generalManager and owner. accountingManager and financeManager hold 19 capabilities each, with no System Configuration and no trade-in approval. |
| Owner / GM System Configuration | **PASS.** The Owner reads System Configuration; the General Manager is refused. |
