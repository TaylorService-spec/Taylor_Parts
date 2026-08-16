<!-- ARCHIVED AI WORKING NOTES — NOT AUTHORITY -->
> **Historical AI working notes**, moved out of Claude's private memory on 2026-08-16 so they are
> visible and auditable in the repository. **This file is not authoritative.** The authoritative
> record for this workstream is the linked `docs/` specification, DECISIONS entry, or PR history.
> Retained verbatim so nothing is lost; do not cite it as a decision of record.

---
name: project_eos_design_system_and_sales
description: "EOS composition foundation RATIFIED + Wave 0 primitives MERGED (#646); Product/Design=one stream heading to a Sales frontend program (assessment done, opportunity/quote greenfield)"
metadata: 
  node_type: memory
  type: project
  originSessionId: c981623b-0554-459a-9918-1dca1eec1135
  modified: 2026-08-08T05:39:04.794Z
---

**Owner ratified (2026-08-07) the EOS composition foundation** from the design-system diagnosis (PR #645
proposal): EOS's problem is a MISSING COMPOSITION LAYER between good tokens and pages (not a token problem).
Ratified model = ~10 primitives + 7 COMPOSITION TYPES (Personal Home / Operating Workspace / Management-
Oversight / Collection-Queue / Entity Detail / Guided Task / Field-Current-Work) — composition types, NOT
nav destinations/modules/personas/roles/collections. Three-use rule active; P1 authorized, P2/P3 evidence-
driven; keep the system SMALL (don't build 40 primitives). Card-farm standard (a Card = a bounded PEER
object, not the default section wrapper — stop .fo-panel being the page model); status 3-layer standard
(domain state vocabulary → semantic tone → visual treatment); responsive = RECOMPOSITION not shrink; density
matches job (field/dispatch/warehouse/admin/management).

**WAVE 0 MERGED — PR #646 (squash daa08e2).** field-ops shared/ui: tone.js (semantic tone: positive/
attention/unknown/muted/neutral/info/critical, reuses readiness tones) + StatusPill.jsx (ONE tone-driven pill
+ asText; converges ~9 ad-hoc pill families) + ContextBand.jsx (compact context strip, not a card) +
ActionRail.jsx (dominant/secondary/ghost + fo-btn-primary/ghost) + WorkspaceShell.jsx (Operating Workspace
Shell: region slots identity/context/attention/work/supporting; density modes; responsive split; RESOLVES
the phantom .fo-workspace) + index.css (also FIXES the previously-undefined .fo-detail-* that made
EquipmentDetail degrade to a card stack). 7 component tests; vitest 505; additive only, NO page migrated.

**SESSION MODEL:** Product/Design = ONE stream (owns product arch + frontend design + implementation + shared
primitives when conflict-clean). UX = INDEPENDENT evaluator (persona missions/scenarios/journeys/IA discovery/
FUNCTIONAL+EXPERIENCE verdicts) — Design must NOT duplicate UX or pre-decide UX-owned questions (too-many-tabs,
Jobs/Scheduling/Dispatch consolidation, Control Tower purpose/rename, personalized Home, remediation priority,
final page-type assignments). The 5 code-audit findings stay PROVISIONAL until UX validates on realistic data.
Historical remediation of the ~35 card-heavy surfaces is DEFERRED (evidence-driven waves after Wave0/F1/
Scheduling/Sales + UX missions prove the foundation).

**CYCLE 2 MERGED — PR #649 (squash c576a06).** Read-first Sales **Opportunity** Operating Workspace (ratified
entry point = Opportunity Management, NOT Account→Create WO). PURE `domain/opportunityLifecycle.js` (lifecycle
IDENTIFIED→QUALIFYING→SOLUTION→QUOTING→CUSTOMER_REVIEW→DECISION→WON|LOST, stage→semantic-tone, HONEST attention
derivation, pipeline projection) + injected SOURCE seam (`access/opportunitySource.js` synthetic→governed =
one-line swap) + `hooks/useOpportunities.js` + synthetic SBX-OPP-* fixtures + `modules/sales/SalesWorkspace.jsx`
on Wave-0 primitives (inert/honest create button) + `opportunities` subnav under CRM/Sales (admin/dispatcher).
Own path-filtered CI workflow (`sales-opportunity-tests.yml`, ran+passed). owner=ownerEmployeeId. Design doc
`docs/design/sales-opportunity-workspace-cycle2.md`.
**CYCLE 3 MERGED — PR #651 (squash 8f406f1).** Governed Opportunity WRITE authority, fail-closed/inert:
functions/src/opportunity/{opportunityLifecycle,opportunityCommands,opportunityCallables}.ts (PURE core +
onCall createOpportunity/transitionOpportunity; capability `opportunity.write` active:false=register≠grant;
exported NOT deployed=export≠deploy). Minimal transition graph (advance-by-one / LOST-any-open / WON-only-
DECISION / closed-final; server=authority, field-ops nextStage+allowedActions mirrors for UI). Pre-commitment:
product-level lines only (SERIALIZED_LINE_FORBIDDEN), ownerEmployeeId required. `opportunities`=Admin-SDK-only
deny-all Rules (both mirrors, hash re-pinned ad62f827…); NO Rules deploy (Tier-2 operator-gated). resolver A3
deferred-allowlist + permissionCatalog allowlist updated. Register #12 reworded + #14 added (folded in).
**CYCLE 3b MERGED — PR #653 (squash 90a1c43).** Opportunity write-readiness seam: `access/opportunityWrite
Readiness.js` (fail-closed; needs BOTH grant+deploy to flip; workspace reads readiness only via seam) +
SalesWorkspace Lifecycle block rendering allowedActions DISABLED/honest. Was the FIRST REAL agent-orchestration
pilot (build d2b40fb; OPUS me + 3 SONNET agents GOV-DRIFT/P-SALES-NA/UX-COMPOSE; 2 LOW findings remediated
autonomously). See [[project_agent_orchestration_quality_system]]. **CYCLE 3c MERGED — PR #654 (squash 4cd8ece).** Trusted minimal Opportunity READ projection (NOT a client
Rules widen): functions/src/opportunity/opportunityReadService.ts (pure projectOpportunity/summarizeReadResult
+ listOpportunityContext callable; capability opportunity.read active:false; Admin-SDK read; minimal fields
accountId-only NO PII/NO raw UID; denied/empty/unavailable/degraded states). opportunities collection stays
Admin-SDK-only (Rules UNCHANGED, no hash re-pin). Client: pure mapOpportunityReadResult behind existing seam
(governed source swaps at activation, no frontend rewrite). NEXT = live writes (grant+deploy) OR read
activation (opportunity.read grant + listOpportunityContext deploy) — both Owner/operator-gated; NO client
Rules widening (return with evidence if ever needed). Live-browser persona pilot (B) still pending as a
bounded run.
**EDITING-READY DETAIL COMPOSITION MERGED — PR #671 (squash 95d72c2).** Owner req: compose the Opportunity
detail for BOTH read/scan AND edit/operate responsively so activated governed writes need NO structural
redesign; fail-closed (no activation/deploy/Rules). New PURE `domain/opportunityFieldModel.js` = FOUR DATA
CLASSES kept distinct (USER_MAINTAINED need/lines/value/close/nextAction/Channel/owner-reassignment[governed]/
future-qual · SYSTEM_DERIVED attention/state read-only · LIFECYCLE_ACTION Stage/WON/LOST governed-transitions-
NOT-field-edits[no stage <select>] · READ_ONLY id/audit honest "not recorded"). Classification is SEPARATE
from runtime write-readiness (data model = "can edit"; seam = "may edit now"). Interaction = SECTION-LEVEL
editing (read by default; contextual Edit per section; compact single-column form; one at a time; Cancel
side-effect-free) — recomposes desktop→tablet→phone, never a squeezed desktop grid. Edit+lifecycle disabled/
honest until opportunityWriteReadiness() flips; Save also gated on wired onSaveSection command; validated by
injection+fixtures only. Channel from SALES_CHANNELS (widens w/ Coverage #15, not hardcoded); Qualification a
preserved seam. Tests: opportunityFieldModel.test.mjs (node:test 11) + salesWorkspace.test.jsx (+6→12 vitest);
CI paths+step+lint extended. Doc docs/design/sales-opportunity-editing-ready-composition.md. No user-guide yet
(workspace inert/not user-operable — a how-to would be premature/dishonest).

**RESPONSIVE RECONCILE MERGED — PR #672 (squash fc25c86).** Owner reconcile of #671 vs FULL responsive/
editing req (PRESERVE #671, close only real gaps). Found the ORIGINAL visual defect was on the PIPELINE
(master), NOT the detail #671 fixed: at intermediate width the 6-col table overflowed its grid cell + COLLIDED
with the detail rail. VISUALLY VERIFIED still-live on main via real-browser layout geometry (harness = temp
_verify/ vite page rendering real SalesWorkspace + real index.css on SYNTHETIC source, NO auth/emulator/deploy;
in-app Browser pane can't composite screenshots when hidden → measured getBoundingClientRect instead). Fix =
content priority (recompose not squeeze): .fo-sales-pipeline-wrap overflow-x guard (can't overlap rail) +
defer Channel+Expected-close (.fo-sales-col--secondary, hide ≤1024, still shown in detail) + phone ≤640 row→
labelled block (thead hidden, per-cell data-label). Caught+fixed a specificity bug (phone td display:flex beat
bare secondary-hide → qualified with .fo-sales-pipeline). Measured 900px: table right 593→509 vs aside 529
(overlap→clear); verified 400/768/900/1360 no overlap/no page-scroll/master-detail intact. Regression: jsdom
has NO layout engine → lock STRUCTURE (wrapper+secondary-class+data-labels), salesWorkspace.test.jsx 12→15.
OWNER DISPLAY (SALES-001-D) = PRESERVED FINDING: canonical resolveOwnerIdentity exists (commercialProfile.js)
but needs a byUserId directory + Person-Assignment shape NOT wired to Sales source (owner=bare id) → per
do-not-invent/#15 NO resolver added. §13 inert-write judged adequate (banner+lifecycle note visible, not
tooltip-only). All #671 behavior preserved. Browser-pane visual-verify pattern is REUSABLE (temp vite harness
+ getBoundingClientRect when pane hidden). LAUNCH.JSON attach-mode (.claude/launch.json url=origin only, no
path) needed to open localhost in the pane (direct navigate blocked by policy); removed after.

**Durable BUSINESS CAPABILITY REGISTER created + MERGED (PR #650, docs-only): `docs/roadmaps/business-
capability-register.md`** — 11 seeds (11=Operational-Commitment WATCH ITEM) + xrefs to Temporary Equipment
([[project_temporary_equipment_pool_placement]]) + Technician Labor ([[project_technician_labor_cost_accounting]]);
Roadmap Review Rule at each cycle transition.

**NEXT MAJOR FRONTEND PROGRAM = SALES** (design the OPERATING PROCESS first, not disconnected CRM tabs).
Sales assessment (agent, 2026-08-07): NO Sales pipeline exists in code (no opportunity/lead/quote/estimate/
pipeline/pricing/discount/salesOrder/invoice collection). REUSE canonical authorities — Customer→accounts
(accounts.js:41, admin/dispatcher client-direct-with-rules; commercial-profile fields incl paymentTerms/
taxStatus/accountOwner), Contact→contacts, Location→locations, Product→parts(partId==SKU, ADR-008),
Equipment→equipment/equipment_models (ADR-006/010). GREENFIELD (design-first, gate chain): opportunity/lead,
qualification, quote/estimate+line items, pricing/tax/discount engine, sales approvals, service-offering
catalog, sales activities, real forecast (financialForecastHorizons unconfigured-only), salesperson
assignment/territory (accountOwner is free text, not an identity link; ADR-012 no team/scope model).
Won→Ops SEAM = createWorkOrder callable (createWorkOrder.ts:46, admin/dispatcher-only; Sales supplies inputs,
never writes fieldops_wos/stock/invoice — ADR-009). salesManager governed role exists INERT (only account.
record.* ). ADR-012: persona != authority (do NOT convert Sales personas to security roles). **SMALLEST FIRST
INCREMENT (Cycle 2) = a read-first Account/Customer Operating Workspace over canonical accounts** (list/search
+ customer-360: commercial profile/contacts/locations/installed equipment/WO history + honest "not connected"
financials) with ONE write = "Create Work Order for this customer" via createWorkOrder — a proving ground for
the Wave-0 primitives. Roadmap: Cycle2 Sales Operating Workspace → Cycle3 Opportunity experience (greenfield
authority first) → Cycle4 Estimate/Quote guided flow (quote inside Opportunity, not a permanent tab) → Cycle5
Won→Ops handoff → Cycle6 Sales management/monitoring (do NOT auto-build a Sales Control Tower). Production
caveat: createWorkOrder inert until Issue #15 (Functions not deployed in prod). See [[project_enterprise_
operations_os_vision]], [[feedback_merge_autonomy_execution_ownership]].
