# EOS L0 — Cold-Start Operating Contract

**This is the smallest thing a genuinely fresh EOS session reads first.** It is a stable, tiny
*navigation card* — not a state store and not an authority. It answers *where am I / what governs
me / what is happening now / what may I do / what needs the Owner / what is the next legitimate
action / what more do I need for THIS assignment* by **pointing** at the durable authorities. It
copies no state. When state and this card disagree, the pointed-at authority wins.

> **Do not reconstruct EOS by archaeology.** If you are a fresh session picking up EOS
> orchestration work, run the deterministic bootstrap below. Reading `CLAUDE_CONTEXT.md` end-to-end
> (~25k tokens), the full operating model, DECISIONS, and git history to *rediscover* current state
> is the failure mode this contract exists to prevent (C-7 cold-start-cost finding).

## Deterministic bootstrap sequence

Run one command; it composes the three cheap layers and prints your package + a cost meter:

```bash
node docs/orchestration/context/cold-start.mjs --scope <domain> [--id <assignment>]
```

It performs, in order:

1. **Identify repo + provenance** — the CURRENT source is `origin/main` (a fresh checkout pinned to
   it), never an Owner working dir or a stale local snapshot. `git rev-parse origin/main`.
2. **L0 operating contract** — this card. Points to the durable authorities below.
3. **Current-state pointer** — [`current-state.json`](./current-state.json): source commit · map
   version · control-plane schema pointers · the READY set · open Owner gates · protected-action
   items · active assignments. A **generated pointer with provenance**, not a second authority.
   Stale-guard: if its `generatedFromCommit` ≠ current `origin/main`, regenerate before trusting the
   derived lists (`node docs/orchestration/context/current-state.mjs`).
4. **Determine assignment/domain** — from the directed assignment (its `--scope`), or, absent one,
   the selector's terminal state in the current-state pointer.
5. **C-7 context package** — [`build-package.mjs`](./build-package.mjs) over
   [`context-map.json`](./context-map.json): governing authority + required (L1) + on-demand (L2)
   **refs**, with superseded/out-of-scope **excluded** (negative retrieval) and reproducible
   provenance. No L1 in scope → `EVIDENCE_REQUIRED` (retrieve-don't-guess).
6. **Authority-first check** — before authoring any policy-bearing decision or implementation,
   the governing authority for every governed subject in scope is already in the package's
   `required` set. If a governed subject you are about to touch is **outside** your declared scope,
   widen the scope and re-run — never invent a policy that an existing authority already owns.
7. **Retrieve L1 only; L2 on demand** — open the governing authority. Pull an on-demand ref only
   when the assignment actually needs it. Do not flood context.
8. **Execute / checkpoint / escalate** — reversible repo-safe work proceeds (AGENTS.md default
   autonomy); a genuine boundary stops (Charter §8.3).

## The seven questions → durable authority (pointers only)

| Question | Authority (retrieve on need) |
|---|---|
| Where am I? | `origin/main` @ `current-state.json.provenance.sourceCommit`; this repo, `docs/orchestration/`. |
| What governs me? | Operating mode: [`AGENTS.md`](../../../AGENTS.md) + [`DelegationCharter.md`](../../DelegationCharter.md) §8. EOS run model: [`continuous-workstream-orchestrator.md`](../continuous-workstream-orchestrator.md). |
| What is happening now? | [`current-state.json`](./current-state.json) → the execution-backlog authority [`execution-backlog.md`](../execution-backlog.md). |
| What am I allowed to do? | Repo-safe by default (AGENTS.md); protected boundaries in [`DelegationCharter.md`](../../DelegationCharter.md) §8.3. `Register ≠ grant · Export ≠ deploy · Merge ≠ live.` |
| What needs the Owner? | `current-state.json.derived.ownerGateIds` → the `OWNER_DECISION` + `PROTECTED_ACTION` rows in [`execution-backlog.md`](../execution-backlog.md). |
| Next legitimate action? | The directed assignment; else the selector's next-eligible item ([`selectNextWork.mjs`](../lib/selectNextWork.mjs)). "No authorized READY work" is a legitimate terminal CHECKPOINT — do not manufacture work. |
| What more for THIS assignment? | The C-7 package's `onDemand` refs — retrieved only as the assignment requires them. |

## Boundaries

Repo-safe navigation only. This card holds **pointers**, not knowledge and not authority. No vector
DB, no embeddings, no second knowledge store — retrieval stays `grep` + these paths. Narrative here
is human/governed-authored and deliberately small; the durable truth is the files it points at.
</content>
</invoke>
