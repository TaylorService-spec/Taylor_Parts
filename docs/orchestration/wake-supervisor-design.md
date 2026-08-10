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
