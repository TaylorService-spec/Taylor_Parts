# UAT — Financing-provider financed sales (Owner ruling #200)

Recorded 2026-10-02 (DECISIONS #200). These are **local** proofs only, from `functions/test/financeFinancedSalePostgres.test.mjs` running against real PostgreSQL. Nothing here is deployed. All data is SAMPLE/UAT.

The fixture providers are two generic organizations governed as FINANCING_PROVIDER. Neither one is special.

| Proof | Scenario | Result |
|---|---|---|
| A | The customer stays the commercial customer | **PASS.** The package's commercial customer and its customer counterparty are the Agreement's customer. The database refuses a provider equal to the customer. |
| B | The provider is the financing provider | **PASS.** The package records the provider's counterparty separately. Disposition is FINANCED_SALE and the obligor basis is FINANCING_PROVIDER_FUNDED. |
| C | Taylor is the seller | **PASS.** The package's operating company is `taylor`. A Ventana financed sale is `ventana`'s. |
| D | The financed portion's counterparty is the provider | **PASS.** The FUNDING_RECEIVABLE goes to the provider organization. |
| E | No duplicate financed A/R | **PASS.** With a zero contribution the customer has no receivable at all. The direct-sale path refuses a financed package (UNSUPPORTED_FINANCIAL_OBLIGOR). |
| F | Zero contribution | **PASS.** Contribution is 0 and the financed amount is the whole total (33000). |
| G / H | Positive contribution | **PASS.** Contribution 8000 gives financed 25000. |
| I | Total = contribution + financed | **PASS.** 33000 = 8000 + 25000, and a database CHECK enforces it. |
| J | No overlap | **PASS.** The package has one FUNDING_RECEIVABLE (25000, provider) and one RECEIVABLE (8000, customer), summing exactly to the total. A second receivable of the same kind is refused. |
| K | Who pays whom | **PASS.** Taylor's claims are against two distinct parties. No obligation exists from the customer to the provider: the customer's lease payments to the provider are not Taylor records. |
| L | No provider collection or repossession model | **PASS.** The static check finds nothing. After FUNDED, every transition is refused and the funded amount is never customer A/R. |
| M | Entitlement held | **PASS.** Neither APPLIED nor APPROVED creates anything. FUNDING_ENTITLED requires a stated basis (FUNDING_ENTITLEMENT_BASIS_REQUIRED). Receivables are created whether the entitlement comes before or after the package is READY. |
| — | Decline or cancel before funding | **PASS.** The READY package is re-evaluated to HELD [FINANCING_NOT_AVAILABLE]. No receivable of either kind is created, and the status is terminal. |
| — | Composition guards | **PASS.** A contribution that differs from the Agreement's down payment is HELD (FINANCING_CONTRIBUTION_MISMATCH). A trade-in is HELD (FINANCING_TRADE_IN_UNGOVERNED). A contribution at or above the total is HELD (FINANCED_AMOUNT_INVALID). Package content is immutable. |
| — | Funded package correction | **PASS (fail closed).** A funding-entitled or funded package can't be superseded (FINANCED_PACKAGE_FUNDING_ENTITLED), and the provider's receivable stays OPEN. |
| N | Direct sales unchanged | **PASS.** A direct sale is READY / SALE / DIRECT_SALE_CUSTOMER with no financing fields. Its customer receivable covers the total and its handoff is created. Its replay stays `replayed` (fingerprint unchanged). A bare lease flag with no arrangement stays HELD. |
| O | Provider-neutral | **PASS.** Neither the schema nor the module names a provider. A second unrelated provider is equally valid, and an organization not governed as a provider is refused. |

## Remaining held detail

- **The funding-entitlement milestone (#200 §11).** The status exists and is recorded with its basis. The business event that triggers it is not yet ruled.
