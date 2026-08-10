# C-7 Cold-Start Context Efficiency & Correctness

**Status: repo-safe implementation complete + unit-tested; awaiting an independent fresh-session
acceptance test (below) before success is claimed.** This closes the "cold-start-cost / current-state
determinism" finding from the replacement-session test: a fresh session reconstructed EOS correctly
but consumed ≈121k tokens doing broad repository archaeology first.

Reconciled against `origin/main` @ `cdbd7a1` (the C-7 build through #760). Navigation/retrieval layer
only — **no** second knowledge store, **no** vector DB/embeddings/RAG, **no** second authority.

---

## 1. Trace — why a fresh worker did archaeology (SEARCH-FIRST)

The C-7 **package generator** already existed (`build-package.mjs` over `context-map.json`), and the
subagent replacement-test (handed a pre-built package) passed cleanly. But a **genuinely fresh
session** — one that boots at SessionStart with no package in hand — had no deterministic path to
that generator. The SessionStart hook pointed only at generic governance
(`CLAUDE_CONTEXT.md`≈25k tokens, `DelegationCharter`, `SPRINT_STATUS`, `SYSTEM_AUTHORITIES`), none of
which say "the orchestration control plane exists, here is your one bootstrap command." So the worker
rediscovered state by reading broadly and walking git history.

### Retrieval classification (each source yesterday's worker inspected)

| Retrieval | Class | Why |
|---|---|---|
| stale local snapshots | **STALE/MISLEADING** | never a source; provenance must pin `origin/main` (a fresh checkout), never an Owner working dir |
| git history (broad) | **ON_DEMAND_L2** | needed only for a specific provenance question, not to establish state |
| `DECISIONS.md` (broad read) | **UNNECESSARY** | the durable ledger; targeted L2/L3 only, never a cover-to-cover state read |
| GitHub state (broad) | **ON_DEMAND_L2** | PR/issue status only when acting on that PR/issue |
| execution backlog | **REQUIRED_L1, wrong granularity** | it IS the current-state authority, but ≈4k tokens of narrative; needed a distilled machine pointer |
| context registry (`context-map.json`) | **REQUIRED_L1** | correct — but the worker had to *find* it first |
| selector artifacts | **REQUIRED_L1 (as pointer)** | the READY/CHECKPOINT truth; needed as a pointer, not a full read |
| persistent context / memory | **REQUIRED_L0** | the operating contract — but there was no tiny L0 card, only the 25k `CLAUDE_CONTEXT.md` |
| multiple governance docs (broad) | **mostly UNNECESSARY** | only the ONE governing authority for the actual assignment is REQUIRED_L1 |

### Was yesterday's `READY = NONE` conclusion correct?

Reconciled against `origin/main`: **yes, for autonomous selection.** `execution-backlog.md`'s READY
table is empty and the last selection run (2026-08-09) recorded a terminal CHECKPOINT — *"No
authorized READY work is a legitimate terminal state" (Owner)*. The worker reached the right answer;
it just paid ≈121k tokens of archaeology to support it. (A **directed** assignment — like this C-7
task — overrides the terminal state; the current-state pointer says so explicitly.)

## 2. Root cause

**The cold-start entry point was missing, not the retrieval machinery.** Three thin layers between
"fresh session" and "the C-7 package generator" did not exist:

1. a tiny **L0 operating contract** (a bootstrap *sequence*, distinct from the 25k context dump),
2. a tiny **current-state pointer** (distilled, provenanced — vs. re-reading the full backlog + git),
3. a **cold-start driver** that composes them and **routes the worker to its one governing
   authority** instead of "read everything."

## 3. Architecture change (repo-safe, additive)

| Layer | Artifact | Role |
|---|---|---|
| L0 | [`EOS-BOOTSTRAP.md`](EOS-BOOTSTRAP.md) | Stable card: bootstrap sequence + seven questions → authorities (pointers only). Map entry `eos-l0-bootstrap` (level **L0**). |
| Current-state pointer | [`current-state.mjs`](current-state.mjs) → [`current-state.json`](current-state.json) | Generated digest of the execution-backlog authority (READY set, Owner gates, protected actions, active assignments) + source/map provenance + freshness. **Projection, not a second authority** (same pattern as `roadmap/ROADMAP.md` ← `roadmapModel.mjs`). |
| Cold-start contract | [`../lib/coldStart.mjs`](../lib/coldStart.mjs) | Authority-first gate · governed-subjects-outside-scope checklist · `COLD_START_CONTEXT_COST` signal. |
| Driver | [`cold-start.mjs`](cold-start.mjs) | One command composing L0 + pointer + C-7 package + gate + cost. |
| Map | `context-map.json` | +`eos-l0-bootstrap`, +`current-state-pointer`, +`cold-start-contract`, +`model-policy` (the authority the model-routing defect should have retrieved). |
| Hook | `.claude/hooks/session-context.mjs` | One line routing fresh EOS sessions to `cold-start.mjs` — the nudge that replaces archaeology. |

### Authority-first retrieval (defect-class defense)

The model-routing defect (an implementation independently hard-coded Sonnet while `modelPolicy.mjs`
already owned that policy) is now prevented structurally: `modelPolicy.mjs` is a map authority for
scope `model-routing`/`dispatch`, so an assignment declaring that scope gets it in `required`
(gate **SATISFIED**); an assignment that *omits* it sees `model-routing` on the
**governed-subjects-outside-scope** checklist — a visible prompt to widen scope rather than invent a
policy. A governed subject in scope with no authority in-package → **`EVIDENCE_REQUIRED`**
(retrieve-don't-guess).

## 4. Measured before / after (evidence available so far)

`node docs/orchestration/context/cold-start.mjs --scope orchestration` @ `cdbd7a1`:

| Signal | Value |
|---|---|
| governing authority | `orch-operating-model` (1 read) |
| L0 card | 4,811 B |
| current-state pointer | 2,567 B |
| governing authority | 19,834 B |
| **orientation total** | **27,212 B ≈ 6,803 tokens (estimate)** |
| required set (refs, read on need) — upper bound | 3 refs · 75,855 B ≈ 18,964 tokens |
| on-demand (L2) | 9 refs (pulled only as needed) |
| excluded (negative retrieval) | 5 |
| unnecessary / stale retrievals | 0 / 0 — healthy |

**Directional result: ≈6.8k orientation tokens vs. the observed ≈121k baseline — an ~94% reduction**
with correctness preserved (governing authority surfaced, negative retrieval clean, no guessing).
Token figures are **estimates** (bytes ÷ 4); the ≈121k baseline is an observed *session total*, not a
C-7-only measurement — the two are compared **directionally**, not byte-for-byte. The
runtime-true token count is filled only if a host exposes it (`runtimeTokens`, else `null` — never
fabricated). The authoritative before/after is the fresh-session test in §5.

## 5. Fresh-session acceptance test (run in a NEW Claude session — do NOT self-certify)

> **This implementation session must not claim the efficiency/correctness win.** Open a genuinely
> fresh Claude session and give it *only* the bootstrap instruction below.

**Bootstrap instruction to hand the fresh session (verbatim):**

> You are a fresh EOS worker on the Taylor_Parts repo. Do not reconstruct state from memory or chat.
> Run `node docs/orchestration/context/cold-start.mjs --scope orchestration` and read
> `docs/orchestration/context/EOS-BOOTSTRAP.md`. Using only what that surfaces (retrieve L1/L2 refs by
> path as needed), answer: (a) current source commit + freshness; (b) the governing authority for
> orchestration work; (c) the READY set and whether the selector is at a terminal CHECKPOINT;
> (d) the outstanding Owner gates; (e) the next legitimate action; (f) if you were asked to choose a
> dispatch model, which durable authority governs that and is it in your package? Then stop.

**Score against:**

| Measure | Target |
|---|---|
| recovered current state (commit, READY=∅/CHECKPOINT) | correct |
| governing authorities | correct |
| Owner gates | correct (matches `current-state.json.derived.ownerGateIds`) |
| next legitimate action | correct (directed assignment; else terminal CHECKPOINT) |
| model-routing authority named (`modelPolicy.mjs`) without hard-coding | correct |
| unnecessary retrievals · stale retrievals · L2 retrievals | counts (target 0 · 0 · minimal) |
| cold-start context cost | measured/estimated, materially < 121k |
| Owner restatement · prior-chat dependency | 0 · 0 |

## 6. Boundaries honored

Repo-safe only: new docs + generators + tests + map entries + one hook line. No Firebase/Rules/
Functions deploy, no credentials, no paid provisioning, no vector DB/embeddings/RAG, no second
authority. The live Wake pilot is **not** activated by this work.

## 7. Genuine remaining Owner decision

None required to merge this repo-safe layer. The only Owner-gated item is the *separate* live Wake
pilot (already gated), unchanged by this work. Recommend: run the §5 fresh-session test; on a
materially-reduced, correct recovery, treat the cold-start-cost finding as resolved.
