# UAT — Tax Evidence UX and the Accounting Delivery Control Plane

Recorded 2026-10-02 (DECISIONS #198). These are **local** proofs only. Nothing here is deployed; it is held for Controller review.

The proofs come from three suites:

- `field-ops-app-vite/test/salesAgreementTaxEvidence.test.jsx`
- `functions/test/financeAccountingDeliveryPostgres.test.mjs` (real PostgreSQL, deterministic test adapter only)
- `functions/test/financeReceivableHandoffPostgres.test.mjs` (subtest UI-9)

All data is SAMPLE/UAT. No provider, credential or network is involved.

## Tax evidence on the Agreement workflow

| ID | Scenario | Result |
|---|---|---|
| UAT-FIN-TAX-UI-05 | Two human choices | **PASS.** The control offers "Tax not yet determined" and "Tax determined". An amount box appears only when "Tax determined" is chosen. The old bare Tax charge box is gone. |
| UAT-FIN-TAX-UI-06 | Determined amount | **PASS.** The form sends `taxEvidence { DETERMINED, 1850, USD }` and never a bare `taxMinor`. An empty amount is refused locally ("Enter 0 if none is due"). |
| UAT-FIN-TAX-UI-07 | Determined zero | **PASS.** 0 is sent as DETERMINED. It reads "Tax determined $0.00" with the note "Zero tax was determined for this sale — it was not assumed". The North Star money ladder draws the row instead of omitting it. |
| UAT-FIN-TAX-UI-08 | Back to not determined; unchanged | **PASS.** Changing a determination to not determined sends `{ NOT_DETERMINED }`. Re-saving other terms sends no tax input. On the server, an explicit NOT_DETERMINED removes the old amount from the total (31850 → 30000). |
| UAT-FIN-TAX-UI-09 | Server reset reflected | **PASS.** The read projection carries `taxEvidence`. After a bare amount change, the server answers NOT_DETERMINED, and the screen shows "Tax not yet determined" with no amount, even though the stored column holds one. |
| UAT-FIN-TAX-UI-10 | Legacy | **PASS.** LEGACY_UNVERIFIED, or a backend that sends no evidence, reads "Tax needs confirmation", never "No tax", "Tax exempt" or $0.00. The control starts with no choice selected, and saving leaves the record as it was. |
| UAT-FIN-TAX-UI-11 | No server vocabulary | **PASS.** No status code (NOT_DETERMINED / DETERMINED / LEGACY_UNVERIFIED) or record id is rendered in any state. Malformed amounts are refused. |

## Accounting delivery control plane

| ID | Scenario | Result |
|---|---|---|
| UAT-FIN-DLV-12 | Exact states | **PASS.** Configuring a destination moves the handoff from PENDING_DESTINATION to READY_FOR_DELIVERY. The database refuses every illegal transition: READY → any outcome, entering delivery without counting an attempt, an identity change, a delete, and re-pointing a READY handoff's destination. |
| UAT-FIN-DLV-13 | Pending destination | **PASS.** Delivery is refused (HANDOFF_NOT_DELIVERABLE) and no attempt is recorded. |
| UAT-FIN-DLV-14 | Payload contract | **PASS.** The contract is `eos.accounting.operational-billing-package` v1. It is deterministic (same fingerprint each time), handed over frozen, and carries amounts as minor-unit strings: 25000 + 1850 = 26850. It includes the receivable, the customer (EXTERNAL_ORGANIZATION), the company and its own destination. It uses no provider or GL vocabulary. |
| UAT-FIN-DLV-16/17 | Adapter cannot alter truth | **PASS.** An adapter that rewrites the payload throws on the frozen object; the attempt ends FAILED_RETRYABLE and the recorded payload is EOS's own. When a provider acknowledgement carries amounts, they are ignored. The package, receivable, facts and invoices are all unchanged. |
| UAT-FIN-DLV-18/19/20 | Acknowledge, replay, no duplicate | **PASS.** The handoff becomes ACKNOWLEDGED with the provider reference and time, and attempt_count is 1. Replaying the same request returns the same attempt without calling the adapter again. A new request, or a retry, is refused. The reference can't be rewritten, and an ACKNOWLEDGED handoff can't be superseded in place. |
| UAT-FIN-DLV-21/26 | Retryable failure → governed retry | **PASS.** The first attempt ends FAILED_RETRYABLE and nothing re-attempts on its own. A retry with an empty reason is refused. Retry 1 throws and is treated as retryable; retry 2 is ACKNOWLEDGED. The attempts form an INITIAL → GOVERNED_RETRY ×2 chain with reasons, and all three present the SAME provider de-duplication key and payload. |
| UAT-FIN-DLV-22/25 | Final / uninterpretable | **PASS (fail closed).** FINAL, garbage and wrong-fingerprint acknowledgements all end FAILED_FINAL and open an exception (REVIEW_DESTINATION_CONFIGURATION). Retry is refused and the truth is unchanged. |
| UAT-FIN-DLV-23/24 | Rejection | **PASS.** The handoff ends REJECTED; the receivable stays OPEN and unchanged. A PROVIDER_REJECTED exception is opened (CORRECT_AND_SUPERSEDE_PACKAGE, with the provider's detail). Retry and redelivery are refused. The exception resolves once, with a stated resolution, and can't be rewritten. |
| UAT-FIN-DLV-27 | Company destinations | **PASS.** A Ventana handoff is delivered to Ventana's destination (VENTANA-TEST). A Taylor handoff pointed at Ventana's destination is refused (DESTINATION_COMPANY_MISMATCH), and an inactive destination is refused (ACCOUNTING_DESTINATION_INACTIVE). In both cases no attempt is recorded. |
| UAT-FIN-DLV-28 | No production adapter | **PASS.** Delivery is refused (ADAPTER_NOT_AVAILABLE) with the empty registry, and with an adapter for some other key. No attempt is recorded. |
| UAT-FIN-DLV-29 | Durable attempts | **PASS.** Attempts are append-only. The outcome is recorded once, a delete is refused, and only one attempt per handoff can be IN_PROGRESS. |
| UAT-FIN-DLV-30 | Supersession guard | **PASS.** A package whose handoff is ACKNOWLEDGED can't be superseded (ACCOUNTING_HANDOFF_DELIVERED), and its receivable is not voided. A REJECTED handoff is superseded by correction: its receivable is VOIDed and its exception is RESOLVED as SUPERSEDED_BY_CORRECTED_PACKAGE. |
| UAT-FIN-DLV-31/32 | Authority / static | **PASS.** No transport operation exists, so there is no Sales or Technician authority. The suite finds no timer, queue, network, provider name, credential or Firebase. No runtime module references the test adapter. |
| UAT-FIN-DLV-33/34 | Provenance / no invoice | **PASS.** Delivery records no financial fact: there is one origination per package plus one reversal for the corrected package. There are 0 invoices and no GL structure. |

## Known limits (stated, not hidden)

- **Stuck attempt.** If a process dies between starting an attempt and recording its outcome, the handoff stays DELIVERY_IN_PROGRESS. No path recovers it yet; a reconciliation step belongs with a real provider.
- **No re-pointing.** A READY handoff's destination is fixed. Re-pointing to a company's replacement destination is future work.
- **Server-side only.** There is no employee-facing delivery or retry surface or capability. That is deferred until a governed Finance UI needs one.
