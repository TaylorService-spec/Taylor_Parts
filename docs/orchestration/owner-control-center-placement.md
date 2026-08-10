# Owner Control Center — repository placement + adapter contract

**Owner decision, 2026-08-09.** The reusable Control Center is **not** a Taylor_Parts UI
capability. Recorded here because placement determines what each repository is allowed
to own, and that boundary is easy to erode one convenient commit at a time.

## Who owns what

| `TaylorService-spec/project-keystone` | `TaylorService-spec/Taylor_Parts` |
|---|---|
| reusable browser UI | Taylor durable roadmap / backlog data |
| visual roadmap components | Taylor workstream state |
| Agent Operations view | Taylor agent ledger |
| Owner attention composition | Taylor protected / live evidence |
| reusable orchestration + status presentation contracts | local sanitized network telemetry adapter |

**No second roadmap in keystone.** It renders; it does not hold state and does not
recompute status. The durable machine-readable roadmap remains
[`lib/roadmapModel.mjs`](./lib/roadmapModel.mjs), and the model's own rule stands: if it
and a cited repository artifact disagree, **the repository wins**.

## The seam

```
Taylor_Parts                                   project-keystone
  roadmapModel.mjs      (durable state)
    └─ roadmapProjection.mjs  (8 pure views)
         └─ controlCenterAdapter.mjs  ──envelope──▶  Control Center UI
                                                       renders only
```

[`lib/controlCenterAdapter.mjs`](./lib/controlCenterAdapter.mjs) is the **only** thing
keystone may depend on. It emits a versioned envelope:

- `schemaVersion` — keystone pins a major and `checkPayloadCompatibility()` (exported
  from here, so compatibility is defined once) tells it whether it understands the
  payload. An unrecognised version must be reported, never rendered as if understood.
- `source` — `projectId`, `commit`, `generatedAt`, and the originating module. **A
  Control Center showing stale state is worse than one showing none**, so provenance
  travels with the data rather than being reconstructed by the viewer.
- `preservedDistinctions` — transmitted explicitly so a renderer cannot flatten them.
- `views` — the existing eight Owner views, unmodified.

The adapter **fails closed**: it validates the model first and refuses to emit rather
than hand a renderer a board built on state this repository would itself reject.

## Distinctions the Control Center must never collapse

```
IMPLEMENTED          != ACTIVATED
MERGED               != DEPLOYED
BACKEND_COMPLETE     != USER_OPERABLE
UX_COMPLETE          != BACKEND_ACTIVE
PERSONA_FINDING      != PRODUCT_DECISION
```

No invented completion percentages. If progress is ever expressed numerically it must
derive from explicit milestones already asserted in the model — a test asserts the
adapter contains no percentage arithmetic.

## v1.1 — additional projections (additive, still major 1)

Four genuine Taylor projection gaps are now emitted by the same adapter/envelope (no second
authority, no reach-around; keystone still only renders):

- **`views.uxBoard`** — now populated. The registered UX workstream is projected into the ONE
  roadmap (a `UX / Experience` domain in [`lib/roadmapModel.mjs`](./lib/roadmapModel.mjs)); the
  durable schedulability view of the same items stays in `execution-backlog.md`. UX-3's grain stays
  `OWNER_DECISION`, not flattened (persona evidence ≠ product authority).
- **`agentOperations`** — from the durable [agent-request/result ledger](./agent-requests/) via the
  existing `projectAgentOperations`: remote/browser/network-heavy slots, running/queued,
  WAITING_RESOURCE, deduped/reused, retries, routed results, **Owner relay count**, exposed token
  metrics. **Injected** into the pure adapter (the generator loads the ledger). UNKNOWN when absent.
- **`networkHealth`** — the **sanitized** telemetry summary only (state, freshness, reason codes,
  latency, connection count, logger/supervisor health where supplied). **No raw telemetry, no
  household traffic.** UNKNOWN when no summary is injected.
- **`recentProgress`** — DONE/DELIVERED work items that cite PR evidence, ordered by PR number (a
  trustworthy monotonic sequence). **Not** a git-history dump; items without PR evidence are omitted
  rather than dated from nothing.

`schemaVersion` bumped `1.0.0 → 1.1.0` (additive). A consumer pinned to major 1 still renders it;
absent sections read as `{ available: false, reason }`, honest UNKNOWN rather than fabricated.

## v1 runtime

keystone Control Center code **+** this local adapter **→** a locally served browser
experience. **No GitHub Pages, no cloud deployment, no hosting decision** is required
for v1, and none is implied by this contract.

## Future multi-project, without multi-tenant infrastructure now

`source.projectId` identifies whose data a payload carries. That is the *entire*
provision: another project ships its own adapter emitting the same envelope. **No
tenant registry, no routing layer, no shared service** is created, because none is
needed to render one project today — and building one now would be the multi-tenant
infrastructure this decision explicitly defers.

## Status

- **Taylor_Parts side: contract defined, tested (7 tests), CI-enforced.** Repo-safe,
  read-only, Tier-1.
- **keystone side: not started.** It is a separate repository; building the Control
  Center UI there is its own work item, and this contract is its prerequisite.
