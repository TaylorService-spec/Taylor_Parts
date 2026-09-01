# F15 — Financials E2E Certification Readiness

**Status:** scenario definition only — NO certification-world write, genesis, or execution
occurred (cert-world mutations are Owner-authorized live operations). This defines what a
Financials certification pass must PROVE once the Owner activates the sandbox spine (F14)
and authorizes a cert run. Recorded 2026-09-01, overnight financials run phase F15.

## Certification method

EXPECTED / RECORDED / OBSERVED (the v1.7 correction discipline): every scenario states the
expected outcome before execution, records the commands issued, and verifies by READING
live state — never by exit codes.

## Scenario set

**S1 — Attribution end-to-end.** Opportunity → WON → Sales Order → invoice → payment →
refund. PROVE: identical frozen attribution chain (company, credited salesperson, source
lineage) on every record; `invoice.companyId === invoice.attribution.operatingCompanyId`;
payment/adjustment/refund snapshots derived from the invoice; caller company assertions
refused on mismatch (COMPANY_MISMATCH); company-less commits refused (COMPANY_REQUIRED).

**S2 — Visibility scopes.** Principals with SELF / TEAM / CONSOLIDATED grants (and one
with a held COMPANY grant). PROVE: fact-family gate + reach both required; caller
accountId cannot expand scope; held COMPANY grant reads nothing (FIN-BLOCK-001 safe
behavior); truncation renders "unavailable", never partial "ready".

**S3 — AR position integrity.** Issue → partial payment → credit memo → refund →
write-off. PROVE: stored projection equals the facts formula at every step;
`reconcileInvoiceProjection` returns IN_SYNC throughout; a deliberately corrupted
projection (test-only doc write) returns DRIFT with the exact fields.

**S4 — Approval governance.** With FIN-007 policy values set: an over-threshold write-off
without an approval record refuses; with a REJECTED record refuses; self-approval
impossible; approving 100 does not admit 150.

**S5 — Period close.** Close a month for one company. PROVE: an event dated inside the
closed window refuses for that company only; the other company is unaffected; an
uncovered date is unaffected; no reopen path exists.

**S6 — Plans and forecasts.** An APPROVED goal measures BOOKED facts; a DRAFT refuses; a
COLLECTED fact against a BOOKED goal throws (never blends); a newer forecast supersedes;
an as-of tie refuses.

**S7 — Honest unknowns.** Margin queries return UNKNOWN (no cost facts exist);
consolidated totals carry UNELIMINATED_SUM; service work is absent from the billing
queue. PROVE the system says "unknown/absent," never 0.

## Preconditions

F14 stages A–D activated in sandbox; FIN-007/FIN-008 policy values supplied; cert
personas hold the intended grants. Blockers FIN-BLOCK-001..005 do NOT block
certification — S2/S7 certify their safe behavior explicitly.
