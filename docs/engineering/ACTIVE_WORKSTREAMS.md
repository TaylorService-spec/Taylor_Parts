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

- Capability:          Overnight Tier-1 program — Opportunity write paths, Sales Order fulfillment view, Part identifiers, roadmap reconciliation
- Agent/session:       Claude (overnight autonomous program, 2026-08-20) · Role: builder
- Branch / worktree:   sequential single-writer lanes off `origin/main`; one isolated worktree used only for the #1061 trial merge, removed afterwards
- Base commit:         `969305e1` (start) → `d7592671` (after #1341 and #1342)
- Owned paths:         functions/src/opportunity/ · functions/src/salesOrder/salesOrderReadService.ts · field-ops-app-vite/src/domain/salesOrderFulfillmentProgress.js · field-ops-app-vite/src/modules/sales/ · field-ops-app-vite/src/shared/partMaster/PartIdentifiersSection.jsx · docs/orchestration/lib/roadmapModel.mjs
- Shared paths req'd:  functions/src/types/access.ts (AuditAction union) · functions/src/access/auditEventWriter.ts (runtime mirror) · functions/package.json · docs/orchestration/execution-backlog.md · this registry
- Dependencies:        none blocking; ran sequentially so no two writers shared a branch or checkout
- Expected outcome:    governed Opportunity edit + atomic close-as-WON, Sales Order index mounted, fulfillment progression, Part identifier surface, roadmap truthful against main
- Protected boundaries:reached and NOT crossed — no deploy, no capability activation, no role grant, no Rules change, no provisioning, no sandbox or production data mutation. The emulator was local only and stopped.
- Lifecycle stage:     SANDBOX BUILD (repo-only; nothing deployed or activated)


- Capability:          EOS cost/capacity semantic correction (#831 regression)
- Agent/session:       Codex `/root` · Role: builder
- Branch / worktree:   `codex/eos-cost-capacity-semantics` · `D:\Taylor_Parts-cost-capacity`
- Base commit:         `e111b4b`
- Owned paths:         EOS cost/capacity contract and focused wake/intake tests
- Shared paths req'd:  wake/intake status/runtime wiring · intake CI · this registry
- Dependencies:        Durable #831 status/result and existing provider-neutral capacity contracts
- Expected outcome:    Billed spend, modeled cost, and provider capacity remain distinct; synthetic Claude dollars cannot stop uncapped subscription work
- Protected boundaries:No #831 rerun, provider activation, credential, routing, integration, deployment, or automatic merge
- Lifecycle stage:     RELEASE CANDIDATE

- Capability:          Cortex EOS provider adapter pilot (read-only, provider-neutral)
- Agent/session:       Codex `/root` · Role: builder
- Branch / worktree:   `codex/cortex-provider-pilot` · `D:\Taylor_Parts-cortex-provider-pilot`
- Base commit:         `49451d899e80191940f577645f63a2cfde2f42a7`
- Owned paths:         `docs/orchestration/lib/cortexProviderAdapter*`
- Shared paths req'd:  `.github/workflows/orchestration-agent-manager-tests.yml` · this registry
- Dependencies:        Existing AgentRequest, AgentResult, Verifier, and governed work-intake result contracts
- Expected outcome:    One bounded READ_ONLY_PILOT Cortex worker can return attributable, verified, durable EOS results without changing Claude
- Protected boundaries:No live provider activation, credential use, mutation, approval, integration, deployment, or merge
- Lifecycle stage:     RELEASE CANDIDATE

- Capability:          EOS implementation write-back isolation + governed patch integration
- Agent/session:       Codex `/root` · Role: builder/integration
- Branch / worktree:   `codex/eos-implementation-writeback` · `D:\Taylor_Parts-eos-implementation-writeback`
- Base commit:         `0f5bc8d0a496e5590ffbd0c6c23ebba3f418c911`
- Owned paths:         EOS issue/runtime/integration workflows · `intakePatch*` · `intake-artifactize*` · `intake-patch-integrate*`
- Shared paths req'd:  `docs/DECISIONS.md` · this registry · work-intake README/test wiring
- Dependencies:        PR #814 artifact-only guard; recovered #818/#819 sessions under `D:/Taylor_Parts-diagnostics-818-819/`
- Expected outcome:    Isolated Claude mutations become governed report/patch artifacts; only separately approved exact patches may integrate
- Protected boundaries:No automatic patch application, force push, permission expansion, blind stash, Claude rerun, or merge before independent review
- Lifecycle stage:     SANDBOX BUILD

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
- Lifecycle stage:     SANDBOX BUILD

- Capability:          [CLOSED — DONE WHEN THIS CHANGE MERGES] Governed Owner/ChatGPT work-intake bridge (repo-safe minimum)
- Agent/session:       Codex `/root` · Role: builder
- Branch / worktree:   `agent/governed-work-intake` · `D:\Taylor_Parts\.worktrees\governed-work-intake`
- Base commit:         `fe3512f07f0bee4d4654d4fe278f0302326d402c`
- Owned paths:         `docs/orchestration/lib/workIntake.mjs` · `docs/orchestration/lib/workIntake.test.mjs` · `docs/orchestration/context/work-intake.mjs` · `docs/orchestration/context/work-intake.test.mjs` · `docs/orchestration/work-intake/**`
- Shared paths req'd:  `docs/orchestration/agent-requests/README.md` · this registry
- Dependencies:        Reuses `selectNextWork`, Wake Supervisor state contract, Agent Result lifecycle, `aiExchange`, review artifacts, and GitHub-backed provenance; no new runtime or queue
- Expected outcome:    Hash-pinned durable work artifact resolves by ID + location + SHA-256 into the existing selector; compact content-addressed result pointers return to the same durable orchestration surfaces
- Protected boundaries:No live OpenAI/Claude call, deployment, production write, policy/rules/auth change, or unattended runtime activation
- Lifecycle stage:     RELEASE CANDIDATE → DONE on merge

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
