# EOS Runtime Recovery — consolidated repair

One coherent change to the EOS execution foundation so we stop discovering one runtime blocker per retry
(#834 / #835 / #836 / #837). Three coupled defects shared a single root cause: **EOS treated a clean Claude
process exit as COMPLETE**, on top of **a single hard-coded 40-turn ceiling** and **one broad tool allowlist**.

## What changed

### 1. Bounded turn policy (replaces the hard-coded 40)
- `executionProfiles.mjs` defines finite, differentiated task-class ceilings: `READ_ONLY_ANALYSIS ≤ 40`,
  `READ_ONLY_VERIFY ≤ 60`, `PATCH_PRODUCER ≤ 80`, `GOVERNED_INTEGRATION ≤ 100` (explicit bounded policy).
- The **default/fallback** wake runs `READ_ONLY_ANALYSIS` (40). A higher ceiling applies only under a higher
  governed profile (see §2a). The configured ceiling + profile are recorded in the invocation telemetry
  (`turnCeiling`, `profile`).
- Max-turn exhaustion **fails closed**: `wakeExecute` detects the `error_max_turns` subtype and returns
  `MAX_TURNS_EXHAUSTED` (never a completion); the completion gate maps it to `RETURN_FOR_CORRECTION`.

### 2. Scoped execution capability profiles (replaces broad Bash)
Four explicit profiles, each a self-contained authority envelope. Invariants are enforced **in code** at
construction (`assertProfileInvariants`), not by convention:
- `permissionMode` is always `dontAsk` — **bypassPermissions is never expressible**.
- Bash is always an explicit command allowlist — **unrestricted `Bash`/`Bash(*)` is rejected**.
- **No profile** carries merge / deploy / credential authority.
- `READ_ONLY_VERIFY` supports the required test/build/lint + git-read commands (no Edit/Write).
- `PATCH_PRODUCER` supports isolated-worktree patch production + tests + diff/hash, but **not** push / PR /
  merge / deploy / credential / authorization.
- `GOVERNED_INTEGRATION` is a **separate** profile (branch push + PR create), still never merge/deploy.

### 2a. Governed, least-privilege profile selection (review correction)
The profile a wake runs under is **selected by governance, never self-declared** (`resolveExecutionProfile`):
- **Default/fallback is always `READ_ONLY_ANALYSIS`** — ordinary/analysis wakes never inherit write/patch authority.
- **Two keys, never one:** the *request* is the intake execution contract's `taskClass` (worker/request-authored
  — it can only ever *request*); the *grant* is the AUTHORIZED intake's `authority.authorizedExecutionProfile`
  (set by the governed authorization process). A profile above the default is granted **only** when the governed
  authorization permits at least the requested rank.
- A request/worker **cannot self-escalate**: `taskClass` alone never raises privilege.
- An unauthorized or unknown-named escalation **fails closed** to `READ_ONLY_ANALYSIS`.
- `READ_ONLY_VERIFY` is granted only for authorized verification; `PATCH_PRODUCER` only for authorized
  implementation/patch work; `GOVERNED_INTEGRATION` is **never auto-selected** — it must be *both* requested and
  explicitly authorized.

### 3. Completion-semantic gate (provider success ≠ COMPLETE)
`completionSemantics.mjs` derives the terminal status from **structured evidence**, not the worker's word:
requested criteria, execution receipts, test/build/lint evidence, expected artifact class, produced durable
artifacts, verifier result, and runtime termination. It is **fail-closed** — missing/uncertain evidence never
yields COMPLETE — and distinguishes `COMPLETE`, `BLOCKED_EXECUTION`, `AWAITING_ARTIFACTIZATION`,
`RETURN_FOR_CORRECTION`, `OWNER_ACTION_REQUIRED`, and `ESCALATE`. Worker free-text may corroborate but never
classifies. Wired into `runIntakeExecution`; two new durable statuses added (`BLOCKED_EXECUTION`,
`AWAITING_ARTIFACTIZATION`).

### 4. Encoded regressions
- **#834** — execution capability/receipts unavailable ⇒ `BLOCKED_EXECUTION`, never COMPLETE.
- **#835** — implementation exists but the required governed patch/PR is absent ⇒ `AWAITING_ARTIFACTIZATION`,
  never COMPLETE.
- **#836/#837** — over the configured (now bounded) turn ceiling ⇒ fail closed (`RETURN_FOR_CORRECTION`); a
  long-but-normal run inside the bound is judged on evidence, no longer killed by the legacy 40.
- **Positive** — all criteria + evidence + verifier satisfied ⇒ COMPLETE.

Covered by pure unit tests (`completionSemantics.test.mjs`, `executionProfiles.test.mjs`) and an end-to-end
runtime test through `runIntakeExecution` (`intakeCompletionGate.test.mjs`).

## Preserved governance (unchanged)
Gateway, Verifier (`verifierAgent.mjs`), the #820 max-two-correction behavior, Agent Manager, Claude routing
boundaries, Cortex `READ_ONLY_PILOT` (`cortexProviderAdapter.mjs`), integration authority, cost/capacity
semantics (`costCapacity.mjs`), and provider isolation are all untouched by this change.

## Documented follow-ups (bounded scope of this PR)
- **Worker structured-evidence contract.** The gate reads `result.evidence` (`receipts`, `artifacts`,
  `executionCapable`, `verifier`) when the worker emits it; until the worker is updated to emit it, an
  implementation/receipt-requiring task **fails closed** (BLOCKED_EXECUTION / AWAITING_ARTIFACTIZATION) rather
  than false-COMPLETE. Emitting that block is the paired next step.
- **PATCH_PRODUCER activation.** The runtime still produces only a content-addressed `ANALYSIS_REPORT`; real
  PATCH / PULL_REQUEST production (isolated worktree) is the separately-authorized next capability, after which
  implementation tasks can reach COMPLETE.
- **GOVERNED_INTEGRATION differentiated limit** is defined (100) but its live wiring is future work.

`Register ≠ grant · Export ≠ deploy · Merge ≠ live.` This PR is repo-safe and draft-only.
