# FIN-004 — Financial Visibility Model

**Status:** IMPLEMENTED, server-enforced (SELF / TEAM / CONSOLIDATED live in the model;
OPERATING_COMPANY / BUSINESS_UNIT predicates implemented, principal-binding BLOCKED — see
FIN-BLOCK-001). Everything remains dormant behind `active:false` capabilities: nothing is
granted or activated by this workstream.
**Ruling:** DECISIONS #156 · **Boundary preserved:** #145 (subledger), #154 (attribution).
**Canonical authority:** `functions/src/finance/financialVisibility.ts`
**Enforcement:** `functions/src/finance/financeReadCallables.ts` (`loadFinancialVisibilityAuthority`
+ per-invoice filtering in `readAccountInvoiceAr`)
**Tests:** `functions/test/financialVisibility.test.mjs`, `functions/test/financeVisibilityRead.test.mjs`

## The invariant

**CAN PERFORM WORK ≠ CAN SEE FINANCIAL RESULT.** No operational capability implies financial
reach; UI hiding is never authority; every financial read is scoped server-side. Two grants are
required for any read: the **fact-family gate** (`finance.read` for AR facts) AND a
**visibility scope**. Either alone reaches nothing — which retires the pre-FIN-004 trap
(FIN-GAP-007) where activating the single `finance.read` boolean would have granted
company-wide AR over any caller-supplied accountId.

## The scope lattice

| Scope | Capability id | Reach | Runtime state |
|---|---|---|---|
| SELF | `finance.visibility.self` | records credited to me (`attribution.creditedSalespersonId == users/{uid}.employeeId`) | ENFORCED |
| TEAM | `finance.visibility.team` | SELF + employees the governed role hierarchy places under me (`access/hierarchicalVisibility.ts` — its first live consumer; no peer visibility) | ENFORCED |
| BUSINESS_UNIT | `finance.visibility.businessUnit` | records wholly attributable to one unit — a cross-unit invoice stays hidden entirely | predicate ENFORCED; principal-binding **BLOCKED (FIN-BLOCK-001)** |
| OPERATING_COMPANY | `finance.visibility.company` | records of one governed company (invoice `companyId` = the SO's `operatingCompanyId`, per #154) | predicate ENFORCED; principal-binding **BLOCKED (FIN-BLOCK-001)** |
| CONSOLIDATED | `finance.visibility.consolidated` | everything — only when expressly granted; never a default, never implied by admin | ENFORCED |

Reach = the UNION of granted scopes. All five ids are registered `active:false`
(REGISTER ≠ GRANT ≠ ACTIVATE); no governed Role carries them yet — grants are an activation
decision (F14 package), not part of this workstream.

## Fail-closed rules

- No scope ⇒ nothing; fact family alone ⇒ nothing; scope alone ⇒ nothing.
- A record with no credited person is nobody's SELF/TEAM record.
- BUSINESS_UNIT hides any invoice with an unattributed or out-of-unit line — visibility follows
  the number; one immutable financial document is never partially redacted.
- A COMPANY/BU grant without a bound value confers NOTHING (`SCOPE_VALUE_REQUIRED` at build;
  BLOCKED at load) — never "all companies".
- A caller-supplied accountId can never expand scope: the per-invoice predicate filters
  regardless of what was asked for (test-pinned, including cross-account).
- Truncation honesty judged on the UNFILTERED account set — a scope-filtered page never claims
  a completeness it cannot know.
- Admin has no bypass: "full governed access" is an express CONSOLIDATED grant like anyone
  else's; the authority module contains no role branch (source-asserted by test).
- The summary sums ONLY visible invoices — an out-of-scope record contributes no row, no
  amount, no count, and hidden is indistinguishable from absent.

## Composition (why this shape)

Follows the R-32/#1672 lesson from the reorder callables: for a scoped domain, a global-target
capability gate is the wrong authorization — the loaded authority's per-record decision IS the
authorization. `resolveEffectiveAccess` (global-target, boolean-only by design) resolves WHICH
capabilities are held; the loader binds values (employeeId via the canonical `users/{uid}`
join; team set via `loadPrincipalPositions` + `visibleEmployeeIdsFor`) and the pure authority
decides per record. Exports, reports, and any future financial surface must consume this same
authority — no surface-local visibility.

## FIN-BLOCK-001 (recorded, not decided)

HOW a principal is bound to a company or business-unit VALUE is an access-governance decision
belonging to the Owner's live scope workstream (R-29 bound warehouses via
`RoleAssignment.scope {type:"location"}`; R-32 made scope per-binding). Candidates: a new
`ScopeType` (4 synchronized edit points incl. `trustedWriterCommands`), appropriating the
defined-but-unused `"domain"` ScopeType, or a governed Employee fact. None may be minted
unilaterally. Until ruled: held COMPANY/BU grants resolve to BLOCKED (no reach), and the
blocked reason is carried on the authority for honest reporting.

## What later phases inherit

Every financial fact family added later (cost, margin, goals, budgets, forecasts, payments
detail, employee performance) registers its own fact-family gate and composes THIS scope
authority — scopes are defined once. Exports (F13) and surfaces (F12) re-authorize through the
same loader at execution time.
