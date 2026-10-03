# UAT — Financing-provider financed sales (Owner rulings #200 + #201)

Recorded 2026-10-02 (DECISIONS #200, extended by #201). These are **local** proofs only, from `functions/test/financeFinancedSalePostgres.test.mjs` running against real PostgreSQL. Nothing here is deployed. All data is SAMPLE/UAT.

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
| M | Entitlement held | **PASS.** Neither APPLIED nor APPROVED creates a provider receivable. Under #201, FUNDING_ENTITLED requires signed + approved provider documentation (see below); the customer contribution no longer waits for it. |
| — | Decline or cancel before funding | **PASS.** The READY package is re-evaluated to HELD [FINANCING_NOT_AVAILABLE]. No receivable of either kind is created, and the status is terminal. |
| — | Composition guards | **PASS.** A contribution that differs from the Agreement's down payment is HELD (FINANCING_CONTRIBUTION_MISMATCH). A trade-in is HELD (FINANCING_TRADE_IN_UNGOVERNED). A contribution at or above the total is HELD (FINANCED_AMOUNT_INVALID). Package content is immutable. |
| — | Funded package correction | **PASS (fail closed).** A funding-entitled or funded package can't be superseded (FINANCED_PACKAGE_FUNDING_ENTITLED), and the provider's receivable stays OPEN. |
| N | Direct sales unchanged | **PASS.** A direct sale is READY / SALE / DIRECT_SALE_CUSTOMER with no financing fields. Its customer receivable covers the total and its handoff is created. Its replay stays `replayed` (fingerprint unchanged). A bare lease flag with no arrangement stays HELD. |
| O | Provider-neutral | **PASS.** Neither the schema nor the module names a provider. A second unrelated provider is equally valid, and an organization not governed as a provider is refused. |

## Owner ruling #201 proofs

| Proof | Scenario | Result |
|---|---|---|
| A–D | Neither APPROVED nor delivery (SERVICE_PERFORMED fulfillment) nor installation (EQUIPMENT_INSTALLATION fulfillment) nor customer acceptance (ACCEPTED Agreement) creates a provider receivable | **PASS.** The package is READY, but the provider side stays HELD_UNTIL_FUNDING_ENTITLEMENT, with no FUNDING_RECEIVABLE and no handoff. |
| E / F | Evidence that is signed only, or approved only | **PASS.** Both are refused with FUNDING_EVIDENCE_INSUFFICIENT, in the service and in the database. Another arrangement's evidence is refused the same way. |
| G | Signed + approved evidence | **PASS.** The arrangement becomes FUNDING_ENTITLED. Its provenance (arrangement, provider, flags, recorder, time, correlation, hash) is kept, and the evidence is append-only. |
| H / I | Exactly one provider receivable for the financed amount | **PASS.** One FUNDING_RECEIVABLE of 25000, to the provider. |
| J | Contribution before entitlement | **PASS.** The customer RECEIVABLE of 8000 exists as soon as the package is READY. |
| K / L | Composition | **PASS.** 33000 = 8000 + 25000, with the two receivables owed by two different parties. |
| M | Replay | **PASS.** Package replays and consequence replays return `replayed`. A second FUNDING_RECEIVABLE is refused. |
| N | FUNDED ≠ FUNDING_ENTITLED | **PASS.** Entitlement records no settlement. FUNDED is a separate, terminal transition. |
| O / P | Decline, then restructure | **PASS.** A decline makes the package HELD. The superseded package's contribution receivable is voided, with history kept. Nothing converts on its own. An explicit restructure to DIRECT_SALE gives a READY SALE package with the customer RECEIVABLE at 33000. A cancelled arrangement restructured to another provider gets a FUNDING_RECEIVABLE from that provider. |
| Q | Restructure after entitlement or funding | **PASS.** Refused with FINANCING_RESTRUCTURE_REFUSED. |
| R | Trade-in | **PASS.** Held with FINANCING_TRADE_IN_UNGOVERNED. Ordinary financed sales without a trade-in stay usable. |
| S | Financed handoff | **PASS.** The payload is v2 and carries the customer with the 8000 contribution receivable and the provider with the 25000 FUNDING_RECEIVABLE. It also carries the provider reference, FUNDING_ENTITLED status, signed + approved evidence, package, Sales Order and company. The deterministic adapter acknowledged it, and the attempt recorded v2. There is one sale. |
| T / W | No network, no Firebase | **PASS (static).** |
| U | Direct sales | **PASS.** Unchanged, including the v1 payload. |
| V | Provider model stays generic | **PASS.** |

## Remaining held detail

- None for the financed-sale model. #201 resolved the entitlement milestone: signed + approved provider documentation.
