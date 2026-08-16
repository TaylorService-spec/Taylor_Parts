# EOS-ISSUE-852 — recovered findings (the audit that reported zero)

**Recovered 2026-08-16.** The 10-child governed audit run of 2026-08-13 completed successfully and
landed durable results for all ten sectors — every one of which reported **`COMPLETE` with
`findings: 0`**. Eight of the ten had actually found real defects and written them, in prose, into
`docs/orchestration/work-intake/results/EOS-ISSUE-852-C*/*.content.md`.

## Why the findings were lost

The run was **not** broken. The structured findings contract and extractor
([`output-contract.md`](../findings/output-contract.md), `findingSchema.mjs`, `extractFindings`) landed at
**08-13 10:05 (#863)**. The 852 children were decomposed at **08-13 01:45 (#856)** and executed shortly
after — **more than eight hours before the contract existed.** The workers emitted prose because prose
was all that had been asked of them, and the consolidation layer recorded zero because there was
nothing structured to read.

So this is a **sequencing gap, not a defect**: the audit ran before the machinery that consumes audits.

## What it cost

Two of the recovered findings were independently re-discovered by the site-work scout rounds and fixed
**~17 hours later**, at real expense:

| Finding | Found by EOS | Re-found and fixed |
| --- | --- | --- |
| Non-atomic ledger write vs. processed marker (HIGH) | 08-13 01:45 | `#932` 08-13 19:14 (site-work r3 N) |
| Technician double-booking on Dispatch (HIGH) | 08-13 01:45 | `#933` 08-13 19:14 (site-work r3 M) |

One recovered finding — **`error-boundary-has-no-reset` (HIGH)** — was still open on `main` at recovery
time, three days later, because nobody had read it.

## Disposition

**Verified against current `main` and landed in [`findings/register.json`](../findings/register.json):**
`error-boundary-has-no-reset` · `availability-blind-to-received-and-transfer-movements` ·
`dead-but-rules-authorized-legacy-assign-path` · `repository-comment-contradicts-live-rules` ·
`client-transition-check-is-role-blind` · `stale-not-exported-header-comment`.
The stale `ledger-effect-not-atomic-with-processed-marker` entry was also corrected from
`KNOWN_ACCEPTED` to `FIXED` with its regression test.

**Recovered but NOT yet verified against current `main`** — listed below rather than written into the
register, because the register's integrity guarantee is that every entry was verified by reading current
code at `verifiedAtCommit`. These need a verification pass before disposition.

| Sector | Sev | Finding | Location |
| --- | --- | --- | --- |
| C02 | MEDIUM | Post-commit inventory side effects have no durable retry if the instance dies between transaction commit and the trigger call — status advances, reservation never runs, and no failure record exists to flag it | `transitionWorkOrder.ts:130-133`, `inventoryService.ts:248-275` |
| C02 | LOW | `createWorkOrder` idempotency id excludes `priority`/`severity`/`type`/`complaint`, so a retry with changed fields silently returns the original | `createWorkOrder.ts:110-120` |
| C03 | LOW | Two independently-weighted technician scoring implementations feed different boards with no shared source or reconciliation | `dispatchScoring.js`, `technicianRecommendationEngine.ts` |
| C04 | LOW | `warrantyExpiresDate` is an unvalidated free-text field with no expiry semantics and no reader anywhere | `equipment.js:153,326`, `firestore.rules:1371` |
| C07 | LOW | The write-once content-addressed guarantee is enforced only by `persistResult` (no non-test callers); the production entrypoint uses plain `writeFileSync` | `work-intake.mjs:34-41` vs `intake-runtime.mjs:37-42` |
| C07 | LOW | No temp-file+rename anywhere in the sector — every writer writes directly to its final path | `intake-runtime.mjs`, `intake-artifactize.mjs`, `intake-patch-integrate.mjs` |
| C08 | MEDIUM | `findEquivalentResult()` dedup guard fails **open** when only one side declares a freshness anchor | `agentManager.mjs` |
| C08 | MEDIUM | `planIntegrationBacklog()` overlap detection is weaker than the sibling concurrency-safety logic in the same file, and untested for the gap | `agentManager.mjs` |
| C09 | MEDIUM | Raw Firebase/Functions error text reaches users in several modules, contradicting the codebase's own safe-copy convention | `field-ops-app-vite/src/modules/*` |
| C09 | LOW | Some submit handlers clear the submitting flag only in `catch`, not `finally` — a permanently stuck button on an unexpected throw | `field-ops-app-vite/src/modules/*` |
| C10 | MEDIUM | `DelegationCharter.md` cites roadmap "candidates" the roadmap itself says already shipped | `docs/DelegationCharter.md` |
| C10 | MEDIUM | `SPRINT_STATUS.md`'s self-declared staleness counter is itself stale | `docs/SPRINT_STATUS.md` |
| C10 | LOW | "Owner Control Center" vs "Owner Control Plane" are easy to conflate (13 docs vs 5) | `docs/orchestration/*` |

## The durable lesson

A `COMPLETE` result carrying `findings: []` is indistinguishable from a genuine clean run. The contract
already requires fail-closed extraction (`EXTRACTION_INVALID` blocks consolidation) — but that only
protects runs made **after** it existed. Any audit result predating `#863` should be treated as
**unextracted, not clean**, and re-read from its `content.md`.
