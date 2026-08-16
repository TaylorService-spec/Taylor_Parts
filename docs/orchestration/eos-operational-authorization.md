# EOS operational authorization — canonical

**Status: Owner-ratified 2026-08-16 (authorization + addendum). CANONICAL.**
Replaces any chat-only interpretation. Where this conflicts with an earlier document, this wins
and the earlier document should be corrected.

**Objective:** EOS carries authorized engineering work from intake through a durable, verified
result **without continuous Owner supervision** — using available capacity while progress
continues, stopping when it ceases, and checkpointing rather than stranding work.

**Why this exists:** a post-mortem on 2026-08-16 found that EOS was never architecturally
broken. Runner sessions completed real engineering and could not commit it, because the
permission profile was written for *supervised* sessions and applied unchanged to *unattended*
ones. A deterministic permission denial retried five times and hard-failed. Work stranded one
command short of landing. This document removes the class of Owner decision that produced that.

---

## 1. Engineering authority — broad, and not to be re-confirmed

Authorized **without returning to the Owner**: the EOS runner, Agent Manager, child
orchestration, decomposition/consolidation, retries and retry classification,
checkpoint/resume, durable state and write-back, work claims and concurrency, timeout handling,
failure recovery, artifact/hash and result validation, intake handling, EOS documentation and
tests, observability, error reporting, cost/capacity handling, unattended-session
configuration, branch creation, `git add` / `commit` / `checkout`, pushing **non-main**
branches, PR creation, and ordinary repo-safe CI corrections needed for EOS — subject to §3–§5.

**Do not stop for approval merely because fixing EOS requires changing EOS.**

Implementation choices are owned here. Several valid technical approaches is **not** an
escalation trigger (§9).

## 2. Unattended git/GitHub profile

Unattended workers **must** be able to persist completed work. Normal EOS work ends in a
durable branch/PR/result, never an uncommitted working tree.

**Allowed:** `git add` · `commit` · `checkout`/`switch` · create and push **non-main** branches
· create PRs · update their own non-main PR branches · all read operations
(`status`/`diff`/`log`/`fetch`).

**Never:** direct push to `main` · force push · destructive history rewriting ·
`git reset --hard` · production deployment · secret extraction · credential mutation ·
bypassing protected-branch controls.

## 3. Protected control surfaces

### 3.1 The `deny` block is protected

`.claude/settings.json`'s `deny` block — and equivalent permission-deny controls elsewhere — is
a **protected control surface**.

Unattended EOS may add or adjust **`allow`** entries only, and only within operations already
authorized in §2. It may **not** remove, weaken, narrow, bypass, reorder into ineffectiveness,
or otherwise reduce a **`deny`**.

Any deny-block change requires: **isolated branch → dedicated PR → evidence explaining why →
protected review**. **The runner proposing a permission widening may not self-merge it.**

### 3.2 Workflows

Ordinary unattended workers may **not** modify `.github/workflows/**`. Broad `workflows: write`
is **not** to be granted so an agent can rewrite the machinery controlling itself.

EOS **maintenance** work specifically authorized to repair EOS may *prepare* workflow changes
through the governed maintenance path: isolated PR, evidence for why the change is required,
normal protected review. **Never silent self-modification of the running workflow.**

**Do not create a self-escalating runner.**

## 4. Capacity

The **$2 per-run hard stop is removed** as controlling policy. The real constraints are
available hourly/session and weekly subscription capacity.

### 4.1 Owner capacity reserve

**Unattended EOS yields to interactive Owner work.** Interactive/supervised use has priority.

Reserve floor: **25%** of available subscription capacity — where observable, at least 25% of
**weekly** capacity and 25% of the shorter **session** window. EOS may consume the remainder
while useful progress continues.

Where exact provider percentages are not observable, use a conservative estimator that
**fails toward preserving Owner capacity.**

On reaching the floor: **checkpoint → persist completed work → persist remaining state →
suspend → resume when capacity returns.** Not a terminal failure.

Thresholds may be tuned later from measured evidence. **Removing the reserve principle itself
requires a new Owner decision.**

## 5. Stopping: progress, stagnation, and hard ceilings

### 5.1 Progress detection (primary control)

**Counts as progress:** a new verified finding · a disposition change · a test-state change ·
meaningful code change · a commit · a PR created/updated · a blocker identified with new
evidence · a child completed · an artifact or evidence produced · a previously failing
verification advancing · a dependency resolved.

**Does not count:** repeated searches · identical tool calls · retries · log polling · rereading
the same files · restating the same conclusion.

### 5.2 Stagnation → autostop

Detect **combinations** of elapsed time without progress, repeated equivalent actions, repeated
identical failures, unchanged repository state, and unchanged verification state — not one
simplistic timer.

On threshold: stop the run → checkpoint → classify why progress stopped → decide whether a
**materially different** strategy could proceed → retry only if the strategy actually changes →
otherwise return the real blocker.

### 5.3 Hard outer bounds (fail-safe, underneath 5.1/5.2)

Independent ceilings that hold even if stagnation detection is defective:

| Bound | Value |
| --- | --- |
| Wall-clock per unattended **segment** | **90 minutes** |
| Concurrently executing child agents | **10** (fail-safe ceiling) |
| Child executions from one parent before mandatory checkpoint | **20** |

**Hitting a ceiling does not fail the parent mission.** Stop segment → checkpoint →
consolidate evidence → reassess → resume only if another bounded segment has justified work.
A large legitimate mission may span multiple segments.

**Operating concurrency remains `REMOTE_AI = 2`** (`lib/resourceGovernor.mjs`) — Owner-confirmed
2026-08-16. The 10 above is a runaway backstop, not a target; it should never fire. Raising the
*operating* limit is a separate decision, and the platform direction requires ramping
`1 → 3 → 5` on measured value before testing higher.

## 6. Retry policy

**Classify before retrying.**

**Retryable:** transient network/API failure · temporary GitHub failure · emulator startup race
· resource contention · recoverable tool interruption.

**Not retryable without a state change:** explicit permission denial · protected boundary ·
missing Owner authority · invalid command/schema · deterministic test failure with unchanged
code · prohibited workflow write · unavailable credential.

**A deterministic permission denial fails once.** It was retried five times on 2026-08-13,
which wasted minutes and buried the real cause under warnings.

## 7. Self-healing expectation

EOS repairs ordinary failures internally. The Owner should **not** receive *"8/10 succeeded"*,
*"retry this manually"*, *"agent couldn't commit"*, *"budget expired"*, or *"permission denied
five times"* when the system has the authority and information to recover.

An authorized parent mission continues until **(A)** the mission is verified, or **(B)** a
genuine protected/business/authority blocker remains that EOS cannot resolve under this
authorization.

## 8. Protected boundaries — unchanged

Not granted autonomously: production deployment · customer-visible release · secret or
credential disclosure · destructive git history changes · direct push to `main` · weakening
security boundaries · business-policy decisions · financial commitments · external purchases ·
irreversible production data mutation · bypassing Owner/protected governance.

**Engineering authority is broad. Business and production authority remains protected.**

## 9. Escalation standard

Escalate **only** for: business intent · production authority · a protected security boundary ·
irreversible or destructive action · secret/credential authority · a choice with materially
different product or business outcomes.

**Do not escalate an implementation choice merely because several valid approaches exist.**

## 10. Acceptance — prove the system, not the code

Owner authorization, EOS configuration, and the **execution harness** are three separate
layers. **A capability is not usable because configuration says it is allowed.**

Acceptance must prove by **real execution** that an unattended worker **can**: create/switch a
non-main branch · edit authorized files · `git add` · `commit` · push a non-main branch ·
create a PR — and **cannot**: push `main` directly · force push · `reset --hard` · deploy ·
access or extract secrets · modify `.github/workflows/**` as an ordinary worker · weaken the
protected deny block.

Also prove: recovery from a retryable failure · immediate stop on a deterministic permission
failure · checkpoint on capacity exhaustion · resume from checkpoint · autostop of a
deliberately stagnating agent · preservation of completed work through autostop · consolidation
of child results · a truthful final state.

**An authorized operation refused by the harness is an EOS platform defect.**
**A protected operation that succeeds is a security failure.**

**Do not call EOS operational because unit tests pass.**

## 11. The ChatGPT review path

The **ChatGPT app cannot be woken** — it has no inbound webhook; polling is the only mechanism.
The Owner runs it hourly and resets the clock after each handoff. **This is sufficient, because
nothing may block on it.**

- **ChatGPT (app)** — architect and decision partner. Human-paced, Owner-mediated. EOS **never
  waits** on it: review items accumulate in a durable repo queue, and a mission needing review
  **checkpoints and moves to other work** rather than idling.
- **OpenAI API reviewer** — machine-paced and git-triggerable via
  [`reciprocal-gpt-review.yml`](../../.github/workflows/reciprocal-gpt-review.yml), which
  already calls the API and fails closed without `OPENAI_API_KEY`. This is what "git wakes the
  reviewer" actually means. It is `workflow_dispatch`-only today.

**Not enabled without an Owner decision:** the automatic trigger and the API key. API review is
**metered spend** per run, unlike the subscription-covered app.

### 11.1 Trigger cost policy — minimise the cost to fire

Owner direction 2026-08-16: **the cost to initiate a trigger must be as low as possible.** This
is policy, not a preference, and lives here rather than in a chat log.

**Fire only when review actually buys something:**

| Fire | Do not fire |
| --- | --- |
| `firestore.rules` or `firestore.indexes.json` | docs-only changes |
| capability registry / role definitions / grants | test-only changes |
| `functions/src/access/**` and trusted-write paths | dependency bumps, lockfiles |
| `.github/workflows/**` | formatting / comment-only diffs |
| an explicit `needs-gpt-review` label | generated artifacts (e.g. `repo-graph.json`) |

Anything not on the left is **Tier-1 repo work**, which `DelegationCharter.md` §8 already says
proceeds without a review stop. Routing it to a paid reviewer buys nothing and spends money —
that is the same over-routing that produced 463 relayed review verdicts in 32 days.

**Then minimise the cost of each firing:**

1. **One review per head SHA.** Dedupe on the exact commit; a re-push that changes nothing
   material must not re-review. Re-review only on a **material** change — authority, security,
   or behavior — per the `EVIDENCE_REQUIRED` policy.
2. **Send the fact feed, never full context.** The live fact-feed path (#788) is roughly **85%
   smaller** than the legacy full-context send, and token attribution reconciles against it.
   Full-context sends are a defect, not a fallback.
3. **Cheapest adequate model.** `OPENAI_REVIEW_MODEL` is a repo variable precisely so the tier
   is a config decision. Escalate per-run only with a recorded reason.
4. **Fail closed and cheap.** No key ⇒ refuse **before** provider invocation, as the workflow
   already does. A misconfiguration must never become a paid call.
5. **Cap and record.** Every firing records its token cost so the spend is measurable rather
   than inferred. An unmeasured cost cannot be tuned.

**Default posture: label-triggered.** Path-triggering is available but starts **off** — a label
costs one deliberate action and makes every paid review an explicit choice, which is the lowest
possible cost to initiate.

## 12. Handoff protocol

Because the reviewer is polled rather than pushed, a handoff must be **explicit and dated** so
the Owner knows when to reset the hourly clock. A handoff states: what is queued, what decision
is wanted, what is blocked pending it, and what EOS is doing meanwhile — never "waiting."
