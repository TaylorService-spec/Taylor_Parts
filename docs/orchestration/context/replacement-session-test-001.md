# C-7 Replacement-Session Acceptance Test — LIVE run 001 (PASS)

Durable evidence for C-7 TEST A (normal continuation): can a brand-new worker, with **no prior chat
history**, continue governed work from a durable context package alone? **Result: PASS.**

## Setup (governed)

- **Package source:** `context/build-package.mjs` generated a reproducible context package from the
  committed `context/context-map.json` for scope `orchestration` (assignment `C7-REPLACEMENT-TEST-001`).
- **Review source (DEFAULT REVIEW SOURCE):** a FRESH isolated checkout pinned to `origin/main`
  @ `9a68b49` (#753) — not an Owner working dir. Review provenance = CURRENT.
- **Cold worker:** a subagent given ONLY the package (role · scope · governing authority · L1 required
  + L2 on-demand refs with paths · boundaries · provenance) + the assignment. No conversation history,
  no explanation of prior work.

## Assignment + result

1. *How is a COMPLETED-but-unconsumed agent result prevented from causing a FALSE terminal checkpoint?*
   → **Correct.** Cited `resultConsumption.mjs` (`partitionAwaiting` → `interpretationWorkItems` →
   `selectNextWorkIncludingResults`) feeding `selectNextWork.mjs` as READY items before the terminal
   CHECKPOINT/ROADMAP_COMPLETE branches. Named the §23 mechanism precisely.
2. *What is the durable freshness authority for the Owner Control Center envelope + its states?*
   → **Correct.** Cited `controlCenterContract.mjs` `freshnessState` + `FRESHNESS_STATES` = CURRENT /
   STALE / UNKNOWN / INCOMPATIBLE / NOT_AUTHORIZED, incl. the `authorized:false` precedence rule.

## What the test proves (study §12)

- **Continuity from durable state alone:** the worker continued correctly with **no prior chat** and
  **no Owner explanation** — the C-7 objective ("chats can disappear without institutional memory
  disappearing") demonstrated live.
- **Minimum correct context (C6 negative retrieval):** it retrieved 3 of 5 on-demand refs and
  **deliberately skipped** `review-provenance` + `work-lifecycle` as out of scope — it did not flood
  context. Measured both dimensions: nothing missing, nothing unnecessary.
- **No guessing (C8):** sufficiency held; no `EVIDENCE_REQUIRED`, because the package's L1 authorities
  + the right on-demand refs covered the assignment.
- **Reproducible (C7):** the package recorded `mapVersion 1.0.0` + `sourceCommit 9a68b49` — we can say
  exactly what the worker knew.

## Next (future slices)

- TEST B **live** (adversarial corpus with superseded/unrelated material) as a dispatched cold-worker run.
- Wire `contextPackageFor()` into the standard agent-dispatch path so every routed worker is handed a
  reproducible package instead of ad-hoc prompt context.
- Populate more domains + colocated front-matter + map generation (C2); usage-based Context Health (C5).
