# Owner Roadmap Projection — contract

**Status: repo-safe read-only projection (Tier-1).** Lets the Owner inspect EOS roadmap progress in detail
directly from durable repository-backed state — **without reconstructing status from chat.** Phase 2 of the
[Continuous Workstream Orchestrator](./continuous-workstream-orchestrator.md); reuses the same durable source
of truth. **No dashboard, no database, no UI, no invented percentages** — a pure projection first; a polished
UI can come later if this proves useful.

## 1. Single source of truth

The structured [`lib/roadmapModel.mjs`](./lib/roadmapModel.mjs) is the **durable machine-readable roadmap
state**. Everything else is a *projection* of it, never a competing roadmap:

- the 8 read-only views (§4) are pure functions of the model;
- the committed snapshots in [`roadmap/`](./roadmap/) are rendered from the model;
- the schedulability [`execution-backlog.md`](./execution-backlog.md) and any chat checkpoint are also
  projections of the same state.

If the model and a cited repository artifact (a PR, a Rules block, a capability's `active` flag) disagree,
**the repository wins** and the model is corrected — same discipline as `SYSTEM_AUTHORITIES.md`.

## 2. Hierarchy

```
EOS
  └─ Domain / Program
       └─ Capability
            └─ Milestone
                 └─ Work Item
                      └─ Evidence
```

Every node exposes the fields below **where available** (absent ⇒ omitted / `UNKNOWN`, never guessed).

## 3. Fields & the distinctions they preserve

Per-node fields: `status` · `workstreamOwner` · `dependencies` · `blockedReason` · `routedTo` ·
`ownerDecision` · `protectedBoundary` · `prEvidence` · `tests` / `verification` · `lastVerifiedRepoState`.

The projection keeps these **orthogonal** dimensions as *separate fields* so they can never collapse into a
single misleading "% done":

| Dimension | Field | Values |
|---|---|---|
| Is the code written? | `implementationState` | `IMPLEMENTED` · `PARTIAL` · `NONE` |
| Is the capability turned on? | `activationState` | `ACTIVATED` · `INERT` (registered `active:false` / deny-all) · `NOT_APPLICABLE` |
| Is the backend done? | `backendState` | `COMPLETE` · `PARTIAL` · `NONE` · `NOT_APPLICABLE` |
| Can a user operate it? | `userOperable` | `true` · `false` · `NOT_APPLICABLE` |
| Is the UX built? | `uxState` | `COMPLETE` · `PARTIAL` · `NONE` · `NOT_APPLICABLE` |
| Is it live? | `deployState` | `DEPLOYED` · `NOT_DEPLOYED` · `NOT_APPLICABLE` |

Enforced distinctions (each is a *pair of fields*, never one):

- **IMPLEMENTED ≠ ACTIVATED** — `implementationState:IMPLEMENTED` may coexist with `activationState:INERT`.
- **MERGED ≠ DEPLOYED** — a merged `prEvidence` entry never implies `deployState:DEPLOYED`.
- **BACKEND COMPLETE ≠ USER-OPERABLE** — `backendState:COMPLETE` may coexist with `userOperable:false`.
- **UX COMPLETE ≠ BACKEND ACTIVE** — `uxState:COMPLETE` says nothing about `activationState`.
- **PERSONA FINDING ≠ PRODUCT DECISION** — persona findings are `Evidence{kind:"PERSONA_FINDING"}`; they
  never set `status` or `ownerDecision`.

## 4. Views (pure projections)

All eight are pure functions `model → view data`; the generator renders them to markdown.

| View | Contents |
|---|---|
| **Executive Roadmap** | Domain/Program × Capability, one compact line each: status + the six dimension fields + milestone count. |
| **Detailed Roadmap** | Full hierarchy down to Work Item + Evidence, all fields. |
| **Active Work** | Capabilities/items in `RUNNING` or `READY`. |
| **Blocked / Dependencies** | `BLOCKED_DEPENDENCY` items + `blockedReason` + `dependencies` + `routedTo`. |
| **Owner Decisions** | `OWNER_DECISION` items + the decision text. |
| **Protected / Awaiting Operator** | `PROTECTED_ACTION` items + `protectedBoundary`. |
| **Design execution board** | Design-owned items as a `[x]/[>]/[!]/[P]/[B]/[-]` board. |
| **UX execution board** | UX-owned items as the same board. |

## 5. Progress numbers (constrained)

**No invented percentages.** The only numeric progress permitted is a **milestone count** — `X of Y
milestones complete` — and only where a capability enumerates explicit milestones each carrying
`completionCriteria`. A capability with no explicit milestones shows its status/dimension fields, never a
number. There is no rollup percentage at the domain or EOS level.

## 6. What this is not

Not a dashboard, scheduler, database, or event bus. Not a second roadmap. Not a source of authority — it
*reflects* authority recorded in code, Rules, PRs, and `DECISIONS.md`. Regeneration is a pure, read-only
step; the committed snapshots are convenience renderings of the model at a stated `lastVerifiedRepoState`.
