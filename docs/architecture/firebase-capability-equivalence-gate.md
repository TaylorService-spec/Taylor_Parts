# Firebase Retirement: the Business Capability Equivalence Gate

Owner directive, 2026-10-11: **Firebase retirement is a business-functionality migration, not code
deletion. No required business capability may disappear because its Firebase implementation is
removed.**

The exit ratchet (`scripts/firebaseExitGuard.mjs`, [firebase-exit-ratchet.md](firebase-exit-ratchet.md))
proves that a Firebase *dependency* went away. It cannot tell whether the *business capability* that
dependency served went with it. This gate closes that gap. It does not replace or weaken the ratchet,
the shim boundary or the F0 deploy guard. It runs beside them.

| Piece | Path |
|---|---|
| Manifest (the records) | `docs/architecture/firebase-capability-equivalence.json` |
| Guard | `scripts/firebaseCapabilityEquivalenceGuard.mjs` |
| Contract tests | `scripts/firebaseCapabilityEquivalenceGuard.test.mjs` |
| CI (unfiltered) | `.github/workflows/firebase-capability-equivalence.yml` |

## 1. Dispositions

Every retired operation has exactly one disposition.

| Disposition | Meaning | May retire? |
|---|---|---|
| `REPLACED` | Equivalent business functionality exists in EOS and is **verified** on every gate. | Yes |
| `SUPERSEDED` | An approved EOS workflow achieves the required outcome differently. It must be verified on every gate. A **material** business-behaviour change also needs an Owner decision. | Yes, with the Owner's acceptance when behaviour materially changes |
| `GAP` | The functionality is missing, inaccessible, untested or still Firebase-dependent. | Only with an Owner decision that explicitly accepts the gap |
| `UNVERIFIED` | **Historical only.** A replacement exists, but the evidence is incomplete. Treated as a gap. | Never for a new retirement |

An unverified replacement is never `REPLACED`. The guard rejects the claim and names the open gates.

## 2. The five gates (plus audit)

Each gate has a status: `VERIFIED`, `PARTIAL`, `UNVERIFIED`, `GAP` or `NOT_APPLICABLE`. Each status
other than `VERIFIED` and `NOT_APPLICABLE` must carry a `limitation` that says what is missing.

| Gate | Question | `VERIFIED` requires |
|---|---|---|
| A, functional equivalence | Can the same business outcome be achieved in EOS, including validation, errors, corrections and exceptions? | At least one valid citation |
| B, employee accessibility | Can an authorized employee reach and use it through an EOS screen or a supported integration, for the right personas? Retail Sales and National Accounts Sales are distinct. | **Both** an executable screen-level test (`ui-test`: the screen calls the EOS operation and handles its **real** result shape) **and** a recorded live run by the persona against a deployed environment (`uat`). A route + capability + grant reading proves reachability only on paper, so it is `PARTIAL`. A test-suite write-up titled "UAT" is `doc` evidence, not `uat`. |
| C, authority equivalence | Are Principal/Employee resolution, tenant isolation, capabilities, Operational Scope, Work Eligibility, ownership, accountability and assignment all correct? | Evidence. **Accepted EOS authority is canonical.** Firebase authorization logic is not copied where it conflicts. |
| D, persistence and integration | Is the operation persisted in PostgreSQL, with correct transactions, downstream workflows, reports, jobs and integrations, and no remaining Firebase reads or writes? | Evidence. May be `NOT_APPLICABLE` with a reason. |
| E, regression evidence | Do executable tests prove the outcome? | At least one **positive** and one **negative** executable test (`test`/`ui-test`). A source citation alone never satisfies E. |
| audit | Are the audit obligations of accepted EOS authority met? | Evidence |

Only B and D may be `NOT_APPLICABLE`, and only with a `reason`. A, C, E and audit always apply.

## 3. The record

```jsonc
{
  "legacyOperation": "createPart",            // the removed export, exactly
  "capabilityId": "catalog.part.create",      // the business capability
  "domain": "catalog",
  "era": "HISTORICAL",                         // or "GATED"
  "retiredIn": { "pr": 2055, "commit": "0de3c06b" },
  "disposition": "UNVERIFIED",
  "verificationStatus": "UNVERIFIED",          // VERIFIED only when every gate is
  "materialBehaviorChange": false,
  "eosReplacement": "POST /operations/catalog createPart",
  "entryPoint": "…UI screen or integration…",
  "postgresImplementation": "…writer…",
  "personas": ["…"],
  "requiredCapabilities": ["…"],
  "ownerDecision": null,                       // "DECISIONS #NNN", never inferred
  "gates": { "A": {…}, "B": {…}, "C": {…}, "D": {…}, "E": {…} },
  "audit": {…},
  "gaps": ["…"]
}
```

Evidence entries: `{ "kind": "test" | "ui-test" | "uat" | "source" | "doc", "path": "…", "contains": "…", "polarity": "positive" | "negative" }`.
`contains` is required, and `polarity` is required, for `test` and `ui-test`.

## 4. What the guard enforces

1. **It detects newly retired exports.** These are the exports of `functions/src/index.ts` at the
   previously accepted commit (PR base, or the pre-push commit on `main`) minus the exports now. The
   index is parsed with comments and strings blanked, so multi-line export blocks count. `export *`
   and `export default` are refused, because the guard cannot enumerate them, and an undercount
   would hide a retirement.
2. **It requires a record.** A newly retired export with no record fails with `RETIREMENT BLOCKED`.
3. **It rejects missing or malformed records.** Required fields, enums, arrays, duplicates and gate
   shapes are all checked.
4. **It rejects an unresolved GAP as retirement-complete.** A new retirement (`era: GATED`) must be
   one of:
   - `REPLACED`, fully verified;
   - `SUPERSEDED`, fully verified, plus the Owner when behaviour materially changes;
   - a `GAP` with an Owner decision.

   `UNVERIFIED` is refused for a new retirement.
5. **It rejects unsupported `REPLACED` claims**, in both eras. A `VERIFIED` verification status with an
   open gate is also rejected.
6. **It requires an Owner decision reference** for a materially superseded behaviour, and for an
   accepted gap. The reference must be `DECISIONS #NNN` with a real `## #NNN` heading in
   `docs/DECISIONS.md`. The guard never infers or invents one.
7. **It detects stale test references.** Every cited path must exist (inside the repository), and every
   `contains` must still be found. A renamed or deleted test fails as `STALE`.
8. **It explains the failure.** Every error names the record, the gate and what evidence is missing.

It also:

- keeps records append-only against the previous manifest;
- refuses to let a historical retirement be exported again (Firebase retirement only);
- refuses to file a new retirement as `HISTORICAL`.

## 5. Historical baseline vs future enforcement

These two are deliberately separate.

- **HISTORICAL**: the 22 retirements completed before this gate, audited at main `acc65f2e`. They are
  `recordPutAway`, F2 Supplier (8), F4 Work Order Labor (3), F3a Part Master (3) and F3b Part Alias (7).
  - The names are pinned in the guard (`HISTORICAL_RETIREMENTS`) and in its test.
  - These records may remain `UNVERIFIED` or `GAP`. They are reported as open findings, not CI
    failures, so accepted main stays testable.
  - They may not over-claim: a `REPLACED` claim is held to the full proof.
  - Their citations are re-checked on every run.
- **GATED**: every retirement from this gate onward. It must be retirement-complete to merge.

Historical findings are recorded in
[the retrospective](../audits/firebase-retirement-equivalence-2026-10-11/README.md). This document
and the guard are the future enforcement.

### Known pre-gate retirements outside the audited baseline

Commit `5d6a84ac` (2026-10-01, Inventory / Warehouse completion) retired `recordPutAway` together with
18 other inventory callables: cycle count, transfer orders, relocation and stock-movement reads.
Earlier waves took the estate from 187 exports to 138. Those retirements are outside the Owner's
2026-10-11 audit scope. They are not in `HISTORICAL_RETIREMENTS`, so this gate makes no claim about
them. They are listed as audit backlog in the
[roadmap](firebase-retirement-roadmap.md).

## 6. What the gate does not prove

- **It does not run the cited tests.** It proves the cited tests *exist* by name. The repository's
  own suites run them. A cited test that is not in any CI workflow is a reviewer's concern.
- **It cannot tell a real UAT record from a fabricated one.** Reviewers own that judgement. The gate
  only forces the claim to be made explicitly and keeps it from going stale.
- **A `DECISIONS` heading added in the same PR passes the existence check.** The Owner's approval
  of that PR is the control.
