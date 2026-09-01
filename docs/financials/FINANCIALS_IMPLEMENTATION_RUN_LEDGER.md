# Financials Implementation Run Ledger

The execution record of the post-FIN-002 autonomous implementation run (started 2026-09-01).
One row per phase; a phase is COMPLETE_MERGED only when its content is reachable from current
origin/main. Boundary preserved throughout: EOS = governed operational financial subledger
(DECISIONS #145); FIN-002 attribution + required-company gates (DECISIONS #154) are merged
authority and are composed, never re-decided.

Run start: origin/main = `cfe9c8fb` (FIN-002 merge `d2085c01` verified reachable).

| Phase | Workstream | Status | Base main | Head | PR | Merge |
|---|---|---|---|---|---|---|
| F2 | FIN-004 Financial Visibility | COMPLETE_PR_OPEN | cfe9c8fb | (see PR) | (opened below) | — |
| F3 | Finance Core Activation Readiness | NOT_STARTED | — | — | — | — |
| F4 | Service Billing Model | NOT_STARTED | — | — | — | — |
| F5 | FIN-006 Cost & Margin | NOT_STARTED | — | — | — | — |
| F6 | FIN-003 Plan vs Actual | NOT_STARTED | — | — | — | — |
| F7 | FIN-005 Forecasting | NOT_STARTED | — | — | — | — |
| F8 | FIN-007 Adjustments/Approvals | NOT_STARTED | — | — | — | — |
| F9 | FIN-008 Period & Close | NOT_STARTED | — | — | — | — |
| F10 | FIN-009 Allocation & Intercompany | NOT_STARTED | — | — | — | — |
| F11 | FIN-010 Reconciliation/Traceability | NOT_STARTED | — | — | — | — |
| F12 | Financials Product Surfaces | NOT_STARTED | — | — | — | — |
| F13 | Reporting Matrix | NOT_STARTED | — | — | — | — |
| F14 | Sandbox Activation Readiness | NOT_STARTED | — | — | — | — |
| F15 | E2E Financial Certification Readiness | NOT_STARTED | — | — | — | — |

Details per phase are appended below as each phase closes.

## Phase details

### F2 — FIN-004 Financial Visibility
- AUTHORITY CHANGED: financial visibility (new scope authority + 5 capability ids, all
  `active:false`); `finance.read` redefined to fact-family-gate semantics (safe: dormant)
- FILES: financialVisibility.ts (new), financeReadCallables.ts (loader + scoped read),
  permissionCatalog.ts ×2 mirrors (+5 ids), finance CI lane + emulator script, 2 new test
  suites, FIN-004 doc, DECISIONS #156, SYSTEM_AUTHORITIES row
- TESTS: pure 12/12; emulator scoped-read 9/9; finance read legacy suite updated (explicit
  CONSOLIDATED authority); catalog/resolver suites green
- CERT_WORLD_IMPACT: NONE · DEPLOYMENT: NONE
- DEFECT FIXED IN PASSING: duplicate DECISIONS number on main — the later collider
  (R-34/2C-closed, merged numbering from a stale tail) renumbered #154→#155 with an inline
  note; FIN-002 keeps #154 (10+ code references); the one R-34 cross-reference updated
- BLOCKER: FIN-BLOCK-001 (below)
- NEXT DEPENDENCY: F3 finance-core readiness composes the visibility loader

## Blockers (running list)

### FIN-BLOCK-001 — principal-to-company/business-unit scope binding
- PHASE: F2 (FIN-004); also constrains F12 company/BU surfaces and F13 company/BU reports for
  non-consolidated principals
- EXACT QUESTION: by what governed mechanism is a principal BOUND to an operatingCompanyId or
  businessUnitId value for financial visibility — (a) a new ScopeType (4 synchronized access-core
  edit points incl. trustedWriterCommands), (b) the defined-but-unused "domain" ScopeType,
  or (c) a governed Employee fact?
- WHY CODE CANNOT ANSWER: this is the Owner's live access-scope workstream (R-29/R-32/R-33
  lineage); minting the mechanism unilaterally would be inventing access authority.
- CURRENT SAFE BEHAVIOR: held COMPANY/BU visibility grants resolve to BLOCKED — no reach, with
  the reason carried on the authority; predicates fully implemented and tested.
- WHAT REMAINS UNIMPLEMENTED: honoring company/BU scope grants at runtime.
- RECOMMENDED OPTIONS: (b) is cheapest if "domain" was reserved for business-domain partitions;
  (a) is cleanest long-term ("company" ScopeType beside "location"); (c) couples visibility to
  employee master data. One ruling unblocks a ~30-line loader change.
