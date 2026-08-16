# AI memory manifest — what Claude holds outside this repository

**Generated 2026-08-16.** Purpose: make Claude's private memory **auditable**. The Owner should never
have to wonder what an AI "remembers" — this file lists every entry Claude holds, so the answer is a
file you can open and diff, not something you have to take on trust.

## The rule this manifest enforces

- **Project truth lives in this repository.** Specs, status, decisions, architecture, evidence — in `docs/`,
  where the Owner, Claude, and ChatGPT all read the same words.
- **Private memory holds only working preferences and pointers** — how to work with the Owner, environment
  gotchas, and links back to repo authority.
- **A memory entry is never authority.** If memory and the repo disagree, **the repo wins**, always.

## What changed on 2026-08-16

An audit found **85 entries / 723 KB (~185k tokens)** in private memory, of which **88% was project state**
and **71% was 22 long-form journals of already-completed work** — a shadow copy of `docs/` that nobody
could audit. Remediation:

| Action | Result |
| --- | --- |
| 22 journals archived verbatim to `docs/ai/memory-archive/` | nothing lost, now readable in-repo |
| those entries collapsed to pointers | **517 KB → 23 KB** |
| stale repo paths annotated | 12 found, marked `(no longer in repo)` |
| broken cross-links repaired | 8 across 7 entries |
| entries missing from the index | 2 restored |
| standing rule recorded | `feedback_project_truth_lives_in_repo` |

Archived notes carry a **NOT AUTHORITY** banner. They are history, not decisions of record.

## Current contents (86 entries, ~233 KB)

## Feedback — how to work with the Owner (30)

Genuinely private and appropriate to keep here: preferences, escalation thresholds, communication format. Has no repo home and asserts nothing about the product.

| Entry | Size | What it holds |
| --- | ---: | --- |
| `feedback_agents_use_sonnet` | 0.9 KB | Owner directive — all dispatched agents (subagents, workflow agents, fix/scout fleets) use the Sonnet model |
| `feedback_authorization_scope_is_literal` | 1.5 KB | A specific authorization covers ONLY the named target — do not extend it to newly-discovered instances |
| `feedback_autonomous_finding_remediation` | 2.9 KB | Owner rule (2026-08-07): a discovered defect/UX-fail/CI-bug/bad-layout is NOT a stopping point — discover→classify→scope→fix→test→retest→converge→merge→report autonomously; stop ONLY when the correct fix requires a new material decision or protected action |
| `feedback_chatgpt_review_before_merge` | 2.3 KB | User splits work across two AI tools — ChatGPT for architecture/governance/UX/PR review, Claude Code for implementation — never treat my own analysis as final sign-off |
| `feedback_codex_review_request_format` | 2.0 KB | When requesting a Codex review, send a concise structured request, not a large operating prompt -- Codex doesn't share Claude's instructions |
| `feedback_continuous_execution_authority` | 2.7 KB | Standing authority to continue through reversible repository work within an approved workstream without a per-artifact gate; hard stops enumerated |
| `feedback_copy_paste_result_format` | 6.3 KB | Status reports = readable prose; only actionable handoffs/prompts/commands/runbooks = one clean copyable fenced block (governing rule 2026-08-10) |
| `feedback_delegation_charter_tier_model` | 2.9 KB | docs/DelegationCharter.md (Active, adopted 2026-07-11) governs decision authority in Taylor_Parts directly -- Tier 1/2/3 model, read every session |
| `feedback_document_everything` | 1.3 KB | Everything built must be documented — governance artifacts AND user-facing how-to docs — as a first-class deliverable, not an afterthought |
| `feedback_emulator_rules_source_gotcha` | 1.7 KB | Firebase emulator loads firestore.rules from the CWD's firebase.json — running it from a repo root on a stale feature branch enforces the WRONG rules |
| `feedback_environment_state_from_environment` | 2.2 KB | Owner 2026-08-16: never report an environment as updated/deployed from a command's exit status — read the environment itself (/version.json) and quote the commit, or say it is unverified |
| `feedback_evidence_required_review_policy` | 1.6 KB | EVIDENCE_REQUIRED from an independent AI review does NOT auto-require another AI review; re-review only for material/authority/security/behavior changes |
| `feedback_execution_governance_section_model` | 2.6 KB | Expanded build authority — section-based autonomous execution within an approved Blueprint; escalate only for protected boundaries |
| `feedback_gh_project_scope_gap` | 1.4 KB | gh CLI token lacks project scope; don't retry Taylor Freezer project item-add/list each session until Owner confirms refresh |
| `feedback_merge_autonomy_execution_ownership` | 2.5 KB | Once an architecture/direction is Owner-approved, Claude owns execution THROUGH MERGE — review corrections/rebases/CI fixes are not new gates |
| `feedback_multi_session_labeling` | 4.0 KB | concurrent Claude sessions each tag their result boxes with a session number (Session 1, Session 2, ...); which number THIS session is comes from the Owner in-session, never from memory |
| `feedback_never_search_credentials` | 2.9 KB | Never search for, request, or use production credentials to work around a blocked read/write in Taylor_Parts -- tested repeatedly, held firm every time |
| `feedback_owner_sole_conduit_chatgpt` | 1.4 KB | The Owner is the sole conduit between Claude and ChatGPT — all cross-AI interaction is mediated by the Owner's input, never direct |
| `feedback_parallel_orchestration_model` | 2.6 KB | How the build program runs in parallel — Claude is the orchestration/integration hub over worktree-isolated workers; batches worker questions back to Owner; W0 solo first |
| `feedback_parallel_session_worktree_isolation` | 2.0 KB | Taylor_Parts runs multiple concurrent Claude sessions on separate initiatives -- always work in an isolated worktree and re-check for collisions before touching shared docs |
| `feedback_proactively_invoke_project_skills` | 1.3 KB | Invoke the repo-local workflow skills/hooks proactively when the moment fits — don't wait to be asked by name |
| `feedback_prod_test_accounts_access` | 1.3 KB | All non-Owner accounts are fictional test personas; Owner permits Prod access to test THEM — but governed mutations still route through the authorization gate |
| `feedback_professional_nonslop_quality_bar` | 1.2 KB | Everything built must be professional-grade and NOT \"AI slop\" — polished, coherent design, not generic/templated output |
| `feedback_project_truth_lives_in_repo` | 2.1 KB | Owner 2026-08-16: project truth lives in the repo, private memory holds only working preferences + pointers — a second private store is what made 'what do you remember' unknowable |
| `feedback_question_reduction_directive` | 1.7 KB | Owner directive 2026-08-05: ask FAR fewer questions; treat prior operating decisions as continuing authority; questions are exceptional, not the default |
| `feedback_reduce_stops_self_merge_lowrisk` | 4.6 KB | Owner 2026-08-05 + reaffirmed 2026-08-15 (Wave 5): self-verify + self-merge clean low-risk Tier-1 sections without waiting for Codex/ChatGPT review; reserve stops for protected/material/genuinely-risky work |
| `feedback_sprint_lifecycle_workflow` | 1.8 KB | Standing repo workflow for this project - health check at sprint start, cleanup at sprint end |
| `feedback_system_authorities_doc` | 1.6 KB | Update docs/architecture/SYSTEM_AUTHORITIES.md whenever a canonical ownership changes in Taylor_Parts |
| `feedback_token_budget_discipline` | 2.1 KB | Tokens/cost are the real guardrail — work within the 5-hour and weekly limits; estimate + cap large fan-outs; don't cause unexpected spend |
| `feedback_verify_before_recommending` | 1.3 KB | Never speculate about branch/PR state — always verify current repo state before recommending merge order or next actions |


## Project — pointers to repo authority (47)

Should contain **pointers only**. Entries marked *(pointer)* were collapsed on 2026-08-16; the authority is the linked `docs/` path. Any entry here that grows back into a journal is a regression against the rule above.

| Entry | Size | What it holds |
| --- | ---: | --- |
| `project_admin_password_reset_roadmap` | 6.4 KB | Customer admin password-reset roadmap (AUTH); native-send gates merged; D-PROD-1A preflight executed → aggregate HALT (fail-closed intact) |
| `project_agent_orchestration_quality_system` | 8.6 KB | Corporate Agent Orchestration & Quality System framework (validation agents) lives in project-keystone; Taylor product adapter + coverage register in docs/quality/; model tiers + agentId naming standard |
| `project_auth_modernization_workstream` *(pointer)* | 1.0 KB | Auth Modernization program (username login, recovery, admin reset, App Check, test-user email migration) — 7 lanes A–G; Lane A PR #435 draft |
| `project_auth_pr4_workstream` | 4.6 KB | AUTH-PR-4 test-persona recovery-email migration — readiness, operator workflow, and production-enablement gate; all repository-only, production still NOT authorized |
| `project_auth_single_source_of_truth` | 2.3 KB | Field Ops (field-ops-app-vite) deliberately has no parallel session/localStorage layer — Firebase AuthContext is the sole source of truth for auth state |
| `project_authpr4_genesis_reconciliation_redesign` *(pointer)* | 0.9 KB | AUTH-PR-4 PR #461 genesis initializer + reconciliation state-machine redesign; Codex review loop status |
| `project_build_program_world_class_crm` *(pointer)* | 1.2 KB | The \\\"turn Claude loose\\\" program to build Taylor_Parts into a rough-complete, world-class small-business CRM + inventory management system — scope, spine, workstreams, boundaries |
| `project_business_capability_register` | 4.3 KB | Durable Business Capability Roadmap / Coverage Register (docs/roadmaps/business-capability-register.md) + the Sales granularity/cardinality truths that must survive compression |
| `project_c7_cold_start_context` | 3.7 KB | C-7 context registry + cold-start efficiency workstream — where the EOS fresh-session bootstrap lives and its pending acceptance-test gate |
| `project_card_composition_standardization` *(pointer)* | 0.8 KB | Site-wide card/composition design-system standardization program (Waves 1-4 merged; Wave 5 scoped, NOT started) |
| `project_chatgpt_eos_intake_loop` | 6.7 KB | ChatGPT→GitHub→EOS work-intake loop — #789 bridge + my status/ingress/capability completion (#792); Secret Broker does NOT exist; #790/#791 are others' open PRs |
| `project_claude_small_business_skills_evaluated` | 1.9 KB | Claude for Small Business (15 SMB skills) evaluated and set aside for this project — revisit only if Anthropic adds more |
| `project_commercial_coverage_territory` | 6.9 KB | Durable roadmap req (recorded 2026-08-07): Commercial Coverage & Territory Management — RECORD + preserve seams, do NOT build during current Sales→Fulfillment runway; register #15 |
| `project_comprehensive_review_and_remediation` | 3.1 KB | Gated 7-pass repo review of origin/main a8ff55c completed; F-UID-1 fixed/merged/deployed; F-RULES-1 assessed next; open findings backlog |
| `project_continuous_workstream_orchestrator` *(pointer)* | 1.2 KB | Continuous Workstream Backlog & Orchestrator — durable schedulability backlog + state machine + selection rule closing the 'completed work doesn't auto-trigger next execution' gap; MERGED #703; two Owner decisions returned |
| `project_dev_workflow_tooling_backlog` | 2.4 KB | Owner-flagged dev-workflow tooling gaps to fix as future enhancements (not yet scheduled) |
| `project_ei_p1a_pure_inventory_contracts` *(pointer)* | 1.1 KB | EI-P1a pure Enterprise Inventory contracts PR #502 — MERGED to main (merge commit 4fc1262) under Owner authorization; repo-only, no deploy |
| `project_ei_phase2_receiving` | 9.3 KB | EI Phase-2 Receiving multi-gate workstream; Phases A-D + I-LA location chain + E1 callables + Capability Grant Gate all MERGED to main (repository-only, nothing deployed); inventory.stock.receive now granted to {admin,dispatcher,owner}; next gates E2/F/G each need separate Owner auth |
| `project_enterprise_operations_os_vision` | 2.6 KB | Taylor Parts has evolved into an AI-native \"Enterprise Operations OS\" vision, layered above the existing governance framework |
| `project_eos_design_system_and_sales` *(pointer)* | 0.9 KB | EOS composition foundation RATIFIED + Wave 0 primitives MERGED (#646); Product/Design=one stream heading to a Sales frontend program (assessment done, opportunity/quote greenfield) |
| `project_eos_process_engine_ux_e2e_gap_audit` *(pointer)* | 1.2 KB | Full analysis-only audit spec (PROCESS/ENGINE/UX/E2E across Sales, WO, Inventory, Billing, Ventana) — queued as Wave 5 item 5, NOT started |
| `project_equipment_compatibility_d4` *(pointer)* | 1.1 KB | Equipment/Part Compatibility D4 trusted persistence (PR #459 draft) — Stage B.1 contracts and the governed alias identity decision |
| `project_equipment_custody_serialized_asset` *(pointer)* | 0.9 KB | Equipment Custody / Serialized Asset↔Equipment P0 Spec — Rev 6 FINAL PASS; governance-aligned to Enterprise Inventory; ADR-010/#59 reconciliation gate next |
| `project_f_rules_1_legacy_read_scoping` | 2.5 KB | F-RULES-1 CLOSED (D#39 enforced in production, D#41 recorded) — history + open successor items |
| `project_inv_convergence_a` *(pointer)* | 1.2 KB | INV-CONVERGENCE-A recovery assessment — Inventory→Parts vs canonical parts Part Master; PR #417 draft |
| `project_inv1_inventory_governance` *(pointer)* | 1.7 KB | INV-1 inventory governance — Phase 0 CLOSED; ADR-008 Accepted (D#40); PHASE 1 COMPLETE 2026-07-22 (PRs 1.1–1.10 all merged, 1.10=#398/68c6b91, readiness BLOCKED by design); D-M1..D-M7 resolved + recorded as Decision #42 (PR #399 merged ff00a09); dry-run authorization APPROVED + enablement tooling merged (#400/e18d7cf); production dry run EXECUTED (CREATE=190, BLOCKED), evidence imported+merged (#401/453b789); C9–C15/C17 approved; CREATE write-tool merged (#402); temp capability role merged (#403/ced49c7 — inventory.catalog.manage now grantable); next = Rollback Export + audited production role grant; no deploys/migration/flag/Phase 2 authorized |
| `project_issue_325_report_creator_status` | 8.7 KB | Issue #325 governed report creator — F1-F4 Customer inert foundation merged/live; #325 open, Customer now waiting on Inventory/Functions lane |
| `project_next_lever_reassessment` | 9.8 KB | Post-Supplier-Master evidence-based reassessment of the strongest Product Engineering lever — selected Part Master in-app catalog write workspace; pending Owner ratification |
| `project_owner_control_center_delivery` | 2.9 KB | Owner Control Center hosting decision (Model A) + delivery state — what's built repo-safe vs Owner/operator-gated |
| `project_owner_control_plane_ai_collab` *(pointer)* | 0.9 KB | EOS Owner Control Plane + Governed AI Collaboration phase — ratified decisions, layer split, what's repo-safe vs Owner-gated |
| `project_parts_ux_redesign` *(pointer)* | 0.7 KB | Parts UX redesign + Action Center audit program (Wave 6) — full analysis package delivered, first bounded slice merged |
| `project_per_env_capability_activation` *(pointer)* | 0.9 KB | Per-environment capability activation build (sandbox-only spine) + sandbox update mission status |
| `project_purchasing_po_ui_and_scanner` *(pointer)* | 0.8 KB | Purchasing build sections after Blueprint waves — Purchase Orders read surface (item C) MERGED; next section A = PartsScanner-as-tool-within-FieldMode consuming live receiving |
| `project_receiving_location_authority` *(pointer)* | 1.3 KB | I-LA gate ratified C2 -- warehouses.status is the governed first-slice Receiving location-eligibility authority; spec merged (PR #539), NO code yet; phased roadmap I-LA1..I-LA5/E1/E2/F/G each needs its own gate |
| `project_reciprocal_review_benchmark` | 6.2 KB | Full Autonomous Taylor Benchmark — Phase A review-feed modules built+merged, Candidate A (#786) is the subject, one-trigger benchmark READY (Owner runs it) |
| `project_sales_to_cash_runway` *(pointer)* | 1.2 KB | Sales→Fulfillment→Ops autonomous build runway (Owner velocity mandate 2026-08-07): Opportunity→WON→Sales Order→Fulfillment→Warehouse→Dispatch→Field→Completion→Billing→AR. Compact Product ledger + where it stops. |
| `project_sandbox_fixture_pipeline` | 3.5 KB | Stream C production-derived Parts/Inventory/Equipment fixture pipeline — repo-only tooling MERGED (#644); next step is the operator production READ (boundary) |
| `project_site_work_discovery_loop` | 4.7 KB | Continuous site-work fix loop for the Taylor app — scout → prioritize → fix → rescan; RE-SYNC from the in-repo register, not memory |
| `project_supplier_master_program` *(pointer)* | 1.2 KB | Supplier Master adoption — Owner-authorized Tier-2 program (governed Supplier identity replacing free-text supplierName); phases S1–S5 repo-only; S1+S2-validator merged, S2-commands→S5 remain |
| `project_taylor_ventana_lines_of_business` *(pointer)* | 0.8 KB | Two lines of business under common ownership — Taylor (local dealership + full support system) and Ventana (national accounts, consumes Taylor's support system) |
| `project_technician_labor_cost_accounting` | 4.2 KB | Durable cross-domain roadmap requirement (recorded 2026-08-07): Technician Labor + Time Accounting — paid≠job≠travel≠onsite time, labor hours≠cost≠billing, effective-dated cost-rate authority, honest reconciliation w/ UNACCOUNTED; assess AFTER Service Ops convergence + F2 + sandbox; DO NOT build now |
| `project_temporary_equipment_pool_placement` | 3.7 KB | Durable cross-domain roadmap requirement (recorded 2026-08-07): Temporary Equipment Pool + Placement (SERVICE_LOANER + SALES_EVALUATION) — record/preserve-seams now, formally assess/build AFTER F2 + mature Equipment/Inventory sandbox evidence |
| `project_truck_management_ui_gate` *(pointer)* | 1.2 KB | Truck Management UI (Gate B) DRAFT PR #518 — repo-only write UI over the 8 undeployed truck callables, fail-closed write-readiness seam |
| `project_ux_journey_program_state` | 3.3 KB | UX pause CLOSED; C713x5 journey round 1 evidence, the exposure gap, and persona-orchestration rules learned the hard way |
| `project_ventana_ice_machine_lifecycle` | 3.6 KB | Ventana ice-machine inventory-control lifecycle — two-condition exit projection, built reusing existing Taylor capabilities |
| `project_wo_scheduling_and_roadmap_reassessment` *(pointer)* | 0.9 KB | Work Order Scheduling weekly workspace MERGED (exposes deployed SCHEDULED transition); plus the evidence-based full-chain roadmap reassessment that selected it |
| `project_workflow_automation_skills_hooks` | 4.3 KB | Repo-local skills + hooks that automate recurring Taylor_Parts ceremony (Codex requests, doc scaffolding, rules deploy-verify, session context, rules guard) |


## Reference — environment and tooling facts (9)

Machine/tooling facts that are not product truth (Node setup, CI quirks, shell gotchas).

| Entry | Size | What it holds |
| --- | ---: | --- |
| `reference_ci_matrix_and_auditaction_parser` | 4.2 KB | Repo runs a full GitHub Actions CI matrix (~32 checks) on every PR — wait for green before merging; plus the AuditAction-union first-semicolon parser gotcha |
| `reference_claude_cli_drivable_windows` | 1.7 KB | The claude CLI IS installed and drivable on this Windows machine via its full path — do not claim \"I can't run claude\" again |
| `reference_claude_code_skill_plugins_audited` | 2.4 KB | Security-audit results for third-party Claude Code design skills (impeccable, taste-skill) + how to install/vet plugins from GitHub |
| `reference_engineering_model_and_ownership` | 3.8 KB | Where the durable AI engineering operating model + human/company ownership+IP posture live in the repo (adopted 2026-08-06, DECISIONS #67, PR #583) |
| `reference_firebase_tools_emulator_runner_gotchas` | 2.1 KB | Two firebase-tools gotchas when scripting the emulator (VSCODE_CWD templates break; POSIX group-kill leaks the Java emulator) — hit while building the Issue |
| `reference_node_environment` | 3.3 KB | Node version setup on this machine — system Node 22 is on PATH and correct for tooling/tests; don't ask the user to set Node |
| `reference_sandbox_credentials_handling` | 1.8 KB | Canonical sandbox credential file + strict handling rules for persona sign-in / E2E |
| `reference_sandbox_functions_batch_deploy_flakiness` | 2.2 KB | firebase deploy --only functions on eos-platform-sandbox fails a subset of ~65 functions with a generic IAM/request error on large batches — transient concurrency, not a permissions or org-policy block |
| `reference_worktree_fleet_shared_infra_hazard` | 2.0 KB | Parallel worktree-isolated fix fleets share one git-stash stack and one Firestore emulator port — real cross-agent contamination; mitigations |


## How to audit this yourself

1. Ask Claude: *"dump your full memory index with last-verified dates."* Compare to this file.
2. Ask ChatGPT the same, for its own store.
3. Anything either one asserts about the product that is **not** in `docs/` is unverified by definition —
   treat it as a claim to check, not a fact.
