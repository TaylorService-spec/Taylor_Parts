# Sandbox data quality — inverted Work Order completion evidence

**Status:** FINDING ONLY. Nothing was repaired, mutated, or deployed. Raised 2026-09-04 from the
Technician Dashboard live review; the dashboard defect it surfaced is fixed separately and this
finding does not block that closure.

**Classification:** SANDBOX DATA QUALITY · **NON-BLOCKING** now that the dashboard fails honestly.

## What was observed

The live Technician Dashboard in `platform-sandbox` (Hosting `f05d3327`) rendered:

> Avg Job Duration **-1686m**

A negative span cannot be a duration. The client projection was computing
`completedAt - workStartedAt` over the governed lifecycle pair, in the correct direction and in
consistent units — so at least one **completed Work Order in the live dataset carries a
`completedAt` that precedes its `workStartedAt`**.

## Why this is a data finding and not only a code one

The code defect — admitting a contradictory pair into the mean without validation — is corrected:
inverted evidence is now counted, contributes to no average, and one contradictory record withdraws
the whole figure rather than being averaged away. **The screen will now read N/A instead of a
negative number.**

That makes the symptom honest. It does not make the underlying records correct. A Work Order whose
completion precedes its work start contradicts the lifecycle the state machine is supposed to
enforce, and that is worth understanding on its own terms.

## What is known, and what is not

| | |
|---|---|
| **Repository seeds are not the cause** | `functions/scripts/seedSandboxPerformanceStory.mjs` and `seedSandboxTransactional.js` set every reached lifecycle timestamp to the same `now`, which yields a **zero-length** span — unusual, but not inverted. Neither seed can produce this shape. |
| **Likely origin** | The live sandbox dataset is production-derived (the Stream C fixture pipeline), so the inversion most plausibly arrives with derived data rather than being manufactured in the sandbox. |
| **Exact offending documents** | **NOT IDENTIFIED.** Finding them means reading the live sandbox `fieldops_wos` collection ad hoc, and no such authorization was given. That restraint is deliberate and should not be quietly relaxed to close this ticket. |
| **Ad-hoc mutation** | **NONE.** No sandbox record was written, corrected, or deleted. |

## What would answer it

An authorized, bounded read of `fieldops_wos` for documents where both `workStartedAt` and
`completedAt` exist and `completedAt < workStartedAt` — count, ids, and the transition history that
produced them. That read is the decision point, not this document.

Two distinct questions follow from the answer:

1. **Are the records wrong?** If a derived-data step can invert the pair, the pipeline is the defect
   and repairing individual documents would only hide it.
2. **Can the live system still produce this?** If `transitionWorkOrder()` can be driven into writing
   a completion before a work start, that is a state-machine gap and outranks the data.

## What must not happen

- Do not hand-correct sandbox documents to make the screen show a number.
- Do not relax the projection to average the trustworthy remainder. A partial figure under a
  complete-population name is the failure this platform has already been bitten by.
- Do not treat "the dashboard no longer shows a negative" as this finding being resolved.
