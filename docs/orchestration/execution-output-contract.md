# The execution output contract — closing the gate↔worker disconnect

**Status:** implemented. **Scope:** repo-only, EOS orchestration. No authority, capability, or Rules change.

## The defect

EOS could do the work and still record it as failed.

`classifyCompletion` (`lib/completionSemantics.mjs`) will only return `COMPLETE` when the worker's
structured `evidence.receipts` covers the task's `requiredExecutionReceipts`. For any implementation
task that contract is `["tests"]`.

Nothing ever told the worker that.

`buildClaudeInvocation` (`lib/wakeSupervisor.mjs`) built the prompt from the C-7 context package and
nothing else. The worker was handed the work, the tool envelope, and a turn ceiling — never the shape
of the evidence its completion would be judged on. The gate demanded a receipt the worker was never
asked to produce.

The result was a silent, structural cap on throughput. A run only satisfied the gate when the issue
body *happened* to spell out "return receipts", so completion depended on issue prose rather than on
whether the work was actually done.

### Observed impact

In the execution pass of 2026-08-16, five authorized items ran. One completed. Four landed at
`BLOCKED_EXECUTION`, all with the identical blocker:

```
required execution receipts missing: tests
```

| Item | Outcome |
| --- | --- |
| `EOS-ISSUE-1062` | COMPLETE — its issue body was hand-written with an explicit "Return as receipts:" line |
| `EOS-ISSUE-842` | BLOCKED_EXECUTION — *had already produced two PRs containing tests* |
| `EOS-ISSUE-864` | BLOCKED_EXECUTION |
| `EOS-ISSUE-868` | BLOCKED_EXECUTION |
| `EOS-ISSUE-871` | BLOCKED_EXECUTION |

`842` is the clearest evidence: the work was genuinely done and the tests genuinely existed. The item
still blocked, because the receipt was never requested.

## The fix

`buildExecutionOutputContract(contract)` — a pure function that renders the contract into a
deterministic instruction block naming every required receipt and the exact `evidence` JSON shape the
gate reads. `buildClaudeInvocation` **appends** it to the C-7 package; the package remains the
authority on the work itself.

The contract is derived **once**, in `runIntakeExecution`, *before* the wake:

```js
const execContract = deriveEffectiveContract({ requested, resolvedProfile: profileDecision.profile });
executeWake({ ..., executionProfile: profileDecision.profile, executionContract: execContract });
// …the SAME object is what classifyCompletion judges the returned evidence against.
```

Deriving it once is the point. When the worker's instructions and the gate's expectations came from
separate places, they diverged silently and correct work blocked.

## What this deliberately does not do

- **It grants nothing.** The capability envelope still comes solely from the resolved execution
  profile. Guardrail argv is byte-identical with and without a contract (asserted by test).
- **It does not weaken the gate.** `classifyCompletion` still independently validates every receipt
  after the run. A fabricated receipt is a reporting defect, not an authority escalation.
- **It does not coach dishonesty.** The block instructs the worker to list a receipt *only* after
  actually performing it, to leave `artifacts` empty and say why when it could not produce one, and to
  set `toolPermissionBlocked` when a permission was unavailable. A truthfully-blocked run remains the
  correct outcome — `AWAITING_ARTIFACTIZATION` and `BLOCKED_EXECUTION` are honest terminal states.
- **It changes nothing for tasks that require nothing.** A `READ_ONLY_ANALYSIS` contract renders an
  empty string and the prompt is byte-identical to prior behavior (asserted by test).

## Verification

- `wakeSupervisor.test.mjs` — contract rendering, honesty language, malformed-input filtering,
  append-not-replace, and guardrail invariance.
- `intakeExecute.test.mjs` — the contract reaches the real spawned argv through the production path,
  the C-7 package survives alongside it, and the contract handed to the worker is the same one the
  gate judges.
- **Mutation-checked.** Removing `executionContract: execContract` from the wiring fails 2 tests, so
  the wiring is proven non-inert rather than merely present.

## CI

`wakeSupervisor.*` and `wakeExecute.*` were in no workflow path filter and no test command — changes
to them were CI-uncovered. Both are now added to `.github/workflows/eos-intake-ingest.yml`, in the
trigger paths *and* in the `node --test` invocation.

---

# Part 2 — the receiving end (the half that actually unblocked it)

Telling the worker what to emit was necessary but **not sufficient**. Nothing parsed it back.

`executeWake` returns the worker's output as `result: parsed.result` — a **string** (the `claude -p`
envelope's text). `runIntakeExecution` then tested `typeof wake.result === "object"` before reading
`.evidence`. That condition can never be true for a string, so `workerEvidence` was **always `{}`**.

Consequence: **no worker could ever complete a task that required receipts.** Proven by feeding the
real path a worker emitting a perfect evidence block and still getting `BLOCKED_EXECUTION`.

That also explains the long-standing oddity where `EOS-ISSUE-1062` completed while `EOS-ISSUE-842`
blocked on an identical grant: completion was only ever reachable on paths that required nothing.
EOS could finish work it was not really doing, and could not finish work it was.

## The fix

`lib/workerEvidence.mjs` — `extractWorkerEvidence(text)`, mirroring `findingSchema.extractFindings`
rather than adding a second mechanism: one fenced block with a dedicated `eos-evidence` tag, total,
fail-closed, with a `found` flag separating a trustworthy extraction from an extraction failure.

The dedicated tag matters: a worker quoting an example JSON fence in its prose can never be mistaken
for its real evidence.

`executeWake` now parses it and passes it as `workerEvidence` alongside the unchanged string `result`
(whose consumers hash it as durable content). `runIntakeExecution` prefers it **only when a block was
actually found**, so an injected already-structured result still works.

## Verified behavior

| Worker behavior | Outcome |
| --- | --- |
| honest, with an eos-evidence block | COMPLETE |
| silent (no block) | BLOCKED_EXECUTION |
| malformed block | BLOCKED_EXECUTION |
| prose-quoted json fence | BLOCKED_EXECUTION |
| block claiming no tests receipt | BLOCKED_EXECUTION |

Extraction can only ever ADD provable evidence. A failed extraction yields empty evidence, which the
gate treats exactly as it treats a silent worker — so this can never loosen the gate.
