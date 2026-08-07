# Taylor / EOS — Agent Orchestration & Quality Adapter (v1)

**This is the PRODUCT ADAPTER** for the corporate **Agent Orchestration & Quality System** framework
(Project Keystone → `frameworks/agent-quality-system/`). The framework owns *how* validation agents run; this
adapter owns *what is Taylor/EOS-specific*: the personas, the agent inventory, the change→agent routing bound
to this repo, the pilot plan, and the overlap review. It never redefines the framework.

**Relationship to existing governance (align, do not duplicate):**
- Engineering/**builder** agents (who write code) are governed by
  [`docs/engineering/AI_ENGINEERING_OPERATING_MODEL.md`](../engineering/AI_ENGINEERING_OPERATING_MODEL.md) §8
  + [`ACTIVE_WORKSTREAMS.md`](../engineering/ACTIVE_WORKSTREAMS.md). **This adapter governs the complementary
  validation/quality agents (who produce evidence, not authority).**
- Persona ≠ security role: [`ADR-012`](../architecture/ADR-012-persona-authority-composition-and-scope.md).
  This adapter creates **no** permissions/capabilities/roles.
- Existing persona evidence base: [`docs/reviews/persona-shell-review-rounds-1-2.md`](../reviews/persona-shell-review-rounds-1-2.md).
- Coverage-discipline sibling: [`docs/roadmaps/business-capability-register.md`](../roadmaps/business-capability-register.md).
- The live **Agent Coverage Register** instance: [`agent-coverage-register.md`](./agent-coverage-register.md).

---

## A. Existing agent inventory (what already exists)

`agentId` is provider/model-independent (framework §4); `modelTier` is separate metadata (framework §7a).

| agentId | displayName | family | default tier | Where it lives | Status |
|---------|-------------|--------|--------------|----------------|--------|
| `P-DISPATCH` | Dispatcher / Service Manager persona | PERSONA | economy (regression) / standard (discovery) | persona-shell review R1–R2 missions | ACTIVE |
| `P-TECH` | Technician persona | PERSONA | economy / standard | persona-shell review R1–R2 | ACTIVE |
| `P-MATERIALS` | Inventory / Warehouse persona | PERSONA | economy / standard | persona-shell review R1–R2 | ACTIVE (blocked, #226/R-1) |
| `P-ADMIN` | Administrator / Owner persona | PERSONA | economy / standard | persona-shell review R1–R2 | ACTIVE |
| `Q-LEGIBLE` | Design-code reviewer | QUALITY (legibility) | standard | `.claude/agents/design-code-reviewer.md` | ACTIVE |
| `DOC-WRITE` | User-docs writer | DOCUMENTATION | economy/standard | `.claude/agents/user-docs-writer.md` | ACTIVE |
| `UX-COMPOSE` | UI quality (impeccable + taste-skill) | UX / EXPERIENCE | standard | installed plugins | ACTIVE |
| `Q-CODE` | Correctness review (`/code-review`, `ultra`) | QUALITY / REGRESSION | standard (economy narrow diff / advanced arch-heavy) | CLI, Owner-triggered | ACTIVE |
| `Q-CODEX` | External Codex review | QUALITY (external) | n/a (external) | `.claude/skills/` + `skills/codex-review-request` | ACTIVE |
| `REL-RULES` | Rules deploy verifier | RELEASE / EVIDENCE | economy | `.claude/skills/` + `skills/verify-rules-deploy` | ACTIVE |
| `U-EXPLORE` / `U-PLAN` | Explore / Plan / general-purpose | utility (cross-family) | economy/standard | harness | ACTIVE |
| `GOV-DRIFT` | Governance drift reviewer | GOVERNANCE | standard (→advanced on authority conflict) | inline today | DEFINED (gap) |
| `SEC-ACCESS` | Security reviewer | SECURITY | standard (→advanced on authz architecture) | inline today | DEFINED (gap) |
| `DATA-ID` | Data integrity (`partId`≠`sku`, convergence) | DATA | economy (deterministic) / standard (ambiguous) | inline today | DEFINED (gap) |
| `J-*` | Cross-persona Journey (e.g. `J-SERVICE-INV`) | JOURNEY | standard (→advanced on multi-domain synthesis) | inline today | DEFINED (gap) |
| `A11Y` | Accessibility reviewer | ACCESSIBILITY | economy | inline today | DEFINED (gap) |
| `RESP-QA` | Responsive QA | ACCESSIBILITY/UX | economy | inline today | DEFINED (gap) |
| `DOC-VERIFY` | Documentation verifier | DOC-VERIFICATION | economy | not yet distinct | DEFINED (gap) |
| `REL-EVIDENCE` | Release / SHA / CI evidence convergence | RELEASE / EVIDENCE | economy | inline today | DEFINED (gap) |

The primary orchestrator / Product-Design reasoning runs at **advanced** tier (framework §7a) and is the only
authority that escalates other agents' tiers. `DEFINED (gap)` agents are performed inline today; they are
**registered now, activated per pilot** — not pre-built (framework §12).

**Do not replace working agents to make the framework look uniform** — the four persona reviewers,
design-code-reviewer, user-docs-writer, and the skills stay; they are *registered and evolved*, not rebuilt.

---

## B. Taylor / EOS personas + activation maturity

Persona ≠ security role (ADR-012). Maturity per framework §4: DEFINED → ELIGIBLE → ACTIVE → REGRESSION.

| Group | Persona | Maturity | Rationale |
|-------|---------|----------|-----------|
| SERVICE | Dispatcher / Service Manager | ACTIVE | shell reviewed R1–R2; Scheduling/Dispatch live |
| SERVICE | Technician | ACTIVE | field surfaces live; R2 FUNCTIONAL FAIL routed |
| SERVICE | Senior Technician / Field Supervisor | DEFINED | activate when supervisor scope exists |
| MATERIALS | Inventory / Warehouse Manager | ACTIVE (blocked) | reviewed; #226/R-1 access gap (4 destinations, none a warehouse) |
| MATERIALS | Parts Associate | ELIGIBLE | purchasing queues exist; receiving/scanner maturing |
| MATERIALS | Purchasing / Buyer · Purchasing Manager | DEFINED→ELIGIBLE | PO read surface live; write path maturing |
| ADMINISTRATION | System / Access Administrator | ACTIVE | reviewed R1–R2; admin surfaces live |
| MANAGEMENT | Owner / Executive / General Manager | DEFINED | "management/oversight experience unresolved" (persona-review Finding D) — do not prematurely build |
| COMMERCIAL | National Accounts Sales · Retail Sales | ELIGIBLE | Opportunity Cycle 2 read-first + Cycle 3 write authority (inert); ACTIVE once granted/deployed or on synthetic fixtures |
| COMMERCIAL | Sales Manager / VP Sales · Account Manager | DEFINED | activate when Sales management surfaces exist |
| FINANCIAL | Controller / Accounting · A/R / Collections | DEFINED | greenfield (register #6); do not spend budget proving absence |

---

## C. Change-type → agent routing (Taylor-bound)

Framework §8 defaults, bound to this repo's change surfaces. Do **not** run every agent on every change.

| This repo changes… | Run |
|--------------------|-----|
| `docs/**` (non-governing) | Documentation Verifier; Governance only if `docs/architecture` / `docs/governance` / authority docs changed |
| `field-ops-app-vite/src/**` UI/CSS, `shared/ui/**` | UX composition (impeccable/taste); Accessibility; Responsive; relevant persona only if workflow materially changed |
| `firestore.rules` (both mirrors) | Governance drift; Security; rules regression (emulator); Data integrity — **always** (Tier-2) |
| `functions/src/**` domain/commands | Correctness/tests (`/code-review`); Data (identity: `partId`≠`sku`); Governance when authority-sensitive; relevant persona when user-visible |
| `field-ops-app-vite/src/modules/mobile/**`, scanner | Governance drift; F2/business regression; Technician persona; responsive/mobile; accessibility |
| `field-ops-app-vite/src/modules/sales/**`, `functions/src/opportunity/**` | Sales persona (when eligible); Governance; domain tests; UX composition; accessibility/responsive |
| Cross-domain seam (e.g. Service↔Inventory, Opportunity→downstream) | Relevant personas + **Journey** agent |
| `permissionCatalog.ts`, capability grants | Governance; Security; resolver/exhaustiveness (A3) tests |
| Documentation output | Documentation agent, then Documentation Verifier — **after** behavior verified |

---

## D. Pilot plan (next 2–3 real increments)

Per framework §13 (refine on evidence, not speculation). Prefer **real** product work over invented pilots.

Every pilot must exercise the tier spread (framework §7a): at least one **ECONOMY** regression/verification
agent, one **STANDARD** persona/reviewer, and **Product/Design at ADVANCED**.

- **Pilot A — F2 / field scanner.** `GOV-DRIFT` (standard) + `P-TECH` (economy for the established regression
  mission; standard only for new discovery) + `A11Y`/`RESP-QA` (economy) + Product/Design (advanced) for any
  systemic finding. Rich existing evidence (Technician R2 FUNCTIONAL FAIL; Service↔Inventory Finding A).
  Budget: persona SMALL, governance TINY. Max 3 concurrent.
- **Pilot B — Sales / Opportunity (Cycle 3b).** When the Opportunity write-readiness seam lands, use it as
  the **first live orchestration pilot**: `GOV-DRIFT` (standard) + `P-SALES` (standard during discovery, on
  synthetic fixtures) + `UX-COMPOSE` (standard) + `Q-CODE` regression (economy once stable) + Product/Design
  (advanced). Preferable to inventing pilot work (framework §13).
- **Pilot C — first cross-domain Journey** after sandbox fixtures mature: `J-SERVICE-INV` (standard; escalate
  to advanced only for genuine multi-domain synthesis) over the known-broken **Service ↔ Inventory** seam
  (persona-review Finding A).

Each pilot records, per framework: agents selected/skipped, **modelTier per agent + escalations**, budget
classes, scenarios, useful findings, duplicates, loops prevented, retries, remediation ownership, unnecessary
reviewers, coverage gaps — plus the tier-evolution metrics (useful-finding / false-positive / duplicate /
escalation / rerun rate). **After 2–3 pilots, refine the model (including tier defaults) — do not add
infrastructure first.**

---

## E. Overlap review (where current agents duplicate)

- **`design-code-reviewer` vs `/code-review` vs impeccable** — legibility/docs (design-code-reviewer) vs
  correctness/bugs (`/code-review`) vs UI aesthetics (impeccable). Distinct lenses; keep separate. Risk:
  double-reporting the same surface — dedupe by **lane** (framework §6), one finding + corroboration.
- **Persona reviewers vs UX/Accessibility agents** — persona = "can they do the job?"; UX/Accessibility =
  "is the surface sound?" A persona EXPERIENCE FAIL and a UX finding on the same screen are **one finding**,
  routed to the EXPERIENCE lane, not two remediation streams.
- **`user-docs-writer` vs a Documentation Verifier** — deliberately separate (framework §9): the writer must
  not certify its own output.
- **Governance inline vs a Governance agent** — governance checks happen inline today; a distinct Governance
  agent is a DEFINED gap, activated per Pilot A/B rather than pre-built.

No working agent is retired; overlaps are resolved by lane-based finding dedup, not by deleting agents.

---

## F. What was deliberately NOT built (anti-over-engineering, framework §12)

No agent dashboard, orchestration database, queue, event bus, token-billing engine, scheduler, agent
runtime, or workflow engine. No new personas converted to security roles. No new Governance/Journey/Security/
Data agent instantiated before a pilot needs it (registry-first). The run ledger is session-local; only
durable cycle summaries/findings are persisted. Scenario packs and fixtures are added when a pilot selects
them, not speculatively.
