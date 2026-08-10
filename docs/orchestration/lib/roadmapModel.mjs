// Owner Roadmap Projection — the durable, machine-readable EOS roadmap state.
//
// This is the SINGLE structured source of truth for roadmap progress (see
// ../roadmap-projection.md). The 8 views, the committed snapshots, the
// schedulability backlog, and chat checkpoints are all PROJECTIONS of this —
// never a competing roadmap. If an entry disagrees with the repository (a PR, a
// Rules block, an `active` flag), the repository wins and this is corrected.
//
// Fields are recorded WHERE AVAILABLE; unknowns are the explicit sentinel
// "UNKNOWN", never guessed. Orthogonal dimensions are kept as SEPARATE fields so
// they never collapse into a misleading single number (IMPLEMENTED != ACTIVATED,
// MERGED != DEPLOYED, BACKEND COMPLETE != USER-OPERABLE, UX COMPLETE != BACKEND
// ACTIVE, PERSONA FINDING != PRODUCT DECISION).

export const STATUS = Object.freeze([
  "IDENTIFIED", "ASSESSMENT_READY", "ASSESSED", "PLANNED", "READY", "RUNNING",
  "BLOCKED_DEPENDENCY", "OWNER_DECISION", "PROTECTED_ACTION", "AT_REST", "DONE", "DELIVERED",
]);
export const IMPLEMENTATION = Object.freeze(["IMPLEMENTED", "PARTIAL", "NONE", "NOT_APPLICABLE", "UNKNOWN"]);
export const ACTIVATION = Object.freeze(["ACTIVATED", "INERT", "NOT_APPLICABLE", "UNKNOWN"]);
export const BACKEND = Object.freeze(["COMPLETE", "PARTIAL", "NONE", "NOT_APPLICABLE", "UNKNOWN"]);
export const UX = Object.freeze(["COMPLETE", "PARTIAL", "NONE", "NOT_APPLICABLE", "UNKNOWN"]);
export const DEPLOY = Object.freeze(["DEPLOYED", "NOT_DEPLOYED", "NOT_APPLICABLE", "UNKNOWN"]);
export const TRISTATE = Object.freeze([true, false, "NOT_APPLICABLE", "UNKNOWN"]);
export const EVIDENCE_KINDS = Object.freeze(["PR", "CI", "TEST", "RULES", "DOC", "PERSONA_FINDING", "CAPABILITY_FLAG", "BROWSER_RUN"]);
export const OWNERS = Object.freeze(["Product/Design", "UX", "EAO", "Access", "Operator", "Owner"]);

// Convenience: a fully NOT_APPLICABLE dimension set for pure-doc/process capabilities.
const PROCESS_DIMS = { implementationState: "NOT_APPLICABLE", activationState: "NOT_APPLICABLE", backendState: "NOT_APPLICABLE", userOperable: "NOT_APPLICABLE", uxState: "NOT_APPLICABLE", deployState: "NOT_APPLICABLE" };
// Convenience: a governed-inert backend (implemented, registered active:false, deny-all, not deployed, no UX).
const INERT_BACKEND = { implementationState: "IMPLEMENTED", activationState: "INERT", backendState: "COMPLETE", userOperable: false, uxState: "NONE", deployState: "NOT_DEPLOYED" };

export const roadmapModel = Object.freeze({
  id: "EOS",
  name: "Enterprise Operations OS",
  lastVerifiedRepoState: "origin/main e704922 (2026-08-09; endurance pilot + Control Center)",
  domains: [
    {
      id: "platform-orchestration", name: "Platform & Orchestration", kind: "PROGRAM",
      capabilities: [
        {
          id: "continuous-workstream-orchestrator", name: "Continuous Workstream Backlog & Orchestrator",
          workstreamOwner: "Product/Design", status: "DONE", ...PROCESS_DIMS,
          dependencies: [], lastVerifiedRepoState: "da89558",
          milestones: [
            { id: "cwo-design", name: "Design + seeded backlog + state machine + selection rule + checkpoint policy", complete: true,
              completionCriteria: ["design doc merged", "seeded backlog merged"],
              workItems: [{ id: "cwo-w1", name: "Orchestrator foundation", status: "DONE", owner: "Product/Design",
                prEvidence: ["#703"], verification: "CI green", evidence: [{ kind: "PR", ref: "#703" }] }] },
            { id: "cwo-driver", name: "Option A /loop continuation driver (pure tested selector + CI + blocker-decomposition)", complete: true,
              completionCriteria: ["selector implemented", "11 node:test pass", "own CI lane", "driver contract doc"],
              workItems: [{ id: "cwo-w2", name: "selectNextWork.mjs + tests + orchestration-selector CI", status: "DONE", owner: "Product/Design",
                prEvidence: ["#710"], tests: "11 node:test (orchestration-selector-tests.yml)", verification: "CI green",
                evidence: [{ kind: "PR", ref: "#710" }, { kind: "CI", ref: "orchestration-selector-tests.yml" }, { kind: "TEST", ref: "selectNextWork.test.mjs", note: "11 cases" }] }] },
            { id: "cwo-perms", name: "Bounded two-class tool-permission policy", complete: true,
              completionCriteria: ["VERIFICATION allow + PROTECTED deny", "no Bash(*)"],
              workItems: [{ id: "cwo-w3", name: ".claude/settings.json two-class + permission-policy.md", status: "DONE", owner: "Owner",
                prEvidence: ["#712"], evidence: [{ kind: "PR", ref: "#712" }] }] },
            { id: "cwo-reconcile", name: "Reconciled backlog + closed RUNNING assignment", complete: true,
              completionCriteria: ["backlog marks completions", "selection rule run recorded"],
              workItems: [{ id: "cwo-w4", name: "backlog reconcile", status: "DONE", owner: "Product/Design",
                prEvidence: ["#713"], evidence: [{ kind: "PR", ref: "#713" }] }] },
            { id: "cwo-optionb", name: "Option B unattended self-scheduling", complete: false,
              completionCriteria: ["design: budget cap", "cadence", "max work window", "retry/backoff", "failure containment", "checkpoint interval", "unattended-spend controls"],
              workItems: [{ id: "cwo-w5", name: "Option B design (deferred — validate A first)", status: "PLANNED", owner: "Owner",
                blockedReason: "Deferred by Owner until Option A is operationally validated", evidence: [] }] },
          ],
        },
        {
          id: "owner-roadmap-projection", name: "Owner Roadmap Projection", workstreamOwner: "Product/Design",
          status: "DONE", ...PROCESS_DIMS, dependencies: ["continuous-workstream-orchestrator"], lastVerifiedRepoState: "85a9549",
          milestones: [
            { id: "orp-contract", name: "Projection contract + model + pure views + tests + snapshots", complete: true,
              completionCriteria: ["contract doc", "structured model", "8 pure views", "tests + CI", "committed snapshots"],
              workItems: [{ id: "orp-w1", name: "Contract + model + 8 pure views + 14 tests + drift-guarded CI + snapshot", status: "DONE", owner: "Product/Design",
                prEvidence: ["#715"], tests: "14 node:test (orchestration-roadmap-tests.yml)", verification: "CI green",
                evidence: [{ kind: "PR", ref: "#715" }, { kind: "CI", ref: "orchestration-roadmap-tests.yml" }] }] },
          ],
        },
        {
          id: "shared-agent-manager", name: "Shared Agent Manager + Resource Governor", workstreamOwner: "Product/Design",
          status: "DONE", ...PROCESS_DIMS, dependencies: ["continuous-workstream-orchestrator"], lastVerifiedRepoState: "5639894",
          milestones: [
            { id: "sam-core", name: "Durable Request/Result contracts + governor + network state + dispatcher + registration invariant", complete: true,
              completionCriteria: ["files not chat", "global caps REMOTE_AI=2/BROWSER=1/NETWORK_HEAVY=1", "READY_BUT_WAITING_RESOURCE", "registration invariant"],
              workItems: [{ id: "sam-w1", name: "agentRequest/Result/resourceGovernor/networkState/agentManager + selector", status: "DONE", owner: "Product/Design",
                prEvidence: ["#719"], tests: "17+14 node:test", evidence: [{ kind: "PR", ref: "#719" }] }] },
            { id: "sam-ops", name: "Agent Operations roadmap view + Design/UX operational exercise", complete: true,
              completionCriteria: ["Agent Ops projection", "durable Design + UX exercise", "no Owner relay"],
              workItems: [{ id: "sam-w2", name: "projectAgentOperations + DR-001/UX-EX-001", status: "DONE", owner: "Product/Design",
                prEvidence: ["#720"], evidence: [{ kind: "PR", ref: "#720" }] }] },
          ],
        },
        {
          id: "network-telemetry-integration", name: "Network Telemetry Integration + Real-Load Proof", workstreamOwner: "Product/Design",
          status: "DONE", ...PROCESS_DIMS, dependencies: ["shared-agent-manager"], lastVerifiedRepoState: "5639894",
          milestones: [
            { id: "nt-adapter", name: "Read-only netwatch Network Health Adapter mapped into existing governor states", complete: true,
              completionCriteria: ["reuse logger (durable local home)", "obvious-fact states only", "no latency thresholds (Phase 4A)", "telemetry never in git"],
              workItems: [{ id: "nt-w1", name: "networkHealthAdapter/Loader + tests + CI + doc", status: "DONE", owner: "Product/Design",
                prEvidence: ["#721"], tests: "11 node:test", evidence: [{ kind: "PR", ref: "#721" }] }] },
            { id: "nt-proof", name: "Real-load proof: 2 concurrent stable, ceiling enforced, zero relay, telemetry correlated", complete: true,
              completionCriteria: ["Design+UX real requests", "READY_BUT_WAITING_RESOURCE demonstrated", "network NORMAL throughout", "owner relay = 0"],
              workItems: [{ id: "nt-w2", name: "Agent-Ops network view + DR-002/UX-EX-002/DR-003 proof", status: "DONE", owner: "Product/Design",
                evidence: [{ kind: "DOC", ref: "phase4-realload-proof.md" }] }] },
            { id: "nt-optionb", name: "Option B unattended (still gated: browser/network-heavy correlation, pressure window, budget/cadence/backoff/containment)", complete: false,
              completionCriteria: ["browser/network-heavy correlation measured", "a pressure/outage window observed", "budget cap + max window + cadence + backoff + containment + unattended-spend defined"],
              workItems: [{ id: "nt-w3", name: "Option B design (deferred)", status: "PLANNED", owner: "Owner",
                blockedReason: "Phase 4 proved prerequisites under a healthy window; pressure behavior + browser/heavy correlation + unattended controls still undefined", evidence: [] }] },
          ],
        },
        {
          id: "unattended-readiness", name: "Unattended-Readiness Proof + Bounded Autonomy Policy (Phase 5)", workstreamOwner: "Product/Design",
          status: "DONE", ...PROCESS_DIMS, dependencies: ["network-telemetry-integration"], lastVerifiedRepoState: "e704922",
          ownerDecision: "RECONCILED 2026-08-09: the supervised, limited, expanded, and 8-hour daytime endurance pilots have ALL been Owner-authorized, executed, and ACCEPTED (0 relay / 0 automation-defects / 0 rework). Classification READY FOR SUPERVISED OVERNIGHT PILOT is accepted. Overnight execution is READY but NOT AUTHORIZED (readiness ≠ authorization); its remaining prerequisite is the persistent-telemetry Scheduled Task (an Owner standing-config action). The limiting factor is now READY-work supply, not loop reliability.",
          milestones: [
            { id: "ur-supervisor", name: "Persistent telemetry supervisor (token-free) + logger-health adapter", complete: true,
              completionCriteria: ["relaunch-if-dead", "no duplicate", "idempotent", "logger health exposed"],
              workItems: [{ id: "ur-w1", name: "netwatch-supervisor + summarizeLoggerHealth", status: "DONE", owner: "Product/Design",
                prEvidence: ["#723"], tests: "15 node:test", evidence: [{ kind: "PR", ref: "#723" }] }] },
            { id: "ur-policy", name: "Bounded autonomy contract + checkpoint + recovery policy (DESIGN ONLY)", complete: true,
              completionCriteria: ["work window/budget/retries/backoff/containment/cadence/recovery", "Option B NOT activated"],
              workItems: [{ id: "ur-w2", name: "autonomyPolicy + contract doc", status: "DONE", owner: "Product/Design",
                prEvidence: ["#724"], tests: "9 node:test", evidence: [{ kind: "PR", ref: "#724" }] }] },
            { id: "ur-readiness", name: "Option-B readiness assessment + registered browser/network-heavy proof (UX-2)", complete: true,
              completionCriteria: ["proven/unproven/proposed/risks", "READY-FOR-PILOT recommendation", "UX-2 registered durably"],
              workItems: [{ id: "ur-w3", name: "phase5-option-b-readiness.md + UX-2 request", status: "OWNER_DECISION", owner: "Owner",
                evidence: [{ kind: "DOC", ref: "phase5-option-b-readiness.md" }] }] },
            { id: "ur-browser-proof", name: "Browser/network-heavy real-work proof (UX-2, supervised pilot)", complete: true,
              completionCriteria: ["run app+emulator+browser", "measure BROWSER_REMOTE + REMOTE_AI concurrent telemetry", "close or correct UX-2"],
              workItems: [{ id: "ur-w4", name: "UX-2 browser proof — executed in the supervised pilot; network NORMAL throughout, ceilings enforced, zero relay", status: "DONE", owner: "UX",
                evidence: [{ kind: "DOC", ref: "phase5-pilot-evidence.md" }, { kind: "BROWSER_RUN", ref: "UX-2 coordinated-visits" }] }] },
            { id: "ur-pilots-executed", name: "Limited + expanded + 8-hour daytime endurance pilots executed and accepted", complete: true,
              completionCriteria: ["limited pilot merged", "endurance pilot merged", "0 relay / 0 automation-defects / 0 rework", "Owner accepted"],
              workItems: [{ id: "ur-w5", name: "limited pilot (Invalid-Date classify+fix) + endurance (timeline WO-rows) — accepted READY FOR SUPERVISED OVERNIGHT", status: "DONE", owner: "Product/Design",
                prEvidence: ["#729", "#734"], evidence: [{ kind: "PR", ref: "#729" }, { kind: "PR", ref: "#734" }, { kind: "DOC", ref: "phase5-limited-pilot-evidence.md" }] }] },
            { id: "ur-overnight", name: "Supervised overnight pilot", complete: false,
              completionCriteria: ["persistent-telemetry Scheduled Task installed (Owner)", "separate Owner authorization", "a stocked READY backlog"],
              workItems: [{ id: "ur-w6", name: "Overnight execution — READY, NOT AUTHORIZED (separate Owner gate)", status: "OWNER_DECISION", owner: "Owner",
                blockedReason: "Readiness accepted; authorization is a separate Owner action; prerequisite = persistent telemetry across reboot", evidence: [] }] },
          ],
        },
        {
          id: "owner-control-center", name: "Owner Control Center (projection + delivery)", workstreamOwner: "Product/Design",
          status: "RUNNING", ...PROCESS_DIMS, dependencies: ["owner-roadmap-projection", "shared-agent-manager", "network-telemetry-integration"], lastVerifiedRepoState: "e704922",
          milestones: [
            { id: "occ-projection", name: "Projection completion — Agent Ops + Network Health + Recent Progress + UX board via the governed envelope", complete: true,
              completionCriteria: ["4 gaps filled in controlCenterAdapter (schema 1.1.0)", "keystone renders from real data", "no reach-around", "browser-verified"],
              workItems: [{ id: "occ-w1", name: "controlCenterAdapter extension (Taylor #732) + keystone renderer (keystone #9)", status: "DONE", owner: "Product/Design",
                prEvidence: ["#732"], evidence: [{ kind: "PR", ref: "#732" }, { kind: "DOC", ref: "keystone PR #9" }, { kind: "BROWSER_RUN", ref: "control center renderProject" }] }] },
            { id: "occ-delivery", name: "Delivery phase — secure hosting + one-click Windows launcher (hosted-first / local-fallback)", complete: false,
              completionCriteria: ["hosting/auth/publication/freshness contract", "repo-safe hosted foundation", "one-click launcher (UX)", "browser + launcher acceptance"],
              workItems: [{ id: "occ-w2", name: "hosting design + launcher (Design owns arch/auth/contract/freshness; UX owns launcher experience)", status: "RUNNING", owner: "Product/Design",
                protectedBoundary: "actual Firebase Hosting deploy + any credential/billing = Owner/operator-gated; repo-safe design/config/launcher proceed", evidence: [] }] },
          ],
        },
      ],
    },
    {
      id: "commercial-sales", name: "Commercial & Sales", kind: "DOMAIN",
      capabilities: [
        { id: "opportunity-lifecycle", name: "Sales Opportunity lifecycle (Cycles 2–3)", workstreamOwner: "Product/Design",
          status: "PROTECTED_ACTION", ...INERT_BACKEND, protectedBoundary: "Grant opportunity.* + deploy callables",
          dependencies: [], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "opp-m1", name: "Governed write + trusted read projection", complete: true,
            completionCriteria: ["opportunity.write inert", "opportunity.read inert", "opportunities deny-all"],
            workItems: [{ id: "opp-w1", name: "opportunityCommands/Callables/ReadService", status: "DONE", owner: "Product/Design",
              prEvidence: ["#651", "#654"], evidence: [{ kind: "PR", ref: "#651" }, { kind: "PR", ref: "#654" }, { kind: "CAPABILITY_FLAG", ref: "opportunity.write", note: "active:false" }] }] }] },
        { id: "sales-order-lifecycle", name: "Sales Order lifecycle (Cycle 4) + Service lineage (Cycle 7)", workstreamOwner: "Product/Design",
          status: "PROTECTED_ACTION", ...INERT_BACKEND, protectedBoundary: "Grant salesOrder.* + deploy callables",
          dependencies: ["opportunity-lifecycle"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "so-m1", name: "Committed commercial order + Service lineage", complete: true,
            completionCriteria: ["salesOrder.write inert", "salesOrder.service inert", "sales_orders deny-all", "assigns no WO/inventory"],
            workItems: [{ id: "so-w1", name: "salesOrderCommands/Callables + createServiceForSalesOrder", status: "DONE", owner: "Product/Design",
              prEvidence: ["#659", "#663"], evidence: [{ kind: "PR", ref: "#659" }, { kind: "PR", ref: "#663" }] }] }] },
        { id: "fulfillment-allocation", name: "Fulfillment allocation & availability (Cycle 5)", workstreamOwner: "Product/Design",
          status: "PROTECTED_ACTION", implementationState: "IMPLEMENTED", activationState: "INERT", backendState: "PARTIAL",
          userOperable: false, uxState: "NONE", deployState: "NOT_DEPLOYED",
          blockedReason: "Equipment availability fails closed = UNKNOWN pending P1a serialized-asset signal + #12",
          protectedBoundary: "Grant salesOrder.fulfill + deploy", dependencies: ["sales-order-lifecycle"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "ful-m1", name: "allocateSalesOrder (parts availability computed; equipment UNKNOWN-fail-closed)", complete: true,
            completionCriteria: ["allocation only on sales_orders (non-forking)", "parts availability computed", "equipment fails closed"],
            workItems: [{ id: "ful-w1", name: "allocateSalesOrder + availability contracts", status: "DONE", owner: "Product/Design",
              prEvidence: ["#661"], evidence: [{ kind: "PR", ref: "#661" }] }] }] },
        { id: "commercial-coverage", name: "Commercial Coverage & Territory (register #15)", workstreamOwner: "Product/Design",
          status: "PROTECTED_ACTION", ...INERT_BACKEND, protectedBoundary: "Grant coverage.* + deploy",
          ownerDecision: "Precedence/override/inheritance + sales credit + commission are deferred policy (do not manufacture)",
          dependencies: [], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "cov-m1", name: "Governed inert persistence + multi-assignment resolution", complete: true,
            completionCriteria: ["territories + assignments deny-all inert", "resolveCommercialCoverage returns coverageAssignments[] (no winner)"],
            workItems: [{ id: "cov-w1", name: "coverageCommands/Callables/Resolution", status: "DONE", owner: "Product/Design",
              prEvidence: ["#695", "#697"], evidence: [{ kind: "PR", ref: "#695" }, { kind: "PR", ref: "#697" }] }] }] },
        { id: "coordinated-operations", name: "Coordinated operations projections", workstreamOwner: "Product/Design",
          status: "DONE", implementationState: "IMPLEMENTED", activationState: "NOT_APPLICABLE", backendState: "COMPLETE",
          userOperable: "UNKNOWN", uxState: "UNKNOWN", deployState: "NOT_APPLICABLE", dependencies: ["fulfillment-allocation"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "coord-m1", name: "coordinatedVisit + coordinatedFieldMission (projection-only)", complete: true,
            completionCriteria: ["projection-only", "assigns no work", "no independent WO authority"],
            workItems: [{ id: "coord-w1", name: "coordinatedVisit/coordinatedFieldMission", status: "DONE", owner: "Product/Design", evidence: [] }] }] },
      ],
    },
    {
      id: "finance-billing-ar", name: "Finance / Billing & AR", kind: "DOMAIN",
      capabilities: [
        { id: "money-model", name: "Money model (exact minor units)", workstreamOwner: "Product/Design", status: "DONE",
          implementationState: "IMPLEMENTED", activationState: "NOT_APPLICABLE", backendState: "COMPLETE",
          userOperable: "NOT_APPLICABLE", uxState: "NONE", deployState: "NOT_APPLICABLE", dependencies: [], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "money-m1", name: "Integer minor units + deterministic rounding + allocation", complete: true,
            completionCriteria: ["never float", "deterministic rounding", "largest-remainder allocation"],
            workItems: [{ id: "money-w1", name: "money.js + financeInvoiceAmounts + financeBillingPolicy", status: "DONE", owner: "Product/Design",
              prEvidence: ["#690"], evidence: [{ kind: "PR", ref: "#690" }] }] }] },
        { id: "invoice-issuance", name: "Invoice issuance (per-company sequence)", workstreamOwner: "Product/Design",
          status: "PROTECTED_ACTION", ...INERT_BACKEND, protectedBoundary: "Grant finance.invoice.issue + deploy + Rules deploy",
          dependencies: ["money-model"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "inv-m1", name: "Trusted invoice command + numbering; immutable history", complete: true,
            completionCriteria: ["finance.invoice.issue active:false", "invoices deny-all", "issued history immutable"],
            workItems: [{ id: "inv-w1", name: "invoiceCommands/Numbering/Callables", status: "DONE", owner: "Product/Design",
              prEvidence: ["#691"], evidence: [{ kind: "PR", ref: "#691" }, { kind: "CAPABILITY_FLAG", ref: "finance.invoice.issue", note: "active:false" }] }] }] },
        { id: "payment-ar", name: "Payment / AR (receipt ≠ application)", workstreamOwner: "Product/Design",
          status: "PROTECTED_ACTION", ...INERT_BACKEND, protectedBoundary: "Grant finance.payment.apply + deploy",
          dependencies: ["invoice-issuance"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "pay-m1", name: "applyPayment; outstanding = derived projection", complete: true,
            completionCriteria: ["cash receipt separate from application", "over-application rejected", "one-payment→many-invoices preserved"],
            workItems: [{ id: "pay-w1", name: "paymentCommands/Callables", status: "DONE", owner: "Product/Design",
              prEvidence: ["#692"], evidence: [{ kind: "PR", ref: "#692" }] }] }] },
        { id: "invoice-adjustments", name: "Adjustments (credit / charge / write-off)", workstreamOwner: "Product/Design",
          status: "PROTECTED_ACTION", ...INERT_BACKEND, protectedBoundary: "Grant finance.adjustment.record + deploy",
          dependencies: ["invoice-issuance"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "adj-m1", name: "Linked adjustment records; issued invoice never rewritten", complete: true,
            completionCriteria: ["CREDIT_MEMO/DEBIT_CHARGE/WRITE_OFF", "invoice_adjustments deny-all"],
            workItems: [{ id: "adj-w1", name: "adjustmentCommands/Callables", status: "DONE", owner: "Product/Design",
              prEvidence: ["#693"], evidence: [{ kind: "PR", ref: "#693" }] }] }] },
        { id: "refund", name: "Refund (reverses applied payment)", workstreamOwner: "Product/Design",
          status: "PROTECTED_ACTION", ...INERT_BACKEND, protectedBoundary: "Grant finance.refund.record + deploy",
          dependencies: ["payment-ar"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "ref-m1", name: "Refund reopens AR; distinct from credit/write-off", complete: true,
            completionCriteria: ["refunds deny-all", "amount ≤ applied"],
            workItems: [{ id: "ref-w1", name: "refundCommands/Callables", status: "DONE", owner: "Product/Design",
              prEvidence: ["#701"], evidence: [{ kind: "PR", ref: "#701" }] }] }] },
        { id: "trusted-ar-read", name: "Trusted AR read projection", workstreamOwner: "Product/Design",
          status: "PROTECTED_ACTION", ...INERT_BACKEND, protectedBoundary: "Grant finance.read + deploy",
          ownerDecision: "Revenue recognition remains a separate future accounting-policy seam (not an EOS engine)",
          dependencies: ["invoice-issuance"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "arr-m1", name: "projectInvoiceAr + summarizeAccountAr", complete: true,
            completionCriteria: ["finance.read active:false", "AR position derived (CURRENT/OVERDUE/SETTLED/VOID/UNKNOWN)"],
            workItems: [{ id: "arr-w1", name: "financeReadProjection/Callables", status: "DONE", owner: "Product/Design",
              prEvidence: ["#694"], evidence: [{ kind: "PR", ref: "#694" }] }] }] },
      ],
    },
    {
      id: "inventory-catalog", name: "Inventory & Catalog", kind: "DOMAIN",
      capabilities: [
        { id: "part-master-write", name: "Part Master in-app governed write", workstreamOwner: "Product/Design",
          status: "AT_REST", implementationState: "IMPLEMENTED", activationState: "INERT", backendState: "COMPLETE",
          userOperable: false, uxState: "COMPLETE", deployState: "NOT_DEPLOYED",
          blockedReason: "Awaits EAO integrated-sandbox experience review; PART_MASTER_WRITE_READY=false",
          dependencies: [], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "pm-m1", name: "Callables + write workspace (fail-closed readiness)", complete: true,
            completionCriteria: ["createPart/updatePart/changePartStatus inert", "workspace fail-closed"],
            workItems: [{ id: "pm-w1", name: "partMaster callables + PartMasterList write", status: "DONE", owner: "Product/Design",
              prEvidence: ["#617", "#619"], evidence: [{ kind: "PR", ref: "#617" }, { kind: "PR", ref: "#619" }] }] }] },
        { id: "manufacturer-write", name: "Manufacturer governed write", workstreamOwner: "Product/Design",
          status: "BLOCKED_DEPENDENCY", implementationState: "IMPLEMENTED", activationState: "INERT", backendState: "COMPLETE",
          userOperable: false, uxState: "PARTIAL", deployState: "NOT_DEPLOYED",
          blockedReason: "READ authority waits on R-1 (inventory.catalog.read); manufacturers stays read:if false",
          routedTo: "authorization-convergence-r1", dependencies: ["authorization-convergence-r1"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "mfr-m1", name: "Callables + workspace", complete: true,
            completionCriteria: ["create/update/changeStatus inert"],
            workItems: [{ id: "mfr-w1", name: "manufacturer callables + Manufacturers.jsx", status: "DONE", owner: "Product/Design",
              prEvidence: ["#625", "#626"], evidence: [{ kind: "PR", ref: "#625" }, { kind: "PR", ref: "#626" }] }] }] },
        { id: "part-supplier-items", name: "Part↔Supplier procurement terms", workstreamOwner: "Product/Design",
          status: "BLOCKED_DEPENDENCY", implementationState: "PARTIAL", activationState: "INERT", backendState: "PARTIAL",
          userOperable: false, uxState: "NONE", deployState: "NOT_DEPLOYED",
          blockedReason: "READ service + Purchasing UI gated on R-1 (inventory.catalog.read + .cost.read)",
          routedTo: "authorization-convergence-r1", dependencies: ["authorization-convergence-r1"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "psi-m1", name: "Write layer + cost/relationship projection contract", complete: true,
            completionCriteria: ["4 callable adapters inert", "cost never leaks (separate tier)"],
            workItems: [{ id: "psi-w1", name: "part_supplier_items write + projection", status: "DONE", owner: "Product/Design",
              prEvidence: ["#629"], evidence: [{ kind: "PR", ref: "#629" }] }] }] },
        { id: "supplier-master", name: "Supplier Master adoption (Tier-2 program)", workstreamOwner: "Product/Design",
          status: "AT_REST", implementationState: "IMPLEMENTED", activationState: "INERT", backendState: "COMPLETE",
          userOperable: false, uxState: "COMPLETE", deployState: "NOT_DEPLOYED",
          blockedReason: "Repo-complete + fully planned; awaits integrated sandbox → Owner experience → protected promotion",
          dependencies: [], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "sm-m1", name: "S1–S5 (identity, validator, commands, workspace, migration tooling, RC)", complete: true,
            completionCriteria: ["governed Supplier identity", "trusted write + Rules(prepared)", "migration dry-run/rollback", "RC package"],
            workItems: [{ id: "sm-w1", name: "supplierMaster S1–S5", status: "DONE", owner: "Product/Design",
              prEvidence: ["#596", "#598", "#600", "#602", "#604", "#605", "#608", "#610", "#612"], evidence: [{ kind: "PR", ref: "#605", note: "RC-1" }] }] }] },
        { id: "receiving", name: "Governed Receiving (against Purchase Order)", workstreamOwner: "Product/Design",
          status: "PROTECTED_ACTION", implementationState: "IMPLEMENTED", activationState: "INERT", backendState: "COMPLETE",
          userOperable: false, uxState: "COMPLETE", deployState: "DEPLOYED",
          blockedReason: "receiveInventoryStock callable DEPLOYED live (2026-08-06) BUT RECEIVING_TRANSPORT_READY=false → not user-operable",
          protectedBoundary: "Readiness flip + authorized Hosting release", dependencies: [], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "rcv-m1", name: "Trusted receive command + scanner-in-FieldMode + workspaces", complete: true,
            completionCriteria: ["receiveInventoryStock sole writer", "receiving_orders deny-all", "capability granted {admin,dispatcher,owner}"],
            workItems: [{ id: "rcv-w1", name: "inventoryReceiving + FieldMode + Inventory workspaces", status: "DONE", owner: "Product/Design",
              prEvidence: ["#581"], evidence: [{ kind: "PR", ref: "#581" }, { kind: "DOC", ref: "DECISIONS #68/#69/#71/#74/#76" }] }] }] },
      ],
    },
    {
      id: "access-authorization", name: "Access & Authorization", kind: "PROGRAM",
      capabilities: [
        { id: "authorization-convergence-r1", name: "R-1 Authorization Convergence (Issue #226)", workstreamOwner: "EAO",
          status: "PROTECTED_ACTION", implementationState: "PARTIAL", activationState: "UNKNOWN", backendState: "PARTIAL",
          userOperable: "NOT_APPLICABLE", uxState: "NOT_APPLICABLE", deployState: "NOT_DEPLOYED",
          blockedReason: "R1-A readiness prerequisite (parity corpus + shadow gate) EXISTS + CI-enforced; R1-B (Rows 19/20/22 production deployment) is the critical-path protected boundary and is unauthorized",
          protectedBoundary: "R1-B production deployment (Rows 19/20/22) + criterion-6 production evidence + Owner Row 19 authorization",
          dependencies: [], lastVerifiedRepoState: "da89558",
          milestones: [
            { id: "r1a", name: "R1-A readiness (repo-only): domain parity corpus + shadow-parity gate", complete: true,
              completionCriteria: ["47 legacy sites/22 collections enumerated + grouped by cutover row", "CI-enforced (fails on new unassigned site)"],
              workItems: [{ id: "r1a-w1", name: "legacyAuthorizationSurface.ts + test", status: "DONE", owner: "EAO",
                evidence: [{ kind: "DOC", ref: "functions/src/access/legacyAuthorizationSurface.ts" }, { kind: "CI", ref: "legacyAuthorizationSurface.test.mjs" }] }] },
            { id: "r1b", name: "R1-B backend activation (Rows 19/20/22)", complete: false,
              completionCriteria: ["Owner Row 19 authorization", "trusted backend deployed", "admin mutations enabled"],
              workItems: [{ id: "r1b-w1", name: "Protected production deployment", status: "PROTECTED_ACTION", owner: "Operator",
                protectedBoundary: "production deployment (unauthorized)", evidence: [] }] },
            { id: "r1c", name: "R1-C domain cutovers (Rows 23–26)", complete: false,
              completionCriteria: ["each domain moved onto permission engine", "each Rules change Tier-2"],
              workItems: [{ id: "r1c-w1", name: "Domain cutovers (blocked behind R1-B)", status: "BLOCKED_DEPENDENCY", owner: "Access",
                blockedReason: "gated behind R1-B", evidence: [] }] },
          ] },
        { id: "catalog-read-authority", name: "Catalog-read authority model", workstreamOwner: "Access",
          status: "OWNER_DECISION", implementationState: "NONE", activationState: "NOT_APPLICABLE", backendState: "NONE",
          userOperable: "NOT_APPLICABLE", uxState: "NOT_APPLICABLE", deployState: "NOT_APPLICABLE",
          ownerDecision: "Adopt durable inventory.catalog.read (+ separate inventory.catalog.cost.read)? Unblocks Manufacturer + part_supplier_items read surfaces",
          dependencies: ["authorization-convergence-r1"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "cra-m1", name: "Requirement recorded (design proposal)", complete: true,
            completionCriteria: ["requirement doc", "ratified personas + separate cost capability"],
            workItems: [{ id: "cra-w1", name: "r1-catalog-read-authority-requirement.md", status: "OWNER_DECISION", owner: "Owner",
              evidence: [{ kind: "DOC", ref: "docs/assessments/r1-catalog-read-authority-requirement.md" }] }] }] },
      ],
    },
    {
      id: "service-work-orders", name: "Service & Work Orders", kind: "DOMAIN",
      capabilities: [
        { id: "work-order-lifecycle", name: "Work Order lifecycle", workstreamOwner: "Product/Design", status: "DELIVERED",
          implementationState: "IMPLEMENTED", activationState: "ACTIVATED", backendState: "COMPLETE",
          userOperable: "UNKNOWN", uxState: "UNKNOWN", deployState: "UNKNOWN",
          blockedReason: "Live/deploy + user-operable state not re-verified this session — marked UNKNOWN rather than assumed",
          dependencies: [], lastVerifiedRepoState: "not re-verified 2026-08-09",
          milestones: [{ id: "wo-m1", name: "Transition engine + governed writes", complete: true,
            completionCriteria: ["transitionEngine canonical", "client-direct writes denied"],
            workItems: [{ id: "wo-w1", name: "transitionEngine + workOrderService", status: "DELIVERED", owner: "Product/Design", evidence: [] }] }] },
        { id: "weekly-scheduling", name: "Weekly Scheduling workspace", workstreamOwner: "Product/Design", status: "DONE",
          implementationState: "IMPLEMENTED", activationState: "UNKNOWN", backendState: "COMPLETE", userOperable: "UNKNOWN",
          uxState: "COMPLETE", deployState: "UNKNOWN", dependencies: ["work-order-lifecycle"], lastVerifiedRepoState: "not re-verified 2026-08-09",
          milestones: [{ id: "sch-m1", name: "Scheduling domain + workspace", complete: true,
            completionCriteria: ["scheduling spine", "weekly workspace"],
            workItems: [{ id: "sch-w1", name: "Scheduling", status: "DONE", owner: "Product/Design",
              prEvidence: ["#635"], evidence: [{ kind: "PR", ref: "#635" }] }] }] },
        { id: "wo-parts-planning", name: "WO Parts Planning", workstreamOwner: "Product/Design", status: "PROTECTED_ACTION",
          implementationState: "IMPLEMENTED", activationState: "INERT", backendState: "COMPLETE", userOperable: false,
          uxState: "UNKNOWN", deployState: "NOT_DEPLOYED", blockedReason: "Ph3 Rules deploy operator-queued",
          protectedBoundary: "Rules deploy", dependencies: ["work-order-lifecycle"], lastVerifiedRepoState: "da89558",
          milestones: [{ id: "wpp-m1", name: "Phase 1–3 governed PLANNED producer + back-link", complete: true,
            completionCriteria: ["setWorkOrderPartsPlan governed", "Ph3 back-link"],
            workItems: [{ id: "wpp-w1", name: "WO Parts Planning Ph1–3", status: "DONE", owner: "Product/Design",
              prEvidence: ["#638", "#639", "#643"], evidence: [{ kind: "PR", ref: "#639" }] }] }] },
      ],
    },
    {
      // UX / Experience — the registered UX workstream, projected into the single roadmap so
      // projectUxBoard() (which filters workstreamOwner === "UX") populates the Control Center's UX board.
      // This is NOT a second UX registry: the durable schedulability view of the same items lives in
      // execution-backlog.md; these are the machine-readable roadmap entries of that same registered work.
      // Persona/UX evidence is EVIDENCE, not product authority (a grain decision stays OWNER_DECISION).
      id: "ux-experience", name: "UX / Experience", kind: "DOMAIN",
      capabilities: [
        { id: "ux1-vocabulary-sweep", name: "UX-1 Cross-surface business-claim vocabulary sweep", workstreamOwner: "UX",
          status: "DONE", implementationState: "NOT_APPLICABLE", activationState: "NOT_APPLICABLE", backendState: "NOT_APPLICABLE",
          userOperable: "NOT_APPLICABLE", uxState: "COMPLETE", deployState: "NOT_APPLICABLE", dependencies: [], lastVerifiedRepoState: "4cd5520",
          milestones: [{ id: "ux1-m1", name: "Priority vocabulary + business-claim sweep round", complete: true,
            completionCriteria: ["one priority vocabulary", "5 fixed / 2 confirmed honest"],
            workItems: [{ id: "ux1-w1", name: "priority vocabulary + sweep close", status: "DONE", owner: "UX",
              prEvidence: ["#714", "#717"], evidence: [{ kind: "PR", ref: "#714" }, { kind: "PR", ref: "#717" }] }] }] },
        { id: "ux-invalid-date", name: "Operational History 'Invalid Date' (UX-1 family)", workstreamOwner: "UX",
          status: "DONE", implementationState: "IMPLEMENTED", activationState: "NOT_APPLICABLE", backendState: "NOT_APPLICABLE",
          userOperable: true, uxState: "COMPLETE", deployState: "UNKNOWN", dependencies: [], lastVerifiedRepoState: "0a6bd22",
          milestones: [{ id: "uxid-m1", name: "Root-caused (rendering defect) + fixed with canonical formatClockTime + test", complete: true,
            completionCriteria: ["never renders Invalid Date", "canonical toMillis path", "test"],
            workItems: [{ id: "uxid-w1", name: "formatClockTime + WorkOrderDetail + convergence fix", status: "DONE", owner: "UX",
              prEvidence: ["#729"], evidence: [{ kind: "PR", ref: "#729" }, { kind: "BROWSER_RUN", ref: "pilot classify+fix" }] }] }] },
        { id: "ux2-coordinated-visits", name: "UX-2 Coordinated Visits / Mission SAMPLE recheck", workstreamOwner: "UX",
          status: "DONE", implementationState: "NOT_APPLICABLE", activationState: "NOT_APPLICABLE", backendState: "NOT_APPLICABLE",
          userOperable: "NOT_APPLICABLE", uxState: "COMPLETE", deployState: "NOT_APPLICABLE", dependencies: [], lastVerifiedRepoState: "4cd5520",
          milestones: [{ id: "ux2-m1", name: "Live recheck: SAMPLE treatment (banner + per-row) resolves confusion → ACCEPTABLE", complete: true,
            completionCriteria: ["live browser recheck", "ACCEPTABLE or minimum correction"],
            workItems: [{ id: "ux2-w1", name: "supervised pilot recheck + close", status: "DONE", owner: "UX",
              prEvidence: ["#727", "#731"], evidence: [{ kind: "PR", ref: "#727" }, { kind: "PR", ref: "#731" }, { kind: "BROWSER_RUN", ref: "coordinated-visits" }] }] }] },
        { id: "ux3-activity-grain", name: "UX-3 Activity destination scope (grain)", workstreamOwner: "UX",
          status: "OWNER_DECISION", implementationState: "NOT_APPLICABLE", activationState: "NOT_APPLICABLE", backendState: "NOT_APPLICABLE",
          userOperable: "NOT_APPLICABLE", uxState: "PARTIAL", deployState: "NOT_APPLICABLE",
          ownerDecision: "Evidence phase DONE (5 Activity surfaces + grains + wayfinding discrepancy routed); the residual 'what grain should a standalone Activity destination be' is a product-direction decision — persona evidence is evidence, not authority.",
          dependencies: [], lastVerifiedRepoState: "4cd5520",
          milestones: [{ id: "ux3-m1", name: "Evidence gathered (UX-EX-001) → routed to UX; grain remains product-direction", complete: true,
            completionCriteria: ["surfaces + grains enumerated", "questionsRaised routed"],
            workItems: [{ id: "ux3-w1", name: "Activity destination evidence", status: "OWNER_DECISION", owner: "Owner",
              evidence: [{ kind: "DOC", ref: "agent-requests/UX-EX-001.result.json" }] }] }] },
      ],
    },
    {
      id: "roadmap-register-future", name: "Roadmap Register (identified future capabilities)", kind: "PROGRAM",
      capabilities: [
        futureCapability("service-contracts-pm", "Service Contracts / Preventive Maintenance", "Before recurring/contract Service implementation"),
        futureCapability("warranty-entitlement", "Warranty / Service Entitlement", "Before Service billing / WO financial completion"),
        futureCapability("installed-base", "Installed Base / Customer Equipment Lifecycle", "As Sales Order → Equipment fulfillment/installation is designed"),
        futureCapability("returns-rma", "Returns / RMA / Credits / Reverse Commerce", "After Sales Order / fulfillment authority is established"),
        futureCapability("temp-equipment-placement", "Temporary Equipment / Placement (#12)", "Assess after F2 + integrated sandbox mature", "Assess only after F2 + sandbox; custody persistence shape unresolved"),
        futureCapability("technician-labor-cost", "Technician Labor / Cost Accounting (#13)", "Assess after Service Ops convergence + F2 + sandbox", "Assess after Service Ops convergence + F2 + sandbox"),
      ],
    },
  ],
});

function futureCapability(id, name, roadmapTrigger, blockedReason) {
  return {
    id, name, workstreamOwner: "Product/Design", status: "IDENTIFIED",
    implementationState: "NONE", activationState: "NOT_APPLICABLE", backendState: "NONE",
    userOperable: "NOT_APPLICABLE", uxState: "NONE", deployState: "NOT_APPLICABLE",
    roadmapTrigger, blockedReason: blockedReason || undefined, dependencies: [], lastVerifiedRepoState: "da89558",
    milestones: [],
  };
}

// --- Validation (used by tests; keeps the model honest) ---

export function validateRoadmapModel(model = roadmapModel) {
  const errors = [];
  const seenIds = new Set();
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  check(model.id === "EOS", "root id must be EOS");
  for (const d of model.domains || []) {
    check(!seenIds.has(d.id), `duplicate id ${d.id}`); seenIds.add(d.id);
    for (const c of d.capabilities || []) {
      check(!seenIds.has(c.id), `duplicate id ${c.id}`); seenIds.add(c.id);
      check(STATUS.includes(c.status), `${c.id}: bad status ${c.status}`);
      check(IMPLEMENTATION.includes(c.implementationState), `${c.id}: bad implementationState ${c.implementationState}`);
      check(ACTIVATION.includes(c.activationState), `${c.id}: bad activationState ${c.activationState}`);
      check(BACKEND.includes(c.backendState), `${c.id}: bad backendState ${c.backendState}`);
      check(UX.includes(c.uxState), `${c.id}: bad uxState ${c.uxState}`);
      check(DEPLOY.includes(c.deployState), `${c.id}: bad deployState ${c.deployState}`);
      check(TRISTATE.includes(c.userOperable), `${c.id}: bad userOperable ${JSON.stringify(c.userOperable)}`);
      check(OWNERS.includes(c.workstreamOwner), `${c.id}: bad workstreamOwner ${c.workstreamOwner}`);
      if (c.status === "OWNER_DECISION") check(!!c.ownerDecision, `${c.id}: OWNER_DECISION requires ownerDecision text`);
      if (c.status === "PROTECTED_ACTION") check(!!c.protectedBoundary, `${c.id}: PROTECTED_ACTION requires protectedBoundary text`);
      for (const m of c.milestones || []) {
        check(typeof m.complete === "boolean", `${m.id}: milestone.complete must be boolean`);
        for (const w of m.workItems || []) {
          for (const e of w.evidence || []) check(EVIDENCE_KINDS.includes(e.kind), `${w.id}: bad evidence kind ${e.kind}`);
        }
      }
      for (const dep of c.dependencies || []) {
        // dependency ids are resolved lazily; recorded here for a second pass below
      }
    }
  }
  // dependency integrity: every dependency id must exist as a capability id
  for (const d of model.domains || []) for (const c of d.capabilities || []) {
    for (const dep of c.dependencies || []) check(seenIds.has(dep), `${c.id}: unknown dependency ${dep}`);
  }
  return errors;
}

// Flatten all capabilities with their domain, for projection convenience.
export function allCapabilities(model = roadmapModel) {
  const out = [];
  for (const d of model.domains || []) for (const c of d.capabilities || []) out.push({ ...c, domainId: d.id, domainName: d.name, domainKind: d.kind });
  return out;
}
