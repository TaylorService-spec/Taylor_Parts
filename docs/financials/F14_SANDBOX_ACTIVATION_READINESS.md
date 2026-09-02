# F14 — Financials Sandbox Activation Readiness Package

**Status:** READY_FOR_OWNER_DEPLOY — package only. NOTHING in this document was executed:
no deploy, no capability activation, no grant, no Rules change, no backfill, no data write.
Every step below is an Owner-gated action (Delegation Charter Tier 2+; sandbox `.firebaserc`
hazards apply — the default project is PRODUCTION). Recorded 2026-09-01, overnight
financials run phase F14.

## 0. What is merged and dormant (the spine this activates)

All in `functions/src/finance/` on main, pure-tested, CI-covered by
`finance-invoice-persistence-tests.yml`: attribution (FIN-002 + F3 downstream stamping),
visibility (FIN-004), billing queue (F4), cost/margin (F5), plan-vs-actual (F6),
forecasting (F7), approvals (F8), periods (F9), allocation/consolidation (F10), internal
reconciliation (F11). Callables exported but every capability `active:false` and carried by
no role.

## 1. Capability activation order (each its own explicit Owner act)

Registered ids (both catalog mirrors), all `active:false` today:

| Stage | Capabilities | Prerequisite |
|---|---|---|
| A. Read spine | `finance.read` + `finance.visibility.self` / `.team` / `.consolidated` | uid→employeeId links exist for SELF/TEAM principals |
| B. Company/BU reach | `finance.visibility.company` / `.businessUnit` | **RULED — DECISIONS #157 (FIN-BLOCK-001 CLOSED):** reach binds via `operatingCompany`/`businessUnit`-scoped RoleAssignments, grant-time-validated against the governed vocabularies; a capability grant with no scoped binding still confers no reach |
| C. Money-in writes | `finance.payment.apply` | Stage A; FIN-007 policy values if payments are approval-gated |
| D. Corrections | `finance.adjustment.record`, `finance.refund.record` | Stage C; FIN-007 approval policy values + approver grants |
| E. Issuance | `finance.invoice.issue` | tax determination injection decision (issuance refuses without tax — TAX_REQUIRES_REVIEW) |

## 2. Owner policy values to supply at activation (no defaults exist; everything fails closed without them)

- FIN-007 `ApprovalPolicyLine[]` values (thresholds per action type) + approver capability/role.
- FIN-008 period cadence/calendar + closer authority (no periods declared = nothing closed — safe).
- FIN-004 scope grants per principal (reach = union; no grant = no reach).
- FIN-BLOCK-002/003/004 rulings unlock service billing / cost & margin / intercompany respectively — activation without them is safe (those paths stay structurally absent/UNKNOWN).
- **Activation registry — CORRECTED 2026-09-02.** This entry previously said the
  `finance.visibility.*` ids were "deliberately in NO environment activation registry today."
  That stopped being true on 2026-09-01: `finance.visibility.consolidated` was added to the
  platform-sandbox entry of `config/environments.json` and to the embedded snapshot in
  `functions/src/access/environmentCapabilityOverrides.ts` (drift-guard-tested pair) by
  commit `cc261540` / PR #1711, for sandbox Owner review only. The other four ids
  (`self`/`team`/`businessUnit`/`company`) remain in no registry, and a wider environment
  remains an Owner-authorized PR plus a Functions deploy.
  **The point this bullet was making is unchanged, and is now sharper: ELIGIBILITY IS NOT
  CARRIAGE.** No repository Role carries any `finance.visibility.*` capability, so reach is
  still zero for every principal — see §2's "carrying role TBD", which remains the open
  decision. Evidence and consequences: `docs/assessments/eos-dashboard-reporting-authority-census.md`
  §9 decision 1.

### Grant examples (persona → capability grant + scope binding; ILLUSTRATIVE — nothing granted)

Every grant is two facts: the ROLE carrying the capability (no repository role carries
`finance.visibility.*` today — the carrying role itself is an Owner decision, marked TBD) and
the RoleAssignment's SCOPE. Reach = capability ∧ binding, through the one resolver.

| Persona | Capabilities | RoleAssignment scope | Status |
|---|---|---|---|
| Admin (governed full) | `finance.read` + `finance.visibility.consolidated` | `{type:"global"}` | role carriage TBD (admin role does not carry finance ids today — deliberate) |
| Financial company manager (Taylor) | `finance.read` + `finance.visibility.company` | `{type:"operatingCompany", value:"taylor"}` | mechanism GOVERNED (#157); carrying role TBD |
| BU manager (Service) | `finance.read` + `finance.visibility.businessUnit` | `{type:"businessUnit", value:"SERVICE"}` | mechanism GOVERNED (#157); carrying role TBD |
| Self-view salesperson | `finance.read` + `finance.visibility.self` | `{type:"global"}` (reach limited by SELF's employeeId binding) | requires `users/{uid}.employeeId` link |
| Team manager | `finance.read` + `finance.visibility.team` | `{type:"global"}` (reach limited by hierarchy visibility) | requires position hierarchy rows |
| Consolidated executive | `finance.read` + `finance.visibility.consolidated` | `{type:"global"}` | carrying role TBD |

## 3. Deployment steps (Owner-executed, in order)

1. From the shared release checkout on current main: `cd functions && npm ci && npm run build`.
2. Deploy ONLY the finance callables in small named batches (batch-deploy flakiness):
   `firebase deploy --project <SANDBOX> --only functions:listAccountInvoiceAr,functions:applyPayment,functions:recordAdjustment,functions:recordRefund,functions:issueInvoice`
   (verify exact export names in `functions/src/index.ts` at deploy time).
3. NO Rules change is required for the finance spine (invoices/payments collections are
   already Admin-SDK-only deny-all client-side); any Rules edit is its own human-operator
   deploy per standing policy.
4. NO Firestore indexes are expected for the current bounded reads; if the deploy
   surfaces an index need, STOP — index deploys delete undeclared live indexes.
5. Flip capabilities per §1 stage-by-stage (catalog edit → PR → deploy), then grant roles.
6. Verify per environment-truth rule: read live callable behavior (deny before grant,
   allow after) — never report activation from an exit code.

## 4. Explicitly out of scope for this package

Production activation (separate, later, its own authorization); backfill of historical
attribution (FIN-002 backfill remains plan-only); genesis/role ceremonies; cert-world
writes; external accounting integration (#145 authority-of-record selection).
