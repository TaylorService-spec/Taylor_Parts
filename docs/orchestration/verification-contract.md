# What "E2E VERIFIED" means

The Wave 7 truth matrix records **22 items, zero E2E verified** — while the repository
already contains a **7,319-line Playwright driver** that signs in as real seeded personas
and drives the real UI.

The gap was never automation. Nothing defined what *verified* meant, so no run could
produce a durable claim, and the terminal state stayed permanently out of reach.

[`lib/verificationEvidence.mjs`](./lib/verificationEvidence.mjs) is that definition. It is
pure — no filesystem, network, browser, or clock. The caller supplies observations and the
environment fact; the module decides only what they add up to.

## The three rules, and what each one cost

**1. A positive path alone is not verification.**
*"It worked when I was admin"* proves the happy path and nothing about the authorization
boundary. Wave 7 shipped three items user-visible whose capability was granted to nobody —
they **looked broken to a tester and were behaving correctly**. Only exercising the negative
path distinguishes *denies correctly* from *broken*. A scenario without a negative persona
is refused at construction, rather than being allowed to exist and quietly never verify.

**2. Evidence is bound to an environment and a commit.**
On 2026-08-16 the sandbox served a commit **17 behind main** while reporting a fresh build
time. Evidence gathered against one commit says nothing about another, so a `VERIFIED`
result becomes `STALE` the moment the environment moves.

**3. An unproven check is not a passing check.**
Missing, empty, or evidence-free observations yield `NOT_VERIFIED` — never verified by
omission. The audit that reported `COMPLETE, 0 findings` while holding 21 real defects is
what the opposite default costs.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `VERIFIED` | positive **and** negative exercised, both evidenced, environment + commit recorded |
| `NOT_VERIFIED` | insufficient evidence — **not** a claim that anything is broken |
| `FAILED` | something was exercised and behaved wrongly; outranks incompleteness |
| `STALE` | was verified, against a commit the environment no longer serves |

Only `VERIFIED` may advance a truth-matrix item — `supportsTruthMatrixClaim()`.

## What this is not

**It does not drive a browser.** The driver already exists. This decides what a run *proved*.

**It is not a test framework.** It is the evidence contract sitting between a run and a
status claim, so that "verified" stops being something an AI asserts and becomes something
a reader can check.

## Usage

```js
const scenario = buildScenario({
  itemId: "sales-order-actions",
  capability: "salesOrder.transition",
  positivePersona: "admin",
  negativePersona: "technician",
});

const result = evaluate(
  scenario,
  [
    observation({ check: CHECK.POSITIVE, passed: true, evidence: "evidence/so-admin.png" }),
    observation({ check: CHECK.NEGATIVE, passed: true, evidence: "evidence/so-tech-denied.png" }),
  ],
  { environmentId: "platform-sandbox", commit: "b09f3a13" },  // read from /version.json
  servingCommitNow,                                           // re-read before trusting
);
```

The environment fact must be **read from the environment itself** — `/version.json` — never
inferred from a deploy command exit status. See
[`docs/releases/wave7-completion-truth-matrix.md`](../releases/wave7-completion-truth-matrix.md).
