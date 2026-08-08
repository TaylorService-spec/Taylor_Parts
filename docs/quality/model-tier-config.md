# Taylor / EOS — Model Routing Config (v1)

**Owner-ratified runtime model policy** for the agent orchestration adapter. The corporate framework (Project
Keystone → `frameworks/agent-quality-system/` §7a) keeps logical ECONOMY/STANDARD/ADVANCED tiers **for
portability**; Taylor collapses them to the framework's portable two-model roles and maps them to the actual
models the Owner cares about:

| Portable role (framework) | Taylor model | Applies to |
|---------------------------|--------------|------------|
| `PRIMARY_REASONING_MODEL` | **OPUS** | primary **Product/Design** session · primary **UX** session |
| `AGENT_MODEL` | **SONNET** | **all** delegated specialized agents (evidence producers) |

**Taylor does NOT dynamically route among three runtime tiers.** Owner-facing reports say **OPUS** / **SONNET**
(the real choices), not the abstract tier labels.

## Runtime capability (actual, not assumed)

Determined from the `Agent` tool this runtime exposes:
- Sub-agent model is **selectable per agent and per run** (`model` ∈ `haiku | sonnet | opus | fable`; overrides
  the agent definition; otherwise inherits the parent/session model).
- **Exact per-agent token/cost metering is NOT exposed** to the orchestrator through the Agent tool. Per the
  framework's token-honesty rule, cost is reported via **proxies** (model, budget class, agent count, scenario
  count, retry count, concurrency), never fabricated exact numbers.

## Who runs on which model

**OPUS (`PRIMARY_REASONING_MODEL`) — parent sessions only:**
- **Product/Design** — architecture, product decisions, business-process interpretation, cross-domain
  synthesis, governance reconciliation, material implementation reasoning, agent orchestration, finding
  synthesis, remediation decisions.
- **UX primary** — experience strategy, IA, workflow usability, composition direction, persona synthesis,
  systemic UX conclusions. (A `UX-COMPOSE` *specialist agent* is SONNET; it is **not** equivalent to the UX
  primary Opus session.)

**SONNET (`AGENT_MODEL`) — all delegated specialized agents:**
- Persona: `P-DISPATCH` `P-TECH` `P-WAREHOUSE` `P-ADMIN` `P-SALES-NA` `P-SALES-RETAIL` `P-SALES-MGR`
  `P-ACCOUNTING` `P-AR` `P-EXEC`
- Journey: `J-ORDER2CASH` `J-SERVICE` `J-PARTS` `J-EQUIPMENT` `J-LOANER` `J-SERVICE-INV`
- Governance/Security: `GOV-DRIFT` `GOV-SEC` `GOV-RULES`
- Quality: `Q-REGRESSION` `Q-DATA` `Q-BUILD` `Q-RELEASE` `Q-CODE`
- Experience specialists: `UX-COMPOSE` (as delegated reviewer) `UX-A11Y` `UX-RESPONSIVE`
- Documentation: `DOC-WRITE` `DOC-VERIFY`

## Governance reviewers — distinct IDs (do not over-merge)

- **`GOV-DRIFT`** — Governance / Authority Drift Reviewer (GOVERNANCE). Detects implementation that introduces
  or implies authority not supported by canonical repository/governance evidence: invented capability IDs or
  permission-like strings, direct client writes where trusted authority is required, duplicate canonical
  authorities, client-side authorization decisions, new role checks bypassing governed access, new collections
  implying competing authority, duplicate status/readiness semantics, unauthorized identity mappings, Rules/
  command divergence, repo mechanics contradicting ADRs/Decisions. **Canonical ID — retires the former
  `GOV-AUTH` alias.**
- **`GOV-SEC`** — security exposure / authz / secret handling (SECURITY).
- **`GOV-RULES`** — Firestore Rules-specific governance and regression concerns.

They may corroborate one finding; they never create duplicate remediation streams.

## Escalation (no self-promotion)

A SONNET agent may **not** switch itself to OPUS. On ambiguity / architecture conflict / governance conflict /
contradictory evidence / material business question / uncertain remediation, it returns **`ESCALATION
REQUIRED`** with compact evidence; the **parent OPUS** Product/Design or UX session resolves it — the mission
is **not** restarted on OPUS, only the unresolved question is escalated. Structure is strictly `OWNER →
PRODUCT/DESIGN or UX (OPUS) → SPECIALIZED AGENTS (SONNET)`; agents do not spawn agents.

## Budget still applies (separate concern)

Model choice ≠ mission budget. Budget classes `TINY/SMALL/MEDIUM/LARGE`, Owner modes `CONSERVATIVE/NORMAL/
DEEP`, concurrency limits (max 3, up to 5), ~20% reserve, scenario limits, finding dedup, one remediation
owner, one ordinary retry, unchanged-state rerun prohibition, and loop detection all continue unchanged
(framework §7).
