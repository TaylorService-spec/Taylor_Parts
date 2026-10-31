# Active Workstreams — multi-agent registry

**Status:** living registry — **the single authoritative surface for active assignment coordination.** Per [`AI_ENGINEERING_OPERATING_MODEL.md`](AI_ENGINEERING_OPERATING_MODEL.md) §8. The code-level ownership authority remains [`../architecture/SYSTEM_AUTHORITIES.md`](../architecture/SYSTEM_AUTHORITIES.md); this registry coordinates *who is actively writing where, right now*.

**Single owner of this concern (2026-08-06, Program 0 truth pass).** [`../session-state/`](../session-state/) previously carried overlapping active-lane coordination; it is now classified **HISTORICAL SNAPSHOT** and must not receive new in-flight assignments. Declare assignments here and nowhere else.

**Rules (summary — full text = the 8 numbered rules in the Operating Model §8):** declare the assignment here before writing; (1) one active writer per owned path; (2) no silent edits to a reserved shared file; (3) a shared-file collision does not stop a whole capability; (4) finish non-conflicting work and record the integration delta; (5) an Integration Agent owns high-collision files when practical; (6) a builder is not the sole approver of its own material change; (7) reviewers use repository evidence, not another agent's chat memory; (8) production promotion is serialized.

## How to use

When you begin a capability, add a row to **Active** with every declared field. Move it to **Recently completed** at capability completion (§6). Keep it short — this is a coordination surface, not a history log; `DECISIONS.md` is the durable record.

### Declared fields (template)

```
- Capability:          <business capability / feature area>
- Agent/session:       <session id or agent name> · Role: <builder|reviewer|integration|release-prep>
- Branch / worktree:   <branch> · <worktree path>
- Base commit:         <sha>
- Owned paths:         <paths this agent is the sole active writer of>
- Shared paths req'd:  <high-collision files needed; coordinate via Integration Agent>
- Dependencies:        <other workstreams/capabilities this waits on>
- Expected outcome:    <the completed capability>
- Protected boundaries:<Owner-gated items this will reach, if any>
- Lifecycle stage:     <DESIGNED|SANDBOX BUILD|SANDBOX VERIFIED|INTEGRATION|RELEASE CANDIDATE|OWNER REVIEW|PRODUCTION AUTHORIZED|OPERATIONALLY VERIFIED|RETIRED>
```

## Active

- Capability:          Lane HAR (2026-10-21) — persona harness target allowlist: `scripts/eosPersonaSession.mjs` (password + MFA login AND nonprod persona issuer) sends a secret ONLY to an exact, normalised, registered nonproduction EOS API / application origin from `config/environments.json`, same environment, validated before anything is sent, no redirect followed; results carry `proof: "login-mfa" | "issuer-api"` (Owner review "CODEX UAT SECURITY PREREQUISITE")
- Agent/session:       Claude Code Lane HAR · Role: builder; controller merges
- Branch / worktree:   `har/persona-harness-target-allowlist` · `.claude/worktrees/agent-a159114919f1cc303`
- Base commit:         `835e5982`
- Owned paths:         `scripts/eosPersonaSession.mjs`; `field-ops-app-vite/test/eosPersonaTargetAllowlist.test.mjs` (new); the two existing harness tests' target literals (`b2EosOnlySignIn`, `eosHarnessSession`)
- Shared paths req'd:  `field-ops-app-vite/test/suites.json` (one registration line)
- Dependencies:        none
- Expected outcome:    a refused target never receives a password, MFA code, issuer credential or token; Codex UAT can use the harness safely
- Protected boundaries:none (tooling only; no product code, no deploy, no credentials read)
- Lifecycle stage:     MERGED `96530fe3` (#2201) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Lane FU-2 (2026-10-20) — Finance completion: `prepareBillingPackage { salesOrderId, idempotencyKey }` on `/operations/finance` (the governed rebill trigger after an approved void; wraps the existing preparation; REUSES `finance.invoice.issue`), the server-derived `issuable` / `rebill` verdicts on the receivable read (one predicate, `issueBlocker`, shared with `issueInvoice`), and the Receivables Prepare rebill control; Issue is never offered on a financed sale
- Agent/session:       Claude Code Lane FU-2 · Role: builder; controller merges
- Branch / worktree:   `fu2/rebill-and-financed-issue` · `.claude/worktrees/agent-ad004157f3f83888e`
- Base commit:         `4876712b`
- Owned paths:         `functions/src/eosFinance/{billingPackage,invoiceIssue,financeOperations}.ts` · `functions/test/fu2PrepareBillingPackage{,Postgres}.test.mjs` · `field-ops-app-vite/src/modules/financials/{FinancialsReceivablesEos,InvoiceIssueQueue}.jsx` · `src/domain/financialsEos.js` · `src/services/financeApiClient.js` · `docs/user-guide/financials/{issue-an-invoice,correct-an-invoice}.md`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` (#F-1b addendum) · `docs/governance/precedence-sweep.json` (hash only) · `functions/test/adminPolicySuites.json` · `.github/ci/eos-admin-policy-paths.txt`
- Dependencies:        F-1a (#2184) and F-1b (#2188) merged; no migration, no capability, no grant
- Expected outcome:    a voided sale can be rebilled on demand under a NEW invoice number (the voided number kept); the screen never offers Issue on a financed sale; the predicate and the command cannot disagree
- Protected boundaries:none — no capability, grant, migration, Rules, deploy, Firebase, production or external-payment change; touches no adminPolicy, secondaryApproval or Commercial file
- Lifecycle stage:     MERGED `78736004` (#2195) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Lane FU-3 (2026-10-21) — PR B: the delegated self-approval exemption in Administration (Owner review of #2193, mandatory items): the exemption Object says "only the protected Owner" before any change to it, a FORBIDDEN preview reads "not authorized" (not "preview unavailable"), and the preview naming the affected Employee and the effective-access view showing the source Role / Direct Exception are proved by test. PR A (#2197): `reorderConsumersDeniedVsAbsent` registered in required CI.
- Agent/session:       Claude Code Lane FU-3 · Role: builder; controller merges
- Branch / worktree:   `fu3-exemption-access-view` (PR A: `fu3-ci-reorder-consumers-denied-vs-absent`) · `.claude/worktrees/agent-a00a10148bbb9d557`
- Base commit:         `1732a445`
- Owned paths:         `modules/administration/{AuthorityImpactPreview.jsx,exemptionFamily.js}` · `test/authorityImpactPreview.test.jsx` · the ADMIN-3b subtest of `functions/test/saeDelegatedExemptionPostgres.test.mjs` · `.github/workflows/reorder-domain-client-tests.yml` (PR A) · `docs/training/administration-policy-and-access.md` (section 13)
- Shared paths req'd:  this registry · `.github/ci/eos-admin-policy-paths.txt`
- Dependencies:        none
- Expected outcome:    nobody is surprised by an Owner-only refusal on the exemption keys; every acceptance item of #2193 is proved by a named test
- Protected boundaries:no migration, no capability, no grant, no Rules, deploy, Firebase or production change
- Lifecycle stage:     MERGED PR A `5f542723` (#2197) and PR B `9688e5e9` (#2198) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Lane FU-1 low follow-ups (2026-10-20) — Sales Order tracker follows the server allocation read, bare `/opportunities/sales-order/:id` redirects to the canonical route, supplier PO "Loading name…" while the directory loads, R1 doc tag line corrected
- Agent/session:       Claude Code Lane FU-1 · Role: builder; controller merges
- Branch / worktree:   `fu1/low-followups` · `.claude/worktrees/agent-a073b3972e3908774`
- Base commit:         `174ba281`
- Owned paths:         `modules/sales/{SalesOrderDetail,SalesOrderAllocation,SalesOrderFulfillmentSection,SalesOrderBareRedirect}.jsx` · `domain/salesOrderFulfillmentProgress.js` (one blocker line) · `modules/purchasing/SupplierPurchaseOrders.jsx` · `App.jsx` (one route + import) · `docs/operations/production-recovery-release-r1.md`
- Shared paths req'd:  this registry
- Dependencies:        none
- Expected outcome:    no stale "not recorded" allocation copy; the bare Sales Order URL lands on the page; no false "Name unavailable" during a load
- Protected boundaries:none — no capability, grant, migration, Firebase or production change
- Lifecycle stage:     MERGED `4876712b` (#2192) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Lane UX display batch (overnight 2026-10-20) — show the name or number a record already holds instead of a blank, a key or a false warning: Ordered By / Received By / Assigned on reorder cards, RR numbers, warehouse names (supplier PO detail, cycle count sheets), receipt order number, completed-receipt state, raise-form checkbox name, "No parts planned" job card line, assign refresh (PL4)
- Agent/session:       Claude Code Lane UX · Role: builder; controller merges
- Branch / worktree:   `ux/display-batch-purchasing` · `.claude/worktrees/agent-a499bba175438ba94`
- Base commit:         `b3d09dc3`
- Owned paths:         display-only edits in `modules/{purchasing,receiving,inventory/{PartDetail,CycleCounts,PartsList},inventoryRole/PartsManagerHome,technician/TechnicianShell}` · `shared/reorder/*` · read-projection columns in `functions/src/eosOps/{reorderLifecycleCommands,supplierPurchaseOrderAuthoring}.ts` · `eosExperience/myWork.ts` label
- Shared paths req'd:  this registry · `.github/workflows/equipment-install-ui-tests.yml` (one suite registered)
- Dependencies:        none
- Expected outcome:    no screen shows a blank, a storage key or a false warning where the record holds a name, number or state
- Protected boundaries:none — no capability, grant, migration, Firebase or production change
- Lifecycle stage:     MERGED `9f839135` (#2176) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Lane HARDEN-2 — display-batch review follow-ups (#2176): "Name unavailable" vs "Not recorded", warehouse join tenant key, negative tests, myWork/MultiScan/job-card tests
- Agent/session:       Claude Code Lane HARDEN-2 · Role: builder; controller merges
- Branch / worktree:   `ux/display-batch-followups` · `.claude/worktrees/agent-a86a52d7a6334b958`
- Base commit:         `20485b9f` (#2176 head, merged with `bfeb6dd8`)
- Owned paths:         `functions/src/eosOps/{reorderLifecycleCommands,supplierPurchaseOrderAuthoring}.ts` · `functions/src/eosExperience/myWork.ts` · their tests · `PartDetail`/`AssociateRequestPanel`/`SupplierPurchaseOrders`/`MultiScanReceiving` display
- Shared paths req'd:  this registry
- Dependencies:        #2176 (stacked on its head until it merges)
- Expected outcome:    a former member's recorded actor reads "Name unavailable", never "Not recorded"; no cross-tenant warehouse name
- Protected boundaries:none — no capability, grant, migration, Firebase or production change
- Lifecycle stage:     MERGED `ec4df468` (#2180) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Production recovery release R1 — record the production Hosting/Pages/Functions/Rules revisions and an operator rebuild recipe (gates all Firebase deletion)
- Agent/session:       Claude Code lane R1 · Role: builder (docs only); controller reviews, tags and merges
- Branch / worktree:   `docs/r1-production-recovery-release` · `.claude/worktrees/agent-ad1865bb5a1b23704`
- Base commit:         `2f8be86f`
- Owned paths:         `docs/operations/production-recovery-release-r1.md`
- Shared paths req'd:  this registry
- Dependencies:        none (git history + `evidence/firebase-deployed-inventory-20261019/` only)
- Expected outcome:    Hosting `4f30ab3a`, Pages `6cac0423`, Functions `4f30ab3a` (84/84 export match) and Rules `0526140d` pinned, with tag commands for the controller
- Protected boundaries:none reached (no deploy, tag push, cloud call, credential or workflow edit)
- Lifecycle stage:     MERGED `bfeb6dd8` (#2179) (docs; the controller creates the tags) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          CI reliability — assignmentScopeRuntimePostgres teardown drain (pg-pool end() resolves before clients close; forced DROP kills a closing backend → unhandled 57P01)
- Agent/session:       Claude Code Lane Firebase · Role: builder; Lane D: independent reviewer; controller merges
- Branch / worktree:   PR #2120 · Lane Firebase clone (private PG :55507)
- Base commit:         `ef199c11`
- Owned paths:         `functions/test/assignmentScopeRuntimePostgres.test.mjs`
- Shared paths req'd:  this registry
- Dependencies:        none (test-only). Repo-wide `endPoolAndDrain` helper is a SEPARATE later PR, after #2110 and Scheduling PR-2
- Expected outcome:    the teardown flake no longer fails CI
- Protected boundaries:none beyond standing delivery authority
- Lifecycle stage:     MERGED `bd77a454` (#2120); repo-wide endPoolAndDrain helper is a separate follow-up PR

- Capability:          Honest refusal wording — Jobs (Job Assignments) and My Dashboard Service Attention classify refusals through workOrderOutcome.js (FORBIDDEN → denied, COMPANY_AUTHORITY_REQUIRED → company-authority message, NOT_YET_ACTIVATED → not enabled; outages keep retry copy)
- Agent/session:       Claude Code Lane C · Role: builder; Lane D: independent reviewer; controller merges
- Branch / worktree:   `work/eos-lane-c-wo-refusal-wording` · Lane C clone
- Base commit:         #2110 head (rebases onto post-#2110 main)
- Owned paths:         `modules/jobs/Jobs.jsx` (refusal branch) · `modules/dashboard/MyDashboard.jsx` (ServiceAttentionModule) · `test/workOrderRefusalHonesty.test.jsx`
- Shared paths req'd:  this registry · `.github/workflows/dispatch-north-star-tests.yml` (suite + triggers; controller-accepted)
- Dependencies:        #2110 (reuses its refusal copy)
- Expected outcome:    refusals never read as outages
- Protected boundaries:none beyond standing delivery authority
- Lifecycle stage:     MERGED `08b8baea` (#2121); nonprod verified (Job Assignments)

- Capability:          SCAN-PORT — the thirteen sandbox scanner scenarios ported from the retired Firebase runner to EOS automated tests (real PostgreSQL in CI, no live environment, no credential); wedge and camera input at the client
- Agent/session:       Claude Code lane SCAN-PORT · Role: builder; controller merges
- Branch / worktree:   `worktree-agent-a2a3b9898eaa895ed` · agent worktree
- Base commit:         `b3d09dc3`
- Owned paths:         `functions/test/scannerScenariosOnEosPostgres.test.mjs` · `field-ops-app-vite/test/scannerScenarioInput.test.jsx` · header comment of `scripts/runSandboxScannerScenarios.mjs` (marked SUPERSEDED; not deleted)
- Shared paths req'd:  this registry · `functions/test/adminPolicySuites.json` (postgres list) · `.github/ci/eos-admin-policy-paths.txt` · `.github/workflows/scan-workspace-tests.yml` (suite + triggers)
- Dependencies:        one TODO scenario part (reservation-netted availability) waits on lane RES (S1b)
- Expected outcome:    B5 acceptance "twelve scanner scenarios" is a CI regression suite on EOS instead of a manual run against retired callables
- Protected boundaries:none; no capability, grant, migration, Rules, deploy or Firebase change
- Lifecycle stage:     MERGED `ec66b089` (#2177) (test-only) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Dispatcher Board interactions — drag reaches every lane (scrolling grid), tap placement ("Place on a lane"), lane names open an in-board technician review with back-state, Dispatch gated on workOrder.lifecycle.dispatch (Owner "DISPATCH BOARD INTERACTIONS" 2026-10-17)
- Agent/session:       Claude Code EOS controller · Role: builder; Lane D: independent reviewer
- Branch / worktree:   `fix/board-interactions-drag-tap-employee-review` · `D:/eos-dispatch-fix`
- Base commit:         `ef199c11`
- Owned paths:         `modules/dispatcherBoard/**` (this change) · `domain/schedulingRefusal.js` · `.ns-dispatch-grid/-week/-lane__name` rules in `index.css` · `test/dispatchBoardInteractions.test.jsx`
- Shared paths req'd:  this registry · `.github/workflows/dispatch-north-star-tests.yml`
- Dependencies:        none (Scheduling lane's Board edits wait for this)
- Expected outcome:    authorized dispatchers drag or tap work onto lanes through the same governed commands; employee review with Board state restored
- Protected boundaries:standing delivery authority; no server, grant, role or Firebase change
- Lifecycle stage:     MERGED `972fc0fa` (#2118); nonprod verified live 23/23 (Rudy Admin + restricted-persona negatives)

- Capability:          Training documentation for the 2026-10-16/17 batch (dispatch #2113/#2116/#2110, Scan balance state, read-only Manufacturers, Customers portfolio message) — final sign-off item
- Agent/session:       Claude Code EOS controller · Role: builder
- Branch / worktree:   `docs/training-dispatch-and-exit-2026-10-17` · `D:/eos-training`
- Base commit:         `ef199c11`
- Owned paths:         `docs/user-guide/{README.md,dispatch/**,inventory/scan-workspace.md,inventory/view-manufacturers.md,accounts-customers/browse-and-search-customers.md}`
- Shared paths req'd:  none (PR-2 owns `docs/user-guide/administration/view-an-employee-work-schedule.md`)
- Dependencies:        #2110 and Scheduling PR-2 merged; guides verified against the deployed app
- Expected outcome:    end-user guides match the shipped behavior
- Protected boundaries:none
- Lifecycle stage:     MERGED `ad2cae77` (#2122) (docs) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Firebase exit lane (O-1, DECISIONS #234) — PR-A unrouted Technicians chain, PR-B dormant / flag-dead clients, PR-C Timestamp-only types; read-only investigations of the 27 no-client write callables, the bin dual path and the operator inventory checklist (Owner decisions 2026-10-15)
- Agent/session:       Claude Code Firebase-exit lane session · Role: builder; Lane D: independent reviewer
- Branch / worktree:   `work/eos-firebase-exit` (PR-A, then B and C serialized on it) · `D:/eos-fb-exit`
- Base commit:         `93bec3b7` (PR-A refreshed onto main `3f5ed759`)
- Owned paths:         the deleted Technicians chain and the PR-B / PR-C files named in each PR · `docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md`
- Shared paths req'd:  this registry · `docs/architecture/firebase-exit-baseline.json` · `docs/architecture/firebase-shim-consumer-census.json` · `scripts/firebaseExitGuard.test.mjs` · `scripts/firebaseShimBoundary.test.mjs` (ratchet pins — every other Firebase-exit PR must rebase and recount)
- Dependencies:        none; A → B → C serialized because each edits the baseline and the pins
- Expected outcome:    exit baseline 265 → 261 (A) → 257 (B) → 247 (C) with no runtime change; investigation report to the coordinator
- Protected boundaries:no production change, Firebase deploy, undeploy or authentication cutover; no merge without exact-head Owner authorization
- Lifecycle stage:     MERGED — PR-A #2109 `931c8af8`, PR-B #2114 `6a677c42`, PR-C #2115 `5eeaaf07` (baseline 247); nonprod deployed and verified

- Capability:          Dispatcher Board: governed-zone grid + capability-gated placement controls (Owner "CONTINUE AND RECONCILE TRACKER" item 8, 2026-10-16, DECISIONS #240)
- Agent/session:       Claude Code EOS controller · Role: builder; Lane D: independent reviewer
- Branch / worktree:   `fix/board-zoned-grid-capability-controls` · `D:/eos-dispatch-fix`
- Base commit:         `6a677c42`
- Owned paths:         `domain/boardClock.js` · `domain/{dispatchBoardGeometry,dispatchBoardUrlState,schedulingWorkspace,zonedTime}.js` (clock routing only) · `modules/dispatcherBoard/{DispatcherBoard,DispatchViews,DispatchLaneGrid,ReadyToScheduleQueue}.jsx` · `functions/src/eosOps/companyAuthority.ts` (readMyCompanyAuthority businessTimeZone) · their tests
- Shared paths req'd:  this registry · `docs/DECISIONS.md` · `docs/governance/precedence-sweep.json` · `test/suites.json` · `.github/workflows/dispatch-north-star-tests.yml` · `functions/test/rentalPostgres.test.mjs` (one assertion)
- Dependencies:        none blocking; #2110 owns the tenant-wide availability-read follow-up
- Expected outcome:    grid in the company's zone; Schedule controls only for schedule-capability holders
- Protected boundaries:standing delivery authority (green exact-head CI + Lane D); no grant, role, identity, Firebase or production change
- Lifecycle stage:     MERGED `ef199c11` (#2116); nonprod Render+Vercel deployed and verified 2026-10-17

- Capability:          Jobs + Dispatcher Board on one governed scheduling path; Schedule dialog defaults to a valid future time (Owner "FIX JOBS AND DISPATCH" 2026-10-16, DECISIONS #239)
- Agent/session:       Claude Code EOS controller · Role: builder; Lane D: independent reviewer
- Branch / worktree:   `fix/jobs-dispatch-and-schedule-default` · `D:/eos-dispatch-fix`
- Base commit:         `5e4afa12`
- Owned paths:         `modules/dispatch/Dispatch.jsx` · `modules/dispatcherBoard/{DispatcherBoard,PlacementDialog,ReadyToScheduleQueue}.jsx` · `modules/dispatcherBoard/usePlacementCommands.js` · `domain/{jobsDispatchList,zonedTime}.js` · `functions/src/eosOps/workOrderAvailability.ts` (suggestWorkOrderPlacement only) · their tests
- Shared paths req'd:  this registry · `docs/DECISIONS.md` · `docs/governance/precedence-sweep.json` · `workOrderOperations.ts` / client op lists · `.github/workflows/dispatch-north-star-tests.yml` · `test/suites.json` · `index.css` (3 Jobs rules)
- Dependencies:        coordinated with Scheduling PR-2 (it edits workOrderAvailability.ts elsewhere; holds DECISIONS #238) and the Firebase-exit lane (AuthContext untouched)
- Expected outcome:    Jobs dispatches/schedules; dialog never opens on a past time; same commands/authority/availability on both surfaces
- Protected boundaries:no merge or deploy without Owner exact-head authorization; no role, grant, identity, migration or Firebase change
- Lifecycle stage:     MERGED `3f5ed759` (#2113); nonprod deployed and verified

- Capability:          P0 rental company security — all 18 /operations/rental operations under EOS Core company authority (Owner rulings D1–D8 2026-10-15, DECISIONS #236)
- Agent/session:       Claude Code EOS controller / security lane · Role: builder; Lane D: independent reviewer
- Branch / worktree:   `work/eos-rental-company-security` · `D:/eos-sec-rental`
- Base commit:         `93bec3b7`
- Owned paths:         `functions/src/eosRental/rental.ts` · `rentalOperations.ts` · `functions/src/eosOps/companyAuthority.ts` (readMyCompanyAuthority) · `functions/src/eosExperience/workspaceOperations.ts` · `myWork.ts` (rental actor) · `field-ops-app-vite/src/modules/rental/RentalWorkspace.jsx` · `services/workspaceApiClient.js` · `functions/scripts/rentalCompanyBindingIntegrity.mjs` · their tests
- Shared paths req'd:  this registry · `docs/DECISIONS.md` · `docs/governance/precedence-sweep.json`
- Dependencies:        #2105 (merged `93bec3b7`, DECISIONS #235)
- Expected outcome:    no cross-company rental read, write or replay; out-of-company == missing; Finance-withheld receivables
- Protected boundaries:security PR — no merge or deploy without Owner authorization; no role, grant, identity or employee change
- Lifecycle stage:     MERGED `94f420c4` (#2107); nonprod deployed; runtime proof partial (cross-company untestable live; D5 PARTIAL)

- Capability:          G-9 scheduling company security — schedule commands under EOS Core company authority (Owner authorization 2026-10-15, DECISIONS #237)
- Agent/session:       Claude Code EOS controller / security lane · Role: builder; Lane D: independent reviewer
- Branch / worktree:   `work/eos-g9-schedule-company-security` · `D:/eos-sec-g9`
- Base commit:         `7a1c4cd7`
- Owned paths:         `functions/src/eosOps/workOrderAvailability.ts` (command company checks) · `functions/test/workOrderAvailabilityPostgres.test.mjs`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` · `docs/governance/precedence-sweep.json` (rebase after #2107, which also appends to DECISIONS)
- Dependencies:        #2105 (DECISIONS #235) merged; Scheduling PR-2 waits on this
- Expected outcome:    no cross-company schedule or unavailability write; out-of-company == missing; no mutation on refusal
- Protected boundaries:security PR — no merge or deploy without Owner authorization; no role, grant, identity or employee change
- Lifecycle stage:     MERGED `5e4afa12` (#2111); nonprod deployed and verified (cross-company PG-proven; no live Ventana data)

- Capability:          EOS Core Company Authority V1 — Analysis / My Work company isolation (Owner security ruling 2026-10-15, DECISIONS #235)
- Agent/session:       Claude Code EOS controller / Lane B session · Role: builder; Lane D: independent reviewer
- Branch / worktree:   `work/eos-analysis-company-isolation` · `D:/eos-sec-isolation`
- Base commit:         `a1261486`
- Owned paths:         `functions/src/eosOps/companyAuthority.ts` (new) · `functions/src/eosAnalysis/analysis.ts` (companyScope / finance consolidated rule) · `functions/test/analysisPostgres.test.mjs` · `functions/test/myWorkPostgres.test.mjs`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` · `docs/governance/precedence-sweep.json`
- Dependencies:        #2099 (merged; security acceptance OPEN until this passes authenticated runtime tests)
- Expected outcome:    Analysis and My Work show only the caller's authorized companies; none = refused; Finance's stricter rule unchanged
- Protected boundaries:security PR — no merge or deploy without Owner authorization; no role, grant, identity or employee change
- Lifecycle stage:     MERGED `93bec3b7`; runtime-accepted (F-1 closed for tested Taylor-home personas)

- Capability:          Scheduling lane — Employee Work Schedule in Employee Administration + scheduler→Employee navigation + compact board treatment + Dispatch Map review (Owner requirements 2026-10-15)
- Agent/session:       Claude Code Scheduling lane session · Role: builder (design first)
- Branch / worktree:   `work/eos-employee-work-schedule-tab` (PR-2) · `D:/eos-shift-schedule`; PR-1 `work/eos-employee-shift-schedule` merged as #2108
- Base commit:         `5e4afa12` (main incl. G-9 #2111)
- Owned paths:         `docs/architecture/employee-work-schedule-design.md`; after Owner plan approval: `field-ops-app-vite/src/modules/dispatcherBoard/**` (except `DispatchViews.jsx` view-chip lines Lane A2 reserves), `field-ops-app-vite/src/domain/dispatchBoardGeometry.js`, the `.ns-dispatch*` rules in `index.css`, a new Work Schedule tab component under `modules/administration/`, their tests
- Shared paths req'd:  this registry · `modules/administration/UserDetail.jsx` (one tab entry) · `functions/src/eosOps/workOrderAvailability.ts` + `workOrderOperations.ts` (PR-2: one new read, `readEmployeeWorkSchedule`); NOT `companyAuthority.ts` or other security-lane files; NOT `config/environments.json`
- Dependencies:        Owner decisions SCH-D1..D4 in the design doc; Lane UX shared compact components (reuse, not fork)
- Expected outcome:    governed schedule visible/editable from the Employee record; board names link by employeeId with return state; subdued elapsed time; nonworking / unconfigured time drawn, never defaulted
- Protected boundaries:no schema, permission, role or business-rule change and no merge/deploy without Owner approval
- Lifecycle stage:     PR-1 MERGED `7a1c4cd7` (#2108); PR-2 MERGED `e4d8c1ef` (#2119), editing held behind `EMPLOYEE_SCHEDULE_EDIT_READY` (off); PR-3 needs re-scoping after #2118 (lane names open the in-board review) — Owner packet; PR-4 deferred

- Capability:          Lane A (Employee UX) — My Work #172 correction, split frontend-first (Owner decision 2026-10-15)
- Agent/session:       Claude Code Lane A session · Role: builder
- Branch / worktree:   `fix/mywork-172-frontend-dual-shape` · `D:/eos-lane-a` (frontend, merges FIRST); `fix/mywork-count-totals-172` · `D:/Taylor_Parts-wt-mywork` (API, #2099, merges only after the frontend is verified on nonprod Vercel)
- Base commit:         `e86fbfeb4`
- Owned paths:         `field-ops-app-vite/src/modules/workspace/MyWorkspace.jsx` · `functions/src/eosExperience/myWork.ts` · their tests; Lane A reservations: My Work / navigation / employee home UI
- Shared paths req'd:  this registry
- Dependencies:        none (separate from Lane B #2098, Lane C, the Firebase exit)
- Expected outcome:    sections carry a `hasMore` boolean, never a count; the UI renders both API shapes with no number and no "undefined"
- Protected boundaries:no merge or deploy without Owner authorization; merging to main auto-deploys nonprod (= activation)
- Lifecycle stage:     MERGED — frontend #2102 `51204356`, API #2099 `a1261486` (hasMore)

- Capability:          Filtering lane — site-wide object filtering and sorting standard (Owner requirement 2026-10-15); design first, Work Orders reference implementation only after the Owner approves the metadata contract
- Agent/session:       Claude Code Filtering lane session · Role: builder
- Branch / worktree:   `work/eos-object-filter-sort-standard` · `D:/eos-filter-sort`
- Base commit:         `93bec3b7`
- Owned paths:         `docs/architecture/object-filter-sort-standard.md`; `functions/src/eosOps/listQuery.ts`, `functions/src/eosOps/workOrderListQuery.ts`, the `listWorkOrders` / `describeWorkOrderListQuery` path in `workOrderQueries.ts`; `functions/test/support/workOrderListQuerySuite.mjs`; `field-ops-app-vite/src/metadata/listUrlState.js` (IN serialization); the `searchable` seed derivation in `scripts/buildAdminPolicySeedSnapshot.mjs`
- Shared paths req'd:  this registry; `docs/DECISIONS.md` via the coordinator; Lane UX shared compact components (PageHeader, Toolbar, InfoTip/FieldHelp, StatusBadge, EmptyState) consumed, not edited
- Dependencies:        security lane company authority (`eosOps/companyAuthority.ts`, DECISIONS #235) — consumed, not edited; Lane A owns My Work/navigation; Lane Scheduling owns the dispatch board
- Expected outcome:    approved metadata contract + server-validated filter/sort for Work Orders, then the reusable mechanism across object-backed lists
- Protected boundaries:no role/grant/authority change, no Firebase dependency, no merge or deploy without Owner authorization; server query validation is security-sensitive (Owner approves the contract first)
- Lifecycle stage:     Phase 1a MERGED `fbe58115` (#2110) incl. availability-read isolation; nonprod deployed and verified 2026-10-17

- Capability:          Cloud Agent environment — local PostgreSQL + EOS API + Vite (no Firebase)
- Agent/session:       Cursor Cloud · Role: builder
- Branch / worktree:   `cursor/cloud-agent-pg-vite-env-f264` · `/workspace`
- Base commit:         `59c68b0cc3d43d544a738e84e8c2563c0328c8a1`
- Owned paths:         `.cursor/`
- Shared paths req'd:  `AGENTS.md` (Cursor Cloud section) · this registry
- Dependencies:        none
- Expected outcome:    Cloud Agents install and boot a working non-Firebase sandbox (Postgres, EOS API `/health`, Vite)
- Protected boundaries:no production credentials, no Firebase, no deploy
- Lifecycle stage:     MERGED `fc8baf26` (#2090) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Workflow Assignments / Workflow Builder separation (Owner approved 2026-10-08)
- Agent/session:       Codex · Role: builder
- Branch / worktree:   `fix/admin-workflow-assignments` · `/workspace/scratch/f00b6258444d/Taylor_Parts`
- Base commit:         `34a7658b`
- Owned paths:         `src/modules/administration/AdminWorkflows.jsx`, new workflow assignment/builder components and their component tests (under `field-ops-app-vite`); workflow user guide and review finding
- Shared paths req'd:  workflow CI path filters, `docs/DECISIONS.md` and this registry; no overlap with reserved navigation paths; existing Administration route and access gates retained
- Dependencies:        existing immutable workflow version commands and policy reads
- Expected outcome:    Main workflow page focuses on role assignments; authoring/validation/lifecycle are a separate Builder page
- Protected boundaries:no live assignments, grants, migrations, Firebase work, merge or deployment
- Lifecycle stage:     MERGED `eab6d3dd` (#2035) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Administration IA redesign — Phase 1 navigation regroup (DECISIONS #211) + Permissions destination (#212, branch `feat/admin-permissions-destination`, stacked)
- Agent/session:       Claude (Claude Code, 2026-10-08) · Role: builder
- Branch / worktree:   `feat/admin-ia-nav-regroup` · `D:/Taylor_Parts-admin-ia`
- Base commit:         `9bb53a3f` (origin/main)
- Owned paths:         `field-ops-app-vite/src/navigation/AppRail.jsx` · the Administration grouping block in `navConfig.js`
- Shared paths req'd:  `field-ops-app-vite/src/navigation/navConfig.js` (administration subnav display names only) · `test/administrationPortalNav.test.mjs` · `test/appRailActiveServiceGroup.test.jsx`
- Dependencies:        none
- Expected outcome:    Administration rail shows the approved IA; no route, gate or surface change
- Protected boundaries:none crossed; the Permissions destination's surface-map row is deferred to an Owner decision
- Lifecycle stage:     MERGED Phase 1 `cf9d111d` (#2026) and Permissions destination `82de2ab5` (#2027) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Email Connections phase 2 — REAL Microsoft 365 / Google Workspace delivery and attachment byte custody, on top of the phase 1 intake capability (PR #1811)
- Agent/session:       Claude (Claude Code, 2026-09-05) · Role: builder
- Branch / worktree:   `feature/email-provider-delivery` · `D:/Taylor_Parts-eos` — STACKED on `feature/email-connections-inbound-work` (PR #1811, open at `d6e4b1de`)
- Base commit:         `d6e4b1deedbf859b52df542a218bdcf9465621e6` (PR #1811 head; origin/main was `e62b16ba` and unmoved)
- Owned paths:         `functions/src/inboundWork/provider*.ts` · `microsoftGraphTransport.ts` · `gmailTransport.ts` · `attachmentCustody.ts` · `emailConnectionCommands.ts` · `emailDeliveryService.ts` · `emailDeliverySchedule.ts` · `emailTransportCallables.ts` · `functions/test/emailTransport*.test.mjs` · `storage.rules` · `docs/deployment/email-provider-setup.md`
- Shared paths req'd:  `functions/src/types/access.ts` + `access/auditEventWriter.ts` (eight additive AuditActions, both mirrors) · `functions/src/constants/collections.ts` (two additive collections) · `functions/src/index.ts` · `functions/src/inboundWork/inboundWorkReadService.ts` (additive projections) · `functions/package.json` + lock (one dependency: @google-cloud/secret-manager) · `firebase.json` (3-line storage-rules wiring) · `field-ops-app-vite/src/access/inboundWorkSource.js` + the two email screens + their tests · `.github/workflows/inbound-work-tests.yml` (extended, not duplicated) · `docs/architecture/email-connections-and-inbound-work.md` + both user guides · `docs/DECISIONS.md` (#177) · this registry
- Dependencies:        PR #1811 must merge first — this branch contains its commits. It adds NO capability, NO Role and NO firestore.rules change of its own.
- Expected outcome:    a real mailbox is connected through a consented, read-only OAuth grant; new mail reaches Service → Inbound Work automatically with its attachment bytes held by EOS; Accept still produces exactly one governed Work Order; failures are visible, classified and retryable.
- Protected boundaries:reached and NOT crossed — NO `firestore.rules` edit. `storage.rules` is NEW and denies every client (strictest possible), wired into firebase.json but NOT deployed. NO production OAuth binding, NO production polling, NO production attachment ingestion: every transport callable and the scheduler refuse the production project from the runtime's own identity before authority is evaluated. NO deploy, NO capability activation, NO grant, NO production data touched, NO Certification fixture altered.
- Lifecycle stage:     MERGED `32bd8270` (#1813, which superseded #1812); repo-only, no tenant binding, no deploy -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Email Connections + Inbound Work — base EOS email intake: connect a Microsoft 365 / Google Workspace mailbox, review what arrives, accept it into one governed Work Order without re-typing it
- Agent/session:       Claude (Claude Code, 2026-09-05) · Role: builder
- Branch / worktree:   `feature/email-connections-inbound-work` · `D:/Taylor_Parts-eos`
- Base commit:         `e62b16baec450fb6e8430560cefe250fdb79a2db` (origin/main at start, unmoved when taken)
- Owned paths:         `functions/src/inboundWork/**` · `functions/test/inboundWork*.test.mjs` · `functions/scripts/fixtures/inboundWorkFixtures.mjs` · `functions/scripts/seedSandboxInboundWork.mjs` · `field-ops-app-vite/src/access/inboundWorkSource.js` · `field-ops-app-vite/src/access/useGovernedCapabilities.js` · `field-ops-app-vite/src/modules/service/InboundWorkWorkspace.jsx` · `field-ops-app-vite/src/modules/administration/AdminEmailCommunications.jsx` · `field-ops-app-vite/test/inboundWork*` · `docs/architecture/email-connections-and-inbound-work.md` · `docs/user-guide/administration/set-up-email-connections.md` · `docs/user-guide/work-orders/review-inbound-work.md` · `.github/workflows/inbound-work-tests.yml`
- Shared paths req'd:  `functions/src/access/permissionCatalog.ts` + `governedBusinessRoles.ts` + `roleHierarchy.ts` + `trustedWriterCommands.ts` (six additive capability registrations, two additive governed Roles; client mirrors regenerated via syncAccessContracts) · `functions/src/types/access.ts` (AuditAction union) + `auditEventWriter.ts` (runtime mirror) · `config/environments.json` + `environmentCapabilityOverrides.ts` (sandbox activation; both must agree) · `functions/src/constants/collections.ts` · `functions/src/index.ts` · `functions/src/createWorkOrder.ts` (three OPTIONAL inbound-provenance fields on the shared create core, no behaviour change for any existing caller) · `field-ops-app-vite/src/navigation/navConfig.js` + `App.jsx` + `index.css` (two nav destinations, two route branches, layout-only CSS) · this registry
- Dependencies:        none — composes the existing governed Work Order create core, the trusted effective-access feed, the audit writer, and the Work Order wizard's own customer / location / equipment pickers
- Expected outcome:    an authorized Service employee takes a sandbox inbound warranty email through review to exactly one governed Work Order, with the message, attachments, warranty reference and matched records carried across, full audit evidence, thread and duplicate protection, and base EOS working with no VDX
- Protected boundaries:reached and NOT crossed — NO `firestore.rules` edit (all four new collections are denied to every client by rule absence, the same posture `performance_goals` and `crm_activities` already have). NO deploy, NO production activation, NO capability grant executed against a live environment, NO production data touched, NO Certification fixture or evidence altered. All six capabilities registered `active:false`; sandbox activation is declared in the repository only and its deploy is Owner-executed.
- Lifecycle stage:     MERGED `c051af0c` (#1811); repo-only, not deployed -- reconciled 2026-10-23 from GitHub PR state

- Capability:          EOS dashboard personalization + performance management — the Performance Goal Authority, the persona dashboard framework, and the sandbox operating story behind them
- Agent/session:       Claude (Claude Code, 2026-09-02) · Role: builder
- Branch / worktree:   `claude/eos-dashboard-personalization-d77a66` · `D:/Taylor_Parts/.claude/worktrees/eos-dashboard-personalization-d77a66`
- Base commit:         `fd40ff5d89321ca72b4a65ddd3f4df0480eebe7f` (origin/main at start, unmoved when taken)
- Owned paths:         `functions/src/performance/**` · `functions/test/performanceGoal.test.mjs` · `functions/scripts/seedSandboxPerformanceStory.mjs` · `functions/test/sandboxPerformanceStory.test.mjs` · `docs/governance/eos-dashboard-composition-authority.md` · `docs/north-star/my-dashboard/**` · `field-ops-app-vite/src/modules/dashboard/**` · `.github/workflows/performance-goal-tests.yml`
- Shared paths req'd:  `functions/src/access/permissionCatalog.ts` + `governedBusinessRoles.ts` + `compatibilityRoles.ts` + `roleHierarchy.ts` + `trustedWriterCommands.ts` (additive grants only; regenerated client mirrors via syncAccessContracts) · `functions/src/types/access.ts` (AuditAction union) + `auditEventWriter.ts` (runtime mirror) · `config/environments.json` + `environmentCapabilityOverrides.ts` + `scripts/resolveEnvironment.mjs` (sandbox activation, all three must agree) · `functions/src/constants/collections.ts` · `functions/src/index.ts` · `docs/DECISIONS.md` (appended #161, #162) · `docs/architecture/SYSTEM_AUTHORITIES.md` (appended) · this registry
- Known collision:     PR #1724 (`codex/financials-visual-system-pilot`) is OPEN and its content has ALREADY LANDED on main through #1739/#1741/#1742 — it is a duplicate, not a live parallel writer. This workstream still avoids every path it owns (`index.css`, `visualSystem.test.mjs`, `buttonForegroundContrast.test.mjs`, `financialsSurface.test.mjs`, `VISUAL-SYSTEM.md`) and does not redesign the visual system, per the Owner's direction §K.
- Dependencies:        the dashboard reporting authority census (#1740, merged `203848a1`) — every metric's classification and blocker traces to it; FIN-003 `planVsActual.ts` and FIN-007 `financialApprovals.ts`, both composed rather than modified
- Expected outcome:    dashboards that answer what do I need to do / how am I performing against goal / what impact am I having, composed from existing domain authority at existing scope, with every ungoverned figure rendering an honest unavailable state that names its blocker
- Protected boundaries:reached and NOT crossed — NO firestore.rules edit (the deny-all block for `performance_goals` is PREPARED for the Owner; the collection is already denied by rule absence). NO deploy, NO production activation, NO capability grant executed against a live environment, NO production data touched. All five `performance.goal.*` capabilities registered `active:false`; sandbox activation declared in the repo only, and its deploy is Owner-executed.
- Lifecycle stage:     **CLOSED 2026-09-04 — OWNER ACCEPTED, LIVE VERIFIED.** Both families are shut: My Dashboard CLOSED/ACCEPTED 2026-09-03 with its post-acceptance correctives now LIVE VERIFIED, and Technician Dashboard (migration ledger Family 11) CLOSED/ACCEPTED/LIVE VERIFIED. Live `platform-sandbox` Hosting `6b281cd5`, carrying #1793 `761c0471`, #1795 `f066f450`, #1796 `dbaca853` and #1799 `6b281cd5` — each verified an ancestor of the live commit. Training COMPLETE. Production NOT authorized and NOT touched; a sandbox acceptance authorizes nothing beyond the sandbox. Still open and deliberately so: the technician self-goal-read authority (its own package) and the inverted Work Order completion evidence in the sandbox dataset (data-quality, non-blocking).


- Capability:          EOS site-wide visual-system rollout — promote the accepted Financials pilot to the whole authenticated application
- Agent/session:       Claude (Claude Code, 2026-09-02) · Role: builder — HANDED OVER FROM Codex `/root` (ChatGPT Work, 2026-09-02), which built the pilot as commit `ba4ce623`
- Handover:            The Owner accepted the pilot as the presentation standard and directed the site-wide rollout in this session. Codex's pilot scope is SUPERSEDED, not abandoned: `ba4ce623` remains the first commit on the branch and this session continues on the same branch and the same PR (#1724) rather than opening a parallel visual-system PR. No concurrent writer: `origin/main` was unmoved at `b1ff470b` and the pilot branch was one commit ahead of it when this session took ownership
- Branch / worktree:   `codex/financials-visual-system-pilot` (PR #1724) · `D:/Taylor_Parts/.claude/worktrees/eos-visual-system-rollout-ecf1a8`
- Base commit:         `b1ff470bb596843561883444ab7904bcbcab9a20` · pilot head inherited: `ba4ce623ac78fd8b5ea54297ae4478298c694718`
- Owned paths:         `field-ops-app-vite/src/index.css` (the `:root` token layer and the promoted shared type rules) · `field-ops-app-vite/src/navigation/AppShell.jsx` (pilot seam removed) · `field-ops-app-vite/src/firebase/firebase.js` (DEV-only emulator port override) · `test/visualSystem.test.mjs` · `test/buttonForegroundContrast.test.mjs` · `test/financialsSurface.test.mjs` · `test/suites.json` · `.github/workflows/visual-system-tests.yml` · `.claude/skills/run-field-ops-app-vite/{visualSweep.mjs,driver.mjs,seed.mjs}` · `docs/north-star/VISUAL-SYSTEM.md`
- Shared paths req'd:  this registry · `docs/design/eos-north-star-design-grammar.md` (dated amendment only, extraction table preserved) · `docs/design/north-star-migration-ledger.md` (appended, never rewritten) · one dated pointer in `docs/north-star/service-operations/DESIGN-HANDOFF-SERVICE-OPERATIONS-P1.md`
- Dependencies:        the accepted pilot `ba4ce623`; merged Financials P1 composition through PR #1723
- Expected outcome:    ONE coherent EOS presentation system inherited globally from `:root` and the shared primitives — no family seam, no page-local palettes — plus the canonical North Star schema document and the conformance tests that keep a future design from silently reverting to the off-white, low-contrast palette
- Protected boundaries:sandbox Hosting deploy ONLY (Owner-authorized for the final reviewed commit). NO Functions, Rules, indexes, extensions, data/fixtures, production Hosting, or any other Firebase project. No capability/grant/role change, no route, workflow, data-model or state-machine change. NO MERGE — stop at `AWAITING_OWNER_VISUAL_ACCEPTANCE`
- Lifecycle stage:     CLOSED WITHOUT MERGE 2026-10-13 (#1724; Owner-authorized backlog cleanup, superseded by the later accepted UI implementation) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Overnight Tier-1 program — Opportunity write paths, Sales Order fulfillment view, Part identifiers, roadmap reconciliation
- Agent/session:       Claude (overnight autonomous program, 2026-08-20) · Role: builder
- Branch / worktree:   sequential single-writer lanes off `origin/main`; one isolated worktree used only for the #1061 trial merge, removed afterwards
- Base commit:         `969305e1` (start) → `d7592671` (after #1341 and #1342)
- Owned paths:         functions/src/opportunity/ · functions/src/salesOrder/salesOrderReadService.ts · field-ops-app-vite/src/domain/salesOrderFulfillmentProgress.js · field-ops-app-vite/src/modules/sales/ · field-ops-app-vite/src/shared/partMaster/PartIdentifiersSection.jsx · docs/orchestration/lib/roadmapModel.mjs
- Shared paths req'd:  functions/src/types/access.ts (AuditAction union) · functions/src/access/auditEventWriter.ts (runtime mirror) · functions/package.json · docs/orchestration/execution-backlog.md · this registry
- Dependencies:        none blocking; ran sequentially so no two writers shared a branch or checkout
- Expected outcome:    governed Opportunity edit + atomic close-as-WON, Sales Order index mounted, fulfillment progression, Part identifier surface, roadmap truthful against main
- Protected boundaries:reached and NOT crossed — no deploy, no capability activation, no role grant, no Rules change, no provisioning, no sandbox or production data mutation. The emulator was local only and stopped.
- Lifecycle stage:     MERGED #1341 and #1342 (2026-08-20); repo-only, nothing deployed or activated -- reconciled 2026-10-23 from GitHub PR state


- Capability:          EOS cost/capacity semantic correction (#831 regression)
- Agent/session:       Codex `/root` · Role: builder
- Branch / worktree:   `codex/eos-cost-capacity-semantics` · `D:\Taylor_Parts-cost-capacity`
- Base commit:         `e111b4b`
- Owned paths:         EOS cost/capacity contract and focused wake/intake tests
- Shared paths req'd:  wake/intake status/runtime wiring · intake CI · this registry
- Dependencies:        Durable #831 status/result and existing provider-neutral capacity contracts
- Expected outcome:    Billed spend, modeled cost, and provider capacity remain distinct; synthetic Claude dollars cannot stop uncapped subscription work
- Protected boundaries:No #831 rerun, provider activation, credential, routing, integration, deployment, or automatic merge
- Lifecycle stage:     MERGED `f7b5b390` (#832) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Cortex EOS provider adapter pilot (read-only, provider-neutral)
- Agent/session:       Codex `/root` · Role: builder
- Branch / worktree:   `codex/cortex-provider-pilot` · `D:\Taylor_Parts-cortex-provider-pilot`
- Base commit:         `49451d899e80191940f577645f63a2cfde2f42a7`
- Owned paths:         `docs/orchestration/lib/cortexProviderAdapter*`
- Shared paths req'd:  `.github/workflows/orchestration-agent-manager-tests.yml` · this registry
- Dependencies:        Existing AgentRequest, AgentResult, Verifier, and governed work-intake result contracts
- Expected outcome:    One bounded READ_ONLY_PILOT Cortex worker can return attributable, verified, durable EOS results without changing Claude
- Protected boundaries:No live provider activation, credential use, mutation, approval, integration, deployment, or merge
- Lifecycle stage:     MERGED `f155d04e` (#828) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          EOS implementation write-back isolation + governed patch integration
- Agent/session:       Codex `/root` · Role: builder/integration
- Branch / worktree:   `codex/eos-implementation-writeback` · `D:\Taylor_Parts-eos-implementation-writeback`
- Base commit:         `0f5bc8d0a496e5590ffbd0c6c23ebba3f418c911`
- Owned paths:         EOS issue/runtime/integration workflows · `intakePatch*` · `intake-artifactize*` · `intake-patch-integrate*`
- Shared paths req'd:  `docs/DECISIONS.md` · this registry · work-intake README/test wiring
- Dependencies:        PR #814 artifact-only guard; recovered #818/#819 sessions under `D:/Taylor_Parts-diagnostics-818-819/`
- Expected outcome:    Isolated Claude mutations become governed report/patch artifacts; only separately approved exact patches may integrate
- Protected boundaries:No automatic patch application, force push, permission expansion, blind stash, Claude rerun, or merge before independent review
- Lifecycle stage:     MERGED `9b9540b8` (#821) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          [CLOSED — DONE 2026-08-12] GitHub Issue → EOS runtime write-back hardening after Issue #813; PR #814 merged; fresh Issue #815 COMPLETE
- Agent/session:       Codex `/root` · Role: builder/integration
- Branch / worktree:   `codex/eos-issue-runtime-hardening` · cleaned after merge
- Base commit:         `15da76e6fb7801f1fe739fc6fcddf71c87233b6d`
- Owned paths:         `.github/workflows/eos-issue-intake.yml` · `docs/orchestration/context/issue-intake-writeback*`
- Shared paths req'd:  `docs/engineering/ACTIVE_WORKSTREAMS.md` · `.github/workflows/eos-intake-ingest.yml` only if test wiring requires it
- Dependencies:        Merged PR #811 adapter; Issue #813 failure evidence; existing hash-pinned status contract
- Expected outcome:    DONE — runtime reasons exposed; current-request artifact allowlist enforced; unexpected edits fail closed; fetch/rebase/push hardened; live artifact-only completion verified by Issue #815
- Protected boundaries:No credential, deployment, production-data, or authorization-model change; fresh validation Issue only after merge
- Lifecycle stage:     OPERATIONALLY VERIFIED

- Capability:          [CLOSED — DONE 2026-08-10] PR #790 final exact-head evidence closure (CONCUR result `98171802aa2c2031d689455ee02075ea045e3775566c0fdc07290385aa7ba279`; PR #790 merged as `1a496939f5025a75b9757b969e57642b86137416`)
- Agent/session:       Codex `/root` · Role: integration/evidence
- Branch / worktree:   `agent/pr790-final-evidence` · `D:\Taylor_Parts\.worktrees\pr790-final-evidence`
- Base commit:         `564c7de` · corrected subject PR #790 head `8a71f7cd3006fc149c7a80c52967a1643935ac7d`
- Owned paths:         `docs/orchestration/reviews/evidence/pr-790/**` · final evidence generator/tests
- Shared paths req'd:  `.github/workflows/reciprocal-gpt-review.yml` · `docs/orchestration/context/github-fact-review.mjs` · this registry
- Dependencies:        Prior result `65c529fa92ab213180cba439277f2cf2b6945f5d3268261031ca21a773373e37`; GitHub exact commit/blob API; existing FACT_BASED workflow
- Expected outcome:    GitHub-verifiable path/blob binding plus named case-level execution evidence for F1–F4, followed by one smallest-possible final delta review
- Protected boundaries:Stop before provider call; no merge, deployment, credential provisioning, or scope expansion
- Lifecycle stage:     DONE

- Capability:          Authenticated ChatGPT → EOS intake credential-boundary evidence remediation (PR #790)
- Agent/session:       Codex `/root` · Role: builder
- Branch / worktree:   `agent/chatgpt-eos-intake-integration` · `D:\Taylor_Parts\.worktrees\chatgpt-eos-intake-integration`
- Base commit:         `abbca0d287ed437b9abd26442e08168555fffc71` (rebased from reviewed `614abf97ef000f89a082139f31231ce8ff2b00ea`)
- Owned paths:         `integrations/chatgpt-eos-intake/**` · `docs/orchestration/lib/{secretProvider,openaiCredentialTransport,reviewAuthorization}*` · PR #790 resolution/delta artifacts
- Shared paths req'd:  this registry
- Dependencies:        Reuses the merged work-intake resolver, selector, Wake Supervisor, aiExchange, review artifacts, and GitHub source-of-truth; OpenAI MCP/OAuth contract
- Expected outcome:    Deterministic resolution of F1–F4, compact content-addressed evidence, then one bounded FACT_BASED delta review
- Protected boundaries:Exactly one delta provider review only after deterministic evidence is complete; no deployment, credential provisioning, production action, or authorization grant
- Lifecycle stage:     MERGED `1a496939` (#790) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          [CLOSED — DONE WHEN THIS CHANGE MERGES] Governed Owner/ChatGPT work-intake bridge (repo-safe minimum)
- Agent/session:       Codex `/root` · Role: builder
- Branch / worktree:   `agent/governed-work-intake` · `D:\Taylor_Parts\.worktrees\governed-work-intake`
- Base commit:         `fe3512f07f0bee4d4654d4fe278f0302326d402c`
- Owned paths:         `docs/orchestration/lib/workIntake.mjs` · `docs/orchestration/lib/workIntake.test.mjs` · `docs/orchestration/context/work-intake.mjs` · `docs/orchestration/context/work-intake.test.mjs` · `docs/orchestration/work-intake/**`
- Shared paths req'd:  `docs/orchestration/agent-requests/README.md` · this registry
- Dependencies:        Reuses `selectNextWork`, Wake Supervisor state contract, Agent Result lifecycle, `aiExchange`, review artifacts, and GitHub-backed provenance; no new runtime or queue
- Expected outcome:    Hash-pinned durable work artifact resolves by ID + location + SHA-256 into the existing selector; compact content-addressed result pointers return to the same durable orchestration surfaces
- Protected boundaries:No live OpenAI/Claude call, deployment, production write, policy/rules/auth change, or unattended runtime activation
- Lifecycle stage:     MERGED `12fe75aa` (#789) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          [CLOSED — DONE 2026-08-09] Owner Roadmap Projection (Continuous Workstream Orchestrator Phase 2; Tier-1 repo-only read-only projection; Owner-directed). Structured durable roadmap model (`docs/orchestration/lib/roadmapModel.mjs`) + pure 8-view projection lib + 14 node:test + drift-guarded CI + committed read-only snapshot (`docs/orchestration/roadmap/ROADMAP.md`) + contract (`roadmap-projection.md`). EOS→Domain→Capability→Milestone→WorkItem→Evidence; preserves IMPLEMENTED≠ACTIVATED / MERGED≠DEPLOYED / BACKEND-COMPLETE≠USER-OPERABLE / UX-COMPLETE≠BACKEND-ACTIVE / PERSONA-FINDING≠PRODUCT-DECISION; no invented %; single source of truth (projections not a 2nd roadmap). NO capability/grant/collection/Rule/UI/DB. Owner opted no Option B.
- Capability:          [CLOSED — DONE 2026-08-09] Continuous Workstream Backlog & Orchestrator (Tier-1 repo-only process governance; Owner-directed). Design + seeded backlog (#703) + Option A `/loop` continuation driver with tested pure selector + zero-dep CI + blocker-decomposition correction (#710) + bounded two-class tool-permission policy (#712). Both returned Owner decisions RATIFIED: Option A adopted (B deferred w/ its design checklist); permission policy ratified. Selection rule run post-merge → terminal CHECKPOINT (no authorized READY; R-1 R1-A prerequisite already exists + CI-enforced, remainder protected). NO capability/grant/collection/Rule. Keystone upstream contribution of the reusable methodology remains a separate-repo follow-up.
- Capability:          [CLOSED — AT REST 2026-08-06] Supplier Master adoption (Tier-2 program, Owner-authorized) — governed Supplier identity + trusted write + Rules(prepared) + purchasing migration compat + Suppliers workspace. Phases S1–S5, repo-only. Repo-complete + fully planned; no further Product Engineering work. Handoff: `docs/releases/supplier-master-sandbox-handoff.md`. Reactivates only on integrated-sandbox readiness, Owner experience review, or a protected promotion authorization. (Tier-2 program, Owner-authorized) — governed Supplier identity + trusted write + Rules(prepared) + purchasing migration compat + Suppliers workspace. Phases S1–S5, repo-only. Repo-complete + fully planned; no further Product Engineering work. Handoff: `docs/releases/supplier-master-sandbox-handoff.md`. Reactivates only on integrated-sandbox readiness, Owner experience review, or a protected promotion authorization.
- Agent/session:       c981623b (Claude Code) · Role: builder
- Branch / worktree:   feat/supplier-master-* · scratchpad/sm-wt (per-phase branches)
- Base commit:         (current main)
- Owned paths:         docs/architecture/supplier-master-architecture.md · functions/src/supplierMaster/** · field-ops-app-vite/src/modules/purchasing/Suppliers.jsx + domain/hooks/tests (later phases)
- Shared paths req'd:  firestore.rules (S2, PREPARED-not-deployed) · functions/src/index.ts (exports) · docs/DECISIONS.md · this registry
- Dependencies:        REUSES partMasterCommands machinery (capability/idempotency/versioning/audit/transaction) + inventory.catalog.manage/.activate; part_supplier_items is the part↔supplier authority (reused, not duplicated); WO snapshot convention for supplierNameSnapshot
- Expected outcome:    governed Supplier business object; Supplier is the catalog-governed owner of the supplierId space part_supplier_items references; reorder_purchase_orders migrates free-text supplierName -> supplierId + supplierNameSnapshot; Suppliers registry workspace; RC package with migration dry-run/rollback. NO production activation.
- Protected boundaries:Rules deploy / Functions deploy / prod supplier create / grants / prod migration / rewriting reorder_purchase_orders / deleting dormant collections / Hosting — ALL deferred to protected packages after sandbox+integration evidence
- Lifecycle stage:     AT REST (RC-1.2; repo-complete + fully planned). MERGED: S1 #596 / S2 validator #598 / S2 commands #600 / S3 workspace #602 / S4 dry-run migration #604 / RC-1 #605 / callables #608 / promotion package #610 / migration EXECUTE tooling #612. Owner accepted §A role DESIGN (durable least-privilege `inventoryCatalogAdministrator`, manage+activate; NOT implemented in code — protected). Verified: validator 12 / commands 8(emu) / suppliersView 5 / linkage 9 / dry-run 3(emu) / callables 11(emu)+export 2 / execute 19 offline+8(emu) + 5 clean design-code-reviews (execute review found 2 HIGH, both fixed+test-locked: postcondition-no-throw-keeps-rollback-artifact; connected-db destination guard). RESTING per Owner: DESIGN/VALIDATOR/COMMANDS/CALLABLES/WORKSPACE/DRY-RUN/EXECUTE-TOOLING(not executed)/RC/PROMOTION-PACKAGE/ROLE-DESIGN all done. WAITING: integrated sandbox (EAO env program) → Owner experience → production promotion (protected/held). NO further Supplier Master work to invent. Owner-experience preview ROUTED to EAO. ALL protected actions held.

> **Standing note.** Concurrent sessions have recently merged without declaring an assignment here
> (PRs #584, #585). Per Operating Model §8 and §8a, declare the capability, branch, **verified base
> commit**, and owned/shared paths **before** writing — that declaration is what makes rules 1–2
> enforceable.

- Capability:          [CLOSED — AT REST 2026-08-07] Part Master in-app governed catalog write (ADR-009 G2). Phase 1 callables (createPart/updatePart/changePartStatus, PR #617, inert) + Phase 2 write workspace (PR #619, main c4121f6: PartMasterList evolved in-place + fail-closed partMasterWriteReadiness + partMasterCommandClient + partMasterWrite domain + usePartMasterWrite). Invariants verified (ONE Part authority / ONE trusted command path / NO client Firestore writes / NO parallel validator / NO parallel status vocab / actor server-derived / readiness fail-closed / honest states). RC `docs/releases/part-master-write-rc.md`; handoff `docs/releases/part-master-sandbox-handoff.md`. Authority reuses inventory.catalog.manage/.activate + the accepted inventoryCatalogAdministrator role design. PART_MASTER_WRITE_READY=false. Repo-complete; no further Product Engineering work. Reactivates only on integrated-sandbox experience review or a protected promotion authorization. (Merging remediated an inherited O-3 CI regression — see `docs/engineering/config-change-ci-coverage-contract.md`.)
- Capability:          [CLOSED — REPO-COMPLETE, READ-BLOCKED 2026-08-07] Manufacturer in-app governed catalog write (catalog reference object Parts link to). Phase 1 callables (createManufacturer/updateManufacturer/changeManufacturerStatus, PR #625, inert) + Phase 2 workspace (PR #626, main a872f92: Manufacturers.jsx + fail-closed manufacturerWriteReadiness + manufacturerCommandClient + manufacturerWrite/manufacturersView domain + useManufacturerWrite). Invariants verified (ONE authority / ONE trusted command path / NO client writes / NO parallel validator/status / actor server-derived / honest states); design-code-review clean. Reuses inventory.catalog.manage/.activate + inventoryCatalogAdministrator design. RC `docs/releases/manufacturer-write-rc.md`; handoff `docs/releases/manufacturer-sandbox-handoff.md`. **READ AUTHORITY WAITING ON R-1** (Owner decision 2026-08-07 option (b) — WAIT: no new legacy isAdminOrDispatcher read site; manufacturers stays `read,write:if false`, workspace read fails closed). Requirement fed to R-1: `docs/assessments/r1-catalog-read-authority-requirement.md` (proposes durable `inventory.catalog.read` for parts/manufacturers/suppliers/part_supplier_items; permission catalog has NO catalog-read cap today). No production/deploy/grant/Rules. Reactivates on the governed catalog-read model + a promotion authorization.
- Capability:          [CLOSED — WRITE/PROJECTION COMPLETE; READ WAITING ON R-1, 2026-08-07] Part↔Supplier procurement terms (`part_supplier_items`) — close the procure-to-stock gap (governed preferred-supplier + cost + lead time instead of free-form). Owner ratified the design + all 5 decisions (cost = SEPARATE `inventory.catalog.cost.read`; personas catalog-admin+purchasing-operator get cost / finance-future / others no-cost / owner-not-inferred; preferred = decision-support-no-auto-select; build write layer now = option (i)). Design `docs/architecture/part-supplier-items-procurement-terms-design.md`; RC `docs/releases/part-supplier-items-rc.md`. **WRITE LAYER MERGED (PR #629, main 77d23b2):** 4 callable adapters (createPartSupplierItem/updatePartSupplierItem/changePartSupplierItemStatus/setPreferredSupplier, inert) + PURE projection contract (`partSupplierItemProjections.ts`: relationship vs cost tiers per Owner §1; cost never leaks; fail-closed) + 13 emu/4 proj/2 export tests; design-review clean (HIGH cost-tier drift fixed). READ SERVICE + Purchasing UI **GATED ON R-1** (`inventory.catalog.read` + `.cost.read`; requirement fed via `docs/assessments/r1-catalog-read-authority-requirement.md`). `part_supplier_items` stays `read,write:if false` (no legacy read site). ALSO fixed a latent main break in #629: #626's repo-only comment in firestore.rules had diverged it from the live-deployed governed hash (ec1f0a9b) — restored byte-identical (LESSON: firestore.rules is hash-anchored to the deploy; no repo-only comments). Next: R-1 read capabilities → build read/projection service → Purchasing UI (all repo-only once R-1 lands) → protected promotion.

- Capability:          Lane HARDEN — review follow-ups (2026-10-20): Q-1a audit text (`shipVia`, `contactRole`, `customerPO` kept), well-formed CRM/Commercial receipt projection, G-1b midnight regression pin, A6 FORBIDDEN fallback pin
- Agent/session:       Claude Code lane HARDEN · Role: builder; controller merges
- Branch / worktree:   `harden/review-followups` · isolated agent worktree
- Base commit:         `237b4897`
- Owned paths:         `functions/src/eosCrm/contactAuthority.ts` · `crmAuthorityKernel.ts` (receipt only) · `functions/src/eosCommercial/commands/commercialCommandKernel.ts` (receipt only) · the `updateDraft` audit in `salesAgreementCommandService.ts` · `functions/test/q1CommercialCrmAuditPostgres.test.mjs` · `g1GoalAuthoringPostgres.test.mjs` · `eosFinance/financeOperations.ts` (readObligation source only) · `financeVisibilityPostgres.test.mjs`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` (#Q-1a text only) · `docs/governance/precedence-sweep.json`
- Dependencies:        none (PR #2168 merged; readObligation aligned)
- Expected outcome:    five small follow-ups pinned by tests
- Protected boundaries:none reached (no capability, no grant, no migration, no Firebase, no production)
- Lifecycle stage:     MERGED `5b2e58d0` (#2178) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Finance F-2 — the EOS finance reads serve every fact family the Firebase AR / Financials surfaces show (payment receipts and applications, the account-narrowed totals, the Sales Order reference), then the F-1 invoicing spec (docs only)
- Agent/session:       Claude Code Lane F · Role: builder; controller merges
- Branch / worktree:   `lane-f/f2-finance-read-families` (PR 1), then `lane-f/f1-invoicing-spec` (PR 2) · `D:/Taylor_Parts/.claude/worktrees/agent-a9e59098281003465`
- Base commit:         `09a82d3e`
- Owned paths:         `field-ops-app-vite/src/services/eosFinancialsClient.js` · `field-ops-app-vite/src/domain/{financialsEos,accountReceivablesEos}.js` · `functions/src/eosFinance/{financeOperations,settlement}.ts` (read shapes only) · `field-ops-app-vite/test/financeFactFamiliesEos.test.mjs` · `docs/architecture/f1-invoicing-spec.md`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` · `field-ops-app-vite/test/suites.json`
- Dependencies:        none (read-only; no capability, migration or grant)
- Expected outcome:    `financeReadCallableClient` has no consumer the EOS path cannot serve; the F-1 decisions are numbered for the Owner
- Protected boundaries:none reached (F-1 build waits on the Owner's answers)
- Lifecycle stage:     PR 1 MERGED `2f8be86f` (#2168); PR 2, the F-1 invoicing specification, is still OPEN as #2175 (F-1a #2184 implemented separately; this row stays open) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Lane Q-1 — quotes and approvals: PR 1 audit on every applied Commercial and CRM command (build); PR 2 the quote / discount approval specification (docs, Owner decisions; nothing of the workflow is built) (B5 matrix stage 6; scenarios A and E)
- Agent/session:       Claude Code lane Q-1 · Role: builder; controller merges
- Branch / worktree:   `q1-commercial-audit` (PR 1) then `q1-quote-approval-spec` (PR 2) · isolated agent worktree
- Base commit:         `b3d09dc3`
- Owned paths:         `functions/src/eosAudit/commandAuditEvent.ts` · the audit calls in `eosCommercial/commands/*CommandService.ts`, the `audit` field of `commercialCommandKernel.ts`, `eosCrm/accountAuthority.ts`, `contactAuthority.ts`, `accountLocationAuthority.ts` · `functions/test/q1*.test.mjs` · `docs/architecture/q1-quote-approval-spec.md`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` · `docs/governance/precedence-sweep.json` · `functions/test/adminPolicySuites.json` · `.github/ci/eos-admin-policy-paths.txt` (lanes F and RES run in parallel; merge main, never drop their entries)
- Dependencies:        none
- Expected outcome:    every applied Commercial / CRM command is audited; the quote and discount approval choices are numbered Owner decisions
- Protected boundaries:none reached (no capability, no grant, no migration, no Firebase, no production)
- Lifecycle stage:     PR 1 MERGED `237b4897` (#2169); PR 2, the specification, is still OPEN as #2172 -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Account page honest refusal wording (UX-2) · a refused work-order read (403 / FORBIDDEN) reads "Not available to you" in Work order attention, Open work orders (standing strip) and Service activity; "Couldn't be read" stays for genuine failures
- Agent/session:       Claude Code lane UX-2 · Role: builder; controller reviews and merges
- Branch / worktree:   `ux2/account-wo-refusal-wording` · isolated agent worktree
- Base commit:         `bfeb6dd8`
- Owned paths:         `field-ops-app-vite/src/modules/accounts/AccountAttentionSection.jsx` · `ServiceActivitySection.jsx` · `src/domain/accountHealthStrip.js` · `serviceActivityView.js` · `accountWorkOrders.js` · `src/hooks/useAccountServiceActivity.js` · `useAccountAttentionWorkOrders.js` · their tests
- Shared paths req'd:  this registry
- Dependencies:        none (display only; a refusal is FORBIDDEN / permission-denied only, so a 401 or missing session stays "couldn't be read")
- Expected outcome:    a refusal never reads as an outage on the Account page
- Protected boundaries:none reached (no capability, grant, migration, Firebase, workflow or production change; no work-order read is granted)
- Lifecycle stage:     MERGED `a9ab16c7` (#2181) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Lane S1b (2026-10-20) — hard stock reservations per operating company AND warehouse: reserve / release / consume / cancel with a lock-ordered no-oversell gate, replay by key + fingerprint, one audit row per applied command, serial Parts refused, readPartBalance per-location reserved / available with NOT_YET_ACTIVATED and SCOPE_PARTIAL
- Agent/session:       Claude Code Lane S1b · Role: builder; controller merges
- Branch / worktree:   `res/s1b-hard-reservations` · `.claude/worktrees/agent-ace14ced7aab07e51`
- Base commit:         `e19dc610`
- Owned paths:         `functions/src/eosOps/inventoryCommitmentRepository.ts` · the reserved/available block of `readPartBalance` in `functions/src/eosOps/partsReads.ts` · `functions/test/{stockReservationPostgres,eosOpsInventoryCommitment*,partBalancePostgres}.test.mjs`
- Shared paths req'd:  this registry · DECISIONS.md · SYSTEM_AUTHORITIES.md · `functions/test/adminPolicySuites.json` · `.github/ci/eos-admin-policy-paths.txt` · small additive edits to Postgres suites that call `readPartBalance`
- Dependencies:        migration `1764710000000_stock-reservation-company-warehouse` (controller-authored, in the PR); S1c (SO allocation command, UI, grants) follows
- Expected outcome:    a hard reservation cannot lack a company or a warehouse, cannot oversell, replays safely and is governed end to end
- Protected boundaries:none reached — no capability, grant, Firebase or production change; activation is an operator row

- Lifecycle stage:     MERGED `0ee9188a` (#2186) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Lane S1c (2026-10-20) — Sales Order allocation on EOS: `allocateSalesOrderLine` / `releaseSalesOrderAllocation` / `readSalesOrderAllocations` on `/operations/inventory` (a hard reservation of a PART line at a company AND warehouse the caller states; capability -> company -> warehouse scope; Part and quantity bound to the line; non-terminal order; releases on cancel / fulfil / close in the order's own transaction); the Sales Order allocation control
- Agent/session:       Claude Code Lane S1c · Role: builder; controller reviews, writes the migration and merges
- Branch / worktree:   `worktree-agent-a5bac7040d1f407d4` · `.claude/worktrees/agent-a5bac7040d1f407d4`
- Base commit:         `0ee9188a`
- Owned paths:         `functions/src/eosOps/salesOrderAllocation.ts` · `functions/test/salesOrderAllocation{Offline,Postgres}.test.mjs` · `field-ops-app-vite/src/modules/sales/SalesOrderAllocation.jsx` · `field-ops-app-vite/src/services/salesOrderCommandClient.js` · `field-ops-app-vite/test/salesOrderAllocation{,Client}.test.*`
- Shared paths req'd:  this registry · DECISIONS.md · SYSTEM_AUTHORITIES.md · `functions/src/eosOps/eosOpsHttp.ts` · `inventoryCommitmentRepository.ts` (additive: joins a caller's transaction) · `functions/src/eosCommercial/commands/salesOrderCommandService.ts` (one release call in `transitionSalesOrder`; Q-1a may touch this file) · `SalesOrderDetail.jsx` (one section) · `reorderApiClient.js` (three names) · `functions/test/adminPolicySuites.json` · `.github/ci/eos-admin-policy-paths.txt` · `.github/workflows/sales-opportunity-tests.yml`
- Dependencies:        S1b (merged, `0ee9188a`); migration `1764714000000_sales-order-allocation-capability` (controller-authored from a `.sql.txt`: registers `salesOrder.fulfill`, grants admin / dispatcher / owner)
- Expected outcome:    a Sales Order line's stock can be set aside at a warehouse the caller chooses, and cannot be set aside for anything else
- Protected boundaries:none reached by this branch — the capability and its grants are the controller's migration; Work Order dispatch is not wired; no production or Firebase change

- Lifecycle stage:     MERGED `85121fd8` (#2189); holders `174ba281` (#2191) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Lane DOC (overnight 2026-10-20) — Service Work Order invoicing policy requirements (B5 gap; prepare only) + fresh Firebase dependency reconciliation against the Owner baseline (no deletion)
- Agent/session:       Claude Code lane DOC · Role: builder (docs and read-only); controller reviews and merges
- Branch / worktree:   `worktree-agent-a96482df91bab3cf0` · `.claude/worktrees/agent-a96482df91bab3cf0`
- Base commit:         `e19dc610`
- Owned paths:         `docs/architecture/service-wo-invoicing-policy-requirements.md` · `docs/firebase-exit/firebase-dependency-reconciliation-2026-10-20.md` · `docs/firebase-exit/reconcile-firebase-deps.mjs` (read-only Node script, standard library only)
- Shared paths req'd:  this registry
- Dependencies:        none (cites open specs F-1 #2175, S1a #2167, T-1 #2173, REC #2174, W-1 #2171 by number only)
- Expected outcome:    the Owner can answer the service-billing policy questions and approve or refuse each Firebase deletion tier against measured counts
- Protected boundaries:none reached (no rate, grant, migration, code, deletion, deploy or production change; DECISIONS.md untouched)
- Lifecycle stage:     MERGED `cbb30946` (#2185) (docs) -- reconciled 2026-10-21 by lane UAT from git log (docs/uat/08-active-workstreams-reconciliation.md)

- Capability:          Lane UAT (2026-10-21) — role x object UAT, phase 1: the Security Role / Business Object census, the EXPECTED access manifest, the persona walkthrough and API-negative plan, the Ventana fixture plan and script, the coverage denominators and the Codex UAT handoff package (docs only; READ-ONLY)
- Agent/session:       Claude Code Lane UAT · Role: builder (docs); controller merges
- Branch / worktree:   `uat/role-object-census` · `.claude/worktrees/agent-ae61b83a1614b03bb`
- Base commit:         `835e5982`
- Owned paths:         `docs/uat/**` (new directory; generator in `docs/uat/tools/`)
- Shared paths req'd:  this registry (lifecycle lines of already-merged rows; one new row)
- Dependencies:        the controller's read-only nonprod census (`D:/eos-lanes/evidence/uat-nonprod-census-2026-10-21.json`); Codex handoff requires #2201 merged; rows marked `after #2200` / `after #2199` depend on DWO / CLC
- Expected outcome:    Codex can run an independent persona-by-persona browser and authorization test against nonprod with exact expectations, and every UNDETERMINED expectation is an Owner question
- Protected boundaries:none reached — no product code, grant, migration, deploy, credential, Postgres run or nonprod write; the Ventana script is run by the controller, not by this lane
- Lifecycle stage:     MERGED `b433d396` (#2202) (docs) -- reconciled 2026-10-23 from GitHub PR state

## Ready for assignment

- **Receiving activation (protected)** — the governed receive workflow now EXISTS (A1, scanner-within-FieldMode, DECISIONS #68) but is fail-closed on `RECEIVING_TRANSPORT_READY = false`. Turning it on is a **protected boundary**: Phase-F readiness flip + authorized Hosting release + the `inventory.stock.receive` grant already live for {admin,dispatcher,owner}. Owner-gated; not a repo-only capability.
- **(Optional) dedicated admin/dispatcher Receiving surface** — A1 placed the governed receive on the scanner (technician input tool); a separate Receiving home on an admin/dispatcher surface (driven from Purchasing → Purchase Orders) could reuse the same `ReceiveAgainstPurchaseOrder` component. Repo-only if pursued; not required by A1.
- **Cycle Counts / Back Orders — DESIGN-FIRST DEFERRED (DECISIONS #76):** no governed foundation (no collection/schema/Rules/write-authority/ledger/reconciliation). NOT a UI task — each needs a spec/ADR defining the business workflow + trusted write authority before any workspace. Do not build CRUD to fill the placeholder.
- **AI Platform / Enterprise Assistant — FUTURE (reconciled into PlatformCapabilityModel §13 AI Platform):** optional cross-platform assistant; do NOT build now; brought forward only when dependencies + product value make it the strongest lever.
- **Purchasing placeholders — assessed 2026-08-06: NONE clear the repo-only implementation bar (all DESIGN-FIRST).** Receipts done (#76). Suppliers/Quotes/Demand Planning sit on the DORMANT Epic-5 procurement (`suppliers`/`supplier_catalog`/`purchase_orders` are read-only in Rules — `create/update/delete: if false` — with no write path; `supplierService` only reads and is undeployed; the active purchasing flow records supplier as FREE-TEXT `supplierName` on `reorder_purchase_orders`). A Suppliers read workspace would be an empty shell; adopting the Supplier master is Tier-2/material.
  - **STRONGEST DESIGN-FIRST candidate — Supplier Master adoption (Procurement).** Business problem: purchasing has no governed Supplier identity (free-text), so no dedup, governed terms, supplier reporting, or preferred-supplier basis for Quotes. Canonical objects: `suppliers` (Supplier), `supplier_catalog` (SupplierCatalogItem), `part_supplier_items` (governed part↔supplier terms, already exists — INV-1 PR 1.4, ≤1 ACTIVE preferred supplier/part). Lifecycle: Supplier status ACTIVE/INACTIVE (mirror the warehouse pattern). Read authority: suppliers/supplier_catalog = isAdminOrDispatcher() (live); part_supplier_items = trusted-service-only. **Missing = trusted WRITE authority** (no supplier create/activate/deactivate service; needs the truck-registry/Part-Master trusted-command pattern + Rules — Tier-2). Relationship: the reorder-PO flow would reference a governed `supplierId` instead of free-text (a write-path change + migration). No ledger/event implication (reference data). Persona: Procurement (admin/dispatcher). MVP gates: (1) governed Supplier trusted-write service + Rules; (2) Suppliers registry workspace (read, reuses the pattern); (3) wire reorder-PO to `supplierId`. **Decide before build:** adopt-master-now vs keep free-text; Supplier identity/dedup model; adopt-or-retire the dormant Epic-5 `suppliers`/`purchase_orders`; supplier-admin authority. → each gate is Owner-authorized; not a repo-only Tier-1 build.

## Recently completed (this program window — see DECISIONS.md for the durable record)

| Capability | Stage | Record |
|---|---|---|
| My Dashboard North Star family (composition, goal actuals, bounded previews) | OWNER ACCEPTED on `platform-sandbox` `50792fef` — CLOSED | DECISIONS #161 · #162 · #172 · migration ledger Family 10 |
| Dashboard persona sweep + Technician acceptance surface | DEPLOYED and OWNER ACCEPTED on `platform-sandbox` `6b281cd5` — CLOSED | PR #1793 · migration ledger Family 10 post-closure + Family 11 |
| Technician Dashboard (North Star Family 11) | CLOSED / OWNER ACCEPTED / LIVE VERIFIED 2026-09-04 | PR #1796 · migration ledger Family 11 |
| Dashboard runtime correctives + shared-shell account/notification relocation | LIVE VERIFIED on `platform-sandbox` `6b281cd5` — CLOSED | PRs #1795 · #1796 · #1799 |
| Purchase Orders read surface (Purchasing item C) | MERGED (repo-only) | DECISIONS #64 · PR #578 |
| PartsScanner as a tool within FieldMode (item A) | MERGED (repo-only) | DECISIONS #65 · PR #581 |
| Default-autonomy operating mode (Charter Amendment 2) | MERGED | DECISIONS #66 · PR #582 |
| AI Engineering Operating Model + Owner/IP governance | MERGED | this program · see DECISIONS |
| Governed FieldMode Receive-against-Purchase-Order (A1) | MERGED (repo-only; readiness false) | DECISIONS #68 |
| Inventory → Receiving first-class workspace (one workflow, two launch points) | MERGED (repo-only) | DECISIONS #69 |
| Executive Architecture Office — Program 0 Authoritative Truth Pass | MERGED (docs-only) | DECISIONS #70 · `reviews/eao-program-0-truth-pass.md` |
| Inventory → Transfers first-class workspace (read-only; reuses canonical view-model) | MERGED (repo-only) | DECISIONS #71 |
| Inventory → Warehouses first-class workspace (read-only; registry + governed status/eligibility) | MERGED (repo-only) | DECISIONS #74 |
| Purchasing → Receipts launch point into canonical PO projection (+ Cycle Counts deferral) | MERGED (repo-only) | DECISIONS #76 |

- Capability:          Finance F-1a — issue an invoice on EOS (Firebase parity, no approval flow): `issueInvoice` on `/operations/finance`, the invoice number and issue date on the existing reads, the Billing Queue Issue control. Not adjustments, write-offs, refunds or void.
- Agent/session:       Claude Code lane F-1a · Role: builder; controller merges and writes the migration
- Branch / worktree:   `lane-f/f1a-invoice-issue` · `D:/Taylor_Parts/.claude/worktrees/agent-ab4d7f115c519306e`
- Base commit:         `ec66b089`
- Owned paths:         `functions/src/eosFinance/invoiceIssue.ts` · `functions/src/eosFinance/financeOperations.ts` (issueInvoice, the `invoice` field, `invoiced` filter, `actions.issue`) · `field-ops-app-vite/src/modules/financials/{InvoiceIssueQueue,FinancialsBillingQueue}.jsx` · `functions/test/f1aInvoiceIssue*.test.mjs`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` · `docs/architecture/SYSTEM_AUTHORITIES.md` · `functions/test/adminPolicySuites.json` · the migration-count pin tests · `field-ops-app-vite/src/access/shellCapabilityGates.js`
- Dependencies:        migration `1764700000000_invoice-issue` (SQL reviewed, written by the controller); F-2 (#2168), F-1 spec (#2175)
- Expected outcome:    a READY package's receivable gets exactly one invoice with an `INV-YYYY-######` number; issuing is one step for an authorized person
- Protected boundaries:none reached (no capability, grant, Rules, deploy or production change)
- Lifecycle stage:     MERGED `5c1fe280` (#2184) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Finance F-1b — governed credits, write-offs, adjustments, refunds and eligible voids of an issued invoice: request then separate-Employee approval at a $0 threshold; refund RECORDS only (no cash-out); void only before any money moves. Not the screen.
- Agent/session:       Claude Code lane F-1b · Role: builder; controller merges and writes the migration
- Branch / worktree:   `lane-f/f1b-invoice-corrections` · `D:/Taylor_Parts/.claude/worktrees/agent-a628440b8f1001ff4`
- Base commit:         `5c1fe280`
- Owned paths:         `functions/src/eosFinance/invoiceCorrection.ts` · `functions/src/eosFinance/settlement.ts` (shared apply/reverse helpers, the refund RECORD) · `functions/src/eosFinance/financeOperations.ts` (the four correction operations) · `functions/test/f1bInvoiceCorrection*.test.mjs` · `docs/architecture/f1b-invoice-correction-grant-proposal.json`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` · `docs/architecture/SYSTEM_AUTHORITIES.md` · `docs/governance/precedence-sweep.json` · `functions/test/adminPolicySuites.json` · `functions/src/adminPolicy/assignmentScopeRuntime.ts` · `field-ops-app-vite/src/services/financeApiClient.js`
- Dependencies:        migration `1764712000000_invoice-corrections` (SQL saved as a `.txt`, written by the controller; registers the approval capabilities with NO grants); F-1a (#2184)
- Expected outcome:    every money correction of an issued invoice is requested by one Employee and applied only on a different Employee's approval; outstanding stays derived from the receivable
- Protected boundaries:capability registration only, NO grants (Owner-only proposal recorded, unapplied); no production, Rules, deploy, Firebase or external-payment action
- Lifecycle stage:     MERGED `5671c167` (#2188) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          SAE — the protected Owner is exempt from secondary approval and self-approval separation of duties, platform-wide, through ONE TypeScript seam and ONE SQL seam (Rule 1); the seam is shaped for the delegated exemption (Rule 2, PR-2). Removes ONLY the second person; every capability, company, state, integrity, reason, idempotency and audit rule still applies.
- Agent/session:       Claude Code lane SAE · Role: builder; controller merges and writes the migration
- Branch / worktree:   `lane-sae/self-approval-exception-policy` · `D:/Taylor_Parts/.claude/worktrees/agent-a08b3e958c7c5b2f6`
- Base commit:         `5671c167`
- Owned paths:         `functions/src/access/secondaryApprovalExemption{,Core}.ts` · the same-person checks of `eosFinance/invoiceCorrection.ts`, `eosFinance/financialPolicy.ts`, `finance/financialApprovals.ts`, `eosOps/performanceGoalAuthoring.ts`, `eosOps/supplierPurchaseOrderAuthoring.ts`, `eosOps/cycleCount{Operations,Repository}.ts` · `functions/test/sae*.test.mjs` · the permission-catalog descriptions of `performance.goal.approve`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` (#SAE) · `docs/architecture/SYSTEM_AUTHORITIES.md` · `docs/governance/precedence-sweep.json` · `docs/governance/owner-commercial-spec-rulings-2026-10-20.md` · `docs/architecture/capability-graph.json` · `functions/test/adminPolicySuites.json` · the migration-count pin tests
- Dependencies:        migration `1764716000000_protected-owner-secondary-approval-exemption` (SQL saved as a `.sql.txt`, written by the controller; no capability, no grant); F-1b (#2188). S1c runs in parallel and shares no file
- Expected outcome:    the protected Owner can request and approve the same transaction in every EOS-native workflow with the basis recorded; every non-Owner keeps the two-person rule; Q-1 will reuse the seam
- Protected boundaries:no capability, no grant, no Rules, deploy, Firebase, production or external-payment action; the Firestore-era self-approval sites are reported, not changed
- Lifecycle stage:     MERGED `cd843df1` (#2190) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          SAE Rule 2 — the DELEGATED self-approval exemption: seven `approval.selfApproval.exempt*` capabilities (Financials, Purchasing, Sales, Inventory, Service, Goals, All) granted ONLY by the verified protected Owner through the existing role / direct grant paths, GLOBAL scope (company scope = PR-3); a never-NULL SQL proof the database triggers consult; Owner ruling D3 (the grant confers only the second person).
- Agent/session:       Claude Code lane SAE · Role: builder; controller merges and writes the migration
- Branch / worktree:   `lane-sae/delegated-exemption` · `D:/Taylor_Parts/.claude/worktrees/agent-a08b3e958c7c5b2f6`
- Base commit:         `174ba281` (after SAE PR-1 #2190 `cd843df1`)
- Owned paths:         `functions/src/adminPolicy/exemptionAdministration.ts` · the delegated branch of `functions/src/access/secondaryApprovalExemption{,Core}.ts` · the family-aware grant gate in `adminPolicy/policyCommands.ts` and `adminPolicyApi.ts` · the `selfApprovalExemption` Object in the policy seed · `functions/test/saeDelegatedExemptionPostgres.test.mjs`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` (#SAE-2) · `docs/architecture/SYSTEM_AUTHORITIES.md` · `docs/governance/precedence-sweep.json` · `docs/governance/owner-commercial-spec-rulings-2026-10-20.md` · `docs/training/administration-policy-and-access.md` · `docs/architecture/capability-graph.json` · `functions/test/adminPolicySuites.json` · `.github/ci/eos-admin-policy-paths.txt` · the migration-count pin tests
- Dependencies:        migration `1764718000000_delegated-self-approval-exemption` (SQL saved as a `.sql.txt`, written by the controller; registers 7 capabilities with NO grants); SAE PR-1; S1c holders `1764717000000`
- Expected outcome:    the Owner can delegate, and take back, the second-person exemption per workflow scope; nobody else can; every non-grantee keeps the two-person rule
- Protected boundaries:no grants in the migration, no Rules, deploy, Firebase, production or external-payment action; the new Object reaches existing tenants through the migration (an idempotent INSERT ... SELECT), no operator step
- Lifecycle stage:     MERGED `1732a445` (#2193) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          Q-1a (2026-10-20) — operating-company authority on Commercial reads, writes, approvals, records and exports (Owner ruling Q1-11): capability -> company authority -> channel / ownership reach; a foreign-company record is NONEXISTENT with zero trace; a company-less Opportunity / Agreement is visible only to its owner or creator, the protected Administrator and the protected Owner; the protected Administrator's reach is unchanged (before/after diff); National Accounts stay a channel. ONE shared Sales Order visibility decision also gates Sales Order allocation
- Agent/session:       Claude Code lane Q-1a · Role: builder; controller reviews and merges
- Branch / worktree:   `q1a/commercial-company-authority` · `D:/Taylor_Parts/.claude/worktrees/agent-a16bfe09d1fc0c946`
- Base commit:         `174ba281`
- Owned paths:         `functions/src/eosCommercial/commercialCompanyAuthority.ts` · `functions/src/eosCommercial/commands/**` · `functions/src/eosCommercial/reads/**` · `functions/src/eosCommercial/commercialHttp.ts` · the company check of `functions/src/eosOps/salesOrderAllocation.ts` · `functions/test/commercialCompanyAuthority{,Postgres}.test.mjs` · `functions/test/support/commercialCompanyReachFixture.mjs`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` (#Q-1a-company) · `docs/architecture/SYSTEM_AUTHORITIES.md` · `docs/governance/precedence-sweep.json` · `docs/user-guide/sales/which-sales-records-you-can-see.md` · `docs/user-guide/README.md` · `functions/test/adminPolicySuites.json` · `.github/ci/eos-admin-policy-paths.txt` · the deps line of about twenty existing Commercial Postgres suites (the test-only all-companies double)
- Dependencies:        S1c (#2189) for the allocation file; SAE (#2190) untouched; F-1b / SAE PR-2 / FU-1 run in parallel and share no file
- Expected outcome:    a seller sees and changes only the records of the companies it reaches; nothing about another company's record, count or timing leaks; the Administrator and National Accounts behaviour are unchanged
- Protected boundaries:no migration, no capability, no grant, no Rules, deploy, Firebase or production action
- Lifecycle stage:     MERGED `835e5982` (#2194) -- reconciled 2026-10-23 from GitHub PR state

- Capability:          CLC (2026-10-21) — the governed, audited, set-once correction of a COMPANY-LESS Opportunity or Sales Agreement (Owner review 2026-10-20, direction 2026-10-21; closes the #Q-1a-company design gap): `assignRecordOperatingCompany` (capability -> record visible under the null-company rule -> caller reaches the target company -> still company-less -> lineage), one new capability `commercial.recordCompany.assign` registered with NO grants, one audit row per applied command, and Agreement inheritance in the same transaction, a named-only grant, and a server-gated "Set operating company" control on the Opportunity and Sales Agreement record pages
- Agent/session:       Claude Code lane CLC · Role: builder; controller reviews and merges
- Branch / worktree:   `clc/companyless-record-correction` · `D:/Taylor_Parts/.claude/worktrees/agent-a9d5f63d580379fc5`
- Base commit:         `835e5982`
- Owned paths:         `functions/src/eosCommercial/commands/commercialRecordCompanyService.ts` · `functions/src/eosCommercial/recordCompanyOffer.ts` · the named-only exclusion in `functions/src/adminPolicy/{objectSecurityAuthority,policyCommands}.ts` · `functions/test/commercialRecordCompany{,Postgres}.test.mjs` · `field-ops-app-vite/src/modules/sales/SetOperatingCompany.jsx` · `field-ops-app-vite/test/setOperatingCompany.test.jsx`
- Shared paths req'd:  this registry · `docs/DECISIONS.md` (#CLC) · `docs/architecture/SYSTEM_AUTHORITIES.md` · `docs/governance/precedence-sweep.json` · `docs/user-guide/sales/set-the-company-on-a-record-that-has-none.md` · `docs/user-guide/README.md` · `functions/test/adminPolicySuites.json` · `.github/ci/eos-admin-policy-paths.txt` · `functions/scripts/fixtures/sampleCompany.v2.json` · the Commercial transport / kernel / record store / two detail reads · the migration and capability-count pins (the migration itself is written by the controller from the `.sql.txt`)
- Dependencies:        Q-1a (#2194) for the reach resolver and the null-company rule; lane DWO (Dispatch Work Order company boundary) runs in parallel and shares no file
- Expected outcome:    a company-less Opportunity or Agreement can be given its company, once, by a holder of the new key who can see it and reaches the company; nothing else about reach, grants or visibility changes; no one holds the key until the Owner grants it
- Protected boundaries:no grant, no Rules, deploy, Firebase or production action; the migration file is the controller's
- Lifecycle stage:     MERGED `b05dfe33` (#2199) -- reconciled 2026-10-23 from GitHub PR state
