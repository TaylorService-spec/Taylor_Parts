# Orchestration — context domain index (C-7)

**What's inside:** the EOS orchestration control plane — the durable roadmap authority, the
selector, the Agent Manager + work lifecycle, the Owner cockpit projection, freshness/provenance,
the collaboration/decision/AI-exchange ledgers, and the Owner-friction measure.

**Authorities (do not duplicate):** `roadmapModel.mjs` (roadmap/capability truth) ·
`controlCenterContract.freshnessState` (envelope freshness) · `reviewProvenance.mjs` (review
source freshness) · the durable ledgers under `docs/orchestration/agent-requests/`.

**Current state:** actively built; schema/contracts under `docs/orchestration/lib/`, each with
CI-covered `node:test`. The context map for this domain is [`context-map.json`](context-map.json).

**When to use this domain:** any assignment about orchestration, the roadmap/selector, the Owner
Control Center/cockpit, agent routing/work-pickup, review provenance, or Claude↔ChatGPT collaboration.

**Deeper artifacts (on demand):** each entry in `context-map.json` carries a `retrievalPath`,
`authority`, `freshnessRef`, `lifecycle`, and `level` (L1 required · L2 on-demand · L3 historical).
Retrieve by path with grep — there is **no** index server, **no** vector DB, **no** second authority.

## How this map is used (C-7 design, AI-reviewed)

- **Discovery:** this README + `context-map.json` are the L0/L1 entry point — a cold worker reads
  the map, not prior chat.
- **Precedence:** `contextMap.resolvePrecedence()` answers *"two artifacts apply — which GOVERNS this
  assignment?"* (principle > accepted-decision > model > distilled > finding > evidence; current >
  historical; a deployment/capability-specific rule beats a platform default).
- **Context package:** `contextMap.buildContextPackage()` returns a **reproducible** package
  (map+source commit · selected refs · selection reason · freshness) — references, not document
  copies — and **excludes** superseded/historical/out-of-scope (negative retrieval). No L1 authority
  in scope → `EVIDENCE_REQUIRED` (retrieve-don't-guess; a broad file is not sufficient context).
- **Context Health:** `contextMap.lintContextMap()` flags orphans, conflicting authorities, and
  dangling supersedes; the committed map is CI-validated to lint clean.

**Boundary:** the map holds pointers + governance metadata only. It is not a knowledge store, not a
retrieval engine, and not an authority — the authorities are the files it points at.
