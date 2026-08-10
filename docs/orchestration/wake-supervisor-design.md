# EOS Wake Supervisor — design (SEARCH-FIRST) + bounded prototype

Closes the Claude side of the `NO_WAKE_MECHANISM` FUTURE_SEAM with a **token-free** local supervisor
that only invokes Claude when genuinely actionable **and authorized** work exists. Supervised, short,
bounded, **no overnight**, **repo-safe work only**. `READY is never authorization; never cross a
protected boundary.`

## SEARCH-FIRST findings (WAKE-RESEARCH-001, primary-source-cited)

- **Interface:** `claude -p` (headless) with `--output-format json` is the documented way to drive the
  agent loop from a non-TS/Python host; the JSON envelope carries `result`, `session_id`,
  `total_cost_usd`. Uses the existing local subscription login (no API key handling). The Agent SDK is
  an alternative only if the supervisor is rewritten in TS/Python (adds a dependency, no decisive gain
  here). Sources: code.claude.com/docs/en/headless · /cli-reference · /agent-sdk/overview.
- **Guardrails (baked into `DEFAULT_GUARDRAILS`):** `--permission-mode dontAsk` (auto-denies anything
  not pre-approved — **never** `bypassPermissions`/`--dangerously-skip-permissions`, which the docs
  warn "offers no protection against prompt injection or unintended actions"); an `--allowedTools`
  repo-safe allowlist (Read/Grep/Glob/Edit/Write + narrow `Bash(git …)`), **no** network/deploy tool;
  `--max-turns` (fail, don't spin); `--max-budget-usd` hard per-run ceiling (counts subagent spend);
  `--model sonnet`; an **external wall-clock timeout** (no CLI flag) → SIGTERM (exit 143, child tree
  killed). Sources: /permission-modes · /cli-reference · /headless.
- **Execution lease (no DB):** atomic `mkdir` lock-directory + a `{pid,host,startedAt,leaseUntil}`
  record + heartbeat (bump mtime); reclaim a lock whose mtime is stale **and** whose PID is dead on
  this host (pair PID with host identity); `finally { release }` on graceful exit. Prior art:
  proper-lockfile. Single-machine scope only.
- **Token-free readiness gate:** read the durable selector/work-state JSON with plain `fs` and decide
  purely from fields already there — `status === "READY"` **AND** explicit `authorized === true`
  **AND** not `protectedBoundary` **AND** a free REMOTE_AI slot (2/1/1) **AND** network NORMAL **AND**
  budget ok **AND** not a dedup repeat. Only then spend. **No model call to decide whether to call the
  model.**
- **Windows pilot:** an **operator-launched foreground loop** (nothing survives logout, no elevation)
  matches "supervised, no overnight." A user-context, active-hours-only Scheduled Task is a *later*
  option if bounded-unattended is authorized — not now. Install nothing.

## What this slice ships (repo-safe)

- `lib/wakeSupervisor.mjs` — the **pure token-free core**: `assessReadiness(item, ctx)` returns
  `TRIGGER | HOLD | CHECKPOINT` (with the authority≠trigger, protected-boundary, 2/1/1, network,
  budget, overnight, and dedup guards all enforced + unit-proven); `DEFAULT_GUARDRAILS`;
  `buildClaudeInvocation()` (constructs the fully-guardrailed argv; **spawns nothing**; bootstraps the
  worker with a **C-7 context package**, the shared mechanism, never a bespoke bootstrap);
  `nextBackoffMs()`. Records `MANUAL_RUNTIME_TRIGGER` vs `AUTOMATIC_TRIGGER` + trigger mechanism
  (MANUAL / AUTOMATIC / NO_WAKE_MECHANISM / FAILED).
- `context/wake-supervisor.mjs` — the **DRY-RUN runner**: reads work-state, decides, and on TRIGGER
  prints the C-7 package + the exact `claude -p` invocation it *would* run. `--execute` is **refused**
  — live invocation is the supervised pilot step and is intentionally not wired here.

## The supervised pilot (NOT executed autonomously)

Live operation = the operator launches the foreground loop, watches it, and it runs at most one
bounded `claude -p` per actionable+authorized item, within the guardrails, acquiring the lease, with a
wall-clock kill and backoff, logging `total_cost_usd`. This crosses into autonomous execution and is
therefore an **operator-supervised** step, short and bounded, **no overnight** — not something the
prototype does by itself. `READY ≠ authorization`; a protected boundary is never auto-triggered.

## Open questions (for the pilot)

1. Auth mode: subscription OAuth (default `-p`) vs `--bare` + `ANTHROPIC_API_KEY` (reproducible but no
   project `.claude/` context). Lean: default `-p` so the run gets governed project context + skills.
2. The exact `--allowedTools` allowlist for "bounded repo-safe work" (this slice's default is a
   conservative starting set).
3. Where `authorized` + the live 2/1/1 counts are sourced for the work-state JSON the supervisor reads.
4. `claude` version floor for `--max-budget-usd` enforcement + SIGTERM tree-kill semantics — verify
   before the live pilot.

## Guarded live execution (`--execute`) — BUILT + TESTED, not run

The spawn gap is now closed in code (not activated):

- `lib/wakeExecute.mjs` — `executeWake({ item, ctx, contextPackageFn, processRunner, lease, ... })`
  orchestrates ONE guarded run: `assessReadiness` → provenance check (must be CURRENT) → C-7 package
  (insufficient → refuse) → `resolveDispatchModel` (#759) → lease acquire → guardrailed
  `buildClaudeInvocation` → **injected** processRunner → result capture → truthful wake lifecycle →
  lease release. Spawns EXACTLY once on TRIGGER, ZERO on any refusal. Failures captured distinctly
  (SPAWN_FAILURE / TIMEOUT / NONZERO_EXIT / MALFORMED_OUTPUT / MISSING_RESULT / RESULT_PERSIST_FAILURE
  / LEASE_RELEASE_FAILURE / INSUFFICIENT_CONTEXT / PROVENANCE_UNACCEPTABLE / MODEL_RESOLUTION_FAILURE /
  LEASE_UNAVAILABLE) — a failed process is NEVER completed work; a spawn alone never sets
  ACKNOWLEDGED/COMPLETED (ACKNOWLEDGED is not separately observable for a one-shot and is not fabricated).
- `lib/wakeLease.mjs` — atomic-mkdir lease + stale reclaim (expired AND dead-on-this-host; never steals
  a live/other-host lock). fs injected → unit-tested.
- Both are unit-tested with a MOCK process runner + in-memory fs (no real AI): TRIGGER→spawn once ·
  HOLD/protected/overnight/ceiling/network/budget/duplicate-lease/insufficient-context/bad-provenance →
  spawn zero · timeout/error/malformed/missing → failure captured · lease always released · selected
  model = the #759 resolver's · package = the standard-dispatch C-7 package.
- `context/wake-supervisor.mjs` — `--execute` binds the REAL `spawnSync` runner (hard wall-clock kill)
  + the REAL lease, calling `executeWake`. DRY-RUN remains the default. bypassPermissions is NEVER used.

### LIVE WAKE PATH = READY FOR SUPERVISED PILOT

- **Exact launch method (operator, supervised):**
  `node docs/orchestration/context/wake-supervisor.mjs --state <work-state.json> --execute`
  (add `--manual` to record MANUAL_RUNTIME_TRIGGER). Run it in the foreground and watch it; nothing
  survives closing the window. `<work-state.json>` must carry an item that is `READY` **and**
  `authorized:true`, `sourceFreshness:"CURRENT"`, a free 2/1/1 slot, and budget/network ok — otherwise
  it refuses and spawns nothing.
- **Guardrails on the run:** `--permission-mode dontAsk` (auto-deny; never bypass), a repo-safe
  `--allowedTools` allowlist (no network/deploy), `--max-turns 40`, `--max-budget-usd 2`, an external
  wall-clock kill (900s → SIGTERM), model = SONNET (delegated). One bounded run per invocation.
- **Expected Control Center state:** the wake board shows the item move AUTHORIZED → TRIGGERED
  (AUTOMATIC_TRIGGER) → ACTIVE → COMPLETED; the run's evidence (selectedModel, cost, result) lands under
  `%LOCALAPPDATA%/EOS/wake-runs/<id>.json`. On refusal it stays WAITING_FOR_TRIGGER with the reason; on
  failure it shows the distinct failure kind, never COMPLETED.
- **Rollback / stop method:** close the foreground window / Ctrl-C — no service, no autostart, nothing
  overnight. A stuck child is bounded by the wall-clock SIGTERM; the lease is released on exit and any
  stale lock is reclaimed only when expired AND dead. To fully disable, simply don't run `--execute`
  (DRY-RUN is the default). No repository, credential, or deploy state is ever touched.

**Boundary:** the first real `--execute` run is the Owner's explicit runtime activation. This slice
builds and proves the path; it does not run a real Claude worker.
