# C-7 Session Re-Anchor (after compaction)

**Problem.** When a long Claude session is compacted/summarized, conversational detail is lost and
what remains is a *compressed* memory. That memory is a **HINT**, never an **AUTHORITY**. Without a
governed path, a compacted session tends to either demand a giant recap from the Owner or reconstruct
the project by archaeology (rereading `CLAUDE_CONTEXT.md`, DECISIONS, git history) — the exact cost
C-7 exists to prevent.

**Principle.**

> remembered/compressed conversation = **HINT** · durable EOS repository state = **AUTHORITY**.
> Any conflict resolves in favor of the applicable durable authority and is surfaced as **drift**.

Re-anchor **reuses the cold-start architecture** — same current-state pointer, context map,
authority-first retrieval, source provenance, context package, selector interpretation, assignment
lifecycle. It introduces **no second knowledge store and no competing context mechanism**. It is a
mode of the existing driver.

## Command

```bash
# Recover current durable truth and report (RE-ANCHOR ONLY):
node docs/orchestration/context/cold-start.mjs --scope orchestration --reanchor

# Recover, then continue ONLY work the durable selector says is actionable (RE-ANCHOR AND CONTINUE):
node docs/orchestration/context/cold-start.mjs --scope orchestration --reanchor --continue

# Optionally pass the compressed session's claims for drift detection (all fields optional):
node docs/orchestration/context/cold-start.mjs --scope orchestration --reanchor --remembered remembered.json
```

`remembered.json` shape (only what the session actually recalls; anything omitted is simply not
compared — never guessed):

```json
{
  "sourceCommit": "…",
  "selectorState": "RUN",
  "hasReadyWork": true,
  "activeAssignmentIds": ["STD-DISPATCH-042"],
  "openPrNumbers": [900],
  "activeDecisionIds": ["D-legacy-model-routing"]
}
```

## What it answers (durable pointers/refs, not narrative dumps)

| Question | Source |
|---|---|
| WHERE AM I? | `provenance.sourceCommit` + `freshness` + domain |
| WHAT AM I DOING? | durable `activeAssignmentIds` (from the RUNNING digest), else "none — selector <state>" |
| WHAT CHANGED / IS CURRENT? | `selectorState` + `terminalCheckpoint` + the drift list |
| WHAT GOVERNS THIS WORK? | package `governingAuthority` + `applicableDecisionRefs` (current, in-scope) + authority-first gate |
| WHAT AM I AUTHORIZED TO DO? | repo-safe default (AGENTS.md) + `DelegationCharter §8.3`; **`reanchorGrantsAuthority: false`** |
| WHAT NEEDS THE OWNER? | `ownerGateIds` |
| WHAT SHOULD HAPPEN NEXT? | `selectorHint` + the continuation decision |

## Drift detection — `SESSION_CONTEXT_DRIFT`

Pure, deterministic, offline. Compares only remembered claims that can be checked **safely** against
durable facts the driver already holds; the whole pre-compaction transcript is **not** an input:

| Drift kind | Remembered | Durable check |
|---|---|---|
| `SOURCE_ADVANCED` | a commit | `provenance.sourceCommit` moved past it |
| `SELECTOR_DRIFT` | e.g. `RUN` | live `selectorState` (e.g. `CHECKPOINT`) |
| `READY_DRIFT` | had READY work | durable `readyItemIds` empty |
| `ASSIGNMENT_DRIFT` | assignment ACTIVE | not in the durable RUNNING set (COMPLETED/CONSUMED) |
| `PR_STATE_DRIFT` | PR OPEN | `(#NNN)` merge marker in local `origin/main` history |
| `DECISION_SUPERSEDED` | decision active | map marks it `supersededBy` / non-current |

Every conflict carries `resolution: "DURABLE_AUTHORITY_WINS"`. If a remembered claim is not
deterministically comparable, it is **not guessed** — re-anchor simply falls back to durable truth.

## Continuation — re-anchor ≠ authorization

`RE-ANCHOR ONLY` recovers and stops. `RE-ANCHOR AND CONTINUE` continues **only** when the **durable
selector** is actionable (`RUN` / `PREREQUISITE_AVAILABLE`) — never because remembered state said so.
A terminal `CHECKPOINT` / `ROADMAP_COMPLETE` / gate **halts** continuation even with `--continue`.
Re-anchor grants no authority; it only refreshes truth and lets already-authorized work proceed under
normal EOS rules.

## Cost — `REANCHOR_CONTEXT_COST`

Measured separately from `COLD_START_CONTEXT_COST`, and normally **cheaper**: session identity, role,
and the governing authority are already known, so re-anchor orientation is the tiny L0 card + the
current-state pointer only (~1.9k token estimate here vs ~6.8k for a full cold start). The governing
authority's full text is an on-need upper bound (retrieved only to resolve a drift), never
front-loaded. No arbitrary target was set before measuring.

## Acceptance

`docs/orchestration/lib/reanchor-acceptance.test.mjs` encodes a reproducible compaction scenario with
a deliberately stale remembered fact: the session remembers assignment `STD-DISPATCH-042` ACTIVE, but
the durable repo advanced it to CONSUMED and the selector reached CHECKPOINT. On `--reanchor
--continue` the session must report durable state and **must not** resume the assignment. PASS =
Owner restatement 0 · broad archaeology 0 · durable authority wins drift · provenance CURRENT ·
sufficiency SUFFICIENT · unauthorized continuation 0 · duplicate work 0 · retrieval bounded/minimal.

## Owner-facing prompt (after Claude compacts)

The repository mechanism — not this prompt — carries the real context. The prompt is intentionally
tiny:

```
Re-anchor EOS from current governed repository state.
Treat compressed chat context as non-authoritative.
Retrieve current state and applicable authorities through C-7.
Reconcile any drift, then continue already-authorized work under existing governance.
```

Shorthand the Owner can use interchangeably: **"Re-anchor EOS."** (recover + report) or
**"Re-anchor EOS and continue."** (recover, reconcile drift, continue only already-authorized work).
