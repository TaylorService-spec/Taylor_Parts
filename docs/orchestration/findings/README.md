# Findings register — the audit closed loop

Cold-read audits re-surface the same items every run (already-fixed, known-accepted, deliberately-deferred)
because nothing tracks a finding's **resolution state**. This directory is that memory, and
`reconcileFindings()` (`../lib/findingsRegister.mjs`) is the gate that keeps the next audit honest. Two
principles drive it, and **neither is a silent suppression**:

## "Fixed" must be *proven* fixed — or it isn't fixed
A `FIXED` status is trusted **only** when it carries a `regressionTest` that fails while the issue exists and
passes once fixed. A `FIXED` entry **without** a test is not believed: reconcile routes it to governance review
("claimed fixed but unproven"), never suppresses it. If a proven-fixed fingerprint reappears in an audit, that's
a **REGRESSION** alarm (the guarding test should have caught it) — not a new finding.

## A reason NOT to do something also expires — and re-evaluating it is ChatGPT's call
`KNOWN_ACCEPTED` (a real edge accepted as a design tradeoff) and `DEFERRED` (postponed, e.g. behind an issue #)
are **not permanent**. Their rationale can go stale — the risk profile changes, the blocker clears, "maybe it's
time to do it now." So when an audit re-finds one, reconcile routes it to **`needsGovernanceReview`** with a
`reviewReason`, for **ChatGPT to re-verify the reason still holds and decide whether to act** — the system never
buries it. The deferral/acceptance *evidence* is itself a claim to be re-checked, not a permanent exemption.

## reconcile buckets
| bucket | meaning | what happens |
|---|---|---|
| `surfaced` | not in the register | raised as **new** work |
| `regressions` | proven-fixed (with test) reappeared | **alarm** — the guard failed |
| `needsGovernanceReview` | KNOWN_ACCEPTED, DEFERRED, or FIXED-without-test | **routed to ChatGPT** to re-verify rationale / "is it time?" |
| `alreadyOpen` | CONFIRMED_OPEN | real, already tracked — not re-raised |
| `suppressed` | FALSE_POSITIVE | genuinely not a defect — dropped |
| `unverifiedFixed` | register integrity check | FIXED entries missing a `regressionTest` |

## Statuses
`CONFIRMED_OPEN` · `FIXED` (needs `regressionTest`) · `KNOWN_ACCEPTED` (re-reviewable) · `DEFERRED` (carries
`deferralRef`, re-reviewable) · `FALSE_POSITIVE`. Every entry records `verifiedAtCommit` and the `evidence` from
reading current code.

## Lifecycle
1. Audit produces raw findings.
2. **Verify** each against current code → set a status with evidence (the step that was missing).
3. `CONFIRMED_OPEN` → fix path: write a **regression test** (fails now), fix, test passes → `FIXED` + `regressionTest`.
4. `KNOWN_ACCEPTED` / `DEFERRED` → carry evidence + a re-review trigger; ChatGPT re-evaluates when re-found.
5. Next audit → `reconcileFindings(raw, register)` → act on `surfaced` + `regressions`; route `needsGovernanceReview` to ChatGPT.

`register.json` is seeded from the verified EOS-ISSUE-852 Highs: H1 `KNOWN_ACCEPTED` (documented tradeoff — but
re-reviewable), H2 `CONFIRMED_OPEN` (real double-booking gap), H3 `DEFERRED` (#15, Blaze-gated — re-check whether
Blaze is now live and it's time).
