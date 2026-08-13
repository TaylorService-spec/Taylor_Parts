# Findings register — the audit closed loop

EOS as company controller: **agents find → the verifier (ChatGPT) decides truth + actionability *immediately* at
first disposition → EOS fixes everything it is already authorized to fix → the Owner sees only genuine
decisions.** This register is the durable **memory** of those dispositions so the next audit doesn't re-surface a
decided item. It is *not* the thing that postpones a decision until a future audit re-finds the item.

## Disposition happens first, not later
When a finding is first raised, the verifier decides **now-change vs defer from the very beginning** — defer is
never a default, it's a *validated* outcome of the initial actionability call, and any deferral rationale is
re-validated at that moment. Outcomes become register statuses:

| status | meaning at disposition |
|---|---|
| `CONFIRMED_OPEN` | real and actionable now — goes to the fix path (EOS auto-fixes what it's authorized to; only genuine decisions escalate to the Owner) |
| `FIXED` | remediated — **only trusted with a passing `regressionTest`** |
| `KNOWN_ACCEPTED` | real edge, consciously accepted as a documented tradeoff |
| `DEFERRED` | evaluated and found *not* a now-change; carries a `deferralRef` and a `revalidateWhen` **condition** |
| `FALSE_POSITIVE` | not a defect |

## The register is memory; reconcile is the next-audit gate
`reconcileFindings(rawFindings, register)` buckets a fresh audit against that memory:

| bucket | what it is | action |
|---|---|---|
| `surfaced` | not in the register | **the only items needing a fresh disposition** |
| `regressions` | proven-fixed (test-backed) reappeared | **alarm** — the guard failed |
| `unprovenFixed` | `FIXED`-without-test reappeared | **escalate** — the "fix" was never proven, may still be real |
| `alreadyOpen` | `CONFIRMED_OPEN` | already tracked, not re-raised |
| `suppressed` | `KNOWN_ACCEPTED` / `DEFERRED` / `FALSE_POSITIVE` | **memory** of a decision already made — not re-actioned per audit |
| `unverifiedFixed` | integrity check | `FIXED` entries missing a `regressionTest` |

## Two invariants
1. **"Fixed" requires proof.** A `FIXED` without a `regressionTest` is not believed — `unverifiedFixed` lists it, and a reappearance escalates as `unprovenFixed`. Don't say fixed if it isn't proven fixed.
2. **Deferral is decided, not postponed.** The now-vs-defer call and rationale validation happen at disposition. A `DEFERRED` item is suppressed on re-find (memory), and re-visited only when its `revalidateWhen` **condition** is met — a deliberate re-disposition, never an every-audit re-review.

## Lifecycle
1. Audit → raw findings.
2. **Disposition (immediate):** verifier sets truth + now-vs-defer with evidence.
3. `CONFIRMED_OPEN` → regression test (fails now) → fix → test passes → `FIXED` + `regressionTest`.
4. Next audit → `reconcileFindings(raw, register)` → act on `surfaced` + `regressions` + `unprovenFixed`; the rest is memory.

`register.json` is seeded from the verified EOS-ISSUE-852 Highs: H1 `KNOWN_ACCEPTED` (documented idempotent-by-retry
tradeoff), H2 `CONFIRMED_OPEN` (real double-booking gap — the first closed-loop remediation candidate),
H3 `DEFERRED` #15 (Blaze-gated, `revalidateWhen` = Blaze active).
