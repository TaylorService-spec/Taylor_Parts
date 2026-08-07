# Taylor / EOS — Agent Coverage Register (v1)

The durable coverage register instance for the corporate **Agent Orchestration & Quality System** (Project
Keystone → `frameworks/agent-quality-system/`, §4/§7). It answers: what agents exist, their family, maturity,
default model tier, what they cover, which scenarios they own, and — most importantly — **where coverage is
missing and where agents overlap.** Optimize for *meaningful coverage, not agent count*. Companion:
[`agent-orchestration-adapter.md`](./agent-orchestration-adapter.md).

`agentId` is provider/model-independent; `modelTier` is separable metadata (framework §4/§7a). Maturity:
DEFINED → ELIGIBLE → ACTIVE → REGRESSION.

## Register

| agentId | family | maturity | default tier | Business/domain coverage | Scenario ref | Remediation authority (lane) | Known gaps |
|---------|--------|----------|--------------|--------------------------|--------------|------------------------------|------------|
| `P-DISPATCH` | PERSONA | ACTIVE | economy/standard | Service dispatch, scheduling, WO oversight | persona-shell R1–R2 §1 | EXPERIENCE / BUSINESS PROCESS | only shell reviewed; deep dispatch workflows not yet missioned |
| `P-TECH` | PERSONA | ACTIVE | economy/standard | Field execution, current job, scanner | persona-shell R1–R2; R2 FUNCTIONAL FAIL | EXPERIENCE / BUSINESS PROCESS | F2 field-mode scenarios thin (Pilot A) |
| `P-MATERIALS` | PERSONA | ACTIVE (blocked) | economy/standard | Inventory/warehouse/parts | persona-shell R1–R2; #226/R-1 access gap | BUSINESS PROCESS / AUTHORITY | blocked: Warehouse Manager sees 4 destinations, none a warehouse |
| `P-ADMIN` | PERSONA | ACTIVE | economy/standard | Administration/access surfaces | persona-shell R1–R2 | EXPERIENCE | management/oversight persona distinct + unresolved (Finding D) |
| `P-SALES` | PERSONA | ELIGIBLE | standard | Opportunity pipeline (Cycle 2 read; Cycle 3 write inert) | (none yet) | EXPERIENCE / CORRECTNESS | activate on synthetic fixtures at Cycle 3b (Pilot B) |
| `Q-LEGIBLE` | QUALITY | ACTIVE | standard | Frontend+domain legibility/docs | ad-hoc | ARCHITECTURE / DOCUMENTATION | — |
| `UX-COMPOSE` | UX/EXPERIENCE | ACTIVE | standard | Per-screen composition/hierarchy/density | per-screen | EXPERIENCE | systematic card-farm sweep deferred (evidence-driven) |
| `Q-CODE` | QUALITY/REGRESSION | ACTIVE | standard | Correctness of changed code | per-PR | CORRECTNESS | business-process regression corpus not yet built |
| `Q-CODEX` | QUALITY (external) | ACTIVE | n/a | Independent architecture/PR review | per-PR (Owner-routed) | ARCHITECTURE | Owner is sole conduit |
| `DOC-WRITE` | DOCUMENTATION | ACTIVE | economy/standard | End-user guides (`docs/user-guide/`) | per-capability | DOCUMENTATION | must be paired with `DOC-VERIFY` (not yet distinct) |
| `REL-RULES` | RELEASE/EVIDENCE | ACTIVE | economy | Rules deploy parity/live match | per-Rules-change | RELEASE | — |
| `GOV-DRIFT` | GOVERNANCE | DEFINED | standard | Architecture/authority drift | inline | ARCHITECTURE / AUTHORITY | not yet a distinct activated agent (Pilot A/B) |
| `SEC-ACCESS` | SECURITY | DEFINED | standard | Access/data-exposure | inline | AUTHORITY/SECURITY | activate on authority/Rules changes |
| `DATA-ID` | DATA | DEFINED | economy/standard | Canonical identity (`partId`≠`sku`), convergence | inline | DATA | activate on domain/identity changes |
| `J-SERVICE-INV` | JOURNEY | DEFINED | standard | Service↔Inventory handoff | persona-review Finding A | BUSINESS PROCESS | needs mature sandbox fixtures (Pilot C) |
| `A11Y` | ACCESSIBILITY | DEFINED | economy | Interaction/accessibility | inline | ACCESSIBILITY | shell a11y strong (R2); product surfaces unmeasured |
| `RESP-QA` | ACCESSIBILITY/UX | DEFINED | economy | Responsive recomposition | inline | RESPONSIVE | — |
| `DOC-VERIFY` | DOC-VERIFICATION | DEFINED | economy | Docs-vs-pinned-build check | inline | DOCUMENTATION | **critical gap**: `DOC-WRITE` currently self-unverified |

## Coverage blind spots (priority)

1. **Journey coverage ≈ zero.** No activated cross-domain journey agent; Service↔Inventory seam is known
   broken (Finding A) but only persona-observed. → `J-SERVICE-INV`, Pilot C after fixtures.
2. **Documentation verification gap.** `DOC-WRITE` output is not independently verified against a pinned
   build (framework §9 forbids self-certification). → activate `DOC-VERIFY`.
3. **Business-process regression corpus absent.** Real persona defects (R1–R2) are not yet durable
   regressions. → seed corpus from persona-review findings as they are remediated.
4. **Management/Owner persona unresolved** (Finding D) — deliberately not built; monitor.
5. **Materials persona blocked** by #226/R-1 access gap — coverage cannot complete until resolved.
6. **Journey/exception dimensions thin** — most existing evidence is normal-path persona missions; need
   denied/unavailable/degraded/partial-completion/ambiguous-identity/multi-equipment scenarios (framework §5).

## Overlap notes (dedupe by lane, framework §6)

- `Q-LEGIBLE` (legibility) vs `Q-CODE` (correctness) vs `UX-COMPOSE` (aesthetics) — distinct lenses; a shared
  surface produces **one finding + corroboration**, not three.
- Persona EXPERIENCE FAIL + `UX-COMPOSE` finding on the same screen → one EXPERIENCE-lane finding.
- `DOC-WRITE` and `DOC-VERIFY` are intentionally separate (no self-certification).

## Changelog
- **v1 (2026-08-07)** — Register created from the existing agent inventory + persona-shell review Rounds 1–2
  evidence base. Seeded 18 agents (ACTIVE + DEFINED gaps) with agentId/family/maturity/default tier/coverage/
  remediation lane/gaps. Blind spots and overlaps recorded; no agent pre-built beyond current use.
